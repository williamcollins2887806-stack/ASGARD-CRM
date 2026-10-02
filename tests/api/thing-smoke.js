'use strict';

/**
 * API smoke Тинг — требует живой сервер + V361.
 * Запуск через общий runner, если BASE_URL задан.
 */

const BASE = process.env.TEST_BASE || process.env.BASE_URL || 'http://127.0.0.1:3000';

async function json(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

module.exports = async function thingApiSmoke(assert, ctx) {
  const health = await json('GET', '/api/thing/health');
  assert.ok(health.status === 200, 'thing health 200');
  assert.ok(health.data.ok === true, 'thing health ok');

  if (!ctx || !ctx.token) {
    console.log('[thing] skip auth flows — no ctx.token');
    return;
  }

  const created = await json(
    'POST',
    '/api/thing/rooms',
    { title: 'Тинг smoke ' + Date.now(), mode: 'instant', protocol_enabled: true },
    ctx.token
  );
  assert.ok(created.status === 201, 'create room 201, got ' + created.status);
  assert.ok(/^[0-9]{6}$/.test(created.data.room.dial_code), 'dial_code 6 digits');
  assert.ok(created.data.room.protocol_enabled === true, 'protocol on');

  const roomId = created.data.room.id;
  const slug = created.data.room.slug;

  const pub = await json('GET', `/api/thing/public/${slug}`);
  assert.ok(pub.status === 200, 'public card');
  assert.ok(!('dial_code' in pub.data), 'dial_code not public');

  const ended = await json('POST', `/api/thing/rooms/${roomId}/end`, {}, ctx.token);
  assert.ok(ended.status === 200, 'host end');
  assert.ok(ended.data.protocol.protocol === 'no_recording' || ended.data.protocol.protocol === 'skipped' || ended.data.protocol.protocol === 'queued', 'protocol branch');

  const noProto = await json(
    'POST',
    '/api/thing/rooms',
    { title: 'Без протокола ' + Date.now(), protocol_enabled: false },
    ctx.token
  );
  assert.ok(noProto.status === 201, 'create without protocol');
  const end2 = await json('POST', `/api/thing/rooms/${noProto.data.room.id}/end`, {}, ctx.token);
  assert.ok(end2.data.protocol.protocol === 'skipped' || end2.data.protocol.protocol === 'no_recording', 'skipped when disabled');
};

if (require.main === module) {
  (async () => {
    const assert = require('assert');
    await module.exports(assert, {});
    console.log('thing health smoke OK');
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
