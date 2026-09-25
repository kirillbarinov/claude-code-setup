"""Хуки вики. start — router проекта в контекст; enqueue — проект в очередь; health — строки для
os-audit-staleness. Никогда не падает: сбой хука не должен ломать сессию."""
import json
import os
import sys
import time

import wikilib as W

MAX_OUT = 2600  # символов: заголовок + тело router (≤ 2000, держит lint) + предупреждение


def start_text(p: W.Paths, cwd: str) -> str:
    name = W.project_for(cwd, p)
    if not name:
        return ""
    r = p.wiki / name / "router.md"
    if not r.exists():
        return ""
    meta, body = W.parse_frontmatter(r.read_text(encoding="utf-8"))
    meta = meta or {}
    out = (f"# Вики проекта «{name}» — маршрутизатор (обновлён {meta.get('updated', '?')})\n"
           f"Страницы: ~/.claude/wiki/{name}/pages/ — открывать по нужде, не больше 5. "
           f"Другие проекты: ~/.claude/wiki/_index.md\n\n{body.strip()}\n")
    err = W.load_state(p).get(name, {}).get("last_error")
    warn = f"\nВнимание: последнее обновление вики не прошло — {err[:200]}\n" if err else ""
    room = MAX_OUT - len(warn) - 20
    if len(out) > room:
        cut = out[:room]
        out = cut[:cut.rfind("\n") + 1] + "…(обрезано)\n"  # по границе строки, не посреди ссылки
    return out + warn


def do_enqueue(p: W.Paths, cwd: str, env) -> None:
    if env.get("CLAUDE_WIKI_RUN") == "1":
        return
    name = W.project_for(cwd, p)
    if name:
        W.enqueue(p, name, cwd)


def health_text(p: W.Paths, now: int) -> str:
    lines = []
    st = W.load_state(p)
    bad = [n for n, r in st.items()
           if r.get("last_error") and r.get("last_error_epoch", 0) >= r.get("last_ok_epoch", 0)]
    if bad:
        lines.append(f"Вики: не обновились {len(bad)} проект(а): {', '.join(bad[:5])}. "
                     f"Разбор: ~/.claude/state/wiki/update.log")
    try:
        last = int(p.last_run.read_text().strip())
    except (OSError, ValueError):
        last = None  # писатель ещё ни разу не отработал — свежая установка
    if last and now - last > 86400:
        lines.append("Вики: писатель не отрабатывал больше 24 ч — проверь "
                     "`launchctl list | grep claude-wiki` и ~/.claude/state/local.claude-wiki.err")
    oldest = W.oldest_queued(p)
    if oldest and now - oldest > 86400:
        lines.append("Вики: очередь не разбирается больше 24 ч — проверь "
                     "`launchctl list | grep claude-wiki` и ~/.claude/state/wiki/update.log")
    return "\n".join(lines) + ("\n" if lines else "")


def main() -> int:
    try:
        cmd = sys.argv[1] if len(sys.argv) > 1 else ""
        cwd = os.getcwd()
        if cmd in ("start", "enqueue") and not sys.stdin.isatty():
            try:
                cwd = json.loads(sys.stdin.read() or "{}").get("cwd") or cwd
            except ValueError:
                pass
        p = W.default_paths()
        if cmd == "start":
            sys.stdout.write(start_text(p, cwd))
        elif cmd == "enqueue":
            do_enqueue(p, cwd, os.environ)
        elif cmd == "health":
            sys.stdout.write(health_text(p, int(time.time())))
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
