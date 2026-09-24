# -*- coding: utf-8 -*-
"""Derive per-course / per-instructor stats and campus-level insights.

Fills course_stats + instructor_course_stats in data/uwcourses.db, writes
data/insights.json and docs/ANALYSIS.md.

Usage:
    python scripts/analyze.py
"""
import json, math, os, random, re, sqlite3, statistics

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, "data", "uwcourses.db")
INSIGHTS = os.path.join(ROOT, "data", "insights.json")
REPORT = os.path.join(ROOT, "docs", "ANALYSIS.md")
PTS = {"a": 4, "ab": 3.5, "b": 3, "bc": 2.5, "c": 2, "d": 1, "f": 0}
SHRINK_K = 100          # prior weight, in students
MIN_INSTR_N = 30        # instructor needs this many graded students to count
TREND_FROM = 2016.5     # trend window start (fall 2016)


def term_year(t):
    """1264 -> 2026.1 (spring); 1262 -> 2025.7 (fall); 1266 -> 2026.45 (summer)."""
    y = 2000 + (t // 10) % 100 if t >= 1000 else 1900 + t // 10
    return {2: y - 1 + 0.7, 4: y + 0.1, 6: y + 0.45}.get(t % 10, y)


def term_label(t):
    y = 2000 + (t // 10) % 100
    return {2: f"Fall {y - 1}", 4: f"Spring {y}", 6: f"Summer {y}"}.get(t % 10, str(t))


def gpa_of(r):
    n = sum(r[k] for k in PTS)
    return (sum(r[k] * v for k, v in PTS.items()) / n, n) if n else (None, 0)


def wls_slope(xs, ys, ws):
    sw = sum(ws)
    mx, my = sum(w * x for x, w in zip(xs, ws)) / sw, sum(w * y for y, w in zip(ys, ws)) / sw
    sxx = sum(w * (x - mx) ** 2 for x, w in zip(xs, ws))
    return sum(w * (x - mx) * (y - my) for x, y, w in zip(xs, ys, ws)) / sxx if sxx else None


def ranks(v):
    order = sorted(range(len(v)), key=lambda i: v[i])
    r = [0.0] * len(v)
    i = 0
    while i < len(v):
        j = i
        while j + 1 < len(v) and v[order[j + 1]] == v[order[i]]:
            j += 1
        for k in range(i, j + 1):
            r[order[k]] = (i + j) / 2 + 1
        i = j + 1
    return r


def pearson(x, y):
    mx, my = statistics.fmean(x), statistics.fmean(y)
    sx = math.sqrt(sum((a - mx) ** 2 for a in x))
    sy = math.sqrt(sum((b - my) ** 2 for b in y))
    return sum((a - mx) * (b - my) for a, b in zip(x, y)) / (sx * sy) if sx and sy else 0.0


def spearman(x, y, perms=2000, seed=7):
    """Spearman rho with a two-sided permutation p-value."""
    if len(x) < 8:
        return None
    rx, ry = ranks(x), ranks(y)
    rho = pearson(rx, ry)
    rng, hits, ry2 = random.Random(seed), 0, ry[:]
    for _ in range(perms):
        rng.shuffle(ry2)
        hits += abs(pearson(rx, ry2)) >= abs(rho) - 1e-12
    return {"rho": round(rho, 3), "p": round((hits + 1) / (perms + 1), 4), "n": len(x)}


def dict_rows(db, sql, args=()):
    cur = db.execute(sql, args)
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, r)) for r in cur]


def norm_name(s):
    return re.sub(r"[^A-Z ]", "", (s or "").upper()).split()


def main():
    db = sqlite3.connect(DB)
    db.execute("DELETE FROM course_stats")
    db.execute("DELETE FROM instructor_course_stats")
    courses = dict_rows(db, """SELECT c.id, c.code, c.number, c.subject_code, c.title, c.source, m.mentions, m.positive,
                                      m.negative FROM courses c JOIN chat_mentions m ON m.course_id = c.id""")
    terms = {}
    for r in dict_rows(db, "SELECT * FROM grade_terms ORDER BY term"):
        terms.setdefault(r["course_id"], []).append(r)

    # Course-level stats
    stats = {}
    for c in courses:
        ts = terms.get(c["id"], [])
        tot = {k: sum(t[k] for t in ts) for k in PTS}
        gpa, n = gpa_of(tot)
        graded_terms = [(t["term"], *gpa_of(t)) for t in ts if gpa_of(t)[1] > 0]
        recent = {k: sum(t[k] for t in [t for t in ts if gpa_of(t)[1] > 0][-6:]) for k in PTS}
        pts = [(term_year(t), g, w) for t, g, w in graded_terms if w >= 15 and term_year(t) >= TREND_FROM]
        trend = wls_slope(*zip(*pts)) if len({round(p[0]) for p in pts}) >= 3 else None
        stats[c["id"]] = {
            "graded": n, "gpa": gpa, "gpa_recent": gpa_of(recent)[0],
            "pct_a": tot["a"] / n if n else None,
            "pct_b_up": (tot["a"] + tot["ab"] + tot["b"]) / n if n else None,
            "pct_df": (tot["d"] + tot["f"]) / n if n else None,
            "trend": trend, "terms_count": len(graded_terms),
            "first_term": graded_terms[0][0] if graded_terms else None,
            "last_term": graded_terms[-1][0] if graded_terms else None}

    # Empirical-Bayes shrinkage toward the subject mean (campus mean if the subject is thin)
    by_subj = {}
    for c in courses:
        s = stats[c["id"]]
        if s["gpa"] is not None:
            by_subj.setdefault(c["subject_code"], []).append((s["gpa"], s["graded"]))
    all_pairs = [p for v in by_subj.values() for p in v]
    campus = sum(g * n for g, n in all_pairs) / sum(n for _, n in all_pairs)
    for c in courses:
        s = stats[c["id"]]
        pr = by_subj.get(c["subject_code"], [])
        prior = sum(g * n for g, n in pr) / sum(n for _, n in pr) if len(pr) >= 3 else campus
        s["gpa_shrunk"] = (s["gpa"] * s["graded"] + prior * SHRINK_K) / (s["graded"] + SHRINK_K) \
            if s["gpa"] is not None else None

    # Reddit signal
    for c in courses:
        th = dict_rows(db, "SELECT tone FROM reddit_threads WHERE course_id=?", (c["id"],))
        stats[c["id"]]["reddit_count"] = len(th)
        stats[c["id"]]["reddit_tone"] = statistics.fmean(t["tone"] for t in th) if th else None

    # Instructor-in-course stats
    current = {}
    for cid, names in db.execute("SELECT course_id, instructors FROM current_sections"):
        for nm in json.loads(names or "[]"):
            current.setdefault(cid, set()).add(" ".join(norm_name(nm)))
    instr_rows = dict_rows(db, """
        SELECT sg.course_id, sg.instructor_id, i.name, SUM(a) a, SUM(ab) ab, SUM(b) b, SUM(bc) bc, SUM(c) c,
               SUM(d) d, SUM(f) f, COUNT(DISTINCT term) terms, MAX(term) last_term
        FROM section_grades sg JOIN instructors i ON i.id = sg.instructor_id
        GROUP BY sg.course_id, sg.instructor_id""")
    per_course_instr = {}
    for r in instr_rows:
        g, n = gpa_of(r)
        parts = norm_name(r["name"])
        now_names = current.get(r["course_id"], set())
        # Match on full name, else first + last token (MadGrades keeps middle names)
        teaching = any(" ".join(parts) == x or (parts and x.split() and parts[0] == x.split()[0]
                                                 and parts[-1] == x.split()[-1]) for x in now_names)
        db.execute("INSERT INTO instructor_course_stats VALUES (?,?,?,?,?,?,?,?)",
                   (r["course_id"], r["instructor_id"], n, g, r["a"] / n if n else None, r["terms"],
                    r["last_term"], int(teaching)))
        if n >= MIN_INSTR_N and g is not None:
            per_course_instr.setdefault(r["course_id"], []).append((g, n, r["name"]))
    for cid, lst in per_course_instr.items():
        stats[cid]["instr_spread"] = max(x[0] for x in lst) - min(x[0] for x in lst) if len(lst) >= 2 else None

    cols = ["graded", "gpa", "gpa_recent", "gpa_shrunk", "pct_a", "pct_b_up", "pct_df", "trend", "instr_spread",
            "terms_count", "first_term", "last_term", "reddit_count", "reddit_tone"]
    for cid, s in stats.items():
        db.execute(f"INSERT INTO course_stats VALUES (?,{','.join('?' * len(cols))})",
                   (cid, *[s.get(k) for k in cols]))
    db.commit()

    # ── Insights ─────────────────────────────────────────────────
    rows = [{**c, **stats[c["id"]]} for c in courses]
    graded = [r for r in rows if r["gpa"] is not None and r["graded"] >= 50]
    chat = [r for r in graded if r["source"] == "chat"]  # chat metrics only mean something here
    r2 = lambda v: round(v, 3) if v is not None else None  # noqa: E731

    corr = {
        "mentions_vs_gpa": spearman([r["mentions"] for r in chat], [r["gpa"] for r in chat]),
        "chat_sentiment_vs_gpa": spearman(
            [(r["positive"] - r["negative"]) / (r["positive"] + r["negative"]) for r in chat
             if r["positive"] + r["negative"]],
            [r["gpa"] for r in chat if r["positive"] + r["negative"]]),
        "reddit_tone_vs_gpa": spearman([r["reddit_tone"] for r in graded if r["reddit_count"] >= 3],
                                       [r["gpa"] for r in graded if r["reddit_count"] >= 3]),
        "chat_vs_reddit_volume": spearman([r["mentions"] for r in rows if r["source"] == "chat"],
                                          [r["reddit_count"] for r in rows if r["source"] == "chat"]),
        "course_level_vs_gpa": spearman([r["number"] for r in graded], [r["gpa"] for r in graded]),
    }

    levels = {}
    for r in graded:
        lv = min(r["number"] // 100, 6) * 100
        levels.setdefault(lv, []).append(r)
    by_level = [{"level": "600+" if lv == 600 else "Under 100" if lv == 0 else f"{lv}s", "courses": len(v),
                 "gpa": r2(sum(x["gpa"] * x["graded"] for x in v) / sum(x["graded"] for x in v)),
                 "median_course_gpa": r2(statistics.median(x["gpa"] for x in v))}
                for lv, v in sorted(levels.items())]

    # Weighted GPA across the whole tracked set, per regular term
    per_term = {}
    for ts in terms.values():
        for t in ts:
            if t["term"] % 10 == 6:
                continue
            acc = per_term.setdefault(t["term"], {k: 0 for k in PTS})
            for k in PTS:
                acc[k] += t[k]
    campus_trend = [{"term": t, "label": term_label(t), "gpa": r2(gpa_of(v)[0]), "graded": gpa_of(v)[1]}
                    for t, v in sorted(per_term.items()) if gpa_of(v)[1] >= 2000]

    def slim(r, *extra):
        return {"code": r["code"], "title": r["title"], "gpa": r2(r["gpa"]), "mentions": r["mentions"],
                **{k: r2(r[k]) if isinstance(r[k], float) else r[k] for k in extra}}

    spreads = []
    for r in graded:
        lst = per_course_instr.get(r["id"], [])
        if len(lst) >= 2:
            hi, lo = max(lst), min(lst)
            spreads.append({**slim(r), "spread": r2(hi[0] - lo[0]),
                            "high": {"name": hi[2].title(), "gpa": r2(hi[0]), "n": hi[1]},
                            "low": {"name": lo[2].title(), "gpa": r2(lo[0]), "n": lo[1]}})
    spreads.sort(key=lambda x: -x["spread"])
    trending = [r for r in graded if r["trend"] is not None and r["terms_count"] >= 8]
    subj_names = dict(db.execute("SELECT code, abbr FROM subjects"))
    subjects = {}
    for r in graded:
        subjects.setdefault(subj_names.get(r["subject_code"], r["subject_code"]), []).append(r)
    by_subject = sorted([{"subject": s, "courses": len(v), "mentions": sum(x["mentions"] for x in v),
                          "gpa": r2(sum(x["gpa"] * x["graded"] for x in v) / sum(x["graded"] for x in v))}
                         for s, v in subjects.items() if len(v) >= 3], key=lambda x: -x["mentions"])

    insights = {
        "counts": {"courses": len(rows), "from_chat": sum(r["source"] == "chat" for r in rows),
                   "from_enrollment": sum(r["source"] == "enrollment" for r in rows),
                   "with_grades": sum(r["gpa"] is not None for r in rows),
                   "graded_students": sum(r["graded"] for r in rows),
                   "instructors": db.execute("SELECT COUNT(*) FROM instructors").fetchone()[0],
                   "reddit_threads": db.execute("SELECT COUNT(*) FROM reddit_threads").fetchone()[0],
                   "offered_now": db.execute("SELECT COUNT(*) FROM courses WHERE offered_now=1").fetchone()[0],
                   "rejected_seed_codes": len(json.load(open(os.path.join(ROOT, "data", "rejected_codes.json"))))},
        "campus_gpa": r2(campus),
        "correlations": corr,
        "by_level": by_level,
        "campus_trend": campus_trend,
        "instructor_spread": spreads[:12],
        "rising": [slim(r, "trend") for r in sorted(trending, key=lambda r: -r["trend"])[:8]],
        "falling": [slim(r, "trend") for r in sorted(trending, key=lambda r: r["trend"])[:8]],
        "popular_and_tough": [slim(r, "pct_df") for r in sorted(
            [r for r in graded if r["mentions"] >= 8], key=lambda r: r["gpa"])[:8]],
        "quiet_high_gpa": [slim(r, "graded") for r in sorted(
            [r for r in chat if r["mentions"] <= 3 and r["graded"] >= 300],
            key=lambda r: -r["gpa_shrunk"])[:8]],
        "by_subject": by_subject,
        "sentiment_groups": {
            k: {"courses": len(v), "mean_gpa": r2(statistics.fmean(x["gpa"] for x in v)) if v else None}
            for k, v in {"chat_positive": [r for r in chat if r["positive"] > r["negative"]],
                         "chat_negative": [r for r in chat if r["negative"] > r["positive"]],
                         "no_sentiment": [r for r in chat if r["positive"] == r["negative"]]}.items()},
    }
    json.dump(insights, open(INSIGHTS, "w", encoding="utf-8"), indent=1)
    write_report(insights)
    print(f"stats for {len(rows)} courses; insights -> {INSIGHTS}; report -> {REPORT}")
    db.close()


def write_report(ins):
    c, k = ins["correlations"], ins["counts"]

    def rho(x):
        return f"ρ = {x['rho']:+.2f} (p = {x['p']:.3f}, n = {x['n']})" if x else "n/a"

    L = ["# What the data says", "",
         f"Generated by `scripts/analyze.py` from `data/uwcourses.db`: {k['courses']} verified courses, "
         f"{k['graded_students']:,} graded student outcomes, {k['instructors']:,} instructors, "
         f"{k['reddit_threads']} r/UWMadison threads.", "",
         "All correlations are Spearman rank correlations with a 2,000-shuffle permutation p-value. "
         "Only courses with at least 50 graded students are used.", "",
         "## Do peer signals track actual grades?", "",
         "| Signal | vs. course GPA |", "|---|---|",
         f"| Chat mentions (popularity) | {rho(c['mentions_vs_gpa'])} |",
         f"| Chat sentiment (net +/−) | {rho(c['chat_sentiment_vs_gpa'])} |",
         f"| Reddit thread tone (≥3 threads) | {rho(c['reddit_tone_vs_gpa'])} |",
         f"| Course number (level) | {rho(c['course_level_vs_gpa'])} |", "",
         f"Chat volume vs. Reddit volume: {rho(c['chat_vs_reddit_volume'])}.", "",
         "Reading: how often a course is discussed says nothing about its grades, but the tone of public "
         "Reddit threads does track them. The two communities do talk about largely the same courses.", "",
         "Mean GPA by chat-sentiment group: " + ", ".join(
             f"{g.replace('_', ' ')} {v['mean_gpa']} ({v['courses']} courses)"
             for g, v in ins["sentiment_groups"].items()) + ".", "",
         "## GPA by course level", "", "| Level | Courses | Weighted GPA | Median course GPA |", "|---|---|---|---|"]
    L += [f"| {x['level']} | {x['courses']} | {x['gpa']} | {x['median_course_gpa']} |" for x in ins["by_level"]]
    ct = ins["campus_trend"]
    if ct:
        peak = max(ct, key=lambda t: t["gpa"])
        L += ["", "## Grade inflation", "",
              f"Across all tracked courses, fall/spring GPA went from {ct[0]['gpa']:.2f} ({ct[0]['label']}) to "
              f"{ct[-1]['gpa']:.2f} ({ct[-1]['label']}). The single highest term is {peak['label']} "
              f"({peak['gpa']:.2f}), the pandemic semester."]
    L += ["", "## Same course, different instructor", "",
          "Largest gaps between the most and least generous instructor (each with ≥30 graded students):", "",
          "| Course | Spread | Highest | Lowest |", "|---|---|---|---|"]
    L += [f"| {x['code']} | {x['spread']:.2f} | {x['high']['name']} {x['high']['gpa']} | "
          f"{x['low']['name']} {x['low']['gpa']} |" for x in ins["instructor_spread"][:10]]
    L += ["", "## Grade trend", "", "Weighted least-squares slope of term GPA since fall 2016, GPA points per year.",
          "", "| Rising | /yr | Falling | /yr |", "|---|---|---|---|"]
    L += [f"| {a['code']} | {a['trend']:+.3f} | {b['code']} | {b['trend']:+.3f} |"
          for a, b in zip(ins["rising"], ins["falling"])]
    L += ["", "## Popular and tough", "", "Most-discussed courses (≥8 mentions) with the lowest GPA:", "",
          "| Course | GPA | D/F rate | Mentions |", "|---|---|---|---|"]
    L += [f"| {x['code']} {x['title']} | {x['gpa']} | {x['pct_df'] * 100:.1f}% | {x['mentions']} |"
          for x in ins["popular_and_tough"]]
    L += ["", "## Caveats", "",
          "- Chat mentions come from one student community and over-represent its members' majors.",
          "- Sentiment is keyword-based on short text; treat it as a weak signal.",
          "- Reddit years are estimated from sequential post ids (±a few months).",
          "- MadGrades lags the registrar by a term or two; S/U and pass/fail grades are excluded from GPA.",
          "- Instructor GPA includes every section they appear on, including co-taught ones.", ""]
    os.makedirs(os.path.dirname(REPORT), exist_ok=True)
    open(REPORT, "w", encoding="utf-8").write("\n".join(L))


if __name__ == "__main__":
    main()
