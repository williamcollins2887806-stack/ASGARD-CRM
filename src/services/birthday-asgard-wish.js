'use strict';

/**
 * Официальное поздравление Асгарда имениннику:
 * persona → AI/fallback → Max→SMS + premium email + запись в birthday_asgard_wishes.
 */

const { collectPersonaFacts } = require('./birthday-persona');
const { deliver } = require('./huginn-notify');
const { sendCrmEmail } = require('./crm-mailer');

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fallbackAsgardTexts(facts) {
  const name = facts.firstName || facts.name || 'друг';
  const agePart = facts.age != null ? ` Тебе сегодня ${facts.age}.` : '';
  const highlights = (facts.highlights || []).slice(0, 3);
  const factLine = highlights.length
    ? ` ${highlights.map((h) => h.charAt(0).toUpperCase() + h.slice(1)).join('. ')}.`
    : '';

  const sms = [
    `${name}, команда Асгарда поздравляет тебя с днём рождения.${agePart}`,
    factLine.trim(),
    'Пусть день будет светлым. Зайди в CRM — там могут ждать дары от коллег.',
  ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

  const emailLines = [
    `${name},`,
    ``,
    `Сегодня твой день — и вся команда Асгарда это помнит.${agePart}`,
    factLine.trim() ? factLine.trim() : 'Ты часть нашей саги, и это важно.',
    ``,
    `Пусть впереди будут удачные решения, верные люди и спокойная сила.`,
    `Если зайдёшь в CRM — коллеги могли оставить тебе дары.`,
    ``,
    `С уважением,`,
    `Асгард`,
  ].filter((l, i, arr) => !(l === '' && arr[i - 1] === '')).join('\n');

  return { sms: sms.slice(0, 700), email: emailLines };
}

async function generateAsgardTexts(facts) {
  try {
    const ai = require('./ai-provider');
    const prompt = [
      `Напиши официальное поздравление от компании Асгард-Сервис сотруднику.`,
      `Имя: ${facts.name}. Обращение: ${facts.firstName}.`,
      facts.age != null ? `Возраст сегодня: ${facts.age}.` : '',
      facts.roleTitle ? `Роль: ${facts.roleTitle}.` : '',
      facts.highlights?.length ? `Факты из CRM (вплети 2–3 естественно): ${facts.highlights.join('; ')}.` : '',
      `Нужны ДВА текста:`,
      `1) SMS — до 500 знаков, плотный, тёплый, без воды.`,
      `2) EMAIL — 8–12 строк, как личное письмо от компании, уважение + тепло + северная сага без пародии.`,
      `Запрещены: канцелярит, «важно отметить», «таким образом», «ключевой», «оптимальный», «дорогой сотрудник», эмодзи-спам, markdown.`,
      `Не упоминай зарплату, маржу, налоги, себестоимость.`,
      `Формат ответа строго:`,
      `---SMS---`,
      `текст`,
      `---EMAIL---`,
      `текст`,
    ].filter(Boolean).join('\n');

    const result = await ai.completeFast({
      system: 'Ты голос компании Асгард. Пишешь живые короткие поздравления.',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 700,
      temperature: 0.75,
    });
    const raw = String(result && (result.text || result.content || result) || '');
    const smsMatch = raw.match(/---SMS---\s*([\s\S]*?)(?=---EMAIL---|$)/i);
    const emailMatch = raw.match(/---EMAIL---\s*([\s\S]*?)$/i);
    let sms = (smsMatch && smsMatch[1] || '').trim().replace(/\*\*/g, '');
    let email = (emailMatch && emailMatch[1] || '').trim().replace(/\*\*/g, '');
    if (sms.length >= 40 && email.length >= 80) {
      return { sms: sms.slice(0, 700), email, source: 'ai' };
    }
  } catch (_) { /* fallback below */ }
  const fb = fallbackAsgardTexts(facts);
  return { ...fb, source: 'fallback' };
}

function buildPremiumEmailHtml({ name, age, tenureLabel, highlights, bodyText }) {
  const factsHtml = (highlights || []).slice(0, 4).map((h) =>
    `<tr><td style="padding:6px 0;color:#E8D5A3;font-size:14px;letter-spacing:0.02em;">✦ ${escHtml(h)}</td></tr>`
  ).join('');

  const bodyHtml = escHtml(bodyText).replace(/\n/g, '<br>');
  const meta = [
    age != null ? `${age} лет` : null,
    tenureLabel ? `с нами ${tenureLabel}` : null,
  ].filter(Boolean).join(' · ');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#0B0A09;color:#F5F0E6;font-family:Georgia,'Times New Roman',serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0B0A09;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;background:linear-gradient(180deg,#161310 0%,#0F0E0C 100%);border:1px solid #8B7340;border-radius:16px;overflow:hidden;">
        <tr><td style="padding:28px 28px 12px;text-align:center;border-bottom:1px solid rgba(212,168,67,0.35);">
          <div style="font-size:11px;letter-spacing:0.28em;text-transform:uppercase;color:#D4A843;">Асгард · день воина</div>
          <div style="margin-top:14px;font-size:28px;line-height:1.2;color:#F8F1DE;">${escHtml(name)}</div>
          ${meta ? `<div style="margin-top:8px;font-size:13px;color:#C4B58A;">${escHtml(meta)}</div>` : ''}
        </td></tr>
        ${factsHtml ? `<tr><td style="padding:18px 28px 0;"><table width="100%">${factsHtml}</table></td></tr>` : ''}
        <tr><td style="padding:22px 28px 8px;font-size:16px;line-height:1.55;color:#F5F0E6;">${bodyHtml}</td></tr>
        <tr><td style="padding:8px 28px 28px;font-size:13px;color:#A89870;">
          В CRM могут ждать дары от коллег — открой, когда будет минута.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function channelStatusFromAttempts(attempts, channel) {
  const hit = (attempts || []).filter((a) => a.channel === channel);
  if (!hit.length) return 'skipped';
  if (hit.some((a) => a.ok)) return 'sent';
  return 'failed';
}

/**
 * Создаёт (или возвращает существующее) пожелание и доставляет каналы.
 * Идемпотентно по (user_id, birthday_year).
 */
async function ensureAndDeliverAsgardWish(db, userId, log) {
  const year = new Date().getFullYear();
  const existing = await db.query(
    `SELECT * FROM birthday_asgard_wishes WHERE user_id = $1 AND birthday_year = $2`,
    [userId, year]
  );
  if (existing.rows[0]?.sent_at) {
    return { skipped: true, reason: 'already_sent', row: existing.rows[0] };
  }

  const facts = await collectPersonaFacts(db, userId);
  if (!facts) return { skipped: true, reason: 'user_missing' };

  const texts = await generateAsgardTexts(facts);
  const html = buildPremiumEmailHtml({
    name: facts.name,
    age: facts.age,
    tenureLabel: facts.tenure?.label || null,
    highlights: facts.highlights,
    bodyText: texts.email,
  });

  let row;
  if (existing.rows[0]) {
    row = existing.rows[0];
    await db.query(`
      UPDATE birthday_asgard_wishes
      SET message_sms = $2, message_email = $3, facts_json = $4::jsonb
      WHERE id = $1
    `, [row.id, texts.sms, texts.email, JSON.stringify({ ...facts.counts, highlights: facts.highlights, source: texts.source })]);
  } else {
    const ins = await db.query(`
      INSERT INTO birthday_asgard_wishes
        (user_id, birthday_year, message_sms, message_email, facts_json)
      VALUES ($1, $2, $3, $4, $5::jsonb)
      ON CONFLICT (user_id, birthday_year) DO UPDATE
        SET message_sms = EXCLUDED.message_sms,
            message_email = EXCLUDED.message_email,
            facts_json = EXCLUDED.facts_json
      RETURNING *
    `, [userId, year, texts.sms, texts.email, JSON.stringify({ ...facts.counts, highlights: facts.highlights, source: texts.source })]);
    row = ins.rows[0];
  }

  // Max → SMS (короткий текст). Email — отдельно всегда.
  let maxStatus = 'skipped';
  let smsStatus = 'skipped';
  let emailStatus = 'skipped';
  const dryRun = process.env.BIRTHDAY_DELIVERY_DRY_RUN === '1'
    || process.env.BIRTHDAY_DELIVERY_DRY_RUN === 'true';

  if (dryRun) {
    maxStatus = facts.phone ? 'skipped' : 'skipped';
    smsStatus = 'skipped';
    emailStatus = facts.email ? 'skipped' : 'skipped';
    log?.info?.(`[BirthdayAsgard] dry-run user=${userId} (channels not sent)`);
  } else {
    if (facts.phone) {
      const messenger = await deliver(db, {
        phone: facts.phone,
        text: texts.sms,
        order: ['max', 'sms'],
        logger: log,
        subject: `Асгард поздравляет тебя, ${facts.firstName}`,
      });
      maxStatus = channelStatusFromAttempts(messenger.attempts, 'max');
      smsStatus = channelStatusFromAttempts(messenger.attempts, 'sms');
      if (messenger.channel === 'max') {
        maxStatus = 'sent';
        if (smsStatus === 'failed') smsStatus = 'skipped';
      } else if (messenger.channel === 'sms') {
        smsStatus = 'sent';
      }
    }

    if (facts.email) {
      try {
        await sendCrmEmail(db, null, {
          to: facts.email,
          subject: `Асгард поздравляет тебя, ${facts.firstName}`,
          text: texts.email,
          html,
          skipBcc: true,
        });
        emailStatus = 'sent';
      } catch (err) {
        emailStatus = 'failed';
        log?.warn?.({ err }, `[BirthdayAsgard] email failed user=${userId}`);
      }
    }
  }

  await db.query(`
    UPDATE birthday_asgard_wishes
    SET max_status = $2, sms_status = $3, email_status = $4, sent_at = NOW()
    WHERE id = $1
  `, [row.id, maxStatus, smsStatus, emailStatus]);

  log?.info?.(`[BirthdayAsgard] user=${userId} max=${maxStatus} sms=${smsStatus} email=${emailStatus} src=${texts.source}`);
  return { ok: true, maxStatus, smsStatus, emailStatus, source: texts.source };
}

module.exports = {
  ensureAndDeliverAsgardWish,
  generateAsgardTexts,
  buildPremiumEmailHtml,
  fallbackAsgardTexts,
};
