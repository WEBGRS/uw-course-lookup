# Regenerate README screenshots (needs worker/data.json, node and Playwright)
import os, pathlib, subprocess, time, urllib.request
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "docs"
PORT = 8791
BASE = f"http://127.0.0.1:{PORT}/"
SHOTS = [("light.png", "light", "", None), ("dark.png", "dark", "#/c/COMP-SCI-577", None),
         ("insights.png", "light", "#/insights", 1500)]

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
            page.goto(BASE + route)
            page.wait_for_selector(".row[data-id]" if not route.startswith("#/insights") else "#v-insights .panel")
            page.wait_for_timeout(900)
            if not route:
                page.hover(".row[data-id='MATH-234']")
                page.wait_for_timeout(700)
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
