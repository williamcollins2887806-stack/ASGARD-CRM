/**
 * ASGARD CRM — Сессия 5: async-флоу писем заказчику (stub, баланс НЕ тратится).
 * ═══════════════════════════════════════════════════════════════════════════
 * Прогоняет полный цикл уточнений/письма/ответа БЕЗ HTTP-сервера (напрямую через
 * сервисы — обходим локальный gap @fastify/websocket):
 *
 *   создаём run + блокирующее CUSTOMER-уточнение
 *     → generateClarificationLetter (DOCX + PDF на диск, запись DRAFTED)
 *     → mark SENT
 *     → parseReplyAndMap (текстовый ответ, stub-маппинг)
 *     → applyAnswers (вопрос → ANSWERED) + resumeConductorIfBlocked
 *     → ждём READY_FOR_REVIEW, проверяем дифф-каркас
 *
 * Проверки:
 *  • isStubMode() === true (предохранитель)
 *  • письмо создано (DRAFTED), DOCX и PDF реально на диске и непустые
 *  • letter_number формата АС-ГГГГ-ММ/QNNN
 *  • mark-sent → SENT
 *  • парсер вернул matches по числу вопросов
 *  • applyAnswers перевёл вопрос в ANSWERED
 *  • resume вернул run в RUNNING → дошёл до READY_FOR_REVIEW
 *  • final_estimate_data.diff присутствует (каркас «было/стало»)
 *
 * Чистит за собой (DELETE run + файлы писем).
 * Запуск: node tests/integration/mimir-conductor-letters.test.js
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

require('dotenv').config();

const fs = require('fs');
const db = require('../../src/services/db');
const aiProvider = require('../../src/services/ai-provider');
const cr = require('../../src/services/mimir-conductor/conductor-run');
const lg = require('../../src/services/mimir-conductor/letter-generator');
const rp = require('../../src/services/mimir-conductor/reply-parser');
const aa = require('../../src/services/mimir-conductor/apply-answers');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function pickTenderId() {
  const r = await db.query('SELECT id FROM tenders ORDER BY id DESC LIMIT 1');
  return r.rows[0] ? r.rows[0].id : null;
}

async function pickPmId() {
  const r = await db.query("SELECT id FROM users WHERE role = 'PM' AND COALESCE(is_active,true) = true ORDER BY id LIMIT 1");
  return r.rows[0] ? r.rows[0].id : 1;
}

async function waitStatus(runId, target, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await cr.getRun(runId);
    if (run && run.status === target) return run;
    if (run && run.status === 'ERROR') return run;
    await sleep(150);
  }
  return await cr.getRun(runId);
}

async function runScenario() {
  const results = [];
  const ok = (name, cond) => { results.push({ name, ok: !!cond }); };

  // Предохранитель — только stub.
  await aiProvider.completeWithStream({ system: '', messages: [{ role: 'user', content: 'x' }], model: 'sonnet-4-6', onThought: () => {}, onText: () => {} });
  ok('isStubMode() === true (баланс не тратим)', aiProvider.isStubMode() === true);
  if (!aiProvider.isStubMode()) throw new Error('НЕ stub-режим: тест остановлен');

  const tenderId = await pickTenderId();
  const pmId = await pickPmId();
  ok('найден тендер в dev-БД', tenderId != null);

  const run = await cr.createRun({ tenderId, initiatedBy: pmId, profile: 'STANDARD', contractValue: 8000000 });
  const runId = run.runId;

  const createdFiles = [];
  try {
    // 1. Блокирующее уточнение к заказчику + статус BLOCKED_BY_CUSTOMER.
    const agentRunId = await cr.startAgentRun(runId, { agentName: 'tz_analyst', model: 'sonnet-4-6', promptHash: '' });
    const clarRes = await db.query(
      `INSERT INTO mimir_clarifications
         (conductor_run_id, raised_by_agent_run_id, channel, category, question_ru, blocking, status, created_at)
       VALUES ($1,$2,'CUSTOMER','scope','Просим уточнить объём демонтажных работ (м2) по корпусу №3.', true, 'OPEN', NOW())
       RETURNING id`,
      [runId, agentRunId]
    );
    const clarId = Number(clarRes.rows[0].id);
    await cr.updateRunStatus(runId, 'BLOCKED_BY_CUSTOMER', { blockedReason: 'тест: ожидание заказчика' });

    // 2. Генерация письма.
    const letter = await lg.generateClarificationLetter({ runId, clarificationIds: [clarId], pmUserId: pmId });
    createdFiles.push(letter.docxPath, letter.pdfPath);
    ok('письмо создано, есть letterId/Number', letter.letterId && letter.letterNumber);
    ok('letter_number формата АС-ГГГГ-ММ/QNNN', /^АС-\d{4}-\d{2}\/Q\d{3}$/.test(letter.letterNumber));
    ok('DOCX на диске и непустой', fs.existsSync(letter.docxPath) && fs.statSync(letter.docxPath).size > 200);
    ok('PDF на диске и непустой', fs.existsSync(letter.pdfPath) && fs.statSync(letter.pdfPath).size > 200);

    const lrow = await db.query('SELECT * FROM mimir_customer_letters WHERE id = $1', [letter.letterId]);
    ok('письмо в БД со статусом DRAFTED', lrow.rows[0] && lrow.rows[0].status === 'DRAFTED');
    ok('questions_ids содержит наш вопрос', (lrow.rows[0].questions_ids || []).map(Number).includes(clarId));

    // 3. Отметить отправленным.
    await db.query("UPDATE mimir_customer_letters SET status='SENT', sent_at=NOW(), sent_by=$2 WHERE id=$1", [letter.letterId, pmId]);
    const sentRow = await db.query('SELECT status FROM mimir_customer_letters WHERE id=$1', [letter.letterId]);
    ok('mark-sent → SENT', sentRow.rows[0].status === 'SENT');

    // 4. Парсинг текстового ответа заказчика.
    const replyText = 'По корпусу №3 объём демонтажа составляет 1250 м2. Доступ круглосуточный.';
    const mapping = await rp.parseReplyAndMap(letter.letterId, null, replyText);
    ok('парсер вернул matches по числу вопросов', mapping && Array.isArray(mapping.matches) && mapping.matches.length === 1);
    const parsedRow = await db.query('SELECT status, reply_parsed_mapping FROM mimir_customer_letters WHERE id=$1', [letter.letterId]);
    ok('письмо → PARSED', parsedRow.rows[0].status === 'PARSED');

    // 5. РП подтверждает ответ (в stub answer_text=null → проставляем вручную).
    const confirmed = [{ question_id: clarId, answer_text: '1250 м2, доступ круглосуточный' }];
    const applied = await aa.applyAnswers(letter.letterId, confirmed, pmId);
    ok('applyAnswers зачёл 1 ответ', applied.answered === 1);
    const clarAfter = await db.query('SELECT status, answer_text FROM mimir_clarifications WHERE id=$1', [clarId]);
    ok('вопрос → ANSWERED', clarAfter.rows[0].status === 'ANSWERED' && !!clarAfter.rows[0].answer_text);
    const appliedRow = await db.query('SELECT status FROM mimir_customer_letters WHERE id=$1', [letter.letterId]);
    ok('письмо → APPLIED', appliedRow.rows[0].status === 'APPLIED');

    // 6. Возобновление Conductor.
    const resume = await aa.resumeConductorIfBlocked(letter.letterId);
    ok('resume стартовал (resumed=true)', resume.resumed === true);

    const finalRun = await waitStatus(runId, 'READY_FOR_REVIEW', 15000);
    ok('просчёт дошёл до READY_FOR_REVIEW', finalRun && finalRun.status === 'READY_FOR_REVIEW');

    // 7. Дифф-каркас.
    const fed = finalRun && finalRun.final_estimate_data ? finalRun.final_estimate_data : {};
    ok('final_estimate_data.diff присутствует', fed && fed.diff && typeof fed.diff === 'object');
    ok('диф содержит ключ total_with_vat', fed.diff && Object.prototype.hasOwnProperty.call(fed.diff, 'total_with_vat'));
  } finally {
    await db.query('DELETE FROM mimir_conductor_runs WHERE id = $1', [runId]);
    for (const f of createdFiles) { try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch (_) { /* noop */ } }
  }

  return results;
}

async function main() {
  let results;
  try {
    results = await runScenario();
  } catch (e) {
    console.error('❌ Тест упал:', e.message);
    try { await db.end(); } catch (_) { /* noop */ }
    process.exit(1);
  }
  results.forEach((r) => console.log(`${r.ok ? '✅' : '❌'} ${r.name}`));
  const failed = results.filter((r) => !r.ok);
  console.log(failed.length ? `\n❌ ${failed.length} провалено` : `\n✅ Все ${results.length} проверок прошли`);
  try { await db.end(); } catch (_) { /* noop */ }
  process.exit(failed.length ? 1 : 0);
}

if (typeof describe === 'function') {
  describe('Mimir Conductor — письма заказчику (stub)', () => {
    let results;
    beforeAll(async () => { results = await runScenario(); });
    afterAll(async () => { try { await db.end(); } catch (_) { /* noop */ } });
    test('все проверки прошли', () => {
      const failed = results.filter((r) => !r.ok).map((r) => r.name);
      expect(failed).toEqual([]);
    });
  });
} else {
  main();
}
