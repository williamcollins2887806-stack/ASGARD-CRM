'use strict';
/**
 * АСГАРД CRM — Helper для иконок каталога (products + equipment).
 * Миграция V254 добавила колонку icon_slug в products/equipment + триггер
 * fn_auto_icon_slug, который сам подставляет slug по нормализованному имени.
 *
 * Этот helper:
 *   - превращает icon_slug → icon_path = '/v2/assets/icons/{slug}.svg'
 *   - НЕ убирает существующих полей, только ДОБАВЛЯЕТ icon_path.
 *
 * Файлы иконок физически лежат в public/icons/{slug}.svg
 * Реестр (хэши, размеры, generic-флаг) — в public/icons/manifest.json
 *
 * ВАЖНО: вне public/v2/, потому что Vite чистит outDir при каждом build.
 */

const ICON_BASE = '/icons/';

/** Безопасно: пустой slug → null. Без расширения → добавляет .svg. */
function iconPathOf(slug) {
  if (!slug || typeof slug !== 'string') return null;
  const s = slug.trim();
  if (!s) return null;
  return ICON_BASE + (s.endsWith('.svg') ? s : s + '.svg');
}

/** Возвращает row с добавленным icon_path (не мутирует исходник). */
function enrichIcon(row) {
  if (!row || typeof row !== 'object') return row;
  if (!('icon_slug' in row)) return row;
  return { ...row, icon_path: iconPathOf(row.icon_slug) };
}

/** Массовый вариант. Безопасно если rows=null/undefined/[]. */
function enrichIcons(rows) {
  if (!Array.isArray(rows)) return rows;
  return rows.map(enrichIcon);
}

module.exports = { iconPathOf, enrichIcon, enrichIcons, ICON_BASE };
