# -*- coding: utf-8 -*-
"""Thin clients for the two public data sources, with an on-disk JSON cache.

- Course Search & Enroll (public.enroll.wisc.edu): catalog, credits, breadths, current sections
- MadGrades (api.madgrades.com): historical grade distributions from UW public records
"""
import hashlib, json, os, re, time, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "data", "cache")
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
ENROLL = "https://public.enroll.wisc.edu/api/search/v1"
ENROLL_HDRS = {"Content-Type": "application/json", "Accept": "application/json", "User-Agent": UA,
               "Origin": "https://public.enroll.wisc.edu", "Referer": "https://public.enroll.wisc.edu/search"}
MADGRADES = "https://api.madgrades.com/v1"


def _cache_path(key):
    return os.path.join(CACHE, hashlib.sha1(key.encode()).hexdigest()[:20] + ".json")


def _fetch(url, headers, body=None, cache=True, tries=6):
    key = url + (json.dumps(body, sort_keys=True) if body else "")
    p = _cache_path(key)
    if cache and os.path.exists(p):
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    data = json.dumps(body).encode() if body is not None else None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers=headers)
            with urllib.request.urlopen(req, timeout=60) as r:
                out = json.load(r)
            break
        except urllib.error.HTTPError as e:
            if e.code == 404:
                out = None
                break
            if i == tries - 1:
                raise
            if e.code == 429:
                time.sleep(int(e.headers.get("Retry-After") or 0) or 15 * (i + 1))
                continue
        except (urllib.error.URLError, TimeoutError):
            if i == tries - 1:
                raise
        time.sleep(1.5 * (i + 1))
    if cache:
        os.makedirs(CACHE, exist_ok=True)
        with open(p, "w", encoding="utf-8") as f:
            json.dump(out, f)
    return out


# ── Course Search & Enroll ──────────────────────────────────────────
def enroll_catalog(term, cache=True):
    """Every course in the term's catalog (paged, 500 per page)."""
    hits, page = [], 1
    while True:
        r = _fetch(ENROLL, ENROLL_HDRS, {"selectedTerm": term, "queryString": "*", "filters": [],
                                         "page": page, "pageSize": 500, "sortOrder": "SUBJECT"}, cache)
        hits += r.get("hits") or []
        if not r.get("hits") or len(hits) >= r["found"]:
            return hits
        page += 1


def enroll_packages(term, subject_code, course_id, cache=True):
    return _fetch(f"{ENROLL}/enrollmentPackages/{term}/{subject_code}/{course_id}", ENROLL_HDRS, cache=cache) or []


# ── MadGrades ──────────────────────────────────────────────────────
_token = None


def madgrades_token():
    """Public app token, read from the MadGrades web bundle (or $MADGRADES_TOKEN)."""
    global _token
    if _token:
        return _token
    _token = os.environ.get("MADGRADES_TOKEN")
    if not _token:
        h = {"User-Agent": UA}
        html = urllib.request.urlopen(urllib.request.Request("https://madgrades.com/", headers=h)).read().decode()
        js = re.search(r'/assets/index-[^"]+\.js', html).group(0)
        bundle = urllib.request.urlopen(urllib.request.Request("https://madgrades.com" + js, headers=h)).read().decode()
        _token = re.search(r"[0-9a-f]{32}", bundle).group(0)
    return _token


def madgrades(path, cache=True):
    return _fetch(MADGRADES + path, {"Authorization": "Token token=" + madgrades_token(), "User-Agent": UA},
                  cache=cache)


def madgrades_course(subject_code, number, cache=True):
    """Course lookup by numeric subject code + catalog number."""
    r = madgrades(f"/courses?subject={subject_code}&number={number}", cache)
    return (r or {}).get("results") or []
