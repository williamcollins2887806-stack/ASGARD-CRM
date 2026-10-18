'use strict';

/**
 * Акты сверки (V394) — расчёт кандидатов и баланса по контрагенту/периоду.
 * ═══════════════════════════════════════════════════════════════════════════
 * Регламент ASGARD (настройка, не хардкод):
 *   • квартальный акт — до 10-го числа следующего месяца;
 *   • годовой — до 15 января.
 * В акт входят документы, по которым ЕСТЬ оплата ИЛИ оказана услуга
 * (service_done_at не пусто), за нужный период. Баланс:
 *   Σ наших оплат − Σ их документов.  >0 — в нашу пользу, <0 — мы должны.
 * Знак и пометка «предварительный расчёт» — обязательны: акт подтверждает
 * контрагент файлом, система сама PDF не формирует.
 */

/** Начало/конец квартала или года. quarter=0 → годовой. */
function periodRange(year, quarter) {
  const y = Number(year);
  const q = Number(quarter) || 0;
  if (q === 0) return { from: `${y}-01-01`, to: `${y}-12-31` };
  const fromMonth = (q - 1) * 3 + 1;
  const toMonth = fromMonth + 2;
  const lastDay = new Date(Date.UTC(y, toMonth, 0)).getUTCDate();
  const mm = (m) => String(m).padStart(2, '0');
  return { from: `${y}-${mm(fromMonth)}-01`, to: `${y}-${mm(toMonth)}-${String(lastDay).padStart(2, '0')}` };
}

/** Дедлайн акта: квартал — 10-е следующего месяца; год — 15 января. */
function periodDeadline(year, quarter, opts = {}) {
  const day = Number.isFinite(opts.quarterDay) ? opts.quarterDay : 10;
  const yearDeadline = opts.yearDeadline || '01-15';
  const y = Number(year);
  const q = Number(quarter) || 0;
  if (q === 0) return `${y + 1}-${yearDeadline}`;
  const nextMonth = q * 3 + 1;
  const yy = nextMonth > 12 ? y + 1 : y;
  const mm = nextMonth > 12 ? nextMonth - 12 : nextMonth;
  return `${yy}-${String(mm).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Кандидаты в акт: документы контрагента за период, где есть оплата
 * либо оказанная услуга. Возвращает { docs, paidSum, docsSum, balanceRub }.
 * ВАЖНО (верификатор 17.10): матрица видимости применяется ЗДЕСЬ — внутри,
 * после базовых params [from,to], чтобы нумерация $N не конфликтовала
 * (иначе снова класс «there is no parameter $1»). Без неё деталь отдавала
 * чужие суммы любому PM — список фильтровался, а деталь нет.
 * @param {object} db — pg pool/query
 * @param {{inn?:string, name?:string, year:number, quarter:number,
 *          role?:string, userId?:number, scope?:string}} args
 */
async function buildReconciliation(db, { inn, name, year, quarter, role, userId, scope, actId }) {
  const { from, to } = periodRange(year, quarter);
  const params = [from, to];
  let where = `WHERE d.deleted_at IS NULL AND d.dir = 'in'
    AND COALESCE(d.invoice_date, d.service_done_at) BETWEEN $1::date AND $2::date`;
  // Матрица видимости — если переданы роль/пользователь.
  if (role && userId != null) {
    const { visibilitySql } = require('../lib/doc-visibility');
    where += visibilitySql(params, role, userId, { scope });
  }
  if (inn) { params.push(inn); where += ` AND d.counterparty_inn = $${params.length}`; }
  else if (name) { params.push(String(name).trim().toLowerCase()); where += ` AND lower(trim(d.counterparty_name)) = $${params.length}`; }
  else throw Object.assign(new Error('Нужен ИНН или название контрагента'), { statusCode: 400 });

  const { rows } = await db.query(
    `SELECT d.id, d.invoice_number, d.invoice_date, d.service_done_at, d.amount_gross,
            d.pay_status, d.sf_received_at, d.ops_status, d.currency, d.amount_currency
       FROM doc_registry d ${where}
      ORDER BY d.invoice_date NULLS LAST, d.id`, params);

  let paidSum = 0;
  let docsSum = 0;
  // ВАЖНО (верификатор 17.10): суммируем ТОЛЬКО включённые документы (оплата или
  // оказанная услуга). Раньше docsSum копился до .filter(included), из-за чего в
  // деталь попадали неоплаченные счета без услуги — баланс детали расходился со
  // списком (деталь: «мы должны 999 999», список: «сошлось»).
  const docs = [];
  for (const r of rows) {
    const gross = Number(r.amount_gross) || 0;
    const paid = ['paid', 'n_a'].includes(String(r.pay_status || ''));
    const included = paid || !!r.service_done_at;
    if (!included) continue;
    docsSum += gross;
    if (paid) paidSum += gross;
    docs.push({
      id: r.id, invoice_number: r.invoice_number, invoice_date: r.invoice_date,
      service_done_at: r.service_done_at, amount: gross, paid,
      sf_received: !!r.sf_received_at, currency: r.currency || 'RUB',
      included: true
    });
  }

  // Взаимозачёты: если акт уже сохранён, подтягиваем ручные корректировки и
  // учитываем их в балансе (баланс = оплаты − документы + корректировки).
  let adjustments = [];
  if (actId) {
    try {
      const a = await db.query(`SELECT manual_adjustments FROM doc_reconciliation_acts WHERE id=$1`, [actId]);
      if (a.rows[0] && Array.isArray(a.rows[0].manual_adjustments)) adjustments = a.rows[0].manual_adjustments;
    } catch (_) { /* необязательно */ }
  }
  const baseBalance = Math.round((paidSum - docsSum) * 100) / 100;
  const balanceRub = Math.round((baseBalance + adjustments.reduce((s, x) => s + (Number(x && x.amount) || 0), 0)) * 100) / 100;

  return {
    period: { year: Number(year), quarter: Number(quarter), ...periodRange(year, quarter) },
    due_at: periodDeadline(year, quarter),
    docs, paidSum, docsSum, adjustments, baseBalance, balanceRub,
    note: 'Предварительный расчёт — подтверждает контрагент файлом акта.'
  };
}

/**
 * Знак баланса для акта: Σ оплат − Σ документов + взаимозачёты.
 * Взаимозачёты (manual_adjustments) — ручные корректировки от бухгалтерии:
 *   [{ amount: number, note: string, at: ISO, by: userId }], amount может быть
 *   отрицательным (наше обязательство растёт). Знак сохраняем как есть.
 */
function applyAdjustments(base, adjustments) {
  const list = Array.isArray(adjustments) ? adjustments : [];
  const delta = list.reduce((s, a) => s + (Number(a && a.amount) || 0), 0);
  return Math.round((Number(base || 0) + delta) * 100) / 100;
}

module.exports = { periodRange, periodDeadline, buildReconciliation, applyAdjustments };
