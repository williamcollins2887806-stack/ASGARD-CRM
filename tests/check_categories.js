const data = require('./expense_data.json');
const GENERAL_KEYS = ['офис','склад','сертификаты','удостоверения','мед осмотр','медосмотр','обучение','допуски','страховка','автомобиль','транспорт','аренда','связь','фот','прочее'];
const ALIAS_KEYS = ['агпз','амурский гхк','амурский газохимический','амурский гпз','агхк-гкк','выкса','огневой подогреватель','скруббер','обслуживание то','приразломная, чистка даэратора','приразломная, чистка танков и каусорб','обезжир кислородоропровода ао умм-2','волжская перекись водорода','као азот','новатэк','печорская грэс','астрахань','гагаринконсервмолоко','черномортранснефть','титан аэс','млсп','фрегат','калининград','лукойл-инжиниринг','гнш ремонт огн подогр.','гнш ремонт огн подогр','гнш ремонт'];

const byObj = {};
for (const e of data) {
  const obj = (e.object || '').trim().toLowerCase();
  const isGeneral = GENERAL_KEYS.some(k => obj === k || obj.startsWith(k));
  const isAliased = ALIAS_KEYS.includes(obj);
  if (isGeneral || isAliased) continue;
  if (!byObj[obj]) byObj[obj] = {count:0, total:0, sample:e.object};
  byObj[obj].count++;
  byObj[obj].total += (parseFloat(String(e.amount).replace(/[\s,]/g,'')) || 0);
}
const sorted = Object.entries(byObj).sort((a,b) => b[1].count - a[1].count);
console.log('Objects NOT matching general or alias patterns:');
for (const [obj, info] of sorted) {
  console.log(`  "${info.sample}": ${info.count} records, ${(info.total/1000).toFixed(1)}K rub`);
}
console.log('\nTotal distinct:', sorted.length);
console.log('Total records:', sorted.reduce((s,e) => s + e[1].count, 0));
