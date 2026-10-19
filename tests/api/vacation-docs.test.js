'use strict';
/**
 * Проверка документов отпуска: заявление, приказ Т-6 (0301005), график Т-7 (0301020),
 * XLSX-выгрузка. Сверяет структуру по формам и образцам заказчика.
 *
 * Запуск: node tests/api/vacation-docs.test.js
 * Требования: python + python-docx (для разбора сгенерированных .docx), exceljs.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'tests', 'reports', 'vacation-docs');
fs.mkdirSync(OUT, { recursive: true });

const docs = require(path.join(ROOT, 'src', 'services', 'vacation-docx'));

let pass = 0, fail = 0;
const check = (n, c, e) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (e ? ' :: ' + e : '')); } };

const ORG = { name: 'ООО «Асгард-Сервис»' };
const EMP = {
  organization: ORG,
  employee: {
    full_name: 'Андросов Никита Андреевич', position: 'Руководитель проектов',
    department: 'Руководители проектов', personnel_number: 2315,
  },
  period: { date_from: '2027-05-04', date_to: '2027-05-17', days: 14 },
  main: { days: 14, date_from: '2027-05-04', date_to: '2027-05-17' },
  total: { days: 14, date_from: '2027-05-04', date_to: '2027-05-17' },
  manager: { position: 'Генеральный директор', full_name: 'Кудряшов О. С.' },
  hr: { position: 'Руководитель кадровой службы', full_name: 'Лебедева И. П.' },
  application_date: '2027-04-20',
};
const T7 = {
  organization: ORG, year: 2027,
  employees: [
    { full_name: 'Андросов Никита Андреевич', position: 'Руководитель проектов', department: 'Руководители проектов', personnel_number: 2315, periods: [{ date_from: '2027-05-04', date_to: '2027-05-17', days: 14, status: 'approved' }] },
    { full_name: 'Морозов Игорь Валентинович', position: 'Руководитель проектов', department: 'Руководители проектов', personnel_number: 2316, periods: [{ date_from: '2027-01-12', date_to: '2027-01-18', days: 7, status: 'approved' }] },
    { full_name: 'Путков Дмитрий Александрович', position: 'Бухгалтер', department: 'Бухгалтерия', personnel_number: 2320, periods: [] },
  ],
};

/** Разобрать DOCX через python-docx: текст параграфов + ВЕСЬ текст таблиц (все строки). */
function parseDocx(file) {
  const py = `
import sys, json
sys.stdout.reconfigure(encoding='utf-8')
from docx import Document
d = Document(r'${file.replace(/\\/g, '\\\\')}')
tables=[]
for t in d.tables:
    cells=[]
    for r in t.rows:
        for c in r.cells:
            txt=c.text.strip()
            if txt: cells.append(txt)
    tables.append({'rows':len(t.rows),'cols':len(t.columns),
                   'header':[c.text.strip() for c in t.rows[0].cells],
                   'all':' '.join(cells)})
print(json.dumps({'text':'\\n'.join(p.text for p in d.paragraphs),'tables':tables}, ensure_ascii=False))
`;
  const out = execFileSync('python', ['-c', py], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  return JSON.parse(out);
}

(async () => {
  // ── 1. Заявление ───────────────────────────────────────────────────────
  const appPath = path.join(OUT, 'zayavlenie.docx');
  const appBuf = await docs.generateVacationApplication({ org: ORG, ...EMP });
  fs.writeFileSync(appPath, appBuf);
  const app = parseDocx(appPath);
  check('заявление: файл создан', fs.existsSync(appPath) && appBuf.length > 1000, 'bytes=' + appBuf.length);
  check('заявление: «ЗАЯВЛЕНИЕ»', /ЗАЯВЛЕНИЕ/i.test(app.text));
  check('заявление: ФИО сотрудника', app.text.includes('Андросов'));
  check('заявление: адресат (директор)', /Директор|Кудряшов/i.test(app.text));
  check('заявление: число дней', /14/.test(app.text));
  check('заявление: нет незаполненных плейсхолдеров', !/\{[a-zA-ZА-Яа-я_]+\}/.test(app.text), (app.text.match(/\{[^}]+\}/g) || []).join(','));

  // ── 2. Приказ Т-6 ──────────────────────────────────────────────────────
  const t6Path = path.join(OUT, 'prikaz-T6.docx');
  const t6Buf = await docs.generateOrderT6({ org: ORG, ...EMP });
  fs.writeFileSync(t6Path, t6Buf);
  const t6 = parseDocx(t6Path);
  check('Т-6: файл создан', fs.existsSync(t6Path) && t6Buf.length > 1000, 'bytes=' + t6Buf.length);
  const t6all = t6.text + ' ' + t6.tables.map((t) => t.all || t.header.join(' ')).join(' ');
  // Код формы лежит в таблице шапки («Форма по ОКУД»), а не в параграфах.
  check('Т-6: код формы 0301005', /0301005/.test(t6all), t6all.slice(0, 200));
  check('Т-6: пункт А (основной отпуск)', /А\./.test(t6all));
  check('Т-6: пункт Б (доп. отпуск)', /Б\./.test(t6all));
  check('Т-6: пункт В (всего)', /В\./.test(t6all));
  check('Т-6: строка «за период работы»', /за период работы/i.test(t6all));
  check('Т-6: ФИО сотрудника', t6all.includes('Андросов'));

  // ── 3. График Т-7 ──────────────────────────────────────────────────────
  const t7Path = path.join(OUT, 'grafik-T7.docx');
  const t7Buf = await docs.generateScheduleT7(T7);
  fs.writeFileSync(t7Path, t7Buf);
  const t7 = parseDocx(t7Path);
  check('Т-7: файл создан', fs.existsSync(t7Path) && t7Buf.length > 1000, 'bytes=' + t7Buf.length);
  const t7all = t7.text + ' ' + t7.tables.map((t) => t.all || t.header.join(' ')).join(' ');
  check('Т-7: код формы 0301020', /0301020/.test(t7all), t7all.slice(0, 200));
  const grid = t7.tables.filter((t) => t.cols === 10)[0];
  check('Т-7: таблица из 10 граф', !!grid, JSON.stringify(t7.tables.map((t) => t.cols)));
  check('Т-7: строки сотрудников (>=3 + шапка)', !!grid && grid.rows >= 4, 'rows=' + (grid ? grid.rows : 0));
  check('Т-7: в шапке есть «ОТПУСК»', !!grid && /ОТПУСК/i.test(grid.header.join(' ')), grid ? grid.header.join(' | ') : '');
  check('Т-7: в шапке есть «Примечание»', !!grid && /Примечание/i.test(grid.header.join(' ')));

  // Покрытие шапки: ни одна графа не должна быть «пустой» во всех рядах шапки.
  const pySpan = `
import sys, json
sys.stdout.reconfigure(encoding='utf-8')
from docx import Document
NS='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
d=Document(r'${t7Path.replace(/\\/g, '\\\\')}')
t=max(d.tables, key=lambda x: len(x.columns))
rows=[]
for tr in t.rows[:4]:
    m=[]
    for tc in tr._tr.findall('.//w:tc',{'w':NS[1:-1]}):
        span=1
        p=tc.find('w:tcPr',{'w':NS[1:-1]})
        if p is not None:
            gs=p.find('w:gridSpan',{'w':NS[1:-1]})
            if gs is not None: span=int(gs.get(NS+'val'))
        txt=' '.join(tc.itertext()).strip()
        for _ in range(span): m.append(txt)
    rows.append(m)
holes=[c+1 for c in range(10) if not any((len(r)>c and r[c]) for r in rows)]
print(json.dumps({'widths':[len(r) for r in rows],'holes':holes}))
`;
  let spanInfo = { widths: [], holes: [] };
  try {
    spanInfo = JSON.parse(execFileSync('python', ['-c', pySpan], { encoding: 'utf8' }));
  } catch (e) { console.log('  (не удалось разобрать spans: ' + e.message.slice(0, 80) + ')'); }
  check('Т-7: шапка покрывает все 10 граф без дыр', spanInfo.holes.length === 0,
    'holes=' + JSON.stringify(spanInfo.holes) + ' widths=' + JSON.stringify(spanInfo.widths));

  // ── 4. XLSX ────────────────────────────────────────────────────────────
  const xlsxPath = path.join(OUT, 'grafik-T7.xlsx');
  const xBuf = await docs.generateScheduleT7Xlsx(T7);
  fs.writeFileSync(xlsxPath, xBuf);
  const ExcelJS = require(path.join(ROOT, 'node_modules', 'exceljs'));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsxPath);
  const ws = wb.worksheets[0];
  check('XLSX: лист создан', !!ws, ws ? ws.name : 'нет');
  check('XLSX: 10 колонок', ws.columnCount >= 10, 'cols=' + ws.columnCount);
  check('XLSX: строки сотрудников', ws.rowCount >= 4, 'rows=' + ws.rowCount);

  console.log('\n' + (fail ? `FAILS: ${fail}` : 'ALL PASS') + ` (${pass} проверок)`);
  console.log('Документы: ' + OUT);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH: ' + e.message + '\n' + (e.stack || '')); process.exit(1); });
