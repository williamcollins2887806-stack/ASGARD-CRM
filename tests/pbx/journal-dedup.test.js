'use strict';

/**
 * Проверка дедупликации журнала: один звонок = одна строка call_history,
 * даже когда его видят оба контура (PBX source='pbx' и Mango webhook).
 *
 * Требует DATABASE_URL на клон (asgard_crm_test).
 * Usage: DATABASE_URL=...asgard_crm_test node tests/pbx/journal-dedup.test.js
 */
const assert = require('assert');

const DB = process.env.DATABASE_URL || '';
if (!/asgard_crm_test/.test(DB)) {
  console.log('skip: нужен DATABASE_URL на asgard_crm_test');
  process.exit(0);
}

const { Pool } = require('pg');
const pool = new Pool({ connectionString: DB });

const CALLER = '79990001122';
const DID = '74993223062';

async function cleanup() {
  await pool.query(
    `DELETE FROM call_history
      WHERE (from_number = $1 AND to_number = $2)
         OR mango_entry_id LIKE 'dedup_test_%'`,
    [CALLER, DID]
  );
}

async function main() {
  await cleanup();

  // 1. PBX-контур создаёт строку (как handleInboundAgi).
  const pbxUid = '1791999000.1';
  const ins = await pool.query(
    `INSERT INTO call_history (
       call_id, pbx_uid, source, direction, call_type, status,
       from_number, to_number, caller_number, called_number,
       started_at, timestamp, created_at, updated_at
     ) VALUES ($1,$2,'pbx','inbound','inbound','ringing',$3,$4,$3,$4,NOW(),NOW(),NOW(),NOW())
     RETURNING id`,
    ['pbx_' + pbxUid, pbxUid, CALLER, DID]
  );
  const pbxRowId = ins.rows[0].id;

  // 2. Mango webhook находит PBX-строку и обновляет её (логика findPbxCallByNumbers).
  const clientNum = CALLER.replace(/\D/g, '').slice(-10);
  const did = DID.replace(/\D/g, '').slice(-10);
  const found = await pool.query(
    `SELECT id FROM call_history
      WHERE source = 'pbx'
        AND (mango_entry_id IS NULL OR mango_entry_id = '')
        AND right(regexp_replace(COALESCE(from_number, ''), '\\D', '', 'g'), 10) = $1
        AND ($2 = '' OR right(regexp_replace(COALESCE(to_number, ''), '\\D', '', 'g'), 10) = $2)
        AND started_at > NOW() - interval '5 minutes'
        AND started_at < NOW() + interval '5 minutes'
      ORDER BY started_at DESC LIMIT 1`,
    [clientNum, did]
  );
  assert.ok(found.rows[0], 'webhook не нашёл PBX-строку');
  assert.strictEqual(found.rows[0].id, pbxRowId, 'найдена не та строка');

  await pool.query(
    `UPDATE call_history
        SET mango_entry_id = COALESCE(mango_entry_id, $2),
            duration = 42, duration_seconds = 42,
            status = 'completed', updated_at = NOW()
      WHERE id = $1`,
    [pbxRowId, 'dedup_test_entry']
  );

  // 3. В журнале должна быть РОВНО одна строка на этот звонок.
  const cnt = await pool.query(
    `SELECT count(*)::int AS c FROM call_history
      WHERE from_number = $1 AND to_number = $2`,
    [CALLER, DID]
  );
  assert.strictEqual(cnt.rows[0].c, 1, `дубль в журнале: ${cnt.rows[0].c} строк`);

  // 4. Строка обогатилась, запись одна, pbx_uid сохранён.
  const row = await pool.query(
    `SELECT id, source, mango_entry_id, duration, pbx_uid FROM call_history WHERE id = $1`,
    [pbxRowId]
  );
  assert.strictEqual(row.rows[0].source, 'pbx', 'source потерян');
  assert.strictEqual(row.rows[0].pbx_uid, pbxUid, 'pbx_uid потерян');
  assert.strictEqual(row.rows[0].mango_entry_id, 'dedup_test_entry', 'entry_id не привязан');
  assert.strictEqual(row.rows[0].duration, 42, 'метаданные не обновились');

  await cleanup();
  console.log('journal-dedup: PASS (1 строка на звонок, метаданные слиты)');
  return 0;
}

main()
  .then((c) => pool.end().then(() => process.exit(c)))
  .catch((e) => {
    console.error('journal-dedup: FAIL —', e.message);
    return pool.end().then(() => process.exit(1));
  });
