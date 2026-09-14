'use strict';

/**
 * Shared helpers for ND form blocks / sections_json.
 */

function defaultEnabledBlocks(schema) {
  const blocks = (schema && schema.blocks) || [];
  return blocks.filter((b) => b.default_on !== false).map((b) => b.id);
}

function normalizeSectionsJson(raw, schema) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const enabled =
    Array.isArray(src.enabled_blocks) && src.enabled_blocks.length
      ? src.enabled_blocks.map(String)
      : defaultEnabledBlocks(schema);
  return {
    enabled_blocks: enabled,
    persons: Array.isArray(src.persons) ? src.persons : [],
    prep: Array.isArray(src.prep) ? src.prep : [],
    gas_analysis: Array.isArray(src.gas_analysis) ? src.gas_analysis : [],
    fire_watch: src.fire_watch && typeof src.fire_watch === 'object' ? src.fire_watch : {},
    atmosphere: Array.isArray(src.atmosphere) ? src.atmosphere : [],
    loto: Array.isArray(src.loto) ? src.loto : [],
    height_gear: Array.isArray(src.height_gear) ? src.height_gear : [],
    daily_rows: Array.isArray(src.daily_rows) ? src.daily_rows : [],
    extension_rows: Array.isArray(src.extension_rows) ? src.extension_rows : [],
    acks_rows: Array.isArray(src.acks_rows) ? src.acks_rows : [],
    closing: src.closing && typeof src.closing === 'object' ? src.closing : {},
  };
}

function isBlockEnabled(sections, blockId) {
  const list = (sections && sections.enabled_blocks) || [];
  return list.includes(blockId);
}

module.exports = {
  defaultEnabledBlocks,
  normalizeSectionsJson,
  isBlockEnabled,
};
