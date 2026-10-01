# -*- coding: utf-8 -*-
"""Export data/uwcourses.db -> worker/data.json (private, deployed to the cloud API), render index.html.

The page itself carries no course data: it asks the API for pages of results. Chat-derived counts
below K_ANON are withheld everywhere in the export.

Usage:
    python scripts/build_site.py
"""
import json, os, sqlite3, sys

sys.path.insert(0, os.path.dirname(__file__))
import uwapi  # noqa: E402

ROOT = uwapi.ROOT
DB = os.path.join(ROOT, "data", "uwcourses.db")
INSIGHTS = os.path.join(ROOT, "data", "insights.json")
TEMPLATE = os.path.join(os.path.dirname(__file__), "index.template.html")
WORKER_DATA = os.path.join(ROOT, "worker", "data.json")
CONFIG = os.path.join(ROOT, "site.config.json")
K_ANON = 3  # chat counts below this are never published per course
MAX_INSTR = 14
MAX_INSTR_CATALOG = 10
MAX_THREADS = 8


SMALL = {"and", "of", "in", "for", "the", "to", "on", "at", "a", "an", "or"}


def nice(name):
    """'AGRICULTURAL AND APPLIED ECONOMICS' -> 'Agricultural and Applied Economics'."""
    ws = (name or "").title().split()
    return " ".join(w.lower() if i and w.lower() in SMALL else w for i, w in enumerate(ws))


def r3(v):
    return round(v, 3) if isinstance(v, float) else v


def strip_low(o):
    """Drop per-course chat counts below K_ANON from the aggregate lists."""
    if isinstance(o, dict):
        return {k: strip_low(v) for k, v in o.items() if not (k == "mentions" and isinstance(v, int) and v < K_ANON)}
    if isinstance(o, list):
        return [strip_low(v) for v in o]
    return o


def public_insights(ins, courses):
    keep = {k: strip_low(v) for k, v in ins.items() if k != "by_subject"}
    keep["by_subject"] = [{**r, "mentions": None if 0 < r["mentions"] < K_ANON else r["mentions"]}
                          for r in ins.get("by_subject", [])]  # null = fewer than K_ANON
    keep["scatter"] = [[c["id"], c["code"], c["t"], c["gpa"], c.get("m", 0), c["n"], c["num"]] for c in courses
                       if c.get("src") == "chat" and c.get("gpa") is not None and c.get("n", 0) >= 50]
    return keep


def export(db):
    meta = dict(db.execute("SELECT key, value FROM meta"))
    subj = {k: (a, n) for k, a, n in db.execute("SELECT code, abbr, name FROM subjects")}
    out = []
    for row in db.execute("""
            SELECT c.id, c.code, c.subject_code, c.number, c.title, c.description, c.credits_min, c.credits_max,
                   c.prereqs, c.breadths, c.gen_ed, c.ethnic_studies, c.level, c.typically_offered, c.last_taught,
                   c.offered_now, c.madgrades_uuid, c.source, c.enrolled_now, m.mentions, m.positive, m.negative,
                   s.graded, s.gpa, s.gpa_recent, s.gpa_shrunk, s.pct_a, s.pct_df, s.trend, s.instr_spread,
                   s.reddit_count, s.reddit_tone
            FROM courses c JOIN chat_mentions m ON m.course_id=c.id LEFT JOIN course_stats s ON s.course_id=c.id
            ORDER BY m.mentions DESC, c.code"""):
        (cid, code, sc, num, title, desc, cmin, cmax, prq, br, ge, es, lvl, typ, last, now, uuid, src, enr,
         men, pos, neg, graded, gpa, gpa_r, gpa_s, pa, pdf, tr, sp, rdn, rdt) = row
        dist = db.execute("""SELECT SUM(a),SUM(ab),SUM(b),SUM(bc),SUM(c),SUM(d),SUM(f) FROM grade_terms
                             WHERE course_id=?""", (cid,)).fetchone()
        terms = [[t, r3(g), n] for t, g, n in db.execute("""
            SELECT term, (4*a+3.5*ab+3*b+2.5*bc+2*c+d)*1.0/(a+ab+b+bc+c+d+f), a+ab+b+bc+c+d+f
            FROM grade_terms WHERE course_id=? AND a+ab+b+bc+c+d+f>0 ORDER BY term""", (cid,))]
        ins = [[n.title(), r3(g), gn, r3(p), lt, tn] for n, g, gn, p, lt, tn in db.execute("""
            SELECT i.name, s.gpa, s.graded, s.pct_a, s.last_term, s.teaching_now
            FROM instructor_course_stats s JOIN instructors i ON i.id=s.instructor_id
            WHERE s.course_id=? AND s.graded>0
            ORDER BY s.teaching_now DESC, s.graded DESC""", (cid,))]
        # Teaching now + every instructor with a real sample (so the spread is visible) + fill to MAX_INSTR
        rest = [x for x in ins if not x[5]]
        big = [x for x in rest if x[2] >= 30]
        ins = [x for x in ins if x[5]] + big + [x for x in rest if x[2] < 30][:max(0, MAX_INSTR - len(big))]
        if src == "catalog":
            ins = ins[:MAX_INSTR_CATALOG]
        secs = db.execute("""SELECT type, section, instructors, status, enrolled, capacity, package_id
                             FROM current_sections WHERE course_id=?""", (cid,)).fetchall()
        lectures = {}
        for t, s, names, st, en, cap, pk in secs:
            if t in ("LEC", "SEM", "IND", "FLD") or not lectures:
                lectures.setdefault((t, s), set()).update(json.loads(names or "[]"))
        pk_status = {pk: st for *_, st, en, cap, pk in secs}
        now_obj = None
        if now:
            now_obj = {"lec": len(lectures),
                       "who": sorted({n for v in lectures.values() for n in v}),
                       "open": sum(v == "OPEN" for v in pk_status.values()),
                       "wait": sum(v == "WAITLISTED" for v in pk_status.values()),
                       "pk": len(pk_status)}
        rd = [[t, u, y, tn] for t, u, y, tn in db.execute("""
            SELECT title, url, year, tone FROM reddit_threads WHERE course_id=? ORDER BY year DESC""", (cid,))]
        aliases = [a for (a,) in db.execute("SELECT alias FROM course_aliases WHERE course_id=? AND alias<>?",
                                             (cid, code))]
        cr = (f"{cmin:g}" if cmin == cmax else f"{cmin:g}–{cmax:g}") if cmin is not None else None
        hidden = src == "chat" and (men or 0) < K_ANON
        if hidden:
            men = pos = neg = 0
        rec = {
            "id": code.replace(" ", "-"), "code": code, "al": aliases, "sa": subj.get(sc, (None,))[0],
            "sn": nice(subj.get(sc, (None, None))[1]), "num": num, "t": title, "d": desc, "cr": cr,
            "prq": prq, "br": json.loads(br or "[]"), "ge": ge, "es": es, "lvl": lvl, "typ": typ, "last": last,
            "now": now_obj, "mg": uuid, "src": src, "en": enr, "m": men, "ms": 1 if hidden else 0, "pos": pos, "neg": neg,
            "n": graded or 0, "gpa": r3(gpa), "gr": r3(gpa_r), "gs": r3(gpa_s), "pa": r3(pa), "pdf": r3(pdf),
            "tr": r3(tr), "sp": r3(sp), "dist": list(dist) if dist[0] is not None else None,
            "terms": terms, "ins": ins, "rd": rd[:MAX_THREADS], "rdn": rdn or 0, "rdt": r3(rdt)}
        if src == "catalog":  # no peer signal: leave out empty fields, the page fills defaults
            rec = {k: v for k, v in rec.items() if v not in (None, [], 0, "")}
        out.append(rec)
    campus = db.execute("SELECT SUM(a),SUM(ab),SUM(b),SUM(bc),SUM(c),SUM(d),SUM(f) FROM grade_terms").fetchone()
    insights = json.load(open(INSIGHTS, encoding="utf-8")) if os.path.exists(INSIGHTS) else {}
    insights = public_insights(insights, out)
    meta = {**meta, "campusDist": list(campus), "campusGpa": insights.get("campus_gpa")}
    return {"meta": meta, "courses": out, "insights": insights}


def main():
    db = sqlite3.connect(DB)
    data = export(db)
    ids = [c["id"] for c in data["courses"]]
    assert len(ids) == len(set(ids)), "duplicate course ids"
    os.makedirs(os.path.dirname(WORKER_DATA), exist_ok=True)
    js = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    open(WORKER_DATA, "w", encoding="utf-8").write(js)
    for stale in ("data.js", "catalog.js"):  # data no longer ships with the page
        f = os.path.join(ROOT, "assets", stale)
        if os.path.exists(f):
            os.remove(f)
    api = json.load(open(CONFIG, encoding="utf-8")).get("api", "") if os.path.exists(CONFIG) else ""
    html = open(TEMPLATE, encoding="utf-8").read().replace("__BUILT__", data["meta"]["built_at"][:10]).replace("__API__", api)
    open(os.path.join(ROOT, "index.html"), "w", encoding="utf-8").write(html)
    print(f"{len(data['courses'])} courses ({len(js) // 1024} KB) -> worker/data.json, index.html (api: {api or 'same origin'})")


if __name__ == "__main__":
    main()
