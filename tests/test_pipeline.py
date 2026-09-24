# -*- coding: utf-8 -*-
"""Unit tests for parsing, matching, stats and the shipped database. Stdlib only.

Run: python -m unittest discover -s tests
"""
import json, os, sqlite3, sys, unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

import analyze  # noqa: E402
import build_db  # noqa: E402
import extract_courses as ex  # noqa: E402
import fetch_reddit as fr  # noqa: E402

DB = os.path.join(ROOT, "data", "uwcourses.db")


def codes(text):
    return [key for _, key in (ex.canon(m.group(1), m.group(2))
                               for m in ex.CODE_RE.finditer(ex.join_multiword(text)))]


class ExtractTests(unittest.TestCase):
    def test_multiword_subjects(self):
        self.assertEqual(codes("我在上comp sci 300"), ["CS 300"])
        self.assertEqual(codes("poli sci 104 好水"), ["POLISCI 104"])
        self.assertEqual(codes("E C E 252 lab"), ["ECE 252"])
        self.assertEqual(codes("ed psych 301"), ["EDPSYCH 301"])

    def test_compact_and_alias_forms(self):
        self.assertEqual(codes("cs300很难"), ["CS 300"])
        self.assertEqual(codes("stats 240 和 Math 234"), ["STAT 240", "MATH 234"])

    def test_no_false_nutrisci(self):
        self.assertNotIn("NUTRISCI 300", codes("comp sci 300"))

    def test_not_part_of_longer_number(self):
        self.assertEqual(codes("room 12345"), [])


class ResolveTests(unittest.TestCase):
    def catalog(self):
        cs = {"subjectCode": "266", "shortDescription": "COMP SCI"}
        math = {"subjectCode": "600", "shortDescription": "MATH"}
        return [{"courseId": "011630", "catalogNumber": "240", "subject": cs, "allCrossListedSubjects": [cs, math]},
                {"courseId": "011630", "catalogNumber": "240", "subject": math, "allCrossListedSubjects": [cs, math]},
                {"courseId": "024510", "catalogNumber": "577", "subject": cs, "allCrossListedSubjects": []}]

    def test_crosslist_merge_and_reject(self):
        seeds = [{"code": "CS 240", "subj": "CS", "num": "240", "n": 5, "pos": 1, "neg": 0},
                 {"code": "MATH 240", "subj": "MATH", "num": "240", "n": 3, "pos": 0, "neg": 1},
                 {"code": "CS 577", "subj": "CS", "num": "577", "n": 9, "pos": 0, "neg": 0},
                 {"code": "MATH 999", "subj": "MATH", "num": "999", "n": 2, "pos": 0, "neg": 0}]
        with mock.patch.object(build_db.uwapi, "madgrades_course", return_value=[]):
            courses, rejected = build_db.resolve(seeds, self.catalog(), [])
        self.assertEqual(len(courses), 2)
        merged = courses["E011630"]
        self.assertEqual(merged["n"], 8)
        self.assertEqual(sorted(merged["seeds"]), ["CS 240", "MATH 240"])
        self.assertEqual(merged["abbr"], "COMP SCI")  # most-mentioned alias wins
        self.assertEqual([r["code"] for r in rejected], ["MATH 999"])


class StatsTests(unittest.TestCase):
    def test_gpa(self):
        g, n = analyze.gpa_of({"a": 1, "ab": 1, "b": 0, "bc": 0, "c": 0, "d": 0, "f": 1})
        self.assertAlmostEqual(g, 2.5)
        self.assertEqual(n, 3)
        self.assertEqual(analyze.gpa_of({k: 0 for k in analyze.PTS}), (None, 0))

    def test_terms(self):
        self.assertEqual(analyze.term_label(1264), "Spring 2026")
        self.assertEqual(analyze.term_label(1262), "Fall 2025")
        self.assertLess(analyze.term_year(1262), analyze.term_year(1264))
        self.assertLess(analyze.term_year(1264), analyze.term_year(1266))

    def test_ranks_ties(self):
        self.assertEqual(analyze.ranks([10, 20, 20, 30]), [1, 2.5, 2.5, 4])

    def test_spearman(self):
        x = list(range(20))
        self.assertEqual(analyze.spearman(x, [v * v for v in x])["rho"], 1.0)
        self.assertEqual(analyze.spearman(x, [-v for v in x])["rho"], -1.0)
        self.assertLess(analyze.spearman(x, [v * v for v in x], perms=200)["p"], 0.02)
        self.assertIsNone(analyze.spearman([1, 2], [3, 4]))

    def test_wls_slope(self):
        self.assertAlmostEqual(analyze.wls_slope([0, 1, 2], [1, 2, 3], [1, 5, 1]), 1.0)


class RedditTests(unittest.TestCase):
    def test_year_monotonic(self):
        years = [fr.post_year(p) for p in ["5l3qwg", "d8ymqq", "18t7mby", "1f1b25n", "1plbgr8"]]
        self.assertEqual(years, sorted(years))
        self.assertEqual(fr.post_year("1plbgr8"), 2025)

    def test_tone(self):
        self.assertEqual(fr.tone("Is STAT 240 an easy A?"), 1)
        self.assertEqual(fr.tone("Failing CS 577, am I cooked"), -1)
        self.assertEqual(fr.tone("CS 577 textbook"), 0)


@unittest.skipUnless(os.path.exists(DB), "database not built")
class DatabaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = sqlite3.connect(DB)

    @classmethod
    def tearDownClass(cls):
        cls.db.close()

    def q(self, sql):
        return self.db.execute(sql).fetchall()

    def test_integrity(self):
        self.assertEqual(self.q("PRAGMA foreign_key_check"), [])
        self.assertEqual(self.q("PRAGMA integrity_check"), [("ok",)])

    def test_every_course_has_mentions_and_stats(self):
        self.assertEqual(self.q("SELECT COUNT(*) FROM courses c LEFT JOIN chat_mentions m ON m.course_id=c.id "
                                "WHERE m.course_id IS NULL"), [(0,)])
        self.assertEqual(self.q("SELECT COUNT(*) FROM courses WHERE id NOT IN (SELECT course_id FROM course_stats)"),
                         [(0,)])

    def test_grade_bounds(self):
        self.assertEqual(self.q("SELECT COUNT(*) FROM course_stats WHERE gpa < 0 OR gpa > 4 OR pct_a > 1"), [(0,)])
        self.assertEqual(self.q("SELECT COUNT(*) FROM grade_terms WHERE a+ab+b+bc+c+d+f > total"), [(0,)])

    def test_no_personal_fields(self):
        cols = {r[1] for t in ("chat_mentions", "reddit_threads") for r in self.q(f"PRAGMA table_info({t})")}
        for bad in ("author", "user", "username", "sender", "wxid", "message", "text", "body"):
            self.assertNotIn(bad, cols)

    def test_seed_file_is_aggregate_only(self):
        with open(os.path.join(ROOT, "courses.json"), encoding="utf-8") as f:
            rows = json.load(f)
        allowed = {"code", "subj", "num", "n", "pos", "neg", "mg", "people"}
        for r in rows:
            self.assertLessEqual(set(r), allowed)


if __name__ == "__main__":
    unittest.main()
