/**
 * Work Readiness — агрегат готовности проекта к старту работ.
 * ═══════════════════════════════════════════════════════════════════════════
 * Считает фактическую готовность работы по 7 этапам подготовки из данных
 * модулей (персонал, допуска, закупки, сборы, билеты, жильё, логистика).
 * Этап без данных (applicable=false) в общий расчёт не входит. РП может
 * принудительно закрыть этап (project_readiness_overrides, V182).
 *
 *  GET    /:workId                 — полная карта готовности (7 этапов + overall)
 *  GET    /summary?ids=1,2,3       — батч {workId: {overall_percent, blocker,...}} (кэш 60с)
 *  POST   /:workId/override        — принудительно закрыть/снять этап {stage, forced_done, note}
 *  DELETE /:workId/override/:stage — снять override
 */

// Этап показываем только пока работа в подготовке (или ещё не вставала на объект).
const PREP_STATUSES = ['Новая', 'Подготовка', 'Мобилизация'];

// Вес этапа в общем %: персонал/допуска критичнее билетов/жилья/логистики.
// Нормируется по применимым этапам (этап без данных исключается из суммы весов).
const STAGE_META = {
  personnel:   { label: 'Персонал',  icon: '👷', weight: 0.25 },
  training:    { label: 'Допуска',   icon: '🎓', weight: 0.25 },
  procurement: { label: 'Закупки',   icon: '🛒', weight: 0.20 },
  assembly:    { label: 'Сборы',     icon: '📦', weight: 0.15 },
  tickets:     { label: 'Билеты',    icon: '🎫', weight: 0.06 },
  housing:     { label: 'Жильё',     icon: '🏠', weight: 0.06 },
  logistics:   { label: 'Логистика', icon: '🚚', weight: 0.03 },
};
const STAGE_ORDER = ['personnel', 'training', 'procurement', 'assembly', 'tickets', 'housing', 'logistics'];

// Типы field_logistics, относящиеся к каждому этапу
const TICKET_TYPES = ['ticket_to', 'ticket_back', 'flight', 'train'];
// 23.06.2026 BUG-FIX (🟡 S-FIELD-08): жильё считаем по 3 типам, а не только 'hotel'.
// buildMessages в field-logistics.js поддерживает hotel/housing/hostel — раньше housing и hostel
// записи (вахтовое жильё, хостел) НЕ попадали в кольцо готовности «Жильё».
const HOUSING_TYPES = ['hotel', 'housing', 'hostel'];
const LOGISTICS_TYPES = ['transfer'];
// «Готовый» статус логистической позиции: куплено (V183) или уже отправлено рабочему
const LOGI_DONE = ['purchased', 'sent'];

const ROLES_RW = ['PM', 'HEAD_PM', 'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'TO', 'OFFICE_MANAGER'];

async function routes(fastify, options) {
  const db = fastify.db;

  // Общий кэш батч-summary (TTL 60с). Вынесен в helpers, чтобы works.js мог инвалидировать
  // запись при смене статуса/назначений работы.
  const summaryCache = require('../helpers/readiness-cache');
const { logError } = require('../lib/log-error');
  const TTL = summaryCache.TTL;

  // ─── helpers по этапам ────────────────────────────────────────────────────

  // Активные рабочие на работе (основа для проверки полноты логистики)
  async function getActiveAssignments(workId) {
    const { rows } = await db.query(`
      SELECT ea.employee_id,
             COALESCE(NULLIF(TRIM(e.full_name), ''), e.fio, 'Сотрудник #' || ea.employee_id) AS fio
      FROM employee_assignments ea
      LEFT JOIN employees e ON e.id = ea.employee_id
      WHERE ea.work_id = $1 AND ea.is_active = true AND ea.departure_date IS NULL
    `, [workId]);
    return rows;
  }

  // 👷 Персонал: укомплектовано = есть заявка added_to_crew И есть активные назначения
  async function stagePersonnel(workId) {
    const { rows: reqs } = await db.query(
      `SELECT id, status_v2 FROM staff_requests WHERE work_id = $1`, [workId]
    );
    const assigned = await getActiveAssignments(workId);
    // applicable: если нет ни заявок, ни назначений — этап неактуален
    if (!reqs.length && !assigned.length) return null;
    const hasCrewReq = reqs.some(r => r.status_v2 === 'added_to_crew');
    const done = (hasCrewReq && assigned.length > 0) ? 1 : 0;
    return {
      done, total: 1,
      items: [{
        name: `Назначено рабочих: ${assigned.length}`,
        ok: done === 1,
        detail: hasCrewReq ? 'Заявка добавлена в бригаду' : 'Бригада не укомплектована',
      }],
    };
  }

  // 🎓 Допуска: готово = нет worker_training в статусах pending/in_progress
  async function stageTraining(workId) {
    const { rows: tr } = await db.query(
      `SELECT status, COUNT(*)::int AS cnt FROM worker_training WHERE work_id = $1 GROUP BY status`,
      [workId]
    );
    // Есть ли вообще требования допусков по работе?
    const { rows: [reqCnt] } = await db.query(
      `SELECT COUNT(*)::int AS cnt FROM work_permit_requirements WHERE work_id = $1`, [workId]
    );
    if (!tr.length && (!reqCnt || reqCnt.cnt === 0)) return null; // нет ни обучения, ни требований
    const open = tr.filter(r => r.status === 'pending' || r.status === 'in_progress')
                   .reduce((s, r) => s + r.cnt, 0);
    const total = tr.reduce((s, r) => s + r.cnt, 0);
    const completed = total - open;
    return {
      done: open === 0 ? 1 : 0, total: 1,
      items: [{
        name: total > 0 ? `Допуска/обучение: ${completed}/${total}` : 'Требования допусков заданы',
        ok: open === 0,
        detail: open > 0 ? `Не закрыто: ${open}` : 'Все допуска закрыты',
      }],
    };
  }

  // 🛒 Закупки: готово = все активные заявки delivered/closed
  async function stageProcurement(workId) {
    const { rows } = await db.query(`
      SELECT status, COUNT(*)::int AS cnt
      FROM procurement_requests
      WHERE work_id = $1 AND status NOT IN ('dir_rejected','cancelled')
      GROUP BY status
    `, [workId]);
    if (!rows.length) return null; // нет заявок — этап неактуален
    const total = rows.reduce((s, r) => s + r.cnt, 0);
    const doneCnt = rows.filter(r => r.status === 'delivered' || r.status === 'closed')
                        .reduce((s, r) => s + r.cnt, 0);
    return {
      done: doneCnt, total,
      items: [{
        name: `Заявки доставлены: ${doneCnt}/${total}`,
        ok: doneCnt >= total,
        detail: doneCnt < total ? `В работе: ${total - doneCnt}` : 'Всё доставлено',
      }],
    };
  }

  // 📦 Сборы (мобилизация): готово = заказ in_transit/received/closed
  async function stageAssembly(workId) {
    const { rows } = await db.query(`
      SELECT ao.id, ao.status,
        (SELECT COUNT(*) FROM assembly_items ai WHERE ai.assembly_id = ao.id)::int AS items_count,
        (SELECT COUNT(*) FROM assembly_items ai WHERE ai.assembly_id = ao.id AND ai.packed = true)::int AS packed_count
      FROM assembly_orders ao
      WHERE ao.work_id = $1 AND ao.type = 'mobilization' AND ao.status <> 'draft'
    `, [workId]);
    if (!rows.length) return null; // нет подтверждённых сборок — неактуально
    const DONE = new Set(['in_transit', 'received', 'closed']);
    let doneCnt = 0;
    const items = rows.map(o => {
      const ok = DONE.has(o.status);
      if (ok) doneCnt++;
      return {
        name: `Сборка #${o.id}: ${o.packed_count}/${o.items_count} упаковано`,
        ok,
        detail: ok ? 'Отправлено/получено' : `Статус: ${o.status}`,
      };
    });
    return { done: doneCnt, total: rows.length, items };
  }

  // 🎫🏠🚚 Логистика по типам: готово = у каждого активного рабочего есть позиция в статусе purchased/sent
  async function stageLogistics(workId, types) {
    const assigned = await getActiveAssignments(workId);
    const { rows: logi } = await db.query(`
      SELECT employee_id, item_type, status
      FROM field_logistics
      WHERE work_id = $1 AND item_type = ANY($2::text[])
    `, [workId, types]);
    // applicable: этап актуален если есть рабочие И (есть хоть одна позиция этого типа ИЛИ работа вахтовая)
    if (!logi.length) return null; // нет ни одной позиции этого типа — считаем неактуальным
    if (!assigned.length) {
      // позиции есть, но рабочих нет — оценим по самим позициям
      const total = logi.length;
      const done = logi.filter(l => LOGI_DONE.includes(l.status)).length;
      return {
        done, total,
        items: logi.map(l => ({ name: l.item_type, ok: LOGI_DONE.includes(l.status), detail: l.status })),
      };
    }
    // Полнота: по каждому рабочему — есть ли «готовая» позиция нужного типа
    const doneByEmp = new Map();
    for (const l of logi) {
      const ready = LOGI_DONE.includes(l.status);
      if (ready) doneByEmp.set(l.employee_id, true);
      else if (!doneByEmp.has(l.employee_id)) doneByEmp.set(l.employee_id, false);
    }
    let doneCnt = 0;
    const items = assigned.map(a => {
      const ok = doneByEmp.get(a.employee_id) === true;
      if (ok) doneCnt++;
      return { name: a.fio, ok, detail: ok ? 'Куплено/отправлено' : (doneByEmp.has(a.employee_id) ? 'Не куплено' : 'Нет данных') };
    });
    return { done: doneCnt, total: assigned.length, items };
  }

  // Собрать полную карту готовности по работе
  async function computeReadiness(workId) {
    const { rows: [work] } = await db.query(
      `SELECT id, work_title, work_status, start_in_work_date, start_plan, pm_id
       FROM works WHERE id = $1 AND deleted_at IS NULL`, [workId]
    );
    if (!work) return null;

    // Показываем готовность только пока работа в подготовке.
    // Признак — ТОЛЬКО work_status (стейт-машина Новая→Подготовка→Мобилизация→В работе→…).
    // Поле start_in_work_date на проде заполняется редко, поэтому как признак НЕ используем
    // (иначе работы «В работе»/закрытые без этой даты ложно считались бы «в подготовке»).
    const inPrep = PREP_STATUSES.includes(work.work_status);

    // Overrides
    const { rows: ovRows } = await db.query(
      `SELECT stage, forced_done FROM project_readiness_overrides WHERE work_id = $1`, [workId]
    );
    const overrides = new Map(ovRows.map(o => [o.stage, o.forced_done]));

    const raw = {
      personnel:   await stagePersonnel(workId),
      training:    await stageTraining(workId),
      procurement: await stageProcurement(workId),
      assembly:    await stageAssembly(workId),
      tickets:     await stageLogistics(workId, TICKET_TYPES),
      housing:     await stageLogistics(workId, HOUSING_TYPES),
      logistics:   await stageLogistics(workId, LOGISTICS_TYPES),
    };

    const stages = [];
    let weightSum = 0, weightedPct = 0;
    let blocker = null, blockerPct = 101;

    for (const key of STAGE_ORDER) {
      const meta = STAGE_META[key];
      const r = raw[key];
      const forced = overrides.get(key) === true;
      // applicable: есть данные ИЛИ есть override (РП явно закрыл)
      const applicable = !!r || forced;
      if (!applicable) {
        stages.push({ stage: key, ...meta, applicable: false, done: 0, total: 0, percent: 0, items: [], forced: false });
        continue;
      }
      let done = r ? r.done : 1;
      let total = r ? r.total : 1;
      if (forced) { done = total = Math.max(total, 1); } // override закрывает этап
      const percent = total > 0 ? Math.round((done / total) * 100) : 0;
      const stage = { stage: key, ...meta, applicable: true, done, total, percent, forced, items: r ? r.items : [] };
      stages.push(stage);
      weightSum += meta.weight;
      weightedPct += meta.weight * percent;
      if (percent < blockerPct) { blockerPct = percent; blocker = key; }
    }

    const overall = weightSum > 0 ? Math.round(weightedPct / weightSum) : 0;
    const applicableStages = stages.filter(s => s.applicable);
    return {
      work_id: work.id,
      work_title: work.work_title,
      work_status: work.work_status,
      in_prep: inPrep,
      start_plan: work.start_plan,
      start_in_work_date: work.start_in_work_date,
      overall_percent: overall,
      blocker: (blockerPct < 100) ? blocker : null,
      stages,
      stages_done: applicableStages.filter(s => s.percent >= 100).length,
      stages_total: applicableStages.length,
    };
  }

  // ─── GET /?my=true — мои работы в подготовке + их готовность (C-14 виджет) ─
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const isMine = String(request.query.my || '').toLowerCase() === 'true';
      const userId = request.user.id;
      const userRole = request.user.role;

      const prepStatuses = ['Новая', 'Подготовка', 'Мобилизация'];
      const params = [prepStatuses];
      let where = `w.work_status = ANY($1) AND w.deleted_at IS NULL`;
      if (isMine && userRole === 'PM') {
        params.push(userId);
        where += ` AND w.pm_id = $2`;
      } else if (isMine) {
        // HEAD_PM/DIRECTOR — все работы в подготовке
      }

      const { rows: works } = await fastify.db.query(
        `SELECT w.id, w.work_title, w.customer_name, w.work_status,
                w.start_plan, w.start_in_work_date,
                w.pm_id, COALESCE(NULLIF(u.name, ''), u.login) AS pm_name
         FROM works w
         LEFT JOIN users u ON u.id = w.pm_id
         WHERE ${where}
         ORDER BY w.start_plan ASC NULLS LAST, w.id DESC
         LIMIT 50`, params);

      const items = [];
      for (const w of works) {
        const r = await computeReadiness(w.id);
        if (r) items.push({ ...w, readiness: r });
      }
      return { items, total: items.length };
    } catch (err) {
      logError(fastify, '[work-readiness] GET /', err, request);
      return reply.code(500).send({ error: 'Ошибка списка готовности' });
    }
  });

  // ─── GET /:workId — полная карта готовности ───────────────────────────────
  fastify.get('/:workId', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const workId = parseInt(request.params.workId, 10);
      if (!workId) return reply.code(400).send({ error: 'workId обязателен' });
      const data = await computeReadiness(workId);
      if (!data) return reply.code(404).send({ error: 'Работа не найдена' });
      return data;
    } catch (err) {
      logError(fastify, '[work-readiness] GET /:workId', err, request);
      return reply.code(500).send({ error: 'Ошибка расчёта готовности' });
    }
  });

  // ─── GET /summary?ids=1,2,3 — батч для списков (кэш 60с) ───────────────────
  fastify.get('/summary', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const idsRaw = (request.query.ids || '').toString();
      const ids = idsRaw.split(',').map(s => parseInt(s.trim(), 10)).filter(Boolean).slice(0, 200);
      if (!ids.length) return {};
      const out = {};
      const toCompute = [];
      for (const id of ids) {
        const cached = summaryCache.get(id);
        if (cached) out[id] = cached;
        else toCompute.push(id);
      }
      for (const id of toCompute) {
        const full = await computeReadiness(id);
        if (!full) continue;
        const slim = {
          work_id: id,
          overall_percent: full.overall_percent,
          blocker: full.blocker,
          blocker_label: full.blocker ? STAGE_META[full.blocker].label : null,
          in_prep: full.in_prep,
          stages_done: full.stages_done,
          stages_total: full.stages_total,
          start_plan: full.start_plan,
        };
        summaryCache.set(id, slim);
        out[id] = slim;
      }
      return out;
    } catch (err) {
      logError(fastify, '[work-readiness] GET /summary', err, request);
      return reply.code(500).send({ error: 'Ошибка расчёта сводки' });
    }
  });

  // ─── POST /:workId/override — принудительно закрыть/снять этап ─────────────
  fastify.post('/:workId/override', { preHandler: [fastify.requireRoles(ROLES_RW)] }, async (request, reply) => {
    try {
      const workId = parseInt(request.params.workId, 10);
      const { stage, forced_done = true, note } = request.body || {};
      if (!workId || !stage || !STAGE_META[stage]) {
        return reply.code(400).send({ error: 'Укажите workId и корректный stage' });
      }
      // RBAC: PM может менять только свою работу; HEAD_PM/директора/ADMIN — любую
      const { rows: [work] } = await db.query('SELECT pm_id FROM works WHERE id = $1 AND deleted_at IS NULL', [workId]);
      if (!work) return reply.code(404).send({ error: 'Работа не найдена' });
      const role = request.user.role;
      if (role === 'PM' && work.pm_id !== request.user.id) {
        return reply.code(403).send({ error: 'Можно менять только свои работы' });
      }
      await db.query(`
        INSERT INTO project_readiness_overrides (work_id, stage, forced_done, note, created_by)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (work_id, stage)
        DO UPDATE SET forced_done = EXCLUDED.forced_done, note = EXCLUDED.note,
                      created_by = EXCLUDED.created_by, created_at = NOW()
      `, [workId, stage, forced_done === true || forced_done === 'true', note || null, request.user.id]);
      summaryCache.invalidate(workId);
      return { ok: true };
    } catch (err) {
      logError(fastify, '[work-readiness] POST override', err, request);
      return reply.code(500).send({ error: 'Ошибка сохранения' });
    }
  });

  // ─── DELETE /:workId/override/:stage — снять override ─────────────────────
  fastify.delete('/:workId/override/:stage', { preHandler: [fastify.requireRoles(ROLES_RW)] }, async (request, reply) => {
    try {
      const workId = parseInt(request.params.workId, 10);
      const stage = request.params.stage;
      if (!workId || !STAGE_META[stage]) return reply.code(400).send({ error: 'Некорректные параметры' });
      const { rows: [work] } = await db.query('SELECT pm_id FROM works WHERE id = $1 AND deleted_at IS NULL', [workId]);
      if (!work) return reply.code(404).send({ error: 'Работа не найдена' });
      if (request.user.role === 'PM' && work.pm_id !== request.user.id) {
        return reply.code(403).send({ error: 'Можно менять только свои работы' });
      }
      await db.query('DELETE FROM project_readiness_overrides WHERE work_id = $1 AND stage = $2', [workId, stage]);
      summaryCache.invalidate(workId);
      return { ok: true };
    } catch (err) {
      logError(fastify, '[work-readiness] DELETE override', err, request);
      return reply.code(500).send({ error: 'Ошибка удаления' });
    }
  });
}

module.exports = routes;
