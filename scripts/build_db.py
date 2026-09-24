# -*- coding: utf-8 -*-
"""Build data/uwcourses.db from the anonymized seed list + public sources.

Steps: resolve every seed code against the real catalog (drops false positives,
merges cross-listings) -> pull MadGrades history -> snapshot current sections
-> attach r/UWMadison threads (data/reddit.json, from fetch_reddit.py).

Usage:
    python scripts/build_db.py [--term 1272] [--refresh]
"""
import argparse, datetime, json, os, re, sqlite3, sys
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(__file__))
import uwapi  # noqa: E402

ROOT = uwapi.ROOT
DB = os.path.join(ROOT, "data", "uwcourses.db")
SCHEMA = os.path.join(ROOT, "data", "schema.sql")
SEED = os.path.join(ROOT, "courses.json")
REDDIT = os.path.join(ROOT, "data", "reddit.json")
REJECTED = os.path.join(ROOT, "data", "rejected_codes.json")

# Chat shorthand -> official subject (letters only, spaces stripped)
SEED_ALIAS = {"CS": "COMPSCI", "NUTRISCI": "NUTRSCI", "EDUPSY": "EDPSYCH", "BIO": "BIOLOGY",
              "HIST": "HISTORY", "COMMARTS": "COMARTS", "AFRICA": "AFRICAN", "ANAT": "ANATOMY",
              "INTERDIS": "INTERLS", "MARKETING": "MARKETNG", "ACCT": "ACCTIS", "ARTS": "ART",
              "LING": "LINGUIS", "ASIALANG": "ASIALANG"}
GRADE_KEYS = ["a", "ab", "b", "bc", "c", "d", "f", "s", "u", "cr", "n", "p", "i", "nw", "nr", "other"]


def norm(s):
    return re.sub(r"[^A-Z]", "", s.upper())


def grade_row(g):
    return [g.get(k + "Count", 0) for k in GRADE_KEYS] + [g.get("total", 0)]


def resolve(seeds, catalog, mg_subjects):
    """Seed rows -> {identity: {...}} with cross-listings merged; plus rejects."""
    by_key, subj_code = {}, {}
    for h in catalog:
        for s in [h["subject"]] + (h.get("allCrossListedSubjects") or []):
            by_key[(norm(s["shortDescription"]), h["catalogNumber"])] = (h, s)
            subj_code[norm(s["shortDescription"])] = s["subjectCode"]
    for s in mg_subjects:
        subj_code.setdefault(norm(s["abbreviation"]), s["code"])

    courses, rejected = {}, []
    for r in seeds:
        subj = SEED_ALIAS.get(r["subj"], r["subj"])
        hit = by_key.get((subj, r["num"]))
        if hit:
            h, s = hit
            ident, entry = "E" + h["courseId"], {"hit": h, "subject_code": s["subjectCode"],
                                                 "abbr": s["shortDescription"]}
        else:
            code = subj_code.get(subj)
            mg = [c for c in uwapi.madgrades_course(code, r["num"]) if str(c["number"]) == r["num"]] if code else []
            if not mg:
                rejected.append({"code": r["code"], "mentions": r["n"],
                                 "reason": "unknown subject" if not code else "no such course number"})
                continue
            sub = next((x for x in mg[0]["subjects"] if x["code"] == code), mg[0]["subjects"][0])
            ident, entry = "M" + mg[0]["uuid"], {"hit": None, "mg": mg[0], "subject_code": code,
                                                 "abbr": sub["abbreviation"]}
        c = courses.setdefault(ident, {**entry, "num": r["num"], "seeds": [], "n": 0, "pos": 0, "neg": 0})
        c["seeds"].append(r["code"])
        c["n"] += r["n"]; c["pos"] += r["pos"]; c["neg"] += r["neg"]
        if r.get("people"):
            c["people"] = max(c.get("people") or 0, r["people"])
        if r["n"] > c.get("_best", -1):  # primary designation = most-mentioned alias
            c["_best"], c["subject_code"], c["abbr"] = r["n"], entry["subject_code"], entry["abbr"]
    return courses, rejected


def lecture_enrollment(packages):
    """Estimated students this term. A package's count belongs to its smallest section,
    so sum per section type and keep the largest total."""
    per = {}
    for p in packages or []:
        n = (p.get("enrollmentStatus") or {}).get("currentlyEnrolled") or 0
        for s in p.get("sections") or []:
            key = (s.get("type"), s.get("sectionNumber"))
            per[key] = max(per.get(key, 0), n)
    totals = {}
    for (t, _), n in per.items():
        totals[t] = totals.get(t, 0) + n
    return max(totals.values(), default=0)


def expansion(catalog, term, min_enrolled, have, refresh):
    """Large courses this term that the chat never mentioned (all undergrad-level offerings scanned)."""
    uniq = {}
    for h in catalog:
        if h.get("currentlyTaught") and int(h["catalogNumber"]) < 700:
            uniq.setdefault(h["courseId"], h)
    todo = [h for cid, h in uniq.items() if "E" + cid not in have]

    def size(h):
        pk = uwapi.enroll_packages(term, h["subject"]["subjectCode"], h["courseId"], cache=not refresh)
        return h, pk, lecture_enrollment(pk)

    with ThreadPoolExecutor(8) as ex:
        sized = list(ex.map(size, todo))
    out = {}
    for h, pk, n in sized:
        if n >= min_enrolled:
            out["E" + h["courseId"]] = {"hit": h, "subject_code": h["subject"]["subjectCode"],
                                        "abbr": h["subject"]["shortDescription"], "num": h["catalogNumber"],
                                        "seeds": [], "n": 0, "pos": 0, "neg": 0, "source": "enrollment"}
    print(f"scanned {len(todo)} offered courses: {len(out)} with >= {min_enrolled} enrolled added")
    return out


def fetch_course(c, term, refresh):
    """MadGrades history + current sections for one resolved course."""
    if not c.get("mg"):
        mg = [x for x in uwapi.madgrades_course(c["subject_code"], c["num"]) if str(x["number"]) == c["num"]]
        c["mg"] = mg[0] if mg else None
    c["grades"] = uwapi.madgrades(f"/courses/{c['mg']['uuid']}/grades") if c["mg"] else None
    c["packages"] = []
    if c["hit"]:
        c["packages"] = uwapi.enroll_packages(term, c["hit"]["subject"]["subjectCode"], c["hit"]["courseId"],
                                              cache=not refresh)
    return c


def name_of(i):
    n = i.get("name") or {}
    return f"{n.get('first', '')} {n.get('last', '')}".strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--term", default="1272")
    ap.add_argument("--refresh", action="store_true", help="re-fetch current sections (seats change daily)")
    ap.add_argument("--min-enrolled", type=int, default=250,
                    help="also add unmentioned courses with at least this many enrolled this term (0 = off)")
    a = ap.parse_args()

    seeds = json.load(open(SEED, encoding="utf-8"))
    catalog = uwapi.enroll_catalog(a.term)
    mg_subjects = []
    page = 1
    while True:
        r = uwapi.madgrades(f"/subjects?per_page=100&page={page}")
        mg_subjects += r["results"]
        if page >= r["totalPages"]:
            break
        page += 1
    print(f"catalog {len(catalog)} courses, {len(mg_subjects)} MadGrades subjects")

    courses, rejected = resolve(seeds, catalog, mg_subjects)
    for c in courses.values():
        c["source"] = "chat"
    if a.min_enrolled:
        courses.update(expansion(catalog, a.term, a.min_enrolled, courses, a.refresh))
    with ThreadPoolExecutor(8) as ex:
        list(ex.map(lambda c: fetch_course(c, a.term, a.refresh), courses.values()))
    reddit = json.load(open(REDDIT, encoding="utf-8")) if os.path.exists(REDDIT) else {}

    tmp = DB + ".tmp"
    if os.path.exists(tmp):
        os.remove(tmp)
    db = sqlite3.connect(tmp)
    db.executescript(open(SCHEMA, encoding="utf-8").read())
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
    db.executemany("INSERT INTO meta VALUES (?,?)", [
        ("built_at", now), ("term", a.term), ("seed_rows", str(len(seeds))),
        ("sources", "Course Search & Enroll; MadGrades (UW public records); r/UWMadison via web search; "
                    "anonymized WeChat group-chat counts")])

    subjects = {}
    for h in catalog:
        for s in [h["subject"]] + (h.get("allCrossListedSubjects") or []):
            subjects[s["subjectCode"]] = (s["shortDescription"], s.get("formalDescription") or s.get("description"),
                                          (s.get("schoolCollege") or {}).get("shortDescription"))
    for s in mg_subjects:
        subjects.setdefault(s["code"], (s["abbreviation"], s["name"], None))
    db.executemany("INSERT INTO subjects VALUES (?,?,?,?)", [(k, *v) for k, v in subjects.items()])

    instructors = {}
    order = sorted(courses.items(), key=lambda kv: (-kv[1]["n"], kv[1]["abbr"], int(kv[1]["num"])))
    used, cid = set(), 0
    for ident, c in order:
        h, mg = c["hit"], c["mg"]
        code = f"{c['abbr']} {c['num']}"
        if code in used:  # topics courses share one designation across course ids
            continue
        used.add(code)
        cid += 1
        packages = c["packages"] or []
        db.execute("INSERT INTO courses VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (
            cid, code, c["subject_code"], int(c["num"]),
            (h or {}).get("title") or (mg or {}).get("name"),
            (h or {}).get("description"),
            (h or {}).get("minimumCredits"), (h or {}).get("maximumCredits"),
            (h or {}).get("enrollmentPrerequisites"),
            json.dumps([b["description"] for b in (h or {}).get("breadths") or []]),
            ((h or {}).get("generalEd") or {}).get("description"),
            1 if (h or {}).get("ethnicStudies") else 0,
            ", ".join(l["description"] for l in (h or {}).get("levels") or []) or None,
            (h or {}).get("typicallyOffered"),
            int(h["lastTaught"]) if h and h.get("lastTaught") else None,
            1 if h else 0, 1 if packages else 0,
            (h or {}).get("courseId"), (mg or {}).get("uuid"), c["source"],
            lecture_enrollment(packages) if packages else None))
        aliases = {code}
        if h:
            aliases |= {f"{s['shortDescription']} {c['num']}" for s in h.get("allCrossListedSubjects") or []}
        elif mg:
            aliases |= {f"{s['abbreviation']} {c['num']}" for s in mg["subjects"]}
        db.executemany("INSERT OR IGNORE INTO course_aliases VALUES (?,?)", [(x, cid) for x in aliases])
        db.execute("INSERT INTO chat_mentions VALUES (?,?,?,?,?,?)",
                   (cid, c["n"], c["pos"], c["neg"], c.get("people"), json.dumps(c["seeds"])))

        g = c["grades"]
        for off in (g or {}).get("courseOfferings") or []:
            db.execute(f"INSERT OR REPLACE INTO grade_terms VALUES (?,?,{','.join('?' * 17)})",
                       (cid, off["termCode"], *grade_row(off["cumulative"])))
            for sec in off.get("sections") or []:
                for ins in sec.get("instructors") or []:
                    if ins["id"] not in instructors:
                        instructors[ins["id"]] = ins["name"]
                        db.execute("INSERT INTO instructors VALUES (?,?)", (ins["id"], ins.get("name") or f"Instructor {ins['id']}"))
                    db.execute("INSERT OR IGNORE INTO section_grades VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                               (cid, off["termCode"], sec["sectionNumber"], ins["id"],
                                sec.get("aCount", 0), sec.get("abCount", 0), sec.get("bCount", 0),
                                sec.get("bcCount", 0), sec.get("cCount", 0), sec.get("dCount", 0),
                                sec.get("fCount", 0), sec.get("total", 0)))

        for p in packages:
            es = p.get("enrollmentStatus") or {}
            status = (p.get("packageEnrollmentStatus") or {}).get("status")
            for s in p.get("sections") or []:
                db.execute("INSERT OR IGNORE INTO current_sections VALUES (?,?,?,?,?,?,?,?,?,?)", (
                    cid, int(a.term), str(p.get("id") or p.get("docId")), s.get("type"), s.get("sectionNumber"),
                    json.dumps([name_of(i) for i in s.get("instructors") or [] if name_of(i)]),
                    status, es.get("currentlyEnrolled"), es.get("capacity"), es.get("waitlistCurrentSize")))

        for t in reddit.get(code, []):
            db.execute("INSERT OR IGNORE INTO reddit_threads VALUES (?,?,?,?,?,?,?)",
                       (cid, t["id"], t["url"], t["title"], t.get("snippet"), t.get("year"), t.get("tone", 0)))

    db.commit()
    db.close()
    os.replace(tmp, DB)
    db = sqlite3.connect(DB)
    json.dump(rejected, open(REJECTED, "w", encoding="utf-8"), indent=1)
    n = db.execute("SELECT COUNT(*) FROM courses").fetchone()[0]
    merged = sum(len(c["seeds"]) > 1 for c in courses.values())
    n_chat = db.execute("SELECT COUNT(*) FROM courses WHERE source='chat'").fetchone()[0]
    print(f"{len(seeds)} seed codes -> {n_chat} verified "
          f"({merged} cross-listing merges, {len(rejected)} rejected); {n} courses total -> {DB}")
    db.close()


if __name__ == "__main__":
    main()
