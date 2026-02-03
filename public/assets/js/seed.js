window.AsgardSeed = (function(){
  const { toast } = window.AsgardUI || { toast: ()=>{} };
  const nowIso = ()=> new Date().toISOString();

  // ===== Defaults (Settings + References) =====
  const DEFAULT_SETTINGS = {
    vat_pct: 20,
    gantt_start_iso: "2026-01-01T00:00:00.000Z",
    require_docs_on_handoff: true,
    require_answer_on_question: true,
    // Work closeout: status which enables "Работы завершены" workflow
    work_close_trigger_status: "Подписание акта",
    docs_folder_hint: "",
    sla: {
      docs_deadline_notice_days: 5,
      birthday_notice_days: 5,
      pm_calc_due_workdays: 3,
      director_approval_due_workdays: 2,
      pm_rework_due_workdays: 1
    },
    limits: {
      pm_active_calcs_limit: 6
    },
    // Calendar/business rules
    schedules: {
      // Office schedule: users can edit only their own row when true.
      office_strict_own: true,
      // Workers schedule: only these logins can move/alter auto-booked "work" days.
      workers_shift_logins: ["trukhin"],
      // When approving staff requests, block approval if any conflict exists.
      block_on_conflict: true
    },
    company_profile: {
      company_name: "ООО «АСГАРД‑Сервис»",
      director_fio: "Хосе Александр",
      inn: "", kpp: "", ogrn: "",
      address: "", email: "", phone: "", website: "",
      bank_name: "", bik: "", rs: "", ks: ""
    },
    status_colors: {
      tender: {
        "Новый": "#2a6cf1",
        "Отправлено на просчёт": "#f2d08a",
        "Расчеты": "#2a6cf1",
        "Общение с заказчиком": "#8b5cf6",
        "Расчет цены": "#06b6d4",
        "Согласование ТКП": "#f59e0b",
        "Клиент согласился": "#22c55e",
        "Клиент отказался": "#e03a4a",
        "Другое": "#94a3b8"
      },
      work: {
        "Подготовка": "#2a6cf1",
        "Закупка": "#f59e0b",
        "Сбор на складе": "#06b6d4",
        "Мобилизация": "#8b5cf6",
        "Начало работ": "#22c55e",
        "Приемка": "#f2d08a",
        "Проблема": "#e03a4a",
        "Подписание акта": "#10b981",
        "Работы сдали": "#22c55e"
      },
      // Office schedule (monthly grid)
      office: {
        "оф": "#2563eb",
        "уд": "#0ea5e9",
        "бн": "#ef4444",
        "сс": "#f59e0b",
        "км": "#8b5cf6",
        "пг": "#22c55e",
        "уч": "#10b981",
        "ск": "#64748b",
        "вх": "#334155"
      },
      // Workers schedule (60 days grid)
      workers: {
        "free": "#334155",
        "office": "#2563eb",
        "trip": "#8b5cf6",
        "work": "#16a34a",
        "note": "#f59e0b"
      }
    },
    // Use in “Документы” module (MVP: ссылки / base64)
    doc_types: [
      { key:"pack", label:"Комплект документов", scope:"tender", required_on_handoff:true },
      { key:"tz", label:"ТЗ / Техническое задание", scope:"tender", required_on_handoff:false },
      { key:"draw", label:"Чертежи / P&ID", scope:"tender", required_on_handoff:false },
      { key:"bill", label:"Ведомость / Объёмы", scope:"tender", required_on_handoff:false },
      { key:"mail", label:"Переписка / Письма", scope:"tender", required_on_handoff:false },
      { key:"other", label:"Прочее", scope:"both", required_on_handoff:false },
      { key:"contract", label:"Договор", scope:"work", required_on_handoff:false },
      { key:"act", label:"Акт / Приёмка", scope:"work", required_on_handoff:false },
      { key:"report", label:"Отчёт", scope:"work", required_on_handoff:false }
    ],
    // Calculator defaults
    calc: {
      min_profit_per_person_day: 25000,
      overhead_pct: 10,
      fot_tax_pct: 50,
      profit_tax_pct: 20,
      prep_rate_per_day: 3500,
      role_rates: {
        "ИТР": 5000,
        "Мастер": 5000,
        "Слесарь": 5000,
        "Промывщик": 5000,
        "ПТО": 5000,
        "Химик": 5000,
        "Сварщик": 5000,
        "Разнорабочий": 5000
      },
      chemicals: [
        { id:"hcl", name:"Соляная кислота", price_per_kg: 100, kg_per_m3: 100 }
      ],
      transport: [
        { id:"gazelle", name:"Газель 1.5т / 20м³", max_weight_t:1.5, max_volume_m3:20, rate_per_km:50 },
        { id:"valday", name:"Валдай 3т / 35м³", max_weight_t:3, max_volume_m3:35, rate_per_km:60 },
        { id:"gazon", name:"Газон 5т / 45м³", max_weight_t:5, max_volume_m3:45, rate_per_km:70 },
        { id:"kamaz", name:"Камаз 10т / 50м³", max_weight_t:10, max_volume_m3:50, rate_per_km:80 },
        { id:"fura20", name:"Фура 20т / 90м³", max_weight_t:20, max_volume_m3:90, rate_per_km:110 }
      ]
    }
  };

  const DEFAULT_REFS = {
    tender_statuses: ["Новый","Отправлено на просчёт","Расчеты","Общение с заказчиком","Расчет цены","Согласование ТКП","Клиент согласился","Клиент отказался","Другое"],
    work_statuses: ["Подготовка","Закупка","Сбор на складе","Мобилизация","Начало работ","Приемка","Проблема","Подписание акта","Работы сдали"],
    reject_reasons: ["Не проходим по квалификации","Цена выше конкурентов","Нет ресурсов/сроков","Не наш профиль","Другое"],
    // Справочник допусков/разрешений (можно расширять в Настройках)
    permits: [
      "Охрана труда",
      "Работы на высоте",
      "Электробезопасность",
      "Промышленная безопасность",
      "Пожарная безопасность",
      "Газоопасные работы",
      "Замкнутые пространства",
      "Стропальщик/такелаж"
    ]
  };

  // ===== Seed users (demo) =====
  // ADMIN создаётся полностью готовым (пароль admin, PIN 1234)
  // Остальные создаются с временным паролем (must_change_password=true)
  const SEEDED_USERS = [
    { login:"admin",   name:"Админ",                   role:"ADMIN",    password:"admin",    pin:"1234", ready:true, employment_date:"2025-01-01", birth_date:"1990-01-15" },
    { login:"jarl",    name:"Хосе Александр (Ярл)",    role:"DIRECTOR_GEN", password:"jarl", pin:"1111", ready:true, employment_date:"2025-01-01", birth_date:"1985-07-01" },
    { login:"to1",     name:"Тендерный отдел",         role:"TO",       password:"to1",      pin:"2222", ready:true, employment_date:"2025-01-01", birth_date:"1994-03-10" },
    { login:"direc_comm", name:"Директор Коммерции",   role:"DIRECTOR_COMM", password:"direc_comm", pin:"3333", ready:true, employment_date:"2025-01-01", birth_date:"1984-02-02" },
    { login:"direc_dev",  name:"Директор Развития (DEV)", role:"DIRECTOR_DEV",  password:"direc_dev", pin:"4444", ready:true, employment_date:"2025-01-01", birth_date:"1986-06-06" },
    { login:"androsov",name:"Андросов Н.А",            role:"PM",       password:"androsov", pin:"5555", ready:true, employment_date:"2024-10-01", birth_date:"1992-11-05" },
    { login:"zisser",  name:"Зиссер",                  role:"PM",       password:"zisser",   pin:"6666", ready:true, employment_date:"2024-12-01", birth_date:"1991-02-20" },
    { login:"storozhev",name:"Сторожев",               role:"PM",       password:"storozhev", pin:"7777", ready:true, employment_date:"2025-03-01", birth_date:"1989-09-09" },
    { login:"archive", name:"Архивный сотрудник",       role:"PM",       password:"archive", pin:"0000", ready:true, employment_date:"2010-01-01", birth_date:"1970-01-01" },
    { login:"trukhin", name:"Трухин Антон (HR)",       role:"HR",       password:"trukhin", pin:"8888", ready:true, employment_date:"2024-09-15", birth_date:"1993-05-25" },
    { login:"barinov", name:"Баринов Виктор (PROC)",   role:"PROC",     password:"barinov", pin:"9999", ready:true, employment_date:"2025-02-01", birth_date:"1988-12-12" },
    { login:"buh",     name:"Бухгалтер Мария",         role:"BUH",      password:"buh",     pin:"1010", ready:true, employment_date:"2025-01-15", birth_date:"1987-04-18" },
    { login:"office",  name:"Офис-менеджер Анна",      role:"OFFICE_MANAGER", password:"office", pin:"2020", ready:true, employment_date:"2025-02-01", birth_date:"1995-08-22" }
  ];

  // ===== Real tenders from CRM export (486 records) =====
  const SEED_TENDERS = [
    { period:"2026-01", year:2026, customer_name:"ООО \"РН-УВАТНЕФТЕГАЗ\"", tender_title:"Зачистка от нефтешлама, донных отложений оборудования, находящегося на месторождениях ООО \"РН-Уватнефтегаз\" (КНП)", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2026-01", year:2026, customer_name:"ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ \"ГАЗПРОМ НЕФТЬ ШЕЛЬФ\"", tender_title:"01-3038291-344-2025_Открытый конкурентный отбор на право заключения договора на выполнение работ по монтажу и врезке под давлением узлов мониторинга коррозии на МЛСП «Приразломная» для нужд ООО «Газпром нефть шельф»", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2026-01", year:2026, customer_name:"ООО «НОВАТЭК-ПУРОВСКИЙ ЗПК»", tender_title:"Техническое обслуживание (чистка секций) Аппаратов воздушного охлаждения", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2026-01", year:2026, customer_name:"ООО «ПОЛИОМ»", tender_title:"№ 2122454/1 Гидродинамическая чистка теплообм оборуд в соответствии с прилагаемой документацией для ООО «ПОЛИОМ».", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2026-01", year:2026, customer_name:"ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ \"НОВАТЭК-УСТЬ-ЛУГА\"", tender_title:"Выполнение работ по очистке аппаратов воздушного охлаждения, теплообменных аппаратов и вспомогательного оборудования гидромеханическим способом на обьектах Комплекса по перевалке и фракционированию стабильного газового конденсата и продуктов его переработки мощностью 6,0 млн. т/год в Морском торговом порту Усть-Луга в 2026г.", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2026-01", year:2026, customer_name:"ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ ОМСКИЙ ЗАВОД ПОЛИПРОПИЛЕНА", tender_title:"Проведение работ по гидродинамической очистке теплообменного оборудования, сосудов и трубопроводов на ООО Полиом в период остановочного ремонта", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2026-01", year:2026, customer_name:"АО \"СЦБК\"", tender_title:"Проведение работ на кап.останов ЦБК в 2026 г.: 1. Очистка баков аккумуляторов горячей воды от отложений, образовавшихся в процессе эксплуатации центральной системы отопления предприятия и г.Сегежи 2. Очистка надземного газохода паровых и водогрейных котлов от отложений (сажи) в цехе теплоснабжения потребителей. 3. Очистка баков конденсата от отложений.", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2026-01", year:2026, customer_name:"ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ \"ИНТЕР РАО-ЦЕНТР УПРАВЛЕНИЯ ЗАКУПКАМИ\"", tender_title:"Химическая очистка оборудования Харанорской ГРЭС для АО Интер РАО – Электрогенерация", pm_login:"archive", tender_status:"Клиент отказался", tender_price:11200000.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2026-01", year:2026, customer_name:"Общество с ограниченной ответственностью «ГЭХ Закупки»", tender_title:"3243/ТЭР - Выполнение работ по очистке тепломеханического и теплообменного оборудования на Северной ТЭЦ (ТЭЦ-21) филиала «Невский» ПАО «ТГК-1» для нужд ООО \"ГЭХ ТЭР\" (12.39.УО.2026)", pm_login:"archive", tender_status:"Клиент отказался", tender_price:6100000.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2026-01", year:2026, customer_name:"ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ \"БАЙКАЛЬСКАЯ ЭНЕРГЕТИЧЕСКАЯ КОМПАНИЯ\"", tender_title:"Оказание услуг по Снятию ограничений и увеличению эффективности котлоагрегатов ст.№1-5,7 (проведение дробеочистки ка ст. №1-5,7); Снятию ограничений и увеличению эффективности котлоагрегатов ст. №1-5,7 (очистка ВЭК, ВЗП); Снятию ограничений, увеличению эффективности работы конденсаторов турбин (Очистка внутренних поверхностей трубок конденсаторов турбин, гидромеханическим способом, для приведения к нормативным значениям температурных напоров) оборудования КТЦ У-ИТЭЦ в г. Усть-Илимске", pm_login:"archive", tender_status:"Клиент отказался", tender_price:25310000.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2026-01", year:2026, customer_name:"ООО \"Новокуйбышевский завод масел и присадок\"", tender_title:"Химическая чистка теплообменного и емкостного оборудования от отложений в цехе № 23 ООО НЗМП", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2026-01", year:2026, customer_name:"АКЦИОНЕРНОЕ ОБЩЕСТВО ВОЗРОЖДЕНИЕ", tender_title:"Гидродинамическая очистка трубок конденсаторов эн. бл. №10, №13, №14, №15 для нужд филиала АО Возрождение - Луганская ТЭС", pm_login:"archive", tender_status:"Другое", tender_price:14693187.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2026-01", year:2026, customer_name:"ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ \"ГАЗПРОМ НЕФТЬ ШЕЛЬФ\"", tender_title:"01-3030763-344-2025_Открытый конкурентный отбор на право заключения договора Оказание услуг по промывке деаэратора V49001, зачистке аппаратов и замене наполнителей фильтров тонкой очистки Z49002 и деаэратора V49001 технологического комплекса МЛСП «Приразломная» для нужд ООО \"Газпром нефть шельф\"", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2026-01", year:2026, customer_name:"ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ \"ГАЗПРОМ НЕФТЬ ШЕЛЬФ\"", tender_title:"01-3038310-344-2025. Открытый конкурентный отбор на право заключения договора на оказание услуг по выполнению операций в условиях -ограниченного доступа на высоте с целью поддержания МЛСП «Приразломная» в исправном состоянии, с использованием методов промышленного альпинизма для нужд ООО \"Газпром нефть шельф\"", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2026-01", year:2026, customer_name:"ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ \"НОВАТЭК-ЮРХАРОВНЕФТЕГАЗ\"", tender_title:"Демонтаж АВО, теплообменников, сепараторов, ТДА на Юрхаровском месторождении , ЭТП ГПБ КП000005024", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2026-01", year:2026, customer_name:"РУСАЛ Ачинск", tender_title:"Выполнение работ по проведению химической очистки теплообменных аппаратов ТО КТЦ ТЭЦ АО РУСАЛ Ачинск в 2026 году. (2-й этап торгов)", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2026-01", year:2026, customer_name:"ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ \"ГРУППА КОМПАНИЙ \"РУСАГРО\"", tender_title:"Услуга по очистке гидротранспортера, ж/д бурачной и чаши градирни АО \"Сахарный комбинат \"Отрадинский\"", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2026-01", year:2026, customer_name:"ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ ГЭХ ТЕПЛОЭНЕРГОРЕМОНТ", tender_title:"ТЭР - Выполнение работ по ремонту, в том числе в заводских условиях теплообменных аппаратов, насосов и прочего вспомогательного тепломеханического оборудования Автовской ТЭЦ (ТЭЦ-15) филиала \"Невский\" ПАО \"ТГК-1\" для нужд ООО \"ГЭХ ТЭР\" (12. 67. УО. 2026)", pm_login:"archive", tender_status:"Клиент отказался", tender_price:6710000.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2026-01", year:2026, customer_name:"ФЕДЕРАЛЬНОЕ ГОСУДАРСТВЕННОЕ УНИТАРНОЕ ПРЕДПРИЯТИЕ «Научно-исследовательский и конструкторский институт испытательных машин, приборов и средств измерения масс»", tender_title:"Выполнение ремонтных работ на плавучем кране \"Нептун-Z\", закреплённом за Мариупольским филиалом ФГУП \"НИКИМП\", в объёме очередного освидетельствования для предъявления инспекции ФАУ \"Российский Морской Регистр Судоходства\"", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2026-01", year:2026, customer_name:"ООО \"ГАЗПРОМ НЕФТЕХИМ САЛАВАТ\"", tender_title:"Гидромеханическая очистка от иловых отложений", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2026-01", year:2026, customer_name:"ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ ДИАЛЛ АЛЬЯНС", tender_title:"Проведение работ по очистке внутренней полости Резервуара РВС-700 от иловых отложений", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2026-01", year:2026, customer_name:"АО \"ЧЦЗ\"", tender_title:"Бережная химическая очистка сухих градирен АО ЧЦЗ", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2026-01", year:2026, customer_name:"Акционерное общество \"Самарский металлургический завод \"", tender_title:"СМЦБ-050361 Цех № 15. Плановая зачистка резервуаров РГС-18 - 18 шт.", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2026-01", year:2026, customer_name:"АКЦИОНЕРНОЕ ОБЩЕСТВО \"ИНТЕР РАО-ЭЛЕКТРОГЕНЕРАЦИЯ\"", tender_title:"Зачистка расходных мазутных резервуаров для Костромской ГРЭС АО Интер РАО – Электрогенерация", pm_login:"archive", tender_status:"Другое", tender_price:68189422.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-12", year:2025, customer_name:"КЧХК АО ОХК УРАЛХИМ В Г. К-ЧЕПЕЦКЕ, ФЛ Россия, Кировская область, 613045, г.Кирово-Чепецк, проезд Западный, д.1", tender_title:"Чистка оборудования от нерастворимого осадка в цехах 51, 54, 56, 57, 58, 71 в 2026 году_КЧХК_4 кв.2025", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-12", year:2025, customer_name:"АО «СЛПК» 167018, Россия, Республика Коми, г. Сыктывкар, пр-кт Бумажников, д. 2", tender_title:"25001152 - Комплексы работ по чистке поверхностей основного и вспомогательного оборудования ТЭЦ АО СЛПК", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-12", year:2025, customer_name:"АО \"АНПЗ ВНК\" 662110, Красноярский край, м. р-н Большеулуйский, с. п. Большеулуйский сельсовет", tender_title:"РН50700079 \"Комбинированная установка нефтяного кокса. С-100. Тит.103. Колонна. Монтаж трубопроводов.\"", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-12", year:2025, customer_name:"ООО «ЛУКОЙЛ-Волгограднефтепереработка»", tender_title:"Выполнение работ по гидромойке элементов сооружений коробчатого типа в 2026-2028 году на объектах ООО «ЛУКОЙЛ-Волгограднефтепереработка»", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-12", year:2025, customer_name:"ООО \"Донкарб Графит\"", tender_title:"Гидродинамическая промывка трубопроводов и колодцев оборотной технической воды", pm_login:"archive", tender_status:"Другое", tender_price:4030704.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-12", year:2025, customer_name:"AZIMUT Санаторий Ивушка; САНАТОРИЙ \"ИВУШКА\"", tender_title:"Работы по механической и химической чистке теплообменных водонагревателей системы ГВС", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-12", year:2025, customer_name:"ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ \"БАЙКАЛЬСКАЯ ЭНЕРГЕТИЧЕСКАЯ КОМПАНИЯ-РЕМОНТ\"г. Усолье-Сибирское, г. Иркутск,", tender_title:"Проведение плановых, внеплановых работ по ремонту градирни №1, 2, 3, 4, 1 на ТЭЦ-11; Градирни №1, 2, 3 и Коллектор возврата промливневых вод ТЦ на НИТЭЦ филиалов ООО \"Байкальская энергетическая компания\"", pm_login:"archive", tender_status:"Клиент отказался", tender_price:42047217.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-12", year:2025, customer_name:"ООО УК \"МЕТАЛЛОИНВЕСТ\"АО \"ЛЕБЕДИНСКИЙ ГОК\"", tender_title:"Очистка внутренних поверхностей трубных пучков теплообменного энергетического оборудования", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-12", year:2025, customer_name:"ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ \"БАЙКАЛЬСКАЯ ЭНЕРГЕТИЧЕСКАЯ КОМПАНИЯ-РЕМОНТ\"", tender_title:"Выполнение котлоочистных работ по очистке основного и вспомогательного оборудования филиалов НИ ТЭЦ ШУ, НИ ТЭЦ, ТЭЦ-9, Н-З ТЭЦ, ТЭЦ-10, ТЭЦ-11, ТЭЦ-12 ООО Байкальская энергетическая компания", pm_login:"archive", tender_status:"Клиент отказался", tender_price:104352500.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-12", year:2025, customer_name:"ООО УК \"МЕТАЛЛОИНВЕСТ\" АО \"ОЭМК ИМ. А.А. УГАРОВА\"", tender_title:"Работы по замене насадки и очистке скрубберов охлаждающего и колошникового газа установок металлизации №1-4 АО \"ОЭМК им.А.А Угарова\" в период капитального ремонта установок металлизации в мае и августе 2026 года", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-12", year:2025, customer_name:"Волгодонский филиал акционерного общества «Инжиниринговая компания «АЭМ-технологии»", tender_title:"Выполнение работ по проведению пассивации сварных швов для деталей ГСПП АЭС Эль-Дабаа блок №4", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-12", year:2025, customer_name:"ЧАСТНОЕ УЧРЕЖДЕНИЕ \"СЕРВИСНАЯ КОМПАНИЯ БАНКА РОССИИ\"", tender_title:"Замена теплоносителя на объектах Банка России (г. Москва)", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-12", year:2025, customer_name:"АО \"ТАИФ-НК\"", tender_title:"Услуги по эффективной очистке жидкофазных реакторов поз. R-101, поз. R-102, поз. R-103 цеха №01 КГПТО АО ТАИФ-НК в период остановочного капитального ремонта", pm_login:"archive", tender_status:"Другое", tender_price:15000000.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-12", year:2025, customer_name:"Общество с ограниченной ответственностью Челябинский завод по производству коксохимической продукции", tender_title:"Ремонт теплообменного оборудования согласно ТЗ для нужд ООО Мечел-Кокс", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-12", year:2025, customer_name:"АО \"МИХАЙЛОВСКИЙ ГОК ИМ. А.В. ВАРИЧЕВА\"", tender_title:"Очистка оборудования химическими реагентами, ручным или гидропневматическим способом в 2026 г.", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-12", year:2025, customer_name:"КЧХК АО ОХК УРАЛХИМ В Г. К-ЧЕПЕЦКЕ, ФЛ", tender_title:"Чистка оборудования от нерастворимого осадка в цехах 51, 54, 56, 57, 58, 71 в 2026 году_КЧХК_4 кв.2025", pm_login:"archive", tender_status:"Клиент отказался", tender_price:41952747.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-12", year:2025, customer_name:"АО «Кольская ГМК»", tender_title:"Очистка теплообменного оборудования", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-12", year:2025, customer_name:"АО «Кольская ГМК»", tender_title:"Выполнение работ по очистке технологического отстойника АО «Кольская ГМК»", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-12", year:2025, customer_name:"АКЦИОНЕРНОЕ ОБЩЕСТВО \"ВТЕ ЮГО-ВОСТОК\"", tender_title:"Оказание услуг по очистке емкостей и бассейнов от солевых отходов", pm_login:"archive", tender_status:"Клиент отказался", tender_price:6740627.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-12", year:2025, customer_name:"Акционерное общество \"Нефтегорский газоперерабатывающий завод\"", tender_title:"Оказание услуг (выполнение работ) по ремонту теплообменного оборудования", pm_login:"archive", tender_status:"Другое", tender_price:53990640.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-12", year:2025, customer_name:"ФЕДЕРАЛЬНОЕ ГОСУДАРСТВЕННОЕ УНИТАРНОЕ ПРЕДПРИЯТИЕ \"РОСМОРПОРТ\"", tender_title:"Выполнение работ по устранению засора гидродинамическим методом в трубопроводе системы ливневой канализации причала № 5 в морском порту Магадан", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-12", year:2025, customer_name:"ООО «ЛУКОЙЛ-Волгограднефтепереработка», отдел организации и проведения тендеров. Адрес: Россия, 400029, Волгоград, ул. 40 лет ВЛКСМ, д. 55, тел.: +7 (8442) 96-34-79", tender_title:"Выполнение работ по мойке поверхности трубок внутренних устройств от отложений сприминением химреагентов в 2026-2028г. на объектах ООО «ЛУКОЙЛ-Волгограднефтепереработка»номер тендера – 050-0057-25", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-12", year:2025, customer_name:"АО «Кольская ГМК», город Мончегорск, ГМО-3, ОУССНР ЦЭН", tender_title:"Очистка теплообменного оборудования ГМО-3 и ОУССНР ЦЭН в соответствии с техническим заданием No 349-1/26ТехО, Норильский Никель 20051933/2", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-12", year:2025, customer_name:"Филиал ООО \"ИСО\" в г. Красноярск", tender_title:"Работы по монтажу технологических трубопроводов подачи кислорода, аргона и углекислоты к сварочным постам на производственной площадке ОП ООО \"ИСО\" \"Енисейский\" по адресу: Россия, Красноярский край, Емельяновский м.р-н, Шуваевский сельсовет с.п., Старцево д, Енисейский тракт тер,20-й км, стр. 9 «А» (id1125066)", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-12", year:2025, customer_name:"ГК «Росатом»", tender_title:"Выполнение работ по проведению пассивации сварных швов для деталей ГСПП АЭС Эль-Дабаа блок №4, согласно ТЗ №ВФ/ТЗ/1773-25 рев.1", pm_login:"archive", tender_status:"Другое", tender_price:13431060.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-12", year:2025, customer_name:"ЧУ\"СЕРВИСНАЯ КОМПАНИЯ БР\"", tender_title:"Замена теплоносителя на объектах Банка России (г. Москва)", pm_login:"archive", tender_status:"Другое", tender_price:759600.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-12", year:2025, customer_name:"Общество с ограниченной ответственностю \"ИжораРемСервис\"", tender_title:"Выполнение работ по мойке, очистке (механическим слесарным способом под дальнейшую окраску) и по окраске в два слоя с подготовкой поверхности с обеспыливанием и обезжириванием гидравлического пресса двойного действия", pm_login:"archive", tender_status:"Другое", tender_price:8601000.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-12", year:2025, customer_name:"\"ЛУКОЙЛ-ЭНЕРГОСЕТИ\" Усинский район, г. Ухта, пгт. Ярега", tender_title:"Тендер . 13 \"Комплексная очистка внутренних поверхностей нагрева паровых котлов котельных и ПГУ СЦ \"Усинскэнергонефть\", СЦ \"Ярегаэнергонефть\", испарителей и технологического оборудования ВПУ-700 СЦ \"Ярегаэнергонефть\"", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-12", year:2025, customer_name:"ООО УК \"МЕТАЛЛОИНВЕСТ\" АО \"ОЭМК ИМ. А.А. УГАРОВА\"", tender_title:"Очистка аппаратов воздушного охлаждения ЭСПЦ, СПЦ-1, теплообменника ТСЦ в марте - июле 2026 г. для АО «ОЭМК им А.А. Угарова»", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-12", year:2025, customer_name:"ГРУППА КОМПАНИЙ РУСАГРО Никифоровский район, рп. Дмитриевка, Тамбовская область", tender_title:"Очистка поверхностей оборудования станции дефекосатурации. СЗ Никифоровка Работа по типовому договору Русагро 100% постоплата с отсрочкой платежа - 45 к/д Работы согласно ТЗ, ВОР, ЛСР", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-12", year:2025, customer_name:"Публичное акционерное общество \"\"СЛАВНЕФТЬ-ЯРОСЛАВНЕФТЕОРГСИНТЕЗ\"\"", tender_title:"Химическая очистка (промывка) внутренних поверхностей нагрева парогенерирующего оборудования методом щелочения", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-12", year:2025, customer_name:"ПАО \"РЗ ОЦМ\"", tender_title:"Работы по химической очистке пластинчатого теплообменника GL-42. Печьсветлого отжига, инв. No 57338. Заявка 1307", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-12", year:2025, customer_name:"ООО \"АИМ МЕНЕДЖМЕНТ\" Тульская обл, г. Новомосковск, ул. Связи, д. 10", tender_title:"Выполнение работ по ремонту технологического оборудования и трубопроводов цеха Карбамид-3 (1 очередь) АО «НАК «Азот» в период остановочного ремонта 2026 г. (ДЗУ-297-2025)", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-12", year:2025, customer_name:"АО \"АММОНИЙ\"", tender_title:"Проведение работ в 2026 г. по чистке, промывке внутренней части резервуаров и емкостей в цехе внутриплощадочного водоснабжения АО \"Аммоний\"", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-12", year:2025, customer_name:"АО \"СМП-Нефтегаз\"", tender_title:"Оказание услуг по очистке подземных и наземных емкостей от нефтяного шлама в 2026 году согласно графика", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-12", year:2025, customer_name:"ООО \"ЛУКОЙЛ-ЭНЕРГОСЕТИ\"", tender_title:"Оказание услуг по очистке сточной воды от нефтепродукта и взвешенных веществ для нужд СЦ \"Волгоградэнергонефть\" ВРУ ООО \"ЛУКОЙЛ-ЭНЕРГОСЕТИ\"", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-12", year:2025, customer_name:"АКЦИОНЕРНОЕ ОБЩЕСТВО \"ТАТЭНЕРГО\"", tender_title:"Оказание услуг по очистке внутренних поверхностей оборудования от органических и неорганических отложений для нужд филиала АО Татэнерго - Набережночелнинская ТЭЦ", pm_login:"archive", tender_status:"Другое", tender_price:31469464.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-12", year:2025, customer_name:"АО \"СМП-НЕФТЕГАЗ\"", tender_title:"Заключение договора на очистку подземных и наземных емкостей от нефтяного шлама на на 2026 год. Работы выполняются согласно заявке в течение 2026 года (график прилагается) все вопросы писать на площадку", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-12", year:2025, customer_name:"АКЦИОНЕРНОЕ ОБЩЕСТВО \"АНГАРСКАЯ НЕФТЕХИМИЧЕСКАЯ КОМПАНИЯ\"", tender_title:"Выполнение работ по чистке наружной поверхности змеевиков печей на установках НПП АО «АНХК» с применением химических реагентов без останова печей", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-11", year:2025, customer_name:"ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ \"АИМ МЕНЕДЖМЕНТ\"", tender_title:"Закупочная процедура по выбору подрядной организации на выполнение комплекса работ и оказания услуг по чистке емкостей, приямков и перегрузке катализаторов, сорбентов, насадок, а также выполнению прочих видов работ в цехах АО \"Невинномысский Азот\"", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"Волгодонский филиал акционерного общества «Инжиниринговая компания «АЭМ-технологии»", tender_title:"Выполнение работ по проведению пассивации сварных швов для деталей ГСПП АЭС Эль-Дабаа блок №4, согласно № ВФ/ТЗ/1773-25", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ \"БАЙКАЛЬСКАЯ ЭНЕРГЕТИЧЕСКАЯ КОМПАНИЯ\"", tender_title:"Оказание услуг по совершенствованию работы водоподготовительных установок, организации и контролю над проведением химических очисток, консерваций, пароводокислородных очисток и пассиваций тепломеханического оборудования филиалов ООО \"Байкальская энергетическая компания\"", pm_login:"archive", tender_status:"Клиент отказался", tender_price:5600000.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ \"ИЖОРАРЕМСЕРВИС\"", tender_title:"Выполнение работ по мойке, очистке (механическим слесарным способом под дальнейшую окраску) и по окраске в два слоя с подготовкой поверхности с обеспыливанием и обезжириванием гидравлического пресса двойного действия усилием 15000тс. ТЗ №ИРС-ТО 4/1892 от 23. 10. 2025", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"АО «Газпромнефть-ОНПЗ»", tender_title:"Оказание услуг «Проведение опытного пробега по подбору реагентов для предотвращения загрязнения сырьевых теплообменников установок ГО ДТ и ГОДП ДТ»", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ \"ГАЗПРОМ БУРЕНИЕ\"", tender_title:"104-УГМ Оказание услуг по капитальному ремонту бурового оборудования (оборудование систем очистки)", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"АО \"ЦЕМРОС\"", tender_title:"Проведение ТО теплообменников", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"Филиал \"Нижегородский\" ПАО «Т Плюс»", tender_title:"Оказание услуг «Очистка энергетического оборудования Новогорьковской ТЭЦ» для нужд филиала \"Нижегородский\" ПАО \"Т Плюс\"", pm_login:"archive", tender_status:"Клиент отказался", tender_price:4420763.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"Общество с ограниченной ответственностью \"НОВАТЭК-ТАРКОСАЛЕНЕФТЕГАЗ\"", tender_title:"Выполнение работ по ремонту, разбраковке и очистке НКТ, для дальнейшей эксплуатации по прямому назначению в скважинах, оказание транспортных услуг", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"ЗФ ПАО «ГМК «Норильский никель\"", tender_title:"Очистка котлов-утилизаторов марки Г-710, Г-950, Г-1030", pm_login:"archive", tender_status:"Клиент отказался", tender_price:14802972.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"", tender_title:"Зачистка резервуаров на НБП АО ТТК", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"ООО \"Транснефть - Порт Козьмино\"", tender_title:"R05-К-Y12-00154-2026 04/01-17/26 Мойка (очистка) наружной поверхности стен и крыш резервуаров Нефтебазы", pm_login:"archive", tender_status:"Клиент отказался", tender_price:11089618.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"АКЦИОНЕРНОЕ ОБЩЕСТВО ГАЗПРОМНЕФТЬ-ОМСКИЙ НПЗ", tender_title:"Выполнение работ по чистке пластинчатых теплообменников с применением химических реагентов на объектах АО \"Газпромнефть-ОНПЗ\" в 2026г", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"АО «Газпромнефть-Московский НПЗ»", tender_title:"Открытый конкурентный отбор организации, способной выполнить работы по чистке теплообменного оборудования с применением химических реагентов на установках ЭЛОУ-АВТ-6, ЛЧ-24/2000, ЛЧ-35/11-1000, Л-24/5, УИЛН, Г-43-107, КУПН Производства №1, №2, №3 АО «Газпромнефть – МНПЗ» в 2026-2028 гг", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"АО «Невинномысский Азот»", tender_title:"оказание услуг по чистке теплообменного оборудования, трубопроводов и арматуры в цехах №№1-Б,1-В,2,2-А,3-А,5,6,8,9,11,12,12-А, БХОиТООП АО «Невинномысский Азот» в 2026г.", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"АО \"РНПК\"", tender_title:"Выполнение работ по химической очистке пластинчатых теплообменников Compabloc установки ЭЛОУ-АТ-6 с вакуумным блоком ВТ-4 цеха №1 по первичным процессам в 2026-2028гг.", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"АО «Газпромнефть-ОНПЗ»", tender_title:"Выполнение работ по чистке пластинчатых теплообменников с применением химических реагентов на объектах АО \"Газпромнефть-ОНПЗ\" в 2026г", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"АКЦИОНЕРНОЕ ОБЩЕСТВО \"ТЕПЛОСЕТЬ\"", tender_title:"Проведение работ по химической промывке внутренних поверхностей нагрева котла ROSSEN RSM-40000 зав. №101 от накипи", pm_login:"archive", tender_status:"Клиент отказался", tender_price:1860066.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"Филиал \"Пермский\" Публичного акционерного общества «Т Плюс»", tender_title:"Чистка теплообменных аппаратов для нужд Филиала \"Пермский\" ПАО \"Т Плюс\" (Пермская ТЭЦ-9) (196/26)", pm_login:"archive", tender_status:"Клиент отказался", tender_price:2808000.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"АО «Апатит»", tender_title:"Ремонт теплообменников, ОКР Ам2", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ \"ИНТЕР РАО-ЦЕНТР УПРАВЛЕНИЯ ЗАКУПКАМИ\"", tender_title:"Котлоочистительные работы для Верхнетагильской ГРЭС", pm_login:"archive", tender_status:"Клиент отказался", tender_price:6848471.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"ООО \"Сибур\"", tender_title:"СТГ_ Выполнение работ по бластинг чистке оребрений секций АВО на производственных площадках АО СибурТюменьГаз в 2026-2028 гг", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"Филиал \"Пермский\" Публичного акционерного общества «Т Плюс»", tender_title:"Право заключения договора на оказание услуг «Гидродинамическая очистка теплообменного оборудования паровой котельной, блока ПГУ котлотурбинного цеха и котельного цеха ЛВК-3» для нужд Филиала «Пермский» ПАО «Т Плюс»(Пермская ТЭЦ-6) (204/26)", pm_login:"archive", tender_status:"Клиент отказался", tender_price:1932000.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"АО Черномортранснефть", tender_title:"Очистка поверхности технологических трубопроводов в технологическом лотке ПП Грушовая", pm_login:"archive", tender_status:"Клиент отказался", tender_price:1340388.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"ООО «АЛАБУГА-ВОЛОКНО»", tender_title:"Оказание услуг по гидродинамической чистке теплообменного оборудования для нужд ООО АЛАБУГА-ВОЛОКНО", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"Филиал \"Пермский\" Публичного акционерного общества «Т Плюс»", tender_title:"Чистка теплообменных аппаратов для нужд Филиала «Пермский» ПАО «Т Плюс» (Пермская ТЭЦ-9) (196/26)", pm_login:"archive", tender_status:"Клиент отказался", tender_price:2808000.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"Саратовский филиал ПАО «Т Плюс»", tender_title:"Оказание услуг по очистке тепломеханического оборудования на производственных объектах ГРЭС, ТЭЦ-2, ТЭЦ-3, ТЭЦ-5 в 2026г. для нужд филиала «Саратовский» ПАО «Т Плюс»", pm_login:"archive", tender_status:"Клиент отказался", tender_price:7193086.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"АО \"ТЮМЕННЕФТЕГАЗ\"", tender_title:"ТНГ-25-ОГМ-4 Оказание услуг по ремонту теплообменного аппарата установкой полноразмерных проходных втулок", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ \"ГРУППА КОМПАНИЙ \"РУСАГРО\"", tender_title:"Зачистка весовых и гидролотков. Заказчик ООО \"Жердевский сахарный завод\" Работа по типовому договору Русагро 100% постоплата с отсрочкой платежа - 45к/д Предоставление сметы в качестве КП Работы согласно ТЗ, ВОР, ЛСР", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"ЧАСТНОЕ УЧРЕЖДЕНИЕ \"СЕРВИСНАЯ КОМПАНИЯ БАНКА РОССИИ\"", tender_title:"Выполнение работ по очистке грязеотстойников на территориях Банка России", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"ВАЙЛДБЕРРИЗ; ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ \"ВАЙЛДБЕРРИЗ\"", tender_title:"Комплексная очистка местных вытяжных систем_Краснодар", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"\"ЛУКОЙЛ-ЭНЕРГОСЕТИ\"", tender_title:"Сервисное обслуживание КУ, котельной и общекотельного оборудования заказчика расположенных на объектах МЛСК им. В. Филановского; МЛСП им Ю. Корчагина, м/р им. В. И. Грайфера для нужд СЦ \"Астраханьэнегонефть\"", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"АКЦИОНЕРНОЕ ОБЩЕСТВО \"КОРДИАНТ\"", tender_title:"Промывка системы TCU валов Convex FM", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"ПУБЛИЧНОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО \"ЮНИПРО\"", tender_title:"Химическая очистка подогревателей-1, 2 для нужд Филиала \"Шатурская ГРЭС\" ПАО \"Юнипро\"", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"РУК", tender_title:"Оказание услуг по очистке и промывке поверхностей нагрева котлов КВТС-30-150 №№1-5 на 2026г. в котельной ПАО Распадская г. Междуреченск", pm_login:"archive", tender_status:"Другое", tender_price:11634588.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-11", year:2025, customer_name:"АО «ТТК»", tender_title:"Зачистка резервуаров на объектах АО ТТК", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"АКЦИОНЕРНОЕ ОБЩЕСТВО \"УПРАВЛЕНИЕ АДМИНИСТРАТИВНЫМИ ЗДАНИЯМИ\"", tender_title:"Оказание услуг по сервисному обслуживанию и ремонту оборудования очистки и подачи воды", pm_login:"archive", tender_status:"Клиент отказался", tender_price:4863504.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"АКЦИОНЕРНОЕ ОБЩЕСТВО \"ТГК-16\"", tender_title:"Техническое обслуживание (очистка) оборудования филиала АО «ТГК-16» - «Казанская ТЭЦ-3» в 2026 году.", pm_login:"archive", tender_status:"Клиент отказался", tender_price:14269218.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"ООО \"Сибур\"", tender_title:"Бюджетная оценка. Выполнение работ/оказание услуг по ремонту трубного пучка теплообменника кожухотрубного (конденсатор пропилена) 21-Е-4601В ООО Запсибнефтехим в 2026 году УКиГ пиролиз", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"АКЦИОНЕРНОЕ ОБЩЕСТВО \"ТАТЭНЕРГО\"", tender_title:"Оказание услуг по очистке внутренних поверхностей оборудования от органических и неорганических отложений для нужд филиала АО Татэнерго - Набережночелнинская ТЭЦ", pm_login:"archive", tender_status:"Клиент отказался", tender_price:30953571.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"Акционерное общество «Нижегородский пассажирский автомобильный транспорт»", tender_title:"Оказание услуг по очистке грязеотстойника «НПАП №2»", pm_login:"archive", tender_status:"Клиент отказался", tender_price:1315225.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"АО \"РНПК\"", tender_title:"Выполнение работ по химической очистке пластинчатых теплообменников Compabloc установки ЭЛОУ-АТ-6 с вакуумным блоком ВТ-4 цеха №1 по первичным процессам в 2026-2028гг", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"Акционерное общество \"Новокуйбышевский нефтеперерабатывающий завод\"", tender_title:"Обработка (промывка) с химическим реагентом поверхностных конденсаторов нефтяных и водяных паров Т-35/1, Т-35/2, Т-35/3, газов разложения колонны К-10, трехступенчатых пароэжекторных вакуумных насосов ЭЖ-1, ЭЖ-2 комплекса ЭЛОУ-АВТ-6млн. (АВТ-11) цеха №29, теплообменников Е-417, Е-413/А, В, контур от сепаратора V-301 до компрессоров С-301/А, В установки каталитического риформинга (CCR) цеха", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"Акционерное общество \"АПАТИТ\"", tender_title:"Выполнение работ по ремонту встроенных теплообменников п. 303А, 303Б ( очистка от загрязнений) Ам2 в период проведения остановочного капитального ремонта цехов и производств АО \"Апатит\" в 2026 г.", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ \"ВАЙЛДБЕРРИЗ\"", tender_title:"Прочистка коллекторов (промывка трубопровода гидродинамическим методом)", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"Русагро", tender_title:"Тендер на оказание услуг по очистке выпарных станций, теплообменного оборудования: Лот №1 Гидромическая очистка поверхности нагрева выпарной станции и подогревателей от накипи. СЗ Жердевка Лот №2 Гидромическая очистка поверхности нагрева выпарной станции и подогревателей от накипи. СЗ Отрада Лот №3 Очистка поверхности нагрева выпарной станции и подогревателей. СЗ Ника Лот №4 Очистка теплообменного оборудования. СЗ Никифоровка Работа по типовому договору Русагро Предоставление сметы в качестве КП Работы согласно ТЗ, ВОР, ЛСР 100% постоплата с отсрочкой платежа - 45 к/д", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"Акционерное общество \"Новокуйбышевский нефтеперерабатывающий завод\"", tender_title:"Обработка (промывка) с химическим реагентомповерхностных конденсаторов нефтяных и водяныхпаров Т-35/1, Т-35/2, Т-35/3, газов разложения колонныК-10, трехступенчатых пароэжекторных вакуумныхнасосов ЭЖ-1, ЭЖ-2 комплекса ЭЛОУ-АВТ-6млн. (АВТ-11)цеха No29, теплообменников Е-417, Е-413/А,В, контур отсепаратора V-301 до компрессоров С-301/А,В установкикаталитического риформинга (CCR) цеха No24", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-11", year:2025, customer_name:"ЦИТС «Волгограднефтегаз» ООО «РИТЭК»", tender_title:"Оказание услуг по техническому обслуживанию и ремонту теплообменного оборудования в ЦИТС Волгограднефтегаз ООО РИТЭК в 2025 г", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"ООО \"Транснефть - Порт Приморск\"", tender_title:"Мойка (очистка) наружной поверхности резервуаров", pm_login:"archive", tender_status:"Клиент отказался", tender_price:12971184.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"\"ЛУКОЙЛ-ЭНЕРГОСЕТИ\"", tender_title:"Тендер . 60 Выполнение работ по техническому обслуживанию и текущему ремонту систем водоотведения и очистки стоков на объектах ООО ЛУКОЙЛ-Волгограднефтепереработка 3.2.60", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"ПУБЛИЧНОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО \"ЮНИПРО\", М.О. г. Шатура", tender_title:"Химическая очистка подогревателей-1, 2 для нужд Филиала Шатурская ГРЭС ПАО Юнипро", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ \"РН-БУЗУЛУКСКОЕ ГАЗОПЕРЕРАБАТЫВАЮЩЕЕ ПРЕДПРИЯТИЕ\"", tender_title:"Работы по наружной очистке аппаратов воздушного охлаждения на действующих установках ООО РН-БГПП 2026-2027г", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-11", year:2025, customer_name:"АО \"ОЭМК ИМ. А.А. УГАРОВА\"", tender_title:"Выполнение работ по очистке и восстановлению шлаковых чаш в ЭСПЦ АО \"ОЭМК им. А.А. Угарова\"", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"Филиал публичного акционерного общества акционерная нефтяная компания «Башнефть» «Башнефть-Новойл»", tender_title:"Промывка с применением специализованных средств трубного пространства теплообменников Е-103А, Е-103В, Е-103С, Е-103D, Е-116А, Е-116В, Е-116С, Е-116D, Е-116Е на установке СКА Филиала ПАО АНК \"Башнефть\" \"Башнефть-Новойл\"", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-11", year:2025, customer_name:"АО \"МИХАЙЛОВСКИЙ ГОК ИМ. А.В. ВАРИЧЕВА\"", tender_title:"Очистка оборудования химическими реагентами, ручным или гидропневматическим способом в 2026 г.", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"ООО \"КЗ \"Ростсельмаш\"", tender_title:"Работы по устройству химической промывки теплообменника АХПП - 1 ванна", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"Филиал публичного акционерного общества акционерная нефтяная компания «Башнефть» «Башнефть-Новойл»", tender_title:"Выполнение работ по химической наружней чистке оребрения теплообменных трубок аппаратов воздушного охлаждения технологических объектов Филиала ПАО АНК Башнефть Башнефть Новойл", pm_login:"archive", tender_status:"Другое", tender_price:20180000.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-11", year:2025, customer_name:"АКЦИОНЕРНОЕ ОБЩЕСТВО \"УРАЛО-СИБИРСКАЯ ТЕПЛОЭНЕРГЕТИЧЕСКАЯ КОМПАНИЯ\"", tender_title:"Текущий ремонт (промывка) оборудования.", pm_login:"archive", tender_status:"Клиент отказался", tender_price:12240094.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"АО \"УСТЭК\"", tender_title:"Текущий ремонт (промывка) оборудования ЦТП , котельных", pm_login:"archive", tender_status:"Клиент отказался", tender_price:12240094.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"ОП ТЭЦ-17 АО Агрокомбинат «Южный»: Московская область, г. Ступино, ул. Фрунзе, вл.19", tender_title:"Ремонт и техническое обслуживание основного, вспомогательного и общестанционного турбинного, котельного и электротехнического оборудования, оборудования АПС, оборудования разгрузки, хранения и подачи топлива ОП ТЭЦ-17 для нужд АО Агрокомбинат \"Южный\" в 2026 г", pm_login:"archive", tender_status:"Клиент отказался", tender_price:161034335.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ \"ГРУППА КОМПАНИЙ \"РУСАГРО\"", tender_title:"Услуга по очистке котлов дефекосатурации. СЗ Чернянка, СК Кривец Работа по типовому договору Русагро Предоставление сметы в качестве КП Работы согласно ТЗ, ВОР, ЛСР 100% постоплата с отсрочкой платежа - 45 к/д.", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"АО \"НК \"КОНДАНЕФТЬ\"", tender_title:"Выполнение работ по зачистке аппаратов и резервуаров АО НК Конданефть с применением специализированной техники, подготовкой нефтешлама к транспортировке и вывозом на утилизацию", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"Общество с ограниченной ответственностью \"РН-Туапсинский нефтеперерабатывающий завод\"", tender_title:"Восстановление труб Аппаратов воздушного охлаждения установки ЭЛОУ-АВТ-12 Цеха", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"ЗФ ПАО «ГМК «Норильский никель\"", tender_title:"№ 164453 «Медный завод ЗФ. Очистка котлов-утилизаторов марки Г-710, Г-950, Г-1030", pm_login:"archive", tender_status:"Клиент отказался", tender_price:14802972.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"Филиал \"Азот\" Акционерного общества \"Объединенная химическая компания \"УРАЛХИМ\" в городе Березники", tender_title:"Чистка теплообменного оборудования в период остановочного ремонта цехов №3А, ВАА, ННС филиала \"Азот\" в 2026 г. на основании рамочного договора_АЗОТ_2026", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"АО \"АНПЗ ВНК\"", tender_title:"ВЫПОЛНЕНИЕ РАБОТ ПО ЧИСТКЕ НАРУЖНОЙ ПОВЕРХНОСТИ ТРУБОК И ОРЕБРЕНИЙ АВО НА СЕКЦИИ 100 , СЕКЦИИ 200, СЕКЦИИ 300 КОМБИНИРОВАННОЙ УСТАНОВКИ ЛК-6УС, УСТАНОВКИ ИЗОМЕРИЗАЦИИ С ПРИМЕНЕНИЕМ РЕАГЕНТОВ", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"Публичное акционерное общество «КуйбышевАзот»", tender_title:"Чистка трубных пучков теплообменников, аппаратов, линий от отложений с применением насоса высокого давления согласно графика с 05. 04. 2026 по 12. 04. 2026", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"ПАО \"САРАТОВСКИЙ НПЗ\"", tender_title:"Выполнение работ по капитальному ремонту установки ЭЛОУ-АВТ-6 производства №1 в 2026г.(Теплообменное оборудование)", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"Акционерное Общество \"Тюменнефтегаз\"", tender_title:"ТНГ-25-ОГМ-НЗ-7 «Оказание услуг по восстановлению герметичности аппаратов теплообменных пластинчатых»", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"АКЦИОНЕРНОЕ ОБЩЕСТВО \"ТОПЛИВНО-ЭНЕРГЕТИЧЕСКИЙ КОМПЛЕКС САНКТ-ПЕТЕРБУРГА\"", tender_title:"Выполнение работ по текущему ремонту теплообменного оборудования на ЦТП и котельных ФЭИ АО ТЭК СПб на 2026 год", pm_login:"archive", tender_status:"Клиент отказался", tender_price:24656508.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ \"РН-ТУАПСИНСКИЙ НЕФТЕПЕРЕРАБАТЫВАЮЩИЙ ЗАВОД \"", tender_title:"Оказание услуг по зачистке резервуаров ООО РН-Туапсинский НПЗ на 2026 г", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"ПАО \"САРАТОВСКИЙ НПЗ\"", tender_title:"Оказание услуг по промывке пластинчатого теплообменного аппарата пакинокс тех. поз. Т- 6 N Производства №2 ПАО Саратовский НПЗ с применением химических реагентов", pm_login:"archive", tender_status:"Другое", tender_price:20267903.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-11", year:2025, customer_name:"ООО КЛИНИКА-САНАТОРИЙ «НАБЕРЕЖНЫЕ ЧЕЛНЫ»", tender_title:"выполнение текущего ремонта, очистки и дезинфекции системы вентиляции здания", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"ГРУППА КОМПАНИЙ РУСАГРО; ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ \"ГРУППА КОМПАНИЙ \"РУСАГРО\"", tender_title:"Услуги по очистке выпарных установок/очистке пластинчатых теплообменников. СЗ Знаменка, СЗ Никифоровка Работа по типовому договору Русагро Предоставление сметы в качестве КП Работы согласно ТЗ, ВОР, ЛСР 100% постоплата с отсрочкой платежа - 45к/д", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-11", year:2025, customer_name:"АО \"ЦЕМРОС\"; АКЦИОНЕРНОЕ ОБЩЕСТВО \"ЦЕМРОС\"", tender_title:"Оказание услуг по очистке циклонного теплообменника от настыли сухого способа производства цемента АО \"Мордовцемент\", расположенного по адресу: р. п. Комсомольский, Чамзинский район, Республика Мордовия, Россия, 431720", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"ООО «Газпромнефть Марин Бункер»", tender_title:"№ 01-3028783-351-2025 Оказание услуг по замывке грузовых танков, грузовых насосов и топливных магистралей судов ООО \"Газпромнефть Шиппинг\" (2 лота)", pm_login:"archive", tender_status:"Другое", tender_price:883508580.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-11", year:2025, customer_name:"Акционерное общество «Сыктывкарский ЛПК»", tender_title:"25001152 - Комплексы работ по чистке поверхностей основного и вспомогательного оборудования ТЭЦ АО СЛПК", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"АКЦИОНЕРНОЕ ОБЩЕСТВО \"УРАЛО-СИБИРСКАЯ ТЕПЛОЭНЕРГЕТИЧЕСКАЯ КОМПАНИЯ\"", tender_title:"Текущий ремонт (промывка) оборудования.", pm_login:"archive", tender_status:"Клиент отказался", tender_price:12240094.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"Акционерное общество \"Производственное объединение \"Электрохимический завод\"", tender_title:"Выполнение работ по химической очистке труб", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"ООО «Нобель Ойл» (КО)", tender_title:"Проведение работ по зачистке емкостного оборудования на объекте подготовки нефти в 2026 году", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-11", year:2025, customer_name:"ООО Газпромнефть-Терминал", tender_title:"Оказание услуг по зачистке резервуаров на территории объектов ООО Газпромнефть-Терминал (2 лота)", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"Общество с ограниченной ответственностью «Научно-исследовательский институт трубопроводного транспорта»", tender_title:"Зачистка резервуаров для хранения нефти и нефтепродуктов, включая пескоструйную обработку металлоконструкций, на объектах организаций системы «Транснефть»", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ \"АВТОЗАВОДСКАЯ ТЭЦ\"", tender_title:"Выполнение работ по очистке основного и вспомогательного оборудования ООО Автозаводская ТЭЦ", pm_login:"archive", tender_status:"Клиент отказался", tender_price:31529436.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-11", year:2025, customer_name:"АКЦИОНЕРНОЕ ОБЩЕСТВО \"ИНФРАСТРУКТУРНЫЕ ПРОЕКТЫ\", Старобешево, поселок городского типа Новый Свет, Донецкая Народная Республика", tender_title:"Оказание услуг по очистке трубок конденсаторов турбины энергоблоков Старобешевской ТЭС, ПРОД-2026-ИП-СТЭС", pm_login:"archive", tender_status:"Клиент отказался", tender_price:28690331.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"ГАЗПРОМ НЕФТЬ ШЕЛЬФ", tender_title:"Оказание услуг по химической промывке огневых подогревателей Z44010 и теплообменных аппаратов МЛСП Приразломная для нужд ООО Газпром нефть шельф", pm_login:"archive", tender_status:"Другое", tender_price:577369413.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-10", year:2025, customer_name:"Публичное акционерное общество \"\"СЛАВНЕФТЬ-ЯРОСЛАВНЕФТЕОРГСИНТЕЗ\"\"", tender_title:"Выполнение работ по реагентной очистке технологического оборудования технологических установок", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"Акционерное общество \"Дальневосточная генерирующая компания\"", tender_title:"ОКПД2 38. 22. 29 Оказание услуг по очистке бака хранения мазута, нефтеловушки мазутного хозяйства для Приморских тепловых сетей, г. Владивосток", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ \"ИНТЕР РАО-ЦЕНТР УПРАВЛЕНИЯ ЗАКУПКАМИ\"", tender_title:"220031 Работы по очистке оборудования энергоблоков №№ 1,2,3 и ОСО Нижневартовской ГРЭС", pm_login:"archive", tender_status:"Клиент отказался", tender_price:46235177.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"ЗЕНИТ-АРЕНА", tender_title:"Выполнение работ по очистке внутренних поверхностей воздуховодов вентиляционных систем, обслуживающих пищевое производство на «Газпром Арене»", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"АКЦИОНЕРНОЕ ОБЩЕСТВО \"МЕССОЯХАНЕФТЕГАЗ\"", tender_title:"01-3027165-335-2025, Открытый одноэтапный конкурентный отбор на право заключения договора на восстановление забоя с применением комплекса работ по промывке и нормализации забоя (прокат оборудования, инженерное сопровождение) по направлению ТКРС и сопутствующих услуг при ТКРС» для АО «Мессояханефтегаз» в 2026-2027гг.", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"УН ЭКС", tender_title:"Выполнение работ по ремонту и замене теплообменников приточных вентиляционных машин (ТРК СемьЯ , г. Уфа)", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"AZIMUT Санаторий Ивушка; САНАТОРИЙ \"ИВУШКА\"", tender_title:"Работы по механической и химической чистке теплообменных водонагревателей системы ГВС", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"Публичное акционерное общество «Форвард Энерго»", tender_title:"Выполнение работ по очистке от отложений оборудования Челябинских ТЭЦ-3 и ТЭЦ-4", pm_login:"archive", tender_status:"Клиент отказался", tender_price:12116850.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"ГРУППА КОМПАНИЙ РУСАГРО; ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ \"ГРУППА КОМПАНИЙ \"РУСАГРО\"", tender_title:"Работы по ремонту пластинчатых теплообменников. Заказчик ООО \"Русагро-Тамбов\" - \"Жердевский\" Работа по типовому договору Русагро Предоставление сметы в качестве КП Работы согласно ТЗ, ВОР, ЛСР. 100% постоплата с отсрочкой платежа - 45 к/д", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"ОБЩЕСТВО С ОГРАНИЧЕННОЙОТВЕТСТВЕННОСТЬЮ \"СЕРВИСИНЖИНИРИНГ СИСТЕМС\"", tender_title:"Выполнение теплоизоляционных и обмуровочных работ на основном и вспомогательном оборудовании котлоагрегата БКЗ-320-140 ст. №8 филиала ООО БЭК ТЭЦ-6", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"АКЦИОНЕРНОЕ ОБЩЕСТВО \"ИНТЕР РАО-ЭЛЕКТРОГЕНЕРАЦИЯ\"", tender_title:"Ремонт тепловой изоляции, установка лесов, подготовка к ЭПБ, устранение дефектов для Пермской ГРЭС АО Интер РАО – Электрогенерация", pm_login:"archive", tender_status:"Клиент отказался", tender_price:109513855.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"Общество с ограниченной ответственностью «Шкаповское газоперерабатывающее предприятие»", tender_title:"Ремонт теплообменника конденсатора серы", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ ГАЗПРОМНЕФТЬ-БИТУМНЫЕ МАТЕРИАЛЫ", tender_title:"Оказание услуг по зачистке внутренних поверхностей емкостного оборудования от коксовых отложений и битумных материалов с последующей выемкой из аппаратов", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"АО \"ТЮМЕННЕФТЕГАЗ\"", tender_title:"Оказание услуг по ремонту теплообменного аппарата установкой полноразмерных проходных втулок", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"Общество с ограниченной ответственностью «ГЭХ Закупки»", tender_title:"МИ №2857/МИ - Осуществление работ по очистке, выборке и вывозу на утилизацию отходов, образующихся от очистных сооружений (шламонакопитель №2) на Северной ТЭЦ (ТЭЦ-21) филиала «Невский» ПАО «ТГК-1» (D25NP01136)", pm_login:"archive", tender_status:"Клиент отказался", tender_price:55465200.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"Завод Технофлекс", tender_title:"Запрос цен на выбор поставщика услуг по монтажу, изоляции, обвязки -демонтажу теплообменников 202510_2205", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"Самарский филиал Публичного акционерного общества «Т Плюс»", tender_title:"\"Капитальный ремонт теплообменных аппаратов НС- 22, ЦТП- 196\" для нужд ПТС филиала \"Самарский\" ПАО \"Т Плюс\".", pm_login:"archive", tender_status:"Клиент отказался", tender_price:1334338.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"АКЦИОНЕРНОЕ ОБЩЕСТВО \"ВТЕ ЮГО-ВОСТОК\"", tender_title:"Оказание услуг по очистке емкостного оборудования участка по производству противогололедного реагента от солевых отходов", pm_login:"archive", tender_status:"Клиент отказался", tender_price:3582800.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"РУСАЛ Ачинск", tender_title:"Выполнение работ по технологической очистке каналов ГЗУ КА ст. №№ 1-8, приемных бункеров багерных насосных, перекрытий котельного и зольного отделения, боровов дымовых труб №1, 2 от золовых отложений, очистка стенок приемных бункеров ленточных питателей № ЛП-1, 2, 3, 4 ЦТП при выгрузке угля от налипаний, очистка чаш башенных и вентиляторной градирен от донных, иловых отложений в 2026 году", pm_login:"archive", tender_status:"Клиент отказался", tender_price:7500000.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ \"РОССИЙСКАЯ ИННОВАЦИОННАЯ ТОПЛИВНО-ЭНЕРГЕТИЧЕСКАЯ КОМПАНИЯ\"", tender_title:"Техническое обслуживание и ремонт теплообменного оборудования ООО РИТЭК по Волгоградскому региону в 2026", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"Филиал ИСО в г.Красноярск", tender_title:"Текущий ремонт тепловой изоляции трубопроводов и оборудования ДпПАМ, ДпОП, ЭЦ АО РУСАЛ Красноярск в 2026г. (2-й этап торгов)", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"Акционерное общество \"Интер РАО – Электрогенерация\"", tender_title:"Ремонт, замена обмуровки и тепловой изоляции на оборудовании во время КР, СР, ТР для Верхнетагильской ГРЭС", pm_login:"archive", tender_status:"Клиент отказался", tender_price:39331598.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"АО \"РН-Ростовнефтепродукт\"", tender_title:"Оказание услуг по зачистке резервуаров на АЗС/АЗК АО \"РН-Ростовнефтепродукт\" Ростовская область, Лот2. \"На оказание услуг по зачистке резервуаров на АЗС/АЗК АО \"РН-Ростовнефтепродукт\", г. Волгоград\" на 2026 г", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"КАО \"Азот\"", tender_title:"Гидромеханическая очистка внутренней поверхности теплообменных труб в цехе Аммиак-2 КАО \"Азот\".", pm_login:"archive", tender_status:"Клиент согласился", tender_price:15500000.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-10", year:2025, customer_name:"АО «Апатит»", tender_title:"Гидродинамическая (гидроструйная) очистка теплообменного оборудования АО Апатит", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ \"СЕВЗАПОПТТОРГ\"", tender_title:"Чистка дымовых труб котельной", pm_login:"archive", tender_status:"Клиент отказался", tender_price:2324697.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"АКЦИОНЕРНОЕ ОБЩЕСТВО \"ВЕРХНЕЧОНСКНЕФТЕГАЗ\"", tender_title:"Выполнение работ по монтажу теплоизоляции трубопроводов на объекте: Электростанция собственных нужд на период ППЭ . Северо-Даниловское месторождение", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ \"ГСП Ремонт\"", tender_title:"Выполнение работ по техническому обслуживанию аппаратов воздушного охлаждения газа КС Портовая для нужд ООО Газпром трансгаз Санкт-Петербург в 2025 году", pm_login:"archive", tender_status:"Клиент отказался", tender_price:22661767.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"ПАО «Т Плюс» (г. Самара)", tender_title:"«Предремонтная очистка оборудования КТЦ (ТО)» для нужд Тольяттинской ТЭЦ филиала «Самарский» ПАО «Т Плюс».", pm_login:"archive", tender_status:"Клиент отказался", tender_price:1977428.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"ООО \"РН-ТРАНСПОРТ\"", tender_title:"«Оказание услуг по очистке воздушных путей вентиляции от пылевых отложений» в 2026 году.", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"Саратовский филиал ПАО «Т Плюс»", tender_title:"оказание услуг по очистке тепломеханического оборудования БалаковскойТЭЦ-4 для нужд филиала «Саратовский» ПАО «Плюс»", pm_login:"archive", tender_status:"Клиент отказался", tender_price:3780000.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"АО \"ЧЦЗ\"", tender_title:"Ремонт - бережная химическая очистка драйкуллеров ALFA LU-VE модель VDD6N (2шт). Компрессорной станции (южный машзал)", pm_login:"archive", tender_status:"Другое", tender_price:4080000.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-10", year:2025, customer_name:"ГРУППА КОМПАНИЙ РУСАГРО; ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ \"ГРУППА КОМПАНИЙ \"РУСАГРО\"", tender_title:"Работы по гидродинамической очистке поверхности нагрева выпарной станции и подогревателей сахарного завода ООО \"Русагро-Белгород\" Работа по типовому договору Русагро Предоставление ЛСР в качестве КП Работы согласно ТЗ, ВОР, ЛСР 100% постоплата с отсрочкой платежа - 45 к/д", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"ООО «НСХ»", tender_title:"Капитальный ремонт систем очистки бурового раствора", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"ООО \"КУРОРТ МАНЖЕРОК\" ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ \"КУРОРТ МАНЖЕРОК\"", tender_title:"Оказание услуг по очистке внутренних поверхностей системы вентиляции от пылевых, жировых и пожароопасных отложений", pm_login:"archive", tender_status:"Клиент отказался", tender_price:3597861.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"АО \"ТГК-16\"", tender_title:"Очистка оборудования ХВО филиала АО «ТГК-16» - «Нижнекамская ТЭЦ(ПТК-1)» в 2026 году.", pm_login:"archive", tender_status:"Клиент отказался", tender_price:3041076.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"АО \"ЧЦЗ\"", tender_title:"Ремонт - бережная химическая очистка драйкуллеров ALFA LU-VE модель VDD6N (2шт). Компрессорной станции (южный машзал)", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ \"ОБЪЕДИНЕННЫЙ ВОДОКАНАЛ\"", tender_title:"Выполнение работ по очистке и дезинфекции двух резервуаров Водозабора Европея на земельном участке кадастровый паспорт №2343/12/12-558735", pm_login:"archive", tender_status:"Клиент отказался", tender_price:3819944.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"Акционерное общество «Инжиниринговая компания «АЭМ-технологии»", tender_title:"Выполнение работ по травлению и пескоструйной обработке металлических заготовок", pm_login:"archive", tender_status:"Другое", tender_price:38400000.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-10", year:2025, customer_name:"АКЦИОНЕРНОЕ ОБЩЕСТВО \"РОСАТОМ ВОЗОБНОВЛЯЕМАЯ ЭНЕРГИЯ\"", tender_title:"Оказание услуг по обращению с промышленными отходами производства и потребления для нужд АО Росатом Возобновляемая энергия", pm_login:"archive", tender_status:"Клиент отказался", tender_price:9999990.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"АКЦИОНЕРНОЕ ОБЩЕСТВО \"ВАНИНОТРАНСУГОЛЬ\"", tender_title:"784 - запрос предложений стоимости оказания услуг по зачистке от угольной пыли и просыпей угля объектов АО \"ВТУ\"", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"АКЦИОНЕРНОЕ ОБЩЕСТВО \"ХАБАРОВСКАЯ РЕМОНТНО-МОНТАЖНАЯ КОМПАНИЯ\"", tender_title:"Очистка теплообменных аппаратов ГК СП Комсомольская ТЭЦ-3 для нужд СП Филиал Северный АО ХРМК", pm_login:"archive", tender_status:"Клиент отказался", tender_price:3954719.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"АКЦИОНЕРНОЕ ОБЩЕСТВО \"НОВОКУЙБЫШЕВСКАЯ НЕФТЕХИМИЧЕСКАЯ КОМПАНИЯ\"", tender_title:"Выполнение работ по чистке технологического оборудования цеха №27 АО ННК ТЭЦ-2", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"АО «Газпромнефть-МНПЗ»", tender_title:"Открытый конкурентный отбор организации, способной выполнить работы по реагентной обработке во время пропарки и промывки оборудования дизельным топливом для сдачи в ремонт на технологических объектах АО «Газпромнефть – МНПЗ»", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"Филиал \"Владимирский\" ПАО «Т Плюс»", tender_title:"Оказание услуг по очистке технологического оборудования ИвТЭЦ-2 для нужд филиала \"Владимирский\" ПАО \"Т Плюс\"", pm_login:"archive", tender_status:"Клиент отказался", tender_price:9653520.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"АО «Почта России»", tender_title:"Выполнение работ по промывке и гидроопрессовке внутренней системы отопления для нужд УФПС Краснодарского края.", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"ООО \"НЕФТЕХИМРЕМОНТ\"", tender_title:"Выполнение работ по чистке резервуаров, емкостей ручным и механизированным способом в 2025-2028 гг. на объектах АО «Газпромнефть-ОНПЗ»", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"ООО \"РН-БУЗУЛУКСКОЕ ГАЗОПЕРЕРАБАТЫВАЮЩЕЕ ПРЕДПРИЯТИЕ\"", tender_title:"Зачистка донных отложений мазута мазутного бака№2 для нужд филиала Смоленская ГРЭС ПАО Юнипро", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"Филиал \"Азот\" Акционерного общества \"Объединенная химическая компания \"УРАЛХИМ\" в городе Березники", tender_title:"Выполнение работ в период остановочного ремонта производства аммиака, агрегата аммиака № 1_АЗОТ_2026", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"Филиал \"Азот\" Акционерного общества \"Объединенная химическая компания \"УРАЛХИМ\" в городе Березники", tender_title:"Выполнение работ в период остановочного ремонта производства аммиака, агрегата аммиака № 2_АЗОТ_2026", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"АКЦИОНЕРНОЕ ОБЩЕСТВО \"РОСГАЗИФИКАЦИЯ\"", tender_title:"Выполнение работ по ремонту (сварка, монтаж/демонтаж, зачистка, контроль) на установке ЭЛОУ АВТ-6 цех №1 на АО СНПЗ", pm_login:"archive", tender_status:"Клиент отказался", tender_price:37169755.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"АО «Газпромнефть-МНПЗ»", tender_title:"Открытый конкурентный отбор организации, способной выполнить работы по гидромеханической чистке и гидроструйной промывке трубопроводов и внутренней поверхности аппаратов с применением насосов высокого давления на технологических объектах АО «Газпромнефть – МНПЗ»", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"ГРУППА КОМПАНИЙ РУСАГРО; ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ \"ГРУППА КОМПАНИЙ \"РУСАГРО\"", tender_title:"Работы по очистке оборудования, восстановление поверхности нагрева для НИКИФОРОВСКИЙ САХАРНЫЙ ЗАВОД ООО. Работа по типовому договору Русагро Предоставление ЛСР в качестве КП Работы согласно ТЗ, ВОР, ЛСР 100% постоплата с отсрочкой платежа - 45 к/д.(заявка № 97798)", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-10", year:2025, customer_name:"Публичное акционерное общество \"Форвард Энерго\"", tender_title:"Оказание услуг по очистке шлакоотстойника Челябинской ТЭЦ-3 в 2025 - 2026 годах.", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ \"АГРОЭКО-ЛОГИСТИКА\"", tender_title:"Очистка поверхности теплообмена испарительных конденсаторов, Воронежская область, Павловский район, для нужд ГК АГРОЭКО", pm_login:"archive", tender_status:"Другое", tender_price:14486563.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-10", year:2025, customer_name:"АО Черномортранснефть", tender_title:"F05-К-Y03-00182-2026 2. 113. 26 Очистка плавающих крыш резервуаров ПП Грушовая", pm_login:"archive", tender_status:"Клиент отказался", tender_price:6185520.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"Ростовский ЭРЗ", tender_title:"Сервисные работы (разборная химическая отчистка, включая все необходимые материалы) двух пластинчатых теплообменников \"АСТЕРА\" S22 O-16 17-01269/1, \"АСТЕРА\" S22 O-16 17-01269/2 системы ГВС с заменой дисковых затворов", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"ООО «Газпромнефть-Логистика»", tender_title:"Выполнение работ по очистке от нефтепродуктов железнодорожной эстакады тит. 1344, очистке промышленной и ливневой канализации эстакад тит. 1345 и тит. 4014 Московского центра отгрузки нефтепродуктов ООО «ГПН-Логистика»", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"ООО «Газпромнефть-БМ»", tender_title:"Выполнение работ по зачистке резервуаров", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"ООО «Томскнефть-Сервис»", tender_title:"Оказание услуг по техническому обслуживанию систем наружных и внутренних трубопроводов с проведением гидравлических испытаний и промывки теплосетей", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"ПАО \"Татнефть\" им. В.Д.Шашина", tender_title:"Очистка наружной поверхности насосно-компрессорных труб в кол-ве 51314 шт. ООО \"ТН-Сервис\"", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ НОВАТЭК-ПУРОВСКИЙ ЗПК", tender_title:"Выполнение работ по техническому обслуживанию и ремонту систем кондиционирования и холодильных установок, установке и пуско-наладке нового оборудования", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-10", year:2025, customer_name:"МУП \"РКЦ Р.П.ЛИНЕВО\"", tender_title:"Выполнение работ по химической очистке (промывке) кожухотрубных теплообменных аппаратов на ЦТП р.п. Линево", pm_login:"archive", tender_status:"Клиент отказался", tender_price:2369703.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"ТЕХНОНИКОЛЬ СБЕ КМС; ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ \"ЗАВОД ШИНГЛАС\"", tender_title:"Очистка ёмкости РВС", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"АО «Апатит»", tender_title:"Гидродинамическая (гидроструйная) очистка теплообменного оборудования АО Апатит", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-10", year:2025, customer_name:"Филиал \"Пермский\" ПАО «Т Плюс»", tender_title:"Право заключения договора на оказание услуг «Механическая очистка оборудования котлотурбинного цеха Пермская ТЭЦ-14» для нужд Филиала «Пермский» ПАО «Т Плюс» (Пермская ТЭЦ-14) (159/26)", pm_login:"archive", tender_status:"Клиент отказался", tender_price:539200.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"Общество с ограниченной ответственностью «ГЭХ Закупки»", tender_title:"3152/ТЭР - Выполнение работ по ремонту с очисткой от отложений теплообменного оборудования (ПСГ, КЦС, МО) в период среднего ремонта паровой турбины ст.№40 Южной ТЭЦ (ТЭЦ-22) филиала \"Невский\" ПАО \"ТГК-1\" для нужд ООО \"ГЭХ ТЭР\" (12.501.УО.2025)", pm_login:"archive", tender_status:"Клиент отказался", tender_price:6652567.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-10", year:2025, customer_name:"ФЕДЕРАЛЬНОЕ ГОСУДАРСТВЕННОЕ УНИТАРНОЕ ПРЕДПРИЯТИЕ \"РОСМОРПОРТ\" порт Владивосток", tender_title:"(АркБФ) Проведение комплекса работ по зачистке и дезинфекции танков пресной воды для ледокола «Капитан Драницын»", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"АО \"НАК \"АЗОТ\"", tender_title:"Срочная закупка_RUNAK-9922_выполнение комплекса(ов) работ и оказания услуг по химической очистке трубопровода нагнетания насосов (поз.53/1-2) отделения ХВО-3 цеха ПВС АО «НАК «Азот»", pm_login:"archive", tender_status:"Клиент отказался", tender_price:12000000.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"ООО \"СЛАВЯНСК ЭКО\" г. Славянск-на-Кубани, ул. Колхозная, д. 2", tender_title:"Выбор подрядной организации на оказание услуги по биоорганической очистке трубного пространства теплообменных аппаратов на объекте ООО «Славянск ЭКО»: ТУ АТ-5.", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"ООО \"СЛАВЯНСК ЭКО\"", tender_title:"Выбор подрядной организации на оказание услуги по очистке внутренней части корпуса и трубного пучка теплообменных аппаратов на объектах ООО «Славянск ЭКО»: ТУ АТ-5.", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"АКЦИОНЕРНОЕ ОБЩЕСТВО \"АНГАРСКИЙ ЗАВОД ПОЛИМЕРОВ\"", tender_title:"Работы по зачистке резервуаров Р-4,5,6 от нефтяного шлама", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"ООО \"БАШНЕФТЬ-ДОБЫЧА\"", tender_title:"Выполнение работ по ремонту секций аппаратов воздушного охлаждения путем замены несущих теплообменных трубок", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"ТД Полиметалл, ООО", tender_title:"Промывка водонагревательных котлов хим. реагентами", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"Федерейшен Групп", tender_title:"Реагентная отмывка отложений с поверхностей теплообменников и системы орошения 5 - ти градирен BAC VXI 430-4 с применением системы контроля водно-химического режима оборотной воды", pm_login:"archive", tender_status:"Другое", tender_price:8974548.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-09", year:2025, customer_name:"ННК, АО", tender_title:"Выполнение работ по очистке водосборного бассейна вентиляторных градирен участка оборотного водоснабжения", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"ООО \"ЛУКОЙЛ-НИЖНЕВОЛЖСКНЕФТЬ\"", tender_title:"Зачистка и замывка очистных поршней", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"ООО ГК \"СЛАДКАЯ ЖИЗНЬ\"", tender_title:"Замена пропиленгликоля, установка воздухоотводчиков и перенос фанкойла системы холодоснабжения", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"Центральный банк Российской Федерации", tender_title:"Выполнение работ по ремонту пластинчатых теплообменников (замене уплотнителей) на объектах Банка России по г. Москве и Московской области", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"АО «СибЭР»", tender_title:"Оказание услуг кислородной очистки и пассивации котлов БКЗ 220-100-5 ст. №3А, 3Б, котла БКЗ-670-140 ст. №10 блока№6 Приморской ГРЭС.", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"ПАО «НК «Роснефть»", tender_title:"Оказание услуг по обработке (промывке) с химическим реагентом поверхностных конденсаторов нефтяных и водяных паров Т-35/1, Т-35/2, Т-35/3, газов разложения колонны К-10, трехступенчатых пароэжекторных вакуумных насосов ЭЖ-1, ЭЖ-2 комплекса ЭЛОУ-АВТ-6млн. (АВТ-11) цеха №29, теплообменников Е-417, Е-413/А,В, контура от сепаратор V-301 до компрессоров С-301/А,В установки каталитического риформинга (CCR) цеха №24", pm_login:"archive", tender_status:"Другое", tender_price:53657266.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-09", year:2025, customer_name:"Управление федеральной почтовой связи г. Санкт-Петербурга и Ленинградской области", tender_title:"Оказание услуг по промывке и опрессовке систем отопления для нужд УФПС Калининградской области", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"ООО \"АЛЛНЕКС БЕЛГОРОД\"", tender_title:"Теплоизоляция трубопроводов резервуарного парка", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"КАЗЕННОЕ ПРЕДПРИЯТИЕ \"МОСКОВСКАЯ ЭНЕРГЕТИЧЕСКАЯ ДИРЕКЦИЯ\"", tender_title:"Оказание услуг по химической промывке от скопившейся накипи и замене комплектующих теплообменников", pm_login:"archive", tender_status:"Клиент отказался", tender_price:29000000.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"АО \"ЦЕМРОС\"", tender_title:"Оказание услуг по восстановлению теплоносителя на основе этиленгликоля в инженерной системе холодоснабжения Петербургского филиала АО «ЦЕМРОС»", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-09", year:2025, customer_name:"ООО \"Вита плюс\"", tender_title:"Выполнение комплекса работ по ремонту парового котла КЕ-10-14-225СО АО Купинский молочный комбинат", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"АО \"КНПЗ\"", tender_title:"Оказание услуг по гидромеханической чистке змеевиков печи П-101 и гидроструйной чистке технологических трубопроводов установки Висбрекинг и блока стабилизации бензин-отгонов АО \"КНПЗ\"", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"АО \"КНПЗ\"", tender_title:"Оказание услуг по химической очистке пластинчатых теплообменников установок ЭЛОУ-АВТ-3,0 (АВТ-4), Висбрекинг, FCC, МТБЭ, 35/11-1000", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"Русал Красноярск, АО", tender_title:"Оказание услуг по сервисному обслуживанию пробоподготовительного оборудования ЦЗЛ СК и станка \"Сибирь АРМ\" на АО «РУСАЛ Красноярск»", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ \"СЛАВЯНСК ЭКО\"", tender_title:"Выбор подрядной организации на оказание услуг по очистке гидромеханическим способом внутренней части шлемового трубопровода колонны К-1, колонны К-2, технологической установки АТ-5.", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"ПУБЛИЧНОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО \"ЮНИПРО\"", tender_title:"Ремонт тепловой изоляции и обмуровки оборудования и трубопровода в 2026 году для нужд филиала Сургутская ГРЭС-2", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"АКЦИОНЕРНОЕ ОБЩЕСТВО \"ИРКУТСКНЕФТЕПРОДУКТ\"", tender_title:"Зачистка резервуарной емкости РВС-3000м3 № 61 инв. №00431582 от остатков нефтепродуктов и донных отложений", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"ГСП Ремонт, ООО", tender_title:"Выполнение работ по техническому обслуживанию аппаратов воздушного охлаждения масла газоперекачивающих агрегатов на объектах ООО \"Газпром трансгаз Ставрополь\" в 2026 году", pm_login:"archive", tender_status:"Клиент отказался", tender_price:11720259.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"АО \"Рязанская нефтеперабатывающая компания\"", tender_title:"Выполнение работ по очистке котлов вагон цистерн от мазутных отложени", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ \"ГСП Ремонт\"", tender_title:"Выполнение работ по техническому обслуживанию аппаратов воздушного охлаждения масла для нужд ООО Газпром трансгаз Москва в 2025 году", pm_login:"archive", tender_status:"Клиент отказался", tender_price:11047629.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"АКЦИОНЕРНОЕ ОБЩЕСТВО \"ЦЕМРОС\"", tender_title:"Выполнение работ по очистке циклонного теплообменника от обмазки, настыли на Сенгилеевском филиале АО ЦЕМРОС", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"ООО УК \"ПМХ\"", tender_title:"Очистка теплообменника пластинчатого", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"АО \"ТГК-16\"", tender_title:"Ремонт теплообменного оборудования КТЦ-2, ЦТО филиала АО ТГК-16 - Нижнекамская ТЭЦ (ПТК-1) в 2026 году", pm_login:"archive", tender_status:"Клиент отказался", tender_price:35550953.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"Филиал публичного акционерного общества акционерная нефтяная компания «Башнефть» «Башнефть-Новойл»", tender_title:"выполнениеработпо гидроструйной чистке технологического оборудованияи трубопроводов установок ТК-2, ТК-3, 21-10/700цеха No2 Блока ЗГИ по ПНиТО Филиала «Башнефть» «Башнефть-Новойл»", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"Филиал №5 Ясиновский коксохимический завод ООО «ЮГМК»", tender_title:"ТО Химводоочистка. Чистка теплообменника", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"АКЦИОНЕРНОЕ ОБЩЕСТВО \"МОСВОДОКАНАЛ\"", tender_title:"Выполнение работ по частичному ремонту резервуаров питьевой воды (РПВ)", pm_login:"archive", tender_status:"Клиент отказался", tender_price:21718075.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСВЕННОСТЬЮ \"СТАВРОПОЛЬНЕФТЕГАЗ\"", tender_title:"Выполнение работ по чистке, вывозу и утилизации донных отложений РВС-4 (V-2000м3) РЕЗЕРВУАР 2000М3, инв. № 20805 на УПСВ Прасковейский", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"АО \"ТГК-16\"", tender_title:"Оказание услуги по очистке резервуара хранения мазута №4 от донных отложений с последующей утилизацией или обезвреживанием образовавшегося шлама очистки емкостей и трубопроводов от нефти и нефтепродуктов филиала АО \"ТГК-16\" - \"Нижнекамская ТЭЦ (ПТК-1)\" с доставкой отходов до места утилизации или обезвреживания", pm_login:"archive", tender_status:"Другое", tender_price:55338771.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-09", year:2025, customer_name:"АО «Апатит»", tender_title:"Гидродинамическая (гидроструйная) очистка теплообменного оборудования АО Апатит", pm_login:"archive", tender_status:"Другое", tender_price:43998373.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-09", year:2025, customer_name:"ООО «НЗМП»", tender_title:"Химическая чистка теплообменного и емкостного оборудования от отложений в цехе № 23 ООО «НЗМП", pm_login:"archive", tender_status:"Другое", tender_price:200195840.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-09", year:2025, customer_name:"ГРУППА КОМПАНИЙ РУСАГРО; ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ \"ГРУППА КОМПАНИЙ \"РУСАГРО\"", tender_title:"Очистка поверхности нагрева подогревателей. Заказчик: ООО \"Ника сахарный завод\" Работа по типовому договору Русагро 100% постоплата с отсрочкой платежа - 45 к/д Предоставление КП обязательное условие Работы согласно ТЗ, ВОР, ЛСР", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"Петрозаводский филиал Акционерного общества \"Инжиниринговая компания \"АЭМ-технологии\"", tender_title:"Выполнение работ по травлению и пассивации внутренних поверхностей емкостей из нержавеющей стали", pm_login:"archive", tender_status:"Другое", tender_price:7490000.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-09", year:2025, customer_name:"ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТ­СТВЕН­НОС­ТЬЮ \"ГСП Ремонт\"", tender_title:"Выполнение работ по по техническому обслуживанию и текущему ремонту запорно-регулирующей арматуры, сосудов и аппаратов, емкостного, теплообменного оборудования (Краснодарского УПХГ) для нужд ООО \"Газпром ПХГ\" в 2026 году", pm_login:"archive", tender_status:"Клиент отказался", tender_price:18665411.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"Филиал Мусоросжигательный завод № 3 - Общество с ограниченной ответственностью «Группа Компаний Современные Экологические Технологии»", tender_title:"Выполнение работ по ремонту теплообменника DAGAVO технологической линии № 1 ОГО для нужд филиала ООО ГК СЭТ МСЗ", pm_login:"archive", tender_status:"Клиент отказался", tender_price:7556666.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"АКЦИОНЕРНОЕ ОБЩЕСТВО \"ТОМСКНЕФТЕПРОДУКТ\" ВОСТОЧНОЙ НЕФТЯНОЙ КОМПАНИИ", tender_title:"Оказание услуг по зачистке/мойке, калибровке и техническому диагностированию РГС на КАЗС", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"АО «СЛПК»", tender_title:"25001020 - Очистка поверхностей нагрева КК-6у в период ежегодного останова 2026", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"АО \"Рязанская нефтеперабатывающая компания\"", tender_title:"Выполнение работ по очистке котлов вагон цистерн от мазутных отложений.", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"АКЦИОНЕРНОЕ ОБЩЕСТВО \"МЕЖДУНАРОДНЫЙ АЭРОПОРТ СОЧИ\"", tender_title:"Выполнение работ по очистке и дезинфекции систем вентиляции, отопления и кондиционирования воздуха, включая приточные и вытяжные диффузоры Аэровокзального комплекса", pm_login:"archive", tender_status:"Клиент отказался", tender_price:7730000.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ ГСП Ремонт", tender_title:"Выполнение работ по техническому обслуживанию и текущему ремонту оборудования переработки (зачистка поверхности металла технологического оборудования для проведения неразрушающего контроля)", pm_login:"archive", tender_status:"Клиент отказался", tender_price:141162996.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ ГСП Ремонт", tender_title:"Выполнение работ по текущему ремонту оборудования переработки (зачистка, подготовка к ЭПБ) для нужд Оренбургского гелиевого завода ООО Газпром переработка в 2026 году", pm_login:"archive", tender_status:"Клиент отказался", tender_price:9838735.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ \"БАШКИРСКАЯ ГЕНЕРИРУЮЩАЯ КОМПАНИЯ\"", tender_title:"Зачистка под контроль металла оборудования для Уфимской ТЭЦ-3 филиала ООО БГК", pm_login:"archive", tender_status:"Клиент отказался", tender_price:9275263.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"АО фирма «Агрокомплекс» им. Н.И.Ткачева", tender_title:"Очистка поверхности выпарной станции (АО Кореновсксахар ; ООО Павловский Сахарный Завод )", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"ООО \"Совместная Компания \"РУСВЬЕТПЕТРО\"", tender_title:"№ВЗП-250915/50 \"Реконструкция (восстановление) теплоизоляционного слоя трубопроводов на объектах ЦДНГ\"", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"Филиал ИСО в г.Красноярск", tender_title:"Текущий ремонт тепловой изоляции трубопроводов и оборудования ДпПАМ, ДпОП, ЭЦ АО \"РУСАЛ Красноярск\" в 2026г. (id1090925)", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ \"ГСП Ремонт\"", tender_title:"Выполнение работ по капитальному ремонту теплообменного оборудования объектов Астраханского газоперерабатывающего завода филиала ООО «Газпром переработка» в 2026 году", pm_login:"archive", tender_status:"Клиент отказался", tender_price:843087230.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"Акционерное Общество \"Тюменнефтегаз\"", tender_title:"ТНГ-25-ОГМ-НЗ-6 «Оказание услуг по восстановлению герметичности аппаратов теплообменных пластинчатых»", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"КОРДИАНТ; АКЦИОНЕРНОЕ ОБЩЕСТВО \"КОРДИАНТ\"", tender_title:"Химическая очистка от отложений наружных поверхностей жаровых и дымогарных труб двух паровых котлов марки Astebo тип THSD-I 110/100 E (котельная, зд. №7)", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-09", year:2025, customer_name:"ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ \"ГСП Ремонт\"", tender_title:"Выполнение работ по очистке от твердых отложений технологического оборудования для нужд Астраханского ГПЗ филиала ООО Газпром переработка в 2026 году", pm_login:"archive", tender_status:"Клиент отказался", tender_price:13079698.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"Акционерное общество «Синарская ТЭЦ»", tender_title:"Выполнение работ по очистке резервуара стального вертикального для мазута №2, приемного резервуара для нефтепродуктов", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"ООО УК \"МЕТАЛЛОИНВЕСТ\"", tender_title:"Промывка (обезжиривание) и продувка трубопроводов кислорода и азота перед запуском системы кислородной инжекции (согласно требований ВСН 10-83 Минхимпром)", pm_login:"archive", tender_status:"Другое", tender_price:53584307.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-09", year:2025, customer_name:"ПУБЛИЧНОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО \"ЮНИПРО\"", tender_title:"Работы по расшлаковке и прорезке конвективных поверхностей нагрева на котлах П-67 ст №1, 2, 3 и очистке от золовых отложений батарейных циклонов бл. 1, 2, 3 для нужд филиала Березовская ГРЭС", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"ООО \"ГИПЕРГЛОБУС\"", tender_title:"Замена пропиленгликоля в гипермаркетах (Климовск, Красногорск, Одинцово, Калуга, Коммунарка, Митино)", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-09", year:2025, customer_name:"ПАО \"Орскнефтеоргсинтез\"", tender_title:"Выполнение работ по ремонту градирни", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"АО «Кольская ГМК»", tender_title:"Оказание услуг по зачистке, транспортировке, обезвреживанию/ утилизации отхода «Шлам очистки емкостей и трубопроводов от нефти и нефтепродуктов", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"ООО «Газпром нефть шельф»", tender_title:"Открытый конкурентный отбор на право заключения договора на оказание услуг по ремонту оборудования подачи труб на МЛСП «Приразломная» для нужд ООО «Газпром нефть шельф»", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"ПУБЛИЧНОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО \"ЮНИПРО\"", tender_title:"_ Работы по очистке от золовых отложений теплых ящиков и экранов топок котлов П-67 ст. №1, 2, 3 механическим способом для нужд филиала Березовская ГРЭС", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"АО ТРАНСНЕФТЬ-ВЕРХНЯЯ ВОЛГА", tender_title:"G05-К-Y03-00277-2026 13-РРНУ-ОТСиСТ-2026 Диагностика, техническое обслуживание и ремонт котлов установок ППУА 1600/100 (химическая очистка) Рязанского РНУ", pm_login:"archive", tender_status:"Клиент отказался", tender_price:1094091.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"Публичное акционерное общество \"Татнефть\" имени В.Д.Шашина", tender_title:"Оказание услуг по промывке систем отопления теплых полов здания мойки автомобилей на Объектах Альметьевского филиала. Промывка системы отопления теплых полов с заполнением гликолевой смесью.", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"Заполярный филиал ПАО «ГМК «Норильский никель", tender_title:"Применение противогололедного материала", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"АО «ГК «Северавтодор»", tender_title:"Выполнение работ по пескоструйной очистке и окраске металлических и железобетонных конструкций мостового сооружения через р. Ампута для Филиала №1 АО «ГК «Северавтодор»", pm_login:"archive", tender_status:"Клиент отказался", tender_price:4216510.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"ООО \"ГСП Ремонт\"", tender_title:"Выполнение работ по капитальному ремонту теплообменного оборудования объектов Астраханского газоперерабатывающего завода филиала ООО «Газпром переработка» в 2026 году", pm_login:"archive", tender_status:"Клиент отказался", tender_price:843087230.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"ОАО \"РЖД\"", tender_title:"Выполнение работ по гидропневматической и химической промывке тепловых энергоустановок на объектах Калининградской дирекции по эксплуатации зданий и сооружений", pm_login:"archive", tender_status:"Клиент отказался", tender_price:1781040.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-09", year:2025, customer_name:"Заполярный филиал ПАО «ГМК «Норильский никель»", tender_title:"Выполнение работ по очистке спаренных титановых теплообменников участка охлаждения газов Медного завода ЗФ", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-08", year:2025, customer_name:"ГОСУДАРСТВЕННОЕ КАЗЕННОЕ УЧРЕЖДЕНИЕ ГОРОДА МОСКВЫ \"ТЕХНИЧЕСКИЙ ЦЕНТР ДЕПАРТАМЕНТА КУЛЬТУРЫ ГОРОДА МОСКВЫ\"", tender_title:"Оказание услуг по замене теплоносителя на основе моноэтиленгликоля в инженерной системе холодоснабжения здания ГБУК г.Москвы «МКЗ «Зарядье»", pm_login:"archive", tender_status:"Другое", tender_price:8899200.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-08", year:2025, customer_name:"Усть-Среднекангэсстрой, АО", tender_title:"право заключения договора по лоту: ОКПД2 43.29.11.120 Выполнение комплекса строительно-монтажных работ по теплоизоляции технологического оборудования, газовоздухопроводов (ГВП), пылепроводов, и технологических общестанционных трубопроводов на наружных эстакадах в рамках реализации проекта «Расширение Партизанской ГРЭС» (Лот № 0455-КС ДОХ-2025-УСГС)", pm_login:"archive", tender_status:"Другое", tender_price:1244067688.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-08", year:2025, customer_name:"Усть-Среднекангэсстрой, АО", tender_title:"Право заключения договора по лоту: ОКПД2 43.29.11.120 Выполнение работ по демонтажу и монтажу тепловой изоляции, в том числе работы по АКЗ на паропроводах котлоагрегатов ст. №8, 9, 10 в рамках реализации проекта «Модернизация паропровода поперечной связи от ПП 75 до ПП 154 и главных паропроводов котлоагрегатов ст. №7, 8, 9, 10 на Владивостокской ТЭЦ-2 общей протяженностью 830 м с присоединением к паропроводу 1 очереди» (Лот № 0440-КС ДОХ-2025-УСГС)", pm_login:"archive", tender_status:"Другое", tender_price:119196852.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-08", year:2025, customer_name:"АКЦИОНЕРНОЕ ОБЩЕСТВО \"САМОТЛОРНЕФТЕГАЗ\"", tender_title:"Выполнениекомплекса работ по очистке шламонакопителей, транспортированию,обезвреживанию/утилизации нефтешламов на объекте Варынгского лицензионногоучастка", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-08", year:2025, customer_name:"Эйч ЭНД ЭН, АО", tender_title:"Оказание услуг по проведению химической промывки паровых котлов Bosch МК Липецкий АО«Эйч энд Эн»", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-08", year:2025, customer_name:"ООО \"СТД \"ПЕТРОВИЧ\"", tender_title:"Оказание услуг по техническому обслуживанию оборудования, сооружений и инженерных сетей системы наружной канализации на объектах Заказчика", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-08", year:2025, customer_name:"ООО \"НПО \"Центротех\"", tender_title:"Право заключения договора на оказание услуги по техническому обслуживанию, текущему ремонту инженерных сетей и систем, общеинженерного оборудования зданий и сооружений ООО «НПО «Центротех»", pm_login:"archive", tender_status:"Другое", tender_price:476438133.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-08", year:2025, customer_name:"ОАО \"УЭХК\"", tender_title:"Техническое обслуживание и ремонт оборудования, инженерных сетей, систем, коммуникаций зданий и сооружений участка 20, отдела 16, а также в помещениях отдела 16, находящихся в подразделениях АО «УЭХК»", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-08", year:2025, customer_name:"ФГБОУВО «РГУП им. В.М. Лебедева»", tender_title:"Оказание услуг по обслуживанию инженерных систем здания ФГБОУВО «РГУП им. В.М. Лебедева», расположенного по адресу: г. Москва, ул. Малая Набережная, д. 25/11 в 2025-2026 гг.", pm_login:"archive", tender_status:"Клиент отказался", tender_price:5066250.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-08", year:2025, customer_name:"ООО \"Газпромнефть-КС\"", tender_title:"Открытый отбор организации, способной оказать услуги по комплексному эксплуатационно-техническому обслуживанию инженерных систем зданий (электроосвещение, столярно-плотницкие работы, обслуживание электроприборов, санитарно-технических систем, систем вентиляции, отопления, водоотведения, систем кондиционирования) ООО \"Газпромнефть-КС\" (блочно-модульное здание, планшет №42)", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-08", year:2025, customer_name:"ГОСУДАРСТВЕННОЕ БЮДЖЕТНОЕ УЧРЕЖДЕНИЕ КУЛЬТУРЫ ГОРОДА МОСКВЫ \"МОСКОВСКИЙ ДРАМАТИЧЕСКИЙ ТЕАТР ИМ. М.Н. ЕРМОЛОВОЙ\"", tender_title:"Техническое обслуживание индивидуального теплового пункта (ИТП) и оказание услуг по подготовке ИТП и системы отопления здания к отопительному сезону 2026-2027 г. с получением акта готовности к отопительному сезону в ПАО \"МОЭК\"", pm_login:"archive", tender_status:"Клиент отказался", tender_price:1765256.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-08", year:2025, customer_name:"ГОСУДАРСТВЕННОЕ АВТОНОМНОЕ УЧРЕЖДЕНИЕ РЕСПУБЛИКИ САХА (ЯКУТИЯ) \"КУЛЬТУРНЫЙ КЛАСТЕР \"АРКТИЧЕСКИЙ ЦЕНТР ЭПОСА И ИСКУССТВ\"", tender_title:"Выполнение плановых ремонтных работ в целях подготовки к отопительному сезону", pm_login:"archive", tender_status:"Клиент отказался", tender_price:4805000.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-08", year:2025, customer_name:"ПАО «НК «Роснефть»", tender_title:"Оказание услуг по обработке (промывке) с химическим реагентом поверхностных конденсаторов нефтяных и водяных паров Т-35/1, Т-35/2, Т-35/3, газов разложения колонны К-10, трехступенчатых пароэжекторных вакуумных насосов ЭЖ-1, ЭЖ-2 комплекса ЭЛОУ-АВТ-6млн. (АВТ-11) цеха №29, теплообменников Е-417, Е-413/А,В, контура от сепаратор V-301 до компрессоров С-301/А,В установки каталитического риформинга (CCR) цеха №24", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-08", year:2025, customer_name:"УФПС Рязанской области", tender_title:"Выполнение работ по проверке и приведению в рабочее состояние дымоходов и вентиляционных каналов от газовых котлов в отделениях почтовой связи для нужд УФПС Рязанской области", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-08", year:2025, customer_name:"ООО \"СЛАВЯНСК ЭКО\"", tender_title:"Выбор подрядной организации на оказание услуг по очистке гидромеханическим способом внутренней части шлемового трубопровода колонны К-1, колонны К-2, технологической установки АТ-5.", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-08", year:2025, customer_name:"Петербургтеплоэнерго, ООО", tender_title:"МИ №4500/МИ (311/78/2026) - Выполнение работ по ремонту тепловой изоляции внутренних и наружных трубопроводов в Санкт-Петербурге и Ленинградской области для нужд ООО «Петербургтеплоэнерго»", pm_login:"archive", tender_status:"Клиент отказался", tender_price:7496057.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-08", year:2025, customer_name:"Славянск ЭКО, ООО", tender_title:"Выбор подрядной организации на оказание услуг по очистке гидромеханическим способом внутренней части шлемового трубопровода колонны К-1, колонны К-2, технологической установки АТ-5, для ООО \"Славянск ЭКО\". Оказание услуг очистке гидромеханическим способом внутренней части шлемового трубопровода колонны К-1, колонны К-2, технологической установки АТ-5.", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-08", year:2025, customer_name:"АО \"ГРУППА \"ИЛИМ\"", tender_title:"Химическая промывка внутренних поверхностей нагрева котлоагрегатов ТЭЦ ПЛ Энергетика в г.Коряжма.", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-08", year:2025, customer_name:"ООО \"СИНЕРГИЯ\"", tender_title:"Очистка наружной поверхности труб пароперегревателя котла КЕ-25-3, 9-440-1", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-08", year:2025, customer_name:"Усть-Среднекангэсстрой, АО", tender_title:"Право заключения договора по лоту: «ОКПД2 43.29.11.120 Выполнение комплекса строительно-монтажных работ по теплоизоляции парового котла E-530-13,8-560KT энергоблока №4 и №5 в рамках реализации проекта «Расширение Партизанской ГРЭС»» (Лот № 0385-КС ДОХ-2025-УСГС)", pm_login:"archive", tender_status:"Другое", tender_price:395425573.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-08", year:2025, customer_name:"ГОСУДАРСТВЕННОЕ БЮДЖЕТНОЕ УЧРЕЖДЕНИЕ КУЛЬТУРЫ ГОРОДА МОСКВЫ \"МОСКОВСКИЙ ТЕАТР \"НОВАЯ ОПЕРА\" ИМЕНИ Е.В.КОЛОБОВА\"", tender_title:"Оказание услуг по очистке механизированным способом при помощи щеточной и пылеулавливающей машины и дезинфекцией поверхностей существующих вентиляционных установок, воздуховодов системы вентиляции и кондиционирования воздуха в здании ГБУК МТ \"Новая Опера\" им. Е. В. Колобова, расположенного по адресу: г. Москва ул. Каретный Ряд д. 3 стр. 2", pm_login:"archive", tender_status:"Клиент отказался", tender_price:2798934.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-08", year:2025, customer_name:"АКЦИОНЕРНОЕ ОБЩЕСТВО \"ЦЕНТР ХРАНЕНИЯ ДАННЫХ\"", tender_title:"Оказание услуг по диагностике компрессора и кожухотрубного теплообменника холодильной машины.", pm_login:"archive", tender_status:"Клиент отказался", tender_price:6504800.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-08", year:2025, customer_name:"ФГБУ \"НМХЦ ИМ. Н.И. ПИРОГОВА\" МИНЗДРАВА РОССИИ", tender_title:"Ремонтно-восстановительные работы теплообменника ЦТП по адресу: г. Москва, ул. Нижняя Первомайска, д. 65, стр.2 для нужд ФГБУ «НМХЦ им. Н.И. Пирогова» Минздрава России", pm_login:"archive", tender_status:"Клиент отказался", tender_price:5127500.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-08", year:2025, customer_name:"АО \"Татнефть\" им. В.Д.Шашина", tender_title:"Выполнение работ по промывке межтрубного пространства кожухотрубных теплообменных аппаратов ООО «Тольяттикаучук»", pm_login:"archive", tender_status:"Другое", tender_price:12572927.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-08", year:2025, customer_name:"ПАО \"САРАТОВСКИЙ НПЗ\"", tender_title:"Оказание услуг по промывке пластинчатого теплообменного аппарата пакинокс тех.поз. «Т-6N» Производства №2 ПАО «Саратовский НПЗ» с применением химических реагентов.", pm_login:"archive", tender_status:"Другое", tender_price:25957800.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-08", year:2025, customer_name:"ПАО \"Т Плюс\" (Сакмарская ТЭЦ)", tender_title:"Чистка теплообменного оборудования для филиала \"Оренбургский\" ПАО \"Т Плюс\" (Сакмарская ТЭЦ)", pm_login:"archive", tender_status:"Другое", tender_price:3000000.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-08", year:2025, customer_name:"АО «Самаранефтегаз»", tender_title:"Зачистка нефтепромыслового оборудования", pm_login:"archive", tender_status:"Клиент отказался", tender_price:99741502.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-08", year:2025, customer_name:"КЧХК АО ОХК УРАЛХИМ В Г. К-ЧЕПЕЦКЕ, ФЛ", tender_title:"Выполнение работ по очистке от осадка резервуара №2 осветленной воды V=6000 куб.м участка №67 ООО «ЭСО КЧХК_3 кв.2025»", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-08", year:2025, customer_name:"АО \"СМЗ\"", tender_title:"СМЦБ-042576 Цех №28. Зачистка, промывка емкости 75 м3 (корпус 112)", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-08", year:2025, customer_name:"АО «Газпромнефть-МНПЗ»", tender_title:"Открытый конкурентный отбор Организации, способной Выполнить работы по техническому обслуживанию сетей канализации и ёмкостного оборудования", pm_login:"archive", tender_status:"Клиент отказался", tender_price:339284807.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-08", year:2025, customer_name:"НЗЛ, АО", tender_title:"Химическая пассивация для нужд АО \"НЗЛ\"", pm_login:"archive", tender_status:"Клиент отказался", tender_price:50186400.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-08", year:2025, customer_name:"ООО \"СЛАВЯНСК ЭКО\"", tender_title:"Выбор подрядной организации на оказание услуг по очистке гидромеханическим способом внутренней части шлемового трубопровода колонны К-1, колонны К-2, технологической установки АТ-5, для ООО \"Славянск ЭКО\".", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-08", year:2025, customer_name:"ООО \"АРЧА\"", tender_title:"Услуга промывки теплообменников газовых котлов", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-08", year:2025, customer_name:"АКЦИОНЕРНОЕ ОБЩЕСТВО \"РЯЗАНЬНЕФТЕПРОДУКТ\"", tender_title:"Выполнение работ по ремонту и техническому обслуживанию дизельных котлов, тепловоздушного агрегата, газовых котлов.", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-08", year:2025, customer_name:"ООО «Газпромнефть-Оренбург»", tender_title:"Открытый двухэтапный конкурентный отбор на право заключения договора на оказание услуг по ремонту теплообменных устройств ВУ ОНГКМ ООО «Газпромнефть-Оренбург» в 2026-2027 гг.", pm_login:"archive", tender_status:"Клиент отказался", tender_price:12696750.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-04", year:2025, customer_name:"ГОСУДАРСТВЕННОЕ КАЗЕННОЕ УЧРЕЖДЕНИЕ ГОРОДА МОСКВЫ \"ТЕХНИЧЕСКИЙ ЦЕНТР ДЕПАРТАМЕНТА КУЛЬТУРЫ ГОРОДА МОСКВЫ\"", tender_title:"Оказание услуг по замене теплоносителя на основе моноэтиленгликоля в инженерной системе холодоснабжения здания ГБУК г.Москвы «МКЗ «Зарядье»", pm_login:"archive", tender_status:"Другое", tender_price:8899200.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-04", year:2025, customer_name:"АО \"Минудобрения\"", tender_title:"Выполнение чистки теплообменного оборудования цехов АМ-1, АС, АК агр.1,2 в 2025г", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-03", year:2025, customer_name:"ООО \"Газпром нефть шельф\"", tender_title:"01-3003920-344-2025_Открытый конкурентный отбор на право заключения на оказание услуг по очистке емкостного парка бурового комплекса МЛСП «Приразломная» для нужд ООО «Газпром нефть шельф»", pm_login:"archive", tender_status:"Другое", tender_price:230533149.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-03", year:2025, customer_name:"ООО \"Газпром нефть шельф\"", tender_title:"01-3003921-344-2025_Оказание услуг по техническому освидетельствованию и ремонту технологических трубопроводов систем бурового комплекса МЛСП «Приразломная» для нужд ООО «Газпром нефть шельф»", pm_login:"archive", tender_status:"Другое", tender_price:227161724.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-03", year:2025, customer_name:"АО \"ТОАЗ\"", tender_title:"Лот №029150 Проведение предпусковой химической промывки оборудования.2025г", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-03", year:2025, customer_name:"НЕФТЕХИМ САЛАВАТ", tender_title:"Проведение работ по химической промывке и пассивации внутренних поверхностей котла-утилизатора поз. 112 цех № 54 ГХЗ", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-03", year:2025, customer_name:"узбекистан", tender_title:"Работы про АВО", pm_login:"archive", tender_status:"Другое", tender_price:38000000.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-03", year:2025, customer_name:"АО ВАРЗ-400", tender_title:"Промывка ТО", pm_login:"archive", tender_status:"Другое", tender_price:2388000.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-03", year:2025, customer_name:"Амурский ГХК", tender_title:"Выполнение работ по гидроструйной чистке аппаратов ООО «Амурский ГХК» в 2026 - 2029 г. (2103472/1)", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-02", year:2025, customer_name:"АО \"Лебединский ГОК\"", tender_title:"Демонтаж аварийных и выведенных из эксплуатации резервуаров хранения нефтепродуктов с предварительной зачисткой резервуаров и утилизацией безвозвратных потерь нефтепродуктов в подразделениях ЦПП, ДСФ и УЖДТ АО \"Лебединский ГОК».", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-02", year:2025, customer_name:"ООО «НОВАТЭК-ПУРОВСКИЙ ЗПК»", tender_title:"Техническое обслуживание (гидроочистка) аппаратов воздушного охлаждения", pm_login:"archive", tender_status:"Клиент согласился", tender_price:18135168.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-02", year:2025, customer_name:"ООО\"ЕвроХим-БМУ\"", tender_title:"RUBMU-5686 Оказание услуг на выполнение работ по чистке абсорбционных колонн и труб вентури поз.Д510-Д540-Д541-Д550-Д551 цеха СМУ-1 на ООО\"ЕвроХим-БМУ\"", pm_login:"archive", tender_status:"Клиент отказался", tender_price:14100000.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-02", year:2025, customer_name:"ООО \"Запсибтрансгаз\"", tender_title:"№2099298/1 ЗСТГ_Выполнение работ по чистке технологического оборудования на производственных площадках ООО \"Запсибтрансгаз\" в 2025 - 2027гг", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-02", year:2025, customer_name:"ГБУК Г. МОСКВЫ \"МКЗ \"ЗАРЯДЬЕ\"", tender_title:"Замена гликоля в ГБУК Г. МОСКВЫ \"МКЗ\"ЗАРЯДЬЕ\" в объеме 44 м3", pm_login:"archive", tender_status:"Другое", tender_price:9240000.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-02", year:2025, customer_name:"ООО \"РН-ТНПЗ \"", tender_title:"Оказание услуг по промывке реагентами теплообменных аппаратов на установке ЭЛОУ-АВТ-12 ООО \"РН-Туапсинский НПЗ\" в капитальный ремонт 2026 года", pm_login:"archive", tender_status:"Другое", tender_price:88426339.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-02", year:2025, customer_name:"ООО \"Лукойл - Волгограднефтепереработка\"", tender_title:"Выполнение работ по ремонту теплообменного оборудования с применением безразборной химической чистки в 2025 году (Прочие ремонты) на объектах ООО «ЛУКОЙЛ-Волгограднефтепереработка»", pm_login:"archive", tender_status:"Клиент отказался", tender_price:64988970.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-02", year:2025, customer_name:"КЧХК АО ОХК УРАЛХИМ В Г. К-ЧЕПЕЦКЕ, ФЛ", tender_title:"Очистка теплообменного оборудования ц.57_КЧХК_1 кв.2025", pm_login:"archive", tender_status:"Другое", tender_price:23336748.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-02", year:2025, customer_name:"АО \"ГРУППА \"ИЛИМ\"", tender_title:"Запрос предложений № 3944465 Предварительный квалификационный отбор контрагента с целью заключения договора на: выполнение работ по чистке технологического оборудования варочно-отбельного цеха Целлюлозного производства филиала АО \"Группа \"Илим\" в г. Братске.", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-02", year:2025, customer_name:"АО \"СМЗ\"", tender_title:"Запрос предложений № 3944935 СМЦБ-032539 Цех 28, корп. 60Б. Зачистка и промывка резервуара грязевого осадка 20м3", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-02", year:2025, customer_name:"АКЦИОНЕРНОЕ ОБЩЕСТВО \"ОРЕНБУРГНЕФТЬ\"", tender_title:"Оказание услуг по очистке секций аппаратов воздушного охлаждения (АВО) от отложений 2026-2028 г. г. на объектах АО Оренбургнефть", pm_login:"archive", tender_status:"Другое", tender_price:93220500.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-02", year:2025, customer_name:"ОМСКИЙ ЗАВОД ПОЛИПРОПИЛЕНА", tender_title:"Замена кожухотрубных теплообменников Т-4", pm_login:"archive", tender_status:"Другое", tender_price:8047200.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-02", year:2025, customer_name:"ООО \"Газпром нефть шельф\"", tender_title:"01-3003920-344-2025_Открытый конкурентный отбор на право заключения на оказание услуг по очистке емкостного парка бурового комплекса МЛСП «Приразломная» для нужд ООО «Газпром нефть шельф»", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-02", year:2025, customer_name:"ООО \"Газпром нефть шельф\"", tender_title:"01-3003921-344-2025_Оказание услуг по техническому освидетельствованию и ремонту технологических трубопроводов систем бурового комплекса МЛСП «Приразломная» для нужд ООО «Газпром нефть шельф»", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-01", year:2023, customer_name:"ПАО \"Т ПЛЮС\"", tender_title:"Промывка теплообменного оборудования для нужд Сызранские тепловые сети", pm_login:"archive", tender_status:"Клиент отказался", tender_price:1177366.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2023-01", year:2023, customer_name:"АО \"РНПК\"", tender_title:"Выполнение работ по освобождению от расплава соли и чистке емкостей 01-В-170, 02-В-170 установки производства и восстановления серной кислоты (УПВСК) цеха №2.", pm_login:"archive", tender_status:"Другое", tender_price:13705093.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-01", year:2023, customer_name:"АО \"КНПЗ\"", tender_title:"Услуги по химической очистке пластинчатых теплообменников во время ППР-2023г установок цеха №4 (FCC, МТБЭ),цеха №1 (Л-35-11/1000) и цеха №3 (ЭЛОУ-АВТ-3,0 (АВТ-4), ЭЛОУ-АВТ-3,5 (АВТ-5),Висбрекинг)", pm_login:"archive", tender_status:"Другое", tender_price:33272465.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-01", year:2023, customer_name:"АО \"БАШНЕФТЬ\"", tender_title:"Выполнение работ по пропарке оборудования и трубопроводов с применением реагентов на установке ЭЛОУ-АВТ-3 цеха №1 филиала ПАО АНК «Башнефть» «Башнефть-Уфанефтехим»", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2023-01", year:2023, customer_name:"АО \"СНПЗ\"", tender_title:"Химическая обработка вакуумной колонны К-10 и ее контуров установки ЭЛОУ-АВТ-6 при подготовке к ремонтным работам", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2023-01", year:2023, customer_name:"ООО «ЛУКОЙЛ-Волгограднефтепереработка»", tender_title:"Ремонт теплообменного оборудования с применением безразборной химической чистки в 2023 г. (ремонт оборудования, прочие ремонты).", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2023-01", year:2023, customer_name:"АО \"СНПЗ\"", tender_title:"Диагностика теплообменника ТВН-30/5 установки ААж-0,65", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2023-01", year:2023, customer_name:"\"Транснефть-Приволга\"", tender_title:"0001-207-К-Y03-03330-2023 «41-ТПВ/РЭН/1-05.2023 Применение ингибитора при проведении ВТД, участков осложненных парафиноотложениями»", pm_login:"archive", tender_status:"Клиент отказался", tender_price:61294257.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2023-01", year:2023, customer_name:"ООО \"Русагро-Центр\"", tender_title:"Химическая очистка поверхности нагрева пластинчатых подогревателей сахарного завода ООО «Русагро-Тамбов» - Филиал «Никифоровский»", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-02", year:2023, customer_name:"ООО \"Газпром нефть шельф\"", tender_title:"Лот №5855-0004833-2023: Оказание услуг по демонтажу/монтажу и перемещению труднодоступной запорно – регулирующей арматуры МЛСП «Приразломная» для нужд ООО «Газпром нефть шельф»", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-02", year:2023, customer_name:"ООО \"МЕЧЕЛ-ЭНЕРГО\"", tender_title:"Выполнение РЕМОНТА КОТЛОВ согласно ТЗ для нужд котельного участка ЧФ ООО «МЕЧЕЛ-ЭНЕРГО» в г. Чебаркуль", pm_login:"archive", tender_status:"Другое", tender_price:2953702.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-02", year:2023, customer_name:"АО \"Международный аэропорт \"Саранск\"", tender_title:"Оказание услуг по техническому обслуживанию оборудования котельных", pm_login:"archive", tender_status:"Другое", tender_price:1020000.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-02", year:2023, customer_name:"АО \"Жировой комбинат\"", tender_title:"Сервисное обслуживание станции очистки воды майонезного цеха на площадке ООО \"Русагро-Аткарск\"", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-02", year:2023, customer_name:"ПАО \"СЛАВНЕФТЬ-ЯРОСЛАВНЕФТЕОРГСИНТЕЗ\"", tender_title:"Химическая промывка внутренних поверхностей нагрева парогенерирующего оборудования методом щелочения", pm_login:"archive", tender_status:"Клиент отказался", tender_price:25939584.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2023-02", year:2023, customer_name:"ООО \"Газпром нефть шельф\"", tender_title:"Разработка технического решения по замене горелочного устройства огневого подогревателя Z44010 МЛСП «Приразломная»", pm_login:"archive", tender_status:"Другое", tender_price:26668461.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-02", year:2023, customer_name:"ООО \"Газпром нефть шельф\"", tender_title:"Оказание услуг по замене фильтра-скруббера тонкой очистки Z-49002А МЛСП \"Приразломная\"", pm_login:"archive", tender_status:"Другое", tender_price:21843838.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-02", year:2023, customer_name:"АО \"РНПК\"", tender_title:"Выполнение работ по очистке кислотных холодильников во время текущей эксплуата-ции установок серной кислоты (СКУ, УПВСК) цеха №2 по вторичным процессам в 2023г", pm_login:"archive", tender_status:"Другое", tender_price:8652000.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-02", year:2023, customer_name:"ПАО \"ЧМК\"", tender_title:"Оказание услуг по химической промывке трубопроводов контура ЗВО МНЛЗ-5 ККЦ", pm_login:"archive", tender_status:"Клиент отказался", tender_price:8315674.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2023-02", year:2023, customer_name:"ПАО \"Распадская\"", tender_title:"Оказание услуг по техническому обслуживанию (очистка, промывка) теплообменного оборудования бойлерных и калориферных установок системы теплоснабжения ПАО «Распадская»", pm_login:"archive", tender_status:"Клиент отказался", tender_price:8784000.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2023-02", year:2023, customer_name:"ОАО \"Жировой комбинат\"", tender_title:"Услуги по очистке пластинчатых и кожухотрубных теплообменников в производственных участках (пгт Безенчук)", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-02", year:2023, customer_name:"ООО УК \"МЕТАЛЛОИНВЕСТ\"", tender_title:"Закупка услуг по очистке внутренних поверхностей трубных пучков теплообменного энергетического оборудования от всех типов отложений в котельной и озонаторной станции ОЗК \"Лесная сказка\" АО \"Лебединский ГОК\" в 2023 году.", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-02", year:2023, customer_name:"СибурТюменьГаз", tender_title:"Выполнение работ по химической чистке УС-2/Т-1 ВГПЗ", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-01", year:2025, customer_name:"ПАО «Саратовский НПЗ»", tender_title:"Оказание услуг по промывке пластинчатых теплообменных аппаратов Производства №1,2 ПАО «Саратовский НПЗ» с применением химических реагентов.", pm_login:"archive", tender_status:"Другое", tender_price:49053660.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-01", year:2025, customer_name:"\"НОВАТЭК-УСТЬ-ЛУГА\"", tender_title:"Выполнение работ по очистке аппаратов воздушного охлаждения, теплообменных аппаратов и вспомогательного оборудования на обьектах Комплекса", pm_login:"archive", tender_status:"Клиент отказался", tender_price:35396600.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-01", year:2025, customer_name:"ООО \"Газпром нефть шельф\"", tender_title:"Оказание услуг по очистке емкостного парка бурового комплекса МЛСП «Приразломная»", pm_login:"archive", tender_status:"Другое", tender_price:229832552.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-01", year:2025, customer_name:"ООО \"Газпром нефть шельф\"", tender_title:"01-3006460-344-2024 Открытый конкурентный отбор на оказание услуг по разборной чистке и ремонту пластинчатых теплообменных аппаратов МЛСП «Приразломная»", pm_login:"archive", tender_status:"Другое", tender_price:137196577.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-01", year:2025, customer_name:"ООО \"Газпром нефть шельф\"", tender_title:"Оказание услуг по техническому освидетельствованию и ремонту технологических трубопроводов систем бурового комплекса МЛСП «Приразломная»", pm_login:"archive", tender_status:"Другое", tender_price:174124024.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-01", year:2025, customer_name:"ООО \"ВОЛЖСКАЯ ПЕРЕКИСЬ\"", tender_title:"Проведение пассивации оборудования на территории площадки производства перекиси (танк-контейнеры)", pm_login:"archive", tender_status:"Клиент согласился", tender_price:1780000.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-01", year:2025, customer_name:"ООО «НПП «Нефтехимия»", tender_title:"СМР. Выполнение работ по ремонту, монтажу трубопроводов, арматуры, оборудования и сосудов с применением электросварки на промышленной площадке комплекса производства полипропилена ООО «НПП «Нефтехимия»", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-01", year:2025, customer_name:"Филиала \"Шатурская ГРЭС\" ПАО \"Юнипро\"", tender_title:"Анализ рынка на выполнение работ по очистке от отложений трубного пространства подогревателей КТЦ для нужд Филиала \"Шатурская ГРЭС\" ПАО \"Юнипро\"", pm_login:"archive", tender_status:"Другое", tender_price:6622560.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-01", year:2025, customer_name:"АО «Газпромнефть-ОНПЗ»", tender_title:"Выполнение работ по гидромеханической/гидроструйной чистке оборудования на объектах АО «Газпромнефть-ОНПЗ» в 2025 году", pm_login:"archive", tender_status:"Клиент отказался", tender_price:35167032.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-01", year:2025, customer_name:"ЗАКРЫТОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО \"ФАРМФИРМА \"СОТЕКС\"", tender_title:"Выполнение работ по очистке контура воды теплообменников испарителей холодильных машин Carrier 30 HXA206-960KA и 30HXC140-A0235-PEE", pm_login:"archive", tender_status:"Клиент отказался", tender_price:840000.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-01", year:2025, customer_name:"ООО \"ПОЛИОМ\"", tender_title:"Гидродинамическая очистка теплообменного оборудования, сосудов и трубопроводов ООО \"Полиом\" в период остановочного ремонта", pm_login:"archive", tender_status:"Другое", tender_price:16298329.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-01", year:2025, customer_name:"ПАО «КуйбышевАзот»", tender_title:"Чистка трубных пучков теплообменников, аппаратов и линий от отложений с применением насоса высокого давления согласно графика", pm_login:"archive", tender_status:"Клиент отказался", tender_price:24000000.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-01", year:2025, customer_name:"ПАО \"Нижнекамскнефтехим\"", tender_title:"Бюджетная оценка. Выполнение работ по пассивации (пескоструйной чистке, травлению) барботажных пластин реакторов олигомеризации производства 8705 завода ОС", pm_login:"archive", tender_status:"Другое", tender_price:29450246.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-01", year:2025, customer_name:"КАО \"Азот\"", tender_title:"Химическая промывка конденсатора охладителя поз. Е-1602 цеха №15", pm_login:"archive", tender_status:"Другое", tender_price:10617600.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-01", year:2025, customer_name:"Акционерное общество \"Апатит\"", tender_title:"Очистка теплообменника СКП, трубного пространства ВВУ 1-6 (2 ЛОТА)", pm_login:"archive", tender_status:"Другое", tender_price:74295000.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-01", year:2025, customer_name:"АО \"ОЭМК ИМ. А.А. УГАРОВА\"", tender_title:"Очистка аппаратов воздушного охлаждения (ЭСПЦ), очистка аппаратов воздушного охлаждения (СПЦ-1), Очистка теплообменника ПСВ №1 (ТСЦ) для АО «ОЭМК им А.А. Угарова» в 2025г.", pm_login:"archive", tender_status:"Другое", tender_price:30664380.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-01", year:2025, customer_name:"АО «РУСАЛ Новокузнецк»", tender_title:"Предоставление услуг по промывке теплообменного оборудования АО «РУСАЛ Новокузнецк» в 2025 году. (id994126)", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-01", year:2025, customer_name:"Орскнефтеоргсинтез", tender_title:"Выполнение работ по гидроструйной очистке теплообменного оборудования на технологической установке ЛЧ-24-2000-86 производства №2 ПАО Орскнефтеоргсинтез в 2025г.", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-01", year:2025, customer_name:"ООО \"ММСК\"", tender_title:"\"Очистка нагорной канавы - ручья прудков металлургического цеха (инв. № 9808).\"", pm_login:"archive", tender_status:"Клиент отказался", tender_price:11442690.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-01", year:2025, customer_name:"ООО \"ЕВРОХИМ СЕВЕРО-ЗАПАД-2\"", tender_title:"NW2-0AUP-584 Оказание услуг в проведении работ по химической промывке системы пара высокого давления", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-01", year:2025, customer_name:"АО «Газпромнефть – МНПЗ»", tender_title:"Открытый конкурентный отбор Организации, способной Выполнить работы по реагентной подготовке оборудования к сдаче в ремонт на установке АТ-ВБ, Производства №1 АО «Газпромнефть – МНПЗ» в 2025 году", pm_login:"archive", tender_status:"Клиент отказался", tender_price:9138000.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-01", year:2025, customer_name:"ПАО «Распадская»", tender_title:"№942712 Оказание услуг по техническому обслуживанию (очистка, промывка) теплообменного оборудования бойлерных и калориферных установок системы теплоснабжения ПАО «Распадская»", pm_login:"archive", tender_status:"Клиент отказался", tender_price:15017520.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-01", year:2025, customer_name:"АО «Апатит»", tender_title:"Зачистка емкостей от нефтешлама ЦРС", pm_login:"archive", tender_status:"Клиент отказался", tender_price:47460000.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-01", year:2025, customer_name:"ООО «ЛУКОЙЛ-Пермнефтеоргсинтез\"", tender_title:"Чистка наружной поверхности секций аппаратов воздушного охлаждения (АВО) на технологических объектах ООО «ЛУКОЙЛ-Пермнефтеоргсинтез» в 2025 год", pm_login:"archive", tender_status:"Клиент отказался", tender_price:82594200.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-01", year:2025, customer_name:"ООО «ЛУКОЙЛ – Западная Сибирь»", tender_title:"Оказание услуг по зачистке резервуаров и оборудования на территориально-производственных предприятиях ООО «ЛУКОЙЛ-Западная Сибирь» в 2025-2027 гг.: Лот № 1 - Оказание услуг по зачистке резервуаров от нефтешлама для ТПП «Лангепаснефтегаз» ООО «ЛУКОЙЛ-Западная Сибирь» в 2025 году; Лот № 2 - Оказание услуг по зачистке резервуаров от нефтешлама для ТПП «Покачевнефтегаз» ООО «ЛУКОЙЛ - Западная Сибирь» в 2025-2027 гг.; Лот № 3 - Оказание услуг по зачистке оборудования УППНГ от нефтешлама для ТПП «Лангепаснефтегаз» ООО «ЛУКОЙЛ-Западная Сибирь» в 2025 году.", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-01", year:2025, customer_name:"ООО «ЛУКОЙЛ-ПЕРМЬ»", tender_title:"Оказание услуг по техническому сервису нагревателей нефти, теплообменных аппаратов и вспомогательного оборудования ООО «ЛУКОЙЛ-ПЕРМЬ» (Пермский регион) в 2025-2028 годах", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-01", year:2025, customer_name:"ЗАО \"ВШЗ\"", tender_title:"Замена насосов отопления и насосов возврата конденсата в корпусе 2 (ЦТП-1) ЗАО \"ВШЗ\"", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2025-01", year:2025, customer_name:"ООО «ЕвроХим-ВолгаКалий»", tender_title:"Выполнение работ по ремонту и замене изношенных участков технологических трубопроводов и технологического оборудования сильвинитовой обогатительной фабрики Гремячинского ГОКа в Котельниковском районе Волгоградской области.", pm_login:"archive", tender_status:"Другое", tender_price:909206193.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2025-01", year:2025, customer_name:"Фонд «Сколково»", tender_title:"Выполнение работ по очистке кожухотрубного теплообменника (конденсатора, испарителя) и проведения вихретоковой диагностики конденсатора и испарителя на холодильных машинах №1-4 YORK YKIFKSH95CQG (4 шт. ) Центра холодоснабжения", pm_login:"archive", tender_status:"Другое", tender_price:10000000.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-03", year:2023, customer_name:"ООО \"Газпром нефть шельф\"", tender_title:"Открытый конкурентый отбор на право заключения договора на выполнение работ по разработке технического решения по замене горелочного устройства огневого подогревателя Z44010 МЛСП «Приразломная» для нужд ООО «Газпром нефть шельф»", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-03", year:2023, customer_name:"МНПЗ, Москва", tender_title:"Открытый конкурентный отбор Организации, способной выполнить работы по реагентной подготовке оборудования к сдаче в ремонт в 2023г. (2 лота)", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2023-03", year:2023, customer_name:"Ленинградская область, Кингисепский район, п. Усть-Луга", tender_title:"Выполнение работ по чистке аппаратов воздушного охлаждения от отложений на объекте Заказчика", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-03", year:2023, customer_name:"ООО «Газпромнефть-Хантос»", tender_title:"Открытый двухэтапный конкурентный отбор в электронной форме на право заключения договора на выполнение работ по гидромеханической чистке оборудования для нужд ООО «Газпромнефть-Хантос» в 2023- 2025 годах.", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2023-03", year:2023, customer_name:"ГБУ г Москвы по эксплуатации высотных административных и жилых домов", tender_title:"Оказание услуг по химико-технологической промывке теплообменников холодильных машин YORK холодильного центра, по адресу: г. Москва, Новый Арбат ул. , д. 17, стр. 2", pm_login:"archive", tender_status:"Клиент отказался", tender_price:999490.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2023-03", year:2023, customer_name:"ООО «ЛУКОЙЛ-Волгограднефтепереработка\"", tender_title:"Выполнение работ по ремонту теплообменника 111-Т4 КТУ ГПВГ ООО \"ЛУКОЙЛ-Волгограднефтепереработка\" в 2023 году (прочие ремонты)", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-03", year:2023, customer_name:"ООО «ЛУКОЙЛ-Волгограднефтепереработка\"", tender_title:"Ремонт теплообменного оборудования с применением безразборной химической чистки в 2023 г. (ремонт оборудования, прочие ремонты)", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-03", year:2023, customer_name:"ООО \"Санаторий Металлург\"", tender_title:"Услуги по ремонту теплообменников пластичных в Медицинском центре и сливных лотков в прачечной ООО \"Санаторий \"Металлург \"", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-03", year:2023, customer_name:"АО «Черномортранснефть»", tender_title:"0001-207-К-Y03-03831-2023 «37-ЧТН/РЭН/1-05.2023 Применение ингибитора при проведении ВТД, участков осложненных парафиноотложениями АО «Черномортранснефть»»", pm_login:"archive", tender_status:"Другое", tender_price:55549603.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-03", year:2023, customer_name:"ПАО \"ЧМК\"", tender_title:"Оказание услуг по химической промывке трубопроводов контура ЗВО МНЛЗ-5 ККЦ", pm_login:"archive", tender_status:"Другое", tender_price:8315674.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-03", year:2023, customer_name:"ООО «Газпромнефть-Оренбург»", tender_title:"Лот № 1260-0004097-2023, Оказание услуг по зачистке от шлама нефтепромыслового оборудования объектов подготовки нефти и газа для ООО «Газпромнефть-Оренбург» на 2024-2026 годы", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2023-03", year:2023, customer_name:"ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ ГАЗПРОМ НЕФТЕХИМ САЛАВАТ", tender_title:"Выполнение работ по химической чистке теплообменного оборудования ООО Акрил Салават", pm_login:"archive", tender_status:"Другое", tender_price:1396005.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-03", year:2023, customer_name:"АО \"РНПК\"", tender_title:"ЗАПРОС РАЗЪЯСНЕНИЙ. Выполнение работ по освобождению от расплава соли и чистке емкостей 01-В-170, 02-В-170 установки производства и восстановления серной кислоты (УПВСК) цеха №2.", pm_login:"archive", tender_status:"Другое", tender_price:13705093.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-03", year:2023, customer_name:"ПАО \"ЧМК\"", tender_title:"Оказание услуг по химической промывке трубопроводов контура ЗВО МНЛЗ-5 ККЦ", pm_login:"archive", tender_status:"Другое", tender_price:8110000.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-03", year:2023, customer_name:"АО \"РНПК\"", tender_title:"Выполнение работ по химической очистке пластинчатых теплообменников Compabloc установки ЭЛОУ-АТ-6 с вакуумным блоком ВТ-4 цеха №1 по первичным процессам", pm_login:"archive", tender_status:"Другое", tender_price:115038128.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-03", year:2023, customer_name:"ООО \"Сибур\"", tender_title:"Выполнение работ по чистке технологического оборудования АО «Сибур-Химпром» (4 Лота)", pm_login:"archive", tender_status:"Другое", tender_price:13361124.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-03", year:2023, customer_name:"АО \"КНПЗ\"", tender_title:"Услуги по химической очистке пластинчатых теплообменников во время коммерческого простоя 2024 года установок цеха №4 (FCC, МТБЭ)", pm_login:"archive", tender_status:"Другое", tender_price:44376000.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-03", year:2023, customer_name:"АО \"Апатит\"", tender_title:"Выполнение гидродинамической (гидроструйной) очистки, химической промывки теплообменного оборудования, чистки и промывки резервуаров и емкостей с применением специальной техники в период ОКР ЦПМ, ПСМУ, Ам-2 в 2023 году.", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2023-03", year:2023, customer_name:"АО \"КНПЗ\"", tender_title:"Оказание услуг по пропарке(деконтаминации) оборудования установок АВТ-4, АВТ-5, Висбрекинг, сероочисткигазов 30/4 и трубопроводов сероводородосодержащего газа.", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2023-03", year:2023, customer_name:"АО \"ТАИФ-НК\"", tender_title:"Услуги по гидроструйной чистке технологического оборудования и трубопроводов цеха №06 НПЗ АО «ТАИФ-НК».", pm_login:"archive", tender_status:"Другое", tender_price:9214800.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-03", year:2023, customer_name:"АО «Газпромнефть-МНПЗ»", tender_title:"Выполнение работ по гидроструйной очистке аппаратов воздушного охлаждения, калориферов вентиляционных установок и иных поверхностей на промышленной площадке АО «Газпромнефть – МНПЗ» в 2023, 2024, 2025 году.", pm_login:"archive", tender_status:"Другое", tender_price:105209408.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-03", year:2023, customer_name:"ООО \"Газпром нефть шельф\"", tender_title:"Открытый конкурентный отбор на выполнение ремонта систем бурового комплекса на МЛСП \"Приразломная\"", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-03", year:2023, customer_name:"ООО \"Газпром нефть шельф\"", tender_title:"Открытый конкурентный отбор на право заключения договора на выполнение строительно-монтажных работ по дооборудованию систем вентиляции МЛСП «Приразломная»", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-03", year:2023, customer_name:"АО «ГСИ»", tender_title:"Выполнение работ по химической очистке и промывке минеральным маслом на технологических трубопроводах на объекте \"Установка по производству линейного полиэтилена низкой плотности/полиэтилена высокой плотности (ЛПЭНП/ПЭВП) мощностью 650 тыс. тонн...", pm_login:"archive", tender_status:"Другое", tender_price:29400436.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-03", year:2023, customer_name:"ООО \"РН-ТУАПСИНСКИЙ НЕФТЕПЕРЕРАБАТЫВАЮЩИЙ ЗАВОД \"", tender_title:"Оказание услуг попромывке реагентами теплообменных аппаратов на установке ЭЛОУ-АВТ-12 ООО«РН-Туапсинский НПЗ» в капитальный ремонт 2024 года", pm_login:"archive", tender_status:"Другое", tender_price:55286280.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-03", year:2023, customer_name:"ООО \"ХУАДЯНЬ-ТЕНИНСКАЯ ТЭЦ\"", tender_title:"Выполнение работ по очистке и текущему ремонту градирен №1,2 и УОЛВ-1,2 для нужд ООО «Хуадянь -Тенинской ТЭЦ» (3271371)", pm_login:"archive", tender_status:"Другое", tender_price:1529762.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-04", year:2023, customer_name:"ООО \"РН-Краснодарнефтегаз\"", tender_title:"Химическая промывка котлов", pm_login:"archive", tender_status:"Другое", tender_price:8684726.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-04", year:2023, customer_name:"ОАО \"УРАЛЬСКАЯ ГОРНО-МЕТАЛЛУРГИЧЕСКАЯ КОМПАНИЯ\", ОАО \"УГМК\"", tender_title:"Очистка и ремонт теплообменного аппарата пластинчатого ALFA M10-BFMсистемыотопления башенного копра шахты ЋСкиповаяЛ ИТП отметки 47 метра.", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-04", year:2023, customer_name:"Башкортостан республика, Учалы АО \"УЧАЛИНСКИЙ ГОК\"", tender_title:"Безразборная химическая промывка пластинчатых теплообменников (РМЦ, ЭЦ, УПР, ЦСХ)", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-04", year:2023, customer_name:"АО «Кольская ГМК», Норильский Никель 20023168/2", tender_title:"Выполнение работы по очистке теплообменного оборудования кобальтового участка и участка утилизации солевого стока ЦЭН АО «Кольская ГМК» , пл. Мончегорск, в соответствии с техническим заданием № 349-010ТехУ", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-04", year:2023, customer_name:"ООО \"Полиом\" (СИБУР)", tender_title:"Оказание услуг по гидродинамической чистке теплообменников Т-4А-Е ООО «Полиом» в 2023 г.", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-04", year:2023, customer_name:"ООО \"АРКТИК СПГ 2\"", tender_title:"Выполнение комплекса работ по зачистке резервуаров дизельного топлива от остатков нефтепродуктов с их последующей утилизацией", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2023-04", year:2023, customer_name:"АО «Газпромнефть-МНПЗ»", tender_title:"Открытый конкурентный отбор Организации, способной выполнить работы по чистке трубных пучков теплообменных аппаратов в 2024 году Лот № 5680-0013708-2023", pm_login:"archive", tender_status:"Другое", tender_price:135240652.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-04", year:2023, customer_name:"ПАО «Славнефть-Мегионнефтегаз»", tender_title:"Открытый конкурентный отбор на оказание услуг по зачистке змеевиков печей трубчатых блочных и путевых подогревателей объектов подготовки нефти для нужд ПАО «Славнефть-Мегионнефтегаз» в 2023-2024 гг.", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-04", year:2023, customer_name:"ООО \"РН-ТУАПСИНСКИЙ НЕФТЕПЕРЕРАБАТЫВАЮЩИЙ ЗАВОД \"", tender_title:"Оказание услуги по обработке мазута для поглощения сероводорода на 2024-2026 гг.", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-04", year:2023, customer_name:"АО \"РНПК\"", tender_title:"Промывка котлов-утилизаторов на установке серной кислоты", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-04", year:2023, customer_name:"Общество с ограниченной ответственностью \"Новокуйбышевский завод масел и присадок\"", tender_title:"«Химическая чистка теплообменников от отложений на установке СОМ в цехе №23 ООО «НЗМП»", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-05", year:2023, customer_name:"АО «Газпромнефть-МНПЗ»", tender_title:"Выполнение работ по промывке от отложений теплообменников Альфа Лаваль с применением химических реагентов на секции 100 комбинированной установки переработки нефти \"ЕВРО+\" АО \"Газпромнефть-МНПЗ\" в 2023г.", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-05", year:2023, customer_name:"ООО «Газпромнефть-Оренбург»", tender_title:"Открытый двухэтапный конкурентный отбор на право заключения договора на оказание услуг по ремонту теплообменных устройств ТЛ-4 ВУ ОНГКМ ООО «Газпромнефть-Оренбург» в 2023-2024гг.", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-05", year:2023, customer_name:"АО \"РНПК\"", tender_title:"Промывка котлов-утилизаторов на установке серной кислоты", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-05", year:2023, customer_name:"ООО \"Новокуйбышевский завод масел и присадок\"", tender_title:"Химическая чистка теплообменников от отложений на установке СОМ в цехе №23 ООО \"НЗМП\"", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-05", year:2023, customer_name:"ООО \"Газпром нефть шельф\"", tender_title:"Открытый конкурентный отбор на право заключения договора на оказание услуг по зачистке трубопроводов системы хозяйственно - бытовых стоков МЛСП «Приразломная» для нужд ООО \"Газпром нефть шельф\"", pm_login:"archive", tender_status:"Другое", tender_price:31248043.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-05", year:2023, customer_name:"АО \"РНПК\"", tender_title:"Оказание услуг по химической очистке пластинчатых теплообменников Compabloc установки ЭЛОУ-АТ-6 с вакуумным блоком ВТ-4 цеха №1 по первичным процессам", pm_login:"archive", tender_status:"Другое", tender_price:182828760.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-09", year:2023, customer_name:"АО \"АНПЗ ВНК\"", tender_title:"Химическая чистка поверхностей нагрева котла-утилизатора КУ-201А (лот №2000592902)", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-09", year:2023, customer_name:"АО \"УК \"КУЗБАССРАЗРЕЗУГОЛЬ\"", tender_title:"Химическая промывка котла КЕ- инв. №08\23126 Филиала Талдинский угольный разрез", pm_login:"archive", tender_status:"Другое", tender_price:1770638.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-09", year:2023, customer_name:"Филиал публичного акционерного общества акционерная нефтяная компания «Башнефть» «Башнефть-Уфанефтехим»", tender_title:"Выполнение работ по чистке теплообменного оборудования установки Висбрекинг цеха №3 Блока ЗГИ по переработке нефти и тяжелых остатков филиала ПАО АНК \"Башнефть\" \"Башнефть-Уфанефтехим\"", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-09", year:2023, customer_name:"АКЦИОНЕРНОЕ ОБЩЕСТВО \"ВОЛГА\", Россия, 606407, Нижегородская область, Балахна, 606407, Нижегородская обл, Балахнинский р-н, г Балахна, ул Горького, дом 1", tender_title:"Выполнение работ «под ключ» по химической промывке котла БКЗ-210-140-Ф ст.№5 для нужд Энергетического комплекса НиГРЭС АО «Волга»", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-09", year:2023, customer_name:"ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ \"НИЖНЕВАРТОВСКОЕ НЕФТЕПЕРЕРАБАТЫВАЮЩЕЕ ОБЪЕДИНЕНИЕ\" 7-3466-674172 1031 Рыжков Роман Николаевич", tender_title:"Выполнение работ по ремонту трубопроводной обвязки теплообменного оборудования в период остановочного ремонта УПН-2 цеха №2 в 2024 году", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-10", year:2023, customer_name:"АО фирма «Агрокомплекс» им. Н.И.Ткачева", tender_title:"Очистка и промывка холодильного, промышленного теплообменного оборудования, согласно ТЗ. (1 этап закупки)", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-10", year:2023, customer_name:"АКЦИОНЕРНОЕ ОБЩЕСТВО \"НОГИНСКАЯ МУНИЦИПАЛЬНАЯ ИНВЕСТИЦИОННО-ТРАСТОВАЯ КОМПАНИЯ\"", tender_title:"Выполнение монтажных работ по замене 2-х водогрейных котлов", pm_login:"archive", tender_status:"Другое", tender_price:448559.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-10", year:2023, customer_name:"АО \"Белкамнефть\" им. А. А. Волкова", tender_title:"Выполнение работ по ремонту объектов НГДУ-1 (зачистка емкостного оборудования)", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-10", year:2023, customer_name:"Акционерное общество \"Новокуйбышевский нефтеперерабатывающий завод\"", tender_title:"РН31001110 Оказание услуг по обработке от отложений (промывке, пропарке) технологического оборудования установок АО НК НПЗ с применением химических реагентов", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-10", year:2023, customer_name:"Акционерное общество \"Уральский турбинный завод\" Свердловская область, Екатеринбург, Фронтовых бригад, 18", tender_title:"Проведение работ по промывке отопительных систем, тепловых пунктов и работ по гидравлическим испытаниям (опрессовке) в корпусах АО УТЗ", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-10", year:2023, customer_name:"ООО «ЗапСибНефтехим»", tender_title:"2059090* «Гидроструйная чистка реакторов ПЭВП ЗСНХ»", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-10", year:2023, customer_name:"ГБУК Г.Москвы \"МВО \"Манеж\"", tender_title:"0373200138223000597 Оказание услуг по замене и утилизации теплоносителя на основе этиленгликоля в системе холодоснабжения (холодильной станции) в здании Центрального выставочного зала \"Манеж\", расположенного по адресу: г.Москва, Манежная пл., д.1.", pm_login:"archive", tender_status:"Клиент отказался", tender_price:4037333.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2023-10", year:2023, customer_name:"АО «Черномортранснефть»", tender_title:"13-ЧТН/РЭН/1-03.2024 Применение ингибитора при проведении ВТД участков, осложненных парафиноотложениями АО«Черномортранснефть»", pm_login:"archive", tender_status:"Другое", tender_price:51231680.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-11", year:2023, customer_name:"ООО \"Газпром Нефть Шельф\"", tender_title:"Оказание услуг по ремонту помещений жилого модуля МЛСП «Приразломная», Лот № 5855-0028353-2023.", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-11", year:2023, customer_name:"ООО \"Газпром Нефть Шельф\"", tender_title:"Лот № 5855-0026575-2023 Выполнение работ по восстановительному ремонту огневых подогревателей МЛСП «Приразломная»", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-11", year:2023, customer_name:"ООО \"Газпром Нефть Шельф\"", tender_title:"Оказание услуг замене теплоносителя в системе теплоснабжения МЛСП «Приразломная»", pm_login:"archive", tender_status:"Другое", tender_price:45710772.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-11", year:2023, customer_name:"АО РНПК, г. Рязань", tender_title:"Выполнение работ по химической очистке пластинчатых теплообменников Compabloc установки ЭЛОУ-АТ-6 с вакуумным блоком ВТ-4 цеха № 1 по первичным процессам", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-11", year:2023, customer_name:"АО «Черномортранснефть»", tender_title:"13-ЧТН/РЭН/1-03.2024 Применение ингибитора при проведении ВТД участков, осложненных парафиноотложениями АО«Черномортранснефть»", pm_login:"archive", tender_status:"Другое", tender_price:51120000.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2023-12", year:2023, customer_name:"ПАО \"Славнефть-Ярославнефтеоргсинтез\"", tender_title:"Выполнение работ по химической промывке внутренних поверхностей нагрева парогенерирующего оборудования методом щелочения для ПАО «Славнефть-ЯНОС».", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2023-12", year:2023, customer_name:"ООО «Газпромнефть-Логистика»", tender_title:"Право заключения договора на выполнение работ по гидромеханической чистке с применением насосов высокого давления трубопроводов отвода паров, устройств верхнего налива \"2902\" Officine, Московского центра отгрузки нефтепродуктов ООО \"ГПН-Логистика\"", pm_login:"archive", tender_status:"Клиент отказался", tender_price:14418412.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2023-12", year:2023, customer_name:"ООО «Газпром нефть шельф»", tender_title:"Открытый конкурентный отбор на право заключения договора на выполнение работ по восстановительному ремонту огневых подогревателей МЛСП «Приразломная» для нужд ООО «Газпром нефть шельф» (Реестровый номер процедуры:", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2024-05", year:2024, customer_name:"АО \"Международный Аэропорт Шереметьево\"", tender_title:"Право заключения договора на выполнение работ по очистке от внешних загрязнений сухих охладителей системы холодоснабжения в Терминале D аэропорта Шереметьево", pm_login:"archive", tender_status:"Клиент отказался", tender_price:3630000.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2024-05", year:2024, customer_name:"ООО \"РН-ВАНКОР\"", tender_title:"РНВ-24-НПУ-027, ВН-24-НПУ-007 Выполнение работ по приготовлению и отпуску технологических жидкостей на Ванкорском и Лодочном месторождениях в 2024-2025", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2024-06", year:2024, customer_name:"Биаксплен", tender_title:"2079056/1. БКП_Чистка теплообменников ТДО в 2024 году", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2024-11", year:2024, customer_name:"Газпром Нефть Шельф", tender_title:"Оказание услуг по техническому освидетельствованию и ремонту технологических трубопроводов 2025-2026", pm_login:"archive", tender_status:"Другое", tender_price:82330336.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2024-11", year:2024, customer_name:"Газпром Нефть Шельф", tender_title:"Оказание услуг по очистке емкостного парка бурового комплекса МЛСП «Приразломная» 2025-2027", pm_login:"archive", tender_status:"Другое", tender_price:184472433.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2024-11", year:2024, customer_name:"\"АГРОКОМПЛЕКС\" ИМ. Н.И.ТКАЧЕВА", tender_title:"Комплекс работ по очистке поверхностей нагрева выпарной станции", pm_login:"archive", tender_status:"Другое", tender_price:38000000.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2024-11", year:2024, customer_name:"Газпром Нефть Шельф", tender_title:"Чистка емкости питьевой воды Т52014А", pm_login:"archive", tender_status:"Другое", tender_price:9678636.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2024-11", year:2024, customer_name:"ООО «Афипский НПЗ»", tender_title:"Проведение гидроструйной чистки оборудования в период капитального ремонта СПГК, т/у 22/4 ООО «Афипский НПЗ»\".", pm_login:"archive", tender_status:"Клиент отказался", tender_price:17414400.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2024-11", year:2024, customer_name:"Краснодарнефтегаз", tender_title:"Промывка котлов химическая", pm_login:"archive", tender_status:"Другое", tender_price:21541471.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2024-11", year:2024, customer_name:"\"Газпромнефть-МНПЗ\"", tender_title:"Открытый конкурентный отбор организации, способной оказать услуги по проведению очистки от отложений поверхности нагрева котла-утилизатора ПКК-75/24", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2024-11", year:2024, customer_name:"АО \"РНПК\"", tender_title:"Выполнение работ по наружной промывке секций аппаратов воздушного охлаждения во время текущей эксплуатации на действующих установках цехах № 1,2,3 в 2025-2027 году", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2024-11", year:2024, customer_name:"ООО \"ГАЗПРОМ НЕФТЕХИМ САЛАВАТ\"", tender_title:"Промывка пластинчатого пакета теплообменника (ПАКИНОКС)", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2024-11", year:2024, customer_name:"ООО \"НИЖЕГОРОДТЕПЛОГАЗ\"", tender_title:"Выполнение комплекса регламентных мероприятий по подготовке котлов к отопительному сезону (подготовка котлов к режимно-наладочным испытаниям, химпромывка, гидропневматическая промывка, режимно-наладочные испытания котлов) в котельных", pm_login:"archive", tender_status:"Клиент отказался", tender_price:31761304.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2024-11", year:2024, customer_name:"АО \"СМП-Нефтегаз\"", tender_title:"Выполнение работ по очистке подземных и наземных емкостей от нефтяного шлама", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2024-11", year:2024, customer_name:"Куйбышевский НПЗ", tender_title:"Оказание услуг по химической очистке пластинчатых и спиральных теплообменников установок цеха №4 (FCC, МТБЭ), цеха №1 (Л-35-11/1000) и процессов цеха №3 (ЭЛОУ-АВТ-3,0 (АВТ-4), ЭЛОУ-АВТ-3,5 (АВТ-5), Висбрекинг)", pm_login:"archive", tender_status:"Клиент отказался", tender_price:27613404.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2024-11", year:2024, customer_name:"ООО \"Газпром нефть шельф\"", tender_title:"01-3003002-344-2024 Открытый конкурентный отбор на право заключения договора на выполнение строительно-монтажных и пусконаладочных работ по техническому перевооружению системы маслонефтесодержащей воды (МНСВ) на МЛСП «Приразломная» (фаза 2)", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2024-11", year:2024, customer_name:"ПАО «КуйбышевАзот»", tender_title:"Чистка трубных пучков теплообменников с применением насоса высокого давления согласно графика с 21.04.2025 по 30.04.2025", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2024-12", year:2024, customer_name:"ООО \"БИАКСПЛЕН\"", tender_title:"БКП_Чистка свечных фильтров расплава в 2025-2027гг (ЗАПРОС ТКП)", pm_login:"archive", tender_status:"Клиент отказался", tender_price:29808000.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2024-12", year:2024, customer_name:"ООО \"Газпром нефть шельф\"", tender_title:"01-3006460-344-2024 Открытый конкурентный отбор на оказание услуг по разборной чистке и ремонту пластинчатых теплообменных аппаратов МЛСП «Приразломная»", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2024-12", year:2024, customer_name:"БЦ «Эрмитаж плаза»", tender_title:"Проведение работ замене раствора этиленгликоля в системе охлаждения контуров холодильных машин.", pm_login:"archive", tender_status:"Другое", tender_price:6140200.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2024-12", year:2024, customer_name:"АО \"ОХК \"УРАЛХИМ\"", tender_title:"проведении открытой закупочной процедуры (далее – «Закупочная процедура») по выбору исполнителя работ по очистке теплообменного оборудования от нерастворимого осадка в цехе 58 филиала «КЧХК».", pm_login:"archive", tender_status:"Другое", tender_price:3904320.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2024-12", year:2024, customer_name:"ПАО \"ЛУКОЙЛ\"", tender_title:"Выполнение комплекса работ по восстановлению эксплуатационных характеристик теплообменного оборудования, выполняемого безразборным методом на объектах ООО «ЛУКОЙЛ-Пермнефтеоргсинтез» в 2025 - 2026 годах (тендер №7305)", pm_login:"archive", tender_status:"Клиент отказался", tender_price:13583333.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2024-12", year:2024, customer_name:"ПАО \"ЛУКОЙЛ\"", tender_title:"«Выполнение работ/Оказание услуг по техническому обслуживанию, ремонту и очистке теплообменного оборудования ООО \"РИТЭК\" Лот №1 Оказание услуг по техническому обслуживанию и ремонту теплообменного оборудования в ТПП \"Волгограднефтегаз\" в 2025 году. Лот №2 Выполнение работ по очистке теплообменного оборудования ТПП \"РИТЭК-Самара-Нафта\" в 2025-2027 гг.». номер тендера – Т43-24.", pm_login:"archive", tender_status:"Клиент отказался", tender_price:48227703.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2024-12", year:2024, customer_name:"\"СЛАВНЕФТЬ-ЯРОСЛАВНЕФТЕОРГСИНТЕЗ\"", tender_title:"«Выполнение работ по химической очистке внутренних поверхностей нагрева парогенерирующего оборудования методом щелочения»", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2024-12", year:2024, customer_name:"ПОЛИОМ", tender_title:"Теплоизоляция трубопроводов", pm_login:"archive", tender_status:"Другое", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null },
    { period:"2024-12", year:2024, customer_name:"\"БАШКИРСКАЯ СОДОВАЯ КОМПАНИЯ\"", tender_title:"Очистка от отложений", pm_login:"archive", tender_status:"Клиент отказался", tender_price:null, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:"Другое", group_tag:null },
    { period:"2024-12", year:2024, customer_name:"ООО \"ММСК\"", tender_title:"\"Очистка нагорной канавы - ручья прудков металлургического цеха (инв. № 9808).\"", pm_login:"archive", tender_status:"Другое", tender_price:11442690.0, work_start_plan:null, work_end_plan:null, purchase_url:null, reject_reason:null, group_tag:null }
  ];

  // ===== Real customers from accounting (199 records) =====
  const SEED_CUSTOMERS = [
    { inn:"6678003306", name:"100 ТОНН СЕРВИС ООО", kpp:"", city:"", note:"" },
    { inn:"6229059220", name:"360 АРЗ АО", kpp:"", city:"", note:"" },
    { inn:"7831000122", name:"АБ РОССИЯ АО", kpp:"", city:"", note:"" },
    { inn:"9715287252", name:"АВАН-ТЕК ООО", kpp:"", city:"", note:"" },
    { inn:"7720781872", name:"АВД ЛОГИСТИКА ООО", kpp:"", city:"", note:"" },
    { inn:"7714037390", name:"АДИДАС ООО", kpp:"", city:"", note:"" },
    { inn:"5003057357", name:"АДМИНИСТРАЦИЯ ПОСЕЛЕНИЯ ВНУКОВСКОЕ", kpp:"", city:"", note:"" },
    { inn:"5012082656", name:"АЛЬФА ООО", kpp:"", city:"", note:"" },
    { inn:"4803000975", name:"АНГЕЛ ИСТ РУС ООО", kpp:"", city:"", note:"" },
    { inn:"5103070023", name:"АПАТИТ АО", kpp:"", city:"", note:"" },
    { inn:"5044098391", name:"АПК ФЛОК ООО", kpp:"", city:"", note:"" },
    { inn:"7706285417", name:"АПЛЕОНА ХСГ ООО", kpp:"", city:"", note:"" },
    { inn:"7708234873", name:"АПОЛЛО КОНСТРАКШН ООО", kpp:"", city:"", note:"" },
    { inn:"9701109394", name:"АСГАРД-ЭНЕРДЖИ ООО", kpp:"", city:"", note:"" },
    { inn:"6225010432", name:"АСТОН КРАХМАЛО-ПРОДУКТЫ ООО", kpp:"", city:"", note:"" },
    { inn:"7720655980", name:"АТЭК ООО", kpp:"", city:"", note:"" },
    { inn:"7703270067", name:"АШАН ООО", kpp:"", city:"", note:"" },
    { inn:"772349141106", name:"Бараташвили Борис Темурович", kpp:"", city:"", note:"" },
    { inn:"3123210204", name:"БЕЛГОРОДЭНЕРГАЗ ООО", kpp:"", city:"", note:"" },
    { inn:"5244013331", name:"БИАКСПЛЕН ООО", kpp:"", city:"", note:"" },
    { inn:"9701041555", name:"БИЗНЕС ПАРК НОВЬ ООО", kpp:"", city:"", note:"" },
    { inn:"8602023761", name:"БИЗНЕС ТРАСТ ООО", kpp:"", city:"", note:"" },
    { inn:"7714262759", name:"БИКОР БМП ООО", kpp:"", city:"", note:"" },
    { inn:"616508699054", name:"БОНДАРЕНКО АНТОН НИКОЛАЕВИЧ (ИП) Р/С 40802810126300000529", kpp:"", city:"", note:"" },
    { inn:"3254005978", name:"БРЯНСКАЯ БУМАЖНАЯ ФАБРИКА ООО", kpp:"", city:"", note:"" },
    { inn:"7713085659", name:"ВБД АО", kpp:"", city:"", note:"" },
    { inn:"5027227470", name:"ВИАТИС ООО", kpp:"", city:"", note:"" },
    { inn:"7702038456", name:"ВНИИОФИ ФГУП", kpp:"", city:"", note:"" },
    { inn:"5024151858", name:"ВОЛЖСКАЯ ПЕРЕКИСЬ ООО", kpp:"", city:"", note:"" },
    { inn:"7708117908", name:"Воронежский филиал АО \"ЦЕМРОС\"", kpp:"", city:"", note:"" },
    { inn:"3663088326", name:"ВШЗ ЗАО", kpp:"", city:"", note:"" },
    { inn:"6723000740", name:"ГАГАРИНКОНСЕРВМОЛОКО ЗАО", kpp:"", city:"", note:"" },
    { inn:"7725610285", name:"ГАЗПРОМ НЕФТЬ ШЕЛЬФ ООО", kpp:"", city:"", note:"" },
    { inn:"7723006328", name:"ГАЗПРОМНЕФТЬ - МНПЗ АО", kpp:"", city:"", note:"" },
    { inn:"7813625844", name:"ГАЗПРОМНЕФТЬ-ПРИРАЗЛОМНОЕ ООО", kpp:"", city:"", note:"" },
    { inn:"5012000639", name:"ГК ЕКС АО", kpp:"", city:"", note:"" },
    { inn:"7731483300", name:"ГОРОД ООО", kpp:"", city:"", note:"" },
    { inn:"5010031470", name:"ГОСМКБ РАДУГА ИМ. А.Я.БЕРЕЗНЯКА АО", kpp:"", city:"", note:"" },
    { inn:"6153022066", name:"ГПН - БТ ЮГ ООО", kpp:"", city:"", note:"" },
    { inn:"8905039538", name:"ГПН-ЛОГИСТИКА ООО", kpp:"", city:"", note:"" },
    { inn:"7712012369", name:"ГРАМЗАПИСЬ ОАО", kpp:"", city:"", note:"" },
    { inn:"7713011336", name:"ГРУППА КОМПАНИЙ ПИК ПАО", kpp:"", city:"", note:"" },
    { inn:"7737106202", name:"ГСП РЕМОНТ ООО", kpp:"", city:"", note:"" },
    { inn:"1660322126", name:"ГЦСС НЕФТЕПРОМХИМ ООО", kpp:"", city:"", note:"" },
    { inn:"7735598887", name:"ЖИЛИЩНИК РАЙОНА САВЕЛКИ ГБУ", kpp:"", city:"", note:"" },
    { inn:"5015009125", name:"ЖИЛСТРОЙИНВЕСТ ООО", kpp:"", city:"", note:"" },
    { inn:"5031043645", name:"ЗАВОД ЭНЕРГОКАБЕЛЬ АО", kpp:"", city:"", note:"" },
    { inn:"7734015927", name:"ЗАО ВНИИТР", kpp:"", city:"", note:"" },
    { inn:"7736619522", name:"ИГИРГИ АО", kpp:"", city:"", note:"" },
    { inn:"5040070638", name:"ИНВЕСТРИЭЛТИ ООО", kpp:"", city:"", note:"" },
    { inn:"7715549585", name:"ИНЖСЕТЬСТРОЙ - 10 ООО", kpp:"", city:"", note:"" },
    { inn:"7710636964", name:"ИНЖСПЛАВ ООО", kpp:"", city:"", note:"" },
    { inn:"5029187086", name:"ИНТЕГРА-С ООО", kpp:"", city:"", note:"" },
    { inn:"772450208447", name:"ИП ПОНОМАРЕВ ВИТАЛИЙ НИКОЛАЕВИЧ Р/С 40802810538000237475 в ПАО Сбербанк г Москва", kpp:"", city:"", note:"" },
    { inn:"7536183415", name:"ИСТ КОНТЕХ ООО", kpp:"", city:"", note:"" },
    { inn:"9722008742", name:"ИТС ООО", kpp:"", city:"", note:"" },
    { inn:"1658008723", name:"КАЗАНЬОРГСИНТЕЗ ПАО", kpp:"", city:"", note:"" },
    { inn:"5024177479", name:"КАПО М ООО", kpp:"", city:"", note:"" },
    { inn:"0105077667", name:"КАРТОНТАРА ООО", kpp:"", city:"", note:"" },
    { inn:"7724680970", name:"КАТОК ООО", kpp:"", city:"", note:"" },
    { inn:"7714946011", name:"КЛЕВЕР МАШИНЗ ООО", kpp:"", city:"", note:"" },
    { inn:"3917026693", name:"КЛИВЕР ООО", kpp:"", city:"", note:"" },
    { inn:"7718993380", name:"КЛИМАТ СВ ООО", kpp:"", city:"", note:"" },
    { inn:"7716785786", name:"КМИ ЛИРА ООО", kpp:"", city:"", note:"" },
    { inn:"2309021440", name:"КНПЗ-КЭН АО", kpp:"", city:"", note:"" },
    { inn:"7701215046", name:"КОКА-КОЛА ЭЙЧБИСИ ЕВРАЗИЯ ООО", kpp:"", city:"", note:"" },
    { inn:"1215059180", name:"КОМИС ООО", kpp:"", city:"", note:"" },
    { inn:"7450027196", name:"КОМПОНЕНТ ООО КСМО", kpp:"", city:"", note:"" },
    { inn:"7728715078", name:"КОНТИНЕНТ ООО", kpp:"", city:"", note:"" },
    { inn:"7715842760", name:"КОРПОРАЦИЯ МИТ АО", kpp:"", city:"", note:"" },
    { inn:"7805298382", name:"КРИОГАЗ ЗАО", kpp:"", city:"", note:"" },
    { inn:"9101001737", name:"КРОНОС ООО", kpp:"", city:"", note:"" },
    { inn:"7702735739", name:"КУПОЛ ООО", kpp:"", city:"", note:"" },
    { inn:"4501184300", name:"КУРГАНХИММАШ ООО", kpp:"", city:"", note:"" },
    { inn:"5075018950", name:"ЛГ ЭЛЕКТРОНИКС РУС ООО", kpp:"", city:"", note:"" },
    { inn:"5015008690", name:"ЛДМ-ГРУПП ООО", kpp:"", city:"", note:"" },
    { inn:"7714353759", name:"ЛЕСНИКОВ ООО", kpp:"", city:"", note:"" },
    { inn:"5001093906", name:"ЛИНДЕ АЗОТ ТОЛЬЯТТИ ООО", kpp:"", city:"", note:"" },
    { inn:"7705533868", name:"Линкс Проперти Менеджмент", kpp:"", city:"", note:"" },
    { inn:"7702583250", name:"ЛЛК-ИНТЕРНЕШНЛ ООО", kpp:"", city:"", note:"" },
    { inn:"5250043567", name:"ЛУКОЙЛ-НИЖЕГОРОДНЕФТЕОРГСИНТЕЗ ООО", kpp:"", city:"", note:"" },
    { inn:"5047246369", name:"МАЛАЯ ГЕНЕРАЦИЯ ООО", kpp:"", city:"", note:"" },
    { inn:"7731218132", name:"МАШИМПЭКС ООО", kpp:"", city:"", note:"" },
    { inn:"7719417526", name:"МЕДСТРОЙ ООО", kpp:"", city:"", note:"" },
    { inn:"7729612036", name:"МИАНОС ООО", kpp:"", city:"", note:"" },
    { inn:"5507240961", name:"МИЛКОМ ООО", kpp:"", city:"", note:"" },
    { inn:"7714972558", name:"МОСГОРГЕОТРЕСТ ГБУ", kpp:"", city:"", note:"" },
    { inn:"7714084055", name:"МОСГОРГЕОТРЕСТ ГУП", kpp:"", city:"", note:"" },
    { inn:"7704136152", name:"МОСКОВСКАЯ ПАТРИАРХИЯ", kpp:"", city:"", note:"" },
    { inn:"5032039592", name:"МОСКОВСКИЙ КОННЫЙ ЗАВОД № 1 ОАО", kpp:"", city:"", note:"" },
    { inn:"5003137066", name:"МОСМЕК НЕДВИЖИМОСТЬ АО", kpp:"", city:"", note:"" },
    { inn:"7702844368", name:"МОСОБЛСТРОЙ ООО", kpp:"", city:"", note:"" },
    { inn:"5029004624", name:"МЫТИЩИНСКАЯ ТЕПЛОСЕТЬ АО", kpp:"", city:"", note:"" },
    { inn:"7707785878", name:"Навита ООО", kpp:"", city:"", note:"" },
    { inn:"7725018030", name:"НАГАТИНО ГСК", kpp:"", city:"", note:"" },
    { inn:"2460237901", name:"НАЗАРОВСКАЯ ГРЭС АО", kpp:"", city:"", note:"" },
    { inn:"7711000924", name:"НАМИ ФГУП", kpp:"", city:"", note:"" },
    { inn:"7708698473", name:"НИКИЭТ АО", kpp:"", city:"", note:"" },
    { inn:"8911020197", name:"НОВАТЭК-ПУРОВСКИЙ ЗПК ООО", kpp:"", city:"", note:"" },
    { inn:"4707026057", name:"НОВАТЭК-УСТЬ-ЛУГА ООО", kpp:"", city:"", note:"" },
    { inn:"7722741628", name:"НОВЫЕ ТЕХНОЛОГИИ АО", kpp:"", city:"", note:"" },
    { inn:"1658146000", name:"НПО НЕФТЕХИМИЯ ООО", kpp:"", city:"", note:"" },
    { inn:"4025415519", name:"ОБНИНСКОРГСИНТЕЗ АО", kpp:"", city:"", note:"" },
    { inn:"0277041328", name:"ОЗНХ-СЕРВИС ООО", kpp:"", city:"", note:"" },
    { inn:"7729101200", name:"ОЧАКОВО АО МПБК", kpp:"", city:"", note:"" },
    { inn:"9909012306", name:"Парагон Констракшн Лимитед филиал", kpp:"", city:"", note:"" },
    { inn:"7830000970", name:"ПЕТЕРБУРГСКИЙ МЕТРОПОЛИТЕН  ГУП", kpp:"", city:"", note:"" },
    { inn:"7728463840", name:"ПКФ ВЕСТА ООО", kpp:"", city:"", note:"" },
    { inn:"5001104410", name:"ПКФ ТОП-СЕНС ООО", kpp:"", city:"", note:"" },
    { inn:"5404952050", name:"ПЛАСТКОМФОРТ ООО", kpp:"", city:"", note:"" },
    { inn:"9909075539", name:"Представительство акционерного общества \"ПУТЕВИ\" Ужице (Республика Сербия) г.Москва", kpp:"", city:"", note:"" },
    { inn:"7706669452", name:"ПРИМАС ООО", kpp:"", city:"", note:"" },
    { inn:"7708249083", name:"ПРО-РИЭЛТИ ООО", kpp:"", city:"", note:"" },
    { inn:"7714430410", name:"ПРОФМ ООО", kpp:"", city:"", note:"" },
    { inn:"4823060316", name:"ПСР ООО", kpp:"", city:"", note:"" },
    { inn:"5040002187", name:"РАМЕНСКИЙ ГОК ОАО", kpp:"", city:"", note:"" },
    { inn:"6612026775", name:"РЕММОНТАЖ ООО", kpp:"", city:"", note:"" },
    { inn:"9103089173", name:"РИВЬЕРА ЮПРО ООО", kpp:"", city:"", note:"" },
    { inn:"7725636702", name:"РН-ВЛАКРА АО", kpp:"", city:"", note:"" },
    { inn:"9715324144", name:"РН-ИНЖИНИРИНГ ООО", kpp:"", city:"", note:"" },
    { inn:"2703032881", name:"РН-КОМСОМОЛЬСКИЙ НПЗ ООО", kpp:"", city:"", note:"" },
    { inn:"2703102867", name:"РН-СПЕКТР ВОСТОЧНЫЙ ООО", kpp:"", city:"", note:"" },
    { inn:"2365004375", name:"РН-ТУАПСИНСКИЙ НПЗ ООО", kpp:"", city:"", note:"" },
    { inn:"6227007322", name:"РНПК АО", kpp:"", city:"", note:"" },
    { inn:"5262218620", name:"РУСВИНИЛ ООО", kpp:"", city:"", note:"" },
    { inn:"7704099052", name:"РУССОБАНК АО АКБ", kpp:"", city:"", note:"" },
    { inn:"5009049835", name:"С 7 ИНЖИНИРИНГ ООО", kpp:"", city:"", note:"" },
    { inn:"5040081164", name:"САТУРН ИМ. В.Н. СТЕПНОВА ООО СОК", kpp:"", city:"", note:"" },
    { inn:"7708119944", name:"СИБИНТЕК ООО ИК", kpp:"", city:"", note:"" },
    { inn:"5905018998", name:"СИБУР-ХИМПРОМ АО", kpp:"", city:"", note:"" },
    { inn:"7704042063", name:"СИВМА ЗАО", kpp:"", city:"", note:"" },
    { inn:"4444002134", name:"СИНТЕК ООО", kpp:"", city:"", note:"" },
    { inn:"7701791321", name:"СК РУСВЬЕТПЕТРО ООО", kpp:"", city:"", note:"" },
    { inn:"9715228962", name:"СМУ 300 ООО", kpp:"", city:"", note:"" },
    { inn:"7715883646", name:"СМУ-300 ООО", kpp:"", city:"", note:"" },
    { inn:"6325004584", name:"СНПЗ АО", kpp:"", city:"", note:"" },
    { inn:"0278088368", name:"СНЭМА-СЕРВИС ООО", kpp:"", city:"", note:"" },
    { inn:"5075010809", name:"СОЗВЕЗДИЕ ГКОУ МО", kpp:"", city:"", note:"" },
    { inn:"7721547709", name:"СПЕЦМОНТАЖАВТОМАТИКА ООО", kpp:"", city:"", note:"" },
    { inn:"7716621322", name:"СПЕЦСТРОЙ № 7 ООО", kpp:"", city:"", note:"" },
    { inn:"1644040406", name:"СПЕЦСТРОЙСЕРВИС ООО", kpp:"", city:"", note:"" },
    { inn:"0326569667", name:"СПЕЦТЕХСТРОЙ ООО", kpp:"", city:"", note:"" },
    { inn:"7721195038", name:"СПОДУМЕН ООО", kpp:"", city:"", note:"" },
    { inn:"5003035498", name:"СПОРТИВНО-ТРЕНИРОВОЧНАЯ БАЗА ПФК ЦСКА ООО", kpp:"", city:"", note:"" },
    { inn:"7705887088", name:"СПСЗ ООО", kpp:"", city:"", note:"" },
    { inn:"9705149567", name:"СПСЗ ООО", kpp:"", city:"", note:"" },
    { inn:"2623016651", name:"СТАВРОПОЛЬСКИЙ БРОЙЛЕР ЗАО", kpp:"", city:"", note:"" },
    { inn:"7751030347", name:"СТЕЛЛАР КОНСТРАКШН ООО", kpp:"", city:"", note:"" },
    { inn:"7716601319", name:"СТРОИТЕЛЬНО-РЕМОНТНАЯ КОМПАНИЯ ООО", kpp:"", city:"", note:"" },
    { inn:"5047027575", name:"СТРОЙ - ПЛАСТ ООО", kpp:"", city:"", note:"" },
    { inn:"7701236254", name:"СТРОЙГРУППА ГЭЙЛ ООО", kpp:"", city:"", note:"" },
    { inn:"5243002023", name:"СУ-7 СМТ ОАО", kpp:"", city:"", note:"" },
    { inn:"5190926879", name:"ТАРА-51 ООО", kpp:"", city:"", note:"" },
    { inn:"7743037564", name:"ТАУБЕР ООО ПК", kpp:"", city:"", note:"" },
    { inn:"7707073366", name:"ТД ЦУМ ОАО", kpp:"", city:"", note:"" },
    { inn:"7710556719", name:"ТДВ ЕВРАЗИЯ ООО", kpp:"", city:"", note:"" },
    { inn:"6685187870", name:"ТЕПЛО ООО", kpp:"", city:"", note:"" },
    { inn:"7722744065", name:"ТЕПЛОВЕНТСТРОЙ ООО", kpp:"", city:"", note:"" },
    { inn:"5027216447", name:"ТЕПЛОКОМФОРТ ООО", kpp:"", city:"", note:"" },
    { inn:"7722204060", name:"ТЕХНОТРАНССЕРВ ООО", kpp:"", city:"", note:"" },
    { inn:"5012059914", name:"ТК ЕВРОТРАНСКОМ ООО", kpp:"", city:"", note:"" },
    { inn:"7704445626", name:"ТРГ СЕРВИС+ ООО", kpp:"", city:"", note:"" },
    { inn:"5019023057", name:"ТРЕЙД СЕРВИС ООО", kpp:"", city:"", note:"" },
    { inn:"7726043769", name:"ТРУД УСЦ", kpp:"", city:"", note:"" },
    { inn:"6829012231", name:"ТСК АО", kpp:"", city:"", note:"" },
    { inn:"7733667768", name:"ТЭР ООО", kpp:"", city:"", note:"" },
    { inn:"5024121130", name:"УК КАРАТ ООО", kpp:"", city:"", note:"" },
    { inn:"7814359909", name:"УК ПИТЕР ООО", kpp:"", city:"", note:"" },
    { inn:"5015245972", name:"УК ЧГ ООО", kpp:"", city:"", note:"" },
    { inn:"6661001614", name:"УММ 2 АО", kpp:"", city:"", note:"" },
    { inn:"5036132507", name:"УПРАВДОМ ООО", kpp:"", city:"", note:"" },
    { inn:"7702682100", name:"УПРАВЛЯЮЩАЯ КОМПАНИЯ БАРЭКС-2 ООО", kpp:"", city:"", note:"" },
    { inn:"6154069596", name:"ФАМАДАР КАРТОНА ЛИМИТЕД АО", kpp:"", city:"", note:"" },
    { inn:"7720284976", name:"ФИРМА ГАЛАКТИКА-1 ООО", kpp:"", city:"", note:"" },
    { inn:"7726328877", name:"ФЛОТИЛИЯ ООО", kpp:"", city:"", note:"" },
    { inn:"7729355935", name:"ФОДД АО", kpp:"", city:"", note:"" },
    { inn:"7720746959", name:"ФОРАТОМ ООО", kpp:"", city:"", note:"" },
    { inn:"7703545931", name:"ФРЕГАТ ООО", kpp:"", city:"", note:"" },
    { inn:"7705189397", name:"ФРИТО ЛЕЙ МАНУФАКТУРИНГ ООО", kpp:"", city:"", note:"" },
    { inn:"7701175668", name:"ФТБ ОКТЯБРЬ АО", kpp:"", city:"", note:"" },
    { inn:"7731014604", name:"Хлебозавод №22 ЗАО", kpp:"", city:"", note:"" },
    { inn:"5015009132", name:"ЦЕНТР ПЛЮС ООО", kpp:"", city:"", note:"" },
    { inn:"5032039680", name:"ЦЕНТР РЕАБИЛИТАЦИИ ФГБУ", kpp:"", city:"", note:"" },
    { inn:"9705080241", name:"ЦЕППЕЛИН. ПРОПЕРТИ МЕНЕДЖМЕНТ ООО", kpp:"", city:"", note:"" },
    { inn:"7816470980", name:"ЦЕСПА ООО", kpp:"", city:"", note:"" },
    { inn:"5001010593", name:"ЦОБХР МВД РОССИИ ФКУ", kpp:"", city:"", note:"" },
    { inn:"772026902025", name:"Черкасских Михаил Вячеславович", kpp:"", city:"", note:"" },
    { inn:"2315072242", name:"ЧЕРНОМОРТРАНСНЕФТЬ АО", kpp:"", city:"", note:"" },
    { inn:"5048051330", name:"ЧЕХОВСКАЯ СПЕЦШКОЛА ГКОУ МО", kpp:"", city:"", note:"" },
    { inn:"7724295538", name:"ШКОЛА «НАСЛЕДНИК»", kpp:"", city:"", note:"" },
    { inn:"5020033028", name:"ЭЙ ДЖИ СИ ФЛЭТ ГЛАСС КЛИН ООО", kpp:"", city:"", note:"" },
    { inn:"9728015665", name:"ЭКОЛОГИЯСЕРВИС ООО", kpp:"", city:"", note:"" },
    { inn:"5078016492", name:"ЭЛЕГИЯ АО", kpp:"", city:"", note:"" },
    { inn:"5610156488", name:"ЭНЕРГО ЗАЩИТА ООО", kpp:"", city:"", note:"" },
    { inn:"5258142249", name:"ЭНЕРГОАЛЬЯНС ООО ПО", kpp:"", city:"", note:"" },
    { inn:"7718855171", name:"ЭПОС ООО", kpp:"", city:"", note:"" },
    { inn:"4415003221", name:"ЮД АЛМАЗ-ХОЛДИНГ ЗАО", kpp:"", city:"", note:"" },
    { inn:"7706436384", name:"ЯКИМАНКА СЕРВИССТРОЙ ООО", kpp:"", city:"", note:"" },
    { inn:"5015011646", name:"Ярмарка 2010 ООО", kpp:"", city:"", note:"" }
  ];

  // ===== Демо-договора =====
  const SEED_CONTRACTS = [
    { 
      id: "contract_demo_1",
      number: "АС-2024/001", 
      type: "customer", 
      counterparty_id: "6678003306", 
      counterparty_name: "100 ТОНН СЕРВИС ООО",
      subject: "Промышленный клининг производственных помещений",
      start_date: "2024-01-15",
      end_date: "2024-12-31",
      is_perpetual: false,
      amount: 2500000,
      responsible: "Петров И.С.",
      status: "active",
      comment: "Основной договор на обслуживание"
    },
    { 
      id: "contract_demo_2",
      number: "АС-2024/002", 
      type: "customer", 
      counterparty_id: "7723006328", 
      counterparty_name: "ГАЗПРОМНЕФТЬ - МНПЗ АО",
      subject: "Техническое обслуживание и ремонт оборудования",
      start_date: "2024-02-01",
      end_date: "2025-01-31",
      is_perpetual: false,
      amount: 8500000,
      responsible: "Захаров Д.В.",
      status: "active",
      comment: "Годовой контракт"
    },
    { 
      id: "contract_demo_3",
      number: "П-2024/010", 
      type: "supplier", 
      counterparty_id: "5012082656", 
      counterparty_name: "АЛЬФА ООО",
      subject: "Поставка расходных материалов",
      start_date: "2024-03-01",
      end_date: null,
      is_perpetual: true,
      amount: null,
      responsible: "Смирнова Е.А.",
      status: "active",
      comment: "Бессрочный рамочный договор"
    },
    { 
      id: "contract_demo_4",
      number: "АС-2023/089", 
      type: "customer", 
      counterparty_id: "7713011336", 
      counterparty_name: "ГРУППА КОМПАНИЙ ПИК ПАО",
      subject: "Монтаж инженерных систем",
      start_date: "2023-06-01",
      end_date: "2024-02-15",
      is_perpetual: false,
      amount: 4200000,
      responsible: "Петров И.С.",
      status: "expired",
      comment: "Завершённый проект"
    },
    { 
      id: "contract_demo_5",
      number: "П-2024/015", 
      type: "supplier", 
      counterparty_id: "7720781872", 
      counterparty_name: "АВД ЛОГИСТИКА ООО",
      subject: "Транспортные услуги",
      start_date: "2024-01-01",
      end_date: "2024-12-31",
      is_perpetual: false,
      amount: 1800000,
      responsible: "Смирнова Е.А.",
      status: "active",
      comment: ""
    }
  ];

  // ===== Seed workers (50) =====
  const SEED_WORKERS = Array.from({length:50}, (_,i)=>({
    full_name: `Рабочий №${String(i+1).padStart(2,"0")}`,
    phone: "",
    city: "",
    role_tag: (i%4===0)?"Промывщик":(i%4===1)?"Слесарь":(i%4===2)?"Мастер":"ПТО",
    grade: (i%5)+1,
    docs_folder_link: "",
    availability_status: "Свободен",
    rating_avg: 0,
    created_at: nowIso()
  }));

  const _dedupCounter = new Map();
  function dedupKey(t){
    const base = (t.purchase_url && t.purchase_url.trim()) || `${t.period}|${t.customer_name}|${t.tender_title}`;
    const count = (_dedupCounter.get(base) || 0) + 1;
    _dedupCounter.set(base, count);
    return count > 1 ? `${base}#${count}` : base;
  }

  async function upsertSettings(){
    const s = await AsgardDB.get("settings","app");
    if(!s){
      await AsgardDB.put("settings", { key:"app", value_json: JSON.stringify(DEFAULT_SETTINGS), updated_at: nowIso() });
    }else{
      // soft-migration for app settings: add missing keys without breaking existing values
      try{
        const cur = JSON.parse(s.value_json||"{}");
        let changed=false;
        // top-level
        for(const [k,v] of Object.entries(DEFAULT_SETTINGS)){
          if(!(k in cur)){ cur[k]=v; changed=true; }
        }
        // nested: sla, limits, schedules, calc
        const nest = (key)=>{
          const def = DEFAULT_SETTINGS[key] || {};
          cur[key] = cur[key] && typeof cur[key]==='object' ? cur[key] : {};
          for(const [k,v] of Object.entries(def)){
            if(!(k in cur[key])){ cur[key][k]=v; changed=true; }
          }
        };
        nest('sla');
        nest('limits');
        nest('schedules');
        nest('calc');
        if(changed){
          s.value_json = JSON.stringify(cur);
          s.updated_at = nowIso();
          await AsgardDB.put("settings", s);
        }
      }catch(_){ /* ignore */ }
    }
    const r = await AsgardDB.get("settings","refs");
    if(!r){
      await AsgardDB.put("settings", { key:"refs", value_json: JSON.stringify(DEFAULT_REFS), updated_at: nowIso() });
    }else{
      // мягкая миграция справочников: добавляем новые поля, не ломая существующие
      try{
        const cur = JSON.parse(r.value_json||"{}");
        let changed=false;
        for(const [k,v] of Object.entries(DEFAULT_REFS)){
          if(!(k in cur)) { cur[k]=v; changed=true; }
        }
        if(changed){
          r.value_json = JSON.stringify(cur);
          r.updated_at = nowIso();
          await AsgardDB.put("settings", r);
        }
      }catch(_){ /* ignore */ }
    }
  }

  async function seedUsers(){
    const users = await AsgardDB.all("users");
    if(users && users.length) return users;
    
    // Создаём пользователей напрямую (без AsgardAuth.register для контроля над PIN)
    for(const u of SEEDED_USERS){
      // Хэшируем пароль (упрощённо для HTTP)
      const passSaltB64 = btoa(String(Date.now()) + Math.random());
      const passHash = btoa(unescape(encodeURIComponent(u.password + passSaltB64))).substring(0, 32);
      
      // Хэшируем PIN
      const pinSaltB64 = btoa(String(Date.now()));
      const pinHash = btoa(String(u.pin) + pinSaltB64).substring(0, 16);
      
      const newUser = {
        login: u.login,
        name: u.name,
        role: u.role,
        birth_date: u.birth_date,
        employment_date: u.employment_date,
        pass_salt: passSaltB64,
        pass_hash: passHash,
        pin_salt: pinSaltB64,
        pin_hash: pinHash,
        must_change_password: false, // Для демо - не требуем смены
        is_active: true,
        is_blocked: false,
        created_at: nowIso(),
        last_login_at: null
      };
      
      // Нормализуем роли
      let roles = [u.role];
      if(u.role === "DIRECTOR_DEV") roles.push("PM");
      if(u.role === "HR") roles.push("PM");
      newUser.roles = roles;
      
      await AsgardDB.add("users", newUser);
    }
    
    // Деактивируем архивного пользователя
    try{
      const all = await AsgardDB.all("users");
      const au = all && all.find(x=>x.login==="archive");
      if(au && au.is_active){
        au.is_active = false;
        await AsgardDB.put("users", au);
      }
    }catch(_){ /* ignore */ }
    return await AsgardDB.all("users");
  }

  async function seedTenders(userMap){
    const existing = await AsgardDB.all("tenders");
    if(existing && existing.length) return existing;

    // Imported dataset: do not generate demo estimates
    if(existing && existing.length > 50) return [];

    const toId = userMap.get("to1");
    const now = nowIso();

    for(const t of SEED_TENDERS){
      const pmId = userMap.get(t.pm_login) || null;
      const isHandoff = t.tender_status !== "Новый";
      const rec = {
        period: t.period,
        year: t.year,
        customer_name: t.customer_name,
        tender_title: t.tender_title,
        tender_type: t.tender_type ?? "Тендер",
        responsible_pm_id: pmId,
        tender_status: t.tender_status,
        tender_price: t.tender_price ?? null,
        work_start_plan: t.work_start_plan ?? null,
        work_end_plan: t.work_end_plan ?? null,
        purchase_url: t.purchase_url ?? null,
        docs_deadline: t.docs_deadline ?? null,
        reject_reason: t.reject_reason ?? null,
        group_tag: t.group_tag ?? null,
        tender_comment_to: "",
        created_by_user_id: toId,
        handoff_at: isHandoff ? now : null,
        handoff_by_user_id: isHandoff ? toId : null,
        dedup_key: dedupKey(t)
      };
      await AsgardDB.add("tenders", rec);
    }
    return await AsgardDB.all("tenders");
  }

  async function seedEstimates(userMap, tenders){
    const existing = await AsgardDB.all("estimates");
    if(existing && existing.length) return existing;

    const byTitle = new Map(tenders.map(x=>[x.tender_title, x]));

    // Create a few estimates so “Согласование” and “Свод Расчётов” are not empty
    const make = async (title, approval_status, version_no=1)=>{
      const t = byTitle.get(title);
      if(!t) return;
      const pmId = t.responsible_pm_id;
      const base = {
        tender_id: t.id,
        pm_id: pmId,
        probability_pct: approval_status==="approved" ? 90 : (approval_status==="sent"?70:50),
        cost_plan: Math.round((t.tender_price||1000000)*0.65),
        price_tkp: t.tender_price || null,
        payment_terms: "50% предоплата, 50% после акта (5 банковских дней)",
        calc_summary_json: JSON.stringify({
          tkp_total: t.tender_price || 0,
          cost_total: Math.round((t.tender_price||1000000)*0.65),
          profit_clean: Math.round((t.tender_price||1000000)*0.25),
          crew: { masters:1, fitters:2, washers:2, pto:1 },
          chemicals_total: Math.round((t.tender_price||1000000)*0.08),
          equipment_total: Math.round((t.tender_price||1000000)*0.07),
          ppe_total: Math.round((t.tender_price||1000000)*0.02)
        }),
        comment: "Черновой просчёт для тестовой сборки",
        version_no: version_no,
        approval_status: approval_status,
        approval_comment: approval_status==="rework" ? "Нужна детализация по логистике и проживанию" : "",
        sent_for_approval_at: approval_status==="sent" || approval_status==="approved" || approval_status==="rework" ? nowIso() : null,
        answered_at: null,
        answer_text: "",
        question_text: ""
      };
      await AsgardDB.add("estimates", base);
    };

    await make("Замена факельного оголовка","draft");
    await make("Промывка кожухотрубных ТО","approved");
    await make("Очистка теплообменников НВД","sent");
    await make("Промывка трубопроводов","rework");
    return await AsgardDB.all("estimates");
  }

  async function seedWorks(tenders){
    const existing = await AsgardDB.all("works");
    if(existing && existing.length) return existing;

    const agreed = tenders.filter(t=>t.tender_status==="Клиент согласился");
    const now = nowIso();
    for(const t of agreed){
      await AsgardDB.add("works", {
        tender_id: t.id,
        pm_id: t.responsible_pm_id,
        company: t.customer_name,
        work_title: t.tender_title,
        work_status: "Подготовка",
        start_in_work_date: t.work_start_plan ?? null,
        end_plan: t.work_end_plan ?? null,
        end_fact: null,
        contract_value: t.tender_price ?? null,
        advance_pct: 30,
        advance_received: Math.round((t.tender_price||0)*0.3),
        advance_date_fact: "2026-02-01",
        act_signed_date_fact: null,
        delay_workdays: 5,
        balance_received: 0,
        payment_date_fact: null,
        cost_plan: Math.round((t.tender_price||1000000)*0.65),
        cost_fact: null,
        crew_size: 6,
        comment: "Создано автоматически из статуса «Клиент согласился» (seed)",
        created_at: now
      });
    }
    return await AsgardDB.all("works");
  }

  async function seedEmployees(){
    const existing = await AsgardDB.all("employees");
    if(existing && existing.length) return existing;
    for(const e of SEED_WORKERS){
      await AsgardDB.add("employees", e);
    }
    return await AsgardDB.all("employees");
  }

  async function seedCustomers(){
    const existing = await AsgardDB.all("customers");
    if(existing && existing.length) return existing;
    for(const c of SEED_CUSTOMERS){
      // normalize INN (digits only)
      const inn = String(c.inn||"").replace(/\D/g, "");
      if(!inn) continue;
      await AsgardDB.put("customers", {
        id: inn,
        inn,
        name: c.name||"",
        kpp: c.kpp||"",
        city: c.city||"",
        note: c.note||"",
        created_at: nowIso(),
        updated_at: nowIso()
      });
    }
    return await AsgardDB.all("customers");
  }

  async function seedContracts(){
    const existing = await AsgardDB.all("contracts");
    if(existing && existing.length) return existing;
    for(const c of SEED_CONTRACTS){
      await AsgardDB.put("contracts", {
        ...c,
        created_at: nowIso(),
        updated_at: nowIso()
      });
    }
    return await AsgardDB.all("contracts");
  }

  async function ensureSeed(){
    // Settings + refs are safe to upsert even if DB already has data
    await upsertSettings();

    // Users
    const users = await seedUsers();
    const userMap = new Map(users.map(u=>[u.login, u.id]));

    // Customers directory (if empty)
    await seedCustomers();
    
    // Contracts (if empty)
    await seedContracts();

    // Core datasets only if empty
    const tenders = await seedTenders(userMap);
    await seedEstimates(userMap, tenders);
    await seedWorks(tenders);
    await seedEmployees();

    // Mark in meta (optional)
    try{
      await AsgardDB.put("meta", { key:"seeded_at", value: nowIso() });
    }catch(e){}

    return true;
  }

  return { ensureSeed, DEFAULT_SETTINGS, DEFAULT_REFS, SEEDED_USERS };
})();
