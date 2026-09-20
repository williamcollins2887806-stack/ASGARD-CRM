/**
 * C1/C3 — рантайм-верификация на КЛОНЕ (:3101, asgard_crm_test).
 * Проверяет:
 *   1) новый контур assembly: создать ведомость → позиции → confirm → паллет → сборка → ФОТО позиции → приёмка;
 *   2) legacy field-packing ЖИВ (его использует desktop v2) — /api/field/packing остаётся доступен;
 *   3) миграция V357 (колонки фото) на месте;
 *   4) загруженный файл физически лежит в uploads/assembly/.
 * Пишет только в клон-БД и uploads; в конце убирает за собой.
 *
 * Запуск: node tools/verify_assembly_flow.js
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Client } = require('pg');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3101';
const DB = process.env.CL_DB_NAME || 'asgard_crm_test';
const UPLOAD_BASE = process.env.UPLOAD_DIR || './uploads';

const pool = new Client({ host: '127.0.0.1', port: 5432, user: 'asgard', password: '123456789', database: DB });

let pass = 0, fail = 0;
const rows = [];
function check(name, ok, proof) { ok ? pass++ : fail++; rows.push({ ok, name, proof }); console.log(`${ok ? '✓' : '✗'} ${name}${proof ? ' — ' + proof : ''}`); }

async function login(login, password, pin = '0000') {
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login, password }) });
  const d = await r.json().catch(() => ({}));
  let token = d.token;
  if (d.status === 'need_pin') {
    const r2 = await fetch(BASE + '/api/auth/verify-pin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ pin }) });
    const d2 = await r2.json().catch(() => ({}));
    token = d2.token || token;
  }
  return token;
}
const H = (t) => ({ Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' });

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQAY3Y2wAAAAAElFTkSuQmCC', 'base64');

(async () => {
  await pool.connect();
  const cleanup = { orderId: null, files: [] };
  try {
    // ── seed: у сотрудника должен быть user_id и PIN (для field-login) ──
    const wres = await pool.query(`
      SELECT w.id AS work_id, w.pm_id
      FROM works w
      WHERE EXISTS (SELECT 1 FROM employee_assignments ea WHERE ea.work_id = w.id)
      ORDER BY (w.pm_id = (SELECT id FROM users WHERE login='test_pm')) DESC, w.id DESC
      LIMIT 1`);
    if (!wres.rows[0]) throw new Error('нет works с сотрудниками в клоне');
    const workId = wres.rows[0].work_id;

    const eres = await pool.query(`
      SELECT e.id AS emp_id, e.user_id, e.fio
      FROM employee_assignments ea JOIN employees e ON e.id = ea.employee_id
      WHERE ea.work_id = $1 AND e.is_active = true AND e.user_id IS NOT NULL
      LIMIT 1`, [workId]);
    if (!eres.rows[0]) throw new Error('нет сотрудника с user_id на работе ' + workId);
    const emp = eres.rows[0];

    const pinHash = await bcrypt.hash('0000', 10);
    await pool.query('UPDATE users SET pin_hash=$1 WHERE id=$2', [pinHash, emp.user_id]);

    const pmToken = await login('test_pm', 'Test123!');
    const adminToken = await login('test_admin', 'Test123!');
    check('login: PM/ADMIN CRM', !!pmToken && !!adminToken, `work=${workId} emp=${emp.emp_id}(${emp.fio})`);

    // ── 1. создать ведомость ──
    let r = await fetch(BASE + '/api/assembly', { method: 'POST', headers: H(adminToken), body: JSON.stringify({ work_id: workId, type: 'mobilization', title: 'VERIFY C1C3 сборка', destination: 'Клон-объект' }) });
    let d = await r.json().catch(() => ({}));
    const orderId = d.item && d.item.id;
    cleanup.orderId = orderId;
    check('POST /api/assembly (создать ведомость)', r.status === 200 && !!orderId, `status=${r.status} id=${orderId}`);

    // ── 2. позиции ──
    r = await fetch(BASE + `/api/assembly/${orderId}/items`, { method: 'POST', headers: H(adminToken), body: JSON.stringify({ name: 'Позиция А (verify)', unit: 'шт', quantity: 3, source: 'manual' }) });
    const i1 = (await r.json().catch(() => ({}))).item;
    r = await fetch(BASE + `/api/assembly/${orderId}/items`, { method: 'POST', headers: H(adminToken), body: JSON.stringify({ name: 'Позиция Б (verify)', unit: 'шт', quantity: 1, source: 'manual' }) });
    const i2 = (await r.json().catch(() => ({}))).item;
    check('POST .../items ×2', !!i1 && !!i2, `ids=${i1 && i1.id},${i2 && i2.id}`);

    // ── 3. confirm (РП) ──
    r = await fetch(BASE + `/api/assembly/${orderId}/confirm`, { method: 'PUT', headers: H(pmToken) });
    d = await r.json().catch(() => ({}));
    check('PUT .../confirm → confirmed', r.status === 200 && d.item && d.item.status === 'confirmed', `status=${r.status} st=${d.item && d.item.status}`);

    // ── 4. field-login сотрудника ──
    let fr = await fetch(BASE + '/api/field/auth/pin-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ employee_id: emp.emp_id, pin: '0000' }) });
    let fd = await fr.json().catch(() => ({}));
    const fieldToken = fd.token;
    check('field pin-login', fr.status === 200 && !!fieldToken, `status=${fr.status} ${fd.error || ''}`);

    // field: моя ведомость видна
    fr = await fetch(BASE + '/api/field/assembly/my', { headers: { Authorization: 'Bearer ' + fieldToken } });
    fd = await fr.json().catch(() => ({}));
    const mine = (fd.items || []).some(x => x.id === orderId);
    check('GET /api/field/assembly/my содержит ведомость', fr.status === 200 && mine, `status=${fr.status} ids=[${(fd.items || []).map(x => x.id).join(',')}]`);

    // ── 5. паллет ──
    fr = await fetch(BASE + `/api/field/assembly/${orderId}/pallets`, { method: 'POST', headers: H(fieldToken), body: JSON.stringify({ label: 'verify' }) });
    fd = await fr.json().catch(() => ({}));
    const palletId = fd.pallet && fd.pallet.id;
    check('POST .../pallets (паллет)', fr.status === 200 && !!palletId, `status=${fr.status} id=${palletId}`);

    // ── 6. положить позицию на паллет + отметить собранной ──
    fr = await fetch(BASE + `/api/field/assembly/${orderId}/items/${i1.id}/pallet`, { method: 'PUT', headers: H(fieldToken), body: JSON.stringify({ pallet_id: palletId }) });
    check('PUT .../items/:id/pallet', fr.status === 200, `status=${fr.status}`);
    fr = await fetch(BASE + `/api/field/assembly/${orderId}/items/${i1.id}/pack`, { method: 'PUT', headers: H(fieldToken), body: JSON.stringify({ packed: true }) });
    fd = await fr.json().catch(() => ({}));
    check('PUT .../items/:id/pack → packed', fr.status === 200 && fd.item && fd.item.packed === true, `status=${fr.status} packed=${fd.item && fd.item.packed}`);

    // ── 7. ФОТО позиции (перенос из legacy) ──
    const form = new FormData();
    form.append('photo', new Blob([PNG], { type: 'image/png' }), 'verify-photo.png');
    fr = await fetch(BASE + `/api/field/assembly/${orderId}/items/${i1.id}/photo`, { method: 'POST', headers: { Authorization: 'Bearer ' + fieldToken }, body: form });
    fd = await fr.json().catch(() => ({}));
    const photoUrl = fd.photo_url;
    check('POST .../items/:id/photo → photo_url', fr.status === 200 && !!photoUrl, `status=${fr.status} url=${photoUrl} ${fd.error || ''}`);
    if (photoUrl) {
      const abs = path.join(UPLOAD_BASE, 'assembly', path.basename(photoUrl));
      const exists = fs.existsSync(abs);
      cleanup.files.push(abs);
      check('файл фото физически в uploads/assembly/', exists, abs);
    }

    // в БД колонки заполнены
    const db2 = await pool.query('SELECT photo_filename, photo_original, photographed_at, photographed_by FROM assembly_items WHERE id=$1', [i1.id]);
    const item2 = db2.rows[0] || {};
    check('assembly_items: photo_filename/original/at/by записаны',
      !!item2.photo_filename && !!item2.photo_original && !!item2.photographed_at && !!item2.photographed_by,
      JSON.stringify(item2));

    // деталь ведомости отдаёт фото + packed (ADMIN — обходит IDOR-guard)
    r = await fetch(BASE + `/api/assembly/${orderId}`, { headers: H(adminToken) });
    d = await r.json().catch(() => ({}));
    const itDetail = (d.items || []).find(x => x.id === i1.id) || {};
    check('GET /api/assembly/:id (ADMIN) отдаёт photo_filename и packed', r.status === 200 && !!itDetail.photo_filename && itDetail.packed === true, `status=${r.status} photo=${itDetail.photo_filename} packed=${itDetail.packed}`);

    // IDOR-guard: посторонний РП не видит чужую сборку (403)
    const own = (await pool.query('SELECT pm_id FROM works WHERE id=$1', [workId])).rows[0]?.pm_id;
    const pmId = (await pool.query("SELECT id FROM users WHERE login='test_pm'")).rows[0]?.id;
    if (own !== pmId) {
      r = await fetch(BASE + `/api/assembly/${orderId}`, { headers: H(pmToken) });
      check('GET /api/assembly/:id (чужой РП) → 403 (IDOR-guard)', r.status === 403, `status=${r.status}`);
    }

    // ── 8. приёмка паллета (field scan-pallet) ──
    const qr = (await pool.query('SELECT qr_uuid FROM assembly_pallets WHERE id=$1', [palletId])).rows[0]?.qr_uuid;
    fr = await fetch(BASE + '/api/field/assembly/scan-pallet', { method: 'POST', headers: H(fieldToken), body: JSON.stringify({ qr_uuid: qr, lat: 55.75, lon: 37.61 }) });
    fd = await fr.json().catch(() => ({}));
    check('POST /api/field/assembly/scan-pallet (приёмка)', fr.status === 200 && fd.pallet && fd.pallet.status === 'received', `status=${fr.status} pallet=${fd.pallet && fd.pallet.status}`);

    // ── 9. legacy ЖИВ (для desktop v2) ──
    r = await fetch(BASE + '/api/field/packing/?work_id=' + workId, { headers: H(pmToken) });
    d = await r.json().catch(() => ({}));
    check('legacy /api/field/packing/?work_id (v2) отвечает 200', r.status === 200 && Array.isArray(d.lists), `status=${r.status} lists=${d.lists && d.lists.length}`);
    fr = await fetch(BASE + '/api/field/packing/my', { headers: { Authorization: 'Bearer ' + fieldToken } });
    check('legacy /api/field/packing/my (field) отвечает 200', fr.status === 200, `status=${fr.status}`);

    // ── 10. миграция V357 ──
    const cols = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='assembly_items' AND column_name LIKE 'photo%' OR (table_name='assembly_items' AND column_name='photographed_at')`);
    check('миграция V357: колонки фото в assembly_items', cols.rows.length === 4, cols.rows.map(x => x.column_name).join(','));

    // ── 11. vanilla-файл ──
    const ftPath = path.join('public', 'assets', 'js', 'field-tab.js');
    const ft = fs.readFileSync(ftPath, 'utf8');
    check('vanilla field-tab.js: нет /api/field/packing', !ft.includes('/api/field/packing'), '');
    check('vanilla field-tab.js: есть /api/assembly', ft.includes("'/api/assembly'"), '');

  } catch (e) {
    check('НЕОЖИДАННАЯ ОШИБКА', false, e.message);
  } finally {
    // ── cleanup ──
    try {
      if (cleanup.orderId) {
        await pool.query('DELETE FROM assembly_items WHERE assembly_id=$1', [cleanup.orderId]);
        await pool.query('DELETE FROM assembly_pallets WHERE assembly_id=$1', [cleanup.orderId]);
        await pool.query('DELETE FROM assembly_orders WHERE id=$1', [cleanup.orderId]);
      }
      for (const f of cleanup.files) { try { fs.unlinkSync(f); } catch (_) {} }
    } catch (e) { console.log('cleanup warn:', e.message); }
    await pool.end().catch(() => {});
  }

  console.log('\n===================================================');
  console.log(`  ИТОГ: ${pass} PASS / ${fail} FAIL`);
  console.log('===================================================');
  process.exit(fail > 0 ? 1 : 0);
})();
