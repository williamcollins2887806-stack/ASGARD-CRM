'use strict';

/**
 * ASGARD CRM — Промпт для AI-генерации отчёта по звонкам
 * По паттерну call-analysis-prompt.js
 */

/**
 * @param {Object} reportData
 * @param {string} reportData.reportType   — daily | weekly | monthly
 * @param {string} reportData.periodFrom   — дата начала
 * @param {string} reportData.periodTo     — дата конца
 * @param {number} reportData.totalCalls   — общее кол-во звонков
 * @param {number} reportData.targetCalls  — целевые звонки
 * @param {number} reportData.missedCalls  — пропущенные
 * @param {number} reportData.avgDuration  — средняя длительность (сек)
 * @param {Array}  reportData.byManager    — [{name, total, target, missed, avg_duration}]
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
    missedCalls = 0,
    avgDuration = 0,
    byManager = [],
    byType = [],
    topClients = []
  } = reportData;

  const periodLabel = {
    daily: 'день',
    weekly: 'неделю',
    monthly: 'месяц'
  }[reportType] || 'период';

  return `Ты — бизнес-аналитик ООО «Асгард Сервис» (промышленный сервис: химическая очистка, гидроочистка, HVAC, промышленный ремонт).

Составь аналитический отчёт по телефонным звонкам за ${periodLabel} (${periodFrom} — ${periodTo}).

## Данные

Всего звонков: ${totalCalls}
Целевых (от клиентов): ${targetCalls}
Пропущенных: ${missedCalls}
Средняя длительность: ${Math.round(avgDuration)} сек

### По менеджерам:
${byManager.map(m => `- ${m.name}: всего ${m.total}, целевых ${m.target}, пропущено ${m.missed}, средн. ${Math.round(m.avg_duration || 0)} сек`).join('\n') || 'Нет данных'}

### По типам:
${byType.map(t => `- ${t.call_type}: ${t.count}`).join('\n') || 'Нет данных'}

### Топ клиентов:
${topClients.map(c => `- ${c.company}: ${c.calls} звонков`).join('\n') || 'Нет данных'}

## Задание

Ответь СТРОГО в формате JSON:
{
  "title": "Краткий заголовок отчёта (до 100 символов)",
  "summary": "Текстовый отчёт на 3-5 абзацев: итоги, тренды, проблемы",
  "recommendations": ["Рекомендация 1", "Рекомендация 2", "..."],
  "highlights": {
    "best_manager": "Имя лучшего менеджера по конверсии",
    "concern_areas": ["Проблемная зона 1", "..."],
    "conversion_rate": "XX%"
  }
}

Пиши по-русски, профессионально, кратко. Не выдумывай данных — анализируй только предоставленные.`;
}

module.exports = { getCallReportPrompt };
