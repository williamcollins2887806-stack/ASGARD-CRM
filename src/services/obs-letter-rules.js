'use strict';

/**
 * Спецправила для писем ОБС по контрагенту.
 * Возвращает готовый special_context для вставки в тело письма.
 */

const DEFAULT_SUBCONTRACT_PARTY = 'ООО «ГСП Ремонт»';

/** Текст работ по умолчанию (АГПЗ). */
const DEFAULT_WORK_CONTEXT = 'выполняет работы по ремонту теплоизоляции аппаратов и трубопроводов '
  + 'в интересах Астраханского ГПЗ ООО «Газпром Переработка», расположенного в Астраханской области';

const DS2_DATE = '2026-11-01';

function normName(v) {
  return String(v || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

function parseIsoDate(d) {
  if (!d) return null;
  const s = String(d).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const dt = new Date(`${s}T12:00:00`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function dateGte(a, bIso) {
  const da = parseIsoDate(a);
  const db = parseIsoDate(bIso);
  if (!da || !db) return false;
  return da >= db;
}

const RULES = [
  {
    id: 'bezopasnost_truda',
    label: 'Безопасность Труда',
    test: (name) => /безопасност[ьи]\s+труда/.test(name),
    context: (opts) => {
      const lines = [
        'Оплата осуществляется на основании договора № 12.03/1339 от 12.03.2025 г.',
      ];
      if (dateGte(opts && opts.invoiceDate, DS2_DATE)) {
        lines.push('С 01.11.2026 г. расчёты ведутся с учётом дополнительного соглашения № 2 от 27.10.2026 г.');
      }
      return lines.join(' ');
    },
  },
  {
    id: 'kuptsov_zolotoi',
    label: 'Купцов / Золотой Джин',
    test: (name) => /купцов/.test(name) || /золотой\s+джин/.test(name),
    context: () => 'Расходы по договору № 12/03-1ГУ. Размещение персонала и прачечную '
      + 'следует указывать отдельными строками (проживание — по количеству человек, '
      + 'стирка — отдельно).',
  },
  {
    id: 'gazprom_pitanie',
    label: 'Газпром Питание',
    test: (name) => /газпром\s+питани/.test(name),
    context: () => 'Оплата по договору № 804-ГП/2026-АСТР. В просьбе об оплате укажите '
      + 'отчётный период и долю 50 % от суммы счёта.',
  },
];

/**
 * @param {string} counterpartyName
 * @param {{invoiceDate?: string|Date}} [opts]
 * @returns {{id:string, label:string, context:string}|null}
 */
function matchSpecialRule(counterpartyName, opts = {}) {
  const name = normName(counterpartyName);
  if (!name) return null;
  for (const r of RULES) {
    if (r.test(name)) {
      return { id: r.id, label: r.label, context: r.context(opts || {}) };
    }
  }
  return null;
}

/**
 * Подсказки по доле и сроку оплаты из payment_kind / payment_schedule.
 * @param {{payment_kind?:string, payment_schedule?:unknown, amount_gross?:number}} doc
 */
function suggestPaymentTerms(doc) {
  const kind = String((doc && doc.payment_kind) || 'postpay').toLowerCase();
  let pct = 100;
  let period = '';

  if (kind === 'prepay') {
    pct = 100;
    period = 'в течение 5 рабочих дней с даты выставления счёта';
  } else if (kind === 'partial') {
    let sched = doc && doc.payment_schedule;
    if (typeof sched === 'string') {
      try { sched = JSON.parse(sched); } catch (_) { sched = []; }
    }
    if (!Array.isArray(sched)) sched = [];
    const unpaid = sched.find((e) => e && !e.paid_at);
    if (unpaid && unpaid.pct != null) {
      pct = Number(unpaid.pct) || 50;
    } else if (unpaid && unpaid.amount != null && doc.amount_gross > 0) {
      pct = Math.round(Number(unpaid.amount) / Number(doc.amount_gross) * 10000) / 100;
    } else {
      pct = 50;
    }
    if (unpaid && unpaid.due_at) {
      const d = String(unpaid.due_at).slice(0, 10).split('-');
      if (d.length === 3) period = `не позднее ${d[2]}.${d[1]}.${d[0]} г.`;
    }
  } else {
    pct = 100;
    period = 'в срок, установленный договором субподряда';
  }

  if (pct < 0) pct = 0;
  if (pct > 100) pct = 100;
  return { payment_pct: pct, payment_period: period };
}

/**
 * Предупреждения перед сохранением письма.
 */
function buildPreflightWarnings(doc, items, letterData) {
  const warnings = [];
  const gross = Number(doc && doc.amount_gross) || 0;
  const vat = Number(doc && doc.vat_amount) || 0;
  const net = Number(doc && doc.amount_net);
  const rate = Number(doc && doc.vat_rate) || 0;
  const ratePct = rate > 1 ? rate : rate * 100;

  if (gross > 0 && ratePct > 0) {
    const expected = Math.round(gross * ratePct / (100 + ratePct) * 100) / 100;
    if (Math.abs(expected - vat) > 0.02) {
      warnings.push(`НДС не сходится с суммой: ожидалось ${expected.toLocaleString('ru-RU')}, в карточке ${vat.toLocaleString('ru-RU')}.`);
    }
  }
  if (gross > 0 && Number.isFinite(net) && Math.abs(gross - vat - net) > 0.03) {
    warnings.push('Сумма без НДС не совпадает с «с НДС» минус НДС — проверьте цифры.');
  }

  const lines = Array.isArray(items) ? items : [];
  const sumHint = letterData && letterData.doc && letterData.doc.parsed_json;
  if (lines.length && sumHint) {
    try {
      const pj = typeof sumHint === 'string' ? JSON.parse(sumHint) : sumHint;
      if (pj && Array.isArray(pj.lines) && pj.lines.length) {
        const lineSum = pj.lines.reduce((s, l) => s + (Number(l.sum || l.amount || l.total) || 0), 0);
        if (lineSum > 0 && Math.abs(lineSum - gross) > 1) {
          warnings.push(`Сумма позиций в счёте (${Math.round(lineSum).toLocaleString('ru-RU')} ₽) расходится с суммой письма.`);
        }
      }
    } catch (_) { /* нет parsed_json */ }
  }

  if (doc && doc.obs_letter_doc_id) {
    warnings.push('По этому счёту уже есть письмо ОБС — при сохранении будет создана новая редакция.');
  }

  return warnings;
}

/** Договор по умолчанию: КР320п26, если есть в списке. */
function pickDefaultSubcontractId(subcontracts) {
  const list = Array.isArray(subcontracts) ? subcontracts : [];
  const hit = list.find((s) => /кр320п26/i.test(String(s.number || '')));
  return hit ? hit.id : (list[0] && list[0].id) || null;
}

module.exports = {
  matchSpecialRule,
  suggestPaymentTerms,
  buildPreflightWarnings,
  pickDefaultSubcontractId,
  DEFAULT_SUBCONTRACT_PARTY,
  DEFAULT_WORK_CONTEXT,
};
