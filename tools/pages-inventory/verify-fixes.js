const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

(async () => {
  const data = path.join(__dirname, 'data');
  const rows = JSON.parse(fs.readFileSync(path.join(data, 'pages_final.json'), 'utf8'));

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.resolve(__dirname, '..', '..', 'tests', 'reports', 'ASGARD-PAGES-INVENTORY.xlsx'));
  const ws = wb.getWorksheet('Страницы СРМ');
  const h = ws.getRow(3).values;
  const i = n => h.indexOf(n);

  let badViews = 0, badApi = 0, noteNums = 0;
  for (const row of rows) {
    if (String(row.note || '').match(/\d/)) { noteNums++; console.log('в «Примечании» есть числа:', row.route); }
    if (row.used === 'Да' && row.source === 'рендер страницы' && !row.views) { badViews++; console.log('«Да» без просмотров:', row.route); }
    if (row.used === 'Да' && row.source === 'вызовы API' && !row.count) { badApi++; console.log('«Да» без API:', row.route); }
  }
  console.log('«Примечание» с числами:', noteNums, '| «Да» без просмотров:', badViews, '| «Да» без API:', badApi);

  // NaN/пустые в колонках
  let nan = 0;
  ws.eachRow((row, r) => {
    if (r <= 3) return;
    for (const c of [i('Заходили за период'), i('Просмотров страницы (28.09–12.10)'),
      i('Вызовов API страницы (28.09–12.10)'), i('Связана с другой страницей')]) {
      const v = row.getCell(c).value;
      if (v === null || v === undefined || String(v).includes('undefined') || String(v) === 'NaN') {
        nan++; console.log('плохое значение', r, c, v);
      }
    }
  });
  console.log('некорректных значений в ключевых колонках:', nan);

  // дубли связей
  let dup = 0;
  for (const r of rows) if (new Set(r.relatedTo).size !== r.relatedTo.length) dup++;
  const wsRel = wb.getWorksheet('Связи страниц');
  const seen = new Set(); let dupPair = 0;
  wsRel.eachRow((row, n) => {
    if (n === 1) return;
    const k = row.getCell(2).value + '→' + row.getCell(4).value;
    if (seen.has(k)) dupPair++;
    seen.add(k);
  });
  console.log('дублей в «Связанные страницы»:', dup, '| дублей пар в листе 2:', dupPair, '| строк в листе 2:', wsRel.rowCount - 1);

  // большие «общие вызовы» = подозрение на протечку поллеров
  const big = rows.filter(r => /не отнесённых к странице: (\d+)/.test(r.note || '') && +/(\d+)$/.exec(r.note).pop() > 500);
  console.log('строк с «общих вызовов» > 500:', big.length, big.map(r => r.route).join('; '));
})();
