'use strict';
/**
 * D-240: дочистка карточек договоров, созданных импортом.
 *  - слияние дублей (одинаковый номер + поставщик): переносим документы, лишние карточки удаляем;
 *  - заполняем «Предмет» из названий работ связанных документов;
 *  - статус/тип/валюта приводим к рабочему виду.
 * Трогаем только карточки импорта (comment LIKE '%D-239%'). DRY по умолчанию.
 */
const fs = require('fs');
const { Pool } = require('pg');
require('dotenv').config({ path: '/var/www/asgard-crm/.env' });
const APPLY = process.env.APPLY === '1';
const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'asgard', password: String(process.env.DB_PASSWORD || '123456789'),
  database: process.env.DB_NAME || 'asgard_crm'
});
const q = (t, p) => pool.query(t, p);
const N = (v) => Number(v || 0);
const report = { apply: APPLY, merges: [], subjects: 0 };

async function secMerge() {
  const groups = (await q(`
    SELECT regexp_replace(lower(c.number),'[^a-zа-я0-9]','','g') k, c.counterparty_name,
           array_agg(c.id ORDER BY (SELECT count(*) FROM doc_registry d WHERE d.deleted_at IS NULL AND d.contract_id=c.id) DESC, c.id) ids
    FROM contracts c
    WHERE c.comment LIKE '%D-239%' AND c.number IS NOT NULL
    GROUP BY 1,2 HAVING count(*)>1`)).rows;
  for (const g of groups) {
    const ids = g.ids.map(Number);
    const keep = ids[0];
    const drop = ids.slice(1);
    const moved = (await q('SELECT count(*)::int n FROM doc_registry WHERE deleted_at IS NULL AND contract_id = ANY($1::int[])', [drop])).rows[0].n;
    report.merges.push({ keep, drop, number: g.k, supplier: g.counterparty_name, move_docs: moved });
    if (!APPLY) continue;
    await q('UPDATE doc_registry SET contract_id=$1, updated_at=NOW() WHERE contract_id = ANY($2::int[])', [keep, drop]);
    await q(`DELETE FROM contracts WHERE id = ANY($1::int[]) AND comment LIKE '%D-239%'`, [drop]);
  }
}

async function secSubjects() {
  const cards = (await q(`
    SELECT c.id, count(d.id)::int docs,
           (SELECT string_agg(DISTINCT COALESCE(w.work_title,w.object_name), '; ')
              FROM doc_registry d2 LEFT JOIN works w ON w.id=d2.work_id
             WHERE d2.contract_id=c.id AND d2.deleted_at IS NULL AND COALESCE(w.work_title,w.object_name) IS NOT NULL) titles
    FROM contracts c LEFT JOIN doc_registry d ON d.contract_id=c.id AND d.deleted_at IS NULL
    WHERE c.comment LIKE '%D-239%' AND COALESCE(TRIM(c.subject),'')=''
    GROUP BY c.id`)).rows;
  report.subjects = cards.length;
  if (!APPLY) return;
  for (const c of cards) {
    const subj = c.titles ? String(c.titles).slice(0, 300) : 'Договор по счетам (импорт из реестра)';
    await q('UPDATE contracts SET subject=$1, updated_at=NOW() WHERE id=$2', [subj, c.id]);
  }
}

(async () => {
  await secMerge();
  await secSubjects();
  fs.writeFileSync('/tmp/dh-audit/contracts-merge.json', JSON.stringify(report, null, 1));
  console.log(JSON.stringify({ apply: report.apply, merge_groups: report.merges.length, merged_cards_removed: report.merges.reduce((s, m) => s + m.drop.length, 0), move_docs: report.merges.reduce((s, m) => s + m.move_docs, 0), subjects_filled: report.subjects }, null, 1));
  for (const m of report.merges) console.log('  merge', m.number, '|', m.supplier, '| keep', m.keep, 'drop', JSON.stringify(m.drop), 'docs', m.move_docs);
  await pool.end();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
