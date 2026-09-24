# Regenerate README screenshots in light and dark theme
import pathlib
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "docs"

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--lang=en-US"])
    for theme in ["light", "dark"]:
        page = b.new_page(viewport={"width": 1100, "height": 760}, locale="en-US", color_scheme=theme,
                          device_scale_factor=1.5)
        page.goto((ROOT / "index.html").as_uri())
        page.evaluate(f"document.documentElement.setAttribute('data-theme', '{theme}')")
        page.wait_for_timeout(800)
        page.screenshot(path=str(OUT / f"{theme}.png"))
        page.close()
    b.close()

# Shrink PNGs
from PIL import Image
for f in OUT.glob("*.png"):
    Image.open(f).convert("RGB").quantize(256, method=2).save(f, optimize=True)
print("saved to", OUT)
