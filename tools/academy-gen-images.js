'use strict';

/**
 * academy-gen-images.js — пилот генерации викинг-иллюстраций для Руны.
 *
 * БЕЗОПАСНОСТЬ (класс дефектов B1/B2/B9 — см. аудит 16.10.2026):
 *   • НИКОГДА не зовёт generateWeeklyLesson (тот архивирует + DELETE → каскад
 *     ON DELETE CASCADE снёс бы academy_worker_progress и academy_quiz_attempts).
 *   • Только `UPDATE academy_lessons SET blocks=... WHERE id=<тот же id>`.
 *     id не меняется → прогресс рабочих и вопросы теста не трогаются.
 *   • Перед записью старый blocks уходит в academy_lesson_blocks_backup (откат).
 *   • URL картинок версионируются (?v=<хэш>) — иначе service worker
 *     (staleWhileRevalidate на /uploads/) залипает на старой картинке (B4).
 *   • Сцены (Pro) сжимаются в WebP через puppeteer (B5: 5 МБ PNG × 343 не влезли бы).
 *
 * Использование:
 *   node tools/academy-gen-images.js --lesson 32            # dry-run (план + смета)
 *   node tools/academy-gen-images.js --lesson 32 --apply    # сгенерировать и записать
 *   node tools/academy-gen-images.js --lesson 32 --rollback # вернуть blocks из бэкапа
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// PowerShell помечает команду упавшей (NativeCommandError, exit 1), если процесс
// пишет в stderr. Наши предупреждения — не ошибки, поэтому шлём их в stdout,
// чтобы батч по 73 лекциям не выглядел «красным» на каждой строке.
console.warn = (...a) => console.log(...a);

const ROOT = path.resolve(__dirname, '..');

// ── env ─────────────────────────────────────────────────────────────────────
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
  } catch (_) { return {}; }
}
const ENV = loadEnv();
const { Pool } = require(path.join(ROOT, 'node_modules', 'pg'));
const pool = new Pool({
  host: ENV.DB_HOST || 'localhost',
  port: ENV.DB_PORT || 5432,
  database: ENV.DB_NAME || 'asgard_crm',
  user: ENV.DB_USER || 'asgard',
  password: ENV.DB_PASSWORD,
});

// ── RouterAI ────────────────────────────────────────────────────────────────
const IMG_URL = 'https://routerai.ru/api/v1/images/generations';
const API_KEY = ENV.OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';
const MODEL_PRO = 'google/gemini-3-pro-image';       // scene, ~15 ₽, PNG 2K
const MODEL_FLASH = 'google/gemini-3.1-flash-image'; // diagram/schema, ~7,4 ₽, JPEG 1K
const PRICE_PRO = 15.2;   // ₽/картинка (замер 15.10.2026)
const PRICE_FLASH = 7.4;

// ── Стиль и бригада (тот же STYLE LOCK, что в утверждённых превью) ──────────
const STYLE = `
STYLE LOCK — obey exactly:
- Style: modern flat 2D vector cartoon, premium mobile game / safety-training app look.
- Bold uniform black outlines, constant stroke weight, closed shapes, no sketch lines.
- FLAT solid fills only, exactly ONE darker tone per color for simple cel shading. NO gradients, NO airbrush, NO texture, NO noise, NO drop shadows.
- Cute stylized proportions: big heads, small bodies, short limbs.
- Faces: big expressive cartoon eyes (white sclera, single black pupil dot), thick eyebrows, expressive mouths, round rosy cheeks.
- Palette ONLY: navy #1A1A2E, steel blue #2E3A59, gold #C8A84B, wood brown #B07A3C, cream #EFE3C8, leather brown #6B4A2B, skin #F2C6A0, spark yellow #FFD23F, hazard orange #E8622B, moss green #4B6B3A, grey silver #9AA3AD, snow white #EEF4FA, ice blue #BFD8EC, flame red #C0392B.
HARD NEGATIVE: photorealistic, 3D, realistic texture, gradient, glow, airbrush, blur, realistic anatomy, comic shading, anime, pixel art, text, letters, numbers, captions, speech bubbles, logos, watermark, signature, frame, border.
`;

const BRIGADE_DIR = path.join(ROOT, 'assets', 'academy', 'brigade');
const BRIGADE_FILES = ['01-volund.png', '02-styur.png', '03-brand.png', '04-olav.png'];

// ── WebP-сжатие через Playwright (браузеры уже установлены; fallback на Chrome) ─
let _browser = null;
let _page = null;

async function getPage() {
  if (_page) return _page;
  const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
  const opts = { args: ['--no-sandbox', '--disable-dev-shm-usage'] };
  try {
    _browser = await chromium.launch(opts);
  } catch (e) {
    // Fallback: системный Chrome
    _browser = await chromium.launch({ ...opts, channel: 'chrome' });
  }
  const ctx = await _browser.newContext();
  _page = await ctx.newPage();
  await _page.setContent('<html><body></body></html>');
  return _page;
}

async function closeBrowser() {
  try { if (_browser) await _browser.close(); } catch (_) {}
  _browser = null; _page = null;
}

/** PNG/JPEG buffer → WebP buffer (потолок 1600px по ширине). */
async function toWebp(buf, quality = 82) {
  const page = await getPage();
  const dataUrl = 'data:image/png;base64,' + buf.toString('base64');
  const b64 = await page.evaluate(async ({ src, q }) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('img load fail')); img.src = src; });
    const MAXW = 1600;
    const scale = img.naturalWidth > MAXW ? MAXW / img.naturalWidth : 1;
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, 'image/webp', q));
    if (!blob) throw new Error('toBlob(webp) null');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(bin);
  }, { src: dataUrl, q: quality });
  return Buffer.from(b64, 'base64');
}

// ── Генерация одной картинки ────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * slot.cast — массив ключей ROSTER (кто именно в кадре). Для scene:
 *   • передаём ТОЛЬКО листы этих персонажей (не все четыре);
 *   • описание героев берём из канона (canonForCast), а не из текста планировщика.
 * Если cast не задан — передаём групповой лист (вся бригада).
 */
async function generateImage(slot) {
  const isScene = slot.kind === 'scene';
  const model = slot.model || (isScene ? MODEL_PRO : MODEL_FLASH);
  const resolution = slot.resolution || (isScene ? '2K' : '1K');

  let refs = [];
  let castBlock = '';
  if (isScene) {
    const cast = Array.isArray(slot.cast) && slot.cast.length ? slot.cast : Object.keys(ROSTER);
    refs = refsForCast(cast);
    castBlock = '\n' + canonForCast(cast);
    if (!refs.length) {
      // нет ни одного листа — подстрахуемся групповым
      const gp = path.join(BRIGADE_DIR, GROUP_FILE);
      if (fs.existsSync(gp)) refs = [{ type: 'image_url', image_url: { url: 'data:image/png;base64,' + fs.readFileSync(gp).toString('base64') } }];
    }
  }

  const prompt = slot.prompt + '\n' + STYLE + castBlock;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const body = { model, prompt, n: 1, resolution, aspect_ratio: slot.aspect || '16:9' };
      if (isScene && refs.length) body.input_references = refs;
      const t0 = Date.now();
      const r = await fetch(IMG_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + API_KEY }, body: JSON.stringify(body) });
      const j = await r.json();
      const b64 = j.data && j.data[0] && j.data[0].b64_json;
      if (!b64) { console.log(`[gen] ${slot.slug}: API вернул без картинки: ${JSON.stringify(j).slice(0, 160)}`); await sleep(4000); continue; }
      const raw = Buffer.from(b64, 'base64');
      const cost = Number(j.usage?.cost) || (model === MODEL_PRO ? PRICE_PRO : PRICE_FLASH);
      console.log(`[gen] ${slot.slug}: OK ${(raw.length / 1024).toFixed(0)} KB (${model.split('/')[1]}, cast=${(slot.cast || []).join('+') || 'all'}, ${cost.toFixed(2)} ₽, ${((Date.now() - t0) / 1000).toFixed(0)}с)`);
      return { ok: true, raw, model, cost };
    } catch (e) {
      console.log(`[gen] ${slot.slug}: попытка ${attempt} — ${e.message}`);
      await sleep(4000);
    }
  }
  return { ok: false };
}

// ── Канон бригады: ключ → лист + каноническое описание ──────────────────────
// ВАЖНО (16.10.2026): раньше сцены получали ВСЕ 4 листа и текстовое описание
// персонажа от планировщика. Модель «выбирала» героя сама и рисовала по тексту,
// а не по листу → на общих лекциях Олав выходил «не наш». Теперь:
//   1) планировщик указывает cast (кто именно в кадре) ключами;
//   2) передаётся ТОЛЬКО лист(ы) этих персонажей;
//   3) описание героя — каноническое (не выдуманное), чтобы текст не спорил с листом.
const ROSTER = {
  volund: {
    file: '01-volund.png',
    canon: 'ВЁЛУНД the welder, EXACTLY as in his attached reference sheet: ginger beard with TWO braids, YELLOW hard-hat WITH TWO HORNS, tan leather apron over navy tunic.',
  },
  styur: {
    file: '02-styur.png',
    canon: 'СТЮР the rigger, EXACTLY as in his attached reference sheet: tall, blond beard, STEEL-BLUE helmet WITH TWO HORNS, hazard-ORANGE hi-vis vest.',
  },
  brand: {
    file: '03-brand.png',
    canon: 'БРАНД the insulation man, EXACTLY as in his attached reference sheet: dark brown beard with grey streaks (FULL beard), MOSS-GREEN helmet WITH TWO HORNS and goggles on the forehead, green overalls.',
  },
  olav: {
    file: '04-olav.png',
    canon: 'ОЛАВ МУДРЫЙ the foreman, EXACTLY as in his attached reference sheet: older, long GREY beard with two thin braids, navy fur-trimmed cloak, GOLD-TRIMMED HELMET WITH TWO HORNS, a small black raven on his shoulder.',
  },
};
const GROUP_FILE = 'group.png';

/** Листы только для указанных персонажей (дедуп, preserve order). */
function refsForCast(cast) {
  const out = [];
  const seen = new Set();
  for (const key of cast || []) {
    const r = ROSTER[key];
    if (!r || seen.has(key)) continue;
    const p = path.join(BRIGADE_DIR, r.file);
    if (!fs.existsSync(p)) { console.log(`[gen] нет листа для «${key}»: ${p}`); continue; }
    seen.add(key);
    out.push({ type: 'image_url', image_url: { url: 'data:image/png;base64,' + fs.readFileSync(p).toString('base64') } });
  }
  return out;
}

/** Канонические фразы для cast (чтобы текст промпта не противоречил листам). */
function canonForCast(cast) {
  const parts = [];
  for (const key of cast || []) {
    const r = ROSTER[key];
    if (r) parts.push('- ' + r.canon);
  }
  return parts.length ? 'CHARACTERS IN THIS SCENE (use ONLY their attached reference sheets, 100% identical):\n' + parts.join('\n') : '';
}

// ── Vision-арбитр: сверка сцены с утверждёнными листами бригады ─────────────
// Причина (16.10.2026): на широком групповом плане модель «упрощала» викингов до
// обычных рабочих — пропадали рога, косы, очки, ворон. Текстовый промпт это не
// ловит. Поэтому КАЖДАЯ сцена проверяется моделью-инспектором; при расхождении —
// перегенерация. Схемы (diagram, без людей) не проверяются.
const CHAT_URL = 'https://routerai.ru/api/v1/chat/completions';
const MODEL_FAST_PLANNER = 'deepseek/deepseek-v4.1-flash'; // дешёвый JSON-планировщик
const JUDGE_MODEL = 'google/gemini-3.5-flash';
// Порог откалиброван по факту (16.10.2026): рабочие сцены давали 70–72,
// «сломанная» (другие викинги) — 48. Порог 65 уверенно разделяет их,
// а 75 был недостижим → жёг по 3 попытки впустую.
const JUDGE_MIN_SCORE = 65;
const JUDGE_ATTEMPTS = 2;

const CANON = `ЭТАЛОННЫЕ ПРИМЕТЫ (обязательны, любое отсутствие — дефект):
1) ВЁЛУНД — рыжая борода с ДВУМЯ видимыми косами, ЖЁЛТАЯ каска с ДВУМЯ рогами, кожаный фартук поверх navy-рубахи;
2) СТЮР — высокий блондин, СТАЛЬНО-СИНИЙ шлем с ДВУМЯ рогами, ОРАНЖЕВЫЙ сигнальный жилет;
3) БРАНД — тёмно-коричневая борода с проседью (ПОЛНАЯ борода, не выбрита), МОСС-ЗЕЛЁНЫЙ шлем с ДВУМЯ рогами и очки на лбу, зелёный комбинезон;
4) ОЛАВ МУДРЫЙ — длинная СЕДАЯ борода с двумя косами, navy-накидка с мехом, ЗОЛОТОЙ шлем с ДВУМЯ рогами, ЧЁРНЫЙ ВОРОН на плече.`;

const JUDGE_SYSTEM = `Ты — строгий арт-инспектор бригады Асгарда. Дано: (1) ЭТАЛОННЫЙ лист персонажа, (2) СГЕНЕРИРОВАННАЯ сцена.
${CANON}
Проверь персонажей, которые ЕСТЬ на сцене: сохранены ли их ключевые приметы (рога, косы, очки, ворон, цвета).
Если персонаж на сцене мелок/упрощён и приметы не читаются — это FAIL.
Отвечай СТРОГО JSON без markdown:
{"match": true|false, "score": 0-100, "characters_on_scene": ["..."], "missing_marks": ["..."], "verdict": "кратко"}`;

function refB64(file) {
  const p = path.join(BRIGADE_DIR, file);
  return fs.existsSync(p) ? 'data:image/png;base64,' + fs.readFileSync(p).toString('base64') : null;
}

async function judgeScene(rawBuf, cast) {
  const list = Array.isArray(cast) && cast.length ? cast : Object.keys(ROSTER);
  const refsList = refsForCast(list);
  if (!refsList.length) return { ok: true, score: null, skipped: 'нет эталонов' };
  const lineup = refB64(GROUP_FILE);

  const names = list.map((k) => ROSTER[k]?.canon?.split(' ')[0] || k).join(', ');
  const content = [
    { type: 'text', text: JUDGE_SYSTEM + `\n\nВ ЭТОЙ СЦЕНЕ ДОЛЖНЫ БЫТЬ ТОЛЬКО: ${names}. Проверяй ТОЛЬКО их — если на сцене лишние/другие персонажи, это тоже дефект. Верни JSON.` },
  ];
  if (lineup) content.push({ type: 'image_url', image_url: { url: lineup } });
  content.push(...refsList);
  content.push({ type: 'image_url', image_url: { url: 'data:image/png;base64,' + rawBuf.toString('base64') } });

  for (let a = 1; a <= 3; a++) {
    try {
      const r = await fetch(CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + API_KEY },
        body: JSON.stringify({ model: JUDGE_MODEL, messages: [{ role: 'user', content }], temperature: 0.1, max_tokens: 800 }),
      });
      const j = await r.json();
      let txt = (j.choices?.[0]?.message?.content || '').trim().replace(/```json\n?/g, '').replace(/```\n?/g, '');
      const m = txt.match(/\{[\s\S]*\}/);
      if (!m) { await sleep(3000); continue; }
      const v = JSON.parse(m[0]);
      const score = Number(v.score) || 0;
      return { ok: v.match === true && score >= JUDGE_MIN_SCORE, score, verdict: v.verdict || '', missing: v.missing_marks || [] };
    } catch (e) { await sleep(3000); }
  }
  return { ok: true, score: null, skipped: 'арбитр недоступен' };
}

// ── Автоматический планировщик иллюстраций (LLM) ────────────────────────────
// Определяет: сколько картинок, к каким блокам, kind (scene с бригадой /
// diagram-схема), подпись и промпт. Для технических тем — бригада Асгарда;
// для общих (право, бюджет, английский) — Олав Мудрый как сказитель, без бригады.
const PLANNER_SYSTEM = `Ты — арт-директор Чертогов Мимира (обучение рабочих). По тексту Руны спланируй иллюстрации.
Верни СТРОГО JSON: {"images":[{"slug":"01-cover","kind":"scene|diagram","cast":["olav"],"afterIndex":N,"badge":"ОБКЛАДКА|СХЕМА|СЦЕНА|ФИНАЛ","caption":"подпись по-русски до 80 знаков","prompt":"промпт на английском"}]}

ПРАВИЛА:
1. 5–7 картинок. Первая — ОБКЛАДКА (afterIndex=0), последняя — ФИНАЛ (afterIndex = индекс последнего блока).
2. afterIndex — индекс блока, ПОСЛЕ которого встаёт картинка (считай с 0).
3. kind="scene" — сюжетная сцена (люди/действие). kind="diagram" — схема/инфографика БЕЗ людей.
4. Ставь diagram там, где перечисления/цифры/зоны/этапы/формулы. Ставь scene там, где действие, ситуация, пример.
5. cast — массив ключей, КТО ИМЕННО в кадре. Только эти ключи: "volund" (сварщик), "styur" (такелажник), "brand" (изолировщик), "olav" (мудрец/бригадир).
   Для diagram cast = [] (пусто, людей нет).
   В scene НЕ БОЛЬШЕ 2 ключей (2–3 героя максимум, крупным планом).
6. КОГО БРАТЬ:
   - ТЕХНИКА/БЕЗОПАСНОСТЬ (сварка, стропы, высота, газ, СИЗ, изоляция, краны, огонь, радиация, ЗОП) → профильные: volund, styur, brand, olav.
   - ОБЩИЕ ТЕМЫ (право, деньги, налоги, английский, психология, история, здоровье, быт, мошенники, бюджет) → ТОЛЬКО "olav" (мудрец-сказитель с вороном). НЕ ставь в такие темы volund/styur/brand.
7. КРИТИЧНО про промпт: НЕ описывай внешность персонажей (борода, шлем, рога, цвет, ворон) — ни текстом, ни словами "sage", "elderly", "warrior". Их образ уже задан референс-листом, который подставляется автоматически.
   Просто называй роль и действие: например "Olav stands at a construction site pointing at a wall chart, a foreign engineer listens."
   Описывай ТОЛЬКО: место, действие, позы, жесты, что в руках, окружение, план (close/medium/wide).
   Почему нельзя: если переописать героя словами, модель рисует СВОЕГО персонажа и сценка перестаёт быть похожей на эталон.
8. ЕСЛИ в cast есть персонаж (kind=scene) — его ЛИЦО и ВЕРХ ТЕЛА ДОЛЖНЫ БЫТЬ В КАДРЕ.
   ЗАПРЕЩЕНО планировать сцены вида "только руки", "только ноги", "со спины", "силуэт против света", "фигура в тумане" — по таким кадрам модель не может воспроизвести лицо/приметы, и герой не узнаётся.
   Если сюжет требует показать жест руками (например "палец вверх", "стоп") — покажи ЖЕСТ ЦЕЛИКОМ ЧЕРЕЗ ПЕРСОНАЖА: он стоит в кадре по грудь и делает этот жест. Так и замысел, и герой видны.
   Не проси текст/буквы/надписи на картинке.
9. Промпт — ТОЛЬКО английский. Не пиши стиль/палитру/негатив (добавляются автоматически).
10. slug: 01-cover, 02-..., 03-... по порядку.`;

async function planIllustrations(lesson) {
  const base = lesson._cleanBlocks || stripIllustrations(lesson.blocks);
  const blockList = base.map((b, i) =>
    `[${i}] ${b.type}${b.title ? ' — ' + b.title : ''}${b.text ? ': ' + String(b.text).slice(0, 180) : ''}`
  ).join('\n');

  const user = `Лекция: «${lesson.title}»
Раздел: ${lesson.saga}
Теги: ${(lesson.tags || []).join(', ')} (обязательная: ${lesson.is_mandatory ? 'да' : 'нет'})

Блоки (индекс — тип — начало текста):
${blockList}

Спланируй иллюстрации. Верни ТОЛЬКО JSON.`;

  for (let a = 1; a <= 3; a++) {
    try {
      const r = await fetch(CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + API_KEY },
        body: JSON.stringify({
          model: MODEL_FAST_PLANNER,
          messages: [{ role: 'system', content: PLANNER_SYSTEM }, { role: 'user', content: user }],
          temperature: 0.4,
          max_tokens: 4000,
          response_format: { type: 'json_object' },
        }),
      });
      const j = await r.json();
      let txt = (j.choices?.[0]?.message?.content || '').trim().replace(/```json\n?/g, '').replace(/```\n?/g, '');
      const m = txt.match(/\{[\s\S]*\}/);
      if (!m) { console.log(`[plan] попытка ${a}: нет JSON`); await sleep(3000); continue; }
      const parsed = JSON.parse(m[0]);
      const images = (parsed.images || []).filter((im) => im && im.slug && im.prompt && im.afterIndex != null);
      if (!images.length) { await sleep(3000); continue; }
      // нормализуем послеIndex в границы блоков + чистим slug (только латиница/цифры/дефис)
      const VALID_CAST = new Set(Object.keys(ROSTER));
      const cleanLen = base.length;
      let n = 0;
      for (const im of images) {
        n++;
        im.afterIndex = Math.max(0, Math.min(cleanLen - 1, Number(im.afterIndex) || 0));
        im.aspect = '16:9';
        if (!im.kind) im.kind = 'scene';
        im.slug = String(im.slug).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        if (!im.slug) im.slug = String(n).padStart(2, '0') + '-img';
        // гарантируем числовой префикс для стабильной сортировки
        if (!/^\d/.test(im.slug)) im.slug = String(n).padStart(2, '0') + '-' + im.slug;
        // cast: только валидные ключи; у диаграммы всегда пусто (людей нет)
        if (im.kind === 'diagram') {
          im.cast = [];
        } else {
          const rawCast = Array.isArray(im.cast) ? im.cast : [];
          im.cast = rawCast.map((c) => String(c).toLowerCase().trim()).filter((c) => VALID_CAST.has(c)).slice(0, 3);
          if (!im.cast.length) im.cast = ['olav']; // безопасный дефолт для сцены
        }
        // Детерминированная защита: сцена с персонажем не должна быть кадром «без лица».
        const noFace = /\b(hands?|fists?|arms? only|only (the )?hands?|close-?up of (the )?hands?|wrist|thumb|palm|from behind|back view|silhouette|no faces?|faces? not visible|out of frame)\b/i;
        if (im.kind === 'scene' && im.cast.length && noFace.test(im.prompt)) {
          console.log(`[plan] ${im.slug}: кадр без лица при наличии персонажа — добавляю требование показать героя в кадре`);
          im.prompt += ' The character is clearly visible: medium shot, upper body and face fully in frame, unmistakably shown.';
        }
      }
      // дедуп slug
      const seen = new Set();
      for (const im of images) {
        let s = im.slug, k = 1;
        while (seen.has(s)) { k++; s = im.slug + '-' + k; }
        im.slug = s; seen.add(s);
      }
      return images;
    } catch (e) { console.warn(`[plan] попытка ${a}: ${e.message}`); await sleep(3000); }
  }
  return null;
}

// ── План для конкретной лекции ──────────────────────────────────────────────
// afterIndex — индекс существующего блока, ПОСЛЕ которого вставляется картинка.
function planForLesson(lesson) {
  const t = lesson.title;
  if (lesson.id === 32) {
    return [
      { slug: '01-cover', kind: 'scene', afterIndex: 0, aspect: '16:9', badge: 'ОБКЛАДКА',
        caption: 'Бригада Асгарда на огневых работах: наряд-допуск, пост и наблюдатель',
        prompt: `COVER ILLUSTRATION for a hot-work safety lesson: the four Vikings of the brigade at an industrial site where welding is about to start. ВЁЛУНД (ginger welder) holds a welding helmet under his arm; СТЮР (blond rigger, orange hi-vis) unrolls a fire blanket; БРАНД (insulation man) sets up a red fire extinguisher; ОЛАВ МУДРЫЙ (grey-bearded foreman with raven on shoulder) checks a paper permit and points at a marked danger zone around the works. Behind them: steel pipes, a spark-resistant screen and a fire post with sand box and extinguishers. Flame-red accents, sparks shown as small clean shapes. Wide composition, confident safe mood.` },
      { slug: '02-zones', kind: 'diagram', afterIndex: 3, badge: 'СХЕМА', aspect: '16:9',
        caption: 'Зоны огневых работ: опасная 5 м и контролируемая 25 м',
        prompt: `EDUCATIONAL DIAGRAM, no characters, no people.
Subject: the TWO danger zones of hot work drawn as a flat vector top-down infographic: a central welding point with a small spark icon, surrounded by two concentric zones marked only by simple flat colored rings — an inner ring (unsafe zone) drawn in hazard orange, and a wider outer ring (controlled zone) drawn in gold. Show small flat icons inside the inner ring: a barrel, a gas cylinder and a wooden crate (combustibles). Pure white background, clean geometry, no labels, no numbers, no text.` },
      { slug: '03-permit', kind: 'diagram', afterIndex: 4, badge: 'СХЕМА', aspect: '16:9',
        caption: 'Что обязательно в наряде-допуске: срок, состав бригады, СИЗ, средства тушения',
        prompt: `EDUCATIONAL DIAGRAM, no characters, no people.
Subject: the mandatory parts of a hot-work permit drawn as a flat vector cartoon clipboard with a checklist: several simple flat checkbox rows, each row has a small clean icon — a calendar (dates), two worker helmets (crew), a welding mask (PPE), a fire extinguisher and sand bucket (fire equipment), and a signature line with a pen. Flat bold outlines, flat colors, pure white background, no labels, no numbers, no text.` },
      { slug: '04-fire-post', kind: 'scene', afterIndex: 8, badge: 'СЦЕНА', aspect: '16:9',
        caption: 'ОЛАВ МУДРЫЙ проверяет противопожарный пост перед началом работ',
        prompt: `SCENE: inspecting the fire post before hot work. ОЛАВ МУДРЫЙ (grey-bearded foreman, navy fur-trimmed cloak, raven on shoulder) checks a fire post set up next to a welding site: two red fire extinguishers, a box of dry sand with a shovel, a bucket of water, a fire blanket and a spark screen. ВЁЛУНД (ginger welder) stands ready with his welding helmet. Everything orderly and labelled by shape only. Flat vector cartoon, industrial site background, no text.` },
      { slug: '05-observer', kind: 'scene', afterIndex: 10, badge: 'СЦЕНА', aspect: '16:9',
        caption: 'Наблюдатель первым видит возгорание и действует по алгоритму',
        prompt: `SCENE, CLOSE-UP of a single hero: СТЮР (tall blond rigger) is the FIRE OBSERVER — the main large figure filling the frame, hazard-orange hi-vis vest clearly visible, steel-blue horned helmet WITH BOTH HORNS clearly visible, holding a red fire extinguisher in one hand and a whistle at his mouth. He has just spotted a small flame starting on a piece of material nearby and points at it urgently with a serious, alarmed but controlled expression. Behind him, small and slightly out of focus, ВЁЛУНД is welding (a welding helmet is enough for him). Only these two characters, and СТЮР is the big foreground figure so all his marks read clearly. Flat vector cartoon, industrial yard, no text.` },
      { slug: '06-summary', kind: 'scene', afterIndex: 13, badge: 'ФИНАЛ', aspect: '16:9',
        caption: 'Огневые работы закончены: зона проверена, пост снят, все целы',
        prompt: `SCENE, MEDIUM SHOT of TWO large characters only (not four): ОЛАВ МУДРЫЙ (foreman) and ВЁЛУНД (welder) stand together giving a confident thumbs-up next to a freshly welded pipe section. Both are BIG in the frame, upper body / full body. ОЛАВ МУДРЫЙ: long grey beard with two braids, gold-trimmed horned helmet WITH BOTH HORNS, navy fur-trimmed cloak, black raven clearly on his shoulder. ВЁЛУНД: ginger beard with two braids, YELLOW horned hard-hat WITH BOTH HORNS, leather apron. Warm proud safe mood. Flat vector cartoon, wide composition, no text.` },
    ];
  }
  throw new Error(`Нет плана для лекции id=${lesson.id} («${t}»). Пилот настроен на id=32.`);
}

// ── Сборка blocks с картинками ──────────────────────────────────────────────
// Идемпотентность: перед вставкой убираем ВСЕ прежние illustration-блоки
// (они созданы только этим инструментом), иначе повторный прогон задваивает
// картинки, когда планировщик дал другие slug (B7b, подтверждено 16.10.2026).
function stripIllustrations(blocks) {
  return (blocks || []).filter((b) => !(b && b.type === 'illustration'));
}

function buildBlocks(original, images) {
  const base = stripIllustrations(original);
  const out = [];
  base.forEach((block, i) => {
    out.push(block);
    const imgs = images.filter((im) => im.afterIndex === i);
    for (const im of imgs) {
      out.push({
        type: 'illustration',
        kind: im.kind,
        url: im.url,
        alt: im.caption,
        caption: im.caption,
        aspect: '16 / 9',
        badge: im.badge,
        slug: im.slug,
      });
    }
  });
  return out;
}

// ── Бэкап / откат ───────────────────────────────────────────────────────────
async function ensureBackupTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS academy_lesson_blocks_backup (
      id         SERIAL PRIMARY KEY,
      lesson_id  INTEGER NOT NULL,
      blocks     JSONB NOT NULL,
      note       TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_alb_lesson ON academy_lesson_blocks_backup(lesson_id)`);
}

async function backupBlocks(lessonId, blocks, note) {
  await pool.query(
    `INSERT INTO academy_lesson_blocks_backup (lesson_id, blocks, note) VALUES ($1, $2::jsonb, $3)`,
    [lessonId, JSON.stringify(blocks), note]
  );
}

async function rollback(lessonId) {
  await ensureBackupTable();
  const { rows } = await pool.query(
    `SELECT id, blocks, created_at FROM academy_lesson_blocks_backup WHERE lesson_id=$1 ORDER BY id DESC LIMIT 1`,
    [lessonId]
  );
  if (!rows.length) { console.log(`[rollback] нет бэкапа для лекции ${lessonId}`); return false; }
  await pool.query(`UPDATE academy_lessons SET blocks=$1::jsonb WHERE id=$2`, [JSON.stringify(rows[0].blocks), lessonId]);
  console.log(`[rollback] лекция ${lessonId}: blocks восстановлены из бэкапа #${rows[0].id} (${rows[0].created_at.toISOString()})`);
  return true;
}

// ── Пересжатие уже сгенерированных картинок (без повторной оплаты API) ──────
async function recompress(lessonId) {
  const { rows } = await pool.query(`SELECT id, blocks FROM academy_lessons WHERE id=$1`, [lessonId]);
  if (!rows.length) { console.error(`Лекция ${lessonId} не найдена`); return; }
  const lesson = rows[0];
  const dir = path.join(ROOT, 'uploads', 'academy', `lesson-${lessonId}`);
  const blocks = lesson.blocks;

  let converted = 0, savedBytes = 0;
  const before = [];
  const after = [];

  for (const b of blocks) {
    if (b.type !== 'illustration' || !b.url) continue;
    const clean = b.url.split('?')[0];
    const abs = path.join(ROOT, clean.replace(/^\//, '').replace(/\//g, path.sep));
    if (!fs.existsSync(abs)) { console.warn(`[recompress] нет файла: ${abs}`); continue; }
    const ext = path.extname(abs).toLowerCase();
    const raw = fs.readFileSync(abs);
    let out = raw, newExt = ext;
    if (ext !== '.webp') {
      try {
        out = await toWebp(raw, 82);
        if (!(out.length > 0 && out.slice(0, 4).toString('ascii') === 'RIFF')) { out = raw; }
        else { newExt = '.webp'; }
      } catch (e) { console.warn(`[recompress] ${b.slug}: ${e.message}`); continue; }
    }
    const newAbs = abs.replace(/\.(png|jpe?g)$/i, newExt);
    if (newExt !== ext) {
      fs.writeFileSync(newAbs, out);
      try { fs.unlinkSync(abs); } catch (_) {}
      converted++;
    }
    savedBytes += raw.length - out.length;
    const hash = crypto.createHash('sha1').update(out).digest('hex').slice(0, 8);
    b.url = `/uploads/academy/lesson-${lessonId}/${path.basename(newAbs)}?v=${hash}`;
    before.push(`${b.slug}: ${(raw.length / 1024).toFixed(0)} KB`);
    after.push(`${b.slug}: ${(out.length / 1024).toFixed(0)} KB`);
  }

  await pool.query(`UPDATE academy_lessons SET blocks=$1::jsonb WHERE id=$2`, [JSON.stringify(blocks), lessonId]);
  console.log('══════════════════════════════════════════════');
  console.log(`Пересжатие лекции #${lessonId}: конвертировано ${converted}`);
  console.log('  было:  ' + before.join(' | '));
  console.log('  стало: ' + after.join(' | '));
  console.log(`  сэкономлено: ${(savedBytes / 1024 / 1024).toFixed(2)} МБ`);
  console.log('══════════════════════════════════════════════');
}

// ── Статус: какие лекции уже с картинками ───────────────────────────────────
async function showStatus() {
  const { rows } = await pool.query(`
    WITH x AS (
      SELECT al.id, al.week_number, al.title, al.status,
             count(*) FILTER (WHERE b->>'type'='illustration') AS imgs,
             (SELECT count(*) FROM jsonb_array_elements(al.blocks) bb WHERE bb->>'type'='illustration'
                AND COALESCE(bb->>'url','') NOT LIKE '/uploads/%') AS external_imgs
      FROM academy_lessons al, jsonb_array_elements(al.blocks) b
      WHERE al.status='published'
      GROUP BY al.id, al.week_number, al.title, al.status
    )
    SELECT count(*) FILTER (WHERE imgs=0)::int AS без_картинок,
           count(*) FILTER (WHERE imgs>0)::int AS с_картинками,
           count(*)::int AS всего
    FROM x`);
  console.table(rows);

  const { rows: pending } = await pool.query(`
    WITH x AS (
      SELECT al.id, al.week_number,
             count(*) FILTER (WHERE b->>'type'='illustration') AS imgs
      FROM academy_lessons al, jsonb_array_elements(al.blocks) b
      WHERE al.status='published' GROUP BY al.id, al.week_number
    )
    SELECT id, week_number FROM x WHERE imgs=0 ORDER BY week_number LIMIT 60`);
  console.log(`\nЛекции БЕЗ картинок (первые ${pending.length}):`);
  console.log(pending.map((r) => `${r.id}(w${r.week_number})`).join(' '));
  const { rows: bk } = await pool.query(`SELECT lesson_id, count(*)::int AS бэкапов FROM academy_lesson_blocks_backup GROUP BY lesson_id ORDER BY lesson_id`);
  console.log(`\nЛекции с бэкапом blocks: ${bk.length}`);
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const lessonId = Number((args[args.indexOf('--lesson') + 1]) || 32);
  const apply = args.includes('--apply');
  const doRollback = args.includes('--rollback');
  const doRecompress = args.includes('--recompress');
  const force = args.includes('--force');
  const list = args.includes('--list');

  if (!API_KEY && !doRollback && !doRecompress && !list) { console.error('Нет OPENAI_API_KEY (routerai)'); process.exit(1); }

  if (list) { await showStatus(); await pool.end(); return; }
  if (args.includes('--dump-plan')) {
    const { rows: lr } = await pool.query(`SELECT id, title, saga, tags, is_mandatory, blocks FROM academy_lessons WHERE id=$1`, [lessonId]);
    if (!lr.length) { console.error('нет лекции'); process.exit(1); }
    const pl = await planIllustrations(lr[0]);
    console.log(JSON.stringify({ lesson: lr[0].id, title: lr[0].title, plan: pl }, null, 2));
    await pool.end();
    process.exit(0);
  }
  if (doRollback) { await rollback(lessonId); await pool.end(); return; }
  if (doRecompress) { await recompress(lessonId); await closeBrowser(); await pool.end(); return; }

  const { rows } = await pool.query(
    `SELECT id, week_number, saga, title, blocks, is_mandatory FROM academy_lessons WHERE id=$1`,
    [lessonId]
  );
  if (!rows.length) { console.error(`Лекция ${lessonId} не найдена`); process.exit(1); }
  const lesson = rows[0];
  // Планируем и считаем afterIndex по ЧИСТЫМ блокам (без прошлых иллюстраций),
  // иначе повторный прогон сдвинет вставки и задвоит картинки.
  lesson._cleanBlocks = stripIllustrations(lesson.blocks);
  let plan;
  try {
    plan = planForLesson(lesson);
  } catch (_) {
    console.log('[plan] жёсткого плана нет — планирую автопланировщиком (LLM)...');
    plan = await planIllustrations(lesson);
    if (!plan || !plan.length) {
      console.error('[plan] автопланировщик не вернул план — прерываю, blocks НЕ тронуты.');
      await pool.end();
      process.exit(1);
    }
    console.log(`[plan] спланировано: ${plan.length} картинок (scene: ${plan.filter((p) => p.kind === 'scene').length}, diagram: ${plan.filter((p) => p.kind === 'diagram').length})`);
  }

  const nPro = plan.filter((s) => s.kind === 'scene').length;
  const nFlash = plan.filter((s) => s.kind === 'diagram').length;
  const est = nPro * PRICE_PRO + nFlash * PRICE_FLASH;

  console.log('══════════════════════════════════════════════');
  console.log(`Пилот: лекция #${lesson.id} (week ${lesson.week_number}) «${lesson.title}»`);
  console.log(`Раздел: ${lesson.saga} | обязательная: ${lesson.is_mandatory}`);
  console.log(`Блоков сейчас: ${lesson.blocks.length} (без картинок: ${lesson._cleanBlocks.length})`);
  console.log(`Картинок в плане: ${plan.length} (scene/Pro: ${nPro}, diagram/Flash: ${nFlash})`);
  console.log(`Оценка стоимости: ~${est.toFixed(1)} ₽`);
  console.log(`Режим: ${apply ? 'ЗАПИСЬ (--apply)' : 'dry-run (только план)'}`);
  console.log('──────────────────────────────────────────────');
  for (const s of plan) {
    console.log(`  • ${s.slug.padEnd(14)} ${s.kind.padEnd(8)} cast=[${(s.cast || []).join(',')}] после блок[${s.afterIndex}] (${lesson._cleanBlocks[s.afterIndex]?.type || '?'}) — ${(s.caption || '').slice(0, 50)}`);
  }
  console.log('══════════════════════════════════════════════');

  if (!apply) { console.log('\nDry-run завершён. Запусти с --apply, чтобы сгенерировать и записать.'); await pool.end(); return; }

  const dir = path.join(ROOT, 'uploads', 'academy', `lesson-${lesson.id}`);
  fs.mkdirSync(dir, { recursive: true });

  const results = [];
  let spent = 0;
  for (const slot of plan) {
    // Идемпотентность (B7): если файл уже есть и не --force — не тратим деньги.
    const existing = ['webp', 'png', 'jpg', 'jpeg']
      .map((e) => path.join(dir, `${slot.slug}.${e}`))
      .find((f) => fs.existsSync(f));
    if (existing && !force) {
      const buf = fs.readFileSync(existing);
      const fname = path.basename(existing);
      const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8);
      const url = `/uploads/academy/lesson-${lesson.id}/${fname}?v=${hash}`;
      console.log(`[skip] ${slot.slug}: уже есть (${(buf.length / 1024).toFixed(0)} KB) — пропускаю без оплаты`);
      results.push({ ...slot, url, afterIndex: slot.afterIndex, kind: slot.kind, caption: slot.caption, badge: slot.badge, wasRawKB: '0', outKB: (buf.length / 1024).toFixed(0) });
      continue;
    }

    const g = await generateImage(slot);
    if (!g.ok) { console.warn(`[gen] ${slot.slug}: ПРОПУЩЕН (все попытки неудачны)`); continue; }
    spent += g.cost;

    // ── Слой 2: vision-арбитр для сцен (проверка примет бригады) ──
    let buf = g.raw;
    if (slot.kind === 'scene' && !args.includes('--no-judge')) {
      let best = { buf: g.raw, score: null, verdict: '' };
      let judged = await judgeScene(g.raw, slot.cast);
      if (judged.score != null) console.log(`[judge] ${slot.slug}: score=${judged.score} ${judged.ok ? '✓' : '✗ ' + (judged.verdict || '')}`);

      // ── Слой 3: авто-перегенерация до порога ──
      let attemptNo = 1;
      while (!judged.ok && judged.score != null && attemptNo < JUDGE_ATTEMPTS) {
        attemptNo++;
        console.log(`[judge] ${slot.slug}: приметы не прошли (${judged.score}) — перегенерация ${attemptNo}/${JUDGE_ATTEMPTS}`);
        const g2 = await generateImage(slot);
        if (!g2.ok) break;
        spent += g2.cost;
        const j2 = await judgeScene(g2.raw, slot.cast);
        if (j2.score != null) console.log(`[judge] ${slot.slug}: попытка ${attemptNo} → score=${j2.score} ${j2.ok ? '✓' : '✗'}`);
        if (best.score == null || (j2.score || 0) > (best.score || 0)) best = { buf: g2.raw, score: j2.score, verdict: j2.verdict };
        judged = j2;
        if (judged.ok) break;
      }
      // Берём лучший вариант (или первый, если арбитр молчал)
      buf = judged.score != null ? best.buf : g.raw;
      if (judged.score != null && !judged.ok) {
        console.log(`[judge] ${slot.slug}: ни одна попытка не прошла порог ${JUDGE_MIN_SCORE} (лучший ${best.score}). Оставляю лучший + помечаю для ручного просмотра.`);
        slot._needsReview = true;
      }
    }
    let ext = 'png';
    try {
      const webp = await toWebp(buf, 82);
      if (webp.length > 0 && webp.slice(0, 4).toString('ascii') === 'RIFF') {
        buf = webp; ext = 'webp';
      } else {
        console.warn(`[gen] ${slot.slug}: WebP не получился, сохраняю как есть (${ext})`);
      }
    } catch (e) {
      console.warn(`[gen] ${slot.slug}: сжатие упало (${e.message}), сохраняю исходник`);
    }
    const fname = `${slot.slug}.${ext}`;
    const abs = path.join(dir, fname);
    fs.writeFileSync(abs, buf);
    // B8: хэш берём ОТ ТОГО, ЧТО РЕАЛЬНО ЗАПИСАЛИ (иначе после --force URL
    // остался бы старым → браузер/SW показали закэшированную старую картинку).
    const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8);
    const url = `/uploads/academy/lesson-${lesson.id}/${fname}?v=${hash}`;
    console.log(`[save] ${fname}: ${(buf.length / 1024).toFixed(0)} KB → ${url}`);
    results.push({ ...slot, url, afterIndex: slot.afterIndex, kind: slot.kind, caption: slot.caption, badge: slot.badge, wasRawKB: (g.raw.length / 1024).toFixed(0), outKB: (buf.length / 1024).toFixed(0) });
  }

  await closeBrowser();

  if (!results.length) {
    console.error('\n[abort] ни одной картинки не сгенерировано — blocks НЕ тронуты.');
    await pool.end();
    return;
  }

  const newBlocks = buildBlocks(lesson.blocks, results);
  const addedCount = newBlocks.length - lesson._cleanBlocks.length;

  // Бэкап только если реально добавляем новые блоки (иначе повторный прогон
  // затирал бы хорошую версию своей же копией — B7c).
  if (addedCount > 0) {
    await ensureBackupTable();
    await backupBlocks(lesson.id, lesson.blocks, `gen-images (${results.length} img, +${addedCount} блоков)`);
  }

  await pool.query(`UPDATE academy_lessons SET blocks=$1::jsonb WHERE id=$2`, [JSON.stringify(newBlocks), lesson.id]);

  // B6: подчищаем файлы-сироты (остались от прошлых прогонов) — иначе мусор копится.
  const used = new Set(newBlocks.filter((b) => b.type === 'illustration' && b.url).map((b) => String(b.url).split('?')[0].split('/').pop()));
  let removed = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!/\.(webp|png|jpe?g)$/i.test(f)) continue;
    if (!used.has(f)) { try { fs.unlinkSync(path.join(dir, f)); removed++; } catch (_) {} }
  }
  if (removed) console.log(`[cleanup] удалено файлов-сирот: ${removed}`);

  const { rows: chk } = await pool.query(
    `SELECT jsonb_array_length(blocks) AS n, id,
            (SELECT count(*) FROM academy_quiz_questions q WHERE q.lesson_id=$1) AS nq
     FROM academy_lessons WHERE id=$1`, [lesson.id]
  );
  const { rows: prog } = await pool.query(
    `SELECT count(*)::int AS n FROM academy_worker_progress WHERE lesson_id=$1`, [lesson.id]
  );

  console.log('\n══════════════════════════════════════════════');
  console.log('РЕЗУЛЬТАТ');
  console.log(`  blocks: ${lesson._cleanBlocks.length} → ${chk[0].n} (было с картинками: ${lesson.blocks.length})`);
  console.log(`  картинок вставлено: ${results.length}`);
  console.log(`  id лекции: ${chk[0].id} (не изменился: ${chk[0].id === lesson.id})`);
  console.log(`  вопросов теста на месте: ${chk[0].nq}`);
  console.log(`  строк прогресса по этой лекции: ${prog[0].n} (не тронуты)`);
  console.log(`  потрачено: ~${spent.toFixed(1)} ₽`);
  const totalOut = results.reduce((s, r) => s + Number(r.outKB), 0);
  console.log(`  суммарный вес картинок: ${(totalOut / 1024).toFixed(2)} МБ`);
  console.log(`  откат: node tools/academy-gen-images.js --lesson ${lesson.id} --rollback`);
  console.log('══════════════════════════════════════════════');

  await pool.end();
}

main()
  .then(async () => {
    // Явное успешное завершение: глушим возможные зависшие хэндлы (браузер,
    // пул) — иначе посторонняя async-ошибка давала exit_code=1 при УСПЕШНОЙ работе.
    await closeBrowser();
    try { await pool.end(); } catch (_) {}
    process.exit(0);
  })
  .catch(async (e) => {
    console.error('FATAL', e);
    await closeBrowser();
    try { await pool.end(); } catch (_) {}
    process.exit(1);
  });
