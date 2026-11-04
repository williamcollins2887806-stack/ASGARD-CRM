'use strict';

/**
 * AI-текст подарка от коллеги (async «по дороге»).
 * Fallback-шаблоны без канцелярита и ИИ-штампов.
 */

const TONE_HINT = {
  warm: 'тёплый, человечный, без пафоса',
  saga: 'в духе северной саги Асгарда, уважительный, без пародии',
  light: 'лёгкий, с мягкой улыбкой, без шуток ниже пояса',
};

function fallbackPeerWish(fromName, toName, tone) {
  const from = fromName || 'Коллега';
  const to = toName || 'друг';
  if (tone === 'saga') {
    return [
      `${to},`,
      ``,
      `В зале Асгарда сегодня твой день.`,
      `От меня, ${from}, — дар и короткое слово:`,
      `пусть рука будет верной, а путь — светлым.`,
      `С днём рождения. Мы рядом.`,
    ].join('\n');
  }
  if (tone === 'light') {
    return [
      `${to}, с днём рождения!`,
      ``,
      `Пусть день будет лёгким, кофе — горячим,`,
      `а задачи сами себя боятся.`,
      `От ${from} — с теплом и без лишней канители.`,
    ].join('\n');
  }
  return [
    `${to},`,
    ``,
    `Поздравляю тебя с днём рождения.`,
    `Спасибо, что ты в команде — с тобой спокойнее и сильнее.`,
    `Пусть этот год принесёт удачу и хороших людей рядом.`,
    ``,
    `Твой коллега, ${from}`,
  ].join('\n');
}

function stripAiJunk(text) {
  return String(text || '')
    .replace(/\*\*/g, '')
    .replace(/^["«]|["»]$/g, '')
    .trim();
}

async function generatePeerWishText({ fromName, toName, tone, age }) {
  const safeTone = TONE_HINT[tone] ? tone : 'warm';
  let text = null;
  try {
    const ai = require('./ai-provider');
    const prompt = [
      `Напиши личное поздравление с днём рождения коллеге.`,
      `От кого: ${fromName}. Кому: ${toName}.`,
      age != null ? `Возраст сегодня: ${age}.` : '',
      `Тон: ${TONE_HINT[safeTone]}.`,
      `4–10 коротких строк. На русском.`,
      `Без канцелярита, без фраз вроде «важно отметить», «таким образом», «ключевой», «оптимальный».`,
      `Без эмодзи-спама. Без markdown. Без обращения «дорогой сотрудник».`,
      `Только текст поздравления, без пояснений.`,
    ].filter(Boolean).join('\n');

    const result = await ai.completeFast({
      system: 'Ты пишешь короткие живые поздравления для команды Асгард-Сервис.',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 400,
      temperature: 0.8,
    });
    text = stripAiJunk(result && (result.text || result.content || result));
  } catch (_) {
    text = null;
  }

  if (!text || text.length < 40) {
    return { text: fallbackPeerWish(fromName, toName, safeTone), source: 'fallback' };
  }
  const lines = text.split(/\n/).filter((l) => l.trim()).length;
  if (lines > 14) {
    text = text.split(/\n/).filter((l) => l.trim()).slice(0, 10).join('\n');
  }
  return { text, source: 'ai' };
}

/**
 * Заполняет message_text для gift id (fire-and-forget safe).
 */
async function fulfillGiftMessage(db, giftId, log) {
  const { rows } = await db.query(`
    SELECT g.id, g.tone, g.message_status,
           COALESCE(NULLIF(f.name, ''), f.login) AS from_name,
           COALESCE(NULLIF(t.name, ''), t.login) AS to_name,
           t.birth_date
    FROM birthday_gifts g
    JOIN users f ON f.id = g.from_user_id
    JOIN users t ON t.id = g.to_user_id
    WHERE g.id = $1
  `, [giftId]);
  const gift = rows[0];
  if (!gift) return;
  if (gift.message_status === 'ready' && gift.message_text) return;

  let age = null;
  try {
    const { calcAge } = require('./birthday-persona');
    age = calcAge(gift.birth_date);
  } catch (_) { /* optional */ }

  const { text } = await generatePeerWishText({
    fromName: gift.from_name,
    toName: gift.to_name,
    tone: gift.tone,
    age,
  });

  await db.query(`
    UPDATE birthday_gifts
    SET message_text = $2, message_status = 'ready'
    WHERE id = $1
  `, [giftId, text]);
  log?.info?.(`[BirthdayWish] gift=${giftId} ready`);
}

function kickFulfill(db, giftId, log) {
  setImmediate(() => {
    fulfillGiftMessage(db, giftId, log).catch((err) => {
      log?.warn?.({ err }, `[BirthdayWish] gift=${giftId} failed, writing fallback`);
      db.query(`
        SELECT g.tone,
               COALESCE(NULLIF(f.name, ''), f.login) AS from_name,
               COALESCE(NULLIF(t.name, ''), t.login) AS to_name
        FROM birthday_gifts g
        JOIN users f ON f.id = g.from_user_id
        JOIN users t ON t.id = g.to_user_id
        WHERE g.id = $1
      `, [giftId]).then(({ rows }) => {
        const g = rows[0];
        const text = fallbackPeerWish(g?.from_name, g?.to_name, g?.tone || 'warm');
        return db.query(`
          UPDATE birthday_gifts
          SET message_text = $2, message_status = 'ready'
          WHERE id = $1 AND message_status <> 'ready'
        `, [giftId, text]);
      }).catch(() => {});
    });
  });
}

module.exports = {
  generatePeerWishText,
  fulfillGiftMessage,
  kickFulfill,
  fallbackPeerWish,
};
