#!/usr/bin/env node
'use strict';
/**
 * Дописывает человеческие названия категорий и методов в уже сохранённые
 * позиции ДВ (report_json.dv_positions).
 *
 * Зачем: позиции разобраны до того, как в нормализатор добавили category_name
 * и method_name, поэтому в таблицах видны служебные коды `vessels.clean`.
 * Здесь берём название из справочника work_norm_categories (title категории и
 * label метода) и обновляем карточку. Коды не трогаем: они нужны калькулятору.
 *
 *   node tools/prod-enrich-dv-names.js --dry
 *   node tools/prod-enrich-dv-names.js
 */
require('dotenv').config();
const { Client } = require('pg');
const jwt = require('jsonwebtoken');

const DRY = process.argv.includes('--dry');
const API = 'http://127.0.0.1:3000';

(async () => {
  const db = new Client({
    host: 'localhost', port: 5432, user: 'asgard',
    password: '123456789', database: process.env.DB_NAME || 'asgard_crm'
  });
  await db.connect();

  const { rows: cats } = await db.query(
    'SELECT code, title, methods_json FROM work_norm_categories'
  );
  const byCode = new Map(cats.map((c) => [c.code, c]));

  const { rows: users } = await db.query(
    "SELECT id, login, role, name FROM users WHERE login='n.androsov'"
  );
  await db.end();
  const u = users[0];
  if (!u) throw new Error('нет пользователя n.androsov');
  const tk = jwt.sign(
    { id: u.id, login: u.login, role: u.role, name: u.name },
    process.env.JWT_SECRET || 'asgard-secret',
    { expiresIn: '2h' }
  );

  const db2 = new Client({
    host: 'localhost', port: 5432, user: 'asgard',
    password: '123456789', database: process.env.DB_NAME || 'asgard_crm'
  });
  await db2.connect();
  const { rows: reviews } = await db2.query(`
    SELECT tender_id, report_json
      FROM tender_rp_reviews
     WHERE jsonb_array_length(COALESCE(report_json->'dv_positions','[]'::jsonb)) > 0
  `);
  await db2.end();

  let updated = 0;
  let skipped = 0;

  for (const rev of reviews) {
    const rj = typeof rev.report_json === 'string' ? JSON.parse(rev.report_json) : rev.report_json;
    let touched = false;

    rj.dv_positions = (rj.dv_positions || []).map((p) => {
      const cat = p.category_code ? byCode.get(p.category_code) : null;
      const next = Object.assign({}, p);
      if (cat && !next.category_name) { next.category_name = cat.title || null; touched = true; }
      if (cat && next.method_code && !next.method_name) {
        const m = (Array.isArray(cat.methods_json) ? cat.methods_json : [])
          .find((x) => x && x.code === next.method_code);
        if (m) { next.method_name = m.label || m.name || null; touched = true; }
      }
      return next;
    });

    if (!touched) { skipped += 1; continue; }

    if (DRY) {
      const sample = rj.dv_positions[0];
      console.log(`#${rev.tender_id} → ${sample.category_name || '—'} · ${sample.method_name || '—'}`);
      updated += 1;
      continue;
    }

    const put = await fetch(`${API}/api/tenders/${rev.tender_id}/rp-review`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk },
      body: JSON.stringify({ report_json: rj })
    });
    if (put.ok) {
      updated += 1;
      const s = rj.dv_positions[0];
      console.log(`#${rev.tender_id} ✓ ${s.category_name || '—'} · ${s.method_name || '—'}`);
    } else {
      console.log(`#${rev.tender_id} ✗ ${put.status} ${(await put.text()).slice(0, 100)}`);
    }
  }

  console.log(`\nитог: ${updated} обновлено, ${skipped} без изменений${DRY ? ' (dry)' : ''}`);
})();
