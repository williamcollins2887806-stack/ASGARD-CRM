'use strict';
/**
 * Генератор Excel: «Страницы СРМ (vanilla) — инвентарь, использование, связи».
 * Вход:  _pages_tmp/pages_final.json
 * Выход: tests/reports/ASGARD-PAGES-INVENTORY.xlsx
 */
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const ROOT = path.resolve(__dirname, '..', '..');
const DATA = path.join(__dirname, 'data');
const rows = JSON.parse(fs.readFileSync(path.join(DATA, 'pages_final.json'), 'utf8'));
const OUT = path.join(ROOT, 'tests', 'reports', 'ASGARD-PAGES-INVENTORY.xlsx');

const SECTION_ORDER = ['Главная', 'Тендеры', 'Работы', 'Финансы', 'Ресурсы', 'Персонал',
  'Коммуникации', 'Аналитика', 'Система', 'Вход и регистрация', 'Без раздела'];

// ── человекочитаемые имена API-областей ──────────────────────────────────────
const AREA = [
  ['/api/tenders-hub', 'тендер-хаб'],
  ['/api/tenders/registry', 'реестр тендеров'],
  ['/api/tenders', 'тендеры'],
  ['/api/pre-tenders', 'предварительные заявки'],
  ['/api/inbox-applications', 'входящие AI-заявки'],
  ['/api/pm-duty', 'просчёты (дежурный РП)'],
  ['/api/estimates', 'просчёты'],
  ['/api/tkp', 'ТКП'],
  ['/api/works', 'работы'],
  ['/api/work-readiness', 'готовность работ'],
  ['/api/customers', 'контрагенты'],
  ['/api/staff/readiness', 'готовность рабочих'],
  ['/api/staff/employees', 'сотрудники'],
  ['/api/data/employees', 'сотрудники'],
  ['/api/staff-requests', 'кадровые заявки'],
  ['/api/staff', 'персонал'],
  ['/api/employee-collections', 'подборки сотрудников'],
  ['/api/timesheet', 'табели'],
  ['/api/payroll-dashboard', 'выплаты / балансы'],
  ['/api/payroll', 'ведомости'],
  ['/api/worker-payments', 'выплаты рабочим'],
  ['/api/cash', 'касса'],
  ['/api/acts', 'акты'],
  ['/api/invoices', 'счета'],
  ['/api/billing', 'счета и акты'],
  ['/api/doc-registry', 'реестр документов'],
  ['/api/approval', 'согласования'],
  ['/api/permits', 'допуски'],
  ['/api/permit-applications', 'заявки на допуски'],
  ['/api/nd', 'электронные наряды'],
  ['/api/equipment', 'оборудование'],
  ['/api/products', 'номенклатура'],
  ['/api/suppliers', 'поставщики'],
  ['/api/warehouse', 'склад'],
  ['/api/procurement', 'закупки'],
  ['/api/pass-requests', 'пропуска'],
  ['/api/tasks', 'задачи'],
  ['/api/notifications', 'уведомления'],
  ['/api/telephony', 'звонки'],
  ['/api/call-reports', 'отчёты по звонкам'],
  ['/api/mailbox', 'почта'],
  ['/api/my-mail', 'почта'],
  ['/api/chat-groups', 'чаты'],
  ['/api/meetings', 'совещания'],
  ['/api/thing', 'видеосовещания (Тинг)'],
  ['/api/calendar', 'календарь'],
  ['/api/office-academy', 'Академия Асгарда'],
  ['/api/training', 'обучение'],
  ['/api/gamification', 'геймификация'],
  ['/api/mimir', 'Мимир AI'],
  ['/api/hints', 'подсказки Мимира'],
  ['/api/page-view', 'учёт заходов на страницы'],
  ['/api/analytics', 'аналитика'],
  ['/api/personal-kanban', 'личный канбан'],
  ['/api/command-map', 'живой офис'],
  ['/api/site-crew', 'бригады на объектах'],
  ['/api/sites', 'объекты'],
  ['/api/contracts', 'договоры'],
  ['/api/proxies', 'доверенности'],
  ['/api/seals', 'печати'],
  ['/api/correspondence', 'корреспонденция'],
  ['/api/travel', 'логистика дружины'],
  ['/api/field/logistics', 'логистика поля'],
  ['/api/field/manage', 'тарифы поля'],
  ['/api/field/', 'полевой модуль'],
  ['/api/integrations', 'интеграции'],
  ['/api/settings', 'настройки'],
  ['/api/admin', 'администрирование сервера'],
  ['/api/user-requests', 'заявки на регистрацию'],
  ['/api/work-norms', 'нормы работ']
];

function keyAreas(endpoints) {
  const seen = [];
  for (const e of endpoints) {
    const ep = e.replace(/\s*\(\d+\)$/, '');
    if (ep === '/api/payment-invoices') {
      if (!seen.includes('счета на оплату')) seen.push('счета на оплату');
      continue;
    }
    const hit = AREA.find(([p]) => ep.startsWith(p));
    if (hit && !seen.includes(hit[1])) seen.push(hit[1]);
  }
  return seen.slice(0, 5).join('; ');
}

// ── роли ─────────────────────────────────────────────────────────────────────
const SRC_LABEL = {
  'рендер страницы': 'Рендер страницы (клиент)',
  'вызовы API': 'Вызовы API страницы',
  'косвенно: вкладка/режим другой страницы': 'Косвенно — вкладка/режим',
  'нет следов': 'Следов нет',
  'редирект': 'Переадресация',
  'вне авторизации — трекинг не пишется': 'Публичная (трекинга нет)',
  'только мобильный вид': 'Только мобильный вид'
};

// ── сортировка ───────────────────────────────────────────────────────────────
rows.sort((a, b) => {
  const ga = SECTION_ORDER.indexOf(a.group), gb = SECTION_ORDER.indexOf(b.group);
  if (ga !== gb) return (ga < 0 ? 99 : ga) - (gb < 0 ? 99 : gb);
  const ra = a.type === 'Редирект/алиас' ? 2 : (a.inMenu ? 0 : 1);
  const rb = b.type === 'Редирект/алиас' ? 2 : (b.inMenu ? 0 : 1);
  if (ra !== rb) return ra - rb;
  return a.route.localeCompare(b.route, 'ru');
});

const YELLOW = 'FFF3A3';
const HEAD_BG = 'FF1F3864';
const assertConsistent = () => {
  const bad = rows.filter(r => (r.related === true) !== (r.relatedCount > 0));
  if (bad.length) throw new Error('related/relatedCount рассинхрон: ' + bad.length);
  const bad2 = rows.filter(r => r.used === 'Да' && r.type === 'Редирект/алиас');
  if (bad2.length) throw new Error('редирект помечен как использованный');
  return true;
};
assertConsistent();

// ── книга ────────────────────────────────────────────────────────────────────
const wb = new ExcelJS.Workbook();
wb.creator = 'ASGARD CRM — инвентаризация страниц';
wb.created = new Date();

const ws = wb.addWorksheet('Страницы СРМ', { views: [{ state: 'frozen', ySplit: 3 }] });
const wsRel = wb.addWorksheet('Связи страниц', { views: [{ state: 'frozen', ySplit: 1 }] });
const wsMethod = wb.addWorksheet('Методика и источники');

const COLS = [
  { header: '№', key: 'n', width: 5 },
  { header: 'Раздел', key: 'group', width: 16 },
  { header: 'Страница', key: 'name', width: 34 },
  { header: 'Хэш-роут', key: 'route', width: 26 },
  { header: 'Что на странице', key: 'desc', width: 62 },
  { header: 'Ключевые данные', key: 'areas', width: 34 },
  { header: 'Тип', key: 'type', width: 18 },
  { header: 'В меню', key: 'inMenu', width: 10 },
  { header: 'Доступ (роли)', key: 'roles', width: 40 },
  { header: 'Заходили за период', key: 'used', width: 17 },
  { header: 'Просмотров страницы (28.09–12.10)', key: 'views', width: 20 },
  { header: 'Вызовов API страницы (28.09–12.10)', key: 'apiOwn', width: 22 },
  { header: 'Основание', key: 'source', width: 26 },
  { header: 'Период по последним данным', key: 'range', width: 22 },
  { header: 'Связана с другой страницей', key: 'related', width: 24 },
  { header: 'Связанные страницы', key: 'relatedTo', width: 54 },
  { header: 'Тип связи', key: 'relKinds', width: 30 },
  { header: 'Примечание', key: 'note', width: 56 }
];

const title = ws.addRow(['Страницы ASGARD CRM (vanilla, desktop) — инвентарь, использование за последний месяц, связи']);
title.font = { bold: true, size: 14, color: { argb: 'FF1F3864' } };
ws.mergeCells(1, 1, 1, COLS.length);
const sub = ws.addRow([
  '«Заходили» = «Да» — есть рендер страницы (журнал обращений клиента) или вызовы её API в окне 28.09–12.10.2026; ' +
  '«Нет» — следов за окно нет; «н/д» — сигнал в принципе не пишется (публичные и мобильные страницы); «—» — адрес-переход. ' +
  'Жёлтым выделены страницы, связанные с другой страницей (вкладка/режим/переход). Подробности — в колонке «Примечание» и на листе «Методика и источники».'
]);
sub.font = { italic: true, size: 10, color: { argb: 'FF555555' } };
ws.mergeCells(2, 1, 2, COLS.length);
sub.alignment = { wrapText: true, vertical: 'top' };
ws.getRow(2).height = 28;

ws.columns = COLS.map(c => ({ key: c.key, width: c.width }));
ws.spliceRows(3, 0, COLS.map(c => c.header));
const headerRow = ws.getRow(3);
headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
headerRow.alignment = { vertical: 'middle', wrapText: true, horizontal: 'center' };
headerRow.height = 34;
headerRow.eachCell(c => {
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_BG } };
  c.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
});

let n = 0;
for (const r of rows) {
  const inMenu = r.type === 'Редирект/алиас' ? 'переадресация' : (r.navHide ? 'скрыт' : (r.inMenu ? 'Да' : 'Нет'));
  const row = ws.addRow({
    n: ++n,
    group: r.group,
    name: r.name,
    route: r.route,
    desc: r.desc,
    areas: keyAreas(r.ownEndpoints),
    type: r.type,
    inMenu,
    roles: r.rolesText,
    used: r.used,
    views: r.views || '',
    apiOwn: r.count || '',
    source: SRC_LABEL[r.source] || r.source,
    range: r.usedTo ? (r.usedFrom === r.usedTo ? r.usedTo : r.usedFrom + ' — ' + r.usedTo) : '',
    related: r.related ? 'Да' : 'Нет',
    relatedTo: r.relatedTo.join(', '),
    relKinds: r.relatedKinds.join('; '),
    note: r.note || ''
  });
  row.alignment = { vertical: 'top', wrapText: true };
  row.getCell('n').alignment = { vertical: 'top', horizontal: 'center' };
  if (r.related) {
    row.eachCell({ includeEmpty: true }, c => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: YELLOW } };
    });
  }
  if (r.used === 'Нет') row.getCell('used').font = { color: { argb: 'FFB00020' }, bold: true };
  if (r.related) row.getCell('related').font = { bold: true };
}

ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + rows.length, column: COLS.length } };

// ── Sheet 2: связи ───────────────────────────────────────────────────────────
wsRel.addRow(['Откуда (страница)', 'Роут-источник', 'Куда (страница)', 'Роут-назначение', 'Тип связи']);
wsRel.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
wsRel.getRow(1).eachCell(c => {
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_BG } };
  c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
});
wsRel.columns = [{ width: 34 }, { width: 26 }, { width: 34 }, { width: 26 }, { width: 30 }];
const byRoute = new Map(rows.map(r => [r.route, r]));
for (const r of rows) {
  const pairs = new Map(); // to → Set<kind>
  for (const l of r.relDetail) {
    if (!pairs.has(l.to)) pairs.set(l.to, new Set());
    pairs.get(l.to).add(l.kind);
  }
  for (const [to, kinds] of pairs) {
    const t = byRoute.get(to);
    wsRel.addRow([r.name, r.route, t ? t.name : to, to, [...kinds].join('; ')]);
  }
}
wsRel.autoFilter = { from: { row: 1, column: 1 }, to: { row: wsRel.rowCount, column: 5 } };

// ── Sheet 3: методика ────────────────────────────────────────────────────────
const M = [
  ['Методика и источники', ''],
  ['', ''],
  ['Что это', 'Инвентарь всех страниц desktop-версии ASGARD CRM (vanilla, SPA на хэш-роутах #/…). Не включает React-версию /v2/ и мобильное приложение /m/.'],
  ['Источник списка страниц', 'Все регистрации роутов AsgardRouter.add() в public/assets/js/*.js'],
  ['Кол-во роутов', String(rows.length) + ' (сверено с кодом машинно: tools/pages-inventory/check-routes.js)'],
  ['', ''],
  ['Окно наблюдения', '28.09.2026 — 12.10.2026 (15 дней). Ограничено глубиной хранения журнала веб-сервера (ротация 14 суток).'],
  ['', ''],
  ['Как определяется «заходили»', '1) Основной сигнал: при каждом рендере страницы клиент вызывает GET /api/page-view?page=<ключ>. Ключ — это хэш-роут без слэша (см. public/assets/js/router.js), например /pm-calculations → page=pm-calculations.'],
  ['', '   Счёт таких обращений в журнале веб-сервера = число входов на страницу (колонка «Просмотров страницы»).'],
  ['', '2) Дополнительный сигнал: вызовы API-эндпоинтов, которые встречаются ТОЛЬКО в модуле этой страницы (колонка «Вызовов API»).'],
  ['', '3) Если прямого сигнала нет, но страница открывается как вкладка/режим другой — она помечена «Да» с основанием «Косвенно», подробности в «Примечании».'],
  ['', '«Да»/«Нет»/«н/д» — по этим сигналам в указанном окне. «н/д» — сигнал в принципе не пишется (публичные и мобильные страницы).'],
  ['', ''],
  ['Чего в системе НЕТ', 'Постраничной истории посещений в базе данных нет. Проверено: audit_log пишет только изменяющие запросы (POST/PUT/PATCH/DELETE), GET не логируются;'],
  ['', 'таблица crm_presence_daily хранит только активные секунды по пользователю за день, без указания страницы (14 пользователей, с 07.09.2026).'],
  ['', 'Поэтому единственный достоверный постраничный источник — журнал обращений веб-сервера.'],
  ['', ''],
  ['Как определяется «связана»', 'Редирект/алиас: адрес сразу переадресует на другой адрес (отдельного экрана нет).'],
  ['', 'Вкладки одной страницы / общий модуль: несколько адресов обслуживаются одним JS-модулем — это вкладки или режимы одного экрана (например, четыре табеля на одном экране «Табель»).'],
  ['', 'Переход из интерфейса: внутри модуля страницы есть ссылка на другой адрес (кнопка/вкладка «перейти»).'],
  ['', 'Служебные хабы (/home, /login, /welcome) как связи не учитываются — иначе «связана» было бы почти у всех.'],
  ['', ''],
  ['Ограничения', 'Данные «заходят/не заходят» — за 15 дней, а не за 30: более старые журналы веб-сервера удалены ротацией.'],
  ['', '«Просмотров» — число рендеров страницы, а не число уникальных сотрудников: разбивки по людям источник не даёт.'],
  ['', 'Страницы под ролью ADMIN могли открываться вручную; отметка «Да» не означает регулярную работу со страницей.'],
  ['', 'Логи опускались в момент снятия среза, поэтому числа могут отличаться на несколько единиц от более позднего прогона.'],
  ['', ''],
  ['Дата сборки', new Date().toISOString().slice(0, 10)]
];
for (const [a, b] of M) {
  const row = wsMethod.addRow([a, b]);
  row.getCell(1).font = { bold: true };
  row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
}
wsMethod.columns = [{ width: 32 }, { width: 120 }];
wsMethod.getRow(1).font = { bold: true, size: 14, color: { argb: 'FF1F3864' } };

fs.mkdirSync(path.dirname(OUT), { recursive: true });
wb.xlsx.writeFile(OUT).then(() => {
  console.log('OK ->', OUT);
  console.log('строк:', rows.length, '| жёлтых (связаны):', rows.filter(r => r.related).length,
    '| Заходили Да:', rows.filter(r => r.used === 'Да').length,
    '| Нет:', rows.filter(r => r.used === 'Нет').length,
    '| редиректы:', rows.filter(r => r.type === 'Редирект/алиас').length,
    '| связей:', rows.reduce((s, r) => s + r.relDetail.length, 0));
});
