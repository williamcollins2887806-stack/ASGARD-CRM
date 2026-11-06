#!/usr/bin/env node
/**
 * Премиальный логотип Тинга через RouterAI Gemini (image).
 * Версия v3: «дорогой» знак — не буква в круге, а узнаваемая марка
 * (сочетание камеры-объектива и буквы Т), как у продуктовых брендов
 * видеосвязи. Даёт 1024×1024 PNG + производные размеры для APK и веба.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MODEL = 'google/gemini-2.5-flash-image';
const ENDPOINTS = [
  'https://routerai.ru/api/v1/images/generations',
  'https://routerai.ru/api/v1/images',
];

const OUT_DIR = path.join(ROOT, 'public', 'assets', 'img', 'ting-brand');
const RAW_PATH = path.join(OUT_DIR, 'ting-mark-v3-raw.png');

const PROMPT = `
Premium app icon for "Тинг" — an enterprise video-conferencing product by ASGARD (Russian B2B, high-trust, boardroom grade).

Creative direction — this must look like a brand designed by Pentagram, not a letter in a circle:
- A single confident geometric mark that reads instantly at 48px and still delights at 512px.
- The mark is an abstract take on a camera aperture fused with the letter T: a wide horizontal bar at the top (the crossbar) and a circular aperture/lens opening beneath it, with a small solid dot centered in the aperture reading as an on-air indicator.
- Geometry strictly symmetrical, grid-built, optically balanced. Sharp, precise vector edges. No perspective, no bevels, no fake 3D.

Colour:
- Background: deep midnight indigo, subtle vertical gradient from #0E1230 at the top to #1B1046 at the bottom, with a very soft radial lift behind the mark so it feels lit rather than flat.
- The mark itself in champagne gold with a restrained satin sheen: highlight #F4D98A, mid #D4A843, shadow #A87C2A — gradient must look like brushed metal catching light, not a flat yellow fill.
- The aperture inner negative space is the background colour, so the lens reads as a cut-out.

Craft requirements:
- Full-bleed composition, the mark occupies about 62% of the canvas, generous optical breathing room, perfectly centred.
- Pixel-perfect anti-aliasing, no jaggies, no noise, no grain, no compression artifacts, no vignette banding.
- Restrained and expensive: no glow bloom, no sparkles, no lens flare, no drop shadows beyond a soft ambient occlusion under the mark.

FORBIDDEN:
- Any text, letters other than the abstract T structure, wordmarks, "Ting", "ASGARD".
- Camera hardware illustration, play buttons, microphones, speech bubbles, people, UI frames, borders.
- Emoji style, cartoon style, clip-art, gradient mesh soup, rainbow colours.

Output: one square 1024x1024 PNG, app-store quality, full bleed.
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
  throw new Error('OPENAI_API_KEY not found in .env');
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
    console.log('[ting-logo-v3] POST', url);
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      lastErr = e;
      continue;
    }
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch (_) {
      lastErr = new Error('non-json ' + res.status + ' ' + text.slice(0, 200));
      continue;
    }
    if (!res.ok || json.error) {
      lastErr = new Error((json.error && json.error.message) || ('HTTP ' + res.status));
      console.error('[ting-logo-v3] fail', res.status, JSON.stringify(json).slice(0, 400));
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
    if (!buf || !buf.length) { lastErr = new Error('empty image'); continue; }
    console.log('[ting-logo-v3] got bytes', buf.length);
    return buf;
  }
  throw lastErr || new Error('RouterAI image failed');
}

function processWithPython(rawPath) {
  const py = `
from pathlib import Path
from PIL import Image, ImageFilter, ImageDraw

ROOT = Path(r${JSON.stringify(ROOT)})
raw = Image.open(r${JSON.stringify(rawPath)}).convert('RGBA')
if raw.size[0] < 1024:
    raw = raw.resize((1024, 1024), Image.Resampling.LANCZOS)

# Ровный квадрат, если модель вернула не 1:1
side = min(raw.size)
left = (raw.size[0] - side) // 2
top = (raw.size[1] - side) // 2
raw = raw.crop((left, top, left + side, top + side)).resize((1024, 1024), Image.Resampling.LANCZOS)

sharp = raw.filter(ImageFilter.UnsharpMask(radius=1.1, percent=110, threshold=2))

web = ROOT / 'public' / 'assets' / 'img'
brand = web / 'ting-brand'
web.mkdir(parents=True, exist_ok=True)
brand.mkdir(parents=True, exist_ok=True)

# Мастер-файл и все размеры, которые реально нужны
sharp.save(brand / 'ting-mark-v3-1024.png', 'PNG')
for size in (512, 384, 192, 128, 64):
    im = sharp.resize((size, size), Image.Resampling.LANCZOS)
    name = 'ting-launcher-512.png' if size == 512 else f'ting-mark-v3-{size}.png'
    im.save(web / name if size == 512 else brand / name, 'PNG')

# Круглый вариант для APK (maskable / adaptive foreground)
def make_round(im):
    s = im.size[0]
    mask = Image.new('L', (s, s), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, s - 1, s - 1], fill=255)
    out = im.copy()
    out.putalpha(mask)
    return out

rnd = make_round(sharp)
rnd.save(web / 'ting-launcher-round-512.png', 'PNG')
rnd.resize((192, 192), Image.Resampling.LANCZOS).save(brand / 'ting-mark-v3-round-192.png', 'PNG')

# Прозрачный знак без фона — для шапки на светлой теме
px = sharp.convert('RGBA')
w, h = px.size
out = px.copy()
# срезаем тёмный фон по краям (мягкий порог), оставляя знак
for y in range(h):
    for x in range(w):
        r, g, b, a = out.getpixel((x, y))
        lum = (r + g + b) / 3
        if lum < 60:
            out.putpixel((x, y), (r, g, b, 0))
out.save(brand / 'ting-mark-v3-alpha.png', 'PNG')
print('done')
`;
  const tmp = path.join(OUT_DIR, '_gen.py');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(tmp, py, 'utf8');
  const { execFileSync } = require('child_process');
  try {
    execFileSync('python', [tmp], { stdio: 'inherit', cwd: ROOT });
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

(async () => {
  const key = loadApiKey();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const buf = await callGemini(key);
  fs.writeFileSync(RAW_PATH, buf);
  console.log('[ting-logo-v3] saved raw', RAW_PATH);
  processWithPython(RAW_PATH);
  console.log('[ting-logo-v3] OK');
})().catch((e) => {
  console.error('[ting-logo-v3] FAILED', e && e.message);
  process.exit(1);
});
