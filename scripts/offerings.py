# -*- coding: utf-8 -*-
"""Compact Enroll enrollment packages into the slim form the planner needs.

One package = one valid way to enroll (a lecture plus the discussion/lab that goes with it).
Output per package:
    {"id": "1272-A1-156-105-002-325",   # Enroll's docId: unique (the numeric package id is just the discussion's class number)
     "st": "O|W|C", "seats": 8, "wait": 0,
     "on": 1,            # no meeting times (online / arranged)
     "c": 1,             # needs consent to add
     "s": [{"t": "LEC", "n": "001", "k": 21091, "m": [["MWF", 510, 560, "Van Vleck B102"]],   # k = class number
            "i": ["Jane Doe"], "w": [20332, 20431]}]}   # w only when not the full term
Times are minutes after local midnight.
"""
import collections, datetime

DAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
LETTERS = "MTWRFSU"
DAY_MS = 86400000
STATUS = {"OPEN": "O", "WAITLISTED": "W", "CLOSED": "C"}


def day_no(ms):
    return ms // DAY_MS


def dominant_range(packages):
    """The (start, end) day numbers most sections share: the regular full term."""
    c = collections.Counter()
    for p in packages:
        for s in p.get("sections") or []:
            if s.get("startDate") and s.get("endDate"):
                c[(day_no(s["startDate"]), day_no(s["endDate"]))] += 1
    return c.most_common(1)[0][0] if c else None


# Enroll stores a class's clock time as UTC with a fixed UTC-6 shift (Central *standard* time), also in
# September when Madison is on daylight time. Checked against public.enroll.wisc.edu: COMP SCI 577 LEC 002 is
# 68400000 ms = 19:00 "UTC" and the site shows 1:00 PM.
ENROLL_OFFSET_MS = 6 * 3600000


def local_offset_ms(section=None):
    return ENROLL_OFFSET_MS


def meeting(m, off=ENROLL_OFFSET_MS):
    if m.get("meetingType") != "CLASS" or m.get("meetingTimeStart") is None or m.get("meetingTimeEnd") is None:
        return None
    days = "".join(L for L in LETTERS if L in (m.get("meetingDays") or "")) or \
        "".join(L for L, d in zip(LETTERS, DAYS) if m.get(d))
    if not days:
        return None
    start = ((m["meetingTimeStart"] - off) % DAY_MS) // 60000
    end = ((m["meetingTimeEnd"] - off) % DAY_MS) // 60000
    b = (m.get("building") or {}).get("buildingName") or ""
    room = (m.get("room") or "").strip()
    return [days, start, end, f"{b} {room}".strip()]


def name_of(i):
    n = i.get("name") or {}
    return f"{n.get('first') or ''} {n.get('last') or ''}".strip()


def compact_section(s, base):
    off = local_offset_ms(s)
    ms = [x for x in (meeting(m, off) for m in s.get("classMeetings") or []) if x]
    out = {"t": s.get("type"), "n": s.get("sectionNumber"), "m": ms,
           "i": [n for n in (name_of(i) for i in s.get("instructors") or []) if n]}
    k = (s.get("classUniqueId") or {}).get("classNumber")
    if k:
        out["k"] = k
    if s.get("startDate") and s.get("endDate") and base and (day_no(s["startDate"]), day_no(s["endDate"])) != tuple(base):
        out["w"] = [day_no(s["startDate"]), day_no(s["endDate"])]
    if (s.get("instructionMode") or "").startswith("Online Only"):
        out["o"] = 1
    return out


def compact(packages, base=None):
    """Enroll packages -> list of slim packages (published ones only)."""
    out, consent_only = [], None
    for p in packages or []:
        if p.get("published") is False:
            continue
        secs = [compact_section(s, base) for s in p.get("sections") or []]
        st = p.get("packageEnrollmentStatus") or {}
        rec = {"id": str(p.get("docId") or p.get("id")), "st": STATUS.get(st.get("status"), "C"),
               "seats": st.get("availableSeats") or 0, "wait": st.get("waitlistTotal") or 0, "s": secs}
        timed = any(s["m"] for s in secs)
        if not timed:
            rec["on"] = 1
        if any(((s0.get("addConsent") or {}).get("code") or "N") != "N" for s0 in p.get("sections") or []):
            rec["c"] = 1
            if not timed:  # independent study and the like: dozens of identical consent-only rows, keep one marker
                consent_only = consent_only or {**rec, "s": [{"t": s["t"], "n": s["n"], "m": [], "i": []} for s in secs[:1]]}
                continue
        out.append(rec)
    return out or ([consent_only] if consent_only else [])


def fmt_time(minutes):
    h, m = divmod(minutes, 60)
    return f"{(h + 11) % 12 + 1}:{m:02d}{'a' if h < 12 else 'p'}"


def day_date(n):
    return (datetime.date(1970, 1, 1) + datetime.timedelta(days=n)).isoformat()
