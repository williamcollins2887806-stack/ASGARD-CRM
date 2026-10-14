const ExcelJS = require('exceljs');
const path = require('path');
(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.resolve(__dirname, '..', '..', 'tests', 'reports', 'ASGARD-PAGES-INVENTORY.xlsx'));
  const ws = wb.getWorksheet('Страницы СРМ');
  let yellow = 0, red = 0, rows = 0, related = 0, noTrace = 0, emptyDesc = 0, emptyName = 0;
  let badApi = 0, badViews = 0, constr = 0;
  const header = ws.getRow(3).values;
  const idx = n => header.indexOf(n);
  const iUsed = idx('Заходили за период'), iRel = idx('Связана с другой страницей'),
    iDesc = idx('Что на странице'), iName = idx('Страница'),
    iViews = idx('Просмотров страницы (28.09–12.10)'),
    iApi = idx('Вызовов API страницы (28.09–12.10)'), iSrc = idx('Основание');
  ws.eachRow((row, i) => {
    if (i <= 3) return;
    rows++;
    const fill = row.getCell(1).fill;
    if (fill && fill.fgColor && fill.fgColor.argb === 'FFF3A3') yellow++;
    if (row.getCell(iRel).value === 'Да') related++;
    const used = row.getCell(iUsed).value;
    if (used === 'Нет') noTrace++;
    const font = row.getCell(iUsed).font;
    if (used === 'Нет' && font && font.color && font.color.argb === 'FFB00020') red++;
    if (!String(row.getCell(iDesc).value || '').trim()) emptyDesc++;
    if (!String(row.getCell(iName).value || '').trim()) emptyName++;
    const src = String(row.getCell(iSrc).value || '');
    if (row.getCell(iApi).value && !/Вызовы API/.test(src) && !/Рендер страницы/.test(src)) badApi++;
    if (row.getCell(iViews).value && !/Рендер страницы/.test(src)) badViews++;
    if (used === 'Да' && !row.getCell(iViews).value && !row.getCell(iApi).value && !/Косвенно/.test(src)) constr++;
  });
  console.log('строк данных:', rows);
  console.log('жёлтых:', yellow, '| «Связана=Да»:', related, '| совпадает:', yellow === related ? 'ДА' : 'НЕТ');
  console.log('«Заходили=Нет»:', noTrace, '| красных:', red, '| совпадает:', noTrace === red ? 'ДА' : 'НЕТ');
  console.log('пустых описаний:', emptyDesc, '| пустых названий:', emptyName);
  console.log('API при неподходящем основании:', badApi, '| Просмотры без «Рендер страницы»:', badViews);
  console.log('«Да» без чисел и без «Косвенно»:', constr);
  console.log('связей в листе 2:', wb.getWorksheet('Связи страниц').rowCount - 1);
  console.log('лист методики, строк:', wb.getWorksheet('Методика и источники').rowCount);
})();
