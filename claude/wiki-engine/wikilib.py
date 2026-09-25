"""Общие части авто-вики: пути, проект по cwd, frontmatter, состояние, очередь, замок."""
import json
import os
import re
import shutil
import time
from dataclasses import dataclass
from pathlib import Path

NOT_PROJECTS = {"Library", "Applications", "Documents", "Desktop", "Downloads",
                "Movies", "Music", "Pictures", "Public"}
FM_RE = re.compile(r"\A---\n(.*?)\n---\n?", re.S)


@dataclass(frozen=True)
class Paths:
    home: Path
    wiki: Path
    state: Path
    db: Path
    stage_root: Path | None = None  # None → state/staging (тесты); боевой — вне ~/.claude

    @property
    def queue(self) -> Path: return self.state / "queue.tsv"
    @property
    def projects_json(self) -> Path: return self.state / "projects.json"
    @property
    def lock(self) -> Path: return self.state / "lock"
    @property
    def staging(self) -> Path: return self.stage_root or self.state / "staging"
    @property
    def last_run(self) -> Path: return self.state / "last_run"
    @property
    def log_file(self) -> Path: return self.state / "update.log"


def default_paths() -> Paths:
    home = Path(os.environ.get("WIKI_HOME", str(Path.home())))
    return Paths(
        home=home,
        wiki=Path(os.environ.get("WIKI_ROOT", str(home / ".claude/wiki"))),
        state=Path(os.environ.get("WIKI_STATE", str(home / ".claude/state/wiki"))),
        db=Path(os.environ.get("WIKI_MEM_DB", str(home / ".claude-mem/claude-mem.db"))),
        # Claude Code в -p молча запрещает запись в любые .claude/ — черновик писателя живёт вне
        stage_root=Path(os.environ.get("WIKI_STAGING", str(home / "Library/Caches/claude-wiki/staging"))),
    )


def read_exclude(p: Paths) -> set:
    f = p.wiki / "_exclude.txt"
    if not f.exists():
        return set()
    return {l.strip() for l in f.read_text(encoding="utf-8").splitlines()
            if l.strip() and not l.lstrip().startswith("#")}


def project_for(cwd: str, p: Paths):
    try:
        rel = Path(cwd).resolve().relative_to(p.home.resolve())
    except (ValueError, OSError):
        return None
    if not rel.parts:
        return None
    first = rel.parts[0]
    if first.startswith(".") or first in NOT_PROJECTS or first in read_exclude(p):
        return None
    if not (p.home / first).is_dir():
        return None
    return first


def parse_frontmatter(text: str):
    m = FM_RE.match(text)
    if not m:
        return None, text
    meta, cur = {}, None
    for line in m.group(1).splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if line.lstrip().startswith("- "):
            if cur is None:
                return None, text
            k, sep, v = line.strip()[2:].partition(":")
            if not sep:
                return None, text
            cur.append({k.strip(): v.split(" #")[0].strip()})
            continue
        k, sep, v = line.partition(":")
        if not sep or line[:1].isspace():
            return None, text
        v = v.split(" #")[0].strip()
        if v == "":
            meta[k.strip()] = []
            cur = meta[k.strip()]
        else:
            meta[k.strip()] = v
            cur = None
    return meta, text[m.end():]


def body_lines(text: str) -> int:
    _, body = parse_frontmatter(text)
    return len(body.splitlines())


def load_state(p: Paths) -> dict:
    try:
        return json.loads(p.projects_json.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_state(p: Paths, st: dict) -> None:
    p.state.mkdir(parents=True, exist_ok=True)
    tmp = p.projects_json.with_suffix(".tmp")
    tmp.write_text(json.dumps(st, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, p.projects_json)


def enqueue(p: Paths, project: str, cwd: str, now=None) -> None:
    p.state.mkdir(parents=True, exist_ok=True)
    with open(p.queue, "a", encoding="utf-8") as f:
        f.write(f"{int(now if now is not None else time.time())}\t{project}\t{cwd}\n")


def _read_queue(path: Path) -> list:
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        parts = line.split("\t")
        if len(parts) >= 2 and parts[0].isdigit():
            rows.append((int(parts[0]), parts[1]))
    return rows


def take_queue(p: Paths) -> list:
    if not p.queue.exists():
        return []
    taking = p.queue.with_name(f"queue.taking.{os.getpid()}")
    os.replace(p.queue, taking)
    names = []
    for _, name in _read_queue(taking):
        if name not in names:
            names.append(name)
    taking.unlink()
    return names


def oldest_queued(p: Paths):
    if not p.queue.exists():
        return None
    rows = _read_queue(p.queue)
    return min(r[0] for r in rows) if rows else None


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def acquire_lock(p: Paths) -> bool:
    p.state.mkdir(parents=True, exist_ok=True)
    try:
        p.lock.mkdir()
    except FileExistsError:
        try:
            pid = int((p.lock / "pid").read_text())
        except (OSError, ValueError):
            pid = 0
        young = time.time() - p.lock.stat().st_mtime < 60
        if (pid and _alive(pid)) or (not pid and young):
            return False
        shutil.rmtree(p.lock, ignore_errors=True)
        try:
            p.lock.mkdir()
        except FileExistsError:
            return False
    (p.lock / "pid").write_text(str(os.getpid()))
    return True


def release_lock(p: Paths) -> None:
    shutil.rmtree(p.lock, ignore_errors=True)


def log(p: Paths, msg: str) -> None:
    p.state.mkdir(parents=True, exist_ok=True)
    with open(p.log_file, "a", encoding="utf-8") as f:
        f.write(time.strftime("[%F %T] ") + msg + "\n")
