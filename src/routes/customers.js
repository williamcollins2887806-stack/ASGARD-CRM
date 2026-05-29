/**
 * Customers Routes
 */

// SECURITY: Allowlist of columns for customers
const ALLOWED_COLS = new Set([
  'inn', 'name', 'full_name', 'kpp', 'ogrn', 'address', 'phone',
  'email', 'contact_person', 'bank_account', 'bank_name', 'bik',
  'notes', 'category', 'is_active', 'created_at', 'updated_at'
]);

function filterData(data) {
  const filtered = {};
  for (const [k, v] of Object.entries(data)) {
    if (ALLOWED_COLS.has(k) && v !== undefined) filtered[k] = v;
  }
  return filtered;
}

async function routes(fastify, options) {
  const db = fastify.db;

  // Lookup company info by INN (using DaData API)
  fastify.get('/lookup/:inn', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const inn = String(request.params.inn || '').replace(/\D/g, '');
    if (inn.length !== 10 && inn.length !== 12) {
      return reply.code(400).send({ error: 'ИНН должен быть 10 или 12 цифр' });
    }

    const DADATA_TOKEN = process.env.DADATA_TOKEN;
    if (!DADATA_TOKEN) {
      // Fallback: return basic structure without real lookup
      return {
        found: false,
        message: 'DaData API не настроен. Добавьте DADATA_TOKEN в переменные окружения.',
        suggestion: { inn, name: '', full_name: '', kpp: '', ogrn: '', address: '' }
      };
    }

    try {
      const response = await fetch('https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Token ${DADATA_TOKEN}`
        },
        body: JSON.stringify({ query: inn, count: 1 })
      });

      if (!response.ok) {
        throw new Error(`DaData API error: ${response.status}`);
      }

      const data = await response.json();

      if (data.suggestions && data.suggestions.length > 0) {
        const s = data.suggestions[0];
        const d = s.data || {};
        return {
          found: true,
          suggestion: {
            inn: d.inn || inn,
            name: d.name?.short_with_opf || s.value || '',
            full_name: d.name?.full_with_opf || '',
            kpp: d.kpp || '',
            ogrn: d.ogrn || '',
            address: d.address?.unrestricted_value || d.address?.value || ''
          }
        };
      }

      return { found: false, message: 'Организация не найдена', suggestion: { inn } };
    } catch (e) {
      fastify.log.error('DaData lookup error:', e);
      return reply.code(500).send({ error: 'Ошибка поиска по ИНН: ' + e.message });
    }
  });

  // Suggest companies by name via DaData API
  fastify.get('/suggest', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { q, type = 'party' } = request.query;
    if (!q || String(q).trim().length < 2) {
      return { suggestions: [] };
    }

    const DADATA_TOKEN = process.env.DADATA_TOKEN;
    if (!DADATA_TOKEN) {
      return { suggestions: [], message: 'DaData API не настроен' };
    }

    try {
      const response = await fetch('https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/party', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Token ${DADATA_TOKEN}`
        },
        body: JSON.stringify({ query: String(q).trim(), count: 5 })
      });

      if (!response.ok) {
        throw new Error(`DaData API error: ${response.status}`);
      }

      const data = await response.json();
      const suggestions = (data.suggestions || []).map(s => {
        const d = s.data || {};
        return {
          inn: d.inn || '',
          name: d.name?.short_with_opf || s.value || '',
          full_name: d.name?.full_with_opf || '',
          kpp: d.kpp || '',
          ogrn: d.ogrn || '',
          address: d.address?.unrestricted_value || d.address?.value || ''
        };
      });

      return { suggestions };
    } catch (e) {
      fastify.log.error('DaData suggest error:', e);
      return { suggestions: [] };
    }
  });

  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { search, limit = 100, offset = 0 } = request.query;
    let sql = 'SELECT * FROM customers WHERE 1=1';
    const params = [];
    let idx = 1;
    if (search) {
      sql += ` AND (LOWER(name) LIKE $${idx} OR inn LIKE $${idx})`;
      params.push(`%${search.toLowerCase()}%`);
      idx++;
    }
    sql += ` ORDER BY name ASC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limit, offset);
    const result = await db.query(sql, params);
    return { customers: result.rows };
  });

  fastify.get('/:inn', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const result = await db.query('SELECT * FROM customers WHERE inn = $1', [request.params.inn]);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Контрагент не найден' });
    const tenders = await db.query('SELECT * FROM tenders WHERE customer_inn = $1 ORDER BY created_at DESC LIMIT 10', [request.params.inn]);
    return { customer: result.rows[0], tenders: tenders.rows };
  });

  // SECURITY B3: Role-based access
  fastify.post('/', { preHandler: [fastify.requireRoles(['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM'])] }, async (request, reply) => {
    const { inn, name, ...rest } = request.body;
    if (!inn || !name) return reply.code(400).send({ error: 'ИНН и наименование обязательны' });

    // Validate INN format: must be 10 or 12 digits
    const cleanInn = String(inn).replace(/\D/g, '');
    if (cleanInn.length !== 10 && cleanInn.length !== 12) {
      return reply.code(400).send({ error: 'ИНН должен содержать 10 или 12 цифр' });
    }

    const data = filterData({ inn, name, ...rest, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    const keys = Object.keys(data);
    const values = Object.values(data);

    // Use upsert to handle re-adding deleted customers (only if inn is non-empty)
    const updateParts = keys.filter(k => k !== 'inn' && k !== 'created_at').map((k, i) => `${k} = EXCLUDED.${k}`);
    let sql;
    if (data.inn && data.inn.trim()) {
      sql = `
        INSERT INTO customers (${keys.join(', ')})
        VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})
        ON CONFLICT (inn) WHERE inn IS NOT NULL AND inn::text <> ''::text DO UPDATE SET ${updateParts.join(', ')}
        RETURNING *
      `;
    } else {
      sql = `
        INSERT INTO customers (${keys.join(', ')})
        VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})
        RETURNING *
      `;
    }
    let result;
    try {
      result = await db.query(sql, values);
    } catch (err) {
      if (err.code === '23505') {
        // Duplicate key violation — return 409 Conflict
        const detail = err.detail || err.message;
        return reply.code(409).send({ error: 'Запись уже существует', detail });
      }
      throw err;
    }
    return { customer: result.rows[0] };
  });

  fastify.put('/:inn', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { inn } = request.params;
    const data = filterData(request.body);
    const updates = [];
    const values = [];
    let idx = 1;
    for (const [key, value] of Object.entries(data)) {
      if (key !== 'inn') { updates.push(`${key} = $${idx}`); values.push(value); idx++; }
    }
    if (!updates.length) return reply.code(400).send({ error: 'Нет данных' });
    updates.push('updated_at = NOW()');
    values.push(inn);
    const sql = `UPDATE customers SET ${updates.join(', ')} WHERE inn = $${idx} RETURNING *`;
    const result = await db.query(sql, values);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Не найден' });
    return { customer: result.rows[0] };
  });

  // ─── GET /:inn/dashboard — сводка-«светофор» контрагента ───────────────────
  // Возвращает агрегат по тендерам, ТКП, прямым запросам, работам и финансам.
  // Результат отдаётся фронту для карточки-светофора и передаётся Мимиру как контекст.
  fastify.get('/:inn/dashboard', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const inn = String(request.params.inn || '').replace(/\D/g, '');
    if (inn.length !== 10 && inn.length !== 12) {
      return reply.code(400).send({ error: 'Некорректный ИНН (должен содержать 10 или 12 цифр)' });
    }

    // Все запросы параллельно для минимального времени отклика
    const [
      profileRes,
      tendersAggRes,
      tendersByStatusRes,
      preTendersRes,
      tkpRes,
      worksRes,
      financeRes
    ] = await Promise.all([

      // Профиль контрагента
      db.query('SELECT * FROM customers WHERE inn = $1', [inn]),

      // Агрегат по тендерам
      db.query(`
        SELECT
          COUNT(*)                                                        AS total,
          COUNT(*) FILTER (WHERE tender_status = 'Выиграли')             AS won,
          COUNT(*) FILTER (WHERE tender_status = 'Проиграли')            AS lost,
          COUNT(*) FILTER (WHERE tender_status = 'Отменён')              AS cancelled,
          COUNT(*) FILTER (WHERE tender_status NOT IN ('Выиграли','Проиграли','Отменён')) AS in_work,
          COALESCE(SUM(tender_price) FILTER (WHERE tender_status = 'Выиграли'), 0)  AS won_sum,
          COALESCE(SUM(tender_price) FILTER (WHERE tender_status = 'Проиграли'), 0) AS lost_sum,
          COALESCE(SUM(tender_price) FILTER (WHERE tender_status NOT IN ('Выиграли','Проиграли','Отменён')), 0) AS in_work_sum,
          MAX(updated_at)                                                 AS last_tender_at
        FROM tenders
        WHERE customer_inn = $1 AND deleted_at IS NULL
      `, [inn]),

      // Разбивка по статусам
      db.query(`
        SELECT tender_status, COUNT(*) AS cnt, COALESCE(SUM(tender_price), 0) AS sum
        FROM tenders
        WHERE customer_inn = $1 AND deleted_at IS NULL
        GROUP BY tender_status
        ORDER BY cnt DESC
      `, [inn]),

      // Прямые запросы (pre_tenders)
      db.query(`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE status = 'accepted')  AS accepted,
          COUNT(*) FILTER (WHERE status = 'rejected')  AS rejected,
          COUNT(*) FILTER (WHERE status IN ('new','in_review','need_docs')) AS in_review
        FROM pre_tender_requests
        WHERE customer_inn = $1
      `, [inn]),

      // ТКП
      db.query(`
        SELECT
          COUNT(*)                                                           AS total,
          COUNT(*) FILTER (WHERE client_decision = 'accepted')              AS accepted,
          COUNT(*) FILTER (WHERE client_decision = 'rejected')              AS rejected,
          COUNT(*) FILTER (WHERE status IN ('sent','approved') AND client_decision IS NULL) AS awaiting,
          COALESCE(SUM(total_sum) FILTER (WHERE client_decision = 'accepted'), 0) AS accepted_sum
        FROM tkp
        WHERE customer_inn = $1
      `, [inn]),

      // Работы: через customer_inn напрямую ИЛИ через тендер (UNION чтобы не упустить старые записи)
      db.query(`
        SELECT
          COUNT(DISTINCT id)                                                AS total,
          COUNT(DISTINCT id) FILTER (WHERE work_status NOT IN ('Работы сдали','Закрыт')) AS active,
          COUNT(DISTINCT id) FILTER (WHERE work_status IN ('Работы сдали','Закрыт'))     AS completed,
          COALESCE(SUM(contract_value), 0)                                 AS total_value,
          COALESCE(SUM(contract_value) FILTER (WHERE work_status NOT IN ('Работы сдали','Закрыт')), 0) AS active_value
        FROM works
        WHERE (
          customer_inn = $1
          OR tender_id IN (SELECT id FROM tenders WHERE customer_inn = $1 AND deleted_at IS NULL)
        )
        AND deleted_at IS NULL
      `, [inn]),

      // Финансы: акты и счета
      db.query(`
        SELECT
          (SELECT COALESCE(SUM(amount), 0)  FROM acts    WHERE customer_inn = $1 AND status = 'paid')    AS acts_paid_sum,
          (SELECT COALESCE(SUM(amount), 0)  FROM acts    WHERE customer_inn = $1 AND status != 'paid')   AS acts_unpaid_sum,
          (SELECT COALESCE(SUM(total_amount - COALESCE(paid_amount, 0)), 0)
                                            FROM invoices WHERE customer_inn = $1)                       AS invoices_outstanding,
          (SELECT COUNT(*)                  FROM invoices WHERE customer_inn = $1
             AND due_date < NOW() AND COALESCE(paid_amount, 0) < total_amount)                           AS overdue_invoices_cnt
      `, [inn])
    ]);

    const t  = tendersAggRes.rows[0];
    const pt = preTendersRes.rows[0];
    const k  = tkpRes.rows[0];
    const w  = worksRes.rows[0];
    const f  = financeRes.rows[0];

    // Конверсия = выиграли / (выиграли + проиграли)
    const decided = Number(t.won) + Number(t.lost);
    const conversion_pct = decided > 0 ? Math.round(Number(t.won) / decided * 100) : null;

    // Светофор
    let traffic_color, traffic_label, traffic_reason;
    const overdueCnt = Number(f.overdue_invoices_cnt);

    if (Number(t.total) < 3) {
      traffic_color  = 'gray';
      traffic_label  = 'Новый';
      traffic_reason = 'Недостаточно данных (менее 3 тендеров)';
    } else if (conversion_pct >= 40 && overdueCnt === 0) {
      traffic_color  = 'green';
      traffic_label  = 'Надёжный';
      traffic_reason = `Конверсия ${conversion_pct}%, нет просроченных счетов`;
    } else if (overdueCnt >= 2 || (conversion_pct !== null && conversion_pct < 15)) {
      traffic_color  = 'red';
      traffic_label  = 'Высокий риск';
      const parts = [];
      if (overdueCnt >= 2) parts.push(`${overdueCnt} просроч. счетов`);
      if (conversion_pct !== null && conversion_pct < 15) parts.push(`конверсия ${conversion_pct}%`);
      traffic_reason = parts.join(', ');
    } else {
      traffic_color  = 'yellow';
      traffic_label  = 'Средний риск';
      traffic_reason = `Конверсия ${conversion_pct !== null ? conversion_pct + '%' : '—'}${overdueCnt > 0 ? ', есть просрочка' : ''}`;
    }

    return {
      profile: profileRes.rows[0] || null,
      traffic_light: { color: traffic_color, label: traffic_label, reason: traffic_reason },
      tenders: {
        total:        +t.total,
        won:          +t.won,
        lost:         +t.lost,
        cancelled:    +t.cancelled,
        in_work:      +t.in_work,
        won_sum:      +t.won_sum,
        lost_sum:     +t.lost_sum,
        in_work_sum:  +t.in_work_sum,
        conversion_pct,
        last_tender_at: t.last_tender_at,
        by_status: tendersByStatusRes.rows
      },
      pre_tenders: {
        total:     +pt.total,
        accepted:  +pt.accepted,
        rejected:  +pt.rejected,
        in_review: +pt.in_review
      },
      tkp: {
        total:        +k.total,
        accepted:     +k.accepted,
        rejected:     +k.rejected,
        awaiting:     +k.awaiting,
        accepted_sum: +k.accepted_sum
      },
      works: {
        total:       +w.total,
        active:      +w.active,
        completed:   +w.completed,
        total_value: +w.total_value,
        active_value:+w.active_value
      },
      finance: {
        acts_paid_sum:       +f.acts_paid_sum,
        acts_unpaid_sum:     +f.acts_unpaid_sum,
        invoices_outstanding:+f.invoices_outstanding,
        overdue_invoices_cnt: overdueCnt
      },
      last_contact: t.last_tender_at || null
    };
  });

  fastify.delete('/:inn', { preHandler: [fastify.requireRoles(['ADMIN'])] }, async (request, reply) => {
    try {
      const result = await db.query('DELETE FROM customers WHERE inn = $1 RETURNING inn', [request.params.inn]);
      if (!result.rows[0]) return reply.code(404).send({ error: 'Не найден' });
      return { message: 'Удалено' };
    } catch (e) {
      if (e.code === '23503') {
        return reply.code(400).send({ error: 'Невозможно удалить — есть связанные тендеры или другие записи' });
      }
      throw e;
    }
  });
}

module.exports = routes;
