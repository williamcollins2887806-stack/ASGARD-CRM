'use strict';

/**
 * ASGARD CRM — API дашборда разработки (/api/dev-roadmap)
 * ═══════════════════════════════════════════════════════════════════════════
 * Публичный роут для экрана директора развития. Доступа по логину CRM нет —
 * доступ по «секретной ссылке»: заголовок/параметр X-Roadmap-Key сверяется
 * constant-time с ROADMAP_SECRET из env. Нет секрета → роут отвечает 404 (fail closed).
 *
 * Подпись закрытия чекпоинта: { signer, pin, note }. PIN по имени берётся из env
 * (ROADMAP_PIN_<ID>) и сверяется constant-time. Каждое действие пишется в аудит-лог
 * dev_roadmap_events — это доказательство «кто закрыл».
 *
 *   GET  /api/dev-roadmap/state            — дерево + счётный прогресс + последние события
 *   POST /api/dev-roadmap/checkpoint/:id/close   — закрыть под подписью
 *   POST /api/dev-roadmap/checkpoint/:id/reopen  — снять под подписью
 *   GET  /api/dev-roadmap/events           — лента «кто что закрыл»
 *
 * Структуру (этапы/пункты/чекпоинты) грузит tools/dev-roadmap-seed.js из
 * docs/dev-roadmap/roadmap.json. Здесь структура не редактируется — только статусы.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const META_PATH = path.join(__dirname, '../../docs/dev-roadmap/roadmap.json');

function timingSafeEqualStr(a, b) {
  const ab = Buffer.from(String(a == null ? '' : a), 'utf8');
  const bb = Buffer.from(String(b == null ? '' : b), 'utf8');
  if (ab.length !== bb.length) {
    // Всё равно делаем сравнение с самим собой, чтобы не течь по длине/времени.
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

const KIND_LABELS = {
  analysis: 'Анализ',
  design: 'Макет / рендер',
  approval: 'Утверждение',
  dev: 'Разработка',
  test: 'Тестирование',
  demo: 'Демо',
  launch: 'Запуск'
};

module.exports = async function (fastify, options) {
  const db = fastify.db;

  // Список подписантов (для имён в логе) — из roadmap.json.
  function signers() {
    try {
      const data = JSON.parse(fs.readFileSync(META_PATH, 'utf8'));
      const list = (data && data.meta && Array.isArray(data.meta.signers)) ? data.meta.signers : [];
      if (list.length) return list;
    } catch (_) { /* fallthrough */ }
    return [
      { id: 'nikita', name: 'Никита' },
      { id: 'kostya', name: 'Костя' },
      { id: 'andrey', name: 'Андрей' }
    ];
  }

  function findSigner(id) {
    if (!id) return null;
    return signers().find(s => s.id === String(id).toLowerCase()) || null;
  }

  function pinFor(signerId) {
    const key = 'ROADMAP_PIN_' + String(signerId).toUpperCase().replace(/[^A-Z0-9]/g, '');
    return process.env[key] || '';
  }

  // ── Гейт доступа: секретный ключ ──
  fastify.addHook('preHandler', async (request, reply) => {
    const secret = process.env.ROADMAP_SECRET || '';
    if (!secret) {
      // Fail closed: без настроенного секрета роут не существует.
      return reply.code(404).send({ error: 'Not found' });
    }
    const provided = request.headers['x-roadmap-key'] || request.query.k || '';
    if (!timingSafeEqualStr(provided, secret)) {
      return reply.code(404).send({ error: 'Not found' });
    }
    reply.header('X-Robots-Tag', 'noindex, nofollow');
  });

  // ── Чтение дерева + счётный прогресс ──
  async function loadState() {
    const { rows: stageRows } = await db.query(
      `SELECT id, code, title, short_title, color, start_date, deadline, sort_order
         FROM dev_roadmap_stages ORDER BY sort_order, id`
    );
    const { rows: itemRows } = await db.query(
      `SELECT id, stage_id, code, title, description, owner_id, start_date, deadline, sort_order
         FROM dev_roadmap_items ORDER BY stage_id, sort_order, id`
    );
    const { rows: cpRows } = await db.query(
      `SELECT id, item_id, code, kind, title, owner_id, deadline, sort_order,
              done, done_at, done_by, note
         FROM dev_roadmap_checkpoints ORDER BY item_id, sort_order, id`
    );

    const signerName = {};
    signers().forEach(s => { signerName[s.id] = s.name; });

    const cpsByItem = {};
    for (const cp of cpRows) {
      (cpsByItem[cp.item_id] = cpsByItem[cp.item_id] || []).push({
        id: cp.id,
        code: cp.code,
        kind: cp.kind,
        kind_label: KIND_LABELS[cp.kind] || cp.kind,
        title: cp.title,
        owner_id: cp.owner_id,
        owner_name: cp.owner_id ? (signerName[cp.owner_id] || cp.owner_id) : null,
        deadline: cp.deadline,
        done: cp.done,
        done_at: cp.done_at,
        done_by: cp.done_by,
        done_by_name: cp.done_by ? (signerName[cp.done_by] || cp.done_by) : null,
        note: cp.note
      });
    }

    const itemsByStage = {};
    for (const it of itemRows) {
      const cps = cpsByItem[it.id] || [];
      const done = cps.filter(c => c.done).length;
      (itemsByStage[it.stage_id] = itemsByStage[it.stage_id] || []).push({
        id: it.id,
        code: it.code,
        title: it.title,
        description: it.description,
        owner_id: it.owner_id,
        owner_name: it.owner_id ? (signerName[it.owner_id] || it.owner_id) : null,
        start_date: it.start_date,
        deadline: it.deadline,
        checkpoints: cps,
        progress: { done, total: cps.length, percent: cps.length ? Math.round(done / cps.length * 100) : 0 }
      });
    }

    const stages = stageRows.map(st => {
      const items = itemsByStage[st.id] || [];
      const total = items.reduce((a, i) => a + i.progress.total, 0);
      const done = items.reduce((a, i) => a + i.progress.done, 0);
      return {
        id: st.id,
        code: st.code,
        title: st.title,
        short_title: st.short_title || st.title,
        color: st.color,
        start_date: st.start_date,
        deadline: st.deadline,
        items,
        progress: { done, total, percent: total ? Math.round(done / total * 100) : 0 }
      };
    });

    const totalDone = stages.reduce((a, s) => a + s.progress.done, 0);
    const totalAll = stages.reduce((a, s) => a + s.progress.total, 0);

    return {
      signers: signers(),
      stages,
      overall: { done: totalDone, total: totalAll, percent: totalAll ? Math.round(totalDone / totalAll * 100) : 0 },
      generated_at: new Date().toISOString()
    };
  }

  async function recentEvents(limit = 40) {
    const { rows } = await db.query(
      `SELECT e.id, e.checkpoint_id, e.item_code, e.cp_code, e.action, e.signer_id, e.signer_name, e.note, e.created_at,
              c.title AS cp_title, i.title AS item_title
         FROM dev_roadmap_events e
         LEFT JOIN dev_roadmap_checkpoints c ON c.id = e.checkpoint_id
         LEFT JOIN dev_roadmap_items i ON i.id = c.item_id
        ORDER BY e.id DESC LIMIT $1`,
      [Math.min(Math.max(parseInt(limit, 10) || 40, 1), 200)]
    );
    // pg отдаёт BIGSERIAL строкой — приводим ID к числу, чтобы фронт/логи сравнивали их с id чекпоинтов.
    return rows.map(r => Object.assign({}, r, {
      id: Number(r.id),
      checkpoint_id: r.checkpoint_id == null ? null : Number(r.checkpoint_id)
    }));
  }

  // ── GET state ──
  fastify.get('/state', async (request, reply) => {
    const state = await loadState();
    state.events = await recentEvents(40);
    return state;
  });

  // ── GET events ──
  fastify.get('/events', async (request, reply) => {
    return { events: await recentEvents(request.query.limit) };
  });

  // ── Подпись: общая проверка для close/reopen ──
  // Анти-брутфорс: PIN короткий, поэтому считаем неверные попытки по signer+IP.
  // 8 промахов за 15 минут → 429; каждая неудачная попытка даёт задержку с эскалацией.
  const PIN_MAX_FAILS = 8;
  const PIN_WINDOW_MS = 15 * 60 * 1000;
  const _pinFails = new Map(); // key -> { count, firstAt }

  function failKey(signerId, request) {
    return String(request.ip || request.raw?.socket?.remoteAddress || '?') + '|' + signerId;
  }
  function isLocked(signerId, request) {
    const k = failKey(signerId, request);
    const rec = _pinFails.get(k);
    if (!rec) return false;
    if (Date.now() - rec.firstAt > PIN_WINDOW_MS) { _pinFails.delete(k); return false; }
    return rec.count >= PIN_MAX_FAILS;
  }
  function noteFail(signerId, request) {
    const k = failKey(signerId, request);
    const rec = _pinFails.get(k);
    if (!rec || Date.now() - rec.firstAt > PIN_WINDOW_MS) { _pinFails.set(k, { count: 1, firstAt: Date.now() }); return 1; }
    rec.count += 1;
    return rec.count;
  }
  function clearFails(signerId, request) { _pinFails.delete(failKey(signerId, request)); }
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  async function verifySigner(body, request) {
    const signer = findSigner(body && body.signer);
    if (!signer) return { error: 'Неизвестный подписант. Выберите: ' + signers().map(s => s.name).join(', ') };
    if (isLocked(signer.id, request)) {
      return { locked: true, error: 'Слишком много неверных попыток PIN. Повторите через 15 минут.' };
    }
    const expected = pinFor(signer.id);
    if (!expected) return { error: `PIN для «${signer.name}» не настроен на сервере (env ROADMAP_PIN_${signer.id.toUpperCase()})` };
    if (!timingSafeEqualStr(body && body.pin, expected)) {
      const n = noteFail(signer.id, request);
      await sleep(Math.min(120 * n, 1500)); // эскалация задержки тормозит перебор
      return { error: 'Неверный PIN' };
    }
    clearFails(signer.id, request);
    return { signer };
  }

  async function applySignature(request, reply, action) {
    // Строгая валидация: только целое положительное число в пределах int4
    // (parseInt глотал "1abc" → 1, а id > 2147483647 вызывал ошибку каста Postgres → 500).
    const rawId = String(request.params.id || '');
    if (!/^\d{1,10}$/.test(rawId)) return reply.code(400).send({ error: 'Некорректный id чекпоинта' });
    const id = Number(rawId);
    if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647) {
      return reply.code(400).send({ error: 'Некорректный id чекпоинта' });
    }

    const chk = await verifySigner(request.body, request);
    if (chk.locked) return reply.code(429).send({ error: chk.error });
    if (chk.error) return reply.code(401).send({ error: chk.error });
    const { signer } = chk;

    const note = (request.body && typeof request.body.note === 'string')
      ? request.body.note.trim().slice(0, 1000) : null;

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT c.id, c.code AS cp_code, c.done, i.code AS item_code
           FROM dev_roadmap_checkpoints c JOIN dev_roadmap_items i ON i.id = c.item_id
          WHERE c.id = $1 FOR UPDATE`,
        [id]
      );
      if (!rows.length) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'Чекпоинт не найден' });
      }
      const cp = rows[0];

      if (action === 'close' && cp.done) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'Чекпоинт уже закрыт', done_by: cp.done_by || null });
      }
      if (action === 'reopen' && !cp.done) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'Чекпоинт уже открыт' });
      }

      if (action === 'close') {
        await client.query(
          `UPDATE dev_roadmap_checkpoints
              SET done = true, done_at = NOW(), done_by = $2, note = $3, updated_at = NOW()
            WHERE id = $1`,
          [id, signer.id, note]
        );
      } else {
        await client.query(
          `UPDATE dev_roadmap_checkpoints
              SET done = false, done_at = NULL, done_by = NULL, note = NULL, updated_at = NOW()
            WHERE id = $1`,
          [id]
        );
      }

      await client.query(
        `INSERT INTO dev_roadmap_events
           (checkpoint_id, item_code, cp_code, action, signer_id, signer_name, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, cp.item_code, cp.cp_code, action, signer.id, signer.name, note]
      );

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    // Свежий счётный прогресс сразу возвращаем — фронт пересчитает кольца мгновенно.
    const state = await loadState();
    state.events = await recentEvents(40);
    return { ok: true, signed_by: signer.name, state };
  }

  fastify.post('/checkpoint/:id/close', async (request, reply) => applySignature(request, reply, 'close'));
  fastify.post('/checkpoint/:id/reopen', async (request, reply) => applySignature(request, reply, 'reopen'));
};

module.exports.KIND_LABELS = KIND_LABELS;
