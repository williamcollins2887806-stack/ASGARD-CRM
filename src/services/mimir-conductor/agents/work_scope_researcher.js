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
 * Безопасный JSON.stringify для записи в jsonb-колонки.
 * Чинит типовые SQL-падения «invalid input syntax for type json»:
 *   - undefined → null (JSON.stringify по умолчанию выкидывает undefined из
 *     массивов как null, но для top-level undefined возвращает undefined →
 *     null-строка падает в pg)
 *   - bigint → строка (JSON.stringify бросает TypeError на bigint)
 *   - function → undefined (выкидывается)
 *   - Date → ISO-строка (toJSON работает по умолчанию, но явный fallback)
 *   - circular reference → '[Circular]' (вместо TypeError)
 */
function _safeJsonStringify(obj) {
  const seen = new WeakSet();
  return JSON.stringify(obj, (k, v) => {
    if (v === undefined) return null;
    if (typeof v === 'bigint') return v.toString();
    if (typeof v === 'function') return undefined;
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'number' && !Number.isFinite(v)) return null;
    if (typeof v === 'object' && v !== null) {
      if (seen.has(v)) return '[Circular]';
      seen.add(v);
    }
    return v;
  });
}

/**
 * Загружает корпоративный профиль ООО «Асгард-Сервис» из settings.company_profile.
 * Если профиля нет — возвращает {} (агент работает в общем режиме).
 * Здесь только МЕТА (лицензии, реквизиты, политики) — оборудование/расходники/кадры
 * подгружаются отдельно динамически из соответствующих таблиц.
 */
async function _loadCompanyProfile() {
  try {
    const r = await db.query("SELECT value_json FROM settings WHERE key = 'company_profile'");
    if (!r.rows[0]) return {};
    const raw = r.rows[0].value_json;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (_) { return {}; }
}

/**
 * Сводка СКЛАДА (реальные позиции на текущий момент). НЕ хардкод — SELECT из БД.
 * Возвращает { equipment_by_category, consumables_by_category, total_equipment_count,
 *   total_consumables_count, key_equipment_brands }.
 * Брэнды собираются из equipment.brand — это покажет AI наши «Крот»/«Тайфун»/«НВД»
 * не как захардкоженный список, а как реальный snapshot склада.
 */
async function _loadWarehouseSnapshot() {
  const snapshot = {
    equipment_by_category: [], consumables_by_category: [],
    key_equipment_brands: [], total_equipment: 0, total_consumables: 0,
    error: null
  };
  try {
    // Equipment — группируем по бренду+модели для понимания «что у нас вообще есть»
    const eqByBrand = await db.query(`
      SELECT
        COALESCE(NULLIF(TRIM(brand), ''), 'без бренда') AS brand,
        COALESCE(NULLIF(TRIM(model), ''), '') AS model,
        COUNT(*) FILTER (WHERE status NOT IN ('written_off','sold') OR status IS NULL)::int AS available_qty
      FROM equipment
      WHERE deleted_at IS NULL
      GROUP BY brand, model
      HAVING COUNT(*) FILTER (WHERE status NOT IN ('written_off','sold') OR status IS NULL) > 0
      ORDER BY available_qty DESC
      LIMIT 50
    `).catch(() => ({ rows: [] }));
    snapshot.key_equipment_brands = eqByBrand.rows.map(r => ({
      brand: r.brand, model: r.model, available_qty: r.available_qty
    }));
    snapshot.total_equipment = snapshot.key_equipment_brands.reduce((s, x) => s + x.available_qty, 0);

    // Equipment по категориям (если есть категории) — для AI понимания типов
    try {
      const eqByCat = await db.query(`
        SELECT
          COALESCE(c.name, 'без категории') AS category,
          COUNT(e.*)::int AS qty
        FROM equipment e
        LEFT JOIN equipment_categories c ON c.id = e.category_id
        WHERE e.deleted_at IS NULL
          AND (e.status NOT IN ('written_off','sold') OR e.status IS NULL)
        GROUP BY c.name
        ORDER BY qty DESC
        LIMIT 20
      `);
      snapshot.equipment_by_category = eqByCat.rows;
    } catch (_) { /* категории могут отсутствовать */ }

    // Products + stock — расходники с остатками
    try {
      const prodByCat = await db.query(`
        SELECT
          COALESCE(c.name, 'без категории') AS category,
          COUNT(DISTINCT p.id)::int AS sku_count,
          COALESCE(SUM(s.quantity - COALESCE(s.reserved_qty, 0)), 0)::float AS total_available_qty
        FROM products p
        LEFT JOIN product_categories c ON c.id = p.category_id
        LEFT JOIN stock s ON s.product_id = p.id
        WHERE p.deleted_at IS NULL AND p.is_active = true
        GROUP BY c.name
        ORDER BY sku_count DESC
        LIMIT 20
      `);
      snapshot.consumables_by_category = prodByCat.rows;
      snapshot.total_consumables = prodByCat.rows.reduce((s, x) => s + Number(x.sku_count || 0), 0);
    } catch (_) { /* возможно нет product_categories */ }
  } catch (e) {
    snapshot.error = e.message;
  }
  return snapshot;
}

/**
 * Сводка КАДРОВОГО РЕЗЕРВА. SELECT из employees + employee_assignments — реальные
 * специалисты с квалификациями. Группируется по qualification_name → даёт AI
 * понимание кого у нас сколько и каких разрядов/специальностей.
 */
async function _loadEmployeesSummary() {
  const out = { by_qualification: [], total_active: 0, ready_for_dispatch: 0, error: null };
  try {
    const r = await db.query(`
      SELECT
        COALESCE(NULLIF(TRIM(qualification_name), ''), position, 'без квалификации') AS qualification,
        qualification_grade,
        COUNT(*)::int AS qty,
        COUNT(*) FILTER (WHERE readiness_status = 'ready')::int AS ready,
        ROUND(AVG(day_rate)::numeric, 0) AS avg_day_rate
      FROM employees
      WHERE is_active = true
        AND lower(COALESCE(fio,'')) NOT LIKE '%тест%'
        AND lower(COALESCE(fio,'')) NOT LIKE '%test%'
      GROUP BY qualification, qualification_grade
      ORDER BY qty DESC
      LIMIT 30
    `);
    out.by_qualification = r.rows.map(x => ({
      qualification: x.qualification, grade: x.qualification_grade,
      qty: x.qty, ready_for_dispatch: x.ready,
      avg_day_rate_rub: x.avg_day_rate != null ? Number(x.avg_day_rate) : null
    }));
    out.total_active = out.by_qualification.reduce((s, x) => s + x.qty, 0);
    out.ready_for_dispatch = out.by_qualification.reduce((s, x) => s + x.ready_for_dispatch, 0);
  } catch (e) {
    out.error = e.message;
  }
  return out;
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

  // КОРПОРАТИВНЫЙ КОНТЕКСТ — три ОТДЕЛЬНЫХ источника, не хардкод:
  //   1) company_profile из settings — только мета (лицензии, реквизиты, политики)
  //   2) warehouse snapshot — РЕАЛЬНЫЙ склад (equipment + products + stock) SQL'ом
  //   3) employees summary — РЕАЛЬНЫЙ кадровый резерв SQL'ом
  // AI получает на вход всё, видит «у нас 1239 ед. equipment, бренды X/Y/Z с qty,
  // 985 расходников по категориям, 234 ИТР, 18 готовых к выезду» — не угадывая.
  const [company, warehouse, employees] = await Promise.all([
    _loadCompanyProfile(),
    _loadWarehouseSnapshot(),
    _loadEmployeesSummary()
  ]);
  const hasOwnWasteLicense = !!(company && company.licenses &&
    company.licenses.waste_disposal &&
    company.licenses.waste_disposal.has_own_license === true);

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
    // Retry на parse-fail: sonnet иногда отдаёт битый JSON, повторяем до 2 раз
    // с увеличенным maxTokens и явной инструкцией "только валидный JSON".
    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const sysPrompt = attempt === 1
          ? SYSTEM_PROMPT_EXTRACTION
          : SYSTEM_PROMPT_EXTRACTION + '\n\nКРИТИЧНО: верни ТОЛЬКО валидный JSON-объект, без markdown-ограждения, без комментариев. Никаких trailing commas. Все ключи и строки в двойных кавычках.';
        const PER_ATTEMPT_TIMEOUT_MS = 3 * 60 * 1000;
        const result = await Promise.race([
          aiProvider.completeWithStream({
            system: sysPrompt,
            messages: [{ role: 'user', content: `Документы:\n\n${docsText}` }],
            model: 'sonnet-4-6',
            maxTokens: attempt === 1 ? 6000 : 8000,
            onThought
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('extraction_timeout_3min')), PER_ATTEMPT_TIMEOUT_MS))
        ]);
        if (result._stub || aiProvider.isStubMode()) {
          extraction = {
            works: [{ title: '[stub] Работа из ТЗ', description: 'stub-режим без LLM' }],
            equipment_inventory: [], constraints: {}, timing: {},
            customer_requirements: {}, documents_quality: 'stub',
            extraction_gaps: []
          };
          break;
        }
        extraction = parseStrictJson(result.text);
        if (attempt > 1) onThought(`✓ Извлечение успешно с попытки ${attempt}`);
        break;
      } catch (e) {
        lastErr = e;
        if (attempt < 3) {
          onThought(`⚠ Извлечение упало (попытка ${attempt}): ${e.message} — повторяю с более строгим промптом`);
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    }
    if (!extraction) {
      onThought(`⚠ Все 3 попытки извлечения упали: ${lastErr ? lastErr.message : 'unknown'} — пустой extraction`);
      extraction = { works: [], equipment_inventory: [], constraints: {}, timing: {},
                     customer_requirements: {}, documents_quality: 'extraction_failed',
                     extraction_gaps: [lastErr ? lastErr.message : 'parse failed 3 times'] };
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

    // Подсказка AI: что у нашей компании уже есть — НЕ искать в интернете.
    // Source-of-truth: settings.company_profile + текущие SQL-snapshot склада и кадров.
    const companyContext = `
КОРПОРАТИВНЫЙ ПРОФИЛЬ (settings.company_profile — мета):
${JSON.stringify(company, null, 2)}

РЕАЛЬНЫЙ СКЛАД на сегодня (SQL-snapshot из equipment + products + stock):
- Всего единиц оборудования (не списанных): ${warehouse.total_equipment}
- Топ-15 брендов/моделей: ${JSON.stringify((warehouse.key_equipment_brands || []).slice(0, 15))}
- Equipment по категориям: ${JSON.stringify(warehouse.equipment_by_category || [])}
- Расходников всего SKU: ${warehouse.total_consumables}
- Расходники по категориям: ${JSON.stringify(warehouse.consumables_by_category || [])}

РЕАЛЬНЫЙ КАДРОВЫЙ РЕЗЕРВ (SQL-snapshot из employees):
- Всего активных сотрудников: ${employees.total_active}
- Готовых к выезду сейчас: ${employees.ready_for_dispatch}
- По квалификациям (с реальными ставками day_rate из employees.day_rate):
${JSON.stringify(employees.by_qualification || [])}

ВАЖНО:
- Если у нас есть ${hasOwnWasteLicense ? 'СВОЯ ЛИЦЕНЗИЯ НА УТИЛИЗАЦИЮ — НЕ ищи сторонних утилизаторов, отметь это как наш cost-saving фактор' : 'НЕТ лицензии на утилизацию — найди лицензированных подрядчиков в регионе'}
- Если требуемое оборудование УЖЕ ЕСТЬ в списке наших брендов/моделей — отметь это, не ищи поставщиков (используем своё)
- Если требуемого оборудования НЕТ в нашем складе — найди поставщиков и цены в интернете
- Если требуемой квалификации (по qualification) НЕТ в кадровом резерве — отметь как риск (нужно нанимать/обучать)
- Если работали с похожим заказчиком (см. known_customers_experience) — упомяни в customer_sto_research как experienced
`;
    // До 3 попыток: sonnet с web-plugin иногда отдаёт битый JSON (markdown
    // вперемешку с тегами цитат). Эскалируем промпт и maxTokens.
    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const sysPrompt = attempt === 1
          ? SYSTEM_PROMPT_WEB_RESEARCH
          : SYSTEM_PROMPT_WEB_RESEARCH + '\n\nКРИТИЧНО: верни ТОЛЬКО валидный JSON-объект. Никаких markdown-ограждений, никаких комментариев, никаких тегов <citation>. Все ключи и строки в двойных кавычках, никаких trailing comma.';
        // Жёсткий timeout на каждую попытку (web-plugin может висеть у провайдера).
        // 3 мин × 3 попытки = 9 мин max, под sweeper agent-timeout 12 мин с буфером.
        const PER_ATTEMPT_TIMEOUT_MS = 3 * 60 * 1000;
        const result = await Promise.race([
          aiProvider.completeWithStream({
            system: sysPrompt,
            messages: [{ role: 'user', content: `${companyContext}\n\nИзвлечённый scope:\n${briefForResearch}\n\nПроведи веб-исследование по каждой работе и ключевому оборудованию. Учитывай корпоративный профиль (не ищи то что у нас уже есть). Используй web-plugin активно.` }],
            model: 'sonnet-4-6',
            maxTokens: attempt === 1 ? 8000 : 10000,
            plugins: [{ id: 'web', engine: 'native', max_results: 5 }],
            onThought
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('web_research_timeout_7min')), PER_ATTEMPT_TIMEOUT_MS))
        ]);
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
          break;
        }
        webResearch = parseStrictJson(result.text);
        if (attempt > 1) onThought(`✓ Веб-ресёрч успешно с попытки ${attempt}`);
        break;
      } catch (e) {
        lastErr = e;
        if (attempt < 3) {
          onThought(`⚠ Веб-ресёрч упал (попытка ${attempt}): ${e.message} — повторяю с более строгим промптом`);
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    }
    if (!webResearch) {
      onThought(`⚠ Все 3 попытки веб-ресёрча упали: ${lastErr ? lastErr.message : 'unknown'} — продолжаю без internet-исследования`);
      webResearch = {
        works_research: [], equipment_research: [], regulations_pack: [],
        waste_disposal: {}, competitive_intel: [], customer_sto_research: [],
        logistics_considerations: {}, seasonality_factors: {},
        key_research_findings: [`Веб-ресёрч недоступен: ${lastErr ? lastErr.message : 'parse failed 3 times'}`]
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
  // НОВОЕ (Опус-фикс 19.06.2026): «если ТЗ есть, AI должен его вытащить любыми путями».
  // Если works пуст, но хотя бы один документ с подходящим mime/расширением есть —
  // НЕ задаём «пришлите ТЗ». Делаем (а) повторный жёсткий retry AI с другим промптом,
  // (б) если retry тоже пуст — задаём specific-уточнение, НЕ блокирующее.
  if (!works.length) {
    const parsableDocs = docs.filter((d) => d.content && d.content_chars > 100);
    if (parsableDocs.length > 0) {
      onThought(`⚠ works[] пуст, но есть ${parsableDocs.length} распарсенных документов — повторная попытка извлечения с жёстким промптом`);
      try {
        const docsTextRetry = parsableDocs
          .map((d) => `═══ ${d.name} (${d.content_chars} симв) ═══\n${String(d.content).slice(0, 16000)}`)
          .join('\n\n');
        const HARD_RETRY_PROMPT = `У тебя ТОЧНО ЕСТЬ текст ТЗ в "Документы" блоке ниже.
Перечитай ВНИМАТЕЛЬНО каждый документ. Извлеки ЛЮБЫЕ работы которые упомянуты —
даже если описание неполное. НЕ ПИШИ «не нашёл». Если в документе хоть одна
фраза «промывка», «очистка», «замена», «монтаж», «ремонт», «изоляция», «диагностика»,
«ревизия», «обследование» — это работа. Если контекст неясен — генерируй ТИПОВЫЕ
работы для распознанного оборудования и помечай assumed=true.

Верни СТРОГО JSON:
{
  "works": [
    {"title":"...","description":"...","volume":null,"unit":null,"assumed":false}
  ],
  "extraction_notes": "что именно нашёл и где"
}

Минимум 1 работа. Если не нашёл вообще ничего — верни типовые работы по
распознанному типу оборудования (промывка/ревизия/обследование) с assumed=true.`;
        const retryResult = await Promise.race([
          aiProvider.completeWithStream({
            system: HARD_RETRY_PROMPT,
            messages: [{ role: 'user', content: `Документы:\n\n${docsTextRetry}` }],
            model: 'sonnet-4-6',
            maxTokens: 4000,
            onThought
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('hard_retry_timeout_3min')), 3 * 60 * 1000))
        ]);
        if (!retryResult._stub && !aiProvider.isStubMode()) {
          const retryData = parseStrictJson(retryResult.text);
          const retryWorks = Array.isArray(retryData?.works) ? retryData.works : [];
          if (retryWorks.length > 0) {
            onThought(`✓ Жёсткий retry вытянул ${retryWorks.length} работ (часть может быть assumed=true)`);
            works.push(...retryWorks);
            keyFindings.push(`Жёсткий retry AI вытянул ${retryWorks.length} работ из документов после пустого первого прохода`);
          } else {
            onThought(`⚠ Даже жёсткий retry не нашёл работ — возможно, сканы низкого качества или не ТЗ`);
          }
        }
      } catch (e) {
        onThought(`⚠ Жёсткий retry упал: ${e.message}`);
      }
    }
    if (!works.length) {
      // Документов нет вообще ИЛИ retry тоже пуст — НЕ блокируем «пришлите ТЗ»,
      // а задаём конкретные параметры. Conductor сможет посчитать по типовым нормам.
      clarifications.push({
        channel: 'CUSTOMER', blocking: false,
        question_ru: 'Уточните основные параметры работ: объёмы (кол-во оборудования, площади, тонны), методы (промывка/монтаж/демонтаж/изоляция/ремонт), требуемые сроки и режим (24/7 или дневной).',
        why_we_ask: parsableDocs.length > 0
          ? 'AI не смог точно распарсить перечень работ — возможно сканы низкого качества'
          : 'К работе/тендеру не приложено ТЗ или ведомость объёмов',
        consequence: 'Без этих данных расчёт будет приблизительным',
        default_assumption: 'Будем исходить из типовых параметров для подобных работ и распознанного оборудования'
      });
    }
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

  // Корпоративные cost-savings из реального snapshot (НЕ хардкод, всё из БД)
  if (hasOwnWasteLicense) {
    keyFindings.push('✅ Своя лицензия на утилизацию — экономия 5-15К ₽/т vs конкуренты, не закладываем сторонних');
  }
  if (warehouse.total_equipment > 0) {
    const topBrands = (warehouse.key_equipment_brands || []).slice(0, 5)
      .map(x => `${x.brand}${x.model ? '/' + x.model : ''} (${x.available_qty} ед.)`).join(', ');
    keyFindings.push(`✅ На складе ${warehouse.total_equipment} ед. оборудования. Топ: ${topBrands}`);
  }
  if (warehouse.total_consumables > 0) {
    keyFindings.push(`✅ В каталоге ${warehouse.total_consumables} расходных SKU по ${(warehouse.consumables_by_category || []).length} категориям`);
  }
  if (employees.total_active > 0) {
    keyFindings.push(`✅ Кадровый резерв: ${employees.total_active} активных сотрудников, ${employees.ready_for_dispatch} готовы к выезду сейчас`);
  }
  if (warehouse.error) {
    keyFindings.push(`⚠ Ошибка чтения склада: ${warehouse.error} — Conductor работает без snapshot склада`);
  }

  return {
    summary: `Фаза 0 (исследование): ${works.length} работ, ${equipment.length} оборудования. ${(webResearch.regulations_pack || []).length} НПА в регуляторике. ${hasOwnWasteLicense ? 'Утилизация — своя лицензия.' : ''} Склад: ${warehouse.total_equipment} ед. equipment + ${warehouse.total_consumables} SKU расходники. Кадры: ${employees.total_active}/${employees.ready_for_dispatch} готовы.`,
    key_findings: keyFindings,
    works,
    equipment_inventory: equipment,
    constraints,
    timing,
    customer_requirements: extraction.customer_requirements || {},
    documents_quality: extraction.documents_quality,
    extraction_gaps: extraction.extraction_gaps || [],
    web_research: webResearch,
    company_profile: company,        // мета (settings.company_profile)
    warehouse_snapshot: warehouse,   // реальный склад из equipment+products+stock
    employees_summary: employees,    // реальный кадровый резерв из employees
    clarifications
  };
}

module.exports = { run };
