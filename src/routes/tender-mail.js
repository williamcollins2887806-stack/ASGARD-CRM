'use strict';

/**
 * Public tender calc mail: GET/POST /tender-mail/:token
 * Поддерживает адресное согласование (V353) и legacy-токен одного директора.
 */
const tenderMail = require('../services/tender-director-mail');

module.exports = async function tenderMailRoutes(fastify) {
  const db = fastify.db;

  function sendPage(reply, code, html) {
    return reply.code(code).type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(html);
  }

  fastify.get('/:token', async (request, reply) => {
    const found = await tenderMail.lookupDecideToken(db, request.params.token);
    if (!found.ok) {
      const map = {
        invalid: 'Некорректная ссылка',
        not_found: 'Ссылка не найдена',
        used: 'По этой ссылке уже принято решение',
        expired: 'Срок ссылки истёк'
      };
      return sendPage(reply, 200,
        tenderMail.landingMessageHtml('Ссылка недоступна', map[found.reason] || map.not_found, 'err'));
    }
    if (found.tender.director_review_status && found.tender.director_review_status !== 'pending') {
      const done = found.tender.director_review_status === 'approved'
        ? 'Просчёт уже согласован.'
        : 'Просчёт уже отклонён.';
      return sendPage(reply, 200, tenderMail.landingMessageHtml('Уже решено', done, 'warn'));
    }
    const recipientLabel = found.recipient ? found.recipient.label : null;
    return sendPage(reply, 200,
      tenderMail.landingActionHtml(found.tender, found.review, request.params.token, recipientLabel, found.expectedFrom || ''));
  });

  fastify.post('/:token', async (request, reply) => {
    const wantsJson = /application\/json/i.test(request.headers.accept || '')
      || /application\/json/i.test(request.headers['content-type'] || '');
    const found = await tenderMail.lookupDecideToken(db, request.params.token);
    if (!found.ok) {
      const msg = found.reason === 'used' ? 'Уже решено' : 'Ссылка недоступна';
      if (wantsJson) return reply.code(400).send({ ok: false, error: msg });
      return sendPage(reply, 200, tenderMail.landingMessageHtml('Не удалось', msg, 'err'));
    }

    const action = (request.body || {}).action;
    const comment = (request.body || {}).comment;
    const result = await tenderMail.applyDecision(
      db,
      found.tokenRow.tender_id,
      action,
      comment,
      found.recipient ? `${found.recipient.label} (email)` : 'Директор (email)',
      found.tokenKind === 'recipient' ? { recipientId: found.recipient.id } : {}
    );

    if (result.ok && found.tokenKind === 'legacy') {
      await db.query(
        `UPDATE tender_director_mail_tokens
         SET used_at = NOW(), used_action = $2
         WHERE id = $1 AND used_at IS NULL`,
        [found.tokenRow.id, action === 'approve' || action === 'submit' ? 'approve' : 'reject']
      );
    }

    if (wantsJson) {
      return reply.code(result.ok ? 200 : 400).send(result);
    }
    return sendPage(reply, 200,
      tenderMail.landingMessageHtml(
        result.ok ? 'Готово' : 'Не удалось',
        result.message || result.error || 'Ошибка',
        result.ok ? 'ok' : 'err'
      ));
  });
};
