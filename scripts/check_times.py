# -*- coding: utf-8 -*-
"""Compare the meeting times in worker/data.json with what public.enroll.wisc.edu shows, section by section.

Enroll's API stores clock times as UTC with a shift; the shift is only known by checking the website, so run this
after building a new term (python scripts/pipeline.py --term 1274) before trusting the timetable planner.

Needs Playwright (pip install playwright && playwright install chromium).

Usage:
    python scripts/check_times.py                 # 14 courses incl. the earliest and latest classes
    python scripts/check_times.py --n 40 --term 1272
"""
import argparse, json, os, random, re, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "worker", "data.json")
SECTION = re.compile(r"(LEC|DIS|LAB|SEM|STU|REC|IND|FLD|CLN|PRA|TUT|COL|WRK|OTH) \d+")
MEET = re.compile(r"^([MTWRFSU]+) (\d+:\d+ [AP]M) - (\d+:\d+ [AP]M)")


def minutes(t):
    h, m, ap = re.match(r"(\d+):(\d+) ([AP])M", t).groups()
    return (int(h) % 12 + (12 if ap == "P" else 0)) * 60 + int(m)


def ours(data, cid):
    out = {}
    for p in data["sections"].get(cid, []):
        for s in p["s"]:
            if s["m"]:
                out[f'{s["t"]} {s["n"]}'] = sorted((d, a, b) for d, a, b, _ in s["m"])
    return out


class Blocked(Exception):
    """public.enroll.wisc.edu answered with CloudFront's 403: too many automated requests, wait and retry."""


def official(page, term, code):
    page.goto(f"https://public.enroll.wisc.edu/search?term={term}&keywords=" + code.replace(" ", "%20"), wait_until="networkidle", timeout=60000)
    page.wait_for_timeout(1500)
    if "Request blocked" in page.inner_text("body"):
        raise Blocked()
    page.get_by_text(code, exact=True).first.click()
    page.wait_for_timeout(2000)
    page.click("text=See sections")
    page.wait_for_timeout(3500)
    lines = [l.strip() for l in page.inner_text("body").split("\n")]
    out, i = {}, 0
    while i < len(lines):
        if SECTION.fullmatch(lines[i]):
            label, j, meets = lines[i], i + 1, []
            while j < len(lines) and MEET.match(lines[j]):
                d, a, b = MEET.match(lines[j]).groups()
                meets.append((d, minutes(a), minutes(b)))
                j += 1
            if meets:
                out[label] = sorted(meets)
            i = j
        else:
            i += 1
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--term", default="1272")
    ap.add_argument("--n", type=int, default=14, help="how many courses to compare")
    a = ap.parse_args()
    from playwright.sync_api import sync_playwright

    data = json.load(open(DATA, encoding="utf-8"))
    codes = {c["id"]: c["code"] for c in data["courses"]}
    timed = [cid for cid in data["sections"] if ours(data, cid)]
    by_start = sorted(timed, key=lambda c: min(m[1] for v in ours(data, c).values() for m in v))
    picks = list(dict.fromkeys([by_start[0], by_start[-1]] + random.Random(7).sample(timed, a.n)))[:a.n]
    total = bad = 0
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        page = b.new_page(viewport={"width": 1500, "height": 1400}, locale="en-US", timezone_id="America/Chicago")
        for cid in picks:
            try:
                off = official(page, a.term, codes[cid])
            except Blocked:
                print("The official site is rate-limiting this machine (CloudFront 403). Wait a while, or lower --n, and retry.")
                sys.exit(2)
            except Exception as e:
                print(f"  skip {codes[cid]}: {str(e)[:60]}")
                continue
            finally:
                time.sleep(2)   # be polite to the site
            mine = ours(data, cid)
            common = set(mine) & set(off)
            diff = [k for k in common if mine[k] != off[k]]
            total += len(common)
            bad += len(diff)
            print(f"{codes[cid]:14} {len(common):3} sections compared, {len(diff)} differ", f"  e.g. {diff[0]}: ours={mine[diff[0]]} official={off[diff[0]]}" if diff else "")
        b.close()
    print(f"TOTAL: {total} sections, {bad} mismatches")
    sys.exit(1 if bad or not total else 0)


if __name__ == "__main__":
    main()
