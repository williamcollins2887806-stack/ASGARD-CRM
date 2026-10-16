/* ASGARD CRM — прототип корзины выплат. Мок-данные на реальных полях payout-row.js */
window.PP_DATA = (function () {
  // Коэффициенты — зеркало src/lib/payout-calc.js (settings)
  var CALC = {
    seInfoCoef: 1.064,           // рабочему (СЗ): X × 1.064
    seTransferCoef: 1.3521666667, // всего (СЗ): X × (1.064/0.96) × 1.22
    officialMarkupRate: 0.15      // Перевод с НДФЛ: X × 1.15
  };

  // ── Период: платим за прошлый месяц ────────────────────────────────────
  var PERIOD = { year: 2026, month: 9 };
  var MONTHS = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];

  // ── Сотрудники (реальные ФИО из прод-данных) ───────────────────────────
  // mode: cash (наличка) | se (самозанятый) | ndfl (официально/галка +15%)
  // payee: получатель НПД, если задан
  var M = [
    { id: 9869, fio: 'Андрющенко Константин Евгеньевич', mode: 'se',    accrued: 69500,  carryDebt: 0,      carryAdvance: 30000, advance: 0,     penalty: 0,     official: 0, bonus: 0, inbox: 0 },
    { id: 20,   fio: 'Ахмеров Евгений Жамильевич',       mode: 'se',    accrued: 180000, carryDebt: 22500,  carryAdvance: 0,     advance: 0,     penalty: 0,     official: 0, bonus: 0, inbox: 0 },
    { id: 85,   fio: 'Емельяненко Николай Евгеньевич',   mode: 'cash',  accrued: 142000, carryDebt: 0,      carryAdvance: 15000, advance: 0,     penalty: 0,     official: 0, bonus: 0, inbox: 0 },
    { id: 102,  fio: 'Зарипов Дамир Раисович',           mode: 'se',    accrued: 265000, carryDebt: 219000, carryAdvance: 0,     advance: 0,     penalty: 0,     official: 0, bonus: 0, inbox: 0 },
    { id: 150,  fio: 'Крючкин Сергей Владимирович',      mode: 'ndfl',  accrued: 210000, carryDebt: 0,      carryAdvance: 50000, advance: 0,     penalty: 0,     official: 0, bonus: 0, inbox: 0 },
    { id: 10195,fio: 'Петров Андрей Леонидович',         mode: 'cash',  accrued: 168000, carryDebt: 0,      carryAdvance: 79000, advance: 0,     penalty: 0,     official: 0, bonus: 0, inbox: 0 },
    { id: 10067,fio: 'Петрушенко Александр Андреевич',   mode: 'se',    accrued: 320000, carryDebt: 50000,  carryAdvance: 0,     advance: 0,     penalty: 0,     official: 0, bonus: 0, inbox: 0 },
    { id: 132,  fio: 'Коваленко Александр Александрович', mode: 'cash', accrued: 88000,  carryDebt: 2024,   carryAdvance: 0,     advance: 0,     penalty: 0,     official: 0, bonus: 0, inbox: 0 },
    { id: 128,  fio: 'Китуашвили Никон Сергеевич',       mode: 'se',    accrued: 305000, carryDebt: 125496, carryAdvance: 0,     advance: 0,     penalty: 0,     official: 0, bonus: 0, inbox: 0, payee: { id: 10061, fio: 'Китуашвили Тамара Сергеевна', phone: '79276217721' } },
    { id: 84,   fio: 'Ежков Павел Владимирович',         mode: 'ndfl',  accrued: 195000, carryDebt: 0,      carryAdvance: 44667, advance: 0,     penalty: 0,     official: 0, bonus: 0, inbox: 0 },
    { id: 161,  fio: 'Кученков Алексей Валерьевич',      mode: 'se',    accrued: 240000, carryDebt: 0,      carryAdvance: 104400,advance: 0,     penalty: 0,     official: 0, bonus: 0, inbox: 0 },
    { id: 213,  fio: 'Новиков Игорь Олегович',           mode: 'cash',  accrued: 76000,  carryDebt: 0,      carryAdvance: 7600,  advance: 0,     penalty: 0,     official: 0, bonus: 0, inbox: 0 },
    { id: 212,  fio: 'Новиков Алексей Валентинович',     mode: 'se',    accrued: 154000, carryDebt: 0,      carryAdvance: 42733.27, advance: 0, penalty: 0,     official: 0, bonus: 0, inbox: 0 },
    { id: 237,  fio: 'Погребняков Сергей Владимирович',  mode: 'cash',  accrued: 178000, carryDebt: 0,      carryAdvance: 78300, advance: 0,     penalty: 0,     official: 0, bonus: 0, inbox: 0 },
    { id: 240,  fio: 'Пономарев Александр Евгеньевич',   mode: 'ndfl',  accrued: 132000, carryDebt: 0,      carryAdvance: 38344.79, advance: 0, penalty: 0,     official: 0, bonus: 0, inbox: 0 },
    { id: 247,  fio: 'Портнов Андрей Александрович',     mode: 'cash',  accrued: 205000, carryDebt: 0,      carryAdvance: 33300, advance: 0,     penalty: 0,     official: 0, bonus: 0, inbox: 0 },
    { id: 10030,fio: 'Круглов Николай Александрович',    mode: 'se',    accrued: 66000,  carryDebt: 0,      carryAdvance: 69600, advance: 0,     penalty: 0,     official: 0, bonus: 0, inbox: 0 },
    { id: 320,  fio: 'Трухин Антон Сергеевич',           mode: 'se',    accrued: 148000, carryDebt: 29195.25, carryAdvance: 0,   advance: 0,     penalty: 0,     official: 0, bonus: 0, inbox: 0 },
    { id: 376,  fio: 'Якупов Ильяс Ильясович',           mode: 'cash',  accrued: 92000,  carryDebt: 0,      carryAdvance: 16526, advance: 0,     penalty: 0,     official: 0, bonus: 0, inbox: 0 },
    { id: 63,   fio: 'Ермошин Артем Степанович',         mode: 'cash',  accrued: 118000, carryDebt: 0,      carryAdvance: 0,     advance: 0,     penalty: 0,     official: 0, bonus: 0, inbox: 0 },
    { id: 10033,fio: 'Овсянников Андрей Андреевич',      mode: 'cash',  accrued: 96000,  carryDebt: 0,      carryAdvance: 0,     advance: 0,     penalty: 0,     official: 0, bonus: 0, inbox: 0 }
  ];

  // доп. поля для реализма
  M.forEach(function (e, i) {
    e.is_self_employed = e.mode === 'se' || e.mode === 'ndfl';
    e.official = 0;
    e.warning = (e.id === 128); // незакрытый табель — «Внимание» (мягкое)
    // to_pay = carry_debt − carry_advance + accrued + bonus − penalty − advance − official
    e.to_pay = Math.round((e.carryDebt - e.carryAdvance + e.accrued + e.bonus - e.penalty - e.advance - e.official) * 100) / 100;
    e.paid_this_period = false;
    e.has_payment_this_period = false;
    // месячный лимит НПД (settings.self_employed_monthly_limit)
    e.se_limit = 350000;
    e.se_used = e.id === 10030 ? 322000 : (e.id === 212 ? 318000 : 120000 + (i * 7000) % 180000);
    e.se_left = Math.max(0, e.se_limit - e.se_used);
  });

  // Вторые получатели (для проверки выбора «через кого»). У части рабочих — 2.
  var PAYEE2 = {
    9869: { id: 10062, fio: 'Андрющенко Ольга Петровна', phone: '79131112233' },
    102:  { id: 10063, fio: 'Зарипова Алсу Раисовна', phone: '79132224455' },
  };
  var PAYEES = {
    128: { id: 10061, fio: 'Китуашвили Тамара Сергеевна', phone: '79276217721' },
    9869: { id: 10060, fio: 'Андрющенко Сергей Петрович', phone: '79131119988' },
    102:  { id: 10064, fio: 'Зарипов Ильдар Раисович', phone: '79132227766' }
  };
  M.forEach(function (e) {
    if (PAYEES[e.id]) e.payee = PAYEES[e.id];
    if (PAYEE2[e.id]) e.payee2 = PAYEE2[e.id];
  });

  // ── Персоны для доступа ────────────────────────────────────────────────
  var USERS = {
    dima: { id: 3465, name: 'Дмитрий Путков', role: 'BUH', label: 'Бухгалтер · выплаты' },
    ov:   { id: 3456, login: 'go', name: 'Гажилиев Олег Викторович', role: 'DIRECTOR_COMM', label: 'Генеральный директор' }
  };

  // ── Итоги периода ──────────────────────────────────────────────────────
  var TOTALS = { accrued: 0, carry: 0, carry_advance: 0, to_pay: 0, employees: M.length };
  M.forEach(function (e) {
    TOTALS.accrued += e.accrued;
    TOTALS.carry += (e.carryDebt - e.carryAdvance);
    TOTALS.carry_advance += e.carryAdvance;
    TOTALS.to_pay += e.to_pay;
  });

  // ── Серия по месяцам (для графика) ────────────────────────────────────
  var SERIES = [
    { month: 4, accrued: 3120000, paid: 2980000 },
    { month: 5, accrued: 3480000, paid: 3350000 },
    { month: 6, accrued: 3210000, paid: 3390000 },
    { month: 7, accrued: 3860000, paid: 3600000 },
    { month: 8, accrued: CONFIG_SUM('accrued'), paid: 3740000 },
    { month: 9, accrued: 4120000, paid: 0 }
  ];
  function CONFIG_SUM() { return TOTALS.accrued; }

  // ── График платежей: по дням месяца, 3 категории ──────────────────────
  var CHART_MONTHS = {}; // 'YYYY-MM' -> [{day, se, cash, ndfl}]
  (function seedChart() {
    function mk(key, n, base) {
      var arr = [];
      for (var d = 1; d <= n; d++) {
        // пики 5, 15, 25 — типовые дни выплат
        var spike = (d === 5 || d === 15 || d === 25);
        arr.push({
          day: d,
          se: spike ? 420000 + ((d * 37) % 5) * 60000 : ((d % 7 === 0) ? 90000 : 0),
          cash: spike ? 180000 + ((d * 53) % 4) * 40000 : ((d % 5 === 0) ? 45000 : 0),
          ndfl: spike ? 210000 + ((d * 29) % 3) * 50000 : ((d % 9 === 0) ? 60000 : 0)
        });
      }
      return arr;
    }
    CHART_MONTHS['2026-09'] = mk('2026-09', 30);
    CHART_MONTHS['2026-10'] = mk('2026-10', 31);
    CHART_MONTHS['2026-11'] = mk('2026-11', 30);
  })();

  // ── Кому платим в конкретный день (для модалки графика) ────────────────
  // Раздаём работников по типовым дням выплат (5 / 15 / 25), сохраняя порядок.
  var CHART_DAY_PAYEES = { 5: [], 15: [], 25: [] };
  (function seedDayPayees() {
    var days = [5, 15, 25], k = 0;
    M.forEach(function (e) {
      CHART_DAY_PAYEES[days[k % 3]].push(e.id);
      k++;
    });
  })();
  function payeesForDay(day) {
    var ids = CHART_DAY_PAYEES[day];
    if (!ids) return [];
    return ids.map(function (id) { return byId(id); }).filter(Boolean);
  }

  // ── План ОВ на месяц (1-е число) ───────────────────────────────────────
  // items: employee_id, to_transfer, pay_date, payee_id, approved
  var PLAN = {
    month: { year: 2026, month: 10 },
    items: []
  };
  (function seedPlan() {
    var payees = { 9869: 10060, 102: 10064, 128: 10061 };
    M.forEach(function (e, i) {
      var limit = (e.mode === 'se') ? e.se_left : e.to_pay;
      PLAN.items.push({
        employee_id: e.id,
        to_transfer: 0,                       // заполнит ОВ
        max_amount: D_r2(Math.max(0, Math.min(e.to_pay, limit))),
        pay_date: '05.11.2026',
        payee_id: payees[e.id] || null,
        approved: false
      });
    });
  })();
  function D_r2(v) { return Math.round(v * 100) / 100; }
  var CASH_REQUESTS = [
    { id: 4796, requester: 'Соколов Роман', role: 'РП', purpose: 'Суточные дружине · Северная башня', amount: 84000,  work: 'монтаж ВОЛС', created: '14.10 08:20', status: 'requested' },
    { id: 4817, requester: 'Морозов Игорь', role: 'РП', purpose: 'Закупка расходников, объект 12',     amount: 32500,  work: 'СМР', created: '14.10 09:05', status: 'requested' },
    { id: 4819, requester: 'Людкевич Андрей', role: 'ТО', purpose: 'Командировка: билеты + проживание', amount: 118000, work: 'ПНР', created: '14.10 10:40', status: 'requested' },
    { id: 4801, requester: 'Долгов Вадим', role: 'РП', purpose: 'Аренда инструмента, 3 суток',        amount: 27000,  work: 'монтаж', created: '13.10 16:10', status: 'question' }
  ];

  // ── Заявки ОВ: счета на оплату ─────────────────────────────────────────
  var INVOICES = [
    { id: 1204, supplier: 'ООО «Северсталь-Метиз»', amount: 486000, number: 'УТ-4471', due: '18.10.2026', basis: 'Договор 14/2026 · работы', created: '14.10 07:55', status: 'awaiting_dir', vat: '22%' },
    { id: 1203, supplier: 'ООО «Кабель-Профи»',     amount: 214300, number: 'КП-2201', due: '16.10.2026', basis: 'Счёт за материалы', created: '13.10 18:30', status: 'awaiting_dir', vat: '22%' },
    { id: 1202, supplier: 'ИП Афанасьев (перевозка)', amount: 68000, number: 'АФ-77',  due: '15.10.2026', basis: 'Разовые перевозки', created: '13.10 14:12', status: 'awaiting_dir', vat: '6%' },
    { id: 1200, supplier: 'ООО «Промэлектро»',      amount: 129000, number: 'ПЭ-889',  due: '20.10.2026', basis: 'Договор 09/2026 · ПНР', created: '12.10 11:00', status: 'awaiting_dir', vat: '22%' }
  ];

  // ── Пачки выплат от Димы (в корзине) ───────────────────────────────────
  // batch: { id, created_by, period, status, items: [{employee_id, kind, pay_amount, ...}] }
  var BATCH_NEW = {
    id: 'BATCH-NEW', created_by: USERS.dima.name, period: PERIOD,
    status: 'draft', submitted_at: null, decided_by: null, decision_comment: null,
    items: [
      { employee_id: 9869,  kind: 'advance', pay_amount: 39500,  comment: 'Закрываю сентябрь, аванс зачёл' },
      { employee_id: 102,   kind: 'salary',  pay_amount: 219000, comment: 'Остаток августа' },
      { employee_id: 128,   kind: 'salary',  pay_amount: 125496, comment: 'Остаток августа + сентябрь' }
    ]
  };

  var BATCH_PENDING = {
    id: 'BATCH-2417', created_by: USERS.dima.name, period: PERIOD,
    status: 'pending_approval', submitted_at: '14.10 09:40', decided_by: null, decision_comment: null,
    items: [
      { employee_id: 20,    kind: 'salary',  pay_amount: 202500, comment: 'Сентябрь полностью' },
      { employee_id: 102,   kind: 'salary',  pay_amount: 219000, comment: 'Остаток августа' },
      { employee_id: 10067, kind: 'advance', pay_amount: 150000, comment: 'Аванс 50%' },
      { employee_id: 161,   kind: 'salary',  pay_amount: 240000, comment: '' },
      { employee_id: 10030, kind: 'salary',  pay_amount: 66000,  comment: 'Закрываю минус по авансу' },
      { employee_id: 128,   kind: 'salary',  pay_amount: 125496, comment: 'Остаток августа' },
      { employee_id: 84,    kind: 'salary',  pay_amount: 195000, comment: '' },
      { employee_id: 212,   kind: 'salary',  pay_amount: 154000, comment: '' },
      { employee_id: 240,   kind: 'salary',  pay_amount: 132000, comment: '' },
      { employee_id: 150,   kind: 'salary',  pay_amount: 210000, comment: '' },
      { employee_id: 247,   kind: 'salary',  pay_amount: 205000, comment: '' },
      { employee_id: 320,   kind: 'salary',  pay_amount: 148000, comment: '' }
    ]
  };

  // Дима уже собрал корзину в пачке BATCH-NEW (для экрана Дими)
  BATCH_NEW.items.forEach(function (it) {
    var e = byId(it.employee_id);
    if (e) { e.paid_this_period = false; e.has_payment_this_period = true; e.draft_amount = it.pay_amount; e.draft_kind = it.kind; }
  });

  function byId(id) { for (var i = 0; i < M.length; i++) if (M[i].id === id) return M[i]; return null; }

  // ── Расчёт «человеку придёт» и «всего к переводу» ─────────────────────
  function calcItem(emp, payAmount) {
    if (!emp) return { gotAmount: payAmount, totalAmount: payAmount, taxAmount: 0, method: 'cash' };
    var x = payAmount;
    if (emp.mode === 'se') {
      return { gotAmount: r2(x * CALC.seInfoCoef), totalAmount: r2(x * CALC.seTransferCoef), taxAmount: r2(x * CALC.seTransferCoef - x), method: 'se' };
    }
    if (emp.mode === 'ndfl') {
      var t = r2(x * (1 + CALC.officialMarkupRate));
      return { gotAmount: t, totalAmount: t, taxAmount: r2(t - x), method: 'ndfl' };
    }
    return { gotAmount: x, totalAmount: x, taxAmount: 0, method: 'cash' };
  }
  function r2(v) { return Math.round(v * 100) / 100; }
  function modeLabel(mode) {
    if (mode === 'se') return { t: 'СЗ', cls: 'pp-tag--se', d: 'самозанятый · ReStaff' };
    if (mode === 'ndfl') return { t: 'НДФЛ', cls: 'pp-tag--ndfl', d: 'Перевод с НДФЛ · +15%' };
    if (mode === 'official') return { t: 'Оклад', cls: 'pp-tag--ndfl', d: 'оклад · бухгалтерия' };
    return { t: 'Наличные', cls: 'pp-tag--cash', d: 'касса' };
  }

  /** Список получателей рабочего (до 2) — для выбора «через кого». */
  function payeesOf(emp) {
    if (!emp) return [];
    var out = [];
    if (emp.payee) out.push(emp.payee);
    if (emp.payee2) out.push(emp.payee2);
    return out;
  }
  /** Двухбуквенные инициалы получателя. */
  function payeeShort(p) {
    if (!p) return '';
    var a = String(p.fio).split(' ');
    return a[0] + ' ' + (a[1] ? a[1][0] + '.' : '');
  }

  function batchTotals(batch) {
    var t = { pay: 0, got: 0, total: 0, count: batch.items.length };
    batch.items.forEach(function (it) {
      var e = byId(it.employee_id);
      var c = calcItem(e, it.pay_amount);
      t.pay += it.pay_amount; t.got += c.gotAmount; t.total += c.totalAmount;
    });
    t.pay = r2(t.pay); t.got = r2(t.got); t.total = r2(t.total);
    return t;
  }

  // ── Агрегаты: график и план ────────────────────────────────────────────
  function chartFor(year, month) {
    var key = year + '-' + String(month).padStart(2, '0');
    return CHART_MONTHS[key] || CHART_MONTHS['2026-10'];
  }
  function planTotals() {
    var total = 0, approved = 0, approvedSum = 0, byCat = { se: 0, cash: 0, ndfl: 0 };
    PLAN.items.forEach(function (p) {
      var e = byId(p.employee_id);
      total = r2(total + p.max_amount);
      if (p.approved) { approved++; approvedSum = r2(approvedSum + p.to_transfer); }
      var cat = !e ? 'cash' : (e.mode === 'se' ? 'se' : (e.mode === 'ndfl' ? 'ndfl' : 'cash'));
      byCat[cat] = r2(byCat[cat] + p.max_amount);
    });
    return { total: total, approved: approved, approvedSum: approvedSum, count: PLAN.items.length, byCat: byCat };
  }

  function money(v) {    if (v == null) return '—';
    return Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  function moneyRub(v) { return money(v) + ' ₽'; }

  return {
    CALC: CALC, PERIOD: PERIOD, MONTHS: MONTHS, M: M, USERS: USERS,
    TOTALS: TOTALS, SERIES: SERIES,
    CASH_REQUESTS: CASH_REQUESTS, INVOICES: INVOICES,
    BATCH_NEW: BATCH_NEW, BATCH_PENDING: BATCH_PENDING,
    byId: byId, calcItem: calcItem, modeLabel: modeLabel, batchTotals: batchTotals,
    payeesOf: payeesOf, payeeShort: payeeShort,
    PLAN: PLAN, CHART_MONTHS: CHART_MONTHS, chartFor: chartFor, planTotals: planTotals, payeesForDay: payeesForDay,
    money: money, moneyRub: moneyRub, r2: r2
  };
})();
