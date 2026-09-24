# Regenerate README screenshots
import pathlib
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "docs"
URL = (ROOT / "index.html").as_uri()
SHOTS = [("light.png", "light", "", None), ("dark.png", "dark", "#/c/COMP-SCI-577", None),
         ("insights.png", "light", "#/insights", 1500)]

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--lang=en-US"])
    for name, theme, route, height in SHOTS:
        page = b.new_page(viewport={"width": 1280, "height": height or 820}, locale="en-US", color_scheme=theme,
                          device_scale_factor=1.25)
        page.goto(URL + route)
        page.wait_for_timeout(900)
        page.screenshot(path=str(OUT / name))
        page.close()
    b.close()

# Shrink PNGs
from PIL import Image
for name, *_ in SHOTS:
    f = OUT / name
    Image.open(f).convert("RGB").quantize(256, method=2).save(f, optimize=True)
print("saved to", OUT)
