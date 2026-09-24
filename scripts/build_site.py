# -*- coding: utf-8 -*-
"""Export data/uwcourses.db -> assets/data.js + assets/catalog.js, render index.html.

Data ships as <script> files (not fetch) so the page also works from file://.

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
ASSETS = os.path.join(ROOT, "assets")
MAX_INSTR = 14
MAX_THREADS = 8


def r3(v):
    return round(v, 3) if isinstance(v, float) else v


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
        ins = [x for x in ins if x[5]] + [x for x in ins if not x[5]][:MAX_INSTR]
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
        out.append({
            "id": code.replace(" ", "-"), "code": code, "al": aliases, "sa": subj.get(sc, (None,))[0],
            "sn": (subj.get(sc, (None, None))[1] or "").title(), "num": num, "t": title, "d": desc, "cr": cr,
            "prq": prq, "br": json.loads(br or "[]"), "ge": ge, "es": es, "lvl": lvl, "typ": typ, "last": last,
            "now": now_obj, "mg": uuid, "src": src, "en": enr, "m": men, "pos": pos, "neg": neg,
            "n": graded or 0, "gpa": r3(gpa), "gr": r3(gpa_r), "gs": r3(gpa_s), "pa": r3(pa), "pdf": r3(pdf),
            "tr": r3(tr), "sp": r3(sp), "dist": list(dist) if dist[0] is not None else None,
            "terms": terms, "ins": ins, "rd": rd[:MAX_THREADS], "rdn": rdn or 0, "rdt": r3(rdt)})
    campus = db.execute("SELECT SUM(a),SUM(ab),SUM(b),SUM(bc),SUM(c),SUM(d),SUM(f) FROM grade_terms").fetchone()
    insights = json.load(open(INSIGHTS, encoding="utf-8")) if os.path.exists(INSIGHTS) else {}
    return {"meta": {**meta, "campusDist": list(campus)}, "courses": out, "insights": insights}


def catalog(term):
    rows = {}
    for h in uwapi.enroll_catalog(term):
        cmin, cmax = h.get("minimumCredits"), h.get("maximumCredits")
        cr = (f"{cmin:g}" if cmin == cmax else f"{cmin:g}–{cmax:g}") if cmin is not None else ""
        rows[h["courseDesignation"]] = [h["courseDesignation"], h.get("title") or "", cr]
    return sorted(rows.values())


def main():
    db = sqlite3.connect(DB)
    data = export(db)
    os.makedirs(ASSETS, exist_ok=True)
    js = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    open(os.path.join(ASSETS, "data.js"), "w", encoding="utf-8").write("window.UWCL=" + js + ";\n")
    cat = catalog(data["meta"]["term"])
    open(os.path.join(ASSETS, "catalog.js"), "w", encoding="utf-8").write(
        "window.UWCL_CATALOG=" + json.dumps(cat, ensure_ascii=False, separators=(",", ":")) + ";\n")
    html = open(TEMPLATE, encoding="utf-8").read().replace("__BUILT__", data["meta"]["built_at"][:10])
    open(os.path.join(ROOT, "index.html"), "w", encoding="utf-8").write(html)
    print(f"{len(data['courses'])} courses ({len(js) // 1024} KB), catalog {len(cat)} -> assets/, index.html")


if __name__ == "__main__":
    main()
