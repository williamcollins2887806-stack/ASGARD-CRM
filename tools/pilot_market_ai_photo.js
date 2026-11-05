'use strict';
/**
 * Пилот: AI-фото для карточек маркетплейса через RouterAI.
 * Модель по умолчанию — самая дешёвая: black-forest-labs/flux.2-klein-4b (~1.47 ₽/Мп).
 *
 * Usage:
 *   node tools/pilot_market_ai_photo.js
 *   node tools/pilot_market_ai_photo.js --model google/gemini-2.5-flash-image
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'tests', 'reports', 'market-ai-photo-pilot');
fs.mkdirSync(OUT, { recursive: true });

function loadEnv() {
  try {
    return Object.fromEntries(
      fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
        .split(/\r?\n/)
        .filter((l) => l && !l.trim().startsWith('#') && l.includes('='))
        .map((l) => {
          const i = l.indexOf('=');
          return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
        })
    );
  } catch (_) {
    return {};
  }
}

const ENV = loadEnv();
const API_KEY = ENV.OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';
const args = process.argv.slice(2);
const modelIdx = args.indexOf('--model');
const MODELS = modelIdx >= 0
  ? [args[modelIdx + 1]]
  : [
    'google/gemini-3-pro-image',         // academy Pro ~15 ₽ — качество карточки
    'google/gemini-3.1-flash-image',     // fallback ~7 ₽
    'google/gemini-2.5-flash-image',
  ];

// Два эндпоинта у RouterAI: /images и /images/generations (academy использует generations).
const ENDPOINTS = [
  'https://routerai.ru/api/v1/images/generations',
  'https://routerai.ru/api/v1/images',
];

// v3: рекламный hero как у топ-карточек Ozon (не серый сток на белом).
const PROMPT_LOCK = `
Square 1:1 MARKETPLACE HERO BANNER for Ozon product card (Russia), advertising quality.
NOT a plain catalog cutout. NOT sterile medical white. Think flagship Ozon main photo:
bold, desirable, expensive, eye-catching in a grid of thumbnails.
Scene recipe:
- Soft dark charcoal / deep slate stage with a warm amber-gold accent light from the left
  and cool steel rim from the right (marketplace contrast).
- Gentle volumetric haze / light bloom behind the product (subtle, elegant).
- Product floats slightly above a polished dark reflective floor; clear mirror reflection.
- Tiny out-of-focus workshop sparkles or tool silhouettes in far background (very soft bokeh only).
- Color grade: rich contrast, warm metal highlights, cinematic but photoreal.
- Framing: product fills ~70% of the card, centered with confident 3/4 hero angle.
HARD FORBIDDEN: pure white background, empty void, flat packshot, any text/letters/numbers,
logos, barcodes, stickers, watermarks, UI chrome, hands, people, cartoon, CGI toy look.
`.trim();

const ITEMS = [
  {
    slug: 'samorez',
    title: 'Саморезы по металлу',
    prompt: `${PROMPT_LOCK}
Hero: a sculptural neat cascade of shiny zinc self-tapping screws (саморезы по металлу).
A few Phillips heads face the camera with jewel-like speculars; threads razor sharp.
Looks like a premium Ozon bestseller main image for fasteners — magnetic, premium, clickable.`,
  },
  {
    slug: 'disk',
    title: 'Отрезной диск по металлу',
    prompt: `${PROMPT_LOCK}
Hero: one thin abrasive cutting disc for metal (отретной диск), dramatic upright tilt,
dark abrasive grain + brushed steel hub, golden rim-light tracing the thin cutting edge,
sparks of light in soft bokeh behind (no fire, just glints). Premium Ozon main photo energy.`,
  },
];

async function generateOnce(item, model) {
  const body = {
    model,
    prompt: item.prompt,
    n: 1,
    size: '1024x1024',
    aspect_ratio: '1:1',
    output_format: 'jpeg',
    response_format: 'b64_json',
  };
  let lastErr = null;
  for (const url of ENDPOINTS) {
    const t0 = Date.now();
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      lastErr = { url, fetch: String(e && e.message || e) };
      continue;
    }
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (_) {
      json = { raw: text.slice(0, 500) };
    }
    const apiErr = json && json.error;
    if (!res.ok || apiErr) {
      lastErr = { status: res.status, url, body: json };
      continue;
    }
    const b64 = json.data && json.data[0] && (json.data[0].b64_json || json.data[0].b64);
    const urlOut = json.data && json.data[0] && json.data[0].url;
    const cost = json.usage && (json.usage.cost != null ? json.usage.cost : json.usage.total_cost);
    const tag = args.includes('--v3') ? 'v3hero' : (args.includes('--v2') ? 'v2ozon' : 'v1');
    const file = path.join(OUT, `${item.slug}__${tag}__${model.replace(/\//g, '_')}.jpg`);
    if (b64) {
      fs.writeFileSync(file, Buffer.from(b64, 'base64'));
    } else if (urlOut) {
      const img = await fetch(urlOut);
      const buf = Buffer.from(await img.arrayBuffer());
      fs.writeFileSync(file, buf);
    } else {
      lastErr = { status: res.status, url, body: json, note: 'no image payload' };
      continue;
    }
    return {
      ok: true,
      item: item.slug,
      title: item.title,
      model,
      endpoint: url,
      ms: Date.now() - t0,
      cost_rub: cost != null ? Number(cost) : null,
      file: path.relative(ROOT, file).replace(/\\/g, '/'),
      bytes: fs.statSync(file).size,
      usage: json.usage || null,
    };
  }
  return { ok: false, item: item.slug, model, error: lastErr };
}

async function generate(item) {
  const attempts = [];
  for (const model of MODELS) {
    const r = await generateOnce(item, model);
    attempts.push(r);
    if (r.ok) return { ...r, attempts: attempts.map((a) => ({ model: a.model, ok: a.ok, err: a.error && (a.error.body && a.error.body.error) || a.error })) };
  }
  return { ok: false, item: item.slug, title: item.title, attempts };
}

async function main() {
  if (!API_KEY) {
    console.error('Нет OPENAI_API_KEY (.env / env)');
    process.exit(1);
  }
  console.log(JSON.stringify({ models: MODELS, out: OUT, n: ITEMS.length }, null, 2));
  const results = [];
  for (const item of ITEMS) {
    console.log('→', item.title);
    const r = await generate(item);
    results.push(r);
    console.log(JSON.stringify(r, null, 2));
  }
  const report = {
    at: new Date().toISOString(),
    models_tried: MODELS,
    results,
    total_cost_rub: results.reduce((s, r) => s + (r.cost_rub || 0), 0),
    ok: results.every((r) => r.ok),
  };
  fs.writeFileSync(path.join(OUT, 'REPORT.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log('\nREPORT', path.join(OUT, 'REPORT.json'));
  console.log('total_cost_rub', report.total_cost_rub);
  if (!report.ok) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
