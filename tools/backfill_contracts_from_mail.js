'use strict';

/**
 * tools/backfill_contracts_from_mail.js
 *
 * V475: разобрать старые вложения писем с «договор» в имени и
 * (опционально) дотянуть ОБС-привязки у писем/счетов.
 *
 * ЧТО ДЕЛАЕТ.
 *   1. Находит `email_attachments`, у которых в имени есть «договор».
 *   2. Для каждого: читает текст (pdftotext → при пустом слое tesseract)
 *      и зовёт `ensureContractFromDocument` в dry-run (по умолчанию).
 *   3. Пишет отчёт: что создастся / прикрепится / пропустится и почему.
 *   4. Дополнительно: 9 ОБС-писем без `obs_account_id` — предлагает
 *      проставить `obs_account_id` / `subcontract_id`, где однозначно.
 *
 * ЗАПУСК:
 *   node tools/backfill_contracts_from_mail.js              # dry-run
 *   node tools/backfill_contracts_from_mail.js --apply       # запись
 *   node tools/backfill_contracts_from_mail.js --limit 20
 *   node tools/backfill_contracts_from_mail.js --id 123,456
 *   node tools/backfill_contracts_from_mail.js --skip-ocr    # только текст. слой
 *   node tools/backfill_contracts_from_mail.js --obs-only    # только ОБС-письма
 *
 * Требует DB_* как у приложения. Файлы ищет относительно UPLOAD_DIR /
 * cwd (пути в БД часто вида `uploads/mail/...`).
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const db = require('../src/services/db');
const { ensureContractFromDocument } = require('../src/services/contract-from-document');
const { matchObsContract } = require('../src/services/obs-contract-match');
const { ownInn } = require('../src/services/doc-classifier');

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const SKIP_OCR = argv.includes('--skip-ocr');
const OBS_ONLY = argv.includes('--obs-only');

function argVal(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}
const LIMIT = Number(argVal('--limit')) || 0;
const ONLY_IDS = (argVal('--id') || '')
  .split(',').map((s) => parseInt(s.trim(), 10)).filter(Boolean);

const UPLOAD_ROOT = path.resolve(
  process.cwd(),
  process.env.UPLOAD_DIR || process.env.UPLOADS_DIR || 'uploads'
);

function log(...a) { console.log(...a); }

/** Абсолютный путь к вложению: file_path из БД может начинаться с uploads/. */
function resolveAttachPath(filePath) {
  if (!filePath) return null;
  let p = String(filePath).replace(/\\/g, '/');
  if (path.isAbsolute(p) && fs.existsSync(p)) return p;
  // uploads/mail/... → <cwd>/uploads/mail/...
  const candidates = [
    path.resolve(process.cwd(), p),
    path.resolve(UPLOAD_ROOT, p.replace(/^uploads[/\\]/, '')),
    path.resolve(process.cwd(), 'uploads', p.replace(/^uploads[/\\]/, '')),
    path.resolve(UPLOAD_ROOT, path.basename(p)),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/** Текст документа: текстовый слой PDF, при пустоте — tesseract (если не --skip-ocr). */
function readDocText(absPath) {
  if (!absPath || !fs.existsSync(absPath)) return { text: '', src: 'no_file' };
  const ext = path.extname(absPath).toLowerCase();

  if (ext === '.txt' || ext === '.csv') {
    try {
      return { text: fs.readFileSync(absPath, 'utf8'), src: 'plain' };
    } catch (_) {
      return { text: '', src: 'read_fail' };
    }
  }

  if (ext === '.docx') {
    // mammoth — async; для sync-контура берём word/document.xml из zip.
    const tmp = path.join(
      process.env.TEMP || process.env.TMP || '/tmp',
      'bfc_docx_' + process.pid + '_' + Date.now()
    );
    try {
      fs.mkdirSync(tmp, { recursive: true });
      execFileSync('unzip', ['-o', '-q', absPath, 'word/document.xml', '-d', tmp], {
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      const xml = fs.readFileSync(path.join(tmp, 'word', 'document.xml'), 'utf8');
      const text = xml
        .replace(/<w:tab\/>/g, '\t')
        .replace(/<\/w:p>/g, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* */ }
      if (text.trim().length >= 40) return { text, src: 'docx_xml' };
      return { text: '', src: 'docx_empty' };
    } catch (_) {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (__) { /* */ }
      return { text: '', src: 'docx_fail' };
    }
  }

  let text = '';
  if (ext === '.pdf' || !ext) {
    try {
      text = execFileSync('pdftotext', ['-layout', absPath, '-'], {
        encoding: 'utf8', maxBuffer: 20 * 1024 * 1024,
      });
    } catch (_) { text = ''; }
  }
  if (text.trim().length >= 120) return { text, src: 'text_layer' };
  if (SKIP_OCR) return { text, src: text.trim() ? 'text_layer' : 'skip_ocr' };

  // OCR только для PDF/изображений — иначе нет смысла (docx/xls и т.п.).
  if (!/\.(pdf|png|jpe?g|tif{1,2}|webp)$/i.test(absPath)) {
    return { text, src: text.trim() ? 'text_layer' : 'no_ocr_for_type' };
  }

  const prefix = path.join(
    process.env.TEMP || process.env.TMP || '/tmp',
    'bfc_' + process.pid + '_' + Date.now()
  );
  try {
    if (/\.pdf$/i.test(absPath)) {
      execFileSync('pdftoppm', ['-png', '-r', '150', '-f', '1', '-l', '3', absPath, prefix], {
        stdio: ['ignore', 'ignore', 'ignore'],
      });
    } else {
      // одиночное изображение — копируем как «страницу»
      fs.copyFileSync(absPath, prefix + '-1.png');
    }
    const dir = path.dirname(prefix);
    const base = path.basename(prefix);
    const files = fs.readdirSync(dir).filter((f) => f.startsWith(base)).sort();
    const parts = [];
    for (const f of files) {
      try {
        parts.push(execFileSync(
          'tesseract',
          [path.join(dir, f), '-', '-l', 'rus+eng', '--psm', '6'],
          { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
        ));
      } catch (_) { /* страница не распозналась */ }
      try { fs.unlinkSync(path.join(dir, f)); } catch (_) { /* */ }
    }
    const ocr = parts.join('\n');
    if (ocr.trim().length > text.trim().length) return { text: ocr, src: 'tesseract' };
    return { text, src: text.trim() ? 'text_layer' : 'ocr_empty' };
  } catch (_) {
    return { text, src: text.trim() ? 'text_layer' : 'ocr_failed' };
  }
}

async function scanContractAttachments(ownInnStr) {
  const params = [];
  let where = `(
      lower(coalesce(a.original_filename, '')) LIKE '%договор%'
   OR lower(coalesce(a.filename, '')) LIKE '%договор%'
   OR lower(coalesce(a.original_filename, '')) LIKE '%contract%'
   OR lower(coalesce(a.filename, '')) LIKE '%contract%'
  )`;
  if (ONLY_IDS.length) {
    params.push(ONLY_IDS);
    where += ` AND a.id = ANY($${params.length}::int[])`;
  }
  let sql = `
    SELECT a.id, a.email_id, a.filename, a.original_filename, a.file_path,
           a.mime_type, a.size, e.subject, e.email_date
      FROM email_attachments a
      LEFT JOIN emails e ON e.id = a.email_id
     WHERE ${where}
     ORDER BY a.id`;
  if (LIMIT > 0) sql += ` LIMIT ${LIMIT}`;

  const { rows } = await db.query(sql, params);
  log(`вложений с «договор» в имени: ${rows.length}`);

  const summary = {
    created: 0, attached: 0, exists: 0, skipped: 0, failed: 0, no_file: 0, no_text: 0,
  };
  const byReason = {};
  const report = [];

  for (const a of rows) {
    const label = `#${a.id} «${a.original_filename || a.filename || '?'}»`
      + (a.email_id ? ` (письмо #${a.email_id})` : '');
    const abs = resolveAttachPath(a.file_path);
    if (!abs) {
      log(`  SKIP ${label}: файл не найден (${a.file_path || 'путь пуст'})`);
      summary.no_file++;
      summary.skipped++;
      byReason.no_file = (byReason.no_file || 0) + 1;
      report.push({ id: a.id, action: 'skipped', reason: 'no_file', file: a.file_path });
      continue;
    }

    const { text, src } = readDocText(abs);
    if (!text || text.trim().length < 40) {
      log(`  SKIP ${label}: мало текста (${src}, ${text ? text.trim().length : 0} симв.)`);
      summary.no_text++;
      summary.skipped++;
      byReason.no_text = (byReason.no_text || 0) + 1;
      report.push({ id: a.id, action: 'skipped', reason: 'no_text', src });
      continue;
    }

    const res = await ensureContractFromDocument(db, {
      text,
      filePath: a.file_path,
      fileName: a.original_filename || a.filename,
      ownInn: ownInnStr,
      emailId: a.email_id,
      attachmentId: a.id,
      dryRun: !APPLY,
      log: { info: () => {}, warn: (...x) => log('   !', ...x) },
    });

    const key = `${res.action}:${res.reason}`;
    byReason[key] = (byReason[key] || 0) + 1;
    if (res.action === 'created') summary.created++;
    else if (res.action === 'attached') summary.attached++;
    else if (res.action === 'exists') summary.exists++;
    else if (res.action === 'failed') summary.failed++;
    else summary.skipped++;

    const num = res.contract && (res.contract.number || res.contract.id) || '—';
    const date = res.contract && res.contract.date ? String(res.contract.date).slice(0, 10) : '';
    const inn = res.contract && (res.contract.inn || res.contract.customer_inn) || '';
    log(`  ${APPLY ? res.action.toUpperCase() : 'WOULD'} ${label}`
      + ` → ${res.action}/${res.reason}`
      + (num !== '—' ? ` «${num}»` : '')
      + (date ? ` от ${date}` : '')
      + (inn ? ` ИНН ${inn}` : '')
      + ` [${src}]`);

    report.push({
      id: a.id,
      email_id: a.email_id,
      filename: a.original_filename || a.filename,
      action: res.action,
      reason: res.reason,
      number: res.contract && res.contract.number || null,
      date: date || null,
      inn: inn || null,
      contract_id: res.contract && res.contract.id || null,
      text_src: src,
    });
  }

  return { summary, byReason, report, total: rows.length };
}

/**
 * ОБС-письма без obs_account_id: пытаемся найти счёт-родителя
 * (через obs_letter_doc_id / номер / contract_label) и проставить
 * obs_account_id + subcontract_id однозначно.
 */
async function scanObsLetters() {
  const { rows } = await db.query(
    `SELECT l.id AS letter_id, l.invoice_number AS letter_no, l.invoice_date,
            l.obs_account_id AS letter_obs_account_id,
            l.subcontract_id AS letter_subcontract_id,
            d.id AS doc_id, d.invoice_number AS doc_no,
            d.contract_label, d.obs_account_id AS doc_obs_account_id,
            d.subcontract_id AS doc_subcontract_id, d.work_id,
            d.counterparty_inn, d.payment_source,
            c.id AS corr_id, c.obs_account_id AS corr_obs_account_id,
            c.number AS corr_number
       FROM doc_registry l
       LEFT JOIN doc_registry d
              ON d.obs_letter_doc_id = l.id AND d.deleted_at IS NULL
       LEFT JOIN correspondence c
              ON c.obs_invoice_doc_id = d.id AND c.deleted_at IS NULL
      WHERE l.package_type = 'letter'
        AND l.deleted_at IS NULL
      ORDER BY l.id`
  );

  log(`ОБС-писем в реестре: ${rows.length}`);
  const report = [];
  let wouldLink = 0;
  let skipped = 0;
  let applied = 0;

  for (const r of rows) {
    const label = `письмо #${r.letter_id} ${r.letter_no || 'б/н'}`;
    const needAccount = !r.letter_obs_account_id && !r.corr_obs_account_id
      && !r.doc_obs_account_id;
    const needSub = r.doc_id && !r.doc_subcontract_id;

    if (!needAccount && !needSub) {
      log(`  SKIP ${label}: уже привязано`
        + (r.doc_obs_account_id ? ` obs=#${r.doc_obs_account_id}` : '')
        + (r.doc_subcontract_id ? ` sub=#${r.doc_subcontract_id}` : ''));
      skipped++;
      report.push({ letter_id: r.letter_id, action: 'skipped', reason: 'already_linked' });
      continue;
    }

    let obsAccountId = r.doc_obs_account_id || r.letter_obs_account_id || r.corr_obs_account_id || null;
    let subcontractId = r.doc_subcontract_id || r.letter_subcontract_id || null;
    let subReason = null;

    // Если счёт есть, но subcontract_id пуст — matchObsContract по contract_label.
    if (r.doc_id && !subcontractId && r.contract_label) {
      const m = await matchObsContract(db, {
        contractLabel: r.contract_label,
        counterpartyInn: r.counterparty_inn,
        workId: r.work_id,
      });
      if (m.found) {
        subcontractId = m.contract.id;
        subReason = m.reason;
      } else {
        subReason = m.reason;
      }
    }

    // obs_account_id: если у счёта уже есть — копируем на письмо/переписку.
    // Если нет — не угадываем (на проде часто один счёт ОБС, но ошибочная
    // привязка ломает оплату). Оставляем на ручную.
    if (!obsAccountId && r.doc_id) {
      // Счёт без obs_account_id — письмо тоже не заполняем.
      log(`  SKIP ${label}: у счёта #${r.doc_id} нет obs_account_id (ручная привязка)`);
      skipped++;
      report.push({
        letter_id: r.letter_id, doc_id: r.doc_id,
        action: 'skipped', reason: 'no_obs_account_on_doc',
        subcontract_id: subcontractId, sub_reason: subReason,
      });
      // subcontract всё равно можем проставить, если нашли.
      if (subcontractId && APPLY && r.doc_id && !r.doc_subcontract_id) {
        await db.query(
          `UPDATE doc_registry SET subcontract_id=$2, updated_at=NOW()
            WHERE id=$1 AND subcontract_id IS NULL`,
          [r.doc_id, subcontractId]);
        applied++;
        log(`  APPLY ${label}: subcontract_id=#${subcontractId} (${subReason})`);
      } else if (subcontractId && !APPLY && r.doc_id && !r.doc_subcontract_id) {
        wouldLink++;
        log(`  WOULD ${label}: subcontract_id=#${subcontractId} (${subReason})`);
      }
      continue;
    }

    const actions = [];
    if (obsAccountId && needAccount) actions.push(`obs_account_id=#${obsAccountId}`);
    if (subcontractId && needSub) actions.push(`subcontract_id=#${subcontractId} (${subReason})`);

    if (!actions.length) {
      log(`  SKIP ${label}: нечего проставлять однозначно (sub=${subReason || 'n/a'})`);
      skipped++;
      report.push({
        letter_id: r.letter_id, action: 'skipped',
        reason: subReason || 'ambiguous',
      });
      continue;
    }

    log(`  ${APPLY ? 'APPLY' : 'WOULD'} ${label}: ${actions.join(', ')}`);
    report.push({
      letter_id: r.letter_id,
      doc_id: r.doc_id,
      corr_id: r.corr_id,
      action: APPLY ? 'linked' : 'would_link',
      obs_account_id: obsAccountId,
      subcontract_id: subcontractId,
      sub_reason: subReason,
    });

    if (!APPLY) { wouldLink++; continue; }

    try {
      if (r.doc_id && subcontractId && !r.doc_subcontract_id) {
        await db.query(
          `UPDATE doc_registry SET subcontract_id=$2, updated_at=NOW()
            WHERE id=$1 AND subcontract_id IS NULL`,
          [r.doc_id, subcontractId]);
      }
      if (obsAccountId) {
        if (!r.letter_obs_account_id) {
          await db.query(
            `UPDATE doc_registry SET obs_account_id=$2, updated_at=NOW()
              WHERE id=$1 AND obs_account_id IS NULL`,
            [r.letter_id, obsAccountId]);
        }
        if (r.doc_id && !r.doc_obs_account_id) {
          await db.query(
            `UPDATE doc_registry SET obs_account_id=$2, updated_at=NOW()
              WHERE id=$1 AND obs_account_id IS NULL`,
            [r.doc_id, obsAccountId]);
        }
        if (r.corr_id && !r.corr_obs_account_id) {
          await db.query(
            `UPDATE correspondence SET obs_account_id=$2, updated_at=NOW()
              WHERE id=$1 AND obs_account_id IS NULL`,
            [r.corr_id, obsAccountId]);
        }
      }
      applied++;
    } catch (e) {
      log(`  FAIL ${label}: ${e.message}`);
      report.push({ letter_id: r.letter_id, action: 'failed', error: e.message });
    }
  }

  return { total: rows.length, wouldLink, skipped, applied, report };
}

async function main() {
  log(`режим: ${APPLY ? 'ЗАПИСЬ (--apply)' : 'dry-run (ничего не меняется)'}`);
  if (SKIP_OCR) log('OCR отключён (--skip-ocr)');
  if (LIMIT) log(`лимит вложений: ${LIMIT}`);
  if (ONLY_IDS.length) log('только id:', ONLY_IDS.join(', '));

  const ownInnStr = await ownInn(db).catch(() => '');
  log(`наш ИНН: ${ownInnStr || '(не задан)'}`);
  log('');

  let contractsResult = null;
  if (!OBS_ONLY) {
    log('=== 1. Договоры из почтовых вложений ===');
    contractsResult = await scanContractAttachments(ownInnStr);
    log('');
    log('итог по договорам:');
    log(`  всего: ${contractsResult.total}`);
    log(`  ${APPLY ? 'создано' : 'будет создано'}: ${contractsResult.summary.created}`);
    log(`  ${APPLY ? 'прикреплено' : 'будет прикреплено'}: ${contractsResult.summary.attached}`);
    log(`  уже есть: ${contractsResult.summary.exists}`);
    log(`  пропущено: ${contractsResult.summary.skipped}`
      + ` (нет файла: ${contractsResult.summary.no_file}, мало текста: ${contractsResult.summary.no_text})`);
    log(`  ошибок: ${contractsResult.summary.failed}`);
    log('  по причинам:');
    Object.keys(contractsResult.byReason).sort().forEach((k) => {
      log(`    ${k}: ${contractsResult.byReason[k]}`);
    });
    log('');
  }

  log('=== 2. ОБС-письма: obs_account_id / subcontract_id ===');
  const obsResult = await scanObsLetters();
  log('');
  log('итог по ОБС-письмам:');
  log(`  всего: ${obsResult.total}`);
  log(`  ${APPLY ? 'привязано' : 'будет привязано'}: ${APPLY ? obsResult.applied : obsResult.wouldLink}`);
  log(`  пропущено: ${obsResult.skipped}`);

  // Сохраняем JSON-отчёт рядом со скриптом.
  const outDir = path.join(process.cwd(), 'tests', 'reports');
  try { fs.mkdirSync(outDir, { recursive: true }); } catch (_) { /* */ }
  const outPath = path.join(outDir, 'V475-backfill-contracts-from-mail.json');
  fs.writeFileSync(outPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    mode: APPLY ? 'apply' : 'dry-run',
    contracts: contractsResult,
    obs_letters: obsResult,
  }, null, 2), 'utf8');
  log('');
  log(`отчёт: ${outPath}`);
  if (!APPLY) log('это dry-run — для записи запустите с --apply');
}

main()
  .then(() => db.pool.end?.())
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
    return db.pool.end?.();
  });
