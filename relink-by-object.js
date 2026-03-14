/**
 * Re-link expenses to works using original object names from expense_data.json
 */
const { Client } = require('pg');
const expenseData = require('./expense_data.json');

const DB = { host: 'localhost', port: 5432, database: 'asgard_crm', user: 'asgard', password: '123456789' };

const ALIASES = {
  'агпз': ['агхк', 'амурский'],
  'амурский гхк': ['агхк', 'амурский'],
  'агхк-гкк': ['агхк'],
  'гнш ремонт огн подогр.': ['приразломная - подогреватели', 'огневой подогреватель'],
  'огневой подогреватель': ['приразломная - подогреватели'],
  'гнш ремонт': ['приразломная - подогреватели'],
  'приразломная, чистка танков и каусорб': ['приразломная 2026', 'приразломная 2019'],
  'приразломная, чистка даэратора': ['приразломная - деаэратор'],
  'приразломная, чистка танков': ['приразломная 2026', 'приразломная 2019'],
  'млсп': ['приразломная'],
  'г выкса': ['выкса - турки', 'выкса'],
  'обезжир кислородоропровода ао умм-2': ['черномортранснефть'],
  'скруббер': ['перекись'],
  'замена гликоля, млсп': ['замена гликоля'],
  'пуровский зпк': ['пуровский'],
  'екатеринбург': ['екатеринбург'],
  'ип бараташвили': ['бараташвили'],
  'исток, фрязино': ['исток'],
  'спбгмту, "мангуст"': ['мангуст'],
  'спбгу мангуст': ['мангуст'],
};

const SKIP = new Set([
  'офис', 'склад', 'склад королёв', 'склад мурманск',
  'склад тест химии', 'склад, наше авто', 'обслуживание то',
  'кудряшов о. с.', 'кудряшов о.с.', 'сро выписка',
  'на тендер', 'водитель', 'свг', 'для отг', 'эб комиссия',
  'wam-exp', 'обучение босиет', 'лицензия на утилизацию',
]);

const norm = s => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');

async function main() {
  const client = new Client(DB);
  await client.connect();

  const { rows: works } = await client.query('SELECT id, work_title, customer_name FROM works');

  // Build import_hash → object mapping
  const hashToObject = {};
  for (const exp of expenseData) {
    const hash = `expreg_${exp.rowIndex}_${exp.invoiceNum}_${exp.amount}`;
    hashToObject[hash] = norm(exp.object);
  }

  const { rows: unlinked } = await client.query(
    'SELECT id, import_hash FROM work_expenses WHERE work_id IS NULL AND import_hash IS NOT NULL'
  );
  console.log('Unlinked expenses with hash:', unlinked.length);

  function findWork(objectName) {
    const obj = norm(objectName);
    if (!obj || SKIP.has(obj)) return null;

    const searchTerms = [obj];
    for (const [alias, targets] of Object.entries(ALIASES)) {
      if (obj.includes(alias) || alias.includes(obj)) {
        searchTerms.push(...targets);
        break;
      }
    }

    for (const term of searchTerms) {
      let m = works.find(w => norm(w.work_title) === term);
      if (m) return m.id;

      m = works.find(w => {
        const t = norm(w.work_title);
        return t && term && (t.includes(term) || term.includes(t));
      });
      if (m) return m.id;

      const words = term.split(/[\s,;.()]+/).filter(w => w.length > 3);
      if (words.length > 0) {
        m = works.find(w => {
          const t = norm(w.work_title);
          return words.some(word => t.includes(word));
        });
        if (m) return m.id;
      }
    }
    return null;
  }

  let linked = 0, skipped = 0, notFound = 0;
  const unmatched = {};

  for (const exp of unlinked) {
    const obj = hashToObject[exp.import_hash];
    if (!obj) continue;
    if (SKIP.has(obj)) { skipped++; continue; }

    const workId = findWork(obj);
    if (workId) {
      await client.query('UPDATE work_expenses SET work_id = $1 WHERE id = $2', [workId, exp.id]);
      linked++;
    } else {
      unmatched[obj] = (unmatched[obj] || 0) + 1;
      notFound++;
    }
  }

  console.log(`\nLinked: ${linked}, Skipped (office/overhead): ${skipped}, Not found: ${notFound}`);

  if (Object.keys(unmatched).length > 0) {
    console.log('\nUnmatched objects:');
    Object.entries(unmatched).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
  }

  // Update cost_fact
  const { rowCount } = await client.query(`
    UPDATE works SET cost_fact = sub.total
    FROM (SELECT work_id, round(SUM(amount)::numeric, 2) as total
          FROM work_expenses WHERE work_id IS NOT NULL GROUP BY work_id) sub
    WHERE works.id = sub.work_id
  `);
  console.log(`\nUpdated cost_fact for ${rowCount} works`);

  // Stats
  const { rows: [s] } = await client.query(`
    SELECT count(*) as total, count(work_id) as linked, count(*) - count(work_id) as unlinked,
      round(sum(amount)::numeric, 2) as total_amt,
      round(sum(CASE WHEN work_id IS NOT NULL THEN amount ELSE 0 END)::numeric, 2) as linked_amt
    FROM work_expenses
  `);
  console.log(`\nFinal: total=${s.total}, linked=${s.linked}, unlinked=${s.unlinked}`);
  console.log(`Amount: total=${s.total_amt}, linked=${s.linked_amt}`);

  await client.end();
}
main().catch(e => { console.error(e); process.exit(1); });
