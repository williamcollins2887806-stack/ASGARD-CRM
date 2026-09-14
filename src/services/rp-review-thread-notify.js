'use strict';

const { createNotification } = require('./notify');

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function clip(text, max = 400) {
  const s = String(text || '').trim();
  if (!s) return '';
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/**
 * Уведомить получателей о новом сообщении в чате отчёта РП.
 * Чат видят все ТО/РП; письмо на почту со стороны ТО — только кто внёс тендер
 * (created_by / created_by_user_id). РП при ответе ТО по-прежнему получают почту.
 */
async function notifyOnThreadMessage(db, {
  tenderId,
  messageId,
  senderUserId,
  senderName,
  senderRole,
  body,
  files,
  log
}) {
  const tRes = await db.query(`
    SELECT t.id, t.registry_no, t.customer_name, t.tender_title,
           t.created_by, t.created_by_user_id,
           u.email AS owner_email, u.name AS owner_name, u.role AS owner_role
    FROM tenders t
    LEFT JOIN users u ON u.id = COALESCE(t.created_by_user_id, t.created_by)
    WHERE t.id = $1 AND t.deleted_at IS NULL
  `, [tenderId]);
  const tender = tRes.rows[0];
  if (!tender) return;

  const ownerId = Number(tender.created_by_user_id || tender.created_by) || null;

  const revRes = await db.query(`
    SELECT calculator_user_id, started_by_user_id, director_review_status
    FROM tender_rp_reviews WHERE tender_id = $1
  `, [tenderId]);
  const review = revRes.rows[0] || {};
  const directorPhase = ['pending', 'approved'].includes(review.director_review_status || '');

  const collabRes = await db.query(`
    SELECT c.pm_user_id
    FROM tender_rp_review_collaborators c
    WHERE c.tender_id = $1 AND c.revoked_at IS NULL
  `, [tenderId]);

  const dutyRes = await db.query(`
    SELECT pm_user_id FROM pm_duty_roster
    WHERE period_start <= CURRENT_DATE AND period_end >= CURRENT_DATE
    ORDER BY period_start DESC LIMIT 1
  `);
  const dutyPmId = dutyRes.rows[0]?.pm_user_id;

  const senderIsTo = ['TO', 'HEAD_TO'].includes(senderRole);
  const senderIsDirector = ['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'ADMIN'].includes(senderRole)
    && !senderIsTo && !['PM', 'HEAD_PM'].includes(senderRole);
  const recipientIds = new Set();

  // In-app: владелец строки всегда в курсе (если не сам пишет)
  if (ownerId) recipientIds.add(ownerId);

  if (senderIsDirector) {
    if (review.calculator_user_id) recipientIds.add(Number(review.calculator_user_id));
    if (review.started_by_user_id) recipientIds.add(Number(review.started_by_user_id));
    if (dutyPmId) recipientIds.add(Number(dutyPmId));
  } else if (senderIsTo) {
    // ТО пишет → дежурный / считающий / стартовавший / соавторы
    if (review.calculator_user_id) recipientIds.add(Number(review.calculator_user_id));
    if (review.started_by_user_id) recipientIds.add(Number(review.started_by_user_id));
    if (dutyPmId) recipientIds.add(Number(dutyPmId));
    for (const c of collabRes.rows) recipientIds.add(Number(c.pm_user_id));
    if (directorPhase) {
      const dirs = await db.query(
        `SELECT id FROM users WHERE role = ANY($1::text[]) AND COALESCE(is_active, true) = true`,
        [['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV']]
      );
      for (const u of dirs.rows) recipientIds.add(Number(u.id));
    }
  } else {
    // РП пишет → только владелец тендера (+ директора в фазе согласования).
    // Больше НЕ рассылаем всем HEAD_TO / тестовым аккаунтам.
    if (directorPhase) {
      const dirs = await db.query(
        `SELECT id FROM users WHERE role = ANY($1::text[]) AND COALESCE(is_active, true) = true`,
        [['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV']]
      );
      for (const u of dirs.rows) recipientIds.add(Number(u.id));
    }
  }

  recipientIds.delete(Number(senderUserId));
  // Не слать на тестовые/служебные фейковые аккаунты, если владелец уже есть
  if (ownerId) {
    const junk = await db.query(
      `SELECT id FROM users WHERE id = ANY($1::int[])
         AND (
           LOWER(COALESCE(name,'')) LIKE 'тест%'
           OR LOWER(COALESCE(name,'')) LIKE 'test %'
           OR LOWER(COALESCE(email,'')) LIKE '%@test.%'
           OR LOWER(COALESCE(email,'')) LIKE 'test_%'
         )`,
      [[...recipientIds]]
    );
    for (const u of junk.rows) {
      if (Number(u.id) !== ownerId) recipientIds.delete(Number(u.id));
    }
  }

  if (!recipientIds.size) return;

  const usersRes = await db.query(
    `SELECT id, name, email, role FROM users WHERE id = ANY($1::int[]) AND COALESCE(is_active, true) = true`,
    [[...recipientIds]]
  );

  const regNo = tender.registry_no || tender.id;
  const customer = tender.customer_name || '—';
  const subjectTitle = (tender.tender_title || '').trim();
  const shortTitle = clip(subjectTitle, 80) || '—';
  const appUrl = (process.env.PUBLIC_APP_URL || 'https://asgard-crm.ru').replace(/\/$/, '');
  const roleLabel = senderIsDirector ? 'Директор' : (senderIsTo ? 'ТО' : 'РП');
  const snippet = clip(body, 300);
  const fileList = (files || []).map((f) => f.original_name || f.filename).filter(Boolean);

  for (const u of usersRes.rows) {
    const title = `Вопрос по №${regNo} · ${customer}`;
    const message = `${shortTitle}\n${senderName || roleLabel} (${roleLabel}): ${snippet || '(вложение)'}`;
    const isDirectorRecipient = ['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'ADMIN'].includes(u.role || '');
    const isToRecipient = ['TO', 'HEAD_TO'].includes(u.role || '');
    const link = isDirectorRecipient && directorPhase
      ? `#/director-tender-approvals?id=${tenderId}&tab=chat`
      : `#/tenders?id=${tenderId}&rp=chat`;
    const fullLink = `${appUrl}/${link.replace(/^#\//, '#/')}`;

    try {
      await createNotification(db, {
        user_id: u.id,
        title,
        message,
        type: 'tender',
        link
      });
    } catch (e) {
      log?.warn?.({ err: e, userId: u.id }, 'thread in-app notify failed');
    }

    // Почта ТО/HEAD_TO — только создателю тендера (коллеги видят чат в CRM без спама).
    if (isToRecipient && ownerId && Number(u.id) !== ownerId) continue;

    const email = String(u.email || '').trim();
    if (!email) continue;

    try {
      const { sendCrmEmail } = require('./crm-mailer');
      const subject = `АСГАРД CRM: вопрос — №${regNo} ${customer}`;
      const textParts = [
        `Здравствуйте, ${u.name || 'коллега'}!`,
        '',
        `${senderName || 'Коллега'} (${roleLabel}) написал в чате отчёта:`,
        '',
        `Тендер: №${regNo}`,
        `Заказчик: ${customer}`,
        `Предмет: ${subjectTitle || '—'}`,
        '',
        'Вопрос:',
        snippet || '(без текста)',
        ''
      ];
      if (fileList.length) {
        textParts.push('Вложения:', ...fileList.map((n) => `• ${n}`), '');
      }
      textParts.push(`Открыть отчёт: ${fullLink}`, '', '— АСГАРД CRM (автоуведомление)');

      const htmlParts = [
        `<p>Здравствуйте, ${escapeHtml(u.name || 'коллега')}!</p>`,
        `<p><strong>${escapeHtml(senderName || 'Коллега')}</strong> (${roleLabel}) написал в чате отчёта:</p>`,
        '<table style="border-collapse:collapse;margin:8px 0 12px;font-size:14px">',
        `<tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top">Тендер</td><td>№${escapeHtml(String(regNo))}</td></tr>`,
        `<tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top">Заказчик</td><td>${escapeHtml(customer)}</td></tr>`,
        `<tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top">Предмет</td><td>${escapeHtml(subjectTitle || '—')}</td></tr>`,
        '</table>',
        `<p style="margin:0 0 4px;color:#666;font-size:13px">Вопрос:</p>`,
        `<blockquote style="margin:0 0 12px;padding:10px 14px;border-left:4px solid #D4A843;background:rgba(212,168,67,0.08)">${escapeHtml(snippet || '(без текста)')}</blockquote>`
      ];
      if (fileList.length) {
        htmlParts.push('<p><strong>Вложения:</strong></p><ul>');
        for (const n of fileList) htmlParts.push(`<li>${escapeHtml(n)}</li>`);
        htmlParts.push('</ul>');
      }
      htmlParts.push(
        `<p style="margin-top:16px"><a href="${fullLink}" style="display:inline-block;padding:12px 24px;background:#1E4D8C;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">Открыть отчёт и ответить</a></p>`
      );

      await sendCrmEmail(db, null, {
        to: email,
        subject,
        text: textParts.join('\n'),
        html: htmlParts.join('')
      });
    } catch (e) {
      log?.warn?.({ err: e, email, messageId }, 'thread email notify failed');
    }
  }
}

module.exports = { notifyOnThreadMessage };
