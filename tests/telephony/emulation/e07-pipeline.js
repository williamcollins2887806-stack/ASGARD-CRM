'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { startEmuApp, assert } = require('./harness');
const CallPipeline = require('../../../src/services/call-pipeline');

module.exports.id = 'E07';
module.exports.title = 'Pipeline TELEPHONY_EMU_MOCK STT→AI';

module.exports.run = async function run() {
  process.env.TELEPHONY_EMU_MOCK = '1';
  const app = await startEmuApp();
  const tmpWav = path.join(os.tmpdir(), 'emu-call-' + Date.now() + '.wav');
  // minimal wav header-ish bytes (pipeline mock skips real decode)
  fs.writeFileSync(tmpWav, Buffer.alloc(64, 0));

  try {
    const callIdStr = 'emu_pipe_' + Date.now();
    const { rows: ins } = await app.pool.query(
      `INSERT INTO call_history (
         call_id, user_id, call_type, direction, from_number, to_number, duration_seconds,
         record_path, transcript_status, created_at, updated_at
       ) VALUES (
         $1, $2, 'inbound', 'inbound', '79001234567', '74951234567', 90,
         $3, 'none', NOW(), NOW()
       ) RETURNING id`,
      [callIdStr, app.user.id, tmpWav]
    ).catch(async () => {
      const r = await app.pool.query(
        `INSERT INTO call_history (call_id, user_id, direction, from_number, duration_seconds, record_path, transcript_status)
         VALUES ($1, $2, 'inbound', '79001234567', 90, $3, 'none') RETURNING id`,
        [callIdStr, app.user.id, tmpWav]
      );
      return r;
    });

    const callId = ins[0].id;
    const mockAi = {
      complete: async function complete() {
        return JSON.stringify({
          summary: 'EMU: клиент уточнил сроки, договорились перезвонить',
          is_target: true,
          sentiment: 'positive',
          quality_score: 8,
          classification: 'information_request',
          key_requirements: ['сроки'],
          next_steps: ['перезвонить'],
        });
      },
    };

    const pipe = new CallPipeline(app.pool, mockAi, () => {});
    await pipe.processCall(callId);

    const { rows } = await app.pool.query(
      `SELECT transcript_status, transcript, ai_summary, ai_quality_score, ai_is_target
       FROM call_history WHERE id = $1`,
      [callId]
    );
    const row = rows[0];
    assert(row.transcript_status === 'done', 'transcript_status done, got ' + row.transcript_status);
    assert(row.transcript && String(row.transcript).length > 10, 'transcript present');
    assert(row.ai_summary && String(row.ai_summary).indexOf('EMU:') === 0, 'ai_summary from mock, got ' + row.ai_summary);
    assert(Number(row.ai_quality_score) === 8, 'quality_score=8 got ' + row.ai_quality_score);
    assert(row.ai_is_target === true, 'ai_is_target true');

    await app.pool.query(`DELETE FROM call_history WHERE id = $1`, [callId]);
    return { callId, summary: row.ai_summary };
  } finally {
    try {
      fs.unlinkSync(tmpWav);
    } catch (_) {}
    await app.close();
  }
};
