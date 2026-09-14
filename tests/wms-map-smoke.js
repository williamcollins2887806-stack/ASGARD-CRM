#!/usr/bin/env node
/**
 * Smoke checks for WMS map module (run against asgard_crm_test clone when available).
 * Usage: node tests/wms-map-smoke.js [baseUrl] [token]
 */
'use strict';
const base = process.argv[2] || 'http://127.0.0.1:3100';
const token = process.argv[3] || process.env.ASGARD_TOKEN || '';

async function req(method, path, body) {
  const r = await fetch(base + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: body != null ? JSON.stringify(body) : undefined
  });
  const d = await r.json().catch(() => ({}));
  return { status: r.status, d };
}

(async () => {
  const fails = [];
  const floors = await req('GET', '/api/warehouse-map/floors');
  if (floors.status !== 200) fails.push('floors ' + floors.status);
  else console.log('floors', (floors.d.items || []).length);

  if ((floors.d.items || [])[0]) {
    const id = floors.d.items[0].id;
    const det = await req('GET', '/api/warehouse-map/floors/' + id);
    if (det.status !== 200) fails.push('floor detail');
    else console.log('objects', (det.d.objects || []).length);
  }

  const ops = await req('GET', '/api/warehouse-ops/sessions?limit=5');
  if (ops.status !== 200) fails.push('sessions ' + ops.status);

  const dir = await req('GET', '/api/warehouse-ops/director-summary');
  if (dir.status !== 200) fails.push('director ' + dir.status);

  const unpick = await req('GET', '/api/warehouse-ops/unpick-queue');
  if (unpick.status !== 200) fails.push('unpick ' + unpick.status);

  if (fails.length) {
    console.error('FAIL', fails.join(', '));
    process.exit(1);
  }
  console.log('WMS smoke OK');
})().catch((e) => { console.error(e); process.exit(1); });
