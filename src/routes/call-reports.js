'use strict';

/**
 * ASGARD CRM — API маршруты аналитики звонков
 *
 * GET  /              — список отчётов (пагинация, фильтр)
 * GET  /:id           — детали отчёта
 * POST /generate      — ручная генерация
 * GET  /schedule      — расписание (ADMIN)
 * PUT  /schedule/:id  — обновить расписание (ADMIN)
 */

const CallReportGenerator = require('../services/call-report-generator');

const REPORT_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

async function routes(fastify, options) {
  const db = fastify.db;

  // GET / — Список отчётов
  fastify.get('/', {
    preHandler: [fastify.requireRoles(REPORT_ROLES)]
  }, async (request) => {
    const { type, limit = 20, offset = 0 } = request.query;
    let sql = 'SELECT id, report_type, period_from, period_to, title, generated_by, created_at FROM call_reports WHERE 1=1';
    const params = [];
    let idx = 1;

    if (type) {
      sql += ` AND report_type = $${idx++}`;
      params.push(type);
    }

    sql += ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(Math.min(parseInt(limit), 100), parseInt(offset));

    const { rows } = await db.query(sql, params);

    const countRes = await db.query('SELECT COUNT(*) as total FROM call_reports' + (type ? ' WHERE report_type = $1' : ''), type ? [type] : []);

    return { items: rows, total: parseInt(countRes.rows[0]?.total || 0) };
  });

  // GET /:id — Детали отчёта + ставим viewed_at
  fastify.get('/:id', {
    preHandler: [fastify.requireRoles(REPORT_ROLES)]
  }, async (request, reply) => {
    const { rows } = await db.query('SELECT * FROM call_reports WHERE id = $1', [request.params.id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Отчёт не найден' });

    // Отмечаем как просмотренный
    if (rows[0] && !rows[0].viewed_at) {
      await db.query(
        'UPDATE call_reports SET viewed_at = NOW(), viewed_by = $1 WHERE id = $2 AND viewed_at IS NULL',
        [request.user.id, request.params.id]
      );
    }

    return { item: rows[0] };
  });

  // POST /generate — Ручная генерация
  fastify.post('/generate', {
    preHandler: [fastify.requireRoles(REPORT_ROLES)]
  }, async (request, reply) => {
    const { report_type = 'daily', date_from, date_to } = request.body;

    if (!['daily', 'weekly', 'monthly'].includes(report_type)) {
      return reply.code(400).send({ error: 'Тип отчёта: daily, weekly, monthly' });
    }

    // Даты по умолчанию
    const now = new Date();
    let dateFrom = date_from;
    let dateTo = date_to;

    if (!dateFrom || !dateTo) {
      switch (report_type) {
        case 'daily': {
          const yesterday = new Date(now);
          yesterday.setDate(yesterday.getDate() - 1);
          dateFrom = dateFrom || yesterday.toISOString().slice(0, 10);
          dateTo = dateTo || dateFrom;
          break;
        }
        case 'weekly': {
          const weekAgo = new Date(now);
          weekAgo.setDate(weekAgo.getDate() - 7);
          dateFrom = dateFrom || weekAgo.toISOString().slice(0, 10);
          dateTo = dateTo || new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
          break;
        }
        case 'monthly': {
          const monthAgo = new Date(now);
          monthAgo.setMonth(monthAgo.getMonth() - 1);
          dateFrom = dateFrom || monthAgo.toISOString().slice(0, 10);
          dateTo = dateTo || new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
          break;
        }
      }
    }

    let aiProvider = null;
    try { aiProvider = require('../services/ai-provider'); } catch (_) {}

    const generator = new CallReportGenerator(db, aiProvider);
    const report = await generator.generate(report_type, dateFrom, dateTo, request.user.id);

    return { success: true, item: report };
  });

  // GET /dashboard — Сводные данные для дашборда
  fastify.get('/dashboard', {
    preHandler: [fastify.requireRoles(REPORT_ROLES)]
  }, async () => {
    // Последний отчёт
    const lastReport = await db.query(
      'SELECT summary_text, stats_json FROM call_reports ORDER BY created_at DESC LIMIT 1'
    );
    let stats = {};
    let latestSummary = '';
    if (lastReport.rows[0]) {
      try {
        stats = typeof lastReport.rows[0].stats_json === 'string'
          ? JSON.parse(lastReport.rows[0].stats_json)
          : (lastReport.rows[0].stats_json || {});
      } catch (_) {}
      latestSummary = (lastReport.rows[0].summary_text || '').slice(0, 400);
    }
    stats.latestSummary = latestSummary;

    // Chart data — последние 14 дней
    const chartRes = await db.query(`
      SELECT
        created_at::date as day,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE ai_is_target = true) as target,
        COUNT(*) FILTER (WHERE call_type = 'inbound' AND duration_seconds < 5) as missed
      FROM call_history
      WHERE created_at >= CURRENT_DATE - INTERVAL '14 days'
      GROUP BY created_at::date
      ORDER BY day
    `);

    const chartData = chartRes.rows.map(r => ({
      label: new Date(r.day).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }),
      total: parseInt(r.total) || 0,
      target: parseInt(r.target) || 0,
      missed: parseInt(r.missed) || 0
    }));

    // Непросмотренный отчёт
    const unviewedRes = await db.query(
      "SELECT id, title, report_type, created_at FROM call_reports WHERE viewed_at IS NULL ORDER BY created_at DESC LIMIT 1"
    );
    const unviewedReport = unviewedRes.rows[0] || null;

    // Последние инсайты
    let latestInsights = [];
    let latestAttention = [];
    try {
      const insightsRes = await db.query(
        "SELECT insights, attention_items FROM call_reports WHERE insights IS NOT NULL AND insights != '[]'::jsonb ORDER BY created_at DESC LIMIT 1"
      );
      if (insightsRes.rows[0]) {
        latestInsights = insightsRes.rows[0].insights || [];
        latestAttention = insightsRes.rows[0].attention_items || [];
      }
    } catch (_) {}

    return { stats, chartData, unviewedReport, insights: latestInsights, attentionItems: latestAttention };
  });

  // GET /schedule — Персональные настройки текущего пользователя
  fastify.get('/schedule', {
    preHandler: [fastify.requireRoles(REPORT_ROLES)]
  }, async (request) => {
    const userId = request.user.id;
    const { rows } = await db.query(
      'SELECT report_type, is_enabled, via_crm, via_huginn, via_email FROM call_report_user_prefs WHERE user_id = $1',
      [userId]
    );

    const prefs = {};
    for (const r of rows) prefs[r.report_type] = r;

    return {
      daily:   prefs.daily   || { is_enabled: true, via_crm: true, via_huginn: true, via_email: true },
      weekly:  prefs.weekly  || { is_enabled: true, via_crm: true, via_huginn: true, via_email: true },
      monthly: prefs.monthly || { is_enabled: true, via_crm: true, via_huginn: true, via_email: true },
    };
  });

  // PUT /schedule — Сохранить настройки
  fastify.put('/schedule', {
    preHandler: [fastify.requireRoles(REPORT_ROLES)]
  }, async (request) => {
    const userId = request.user.id;
    const { daily, weekly, monthly } = request.body || {};

    for (const [type, prefs] of Object.entries({ daily, weekly, monthly })) {
      if (!prefs) continue;
      await db.query(`
        INSERT INTO call_report_user_prefs (user_id, report_type, is_enabled, via_crm, via_huginn, via_email, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        ON CONFLICT (user_id, report_type) DO UPDATE SET
          is_enabled = EXCLUDED.is_enabled,
          via_crm = EXCLUDED.via_crm,
          via_huginn = EXCLUDED.via_huginn,
          via_email = EXCLUDED.via_email,
          updated_at = NOW()
      `, [userId, type,
          prefs.is_enabled !== false,
          prefs.via_crm !== false,
          prefs.via_huginn !== false,
          prefs.via_email !== false]);
    }

    return { success: true };
  });
}

module.exports = routes;
