'use strict';

/**
 * Public tender file cloud: GET /tender-files/:token
 * download/view without CRM login
 */
const fs = require('fs');
const tenderMail = require('../services/tender-director-mail');

module.exports = async function tenderFilesRoutes(fastify) {
  const db = fastify.db;

  function sendPage(reply, code, html) {
    return reply.code(code).type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(html);
  }

  fastify.get('/:token', async (request, reply) => {
    const found = await tenderMail.lookupFilesToken(db, request.params.token);
    if (!found.ok) {
      const map = {
        invalid: 'Некорректная ссылка',
        not_found: 'Ссылка не найдена',
        expired: 'Срок ссылки истёк'
      };
      return sendPage(reply, 200,
        tenderMail.landingMessageHtml('Файлы недоступны', map[found.reason] || map.not_found, 'err'));
    }
    const files = await tenderMail.loadTenderFiles(db, found.tokenRow.tender_id);
    return sendPage(reply, 200,
      tenderMail.cloudPageHtml(found.tender, files, request.params.token));
  });

  fastify.get('/:token/download/:docId', async (request, reply) => {
    const found = await tenderMail.lookupFilesToken(db, request.params.token);
    if (!found.ok) return reply.code(404).send({ error: 'not_found' });
    const file = await tenderMail.resolveDocFs(db, found.tokenRow.tender_id, request.params.docId);
    if (!file) return reply.code(404).send({ error: 'file_missing' });
    reply.header('Content-Type', file.mime);
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
    return reply.send(fs.createReadStream(file.fsPath));
  });

  fastify.get('/:token/view/:docId', async (request, reply) => {
    const found = await tenderMail.lookupFilesToken(db, request.params.token);
    if (!found.ok) return reply.code(404).send({ error: 'not_found' });
    const file = await tenderMail.resolveDocFs(db, found.tokenRow.tender_id, request.params.docId);
    if (!file) return reply.code(404).send({ error: 'file_missing' });
    reply.header('Content-Type', file.mime);
    reply.header('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
    return reply.send(fs.createReadStream(file.fsPath));
  });
};
