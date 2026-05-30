/**
 * ASGARD CRM — Mimir Conductor: регистр агентов (Сессия 2, Шаг 2.1)
 * ═══════════════════════════════════════════════════════════════════════════
 * Центральный каталог всех специализированных агентов. Каждый агент описан как
 * объект с метаданными (модель, артефакт, требуемые входы) и tool-схемой для
 * Conductor (Anthropic tool use API).
 *
 * В Сессии 2 реализация всех агентов — мок (`agents/_mock.js`). Реальные
 * реализации заменят моки точечно в сессиях 4-7.
 *
 * ВАЖНО про модели: `model_default` — ТОЛЬКО ключ из models-config.js. Где в
 * плане упоминалась модель без ключа в конфиге (gemini-2-5-pro, sonar-pro) —
 * маплю на ближайший существующий ключ с пометкой TODO.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

/**
 * Фабрика записи агента с дефолтами, чтобы не плодить копипасту.
 * @param {string} key — agent_name (ключ в REGISTRY)
 * @param {Object} o — переопределения
 */
function agent(key, o) {
  const toolName = `call_${key}`;
  return {
    name: o.name || key,
    description: o.description || '',
    model_default: o.model_default || 'sonnet-4-6',
    model_for_heavy: o.model_for_heavy || null,
    estimated_duration_sec: o.estimated_duration_sec || 30,
    estimated_cost_rub: o.estimated_cost_rub || 5,
    output_artifact_type: o.output_artifact_type || key,
    requires_artifacts: o.requires_artifacts || [],
    always_required: !!o.always_required,
    triggers: o.triggers || [],
    // Tool-схема для Conductor (tool use API)
    tool_schema: {
      name: toolName,
      description: o.tool_description || o.description || `Запустить агента «${o.name || key}».`,
      input_schema: o.input_schema || {
        type: 'object',
        properties: {
          additional_instructions: {
            type: 'string',
            description: 'Дополнительные указания агенту (для перезапуска с уточнением).'
          }
        }
      }
    }
  };
}

const REGISTRY = {
  // ─── 1. Парсер документов (без LLM) ────────────────────────────────────
  document_parser: agent('document_parser', {
    name: 'Парсер документов',
    description: 'Извлекает текст и структуру из всех файлов тендера/работы (PDF, DOCX, XLSX). Без LLM — детерминированный парсинг.',
    model_default: 'haiku-4-5', // фактически без LLM, но ключ нужен для метрик; TODO: парсер-сервис
    output_artifact_type: 'parsed_documents',
    estimated_duration_sec: 20,
    estimated_cost_rub: 0,
    always_required: true,
    input_schema: {
      type: 'object',
      properties: {
        documents: { type: 'array', items: { type: 'integer' }, description: 'ID документов для парсинга' }
      }
    }
  }),

  // ─── 2. Аналитик ТЗ ────────────────────────────────────────────────────
  tz_analyst: agent('tz_analyst', {
    name: 'Аналитик ТЗ',
    description: 'Читает документы, извлекает суть: что делаем, объёмы, метод, режим работ, особые условия, требуемые допуски.',
    model_default: 'sonnet-4-6',
    model_for_heavy: 'web-search-fast', // TODO: gemini-2-5-pro когда добавим ключ; если документов >50 страниц
    output_artifact_type: 'tz_summary',
    requires_artifacts: ['parsed_documents'],
    always_required: true,
    estimated_cost_rub: 4,
    tool_description: 'Запустить аналитика ТЗ. Возвращает суть проекта: объёмы, метод, режим работ, допуски, особые условия. ВСЕГДА вызывать первым.',
    input_schema: {
      type: 'object',
      properties: {
        focus_areas: {
          type: 'array',
          items: { type: 'string', enum: ['volumes', 'method', 'conditions', 'permits', 'all'] },
          description: 'На что обратить особое внимание. По умолчанию all.'
        },
        additional_instructions: { type: 'string' }
      }
    }
  }),

  // ─── 3. Чтение чертежей (vision) ───────────────────────────────────────
  drawings_reader: agent('drawings_reader', {
    name: 'Чтение чертежей',
    description: 'Читает чертежи и сканы (vision), извлекает размеры, узлы, спецификации.',
    model_default: 'gpt-5',
    output_artifact_type: 'drawings_summary',
    requires_artifacts: ['tz_summary'],
    estimated_cost_rub: 15,
    triggers: [{ type: 'flag', flag: 'has_drawings' }]
  }),

  // ─── 4. Входной контроль ───────────────────────────────────────────────
  gatekeeper: agent('gatekeeper', {
    name: 'Входной контроль',
    description: 'Проверяет полноту исходных данных, выявляет красные флаги до начала просчёта.',
    model_default: 'sonnet-4-6',
    output_artifact_type: 'gatekeeper_report',
    requires_artifacts: ['tz_summary'],
    triggers: [{ type: 'threshold', field: 'contract_value', gt: 10000000 }]
  }),

  // ─── 5. Декомпозитор договора ──────────────────────────────────────────
  contract_decomposer: agent('contract_decomposer', {
    name: 'Декомпозитор договора',
    description: 'Разбивает работы на этапы/подразделы, выявляет субподрядные сигналы.',
    model_default: 'opus-4-7',
    output_artifact_type: 'scope_breakdown',
    requires_artifacts: ['tz_summary'],
    triggers: [{ type: 'flag', flag: 'has_subcontract_signals' }]
  }),

  // ─── 6. Нормативный привязчик ──────────────────────────────────────────
  resource_planner: agent('resource_planner', {
    name: 'Нормативный привязчик',
    description: 'Привязывает работы к нормативам ГЭСН/ФЕР/СТО, формирует ресурсную ведомость.',
    model_default: 'yandex-pro',
    output_artifact_type: 'resources',
    requires_artifacts: ['tz_summary'],
    estimated_cost_rub: 3,
    triggers: [{ type: 'always' }]
  }),

  // ─── 7. Инженер-технолог ───────────────────────────────────────────────
  method_validator: agent('method_validator', {
    name: 'Инженер-технолог',
    description: 'Проверяет применимость метода производства работ, технологическую корректность.',
    model_default: 'opus-4-7',
    output_artifact_type: 'method_validation',
    requires_artifacts: ['tz_summary', 'resources'],
    triggers: [{ type: 'flag', flag: 'risk_medium_plus' }]
  }),

  // ─── 8. Особые условия ─────────────────────────────────────────────────
  site_conditions: agent('site_conditions', {
    name: 'Особые условия',
    description: 'Учитывает ОЗП, опасные производства, стеснённость, погодные и режимные ограничения.',
    model_default: 'opus-4-7',
    output_artifact_type: 'site_conditions',
    requires_artifacts: ['tz_summary'],
    triggers: [{ type: 'flag', flag: 'has_OZP' }, { type: 'flag', flag: 'hazardous' }]
  }),

  // ─── 9. Склад-матчер (без LLM) ─────────────────────────────────────────
  warehouse_matcher: agent('warehouse_matcher', {
    name: 'Склад-матчер',
    description: 'Сопоставляет потребность в материалах с остатками склада. Детерминированные правила, без LLM.',
    model_default: 'haiku-4-5', // фактически Python-правила; TODO: rules-сервис
    output_artifact_type: 'warehouse_match',
    requires_artifacts: ['resources'],
    estimated_cost_rub: 0,
    triggers: [{ type: 'always' }]
  }),

  // ─── 10. Закупки: поиск рынка ──────────────────────────────────────────
  market_search: agent('market_search', {
    name: 'Закупки — поиск рынка',
    description: 'Ищет актуальные цены оборудования и материалов 2026 у российских поставщиков (Perplexity Sonar через routerai).',
    model_default: 'sonar-opus',
    output_artifact_type: 'market_offers',
    requires_artifacts: ['resources', 'warehouse_match'],
    estimated_cost_rub: 35,
    estimated_duration_sec: 60,
    triggers: [{ type: 'artifact_field', artifact: 'warehouse_match', field: 'to_purchase', condition: 'non_empty' }]
  }),

  // ─── 11. Закупки: анализ ───────────────────────────────────────────────
  procurement_analyzer: agent('procurement_analyzer', {
    name: 'Закупки — анализ',
    description: 'Анализирует найденные предложения, выбирает оптимальных поставщиков, считает закупочную стоимость.',
    model_default: 'sonnet-4-6',
    output_artifact_type: 'procurement',
    requires_artifacts: ['market_offers'],
    triggers: [{ type: 'artifact_exists', artifact: 'market_offers' }]
  }),

  // ─── 12. Подбор бригады ────────────────────────────────────────────────
  crew_composer: agent('crew_composer', {
    name: 'Подбор бригады',
    description: 'Формирует состав бригады по объёмам и методу: специальности, квалификация, численность.',
    model_default: 'sonnet-4-6',
    output_artifact_type: 'crew_plan',
    requires_artifacts: ['tz_summary', 'resources'],
    triggers: [{ type: 'always' }]
  }),

  // ─── 13. Расчёт труда (без LLM) ────────────────────────────────────────
  labor_calculator: agent('labor_calculator', {
    name: 'Расчёт труда',
    description: 'Считает трудозатраты и ФОТ по бригаде и срокам. Детерминированно, без LLM.',
    model_default: 'haiku-4-5', // Python-расчёт; TODO
    output_artifact_type: 'labor_cost',
    requires_artifacts: ['crew_plan'],
    estimated_cost_rub: 0,
    triggers: [{ type: 'always' }]
  }),

  // ─── 14. Логистика-маршруты ────────────────────────────────────────────
  routing_planner: agent('routing_planner', {
    name: 'Логистика — маршруты',
    description: 'Планирует доставку людей и техники: маршруты, дни дороги, транспорт.',
    model_default: 'sonnet-4-6',
    output_artifact_type: 'routing_plan',
    requires_artifacts: ['crew_plan', 'tz_summary'],
    triggers: [{ type: 'threshold', field: 'distance_km', gt: 100 }]
  }),

  // ─── 15. Билеты ────────────────────────────────────────────────────────
  travel_pricer: agent('travel_pricer', {
    name: 'Билеты',
    description: 'Ищет цены билетов/проезда для вахты и командировок.',
    model_default: 'sonar-opus', // TODO: sonar-pro когда появится ключ
    output_artifact_type: 'travel_cost',
    requires_artifacts: ['routing_plan'],
    estimated_cost_rub: 20,
    triggers: [{ type: 'flag', flag: 'requires_travel' }]
  }),

  // ─── 16. Допуски + обучение ────────────────────────────────────────────
  permits_planner: agent('permits_planner', {
    name: 'Допуски + обучение',
    description: 'Определяет требуемые допуски, аттестации, обучение и их стоимость/сроки.',
    model_default: 'sonnet-4-6',
    output_artifact_type: 'permits_plan',
    requires_artifacts: ['tz_summary', 'crew_plan'],
    triggers: [{ type: 'always' }]
  }),

  // ─── 17. Косвенные + налоги (без LLM) ──────────────────────────────────
  indirects_calculator: agent('indirects_calculator', {
    name: 'Косвенные + налоги',
    description: 'Считает накладные, налоги, косвенные затраты по МДС. Детерминированно, без LLM.',
    model_default: 'haiku-4-5', // Python; TODO
    output_artifact_type: 'indirects',
    requires_artifacts: ['labor_cost'],
    estimated_cost_rub: 0,
    triggers: [{ type: 'always' }]
  }),

  // ─── 18. Монте-Карло ───────────────────────────────────────────────────
  risk_quantifier: agent('risk_quantifier', {
    name: 'Монте-Карло',
    description: 'Оценивает разброс стоимости методом Монте-Карло, выявляет рисковые позиции.',
    model_default: 'deepseek-v4',
    output_artifact_type: 'risk_analysis',
    requires_artifacts: ['indirects'],
    triggers: [{ type: 'threshold', field: 'contract_value', gt: 30000000 }]
  }),

  // ─── 19. Архивариус-аналог ─────────────────────────────────────────────
  historical_comparator: agent('historical_comparator', {
    name: 'Архивариус-аналог',
    description: 'Ищет в архиве похожие просчёты (RAG по embeddings), сравнивает цену/структуру.',
    model_default: 'voyage-3',
    output_artifact_type: 'analogs_comparison',
    requires_artifacts: ['tz_summary'],
    triggers: [{ type: 'threshold', field: 'analogs_count', gt: 0 }]
  }),

  // ─── 20. Финмодель ─────────────────────────────────────────────────────
  financial_modeler: agent('financial_modeler', {
    name: 'Финмодель',
    description: 'Строит финансовую модель: cash flow, маржинальность, точка безубыточности.',
    model_default: 'opus-4-7',
    output_artifact_type: 'financial_model',
    requires_artifacts: ['indirects', 'procurement'],
    triggers: [{ type: 'threshold', field: 'contract_value', gt: 50000000 }]
  }),

  // ─── 21. Нормативы заказчика ───────────────────────────────────────────
  norms_compliance: agent('norms_compliance', {
    name: 'Нормативы заказчика',
    description: 'Проверяет соответствие СТО и внутренним нормативам заказчика.',
    model_default: 'sonnet-4-6',
    output_artifact_type: 'norms_compliance',
    requires_artifacts: ['tz_summary'],
    triggers: [{ type: 'flag', flag: 'strict_customer' }]
  }),

  // ─── 22. Главный контролёр ─────────────────────────────────────────────
  final_consolidator: agent('final_consolidator', {
    name: 'Главный контролёр',
    description: 'Собирает все артефакты в итоговую ССР, проверяет полноту и непротиворечивость.',
    model_default: 'opus-4-7',
    output_artifact_type: 'final_estimate',
    requires_artifacts: ['indirects'],
    always_required: true,
    triggers: [{ type: 'always' }]
  }),

  // ─── 23. Адвокат дьявола ───────────────────────────────────────────────
  devils_advocate: agent('devils_advocate', {
    name: 'Адвокат дьявола',
    description: 'Независимая критическая проверка сметы с противоположным промптом: ищет занижения и дыры.',
    model_default: 'opus-4-7',
    output_artifact_type: 'devils_advocate',
    requires_artifacts: ['final_estimate'],
    triggers: [{ type: 'threshold', field: 'contract_value', gt: 50000000 }, { type: 'manual' }]
  }),

  // ─── 24. Pre-mob и подготовка (без LLM) ────────────────────────────────
  pre_mob_calculator: agent('pre_mob_calculator', {
    name: 'Pre-mob и подготовка',
    description: 'Считает затраты на мобилизацию, подготовку площадки, бытовые городки.',
    model_default: 'haiku-4-5', // Python; TODO
    output_artifact_type: 'pre_mob_cost',
    requires_artifacts: ['crew_plan'],
    estimated_cost_rub: 0,
    triggers: [{ type: 'always' }]
  }),

  // ─── 25. Допуск на объект ──────────────────────────────────────────────
  site_access_planner: agent('site_access_planner', {
    name: 'Допуск на объект',
    description: 'Планирует пропускной режим, согласования доступа, инструктажи заказчика.',
    model_default: 'sonnet-4-6',
    output_artifact_type: 'site_access_plan',
    requires_artifacts: ['tz_summary'],
    triggers: [{ type: 'flag', flag: 'strict_customer' }]
  }),

  // ─── 26. Standby и простои (без LLM) ───────────────────────────────────
  standby_estimator: agent('standby_estimator', {
    name: 'Standby и простои',
    description: 'Закладывает резерв на простои, ожидание фронта работ, погодные standby.',
    model_default: 'haiku-4-5', // Python; TODO
    output_artifact_type: 'standby_reserve',
    requires_artifacts: ['crew_plan'],
    estimated_cost_rub: 0,
    triggers: [{ type: 'always' }]
  }),

  // ─── 27. Расходники по объёму (без LLM) ────────────────────────────────
  consumables_calculator: agent('consumables_calculator', {
    name: 'Расходники по объёму',
    description: 'Считает расходные материалы пропорционально объёмам работ.',
    model_default: 'haiku-4-5', // Python; TODO
    output_artifact_type: 'consumables',
    requires_artifacts: ['resources'],
    estimated_cost_rub: 0,
    triggers: [{ type: 'flag', flag: 'has_volumes' }]
  }),

  // ─── 28. Исполнительная документация ───────────────────────────────────
  executive_docs_planner: agent('executive_docs_planner', {
    name: 'Исполнительная документация',
    description: 'Планирует объём и стоимость подготовки исполнительной документации.',
    model_default: 'haiku-4-5', // Python; TODO
    output_artifact_type: 'docs_plan',
    requires_artifacts: ['tz_summary'],
    estimated_cost_rub: 0,
    triggers: [{ type: 'flag', flag: 'requires_exec_docs' }]
  }),

  // ─── 29. Гарантийный резерв (без LLM) ──────────────────────────────────
  warranty_reserve: agent('warranty_reserve', {
    name: 'Гарантийный резерв',
    description: 'Рассчитывает резерв на гарантийные обязательства по сроку гарантии.',
    model_default: 'haiku-4-5', // Python; TODO
    output_artifact_type: 'warranty',
    requires_artifacts: ['indirects'],
    estimated_cost_rub: 0,
    triggers: [{ type: 'threshold', field: 'warranty_period', gt: 0 }]
  }),

  // ─── 30. Контроль качества ─────────────────────────────────────────────
  quality_control_planner: agent('quality_control_planner', {
    name: 'Контроль качества',
    description: 'Планирует контроль качества (НК, сварка, монтаж): методы, объёмы, стоимость.',
    model_default: 'sonnet-4-6',
    output_artifact_type: 'qc_plan',
    requires_artifacts: ['tz_summary', 'resources'],
    triggers: [{ type: 'flag', flag: 'has_welding' }, { type: 'flag', flag: 'has_assembly' }]
  }),

  // ─── 31. Морские допуски ───────────────────────────────────────────────
  marine_permits: agent('marine_permits', {
    name: 'Морские допуски',
    description: 'Морские/шельфовые допуски и сертификаты (МЛСП): требования, сроки, стоимость.',
    model_default: 'sonnet-4-6',
    output_artifact_type: 'marine_permits',
    requires_artifacts: ['tz_summary'],
    triggers: [{ type: 'flag', flag: 'has_MLSP' }]
  })
};

module.exports = REGISTRY;
module.exports.agent = agent;
