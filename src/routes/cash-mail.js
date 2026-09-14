'use strict';

/**
 * Публичные страницы решения по кассе из письма директора.
 * GET /cash-mail/:token  — HTML, без мутации.
 * POST /cash-mail/:token — { action: 'approve'|'reject' }.
 */

const cashMail = require('../services/cash-mail');

module.exports = async function cashMailRoutes(fastify) {
  const db = fastify.db;

  fastify.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (req, body, done) => {
    try {
      const params = new URLSearchParams(body || '');
      done(null, Object.fromEntries(params));
    } catch (err) {
      done(err);
    }
  });

  function wantsJson(request) {
    const accept = String(request.headers.accept || '');
    return accept.includes('application/json');
  }

  function sendPage(reply, status, html) {
    return reply.code(status).type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(html);
  }

  fastify.get('/:token', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const found = await cashMail.lookupToken(db, request.params.token);
    if (!found.ok) {
      const map = {
        invalid: 'Ссылка повреждена.',
        not_found: 'Ссылка не найдена или уже не действует.',
        used: 'По этой ссылке уже принято решение.',
        expired: 'Срок ссылки истёк (48 часов). Откройте заявку в CRM.'
      };
      return sendPage(reply, found.reason === 'invalid' ? 400 : 404,
        cashMail.landingMessageHtml('Ссылка недоступна', map[found.reason] || map.not_found, 'err'));
    }
    if (found.request.status !== 'requested') {
      const done = found.request.status === 'approved'
        ? 'Заявка уже согласована. Бухгалтерия может выдавать.'
        : found.request.status === 'rejected'
          ? 'Заявка уже отклонена.'
          : 'По заявке уже принято другое решение.';
      return sendPage(reply, 200, cashMail.landingMessageHtml('Уже решено', done, 'warn'));
    }
    return sendPage(reply, 200, cashMail.landingActionHtml(found.request, request.params.token));
  });

  fastify.post('/:token', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const action = String((request.body && request.body.action) || '').toLowerCase();
    const json = wantsJson(request);

    const found = await cashMail.lookupToken(db, request.params.token);
    if (!found.ok) {
      const msg = found.reason === 'used'
        ? 'По этой ссылке уже принято решение.'
        : found.reason === 'expired'
          ? 'Срок ссылки истёк.'
          : 'Ссылка недействительна.';
      if (json) return reply.code(found.reason === 'used' ? 200 : 400).send({ ok: false, error: msg });
      return sendPage(reply, found.reason === 'used' ? 200 : 400,
        cashMail.landingMessageHtml('Не удалось', msg, 'err'));
    }

    if (found.request.status !== 'requested') {
      const msg = found.request.status === 'approved'
        ? 'Заявка уже согласована. Бухгалтерия может выдавать.'
        : 'По заявке уже принято решение.';
      if (json) return reply.send({ ok: true, message: msg });
      return sendPage(reply, 200, cashMail.landingMessageHtml('Уже решено', msg, 'warn'));
    }

    if (action !== 'approve' && action !== 'reject') {
      const msg = 'Укажите действие: согласовать или отказать.';
      if (json) return reply.code(400).send({ ok: false, error: msg });
      return sendPage(reply, 400, cashMail.landingMessageHtml('Нет действия', msg, 'err'));
    }

    const director = await cashMail.resolveCommercialDirector(db);
    if (!director) {
      const msg = 'Не найден коммерческий директор. Решение нужно принять в CRM.';
      if (json) return reply.code(500).send({ ok: false, error: msg });
      return sendPage(reply, 500, cashMail.landingMessageHtml('Ошибка', msg, 'err'));
    }

    const result = action === 'approve'
      ? await cashMail.applyApprove(db, {
        requestId: found.request.id,
        actor: director,
        comment: null,
        log: fastify.log
      })
      : await cashMail.applyReject(db, {
        requestId: found.request.id,
        actor: director,
        comment: null,
        requireComment: false,
        log: fastify.log
      });

    if (!result.ok) {
      if (json) return reply.code(result.status || 400).send({ ok: false, error: result.error });
      return sendPage(reply, result.status || 400,
        cashMail.landingMessageHtml('Не удалось', result.error, 'err'));
    }

    const okMsg = action === 'approve'
      ? `Согласовано. Бухгалтерия может выдавать ${cashMail.fmtRub(found.request.amount)} ₽ — ${found.request.user_name || 'сотруднику'}.`
      : 'Заявка отклонена. Сотруднику уйдёт уведомление.';

    if (json) return reply.send({ ok: true, message: okMsg, status: action === 'approve' ? 'approved' : 'rejected' });
    return sendPage(reply, 200, cashMail.landingMessageHtml(
      action === 'approve' ? 'Согласовано' : 'Отклонено',
      okMsg,
      action === 'approve' ? 'ok' : 'warn'
    ));
  });
};
