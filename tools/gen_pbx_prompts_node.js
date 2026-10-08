'use strict';

/**
 * Сгенерировать звуковые подсказки PBX из настроек (pbx_config) локальным Silero.
 * Запуск на проде:  node tools/gen_pbx_prompts_node.js
 *
 * Читает тексты из БД (корректный UTF-8, без проблем shell-кодировки) и кладёт
 * 8 kHz mono WAV в /var/lib/asterisk/sounds/custom.
 */

const path = require('path');

const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);

const { getPool } = require(path.join(ROOT, 'src/pbx'));
const { normalizePbxConfig } = require(path.join(ROOT, 'src/pbx/call-lifecycle'));
const { generatePrompt, ensurePrompt } = require(path.join(ROOT, 'src/pbx/prompts'));

async function main() {
  const pool = getPool();
  if (!pool) throw new Error('no DB pool (DATABASE_URL)');
  const { rows } = await pool.query(
    `SELECT value_json FROM settings WHERE key = 'pbx_config' LIMIT 1`
  );
  let raw = rows[0]?.value_json || {};
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (_) { raw = {}; } }
  const cfg = normalizePbxConfig(raw);

  const defs = [];
  if (cfg.greeting_text) defs.push({ name: 'all-busy', text: cfg.greeting_text });
  if (cfg.after_hours_text) defs.push({ name: 'after-hours', text: cfg.after_hours_text });
  defs.push({ name: 'confirm-press-1', text: 'Нажмите один, чтобы принять звонок.' });
  defs.push({ name: 'voicemail-prompt', text: 'Оставьте сообщение после сигнала. Завершите запись клавишей решётка.' });
  defs.push({ name: 'voicemail-thanks', text: 'Спасибо! Мы перезвоним вам.' });

  const out = await generatePrompt(defs);
  for (const o of out) console.log('OK', o.name, '->', o.path);

  // Прогреть хэш-файлы, которые реально запрашивает AGI (ensurePrompt).
  for (const [label, text] of [
    ['greeting', cfg.greeting_text],
    ['after_hours', cfg.after_hours_text],
  ]) {
    if (!text) continue;
    try {
      const p = await ensurePrompt(text);
      console.log('warm', label, '->', p);
    } catch (e) {
      console.log('warm FAIL', label, e.message);
    }
  }

  console.log('generated', out.length, 'of', defs.length);
  await pool.end();
  return out.length === defs.length ? 0 : 1;
}

main().then((c) => process.exit(c)).catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
