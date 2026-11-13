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
  // Сколько символов OCR отдаём в промпт Quick (DeepSeek держит большой контекст)
  const ATTACH_CHARS_CAP = Math.max(
    80000,
    parseInt(process.env.MIMIR_QUICK_ATTACH_CHARS || '400000', 10) || 400000
  );
  const TENDER_CACHE_MIN_CHARS = 30000;
  const TENDER_CACHE_MIN_DOCS = 5;
  const STALE_CALCULATING_MIN = Math.max(
    2,
    parseInt(process.env.TKP_QUICK_STALE_CALC_MIN || '3', 10) || 3
  );

  function docPriorityName(name) {
    const n = String(name || '').toLowerCase();
    if (/техническ|тех.?зада|тз\b|задан/.test(n)) return 0;
    if (/ведомост/.test(n)) return 1;
    if (/объем|объём|ам-|трубк/.test(n)) return 2;
    return 3;
  }

  /** Готовый OCR-кэш документов тендера (фон-воркер) → текст для Quick */
  async function loadTenderOcrCache(tenderId, maxChars = ATTACH_CHARS_CAP) {
    if (!tenderId) return { count: 0, chars: 0, text: '', docs: [] };
    const { rows: ocrDocs } = await db.query(
      `SELECT original_name, ocr_text
       FROM documents
       WHERE tender_id = $1
         AND ocr_status = 'done'
         AND ocr_text IS NOT NULL
         AND length(trim(ocr_text)) > 20
         AND ocr_text NOT ILIKE '%[Demo]%'
         AND ocr_text NOT ILIKE '%демо-режим%'
         AND ocr_text NOT ILIKE '%[ошибка OCR%'
       ORDER BY
         CASE
           WHEN original_name ~* 'техническ|тех.?зада|тз|задан' THEN 0
           WHEN original_name ~* 'ведомост' THEN 1
           WHEN original_name ~* 'объем|объём|ам-|трубк' THEN 2
           ELSE 3
         END,
         id`,
      [tenderId]
    );
    let text = '';
    let used = 0;
    for (const d of ocrDocs) {
      const prio = docPriorityName(d.original_name);
      const perCap = prio <= 1 ? 45000 : (prio === 2 ? 20000 : 12000);
      const block = `[${d.original_name}]\n${String(d.ocr_text).slice(0, perCap)}`;
      const sep = text ? '\n\n---\n\n' : '';
      if (text.length + sep.length + block.length > maxChars) {
        const room = maxChars - text.length - sep.length;
        if (room > 800) {
          text += sep + block.slice(0, room);
          used += 1;
        }
        break;
      }
      text += sep + block;
      used += 1;
    }
    return { count: used, chars: text.length, text, docs: ocrDocs };
  }

  /**
   * Зависший calculating после рестарта/обрыва SSE → draft, чтобы можно было пересчитать.
   *
   * D-389 (инцидент 28.10.2026, сессия 895c144b): признаком «жив» был только
   * `updated_at`, а его двигал heartbeat внутри процесса. Любой рестарт
   * (а в тот день их было 10) означал: расчёт мёртв физически, но запись
   * выглядит живой до истечения окна — а после — «Расчёт прерван», хотя
   * человек видел 41% и работал. Хуже: если расчёт УСПЕЛ закончиться до
   * истечения окна, reclaim его не тронет, но и человек не узнает, что
   * результат лежит в БД — он ждёт SSE, которого уже нет.
   *
   * Теперь у записи есть `calc_owner_pid` — PID процесса, который её ведёт.
   * Если PID не совпадает с текущим и процесс мёртв, запись освобождается
   * СРАЗУ, без ожидания окна: сервер точно знает, что расчёт умер.
   * Окно по времени остаётся запасным случаем (зависание без падения).
   *
   * Возвращает true, если сессия была освобождена.
   */
  async function reclaimStaleCalculating(sessionUid, authorId) {
    const { rows } = await db.query(
      `UPDATE tkp_quick_sessions
       SET status = 'draft',
           error_text = COALESCE(error_text, 'Расчёт прерван — можно запустить снова'),
           calc_owner_pid = NULL,
           updated_at = NOW()
       WHERE session_uid = $1
         AND author_id = $2
         AND status = 'calculating'
         AND (
           -- процесс-владелец умер: сервер перезапускался, расчёт не жив
           (calc_owner_pid IS NOT NULL AND calc_owner_pid <> $4)
           -- запасной случай: завис без падения процесса
           OR updated_at < NOW() - make_interval(mins => $3::int)
         )
       RETURNING session_uid`,
      [sessionUid, authorId, STALE_CALCULATING_MIN, process.pid]
    );
    return rows.length > 0;
  }

  /**
   * D-389: кто имеет право работать с сессией просчёта.
   *
   * Инцидент 28.10.2026: пользователь открыл чужой просчёт, и каждый запрос
   * возвращал 404 — снаружи «выкинуло из просчёта», а затем «нельзя запустить».
   * Причина: ВСЕ операции фильтровались по `author_id`.
   *
   * Правило: черновик без объекта — личный (там автор единственный владелец,
   * иначе чужие наброски ТЗ были бы видны всем). Просчёт по ОБЪЕКТУ — общий:
   * его видит автор и те, кому доступен объект. Директора и бухгалтерия видят
   * всё — как в матрице реестра документов.
   *
   * @param {object} db
   * @param {{id:number, role:string}} user
   * @param {object} session — строка tkp_quick_sessions
   * @returns {Promise<boolean>}
   */
  async function canSeeSession(db, user, session) {
    if (!session) return false;
    const role = String(user.role || '').toUpperCase();
    if (role === 'ADMIN') return true;
    if (Number(session.author_id) === Number(user.id)) return true;

    const workId = Number(session.parent_work_id) || null;
    const tenderId = Number(session.tender_id) || null;
    // Чужой черновик без объекта — не показываем: личные наброски ТЗ.
    if (!workId && !tenderId) return false;

    const FULL = ['BUH', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'DIRECTOR',
      'OFFICE_MANAGER', 'HEAD_PM'];
    if (FULL.includes(role)) return true;

    // Объект доступен, если человек по нему ответственный (РП) либо уже имеет
    // видимые документы по этому объекту — та же матрица, что у реестра.
    try {
      if (workId) {
        const own = await db.query(
          `SELECT 1 FROM works w
            WHERE w.id = $1 AND (w.pm_id = $2 OR w.manager_id = $2) LIMIT 1`,
          [workId, user.id]).catch(() => ({ rows: [] }));
        if (own.rows.length) return true;

        const { visibilitySql } = require('../lib/doc-visibility');
        return await (async () => {
          const params = [workId];
          const vis = visibilitySql(params, role, user.id, { scope: 'all' });
          const viaDocs = await db.query(
            `SELECT 1 FROM doc_registry d
              WHERE d.work_id = $1 AND d.deleted_at IS NULL${vis} LIMIT 1`, params);
          return viaDocs.rows.length > 0;
        })();
      }
      // Тендер: автор тендера или его РП.
      const r = await db.query(
        `SELECT 1 FROM pre_tenders pt
          WHERE pt.id = $1 AND (pt.created_by = $2 OR pt.pm_id = $2) LIMIT 1`,
        [tenderId, user.id]).catch(() => ({ rows: [] }));
      return r.rows.length > 0;
    } catch (e) {
      console.warn('[tkp_quick] canSeeSession: ' + (e && e.message));
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // POST /sessions — Создать сессию
  // ─────────────────────────────────────────────────────────────────────────
  fastify.post('/sessions', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    const {
      customer_inn, customer_name, tz_text,
      pre_tender_id, tender_id, parent_work_id,
      reuse_existing
    } = request.body || {};

    // Повторный анализ того же тендера НЕ должен плодить сессии.
    // Дефект 07.11 (тендер 2138): каждый прогон создавал новую сессию,
    // у тендера накопилось 18 сессий. Последняя случайно дала 5 позиций
    // вместо 271 — и именно её видит РП, а прежний полный разбор потерян.
    // Теперь при reuse_existing (и по умолчанию для тендера с готовым
    // состоянием) отдаём существующую сессию — анализ обновит её же.
    if (tender_id) {
      try {
        const { rows: [exist] } = await db.query(
          `SELECT session_uid, stage, stage_state
             FROM tkp_quick_sessions
            WHERE tender_id = $1
              AND stage_state IS NOT NULL
              AND jsonb_array_length(COALESCE(stage_state->'positions', '[]'::jsonb)) > 0
            ORDER BY id DESC LIMIT 1`,
          [tender_id]
        );
        if (exist && exist.session_uid) {
          return {
            ok: true,
            reused: true,
            session: {
              session_uid: exist.session_uid,
              tender_id,
              stage: exist.stage || 'intake',
              state: require('../services/mimir-tender-stages').normalizeState(exist.stage_state),
              version: 0
            }
          };
        }
      } catch (e) {
        // Не критично: если не нашли — создадим новую как раньше.
        request.log.warn({ err: e }, 'reuse existing session failed');
      }
    }

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
    await reclaimStaleCalculating(request.params.uid, request.user.id);
    // D-389: читать сессию может не только автор — но и тот, кому доступен
    // объект просчёта (см. canSeeSession). Иначе коллега получал 404.
    const { rows: [session] } = await db.query(
      'SELECT * FROM tkp_quick_sessions WHERE session_uid = $1',
      [request.params.uid]
    );
    if (!session) return reply.code(404).send({ error: 'Сессия не найдена' });
    if (!(await canSeeSession(db, request.user, session))) {
      return reply.code(404).send({ error: 'Сессия не найдена' });
    }
    return { session };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Этапы Мимира: GET /sessions/:uid/stage, POST /stage, /stage/answer, /stage/patch
  // ─────────────────────────────────────────────────────────────────────────
  const stageSvc = require('../services/mimir-tender-stages');

  async function loadSessionForStages(uid) {
    const { rows: [session] } = await db.query(
      'SELECT * FROM tkp_quick_sessions WHERE session_uid = $1', [uid]
    );
    return session || null;
  }

  fastify.get('/sessions/:uid/stage', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    const session = await loadSessionForStages(request.params.uid);
    if (!session) return reply.code(404).send({ error: 'Сессия не найдена' });
    if (!(await canSeeSession(db, request.user, session))) {
      return reply.code(404).send({ error: 'Сессия не найдена' });
    }
    const s = await stageSvc.loadStage(db, request.params.uid);
    // Категории и методы — для выпадающего списка в таблице объёмов.
    let categories = [];
    try {
      categories = (await db.query(
        `SELECT code, title, methods_json FROM work_norm_categories WHERE is_active ORDER BY sort_order`
      )).rows;
    } catch (_) { /* справочник необязателен для отрисовки */ }
    return {
      ...s,
      labels: stageSvc.STAGE_LABELS,
      analysis_stages: stageSvc.ANALYSIS_STAGES,
      calc_stages: stageSvc.CALC_STAGES,
      categories,
      // Вопросы для звонка и контакт заказчика — считаются из сохранённого
      // состояния объёмов и текста ТЗ, поэтому доступны на любом этапе.
      call_questions: stageSvc.callQuestionsFromDv(
        { positions: (s.state && s.state.positions) || [] },
        { tz_text: session.tz_text || '' }
      ),
      contact: stageSvc.extractContact(session.tz_text || ''),
      can_finish_tech: stageSvc.canFinishTech(s.state)
    };
  });

  fastify.post('/sessions/:uid/stage', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    const session = await loadSessionForStages(request.params.uid);
    if (!session) return reply.code(404).send({ error: 'Сессия не найдена' });
    if (!(await canSeeSession(db, request.user, session))) {
      return reply.code(404).send({ error: 'Сессия не найдена' });
    }
    try {
      const b = request.body || {};
      return await stageSvc.saveStage(db, request.params.uid, {
        stage: b.stage,
        state: b.state,
        expectedVersion: b.expected_version
      });
    } catch (e) {
      return reply.code(e.statusCode || 500).send({ error: e.message });
    }
  });

  /**
   * POST /sessions/:uid/stage/files — приложить документы прямо в модалке этапов.
   *
   * РП может прислать файлы двумя путями:
   *   1) здесь — они уходят в сессию и сразу участвуют в анализе;
   *   2) в карточку тендера — тогда анализ читает их из кэша OCR.
   * Оба пути поддерживаются, файл после загрузки не нужно прикреплять повторно.
   */
  fastify.post('/sessions/:uid/stage/files', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    const session = await loadSessionForStages(request.params.uid);
    if (!session) return reply.code(404).send({ error: 'Сессия не найдена' });
    if (!(await canSeeSession(db, request.user, session))) {
      return reply.code(404).send({ error: 'Сессия не найдена' });
    }

    const data = await request.file();
    if (!data) return reply.code(400).send({ error: 'Файл не передан' });

    const filename = data.filename || 'document';
    const mime = data.mimetype || '';
    let buffer;
    try { buffer = await data.toBuffer(); } catch (_) {
      return reply.code(400).send({ error: 'Не удалось прочитать файл' });
    }
    if (!buffer || !buffer.length) {
      return reply.code(400).send({ error: 'Файл пустой — скачайте заново и приложите' });
    }
    if (data.file && data.file.truncated) {
      return reply.code(413).send({ error: 'Файл больше допустимого размера' });
    }

    // Проверка сигнатуры: битые «PDF» от прокси не должны доходить до распознавания.
    try {
      const { checkFileSignature, explainSignatureFailure } = require('../lib/file-signature');
      const ext = require('path').extname(filename).toLowerCase();
      const sig = checkFileSignature(buffer, ext);
      if (!sig.ok) {
        return reply.code(422).send({
          error: 'file_corrupted',
          message: explainSignatureFailure(sig, filename)
        });
      }
    } catch (_) { /* проверка сигнатур необязательна */ }

    // Текст: txt/csv читаем напрямую, остальное отдаём распознаванию.
    let text = '';
    const ext = require('path').extname(filename).toLowerCase();
    if (['.txt', '.csv', '.md', '.json'].includes(ext)) {
      text = buffer.toString('utf8').slice(0, 200000);
    } else {
      try {
        const tkpParser = require('../services/tkp-parser');
        const parsed = await tkpParser.extractTextFromBuffer
          ? await tkpParser.extractTextFromBuffer(buffer, filename)
          : null;
        if (parsed && parsed.text) text = String(parsed.text).slice(0, 200000);
      } catch (_) { /* распознавание попробуем позже, в анализе */ }
    }

    const attachments = Array.isArray(session.tz_attachments) ? session.tz_attachments.slice() : [];
    const item = {
      filename,
      original_name: filename,
      mime_type: mime,
      size: buffer.length,
      ocr_text: text,
      uploaded_at: new Date().toISOString(),
      source: 'stage_modal'
    };
    attachments.push(item);
    await db.query(
      `UPDATE tkp_quick_sessions SET tz_attachments = $2::jsonb, updated_at = NOW()
        WHERE session_uid = $1`,
      [request.params.uid, JSON.stringify(attachments)]
    );

    return {
      ok: true,
      file: {
        original_name: filename,
        size: buffer.length,
        text_len: text.length,
        has_text: text.length > 40
      },
      attachments: attachments.map((a) => ({
        original_name: a.original_name || a.filename,
        size: a.size || 0,
        text_len: String(a.ocr_text || '').length
      }))
    };
  });

  /**
   * POST /sessions/:uid/stage/answer — ответ на пробел этапа clarify.
   * Тело: { gap_id, text } | { gap_id, later:true } | { gap_id, continue_without:true }
   */
  fastify.post('/sessions/:uid/stage/answer', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    const session = await loadSessionForStages(request.params.uid);
    if (!session) return reply.code(404).send({ error: 'Сессия не найдена' });
    if (!(await canSeeSession(db, request.user, session))) {
      return reply.code(404).send({ error: 'Сессия не найдена' });
    }
    const b = request.body || {};
    if (!b.gap_id) return reply.code(400).send({ error: 'gap_id обязателен' });

    const cur = await stageSvc.loadStage(db, request.params.uid);
    let state = cur.state;

    if (b.later) {
      return { stage: cur.stage, state, version: cur.version, deferred: true };
    }

    if (b.continue_without) {
      try {
        state = stageSvc.waiveGap(state, b.gap_id);
      } catch (e) {
        return reply.code(e.statusCode || 400).send({ error: e.message });
      }
    } else if (typeof b.text === 'string' && b.text.trim()) {
      state = stageSvc.resolveGap(state, b.gap_id, {
        answer: b.text.trim(), resolved_at: new Date().toISOString()
      });
      // Ответ про СРОК запоминаем отдельным полем: из него считается окно дат
      // и число бригад. Иначе РП ответил «30 дней», а план взял другое окно.
      if (b.gap_id === 'schedule_days') {
        const sched = require('../services/schedule-extract');
        const parsed = sched.extractSchedule(b.text.trim());
        const days = Number(parsed && parsed.days) > 0
          ? Number(parsed.days)
          : (Number(String(b.text).replace(/[^\d.,]/g, '').replace(',', '.')) || null);
        if (days > 0) {
          state.schedule_days = days;
          state.schedule = Object.assign({}, state.schedule || {}, {
            days,
            source: 'rp',
            raw: b.text.trim(),
            mode: (parsed && parsed.mode) || (state.schedule && state.schedule.mode) || null
          });
        }
      }
      // Текст объёмов сразу подмешиваем в ТЗ — иначе следующий расчёт снова спросит.
      if (b.gap_id === 'volume' || b.gap_id === 'tz') {
        await db.query(
          `UPDATE tkp_quick_sessions
              SET tz_text = COALESCE(NULLIF(tz_text, ''), '') ||
                            CASE WHEN COALESCE(tz_text,'') = '' THEN '' ELSE E'\n\n' END || $2,
                  updated_at = NOW()
            WHERE session_uid = $1`,
          [request.params.uid, 'Уточнение по объёмам: ' + b.text.trim()]
        );
      }
    } else {
      return reply.code(400).send({ error: 'Нужен text, later или continue_without' });
    }

    const remaining = state.gaps.filter((g) => !g.resolved);
    const blocking = remaining.filter((g) => g.blocking).length;
    const out = await stageSvc.saveStage(db, request.params.uid, {
      stage: blocking === 0 ? 'read' : 'clarify',
      state,
      expectedVersion: b.expected_version
    });
    return { ...out, blocking_left: blocking };
  });

  /**
   * GET /sessions/:uid/stage/analyze-status — статус/attach к in-flight analyze.
   * Закрытие модалки не убивает разбор: UI подписывается сюда при reopen.
   */
  fastify.get('/sessions/:uid/stage/analyze-status', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    const session = await loadSessionForStages(request.params.uid);
    if (!session) return reply.code(404).send({ error: 'Сессия не найдена' });
    if (!(await canSeeSession(db, request.user, session))) {
      return reply.code(404).send({ error: 'Сессия не найдена' });
    }
    const analyzeJob = require('../services/analyze-job');
    const st = await analyzeJob.getAnalyzeStatus(db, request.params.uid);
    return st;
  });

  /**
   * POST /sessions/:uid/stage/analyze-cancel — явная отмена (единственный abort).
   */
  fastify.post('/sessions/:uid/stage/analyze-cancel', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    const session = await loadSessionForStages(request.params.uid);
    if (!session) return reply.code(404).send({ error: 'Сессия не найдена' });
    if (!(await canSeeSession(db, request.user, session))) {
      return reply.code(404).send({ error: 'Сессия не найдена' });
    }
    const analyzeJob = require('../services/analyze-job');
    return analyzeJob.cancelAnalyze(db, request.params.uid);
  });

  /**
   * POST /sessions/:uid/stage/analyze — сгенерировать ДВ (ведомость объёмов).
   * Возвращает позиции, пробелы и вопросы заказчику. Не падает: при сбое модели
   * отдаёт { ok:false, error } и UI показывает «Повторить».
   */
  fastify.post('/sessions/:uid/stage/analyze', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    const session = await loadSessionForStages(request.params.uid);
    if (!session) return reply.code(404).send({ error: 'Сессия не найдена' });
    if (!(await canSeeSession(db, request.user, session))) {
      return reply.code(404).send({ error: 'Сессия не найдена' });
    }

    const b = request.body || {};
    const workNorms = require('../services/work-norms');
    const stagesAi = require('../services/mimir-tender-stages-ai');
    const aiProvider = require('../services/ai-provider');
    const analyzeJob = require('../services/analyze-job');

    // Job lock ДО hijack: иначе 409 уйдёт в SSE и клиент не поймёт «уже идёт».
    const began = await analyzeJob.beginAnalyze(db, request.params.uid);
    if (began.conflict) {
      return reply.code(409).send({
        ok: false,
        error: 'Анализ уже выполняется — откройте модалку снова, прогресс подхватится',
        job: began.job,
        code: 'ANALYZE_RUNNING'
      });
    }
    if (!began.ok) {
      return reply.code(500).send({ ok: false, error: began.error || 'не удалось стартовать analyze job' });
    }
    const analyzeJobStarted = true;

    // SSE: UI/скрипт шлёт Accept: text/event-stream или body.stream=true.
    // Без стрима — старый JSON (prod-rerun / API). Со стримом — шаги с числами.
    const wantStream = b.stream === true
      || String(request.headers.accept || '').includes('text/event-stream');
    let sendEvent = null;
    let sseKeepalive = null;
    const analyzeStartedAt = Date.now();
    // Последний содержательный шаг: heartbeat повторяет его, а не «жду модель»
    // без числа. Иначе на длинной порции UI показывает только секунды.
    let lastStep = { step: 'start', message: 'Старт анализа', pct: 1 };
    let livePositions = 0;
    if (wantStream) {
      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      sendEvent = (data) => {
        try {
          reply.raw.write(`data: ${JSON.stringify(Object.assign({
            elapsed_sec: Math.round((Date.now() - analyzeStartedAt) / 1000)
          }, data || {}))}\n\n`);
        } catch (_) {}
      };
      sseKeepalive = setInterval(() => {
        try {
          reply.raw.write(`: ping ${Date.now()}\n\n`);
          // Не просто секунды: повторяем последний шаг и накопленные позиции,
          // чтобы на длинной порции было видно, что разбор не стоит.
          const secs = Math.round((Date.now() - analyzeStartedAt) / 1000);
          sendEvent({
            type: 'heartbeat',
            step: lastStep.step,
            pct: lastStep.pct,
            positions: livePositions || lastStep.positions || null,
            message: `[${secs} с] ${lastStep.message}`
              + (livePositions ? ` Уже собрано ${livePositions} поз.` : '')
          });
        } catch (_) {}
      }, 8000);
      sendEvent({ type: 'start', step: 'start', message: 'Старт анализа: собираю документы и историю.', pct: 1 });
    }
    const emit = (ev) => {
      if (!ev) return;
      // Запоминаем содержательный шаг для heartbeat. Служебные ping не в счёт.
      if (ev.message) lastStep = { step: ev.step || lastStep.step, message: ev.message, pct: ev.pct != null ? ev.pct : lastStep.pct };
      if (Number(ev.positions) > 0) livePositions = Number(ev.positions);
      if (sendEvent) sendEvent(Object.assign({ type: 'progress' }, ev));
      // Пишем прогресс в session, чтобы reopen мог attach без живого SSE.
      if (analyzeJobStarted && (ev.message || ev.pct != null)) {
        analyzeJob.patchAnalyzeProgress(db, request.params.uid, {
          pct: ev.pct != null ? ev.pct : lastStep.pct,
          message: ev.message || lastStep.message,
          positions: livePositions || null,
          step: ev.step || lastStep.step
        }).catch(() => {});
      }
    };
    const endStream = () => {
      if (sseKeepalive) clearInterval(sseKeepalive);
      sseKeepalive = null;
    };
    const finishOk = async (payload) => {
      try {
        if (analyzeJobStarted) {
          await analyzeJob.finishAnalyze(db, request.params.uid, {
            resultMeta: {
              positions: (payload && payload.state && payload.state.positions
                ? payload.state.positions.length : null)
            }
          });
          if (session.tender_id) {
            await analyzeJob.commitAnalyzeToReview(db, session.tender_id, payload);
          }
        }
      } catch (e) {
        request.log.warn({ err: e }, 'analyze job finish/commit failed');
      }
      if (wantStream) {
        sendEvent(Object.assign({ type: 'result' }, payload));
        endStream();
        try { reply.raw.end(); } catch (_) {}
        return;
      }
      return payload;
    };
    const finishErr = async (code, payload) => {
      try {
        if (analyzeJobStarted) {
          await analyzeJob.finishAnalyze(db, request.params.uid, {
            error: (payload && payload.error) || 'analyze_failed'
          });
        }
      } catch (_) {}
      if (wantStream) {
        sendEvent(Object.assign({ type: 'error', status: code }, payload));
        endStream();
        try { reply.raw.end(); } catch (_) {}
        return;
      }
      return reply.code(code).send(payload);
    };

    try {
      // Документы сессии + кэш OCR тендера (если есть) — тот же путь, что у расчёта.
      const attachments = Array.isArray(session.tz_attachments) ? session.tz_attachments : [];
      let documents = attachments.map((a) => ({
        original_name: a.filename || a.original_name || 'документ',
        text: a.ocr_text || a.text || '',
        size: a.size || null,
        // Структурный счёт позиций из парсера (V474). Передаём дальше —
        // иначе прямая загрузка теряет счёт и откатывается на текстовые
        // эвристики, которые 13 раз ошибались.
        table_positions: Number(a.table_positions) || 0,
        table_source: a.table_source || null
      }));

      if (session.tender_id) {
        try {
          // Дефект 06.11 (тендер 2138): стояло LIMIT 30 с сортировкой
          // created_at DESC. У тендера 68 документов, и дефектная ведомость
          // на 673 позиции просто не попадала в первые 30 — модель получала
          // только договоры и формы, отвечала 0 позиций.
          //
          // Теперь: лимит по ВАЖНОСТИ, а не по дате загрузки. Документы,
          // которые дают объёмы (ВОР, ведомость, ТЗ), идут первыми.
          // Лимит поднят до 200 — 68 документов проходят целиком.
          const { rows } = await db.query(
            `SELECT original_name, ocr_text, size, table_positions, table_source FROM documents
              WHERE tender_id = $1
                AND COALESCE(ocr_text, '') <> ''
                AND COALESCE(ocr_status, 'done') <> 'failed'
              ORDER BY
                CASE
                  WHEN original_name ~* 'ведомост|дефектн|вор\\b|объ[её]м' THEN 0
                  WHEN original_name ~* 'техническ|тех.?зада|тз\\b|задан' THEN 1
                  WHEN original_name ~* 'смет|спецификац|перечень' THEN 2
                  WHEN original_name ~* 'договор|контракт|шаблон|форма' THEN 8
                  ELSE 4
                END,
                LENGTH(ocr_text) DESC
              LIMIT 200`,
            [session.tender_id]
          );
          const known = new Set(documents.map((d) => String(d.original_name || '').toLowerCase().trim()));
          for (const r of rows) {
            const key = String(r.original_name || '').toLowerCase().trim();
            if (known.has(key)) continue;
            known.add(key);
            documents.push({
              original_name: r.original_name,
              text: r.ocr_text,
              size: r.size,
              // Структурный счёт позиций из парсера (V474). Если посчитан,
              // анализ использует его вместо текстовых эвристик.
              table_positions: Number(r.table_positions) || 0,
              table_source: r.table_source || null
            });
          }
        } catch (_) { /* кэш OCR необязателен */ }
      }

      // ── Дедуп документов по имени ─────────────────────────────────────────
      // На #2138 в БД лежит по 6 копий каждого файла (1453/1595/1607/1619/1630/1641
      // и т.д.) — их плодит повторная загрузка архива. Раньше они все уходили
      // в анализ: бюджет промпта тратился на копии, а модель видела «шесть ТЗ».
      //
      // Сравниваем ТЕКСТ, а не длину: два разных документа с одинаковой длиной
      // раньше схлопывались в один, а копии с OCR-разницей 30 % оставались.
      // Отпечаток = первые+последние фрагменты + нормализованное содержимое,
      // сравнение по доле совпавших слов (быстро и устойчиво к OCR-шуму).
      const textKey = (s) => String(s || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
      const similarity = (a, b) => {
        const A = textKey(a);
        const B = textKey(b);
        if (!A || !B) return A === B ? 1 : 0;
        // Быстрый отсев: сильно разная длина — точно не копия.
        if (Math.min(A.length, B.length) / Math.max(A.length, B.length) < 0.6) return 0;
        const wa = new Set(A.slice(0, 20000).split(' ').filter(Boolean));
        const wb = new Set(B.slice(0, 20000).split(' ').filter(Boolean));
        let inter = 0;
        for (const w of wa) if (wb.has(w)) inter += 1;
        return inter / Math.max(wa.size, wb.size);
      };

      const byName = new Map();
      const deduped = [];
      let duplicatesDropped = 0;
      for (const d of documents) {
        const key = String(d.original_name || '').toLowerCase().trim();
        const group = byName.get(key);
        if (!group) {
          byName.set(key, [d]);
          deduped.push(d);
          continue;
        }
        // Копия, если похожесть текста >= 0.85: OCR одного PDF даёт 5–15 %
        // расхождений (опечатки распознавания), но структура и числа совпадают.
        const dup = group.find((g) => similarity(g.text, d.text) >= 0.85);
        if (dup) {
          duplicatesDropped += 1;
          // Оставляем более полный текст и больший структурный счёт.
          const dupLen = String(dup.text || '').length;
          const newLen = String(d.text || '').length;
          if (newLen > dupLen * 1.02
            || (Math.abs(newLen - dupLen) <= dupLen * 0.02
              && (Number(d.table_positions) || 0) > (Number(dup.table_positions) || 0))) {
            Object.assign(dup, d);
          }
          continue;
        }
        group.push(d);
        deduped.push(d);
      }
      documents = deduped;
      if (duplicatesDropped) {
        emit({
          step: 'docs_dedup',
          message: `Копии документов схлопнуты: убрано ${duplicatesDropped}, в разбор ${documents.length}.`,
          pct: 4,
          docs: documents.length,
          duplicates_dropped: duplicatesDropped
        });
      }

      const tzText = String(b.tz_text || session.tz_text || '').trim();

      // 1. Срок и режим работ из ТЗ и документов — ДО preflight.
      // Если срока нет, это обязательно нужно знать: без него план бригад
      // и срок работ считаются по выдумке (задача заказчика 06.11).
      const scheduleSvc = require('../services/schedule-extract');
      const allText = tzText + '\n' + documents.map((d) => d.text || '').join('\n');
      const sched = scheduleSvc.extractSchedule(allText);
      // Периоды/заезды — детерминированная подсказка модели и страховка.
      const visitHints = scheduleSvc.extractVisitPeriods(allText);
      if (process.env.DBG_SCHED) {
        request.log.info({
          docs: documents.length,
          text_len: allText.length,
          found: sched.found,
          days: sched.days,
          raw: sched.raw
        }, 'распознавание срока');
      }

      // 2. Preflight: не зовём модель, если данных заведомо нет.
      const pf = stageSvc.preflight({
        tz_text: tzText,
        documents,
        inputs: b.inputs || {},
        start_date: b.start_date,
        end_date: b.end_date,
        contact: b.contact
      });

      // Срок нашли в ТЗ, но РП его не подтвердил — тоже стоп: цифра может
      // относиться к подаче заявки, а не к работам.
      //
      // ВАЖНО (06.11): срок НЕ блокирует анализ. Требование «обязательно»
      // останавливало 10 из 15 тендеров очереди — там срок не указан в ТЗ,
      // и РП не мог получить даже разбор объёмов. Правильно: разбор идёт,
      // а срок показывается как обязательное поле перед ПРОСЧЁТОМ, потому
      // что он влияет только на число бригад, а не на объёмы работ.
      const scheduleGap = !sched.found && !(Number(b.schedule_days) > 0)
        ? [{
          id: 'schedule_days',
          kind: 'schedule',
          blocking: false,
          label: 'Срок выполнения работ',
          why: 'в ТЗ срок работ не найден — без него нельзя подобрать число бригад под график заказчика',
          hint: 'укажите срок в днях или приложите документ с графиком',
          required_before: 'calc'
        }]
        : [];
      // Останавливаемся только на НАСТОЯЩИХ пробелах (нет ТЗ, нет объёмов).
      // Срок — неблокирующий: он нужен перед просчётом, а не перед разбором.
      if (!pf.ok) {
        const gaps = (pf.gaps || []).concat(scheduleGap);
        const state = stageSvc.normalizeState({ gaps });
        const saved = await stageSvc.saveStage(db, request.params.uid, {
          stage: 'clarify', state, expectedVersion: b.expected_version
        });
        return await finishOk({
          ok: false,
          stage: 'clarify',
          gaps,
          state: saved.state,
          version: saved.version,
          schedule: sched
        });
      }

      emit({
        step: 'docs',
        message: `Документов в разбор: ${documents.length}`
          + (documents.length
            ? ` (${documents.reduce((n, d) => n + String(d.text || '').length, 0).toLocaleString('ru-RU')} симв.)`
            : ''),
        pct: 5,
        docs: documents.length
      });

      // 2. Каталог норм и ДВ через модель.
      const catalog = await workNorms.loadCatalog(db);

      // ── Склад: что реально есть, чтобы МТР не выдумывался ───────────────
      // Анализ раньше не видел остатков: МТР был пуст у всех тендеров, а
      // оборудование модель называла «по опыту». Берём реальные остатки,
      // сжимаем (дубли, служебные артикулы) и отдаём компактным блоком.
      let warehouseCtx = null;
      try {
        const { buildWarehouseContext } = require('../services/warehouse-context');
        const whRes = await db.query(
          `SELECT e.name, e.quantity, e.unit, c.name AS category_name
             FROM equipment e
             LEFT JOIN equipment_categories c ON c.id = e.category_id
            WHERE COALESCE(e.is_active, true) = true
              AND COALESCE(e.status, 'available') NOT IN ('written_off','disposed','lost')
              AND COALESCE(e.quantity, 0) > 0
            ORDER BY c.name, e.name
            LIMIT 2000`
        );
        warehouseCtx = buildWarehouseContext(whRes.rows, { text: allText });
        emit({
          step: 'warehouse',
          message: `Склад: ${warehouseCtx.total} наименований в наличии`
            + (warehouseCtx.truncated ? `, в разбор ${warehouseCtx.items.length}` : '')
            + '.',
          pct: 6,
          warehouse_total: warehouseCtx.total,
          warehouse_relevant: warehouseCtx.relevant
        });
      } catch (e) {
        request.log.warn({ err: e }, 'склад не прочитан');
      }

      // История заказчика: раньше сюда уходила пустая строка, и Мимир не видел
      // прошлых тендеров этого заказчика. Теперь строим блок по ИНН/названию.
      let historyBlock = '';
      let historyCount = 0;
      if (session.tender_id) {
        try {
          const { buildHistoryBlock } = require('../services/tender-history-brain');
          const tRow = await db.query(
            'SELECT * FROM tenders WHERE id = $1 AND deleted_at IS NULL',
            [session.tender_id]
          );
          if (tRow.rows[0]) {
            historyBlock = await buildHistoryBlock(db, tRow.rows[0]) || '';
            // Сколько прошлых тендеров попало в блок — по строкам-позициям.
            historyCount = (historyBlock.match(/^\s*\d+\.\s/gm) || []).length || 0;
          }
        } catch (e) {
          request.log.warn({ err: e }, 'история заказчика не построена');
        }
      }
      if (!historyBlock) historyBlock = '(истории по заказчику нет)';
      emit({
        step: 'history',
        message: historyCount > 0
          ? `История заказчика: ${historyCount} прошлых позиций.`
          : 'Истории по заказчику нет — разбор только по текущим документам.',
        pct: 7,
        history_count: historyCount
      });

      const gen = await stagesAi.generateDv({
        db,
        aiProvider,
        tz_text: tzText,
        documents,
        history_block: historyBlock,
        catalog,
        // Подсказка по графику: модель решает сама, но если промолчит —
        // у нас есть детерминированный разбор периодов из документов.
        visit_hints: visitHints,
        // Реальные остатки склада: МТР и техника берутся отсюда, а чего нет —
        // уходит в «купить». Выдумывать наличие запрещено промптом.
        warehouse_text: warehouseCtx ? warehouseCtx.text : null,
        onProgress: emit
      });

      if (!gen.ok) {
        return await finishErr(502, { ok: false, error: gen.error, raw: gen.raw || null });
      }

      // 3. Паспортное обогащение: если объём не задан, но марка аппарата
      // известна (РВС-5000, ПСВ-315, КВГМ-100), объём берётся по паспорту.
      // Требование РП 07.11: отсутствие ВОР не должно быть блокером —
      // бывает только ТЗ, и объёмы надо вывести из оборудования.
      // Незнакомые марки ищем веб-поиском. Всё найденное помечается
      // confidence: low и требует подтверждения РП.
      let passportEnriched = 0;
      emit({
        step: 'passport',
        message: `Проверяю паспорта оборудования по ${(gen.dv.positions || []).length} позициям…`,
        pct: 88,
        positions: (gen.dv.positions || []).length
      });
      try {
        const passport = require('../services/equipment-passport');
        const res = await passport.enrichPositions(gen.dv.positions, {
          aiProvider,
          allowWeb: true
        });
        gen.dv.positions = res.positions;
        passportEnriched = res.enriched;
      } catch (e) {
        request.log.warn({ err: e }, 'паспортное обогащение не выполнено');
      }
      if (passportEnriched) {
        emit({
          step: 'passport_done',
          message: `По паспорту добрал объём у ${passportEnriched} позиций.`,
          pct: 90,
          passport_enriched: passportEnriched
        });
      }

      // 4. Норма-превью по каждой позиции + привязка к технологии.
      // Обязательно пишем mh/days/people на позицию — иначе план и график
      // получают нули, хотя preview уже посчитал (дефект анализа 12.11).
      const positions = [];
      const dvList = Array.isArray(gen.dv.positions) ? gen.dv.positions : [];
      let normFilled = 0;
      let normNeedsInput = 0;
      for (let ni = 0; ni < dvList.length; ni += 1) {
        const pos = dvList[ni];
        const enriched = Object.assign({}, pos);
        if (pos.category_code && !pos.needs_classification) {
          try {
            const bundle = await workNorms.tryNormPreviewForEstimate(db, {
              work: { work_title: pos.name },
              norm_inputs: {
                category_code: pos.category_code,
                method_code: pos.method_code,
                inputs: inputsForPosition(pos, catalog),
                fouling: pos.fouling || 'medium'
              }
            });
            if (bundle.preview && bundle.preview.ok) {
              const pv = bundle.preview;
              const crew = pv.crew || {};
              const people = (Number(crew.master) || 0) + (Number(crew.exec) || 0);
              const wd = Number(pv.results && pv.results.work_days);
              const mhCalc = Number(pv.results && pv.results.man_hours);
              enriched.norm = {
                code: pv.rate && pv.rate.code,
                work_days: wd > 0 ? wd : null,
                crew,
                trace: pv.trace,
                fallback: !!pv.fallback,
                norm_basis: pv.basis || null
              };
              if (wd > 0) enriched.days = Math.round(wd * 100) / 100;
              if (people > 0) enriched.people = people;
              if (mhCalc > 0) enriched.mh = Math.round(mhCalc * 100) / 100;
              enriched.source = pv.fallback ? 'expert' : 'norm';
              if (pv.rate && pv.rate.code) enriched.source_ref = String(pv.rate.code);
              if (pv.fallback) {
                enriched.explain = enriched.explain
                  || 'Оценка Мимира (нормы в справочнике нет / fallback)';
              }
              if (wd > 0 || mhCalc > 0) normFilled += 1;
            } else if (bundle.preview && bundle.preview.needs_input) {
              enriched.norm = { error: bundle.preview.error, needs_input: true };
              enriched.source = enriched.source || null;
              normNeedsInput += 1;
            }
          } catch (e) {
            enriched.norm = { error: e.message };
          }
        }
        positions.push(enriched);
        if ((ni + 1) % 40 === 0 || ni + 1 === dvList.length) {
          emit({
            step: 'norm_preview',
            message: `Нормы: ${ni + 1}/${dvList.length}`
              + (normFilled ? `, заполнено ${normFilled}` : '')
              + (normNeedsInput ? `, нужно уточнить ${normNeedsInput}` : ''),
            pct: 88 + Math.min(4, Math.round(((ni + 1) / Math.max(1, dvList.length)) * 4)),
            positions: ni + 1,
            norm_filled: normFilled,
            norm_needs_input: normNeedsInput
          });
        }
      }

      // ── График заездов ──────────────────────────────────────────────────
      // Режим решает модель по документам (график в любом виде), страхует
      // детерминированный разбор, а сомнение уходит РП вопросом. Здесь же
      // считаются дни/люди/чел·ч на каждый заезд — БЕЗ денег.
      let visitPlan = null;
      try {
        const visitSvc = require('../services/visit-plan');
        visitPlan = visitSvc.buildVisitPlan({
          positions,
          text: allText,
          modelPlan: {
            schedule_mode: gen.dv.schedule_mode || null,
            visits: gen.dv.visits || [],
            trip_count: gen.dv.trip_count || null
          },
          schedule: sched
        });
        emit({
          step: 'visits',
          message: visitPlan.mode === 'visits'
            ? `График: ${visitPlan.trip_count} заезд(ов)`
              + (visitPlan.totals && visitPlan.totals.work_days
                ? `, ~${visitPlan.totals.work_days} дн. работ` : '')
              + '.'
            : visitPlan.mode === 'continuous'
              ? 'График: один непрерывный заезд.'
              : 'График работ не определён — нужен ответ РП.',
          pct: 92,
          visit_mode: visitPlan.mode,
          trip_count: visitPlan.trip_count,
          visits: visitPlan.visits.length,
          unconfirmed: visitPlan.unconfirmed
        });
      } catch (e) {
        request.log.warn({ err: e }, 'график заездов не собран');
      }

      // ── Агент МТР: чем выполнять работы ────────────────────────────────
      // В PROMPT-dv-v1 МТР описан как «химия, расходники, инструмент, СИЗ»,
      // поэтому модель отдавала ветошь и сальники, но ни одной установки.
      // Отдельный агент получает уже разобранные позиции и склад, и называет
      // технику. Отказ не ломает конвейер: ниже подстрахует mtr-pipeline.
      let mtrAgent = null;
      try {
        const mtrSvc = stagesAi;
        mtrAgent = await mtrSvc.generateMtr({
          aiProvider,
          positions,
          tz_text: allText,
          warehouse_text: warehouseCtx ? warehouseCtx.text : null,
          trips: (visitPlan && visitPlan.trip_count) || 1,
          crew: Number((positions[0] || {}).people) || 5,
          onProgress: emit
        });
        emit({
          step: 'mtr',
          message: mtrAgent.ok
            ? `МТР: техники ${mtrAgent.units.length}, расходников ${mtrAgent.consumables.length}.`
            : `МТР: агент не дал ресурсов (${mtrAgent.error || 'нет ответа'}), беру типовой перечень.`,
          pct: 95,
          mtr_units: (mtrAgent.units || []).length,
          mtr_consumables: (mtrAgent.consumables || []).length
        });
      } catch (e) {
        request.log.warn({ err: e }, 'агент МТР упал');
      }

      // Страховка и слияние: типовой перечень по методу, если агент промолчал
      // или назвал только расходники. Дедуп по имени, ответ агента первым.
      let mtrMerged = (mtrAgent && Array.isArray(mtrAgent.rows)) ? mtrAgent.rows.slice() : [];
      try {
        const mtrPipeline = require('../services/mtr-pipeline');
        const built = await mtrPipeline.buildMtr({
          db,
          positions,
          people: Number((positions[0] || {}).people) || 5,
          trips: (visitPlan && visitPlan.trip_count) || 1,
          allowWeb: false
        });
        const seen = new Set(mtrMerged.map((r) => mtrPipeline.normalizeName(r.name)));
        (built.rows || []).forEach((r) => {
          const key = mtrPipeline.normalizeName(r.name);
          if (!key || seen.has(key)) return;
          seen.add(key);
          mtrMerged.push({
            name: r.name,
            qty: r.qty,
            unit: r.unit,
            source: r.source,
            purpose: r.gap || r.note || '',
            basis: r.is_equipment ? 'method' : (r.basis || null),
            is_equipment: !!r.is_equipment
          });
        });
      } catch (e) {
        request.log.warn({ err: e }, 'МТР: типовой перечень не собран');
      }

      const state = stageSvc.normalizeState({
        gaps: pf.gaps.map((g) => ({ ...g, resolved: true })),
        positions,
        // Суть, объём, выполнимость, конкуренция и риски — это результат
        // анализа, и он должен ЖИТЬ в состоянии, а не только в ответе API.
        // Дефект 07.11: поля возвращались в response, но не сохранялись,
        // и после перезагрузки модалки оказывались пустыми. Из-за этого
        // анализ нельзя было финализировать (эндпоинт требует summary
        // и feasibility), и очередь стояла в черновиках.
        summary: gen.dv.summary || null,
        volume_summary: gen.dv.volume_summary || null,
        feasibility: gen.dv.feasibility || null,
        feasibility_note: gen.dv.feasibility_note || null,
        competition: gen.dv.competition || null,
        risks: gen.dv.risks || null,
        decision_recommend: gen.dv.decision_recommend || null,
        // ── МТР: материалы и оборудование ──────────────────────────────────
        // Источник — отдельный агент МТР (он видит ТЗ и склад) плюс типовой
        // перечень по методу из mtr-pipeline. Оба слиты в mtrMerged с дедупом.
        // Раньше здесь был только ответ модели ДВ, и он приходил пустым или
        // без техники — «ветошь и ремкомплект насоса» без единой установки.
        mtr_suggestions: mtrMerged.slice(0, 200),
        questions_for_customer: Array.isArray(gen.dv.questions_for_customer)
          ? gen.dv.questions_for_customer : [],
        // Срок и режим работ — тоже часть анализа, нужны перед просчётом.
        schedule: sched || null,
        schedule_days: (sched && sched.days) || null,
        // График заездов: режим, заезды, дни/люди/чел·ч. Без денег.
        visit_plan: visitPlan || null,
        visit_mode: visitPlan ? visitPlan.mode : null,
        trip_count: visitPlan ? visitPlan.trip_count : null,
        // ── Диагностика полноты разбора ────────────────────────────────────
        // Раньше эти поля уходили ТОЛЬКО в ответ API и не сохранялись: после
        // перезагрузки модалки невозможно было понять, 353 позиции в ведомости
        // или 673, и почему разбор «нестабилен» (тендер 2138, 10.11.2026).
        // Сохраняем, чтобы РП и ТО видели недобор сразу в карточке.
        incomplete: gen.dv.incomplete === true,
        incomplete_note: gen.dv.incomplete_note || null,
        expected_rows: gen.dv.expected_rows != null ? Number(gen.dv.expected_rows) : null,
        found_positions: gen.dv.found_positions != null ? Number(gen.dv.found_positions) : null,
        valid_positions: gen.dv.valid_positions != null ? Number(gen.dv.valid_positions) : null,
        generation_rounds: gen.dv.generation_rounds != null ? Number(gen.dv.generation_rounds) : null,
        review_hint: gen.dv.review_hint || null,
        source_positions_count: gen.dv.source_positions_count != null
          ? Number(gen.dv.source_positions_count) : null
      });
      const saved = await stageSvc.saveStage(db, request.params.uid, {
        stage: 'dv', state, expectedVersion: b.expected_version
      });

      // needs_input по нормам → явный gap (не молчаливый 0 и не тихий expert).
      if (normNeedsInput > 0) {
        try {
          const curN = await stageSvc.loadStage(db, request.params.uid);
          const hasNormGap = (curN.state.gaps || []).some((g) => g && g.id === 'norm_inputs' && !g.resolved);
          if (!hasNormGap) {
            const gap = {
              id: 'norm_inputs',
              kind: 'norm',
              blocking: false,
              label: 'Не хватает данных для норм',
              why: `У ${normNeedsInput} позиций есть категория, но для расчёта нормы не хватает `
                + 'геометрии (трубки, Ø, длина и т.п.). Без этого срок по справочнику не считается.',
              hint: 'Укажите недостающие параметры в позициях ДВ или подтвердите экспертную оценку на просчёте.',
              required_before: 'calc'
            };
            await stageSvc.saveStage(db, request.params.uid, {
              stage: 'dv',
              state: stageSvc.normalizeState(Object.assign({}, curN.state, {
                gaps: (curN.state.gaps || []).concat([gap])
              }))
            });
            emit({
              step: 'norm_gap',
              message: `Нормы: ${normNeedsInput} позиций ждут уточнения геометрии.`,
              pct: 94
            });
          }
        } catch (e) {
          request.log.warn({ err: e }, 'пробел norm_inputs не добавлен');
        }
      }

      // ── Режим заездов не подтверждён → неблокирующий вопрос РП ──────────
      // Анализ не останавливаем: объёмы уже разобраны. Но если непонятно,
      // едем один раз или 2–10 выездов, просчёт получит выдуманные дорогу и
      // проживание. Поэтому пробел уходит в карточку, а не в догадку.
      let visitGapAdded = false;
      if (visitPlan && visitPlan.unconfirmed) {
        try {
          const cur = await stageSvc.loadStage(db, request.params.uid);
          const hasGap = (cur.state.gaps || []).some((g) => g && g.id === 'schedule_mode' && !g.resolved);
          if (!hasGap) {
            const gap = {
              id: 'schedule_mode',
              kind: 'schedule',
              blocking: false,
              label: 'Режим заездов на объект',
              why: 'В документах не найден график работ: непонятно, один это непрерывный заезд '
                + 'или несколько выездов. От этого зависят дорога, проживание и мобилизация в просчёте.',
              hint: 'Назовите: один непрерывный заезд или сколько выездов планируется (2, 3, 4…).',
              required_before: 'calc',
              options: [
                { value: 'continuous', label: 'Один непрерывный заезд' },
                { value: 'visits', label: 'Несколько выездов (укажу число)' }
              ]
            };
            const nextState = stageSvc.normalizeState(Object.assign({}, cur.state, {
              gaps: (cur.state.gaps || []).concat([gap])
            }));
            await stageSvc.saveStage(db, request.params.uid, {
              stage: 'dv', state: nextState
            });
            visitGapAdded = true;
            emit({
              step: 'visit_gap',
              message: 'Режим заездов не подтверждён — добавил вопрос РП в карточку.',
              pct: 95
            });
          }
        } catch (e) {
          request.log.warn({ err: e }, 'пробел schedule_mode не добавлен');
        }
      }

      // Чек-лист анализа: заполняем то, на что Мимир может ответить по
      // документам (плановость, отклонения по объёмам, допуски, доступ).      // Дефект 07.11: у всех 14 тендеров чек-лист был пуст, а без него
      // анализ нельзя финализировать — фаза calc не наступала, и обучение
      // справочника не пополнялось. Вопросы для звонка заказчику Мимир
      // не выдумывает: пустое остаётся РП.
      let checklistFill = null;
      if (session.tender_id) {
        try {
          const { prefillChecklist } = require('../services/checklist-autofill');
          checklistFill = await prefillChecklist(db, session.tender_id, {
            dv: gen.dv,
            text: (tzText || '') + '\n' + documents.map((d) => d.text || '').join('\n'),
            schedule: sched
          });
        } catch (e) {
          request.log.warn({ err: e }, 'чек-лист не предзаполнен');
        }
      }

      // ТЗ дописываем в сессию, чтобы следующий заход не спрашивал то же самое.
      if (tzText && tzText !== session.tz_text) {
        await db.query(
          'UPDATE tkp_quick_sessions SET tz_text = $2, updated_at = NOW() WHERE session_uid = $1',
          [request.params.uid, tzText]
        );
      }

      emit({
        step: 'save',
        message: `Сохраняю разбор: ${(saved.state.positions || []).length} позиций…`,
        pct: 96,
        positions: (saved.state.positions || []).length
      });

      return await finishOk({
        ok: true,
        stage: saved.stage,
        state: saved.state,
        version: saved.version,
        decision_recommend: gen.dv.decision_recommend,
        // Готовые формулировки для карточки ТО: суть, объём, выполнимость,
        // риски. Промпт их просит у модели, а не собирает шаблоном.
        summary: gen.dv.summary,
        volume_summary: gen.dv.volume_summary,
        feasibility: gen.dv.feasibility,
        feasibility_note: gen.dv.feasibility_note,
        competition: gen.dv.competition,
        risks: gen.dv.risks,
        questions_for_customer: gen.dv.questions_for_customer,
        // Вопросы для звонка и контакт: анализ сам напоминает позвонить клиенту.
        call_questions: stageSvc.callQuestionsFromDv(gen.dv, {
          start_date: b.start_date, end_date: b.end_date,
          tz_text: tzText
        }),
        contact: stageSvc.extractContact(tzText + '\n' + documents.map((d) => d.text || '').join('\n')),
        blocked: gen.dv.blocked,
        // Сколько позиций получили объём по паспорту оборудования
        // (когда ведомости объёмов в тендере нет).
        passport_enriched: passportEnriched,
        // Сколько вопросов чек-листа заполнено по документам (остальное — РП).
        checklist_filled: checklistFill ? checklistFill.filled : 0,
        // Сколько раундов заняла генерация: на больших ведомостях модель
        // отвечает порциями, и РП должен видеть, что разбор шёл частями.
        generation_rounds: gen.rounds || 1,
        // ── Диагностика полноты разбора ──────────────────────────────────
        // Без этих полей РП не отличает полный разбор от частичного:
        // «353 позиции» выглядели одинаково, было их 353 в ведомости или 673.
        salvaged: !!gen.salvaged,
        truncated_by_length: !!gen.truncated_by_length,
        expected_min: gen.expected_min || 0,
        expected_rows: gen.expected_rows || 0,
        found_positions: gen.found_positions != null ? gen.found_positions : (gen.dv.positions || []).length,
        incomplete: !!gen.incomplete,
        incomplete_note: gen.incomplete_note || null,
        // Сводка для сверки с ведомостью. Справочная: форматы ведомостей
        // слишком разные, чтобы строить на ней автоматический порог.
        review_hint: gen.review_hint || null,
        // ── Полная диагностика разбора ──────────────────────────────────
        // Без этих полей нельзя разобраться, почему разбор вышел неполным:
        // модель ли оборвалась, сетка ли не поняла формат, или копии
        // документов съели бюджет. РП и разработчик видели только итог.
        model_said_positions: gen.model_said_positions || 0,
        expected_rows_grid: gen.expected_rows_grid || 0,
        salvaged: !!gen.salvaged,
        // Срок и режим работ: РП видит, что нашлось в ТЗ и документах.
        schedule: sched,
        // График заездов: что определили и что требует подтверждения.
        visit_plan: visitPlan || null,
        visit_mode: visitPlan ? visitPlan.mode : null,
        trip_count: visitPlan ? visitPlan.trip_count : null,
        visit_conflicts: visitPlan ? visitPlan.conflicts : [],
        visit_gap_added: visitGapAdded,
        // МТР top-level: UI раньше читал только d.mtr_suggestions, не state.
        mtr_suggestions: Array.isArray(saved.state.mtr_suggestions)
          ? saved.state.mtr_suggestions
          : (Array.isArray(gen.dv.mtr_suggestions) ? gen.dv.mtr_suggestions : []),
        // История заказчика: видно, подтянулась ли и сколько прошлых тендеров.
        history_found: historyCount > 0,
        history_count: historyCount,
        documents: documents.map((d) => ({ original_name: d.original_name, text_len: String(d.text || '').length })),
        model: gen.model
      });
    } catch (e) {
      request.log.error({ err: e }, 'stage/analyze failed');
      return await finishErr(500, { ok: false, error: e.message });
    }
  });

  // Перевод объёма ДВ в входы нормы вынесен в сервис: там источником
  // правды служит input_schema_json категории, без выдуманных значений.
  const { inputsForPosition } = require('../services/norm-inputs');

  /**
   * POST /sessions/:uid/stage/calc-plan — сгенерировать план (люди, сроки, оборудование).
   */
  fastify.post('/sessions/:uid/stage/calc-plan', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    const session = await loadSessionForStages(request.params.uid);
    if (!session) return reply.code(404).send({ error: 'Сессия не найдена' });
    if (!(await canSeeSession(db, request.user, session))) {
      return reply.code(404).send({ error: 'Сессия не найдена' });
    }

    const workNorms = require('../services/work-norms');
    const stagesAi = require('../services/mimir-tender-stages-ai');
    const aiProvider = require('../services/ai-provider');

    try {
      const cur = await stageSvc.loadStage(db, request.params.uid);
      const positions = cur.state.positions || [];
      if (!positions.length) {
        return reply.code(400).send({ ok: false, error: 'Нет позиций — сначала заполните ДВ' });
      }

      const globals = await workNorms.loadGlobals(db);
      const maxPosts = Number(globals.map.max_parallel_posts) || 2;

      // Сводка норма-превью по всем позициям — как якорь для модели.
      const normLines = [];
      for (const p of positions) {
        if (p.norm && p.norm.code) {
          normLines.push(`${p.name}: ${p.norm.code} → ${p.norm.work_days ?? '—'} сут` +
            (p.norm.crew ? `, бригада ${p.norm.crew.master || 0}м+${p.norm.crew.exec || 0}сл` : ''));
        } else if (p.norm && p.norm.needs_input) {
          normLines.push(`${p.name}: норма есть, но не хватает данных (${p.norm.error})`);
        } else {
          normLines.push(`${p.name}: нормы нет — нужна оценка с обоснованием`);
        }
      }

      // Окно дат: тело запроса → срок из ТЗ → срок подачи тендера.
      // Срок из ТЗ приоритетнее: заказчик устанавливает график РАБОТ,
      // а deadline тендера — это подача заявки, разные вещи.
      let dateWindow = request.body && request.body.date_window != null
        ? Number(request.body.date_window) : null;
      if (!(dateWindow > 0) && Number(request.body && request.body.schedule_days) > 0) {
        dateWindow = Number(request.body.schedule_days);
      }
      if (!(dateWindow > 0)) {
        try {
          const cur2 = await stageSvc.loadStage(db, request.params.uid);
          const st = (cur2 && cur2.state) || {};
          const fromState = Number(st.schedule_days) || Number(st.schedule && st.schedule.days);
          if (fromState > 0) dateWindow = fromState;
        } catch (_) { /* нет состояния — не страшно */ }
      }
      if (!(dateWindow > 0) && session.tender_id) {
        const t = await db.query(
          'SELECT deadline FROM tenders WHERE id = $1 AND deleted_at IS NULL',
          [session.tender_id]
        ).catch(() => ({ rows: [] }));
        const dl = t.rows[0] && t.rows[0].deadline;
        if (dl) {
          const days = Math.ceil((new Date(dl).getTime() - Date.now()) / 86400000);
          if (days > 0) dateWindow = days;
        }
      }

      const gen = await stagesAi.generateCalcPlan({
        aiProvider,
        positions,
        normPreviewMd: normLines.join('\n') || '(нормативов нет)',
        workersMd: request.body && request.body.workers_md ? String(request.body.workers_md) : '',
        dateWindow,
        maxParallelPosts: maxPosts,
        // Режим заездов из анализа: при нескольких выездах бригада едет
        // последовательно, и срок нельзя делить на «виртуальные» бригады.
        visitMode: cur.state.visit_mode || (cur.state.visit_plan && cur.state.visit_plan.mode) || null,
        tripCount: cur.state.trip_count || (cur.state.visit_plan && cur.state.visit_plan.trip_count) || null
      });

      if (!gen.ok) return reply.code(502).send({ ok: false, error: gen.error, raw: gen.raw || null });

      const windowCheck = stageSvc.checkDateWindow(
        gen.plan,
        request.body && request.body.date_window != null ? Number(request.body.date_window) : null
      );
      const calibration = stagesAi.buildCalibrationPreview(positions, gen.plan)
        .map((c) => Object.assign({}, c, {
          delta_pct: 0 // предпросмотр без записи: дельту даст сервер при сохранении
        }));

      // План кладём в calc, СОХРАНЯЯ поля плана. normalizeState приводит
      // calc к схеме { positions: [] }, и если передать только этот объект,
      // work_days/crews/people_total выживают, но positions из плана
      // затираются пустым массивом.
      const planForSave = Object.assign({}, gen.plan || {}, {
        positions: Array.isArray(gen.plan && gen.plan.positions) ? gen.plan.positions : []
      });
      const mergedState = stageSvc.normalizeState(
        Object.assign({}, cur.state, { calc: planForSave }));

      // Заезды: план обязан их унаследовать, иначе просчёт потеряет число
      // выездов и посчитает дорогу/проживание как за один приезд. План
      // (generateCalcPlan) уже возвращает trip_count/visits — приоритет за
      // ним, иначе берём график из анализа.
      if (!mergedState.visit_plan && cur.state.visit_plan) {
        mergedState.visit_plan = cur.state.visit_plan;
      }
      if (planForSave.trip_count || planForSave.visits) {
        // График и число выездов обязаны описывать ОДНО И ТО ЖЕ: раньше mode
        // ставился 'visits' от одного только trip_count > 1, а заездов
        // оставалось 1 («один непрерывный заезд») — смета считала дорогу за
        // несколько приездов при графике из одного (дефект 12.11.2026, #2138).
        const vp = Object.assign({}, mergedState.visit_plan || {},
          require('../services/visit-plan-reconcile').reconcileVisitPlan({
            planVisits: Array.isArray(planForSave.visits) ? planForSave.visits : [],
            prevPlan: mergedState.visit_plan || {}
          }));
        mergedState.visit_plan = vp;
        mergedState.trip_count = vp.trip_count;
        mergedState.visit_mode = vp.mode;
      }

      // ── Обучение справочника ────────────────────────────────────────────
      // Просчёт — это и есть факт: посчитали по норме X, получили Y суток.
      // Каждый такой расчёт уточняет норму. Раньше это происходило только
      // вручную через mimir-apply, и журнал норм не пополнялся с июля.
      //
      // Правила те же, что в createRateFromEstimate: только при work_days>0,
      // только по позициям, где норма была (иначе нечего калибровать),
      // с комментарием и записью в work_norm_change_log.
      let normLearned = { updated: 0, created: 0, skipped: 0 };
      try {
        const { calibrateNormsFromCalc } = require('../services/norm-calibrate');
        normLearned = await calibrateNormsFromCalc(db, {
          positions: mergedState.positions,
          calcPositions: planForSave.positions,
          tenderId: session.tender_id,
          user: request.user
        });
      } catch (e) {
        request.log.warn({ err: e.message }, 'калибровка норм по просчёту не выполнена');
      }
      mergedState.norm_learned = normLearned;

      // Сохраняем напрямую в БД, минуя проверку переходов этапа.
      // Дефект 07.11: saveStage отказывал в переходе dv → calc_plan, план
      // терялся, и РП не видел ни сроков, ни суток по позициям. План — это
      // данные, а не этап: его надо записать независимо от порядка этапов.
      let saved = { stage: cur.stage, version: cur.version };
      let stageAdvanced = false;
      try {
        const direct = await db.query(
          `UPDATE tkp_quick_sessions
              SET stage_state = $2::jsonb,
                  stage = CASE WHEN $3::text IS NULL THEN stage ELSE $3::text END,
                  stage_version = COALESCE(stage_version, 0) + 1,
                  updated_at = NOW()
            WHERE session_uid = $1
            RETURNING stage, stage_version`,
          [request.params.uid, JSON.stringify(mergedState),
            stageSvc.canTransition(cur.stage, 'calc_plan') ? 'calc_plan' : null]);
        saved = { stage: direct.rows[0].stage, version: direct.rows[0].stage_version };
        stageAdvanced = saved.stage === 'calc_plan';
      } catch (e) {
        request.log.error({ err: e.message }, 'план не сохранён');
      }

      return {
        ok: true,
        stage: saved.stage,
        stage_advanced: stageAdvanced,
        plan: gen.plan,
        // Заезды: план вернул trip_count/visits, просчёт возьмёт их.
        visit_plan: mergedState.visit_plan || null,
        trip_count: mergedState.trip_count || null,
        date_window: windowCheck,
        calibration,
        // Сколько норм уточнено по этому просчёту — РП видит, что справочник
        // учится, а не стоит на месте.
        norm_learned: normLearned,
        model: gen.model,
        version: saved.version
      };
    } catch (e) {
      request.log.error({ err: e }, 'stage/calc-plan failed');
      return reply.code(500).send({ ok: false, error: e.message });
    }
  });

  /**
   * POST /sessions/:uid/stage/finalize — закрыть анализ, перенести в отчёт и обучить нормы.
   * Тело: { go: true|false, reason?, answers?, expected_version? }
   */
  fastify.post('/sessions/:uid/stage/finalize', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    const session = await loadSessionForStages(request.params.uid);
    if (!session) return reply.code(404).send({ error: 'Сессия не найдена' });
    if (!(await canSeeSession(db, request.user, session))) {
      return reply.code(404).send({ error: 'Сессия не найдена' });
    }

    const b = request.body || {};
    const cur = await stageSvc.loadStage(db, request.params.uid);
    const go = b.go === true;

    try {
      if (!go) {
        const reason = String(b.reason || '').trim();
        if (reason.length < 5) return reply.code(400).send({ ok: false, error: 'Укажите причину отказа' });
        const state = stageSvc.normalizeState(Object.assign({}, cur.state, {
          decision: { go: false, reason }
        }));
        const saved = await stageSvc.saveStage(db, request.params.uid, {
          stage: 'nogo', state, expectedVersion: b.expected_version
        });
        return { ok: true, stage: saved.stage, decision: 'reject', reason };
      }

      // «Подаём»: переносим ДВ и технологию в отчёт тендера.
      let reportPatch = null;
      if (session.tender_id) {
        const rpDrafts = require('../services/rp-review-drafts');
        const positions = cur.state.positions || [];
        const plan = (cur.state.calc && cur.state.calc.positions) || [];
        const scope = positions.map((p) => `${p.name} — ${p.volume} ${p.unit}`).join('; ');
        const resources = positions.map((p) => p.tech_equip).filter(Boolean).join('; ');

        const { rows: [review] } = await db.query(
          'SELECT * FROM tender_rp_reviews WHERE tender_id = $1', [session.tender_id]
        );
        if (review) {
          const rj = rpDrafts.parseJson(review.report_json);
          // МТР из stage_state: раньше finalize тащил только ДВ/план, и вкладка
          // «Бригада и МТР» оставалась пустой после API-прогона без UI.
          const mtrSuggest = Array.isArray(cur.state.mtr_suggestions) ? cur.state.mtr_suggestions : [];
          const mtrFromState = Array.isArray(cur.state.mtr) ? cur.state.mtr : [];
          const mtrList = (mtrFromState.length ? mtrFromState : mtrSuggest)
            .filter((x) => x && x.name)
            .map((x) => {
              const src = String(x.source || '').toLowerCase();
              return {
                name: String(x.name).trim().slice(0, 200),
                qty: Number(x.qty) > 0 ? Number(x.qty) : null,
                unit: String(x.unit || '').trim().slice(0, 20),
                note: String(x.purpose || x.note || '').trim().slice(0, 200),
                purpose: String(x.purpose || '').trim().slice(0, 200),
                // warehouse/purchase важны смете: склад не закупаем,
                // покупку считаем отдельной строкой затрат.
                source: src === 'warehouse' ? 'warehouse'
                  : src === 'purchase' ? 'purchase'
                    : src === 'typical' ? 'typical' : 'doc'
              };
            });
          const next = Object.assign({}, rj, {
            scope: rj.scope || scope,
            volume_summary: rj.volume_summary || scope,
            resources: rj.resources || resources,
            dv_positions: positions,
            calc_plan: plan,
            stage_version: cur.version,
            decision: 'submit'
          });
          // График заездов: едет из анализа, чтобы просчёт взял trip_count.
          const vp = cur.state.visit_plan
            || (cur.state.calc && cur.state.calc.visits ? {
              mode: 'visits',
              trip_count: cur.state.calc.trip_count || (cur.state.calc.visits || []).length,
              visits: cur.state.calc.visits
            } : null);
          if (vp) {
            next.visit_plan = vp;
            next.visit_mode = vp.mode || null;
            next.trip_count = vp.trip_count || 1;
          }
          if (mtrList.length) {
            next.mtr_suggestions = mtrList;
            if (!Array.isArray(next.mtr) || !next.mtr.length) next.mtr = mtrList;
          }
          await db.query(
            `UPDATE tender_rp_reviews SET report_json = $1::jsonb, updated_at = NOW() WHERE id = $2`,
            [JSON.stringify(next), review.id]
          );
          reportPatch = {
            scope: next.scope,
            positions: positions.length,
            plan_rows: plan.length,
            mtr: mtrList.length
          };
        }
      }

      const state = stageSvc.normalizeState(Object.assign({}, cur.state, { decision: { go: true } }));
      const saved = await stageSvc.saveStage(db, request.params.uid, {
        stage: 'done', state, expectedVersion: b.expected_version
      });

      return { ok: true, stage: saved.stage, decision: 'submit', report_patch: reportPatch };
    } catch (e) {
      request.log.error({ err: e }, 'stage/finalize failed');
      return reply.code(e.statusCode || 500).send({ ok: false, error: e.message });
    }
  });

  /**
   * POST /sessions/:uid/stage/reset — вернуть сессию в указанный этап.
   *
   * Нужен для демо и тестов: прогон должен быть воспроизводимым, а не зависеть
   * от того, чем закончился предыдущий. В проде обычный путь — переходы /stage.
   */
  fastify.post('/sessions/:uid/stage/reset', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    const session = await loadSessionForStages(request.params.uid);
    if (!session) return reply.code(404).send({ error: 'Сессия не найдена' });
    if (!(await canSeeSession(db, request.user, session))) {
      return reply.code(404).send({ error: 'Сессия не найдена' });
    }
    const to = String((request.body && request.body.to) || 'intake');
    if (!stageSvc.isStage(to)) return reply.code(400).send({ error: 'Неизвестный этап: ' + to });
    const { rows } = await db.query(
      `UPDATE tkp_quick_sessions
          SET stage = $2, stage_state = '{"v":1}'::jsonb,
              stage_version = stage_version + 1, stage_updated_at = NOW(), updated_at = NOW()
        WHERE session_uid = $1
        RETURNING stage, stage_version`,
      [request.params.uid, to]
    );
    return { ok: true, stage: rows[0].stage, version: Number(rows[0].stage_version) };
  });

  /**
   * POST /sessions/:uid/stage/patch — правка позиции ДВ / технологии / плана.
   * Тело: { position_id, patch, expected_version } или { state, expected_version }
   */
  fastify.post('/sessions/:uid/stage/patch', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    const session = await loadSessionForStages(request.params.uid);
    if (!session) return reply.code(404).send({ error: 'Сессия не найдена' });
    if (!(await canSeeSession(db, request.user, session))) {
      return reply.code(404).send({ error: 'Сессия не найдена' });
    }
    const b = request.body || {};
    const cur = await stageSvc.loadStage(db, request.params.uid);
    let state = cur.state;
    try {
      if (b.position_id) {
        state = stageSvc.applyPositionPatch(state, b.position_id, b.patch || {});
      } else if (b.state && typeof b.state === 'object') {
        state = stageSvc.normalizeState(b.state);
      } else {
        return reply.code(400).send({ error: 'Нужен position_id+patch или state' });
      }
      const out = await stageSvc.saveStage(db, request.params.uid, {
        stage: b.stage || cur.stage,
        state,
        expectedVersion: b.expected_version
      });
      return { ...out, can_finish_tech: stageSvc.canFinishTech(out.state) };
    } catch (e) {
      return reply.code(e.statusCode || 500).send({ error: e.message });
    }
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
  // POST /sessions/:uid/upload — загрузить файлы ТЗ / архивы → OCR в tz_attachments
  // ─────────────────────────────────────────────────────────────────────────
  fastify.post('/sessions/:uid/upload', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    const { rows: [session] } = await db.query(
      "SELECT * FROM tkp_quick_sessions WHERE session_uid = $1 AND author_id = $2 AND status IN ('draft','error')",
      [request.params.uid, request.user.id]
    );
    if (!session) return reply.code(404).send({ error: 'Сессия не найдена или нельзя изменить' });

    const tkpParser = require('../services/tkp-parser');
    const archiveExtractor = require('../services/archiveExtractor');
    const fs = require('fs');
    const os = require('os');
    const path = require('path');

    const data = await request.file();
    if (!data) return reply.code(400).send({ error: 'Файл не передан' });

    const buf = await data.toBuffer();
    if (data.file.truncated) return reply.code(413).send({ error: 'Файл превышает лимит' });

    const filename = data.filename || 'file';
    const mime = data.mimetype || '';

    // D-393: ПРОВЕРКА СИГНАТУРЫ. 28.10.2026 в uploads лежали «архивы» по
    // 302 байта, внутри — HTML-заглушка прокси Газпром-Нефти (скачивание
    // оборвалось, сервер вернул страницу ошибки). Система трижды пыталась
    // распаковать этот HTML и сдавалась с невнятным «Ни один файл не
    // распознан». Теперь говорим прямо: файл повреждён, скачайте заново —
    // и не тратим OCR-попытки впустую.
    {
      const { checkFileSignature, explainSignatureFailure } = require('../lib/file-signature');
      const ext = require('path').extname(filename).toLowerCase();
      const sig = checkFileSignature(buf, ext);
      if (!sig.ok) {
        request.log.warn(`[tkp_quick upload] файл «${filename}» не прошёл проверку: ${sig.reason}`);
        return reply.code(422).send({
          error: 'file_corrupted',
          message: explainSignatureFailure(sig, filename),
          detail: sig.detail,
          hint: 'Скачайте файл заново и загрузите снова. Если он открывается у вас — '
            + 'возможно, его подменяет корпоративный прокси при скачивании.',
          file: filename,
        });
      }
    }

    const warnings = [];
    const chunks = []; // { prio, name, text, usedOcr } — без гонки при параллели
    let usedOcr = false;

    const TEXT_EXTS = new Set(['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.txt', '.csv', '.rtf']);
    const MAX_INNER_FILES = 80;
    const MAX_TOTAL_CHARS = 280000;
    // Пул файлов; глобальный OCR_CONCURRENCY режет vision rate-limit
    const FILE_CONCURRENCY = Math.max(1, parseInt(process.env.TKP_QUICK_FILE_CONCURRENCY || '10', 10));

    function filePriority(name) {
      const n = String(name || '').toLowerCase();
      if (/техническ|тех\.?\s*зада|тз\b|задан/.test(n)) return 0;
      if (/объем|объём|ам-\d|трубк/.test(n)) return 1;
      if (/\.docx?$/.test(n)) return 2;
      if (/\.pdf$/.test(n)) return 3;
      return 5;
    }

    /** .doc → .docx через libreoffice (на проде есть), затем mammoth */
    async function docToText(innerBuf, innerName) {
      const { spawnSync } = require('child_process');
      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const tmpDir = path.join(os.tmpdir(), `tkpq-doc-${stamp}`);
      fs.mkdirSync(tmpDir, { recursive: true });
      const srcPath = path.join(tmpDir, 'src.doc');
      try {
        fs.writeFileSync(srcPath, innerBuf);
        const bin = ['libreoffice', 'soffice', '/usr/bin/libreoffice', '/usr/bin/soffice']
          .find((b) => {
            try {
              const r = spawnSync(b, ['--version'], { timeout: 5000, encoding: 'utf8' });
              return r.status === 0;
            } catch (_) { return false; }
          });
        if (!bin) return { text: '', error: 'libreoffice не найден' };
        const r = spawnSync(bin, ['--headless', '--convert-to', 'docx', '--outdir', tmpDir, srcPath], {
          timeout: 90000,
          encoding: 'utf8'
        });
        if (r.status !== 0) {
          return { text: '', error: `libreoffice: ${(r.stderr || r.stdout || '').slice(0, 120)}` };
        }
        const docx = fs.readdirSync(tmpDir).find((f) => f.toLowerCase().endsWith('.docx'));
        if (!docx) return { text: '', error: 'libreoffice не создал docx' };
        const mammoth = require('mammoth');
        const m = await mammoth.extractRawText({ buffer: fs.readFileSync(path.join(tmpDir, docx)) });
        return { text: String(m.value || '').trim() };
      } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
      }
    }

    async function extractOne(innerBuf, innerName, { allowOcr = true } = {}) {
      const ext = path.extname(innerName || '').toLowerCase();
      if (!TEXT_EXTS.has(ext)) {
        if (ext === '.zip' || ext === '.rar' || ext === '.7z') {
          warnings.push(`${innerName}: вложенный архив не распакован`);
        }
        return null;
      }
      try {
        if (ext === '.doc') {
          const d = await docToText(innerBuf, innerName);
          if (d.error) { warnings.push(`${innerName}: ${d.error}`); return null; }
          const tRaw = String(d.text || '').trim();
          if (tRaw.length < 30) {
            warnings.push(`${innerName}: мало текста (${tRaw.length} симв.)`);
            return null;
          }
          const prio = filePriority(innerName);
          const perCap = prio <= 1 ? 40000 : 15000;
          return { prio, name: innerName, text: tRaw.slice(0, perCap), usedOcr: false };
        }
        const r = await tkpParser.extractTextOnly({
          buf: innerBuf,
          originalName: innerName,
          allowOcr
        });
        if (r.unsupported) return null;
        if (r.error) { warnings.push(`${innerName}: ${r.error}`); return null; }
        const tRaw = String(r.text || '').trim();
        const prio = filePriority(innerName);
        const perCap = prio <= 1 ? 40000 : (prio === 2 ? 15000 : 10000);
        if (tRaw.length < 30) {
          warnings.push(`${innerName}: мало текста (${tRaw.length} симв.)`);
          return null;
        }
        return {
          prio,
          name: innerName,
          text: tRaw.slice(0, perCap),
          usedOcr: !!r.usedOcr,
          // Структурный счёт позиций: он посчитан по сетке ячеек в парсере.
          // Без проброса сюда прямая загрузка (без кэша тендера) теряла счёт
          // и откатывалась на текстовые эвристики — те самые, что 13 раз
          // ошибались. Проводка обязательна на обоих путях.
          table_positions: Number(r.table_positions) || 0,
          table_per_sheet: r.table_per_sheet || null,
          table_source: r.table_source || null
        };
      } catch (e) {
        warnings.push(`${innerName}: ${e.message}`);
        return null;
      }
    }

    async function mapPool(items, concurrency, fn) {
      const out = new Array(items.length);
      let ix = 0;
      async function worker() {
        while (true) {
          const i = ix++;
          if (i >= items.length) return;
          out[i] = await fn(items[i], i);
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
      return out;
    }

    function joinChunks(list) {
      list.sort((a, b) => a.prio - b.prio || String(a.name).localeCompare(String(b.name), 'ru'));
      let ocrText = '';
      let filesParsed = 0;
      for (const c of list) {
        if (!c) continue;
        if (c.usedOcr) usedOcr = true;
        filesParsed += 1;
        const room = MAX_TOTAL_CHARS - ocrText.length;
        if (room <= 0) {
          warnings.push(`Лимит ${MAX_TOTAL_CHARS} симв. — обрезано после ${filesParsed - 1} файлов`);
          break;
        }
        ocrText += (ocrText ? '\n\n---\n\n' : '') + `[${c.name}]\n` + c.text.slice(0, room);
      }
      return { ocrText, filesParsed };
    }

    let ocrText = '';
    let filesParsed = 0;
    let fromTenderCache = false;

    try {
      // Архив + готовый OCR-кэш тендера → не гоняем vision повторно
      if (archiveExtractor.isArchive(filename, mime) && session.tender_id) {
        try {
          const cache = await loadTenderOcrCache(session.tender_id, ATTACH_CHARS_CAP);
          if (cache.chars >= TENDER_CACHE_MIN_CHARS || cache.count >= TENDER_CACHE_MIN_DOCS) {
            ocrText = cache.text;
            filesParsed = cache.count;
            fromTenderCache = true;
            warnings.push(
              `Готовый OCR-кэш тендера #${session.tender_id}: ${cache.count} док., ` +
              `${cache.chars} симв. — повторный OCR архива пропущен`
            );
            request.log.info(
              `[tkp_quick upload] skip OCR — tender #${session.tender_id} cache ` +
              `${cache.count} docs / ${cache.chars} chars`
            );
          }
        } catch (e) {
          request.log.warn({ err: e }, '[tkp_quick upload] tender cache read failed');
        }
      }

      if (!fromTenderCache && archiveExtractor.isArchive(filename, mime)) {
        const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const tmpArch = path.join(os.tmpdir(), `tkpq-arch-${stamp}${path.extname(filename) || '.rar'}`);
        const tmpDir = path.join(os.tmpdir(), `tkpq-ex-${stamp}`);
        const t0 = Date.now();
        try {
          fs.writeFileSync(tmpArch, buf);
          const extracted = await archiveExtractor.extractArchive(tmpArch, filename, tmpDir, { recursive: true });
          if (!extracted.ok) {
            warnings.push(extracted.error?.message || 'Не удалось распаковать архив');
            if (extracted.error?.hint) warnings.push(extracted.error.hint);
          } else {
            let files = (extracted.files || []).filter((f) => !f.isJunk);
            files.sort((a, b) => filePriority(a.relPath) - filePriority(b.relPath));
            if (files.length > MAX_INNER_FILES) {
              warnings.push(`В архиве ${files.length} файлов — беру первые ${MAX_INNER_FILES} по приоритету (ТЗ/объёмы)`);
              files = files.slice(0, MAX_INNER_FILES);
            }
            request.log.info(`[tkp_quick upload] archive ${filename}: ${files.length} files, parallel=${FILE_CONCURRENCY}`);

            // 1) Не-PDF (docx/xlsx/doc/txt) — быстро, пулом
            const nonPdf = files.filter((f) => path.extname(f.relPath || '').toLowerCase() !== '.pdf');
            const pdfFiles = files.filter((f) => path.extname(f.relPath || '').toLowerCase() === '.pdf');

            const nonPdfResults = await mapPool(nonPdf, FILE_CONCURRENCY, async (f) => {
              try {
                const innerBuf = fs.readFileSync(f.absPath);
                const name = f.relPath || path.basename(f.absPath);
                return await extractOne(innerBuf, name, { allowOcr: false });
              } catch (e) {
                warnings.push(`${f.relPath || f.absPath}: ${e.message}`);
                return null;
              }
            });
            for (const r of nonPdfResults) if (r) chunks.push(r);

            // 2) PDF: сначала текстовый слой (мгновенно), скан → общий кросс-файловый OCR
            const needOcr = [];
            const pdfLayerResults = await mapPool(pdfFiles, FILE_CONCURRENCY, async (f) => {
              const name = f.relPath || path.basename(f.absPath);
              try {
                const innerBuf = fs.readFileSync(f.absPath);
                try {
                  const pdfParse = require('pdf-parse');
                  const data = await pdfParse(innerBuf);
                  const text = String(data.text || '').trim();
                  if (text.length >= 200) {
                    const prio = filePriority(name);
                    const perCap = prio <= 1 ? 40000 : 10000;
                    return { chunk: { prio, name, text: text.slice(0, perCap), usedOcr: false }, ocr: null };
                  }
                } catch (_) { /* OCR */ }
                return {
                  chunk: null,
                  ocr: { path: f.absPath, originalName: name, key: name }
                };
              } catch (e) {
                warnings.push(`${name}: ${e.message}`);
                return { chunk: null, ocr: null };
              }
            });
            for (const r of pdfLayerResults) {
              if (r?.chunk) chunks.push(r.chunk);
              if (r?.ocr) needOcr.push(r.ocr);
            }

            if (needOcr.length) {
              const pdfOcr = require('../services/pdf-ocr');
              request.log.info(`[tkp_quick upload] cross-file OCR: ${needOcr.length} scan PDFs`);
              const ocrRes = await pdfOcr.ocrManyPdfPaths(needOcr, {
                dpi: 90,
                batchSize: 8,
                concurrency: Math.max(8, parseInt(process.env.OCR_CONCURRENCY || '16', 10)),
                maxPages: 40
              });
              usedOcr = true;
              for (const item of needOcr) {
                const tRaw = String(ocrRes.byKey[item.key] || '').trim();
                if (tRaw.length < 30) {
                  warnings.push(`${item.originalName}: мало текста после OCR (${tRaw.length} симв.)`);
                  continue;
                }
                const prio = filePriority(item.originalName);
                const perCap = prio <= 1 ? 40000 : 10000;
                chunks.push({
                  prio,
                  name: item.originalName,
                  text: tRaw.slice(0, perCap),
                  usedOcr: true
                });
              }
              if (ocrRes.diagnostics?.ms) {
                warnings.push(
                  `OCR сканов: ${Math.round(ocrRes.diagnostics.ms / 1000)}с, ` +
                  `${ocrRes.diagnostics.pages} стр / ${ocrRes.diagnostics.batches} батчей`
                );
              }
            }

            ({ ocrText, filesParsed } = joinChunks(chunks));
            const sec = Math.round((Date.now() - t0) / 1000);
            warnings.push(`Архив OCR: ${sec} сек, файлов с текстом: ${filesParsed}, символов: ${ocrText.length}`);
            if (filesParsed === 0) {
              warnings.push('В архиве не извлечён текст — проверь формат файлов');
            }
            // Параллельно дожимаем фон-кэш тендера
            if (session.tender_id && fastify.tenderOcr) {
              try { await fastify.tenderOcr.enqueue(session.tender_id, 'quick-upload'); } catch (_) {}
            }
          }
        } finally {
          try { fs.unlinkSync(tmpArch); } catch (_) {}
          try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
        }
      } else if (!fromTenderCache) {
        const one = await extractOne(buf, filename, { allowOcr: true });
        if (one) chunks.push(one);
        ({ ocrText, filesParsed } = joinChunks(chunks));
        if (!ocrText) warnings.push('Текст не извлечён');
      }
    } catch (e) {
      request.log.warn({ err: e }, '[tkp_quick upload] extract failed');
      warnings.push(e.message || 'ошибка извлечения текста');
    }

    const existing = Array.isArray(session.tz_attachments) ? session.tz_attachments : [];
    // Структурный счёт позиций по файлу (по сетке ячеек, из парсера).
    // Складываем по всем извлечённым фрагментам: архив может содержать
    // несколько ведомостей, каждая даёт своё число.
    const tablePositions = Array.isArray(chunks)
      ? chunks.reduce((sum, c) => sum + (Number(c && c.table_positions) || 0), 0)
      : 0;
    const tablePerSheet = Array.isArray(chunks)
      ? chunks.flatMap((c) => (Array.isArray(c && c.table_per_sheet) ? c.table_per_sheet : []))
      : [];

    const newEntry = {
      filename,
      mime,
      size: buf.length,
      ocr_text: ocrText,
      files_parsed: filesParsed,
      used_ocr: usedOcr,
      from_tender_cache: fromTenderCache,
      // Файл добавлен РП вручную через /upload (а не подтянут из письма).
      // Нужен, чтобы его текст ВСЕГДА шёл в промпт с приоритетом: при большом
      // кэше тендера вложения сессии раньше заменялись на «имя + ссылка на кэш»,
      // и содержимое файла РП терялось.
      source: 'manual',
      added_by_rp: true,
      table_positions: tablePositions,
      table_per_sheet: tablePerSheet,
      warnings,
      added_at: new Date().toISOString()
    };
    existing.push(newEntry);

    await db.query(
      'UPDATE tkp_quick_sessions SET tz_attachments = $1, updated_at = NOW() WHERE session_uid = $2',
      [JSON.stringify(existing), request.params.uid]
    );

    return {
      ok: true,
      filename,
      ocr_chars: ocrText.length,
      files_parsed: filesParsed,
      used_ocr: usedOcr,
      warnings,
      warning: ocrText.length < 50
        ? ('Текст из файла почти пустой. ' + (warnings[0] || 'Распакуй архив и приложи PDF/DOCX напрямую.'))
        : null
    };
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
    await reclaimStaleCalculating(request.params.uid, request.user.id);

    // D-389: запустить расчёт может и коллега, если просчёт по объекту ему
    // доступен. Фильтр по author_id оставлял его с 404 «сессия не найдена».
    const { rows: [session] } = await db.query(
      "SELECT * FROM tkp_quick_sessions WHERE session_uid = $1 AND status IN ('draft','error')",
      [request.params.uid]
    );
    if (!session) return reply.code(404).send({
      error: 'Сессия не найдена или уже рассчитана',
      hint: 'Обновите страницу: возможно, расчёт уже идёт или готов',
    });
    if (!(await canSeeSession(db, request.user, session))) {
      return reply.code(404).send({ error: 'Сессия не найдена или уже рассчитана' });
    }
    if (!session.tz_text?.trim()) return reply.code(400).send({ error: 'Добавьте техническое задание перед расчётом' });

    const reqBody = request.body || {};
    const sessionPurpose = session.purpose || 'kanban';
    if (sessionPurpose === 'rp_review_analysis' && reqBody.purpose === 'rp_review_calc') {
      return reply.code(400).send({
        error: 'Сессия в фазе анализа — просчётная смета здесь недоступна. Используйте phase=calc / новую сессию просчёта.'
      });
    }

    // Пометить как calculating. D-389: calc_owner_pid — признак живого
    // владельца. Без него после рестарта нельзя отличить «расчёт идёт»
    // от «расчёт умер вместе с процессом».
    await db.query(
      "UPDATE tkp_quick_sessions SET status='calculating', error_text=NULL, calc_owner_pid=$2, updated_at=NOW() WHERE session_uid=$1",
      [request.params.uid, process.pid]
    );

    // SSE headers
    reply.hijack(); // ERR_HTTP_HEADERS_SENT: ответом управляем сами
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    const sendEvent = (data) => {
      try { reply.raw.write(`data: ${JSON.stringify(data)}\n\n`); } catch (_) {}
    };
    // Heartbeat updated_at — чтобы stale-reclaim не сбросил живой длинный расчёт
    let lastTouch = Date.now();
    const touchCalculating = async () => {
      if (Date.now() - lastTouch < 25000) return;
      lastTouch = Date.now();
      try {
        await db.query(
          "UPDATE tkp_quick_sessions SET updated_at=NOW() WHERE session_uid=$1 AND status='calculating'",
          [request.params.uid]
        );
      } catch (_) {}
    };
    // SSE comment ping — nginx/прокси не рвут idle-соединение на 2–5 мин AI
    const sseKeepalive = setInterval(() => {
      try { reply.raw.write(`: ping ${Date.now()}\n\n`); } catch (_) {}
      touchCalculating();
    }, 12000);

    try {
      sendEvent({ type: 'start', message: 'Мимир приступает к составлению ТКП…' });

      // Сбираем текст из вложений сессии + кэш OCR документов тендера
      const attachments = Array.isArray(session.tz_attachments) ? session.tz_attachments : [];
      const withText = attachments.filter(a => a.ocr_text?.length > 20);
      const emptyAtt = attachments.filter(a => !(a.ocr_text?.length > 20));

      let tenderDocsText = '';
      let tenderDocsCount = 0;
      if (session.tender_id) {
        try {
          const cache = await loadTenderOcrCache(session.tender_id, ATTACH_CHARS_CAP);
          tenderDocsCount = cache.count;
          tenderDocsText = cache.text;
          if (tenderDocsCount) {
            sendEvent({
              type: 'progress',
              message: `📚 Из кэша тендера #${session.tender_id}: ${tenderDocsCount} док., ${tenderDocsText.length} симв.`
            });
          } else {
            const { rows: [st] } = await db.query(
              `SELECT status, attempts, max_attempts, last_error FROM tender_ocr_jobs WHERE tender_id = $1`,
              [session.tender_id]
            );
            if (st) {
              sendEvent({
                type: 'progress',
                message: `⏳ OCR тендера: ${st.status} (попытка ${st.attempts}/${st.max_attempts})` +
                  (st.last_error ? ` — ${String(st.last_error).slice(0, 120)}` : '')
              });
            }
            try {
              if (fastify.tenderOcr) await fastify.tenderOcr.enqueue(session.tender_id, 'quick-calculate');
            } catch (_) {}
          }
        } catch (e) {
          request.log.warn({ err: e }, '[tkp_quick] tender ocr cache read failed');
        }
      }

      if (attachments.length && !withText.length && !tenderDocsText) {
        sendEvent({
          type: 'progress',
          message: '⚠ Вложения есть, но текст не извлечён (архив/скан). Считаю только по краткому описанию — уточни ТЗ или приложи PDF/DOCX.'
        });
      } else if (emptyAtt.length) {
        sendEvent({
          type: 'progress',
          message: `⚠ ${emptyAtt.length} файл(ов) без текста: ${emptyAtt.map(a => a.filename).slice(0, 3).join(', ')}`
        });
      }

      // Если кэш тендера достаточный — не дублируем OCR вложения (экономия токенов).
      //
      // ВАЖНО: это касается только файлов ИЗ ПИСЬМА/ТЕНДЕРА. Файлы, которые РП
      // добавил руками в мастере Quick, обязаны попасть в промпт ВСЕГДА: их нет
      // в кэше тендера, и раньше при большом кэше в промпт уходило лишь имя
      // файла («текст взят из кэша тендера»), то есть его содержимое терялось
      // полностью (найдено 10.11.2026).
      const isManualFile = (a) => String(a && a.source || '') === 'manual'
        || String(a && a.added_by_rp || '') === 'true';
      const manualWithText = withText.filter(isManualFile);
      const tenderAttWithText = withText.filter((a) => !isManualFile(a));

      let attachmentsText = '';
      let docsInPrompt = 0;
      const manualText = manualWithText
        .map((a) => `[${a.filename}]\n${a.ocr_text}`)
        .join('\n\n---\n\n');

      if (tenderDocsText.length >= TENDER_CACHE_MIN_CHARS) {
        const names = tenderAttWithText.map((a) => a.filename).filter(Boolean).slice(0, 5).join(', ');
        attachmentsText = [manualText, tenderDocsText].filter(Boolean).join('\n\n---\n\n');
        if (names) {
          attachmentsText += `\n\n[Вложения тендера: ${names} — текст взят из кэша тендера]`;
        }
        docsInPrompt = tenderDocsCount + manualWithText.length;
      } else {
        const sessionAttText = withText
          .map((a) => `[${a.filename}]\n${a.ocr_text}`)
          .join('\n\n---\n\n');
        attachmentsText = [tenderDocsText, sessionAttText].filter(Boolean).join('\n\n---\n\n');
        docsInPrompt = tenderDocsCount + withText.length;
      }
      if (attachmentsText.length > ATTACH_CHARS_CAP) {
        attachmentsText = attachmentsText.slice(0, ATTACH_CHARS_CAP);
      }
      sendEvent({
        type: 'progress',
        message: attachmentsText.length
          ? `📄 В промпт: ${docsInPrompt} док., ${attachmentsText.length} симв.`
          : '📄 Вложений с текстом нет — опираюсь на tz_text'
      });
      await touchCalculating();

      const settings = await mimirTkpQuick._loadSettings(db);

      const analysisSession = sessionPurpose === 'rp_review_analysis';
      const result = await mimirTkpQuick.generateEstimate({
        tz_text: session.tz_text,
        customer_inn: session.customer_inn,
        customer_name: session.customer_name,
        customer_data: session.customer_data,
        attachments_text: attachmentsText,
        settings,
        purpose: sessionPurpose,
        phase: analysisSession ? 'analysis' : (sessionPurpose === 'rp_review_calc' ? 'calc' : null),
        analysisOnly: analysisSession,
        onProgress: (ev) => {
          sendEvent(ev);
          touchCalculating();
        },
        // D-303: реальные токены рассуждений модели → в журнал «мыслей».
        onReasoning: (chunk) => {
          try { sendEvent({ type: 'reasoning', delta: chunk }); } catch (_) {}
          touchCalculating();
        },
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
          calc_owner_pid = NULL,
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
        "UPDATE tkp_quick_sessions SET status='error', error_text=$1, calc_owner_pid=NULL, updated_at=NOW() WHERE session_uid=$2",
        [String(err.message).substring(0, 1000), request.params.uid]
      );
      sendEvent({ type: 'error', message: err.message });
    } finally {
      clearInterval(sseKeepalive);
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
    reply.hijack(); // ERR_HTTP_HEADERS_SENT: ответом управляем сами
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    const sendEvent = (data) => {
      try { reply.raw.write(`data: ${JSON.stringify(data)}\n\n`); } catch (_) {}
    };
    const sseKeepalive = setInterval(() => {
      try { reply.raw.write(`: ping ${Date.now()}\n\n`); } catch (_) {}
    }, 12000);

    try {
      sendEvent({ type: 'start', message: 'Мимир обрабатывает правку…' });

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
        onProgress: sendEvent,
        session_uid: request.params.uid,
        author_id: session.author_id || request.user.id,
        pre_tender_id: session.pre_tender_id || null,
        tender_id: session.tender_id || null
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

      sendEvent({
        type: 'done',
        chat_response_md: result.chat_response_md,
        estimate: newEstimate,
        diagnostics: result.diagnostics || null
      });
    } catch (err) {
      fastify.log.error(err, '[tkp_quick chat]');
      sendEvent({ type: 'error', message: err.message });
    } finally {
      clearInterval(sseKeepalive);
      reply.raw.end();
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /sessions/:uid/export-smeta.xlsx — Excel с формулами (шаблон Сегежа)
  fastify.post('/sessions/:uid/export-smeta.xlsx', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    const { rows: [session] } = await db.query(
      "SELECT * FROM tkp_quick_sessions WHERE session_uid = $1 AND author_id = $2",
      [request.params.uid, request.user.id]
    );
    if (!session) return reply.code(404).send({ error: 'Сессия не найдена' });
    const bodyEst = request.body && request.body.estimate;
    const draft = bodyEst || session.estimate_draft;
    if (!draft) return reply.code(400).send({ error: 'Нет сметы' });

    // Сохраняем правки РП если прислали estimate
    if (bodyEst) {
      const asgardSmeta = require('../services/asgard-smeta');
      const recalc = asgardSmeta.recalcAsgardSmeta(bodyEst);
      await db.query(
        `UPDATE tkp_quick_sessions SET estimate_draft = $1, updated_at = NOW()
         WHERE session_uid = $2`,
        [JSON.stringify(recalc), request.params.uid]
      );
      session.estimate_draft = recalc;
    }

    try {
      const buf = await mimirTkpQuick._xlsxFromEstimateDraft(
        session.estimate_draft,
        session.estimate_draft?.ai_meta
          ? { calculation: session.estimate_draft.ai_meta.calculation, totals: session.estimate_draft.ai_meta.totals, settings: {} }
          : {},
        { subject: session.estimate_draft.meta?.title || session.estimate_draft.subject },
        { name: session.customer_name }
      );
      reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      reply.header('Content-Disposition', 'attachment; filename="smeta_asgard.xlsx"');
      return reply.send(buf);
    } catch (e) {
      request.log.error(e);
      return reply.code(500).send({ error: e.message || 'Excel error' });
    }
  });

  // POST /sessions/:uid/patch-estimate — сохранить asgard_v1 после правок UI
  fastify.post('/sessions/:uid/patch-estimate', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    const { rows: [session] } = await db.query(
      "SELECT * FROM tkp_quick_sessions WHERE session_uid = $1 AND author_id = $2 AND status IN ('chatting','draft')",
      [request.params.uid, request.user.id]
    );
    if (!session) return reply.code(404).send({ error: 'Сессия не найдена' });
    const bodyEst = request.body && request.body.estimate;
    if (!bodyEst) return reply.code(400).send({ error: 'estimate обязателен' });
    const asgardSmeta = require('../services/asgard-smeta');
    const prev = session.estimate_draft || {};
    const merged = {
      ...bodyEst,
      ai_meta: bodyEst.ai_meta || prev.ai_meta,
      meta: { ...(prev.meta || {}), ...(bodyEst.meta || {}) }
    };
    const recalc = asgardSmeta.recalcAsgardSmeta(merged);
    await db.query(
      `UPDATE tkp_quick_sessions SET estimate_draft = $1, updated_at = NOW() WHERE session_uid = $2`,
      [JSON.stringify(recalc), request.params.uid]
    );
    return { ok: true, estimate: recalc };
  });

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
      // D-220b: тип — из белого списка по реальному расширению (генератор серверный, но
      // держим единый вход вместо локального тернарника, который гейт класса считает «из выражения»).
      const { safeContentType: sctTkpq } = require('../lib/upload-ext');
      const mime = sctTkpq('.' + ext, null);
      // CRIT: кириллица в filename= ломает Node setHeader (ERR_INVALID_CHAR).
      // ASCII fallback + filename* (RFC 6266), как в acts.js.
      const shortUid = request.params.uid.slice(0, 8);
      const rawName = `${kind === 'smeta' ? 'Смета' : 'Отчёт'}_preview_${shortUid}.${ext}`;
      const asciiName = `${kind === 'smeta' ? 'Smeta' : 'Report'}_preview_${shortUid}.${ext}`;
      reply.header('Content-Type', mime);
      reply.header(
        'Content-Disposition',
        `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(rawName)}`
      );
      return reply.send(buf);
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

    // D-304: в ТКП уходят КЛИЕНТСКИЕ позиции — с наценкой и без внутренних
    // статей (ФОТ-налог, накладные, пайковые, билеты). Итог = сумма строк.
    const clientItems = mimirTkpQuick.buildClientItems(draft);
    const itemsSubtotal = clientItems.reduce((s, i) => s + (Number(i.total) || 0), 0);
    const vatPct = Number(draft.vat_pct) || 20;
    // НДС в целых копейках (канон D-181 / vatFromBase). Раньше здесь было
    // Math.round(subtotal * (1 + vat/100)) — округление до РУБЛЕЙ, и PDF
    // печатал «Итого без НДС + НДС ≠ ИТОГО» (верификатор 05.11.2026).
    const { vatFromBase } = require('../services/tkp-ai-draft');
    const vatTotals = vatFromBase(itemsSubtotal, vatPct);
    const itemsVal = JSON.stringify({
      items: clientItems,
      vat_pct: vatPct,
      subtotal: vatTotals.base,
      vat_sum: vatTotals.vat,
      total_with_vat: vatTotals.total,
    });
    // total_sum в БД — цена БЕЗ НДС (как в модалке / классическом ТКП).
    const tkpTotal = vatTotals.base;

    // D-301: статус НЕ 'sent'. ТКП из Мимира — это ЧЕРНОВИК, который РП ещё
    // должен проверить и отправить осознанно. Раньше он рождался «отправленным»,
    // и директор видел «отправлено», хотя кнопку не нажимал.
    const { rows: [newTkp] } = await db.query(`
      INSERT INTO tkp (
        subject, tender_id, work_id, pre_tender_id, link_type,
        customer_name, customer_inn, work_description,
        items, total_sum, deadline, validity_days, payment_terms,
        source, status, mimir_quick_session_uid, purpose_reason, author_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'draft',$15,$16,$17)
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
      tkpTotal,
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
