'use strict';

/**
 * Служебные типы documents, созданные фоновым OCR (не показывать в UI).
 * Пользовательские archive-extracted (confirm распаковки в карточке тендера) — видимы.
 */
const HIDDEN_DOC_TYPES = Object.freeze(['ocr-extract']);

function isHiddenDocType(type) {
  return HIDDEN_DOC_TYPES.includes(String(type || ''));
}

/** SQL-фрагмент: AND … (для подстановки в WHERE). */
function sqlExcludeHiddenDocs(alias = '') {
  const col = alias ? `${alias}.type` : 'type';
  return `COALESCE(${col},'') NOT IN ('ocr-extract')`;
}

module.exports = {
  HIDDEN_DOC_TYPES,
  isHiddenDocType,
  sqlExcludeHiddenDocs
};
