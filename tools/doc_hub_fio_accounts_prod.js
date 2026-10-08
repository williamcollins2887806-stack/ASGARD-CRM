'use strict';
/**
 * Create Zuban PM + AGPZ office manager; remap doc_registry from /tmp/doc-hub-fio-remap.json
 * Usage: node tools/doc_hub_fio_accounts_prod.js --zuban-pass X --agpz-pass Y
 */
require('dotenv').config({ path: '/var/www/asgard-crm/.env' });
const fs = require('fs');
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : def;
}

(async () => {
  const c = new Client({
    host: process.env.DB_HOST || '127.0.0.1',
    database: process.env.DB_NAME || 'asgard_crm',
    user: process.env.DB_USER || 'asgard',
    password: process.env.DB_PASSWORD || '123456789'
  });
  await c.connect();

  const zubanPass = arg('zuban-pass');
  const agpzPass = arg('agpz-pass');
  if (!zubanPass || !agpzPass) throw new Error('need --zuban-pass and --agpz-pass');

  async function upsertUser({ login, email, name, role, password, phone }) {
    const hash = await bcrypt.hash(password, 10);
    const found = await c.query(
      `SELECT id FROM users WHERE lower(login)=lower($1) OR lower(COALESCE(email,''))=lower($2) LIMIT 1`,
      [login, email]
    );
    if (found.rows[0]) {
      const { rows } = await c.query(
        `UPDATE users SET
           login=$2, name=$3, role=$4, email=$5, phone=COALESCE($6, phone),
           password_hash=$7, is_active=true, is_blocked=false, updated_at=NOW()
         WHERE id=$1
         RETURNING id, login, name, role, email, is_active`,
        [found.rows[0].id, login, name, role, email, phone || null, hash]
      );
      return { action: 'updated', user: rows[0] };
    }
    const { rows } = await c.query(
      `INSERT INTO users (login, password_hash, name, email, role, phone, is_active, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,true,NOW(),NOW())
       RETURNING id, login, name, role, email, is_active`,
      [login, hash, name, email, role, phone || null]
    );
    return { action: 'created', user: rows[0] };
  }

  const zuban = await upsertUser({
    login: 'r.zuban',
    email: 'r.zuban@asgard-service.com',
    name: 'Зубань Руслан Владимирович',
    role: 'PM',
    password: zubanPass,
    phone: '79220717233'
  });

  const agpz = await upsertUser({
    login: 'agpz',
    email: 'agpz@asgard-service.com',
    name: 'АГПЗ (офис)',
    role: 'OFFICE_MANAGER',
    password: agpzPass,
    phone: null
  });

  const pant = (await c.query(
    `SELECT id, name, role FROM users WHERE id=3468 OR lower(login)='a.pantuzenko' ORDER BY id LIMIT 1`
  )).rows[0];
  const tuma = (await c.query(
    `SELECT id, name, role FROM users WHERE id=3471 OR lower(login)='office' ORDER BY id LIMIT 1`
  )).rows[0];

  const links = [];
  for (const [empId, userId, note] of [
    [10174, zuban.user.id, 'Зубань→r.zuban'],
    [278, agpz.user.id, 'Сатубалдиева→agpz'],
    [9909, agpz.user.id, 'Пираев→agpz'],
    [193, agpz.user.id, 'Михайлушкин→agpz']
  ]) {
    const r = await c.query(
      `UPDATE employees SET user_id=$2, updated_at=NOW() WHERE id=$1 RETURNING id, fio, user_id`,
      [empId, userId]
    );
    links.push({ note, row: r.rows[0] || null });
  }

  let remap = { matched: 0, updated_owner: 0, updated_pm: 0, samples: [] };
  const mapPath = '/tmp/doc-hub-fio-remap.json';
  if (fs.existsSync(mapPath)) {
    const payload = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
    for (const row of payload.rows || []) {
      if (!row.invoice_number || !row.invoice_date) continue;
      const params = [
        row.doc_owner_id || null,
        row.work_pm_id || null,
        String(row.invoice_number || '').trim().toLowerCase(),
        String(row.counterparty_name || '').trim().toLowerCase(),
        row.invoice_date,
        Number(row.amount_gross)
      ];
      const q = await c.query(
        `UPDATE doc_registry d SET
           doc_owner_id = CASE WHEN $1::int IS NULL THEN d.doc_owner_id ELSE $1 END,
           pm_id = CASE WHEN $2::int IS NULL THEN d.pm_id ELSE $2 END,
           updated_at = NOW()
         WHERE d.deleted_at IS NULL
           AND lower(trim(COALESCE(d.invoice_number,''))) = $3
           AND lower(trim(COALESCE(d.counterparty_name,''))) = $4
           AND d.invoice_date = $5::date
           AND d.amount_gross = $6
         RETURNING d.id, d.invoice_number, d.doc_owner_id, d.pm_id`,
        params
      );
      if (q.rowCount) {
        remap.matched += q.rowCount;
        if (row.doc_owner_id) remap.updated_owner += q.rowCount;
        if (row.work_pm_id) remap.updated_pm += q.rowCount;
        if (remap.samples.length < 20) remap.samples.push(q.rows[0]);
      }
    }
  }

  const counts = await c.query(
    `SELECT
       COUNT(*) FILTER (WHERE doc_owner_id=$1) AS agpz_owner,
       COUNT(*) FILTER (WHERE pm_id=$1) AS agpz_pm,
       COUNT(*) FILTER (WHERE doc_owner_id=$2 OR pm_id=$2) AS zuban_docs,
       COUNT(*) FILTER (WHERE doc_owner_id=$3) AS tuma_owner,
       COUNT(*) FILTER (WHERE pm_id=$4) AS pant_pm
     FROM doc_registry WHERE deleted_at IS NULL`,
    [agpz.user.id, zuban.user.id, tuma.id, pant.id]
  );

  process.stdout.write(JSON.stringify({
    zuban, agpz, pantuzhenko: pant, tumaeva: tuma, employee_links: links, remap, counts: counts.rows[0]
  }, null, 2));
  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });
