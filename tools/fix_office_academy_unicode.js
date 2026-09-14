#!/usr/bin/env node
'use strict';
const { Client } = require('pg');

function decodeUnicodeEscapes(str) {
  if (typeof str !== 'string') return str;
  if (!/\\u[0-9a-fA-F]{4}/i.test(str)) return str;
  // Decode literal \uXXXX (incl. surrogate pairs for emoji)
  let out = str.replace(/\\u([0-9a-fA-F]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  // Drop orphan unpaired surrogates left by truncated emoji
  out = out.replace(/[\uD800-\uDFFF]/g, '');
  return out;
}

function deepDecode(val) {
  if (typeof val === 'string') return decodeUnicodeEscapes(val);
  if (Array.isArray(val)) return val.map(deepDecode);
  if (val && typeof val === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(val)) out[k] = deepDecode(v);
    return out;
  }
  return val;
}

async function main() {
  const c = new Client({
    host: process.env.PGHOST || '127.0.0.1',
    user: process.env.PGUSER || 'asgard',
    password: process.env.PGPASSWORD || '123456789',
    database: process.env.PGDATABASE || 'asgard_crm',
  });
  await c.connect();

  const lessons = await c.query(`
    SELECT id, title, saga, cover_icon, blocks::text AS blocks_raw, status
    FROM office_academy_lessons
    ORDER BY id
  `);

  let fixedTitles = 0, fixedBlocks = 0, stubs = [];
  for (const row of lessons.rows) {
    const titleFixed = decodeUnicodeEscapes(row.title);
    const sagaFixed = decodeUnicodeEscapes(row.saga);
    const iconFixed = decodeUnicodeEscapes(row.cover_icon);

    let blocks;
    try { blocks = JSON.parse(row.blocks_raw); } catch { blocks = row.blocks_raw; }
    const blocksFixed = deepDecode(blocks);
    const blocksJson = JSON.stringify(blocksFixed);

    const titleChanged = titleFixed !== row.title;
    const sagaChanged = sagaFixed !== row.saga;
    const iconChanged = iconFixed !== row.cover_icon;
    const blocksChanged = blocksJson !== row.blocks_raw && blocksJson !== JSON.stringify(JSON.parse(row.blocks_raw));

    // detect stub placeholders
    const isStub = /Месяц \d+$/i.test(titleFixed) || /Урок готовится/i.test(blocksJson);

    if (titleChanged || sagaChanged || iconChanged || blocksChanged) {
      await c.query(`
        UPDATE office_academy_lessons
        SET title = $1, saga = $2, cover_icon = $3, blocks = $4::jsonb
        WHERE id = $5
      `, [titleFixed, sagaFixed, iconFixed, blocksJson, row.id]);
      if (titleChanged) fixedTitles++;
      if (blocksChanged) fixedBlocks++;
      console.log(`FIXED #${row.id}: ${titleFixed.slice(0, 60)}`);
    } else {
      console.log(`OK #${row.id} [${row.status}]: ${String(titleFixed).slice(0, 60)}`);
    }
    if (isStub) stubs.push({ id: row.id, title: titleFixed, status: row.status });
  }

  // quiz questions
  const qs = await c.query(`SELECT id, question_text, options::text AS options_raw, correct_explanation FROM office_academy_quiz_questions`);
  let fixedQ = 0;
  for (const q of qs.rows) {
    const qt = decodeUnicodeEscapes(q.question_text);
    const ce = decodeUnicodeEscapes(q.correct_explanation);
    let opts;
    try { opts = JSON.parse(q.options_raw); } catch { opts = []; }
    const optsFixed = deepDecode(opts);
    const optsJson = JSON.stringify(optsFixed);
    if (qt !== q.question_text || ce !== q.correct_explanation || optsJson !== q.options_raw) {
      await c.query(`
        UPDATE office_academy_quiz_questions
        SET question_text = $1, options = $2::jsonb, correct_explanation = $3
        WHERE id = $4
      `, [qt, optsJson, ce, q.id]);
      fixedQ++;
    }
  }

  const status = await c.query(`SELECT status, count(*)::int AS n FROM office_academy_lessons GROUP BY status ORDER BY status`);
  console.log('\nSTATUS:', status.rows);
  console.log('STUBS:', stubs);
  console.log(`Done. titles=${fixedTitles} blocks=${fixedBlocks} quiz=${fixedQ}`);
  await c.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
