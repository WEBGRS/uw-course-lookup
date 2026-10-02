# -*- coding: utf-8 -*-
"""Scrape degree requirements from guide.wisc.edu into assets/programs/*.json (public data, served by Pages).

Each requirements page is a run of headings and course-list tables. A table row is a course (one or more
cross-listed designations), an "or" alternative to the row above, or a comment such as "Complete two:".
We keep that shape: blocks of items, each block with a rule (all / n courses / credits).

Usage:
    python scripts/fetch_programs.py            # discover, fetch (cached) and rebuild everything
    python scripts/fetch_programs.py --only computer-sciences-bs
"""
import argparse, json, os, re, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor

from bs4 import BeautifulSoup

sys.path.insert(0, os.path.dirname(__file__))
import uwapi  # noqa: E402

ROOT = uwapi.ROOT
GUIDE = "https://guide.wisc.edu"
CACHE = os.path.join(uwapi.CACHE, "guide")
OUT = os.path.join(ROOT, "assets", "programs")
UA = uwapi.UA
NUM = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10}
DEGREE_RE = re.compile(r"-(b[a-z]{1,4})(?:-[a-z]+)?/$")


def fetch(path):
    os.makedirs(CACHE, exist_ok=True)
    f = os.path.join(CACHE, path.strip("/").replace("/", "__") + ".html")
    if os.path.exists(f):
        return open(f, encoding="utf-8").read()
    html = urllib.request.urlopen(urllib.request.Request(GUIDE + path, headers={"User-Agent": UA}), timeout=40).read().decode("utf-8", "replace")
    open(f, "w", encoding="utf-8").write(html)
    return html


def discover():
    html = fetch("/undergraduate/")
    links = set(re.findall(r'href="(/undergraduate/[a-z0-9\-]+/[a-z0-9\-]+/[a-z0-9\-]+/)"', html))
    return sorted(p for p in links if DEGREE_RE.search(p))


def clean(s):
    return re.sub(r"\s+", " ", (s or "").replace("​", "").replace("\xa0", " ")).strip()


def to_id(designation):
    return re.sub(r"\s+", "-", clean(designation))


def designations(text):
    """'COMP SCI/MATH 240' -> ['COMP SCI 240', 'MATH 240']; 'E C E 252' stays one subject."""
    text = clean(text)
    m = re.match(r"^(.*?)\s+([A-Z]?\d{2,3}[A-Z]?)$", text)
    if not m:
        return []
    return [f"{s.strip()} {m.group(2)}" for s in m.group(1).split("/") if s.strip()]


def parse_rule(text):
    """Comment row -> rule dict, or None when it is only a note."""
    s = clean(text).lower().rstrip(":")
    m = re.search(r"\b(?:complete|select|choose|take|earn)\s+(?:at least\s+|a minimum of\s+|a total of\s+)?(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b(\s+(?:or more\s+)?(credits?|courses?|of))?", s)
    if m:
        n = NUM.get(m.group(1)) or int(m.group(1))
        unit = (m.group(3) or "").rstrip("s")
        if unit == "credit" or (unit != "course" and n > 6 and "credit" in s):
            return {"t": "cr", "c": n}
        return {"t": "n", "n": n}
    m = re.search(r"^(one|two|three|four|five|six|seven|eight|nine|ten|\d+) (courses?|credits?)( from| of)?\b", s)
    if m:
        n = NUM.get(m.group(1)) or int(m.group(1))
        return {"t": "cr", "c": n} if m.group(2).startswith("credit") else {"t": "n", "n": n}
    if re.search(r"\b(complete|take) (all|both|the following)\b", s):
        return {"t": "all"}
    if re.search(r"\b(complete|select|choose) either\b", s):
        return {"t": "n", "n": 1}
    return None


def credits_of(td):
    t = clean(td.get_text()) if td else ""
    return t or None


def parse_table(tbl, heading, intro):
    blocks, cur = [], None

    def start(rule=None, title="", note=""):
        nonlocal cur
        if cur and cur["items"]:
            blocks.append(cur)
        cur = {"h": heading + (" › " + title if title else ""), "rule": rule or {"t": "all"}, "note": note, "items": []}

    start(note=intro)
    if len(intro) <= 140 and not ALLISH.search(intro):  # a lead-in sentence that is itself the rule ("Complete one of the following:")
        cur["rule"] = parse_rule(intro) or cur["rule"]
    for tr in tbl.find_all("tr"):
        cls = tr.get("class") or []
        if "listsum" in cls or "hidden" in cls or "sctablehead" in cls:
            continue
        cm = tr.find("span", class_="courselistcomment")
        if cm or "areaheader" in cls:
            txt = clean((cm or tr).get_text())
            rule = parse_rule(txt)
            if rule or "areaheader" in cls:
                start(rule, "" if rule else txt, "" if rule else "")
                if rule and len(txt) > 28:
                    cur["note"] = txt
            else:
                cur["note"] = (cur["note"] + " " + txt).strip() if cur["items"] == [] else cur["note"]
                if cur["items"]:
                    start(note=txt)
            continue
        code = tr.find("td", class_="codecol")
        if not code:
            continue
        a = code.find("a", class_="bubblelink")
        title_td = code.find_next_sibling("td")
        title = clean(title_td.get_text()) if title_td else ""
        cr = credits_of(tr.find("td", class_="hourscol"))
        if not a:  # text-only row ("Electives", "or" rows without a link)
            txt = clean(code.get_text())
            if txt and cur is not None and not cur["items"] and not cur["note"]:
                cur["note"] = txt + (" " + title if title else "")
                if cur["rule"]["t"] == "all":
                    cur["rule"] = parse_rule(cur["note"]) or cur["rule"]
            continue
        ds = designations(a.get("title") or a.get_text()) or designations(a.get_text())
        if not ds:
            continue
        opt = {"i": [to_id(d) for d in ds], "t": title}
        if cr:
            opt["c"] = cr
        if "orclass" in cls and cur["items"]:
            cur["items"][-1]["o"].append(opt)
        else:
            cur["items"].append({"o": [opt]})
    if cur and cur["items"]:
        blocks.append(cur)
    for b in blocks:  # a rule we could not read: keep the courses as suggestions and show the note
        if b["rule"]["t"] == "all" and RULEISH.search(b["note"]) and not ALLISH.search(b["note"]):
            b["rule"] = {"t": "info"}
    return blocks


RULEISH = re.compile(r"\b(complete|select|choose|minimum|at least|credits?|courses?)\b", re.I)
ALLISH = re.compile(r"^(complete|take) (all|both|the following( courses?)?)\b|^students must complete|as detailed below", re.I)
SKIP_H2 = re.compile(r"university requirements|residence|honors|footnote|learning outcomes|four-year|advising|resources", re.I)


def parse_program(html, path):
    soup = BeautifulSoup(html, "lxml")
    for sup in soup.find_all("sup"):  # footnote markers
        sup.decompose()
    h1 = soup.find("h1", class_="page-title") or soup.find_all("h1")[-1:] and soup.find_all("h1")[-1]
    h2s = soup.find_all("h2", attrs={"name": "requirementstext"})
    if not h1 or not h2s:
        return None
    parts = path.strip("/").split("/")
    m = DEGREE_RE.search(path)
    prog = {"id": parts[-1], "name": clean(h1.get_text()), "college": parts[1].replace("-", " ").title(),
            "degree": m.group(1).upper() if m else "", "url": GUIDE + path, "blocks": []}
    heading, intro, active, section = "", "", False, ""
    for el in h2s[0].find_all_next(["h2", "h3", "h4", "table", "p"]):
        if el.name == "h2":
            title = clean(el.get_text())
            active = el.get("name") == "requirementstext" and not SKIP_H2.search(title)
            section = "" if re.search(r"major|requirements for", title, re.I) and not re.search(r"school|college", title, re.I) else title
            heading, intro = "", ""
            continue
        if not active:
            continue
        if el.name in ("h3", "h4"):
            t = clean(el.get_text())
            heading = t if el.name == "h3" else (heading.split(" › ")[0] + " › " + t)
            intro = ""
        elif el.name == "p":
            t = clean(el.get_text())
            if 20 < len(t) < 320 and not intro:
                intro = t
        elif el.name == "table" and "sc_courselist" in (el.get("class") or []):
            head = " › ".join(x for x in (section, heading) if x) or "Requirements"
            prog["blocks"] += parse_table(el, head, intro)
            intro = ""
    # "COMP SCI courses may only fulfill one COMP SCI major requirement area": a course counts once within that family
    if re.search(r"may only fulfill one [A-Z ]*major requirement area", soup.get_text(" ")):
        fam = next((b["h"].split(" › ")[0] for b in prog["blocks"] if b["h"].startswith("Advanced")), None)
        if fam:
            prog["exclusive"] = fam
    return prog if sum(len(b["items"]) for b in prog["blocks"]) >= 3 else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only")
    a = ap.parse_args()
    paths = [p for p in discover() if not a.only or p.strip("/").endswith(a.only)]
    print(len(paths), "program pages")
    with ThreadPoolExecutor(6) as ex:
        htmls = list(ex.map(fetch, paths))
    os.makedirs(OUT, exist_ok=True)
    index, skipped = [], []
    for path, html in zip(paths, htmls):
        p = parse_program(html, path)
        if not p:
            skipped.append(path)
            continue
        with open(os.path.join(OUT, p["id"] + ".json"), "w", encoding="utf-8") as f:
            json.dump(p, f, ensure_ascii=False, separators=(",", ":"))
        index.append({k: p[k] for k in ("id", "name", "college", "degree")})
    index.sort(key=lambda x: x["name"])
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(index)} programs written to assets/programs; {len(skipped)} skipped (no course tables)")
    if skipped:
        print("skipped:", ", ".join(s.strip('/').split('/')[-1] for s in skipped[:40]))


if __name__ == "__main__":
    main()
