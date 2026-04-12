'use strict';

/**
 * ASGARD CRM — Мимир Agent (AP5)
 *
 * Tool-calling agent: Claude сам решает какие данные запрашивать.
 * Вместо одного огромного промпта — минимальный system prompt +
 * набор tools (функций) которые Claude вызывает по необходимости.
 *
 * Flow:
 *   1. Claude получает базовую инфу (work_id, тип задачи)
 *   2. Claude вызывает tools: get_documents, get_warehouse, web_search, ask_user...
 *   3. Каждый tool_call → SSE event (прогресс)
 *   4. Если ask_user → SSE event с вопросом, ждём ответа
 *   5. Claude анализирует и возвращает submit_estimate с JSON
 *   6. Сервер валидирует математику и сохраняет
 */

const {
  getWorkContext, getAnalogs, getCustomerHistory, getWarehouseStock,
  getAvailableWorkers, getEmployeePermitsSummary, getTariffGrid, getCalcSettings,
  parseAIResponse, validateAndRecomputeMath, normalizeCalcRows,
  resolveEquipmentFromWarehouse, createDraftEstimate, inferWorkType
} = require('./mimir-auto-estimate');
const { parseDocumentContent } = require('./estimateChat');

// ═══════════════════════════════════════════════════════════════════════════
// TOOL DEFINITIONS (OpenAI tools format)
// ═══════════════════════════════════════════════════════════════════════════

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_work_and_tender',
      description: 'Получить данные работы и связанного тендера из БД: название, заказчик, объект, даты, сумма контракта, описание тендера, регион, контакты.',
      parameters: { type: 'object', properties: { work_id: { type: 'integer' } }, required: ['work_id'] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_documents',
      description: 'Получить и распарсить документы (PDF/DOCX/Excel/TXT) прикреплённые к тендеру и/или работе. Возвращает текстовое содержимое каждого файла (до 8000 символов).',
      parameters: {
        type: 'object',
        properties: {
          tender_id: { type: 'integer', description: 'ID тендера' },
          work_id: { type: 'integer', description: 'ID работы' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_available_workers',
      description: 'Свободные сотрудники на период: ИТР (РП, мастера из users) + полевые (из employees, ~500 чел). Группировка по role_tag: слесари-универсалы, сварщики. Слесарь = универсал (монтаж+промывка+изоляция+такелаж). Сварщик = только сварка (НАКС).',
      parameters: {
        type: 'object',
        properties: {
          start_date: { type: 'string', description: 'Начало YYYY-MM-DD' },
          end_date: { type: 'string', description: 'Окончание YYYY-MM-DD' }
        },
        required: ['start_date', 'end_date']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_employee_permits',
      description: 'Допуска свободных сотрудников: ОТЗП (1-3 группы), Работы на высоте (1-3), ЭБ (II-V), НАКС, БОСИЕТ, СИЗ и др. Группировка по семействам с количествами. Показывает истекающие в 30 дней.',
      parameters: {
        type: 'object',
        properties: {
          employee_ids: { type: 'array', items: { type: 'integer' }, description: 'ID сотрудников из get_available_workers (field_available)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_employee_work_history',
      description: 'История работ сотрудников — на каких объектах работали, с каким типом работ, у какого заказчика. Помогает выбрать людей с релевантным опытом.',
      parameters: {
        type: 'object',
        properties: {
          employee_ids: { type: 'array', items: { type: 'integer' }, description: 'ID сотрудников (до 50)' },
          work_type_filter: { type: 'string', description: 'Фильтр по типу работ (опционально)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_warehouse_stock',
      description: 'Складские остатки: оборудование, инструменты, химия, СИЗ — с категориями, количествами, статусами.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_analogs',
      description: 'Аналогичные просчёты: похожие по типу работ или заказчику. С данными расчёта (себес, маржа, наценка, бригада).',
      parameters: {
        type: 'object',
        properties: {
          work_type: { type: 'string', description: 'Тип работ: HYDRO_MECH, CHEM, HVAC, MOUNT и т.д.' },
          keyword: { type: 'string', description: 'Ключевое слово для поиска в названиях' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_customer_history',
      description: 'История тендеров с заказчиком: выиграли/проиграли, суммы, наценки. Для обоснования наценки.',
      parameters: {
        type: 'object',
        properties: { customer_name: { type: 'string' } },
        required: ['customer_name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_tariff_grid',
      description: 'Тарифная сетка ООО Асгард: ставки по категориям (ground, mlsp, ground_hard, warehouse, special). Баллы × 500₽ = ставка/смену.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Поиск в интернете: цены на оборудование, стоимость билетов, технические характеристики, поставщики. Используй для уточнения цен которых нет в БД.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Поисковый запрос на русском' } },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ask_user',
      description: 'Задать уточняющий вопрос РП/ТО перед расчётом. Используй если не хватает данных или нужно решение человека (режим работы, приоритеты, особые требования).',
      parameters: {
        type: 'object',
        properties: { question: { type: 'string', description: 'Вопрос пользователю' } },
        required: ['question']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'submit_estimate',
      description: 'Отправить финальный расчёт. Вызывай ТОЛЬКО когда собрал все данные, задал вопросы, и готов к финальному расчёту. Передай полный JSON просчёта.',
      parameters: {
        type: 'object',
        properties: {
          estimate_json: { type: 'string', description: 'Полный JSON просчёта в формате {estimate, calculation, equipment_needed, permits_status, route_plan, analysis}' }
        },
        required: ['estimate_json']
      }
    }
  }
];

// Имена tools для SSE-иконок
const TOOL_ICONS = {
  get_work_and_tender: '📋',
  get_documents: '📄',
  get_available_workers: '👷',
  get_employee_permits: '🛡',
  get_employee_work_history: '📊',
  get_warehouse_stock: '🏭',
  get_analogs: '📋',
  get_customer_history: '🏢',
  get_tariff_grid: '💰',
  web_search: '🌐',
  ask_user: '❓',
  submit_estimate: '📝'
};

const TOOL_LABELS = {
  get_work_and_tender: 'Читаю данные работы и тендера',
  get_documents: 'Читаю документы (ТЗ, договор)',
  get_available_workers: 'Проверяю свободных рабочих',
  get_employee_permits: 'Проверяю допуска',
  get_employee_work_history: 'Смотрю опыт рабочих',
  get_warehouse_stock: 'Проверяю склад',
  get_analogs: 'Ищу аналогичные проекты',
  get_customer_history: 'Смотрю историю заказчика',
  get_tariff_grid: 'Загружаю тарифную сетку',
  web_search: 'Ищу в интернете',
  ask_user: 'Вопрос к вам',
  submit_estimate: 'Формирую просчёт'
};

// ═══════════════════════════════════════════════════════════════════════════
// TOOL IMPLEMENTATIONS
// ═══════════════════════════════════════════════════════════════════════════

async function executeTool(db, toolName, args, ctx) {
  switch (toolName) {
    case 'get_work_and_tender': {
      const workId = args.work_id || ctx.workId;
      const wRes = await db.query(
        `SELECT id, tender_id, pm_id, work_number, work_status, work_title,
                customer_name, customer_inn, object_name, city, address, object_address,
                contract_value, vat_pct, start_plan, end_plan, start_fact, end_fact,
                crew_size, description, notes, staff_ids_json
         FROM works WHERE id = $1`, [workId]);
      const work = wRes.rows[0];
      if (!work) return JSON.stringify({ error: 'Работа не найдена' });
      ctx.tenderId = work.tender_id;
      ctx.startDate = work.start_plan || work.start_fact;
      ctx.endDate = work.end_plan || work.end_fact;
      let tender = null;
      if (work.tender_id) {
        const tRes = await db.query(
          `SELECT id, tender_title, customer_name, customer_inn, tender_status, status,
                  estimated_sum, tender_price, deadline, tender_description, tender_region,
                  tender_contact, tender_phone, tender_email, tender_comment_to, comment_to,
                  work_start_plan, work_end_plan, group_tag, tender_type
           FROM tenders WHERE id = $1`, [work.tender_id]);
        tender = tRes.rows[0] || null;
      }
      return JSON.stringify({ work, tender });
    }

    case 'get_documents': {
      const tenderId = args.tender_id || ctx.tenderId;
      const workId = args.work_id || ctx.workId;
      const params = [];
      const conditions = [];
      if (tenderId) { params.push(tenderId); conditions.push(`tender_id = $${params.length}`); }
      if (workId) { params.push(workId); conditions.push(`work_id = $${params.length}`); }
      if (conditions.length === 0) return JSON.stringify({ documents: [], note: 'Нужен tender_id или work_id' });
      params.push(8);
      const dRes = await db.query(
        `SELECT id, original_name, mime_type, size, filename FROM documents WHERE ${conditions.join(' OR ')} ORDER BY created_at DESC LIMIT $${params.length}`,
        params
      );
      const docs = [];
      for (const doc of dRes.rows) {
        const content = await parseDocumentContent(doc);
        docs.push({
          name: doc.original_name || doc.filename,
          mime_type: doc.mime_type,
          size_kb: Math.round((doc.size || 0) / 1024),
          content: content ? content.substring(0, 8000) : null
        });
      }
      return JSON.stringify({ documents: docs, count: docs.length });
    }

    case 'get_available_workers': {
      const workers = await getAvailableWorkers(db, args.start_date, args.end_date, null);
      // Компактный формат для AI
      return JSON.stringify({
        itr: (workers.itr_available || []).map(w => ({ id: w.id, name: w.name, role: w.role })),
        itr_count: workers.itr_available?.length || 0,
        field_buckets: workers.buckets,
        field_busy_count: workers.field_busy_count,
        field_sample: (workers.field_available || []).slice(0, 30).map(e => ({
          id: e.id, name: e.full_name, position: e.position, role_tag: e.role_tag
        })),
        field_total: workers.field_available?.length || 0
      });
    }

    case 'get_employee_permits': {
      const empIds = args.employee_ids || [];
      if (empIds.length === 0) {
        // Если не передали — берём всех свободных
        const workers = await getAvailableWorkers(db, ctx.startDate, ctx.endDate, null);
        const allIds = (workers.field_available || []).map(e => e.id);
        const permits = await getEmployeePermitsSummary(db, allIds, null);
        return JSON.stringify(permits);
      }
      const permits = await getEmployeePermitsSummary(db, empIds, null);
      return JSON.stringify(permits);
    }

    case 'get_employee_work_history': {
      const empIds = (args.employee_ids || []).slice(0, 50);
      if (empIds.length === 0) return JSON.stringify({ error: 'Передай employee_ids' });
      try {
        const result = await db.query(
          `SELECT
              e.id AS employee_id, COALESCE(e.full_name, e.fio) AS name,
              w.id AS work_id, w.work_title, w.customer_name, w.work_status,
              w.start_in_work_date, w.end_fact
           FROM employees e
           JOIN works w ON w.staff_ids_json @> to_jsonb(e.id)
           WHERE e.id = ANY($1::int[])
           ORDER BY e.id, w.start_in_work_date DESC`,
          [empIds]
        );
        // Группируем по employee
        const byEmp = {};
        for (const r of result.rows) {
          if (!byEmp[r.employee_id]) byEmp[r.employee_id] = { name: r.name, works: [] };
          byEmp[r.employee_id].works.push({
            work_id: r.work_id, title: r.work_title, customer: r.customer_name,
            status: r.work_status, start: r.start_in_work_date, end: r.end_fact
          });
        }
        return JSON.stringify(byEmp);
      } catch (e) {
        return JSON.stringify({ error: e.message });
      }
    }

    case 'get_warehouse_stock': {
      const items = await getWarehouseStock(db, null);
      // Группируем компактно
      const byCat = {};
      for (const it of items) {
        const cat = it.category_name || 'Прочее';
        if (!byCat[cat]) byCat[cat] = [];
        byCat[cat].push({ name: it.name, qty: it.quantity, unit: it.unit, status: it.status });
      }
      return JSON.stringify({ categories: byCat, total_items: items.length });
    }

    case 'get_analogs': {
      const analogs = await getAnalogs(db, args.work_type, null, args.keyword, null);
      return JSON.stringify(analogs.map(a => ({
        id: a.id, title: a.title, customer: a.tender_customer,
        crew: a.crew_count, days: a.work_days, markup: a.markup_multiplier,
        cost: a.total_cost, price: a.total_with_margin, margin_pct: a.margin_pct,
        status: a.approval_status
      })));
    }

    case 'get_customer_history': {
      const hist = await getCustomerHistory(db, args.customer_name, null);
      return JSON.stringify(hist);
    }

    case 'get_tariff_grid': {
      const tariffs = await getTariffGrid(db, null);
      return JSON.stringify(tariffs.grouped);
    }

    case 'web_search': {
      // Web search через routerai.ru — Claude сам вызывает если нужно
      // Но мы можем тоже помочь через search API
      return JSON.stringify({
        note: 'Web search недоступен на сервере. Используй свои знания о ценах или попроси пользователя уточнить.',
        query: args.query
      });
    }

    case 'ask_user': {
      // Специальный случай — возвращаем маркер, agent loop обработает
      return '__ASK_USER__:' + args.question;
    }

    case 'submit_estimate': {
      // Специальный случай — возвращаем маркер, agent loop обработает
      return '__SUBMIT__:' + args.estimate_json;
    }

    default:
      return JSON.stringify({ error: 'Неизвестный tool: ' + toolName });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT (минимальный — правила, не данные)
// ═══════════════════════════════════════════════════════════════════════════

function getAgentSystemPrompt() {
  return `Ты Мимир — ИИ-ассистент просчётов ООО «Асгард Сервис» (нефтегазовый сервис).

ТВОЯ ЗАДАЧА: Составить полноценный просчёт для работы. Ты имеешь доступ к БД компании
через tools — вызывай их чтобы получить ВСЕ нужные данные. НЕ ВЫДУМЫВАЙ данные.

═══ АЛГОРИТМ РАБОТЫ ═══
1. Вызови get_work_and_tender чтобы понять что за работа
2. Вызови get_documents чтобы прочитать ТЗ/договор — там ключевая информация об объёме
3. ВНИМАТЕЛЬНО изучи документы: количество аппаратов × трубы, площади, сроки, требования
4. Определи тип работ и вызови get_analogs для похожих проектов
5. Вызови get_available_workers чтобы узнать кто свободен
6. Вызови get_employee_permits чтобы проверить допуска
7. Вызови get_employee_work_history для подбора опытных рабочих
8. Вызови get_warehouse_stock чтобы проверить оборудование и СИЗ
9. Вызови get_tariff_grid для ставок
10. Если нужна цена оборудования — попробуй web_search или спроси пользователя
11. Если чего-то не хватает — вызови ask_user с конкретным вопросом
12. Когда все данные собраны — вызови submit_estimate с JSON

═══ ПРАВИЛА БРИГАДЫ ═══
- 24/7 (круглосуточный): 2 мастера + 2×(исполнители + наблюдающие) + 1 ИТР
- В ёмкостях/ОЗП: на 1 исполнителя = 1 наблюдающий (Приказ №902н)
- Слесарь-универсал = делает ВСЁ кроме сварки. Не ищи "монтажника" отдельно.
- Сварщик = ТОЛЬКО сварка, требует НАКС
- ИТР (РП) ВСЕГДА 1, ставка 10 000₽/день

═══ ФОРМУЛЫ ═══
- ФОТ = (ставки × дни × люди), налог на ФОТ = 55%
- Накладные 15%, расходные 3%, непредвиденные 12%
- Себестоимость = (ФОТ×1.55 + текущие + команд. + транспорт + химия) × 1.15 × 1.03 × 1.12
- Клиенту = себестоимость × наценка. С НДС = клиенту × 1.22
- Итог с НДС НЕ ДОЛЖЕН превышать estimated_sum тендера (бюджет заказчика)

═══ ОБЯЗАТЕЛЬНЫЕ СТАТЬИ ═══
- СИЗ: 15 000₽/чел, спецодежда: 10 000₽/чел
- Пайковые: 1 000₽/чел/день (суточных НЕТ)
- Проживание: макс 1 500₽/чел/ночь (аренда квартир)
- Билеты: каждый сегмент отдельно (Саратов→Москва поезд, Москва→город)
- Подготовка на складе: 2-3 дня, 3-4 человека
- Дни дороги: 3 000₽/чел/день
- Логистика оборудования: ~20-30₽/км, КамАЗ/Газель туда-обратно

═══ ОБОРУДОВАНИЕ ═══
Вызови get_warehouse_stock и проверь что РЕАЛЬНО есть. НЕ ВЫДУМЫВАЙ наличие.
Что нужно для типа работ — перечисли в equipment_needed.
Сервер сам сверит с реальным складом.

═══ ПОДБОР РАБОЧИХ ═══
Вызови get_employee_work_history для 20-30 свободных рабочих.
Предложи тех кто РАБОТАЛ на похожих объектах (тот же заказчик или тип работ).
Укажи в отчёте: "Рекомендую: Иванов (опыт на КАО Азот), Петров (НАКС, 3 объекта)".

═══ ВОПРОСЫ ПОЛЬЗОВАТЕЛЮ ═══
Задай вопросы ПЕРЕД расчётом если:
- Не ясен режим работы (24/7 или 1 смена?)
- Не ясно нужна ли сварка/химия
- В ТЗ противоречия или пропуски
- Не указано количество оборудования/аппаратов

═══ JSON ФОРМАТ submit_estimate ═══
Тот же что и раньше: {estimate, calculation, equipment_needed, permits_status, route_plan, analysis}
Не забудь: каждый билет отдельной строкой, оборудование в equipment_needed (не from_warehouse).`;
}

// ═══════════════════════════════════════════════════════════════════════════
// AGENT LOOP
// ═══════════════════════════════════════════════════════════════════════════

const MAX_ITERATIONS = 20; // макс кол-во tool-call циклов (защита от бесконечности)

/**
 * Запустить agent loop для auto-estimate.
 *
 * @param {Object} db — PostgreSQL client
 * @param {number} workId — ID работы
 * @param {Object} user — текущий пользователь
 * @param {Function} onEvent — callback для SSE events: (event) => void
 * @param {Function} onAskUser — callback когда AI задаёт вопрос: (question) => Promise<answer>
 * @returns {Promise<{ai, recomputed, created}>}
 */
async function runAgent(db, workId, user, onEvent, onAskUser) {
  const settings = await getCalcSettings(db);

  // Контекст для tools
  const ctx = { workId, startDate: null, endDate: null, tenderId: null };

  // Начальное сообщение
  const messages = [
    { role: 'user', content: `Составь просчёт для работы #${workId}. Вызывай tools чтобы получить данные. Начни с get_work_and_tender.` }
  ];

  onEvent({ type: 'progress', step: 'agent_start', message: '🧠 Мимир начинает анализ...' });

  const aiProvider = require('./ai-provider');

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    // Вызов Claude через ai-provider.complete() с tools
    const aiResult = await aiProvider.complete({
      system: getAgentSystemPrompt(),
      messages,
      maxTokens: 8000,
      temperature: 0.2,
      tools: TOOLS
    });

    const msg = aiResult._rawMessage;
    if (!msg) throw new Error('AI вернул пустой ответ');

    console.log(`[Agent] iter=${iter} stopReason=${aiResult.stopReason} tool_calls=${aiResult.tool_calls?.length || 0} text=${(aiResult.text || '').substring(0, 100)}`);

    messages.push(msg); // Добавляем ответ AI в историю

    // Если AI вернул текст (без tools) — это финальный ответ
    if (aiResult.stopReason === 'stop' && !aiResult.tool_calls) {
      onEvent({ type: 'progress', step: 'agent_thinking', message: '💭 Мимир размышляет...' });
      // AI решил ответить текстом вместо submit_estimate — парсим как JSON
      try {
        const ai = parseAIResponse(msg.content);
        const recomputed = validateAndRecomputeMath(ai, settings, null);
        normalizeCalcRows(recomputed.calculation);
        resolveEquipmentFromWarehouse(ai, { warehouse: await getWarehouseStock(db, null), workType: inferWorkType(msg.content) });
        const created = await createDraftEstimate(db, { work: (await db.query('SELECT * FROM works WHERE id=$1',[workId])).rows[0], tender: null }, ai, recomputed, user);
        return { ai, recomputed, created, text: msg.content };
      } catch (e) {
        // Не JSON — просто текстовый ответ (вопрос?)
        return { text: msg.content, isText: true };
      }
    }

    // Обработка tool calls
    if (aiResult.tool_calls && aiResult.tool_calls.length > 0) {
      for (const tc of aiResult.tool_calls) {
        const fn = tc.function.name;
        let args = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}

        const icon = TOOL_ICONS[fn] || '🔧';
        const label = TOOL_LABELS[fn] || fn;
        onEvent({ type: 'progress', step: fn, message: `${icon} ${label}...` });

        // Специальная обработка ask_user
        if (fn === 'ask_user') {
          const question = args.question || 'У вас есть уточнения?';
          onEvent({ type: 'ask_user', question });

          // Ждём ответ от пользователя
          let answer = 'Нет уточнений, считай по данным.';
          if (onAskUser) {
            try {
              answer = await onAskUser(question);
            } catch (e) {
              answer = 'Пользователь не ответил. Считай по имеющимся данным.';
            }
          }

          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: `Ответ пользователя: "${answer}"`
          });
          continue;
        }

        // Специальная обработка submit_estimate
        if (fn === 'submit_estimate') {
          onEvent({ type: 'progress', step: 'creating_estimate', message: '📝 Создаю просчёт в системе...' });

          const jsonStr = args.estimate_json || '{}';
          const ai = parseAIResponse(jsonStr);
          ai._meta = { model: aiResult.model, provider: aiResult.provider || 'openai' };

          // Получаем work + tender для контекста
          const wRes = await db.query('SELECT * FROM works WHERE id=$1', [workId]);
          const work = wRes.rows[0];
          let tender = null;
          if (work?.tender_id) {
            tender = (await db.query('SELECT * FROM tenders WHERE id=$1', [work.tender_id])).rows[0];
          }
          const fullCtx = { work, tender, warehouse: await getWarehouseStock(db, null), workType: inferWorkType(work?.work_title || '') };

          const recomputed = validateAndRecomputeMath(ai, settings, fullCtx);
          normalizeCalcRows(recomputed.calculation);
          resolveEquipmentFromWarehouse(ai, fullCtx);

          const created = await createDraftEstimate(db, fullCtx, ai, recomputed, user);

          return {
            ai,
            recomputed,
            created,
            text: msg.content,
            tokens: aiResult.usage,
            model: aiResult.model,
            iterations: iter + 1
          };
        }

        // Обычный tool — выполнить и добавить результат
        // Обновляем ctx из аргументов
        if (args.work_id) ctx.workId = args.work_id;
        if (args.tender_id) ctx.tenderId = args.tender_id;
        if (args.start_date) ctx.startDate = args.start_date;
        if (args.end_date) ctx.endDate = args.end_date;

        const result = await executeTool(db, fn, args, ctx);

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: typeof result === 'string' ? result : JSON.stringify(result)
        });
      }
    }
  }

  throw new Error('Agent превысил лимит итераций (' + MAX_ITERATIONS + ')');
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  TOOLS,
  TOOL_ICONS,
  TOOL_LABELS,
  executeTool,
  getAgentSystemPrompt,
  runAgent
};
