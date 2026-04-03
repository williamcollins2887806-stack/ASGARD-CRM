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
