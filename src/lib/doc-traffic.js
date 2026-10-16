'use strict';

/**
 * Ядро светофора Doc Hub — ЕДИНЫЙ источник для списка, KPI, фасетов и карточки.
 * ═══════════════════════════════════════════════════════════════════════════
 * Класс дефекта, который это закрывает: бейдж считался на бэке, бар на фронте
 * по своей логике (`rowClass` в doc-hub.js) — они расходились; не было жёлтого;
 * не было приоритета. Теперь:
 *
 *   trafficSql()  — SQL-выражение для алиаса `d` (список / KPI / фильтр);
 *   trafficOf()   — ТОЧНОЕ зеркало на JS (drawer одной строки, тест паритета).
 *
 * Приоритет: КРАСНЫЙ → СИНИЙ → ЖЁЛТЫЙ → ЗЕЛЁНЫЙ.
 *   • красный — просрочка оплаты / СФ / акта сверки ИЛИ correction_state='requested'
 *   • синий   — is_incomplete (нет обязательных полей)
 *   • жёлтый  — до ближайшего активного дедлайна ≤ doc_yellow_workdays рабочих дней
 *   • зелёный — действий не требуется
 *
 * Дедлайны (ближайший активный):
 *   • ближайший неоплаченный этап payment_schedule[].due_at (только payment_kind='partial'),
 *     иначе payment_due_at, если pay_status НЕ paid/n_a и не стоит no_payment_terms;
 *   • sf_due_at, если СФ ещё не получен (sf_received_at IS NULL) и ops_status ждёт СФ/закрывающие;
 *   • recon_due_at, если акт не получен (recon_received_at IS NULL).
 *   Просрочка = активный дедлайн < сегодня.
 */

const RED = 'red';
const BLUE = 'blue';
const YELLOW = 'yellow';
const GREEN = 'green';

const DEFAULT_YELLOW_WORKDAYS = 5;

/** Активен ли срок оплаты (не закрыт оплатой/«не требуется»). */
function payDeadlineActive(r) {
  if (r.no_payment_terms === true) return false;
  const ps = String(r.pay_status || '').toLowerCase();
  return ps !== 'paid' && ps !== 'n_a';
}

/** Ближайший неоплаченный этап частичного графика (или null). */
function nextScheduleDue(r) {
  if (String(r.payment_kind || '') !== 'partial') return null;
  let sched = r.payment_schedule;
  if (typeof sched === 'string') { try { sched = JSON.parse(sched); } catch (_) { sched = null; } }
  if (!Array.isArray(sched)) return null;
  let best = null;
  for (const st of sched) {
    if (!st || !st.due_at || st.paid_at) continue;
    const d = toYmd(st.due_at);
    if (!d) continue;
    if (!best || d < best) best = d;
  }
  return best;
}

/** Нормализовать дату (Date | ISO | 'YYYY-MM-DD' | ISO с временем) → 'YYYY-MM-DD' | null. */
function toYmd(v) {
  if (v == null) return null;
  if (v instanceof Date) { const s = v.toISOString().slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; }
  const s = String(v);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/**
 * Собрать список активных дедлайнов строки.
 * ТОЧНОЕ зеркало trafficSql(): при payment_kind='partial' дедлайн оплаты берётся
 * ТОЛЬКО из графика (пустой график → дедлайна оплаты нет), а срок СФ учитывается
 * лишь пока ops_status ждёт СФ/закрывающие.
 * @returns {Array<{kind:string,date:string}>}
 */
function activeDeadlines(r) {
  const out = [];
  const isPartial = String(r.payment_kind || '') === 'partial';
  if (isPartial) {
    // ВАЖНО: при partial НЕ проваливаемся на payment_due_at (иначе расходимся с SQL).
    const schedDue = nextScheduleDue(r);
    if (schedDue) out.push({ kind: 'pay', date: schedDue });
  } else {
    const payDue = toYmd(r.payment_due_at);
    if (payDue && payDeadlineActive(r)) out.push({ kind: 'pay', date: payDue });
  }
  const sfDue = toYmd(r.sf_due_at);
  if (sfDue && !r.sf_received_at && ['wait_sf', 'wait_closing'].includes(r.ops_status)) {
    out.push({ kind: 'sf', date: sfDue });
  }
  const reconDue = toYmd(r.recon_due_at);
  if (reconDue && !r.recon_received_at) {
    out.push({ kind: 'recon', date: reconDue });
  }
  return out;
}

/** Рабочих дней от `from` (исключая) до `to` (включая) на JS — зеркало asgard_workdays_until. */
function workdaysBetween(fromYmd, toYmd, calendar) {
  const from = new Date(fromYmd + 'T00:00:00Z');
  const to = new Date(toYmd + 'T00:00:00Z');
  if (to <= from) return 0;
  let n = 0;
  const cur = new Date(from);
  cur.setUTCDate(cur.getUTCDate() + 1);
  while (cur <= to) {
    const ymd = cur.toISOString().slice(0, 10);
    let working;
    if (calendar && Object.prototype.hasOwnProperty.call(calendar, ymd)) {
      working = !!calendar[ymd];
    } else {
      const dow = cur.getUTCDay(); // 0=вс, 6=сб
      working = dow !== 0 && dow !== 6;
    }
    if (working) n += 1;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return n;
}

/**
 * JS-зеркало светофора для одной строки (drawer, тест паритета с SQL).
 * @param {object} r — строка doc_registry (поля как из БД, snake_case)
 * @param {{today?:string, yellowWorkdays?:number, calendar?:object}} opts
 * @returns {{color:string, reason:string, deadline:string|null, kind:string|null}}
 */
function trafficOf(r, opts = {}) {
  if (!r) return { color: GREEN, reason: '', deadline: null, kind: null };
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const yellow = Number.isFinite(opts.yellowWorkdays) ? opts.yellowWorkdays : DEFAULT_YELLOW_WORKDAYS;
  const cal = opts.calendar || null;

  if (String(r.correction_state || '') === 'requested') {
    const kind = r.correction_kind === 'both' ? 'СФ и акт'
      : r.correction_kind === 'act' ? 'АКТ' : 'СФ';
    return { color: RED, reason: `${kind} НЕ КОРРЕКТЕН`, deadline: null, kind: 'correction' };
  }

  const deadlines = activeDeadlines(r);
  deadlines.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const overdue = deadlines.filter((x) => x.date < today);
  if (overdue.length) {
    return { color: RED, reason: `просрочено: ${overdue.map((x) => x.kind).join(', ')}`, deadline: overdue[0].date, kind: overdue[0].kind };
  }

  if (r.is_incomplete === true) {
    return { color: BLUE, reason: 'не заполнены обязательные поля', deadline: null, kind: 'incomplete' };
  }

  const soon = deadlines
    .map((x) => ({ ...x, wd: workdaysBetween(today, x.date, cal) }))
    .filter((x) => x.wd >= 0 && x.wd <= yellow)
    .sort((a, b) => a.wd - b.wd);
  if (soon.length) {
    return { color: YELLOW, reason: `${soon[0].kind}: срок через ${soon[0].wd} раб. дн.`, deadline: soon[0].date, kind: soon[0].kind };
  }

  return { color: GREEN, reason: '', deadline: null, kind: null };
}

/**
 * SQL-выражение светофора для алиаса `d` (doc_registry).
 * Точное зеркало trafficOf(). Возвращает строку-SQL (без параметров: использует
 * только колонки d и функцию asgard_workdays_until; порог жёлтого — константа).
 * @param {string} alias — алиас таблицы doc_registry (по умолчанию 'd')
 * @param {number} yellowWorkdays
 * @returns {string} SQL, вычисляющий color ('red'|'blue'|'yellow'|'green')
 */
function trafficSql(alias = 'd', yellowWorkdays = DEFAULT_YELLOW_WORKDAYS) {
  const a = alias;
  const y = Number.isFinite(yellowWorkdays) ? Math.trunc(yellowWorkdays) : DEFAULT_YELLOW_WORKDAYS;
  // Ближайший неоплаченный этап графика (partial): LATERAL не нужен — подзапрос.
  const schedDue = `(SELECT MIN((e->>'due_at')::date) FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(${a}.payment_schedule)='array' THEN ${a}.payment_schedule ELSE '[]'::jsonb END) e
     WHERE (e->>'due_at') ~ '^\\d{4}-\\d{2}-\\d{2}' AND COALESCE(e->>'paid_at','') = '')`;
  const payActive = `(${a}.no_payment_terms IS NOT TRUE AND COALESCE(${a}.pay_status,'none') NOT IN ('paid','n_a'))`;
  const payDeadline = `CASE WHEN ${a}.payment_kind='partial' THEN ${schedDue}
    WHEN ${a}.payment_due_at IS NOT NULL AND ${payActive} THEN ${a}.payment_due_at::date END`;
  const sfDeadline = `CASE WHEN ${a}.sf_due_at IS NOT NULL AND ${a}.sf_received_at IS NULL
    AND ${a}.ops_status IN ('wait_sf','wait_closing') THEN ${a}.sf_due_at::date END`;
  const reconDeadline = `CASE WHEN ${a}.recon_due_at IS NOT NULL AND ${a}.recon_received_at IS NULL
    THEN ${a}.recon_due_at::date END`;
  const nearest = `LEAST(${payDeadline}, ${sfDeadline}, ${reconDeadline})`;

  return `CASE
    WHEN ${a}.correction_state = 'requested' THEN 'red'
    WHEN ${nearest} < CURRENT_DATE THEN 'red'
    WHEN ${a}.is_incomplete IS TRUE THEN 'blue'
    WHEN ${nearest} IS NOT NULL AND asgard_workdays_until(${nearest}) <= ${y} THEN 'yellow'
    ELSE 'green' END`;
}

/** WHERE-фильтр «просрочка» (для query-параметров overdue_pay/overdue_sf). */
function overduePaySql(alias = 'd') {
  const a = alias;
  return `${a}.payment_due_at IS NOT NULL AND ${a}.payment_due_at::date < CURRENT_DATE
    AND ${a}.no_payment_terms IS NOT TRUE AND COALESCE(${a}.pay_status,'none') NOT IN ('paid','n_a')`;
}
function overdueSfSql(alias = 'd') {
  const a = alias;
  return `${a}.sf_due_at IS NOT NULL AND ${a}.sf_due_at::date < CURRENT_DATE
    AND ${a}.sf_received_at IS NULL AND ${a}.ops_status IN ('wait_sf','wait_closing')`;
}

module.exports = {
  RED, BLUE, YELLOW, GREEN,
  DEFAULT_YELLOW_WORKDAYS,
  activeDeadlines,
  payDeadlineActive,
  nextScheduleDue,
  workdaysBetween,
  trafficOf,
  trafficSql,
  overduePaySql,
  overdueSfSql,
};
