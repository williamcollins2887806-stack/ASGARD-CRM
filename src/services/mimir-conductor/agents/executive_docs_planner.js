/**
 * ASGARD CRM — Mimir Conductor: агент «Исполнительная документация» (Сессия 7)
 * ═══════════════════════════════════════════════════════════════════════════
 * БЕЗ LLM. Планирует объём и стоимость подготовки исполнительной документации:
 * технический писатель × 5-10 дней. Объём зависит от строгости заказчика и
 * наличия сварки/монтажа (актов скрытых работ, журналов, паспортов).
 *
 * Артефакт: docs_plan
 *   { summary, key_findings[], writer_days, writer_rate, docs_cost, doc_types[],
 *     clarifications[] }
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const { formatRub } = require('./_util');
const { resolveNorm, isStrictCustomer } = require('./_norms');

// БЕЗ ХАРДКОДА. Все нормы из applicable_norms.executive_docs.* (эталоны).
// Если в эталонах нет — поднимается BLOCKING-уточнение.

function methodStr(tz) {
  const method = (tz.scope && tz.scope.method) || [];
  const arr = Array.isArray(method) ? method : [method];
  return arr.join(' ').toLowerCase();
}

async function run({ requiredArtifacts, onThought }) {
  const tz = requiredArtifacts.tz_summary || {};

  onThought('Резолвлю нормы исполн.документации из applicable_norms (без fallback)…');
  const writerRate = resolveNorm(requiredArtifacts, 'executive_docs.writer_rate_rub_per_day', null);
  const baseDays = resolveNorm(requiredArtifacts, 'executive_docs.base_days', null);
  const strictExtra = resolveNorm(requiredArtifacts, 'executive_docs.strict_extra_days', null);
  const weldingExtra = resolveNorm(requiredArtifacts, 'executive_docs.welding_extra_days', null);

  const missing = [];
  if (writerRate.value == null) missing.push('writer_rate_rub_per_day');
  if (baseDays.value == null) missing.push('base_days');
  if (strictExtra.value == null) missing.push('strict_extra_days');
  if (weldingExtra.value == null) missing.push('welding_extra_days');
  if (missing.length) {
    return {
      summary: 'BLOCKED: нормы исполнительной документации не найдены в эталонах',
      key_findings: missing.map((k) => `BLOCKER: executive_docs.${k} отсутствует в applicable_norms`),
      writer_days: 0, writer_rate: 0, docs_cost: 0, doc_types: [],
      _source_tiers: { missing },
      assumptions: ['Заполните executive_docs.* в applicable_norms эталона mimir_reference_projects.'],
      clarifications: [{ channel: 'PM', category: 'executive_docs', blocking: true,
        question_ru: `Нет норм исполнительной документации в эталонах: ${missing.join(', ')}. Внесите в applicable_norms эталона или подгрузите релевантный эталон в mimir_reference_projects.` }]
    };
  }

  onThought('Планирую исполнительную документацию…');

  const docTypes = ['Общий журнал работ', 'Акты выполненных работ (КС-2/КС-3)', 'Исполнительные схемы'];
  let days = baseDays.value;

  const customerName = String((tz.customer && tz.customer.name) || '');
  const strict = !!(tz.customer && tz.customer.strict) || isStrictCustomer(customerName, requiredArtifacts);
  if (strict) {
    days += strictExtra.value;
    docTypes.push('Паспорта качества, сертификаты материалов', 'Реестр исполнительной документации по СТО заказчика');
  }

  const ms = methodStr(tz);
  const hasWelding = /сварк|монтаж|трубопровод/.test(ms);
  if (hasWelding) {
    days += weldingExtra.value;
    docTypes.push('Журнал сварочных работ', 'Акты скрытых работ', 'Заключения НК (ВИК/УЗК/РК)');
  }

  const cost = days * writerRate.value;
  const tagSrc = (t) => t === 'analogs' ? '✅' : t === 'company_profile' ? '⚙' : '⚠';

  return {
    summary: `Исполнительная документация: ${formatRub(cost)} (${days} дн техписателя)`,
    key_findings: [
      `${tagSrc(writerRate.tier)} Техписатель: ${days} дн × ${formatRub(writerRate.value)} = ${formatRub(cost)}`,
      `Типов документов: ${docTypes.length}`,
      strict ? `${tagSrc(strictExtra.tier)} Строгий заказчик — расширенный комплект ИД` : 'Стандартный комплект ИД'
    ],
    writer_days: days,
    writer_rate: writerRate.value,
    docs_cost: cost,
    doc_types: docTypes,
    _source_tiers: {
      writer_rate: writerRate.tier,
      base_days: baseDays.tier,
      strict_extra: strictExtra.tier,
      welding_extra: weldingExtra.tier
    },
    assumptions: [
      `Нормы ИД: writer ${writerRate.tier}, base ${baseDays.tier}, strict ${strictExtra.tier}, welding ${weldingExtra.tier}`,
      'Если все source=defaults — нужно загрузить эталоны (mimir_reference_projects) с executive_docs.*'
    ],
    clarifications: []
  };
}

module.exports = { run };
