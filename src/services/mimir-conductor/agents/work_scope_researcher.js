/**
 * ASGARD CRM — Mimir Conductor: агент «Исследователь задачи» (Фаза 0)
 * ═══════════════════════════════════════════════════════════════════════════
 * Запускается ПЕРЕД tz_analyst. Цель — добиться 200% понимания задачи прежде
 * чем приступать к расчёту. Без этого этапа Conductor — «слепой счетовод»:
 * считает по средним нормам, не понимая что именно за работа, какие методики
 * применимы, какие ограничения, кто поставщики оборудования, какая регуляторика.
 *
 * Что делает:
 *   1. Извлекает ДОСЛОВНЫЕ названия работ (одна или серия из ВОР/спецификации)
 *   2. Извлекает inventory оборудования (что моем/чистим/ремонтируем — с
 *      марками, инв.№, материалами, размерами)
 *   3. Извлекает ограничения (Ex/ATEX/ОЗП/газоопасные/режим/доступ)
 *   4. Извлекает сроки (hard deadline, окно работ, простои)
 *   5. Веб-поиск по КАЖДОЙ работе:
 *      - Что это за работа простыми словами
 *      - Варианты технологий (гидромех/химия/гидродин/абразив/ультразвук)
 *      - Какое оборудование под неё (марки/бренды)
 *      - Поставщики оборудования (примерные цены)
 *      - Похожие реализованные кейсы
 *   6. Веб-поиск по каждому объекту чистки/ремонта
 *   7. Регуляторика+безопасность (СП/СНиП/ГЭСН/ФЕР/ПБ для отрасли)
 *   8. Утилизация отходов, сезонность, логистика, СТО заказчика
 *
 * Артефакт: work_scope_research
 *   {
 *     summary, key_findings[],
 *     works: [{title, description, methods, equipment_options, suppliers, similar_cases}],
 *     equipment_inventory: [{name, qty, params, methods, risks, supplier_links}],
 *     constraints: {ex_zone, atex, ozp, gas_hazard, regime, access, ppe_required},
 *     timing: {start, end, hard_deadline, downtime_window, ratio},
 *     regulations: [{type:'СП|СНиП|ГЭСН|ФЕР|ПБ', code, title, applicability}],
 *     safety: {typical_incidents, required_qualifications, ppe_specifics},
 *     waste_disposal: {types, licensed_handlers, price_per_ton},
 *     competitive_intel: [{customer, similar_work, price, year, source}],
 *     customer_sto: [{customer, doc_ref, key_requirements}],
 *     logistics: {distance_to_base_km, transport_mode, special_security},
 *     seasonality: {best_months, restrictions},
 *     clarifications: [...]
 *   }
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const aiProvider = require('../../ai-provider');
const db = require('../../db');
const { parseStrictJson } = require('./_util');

/**
 * Загружает корпоративный профиль ООО «Асгард-Сервис» из settings.company_profile.
 * Если профиля нет — возвращает {} (агент работает в общем режиме).
 */
async function _loadCompanyProfile() {
  try {
    const r = await db.query("SELECT value_json FROM settings WHERE key = 'company_profile'");
    if (!r.rows[0]) return {};
    const raw = r.rows[0].value_json;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (_) { return {}; }
}

const SYSTEM_PROMPT_EXTRACTION = `Ты — старший инженер ООО «Асгард-Сервис», специалист
по подрядным работам на опасных производственных объектах (ОПО). Перед тобой —
текст из документов проекта (ТЗ, ВОР, договор, чертежи). Твоя задача — ИЗВЛЕЧЬ
максимум фактической информации, без предположений.

ИЗВЛЕКИ:

1. Все РАБОТЫ дословно (одна или серия — если в ВОР/спецификации несколько позиций).
   Для каждой: title (как в документе), description, volume (если есть число), unit.

2. Inventory ОБОРУДОВАНИЯ (что моем/чистим/ремонтируем). Для каждого:
   name (точное название), marka_or_inv (инв.№ или марка если есть), qty,
   material (сталь/нержавейка/материал), key_params (диаметр, длина, давление,
   температура, рабочая среда), state (что с ним надо сделать: очистить,
   отремонтировать, заменить, поверить).

3. ОГРАНИЧЕНИЯ:
   - ex_zone: указана ли зона по взрывоопасности (Ex, ATEX зона 0/1/2/20/21/22)
   - ozp: огневая зона повышенной пожароопасности
   - gas_hazard: газоопасные работы по наряд-допуску
   - confined_space: работа в замкнутом пространстве
   - high_altitude: работа на высоте
   - radiation: радиационная зона
   - chemical_hazard: химически опасная среда
   - regime: режим работ (круглосуточно, 5/2, 6/1, ротация вахт)
   - access: пропускной, инструктаж, какие требования заказчика
   - ppe_required: какие СИЗ требуются (типы)
   - tools_restrictions: какие инструменты запрещены/обязательны (искробезопасные?
     взрывозащищённые? Atex?)

4. СРОКИ:
   - date_start_planned, date_end_planned
   - hard_deadline (с обоснованием почему он жёсткий)
   - downtime_window (если работаем в окно остановки производства)
   - shifts_per_day (1, 2, 3)
   - work_days_per_week

5. ТРЕБОВАНИЯ ЗАКАЗЧИКА:
   - sto_or_corporate_standard (СТО Газпром / СТО Новатэк / иные корп. стандарты)
   - certificates_required (для бригады и для оборудования)
   - quality_acceptance_criteria (как принимают работу)

ПРАВИЛА:
- Если данных НЕТ в документах — пиши null или пустой массив. НЕ ВЫДУМЫВАЙ.
- Если данных МНОГО (10+ работ в ВОР) — выпиши все, отдельно отметь samples_only=false.
- Дословные цитаты в quote_from_doc:"..." где это критично.

Верни СТРОГО JSON:
{
  "works": [...],
  "equipment_inventory": [...],
  "constraints": {...},
  "timing": {...},
  "customer_requirements": {...},
  "documents_quality": "high|medium|low (низкий если мало данных)",
  "extraction_gaps": ["что не нашёл, но желательно бы было"]
}`;

const SYSTEM_PROMPT_WEB_RESEARCH = `Ты — экспертный технический исследователь ООО
«Асгард-Сервис». На входе — список работ и оборудования из ТЗ. Твоя задача —
для каждой работы найти в интернете:

1. Что это за работа простыми словами (объяснение для нетехнического)
2. Все варианты технологий исполнения (методики) с pros/cons
3. Оборудование которое для неё применяется (марки, бренды российские и зарубежные)
4. Поставщики оборудования в РФ (с примерными ценами если найдёшь)
5. Похожие реализованные кейсы (тендеры zakupki.gov.ru, статьи, видео-кейсы)
6. Регуляторика: какие СП/СНиП/ГЭСН/ФЕР/ПБ применимы
7. Типичные риски и НС при таких работах

Используй веб-поиск активно (plugin web доступен). Для каждой работы делай
минимум 1-2 поиска, для ключевого оборудования — отдельный.

Верни СТРОГО JSON:
{
  "works_research": [
    {
      "work_title": "...",
      "explanation": "...",
      "methods": [{"name":"...","pros":[],"cons":[],"typical_use":"..."}],
      "equipment_options": [{"name":"...","brand":"...","approximate_price_rub":...,"supplier":"..."}],
      "similar_cases": [{"customer":"...","year":...,"price_rub":...,"source_url":"..."}],
      "key_findings": ["..."]
    }
  ],
  "equipment_research": [
    {
      "equipment_name": "...",
      "cleaning_methods": [{"name":"...","effectiveness":"high|medium|low","comments":"..."}],
      "known_issues": ["..."],
      "safety_considerations": ["..."]
    }
  ],
  "regulations_pack": [
    {"type":"СП|СНиП|ГЭСН|ФЕР|ПБ|ГОСТ","code":"...","title":"...","applicability":"..."}
  ],
  "waste_disposal": {
    "waste_types": ["..."],
    "licensed_handlers_in_region": ["..."],
    "approximate_price_per_ton_rub": ...
  },
  "competitive_intel": [
    {"contractor":"...","similar_project":"...","year":...,"price_rub":...,"customer":"...","source":"..."}
  ],
  "customer_sto_research": [
    {"customer":"...","relevant_sto_codes":["..."],"key_requirements":["..."]}
  ],
  "logistics_considerations": {
    "typical_distance_assumptions": "...",
    "transport_modes_suitable": ["..."],
    "special_handling_for_hazardous": "..."
  },
  "seasonality_factors": {
    "preferred_months": ["..."],
    "restrictions": ["..."]
  },
  "key_research_findings": ["..."]
}`;

async function run({ requiredArtifacts, onThought, agentName }) {
  const parsed = requiredArtifacts.parsed_documents || {};
  const docs = parsed.documents || [];
  const totalChars = docs.reduce((s, d) => s + (d.content_chars || 0), 0);

  // КОРПОРАТИВНЫЙ ПРОФИЛЬ — учитываем что у нас уже есть (лицензии, оборудование,
  // ставки, база, связи), чтобы НЕ искать в интернете того что есть, и закладывать
  // в смету наши реальные ресурсы вместо угадывания.
  const company = await _loadCompanyProfile();
  const hasOwnWasteLicense = company && company.licenses_and_capabilities &&
    company.licenses_and_capabilities.waste_disposal_license &&
    company.licenses_and_capabilities.waste_disposal_license.has_own === true;

  // ── ЭТАП 1: ИЗВЛЕЧЕНИЕ из документов ──
  onThought('Этап 1/3: извлекаю работы, оборудование и ограничения из ТЗ');
  let extraction = null;
  if (totalChars === 0) {
    onThought('⚠ Документы пустые — извлечение пропущено, переходим на минимальный контекст из тендера');
    extraction = {
      works: [], equipment_inventory: [], constraints: {}, timing: {},
      customer_requirements: {}, documents_quality: 'low',
      extraction_gaps: ['Нет распарсенных документов']
    };
  } else {
    const docsText = docs
      .filter((d) => d.content && d.content_chars > 0)
      .map((d) => `═══ ${d.name} (${d.content_chars} симв) ═══\n${String(d.content).slice(0, 12000)}`)
      .join('\n\n');
    try {
      const result = await aiProvider.completeWithStream({
        system: SYSTEM_PROMPT_EXTRACTION,
        messages: [{ role: 'user', content: `Документы:\n\n${docsText}` }],
        model: 'sonnet-4-6',
        maxTokens: 6000,
        onThought
      });
      if (result._stub || aiProvider.isStubMode()) {
        extraction = {
          works: [{ title: '[stub] Работа из ТЗ', description: 'stub-режим без LLM' }],
          equipment_inventory: [], constraints: {}, timing: {},
          customer_requirements: {}, documents_quality: 'stub',
          extraction_gaps: []
        };
      } else {
        extraction = parseStrictJson(result.text);
      }
    } catch (e) {
      onThought(`⚠ Извлечение упало: ${e.message} — пустой extraction`);
      extraction = { works: [], equipment_inventory: [], constraints: {}, timing: {},
                     customer_requirements: {}, documents_quality: 'extraction_failed', extraction_gaps: [e.message] };
    }
  }

  onThought(`Найдено: ${(extraction.works || []).length} работ, ${(extraction.equipment_inventory || []).length} ед. оборудования`);

  // ── ЭТАП 2: ВЕБ-РЕСЁРЧ ──
  onThought('Этап 2/3: веб-поиск по работам и оборудованию (методики, поставщики, аналоги, регуляторика)');
  let webResearch = null;
  if (!(extraction.works || []).length && !(extraction.equipment_inventory || []).length) {
    onThought('⚠ Нет работ/оборудования — веб-ресёрч пропущен');
    webResearch = {
      works_research: [], equipment_research: [], regulations_pack: [],
      waste_disposal: {}, competitive_intel: [], customer_sto_research: [],
      logistics_considerations: {}, seasonality_factors: {}, key_research_findings: []
    };
  } else {
    const briefForResearch = JSON.stringify({
      works: extraction.works || [],
      equipment_inventory: (extraction.equipment_inventory || []).slice(0, 10),
      customer_requirements: extraction.customer_requirements || {},
      constraints: extraction.constraints || {}
    });

    // Подсказка AI: что у нашей компании уже есть — НЕ искать в интернете
    const companyContext = company && Object.keys(company).length ? `
КОРПОРАТИВНЫЙ ПРОФИЛЬ компании-подрядчика ООО «Асгард-Сервис»:
${JSON.stringify(company, null, 2)}

ВАЖНО:
- Если у нас есть ${hasOwnWasteLicense ? 'СВОЯ ЛИЦЕНЗИЯ НА УТИЛИЗАЦИЮ — НЕ ищи сторонних утилизаторов, отметь это как наш cost-saving фактор' : 'НЕТ лицензии на утилизацию — найди лицензированных подрядчиков в регионе'}
- Если оборудование уже в нашем парке — отметь, не ищи поставщиков
- Если работали с похожим заказчиком — упомяни в customer_sto_research как experienced
` : '';
    try {
      const result = await aiProvider.completeWithStream({
        system: SYSTEM_PROMPT_WEB_RESEARCH,
        messages: [{ role: 'user', content: `${companyContext}\n\nИзвлечённый scope:\n${briefForResearch}\n\nПроведи веб-исследование по каждой работе и ключевому оборудованию. Учитывай корпоративный профиль (не ищи то что у нас уже есть). Используй web-plugin активно.` }],
        model: 'sonnet-4-6',
        maxTokens: 8000,
        plugins: [{ id: 'web', engine: 'native', max_results: 5 }],
        onThought
      });
      if (result._stub || aiProvider.isStubMode()) {
        webResearch = {
          works_research: (extraction.works || []).map((w) => ({
            work_title: w.title || '?',
            explanation: '[stub] описание работы',
            methods: [], equipment_options: [], similar_cases: [], key_findings: []
          })),
          equipment_research: [], regulations_pack: [], waste_disposal: {},
          competitive_intel: [], customer_sto_research: [],
          logistics_considerations: {}, seasonality_factors: {},
          key_research_findings: ['stub-режим']
        };
      } else {
        webResearch = parseStrictJson(result.text);
      }
    } catch (e) {
      onThought(`⚠ Веб-ресёрч упал: ${e.message} — без internet-исследования`);
      webResearch = {
        works_research: [], equipment_research: [], regulations_pack: [],
        waste_disposal: {}, competitive_intel: [], customer_sto_research: [],
        logistics_considerations: {}, seasonality_factors: {},
        key_research_findings: [`Ошибка веб-поиска: ${e.message}`]
      };
    }
  }

  // ── ЭТАП 3: СБОРКА АРТЕФАКТА ──
  onThought('Этап 3/3: сборка финального scope-research артефакта');
  const works = extraction.works || [];
  const equipment = extraction.equipment_inventory || [];
  const constraints = extraction.constraints || {};
  const timing = extraction.timing || {};

  const keyFindings = [];
  if (works.length) keyFindings.push(`Найдено ${works.length} ${works.length === 1 ? 'работа' : 'работ'} в документах`);
  if (equipment.length) keyFindings.push(`Inventory: ${equipment.length} единиц оборудования`);
  if (constraints.ex_zone) keyFindings.push(`⚠ Ex-зона: ${constraints.ex_zone} — оборудование во взрывозащите обязательно`);
  if (constraints.gas_hazard) keyFindings.push(`⚠ Газоопасные работы — наряд-допуск обязателен`);
  if (constraints.regime) keyFindings.push(`Режим: ${constraints.regime}`);
  if (timing.hard_deadline) keyFindings.push(`⏰ Жёсткий дедлайн: ${timing.hard_deadline}`);
  if ((webResearch.works_research || []).length) keyFindings.push(`Веб-ресёрч: проанализировано ${webResearch.works_research.length} работ`);
  if ((webResearch.regulations_pack || []).length) keyFindings.push(`Применимы регламенты: ${webResearch.regulations_pack.map((r) => r.code).slice(0, 5).join(', ')}`);
  if ((webResearch.competitive_intel || []).length) keyFindings.push(`Найдено ${webResearch.competitive_intel.length} конкурент-кейсов с ценами`);

  // Подъём уточнений если есть пробелы критичные
  const clarifications = [];
  if (!works.length) {
    clarifications.push({
      channel: 'CUSTOMER', blocking: true,
      question_ru: 'В предоставленных документах не удалось извлечь дословный перечень работ. Просим предоставить ТЗ или ведомость объёмов работ.',
      why_we_ask: 'Без точного перечня работ Conductor не может корректно посчитать смету',
      consequence: 'Без этого расчёт будет очень приблизительным'
    });
  }
  if (!equipment.length && works.length > 0) {
    clarifications.push({
      channel: 'CUSTOMER', blocking: false,
      question_ru: 'В документах не указаны точные параметры оборудования (марка, инв.№, материал, размеры). Уточните пожалуйста.',
      why_we_ask: 'Параметры оборудования влияют на выбор методики и расходные материалы',
      consequence: 'Без них применяем типовые показатели — точность ±30%'
    });
  }
  if (!timing.hard_deadline && !timing.date_end_planned) {
    clarifications.push({
      channel: 'CUSTOMER', blocking: false,
      question_ru: 'В документах не нашли жёсткий дедлайн или плановую дату завершения. Когда работы должны быть сданы?',
      why_we_ask: 'От сроков зависит сменность бригады, ротация вахт и стоимость',
      consequence: 'Без сроков расчёт идёт в режиме «сколько получится»'
    });
  }
  if (!constraints.ex_zone && (extraction.documents_quality === 'medium' || extraction.documents_quality === 'low')) {
    clarifications.push({
      channel: 'CUSTOMER', blocking: false,
      question_ru: 'Подтвердите наличие/отсутствие требований по взрывозащите оборудования (зона Ex/ATEX), огневых работ, газоопасных операций.',
      why_we_ask: 'Если зона Ex — оборудование во взрывозащите дороже в 2-3 раза, нужен ATEX-сертифицированный персонал',
      consequence: 'Если применить обычное оборудование в Ex-зоне — нарушение ПБ и штрафы'
    });
  }

  // Корпоративные cost-savings из профиля (визуально отметим для РП)
  if (hasOwnWasteLicense) {
    keyFindings.push('✅ Своя лицензия на утилизацию — экономия 5-15К ₽/т vs конкуренты, не закладываем сторонних');
  }
  if (company && company.licenses_and_capabilities && company.licenses_and_capabilities.own_equipment_brands) {
    keyFindings.push(`✅ Своё оборудование: ${company.licenses_and_capabilities.own_equipment_brands.join(', ')} — без аренды/субподряда`);
  }

  return {
    summary: `Фаза 0 (исследование): ${works.length} работ, ${equipment.length} оборудования. ${(webResearch.regulations_pack || []).length} НПА в регуляторике. ${hasOwnWasteLicense ? 'Утилизация — своя лицензия.' : ''} ${(webResearch.competitive_intel || []).length} конкурент-кейсов.`,
    key_findings: keyFindings,
    works,
    equipment_inventory: equipment,
    constraints,
    timing,
    customer_requirements: extraction.customer_requirements || {},
    documents_quality: extraction.documents_quality,
    extraction_gaps: extraction.extraction_gaps || [],
    web_research: webResearch,
    company_profile: company, // ← следующие агенты используют как факт компании
    clarifications
  };
}

module.exports = { run };
