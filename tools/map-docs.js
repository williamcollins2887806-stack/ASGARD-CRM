'use strict';
/**
 * Сопоставление файлов из папки «Документы» с тендерами очереди.
 *
 * Задача: понять, что куда грузить, ДО загрузки. Ничего не пишет.
 * Сопоставление идёт по трём признакам:
 *   1) номер закупки в имени файла (8 цифр) — самый надёжный;
 *   2) ключевые слова предмета закупки;
 *   3) содержимое: у архивов смотрим имена файлов внутри.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Client } = require('pg');
const arch = require('../src/services/archiveExtractor');

const DIR = process.env.DOCS_DIR || 'C:\\Users\\Nikita-ASGARD\\Desktop\\Документы';

function walk(dir, depth) {
  if (depth > 1) return [];
  let out = [];
  let items = [];
  try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return []; }
  for (const it of items) {
    const full = path.join(dir, it.name);
    if (it.isDirectory()) { out = out.concat(walk(full, depth + 1)); continue; }
    let size = 0;
    try { size = fs.statSync(full).size; } catch (_) {}
    out.push({ name: it.name, full, size });
  }
  return out;
}

/** Ключевые слова предмета закупки. */
function keywords(title) {
  const t = String(title || '').toLowerCase();
  const words = [];
  const rules = [
    [/промыв|промывк/, 'промыв'],
    [/зачистк|очистк|чистк/, 'чистк'],
    [/теплообменник/, 'теплообмен'],
    [/котл/, 'котл'],
    [/трубопровод|трубопр/, 'трубопровод'],
    [/градирн/, 'градирн'],
    [/скважин/, 'скважин'],
    [/теплоносител/, 'теплоносител'],
    [/сварк|сварочн|монтаж/, 'сварк'],
    [/теплоизоляц|изоляц/, 'изоляц'],
    [/резервуар|ёмкост|емкост|бак/, 'резервуар'],
    [/канализац|приямк/, 'канализац'],
    [/поверхност/, 'поверхност'],
    [/полимер/, 'полимер']
  ];
  for (const [re, w] of rules) if (re.test(t)) words.push(w);
  return words;
}

(async () => {
  const db = new Client({ host: 'localhost', port: 5432, user: 'asgard', password: '123456789', database: process.env.DB_NAME || 'asgard_crm' });
  await db.connect();

  const { rows: queue } = await db.query(`
    SELECT t.id, t.tender_title,
           (SELECT COUNT(*) FROM documents d WHERE d.tender_id = t.id) docs,
           (SELECT string_agg(COALESCE(d.original_name,''), ' ~~ ') FROM documents d WHERE d.tender_id = t.id) docnames
      FROM tenders t
      LEFT JOIN tender_rp_reviews rev ON rev.tender_id = t.id
     WHERE t.deleted_at IS NULL AND t.registry_status = 'рассмотрение'
       AND (rev.is_final IS NULL OR rev.is_final = false)
       AND rev.analysis_finalized_at IS NULL
       AND COALESCE(t.calculator_kind,'') != 'to'
       AND COALESCE(t.source,'') <> 'phone_call'
     ORDER BY t.id`);

  const files = walk(DIR, 0).sort((a, b) => b.size - a.size);

  // Собираем имена внутри архивов (там часто видно, к чему относится).
  console.log('распаковываю архивы для просмотра содержимого…');
  const enriched = [];
  for (const f of files) {
    const isArch = /\.(zip|7z|rar)$/i.test(f.name);
    let inner = [];
    if (isArch) {
      const out = fs.mkdtempSync(path.join(os.tmpdir(), 'map-'));
      try {
        const r = await arch.extractArchive(f.full, f.name, out, { recursive: true });
        if (r.ok) inner = r.files.map((x) => x.relPath);
      } catch (_) {}
      try { fs.rmSync(out, { recursive: true, force: true }); } catch (_) {}
    }
    enriched.push({ name: f.name, size: f.size, isArch, inner });
  }

  console.log(`\nфайлов: ${files.length}, архивов: ${enriched.filter((x) => x.isArch).length}\n`);
  console.log('════════ Сопоставление ════════\n');

  const matched = new Map();
  for (const f of enriched) {
    const haystack = (f.name + ' ' + f.inner.join(' ')).toLowerCase();
    const cands = [];
    for (const t of queue) {
      const kws = keywords(t.tender_title);
      if (!kws.length) continue;
      const hits = kws.filter((k) => haystack.includes(k));
      if (!hits.length) continue;
      // Номер закупки в имени — сильный признак.
      const numMatch = /(\d{8})/.exec(f.name);
      const strong = !!numMatch;
      cands.push({ id: t.id, title: String(t.tender_title).slice(0, 55), hits, strong });
    }
    if (cands.length) {
      cands.sort((a, b) => (b.hits.length - a.hits.length));
      matched.set(f.name, cands[0]);
      console.log(`${f.name.slice(0, 62)}`);
      console.log(`   → #${cands[0].id} ${cands[0].title}`);
      console.log(`     совпало: ${cands[0].hits.join(', ')}${cands.length > 1 ? ' | ещё: ' + cands.slice(1, 3).map((c) => '#' + c.id).join(', ') : ''}`);
    }
  }

  console.log('\n════════ Не сопоставлено ════════');
  enriched.filter((f) => !matched.has(f.name)).forEach((f) => {
    console.log(`  ${Math.round(f.size / 1024).toString().padStart(6)} КБ — ${f.name.slice(0, 65)}`);
  });

  console.log('\n════════ Документы в тендерах ════════');
  queue.forEach((t) => console.log(`  #${t.id} док ${String(t.docs).padStart(2)} — ${String(t.tender_title).slice(0, 50)}`));

  await db.end();
})().catch((e) => console.log('ОШИБКА:', e.message));
