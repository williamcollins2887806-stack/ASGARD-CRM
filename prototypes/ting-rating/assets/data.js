/* ═══════════════════════════════════════════════════════════════════════════
   «Тинг Асгарда» — данные прототипа (вымышленные сотрудники и итоги)
   ═══════════════════════════════════════════════════════════════════════════ */
(function (w) {
  'use strict';

  // Руководство — в списке выбора НЕ участвует (и не выбирается).
  var LEADERSHIP = [
    { id: 'l-sokolov',  fio: 'Соколов Артём Викторович',   role: 'Генеральный директор',        dept: 'Руководство', area: 'Отвечает за стратегию компании и ключевые контракты.' },
    { id: 'l-gromov',   fio: 'Громов Дмитрий Олегович',    role: 'Коммерческий директор',       dept: 'Руководство', area: 'Отвечает за продажи, тендеры и работу с заказчиками.' },
    { id: 'l-eremin',   fio: 'Ерёмин Павел Сергеевич',     role: 'Директор по производству',    dept: 'Руководство', area: 'Отвечает за производство, объекты и технику.' },
    { id: 'l-lebedeva', fio: 'Лебедева Ирина Петровна',    role: 'Главный бухгалтер',           dept: 'Руководство', area: 'Отвечает за бухгалтерский и налоговый учёт.' }
  ];

  // Дружина — из этого списка формируется ТОП-10.
  var CREW = [
    { id: 'e-zhukov',   fio: 'Жуков Роман Андреевич',    role: 'Мастер участка',              dept: 'Участок очистки',        area: 'Отвечает за организацию работ и соблюдение сроков на объектах.' },
    { id: 'e-novikov',  fio: 'Новиков Денис Игоревич',   role: 'Программист',                 dept: 'ИТ-отдел',               area: 'Отвечает за CRM, интеграции и автоматизацию процессов.' },
    { id: 'e-belova',   fio: 'Белова Мария Алексеевна',  role: 'Специалист по тендерам',      dept: 'Коммерческий отдел',     area: 'Отвечает за подготовку КП и расчёт себестоимости тендеров.' },
    { id: 'e-vinograd', fio: 'Виноградов Сергей Юрьевич',role: 'Электрогазосварщик',          dept: 'Участок монтажа',        area: 'Отвечает за изготовление и монтаж металлоконструкций.' },
    { id: 'e-zayceva',  fio: 'Зайцева Анна Дмитриевна',  role: 'Инженер ПТО',                 dept: 'Технический отдел',      area: 'Отвечает за исполнительную документацию и акты выполненных работ.' },
    { id: 'e-homyakova',fio: 'Хомякова Юлия Валерьевна', role: 'Диспетчер',                   dept: 'Операционный отдел',     area: 'Отвечает за приём заявок и координацию выездов бригад.' },
    { id: 'e-kirillov', fio: 'Кириллов Максим Петрович', role: 'Начальник снабжения',         dept: 'Отдел закупок',          area: 'Отвечает за поставки материалов и работу с поставщиками.' },
    { id: 'e-fedorov',  fio: 'Фёдоров Антон Николаевич', role: 'Слесарь-ремонтник',           dept: 'Участок очистки',        area: 'Отвечает за ремонт насосного и технологического оборудования.' },
    { id: 'e-ulyanova', fio: 'Ульянова Дарья Сергеевна', role: 'Дизайнер',                    dept: 'Маркетинг',              area: 'Отвечает за презентации, КП и визуал компании.' },
    { id: 'e-morozova', fio: 'Морозова Екатерина Ивановна', fio_short: 'Морозова Екатерина',  role: 'HR-специалист',           dept: 'Отдел персонала',        area: 'Отвечает за подбор, адаптацию и обучение сотрудников.' },
    { id: 'e-tihonov',  fio: 'Тихонов Владислав Олегович', role: 'Водитель',                  dept: 'Транспортный участок',   area: 'Отвечает за доставку бригад и грузов между объектами.' },
    { id: 'e-dementieva', fio: 'Дементьева Ольга Николаевна', role: 'Экономист',              dept: 'Планово-экономический отдел', area: 'Отвечает за бюджеты проектов и мониторинг маржи.' },
    { id: 'e-petrov',   fio: 'Петров Алексей Владимирович', role: 'Машинист крана',           dept: 'Участок монтажа',        area: 'Отвечает за подъёмные работы на объектах.' },
    { id: 'e-romanov',  fio: 'Романов Игорь Анатольевич', role: 'Инженер-эколог',             dept: 'Технический отдел',      area: 'Отвечает за природоохранную документацию и отчёты.' },
    { id: 'e-scherbakova', fio: 'Щербакова Полина Максимовна', role: 'Юрист',                  dept: 'Юридический отдел',      area: 'Отвечает за договоры и претензионную работу.' },
    { id: 'e-shestakov', fio: 'Шестаков Егор Дмитриевич', role: 'Электромонтёр',              dept: 'Участок монтажа',        area: 'Отвечает за электроснабжение и электрику на объектах.' },
    { id: 'e-smirnova', fio: 'Смирнова Татьяна Борисовна', role: 'Делопроизводитель',         dept: 'Отдел персонала',        area: 'Отвечает за кадровое делопроизводство и договоры.' },
    { id: 'e-orlova',   fio: 'Орлова Светлана Юрьевна',  role: 'Бухгалтер',                   dept: 'Бухгалтерия',            area: 'Отвечает за первичную документацию и расчёты с контрагентами.' },
    { id: 'e-cyarev',   fio: 'Царёв Кирилл Андреевич',   role: 'Инженер-проектировщик',       dept: 'Технический отдел',      area: 'Отвечает за проектные решения и технологические схемы.' },
    { id: 'e-abramov',  fio: 'Абрамов Никита Ильич',     role: 'Инженер-механик',             dept: 'Участок очистки',        area: 'Отвечает за выездное обслуживание и ремонт оборудования на объектах.' }
  ];

  // Итоговый рейтинг (пример: 18 голосов из 20, максимум по 10 выборов на голос).
  // points — сумма баллов: 1 место = 10 … 10 место = 1.
  var RANKING = [
    { id: 'e-zhukov',    rank: 1,  points: 128, firsts: 6 },
    { id: 'e-novikov',   rank: 2,  points: 116, firsts: 5 },
    { id: 'e-belova',    rank: 3,  points: 104, firsts: 4 },
    { id: 'e-vinograd',  rank: 4,  points: 95,  firsts: 3 },
    { id: 'e-zayceva',   rank: 5,  points: 86,  firsts: 2 },
    { id: 'e-homyakova', rank: 6,  points: 79,  firsts: 1 },
    { id: 'e-kirillov',  rank: 7,  points: 71,  firsts: 1 },
    { id: 'e-fedorov',   rank: 8,  points: 64,  firsts: 0 },
    { id: 'e-ulyanova',  rank: 9,  points: 57,  firsts: 0 },
    { id: 'e-morozova',  rank: 10, points: 51,  firsts: 0 },
    { id: 'e-tihonov',   rank: 11, points: 45,  firsts: 0 },
    { id: 'e-dementieva',rank: 12, points: 40,  firsts: 0 },
    { id: 'e-petrov',    rank: 13, points: 35,  firsts: 0 },
    { id: 'e-romanov',   rank: 14, points: 30,  firsts: 0 },
    { id: 'e-scherbakova', rank: 15, points: 25, firsts: 0 },
    { id: 'e-shestakov', rank: 16, points: 20,  firsts: 0 },
    { id: 'e-smirnova',  rank: 17, points: 16,  firsts: 0 },
    { id: 'e-orlova',    rank: 18, points: 12,  firsts: 0 },
    { id: 'e-cyarev',    rank: 19, points: 9,   firsts: 0 },
    { id: 'e-abramov',   rank: 20, points: 6,   firsts: 0 }
  ];

  var META = {
    title: 'Тинг Асгарда',
    subtitle: 'Рейтинг ТОП-10 Дружины АСГАРД',
    deadline: '11 октября 2026, 18:00 МСК',
    deadlineShort: '11 октября',
    votes: 18,
    total: 20,
    crmUrl: 'https://crm.asgard-service.com/ting',
    coreSize: 10
  };

  var byId = {};
  LEADERSHIP.concat(CREW).forEach(function (p) { byId[p.id] = p; });
  var rankById = {};
  RANKING.forEach(function (r) { rankById[r.id] = r; });

  function initials(fio) {
    var p = String(fio || '?').split(/\s+/).filter(Boolean);
    return ((p[0] || '?')[0] + (p[1] ? p[1][0] : '')).toUpperCase();
  }
  function tone(id) {
    var h = 0, s = String(id || '');
    for (var i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h) % 6;
  }
  function shortName(fio) {
    var p = String(fio || '').split(/\s+/).filter(Boolean);
    return p[0] + (p[1] ? ' ' + p[1][0] + '.' : '');
  }
  function core() {
    return RANKING.filter(function (r) { return r.rank <= META.coreSize; }).map(function (r) {
      return Object.assign({}, byId[r.id], { rank: r.rank, points: r.points, firsts: r.firsts });
    });
  }

  w.TING = {
    LEADERSHIP: LEADERSHIP,
    CREW: CREW,
    RANKING: RANKING,
    META: META,
    byId: byId,
    rankById: rankById,
    initials: initials,
    tone: tone,
    shortName: shortName,
    core: core
  };
})(window);
