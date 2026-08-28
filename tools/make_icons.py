#!/usr/bin/env python3
"""Generate the 96th Predictor Engine PWA icons (white/black/gold)."""
from PIL import Image, ImageDraw, ImageFont
import os

FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "icons")
os.makedirs(OUT, exist_ok=True)

WHITE = (255, 255, 255, 255)
BLACK = (10, 10, 10, 255)
GOLD = (212, 175, 55, 255)


def make(size, maskable=False):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = 0.78 if maskable else 1.0

    if maskable:
        d.rectangle([0, 0, size, size], fill=BLACK)
    else:
        radius = int(size * 0.22)
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=BLACK)

    cx = cy = size / 2
    ring_r = size * 0.36 * s
    lw = max(2, int(size * 0.035))
    d.ellipse([cx - ring_r, cy - ring_r, cx + ring_r, cy + ring_r], outline=GOLD, width=lw)

    font = ImageFont.truetype(FONT_BOLD, int(size * 0.34 * s))
    text = "96"
    bbox = d.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    d.text((cx - tw / 2 - bbox[0], cy - th / 2 - bbox[1]), text, font=font, fill=GOLD)

    cfont = ImageFont.truetype(FONT_BOLD, int(size * 0.075 * s))
    cap = "PREDICTOR"
    cb = d.textbbox((0, 0), cap, font=cfont)
    cw = cb[2] - cb[0]
    d.text((cx - cw / 2 - cb[0], cy + ring_r + size * 0.03), cap, font=cfont, fill=WHITE)
    return img


if __name__ == "__main__":
    for size, name, mask in [(192, "icon-192.png", False), (512, "icon-512.png", False), (512, "icon-maskable-512.png", True)]:
        make(size, mask).convert("RGB").save(os.path.join(OUT, name), "PNG")
        print("wrote", name)
