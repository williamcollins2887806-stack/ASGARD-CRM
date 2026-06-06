'use strict';
/**
 * WhatsApp / Green API вебхук + синхронизация участников группы
 *
 * Маршруты:
 *  GET  /wa-webhook/status         — состояние инстанса
 *  POST /wa-webhook/setup          — зарегистрировать вебхук в Green API
 *  POST /wa-webhook/event          — принимать события (публичный)
 *  POST /wa-webhook/sync/:work_id  — синхронизировать состав группы из WA API
 *  POST /wa-webhook/check-phones   — проверить WA-наличие телефонов (с кэшем 24ч)
 */

module.exports = async function waWebhookRoutes(fastify, opts) {
  const db = fastify.db || fastify.pg || (opts && opts.db);

  fastify.get('/wa-webhook/status', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const ga = require('../services/green-api');
    if (!ga.isEnabled()) return reply.send({ enabled: false, message: 'GREEN_API не настроен' });
    const state = await ga.getState();
    return reply.send({ enabled: true, state });
  });

  fastify.post('/wa-webhook/setup', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const ga = require('../services/green-api');
    if (!ga.isEnabled()) return reply.code(400).send({ error: 'GREEN_API не настроен' });
    const webhookUrl = 'https://asgard-crm.ru/api/wa-webhook/event';
    try {
      await ga.setWebhook(webhookUrl);
      return reply.send({ ok: true, webhookUrl });
    } catch (e) {
      return reply.code(500).send({ error: e.message });
    }
  });

  fastify.post('/wa-webhook/event', async (req, reply) => {
    try {
      const body = req.body;
      if (!body) return reply.send({ ok: true });
      const ga = require('../services/green-api');
      const type = body.typeWebhook;

      if (type === 'incomingMessageReceived') {
        const msgData = body.messageData;

        // ── Бот закупок: личное ТЕКСТОВОЕ сообщение (не группа) ──
        const chatId = (body.senderData && body.senderData.chatId) || body.chatId || '';
        const isPrivate = String(chatId).endsWith('@c.us');
        if (isPrivate && msgData && msgData.typeMessage === 'textMessage') {
          const txt = msgData.textMessageData && msgData.textMessageData.textMessage;
          if (txt) {
            try {
              const bot = require('../services/procurement-bot');
              const { createNotification } = require('../services/notify');
              await bot.handleMessage(db, createNotification, chatId, txt, async (answer) => {
                const phone = ga.toDigits(String(chatId).replace('@c.us', ''));
                if (phone) await ga.sendMessage(phone, answer);
              });
            } catch (botErr) {
              fastify.log.error('[procurement-bot] error: ' + botErr.message);
            }
          }
          return reply.send({ ok: true });
        }

        if (msgData && msgData.typeMessage === 'participantsUpdateMessage') {
          const update = msgData.participantsUpdateMessageData;
          const groupId = (body.senderData && body.senderData.chatId) || body.chatId;
          if (update && update.action === 'add' && groupId && update.participants) {
            for (const pId of update.participants) {
              const digits = ga.toDigits(pId.replace('@c.us', ''));
              if (!digits) continue;
              await db.query(
                `UPDATE employee_assignments ea
                 SET wa_joined_at = NOW(), wa_invite_status = 'joined'
                 FROM works w, employees e
                 WHERE w.id = ea.work_id AND e.id = ea.employee_id
                   AND w.wa_group_id = $1
                   AND (
                     REGEXP_REPLACE(COALESCE(e.phone,''), '[^0-9]', '', 'g') = $2
                     OR REGEXP_REPLACE(COALESCE(e.phone2,''), '[^0-9]', '', 'g') = $2
                     OR e.wa_phone = $2
                   )`,
                [groupId, digits]
              );
            }
          }
          if (update && update.action === 'remove' && groupId && update.participants) {
            for (const pId of update.participants) {
              const digits = ga.toDigits(pId.replace('@c.us', ''));
              if (!digits) continue;
              await db.query(
                `UPDATE employee_assignments ea
                 SET wa_invite_status = 'left'
                 FROM works w, employees e
                 WHERE w.id = ea.work_id AND e.id = ea.employee_id
                   AND w.wa_group_id = $1
                   AND (
                     REGEXP_REPLACE(COALESCE(e.phone,''), '[^0-9]', '', 'g') = $2
                     OR REGEXP_REPLACE(COALESCE(e.phone2,''), '[^0-9]', '', 'g') = $2
                     OR e.wa_phone = $2
                   )`,
                [groupId, digits]
              );
            }
          }
        }
      }
      if (type === 'stateInstanceChanged') {
        fastify.log.info('[WA webhook] state: ' + body.stateInstance);
      }
      return reply.send({ ok: true });
    } catch (err) {
      fastify.log.error('[WA webhook] error: ' + err.message);
      return reply.send({ ok: true });
    }
  });

  // Синхронизировать состав WA-группы — один запрос в Green API
  fastify.post('/wa-webhook/sync/:work_id', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    try {
      const workId = parseInt(req.params.work_id);
      const ga = require('../services/green-api');
      if (!ga.isEnabled()) return reply.send({ ok: false, reason: 'disabled' });

      const { rows: [work] } = await db.query('SELECT wa_group_id FROM works WHERE id = $1', [workId]);
      if (!work || !work.wa_group_id) return reply.send({ ok: false, reason: 'no_group' });

      const state = await ga.getState();
      if (state !== 'authorized') return reply.send({ ok: false, reason: 'not_authorized', state });

      const members = await ga.getGroupMembers(work.wa_group_id);
      if (!members.length) return reply.send({ ok: true, synced: 0, joined: 0, total_members: 0 });

      const memberDigits = new Set(
        members.map(function(m) {
          var d = m.replace('@c.us', '').replace(/\D/g, '');
          if (d.startsWith('8') && d.length === 11) d = '7' + d.slice(1);
          if (d.length === 11 && d.startsWith('7')) return d;
          if (d.length === 10) return '7' + d;
          return null;
        }).filter(Boolean)
      );

      const { rows: crew } = await db.query(
        `SELECT ea.id, ea.wa_invite_status,
                e.phone, e.phone2, e.wa_phone
         FROM employee_assignments ea
         JOIN employees e ON e.id = ea.employee_id
         WHERE ea.work_id = $1 AND ea.is_active = true`,
        [workId]
      );

      var joined = 0, updated = 0;
      for (var i = 0; i < crew.length; i++) {
        var row = crew[i];
        var phones = [row.phone, row.phone2, row.wa_phone].filter(Boolean);
        var inGroup = false;
        for (var j = 0; j < phones.length; j++) {
          var d = phones[j].replace('@c.us', '').replace(/\D/g, '');
          if (d.startsWith('8') && d.length === 11) d = '7' + d.slice(1);
          if (d.length === 10) d = '7' + d;
          if (memberDigits.has(d)) { inGroup = true; break; }
        }

        if (inGroup) {
          joined++;
          if (row.wa_invite_status !== 'joined') {
            await db.query(
              `UPDATE employee_assignments SET wa_invite_status='joined', wa_joined_at=NOW() WHERE id=$1`,
              [row.id]
            );
            updated++;
          }
        } else if (row.wa_invite_status === 'joined') {
          await db.query(`UPDATE employee_assignments SET wa_invite_status='left' WHERE id=$1`, [row.id]);
          updated++;
        }
      }

      return reply.send({ ok: true, synced: updated, joined: joined, total_members: members.length });
    } catch (err) {
      fastify.log.error('[wa-sync] error: ' + err.message);
      return reply.code(500).send({ error: err.message });
    }
  });

  // Проверить WA-наличие телефонов бригады (кэш 24ч)
  fastify.post('/wa-webhook/check-phones', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    try {
      var body2 = req.body || {};
      var employee_ids = body2.employee_ids;
      var force = body2.force || false;
      const ga = require('../services/green-api');
      if (!ga.isEnabled()) return reply.send({ ok: false, reason: 'disabled' });

      const state = await ga.getState();
      if (state !== 'authorized') return reply.send({ ok: false, reason: 'not_authorized', state });

      var qStr = 'SELECT id, phone, phone2, wa_phone FROM employees WHERE phone IS NOT NULL';
      var params = [];
      if (employee_ids && employee_ids.length > 0) {
        qStr += ' AND id = ANY($1)'; params.push(employee_ids);
      }
      if (!force) {
        qStr += ' AND (wa_phone_checked_at IS NULL OR wa_phone_checked_at < NOW() - INTERVAL \'24 hours\')';
      }
      const { rows: emps } = await db.query(qStr, params);

      var results = [];
      for (var k = 0; k < emps.length; k++) {
        var emp = emps[k];
        var phones2 = [emp.phone, emp.phone2].filter(Boolean);
        var waPhone = await ga.findWhatsappPhone(phones2);
        await db.query(
          'UPDATE employees SET wa_phone=$1, wa_phone_checked_at=NOW() WHERE id=$2',
          [waPhone, emp.id]
        );
        results.push({ id: emp.id, wa_phone: waPhone, has_wa: Boolean(waPhone) });
      }
      return reply.send({ ok: true, checked: results.length, results: results });
    } catch (err) {
      fastify.log.error('[check-phones] error: ' + err.message);
      return reply.code(500).send({ error: err.message });
    }
  });
};
