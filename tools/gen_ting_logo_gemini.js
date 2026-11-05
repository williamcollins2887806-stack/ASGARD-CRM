#!/usr/bin/env node
/**
 * Generate premium Ting TV launcher icon via RouterAI Gemini flash-image,
 * then rasterize into Android mipmaps + web previews.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MODEL = 'google/gemini-2.5-flash-image';
const ENDPOINTS = [
  'https://routerai.ru/api/v1/images/generations',
  'https://routerai.ru/api/v1/images',
];

const OUT_DIR = path.join(ROOT, 'public', 'assets', 'img', 'ting-brand');
const RAW_PATH = path.join(OUT_DIR, 'ting-icon-gemini-raw.png');

const PROMPT = `
Design a PREMIUM Android TV / Google TV app icon for "Тинг" (Ting) — enterprise video meeting room app by ASGARD.

Hard requirements for launcher icon quality (must look as polished as RuStore icon):
- Perfect circle composition that fills the entire canvas edge-to-edge (full-bleed).
- NO square plate, NO rounded-rect card inside the circle, NO empty corners.
- Ultra-sharp vector-like edges, NO pixelation, NO blur, NO noise, NO JPEG artifacts.
- Modern 2025 SaaS / video-conferencing brand mark — premium, confident, not childish.

Visual:
- Background: rich deep indigo → violet diagonal gradient (#12163A → #5B2D9E), luminous and vibrant.
- Center mark: a bold geometric capital letter "T" in bright metallic gold (#FFD76A), perfectly centered, with soft rounded terminals.
- Under the T stem: a small solid gold "on-air" dot (like a broadcast indicator), perfectly aligned.
- Soft subtle gold glow behind the mark — clean, not muddy brown.
- High contrast, crisp anti-aliasing, flat modern style (not fake 3D bevel, not skeuomorphic).

FORBIDDEN:
- Text, words, watermarks, captions, "Ting", "ASGARD", letters other than the single T mark.
- People, cameras, microphones, UI chrome, frames, borders inside the icon.
- Low-res / pixel art / sketch / Paint look.
- White or gray empty margins.

Output: square 1024×1024 PNG-ready icon artwork, full bleed, app-store quality.
`.trim();

function loadApiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY.trim();
  const envPath = path.join(ROOT, '.env');
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k === 'OPENAI_API_KEY' && v) return v;
  }
  throw new Error('OPENAI_API_KEY not found');
}

async function callGemini(apiKey) {
  const body = {
    model: MODEL,
    prompt: PROMPT,
    n: 1,
    size: '1024x1024',
    aspect_ratio: '1:1',
    output_format: 'png',
    response_format: 'b64_json',
  };
  let lastErr = null;
  for (const url of ENDPOINTS) {
    console.log('[ting-logo] POST', url, MODEL);
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      lastErr = e;
      continue;
    }
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (_) {
      lastErr = new Error('non-json ' + res.status + ' ' + text.slice(0, 200));
      continue;
    }
    if (!res.ok || json.error) {
      lastErr = new Error((json.error && json.error.message) || ('HTTP ' + res.status));
      console.error('[ting-logo] fail', res.status, JSON.stringify(json).slice(0, 400));
      continue;
    }
    const slot = json.data && json.data[0];
    const b64 = slot && (slot.b64_json || slot.b64);
    const urlOut = slot && slot.url;
    let buf = null;
    if (b64) buf = Buffer.from(b64, 'base64');
    else if (urlOut) {
      const img = await fetch(urlOut);
      buf = Buffer.from(await img.arrayBuffer());
    }
    if (!buf || !buf.length) {
      lastErr = new Error('empty image');
      continue;
    }
    console.log('[ting-logo] got bytes', buf.length, 'usage', json.usage || null);
    return buf;
  }
  throw lastErr || new Error('RouterAI image failed');
}

function processWithPython(rawPath) {
  const py = `
from pathlib import Path
from PIL import Image, ImageFilter, ImageDraw
import math

ROOT = Path(r${JSON.stringify(ROOT)})
raw = Image.open(r${JSON.stringify(rawPath)}).convert('RGBA')
# upscale then down for crispness if needed
if raw.size[0] < 1024:
    raw = raw.resize((1024, 1024), Image.Resampling.LANCZOS)

# slight unsharp for TV sharpness
sharp = raw.filter(ImageFilter.UnsharpMask(radius=1.2, percent=120, threshold=2))

web = ROOT / 'public' / 'assets' / 'img'
web.mkdir(parents=True, exist_ok=True)
sharp.save(web / 'ting-launcher-512.png', 'PNG')

# circular for round preview
def make_round(im):
    size = im.size[0]
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, size-1, size-1], fill=255)
    out = im.copy()
    out.putalpha(mask)
    return out

make_round(sharp).resize((512, 512), Image.Resampling.LANCZOS).save(web / 'ting-launcher-round-512.png', 'PNG')
sharp.resize((512, 512), Image.Resampling.LANCZOS).save(web / 'ting-launcher-512.png', 'PNG')

# mipmaps
densities = {
    'mipmap-mdpi': 48,
    'mipmap-hdpi': 72,
    'mipmap-xhdpi': 96,
    'mipmap-xxhdpi': 144,
    'mipmap-xxxhdpi': 192,
}
res = ROOT / 'ting-android' / 'android' / 'app' / 'src' / 'main' / 'res'
for folder, size in densities.items():
    d = res / folder
    d.mkdir(parents=True, exist_ok=True)
    sq = sharp.resize((size, size), Image.Resampling.LANCZOS)
    rnd = make_round(sq)
    # adaptive foreground: mark on transparent — crop content; use full image with alpha
    fg = sq.copy()
    sq.save(d / 'ic_launcher.png', 'PNG')
    rnd.save(d / 'ic_launcher_round.png', 'PNG')
    fg.save(d / 'ic_launcher_foreground.png', 'PNG')
    print('OK', folder, size)

# TV banner 320x180 — left badge + dark field
banner = Image.new('RGBA', (320, 180), (12, 16, 40, 255))
px = banner.load()
for y in range(180):
    for x in range(320):
        t = x / 319
        v = y / 179
        r = int(18 + 40 * t + 10 * (1-v))
        g = int(22 + 10 * t)
        b = int(58 + 40 * t)
        px[x, y] = (min(255,r), min(255,g), min(255,b), 255)
mark = make_round(sharp.resize((112, 112), Image.Resampling.LANCZOS))
banner.paste(mark, (28, 34), mark)
# wordmark
from PIL import ImageFont
d = ImageDraw.Draw(banner)
font = None
for name in [r'C:\\Windows\\Fonts\\segoeuib.ttf', r'C:\\Windows\\Fonts\\arialbd.ttf']:
    if Path(name).exists():
        font = ImageFont.truetype(name, 44)
        break
if font:
    d.text((160, 62), 'ТИНГ', font=font, fill=(255, 215, 106, 255))
bx = res / 'drawable-xhdpi'
bx.mkdir(parents=True, exist_ok=True)
banner.save(bx / 'tv_banner.png', 'PNG')
(res / 'drawable').mkdir(parents=True, exist_ok=True)
banner.save(res / 'drawable' / 'tv_banner.png', 'PNG')
print('OK banner + web')
`;
  const tmp = path.join(OUT_DIR, '_process_icons.py');
  fs.writeFileSync(tmp, py, 'utf8');
  execFileSync('python', [tmp], { stdio: 'inherit' });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const key = loadApiKey();
  console.log('[ting-logo] key len', key.length);
  const buf = await callGemini(key);
  fs.writeFileSync(RAW_PATH, buf);
  console.log('[ting-logo] wrote', RAW_PATH);
  processWithPython(RAW_PATH);
  console.log('[ting-logo] DONE');
}

main().catch((e) => {
  console.error('[ting-logo] FAIL', e);
  process.exit(1);
});
