'use strict';

/**
 * Worker-to-PM Handovers — Stage W (передача нала от рабочего к РП)
 * Prefix: /api/handovers
 *
 * Логика:
 *   Бух перевёл рабочему-СЗ деньги для проекта → рабочий должен передать нал РП.
 *   На каждый перевод (или ручная запись) создаётся handover в pending.
 *   РП подтверждает: received(полностью)/partial(частично)/not_received/cancelled.
 *   После подтверждения сумма входит в pm-balance как handovers_received.
 *
 * Endpoints:
 *   GET    /                         — список (фильтры year/month/pm_id/worker_id/status)
 *   POST   /                         — создать запись (РП/руководители/админ)
 *   POST   /manual                   — PM «Получил нал от СЗ» (сразу status='received')
 *   PUT    /:id/confirm              — РП подтверждает получение
 *
 * RBAC:
 *   PM/HEAD_PM — только свои (pm_user_id = req.user.id)
 *   DIRECTOR_*, ADMIN, BUH — все
 */

const ALLOWED_ROLES = [
  'PM', 'HEAD_PM',
  'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV',
  'ADMIN', 'BUH'
];
const FULL_ACCESS_ROLES = ['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'ADMIN', 'BUH'];

async function routes(fastify) {
  const db = fastify.db;
  const auth = { preHandler: [fastify.requireRoles(ALLOWED_ROLES)] };

  function isFull(role) {
    return FULL_ACCESS_ROLES.includes(role) || role === 'HEAD_PM';
  }

  // ────────────────────────────────────────────────────────────────
  // GET /api/handovers
  //   ?year=2026&month=6        — фильтр по периоду
  //   ?pm_id=10                 — фильтр по РП (DIRECTOR/ADMIN/BUH)
  //   ?worker_id=42             — фильтр по рабочему
  //   ?status=pending|received|partial|not_received|cancelled
  // PM: всегда ограничено своими (игнорирует ?pm_id, кроме case когда совпадает).
  // ────────────────────────────────────────────────────────────────
  fastify.get('/', auth, async (request, reply) => {
    try {
      const { year, month, pm_id, worker_id, status } = request.query || {};
      const role = request.user.role;
      const uid = Number(request.user.id);

      const conds = [];
      const params = [];
      let idx = 1;

      if (year) {
        conds.push(`h.year = $${idx++}`);
        params.push(parseInt(year, 10));
      }
      if (month) {
        conds.push(`h.month = $${idx++}`);
        params.push(parseInt(month, 10));
      }
      if (worker_id) {
        conds.push(`h.worker_id = $${idx++}`);
        params.push(parseInt(worker_id, 10));
      }
      if (status) {
        conds.push(`h.status = $${idx++}`);
        params.push(String(status));
      }

      // RBAC: PM (НЕ HEAD_PM) видит только свои.
      if (role === 'PM') {
        conds.push(`h.pm_user_id = $${idx++}`);
        params.push(uid);
      } else if (pm_id) {
        conds.push(`h.pm_user_id = $${idx++}`);
        params.push(parseInt(pm_id, 10));
      }

      const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

      const { rows } = await db.query(`
        SELECT h.*,
               e.fio AS worker_fio,
               u.name AS pm_name,
               w.work_title,
               st.transfer_amount AS source_transfer_amount,
               st.status AS source_transfer_status,
               u2.name AS received_by_name
        FROM worker_to_pm_handovers h
        LEFT JOIN employees e ON e.id = h.worker_id
        LEFT JOIN users u ON u.id = h.pm_user_id
        LEFT JOIN works w ON w.id = h.work_id
        LEFT JOIN se_transfers st ON st.id = h.source_se_transfer_id
        LEFT JOIN users u2 ON u2.id = h.received_by
        ${where}
        ORDER BY h.year DESC, h.month DESC, h.created_at DESC
        LIMIT 500
      `, params);

      return { handovers: rows };
    } catch (err) {
      fastify.log.error({ err }, '[handovers] GET / error');
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ────────────────────────────────────────────────────────────────
  // POST /api/handovers — создать запись передачи (вручную или из СЗ-перевода)
  // body: { worker_id, work_id?, year, month, source_se_transfer_id?,
  //         expected_amount, received_amount?, status?, note? }
  // ────────────────────────────────────────────────────────────────
  fastify.post('/', auth, async (request, reply) => {
    try {
      const {
        worker_id, work_id, year, month,
        source_se_transfer_id, source_worker_payment_id,
        expected_amount, received_amount, status, note
      } = request.body || {};

      if (!worker_id || !year || !month) {
        return reply.code(400).send({ error: 'worker_id, year, month обязательны' });
      }
      const wid = parseInt(worker_id, 10);
      const yr = parseInt(year, 10);
      const mo = parseInt(month, 10);
      if (!Number.isFinite(wid) || !Number.isFinite(yr) || !Number.isFinite(mo)) {
        return reply.code(400).send({ error: 'Bad worker_id/year/month' });
      }
      if (mo < 1 || mo > 12) return reply.code(400).send({ error: 'month: 1..12' });

      const expected = Number(expected_amount);
      if (!Number.isFinite(expected) || expected < 0) {
        return reply.code(400).send({ error: 'expected_amount >= 0' });
      }
      const received = Number(received_amount) || 0;
      if (received < 0) return reply.code(400).send({ error: 'received_amount >= 0' });

      const validStatus = ['pending', 'received', 'partial', 'not_received', 'cancelled'];
      const st = status && validStatus.includes(status) ? status : 'pending';

      // pm_user_id: для PM — он сам, для остальных — берём из работы
      // (либо из тела для гибкости).
      const role = request.user.role;
      const userId = Number(request.user.id);
      let pmUserId = userId;
      if (role !== 'PM' && role !== 'HEAD_PM') {
        // Директор/админ/бух создаёт от лица некоторого РП — определяем по work_id
        if (work_id) {
          const { rows: [w] } = await db.query(
            'SELECT pm_id FROM works WHERE id = $1',
            [parseInt(work_id, 10)]
          );
          if (w && w.pm_id) pmUserId = Number(w.pm_id);
        }
        // Иначе оставляем userId (для записи «за директора»)
      }

      // Защита от дубля по source_se_transfer_id (партиал-UNIQUE в БД,
      // но даём явную ошибку 409 для UX).
      if (source_se_transfer_id) {
        const { rows: existing } = await db.query(
          'SELECT id FROM worker_to_pm_handovers WHERE source_se_transfer_id = $1',
          [parseInt(source_se_transfer_id, 10)]
        );
        if (existing.length > 0) {
          return reply.code(409).send({
            error: 'handover_already_exists',
            existing_id: existing[0].id,
            message: 'Передача по этому СЗ-переводу уже зарегистрирована'
          });
        }
      }

      const receivedAt = (st === 'received' || st === 'partial' || st === 'not_received') ? new Date() : null;
      const receivedBy = receivedAt ? userId : null;

      const { rows } = await db.query(`
        INSERT INTO worker_to_pm_handovers (
          worker_id, pm_user_id, work_id, year, month,
          source_se_transfer_id, source_worker_payment_id,
          expected_amount, received_amount, status,
          received_at, received_by, note
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING *
      `, [
        wid, pmUserId, work_id ? parseInt(work_id, 10) : null, yr, mo,
        source_se_transfer_id ? parseInt(source_se_transfer_id, 10) : null,
        source_worker_payment_id ? parseInt(source_worker_payment_id, 10) : null,
        expected, received, st, receivedAt, receivedBy, note || null
      ]);

      return { handover: rows[0] };
    } catch (err) {
      fastify.log.error({ err }, '[handovers] POST / error');
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ────────────────────────────────────────────────────────────────
  // PUT /api/handovers/:id/confirm — подтверждение получения
  // body: { received_amount, status: 'received'|'partial'|'not_received', note? }
  // RBAC: PM только если pm_user_id = self; остальные — полный доступ.
  // ────────────────────────────────────────────────────────────────
  fastify.put('/:id/confirm', auth, async (request, reply) => {
    try {
      const id = parseInt(request.params.id, 10);
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'Bad id' });

      const { received_amount, status, note } = request.body || {};
      const validStatus = ['received', 'partial', 'not_received'];
      if (!status || !validStatus.includes(status)) {
        return reply.code(400).send({ error: `status must be one of ${validStatus.join('|')}` });
      }
      const received = Number(received_amount);
      if (!Number.isFinite(received) || received < 0) {
        return reply.code(400).send({ error: 'received_amount >= 0' });
      }

      const { rows: [h] } = await db.query(
        'SELECT * FROM worker_to_pm_handovers WHERE id = $1',
        [id]
      );
      if (!h) return reply.code(404).send({ error: 'Передача не найдена' });

      // RBAC: PM подтверждает только свои.
      const role = request.user.role;
      const uid = Number(request.user.id);
      if (role === 'PM' && Number(h.pm_user_id) !== uid) {
        return reply.code(403).send({ error: 'Это не ваша передача' });
      }

      // Проверка консистентности: received=N → status=received (полная сумма)
      // или partial (если N меньше expected); not_received → received=0.
      if (status === 'not_received' && received !== 0) {
        return reply.code(400).send({ error: 'Для not_received received_amount должен быть 0' });
      }
      if (status === 'received' && Math.abs(received - Number(h.expected_amount)) > 0.01) {
        return reply.code(400).send({
          error: 'received_amount должен совпадать с expected_amount для status=received',
          expected: Number(h.expected_amount)
        });
      }

      const { rows: [updated] } = await db.query(`
        UPDATE worker_to_pm_handovers
        SET received_amount = $1,
            status = $2,
            received_at = NOW(),
            received_by = $3,
            note = COALESCE($4, note),
            updated_at = NOW()
        WHERE id = $5
        RETURNING *
      `, [received, status, uid, note || null, id]);

      return { handover: updated };
    } catch (err) {
      fastify.log.error({ err }, '[handovers] PUT /:id/confirm error');
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ────────────────────────────────────────────────────────────────
  // POST /api/handovers/manual — PM-кнопка «Получил нал от СЗ»
  //   body: { worker_id, work_id?, amount, year, month, note? }
  //
  // Назначение: PM зафиксировал получение нала от СЗ без предварительного
  // se_transfer (СЗ привёз нал внезапно, задним числом и т.п.).
  // Создаётся handover сразу в status='received' (нал на руках).
  //
  // RBAC: PM (свои), HEAD_PM, BUH, DIR_*, ADMIN (тот же ALLOWED_ROLES).
  // pm_user_id: для PM/HEAD_PM — он сам; для BUH/DIR/ADMIN — из works.pm_id
  // (если work_id передан), иначе req.user.id (фоллбэк: запись «за директора»).
  //
  // Warning, не блокирующий: если уже есть pending handover по этому worker
  // в этом месяце у того же PM — успех + warning в ответе.
  // ────────────────────────────────────────────────────────────────
  fastify.post('/manual', auth, async (request, reply) => {
    try {
      const { worker_id, work_id, amount, year, month, note } = request.body || {};

      const wid = parseInt(worker_id, 10);
      const yr = parseInt(year, 10);
      const mo = parseInt(month, 10);
      const amt = Number(amount);

      if (!Number.isFinite(wid)) {
        return reply.code(400).send({ error: 'worker_id обязателен' });
      }
      if (!Number.isFinite(yr) || !Number.isFinite(mo) || mo < 1 || mo > 12) {
        return reply.code(400).send({ error: 'year/month обязательны и валидны (month 1..12)' });
      }
      if (!Number.isFinite(amt) || amt <= 0) {
        return reply.code(400).send({ error: 'amount должен быть > 0' });
      }

      const wkId = work_id != null && work_id !== '' ? parseInt(work_id, 10) : null;
      if (wkId != null && !Number.isFinite(wkId)) {
        return reply.code(400).send({ error: 'work_id невалиден' });
      }

      // Worker должен быть СЗ
      const { rows: [emp] } = await db.query(
        'SELECT id, is_self_employed FROM employees WHERE id = $1', [wid]
      );
      if (!emp) return reply.code(404).send({ error: 'Сотрудник не найден' });
      if (!emp.is_self_employed) {
        return reply.code(400).send({ error: 'Рабочий не самозанятый' });
      }

      const role = request.user.role;
      const uid = Number(request.user.id);

      // pm_user_id:
      //   PM/HEAD_PM — он сам.
      //   BUH/DIR_*/ADMIN — pm_user_id ОБЯЗАТЕЛЕН берётся из works.pm_id, иначе
      //   handover становится осиротевшим (pm_user_id=BUH_id не виден в
      //   /pm-balance, который фильтрует role IN ('PM','HEAD_PM')), и нал
      //   «исчезает» из учёта. Поэтому требуем work_id с pm_id.
      let pmUserId = uid;
      if (role !== 'PM' && role !== 'HEAD_PM') {
        if (wkId == null) {
          return reply.code(400).send({
            error: `work_id обязателен для роли ${role}, чтобы определить РП-получателя`
          });
        }
        const { rows: [w] } = await db.query(
          'SELECT pm_id FROM works WHERE id = $1', [wkId]
        );
        if (!w) {
          return reply.code(404).send({ error: 'Работа не найдена' });
        }
        if (!w.pm_id) {
          return reply.code(400).send({
            error: `У работы id=${wkId} не назначен РП — некому передать нал. Назначьте РП в работе или укажите другой work_id.`
          });
        }
        pmUserId = Number(w.pm_id);
      }

      // Проверка на pending по этому worker от этого PM в этом месяце
      // — не блокирует, выдаёт warning.
      const { rows: pending } = await db.query(`
        SELECT id, expected_amount FROM worker_to_pm_handovers
        WHERE worker_id = $1 AND pm_user_id = $2
          AND year = $3 AND month = $4 AND status = 'pending'
        ORDER BY created_at DESC
        LIMIT 1
      `, [wid, pmUserId, yr, mo]);

      const { rows: [created] } = await db.query(`
        INSERT INTO worker_to_pm_handovers (
          worker_id, pm_user_id, work_id, year, month,
          source_se_transfer_id, source_worker_payment_id,
          expected_amount, received_amount, status,
          received_at, received_by, note
        ) VALUES (
          $1, $2, $3, $4, $5,
          NULL, NULL,
          $6, $6, 'received',
          NOW(), $7, $8
        )
        RETURNING *
      `, [
        wid, pmUserId, wkId, yr, mo,
        amt, uid, note || null
      ]);

      const response = { handover: created };
      if (pending.length > 0) {
        const p = pending[0];
        response.warning =
          `Уже есть pending handover ID=${p.id} на ${Number(p.expected_amount)} ₽ ` +
          `за этот месяц. Этот ручной — отдельная запись.`;
      }

      return response;
    } catch (err) {
      fastify.log.error({ err }, '[handovers] POST /manual error');
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });
}

module.exports = routes;
