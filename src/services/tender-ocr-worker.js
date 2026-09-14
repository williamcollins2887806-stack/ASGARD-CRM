'use strict';

/**
 * ASGARD CRM — Tender OCR Worker
 *
 * Фоновая очередь: распаковка архивов тендера → извлечение текста → documents.ocr_text.
 *
 * Правила:
 *  - один тендер за раз;
 *  - до 3 попыток на тендер, потом failed и следующий;
 *  - приоритет: ТЗ / ведомости / объёмы — первыми, но в итоге все файлы;
 *  - понятные логи [TenderOCR].
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const archiveExtractor = require('./archiveExtractor');
const pdfOcr = require('./pdf-ocr');
const tkpParser = require('./tkp-parser');

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || process.env.UPLOADS_DIR || './uploads');
const POLL_MS = Math.max(3000, parseInt(process.env.TENDER_OCR_POLL_MS || '8000', 10));
const MAX_ATTEMPTS = 3;
/** OCR только для тендеров, созданных строго после этой даты (с 28.07.2026). */
const OCR_TENDER_MIN_DATE = process.env.TENDER_OCR_MIN_DATE || '2026-07-27';

const TEXT_EXTS = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt', '.csv', '.rtf',
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff'
]);

function log(msg, extra) {
  if (extra !== undefined) console.log(`[TenderOCR] ${msg}`, extra);
  else console.log(`[TenderOCR] ${msg}`);
}
function warn(msg, extra) {
  if (extra !== undefined) console.warn(`[TenderOCR] ${msg}`, extra);
  else console.warn(`[TenderOCR] ${msg}`);
}
function errLog(msg, extra) {
  if (extra !== undefined) console.error(`[TenderOCR] ${msg}`, extra);
  else console.error(`[TenderOCR] ${msg}`);
}

function filePriority(name) {
  const n = String(name || '').toLowerCase();
  if (/техническ|тех\.?\s*зада|\bтз\b|задан/.test(n)) return 0;
  if (/ведомост/.test(n)) return 1;
  if (/объем|объём|ам-\d|трубк|специф/.test(n)) return 2;
  if (/\.docx?$/.test(n)) return 3;
  if (/\.pdf$/.test(n)) return 4;
  if (/\.xlsx?$/.test(n)) return 5;
  return 6;
}

function guessMime(filename) {
  const lower = String(filename || '').toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.endsWith('.doc')) return 'application/msword';
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  if (lower.endsWith('.tif') || lower.endsWith('.tiff')) return 'image/tiff';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.zip')) return 'application/zip';
  if (lower.endsWith('.rar')) return 'application/vnd.rar';
  if (lower.endsWith('.7z')) return 'application/x-7z-compressed';
  return 'application/octet-stream';
}

function isArchiveDoc(doc) {
  if (String(doc.type || '') === 'archive') return true;
  return archiveExtractor.isArchive(doc.original_name || doc.filename || '', doc.mime_type);
}

function safeFsName(name) {
  return String(name || 'file').replace(/[^\w.\-а-яА-ЯёЁ]+/g, '_').slice(0, 120);
}

/** Basename без _unpacked/_nest_; кракозябры (U+FFFD) — заменить на нейтральное имя. */
function sanitizeDisplayName(name) {
  let n = String(name || '').replace(/\\/g, '/');
  n = n.split('/').filter(Boolean).pop() || n;
  n = n.replace(/_unpacked/gi, '').replace(/_nest_[0-9a-f]+/gi, '');
  if (/\uFFFD/.test(n)) {
    const ext = path.extname(n);
    n = `extracted_${crypto.randomBytes(3).toString('hex')}${ext || ''}`;
  }
  return n.trim() || null;
}

class TenderOcrWorker {
  /**
   * @param {object} db — pg pool wrapper { query }
   * @param {object} [logger]
   */
  constructor(db, logger) {
    this.db = db;
    this.logger = logger || console;
    this._running = false;
    this._busy = false;
    this._timer = null;
  }

  start() {
    if (this._running) return;
    this._running = true;
    log(`worker started (poll=${POLL_MS}ms, max_attempts=${MAX_ATTEMPTS})`);
    this._timer = setInterval(() => this._tick(), POLL_MS);
    setImmediate(() => this._tick());
    // Подхватить тендеры с неготовым OCR (бэкап без хука)
    setTimeout(() => this.enqueuePendingTenders().catch((e) => warn(`backfill: ${e.message}`)), 15000);
  }

  stop() {
    this._running = false;
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    log('worker stopped');
  }

  /**
   * Поставить тендер в очередь (идемпотентно).
   * Старые тендеры (created_at < OCR_TENDER_MIN_DATE) игнорируются.
   */
  async enqueue(tenderId, reason = 'manual') {
    const tid = parseInt(tenderId, 10);
    if (!tid) return null;

    const { rows: trows } = await this.db.query(
      `SELECT id, created_at::date AS created_day
       FROM tenders WHERE id = $1`,
      [tid]
    );
    if (!trows.length) {
      warn(`enqueue skip tender=#${tid}: tender not found`);
      return null;
    }
    const createdDay = String(trows[0].created_day);
    if (createdDay <= OCR_TENDER_MIN_DATE) {
      log(`enqueue skip tender=#${tid}: created ${createdDay} <= ${OCR_TENDER_MIN_DATE} (${reason})`);
      return null;
    }

    const { rows } = await this.db.query(
      `INSERT INTO tender_ocr_jobs (tender_id, status, attempts, max_attempts, scheduled_at, updated_at)
       VALUES ($1, 'pending', 0, $2, NOW(), NOW())
       ON CONFLICT (tender_id) DO UPDATE SET
         status = CASE
           WHEN tender_ocr_jobs.status = 'processing' THEN 'processing'
           ELSE 'pending'
         END,
         requeue_after = CASE
           WHEN tender_ocr_jobs.status = 'processing' THEN TRUE
           ELSE FALSE
         END,
         attempts = CASE
           WHEN tender_ocr_jobs.status IN ('done', 'failed') THEN 0
           ELSE tender_ocr_jobs.attempts
         END,
         scheduled_at = CASE
           WHEN tender_ocr_jobs.status = 'processing' THEN tender_ocr_jobs.scheduled_at
           ELSE NOW()
         END,
         last_error = CASE
           WHEN tender_ocr_jobs.status IN ('done', 'failed') THEN NULL
           ELSE tender_ocr_jobs.last_error
         END,
         updated_at = NOW()
       RETURNING id, status, attempts`,
      [tid, MAX_ATTEMPTS]
    );
    const job = rows[0];
    log(`enqueue tender=#${tid} job=#${job.id} status=${job.status} reason=${reason}`);
    return job;
  }

  /** Тендеры после OCR_TENDER_MIN_DATE с неготовым OCR. */
  async enqueuePendingTenders() {
    const { rows } = await this.db.query(
      `SELECT DISTINCT d.tender_id
       FROM documents d
       JOIN tenders t ON t.id = d.tender_id
       WHERE d.tender_id IS NOT NULL
         AND t.created_at::date > $1::date
         AND (
           d.ocr_status IS NULL
           OR d.ocr_status IN ('failed', 'pending')
           OR (
             (d.type = 'archive' OR d.original_name ~* '\\.(rar|zip|7z)$')
             AND NOT EXISTS (
               SELECT 1 FROM documents c WHERE c.parent_document_id = d.id
             )
           )
         )
       ORDER BY d.tender_id DESC
       LIMIT 30`,
      [OCR_TENDER_MIN_DATE]
    );
    for (const r of rows) {
      await this.enqueue(r.tender_id, 'backfill');
    }
    if (rows.length) log(`backfill enqueued ${rows.length} tenders (after ${OCR_TENDER_MIN_DATE})`);
  }

  async _tick() {
    if (!this._running || this._busy) return;
    this._busy = true;
    try {
      await this._processNext();
    } catch (e) {
      errLog(`tick error: ${e.message}`);
    } finally {
      this._busy = false;
    }
  }

  async _processNext() {
    // Зависшие processing (рестарт/краш) — вернуть в очередь
    await this.db.query(
      `UPDATE tender_ocr_jobs
       SET status = 'retry',
           last_error = COALESCE(last_error,'') || ' | reclaimed: stuck processing',
           scheduled_at = NOW(),
           updated_at = NOW()
       WHERE status = 'processing'
         AND started_at < NOW() - INTERVAL '25 minutes'`
    );

    const { rows } = await this.db.query(
      `UPDATE tender_ocr_jobs
       SET status = 'processing', started_at = NOW(), attempts = attempts + 1, updated_at = NOW()
       WHERE id = (
         SELECT id FROM tender_ocr_jobs
         WHERE status IN ('pending', 'retry')
           AND scheduled_at <= NOW()
           AND attempts < max_attempts
         ORDER BY scheduled_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING *`
    );
    if (!rows.length) return;

    const job = rows[0];
    const tid = job.tender_id;
    const attempt = job.attempts;
    log(`START tender=#${tid} job=#${job.id} attempt=${attempt}/${job.max_attempts}`);

    try {
      const stats = await this._processTender(tid);
      const { rows: again } = await this.db.query(
        `SELECT requeue_after FROM tender_ocr_jobs WHERE id = $1`,
        [job.id]
      );
      const requeue = again[0]?.requeue_after;
      if (requeue) {
        await this.db.query(
          `UPDATE tender_ocr_jobs SET
             status = 'pending', requeue_after = FALSE, attempts = 0,
             stats = $1::jsonb, last_error = NULL, scheduled_at = NOW(), updated_at = NOW()
           WHERE id = $2`,
          [JSON.stringify(stats), job.id]
        );
        log(`DONE tender=#${tid} → requeue (новые файлы). ${JSON.stringify(stats)}`);
      } else {
        await this.db.query(
          `UPDATE tender_ocr_jobs SET
             status = 'done', stats = $1::jsonb, last_error = NULL,
             completed_at = NOW(), updated_at = NOW(), requeue_after = FALSE
           WHERE id = $2`,
          [JSON.stringify(stats), job.id]
        );
        log(`DONE tender=#${tid} ${JSON.stringify(stats)}`);
      }
    } catch (e) {
      const msg = String(e.message || e).slice(0, 1500);
      const shouldRetry = attempt < job.max_attempts;
      const status = shouldRetry ? 'retry' : 'failed';
      const delaySec = Math.pow(2, attempt) * 15; // 30, 60, 120…
      await this.db.query(
        `UPDATE tender_ocr_jobs SET
           status = $1,
           last_error = $2,
           scheduled_at = CASE WHEN $1 = 'retry' THEN NOW() + ($3 || ' seconds')::interval ELSE scheduled_at END,
           completed_at = CASE WHEN $1 = 'failed' THEN NOW() ELSE completed_at END,
           updated_at = NOW()
         WHERE id = $4`,
        [status, msg, String(delaySec), job.id]
      );
      errLog(
        `${status.toUpperCase()} tender=#${tid} attempt=${attempt}/${job.max_attempts}: ${msg}` +
        (shouldRetry ? ` (retry in ${delaySec}s)` : ' — пропускаем, следующий тендер')
      );
    }
  }

  async _processTender(tenderId) {
    const stats = {
      unpacked_archives: 0,
      children_added: 0,
      ocr_pdf: 0,
      text_ok: 0,
      skipped: 0,
      failed: 0,
      cached: 0
    };

    // 1) Распаковать архивы без детей
    const archives = await this._listUnpackTargets(tenderId);
    for (const arch of archives) {
      try {
        const n = await this._unpackArchiveDoc(arch, tenderId);
        stats.unpacked_archives += 1;
        stats.children_added += n;
        log(`tender=#${tenderId} unpacked «${arch.original_name}» → ${n} files`);
      } catch (e) {
        stats.failed += 1;
        warn(`tender=#${tenderId} unpack «${arch.original_name}»: ${e.message}`);
        await this.db.query(
          `UPDATE documents SET ocr_status = 'failed', ocr_error = $1, ocr_completed_at = NOW()
           WHERE id = $2`,
          [`unpack: ${String(e.message).slice(0, 500)}`, arch.id]
        );
      }
    }

    // 2) Все документы тендера, которым нужен текст
    const { rows: docs } = await this.db.query(
      `SELECT id, filename, original_name, mime_type, type, download_url, size, ocr_status, ocr_text
       FROM documents WHERE tender_id = $1 ORDER BY id`,
      [tenderId]
    );

    const need = [];
    for (const d of docs) {
      if (isArchiveDoc(d) && String(d.type) === 'archive') {
        // архив после unpack — skipped
        if (d.ocr_status !== 'done' && d.ocr_status !== 'skipped') {
          await this.db.query(
            `UPDATE documents SET ocr_status = 'skipped', ocr_completed_at = NOW(),
               ocr_error = 'archive — текст в дочерних файлах' WHERE id = $1`,
            [d.id]
          );
          stats.skipped += 1;
        }
        continue;
      }
      const ext = path.extname(d.original_name || d.filename || '').toLowerCase();
      if (!TEXT_EXTS.has(ext) && !/pdf|word|sheet|image|text/i.test(d.mime_type || '')) {
        if (d.ocr_status !== 'skipped') {
          await this.db.query(
            `UPDATE documents SET ocr_status = 'skipped', ocr_completed_at = NOW() WHERE id = $1`,
            [d.id]
          );
          stats.skipped += 1;
        }
        continue;
      }
      if (d.ocr_status === 'done' && d.ocr_text && String(d.ocr_text).trim().length > 20) {
        stats.cached += 1;
        continue;
      }
      need.push(d);
    }

    need.sort((a, b) =>
      filePriority(a.original_name) - filePriority(b.original_name) || a.id - b.id
    );

    log(`tender=#${tenderId} to process: ${need.length} files (priority: TZ→ведомости→объёмы→остальное)`);

    // 3) PDF — кросс-файловый батч; остальное по одному
    const pdfs = need.filter((d) =>
      /pdf/i.test(d.mime_type || '') || /\.pdf$/i.test(d.original_name || '')
    );
    const others = need.filter((d) => !pdfs.includes(d));

    if (pdfs.length) {
      const ocrItems = [];
      for (const d of pdfs) {
        const abs = pdfOcr.resolveDocumentPath(d);
        if (!abs) {
          stats.failed += 1;
          await this._markFailed(d.id, 'файл не найден на диске');
          warn(`tender=#${tenderId} pdf #${d.id} «${d.original_name}»: файл не найден`);
          continue;
        }
        // Быстрый текстовый слой
        try {
          const buf = fs.readFileSync(abs);
          const pdfParse = require('pdf-parse');
          const data = await pdfParse(buf);
          const text = String(data.text || '').trim();
          if (text.length >= 200) {
            await this._saveText(d.id, text, 0, 'pdf-parse');
            stats.text_ok += 1;
            log(`tender=#${tenderId} pdf #${d.id} «${d.original_name}»: text-layer ${text.length} chars`);
            continue;
          }
        } catch (_) { /* OCR */ }
        ocrItems.push({ path: abs, originalName: d.original_name, key: String(d.id), docId: d.id });
      }

        if (ocrItems.length) {
        log(`tender=#${tenderId} vision OCR: ${ocrItems.length} scan PDFs`);
        let balanceError = null;
        const res = await pdfOcr.ocrManyPdfPaths(ocrItems, {
          dpi: 90,
          batchSize: 8,
          concurrency: Math.max(8, parseInt(process.env.OCR_CONCURRENCY || '16', 10)),
          maxPages: 80
        });
        for (const item of ocrItems) {
          const text = String(res.byKey[item.key] || '').trim();
          if (text.length < 20) {
            stats.failed += 1;
            await this._markFailed(item.docId, `OCR пустой (${text.length} симв.)`);
            warn(`tender=#${tenderId} pdf #${item.docId} «${item.originalName}»: OCR пустой`);
            continue;
          }
          await this._saveText(item.docId, text, null, pdfOcr.OCR_MODEL);
          stats.ocr_pdf += 1;
          log(`tender=#${tenderId} pdf #${item.docId} «${item.originalName}»: OCR ${text.length} chars`);
        }
        if (res.diagnostics?.ms) {
          log(`tender=#${tenderId} OCR batch ${Math.round(res.diagnostics.ms / 1000)}s, pages=${res.diagnostics.pages}, batches=${res.diagnostics.batches}`);
        }
        // Если все сканы пустые — скорее всего баланс/API; не помечаем тендер done
        if (ocrItems.length > 0 && stats.ocr_pdf === 0) {
          balanceError = 'Vision OCR вернул пусто по всем сканам (проверь баланс RouterAI / OCR_MODEL)';
          throw new Error(balanceError);
        }
      }
    }

    for (const d of others) {
      try {
        const ok = await this._extractNonPdf(d);
        if (ok) {
          stats.text_ok += 1;
          log(`tender=#${tenderId} file #${d.id} «${d.original_name}»: ${ok} chars`);
        } else {
          stats.failed += 1;
        }
      } catch (e) {
        stats.failed += 1;
        await this._markFailed(d.id, e.message);
        warn(`tender=#${tenderId} file #${d.id} «${d.original_name}»: ${e.message}`);
      }
    }

    // Жёсткий провал всей джобы — только если вообще ничего не вытащили при наличии need
    if (need.length > 0 && stats.ocr_pdf + stats.text_ok + stats.cached === 0 && stats.failed > 0) {
      throw new Error(
        `Ни один файл не распознан (failed=${stats.failed}, unpacked=${stats.unpacked_archives}). ` +
        `Проверь пути uploads и OCR API.`
      );
    }

    return stats;
  }

  async _listUnpackTargets(tenderId) {
    const { rows } = await this.db.query(
      `SELECT d.*
       FROM documents d
       WHERE d.tender_id = $1
         AND (
           d.type = 'archive'
           OR d.original_name ~* '\\.(rar|zip|7z|tar|tgz)$'
           OR d.mime_type ILIKE '%zip%'
           OR d.mime_type ILIKE '%rar%'
           OR d.mime_type ILIKE '%7z%'
         )
         AND NOT EXISTS (
           SELECT 1 FROM documents c WHERE c.parent_document_id = d.id
         )
       ORDER BY d.id`,
      [tenderId]
    );
    return rows.filter((d) => isArchiveDoc(d));
  }

  async _unpackArchiveDoc(arch, tenderId) {
    const abs = pdfOcr.resolveDocumentPath(arch);
    if (!abs) throw new Error(`архив не найден на диске (#${arch.id})`);

    const stamp = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const tmpDir = path.join(os.tmpdir(), `tender-ocr-${tenderId}-${stamp}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
      const extracted = await archiveExtractor.extractArchive(
        abs,
        arch.original_name || arch.filename,
        tmpDir,
        { recursive: true, maxFiles: 500 }
      );
      if (!extracted.ok) {
        const e = extracted.error || {};
        throw new Error(`${e.code || 'EXTRACT'}: ${e.message || 'не удалось распаковать'}${e.hint ? ' — ' + e.hint : ''}`);
      }

      const tenderDir = path.join(UPLOAD_DIR, 'tender_archives', String(tenderId));
      fs.mkdirSync(tenderDir, { recursive: true });

      let added = 0;
      const files = (extracted.files || []).filter((f) => !f.isJunk);
      files.sort((a, b) => filePriority(a.relPath) - filePriority(b.relPath));

      for (const f of files) {
        // Вложенные архивы уже раскрыты recursive — пропускаем оставшиеся оболочки
        if (f.type === 'archive') continue;
        const originalName = path.basename(f.relPath);
        // Для UI/OCR — короткое читаемое имя; полный путь только в лог
        const displayName = sanitizeDisplayName(originalName) || originalName;
        const safeName = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}_${safeFsName(displayName)}`;
        const targetPath = path.join(tenderDir, safeName);
        try {
          fs.copyFileSync(f.absPath, targetPath);
        } catch (e) {
          warn(`copy ${originalName}: ${e.message}`);
          continue;
        }
        const size = fs.statSync(targetPath).size;
        const mime = guessMime(displayName);
        const downloadUrl = `/uploads/tender_archives/${tenderId}/${safeName}`;
        // Не дублировать одинаковый basename+size от того же parent
        const { rows: dup } = await this.db.query(
          `SELECT id FROM documents
           WHERE tender_id = $1 AND parent_document_id = $2
             AND original_name = $3 AND size = $4 LIMIT 1`,
          [tenderId, arch.id, displayName, size]
        );
        if (dup.length) {
          try { fs.unlinkSync(targetPath); } catch (_) {}
          continue;
        }
        await this.db.query(
          `INSERT INTO documents
             (filename, original_name, mime_type, size, type, tender_id, uploaded_by,
              download_url, parent_document_id, ocr_status, created_at)
           VALUES ($1,$2,$3,$4,'ocr-extract',$5,$6,$7,$8,'pending',NOW())`,
          [
            safeName,
            displayName,
            mime,
            size,
            tenderId,
            arch.uploaded_by || null,
            downloadUrl,
            arch.id
          ]
        );
        added += 1;
      }

      await this.db.query(
        `UPDATE documents SET ocr_status = 'skipped', ocr_completed_at = NOW(),
           ocr_error = $1 WHERE id = $2`,
        [`unpacked → ${added} children`, arch.id]
      );
      return added;
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
  }

  async _extractNonPdf(doc) {
    const abs = pdfOcr.resolveDocumentPath(doc);
    if (!abs) {
      await this._markFailed(doc.id, 'файл не найден на диске');
      return 0;
    }
    const buf = fs.readFileSync(abs);
    const ext = path.extname(doc.original_name || '').toLowerCase();

    if (ext === '.doc') {
      const kind = this._docMagicKind(buf);
      const text = await this._docViaLibreOffice(buf);
      if (!text || text.length < 20) {
        await this._markFailed(doc.id, 'doc: пустой текст после извлечения');
        return 0;
      }
      const model = kind === 'html' ? 'html-doc-strip' : 'libreoffice+mammoth/txt';
      await this._saveText(doc.id, text, 0, model);
      return text.length;
    }

    if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff'].includes(ext)) {
      // mime из БД часто application/octet-stream для TIFF из архива — берём по расширению
      const mimeFromName = guessMime(doc.original_name);
      const mime = mimeFromName.startsWith('image/')
        ? mimeFromName
        : (doc.mime_type || mimeFromName);
      const text = await pdfOcr.ocrImageBuffer(buf, mime, doc.original_name);
      const t = String(text || '').trim();
      if (t.length < 15) {
        await this._markFailed(doc.id, `image OCR пустой (${t.length})`);
        return 0;
      }
      await this._saveText(doc.id, t, 1, pdfOcr.OCR_MODEL);
      return t.length;
    }

    const r = await tkpParser.extractTextOnly({
      buf,
      originalName: doc.original_name,
      allowOcr: false
    });
    const t = String(r.text || '').trim();
    if (t.length < 20) {
      await this._markFailed(doc.id, r.error || `мало текста (${t.length})`);
      return 0;
    }
    await this._saveText(doc.id, t, 0, 'text-extract');
    return t.length;
  }

  /**
   * .doc с ЭТП часто = HTML Word («Save as HTML» + расширение .doc).
   * LibreOffice не умеет html→docx («no export filter»), но текст можно снять напрямую.
   */
  _stripHtmlToText(html) {
    return String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/(p|div|tr|h[1-6]|li|br|table)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#(\d+);/g, (_, n) => {
        const c = parseInt(n, 10);
        return Number.isFinite(c) && c > 0 ? String.fromCharCode(c) : ' ';
      })
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  _docMagicKind(buf) {
    const head = buf.slice(0, 512).toString('utf8').replace(/^\uFEFF/, '').trimStart();
    const low = head.slice(0, 200).toLowerCase();
    if (low.startsWith('<html') || low.startsWith('<!doctype html') || low.includes('xmlns:w="urn:schemas-microsoft-com:office:word"')) {
      return 'html';
    }
    if (low.startsWith('{\\rtf')) return 'rtf';
    // OLE Compound File (настоящий .doc)
    if (buf.length >= 4 && buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) {
      return 'ole';
    }
    return 'unknown';
  }

  async _docViaLibreOffice(buf) {
    const kind = this._docMagicKind(buf);
    if (kind === 'html') {
      const text = this._stripHtmlToText(buf.toString('utf8'));
      if (text.length >= 20) return text;
      throw new Error('html-.doc: мало текста после strip');
    }

    const stamp = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const tmpDir = path.join(os.tmpdir(), `tender-doc-${stamp}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const src = path.join(tmpDir, 'src.doc');
    try {
      fs.writeFileSync(src, buf);
      const bin = ['libreoffice', 'soffice', '/usr/bin/libreoffice', '/usr/bin/soffice']
        .find((b) => {
          try {
            return spawnSync(b, ['--version'], { timeout: 5000 }).status === 0;
          } catch (_) { return false; }
        });
      if (!bin) throw new Error('libreoffice не установлен');

      const runConvert = (format, profileName) => {
        const profile = path.join(tmpDir, profileName);
        fs.mkdirSync(profile, { recursive: true });
        // Уникальный UserInstallation — иначе параллельные soffice ломают конвертацию
        const args = [
          '--headless', '--norestore', '--nolockcheck',
          `-env:UserInstallation=file://${profile.replace(/\\/g, '/')}`,
          '--convert-to', format,
          '--outdir', tmpDir,
          src,
        ];
        return spawnSync(bin, args, { timeout: 90000, encoding: 'utf8' });
      };

      // 1) docx → mammoth (для настоящего OLE .doc)
      const rDocx = runConvert('docx', 'prof-docx');
      const docx = fs.readdirSync(tmpDir).find((f) => f.toLowerCase().endsWith('.docx'));
      if (docx) {
        const mammoth = require('mammoth');
        const m = await mammoth.extractRawText({ buffer: fs.readFileSync(path.join(tmpDir, docx)) });
        const t = String(m.value || '').trim();
        if (t.length >= 20) return t;
      }

      // 2) fallback txt:Text — работает и для html/rtf-.doc, и когда docx-фильтр недоступен
      const rTxt = runConvert('txt:Text', 'prof-txt');
      const txtFile = fs.readdirSync(tmpDir).find((f) => f.toLowerCase().endsWith('.txt'));
      if (txtFile) {
        const t = String(fs.readFileSync(path.join(tmpDir, txtFile), 'utf8') || '')
          .replace(/^\uFEFF/, '')
          .trim();
        if (t.length >= 20) return t;
      }

      const detail = [
        rDocx.status !== 0 ? `docx exit ${rDocx.status}` : (docx ? 'docx пустой' : 'docx не создан'),
        rTxt.status !== 0 ? `txt exit ${rTxt.status}` : (txtFile ? 'txt пустой' : 'txt не создан'),
        kind,
      ].join('; ');
      throw new Error(`libreoffice не извлёк текст (${detail})`);
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
  }

  async _saveText(docId, text, pages, model) {
    await this.db.query(
      `UPDATE documents SET
         ocr_status = 'done',
         ocr_text = $1,
         ocr_pages_count = $2,
         ocr_model = $3,
         ocr_completed_at = NOW(),
         ocr_error = NULL
       WHERE id = $4`,
      [String(text).slice(0, 500000), pages, model || null, docId]
    );
  }

  async _markFailed(docId, message) {
    await this.db.query(
      `UPDATE documents SET ocr_status = 'failed', ocr_error = $1, ocr_completed_at = NOW() WHERE id = $2`,
      [String(message).slice(0, 1000), docId]
    );
  }
}

module.exports = TenderOcrWorker;
