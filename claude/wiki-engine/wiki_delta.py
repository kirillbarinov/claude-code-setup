"""Сбор дельты проекта для модели-писателя: claude-mem, файлы, дерево, STATE.md, карты project-map."""
import os
import sqlite3
import subprocess
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

from wiki_lint import missing_sources
from wikilib import Paths, project_for

SKIP = {".git", "node_modules", ".venv", "venv", "__pycache__", "build", "dist", ".next",
        "target", ".gradle", ".idea", ".cache", ".worktrees", "coverage", "out"}
MAX_OBS, MAX_SUM, MAX_FILES, MAX_TREE, MAX_STATE_LINES = 200, 50, 300, 200, 1000


@dataclass
class Delta:
    text: str
    n_obs: int
    n_files: int
    n_broken: int

    @property
    def empty(self) -> bool:
        return self.n_obs == 0 and self.n_files == 0 and self.n_broken == 0


def _cut(s, n=400) -> str:
    s = (s or "").replace("\n", " ").strip()
    return s if len(s) <= n else s[:n] + "…"


def _mem(p: Paths, name: str, since: int):
    if not p.db.exists():
        return None, None
    try:
        con = sqlite3.connect(f"file:{p.db}?mode=ro", uri=True, timeout=5)
        like = f"%/{name}"
        obs = con.execute(
            "select id, created_at, type, title, facts, files_modified from observations "
            "where (project = ? or project like ?) and created_at_epoch > ? "
            "order by created_at_epoch desc limit ?", (name, like, since * 1000, MAX_OBS)).fetchall()
        sums = con.execute(
            "select created_at, request, learned, completed, next_steps from session_summaries "
            "where (project = ? or project like ?) and created_at_epoch > ? "
            "order by created_at_epoch desc limit ?", (name, like, since * 1000, MAX_SUM)).fetchall()
        con.close()
        return obs, sums
    except sqlite3.Error:
        return None, None


def _walk(root: Path):
    for dirpath, dirs, files in os.walk(root):
        dirs[:] = sorted(d for d in dirs if d not in SKIP and not (d.startswith(".") and d != ".claude"))
        for f in sorted(files):
            yield Path(dirpath) / f


def _changed(root: Path, since: int) -> list:
    if (root / ".git").exists():
        iso = datetime.fromtimestamp(since).isoformat(timespec="seconds")
        r = subprocess.run(["git", "-c", "core.quotePath=false", "-C", str(root), "log", f"--since={iso}", "--name-only",
                            "--pretty=format:"], capture_output=True, text=True, timeout=60)
        seen = []
        for line in r.stdout.splitlines():
            if line.strip() and line not in seen:
                seen.append(line)
        return seen[:MAX_FILES]
    out = []
    for f in _walk(root):
        try:
            if f.stat().st_mtime > since:
                out.append(str(f.relative_to(root)))
        except OSError:
            continue
        if len(out) >= MAX_FILES:
            break
    return out


def _tree(root: Path) -> list:
    out = []
    for top in sorted(root.iterdir()):
        if top.name in SKIP or top.name.startswith("."):
            continue
        out.append(top.name + ("/" if top.is_dir() else ""))
        if top.is_dir():
            try:
                for sub in sorted(top.iterdir()):
                    if sub.name in SKIP or sub.name.startswith("."):
                        continue
                    out.append(f"  {top.name}/{sub.name}" + ("/" if sub.is_dir() else ""))
            except OSError:
                pass
        if len(out) >= MAX_TREE:
            break
    return out[:MAX_TREE]


def _state_mds(root: Path) -> list:
    pats = [".claude/STATE.md", "*/.claude/STATE.md", "*/*/.claude/STATE.md"]
    return sorted({f for pat in pats for f in root.glob(pat)})


def _map_mds(root: Path) -> list:
    out = []
    for f in _walk(root):
        if f.name == "CLAUDE.md":
            try:
                if "КАРТА:НАЧАЛО" in f.read_text(encoding="utf-8", errors="ignore"):
                    out.append(str(f.relative_to(root)))
            except OSError:
                pass
        if len(out) >= 60:
            break
    return out


def build_delta(p: Paths, name: str, root: Path, since: int, stage: Path,
                initial: bool, today: date) -> Delta:
    obs, sums = _mem(p, name, since)
    files = [] if initial else _changed(root, since)
    broken = missing_sources(stage, root) if (stage / "router.md").exists() else []
    L = [f"# Проект: {name}", f"Корень: {root}", f"Сегодня: {today.isoformat()}",
         f"Режим: {'первичная сборка' if initial else 'обновление'}", ""]
    if broken:
        L += ["## ИСПРАВИТЬ: источники, которых больше нет", *[f"- {b}" for b in broken], ""]
    if initial:
        for sm in _state_mds(root):
            lines = sm.read_text(encoding="utf-8", errors="ignore").splitlines()[:MAX_STATE_LINES]
            L += [f"## Дневник project-memory: {sm.relative_to(root)} (главный источник знаний)",
                  "", *lines, ""]
    maps = _map_mds(root)
    if maps:
        L += ["## Карты папок project-map (ссылайся на них из router, не пересказывай)",
              *[f"- {m}" for m in maps], ""]
    L += ["## Структура (2 уровня)", *_tree(root), ""]
    if files:
        L += [f"## Изменённые файлы с прошлого обновления ({len(files)})", *[f"- {f}" for f in files], ""]
    if obs is None:
        L += ["## Наблюдения claude-mem", "БД claude-mem недоступна — работай по файлам.", ""]
        obs, sums = [], []
    else:
        L += [f"## Наблюдения claude-mem ({len(obs)}, свежие первыми)"]
        for i, created, typ, title, facts, fmod in obs:
            L.append(f"- mem:{i} · {created[:10]} · {typ} · {title} — {_cut(facts)} · файлы: {_cut(fmod, 200)}")
        L += ["", f"## Сводки сессий ({len(sums)})"]
        for created, req, learned, done, nxt in sums:
            L.append(f"- {created[:10]} · запрос: {_cut(req, 200)} · понято: {_cut(learned)} · "
                     f"сделано: {_cut(done)} · дальше: {_cut(nxt, 200)}")
        L.append("")
    return Delta("\n".join(L), len(obs), len(files), len(broken))


def discover_projects(p: Paths) -> list:
    if not p.db.exists():
        return []
    try:
        con = sqlite3.connect(f"file:{p.db}?mode=ro", uri=True, timeout=5)
        raw = [r[0] for r in con.execute("select distinct project from observations where project is not null")]
        con.close()
    except sqlite3.Error:
        return []
    out = []
    for name in raw:
        base = name.rsplit("/", 1)[-1]
        if base and base not in out and project_for(str(p.home / base), p) == base:
            out.append(base)
    return out
