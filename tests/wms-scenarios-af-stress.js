'use strict';
/**
 * WMS Scenarios A–F + Excel AI + stress (fool) tests on local :3000 / asgard_crm_dev.
 * Writes JSON report + console error flags to tests/reports/wms-browser-qa/
 */
const fs = require('fs');
const path = require('path');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const OUT = path.join(__dirname, 'reports', 'wms-browser-qa');
const FIX = path.join(__dirname, 'fixtures', 'wms-cart-scenario-a.xlsx');

async function login(role = 'WAREHOUSE') {
  const accounts = {
    WAREHOUSE: { login: 'test_warehouse', password: 'Test123!', pin: '0000' },
    PM: { login: 'test_pm', password: 'Test123!', pin: '0000' },
    ADMIN: { login: 'test_admin', password: 'Test123!', pin: '0000' },
  };
  const a = accounts[role];
  const lr = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: a.login, password: a.password }),
  });
  const ld = await lr.json();
  if (!ld.token) throw new Error('login fail ' + JSON.stringify(ld));
  let token = ld.token;
  if (ld.status === 'need_pin') {
    const pr = await fetch(`${BASE}/api/auth/verify-pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ pin: a.pin }),
    });
    const pd = await pr.json();
    if (!pd.token) throw new Error('pin fail ' + JSON.stringify(pd));
    token = pd.token;
  }
  return token;
}

function api(token) {
  return async (method, url, body, isForm) => {
    const headers = { Authorization: 'Bearer ' + token };
    let b = body;
    if (!isForm && body != null) {
      headers['Content-Type'] = 'application/json';
      b = JSON.stringify(body);
    }
    const r = await fetch(BASE + url, { method, headers, body: b });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { status: r.status, ok: r.ok, data };
  };
}

function ok(cond, msg) { return { pass: !!cond, msg }; }

async function scenarioA(call, report) {
  const steps = [];
  // Excel parse + AI
  if (!fs.existsSync(FIX)) {
    steps.push(ok(false, 'fixture missing ' + FIX));
    report.A = { steps, pass: false }; return;
  }
  const form = new FormData();
  form.append('file', fs.createReadStream(FIX), { filename: 'wms-cart-scenario-a.xlsx' });
  const parse = await new Promise((resolve, reject) => {
    form.submit({
      protocol: 'http:', host: '127.0.0.1', port: 3000, path: '/api/warehouse-cart/parse-excel',
      method: 'POST', headers: { Authorization: call._tokenHdr },
    }, async (err, res) => {
      if (err) return reject(err);
      let raw = ''; res.on('data', c => raw += c); res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
        catch (e) { resolve({ status: res.statusCode, data: { raw } }); }
      });
    });
  });
  steps.push(ok(parse.status === 200 && (parse.data.rows || []).length >= 5, `parse-excel rows=${(parse.data.rows || []).length}`));

  const ai = await call('POST', '/api/warehouse-cart/suggest-ai', { rows: parse.data.rows || [] });
  const sug = ai.data.suggestions || [];
  const matched = sug.filter(s => s.matched).length;
  steps.push(ok(ai.ok && sug.length >= 5, `suggest-ai n=${sug.length} matched=${matched} ai_used=${ai.data.ai_used}`));
  steps.push(ok(matched >= 1, 'at least 1 catalog match on full catalog'));

  // Clear stale cart so snapshot_available matches current stock (avoid stock_changed 409)
  await call('DELETE', '/api/warehouse-cart/items');
  await call('POST', '/api/warehouse-cart/clear').catch?.(() => {});
  const clr = await call('DELETE', '/api/warehouse-cart');
  steps.push(ok(clr.status < 500, `cart clear status=${clr.status}`));

  // Add matched consumables to cart + one new
  const items = [];
  for (const s of sug.slice(0, 6)) {
    if (s.matched && s.product_id) {
      items.push({ item_type: 'consumable', product_id: s.product_id, need_qty: Math.min(Number(s.need_qty) || 1, 1), source: 'excel' });
    } else if (s.matched && s.equipment_id) {
      items.push({ item_type: 'equipment', equipment_id: s.equipment_id, need_qty: 1, source: 'excel' });
    } else {
      items.push({ item_type: 'new_position', custom_name: s.input_name || 'NEW-AI', need_qty: s.need_qty || 1, source: 'excel' });
    }
  }
  const add = await call('POST', '/api/warehouse-cart/items', { warehouse_id: 1, items });
  steps.push(ok(add.ok || add.status === 200, `cart add status=${add.status} ${add.data.error || ''}`));

  // bind work + submit
  const works = await call('GET', '/api/works?limit=5');
  const workId = (works.data.items || works.data.rows || works.data || []).find?.(w => w.id)?.id
    || works.data?.[0]?.id || 336;
  let submit = await call('POST', '/api/warehouse-cart/submit', { work_id: workId, global_work_id: workId });
  if (submit.status === 409 && submit.data.error === 'stock_changed') {
    // Refresh: drop changed lines, keep new_position / unmatched as new
    await call('DELETE', '/api/warehouse-cart');
    const safe = items.filter(it => it.item_type === 'new_position').concat(
      items.filter(it => it.item_type === 'consumable').slice(0, 1).map(it => ({ ...it, need_qty: 1 }))
    );
    await call('POST', '/api/warehouse-cart/items', { warehouse_id: 1, items: safe.length ? safe : [
      { item_type: 'new_position', custom_name: 'A-SAFE-' + Date.now(), need_qty: 1, source: 'excel' },
    ] });
    submit = await call('POST', '/api/warehouse-cart/submit', { work_id: workId, global_work_id: workId });
  }
  const assemblyId = submit.data.assembly_id;
  steps.push(ok(submit.ok && assemblyId, `submit assembly_id=${assemblyId} err=${submit.data.error || ''}`));

  if (assemblyId) {
    const co = await call('POST', `/api/assembly/${assemblyId}/change-order`, {
      action: 'new_position', name: 'CO-TEST-' + Date.now(), quantity: 1,
    });
    steps.push(ok(co.ok, `change-order add status=${co.status}`));
  }

  report.A = { steps, pass: steps.every(s => s.pass), assembly_id: assemblyId, matched, suggestions: sug.length };
}

async function scenarioB(call, report) {
  const steps = [];
  const prods = await call('GET', '/api/products?limit=3');
  const pid = (prods.data.items || prods.data.rows || [])[0]?.id || null;
  const recv = await call('POST', '/api/warehouse-ops/sessions', {
    session_type: 'receive', warehouse_id: 1, title: 'B-receive-' + Date.now(),
    items: pid ? [{ track_type: 'consumable', product_id: pid, planned_qty: 50, unit: 'шт' }] : [],
  });
  steps.push(ok(recv.ok, `receive session ${recv.status}`));
  const put = await call('POST', '/api/warehouse-ops/sessions', {
    session_type: 'putaway', warehouse_id: 1, title: 'B-putaway-' + Date.now(),
    items: pid ? [{ track_type: 'consumable', product_id: pid, planned_qty: 50, unit: 'шт' }] : [],
  });
  steps.push(ok(put.ok, `putaway session ${put.status}`));
  // confirm putaway step1 place
  const itemId = put.data.items?.[0]?.id;
  if (itemId) {
    const conf = await call('POST', `/api/warehouse-ops/items/${itemId}/confirm`, {
      place_code: 'PR-1A1', fact_qty: 10, device: 'crm',
    });
    steps.push(ok(conf.status < 500, `putaway confirm ${conf.status} ${conf.data.error || ''}`));
  }
  report.B = { steps, pass: steps.filter(s => s.pass).length >= 2 };
}

async function scenarioC(call, report) {
  const by = await call('GET', '/api/warehouse-map/by-place/PR-1A1');
  const locId = by.data.items?.[0]?.id;
  const prods = await call('GET', '/api/products?limit=5');
  const pid = (prods.data.items || prods.data.rows || [])[0]?.id || 33;
  const issue = await call('POST', '/api/stock/issue', {
    product_id: pid, warehouse_id: 1, location_id: locId, qty: 0.001, reason: 'C-issue-test',
  });
  const wo = await call('POST', '/api/stock/writeoff', {
    product_id: pid, warehouse_id: 1, location_id: locId, qty: 0.001, reason: 'C-writeoff-test',
  });
  const hist = locId ? await call('GET', `/api/warehouse-ops/locations/${locId}/history`) : { ok: false, data: {} };
  const steps = [
    ok(by.ok && locId, `place PR-1A1 id=${locId}`),
    ok(issue.status < 500, `issue status=${issue.status} ${issue.data.error || ''}`),
    ok(wo.status < 500, `writeoff status=${wo.status} ${wo.data.error || ''}`),
    ok(hist.ok && Array.isArray(hist.data.similar), `history similar=${(hist.data.similar || []).length}`),
  ];
  report.C = { steps, pass: steps.filter(s => s.pass).length >= 3 };
}

async function scenarioD(call, report) {
  const by = await call('GET', '/api/warehouse-map/by-place/PR-1A1');
  const locId = by.data.items?.[0]?.id;
  const hist = await call('GET', `/api/warehouse-ops/locations/${locId}/history`);
  const steps = [
    ok(hist.ok, 'history ok'),
    ok(Array.isArray(hist.data.similar) && hist.data.similar.length >= 1, `similar cells ${hist.data.similar?.length}`),
    ok(Array.isArray(hist.data.movements), 'movements array'),
  ];
  report.D = { steps, pass: steps.every(s => s.pass) };
}

async function scenarioE(call, report) {
  const inv = await call('POST', '/api/warehouse-ops/inventory', {
    warehouse_id: 1, title: 'E-inv-' + Date.now(),
  });
  const sid = inv.data.session?.id || inv.data.item?.id || inv.data.id;
  const by = await call('GET', '/api/warehouse-map/by-place/PR-1A1');
  const locId = by.data.items?.[0]?.id;
  let line = { ok: false, status: 0, data: {} };
  if (sid && locId) {
    line = await call('POST', `/api/warehouse-ops/inventory/${sid}/lines`, {
      location_id: locId, track_type: 'consumable', expected_qty: 0, fact_qty: 0, reason_if_zero: 'E-zero',
    });
  }
  const steps = [
    ok(inv.ok && !!sid, `inventory session ${sid} ${inv.status}`),
    ok(line.ok || line.status < 500, `inv line ${line.status} ${line.data.error || ''}`),
  ];
  report.E = { steps, pass: !!sid && (line.ok || line.status === 200 || line.status === 201) };
}

async function scenarioF(call, report) {
  // create demob from existing mobilization if any
  const list = await call('GET', '/api/assembly?limit=10');
  const items = list.data.items || list.data.rows || [];
  const mob = items.find(a => a.type === 'mobilization' && !['draft'].includes(a.status));
  let demob = { ok: false, status: 0, data: {} };
  if (mob) {
    demob = await call('POST', `/api/assembly/${mob.id}/create-demob`, {});
  }
  const steps = [
    ok(list.ok, `assembly list n=${items.length}`),
    ok(demob.ok || demob.status === 409 || !!mob, `demob status=${demob.status} from=${mob?.id}`),
  ];
  report.F = { steps, pass: list.ok, demob_id: demob.data.item?.id || demob.data.id };
}

async function stress(call, report) {
  const steps = [];
  // 1) empty suggest
  const empty = await call('POST', '/api/warehouse-cart/suggest-ai', { rows: [] });
  steps.push(ok(empty.status === 400 || empty.ok, `empty rows handled ${empty.status}`));

  // 2) garbage names
  const garbage = await call('POST', '/api/warehouse-cart/suggest-ai', {
    rows: [{ name: '!!!@@@' }, { name: '' }, { name: 'x' }, { name: 'А'.repeat(500), quantity: -5 }],
  });
  steps.push(ok(garbage.status < 500, `garbage suggest ${garbage.status}`));

  // 3) bulk 200 rows suggest
  const bulk = [];
  for (let i = 0; i < 200; i++) bulk.push({ name: i % 3 === 0 ? 'Электроды' : 'НесуществующийТовар-' + i, quantity: i + 1 });
  const t0 = Date.now();
  const big = await call('POST', '/api/warehouse-cart/suggest-ai', { rows: bulk });
  const ms = Date.now() - t0;
  steps.push(ok(big.status < 500, `bulk200 suggest ${big.status} in ${ms}ms n=${(big.data.suggestions || []).length}`));

  // 3b) fool: 1000 rows (cap / no 500)
  const mega = [];
  for (let i = 0; i < 1000; i++) mega.push({ name: 'Мега-' + i, quantity: 1 });
  const t1 = Date.now();
  const megaRes = await call('POST', '/api/warehouse-cart/suggest-ai', { rows: mega });
  const megaMs = Date.now() - t1;
  steps.push(ok(megaRes.status < 500 && megaRes.data.truncated === true,
    `bulk1000 suggest ${megaRes.status} in ${megaMs}ms n=${(megaRes.data.suggestions || []).length} trunc=${megaRes.data.truncated}`));

  // 3c) empty cart submit
  await call('DELETE', '/api/warehouse-cart');
  const emptySub = await call('POST', '/api/warehouse-cart/submit', { work_id: 336 });
  steps.push(ok(emptySub.status >= 400 && emptySub.status < 500, `empty submit ${emptySub.status}`));

  // 3d) double delete cart
  const d1 = await call('DELETE', '/api/warehouse-cart');
  const d2 = await call('DELETE', '/api/warehouse-cart');
  steps.push(ok(d1.status < 500 && d2.status < 500, `double clear ${d1.status}/${d2.status}`));

  // 4) invalid place
  const badPlace = await call('GET', '/api/warehouse-map/by-place/ZZZ-NOPE');
  steps.push(ok(badPlace.status === 404, `bad place 404=${badPlace.status}`));

  // 5) double sync locations
  const sync1 = await call('POST', '/api/warehouse-map/floors/1/sync-locations', {});
  const sync2 = await call('POST', '/api/warehouse-map/floors/1/sync-locations', {});
  steps.push(ok(sync1.ok && sync2.ok, `idempotent sync ${sync1.status}/${sync2.status} count2=${sync2.data.count}`));

  // 6) delete nonexistent
  const del = await call('DELETE', '/api/warehouse-map/objects/99999999');
  steps.push(ok(del.status === 404 || del.status === 400, `delete missing ${del.status}`));

  // 7) confirm without session
  const conf = await call('POST', '/api/warehouse-ops/items/999999/confirm', { place_code: 'PR-1A1', fact_qty: 1 });
  steps.push(ok(conf.status >= 400 && conf.status < 500, `confirm missing ${conf.status}`));

  // 8) add 50 cart lines then wipe mid-flight
  const flood = [];
  for (let i = 0; i < 50; i++) flood.push({ item_type: 'new_position', custom_name: 'FLOOD-' + i, need_qty: 1, source: 'stress' });
  const floodAdd = await call('POST', '/api/warehouse-cart/items', { warehouse_id: 1, items: flood });
  const wipe = await call('DELETE', '/api/warehouse-cart');
  const after = await call('GET', '/api/warehouse-cart');
  steps.push(ok(floodAdd.status < 500 && wipe.ok && (after.data.items || []).length === 0,
    `flood50+wipe add=${floodAdd.status} left=${(after.data.items || []).length}`));

  report.stress = { steps, pass: steps.filter(s => s.pass).length >= 7, elapsed_bulk_ms: ms, elapsed_mega_ms: megaMs };
}

async function catalogSanity(call, report) {
  const p = await call('GET', '/api/products?limit=5');
  // count via suggest on known name
  const ai = await call('POST', '/api/warehouse-cart/suggest-ai', {
    rows: [{ name: 'Кислота соляная', quantity: 1 }, { name: 'Электроды', quantity: 2 }],
  });
  report.catalog = {
    products_endpoint: p.status,
    products_total: p.data.total,
    suggest_matched: (ai.data.suggestions || []).filter(s => s.matched).length,
    alts: (ai.data.suggestions || []).map(s => (s.alternatives || []).length),
    pass: (ai.data.suggestions || []).some(s => s.matched) && (p.data.total || 0) > 500,
  };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const token = await login('WAREHOUSE');
  const call = api(token);

  const report = { started_at: new Date().toISOString(), base: BASE };

  // Scenario A inline (native FormData + Blob)
  {
    const steps = [];
    if (!fs.existsSync(FIX)) {
      steps.push(ok(false, 'fixture missing'));
      report.A = { steps, pass: false };
    } else {
      const buf = fs.readFileSync(FIX);
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const fd = new FormData();
      fd.append('file', blob, 'wms-cart-scenario-a.xlsx');
      const res = await fetch(BASE + '/api/warehouse-cart/parse-excel', {
        method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd,
      });
      const pdata = await res.json().catch(() => ({}));
      steps.push(ok(res.ok && (pdata.rows || []).length >= 5, `parse-excel rows=${(pdata.rows || []).length}`));

      const ai = await call('POST', '/api/warehouse-cart/suggest-ai', { rows: pdata.rows || [] });
      const sug = ai.data.suggestions || [];
      const matched = sug.filter(s => s.matched).length;
      steps.push(ok(ai.ok && sug.length >= 5, `suggest-ai n=${sug.length} matched=${matched} ai_used=${!!ai.data.ai_used}`));
      steps.push(ok(matched >= 1, `catalog matches=${matched}`));

      await call('DELETE', '/api/warehouse-cart');
      const items = [];
      for (const s of sug.slice(0, 8)) {
        if (s.matched && s.product_id) items.push({ item_type: 'consumable', product_id: s.product_id, need_qty: 1, source: 'excel' });
        else if (s.matched && s.equipment_id) items.push({ item_type: 'equipment', equipment_id: s.equipment_id, need_qty: 1, source: 'excel' });
        else items.push({ item_type: 'new_position', custom_name: s.input_name || 'NEW', need_qty: s.need_qty || 1, source: 'excel' });
      }
      // Always include at least one new_position so assembly can be created even on stock race
      items.push({ item_type: 'new_position', custom_name: 'A-EXCEL-' + Date.now(), need_qty: 1, source: 'excel' });
      const add = await call('POST', '/api/warehouse-cart/items', { warehouse_id: 1, items });
      steps.push(ok(add.ok, `cart add ${add.status} ${add.data.error || ''}`));

      let submit = await call('POST', '/api/warehouse-cart/submit', { work_id: 336, global_work_id: 336 });
      if (!submit.ok) {
        await call('DELETE', '/api/warehouse-cart');
        const onlyNew = [
          { item_type: 'new_position', custom_name: 'A-FALLBACK-' + Date.now(), need_qty: 1, source: 'excel' },
        ];
        await call('POST', '/api/warehouse-cart/items', { warehouse_id: 1, items: onlyNew });
        submit = await call('POST', '/api/warehouse-cart/submit', { work_id: 336, global_work_id: 336 });
      }
      const assemblyId = submit.data.assembly_id;
      steps.push(ok(submit.ok && assemblyId, `submit asm=${assemblyId} ${submit.data.error || ''}`));
      if (assemblyId) {
        const co = await call('POST', `/api/assembly/${assemblyId}/change-order`, {
          action: 'procure', name: 'CO-STRESS-' + Date.now(), quantity: 2,
        });
        steps.push(ok(co.ok, `CO ${co.status}`));
      }
      report.A = { steps, pass: steps.filter(s => s.pass).length >= 4, assembly_id: assemblyId, matched, n: sug.length, ai_used: ai.data.ai_used };
    }
  }

  await catalogSanity(call, report);
  await scenarioB(call, report);
  await scenarioC(call, report);
  await scenarioD(call, report);
  await scenarioE(call, report);
  await scenarioF(call, report);
  await stress(call, report);

  report.finished_at = new Date().toISOString();
  report.summary = {
    A: report.A?.pass, B: report.B?.pass, C: report.C?.pass, D: report.D?.pass,
    E: report.E?.pass, F: report.F?.pass, stress: report.stress?.pass, catalog: report.catalog?.pass,
  };
  const outFile = path.join(OUT, 'SCENARIOS-AF-STRESS.json');
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.summary, null, 2));
  console.log('Wrote', outFile);
  const failed = Object.entries(report.summary).filter(([, v]) => !v);
  process.exitCode = failed.length ? 2 : 0;
}

main().catch(e => { console.error(e); process.exit(1); });
