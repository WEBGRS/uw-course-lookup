# -*- coding: utf-8 -*-
"""Render index.html from an anonymized courses.json (data embedded for offline use).

Usage:
    python build_site.py --data ../courses.json --out ../index.html
"""
import argparse, json, os

TEMPLATE = os.path.join(os.path.dirname(__file__), "index.template.html")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="../courses.json")
    ap.add_argument("--out", default="../index.html")
    a = ap.parse_args()
    rows = json.load(open(a.data, encoding="utf-8"))
    data = json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
    html = open(TEMPLATE, encoding="utf-8").read().replace("__DATA__", data)
    open(a.out, "w", encoding="utf-8").write(html)
    print(f"{len(rows)} courses -> {a.out}")


if __name__ == "__main__":
    main()
