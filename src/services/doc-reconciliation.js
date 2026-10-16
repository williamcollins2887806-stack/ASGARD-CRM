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
 * @param {object} db — pg pool/query
 * @param {{inn?:string, name?:string, year:number, quarter:number}} args
 */
async function buildReconciliation(db, { inn, name, year, quarter }) {
  const { from, to } = periodRange(year, quarter);
  const params = [from, to];
  let where = `WHERE d.deleted_at IS NULL AND d.dir = 'in'
    AND COALESCE(d.invoice_date, d.service_done_at) BETWEEN $1::date AND $2::date`;
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
  const docs = rows.map((r) => {
    const gross = Number(r.amount_gross) || 0;
    const paid = ['paid', 'n_a'].includes(String(r.pay_status || ''));
    docsSum += gross;
    if (paid) paidSum += gross;
    return {
      id: r.id, invoice_number: r.invoice_number, invoice_date: r.invoice_date,
      service_done_at: r.service_done_at, amount: gross, paid,
      sf_received: !!r.sf_received_at, currency: r.currency || 'RUB',
      included: paid || !!r.service_done_at
    };
  }).filter((d) => d.included);

  return {
    period: { year: Number(year), quarter: Number(quarter), ...periodRange(year, quarter) },
    due_at: periodDeadline(year, quarter),
    docs, paidSum, docsSum, balanceRub: Math.round((paidSum - docsSum) * 100) / 100,
    note: 'Предварительный расчёт — подтверждает контрагент файлом акта.'
  };
}

module.exports = { periodRange, periodDeadline, buildReconciliation };
