'use strict';

/**
 * Регрессии 09.10.2026 (поздний вечер):
 *  1) «Нет анализа звонков» — записи PBX-звонков (из браузера) не запускали
 *     транскрипцию/AI: слушатель pbx_recording_ready только транслировал SSE,
 *     а пайплайн не вызывался. Все строки были transcript_status='none'.
 *  2) Колонка «Клиент/Номер» = «—»: номер не доходил в finalize (AMI-дублёр
 *     передавал только оператора, dialplan-вариант h может не сработать).
 *  3) Дубли строк: мой ретрай был заблокирован при пустом номере.
 *
 * Usage: node tests/pbx/pipeline-wiring.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
let passed = 0;
let failed = 0;
function test(id, name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${id} ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${id} ${name}: ${e.message}`); }
}
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

console.log('pipeline-wiring');

test('P1', 'pbx_recording_ready запускает пайплайн (транскрипция+анализ)', () => {
  const js = read('src/index.js');
  const i = js.indexOf("bridge.emitter.on('pbx_recording_ready'");
  assert.ok(i !== -1, 'нет слушателя pbx_recording_ready');
  const blk = js.slice(i, i + 1600);
  assert.ok(/processCall/.test(blk), 'пайплайн не вызывается — расшифровки не будет');
  assert.ok(/telephonyPipeline/.test(blk), 'нет доступа к пайплайну');
  assert.ok(/call:recording_ready/.test(blk), 'потеряна трансляция SSE');
});

test('P2', 'слушатель находит звонок по pbx_uid', () => {
  const js = read('src/index.js');
  const blk = js.slice(js.indexOf("bridge.emitter.on('pbx_recording_ready'"), js.indexOf("bridge.emitter.on('pbx_recording_ready'") + 1600);
  assert.ok(/payload\.pbx_uid/.test(blk), 'не берёт pbx_uid из payload');
  assert.ok(/FROM call_history WHERE pbx_uid/.test(blk), 'не ищет строку по pbx_uid');
});

test('P3', 'AMI-дублёр передаёт номер в finalize', () => {
  const js = read('src/pbx/index.js');
  const i = js.indexOf("ami.on('event', async (msg)");
  const blk = js.slice(i, i + 1800);
  assert.ok(/peerNumber/.test(blk), 'номер не определяется');
  assert.ok(/number: peerNumber/.test(blk), 'номер не передаётся в finalize');
  assert.ok(/mango-trunk/.test(blk), 'не разбирает канал на транк');
  assert.ok(/\basync \(msg\)/.test(blk), 'обработчик не async (await coreShowChannels)');
});

test('P4', 'ретрай дедупа работает и БЕЗ номера', () => {
  const js = read('src/pbx/recording.js');
  assert.ok(/номер может не прийти из dialplan/.test(js), 'нет пояснения');
  assert.ok(/const late = await client\.query\(\s*outNumber\s*\?/m.test(js),
    'ретрай всё ещё обёрнут в `outNumber ? … : {rowCount:0}` — дубль при пустом номере');
});

test('P5', 'пайплайн регистрируется в index.js', () => {
  const js = read('src/index.js');
  assert.ok(/pipeline\.registerHandlers\(jobQueue\)/.test(js), 'пайплайн не подключён к очереди');
  assert.ok(/telephony_jobs|jobQueue/.test(read('src/services/job-queue.js')), 'нет очереди заданий');
});

test('P6', 'analyze ставится после успешной транскрипции', () => {
  const js = read('src/services/call-pipeline.js');
  assert.ok(/enqueue\('transcribe'/.test(js), 'нет звена transcribe');
  assert.ok(/enqueue\('analyze'/.test(js), 'нет звена analyze');
  assert.ok(/transcript_status === 'done'/.test(js), 'analyze не привязан к готовой расшифровке');
});

test('P7', 'пустой WAV (data size = 0) не финализируется — уходит в retry', () => {
  const js = read('src/pbx/recording.js');
  assert.ok(/function isEmptyWav/.test(js), 'нет проверки пустого WAV');
  assert.ok(/size < 1000/.test(js), 'не отсекает 44-байтные «пустышки»');
  assert.ok(/recording source missing \(empty wav/i.test(js),
    'пустой WAV не помечается как pending — файл скопируется битым');
});

test('P8', 'источник записи берётся из спула Asterisk раньше копии', () => {
  const js = read('src/pbx/recording.js');
  const i = js.indexOf('const dirs = [');
  const blk = js.slice(i, i + 420);
  const spool = blk.indexOf('ASG_REC');
  const root = blk.indexOf('config.recordingsRoot');
  assert.ok(spool !== -1 && root !== -1, 'нет обоих каталогов');
  assert.ok(spool < root, 'копия проверяется раньше первоисточника — риск взять пустышку');
});

test('P9', 'есть инструмент починки уже испорченных записей', () => {
  const js = read('tools/repair_recordings.js');
  assert.ok(/isEmptyWav/.test(js), 'нет определения пустого WAV');
  assert.ok(/--dry-run/.test(js), 'нет безопасного режима');
  assert.ok(/findSpoolSource/.test(js), 'не ищет первоисточник в спуле');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
