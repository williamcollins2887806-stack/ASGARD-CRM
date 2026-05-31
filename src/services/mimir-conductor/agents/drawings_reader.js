/**
 * ASGARD CRM — Mimir Conductor: агент «Чтение чертежей» (Сессия 6, Шаг 6.1)
 * ═══════════════════════════════════════════════════════════════════════════
 * Подключается ТОЛЬКО если в документах есть чертежи/сканы (флаг has_drawings).
 * Читает их через GPT-5 Vision (ai-provider): извлекает марки, ревизии, размеры,
 * спецификации, наличие штампа «В производство работ».
 *
 * Артефакт: drawings_summary
 *   { summary, key_findings[], drawings:[{name,marks[],revision,in_production_stamp,specs[]}],
 *     count }
 *
 * STUB-режим: vision не вызывается (баланс/изображения) → возвращаем список
 * найденных чертежей по метаданным с пометкой, что распознавание не выполнялось.
 *
 * Источник списка документов — tz_summary не содержит файлов; берём метаданные
 * из mimir_artifacts(parsed_documents), который уже распарсен document_parser.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const aiProvider = require('../../ai-provider');
const cr = require('../conductor-run');
const { parseStrictJson, thoughtSink } = require('./_util');

const SYSTEM_PROMPT = `Ты — инженер-проектировщик. Анализируешь чертежи и схемы.
Извлекай: марки, ревизии, размеры, спецификации позиций.
Если есть штамп «В производство работ» — отметь in_production_stamp=true.

Верни СТРОГО JSON:
{ "drawings": [ {"name":"...","marks":["..."],"revision":"...","in_production_stamp":true|false,"specs":["..."]} ],
  "key_findings": ["..."] }`;

const DRAWING_RE = /чертеж|чертёж|схема|drawing|\.dwg|АР-|АС-|МО-|КМ-|КЖ-|план\s/i;

/** Найти чертежи среди распарсенных документов. */
function pickDrawings(parsedDocs) {
  return (parsedDocs || []).filter((d) => {
    const mime = d.mime_type || d.file_type || '';
    const name = d.name || d.file_name || '';
    return /^image\//i.test(mime) || DRAWING_RE.test(name);
  });
}

async function run({ runId, onThought }) {
  // parsed_documents лежит как отдельный артефакт; tz_summary в requires —
  // подгрузим parsed_documents напрямую (он точно есть после прелюдии).
  let parsedDocs = [];
  try {
    const parsedArt = await cr.getArtifact(runId, 'parsed_documents');
    const content = parsedArt && parsedArt.content ? parsedArt.content : {};
    parsedDocs = Array.isArray(content.documents) ? content.documents : [];
  } catch (_) { parsedDocs = []; }

  const drawings = pickDrawings(parsedDocs);

  if (!drawings.length) {
    onThought('Чертежей в документах не обнаружено');
    return { summary: 'Чертежей не обнаружено', key_findings: ['В приложенных документах нет файлов-чертежей'], drawings: [], count: 0, clarifications: [] };
  }

  onThought(`Найдено ${drawings.length} чертеж(ей)`);

  if (aiProvider.isStubMode()) {
    onThought('stub-режим: vision не вызывается — возвращаю список по метаданным');
    return {
      summary: `Найдено ${drawings.length} чертеж(ей) (stub: распознавание не выполнялось)`,
      key_findings: drawings.slice(0, 8).map((d) => `Чертёж: ${d.name || d.file_name}`),
      drawings: drawings.map((d) => ({ name: d.name || d.file_name, marks: [], revision: null, in_production_stamp: null, specs: [] })),
      count: drawings.length,
      clarifications: []
    };
  }

  // LIVE: GPT-5 Vision. Изображения подаём как ссылки/документы по id.
  try {
    onThought('GPT-5 Vision читает чертежи…');
    const content = [
      { type: 'text', text: 'Проанализируй эти чертежи и выдай структурированный JSON по схеме.' },
      ...drawings
        .filter((d) => d.url || d.public_url)
        .map((d) => ({ type: 'image', source: { type: 'url', url: d.url || d.public_url } }))
    ];
    const result = await aiProvider.completeWithStream({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
      model: 'gpt-5',
      onThought: (t) => onThought(t),
      onText: thoughtSink((t) => onThought(t))
    });
    const parsed = result._stub ? null : parseStrictJson(result.text);
    if (parsed) {
      return {
        summary: `Распознано ${(parsed.drawings || []).length} чертеж(ей)`,
        key_findings: parsed.key_findings || [],
        drawings: parsed.drawings || [],
        count: (parsed.drawings || []).length,
        clarifications: []
      };
    }
  } catch (e) {
    onThought(`⚠ Vision недоступен (${e.message}) — возвращаю список по метаданным`);
  }

  // Фолбэк, если vision не сработал.
  return {
    summary: `Найдено ${drawings.length} чертеж(ей) (распознавание не выполнено)`,
    key_findings: drawings.slice(0, 8).map((d) => `Чертёж: ${d.name || d.file_name}`),
    drawings: drawings.map((d) => ({ name: d.name || d.file_name, marks: [], revision: null, in_production_stamp: null, specs: [] })),
    count: drawings.length,
    clarifications: []
  };
}

module.exports = { run, pickDrawings };
