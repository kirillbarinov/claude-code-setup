import sqlite3, sys, tempfile, unittest
from datetime import date
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import wiki_lint as L

PROJ = "Лунная Станция"


def fm(kind, status="active", sources="  - file: src/main.py\n", extra="", updated="2026-09-25"):
    return (f"---\nproject: {PROJ}\nkind: {kind}\n{extra}status: {status}\n"
            f"updated: {updated}\nsources:\n{sources}---\n")


class LintBase(unittest.TestCase):
    def setUp(self):
        t = Path(tempfile.mkdtemp())
        self.root = t / "root"; (self.root / "src").mkdir(parents=True)
        (self.root / "src/main.py").write_text("x")
        self.pdir = t / "wiki" / PROJ; (self.pdir / "pages").mkdir(parents=True)
        self.db = t / "mem.db"
        con = sqlite3.connect(self.db); con.execute("create table observations(id integer)")
        con.execute("insert into observations values (8030)"); con.commit(); con.close()
        self.write_ok()

    def write_ok(self):
        (self.pdir / "router.md").write_text(
            fm("router", extra="summary: Платформа\n") + "# Router\n- [Датчики](pages/datchiki.md)\n")
        (self.pdir / "pages/datchiki.md").write_text(
            fm("page", extra="title: Датчики\n", sources="  - file: src/main.py\n  - mem: 8030\n") + "текст\n")

    def errs(self):
        return L.lint(self.pdir, PROJ, self.root, self.db)


class Lint(LintBase):
    def test_ok(self):
        self.assertEqual(self.errs(), [])

    def test_no_router(self):
        (self.pdir / "router.md").unlink()
        self.assertTrue(any("router.md" in e for e in self.errs()))

    def test_bad_frontmatter(self):
        (self.pdir / "pages/datchiki.md").write_text("просто текст\n")
        self.assertTrue(any("frontmatter" in e for e in self.errs()))

    def test_wrong_project(self):
        (self.pdir / "pages/datchiki.md").write_text(
            fm("page", extra="title: X\n").replace(PROJ, "VPN") + "т\n")
        self.assertTrue(any("project" in e for e in self.errs()))

    def test_router_needs_summary(self):
        (self.pdir / "router.md").write_text(fm("router") + "- [Д](pages/datchiki.md)\n")
        self.assertTrue(any("summary" in e for e in self.errs()))

    def test_router_too_long(self):
        (self.pdir / "router.md").write_text(
            fm("router", extra="summary: s\n") + "- [Д](pages/datchiki.md)\n" + "x\n" * 40)
        self.assertTrue(any("> 40" in e for e in self.errs()))

    def test_router_too_many_chars(self):
        (self.pdir / "router.md").write_text(
            fm("router", extra="summary: s\n") + "- [Д](pages/datchiki.md)\n" + "я" * 2001 + "\n")
        self.assertTrue(any("символов > 2000" in e for e in self.errs()))

    def test_page_too_long(self):
        (self.pdir / "pages/datchiki.md").write_text(fm("page", extra="title: Д\n") + "x\n" * 151)
        self.assertTrue(any("> 150" in e for e in self.errs()))

    def test_too_many_pages(self):
        links = ""
        for i in range(16):
            (self.pdir / f"pages/p{i}.md").write_text(fm("page", extra="title: t\n") + "т\n")
            links += f"- [t](pages/p{i}.md)\n"
        (self.pdir / "router.md").write_text(fm("router", extra="summary: s\n") + links + "- [Д](pages/datchiki.md)\n")
        self.assertTrue(any("страниц" in e and "> 15" in e for e in self.errs()))

    def test_missing_file_source(self):
        (self.pdir / "pages/datchiki.md").write_text(
            fm("page", extra="title: Д\n", sources="  - file: src/nope.py\n") + "т\n")
        self.assertTrue(any("src/nope.py" in e for e in self.errs()))

    def test_missing_mem_source(self):
        (self.pdir / "pages/datchiki.md").write_text(
            fm("page", extra="title: Д\n", sources="  - mem: 1\n") + "т\n")
        self.assertTrue(any("mem:1" in e for e in self.errs()))

    def test_broken_db_skips_mem_check(self):
        self.db.write_bytes(b"not a sqlite database at all" * 10)
        self.assertEqual(self.errs(), [])

    def test_secrets_rejected(self):
        for s in ["sk-" + "ant-api03-AbCdEfGhIjKlMnOpQrSt", "-----BEGIN OPENSSH PRIVATE KEY-----",
                  "PASSWORD=hunter2value", "gh" + "p_abcdefghijklmnopqrstuvwxyz0123456789"]:
            (self.pdir / "pages/datchiki.md").write_text(fm("page", extra="title: Д\n") + f"ключ {s}\n")
            self.assertTrue(any("секрет" in e for e in self.errs()), s)

    def test_secret_names_allowed(self):
        (self.pdir / "pages/datchiki.md").write_text(
            fm("page", extra="title: Д\n") + "Пароль в `.env`: `PASSWORD=` (значение не в вики), `$DB_PASSWORD`\n")
        self.assertEqual(self.errs(), [])

    def test_orphan_and_dangling(self):
        (self.pdir / "pages/lishnyaya.md").write_text(fm("page", extra="title: Л\n") + "т\n")
        (self.pdir / "router.md").write_text(
            fm("router", extra="summary: s\n") + "- [Д](pages/datchiki.md)\n- [Н](pages/net.md)\n")
        e = self.errs()
        self.assertTrue(any("сирота" in x and "lishnyaya" in x for x in e))
        self.assertTrue(any("net.md" in x for x in e))

    def test_extra_file_and_bad_name(self):
        (self.pdir / "notes.txt").write_text("x")
        (self.pdir / "pages/Датчики.md").write_text(fm("page", extra="title: Д\n") + "т\n")
        e = self.errs()
        self.assertTrue(any("notes.txt" in x for x in e))
        self.assertTrue(any("Датчики.md" in x for x in e))

    def test_status_by_folder(self):
        (self.pdir / "pages/datchiki.md").write_text(fm("page", status="archived", extra="title: Д\n") + "т\n")
        self.assertTrue(any("active" in e for e in self.errs()))

    def test_archive_sources_not_checked(self):
        (self.pdir / "archive").mkdir()
        (self.pdir / "archive/old.md").write_text(
            fm("page", status="archived", extra="title: O\n", sources="  - file: gone.py\n") + "т\n")
        self.assertEqual(self.errs(), [])


class Archive(LintBase):
    def test_archive_stale(self):
        (self.pdir / "pages/staraya.md").write_text(
            fm("page", extra="title: С\n", sources="  - file: gone.py\n", updated="2026-06-01") + "т\n")
        (self.pdir / "router.md").write_text(
            fm("router", extra="summary: s\n") + "- [Д](pages/datchiki.md)\n- [С](pages/staraya.md)\n")
        moved = L.archive_stale(self.pdir, self.root, date(2026, 9, 25))
        self.assertEqual(moved, ["staraya.md"])
        self.assertIn("status: archived", (self.pdir / "archive/staraya.md").read_text())
        self.assertNotIn("staraya", (self.pdir / "router.md").read_text())
        self.assertEqual(self.errs(), [])

    def test_fresh_or_sourced_kept(self):
        (self.pdir / "pages/svezhaya.md").write_text(
            fm("page", extra="title: С\n", sources="  - file: gone.py\n", updated="2026-09-01") + "т\n")
        self.assertEqual(L.archive_stale(self.pdir, self.root, date(2026, 9, 25)), [])
        self.assertEqual(L.missing_sources(self.pdir, self.root), ["pages/svezhaya.md: gone.py"])


if __name__ == "__main__":
    unittest.main()
