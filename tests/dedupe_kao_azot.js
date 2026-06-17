/**
 * Dedup: сматчить мои 126 кандидатов из журнала с уже существующими в CRM
 * (work_id=11), показать что новое / что дубль.
 *
 * Правило мэтча: amount совпадает (±10 ₽) И date в пределах ±3 дней.
 * При совпадении считаем что это та же операция, просто в разных колонках
 * категоризации (на проде категории — materials/tickets/accommodation/other/cash,
 * в моём журнале — cash+subcategory или subcontract).
 */
const fs = require('fs');
const ExcelJS = require('exceljs');

const PROD_CSV = 'C:/Users/Nikita-ASGARD/Downloads/prod_we.csv';
const JOURNAL = String.raw`C:\Users\Nikita-ASGARD\Downloads\КАО Азот Финотчёт СВОДНЫЙ на 04.06.2026.xlsx`;

function loadProd() {
  const txt = fs.readFileSync(PROD_CSV, 'utf8').trim().split('\n');
  txt.shift(); // header
  const rows = [];
  for (const ln of txt) {
    // Очень простой CSV parser — поля без точек с запятой внутри.
    const parts = ln.split(';');
    if (parts.length < 8) continue;
    const [id, date, category, amount, sup, ...rest] = parts;
    // description могла содержать ;
    const lastTwo = rest.slice(-2); // source_table, payment_method
    const description = rest.slice(0, -2).join(';');
    rows.push({
      id: Number(id),
      date,
      category,
      amount: parseFloat(amount),
      supplier: String(sup || '').replace(/^"|"$/g, ''),
      description: String(description || '').replace(/^"|"$/g, ''),
      source_table: lastTwo[0],
      payment_method: lastTwo[1],
      matched: false,
    });
  }
  return rows;
}

async function loadJournalCandidates() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(JOURNAL);
  const ws = wb.getWorksheet('Журнал');
  const rows = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const a = [];
    row.eachCell({ includeEmpty: true }, (c) => {
      let v = c.value;
      if (v && typeof v === 'object' && 'text' in v) v = v.text;
      if (v && typeof v === 'object' && 'result' in v) v = v.result;
      a.push(v == null ? null : v);
    });
    rows.push(a);
  });

  let hdr = -1;
  for (let i = 0; i < rows.length; i++) if (rows[i] && rows[i][0] === '№') { hdr = i; break; }
  const data = rows.slice(hdr + 1);

  const SKIP_CATS = new Set([
    'Выплаты бригаде', 'Получено от самозанятого', 'Пополнение через ReStaff',
    'Взнос личных средств', 'Возврат личных средств',
  ]);
  const parseDate = (s) => {
    if (!s) return null;
    if (s instanceof Date) return s.toISOString().slice(0, 10);
    const m = String(s).match(/^(\d{2})\.(\d{2})\.(\d{4})/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  };

  const cands = [];
  for (const row of data) {
    if (!row || !row[0]) continue;
    const num = row[0];
    const typ = String(row[2] || '');
    if (!typ.includes('РАСХОД')) continue;
    const cat = String(row[4] || '');
    if (SKIP_CATS.has(cat)) continue;
    const recip = String(row[5] || '');
    const desc = String(row[6] || '');
    if (recip.toLowerCase().includes('андросов') &&
        (desc.toLowerCase().includes('crm') || desc.toLowerCase().includes('возврат') || desc.toLowerCase().includes('вложен'))) continue;
    const amount = Math.abs(Number(row[3]) || 0);
    if (amount <= 0) continue;
    cands.push({
      num, date: parseDate(row[1]),
      category: cat, recipient: recip, description: desc,
      amount, matched_with: null,
    });
  }
  return cands;
}

function dateDiffDays(a, b) {
  if (!a || !b) return 999;
  const da = new Date(a), db = new Date(b);
  if (isNaN(da) || isNaN(db)) return 999;
  return Math.abs((da - db) / 86400000);
}

(async () => {
  const prod = loadProd();
  const cands = await loadJournalCandidates();
  console.log(`Prod records: ${prod.length}`);
  console.log(`Journal candidates: ${cands.length}`);

  let matched = 0, newCount = 0;
  const matches = [];
  const newOnes = [];

  for (const c of cands) {
    // Ищем match: amount ±10 ₽ и date ±3 дня
    let best = null, bestDiff = Infinity;
    for (const p of prod) {
      if (p.matched) continue;
      if (Math.abs(p.amount - c.amount) > 10) continue;
      const dd = dateDiffDays(p.date, c.date);
      if (dd > 3) continue;
      // приоритет — точное совпадение даты, потом ближайшая
      if (dd < bestDiff) { best = p; bestDiff = dd; }
    }
    if (best) {
      best.matched = true;
      c.matched_with = best;
      matched++;
      matches.push({ c, p: best });
    } else {
      newCount++;
      newOnes.push(c);
    }
  }

  console.log();
  console.log(`Дубли (matched): ${matched}, на сумму ${matches.reduce((s,m)=>s+m.c.amount,0).toLocaleString('ru-RU')} ₽`);
  console.log(`Новые (insert): ${newCount}, на сумму ${newOnes.reduce((s,n)=>s+n.amount,0).toLocaleString('ru-RU')} ₽`);

  // Сохранить новые в файл, чтобы потом залить SQL'ом
  fs.writeFileSync('C:/Users/Nikita-ASGARD/Downloads/new_inserts.json', JSON.stringify(newOnes, null, 2));
  console.log(`\nСохранено в /tmp/new_inserts.json: ${newOnes.length} строк`);

  console.log('\n=== Разбивка новых по category из журнала ===');
  const byCat = {};
  for (const n of newOnes) {
    byCat[n.category] = (byCat[n.category] || { c: 0, t: 0 });
    byCat[n.category].c++;
    byCat[n.category].t += n.amount;
  }
  for (const k of Object.keys(byCat).sort()) {
    console.log(`  ${k.padEnd(28)} ${String(byCat[k].c).padStart(4)}  ${byCat[k].t.toLocaleString('ru-RU').padStart(12)} ₽`);
  }

  console.log('\n=== Примеры мэтчей (первые 10) ===');
  for (const m of matches.slice(0, 10)) {
    console.log(`  ✓ Журнал #${m.c.num} ${m.c.date} ${m.c.amount} (${m.c.recipient.substring(0,20)}) ↔ Прод #${m.p.id} ${m.p.date} ${m.p.amount} [${m.p.category}] ${m.p.description.substring(0,40)}`);
  }

  console.log('\n=== Примеры новых (первые 10) ===');
  for (const n of newOnes.slice(0, 10)) {
    console.log(`  + #${n.num} ${n.date} ${n.amount.toLocaleString('ru-RU')} ₽ [${n.category}] ${n.recipient.substring(0,25)} | ${n.description.substring(0,40)}`);
  }
})();
