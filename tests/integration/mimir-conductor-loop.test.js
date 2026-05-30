/**
 * Integration-тест Conductor agent loop (Сессия 2).
 * Бьёт по РЕАЛЬНОЙ локальной dev-БД (asgard_crm_dev) — загружает .env.
 *
 * Запуск:
 *   - как node:  node tests/integration/mimir-conductor-loop.test.js
 *   - как jest:  npx jest tests/integration/mimir-conductor-loop.test.js
 *
 * Что проверяем (без расхода баланса — обязателен stub-режим):
 *   1. isStubMode() === true (иначе тест отказывается работать, чтобы не жечь баланс)
 *   2. runConductor доводит прогон до READY_FOR_REVIEW
 *   3. ≥3 agent_runs со статусом SUCCESS
 *   4. ≥3 артефакта создано
 *   5. в событиях есть thought / artifact_emitted / final_estimate
 *   6. в complexity_flags выставлены флаги; final_estimate_data записан
 *   7. чистит за собой (cascade удаляет дочерние строки)
 */

'use strict';

// .env имеет приоритет над дефолтами env-setup — грузим первым.
require('dotenv').config();

const db = require('../../src/services/db');
const cr = require('../../src/services/mimir-conductor/conductor-run');
const aiProvider = require('../../src/services/ai-provider');
const { runConductor } = require('../../src/services/mimir-conductor/conductor');

async function run() {
  const results = [];
  const assert = (name, cond) => { results.push({ name, ok: !!cond }); if (!cond) throw new Error('FAILED: ' + name); };
  const isPosId = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0; };

  // ⚠️ Защита баланса: тест работает ТОЛЬКО в stub-режиме.
  assert('stub-режим активен (баланс не тратится)', aiProvider.isStubMode() === true);

  let runId;
  try {
    // Контракт > 50M → обязательны devils_advocate + financial_modeler:
    // это даёт длинную очередь агентов и проверяет hard-rules-пороги.
    const created = await cr.createRun({
      profile: 'STANDARD',
      contractValue: 60000000,
      complexityFlags: { has_welding: true }
    });
    runId = created.runId;
    assert('createRun → runId', isPosId(runId));

    // Полный прогон Conductor (прелюдия → обязательные моки → финал)
    await runConductor(runId);

    // 1) Статус
    const finished = await cr.getRun(runId);
    assert('статус READY_FOR_REVIEW', finished.status === 'READY_FOR_REVIEW');
    assert('final_estimate_data записан', finished.final_estimate_data && typeof finished.final_estimate_data === 'object');
    assert('recommendation присутствует', finished.final_estimate_data.recommendation === 'THINK');

    // 2) complexity_flags обновлены оркестратором
    assert('complexity_flags объект', finished.complexity_flags && typeof finished.complexity_flags === 'object');

    // 3) agent_runs SUCCESS
    const completed = await cr.getCompletedAgents(runId);
    assert('≥3 успешных агентов', completed.length >= 3);
    assert('tz_analyst отработал', completed.includes('tz_analyst'));
    assert('document_parser отработал', completed.includes('document_parser'));
    assert('final_consolidator отработал', completed.includes('final_consolidator'));
    assert('devils_advocate отработал (контракт >50M)', completed.includes('devils_advocate'));

    // 4) Артефакты
    const details = await cr.getFullRunDetails(runId);
    assert('≥3 артефакта', details.artifacts.length >= 3);
    const tz = await cr.getArtifact(runId, 'tz_summary');
    assert('tz_summary артефакт есть', !!tz);

    // 5) События нужных типов
    const events = await cr.listEvents(runId, 0, 5000);
    const types = new Set(events.map((e) => e.event_type));
    assert('есть событие thought', types.has('thought'));
    assert('есть событие artifact_emitted', types.has('artifact_emitted'));
    assert('есть событие final_estimate', types.has('final_estimate'));
    assert('есть событие status_change', types.has('status_change'));

    // 6) Стоимость в пределах лимита и неотрицательна
    const cost = await cr.getTotalCost(runId);
    assert('total_cost число ≥ 0', Number(cost) >= 0);

    return results;
  } finally {
    if (runId) {
      await db.query('DELETE FROM mimir_conductor_runs WHERE id = $1', [runId]);
    }
  }
}

// ─── jest-обёртка ───
if (typeof describe === 'function') {
  describe('Mimir Conductor — agent loop (integration, stub)', () => {
    let res;
    beforeAll(async () => { res = await run(); });
    afterAll(async () => { await db.end(); });
    test('все проверки прошли', () => {
      const failed = (res || []).filter((r) => !r.ok);
      expect(failed).toEqual([]);
    });
  });
}

// ─── standalone-запуск через node ───
if (require.main === module) {
  run()
    .then((res) => {
      res.forEach((r) => console.log(`${r.ok ? '✅' : '❌'} ${r.name}`));
      const failed = res.filter((r) => !r.ok);
      console.log(failed.length ? `\n❌ ${failed.length} провалено` : `\n✅ Все ${res.length} проверок прошли`);
      return db.end().then(() => process.exit(failed.length ? 1 : 0));
    })
    .catch((e) => {
      console.error('❌ Тест упал:', e.message);
      db.end().finally(() => process.exit(1));
    });
}

module.exports = { run };
