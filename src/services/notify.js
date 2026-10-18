'use strict';

/**
 * Notification helper — запись в БД + SSE + web-push.
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ Telegram ИСКЛЮЧЁН намеренно (заказчик 18.10.2026): «у нас телеграм не
 * работает — либо смс манго, либо макс». Раньше здесь была отправка в Telegram,
 * из-за чего складывалось впечатление, что код/уведомление придёт в Telegram,
 * хотя рабочие получают его в MAX (Green API) или SMS (Mango).
 *
 * Рабочие каналы доставки:
 *   • MAX через Green API — src/services/green-api.js (sendMaxMessage)
 *   • SMS через Mango      — src/services/mango.js
 *   • web-push + SSE + запись в notifications (этот файл)
 */

const { toPlainText } = require('../lib/plain-text');

/** Push / cold-open: desktop `#/path` → mobile `/m/path`. */
function toPushUrl(link) {
  if (!link) return '/m/';
  const s = String(link).trim();
  if (s.startsWith('/m/') || s === '/m') return s;
  if (s.startsWith('#/')) return `/m/${s.slice(2)}`;
  if (s.startsWith('#')) return `/m/${s.slice(1)}`;
  if (s.startsWith('/') && !s.startsWith('/api') && !s.startsWith('/v2')) {
    if (s.startsWith('/m')) return s;
    return `/m${s}`;
  }
  return s;
}

async function createNotification(db, { user_id, title, message, type, link }) {
  try {
    await db.query(`
      INSERT INTO notifications (user_id, title, message, type, link, is_read, created_at)
      VALUES ($1, $2, $3, $4, $5, false, NOW())
    `, [user_id, title, message, type || 'info', link || null]);

    // SSE real-time notification event
    try {
      const { sendToUser } = require('../routes/sse');
      const countRes = await db.query(
        'SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false',
        [user_id]
      );
      const unreadCount = parseInt(countRes.rows[0].count, 10);
      sendToUser(user_id, 'notification', {
        title, message, type: type || 'info', link: link || null,
        unread_count: unreadCount
      });
    } catch (e) { /* SSE may not be available */ }

    // Telegram ИСКЛЮЧЁН (заказчик 18.10.2026): не работает, каналы — MAX/SMS/push.
    // Блок удалён, чтобы не создавать ложное впечатление доставки в Telegram.

    // Push notification (web-push)
    try {
      // Get unread count for badge
      const countRes = await db.query(
        'SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false',
        [user_id]
      );
      const badgeCount = parseInt(countRes.rows[0].count, 10);

      // Send push to all registered devices
      let webpush;
      try { webpush = require('web-push'); } catch (e) { webpush = null; }
      if (webpush) {
        const publicKey = process.env.VAPID_PUBLIC_KEY;
        const privateKey = process.env.VAPID_PRIVATE_KEY;
        if (publicKey && privateKey) {
          const email = process.env.VAPID_EMAIL || 'mailto:admin@asgard-crm.ru';
          webpush.setVapidDetails(email, publicKey, privateKey);

          const subs = await db.query(
            'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1',
            [user_id]
          );
          const payload = JSON.stringify({
            title: toPlainText(title).replace(/\s*\n+\s*/g, ' ').trim() || title,
            body: toPlainText(message || '').replace(/\s*\n+\s*/g, ' ').trim(),
            url: toPushUrl(link),
            // Уникальный tag на каждое уведомление: одинаковый tag заставлял ОС
            // молча подменять предыдущее уведомление (без звука/вибрации).
            tag: (type || 'asgard') + '-' + Date.now(),
            badge_count: badgeCount,
            icon: './assets/img/icon-192.png'
          });
          let pushSent = 0;
          for (const sub of subs.rows) {
            try {
              await webpush.sendNotification({
                endpoint: sub.endpoint,
                keys: { p256dh: sub.p256dh, auth: sub.auth }
              }, payload, { urgency: 'high', TTL: 60 * 60 });
              pushSent++;
            } catch (pushErr) {
              if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
                await db.query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]);
              }
            }
          }
          if (pushSent > 0) console.log(`[notify] Push sent to user ${user_id}: ${pushSent}/${subs.rows.length} devices`);
        }
      }
    } catch (e) {
      // Push may not be configured
    }
  } catch (e) {
    console.error('[notify] Error:', e.message);
  }
}

/**
 * Только web-push (без строки в notifications): входящий звонок, tag схлопывается.
 */
async function sendIncomingCallPush(db, userId, { title, body, from, tag, type, call_id, kind } = {}) {
  if (!userId) return;
  try {
    let webpush;
    try { webpush = require('web-push'); } catch (e) { webpush = null; }
    if (!webpush) return;
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    if (!publicKey || !privateKey) return;
    const email = process.env.VAPID_EMAIL || 'mailto:admin@asgard-crm.ru';
    webpush.setVapidDetails(email, publicKey, privateKey);
    const subs = await db.query(
      'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1',
      [userId]
    );
    const who = from || '';
    const isHuginnCall = String(type) === 'call' && call_id != null;
    const payload = JSON.stringify({
      title: title || 'Входящий звонок',
      body: body || (who ? String(who) : 'Ответьте в приложении'),
      url: isHuginnCall ? ('/?call=' + encodeURIComponent(call_id)) : '/m/telephony?wake=1',
      tag: tag || (isHuginnCall ? ('call-' + call_id) : 'telephony-incoming'),
      requireInteraction: true,
      icon: './assets/img/icon-192.png',
      type: type || null,
      call_id: call_id != null ? call_id : null,
      kind: kind || null,
      actions: isHuginnCall
        ? [{ action: 'accept', title: 'Принять' }, { action: 'decline', title: 'Отклонить' }]
        : undefined
    });
    for (const sub of subs.rows) {
      try {
        await webpush.sendNotification({
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        }, payload, { urgency: 'high', TTL: 60 });
      } catch (pushErr) {
        if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
          await db.query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]);
        }
      }
    }
  } catch (e) {
    console.error('[notify] incoming push:', e.message);
  }
}

module.exports = { createNotification, toPushUrl, sendIncomingCallPush };
