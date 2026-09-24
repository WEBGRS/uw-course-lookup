# -*- coding: utf-8 -*-
"""Collect public r/UWMadison threads about each course -> data/reddit.json.

Reddit blocks anonymous API calls, so this goes through Firecrawl web search
(needs $FIRECRAWL_API_KEY, ~2 credits per course; results are cached).
Only thread title, link and the search snippet are kept - no usernames, no comment bodies.

Usage:
    python scripts/fetch_reddit.py [--limit 10] [--workers 4]
"""
import argparse, json, os, re, sqlite3, sys
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(__file__))
import uwapi  # noqa: E402

OUT = os.path.join(uwapi.ROOT, "data", "reddit.json")
DB = os.path.join(uwapi.ROOT, "data", "uwcourses.db")
SEARCH = "https://api.firecrawl.dev/v2/search"
USER_RE = re.compile(r"(?<![A-Za-z0-9])/?u/[A-Za-z0-9_-]+")  # strip usernames from snippets
POST_RE = re.compile(r"reddit\.com/r/UWMadison/comments/([a-z0-9]+)", re.I)

# Reddit post ids are sequential base-36; (first id of year) anchors, approximate
YEAR_ANCHORS = [(2012, "o0000"), (2013, "15ww00"), (2014, "1u0000"), (2015, "2r0000"), (2016, "3yzzzz"),
                (2017, "5l3000"), (2018, "7nk000"), (2019, "abb000"), (2020, "ei0000"), (2021, "koa000"),
                (2022, "rt0000"), (2023, "1000000"), (2024, "18vg000"), (2025, "1hr0000"), (2026, "1q10000")]

POS = ["easy", "easiest", "chill", "fun", "great", "love", "loved", "recommend", "gpa booster", "easy a",
       "manageable", "not bad", "doable", "interesting", "best", "enjoy", "enjoyed", "good class", "worth"]
NEG = ["hard", "hardest", "fail", "failing", "failed", "cooked", "struggling", "brutal", "difficult", "avoid",
       "worst", "drop", "dropping", "weed", "terrible", "stress", "stressful", "tough", "rough", "curve"]


def post_year(pid):
    v = int(pid, 36)
    year = None
    for y, anchor in YEAR_ANCHORS:
        if v >= int(anchor, 36):
            year = y
    return year


def tone(text):
    t = text.lower()
    p = sum(bool(re.search(r"\b" + re.escape(w) + r"\b", t)) for w in POS)
    n = sum(bool(re.search(r"\b" + re.escape(w) + r"\b", t)) for w in NEG)
    return (p > n) - (n > p)


def designations(code, aliases, seeds):
    """Ways students write the course: 'COMP SCI 577', 'CS 577', 'CS577'."""
    out = []
    for d in [code, *aliases, *seeds]:
        for v in (d, d.replace(" ", "")):
            if v not in out:
                out.append(v)
    return out[:6]


def search(query, limit, key):
    body = {"query": query, "limit": limit, "sources": ["web"]}
    r = uwapi._fetch(SEARCH, {"Authorization": "Bearer " + key, "Content-Type": "application/json"}, body)
    return ((r or {}).get("data") or {}).get("web") or []


def collect(row, limit, key):
    code, aliases, seeds, num = row
    names = designations(code, aliases, seeds)
    q = "site:reddit.com/r/UWMadison (" + " OR ".join(f'"{n}"' for n in names) + ")"
    threads = {}
    try:
        hits = search(q, limit, key)
    except Exception as e:  # keep going; rerun fills gaps from cache
        print(f"  {code}: {type(e).__name__} {e}")
        return code, None
    for hit in hits:
        m = POST_RE.search(hit.get("url", ""))
        text = f"{hit.get('title', '')} {hit.get('description', '')}"
        if not m or not re.search(r"(?<!\d)" + num + r"(?!\d)", text):  # must actually name the course number
            continue
        title = re.sub(r"\s*:\s*r/UWMadison.*$", "", hit.get("title", "")).strip()
        pid = m.group(1).lower()
        threads[pid] = {"id": pid, "url": f"https://www.reddit.com/r/UWMadison/comments/{pid}/",
                        "title": title[:200], "snippet": USER_RE.sub("", hit.get("description") or "")[:240],
                        "year": post_year(pid), "tone": tone(text)}
    return code, sorted(threads.values(), key=lambda t: -(t["year"] or 0))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=10)
    ap.add_argument("--workers", type=int, default=2)
    a = ap.parse_args()
    key = os.environ.get("FIRECRAWL_API_KEY")
    if not key:
        sys.exit("set FIRECRAWL_API_KEY")

    db = sqlite3.connect(DB)
    rows = []
    for cid, code, num, raw in db.execute(
            "SELECT c.id, c.code, c.number, m.raw_codes FROM courses c JOIN chat_mentions m ON m.course_id=c.id"):
        aliases = [x for (x,) in db.execute("SELECT alias FROM course_aliases WHERE course_id=?", (cid,))
                   if x != code]
        rows.append((code, aliases, json.loads(raw), str(num)))
    db.close()
    with ThreadPoolExecutor(a.workers) as ex:
        res = dict(ex.map(lambda r: collect(r, a.limit, key), rows))
    failed = [k for k, v in res.items() if v is None]
    res = {k: v for k, v in res.items() if v is not None}
    if failed:
        print(f"{len(failed)} failed (rerun to retry): {', '.join(failed)}")
    json.dump(res, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"{sum(len(v) for v in res.values())} threads for {sum(bool(v) for v in res.values())}/{len(res)} "
          f"courses -> {OUT}")


if __name__ == "__main__":
    main()
