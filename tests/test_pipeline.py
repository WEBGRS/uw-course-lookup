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
import fetch_programs as fp  # noqa: E402
import fetch_reddit as fr  # noqa: E402
import offerings  # noqa: E402

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


class CatalogTierTests(unittest.TestCase):
    def test_compact_grades_sums_per_term_and_instructor(self):
        g = {"courseOfferings": [{"termCode": 1264, "cumulative": {"aCount": 5, "total": 8}, "sections": [
            {"sectionNumber": 1, "aCount": 2, "total": 4, "instructors": [{"id": 7, "name": "A B"}]},
            {"sectionNumber": 2, "aCount": 3, "total": 4, "instructors": [{"id": 7, "name": "A B"}, {"id": 9, "name": "C D"}]}]}]}
        terms, per = build_db.compact_grades(g)
        self.assertEqual([t for t, _ in terms], [1264])
        self.assertEqual(per[(1264, 7)], ["A B", 5, 0, 0, 0, 0, 0, 0, 8])
        self.assertEqual(per[(1264, 9)][1], 3)
        self.assertEqual(build_db.compact_grades(None), ([], {}))

    def test_catalog_tier_skips_tracked_designations(self):
        def hit(cid, num):
            return {"courseId": cid, "catalogNumber": num, "subject": {"subjectCode": "266", "shortDescription": "COMP SCI"}}
        have = {"E1": {"abbr": "COMP SCI", "num": "300"}}
        out = build_db.catalog_tier([hit("1", "300"), hit("2", "300"), hit("3", "400"), hit("4", "400")], have)
        self.assertEqual(list(out), ["E3"])  # E2 repeats a tracked code, E4 repeats E3's
        self.assertEqual(out["E3"]["source"], "catalog")


class RedditTests(unittest.TestCase):
    def test_year_monotonic(self):
        years = [fr.post_year(p) for p in ["5l3qwg", "d8ymqq", "18t7mby", "1f1b25n", "1plbgr8"]]
        self.assertEqual(years, sorted(years))
        self.assertEqual(fr.post_year("1plbgr8"), 2025)

    def test_clean_title(self):
        self.assertEqual(fr.clean_title("Could I repeat Music 113 three times? - Reddit"), "Could I repeat Music 113 three times?")
        self.assertEqual(fr.clean_title("r/UWMadison on Reddit: Thoughts on Comp Sci 200?"), "Thoughts on Comp Sci 200?")
        self.assertEqual(fr.clean_title("Got put on academic probation because I got a ..."), "Got put on academic probation because I got a…")
        self.assertEqual(fr.clean_title("Math 234 Tips : r/UWMadison"), "Math 234 Tips")

    def test_tone(self):
        self.assertEqual(fr.tone("Is STAT 240 an easy A?"), 1)
        self.assertEqual(fr.tone("Failing CS 577, am I cooked"), -1)
        self.assertEqual(fr.tone("CS 577 textbook"), 0)


def meeting(days, start_ms, end_ms, kind="CLASS"):
    return {"meetingType": kind, "meetingDays": days, "meetingTimeStart": start_ms, "meetingTimeEnd": end_ms,
            "building": {"buildingName": "Chemistry Building"}, "room": "S413"}


class OfferingsTests(unittest.TestCase):
    TERM_START = 1788325200000  # 2026-09-02 05:00 UTC = local midnight in Madison (UTC-5)

    def section(self, type_, num, meetings, start=TERM_START, end=1796796000000, consent="N", mode="Classroom Instruction"):
        return {"type": type_, "sectionNumber": num, "classMeetings": meetings, "startDate": start, "endDate": end,
                "addConsent": {"code": consent}, "instructionMode": mode, "instructors": [{"name": {"first": "Ada", "last": "Lovelace"}}]}

    def package(self, pid, sections, status="OPEN", seats=5):
        return {"id": pid, "published": True, "sections": sections,
                "packageEnrollmentStatus": {"status": status, "availableSeats": seats, "waitlistTotal": 0}}

    def test_times_become_local_minutes(self):
        # Verified on the official site: 19:00-20:15 "UTC" on Tue/Thu is shown as 1:00-2:15 PM
        m = offerings.meeting(meeting("TR", 68400000, 72900000))
        self.assertEqual(m, ["TR", 780, 855, "Chemistry Building S413"])
        self.assertIsNone(offerings.meeting(meeting(None, 83100000, 90300000, "EXAM")))

    def test_offset_is_fixed_central_standard_time(self):
        self.assertEqual(offerings.local_offset_ms({"startDate": self.TERM_START}), 6 * 3600000)   # even in a September (daylight) term
        self.assertEqual(offerings.local_offset_ms({"startDate": self.TERM_START + 3600000}), 6 * 3600000)

    def test_compact_package(self):
        lec = self.section("LEC", "002", [meeting("TR", 68400000, 72900000)])
        dis = self.section("DIS", "323", [meeting("W", 81300000, 84300000)])
        base = offerings.dominant_range([self.package("1", [lec, dis])])
        out = offerings.compact([self.package("1", [lec, dis], "WAITLISTED", 0)], base)
        self.assertEqual(out[0]["st"], "W")
        self.assertEqual(out[0]["s"][0]["m"], [["TR", 780, 855, "Chemistry Building S413"]])
        self.assertEqual(out[0]["s"][0]["i"], ["Ada Lovelace"])
        self.assertNotIn("w", out[0]["s"][0])       # full-term sections carry no date range
        self.assertNotIn("on", out[0])

    def test_package_ids_stay_unique_and_sections_keep_class_numbers(self):
        # one discussion (class 21095) can pair with two lectures: the numeric package id repeats, the docId does not
        def pkg(doc, lec_no):
            lec = self.section("LEC", lec_no, [meeting("MW", 53400000, 56400000)])
            lec["classUniqueId"] = {"classNumber": 21091 if lec_no == "002" else 12586}
            dis = self.section("DIS", "325", [meeting("R", 73500000, 76500000)])
            dis["classUniqueId"] = {"classNumber": 21095}
            return {**self.package("21095", [lec, dis]), "docId": doc}
        out = offerings.compact([pkg("1272-A1-156-105-002-325", "002"), pkg("1272-A1-156-105-001-325", "001")], None)
        self.assertEqual(len({p["id"] for p in out}), 2)
        self.assertEqual([[s["k"] for s in p["s"]] for p in out], [[21091, 21095], [12586, 21095]])

    def test_part_term_sections_keep_their_dates(self):
        full = self.section("LEC", "1", [meeting("M", 68400000, 72900000)])
        half = self.section("LEC", "2", [meeting("M", 68400000, 72900000)], start=self.TERM_START + 47 * 86400000)
        base = offerings.dominant_range([self.package("1", [full]), self.package("2", [full]), self.package("3", [half])])
        out = offerings.compact([self.package("3", [half])], base)
        self.assertEqual(out[0]["s"][0]["w"][0], (self.TERM_START + 47 * 86400000) // 86400000)

    def test_consent_only_rows_collapse_to_one_marker(self):
        ind = lambda n: self.package(str(n), [self.section("IND", str(n), [], consent="I")])
        out = offerings.compact([ind(1), ind(2), ind(3)], None)
        self.assertEqual(len(out), 1)
        self.assertEqual((out[0]["c"], out[0]["on"]), (1, 1))
        # a real timed section is never dropped
        timed = self.package("9", [self.section("LEC", "1", [meeting("M", 68400000, 72900000)], consent="D")])
        self.assertEqual(len(offerings.compact([ind(1), timed], None)), 1)


class ProgramParseTests(unittest.TestCase):
    HTML = """<html><body><h1>Guide</h1><h1 class="page-title">Toy Science, BS</h1>
    <h2 name="requirementstext">University Requirements</h2>
    <h2 name="requirementstext">Requirements for the Major</h2>
    <h3>Core</h3>
    <table class="sc_courselist"><tbody>
      <tr><td class="codecol"><a class="bubblelink code" title="COMP SCI/​MATH 240">COMP SCI/MATH 240</a></td><td>Discrete</td><td class="hourscol">3</td></tr>
      <tr><td class="codecol"><a class="bubblelink code" title="COMP SCI 300">COMP SCI 300</a></td><td>Programming II</td><td class="hourscol">3</td></tr>
      <tr class="listsum"><td colspan="2">Total Credits</td><td class="hourscol">6</td></tr></tbody></table>
    <h3>Linear Algebra<sup>1</sup></h3>
    <table class="sc_courselist"><tbody>
      <tr><td colspan="2"><span class="courselistcomment">Complete one:</span></td><td class="hourscol"></td></tr>
      <tr><td class="codecol"><a class="bubblelink code" title="MATH 320">MATH 320</a></td><td>LA+DE</td><td class="hourscol">3</td></tr>
      <tr class="orclass"><td class="codecol"><a class="bubblelink code" title="MATH 340">MATH 340</a></td><td>Matrix</td><td class="hourscol">3</td></tr>
      <tr><td class="codecol"><a class="bubblelink code" title="MATH 341">MATH 341</a></td><td>Linear Algebra</td><td class="hourscol">3</td></tr></tbody></table>
    <h2 name="requirementstext">Honors in the Major</h2>
    <table class="sc_courselist"><tbody><tr><td class="codecol"><a class="bubblelink code" title="HONORS 100">HONORS 100</a></td><td>x</td><td class="hourscol">3</td></tr></tbody></table>
    </body></html>"""

    def test_blocks_rules_alternatives_and_skipped_sections(self):
        p = fp.parse_program(self.HTML, "/undergraduate/letters-science/toy-science/toy-science-bs/")
        self.assertEqual(p["name"], "Toy Science, BS")
        self.assertEqual(p["degree"], "BS")
        self.assertEqual([b["rule"] for b in p["blocks"]], [{"t": "all"}, {"t": "n", "n": 1}])
        core, la = p["blocks"]
        self.assertEqual(core["items"][0]["o"][0]["i"], ["COMP-SCI-240", "MATH-240"])  # cross-listing keeps both designations
        self.assertEqual(la["h"], "Linear Algebra")                                      # footnote marker stripped
        self.assertEqual([o["i"][0] for o in la["items"][0]["o"]], ["MATH-320", "MATH-340"])  # "or" row joins the row above
        self.assertEqual(len(la["items"]), 2)
        self.assertNotIn("HONORS-100", json.dumps(p))

    def test_rules(self):
        self.assertEqual(fp.parse_rule("Complete two:"), {"t": "n", "n": 2})
        self.assertEqual(fp.parse_rule("Select 6 credits from the following:"), {"t": "cr", "c": 6})
        self.assertEqual(fp.parse_rule("Complete both:"), {"t": "all"})
        self.assertEqual(fp.parse_rule("Complete either:"), {"t": "n", "n": 1})
        self.assertIsNone(fp.parse_rule("See your advisor"))


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

    def test_catalog_tier_is_broad(self):
        n = self.q("SELECT COUNT(*) FROM courses WHERE source='catalog'")[0][0]
        self.assertGreater(n, 3000)
        feat = self.q("SELECT COUNT(*) FROM courses WHERE source<>'catalog'")[0][0]
        self.assertTrue(200 < feat < 400, feat)
        graded = self.q("SELECT COUNT(*) FROM courses c JOIN course_stats s ON s.course_id=c.id "
                        "WHERE c.source='catalog' AND s.gpa IS NOT NULL")[0][0]
        self.assertGreater(graded / n, 0.7)  # most catalog courses have letter-grade history
        self.assertEqual(self.q("SELECT COUNT(*) FROM chat_mentions m JOIN courses c ON c.id=m.course_id "
                                "WHERE c.source='catalog' AND (m.mentions<>0 OR m.positive<>0 OR m.negative<>0)"), [(0,)])
        self.assertEqual(self.q("SELECT COUNT(*) FROM section_grades sg JOIN courses c ON c.id=sg.course_id "
                                "WHERE c.source<>'catalog' AND sg.section=0"), [(0,)])

    def test_reddit_titles_clean(self):
        bad = self.q("SELECT title FROM reddit_threads WHERE title LIKE 'r/UWMadison on Reddit%' OR title LIKE '% - Reddit'"
                     " OR title LIKE '%...'")
        self.assertEqual(bad, [])

    def test_offerings_have_times_for_most_offered_courses(self):
        offered = self.q("SELECT COUNT(*) FROM courses WHERE offered_now=1")[0][0]
        self.assertEqual(self.q("SELECT COUNT(*) FROM offerings")[0][0], offered)
        timed = self.q("SELECT COUNT(*) FROM offerings WHERE packages LIKE '%\"m\":[[%'")[0][0]
        self.assertGreater(timed / offered, 0.4)
        self.assertEqual(self.q("SELECT COUNT(*) FROM offerings WHERE json_valid(packages)=0"), [(0,)])

    def test_package_ids_are_unique_within_each_course(self):
        import json as _json
        for (pk,) in self.db.execute("SELECT packages FROM offerings"):
            ids = [p["id"] for p in _json.loads(pk)]
            self.assertEqual(len(ids), len(set(ids)))

    def test_no_personal_fields(self):
        cols = {r[1] for t in ("chat_mentions", "reddit_threads") for r in self.q(f"PRAGMA table_info({t})")}
        for bad in ("author", "user", "username", "sender", "wxid", "message", "text", "body"):
            self.assertNotIn(bad, cols)

    @unittest.skipUnless(os.path.exists(os.path.join(ROOT, "courses.json")), "private seed file not present")
    def test_seed_file_is_aggregate_only(self):
        with open(os.path.join(ROOT, "courses.json"), encoding="utf-8") as f:
            rows = json.load(f)
        allowed = {"code", "subj", "num", "n", "pos", "neg", "mg", "people"}
        for r in rows:
            self.assertLessEqual(set(r), allowed)


if __name__ == "__main__":
    unittest.main()
