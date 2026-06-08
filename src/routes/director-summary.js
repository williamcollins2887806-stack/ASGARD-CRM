'use strict';

/**
 * Director Summary — единый агрегат «сводка года» для командной карты директора.
 * Реюз источников: works (contract_value/cost_plan/cost_fact), tenders, invoices,
 * employees + se_transfers (самозанятые), field_checkins (на смене). Кэш 60с.
 * Только показываем то, что реально есть в БД — ничего не выдумываем.
 */

module.exports = async function (fastify, options) {
  const db = fastify.db;

  const ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_PM', 'HEAD_TO'];
  const ACTIVE_STATUSES = ['В работе', 'Мобилизация', 'Подготовка', 'На паузе', 'Подписание акта'];

  const _cache = {}; // year -> { at, data }

  async function getSetting(key, fallback) {
    try {
      const { rows: [r] } = await db.query('SELECT value_json FROM settings WHERE key = $1', [key]);
      if (!r) return fallback;
      const v = parseFloat(String(r.value_json).replace(/[^\d.\-]/g, ''));
      return Number.isFinite(v) ? v : fallback;
    } catch (_) { return fallback; }
  }

  const mln = v => +(Number(v || 0) / 1e6).toFixed(1);

  async function build(year) {
    // ── P&L из works ──
    const { rows: [wf] } = await db.query(`
      SELECT
        COUNT(*) AS projects,
        COALESCE(SUM(contract_value), 0) AS revenue,
        COALESCE(SUM(cost_plan), 0)      AS cost_plan,
        COALESCE(SUM(cost_fact), 0)      AS cost_fact,
        COALESCE(SUM(advance_received), 0) AS advances
      FROM works
      WHERE EXTRACT(YEAR FROM COALESCE(start_date, created_at)) = $1
    `, [year]).catch(() => ({ rows: [{}] }));

    const revenue = Number(wf.revenue || 0);
    const costPlan = Number(wf.cost_plan || 0);
    const costFact = Number(wf.cost_fact || 0);
    const gross = revenue - costFact;

    // ── Деньги: invoices (получено/дебиторка/просрочка) ──
    const { rows: [inv] } = await db.query(`
      SELECT
        COALESCE(SUM(paid_amount), 0) AS received,
        COALESCE(SUM(total_amount) - SUM(paid_amount), 0) AS receivable,
        COALESCE(SUM(CASE WHEN status NOT IN ('paid','cancelled') AND due_date < CURRENT_DATE
                          THEN total_amount - paid_amount ELSE 0 END), 0) AS overdue
      FROM invoices
    `).catch(() => ({ rows: [{}] }));

    // ── Самозанятые ──
    const yearLimitPer = await getSetting('self_employed_yearly_limit', 2400000);
    const { rows: seRows } = await db.query(`
      SELECT e.id, e.fio,
        COALESCE(SUM(t.transfer_amount) FILTER (WHERE t.status != 'cancelled'), 0) AS used
      FROM employees e
      LEFT JOIN se_transfers t ON t.employee_id = e.id AND t.year = $1
      WHERE e.is_self_employed = true AND e.is_active = true
      GROUP BY e.id, e.fio
      ORDER BY used DESC
    `, [year]).catch(() => ({ rows: [] }));
    const seCount = seRows.length;
    const seUsed = seRows.reduce((a, r) => a + Number(r.used || 0), 0);
    const seLimit = seCount * yearLimitPer;
    const seTop = seRows.slice(0, 6).map(r => ({ fio: r.fio, used: mln(r.used) }));

    // ── Тендеры ──
    const { rows: [tn] } = await db.query(`
      SELECT
        COUNT(*) AS submitted,
        COUNT(*) FILTER (WHERE tender_status = 'Выиграли') AS won,
        COUNT(*) FILTER (WHERE tender_status = 'Проиграли') AS lost,
        COUNT(*) FILTER (WHERE tender_status IN ('В работе','Подача','Расчёт','Ожидание')) AS active,
        COALESCE(SUM(tender_price) FILTER (WHERE tender_status = 'Выиграли'), 0) AS won_sum
      FROM tenders
      WHERE EXTRACT(YEAR FROM created_at) = $1
    `, [year]).catch(() => ({ rows: [{}] }));
    const won = Number(tn.won || 0), lost = Number(tn.lost || 0);
    const conv = (won + lost) > 0 ? Math.round(won / (won + lost) * 100) : 0;

    // ── Люди ──
    const { rows: [pp] } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE is_active) AS headcount,
        COUNT(*) FILTER (WHERE is_active AND is_self_employed) AS self_emp
      FROM employees
    `).catch(() => ({ rows: [{}] }));
    const { rows: [onsh] } = await db.query(`
      SELECT COUNT(DISTINCT employee_id) AS on_shift
      FROM field_checkins WHERE date = CURRENT_DATE AND status = 'active'
    `).catch(() => ({ rows: [{}] }));

    // ── Объекты (активные работы, на смене) ──
    const { rows: siteRows } = await db.query(`
      SELECT s.name,
        COALESCE(SUM(CASE WHEN ea.field_role = 'worker' THEN 1 ELSE 0 END), 0) AS workers,
        (SELECT COUNT(DISTINCT fc.employee_id) FROM field_checkins fc
           JOIN works w2 ON w2.id = fc.work_id
          WHERE w2.site_id = s.id AND fc.date = CURRENT_DATE AND fc.status='active') AS on_shift
      FROM sites s
      LEFT JOIN works w ON w.site_id = s.id AND w.work_status = ANY($1)
      LEFT JOIN employee_assignments ea ON ea.work_id = w.id AND ea.is_active = true
        AND (ea.departure_date IS NULL OR ea.departure_date > CURRENT_DATE)
      GROUP BY s.id, s.name
      HAVING COUNT(w.id) > 0
      ORDER BY workers DESC
      LIMIT 30
    `, [ACTIVE_STATUSES]).catch(() => ({ rows: [] }));

    return {
      year,
      pnl: {
        projects: Number(wf.projects || 0),
        revenue: mln(revenue), costPlan: mln(costPlan), costFact: mln(costFact),
        gross: mln(gross),
        grossPct: revenue > 0 ? +(gross / revenue * 100).toFixed(1) : 0,
        costSave: mln(costPlan - costFact)
      },
      cash: {
        received: mln(inv.received), receivable: mln(inv.receivable),
        overdue: mln(inv.overdue), advances: mln(wf.advances)
      },
      selfEmployed: {
        count: seCount, perLimit: mln(yearLimitPer),
        yearLimit: mln(seLimit), used: mln(seUsed), left: mln(seLimit - seUsed),
        utilPct: seLimit > 0 ? Math.round(seUsed / seLimit * 100) : 0,
        top: seTop
      },
      tenders: {
        submitted: Number(tn.submitted || 0), won, lost,
        active: Number(tn.active || 0), conv, wonSum: mln(tn.won_sum)
      },
      people: {
        headcount: Number(pp.headcount || 0),
        selfEmp: Number(pp.self_emp || 0),
        onShift: Number(onsh.on_shift || 0)
      },
      sites: siteRows.map(r => ({
        name: r.name, workers: Number(r.workers || 0), onShift: Number(r.on_shift || 0)
      }))
    };
  }

  fastify.get('/', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    try {
      const year = parseInt(request.query.year, 10) || new Date().getFullYear();
      const c = _cache[year];
      if (c && (Date.now() - c.at) < 60000) return c.data;
      const data = await build(year);
      _cache[year] = { at: Date.now(), data };
      return data;
    } catch (e) {
      request.log.error(e);
      reply.code(500);
      return { error: 'director_summary_failed', message: e.message };
    }
  });
};
