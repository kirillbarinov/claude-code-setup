import subprocess, sys, tempfile, time, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import wikilib as W
import wiki_hook as H

NAME = "Лунная Станция"
ENGINE = Path(__file__).resolve().parent.parent


class HookTest(unittest.TestCase):
    def setUp(self):
        t = Path(tempfile.mkdtemp())
        home = t / "home"; (home / NAME / "web").mkdir(parents=True)
        self.p = W.Paths(home=home, wiki=home / ".claude/wiki", state=home / ".claude/state/wiki", db=t / "m.db")
        (self.p.wiki / NAME).mkdir(parents=True)
        (self.p.wiki / NAME / "router.md").write_text(
            f"---\nproject: {NAME}\nkind: router\nsummary: s\nstatus: active\nupdated: 2026-09-25\n"
            f"sources:\n  - file: a\n---\n# Маршрутизатор\n- [Д](pages/d.md)\n")

    def test_start_prints_router_body(self):
        out = H.start_text(self.p, str(self.p.home / NAME / "web"))
        self.assertIn("# Маршрутизатор", out)
        self.assertIn("2026-09-25", out)
        self.assertNotIn("sources:", out)
        self.assertIn("_index.md", out)

    def test_start_silent_elsewhere(self):
        self.assertEqual(H.start_text(self.p, str(self.p.home)), "")
        self.assertEqual(H.start_text(self.p, "/tmp"), "")

    def test_start_truncates_and_warns(self):
        (self.p.wiki / NAME / "router.md").write_text("---\nproject: x\n---\n" + "строка\n" * 1000)
        W.save_state(self.p, {NAME: {"last_error": "lint упал", "last_error_epoch": 5}})
        out = H.start_text(self.p, str(self.p.home / NAME))
        self.assertLessEqual(len(out), H.MAX_OUT)
        self.assertIn("обрезано", out)
        self.assertIn("lint упал", out)

    def test_cyrillic_router_within_limit_not_cut(self):
        body = "".join(f"- [Страница номер {i}](pages/p{i}.md) — описание страницы по-русски\n" for i in range(27))
        self.assertLess(len(body), 2000)
        (self.p.wiki / NAME / "router.md").write_text("---\nproject: x\n---\n" + body)
        out = H.start_text(self.p, str(self.p.home / NAME))
        self.assertIn("pages/p26.md", out)
        self.assertNotIn("обрезано", out)

    def test_enqueue(self):
        H.do_enqueue(self.p, str(self.p.home / NAME), {})
        H.do_enqueue(self.p, str(self.p.home / NAME), {"CLAUDE_WIKI_RUN": "1"})
        H.do_enqueue(self.p, str(self.p.home), {})
        self.assertEqual(W.take_queue(self.p), [NAME])

    def test_health(self):
        now = int(time.time())
        self.assertEqual(H.health_text(self.p, now), "")
        W.save_state(self.p, {NAME: {"last_error": "x", "last_error_epoch": now, "last_ok_epoch": now - 10}})
        W.enqueue(self.p, NAME, "x", now=now - 90000)
        out = H.health_text(self.p, now)
        self.assertIn(NAME, out)
        self.assertIn("24 ч", out)

    def test_health_writer_stale(self):
        now = int(time.time())
        self.p.state.mkdir(parents=True, exist_ok=True)
        self.p.last_run.write_text(str(now - 90000))
        self.assertIn("писатель", H.health_text(self.p, now))
        self.p.last_run.write_text(str(now - 60))
        self.assertEqual(H.health_text(self.p, now), "")

    def test_hook_never_raises(self):
        for arg in ["start", "enqueue", "health", "мусор"]:
            r = subprocess.run([sys.executable, str(ENGINE / "wiki_hook.py"), arg],
                               input="{битый json", capture_output=True, text=True,
                               env={"WIKI_HOME": "/nonexistent", "PATH": "/usr/bin:/bin"})
            self.assertEqual(r.returncode, 0, arg)
            self.assertEqual(r.stderr, "", arg)


if __name__ == "__main__":
    unittest.main()
