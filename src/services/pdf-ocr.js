/**
 * ASGARD CRM — PDF OCR Service
 *
 * Извлекает текст из PDF через 2-этапный пайплайн:
 *   1. Конвертируем PDF в PNG (постранично) через pdftoppm (poppler-utils)
 *   2. Каждую страницу прогоняем через google/gemini-2.5-flash (routerai) с
 *      задачей OCR — возвращает дословный текст изображения
 *   3. Склеиваем тексты страниц, кэшируем в documents.ocr_text
 *
 * Почему так:
 *   - PDF от УРАЛХИМ это сканы без текстового слоя → pdftotext возвращает пусто
 *   - routerai возвращает 503 на type:file блоки для Claude → Claude не видит PDF
 *   - Поэтому делаем OCR на сервере и отдаём текст в обычный user-message
 *
 * Цена: gemini-2.5-flash ~$0.0001 за страницу, 5 сек на страницу.
 */

'use strict';

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const db = require('./db');
const aiProvider = require('./ai-provider');

// OCR-модель: pixtral-large тестово показал лучшее качество на сканах УРАЛХИМ
// (правильно распознал "Воскресенск" + структуру). gemini-2.5-flash дешевле но
// может галлюцинировать когда страница повёрнута/плохого качества — он "додумал"
// "Инструкция по эксплуатации прибора" вместо реального ТЗ для дока 284.
// OCR через RouterAI vision (по умолчанию gemini-3.1-flash-lite — см. бенч 1961).
const { MODEL_FAST } = require('./ai-models');
// OCR: gemini-3.1-flash-lite — бенч на Апатит 1961 (Ам-1 №58 + ТЗ):
// те же ключевые поля что у 3.5-flash, без ошибок 3.5-flash-lite (дата/№ формы),
// ~15× дешевле, скорость сопоставима.
const OCR_MODEL = process.env.OCR_MODEL || 'google/gemini-3.1-flash-lite';
// Vision-fallback: другая модель (не та же). 3.5-flash лучше переваривает TIFF/сканы.
const OCR_FALLBACK_MODEL = process.env.OCR_FALLBACK_MODEL || 'google/gemini-3.5-flash';
const CONVERT_BIN = process.env.IMAGEMAGICK_CONVERT || '/usr/bin/convert';
// Transient Gemini/RouterAI 502 — повторы той же модели до смены fallback.
const OCR_TRANSIENT_RETRIES = Math.max(0, parseInt(process.env.OCR_TRANSIENT_RETRIES || '2', 10));
const OCR_MAX_IMAGE_EDGE = Math.max(1024, parseInt(process.env.OCR_MAX_IMAGE_EDGE || '3072', 10));
const OCR_MAX_IMAGE_BYTES = Math.max(512 * 1024, parseInt(process.env.OCR_MAX_IMAGE_BYTES || String(5 * 1024 * 1024), 10));
// 18.06.2026 поднят 20 → 150: для больших проектных ТЗ. Каждая страница ≈ 1 AI-вызов
// с vision (~30 сек). 150 страниц теоретически ≈ 75 мин real-time — но фронт
// показывает прогресс, а реально PDF >50 стр почти всегда имеют text-layer
// и идут через pdf-parse (быстро, без OCR).
const OCR_MAX_PAGES = parseInt(process.env.OCR_MAX_PAGES || '150', 10);
const PDFTOPPM_BIN = '/usr/bin/pdftoppm';

// КРИТИЧНО: антигаллюцинационный промпт. Без него gemini-2.5-flash на повёрнутых
// сканах придумывает "инструкции к приборам" вместо чтения. Принудительно требуем
// "если не видишь — пиши [НЕЧИТАЕМО]" и запрещаем додумывать.
const OCR_PROMPT = `Твоя задача — извлечь текст со скана документа.

СТРОГИЕ ПРАВИЛА:
1. Читай ТОЛЬКО то что РЕАЛЬНО видишь на изображении.
2. НЕ ВЫДУМЫВАЙ текст. Если страница повёрнута — мысленно поверни.
3. Если фрагмент нечитаем — пиши "[НЕЧИТАЕМО]" вместо догадки.
4. Если изображение пустое или это не текст — пиши "[ПУСТАЯ СТРАНИЦА]".
5. Сохраняй структуру: заголовки, нумерация пунктов, таблицы построчно.
6. НЕ добавляй комментарии "вот что я вижу" — только сам текст.
7. Особое внимание: название организации, ИНН, ГОРОД, АДРЕС, номера документов, даты.
8. Штампы и подписи помечай: [штамп: текст], [подпись].

Сейчас извлеки текст со страницы:`;

/**
 * Эвристика: похоже ли что OCR вернул мусор/галлюцинацию.
 * НЕ сверяем с именем файла вида «Ам-1 №58.pdf» — там нет слов из содержимого,
 * иначе каждая страница ложно помечается и OCR удваивается (primary+fallback).
 */
function _looksLikeHallucination(text, originalName) {
  if (!text || text.length < 40) return true;
  const t = String(text).trim();
  // Явные маркеры пустой/битой страницы
  if (/^\[(ПУСТАЯ СТРАНИЦА|НЕЧИТАЕМО|ошибка)/i.test(t) && t.length < 80) return true;
  // Мало кириллицы на «русском» скане при длинном ответе — подозрительно
  const cyr = (t.match(/[А-Яа-яЁё]/g) || []).length;
  if (t.length > 120 && cyr < 15) return true;
  // Имя файла почти из кодов/номеров — не используем для сверки
  const nameWords = (originalName || '').toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[.,\-_()№#]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 5 && !/^\d+$/.test(w) && !/^ам\d*$/i.test(w));
  if (nameWords.length >= 2) {
    const lower = t.toLowerCase();
    const found = nameWords.filter(w => lower.includes(w));
    if (found.length === 0 && t.length < 80) return true;
  }
  return false;
}

/** Параллельный map с лимитом concurrency. */
async function _mapPool(items, concurrency, fn) {
  const n = Math.max(1, concurrency | 0);
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  const workers = [];
  for (let w = 0; w < Math.min(n, items.length); w++) workers.push(worker());
  await Promise.all(workers);
  return out;
}

const OCR_CONCURRENCY = Math.max(1, parseInt(process.env.OCR_CONCURRENCY || '16', 10));
const OCR_BATCH_SIZE = Math.max(1, parseInt(process.env.OCR_BATCH_SIZE || '6', 10));
const OCR_SKIP_SAME_MODEL_FALLBACK = process.env.OCR_SKIP_SAME_MODEL_FALLBACK !== '0';

/** Глобальный лимит одновременных vision-вызовов (батч = 1 слот). */
const _ocrWaiters = [];
let _ocrInFlight = 0;
function _ocrAcquire() {
  if (_ocrInFlight < OCR_CONCURRENCY) {
    _ocrInFlight += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => _ocrWaiters.push(resolve));
}
function _ocrRelease() {
  const next = _ocrWaiters.shift();
  if (next) next();
  else _ocrInFlight = Math.max(0, _ocrInFlight - 1);
}

/**
 * Выполнить shell-команду промисом.
 */
function exec(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { ...opts });
    let stdout = '', stderr = '';
    proc.stdout?.on('data', d => stdout += d);
    proc.stderr?.on('data', d => stderr += d);
    proc.on('error', reject);
    proc.on('close', code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exit ${code}: ${stderr || stdout}`));
    });
  });
}

/**
 * Конвертировать PDF в массив PNG-страниц во временной папке.
 * Возвращает [{path, page_number}, ...].
 * @param {string} pdfPath
 * @param {number} maxPages
 * @param {number} [dpi=150]
 */
async function _pdfToPages(pdfPath, maxPages = OCR_MAX_PAGES, dpi = 150) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mimir-ocr-'));
  const outPrefix = path.join(tmpDir, 'page');
  const dpiStr = String(dpi || 150);

  // pdftoppm -png -r DPI -f 1 -l N <pdf> <prefix> → создаёт <prefix>-1.png, ...
  await exec(PDFTOPPM_BIN, [
    '-png', '-r', dpiStr,
    '-f', '1', '-l', String(maxPages),
    pdfPath, outPrefix
  ]);

  const files = (await fs.readdir(tmpDir))
    .filter(f => f.startsWith('page-') && f.endsWith('.png'))
    .sort((a, b) => {
      const na = parseInt(a.match(/-(\d+)\.png$/)?.[1] || '0');
      const nb = parseInt(b.match(/-(\d+)\.png$/)?.[1] || '0');
      return na - nb;
    });

  return {
    tmpDir,
    pages: files.map((f, i) => ({
      path: path.join(tmpDir, f),
      page_number: i + 1
    }))
  };
}

function _isEmptyOcrText(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  if (/^\[ПУСТАЯ СТРАНИЦА\]$/i.test(t)) return true;
  if (/^\[НЕЧИТАЕМО\]$/i.test(t)) return true;
  // только маркеры ошибок / короче 15 символов после очистки
  const cleaned = t.replace(/\[НЕЧИТАЕМО\]/gi, '').replace(/\[ПУСТАЯ СТРАНИЦА\]/gi, '').replace(/\s+/g, '');
  return cleaned.length < 15;
}

/**
 * Удалить временную папку с PNG.
 */
async function _cleanup(tmpDir) {
  try {
    const files = await fs.readdir(tmpDir);
    await Promise.all(files.map(f => fs.unlink(path.join(tmpDir, f)).catch(()=>{})));
    await fs.rmdir(tmpDir);
  } catch (_) {}
}

/**
 * MIME для data-URI vision.
 * Приоритет: сигнатура файла → расширение → hint.
 * Расширение важнее hint: из архивов часто приходит octet-stream / ошибочный image/jpeg.
 */
function _mimeFromExt(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  const map = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff'
  };
  return map[ext] || null;
}

function _normalizeMimeHint(hint) {
  const h = String(hint || '').toLowerCase().trim();
  if (h === 'image/jpg' || h === 'image/pjpeg') return 'image/jpeg';
  if (h === 'image/tif') return 'image/tiff';
  if (h.startsWith('image/')) return h;
  return null;
}

/** Magic-bytes: ловит TIFF даже если файл назван .bin / левый mime. */
function _sniffImageMime(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if ((buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2A && buf[3] === 0x00)
    || (buf[0] === 0x4D && buf[1] === 0x4D && buf[2] === 0x00 && buf[3] === 0x2A)) {
    return 'image/tiff';
  }
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
  if (buf[0] === 0x42 && buf[1] === 0x4D) return 'image/bmp';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
    && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) {
    return 'image/webp';
  }
  return null;
}

function _mimeFromPath(filePath, hint, buf = null) {
  const sniffed = buf ? _sniffImageMime(buf) : null;
  if (sniffed) return sniffed;
  const fromExt = _mimeFromExt(filePath);
  if (fromExt) return fromExt;
  return _normalizeMimeHint(hint) || 'image/png';
}

function _needsRasterNormalize(mime) {
  const m = String(mime || '').toLowerCase();
  return m === 'image/tiff' || m === 'image/tif' || m === 'image/bmp'
    || m === 'image/x-ms-bmp' || m === 'application/octet-stream';
}

function _isTransientOcrError(err) {
  if (!err) return false;
  const code = err.code;
  const status = Number(err.status) || 0;
  if (code === 'upstream_error' || code === 'timeout' || code === 'network') return true;
  if (status >= 500 && status < 600) return true;
  const msg = String(err.providerMessage || err.message || '');
  if (/Internal error encountered|temporarily unavailable|Provider returned error/i.test(msg)) return true;
  return false;
}

function _isUnprocessableImageError(err) {
  if (!err) return false;
  const msg = String(err.providerMessage || err.message || '');
  return /Unable to process input image|INVALID_ARGUMENT|invalid.*image/i.test(msg)
    || (Number(err.status) === 400 && /image/i.test(msg));
}

/**
 * Привести картинку к PNG, который Gemini стабильно ест:
 * TIFF/BMP/octet-stream → PNG; слишком большие → downscale.
 * Сначала Pillow (умеет гигантские TIFF >256MP), иначе ImageMagick.
 * Возвращает { path, mime, cleanup: [] } — cleanup удаляет temp-файлы.
 */
async function _prepareVisionImage(srcPath, mimeHint) {
  const cleanup = [];
  let mime = _mimeFromPath(srcPath, mimeHint);
  let workPath = srcPath;
  let st;
  try { st = await fs.stat(srcPath); } catch (_) { st = null; }
  const tooBig = st && st.size > OCR_MAX_IMAGE_BYTES;
  const mustConvert = _needsRasterNormalize(mime) || tooBig
    || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime);

  if (!mustConvert) {
    return { path: workPath, mime, cleanup };
  }

  const outPath = path.join(os.tmpdir(), `ocr_norm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`);
  cleanup.push(outPath);

  // 1) Pillow — без лимита area ImageMagick (TIFF 27k×10k иначе падает)
  try {
    await exec('/usr/bin/python3', ['-c',
      'import sys\n'
      + 'from PIL import Image\n'
      + 'Image.MAX_IMAGE_PIXELS = None\n'
      + 'src, dst, edge = sys.argv[1], sys.argv[2], int(sys.argv[3])\n'
      + 'im = Image.open(src)\n'
      + 'im.thumbnail((edge, edge))\n'
      + 'if im.mode not in ("RGB", "L"):\n'
      + '    im = im.convert("RGB")\n'
      + 'im.save(dst, "PNG", optimize=True)\n',
      srcPath, outPath, String(OCR_MAX_IMAGE_EDGE)
    ], { timeout: 120000 });
    // exec() wrapper doesn't pass timeout to spawn — check file exists
    await fs.access(outPath);
    workPath = outPath;
    mime = 'image/png';
    console.log(`[OCR] PIL-normalized ${path.basename(srcPath)} → PNG (was ${_mimeFromPath(srcPath, mimeHint)})`);
    return { path: workPath, mime, cleanup };
  } catch (pilErr) {
    console.warn(`[OCR] PIL normalize failed (${pilErr.message}) — trying ImageMagick`);
  }

  try {
    // ImageMagick: поднимаем area выше policy default 256MP (гигантские сканы)
    await exec(CONVERT_BIN, [
      '-limit', 'area', '1GP',
      '-limit', 'memory', '2GiB',
      '-limit', 'map', '4GiB',
      '-limit', 'disk', '8GiB',
      `${srcPath}[0]`,
      '-auto-orient',
      '-colorspace', 'sRGB',
      '-resize', `${OCR_MAX_IMAGE_EDGE}x${OCR_MAX_IMAGE_EDGE}>`,
      '-strip',
      outPath
    ]);
    workPath = outPath;
    mime = 'image/png';
    console.log(`[OCR] IM-normalized ${path.basename(srcPath)} → PNG (mime was ${_mimeFromPath(srcPath, mimeHint)})`);
  } catch (e) {
    console.warn(`[OCR] ImageMagick normalize failed (${e.message}) — sending original mime=${mime}`);
    try { await fs.unlink(outPath); } catch (_) {}
    cleanup.length = 0;
  }
  return { path: workPath, mime, cleanup };
}

async function _sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Один vision-вызов с transient-retry (502 Google Internal).
 */
async function _visionComplete(imageContent, model, maxTokens = 4000) {
  let lastErr = null;
  const attempts = 1 + OCR_TRANSIENT_RETRIES;
  for (let i = 0; i < attempts; i++) {
    try {
      return await aiProvider.complete({
        system: 'Ты — высокоточный OCR-движок. Извлекаешь текст из изображения дословно и структурированно.',
        messages: [{ role: 'user', content: imageContent }],
        model,
        maxTokens,
        temperature: 0.0
      });
    } catch (e) {
      lastErr = e;
      if (!_isTransientOcrError(e) || i === attempts - 1) throw e;
      const wait = (2 ** i) * 1500;
      console.warn(`[OCR] transient ${e.status || e.code || 'err'} on ${model}, retry ${i + 1}/${OCR_TRANSIENT_RETRIES} in ${wait}ms`);
      await _sleep(wait);
    }
  }
  throw lastErr;
}

/**
 * Прогнать одну PNG-страницу через OCR-модель.
 * Если основная модель вернула мусор/галлюцинацию — fallback на резервную.
 */
async function _ocrOnePage(pngPath, pageNum, originalName, opts = {}) {
  await _ocrAcquire();
  try {
    return await _ocrOnePageInner(pngPath, pageNum, originalName, opts);
  } finally {
    _ocrRelease();
  }
}

const OCR_BATCH_PROMPT = `Твоя задача — извлечь текст со сканов нескольких страниц документа.

СТРОГИЕ ПРАВИЛА:
1. Читай ТОЛЬКО то что РЕАЛЬНО видишь на каждом изображении.
2. НЕ ВЫДУМЫВАЙ текст. Если страница повёрнута — мысленно поверни.
3. Если фрагмент нечитаем — пиши "[НЕЧИТАЕМО]" вместо догадки.
4. Если изображение пустое — пиши "[ПУСТАЯ СТРАНИЦА]".
5. Сохраняй структуру: заголовки, нумерация, таблицы построчно.
6. НЕ добавляй комментарии — только текст.
7. ОБЯЗАТЕЛЬНО разделяй страницы маркерами ровно в таком виде:
<<<PAGE N>>>
(текст страницы N)
<<<END PAGE N>>>
где N — номер страницы из подписи к изображению.

Извлеки текст со всех страниц ниже:`;

/**
 * Распарсить ответ батч-OCR по маркерам <<<PAGE N>>>.
 */
function _parseBatchOcr(raw, pageNums) {
  const text = String(raw || '');
  const out = {};
  for (const n of pageNums) {
    const re = new RegExp(
      String.raw`<<<PAGE\s*${n}\s*>>>\s*([\s\S]*?)\s*<<<END\s*PAGE\s*${n}\s*>>>`,
      'i'
    );
    const m = text.match(re);
    if (m) out[n] = m[1].trim();
  }
  // fallback: если маркеров нет, но одна страница — весь текст
  if (pageNums.length === 1 && !out[pageNums[0]] && text.trim()) {
    out[pageNums[0]] = text.trim();
  }
  // fallback: сплит по <<<PAGE
  if (Object.keys(out).length === 0 && /<<<PAGE/i.test(text)) {
    const parts = text.split(/<<<PAGE\s*(\d+)\s*>>>/i);
    for (let i = 1; i < parts.length; i += 2) {
      const n = parseInt(parts[i], 10);
      let body = parts[i + 1] || '';
      body = body.replace(/<<<END\s*PAGE\s*\d+\s*>>>/ig, '').trim();
      if (n && body) out[n] = body;
    }
  }
  return out;
}

/**
 * Батч OCR: несколько страниц одним vision-запросом (главный ускоритель).
 * @param {{ path: string, page_number: number }[]} pages
 * @returns {Promise<Map<number,string>|Object>}
 */
async function _ocrPagesBatch(pages, originalName, opts = {}) {
  if (!pages || pages.length === 0) return {};
  if (pages.length === 1) {
    const p = pages[0];
    const t = await _ocrOnePage(p.path, p.page_number, originalName, opts);
    return { [p.page_number]: t };
  }

  await _ocrAcquire();
  try {
    const pageNums = pages.map((p) => p.page_number);
    const imageContent = [{ type: 'text', text: OCR_BATCH_PROMPT }];
    for (const p of pages) {
      const pngBuf = await fs.readFile(p.path);
      imageContent.push({ type: 'text', text: `\n--- изображение страницы ${p.page_number} ---\n` });
      imageContent.push({
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,' + pngBuf.toString('base64') }
      });
    }

    let text = '';
    const t0 = Date.now();
    try {
      const result = await aiProvider.complete({
        system: 'Ты — высокоточный OCR-движок. Извлекаешь текст из нескольких изображений дословно.',
        messages: [{ role: 'user', content: imageContent }],
        model: OCR_MODEL,
        maxTokens: Math.min(16000, 3500 * pages.length),
        temperature: 0.0
      });
      text = result.text || '';
      console.log(`[OCR:batch] pages ${pageNums.join(',')}: ${text.length} chars, ${Date.now() - t0}ms`);
    } catch (e) {
      console.warn(`[OCR:batch] pages ${pageNums.join(',')} failed: ${e.message} — fallback per-page`);
      const out = {};
      for (const p of pages) {
        try {
          out[p.page_number] = await _ocrOnePageInner(p.path, p.page_number, originalName, opts);
        } catch (_) {
          out[p.page_number] = `[ошибка OCR стр.${p.page_number}]`;
        }
      }
      return out;
    }

    let parsed = _parseBatchOcr(text, pageNums);
    const missing = pageNums.filter((n) => !parsed[n] || parsed[n].length < 20);
    if (missing.length && !opts.noFallback) {
      console.warn(`[OCR:batch] missing/short pages ${missing.join(',')} — per-page retry`);
      for (const n of missing) {
        const p = pages.find((x) => x.page_number === n);
        if (!p) continue;
        try {
          parsed[n] = await _ocrOnePageInner(p.path, n, originalName, { ...opts, noFallback: true });
        } catch (_) {
          parsed[n] = parsed[n] || `[ошибка OCR стр.${n}]`;
        }
      }
    }
    return parsed;
  } finally {
    _ocrRelease();
  }
}

async function _ocrOnePageInner(imgPath, pageNum, originalName, opts = {}) {
  const prepared = await _prepareVisionImage(imgPath, opts.mime);
  try {
    const buf = await fs.readFile(prepared.path);
    const dataUri = `data:${prepared.mime};base64,${buf.toString('base64')}`;
    const imageContent = [
      { type: 'text', text: OCR_PROMPT },
      { type: 'image_url', image_url: { url: dataUri } }
    ];

    let text = '';
    const t0 = Date.now();
    let primaryErr = null;
    try {
      const result = await _visionComplete(imageContent, OCR_MODEL, 4000);
      text = result.text || '';
      console.log(`[OCR] page ${pageNum}: ${text.length} chars, ${Date.now() - t0}ms (model=${OCR_MODEL}, mime=${prepared.mime})`);
    } catch (e) {
      primaryErr = e;
      console.warn(`[OCR] page ${pageNum} primary failed (${e.message}) — trying fallback`);

      // 400 Unable to process — ещё раз через принудительный PNG (если ещё не PNG)
      if (_isUnprocessableImageError(e) && prepared.mime !== 'image/png') {
        try {
          const forced = await _prepareVisionImage(imgPath, 'image/tiff'); // force convert path
          // если normalize не сработал — пробуем convert напрямую
          let pngPath = forced.path;
          let extraCleanup = forced.cleanup;
          if (forced.mime !== 'image/png') {
            const outPath = path.join(os.tmpdir(), `ocr_force_${Date.now()}.png`);
            await exec(CONVERT_BIN, [`${imgPath}[0]`, '-auto-orient', '-colorspace', 'sRGB', outPath]);
            pngPath = outPath;
            extraCleanup = [...extraCleanup, outPath];
          }
          try {
            const pngBuf = await fs.readFile(pngPath);
            const retryContent = [
              { type: 'text', text: OCR_PROMPT },
              { type: 'image_url', image_url: { url: 'data:image/png;base64,' + pngBuf.toString('base64') } }
            ];
            const r = await _visionComplete(retryContent, OCR_MODEL, 4000);
            text = r.text || '';
            console.log(`[OCR] page ${pageNum} PNG-retry: ${text.length} chars`);
            primaryErr = null;
          } finally {
            for (const p of extraCleanup) { try { await fs.unlink(p); } catch (_) {} }
          }
        } catch (re) {
          console.warn(`[OCR] page ${pageNum} PNG-retry failed: ${re.message}`);
        }
      }
    }

    const sameModel = OCR_FALLBACK_MODEL === OCR_MODEL;
    if (opts.noFallback || sameModel) {
      if (sameModel && text && _looksLikeHallucination(text, originalName)) {
        console.warn(`[OCR] page ${pageNum}: suspicious, same model — keep primary (${text.length} chars)`);
      }
      if (!text && primaryErr) throw primaryErr;
      return text;
    }
    if (!text || _looksLikeHallucination(text, originalName)) {
      if (!text) {
        console.warn(`[OCR] page ${pageNum}: primary empty, fallback=${OCR_FALLBACK_MODEL}`);
      } else {
        console.warn(`[OCR] page ${pageNum}: hallucination → fallback ${OCR_FALLBACK_MODEL}`);
      }
      try {
        const r2 = await _visionComplete(imageContent, OCR_FALLBACK_MODEL, 4000);
        const text2 = r2.text || '';
        console.log(`[OCR] page ${pageNum} fallback: ${text2.length} chars (model=${OCR_FALLBACK_MODEL})`);
        if (text2.length > text.length) text = text2;
      } catch (fe) {
        console.warn(`[OCR] page ${pageNum} fallback failed: ${fe.message} — SKIP page`);
        if (!text && primaryErr) throw primaryErr;
      }
    }

    return text;
  } finally {
    for (const p of prepared.cleanup) {
      try { await fs.unlink(p); } catch (_) {}
    }
  }
}

/**
 * Резолв пути файла документа на диске.
 * Учитывает download_url (/uploads/tender_archives/…, /api/files/download/…).
 */
function resolveDocumentPath(doc) {
  const baseDir = path.resolve(process.env.UPLOAD_DIR || process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads'));
  const candidates = [];

  const pushCand = (raw) => {
    if (!raw) return;
    let s = String(raw).trim();
    if (!s) return;
    if (/^\/api\/files\/download\//i.test(s)) {
      s = s.replace(/^\/api\/files\/download\//i, '');
    }
    if (/^\/?uploads\//i.test(s)) {
      s = s.replace(/^\/?uploads\//i, '');
    }
    if (path.isAbsolute(s)) {
      candidates.push(s);
    } else {
      candidates.push(path.join(baseDir, s));
      candidates.push(path.join(baseDir, path.basename(s)));
    }
  };

  pushCand(doc.download_url);
  pushCand(doc.filename);
  if (doc.filename && String(doc.filename).includes('/')) {
    pushCand(doc.filename);
  }

  for (const p of candidates) {
    try {
      if (p && fsSync.existsSync(p) && fsSync.statSync(p).isFile()) return p;
    } catch (_) {}
  }
  return null;
}

/**
 * Главная функция: OCR одного документа из БД по ID.
 * Кэширует результат в documents.ocr_text.
 *
 * @param {number} documentId
 * @returns {Promise<{text: string, pages: number, cached: boolean, status: string}>}
 */
async function ocrDocument(documentId) {
  // 1. Загружаем документ из БД
  const r = await db.query(
    `SELECT id, filename, original_name, mime_type, download_url, ocr_status, ocr_text
     FROM documents WHERE id = $1`,
    [documentId]
  );
  const doc = r.rows[0];
  if (!doc) throw new Error(`Document ${documentId} not found`);

  // 2. Уже OCR-ено успешно — возвращаем из кэша
  if (doc.ocr_status === 'done' && doc.ocr_text) {
    return {
      text: doc.ocr_text,
      pages: 0,
      cached: true,
      status: 'done'
    };
  }

  // 3. Не PDF — помечаем skipped (текст из docx/xlsx делает tender-ocr-worker)
  if (!/pdf/i.test(doc.mime_type || '') && !/\.pdf$/i.test(doc.original_name || '') && !/\.pdf$/i.test(doc.filename || '')) {
    await db.query(
      `UPDATE documents SET ocr_status = 'skipped', ocr_completed_at = NOW() WHERE id = $1`,
      [documentId]
    );
    return { text: '', pages: 0, cached: false, status: 'skipped' };
  }

  // 4. Помечаем processing
  await db.query(
    `UPDATE documents SET ocr_status = 'processing', ocr_started_at = NOW() WHERE id = $1`,
    [documentId]
  );

  // 5. Находим файл на диске (filename ИЛИ download_url → tender_archives/…)
  const pdfPath = resolveDocumentPath(doc);
  if (!pdfPath) {
    const err = `Файл не найден на диске: filename=${doc.filename} url=${doc.download_url || ''}`;
    await db.query(
      `UPDATE documents SET ocr_status = 'failed', ocr_error = $1, ocr_completed_at = NOW() WHERE id = $2`,
      [err, documentId]
    );
    throw new Error(err);
  }

  let tmpDir;
  try {
    // 6. PDF → PNG страницы
    const conv = await _pdfToPages(pdfPath);
    tmpDir = conv.tmpDir;
    if (conv.pages.length === 0) {
      throw new Error('PDF пустой или повреждён (0 страниц после pdftoppm)');
    }
    console.log(`[OCR] ${doc.original_name}: ${conv.pages.length} страниц (concurrency=${OCR_CONCURRENCY})`);

    // OCR страниц параллельно
    const texts = await _mapPool(conv.pages, OCR_CONCURRENCY, async (p) => {
      try {
        const txt = await _ocrOnePage(p.path, p.page_number, doc.original_name, { noFallback: false });
        return `═══ Страница ${p.page_number} ═══\n${txt.trim()}`;
      } catch (e) {
        console.warn(`[OCR] page ${p.page_number} FAILED:`, e.message);
        return `═══ Страница ${p.page_number} ═══\n[ошибка OCR: ${e.message}]`;
      }
    });
    const fullText = texts.join('\n\n');

    // 8. Сохраняем результат
    await db.query(
      `UPDATE documents SET
         ocr_status = 'done',
         ocr_text = $1,
         ocr_pages_count = $2,
         ocr_model = $3,
         ocr_completed_at = NOW(),
         ocr_error = NULL
       WHERE id = $4`,
      [fullText, conv.pages.length, OCR_MODEL, documentId]
    );

    return {
      text: fullText,
      pages: conv.pages.length,
      cached: false,
      status: 'done'
    };
  } catch (e) {
    await db.query(
      `UPDATE documents SET ocr_status = 'failed', ocr_error = $1, ocr_completed_at = NOW() WHERE id = $2`,
      [String(e.message || e).substring(0, 1000), documentId]
    );
    throw e;
  } finally {
    if (tmpDir) await _cleanup(tmpDir);
  }
}

/**
 * OCR всех PDF-документов тендера. Параллельно (но не больше 3 одновременно).
 * Возвращает массив {document_id, original_name, text, pages}.
 */
async function ocrTenderDocuments(tenderId) {
  const r = await db.query(
    `SELECT id, original_name, mime_type, ocr_status, ocr_text
     FROM documents WHERE tender_id = $1 AND mime_type ILIKE '%pdf%'
     ORDER BY id`,
    [tenderId]
  );
  const results = [];
  // Последовательно, чтобы не положить routerai 10+ параллельными запросами
  for (const doc of r.rows) {
    try {
      const ocr = await ocrDocument(doc.id);
      results.push({
        document_id: doc.id,
        original_name: doc.original_name,
        text: ocr.text,
        pages: ocr.pages,
        cached: ocr.cached
      });
    } catch (e) {
      console.warn(`[OCR] tender ${tenderId} doc ${doc.id} FAILED:`, e.message);
      results.push({
        document_id: doc.id,
        original_name: doc.original_name,
        text: '',
        error: e.message
      });
    }
  }
  return results;
}

/**
 * OCR всех PDF-документов работы.
 */
async function ocrWorkDocuments(workId) {
  const r = await db.query(
    `SELECT id, original_name, mime_type, ocr_status
     FROM documents WHERE work_id = $1 AND mime_type ILIKE '%pdf%'
     ORDER BY id`,
    [workId]
  );
  const results = [];
  for (const doc of r.rows) {
    try {
      const ocr = await ocrDocument(doc.id);
      results.push({
        document_id: doc.id,
        original_name: doc.original_name,
        text: ocr.text,
        pages: ocr.pages,
        cached: ocr.cached
      });
    } catch (e) {
      console.warn(`[OCR] work ${workId} doc ${doc.id} FAILED:`, e.message);
      results.push({
        document_id: doc.id,
        original_name: doc.original_name,
        text: '',
        error: e.message
      });
    }
  }
  return results;
}

/**
 * OCR PDF-файла по пути на диске (без привязки к БД).
 * Используется в tkp-parser для скан-PDF при загрузке готового ТКП.
 * @param {string} pdfPath  Абсолютный путь к файлу на диске
 * @param {string} originalName  Для anti-hallucination эвристики
 * @param {{ dpi?: number, retryEmptyDpi?: number }} [opts]
 * @returns {Promise<{ text: string, diagnostics: object }>}
 */
async function ocrPdfPath(pdfPath, originalName, opts = {}) {
  const dpi = opts.dpi || 100;
  // По умолчанию без DPI-retry: удваивает время. Включить явно: retryEmptyDpi: 200
  const retryEmptyDpi = opts.retryEmptyDpi != null ? opts.retryEmptyDpi : 0;
  const concurrency = Math.max(1, opts.concurrency || OCR_CONCURRENCY);
  const batchSize = Math.max(1, opts.batchSize || OCR_BATCH_SIZE);
  const noFallback = !!opts.noFallback;
  const tAll = Date.now();
  const { tmpDir, pages } = await _pdfToPages(pdfPath, opts.maxPages || OCR_MAX_PAGES, dpi);
  const pageDiag = [];
  try {
    if (pages.length === 0) {
      return { text: '', diagnostics: { pages: 0, dpi, page_diag: [] } };
    }
    console.log(`[OCR:pdfPath] ${originalName}: ${pages.length} стр, dpi=${dpi}, batch=${batchSize}, conc=${concurrency}`);

    // Батчи страниц → параллельные vision-вызовы (глобальный семафор внутри)
    const batches = [];
    for (let i = 0; i < pages.length; i += batchSize) {
      batches.push(pages.slice(i, i + batchSize));
    }
    const textsByPage = {};
    await _mapPool(batches, concurrency, async (batch) => {
      try {
        const parsed = await _ocrPagesBatch(batch, originalName, { noFallback });
        for (const p of batch) {
          const txt = String(parsed[p.page_number] || '').trim();
          textsByPage[p.page_number] = txt || `[ошибка OCR стр.${p.page_number}]`;
          pageDiag.push({
            page: p.page_number,
            chars: txt.length,
            empty: _isEmptyOcrText(txt),
            dpi,
            batch: batch.map((x) => x.page_number).join(',')
          });
        }
      } catch (e) {
        console.warn(`[OCR:pdfPath] batch failed: ${e.message}`);
        for (const p of batch) {
          textsByPage[p.page_number] = `[ошибка OCR стр.${p.page_number}]`;
          pageDiag.push({ page: p.page_number, chars: 0, empty: true, error: e.message, dpi });
        }
      }
    });

    const ordered = pages.map((p) => textsByPage[p.page_number] || '');
    const emptyPages = pages
      .filter((p) => _isEmptyOcrText(textsByPage[p.page_number] || ''))
      .map((p) => p.page_number);

    // Пустые страницы — один retry на более высоком DPI (только если явно включено)
    if (emptyPages.length > 0 && retryEmptyDpi && retryEmptyDpi !== dpi) {
      let retryDir = null;
      try {
        const conv2 = await _pdfToPages(pdfPath, opts.maxPages || OCR_MAX_PAGES, retryEmptyDpi);
        retryDir = conv2.tmpDir;
        await _mapPool(emptyPages, concurrency, async (pageNum) => {
          const p2 = conv2.pages.find((x) => x.page_number === pageNum);
          if (!p2) return;
          try {
            const txt2 = (await _ocrOnePage(p2.path, pageNum, originalName, { noFallback })).trim();
            if (!_isEmptyOcrText(txt2) && txt2.length > (textsByPage[pageNum] || '').length) {
              textsByPage[pageNum] = txt2;
              const di = pageDiag.find((d) => d.page === pageNum);
              if (di) {
                di.chars = txt2.length;
                di.empty = false;
                di.retry_dpi = retryEmptyDpi;
              }
              console.log(`[OCR:pdfPath] page ${pageNum} recovered at ${retryEmptyDpi} DPI (${txt2.length} chars)`);
            }
          } catch (e) {
            console.warn(`[OCR:pdfPath] page ${pageNum} DPI${retryEmptyDpi} retry failed: ${e.message}`);
          }
        });
      } finally {
        if (retryDir) await _cleanup(retryDir);
      }
    }

    const finalTexts = pages.map((p) => textsByPage[p.page_number] || ordered[p.page_number - 1] || '');
    console.log(`[OCR:pdfPath] ${originalName}: done in ${Date.now() - tAll}ms, ${pages.length} pages, ${batches.length} batches`);
    return {
      text: finalTexts.join('\n\n'),
      diagnostics: {
        pages: pages.length,
        dpi,
        concurrency,
        batch_size: batchSize,
        batches: batches.length,
        retry_empty_dpi: retryEmptyDpi,
        empty_pages: emptyPages.length,
        elapsed_ms: Date.now() - tAll,
        page_diag: pageDiag
      }
    };
  } finally {
    await _cleanup(tmpDir);
  }
}

/**
 * OCR буфера изображения (JPG/PNG/WEBP/TIFF/BMP/GIF).
 * Единая точка входа: sniff MIME → при необходимости Pillow/IM → PNG → Gemini.
 * Все будущие TIFF/сканы из тендеров/ТКП/Mimir идут сюда — без разовых костылей.
 * @param {Buffer} buf
 * @param {string} mime  MIME-тип (image/jpeg, image/png, ...) — hint, не источник истины
 * @param {string} originalName
 * @returns {Promise<string>}
 */
async function ocrImageBuffer(buf, mime, originalName) {
  const resolvedMime = _mimeFromPath(originalName || '', mime, buf);
  const extMap = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/bmp': '.bmp',
    'image/tiff': '.tif'
  };
  const ext = extMap[resolvedMime] || path.extname(originalName || '') || '.bin';
  const tmpPath = path.join(os.tmpdir(), `tkp_img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${ext}`);
  try {
    await fs.writeFile(tmpPath, buf);
    return await _ocrOnePage(tmpPath, 1, originalName, { mime: resolvedMime });
  } finally {
    try { await fs.unlink(tmpPath); } catch (_) {}
  }
}

/**
 * OCR многих PDF одним пулом батчей (кросс-файлово).
 * Именно так получается «DeepSeek за 30 сек»: не 25×отдельных PDF,
 * а ~N страниц → ceil(N/batchSize) vision-вызовов при concurrency.
 *
 * @param {{ path: string, originalName: string, key: string }[]} files
 * @param {{ dpi?: number, batchSize?: number, concurrency?: number, maxPages?: number }} [opts]
 * @returns {Promise<{ byKey: Record<string,string>, diagnostics: object }>}
 */
async function ocrManyPdfPaths(files, opts = {}) {
  if (!files || !files.length) {
    return { byKey: {}, diagnostics: { files: 0, pages: 0, batches: 0, ms: 0 } };
  }
  const dpi = opts.dpi || 90;
  const batchSize = Math.max(1, opts.batchSize || OCR_BATCH_SIZE);
  const concurrency = Math.max(1, opts.concurrency || OCR_CONCURRENCY);
  const maxPages = opts.maxPages || 40;
  const tAll = Date.now();
  const tmpDirs = [];
  const pageJobs = []; // { key, localPage, path, gid }

  try {
    const convs = await _mapPool(files, Math.min(10, files.length), async (f) => {
      try {
        const conv = await _pdfToPages(f.path, maxPages, dpi);
        return { ok: true, key: f.key, originalName: f.originalName, tmpDir: conv.tmpDir, pages: conv.pages };
      } catch (e) {
        console.warn(`[OCR:many] pdftoppm ${f.originalName}: ${e.message}`);
        return { ok: false, key: f.key, originalName: f.originalName, error: e.message, pages: [], tmpDir: null };
      }
    });

    let gid = 1;
    const gidMeta = new Map(); // gid -> { key, localPage, originalName }
    for (const c of convs) {
      if (c.tmpDir) tmpDirs.push(c.tmpDir);
      if (!c.ok) continue;
      for (const p of c.pages) {
        const id = gid++;
        pageJobs.push({
          key: c.key,
          localPage: p.page_number,
          path: p.path,
          page_number: id, // уникальный id для маркеров батча
          gid: id
        });
        gidMeta.set(id, { key: c.key, localPage: p.page_number, originalName: c.originalName });
      }
    }

    console.log(`[OCR:many] ${files.length} pdf → ${pageJobs.length} pages, dpi=${dpi}, batch=${batchSize}, conc=${concurrency}`);

    const textsByGid = {};
    const batches = [];
    for (let i = 0; i < pageJobs.length; i += batchSize) {
      batches.push(pageJobs.slice(i, i + batchSize));
    }

    await _mapPool(batches, concurrency, async (batch) => {
      // originalName для anti-halluc — первый файл в батче (эвристика мягкая)
      const label = gidMeta.get(batch[0].gid)?.originalName || 'archive';
      try {
        const parsed = await _ocrPagesBatch(batch, label, { noFallback: true });
        for (const p of batch) {
          textsByGid[p.gid] = String(parsed[p.page_number] || '').trim();
        }
      } catch (e) {
        console.warn(`[OCR:many] batch failed: ${e.message}`);
        for (const p of batch) textsByGid[p.gid] = '';
      }
    });

    const byKey = {};
    const pagesByKey = {};
    for (const job of pageJobs) {
      if (!pagesByKey[job.key]) pagesByKey[job.key] = [];
      pagesByKey[job.key].push({ localPage: job.localPage, text: textsByGid[job.gid] || '' });
    }
    for (const [key, pages] of Object.entries(pagesByKey)) {
      pages.sort((a, b) => a.localPage - b.localPage);
      byKey[key] = pages.map((p) => p.text).filter(Boolean).join('\n\n');
    }
    // PDF без страниц / с ошибкой pdftoppm
    for (const c of convs) {
      if (!c.ok && byKey[c.key] == null) byKey[c.key] = '';
    }

    const ms = Date.now() - tAll;
    console.log(`[OCR:many] done ${ms}ms, ${batches.length} batches, keys=${Object.keys(byKey).length}`);
    return {
      byKey,
      diagnostics: {
        files: files.length,
        pages: pageJobs.length,
        batches: batches.length,
        dpi,
        batchSize,
        concurrency,
        ms
      }
    };
  } finally {
    for (const d of tmpDirs) await _cleanup(d);
  }
}

module.exports = {
  ocrDocument,
  ocrTenderDocuments,
  ocrWorkDocuments,
  ocrPdfPath,
  ocrManyPdfPaths,
  ocrImageBuffer,
  resolveDocumentPath,
  OCR_MODEL,
  OCR_MAX_PAGES
};

// Backward-compat: callers that expect a bare string still work if they
// accidentally treat the new object as string — see tkp-parser which uses .text.
