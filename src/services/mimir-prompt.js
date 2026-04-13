'use strict';

/**
 * ASGARD CRM — Мимир Prompt Builder (AP5)
 *
 * Минимальный system prompt (правила компании, формулы, формат ответа).
 * Данные передаются отдельно через user message — Claude сам анализирует.
 */

/**
 * System prompt — ТОЛЬКО правила и формат. Без данных.
 */
function getSystemPrompt() {
  return `Ты Мимир — ИИ-ассистент для расчёта просчётов ООО «Асгард Сервис» (промышленный сервис для нефтегаза).

Тебе переданы ВСЕ данные из CRM: работа, тендер, документы (ТЗ/договор), аналоги, история заказчика,
завершённые работы с реальными расходами, склад, сотрудники с городами, допуска, тарифы, настройки.

⛔ КРИТИЧНО: Возвращай ТОЛЬКО JSON. Никакого текста до или после JSON. Никаких пояснений, рассуждений,
markdown. Начни ответ с { и закончи }. Весь анализ и рассуждения пиши ВНУТРИ JSON в полях "comment",
"markup_reasoning", "summary" и т.д.

═══ ФОРМУЛЫ РАСЧЁТА (бизнес-правила Асгарда) ═══
- ФОТ = ставки из тарифной сетки × дни × люди
- Налог на ФОТ = 55% (сверху на ФОТ)
- Накладные = 15% от промежуточной
- Расходные = 3%
- Непредвиденные = 12% (буфер, не снижать)
- НДС = из настроек (обычно 22%)
- ИТР (РП) = 10 000₽/день ФИКСИРОВАННАЯ (не из тарифной сетки). ВСЕГДА 1 человек.
- Дни дороги оплачиваются: 3 000₽/чел/день

═══ ЧТО ДЕЛАТЬ ═══

ШАГ 1: ИЗУЧИ ДАННЫЕ. Прочитай ТЗ/договор, пойми объём работ.

ШАГ 2: ЗАДАЙ ВОПРОСЫ (если есть). Верни JSON:
{"phase":"questions","questions":["вопрос1","вопрос2"]}
Задавай если: неясен режим (24/7 или 1 смена?), нужна ли сварка/химия, в ТЗ противоречия.
Если всё ясно — сразу к шагу 3.

ШАГ 3: ПРОСЧЁТ. Верни JSON:
{"phase":"estimate","estimate":{...},"calculation":{...},"equipment_needed":[...],"permits_status":{...},"route_plan":{...},"recommended_crew":[...],"analysis":{...}}

═══ ФОРМАТ JSON (шаг 3) ═══
{
  "phase": "estimate",
  "estimate": {
    "title": "название",
    "crew_count": число, "work_days": число, "road_days": число,
    "object_city": "город", "markup_multiplier": число,
    "comment": "обоснование 3-4 предложения"
  },
  "calculation": {
    "personnel": [{"item":"роль","qty":N,"rate":ставка,"days":дни,"total":итого}],
    "current_costs": [{"item":"описание","total":сумма}],
    "travel": [{"item":"Билет Саратов→Москва (поезд)","qty":N,"rate":цена,"total":итого}],
    "transport": [{"item":"описание","qty":N,"rate":цена,"total":итого}],
    "chemistry": []
  },
  "equipment_needed": [
    {"item":"название","quantity":N,"purpose":"зачем"}
  ],
  "permits_status": {
    "required_permits": ["ОТЗП","Высота"...],
    "available_crew": [{"permit":"ОТЗП","needed":N,"available":M,"enough":true/false}],
    "training_needed": [{"permit":"тип","people_count":N,"cost_per_person":цена}],
    "summary": "текст"
  },
  "route_plan": {
    "legs": [{"from":"откуда","to":"куда","transport":"поезд/авто","duration_days":N,"cost_per_person":цена}],
    "warehouse_stop": {"location":"Москва, склад","days":2,"activities":"что делают"},
    "summary": "текст"
  },
  "recommended_crew": [
    {"employee_id":N,"name":"ФИО","reason":"почему рекомендую (опыт на похожем объекте)"}
  ],
  "analysis": {
    "markup_reasoning": "обоснование наценки со ссылками на аналоги",
    "warnings": [{"level":"warning|critical|info","title":"заголовок","text":"описание"}]
  }
}

═══ КЛЮЧЕВЫЕ ПРАВИЛА ═══
- Билеты: считай от ГОРОДА ПРОЖИВАНИЯ каждого сотрудника (employees.city). НЕ от Москвы и НЕ от Саратова!
  Посмотри город каждого рекомендованного работника и считай маршрут ОТТУДА.
  Маршрут: город сотрудника → Москва (склад, 2-3 дня подготовка) → город объекта. Каждый сегмент отдельно.
  Если у сотрудника city пустой — считай от Саратова (офис компании).
- Тип очистки: определяй СТРОГО из ТЗ/договора. Гидромеханическая очистка ≠ АВД (аппарат высокого давления).
  Гидромеханическая = ГМО-установки (Тайфун, Вулкан, Посейдон и аналоги) с вращающимися головками.
  АВД = аппараты высокого давления (Керхер и т.п.) — другая технология.
  Изучи тип отложений из ТЗ (магнетит, накипь, полимер и т.д.) и подбери оборудование АДЕКВАТНОЕ типу отложений.
- Сроки: бери НАПРЯМУЮ из работы (start_plan→end_plan) или тендера (work_start_plan→work_end_plan).
  Это сроки из ДОГОВОРА с заказчиком — жёсткие. Уложись в них. Сервер НЕ корректирует твои сроки.
- Оборудование: перечисли ТОЛЬКО то что реально нужно для ВЫПОЛНЕНИЯ работ. Без лишнего.
  НЕ решай что на складе — сервер проверит.
- Подбор рабочих: из данных work_history выбери тех кто РАБОТАЛ на похожих объектах.
  Предложи конкретных людей в recommended_crew с обоснованием.
- Наценка: итог с НДС НЕ должен превышать estimated_sum тендера. Ориентируйся на аналоги и маржинальность.
- Пайковые: 1000₽/чел/день. Суточных НЕТ.
- СИЗ: 15000₽/чел. Спецодежда: 10000₽/чел.
- Проживание: макс 1500₽/чел/ночь (аренда квартир).
- Лучше ЗАВЫСИТЬ цену чем занизить — заказчик торгуется вниз.

═══ ЧЕГО НЕ ДОБАВЛЯТЬ ═══
- БОСИЕТ — это для МЛСП (морских платформ). На заводах НЕ нужен. Не включай в допуска.
- НЕ добавляй позиции которые обеспечивает Заказчик: вода, связь, интернет, электричество, бытовки.
- НЕ более 5 warnings (только критичные). Не дублируй информацию в warnings и comment.
- НЕ добавляй оборудование "на всякий случай" — только то без чего работа невозможна.

⛔ ПОВТОРЯЮ: ответ = ТОЛЬКО JSON. Первый символ { последний }. Без текста вокруг. Без \`\`\`json.
Все рассуждения — внутри JSON полей (comment, markup_reasoning, summary).`;
}

/**
 * Сериализовать собранные данные в текст для user message.
 */
function serializeContext(ctx) {
  const parts = [];

  // 1. Работа
  parts.push('═══ РАБОТА ═══');
  parts.push(JSON.stringify(ctx.work, null, 0));

  // 2. Тендер
  if (ctx.tender) {
    parts.push('\n═══ ТЕНДЕР ═══');
    parts.push(JSON.stringify(ctx.tender, null, 0));
  }

  // 3. Документы
  parts.push('\n═══ ДОКУМЕНТЫ (' + ctx.documents.length + ') ═══');
  for (const doc of ctx.documents) {
    parts.push(`📄 ${doc.name} (${doc.size_kb}KB)`);
    if (doc.content) parts.push(doc.content);
  }

  // 4. ТКП
  if (ctx.tkp.length > 0) {
    parts.push('\n═══ ТКП (' + ctx.tkp.length + ') ═══');
    parts.push(JSON.stringify(ctx.tkp, null, 0));
  }

  // 5. Аналоги
  parts.push('\n═══ АНАЛОГИЧНЫЕ ПРОСЧЁТЫ (' + ctx.analogs.length + ') ═══');
  parts.push(JSON.stringify(ctx.analogs, null, 0));

  // 6. История заказчика
  if (ctx.customerHistory.length > 0) {
    parts.push('\n═══ ИСТОРИЯ ТЕНДЕРОВ ЗАКАЗЧИКА (' + ctx.customerHistory.length + ') ═══');
    parts.push(JSON.stringify(ctx.customerHistory, null, 0));
  }

  // 7. Завершённые работы с реальными расходами
  if (ctx.completedWorks.length > 0) {
    parts.push('\n═══ ЗАВЕРШЁННЫЕ РАБОТЫ С РЕАЛЬНЫМИ РАСХОДАМИ (' + ctx.completedWorks.length + ') ═══');
    parts.push(JSON.stringify(ctx.completedWorks, null, 0));
  }

  // 8. Средняя маржинальность
  parts.push('\n═══ СРЕДНЯЯ МАРЖИНАЛЬНОСТЬ КОМПАНИИ ═══');
  parts.push(JSON.stringify(ctx.marginStats, null, 0));

  // 9. Склад
  parts.push('\n═══ СКЛАД (' + ctx.warehouse.length + ' позиций) ═══');
  // Группируем по категории для компактности
  const byCat = {};
  for (const item of ctx.warehouse) {
    const cat = item.category_name || 'Прочее';
    if (!byCat[cat]) byCat[cat] = [];
    byCat[cat].push(`${item.name}: ${item.quantity || 1}${item.unit ? ' ' + item.unit : ''} (${item.status || 'available'}${item.purchase_price ? ', цена покупки ' + item.purchase_price + '₽' : ''})`);
  }
  for (const [cat, items] of Object.entries(byCat)) {
    parts.push(`[${cat}] ${items.join('; ')}`);
  }

  // 10. Сотрудники с городами
  parts.push('\n═══ СОТРУДНИКИ (' + ctx.employees.length + ') ═══');
  // Группируем по role_tag
  const byTag = {};
  for (const e of ctx.employees) {
    const tag = e.role_tag || 'Без тега';
    if (!byTag[tag]) byTag[tag] = [];
    byTag[tag].push(`#${e.id} ${e.name}${e.city ? ' (г.' + e.city + ')' : ''}${e.position ? ' / ' + e.position : ''}`);
  }
  for (const [tag, list] of Object.entries(byTag)) {
    parts.push(`[${tag}: ${list.length} чел]`);
    // Первые 30 поименно, остальные только count
    const show = list.slice(0, 30);
    parts.push(show.join('; '));
    if (list.length > 30) parts.push(`... и ещё ${list.length - 30}`);
  }

  // 11. Допуска всех сотрудников
  parts.push('\n═══ ДОПУСКА СОТРУДНИКОВ (' + ctx.allPermits.length + ' записей) ═══');
  // Агрегируем по типу
  const byType = {};
  for (const p of ctx.allPermits) {
    const t = p.permit_type || 'Прочее';
    if (!byType[t]) byType[t] = { count: 0, expiring: 0, employees: [] };
    byType[t].count++;
    if (p.expiry_date) {
      const daysLeft = Math.round((new Date(p.expiry_date) - Date.now()) / 86400000);
      if (daysLeft >= 0 && daysLeft <= 30) byType[t].expiring++;
    }
    if (byType[t].employees.length < 5) {
      byType[t].employees.push(`#${p.employee_id} ${p.employee_name}`);
    }
  }
  for (const [type, data] of Object.entries(byType).sort((a, b) => b[1].count - a[1].count)) {
    parts.push(`${type}: ${data.count} чел${data.expiring > 0 ? ' (⚠️ ' + data.expiring + ' истекают в 30 дн)' : ''}`);
  }

  // 12. Занятость
  parts.push('\n═══ ЗАНЯТОСТЬ НА ПЕРИОД ═══');
  parts.push(`Занятые employee_ids: [${ctx.availability.busy_employee_ids.join(',')}]`);
  parts.push(`Занятые pm_ids: [${ctx.availability.busy_pm_ids.join(',')}]`);
  parts.push('(Свободные = все из списка СОТРУДНИКИ минус занятые)');

  // 13. История работ сотрудников
  parts.push('\n═══ ИСТОРИЯ РАБОТ СОТРУДНИКОВ (кто где работал) ═══');
  // Группируем по employee_id
  const byEmp = {};
  for (const r of ctx.workHistory) {
    if (!byEmp[r.employee_id]) byEmp[r.employee_id] = [];
    byEmp[r.employee_id].push(`${r.customer_name || '?'}: ${r.work_title || '?'} (${r.city || '?'})`);
  }
  const empEntries = Object.entries(byEmp).slice(0, 100); // Первые 100 сотрудников
  for (const [empId, works] of empEntries) {
    parts.push(`#${empId}: ${works.slice(0, 5).join(' | ')}${works.length > 5 ? ' +' + (works.length - 5) + ' ещё' : ''}`);
  }
  if (Object.keys(byEmp).length > 100) {
    parts.push(`... и ещё ${Object.keys(byEmp).length - 100} сотрудников`);
  }

  // 14. Тарифы
  parts.push('\n═══ ТАРИФНАЯ СЕТКА ═══');
  const tariffByCat = {};
  for (const t of ctx.tariffs) {
    const cat = t.category || 'other';
    if (!tariffByCat[cat]) tariffByCat[cat] = [];
    tariffByCat[cat].push(`${t.position_name}: ${t.points}б × ${t.point_value}₽ = ${t.rate_per_shift}₽/смена`);
  }
  for (const [cat, list] of Object.entries(tariffByCat)) {
    parts.push(`[${cat}] ${list.join('; ')}`);
  }

  // 15. Настройки
  parts.push('\n═══ НАСТРОЙКИ РАСЧЁТА ═══');
  parts.push(JSON.stringify(ctx.settings));

  return parts.join('\n');
}

module.exports = { getSystemPrompt, serializeContext };
