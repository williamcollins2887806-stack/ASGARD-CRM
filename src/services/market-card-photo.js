'use strict';
/**
 * AI hero-фото архетипа: белый packshot (STYLE_LOCK v1) через RouterAI Flash.
 * Лимит ≤500 уникальных hero; real не перетирается.
 */
const fs = require('fs');
const path = require('path');
const jobs = require('./market-ai-jobs');
const archetype = require('./market-card-archetype');

const MODEL = 'google/gemini-2.5-flash-image';
const ENDPOINTS = [
  'https://routerai.ru/api/v1/images/generations',
  'https://routerai.ru/api/v1/images',
];
const COST_ESTIMATE_RUB = 4;
const EXIT_NO_CREDIT = 42;

const STYLE_LOCK = `
Square 1:1 product photography packshot for industrial B2B catalog.
Clean pure white seamless studio background (#FFFFFF).
Single product centered, sharp focus, soft even studio lighting, subtle soft shadow under the item.
Photoreal, high detail, commercial catalog quality.
HARD FORBIDDEN: any text, letters, numbers, logos, watermarks, barcodes, stickers, UI,
hands, people, cartoon, CGI toy look, cluttered background, colored backdrop, lifestyle scene.
`.trim();

function loadApiKeyFromEnvFile() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  try {
    const envPath = path.join(__dirname, '..', '..', '.env');
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.trim().startsWith('#')) continue;
      const i = line.indexOf('=');
      if (i < 0) continue;
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      if (k === 'OPENAI_API_KEY' && v) return v;
    }
  } catch (_) {}
  return '';
}

function loadApiKey() {
  return loadApiKeyFromEnvFile();
}

/** Env → .env → settings.ai_config.openai_api_key (как ai-provider на проде). */
async function resolveApiKey(db) {
  const fromEnv = loadApiKeyFromEnvFile();
  if (fromEnv) return fromEnv;
  if (!db || !db.query) return '';
  try {
    const { rows } = await db.query("SELECT value_json FROM settings WHERE key='ai_config' LIMIT 1");
    if (!rows[0]?.value_json) return '';
    let parsed = rows[0].value_json;
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed);
      } catch (_) {
        return '';
      }
    }
    const cfg = parsed?.value_json
      ? typeof parsed.value_json === 'string'
        ? JSON.parse(parsed.value_json)
        : parsed.value_json
      : parsed;
    return String(cfg?.openai_api_key || '').trim();
  } catch (_) {
    return '';
  }
}

function uploadsDir() {
  // nginx: location /uploads/ → alias /var/www/asgard-crm/uploads/
  // (не public/uploads — иначе 404 в браузере)
  const base = process.env.UPLOAD_DIR
    ? path.resolve(process.env.UPLOAD_DIR)
    : path.join(__dirname, '..', '..', 'uploads');
  const root = path.join(base, 'market-cards');
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function buildPrompt(title, promptHint) {
  const t = String(title || promptHint || 'industrial product').trim();
  const hint = String(promptHint || t).trim();
  return `${STYLE_LOCK}

Subject: ${t}.
Visual hint: ${hint}.
Show a typical representative item of this product type (generic, no brand marks).`;
}

function isNoCredit(status, body) {
  const msg = JSON.stringify(body || {}).toLowerCase();
  if (status === 402) return true;
  if (/no[_ ]?credit|insufficient.*(balance|fund|credit)|недостаточно.*(средств|баланс)/i.test(msg)) return true;
  return false;
}

async function callRouterAi(prompt, apiKey) {
  const body = {
    model: MODEL,
    prompt,
    n: 1,
    size: '1024x1024',
    aspect_ratio: '1:1',
    output_format: 'jpeg',
    response_format: 'b64_json',
  };
  let lastErr = null;
  for (const url of ENDPOINTS) {
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
      json = { raw: text.slice(0, 500) };
    }
    if (isNoCredit(res.status, json)) {
      const err = new Error('NO_CREDIT');
      err.code = 'NO_CREDIT';
      err.status = res.status;
      err.body = json;
      throw err;
    }
    if (!res.ok || json.error) {
      lastErr = Object.assign(new Error(json.error?.message || `HTTP ${res.status}`), {
        status: res.status,
        body: json,
      });
      continue;
    }
    const slot = json.data && json.data[0];
    const b64 = slot && (slot.b64_json || slot.b64);
    const urlOut = slot && slot.url;
    const cost = json.usage && (json.usage.cost != null ? json.usage.cost : json.usage.total_cost);
    let buf = null;
    if (b64) buf = Buffer.from(b64, 'base64');
    else if (urlOut) {
      const img = await fetch(urlOut);
      buf = Buffer.from(await img.arrayBuffer());
    }
    if (!buf || !buf.length) {
      lastErr = new Error('empty image payload');
      continue;
    }
    return { buf, cost_rub: cost != null ? Number(cost) : COST_ESTIMATE_RUB, usage: json.usage || null };
  }
  throw lastErr || new Error('RouterAI image failed');
}

/**
 * Сгенерировать hero для архетипа и раздать members.
 * @returns {{ok, skipped?, reason?, url?, cost_rub?, linked?}}
 */
async function generateArchetypePhoto(db, archetypeKey, opts = {}) {
  const key = String(archetypeKey || '').trim();
  if (!key) return { ok: false, reason: 'no_key' };

  const { rows } = await db.query(`SELECT * FROM market_card_archetypes WHERE key=$1`, [key]);
  let arch = rows[0];
  if (!arch) {
    const defs = archetype.listArchetypeDefs().find((d) => d.key === key);
    arch = await archetype.ensureArchetype(db, {
      key,
      title: defs?.title || key,
      prompt_hint: defs?.prompt_hint || key,
    });
  }
  if (!arch) return { ok: false, reason: 'no_archetype' };

  if (arch.photo_source === 'real' && arch.hero_photo_url) {
    await archetype.linkMembersToHero(db, key);
    return { ok: true, skipped: true, reason: 'real_locked', url: arch.hero_photo_url };
  }
  // placeholder — временная заглушка: AI-job должен перегенерировать (force)
  const hasFinalHero =
    arch.hero_photo_url &&
    arch.photo_source &&
    arch.photo_source !== 'placeholder' &&
    !opts.force;
  if (hasFinalHero) {
    const linked = await archetype.linkMembersToHero(db, key);
    return { ok: true, skipped: true, reason: 'already_has_hero', url: arch.hero_photo_url, linked };
  }

  const maxPhotos = opts.maxPhotos != null ? Number(opts.maxPhotos) : await jobs.getMaxPhotos(db);
  // лимит — по готовым AI/real; placeholder можно апгрейдить даже если «героев» уже много
  const { rows: aiCnt } = await db.query(
    `SELECT COUNT(*)::int AS n FROM market_card_archetypes
     WHERE photo_source IN ('ai','real') AND hero_photo_url IS NOT NULL AND btrim(hero_photo_url)<>''`
  );
  const readyAi = aiCnt[0]?.n || 0;
  const upgradingPlaceholder = arch.photo_source === 'placeholder' || opts.force;
  if (!upgradingPlaceholder && readyAi >= maxPhotos) {
    return { ok: false, reason: 'max_photos', ready: readyAi, maxPhotos };
  }

  if (await jobs.isMarketAiBlocked(db)) {
    return { ok: false, reason: 'blocked' };
  }

  const apiKey = opts.apiKey || (await resolveApiKey(db));
  if (!apiKey) {
    const err = new Error('NO_API_KEY');
    err.code = 'NO_API_KEY';
    throw err;
  }

  const prompt = buildPrompt(arch.title, arch.prompt_hint);
  let result;
  try {
    result = await callRouterAi(prompt, apiKey);
  } catch (e) {
    if (e.code === 'NO_CREDIT') {
      await jobs.blockMarketAi(db, 24);
      e.exitCode = EXIT_NO_CREDIT;
    }
    throw e;
  }

  const dir = opts.uploadsDir || uploadsDir();
  const fileName = `${key.replace(/[^a-zA-Z0-9_-]/g, '_')}.jpg`;
  const abs = path.join(dir, fileName);
  fs.writeFileSync(abs, result.buf);
  const url = `/uploads/market-cards/${fileName}`;
  const cost = Number.isFinite(result.cost_rub) ? result.cost_rub : COST_ESTIMATE_RUB;

  await db.query(
    `UPDATE market_card_archetypes SET
       hero_photo_url=$2, photo_source='ai', status='ready',
       generated_at=NOW(), cost_rub=$3, updated_at=NOW()
     WHERE key=$1`,
    [key, url, cost]
  );
  const linked = await archetype.linkMembersToHero(db, key);
  return { ok: true, url, cost_rub: cost, linked, bytes: result.buf.length, model: MODEL };
}

/** SVG placeholder по search_group / key → public URL */
function placeholderSvg(label, tone) {
  const colors = {
    ppe: '#1e3a5f',
    equipment: '#334155',
    tools: '#3f6212',
    consumable: '#7c2d12',
    materials: '#713f12',
    housing: '#1e40af',
    food: '#9a3412',
    services: '#5b21b6',
    other: '#475569',
  };
  const bg = colors[tone] || colors.other;
  const text = String(label || 'Товар').slice(0, 28).replace(/[<>&"]/g, '');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${bg}"/>
  <rect x="48" y="48" width="416" height="416" rx="24" fill="none" stroke="#ffffff" stroke-opacity="0.25" stroke-width="4"/>
  <text x="256" y="250" text-anchor="middle" fill="#ffffff" font-family="Segoe UI,Arial,sans-serif" font-size="28" font-weight="600">${text}</text>
  <text x="256" y="290" text-anchor="middle" fill="#ffffff" fill-opacity="0.7" font-family="Segoe UI,Arial,sans-serif" font-size="16">ASGARD</text>
</svg>`;
}

function ensurePlaceholderFile(key, title, searchGroup) {
  const dir = uploadsDir();
  const safe = String(key).replace(/[^a-zA-Z0-9_-]/g, '_') || 'fallback_other';
  const fileName = `${safe}.svg`;
  const abs = path.join(dir, fileName);
  if (!fs.existsSync(abs)) {
    const tone = String(searchGroup || key.split('_')[0] || 'other');
    fs.writeFileSync(abs, placeholderSvg(title || key, tone), 'utf8');
  }
  return `/uploads/market-cards/${fileName}`;
}

async function applyPlaceholderToArchetype(db, key, title, searchGroup) {
  const url = ensurePlaceholderFile(key, title, searchGroup);
  await db.query(
    `UPDATE market_card_archetypes SET
       hero_photo_url = COALESCE(hero_photo_url, $2),
       photo_source = CASE
         WHEN photo_source = 'real' THEN photo_source
         WHEN hero_photo_url IS NOT NULL AND photo_source = 'ai' THEN photo_source
         ELSE 'placeholder'
       END,
       status = CASE WHEN status='ready' THEN status ELSE 'pending_photo' END,
       updated_at = NOW()
     WHERE key=$1
       AND (hero_photo_url IS NULL OR photo_source IS NULL OR photo_source='placeholder')`,
    [key, url]
  );
  // only link if members have no photo / placeholder
  await db.query(
    `UPDATE products SET photo_url=$2, photo_source='placeholder', updated_at=NOW()
     WHERE market_card_key=$1
       AND (photo_url IS NULL OR photo_source IS NULL OR photo_source='placeholder')
       AND COALESCE(photo_source,'') <> 'real'`,
    [key, url]
  );
  await db.query(
    `UPDATE equipment SET photo_url=$2, photo_source='placeholder', updated_at=NOW()
     WHERE market_card_key=$1
       AND (photo_url IS NULL OR photo_source IS NULL OR photo_source='placeholder')
       AND COALESCE(photo_source,'') <> 'real'`,
    [key, url]
  );
  return url;
}

module.exports = {
  STYLE_LOCK,
  MODEL,
  EXIT_NO_CREDIT,
  COST_ESTIMATE_RUB,
  generateArchetypePhoto,
  ensurePlaceholderFile,
  applyPlaceholderToArchetype,
  buildPrompt,
  loadApiKey,
  resolveApiKey,
  uploadsDir,
};
