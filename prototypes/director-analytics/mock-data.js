/* ASGARD CRM · Дашборд руководителя — демо-данные v3
   Офлайн-мок без сети. Суммы согласованы: цена работ = сумма позиций сметы,
   НДС 20 %. «Корзина» — это статус заявки (trash), отдельного раздела нет. */
window.ASGARD_DIRECTOR_MOCK = (function () {
  'use strict';

  const NOW = (function () {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    return d;
  })();

  function iso(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }
  function daysAgo(n) {
    const d = new Date(NOW);
    d.setDate(d.getDate() - n);
    return iso(d);
  }
  function daysAhead(n) {
    return daysAgo(-n);
  }
  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  /* ── Люди ─────────────────────────────────────────────────────────────── */
  const CALC = [
    { id: 'u11', name: 'Алексеев Д.С.', kind: 'pm', post: 'Калькулятор · пром' },
    { id: 'u12', name: 'Морозова Е.В.', kind: 'to', post: 'Калькулятор · ТО' },
    { id: 'u13', name: 'Громов И.П.', kind: 'pm', post: 'Калькулятор · пром' }
  ];
  const ANALYSTS = [
    { id: 'u21', name: 'Кузнецова А.Н.', post: 'Аналитик' },
    { id: 'u22', name: 'Серов М.А.', post: 'Аналитик' },
    { id: 'u23', name: 'Павлова О.И.', post: 'Аналитик' }
  ];
  const PMS = [
    { id: 'u31', name: 'Никитин В.Р.', post: 'РП' },
    { id: 'u32', name: 'Орлова Т.К.', post: 'РП' },
    { id: 'u33', name: 'Белов С.Ю.', post: 'РП' },
    { id: 'u34', name: 'Егорова Н.Л.', post: 'РП' }
  ];

  const BRIGADE_NAMES = [
    'Смирнов Алексей Викторович',
    'Козлов Павел Игоревич',
    'Васильев Дмитрий Николаевич',
    'Новиков Роман Сергеевич',
    'Фёдоров Кирилл Михайлович',
    'Михайлов Егор Андреевич',
    'Соколов Илья Геннадьевич',
    'Лебедев Юрий Валерьевич',
    'Гусев Артём Олегович',
    'Титов Максим Юрьевич',
    'Зайцев Никита Павлович',
    'Богданов Сергей Иванович'
  ];

  const CHANNELS = {
    email: 'Почта',
    phone: 'Телефония',
    manual: 'Вручную',
    etp: 'Площадка',
    site: 'Сайт'
  };

  /* ── Статусы ──────────────────────────────────────────────────────────── */
  const TENDER_STATUSES = [
    { id: 'рассмотрение', label: 'Рассмотрение', tone: 'info' },
    { id: 'готовим', label: 'Готовим', tone: 'blue' },
    { id: 'подались', label: 'Подались', tone: 'warn' },
    { id: 'выиграли', label: 'Выиграли', tone: 'ok' },
    { id: 'проиграли', label: 'Проиграли', tone: 'err' },
    { id: 'отмена', label: 'Отмена', tone: 'muted' }
  ];

  /* 11 статусов канбана заявок — «Корзина» здесь последний статус, не раздел */
  const APP_STATUSES = [
    { id: 'new', label: 'Новые', tone: 'warn' },
    { id: 'calc', label: 'Просчёт', tone: 'blue' },
    { id: 'approval', label: 'Согласование', tone: 'info' },
    { id: 'kp_prep', label: 'КП готов', tone: 'blue' },
    { id: 'sent', label: 'КП ушло', tone: 'info' },
    { id: 'addendum', label: 'Дозапрос', tone: 'warn' },
    { id: 'win', label: 'Выиграно', tone: 'ok' },
    { id: 'lose', label: 'Проиграно', tone: 'err' },
    { id: 'work', label: 'В работе', tone: 'ok' },
    { id: 'done', label: 'Завершено', tone: 'ok' },
    { id: 'trash', label: 'Корзина', tone: 'muted' }
  ];

  const WORK_STATUSES = [
    { id: 'active', label: 'Активные', tone: 'ok' },
    { id: 'pause', label: 'На паузе', tone: 'warn' },
    { id: 'archive', label: 'Архив', tone: 'muted' }
  ];

  const PERIODS = {
    month: { id: 'month', label: 'Месяц', days: 30 },
    half_year: { id: 'half_year', label: 'Полгода', days: 183 },
    year: { id: 'year', label: 'Год', days: 365 },
    all: { id: 'all', label: 'Всё время', days: null }
  };

  function inPeriod(dateIso, periodId) {
    if (!dateIso) return false;
    const p = PERIODS[periodId] || PERIODS.month;
    if (!p.days) return true;
    const d = new Date(dateIso + 'T12:00:00');
    const diff = (NOW - d) / 86400000;
    return diff >= 0 && diff <= p.days;
  }

  /* ── Смета ────────────────────────────────────────────────────────────── */
  const EST_POOLS = {
    asutp: [
      { name: 'Обследование объекта, сбор исходных данных', unit: 'объект', qty: 1 },
      { name: 'Разработка ПО ПЛК и верхнего уровня', unit: 'компл.', qty: 1 },
      { name: 'Монтаж шкафов ШУ и КИП', unit: 'шкаф', qty: 6 },
      { name: 'Прокладка кабеля и обвязка', unit: 'м', qty: 850 },
      { name: 'Пусконаладка контуров регулирования', unit: 'контур', qty: 24 },
      { name: 'Вахта и проживание бригады', unit: 'чел.-мес.', qty: 4 },
      { name: 'Оборудование: ПЛК, ИБП, панели оператора', unit: 'компл.', qty: 1 },
      { name: 'Проектная и исполнительная документация', unit: 'компл.', qty: 1 }
    ],
    kip: [
      { name: 'Обследование КИП на объекте', unit: 'объект', qty: 1 },
      { name: 'Поверка и калибровка датчиков', unit: 'датчик', qty: 42 },
      { name: 'Монтаж датчиков и импульсных линий', unit: 'шт.', qty: 38 },
      { name: 'Наладка контуров измерения', unit: 'контур', qty: 18 },
      { name: 'Вахтовые затраты бригады', unit: 'чел.-мес.', qty: 3 },
      { name: 'Расходные материалы и арматура', unit: 'компл.', qty: 1 }
    ],
    shu: [
      { name: 'Обследование и согласование схемы щита', unit: 'объект', qty: 1 },
      { name: 'Сборка щитов ШУ', unit: 'шкаф', qty: 4 },
      { name: 'Комплектующие: автоматы, клеммы, реле', unit: 'компл.', qty: 1 },
      { name: 'Монтаж и подключение щитов на объекте', unit: 'шкаф', qty: 4 },
      { name: 'Пусконаладка схем управления', unit: 'схема', qty: 8 },
      { name: 'Доставка и такелаж', unit: 'рейс', qty: 2 }
    ],
    boiler: [
      { name: 'Обследование котельной и тепломеханической схемы', unit: 'объект', qty: 1 },
      { name: 'Монтаж шкафа автоматики котла', unit: 'шкаф', qty: 2 },
      { name: 'Приборы КИП и предохранительная автоматика', unit: 'компл.', qty: 1 },
      { name: 'Трубная обвязка и кабельные трассы', unit: 'м', qty: 320 },
      { name: 'Пусконаладка режимных карт', unit: 'режим', qty: 6 },
      { name: 'Вахта и проживание', unit: 'чел.-мес.', qty: 3 }
    ],
    service: [
      { name: 'Регламентное обслуживание АСУТП', unit: 'мес.', qty: 12 },
      { name: 'Выезды инженера на объект', unit: 'выезд', qty: 24 },
      { name: 'ЗИП и расходные материалы', unit: 'компл.', qty: 1 },
      { name: 'Удалённая поддержка и обновления ПО', unit: 'мес.', qty: 12 },
      { name: 'Диагностика отказов и отчёты', unit: 'компл.', qty: 1 },
      { name: 'Обучение персонала заказчика', unit: 'чел.', qty: 8 }
    ]
  };

  function mkEstimate(poolKey, target, seed) {
    const pool = EST_POOLS[poolKey] || EST_POOLS.asutp;
    const n = 5 + (seed % 3); // 5..7 позиций
    const picked = [];
    for (let i = 0; i < n; i++) picked.push(pool[(seed + i) % pool.length]);

    const weights = picked.map((_, i) => 1 + ((seed * 5 + i * 7) % 4));
    const wsum = weights.reduce((a, b) => a + b, 0);
    const costRatios = [0.74, 0.79, 0.83, 0.86, 0.71, 0.81];

    let used = 0;
    const rows = picked.map((p, i) => {
      const last = i === picked.length - 1;
      const sum = last
        ? target - used
        : Math.round((target * weights[i]) / wsum / 1000) * 1000;
      used += sum;

      const ratio = costRatios[(seed + i) % costRatios.length];
      const cost = Math.round((sum * ratio) / 1000) * 1000;
      const qty = p.qty === 1 ? 1 : p.qty + ((seed + i) % 4) * (p.qty > 100 ? 25 : 2);

      return {
        name: p.name,
        unit: p.unit,
        qty: qty,
        sum: sum,
        cost: cost,
        margin_pct: sum ? round1(((sum - cost) / sum) * 100) : 0
      };
    });

    const total = rows.reduce((a, r) => a + r.sum, 0);
    const costTotal = rows.reduce((a, r) => a + r.cost, 0);
    const vat = Math.round(total * 0.2);

    return {
      rows: rows,
      total_no_vat: total,
      cost_total: costTotal,
      margin_rub: total - costTotal,
      margin_pct: total ? round1(((total - costTotal) / total) * 100) : 0,
      vat_pct: 20,
      vat: vat,
      total_with_vat: total + vat
    };
  }

  /* ── Тендеры ──────────────────────────────────────────────────────────── */
  const TENDERS = [
    {
      id: 't-2418',
      title: 'ПНР систем АСУТП цеха №3',
      customer: 'АО «Северсталь»',
      inn: '3528000597',
      region: 'Вологодская обл., Череповец',
      platform: 'РТС-тендер',
      link: 'https://www.rts-tender.ru/',
      notice: '0373100054326000123',
      nmck: 18450000,
      price: 12680000,
      pool: 'asutp',
      registry_status: 'рассмотрение',
      tender_status: 'анализ',
      date: daysAgo(3),
      deadline: daysAhead(12),
      calcIdx: 0,
      anIdx: 1,
      pmIdx: 0,
      checklist: [
        { text: 'НМЦК сверена с извещением', done: true, date: daysAgo(3) },
        { text: 'Обеспечение заявки рассчитано', done: true, date: daysAgo(2) },
        { text: 'Запрос сертификатов на оборудование', done: false, due: daysAhead(4) },
        { text: 'Согласование директора: цена выше 10 млн', done: false, due: daysAhead(6) },
        { text: 'Оценка рисков вахты', done: true, date: daysAgo(1) }
      ],
      recommendation: 'Идти. Маржа держится при доле оборудования не выше 32 %. Нужна вахта 8 человек на 14 дней пусконаладки.',
      report: {
        decision: 'submit',
        text: 'Объект типовой по АСУТП, схему цеха знаем по работам 2024 года. Главный риск — сжатые сроки ПНР: 14 дней на 24 контура при готовности шкафов 80 %. Конкуренты локальные, ценовой запас около 4 %. Предлагаю подаваться и заранее забронировать вахту.',
        author: 'Никитин В.Р.',
        date: daysAgo(1)
      },
      docs: [
        { name: 'Извещение.pdf', ext: 'pdf', size: '1,2 МБ', date: daysAgo(3) },
        { name: 'Техническое задание.docx', ext: 'docx', size: '840 КБ', date: daysAgo(3) },
        { name: 'Проект договора.pdf', ext: 'pdf', size: '620 КБ', date: daysAgo(3) },
        { name: 'Ведомость объёмов.xlsx', ext: 'xlsx', size: '210 КБ', date: daysAgo(2) }
      ]
    },
    {
      id: 't-2417',
      title: 'Монтаж и пуск КИПиА линии фасовки',
      customer: 'ООО «ЮНИКС Фудс»',
      inn: '4345012345',
      region: 'Кировская обл., Киров',
      platform: 'Сбербанк-АСТ',
      link: 'https://www.sberbank-ast.ru/',
      notice: '0848300050626000087',
      nmck: 9720000,
      price: 7140000,
      pool: 'kip',
      registry_status: 'готовим',
      tender_status: 'подготовка',
      date: daysAgo(11),
      deadline: daysAhead(6),
      calcIdx: 1,
      anIdx: 0,
      pmIdx: 1,
      checklist: [
        { text: 'Проверка допусков сварщиков', done: true, date: daysAgo(8) },
        { text: 'Смета Асгард собрана', done: true, date: daysAgo(6) },
        { text: 'КП поставщика КИП получено', done: true, date: daysAgo(4) },
        { text: 'Пакет документов на подачу собран', done: false, due: daysAhead(3) }
      ],
      recommendation: 'Заказчик знакомый, работали на линии №2. Выезд аналитика на осмотр шкафов обязателен до подачи.',
      report: {
        decision: 'submit',
        text: 'Заказчик знакомый, на линии №2 работали в 2025 году. Нужен выезд аналитика на осмотр шкафов и уточнение по импортным датчикам. Обеспечение заявки — 5 % от НМЦК. Готовим к подаче на следующей неделе.',
        author: 'Орлова Т.К.',
        date: daysAgo(3)
      },
      docs: [
        { name: 'Извещение.pdf', ext: 'pdf', size: '980 КБ', date: daysAgo(11) },
        { name: 'Ведомость объёмов.xlsx', ext: 'xlsx', size: '210 КБ', date: daysAgo(10) },
        { name: 'Схема объекта.pdf', ext: 'pdf', size: '3,4 МБ', date: daysAgo(9) }
      ]
    },
    {
      id: 't-2415',
      title: 'Техническое обслуживание АСУТП ГРП',
      customer: 'ПАО «Газпром нефть»',
      inn: '5504036333',
      region: 'ЯНАО, Ноябрьск',
      platform: 'ЭТП ГПБ',
      link: 'https://etpgpb.ru/',
      notice: '3200976543210000045',
      nmck: 24600000,
      price: 19850000,
      pool: 'service',
      registry_status: 'подались',
      tender_status: 'на рассмотрении ЭТП',
      date: daysAgo(28),
      deadline: daysAgo(3),
      calcIdx: 2,
      anIdx: 2,
      pmIdx: 2,
      checklist: [
        { text: 'Подача завершена, протокол получен', done: true, date: daysAgo(3) },
        { text: 'Протокол вскрытия отслежен', done: false, due: daysAhead(9) },
        { text: 'Запасной канал связи с ЭТП проверен', done: true, date: daysAgo(4) }
      ],
      recommendation: 'Подались вторыми по цене. При выигрыше сразу бронировать вахту на ЯНАО — окно заезда с 1 декабря.',
      report: {
        decision: 'submit',
        text: 'Подались вторыми по цене, отрыв от лидера 2,1 %. Конкурент — «ПромАвтоматика», работает через местный персонал. Ждём протокол. При выигрыше бронировать вахту сразу, иначе не попадём в график ГРП.',
        author: 'Белов С.Ю.',
        date: daysAgo(2)
      },
      docs: [
        { name: 'Заявка подписана.pdf', ext: 'pdf', size: '1,1 МБ', date: daysAgo(3) },
        { name: 'Обеспечение заявки.pdf', ext: 'pdf', size: '440 КБ', date: daysAgo(4) },
        { name: 'Смета заказчика.pdf', ext: 'pdf', size: '2,0 МБ', date: daysAgo(26) }
      ]
    },
    {
      id: 't-2409',
      title: 'Реконструкция щита управления насосной',
      customer: 'МУП «Водоканал» г. Киров',
      inn: '4345001234',
      region: 'Кировская обл., Киров',
      platform: 'ЕИС',
      link: 'https://zakupki.gov.ru/',
      notice: '0162300005625000199',
      nmck: 6850000,
      price: 6120000,
      pool: 'shu',
      registry_status: 'выиграли',
      tender_status: 'контракт',
      date: daysAgo(24),
      deadline: daysAgo(12),
      calcIdx: 0,
      anIdx: 0,
      pmIdx: 3,
      checklist: [
        { text: 'Протокол победы получен', done: true, date: daysAgo(12) },
        { text: 'Аванс 30 % согласован', done: true, date: daysAgo(10) },
        { text: 'Передача карточки в работы', done: true, date: daysAgo(9) }
      ],
      recommendation: 'Выиграли с отрывом 4,8 %. Передаём Егоровой, старт работ в этом месяце.',
      report: {
        decision: 'submit',
        text: 'Выиграли с отрывом 4,8 % от второго предложения. Контракт на подписи, аванс 30 % согласован. Объект передан РП Егоровой, старт работ в текущем месяце.',
        author: 'Егорова Н.Л.',
        date: daysAgo(11)
      },
      docs: [
        { name: 'Протокол победы.pdf', ext: 'pdf', size: '380 КБ', date: daysAgo(12) },
        { name: 'Контракт проект.docx', ext: 'docx', size: '520 КБ', date: daysAgo(10) },
        { name: 'График работ.xlsx', ext: 'xlsx', size: '90 КБ', date: daysAgo(9) }
      ]
    },
    {
      id: 't-2404',
      title: 'Поставка и наладка шкафов ШУ',
      customer: 'АО «Транснефть — Верхняя Волга»',
      inn: '5260001234',
      region: 'Нижегородская обл., Кстово',
      platform: 'Фабрикант',
      link: 'https://www.fabrikant.ru/',
      notice: '3190870012345000071',
      nmck: 15200000,
      price: 14120000,
      pool: 'shu',
      registry_status: 'проиграли',
      tender_status: 'закрыт',
      date: daysAgo(26),
      deadline: daysAgo(14),
      calcIdx: 1,
      anIdx: 1,
      pmIdx: 0,
      checklist: [
        { text: 'Разбор поражения проведён', done: true, date: daysAgo(8) },
        { text: 'Цена победителя зафиксирована', done: true, date: daysAgo(8) }
      ],
      recommendation: 'Проигрыш по цене: логистика шкафов съела запас. В следующий раз собирать щиты на локальном складе.',
      report: {
        decision: 'submit',
        text: 'Проиграли по цене: минус 6,2 % к победителю. Состав сметы сходился, просели на логистике шкафов из Кирова. Вывод — собирать щиты на локальном складе в Кстово, тогда запас 4 % остаётся.',
        author: 'Никитин В.Р.',
        date: daysAgo(13)
      },
      docs: [
        { name: 'Протокол итогов.pdf', ext: 'pdf', size: '290 КБ', date: daysAgo(14) },
        { name: 'Наша заявка.zip', ext: 'zip', size: '8,1 МБ', date: daysAgo(15) }
      ]
    },
    {
      id: 't-2402',
      title: 'Обслуживание АРМ операторов НПС',
      customer: 'ООО «Лукойл-Пермнефтеоргсинтез»',
      inn: '5902001234',
      region: 'Пермский край, Пермь',
      platform: 'РТС-тендер',
      link: 'https://www.rts-tender.ru/',
      notice: '0373100041125000330',
      nmck: 4200000,
      price: 3850000,
      pool: 'service',
      registry_status: 'отмена',
      tender_status: 'отменён заказчиком',
      date: daysAgo(40),
      deadline: daysAgo(30),
      calcIdx: 2,
      anIdx: 2,
      pmIdx: 1,
      checklist: [
        { text: 'Отмена заказчиком подтверждена', done: true, date: daysAgo(30) },
        { text: 'Трудозатраты списаны на анализ', done: true, date: daysAgo(29) }
      ],
      recommendation: 'Не подаём: процедура отменена заказчиком. Часы аналитика закрыты на внутренний код «анализ».',
      report: {
        decision: 'reject',
        text: 'Процедура отменена заказчиком: изменили техническое задание по составу АРМ. Часы аналитика и калькулятора закрыты на внутренний код «анализ». Возврат к лоту ожидаем в первом квартале.',
        author: 'Орлова Т.К.',
        date: daysAgo(30)
      },
      docs: [{ name: 'Извещение об отмене.pdf', ext: 'pdf', size: '180 КБ', date: daysAgo(30) }]
    },
    {
      id: 't-2419',
      title: 'Модернизация АСУТП компрессорной',
      customer: 'ПАО «СИБУР Холдинг»',
      inn: '7727547295',
      region: 'Тюменская обл., Тобольск',
      platform: 'B2B-Center',
      link: 'https://www.b2b-center.ru/',
      notice: '3201122334455000102',
      nmck: 31200000,
      price: 24800000,
      pool: 'asutp',
      registry_status: 'рассмотрение',
      tender_status: 'анализ',
      date: daysAgo(2),
      deadline: daysAhead(18),
      calcIdx: 1,
      anIdx: 0,
      pmIdx: 2,
      checklist: [
        { text: 'Первичный разбор ТЗ', done: true, date: daysAgo(2) },
        { text: 'Запрос КП у производителя ПЛК', done: false, due: daysAhead(5) },
        { text: 'Оценка вахты и проживания', done: false, due: daysAhead(6) },
        { text: 'Порог согласования директора', done: false, due: daysAhead(10) }
      ],
      recommendation: 'Крупный лот, порог директора. Ждём КП Siemens и ОВЕН. Риск — длинная логистика ПЛК, 8 недель.',
      report: {
        decision: 'submit',
        text: 'Крупный лот на 31,2 млн. Порог директора, без вашего согласования не подаёмся. Ждём коммерческие предложения Siemens и ОВЕН, аналитик выезжает на объект на следующей неделе. Риск — логистика ПЛК до 8 недель.',
        author: 'Белов С.Ю.',
        date: daysAgo(1)
      },
      docs: [
        { name: 'Извещение.pdf', ext: 'pdf', size: '1,5 МБ', date: daysAgo(2) },
        { name: 'Опросный лист.xlsx', ext: 'xlsx', size: '160 КБ', date: daysAgo(2) },
        { name: 'ТЗ дополнительное.pdf', ext: 'pdf', size: '2,1 МБ', date: daysAgo(1) }
      ]
    },
    {
      id: 't-2416',
      title: 'Диагностика и ремонт шкафов РСУ',
      customer: 'АО «Апатит»',
      inn: '5107001234',
      region: 'Мурманская обл., Кировск',
      platform: 'ЕИС',
      link: 'https://zakupki.gov.ru/',
      notice: '0158300011226000044',
      nmck: 5600000,
      price: 4980000,
      pool: 'shu',
      registry_status: 'готовим',
      tender_status: 'подготовка',
      date: daysAgo(8),
      deadline: daysAhead(4),
      calcIdx: 0,
      anIdx: 2,
      pmIdx: 3,
      checklist: [
        { text: 'Смета собрана', done: true, date: daysAgo(5) },
        { text: 'Согласование с РП пройдено', done: true, date: daysAgo(4) },
        { text: 'Пакет ЭЦП подготовлен', done: false, due: daysAhead(2) }
      ],
      recommendation: 'Небольшой лот с высокой маржой. Эскалация директору не нужна, подаём в пятницу.',
      report: {
        decision: 'submit',
        text: 'Небольшой лот, маржа выше средней по портфелю. Фотографии дефектов подтверждают объём, спорных позиций нет. Готовим подачу без эскалации, подаём в пятницу.',
        author: 'Егорова Н.Л.',
        date: daysAgo(4)
      },
      docs: [
        { name: 'ТЗ.pdf', ext: 'pdf', size: '720 КБ', date: daysAgo(8) },
        { name: 'Фото дефектов.zip', ext: 'zip', size: '14 МБ', date: daysAgo(7) }
      ]
    },
    {
      id: 't-2413',
      title: 'ПНР котельной АСУ',
      customer: 'ООО «Теплоэнергосервис»',
      inn: '1103001234',
      region: 'Респ. Коми, Сыктывкар',
      platform: 'Сбербанк-АСТ',
      link: 'https://www.sberbank-ast.ru/',
      notice: '0848300050625000777',
      nmck: 8900000,
      price: 7600000,
      pool: 'boiler',
      registry_status: 'подались',
      tender_status: 'на рассмотрении ЭТП',
      date: daysAgo(19),
      deadline: daysAgo(2),
      calcIdx: 2,
      anIdx: 1,
      pmIdx: 0,
      checklist: [
        { text: 'Подача завершена', done: true, date: daysAgo(2) },
        { text: 'Ожидание итогов', done: false, due: daysAhead(11) }
      ],
      recommendation: 'Подались. Итоги до конца месяца, объект знакомый, риски низкие.',
      report: {
        decision: 'submit',
        text: 'Подались, итоги до конца месяца. Объект знакомый: делали автоматику котла №2 в прошлом сезоне. Риски низкие, состав бригады известен.',
        author: 'Никитин В.Р.',
        date: daysAgo(2)
      },
      docs: [
        { name: 'Заявка.pdf', ext: 'pdf', size: '900 КБ', date: daysAgo(2) },
        { name: 'Расчёт обеспечения.xlsx', ext: 'xlsx', size: '55 КБ', date: daysAgo(18) }
      ]
    },
    {
      id: 't-2388',
      title: 'Сервис АСУТП фабрики окатышей',
      customer: 'АО «Карельский окатыш»',
      inn: '1001001234',
      region: 'Респ. Карелия, Костомукша',
      platform: 'ЭТП ГПБ',
      link: 'https://etpgpb.ru/',
      notice: '3200556677889000033',
      nmck: 17800000,
      price: 16550000,
      pool: 'service',
      registry_status: 'выиграли',
      tender_status: 'в работах',
      date: daysAgo(200),
      deadline: daysAgo(185),
      calcIdx: 1,
      anIdx: 0,
      pmIdx: 1,
      checklist: [
        { text: 'Контракт подписан', done: true, date: daysAgo(184) },
        { text: 'Старт работ', done: true, date: daysAgo(180) }
      ],
      recommendation: 'Годовой сервис, маржа в плане. Бригада на объекте стабильно, замен не было.',
      report: {
        decision: 'submit',
        text: 'Выигран годовой сервисный контракт. Работы идут по графику, маржа в плане. Бригада на объекте стабильно, замен не было.',
        author: 'Орлова Т.К.',
        date: daysAgo(184)
      },
      docs: [
        { name: 'Контракт.pdf', ext: 'pdf', size: '1,8 МБ', date: daysAgo(184) },
        { name: 'Акт передачи в работы.pdf', ext: 'pdf', size: '210 КБ', date: daysAgo(180) }
      ]
    },
    {
      id: 't-2381',
      title: 'Замена контроллеров линии сушки',
      customer: 'ООО «Кировский комбинат»',
      inn: '4345009876',
      region: 'Кировская обл., Киров',
      platform: 'ЕИС',
      link: 'https://zakupki.gov.ru/',
      notice: '0162300005624000881',
      nmck: 4300000,
      price: 4100000,
      pool: 'kip',
      registry_status: 'проиграли',
      tender_status: 'закрыт',
      date: daysAgo(240),
      deadline: daysAgo(225),
      calcIdx: 0,
      anIdx: 2,
      pmIdx: 2,
      checklist: [{ text: 'Разбор поражения', done: true, date: daysAgo(220) }],
      recommendation: 'Местный подрядчик демпинговал. Не оспариваем, цену зафиксировали.',
      report: {
        decision: 'submit',
        text: 'Местный подрядчик выиграл с демпингом 18 % от НМЦК. Не оспариваем: цена ниже нашей себестоимости. Зафиксировали конкурента в базе.',
        author: 'Белов С.Ю.',
        date: daysAgo(224)
      },
      docs: [{ name: 'Протокол.pdf', ext: 'pdf', size: '240 КБ', date: daysAgo(225) }]
    },
    {
      id: 't-2394',
      title: 'Обследование АСУТП цеха полимеров',
      customer: 'ПАО «Нижнекамскнефтехим»',
      inn: '1650001234',
      region: 'Респ. Татарстан, Нижнекамск',
      platform: 'B2B-Center',
      link: 'https://www.b2b-center.ru/',
      notice: '3200998877665000011',
      nmck: 2100000,
      price: 1950000,
      pool: 'asutp',
      registry_status: 'отмена',
      tender_status: 'отменён',
      date: daysAgo(16),
      deadline: daysAgo(10),
      calcIdx: 2,
      anIdx: 1,
      pmIdx: 3,
      checklist: [{ text: 'Закрыто без подачи', done: true, date: daysAgo(10) }],
      recommendation: 'Лот снят до подачи. Трудозатраты минимальные, переносим в план на весну.',
      report: {
        decision: 'reject',
        text: 'Заказчик снял лот до нашей подачи: перенесли обследование на весенний ремонт. Трудозатраты минимальные, переносим в план на апрель.',
        author: 'Егорова Н.Л.',
        date: daysAgo(10)
      },
      docs: [{ name: 'Отмена.pdf', ext: 'pdf', size: '120 КБ', date: daysAgo(10) }]
    }
  ];

  TENDERS.forEach(function (t, i) {
    const est = mkEstimate(t.pool, t.price, i + 1);
    t.estimate = est;
    t.work_price = est.total_no_vat;
    t.calculator = CALC[t.calcIdx];
    t.analyzer = ANALYSTS[t.anIdx];
    t.pm = PMS[t.pmIdx];
    t.rp_calc = {
      who: t.calculator,
      kind: t.calculator.kind,
      work_price: est.total_no_vat,
      cost: est.cost_total,
      margin_rub: est.margin_rub,
      margin_pct: est.margin_pct,
      decision: t.registry_status === 'отмена' ? 'reject' : 'submit',
      finalized_at: daysAgo(3 + (i % 6)),
      recommendation: t.recommendation
    };

    // ── Аудит карточки: кто завёл / анализировал / считал ──
    t.added_by = t.added_by || {
      name: t.pm.name,
      role: 'РП',
      at: t.date
    };
    t.analyzed_by = t.analyzed_by || {
      name: t.analyzer.name,
      role: 'Аналитик ТО',
      at: daysAgo(2 + (i % 5))
    };
    t.calculated_by = t.calculated_by || {
      name: t.calculator.name,
      role: t.calculator.kind === 'pm' ? 'Калькулятор · PM' : 'Калькулятор · TO',
      at: t.rp_calc.finalized_at
    };

    // ── Причины закрытия: отмена / проигрыш ──
    t.outcome = t.outcome || null;
    if (t.registry_status === 'отмена' && !t.outcome) {
      t.outcome = {
        kind: 'cancel',
        reason: t.cancel_reason || 'Заказчик снял лот до подачи',
        detail: 'Решение заказчика, не наша инициатива. Перенос на следующий период.',
        by: t.pm.name,
        at: t.deadline
      };
    }
    if (t.registry_status === 'проиграли' && !t.outcome) {
      t.outcome = {
        kind: 'lose',
        reason: t.lose_reason || 'Цена конкурента ниже нашей себестоимости',
        detail: 'Проигрыш по цене. Коммерческие условия конкурента перекрывают наш порог маржи.',
        by: t.pm.name,
        at: t.deadline
      };
    }
  });

  /* ── Заявки (11 статусов канбана) ─────────────────────────────────────── */
  const APPLICATIONS = [
    {
      id: 'a-6124',
      title: 'Просчёт шкафа управления насосами',
      customer: 'ООО «ПромСтройМонтаж»',
      status: 'new',
      channel: 'email',
      sender: { name: 'Кириллов А.С.', org: 'ПромСтройМонтаж', addr: 'kirillov@psm.ru' },
      created: daysAgo(0),
      deadline: daysAhead(5),
      amount: 2800000,
      pm: null,
      ai: {
        color: 'green',
        confidence: 0.91,
        summary: 'Коммерческий запрос на шкаф управления, 3 насоса 75 кВт. Профиль наш, сумма в пределах 3 млн. Просит выход РП на объект до конца недели.'
      },
      docs: [
        { name: 'Письмо заказчика.eml', ext: 'eml', size: '45 КБ', date: daysAgo(0) },
        { name: 'Опросный лист.xlsx', ext: 'xlsx', size: '88 КБ', date: daysAgo(0) }
      ],
      estimate: null,
      note: 'Нужен выход РП на объект до конца недели.',
      history: [
        { at: daysAgo(0), status: 'new', by: 'Почта · входящие', note: 'Письмо разобрано, карточка создана автоматически' }
      ]
    },
    {
      id: 'a-6123',
      title: 'ПНР линии розлива — запрос с площадки',
      customer: 'АО «Балтика»',
      status: 'new',
      channel: 'etp',
      sender: { name: 'Уведомление ЕИС', org: 'ЕИС', addr: 'noreply@zakupki.gov.ru' },
      created: daysAgo(1),
      deadline: daysAhead(3),
      amount: 9500000,
      pm: null,
      ai: {
        color: 'amber',
        confidence: 0.74,
        summary: 'Извещение ЕИС, НМЦК 9,5 млн. Требуется проверка допуска СРО и обеспечение заявки. ТЗ неоднозначное по составу шкафов.'
      },
      docs: [
        { name: 'Извещение.pdf', ext: 'pdf', size: '1,1 МБ', date: daysAgo(1) },
        { name: 'ТЗ.pdf', ext: 'pdf', size: '2,4 МБ', date: daysAgo(1) }
      ],
      estimate: null,
      note: 'РП Никитин в курсе, ждём решение по допуску.',
      history: [
        { at: daysAgo(1), status: 'new', by: 'Площадка ЕИС', note: 'Извещение импортировано' }
      ]
    },
    {
      id: 'a-6119',
      title: 'Модернизация АРМ диспетчера',
      customer: 'МУП «Горсвет»',
      status: 'calc',
      channel: 'manual',
      sender: { name: 'Орлова Т.К.', org: 'Асгард', addr: 'orlova@asgard-service.ru' },
      created: daysAgo(6),
      deadline: daysAhead(1),
      amount: 1450000,
      pm: PMS[1],
      ai: {
        color: 'green',
        confidence: 0.88,
        summary: 'Повторный заказчик, 4 АРМ и сервер. Смета собирается по прошлому проекту с коэффициентом 1,12.'
      },
      docs: [
        { name: 'Фото щита.zip', ext: 'zip', size: '6,2 МБ', date: daysAgo(6) },
        { name: 'Черновик сметы.json', ext: 'json', size: '24 КБ', date: daysAgo(2) }
      ],
      estimate: {
        title: 'Смета Асгард · АРМ диспетчера',
        total_no_vat: 1380000,
        cost_total: 1022000,
        margin_pct: 25.9,
        vat: 276000,
        total_with_vat: 1656000,
        rows: [
          { name: 'АРМ диспетчера (4 рабочих места)', unit: 'компл.', qty: 4, sum: 620000, cost: 452000 },
          { name: 'Сервер и сетевое оборудование', unit: 'компл.', qty: 1, sum: 380000, cost: 304000 },
          { name: 'Монтаж и пусконаладка', unit: 'объект', qty: 1, sum: 260000, cost: 178000 },
          { name: 'Обучение персонала', unit: 'чел.', qty: 6, sum: 120000, cost: 88000 }
        ]
      },
      note: 'Калькулятор Алексеев в работе, срок — завтра.',
      history: [
        { at: daysAgo(6), status: 'new', by: 'Орлова Т.К.', note: 'Карточка заведена вручную' },
        { at: daysAgo(5), status: 'calc', by: 'Орлова Т.К.', note: 'Передано калькулятору Алексееву' },
        { at: daysAgo(2), status: 'calc', by: 'Алексеев Д.С.', note: 'Смета собрана, на проверке у РП' }
      ]
    },
    {
      id: 'a-6116',
      title: 'Сервис КИПиА НПС-12',
      customer: 'ПАО «Транснефть»',
      status: 'approval',
      channel: 'phone',
      sender: { name: 'Никитин В.Р.', org: 'Асгард', addr: '+7 912 445-12-08' },
      created: daysAgo(9),
      deadline: daysAhead(2),
      amount: 12400000,
      pm: PMS[0],
      ai: {
        color: 'green',
        confidence: 0.93,
        summary: 'Прямой запрос по сервису КИПиА на 12 месяцев. Сумма выше порога согласования директора. Требуется решение по составу бригады.'
      },
      docs: [
        { name: 'Смета Асгард.pdf', ext: 'pdf', size: '480 КБ', date: daysAgo(3) },
        { name: 'Отчёт РП.docx', ext: 'docx', size: '95 КБ', date: daysAgo(2) }
      ],
      estimate: {
        title: 'Смета сервис НПС-12',
        total_no_vat: 11850000,
        cost_total: 9120000,
        margin_pct: 23.0,
        vat: 2370000,
        total_with_vat: 14220000,
        rows: [
          { name: 'Регламентное обслуживание КИПиА', unit: 'мес.', qty: 12, sum: 5400000, cost: 4180000 },
          { name: 'Выезды инженера и вахта', unit: 'выезд', qty: 24, sum: 3650000, cost: 2920000 },
          { name: 'ЗИП и расходные материалы', unit: 'компл.', qty: 1, sum: 1800000, cost: 1440000 },
          { name: 'Диагностика и отчётность', unit: 'компл.', qty: 1, sum: 1000000, cost: 580000 }
        ]
      },
      note: 'Ждёт согласования директора: сумма выше порога 10 млн.',
      history: [
        { at: daysAgo(9), status: 'new', by: 'Телефония', note: 'Звонок, карточка по записи' },
        { at: daysAgo(8), status: 'calc', by: 'Никитин В.Р.', note: 'Считает Алексеев' },
        { at: daysAgo(3), status: 'approval', by: 'Алексеев Д.С.', note: 'Смета готова, отправлена на согласование' }
      ]
    },
    {
      id: 'a-6112',
      title: 'КП на диагностику шкафов ШУ',
      customer: 'ООО «Нефтехимсервис»',
      status: 'kp_prep',
      channel: 'email',
      sender: { name: 'Егорова Н.Л.', org: 'Асгард', addr: 'egorova@asgard-service.ru' },
      created: daysAgo(12),
      deadline: daysAhead(4),
      amount: 3200000,
      pm: PMS[3],
      ai: {
        color: 'green',
        confidence: 0.86,
        summary: 'Диагностика 8 шкафов ШУ на действующем производстве. КП почти собрано, нужна проверка сроков.'
      },
      docs: [
        { name: 'Черновик КП.docx', ext: 'docx', size: '180 КБ', date: daysAgo(1) },
        { name: 'Спецификация.xlsx', ext: 'xlsx', size: '70 КБ', date: daysAgo(2) }
      ],
      estimate: {
        title: 'Смета диагностика ШУ',
        total_no_vat: 2980000,
        cost_total: 2210000,
        margin_pct: 25.8,
        vat: 596000,
        total_with_vat: 3576000,
        rows: [
          { name: 'Диагностика шкафов ШУ', unit: 'шкаф', qty: 8, sum: 1680000, cost: 1260000 },
          { name: 'Замена комплектующих', unit: 'компл.', qty: 1, sum: 820000, cost: 660000 },
          { name: 'Выезд и работа бригады', unit: 'выезд', qty: 4, sum: 480000, cost: 290000 }
        ]
      },
      note: 'КП на вычитке у РП, отправка завтра.',
      history: [
        { at: daysAgo(12), status: 'new', by: 'Почта', note: 'Запрос от заказчика' },
        { at: daysAgo(10), status: 'calc', by: 'Егорова Н.Л.', note: 'Смета собрана' },
        { at: daysAgo(1), status: 'kp_prep', by: 'Егорова Н.Л.', note: 'Готовится коммерческое предложение' }
      ]
    },
    {
      id: 'a-6108',
      title: 'Коммерческое: ПНР котельной',
      customer: 'ООО «Теплосервис+»',
      status: 'sent',
      channel: 'email',
      sender: { name: 'Никитин В.Р.', org: 'Асгард', addr: 'nikitin@asgard-service.ru' },
      created: daysAgo(18),
      deadline: daysAgo(2),
      amount: 5100000,
      pm: PMS[0],
      ai: {
        color: 'amber',
        confidence: 0.69,
        summary: 'КП отправлено 18 дней назад, ответа нет. Заказчик просил скидку 3 % — решение за РП.'
      },
      docs: [
        { name: 'КП_исх_044.pdf', ext: 'pdf', size: '620 КБ', date: daysAgo(18) },
        { name: 'Приложение смета.pdf', ext: 'pdf', size: '400 КБ', date: daysAgo(18) }
      ],
      estimate: {
        title: 'Смета ПНР котельной',
        total_no_vat: 4850000,
        cost_total: 3680000,
        margin_pct: 24.1,
        vat: 970000,
        total_with_vat: 5820000,
        rows: [
          { name: 'Шкаф автоматики котла', unit: 'шкаф', qty: 2, sum: 2100000, cost: 1620000 },
          { name: 'Монтаж и обвязка', unit: 'объект', qty: 1, sum: 1450000, cost: 1120000 },
          { name: 'Пусконаладка режимных карт', unit: 'режим', qty: 6, sum: 900000, cost: 640000 },
          { name: 'Вахта и проживание', unit: 'чел.-мес.', qty: 3, sum: 400000, cost: 300000 }
        ]
      },
      note: 'КП ушло 18 дней назад, ждём ответ. Дедлайн прошёл.',
      history: [
        { at: daysAgo(18), status: 'new', by: 'Почта', note: 'Входящий запрос' },
        { at: daysAgo(16), status: 'calc', by: 'Морозова Е.В.', note: 'Смета собрана' },
        { at: daysAgo(14), status: 'kp_prep', by: 'Никитин В.Р.', note: 'КП согласовано' },
        { at: daysAgo(18), status: 'sent', by: 'Никитин В.Р.', note: 'КП отправлено заказчику' }
      ]
    },
    {
      id: 'a-6104',
      title: 'Дозапрос по объёмам кабеля',
      customer: 'АО «Северсталь»',
      status: 'addendum',
      channel: 'email',
      sender: { name: 'Кузнецова А.Н.', org: 'Асгард', addr: 'kuznetsova@asgard-service.ru' },
      created: daysAgo(7),
      deadline: daysAhead(1),
      amount: 7600000,
      pm: PMS[1],
      ai: {
        color: 'amber',
        confidence: 0.77,
        summary: 'Заказчик просит пересчитать кабель ВВГнг после изменения трассы. Нужна корректировка ведомости и срока.'
      },
      docs: [
        { name: 'Дозапрос заказчика.pdf', ext: 'pdf', size: '150 КБ', date: daysAgo(7) },
        { name: 'Ответ черновик.docx', ext: 'docx', size: '60 КБ', date: daysAgo(1) }
      ],
      estimate: {
        title: 'Смета кабель (корректировка)',
        total_no_vat: 7420000,
        cost_total: 5640000,
        margin_pct: 24.0,
        vat: 1484000,
        total_with_vat: 8904000,
        rows: [
          { name: 'Кабель ВВГнг 4х35', unit: 'м', qty: 1850, sum: 2960000, cost: 2368000 },
          { name: 'Кабельные трассы и лотки', unit: 'м', qty: 640, sum: 1860000, cost: 1420000 },
          { name: 'Монтаж и разделка', unit: 'компл.', qty: 1, sum: 1600000, cost: 1120000 },
          { name: 'Испытания и протоколы', unit: 'компл.', qty: 1, sum: 1000000, cost: 732000 }
        ]
      },
      note: 'Нужна корректировка ведомости кабеля ВВГнг, срок ответа — завтра.',
      history: [
        { at: daysAgo(7), status: 'addendum', by: 'Почта', note: 'Дозапрос от заказчика' },
        { at: daysAgo(4), status: 'addendum', by: 'Орлова Т.К.', note: 'Пересчёт кабеля запущен' }
      ]
    },
    {
      id: 'a-6098',
      title: 'Выигрыш переговоров — цех №2',
      customer: 'ООО «Химпром»',
      status: 'win',
      channel: 'manual',
      sender: { name: 'Белов С.Ю.', org: 'Асгард', addr: 'belov@asgard-service.ru' },
      created: daysAgo(27),
      deadline: daysAgo(5),
      amount: 8800000,
      pm: PMS[2],
      ai: {
        color: 'green',
        confidence: 0.95,
        summary: 'Переговоры завершены победой, сумма 8,8 млн. Ждём аванс 30 % для передачи в работы.'
      },
      docs: [
        { name: 'Протокол переговоров.pdf', ext: 'pdf', size: '200 КБ', date: daysAgo(5) },
        { name: 'Счёт на аванс.pdf', ext: 'pdf', size: '110 КБ', date: daysAgo(4) }
      ],
      estimate: {
        title: 'Смета цех №2',
        total_no_vat: 8600000,
        cost_total: 6620000,
        margin_pct: 23.0,
        vat: 1720000,
        total_with_vat: 10320000,
        rows: [
          { name: 'Модернизация АСУТП цеха', unit: 'объект', qty: 1, sum: 5200000, cost: 4020000 },
          { name: 'Шкафы и оборудование', unit: 'компл.', qty: 1, sum: 2400000, cost: 1960000 },
          { name: 'Пусконаладка и обучение', unit: 'компл.', qty: 1, sum: 1000000, cost: 640000 }
        ]
      },
      note: 'Передаём в работы после аванса.',
      history: [
        { at: daysAgo(27), status: 'new', by: 'Белов С.Ю.', note: 'Карточка заведена' },
        { at: daysAgo(22), status: 'calc', by: 'Морозова Е.В.', note: 'Смета собрана' },
        { at: daysAgo(14), status: 'sent', by: 'Белов С.Ю.', note: 'КП ушло заказчику' },
        { at: daysAgo(5), status: 'win', by: 'Белов С.Ю.', note: 'Переговоры выиграны, ждём аванс' }
      ]
    },
    {
      id: 'a-6091',
      title: 'Отказ заказчика — АРМ оператора',
      customer: 'ООО «ЛесПромАвтоматика»',
      status: 'lose',
      channel: 'phone',
      sender: { name: 'Егорова Н.Л.', org: 'Асгард', addr: '+7 912 118-44-20' },
      created: daysAgo(52),
      deadline: daysAgo(38),
      amount: 1900000,
      pm: PMS[3],
      ai: {
        color: 'red',
        confidence: 0.82,
        summary: 'Заказчик выбрал другого подрядчика по срокам поставки. Причина отказа зафиксирована, цена не решающая.'
      },
      docs: [{ name: 'Письмо отказа.eml', ext: 'eml', size: '32 КБ', date: daysAgo(38) }],
      estimate: null,
      note: 'Выбрали другого подрядчика по срокам. Цена не была решающим фактором.',
      history: [
        { at: daysAgo(52), status: 'new', by: 'Телефония', note: 'Звонок' },
        { at: daysAgo(45), status: 'sent', by: 'Егорова Н.Л.', note: 'КП отправлено' },
        { at: daysAgo(38), status: 'lose', by: 'Егорова Н.Л.', note: 'Получен отказ' }
      ]
    },
    {
      id: 'a-6086',
      title: 'В работу: наладка ГРП-4',
      customer: 'ПАО «Газпром нефть»',
      status: 'work',
      channel: 'manual',
      sender: { name: 'Никитин В.Р.', org: 'Асгард', addr: 'nikitin@asgard-service.ru' },
      created: daysAgo(20),
      deadline: daysAgo(3),
      amount: 11200000,
      pm: PMS[0],
      ai: {
        color: 'green',
        confidence: 0.9,
        summary: 'Карточка работы создана, бригада набрана, заезд 26 октября. Смета передана в работу без изменений.'
      },
      docs: [
        { name: 'Договор.pdf', ext: 'pdf', size: '1,4 МБ', date: daysAgo(20) },
        { name: 'График.pdf', ext: 'pdf', size: '90 КБ', date: daysAgo(19) }
      ],
      estimate: {
        title: 'Смета ГРП-4',
        total_no_vat: 10800000,
        cost_total: 9240000,
        margin_pct: 14.4,
        vat: 2160000,
        total_with_vat: 12960000,
        rows: [
          { name: 'Наладка ГРП-4', unit: 'объект', qty: 1, sum: 5200000, cost: 4400000 },
          { name: 'Приборы и ЗИП', unit: 'компл.', qty: 1, sum: 3100000, cost: 2720000 },
          { name: 'Вахта и проживание', unit: 'чел.-мес.', qty: 6, sum: 2500000, cost: 2120000 }
        ]
      },
      note: 'Карточка работы создана, бригада набрана.',
      history: [
        { at: daysAgo(20), status: 'new', by: 'Никитин В.Р.', note: 'Карточка заведена' },
        { at: daysAgo(14), status: 'win', by: 'Никитин В.Р.', note: 'Договор подписан' },
        { at: daysAgo(11), status: 'work', by: 'Никитин В.Р.', note: 'Передано в работы, работа w-304' }
      ]
    },
    {
      id: 'a-6074',
      title: 'Завершено: ПНР шкафов ШУ НПС-7',
      customer: 'АО «Транснефть — Верхняя Волга»',
      status: 'done',
      channel: 'manual',
      sender: { name: 'Никитин В.Р.', org: 'Асгард', addr: 'nikitin@asgard-service.ru' },
      created: daysAgo(26),
      deadline: daysAgo(12),
      amount: 9800000,
      pm: PMS[0],
      ai: {
        color: 'green',
        confidence: 0.94,
        summary: 'Работы закрыты, акты подписаны, оплата получена полностью. Маржа выше плановой на 1,2 п.п.'
      },
      docs: [
        { name: 'Акты КС-2.pdf', ext: 'pdf', size: '1,2 МБ', date: daysAgo(12) },
        { name: 'Счёт фактура.pdf', ext: 'pdf', size: '180 КБ', date: daysAgo(12) }
      ],
      estimate: {
        title: 'Смета ШУ НПС-7 (закрытие)',
        total_no_vat: 9800000,
        cost_total: 8200000,
        margin_pct: 16.3,
        vat: 1960000,
        total_with_vat: 11760000,
        rows: [
          { name: 'ПНР шкафов ШУ', unit: 'шкаф', qty: 6, sum: 6100000, cost: 5120000 },
          { name: 'Оборудование и ЗИП', unit: 'компл.', qty: 1, sum: 2600000, cost: 2280000 },
          { name: 'Вахта бригады', unit: 'чел.-мес.', qty: 3, sum: 1100000, cost: 800000 }
        ]
      },
      note: 'Работы закрыты, акты подписаны. Оплата получена полностью.',
      history: [
        { at: daysAgo(26), status: 'new', by: 'Никитин В.Р.', note: 'Карточка' },
        { at: daysAgo(22), status: 'win', by: 'Никитин В.Р.', note: 'Договор' },
        { at: daysAgo(18), status: 'work', by: 'Никитин В.Р.', note: 'Старт работ' },
        { at: daysAgo(12), status: 'done', by: 'Никитин В.Р.', note: 'Акты подписаны, оплата получена' }
      ]
    },
    {
      id: 'a-6052',
      title: 'Корзина: реклама поставщика кабеля',
      customer: '—',
      status: 'trash',
      channel: 'email',
      sender: { name: 'Cable Opt', org: 'Cable Opt', addr: 'sales@cable-opt.ru' },
      created: daysAgo(4),
      deadline: null,
      amount: 0,
      pm: null,
      ai: {
        color: 'red',
        confidence: 0.96,
        summary: 'Рекламная рассылка поставщика кабеля. Не относится к закупкам АСУТП. Рекомендация: в корзину.'
      },
      docs: [{ name: 'Прайс-лист.xlsx', ext: 'xlsx', size: '320 КБ', date: daysAgo(4) }],
      estimate: null,
      note: 'Реклама, не наш контур.',
      history: [
        { at: daysAgo(4), status: 'new', by: 'Почта', note: 'Письмо разобрано' },
        { at: daysAgo(4), status: 'trash', by: 'Никитин В.Р.', note: 'Перемещено в корзину' }
      ]
    }
  ];

  /* Аудит заявки: кто отправил, кто добавил, кто взял в работу */
  APPLICATIONS.forEach(function (a, i) {
    a.added_by = a.added_by || {
      name: a.sender && a.sender.name ? a.sender.name : 'Почта',
      role: a.channel === 'email' ? 'Входящее письмо' : a.channel === 'etp' ? 'Площадка' : 'Ручной ввод',
      at: a.created
    };
    a.analyzed_by = a.analyzed_by || (a.estimate ? {
      name: a.pm ? a.pm.name : CALC[i % CALC.length].name,
      role: 'Аналитик / калькулятор',
      at: a.history && a.history.length ? a.history[a.history.length - 1].at : a.created
    } : null);
    a.outcome = a.outcome || null;
    if (a.status === 'lose' && !a.outcome) {
      a.outcome = {
        kind: 'lose',
        reason: a.note || 'Отказ заказчика',
        detail: (a.ai && a.ai.summary) || '',
        by: a.pm ? a.pm.name : '—',
        at: a.deadline || a.created
      };
    }
    if (a.status === 'trash' && !a.outcome) {
      a.outcome = {
        kind: 'cancel',
        reason: a.note || 'Не относится к нашему контуру',
        detail: (a.ai && a.ai.summary) || '',
        by: 'Никитин В.Р.',
        at: a.created
      };
    }
  });

  /* ── Работы ───────────────────────────────────────────────────────────── */
  const MONTH_NAMES = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
  ];

  function monthsWindow(offsetEnd) {
    const end = new Date(NOW);
    end.setDate(1);
    const out = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(end.getFullYear(), end.getMonth() - offsetEnd - i, 1);
      out.push({
        key: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'),
        short: MONTH_NAMES[d.getMonth()].slice(0, 3),
        label: MONTH_NAMES[d.getMonth()] + ' ' + d.getFullYear(),
        year: d.getFullYear(),
        month: d.getMonth(),
        first: d
      });
    }
    return out;
  }

  const ROLE_RATE = {
    'Бригадир': 9800,
    'Монтажник': 7400,
    'Наладчик КИП': 8600,
    'Сварщик': 8200,
    'Инженер ПНР': 11500
  };

  function mkBrigade(seed, size) {
    const roles = [
      { role: 'Бригадир', rate: ROLE_RATE['Бригадир'] },
      { role: 'Наладчик КИП', rate: ROLE_RATE['Наладчик КИП'] },
      { role: 'Монтажник', rate: ROLE_RATE['Монтажник'] },
      { role: 'Сварщик', rate: ROLE_RATE['Сварщик'] },
      { role: 'Инженер ПНР', rate: ROLE_RATE['Инженер ПНР'] },
      { role: 'Монтажник', rate: ROLE_RATE['Монтажник'] }
    ];
    const out = [];
    for (let i = 0; i < size; i++) {
      const r = roles[i % roles.length];
      out.push({
        name: BRIGADE_NAMES[(seed * 3 + i) % BRIGADE_NAMES.length],
        role: r.role,
        rate: r.rate
      });
    }
    return out;
  }

  function mkTimesheet(seed, brigade, offsetEnd) {
    const win = monthsWindow(offsetEnd);
    const persons = brigade.map(function (p, pi) {
      const startIdx = (seed + pi) % 3 === 0 ? 0 : Math.min(2, (seed + pi) % 3);
      const endIdx = Math.min(5, 2 + ((seed + pi * 2) % 4));
      const months = win.map(function (m, idx) {
        const active = idx >= startIdx && idx <= endIdx;
        const days = active ? 7 + ((seed * 5 + pi * 7 + idx * 3) % 16) : 0;
        return { label: m.label, short: m.short, days: days, rate: p.rate };
      });
      const arriveDate = new Date(win[startIdx].first);
      arriveDate.setDate(1 + ((seed + pi) % 6));
      const leaveDate = new Date(win[endIdx].first.getFullYear(), win[endIdx].first.getMonth() + 1, 0);
      return {
        name: p.name,
        role: p.role,
        rate: p.rate,
        arrive: iso(arriveDate),
        leave: iso(leaveDate),
        months: months
      };
    });

    return {
      window: win.map(function (m) {
        return { label: m.label, short: m.short };
      }),
      persons: persons
    };
  }

  function mkCheckins(seed, brigade, offsetDays) {
    const kinds = ['Приход', 'Выезд', 'Фотоотчёт', 'Приход', 'Фотоотчёт'];
    const notes = [
      'Объект, КПП-2, допуск по списку',
      'Выезд на базу, забрали ЗИП',
      'Фото шкафа ШУ-3 после монтажа',
      'Планёрка с механиком заказчика',
      'Скрытые работы по кабельной трассе'
    ];
    const out = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(NOW);
      d.setDate(d.getDate() - offsetDays - i);
      out.push({
        at: iso(d),
        time: ['08:40', '17:20', '13:05', '09:15', '16:40'][i],
        who: brigade[(seed + i) % brigade.length].name,
        kind: kinds[i],
        note: notes[i],
        ok: i !== 4
      });
    }
    return out;
  }

  const WORKS_RAW = [
    {
      id: 'w-318',
      title: 'ПНР АСУТП цеха полимеров',
      customer: 'ПАО «СИБУР»',
      object: 'Цех полимеров, корпус 4',
      address: 'Тобольск, промзона, 12',
      contract_no: 'Д-441/26',
      phase: 'active',
      region: 'Тобольск',
      pmIdx: 2,
      start: daysAgo(20),
      due: daysAhead(64),
      contract: 24800000,
      cost: 19840000,
      paid: 7440000,
      spent: 6120000,
      plan_pct: 62,
      fact_pct: 58,
      brigadeSize: 5,
      tsSeed: 1,
      tsOffset: 0,
      checkinOffset: 1
    },
    {
      id: 'w-317',
      title: 'Реконструкция щита насосной',
      customer: 'МУП «Водоканал»',
      object: 'Насосная станция №2',
      address: 'Киров, ул. Заводская, 8',
      contract_no: 'Д-448/26',
      phase: 'active',
      region: 'Киров',
      pmIdx: 3,
      start: daysAgo(12),
      due: daysAhead(38),
      contract: 6120000,
      cost: 4610000,
      paid: 3060000,
      spent: 2100000,
      plan_pct: 48,
      fact_pct: 51,
      brigadeSize: 4,
      tsSeed: 4,
      tsOffset: 0,
      checkinOffset: 0
    },
    {
      id: 'w-316',
      title: 'Сервис АСУТП фабрики окатышей',
      customer: 'АО «Карельский окатыш»',
      object: 'Фабрика окатышей, АСУТП',
      address: 'Костомукша, промплощадка',
      contract_no: 'Д-392/26',
      phase: 'active',
      region: 'Костомукша',
      pmIdx: 1,
      start: daysAgo(45),
      due: daysAhead(120),
      contract: 16550000,
      cost: 13400000,
      paid: 8275000,
      spent: 6900000,
      plan_pct: 44,
      fact_pct: 41,
      brigadeSize: 6,
      tsSeed: 7,
      tsOffset: 0,
      checkinOffset: 0
    },
    {
      id: 'w-304',
      title: 'Наладка ГРП-4',
      customer: 'ПАО «Газпром нефть»',
      object: 'ГРП-4, куст 12',
      address: 'ЯНАО, Ноябрьск',
      contract_no: 'Д-451/26',
      phase: 'active',
      region: 'ЯНАО',
      pmIdx: 0,
      start: daysAgo(8),
      due: daysAhead(52),
      contract: 11200000,
      cost: 9600000,
      paid: 3360000,
      spent: 2400000,
      plan_pct: 18,
      fact_pct: 12,
      brigadeSize: 5,
      tsSeed: 2,
      tsOffset: 0,
      checkinOffset: 0
    },
    {
      id: 'w-310',
      title: 'Диагностика РСУ линии сушки',
      customer: 'ООО «Кировский комбинат»',
      object: 'Линия сушки №1',
      address: 'Киров, ул. Комбинатская, 3',
      contract_no: 'Д-437/26',
      phase: 'pause',
      region: 'Киров',
      pmIdx: 2,
      start: daysAgo(18),
      due: daysAhead(26),
      contract: 2900000,
      cost: 2400000,
      paid: 870000,
      spent: 920000,
      plan_pct: 34,
      fact_pct: 22,
      brigadeSize: 3,
      tsSeed: 5,
      tsOffset: 1,
      checkinOffset: 12,
      pause_reason: 'Ожидание поставки контроллеров, 8 недель. Бригада переведена на объект w-317.'
    },
    {
      id: 'w-311',
      title: 'Обследование АРМ котельной',
      customer: 'ООО «Теплоэнергосервис»',
      object: 'Котельная №5',
      address: 'Сыктывкар, ул. Тепличная, 1',
      contract_no: 'Д-429/26',
      phase: 'pause',
      region: 'Сыктывкар',
      pmIdx: 3,
      start: daysAgo(60),
      due: daysAhead(15),
      contract: 1800000,
      cost: 1450000,
      paid: 0,
      spent: 180000,
      plan_pct: 40,
      fact_pct: 18,
      brigadeSize: 2,
      tsSeed: 9,
      tsOffset: 2,
      checkinOffset: 22,
      pause_reason: 'Допуск на объект закрыт заказчиком до апреля. Сдвиг по срокам согласован письмом.'
    },
    {
      id: 'w-303',
      title: 'ПНР шкафов ШУ НПС-7',
      customer: 'АО «Транснефть — Верхняя Волга»',
      object: 'НПС-7, шкафы ШУ',
      address: 'Кстово, промплощадка',
      contract_no: 'Д-388/26',
      phase: 'archive',
      region: 'Н. Новгород',
      pmIdx: 0,
      start: daysAgo(120),
      due: daysAgo(20),
      closed: daysAgo(12),
      contract: 9800000,
      cost: 8200000,
      paid: 9800000,
      spent: 8200000,
      plan_pct: 100,
      fact_pct: 100,
      brigadeSize: 4,
      tsSeed: 3,
      tsOffset: 1,
      checkinOffset: 14
    },
    {
      id: 'w-301',
      title: 'Сервис КИП ГРП (сезон 2026)',
      customer: 'ПАО «Газпром»',
      object: 'ГРП, 6 объектов',
      address: 'ЯНАО',
      contract_no: 'Д-354/26',
      phase: 'archive',
      region: 'ЯНАО',
      pmIdx: 1,
      start: daysAgo(170),
      due: daysAgo(45),
      closed: daysAgo(40),
      contract: 14200000,
      cost: 11850000,
      paid: 14200000,
      spent: 11850000,
      plan_pct: 100,
      fact_pct: 100,
      brigadeSize: 5,
      tsSeed: 6,
      tsOffset: 3,
      checkinOffset: 45
    },
    {
      id: 'w-299',
      title: 'Модернизация АРМ диспетчерской',
      customer: 'МУП «Горсвет»',
      object: 'Диспетчерская, 4 АРМ',
      address: 'Киров, ул. Светлая, 4',
      contract_no: 'Д-331/26',
      phase: 'archive',
      region: 'Киров',
      pmIdx: 3,
      start: daysAgo(230),
      due: daysAgo(110),
      closed: daysAgo(95),
      contract: 2400000,
      cost: 1850000,
      paid: 2400000,
      spent: 1850000,
      plan_pct: 100,
      fact_pct: 100,
      brigadeSize: 2,
      tsSeed: 8,
      tsOffset: 4,
      checkinOffset: 95
    }
  ];

  const WORKS = WORKS_RAW.map(function (w) {
    const brigade = mkBrigade(w.tsSeed, w.brigadeSize);
    const timesheet = mkTimesheet(w.tsSeed, brigade, w.tsOffset);
    const margin = w.contract - w.cost;
    const factPct = w.fact_pct;
    const planPct = w.plan_pct;
    const delta = factPct - planPct;
    const light = delta >= -3 ? 'ok' : delta >= -10 ? 'warn' : 'err';
    return {
      id: w.id,
      title: w.title,
      customer: w.customer,
      object: w.object,
      address: w.address,
      contract_no: w.contract_no,
      phase: w.phase,
      region: w.region,
      pm: PMS[w.pmIdx],
      start: w.start,
      due: w.due,
      closed: w.closed || null,
      contract: w.contract,
      cost: w.cost,
      margin_rub: margin,
      margin_pct: round1((margin / w.contract) * 100),
      paid: w.paid,
      spent: w.spent,
      leftover: Math.max(0, w.contract - w.paid),
      plan_pct: planPct,
      fact_pct: factPct,
      schedule_light: light,
      pause_reason: w.pause_reason || null,
      lead: brigade[0].name,
      brigade: brigade,
      timesheet: timesheet,
      checkins: mkCheckins(w.tsSeed, brigade, w.checkinOffset)
    };
  });

  return {
    TENDER_STATUSES: TENDER_STATUSES,
    APP_STATUSES: APP_STATUSES,
    WORK_STATUSES: WORK_STATUSES,
    PERIODS: PERIODS,
    CHANNELS: CHANNELS,
    inPeriod: inPeriod,
    tenders: TENDERS,
    applications: APPLICATIONS,
    works: WORKS
  };
})();
