#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
D-369: рамка iPhone 15 Pro для скриншотов мобильной СРМ.

Зачем PIL, а не готовый мокап: в проекте нет `sharp`, а PIL 12.3 стоит. Кадры
снимаются в 1179x2556 (393x852 @ DPR 3) — это ровно пропорции 15 Pro.

Что рисуем:
  • корпус со скруглением и мягкой тенью;
  • чёрная окантовка (bezel) с тонким металлическим блеском по краю;
  • Dynamic Island по центру сверху;
  • кнопки громкости слева, Action button, боковую кнопку справа;
  • градиентную подложку (не белую) — для слайдов презентации.

Корпус и экран рисуются в 3x от целевого размера и уменьшаются с Lanczos:
иначе на закруглениях и «острове» видны ступеньки.

Запуск:  python tools/make_iphone_frames.py
Вход:    tests/reports/_my_requests_shots/[0-9]*.png
Выход:   reports/mobile-my-requests/*.png  (2x для слайдов)
"""
import glob
import os
from PIL import Image, ImageDraw, ImageFilter

SRC = os.path.join("tests", "reports", "_my_requests_shots")
DST = os.path.join("reports", "mobile-my-requests")

# Пропорции iPhone 15 Pro: экран 393x852 pt.
SCREEN_W, SCREEN_H = 393, 852
BEZEL = 11            # толщина окантовки, pt
BODY_PAD = 3          # «металл» вокруг окантовки, pt
RADIUS = 55           # радиус скругления корпуса, pt

SCALE = 3             # рендерим в 3x, потом уменьшаем
OUT_SCALE = 2         # итоговый размер: 2x от pt — для слайдов
MARGIN = 46           # поля под тень, pt

# Тёмная премиум-подложка: глубокий графит с холодным отливом.
BG_TOP = (17, 19, 24)
BG_BOTTOM = (8, 9, 12)


def rounded_mask(size_pt, radius_pt):
    """Маска скруглённого прямоугольника (размеры в pt, рендер в SCALE)."""
    w, h = size_pt[0] * SCALE, size_pt[1] * SCALE
    m = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, w - 1, h - 1], radius=radius_pt * SCALE, fill=255)
    return m


def make_background(size_pt):
    """Вертикальный градиент + мягкое световое пятно сверху."""
    w, h = size_pt[0] * SCALE, size_pt[1] * SCALE
    bg = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(bg)
    for y in range(h):
        t = y / max(1, h - 1)
        r = int(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t)
        g = int(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t)
        b = int(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t)
        d.line([(0, y), (w, y)], fill=(r, g, b))

    # Световое пятно: рисуем маску и размываем — край получается мягким.
    glow = Image.new("L", (w, h), 0)
    gd = ImageDraw.Draw(glow)
    gd.ellipse([-w * 0.35, -h * 0.22, w * 1.05, h * 0.30], fill=64)
    glow = glow.filter(ImageFilter.GaussianBlur(60 * SCALE))
    accent = Image.new("RGB", (w, h), (46, 58, 82))
    return Image.composite(accent, bg, glow)


def build_frame(shot_path, out_path):
    """Накладывает скриншот в рамку iPhone 15 Pro и сохраняет."""
    shot = Image.open(shot_path).convert("RGB")

    # Экран приводим точно к 393x852 (пропорции 15 Pro), затем масштабируем.
    tw, th = SCREEN_W * SCALE, SCREEN_H * SCALE
    if shot.size != (tw, th):
        shot = shot.resize((tw, th), Image.LANCZOS)

    metal = BODY_PAD
    frame_w = SCREEN_W + 2 * (BEZEL + metal)
    frame_h = SCREEN_H + 2 * (BEZEL + metal)
    fw, fh = frame_w * SCALE, frame_h * SCALE

    canvas_pt = (frame_w + 2 * MARGIN, frame_h + 2 * MARGIN)
    canvas = make_background(canvas_pt)
    cw, ch = canvas.size
    ox, oy = MARGIN * SCALE, MARGIN * SCALE  # позиция корпуса на холсте

    # ── корпус: тёмный титан с блеском к середине ──────────────────────────
    body = Image.new("RGB", (fw, fh))
    bd = ImageDraw.Draw(body)
    for y in range(fh):
        t = y / max(1, fh - 1)
        base = int(58 + 26 * (1 - abs(t - 0.5) * 2))
        bd.line([(0, y), (fw, y)], fill=(base, base + 2, base + 5))
    body_mask = rounded_mask((frame_w, frame_h), RADIUS)

    # Тонкий светлый кант по периметру — «дорогой» вид.
    rim = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
    rd = ImageDraw.Draw(rim)
    rd.rounded_rectangle([0, 0, fw - 1, fh - 1], radius=RADIUS * SCALE,
                         outline=(168, 172, 182, 150), width=max(2, SCALE))

    # ── экран ──────────────────────────────────────────────────────────────
    bezel_w_pt = SCREEN_W + 2 * BEZEL
    bezel_h_pt = SCREEN_H + 2 * BEZEL
    bezel_mask = rounded_mask((bezel_w_pt, bezel_h_pt), RADIUS - BODY_PAD)
    bezel_layer = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
    bezel_layer.paste((6, 6, 8, 255), (metal * SCALE, metal * SCALE,
                                       metal * SCALE + bezel_w_pt * SCALE,
                                       metal * SCALE + bezel_h_pt * SCALE),
                      bezel_mask)

    sc_x = (metal + BEZEL) * SCALE
    sc_y = (metal + BEZEL) * SCALE
    shot_mask = rounded_mask((SCREEN_W, SCREEN_H), RADIUS - BODY_PAD - BEZEL + 3)
    screen_layer = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
    screen_layer.paste(shot, (sc_x, sc_y), shot_mask)

    # ── Dynamic Island ─────────────────────────────────────────────────────
    island_w, island_h = 125, 36
    ix = ((frame_w - island_w) // 2) * SCALE
    iy = (metal + BEZEL + 11) * SCALE
    island = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
    idr = ImageDraw.Draw(island)
    idr.rounded_rectangle([ix, iy, ix + island_w * SCALE, iy + island_h * SCALE],
                          radius=(island_h // 2) * SCALE, fill=(0, 0, 0, 255))

    # ── кнопки ─────────────────────────────────────────────────────────────
    btns = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    bdr = ImageDraw.Draw(btns)
    # Левая сторона: Action button + две кнопки громкости.
    for dy, bh in [(150, 30), (205, 58), (278, 58)]:
        bdr.rounded_rectangle(
            [ox - 4 * SCALE, oy + dy * SCALE, ox, oy + (dy + bh) * SCALE],
            radius=2 * SCALE, fill=(72, 74, 80, 255))
    # Правая сторона: боковая кнопка.
    bdr.rounded_rectangle(
        [ox + fw, oy + 215 * SCALE, ox + fw + 4 * SCALE, oy + 315 * SCALE],
        radius=2 * SCALE, fill=(72, 74, 80, 255))

    # ── сборка: тень -> корпус -> кант -> окантовка -> экран -> остров ─────
    shadow_src = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    sdr = ImageDraw.Draw(shadow_src)
    sdr.rounded_rectangle([ox + 6 * SCALE, oy + 14 * SCALE,
                           ox + fw + 6 * SCALE, oy + fh + 14 * SCALE],
                          radius=RADIUS * SCALE, fill=(0, 0, 0, 175))
    shadow = shadow_src.filter(ImageFilter.GaussianBlur(18 * SCALE))

    out = canvas.convert("RGBA")
    out = Image.alpha_composite(out, shadow)
    out = Image.alpha_composite(out, btns)

    body_rgba = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    body_rgba.paste(body, (ox, oy), body_mask)
    out = Image.alpha_composite(out, body_rgba)

    rim_rgba = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    rim_rgba.paste(rim, (ox, oy), rim)
    out = Image.alpha_composite(out, rim_rgba)

    bezel_rgba = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    bezel_rgba.paste(bezel_layer, (ox, oy), bezel_layer)
    out = Image.alpha_composite(out, bezel_rgba)

    screen_rgba = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    screen_rgba.paste(screen_layer, (ox, oy), screen_layer)
    out = Image.alpha_composite(out, screen_rgba)

    island_rgba = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    island_rgba.paste(island, (ox, oy), island)
    out = Image.alpha_composite(out, island_rgba)

    # Уменьшаем до 2x от pt — чётко на слайдах и без ступенек.
    final = out.convert("RGB").resize((canvas_pt[0] * OUT_SCALE, canvas_pt[1] * OUT_SCALE),
                                      Image.LANCZOS)
    final.save(out_path, "PNG", optimize=True)
    return final.size


def main():
    os.makedirs(DST, exist_ok=True)
    files = sorted(glob.glob(os.path.join(SRC, "[0-9]*.png")))
    if not files:
        raise SystemExit("Нет скриншотов в " + SRC)
    print("кадров: %d" % len(files))
    for f in files:
        name = os.path.basename(f)
        out = os.path.join(DST, name)
        size = build_frame(f, out)
        print("  %-28s -> %dx%d  %d KB" % (name, size[0], size[1], os.path.getsize(out) // 1024))
    print("готово, папка:", DST)


if __name__ == "__main__":
    main()
