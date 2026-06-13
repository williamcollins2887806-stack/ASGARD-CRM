/**
 * ASGARD CRM — Mimir Conductor: агент «Планировщик доступа на объект».
 * ═══════════════════════════════════════════════════════════════════════════
 * Раньше был мок — но hard-rules.js требует его при strict_customer (Газпром,
 * Транснефть, Роснефть, Норникель, ЛУКОЙЛ). Любой такой просчёт зависал.
 *
 * Теперь — реальная реализация:
 * Извлекает требования по доступу из work_scope_research.constraints.access,
 * tz_summary, customer_requirements и сопоставляет с типичными требованиями
 * заказчика (через SYSTEM_PROMPT или из company_profile.known_customers_experience).
 *
 * Артефакт: site_access_plan
 *   { access_documents_required, pre_arrival_lead_time_days, badge_process,
 *     vehicle_access, training_required, ppe_inspection, estimated_cost_rub }
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const aiProvider = require('../../ai-provider');
const { parseStrictJson, formatRub, aiCompleteJson } = require('./_util');

const SYSTEM_PROMPT = `Ты — координатор доступа на ОПО ООО «Асгард-Сервис».
На входе — ТЗ, требования заказчика, scope-research. Извлеки и спланируй ВСЕ
аспекты доступа бригады на объект:

- Какие документы нужны заранее (списки персонала, СНИЛС, ИНН, медкомиссии)
- Lead-time подачи списка (типично 14-30 дней до прибытия)
- Процесс получения пропусков (постоянный/временный, бейдж/QR)
- Доступ автотранспорта (отдельный пропуск, охрана сопровождает)
- Обязательное обучение/инструктажи (вводный, на рабочем месте, ПБ-СПГ)
- Проверка СИЗ при входе (типичная для строгих заказчиков)
- Ограничения по времени работы (окно остановки производства)

Учитывай:
- Газпром, Новатэк, ЛУКОЙЛ, Роснефть, Норникель имеют СВОИ корпоративные регламенты доступа
- На СПГ-объектах обязательна ПБ-СПГ-аттестация
- На химпроизводствах — газоопасные/высота допуска
- На действующем производстве — окно ремонта может быть жёсткое (отказ = простой завода)

Верни СТРОГО JSON:
{
  "access_documents_required": ["..."],
  "pre_arrival_lead_time_days": ...,
  "badge_process": "...",
  "vehicle_access": {"required": true|false, "details": "..."},
  "training_required": [{"type":"...","duration_hours":...,"can_be_done_on_site":true|false}],
  "ppe_inspection_at_entry": true|false,
  "work_window_restrictions": "...",
  "estimated_one_time_cost_rub": ...,
  "estimated_cost_per_person_rub": ...,
  "key_risks": ["..."]
}`;

/** Детерминированная заглушка когда AI недоступен или scope пустой. */
function stubPlan(scope, tz) {
  const constraints = (scope && scope.constraints) || {};
  const customer = (tz && tz.customer && tz.customer.name) || '';
  const isStrict = /газпром|транснефт|роснефт|норникел|лукойл|новатэк/i.test(customer);
  const isSPG = (constraints.regime || '').toString().includes('СПГ') || /спг/i.test(customer);
  return {
    summary: `Доступ на объект ${isStrict ? '(СТРОГИЙ заказчик)' : ''}: lead-time подачи списков ${isStrict ? 30 : 14} дней, пропуска ${constraints.access || 'стандартные'}.`,
    key_findings: [
      `Lead-time подачи: ${isStrict ? 30 : 14} дней`,
      `Корпоративные регламенты заказчика: ${isStrict ? 'строгие — отдельный отдел СБ' : 'стандартные'}`,
      isSPG ? 'ПБ-СПГ-аттестация ОБЯЗАТЕЛЬНА' : 'Стандартные инструктажи',
      `Авто-пропуска: ${constraints.access ? 'требуются по списку' : 'по типовой схеме'}`,
      `Оценочная стоимость одноразовая: ~${isStrict ? 25000 : 10000} ₽ (СБ-проверки)`,
      `На человека: ~${isStrict ? 3500 : 1500} ₽ (документы, ВТО, медкомиссия)`
    ],
    access_documents_required: [
      'Список персонала с СНИЛС/ИНН',
      'Копии паспортов',
      'Медицинские справки',
      'Удостоверения по охране труда',
      ...(isSPG ? ['Сертификаты ПБ-СПГ'] : []),
      ...(isStrict ? ['Допуск СБ заказчика', 'Согласование с СБ'] : [])
    ],
    pre_arrival_lead_time_days: isStrict ? 30 : 14,
    badge_process: isStrict ? 'Временный пропуск через СБ заказчика, по списку, согласование 5-10 дней' : 'Временный пропуск по списку, выдача в день прибытия',
    vehicle_access: { required: true, details: 'Авто-пропуск отдельным списком, обязательное сопровождение' },
    training_required: [
      { type: 'Вводный инструктаж', duration_hours: 2, can_be_done_on_site: true },
      { type: 'Инструктаж на рабочем месте', duration_hours: 4, can_be_done_on_site: true },
      ...(isSPG ? [{ type: 'ПБ-СПГ инструктаж', duration_hours: 8, can_be_done_on_site: true }] : []),
      ...(isStrict ? [{ type: 'Корпоративный регламент СБ заказчика', duration_hours: 2, can_be_done_on_site: true }] : [])
    ],
    ppe_inspection_at_entry: isStrict,
    work_window_restrictions: constraints.regime || 'Стандартный рабочий день',
    estimated_one_time_cost_rub: isStrict ? 25000 : 10000,
    estimated_cost_per_person_rub: isStrict ? 3500 : 1500,
    key_risks: [
      `Задержка пропусков на ${isStrict ? '5-10' : '2-3'} дней = простой бригады в гостинице`,
      isSPG ? 'Без действующей ПБ-СПГ сотрудник не получит пропуск' : null,
      isStrict ? 'Отказ СБ заказчика по любой причине = замена сотрудника + повтор согласования' : null
    ].filter(Boolean),
    clarifications: !tz.customer || !tz.customer.name ? [
      {
        channel: 'PM', category: 'access', blocking: false,
        question_ru: 'Уточните точное название заказчика и наличие СТО по доступу на объект — это влияет на lead-time и стоимость пропусков.',
        why_we_ask: 'У строгих заказчиков (Газпром, Новатэк, Роснефть) процедуры доступа в 2-3 раза дольше и дороже.',
        consequence: 'Без этого считаем по стандартным правилам — может дать заниженную оценку.'
      }
    ] : []
  };
}

async function run({ requiredArtifacts, onThought }) {
  const tz = requiredArtifacts.tz_summary || {};
  const scope = requiredArtifacts.work_scope_research || {};
  const constraints = scope.constraints || {};

  onThought('Анализирую требования доступа на объект…');

  if (aiProvider.isStubMode() || !tz.customer) {
    onThought(scope.constraints ? 'stub-режим / нет данных заказчика — детерминированный план' : 'нет требований из scope');
    return stubPlan(scope, tz);
  }

  try {
    const userMessage = `Текущий проект:
Заказчик: ${JSON.stringify(tz.customer || {})}
Объект: ${JSON.stringify(tz.object || {})}
Ограничения: ${JSON.stringify(constraints)}
Customer requirements: ${JSON.stringify(scope.customer_requirements || {})}
Известный опыт работы с заказчиком: ${JSON.stringify(
  (scope.company_profile && scope.company_profile.known_customers_experience) || []
)}

Составь план доступа.`;
    const parsed = await aiCompleteJson(aiProvider, {
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      model: 'sonnet-4-6',
      maxTokens: 3000,
      onThought
    }, {
      onThought, agentName: 'site_access_planner',
      fallback: () => ({ _stubReplace: true, plan: stubPlan(scope, tz) })
    });
    if (parsed && parsed._stub) return stubPlan(scope, tz);
    if (parsed && parsed._stubReplace) return parsed.plan;
    return {
      summary: `Доступ: lead-time ${parsed.pre_arrival_lead_time_days || '?'} дней, ${parsed.estimated_one_time_cost_rub ? `~${formatRub(parsed.estimated_one_time_cost_rub)}` : 'стоимость не оценена'}.`,
      key_findings: [
        `Lead-time: ${parsed.pre_arrival_lead_time_days || '?'} дней`,
        `Документов в списке: ${(parsed.access_documents_required || []).length}`,
        `Обучений: ${(parsed.training_required || []).length}`,
        `Одноразовая стоимость: ${parsed.estimated_one_time_cost_rub ? formatRub(parsed.estimated_one_time_cost_rub) : '?'}`,
        `Стоимость на человека: ${parsed.estimated_cost_per_person_rub ? formatRub(parsed.estimated_cost_per_person_rub) : '?'}`
      ],
      ...parsed,
      clarifications: []
    };
  } catch (e) {
    onThought(`⚠ LLM упала (${e.message}) — детерминированный план`);
    return stubPlan(scope, tz);
  }
}

module.exports = { run, stubPlan };
