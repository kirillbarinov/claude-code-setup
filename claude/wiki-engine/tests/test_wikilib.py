import os, sys, tempfile, time, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import wikilib as W


def make_paths(tmp: Path) -> W.Paths:
    home = tmp / "home"
    (home / "Лунная Станция" / "web").mkdir(parents=True)
    (home / "VPN").mkdir()
    (home / ".claude").mkdir()
    (home / "Library").mkdir()
    return W.Paths(home=home, wiki=home / ".claude/wiki", state=home / ".claude/state/wiki",
                   db=home / ".claude-mem/claude-mem.db")


class ProjectFor(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.p = make_paths(self.tmp)

    def test_top_level_and_nested_collapse(self):
        self.assertEqual(W.project_for(str(self.p.home / "Лунная Станция" / "web"), self.p), "Лунная Станция")
        self.assertEqual(W.project_for(str(self.p.home / "VPN"), self.p), "VPN")

    def test_not_projects(self):
        for cwd in [self.p.home, self.p.home / ".claude", self.p.home / "Library", Path("/tmp")]:
            self.assertIsNone(W.project_for(str(cwd), self.p), cwd)

    def test_exclude_file(self):
        self.p.wiki.mkdir(parents=True)
        (self.p.wiki / "_exclude.txt").write_text("# comment\nVPN\n")
        self.assertIsNone(W.project_for(str(self.p.home / "VPN"), self.p))

    def test_missing_dir(self):
        self.assertIsNone(W.project_for(str(self.p.home / "Нет такого"), self.p))


class StagingOutsideClaude(unittest.TestCase):
    def test_default_staging_not_under_dot_claude(self):
        # Claude Code в -p режиме молча отказывает в записи в любые .claude/ — черновик должен лежать вне
        self.assertNotIn(".claude", W.default_paths().staging.parts)


class Frontmatter(unittest.TestCase):
    def test_parse(self):
        text = ("---\nproject: Лунная Станция\nkind: page\ntitle: Датчики # коммент\nstatus: active\n"
                "updated: 2026-09-25\nsources:\n  - file: a/b.py\n  - mem: 8030\n---\nтело\nещё\n")
        meta, body = W.parse_frontmatter(text)
        self.assertEqual(meta["project"], "Лунная Станция")
        self.assertEqual(meta["title"], "Датчики")
        self.assertEqual(meta["sources"], [{"file": "a/b.py"}, {"mem": "8030"}])
        self.assertEqual(body, "тело\nещё\n")
        self.assertEqual(W.body_lines(text), 2)

    def test_missing_or_broken(self):
        self.assertEqual(W.parse_frontmatter("без шапки")[0], None)
        self.assertEqual(W.parse_frontmatter("---\nплохая строка\n---\n")[0], None)
        self.assertEqual(W.parse_frontmatter("---\n  - file: x\n---\n")[0], None)


class StateQueueLock(unittest.TestCase):
    def setUp(self):
        self.p = make_paths(Path(tempfile.mkdtemp()))

    def test_state_roundtrip(self):
        self.assertEqual(W.load_state(self.p), {})
        W.save_state(self.p, {"VPN": {"last_ok_epoch": 5}})
        self.assertEqual(W.load_state(self.p)["VPN"]["last_ok_epoch"], 5)

    def test_queue_dedup_and_order(self):
        W.enqueue(self.p, "VPN", "/x", now=10)
        W.enqueue(self.p, "Лунная Станция", "/y", now=11)
        W.enqueue(self.p, "VPN", "/x", now=12)
        self.assertEqual(W.oldest_queued(self.p), 10)
        self.assertEqual(W.take_queue(self.p), ["VPN", "Лунная Станция"])
        self.assertEqual(W.take_queue(self.p), [])
        self.assertIsNone(W.oldest_queued(self.p))

    def test_lock(self):
        self.assertTrue(W.acquire_lock(self.p))
        self.assertFalse(W.acquire_lock(self.p))
        W.release_lock(self.p)
        self.assertTrue(W.acquire_lock(self.p))
        W.release_lock(self.p)

    def test_stale_lock_taken_over(self):
        self.p.lock.mkdir(parents=True)
        (self.p.lock / "pid").write_text("999999")
        old = time.time() - 3600
        os.utime(self.p.lock, (old, old))
        self.assertTrue(W.acquire_lock(self.p))
        W.release_lock(self.p)


if __name__ == "__main__":
    unittest.main()
