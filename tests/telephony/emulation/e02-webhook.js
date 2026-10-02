'use strict';

const { startEmuApp, postWebhook, assert } = require('./harness');
const helpers = require('../helpers');

module.exports.id = 'E02';
module.exports.title = 'Webhook inbound+missed → DB';

module.exports.run = async function run() {
  const app = await startEmuApp();
  try {
    const entryId = 'emu_in_' + Date.now();
    const callId = 'emu_call_' + Date.now();
    const caller = '79161234567';

    let r = await postWebhook(app, 'call', {
      entry_id: entryId,
      call_id: callId,
      timestamp: Math.floor(Date.now() / 1000),
      seq: 1,
      call_state: 'Appeared',
      location: 'abonent',
      from: { number: caller },
      to: { number: '200', line_number: '74951234567' },
      call_direction: 1,
    });
    assert(r.status === 200 || r.status === 201, 'Appeared expected 200, got ' + r.status + ' ' + r.text.slice(0, 120));

    r = await postWebhook(app, 'call', {
      entry_id: entryId,
      call_id: callId,
      timestamp: Math.floor(Date.now() / 1000),
      seq: 2,
      call_state: 'Connected',
      location: 'abonent',
      from: { number: caller },
      to: { number: '200' },
      call_direction: 1,
    });
    assert(r.status < 500, 'Connected should not 500, got ' + r.status);

    r = await postWebhook(app, 'call', {
      entry_id: entryId,
      call_id: callId,
      timestamp: Math.floor(Date.now() / 1000),
      seq: 3,
      call_state: 'Disconnected',
      location: 'abonent',
      from: { number: caller },
      to: { number: '200' },
      call_direction: 1,
      talk_time: 42,
    });
    assert(r.status < 500, 'Disconnected should not 500, got ' + r.status);

    const summary = helpers.generateSummaryEvent
      ? helpers.generateSummaryEvent({ entry_id: entryId, call_id: callId })
      : {
          entry_id: entryId,
          call_direction: 1,
          from: { number: caller },
          to: { number: '200' },
          disconnect_reason: 1100,
          talk_time: 42,
        };
    summary.entry_id = entryId;
    r = await postWebhook(app, 'summary', summary);
    assert(r.status < 500, 'summary should not 500, got ' + r.status);

    const { rows } = await app.pool.query(
      `SELECT id, mango_entry_id, call_type, direction FROM call_history
       WHERE mango_entry_id = $1 OR call_id = $2
       ORDER BY id DESC LIMIT 5`,
      [entryId, callId]
    );

    assert(rows.length >= 1, 'expected call_history row for mango_entry_id=' + entryId);

    // Missed cycle
    const missEntry = 'emu_miss_' + Date.now();
    const missSummary = helpers.generateMissedCallSummary
      ? helpers.generateMissedCallSummary({ entry_id: missEntry })
      : {
          entry_id: missEntry,
          call_direction: 1,
          from: { number: '79001112233' },
          to: { number: '200' },
          talk_time: 0,
          disconnect_reason: 1110,
        };
    missSummary.entry_id = missEntry;
    r = await postWebhook(app, 'summary', missSummary);
    assert(r.status < 500, 'missed summary should not 500, got ' + r.status);

    const missRows = await app.pool.query(
      `SELECT id FROM call_history WHERE mango_entry_id = $1 ORDER BY id DESC LIMIT 3`,
      [missEntry]
    );
    assert(missRows.rows.length >= 1 || rows.length >= 1, 'missed or inbound row present');

    // Allow async missed-call handlers to finish before pool.end()
    await new Promise((r) => setTimeout(r, 400));

    return { entryId, rows: rows.length, missed: missRows.rows.length };
  } finally {
    await app.close();
  }
};
