'use strict';

/**
 * /api/proxies — доверенности: нумерация, preview/render, attach, send, import, presets.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pipeline } = require('stream/promises');
const { createWriteStream } = require('fs');

const proxyDocx = require('../services/proxy-docx');
const { PROXY_TYPES, PROXY_ROLES, STATUS, findType, expandPowersTemplate } = require('../services/proxy-types');
const { toGenitiveFio, toShortFio } = require('../services/proxy-fio');
const { convertDocxToPdf } = require('../services/letter/_shared');

const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads', 'proxies');

function canAccess(user) {
  return !!user && PROXY_ROLES.includes(user.role);
}

function canDelete(user) {
  return !!user && user.role === 'ADMIN';
}

function computeUiStatus(row) {
  if (!row) return 'draft';
  if (row.status === 'annulled' || row.status === 'revoked') return 'annulled';
  if (row.status === 'expired') return 'expired';
  if (row.status === 'draft') return 'draft';
  if (row.status === 'created') return 'created';
  if (row.status === 'sent') {
    // still check expiry
  }
  const until = row.valid_until ? new Date(row.valid_until) : null;
  if (until && !Number.isNaN(until.getTime())) {
    const now = new Date();
    if (until < now) return 'expired';
    const days = Math.ceil((until.getTime() - now.getTime()) / 86400000);
    if (days <= 30 && (row.status === 'issued' || row.status === 'sent' || row.status === 'created')) {
      return row.status === 'sent' ? 'sent' : 'expiring';
    }
  }
  return row.status || 'created';
}

const WRITE_FIELDS = [
  'type', 'type_id', 'number', 'issue_date', 'valid_from', 'valid_until',
  'employee_id', 'employee_name', 'fio', 'fio_genitive', 'passport',
  'birth_date', 'passport_series', 'passport_number', 'passport_issued',
  'passport_date', 'passport_code', 'registration_address', 'phone',
  'powers_text', 'powers_general', 'description', 'address', 'supplier',
  'goods_list', 'vehicle_brand', 'vehicle_number', 'vin',
  'bank_name', 'account_number', 'tax_office', 'court_name', 'case_number', 'license',
  'region', 'original_handed_to', 'notary_number', 'comment', 'signatory',
  'issue_place', 'allow_redelegation', 'status', 'source',
  'generated_file_url', 'external_file_url', 'signed_file_url'
];

function pickPayload(body) {
  const out = {};
  for (const k of WRITE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, k)) out[k] = body[k];
  }
  if (out.type_id && !out.type) {
    const t = findType(out.type_id);
    out.type = t.label;
  }
  if (out.type && !out.type_id) {
    out.type_id = findType(out.type).id;
  }
  if (out.fio && !out.fio_genitive) out.fio_genitive = toGenitiveFio(out.fio);
  if (out.fio && !out.employee_name) out.employee_name = out.fio;
  // legacy passport blob
  if (!out.passport && (out.passport_series || out.passport_number)) {
    out.passport = [
      out.passport_series && `серия ${out.passport_series}`,
      out.passport_number && `номер ${out.passport_number}`,
      out.passport_issued && `выдан ${out.passport_issued}`,
      out.passport_date && String(out.passport_date).slice(0, 10),
      out.passport_code && `код ${out.passport_code}`
    ].filter(Boolean).join(', ');
  }
  if (out.registration_address && !out.address) out.address = out.registration_address;
  if (out.powers_text && !out.powers_general) out.powers_general = out.powers_text;
  if (typeof out.allow_redelegation === 'string') {
    out.allow_redelegation = out.allow_redelegation === 'true' || out.allow_redelegation === '1';
  }
  return out;
}

async function nextNumber(db, issueDate) {
  const d = issueDate ? new Date(issueDate) : new Date();
  const y = d.getFullYear();
  const yy = String(y).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const prefix = `${yy}${mm}${dd}`;

  await db.query(
    `INSERT INTO proxy_number_seq (year, last_n) VALUES ($1, 0)
     ON CONFLICT (year) DO NOTHING`,
    [y]
  );
  const r = await db.query(
    `UPDATE proxy_number_seq SET last_n = last_n + 1 WHERE year = $1 RETURNING last_n`,
    [y]
  );
  let n = r.rows[0].last_n;

  // учитываем max из существующих номеров года (если seq отстаёт)
  const existing = await db.query(
    `SELECT number FROM proxies WHERE number LIKE $1`,
    [`${yy}%`]
  );
  let maxExisting = 0;
  for (const row of existing.rows) {
    const m = String(row.number || '').match(/\/(\d+)\s*$/);
    if (m) maxExisting = Math.max(maxExisting, parseInt(m[1], 10));
  }
  if (maxExisting >= n) {
    n = maxExisting + 1;
    await db.query(`UPDATE proxy_number_seq SET last_n = $1 WHERE year = $2`, [n, y]);
  }
  return `${prefix}/${String(n).padStart(2, '0')}`;
}

async function getProxy(db, id) {
  const r = await db.query('SELECT * FROM proxies WHERE id = $1', [id]);
  return r.rows[0] || null;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function resolveWritablePreviewDir() {
  try {
    ensureDir(UPLOAD_ROOT);
    fs.accessSync(UPLOAD_ROOT, fs.constants.W_OK);
    return UPLOAD_ROOT;
  } catch (_) {
    const fallback = path.join(os.tmpdir(), 'asgard-proxies-preview');
    ensureDir(fallback);
    return fallback;
  }
}

module.exports = async function proxiesRoutes(fastify) {
  const db = fastify.db;

  fastify.get('/types', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    if (!canAccess(request.user)) return reply.code(403).send({ error: 'Нет доступа' });
    return {
      types: PROXY_TYPES.map((t) => ({
        id: t.id,
        label: t.label,
        desc: t.desc,
        fields: t.fields,
        defaultPowers: t.defaultPowers
      })),
      statuses: Object.entries(STATUS).map(([id, v]) => ({ id, label: v.label }))
    };
  });

  fastify.get('/power-presets', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    if (!canAccess(request.user)) return reply.code(403).send({ error: 'Нет доступа' });
    try {
      const r = await db.query(
        'SELECT id, title, body, sort_order FROM proxy_power_presets ORDER BY sort_order, id'
      );
      return { items: r.rows };
    } catch (e) {
      // таблица может ещё не быть применена
      return { items: [] };
    }
  });

  fastify.post('/next-number', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    if (!canAccess(request.user)) return reply.code(403).send({ error: 'Нет доступа' });
    try {
      const number = await nextNumber(db, request.body?.issue_date);
      return { number };
    } catch (err) {
      fastify.log.error({ err }, 'proxies/next-number');
      return reply.code(500).send({ error: err.message || 'Не удалось выделить номер' });
    }
  });

  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    if (!canAccess(request.user)) return reply.code(403).send({ error: 'Нет доступа' });
    const limit = Math.min(parseInt(request.query.limit || '2000', 10) || 2000, 5000);
    const r = await db.query(
      `SELECT * FROM proxies ORDER BY id DESC LIMIT $1`,
      [limit]
    );
    const items = r.rows.map((row) => ({ ...row, _status: computeUiStatus(row) }));
    return { items, proxies: items };
  });

  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    if (!canAccess(request.user)) return reply.code(403).send({ error: 'Нет доступа' });
    const row = await getProxy(db, request.params.id);
    if (!row) return reply.code(404).send({ error: 'Не найдено' });
    return { item: { ...row, _status: computeUiStatus(row) } };
  });

  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    if (!canAccess(request.user)) return reply.code(403).send({ error: 'Нет доступа' });
    try {
      const data = pickPayload(request.body || {});
      if (!data.number) data.number = await nextNumber(db, data.issue_date);
      if (!data.status) data.status = 'created';
      if (!data.source) data.source = 'crm';
      if (!data.type_id) data.type_id = 'custom';
      if (!data.type) data.type = findType(data.type_id).label;
      if (!data.powers_text) {
        const t = findType(data.type_id);
        data.powers_text = expandPowersTemplate(t.defaultPowers, data);
      }
      const keys = Object.keys(data);
      const vals = keys.map((k) => data[k]);
      const ph = keys.map((_, i) => `$${i + 1}`);
      const r = await db.query(
        `INSERT INTO proxies (${keys.join(',')}) VALUES (${ph.join(',')}) RETURNING *`,
        vals
      );
      return { item: { ...r.rows[0], _status: computeUiStatus(r.rows[0]) } };
    } catch (err) {
      fastify.log.error({ err }, 'proxies/create');
      return reply.code(500).send({ error: err.message || 'Ошибка создания' });
    }
  });

  fastify.put('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    if (!canAccess(request.user)) return reply.code(403).send({ error: 'Нет доступа' });
    try {
      const existing = await getProxy(db, request.params.id);
      if (!existing) return reply.code(404).send({ error: 'Не найдено' });
      const data = pickPayload(request.body || {});
      if (!Object.keys(data).length) return { item: existing };
      data.updated_at = new Date();
      const keys = Object.keys(data);
      const sets = keys.map((k, i) => `${k} = $${i + 1}`);
      const vals = keys.map((k) => data[k]);
      vals.push(request.params.id);
      const r = await db.query(
        `UPDATE proxies SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`,
        vals
      );
      return { item: { ...r.rows[0], _status: computeUiStatus(r.rows[0]) } };
    } catch (err) {
      fastify.log.error({ err }, 'proxies/update');
      return reply.code(500).send({ error: err.message || 'Ошибка обновления' });
    }
  });

  fastify.delete('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    if (!canDelete(request.user)) return reply.code(403).send({ error: 'Удаление только для ADMIN' });
    await db.query('DELETE FROM proxies WHERE id = $1', [request.params.id]);
    return { ok: true };
  });

  fastify.post('/preview', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    if (!canAccess(request.user)) return reply.code(403).send({ error: 'Нет доступа' });
    try {
      const format = String(request.query.format || 'docx').toLowerCase();
      const row = pickPayload(request.body || {});
      if (!row.type_id && row.type) row.type_id = findType(row.type).id;
      if (!row.powers_text) {
        const t = findType(row.type_id);
        row.powers_text = expandPowersTemplate(t.defaultPowers, row);
      }
      const { buffer, filename } = await proxyDocx.generateProxyDocx(row, db);
      const bad = proxyDocx.assertNoPlaceholders(buffer);
      if (bad.length) {
        return reply.code(500).send({ error: 'Шаблон содержит ошибки: ' + bad.join(', ') });
      }

      if (format === 'pdf') {
        const previewDir = resolveWritablePreviewDir();
        const tmpDocx = path.join(previewDir, `_preview_${Date.now()}.docx`);
        fs.writeFileSync(tmpDocx, buffer);
        try {
          const pdfPath = convertDocxToPdf(tmpDocx, previewDir);
          if (pdfPath && fs.existsSync(pdfPath)) {
            const pdfBuf = fs.readFileSync(pdfPath);
            try { fs.unlinkSync(tmpDocx); } catch (_) {}
            try { fs.unlinkSync(pdfPath); } catch (_) {}
            return reply
              .header('Content-Type', 'application/pdf')
              .header('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(filename.replace(/\.docx$/i, '.pdf'))}`)
              .send(pdfBuf);
          }
          return reply.code(503).send({ error: 'PDF-конвертация недоступна (LibreOffice)' });
        } catch (e) {
          try { fs.unlinkSync(tmpDocx); } catch (_) {}
          throw e;
        }
      }

      reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
        .send(buffer);
    } catch (err) {
      fastify.log.error({ err }, 'proxies/preview');
      return reply.code(500).send({ error: err.message || 'Ошибка предпросмотра' });
    }
  });

  // Мимир: полировка текста поля доверенности с контекстом формы
  fastify.post('/polish-text', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    if (!canAccess(request.user)) return reply.code(403).send({ error: 'Нет доступа' });
    const text = String((request.body && request.body.text) || '').trim();
    if (!text) return reply.code(400).send({ error: 'Пустой текст' });
    if (text.length > 20000) return reply.code(400).send({ error: 'Текст слишком длинный' });
    const fieldLabel = (request.body && request.body.field_label) || 'полномочия доверенности';
    const context = (request.body && request.body.context) || {};
    const ctxLines = [];
    if (context.type_label || context.type) ctxLines.push('Тип доверенности: ' + (context.type_label || context.type));
    if (context.fio) ctxLines.push('Представитель: ' + context.fio);
    if (context.number) ctxLines.push('Номер: ' + context.number);
    if (context.issue_date) ctxLines.push('Дата выдачи: ' + context.issue_date);
    if (context.valid_until) ctxLines.push('Срок до: ' + context.valid_until);
    if (context.region) ctxLines.push('Регион: ' + context.region);
    if (context.vehicle_brand) ctxLines.push('ТС: ' + context.vehicle_brand);
    if (context.bank_name) ctxLines.push('Банк: ' + context.bank_name);
    if (context.tender_subject || context.description) {
      ctxLines.push('Предмет: ' + (context.tender_subject || context.description));
    }
    if (context.counterparty || context.supplier) {
      ctxLines.push('Контрагент: ' + (context.counterparty || context.supplier));
    }
    if (context.other_fields_hint) ctxLines.push(String(context.other_fields_hint));

    const aiProvider = require('../services/ai-provider');
    try {
      const ai = await aiProvider.complete({
        system:
          'Ты — редактор юридических доверенностей компании ООО «АСГАРД-Сервис». ' +
          'Улучшаешь юридический русский язык для текста доверенности, готового к печати и подписи. ' +
          'Не выдумывай ФИО, паспортные данные, даты, номера, суммы, названия организаций и ТС — сохраняй их дословно. ' +
          'Не добавляй факты, которых нет в исходнике и контексте. ' +
          'Сохраняй нумерацию пунктов (1) 2) …) если она есть. ' +
          'Верни ТОЛЬКО переписанный текст без markdown и без пояснений.',
        messages: [{
          role: 'user',
          content:
            `Перепиши текст поля «${fieldLabel}» доверенности: исправь грамматику и стиль, сделай формулировки точными и профессиональными.` +
            (ctxLines.length ? `\n\nКонтекст доверенности:\n${ctxLines.join('\n')}` : '') +
            `\n\nИСХОДНЫЙ ТЕКСТ:\n${text}`
        }],
        maxTokens: 4000,
        temperature: 0.25
      });
      let polished = (ai.text || '').trim();
      polished = polished.replace(/^```(?:\w+)?\s*/i, '').replace(/\s*```$/i, '').trim();
      if (!polished) return reply.code(502).send({ error: 'Пустой ответ Мимира' });
      return { polished, model: ai.model };
    } catch (err) {
      fastify.log.error({ err }, 'proxies/polish-text');
      return reply.code(500).send({ error: err.message || 'Ошибка полировки' });
    }
  });

  async function renderHandler(request, reply, format) {
    if (!canAccess(request.user)) return reply.code(403).send({ error: 'Нет доступа' });
    try {
      const row = await getProxy(db, request.params.id);
      if (!row) return reply.code(404).send({ error: 'Не найдено' });
      if (row.source === 'external' && row.external_file_url && format === 'docx') {
        // отдаём внешний файл если есть
        const rel = row.external_file_url.replace(/^\//, '');
        const abs = path.resolve(process.cwd(), rel.startsWith('uploads') ? rel : path.join('uploads', rel));
        if (fs.existsSync(abs)) {
          return reply
            .header('Content-Type', 'application/octet-stream')
            .header('Content-Disposition', `attachment; filename="${path.basename(abs)}"`)
            .send(fs.createReadStream(abs));
        }
      }
      const { buffer, filename } = await proxyDocx.generateProxyDocx(row, db);
      const bad = proxyDocx.assertNoPlaceholders(buffer);
      if (bad.length) {
        return reply.code(500).send({ error: 'Шаблон содержит ошибки: ' + bad.join(', ') });
      }

      // кэш generated
      try {
        const dir = path.join(UPLOAD_ROOT, String(row.id));
        ensureDir(dir);
        const outPath = path.join(dir, filename);
        fs.writeFileSync(outPath, buffer);
        const url = `/uploads/proxies/${row.id}/${filename}`;
        await db.query('UPDATE proxies SET generated_file_url = $1, updated_at = now() WHERE id = $2', [url, row.id]);
      } catch (e) {
        fastify.log.warn({ err: e }, 'proxies: cache generated failed');
      }

      if (format === 'pdf') {
        const tmpDocx = path.join(UPLOAD_ROOT, `_tmp_${row.id}.docx`);
        ensureDir(UPLOAD_ROOT);
        fs.writeFileSync(tmpDocx, buffer);
        try {
          const pdfPath = convertDocxToPdf(tmpDocx, UPLOAD_ROOT);
          if (pdfPath && fs.existsSync(pdfPath)) {
            const pdfBuf = fs.readFileSync(pdfPath);
            try { fs.unlinkSync(tmpDocx); } catch (_) {}
            try { fs.unlinkSync(pdfPath); } catch (_) {}
            return reply
              .header('Content-Type', 'application/pdf')
              .header('Content-Disposition', `inline; filename="${filename.replace(/\.docx$/i, '.pdf')}"`)
              .send(pdfBuf);
          }
          fastify.log.warn('proxies pdf convert unavailable, returning docx');
        } catch (e) {
          fastify.log.warn({ err: e }, 'proxies pdf convert failed, returning docx');
        }
      }

      return reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
        .send(buffer);
    } catch (err) {
      fastify.log.error({ err }, 'proxies/render');
      return reply.code(500).send({ error: err.message || 'Ошибка генерации' });
    }
  }

  fastify.get('/:id/render/docx', { preHandler: [fastify.authenticate] }, (req, rep) => renderHandler(req, rep, 'docx'));
  fastify.post('/:id/render/docx', { preHandler: [fastify.authenticate] }, (req, rep) => renderHandler(req, rep, 'docx'));
  fastify.get('/:id/render/pdf', { preHandler: [fastify.authenticate] }, (req, rep) => renderHandler(req, rep, 'pdf'));
  fastify.post('/:id/render/pdf', { preHandler: [fastify.authenticate] }, (req, rep) => renderHandler(req, rep, 'pdf'));

  fastify.route({
    method: 'POST',
    url: '/:id/upload',
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      if (!canAccess(request.user)) return reply.code(403).send({ error: 'Нет доступа' });
      const row = await getProxy(db, request.params.id);
      if (!row) return reply.code(404).send({ error: 'Не найдено' });

      const kind = String(request.query.kind || request.headers['x-attach-kind'] || 'signed');
      const data = await request.file();
      if (!data) return reply.code(400).send({ error: 'Файл не передан' });

      const dir = path.join(UPLOAD_ROOT, String(row.id));
      ensureDir(dir);
      const safeName = String(data.filename || 'file.bin').replace(/[^\w.\-а-яА-ЯёЁ]+/gi, '_');
      const stored = `${kind}_${Date.now()}_${safeName}`;
      const abs = path.join(dir, stored);
      await pipeline(data.file, createWriteStream(abs));
      const url = `/uploads/proxies/${row.id}/${stored}`;
      const col = kind === 'external' ? 'external_file_url' : 'signed_file_url';
      const patch = { [col]: url, updated_at: new Date() };
      if (kind === 'external') patch.source = 'external';
      const keys = Object.keys(patch);
      const sets = keys.map((k, i) => `${k} = $${i + 1}`);
      const vals = keys.map((k) => patch[k]);
      vals.push(row.id);
      const r = await db.query(
        `UPDATE proxies SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`,
        vals
      );
      return { item: { ...r.rows[0], _status: computeUiStatus(r.rows[0]) }, url };
    }
  });

  fastify.post('/:id/send', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    if (!canAccess(request.user)) return reply.code(403).send({ error: 'Нет доступа' });
    try {
      const row = await getProxy(db, request.params.id);
      if (!row) return reply.code(404).send({ error: 'Не найдено' });
      const to = String(request.body?.to || '').trim();
      const subject = String(request.body?.subject || `Доверенность ${row.number || row.id}`).trim();
      const text = String(request.body?.text || `Во вложении доверенность № ${row.number || row.id}.`).trim();
      const preferSigned = !!request.body?.prefer_signed;
      if (!to) return reply.code(400).send({ error: 'Укажите адрес получателя' });

      let attachments = [];
      if (preferSigned && row.signed_file_url) {
        const rel = row.signed_file_url.replace(/^\//, '');
        const abs = path.resolve(process.cwd(), rel);
        if (fs.existsSync(abs)) {
          attachments.push({ filename: path.basename(abs), path: abs });
        }
      }
      if (!attachments.length) {
        const { buffer, filename } = await proxyDocx.generateProxyDocx(row, db);
        attachments.push({ filename, content: buffer });
      }

      const nodemailer = require('nodemailer');
      let transport;
      if (process.env.SMTP_HOST) {
        transport = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: parseInt(process.env.SMTP_PORT || '587', 10),
          secure: process.env.SMTP_SECURE === '1',
          auth: process.env.SMTP_USER
            ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
            : undefined
        });
      } else {
        return reply.code(500).send({ error: 'SMTP не настроен' });
      }

      await transport.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@asgard-service.com',
        to,
        subject,
        text,
        attachments
      });

      const r = await db.query(
        `UPDATE proxies SET status = 'sent', updated_at = now() WHERE id = $1 RETURNING *`,
        [row.id]
      );
      return { ok: true, item: { ...r.rows[0], _status: computeUiStatus(r.rows[0]) } };
    } catch (err) {
      fastify.log.error({ err }, 'proxies/send');
      return reply.code(500).send({ error: err.message || 'Ошибка отправки' });
    }
  });

  fastify.post('/import-registry', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    if (!canAccess(request.user)) return reply.code(403).send({ error: 'Нет доступа' });
    try {
      const ExcelJS = require('exceljs');
      let filePath = request.body?.file_path;
      if (!filePath) {
        const data = await request.file();
        if (!data) {
          // default Downloads path
          filePath = path.join(
            process.env.USERPROFILE || '',
            'Downloads',
            'Реестр доверенностей.xlsx'
          );
        } else {
          ensureDir(UPLOAD_ROOT);
          filePath = path.join(UPLOAD_ROOT, `_import_${Date.now()}.xlsx`);
          await pipeline(data.file, createWriteStream(filePath));
        }
      }
      if (!fs.existsSync(filePath)) {
        return reply.code(400).send({ error: 'Файл реестра не найден: ' + filePath });
      }

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(filePath);
      const ws = wb.getWorksheet('RU') || wb.worksheets[0];
      let created = 0;
      let skipped = 0;
      const errors = [];

      const cellText = (cell) => {
        let v = cell?.value;
        if (v == null) return '';
        if (typeof v === 'object') {
          if (v.richText) return v.richText.map((t) => t.text).join('');
          if (v.text) return v.text;
          if (v.result != null) return String(v.result);
          if (v instanceof Date) return v.toISOString().slice(0, 10);
        }
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        return String(v).trim();
      };

      const classify = (powers) => {
        const p = powers.toLowerCase();
        if (p.includes('получать товарно-материальные ценности с правом подписания любых') && powers.length < 200) return 'tmc_short';
        if (p.includes('управление')) return 'vehicle';
        if (p.includes('банков')) return 'bank';
        if (p.includes('тендер') || p.includes('переговор') || p.includes('предложени')) return 'tender';
        if (p.includes('государственных, общественных и коммерческих')) return 'representation';
        if (p.includes('заключать и совершать от имени общества договоры')) return 'commercial';
        if (p.includes('получать от любых третьих лиц') || p.includes('принимать от имени общества товары')) return 'docs_tmc';
        return 'custom';
      };

      for (let r = 2; r <= (ws.rowCount || 0); r++) {
        const number = cellText(ws.getCell(r, 2));
        if (!number) continue;
        const exists = await db.query('SELECT id FROM proxies WHERE number = $1 LIMIT 1', [number]);
        if (exists.rows.length) {
          skipped++;
          continue;
        }
        let issue = cellText(ws.getCell(r, 3));
        let until = cellText(ws.getCell(r, 4));
        if (/^\d{4}-\d{2}-\d{2}/.test(issue)) issue = issue.slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}/.test(until)) until = until.slice(0, 10);
        const fioRaw = cellText(ws.getCell(r, 5)).replace(/,\s*офис-менеджер/i, '').trim();
        const powers = cellText(ws.getCell(r, 6));
        const signatory = cellText(ws.getCell(r, 7));
        const handed = cellText(ws.getCell(r, 8));
        const region = cellText(ws.getCell(r, 9));
        const notary = cellText(ws.getCell(r, 10));
        const comment = cellText(ws.getCell(r, 11));
        const typeId = classify(powers);
        const type = findType(typeId);

        let status = 'issued';
        if (until) {
          const u = new Date(until);
          if (!Number.isNaN(u.getTime()) && u < new Date()) status = 'expired';
        }

        try {
          await db.query(
            `INSERT INTO proxies (
              type, type_id, number, issue_date, valid_from, valid_until,
              fio, employee_name, fio_genitive, powers_text, powers_general,
              signatory, original_handed_to, region, notary_number, comment,
              status, source, issue_place
            ) VALUES (
              $1,$2,$3,$4,$5,$6,
              $7,$8,$9,$10,$11,
              $12,$13,$14,$15,$16,
              $17,'external','г. Москва'
            )`,
            [
              type.label, typeId, number, issue || null, issue || null, until || null,
              fioRaw, fioRaw, toGenitiveFio(fioRaw), powers, powers,
              signatory || null, handed || null, region || null,
              notary && notary !== 'Нет' ? notary : null, comment || null,
              status
            ]
          );
          created++;
        } catch (e) {
          errors.push({ number, error: e.message });
        }
      }

      // presets from Sheet1
      const ws2 = wb.getWorksheet('Sheet1');
      let presets = 0;
      if (ws2) {
        const cnt = await db.query('SELECT COUNT(*)::int AS c FROM proxy_power_presets');
        if ((cnt.rows[0]?.c || 0) === 0) {
          for (let r = 2; r <= (ws2.rowCount || 0); r++) {
            const body = cellText(ws2.getCell(r, 1));
            if (!body || body.length < 20) continue;
            const title = body.slice(0, 80).replace(/\s+/g, ' ') + (body.length > 80 ? '…' : '');
            await db.query(
              `INSERT INTO proxy_power_presets (title, body, sort_order) VALUES ($1,$2,$3)`,
              [title, body, r]
            );
            presets++;
          }
        }
      }

      return { ok: true, created, skipped, presets, errors };
    } catch (err) {
      fastify.log.error({ err }, 'proxies/import');
      return reply.code(500).send({ error: err.message || 'Ошибка импорта' });
    }
  });

  fastify.post('/qa-render-all', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    if (!request.user || request.user.role !== 'ADMIN') {
      return reply.code(403).send({ error: 'Только ADMIN' });
    }
    const fixtures = require('../../tools/proxy-qa-fixtures.js');
    const outDir = path.join(process.cwd(), 'tests', 'reports', 'proxy-qa', new Date().toISOString().slice(0, 10));
    ensureDir(outDir);
    const results = [];
    for (const fx of fixtures) {
      try {
        const { buffer, filename } = await proxyDocx.generateProxyDocx(fx, db);
        const bad = proxyDocx.assertNoPlaceholders(buffer);
        const out = path.join(outDir, filename);
        fs.writeFileSync(out, buffer);
        results.push({
          type_id: fx.type_id,
          ok: bad.length === 0,
          bad,
          file: out
        });
      } catch (e) {
        results.push({ type_id: fx.type_id, ok: false, bad: [e.message], file: null });
      }
    }
    const pass = results.filter((r) => r.ok).length;
    const report = [
      `# Proxy templates QA`,
      ``,
      `Result: **${pass}/${results.length} PASS**`,
      ``,
      ...results.map((r) => `- ${r.type_id}: ${r.ok ? 'PASS' : 'FAIL ' + (r.bad || []).join(',')}`)
    ].join('\n');
    fs.writeFileSync(path.join(outDir, 'REPORT.md'), report, 'utf8');
    return { pass, total: results.length, results, reportDir: outDir };
  });

  // silence unused
  void toShortFio;
};
