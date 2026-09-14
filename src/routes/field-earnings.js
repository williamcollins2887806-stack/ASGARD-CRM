'use strict';

/**
 * Field Earnings API
 * GET /monthly — помесячная разбивка заработка рабочего
 */

const MONTH_NAMES = [
  '', 'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

async function routes(fastify) {
  const db = fastify.db;
  const auth = { preHandler: [fastify.fieldAuthenticate] };

  // ─────────────────────────────────────────────────────────────────────────
  // GET /monthly
  // Возвращает помесячную разбивку: FOT смены, суточные, выплаты, к выплате
  // Суточные НЕ смешиваются с FOT — отдельные строки
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get('/monthly', auth, async (req) => {
    const empId = req.fieldEmployee.id;

    // 1. Сменный заработок (FOT) — checkins + stages
    const { rows: shiftRows } = await db.query(`
      SELECT year, month, SUM(fot)::numeric AS fot, SUM(shifts_count)::int AS shifts_count
      FROM (
        SELECT
          EXTRACT(YEAR  FROM date)::int AS year,
          EXTRACT(MONTH FROM date)::int AS month,
          COALESCE(SUM(amount_earned), 0)::numeric AS fot,
          COUNT(*)::int AS shifts_count
        FROM field_checkins
        WHERE employee_id = $1 AND status = 'completed'
        GROUP BY 1, 2
        UNION ALL
        SELECT
          EXTRACT(YEAR  FROM date_from)::int AS year,
          EXTRACT(MONTH FROM date_from)::int AS month,
          COALESCE(SUM(amount_earned), 0)::numeric AS fot,
          COUNT(*)::int AS shifts_count
        FROM field_trip_stages
        WHERE employee_id = $1
          AND COALESCE(status, 'active') IN ('active', 'completed', 'approved', 'adjusted')
        GROUP BY 1, 2
      ) x
      GROUP BY year, month
    `, [empId]);

    // 2. Суточные — единый хелпер
    const { getPerDiemDays } = require('../lib/worker-per-diem-days');
    const pdAll = await getPerDiemDays(db, empId, {});
    const pdByMonth = new Map();
    for (const d of pdAll.days) {
      const dt = new Date(d.day);
      const y = dt.getUTCFullYear();
      const m = dt.getUTCMonth() + 1;
      const key = `${y}-${m}`;
      if (!pdByMonth.has(key)) pdByMonth.set(key, { year: y, month: m, per_diem_accrued: 0, per_diem_days: 0 });
      const row = pdByMonth.get(key);
      row.per_diem_days += 1;
      // 0 — валидная ставка («суточные выключены»)
      const r = Number(d.rate);
      row.per_diem_accrued += Number.isFinite(r) && r >= 0 ? r : pdAll.default_rate;
    }
    const pdRows = [...pdByMonth.values()];

    // 3. Выплаченные суммы — группируем по расчётному периоду (pay_year/pay_month)
    //    Аванс, зарплата, суточные оплаченные, бонусы — все по отдельности
    const { rows: payRows } = await db.query(`
      SELECT
        COALESCE(pay_year,  EXTRACT(YEAR  FROM created_at)::int) AS year,
        COALESCE(pay_month, EXTRACT(MONTH FROM created_at)::int) AS month,
        type,
        COALESCE(SUM(amount), 0)::numeric AS amount
      FROM worker_payments
      WHERE employee_id = $1
        AND status IN ('paid', 'confirmed')
      GROUP BY 1, 2, 3
    `, [empId]);

    // --- Сборка в карту по (year, month) ---
    const map = new Map();

    function getOrCreate(y, m) {
      const key = `${y}-${m}`;
      if (!map.has(key)) {
        map.set(key, {
          year: y, month: m,
          fot: 0, shifts_count: 0,
          per_diem_accrued: 0, per_diem_days: 0,
          salary_paid: 0, advance_paid: 0,
          per_diem_paid: 0, bonus_paid: 0,
        });
      }
      return map.get(key);
    }

    for (const r of shiftRows) {
      const m = getOrCreate(r.year, r.month);
      m.fot          = parseFloat(r.fot);
      m.shifts_count = r.shifts_count;
    }
    for (const r of pdRows) {
      const m = getOrCreate(r.year, r.month);
      m.per_diem_accrued = parseFloat(r.per_diem_accrued);
      m.per_diem_days    = r.per_diem_days;
    }
    for (const r of payRows) {
      const m = getOrCreate(r.year, r.month);
      const amt = parseFloat(r.amount);
      if (r.type === 'salary')   m.salary_paid   += amt;
      if (r.type === 'advance')  m.advance_paid  += amt;
      if (r.type === 'per_diem') m.per_diem_paid += amt;
      if (r.type === 'bonus')    m.bonus_paid    += amt;
    }

    // --- Финальный расчёт статусов ---
    const now = new Date();

    const months = [...map.values()]
      .sort((a, b) => b.year !== a.year ? b.year - a.year : b.month - a.month)
      .map(m => {
        const total_earned = m.fot + m.per_diem_accrued;
        const total_paid   = m.salary_paid + m.advance_paid + m.per_diem_paid + m.bonus_paid;
        const to_pay       = Math.max(0, Math.round(total_earned - total_paid));

        // Выплата зарплаты: 10–15 числе следующего месяца
        const payMonth = m.month === 12 ? 1 : m.month + 1;
        const payYear  = m.month === 12 ? m.year + 1 : m.year;
        const windowStart = new Date(payYear, payMonth - 1, 10);
        const windowEnd   = new Date(payYear, payMonth - 1, 15, 23, 59, 59);

        let payment_status;
        if (to_pay === 0 && total_earned > 0) {
          payment_status = 'paid';
        } else if (now < windowStart) {
          payment_status = 'upcoming';
        } else if (now <= windowEnd) {
          payment_status = 'in_window';
        } else {
          payment_status = 'overdue';
        }

        return {
          year:   m.year,
          month:  m.month,
          month_name: MONTH_NAMES[m.month],

          fot:            Math.round(m.fot),
          shifts_count:   m.shifts_count,

          per_diem_accrued: Math.round(m.per_diem_accrued),
          per_diem_days:    m.per_diem_days,

          salary_paid:   Math.round(m.salary_paid),
          advance_paid:  Math.round(m.advance_paid),
          per_diem_paid: Math.round(m.per_diem_paid),
          bonus_paid:    Math.round(m.bonus_paid),
          total_paid:    Math.round(total_paid),

          total_earned:  Math.round(total_earned),
          to_pay,

          payment_status,
          pay_window: `10–15 ${MONTH_NAMES[payMonth]} ${payYear}`,
        };
      });

    return { months };
  });
}

module.exports = routes;
