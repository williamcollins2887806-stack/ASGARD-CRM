'use strict';

/**
 * ASGARD CRM — Промпт для AI-генерации отчёта по звонкам
 * Терминология: сотрудник (НЕ менеджер), % целевых (НЕ конверсия)
 */

/**
 * @param {Object} reportData
 * @param {string} reportData.reportType   — daily | weekly | monthly
 * @param {string} reportData.periodFrom   — дата начала
 * @param {string} reportData.periodTo     — дата конца
 * @param {number} reportData.totalCalls   — общее кол-во звонков
 * @param {number} reportData.targetCalls  — целевые звонки
 * @param {number} reportData.lostCalls    — потерянные без ответа
 * @param {number} reportData.avgQuality   — средняя оценка качества AI
 * @param {number} reportData.leadsCreated — заявки из звонков
 * @param {Array}  reportData.byEmployee   — [{name, total, target, missed, avg_duration}]
 * @param {Array}  reportData.byType       — [{call_type, count}]
 * @param {Array}  reportData.topClients   — [{company, calls}]
 * @returns {string}
 */
function getCallReportPrompt(reportData) {
  const {
    reportType = 'daily',
    periodFrom = '',
    periodTo = '',
    totalCalls = 0,
    targetCalls = 0,
    lostCalls = 0,
    avgQuality = 0,
    leadsCreated = 0,
    byEmployee = [],
    byType = [],
    topClients = []
  } = reportData;

  const targetPct = totalCalls ? Math.round(targetCalls / totalCalls * 100) : 0;

  const periodLabel = {
    daily: 'день',
    weekly: 'неделю',
    monthly: 'месяц'
  }[reportType] || 'период';

  return `Ты — аналитик телефонных звонков компании «Асгард Сервис» (промышленный сервис: химическая очистка, ГДО, ОВКВ для нефтегазового сектора).

Проанализируй данные звонков и создай отчёт для генерального директора.

ТЕРМИНЫ:
- Говори "сотрудник", НЕ "менеджер" — в компании нет роли "менеджер"
- НЕ используй слово "конверсия" — это не e-commerce
- Вместо конверсии: "% целевых от общего", "доля целевых звонков"
- "Потерянные клиенты" = пропущенные звонки БЕЗ перезвона

## Данные за ${periodLabel} (${periodFrom} — ${periodTo})

Всего звонков: ${totalCalls}
% целевых от общего: ${targetPct}% (${targetCalls} из ${totalCalls})
Потеряно без ответа: ${lostCalls}
Средняя оценка качества (AI): ${avgQuality || '—'}
Заявки из звонков: ${leadsCreated}

### По сотрудникам:
${byEmployee.map(m => `- ${m.name}: всего ${m.total}, целевых ${m.target}, пропущено ${m.missed}, средн. ${Math.round(m.avg_duration || 0)} сек`).join('\n') || 'Нет данных'}

### По типам:
${byType.map(t => `- ${t.call_type}: ${t.count}`).join('\n') || 'Нет данных'}

### Топ клиентов:
${topClients.map(c => `- ${c.company}: ${c.calls} звонков`).join('\n') || 'Нет данных'}

## Задание

Ответь СТРОГО в формате JSON:
{
  "title": "Краткий заголовок отчёта (до 100 символов)",
  "summary": "Резюме для директора (2-5 предложений, БЕЗ слова конверсия)",
  "recommendations": ["Конкретное действие 1", "Конкретное действие 2"],
  "highlights": {
    "best_employee": "Имя лучшего сотрудника по доле целевых",
    "concern_areas": ["Проблемная зона 1", "..."],
    "target_rate": "${targetPct}%"
  },
  "insights": [
    {"priority": "critical|high|medium", "title": "Заголовок", "description": "Детали", "recommendation": "Что делать"}
  ],
  "attention_items": [
    {"priority": "critical|high|medium", "category": "lost_calls|quality|client|employee", "text": "На что обратить внимание"}
  ],
  "employee_highlights": [
    {"name": "ФИО", "highlight": "Что выделяется", "score": "1-10"}
  ]
}

ВАЖНО для директора промышленной компании:
- Фокус на ЦЕЛЕВЫЕ звонки (потенциальные заказы на очистку, ОВКВ, ГДО)
- Выделяй крупных клиентов (Газпромнефть, ЛУКОЙЛ, НОВАТЭК, Роснефть)
- Оценивай качество работы СОТРУДНИКОВ (не менеджеров!)
- ПОТЕРЯННЫЕ КЛИЕНТЫ = пропущенные без перезвона (это критично!)
- Заявки из звонков = прямой показатель эффективности
- Подсказки для развития бизнеса

Пиши по-русски, профессионально, кратко. Не выдумывай данных — анализируй только предоставленные.`;
}

module.exports = { getCallReportPrompt };
