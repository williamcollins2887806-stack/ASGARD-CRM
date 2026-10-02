'use strict';

const { EventEmitter } = require('events');

const CHANNEL = 'pbx_call_event';

/**
 * LISTEN/NOTIFY мост для событий звонков.
 * @param {import('pg').Pool} pool
 */
function attachNotifyBridge(poolOrDb, emitter = new EventEmitter()) {
  // Accept raw pg.Pool or services/db wrapper ({ pool, query })
  const pool = poolOrDb && typeof poolOrDb.connect === 'function'
    ? poolOrDb
    : (poolOrDb && poolOrDb.pool) || null;
  if (!pool || typeof pool.connect !== 'function') {
    return { emitter, stop: async () => {} };
  }

  let client;
  let stopped = false;

  async function start() {
    client = await pool.connect();
    client.on('notification', (msg) => {
      if (msg.channel !== CHANNEL && msg.channel !== 'pbx_recording_ready') return;
      let payload = msg.payload;
      try {
        payload = JSON.parse(msg.payload);
      } catch (_) { /* raw string */ }
      emitter.emit(msg.channel, payload);
      emitter.emit('event', { channel: msg.channel, payload });
    });
    await client.query(`LISTEN ${CHANNEL}`);
    await client.query('LISTEN pbx_recording_ready');
  }

  start().catch((err) => emitter.emit('error', err));

  return {
    emitter,
    CHANNEL,
    async notify(clientOrPool, payload) {
      const q = clientOrPool.query ? clientOrPool : pool;
      await q.query('SELECT pg_notify($1, $2)', [CHANNEL, JSON.stringify(payload)]);
    },
    async stop() {
      stopped = true;
      if (client) {
        try {
          await client.query(`UNLISTEN ${CHANNEL}`);
          await client.query('UNLISTEN pbx_recording_ready');
        } catch (_) { /* ignore */ }
        client.release();
        client = null;
      }
    },
    get stopped() {
      return stopped;
    },
  };
}

module.exports = { attachNotifyBridge, CHANNEL };
