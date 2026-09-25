"""Писатель вики: очередь → staging → модель → lint → перенос → индекс → git. Один на машину (замок)."""
import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from datetime import date
from pathlib import Path

import wikilib as W
from wiki_delta import build_delta, discover_projects
from wiki_lint import archive_stale, lint

ENGINE = Path(__file__).resolve().parent
PROMPT = ENGINE / "prompt.md"
MODEL_TIMEOUT = 900
MAX_FAILS = 3


def claude_bin() -> str:
    return os.environ.get("WIKI_CLAUDE_BIN") or shutil.which("claude") or str(Path.home() / ".local/bin/claude")


def run_model(stage: Path, root: Path, delta: str, effort: str):
    settings = json.dumps({"permissions": {"deny": [f"Edit(/{root}/**)"]}})
    cmd = [claude_bin(), "-p", "--restricted", "--strict-mcp-config", "--no-session-persistence",
           "--model", "opus", "--effort", effort, "--fallback-model", "sonnet",
           "--settings", settings, "--allowedTools", "Read Glob Grep Write Edit",
           "--append-system-prompt-file", str(PROMPT), "--add-dir", str(root)]
    env = dict(os.environ, CLAUDE_WIKI_RUN="1")
    try:
        r = subprocess.run(cmd, cwd=stage, input=delta, text=True, capture_output=True,
                           timeout=MODEL_TIMEOUT, env=env)
        return r.returncode, (r.stdout + r.stderr)[-2000:]
    except subprocess.TimeoutExpired:
        return 124, f"таймаут {MODEL_TIMEOUT} с"


def update_index(p: W.Paths) -> None:
    rows = []
    for d in sorted(x for x in p.wiki.iterdir() if x.is_dir() and not x.name.startswith(".")):
        r = d / "router.md"
        if not r.exists():
            continue
        meta, _ = W.parse_frontmatter(r.read_text(encoding="utf-8"))
        meta = meta or {}
        rows.append(f"| [{d.name}](<{d.name}/router.md>) | `~/{d.name}` | {meta.get('summary', '')} "
                    f"| {meta.get('updated', '')} |")
    text = ("# Вики проектов\n\n<!-- генерируется wiki_update.py — руками не править -->\n\n"
            "| Проект | Путь | Что это | Обновлено |\n|---|---|---|---|\n" + "\n".join(rows) + "\n")
    (p.wiki / "_index.md").write_text(text, encoding="utf-8")


def git_commit(p: W.Paths, name: str, msg: str) -> None:
    paths = [name, "_index.md"]
    subprocess.run(["git", "-C", str(p.wiki), "add", "-A", "--", *paths], capture_output=True)
    subprocess.run(["git", "-C", str(p.wiki), "commit", "-q", "-m", msg, "--", *paths], capture_output=True)


def _fail(p, rec, name, err, now):
    rec["last_error"] = err[:1000]
    rec["last_error_epoch"] = now
    rec["fail_streak"] = rec.get("fail_streak", 0) + 1
    W.log(p, f"{name}: ОШИБКА ({rec['fail_streak']}): {err[:300]}")
    if rec["fail_streak"] < MAX_FAILS:
        W.enqueue(p, name, "(повтор)")


def tidy_archived(stage: Path) -> None:
    """Удаления у модели нет: перенос в архив = копия в archive/, исходник из pages/ убираем здесь."""
    arch = stage / "archive"
    if arch.is_dir():
        for f in arch.glob("*.md"):
            (stage / "pages" / f.name).unlink(missing_ok=True)


def process(p, name, st, initial, runner, today) -> bool:
    root = p.home / name
    live, stage = p.wiki / name, p.staging / name
    rec = st.setdefault(name, {})
    now = int(time.time())
    old = p.wiki / f".{name}.old"
    if not live.exists() and old.exists():  # прошлый прогон умер между rename и move
        os.rename(old, live)
        W.log(p, f"{name}: восстановлена live-папка из .old")
    shutil.rmtree(stage, ignore_errors=True)
    stage.parent.mkdir(parents=True, exist_ok=True)
    if live.exists():
        shutil.copytree(live, stage)
    else:
        stage.mkdir()
    try:
        since = 0 if initial else int(rec.get("last_ok_epoch", 0))
        delta = build_delta(p, name, root, since, stage, initial, today)
        if not initial and delta.empty:
            rec["last_ok_epoch"] = now
            W.log(p, f"{name}: без изменений")
            return True
        effort = "medium" if initial or delta.n_obs or delta.n_broken else "low"
        rc, out = runner(stage, root, delta.text, effort)
        if rc != 0:
            _fail(p, rec, name, f"модель: код {rc}: {out[-300:]}", now)
            return False
        tidy_archived(stage)
        archive_stale(stage, root, today)
        errs = lint(stage, name, root, p.db)
        if errs:  # один проход починки: модель видит ошибки проверки и правит только их
            fix = (f"# Проект: {name}\nСегодня: {today.isoformat()}\nРежим: исправление\n\n"
                   "## ИСПРАВИТЬ: черновик не прошёл проверку. Исправь только это, остальное не трогай.\n"
                   + "\n".join(f"- {e}" for e in errs[:30]) + "\n\n"
                   "Лимиты строк и символов считаются по телу без frontmatter. Символы ты считаешь "
                   "на глаз и неточно — сокращай до цели на 20% ниже лимита.\n")
            rc, out = runner(stage, root, fix, "low")
            if rc == 0:
                tidy_archived(stage)
                errs = lint(stage, name, root, p.db)
        if errs:
            _fail(p, rec, name, "; ".join(errs[:8]) + f" | модель: {out.strip()[-300:]}", now)
            return False
        shutil.rmtree(old, ignore_errors=True)
        if live.exists():
            os.rename(live, old)
        shutil.move(str(stage), str(live))
        shutil.rmtree(old, ignore_errors=True)
        update_index(p)
        n = len(list((live / "pages").glob("*.md"))) if (live / "pages").is_dir() else 0
        git_commit(p, name, f"wiki: {name} ({n} стр.)")
        rec.update(last_ok_epoch=now, fail_streak=0)
        rec.pop("last_error", None)
        rec.pop("last_error_epoch", None)
        W.log(p, f"{name}: ок, {n} стр., effort={effort}")
        return True
    finally:
        shutil.rmtree(stage, ignore_errors=True)


def run(p: W.Paths, manual=(), rebuild=(), runner=run_model, today=None, initial_budget=3) -> int:
    today = today or date.today()
    if not W.acquire_lock(p):
        W.log(p, "замок занят — выход")
        return 0
    try:
        st = W.load_state(p)
        for name in rebuild:
            st.setdefault(name, {}).pop("last_ok_epoch", None)
            st[name]["fail_streak"] = 0
        forced = list(dict.fromkeys([*manual, *rebuild]))
        # ручной запуск — только названные проекты; очередь и обнаружение ждут планового прогона
        queued = [] if forced else W.take_queue(p)
        for name in queued:
            st.setdefault(name, {})
        work = list(dict.fromkeys([*forced, *queued]))
        for name in ([] if forced else discover_projects(p)):
            if name in work:
                continue
            rec = st.get(name, {})
            if "last_ok_epoch" not in rec and rec.get("fail_streak", 0) < MAX_FAILS:
                work.append(name)
        for name in work:
            if W.project_for(str(p.home / name), p) != name:
                W.log(p, f"{name}: не проект или папки нет — пропуск")
                continue
            initial = "last_ok_epoch" not in st.get(name, {})
            if initial and name not in forced and name not in queued:
                if initial_budget <= 0:
                    continue
                initial_budget -= 1
            try:
                process(p, name, st, initial, runner, today)
            except Exception as e:  # один проект не валит весь прогон
                _fail(p, st.setdefault(name, {}), name, f"исключение: {e!r}", int(time.time()))
            W.save_state(p, st)
        W.save_state(p, st)
        p.last_run.write_text(str(int(time.time())))
        return 0
    finally:
        W.release_lock(p)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", action="append", default=[])
    ap.add_argument("--rebuild", action="append", default=[])
    a = ap.parse_args()
    return run(W.default_paths(), manual=a.project, rebuild=a.rebuild)


if __name__ == "__main__":
    sys.exit(main())
