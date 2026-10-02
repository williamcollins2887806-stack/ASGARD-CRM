'use strict';

/**
 * Промпт AI-протокола Тинга (P4).
 * Не импортировать call-analyzer.
 */

function buildThingProtocolPrompt({ title, startedAt, endedAt, segments, participants }) {
  const speakerLines = (segments || [])
    .map((s) => `[${s.start || '?'}–${s.end || '?'}] ${s.speaker || 'SPEAKER'}: ${s.text || ''}`)
    .join('\n');

  const people = (participants || [])
    .map((p) => `- ${p.display_name || p.name} (${p.role || 'member'})`)
    .join('\n');

  return {
    system: [
      'Ты секретарь совещания компании Асгард.',
      'По транскрипту с диаризацией собери ПРОТОКОЛ на русском.',
      'Структура строго:',
      '1) Шапка: название, дата, участники',
      '2) Краткое резюме (3–6 предложений)',
      '3) Решения (нумерованный список)',
      '4) Поручения: формулировка, ответственный (если ясен), срок (если назван)',
      'Не выдумывай факты, которых нет в транскрипте.',
      'Если ответственный неясен — укажи «уточнить».',
      'Ответ — JSON: { summary, decisions: string[], assignments: [{ text, responsible, deadline }] }'
    ].join('\n'),
    user: [
      `Название: ${title || 'Тинг'}`,
      `Начало: ${startedAt || '—'}`,
      `Конец: ${endedAt || '—'}`,
      'Участники:',
      people || '—',
      '',
      'Транскрипт:',
      speakerLines || '(пусто)'
    ].join('\n')
  };
}

module.exports = { buildThingProtocolPrompt };
