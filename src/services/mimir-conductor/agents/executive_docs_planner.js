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

const WRITER_RATE = 7000;   // ₽/день техписателя
const BASE_DAYS = 5;        // базовый объём
const STRICT_EXTRA_DAYS = 3; // строгий заказчик
const WELDING_EXTRA_DAYS = 2; // сварка → журналы, паспорта стыков

function methodStr(tz) {
  const method = (tz.scope && tz.scope.method) || [];
  const arr = Array.isArray(method) ? method : [method];
  return arr.join(' ').toLowerCase();
}

async function run({ requiredArtifacts, onThought }) {
  const tz = requiredArtifacts.tz_summary || {};

  onThought('Планирую исполнительную документацию…');

  const docTypes = ['Общий журнал работ', 'Акты выполненных работ (КС-2/КС-3)', 'Исполнительные схемы'];
  let days = BASE_DAYS;

  const strict = !!(tz.customer && tz.customer.strict) || /газпром|транснефт|роснефт|норникел|лукойл/i.test(String(tz.customer && tz.customer.name || ''));
  if (strict) { days += STRICT_EXTRA_DAYS; docTypes.push('Паспорта качества, сертификаты материалов', 'Реестр исполнительной документации по СТО заказчика'); }

  const ms = methodStr(tz);
  const hasWelding = /сварк|монтаж|трубопровод/.test(ms);
  if (hasWelding) { days += WELDING_EXTRA_DAYS; docTypes.push('Журнал сварочных работ', 'Акты скрытых работ', 'Заключения НК (ВИК/УЗК/РК)'); }

  const cost = days * WRITER_RATE;

  return {
    summary: `Исполнительная документация: ${formatRub(cost)} (${days} дн техписателя)`,
    key_findings: [
      `Техписатель: ${days} дн × ${formatRub(WRITER_RATE)} = ${formatRub(cost)}`,
      `Типов документов: ${docTypes.length}`,
      strict ? 'Строгий заказчик — расширенный комплект ИД' : 'Стандартный комплект ИД'
    ],
    writer_days: days,
    writer_rate: WRITER_RATE,
    docs_cost: cost,
    doc_types: docTypes,
    assumptions: ['Объём ИД оценён эвристически по строгости заказчика и характеру работ'],
    clarifications: []
  };
}

module.exports = { run };
