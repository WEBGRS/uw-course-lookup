# Regenerate README screenshots (needs worker/data.json, node, Playwright and Pillow)
import os, pathlib, subprocess, time, urllib.request
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "docs"
PORT = 8791
BASE = f"http://127.0.0.1:{PORT}/"
TRANSCRIPT = """MATH 221 Calculus and Analytic Geometry 1 5.000 5.000 B
MATH 222 Calculus and Analytic Geometry 2 4.000 4.000 A
COMP SCI 300 Programming II 3.000 3.000 A
COMP SCI 400 Programming III 3.000 3.000 AB
COMP SCI/MATH 240 Intro to Discrete Mathematics 3.000 3.000 A
STAT 240 Data Science Modeling I 4.000 4.000 B"""   # made up for the picture


def plan_page(page):
    page.goto(BASE + "#/plan")
    page.wait_for_selector("#pgInput")
    page.fill("#pgInput", "Computer Sciences, BS")
    page.dispatch_event("#pgInput", "change")
    page.wait_for_selector(".prog-sum")
    page.click("#pgImport")
    page.fill("#impText", TRANSCRIPT)
    page.click("#impRead")
    page.click("#impApply")
    for q in ("cs 577", "math 340"):
        page.fill("#addQ", q)
        page.wait_for_selector("#addRes button")
        page.click("#addRes button >> nth=0")
    page.click("#build")
    page.wait_for_selector(".cal")
    page.wait_for_timeout(500)
    page.evaluate("document.querySelector('#stResults').scrollIntoView(); scrollBy(0, -90)")
    page.wait_for_timeout(300)


SHOTS = [("light.png", "light", "", None), ("plan.png", "light", None, 900),
         ("dark.png", "dark", "#/c/COMP-SCI-577", None), ("insights.png", "light", "#/insights", 1500)]

# Local server: page + API from worker/data.json
srv = subprocess.Popen(["node", "worker/dev-server.mjs", str(PORT)], cwd=ROOT, env={**os.environ, "NO_LIMIT": "1"})
try:
    for _ in range(50):
        try:
            urllib.request.urlopen(BASE + "api/health", timeout=1)
            break
        except OSError:
            time.sleep(0.2)
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True, args=["--lang=en-US"])
        for name, theme, route, height in SHOTS:
            page = b.new_page(viewport={"width": 1280, "height": height or 820}, locale="en-US", color_scheme=theme,
                              device_scale_factor=1.25)
            if route is None:
                plan_page(page)
            else:
                page.goto(BASE + route)
                page.wait_for_selector(".row[data-id]" if not route.startswith("#/insights") else "#v-insights .panel")
                if route.startswith("#/c/"):
                    page.wait_for_selector("#dSections table")
                page.wait_for_timeout(900)
            page.screenshot(path=str(OUT / name))
            page.close()
        b.close()
finally:
    srv.terminate()

# Shrink PNGs
from PIL import Image
for name, *_ in SHOTS:
    f = OUT / name
    Image.open(f).convert("RGB").quantize(256, method=2).save(f, optimize=True)
print("saved to", OUT)
