'use strict';

/**
 * Публичные страницы решения по payment_invoices из письма директора.
 * GET /payment-mail/:token — HTML без мутации
 * POST /payment-mail/:token — { action: approve|reject } (single или batch)
 */

const paymentMail = require('../services/payment-mail');

module.exports = async function paymentMailRoutes(fastify) {
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
    return String(request.headers.accept || '').includes('application/json');
  }

  function sendPage(reply, status, html) {
    return reply.code(status).type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(html);
  }

  fastify.get('/:token', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const found = await paymentMail.lookupToken(db, request.params.token);
    if (!found.ok) {
      const map = {
        invalid: 'Ссылка повреждена.',
        not_found: 'Ссылка не найдена или уже не действует.',
        used: 'По этой ссылке уже принято решение.',
        expired: 'Срок ссылки истёк (48 часов).'
      };
      return sendPage(reply, found.reason === 'invalid' ? 400 : 404,
        paymentMail.landingMessageHtml('Ссылка недоступна', map[found.reason] || map.not_found, 'err'));
    }

    if (found.kind === 'batch') {
      const awaiting = (found.payments || []).filter(p => p.status === 'awaiting_dir');
      if (!awaiting.length) {
        return sendPage(reply, 200, paymentMail.landingMessageHtml('Уже решено', 'По этой группе уже принято решение.', 'warn'));
      }
      return sendPage(reply, 200, paymentMail.landingBatchActionHtml(found.payments, request.params.token));
    }

    if (found.payment.status !== 'awaiting_dir') {
      const done = found.payment.status === 'pending_payment' || found.payment.status === 'paid'
        ? 'Счёт уже согласован.'
        : found.payment.status === 'rejected'
          ? 'Счёт уже отклонён.'
          : 'По счёту уже принято решение.';
      return sendPage(reply, 200, paymentMail.landingMessageHtml('Уже решено', done, 'warn'));
    }
    return sendPage(reply, 200, paymentMail.landingActionHtml(found.payment, request.params.token));
  });

  fastify.get('/:token/file', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const found = await paymentMail.lookupToken(db, request.params.token);
    let pay = found.payment;
    if (!found.ok && found.reason !== 'used' && found.reason !== 'expired') {
      return reply.code(404).send({ error: 'Ссылка недействительна' });
    }
    if (found.kind === 'batch') {
      const wantId = parseInt(request.query && request.query.id, 10);
      pay = (found.payments || []).find(p => p.id === wantId) || (found.payments || [])[0];
    }
    if (!pay) {
      const raw = String(request.params.token || '').trim();
      const crypto = require('crypto');
      const hash = crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
      const q = await db.query(
        `SELECT p.* FROM payment_mail_tokens t JOIN payment_invoices p ON p.id=t.payment_id WHERE t.token_hash=$1`,
        [hash]
      );
      pay = q.rows[0];
    }
    if (!pay) return reply.code(404).send({ error: 'Не найдено' });
    const fs = require('fs');
    const path = require('path');
    const fsPath = paymentMail.uploadFsPath(pay.file_path);
    if (!fsPath || !fs.existsSync(fsPath)) return reply.code(404).send({ error: 'Файл не найден' });
    const name = pay.file_name || path.basename(fsPath);
    reply.header('Content-Type', name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');
    reply.header('Content-Disposition', `inline; filename="${encodeURIComponent(name)}"`);
    return reply.send(fs.createReadStream(fsPath));
  });

  fastify.post('/:token', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const action = String((request.body && request.body.action) || '').toLowerCase();
    const json = wantsJson(request);
    const found = await paymentMail.lookupToken(db, request.params.token);
    if (!found.ok) {
      const msg = found.reason === 'used' ? 'Уже решено.' : 'Ссылка недействительна.';
      if (json) return reply.code(found.reason === 'used' ? 200 : 400).send({ ok: false, error: msg });
      return sendPage(reply, found.reason === 'used' ? 200 : 400,
        paymentMail.landingMessageHtml('Не удалось', msg, 'err'));
    }

    if (found.kind === 'batch') {
      const result = await paymentMail.applyBatchDecision(db, found.payments, found.batch, action, null);
      const okMsg = action === 'approve'
        ? `Согласовано счетов: ${found.payments.length}. Бухгалтерия видит их в очереди оплаты.`
        : `Отклонено счетов: ${found.payments.length}.`;
      if (json) return reply.send({ ok: true, message: okMsg, ...result });
      return sendPage(reply, 200, paymentMail.landingMessageHtml(
        action === 'approve' ? 'Согласовано' : 'Отклонено', okMsg, action === 'approve' ? 'ok' : 'warn'));
    }

    if (found.payment.status !== 'awaiting_dir') {
      const msg = 'По счёту уже принято решение.';
      if (json) return reply.send({ ok: true, message: msg });
      return sendPage(reply, 200, paymentMail.landingMessageHtml('Уже решено', msg, 'warn'));
    }
    const result = await paymentMail.applyDecision(db, found.payment, action, null);
    const okMsg = action === 'approve'
      ? 'Счёт согласован. Бухгалтерия видит его в очереди оплаты.'
      : 'Счёт отклонён.';
    if (json) return reply.send({ ok: true, message: okMsg, ...result });
    return sendPage(reply, 200, paymentMail.landingMessageHtml(
      action === 'approve' ? 'Согласовано' : 'Отклонено', okMsg, action === 'approve' ? 'ok' : 'warn'));
  });
};
