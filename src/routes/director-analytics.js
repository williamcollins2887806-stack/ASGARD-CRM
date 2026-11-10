'use strict';

/**
 * Director Analytics — Jarl Pulse
 * Тендеры (registry_status) → заявки (канбан V3) → работы → команда/часы.
 * Серверная SQL-агрегация; роли ADMIN + DIRECTOR_*.
 */

const workStatus = require('../helpers/work-status');
const officeHours = require('../services/office-hours');
const crmActivity = require('../services/crm-activity');
const { resolveWorkPrice } = require('../services/work-price');
const { hhmmWallClock } = require('../lib/msk');

/** Подписи периодов «Графика офиса» (локальный фильтр раздела). */
const MONTHS_NOM = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
];

function dmy(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

function dmyShort(iso) {
  const [, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}.${m}`;
}

function isoYear(iso) { return Number(String(iso).slice(0, 4)); }
function isoMonth(iso) { return Number(String(iso).slice(5, 7)); }

/** Подпись периода + якоря для стрелок (фронт не считает месяцы сам). */
function periodMeta(scope, range) {
  const from = range.from;
  const to = range.to;
  let label;
  let prevAnchor;
  let nextAnchor;
  if (scope === 'week') {
    label = dmyShort(from) + '–' + dmy(to);
    prevAnchor = officeHours.addDays(from, -7);
    nextAnchor = officeHours.addDays(from, 7);
  } else if (scope === 'year') {
    const y = isoYear(from);
    label = y + ' год';
    prevAnchor = `${y - 1}-01-01`;
    nextAnchor = `${y + 1}-01-01`;
  } else {
    const y = isoYear(from);
    const m = isoMonth(from);
    label = MONTHS_NOM[m - 1] + ' ' + y;
    prevAnchor = officeHours.addDays(from, -1);
    nextAnchor = officeHours.addDays(to, 1);
  }
  return {
    label,
    prev_anchor: prevAnchor,
    next_anchor: nextAnchor,
    current_anchor: officeHours.isoOf(new Date())
  };
}

const ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

const REGISTRY_STATUSES = [
  'рассмотрение', 'готовим', 'подались', 'выиграли', 'проиграли', 'отмена'
];

/** 11 колонок личного канбана V3 (D-390) — как в утверждённом рендере. */
const APP_STATUSES = [
  'new', 'calc', 'approval', 'kp_prep', 'sent', 'addendum',
  'win', 'lose', 'work', 'done', 'trash'
];

const APP_STATUS_LABELS = {
  new: 'Новые',
  calc: 'Просчёт',
  approval: 'Согласование',
  kp_prep: 'КП готов',
  sent: 'КП ушло',
  addendum: 'Дозапрос',
  win: 'Выиграно',
  lose: 'Проиграно',
  work: 'В работе',
  done: 'Завершено',
  trash: 'Корзина'
};

/** Заявки в Jarl Pulse = карточки application + pre_tender на канбане (не сырой pre_tender.status). */
const APP_FLOW_TYPES = ['application', 'pre_tender'];

const PERIODS = new Set(['month', 'half_year', 'year', 'all']);

const OPEN_REGISTRY = new Set(['рассмотрение', 'готовим', 'подались']);
// «Рабочие» статусы — те, где решение ещё не принято. `подались` в них НЕ входит:
// по TERMINAL_REGISTRY_STATUSES (pm-duty.js) это терминальный статус, работа сделана.
const WORKING_REGISTRY = new Set(['рассмотрение', 'готовим']);
// Заявки: `sent` (КП ушло) — уже действие РП, а не «требует внимания».
const ATTENTION_APP_COLS = new Set(['new', 'calc', 'approval', 'kp_prep', 'addendum']);
const OPEN_APP_COLS = new Set(['new', 'calc', 'approval', 'kp_prep', 'sent', 'addendum', 'work']);
const WIN_APP_COLS = new Set(['win', 'work', 'done']);
const CLOSED_APP_COLS = new Set(['win', 'lose', 'done', 'trash']);

/**
 * Приоритет свёртки нескольких отметок за один день.
 * «оф» — потому что подтверждён СКУД; дальше по «весу присутствия».
 * Один список на весь модуль: иначе карточки статусов и «прямо сейчас»
 * считали дубли по разным правилам и расходились.
 */
const STATUS_PRIORITY = {
  'оф': 1, 'уд': 2, 'об': 3, 'км': 4, 'пг': 5, 'уч': 6,
  'ск': 7, 'нп': 8, 'бн': 9, 'сс': 10, 'вх': 11
};
function statusPrio(code) {
  const p = STATUS_PRIORITY[String(code || '')];
  return p == null ? 99 : p;
}

function parsePeriod(q) {
  const p = String(q || 'month');
  return PERIODS.has(p) ? p : 'month';
}

/**
 * Мусорные записи не должны доходить до директора.
 *
 * На проде их нет, но в клоне и в тестовых прогонах появляются
 * ([ДЕМО Мимир], AUDIT7_PROBE, BP-Test): они попадают в реестр, в счётчики
 * и в «Требует внимания», и директор видит «203 тендера» вместо реальных.
 * Фильтр по названию — единственный признак: флага «тестовая запись» в схеме нет.
 */
const JUNK_TITLE_RE = /^\[?демо|^\s*audit\d*_probe|^\s*bp-test|\bтест\b.*тендер|тендер.*\bтест\b|^test\b|^тест\b/i;

function isJunkTender(row) {
  const t = String((row && (row.title || row.tender_title)) || '').trim();
  if (!t) return true;
  return JUNK_TITLE_RE.test(t);
}

/**
 * SQL-условие отсечения мусора — тот же смысл, что у isJunkTender.
 * Применяется во всех выборках тендеров, чтобы счётчики, суммы и
 * «Требует внимания» считались по реальным процедурам.
 */
const NOT_JUNK_TENDER_SQL = `(
  t.tender_title IS NOT NULL
  AND btrim(t.tender_title) <> ''
  AND t.tender_title !~* '^\\[?демо'
  AND t.tender_title !~* '^\\s*audit[0-9]*_probe'
  AND t.tender_title !~* '^\\s*bp-test'
  AND t.tender_title !~* '^test'
  AND t.tender_title !~* '^тест'
)`;
// $1-параметры не нужны: шаблоны статичны, инъекции нет.

/** SQL-фрагмент фильтра периода по timestamp/date колонке. */
function periodSql(col, period, params) {
  if (period === 'all') return { clause: 'TRUE', params };
  if (period === 'month') {
    params.push(new Date());
    const i = params.length;
    return {
      clause: `${col} >= date_trunc('month', $${i}::timestamptz) AND ${col} < date_trunc('month', $${i}::timestamptz) + INTERVAL '1 month'`,
      params
    };
  }
  if (period === 'half_year') {
    params.push(new Date());
    const i = params.length;
    return {
      clause: `${col} >= ($${i}::timestamptz - INTERVAL '6 months')`,
      params
    };
  }
  // year — календарный текущий год
  params.push(new Date().getFullYear());
  const i = params.length;
  return {
    clause: `EXTRACT(YEAR FROM ${col}) = $${i}`,
    params
  };
}

function marginTone(marginPct, scheduleOk) {
  if (marginPct == null) return 'unknown';
  if (marginPct < 10 || scheduleOk === false) return 'bad';
  if (marginPct < 20) return 'risk';
  return 'ok';
}

function workBucket(status) {
  const s = String(status || '').trim();
  if (s === 'На паузе' || s.toLowerCase() === 'приостановлена') return 'pause';
  if (workStatus.isClosedOrCancelled(s)) return 'archive';
  return 'active';
}

function daysLeftOf(deadline) {
  if (!deadline) return null;
  const end = new Date(deadline);
  if (Number.isNaN(end.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return Math.ceil((end - today) / 86400000);
}

function dueFlagOf(deadline, isClosed) {
  if (isClosed) return null;
  const d = daysLeftOf(deadline);
  if (d == null) return null;
  if (d < 0) return 'over';
  if (d === 0) return 'today';
  if (d <= 3) return 'soon';
  return null;
}

/**
 * Текст из гетерогенного jsonb: строка → строка, массив/объект → читаемый
 * текст, null/'' → null. report_json пишут разные версии Мимира, поэтому
 * `scope` там бывает и строкой, и массивом.
 */
function asText(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v.trim() || null;
  if (Array.isArray(v)) {
    const parts = v.map((x) => asText(x)).filter(Boolean);
    return parts.length ? parts.join('\n') : null;
  }
  if (typeof v === 'object') {
    const parts = Object.entries(v)
      .map(([k, val]) => {
        const t = asText(val);
        return t ? `${k}: ${t}` : null;
      })
      .filter(Boolean);
    return parts.length ? parts.join('\n') : null;
  }
  return String(v);
}

/** Список из гетерогенного jsonb: массив как есть, строка → элементы по строкам. */
function asList(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.filter((x) => x != null);
  if (typeof v === 'string') {
    // Риски и вопросы Мимир пишет одной строкой через перевод строки,
    // «;» или «•». Без разбиения весь список склеивался в один абзац.
    return v
      .split(/\r?\n|;\s*|•\s*/)
      .map((s) => s.replace(/^[-–—\d.)\s]+/, '').trim())
      .filter((s) => s.length > 1);
  }
  if (typeof v === 'object') {
    const t = asText(v);
    return t ? [t] : [];
  }
  return [String(v)];
}

function platformFromUrl(url) {
  if (!url) return null;
  try {
    const host = new URL(String(url)).hostname.replace(/^www\./, '');
    return host || null;
  } catch (_) {
    return null;
  }
}

function parseJsonMaybe(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(String(v)); } catch (_) { return null; }
}

/** Строки сметы из asgard_smeta (канон D-174) + totals. */
function extractSmeta(reportJson) {
  const rj = parseJsonMaybe(reportJson) || {};
  const smeta = rj.asgard_smeta || null;
  if (!smeta || typeof smeta !== 'object') {
    return { rows: [], totals: null, raw: smeta };
  }
  const rows = Array.isArray(smeta.rows) ? smeta.rows.map((r, i) => ({
    n: i + 1,
    name: r.name || r.title || r.label || ('Позиция ' + (i + 1)),
    unit: r.unit || r.ed || '',
    qty: r.qty != null ? Number(r.qty) : (r.quantity != null ? Number(r.quantity) : null),
    sum: r.sum != null ? Number(r.sum) : (r.amount != null ? Number(r.amount) : null),
    cost: r.cost != null ? Number(r.cost) : (r.cost_sum != null ? Number(r.cost_sum) : null),
    margin_pct: r.margin_pct != null ? Number(r.margin_pct)
      : (r.margin != null ? Number(r.margin) : null)
  })) : [];
  const t = smeta.totals || {};
  const totalNoVat = t.price_no_vat != null ? Number(t.price_no_vat)
    : (t.total_no_vat != null ? Number(t.total_no_vat) : null);
  const vat = t.vat != null ? Number(t.vat)
    : (t.vat_amount != null ? Number(t.vat_amount) : null);
  const totalWithVat = t.price_with_vat != null ? Number(t.price_with_vat)
    : (t.total_with_vat != null ? Number(t.total_with_vat) : null);
  const costTotal = t.cost != null ? Number(t.cost)
    : (t.cost_total != null ? Number(t.cost_total) : null);
  const marginRub = t.margin_rub != null ? Number(t.margin_rub)
    : (totalNoVat != null && costTotal != null ? totalNoVat - costTotal : null);
  const marginPct = t.margin_pct != null ? Number(t.margin_pct)
    : (totalNoVat > 0 && marginRub != null
      ? Math.round((marginRub / totalNoVat) * 1000) / 10 : null);
  return {
    rows,
    totals: {
      total_no_vat: totalNoVat,
      vat,
      total_with_vat: totalWithVat,
      cost_total: costTotal,
      margin_rub: marginRub,
      margin_pct: marginPct
    },
    raw: smeta
  };
}

/** Пункты чеклиста: тексты из template_snapshot + ответы. */
function extractChecklistItems(row) {
  if (!row) return null;
  const answers = parseJsonMaybe(row.answers) || {};
  const free = parseJsonMaybe(row.free_answers);
  const snap = parseJsonMaybe(row.template_snapshot) || {};
  const itemsSrc = Array.isArray(snap.items) ? snap.items
    : (Array.isArray(snap.questions) ? snap.questions
      : (Array.isArray(snap) ? snap : null));
  let items = [];
  if (itemsSrc && itemsSrc.length) {
    items = itemsSrc.map((it, i) => {
      const key = String(it.id || it.key || it.code || i);
      const ans = answers[key] != null ? answers[key]
        : (answers[it.id] != null ? answers[it.id] : answers[i]);
      const done = ans === true || ans === 'yes' || ans === 'ok' || ans === 'done'
        || (ans && typeof ans === 'object' && (ans.done === true || ans.value === true));
      const when = (ans && typeof ans === 'object')
        ? (ans.at || ans.date || ans.done_at || null) : null;
      return {
        id: key,
        text: it.text || it.title || it.label || it.question || ('Пункт ' + (i + 1)),
        done: !!done,
        date: when,
        due: it.due || it.due_date || null
      };
    });
  } else {
    items = Object.keys(answers).map((k) => {
      const ans = answers[k];
      const done = ans === true || ans === 'yes' || ans === 'ok'
        || (ans && typeof ans === 'object' && ans.done === true);
      return {
        id: k,
        text: (ans && typeof ans === 'object' && ans.label) ? ans.label : k,
        done: !!done,
        date: (ans && typeof ans === 'object') ? (ans.at || ans.date || null) : null,
        due: null
      };
    });
  }
  if (Array.isArray(free)) {
    free.forEach((f, i) => {
      items.push({
        id: 'free_' + i,
        text: (f && (f.text || f.title || f.note)) || String(f || ''),
        done: !!(f && f.done),
        date: f && f.at ? f.at : null,
        due: null
      });
    });
  }
  const doneN = items.filter((x) => x.done).length;
  return {
    id: row.id,
    items,
    done: doneN,
    total: items.length,
    updated_at: row.updated_at,
    answers,
    free_answers: free
  };
}

function tenderOutcome(t) {
  const st = String(t.registry_status || '');
  if (st === 'проиграли') {
    const reasons = parseJsonMaybe(t.loss_reasons);
    let reason = t.reject_reason || null;
    if (!reason && Array.isArray(reasons) && reasons.length) {
      reason = reasons.map((r) => (typeof r === 'string' ? r : (r && (r.reason || r.text)) || '')).filter(Boolean).join('; ');
    } else if (!reason && reasons && typeof reasons === 'object' && !Array.isArray(reasons)) {
      reason = reasons.reason || reasons.text || null;
    }
    return {
      kind: 'lose',
      reason: reason || 'Причина не указана',
      detail: t.loss_winner_price != null
        ? ('Цена победителя: ' + Number(t.loss_winner_price).toLocaleString('ru-RU') + ' ₽')
        : null,
      by: null,
      at: t.updated_at || t.archived_at || null
    };
  }
  if (st === 'отмена') {
    return {
      kind: 'cancel',
      reason: t.reject_reason || t.archive_reason || 'Причина не указана',
      detail: null,
      by: null,
      at: t.archived_at || t.updated_at || null
    };
  }
  return null;
}

function scheduleLightOf(daysLeft, workSt) {
  if (workStatus.isClosedOrCancelled(workSt)) return 'muted';
  if (String(workSt || '').includes('пауз') || String(workSt || '').toLowerCase().includes('приостанов')) {
    return 'warn';
  }
  if (daysLeft == null) return 'unknown';
  if (daysLeft < 0) return 'err';
  if (daysLeft <= 7) return 'warn';
  return 'ok';
}

module.exports = async function directorAnalyticsRoutes(fastify) {
  const db = fastify.db;

  // ─── GET /overview?period= ───────────────────────────────────────────
  fastify.get('/overview', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    try {
      const period = parsePeriod(request.query.period);

      // ── Тендеры ──
      const tParams = [];
      const tPeriod = periodSql('COALESCE(t.docs_deadline::timestamptz, t.created_at)', period, tParams);
      // Тот же период для подзапроса цены работ: алиас t3, но БЕЗ второго
      // push параметра — иначе Postgres получает 2 значения при одном $N
      // («bind message supplies 2 parameters, but prepared statement requires 1»).
      // Оба условия используют один и тот же период, значит и параметр один.
      const workPricePeriod = { clause: tPeriod.clause.replace(/\bt\.docs_deadline\b/g, 't3.docs_deadline').replace(/\bt\.created_at\b/g, 't3.created_at') };
      const { rows: [tSum] } = await db.query(`
        SELECT
          COUNT(*)::int AS total,
          -- ВАЖНО: COUNT(*) здесь считал СТРОКИ ДЖОЙНА, а не тендеры.
          -- У тендера бывает несколько просчётов (пересчёт, разные РП),
          -- и LEFT JOIN давал дубли: один тендер учитывался 2–3 раза.
          -- Отсюда «просрочки», которых нет (жалоба директора 09.11.2026).
          COUNT(DISTINCT t.id)::int AS total_unique,
          COUNT(DISTINCT t.id) FILTER (WHERE t.registry_status = 'выиграли')::int AS won,
          COUNT(DISTINCT t.id) FILTER (WHERE t.registry_status = 'проиграли')::int AS lost,
          COUNT(DISTINCT t.id) FILTER (WHERE t.registry_status IN ('рассмотрение','готовим','подались'))::int AS active,
          COALESCE(SUM(COALESCE(t.submission_price, t.tender_price))
                   FILTER (WHERE COALESCE(t.submission_price, t.tender_price) <= 5000000000), 0)::float AS sum,
          -- НМЦК: tender_price пуст у 865 из 1313 тендеров (площадки кладут цену
          -- в submission_price). Без фолбэка директор видел «НМЦК 0 ₽ по 25
          -- процедурам» (жалоба 10.11.2026).
          COALESCE(SUM(COALESCE(t.tender_price, t.submission_price))
                   FILTER (WHERE COALESCE(t.tender_price, t.submission_price) <= 5000000000), 0)::float AS nmck_sum,
          -- Аномальные цены исключаем из сумм: на проде есть тендер с ценой
          -- 90,4 млрд руб. Саму запись не прячем, но итоги она не раздувает.
          COALESCE(SUM(COALESCE(t.submission_price, t.tender_price))
                   FILTER (WHERE COALESCE(t.submission_price, t.tender_price) <= 5000000000), 0)::float AS sum_sane,
          COUNT(DISTINCT t.id) FILTER (
            WHERE COALESCE(t.submission_price, t.tender_price) > 5000000000
          )::int AS price_suspect_count,
          COUNT(DISTINCT t.id) FILTER (
            WHERE t.registry_status IN ('рассмотрение','готовим')
          )::int AS active_work,
          COALESCE(SUM(COALESCE(t.submission_price, t.tender_price))
                   FILTER (WHERE t.registry_status IN ('рассмотрение','готовим')
                             AND COALESCE(t.submission_price, t.tender_price) <= 5000000000), 0)::float AS active_work_sum,
          COALESCE(SUM(COALESCE(t.submission_price, t.tender_price))
                   FILTER (WHERE t.registry_status = 'выиграли'
                             AND COALESCE(t.submission_price, t.tender_price) <= 5000000000), 0)::float AS won_sum,
          -- Отдельно: сколько тендеров реально имеют цену. Нужен, чтобы на
          -- экране писать «по N из M процедур», а не «по 25» при нуле.
          COUNT(DISTINCT t.id) FILTER (
            WHERE COALESCE(t.tender_price, t.submission_price) > 0
          )::int AS priced_count,
          -- Рабочие (ещё не поданные) — отдельным счётчиком. Директору нужен
          -- именно он: 'подались' — терминальный статус, работа сделана.
          COUNT(DISTINCT t.id) FILTER (WHERE t.registry_status IN ('рассмотрение','готовим'))::int AS active_work,
          -- Цена работ — по УНИКАЛЬНЫМ тендерам. Раньше SUM(tr.work_price)
          -- складывал строки джойна: тендер с двумя просчётами учитывался
          -- дважды (та же ошибка, что в счётчиках).
          COALESCE((
            SELECT SUM(x.wp)
              FROM (
                SELECT DISTINCT ON (tr2.tender_id) tr2.tender_id, tr2.work_price AS wp
                  FROM tender_rp_reviews tr2
                 WHERE tr2.tender_id IN (
                   SELECT DISTINCT t3.id FROM tenders t3
                    WHERE t3.archived_at IS NULL
                      AND (${workPricePeriod.clause})
                 )
                 ORDER BY tr2.tender_id, tr2.updated_at DESC NULLS LAST
              ) x
          ), 0)::float AS work_price_sum,
          -- Просрочки — по УНИКАЛЬНЫМ тендерам, а не по строкам джойна.
          --
          -- И только по РАБОЧИМ статусам: 'подались' — терминальный
          -- (заявка отправлена, работа сделана, см. TERMINAL_REGISTRY_STATUSES
          -- в pm-duty.js). Раньше он считался активным, и директор видел
          -- «просрочки» там, где срок просто прошёл после подачи
          -- (жалоба 09.11.2026: 4 из 4 «просроченных» — поданные заявки).
          COUNT(DISTINCT t.id) FILTER (
            WHERE t.registry_status IN ('рассмотрение','готовим')
              AND t.docs_deadline IS NOT NULL
              AND t.docs_deadline::date < CURRENT_DATE
          )::int AS overdue_count
        FROM tenders t
        LEFT JOIN tender_rp_reviews tr ON tr.tender_id = t.id
        WHERE t.archived_at IS NULL
          AND ${NOT_JUNK_TENDER_SQL}
          AND t.deleted_at IS NULL
          AND (${tPeriod.clause})
      `, tPeriod.params);

      const { rows: tByStatus } = await db.query(`
        SELECT
          t.registry_status AS status,
          COUNT(*)::int AS count,
          COALESCE(SUM(COALESCE(t.submission_price, t.tender_price))
                   FILTER (WHERE COALESCE(t.submission_price, t.tender_price) <= 5000000000), 0)::float AS sum,
          MIN(t.docs_deadline) FILTER (
            WHERE t.docs_deadline IS NOT NULL
              AND t.registry_status IN ('рассмотрение','готовим','подались')
          ) AS nearest_deadline
        FROM tenders t
        WHERE t.archived_at IS NULL
          AND ${NOT_JUNK_TENDER_SQL} AND (${tPeriod.clause})
        GROUP BY t.registry_status
      `, tPeriod.params);
      const tMap = Object.fromEntries(tByStatus.map((r) => [r.status, r]));

      const { rows: tAttn } = await db.query(`
        SELECT t.id, t.tender_title AS title, t.customer_name, t.registry_status,
               t.docs_deadline, t.analysis_deadline,
               COALESCE(t.submission_price, t.tender_price)::float AS price,
               tr.work_price::float AS work_price,
               tr.director_review_status,
               CASE
                 WHEN tr.director_review_status = 'pending' THEN 'director'
                 WHEN COALESCE(t.analysis_deadline, t.docs_deadline) < CURRENT_DATE THEN 'analysis_overdue'
                 ELSE 'deadline_soon'
               END AS attention_kind
        FROM tenders t
        LEFT JOIN tender_rp_reviews tr ON tr.tender_id = t.id
        WHERE t.archived_at IS NULL
          AND ${NOT_JUNK_TENDER_SQL}
          AND t.deleted_at IS NULL
          AND t.registry_status IN ('рассмотрение','готовим')
          AND COALESCE(tr.decision, 'pending') = 'pending'
          AND COALESCE(tr.is_final, false) = false
          AND (
            tr.director_review_status = 'pending'
            OR COALESCE(t.analysis_deadline, t.docs_deadline) < CURRENT_DATE
            OR COALESCE(t.analysis_deadline, t.docs_deadline) <= CURRENT_DATE + INTERVAL '3 days'
          )
        ORDER BY
          CASE WHEN tr.director_review_status = 'pending' THEN 0 ELSE 1 END,
          COALESCE(t.analysis_deadline, t.docs_deadline) ASC
        LIMIT 20
      `).catch(() => ({ rows: [] }));

      // Верхняя граница ответственности директора: полный набор поводов,
      // а не длина среза. Фронт рисует число в бейдже и не должен врать.
      const { rows: [tAttnCount] } = await db.query(`
        SELECT COUNT(*)::int AS n
        FROM tenders t
        LEFT JOIN tender_rp_reviews tr ON tr.tender_id = t.id
        WHERE t.archived_at IS NULL
          AND ${NOT_JUNK_TENDER_SQL}
          AND t.deleted_at IS NULL
          AND t.registry_status IN ('рассмотрение','готовим')
          AND COALESCE(tr.decision, 'pending') = 'pending'
          AND COALESCE(tr.is_final, false) = false
          AND (
            tr.director_review_status = 'pending'
            OR COALESCE(t.analysis_deadline, t.docs_deadline) < CURRENT_DATE
            OR COALESCE(t.analysis_deadline, t.docs_deadline) <= CURRENT_DATE + INTERVAL '3 days'
          )
      `).catch(() => ({ rows: [{ n: 0 }] }));

      // ── Заявки (канбан V3: application + pre_tender) ──
      let aByStatus = [];
      let aAttn = [];
      let aHero = { total: 0, in_work_sum: 0, won_sum: 0, overdue_count: 0, win: 0, lose: 0 };
      try {
        const aP2 = [APP_FLOW_TYPES];
        const aPer2 = periodSql('c.created_at', period, aP2);
        const { rows: aRows2 } = await db.query(`
          SELECT c.v3_column AS status, COUNT(*)::int AS count,
                 COALESCE(SUM(
                   CASE WHEN c.entity_kind = 'pre_tender' THEN pt.estimated_sum ELSE NULL END
                 ), 0)::float AS sum
          FROM v_unified_kanban_cards c
          LEFT JOIN pre_tender_requests pt
            ON c.entity_kind = 'pre_tender' AND pt.id = c.entity_id
          WHERE c.flow_type = ANY($1::text[])
            AND (c.is_closed = FALSE OR c.current_main_status IN ('trash','done'))
            AND (${aPer2.clause})
          GROUP BY c.v3_column
        `, aPer2.params);
        aByStatus = aRows2;

        const aMap = Object.fromEntries(aByStatus.map((r) => [r.status, r]));
        aHero.total = aByStatus.reduce((s, x) => s + Number(x.count || 0), 0);
        aHero.in_work_sum = APP_STATUSES
          .filter((s) => OPEN_APP_COLS.has(s))
          .reduce((s, id) => s + Number(aMap[id]?.sum || 0), 0);
        aHero.won_sum = Number(aMap.win?.sum || 0) + Number(aMap.work?.sum || 0) + Number(aMap.done?.sum || 0);
        aHero.win = Number(aMap.win?.count || 0);
        aHero.lose = Number(aMap.lose?.count || 0);

        const aP4 = [APP_FLOW_TYPES, [...OPEN_APP_COLS]];
        const aPer4 = periodSql('c.created_at', period, aP4);
        const { rows: [aOver2] } = await db.query(`
          SELECT COUNT(*)::int AS n
          FROM v_unified_kanban_cards c
          LEFT JOIN pre_tender_requests pt
            ON c.entity_kind = 'pre_tender' AND pt.id = c.entity_id
          WHERE c.flow_type = ANY($1::text[])
            AND c.v3_column = ANY($2::text[])
            AND (${aPer4.clause})
            AND pt.work_deadline IS NOT NULL
            AND pt.work_deadline::date < CURRENT_DATE
        `, aPer4.params);
        aHero.overdue_count = Number(aOver2?.n || 0);

        // Внимание заявок — БЕЗ периода по созданию: просроченная задача не
        // перестаёт требовать решения от того, что карточку завели в июле.
        // Окно по сроку с НИЖНЕЙ границей: старьё (просрочка >30 дней) не
        // вытесняет актуальные, но и не пропадает из счётчика отдельно.
        const aP5 = [APP_FLOW_TYPES, [...ATTENTION_APP_COLS]];
        const { rows: aAttnRows } = await db.query(`
          SELECT c.id AS card_id, c.entity_id, c.entity_kind, c.v3_column AS status,
                 COALESCE(pt.customer_name, ia.source_name, 'Заявка #' || c.entity_id::text) AS customer_name,
                 COALESCE(pt.work_description, ia.subject) AS title,
                 COALESCE(pt.work_deadline, ia.created_at::date) AS deadline,
                 pt.estimated_sum::float AS estimated_sum,
                 pt.ai_color
          FROM v_unified_kanban_cards c
          LEFT JOIN pre_tender_requests pt
            ON c.entity_kind = 'pre_tender' AND pt.id = c.entity_id
          LEFT JOIN inbox_applications ia
            ON c.entity_kind = 'inbox_application' AND ia.id = c.entity_id
          WHERE c.flow_type = ANY($1::text[])
            AND c.v3_column = ANY($2::text[])
            AND COALESCE(pt.work_deadline, ia.created_at::date) IS NOT NULL
            AND COALESCE(pt.work_deadline, ia.created_at::date) >= CURRENT_DATE - INTERVAL '30 days'
            AND COALESCE(pt.work_deadline, ia.created_at::date) <= CURRENT_DATE + INTERVAL '3 days'
          ORDER BY COALESCE(pt.work_deadline, ia.created_at::date) ASC
          LIMIT 20
        `, aP5.params);
        aAttn = aAttnRows;
      } catch (e) {
        request.log.warn({ err: e }, 'director-analytics overview apps (kanban view)');
      }

      // ── Работы ──
      const { rows: wRows } = await db.query(`
        SELECT
          w.id, w.work_title, w.object_name, w.customer_name, w.work_status,
          w.end_plan, w.contract_value::float AS contract_value,
          w.cost_plan::float AS cost_plan, w.cost_fact::float AS cost_fact,
          w.advance_received::float AS advance_received,
          w.balance_received::float AS balance_received
        FROM works w
        WHERE w.deleted_at IS NULL
        ORDER BY w.end_plan NULLS LAST, w.id DESC
        LIMIT 800
      `);
      const wItems = wRows.map((r) => {
        const b = workBucket(r.work_status);
        const contract = Number(r.contract_value || 0);
        // cost_fact заполнен у 18 из 41 и бывает абсурден (контракт 353 млн,
        // «факт» 1,46 млн → маржа 99,6 %). Факт берём, только если он похож
        // на правду (≥10 % контракта); иначе показываем план и помечаем это.
        const fact = r.cost_fact != null ? Number(r.cost_fact) : null;
        const plan = r.cost_plan != null ? Number(r.cost_plan) : null;
        const planUsable = plan != null && plan > 0;
        const factUsable = fact != null && fact > 0 && contract > 0 && fact >= contract * 0.1;
        // Порядок: правдоподобный факт → план → ничего. Мусорный факт (0,4 %
        // от контракта) НЕ подставляем: лучше честный прочерк, чем маржа 99,6 %.
        const cost = factUsable ? fact : (planUsable ? plan : null);
        const costBasis = factUsable ? 'fact' : (planUsable ? 'plan' : null);
        const marginPct = (cost != null && contract > 0)
          ? Math.round(((contract - cost) / contract) * 1000) / 10 : null;
        const daysLeft = daysLeftOf(r.end_plan);
        const light = scheduleLightOf(daysLeft, r.work_status);
        const paid = Number(r.advance_received || 0) + Number(r.balance_received || 0);
        return {
          id: r.id,
          title: r.work_title || r.object_name,
          customer_name: r.customer_name,
          bucket: b,
          contract_value: contract || null,
          margin_pct: marginPct,
          margin_basis: costBasis,
          days_left: daysLeft,
          schedule_light: light,
          paid,
          end_plan: r.end_plan
        };
      });
      const wActive = wItems.filter((x) => x.bucket === 'active');
      const wPause = wItems.filter((x) => x.bucket === 'pause');
      const wArch = wItems.filter((x) => x.bucket === 'archive');
      const portfolio = wActive.concat(wPause);
      const contractSum = portfolio.reduce((s, x) => s + Number(x.contract_value || 0), 0);
      const paidSum = portfolio.reduce((s, x) => s + Number(x.paid || 0), 0);
      const margins = portfolio.map((x) => x.margin_pct).filter((v) => v != null);
      const avgMargin = margins.length
        ? Math.round(margins.reduce((s, v) => s + v, 0) / margins.length * 10) / 10
        : null;
      // Сколько маржей посчитано по плану, а не по факту — подпись на экране.
      const marginPlanCount = portfolio.filter((x) => x.margin_basis === 'plan').length;
      const riskCount = portfolio.filter((x) => x.schedule_light === 'err' || x.schedule_light === 'warn'
        || (x.margin_pct != null && x.margin_pct < 20)).length;
      const wAttn = portfolio
        .filter((x) => x.schedule_light === 'err' || x.schedule_light === 'warn'
          || (x.days_left != null && x.days_left <= 1))
        .slice(0, 5)
        .map((x) => ({
          id: x.id,
          title: x.title,
          customer_name: x.customer_name,
          bucket: x.bucket,
          deadline: x.end_plan,
          contract_value: x.contract_value,
          margin_pct: x.margin_pct,
          due_flag: dueFlagOf(x.end_plan, false),
          schedule_light: x.schedule_light
        }));

      const won = Number(tSum.won || 0);
      const lost = Number(tSum.lost || 0);
      const aWin = aHero.win;
      const aLose = aHero.lose;

      return {
        period,
        tenders: {
          // total_unique — счётч по УНИКАЛЬНЫМ тендерам. Старое поле total
          // считало строки джойна с просчётами и завышало число вдвое-втрое
          // (ложные «просрочки», жалоба директора 09.11.2026).
          total: Number(tSum.total_unique || tSum.total || 0),
          active: Number(tSum.active || 0),
          won,
          lost,
          conversion: (won + lost) > 0 ? Math.round(won / (won + lost) * 100) : null,
          sum: Number(tSum.sum || 0),
          nmck_sum: Number(tSum.nmck_sum || 0),
          priced_count: Number(tSum.priced_count || 0),
          sum_sane: Number(tSum.sum_sane || 0),
          price_suspect_count: Number(tSum.price_suspect_count || 0),
          active_work: Number(tSum.active_work || 0),
          active_work_sum: Number(tSum.active_work_sum || 0),
          won_sum: Number(tSum.won_sum || 0),
          work_price_sum: Number(tSum.work_price_sum || 0),
          overdue_count: Number(tSum.overdue_count || 0),
          by_status: REGISTRY_STATUSES.map((status) => ({
            status,
            count: Number(tMap[status]?.count || 0),
            sum: Number(tMap[status]?.sum || 0),
            nearest_deadline: tMap[status]?.nearest_deadline || null
          })),
          attention: tAttn.map((r) => ({
            id: r.id,
            title: r.title,
            customer_name: r.customer_name,
            status: r.registry_status,
            deadline: r.docs_deadline,
            analysis_deadline: r.analysis_deadline,
            price: r.price,
            work_price: r.work_price,
            attention_kind: r.attention_kind,
            due_flag: dueFlagOf(r.docs_deadline, false)
          })),
          attention_count: Number(tAttnCount?.n || 0)
        },
        applications: {
          total: aHero.total,
          in_work_sum: aHero.in_work_sum,
          won_sum: aHero.won_sum,
          conversion: (aWin + aLose) > 0 ? Math.round(aWin / (aWin + aLose) * 100) : null,
          overdue_count: aHero.overdue_count,
          by_status: APP_STATUSES.map((status) => {
            const row = aByStatus.find((r) => r.status === status);
            return {
              status,
              label: APP_STATUS_LABELS[status],
              count: Number(row?.count || 0),
              sum: status === 'trash' ? null : Number(row?.sum || 0)
            };
          }),
          attention: aAttn.map((r) => ({
            id: r.entity_id,
            card_id: r.card_id,
            title: r.title || r.customer_name,
            customer_name: r.customer_name,
            status: r.status,
            deadline: r.deadline,
            estimated_sum: r.estimated_sum,
            ai_color: r.ai_color,
            due_flag: dueFlagOf(r.deadline, CLOSED_APP_COLS.has(r.status))
          }))
        },
        works: {
          total: wItems.length,
          active: wActive.length,
          pause: wPause.length,
          archive: wArch.length,
          contract_sum: contractSum,
          avg_margin: avgMargin,
          margin_plan_count: marginPlanCount,
          paid_sum: paidSum,
          risk_count: riskCount,
          by_bucket: [
            {
              status: 'active', label: 'Активные',
              count: wActive.length,
              sum: wActive.reduce((s, x) => s + Number(x.contract_value || 0), 0)
            },
            {
              status: 'pause', label: 'На паузе',
              count: wPause.length,
              sum: wPause.reduce((s, x) => s + Number(x.contract_value || 0), 0)
            },
            {
              status: 'archive', label: 'Архив',
              count: wArch.length,
              sum: wArch.reduce((s, x) => s + Number(x.contract_value || 0), 0)
            }
          ],
          attention: wAttn
        }
      };
    } catch (err) {
      request.log.error(err, 'director-analytics overview');
      return reply.code(500).send({ error: 'overview_failed', message: err.message });
    }
  });

  // ─── GET /tenders/by-status?period= ──────────────────────────────────
  fastify.get('/tenders/by-status', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    try {
      const period = parsePeriod(request.query.period);
      const params = [];
      const p = periodSql('COALESCE(t.docs_deadline::timestamptz, t.created_at)', period, params);
      const { rows } = await db.query(`
        SELECT
          t.registry_status AS status,
          COUNT(*)::int AS count,
          COALESCE(SUM(COALESCE(t.submission_price, t.tender_price)), 0)::float AS sum
        FROM tenders t
        WHERE t.archived_at IS NULL
          AND ${NOT_JUNK_TENDER_SQL}
          AND (${p.clause})
        GROUP BY t.registry_status
      `, p.params);

      const map = Object.fromEntries(rows.map(r => [r.status, r]));
      const byStatus = REGISTRY_STATUSES.map(status => ({
        status,
        count: Number(map[status]?.count || 0),
        sum: Number(map[status]?.sum || 0)
      }));
      const total = byStatus.reduce((s, x) => s + x.count, 0);
      const won = byStatus.find(x => x.status === 'выиграли')?.count || 0;
      const lost = byStatus.find(x => x.status === 'проиграли')?.count || 0;
      return {
        period,
        total,
        conversion: (won + lost) > 0 ? Math.round(won / (won + lost) * 100) : null,
        byStatus
      };
    } catch (err) {
      request.log.error(err, 'director-analytics tenders/by-status');
      return reply.code(500).send({ error: 'tenders_by_status_failed', message: err.message });
    }
  });

  // ─── GET /tenders?period=&status= ────────────────────────────────────
  fastify.get('/tenders', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    try {
      const period = parsePeriod(request.query.period);
      const status = String(request.query.status || '').trim();
      if (status && !REGISTRY_STATUSES.includes(status)) {
        return reply.code(400).send({ error: 'bad_status', allowed: REGISTRY_STATUSES });
      }
      const params = [];
      const p = periodSql('COALESCE(t.docs_deadline::timestamptz, t.created_at)', period, params);
      let statusClause = 'TRUE';
      if (status) {
        params.push(status);
        statusClause = `t.registry_status = $${params.length}`;
      }
      params.push(Math.min(parseInt(request.query.limit, 10) || 200, 500));
      const limitIdx = params.length;

      // Фронт давно шлёт &sort=, сервер его игнорировал: реестр всегда был
      // отсортирован по сроку возрастанию, то есть первыми шли самые старые
      // (при period=all — 200 строк с истёкшим сроком, 158 из них закрытые).
      const sortQ = String(request.query.sort || '').trim();
      const CLOSED_SQL = "('выиграли','проиграли','отмена','подались')";
      let orderBy;
      if (sortQ === 'sum') {
        orderBy = 'COALESCE(t.submission_price, t.tender_price) DESC NULLS LAST, t.id DESC';
      } else if (sortQ === 'created') {
        orderBy = 't.created_at DESC NULLS LAST, t.id DESC';
      } else if (sortQ === 'status') {
        orderBy = 't.registry_status ASC, t.docs_deadline ASC NULLS LAST';
      } else {
        // По умолчанию: живые впереди закрытых, внутри живых — ближайший срок.
        orderBy = 'CASE WHEN t.registry_status IN ' + CLOSED_SQL + ' THEN 1 ELSE 0 END,'
          + ' t.docs_deadline ASC NULLS LAST, t.id DESC';
      }

      const { rows } = await db.query(`
        SELECT
          t.id, t.tender_title, t.customer_name, t.customer_inn,
          t.registry_status, t.tender_status,
          t.docs_deadline, t.purchase_url,
          COALESCE(t.submission_price, t.tender_price)::float AS price,
          t.calculator_kind,
          t.calculator_user_id,
          calc.name AS calculator_name,
          t.responsible_pm_id,
          pm.name AS pm_name,
          tr.decision AS rp_decision,
          tr.is_final AS rp_final,
          tr.work_price::float AS rp_work_price,
          analyzer.name AS analyzer_name,
          tr.calculator_user_id AS analyzer_user_id
        FROM tenders t
        LEFT JOIN users calc ON calc.id = t.calculator_user_id
        LEFT JOIN users pm ON pm.id = t.responsible_pm_id
        LEFT JOIN tender_rp_reviews tr ON tr.tender_id = t.id
        LEFT JOIN users analyzer ON analyzer.id = COALESCE(tr.calculator_user_id, t.calculator_user_id)
        WHERE t.archived_at IS NULL
          AND ${NOT_JUNK_TENDER_SQL}
          AND (${p.clause})
          AND (${statusClause})
        ORDER BY ${orderBy}
        LIMIT $${limitIdx}
      `, params);

      return {
        period,
        status: status || null,
        items: rows.map((r) => {
          const closed = !OPEN_REGISTRY.has(String(r.registry_status || ''));
          return {
            id: r.id,
            title: r.tender_title,
            customer_name: r.customer_name,
            customer_inn: r.customer_inn,
            registry_status: r.registry_status,
            tender_status: r.tender_status,
            docs_deadline: r.docs_deadline,
            purchase_url: r.purchase_url,
            platform: platformFromUrl(r.purchase_url),
            price: r.price,
            nmck: r.price,
            due_flag: dueFlagOf(r.docs_deadline, closed),
            days_left: daysLeftOf(r.docs_deadline),
            calculator: r.calculator_user_id ? {
              id: r.calculator_user_id,
              name: r.calculator_name,
              kind: r.calculator_kind
            } : null,
            analyzer: (r.analyzer_user_id || r.calculator_user_id) ? {
              id: r.analyzer_user_id || r.calculator_user_id,
              name: r.analyzer_name || r.calculator_name
            } : null,
            pm: r.responsible_pm_id ? { id: r.responsible_pm_id, name: r.pm_name } : null,
            rp_review: r.rp_decision ? {
              decision: r.rp_decision,
              is_final: r.rp_final,
              work_price: r.rp_work_price
            } : null
          };
        })
      };
    } catch (err) {
      request.log.error(err, 'director-analytics tenders list');
      return reply.code(500).send({ error: 'tenders_list_failed', message: err.message });
    }
  });

  // ─── GET /customer?inn=… | ?name=… ───────────────────────────────────
  // История контрагента за ВСЁ время, без фильтра периода: директору нужно
  // «сколько у него было тендеров всего и чем кончилось».
  //
  // Источник — registry_status (единая правда аналитики). Старый
  // /api/customers/:inn/dashboard читает легаси tender_status («КП отправлено»,
  // «Не подходит») и даёт другую картину — его сюда не подмешиваем.
  fastify.get('/customer', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    try {
      const inn = String(request.query.inn || '').replace(/\D/g, '');
      const name = String(request.query.name || '').trim();
      if (!inn && name.length < 3) {
        return reply.code(400).send({ error: 'bad_query', message: 'Нужен ИНН или название (3+ символа)' });
      }

      const params = [];
      let where = 't.deleted_at IS NULL';
      if (inn) {
        params.push(inn);
        where += ` AND t.customer_inn = $${params.length}`;
      } else {
        params.push(name);
        where += ` AND lower(btrim(COALESCE(t.customer_name, ''))) = lower(btrim($${params.length}))`;
      }

      const { rows: [agg] } = await db.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE t.registry_status = 'рассмотрение')::int AS review,
          COUNT(*) FILTER (WHERE t.registry_status = 'готовим')::int AS prep,
          COUNT(*) FILTER (WHERE t.registry_status = 'подались')::int AS submitted,
          COUNT(*) FILTER (WHERE t.registry_status = 'выиграли')::int AS won,
          COUNT(*) FILTER (WHERE t.registry_status = 'проиграли')::int AS lost,
          COUNT(*) FILTER (WHERE t.registry_status = 'отмена')::int AS cancelled,
          COALESCE(SUM(CASE WHEN t.registry_status = 'выиграли'
                            THEN COALESCE(t.submission_price, t.tender_price) END), 0)::float AS won_sum,
          MIN(t.created_at) AS first_at,
          MAX(t.created_at) AS last_at,
          MAX(COALESCE(t.customer_name, '')) AS resolved_name
        FROM tenders t
        WHERE ${where}
      `, params);

      const total = Number(agg?.total || 0);
      const won = Number(agg?.won || 0);
      const lost = Number(agg?.lost || 0);
      return {
        ok: true,
        inn: inn || null,
        name: (agg && agg.resolved_name) || name || null,
        matched_by: inn ? 'inn' : 'name',
        total,
        review: Number(agg?.review || 0),
        prep: Number(agg?.prep || 0),
        submitted: Number(agg?.submitted || 0),
        won,
        lost,
        cancelled: Number(agg?.cancelled || 0),
        won_sum: Number(agg?.won_sum || 0),
        conversion: (won + lost) > 0 ? Math.round((won / (won + lost)) * 100) : null,
        first_at: agg?.first_at || null,
        last_at: agg?.last_at || null
      };
    } catch (err) {
      request.log.error(err, 'director-analytics customer');
      return reply.code(500).send({ error: 'customer_failed', message: err.message });
    }
  });

  // ─── GET /tenders/:id ────────────────────────────────────────────────
  fastify.get('/tenders/:id', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    try {
      const id = parseInt(request.params.id, 10);
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad_id' });

      const { rows: [t] } = await db.query(`
        SELECT
          t.*,
          calc.name AS calculator_name,
          pm.name AS pm_name,
          creator.name AS created_by_name
        FROM tenders t
        LEFT JOIN users calc ON calc.id = t.calculator_user_id
        LEFT JOIN users pm ON pm.id = t.responsible_pm_id
        LEFT JOIN users creator ON creator.id = COALESCE(t.created_by_user_id, t.created_by)
        WHERE t.id = $1
      `, [id]);
      if (!t) return reply.code(404).send({ error: 'not_found' });

      const [docs, estimate, checklist, review] = await Promise.all([
        db.query(`
          SELECT id, original_name, filename AS file_name, mime_type, size_bytes, created_at
          FROM documents WHERE tender_id = $1
          ORDER BY created_at DESC LIMIT 50
        `, [id]).catch(() => db.query(`
          SELECT id, original_name, filename AS file_name, mime_type, created_at
          FROM documents WHERE tender_id = $1
          ORDER BY created_at DESC LIMIT 50
        `, [id]).catch(() => ({ rows: [] }))),
        db.query(`
          SELECT id, amount, cost, margin, approval_status, created_at, updated_at
          FROM estimates WHERE tender_id = $1
          ORDER BY id DESC LIMIT 5
        `, [id]).catch(() => ({ rows: [] })),
        db.query(`
          SELECT id, answers, free_answers, template_snapshot, updated_at, created_at
          FROM tender_analysis_checklists WHERE tender_id = $1
          ORDER BY id DESC LIMIT 1
        `, [id]).catch(() => ({ rows: [] })),
        db.query(`
          SELECT tr.*,
                 calc.name AS calculator_name,
                 owneru.name AS analysis_owner_name,
                 starter.name AS started_by_name,
                 af.name AS analysis_finalized_by_name,
                 ff.name AS finalized_by_name
          FROM tender_rp_reviews tr
          LEFT JOIN users calc ON calc.id = tr.calculator_user_id
          LEFT JOIN users owneru ON owneru.id = tr.analysis_owner_user_id
          LEFT JOIN users starter ON starter.id = tr.started_by_user_id
          LEFT JOIN users af ON af.id = tr.analysis_finalized_by_user_id
          LEFT JOIN users ff ON ff.id = tr.finalized_by_user_id
          WHERE tr.tender_id = $1
          LIMIT 1
        `, [id]).catch(() => ({ rows: [] }))
      ]);

      const rp = review.rows[0] || null;
      const smeta = extractSmeta(rp && rp.report_json);
      const wp = resolveWorkPrice(rp || {});
      const cl = extractChecklistItems(checklist.rows[0] || null);
      const nmck = t.tender_price != null ? Number(t.tender_price) : null;
      const price = Number(t.submission_price || t.tender_price || 0) || null;
      const closed = !OPEN_REGISTRY.has(String(t.registry_status || ''));
      const analyzerName = (rp && (rp.analysis_owner_name || rp.started_by_name)) || null;
      const analyzerId = rp && (rp.analysis_owner_user_id || rp.started_by_user_id) || null;
      const analyzerAt = rp && (rp.analysis_finalized_at || rp.started_at || rp.created_at) || null;
      const calcName = (rp && rp.calculator_name) || t.calculator_name || null;
      const calcId = (rp && rp.calculator_user_id) || t.calculator_user_id || null;
      const calcAt = rp && (rp.finalized_at || rp.analysis_finalized_at) || null;

      let reportText = '';
      const rj = parseJsonMaybe(rp && rp.report_json) || {};
      reportText = rj.conclusion || rj.summary || rj.text || rj.recommendation
        || (rp && rp.recommendation) || '';
      if (!reportText && rj && typeof rj === 'object') {
        try { reportText = ''; } catch (_) { /* keep empty */ }
      }

      return {
        id: t.id,
        title: t.tender_title,
        customer_name: t.customer_name,
        customer_inn: t.customer_inn,
        registry_status: t.registry_status,
        tender_status: t.tender_status,
        docs_deadline: t.docs_deadline,
        purchase_url: t.purchase_url,
        platform: platformFromUrl(t.purchase_url),
        registry_no: t.registry_no || t.notice_number || null,
        region: t.region || t.delivery_place || t.city || null,
        nmck,
        price,
        price_with_vat: t.tender_price_with_vat != null ? Number(t.tender_price_with_vat) : null,
        due_flag: dueFlagOf(t.docs_deadline, closed),
        days_left: daysLeftOf(t.docs_deadline),
        outcome: tenderOutcome(t),
        audit: [
          {
            role: 'Добавил тендер',
            name: t.created_by_name || null,
            user_id: t.created_by_user_id || t.created_by || null,
            at: t.created_at
          },
          {
            role: 'Анализировал',
            name: analyzerName,
            user_id: analyzerId,
            at: analyzerAt
          },
          {
            role: 'Считал смету',
            name: calcName,
            user_id: calcId,
            at: calcAt
          },
          {
            role: 'Ответственный РП',
            name: t.pm_name || null,
            user_id: t.responsible_pm_id || null,
            at: t.created_at
          }
        ].filter((r) => r.name),
        calculator: calcId ? {
          id: calcId,
          name: calcName,
          kind: t.calculator_kind || (rp && rp.report_kind) || null
        } : null,
        analyzer: analyzerId ? { id: analyzerId, name: analyzerName } : null,
        pm: t.responsible_pm_id ? { id: t.responsible_pm_id, name: t.pm_name } : null,
        created_by: (t.created_by_user_id || t.created_by) ? {
          id: t.created_by_user_id || t.created_by,
          name: t.created_by_name
        } : null,
        created_at: t.created_at,
        manual_documents: t.manual_documents || null,
        has_documents: !!t.has_documents,
        documents: docs.rows.map((d) => ({
          id: d.id,
          name: d.original_name || d.file_name,
          file_name: d.file_name,
          mime_type: d.mime_type,
          size: d.size_bytes != null ? Number(d.size_bytes) : null,
          created_at: d.created_at,
          ext: (d.original_name || d.file_name || '').split('.').pop()
        })),
        estimates: estimate.rows.map((e) => ({
          id: e.id,
          amount: e.amount != null ? Number(e.amount) : null,
          cost: e.cost != null ? Number(e.cost) : null,
          margin: e.margin != null ? Number(e.margin) : null,
          approval_status: e.approval_status
        })),
        estimate: {
          rows: smeta.rows,
          totals: smeta.totals || (estimate.rows[0] ? {
            total_no_vat: estimate.rows[0].amount != null ? Number(estimate.rows[0].amount) : null,
            cost_total: estimate.rows[0].cost != null ? Number(estimate.rows[0].cost) : null,
            margin_pct: estimate.rows[0].margin != null ? Number(estimate.rows[0].margin) : null,
            vat: null,
            total_with_vat: null,
            margin_rub: null
          } : null)
        },
        checklist: cl,
        rp_review: rp ? {
          decision: rp.decision,
          report_kind: rp.report_kind,
          kind: rp.report_kind || t.calculator_kind || null,
          work_price: wp.exVat,
          work_price_with_vat: wp.withVat,
          cost: rp.cost_without_vat != null ? Number(rp.cost_without_vat)
            : (rj.cost != null ? Number(rj.cost) : (smeta.totals && smeta.totals.cost_total)),
          margin_pct: smeta.totals && smeta.totals.margin_pct != null
            ? smeta.totals.margin_pct
            : (rj.margin_pct != null ? Number(rj.margin_pct) : null),
          margin_rub: smeta.totals && smeta.totals.margin_rub != null
            ? smeta.totals.margin_rub : null,
          recommendation: rj.recommendation || rj.conclusion || reportText || null,
          report_text: reportText || null,
          is_final: rp.is_final,
          report_json: rp.report_json,
          analysis: {
            summary: asText(rj.summary),
            scope: asText(rj.scope),
            risks: asList(rj.risks),
            feasibility: asText(rj.feasibility),
            recommendation: asText(rj.recommendation || rj.conclusion),
            competition: asText(rj.competition),
            questions: asList(rj.questions_for_customer),
            duration_days: rj.duration_days != null ? Number(rj.duration_days) : null,
            mode: rj.mode || null
          },
          tech_plan: (function () {
            const tj = parseJsonMaybe(rp.tech_json) || {};
            return {
              mtr: asList(tj.mtr),
              crew: asList(tj.crew),
              schedule: tj.schedule || null,
              filled_by: tj.filled_by || null
            };
          })(),
          calculator: rp.calculator_user_id
            ? { id: rp.calculator_user_id, name: rp.calculator_name } : null,
          analysis_finalized_at: rp.analysis_finalized_at,
          finalized_at: rp.analysis_finalized_at || null
        } : null
      };
    } catch (err) {
      request.log.error(err, 'director-analytics tender detail');
      return reply.code(500).send({ error: 'tender_detail_failed', message: err.message });
    }
  });

  // ─── GET /applications/by-status?period= ─────────────────────────────
  // Канбан V3 колонки (application + pre_tender), не сырой pre_tender.status.
  fastify.get('/applications/by-status', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    try {
      const period = parsePeriod(request.query.period);
      const params = [APP_FLOW_TYPES, [...OPEN_APP_COLS]];
      const p = periodSql('c.created_at', period, params);
      const { rows } = await db.query(`
        SELECT c.v3_column AS status, COUNT(*)::int AS count,
               COALESCE(SUM(
                 CASE WHEN c.entity_kind = 'pre_tender' THEN pt.estimated_sum ELSE NULL END
               ), 0)::float AS sum,
               MIN(pt.work_deadline) FILTER (
                 WHERE pt.work_deadline IS NOT NULL
                   AND c.v3_column = ANY($2::text[])
               ) AS nearest_deadline
        FROM v_unified_kanban_cards c
        LEFT JOIN pre_tender_requests pt
          ON c.entity_kind = 'pre_tender' AND pt.id = c.entity_id
        WHERE c.flow_type = ANY($1::text[])
          AND (c.is_closed = FALSE OR c.current_main_status IN ('trash','done'))
          AND (${p.clause})
        GROUP BY c.v3_column
      `, p.params);

      const map = Object.fromEntries(rows.map((r) => [r.status, r]));
      const byStatus = APP_STATUSES.map((status) => ({
        status,
        label: APP_STATUS_LABELS[status],
        count: Number(map[status]?.count || 0),
        sum: status === 'trash' ? null : Number(map[status]?.sum || 0),
        nearest_deadline: map[status]?.nearest_deadline || null
      }));
      return {
        period,
        total: byStatus.reduce((s, x) => s + x.count, 0),
        byStatus
      };
    } catch (err) {
      request.log.error(err, 'director-analytics applications/by-status');
      return reply.code(500).send({ error: 'applications_by_status_failed', message: err.message });
    }
  });

  // ─── GET /applications?period=&status= ───────────────────────────────
  fastify.get('/applications', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    try {
      const period = parsePeriod(request.query.period);
      const status = String(request.query.status || '').trim();
      if (status && !APP_STATUSES.includes(status)) {
        return reply.code(400).send({ error: 'bad_status', allowed: APP_STATUSES });
      }
      const params = [APP_FLOW_TYPES];
      const p = periodSql('c.created_at', period, params);
      let statusClause = 'TRUE';
      if (status) {
        params.push(status);
        statusClause = `c.v3_column = $${params.length}`;
      }
      params.push(Math.min(parseInt(request.query.limit, 10) || 200, 500));
      const limitIdx = params.length;

      const { rows } = await db.query(`
        SELECT
          c.id AS card_id, c.entity_id, c.entity_kind, c.v3_column AS status,
          c.owner_user_id, ou.name AS owner_name,
          c.last_moved_at, c.created_at AS card_created_at,
          pt.id AS pt_id, pt.customer_name, pt.customer_email, pt.customer_inn,
          pt.contact_person, pt.work_description, pt.work_location,
          pt.work_deadline, pt.estimated_sum::float AS estimated_sum,
          pt.ai_summary, pt.ai_color, pt.ai_work_match_score,
          pt.source_type, pt.has_documents, pt.created_at, pt.updated_at,
          pt.assigned_to, au.name AS assigned_name,
          pt.created_tender_id,
          ia.subject AS ia_subject, ia.source_name AS ia_customer,
          ia.ai_color AS ia_ai_color, ia.created_at AS ia_created_at
        FROM v_unified_kanban_cards c
        LEFT JOIN users ou ON ou.id = c.owner_user_id
        LEFT JOIN pre_tender_requests pt
          ON c.entity_kind = 'pre_tender' AND pt.id = c.entity_id
        LEFT JOIN users au ON au.id = pt.assigned_to
        LEFT JOIN inbox_applications ia
          ON c.entity_kind = 'inbox_application' AND ia.id = c.entity_id
        WHERE c.flow_type = ANY($1::text[])
          AND (c.is_closed = FALSE OR c.current_main_status IN ('trash','done'))
          AND (${p.clause}) AND (${statusClause})
        ORDER BY COALESCE(pt.work_deadline, c.created_at) NULLS LAST, c.id DESC
        LIMIT $${limitIdx}
      `, params);

      return {
        period,
        status: status || null,
        items: rows.map((r) => {
          const closed = CLOSED_APP_COLS.has(r.status);
          const deadline = r.work_deadline || null;
          return {
            id: r.pt_id || r.entity_id,
            card_id: r.card_id,
            entity_kind: r.entity_kind,
            customer_name: r.customer_name || r.ia_customer || null,
            customer_email: r.customer_email,
            customer_inn: r.customer_inn,
            contact_person: r.contact_person,
            work_description: r.work_description || r.ia_subject,
            work_location: r.work_location,
            work_deadline: deadline,
            estimated_sum: r.estimated_sum,
            ai_summary: r.ai_summary,
            ai_color: r.ai_color || r.ia_ai_color,
            ai_confidence: r.ai_work_match_score != null ? Number(r.ai_work_match_score) : null,
            status: r.status,
            status_label: APP_STATUS_LABELS[r.status] || r.status,
            source_type: r.source_type,
            has_documents: r.has_documents,
            created_at: r.created_at || r.ia_created_at || r.card_created_at,
            due_flag: dueFlagOf(deadline, closed),
            days_left: daysLeftOf(deadline),
            assigned: r.assigned_to ? { id: r.assigned_to, name: r.assigned_name } : null,
            owner: r.owner_user_id ? { id: r.owner_user_id, name: r.owner_name } : null,
            created_tender_id: r.created_tender_id
          };
        })
      };
    } catch (err) {
      request.log.error(err, 'director-analytics applications list');
      return reply.code(500).send({ error: 'applications_list_failed', message: err.message });
    }
  });

  // ─── GET /applications/:id ───────────────────────────────────────────
  // id = entity_id pre_tender (основной) либо card_id через ?card=1
  fastify.get('/applications/:id', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    try {
      const id = parseInt(request.params.id, 10);
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad_id' });

      const { rows: [pt] } = await db.query(`
        SELECT pt.*,
          au.name AS assigned_name,
          du.name AS decision_name,
          cu.name AS created_by_name
        FROM pre_tender_requests pt
        LEFT JOIN users au ON au.id = pt.assigned_to
        LEFT JOIN users du ON du.id = pt.decision_by
        LEFT JOIN users cu ON cu.id = pt.created_by
        WHERE pt.id = $1
      `, [id]);
      if (!pt) return reply.code(404).send({ error: 'not_found' });

      const { rows: [card] } = await db.query(`
        SELECT c.id, c.v3_column, c.owner_user_id, u.name AS owner_name,
               c.created_at, c.last_moved_at
        FROM v_unified_kanban_cards c
        LEFT JOIN users u ON u.id = c.owner_user_id
        WHERE c.entity_kind = 'pre_tender' AND c.entity_id = $1
        ORDER BY c.id DESC LIMIT 1
      `, [id]).catch(() => ({ rows: [] }));

      const v3 = (card && card.v3_column) || null;

      let estimate = null;
      let estimateRows = [];
      let estimateTotals = null;
      if (pt.created_tender_id) {
        const { rows } = await db.query(`
          SELECT id, amount, cost, margin, approval_status
          FROM estimates WHERE tender_id = $1 ORDER BY id DESC LIMIT 1
        `, [pt.created_tender_id]).catch(() => ({ rows: [] }));
        estimate = rows[0] || null;
        const { rows: revRows } = await db.query(`
          SELECT report_json FROM tender_rp_reviews WHERE tender_id = $1 LIMIT 1
        `, [pt.created_tender_id]).catch(() => ({ rows: [] }));
        if (revRows[0]) {
          const sm = extractSmeta(revRows[0].report_json);
          estimateRows = sm.rows;
          estimateTotals = sm.totals;
        }
      }

      const { rows: hist } = await db.query(`
        SELECT h.id, h.from_main_status, h.to_main_status, h.note, h.moved_at,
               u.name AS by_name, h.moved_by
        FROM personal_kanban_card_history h
        LEFT JOIN users u ON u.id = h.moved_by
        WHERE h.card_id = $1
        ORDER BY h.moved_at DESC
        LIMIT 40
      `, [card ? card.id : -1]).catch(() => ({ rows: [] }));

      const docs = [];
      const manual = parseJsonMaybe(pt.manual_documents);
      if (Array.isArray(manual)) {
        manual.forEach((d, i) => {
          docs.push({
            id: d.id || ('m' + i),
            name: d.name || d.filename || d.original_filename || ('Документ ' + (i + 1)),
            size: d.size || null,
            mime_type: d.mime_type || null,
            created_at: d.created_at || null,
            ext: String(d.name || d.filename || '').split('.').pop()
          });
        });
      }

      const closed = v3 ? CLOSED_APP_COLS.has(v3) : false;
      return {
        id: pt.id,
        card_id: card ? card.id : null,
        customer_name: pt.customer_name,
        customer_email: pt.customer_email,
        customer_inn: pt.customer_inn,
        contact_person: pt.contact_person,
        contact_phone: pt.contact_phone,
        work_description: pt.work_description,
        work_location: pt.work_location,
        work_deadline: pt.work_deadline,
        estimated_sum: pt.estimated_sum != null ? Number(pt.estimated_sum) : null,
        ai_summary: pt.ai_summary,
        ai_color: pt.ai_color,
        ai_recommendation: pt.ai_recommendation,
        ai_confidence: pt.ai_work_match_score != null ? Number(pt.ai_work_match_score)
          : (pt.ai_confidence != null ? Number(pt.ai_confidence) : null),
        status: v3 || pt.status,
        status_label: APP_STATUS_LABELS[v3] || APP_STATUS_LABELS[pt.status] || pt.status,
        source_type: pt.source_type,
        has_documents: pt.has_documents,
        documents: docs,
        manual_documents: pt.manual_documents,
        created_at: pt.created_at,
        updated_at: pt.updated_at,
        decision_at: pt.decision_at,
        decision_comment: pt.decision_comment,
        reject_reason: pt.reject_reason,
        due_flag: dueFlagOf(pt.work_deadline, closed),
        days_left: daysLeftOf(pt.work_deadline),
        outcome: (v3 === 'lose' || pt.status === 'rejected' || pt.status === 'expired')
          ? {
            kind: 'lose',
            reason: pt.reject_reason || pt.decision_comment || 'Причина не указана',
            detail: null,
            by: pt.decision_name || null,
            at: pt.decision_at || pt.updated_at
          }
          : (v3 === 'trash' ? {
            kind: 'cancel',
            reason: pt.reject_reason || 'В корзине',
            detail: null,
            by: pt.decision_name || null,
            at: pt.updated_at
          } : null),
        audit: [
          {
            role: 'Создал',
            name: pt.created_by_name,
            user_id: pt.created_by,
            at: pt.created_at
          },
          {
            role: 'Владелец карточки',
            name: card ? card.owner_name : null,
            user_id: card ? card.owner_user_id : null,
            at: card ? card.created_at : null
          },
          {
            role: 'Назначен',
            name: pt.assigned_name,
            user_id: pt.assigned_to,
            at: pt.updated_at
          }
        ].filter((r) => r.name),
        assigned: pt.assigned_to ? { id: pt.assigned_to, name: pt.assigned_name } : null,
        decision_by: pt.decision_by ? { id: pt.decision_by, name: pt.decision_name } : null,
        created_by: pt.created_by ? { id: pt.created_by, name: pt.created_by_name } : null,
        created_tender_id: pt.created_tender_id,
        history: hist.map((h) => ({
          id: h.id,
          at: h.moved_at,
          status: h.to_main_status,
          from: h.from_main_status,
          by: h.by_name,
          note: h.note
        })),
        estimate: estimate || estimateRows.length || estimateTotals ? {
          id: estimate ? estimate.id : null,
          amount: estimate && estimate.amount != null ? Number(estimate.amount) : null,
          cost: estimate && estimate.cost != null ? Number(estimate.cost) : null,
          margin: estimate && estimate.margin != null ? Number(estimate.margin) : null,
          approval_status: estimate ? estimate.approval_status : null,
          rows: estimateRows,
          totals: estimateTotals
        } : null
      };
    } catch (err) {
      request.log.error(err, 'director-analytics application detail');
      return reply.code(500).send({ error: 'application_detail_failed', message: err.message });
    }
  });

  // ─── GET /works?bucket=active|pause|archive ──────────────────────────
  fastify.get('/works', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    try {
      const bucket = String(request.query.bucket || 'active');
      if (!['active', 'pause', 'archive', 'all'].includes(bucket)) {
        return reply.code(400).send({ error: 'bad_bucket' });
      }

      const { rows } = await db.query(`
        SELECT
          w.id, w.work_title, w.object_name, w.city, w.customer_name, w.customer_inn,
          w.work_status, w.pm_id, pm.name AS pm_name,
          w.start_plan, w.start_in_work_date, w.start_fact,
          w.end_plan, w.end_fact,
          w.contract_value::float AS contract_value,
          w.cost_plan::float AS cost_plan,
          w.cost_fact::float AS cost_fact,
          w.advance_received::float AS advance_received,
          w.balance_received::float AS balance_received,
          w.tender_id,
          (
            SELECT COUNT(*)::int FROM employee_assignments ea
            WHERE ea.work_id = w.id AND ea.is_active = true
              AND (ea.departure_date IS NULL OR ea.departure_date > CURRENT_DATE)
          ) AS brigade_count,
          (
            SELECT MAX(fc.date) FROM field_checkins fc WHERE fc.work_id = w.id
          ) AS last_checkin
        FROM works w
        LEFT JOIN users pm ON pm.id = w.pm_id
        WHERE w.deleted_at IS NULL
        ORDER BY w.end_plan NULLS LAST, w.id DESC
        LIMIT 500
      `);

      const items = rows.map(r => {
        const contract = Number(r.contract_value || 0);
        const cost = r.cost_fact != null ? Number(r.cost_fact) : (r.cost_plan != null ? Number(r.cost_plan) : null);
        const marginAbs = cost != null ? contract - cost : null;
        const marginPct = (cost != null && contract > 0)
          ? Math.round(((contract - cost) / contract) * 1000) / 10
          : null;
        const endPlan = r.end_plan ? new Date(r.end_plan) : null;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        let daysLeft = null;
        let scheduleOk = null;
        if (endPlan && !workStatus.isClosedOrCancelled(r.work_status)) {
          daysLeft = Math.ceil((endPlan - today) / 86400000);
          scheduleOk = daysLeft >= 0;
        }
        const b = workBucket(r.work_status);
        const received = (Number(r.advance_received || 0) + Number(r.balance_received || 0)) || null;
        return {
          id: r.id,
          title: r.work_title || r.object_name,
          object_name: r.object_name,
          city: r.city,
          customer_name: r.customer_name,
          work_status: r.work_status,
          bucket: b,
          pm: r.pm_id ? { id: r.pm_id, name: r.pm_name } : null,
          start: r.start_fact || r.start_in_work_date || r.start_plan,
          end_plan: r.end_plan,
          end_fact: r.end_fact,
          days_left: daysLeft,
          due_flag: dueFlagOf(r.end_plan, b === 'archive'),
          schedule_light: scheduleLightOf(daysLeft, r.work_status),
          contract_value: contract || null,
          cost_plan: r.cost_plan,
          cost_fact: r.cost_fact,
          cost_current: cost,
          margin_abs: marginAbs,
          margin_pct: marginPct,
          tone: marginTone(marginPct, scheduleOk),
          advance_received: r.advance_received,
          balance_received: r.balance_received,
          received,
          leftover: contract && received != null ? contract - received : null,
          brigade_count: r.brigade_count || 0,
          last_checkin: r.last_checkin,
          tender_id: r.tender_id
        };
      }).filter(x => bucket === 'all' || x.bucket === bucket);

      return {
        bucket,
        counts: {
          active: rows.filter(r => workBucket(r.work_status) === 'active').length,
          pause: rows.filter(r => workBucket(r.work_status) === 'pause').length,
          archive: rows.filter(r => workBucket(r.work_status) === 'archive').length
        },
        items
      };
    } catch (err) {
      request.log.error(err, 'director-analytics works list');
      return reply.code(500).send({ error: 'works_list_failed', message: err.message });
    }
  });

  // ─── GET /works/:id ──────────────────────────────────────────────────
  fastify.get('/works/:id', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    try {
      const id = parseInt(request.params.id, 10);
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad_id' });

      const { rows: [w] } = await db.query(`
        SELECT w.*, pm.name AS pm_name, t.tender_title, t.purchase_url
        FROM works w
        LEFT JOIN users pm ON pm.id = w.pm_id
        LEFT JOIN tenders t ON t.id = w.tender_id
        WHERE w.id = $1 AND w.deleted_at IS NULL
      `, [id]);
      if (!w) return reply.code(404).send({ error: 'not_found' });

      const [brigade, timesheet, checkins] = await Promise.all([
        db.query(`
          SELECT ea.employee_id, e.fio, e.full_name, ea.field_role,
                 ea.tariff_points, ea.per_diem,
                 ea.date_from, ea.date_to, ea.departure_date, ea.is_active,
                 (
                   SELECT er.day_rate FROM employee_rates er
                   WHERE er.employee_id = ea.employee_id AND er.effective_to IS NULL
                   ORDER BY er.effective_from DESC LIMIT 1
                 ) AS day_rate
          FROM employee_assignments ea
          LEFT JOIN employees e ON e.id = ea.employee_id
          WHERE ea.work_id = $1
          ORDER BY ea.is_active DESC, ea.date_from DESC NULLS LAST
          LIMIT 100
        `, [id]).catch(() => ({ rows: [] })),
        db.query(`
          SELECT to_char(fc.date, 'YYYY-MM') AS month,
                 COUNT(DISTINCT fc.employee_id)::int AS people,
                 COUNT(*)::int AS marks
          FROM field_checkins fc
          WHERE fc.work_id = $1
          GROUP BY to_char(fc.date, 'YYYY-MM')
          ORDER BY month DESC
          LIMIT 18
        `, [id]).catch(() => ({ rows: [] })),
        db.query(`
          SELECT fc.date, fc.status, fc.employee_id,
                 COALESCE(e.fio, e.full_name) AS fio,
                 fc.checkin_at, fc.checkout_at, fc.day_rate
          FROM field_checkins fc
          LEFT JOIN employees e ON e.id = fc.employee_id
          WHERE fc.work_id = $1
          ORDER BY fc.date DESC, fc.id DESC
          LIMIT 40
        `, [id]).catch(() => ({ rows: [] }))
      ]);

      const contract = Number(w.contract_value || 0);
      const cost = w.cost_fact != null ? Number(w.cost_fact) : (w.cost_plan != null ? Number(w.cost_plan) : null);
      const marginPct = (cost != null && contract > 0)
        ? Math.round(((contract - cost) / contract) * 1000) / 10
        : null;
      const daysLeft = daysLeftOf(w.end_plan);
      const scheduleOk = daysLeft == null ? null : daysLeft >= 0;
      const bucket = workBucket(w.work_status);
      const received = (Number(w.advance_received || 0) + Number(w.balance_received || 0)) || 0;
      const leftover = contract ? contract - received : null;
      const paidPct = contract > 0 ? Math.round((received / contract) * 1000) / 10 : null;
      const spentPct = (contract > 0 && cost != null)
        ? Math.round((cost / contract) * 1000) / 10 : null;

      // Люди × месяцы для богатого табеля
      const { rows: tsPeople } = await db.query(`
        SELECT to_char(fc.date, 'YYYY-MM') AS month,
               fc.employee_id,
               COALESCE(e.fio, e.full_name) AS name,
               COUNT(*)::int AS days,
               AVG(fc.day_rate)::float AS day_rate
        FROM field_checkins fc
        LEFT JOIN employees e ON e.id = fc.employee_id
        WHERE fc.work_id = $1
        GROUP BY to_char(fc.date, 'YYYY-MM'), fc.employee_id, e.fio, e.full_name
        ORDER BY month DESC, name
        LIMIT 200
      `, [id]).catch(() => ({ rows: [] }));

      const byMonth = {};
      timesheet.rows.forEach((r) => {
        byMonth[r.month] = {
          month: r.month,
          people: r.people,
          marks: r.marks,
          persons: []
        };
      });
      tsPeople.forEach((r) => {
        if (!byMonth[r.month]) {
          byMonth[r.month] = { month: r.month, people: 0, marks: 0, persons: [] };
        }
        byMonth[r.month].persons.push({
          employee_id: r.employee_id,
          name: r.name,
          days: r.days,
          day_rate: r.day_rate != null ? Number(r.day_rate) : null,
          accrued: (r.day_rate != null && r.days)
            ? Math.round(Number(r.day_rate) * r.days) : null
        });
      });

      return {
        id: w.id,
        title: w.work_title || w.object_name,
        object_name: w.object_name,
        city: w.city,
        address: w.address || w.object_address || null,
        work_number: w.work_number || w.contract_number || null,
        customer_name: w.customer_name,
        customer_inn: w.customer_inn,
        work_status: w.work_status,
        bucket,
        pause_reason: bucket === 'pause'
          ? (w.pause_reason || w.notes || w.description || null) : null,
        pm: w.pm_id ? { id: w.pm_id, name: w.pm_name } : null,
        start_plan: w.start_plan,
        start_in_work_date: w.start_in_work_date,
        start_fact: w.start_fact,
        end_plan: w.end_plan,
        end_fact: w.end_fact,
        days_left: daysLeft,
        due_flag: dueFlagOf(w.end_plan, bucket === 'archive'),
        schedule_light: scheduleLightOf(daysLeft, w.work_status),
        contract_value: contract || null,
        cost_plan: w.cost_plan != null ? Number(w.cost_plan) : null,
        cost_fact: w.cost_fact != null ? Number(w.cost_fact) : null,
        cost_current: cost,
        margin_abs: cost != null ? contract - cost : null,
        margin_pct: marginPct,
        tone: marginTone(marginPct, scheduleOk),
        advance_received: w.advance_received != null ? Number(w.advance_received) : null,
        balance_received: w.balance_received != null ? Number(w.balance_received) : null,
        received,
        leftover,
        paid_pct: paidPct,
        spent_pct: spentPct,
        tender: w.tender_id ? {
          id: w.tender_id,
          title: w.tender_title,
          purchase_url: w.purchase_url
        } : null,
        brigade: brigade.rows.map((b) => ({
          employee_id: b.employee_id,
          name: b.fio || b.full_name,
          role: b.field_role,
          rate: b.day_rate != null ? Number(b.day_rate) : null,
          tariff_points: b.tariff_points,
          per_diem: b.per_diem != null ? Number(b.per_diem) : null,
          arrival_date: b.date_from,
          departure_date: b.departure_date || b.date_to,
          is_active: b.is_active
        })),
        timesheet_by_month: Object.values(byMonth).sort((a, b) => String(b.month).localeCompare(String(a.month))),
        recent_checkins: checkins.rows.map((c) => ({
          date: c.date,
          status: c.status,
          kind: c.status,
          ok: !c.status || !/опозд|absent|нет|fail/i.test(String(c.status)),
          employee_id: c.employee_id,
          name: c.fio,
          check_in_at: c.checkin_at,
          check_out_at: c.checkout_at,
          day_rate: c.day_rate != null ? Number(c.day_rate) : null,
          note: null
        }))
      };
    } catch (err) {
      request.log.error(err, 'director-analytics work detail');
      return reply.code(500).send({ error: 'work_detail_failed', message: err.message });
    }
  });

  // ─── GET /team-hours?period=week|month|year&date=YYYY-MM-DD ──────────
  // Секция «График офиса»: список сотрудников — офис / удалённо / сумма /
  // норма и цвет дисциплины (green / yellow / red).
  //
  // ВАЖНО (правила из плана, не «оптимизировать»):
  //  · средние считаются только по дням, где данные ЕСТЬ; нет данных → null,
  //    а не 0 (иначе «в офисе 0 ч», хотя импорта просто не было);
  //  · в норму идут только дни, которые creditDay пометил counts_in_norm
  //    (бн/сс/вх/отп выпадают, нп и no_crm_data недоработку не начисляют);
  //  · люди без нормы в периоде (отпуск/больничный целиком) не попадают
  //    в знаменатель people_total.
  fastify.get('/team-hours', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    try {
      const periodQ = String(request.query.period || 'week');
      const scope = periodQ === 'month' ? 'month' : (periodQ === 'year' ? 'year' : 'week');
      const todayIso = officeHours.isoOf(new Date());
      const dateParam = /^\d{4}-\d{2}-\d{2}$/.test(String(request.query.date || ''))
        ? String(request.query.date).slice(0, 10)
        : null;
      let anchor = dateParam || todayIso;

      // Норма начисляется только по прошедшим дням: если смотреть текущий
      // месяц/год, будущие дни не должны превращать всех в «красных».
      // Будущее в подписи периода остаётся (месяц — целиком), но в норму идёт
      // не дальше сегодня.
      const buildRange = (iso) => {
        const full = scope === 'week'
          ? {
            from: officeHours.mondayOf(iso),
            to: officeHours.addDays(officeHours.mondayOf(iso), 6)
          }
          : scope === 'year'
            ? officeHours.yearRange(isoYear(iso))
            : officeHours.monthRange(isoYear(iso), isoMonth(iso));
        const counted = (full.from <= todayIso && todayIso < full.to)
          ? { ...full, to: todayIso }
          : full;
        return { full, counted };
      };
      let { full: rangeFull, counted: range } = buildRange(anchor);

      const settings = await officeHours.loadSettings(db);

      // ── Покрытие СКУД по периодам импортов ──
      // Считается ДО разбора дней: норма начисляется только за дни, за которые
      // отчёт реально был. Иначе неимпортированный ноябрь даёт «все прогуляли».
      const { rows: importRows } = await db.query(
        `SELECT id, period_from::text AS period_from, period_to::text AS period_to,
                imported_at, source, file_name
           FROM skud_imports
          WHERE deleted_at IS NULL
          ORDER BY imported_at DESC
          LIMIT 60`).catch(() => ({ rows: [] }));
      const lastImport = importRows[0] || null;
      const coveredDays = new Set();
      for (const imp of importRows) {
        let iso = String(imp.period_from).slice(0, 10);
        const end = String(imp.period_to).slice(0, 10);
        let guard = 0;
        while (iso <= end && guard < 400) {
          coveredDays.add(iso);
          iso = officeHours.addDays(iso, 1);
          guard += 1;
        }
      }

      // Период «по умолчанию» открываем на данных, а не на пустоте: если за
      // текущий месяц/неделю отчёта СКУД ещё нет (на проде залит октябрь),
      // показываем последний покрытый период. Явный ?date= не переопределяем.
      //
      // Считаем РАБОЧИЕ дни: отчёт может «зацепить» только воскресенье 01.11 —
      // формально покрытие есть, а нормы и людей за ним нет. Такой период
      // пустой и для директора бесполезен.
      const workingCovered = (r) => {
        let iso = r.from;
        let guard = 0;
        while (iso <= r.to && guard < 400) {
          if (coveredDays.has(iso)
              && officeHours.dayNormMinutes(iso, {}, settings, null) > 0) return true;
          iso = officeHours.addDays(iso, 1);
          guard += 1;
        }
        return false;
      };
      if (!dateParam && lastImport && !workingCovered(rangeFull)) {
        // Якорь выбираем так, чтобы период реально содержал рабочие дни с
        // отчётом: для месяца/года — начало импорта (месяц октябрь), для
        // недели — конец импорта (неделя, в которую он попал).
        const candidates = scope === 'week'
          ? [String(lastImport.period_to).slice(0, 10), String(lastImport.period_from).slice(0, 10)]
          : [String(lastImport.period_from).slice(0, 10), String(lastImport.period_to).slice(0, 10)];
        const picked = candidates.find((iso) => workingCovered(buildRange(iso).full));
        if (picked) {
          anchor = picked;
          ({ full: rangeFull, counted: range } = buildRange(anchor));
        }
      }
      const meta = periodMeta(scope, rangeFull);
      // Календарь читаем ПОСЛЕ авто-перехода: иначе нормы считаются по
      // диапазону, который уже заменён на покрытый.
      const calendar = await officeHours.loadCalendar(db, range.from, range.to);

      // Кто вообще есть в графике офиса.
      //
      // ВАЖНО: FIELD_WORKER не исключаем. В клоне и на проде есть люди с ролью
      // рабочего (Андросов, 1476 мин офиса за неделю) — часы терять нельзя.
      // Отсекаем только машинные аккаунты и заглушки: без user_id, BOT, тесты.
      const { rows: staffRows } = await db.query(`
        SELECT s.id AS staff_id, s.user_id,
               COALESCE(NULLIF(btrim(u.name), ''), s.name) AS name,
               u.role
          FROM staff s
          LEFT JOIN users u ON u.id = s.user_id
         WHERE COALESCE(s.is_active, true) = true
           AND (u.id IS NULL OR (
                 COALESCE(u.is_active, true) = true
                 AND COALESCE(u.role, '') NOT IN ('BOT')
                 AND LOWER(u.login) NOT LIKE 'test_%'
                 AND LOWER(u.login) NOT IN ('admin')
                 AND LOWER(COALESCE(u.name, '')) NOT LIKE 'test %'
                 AND LOWER(COALESCE(u.name, '')) NOT LIKE 'тест %'
                 AND LOWER(COALESCE(u.name, '')) NOT LIKE '%администратор системы%'
           ))
         ORDER BY COALESCE(NULLIF(btrim(u.name), ''), s.name)`);

      // Статусы дня и часы СКУД — двумя запросами на весь период.
      const { rows: planRows } = await db.query(
        `SELECT staff_id, date::text AS date, status_code
           FROM staff_plan
          WHERE date >= $1::date AND date <= $2::date
            AND status_code IS NOT NULL AND btrim(status_code) <> ''
          ORDER BY id`,
        [range.from, range.to]);
      // На проде встречаются ДУБЛИ staff_plan на один день (оф + уд): человек
      // отметился, потом сменил статус. Для зачёта приоритет у «оф» — он
      // подтверждён СКУД и не должен затираться более поздней отметкой.
      const planMap = new Map();
      planRows.forEach((r) => {
        const key = `${r.staff_id}|${String(r.date).slice(0, 10)}`;
        const prev = planMap.get(key);
        const code = String(r.status_code || '');
        if (!prev) { planMap.set(key, code); return; }
        // Один приоритет свёртки для ВСЕГО модуля: карточки статусов,
        // «прямо сейчас» и модалки должны считать дубли дня одинаково.
        // оф (подтверждён СКУД) > уд > … > нп > отсутствие.
        if (statusPrio(code) < statusPrio(prev)) planMap.set(key, code);
      });

      const { rows: hoursRows } = await db.query(
        `SELECT staff_id, date::text AS date, office_minutes, open_ended, manual_minutes, segments
           FROM office_hours_daily
          WHERE date >= $1::date AND date <= $2::date`,
        [range.from, range.to]);
      const hoursMap = new Map();
      hoursRows.forEach((r) => hoursMap.set(`${r.staff_id}|${String(r.date).slice(0, 10)}`, r));

      // Часы СРМ пачкой: один запрос на всех.
      const userIds = staffRows.map((s) => s.user_id).filter(Boolean);
      let crmMap = new Map();
      if (userIds.length) {
        const { rows: crmRows } = await db.query(
          `SELECT user_id, (minute_ts::date)::text AS date, minute_ts, hits
             FROM crm_activity_token
            WHERE user_id = ANY($1::int[])
              AND minute_ts >= $2::date
              AND minute_ts <  $3::date + INTERVAL '1 day'
            ORDER BY user_id, minute_ts`,
          [userIds, range.from, range.to]);
        const gap = Number(settings.crm_session_gap_min) || crmActivity.DEFAULT_SESSION_GAP_MIN;
        const cap = Number(settings.crm_max_day_minutes) || crmActivity.DEFAULT_MAX_DAY_MINUTES;
        const grouped = new Map();
        for (const r of crmRows) {
          const key = `${r.user_id}|${String(r.date).slice(0, 10)}`;
          if (!grouped.has(key)) grouped.set(key, []);
          // Наивный timestamp хранит московские настенные часы — берём их как
          // есть (getUTC* давал сдвиг на 3 часа при разборе сессий).
          grouped.get(key).push({
            minute: hhmmWallClock(r.minute_ts),
            hits: Number(r.hits || 0)
          });
        }
        for (const [key, minutes] of grouped) {
          const res = crmActivity.buildSessions(minutes, { gapMin: gap, maxDayMinutes: cap });
          crmMap.set(key, {
            minutes: res.totalMinutes,
            hasData: res.sessions.length > 0,
            sessions: res.sessions || []
          });
        }
      }

      // Раскладываем по сотрудникам и дням через тот же creditDay, что и /month.
      const days = [];
      for (let iso = range.from; iso <= range.to; iso = officeHours.addDays(iso, 1)) {
        days.push(iso);
      }

      // До выкатки серверного учёта СРМ дни «удалёнки» недостоверны: клиент
      // писал 0.5 ч на полный день. Такие дни не участвуют в норме вовсе —
      // иначе директор увидит 100 % недоработки у всей компании.
      //
      // Если настройка ещё не выставлена (свежая выкатка), берём дату первого
      // собранного счётчика: это и есть фактический старт учёта. Показывать
      // «все в недоработке» из-за пустой настройки нельзя.
      let sinceIso = settings.crm_activity_since
        ? String(settings.crm_activity_since).slice(0, 10)
        : null;
      if (!sinceIso) {
        const { rows: [firstTok] } = await db.query(
          `SELECT to_char(MIN(minute_ts), 'YYYY-MM-DD') AS first_day FROM crm_activity_token`
        ).catch(() => ({ rows: [null] }));
        if (firstTok && firstTok.first_day) sinceIso = String(firstTok.first_day).slice(0, 10);
      }

      // В норму идут только сотрудники с аккаунтом CRM (решение заказчика):
      // строки-заглушки без user_id — не люди, а площадки.
      //
      // На проде у одного users.id бывает НЕСКОЛЬКО строк staff (дубли вроде
      // agpz × 3, Зубань × 3). Часы СКУД и отметки в staff_plan при этом лежат
      // на РАЗНЫХ строках: если взять «первую», человек с 36 ч в офисе выглядит
      // как «нет данных» (потеря 2197 мин на проде). Поэтому НЕ выбираем одну
      // строку, а объединяем данные по всем staff_id аккаунта.
      const staffByUser = new Map(); // user_id → { user_id, name, role, staffIds: [] }
      for (const s of staffRows) {
        if (s.user_id == null) continue;
        let g = staffByUser.get(s.user_id);
        if (!g) {
          g = { user_id: s.user_id, name: s.name, role: s.role || '', staffIds: [] };
          staffByUser.set(s.user_id, g);
        } else if (!g.name && s.name) {
          g.name = s.name;
        }
        g.staffIds.push(s.staff_id);
      }
      const normStaff = [...staffByUser.values()];

      // Ключ «staff_id|date» → значение. Для плана это строка статуса,
      // для часов — объект записи. Ищем по ВСЕМ строкам аккаунта: при дублях
      // staff данные лежат на другой строке, и «первая» их не видит.
      function pickStatus(grp, iso) {
        for (const sid of grp.staffIds) {
          const code = planMap.get(`${sid}|${iso}`);
          if (code) return code;
        }
        return null;
      }

      function pickHours(grp, iso) {
        // Если записей несколько — берём с наибольшими часами: часы СКУД за
        // один день не могут быть в двух местах, лишнее — артефакт дублей.
        let best = null;
        let bestVal = -1;
        for (const sid of grp.staffIds) {
          const rec = hoursMap.get(`${sid}|${iso}`);
          if (!rec) continue;
          const val = Number(rec.manual_minutes != null ? rec.manual_minutes : rec.office_minutes) || 0;
          if (val > bestVal) { bestVal = val; best = rec; }
        }
        return best;
      }

      const people = normStaff.map((grp) => {
        const perDay = days.map((iso) => {
          const plan = pickStatus(grp, iso);
          const hr = pickHours(grp, iso);
          const crmDay = crmMap.get(`${grp.user_id}|${iso}`)
            || { minutes: 0, hasData: false, sessions: [] };
          const officeMinutes = hr && hr.manual_minutes != null
            ? Number(hr.manual_minutes)
            : Number(hr ? hr.office_minutes : 0);
          const norm = officeHours.dayNormMinutes(iso, calendar, settings, grp.staffIds[0]);
          // Будущий день не судим вовсе: ни нормы, ни цвета, ни короны.
          // Раньше отсечка держалась только на отсутствии импорта СКУД,
          // и предзаполненный отчёт с датой вперёд давал корону за
          // ещё не наступивший день (верификатор 10.11.2026).
          const isFuture = iso > todayIso;
          const credit = officeHours.creditDay({
            date: iso,
            statusCode: plan,
            officeMinutes,
            crmMinutes: crmDay.minutes,
            // Сессии и окна СКУД — чтобы «удалённо» считалось как СРМ ВНЕ
            // офиса, а не как весь СРМ (иначе двойной учёт ноутбука в офисе).
            crmSessions: crmDay.sessions || [],
            officeSegments: officeHours.parseSegments(hr && hr.segments),
            crmHasData: crmDay.hasData,
            skudMissing: !hr,
            normMinutes: isFuture ? 0 : norm
          });
          if (isFuture) {
            credit.counts_in_norm = false;
            credit.source = 'future';
            credit.warn = 'future_day';
            credit.credited_minutes = 0;
          }

          // Legacy-день: до старта серверного учёта СРМ и зачёт должен был бы
          // идти из СРМ — данных нет, поэтому день выпадает из нормы.
          const isLegacy = !!sinceIso && iso < sinceIso
            && (credit.source === 'crm' || credit.source === 'no_crm_data'
                || credit.source === 'crm_no_status' || credit.source === 'no_status');
          // День без отчёта СКУД: норма не начисляется — иначе «нет импорта»
          // выглядит как прогул (правило D-«все прогуляли», повтор 05.11).
          const noSkudCoverage = !coveredDays.has(iso);
          if (isLegacy || noSkudCoverage) {
            credit.counts_in_norm = false;
            credit.source = isLegacy ? 'legacy' : 'skud_not_covered';
            credit.warn = isLegacy ? 'legacy_crm' : 'skud_not_covered';
            credit.credited_minutes = 0;
          }

          return {
            ...credit,
            status_code: plan,
            office_minutes: officeMinutes,
            has_skud: !!hr,
            has_crm_data: crmDay.hasData
          };
        });

        const summary = officeHours.summarizeDays(perDay);
        const officeDays = perDay.filter((d) => d.status_code === officeHours.OFFICE_STATUS || d.source === 'skud' || d.source === 'skud_no_status');
        const crmDays = perDay.filter((d) => d.source === 'crm');
        const underDays = perDay.filter((d) => d.counts_in_norm && d.credited_minutes < d.norm_minutes);
        const workload = officeHours.workloadState({
          workedMinutes: summary.worked_minutes,
          normMinutes: summary.norm_minutes
        });
        return {
          staff_id: grp.staffIds[0],
          staff_ids: grp.staffIds,
          user_id: grp.user_id,
          name: grp.name,
          role: grp.role || '',
          norm_minutes: summary.norm_minutes,
          credited_minutes: summary.credited_minutes,
          worked_minutes: summary.worked_minutes,
          remote_minutes: summary.remote_minutes,
          office_minutes: summary.office_minutes,
          crm_minutes: summary.crm_minutes,
          delta_minutes: summary.delta_minutes,
          ratio_pct: workload.ratio_pct,
          delta_pct: workload.delta_pct,
          state: workload.state,
          crown: false,
          days_counted: summary.days_counted,
          days_under: underDays.length,
          office_days: officeDays.length,
          crm_days: crmDays.length,
          is_under: summary.norm_minutes > 0 && summary.delta_minutes < 0,
          days: perDay
        };
      });

      // ── Средние: только по дням, где данные ЕСТЬ. Нет данных → null ──
      const workingDays = days.filter((iso) => officeHours.dayNormMinutes(iso, calendar, settings, null) > 0);

      // Считаем по КАЛЕНДАРНЫМ дням, а не по человеко-дням: подпись в UI
      // «N чел. в день» требует знаменателя = количество дней с данными.
      const skudDays = new Set();
      const crmDays = new Set();
      let skudMinutesTotal = 0;
      let skudPeopleInOfficeTotal = 0;
      let crmMinutesTotal = 0;
      let crmPeopleTotal = 0;
      let officeEmpDays = 0;

      for (const p of people) {
        for (const d of p.days) {
          if (d.has_skud) {
            skudDays.add(d.date);
            skudMinutesTotal += d.office_minutes;
            if (d.office_minutes > 0) skudPeopleInOfficeTotal += 1;
          }
          if (d.status_code === officeHours.OFFICE_STATUS) officeEmpDays += 1;
          if (d.has_crm_data) {
            crmDays.add(d.date);
            crmMinutesTotal += d.crm_minutes;
            if (d.crm_minutes > 0) crmPeopleTotal += 1;
          }
        }
      }
      const skudDaysWithData = skudDays.size;
      const crmDaysWithData = crmDays.size;

      const inNorm = people.filter((p) => p.norm_minutes > 0);
      // «Под нормой» = не зелёные. Раньше считалось по delta < 0, и человек
      // с −10 % (в пределах допуска 15 %) попадал и в «зелёные», и в список
      // худших недоработчиков одновременно.
      const under = inNorm.filter((p) => p.state === 'yellow' || p.state === 'red');
      const avgDelta = inNorm.length
        ? Math.round(inNorm.reduce((a, p) => a + p.delta_minutes, 0) / inNorm.length)
        : null;

      const worst = under
        .slice()
        .sort((a, b) => a.delta_minutes - b.delta_minutes)
        .slice(0, 12)
        .map((p) => ({
          staff_id: p.staff_id,
          name: p.name,
          role: p.role,
          delta_minutes: p.delta_minutes,
          office_minutes: p.office_minutes,
          crm_minutes: p.crm_minutes,
          norm_minutes: p.norm_minutes,
          credited_minutes: p.credited_minutes,
          days_under: p.days_under
        }));

      // ── «Прямо сейчас» — по сегодняшнему статусу в staff_plan ──
      // Считаем ЛЮДЕЙ, а не строки: у одного аккаунта бывает несколько staff,
      // дубли отметок и даже два статуса за день. DISTINCT (user_id, status)
      // давал бы одному человеку два «места», поэтому сначала сворачиваем до
      // ОДНОГО статуса на человека по приоритету, потом считаем.
      const { rows: todayRows } = await db.query(
        `WITH candidates AS (
           SELECT s.user_id, sp.status_code,
                  CASE sp.status_code
                    WHEN 'оф' THEN 1 WHEN 'уд' THEN 2 WHEN 'об' THEN 3
                    WHEN 'км' THEN 4 WHEN 'пг' THEN 5 WHEN 'уч' THEN 6
                    WHEN 'ск' THEN 7 WHEN 'нп' THEN 8
                    WHEN 'бн' THEN 9 WHEN 'сс' THEN 10 WHEN 'вх' THEN 11
                    ELSE 12
                  END AS prio
             FROM staff_plan sp
             JOIN staff s ON s.id = sp.staff_id
             LEFT JOIN users u ON u.id = s.user_id
            WHERE sp.date = CURRENT_DATE
              AND sp.status_code IS NOT NULL AND btrim(sp.status_code) <> ''
              AND s.user_id IS NOT NULL
              AND (u.id IS NULL OR (
                    COALESCE(u.is_active, true) = true
                    AND COALESCE(u.role, '') NOT IN ('BOT')
                    AND LOWER(u.login) NOT LIKE 'test_%'
                    AND LOWER(COALESCE(u.name, '')) NOT LIKE 'test %'
                    AND LOWER(COALESCE(u.name, '')) NOT LIKE 'тест %'
              ))
         ),
         per_person AS (
           SELECT DISTINCT ON (user_id) user_id, status_code
             FROM candidates
            ORDER BY user_id, prio
         )
         SELECT status_code, COUNT(*)::int AS n FROM per_person GROUP BY status_code`);
      const now = { office: 0, remote: 0, site: 0, trip: 0, study: 0, absent: 0, unconfirmed: 0, total: 0 };
      for (const r of todayRows) {
        const n = Number(r.n || 0);
        const code = String(r.status_code || '');
        now.total += n;
        if (code === 'оф') now.office += n;
        else if (code === 'уд') now.remote += n;
        else if (code === 'об') now.site += n;
        else if (code === 'км' || code === 'пг') now.trip += n;
        else if (code === 'уч' || code === 'ск') now.study += n;
        else if (code === 'нп') now.unconfirmed += n;
        else now.absent += n;
      }

      // ── Качество данных ──
      // coveredDays/lastImport посчитаны выше — до разбора дней, чтобы «нет
      // отчёта» не превращалось в недоработку.
      const skudDaysMissing = workingDays.filter((iso) => !coveredDays.has(iso));

      const { rows: [flagRow] } = await db.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE resolved_at IS NULL)::int AS open
           FROM office_presence_flags
          WHERE date >= $1::date AND date <= $2::date`,
        [range.from, range.to]).catch(() => ({ rows: [{ total: 0, open: 0 }] }));

      const legacyDays = sinceIso
        ? workingDays.filter((iso) => iso < sinceIso).length
        : 0;

      // ── Дисциплина и корона ──
      // Нет ни одного импорта СКУД за контур — судить о выработке нельзя:
      // это «нет данных», а не «все прогуляли». Цвета и корону не ставим.
      if (!lastImport) {
        for (const p of people) {
          p.state = 'none';
          p.crown = false;
        }
      } else {
        let leader = null;
        let best = -1;
        for (const p of people) {
          if (p.state !== 'green' || p.norm_minutes <= 0) continue;
          if (p.worked_minutes > best) { best = p.worked_minutes; leader = p; }
        }
        if (leader && best > 0) {
          for (const p of people) {
            p.crown = p.state === 'green'
              && p.norm_minutes > 0
              && p.worked_minutes === best;
          }
        }
      }

      return {
        ok: true,
        period: {
          scope,
          from: rangeFull.from,
          to: rangeFull.to,
          // Фактически посчитано по: норма не начисляется за будущие дни.
          counted_to: range.to,
          label: meta.label,
          prev_anchor: meta.prev_anchor,
          next_anchor: meta.next_anchor,
          current_anchor: meta.current_anchor,
          working_days: workingDays.length
        },
        now,
        avg: {
          office_minutes_per_day: skudDaysWithData ? Math.round(skudMinutesTotal / skudDaysWithData) : null,
          crm_minutes_per_day: crmDaysWithData ? Math.round(crmMinutesTotal / crmDaysWithData) : null,
          office_people_per_day: skudDaysWithData
            ? Math.round((skudPeopleInOfficeTotal / skudDaysWithData) * 10) / 10
            : null,
          crm_people_per_day: crmDaysWithData
            ? Math.round((crmPeopleTotal / crmDaysWithData) * 10) / 10
            : null,
          office_status_days: officeEmpDays,
          days_with_skud: skudDaysWithData,
          days_with_crm: crmDaysWithData,
          days_total: days.length,
          working_days: workingDays.length
        },
        norm: {
          people_total: inNorm.length,
          people_under: under.length,
          under_pct: inNorm.length ? Math.round((under.length / inNorm.length) * 100) : null,
          // Счётчики по ОДНОЙ метрике — state. Раньше UI писал «В норме:
          // people_total − people_under», где under считался по delta_minutes,
          // а цвет — по ratio_pct. Получалось «0 из 17» рядом с 7 зелёными
          // (жалоба 10.11.2026).
          people_green: inNorm.filter((p) => p.state === 'green').length,
          people_yellow: inNorm.filter((p) => p.state === 'yellow').length,
          people_red: inNorm.filter((p) => p.state === 'red').length,
          people_no_norm: people.filter((p) => !(p.norm_minutes > 0)).length,
          avg_delta_minutes: avgDelta,
          norm_minutes_total: inNorm.reduce((a, p) => a + p.norm_minutes, 0),
          credited_minutes_total: inNorm.reduce((a, p) => a + p.credited_minutes, 0),
          // Сходимость: сумма дневных отклонений должна равняться итогу.
          // Если нет — одна из двух цифр врёт, лучше знать это в тесте.
          worked_minutes_total: inNorm.reduce((a, p) => a + (p.worked_minutes || 0), 0),
          days_counted_total: inNorm.reduce((a, p) => a + (p.days_counted || 0), 0),
          worst
        },
        data_quality: {
          last_import: lastImport ? {
            id: lastImport.id,
            period_from: lastImport.period_from,
            period_to: lastImport.period_to,
            imported_at: lastImport.imported_at,
            source: lastImport.source,
            file_name: lastImport.file_name
          } : null,
          skud_days_missing: skudDaysMissing.slice(0, 31),
          skud_days_missing_count: skudDaysMissing.length,
          flags_open: Number(flagRow.open || 0),
          flags_total: Number(flagRow.total || 0),
          crm_activity_since: sinceIso,
          legacy_days: legacyDays
        },
        people: people.map((p) => ({
          staff_id: p.staff_id,
          staff_ids: p.staff_ids,
          name: p.name,
          role: p.role,
          norm_minutes: p.norm_minutes,
          credited_minutes: p.credited_minutes,
          worked_minutes: p.worked_minutes,
          remote_minutes: p.remote_minutes,
          office_minutes: p.office_minutes,
          crm_minutes: p.crm_minutes,
          delta_minutes: p.delta_minutes,
          ratio_pct: p.ratio_pct,
          delta_pct: p.delta_pct,
          state: p.state,
          crown: p.crown,
          days_under: p.days_under,
          days_counted: p.days_counted,
          norm_hours: Math.round((p.norm_minutes || 0) / 6) / 10,
          delta_hours: Math.round(((p.delta_minutes || 0) / 60) * 100) / 100,
          office_days: p.office_days,
          crm_days: p.crm_days,
          is_under: p.is_under,
          // days нужен фронту: статус-сетка «Команда и часы» считает
          // человеко-дни по коду статуса, а не по агрегату.
          days: p.days
        }))
      };
    } catch (err) {
      request.log.error(err, 'director-analytics team-hours');
      return reply.code(500).send({ error: 'team_hours_failed', message: err.message });
    }
  });
};
