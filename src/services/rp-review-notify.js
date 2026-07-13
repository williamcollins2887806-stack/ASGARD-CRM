'use strict';

const { createNotification } = require('./notify');

const DIRECTOR_ROLES = ['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

function parseRj(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}'); } catch (_) { return {}; }
}

function fmtMoney(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽';
}

function feasibilityLabel(v) {
  const map = { yes: 'Да', conditional: 'Условно', no: 'Нет' };
  return map[v] || null;
}

function decisionLabel(dec) {
  if (dec === 'submit') return 'Подаём';
  if (dec === 'reject') return 'Не подаём';
  return null;
}

function clip(text, max = 220) {
  const s = String(text || '').trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/** Краткий блок из отчёта для письма и уведомления. */
function buildReportBrief(review, kind) {
  const rj = parseRj(review?.report_json);
  const snap = kind === 'analysis' ? rj : (rj.analysis_snapshot || null);
  const src = snap || rj;
  const lines = [];

  const dec = decisionLabel(review?.decision || src.decision);
  if (dec) lines.push(`Решение: ${dec}`);

  const workPrice = fmtMoney(review?.work_price);
  const costNoVat = fmtMoney(rj.cost_without_vat);
  if (workPrice) {
    lines.push(`Цена работ (с НДС): ${workPrice}`);
  }
  if (costNoVat) {
    lines.push(`Себестоимость (без НДС): ${costNoVat}`);
  }
  if (!workPrice) {
    const min = src.price_range_min ?? rj.price_range_min;
    const max = src.price_range_max ?? rj.price_range_max;
    const fMin = fmtMoney(min);
    const fMax = fmtMoney(max);
    if (fMin && fMax) lines.push(`Ориентир цены (без НДС): ${fMin} — ${fMax}`);
    else if (fMin) lines.push(`Ориентир цены от (без НДС): ${fMin}`);
    else if (fMax) lines.push(`Ориентир цены до (без НДС): ${fMax}`);
  }

  const feas = feasibilityLabel(src.feasibility || rj.feasibility);
  if (feas) lines.push(`Выполнимость: ${feas}`);

  const summary = clip(src.summary || rj.summary);
  if (summary) lines.push(`Суть: ${summary}`);

  const rec = clip(src.recommendation || rj.recommendation, 180);
  if (rec) lines.push(`Рекомендация: ${rec}`);

  const risks = clip(src.risks || rj.risks, 160);
  if (risks) lines.push(`Риски: ${risks}`);

  return lines;
}

function briefToText(lines) {
  if (!lines.length) return '';
  return ['Кратко по отчёту:', ...lines.map((l) => `• ${l}`)].join('\n');
}

function briefToHtml(lines) {
  if (!lines.length) return '';
  const items = lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('');
  return `<p><strong>Кратко по отчёту:</strong></p><ul style="margin:8px 0;padding-left:20px">${items}</ul>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Уведомить ТО (владельца строки реестра) о закрытом анализе или финальном отчёте РП.
 * @param {'analysis'|'report'} kind
 */
async function notifyToOnReviewReady(db, { tenderId, kind, actorName, log }) {
  const tRes = await db.query(`
    SELECT t.id, t.customer_name, t.tender_title, t.created_by, t.docs_deadline,
           u.id AS owner_id, u.name AS owner_name, u.email AS owner_email, u.role AS owner_role
    FROM tenders t
    LEFT JOIN users u ON u.id = t.created_by
    WHERE t.id = $1 AND t.deleted_at IS NULL
  `, [tenderId]);
  const tender = tRes.rows[0];
  if (!tender?.owner_id) return;

  const ownerRole = tender.owner_role || '';
  if (!['TO', 'HEAD_TO', 'ADMIN'].includes(ownerRole)) return;

  const revRes = await db.query(`
    SELECT decision, work_price, report_json
    FROM tender_rp_reviews WHERE tender_id = $1
  `, [tenderId]);
  const review = revRes.rows[0] || {};
  const briefLines = buildReportBrief(review, kind);
  const briefBlock = briefToText(briefLines);
  const priceLine = briefLines.find((l) => l.startsWith('Цена работ')) || briefLines.find((l) => l.startsWith('Ориентир'));

  const isAnalysis = kind === 'analysis';
  const title = isAnalysis
    ? `Анализ РП готов · #${tenderId}`
    : `Отчёт РП готов · #${tenderId}`;
  const shortTitle = (tender.tender_title || '').slice(0, 80);
  const customer = tender.customer_name || '—';
  const who = actorName || 'РП';
  let message = isAnalysis
    ? `${who} закрыл анализ по тендеру «${shortTitle}» (${customer}).`
    : `${who} закрыл отчёт просчёта по тендеру «${shortTitle}» (${customer}). Требуется ваше решение.`;
  if (priceLine) message += ` ${priceLine.split(': ').slice(1).join(': ')}.`;
  const link = `#/tenders?id=${tenderId}`;
  const appUrl = (process.env.PUBLIC_APP_URL || 'https://asgard-crm.ru').replace(/\/$/, '');
  const fullLink = `${appUrl}/${link}`;

  try {
    await createNotification(db, {
      user_id: tender.owner_id,
      title,
      message,
      type: 'tender',
      link
    });
  } catch (e) {
    log?.warn?.({ err: e, tenderId }, 'rp-review in-app notify failed');
  }

  const email = String(tender.owner_email || '').trim();
  if (!email) return;

  try {
    const { sendCrmEmail } = require('./crm-mailer');
    const subject = isAnalysis
      ? `АСГАРД CRM: анализ РП готов — #${tenderId} ${customer}`
      : `АСГАРД CRM: отчёт РП готов — #${tenderId} ${customer}`;

    const deadline = tender.docs_deadline
      ? String(tender.docs_deadline).slice(0, 10).split('-').reverse().join('.')
      : null;

    const textParts = [
      `Здравствуйте, ${tender.owner_name || 'коллега'}!`,
      '',
      isAnalysis
        ? `${who} закрыл анализ по тендеру. Можно назначать просчёт или смотреть рекомендации.`
        : `${who} закрыл отчёт просчёта. Требуется ваше решение в реестре.`,
      '',
      `Тендер: #${tenderId}`,
      `Заказчик: ${customer}`,
      `Предмет: ${tender.tender_title || '—'}`
    ];
    if (deadline) textParts.push(`Срок документов: ${deadline}`);
    if (briefBlock) {
      textParts.push('', briefBlock);
    }
    textParts.push(
      '',
      `Откройте CRM: ${fullLink}`,
      '',
      '— АСГАРД CRM (автоуведомление)'
    );

    const htmlParts = [
      `<p>Здравствуйте, ${escapeHtml(tender.owner_name || 'коллега')}!</p>`,
      `<p>${escapeHtml(isAnalysis
        ? `${who} закрыл анализ по тендеру. Можно назначать просчёт или смотреть рекомендации.`
        : `${who} закрыл отчёт просчёта. Требуется ваше решение в реестре.`)}</p>`,
      '<table style="border-collapse:collapse;font-size:14px;margin:12px 0">',
      `<tr><td style="padding:4px 12px 4px 0;color:#666">Тендер</td><td><strong>#${tenderId}</strong></td></tr>`,
      `<tr><td style="padding:4px 12px 4px 0;color:#666">Заказчик</td><td>${escapeHtml(customer)}</td></tr>`,
      `<tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top">Предмет</td><td>${escapeHtml(tender.tender_title || '—')}</td></tr>`
    ];
    if (deadline) {
      htmlParts.push(`<tr><td style="padding:4px 12px 4px 0;color:#666">Срок</td><td>${escapeHtml(deadline)}</td></tr>`);
    }
    htmlParts.push('</table>');
    if (briefLines.length) htmlParts.push(briefToHtml(briefLines));
    htmlParts.push(`<p style="margin-top:16px"><a href="${fullLink}">Открыть тендер #${tenderId} в CRM</a></p>`);

    await sendCrmEmail(db, null, {
      to: email,
      subject,
      text: textParts.join('\n'),
      html: htmlParts.join('')
    });
  } catch (e) {
    log?.warn?.({ err: e, tenderId, email }, 'rp-review email notify failed');
  }
}

async function loadDirectorUserIds(db) {
  const r = await db.query(`
    SELECT id FROM users
    WHERE role = ANY($1::text[]) AND COALESCE(is_active, true) = true
  `, [DIRECTOR_ROLES.concat(['ADMIN'])]);
  return r.rows.map((u) => u.id);
}

/**
 * Уведомить директоров о тендере, ожидающем согласования после просчёта РП.
 */
async function notifyDirectorsOnReviewPending(db, { tenderId, actorName, workPriceExVat, log }) {
  const tRes = await db.query(`
    SELECT t.id, t.registry_no, t.customer_name, t.tender_title, t.docs_deadline
    FROM tenders t WHERE t.id = $1 AND t.deleted_at IS NULL
  `, [tenderId]);
  const tender = tRes.rows[0];
  if (!tender) return;

  const directorIds = await loadDirectorUserIds(db);
  if (!directorIds.length) return;

  const regNo = tender.registry_no || tender.id;
  const customer = tender.customer_name || '—';
  const title = tender.tender_title || '—';
  const who = actorName || 'РП';
  const priceFmt = workPriceExVat != null
    ? Number(workPriceExVat).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽ без НДС'
    : '';
  const message = `${who} закрыл просчёт: «${title.slice(0, 80)}» (${customer})${priceFmt ? `. Цена: ${priceFmt}` : ''}. Требуется согласование.`;
  const link = `#/director-tender-approvals?id=${tenderId}`;

  for (const userId of directorIds) {
    try {
      await createNotification(db, {
        user_id: userId,
        title: `Согласование тендера №${regNo}`,
        message,
        type: 'tender',
        link
      });
    } catch (e) {
      log?.warn?.({ err: e, userId, tenderId }, 'director pending in-app notify failed');
    }
  }
}

/**
 * Уведомить ТО: просчёт готов, ожидает согласования директора.
 */
async function notifyToOnDirectorPending(db, { tenderId, actorName, log }) {
  const tRes = await db.query(`
    SELECT t.id, t.customer_name, t.tender_title, t.created_by,
           u.id AS owner_id, u.role AS owner_role
    FROM tenders t
    LEFT JOIN users u ON u.id = t.created_by
    WHERE t.id = $1 AND t.deleted_at IS NULL
  `, [tenderId]);
  const tender = tRes.rows[0];
  if (!tender?.owner_id) return;
  if (!['TO', 'HEAD_TO', 'ADMIN'].includes(tender.owner_role || '')) return;

  const who = actorName || 'РП';
  const shortTitle = (tender.tender_title || '').slice(0, 80);
  const customer = tender.customer_name || '—';
  try {
    await createNotification(db, {
      user_id: tender.owner_id,
      title: `Просчёт готов · ожидает директора · #${tenderId}`,
      message: `${who} закрыл просчёт по «${shortTitle}» (${customer}). Ожидается согласование директора.`,
      type: 'tender',
      link: `#/tenders?id=${tenderId}`
    });
  } catch (e) {
    log?.warn?.({ err: e, tenderId }, 'to director-pending notify failed');
  }
}

/**
 * Уведомить ТО и РП о решении директора.
 */
async function notifyOnDirectorDecision(db, { tenderId, action, comment, directorName, log }) {
  const tRes = await db.query(`
    SELECT t.id, t.customer_name, t.tender_title, t.created_by
    FROM tenders t WHERE t.id = $1 AND t.deleted_at IS NULL
  `, [tenderId]);
  const tender = tRes.rows[0];
  if (!tender) return;

  const revRes = await db.query(`
    SELECT calculator_user_id, finalized_by_user_id, started_by_user_id
    FROM tender_rp_reviews WHERE tender_id = $1
  `, [tenderId]);
  const review = revRes.rows[0] || {};
  const recipientIds = new Set();
  if (tender.created_by) recipientIds.add(Number(tender.created_by));
  if (review.calculator_user_id) recipientIds.add(Number(review.calculator_user_id));
  if (review.finalized_by_user_id) recipientIds.add(Number(review.finalized_by_user_id));
  if (review.started_by_user_id) recipientIds.add(Number(review.started_by_user_id));

  const regNo = tender.id;
  const customer = tender.customer_name || '—';
  const title = tender.tender_title || '—';
  const who = directorName || 'Директор';
  const approved = action === 'submit';
  const notifTitle = approved
    ? `Директор одобрил подачу · #${regNo}`
    : `Директор отклонил подачу · #${regNo}`;
  let message = approved
    ? `${who} одобрил подачу по «${title.slice(0, 80)}» (${customer}).`
    : `${who} отклонил подачу по «${title.slice(0, 80)}» (${customer}).`;
  if (!approved && comment) message += ` Причина: ${String(comment).slice(0, 200)}`;
  const link = `#/tenders?id=${tenderId}`;

  for (const userId of recipientIds) {
    try {
      await createNotification(db, {
        user_id: userId,
        title: notifTitle,
        message,
        type: approved ? 'tender' : 'warning',
        link
      });
    } catch (e) {
      log?.warn?.({ err: e, userId, tenderId }, 'director decision notify failed');
    }
  }
}

module.exports = {
  notifyToOnReviewReady,
  notifyDirectorsOnReviewPending,
  notifyToOnDirectorPending,
  notifyOnDirectorDecision,
  buildReportBrief,
  fmtMoney
};
