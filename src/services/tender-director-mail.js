'use strict';

/**
 * Email директору по просчёту тендера (паттерн payment-mail).
 * Согласовать / Отказать + cloud файлов без CRM.
 * Live SMTP: prod или TENDER_MAIL_FORCE=1.
 * Non-prod: TENDER_MAIL_TO / PAYMENT_MAIL_TO (Андросов).
 */

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { sendCrmEmail } = require('./crm-mailer');
const { recalcAsgardSmeta } = require('./asgard-smeta');
const { uploadFsPath } = require('../utils/upload-url');

const TOKEN_TTL_HOURS = 72;
const PROD_DIRECTOR_BLOCKLIST = [
  'go@asgard-service.com',
  'gazhiliev@asgard-service.com'
];

// Адресное согласование: ровно 4 допустимых получателя. Достаточно согласия любого одного.
const APPROVAL_RECIPIENT_DEFS = {
  DIRECTOR_GEN:  { label: 'Генеральный директор',            role: 'DIRECTOR_GEN',  preferName: null },
  DIRECTOR_DEV:  { label: 'Директор по развитию',            role: 'DIRECTOR_DEV',  preferName: null },
  DIRECTOR_COMM: { label: 'Коммерческий директор',           role: 'DIRECTOR_COMM', preferName: null },
  HEAD_TO:       { label: 'Руководитель тендерного отдела',  role: 'HEAD_TO',       preferName: 'Хосе' }
};
const DEFAULT_APPROVAL_RECIPIENTS = ['DIRECTOR_GEN'];

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

function isLiveMail() {
  if (process.env.TENDER_MAIL_DISABLED === '1') return false;
  if (process.env.TENDER_MAIL_FORCE === '1' || process.env.PAYMENT_MAIL_FORCE === '1') return true;
  return isProdRuntime();
}

function resolveMailTo() {
  const raw = String(
    process.env.TENDER_MAIL_TO || process.env.PAYMENT_MAIL_TO || ''
  ).trim().toLowerCase();
  if (!isProdRuntime()) {
    if (!raw) return { ok: false, reason: 'TENDER_MAIL_TO_required_non_prod' };
    if (PROD_DIRECTOR_BLOCKLIST.includes(raw)) {
      return { ok: false, reason: 'director_blocked_in_non_prod', email: raw };
    }
    return { ok: true, email: raw };
  }
  if (raw) return { ok: true, email: raw };
  return { ok: true, email: 'go@asgard-service.com' };
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtRub(n) {
  return Math.round(Number(n) || 0).toLocaleString('ru-RU') + ' ₽';
}

function fmtDate(v) {
  if (!v) return '—';
  const s = String(v).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : s;
}

function hashToken(raw) {
  return crypto.createHash('sha256').update(String(raw), 'utf8').digest('hex');
}

function normalizeRecipientCodes(raw) {
  if (!Array.isArray(raw)) return DEFAULT_APPROVAL_RECIPIENTS.slice();
  const out = [];
  for (const item of raw) {
    const code = String(item || '').trim().toUpperCase();
    if (APPROVAL_RECIPIENT_DEFS[code] && !out.includes(code)) out.push(code);
  }
  return out.length ? out : DEFAULT_APPROVAL_RECIPIENTS.slice();
}

/** Резолв реального пользователя-получателя по коду роли (для HEAD_TO — приоритет по имени «Хосе»). */
async function resolveRecipientUser(db, code) {
  const def = APPROVAL_RECIPIENT_DEFS[code];
  if (!def) return null;

  async function pick(preferName) {
    const params = [def.role];
    let nameClause = '';
    if (preferName) {
      params.push('%' + preferName + '%');
      nameClause = 'AND u.name ILIKE $2';
    }
    const r = await db.query(`
      SELECT u.id, u.name, u.email
      FROM users u
      WHERE u.role = $1
        AND COALESCE(u.is_active, true) = true
        AND u.email IS NOT NULL AND TRIM(u.email) <> ''
        ${nameClause}
      ORDER BY ${preferName ? 'u.name' : 'u.id'}
      LIMIT 1
    `, params);
    return r.rows[0] || null;
  }

  if (def.preferName) {
    const preferred = await pick(def.preferName);
    if (preferred) return preferred;
  }
  return pick(null);
}

/** Готовит получателей: резолвит людей и генерирует токены. */
async function prepareApprovalRecipients(db, codes) {
  const out = [];
  for (const code of codes) {
    const def = APPROVAL_RECIPIENT_DEFS[code];
    const user = await resolveRecipientUser(db, code);
    out.push({
      code,
      label: def.label,
      user: user || null,
      email: user ? user.email : null,
      raw: user ? crypto.randomBytes(24).toString('hex') : null
    });
  }
  return out;
}

/** Перезаписывает список получателей тендера (старые pending удаляются). */
async function saveApprovalRecipients(db, tenderId, prepared) {
  await db.query(`DELETE FROM tender_approval_recipients WHERE tender_id = $1`, [tenderId]);
  const saved = [];
  for (const p of prepared) {
    if (!p.user) continue;
    const r = await db.query(`
      INSERT INTO tender_approval_recipients
        (tender_id, role_code, user_id, label, email, token_hash, status, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW() + ($7 || ' hours')::interval)
      RETURNING *
    `, [tenderId, p.code, p.user.id, p.label, p.email, hashToken(p.raw), String(TOKEN_TTL_HOURS)]);
    saved.push({ ...r.rows[0], raw: p.raw });
  }
  return saved;
}

async function loadApprovalRecipients(db, tenderId) {
  const r = await db.query(`
    SELECT id, tender_id, role_code, user_id, label, email, status, decided_at, decided_comment, created_at
    FROM tender_approval_recipients
    WHERE tender_id = $1
    ORDER BY id
  `, [tenderId]);
  return r.rows;
}

function parseRj(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}'); } catch (_) { return {}; }
}

function ensureEstimate(raw) {
  const base = raw && typeof raw === 'object' ? raw : {};
  try {
    return recalcAsgardSmeta({
      template: 'asgard_v1',
      meta: base.meta || {},
      params: base.params || {},
      rows: Array.isArray(base.rows) && base.rows.length ? base.rows : undefined
    });
  } catch (_) {
    return recalcAsgardSmeta({ template: 'asgard_v1' });
  }
}

function renderSmetaTableHtml(estimate) {
  const est = ensureEstimate(estimate);
  const rows = est.rows || [];
  let body = '';
  let pendingSection = null;
  let sectionHasLines = false;

  function flushSection() {
    if (pendingSection && sectionHasLines) body += pendingSection;
    pendingSection = null;
    sectionHasLines = false;
  }

  for (const r of rows) {
    if (r.kind === 'section') {
      flushSection();
      pendingSection = `<tr style="background:#1b2a4a;color:#fff"><td colspan="6" style="padding:9px 10px;font-weight:700;font-size:12px;letter-spacing:.04em">${esc(r.name)}</td></tr>`;
      continue;
    }
    if (r.kind === 'line') {
      const sum = Number(r.sum) || 0;
      if (!(sum > 0)) continue;
      if (pendingSection) {
        body += pendingSection;
        pendingSection = null;
      }
      sectionHasLines = true;
      body += `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #eef1f6;font-size:12px;color:#6b7280">${esc(r.code || '')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eef1f6;font-size:13px">${esc(r.name || '')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eef1f6;font-size:12px;color:#6b7280">${esc(r.unit || '')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eef1f6;font-size:13px;text-align:right">${esc(String(r.qty != null ? r.qty : ''))}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eef1f6;font-size:13px;text-align:right">${esc(r.price != null ? Math.round(r.price).toLocaleString('ru-RU') : '')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eef1f6;font-size:13px;text-align:right;font-weight:700">${esc(fmtRub(sum))}</td>
      </tr>`;
      continue;
    }
    if (r.kind === 'subtotal' || r.kind === 'rollup') {
      if (r.kind === 'subtotal' && !sectionHasLines && !(Number(r.sum) > 0)) continue;
      flushSection();
      const heavy = /СЕБЕСТОИМОСТЬ|ЦЕНА ЗАКАЗЧИКУ|ПРЯМЫЕ|Цена без НДС/.test(r.name || '');
      body += `<tr style="background:${heavy ? '#faf6e8' : '#f8fafc'}">
        <td colspan="5" style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:13px;font-weight:${heavy ? 800 : 700};text-align:right">${esc(r.name)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:right;font-weight:800;color:${heavy ? '#a8862e' : '#1b2a4a'}">${esc(fmtRub(r.sum))}</td>
      </tr>`;
    }
  }
  flushSection();

  return `<table style="width:100%;border-collapse:collapse;margin:8px 0 4px">
    <thead><tr style="background:#f8fafc">
      <th style="text-align:left;padding:8px 10px;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb">Код</th>
      <th style="text-align:left;padding:8px 10px;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb">Статья</th>
      <th style="text-align:left;padding:8px 10px;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb">Ед.</th>
      <th style="text-align:right;padding:8px 10px;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb">Кол-во</th>
      <th style="text-align:right;padding:8px 10px;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb">Цена, ₽</th>
      <th style="text-align:right;padding:8px 10px;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb">Сумма</th>
    </tr></thead><tbody>${body}</tbody></table>`;
}

function textBlock(label, value) {
  const v = String(value || '').trim();
  if (!v) return '';
  return `<div style="margin:0 0 12px">
    <div style="font-size:11px;color:#6b7280;font-weight:700;letter-spacing:.04em;text-transform:uppercase;margin-bottom:4px">${esc(label)}</div>
    <div style="font-size:14px;line-height:1.5;white-space:pre-wrap">${esc(v)}</div>
  </div>`;
}

function buildEmailHtml({ tender, review, estimate, decideUrl, filesUrl, files, pmName, expectedFrom, recipientLabel }) {
  const rj = parseRj(review?.report_json);
  const est = ensureEstimate(estimate || rj.asgard_smeta);
  const t = est.totals || {};
  const title = tender.tender_title || 'Просчёт по тендеру';
  const when = [fmtDate(tender.work_start_plan || tender.work_start || tender.docs_deadline), fmtDate(tender.work_end)]
    .filter((x) => x && x !== '—').join(' — ')
    || (est.meta && est.meta.work_schedule) || fmtDate(tender.docs_deadline) || '—';
  const where = tender.object_name || tender.city || tender.region
    || (est.meta && est.meta.object) || '—';
  const priceWithVat = t.price_with_vat != null ? t.price_with_vat : review?.work_price;
  const who = pmName || review?.calculator_name || review?.finalized_by_name || 'РП';
  const decisionUntil = tender.docs_deadline
    ? `${fmtDate(tender.docs_deadline)} (дедлайн подачи документации)`
    : '72 часа с момента письма';
  const actionNeeded = rj.director_action || rj.action_needed
    || 'Согласовать цену просчёта и решение о подаче тендера.';
  const workDesc = rj.summary || rj.work_description || (est.meta && est.meta.title) || title;
  const rpComment = rj.recommendation || rj.rp_comment || rj.comment || '';

  const fileList = Array.isArray(files) ? files : [];
  const rpFiles = fileList.filter((f) => /estimate|tkp|report|просч|ткп|отчёт|отчет|смет/i.test(String(f.kind || f.kind_label || f.name || '')));
  const tenderFiles = fileList.filter((f) => !rpFiles.includes(f));
  const filesMini = (list, empty) => {
    if (!list.length) return `<div style="font-size:13px;color:#6b7280">${esc(empty)}</div>`;
    return list.map((f) => `<div style="font-size:13px;padding:4px 0;border-bottom:1px solid #eef1f6">📎 ${esc(f.name || f.original_name || 'файл')}${f.kind_label || f.kind ? ` <span style="color:#6b7280">· ${esc(f.kind_label || f.kind)}</span>` : ''}</div>`).join('');
  };

  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Просчёт</title></head>
<body style="margin:0;padding:0;background:#eef1f6;font-family:Arial,Helvetica,sans-serif;color:#1b2a4a;">
<div style="max-width:680px;margin:0 auto;padding:20px 16px 40px;">
  <div style="background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 8px 24px rgba(27,42,74,.08);">
    <div style="background:#1b2a4a;color:#fff;padding:20px 22px;">
      <div style="font-size:12px;letter-spacing:.08em;color:#c9a227;font-weight:700;">АСГАРД · ПРОСЧЁТ НА СОГЛАСОВАНИЕ</div>
      <div style="font-size:19px;font-weight:700;margin-top:6px;line-height:1.3">${esc(title)}</div>
      ${recipientLabel ? `<div style="margin-top:10px;font-size:14px;color:#e8eefc">Здравствуйте, ${esc(recipientLabel)}.</div>` : ''}
      <div style="margin-top:12px;display:inline-block;background:rgba(201,162,39,.2);border:1px solid rgba(201,162,39,.45);color:#f5e6b0;padding:6px 12px;border-radius:8px;font-size:13px;font-weight:700">Решить до: ${esc(decisionUntil)}</div>
    </div>
    <div style="padding:22px 22px 28px;">
      <div style="padding:14px 16px;background:#fff8e6;border:1px solid #f0d78c;border-radius:10px;margin-bottom:16px">
        <div style="font-size:11px;font-weight:800;letter-spacing:.05em;color:#8a6d1a;text-transform:uppercase;margin-bottom:6px">Что нужно сделать</div>
        <div style="font-size:15px;line-height:1.45;font-weight:600">${esc(actionNeeded)}</div>
        ${expectedFrom ? `<div style="font-size:13px;color:#5c4a00;margin-top:10px;padding-top:10px;border-top:1px solid #f0d78c"><b>Согласование ожидается от:</b> ${esc(expectedFrom)}</div>` : ''}
        <div style="font-size:12px;color:#8a6d1a;margin-top:8px">Ссылка на решение действует 72 часа.</div>
      </div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:14px;font-size:14px">
        <tr><td style="padding:6px 0;color:#6b7280;width:120px">Заказчик</td><td style="padding:6px 0;font-weight:700">${esc(tender.customer_name || (est.meta && est.meta.customer) || '—')}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">№</td><td style="padding:6px 0;font-weight:700">${esc(tender.registry_no || tender.id || '—')}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">Когда</td><td style="padding:6px 0;font-weight:700">${esc(when)}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">Где</td><td style="padding:6px 0;font-weight:700">${esc(where)}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">Считал</td><td style="padding:6px 0;font-weight:700">${esc(who)}</td></tr>
      </table>
      ${textBlock('Описание работ', workDesc)}
      ${textBlock('Комментарий РП', rpComment)}
      <div style="font-size:13px;font-weight:800;color:#1b2a4a;margin:18px 0 6px;letter-spacing:.04em">СМЕТА</div>
      ${renderSmetaTableHtml(est)}
      <div style="margin:18px 0 8px;padding:16px 18px;background:linear-gradient(180deg,#faf6e8,#f8fafc);border-radius:12px;border:1px solid #e8dfc0">
        <div style="font-size:11px;color:#8a6d1a;margin-bottom:8px;font-weight:800;letter-spacing:.05em;text-transform:uppercase">Итоги для решения</div>
        <div style="font-size:14px;margin:4px 0">Себестоимость без НДС: <b>${esc(fmtRub(t.cost))}</b></div>
        <div style="font-size:14px;margin:4px 0">Цена без НДС: <b>${esc(fmtRub(t.price_no_vat))}</b></div>
        <div style="font-size:26px;font-weight:800;margin-top:10px;color:#1b2a4a;letter-spacing:-.02em">С НДС: ${esc(fmtRub(priceWithVat))}</div>
      </div>
      <a href="${esc(decideUrl)}" style="display:block;background:#15803d;color:#fff;text-decoration:none;text-align:center;padding:16px 18px;border-radius:12px;font-weight:800;font-size:17px;margin:20px 0 10px;">Согласовать</a>
      <a href="${esc(decideUrl)}" style="display:block;background:#b91c1c;color:#fff;text-decoration:none;text-align:center;padding:16px 18px;border-radius:12px;font-weight:800;font-size:17px;">Отказать</a>
      <a href="${esc(filesUrl)}" style="display:block;background:#1b2a4a;color:#fff;text-decoration:none;text-align:center;padding:18px 18px;border-radius:12px;font-weight:800;font-size:17px;margin:18px 0 8px;">Файлы тендера и просчёта</a>
      <div style="margin-top:14px;padding:12px 14px;background:#f8fafc;border-radius:10px;border:1px solid #e5e7eb">
        <div style="font-size:12px;font-weight:800;color:#1b2a4a;margin-bottom:6px">Файлы РП (просчёт)</div>
        ${filesMini(rpFiles, 'Пока не прикреплены')}
        <div style="font-size:12px;font-weight:800;color:#1b2a4a;margin:12px 0 6px">Файлы тендера</div>
        ${filesMini(tenderFiles, 'См. по кнопке выше')}
      </div>
      <p style="font-size:12px;color:#6b7280;margin:16px 0 0;line-height:1.45">Ссылка действует ${TOKEN_TTL_HOURS} ч.</p>
    </div>
  </div>
</div></body></html>`;
}

function landingShell(title, inner) {
  return `<!DOCTYPE html>
<html lang="ru"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
  body{margin:0;background:#eef1f6;font-family:Arial,Helvetica,sans-serif;color:#1b2a4a;}
  .wrap{max-width:560px;margin:0 auto;padding:20px 16px 40px;}
  .card{background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 8px 24px rgba(27,42,74,.08);}
  .hd{background:#1b2a4a;color:#fff;padding:18px 20px;}
  .hd .k{font-size:12px;letter-spacing:.08em;color:#c9a227;font-weight:700;}
  .bd{padding:22px 20px 26px;}
  .amt{font-size:28px;font-weight:800;margin:4px 0 16px;}
  .row{font-size:15px;margin:8px 0;line-height:1.4;}
  .lbl{color:#6b7280;display:inline-block;min-width:110px;}
  .btn{display:block;width:100%;box-sizing:border-box;border:0;border-radius:10px;padding:14px 16px;font-size:16px;font-weight:700;color:#fff;margin:8px 0;cursor:pointer;}
  .ok{background:#15803d;} .no{background:#b91c1c;}
  .muted{color:#6b7280;font-size:13px;line-height:1.45;margin-top:16px;}
  .banner{padding:12px 14px;border-radius:8px;margin-bottom:14px;font-size:14px;}
  .warn{background:#fff8e6;color:#5c4a00;} .err{background:#fef2f2;color:#991b1b;} .okb{background:#ecfdf5;color:#065f46;}
  .file{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border:1px solid #e5e7eb;border-radius:10px;margin:8px 0;background:#f8fafc;}
  .file a{color:#1b2a4a;font-weight:700;text-decoration:none;}
  textarea{width:100%;box-sizing:border-box;min-height:72px;border:1px solid #e5e7eb;border-radius:8px;padding:10px;font:inherit;margin:8px 0;}
</style>
</head>
<body><div class="wrap"><div class="card">
  <div class="hd"><div class="k">АСГАРД · ПРОСЧЁТ</div><div style="font-size:18px;font-weight:700;margin-top:4px;">${esc(title)}</div></div>
  <div class="bd">${inner}</div>
</div></div></body></html>`;
}

function landingMessageHtml(title, msg, tone) {
  const cls = tone === 'ok' ? 'okb' : (tone === 'warn' ? 'warn' : 'err');
  return landingShell(title, `<div class="banner ${cls}">${esc(msg)}</div>`);
}

function landingActionHtml(tender, review, rawToken, recipientLabel, expectedFrom) {
  const rj = parseRj(review.report_json);
  const est = ensureEstimate(rj.asgard_smeta);
  const price = review.work_price != null ? review.work_price : est.totals?.price_with_vat;
  return landingShell('Решение по просчёту', `
    <div class="muted" style="margin-top:0;">Цена заказчику с НДС</div>
    <div class="amt">${esc(fmtRub(price))}</div>
    <div class="row"><span class="lbl">Тендер</span> <b>#${esc(tender.registry_no || tender.id)}</b></div>
    <div class="row"><span class="lbl">Заказчик</span> <b>${esc(tender.customer_name || '—')}</b></div>
    <div class="row"><span class="lbl">Работа</span> ${esc(tender.tender_title || '—')}</div>
    <div class="row"><span class="lbl">Дедлайн</span> ${esc(fmtDate(tender.docs_deadline))}</div>
    ${recipientLabel ? `<div class="row"><span class="lbl">Получатель</span> <b>${esc(recipientLabel)}</b></div>` : ''}
    ${expectedFrom ? `<div class="row"><span class="lbl">Ждём согласие</span> ${esc(expectedFrom)}</div>` : ''}
    <div class="row muted" style="margin:14px 0 0">Достаточно согласия любого из получателей — тендер сразу перейдёт в работу.</div>
    <label class="muted" for="rejComment">Комментарий (обязателен при отказе)</label>
    <textarea id="rejComment" placeholder="Причина отказа…"></textarea>
    <button class="btn ok" type="button" onclick="decide('approve')">Согласовать</button>
    <button class="btn no" type="button" onclick="decide('reject')">Отказать</button>
    <p class="muted">Вход в CRM не нужен. Ссылка действует ${TOKEN_TTL_HOURS} ч.</p>
    <script>
      function decide(action){
        var btns=document.querySelectorAll('button');
        for(var i=0;i<btns.length;i++) btns[i].disabled=true;
        var comment=(document.getElementById('rejComment')||{}).value||'';
        if(action==='reject' && !String(comment).trim()){
          for(var j=0;j<btns.length;j++) btns[j].disabled=false;
          alert('Укажите причину отказа');
          return;
        }
        fetch(location.pathname,{
          method:'POST',
          headers:{'Content-Type':'application/json','Accept':'application/json'},
          body:JSON.stringify({action:action, comment:comment})
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

function cloudPageHtml(tender, files, rawToken) {
  const list = (files || []).map((f) => {
    const href = `/tender-files/${encodeURIComponent(rawToken)}/download/${encodeURIComponent(f.id)}`;
    const view = f.can_preview
      ? ` · <a href="/tender-files/${encodeURIComponent(rawToken)}/view/${encodeURIComponent(f.id)}" target="_blank">смотреть</a>`
      : '';
    return `<div class="file"><div><b>${esc(f.name)}</b><div class="muted" style="margin:0">${esc(f.kind_label || f.kind || '')}${f.size_label ? ' · ' + esc(f.size_label) : ''}${view}</div></div>
      <a href="${esc(href)}">Скачать</a></div>`;
  }).join('') || '<div class="banner warn">Файлы ещё не прикреплены</div>';

  return landingShell('Файлы тендера', `
    <div class="row"><span class="lbl">Тендер</span> <b>#${esc(tender.registry_no || tender.id)}</b></div>
    <div class="row"><span class="lbl">Заказчик</span> <b>${esc(tender.customer_name || '—')}</b></div>
    <div class="row" style="margin-bottom:14px">${esc(tender.tender_title || '')}</div>
    ${list}
    <p class="muted">Облако Асгард · вход в ЛК не нужен · ссылка ${TOKEN_TTL_HOURS} ч.</p>
  `);
}

async function createDecideToken(db, tenderId) {
  const raw = crypto.randomBytes(24).toString('hex');
  await db.query(
    `INSERT INTO tender_director_mail_tokens(tender_id, token_hash, expires_at)
     VALUES($1,$2,NOW()+($3||' hours')::interval)`,
    [tenderId, hashToken(raw), String(TOKEN_TTL_HOURS)]
  );
  return raw;
}

async function createFilesToken(db, tenderId) {
  const raw = crypto.randomBytes(24).toString('hex');
  await db.query(
    `INSERT INTO tender_file_share_tokens(tender_id, token_hash, expires_at)
     VALUES($1,$2,NOW()+($3||' hours')::interval)`,
    [tenderId, hashToken(raw), String(TOKEN_TTL_HOURS)]
  );
  return raw;
}

async function lookupDecideToken(db, rawToken) {
  const raw = String(rawToken || '').trim();
  if (!raw || raw.length < 16) return { ok: false, reason: 'invalid' };
  const h = hashToken(raw);

  // 1) Адресное согласование (V353)
  try {
    const ar = await db.query(
      `SELECT ar.*, tr.customer_name, tr.tender_title, tr.registry_no, tr.docs_deadline,
              tr.work_start_plan, tr.work_start, tr.work_end, tr.object_name, tr.city, tr.region,
              rev.work_price, rev.work_price_ex_vat, rev.report_json, rev.director_review_status,
              rev.id AS review_id
       FROM tender_approval_recipients ar
       JOIN tenders tr ON tr.id = ar.tender_id AND tr.deleted_at IS NULL
       LEFT JOIN tender_rp_reviews rev ON rev.tender_id = ar.tender_id
       WHERE ar.token_hash = $1`,
      [h]
    );
    const row = ar.rows[0];
    if (row) {
      const recipients = await loadApprovalRecipients(db, row.tender_id);
      const expectedFrom = recipients.map((x) => x.label).join(', ');
      if (row.status !== 'pending') {
        return { ok: false, reason: 'used', tender: row, recipient: row, recipients };
      }
      if (row.expires_at && new Date(row.expires_at) < new Date()) {
        return { ok: false, reason: 'expired', tender: row, recipient: row, recipients };
      }
      if (row.director_review_status && row.director_review_status !== 'pending') {
        return { ok: false, reason: 'used', tender: row, recipient: row, recipients };
      }
      return {
        ok: true, tokenKind: 'recipient', tokenRow: row, tender: row, review: row,
        recipient: row, recipients, expectedFrom
      };
    }
  } catch (_) { /* таблицы ещё нет — падаем в legacy */ }

  // 2) Legacy: один обезличенный токен директора
  const r = await db.query(
    `SELECT t.*, tr.customer_name, tr.tender_title, tr.registry_no, tr.docs_deadline,
            tr.work_start_plan,
            rev.work_price, rev.work_price_ex_vat, rev.report_json, rev.director_review_status,
            rev.id AS review_id
     FROM tender_director_mail_tokens t
     JOIN tenders tr ON tr.id = t.tender_id AND tr.deleted_at IS NULL
     LEFT JOIN tender_rp_reviews rev ON rev.tender_id = t.tender_id
     WHERE t.token_hash = $1`,
    [h]
  );
  const row = r.rows[0];
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.used_at) return { ok: false, reason: 'used', tender: row };
  if (new Date(row.expires_at) < new Date()) return { ok: false, reason: 'expired', tender: row };
  return { ok: true, tokenKind: 'legacy', tokenRow: row, tender: row, review: row, recipients: [] };
}

async function lookupFilesToken(db, rawToken) {
  const raw = String(rawToken || '').trim();
  if (!raw || raw.length < 16) return { ok: false, reason: 'invalid' };
  const h = hashToken(raw);
  const r = await db.query(
    `SELECT t.*, tr.customer_name, tr.tender_title, tr.registry_no, tr.docs_deadline
     FROM tender_file_share_tokens t
     JOIN tenders tr ON tr.id = t.tender_id AND tr.deleted_at IS NULL
     WHERE t.token_hash = $1`,
    [h]
  );
  const row = r.rows[0];
  if (!row) return { ok: false, reason: 'not_found' };
  if (new Date(row.expires_at) < new Date()) return { ok: false, reason: 'expired', tender: row };
  return { ok: true, tokenRow: row, tender: row };
}

async function loadTenderFiles(db, tenderId) {
  const rev = await db.query(
    `SELECT estimate_file_id, report_file_id, tkp_file_id FROM tender_rp_reviews WHERE tender_id=$1`,
    [tenderId]
  );
  const ids = [];
  const map = {};
  const row = rev.rows[0] || {};
  if (row.estimate_file_id) { ids.push(row.estimate_file_id); map[row.estimate_file_id] = 'Смета'; }
  if (row.report_file_id) { ids.push(row.report_file_id); map[row.report_file_id] = 'Отчёт'; }
  if (row.tkp_file_id) { ids.push(row.tkp_file_id); map[row.tkp_file_id] = 'ТКП'; }

  const docs = await db.query(
    `SELECT d.id, d.original_name, d.filename, d.mime_type, d.size, d.download_url, d.type
     FROM documents d
     WHERE d.tender_id = $1
        OR d.id = ANY($2::int[])
     ORDER BY d.id DESC
     LIMIT 80`,
    [tenderId, ids.length ? ids : [0]]
  );

  return docs.rows.map((d) => {
    const name = d.original_name || d.filename || `file-${d.id}`;
    const mime = d.mime_type || '';
    const canPreview = /pdf|image\//i.test(mime) || /\.(pdf|png|jpe?g|webp|gif)$/i.test(name);
    return {
      id: String(d.id),
      name,
      kind: map[d.id] || d.type || 'Документ',
      kind_label: map[d.id] || d.type || 'Документ тендера',
      mime,
      size_label: d.size ? `${Math.round(Number(d.size) / 1024)} КБ` : '',
      can_preview: canPreview,
      download_url: d.download_url
    };
  });
}

async function resolveDocFs(db, tenderId, docId) {
  const r = await db.query(
    `SELECT d.* FROM documents d
     LEFT JOIN tender_rp_reviews rev ON rev.tender_id = $1
     WHERE d.id = $2 AND (
       d.tender_id = $1
       OR d.id IN (rev.estimate_file_id, rev.report_file_id, rev.tkp_file_id)
     )
     LIMIT 1`,
    [tenderId, docId]
  );
  const d = r.rows[0];
  if (!d) return null;
  const rel = d.download_url;
  const fsPath = uploadFsPath(rel);
  if (!fsPath || !fs.existsSync(fsPath)) return null;
  return {
    fsPath,
    filename: d.original_name || d.filename || path.basename(fsPath),
    mime: d.mime_type || 'application/octet-stream'
  };
}

/**
 * Apply director decision via email token (mirrors pm-duty director-decision).
 */
async function applyDecision(db, tenderId, action, comment, actorLabel, opts = {}) {
  const act = action === 'approve' || action === 'submit' ? 'submit' : 'reject';
  if (act === 'reject' && !String(comment || '').trim()) {
    return { ok: false, error: 'Укажите причину отказа' };
  }

  const revRes = await db.query(`SELECT * FROM tender_rp_reviews WHERE tender_id=$1`, [tenderId]);
  const review = revRes.rows[0];
  if (!review) return { ok: false, error: 'Отчёт не найден' };
  if (review.director_review_status !== 'pending') {
    return { ok: false, error: 'Тендер не ожидает согласования директора', already: true };
  }

  const { notifyOnDirectorDecision } = require('./rp-review-notify');
  const { applyRegistryStatus } = require('./tender-registry-helpers');

  // Фиксируем решение конкретного получателя (адресное согласование).
  if (opts.recipientId) {
    await db.query(`
      UPDATE tender_approval_recipients
      SET status = $1, decided_at = NOW(), decided_comment = $2
      WHERE id = $3 AND status = 'pending'
    `, [act === 'submit' ? 'approved' : 'rejected', comment || null, opts.recipientId]);
  }

  if (act === 'submit') {
    // Достаточно согласия любого одного — согласование закрывается сразу.
    await db.query(`
      UPDATE tender_rp_reviews SET
        director_review_status = 'approved',
        director_review_at = NOW(),
        director_review_comment = $1,
        updated_at = NOW()
      WHERE tender_id = $2
    `, [comment || null, tenderId]);
    await applyRegistryStatus(db, tenderId, 'готовим', true);
  } else {
    const reason = String(comment).trim();
    await db.query(`
      UPDATE tender_rp_reviews SET
        director_review_status = 'rejected',
        director_review_at = NOW(),
        director_review_comment = $1,
        updated_at = NOW()
      WHERE tender_id = $2
    `, [reason, tenderId]);
    await db.query(`
      UPDATE tenders SET registry_status = 'отмена', tender_status = 'Не подходит',
        reject_reason = $1,
        archived_at = NOW(), archive_reason = $2,
        updated_at = NOW()
      WHERE id = $3
    `, [reason, `Отказ директора (email): ${reason}`.slice(0, 500), tenderId]);
  }

  notifyOnDirectorDecision(db, {
    tenderId: parseInt(tenderId, 10),
    action: act,
    comment: comment || null,
    directorName: actorLabel || 'Директор (email)',
    log: null
  }).catch(() => {});

  return {
    ok: true,
    message: act === 'submit'
      ? 'Просчёт согласован. Тендер переведён в «Готовим».'
      : 'Просчёт отклонён. Тендер отменён.'
  };
}

async function sendDirectorMail(db, tenderId, { to, log, recipients } = {}) {
  const tRes = await db.query(`
    SELECT t.*, r.work_price, r.work_price_ex_vat, r.report_json, r.director_review_status,
           r.estimate_file_id, r.tkp_file_id, r.report_file_id
    FROM tenders t
    LEFT JOIN tender_rp_reviews r ON r.tender_id = t.id
    WHERE t.id = $1 AND t.deleted_at IS NULL
  `, [tenderId]);
  const tender = tRes.rows[0];
  if (!tender) return { sent: false, reason: 'not_found' };

  const codes = normalizeRecipientCodes(recipients);
  const prepared = await prepareApprovalRecipients(db, codes);
  const saved = await saveApprovalRecipients(db, tenderId, prepared);

  // Никто из получателей не резолвится — падаем в legacy-режим (один общий токен).
  if (!saved.length) {
    const decideRaw = await createDecideToken(db, tenderId);
    const filesRaw = await createFilesToken(db, tenderId);
    const base = publicBaseUrl();
    const decideUrl = `${base}/tender-mail/${encodeURIComponent(decideRaw)}`;
    const filesUrl = `${base}/tender-files/${encodeURIComponent(filesRaw)}`;
    const rj = parseRj(tender.report_json);
    const fileRows = await loadTenderFiles(db, tenderId);
    const html = buildEmailHtml({
      tender, review: tender, estimate: rj.asgard_smeta,
      decideUrl, filesUrl, files: fileRows, pmName: tender.calculator_name
    });
    const toRes = to ? { ok: true, email: to } : resolveMailTo();
    if (!toRes.ok) {
      return { sent: false, dry_run: true, reason: toRes.reason, email_preview: html, decide_url: decideUrl, files_url: filesUrl, tender_id: tenderId, recipients: [] };
    }
    if (!isLiveMail()) {
      return { sent: false, dry_run: true, to: toRes.email, email_preview: html, decide_url: decideUrl, files_url: filesUrl, tender_id: tenderId, recipients: [] };
    }
    await sendCrmEmail(db, null, {
      to: toRes.email,
      subject: `Просчёт №${tender.registry_no || tender.id}: ${tender.customer_name || 'тендер'} · согласование`,
      html,
      text: `Просчёт #${tender.id}. Согласовать: ${decideUrl}. Файлы: ${filesUrl}`,
      skipBcc: !isProdRuntime()
    });
    log?.info?.({ tenderId, to: toRes.email }, 'tender director mail sent (legacy)');
    return { sent: true, to: toRes.email, decide_url: decideUrl, files_url: filesUrl, tender_id: tenderId, recipients: [] };
  }

  const filesRaw = await createFilesToken(db, tenderId);
  const base = publicBaseUrl();
  const filesUrl = `${base}/tender-files/${encodeURIComponent(filesRaw)}`;
  const expectedFrom = saved.map((r) => r.label).join(', ');

  const rj = parseRj(tender.report_json);
  const fileRows = await loadTenderFiles(db, tenderId);
  const subject = `Просчёт №${tender.registry_no || tender.id}: ${tender.customer_name || 'тендер'} · согласование`;

  const results = [];
  let firstPreview = null;
  for (const rcpt of saved) {
    const decideUrl = `${base}/tender-mail/${encodeURIComponent(rcpt.raw)}`;
    const html = buildEmailHtml({
      tender,
      review: tender,
      estimate: rj.asgard_smeta,
      decideUrl,
      filesUrl,
      files: fileRows,
      pmName: tender.calculator_name,
      expectedFrom,
      recipientLabel: rcpt.label
    });
    if (!firstPreview) firstPreview = html;

    const toRes = to ? { ok: true, email: to } : { ok: true, email: rcpt.email };
    if (!toRes.ok) {
      results.push({ code: rcpt.role_code, label: rcpt.label, sent: false, reason: toRes.reason });
      continue;
    }
    if (!isLiveMail()) {
      results.push({ code: rcpt.role_code, label: rcpt.label, sent: false, dry_run: true, to: toRes.email });
      continue;
    }
    try {
      await sendCrmEmail(db, null, {
        to: toRes.email,
        subject,
        html,
        text: `Просчёт #${tender.id}. Согласовать: ${decideUrl}. Файлы: ${filesUrl}`,
        skipBcc: !isProdRuntime()
      });
      log?.info?.({ tenderId, to: toRes.email, code: rcpt.role_code }, 'tender approval mail sent');
      results.push({ code: rcpt.role_code, label: rcpt.label, sent: true, to: toRes.email });
    } catch (e) {
      log?.warn?.({ err: e, tenderId, code: rcpt.role_code }, 'tender approval mail failed');
      results.push({ code: rcpt.role_code, label: rcpt.label, sent: false, reason: 'send_failed' });
    }
  }

  const anySent = results.some((x) => x.sent);
  return {
    sent: anySent,
    dry_run: !isLiveMail(),
    to: results.map((x) => x.to).filter(Boolean).join(', '),
    email_preview: firstPreview,
    expected_from: expectedFrom,
    decide_url: `${base}/tender-mail/…`,
    files_url: filesUrl,
    tender_id: tenderId,
    recipients: saved.map((r) => ({
      code: r.role_code, label: r.label, email: r.email, status: r.status
    })),
    results
  };
}

async function sendPreviewToAndrosov(db, opts = {}) {
  const to = opts.to || process.env.TENDER_MAIL_TO || process.env.PAYMENT_MAIL_TO || 'n.androsov@asgard-service.com';
  const force = process.env.TENDER_MAIL_FORCE === '1' || process.env.PAYMENT_MAIL_FORCE === '1' || opts.force;
  const est = ensureEstimate(opts.estimate);
  const tender = opts.tender || {
    id: 'DEMO',
    registry_no: 'DEMO-CALC',
    customer_name: 'АО «Заказчик»',
    tender_title: 'Универсальный просчёт — превью письма директору',
    docs_deadline: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
    object_name: 'Производственная площадка',
    region: 'РФ'
  };
  const decideUrl = opts.decideUrl || `${publicBaseUrl()}/tender-mail/preview-token`;
  const filesUrl = opts.filesUrl || `${publicBaseUrl()}/tender-files/preview-token`;
  const html = buildEmailHtml({
    tender,
    review: {
      work_price: est.totals?.price_with_vat,
      report_json: {
        asgard_smeta: est,
        summary: opts.summary || 'Гидроструйная очистка теплообменного оборудования. Бригада 2 смены, выезд на площадку заказчика.',
        recommendation: opts.rpComment || 'Маржа заложена 50%. Риски: доступ на объект, график остановочного ремонта.',
        director_action: opts.directorAction || 'Согласовать цену просчёта и решение о подаче тендера.'
      },
      calculator_name: 'РП (превью)'
    },
    estimate: est,
    decideUrl,
    filesUrl,
    files: opts.files || [
      { name: 'Смета_просчёт.xlsx', kind: 'estimate', kind_label: 'Смета' },
      { name: 'ТКП_заказчику.pdf', kind: 'tkp', kind_label: 'ТКП' },
      { name: 'ТЗ_площадка.pdf', kind: 'tz', kind_label: 'Документ тендера' }
    ],
    pmName: 'РП (превью)'
  });

  if (!force) {
    return { sent: false, dry_run: true, to, email_preview: html, reason: 'set TENDER_MAIL_FORCE=1 to send' };
  }

  await sendCrmEmail(db, null, {
    to,
    subject: `[ПРЕВЬЮ] Просчёт · согласование · ${tender.customer_name}`,
    html,
    text: `Превью письма просчёта. Решение: ${decideUrl}`,
    skipBcc: true
  });
  return { sent: true, to, email_preview: html };
}

module.exports = {
  TOKEN_TTL_HOURS,
  APPROVAL_RECIPIENT_DEFS,
  DEFAULT_APPROVAL_RECIPIENTS,
  normalizeRecipientCodes,
  resolveRecipientUser,
  prepareApprovalRecipients,
  loadApprovalRecipients,
  publicBaseUrl,
  isLiveMail,
  resolveMailTo,
  buildEmailHtml,
  renderSmetaTableHtml,
  ensureEstimate,
  landingMessageHtml,
  landingActionHtml,
  cloudPageHtml,
  createDecideToken,
  createFilesToken,
  lookupDecideToken,
  lookupFilesToken,
  loadTenderFiles,
  resolveDocFs,
  applyDecision,
  sendDirectorMail,
  sendPreviewToAndrosov
};
