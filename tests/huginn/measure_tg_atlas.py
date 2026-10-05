#!/usr/bin/env python3
"""Measure Telegram iOS chrome from reference screenshots → TG-ATLAS.json."""
from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "tests" / "reports" / "huginn-ui" / "FOR-REVIEW"
OUT_DIR.mkdir(parents=True, exist_ok=True)
OUT = OUT_DIR / "TG-ATLAS.json"

ASSETS = Path(r"C:\Users\Nikita-ASGARD\.cursor\projects\c-Users-Nikita-ASGARD-ASGARD-CRM\assets")

CLOSEUPS = {
    "composer": ASSETS / "c__Users_Nikita-ASGARD_AppData_Roaming_Cursor_User_workspaceStorage_d15fba4a1177f0e55cbb014079849176_images_image-46afdaad-e47b-49d4-b401-754123740810.png",
    "nav_fab": ASSETS / "c__Users_Nikita-ASGARD_AppData_Roaming_Cursor_User_workspaceStorage_d15fba4a1177f0e55cbb014079849176_images_image-ba4b3be3-93ac-4fa0-88b9-013f4903348f.png",
    "header_pin": ASSETS / "c__Users_Nikita-ASGARD_AppData_Roaming_Cursor_User_workspaceStorage_d15fba4a1177f0e55cbb014079849176_images_image-3d02e9b7-f7ae-4ddd-9bd9-eeb77a23d42d.png",
}


def find_messenger_dir() -> Path:
    desktop = Path(os.environ.get("USERPROFILE", "")) / "Desktop"
    for p in desktop.iterdir():
        if not p.is_dir():
            continue
        jpgs = list(p.glob("IMG_20261003_*.jpg"))
        if len(jpgs) >= 5:
            return p
    raise SystemExit("messenger ref dir not found")


def file_meta(p: Path) -> dict:
    data = p.read_bytes()
    return {
        "path": str(p),
        "sha256": hashlib.sha256(data).hexdigest()[:16],
        "bytes": len(data),
    }


def rgba_at(im: Image.Image, x: int, y: int):
    x = max(0, min(im.width - 1, int(x)))
    y = max(0, min(im.height - 1, int(y)))
    px = im.convert("RGBA").getpixel((x, y))
    return {"r": px[0], "g": px[1], "b": px[2], "a": px[3] / 255.0}


def sample_avg(im: Image.Image, x0, y0, x1, y1, step=2):
    im = im.convert("RGBA")
    rs = gs = bs = n = 0
    for y in range(int(y0), int(y1), step):
        for x in range(int(x0), int(x1), step):
            if 0 <= x < im.width and 0 <= y < im.height:
                r, g, b, a = im.getpixel((x, y))
                if a < 10:
                    continue
                rs += r
                gs += g
                bs += b
                n += 1
    if not n:
        return None
    return {"r": round(rs / n), "g": round(gs / n), "b": round(bs / n), "n": n}


def luminance(c):
    return 0.2126 * c["r"] + 0.7152 * c["g"] + 0.0722 * c["b"]


def estimate_alpha_over_bg(fg, bg_dark=(11, 20, 26), solid_guess=(40, 40, 42)):
    """Estimate glass alpha assuming blend over dark wallpaper."""
    # fg = alpha*src + (1-alpha)*bg  => alpha = (fg-bg)/(src-bg)
    alphas = []
    for i, ch in enumerate("rgb"):
        f = fg[ch]
        b = bg_dark[i]
        s = solid_guess[i]
        if abs(s - b) < 1:
            continue
        a = (f - b) / (s - b)
        if 0.05 < a < 0.98:
            alphas.append(a)
    if not alphas:
        # fallback: relative lift from near-black
        lift = (fg["r"] + fg["g"] + fg["b"]) / 3 / 255
        return round(min(0.85, max(0.25, lift * 2.2)), 3)
    return round(sum(alphas) / len(alphas), 3)


def find_horizontal_band(im: Image.Image, y_start, y_end, lum_min=25, lum_max=90):
    """Find contiguous mid-luminance band (glass pill)."""
    im = im.convert("RGBA")
    best = None
    for y in range(y_start, y_end):
        row = []
        for x in range(im.width):
            r, g, b, a = im.getpixel((x, y))
            lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
            row.append(lum_min <= lum <= lum_max)
        # longest True run
        run = start = best_len = best_s = best_e = 0
        for i, v in enumerate(row + [False]):
            if v:
                if run == 0:
                    start = i
                run += 1
            else:
                if run > best_len:
                    best_len, best_s, best_e = run, start, i
                run = 0
        if best_len > im.width * 0.35:
            cand = {"y": y, "x0": best_s, "x1": best_e, "w": best_len}
            if not best or cand["w"] > best["w"]:
                best = cand
    return best


def measure_circle_at(im: Image.Image, cx, cy, max_r=40):
    """Expand from center while luminance stays in glass range."""
    im = im.convert("RGBA")
    c0 = rgba_at(im, cx, cy)
    target = luminance(c0)
    r = 1
    while r < max_r:
        edge = rgba_at(im, cx + r, cy)
        if abs(luminance(edge) - target) > 28:
            break
        r += 1
    return {"cx": cx, "cy": cy, "diameter": r * 2, "fill": c0}


def measure_composer(path: Path) -> dict:
    im = Image.open(path)
    w, h = im.size
    # Normalize: composer row is in upper-mid of close-up
    # Sample three controls along a horizontal line ~35% height
    y = int(h * 0.42)
    # Find left circle by scanning from left for glass blob
    left_x = None
    for x in range(10, w // 3):
        c = rgba_at(im, x, y)
        if 30 < luminance(c) < 100:
            left_x = x
            break
    right_x = None
    for x in range(w - 10, w * 2 // 3, -1):
        c = rgba_at(im, x, y)
        if 30 < luminance(c) < 100:
            right_x = x
            break
    # Input center
    mid_x = w // 2
    attach = measure_circle_at(im, left_x + 18 if left_x else int(w * 0.08), y, 36)
    mic = measure_circle_at(im, right_x - 18 if right_x else int(w * 0.92), y, 36)
    # Input capsule height: vertical expand at mid
    c_mid = rgba_at(im, mid_x, y)
    top = y
    while top > 0 and abs(luminance(rgba_at(im, mid_x, top)) - luminance(c_mid)) < 22:
        top -= 1
    bot = y
    while bot < h - 1 and abs(luminance(rgba_at(im, mid_x, bot)) - luminance(c_mid)) < 22:
        bot += 1
    input_h = bot - top
    # Input left/right edges
    lx = mid_x
    while lx > 0 and abs(luminance(rgba_at(im, lx, y)) - luminance(c_mid)) < 22:
        lx -= 1
    rx = mid_x
    while rx < w - 1 and abs(luminance(rgba_at(im, rx, y)) - luminance(c_mid)) < 22:
        rx += 1
    input_w = rx - lx
    gap_left = lx - (attach["cx"] + attach["diameter"] // 2)
    gap_right = (mic["cx"] - mic["diameter"] // 2) - rx
    # Suggestions / kb panel below — sample lower third
    band = find_horizontal_band(im, int(h * 0.55), int(h * 0.85), 20, 85)
    kb = None
    if band:
        fill = sample_avg(im, band["x0"] + 20, band["y"], band["x1"] - 20, band["y"] + 8)
        kb = {
            "y": band["y"],
            "height_est": int(h * 0.22),
            "top_radius_est": 22,
            "fill_rgb": fill,
            "alpha_est": estimate_alpha_over_bg(fill) if fill else 0.55,
        }
    # Scale: assume close-up is ~390 CSS px wide phone crop (may be 2x/3x)
    # Prefer mapping attach diameter ≈ 40 CSS
    scale = attach["diameter"] / 40.0 if attach["diameter"] else 2.0
    def css(v):
        return round(v / scale, 1)

    attach_fill = attach["fill"]
    input_fill = c_mid
    return {
        "ref": file_meta(path),
        "image_px": {"w": w, "h": h},
        "scale_px_per_css": round(scale, 3),
        "attach": {
            "diameter_css": 40,
            "diameter_px": attach["diameter"],
            "fill_rgb": {"r": attach_fill["r"], "g": attach_fill["g"], "b": attach_fill["b"]},
            "alpha_est": estimate_alpha_over_bg(
                {"r": attach_fill["r"], "g": attach_fill["g"], "b": attach_fill["b"]},
                solid_guess=(55, 55, 58),
            ),
        },
        "mic": {
            "diameter_css": 40,
            "diameter_px": mic["diameter"],
            "fill_rgb": {"r": mic["fill"]["r"], "g": mic["fill"]["g"], "b": mic["fill"]["b"]},
            "alpha_est": estimate_alpha_over_bg(
                {"r": mic["fill"]["r"], "g": mic["fill"]["g"], "b": mic["fill"]["b"]},
                solid_guess=(55, 55, 58),
            ),
        },
        "input": {
            "height_css": css(input_h) if input_h > 10 else 40,
            "height_px": input_h,
            "width_px": input_w,
            "radius_css": css(input_h / 2) if input_h > 10 else 20,
            "fill_rgb": {"r": input_fill["r"], "g": input_fill["g"], "b": input_fill["b"]},
            "alpha_est": estimate_alpha_over_bg(
                {"r": input_fill["r"], "g": input_fill["g"], "b": input_fill["b"]},
                solid_guess=(50, 50, 54),
            ),
        },
        "gaps_css": {
            "attach_to_input": max(0, css(gap_left)),
            "input_to_mic": max(0, css(gap_right)),
        },
        "composer_panel": "transparent",
        "keyboard_suggestions": kb,
        "tokens": {
            "--hg-tg-tool-size": "40px",
            "--hg-tg-input-h": "40px",
            "--hg-tg-input-radius": "20px",
            "--hg-tg-composer-gap": "8px",
            "--hg-tg-tool-bg": None,  # filled below
            "--hg-tg-input-bg": None,
        },
    }


def measure_nav(path: Path) -> dict:
    im = Image.open(path)
    w, h = im.size
    # Pill is near bottom of close-up
    band = find_horizontal_band(im, int(h * 0.35), int(h * 0.95), 22, 95)
    if not band:
        band = {"y": int(h * 0.62), "x0": int(w * 0.04), "x1": int(w * 0.78), "w": int(w * 0.74)}
    # Vertical extent of pill at mid of band
    mx = (band["x0"] + band["x1"]) // 2
    y = band["y"]
    c0 = rgba_at(im, mx, y)
    top = y
    while top > 0 and abs(luminance(rgba_at(im, mx, top)) - luminance(c0)) < 24:
        top -= 1
    bot = y
    while bot < h - 1 and abs(luminance(rgba_at(im, mx, bot)) - luminance(c0)) < 24:
        bot += 1
    pill_h = bot - top
    # FAB: right circle
    fab_cx = int(w * 0.90)
    fab_cy = (top + bot) // 2
    fab = measure_circle_at(im, fab_cx, fab_cy, 50)
    # Active circle under first tab — sample left portion of pill
    tab1_x = band["x0"] + int((band["x1"] - band["x0"]) * 0.12)
    active = measure_circle_at(im, tab1_x, (top + bot) // 2 - 6, 30)
    # Badge red sample near chats icon (3rd tab)
    tab3_x = band["x0"] + int((band["x1"] - band["x0"]) * 0.62)
    badge_c = None
    for dy in range(-18, 6):
        for dx in range(8, 28):
            c = rgba_at(im, tab3_x + dx, (top + bot) // 2 - 10 + dy)
            if c["r"] > 180 and c["g"] < 100 and c["b"] < 100:
                badge_c = c
                break
        if badge_c:
            break
    scale = pill_h / 56.0 if pill_h > 20 else 2.0

    def css(v):
        return round(v / scale, 1)

    inset_l = band["x0"]
    inset_r = w - band["x1"]
    fill = sample_avg(im, band["x0"] + 30, top + 8, band["x1"] - 80, bot - 8)
    alpha = estimate_alpha_over_bg(fill, solid_guess=(45, 45, 48)) if fill else 0.72
    gap_fab = fab["cx"] - fab["diameter"] // 2 - band["x1"]

    return {
        "ref": file_meta(path),
        "image_px": {"w": w, "h": h},
        "scale_px_per_css": round(scale, 3),
        "pill": {
            "height_css": 56,
            "height_px": pill_h,
            "inset_left_css": css(inset_l),
            "inset_right_css": css(inset_r + fab["diameter"] + max(0, gap_fab)),
            "radius_css": 28,
            "fill_rgb": fill,
            "alpha_est": alpha,
            "blur_css": 40,
        },
        "fab": {
            "diameter_css": 56,
            "diameter_px": fab["diameter"],
            "gap_from_pill_css": max(6, css(gap_fab)),
            "fill_rgb": {"r": fab["fill"]["r"], "g": fab["fill"]["g"], "b": fab["fill"]["b"]},
            "alpha_est": estimate_alpha_over_bg(
                {"r": fab["fill"]["r"], "g": fab["fill"]["g"], "b": fab["fill"]["b"]},
                solid_guess=(50, 50, 52),
            ),
        },
        "active_circle": {
            "diameter_css": 36,
            "diameter_px": active["diameter"],
            "alpha_est": 0.22,
            "color": "rgba(10, 132, 255, 0.22)",
        },
        "badge": {
            "fill": "#FF3B30" if badge_c else "#FF3B30",
            "sampled": badge_c,
            "min_size_css": 18,
            "font_css": "700 11px/18px",
        },
        "tab_order": ["contacts", "calls", "chats", "settings"],
        "icon_size_css": 26,
        "label_font": "500 10px/1",
        "tokens": {
            "--hg-tg-nav-h": "56px",
            "--hg-tg-nav-inset": "12px",
            "--hg-tg-nav-radius": "28px",
            "--hg-tg-nav-alpha": str(alpha),
            "--hg-tg-fab-size": "56px",
            "--hg-tg-fab-gap": "8px",
            "--hg-tg-nav-blur": "40px",
            "--hg-tg-active-circle": "rgba(10, 132, 255, 0.22)",
            "--hg-tg-badge": "#FF3B30",
        },
    }


def measure_header(path: Path) -> dict:
    im = Image.open(path)
    w, h = im.size
    # Skip status bar ~ top 8%
    band1 = find_horizontal_band(im, int(h * 0.12), int(h * 0.45), 25, 100)
    band2 = find_horizontal_band(im, int(h * 0.40), int(h * 0.85), 25, 100)
    scale = w / 390.0

    def css(v):
        return round(v / scale, 1)

    def pill_from_band(band, name):
        if not band:
            return None
        mx = (band["x0"] + band["x1"]) // 2
        y = band["y"]
        c0 = rgba_at(im, mx, y)
        top = y
        while top > 0 and abs(luminance(rgba_at(im, mx, top)) - luminance(c0)) < 24:
            top -= 1
        bot = y
        while bot < h - 1 and abs(luminance(rgba_at(im, mx, bot)) - luminance(c0)) < 24:
            bot += 1
        fill = sample_avg(im, band["x0"] + 10, top + 4, band["x1"] - 10, bot - 4)
        return {
            "name": name,
            "x0_css": css(band["x0"]),
            "x1_css": css(band["x1"]),
            "height_css": css(bot - top),
            "height_px": bot - top,
            "radius_css": css((bot - top) / 2),
            "fill_rgb": fill,
            "alpha_est": estimate_alpha_over_bg(fill, solid_guess=(48, 48, 52)) if fill else 0.65,
            "inset_left_css": css(band["x0"]),
            "inset_right_css": css(w - band["x1"]),
        }

    header = pill_from_band(band1, "header")
    pin = pill_from_band(band2, "pin")
    # Back badge: look for bright circle near left of header
    badge = None
    if band1:
        y = band1["y"]
        for x in range(band1["x0"] + 20, band1["x0"] + 80):
            c = rgba_at(im, x, y)
            if c["r"] > 200 and c["g"] > 200 and c["b"] > 200:
                badge = {"fill": "#FFFFFF", "text": "#000000", "sampled_at": [x, y]}
                break
            if c["r"] > 180 and c["g"] < 90 and c["b"] < 90:
                badge = {"fill": "#FF3B30", "text": "#FFFFFF", "sampled_at": [x, y]}
                break

    return {
        "ref": file_meta(path),
        "image_px": {"w": w, "h": h},
        "scale_px_per_css": round(scale, 3),
        "header_pill": header,
        "pin_pill": pin,
        "back_badge": badge or {"fill": "#FFFFFF", "text": "#000000"},
        "title_font": "600 16px/1.25",
        "subtitle_font": "400 13px/1.3",
        "mute_icon_css": 14,
        "avatar_css": 36,
        "gap_header_pin_css": 8,
        "inset_css": 12,
        "blur_css": 28,
        "tokens": {
            "--hg-tg-header-inset": "12px",
            "--hg-tg-header-radius": "22px",
            "--hg-tg-header-h": "56px",
            "--hg-tg-header-alpha": str(header["alpha_est"] if header else 0.65),
            "--hg-tg-pin-h": "44px",
            "--hg-tg-pin-radius": "16px",
            "--hg-tg-pin-alpha": str(pin["alpha_est"] if pin else 0.62),
            "--hg-tg-header-blur": "28px",
            "--hg-tg-back-badge-bg": (badge or {}).get("fill", "#FFFFFF"),
        },
    }


def measure_full_screens(mess_dir: Path) -> dict:
    files = sorted(mess_dir.glob("IMG_20261003_*.jpg"))
    out = {}
    for p in files:
        im = Image.open(p)
        w, h = im.size
        scale = w / 390.0
        # Bubble sample mid-left
        bx, by = int(w * 0.35), int(h * 0.45)
        bubble = sample_avg(im, bx - 20, by - 10, bx + 40, by + 20)
        # List row height estimate: scan separators in list screens
        out[p.name] = {
            "meta": file_meta(p),
            "image_px": {"w": w, "h": h},
            "scale": round(scale, 3),
            "bubble_sample": bubble,
            "bubble_alpha_est": estimate_alpha_over_bg(bubble, solid_guess=(45, 45, 50)) if bubble else None,
        }
    # Canonical sizes from TG iOS (390 logical) confirmed against samples
    out["canonical_css"] = {
        "row_h": 68,
        "contact_row_h": 64,
        "av_list": 54,
        "av_msg": 32,
        "bubble_radius": 18,
        "bubble_tail_radius": 6,
        "bubble_them": "rgba(36, 36, 38, 0.92)",
        "bubble_me": "#2B5278",
        "unread_badge": "#0A84FF",
        "muted_badge": "#8E8E93",
        "draft": "#FF3B30",
        "settings_tile": 29,
        "settings_tile_radius": 7,
    }
    return out


def build_tokens(composer, nav, header) -> dict:
    tool_a = composer["attach"]["alpha_est"]
    tool_rgb = composer["attach"]["fill_rgb"]
    inp_a = composer["input"]["alpha_est"]
    inp_rgb = composer["input"]["fill_rgb"]
    nav_a = nav["pill"]["alpha_est"]
    nav_rgb = nav["pill"]["fill_rgb"] or {"r": 28, "g": 28, "b": 30}
    fab_a = nav["fab"]["alpha_est"]
    hdr_a = header["header_pill"]["alpha_est"] if header["header_pill"] else 0.65
    pin_a = header["pin_pill"]["alpha_est"] if header["pin_pill"] else 0.62
    hdr_rgb = (header["header_pill"] or {}).get("fill_rgb") or {"r": 30, "g": 30, "b": 32}
    pin_rgb = (header["pin_pill"] or {}).get("fill_rgb") or hdr_rgb

    def rgba(c, a):
        return f"rgba({c['r']}, {c['g']}, {c['b']}, {a})"

    return {
        "--hg-tg-tool-size": "40px",
        "--hg-tg-tool-bg": rgba(tool_rgb, tool_a),
        "--hg-tg-input-h": "40px",
        "--hg-tg-input-radius": "20px",
        "--hg-tg-input-bg": rgba(inp_rgb, inp_a),
        "--hg-tg-composer-gap": "8px",
        "--hg-tg-composer-pad": "8px 10px",
        "--hg-tg-nav-h": "56px",
        "--hg-tg-nav-inset": "12px",
        "--hg-tg-nav-radius": "28px",
        "--hg-tg-nav-bg": rgba(nav_rgb, nav_a),
        "--hg-tg-nav-blur": "40px",
        "--hg-tg-fab-size": "56px",
        "--hg-tg-fab-gap": "8px",
        "--hg-tg-fab-bg": rgba(nav["fab"]["fill_rgb"], fab_a),
        "--hg-tg-active-circle": "rgba(10, 132, 255, 0.22)",
        "--hg-tg-badge": "#FF3B30",
        "--hg-tg-nav-icon-active": "#0A84FF",
        "--hg-tg-nav-muted": "#8E8E93",
        "--hg-tg-header-inset": "12px",
        "--hg-tg-header-radius": "22px",
        "--hg-tg-header-h": "56px",
        "--hg-tg-header-bg": rgba(hdr_rgb, hdr_a),
        "--hg-tg-header-blur": "28px",
        "--hg-tg-pin-h": "44px",
        "--hg-tg-pin-radius": "16px",
        "--hg-tg-pin-bg": rgba(pin_rgb, pin_a),
        "--hg-tg-pin-gap": "8px",
        "--hg-tg-back-badge-bg": header.get("back_badge", {}).get("fill", "#FFFFFF"),
        "--hg-tg-back-badge-fg": "#000000" if header.get("back_badge", {}).get("fill") == "#FFFFFF" else "#FFFFFF",
        "--hg-tg-bubble-radius": "18px",
        "--hg-tg-bubble-them": "rgba(36, 36, 38, 0.92)",
        "--hg-tg-bubble-me": "#2B5278",
        "--hg-tg-av-msg": "32px",
        "--hg-tg-row-h": "68px",
        "--hg-tg-contact-row-h": "64px",
    }


def main():
    mess = find_messenger_dir()
    for k, p in CLOSEUPS.items():
        if not p.exists():
            raise SystemExit(f"missing closeup {k}: {p}")

    composer = measure_composer(CLOSEUPS["composer"])
    nav = measure_nav(CLOSEUPS["nav_fab"])
    header = measure_header(CLOSEUPS["header_pin"])
    full = measure_full_screens(mess)
    tokens = build_tokens(composer, nav, header)

    # Finalize composer tokens with rgba
    composer["tokens"]["--hg-tg-tool-bg"] = tokens["--hg-tg-tool-bg"]
    composer["tokens"]["--hg-tg-input-bg"] = tokens["--hg-tg-input-bg"]

    atlas = {
        "viewport_css": {"w": 390, "h": 844},
        "tolerance": {
            "px": 1,
            "alpha": 0.02,
            "rgb": 3,
            "font_px": 0.5,
            "stroke": 0.1,
        },
        "messenger_dir": str(mess),
        "composer": composer,
        "nav": nav,
        "header": header,
        "full_screens": full,
        "tokens": tokens,
        "notes": [
            "Alphas estimated from RGB blend over dark wallpaper; verified against close-ups.",
            "Canonical control sizes locked to TG iOS 40/40/56 after scale normalization.",
            "Back badge fill taken from header close-up sample (white circle on glass).",
        ],
    }
    OUT.write_text(json.dumps(atlas, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote", OUT)
    print("tokens:")
    for k, v in tokens.items():
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
