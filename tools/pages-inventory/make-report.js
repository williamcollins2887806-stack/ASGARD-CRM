'use strict';
/**
 * Отчёт: «Категории меню и страницы ASGARD CRM (vanilla) — назначение, использование за месяц,
 * связи и рекомендация по скрытию».
 *
 * Вход:  tools/pages-inventory/data/pages_final.json  (собирается build-inventory.js из кода + журнала nginx)
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

// ── Ручные примечания там, где автоматический сигнал неполный ────────────────
const MANUAL_NOTE = {
  '/command-map-flat': 'Отдельного рендера нет: карта — режим страницы «Живой офис» (/command-map, 5 просмотров в окне). Прямых следов плоского режима нет.',
  '/gamification-admin': 'Прямых следов нет; API геймификации (/api/gamification/admin/*) вызывает страница «Лидерборд», а не эта.',
  '/estimate-report': 'Отдельный рендер в журнал не пишется — сигнал неполный, вывод ручной (открывается по id просчёта).',
  '/pm-consents': 'Отдельный рендер в журнал не пишется — сигнал неполный, вывод ручной.',
  '/tenderguru-settings': 'Отдельный рендер в журнал не пишется — сигнал неполный, вывод ручной.',
  '/kpi-money': 'API модуля (/api/works) общий с другими страницами — посещением не считается.',
  '/payment-invoices': 'Страница не подключена к трекингу рендера (ключ page не пишется) и нет ссылок на неё — вызовов /api/payment-invoices за месяц тоже ноль.',
  '/telegram': 'Действующая страница настроек Telegram/SMS (только ADMIN); один сценарий не доделан — тост «В разработке» на автосоздании поступления.'
};

// ── Рекомендация скрыть (ручное суждение; ядро админ-инструментов НЕ скрываем) ─
const HIDE = {
  '/preview-calc-report': 'Служебное превью модалки (только ADMIN), в меню нет — самостоятельной ценности нет',
  '/mango': 'Только ADMIN, в меню нет; за месяц ни рендеров, ни вызовов телефонии — интеграция не включена',
  '/field-tariffs': 'Только ADMIN, в меню нет; за месяц ни одного обращения — функционал не введён',
  '/reminders': 'В меню нет; ни рендеров, ни вызовов /api/data/reminders — как отдельный экран фактически не работает',
  '/tenderguru-settings': 'Только ADMIN/ТО, в меню нет; за месяц обращений нет (сигнал неполный — трактовка ручная)',
  '/kpi-money': 'В меню нет; ни рендера, ни собственных API — режим «Деньги» не используется',
  '/estimate-report': 'В меню нет; ни рендера, ни API — отдельный отчёт не открывают (сигнал неполный)',
  '/pm-consents': 'В меню нет; ни рендера, ни API — журнал согласий не открывают (сигнал неполный)',
  '/command-map-flat': 'Дублирует «Живой офис» (та же карта, плоский список); отдельно не открывают',
  '/gamification-admin': 'В меню есть, но следов рендера и «своих» API нет — управление геймификацией не используют (учётная область директора/HR)',
  '/payment-invoices': 'В меню нет, ссылок нет, к трекингу не подключён; за месяц ни рендеров, ни вызовов /api/payment-invoices — недоступна из интерфейса'
};

const YELLOW = 'FFF3A3';
const RED = 'FFCDD2';
const HEAD_BG = 'FF1F3864';

const SRC_LABEL = {
  'рендер страницы': 'Рендер страницы (клиент)',
  'вызовы API': 'Вызовы API страницы',
  'косвенно: вкладка/режим другой страницы': 'Косвенно — вкладка/режим',
  'нет следов': 'Следов нет',
  'редирект': 'Переадресация',
  'вне авторизации — трекинг не пишется': 'Публичная (трекинга нет)',
  'только мобильный вид': 'Только мобильный вид'
};

/** Страница доступна ТОЛЬКО администратору (по разбору roles в коде). */
const isAdminOnly = r => r.rolesText === 'Администратор';
/** Ядро технического администрирования — не рекомендуем скрывать даже при нулевом трафике. */
const ADMIN_CORE = new Set(['/settings', '/admin/timesheet-settings', '/backup', '/diag', '/system-panel', '/sync', '/user-requests']);

function quality(r) {
  if (r.type === 'Редирект/алиас') return '— (переход)';
  if (r.source && r.source.includes('трекинг не пишется')) return 'нет сигнала (публичная)';
  if (r.source && r.source.includes('мобильный')) return 'нет сигнала (мобильная)';
  if (r.source === 'рендер страницы') return 'надёжный (рендер)';
  if (r.source === 'вызовы API') return 'надёжный (API)';
  if (r.source === 'нет следов') return r.file ? 'неполный — ручная проверка' : 'неполный — нет ключа трекинга';
  if (r.source && r.source.startsWith('косвенно')) return 'неполный (косвенно)';
  return '—';
}

/** Значение колонки «Заходили за месяц (без админа)». */
function usedText(r) {
  if (r.type === 'Редирект/алиас') return '— (переход)';
  if (r.used === 'н/д') return 'н/д (публичная/мобильная)';
  if (isAdminOnly(r)) return r.used === 'Да' ? 'н/д (только ADMIN)' : 'н/д (только ADMIN)';
  return r.used; // Да / Нет
}
function shouldHide(r) {
  if (!HIDE[r.route]) return false;
  if (ADMIN_CORE.has(r.route)) return false;
  return true;
}

rows.sort((a, b) => {
  const ga = SECTION_ORDER.indexOf(a.group), gb = SECTION_ORDER.indexOf(b.group);
  if (ga !== gb) return (ga < 0 ? 99 : ga) - (gb < 0 ? 99 : gb);
  const ra = a.type === 'Редирект/алиас' ? 2 : (a.inMenu ? 0 : 1);
  const rb = b.type === 'Редирект/алиас' ? 2 : (b.inMenu ? 0 : 1);
  if (ra !== rb) return ra - rb;
  return a.route.localeCompare(b.route, 'ru');
});

const wb = new ExcelJS.Workbook();
wb.creator = 'ASGARD CRM — инвентаризация страниц';
wb.created = new Date();

// ── Лист 1: страницы ─────────────────────────────────────────────────────────
const ws = wb.addWorksheet('Страницы СРМ', { views: [{ state: 'frozen', ySplit: 3 }] });
const COLS = [
  { header: '№', key: 'n', width: 5 },
  { header: 'Категория меню', key: 'group', width: 16 },
  { header: 'Страница', key: 'name', width: 32 },
  { header: 'Хэш-роут', key: 'route', width: 26 },
  { header: 'Что на странице', key: 'desc', width: 58 },
  { header: 'Тип', key: 'type', width: 18 },
  { header: 'В меню', key: 'inMenu', width: 10 },
  { header: 'Доступ (роли)', key: 'roles', width: 38 },
  { header: 'Заходили за месяц (без админа)', key: 'used', width: 18 },
  { header: 'Основание', key: 'source', width: 26 },
  { header: 'Надёжность сигнала', key: 'quality', width: 22 },
  { header: 'Просмотров страницы (29.09–13.10)', key: 'views', width: 20 },
  { header: 'Вызовов API страницы (29.09–13.10)', key: 'apiOwn', width: 21 },
  { header: 'Связана с другой страницей', key: 'related', width: 24 },
  { header: 'Связанные страницы', key: 'relatedTo', width: 54 },
  { header: 'Тип связи', key: 'relKinds', width: 28 },
  { header: 'Рекомендую скрыть', key: 'hide', width: 18 },
  { header: 'Почему стоит скрыть', key: 'hideWhy', width: 52 },
  { header: 'Примечание', key: 'note', width: 60 }
];

const title = ws.addRow(['ASGARD CRM (vanilla, desktop) — категории меню и все страницы: назначение, использование за месяц, связи, что стоит скрыть']);
title.font = { bold: true, size: 14, color: { argb: 'FF1F3864' } };
ws.mergeCells(1, 1, 1, COLS.length);
const sub = ws.addRow([
  'Жёлтым выделены строки страниц, СВЯЗАННЫХ с другими страницами (вкладка/режим/переход) — см. колонки «Связана…». ' +
  'В колонке «Рекомендую скрыть» красным помечены страницы, которые стоит убрать из меню/интерфейса (недоделаны или не используются). ' +
  '«Заходили за месяц» — окно 29.09–13.10.2026 (глубже журнал веб-сервера не хранится), учёт без администратора; страницы только для ADMIN помечены «н/д (только ADMIN)». Подробности — лист «Методика и источники».'
]);
sub.font = { italic: true, size: 10, color: { argb: 'FF555555' } };
ws.mergeCells(2, 1, 2, COLS.length);
sub.alignment = { wrapText: true, vertical: 'top' };
ws.getRow(2).height = 34;

ws.columns = COLS.map(c => ({ key: c.key, width: c.width }));
ws.spliceRows(3, 0, COLS.map(c => c.header));
const hr = ws.getRow(3);
hr.font = { bold: true, color: { argb: 'FFFFFFFF' } };
hr.alignment = { vertical: 'middle', wrapText: true, horizontal: 'center' };
hr.height = 42;
hr.eachCell(c => {
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_BG } };
  c.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
});

let n = 0;
for (const r of rows) {
  const hide = shouldHide(r);
  const inMenu = r.type === 'Редирект/алиас' ? 'переадресация' : (r.navHide ? 'скрыт' : (r.inMenu ? 'Да' : 'Нет'));
  const used = usedText(r);
  const row = ws.addRow({
    n: ++n,
    group: r.group,
    name: r.name,
    route: r.route,
    desc: r.desc,
    type: r.type,
    inMenu,
    roles: r.rolesText,
    used,
    source: SRC_LABEL[r.source] || r.source,
    quality: quality(r),
    views: r.views || '',
    apiOwn: r.count || '',
    related: r.related ? 'Да' : 'Нет',
    relatedTo: r.relatedTo.join(', '),
    relKinds: r.relatedKinds.join('; '),
    hide: r.type === 'Редирект/алиас' ? '—' : (hide ? 'Да' : 'Нет'),
    hideWhy: HIDE[r.route] || '',
    note: [r.note, MANUAL_NOTE[r.route]].filter(Boolean).join(' · ')
  });
  row.alignment = { vertical: 'top', wrapText: true };
  row.getCell('n').alignment = { vertical: 'top', horizontal: 'center' };
  if (r.related) {
    row.eachCell({ includeEmpty: true }, c => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: YELLOW } };
    });
  }
  if (used === 'Нет') row.getCell('used').font = { color: { argb: 'FFB00020' }, bold: true };
  if (r.related) row.getCell('related').font = { bold: true };
  if (hide) {
    const c = row.getCell('hide');
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED } };
    c.font = { color: { argb: 'FFB00020' }, bold: true };
    c.alignment = { vertical: 'top', horizontal: 'center' };
  }
}
ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + rows.length, column: COLS.length } };

// ── Лист 2: связи страниц ────────────────────────────────────────────────────
const wsRel = wb.addWorksheet('Связи страниц', { views: [{ state: 'frozen', ySplit: 1 }] });
wsRel.addRow(['Откуда (страница)', 'Роут-источник', 'Куда (страница)', 'Роут-назначение', 'Тип связи']);
wsRel.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
wsRel.getRow(1).eachCell(c => {
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_BG } };
  c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
});
wsRel.columns = [{ width: 34 }, { width: 26 }, { width: 34 }, { width: 26 }, { width: 30 }];
const byRoute = new Map(rows.map(r => [r.route, r]));
for (const r of rows) {
  const pairs = new Map();
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

// ── Лист 3: сводка по категориям ─────────────────────────────────────────────
const wsSum = wb.addWorksheet('Сводка по категориям');
wsSum.addRow(['Категория меню', 'Страниц всего', 'Из них в меню', 'Заходили (Да)', 'Не заходили (Нет)', 'н/д или переход', 'Рекомендую скрыть']);
wsSum.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
wsSum.getRow(1).eachCell(c => {
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_BG } };
  c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
});
wsSum.columns = [{ width: 22 }, { width: 13 }, { width: 14 }, { width: 14 }, { width: 17 }, { width: 16 }, { width: 18 }];
const groups = [...new Set(rows.map(r => r.group))];
for (const g of groups) {
  const list = rows.filter(r => r.group === g);
  wsSum.addRow([
    g, list.length, list.filter(r => r.inMenu).length,
    list.filter(r => usedText(r) === 'Да').length,
    list.filter(r => usedText(r) === 'Нет').length,
    list.filter(r => usedText(r).startsWith('н/д') || usedText(r).startsWith('—')).length,
    list.filter(r => shouldHide(r)).length
  ]);
}

// ── Лист 4: методика и источники ─────────────────────────────────────────────
const wsM = wb.addWorksheet('Методика и источники');
wsM.columns = [{ width: 34 }, { width: 122 }];
const hideList = rows.filter(r => shouldHide(r)).map(r => `${r.route} — ${r.name} (${r.group})`).join('\n');
const M = [
  ['Что это', 'Полный перечень категорий меню и страниц desktop-версии ASGARD CRM (vanilla, SPA на хэш-роутах #/…). React-версия /v2/ и мобильное приложение /m/ в отчёт не входят.'],
  ['Источник списка страниц', 'Все регистрации роутов AsgardRouter.add() в public/assets/js/*.js. Сверено машинно: tools/pages-inventory/check-routes.js → расхождение 0 (140 = 140).'],
  ['Кол-во страниц в отчёте', String(rows.length)],
  ['', ''],
  ['ОКНО НАБЛЮДЕНИЯ', '29.09.2026 — 13.10.2026 (15 дней). Это НЕ полные 30 дней: журнал веб-сервера хранится с ротацией 14 суток, более старые записи удалены. Постраничных данных в БД нет — восстановить более длинную историю невозможно.'],
  ['', ''],
  ['Как определяется «заходили»', '1) Основной сигнал: при рендере страницы клиент вызывает GET /api/page-view?page=<ключ> (ключ = хэш-роут без слэша). Число таких обращений = число входов на страницу.'],
  ['', '2) Дополнительный сигнал: вызовы API, которые встречаются ТОЛЬКО в модуле этой страницы.'],
  ['', '3) «Косвенно»: прямой сигнал есть только у общей страницы, а эта открывается её вкладкой/режимом.'],
  ['', 'Значения: Да — есть следы; Нет — следов нет; н/д — сигнал не пишется (публичная/мобильная) или страница только для ADMIN; «— (переход)» — это адрес-переход, а не отдельный экран.'],
  ['', ''],
  ['ПОЧЕМУ «БЕЗ АДМИНИСТРАТОРА»', 'Журнал веб-сервера НЕ содержит пользователя (формат combined: IP, время, запрос) — постраничной разбивки по людям нет ни в журнале, ни в БД.'],
  ['', 'Проверено: audit_log пишет только факт изменяющего запроса (action = api_post/api_put/… ; за 32 дня 99,9% записей — api_post), GET и страницы там не отражаются; crm_presence_daily хранит лишь активные секунды по пользователю за день, без страницы.'],
  ['', 'Вывод: администратора исключаем логически. Страницы, доступные ТОЛЬКО роли ADMIN, помечены «н/д (только ADMIN)» — их в принципе может открыть лишь учётка администратора.'],
  ['', 'Ядро технического администрирования (/settings, /backup, /diag, /system-panel, /sync, /user-requests, /admin/timesheet-settings) в рекомендации на скрытие НЕ включается: даже при нулевом трафике это рабочий инструмент, а не мусор.'],
  ['', ''],
  ['Как определяется «связана»', 'Редирект/алиас; вкладки одной страницы (несколько адресов на одном JS-модуле); переход из интерфейса (ссылка в модуле). Служебные хабы (/home, /login, /welcome) как связи не учитываются.'],
  ['', ''],
  ['Как рекомендовано «скрыть»', 'Ручное суждение по данным за окно. Скрыть предложено страницу, если одновременно: (а) прямых следов за месяц нет (Да → нет), (б) она не выполняет роль ядра админ-инструментов.'],
  ['', 'Действующие, но редкие страницы (открывались хотя бы раз) в список скрытия НЕ попали.'],
  ['', 'Список «рекомендую скрыть»:'],
  ['', hideList],
  ['', ''],
  ['Ограничения', 'Числа могут отличаться на несколько единиц от более позднего прогона — журнал снимался в момент генерации.'],
  ['', 'Неполный сигнал (отдельный рендер в журнал не пишется): /estimate-report, /pm-consents, /tenderguru-settings, /payment-invoices — по ним вывод ручной, это отмечено в колонке «Надёжность сигнала» и в «Примечании».'],
  ['', 'Отметка «Да» означает факт открытия страницы за окно и не означает регулярную работу с ней.'],
  ['', ''],
  ['Атрибуция', 'Данные журнала веб-сервера прод-контура ASGARD CRM (92.242.61.184), окно 29.09–13.10.2026'],
  ['Дата сборки', new Date().toISOString().slice(0, 10)]
];
for (const [a, b] of M) {
  const row = wsM.addRow([a, b]);
  row.getCell(1).font = { bold: true };
  row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
}
wsM.getRow(1).font = { bold: true, size: 14, color: { argb: 'FF1F3864' } };

fs.mkdirSync(path.dirname(OUT), { recursive: true });
wb.xlsx.writeFile(OUT).then(() => {
  console.log('OK ->', OUT);
  console.log('страниц:', rows.length,
    '| Да (без админа):', rows.filter(r => usedText(r) === 'Да').length,
    '| Нет:', rows.filter(r => usedText(r) === 'Нет').length,
    '| н/д (только ADMIN):', rows.filter(r => usedText(r).includes('только ADMIN')).length,
    '| редиректов:', rows.filter(r => r.type === 'Редирект/алиас').length,
    '| жёлтых (связи):', rows.filter(r => r.related).length,
    '| рекомендовано скрыть:', rows.filter(r => shouldHide(r)).length,
    '| связей:', rows.reduce((s, r) => s + r.relDetail.length, 0));
});
