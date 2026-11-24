"""Convert the captured hero stills (scripts/posters-raw/*.png, see capture-hero-posters.js) to the small WebP
posters the hero shows before WebGL is ready: 1600 px wide for desktop framing, 780 px for phones."""
from pathlib import Path

from PIL import Image

RAW = Path(__file__).with_name("posters-raw")
OUT = Path(__file__).resolve().parent.parent / "public" / "posters"
OUT.mkdir(parents=True, exist_ok=True)
for png in sorted(RAW.glob("hero-*.png")):
    image = Image.open(png).convert("RGB")
    width = 1600 if "desktop" in png.stem else 780
    image = image.resize((width, round(image.height * width / image.width)), Image.LANCZOS)
    target = OUT / f"{png.stem}.webp"
    image.save(target, "WEBP", quality=58, method=6)
    print(target.name, image.size, target.stat().st_size // 1024, "KB")
