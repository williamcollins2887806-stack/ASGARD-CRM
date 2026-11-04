'use strict';

/**
 * skud-mail-intake — автоматический приём отчёта СКУД с ящика CRM.
 *
 * Как это работает. СКУД раз в сутки (и по понедельникам за неделю) присылает
 * письмо с вложением «события DD.MM-DD.MM.xls» на ящик CRM. В imap.js уже есть
 * разбор входящих: письмо сохраняется в `emails`, вложения — в `email_attachments`
 * и на диск. Наш хук срабатывает ПОСЛЕ сохранения вложений и ДО ветки счетов:
 * отчёт СКУД не должен попадать в doc-email-intake (там OCR и заявки на оплату).
 *
 * Защита от двойного счёта — в skud-import.js: sha256 и период.
 *
 * Формат определяем по содержимому, а не по теме письма: тему СКУД-сервер
 * формирует свободно, а шапку файла («Отчет "события"», «период c … по …») —
 * по шаблону отчёта.
 */

const path = require('path');
const fs = require('fs');
const skudXls = require('./skud-xls');
const skudImport = require('./skud-import');

/** Расширения, которые считаем потенциальным отчётом. */
const REPORT_EXT_RE = /\.(xls|xlsx|zip)$/i;
/** Имя файла отчёта у СКУД: «события 26.10-01.11.xls». */
const FILENAME_HINT_RE = /событи/i;

/**
 * Быстрая проверка «это может быть отчёт СКУД?».
 *
 * ВАЖНО (верификатор 03.11.2026, P2-4): раньше решение принималось только по
 * имени файла и теме письма. Отчёт «report.xls» с темой без слов «скуд/проход»
 * не подхватывался ни хуком, ни cron-страховкой, хотя внутри лежала настоящая
 * выгрузка. Теперь основной признак — СОДЕРЖИМОЕ: шапка файла «Отчет "события"»
 * или «период c … по …» плюс строка сотрудника «ФИО (таб.№)».
 *
 * Имя/тема/отправитель остаются как быстрый фильтр: если ни один признак не
 * сработал, файл всё равно проверяется по содержимому (см. intakeAttachment).
 *
 * @param {object} p
 * @param {string} p.subject
 * @param {string} p.fromEmail
 * @param {Array<{filename?:string, mime_type?:string}>} p.attachments
 * @param {string} p.mailFrom — белый список из settings.skud.mail_from
 */
function looksLikeSkudReport(p) {
  const subject = String(p.subject || '');
  const from = String(p.fromEmail || '').toLowerCase();
  const allow = String(p.mailFrom || '')
    .split(/[,;\s]+/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

  const fromAllowed = allow.length === 0 ? true : allow.some((a) => from.includes(a));
  const attachments = (p.attachments || []).filter((a) => REPORT_EXT_RE.test(String(a.filename || '')));
  if (!attachments.length) return false;

  const nameHit = attachments.some((a) => FILENAME_HINT_RE.test(String(a.filename || '')));
  const subjectHit = /скуд|событи|проход/i.test(subject);

  if (nameHit && fromAllowed) return true;
  if (nameHit && subjectHit) return true;

  // Содержимое решает в любом случае: даже «безымянный» .xls проверяем,
  // потому что intakeAttachment всё равно откроет файл и отбросит не-отчёт.
  // Здесь важно НЕ отсечь кандидата раньше времени.
  if (fromAllowed && allow.length > 0) return true;
  return subjectHit;
}

/**
 * Проверка «это отчёт СКУД?» по уже прочитанному буферу.
 * Используется как решающий фильтр — имя файла роли не играет.
 */
function looksLikeSkudBuffer(buffer) {
  try {
    const XLSX = require('xlsx');
    const AdmZip = require('adm-zip');
    let buf = buffer;
    if (buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b) {
      const zip = new AdmZip(buf);
      const entries = zip.getEntries().filter((e) => !e.isDirectory);
      const isWorkbook = entries.some((e) => /^xl\/workbook\.xml$/i.test(e.entryName));
      if (!isWorkbook) {
        const entry = entries.find((e) => /\.(xls|xlsx)$/i.test(e.entryName));
        if (!entry) return false;
        buf = entry.getData();
      }
    }
    const wb = XLSX.read(buf, { type: 'buffer', codepage: 1251, cellDates: false, raw: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) return false;
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    return skudXls.looksLikeSkudRows(rows);
  } catch (_) {
    return false;
  }
}

/**
 * Разбор одного вложения: только если внутри действительно отчёт СКУД.
 * Возвращает результат импорта либо { skipped: 'not_skud' }.
 */
async function intakeAttachment(db, p) {
  const { attachmentPath, filename, emailId, importedBy } = p;
  if (!attachmentPath || !fs.existsSync(attachmentPath)) {
    return { skipped: 'no_file', filename };
  }
  const buffer = fs.readFileSync(attachmentPath);

  // Содержимое важнее имени: если внутри не отчёт — тихо выходим,
  // чтобы не порождать ошибок на каждом письме со счётом в .xlsx.
  let parsed;
  try {
    parsed = skudXls.parseBuffer(buffer, { filename });
  } catch (e) {
    return { skipped: 'not_skud', filename, reason: e.message };
  }
  if (!parsed || !parsed.periodFrom) {
    return { skipped: 'not_skud', filename };
  }

  const result = await skudImport.importSkudReport(db, {
    buffer,
    filename,
    source: emailId ? 'mail' : 'manual',
    emailId: emailId || null,
    importedBy: importedBy || null
  });
  return { ...result, filename };
}

/**
 * Обработка входящего письма целиком: перебрать вложения, импортировать отчёт.
 * Возвращает { touched: boolean, imports: [...] }.
 */
async function intakeEmail(db, email) {
  if (!email || !email.id) return { touched: false, imports: [] };

  const { rows: atts } = await db.query(
    `SELECT id, filename, original_filename, mime_type, file_path, is_inline, checksum_sha256
       FROM email_attachments WHERE email_id = $1 ORDER BY id`,
    [email.id]
  );
  if (!atts.length) return { touched: false, imports: [] };

  const settingsRows = await db.query(`SELECT value_json FROM settings WHERE key = 'skud' LIMIT 1`);
  let settings = {};
  if (settingsRows.rows[0]) {
    try { settings = JSON.parse(settingsRows.rows[0].value_json) || {}; } catch (_) {}
  }

  const candidate = looksLikeSkudReport({
    subject: email.subject,
    fromEmail: email.from_email,
    attachments: atts,
    mailFrom: settings.mail_from
  });

  const imports = [];
  for (const att of atts) {
    if (att.is_inline) continue;
    if (!REPORT_EXT_RE.test(String(att.filename || ''))) continue;
    const full = resolveAttachmentPath(att.file_path);

    // Решающий фильтр — СОДЕРЖИМОЕ файла, а не имя и не тема письма
    // (верификатор 03.11.2026, P2-4). Если шапка не похожа на выгрузку СКУД,
    // молча пропускаем: письмо со счётом в .xlsx не должно давать ошибок.
    if (!looksLikeSkudBuffer(fs.existsSync(full) ? fs.readFileSync(full) : Buffer.alloc(0))) {
      continue;
    }

    const res = await intakeAttachment(db, {
      attachmentPath: full,
      filename: att.original_filename || att.filename,
      emailId: email.id
    });
    if (res && res.skipped === 'not_skud') continue;
    imports.push(res);
  }

  // Ни одного отчёта внутри — не наш случай, отдаём письмо дальше (счета).
  if (!imports.length) return { touched: false, imports: [], candidate: candidate };

  // Помечаем письмо: теперь видно, что это был отчёт, а не счёт.
  try {
    await db.query(
      `UPDATE emails SET email_type = 'skud_report', ai_classification = 'skud_report' WHERE id = $1`,
      [email.id]
    );
  } catch (_) { /* не критично */ }

  return { touched: true, imports };
}

/** Абсолютный путь вложения: в БД лежит относительный 'uploads/mail/...'. */
function resolveAttachmentPath(filePath) {
  const raw = String(filePath || '');
  if (!raw) return null;
  if (path.isAbsolute(raw)) return raw;
  const base = path.resolve(
    process.env.UPLOAD_DIR || process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads')
  );
  const rel = raw.replace(/^\/?uploads\//i, '').replace(/^[\\/]+/, '');
  return path.join(base, rel);
}

module.exports = {
  looksLikeSkudReport,
  looksLikeSkudBuffer,
  intakeAttachment,
  intakeEmail,
  resolveAttachmentPath,
  REPORT_EXT_RE,
  FILENAME_HINT_RE
};
