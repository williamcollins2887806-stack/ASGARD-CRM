/**
 * ASGARD CRM — Mimir Conductor: агент «Парсер документов» (Сессия 4, Шаг 4.1)
 * ═══════════════════════════════════════════════════════════════════════════
 * БЕЗ LLM. Берёт document_ids → парсит каждый через parseDocumentContent
 * (PDF/DOCX/XLSX/TXT/CSV/RTF), возвращает массив распарсенных документов.
 *
 * Артефакт: parsed_documents
 *   { summary, key_findings[], documents:[{ id, name, mime_type, size_kb,
 *     content, content_chars, content_hash }] }
 *
 * Устойчивость: если документов нет (например, прогон по contract_value без
 * привязанной работы) — возвращает пустой, но валидный артефакт. Реальный
 * просчёт без документов всё равно пройдёт по стартовому контексту.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const db = require('../../db');
const { parseDocumentContent } = require('../../estimateChat');
const { sha256 } = require('./_util');

async function run({ input, onThought }) {
  const docIds = Array.isArray(input.documents) ? input.documents.filter((x) => Number.isInteger(Number(x))) : [];

  if (docIds.length === 0) {
    onThought('Документов к работе не привязано — парсить нечего.');
    return {
      summary: 'Документы не приложены — анализ по стартовому контексту работы.',
      key_findings: ['Нет документов для парсинга'],
      documents: []
    };
  }

  onThought(`Получил ${docIds.length} документ(ов) на парсинг`);

  const docsRes = await db.query(
    `SELECT id, original_name, filename, mime_type, size
       FROM documents
      WHERE id = ANY($1) AND deleted_at IS NULL`,
    [docIds]
  ).catch(async () => {
    // На случай отсутствия колонки deleted_at в каких-то окружениях
    return db.query(
      'SELECT id, original_name, filename, mime_type, size FROM documents WHERE id = ANY($1)',
      [docIds]
    );
  });

  const parsed = [];
  for (const doc of docsRes.rows) {
    onThought(`Парсю ${doc.original_name || doc.filename}…`);
    let content = null;
    try {
      content = await parseDocumentContent(doc);
    } catch (e) {
      onThought(`  ⚠ не удалось распарсить ${doc.original_name}: ${e.message}`);
    }
    parsed.push({
      id: doc.id,
      name: doc.original_name || doc.filename,
      mime_type: doc.mime_type || null,
      size_kb: doc.size ? Math.round(Number(doc.size) / 1024) : null,
      content: content || null,
      content_chars: content ? content.length : 0,
      content_hash: content ? sha256(content) : null
    });
    onThought(`  → распарсено ${content ? content.length : 0} символов`);
  }

  const totalChars = parsed.reduce((s, d) => s + d.content_chars, 0);
  return {
    summary: `Распарсено ${parsed.length} документ(ов), всего ${totalChars} символов`,
    key_findings: parsed.map((p) => `${p.name}: ${p.content_chars} симв`),
    documents: parsed
  };
}

module.exports = { run };
