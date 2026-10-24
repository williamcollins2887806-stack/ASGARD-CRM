'use strict';

/**
 * Email директору по payment_invoices (паттерн cash-mail).
 * В письме: Согласовать / Отказать → landing без CRM.
 * Счёт = MIME-вложение (обязательно). Группа = одно письмо + все PDF.
 * Live SMTP только prod (или PAYMENT_MAIL_FORCE=1).
 * Non-prod: только PAYMENT_MAIL_TO (Андросов); директорам не слать.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { sendCrmEmail } = require('./crm-mailer');
const { createNotification } = require('./notify');
const { normalizeUploadUrl, uploadFsPath } = require('../utils/upload-url');

const PROD_DIRECTOR_BLOCKLIST = [
  'go@asgard-service.com',
  'gazhiliev@asgard-service.com'
];

const TOKEN_TTL_HOURS = 48;

function publicBaseUrl() {
  return String(process.env.PUBLIC_APP_URL || process.env.PUBLIC_BASE_URL || 'https://asgard-crm.ru')
    .replace(/\/$/, '');
}

function dbName() {
  return process.env.DB_NAME || process.env.PGDATABASE || 'asgard_crm';
}

/**
 * Боевой ли это контур для ПЛАТЁЖНЫХ писем директору.
 *
 * D-323 (заказчик 21.10.2026): «почему директор получает на почту счета на
 * согласование от СРМ? я просил отключить, мы пока в тестовом режиме».
 *
 * ДЕФЕКТ: проверка была `NODE_ENV === 'production' && DB_NAME === 'asgard_crm'`.
 * На проде стоит `NODE_ENV=development` (так он и развёрнут), поэтому условие
 * ВСЕГДА ложно → isLivePaymentMail() = false… НО `sendDirectorMail` вызывал
 * deliverMail, а тот при `!isLivePaymentMail()` возвращал dry-run. Значит письма
 * всё же уходили другим путём — через `sendDirectorMailBatch`/`sendCrmEmail`,
 * где проверка была иной. Итог: 11 писем «Счёт на оплату #N» ушли на
 * go@asgard-service.com (директор Гажилиев) за сутки.
 *
 * Теперь решение принимает ОДИН явный флаг, а не догадка о NODE_ENV:
 *   • PAYMENT_MAIL_DISABLED=1  → НИКОГДА не шлём (высший приоритет);
 *   • PAYMENT_MAIL_ENABLED=1   → разрешаем (боевой режим, ставится осознанно);
 *   • иначе                    → запрещено (fail-closed).
 * Отсутствие флага = не шлём. Это ровно требование «пока в тестовом режиме».
 */
function isProdRuntime() {
  return process.env.NODE_ENV === 'production' && dbName() === 'asgard_crm';
}

function isLivePaymentMail() {
  if (process.env.PAYMENT_MAIL_DISABLED === '1') return false;   // killswitch сильнее всего
  if (process.env.PAYMENT_MAIL_ENABLED === '1') return true;     // явное разрешение
  if (process.env.PAYMENT_MAIL_FORCE === '1') return true;       // обратная совместимость
  // Fail-closed: без явного разрешения письма директору не уходят никогда.
  return false;
}

function resolvePaymentMailTo() {
  const raw = String(process.env.PAYMENT_MAIL_TO || '').trim().toLowerCase();
  if (!isProdRuntime()) {
    if (!raw) return { ok: false, reason: 'PAYMENT_MAIL_TO_required_non_prod' };
    if (PROD_DIRECTOR_BLOCKLIST.includes(raw)) {
      return { ok: false, reason: 'director_blocked_in_non_prod', email: raw };
    }
    return { ok: true, email: raw };
  }
  if (raw) return { ok: true, email: raw };
  return { ok: true, email: 'go@asgard-service.com' };
}

function fmtRub(n) {
  return Math.round(Number(n) || 0).toLocaleString('ru-RU');
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function hashToken(raw) {
  return crypto.createHash('sha256').update(String(raw), 'utf8').digest('hex');
}

// opts.kicker / opts.footer — точки расширения для писем-согласований других модулей
// (напр. отпуска). Без opts поведение прежнее (payment-mail).
function wrapEmail(title, inner, opts) {
  opts = opts || {};
  const kicker = opts.kicker ? esc(opts.kicker) : 'АСГАРД · ОПЛАТА';
  const footer = opts.footer != null
    ? esc(opts.footer)
    : 'Вход в CRM не нужен. Решение — кнопки Согласовать / Отказать. Счёт во вложении письма.';
  return `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef1f6;font-family:Arial,Helvetica,sans-serif;color:#1b2a4a;">
  <div style="max-width:560px;margin:0 auto;padding:20px 16px 40px;">
    <div style="background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 8px 24px rgba(27,42,74,.08);">
      <div style="background:#1b2a4a;color:#fff;padding:18px 20px;">
        <div style="font-size:12px;letter-spacing:.08em;color:#c9a227;font-weight:700;">${kicker}</div>
        <div style="font-size:18px;font-weight:700;margin-top:4px;">${esc(title)}</div>
      </div>
      <div style="padding:22px 20px 26px;">
        ${inner}
      </div>
    </div>
    <p style="text-align:center;font-size:12px;color:#6b7280;margin-top:14px;line-height:1.45;">
      ${footer}
    </p>
  </div>
</body></html>`;
}

function linesHtml(pay) {
  let lines = [];
  try {
    const raw = pay.line_items_json;
    lines = Array.isArray(raw) ? raw : (typeof raw === 'string' ? JSON.parse(raw || '[]') : []);
  } catch (_) { lines = []; }
  if (!lines.length) return '<p style="color:#6b7280;font-size:13px;margin:12px 0">Позиции — в PDF во вложении</p>';
  const rows = lines.slice(0, 40).map(l => `<tr>
    <td style="padding:6px 0;border-bottom:1px solid #eef1f6;font-size:14px">${esc(l.name || l.invoice_name || '—')}</td>
    <td style="padding:6px 0;border-bottom:1px solid #eef1f6;font-size:14px;text-align:right;color:#6b7280">${esc(String(l.qty != null ? l.qty : (l.quantity || '')))}</td>
    <td style="padding:6px 0;border-bottom:1px solid #eef1f6;font-size:14px;text-align:right">${l.unit_price != null ? fmtRub(l.unit_price) + ' ₽' : '—'}</td>
  </tr>`).join('');
  return `<table style="width:100%;border-collapse:collapse;margin:12px 0 4px">
    <thead><tr>
      <th style="text-align:left;padding:6px 0;font-size:12px;color:#6b7280;font-weight:600">Позиция</th>
      <th style="text-align:right;padding:6px 0;font-size:12px;color:#6b7280;font-weight:600">Кол-во</th>
      <th style="text-align:right;padding:6px 0;font-size:12px;color:#6b7280;font-weight:600">Цена</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
}

function ctaButtons(pageUrl) {
  return `
    <a href="${esc(pageUrl)}" style="display:block;background:#15803d;color:#fff;text-decoration:none;text-align:center;padding:14px 16px;border-radius:10px;font-weight:700;font-size:16px;margin:18px 0 10px;">Согласовать</a>
    <a href="${esc(pageUrl)}" style="display:block;background:#b91c1c;color:#fff;text-decoration:none;text-align:center;padding:14px 16px;border-radius:10px;font-weight:700;font-size:16px;">Отказать</a>
    <p style="font-size:13px;color:#6b7280;margin:16px 0 0;line-height:1.45;">
      Откроется страница решения без входа в CRM. Ссылка действует ${TOKEN_TTL_HOURS} часов.
    </p>`;
}

// Кнопки «Да / Нет» на две РАЗНЫЕ ссылки (отпуска, касса). Для бинарных
// решений, где approve/reject ведут на разные URL. Повторяет стиль ctaButtons.
function ctaButtonsDual({ primaryUrl, secondaryUrl, primaryLabel, secondaryLabel }) {
  return `
    <a href="${esc(primaryUrl)}" style="display:block;background:#15803d;color:#fff;text-decoration:none;text-align:center;padding:14px 16px;border-radius:10px;font-weight:700;font-size:16px;margin:18px 0 10px;">${esc(primaryLabel || 'Да, согласовать')}</a>
    <a href="${esc(secondaryUrl)}" style="display:block;background:#b91c1c;color:#fff;text-decoration:none;text-align:center;padding:14px 16px;border-radius:10px;font-weight:700;font-size:16px;">${esc(secondaryLabel || 'Нет, снять')}</a>
    <p style="font-size:13px;color:#6b7280;margin:16px 0 0;line-height:1.45;">
      Откроется страница решения без входа в CRM. Ссылка действует ${TOKEN_TTL_HOURS} часов.
    </p>`;
}

function landingShell(title, inner) {
  return `<!DOCTYPE html>
<html lang="ru"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
  body{margin:0;background:#eef1f6;font-family:Arial,Helvetica,sans-serif;color:#1b2a4a;}
  .wrap{max-width:520px;margin:0 auto;padding:20px 16px 40px;}
  .card{background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 8px 24px rgba(27,42,74,.08);}
  .hd{background:#1b2a4a;color:#fff;padding:18px 20px;}
  .hd .k{font-size:12px;letter-spacing:.08em;color:#c9a227;font-weight:700;}
  .bd{padding:22px 20px 26px;}
  .amt{font-size:34px;font-weight:800;margin:4px 0 16px;}
  .row{font-size:15px;margin:8px 0;line-height:1.4;}
  .lbl{color:#6b7280;display:inline-block;min-width:100px;}
  .btn{display:block;width:100%;box-sizing:border-box;border:0;border-radius:10px;padding:14px 16px;font-size:16px;font-weight:700;color:#fff;margin:8px 0;cursor:pointer;}
  .ok{background:#15803d;} .no{background:#b91c1c;}
  .muted{color:#6b7280;font-size:13px;line-height:1.45;margin-top:16px;}
  .banner{padding:12px 14px;border-radius:8px;margin-bottom:14px;font-size:14px;}
  .warn{background:#fff8e6;color:#5c4a00;}
  .err{background:#fef2f2;color:#991b1b;}
  .okb{background:#ecfdf5;color:#065f46;}
  .file{font-size:14px;margin:10px 0;padding:10px 12px;background:#f3f4f6;border-radius:8px;}
</style>
</head>
<body><div class="wrap"><div class="card">
  <div class="hd"><div class="k">АСГАРД · ОПЛАТА</div><div style="font-size:18px;font-weight:700;margin-top:4px;">${esc(title)}</div></div>
  <div class="bd">${inner}</div>
</div></div></body></html>`;
}

function landingMessageHtml(title, msg, tone) {
  const cls = tone === 'ok' ? 'okb' : (tone === 'warn' ? 'warn' : 'err');
  return landingShell(title, `<div class="banner ${cls}">${esc(msg)}</div>`);
}

function landingActionHtml(pay, rawToken) {
  const timing = pay.pay_timing === 'deferred' ? 'Отложенная' : 'Сразу после согласования';
  const fileName = pay.file_name || (pay.file_path ? String(pay.file_path).split('/').pop() : null);
  return landingShell('Решение по счёту', `
    <div class="muted" style="margin-top:0;">Сумма к оплате</div>
    <div class="amt">${fmtRub(pay.amount)} ₽</div>
    <div class="row"><span class="lbl">Счёт</span> <b>#${pay.id}</b></div>
    <div class="row"><span class="lbl">Поставщик</span> <b>${esc(pay.supplier_name || '—')}</b></div>
    <div class="row"><span class="lbl">Основание</span> ${esc(pay.basis_text || pay.basis_type || '—')}</div>
    <div class="row"><span class="lbl">Оплата</span> ${esc(timing)}</div>
    ${pay.procurement_id ? `<div class="row"><span class="lbl">Заявка</span> #${pay.procurement_id}</div>` : ''}
    ${fileName ? `<div class="file">📄 Счёт во вложении письма: <b>${esc(fileName)}</b></div>` : '<div class="banner warn">Файл счёта отсутствует</div>'}
    ${linesHtml(pay)}
    <button class="btn ok" type="button" onclick="decide('approve')">Согласовать</button>
    <button class="btn no" type="button" onclick="decide('reject')">Отказать</button>
    <p class="muted">Вход в CRM не нужен. После согласования бухгалтерия увидит счёт в очереди оплаты. Ссылка действует ${TOKEN_TTL_HOURS} ч.</p>
    <script>
      function decide(action){
        var btns=document.querySelectorAll('button');
        for(var i=0;i<btns.length;i++) btns[i].disabled=true;
        fetch(location.pathname,{
          method:'POST',
          headers:{'Content-Type':'application/json','Accept':'application/json'},
          body:JSON.stringify({action:action})
        }).then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});})
          .then(function(x){
            document.querySelector('.bd').innerHTML =
              '<div class="banner '+(x.j && x.j.ok ? 'okb':'err')+'">'+(x.j && (x.j.message||x.j.error) || 'Готово')+'</div>';
          }).catch(function(){
            document.querySelector('.bd').innerHTML = '<div class="banner err">Не удалось отправить решение. Попробуйте ещё раз.</div>';
          });
      }
    </script>
  `);
}

function landingBatchActionHtml(pays, rawToken) {
  const total = pays.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const rows = pays.map(p => {
    const fn = p.file_name || (p.file_path ? String(p.file_path).split('/').pop() : '—');
    return `<div class="row" style="padding:10px 0;border-bottom:1px solid #eef1f6">
      <b>Счёт #${p.id}</b> · ${fmtRub(p.amount)} ₽ · ${esc(p.supplier_name || '—')}<br>
      <span style="color:#6b7280;font-size:13px">📎 ${esc(fn)}</span>
    </div>`;
  }).join('');
  return landingShell('Решение по группе счетов', `
    <div class="muted" style="margin-top:0;">Сумма группы</div>
    <div class="amt">${fmtRub(total)} ₽</div>
    <div class="row"><span class="lbl">Счетов</span> <b>${pays.length}</b></div>
    <div style="margin:12px 0">${rows}</div>
    <p class="muted" style="margin-top:0">PDF всех счетов — во вложении письма. Решение одно на всю группу.</p>
    <button class="btn ok" type="button" onclick="decide('approve')">Согласовать все</button>
    <button class="btn no" type="button" onclick="decide('reject')">Отказать все</button>
    <p class="muted">Вход в CRM не нужен. Ссылка действует ${TOKEN_TTL_HOURS} ч.</p>
    <script>
      function decide(action){
        var btns=document.querySelectorAll('button');
        for(var i=0;i<btns.length;i++) btns[i].disabled=true;
        fetch(location.pathname,{
          method:'POST',
          headers:{'Content-Type':'application/json','Accept':'application/json'},
          body:JSON.stringify({action:action})
        }).then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});})
          .then(function(x){
            document.querySelector('.bd').innerHTML =
              '<div class="banner '+(x.j && x.j.ok ? 'okb':'err')+'">'+(x.j && (x.j.message||x.j.error) || 'Готово')+'</div>';
          }).catch(function(){
            document.querySelector('.bd').innerHTML = '<div class="banner err">Не удалось отправить решение. Попробуйте ещё раз.</div>';
          });
      }
    </script>
  `);
}

async function lookupToken(db, rawToken) {
  const raw = String(rawToken || '').trim();
  if (!raw || raw.length < 16) return { ok: false, reason: 'invalid' };
  const h = hashToken(raw);

  const single = await db.query(
    `SELECT t.*, p.* FROM payment_mail_tokens t
     JOIN payment_invoices p ON p.id = t.payment_id
     WHERE t.token_hash = $1`,
    [h]
  );
  if (single.rows[0]) {
    const row = single.rows[0];
    if (row.used_at) return { ok: false, reason: 'used', payment: row, kind: 'single' };
    if (new Date(row.expires_at) < new Date()) return { ok: false, reason: 'expired', payment: row, kind: 'single' };
    return { ok: true, payment: row, tokenRow: row, kind: 'single' };
  }

  try {
    const batch = await db.query(
      `SELECT * FROM payment_mail_batches WHERE token_hash = $1`,
      [h]
    );
    const b = batch.rows[0];
    if (!b) return { ok: false, reason: 'not_found' };
    if (b.used_at) return { ok: false, reason: 'used', kind: 'batch', batch: b };
    if (new Date(b.expires_at) < new Date()) return { ok: false, reason: 'expired', kind: 'batch', batch: b };
    const ids = b.payment_ids || [];
    const pays = await db.query(
      `SELECT * FROM payment_invoices WHERE id = ANY($1::int[]) ORDER BY id`,
      [ids]
    );
    return { ok: true, kind: 'batch', batch: b, payments: pays.rows };
  } catch (e) {
    if (/payment_mail_batches|does not exist/i.test(e.message || '')) {
      return { ok: false, reason: 'not_found' };
    }
    throw e;
  }
}

async function createToken(db, paymentId) {
  const raw = crypto.randomBytes(24).toString('hex');
  await db.query(
    `INSERT INTO payment_mail_tokens(payment_id, token_hash, expires_at)
     VALUES($1,$2,NOW()+($3||' hours')::interval)`,
    [paymentId, hashToken(raw), String(TOKEN_TTL_HOURS)]
  );
  return raw;
}

async function createBatchToken(db, paymentIds) {
  const raw = crypto.randomBytes(24).toString('hex');
  await db.query(
    `INSERT INTO payment_mail_batches(token_hash, payment_ids, expires_at)
     VALUES($1,$2::int[],NOW()+($3||' hours')::interval)`,
    [hashToken(raw), paymentIds, String(TOKEN_TTL_HOURS)]
  );
  return raw;
}

function buildAttachment(pay) {
  const fsPath = uploadFsPath(pay.file_path);
  if (!fsPath || !fs.existsSync(fsPath)) return null;
  let filename = pay.file_name || path.basename(fsPath);
  // unique names in batch
  if (pay.id && !String(filename).includes(String(pay.id))) {
    const ext = path.extname(filename) || '.pdf';
    const base = path.basename(filename, ext);
    filename = `${base}-schet-${pay.id}${ext}`;
  }
  return {
    filename,
    content: fs.readFileSync(fsPath),
    contentType: String(filename).toLowerCase().endsWith('.pdf') ? 'application/pdf' : undefined
  };
}

async function ensureFileNormalized(db, pay) {
  const filePath = normalizeUploadUrl(pay.file_path);
  if (!filePath) return { ok: false, reason: 'no_file' };
  if (pay.file_path !== filePath) {
    await db.query(`UPDATE payment_invoices SET file_path=$2 WHERE id=$1`, [pay.id, filePath]);
    pay.file_path = filePath;
  }
  const attachment = buildAttachment(pay);
  if (!attachment) return { ok: false, reason: 'file_missing_on_disk' };
  return { ok: true, attachment };
}

function directorEmailHtmlSingle(pay, { pageUrl, attachmentName }) {
  const timing = pay.pay_timing === 'deferred' ? 'Отложенная' : 'Сразу';
  return wrapEmail('Счёт на согласование', `
    <div style="font-size:13px;color:#6b7280;margin-bottom:6px;">Сумма к оплате</div>
    <div style="font-size:36px;font-weight:800;letter-spacing:-0.02em;margin-bottom:18px;">${fmtRub(pay.amount)} ₽</div>
    <table style="width:100%;border-collapse:collapse;font-size:15px;margin-bottom:12px;">
      <tr><td style="padding:6px 0;color:#6b7280;width:120px;">Счёт</td><td style="padding:6px 0;font-weight:700;">#${pay.id}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">Поставщик</td><td style="padding:6px 0;font-weight:700;">${esc(pay.supplier_name || '—')}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">Основание</td><td style="padding:6px 0;">${esc(pay.basis_text || pay.basis_type || '—')}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">Режим</td><td style="padding:6px 0;">${esc(timing)}</td></tr>
      ${pay.procurement_id ? `<tr><td style="padding:6px 0;color:#6b7280;">Закупка</td><td style="padding:6px 0;">#${pay.procurement_id}</td></tr>` : ''}
    </table>
    <div style="padding:10px 12px;background:#f3f4f6;border-radius:8px;font-size:14px;margin-bottom:8px;">
      📎 <b>Во вложении:</b> ${esc(attachmentName)}
    </div>
    ${linesHtml(pay)}
    ${ctaButtons(pageUrl)}
  `);
}

function directorEmailHtmlBatch(pays, { pageUrl, attachmentNames }) {
  const total = pays.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const list = pays.map((p, i) => {
    const fn = attachmentNames[i] || p.file_name || 'счёт.pdf';
    return `<tr>
      <td style="padding:8px 0;border-bottom:1px solid #eef1f6;font-size:14px"><b>#${p.id}</b> · ${esc(p.supplier_name || '—')}</td>
      <td style="padding:8px 0;border-bottom:1px solid #eef1f6;font-size:14px;text-align:right;font-weight:700">${fmtRub(p.amount)} ₽</td>
      <td style="padding:8px 0;border-bottom:1px solid #eef1f6;font-size:13px;color:#6b7280;text-align:right">📎 ${esc(fn)}</td>
    </tr>`;
  }).join('');
  return wrapEmail('Группа счетов на согласование', `
    <div style="font-size:13px;color:#6b7280;margin-bottom:6px;">Сумма группы (${pays.length} сч.)</div>
    <div style="font-size:36px;font-weight:800;letter-spacing:-0.02em;margin-bottom:18px;">${fmtRub(total)} ₽</div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:12px;">${list}</table>
    <div style="padding:10px 12px;background:#f3f4f6;border-radius:8px;font-size:14px;margin-bottom:8px;">
      📎 <b>Во вложении:</b> ${esc(attachmentNames.join(', '))}
    </div>
    <p style="font-size:14px;color:#6b7280;line-height:1.45;margin:0 0 4px;">Одно решение на всю группу: согласовать все или отказать все.</p>
    <a href="${esc(pageUrl)}" style="display:block;background:#15803d;color:#fff;text-decoration:none;text-align:center;padding:14px 16px;border-radius:10px;font-weight:700;font-size:16px;margin:18px 0 10px;">Согласовать все</a>
    <a href="${esc(pageUrl)}" style="display:block;background:#b91c1c;color:#fff;text-decoration:none;text-align:center;padding:14px 16px;border-radius:10px;font-weight:700;font-size:16px;">Отказать все</a>
    <p style="font-size:13px;color:#6b7280;margin:16px 0 0;line-height:1.45;">
      Вход в CRM не нужен. Ссылка действует ${TOKEN_TTL_HOURS} часов.
    </p>
  `);
}

async function deliverMail(db, { to, subject, html, text, attachments, link, meta }) {
  // D-323: СНАЧАЛА killswitch, потом резолвинг получателя. Раньше порядок был
  // обратный, и при выключенной рассылке мы всё равно уходили в ветку
  // «PAYMENT_MAIL_TO_required_non_prod» — то есть зависели от env, а не от
  // явного запрета. Теперь запрет проверяется первым и не оставляет надежд.
  if (!isLivePaymentMail()) {
    return {
      sent: false,
      dry_run: true,
      reason: process.env.PAYMENT_MAIL_DISABLED === '1'
        ? 'payment_mail_disabled'
        : 'payment_mail_not_enabled',
      link,
      to: to || (resolvePaymentMailTo().email || null),
      email_preview: html,
      attachment_names: (attachments || []).map((a) => a.filename),
      ...meta
    };
  }
  const toRes = to ? { ok: true, email: to } : resolvePaymentMailTo();
  if (!toRes.ok) {
    return { sent: false, dry_run: true, reason: toRes.reason, link, email_preview: html, ...meta };
  }
  await sendCrmEmail(db, null, {
    to: toRes.email,
    subject,
    html,
    text: text || subject,
    attachments: attachments || [],
    skipBcc: !isProdRuntime()
  });
  return { sent: true, to: toRes.email, link, ...meta };
}

async function sendDirectorMail(db, paymentId) {
  const { rows } = await db.query('SELECT * FROM payment_invoices WHERE id=$1', [paymentId]);
  const pay = rows[0];
  if (!pay) return { sent: false, reason: 'not_found' };

  const fileOk = await ensureFileNormalized(db, pay);
  if (!fileOk.ok) return { sent: false, reason: fileOk.reason, payment_id: paymentId };

  const raw = await createToken(db, paymentId);
  const base = publicBaseUrl();
  const link = `${base}/payment-mail/${encodeURIComponent(raw)}`;
  const html = directorEmailHtmlSingle(pay, { pageUrl: link, attachmentName: fileOk.attachment.filename });

  return deliverMail(db, {
    subject: `Счёт на оплату #${pay.id}: ${fmtRub(pay.amount)} ₽`,
    html,
    text: `Счёт #${pay.id}: ${fmtRub(pay.amount)} ₽. Поставщик: ${pay.supplier_name || '—'}. Решение: ${link}. Файл во вложении.`,
    attachments: [fileOk.attachment],
    link,
    meta: { payment_id: paymentId, attachment_name: fileOk.attachment.filename }
  });
}

async function sendDirectorMailBatch(db, paymentIds) {
  const ids = [...new Set((paymentIds || []).map(Number).filter(n => n > 0))];
  if (!ids.length) return { sent: false, reason: 'empty' };
  if (ids.length === 1) return sendDirectorMail(db, ids[0]);

  const { rows: pays } = await db.query(
    `SELECT * FROM payment_invoices WHERE id = ANY($1::int[]) ORDER BY id`,
    [ids]
  );
  if (pays.length !== ids.length) return { sent: false, reason: 'not_found' };

  const attachments = [];
  const names = [];
  for (const pay of pays) {
    const fileOk = await ensureFileNormalized(db, pay);
    if (!fileOk.ok) return { sent: false, reason: fileOk.reason, payment_id: pay.id };
    attachments.push(fileOk.attachment);
    names.push(fileOk.attachment.filename);
  }

  let raw;
  try {
    raw = await createBatchToken(db, ids);
  } catch (e) {
    if (/payment_mail_batches|does not exist/i.test(e.message || '')) {
      // fallback: N separate mails if migration not applied
      const results = [];
      for (const id of ids) results.push(await sendDirectorMail(db, id));
      return { sent: results.every(r => r.sent), dry_run: results.some(r => r.dry_run), batch_fallback: true, results };
    }
    throw e;
  }

  const base = publicBaseUrl();
  const link = `${base}/payment-mail/${encodeURIComponent(raw)}`;
  const total = pays.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const html = directorEmailHtmlBatch(pays, { pageUrl: link, attachmentNames: names });

  return deliverMail(db, {
    subject: `Группа счетов (${pays.length}): ${fmtRub(total)} ₽`,
    html,
    text: `Группа из ${pays.length} счетов на ${fmtRub(total)} ₽. Решение: ${link}. PDF во вложении.`,
    attachments,
    link,
    meta: { payment_ids: ids, attachment_names: names, batch: true }
  });
}

async function applyDecision(db, payment, action, actor) {
  const act = String(action || '').toLowerCase();
  if (act !== 'approve' && act !== 'reject') {
    throw Object.assign(new Error('action: approve|reject'), { statusCode: 400 });
  }
  if (payment.status !== 'awaiting_dir') {
    return { ok: true, already: true, status: payment.status };
  }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    // S5: закрываем гонку «два директора/бухгалтера одновременно». Решение
    // атомарно применяется только если статус всё ещё awaiting_dir — проверка
    // статуса вне транзакции (выше) эту гонку не ловила.
    const lock = await client.query(
      `UPDATE payment_invoices SET updated_at=NOW() WHERE id=$1 AND status='awaiting_dir' RETURNING id`,
      [payment.id]
    );
    if (!lock.rowCount) {
      await client.query('ROLLBACK');
      const fresh = await db.query('SELECT status FROM payment_invoices WHERE id=$1', [payment.id]);
      return { ok: true, already: true, status: fresh.rows[0] ? fresh.rows[0].status : payment.status };
    }
    if (act === 'approve') {
      await client.query(
        `UPDATE payment_invoices SET status='pending_payment', payment_status='pending_payment',
         dir_approved_by=$2, dir_approved_at=NOW(), updated_at=NOW() WHERE id=$1`,
        [payment.id, actor?.id || null]
      );
      if (payment.invoice_import_id) {
        await client.query(
          `UPDATE procurement_invoice_imports SET approval_status='dir_approved', dir_approved_at=NOW() WHERE id=$1`,
          [payment.invoice_import_id]
        );
      }
    } else {
      await client.query(
        `UPDATE payment_invoices SET status='rejected', updated_at=NOW() WHERE id=$1`,
        [payment.id]
      );
      if (payment.invoice_import_id) {
        await client.query(
          `UPDATE procurement_invoice_imports SET approval_status='pm_approved' WHERE id=$1`,
          [payment.invoice_import_id]
        );
      }
    }
    await client.query(
      `UPDATE payment_mail_tokens SET used_at=NOW(), used_action=$2 WHERE payment_id=$1 AND used_at IS NULL`,
      [payment.id, act]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  // D-317: решение принято — напоминания больше не нужны.
  try {
    const esc = require('./approval-escalation');
    await esc.clearForInvoice(db, payment.id);
  } catch (_) { /* не критично */ }

  if (act === 'approve') {
    const buhs = await db.query("SELECT id FROM users WHERE role='BUH' AND is_active=true");
    for (const b of buhs.rows) {
      createNotification(db, {
        user_id: b.id,
        title: `Счёт #${payment.id} к оплате`,
        message: `${fmtRub(payment.amount)} ₽ · ${payment.supplier_name || ''}`,
        type: 'payment',
        link: `#/approval-payment`
      });
    }
    // Часть II плана: ПОСЛЕ согласования директором счёт попадает в реестр
    // («дозаполнить»). Раньше запись появлялась только из afterPaid — после
    // ОПЛАТЫ, а требование заказчика: «подтвердил → сразу в реестр».
    await ensureRegistryDoc(db, payment.id);
  } else if (payment.created_by) {
    createNotification(db, {
      user_id: payment.created_by,
      title: `Счёт #${payment.id} отклонён`,
      message: 'Директор отклонил оплату',
      type: 'payment',
      link: payment.procurement_id ? `#/procurement?id=${payment.procurement_id}` : `#/payment-invoices?id=${payment.id}`
    });
  }
  return { ok: true, status: act === 'approve' ? 'pending_payment' : 'rejected' };
}

/**
 * Часть II плана: после dir-approve создать/связать строку реестра документов
 * со статусом «дозаполнить». Идемпотентно: повторный вызов не создаёт дубль.
 *
 * D-369 (23.10.2026, третий раунд верификации). РАНЬШЕ поля заявки переносились
 * ТОЛЬКО в ветке INSERT. Если строка реестра уже была (связана по
 * `payment_invoice_id`, по `pay.doc_registry_id` или найдена антидублем по
 * контрагенту и сумме), функция делала короткий UPDATE и выходила — без
 * `spend_kind`, сроков СФ и работы. На проде это реальный путь: 6 пар
 * «заявка ↔ готовая строка реестра», из них 2 живых черновика. Офисный счёт
 * ложился в реестр как «работы».
 *
 * ТЕПЕРЬ перенос вынесен в `applyInvoiceFields()` и вызывается во ВСЕХ ветках.
 * Плюс в INSERT передаются номер, дата, НДС, нетто и комментарий пользователя:
 * раньше НДС молча обнулялся, `comment_text` заменялся именем файла, а причины
 * «нет номера/даты» ставились константой даже при заполненных полях.
 *
 * @returns {Promise<number|null>} id строки реестра
 */
async function ensureRegistryDoc(db, paymentId) {
  try {
    const pay = (await db.query(`SELECT * FROM payment_invoices WHERE id=$1`, [paymentId])).rows[0];
    if (!pay) return null;

    // ── Ветка 1: строка уже связана через payment_invoice_id ──────────────
    const linked = await db.query(
      `SELECT id FROM doc_registry WHERE payment_invoice_id=$1 AND deleted_at IS NULL LIMIT 1`, [paymentId]);
    if (linked.rows[0]) {
      await db.query(`UPDATE payment_invoices SET doc_registry_id=$2 WHERE id=$1 AND doc_registry_id IS NULL`, [paymentId, linked.rows[0].id]).catch(() => {});
      await applyInvoiceFields(db, pay, linked.rows[0].id);
      return linked.rows[0].id;
    }

    // ── Ветка 2: у заявки уже есть doc_registry_id ────────────────────────
    if (pay.doc_registry_id) {
      const d = await db.query(`SELECT id FROM doc_registry WHERE id=$1 AND deleted_at IS NULL`, [pay.doc_registry_id]);
      if (d.rows[0]) {
        await db.query(`UPDATE doc_registry SET payment_invoice_id=$2, updated_at=NOW() WHERE id=$1 AND payment_invoice_id IS NULL`, [pay.doc_registry_id, paymentId]).catch(() => {});
        await applyInvoiceFields(db, pay, pay.doc_registry_id);
        return pay.doc_registry_id;
      }
    }

    // ── Ветка 3: антидубль по реквизитам (тот же контрагент и сумма) ───────
    if (pay.supplier_name && pay.amount != null) {
      const dup = await db.query(
        `SELECT id FROM doc_registry WHERE deleted_at IS NULL AND dir='in'
           AND lower(trim(counterparty_name)) = lower(trim($1)) AND amount_gross = $2
           AND payment_invoice_id IS NULL LIMIT 1`, [pay.supplier_name, pay.amount]);
      if (dup.rows[0]) {
        await db.query(`UPDATE doc_registry SET payment_invoice_id=$2, updated_at=NOW() WHERE id=$1`, [dup.rows[0].id, paymentId]);
        await db.query(`UPDATE payment_invoices SET doc_registry_id=$2 WHERE id=$1`, [paymentId, dup.rows[0].id]).catch(() => {});
        await applyInvoiceFields(db, pay, dup.rows[0].id);
        return dup.rows[0].id;
      }
    }

    // ── Ветка 3b: тот же счёт уже в реестре (строгий дедуп) ──────────────
    //
    // D-370. Есть ДВА уникальных ограничения:
    //   • `uq_doc_registry_dedup` — (контрагент, номер, дата, сумма, dir):
    //     один и тот же счёт нельзя завести в реестр дважды;
    //   • `uq_pi_doc_registry` — одна строка реестра обслуживает ОДНУ заявку.
    //
    // Поэтому «связать дубль с существующей строкой» нельзя: если она уже
    // занята другой заявкой, UPDATE падает с 23505, ошибка глоталась, и заявка
    // уходила к бухгалтерии БЕЗ документа.
    //
    // Правильное поведение: если строка свободна — связать; если занята —
    // создать СВОЮ строку с уточнённым номером, чтобы дедуп-индекс пропустил
    // (например «1460-2»). Так у каждой заявки есть свой документ, а реестр
    // не теряет исходный.
    let dupWasTaken = false;
    if (pay.invoice_number) {
      const same = await db.query(
        `SELECT id, payment_invoice_id FROM doc_registry
          WHERE deleted_at IS NULL AND dir='in'
            AND lower(trim(counterparty_name)) = lower(trim($1))
            AND lower(trim(COALESCE(invoice_number,''))) = lower(trim($2))
            AND ($3::date IS NULL OR invoice_date = $3::date)
            AND amount_gross = $4
          ORDER BY (payment_invoice_id IS NULL) DESC, id ASC
          LIMIT 1`,
        [pay.supplier_name || '', pay.invoice_number, pay.invoice_date || null, pay.amount || 0]);
      const hit = same.rows[0];
      if (hit && !hit.payment_invoice_id) {
        await db.query(`UPDATE doc_registry SET payment_invoice_id=$2, updated_at=NOW() WHERE id=$1`,
          [hit.id, paymentId]);
        await db.query(`UPDATE payment_invoices SET doc_registry_id=$2 WHERE id=$1`,
          [paymentId, hit.id]).catch(() => {});
        await applyInvoiceFields(db, pay, hit.id);
        return hit.id;
      }
      if (hit && hit.payment_invoice_id) dupWasTaken = true;
    }

    // ── Ветка 4: создаём новую строку ─────────────────────────────────────
    // supplier_id ищем по ИНН из реквизитов заявки/строки — иначе реквизиты для
    // платёжки не подтянутся в модалку бухгалтера.
    let supplierId = pay.supplier_id || null;
    if (!supplierId) {
      try {
        const inn = pay.counterparty_inn || (await db.query(
          `SELECT counterparty_inn FROM doc_registry WHERE payment_invoice_id=$1 AND counterparty_inn IS NOT NULL LIMIT 1`, [paymentId]
        ).catch(() => ({ rows: [] }))).rows[0]?.counterparty_inn;
        if (inn) {
          const s = await db.query(`SELECT id FROM suppliers WHERE inn=$1 AND deleted_at IS NULL LIMIT 1`, [inn]);
          if (s.rows[0]) supplierId = s.rows[0].id;
        }
      } catch (_) { /* не критично */ }
    }

    const sk = String(pay.spend_kind || '');
    const spendKind = ['work', 'warehouse', 'office', 'other'].includes(sk) ? sk : 'other';

    // Суммы и НДС. D-369 (раунд 12): считаем ЕДИНОЙ функцией — той же, что
    // использует перенос в существующую строку. Раньше здесь была своя копия
    // с условием «оба поля нулевые», поэтому заявка с распознанным НДС и пустым
    // нетто (живая #13: 45 197,04 / NULL / 8 150,29) давала нетто 0 при сумме
    // 45 197 и ни одной метки неполноты.
    const amounts = splitInvoiceAmounts(pay);
    const gross = amounts.gross;
    const vatAmount = amounts.vat;
    const netAmount = amounts.net;
    const hasVat = !amounts.miscalc && (vatAmount > 0 || (amounts.rate > 0 && !amounts.miscalc));

    // Причины «неполноты» — по ФАКТУ, а не константой. Раньше no_invoice_number
    // и no_invoice_date ставились всегда, даже когда номер и дата есть.
    const reasons = [...new Set(computeInvoiceReasons(pay, spendKind))];
    // D-369 (раунд 12): НДС больше суммы — данные битые, нетто записать нельзя.
    // Метку ставим здесь, в ветке создания. Дедуплицируем: computeInvoiceReasons
    // уже мог добавить amount_mismatch, и без Set в карточке было бы
    // «сумма расходится…, сумма расходится…».
    if (amounts.miscalc && !reasons.includes('amount_mismatch')) reasons.push('amount_mismatch');

    // D-370: если дедуп-строка занята другой заявкой, создаём свою — с
    // уточнённым номером, иначе `uq_doc_registry_dedup` не даст вставить.
    let insertNumber = pay.invoice_number || null;
    if (dupWasTaken && insertNumber) {
      const cnt = await db.query(
        `SELECT count(*)::int n FROM doc_registry
          WHERE deleted_at IS NULL AND dir='in'
            AND lower(trim(COALESCE(invoice_number,''))) LIKE lower(trim($1)) || '%'`,
        [insertNumber]).catch(() => ({ rows: [{ n: 0 }] }));
      insertNumber = `${insertNumber}-${(cnt.rows[0].n || 1) + 1}`;
    }

    const ins = await db.query(
      `INSERT INTO doc_registry(dir, package_type, ops_status, pay_status,         counterparty_name, counterparty_inn, supplier_id,
         amount_gross, amount_net, vat_amount, vat_rate, has_vat, spend_kind,
         doc_owner_id, created_by, updated_by, receive_channel, comment_text,
         payment_invoice_id, is_incomplete, incomplete_reasons,
         invoice_number, invoice_date,
         work_id, sf_due_at, service_done_at, sf_basis)
       VALUES ('in','invoice','wait_closing','wait',
         $1, $2, $3,
         $4, $5, $6, $7, $8, $9,
         $10, $10, $10, 'email', $11,
         $12, $13, $14::text[],
         $15, $16::date,
         $17, $18::date, $19::date, $20)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        pay.supplier_name || 'Контрагент из заявки',
        pay.counterparty_inn || null,
        supplierId,
        gross, netAmount, vatAmount,
        // D-369: `vat_rate` объявлен NOT NULL — при null INSERT падал 23502 и
        // согласование молча не создавало строку. И главное: в реестре ставка
        // хранится в ДОЛЯХ (0.22), а в заявке — в ПРОЦЕНТАХ (22). Без конвертации
        // Doc Hub показывал «НДС 2200%» и пересчитывал нетто 120 000 → 5 217.
        toRegistryVatRate(pay.vat_rate),
        hasVat, spendKind,
        pay.created_by || 1,
        // Комментарий пользователя; имя файла — только если он пуст.
        pay.comment_text || (pay.basis_text || (pay.file_name ? ('Счёт: ' + pay.file_name) : null)) || 'Счёт из заявки',
        paymentId,
        reasons.length > 0, reasons,
        insertNumber,
        pay.invoice_date || null,
        pay.work_id || null,
        pay.sf_due_at || null,
        pay.service_done_at || null,
        ['invoice', 'service'].includes(String(pay.sf_basis || '')) ? pay.sf_basis : null
      ]);

    // D-370: при `ON CONFLICT DO NOTHING` строк может не быть — значит строка
    // реестра уже существует (дедуп-индекс). Тогда находим её и связываем,
    // иначе заявка ушла бы к бухгалтерии без документа.
    let docId = ins.rows[0] ? ins.rows[0].id : null;
    if (!docId) {
      // Строка не создана (например, гонка с параллельной вставкой того же
      // счёта). Ищем свободную и связываем; если все заняты — честно логируем,
      // чтобы дефект не потерялся молча.
      const again = await db.query(
        `SELECT id FROM doc_registry
          WHERE deleted_at IS NULL AND dir='in'
            AND lower(trim(counterparty_name)) = lower(trim($1))
            AND amount_gross = $2
            AND payment_invoice_id IS NULL
          ORDER BY id ASC LIMIT 1`,
        [pay.supplier_name || '', pay.amount || 0]);
      docId = again.rows[0] ? again.rows[0].id : null;
      if (docId) {
        await db.query(`UPDATE doc_registry SET payment_invoice_id=$2, updated_at=NOW() WHERE id=$1`,
          [docId, paymentId]).catch(() => {});
        await applyInvoiceFields(db, pay, docId);
      }
    }
    if (!docId) {
      console.error('[payment-mail] ensureRegistryDoc: строка реестра не создана и не найдена для #' + paymentId);
      return null;
    }
    if (supplierId && !pay.supplier_id) {
      await db.query(`UPDATE payment_invoices SET supplier_id=$2 WHERE id=$1`, [paymentId, supplierId]).catch(() => {});
    }
    await db.query(`UPDATE payment_invoices SET doc_registry_id=$2 WHERE id=$1`, [paymentId, docId]).catch(() => {});
    return docId;
  } catch (e) {
    // Запись в реестр не должна валить согласование.
    console.error('[payment-mail] ensureRegistryDoc failed:', e.message);
    return null;
  }
}

/**
 * D-369: ставка НДС в ДВУХ таблицах хранится по-разному.
 *   • `payment_invoices.vat_rate` — ПРОЦЕНТЫ (22, 20, 10, 5, 7, 0);
 *   • `doc_registry.vat_rate`     — ДОЛИ (0.22, 0.20 …), numeric(6,4).
 * Проверено по данным: в реестре min 0.0000 / max 0.2200 на 1606 строках.
 *
 * Первая версия переноса клала проценты как есть → Doc Hub показывал «НДС 2200%»,
 * а при пустых суммах пересчитывал нетто 120 000 → 5 217 вместо 98 361.
 * Это деньги и вычет, поэтому конвертация обязательна на входе в реестр.
 */
function toRegistryVatRate(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  // >1 — значит проценты (22), иначе уже доля (0.22). Идемпотентно.
  const frac = n > 1 ? n / 100 : n;
  return Math.round(frac * 10000) / 10000; // numeric(6,4)
}

/**
 * D-369 (раунд 12): ЕДИНЫЙ расчёт сумм счёта с НДС.
 *
 * Зачем отдельной функцией. Логика раскладки появлялась постепенно и дважды
 * разъезжалась: сначала её добавили только в перенос (ветки «уже есть строка»),
 * и создание нового счёта вело себя иначе; потом наоборот. Верификатор ловил это
 * на живых формах: заявка #13 (45 197,04 / нетто NULL / НДС 8 150,29) в переносе
 * лечилась, а в создании давала нетто 0 при сумме 45 197.
 *
 * Правила (все данные берём из заявки):
 *   • есть НДС, нет нетто  → нетто = сумма − НДС;
 *   • нет ни НДС, ни нетто → раскладываем по ставке (НДС «в том числе»);
 *   • нетто равно сумме, НДС 0, но ставка задана → раскладываем по ставке
 *     (так лечится старая строка #1598: 79 905 = 79 905 + 0 при ставке 22 %);
 *   • НДС ≥ суммы → нетто не может быть отрицательным: это ошибка данных,
 *     поэтому нетто = max(0, …) и возвращаем флаг miscalc для метки.
 *
 * @returns {{gross:number, net:number, vat:number, rate:number, miscalc:boolean}}
 */
function splitInvoiceAmounts(pay) {
  const gross = Math.max(0, Number(pay && pay.amount) || 0);
  const rate = toRegistryVatRate(pay && pay.vat_rate);
  let net = Math.max(0, Number(pay && pay.amount_net) || 0);
  let vat = Math.max(0, Number(pay && pay.vat_amount) || 0);
  let miscalc = false;

  if (gross > 0) {
    if (vat > 0 && net === 0) {
      // Частичные суммы: НДС распознан отдельной строкой, нетто нет.
      if (vat >= gross) {
        // НДС больше суммы — данные битые (реальный #14: 5 654 при НДС 98 278,68).
        // Отрицательное нетто писать нельзя (CHECK нет, платёжка бессмысленна),
        // а НДС 98 278,68 при сумме 5 654 не сойдётся никогда. Единственное
        // осмысленное состояние: считаем, что НДС не выделен (нетто = сумма),
        // и ставим метку amount_mismatch — бухгалтер сверит по скану.
        net = Math.round(gross * 100) / 100;
        vat = 0;
        miscalc = true;
      } else {
        net = Math.round((gross - vat) * 100) / 100;
      }
    } else if (net === 0 && vat === 0) {
      if (rate > 0) {
        vat = Math.round(gross * rate / (1 + rate) * 100) / 100;
        net = Math.round((gross - vat) * 100) / 100;
      } else {
        net = Math.round(gross * 100) / 100; // без НДС: нетто = брутто
      }
    } else if (rate > 0 && vat === 0 && net > 0 && net < gross - 0.02) {
      // D-369 (раунд 13): есть нетто, НДС-суммы нет, но ставка задана и нетто
      // меньше суммы. Данных достаточно: НДС = сумма − нетто.
      vat = Math.round((gross - net) * 100) / 100;
    } else if (net > gross + 0.02 && vat === 0) {
      // D-369 (раунд 14-15): нетто БОЛЬШЕ суммы — данные битые. Считать
      // `vat = gross − net` нельзя: получался отрицательный НДС, который реально
      // записывался в реестр (подтверждено: −1000), а по vat_amount считаются
      // агрегаты вычета. Приводим к «нетто = сумма, НДС 0» и ставим метку.
      //
      // ВАЖНО (регрессия, найденная верификатором): условие должно быть СТРОГО
      // больше. При `net >= gross` сюда попадали:
      //   • обычный счёт БЕЗ НДС (net = gross, vat = 0) → ложная метка
      //     «сумма расходится» на корректных счетах (8 таких на проде);
      //   • форма #1598 (net = gross, vat = 0, ставка 22 %) → перехватывалась
      //     ветка раскладки по ставке, и НДС переставал выделяться.
      net = Math.round(gross * 100) / 100;
      vat = 0;
      miscalc = true;
    } else if (rate > 0 && vat === 0 && Math.abs(net - gross) < 0.02) {
      // «Нетто = брутто, НДС 0», но ставка задана — противоречие (#1598).
      // Лечим раскладкой, а не меткой: НДС выделяется, арифметика сходится.
      vat = Math.round(gross * rate / (1 + rate) * 100) / 100;
      net = Math.round((gross - vat) * 100) / 100;
    }
  }
  return { gross, net, vat, rate, miscalc };
}

/**
 * D-369: «чего не хватает» для строки реестра.
 * Раньше в ветке создания причины собирались по факту, а в ветках «уже есть
 * строка» не пересчитывались вовсе: номер переносился, а метка «нет номера
 * счёта» оставалась — бухгалтерия шла искать несуществующую проблему.
 *
 * @returns {string[]} причины; пустой массив = строка заполнена
 */
function computeInvoiceReasons(pay, spendKind) {
  const reasons = [];
  if (!pay.invoice_number) reasons.push('no_invoice_number');
  if (!pay.invoice_date) reasons.push('no_invoice_date');
  // Нулевая сумма — тоже неполнота: строка «зелёная» с нулём не должна
  // выглядеть готовой (в словаре UI есть готовый код no_amount).
  if (!(Number(pay.amount) > 0)) reasons.push('no_amount');
  // D-369 (раунд 9): сумма внутри самой заявки должна сходиться с нетто+НДС.
  // На живом черновике #14 было: amount 5 654, а net+vat = 545 000 — карточка
  // показывала брутто 5 654 ₽ при НДС 98 278,68 ₽ (в 17 раз больше суммы) и
  // считалась «заполненной». Такое нельзя выпускать в платёжку молча.
  const g = Number(pay.amount), n = Number(pay.amount_net), v = Number(pay.vat_amount);
  if (Number.isFinite(g) && g > 0 && Number.isFinite(n) && n > 0
    && Math.abs(g - (n + (Number.isFinite(v) ? v : 0))) >= 0.02) {
    reasons.push('amount_mismatch');
  }
  // Объект нужен только расходам по работам (как calcIncomplete
  // doc-registry.js:180-183). Складу и «прочему» объект не нужен.
  if (spendKind === 'work' && !pay.work_id) reasons.push('no_work_for_expense');
  return reasons;
}

/**
 * D-369: единый перенос полей заявки в УЖЕ СУЩЕСТВУЮЩУЮ строку реестра.
 *
 * Зачем отдельной функцией: `ensureRegistryDoc` находит готовую строку тремя
 * разными способами, и раньше поля переносились только при создании новой.
 * Теперь все три ветки «уже есть» вызывают этот код.
 *
 * Правила:
 *   • `spend_kind` и `work_id` — только если в заявке они заполнены. Если
 *     пользователь явно выбрал вид расхода, его выбор главнее того, что стоит
 *     в реестре (часто там дефолтное 'work' от NOT NULL DEFAULT).
 *   • Сроки и основание СФ — через COALESCE: уже проставленное вручную не
 *     перетираем.
 *   • Номер, дата, НДС, нетто — заполняем только пустые: ручная правка в реестре
 *     не должна затираться согласованием.
 *   • Метку `no_work_for_expense` снимаем, если объект есть или расход не по
 *     работам; ставим — только для работ без объекта.
 */
async function applyInvoiceFields(db, pay, docId) {
  if (!docId || !pay) return;
  try {
    const sk = String(pay.spend_kind || '');
    const spendKind = ['work', 'warehouse', 'office', 'other'].includes(sk) ? sk : null;
    // D-369 (раунд 8): если в заявке заполнена только сумма, а нетто/НДС пустые,
    // надо РАЗЛОЖИТЬ её по ставке. Иначе карточка получала противоречивый набор:
    // gross 50 000, vat 0, has_vat false, но vat_rate 22 % — и метки неполноты нет.
    // Бухгалтер видел ставку и нулевой НДС, вычет принять нельзя.
    const rateFracCalc = toRegistryVatRate(pay.vat_rate);
    // D-369 (раунд 12): единый расчёт — та же функция, что в ветке создания.
    // Раньше здесь была копия, и она при НДС больше суммы давала ОТРИЦАТЕЛЬНОЕ
    // нетто (-92 624,68 при сумме 5 654 и НДС 98 278,68): CHECK на неотрицательность
    // в doc_registry нет, значение записалось бы.
    const calc = splitInvoiceAmounts(pay);
    const grossForSplit = calc.gross;
    // Передаём в SQL только то, что реально пересчитано: если сумма из заявки
    // совпадает с уже посчитанными нетто/НДС, ничего не меняем (ручное главнее).
    const payVat = Math.max(0, Number(pay.vat_amount) || 0);
    const payNet = Math.max(0, Number(pay.amount_net) || 0);
    const needNet = grossForSplit > 0 && calc.net > 0
      && (payNet === 0 || calc.miscalc
        || (calc.vat > 0 && payVat === 0 && Math.abs(payNet - grossForSplit) < 0.02));
    const needVat = grossForSplit > 0
      && (calc.miscalc || (calc.vat > 0
        && (payVat === 0 || (payNet === 0 && payVat > 0 && Math.abs(payVat - calc.vat) > 0.02))));    const netFromRate = needNet ? calc.net : null;
    const vatFromRate = needVat ? calc.vat : null;

    await db.query(
      `UPDATE doc_registry d
          SET spend_kind      = COALESCE($2, d.spend_kind),
              work_id         = COALESCE(d.work_id, $3),
              sf_due_at       = COALESCE(d.sf_due_at, $4::date),
              service_done_at = COALESCE(d.service_done_at, $5::date),
              sf_basis        = COALESCE(NULLIF(d.sf_basis,''), $6),
              invoice_number  = COALESCE(NULLIF(d.invoice_number,''), $7),
              invoice_date    = COALESCE(d.invoice_date, $8::date),
              -- D-369 (раунды 5-6): БРУТТО-СУММА переносится, но ТОЛЬКО КОГДА
              -- её нельзя потерять.
              --
              -- История. Сначала сумма не переносилась вовсе → карточка
              -- отставала от заявки. Потом сделали перенос при любом раскладе —
              -- и это оказалось ХУЖЕ: на живом счёте #19 в заявке поле amount
              -- содержал НЕТТО (114 737,70), а в карточке правильно лежало
              -- брутто (139 980,00). Безусловная перезапись занижала документ
              -- на 25 242,30 ₽ — ровно на сумму НДС — и бухгалтерия получила бы
              -- неверную платёжку.
              --
              -- Итоговое правило (раунд 7, самое консервативное): заполняем сумму
              -- ТОЛЬКО если в карточке её нет (0). Заполненную сумму НЕ ТРОГАЕМ
              -- никогда — ни вверх, ни вниз.
              --
              -- Почему так. Проверка «amount = net + vat» не спасает: на #19
              -- запись заявки ВНУТРЕННЕ СОГЛАСОВАНА (114 737,70 = 89 495,40 +
              -- 25 242,30), просто OCR положил туда НЕТТО как сумму к оплате.
              -- Отличить это от корректного брутто по полям невозможно.
              --
              -- Карточка реестра — то, по чему бухгалтерия платит; её сумму
              -- правит человек. Поэтому заявка может только ЗАПОЛНИТЬ пустое.
              -- Расхождение не теряется: оно видно как причина amount_mismatch
              -- в метках строки (см. ниже), а не молчаливая перезапись.
              amount_gross    = CASE WHEN COALESCE(d.amount_gross,0) = 0
                                     THEN COALESCE($14::numeric, d.amount_gross) ELSE d.amount_gross END,
              amount_net      = CASE WHEN COALESCE(d.amount_gross,0) = 0
                                          OR (COALESCE(d.amount_net,0) IN (0, d.amount_gross)
                                              AND COALESCE(d.vat_amount,0) < d.amount_gross
                                              AND d.amount_gross > 0)
                                     THEN CASE WHEN $15::numeric IS NOT NULL THEN $15::numeric
                                               ELSE COALESCE($10::numeric, d.amount_net) END
                                     ELSE d.amount_net END,
              vat_amount      = CASE WHEN COALESCE(d.amount_gross,0) = 0
                                          OR (COALESCE(d.amount_net,0) IN (0, d.amount_gross)
                                              AND COALESCE(d.vat_amount,0) < d.amount_gross
                                              AND d.amount_gross > 0)
                                     THEN CASE WHEN $16::numeric IS NOT NULL THEN $16::numeric
                                               ELSE COALESCE($9::numeric, d.vat_amount) END
                                     ELSE d.vat_amount END,
              -- D-369: ставку НДС тоже переносим. Раньше ветки «уже есть строка»
              -- её не трогали: НДС-сумма есть, ставки нет — противоречивая карточка.
              -- D-377 (24.10.2026): при создании карточки vat_rate по умолчанию
              -- 0.22, поэтому условие «= 0» никогда не срабатывало и верная
              -- ставка не записывалась: у #1592/#1607 суммы посчитаны по 5 %,
              -- а в реестре стояло 22 % (Doc Hub показывал неверный НДС).
              -- Теперь правим ставку, когда она ПРОТИВОРЕЧИТ собственным суммам
              -- документа, а пришедшая ставка с ними сходится. Ручную правку,
              -- которая с суммами согласуется, не трогаем.
              vat_rate        = CASE
                                    WHEN COALESCE(d.vat_rate,0) = 0 AND $11::numeric > 0 THEN $11::numeric
                                    WHEN COALESCE(d.amount_net,0) > 0 AND COALESCE(d.vat_amount,0) > 0
                                         AND ABS(COALESCE(d.vat_amount,0) / d.amount_net - COALESCE(d.vat_rate,0)) > 0.01
                                         AND ABS(COALESCE(d.vat_amount,0) / d.amount_net - $11::numeric) <= 0.01
                                         THEN $11::numeric
                                    ELSE d.vat_rate
                                  END,
              -- D-369 (раунд 11): флаг НДС ставим ТОЛЬКО когда сумма НДС реально
              -- есть. Было: флаг переключался, а vat_amount не заполнялась
              -- (её ветка требовала ещё и net = 0) → карточка #1598 имела
              -- has_vat=true при vat_amount=0, и Doc Hub дорисовывал 14 409,10 ₽
              -- НДС, которых в базе нет.
              has_vat         = CASE
                                    WHEN COALESCE(d.vat_amount,0) > 0 THEN d.has_vat
                                    WHEN $17::boolean THEN false
                                    WHEN COALESCE($9::numeric,0) > 0 THEN true
                                    WHEN COALESCE($16::numeric,0) > 0 THEN true
                                    ELSE d.has_vat
                                  END,
              counterparty_inn= COALESCE(NULLIF(d.counterparty_inn,''), $12),
              comment_text    = CASE WHEN COALESCE(TRIM(d.comment_text),'') = '' THEN $13 ELSE d.comment_text END,
              updated_at      = NOW()
        WHERE d.id = $1 AND d.deleted_at IS NULL`,
      [docId, spendKind, pay.work_id || null,
        pay.sf_due_at || null, pay.service_done_at || null,
        ['invoice', 'service'].includes(String(pay.sf_basis || '')) ? pay.sf_basis : null,
        pay.invoice_number || null, pay.invoice_date || null,
        pay.vat_amount != null ? Number(pay.vat_amount) : null,
        pay.amount_net != null ? Number(pay.amount_net) : null,
        // В реестре ставка — ДОЛИ (0.22), в заявке — ПРОЦЕНТЫ (22).
        toRegistryVatRate(pay.vat_rate),
        pay.counterparty_inn || null,
        pay.comment_text || null,
        // $14 = сумма из заявки. Перезаписываем карточку ТОЛЬКО когда там 0:
        // на #19 в заявке лежало нетто (114 737,70), а в карточке верное брутто
        // (139 980,00) — перезапись занизила бы платёжку на 25 242,30 ₽.
        pay.amount != null ? Number(pay.amount) : 0,
        // $15/$16 — нетто и НДС, вычисленные из суммы по ставке. Применяются,
        // только если в заявке эти поля не заполнены. Мастера шлют ЯВНЫЕ нули
        // (recalcVat(0,22) = {vat:0, net:0}), поэтому в SQL стоит
        // «if $15 is not null then $15 else coalesce($10, ...)»: считаем, что
        // 0 — это «не заполнено», иначе НДС оставался бы нулевым при ставке 22 %.
        netFromRate,
        vatFromRate,
        // $17 — «данные битые» (НДС ≥ суммы). Тогда НДС не пишем и флаг не ставим:
        // иначе карточка = «сумма 5 654, НДС 0, has_vat=true» и Doc Hub дорисует
        // НДС, которого нет.
        calc.miscalc]
    );

    // Причины «неполноты» пересчитываются ПО ФАКТУ после переноса. Раньше
    // снималась только метка «нужен объект», а «нет номера счёта» оставалась
    // даже когда номер только что перенесли. Читаем фактическое состояние
    // строки: там может быть проставлено вручную, и это главнее.
    const row = (await db.query(
      `SELECT invoice_number, invoice_date, amount_gross, amount_net, vat_amount,
              work_id, spend_kind,
              COALESCE(purpose_asgard,false) AS purpose_asgard,
              COALESCE(purpose_consumables,false) AS purpose_consumables,
              COALESCE(incomplete_reasons,'{}'::text[]) AS incomplete_reasons
         FROM doc_registry WHERE id=$1`, [docId])).rows[0];
    if (!row) return;

    // D-369 (раунд 7): сумму карточки НЕ перезаписываем (см. комментарий в SET).
    // Но расхождение с заявкой не должно теряться: на #19 в заявке 114 737,70
    // (нетто из OCR), а в карточке 139 980,00 (брутто из строки «Всего на сумму»).
    // Молчаливая перезапись занизила бы платёжку на 25 242,30 ₽. Вместо этого
    // помечаем строку причиной amount_mismatch — бухгалтер сверит и решит.
    const payAmount = Number(pay.amount);
    const docAmount = Number(row.amount_gross);
    const mismatch = Number.isFinite(payAmount) && payAmount > 0
      && Number.isFinite(docAmount) && docAmount > 0
      && Math.abs(payAmount - docAmount) >= 0.02;

    const effKind = spendKind || row.spend_kind || 'other';
    // Единая функция: та же, что в ветке создания. Раньше здесь была КОПИЯ
    // условий — два источника правды, которые неизбежно расходятся (именно так
    // возник дефект с ложной меткой).
    const reasons = computeInvoiceReasons(
      { invoice_number: row.invoice_number, invoice_date: row.invoice_date,
        amount: row.amount_gross, work_id: row.work_id }, effKind);

    // D-369 (раунд 10): проверяем, что в САМОЙ карточке сумма сходится с net+vat.
    // На #14 было: брутто 5 654 при НДС 98 278,68 (в 17 раз больше суммы).
    // Отдельно ловим «отравленный» случай gross > 0, а net = 0 и vat = 0:
    // раньше условие требовало cn > 0, поэтому такая строка молчала — сумма
    // есть, ставка 22 %, а НДС к вычету не выделен.
    const cg = Number(row.amount_gross), cn = Number(row.amount_net) || 0, cv = Number(row.vat_amount) || 0;
    const cardMismatch = Number.isFinite(cg) && cg > 0
      && Math.abs(cg - (cn + cv)) >= 0.02;
    if (cardMismatch && !reasons.includes('amount_mismatch')) reasons.push('amount_mismatch');

    // purpose_* — явное назначение расхода: объект для них не нужен.
    const filtered = reasons.filter((r) => !(r === 'no_work_for_expense'
      && (row.purpose_asgard || row.purpose_consumables)));

    // Причины, которые ставит не этот код (ошибки разбора, кривой контрагент,
    // ручные пометки), не теряем — убираем только те, что пересчитали сами.
    const OWNED = ['no_invoice_number', 'no_invoice_date', 'no_amount', 'no_work_for_expense',
      'amount_mismatch'];
    const foreign = (row.incomplete_reasons || []).filter((r) => !OWNED.includes(r));
    // Расхождение суммы с заявкой — повод сверить, а не «ошибка». Ставим метку,
    // чтобы разница была видна в реестре, а не всплыла в платёжке.
    if (mismatch) filtered.push('amount_mismatch');
    const all = [...new Set([...foreign, ...filtered])];

    await db.query(
      `UPDATE doc_registry SET incomplete_reasons=$2::text[], is_incomplete=$3, updated_at=NOW()
        WHERE id=$1`, [docId, all, all.length > 0]);
  } catch (e) {
    console.error('[payment-mail] applyInvoiceFields failed:', e.message);
  }
}

async function applyBatchDecision(db, payments, batch, action, actor) {
  const act = String(action || '').toLowerCase();
  if (act !== 'approve' && act !== 'reject') {
    throw Object.assign(new Error('action: approve|reject'), { statusCode: 400 });
  }
  const results = [];
  for (const pay of payments) {
    if (pay.status === 'awaiting_dir') {
      results.push(await applyDecision(db, pay, act, actor));
    } else {
      results.push({ ok: true, already: true, status: pay.status, payment_id: pay.id });
    }
  }
  await db.query(
    `UPDATE payment_mail_batches SET used_at=NOW(), used_action=$2 WHERE id=$1 AND used_at IS NULL`,
    [batch.id, act]
  );
  return {
    ok: true,
    batch: true,
    count: payments.length,
    status: act === 'approve' ? 'pending_payment' : 'rejected',
    results
  };
}

module.exports = {
  isLivePaymentMail,
  resolvePaymentMailTo,
  lookupToken,
  sendDirectorMail,
  sendDirectorMailBatch,
  applyDecision,
  applyBatchDecision,
  ensureRegistryDoc,
  applyInvoiceFields,
  landingMessageHtml,
  landingActionHtml,
  landingBatchActionHtml,
  // Точки расширения для писем-согласований других модулей (напр. отпуска).
  wrapEmail,
  ctaButtons,
  ctaButtonsDual,
  // D-302: дайджест Doc Hub собирает абсолютную ссылку тем же базовым URL,
  // что и письма-согласования. Без экспорта падало с «publicBaseUrl is not
  // a function» — рассылка не уходила вовсе.
  publicBaseUrl,
  createToken,
  createBatchToken,
  buildAttachment,
  uploadFsPath,
  normalizeUploadUrl
};
