'use strict';

/**
 * Unit-ish checks for huginn-ai-editor presets / system prompts (no live RouterAI).
 */

process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'unit-test-placeholder';

const assert = require('assert');
const editor = require('../../src/services/huginn-ai-editor');

assert.ok(Array.isArray(editor.PRESET_STYLES));
assert.ok(editor.PRESET_STYLES.length >= 7, 'presets >= 7');
const ids = new Set(editor.PRESET_STYLES.map((s) => s.id));
assert.ok(ids.has('formal') && ids.has('viking') && ids.has('friendly'));
for (const s of editor.PRESET_STYLES) {
  assert.ok(s.name && s.prompt && s.id, 'preset fields');
  assert.ok(!/premium/i.test(s.prompt), 'no premium in prompt');
}
assert.equal(typeof editor.rewrite, 'function');
assert.equal(typeof editor.listStyles, 'function');
assert.equal(typeof editor.createStyle, 'function');
assert.equal(editor.RATE_MAX, 30);
console.log('PASS huginn_ai_editor_unit presets=' + editor.PRESET_STYLES.length);
