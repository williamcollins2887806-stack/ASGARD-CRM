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
const OCR_MODEL = process.env.OCR_MODEL || 'mistralai/pixtral-large-2411';
const OCR_FALLBACK_MODEL = process.env.OCR_FALLBACK_MODEL || 'google/gemini-2.5-flash';
const OCR_MAX_PAGES = parseInt(process.env.OCR_MAX_PAGES || '20', 10); // защита от 100-страничных монстров
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
 * Используется для решения нужен ли fallback на другую модель.
 */
function _looksLikeHallucination(text, originalName) {
  if (!text || text.length < 50) return true;
  // Если в названии документа есть слова — хотя бы одно должно быть в OCR
  const nameWords = (originalName || '').toLowerCase()
    .replace(/[.,\-_()]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 4 && !/^\d/.test(w));
  if (nameWords.length > 0) {
    const lower = text.toLowerCase();
    const found = nameWords.filter(w => lower.includes(w));
    // Если ни одно слово из названия не нашлось — подозрительно
    if (found.length === 0) return true;
  }
  return false;
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
 */
async function _pdfToPages(pdfPath, maxPages = OCR_MAX_PAGES) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mimir-ocr-'));
  const outPrefix = path.join(tmpDir, 'page');

  // pdftoppm -png -r 150 -f 1 -l N <pdf> <prefix> → создаёт <prefix>-1.png, <prefix>-2.png, ...
  await exec(PDFTOPPM_BIN, [
    '-png', '-r', '150',         // 150 DPI — баланс качества и веса
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
 * Прогнать одну PNG-страницу через OCR-модель.
 * Если основная модель вернула мусор/галлюцинацию — fallback на резервную.
 */
async function _ocrOnePage(pngPath, pageNum, originalName) {
  const pngBuf = await fs.readFile(pngPath);
  const pngBase64 = pngBuf.toString('base64');

  const imageContent = [
    { type: 'text', text: OCR_PROMPT },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,' + pngBase64 } }
  ];

  const t0 = Date.now();
  const result = await aiProvider.complete({
    system: 'Ты — высокоточный OCR-движок. Извлекаешь текст из изображения дословно и структурированно.',
    messages: [{ role: 'user', content: imageContent }],
    model: OCR_MODEL,
    maxTokens: 4000,
    temperature: 0.0
  });
  let text = result.text || '';
  const ms = Date.now() - t0;
  console.log(`[OCR] page ${pageNum}: ${text.length} chars, ${ms}ms (model=${OCR_MODEL})`);

  // Если результат похож на галлюцинацию — пробуем резервную модель
  if (_looksLikeHallucination(text, originalName)) {
    console.warn(`[OCR] page ${pageNum}: looks like hallucination, retrying with ${OCR_FALLBACK_MODEL}`);
    try {
      const r2 = await aiProvider.complete({
        system: 'Ты — высокоточный OCR-движок. Извлекаешь текст из изображения дословно и структурированно.',
        messages: [{ role: 'user', content: imageContent }],
        model: OCR_FALLBACK_MODEL,
        maxTokens: 4000,
        temperature: 0.0
      });
      const text2 = r2.text || '';
      console.log(`[OCR] page ${pageNum} fallback: ${text2.length} chars (model=${OCR_FALLBACK_MODEL})`);
      if (text2.length > text.length) text = text2;
    } catch (fe) {
      console.warn(`[OCR] page ${pageNum} fallback failed: ${fe.message}`);
    }
  }

  return text;
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
    `SELECT id, filename, original_name, mime_type, ocr_status, ocr_text
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

  // 3. Не PDF — помечаем skipped
  if (!/pdf/i.test(doc.mime_type || '')) {
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

  // 5. Находим файл на диске
  // В этом проекте файлы лежат в uploads/<filename>
  const baseDir = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');
  const pdfPath = path.join(baseDir, doc.filename);
  if (!fsSync.existsSync(pdfPath)) {
    const err = `Файл не найден на диске: ${pdfPath}`;
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
    console.log(`[OCR] ${doc.original_name}: ${conv.pages.length} страниц`);

    // 7. OCR каждой страницы (последовательно чтобы не задудосить routerai)
    const texts = [];
    for (const p of conv.pages) {
      try {
        const txt = await _ocrOnePage(p.path, p.page_number, doc.original_name);
        texts.push(`═══ Страница ${p.page_number} ═══\n${txt.trim()}`);
      } catch (e) {
        console.warn(`[OCR] page ${p.page_number} FAILED:`, e.message);
        texts.push(`═══ Страница ${p.page_number} ═══\n[ошибка OCR: ${e.message}]`);
      }
    }
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
 * @returns {Promise<string>}
 */
async function ocrPdfPath(pdfPath, originalName) {
  const { tmpDir, pages } = await _pdfToPages(pdfPath);
  try {
    if (pages.length === 0) return '';
    const texts = [];
    for (const p of pages) {
      try {
        const txt = await _ocrOnePage(p.path, p.page_number, originalName);
        texts.push(txt.trim());
      } catch (e) {
        console.warn(`[OCR:pdfPath] page ${p.page_number} failed: ${e.message}`);
        texts.push(`[ошибка OCR стр.${p.page_number}]`);
      }
    }
    return texts.join('\n\n');
  } finally {
    await _cleanup(tmpDir);
  }
}

/**
 * OCR буфера изображения (JPG/PNG/WEBP) без записи документа в БД.
 * Используется в tkp-parser для загружаемых фото/скринов ТКП.
 * @param {Buffer} buf
 * @param {string} mime  MIME-тип (image/jpeg, image/png, ...)
 * @param {string} originalName
 * @returns {Promise<string>}
 */
async function ocrImageBuffer(buf, mime, originalName) {
  const ext = (mime || '').includes('png') ? '.png' : '.jpg';
  const tmpPath = path.join(os.tmpdir(), `tkp_img_${Date.now()}${ext}`);
  try {
    await fs.writeFile(tmpPath, buf);
    return await _ocrOnePage(tmpPath, 1, originalName);
  } finally {
    try { await fs.unlink(tmpPath); } catch (_) {}
  }
}

module.exports = {
  ocrDocument,
  ocrTenderDocuments,
  ocrWorkDocuments,
  ocrPdfPath,
  ocrImageBuffer,
  OCR_MODEL,
  OCR_MAX_PAGES
};
