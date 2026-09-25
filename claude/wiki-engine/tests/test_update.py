import json, sqlite3, subprocess, sys, tempfile, unittest
from datetime import date
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import wikilib as W
import wiki_update as U

NAME = "Лунная Станция"
TODAY = date(2026, 9, 25)


def good_runner(stage, root, delta, effort):
    proj = stage.name
    (stage / "pages").mkdir(exist_ok=True)
    (stage / "router.md").write_text(
        f"---\nproject: {proj}\nkind: router\nsummary: Платформа наблюдения за орбитой\nstatus: active\n"
        f"updated: 2026-09-25\nsources:\n  - file: app.py\n---\n# {proj}\n- [Датчики](pages/datchiki.md)\n",
        encoding="utf-8")
    (stage / "pages/datchiki.md").write_text(
        f"---\nproject: {proj}\nkind: page\ntitle: Датчики\nstatus: active\nupdated: 2026-09-25\n"
        f"sources:\n  - mem: 8030\n---\nMQTT\n", encoding="utf-8")
    good_runner.calls.append(effort)
    return 0, "ok"


def bad_runner(stage, root, delta, effort):
    (stage / "router.md").write_text("мусор без шапки\n")
    return 0, "ok"


class UpdateTest(unittest.TestCase):
    def setUp(self):
        t = Path(tempfile.mkdtemp())
        home = t / "home"
        for n in (NAME, "VPN"):
            (home / n).mkdir(parents=True)
            (home / n / "app.py").write_text("x")
        self.p = W.Paths(home=home, wiki=home / ".claude/wiki", state=home / ".claude/state/wiki", db=t / "m.db")
        con = sqlite3.connect(self.p.db)
        con.execute("create table observations(id integer, project text, type text, title text, facts text, "
                    "files_modified text, created_at text, created_at_epoch integer)")
        con.execute("create table session_summaries(id integer, project text, request text, learned text, "
                    "completed text, next_steps text, created_at text, created_at_epoch integer)")
        con.execute("insert into observations values (8030, ?, 'feature', 'Т', '[]', '[]', '2026-09-23', 1790000000000)", (NAME,))
        con.commit(); con.close()
        self.p.wiki.mkdir(parents=True)
        subprocess.run(["git", "init", "-q"], cwd=self.p.wiki, check=True)
        subprocess.run(["git", "config", "user.email", "wiki@local"], cwd=self.p.wiki, check=True)
        subprocess.run(["git", "config", "user.name", "wiki"], cwd=self.p.wiki, check=True)
        good_runner.calls = []

    def test_cyrillic_project_end_to_end(self):
        W.enqueue(self.p, NAME, str(self.p.home / NAME))
        self.assertEqual(U.run(self.p, runner=good_runner, today=TODAY, initial_budget=0), 0)
        self.assertTrue((self.p.wiki / NAME / "router.md").exists())
        self.assertEqual(good_runner.calls, ["medium"])
        idx = (self.p.wiki / "_index.md").read_text()
        self.assertIn(f"[{NAME}](<{NAME}/router.md>)", idx)
        self.assertIn("Платформа наблюдения за орбитой", idx)
        log = subprocess.run(["git", "log", "--oneline"], cwd=self.p.wiki, capture_output=True, text=True).stdout
        self.assertIn(f"wiki: {NAME}", log)
        st = W.load_state(self.p)[NAME]
        self.assertIn("last_ok_epoch", st)
        self.assertNotIn("last_error", st)

    def test_lint_failure_keeps_live(self):
        W.enqueue(self.p, NAME, "x")
        U.run(self.p, runner=good_runner, today=TODAY, initial_budget=0)
        before = (self.p.wiki / NAME / "router.md").read_text()
        U.run(self.p, rebuild=[NAME], runner=bad_runner, today=TODAY, initial_budget=0)  # провал 1 → в очередь
        for _ in range(3):  # провалы 2 и 3 из очереди; четвёртый прогон — очередь пуста, обнаружение пропускает
            U.run(self.p, runner=bad_runner, today=TODAY, initial_budget=0)
        self.assertEqual((self.p.wiki / NAME / "router.md").read_text(), before)
        st = W.load_state(self.p)[NAME]
        self.assertIn("frontmatter", st["last_error"])
        self.assertIn("модель: ok", st["last_error"])  # ответ модели виден в ошибке
        self.assertEqual(st["fail_streak"], 3)
        self.assertEqual(W.take_queue(self.p), [])  # после 3-го провала в очередь не возвращается
        self.assertFalse((self.p.staging / NAME).exists())

    def test_lint_errors_get_one_repair_pass(self):
        calls = []
        def runner(stage, root, delta, effort):
            calls.append((effort, delta))
            good_runner(stage, root, delta, effort)
            if len(calls) == 1:  # первый проход — router длиннее лимита символов
                r = stage / "router.md"
                r.write_text(r.read_text() + "я" * 2100 + "\n", encoding="utf-8")
            return 0, "ok"
        W.enqueue(self.p, NAME, "x")
        U.run(self.p, runner=runner, today=TODAY, initial_budget=0)
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[1][0], "low")
        self.assertIn("символов > 2000", calls[1][1])
        self.assertIn("на 20% ниже", calls[1][1])  # модель считает символы на глаз
        self.assertTrue((self.p.wiki / NAME / "router.md").exists())
        self.assertNotIn("last_error", W.load_state(self.p)[NAME])

    def test_model_archive_move_drops_page_copy(self):
        def runner(stage, root, delta, effort):
            good_runner(stage, root, delta, effort)
            (stage / "archive").mkdir(exist_ok=True)
            (stage / "archive/staraya.md").write_text(
                f"---\nproject: {stage.name}\nkind: page\ntitle: С\nstatus: archived\nupdated: 2026-09-25\n"
                f"sources:\n  - mem: 8030\n---\nт\n", encoding="utf-8")
            (stage / "pages/staraya.md").write_text("старая активная копия — модель не может её удалить\n")
            return 0, "ok"
        W.enqueue(self.p, NAME, "x")
        U.run(self.p, runner=runner, today=TODAY, initial_budget=0)
        self.assertTrue((self.p.wiki / NAME / "archive/staraya.md").exists())
        self.assertFalse((self.p.wiki / NAME / "pages/staraya.md").exists())

    def test_interrupted_swap_restores_old(self):
        W.enqueue(self.p, NAME, "x")
        U.run(self.p, runner=good_runner, today=TODAY, initial_budget=0)
        live = self.p.wiki / NAME
        live.rename(self.p.wiki / f".{NAME}.old")  # процесс умер между rename и move
        seen = []
        def runner(stage, root, delta, effort):
            seen.append((stage / "router.md").exists())
            return good_runner(stage, root, delta, effort)
        U.run(self.p, rebuild=[NAME], runner=runner, today=TODAY)
        self.assertEqual(seen, [True])
        self.assertTrue((live / "router.md").exists())

    def test_missing_root_skipped(self):
        W.enqueue(self.p, "Удалённый", "x")
        self.assertEqual(U.run(self.p, runner=good_runner, today=TODAY, initial_budget=0), 0)
        self.assertEqual(good_runner.calls, [])

    def test_no_changes_skips_model(self):
        W.enqueue(self.p, NAME, "x")
        U.run(self.p, runner=good_runner, today=TODAY, initial_budget=0)
        good_runner.calls = []
        st = W.load_state(self.p); st[NAME]["last_ok_epoch"] += 10**9; W.save_state(self.p, st)
        W.enqueue(self.p, NAME, "x")
        U.run(self.p, runner=good_runner, today=TODAY, initial_budget=0)
        self.assertEqual(good_runner.calls, [])

    def test_discovery_budget(self):
        U.run(self.p, runner=good_runner, today=TODAY, initial_budget=1)
        self.assertEqual(len(good_runner.calls), 1)

    def test_lock_busy(self):
        self.assertTrue(W.acquire_lock(self.p))
        W.enqueue(self.p, NAME, "x")
        self.assertEqual(U.run(self.p, runner=good_runner, today=TODAY), 0)
        self.assertEqual(good_runner.calls, [])
        W.release_lock(self.p)

    def test_manual_run_touches_only_named(self):
        W.enqueue(self.p, "VPN", "x")
        U.run(self.p, manual=[NAME], runner=good_runner, today=TODAY, initial_budget=3)
        self.assertEqual(len(good_runner.calls), 1)
        self.assertEqual(W.take_queue(self.p), ["VPN"])  # очередь осталась плановому прогону

    def test_last_run_written(self):
        U.run(self.p, runner=good_runner, today=TODAY, initial_budget=0)
        self.assertTrue(self.p.last_run.exists())


if __name__ == "__main__":
    unittest.main()
