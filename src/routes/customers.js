/**
 * Customers Routes
 */
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

  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { inn, name, ...rest } = request.body;
    if (!inn || !name) return reply.code(400).send({ error: 'ИНН и наименование обязательны' });

    const data = { inn, name, ...rest, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    const keys = Object.keys(data);
    const values = Object.values(data);

    // Use upsert to handle re-adding deleted customers
    const updateParts = keys.filter(k => k !== 'inn' && k !== 'created_at').map((k, i) => `${k} = EXCLUDED.${k}`);
    const sql = `
      INSERT INTO customers (${keys.join(', ')})
      VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})
      ON CONFLICT (inn) DO UPDATE SET ${updateParts.join(', ')}
      RETURNING *
    `;
    const result = await db.query(sql, values);
    return { customer: result.rows[0] };
  });

  fastify.put('/:inn', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { inn } = request.params;
    const data = request.body;
    const updates = [];
    const values = [];
    let idx = 1;
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined && key !== 'inn') { updates.push(`${key} = $${idx}`); values.push(value); idx++; }
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
    const result = await db.query('DELETE FROM customers WHERE inn = $1 RETURNING inn', [request.params.inn]);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Не найден' });
    return { message: 'Удалено' };
  });
}

module.exports = routes;
