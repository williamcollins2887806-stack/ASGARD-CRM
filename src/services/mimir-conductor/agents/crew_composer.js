/**
 * ASGARD CRM — Mimir Conductor: агент «Подбор бригады» (Сессия 4, Шаг 4.3)
 * ═══════════════════════════════════════════════════════════════════════════
 * Гибрид: SQL-фильтр свободных сотрудников + LLM-компоновка бригады.
 *
 * 1. Из tz_summary берём permits_required, timing, scope.method.
 * 2. SQL: список активных сотрудников, свободных на даты проекта, с допусками.
 * 3. Если нужных допусков не хватает → clarification(channel='PM', не блокир.).
 * 4. LLM (Sonnet 4.6) компонует бригаду: ИТР + мастер(а) + рабочие.
 *
 * Артефакт: crew_plan
 *   { summary, key_findings[], crew:[{employee_id,name,role,city,reason}],
 *     total_count, foremen, workers, helpers, shifts, clarifications[] }
 *
 * STUB-режим: LLM не возвращает JSON → собираем детерминированную бригаду из
 * реально найденных свободных сотрудников (или типовую, если БД пуста).
 *
 * Схема БД (реальные имена колонок!):
 *   employees(id, fio, full_name, city, position, role_tag, is_active, dismissal_date)
 *   employee_permits(employee_id, permit_type, expiry_date)
 *   employee_assignments(employee_id, work_id, date_from, date_to, is_active)
 *   works(id, start_plan, end_plan)
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const db = require('../../db');
const aiProvider = require('../../ai-provider');
const { parseStrictJson, thoughtSink } = require('./_util');

const CREW_SYSTEM_PROMPT = `Ты — бригадир-комплектовщик ООО «Асгард Сервис».
По сводке ТЗ и списку СВОБОДНЫХ сотрудников собери оптимальную бригаду.

Правила:
- Всегда 1 ИТР (руководитель проекта на объекте).
- 1 мастер на смену (2 мастера при двухсменке).
- Рабочих — по объёму и методу работ.
- Бери только из предложенного списка свободных. Если людей не хватает —
  отметь это в reasoning.

Между шагами выдавай "THOUGHT: <одно предложение на русском>".

Верни СТРОГО JSON:
{
  "total_count": 0,
  "foremen": 0,
  "workers": 0,
  "helpers": 0,
  "shifts": 1,
  "members": [ { "employee_id": 0, "name": "...", "role": "ИТР|Мастер|Рабочий|Наблюдающий", "city": "...", "reason": "..." } ],
  "reasoning": ["почему такой состав, 3-6 пунктов"]
}`;

/** Найти свободных сотрудников на окно дат проекта. */
async function findFreeWorkers(timing) {
  const start = timing && timing.start ? timing.start : null;
  const end = timing && timing.end ? timing.end : null;

  // Если дат нет — берём просто активных сотрудников (окно не ограничиваем).
  const sql = `
    SELECT e.id,
           COALESCE(e.full_name, e.fio) AS name,
           e.city, e.position, e.role_tag,
           COALESCE(
             ARRAY_AGG(DISTINCT ep.permit_type) FILTER (WHERE ep.permit_type IS NOT NULL),
             '{}'
           ) AS permits
      FROM employees e
      LEFT JOIN employee_permits ep
        ON ep.employee_id = e.id
       AND (ep.expiry_date IS NULL OR $2::date IS NULL OR ep.expiry_date >= $2::date)
     WHERE e.is_active = true
       AND e.dismissal_date IS NULL
       AND ($1::date IS NULL OR $2::date IS NULL OR NOT EXISTS (
             SELECT 1 FROM employee_assignments ea
              WHERE ea.employee_id = e.id
                AND ea.is_active = true
                AND ea.date_from <= $2::date
                AND ea.date_to   >= $1::date
           ))
     GROUP BY e.id
     ORDER BY e.id
     LIMIT 200`;

  const res = await db.query(sql, [start, end]);
  return res.rows;
}

/** Детерминированная бригада из найденных свободных (для stub-режима). */
function buildStubCrew(freeWorkers) {
  const pick = (pred) => freeWorkers.find(pred) || null;
  const itr = pick((w) => /итр|рук|инженер|прораб|мастер/i.test(w.position || w.role_tag || ''));
  const master = pick((w) => /мастер|бригадир/i.test(w.position || w.role_tag || '')) || itr;
  const workers = freeWorkers
    .filter((w) => w !== itr && w !== master)
    .slice(0, 4);

  const members = [];
  if (itr) members.push({ employee_id: itr.id, name: itr.name, role: 'ИТР', city: itr.city, reason: 'Руководитель работ на объекте' });
  if (master && master !== itr) members.push({ employee_id: master.id, name: master.name, role: 'Мастер', city: master.city, reason: 'Организация смены' });
  for (const w of workers) {
    members.push({ employee_id: w.id, name: w.name, role: 'Рабочий', city: w.city, reason: 'Исполнитель работ' });
  }

  // Если БД пуста — типовая бригада-заглушка (без employee_id).
  if (members.length === 0) {
    members.push(
      { employee_id: null, name: '[demo] ИТР', role: 'ИТР', city: null, reason: 'Типовая бригада (нет свободных в БД)' },
      { employee_id: null, name: '[demo] Мастер', role: 'Мастер', city: null, reason: 'Типовая бригада' },
      { employee_id: null, name: '[demo] Рабочий 1', role: 'Рабочий', city: null, reason: 'Типовая бригада' },
      { employee_id: null, name: '[demo] Рабочий 2', role: 'Рабочий', city: null, reason: 'Типовая бригада' }
    );
  }

  const workersCount = members.filter((m) => m.role === 'Рабочий').length;
  return {
    total_count: members.length,
    foremen: members.filter((m) => m.role === 'Мастер').length,
    workers: workersCount,
    helpers: members.filter((m) => m.role === 'Наблюдающий').length,
    shifts: 1,
    members,
    reasoning: [
      `Подобрано ${members.length} чел. из ${freeWorkers.length} свободных`,
      'stub-режим: состав детерминированный, LLM не вызывался'
    ]
  };
}

async function run({ requiredArtifacts, onThought }) {
  const tz = requiredArtifacts.tz_summary || {};
  const permitsRequired = Array.isArray(tz.permits_required) ? tz.permits_required : [];
  const timing = tz.timing || {};

  onThought('Запрашиваю свободных сотрудников на даты проекта…');
  let freeWorkers = [];
  try {
    freeWorkers = await findFreeWorkers(timing);
  } catch (e) {
    onThought(`⚠ не удалось получить список сотрудников: ${e.message}`);
  }
  onThought(`Найдено ${freeWorkers.length} свободных сотрудник(ов)`);

  // Проверка нехватки допусков (упрощённо: есть ли хоть один с нужным типом).
  const clarifications = [];
  const lacking = permitsRequired.filter((reqP) =>
    !freeWorkers.some((w) => (w.permits || []).some((p) => p && p.toLowerCase().includes(String(reqP).toLowerCase())))
  );
  if (lacking.length > 0) {
    clarifications.push({
      channel: 'PM',
      category: 'crew',
      question_ru: `Среди свободных нет допусков: ${lacking.join('; ')}. Варианты: 1) обучить наших, 2) привлечь сторонних (+30%), 3) сдвинуть сроки.`,
      options: [
        { key: 'A', label: 'Обучить наших' },
        { key: 'B', label: 'Привлечь сторонних (+30%)' },
        { key: 'C', label: 'Сдвинуть сроки' }
      ],
      blocking: false,
      default_assumption: { action: 'train_own' }
    });
  }

  // LLM-компоновка
  onThought('Sonnet 4.6 компонует оптимальную бригаду…');
  const userMessage =
    `Сводка ТЗ:\n${JSON.stringify({ scope: tz.scope, conditions: tz.conditions, permits_required: permitsRequired, timing }, null, 2)}\n\n` +
    `Свободные сотрудники (${freeWorkers.length}):\n${JSON.stringify(freeWorkers.slice(0, 60), null, 2)}`;

  const result = await aiProvider.completeWithStream({
    system: CREW_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
    model: 'sonnet-4-6',
    onThought: (t) => onThought(t),
    onText: thoughtSink((t) => onThought(t))
  });

  let crew;
  if (result._stub || aiProvider.isStubMode()) {
    onThought('stub-режим: собираю детерминированную бригаду из свободных');
    crew = buildStubCrew(freeWorkers);
  } else {
    crew = parseStrictJson(result.text);
  }

  const helpers = crew.helpers || 0;
  const helpersPart = helpers ? ` + ${helpers} наблюдающих` : '';
  return {
    summary: `Бригада ${crew.total_count} чел: ИТР + ${crew.foremen} мастер(ов) + ${crew.workers} рабочих${helpersPart}`,
    key_findings: crew.reasoning || [],
    crew: crew.members || [],
    total_count: crew.total_count || (crew.members ? crew.members.length : 0),
    foremen: crew.foremen || 0,
    workers: crew.workers || 0,
    helpers,
    shifts: crew.shifts || 1,
    clarifications
  };
}

module.exports = { run };
