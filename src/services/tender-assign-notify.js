'use strict';

/**
 * Уведомления при назначении / переназначении РП на просчёт
 * и при привлечении коллаборатора.
 * In-app (createNotification) + email (sendCrmEmail), по образцу rp-review-notify.
 */
const { createNotification } = require('./notify');

const CALC_STATUSES = new Set([
  'На анализе',
  'Отправлено на просчёт',
  'Согласование ТКП',
  'ТКП согласовано',
  'Готово к отправке КП',
  'КП отправлено',
  'Дозапрос'
]);

const CALC_REGISTRY = new Set(['рассмотрение', 'готовим']);

function tenderLabel(row) {
  const c = (row && row.customer_name) || '';
  const t = (row && row.tender_title) || '';
  if (c && t) return `${c} — ${t}`;
  return c || t || `#${(row && row.id) || ''}`;
}

function needsCalcHandoff(tender) {
  if (!tender) return false;
  if (CALC_STATUSES.has(tender.tender_status)) return true;
  if (CALC_REGISTRY.has(tender.registry_status || 'рассмотрение')) return true;
  if (tender.handoff_at) return true;
  if (tender.calculator_user_id) return true;
  return false;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function appBaseUrl() {
  return (process.env.PUBLIC_APP_URL || 'https://asgard-crm.ru').replace(/\/$/, '');
}

/**
 * Письмо получателю assign/reassign/invite (если у users.email заполнен).
 * Ошибки SMTP глотаем — in-app уже ушёл.
 */
async function sendAssignEmail(db, {
  userId,
  subject,
  greetingLead,
  tender,
  link,
  log
}) {
  const uid = Number(userId);
  if (!uid || !Number.isFinite(uid)) return;

  let email = '';
  let name = '';
  try {
    const { rows } = await db.query(
      `SELECT name, email FROM users
       WHERE id = $1 AND COALESCE(is_active, true) = true`,
      [uid]
    );
    email = String(rows[0]?.email || '').trim();
    name = rows[0]?.name || 'коллега';
  } catch (e) {
    log?.warn?.({ err: e, userId: uid }, 'tender-assign email user lookup failed');
    return;
  }
  if (!email) return;

  const tid = tender?.id != null ? Number(tender.id) : null;
  const customer = tender?.customer_name || '—';
  const title = tender?.tender_title || '—';
  const regLabel = tender?.registry_no != null ? `№${tender.registry_no}` : (tid ? `#${tid}` : '');
  const href = link || (tid ? `#/tenders?id=${tid}` : '#/pm-duty');
  const fullLink = `${appBaseUrl()}/${String(href).replace(/^\//, '')}`;

  try {
    const { sendCrmEmail } = require('./crm-mailer');
    const textParts = [
      `Здравствуйте, ${name}!`,
      '',
      greetingLead,
      ''
    ];
    if (regLabel || tid) textParts.push(`Тендер: ${regLabel || ''}`.trim() + (tid ? ` (id ${tid})` : ''));
    textParts.push(`Заказчик: ${customer}`);
    textParts.push(`Предмет: ${title}`);
    textParts.push('', `Откройте CRM: ${fullLink}`, '', '— АСГАРД CRM (автоуведомление)');

    const htmlParts = [
      `<p>Здравствуйте, ${escapeHtml(name)}!</p>`,
      `<p>${escapeHtml(greetingLead)}</p>`,
      '<table style="border-collapse:collapse;font-size:14px;margin:12px 0">',
      (regLabel || tid)
        ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Тендер</td><td><strong>${escapeHtml(regLabel || `#${tid}`)}</strong>${tid ? ` (id ${tid})` : ''}</td></tr>`
        : '',
      `<tr><td style="padding:4px 12px 4px 0;color:#666">Заказчик</td><td>${escapeHtml(customer)}</td></tr>`,
      `<tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top">Предмет</td><td>${escapeHtml(title)}</td></tr>`,
      '</table>',
      `<p style="margin-top:16px"><a href="${fullLink}">Открыть в CRM</a></p>`
    ];

    await sendCrmEmail(db, null, {
      to: email,
      subject,
      text: textParts.join('\n'),
      html: htmlParts.filter(Boolean).join('')
    });
  } catch (e) {
    log?.warn?.({ err: e, userId: uid, email }, 'tender-assign email notify failed');
  }
}

/**
 * @param {object} db
 * @param {object} opts
 * @param {number} opts.userId
 * @param {'assign'|'reassign'|'invite'} opts.kind
 * @param {object} opts.tender
 * @param {string} [opts.actorName]
 * @param {string} [opts.link]
 * @param {number} [opts.actorUserId] — если совпадает с userId, письмо не шлём (сам себе)
 * @param {object} [opts.log]
 */
async function notifyPmCalcEvent(db, opts) {
  const {
    userId,
    kind,
    tender,
    actorName,
    link,
    actorUserId,
    log
  } = opts || {};
  const uid = Number(userId);
  if (!uid || !Number.isFinite(uid)) return;

  const label = tenderLabel(tender);
  const who = actorName || 'Коллега';
  let title;
  let message;
  let href = link;
  let emailSubject;
  let emailLead;

  if (kind === 'invite') {
    title = 'Вас привлекли к просчёту';
    message = `${who} привлёк вас к проверке / просчёту тендера: ${label}`;
    href = href || '#/pm-calculations';
    emailSubject = `АСГАРД CRM: вас привлекли к просчёту — ${label}`;
    emailLead = `${who} привлёк вас к проверке / просчёту тендера.`;
  } else if (kind === 'reassign') {
    title = 'Тендер на просчёт (переназначен)';
    message = `${who} передал вам тендер на просчёт: ${label}`;
    href = href || '#/pm-duty';
    emailSubject = `АСГАРД CRM: тендер переназначен вам на просчёт — ${label}`;
    emailLead = `${who} передал вам тендер на просчёт.`;
  } else {
    title = 'Тендер на просчёт';
    message = `${who} назначил вас считающим: ${label}`;
    href = href || '#/pm-duty';
    emailSubject = `АСГАРД CRM: тендер на просчёт — ${label}`;
    emailLead = `${who} назначил вас считающим по тендеру.`;
  }

  await createNotification(db, {
    user_id: uid,
    title,
    message,
    type: 'tender',
    link: href
  }).catch(() => {});

  // Не спамим письмом самому себе («считаю сам»)
  if (actorUserId != null && Number(actorUserId) === uid) return;

  await sendAssignEmail(db, {
    userId: uid,
    subject: emailSubject.slice(0, 200),
    greetingLead: emailLead,
    tender,
    link: href,
    log
  });
}

async function notifyPmReleasedFromCalc(db, { userId, tender, actorName, log }) {
  const uid = Number(userId);
  if (!uid || !Number.isFinite(uid)) return;
  const label = tenderLabel(tender);
  const who = actorName || 'Коллега';
  const message = `${who} передал тендер другому РП: ${label}`;
  const href = '#/pm-duty';

  await createNotification(db, {
    user_id: uid,
    title: 'Просчёт снят с вас',
    message,
    type: 'tender',
    link: href
  }).catch(() => {});

  await sendAssignEmail(db, {
    userId: uid,
    subject: `АСГАРД CRM: просчёт снят с вас — ${label}`.slice(0, 200),
    greetingLead: `${who} передал тендер другому РП — просчёт снят с вас.`,
    tender,
    link: href,
    log
  });
}

/**
 * После смены responsible_pm_id: синхронизируем calculator_user_id,
 * если тендер в контуре просчёта или старый РП был считающим.
 * @returns {Promise<{ synced: boolean, notifiedTo: number|null }>}
 */
async function afterResponsiblePmChanged(db, {
  tenderId,
  oldTender,
  newPmId,
  actorName,
  actorUserId,
  log
}) {
  const tid = Number(tenderId);
  const newId = Number(newPmId);
  if (!tid || !newId) return { synced: false, notifiedTo: null };

  const oldPm = oldTender?.responsible_pm_id != null ? Number(oldTender.responsible_pm_id) : null;
  const oldCalc = oldTender?.calculator_user_id != null ? Number(oldTender.calculator_user_id) : null;
  if (oldPm === newId) return { synced: false, notifiedTo: null };

  const shouldSyncCalc = needsCalcHandoff(oldTender)
    || oldCalc == null
    || oldCalc === oldPm
    || oldCalc === Number(actorUserId);

  let synced = false;
  if (shouldSyncCalc) {
    await db.query(`
      UPDATE tenders SET
        calculator_user_id = $1,
        calculator_kind = COALESCE(calculator_kind, 'pm'),
        updated_at = NOW()
      WHERE id = $2
    `, [newId, tid]);
    await db.query(`
      UPDATE tender_rp_reviews
      SET calculator_user_id = $1, updated_at = NOW()
      WHERE tender_id = $2
        AND COALESCE(is_final, false) = false
    `, [newId, tid]).catch(() => {});
    synced = true;
  }

  const fresh = await db.query(
    'SELECT id, customer_name, tender_title, tender_status, registry_status, calculator_user_id, handoff_at, registry_no FROM tenders WHERE id = $1',
    [tid]
  );
  const tender = fresh.rows[0] || oldTender || { id: tid };
  const who = actorName || 'Коллега';

  if (synced || needsCalcHandoff(tender) || Number(tender.calculator_user_id) === newId) {
    await notifyPmCalcEvent(db, {
      userId: newId,
      kind: oldPm ? 'reassign' : 'assign',
      tender,
      actorName: who,
      log
    });
    if (oldCalc && oldCalc !== newId && (synced || oldCalc === oldPm)) {
      await notifyPmReleasedFromCalc(db, {
        userId: oldCalc,
        tender,
        actorName: who,
        log
      });
    } else if (oldPm && oldPm !== newId && oldPm !== oldCalc) {
      // Ответственный менялся, но считающим был кто-то другой — не шумим лишним.
    }
    return { synced, notifiedTo: newId };
  }

  // Общее назначение без контура просчёта — короткое уведомление + email
  const href = `#/tenders?id=${tid}`;
  const label = tenderLabel(tender);
  await createNotification(db, {
    user_id: newId,
    title: 'Тендер назначен вам',
    message: `${who} назначил тендер: ${label}`,
    type: 'tender',
    link: href
  }).catch(() => {});

  await sendAssignEmail(db, {
    userId: newId,
    subject: `АСГАРД CRM: тендер назначен вам — ${label}`.slice(0, 200),
    greetingLead: `${who} назначил вам тендер.`,
    tender,
    link: href,
    log
  });

  return { synced: false, notifiedTo: newId };
}

module.exports = {
  notifyPmCalcEvent,
  notifyPmReleasedFromCalc,
  afterResponsiblePmChanged,
  needsCalcHandoff,
  tenderLabel,
  sendAssignEmail
};
