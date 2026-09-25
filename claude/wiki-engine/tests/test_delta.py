import sqlite3, subprocess, sys, tempfile, time, unittest
from datetime import date
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import wikilib as W
import wiki_delta as D

NAME = "Лунная Станция"


def mkdb(path: Path, rows):
    con = sqlite3.connect(path)
    con.execute("create table observations(id integer, project text, type text, title text, "
                "facts text, files_modified text, created_at text, created_at_epoch integer)")
    con.execute("create table session_summaries(id integer, project text, request text, learned text, "
                "completed text, next_steps text, created_at text, created_at_epoch integer)")
    for r in rows:
        con.execute("insert into observations values (?,?,?,?,?,?,?,?)", r)
    con.execute("insert into session_summaries values (1,?,?,?,?,?,?,?)",
                (NAME, "починить тарировку", "кривая кусочно-линейная", "готово", "", "2026-09-23", 1790000000000))
    con.commit(); con.close()


class DeltaTest(unittest.TestCase):
    def setUp(self):
        t = Path(tempfile.mkdtemp())
        home = t / "home"
        self.root = home / NAME
        (self.root / ".claude").mkdir(parents=True)
        (self.root / ".claude/STATE.md").write_text("# Состояние\nдатчики на MQTT\n")
        (self.root / "web").mkdir()
        (self.root / "web/CLAUDE.md").write_text("<!-- КАРТА:НАЧАЛО x -->\nкарта\n<!-- КАРТА:КОНЕЦ -->\n")
        (self.root / "node_modules/x").mkdir(parents=True)
        (self.root / "app.py").write_text("print(1)")
        (home / "VPN").mkdir()
        self.p = W.Paths(home=home, wiki=home / ".claude/wiki", state=home / ".claude/state/wiki",
                         db=t / "mem.db")
        mkdb(self.p.db, [
            (8030, NAME, "feature", "Тарировка", '["кусочно-линейная"]', '["cal.py"]', "2026-09-23", 1790000000000),
            (8031, "someuser/" + NAME, "discovery", "Вложенное имя", "[]", "[]", "2026-09-23", 1790000001000),
            (9000, "VPN", "feature", "Чужое", "[]", "[]", "2026-09-23", 1790000000000),
            (9001, "Нет папки", "feature", "x", "[]", "[]", "2026-09-23", 1790000000000),
        ])
        self.stage = t / "stage"; self.stage.mkdir()

    def test_initial_delta(self):
        d = D.build_delta(self.p, NAME, self.root, 0, self.stage, True, date(2026, 9, 25))
        self.assertEqual(d.n_obs, 2)
        for s in ["первичная сборка", "Тарировка", "mem:8030", "mem:8031", "датчики на MQTT",
                  "web/CLAUDE.md", "кривая кусочно-линейная", "app.py"]:
            self.assertIn(s, d.text, s)
        self.assertNotIn("Чужое", d.text)
        self.assertNotIn("node_modules", d.text)

    def test_since_filters(self):
        d = D.build_delta(self.p, NAME, self.root, 1790000000, self.stage, False, date(2026, 9, 25))
        self.assertEqual(d.n_obs, 1)
        self.assertNotIn("датчики на MQTT", d.text)  # STATE.md только при первичной сборке

    def test_changed_files_non_git(self):
        since = int(time.time()) - 60
        d = D.build_delta(self.p, NAME, self.root, since, self.stage, False, date(2026, 9, 25))
        self.assertGreaterEqual(d.n_files, 1)
        self.assertIn("app.py", d.text)

    def test_changed_files_git(self):
        subprocess.run(["git", "init", "-q"], cwd=self.root, check=True)
        subprocess.run(["git", "-c", "user.email=t@t", "-c", "user.name=t", "add", "app.py"], cwd=self.root, check=True)
        subprocess.run(["git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "x"], cwd=self.root, check=True)
        d = D.build_delta(self.p, NAME, self.root, int(time.time()) - 3600, self.stage, False, date(2026, 9, 25))
        self.assertIn("app.py", d.text)

    def test_git_cyrillic_paths_readable(self):
        (self.root / "Отчёт.md").write_text("x")
        g = ["git", "-c", "user.email=t@t", "-c", "user.name=t"]
        subprocess.run(["git", "init", "-q"], cwd=self.root, check=True)
        subprocess.run(g + ["add", "Отчёт.md"], cwd=self.root, check=True)
        subprocess.run(g + ["commit", "-qm", "x"], cwd=self.root, check=True)
        d = D.build_delta(self.p, NAME, self.root, int(time.time()) - 3600, self.stage, False, date(2026, 9, 25))
        self.assertIn("- Отчёт.md", d.text)

    def test_empty(self):
        d = D.build_delta(self.p, NAME, self.root, int(time.time()) + 10, self.stage, False, date(2026, 9, 25))
        self.assertTrue(d.empty)

    def test_delta_without_db(self):
        self.p = W.Paths(home=self.p.home, wiki=self.p.wiki, state=self.p.state, db=self.p.home / "nope.db")
        d = D.build_delta(self.p, NAME, self.root, 0, self.stage, True, date(2026, 9, 25))
        self.assertEqual(d.n_obs, 0)
        self.assertIn("claude-mem недоступна", d.text)

    def test_discover(self):
        self.assertEqual(sorted(D.discover_projects(self.p)), sorted([NAME, "VPN"]))


if __name__ == "__main__":
    unittest.main()
