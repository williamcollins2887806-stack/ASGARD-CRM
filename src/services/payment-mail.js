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

function isProdRuntime() {
  return process.env.NODE_ENV === 'production' && dbName() === 'asgard_crm';
}

function isLivePaymentMail() {
  if (process.env.PAYMENT_MAIL_DISABLED === '1') return false;
  if (process.env.PAYMENT_MAIL_FORCE === '1') return true;
  return isProdRuntime();
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

function wrapEmail(title, inner) {
  return `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef1f6;font-family:Arial,Helvetica,sans-serif;color:#1b2a4a;">
  <div style="max-width:560px;margin:0 auto;padding:20px 16px 40px;">
    <div style="background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 8px 24px rgba(27,42,74,.08);">
      <div style="background:#1b2a4a;color:#fff;padding:18px 20px;">
        <div style="font-size:12px;letter-spacing:.08em;color:#c9a227;font-weight:700;">АСГАРД · ОПЛАТА</div>
        <div style="font-size:18px;font-weight:700;margin-top:4px;">${esc(title)}</div>
      </div>
      <div style="padding:22px 20px 26px;">
        ${inner}
      </div>
    </div>
    <p style="text-align:center;font-size:12px;color:#6b7280;margin-top:14px;line-height:1.45;">
      Вход в CRM не нужен. Решение — кнопки Согласовать / Отказать. Счёт во вложении письма.
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
  const toRes = to ? { ok: true, email: to } : resolvePaymentMailTo();
  if (!toRes.ok) {
    return { sent: false, dry_run: true, reason: toRes.reason, link, email_preview: html, ...meta };
  }
  if (!isLivePaymentMail()) {
    return {
      sent: false,
      dry_run: true,
      link,
      to: toRes.email,
      email_preview: html,
      attachment_names: (attachments || []).map(a => a.filename),
      ...meta
    };
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
  landingMessageHtml,
  landingActionHtml,
  landingBatchActionHtml,
  createToken,
  createBatchToken,
  buildAttachment,
  uploadFsPath,
  normalizeUploadUrl
};
