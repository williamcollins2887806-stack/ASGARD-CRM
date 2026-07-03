/**
 * ASGARD CRM — Mimir Conductor: агент «Парсер документов» (Сессия 4, Шаг 4.1)
 * ═══════════════════════════════════════════════════════════════════════════
 * БЕЗ LLM (для базового парсинга; vision-fallback использует AI). Берёт
 * document_ids → парсит каждый через parseDocumentSafe (PDF/DOCX/DOC/XLSX/
 * IMAGE/TXT/CSV/RTF) с гарантированным каскадом fallback-стратегий.
 *
 * Артефакт: parsed_documents
 *   { summary, key_findings[], documents:[{ id, name, mime_type, size_kb,
 *     content, content_chars, content_hash, extraction_strategy,
 *     extraction_strategies_tried[] }] }
 *
 * ОПУС-АРХИТЕКТУРА (19.06.2026 v2): «document_parser ОБЯЗАН вернуть текст из
 * ЛЮБОГО документа». parseDocumentSafe пробует профильные парсеры по
 * расширению (pdf-parse → pdf-ocr; mammoth → unzip raw XML; libreoffice→
 * docx→mammoth; exceljs; image-vision-OCR), затем универсальный gpt-vision
 * fallback на blob (до 10 MB). Каждая стратегия логируется; финальный
 * extraction_strategy виден в артефакте.
 *
 * Устойчивость: если документов нет — возвращает пустой, но валидный артефакт.
 * Если ВСЕ стратегии вернули пустоту — content='', strategy='all_failed',
 * extraction_strategies_tried собирает причины (для work_scope_researcher).
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const db = require('../../db');
const { sha256 } = require('./_util');

// Порог "достаточно текста" — выше него считаем стратегию успешной и
// не пробуем следующие. 100 симв = ~абзац, экономит токены на vision-fallback.
const MIN_TEXT_CHARS = 100;
// Лимит размера файла для универсального vision-fallback (LLM с base64).
const MAX_VISION_FALLBACK_BYTES = 10 * 1024 * 1024;

const UPLOAD_BASE_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads');

function _execCapture(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', () => resolve({ code: 127, stdout, stderr }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/** Безопасный resolve пути в пределах UPLOAD_BASE_DIR. */
function _resolveUploadPath(filenameOrUrl) {
  if (!filenameOrUrl) return null;
  // Принимаем как просто имя файла, так и file_url (например /uploads/mail/2026-06-17/UUID/file.docx).
  let trimmed = String(filenameOrUrl).trim();
  if (!trimmed || trimmed.includes('\0')) return null;
  // Если приходит «/uploads/…» — убираем ведущий «/uploads/» (UPLOAD_BASE_DIR уже /var/www/…/uploads).
  if (/^\/?uploads\//i.test(trimmed)) {
    trimmed = trimmed.replace(/^\/?uploads\//i, '');
  } else if (/^\//.test(trimmed) && !path.isAbsolute(trimmed)) {
    // relative absolute-like (без /uploads/) — оставляем
  }
  const normalized = path.normalize(trimmed);
  const resolved = path.resolve(
    path.isAbsolute(normalized) ? normalized : path.join(UPLOAD_BASE_DIR, normalized)
  );
  const relative = path.relative(UPLOAD_BASE_DIR, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  if (!fs.existsSync(resolved)) return null;
  return resolved;
}

function _shortErr(e) {
  return String(e && e.message ? e.message : e).slice(0, 80);
}

/**
 * ГАРАНТИРОВАННЫЙ парсер документа с каскадом fallback-стратегий.
 *
 * Возвращает { text, strategy, chars, strategies_tried[] }.
 * Если все стратегии упали — text='', strategy='all_failed',
 * strategies_tried содержит причины каждой.
 *
 * Стратегии (в порядке):
 *   .pdf   → pdf_parse → pdf_ocr_vision (pdftoppm + LLM vision)
 *   .docx  → mammoth → mammoth_html → docx_raw_xml (unzip + grep w:t)
 *   .doc   → libreoffice→docx→mammoth
 *   .xls/.xlsx → exceljs
 *   .txt/.csv/.rtf → utf-8 readFile
 *   .jpg/.png/.webp/.bmp/.tiff → image_vision_ocr
 *   ВСЕГДА (если предыдущие <MIN_TEXT_CHARS и размер<10MB):
 *     gpt55_vision_fallback (универсальный vision на blob)
 */
async function parseDocumentSafe(absPath, mime, originalName) {
  const ext = path.extname(originalName || absPath || '').toLowerCase();
  const mimeLc = (mime || '').toLowerCase();
  const strategies = [];

  function _ret(text, strategy) {
    return { text, strategy, chars: text.length, strategies_tried: strategies };
  }

  // ── 1. По расширению пробуем профильный парсер ────────────────────────────
  if (ext === '.pdf' || mimeLc === 'application/pdf') {
    // Стратегия 1: pdf-parse
    try {
      const pdfParse = require('pdf-parse');
      const buf = fs.readFileSync(absPath);
      const r = await pdfParse(buf);
      if (r.text && r.text.trim().length >= MIN_TEXT_CHARS) {
        strategies.push('pdf_parse_ok');
        return _ret(r.text, 'pdf_parse');
      }
      strategies.push('pdf_parse_empty:' + (r.text ? r.text.trim().length : 0));
    } catch (e) { strategies.push('pdf_parse_failed:' + _shortErr(e)); }

    // Стратегия 2: OCR через pdftoppm + vision
    try {
      const pdfOcr = require('../../pdf-ocr');
      if (typeof pdfOcr.ocrPdfPath === 'function') {
        const ocrText = await pdfOcr.ocrPdfPath(absPath, originalName);
        if (ocrText && ocrText.trim().length >= MIN_TEXT_CHARS) {
          strategies.push('pdf_ocr_vision_ok');
          return _ret(ocrText, 'pdf_ocr_vision');
        }
        strategies.push('pdf_ocr_empty:' + (ocrText ? ocrText.trim().length : 0));
      } else {
        strategies.push('pdf_ocr_unavailable');
      }
    } catch (e) { strategies.push('pdf_ocr_failed:' + _shortErr(e)); }
  }

  if (ext === '.docx' || mimeLc.includes('officedocument.wordprocessingml')) {
    // Стратегия 1: mammoth extractRawText
    try {
      const mammoth = require('mammoth');
      const r = await mammoth.extractRawText({ path: absPath });
      if (r.value && r.value.trim().length >= MIN_TEXT_CHARS) {
        strategies.push('mammoth_ok');
        return _ret(r.value, 'mammoth');
      }
      strategies.push('mammoth_empty:' + (r.value ? r.value.trim().length : 0));
    } catch (e) { strategies.push('mammoth_failed:' + _shortErr(e)); }

    // Стратегия 2: mammoth convertToHtml (иногда вытягивает таблицы что raw теряет)
    try {
      const mammoth = require('mammoth');
      const buf = fs.readFileSync(absPath);
      const r = await mammoth.convertToHtml({ buffer: buf });
      if (r && r.value) {
        const text = String(r.value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (text.length >= MIN_TEXT_CHARS) {
          strategies.push('mammoth_html_ok');
          return _ret(text, 'mammoth_html');
        }
        strategies.push('mammoth_html_empty:' + text.length);
      }
    } catch (e) { strategies.push('mammoth_html_failed:' + _shortErr(e)); }

    // Стратегия 3: unzip word/document.xml + grep <w:t>…</w:t>
    try {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asgard_docx_'));
      try {
        const res = await _execCapture('unzip', ['-o', '-q', absPath, 'word/document.xml', '-d', tmpDir], { timeout: 30000 });
        if (res.code === 0) {
          const xmlPath = path.join(tmpDir, 'word', 'document.xml');
          if (fs.existsSync(xmlPath)) {
            const xml = fs.readFileSync(xmlPath, 'utf8');
            const out = [];
            const re = /<w:t[^>]*>([^<]*)<\/w:t>/g;
            let m;
            while ((m = re.exec(xml))) out.push(m[1]);
            const text = out.join(' ').replace(/\s+/g, ' ').trim();
            if (text.length >= MIN_TEXT_CHARS) {
              strategies.push('docx_raw_xml_ok');
              return _ret(text, 'docx_raw_xml');
            }
            strategies.push('docx_raw_xml_empty:' + text.length);
          } else {
            strategies.push('docx_raw_xml_no_xml');
          }
        } else {
          strategies.push('docx_raw_xml_unzip_code:' + res.code);
        }
      } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
      }
    } catch (e) { strategies.push('docx_raw_failed:' + _shortErr(e)); }
  }

  if (ext === '.doc' || mimeLc === 'application/msword') {
    // Стратегия: libreoffice --headless --convert-to docx → mammoth
    try {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asgard_lo_'));
      try {
        const res = await _execCapture(
          'libreoffice',
          ['--headless', '--convert-to', 'docx', '--outdir', tmpDir, absPath],
          { timeout: 60000 }
        );
        if (res.code === 0) {
          const files = fs.readdirSync(tmpDir).filter((f) => f.toLowerCase().endsWith('.docx'));
          if (files.length) {
            const docxPath = path.join(tmpDir, files[0]);
            const mammoth = require('mammoth');
            const buf = fs.readFileSync(docxPath);
            const mres = await mammoth.extractRawText({ buffer: buf });
            if (mres.value && mres.value.trim().length >= MIN_TEXT_CHARS) {
              strategies.push('doc_to_docx_libreoffice_ok');
              return _ret(mres.value, 'doc_to_docx_libreoffice');
            }
            strategies.push('doc_libreoffice_empty:' + (mres.value ? mres.value.trim().length : 0));
          } else {
            strategies.push('doc_libreoffice_no_docx');
          }
        } else {
          strategies.push('doc_libreoffice_code:' + res.code);
        }
      } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
      }
    } catch (e) { strategies.push('doc_libreoffice_failed:' + _shortErr(e)); }
  }

  if (['.xlsx', '.xls'].includes(ext) || mimeLc.includes('spreadsheet')) {
    try {
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(absPath);
      let text = '';
      wb.eachSheet((sheet) => {
        text += `\n=== ${sheet.name} ===\n`;
        sheet.eachRow((row) => {
          const vals = [];
          row.eachCell({ includeEmpty: false }, (c) => {
            const v = c.value;
            if (v == null) return;
            if (typeof v === 'object') {
              vals.push(String(v.text || v.result || v.richText && v.richText.map(rt => rt.text).join('') || JSON.stringify(v)));
            } else {
              vals.push(String(v));
            }
          });
          if (vals.length) text += vals.join(' | ') + '\n';
        });
      });
      if (text.trim().length >= MIN_TEXT_CHARS) {
        strategies.push('xlsx_exceljs_ok');
        return _ret(text, 'xlsx_exceljs');
      }
      strategies.push('xlsx_empty:' + text.trim().length);
    } catch (e) { strategies.push('xlsx_failed:' + _shortErr(e)); }
  }

  if (['.txt', '.csv', '.rtf'].includes(ext) || mimeLc === 'text/plain' || mimeLc === 'text/csv') {
    try {
      const buf = fs.readFileSync(absPath);
      const text = buf.toString('utf8');
      if (text.trim().length >= MIN_TEXT_CHARS) {
        strategies.push('plaintext_ok');
        return _ret(text, 'plaintext');
      }
      strategies.push('plaintext_empty:' + text.trim().length);
    } catch (e) { strategies.push('plaintext_failed:' + _shortErr(e)); }
  }

  if (['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.gif'].includes(ext) || mimeLc.startsWith('image/')) {
    try {
      const pdfOcr = require('../../pdf-ocr');
      if (typeof pdfOcr.ocrImageBuffer === 'function') {
        const buf = fs.readFileSync(absPath);
        const mimeReal = mime || (ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg');
        const ocrText = await pdfOcr.ocrImageBuffer(buf, mimeReal, originalName);
        // Для картинок порог ниже — может быть подпись/штамп с короткой надписью
        if (ocrText && ocrText.trim().length >= 50) {
          strategies.push('image_vision_ocr_ok');
          return _ret(ocrText, 'image_vision_ocr');
        }
        strategies.push('image_vision_empty:' + (ocrText ? ocrText.trim().length : 0));
      } else {
        strategies.push('image_vision_unavailable');
      }
    } catch (e) { strategies.push('image_vision_failed:' + _shortErr(e)); }
  }

  // ── 2. Универсальный fallback: gpt-vision на blob ─────────────────────────
  // Работает на сканах, кириллических OCR-проблемах, .rtf, .odt и т.п.
  // Лимит 10 MB — выше уходим в OOM и провайдер режет.
  try {
    const stat = fs.statSync(absPath);
    if (stat.size > MAX_VISION_FALLBACK_BYTES) {
      strategies.push('gpt_vision_too_big:' + Math.round(stat.size / 1024 / 1024) + 'MB');
    } else {
      const aiProvider = require('../../ai-provider');
      if (aiProvider.isStubMode && aiProvider.isStubMode()) {
        strategies.push('gpt_vision_stub_mode');
      } else {
        const buf = fs.readFileSync(absPath);
        const b64 = buf.toString('base64');
        // Anthropic поддерживает image-blocks для image/* и document-blocks для pdf.
        // Для не-картинок маршрутизация в API сложная — используем generic image
        // блок только если mime реально image/*; иначе пропускаем (картинки уже
        // обработаны выше). Здесь мы попадаем чаще всего как доп-fallback для
        // случаев "ничего не сработало".
        const mediaType = mime || (
          ext === '.pdf' ? 'application/pdf' :
          ext === '.png' ? 'image/png' :
          ['.jpg', '.jpeg'].includes(ext) ? 'image/jpeg' :
          ext === '.webp' ? 'image/webp' :
          'application/octet-stream'
        );
        const isImage = mediaType.startsWith('image/');
        const isPdf = mediaType === 'application/pdf';
        if (!isImage && !isPdf) {
          strategies.push('gpt_vision_unsupported_mime:' + mediaType);
        } else {
          const block = isImage
            ? { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } }
            : { type: 'document', source: { type: 'base64', media_type: mediaType, data: b64 } };
          const result = await aiProvider.complete({
            system: 'Ты OCR-движок. Извлекай весь текст из приложенного документа дословно и структурированно.',
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: `Извлеки ВЕСЬ текст из этого документа "${originalName || ''}". Если это таблица — сохрани структуру. Если ничего не читается — верни "(не удалось прочитать)".` },
                block
              ]
            }],
            maxTokens: 8000
          });
          const text = (result && result.text) ? result.text : '';
          if (text && text.length >= MIN_TEXT_CHARS && !text.includes('(не удалось')) {
            strategies.push('gpt_vision_fallback_ok');
            return _ret(text, 'gpt_vision_fallback');
          }
          strategies.push('gpt_vision_empty:' + (text ? text.length : 0));
        }
      }
    }
  } catch (e) { strategies.push('gpt_vision_failed:' + _shortErr(e)); }

  // Все стратегии не сработали
  return { text: '', strategy: 'all_failed', chars: 0, strategies_tried: strategies };
}

async function run({ input, onThought, runId }) {
  let docIds = Array.isArray(input.documents) ? input.documents.filter((x) => Number.isInteger(Number(x))) : [];

  // Если документы явно не переданы — автоподтяг из работы/тендера прогона.
  if (docIds.length === 0 && runId) {
    onThought('document_ids не переданы — автоподтяг файлов работы/тендера');
    try {
      const r = await db.query(
        `SELECT id, tender_id, work_id, estimate_id FROM mimir_conductor_runs WHERE id = $1`,
        [runId]
      );
      const run = r.rows[0];
      if (run) {
        const conds = [];
        const params = [];
        let idx = 1;
        if (run.work_id) { conds.push(`work_id = $${idx++}`); params.push(run.work_id); }
        if (run.tender_id) { conds.push(`tender_id = $${idx++}`); params.push(run.tender_id); }
        if (conds.length) {
          const sql = `SELECT id, original_name, type
                         FROM documents
                        WHERE (${conds.join(' OR ')})
                          AND lower(COALESCE(type,'')) NOT IN ('logistics','паспорт','полис до мсу','полис','счёт','счет','билеты','билет','медполис')
                        ORDER BY id`;
          const docsR = await db.query(sql, params);
          if (docsR.rows.length) {
            docIds = docsR.rows.map(r => r.id);
            onThought(`Найдено ${docIds.length} документ(ов) проекта: ${docsR.rows.slice(0,5).map(r => r.original_name).join(', ')}${docIds.length>5?'…':''}`);
          }
        }
      }
    } catch (e) {
      onThought(`Не удалось автоподтянуть документы: ${e.message}`);
    }
  }

  if (docIds.length === 0) {
    onThought('Документов к работе/тендеру не привязано — парсить нечего.');
    return {
      summary: 'Документы не приложены — анализ по стартовому контексту работы.',
      key_findings: ['Нет документов для парсинга'],
      documents: []
    };
  }

  onThought(`Получил ${docIds.length} документ(ов) на парсинг`);

  const docsRes = await db.query(
    `SELECT id, original_name, filename, file_url, mime_type, size
       FROM documents
      WHERE id = ANY($1) AND deleted_at IS NULL`,
    [docIds]
  ).catch(async () => {
    return db.query(
      'SELECT id, original_name, filename, file_url, mime_type, size FROM documents WHERE id = ANY($1)',
      [docIds]
    );
  });

  const parsed = [];
  for (const doc of docsRes.rows) {
    const name = doc.original_name || doc.filename;
    onThought(`Парсю ${name}…`);
    // 20.06.2026 фикс: filename — только имя без папки, а реальный путь
    // лежит в file_url (например /uploads/mail/2026-06-17/UUID/file.docx).
    // Раньше парсер тыкался только в uploads/{filename} → strategy=no_file → пусто.
    const absPath = _resolveUploadPath(doc.file_url || doc.filename);
    let content = '';
    let strategy = 'no_file';
    let strategiesTried = ['no_file'];

    if (!absPath) {
      onThought(`  ⚠ файл не найден на диске: ${doc.filename}`);
    } else {
      try {
        const res = await parseDocumentSafe(absPath, doc.mime_type, name);
        content = res.text || '';
        strategy = res.strategy;
        strategiesTried = res.strategies_tried || [];
        onThought(`  Документ ${name}: strategy=${strategy}, chars=${res.chars}, tried=[${strategiesTried.join(' → ')}]`);
      } catch (e) {
        onThought(`  ⚠ parseDocumentSafe упал: ${e.message}`);
        strategy = 'parse_exception';
        strategiesTried = ['parse_exception:' + _shortErr(e)];
      }
    }

    parsed.push({
      id: doc.id,
      name,
      mime_type: doc.mime_type || null,
      size_kb: doc.size ? Math.round(Number(doc.size) / 1024) : null,
      content: content || null,
      content_chars: content ? content.length : 0,
      content_hash: content ? sha256(content) : null,
      extraction_strategy: strategy,
      extraction_strategies_tried: strategiesTried
    });
  }

  const totalChars = parsed.reduce((s, d) => s + d.content_chars, 0);
  const lowYield = parsed.filter((p) => p.content_chars < MIN_TEXT_CHARS);
  const keyFindings = parsed.map((p) => `${p.name}: ${p.content_chars} симв (${p.extraction_strategy})`);
  if (lowYield.length) {
    keyFindings.push(`⚠ ${lowYield.length} документ(ов) не удалось вытащить даже fallback-стратегиями — возможно, скан низкого качества`);
  }
  return {
    summary: `Распарсено ${parsed.length} документ(ов), всего ${totalChars} символов`,
    key_findings: keyFindings,
    documents: parsed
  };
}

module.exports = { run, parseDocumentSafe };
