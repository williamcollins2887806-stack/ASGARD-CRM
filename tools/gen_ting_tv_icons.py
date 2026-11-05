#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate Ting TV launcher icons + banner (full-bleed, no plate-in-circle).

Google TV masks app icons to a circle. Baking a rounded square into the asset
leaves empty corners — looks amateur next to RuStore. These assets fill the
canvas edge-to-edge; the mark sits in the adaptive safe zone (~66%).
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "ting-android" / "android" / "app" / "src" / "main" / "res"
WEB = ROOT / "public" / "assets" / "img"

# Vibrant indigo→violet + bright gold (стор-уровень, не «мутный Paint»)
BG_TOP = (18, 22, 58)
BG_BOT = (72, 36, 120)
GOLD = (255, 214, 96)
GOLD_DEEP = (220, 170, 50)
GOLD_SOFT = (255, 224, 140)

DENSITIES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}


def _lerp(a, b, t: float):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def paint_bg(size: int) -> Image.Image:
    """Full-bleed diagonal indigo→violet (как у ярких стор-иконок)."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 255))
    px = img.load()
    cx = cy = size / 2
    rmax = size * 0.78
    for y in range(size):
        for x in range(size):
            # диагональный градиент + лёгкий radial lift
            diag = (x * 0.55 + y * 0.45) / max(size - 1, 1)
            base = _lerp(BG_TOP, BG_BOT, diag)
            dx, dy = x - cx, y - cy
            d = math.sqrt(dx * dx + dy * dy) / rmax
            lift = max(0.0, 1.0 - d) ** 1.6
            # холодный блик по центру (не коричневый)
            r = min(255, int(base[0] + 40 * lift))
            g = min(255, int(base[1] + 28 * lift))
            b = min(255, int(base[2] + 55 * lift))
            edge = max(0.0, d - 0.88) / 0.28
            if edge > 0:
                k = 1 - 0.25 * min(edge, 1)
                r, g, b = int(r * k), int(g * k), int(b * k)
            px[x, y] = (r, g, b, 255)
    return img


def draw_mark(size: int, *, pad_ratio: float = 0.20):
    """Геометрия знака в safe zone; без грязного диска-подложки."""
    pad = size * pad_ratio
    left, top = pad, pad
    right, bottom = size - pad, size - pad
    w = right - left
    h = bottom - top
    cx = (left + right) / 2
    # лёгкое чистое свечение (размытый круг, низкая альфа)
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    glow_r = w * 0.48
    cy = (top + bottom) / 2 - h * 0.02
    gd.ellipse(
        [cx - glow_r, cy - glow_r, cx + glow_r, cy + glow_r],
        fill=(255, 214, 96, 28),
    )
    glow = glow.filter(ImageFilter.GaussianBlur(radius=max(2, size // 18)))
    return glow, (cx, left, top, right, bottom, w, h)


def composite_mark(base: Image.Image, size: int, *, transparent_bg: bool = False) -> Image.Image:
    """Flat gold T — без фальшивого 3D, как у нормальных стор-иконок."""
    if transparent_bg:
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    else:
        canvas = base.copy()

    glow, geom = draw_mark(size)
    cx, left, top, right, bottom, w, h = geom
    canvas = Image.alpha_composite(canvas, glow)

    # 8× supersample → LANCZOS: гладкие края без «Paint»
    scale = 8
    S = size * scale
    hi = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(hi)

    def m(v):
        return v * scale

    bar_h = h * 0.155
    stem_w = w * 0.175
    bar_y0 = top + h * 0.10
    bar_y1 = bar_y0 + bar_h
    bar_x0 = left + w * 0.05
    bar_x1 = right - w * 0.05
    stem_x0 = cx - stem_w / 2
    stem_x1 = cx + stem_w / 2
    stem_y1 = top + h * 0.70
    rad = max(scale, int(size * 0.04 * scale))

    # единая плоская заливка (перекладина + ножка)
    d.rounded_rectangle([m(bar_x0), m(bar_y0), m(bar_x1), m(bar_y1)], radius=rad, fill=GOLD + (255,))
    d.rounded_rectangle([m(stem_x0), m(bar_y0), m(stem_x1), m(stem_y1)], radius=rad, fill=GOLD + (255,))

    # точка «в эфире»
    dot_r = w * 0.058
    gap = h * 0.04
    dot_cy = stem_y1 + gap + dot_r
    d.ellipse(
        [m(cx - dot_r), m(dot_cy - dot_r), m(cx + dot_r), m(dot_cy + dot_r)],
        fill=GOLD + (255,),
    )

    mark = hi.resize((size, size), Image.Resampling.LANCZOS)
    return Image.alpha_composite(canvas, mark)


def make_round(square: Image.Image) -> Image.Image:
    size = square.size[0]
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, size - 1, size - 1], fill=255)
    out = square.copy()
    out.putalpha(mask)
    return out


def make_banner(w: int = 320, h: int = 180) -> Image.Image:
    """Android TV leanback banner 320×180."""
    img = Image.new("RGBA", (w, h), (0, 0, 0, 255))
    px = img.load()
    for y in range(h):
        for x in range(w):
            t = x / max(w - 1, 1)
            v = y / max(h - 1, 1)
            base = _lerp(BG_TOP, BG_BOT, 0.35 * t + 0.65 * v)
            # left gold wash
            wash = max(0.0, 1.0 - abs(x - w * 0.22) / (w * 0.35)) ** 1.5
            r = min(255, int(base[0] + 70 * wash))
            g = min(255, int(base[1] + 50 * wash))
            b = min(255, int(base[2] + 15 * wash))
            px[x, y] = (r, g, b, 255)

    # mark on left
    mark_box = 112
    mark = composite_mark(paint_bg(mark_box), mark_box)
    # circular crop for badge
    mark = make_round(mark)
    img.paste(mark, (28, (h - mark_box) // 2), mark)

    # wordmark «ТИНГ» — baseline по центру, линия строго ПОД буквами
    from PIL import ImageFont
    d = ImageDraw.Draw(img)
    font = None
    for name in (
        "C:/Windows/Fonts/montserratb.ttf",
        "C:/Windows/Fonts/seguisb.ttf",
        "C:/Windows/Fonts/segoeuib.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
    ):
        p = Path(name)
        if p.exists():
            try:
                font = ImageFont.truetype(str(p), 44)
                break
            except OSError:
                pass
    text = "ТИНГ"
    if font:
        bbox = d.textbbox((0, 0), text, font=font)
        tw = bbox[2] - bbox[0]
        ascent = -bbox[1]
        descent = bbox[3]
        th = ascent + descent
        tx = 158
        ty = (h - th) // 2 - bbox[1]
        d.text((tx, ty), text, font=font, fill=GOLD + (255,))
        # акцент-черта под словом (не через глифы)
        rule_y = ty + bbox[3] + 12
        d.rounded_rectangle([tx, rule_y, tx + tw, rule_y + 3], radius=2, fill=(*GOLD_SOFT, 220))
    else:
        d.rectangle([160, 70, 280, 110], fill=GOLD + (255,))
    return img


def write_web_preview(size: int = 512):
    WEB.mkdir(parents=True, exist_ok=True)
    sq = composite_mark(paint_bg(size), size)
    sq.save(WEB / "ting-launcher-512.png", "PNG")
    make_round(sq).save(WEB / "ting-launcher-round-512.png", "PNG")
    # also refresh SVG conceptually via PNG for APK page if needed
    return WEB / "ting-launcher-512.png"


def main() -> int:
    RES.mkdir(parents=True, exist_ok=True)
    for folder, size in DENSITIES.items():
        out_dir = RES / folder
        out_dir.mkdir(parents=True, exist_ok=True)
        # supersample then downscale for AA
        hi = size * 4
        sq = composite_mark(paint_bg(hi), hi).resize((size, size), Image.Resampling.LANCZOS)
        fg = composite_mark(Image.new("RGBA", (hi, hi), (0, 0, 0, 0)), hi, transparent_bg=True)
        fg = fg.resize((size, size), Image.Resampling.LANCZOS)
        rnd = make_round(sq)

        sq.convert("RGBA").save(out_dir / "ic_launcher.png", "PNG")
        rnd.save(out_dir / "ic_launcher_round.png", "PNG")
        fg.save(out_dir / "ic_launcher_foreground.png", "PNG")
        print(f"OK {folder} {size}px")

    # TV banner — official 320×180 xhdpi
    banner_dir = RES / "drawable-xhdpi"
    banner_dir.mkdir(parents=True, exist_ok=True)
    banner = make_banner(320, 180)
    banner.save(banner_dir / "tv_banner.png", "PNG")
    # also plain drawable fallback name without xml conflict: use drawable/tv_banner.png
    # remove xml later; keep png in drawable-xhdpi referenced as @drawable/tv_banner
    print("OK tv_banner 320x180")

    preview = write_web_preview(512)
    print(f"OK web preview {preview}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
