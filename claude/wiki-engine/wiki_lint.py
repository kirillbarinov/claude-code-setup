"""Детерминированная проверка страниц вики и архивация протухшего. Модель не вызывается."""
import re
import sqlite3
import sys
from datetime import date, timedelta
from pathlib import Path

from wikilib import body_lines, default_paths, parse_frontmatter

ROUTER_MAX, PAGE_MAX, PAGES_MAX = 40, 150, 15
ROUTER_CHARS = 2000  # router целиком уходит в контекст каждой сессии
NAME_RE = re.compile(r"[a-z0-9-]+\.md")
LINK_RE = re.compile(r"pages/([^\s)\]]+\.md)")
DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")
# вики каждый день уезжает в облачный бэкап — значения секретов туда попасть не должны
SECRET_RE = re.compile(
    r"sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16}"
    r"|-----BEGIN [A-Z ]*PRIVATE KEY-----"
    r"|(?i:\b(?:password|passwd|secret|token|api_?key)\s*[=:]\s*['\"]?[^\s'\"`<>$]{6,})")


def _pages(pdir: Path, sub: str) -> list:
    d = pdir / sub
    return sorted(d.glob("*.md")) if d.is_dir() else []


def _check_file(f: Path, pdir: Path, project: str, kind: str, want_status: str,
                root: Path, check_files: bool, errs: list, mem_ids: list):
    rel = str(f.relative_to(pdir))
    text = f.read_text(encoding="utf-8")
    meta, body = parse_frontmatter(text)
    if meta is None:
        errs.append(f"{rel}: нет или битый frontmatter")
        return None
    if meta.get("project") != project:
        errs.append(f"{rel}: project={meta.get('project')!r}, ожидался {project!r}")
    if meta.get("kind") != kind:
        errs.append(f"{rel}: kind={meta.get('kind')!r}, ожидался {kind!r}")
    if meta.get("status") != want_status:
        errs.append(f"{rel}: status={meta.get('status')!r}, в этой папке допустим только {want_status!r}")
    if not DATE_RE.fullmatch(str(meta.get("updated", ""))):
        errs.append(f"{rel}: updated не в формате YYYY-MM-DD")
    if kind == "router" and not isinstance(meta.get("summary"), str):
        errs.append(f"{rel}: нет summary")
    srcs = meta.get("sources")
    if not isinstance(srcs, list) or not srcs:
        errs.append(f"{rel}: пустые sources")
    else:
        for s in srcs:
            if "file" in s:
                if check_files and not (root / s["file"]).exists():
                    errs.append(f"{rel}: источник не найден: {s['file']}")
            elif "mem" in s:
                if s["mem"].isdigit():
                    mem_ids.append((rel, int(s["mem"])))
                else:
                    errs.append(f"{rel}: mem не число: {s['mem']}")
            else:
                errs.append(f"{rel}: неизвестный тип источника {s}")
    if SECRET_RE.search(text):
        errs.append(f"{rel}: похоже на значение секрета — в вики только имена переменных")
    limit = ROUTER_MAX if kind == "router" else PAGE_MAX
    n = body_lines(text)
    if n > limit:
        errs.append(f"{rel}: {n} строк > {limit}")
    if kind == "router" and len(body.strip()) > ROUTER_CHARS:
        errs.append(f"{rel}: {len(body.strip())} символов > {ROUTER_CHARS}")
    return meta, body


def lint(pdir: Path, project: str, root: Path, db) -> list:
    errs, mem_ids = [], []
    router = pdir / "router.md"
    if not router.exists():
        return ["нет router.md"]
    for f in sorted(pdir.rglob("*")):
        if f.is_dir():
            continue
        parts = f.relative_to(pdir).parts
        if parts == ("router.md",):
            continue
        if len(parts) == 2 and parts[0] in ("pages", "archive"):
            if not NAME_RE.fullmatch(parts[1]):
                errs.append(f"{'/'.join(parts)}: имя не kebab-case латиницей")
            continue
        errs.append(f"лишний файл: {'/'.join(parts)}")
    r = _check_file(router, pdir, project, "router", "active", root, True, errs, mem_ids)
    pages = _pages(pdir, "pages")
    if len(pages) > PAGES_MAX:
        errs.append(f"активных страниц {len(pages)} > {PAGES_MAX}")
    for pg in pages:
        _check_file(pg, pdir, project, "page", "active", root, True, errs, mem_ids)
    for pg in _pages(pdir, "archive"):
        _check_file(pg, pdir, project, "page", "archived", root, False, errs, mem_ids)
    if r:
        linked = set(LINK_RE.findall(r[1]))
        for pg in pages:
            if pg.name not in linked:
                errs.append(f"сирота: pages/{pg.name} не упомянута в router")
        for name in sorted(linked):
            if not (pdir / "pages" / name).exists():
                errs.append(f"router ссылается на несуществующую pages/{name}")
    if mem_ids and db and Path(db).exists():
        try:
            con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
            ids = sorted({i for _, i in mem_ids})
            q = f"select id from observations where id in ({','.join('?' * len(ids))})"
            found = {row[0] for row in con.execute(q, ids)}
            con.close()
            for rel, i in mem_ids:
                if i not in found:
                    errs.append(f"{rel}: нет наблюдения mem:{i}")
        except sqlite3.Error:
            pass  # БД занята или битая — как при её отсутствии: проверку mem пропускаем, не валим прогон
    return errs


def missing_sources(pdir: Path, root: Path) -> list:
    out = []
    files = ([pdir / "router.md"] if (pdir / "router.md").exists() else []) + _pages(pdir, "pages")
    for f in files:
        meta, _ = parse_frontmatter(f.read_text(encoding="utf-8"))
        for s in (meta or {}).get("sources") or []:
            if "file" in s and not (root / s["file"]).exists():
                out.append(f"{f.relative_to(pdir)}: {s['file']}")
    return out


def archive_stale(pdir: Path, root: Path, today: date, days: int = 60) -> list:
    moved = []
    for pg in _pages(pdir, "pages"):
        text = pg.read_text(encoding="utf-8")
        meta, _ = parse_frontmatter(text)
        if not meta or not DATE_RE.fullmatch(str(meta.get("updated", ""))):
            continue
        files = [s["file"] for s in meta.get("sources") or [] if "file" in s]
        if not files or any((root / f).exists() for f in files):
            continue
        if date.fromisoformat(meta["updated"]) > today - timedelta(days=days):
            continue
        (pdir / "archive").mkdir(exist_ok=True)
        (pdir / "archive" / pg.name).write_text(
            text.replace("status: active", "status: archived", 1), encoding="utf-8")
        pg.unlink()
        moved.append(pg.name)
    if moved:
        router = pdir / "router.md"
        lines = router.read_text(encoding="utf-8").splitlines(keepends=True)
        router.write_text("".join(l for l in lines if not any(f"pages/{m}" in l for m in moved)),
                          encoding="utf-8")
    return moved


def main() -> int:
    if sys.argv[1:] != ["--all"]:
        print("usage: wiki_lint.py --all")
        return 2
    p = default_paths()
    bad = 0
    for pdir in sorted(d for d in p.wiki.iterdir() if d.is_dir() and not d.name.startswith(".")):
        errs = lint(pdir, pdir.name, p.home / pdir.name, p.db)
        for e in errs:
            print(f"{pdir.name}: {e}")
        bad += len(errs)
    print(f"ошибок: {bad}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
