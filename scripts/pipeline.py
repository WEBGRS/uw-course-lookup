# -*- coding: utf-8 -*-
"""Run the whole build: database -> (Reddit) -> analysis -> site -> tests.

Usage:
    python scripts/pipeline.py              # rebuild from cache, keep existing Reddit data
    python scripts/pipeline.py --refresh    # re-fetch this term's sections (seats change daily)
    python scripts/pipeline.py --reddit     # also re-query r/UWMadison (needs FIRECRAWL_API_KEY)
"""
import argparse, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))


def run(*args):
    print("\n$", " ".join(args), flush=True)
    subprocess.run([sys.executable, *args], check=True, cwd=os.path.dirname(HERE))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--reddit", action="store_true")
    a = ap.parse_args()
    run(os.path.join(HERE, "build_db.py"), *(["--refresh"] if a.refresh else []))
    if a.reddit:
        run(os.path.join(HERE, "fetch_reddit.py"))
        run(os.path.join(HERE, "build_db.py"))
    run(os.path.join(HERE, "analyze.py"))
    run(os.path.join(HERE, "build_site.py"))
    run("-m", "unittest", "discover", "-s", "tests")


if __name__ == "__main__":
    main()
