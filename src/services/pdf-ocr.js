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

const OCR_MODEL = process.env.OCR_MODEL || 'google/gemini-2.5-flash';
const OCR_MAX_PAGES = parseInt(process.env.OCR_MAX_PAGES || '20', 10); // защита от 100-страничных монстров
const PDFTOPPM_BIN = '/usr/bin/pdftoppm';

const OCR_PROMPT = 'Прочитай ВСЁ что написано на этом изображении (страница технического документа). Извлеки текст ДОСЛОВНО, сохраняя структуру (заголовки, пункты списка, таблицы). НЕ добавляй комментарии и НЕ переводи. Если есть таблицы — расшифровывай построчно. Если есть штампы или подписи — упомяни их (например: "[штамп: ОТК]", "[подпись]").';

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
 */
async function _ocrOnePage(pngPath, pageNum) {
  const pngBuf = await fs.readFile(pngPath);
  const pngBase64 = pngBuf.toString('base64');
  const t0 = Date.now();
  const result = await aiProvider.complete({
    system: 'Ты — высокоточный OCR-движок. Извлекаешь текст из изображения дословно и структурированно.',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: OCR_PROMPT },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,' + pngBase64 } }
      ]
    }],
    model: OCR_MODEL,
    maxTokens: 4000,
    temperature: 0.0
  });
  const ms = Date.now() - t0;
  const text = result.text || '';
  console.log(`[OCR] page ${pageNum}: ${text.length} chars, ${ms}ms (model=${OCR_MODEL})`);
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
        const txt = await _ocrOnePage(p.path, p.page_number);
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

module.exports = {
  ocrDocument,
  ocrTenderDocuments,
  ocrWorkDocuments,
  OCR_MODEL,
  OCR_MAX_PAGES
};
