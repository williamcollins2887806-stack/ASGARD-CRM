/**
 * Incomes Routes
 */

// ═══════════════════════════════════════════════════════════════════════════
// SECURITY: Ролевой контроль для финансовых операций (HIGH-9)
// ═══════════════════════════════════════════════════════════════════════════
const WRITE_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'PM', 'BUH'];

async function routes(fastify, options) {
  const db = fastify.db;

  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { work_id, type, date_from, date_to, limit = 100, offset = 0 } = request.query;
    let sql = 'SELECT i.*, w.work_number FROM incomes i LEFT JOIN works w ON i.work_id = w.id WHERE 1=1';
    const params = [];
    let idx = 1;
    if (work_id) { sql += ` AND i.work_id = $${idx}`; params.push(work_id); idx++; }
    if (type) { sql += ` AND i.type = $${idx}`; params.push(type); idx++; }
    if (date_from) { sql += ` AND i.date >= $${idx}`; params.push(date_from); idx++; }
    if (date_to) { sql += ` AND i.date <= $${idx}`; params.push(date_to); idx++; }
    sql += ` ORDER BY i.date DESC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limit, offset);
    const result = await db.query(sql, params);
    return { incomes: result.rows };
  });

  // SECURITY: Только WRITE_ROLES (HIGH-9)
  fastify.post('/', { preHandler: [fastify.requireRoles(WRITE_ROLES)] }, async (request, reply) => {
    try {
      // Filter to allowed DB columns only to prevent crash on unknown columns
      const allowedCols = ['work_id', 'amount', 'date', 'description', 'type'];
      const raw = request.body || {};
      const data = { created_by: request.user.id, created_at: new Date().toISOString() };
      for (const k of allowedCols) {
        if (raw[k] !== undefined) data[k] = raw[k];
      }
      const keys = Object.keys(data);
      const values = Object.values(data);
      const sql = `INSERT INTO incomes (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`;
      const result = await db.query(sql, values);
      return { income: result.rows[0] };
    } catch (err) {
      const code = err.code === '23502' || err.code === '22001' || err.code === '42703' ? 400 : 500;
      return reply.code(code).send({ error: 'Ошибка создания записи', detail: err.message });
    }
  });

  // SECURITY: Только WRITE_ROLES (HIGH-9)
  const ALLOWED_COLS_INCOMES = new Set(['work_id', 'type', 'amount', 'date', 'counterparty', 'description', 'document_number', 'source', 'comment', 'confirmed', 'invoice_id']);

  fastify.put('/:id', { preHandler: [fastify.requireRoles(WRITE_ROLES)] }, async (request, reply) => {
    const { id } = request.params;
    const raw = request.body;
    const updates = [];
    const values = [];
    let idx = 1;
    for (const [key, value] of Object.entries(raw)) {
      if (value !== undefined && ALLOWED_COLS_INCOMES.has(key)) { updates.push(`${key} = $${idx}`); values.push(value); idx++; }
    }
    updates.push('updated_at = NOW()');
    values.push(id);
    const sql = `UPDATE incomes SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`;
    const result = await db.query(sql, values);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Не найден' });
    return { income: result.rows[0] };
  });

  // SECURITY: Только WRITE_ROLES (HIGH-9)
  fastify.delete('/:id', { preHandler: [fastify.requireRoles(WRITE_ROLES)] }, async (request, reply) => {
    const result = await db.query('DELETE FROM incomes WHERE id = $1 RETURNING id', [request.params.id]);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Не найден' });
    return { message: 'Удалено' };
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /from-sms — создать поступление из распознанной банковской SMS
  // Используется на странице /v2/telegram (вкладка «Парсер SMS», SmsParser.jsx).
  // Парсинг идёт на клиенте (BANK_SMS_PATTERNS), бэкенд только сохраняет.
  // RBAC: финансовые роли.
  // ═══════════════════════════════════════════════════════════════════════════
  const SMS_ROLES = ['ADMIN', 'BUH', 'DIRECTOR_GEN', 'DIRECTOR_COMM'];

  fastify.post('/from-sms', { preHandler: [fastify.requireRoles(SMS_ROLES)] }, async (request, reply) => {
    try {
      const { sms_text, parsed, work_id } = request.body || {};
      const p = parsed || {};
      const amount = Number(p.amount);
      if (!isFinite(amount) || amount <= 0) {
        return reply.code(400).send({ error: 'Не указана сумма поступления' });
      }

      // Дата: из parsed.date (если распознали), иначе сегодня.
      let date = p.date;
      if (!date || isNaN(Date.parse(date))) {
        date = new Date().toISOString().slice(0, 10);
      } else {
        date = new Date(date).toISOString().slice(0, 10);
      }

      // Описание собираем из отправителя + комментария + исходного SMS (для аудита).
      const parts = [];
      if (p.sender) parts.push(`От: ${String(p.sender).trim()}`);
      if (p.comment) parts.push(String(p.comment).trim());
      if (sms_text) parts.push(`SMS: ${String(sms_text).trim().slice(0, 500)}`);
      const description = parts.join(' · ') || 'Поступление из SMS';

      const data = {
        amount,
        date,
        description,
        type: 'sms',
        created_by: request.user.id,
        created_at: new Date().toISOString(),
      };
      if (work_id) data.work_id = Number(work_id);

      const keys = Object.keys(data);
      const values = Object.values(data);
      const sql = `INSERT INTO incomes (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`;
      const result = await db.query(sql, values);
      return { income: result.rows[0] };
    } catch (err) {
      const code = err.code === '23502' || err.code === '22001' || err.code === '42703' ? 400 : 500;
      return reply.code(code).send({ error: 'Ошибка создания поступления из SMS', detail: err.message });
    }
  });
}

module.exports = routes;
