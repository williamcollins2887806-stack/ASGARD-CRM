'use strict';

/**
 * ASGARD CRM — Быстрое ТКП через Мимира
 * prefix: /api/tkp-quick
 *
 * POST   /sessions                 — создать сессию
 * GET    /sessions                 — список моих активных сессий
 * GET    /sessions/:uid            — состояние сессии
 * PUT    /sessions/:uid            — обновить поля (до calculate)
 * POST   /sessions/:uid/upload     — загрузить файлы ТЗ (multipart), OCR
 * POST   /sessions/:uid/dadata     — резолвнуть ИНН через Dadata
 * POST   /sessions/:uid/calculate  — SSE: запустить Мимира → estimate_draft
 * POST   /sessions/:uid/chat       — SSE: диалог-правки → обновить estimate_draft
 * POST   /sessions/:uid/finalize   — создать ТКП (+ ДС если parent_work_id)
 * DELETE /sessions/:uid            — отказаться от сессии
 */

const crypto  = require('crypto');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');

const ROLES = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

async function routes(fastify, options) {
  const db = fastify.db;
  const { createNotification } = require('../services/notify');
  const mimirTkpQuick = require('../services/mimir-tkp-quick');
  const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

  // ─────────────────────────────────────────────────────────────────────────
  // POST /sessions — Создать сессию
  // ─────────────────────────────────────────────────────────────────────────
  fastify.post('/sessions', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    const {
      customer_inn, customer_name, tz_text,
      pre_tender_id, tender_id, parent_work_id
    } = request.body || {};

    const sessionUid = crypto.randomUUID();

    // Предзаполнение из pre_tender_id если передан
    let prefill = {};
    if (pre_tender_id) {
      const { rows: [pt] } = await db.query(
        'SELECT customer_inn, customer_name, work_description FROM pre_tender_requests WHERE id = $1',
        [pre_tender_id]
      );
      if (pt) prefill = { customer_inn: pt.customer_inn, customer_name: pt.customer_name, tz_text: pt.work_description };
    } else if (tender_id) {
      const { rows: [t] } = await db.query(
        'SELECT customer_inn, customer_name FROM tenders WHERE id = $1 AND deleted_at IS NULL',
        [tender_id]
      );
      if (t) prefill = { customer_inn: t.customer_inn, customer_name: t.customer_name };
    }

    const { rows: [session] } = await db.query(`
      INSERT INTO tkp_quick_sessions (
        session_uid, author_id,
        customer_inn, customer_name,
        pre_tender_id, tender_id, parent_work_id,
        tz_text, status, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',NOW(),NOW())
      RETURNING *
    `, [
      sessionUid,
      request.user.id,
      customer_inn || prefill.customer_inn || null,
      customer_name || prefill.customer_name || null,
      pre_tender_id || null,
      tender_id || null,
      parent_work_id || null,
      tz_text || prefill.tz_text || null
    ]);

    return { session };
  });

  // 22.06.2026: единый источник финансов для карты заявки/тендера.
  // Приоритеты: 1) последняя finalized смета из tkp_quick_sessions, 2) последний ТКП.
  // Возвращает {source, totals:{cost,kp_no_vat,kp_with_vat,markup_multiplier,vat_pct}, ref_id}.
  fastify.get('/finance-source', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const { pre_tender_id, tender_id } = request.query;
    const ptId = pre_tender_id ? Number(pre_tender_id) : null;
    const tdId = tender_id ? Number(tender_id) : null;
    if (!ptId && !tdId) return { source: 'none', totals: null };

    // 1) Смета из любой последней сессии tkp_quick_sessions (по updated_at).
    //    Не ограничиваемся status='finalized' — РП может перейти в kp_prep с draft-сметой.
    try {
      const r = await db.query(
        `SELECT id, status, estimate_draft, finalized_at, updated_at
           FROM tkp_quick_sessions
          WHERE ((pre_tender_id IS NOT NULL AND pre_tender_id=$1)
              OR (tender_id     IS NOT NULL AND tender_id    =$2))
            AND estimate_draft IS NOT NULL
          ORDER BY COALESCE(finalized_at, updated_at) DESC NULLS LAST, id DESC LIMIT 1`,
        [ptId, tdId]);
      const row0 = r.rows[0];
      const ed0 = row0?.estimate_draft;
      if (ed0) {
        const ed = typeof ed0 === 'string' ? JSON.parse(ed0) : ed0;
        // Поддерживаем 2 схемы:
        // (A) ed.totals = {cost, kp_no_vat, kp_with_vat, markup_multiplier, vat_pct}
        // (B) корневой уровень: ed.subtotal / ed.total_with_vat / ed.total_without_vat / ed.vat_pct + ed.items[].cost
        const totalsBlock = ed?.totals || ed?.analysis?.totals || ed?.ai_meta?.estimate?.totals || null;
        const vatPct = Number(totalsBlock?.vat_pct ?? ed.vat_pct ?? ed.ai_meta?.estimate?.vat_pct) || 20;
        let kpNoVat = Number(totalsBlock?.kp_no_vat) || Number(ed.total_without_vat) || Number(ed.subtotal) || null;
        let kpWithVat = Number(totalsBlock?.kp_with_vat) || Number(ed.total_with_vat) || (kpNoVat ? kpNoVat * (1 + vatPct/100) : null);
        // markup — берём из явного поля (поддерживаем 3 пути)
        let markup = Number(totalsBlock?.markup_multiplier) || Number(ed.markup_multiplier) || Number(ed.ai_meta?.estimate?.markup_multiplier) || null;
        // cost = kp_no_vat / markup (стандартная формула)
        let cost = Number(totalsBlock?.cost) || Number(ed.cost_total) || Number(ed.ai_meta?.estimate?.cost) || null;
        if (!cost && kpNoVat && markup && markup > 0) {
          cost = kpNoVat / markup;
        }
        // если cost так и не нашли — пробуем сумму items
        if (!cost && Array.isArray(ed.items) && ed.items.length) {
          const sum = ed.items.reduce((acc, it) => {
            const c = Number(it.cost) || Number(it.cost_total) || Number(it.cost_planned) || 0;
            return acc + c;
          }, 0);
          if (sum > 0) cost = sum;
        }
        // Обратная: markup из cost/kp если не было
        if (!markup && cost && kpNoVat && cost > 0) markup = kpNoVat / cost;
        const margin = (cost && kpNoVat && kpNoVat > 0) ? ((kpNoVat - cost) / kpNoVat * 100) : null;
        if (kpNoVat || cost) {
          return {
            source: 'estimate',
            ref_id: row0.id,
            status: row0.status,
            totals: { cost, kp_no_vat: kpNoVat, kp_with_vat: kpWithVat, markup_multiplier: markup, margin_pct: margin, vat_pct: vatPct }
          };
        }
      }
    } catch (_) { /* fallback на tkp */ }

    // 2) Fallback: max(total_sum) из tkp
    try {
      const r = await db.query(
        `SELECT id, total_sum, vat_pct FROM tkp
          WHERE ((pre_tender_id IS NOT NULL AND pre_tender_id=$1)
              OR (tender_id     IS NOT NULL AND tender_id    =$2))
            AND total_sum > 0
          ORDER BY total_sum DESC LIMIT 1`,
        [ptId, tdId]);
      if (r.rows[0]) {
        const kp = Number(r.rows[0].total_sum) || 0;
        const vatPct = Number(r.rows[0].vat_pct) || 20;
        return {
          source: 'tkp',
          ref_id: r.rows[0].id,
          totals: { cost: null, kp_no_vat: kp, kp_with_vat: kp * (1 + vatPct/100), markup_multiplier: null, margin_pct: null, vat_pct: vatPct }
        };
      }
    } catch (_) {}

    return { source: 'none', totals: null };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GET /sessions — Список активных сессий текущего пользователя
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get('/sessions', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request) => {
    const { rows } = await db.query(`
      SELECT id, session_uid, customer_inn, customer_name, tz_text,
             status, created_at, updated_at, tkp_id
      FROM tkp_quick_sessions
      WHERE author_id = $1
        AND status NOT IN ('finalized','abandoned')
      ORDER BY created_at DESC
      LIMIT 50
    `, [request.user.id]);
    return { sessions: rows };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GET /sessions/:uid
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get('/sessions/:uid', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    const { rows: [session] } = await db.query(
      'SELECT * FROM tkp_quick_sessions WHERE session_uid = $1 AND author_id = $2',
      [request.params.uid, request.user.id]
    );
    if (!session) return reply.code(404).send({ error: 'Сессия не найдена' });
    return { session };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PUT /sessions/:uid — Обновить поля (customer_inn, customer_name, tz_text)
  // ─────────────────────────────────────────────────────────────────────────
  fastify.put('/sessions/:uid', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    const allowed = ['customer_inn', 'customer_name', 'tz_text', 'customer_data'];
    const body = request.body || {};
    const updates = [];
    const vals = [];
    let i = 1;
    for (const k of allowed) {
      if (body[k] !== undefined) {
        updates.push(`${k} = $${i++}`);
        vals.push(k === 'customer_data' ? JSON.stringify(body[k]) : body[k]);
      }
    }
    if (!updates.length) return reply.code(400).send({ error: 'Нет данных' });
    updates.push(`updated_at = NOW()`);
    vals.push(request.params.uid, request.user.id);

    const { rows: [session] } = await db.query(
      `UPDATE tkp_quick_sessions SET ${updates.join(', ')}
       WHERE session_uid = $${i} AND author_id = $${i + 1}
       RETURNING *`,
      vals
    );
    if (!session) return reply.code(404).send({ error: 'Сессия не найдена' });
    return { session };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /sessions/:uid/upload — Загрузить файлы ТЗ, OCR → tz_attachments
  // ─────────────────────────────────────────────────────────────────────────
  fastify.post('/sessions/:uid/upload', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    const { rows: [session] } = await db.query(
      "SELECT * FROM tkp_quick_sessions WHERE session_uid = $1 AND author_id = $2 AND status IN ('draft','error')",
      [request.params.uid, request.user.id]
    );
    if (!session) return reply.code(404).send({ error: 'Сессия не найдена или нельзя изменить' });

    const pdfOcr = require('../services/pdf-ocr');
    const tkpParser = require('../services/tkp-parser');

    const data = await request.file();
    if (!data) return reply.code(400).send({ error: 'Файл не передан' });

    const buf = await data.toBuffer();
    if (data.file.truncated) return reply.code(413).send({ error: 'Файл превышает лимит' });

    // Парсим/OCR файл для извлечения текста
    let ocrText = '';
    try {
      const result = await tkpParser.parseTkpBuffer({
        buf, originalName: data.filename || 'file', mime: data.mimetype
      });
      ocrText = result.text_extracted || '';
    } catch (e) {
      request.log.warn('[tkp_quick upload] parse failed:', e.message);
    }

    // Добавляем к tz_attachments
    const existing = Array.isArray(session.tz_attachments) ? session.tz_attachments : [];
    const newEntry = {
      filename: data.filename,
      mime: data.mimetype,
      size: buf.length,
      ocr_text: ocrText,
      added_at: new Date().toISOString()
    };
    existing.push(newEntry);

    await db.query(
      'UPDATE tkp_quick_sessions SET tz_attachments = $1, updated_at = NOW() WHERE session_uid = $2',
      [JSON.stringify(existing), request.params.uid]
    );

    return { ok: true, filename: data.filename, ocr_chars: ocrText.length };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /sessions/:uid/text — добавить/заменить ручной ТЗ-текст в сессию.
  // Юзер дописывает описание работы прямо в Quick wizard'е (например, если
  // он переслал письмо без ТЗ и только с реквизитами клиента).
  // body: { text: string, mode?: 'append'|'replace' } (default 'append')
  // ─────────────────────────────────────────────────────────────────────────
  fastify.post('/sessions/:uid/text', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    const { text, mode } = request.body || {};
    if (!text || !String(text).trim()) return reply.code(400).send({ error: 'Текст пустой' });
    const cleanText = String(text).trim();

    const { rows: [session] } = await db.query(
      "SELECT id, tz_text, status FROM tkp_quick_sessions WHERE session_uid = $1 AND author_id = $2 AND status IN ('draft','error','calculating')",
      [request.params.uid, request.user.id]
    );
    if (!session) return reply.code(404).send({ error: 'Сессия не найдена или уже рассчитана' });

    const finalText = (mode === 'replace')
      ? cleanText
      : ((session.tz_text || '').trim() + (session.tz_text ? '\n\n— Дополнение от РП —\n' : '') + cleanText);

    await db.query(
      "UPDATE tkp_quick_sessions SET tz_text = $1, updated_at = NOW() WHERE session_uid = $2",
      [finalText, request.params.uid]
    );
    return { ok: true, length: finalText.length };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /sessions/:uid/dadata — Резолвнуть ИНН → customer_data (светофор)
  // ─────────────────────────────────────────────────────────────────────────
  fastify.post('/sessions/:uid/dadata', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    const { inn } = request.body || {};
    const cleanInn = String(inn || '').replace(/\D/g, '');
    if (cleanInn.length !== 10 && cleanInn.length !== 12) {
      return reply.code(400).send({ error: 'Некорректный ИНН' });
    }

    const { rows: [session] } = await db.query(
      'SELECT id FROM tkp_quick_sessions WHERE session_uid = $1 AND author_id = $2',
      [request.params.uid, request.user.id]
    );
    if (!session) return reply.code(404).send({ error: 'Сессия не найдена' });

    // Загружаем dashboard-данные контрагента
    let customerData = null;
    try {
      const dashRes = await db.query(`
        SELECT
          (SELECT row_to_json(c) FROM customers c WHERE c.inn = $1) AS profile,
          (SELECT COUNT(*) FROM tenders WHERE customer_inn = $1 AND deleted_at IS NULL) AS tenders_total
      `, [cleanInn]);
      // Дёргаем полный dashboard через внутренний fetch не нужен —
      // customers.js dashboard endpoint недоступен без HTTP.
      // Делаем упрощённый запрос прямо к DB:
      const [tAgg, kAgg, fAgg] = await Promise.all([
        db.query(`
          SELECT COUNT(*) total, COUNT(*) FILTER (WHERE tender_status='Выиграли') won,
                 COUNT(*) FILTER (WHERE tender_status='Проиграли') lost,
                 COALESCE(SUM(tender_price) FILTER (WHERE tender_status='Выиграли'),0) won_sum
          FROM tenders WHERE customer_inn=$1 AND deleted_at IS NULL
        `, [cleanInn]),
        db.query(`
          SELECT COUNT(*) total, COUNT(*) FILTER (WHERE client_decision='accepted') accepted
          FROM tkp WHERE customer_inn=$1
        `, [cleanInn]),
        db.query(`
          SELECT (SELECT COUNT(*) FROM invoices WHERE customer_inn=$1
                   AND due_date < NOW() AND COALESCE(paid_amount,0) < total_amount) overdue_cnt
        `, [cleanInn])
      ]);
      const t = tAgg.rows[0], k = kAgg.rows[0], f = fAgg.rows[0];
      const decided = Number(t.won) + Number(t.lost);
      const conversion_pct = decided > 0 ? Math.round(Number(t.won) / decided * 100) : null;
      const overdueCnt = Number(f.overdue_cnt);
      let trafficColor = 'gray', trafficLabel = 'Новый';
      if (Number(t.total) >= 3) {
        if (conversion_pct >= 40 && overdueCnt === 0) { trafficColor = 'green'; trafficLabel = 'Надёжный'; }
        else if (overdueCnt >= 2 || (conversion_pct !== null && conversion_pct < 15)) { trafficColor = 'red'; trafficLabel = 'Высокий риск'; }
        else { trafficColor = 'yellow'; trafficLabel = 'Средний риск'; }
      }
      customerData = {
        tenders: { total: +t.total, won: +t.won, lost: +t.lost, won_sum: +t.won_sum, conversion_pct },
        tkp: { total: +k.total, accepted: +k.accepted },
        finance: { overdue_invoices_cnt: overdueCnt },
        traffic_light: { color: trafficColor, label: trafficLabel }
      };
    } catch (e) {
      request.log.warn('[tkp_quick dadata] db agg failed:', e.message);
    }

    // Резолвим название через Dadata (если настроен)
    let ddName = null, ddInn = cleanInn;
    const DADATA_TOKEN = process.env.DADATA_TOKEN;
    if (DADATA_TOKEN) {
      try {
        const r = await fetch('https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Token ' + DADATA_TOKEN },
          body: JSON.stringify({ query: cleanInn, count: 1 })
        });
        const dd = await r.json();
        if (dd.suggestions?.length) {
          const d = dd.suggestions[0].data || {};
          ddName = d.name?.short_with_opf || dd.suggestions[0].value;
          ddInn  = d.inn || cleanInn;
        }
      } catch (_) {}
    }

    // Обновляем сессию
    await db.query(
      `UPDATE tkp_quick_sessions SET
         customer_inn = $1, customer_name = COALESCE($2, customer_name),
         customer_data = $3, updated_at = NOW()
       WHERE session_uid = $4`,
      [ddInn, ddName, JSON.stringify(customerData), request.params.uid]
    );

    return { customer_inn: ddInn, customer_name: ddName, customer_data: customerData };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /sessions/:uid/calculate — SSE: Мимир считает estimate_draft
  // ─────────────────────────────────────────────────────────────────────────
  fastify.post('/sessions/:uid/calculate', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    const { rows: [session] } = await db.query(
      "SELECT * FROM tkp_quick_sessions WHERE session_uid = $1 AND author_id = $2 AND status IN ('draft','error')",
      [request.params.uid, request.user.id]
    );
    if (!session) return reply.code(404).send({ error: 'Сессия не найдена или уже рассчитана' });
    if (!session.tz_text?.trim()) return reply.code(400).send({ error: 'Добавьте техническое задание перед расчётом' });

    // Пометить как calculating
    await db.query(
      "UPDATE tkp_quick_sessions SET status='calculating', updated_at=NOW() WHERE session_uid=$1",
      [request.params.uid]
    );

    // SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    const sendEvent = (data) => {
      try { reply.raw.write(`data: ${JSON.stringify(data)}\n\n`); } catch (_) {}
    };

    try {
      sendEvent({ type: 'start', message: '🧠 Мимир приступает к составлению ТКП...' });

      // Сбираем текст из вложений
      const attachments = Array.isArray(session.tz_attachments) ? session.tz_attachments : [];
      const attachmentsText = attachments
        .filter(a => a.ocr_text?.length > 20)
        .map(a => `[${a.filename}]\n${a.ocr_text}`)
        .join('\n\n---\n\n');

      const settings = await mimirTkpQuick._loadSettings(db);

      const result = await mimirTkpQuick.generateEstimate({
        tz_text: session.tz_text,
        customer_inn: session.customer_inn,
        customer_name: session.customer_name,
        customer_data: session.customer_data,
        attachments_text: attachmentsText,
        settings,
        onProgress: sendEvent,
        session_uid: request.params.uid,
        author_id: session.author_id || request.user.id,
        pre_tender_id: session.pre_tender_id || null,
        tender_id: session.tender_id || null
      });

      // Сохраняем результат в сессию
      const chatMessages = [
        { role: 'user', content: session.tz_text, ts: new Date().toISOString() },
        { role: 'assistant', content: result.chat_response_md, estimate: result.estimate, ts: new Date().toISOString() }
      ];

      await db.query(`
        UPDATE tkp_quick_sessions SET
          status = 'chatting',
          estimate_draft   = $1,
          estimate_history = $2,
          chat_messages    = $3,
          total_input_tokens  = COALESCE(total_input_tokens,0) + $4,
          total_output_tokens = COALESCE(total_output_tokens,0) + $5,
          updated_at = NOW()
        WHERE session_uid = $6
      `, [
        JSON.stringify(result.estimate),
        JSON.stringify([result.estimate]),
        JSON.stringify(chatMessages),
        result.diagnostics?.tokens?.inputTokens || 0,
        result.diagnostics?.tokens?.outputTokens || 0,
        request.params.uid
      ]);

      sendEvent({ type: 'done', chat_response_md: result.chat_response_md, estimate: result.estimate });
    } catch (err) {
      fastify.log.error(err, '[tkp_quick calculate]');
      await db.query(
        "UPDATE tkp_quick_sessions SET status='error', error_text=$1, updated_at=NOW() WHERE session_uid=$2",
        [String(err.message).substring(0, 1000), request.params.uid]
      );
      sendEvent({ type: 'error', message: err.message });
    } finally {
      reply.raw.end();
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /sessions/:uid/chat — SSE: диалог-правки → обновить estimate_draft
  // ─────────────────────────────────────────────────────────────────────────
  fastify.post('/sessions/:uid/chat', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    const { message } = request.body || {};
    if (!message?.trim()) return reply.code(400).send({ error: 'Сообщение не может быть пустым' });

    const { rows: [session] } = await db.query(
      "SELECT * FROM tkp_quick_sessions WHERE session_uid = $1 AND author_id = $2 AND status = 'chatting'",
      [request.params.uid, request.user.id]
    );
    if (!session) return reply.code(404).send({ error: 'Сессия не найдена или не в режиме чата' });

    // SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    const sendEvent = (data) => {
      try { reply.raw.write(`data: ${JSON.stringify(data)}\n\n`); } catch (_) {}
    };

    try {
      sendEvent({ type: 'start', message: '🧠 Мимир обрабатывает правку...' });

      // Восстанавливаем историю сообщений для AI
      const chatMessages = Array.isArray(session.chat_messages) ? session.chat_messages : [];
      const history = chatMessages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({
          role: m.role,
          content: m.role === 'assistant'
            ? (m.content || '') + (m.estimate ? '\n\n```json\n' + JSON.stringify(m.estimate, null, 2) + '\n```' : '')
            : m.content
        }));

      const settings = await mimirTkpQuick._loadSettings(db);

      const result = await mimirTkpQuick.continueChat({
        tz_text: message,
        customer_inn: session.customer_inn,
        customer_name: session.customer_name,
        customer_data: session.customer_data,
        history,
        settings,
        onProgress: sendEvent
      });

      // Обновляем chat_messages + estimate_draft
      const newEstimate = result.estimate || session.estimate_draft;
      const updatedMessages = [
        ...chatMessages,
        { role: 'user', content: message, ts: new Date().toISOString() },
        { role: 'assistant', content: result.chat_response_md, estimate: result.estimate, ts: new Date().toISOString() }
      ];
      const updatedHistory = [
        ...(Array.isArray(session.estimate_history) ? session.estimate_history : []),
        ...(result.estimate ? [result.estimate] : [])
      ];

      await db.query(`
        UPDATE tkp_quick_sessions SET
          estimate_draft   = $1,
          estimate_history = $2,
          chat_messages    = $3,
          total_input_tokens  = COALESCE(total_input_tokens,0) + $4,
          total_output_tokens = COALESCE(total_output_tokens,0) + $5,
          updated_at = NOW()
        WHERE session_uid = $6
      `, [
        JSON.stringify(newEstimate),
        JSON.stringify(updatedHistory),
        JSON.stringify(updatedMessages),
        result.diagnostics?.tokens?.inputTokens || 0,
        result.diagnostics?.tokens?.outputTokens || 0,
        request.params.uid
      ]);

      sendEvent({ type: 'done', chat_response_md: result.chat_response_md, estimate: newEstimate });
    } catch (err) {
      fastify.log.error(err, '[tkp_quick chat]');
      sendEvent({ type: 'error', message: err.message });
    } finally {
      reply.raw.end();
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /sessions/:uid/direct-edit — Прямая правка estimate_draft (без AI).
  // 21.06.2026: AI continueChat при простых правках типа «маржу 30%» переписывал
  // смету ПОЛНОСТЬЮ с нуля (cost падал в 150 раз). Прямой endpoint обновляет
  // только указанные поля и перегенерирует xlsx/docx.
  //
  // Body: { margin_pct?: 30, markup_multiplier?: 2.2, material_markup?: 1.25, vat_pct?: 22 }
  // ─────────────────────────────────────────────────────────────────────────
  fastify.post('/sessions/:uid/direct-edit', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    const body = request.body || {};
    const { rows: [session] } = await db.query(
      "SELECT * FROM tkp_quick_sessions WHERE session_uid = $1 AND author_id = $2 AND status IN ('chatting', 'draft')",
      [request.params.uid, request.user.id]
    );
    if (!session) return reply.code(404).send({ error: 'Сессия не найдена или финализирована' });
    if (!session.estimate_draft) return reply.code(400).send({ error: 'Нет черновика для правки' });

    const draft = JSON.parse(JSON.stringify(session.estimate_draft)); // deep clone
    const meta = draft.ai_meta || (draft.ai_meta = {});
    const totals = meta.totals || (meta.totals = {});

    // Применяем правки
    const fixedFields = [];
    if (Number.isFinite(Number(body.margin_pct))) {
      const pct = Number(body.margin_pct);
      totals.margin_pct = pct;
      // markup_multiplier = (100 + margin_pct) / 100. Маржа 100% → коэф 2.0; 30% → 1.3
      // Однако в нашей системе "стандартная наценка" = 2.2 (margin 120%). Различаем:
      // если margin_pct ≤ 100 — это GROSS MARGIN, иначе наценка.
      // Делаем оба варианта пересчитанными синхронно.
      totals.markup_multiplier = +(1 + pct / 100).toFixed(3);
      fixedFields.push(`margin_pct=${pct}`);
    }
    if (Number.isFinite(Number(body.markup_multiplier))) {
      totals.markup_multiplier = Number(body.markup_multiplier);
      totals.margin_pct = +((Number(body.markup_multiplier) - 1) * 100).toFixed(1);
      fixedFields.push(`markup_multiplier=${body.markup_multiplier}`);
    }
    if (Number.isFinite(Number(body.material_markup))) {
      totals.material_markup = Number(body.material_markup);
      fixedFields.push(`material_markup=${body.material_markup}`);
    }
    if (Number.isFinite(Number(body.vat_pct))) {
      totals.vat_pct = Number(body.vat_pct);
      fixedFields.push(`vat_pct=${body.vat_pct}`);
    }
    if (!fixedFields.length) return reply.code(400).send({ error: 'Не задано ни одного поля для правки' });

    // Пересчёт total_with_margin и total_with_vat
    const cost = Number(totals.total_cost) || 0;
    const markup = Number(totals.markup_multiplier) || 2.2;
    const vat = Number(totals.vat_pct) || 22;
    totals.total_with_margin = +(cost * markup).toFixed(2);
    totals.total_with_vat = +(totals.total_with_margin * (1 + vat / 100)).toFixed(2);

    // КРИТИЧНО: дублируем markup в ai_meta.estimate.markup_multiplier — generator берёт
    // его раньше чем totals.markup_multiplier (`est.markup_multiplier || totals.markup_multiplier`).
    // Без этого xlsx показывал старое значение 2.2 после правки на 1.3.
    if (meta.estimate) {
      if (Number.isFinite(Number(body.margin_pct)) || Number.isFinite(Number(body.markup_multiplier))) {
        meta.estimate.markup_multiplier = totals.markup_multiplier;
      }
      if (Number.isFinite(Number(body.material_markup))) {
        meta.estimate.material_markup = totals.material_markup;
      }
      if (Number.isFinite(Number(body.vat_pct))) {
        meta.estimate.vat_pct = totals.vat_pct;
      }
    }

    // Текстовые правки секций отчёта (если переданы)
    if (typeof body.summary === 'string') {
      meta.analysis = meta.analysis || {};
      meta.analysis.summary = body.summary.trim() || null;
      fixedFields.push('summary');
    }
    if (typeof body.section_2_text === 'string') {
      meta.analysis = meta.analysis || {};
      meta.analysis.section_2_text = body.section_2_text.trim() || null;
      fixedFields.push('section_2_text');
    }
    if (Array.isArray(body.recommendations)) {
      meta.analysis = meta.analysis || {};
      meta.analysis.recommendations = body.recommendations.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim());
      fixedFields.push(`recommendations(${meta.analysis.recommendations.length})`);
    }
    if (Array.isArray(body.warnings)) {
      meta.analysis = meta.analysis || {};
      meta.analysis.warnings = body.warnings.filter(Boolean).map(w => {
        if (typeof w === 'string') return { title: 'Внимание', text: w.trim() };
        return { title: String(w.title || 'Внимание'), text: String(w.text || '').trim() };
      });
      fixedFields.push(`warnings(${meta.analysis.warnings.length})`);
    }

    // Сбрасываем кэшированный summary/section2 только если они НЕ были изменены явно
    // (изменение margin/markup → старый summary противоречит новым числам).
    if (meta.analysis && !body.summary && (Number.isFinite(Number(body.margin_pct)) || Number.isFinite(Number(body.markup_multiplier)))) {
      meta.analysis.summary = null;
    }
    if (meta.analysis && !body.section_2_text && (Number.isFinite(Number(body.margin_pct)) || Number.isFinite(Number(body.markup_multiplier)))) {
      meta.analysis.section_2_text = null;
    }

    // Сохраняем — НО НЕ пишем в pre_tender_requests.manual_documents (это финал).
    // Промежуточные правки только в session.estimate_draft.
    const chatMessages = Array.isArray(session.chat_messages) ? session.chat_messages : [];
    const updatedMessages = [
      ...chatMessages,
      {
        role: 'user',
        content: `Прямая правка: ${fixedFields.join(', ')}`,
        ts: new Date().toISOString()
      },
      {
        role: 'assistant',
        content: `✓ Применил: ${fixedFields.join(', ')}. Новый total_with_vat = ${totals.total_with_vat.toLocaleString('ru-RU')} ₽`,
        estimate: draft,
        ts: new Date().toISOString()
      }
    ];

    await db.query(
      `UPDATE tkp_quick_sessions SET
         estimate_draft = $1,
         chat_messages = $2,
         updated_at = NOW()
       WHERE session_uid = $3`,
      [JSON.stringify(draft), JSON.stringify(updatedMessages), request.params.uid]
    );

    return {
      ok: true,
      applied: fixedFields,
      estimate: draft,
      totals: {
        cost,
        margin_pct: totals.margin_pct,
        markup_multiplier: totals.markup_multiplier,
        total_with_margin: totals.total_with_margin,
        total_with_vat: totals.total_with_vat,
        vat_pct: totals.vat_pct
      }
    };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GET /sessions/:uid/preview-data — JSON-данные отчёта для UI-предпросмотра.
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get('/sessions/:uid/preview-data', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    const { rows: [session] } = await db.query(
      "SELECT * FROM tkp_quick_sessions WHERE session_uid = $1 AND author_id = $2",
      [request.params.uid, request.user.id]
    );
    if (!session) return reply.code(404).send({ error: 'Сессия не найдена' });
    if (!session.estimate_draft) return reply.code(400).send({ error: 'Нет черновика' });

    const meta = session.estimate_draft.ai_meta || session.estimate_draft;
    const totals = meta.totals || {};
    const analysis = meta.analysis || {};

    // Загружаем pre_tender / tender для project / customer
    let project = {};
    let customer = { name: session.customer_name, inn: session.customer_inn };
    try {
      if (session.pre_tender_id) {
        const r = await db.query(
          `SELECT customer_name, customer_inn, contact_person, work_description, work_location, work_deadline
             FROM pre_tender_requests WHERE id = $1`, [session.pre_tender_id]
        );
        if (r.rows[0]) {
          const pt = r.rows[0];
          customer = {
            name: pt.customer_name, inn: pt.customer_inn,
            address: pt.work_location, contact_person: pt.contact_person
          };
          project = {
            subject: pt.work_description,
            object: pt.work_location,
            deadline: pt.work_deadline ? new Date(pt.work_deadline).toLocaleDateString('ru-RU') : null
          };
        }
      }
    } catch (_) {}

    return {
      ok: true,
      session_uid: request.params.uid,
      project,
      customer,
      totals: {
        total_cost: Number(totals.total_cost) || 0,
        total_with_margin: Number(totals.total_with_margin) || 0,
        total_with_vat: Number(totals.total_with_vat) || 0,
        margin_pct: Number(totals.margin_pct) || null,
        markup_multiplier: Number(totals.markup_multiplier) || 2.2,
        material_markup: Number(totals.material_markup) || 1.25,
        vat_pct: Number(totals.vat_pct) || 22
      },
      analysis: {
        summary: analysis.summary || null,
        section_2_text: analysis.section_2_text || null,
        recommendations: Array.isArray(analysis.recommendations) ? analysis.recommendations : [],
        warnings: Array.isArray(analysis.warnings) ? analysis.warnings : []
      },
      estimate_brief: {
        crew_count: meta.estimate?.crew_count || null,
        work_days: meta.estimate?.work_days || null,
        road_days: meta.estimate?.road_days || null,
        shifts_per_day: meta.estimate?.shifts_per_day || null
      }
    };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GET /sessions/:uid/preview-doc/:kind — стрим xlsx/docx ИЗ ПАМЯТИ.
  // НЕ сохраняет в pre_tender_requests.manual_documents.
  // kind = 'smeta' | 'report'
  // Поддержка ?token= для window.open (без Authorization header).
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get('/sessions/:uid/preview-doc/:kind', {
    preHandler: [
      async (request) => {
        if (!request.headers.authorization && request.query.token) {
          request.headers.authorization = 'Bearer ' + request.query.token;
        }
      },
      fastify.requireRoles(ROLES)
    ]
  }, async (request, reply) => {
    const kind = request.params.kind;
    if (!['smeta', 'report'].includes(kind)) return reply.code(400).send({ error: 'kind: smeta | report' });

    const { rows: [session] } = await db.query(
      "SELECT * FROM tkp_quick_sessions WHERE session_uid = $1 AND author_id = $2",
      [request.params.uid, request.user.id]
    );
    if (!session) return reply.code(404).send({ error: 'Сессия не найдена' });
    if (!session.estimate_draft) return reply.code(400).send({ error: 'Нет черновика' });

    try {
      const { xlsxBuf, docxBuf } = await mimirTkpQuick.generatePreviewBuffers({
        estimate_draft: session.estimate_draft,
        pre_tender_id: session.pre_tender_id,
        tender_id: session.tender_id,
        customer_name: session.customer_name,
        customer_inn: session.customer_inn,
        author_id: session.author_id,
        work_type: session.work_type
      });
      const buf = kind === 'smeta' ? xlsxBuf : docxBuf;
      const ext = kind === 'smeta' ? 'xlsx' : 'docx';
      const mime = kind === 'smeta'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      const fname = `${kind === 'smeta' ? 'Смета' : 'Отчёт'}_preview_${request.params.uid.slice(0, 8)}.${ext}`;
      reply.header('Content-Type', mime);
      reply.header('Content-Disposition', `attachment; filename="${fname}"; filename*=UTF-8''${encodeURIComponent(fname)}`);
      reply.send(buf);
    } catch (e) {
      request.log.error(e, '[preview-doc] failed');
      return reply.code(500).send({ error: 'Не удалось сгенерировать предпросмотр: ' + e.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /sessions/:uid/save-to-card — Сохранить смету+отчёт в карточку заявки
  // (pre_tender_requests.manual_documents). Без финализации в tkp.
  // Используется кнопкой «✓ Сохранить в карточку» в UI.
  // ─────────────────────────────────────────────────────────────────────────
  fastify.post('/sessions/:uid/save-to-card', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    const { rows: [session] } = await db.query(
      "SELECT * FROM tkp_quick_sessions WHERE session_uid = $1 AND author_id = $2",
      [request.params.uid, request.user.id]
    );
    if (!session) return reply.code(404).send({ error: 'Сессия не найдена' });
    if (!session.estimate_draft) return reply.code(400).send({ error: 'Нет черновика' });
    if (!session.pre_tender_id && !session.tender_id) {
      return reply.code(400).send({ error: 'Сессия не привязана к заявке/тендеру' });
    }

    try {
      const saved = await mimirTkpQuick.saveDocsToCard({
        estimate_draft: session.estimate_draft,
        pre_tender_id: session.pre_tender_id,
        tender_id: session.tender_id,
        customer_name: session.customer_name,
        customer_inn: session.customer_inn,
        author_id: session.author_id,
        work_type: session.work_type
      });
      return { ok: true, saved };
    } catch (e) {
      request.log.error(e, '[save-to-card] failed');
      return reply.code(500).send({ error: 'Не удалось сохранить в карточку: ' + e.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /sessions/:uid/finalize — Создать ТКП (+ ДС если parent_work_id)
  // ─────────────────────────────────────────────────────────────────────────
  fastify.post('/sessions/:uid/finalize', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    const { link_type: manualLinkType, purpose_reason } = request.body || {};

    const { rows: [session] } = await db.query(
      "SELECT * FROM tkp_quick_sessions WHERE session_uid = $1 AND author_id = $2 AND status IN ('chatting','draft')",
      [request.params.uid, request.user.id]
    );
    if (!session) return reply.code(404).send({ error: 'Сессия не найдена' });

    const draft = session.estimate_draft;
    if (!draft) return reply.code(400).send({ error: 'Нет черновика ТКП — сначала запустите расчёт' });

    let workId = null;

    // Если parent_work_id задан → создаём ДС-работу перед ТКП
    if (session.parent_work_id) {
      const { rows: [parent] } = await db.query(
        'SELECT * FROM works WHERE id = $1 AND deleted_at IS NULL',
        [session.parent_work_id]
      );
      if (!parent) return reply.code(404).send({ error: 'Родительская работа не найдена' });

      const { rows: [cntRow] } = await db.query(
        'SELECT COUNT(*) AS cnt FROM works WHERE parent_work_id = $1',
        [session.parent_work_id]
      );
      const addNumber = 'ДС-' + (Number(cntRow.cnt) + 1);

      const { rows: [addWork] } = await db.query(`
        INSERT INTO works (
          tender_id, pm_id, work_number, work_title, work_status, contract_value,
          customer_name, customer_inn, site_id, vat_pct,
          work_kind, parent_work_id, addendum_number, addendum_reason, created_by
        ) VALUES ($1,$2,$3,$4,'Новая',$5,$6,$7,$8,$9,'addendum',$10,$11,$12,$13)
        RETURNING id
      `, [
        parent.tender_id, parent.pm_id,
        (parent.work_number || '') + '/' + addNumber,
        draft.subject || (parent.work_title + ' — ' + addNumber),
        Number(draft.total_with_vat || draft.subtotal || 0),
        parent.customer_name, parent.customer_inn || null, parent.site_id || null,
        draft.vat_pct || 20,
        session.parent_work_id, addNumber, draft.work_description || null,
        request.user.id
      ]);
      workId = addWork.id;
    }

    // Определяем link_type
    const linkType = manualLinkType ||
      (session.parent_work_id ? 'addendum' :
       session.tender_id      ? 'tender'   :
       session.pre_tender_id  ? 'direct_request' : 'standalone');

    const itemsVal = JSON.stringify({ items: draft.items || [], vat_pct: draft.vat_pct || 20 });

    const { rows: [newTkp] } = await db.query(`
      INSERT INTO tkp (
        subject, tender_id, work_id, pre_tender_id, link_type,
        customer_name, customer_inn, work_description,
        items, total_sum, deadline, validity_days, payment_terms,
        source, status, mimir_quick_session_uid, purpose_reason, author_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'sent',$15,$16,$17)
      RETURNING *
    `, [
      draft.subject || 'ТКП через Мимира',
      session.tender_id || null,
      workId || null,
      session.pre_tender_id || null,
      linkType,
      session.customer_name || null,
      session.customer_inn  || null,
      draft.work_description || null,
      itemsVal,
      Number(draft.total_with_vat || draft.subtotal || 0),
      draft.deadline || null,
      Number(draft.validity_days || 30),
      draft.payment_terms || null,
      'mimir_quick',
      request.params.uid,
      purpose_reason || null,
      request.user.id
    ]);

    // Обновить сессию
    await db.query(
      "UPDATE tkp_quick_sessions SET tkp_id=$1, status='finalized', finalized_at=NOW(), updated_at=NOW() WHERE session_uid=$2",
      [newTkp.id, request.params.uid]
    );

    // Если direct_request → обратная ссылка
    if (session.pre_tender_id) {
      await db.query(
        'UPDATE pre_tender_requests SET created_tkp_id=$1 WHERE id=$2 AND created_tkp_id IS NULL',
        [newTkp.id, session.pre_tender_id]
      );
    }

    // 21.06.2026: при финализации СОХРАНЯЕМ смету+отчёт в карточку заявки.
    // Раньше это делалось на каждой chat-правке (теперь только при финале).
    let savedDocs = [];
    try {
      savedDocs = await mimirTkpQuick.saveDocsToCard({
        estimate_draft: session.estimate_draft,
        pre_tender_id: session.pre_tender_id,
        tender_id: session.tender_id,
        customer_name: session.customer_name,
        customer_inn: session.customer_inn,
        author_id: session.author_id,
        work_type: session.work_type
      });
    } catch (e) {
      request.log.warn({ err: e.message }, '[finalize] saveDocsToCard failed (non-blocking)');
    }

    return { tkp: newTkp, work_id: workId, saved_docs: savedDocs };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // DELETE /sessions/:uid — Отказаться от сессии
  // ─────────────────────────────────────────────────────────────────────────
  fastify.delete('/sessions/:uid', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    const { rowCount } = await db.query(
      "UPDATE tkp_quick_sessions SET status='abandoned', updated_at=NOW() WHERE session_uid=$1 AND author_id=$2",
      [request.params.uid, request.user.id]
    );
    if (!rowCount) return reply.code(404).send({ error: 'Сессия не найдена' });
    return { ok: true };
  });
}

module.exports = routes;
