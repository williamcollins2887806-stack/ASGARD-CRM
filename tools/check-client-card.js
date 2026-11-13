'use strict';
/**
 * Проверка: реально ли ИИ заполняет client_card после обновления промпта.
 * Берёт ОДИН звонок с транскриптом, прогоняет analyze() и печатает результат.
 * В БД не пишет.
 */
const db = require('./../src/services/db');
const CallAnalyzer = require('./../src/services/call-analyzer');
const ai = require('./../src/services/ai-provider');

async function main() {
  const id = parseInt(process.argv[2] || '0', 10);
  const q = id
    ? await db.query('SELECT * FROM call_history WHERE id = $1', [id])
    : await db.query(
      `SELECT * FROM call_history
        WHERE transcript_status='done' AND transcript IS NOT NULL AND length(transcript) > 600
        ORDER BY id DESC LIMIT 1`);
  const call = q.rows[0];
  if (!call) { console.log('нет звонка'); return; }

  console.log(`Звонок #${call.id}, транскрипт ${String(call.transcript || '').length} символов`);

  const analyzer = new CallAnalyzer(ai, db);
  const t0 = Date.now();
  let result;
  try {
    result = await analyzer.analyze(call.transcript, {
      from_number: call.from_number,
      to_number: call.to_number,
      duration_seconds: call.duration_seconds,
      direction: call.call_type,
    });
  } catch (e) {
    console.log('ОШИБКА analyze: ' + e.message + ' (code=' + e.code + ')');
    await db.pool.end();
    return;
  }
  console.log(`\nза ${Date.now() - t0} мс`);

  console.log('\n=== client_card ===');
  console.log(JSON.stringify(result.client_card, null, 2));

  console.log('\n=== прочее ===');
  console.log('is_target:', result.is_target, '| outcome_kind:', result.outcome_kind);
  console.log('company_name:', result.company_name);
  console.log('contact_person:', result.contact_person);
  console.log('location:', result.location);
  console.log('\nsummary:', String(result.summary || '').slice(0, 300));

  await db.pool.end();
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
