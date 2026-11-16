#!/usr/bin/env python3
"""Placeholder Qono icons.

A flat indigo tile with a white Q. Not a final brand mark.
Run from the repo root: python3 scripts/generate-icons.py
"""

import io
import struct
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
INDIGO = (63, 58, 208, 255)
WHITE = (255, 255, 255, 255)
RED = (226, 48, 64, 255)
BLACK = (0, 0, 0, 255)


def render(size, sharing=False, template=False):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0) if template else INDIGO)
    draw = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT, max(8, int(size * 0.68)))
    fill = BLACK if template else WHITE
    text = "Q"
    bbox = draw.textbbox((0, 0), text, font=font)
    x = (size - (bbox[2] - bbox[0])) / 2 - bbox[0]
    y = (size - (bbox[3] - bbox[1])) / 2 - bbox[1] - size * 0.04
    draw.text((x, y), text, font=font, fill=fill)
    if sharing:
        radius = max(2, int(round(size * 0.16)))
        margin = max(1, size // 16)
        cx = size - radius - margin
        cy = size - radius - margin
        if template:
            draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=BLACK)
        else:
            ring = max(1, size // 28)
            draw.ellipse(
                (cx - radius - ring, cy - radius - ring, cx + radius + ring, cy + radius + ring),
                fill=WHITE,
            )
            draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=RED)
    return img


def save_ico(path, images):
    """BMP-backed ICO via Pillow so electron-builder / rcedit accept it."""
    largest = max(images, key=lambda im: im.width)
    largest.save(
        path,
        format="ICO",
        sizes=[(im.width, im.height) for im in images],
    )


def save_png_ico(path, images):
    """PNG-in-ICO, used for the tray so each size stays a crisp render."""
    blobs = []
    for im in images:
        buf = io.BytesIO()
        im.save(buf, format="PNG")
        blobs.append(buf.getvalue())
    offset = 6 + 16 * len(blobs)
    entries = []
    for im, data in zip(images, blobs):
        w = 0 if im.width >= 256 else im.width
        h = 0 if im.height >= 256 else im.height
        entries.append(struct.pack("<BBBBHHII", w, h, 0, 0, 1, 32, len(data), offset))
        offset += len(data)
    with path.open("wb") as handle:
        handle.write(struct.pack("<HHH", 0, 1, len(blobs)))
        for entry in entries:
            handle.write(entry)
        for blob in blobs:
            handle.write(blob)


def main():
    build = ROOT / "build"
    assets = ROOT / "assets"
    build.mkdir(exist_ok=True)
    assets.mkdir(exist_ok=True)

    render(1024).save(build / "icon.png", format="PNG")
    render(256).save(assets / "icon.png", format="PNG")
    app_sizes = [render(size) for size in (16, 24, 32, 48, 64, 128, 256)]
    save_ico(build / "icon.ico", app_sizes)

    for name, sharing in (("tray", False), ("tray-sharing", True)):
        sizes = [render(size, sharing=sharing) for size in (16, 20, 24, 32, 48, 64)]
        save_png_ico(assets / f"{name}.ico", sizes)
        render(64, sharing=sharing).save(assets / f"{name}.png", format="PNG")
        render(32, sharing=sharing, template=True).save(assets / f"{name}Template.png", format="PNG")

    print("wrote placeholder Q icons")


if __name__ == "__main__":
    main()
