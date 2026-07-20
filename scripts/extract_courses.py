# -*- coding: utf-8 -*-
"""Extract UW-Madison course codes from a decrypted WeChat group chat.

Outputs an ANONYMIZED courses.json (course code + aggregate counts only).
No message text, names, or ids are ever written out.

Usage:
    python extract_courses.py --db merge_all.db --group "<id>@chatroom" --out ../courses.json
"""
import argparse, json, re, sqlite3
from collections import defaultdict
from wxlib import sender_from_bytes  # noqa: F401  (kept for downstream reuse)

# Structural / false-positive tokens that are not real subjects
NOISE = set("""LEC SECTION SEC DIS LAB ROOM ZOOM COVID PM SEM ONLINE HTTP WWW COM ORG APT UNIT
FL NO ID VER APP OFFICE FALL WORK EARN FORM REFER TB IB CX UA SP HG DL AA CALL HIS TA ED GEN
LS IS MA CA JAVA STUDIES SCIENCE SCIENCES PHY PHYSIC PHILO""".split())

# Common abbreviation -> canonical subject
ALIAS = {"STATS": "STAT", "PSY": "PSYCH", "MICRO": "MICROBIO", "POL": "POLISCI", "PS": "POLISCI",
         "THEATER": "THEATRE", "COMPSCI": "CS", "SCI": "NUTRISCI", "NTRSCI": "NUTRISCI",
         "NUTRI": "NUTRISCI", "ENG": "ENGL", "ENGLISH": "ENGL", "GER": "GERMAN", "ZOO": "ZOOLOGY",
         "ASIALANG": "ASIAN", "PHYS": "PHYSICS", "CALC": "MATH", "PHIL": "PHILOS", "MKT": "MARKETING",
         "ACCTG": "ACCT", "GENETIC": "GENETICS", "EDUPOL": "EDPOL", "AST": "ASTRON", "OCN": "ATMOCN"}

# Recognized UW-Madison subjects -> MadGrades full-text search term (higher hit rate)
SUBJ = {"CS": "computer sciences", "MATH": "mathematics", "STAT": "statistics", "CHEM": "chemistry",
        "PHYSICS": "physics", "ECON": "economics", "BIOCHEM": "biochemistry", "BIO": "biology",
        "GENETICS": "genetics", "MICROBIO": "microbiology", "PSYCH": "psychology", "SOC": "sociology",
        "ANTHRO": "anthropology", "ART": "art", "MUSIC": "music", "THEATRE": "theatre", "DANCE": "dance",
        "PHILOS": "philosophy", "HIST": "history", "HISTORY": "history", "POLISCI": "political science",
        "ASIAN": "asian", "CHINESE": "chinese", "JAPANESE": "japanese", "KOREAN": "korean",
        "FRENCH": "french", "GERMAN": "german", "SPANISH": "spanish", "LING": "linguistics",
        "LIS": "information", "DS": "data science", "ECE": "electrical computer engineering",
        "ME": "mechanical engineering", "BME": "biomedical engineering", "EMA": "engineering mechanics",
        "NUTRISCI": "nutritional sciences", "KINES": "kinesiology", "GEOG": "geography",
        "GEOSCI": "geoscience", "ASTRON": "astronomy", "ATMOCN": "atmospheric oceanic",
        "EDPOL": "educational policy", "EDUPSY": "educational psychology", "CURRIC": "curriculum",
        "RPSE": "rehabilitation psychology", "ESL": "esl", "ENGL": "english", "COMM": "communication",
        "FINANCE": "finance", "ACCT": "accounting", "MHR": "management human resources",
        "MARKETING": "marketing", "GENBUS": "general business", "NURSING": "nursing",
        "FOLKLORE": "folklore", "LITTRANS": "literature in translation", "SLAVIC": "slavic",
        "CLASSICS": "classics", "AFROAMER": "afro american", "INTEGSCI": "integrated science",
        "LSC": "life sciences communication", "ENTOM": "entomology", "BOTANY": "botany",
        "ZOOLOGY": "zoology", "AGRONOMY": "agronomy", "HORT": "horticulture", "MATSCI": "materials science"}

CODE_RE = re.compile(r"(?<![A-Za-z])([A-Za-z]{2,8}(?:\s?[/&]\s?[A-Za-z]{2,8})?)\s?[-]?\s?(\d{3})(?![0-9A-Za-z])")
# Sentiment keywords (Chinese peer chat). Used only for aggregate +/- counts.
POS = ["推荐", "好过", "简单", "水课", "很水", "给分", "甜", "捞", "轻松", "划水", "值得", "easy", "gpa",
       "无脑", "好拿", "高分", "神课", "包a", "包A"]
NEG = ["劝退", "别选", "坑", "慎", "挂科", "变态", "杀手", "折磨", "地狱", "难拿", "版本陷阱", "耗时"]


def canon(subj_raw, num):
    s = re.sub(r"\s", "", subj_raw).upper().split("/")[0].split("&")[0]
    s = ALIAS.get(s, s)
    return s, f"{s} {num}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True, help="decrypted merge_all.db path")
    ap.add_argument("--group", required=True, help="target chatroom id, e.g. 12345@chatroom")
    ap.add_argument("--out", default="courses.json")
    a = ap.parse_args()

    conn = sqlite3.connect(a.db)
    agg = defaultdict(lambda: {"n": 0, "pos": 0, "neg": 0})
    q = "SELECT StrContent FROM MSG WHERE StrTalker=? AND Type=1"
    for (sc,) in conn.execute(q, (a.group,)):
        if not sc:
            continue
        hits = {canon(m.group(1), m.group(2)) for m in CODE_RE.finditer(sc)}
        pos = any(k in sc for k in POS)
        neg = any(k in sc for k in NEG)
        for subj, key in hits:
            if subj in NOISE:
                continue
            d = agg[key]; d["n"] += 1
            d["pos"] += pos; d["neg"] += neg
    conn.close()

    rows = []
    for key, d in agg.items():
        subj, num = key.split()
        if not (subj in SUBJ or d["n"] >= 3):  # drop long-tail false positives
            continue
        word = SUBJ.get(subj, "")
        rows.append({"code": key, "subj": subj, "num": num, "n": d["n"],
                     "pos": int(d["pos"]), "neg": int(d["neg"]),
                     "mg": (word + " " + num).strip() if word else key})
    rows.sort(key=lambda r: (-r["n"], r["code"]))
    json.dump(rows, open(a.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"{len(rows)} courses -> {a.out}")


if __name__ == "__main__":
    main()
