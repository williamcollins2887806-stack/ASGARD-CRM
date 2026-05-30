/**
 * Integration-тесты ConductorRun service (Сессия 1).
 * Бьют по РЕАЛЬНОЙ локальной dev-БД (asgard_crm_dev) — загружают .env.
 *
 * Запуск:
 *   - как jest:  npx jest tests/integration/mimir-conductor-run.test.js
 *   - как node:  node tests/integration/mimir-conductor-run.test.js  (см. низ файла)
 *
 * Тест создаёт временный ConductorRun без work/tender (FK nullable), проверяет
 * хеширование артефактов, порядок событий и атомарность updateRunStatus,
 * затем удаляет за собой (ON DELETE CASCADE подчищает дочерние строки).
 */

'use strict';

// .env имеет приоритет над дефолтами env-setup (asgard_test) — грузим первым.
require('dotenv').config();

const db = require('../../src/services/db');
const cr = require('../../src/services/mimir-conductor/conductor-run');

async function run() {
  const results = [];
  const assert = (name, cond) => { results.push({ name, ok: !!cond }); if (!cond) throw new Error('FAILED: ' + name); };
  // pg возвращает BIGSERIAL/BIGINT как строку (во избежание потери точности) —
  // считаем «положительным id» и числовую строку, и число.
  const isPosId = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0; };

  let runId;
  try {
    // 1) createRun
    const created = await cr.createRun({ profile: 'STANDARD', contractValue: 1234567.89, complexityFlags: { has_welding: true } });
    runId = created.runId;
    assert('createRun возвращает runId', isPosId(runId));
    assert('createRun статус DRAFT', created.status === 'DRAFT');

    const fetched = await cr.getRun(runId);
    assert('getRun находит запись', fetched && fetched.id === runId);
    assert('complexity_flags сохранён', fetched.complexity_flags && fetched.complexity_flags.has_welding === true);

    // 2) Хеш одинакового контента совпадает, разного — отличается
    const h1 = cr.hashContent({ a: 1, b: [2, 3] });
    const h2 = cr.hashContent({ b: [2, 3], a: 1 }); // другой порядок ключей
    const h3 = cr.hashContent({ a: 1, b: [2, 4] });
    assert('hashContent стабилен к порядку ключей', h1 === h2);
    assert('hashContent различает контент', h1 !== h3);

    // нужен agent_run для FK created_by_agent_run_id (nullable, но проверим оба)
    const agentRunId = await cr.startAgentRun(runId, { agentName: 'conductor', model: 'sonnet-4-6', promptHash: 'abc' });
    assert('startAgentRun возвращает id', isPosId(agentRunId));

    // 3) addArtifact + дедупликация
    const a1 = await cr.addArtifact(runId, agentRunId, 'tz_summary', { scope: 'X', qty: 10 });
    const a2 = await cr.addArtifact(runId, agentRunId, 'tz_summary', { qty: 10, scope: 'X' }); // тот же контент
    assert('addArtifact возвращает artifactId', isPosId(a1.artifactId));
    assert('одинаковый контент → одинаковый hash', a1.contentHash === a2.contentHash);
    assert('одинаковый контент → дедупликация (тот же id)', a1.artifactId === a2.artifactId && a2.deduped === true);

    const got = await cr.getArtifact(runId, 'tz_summary');
    assert('getArtifact возвращает последний не-superseded', got && got.id === a1.artifactId);

    // 4) addEvent + listEvents порядок по возрастанию id
    const e1 = await cr.addEvent(runId, agentRunId, 'thought', { text: 'мысль 1' });
    const e2 = await cr.addEvent(runId, agentRunId, 'thought', { text: 'мысль 2' });
    assert('addEvent возвращает возрастающие id', e2 > e1);
    const events = await cr.listEvents(runId, 0);
    const ids = events.map(e => e.id);
    const sorted = [...ids].sort((a, b) => a - b);
    assert('listEvents отсортирован по id ASC', JSON.stringify(ids) === JSON.stringify(sorted));
    // listEvents(sinceEventId) отдаёт только более новые
    const after = await cr.listEvents(runId, e1);
    assert('listEvents(sinceEventId) фильтрует', after.every(e => e.id > e1) && after.some(e => e.id === e2));

    // 5) updateRunStatus атомарно пишет событие status_change
    const beforeCount = (await cr.listEvents(runId, 0)).filter(e => e.event_type === 'status_change').length;
    await cr.updateRunStatus(runId, 'RUNNING', { conductorModel: 'sonnet-4-6' });
    const afterEvents = await cr.listEvents(runId, 0);
    const scEvents = afterEvents.filter(e => e.event_type === 'status_change');
    assert('updateRunStatus добавил событие status_change', scEvents.length === beforeCount + 1);
    const last = scEvents[scEvents.length - 1];
    assert('status_change payload from/to корректен', last.payload.to === 'RUNNING');
    const after2 = await cr.getRun(runId);
    assert('updateRunStatus обновил статус и модель', after2.status === 'RUNNING' && after2.conductor_model === 'sonnet-4-6');

    return results;
  } finally {
    if (runId) {
      // cascade удалит agent_runs/artifacts/events
      await db.query('DELETE FROM mimir_conductor_runs WHERE id = $1', [runId]);
    }
  }
}

// ─── jest-обёртка ───
if (typeof describe === 'function') {
  describe('Mimir Conductor — conductor-run service (integration)', () => {
    let res;
    beforeAll(async () => { res = await run(); });
    afterAll(async () => { await db.end(); });
    test('все проверки прошли', () => {
      const failed = (res || []).filter(r => !r.ok);
      expect(failed).toEqual([]);
    });
  });
}

// ─── standalone-запуск через node ───
if (require.main === module) {
  run()
    .then((res) => {
      res.forEach(r => console.log(`${r.ok ? '✅' : '❌'} ${r.name}`));
      const failed = res.filter(r => !r.ok);
      console.log(failed.length ? `\n❌ ${failed.length} провалено` : `\n✅ Все ${res.length} проверок прошли`);
      return db.end().then(() => process.exit(failed.length ? 1 : 0));
    })
    .catch((e) => {
      console.error('❌ Тест упал:', e.message);
      db.end().finally(() => process.exit(1));
    });
}

module.exports = { run };
