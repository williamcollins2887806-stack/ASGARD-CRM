/**
 * ГЛОБАЛЬНЫЕ ФУНКЦИИ ДЛЯ ГЕНЕРАЦИИ ОПЦИЙ ПЕРИОДОВ
 */
window.generatePeriodOptions = function(selectedValue) {
  const months = ["Янв","Фев","Мар","Апр","Май","Июн","Июл","Авг","Сен","Окт","Ноя","Дек"];
  const options = ['<option value="">Все периоды</option>'];
  const now = new Date();
  for (let i = 0; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    const label = months[d.getMonth()] + ' ' + d.getFullYear();
    const selected = (value === selectedValue) ? ' selected' : '';
    options.push('<option value="' + value + '"' + selected + '>' + label + '</option>');
  }
  return options.join('');
};

window.generateYearOptions = function(selectedValue) {
  const options = ['<option value="">Все годы</option>'];
  const currentYear = new Date().getFullYear();
  for (let year = currentYear; year >= currentYear - 5; year--) {
    const selected = (String(year) === String(selectedValue)) ? ' selected' : '';
    options.push('<option value="' + year + '"' + selected + '>' + year + '</option>');
  }
  return options.join('');
};

const generatePeriodOptions = window.generatePeriodOptions;
const generateYearOptions = window.generateYearOptions;
console.log('[ASGARD] Global period functions loaded');


(function(){
  const { $, $$, esc, toast, showModal } = AsgardUI;
  const MOBILE_V2_ENABLED = window.ASGARD_FLAGS?.MOBILE_V2_ENABLED !== false;
  try{ if(window.AsgardTheme) AsgardTheme.init(); }catch(e){}

  // Глобальная функция для мобильной совместимости кнопок
  // Добавляет обработчики click + touchend для надёжной работы на мобильных устройствах
  function addMobileClick(el, handler) {
    if (!el) {
      // Не логируем - элементы могут отсутствовать на некоторых страницах
      return;
    }
    let touchHandled = false;

    // Touch events for mobile
    el.addEventListener("touchstart", (e) => {
      // Mark that touch is happening
      touchHandled = true;
    }, { passive: true });

    el.addEventListener("touchend", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handler(e);
      setTimeout(() => { touchHandled = false; }, 400);
    }, { passive: false });

    // Click event for desktop (and fallback)
    el.addEventListener("click", (e) => {
      if (!touchHandled) {
        handler(e);
      }
      touchHandled = false;
    });

    // Ensure button is clickable (fix potential CSS issues)
    el.style.touchAction = 'manipulation';
    el.style.cursor = 'pointer';
    el.style.pointerEvents = 'auto';
  }

  // Make it globally available
  window.addMobileClick = addMobileClick;

  // Определяем базовый путь к assets (для работы из подпапок типа /tools/)
  const ASSETS_BASE = (function(){
    const scripts = document.querySelectorAll('script[src*="app.js"]');
    for(const s of scripts){
      const src = s.getAttribute('src') || '';
      // Ищем путь к app.js и извлекаем базу
      const match = src.match(/^(.*?)assets\/js\/app\.js/);
      if(match) return match[1] + 'assets/';
    }
    return 'assets/';
  })();

  // 30 цитат в стиле викингов для загрузочного экрана
  const LOADING_QUOTES = [
    "Драккар готовится к походу... Асгард ждёт своих воинов.",
    "Один видит всё. И твои дела — тоже.",
    "Тор куёт молнии, а мы — контракты.",
    "Путь к Вальгалле лежит через порядок в делах.",
    "Руны складываются... Летопись загружается.",
    "Мудрый ярл сначала считает, потом бьёт.",
    "Фрейя благословляет тех, кто ведёт учёт честно.",
    "Великие саги начинаются с первого клика.",
    "Рагнарёк подождёт — сначала сдай отчёт.",
    "Асгард-Сервис: где каждый тендер — это поход.",
    "Локи хитёр, но наш калькулятор хитрее.",
    "Валькирии уносят героев. CRM — уносит хаос.",
    "Слава тому, кто закрывает работы вовремя!",
    "Мёд победы сладок. Особенно после согласования.",
    "Хеймдалль стережёт Биврёст. Мы стережём дедлайны.",
    "Не буди спящего дракона. Буди спящий просчёт.",
    "Скандинавский порядок в каждой цифре.",
    "Слово Ярла — закон. Но дашборд — доказательство.",
    "Дружина сильна учётом, а не криком.",
    "Ветер наполняет паруса. Данные наполняют отчёты.",
    "Берсерк в бою, педант в расчётах.",
    "Фенрир грызёт цепи. Мы грызём сроки.",
    "Иггдрасиль крепок корнями. Бизнес — цифрами.",
    "Сегодня — CRM. Завтра — Вальгалла продаж!",
    "Готовим руны... Загружаем мудрость предков.",
    "Тысяча походов начинается с одного входа.",
    "Лёд и пламя. Расходы и доходы.",
    "Боги Асгарда смотрят на твои KPI.",
    "Где викинг — там победа. Где CRM — там порядок.",
    "Сага продолжается... Добро пожаловать, воин!"
  ];

  window.ASGARD_LOADING_QUOTES = LOADING_QUOTES;

  /* Wave 4: Hide inline splash screen */
  function hideSplashScreen() {
    var splash = document.getElementById('asgard-splash');
    if (!splash) return;
    splash.style.opacity = '0';
    setTimeout(function() {
      if (splash.parentNode) splash.parentNode.removeChild(splash);
    }, 400);
  }
  window.hideSplashScreen = hideSplashScreen;

  const MOTTOS={
    "/home":"Сталь и порядок. Пусть каждый день приносит добычу.",
    "/tenders":"Видим цель. Берём след. Ведём до победы.",
    "/pm-calcs":"Сроки видны. Силы рассчитаны. Риск под контролем.",
    "/approvals":"Слово Ярла — закон. Счёт должен быть чист.",
    "/pm-works":"Клятва дана — доведи дело до конца.",
    "/all-works":"Дело идёт по плану — пока цифры честны.",
    "/all-estimates":"Счёт точен. Решение крепко. Ошибки не проходят.",
    "/kpi-works":"Кто ведёт путь — тот отвечает за след.",
    "/kpi-money":"Казна любит порядок. Долг не терпит тени.",
    "/personnel":"В дружине сила. В учёте — порядок. В деле — честь.",
    "/employee":"Сильна дружина, где помнят имена и дела.",
    "/workers-schedule":"Кто где стоит — тот и держит фронт.",
    "/settings":"Настрой верно — и путь станет прямым.",
    "/customers":"Храни имена и печати — и договор будет крепок.",
    "/customer":"Храни имена и печати — и договор будет крепок.",
    "/hr-requests":"Дружина сильна, когда строем управляют руны.",
    "/proc-requests":"Запас крепок, когда список точен.",
    "/login":"Вход в зал. У каждого своя доля ответственности.",
    "/register":"Пусть имя будет честным, а роль — ясной.",
    "/cash":"Деньги любят счёт. Каждый рубль — на виду.",
    "/cash-admin":"Контроль — залог доверия. Считай и подтверждай.",
    "/tasks":"Дело назначено — доведи до конца.",
    "/tasks-admin":"Ярл видит все задачи. Порядок в дружине."
  };

  const DIRECTOR_ROLES = ["DIRECTOR_COMM","DIRECTOR_GEN","DIRECTOR_DEV"]; // legacy DIRECTOR removed in Stage 25
  const HEAD_ROLES = ["HEAD_TO","HEAD_PM"]; // M15: Руководители отделов
  const OFFICE_ROLES = ["TO","PM","HR","HR_MANAGER","BUH","OFFICE_MANAGER","WAREHOUSE","CHIEF_ENGINEER",...HEAD_ROLES,...DIRECTOR_ROLES,"ADMIN"];
  const ALL_ROLES = [...OFFICE_ROLES,"PROC"];


  window.__ASG_SHARED_TABLE_CSS__ = `
<style>
  table.asg{width:100%; border-collapse:separate; border-spacing:0 6px;}
  table.asg th{font-size:11px; color:var(--text-secondary); font-weight:700; text-align:left; padding:0 10px; font-family:var(--font-sans)}
  table.asg td{padding:10px; background:var(--bg-card); border:none; vertical-align:top; font-family:var(--font-sans); font-size:13px}
  table.asg tr td:first-child{border-top-left-radius:8px;border-bottom-left-radius:8px;}
  table.asg tr td:last-child{border-top-right-radius:8px;border-bottom-right-radius:8px;}
  table.asg tr:hover td{background:var(--bg-elevated)}
  .tools{display:flex; gap:10px; flex-wrap:wrap; align-items:end}
  .tools .field{min-width:220px}
  .kpi{display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:12px}
  .kpi .k{background:var(--bg-card); border:none; border-radius:8px; padding:14px}
  .kpi .k .t{font-size:11px; color:var(--text-secondary); font-weight:700; font-family:var(--font-sans)}
  .kpi .k .v{font-size:22px; font-weight:800; margin-top:6px; color:var(--gold); font-family:var(--font-sans)}
  .kpi .k .s{font-size:12px; color:var(--text-secondary); margin-top:6px}
  .chart{background:var(--bg-card); border:none; border-radius:8px; padding:16px}
  .chart h3{font-size:14px; font-weight:700; color:var(--text-primary); margin:0 0 12px 0; font-family:var(--font-sans)}
  .barrow{display:grid; grid-template-columns: minmax(100px,200px) 1fr minmax(80px,auto); gap:12px; align-items:center; margin:6px 0; font-size:13px}
  .barrow > div:first-child{overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text-secondary)}
  .barrow > div:last-child{text-align:right; white-space:nowrap; color:var(--text-primary)}
  .bar{height:14px; border-radius:999px; background:rgba(255,255,255,.06); overflow:hidden}
  .bar > div{height:100%}
</style>
`;

  // ═══════════════════════════════════════════════════════════════════════════
  // NAVIGATION GROUPS — Business Viking 2026 Design System
  // 9 групп навигации с иконками и раскрывающимися секциями
  // ═══════════════════════════════════════════════════════════════════════════
  const NAV_GROUPS = [
    { id: "home",     label: "Главная",       icon: "<svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><path d='m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'/></svg>", defaultExpanded: true },
    { id: "tenders",  label: "Тендеры",       icon: "<svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><path d='M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2'/><rect width='8' height='4' x='8' y='2' rx='1' ry='1'/></svg>", defaultExpanded: false },
    { id: "works",    label: "Работы",        icon: "<svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><path d='M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z'/></svg>", defaultExpanded: false },
    { id: "finance",  label: "Финансы",       icon: "<svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><line x1='12' x2='12' y1='2' y2='22'/><path d='M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6'/></svg>", defaultExpanded: false },
    { id: "resources",label: "Ресурсы",       icon: "<svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><path d='m7.5 4.27 9 5.15'/><path d='M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z'/><path d='m3.3 7 8.7 5 8.7-5'/><path d='M12 22V12'/></svg>", defaultExpanded: false },
    { id: "personnel",label: "Персонал",      icon: "<svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><path d='M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'/><circle cx='9' cy='7' r='4'/><path d='M22 21v-2a4 4 0 0 0-3-3.87'/><path d='M16 3.13a4 4 0 0 1 0 7.75'/></svg>", defaultExpanded: false },
    { id: "comm",     label: "Коммуникации",  icon: "<svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><path d='m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z'/></svg>", defaultExpanded: false },
    { id: "analytics",label: "Аналитика",     icon: "<svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><line x1='18' x2='18' y1='20' y2='10'/><line x1='12' x2='12' y1='20' y2='4'/><line x1='6' x2='6' y1='20' y2='14'/></svg>", defaultExpanded: false },
    { id: "system",   label: "Система",       icon: "<svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><circle cx='12' cy='12' r='3'/><path d='M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z'/></svg>", defaultExpanded: false }
  ];

  // M1: Добавлено поле p (permission key) и g (group id) для модульных ролей
  const NAV=[
    // ── ГЛАВНАЯ ──
    {r:"/home",l:"Зал Ярла",d:"Порталы и сводка",roles:ALL_ROLES,i:"home",p:"home",g:"home"},
    {r:"/dashboard",l:"Дашборд руководителя",d:"Сводная аналитика",roles:["ADMIN",...DIRECTOR_ROLES],i:"dashboard",p:"dashboard",g:"home"},
    {r:"/my-dashboard",l:"Мой дашборд",d:"Настраиваемые виджеты",roles:["ADMIN","PM","TO","HR","OFFICE_MANAGER","BUH",...DIRECTOR_ROLES,...HEAD_ROLES],i:"dashboard",p:"my_dashboard",g:"home"},
    {r:"/big-screen",l:"Большой Экран",d:"Авто-ротация KPI для монитора",roles:["ADMIN",...DIRECTOR_ROLES,...HEAD_ROLES],i:"dashboard",p:"big_screen",g:"home"},
    {r:"/calendar",l:"Календарь встреч",d:"Совещания и события",roles:ALL_ROLES,i:"schedule",p:"calendar",g:"home"},
    {r:"/birthdays",l:"Дни рождения",d:"Офисный календарь ДР",roles:ALL_ROLES,i:"birthdays",p:"birthdays",g:"home"},
    {r:"/tasks",l:"Мои задачи",d:"Задачи и Todo-список",roles:ALL_ROLES,i:"approvals",p:"tasks",g:"home"},

    // ── ТЕНДЕРЫ ──
    {r:"/pre-tenders",l:"Заявки",d:"Предварительные заявки (AI)",roles:["ADMIN","TO","HEAD_TO",...DIRECTOR_ROLES],i:"alerts",p:"pre_tenders",g:"tenders"},
    {r:"/funnel",l:"Воронка продаж",d:"Канбан тендеров",roles:["ADMIN","TO","HEAD_TO",...DIRECTOR_ROLES],i:"tenders",p:"funnel",g:"tenders"},
    {r:"/tenders",l:"Сага Тендеров",d:"Реестр тендеров",roles:["ADMIN","TO","HEAD_TO",...DIRECTOR_ROLES],i:"tenders",p:"tenders",g:"tenders"},
    {r:"/customers",l:"Карта Контрагентов",d:"Справочник организаций",roles:["ADMIN","TO","HEAD_TO","PM","HEAD_PM","OFFICE_MANAGER",...DIRECTOR_ROLES],i:"customers",p:"customers",g:"tenders"},

    // ── РАБОТЫ ──
    {r:"/pm-calcs",l:"Просчёты (inbox)",d:"Входящие от ТО",roles:["ADMIN","PM","HEAD_PM",...DIRECTOR_ROLES],i:"pmcalcs",p:"pm_calcs",g:"works"},
    {r:"/calculator",l:"Калькулятор ᚱ",d:"Расчёт стоимости работ",roles:["ADMIN","PM","TO","HEAD_PM","HEAD_TO",...DIRECTOR_ROLES],i:"calculator",p:"calculator",g:"works"},
    {r:"/approvals",l:"Согласование",d:"Решения Ярла",roles:["ADMIN","HEAD_PM",...DIRECTOR_ROLES],i:"approvals",p:"approvals",g:"works"},
    {r:"/bonus-approval",l:"Согласование премий",d:"Премии рабочим",roles:["ADMIN","PM","HEAD_PM",...DIRECTOR_ROLES],i:"approvals",p:"bonus_approval",g:"works"},
    {r:"/pm-works",l:"Мои работы (РП)",d:"Проекты РП",roles:["ADMIN","PM","HEAD_PM",...DIRECTOR_ROLES],i:"pmworks",p:"pm_works",g:"works"},
    {r:"/all-works",l:"Свод Контрактов",d:"Все работы",roles:["ADMIN","HEAD_PM",...DIRECTOR_ROLES],i:"allworks",p:"all_works",g:"works"},
    {r:"/all-estimates",l:"Свод Расчётов",d:"Все просчёты",roles:["ADMIN","BUH","HEAD_PM",...DIRECTOR_ROLES],i:"allestimates",p:"all_estimates",g:"works"},
    {r:"/gantt-calcs",l:"Гантт: Просчёты",d:"Пересечения по срокам",roles:["ADMIN","PM","HEAD_PM",...DIRECTOR_ROLES],i:"ganttcalcs",p:"gantt",g:"works"},
    {r:"/gantt-works",l:"Гантт: Работы",d:"План и факты",roles:["ADMIN","PM","HEAD_PM",...DIRECTOR_ROLES],i:"ganttworks",p:"gantt",g:"works"},
    {r:"/tasks-admin",l:"Управление задачами",d:"Контроль задач",roles:["ADMIN"],i:"approvals",p:"tasks_admin",g:"works"},
    {r:"/kanban",l:"Канбан-доска",d:"Визуальное управление задачами",roles:ALL_ROLES,i:"approvals",p:"kanban",g:"works"},

    // ── ФИНАНСЫ ──
    {r:"/finances",l:"Финансы",d:"Аналитика и реестр",roles:["ADMIN","BUH",...DIRECTOR_ROLES],i:"finances",p:"finances",g:"finance"},
    {r:"/invoices",l:"Счета и оплаты",d:"Выставление и отслеживание",roles:["ADMIN","PM","BUH",...DIRECTOR_ROLES],i:"finances",p:"invoices",g:"finance"},
    {r:"/acts",l:"Акты",d:"Акты выполненных работ",roles:["ADMIN","PM","BUH",...DIRECTOR_ROLES],i:"buh",p:"acts",g:"finance"},
    {r:"/buh-registry",l:"Реестр расходов",d:"Бухгалтерский реестр",roles:["ADMIN","BUH",...DIRECTOR_ROLES],i:"finances",p:"buh_registry",g:"finance"},
    {r:"/office-expenses",l:"Офисные расходы",d:"Управление и согласование",roles:["ADMIN","OFFICE_MANAGER",...DIRECTOR_ROLES],i:"office",p:"office_expenses",g:"finance"},
    {r:"/cash",l:"Касса",d:"Авансовые отчёты",roles:["ADMIN","PM",...DIRECTOR_ROLES],i:"finances",p:"cash",g:"finance"},
    {r:"/cash-admin",l:"Касса (управление)",d:"Согласование и контроль",roles:["ADMIN","BUH",...DIRECTOR_ROLES],i:"finances",p:"cash_admin",g:"finance"},
    {r:"/approval-payment",l:"Очередь оплаты",d:"Оплата согласованных заявок",roles:["ADMIN","BUH",...DIRECTOR_ROLES],i:"finances",p:"approval_payment",g:"finance"},
    {r:"/payroll",l:"Расчёты с рабочими",d:"Ведомости и выплаты",roles:["ADMIN","PM","HEAD_PM","BUH",...DIRECTOR_ROLES],i:"finances",p:"payroll",g:"finance"},
    {r:"/self-employed",l:"Самозанятые",d:"Реестр СЗ и договора",roles:["ADMIN","BUH",...DIRECTOR_ROLES],i:"finances",p:"payroll",g:"finance"},
    {r:"/one-time-pay",l:"Разовые оплаты",d:"Такси, топливо, разовые",roles:["ADMIN","PM","HEAD_PM","BUH",...DIRECTOR_ROLES],i:"finances",p:"payroll",g:"finance"},

    // ── РЕСУРСЫ ──
    {r:"/tkp",l:"ТКП",d:"Коммерческие предложения",roles:["ADMIN","PM","HEAD_PM","TO","HEAD_TO",...DIRECTOR_ROLES],i:"tenders",p:"tkp",g:"resources"},
    {r:"/pass-requests",l:"Заявки на пропуск",d:"Оформление пропусков",roles:["ADMIN","PM","HEAD_PM","TO","HEAD_TO","HR","HR_MANAGER",...DIRECTOR_ROLES],i:"approvals",p:"pass_requests",g:"resources"},
    {r:"/procurement",l:"Закупки",d:"Заявки на закупку материалов",
 roles:["ADMIN","PM","HEAD_PM","PROC","BUH","WAREHOUSE","DIRECTOR_GEN","DIRECTOR_COMM","DIRECTOR_DEV"],
 i:"approvals",p:"procurement",g:"resources"},
{r:"/assembly",l:"Сбор на складе",d:"Ведомости сборки и мобилизации",
 roles:["ADMIN","PM","HEAD_PM","WAREHOUSE","DIRECTOR_GEN","DIRECTOR_COMM","DIRECTOR_DEV"],
 i:"backup",p:"assembly",g:"resources"},
    {r:"/warehouse",l:"Склад ТМЦ",d:"Оборудование и инструменты",roles:ALL_ROLES,i:"backup",p:"warehouse",g:"resources"},
    {r:"/my-equipment",l:"Моё оборудование",d:"Выданное мне",roles:["PM","HEAD_PM","CHIEF_ENGINEER",...DIRECTOR_ROLES,"ADMIN"],i:"pmworks",p:"my_equipment",g:"resources"},
    {r:"/correspondence",l:"Корреспонденция",d:"Входящие и исходящие",roles:["ADMIN","OFFICE_MANAGER","DIRECTOR_COMM","DIRECTOR_GEN","DIRECTOR_DEV"],i:"correspondence",p:"correspondence",g:"resources"},
    {r:"/contracts",l:"Реестр договоров",d:"Договора поставщиков",roles:["ADMIN","OFFICE_MANAGER","BUH",...DIRECTOR_ROLES],i:"proxies",p:"contracts",g:"resources"},
    {r:"/seals",l:"Реестр печатей",d:"Учёт и передача",roles:["ADMIN","OFFICE_MANAGER",...DIRECTOR_ROLES],i:"proxies",p:"seals",g:"resources"},
    {r:"/proxies",l:"Доверенности",d:"7 шаблонов документов",roles:["ADMIN","OFFICE_MANAGER",...DIRECTOR_ROLES],i:"proxies",p:"proxies",g:"resources"},

    // ── ПЕРСОНАЛ ──
    {r:"/personnel",l:"Дружина",d:"Сотрудники",roles:["ADMIN","HR","HR_MANAGER","PM","HEAD_PM",...DIRECTOR_ROLES],i:"workers",p:"personnel",g:"personnel"},
    {r:"/hr-requests",l:"Заявки персонала",d:"HR-заявки",roles:["ADMIN","HR","HR_MANAGER",...DIRECTOR_ROLES],i:"workers",p:"hr_requests",g:"personnel"},
    {r:"/collections",l:"Подборки дружины",d:"Именные списки сотрудников",roles:["ADMIN","HR","HR_MANAGER",...DIRECTOR_ROLES],i:"workers",p:"personnel",g:"personnel"},
    {r:"/permits",l:"Разрешения и допуски",d:"Сроки действия, матрица",roles:["ADMIN","HR","HR_MANAGER","TO","HEAD_TO","PM","CHIEF_ENGINEER",...DIRECTOR_ROLES],i:"workers",p:"permits",g:"personnel"},
    {r:"/permit-applications",l:"Заявки на оформление",d:"Реестры разрешений подрядчикам",roles:["ADMIN","HR","HR_MANAGER","TO","HEAD_TO",...DIRECTOR_ROLES],i:"workers",p:"permit_applications",g:"personnel"},
    {r:"/training",l:"Обучение",d:"Заявки на обучение",roles:ALL_ROLES,i:"school",p:"training_applications",g:"personnel"},
    {r:"/office-schedule",l:"График: Офис",d:"Статусы по дням",roles:ALL_ROLES,i:"schedule",p:"office_schedule",g:"personnel"},
    {r:"/workers-schedule",l:"График: Рабочие",d:"Бронь и доступность",roles:["ADMIN","HR","HR_MANAGER",...DIRECTOR_ROLES],i:"workers",p:"workers_schedule",g:"personnel"},
    {r:"/hr-rating",l:"Рейтинг Дружины",d:"Оценки и средний балл",roles:["ADMIN","HR","HR_MANAGER",...DIRECTOR_ROLES],i:"rating",p:"hr_rating",g:"personnel"},
    {r:"/travel",l:"Жильё и билеты",d:"Проживание и транспорт",roles:["ADMIN","OFFICE_MANAGER","HR","HR_MANAGER","PM",...DIRECTOR_ROLES],i:"travel",p:"travel",g:"personnel"},

    // ── КОММУНИКАЦИИ ──
    {r:"/messenger",l:"Хугинн",d:"Вороний Вестник — чаты",roles:ALL_ROLES,i:"correspondence",p:"chat_groups",g:"comm"},
    {r:"/meetings",l:"Совещания",d:"Планирование и протоколы",roles:ALL_ROLES,i:"schedule",p:"meetings",g:"comm"},
    {r:"/alerts",l:"Уведомления",d:"Воронья почта",roles:ALL_ROLES,i:"alerts",p:"alerts",g:"comm"},
    {r:"/telegram",l:"Telegram",d:"Уведомления и SMS",roles:["ADMIN"],i:"alerts",p:"telegram_admin",g:"comm"},
    {r:"/telephony",l:"Телефония",d:"Звонки и маршрутизация",roles:["ADMIN","TO","HEAD_TO","PM","HEAD_PM",...DIRECTOR_ROLES],i:"telephony",p:"telephony",g:"comm"},

    // ── АНАЛИТИКА ──
    {r:"/analytics",l:"Аналитика Ярла",d:"KPI работ и денег",roles:["ADMIN",...DIRECTOR_ROLES],i:"kpiworks",p:"analytics",g:"analytics"},
    {r:"/user-requests",l:"Заявки пользователей",d:"Одобрение регистраций",roles:["ADMIN"],i:"requests",p:"users_admin",g:"analytics"},

    // ── СИСТЕМА ──
    {r:"/settings",l:"Настройки",d:"Справочники и цвета",roles:["ADMIN"],i:"settings",p:"settings",g:"system"},
    {r:"/backup",l:"Резервные копии",d:"Экспорт/импорт базы",roles:["ADMIN"],i:"backup",p:"backup",g:"system"},
    {r:"/sync",l:"PostgreSQL Sync",d:"Синхронизация с сервером",roles:["ADMIN"],i:"backup",p:"sync",g:"system"},
    {r:"/diag",l:"Диагностика",d:"Версия, база, self-test",roles:["ADMIN"],i:"diag",p:"diag",g:"system"},

    // M15: Аналитика для руководителей отделов
    {r:"/to-analytics",l:"Хроники Тендерного Отдела",d:"KPI тендерных специалистов",roles:["ADMIN","HEAD_TO",...DIRECTOR_ROLES],i:"kpiworks",p:"to_analytics",g:"analytics"},
    {r:"/pm-analytics",l:"Хроники Руководителей Проектов",d:"KPI и загрузка РП",roles:["ADMIN","HEAD_PM",...DIRECTOR_ROLES],i:"kpiworks",p:"pm_analytics",g:"analytics"},
    {r:"/engineer-dashboard",l:"Кузница Инженера",d:"Склад, оборудование, ТО",roles:["ADMIN","CHIEF_ENGINEER"],i:"backup",p:"engineer_dashboard",g:"analytics"},
    {r:"/object-map",l:"Карта объектов",d:"География работ",roles:["ADMIN",...DIRECTOR_ROLES,...HEAD_ROLES],i:"kpiworks",p:"object_map",g:"analytics"},

    // Фаза 8+9: Почта + AI-анализ заявок (объединено)
    {r:"/my-mail",l:"Моя почта",d:"Персональная почта сотрудника",roles:ALL_ROLES,i:"email",p:"my_mail",g:"comm"},
    {r:"/mailbox",l:"Почта и заявки",d:"Входящие / исходящие + AI-анализ",roles:["ADMIN","DIRECTOR_GEN","DIRECTOR_COMM","DIRECTOR_DEV","HEAD_TO"],i:"workers",p:"mailbox",g:"comm"},
    {r:"/mail-settings",l:"Настройки почты",d:"Аккаунты, правила, шаблоны",roles:["ADMIN","DIRECTOR_GEN"],i:"backup",p:"mail_settings",g:"comm"},

    // Фаза 10: Интеграции
    {r:"/integrations",l:"Интеграции",d:"Банк/1С, Тендерные площадки, ERP",roles:["ADMIN","BUH","DIRECTOR_GEN","DIRECTOR_COMM","DIRECTOR_DEV","HEAD_TO","TO"],i:"backup",p:"integrations",g:"comm"},
  ];

  // Mobile tab group detection
  function getMobileTabGroup(route) {
    const r = route || '';
    if (['/home','/dashboard','/my-dashboard','/big-screen','/calendar','/birthdays','/welcome','/alerts'].some(p => r.startsWith(p))) return 'home';
    if (['/tasks','/kanban','/reminders','/approvals','/bonus-approval'].some(p => r.startsWith(p))) return 'tasks';
    if (['/mail','/my-mail','/mailbox','/mail-settings'].some(p => r.startsWith(p))) return 'mail';
    if (['/chat'].some(p => r.startsWith(p))) return 'chat';
    if (['/pm-works','/all-works','/gantt','/calculator','/pm-calcs','/all-estimates'].some(p => r.startsWith(p))) return 'works';
    return 'more';
  }

  // v8.1 — Update chat tab badge with unread count
  function updateChatTabBadge() {
    try {
      var chatTab = document.querySelector('.m-tab[data-tab="chat"]');
      if (!chatTab) return;
      var existingBadge = chatTab.querySelector('.m-tab-unread');
      if (window.AsgardDB && window.AsgardAuth && AsgardAuth.user) {
        AsgardDB.byIndex('chat_groups','members',AsgardAuth.user.id).then(function(groups) {
          var total = 0;
          if (groups) groups.forEach(function(g) { total += (g.unread_count || 0); });
          if (total > 0) {
            if (!existingBadge) {
              existingBadge = document.createElement('span');
              existingBadge.className = 'm-tab-unread';
              chatTab.appendChild(existingBadge);
            }
            existingBadge.textContent = total > 99 ? '99+' : total;
            existingBadge.style.display = '';
          } else if (existingBadge) {
            existingBadge.style.display = 'none';
          }
        }).catch(function(){});
      }
    } catch(e) {}
  }



  // ═══════════════════════════════════════════════════════════════
  // MOBILE: Role-based tab configuration
  // ═══════════════════════════════════════════════════════════════
  function getMobileTabsForRole(role) {
    // v8.0.0 — Tabs per role. Mail + Chat for ALL. MiMir auto-inserted in middle.
    const directors = [
      { id: 'home',  route: '#/home',    icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M3 9.5L12 3l9 6.5V20a2 2 0 01-2 2H5a2 2 0 01-2-2V9.5z" stroke="currentColor" stroke-width="1.8"/><path d="M9 22V14h6v8" stroke="currentColor" stroke-width="1.8"/><path d="M12 3L12 7" stroke="var(--gold, #D4A843)" stroke-width="1.5" opacity=".6"/><circle cx="12" cy="10" r="1.5" fill="var(--gold, #D4A843)" opacity=".4"/></svg>', label: '\u0413\u043B\u0430\u0432\u043D\u0430\u044F' },
      { id: 'tasks', route: '#/tasks',   icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="4" y="3" width="16" height="18" rx="2" stroke="currentColor" stroke-width="1.8"/><polyline points="9 11 11 13 15 9" stroke="var(--gold, #D4A843)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><line x1="8" y1="7" x2="16" y2="7" stroke="currentColor" stroke-width="1" opacity=".3"/><line x1="8" y1="17" x2="14" y2="17" stroke="currentColor" stroke-width="1" opacity=".3"/></svg>', label: '\u0417\u0430\u0434\u0430\u0447\u0438' },
      { id: 'mail',  route: '#/my-mail', icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="1.8"/><polyline points="3 7 12 14 21 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="18" cy="8" r="2" fill="var(--gold, #D4A843)" opacity=".5"/></svg>', label: '\u041F\u043E\u0447\u0442\u0430' },
      { id: 'more',  route: '#/more',    icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="5" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="19" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="8" stroke="var(--gold, #D4A843)" stroke-width="0.75" opacity=".2"/></svg>',  label: '\u0415\u0449\u0451' }
    ];
    const pmEngineer = directors;
    const mapping = {
      'ADMIN': directors,
      'DIRECTOR_GEN': directors, 'DIRECTOR_COMM': directors, 'DIRECTOR_DEV': directors,
      'HEAD_TO': directors, 'HEAD_PM': directors,
      'PM': pmEngineer, 'PROJECT_MANAGER': pmEngineer,
      'ENGINEER': pmEngineer, 'ENGINEER_PTO': pmEngineer, 'CHIEF_ENGINEER': pmEngineer,
      'TO': directors,
      'BUH': directors, 'ACCOUNTANT': directors,
      'HR': directors, 'HR_MANAGER': directors,
      'LAWYER': directors, 'SECRETARY': directors, 'OFFICE_MANAGER': directors,
      'WAREHOUSE': directors, 'PROC': directors
    };
    return mapping[role] || directors;
  }

  // Nav icon mapping for mobile grid
  function getNavIcon(name) {
    const icons = {
      'home':'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
      'dashboard':'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>',
      'schedule':'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
      'birthdays':'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
      'approvals':'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
      'tenders':'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
      'funnel':'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
      'customers':'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="9" y1="6" x2="9" y2="6.01"/><line x1="15" y1="6" x2="15" y2="6.01"/><line x1="9" y1="10" x2="9" y2="10.01"/><line x1="15" y1="10" x2="15" y2="10.01"/><line x1="9" y1="14" x2="15" y2="14"/></svg>',
      'pmworks':'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
      'finances':'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
      'buh':'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
      'office':'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
      'backup':'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>',
      'workers':'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
      'rating':'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
      'travel':'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>',
      'correspondence':'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22 6 12 13 2 6"/></svg>',
      'alerts':'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
      'settings':'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
      'proxies':'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
      'requests':'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
      'kpiworks':'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
    };
    return icons[name] || '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>';
  }

  async function layout(body,{title,motto,rightBadges=[]}={}){
    // Сохраняем позицию скролла меню
    const sidenav = document.querySelector('.sidenav');
    const savedScroll = sidenav ? sidenav.scrollTop : (window.__ASG_NAV_SCROLL__ || 0);
    
    const auth=await AsgardAuth.requireUser();
    const user=auth?auth.user:null;
    const role=user?user.role:"GUEST";
    const cur=AsgardRouter.current();
    let unreadCount=0; /* perf: non-blocking notifications */
    if(user && user.id){
      /* Load notifications in background — don't block page render */
      AsgardDB.byIndex("notifications","user_id", user.id).then(function(nots) {
        unreadCount = (nots||[]).filter(function(n){return !n.is_read;}).length;
        /* Update badge count in sidebar + tabbar */
        var badges = document.querySelectorAll('.notif-badge, .m-tab-badge');
        badges.forEach(function(b) {
          if (unreadCount > 0) {
            b.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
            b.style.display = '';
          } else {
            b.style.display = 'none';
          }
        });
      }).catch(function(){});
    }
// Prevent duplicate/stale global listeners between navigations / logout-login.
try{
  if(window.__ASG_BELL_DOC_CLICK__) document.removeEventListener("click", window.__ASG_BELL_DOC_CLICK__);
  if(window.__ASG_BELL_DOC_ESC__) document.removeEventListener("keydown", window.__ASG_BELL_DOC_ESC__);
  window.__ASG_BELL_DOC_CLICK__ = null;
  window.__ASG_BELL_DOC_ESC__ = null;
}catch(_){}


    const roleAllowed = (need, actual)=>{
      if(actual==="ADMIN") return true;
      if(!Array.isArray(need)) return false;
      if(need.includes(actual)) return true;
      if(need.includes("DIRECTOR") && window.AsgardAuth && AsgardAuth.isDirectorRole && AsgardAuth.isDirectorRole(actual)) return true;
      return false;
    };

    // M1: Получаем пермишены и настройки меню для фильтрации навигации
    const permissions = (window.AsgardAuth && AsgardAuth.getPermissions) ? AsgardAuth.getPermissions() : {};
    const menuSettings = (window.AsgardAuth && AsgardAuth.getMenuSettings) ? AsgardAuth.getMenuSettings() : {};
    const hiddenRoutes = menuSettings.hidden_routes || [];

    // Фильтруем NAV по правам
    const hasCustomPerms = Object.keys(permissions).length > 0;
    const filteredNav = (role==="GUEST") ? [] : NAV.filter(n => {
      // 1. Старая проверка по ролям (обратная совместимость)
      if (!roleAllowed(n.roles, role)) return false;
      // 2. Новая проверка по пермишенам (если поле p задано)
      //    Fallback: если user_permissions пуст — используем только роли
      if (n.p && role !== 'ADMIN' && hasCustomPerms) {
        if (!permissions[n.p] || !permissions[n.p].read) return false;
      }
      // 3. Скрытые пользователем вкладки
      if (hiddenRoutes.includes('#' + n.r)) return false;
      return true;
    });

    // Группируем по g (group id)
    const groupedNav = {};
    for (const n of filteredNav) {
      const gid = n.g || "home";
      if (!groupedNav[gid]) groupedNav[gid] = [];
      groupedNav[gid].push(n);
    }

    // Рендерим группы
    let navHtml = "";
    if (role !== "GUEST") {
      for (const group of NAV_GROUPS) {
        const items = groupedNav[group.id];
        if (!items || items.length === 0) continue;

        const isExpanded = window.AsgardTheme && AsgardTheme.isNavGroupExpanded
          ? AsgardTheme.isNavGroupExpanded(group.id, group.defaultExpanded)
          : group.defaultExpanded;

        const hasActiveItem = items.some(n => cur === n.r);
        const expandedClass = (isExpanded || hasActiveItem) ? "expanded" : "";

        navHtml += `<div class="nav-group ${expandedClass}" data-group="${esc(group.id)}">
          <button class="nav-group-header" type="button" aria-expanded="${isExpanded || hasActiveItem}">
            <span class="nav-group-icon">${group.icon}</span>
            <span class="nav-group-label">${esc(group.label)}</span>
            <span class="nav-group-count">${items.length}</span>
            <span class="nav-group-chevron">▾</span>
          </button>
          <div class="nav-group-items" data-group-label="${esc(group.label)}">
            ${items.map(n => {
              const a = (cur === n.r) ? "active" : "";
              return `<a class="navitem ${a}" href="#${n.r}">
                <div class="ico"><img src="assets/icons/nav/${esc(n.i)}.svg" alt="" loading="lazy"/></div>
                <div class="lbl"><div class="name">${esc(n.l)}</div><div class="desc">${esc(n.d)}</div></div>
              </a>`;
            }).join("")}
          </div>
        </div>`;
      }
    }    const switchCtl = (user && window.AsgardAuth && AsgardAuth.canSwitch) ? AsgardAuth.canSwitch(user) : null;
    let switchHtml = "";
    if(user && switchCtl){
      const cur = user.role;
      const target = (cur===switchCtl.a) ? switchCtl.b : switchCtl.a;
      const rt = (window.AsgardAuth && AsgardAuth.roleTitle) ? AsgardAuth.roleTitle : (x=>x);
      const lbl = `Режим: ${rt(cur)} → ${rt(target)}`;
      switchHtml = `<button class="btn ghost" id="btnSwitchRole" data-target="${esc(target)}">${esc(lbl)}</button>`;
    }

    const authBtns = user
      ? `<div class="pill"><div class="who">${esc(user.name)}</div><div class="role">${esc(role)}</div></div>${switchHtml}<button class="btn red" id="btnLogout">Выйти</button>`
      : `<button class="btn" id="btnLoginGo">Войти</button><button class="btn ghost" id="btnRegGo">Регистрация</button>`;

    const logo = ASSETS_BASE + "img/logo.png";
    const _isMobile = window.innerWidth <= 768 ||
      (window.innerWidth <= 1024 && window.innerHeight <= 500 &&
       window.matchMedia('(orientation: landscape) and (hover: none)').matches);

    // ═══════════════════════════════════════════════════════════════
    // MOBILE V3 — если mobile v3 активна, передаём управление core.js
    // ═══════════════════════════════════════════════════════════════
    const MOBILE_V3_ACTIVE = window.ASGARD_FLAGS?.MOBILE_V3_ENABLED === true;
    if (MOBILE_V3_ACTIVE && _isMobile && window.App && window.Router && window.DS) {
      try { if (window.AsgardSessionGuard) AsgardSessionGuard.destroy(); } catch(e) {}
      window.removeEventListener('hashchange', window.__ASG_MOBILE_HASH__);
      window.removeEventListener('hashchange', window._flyoutHashHandler);
      // App.init() вызывается из core.js на DOMContentLoaded — здесь просто выходим
      console.log('[ASGARD] Mobile v3 active — desktop app.js yielding control');
      return;
    }

    // ═══════════════════════════════════════════════════════════════
    // MOBILE V2 (LEGACY) — полностью отдельный UI при ≤768px
    // ═══════════════════════════════════════════════════════════════
    const mobileV2Routes = new Set(['/welcome','/login','/register','/home','/dashboard','/my-dashboard','/big-screen','/engineer-dashboard','/pre-tenders','/funnel','/tenders','/customers','/customer','/tkp','/calculator','/pm-calcs','/approvals','/bonus-approval','/pm-works','/all-works','/all-estimates','/gantt','/gantt-calcs','/gantt-works','/gantt-objects','/kanban','/tasks','/tasks-admin','/pm-consents','/finances','/invoices','/acts','/buh-registry','/office-expenses','/cash','/cash-admin','/payroll','/payroll-sheet','/self-employed','/one-time-pay','/pass-requests','/procurement','/assembly','/warehouse','/my-equipment','/correspondence','/contracts','/seals','/proxies','/personnel','/employee','/hr-requests','/collections','/permits','/permit-applications','/permit-application-form','/training','/office-schedule','/workers-schedule','/hr-rating','/travel','/birthdays','/messenger','/chat','/mail','/my-mail','/mailbox','/alerts','/meetings','/telegram','/telephony','/mail-settings','/integrations','/mango','/kpi-works','/kpi-money','/to-analytics','/pm-analytics','/object-map','/calendar','/settings','/backup','/sync','/diag','/more','/user-requests','/reminders','/inbox-applications','/mimir','/test','/test-table']);
    if (MOBILE_V2_ENABLED && _isMobile && window.App && window.M && window.DS && mobileV2Routes.has(cur)) {
      try { if (window.AsgardSessionGuard) AsgardSessionGuard.destroy(); } catch(e) {}
      window.removeEventListener('hashchange', window.__ASG_MOBILE_HASH__);
      window.removeEventListener('hashchange', window._flyoutHashHandler);
      await App.init();
      return;
    }
    if (MOBILE_V2_ENABLED && _isMobile && user) {
      const mobileTabs = getMobileTabsForRole(role);
      const curTabGroup = getMobileTabGroup(cur);

      $("#app").innerHTML = `<div class="m-app">
        <header class="m-header">
          ${(['/home','/dashboard','/my-dashboard','/tasks','/kanban','/reminders','/approvals','/my-mail','/chat','/pm-works','/all-works','/more','/welcome','/login'].includes(cur))
            ? '<a class="m-brand" href="#/home"><img src="' + logo + '" alt="АСГАРД"/></a>'
            : '<button class="m-back-btn" id="btnMobileBack" aria-label="Назад"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>'}
          <h1 class="m-title">${esc(title||"")}</h1>
          <div class="m-header-actions">
            ${unreadCount ? `<button class="m-hdr-btn" id="btnMobileNotif" aria-label="\u0423\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u044F" style="position:relative"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg><span class="m-tab-badge" style="top:-4px;right:-4px;position:absolute">${unreadCount}</span></button>` : `<button class="m-hdr-btn" id="btnMobileNotif"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></button>`}
          </div>
        </header>
        <div class="m-content" role="main">
          <div id="layout">${body}</div>
        </div>
        <nav class="m-tabbar" role="navigation" aria-label="\u041E\u0441\u043D\u043E\u0432\u043D\u0430\u044F \u043D\u0430\u0432\u0438\u0433\u0430\u0446\u0438\u044F" id="mTabbar">
          ${mobileTabs.map((t, i) => {
            const tab = `<a class="m-tab ${curTabGroup === t.id ? 'active' : ''}" href="${t.route}" data-tab="${t.id}"><span class="m-tab-icon">${t.icon}</span><span class="m-tab-label">${t.label}</span></a>`;
            return tab;
          }).join('')}
        </nav>
        
      </div>`;

      // Mobile event handlers
      const btnMobileNotif = document.getElementById('btnMobileNotif');
      if (btnMobileNotif) btnMobileNotif.addEventListener('click', () => { location.hash = '#/alerts'; });
      const btnMobileBack = document.getElementById('btnMobileBack');
      if (btnMobileBack) btnMobileBack.addEventListener('click', () => { history.back(); });

      // Update tab bar on hashchange
      if (window.__ASG_MOBILE_HASH__) window.removeEventListener('hashchange', window.__ASG_MOBILE_HASH__);
      window.__ASG_MOBILE_HASH__ = () => {
        const newCur = AsgardRouter.current();
        const newGroup = getMobileTabGroup(newCur);
        // Haptic feedback on navigation
        if (navigator.vibrate) navigator.vibrate(10);
        document.querySelectorAll('.m-tab').forEach(tab => {
          tab.classList.toggle('active', tab.dataset.tab === newGroup);
        });
        // Update chat unread badge
        updateChatTabBadge();
      };
      window.addEventListener('hashchange', window.__ASG_MOBILE_HASH__);

      // v8.8.7c — Smart tab re-tap: if tapping the already-active tab group,
      // navigate to that tab's root route instead of pushing duplicate history
      const tabbar = document.getElementById('mTabbar');
      if (tabbar && !tabbar.dataset.smartTap) {
        tabbar.dataset.smartTap = '1';
        tabbar.addEventListener('click', (e) => {
          const tab = e.target.closest('.m-tab');
          if (!tab) return;
          const tabId = tab.dataset.tab;
          const curRoute = AsgardRouter.current();
          const curGroup = getMobileTabGroup(curRoute);
          if (tabId === curGroup && curRoute !== tab.getAttribute('href').replace('#','')) {
            // User is on a sub-page of this tab group, tapping the tab goes to tab root
            e.preventDefault();
            location.hash = tab.getAttribute('href');
          }
        });
      }

      // v8.1 — Periodic chat badge update
      setInterval(updateChatTabBadge, 10000);
      updateChatTabBadge();

      return;
    }

    // ═══════════════════════════════════════════════════════════════
    // DESKTOP LAYOUT — стандартный UI при >768px
    // ═══════════════════════════════════════════════════════════════
    $("#app").innerHTML = `<div class="app">
      <aside class="sidenav">
        <div class="sidebar-header">
          <a class="brand" href="#/welcome" aria-label="На главную">
            <img src="${logo}" alt="АСГАРД‑СЕРВИС" onerror="this.style.display='none'"/>
            <div class="brand-text">
              <div class="h">АСГАРД</div>
              <div class="s">CRM • ᚠᚢᚦᚨᚱᚲ</div>
            </div>
          </a>
          <!-- sidebar-toggle removed: icon rail is always 60px -->
        </div>
        <nav class="nav">
          ${navHtml || `<div class="help" style="padding:16px">Войдите, чтобы открыть разделы.</div>`}
        </nav>
        <div class="sidefoot">
          ${user ? '<button class="sidebar-search-btn" id="btnSidebarSearch" type="button" aria-label="Поиск" title="Поиск (Ctrl+K)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg></button>' : ''}
          ${authBtns}
          <button class="btn ghost" id="btnBackup" style="display:none">
            <span class="btn-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg></span>
            <span class="btn-text">Экспорт/Импорт</span>
          </button>
          ${user ? '<button class="btn ghost" id="btnNavCustomize" style="display:none"><span class="btn-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></span><span class="btn-text">Настроить меню</span></button>' : ''}
        </div>
      </aside>
      <div class="nav-overlay" id="navOverlay"></div>
      <main class="main">
        <div class="topbar">
          <div class="mnav"><button class="iconbtn" id="btnMenu" aria-label="Меню"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="18" y2="18"/></svg></button></div>
          <div class="title">
            <nav class="breadcrumbs" aria-label="Навигация">
              <a href="#/home">Главная</a>
              ${cur && cur !== '/home' ? `<span class="bc-sep">›</span><span class="bc-current">${esc(title||"")}</span>` : ''}
            </nav>
            <h1 class="page-title">${esc(title||"")}</h1>
          </div>
          <div class="badges">${[
  ...(user ? [
    `<button class="topbar-search" id="btnTopSearch" type="button" title="Поиск (Ctrl+K)"><span class="ts-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg></span><span class="ts-label">Поиск</span><kbd class="ts-kbd">⌘K</kbd></button>`,
    `<button class="bellbtn" id="btnBell" type="button" aria-label="Уведомления">
      <span class="bell"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></span>
      <span class="belltext">Уведомления</span>
      ${unreadCount?`<span class="bellcount">${unreadCount}</span>`:''}
    </button>
    <div class="bellpop" id="bellPop" style="display:none">
      <div class="bellpop-head">
        <div><b>Воронья почта</b></div>
        <button class="xbtn" id="bellClose" type="button" aria-label="Закрыть"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>
      </div>
      <div class="bellpop-list" id="bellList"></div>
      <div class="bellpop-foot">
        <a class="btn" style="padding:6px 10px" href="#/alerts" id="bellAll">Все уведомления</a>
        <button class="btn ghost" style="padding:6px 10px" id="bellMarkAll" type="button">Прочитано</button>
      </div>
    </div>`
  ] : []),
  ...rightBadges.map(b=>`<span class="badge">${esc(b)}</span>`)
].join("")}</div>
        </div>
        <div id="layout">${body}</div>
        <div class="runesep" aria-hidden="true"></div>
        <hr class="hr"/>
        <div class="help">Данные хранятся на сервере. Резервное копирование автоматическое.</div>
        <div class="credit">ᚠᚹ Сей сайт выкован Androsov'ым — да служит АСГАРД-СЕРВИС ᚹᚠ</div>
      </main>

      <!-- Mobile Tab Bar removed: now rendered in mobile layout above -->
    </div>`;


    // Mobile nav (burger) - используем addMobileClick для надёжной работы на мобильных
    const closeNav = ()=>document.body.classList.remove("nav-open");
    const toggleNav = ()=>document.body.classList.toggle("nav-open");
    addMobileClick($("#btnMenu"), toggleNav);
    addMobileClick($("#navOverlay"), closeNav);
    $$(".navitem").forEach(a=>addMobileClick(a, closeNav));
    if(window.__ASG_DOC_ESC_NAV__) document.removeEventListener("keydown", window.__ASG_DOC_ESC_NAV__);
    window.__ASG_DOC_ESC_NAV__ = (e)=>{ if(e.key==="Escape") closeNav(); };
    document.addEventListener("keydown", window.__ASG_DOC_ESC_NAV__);

    // Sidebar toggle — disabled (icon rail is always 60px)
    // const sidebarToggle = $("#btnSidebarToggle");
    // if (sidebarToggle) { ... }

    // ── Flyout navigation: show/hide submenu on hover (desktop) and click (mobile) ──
    // Clean up previous document-level listeners to prevent duplicates across layout() calls
    if (window._flyoutOutsideClick) document.removeEventListener("click", window._flyoutOutsideClick);
    if (window._flyoutEscHandler) document.removeEventListener("keydown", window._flyoutEscHandler);
    if (window._flyoutHashHandler) window.removeEventListener("hashchange", window._flyoutHashHandler);

    (function initFlyoutNav() {
      let currentFlyout = null;
      let hideTimer = null;

      function showFlyout(group) {
        const header = group.querySelector(".nav-group-header");
        const items = group.querySelector(".nav-group-items");
        if (!header || !items) return;

        if (currentFlyout && currentFlyout !== items) {
          currentFlyout.classList.remove("flyout-open");
        }

        const rect = header.getBoundingClientRect();
        const sidebarWidth = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width')) || 60;

        items.style.left = sidebarWidth + "px";
        items.style.top = Math.max(0, rect.top) + "px";

        items.classList.add("flyout-open");

        const flyoutRect = items.getBoundingClientRect();
        if (flyoutRect.bottom > window.innerHeight) {
          items.style.top = Math.max(0, window.innerHeight - flyoutRect.height - 8) + "px";
        }

        currentFlyout = items;
        clearTimeout(hideTimer);
      }

      function hideFlyout(delay) {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
          if (currentFlyout) {
            currentFlyout.classList.remove("flyout-open");
            currentFlyout = null;
          }
        }, delay || 150);
      }

      function cancelHide() {
        clearTimeout(hideTimer);
      }

      $$(".nav-group").forEach(group => {
        const header = group.querySelector(".nav-group-header");
        const items = group.querySelector(".nav-group-items");
        if (!header || !items) return;

        group.dataset.flyoutBound = "1";

        header.addEventListener("mouseenter", () => showFlyout(group));
        header.addEventListener("mouseleave", () => hideFlyout(200));
        items.addEventListener("mouseenter", cancelHide);
        items.addEventListener("mouseleave", () => hideFlyout(150));

        addMobileClick(header, (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (currentFlyout === items && items.classList.contains("flyout-open")) {
            hideFlyout(0);
          } else {
            showFlyout(group);
          }
        });
      });

      // Document-level listeners — stored on window for cleanup on next layout()
      window._flyoutOutsideClick = (e) => {
        if (currentFlyout && !e.target.closest(".nav-group")) hideFlyout(0);
      };
      document.addEventListener("click", window._flyoutOutsideClick);

      window._flyoutEscHandler = (e) => {
        if (e.key === "Escape" && currentFlyout) hideFlyout(0);
      };
      document.addEventListener("keydown", window._flyoutEscHandler);

      window._flyoutHashHandler = () => hideFlyout(0);
      window.addEventListener("hashchange", window._flyoutHashHandler);
    })();

    addMobileClick($("#btnLogout"), ()=>{ if(confirm('Выйти из системы?')){ try{AsgardSessionGuard.destroy();}catch(e){} AsgardAuth.logout(); toast("Выход","Сессия завершена"); location.hash="#/welcome"; } });
    addMobileClick($("#btnLoginGo"), ()=>location.hash="#/login");
    addMobileClick($("#btnRegGo"), ()=>location.hash="#/register");
    addMobileClick($("#btnBackup"), backupModal);

    // Sidebar search button → open global search
    const btnSideSearch = $("#btnSidebarSearch");
    if (btnSideSearch) {
      addMobileClick(btnSideSearch, () => {
        if (window.AsgardSearch && AsgardSearch.open) AsgardSearch.open();
      });
    }

    // Topbar search button → open global search
    addMobileClick($("#btnTopSearch"), () => {
      if (window.AsgardSearch) AsgardSearch.open();
    });

    // M16: Nav customization button
    const btnNavCust = document.getElementById('btnNavCustomize');
    if (btnNavCust && user) {
      addMobileClick(btnNavCust, async () => {
        // Load current nav prefs
        let navPrefs = { hidden: [], order: [] };
        try {
          const np = await AsgardDB.get('settings', 'nav_prefs_' + user.id);
          if (np?.value_json) navPrefs = JSON.parse(np.value_json);
        } catch(e) {}

        const allAllowed = NAV.filter(n => roleAllowed(n.roles, role));
        const hidSet = new Set(navPrefs.hidden || []);

        // Sort by current order
        const ordered = [...allAllowed];
        const oMap = new Map((navPrefs.order || []).map((r, i) => [r, i]));
        ordered.sort((a, b) => {
          const ai = oMap.has(a.r) ? oMap.get(a.r) : 999;
          const bi = oMap.has(b.r) ? oMap.get(b.r) : 999;
          return ai - bi;
        });

        let modalHtml = '<div style="max-height:60vh;overflow-y:auto">';
        modalHtml += '<div class="help" style="margin-bottom:12px">Снимите галочку чтобы скрыть пункт. Перетаскивайте для изменения порядка.</div>';
        modalHtml += '<div id="navCustList">';

        ordered.forEach(n => {
          const checked = !hidSet.has(n.r) ? 'checked' : '';
          modalHtml += '<div class="nav-cust-item" data-route="' + esc(n.r) + '" draggable="true" style="display:flex;align-items:center;gap:10px;padding:12px 16px;border:1px solid var(--line);border-radius:6px;margin-bottom:4px;cursor:grab;background:var(--bg-card)">';
          modalHtml += '<span style="color:var(--text-muted);cursor:grab"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="18" y2="18"/></svg></span>';
          modalHtml += '<input type="checkbox" ' + checked + ' data-route="' + esc(n.r) + '" class="nav-vis-cb"/>';
          modalHtml += '<span style="flex:1;font-size:13px">' + esc(n.l) + '</span>';
          modalHtml += '</div>';
        });

        modalHtml += '</div>';
        modalHtml += '<div style="margin-top:12px;display:flex;gap:8px">';
        modalHtml += '<button class="btn primary" id="navCustSave">Сохранить</button>';
        modalHtml += '<button class="btn ghost" id="navCustReset">Сброс</button>';
        modalHtml += '</div></div>';

        showModal('Настройка меню', modalHtml);

        // Drag & Drop для порядка
        const list = document.getElementById('navCustList');
        if (list) {
          let dragItem = null;
          list.querySelectorAll('.nav-cust-item').forEach(item => {
            item.addEventListener('dragstart', e => { dragItem = item; item.style.opacity = '0.4'; });
            item.addEventListener('dragend', () => { item.style.opacity = '1'; });
            item.addEventListener('dragover', e => { e.preventDefault(); item.style.borderColor = 'var(--gold)'; });
            item.addEventListener('dragleave', () => { item.style.borderColor = 'var(--line)'; });
            item.addEventListener('drop', e => {
              e.preventDefault();
              item.style.borderColor = 'var(--line)';
              if (dragItem && dragItem !== item) {
                const parent = item.parentNode;
                const items = [...parent.children];
                const fromIdx = items.indexOf(dragItem);
                const toIdx = items.indexOf(item);
                if (fromIdx < toIdx) parent.insertBefore(dragItem, item.nextSibling);
                else parent.insertBefore(dragItem, item);
              }
            });
          });
        }

        // Save
        document.getElementById('navCustSave')?.addEventListener('click', async () => {
          const items = document.querySelectorAll('.nav-cust-item');
          const newOrder = [...items].map(i => i.dataset.route);
          const newHidden = [];
          document.querySelectorAll('.nav-vis-cb').forEach(cb => {
            if (!cb.checked) newHidden.push(cb.dataset.route);
          });
          await AsgardDB.put('settings', {
            key: 'nav_prefs_' + user.id,
            value_json: JSON.stringify({ order: newOrder, hidden: newHidden })
          });
          AsgardUI.hideModal();
          toast('Меню', 'Настройки сохранены. Обновите страницу.');
          location.reload();
        });

        // Reset
        document.getElementById('navCustReset')?.addEventListener('click', async () => {
          await AsgardDB.put('settings', {
            key: 'nav_prefs_' + user.id,
            value_json: JSON.stringify({ order: [], hidden: [] })
          });
          AsgardUI.hideModal();
          location.reload();
        });
      });
    }

    addMobileClick($("#btnSwitchRole"), async (e)=>{
      const target = e.currentTarget.getAttribute('data-target');
      const ok = await AsgardAuth.setActiveRole(target);
      if(ok){ toast('Режим', 'Переключено на '+target); location.hash='#/home'; }
      else { toast('Ошибка','Не удалось переключить режим','err'); }
    });

    
    // Theme toggle
    try{
      if($("#btnTheme")){
        const b = $("#btnTheme");
        const ic = $("#themeIcon");
        function syncTheme(){
          if(!b || !document.contains(b)) return;
          const t = (window.AsgardTheme?AsgardTheme.get():"dark")==="light" ? "light" : "dark";
          const msg = (t==="light") ? "Переключить на тёмную тему" : "Переключить на светлую тему";
          b.title = msg;
          try{ b.setAttribute("aria-label", msg); }catch(e){}
        }
        syncTheme();
        addMobileClick(b, ()=>{
          if(window.AsgardTheme) AsgardTheme.toggle();
          syncTheme();
        });
        window.addEventListener("asgard:theme", syncTheme);
      }
    }catch(e){}
    // __ASG_THEME_BTN__
// Bell popover
    if(user && $("#btnBell") && $("#bellPop")){
      const btn = $("#btnBell");
      const pop = $("#bellPop");
      const list = $("#bellList");
      const closeBtn = $("#bellClose");
      const markAllBtn = $("#bellMarkAll");

      async function loadBell(){
        let items=[];
        if(!user || !user.id) return;
        try{ items = await AsgardDB.byIndex("notifications","user_id", user.id); }catch(e){ items=[]; }
        items.sort((a,b)=>String(b.created_at||"").localeCompare(String(a.created_at||"")));
        items = items.slice(0,8);
        if(!items.length){
          list.innerHTML = `<div class="help" style="padding:10px">Нет уведомлений.</div>`;
          return;
        }
        list.innerHTML = items.map(n=>{
          const when = n.created_at ? new Date(n.created_at).toLocaleString("ru-RU") : "—";
          const dot = n.is_read ? `<span class="dot" style="background:var(--t2)"></span>` : `<span class="dot" style="background:var(--amber)"></span>`;
          const link = n.link || n.link_hash || "#/alerts";
          return `<a class="bellitem" href="${esc(link)}" data-nid="${n.id}">
            <div class="belli">${dot}</div>
            <div class="bellc">
              <div class="belltt"><b>${esc(n.title||"Уведомление")}</b></div>
              <div class="bellmsg">${esc(n.message||"")}</div>
              <div class="bellwhen">${esc(when)}</div>
            </div>
          </a>`;
        }).join("");

        // Mark read on click and close popover
        $$(".bellitem").forEach(a=>a.addEventListener("click", async ()=>{
          const id = Number(a.getAttribute("data-nid"));
          try{
            const n = await AsgardDB.get("notifications", id);
            if(n && !n.is_read){ n.is_read=true; await AsgardDB.put("notifications", n); }
          }catch(e){}
          hide();
        }));
      }

      const hide = ()=>{ pop.style.display = "none"; };
      const show = async ()=>{ await loadBell(); pop.style.display = "block"; };
      const toggle = async ()=>{ (pop.style.display==="block") ? hide() : await show(); };

      addMobileClick(btn, async (e)=>{ e.preventDefault(); e.stopPropagation(); await toggle(); });
      addMobileClick(closeBtn, (e)=>{ e.preventDefault(); hide(); });
      document.addEventListener("click", (e)=>{
        if(pop.style.display!=="block") return;
        if(pop.contains(e.target) || btn.contains(e.target)) return;
        hide();
      });
      document.addEventListener("keydown", (e)=>{ if(e.key==="Escape") hide(); });

      addMobileClick(markAllBtn, async ()=>{
        if(!user || !user.id) return;
        let items=[];
        try{ items = await AsgardDB.byIndex("notifications","user_id", user.id); }catch(e){ items=[]; }
        for(const n of items){ if(n && !n.is_read){ n.is_read=true; await AsgardDB.put("notifications", n); } }
        await loadBell();
        toast("Уведомления", "Отмечено как прочитано");
      });
    }
    
    // Восстанавливаем позицию скролла меню
    requestAnimationFrame(()=>{
      const nav = document.querySelector('.sidenav');
      if(nav && savedScroll > 0){
        nav.scrollTop = savedScroll;
      }
      // Сохраняем при скролле
      if(nav){
        nav.addEventListener('scroll', ()=>{
          window.__ASG_NAV_SCROLL__ = nav.scrollTop;
        }, {passive: true});
      }
      // Скроллим вверх только при смене маршрута (не при повторном рендере)
      const newMain = document.querySelector('.main');
      if (newMain && window.__ASG_LAST_ROUTE__ !== window.location.hash) {
        newMain.scrollTop = 0;
      }
      window.__ASG_LAST_ROUTE__ = window.location.hash;
    });
    
    // Сигнал для подсказок Мимира: лейаут готов
    window.dispatchEvent(new CustomEvent('asgard:layout-ready'));
  }

  async function pageWelcome(){
    if (shouldUseMobileV2Entry()) {
      await App.init();
      return;
    }
    // Public landing (no auth). If user is already logged in — show portal / home.
    const auth = AsgardAuth.getAuth();
    if(auth && auth.user){ location.hash = "#/home"; return; }

    // SVG Norse Emblem — Ægishjálmur (Helm of Awe)
    const emblemSVG = `
      <svg viewBox="0 0 300 300" class="norse-emblem" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="emblemGlow">
            <stop offset="0%" stop-color="#fbbf24" stop-opacity="0.2"/>
            <stop offset="70%" stop-color="#fbbf24" stop-opacity="0.05"/>
            <stop offset="100%" stop-color="#fbbf24" stop-opacity="0"/>
          </radialGradient>
          <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#fde68a"/>
            <stop offset="50%" stop-color="#fbbf24"/>
            <stop offset="100%" stop-color="#b45309"/>
          </linearGradient>
          <!-- Stave template for Ægishjálmur -->
          <g id="aegisStave" stroke="url(#goldGrad)" fill="none" stroke-linecap="round">
            <line x1="0" y1="0" x2="0" y2="-88" stroke-width="2.5"/>
            <line x1="0" y1="-88" x2="-11" y2="-74" stroke-width="2"/>
            <line x1="0" y1="-88" x2="11" y2="-74" stroke-width="2"/>
            <line x1="-13" y1="-50" x2="13" y2="-50" stroke-width="2"/>
            <line x1="-13" y1="-50" x2="-19" y2="-62" stroke-width="1.5"/>
            <line x1="13" y1="-50" x2="19" y2="-62" stroke-width="1.5"/>
            <line x1="-8" y1="-30" x2="8" y2="-30" stroke-width="1.5"/>
          </g>
          <path id="runeRingPath" d="M150,150 m-115,0 a115,115 0 1,1 230,0 a115,115 0 1,1 -230,0" fill="none"/>
        </defs>
        <!-- Glow -->
        <circle cx="150" cy="150" r="148" fill="url(#emblemGlow)"/>
        <!-- Outer rings -->
        <circle cx="150" cy="150" r="132" stroke="url(#goldGrad)" stroke-width="1.5" fill="none" opacity="0.3"/>
        <circle cx="150" cy="150" r="127" stroke="url(#goldGrad)" stroke-width="0.5" fill="none" opacity="0.15"/>
        <!-- Rune ring (rotating via CSS) -->
        <g class="rune-ring">
          <text fill="#fbbf24" font-size="11" opacity="0.35" letter-spacing="3">
            <textPath href="#runeRingPath">ᚠ ᚢ ᚦ ᚨ ᚱ ᚲ ᚷ ᚹ ᚺ ᚾ ᛁ ᛃ ᛇ ᛈ ᛉ ᛊ ᛏ ᛒ ᛖ ᛗ ᛚ ᛜ ᛞ ᛟ</textPath>
          </text>
        </g>
        <!-- Ægishjálmur — 8 staves -->
        <use href="#aegisStave" transform="translate(150,150) rotate(0)"/>
        <use href="#aegisStave" transform="translate(150,150) rotate(45)"/>
        <use href="#aegisStave" transform="translate(150,150) rotate(90)"/>
        <use href="#aegisStave" transform="translate(150,150) rotate(135)"/>
        <use href="#aegisStave" transform="translate(150,150) rotate(180)"/>
        <use href="#aegisStave" transform="translate(150,150) rotate(225)"/>
        <use href="#aegisStave" transform="translate(150,150) rotate(270)"/>
        <use href="#aegisStave" transform="translate(150,150) rotate(315)"/>
        <!-- Center -->
        <circle cx="150" cy="150" r="8" fill="url(#goldGrad)" opacity="0.7"/>
        <circle cx="150" cy="150" r="13" stroke="url(#goldGrad)" stroke-width="1.5" fill="none" opacity="0.4"/>
        <!-- Cardinal dots -->
        <circle cx="150" cy="14" r="3" fill="#fbbf24" opacity="0.5"/>
        <circle cx="286" cy="150" r="3" fill="#fbbf24" opacity="0.5"/>
        <circle cx="150" cy="286" r="3" fill="#fbbf24" opacity="0.5"/>
        <circle cx="14" cy="150" r="3" fill="#fbbf24" opacity="0.5"/>
      </svg>
    `;

    // Generate floating rune particles
    const RUNE_CHARS = ['ᚠ','ᚢ','ᚦ','ᚨ','ᚱ','ᚲ','ᚷ','ᚹ','ᚺ','ᚾ','ᛁ','ᛃ','ᛇ','ᛈ','ᛉ','ᛊ','ᛏ','ᛒ','ᛖ','ᛗ','ᛚ','ᛟ'];
    let runeParticlesHTML = '<div class="rune-particles" aria-hidden="true">';
    for (let i = 0; i < 14; i++) {
      const ch = RUNE_CHARS[i % RUNE_CHARS.length];
      const left = 5 + Math.round((i / 14) * 90);
      const delay = (i * 0.7).toFixed(1);
      const dur = (7 + (i % 5) * 1.5).toFixed(1);
      runeParticlesHTML += `<span class="rune-particle" style="left:${left}%;animation-delay:${delay}s;animation-duration:${dur}s">${ch}</span>`;
    }
    runeParticlesHTML += '</div>';

    // Полностраничный Welcome без sidebar
    const appEl = $("#app");
    if (!appEl) {
      console.warn("[pageWelcome] #app element not found, skipping render");
      return;
    }
    appEl.innerHTML = `
      <div class="welcome-page">
        <div class="welcome-bg">
          <div class="aurora aurora-1"></div>
          <div class="aurora aurora-2"></div>
          <div class="aurora aurora-3"></div>
          <div class="welcome-stars"></div>
        </div>
        ${runeParticlesHTML}

        <div class="welcome-content">
          <div class="welcome-header">
            <div class="welcome-logo-wrap">
              <img src="${ASSETS_BASE}img/logo.png" alt="АСГАРД" class="welcome-logo" onerror="this.style.display='none'"/>
              <div class="welcome-logo-ring"></div>
            </div>
            <div class="welcome-brand">
              <div class="welcome-title">АСГАРД‑СЕРВИС</div>
              <div class="welcome-subtitle">Управляй. Контролируй. Побеждай.</div>
              <div class="welcome-runes">ᚠᚢᚦᚨᚱᚲ • CRM SYSTEM</div>
            </div>
          </div>

          <div class="welcome-emblem">
            ${emblemSVG}
          </div>

          <div class="welcome-motto">
            «Сталь и порядок. Пусть каждый день приносит добычу.»
          </div>

          <div class="welcome-desc">
            <span class="welcome-desc-item">&#9670; Порядок в делах</span>
            <span class="welcome-desc-sep">•</span>
            <span class="welcome-desc-item">&#9670; Честный счёт</span>
            <span class="welcome-desc-sep">•</span>
            <span class="welcome-desc-item">&#9670; Быстрые решения</span>
          </div>

          <div class="welcome-actions" id="welcomeActions">
            <button class="btn welcome-btn" id="btnShowLogin" type="button" style="touch-action:manipulation;-webkit-tap-highlight-color:transparent;user-select:none;position:relative;z-index:10">
              <span class="welcome-btn-text">Войти</span>
              <span class="welcome-btn-glow"></span>
            </button>
          </div>

          <!-- Биометрический вход (Phase 3) -->
          <div id="biometricLoginContainer" style="display:none"></div>

          <!-- Форма входа: Шаг 1 — логин/пароль -->
          <div class="welcome-form" id="loginForm" style="display:none">
            <div class="welcome-form-title">Вход в Асгард</div>
            <div class="welcome-form-fields">
              <div class="field">
                <label for="w_login">Логин</label>
                <input id="w_login" name="login" placeholder="Введите логин" autocomplete="username"/>
              </div>
              <div class="field">
                <label for="w_pass">Пароль</label>
                <input id="w_pass" name="password" type="password" placeholder="Введите пароль" autocomplete="current-password"/>
              </div>
              <div class="field-row">
                <label class="checkbox-label">
                  <input id="w_remember" type="checkbox"/>
                  <span>Запомнить меня</span>
                </label>
              </div>
            </div>
            <div class="welcome-form-actions">
              <button class="btn" id="btnDoLogin">Далее</button>
              <button class="btn ghost" id="btnBackToWelcome">Назад</button>
            </div>
          </div>

          <!-- Форма: Шаг 2 — ввод PIN (виртуальная клавиатура) -->
          <div class="welcome-form" id="pinForm" style="display:none">
            <div class="welcome-form-title" style="margin-bottom:4px">Введите PIN</div>
            <div class="welcome-form-subtitle" id="pinUserName" style="margin-bottom:12px"></div>
            <div id="pinKeypadContainer" style="display:flex;flex-direction:column;align-items:center"></div>
            <div style="margin-top:12px;text-align:center">
              <button class="btn ghost" id="btnBackToLogin" style="font-size:13px">Назад к логину</button>
            </div>
          </div>

          <!-- Форма: Первый вход — смена пароля + PIN -->
          <div class="welcome-form" id="setupForm" style="display:none">
            <div class="welcome-form-title">Первый вход</div>
            <div class="welcome-form-subtitle" id="setupUserName"></div>
            <div class="help" style="margin-bottom:16px; color:var(--muted); text-align:center">
              Создайте новый пароль и PIN-код для защиты вашего аккаунта
            </div>
            <div class="welcome-form-fields">
              <div class="field">
                <label for="s_pass">Новый пароль (мин. 6 символов)</label>
                <input id="s_pass" name="new_password" type="password" placeholder="Придумайте надёжный пароль" autocomplete="new-password"/>
              </div>
              <div class="field">
                <label for="s_pass2">Повторите пароль</label>
                <input id="s_pass2" name="confirm_password" type="password" placeholder="Повторите пароль" autocomplete="new-password"/>
              </div>
              <div class="field" style="text-align:center">
                <label style="display:block;margin-bottom:8px">PIN-код (4 цифры)</label>
                <input id="s_pin" type="hidden" value=""/>
                <div id="setupPinKeypadContainer" style="display:flex;flex-direction:column;align-items:center"></div>
              </div>
            </div>
            <div class="welcome-form-actions">
              <button class="btn" id="btnSetupCredentials">Сохранить и войти</button>
            </div>
          </div>

          <div class="welcome-footer">
            <div class="welcome-runes-bottom">ᚠᚹ Сей сайт выкован для АСГАРД‑СЕРВИС ᚹᚠ</div>
          </div>
        </div>
      </div>
    `;

    // State для многошагового входа
    let loginState = { userId: null, userName: null, remember: false };

    // Обработчики
    const loginForm = $("#loginForm");
    const pinForm = $("#pinForm");
    const setupForm = $("#setupForm");
    const welcomeActions = $("#welcomeActions");

    function showLogin(){
      welcomeActions.style.display = "none";
      pinForm.style.display = "none";
      setupForm.style.display = "none";
      loginForm.style.display = "block";
      setTimeout(()=>$("#w_login")?.focus(), 100);

      // Show biometric login button if available (Phase 3)
      (async function(){
        try {
          if (window.AsgardWebAuthn && await AsgardWebAuthn.isSupported() && AsgardWebAuthn.getLastUsername()) {
            var bCont = document.getElementById('biometricLoginContainer');
            if (bCont) { bCont.style.display = 'block'; AsgardWebAuthn.renderLoginButton('biometricLoginContainer'); }
          }
        } catch(e){}
      })();
    }

    var _loginPinKeypad = null;
    function showPin(){
      welcomeActions.style.display = "none";
      loginForm.style.display = "none";
      setupForm.style.display = "none";
      pinForm.style.display = "block";
      $("#pinUserName").textContent = loginState.userName || "";
      /* Виртуальная клавиатура */
      var container = $("#pinKeypadContainer");
      if (container && window.AsgardSessionGuard && AsgardSessionGuard.createPinKeypad) {
        if (_loginPinKeypad) _loginPinKeypad.destroy();
        var hasBio = false;
        try {
          if (window.AsgardWebAuthn && AsgardWebAuthn.isSupported) {
            var r = AsgardWebAuthn.isSupported();
            if (r && typeof r.then === "function") {
              r.then(function(ok){ if(ok && _loginPinKeypad) { /* TODO: refresh with bio */ } });
            } else { hasBio = !!r; }
          }
        } catch(e){}
        _loginPinKeypad = AsgardSessionGuard.createPinKeypad(container, {
          showBiometric: hasBio,
          onComplete: function(pin, ctrl) {
            /* PIN передан напрямую */
            verifyPinVirtual(pin, ctrl);
          },
          onBiometric: function() {
            tryLoginBiometric();
          }
        });
      }
    }

var _setupPinKeypad = null;
    var _setupPinValue = "";
    function showSetup(){
      welcomeActions.style.display = "none";
      loginForm.style.display = "none";
      pinForm.style.display = "none";
      setupForm.style.display = "block";
      $("#setupUserName").textContent = loginState.userName || "";
      setTimeout(function(){ var sp = $("#s_pass"); if(sp) sp.focus(); }, 100);
      /* Virtual PIN keypad for setup */
      var container = $("#setupPinKeypadContainer");
      if (container && window.AsgardSessionGuard && AsgardSessionGuard.createPinKeypad) {
        if (_setupPinKeypad) _setupPinKeypad.destroy();
        _setupPinValue = "";
        _setupPinKeypad = AsgardSessionGuard.createPinKeypad(container, {
          showBiometric: false,
          onComplete: function(pin, ctrl) {
            _setupPinValue = pin;
            var si = $("#s_pin"); if(si) si.value = pin;
            ctrl.success();
            if (_setupPinKeypad) _setupPinKeypad.setHint("PIN установлен");
          }
        });
      }
    }

    function showWelcome(){
      loginForm.style.display = "none";
      pinForm.style.display = "none";
      setupForm.style.display = "none";
      welcomeActions.style.display = "flex";
      loginState = { userId: null, userName: null, remember: false };
    }

    // Используем глобальную addMobileClick для мобильной совместимости
    const btnShowLogin = $("#btnShowLogin");
    if (btnShowLogin) {
      addMobileClick(btnShowLogin, showLogin);
      // Direct onclick as fallback for mobile
      btnShowLogin.onclick = function(e) { e.preventDefault(); showLogin(); };
    }
    addMobileClick($("#btnBackToWelcome"), showWelcome);
    addMobileClick($("#btnBackToLogin"), showLogin);

    // Шаг 1: проверка логина/пароля
    async function doLogin(){
      const login = $("#w_login")?.value?.trim()||"";
      const pass = $("#w_pass")?.value||"";
      const remember = $("#w_remember").checked;
      if(!login || !pass){ toast("Ошибка","Заполните логин и пароль","err"); return; }

      try{
        const result = await AsgardAuth.loginStep1({login, password:pass});
        loginState.userId = result.userId;
        loginState.userName = result.userName;
        loginState.login = login;
        loginState.remember = remember;

        if(result.status === 'ok'){
          // Успешный вход - показываем loading screen
          await showLoadingScreen();
          return;
        } else if(result.status === 'need_setup'){
          // Первый вход - нужно сменить пароль и установить PIN
          showSetup();
        } else if(result.status === 'need_pin'){
          // Обычный вход - нужен PIN
          showPin();
        }
      }catch(e){
        toast("Ошибка", e.message||"Неверный логин или пароль", "err");
      }
    }
    addMobileClick($("#btnDoLogin"), doLogin);

    // Enter для логина
    ["w_login","w_pass"].forEach(id=>{
      const el = $("#"+id);
      if(el) el.addEventListener("keydown", (e)=>{ if(e.key==="Enter") $("#btnDoLogin").click(); });
    });

    // Шаг 2a: ввод PIN (через виртуальную клавиатуру)
    async function verifyPinVirtual(pin, ctrl){
      if(!pin || pin.length !== 4){ if(ctrl) ctrl.error("Введите 4 цифры"); return; }
      try{
        await AsgardAuth.verifyPin({
          userId: loginState.userId,
          pin: pin,
          remember: loginState.remember
        });
        if(ctrl) ctrl.success();
        await showLoadingScreen();
      }catch(e){
        if(ctrl) ctrl.error(e.message||"Неверный PIN");
        else toast("Ошибка", e.message||"Неверный PIN", "err");
      }
    }

    async function tryLoginBiometric(){
      if (!window.AsgardWebAuthn || !AsgardWebAuthn.loginWithBiometric) return;
      try {
        var username = loginState.login || localStorage.getItem("asgard_last_login") || "";
        if (!username) { toast("Ошибка", "Не удалось определить логин", "err"); return; }
        await AsgardWebAuthn.loginWithBiometric(username);
        await showLoadingScreen();
      } catch(e) {
        console.log("[Biometric] suppressed error:", e.message); /* silent — no toast */
        if(_loginPinKeypad) _loginPinKeypad.setHint("Используйте ПИН-код", true);
      }
    }

    // Шаг 2b: первый вход - установка пароля и PIN
    async function setupCredentials(){
      const pass1 = $("#s_pass")?.value||"";
      const pass2 = $("#s_pass2")?.value||"";
      const pin = _setupPinValue || $("#s_pin")?.value || "";

      if(!pass1 || pass1.length < 6){ toast("Ошибка","Пароль минимум 6 символов","err"); return; }
      if(pass1 !== pass2){ toast("Ошибка","Пароли не совпадают","err"); return; }
      if(!pin || !/^\d{4}$/.test(pin)){ toast("Ошибка","PIN должен быть 4 цифры","err"); return; }

      try{
        await AsgardAuth.setupCredentials({
          userId: loginState.userId,
          newPassword: pass1,
          pin: pin
        });
        await showLoadingScreen();
      }catch(e){
        toast("Ошибка", e.message||"Не удалось сохранить", "err");
      }
    }
    addMobileClick($("#btnSetupCredentials"), setupCredentials);
  }

  // Загрузочный экран после успешного входа
  async function showLoadingScreen(){
    hideSplashScreen();
    // v8.8.5a: centered loading overlay on document.body
    var overlay = document.createElement('div');
    overlay.id = 'asgard-loading-overlay';
    overlay.className = 'loading-screen';
    overlay.style.background = 'linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%)';
    var q = LOADING_QUOTES[Math.floor(Math.random() * LOADING_QUOTES.length)];
    overlay.innerHTML = '<div style="text-align:center;padding:20px;">'
      + '<img src="' + ASSETS_BASE + 'img/logo.png" style="width:80px;height:80px;border-radius:20px;margin-bottom:24px;animation:pulse 2s ease-in-out infinite;" onerror="this.style.display=\'none\'">'
      + '<div style="position:relative;width:60px;height:60px;margin:0 auto 24px;">'
      + '<div style="position:absolute;inset:0;border:3px solid rgba(255,255,255,0.1);border-top-color:#e2b340;border-radius:50%;animation:spin 1s linear infinite;"></div>'
      + '<div style="position:absolute;inset:6px;border:3px solid rgba(255,255,255,0.1);border-bottom-color:#4fc3f7;border-radius:50%;animation:spin 1.5s linear infinite reverse;"></div>'
      + '</div>'
      + '<div style="color:rgba(255,255,255,0.7);font-size:13px;max-width:260px;line-height:1.5;font-style:italic;">' + esc(q) + '</div>'
      + '<div style="margin-top:16px;color:rgba(255,255,255,0.3);font-size:11px;letter-spacing:3px;">ASGARD</div>'
      + '</div>';
    document.body.appendChild(overlay);
    if (!document.getElementById('asgard-loading-keyframes')) {
      var st = document.createElement('style');
      st.id = 'asgard-loading-keyframes';
      st.textContent = '@keyframes spin{to{transform:rotate(360deg)}}@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.7;transform:scale(0.95)}}';
      document.head.appendChild(st);
    }
    await new Promise(function(resolve){ setTimeout(resolve, 600); }); /* perf fix: was 2500ms */
    var ov = document.getElementById('asgard-loading-overlay');
    if (ov) ov.remove();
    location.hash = "#/home";
    // Post-login init
    try {
      if (loginState.login && window.AsgardWebAuthn) {
        AsgardWebAuthn.saveLastUsername(loginState.login);
      }
    } catch(e) {}
    try { if (window.AsgardPush) AsgardPush.init(); } catch(e) {}
    try { if (window.AsgardWebAuthn) AsgardWebAuthn.showRegistrationPrompt(); } catch(e) {}
    try { if (window.AsgardSessionGuard) AsgardSessionGuard.init(); } catch(e) { console.warn("[SessionGuard] init error:", e); }
  }

  async function backupModal(){
    const html = `
      <div class="help">Экспорт и импорт работают внутри браузера. Это способ переносить данные между ПК (вручную).</div>
      <hr class="hr"/>
      <div style="display:flex; gap:10px; flex-wrap:wrap">
        <button class="btn" id="btnExport">Скачать экспорт</button>
        <button class="btn ghost" id="btnImport">Импорт</button>
      </div>
      <div class="hr"></div>
      <input type="file" id="importFile" accept="application/json"/>
      <div class="help" style="margin-top:8px">Импорт восстановит данные из резервной копии.</div>
    `;
    showModal("Резервное копирование", html);

    $("#btnExport").addEventListener("click", async ()=>{
      const payload = await AsgardDB.exportJSON();
      const blob = new Blob([JSON.stringify(payload,null,2)], {type:"application/json"});
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href=url;
      a.download=`asgard_crm_backup_${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast("Экспорт","Файл скачан");
    });

    $("#btnImport").addEventListener("click", async ()=>{
      const f=$("#importFile").files[0];
      if(!f){ toast("Импорт","Выберите файл", "err"); return; }
      let payload=null;
      try{ payload=JSON.parse(await f.text()); }catch(_){ toast("Импорт","Некорректный JSON","err"); return; }
      await AsgardDB.importJSON(payload,{wipe:true});
      toast("Импорт","Данные восстановлены. Перезагрузите страницу.");
    });
  }

  function shouldUseMobileV2Entry() {
    // Mobile v3 takes over completely
    if (window.ASGARD_FLAGS?.MOBILE_V3_ENABLED === true) return false;
    const _isMobile = window.innerWidth <= 768 ||
      (window.innerWidth <= 1024 && window.innerHeight <= 500 &&
       window.matchMedia('(orientation: landscape) and (hover: none)').matches);
    return MOBILE_V2_ENABLED && _isMobile && window.App && window.M && window.DS;
  }

  async function pageLogin(){
    if (shouldUseMobileV2Entry()) {
      await App.init();
      return;
    }
    // Redirect to welcome if not logged in - main entry point is now welcome page
    const s = AsgardAuth.getSession();
    if(!s || !s.user_id){
      location.hash = "#/welcome";
      return;
    }
    // If already logged in, go home
    location.hash = "#/home";
  }

  async function pageRegister(){
    if (shouldUseMobileV2Entry()) {
      await App.init();
      return;
    }
    // Redirect to welcome - registration is now on welcome page
    location.hash = "#/welcome";
  }

  async function pageHome(){
    const auth=await AsgardAuth.requireUser();
    if(!auth){ location.hash="#/login"; return; }

    // Делегируем рендер в AsgardCustomDashboard
    if (window.AsgardCustomDashboard) {
      await AsgardCustomDashboard.render({
        layout: async (html, opts) => {
          await layout(html, { title: opts?.title || "Главная" });
        },
        title: "Главная"
      });
    } else {
      // Fallback если custom_dashboard не загружен
      await layout('<div class="panel"><h2>Загрузка дашборда...</h2></div>', { title: "Главная" });
    }
  }

  /* ── Old pageHome removed — delegated to AsgardCustomDashboard ── */
  async function _pageHome_LEGACY_UNUSED(){ /* dead code — kept for reference */
    const user=null;
    const sagas = [
      "План — щит. Факт — сталь.",
      "Срок не ждёт. Действие решает.",
      "Казна любит порядок — держи цифры честными.",
      "Клятва дана — доведи дело до конца.",
      "Время — клинок. Береги его."
    ];
    const saga = sagas[Math.floor(Math.random()*sagas.length)];

    // Viking greetings based on time of day
    const hour = new Date().getHours();
    const vikingGreetings = {
      morning: [ // 6-12
        "Вель комен, {name}! Солнце встаёт — и твоя слава.",
        "Хайль, {name}! Утро несёт новые битвы.",
        "Слава Одину, {name} здесь! Да будет день богатым.",
        "Восход приветствует тебя, {name}! К делам!"
      ],
      day: [ // 12-18
        "Хайль, воин {name}! Путь до Вальгаллы идёт через дела.",
        "Тор благословляет, {name}! Продолжай свой поход.",
        "Дружина сильна, {name} на посту! За работу.",
        "{name}, день в разгаре — время крепить славу!"
      ],
      evening: [ // 18-22
        "Вечер, {name}! Время считать добычу дня.",
        "Хайль, {name}! Сумерки близки, но дела не ждут.",
        "{name}, закат зовёт — заверши начатое.",
        "Валькирии поют, {name}. Заканчивай достойно."
      ],
      night: [ // 22-6
        "Поздний час, {name}! Истинные воины не спят.",
        "Ночь тиха, {name}. Время для мудрых решений.",
        "{name} бодрствует! Один тоже не дремлет.",
        "Звёзды смотрят, {name}. Работай во славу!"
      ]
    };

    let greetingPool;
    if (hour >= 6 && hour < 12) greetingPool = vikingGreetings.morning;
    else if (hour >= 12 && hour < 18) greetingPool = vikingGreetings.day;
    else if (hour >= 18 && hour < 22) greetingPool = vikingGreetings.evening;
    else greetingPool = vikingGreetings.night;

    const vikingGreeting = greetingPool[Math.floor(Math.random() * greetingPool.length)]
      .replace('{name}', user.name || user.login);

    const tenders=await AsgardDB.all("tenders");
    const works=await AsgardDB.all("works");
    const estimates=await AsgardDB.all("estimates");

    const fmtRub = (v) => AsgardUI.money(v) + ' ₽';
    const today = new Date();
    const dayMs = 24*60*60*1000;

    const myTenders = (user.role==="PM") ? tenders.filter(t=>t.responsible_pm_id===user.id) : tenders;
    const myWorks = (user.role==="PM") ? works.filter(w=>w.pm_id===user.id) : works;
    const myEstimates = (user.role==="PM") ? estimates.filter(e=>e.pm_id===user.id) : estimates;

    // PM KPI (по завершённым контрактам)
    let pmProfit=0, pmRevenue=0, pmDone=0, pmProfitPerDay=null;
    if(user.role==="PM"){
      const done = (myWorks||[]).filter(w=>String(w.work_status||"")==="Работы сдали");
      pmDone = done.length;
      for(const w of done){
        const cv = Number(w.contract_value||0);
        const cost = (w.cost_fact!=null && w.cost_fact!=='') ? Number(w.cost_fact||0) : Number(w.cost_plan||0);
        pmRevenue += cv;
        pmProfit += (cv - cost);
      }
      const emp = user.employment_date ? new Date(String(user.employment_date).slice(0,10)) : null;
      if(emp && !isNaN(emp.getTime())){
        const days = Math.max(1, Math.floor((today.getTime()-emp.getTime())/dayMs)+1);
        pmProfitPerDay = pmProfit / days;
      }
    }

    const portalsByRole = {
      TO: [ ['#/tenders','Тендеры'], ['#/calculator','ᚱ Калькулятор'], ['#/tasks','Задачи'], ['#/birthdays','ДР'], ['#/alerts','Уведомления'] ],
      PM: [ ['#/calculator','ᚱ Калькулятор'], ['#/pm-works','Работы'], ['#/payroll','Расчёты'], ['#/tasks','Задачи'], ['#/cash','Касса'], ['#/travel','Жильё/билеты'], ['#/gantt','<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/></svg> Гантт'], ['#/alerts','Уведомления'] ],
      DIRECTOR_COMM: [ ['#/dashboard','<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/></svg> Дашборд'], ['#/calculator','ᚱ Калькулятор'], ['#/big-screen','<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><rect width="20" height="15" x="2" y="7" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/></svg> Big Screen'], ['#/gantt','<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/></svg> Гантт'], ['#/approvals','Согласование'], ['#/payroll','Расчёты'], ['#/tasks-admin','Задачи'], ['#/finances','Деньги'], ['#/birthdays','ДР'] ],
      DIRECTOR_GEN: [ ['#/dashboard','<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/></svg> Дашборд'], ['#/calculator','ᚱ Калькулятор'], ['#/big-screen','<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><rect width="20" height="15" x="2" y="7" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/></svg> Big Screen'], ['#/gantt','<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/></svg> Гантт'], ['#/approvals','Согласование'], ['#/payroll','Расчёты'], ['#/tasks-admin','Задачи'], ['#/finances','Деньги'], ['#/birthdays','ДР'] ],
      DIRECTOR_DEV: [ ['#/dashboard','<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/></svg> Дашборд'], ['#/calculator','ᚱ Калькулятор'], ['#/big-screen','<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><rect width="20" height="15" x="2" y="7" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/></svg> Big Screen'], ['#/gantt','<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/></svg> Гантт'], ['#/approvals','Согласование'], ['#/payroll','Расчёты'], ['#/tasks-admin','Задачи'], ['#/finances','Деньги'], ['#/birthdays','ДР'] ],
      DIRECTOR: [ ['#/dashboard','<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/></svg> Дашборд'], ['#/calculator','ᚱ Калькулятор'], ['#/big-screen','<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><rect width="20" height="15" x="2" y="7" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/></svg> Big Screen'], ['#/gantt','<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/></svg> Гантт'], ['#/approvals','Согласование'], ['#/tasks-admin','Задачи'], ['#/finances','Деньги'], ['#/birthdays','ДР'] ],
      HR: [ ['#/personnel','Персонал'], ['#/tasks','Задачи'], ['#/travel','Жильё/билеты'], ['#/workers-schedule','График'], ['#/hr-rating','Рейтинг'], ['#/alerts','Уведомления'] ],
      PROC: [ ['#/procurement','Заявки'], ['#/birthdays','ДР'], ['#/alerts','Уведомления'] ],
      BUH: [ ['#/buh-registry','Реестр расходов'], ['#/payroll','Расчёты'], ['#/tasks','Задачи'], ['#/finances','Деньги'], ['#/birthdays','ДР'], ['#/alerts','Уведомления'] ],
      OFFICE_MANAGER: [ ['#/office-expenses','Офис.расходы'], ['#/contracts','Договоры'], ['#/customers','Контрагенты'], ['#/tasks','Задачи'], ['#/travel','Жильё/билеты'], ['#/proxies','Доверенности'], ['#/correspondence','Корреспонденция'] ],
      ADMIN: [ ['#/dashboard','<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/></svg> Дашборд'], ['#/calculator','ᚱ Калькулятор'], ['#/big-screen','<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><rect width="20" height="15" x="2" y="7" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/></svg> Big Screen'], ['#/gantt','<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/></svg> Гантт'], ['#/user-requests','Пользователи'], ['#/finances','Деньги'], ['#/settings','Настройки'] ],
      // M15: Новые роли + M16: Big Screen
      HEAD_TO: [ ['#/tenders','Тендеры'], ['#/calculator','ᚱ Калькулятор'], ['#/big-screen','<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><rect width="20" height="15" x="2" y="7" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/></svg> Big Screen'], ['#/to-analytics','Аналитика отдела'], ['#/funnel','Воронка'], ['#/alerts','Уведомления'] ],
      HEAD_PM: [ ['#/all-works','Свод работ'], ['#/calculator','ᚱ Калькулятор'], ['#/big-screen','<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><rect width="20" height="15" x="2" y="7" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/></svg> Big Screen'], ['#/pm-analytics','Аналитика РП'], ['#/approvals','Согласование'], ['#/gantt','<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/></svg> Гантт'] ],
      CHIEF_ENGINEER: [ ['#/warehouse','Склад'], ['#/engineer-dashboard','Аналитика склада'], ['#/my-equipment','Моё оборудование'], ['#/alerts','Уведомления'] ],
      HR_MANAGER: [ ['#/personnel','Персонал'], ['#/calculator','ᚱ Калькулятор'], ['#/travel','Жильё/билеты'], ['#/workers-schedule','График'], ['#/permits','Допуски'], ['#/hr-rating','Рейтинг'] ]
    };
    const portals = portalsByRole[user.role] || portalsByRole.ADMIN;

    const pmBlock = (user.role!=="PM") ? "" : `
      <div class="card">
        <h3>Моя добыча (PM)</h3>
        <div class="help">Считается по завершённым работам (статус «Работы сдали»), прибыль = контракт − (факт если есть иначе план).</div>
        <div class="kpi" style="grid-template-columns:repeat(4,minmax(160px,1fr)); margin-top:10px">
          <div class="k"><div class="t">Завершено</div><div class="v">${pmDone}</div><div class="s">контрактов</div></div>
          <div class="k"><div class="t">Выручка</div><div class="v">${fmtRub(pmRevenue)}</div><div class="s">по контрактам</div></div>
          <div class="k"><div class="t">Прибыль</div><div class="v">${fmtRub(pmProfit)}</div><div class="s">чистая (упрощённо)</div></div>
          <div class="k"><div class="t">Прибыль/день</div><div class="v">${pmProfitPerDay==null?'—':fmtRub(Math.round(pmProfitPerDay))}</div><div class="s">от даты трудоустройства</div></div>
        </div>
      </div>
    `;

    // Виджет баланса кассы для PM
    let cashWidgetHtml = "";
    if (user.role === "PM" && window.AsgardAuth && AsgardAuth.hasPermission && AsgardAuth.hasPermission('cash', 'read')) {
      cashWidgetHtml = `
        <div class="card" id="cashBalanceWidget">
          <h3>Касса — мой баланс</h3>
          <div class="help">Средства на руках по активным авансам</div>
          <div id="cashBalanceData" style="margin-top:10px">
            <div class="text-center"><div class="spinner-border spinner-border-sm"></div> Загрузка...</div>
          </div>
          <div style="margin-top:10px">
            <a href="#/cash" class="btn">Открыть кассу</a>
          </div>
        </div>
      `;
    }

    const body = `
      <div class="panel">
        <div class="row" style="justify-content:space-between; gap:12px; flex-wrap:wrap">
          <div>
            <div class="viking-greeting">
              <span class="rune-icon">ᛟ</span>
              <span class="greeting-text">${esc(vikingGreeting)}</span>
            </div>
            <div class="help" style="margin-top:4px">Роль: <b>${esc(user.role)}</b> · Логин: <b>${esc(user.login)}</b></div>
            <div class="saga-line" style="margin-top:8px"><span class="saga-badge">Сага дня</span> ${esc(saga)}</div>
          </div>
          <div class="row" style="gap:10px; flex-wrap:wrap">
            ${portals.map(p=>`<a class="btn" href="${p[0]}">${esc(p[1])}</a>`).join("")}
          </div>
        </div>
        <hr class="hr"/>
        <div class="kpi" style="grid-template-columns:repeat(4,minmax(160px,1fr))">
          <div class="k"><div class="t">Тендеров</div><div class="v">${tenders.length}</div><div class="s">в базе</div></div>
          <div class="k"><div class="t">Просчётов</div><div class="v">${estimates.length}</div><div class="s">версий</div></div>
          <div class="k"><div class="t">Работ</div><div class="v">${works.length}</div><div class="s">контрактов</div></div>
          <div class="k"><div class="t">Мои объекты</div><div class="v">${(user.role==='PM')?myWorks.length:myTenders.length}</div><div class="s">по роли</div></div>
        </div>
      </div>

      <div class="grid" style="margin-top:14px">
        ${pmBlock}
        ${cashWidgetHtml}

        <!-- Виджет задач от руководства -->
        <div class="card span-6" id="tasksWidget">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px">
            <h3 style="margin:0">Мои задачи</h3>
            <a href="#/tasks" class="btn" style="padding:4px 12px; font-size:12px">Все задачи</a>
          </div>
          <div id="tasksWidgetContent">
            <div class="text-center"><div class="spinner-border spinner-border-sm"></div> Загрузка...</div>
          </div>
        </div>

        <!-- Виджет Todo-список -->
        <div class="card span-6" id="todoWidget">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px">
            <h3 style="margin:0">Мой список дел</h3>
            <a href="#/tasks" class="btn" style="padding:4px 12px; font-size:12px">Открыть</a>
          </div>
          <div id="todoWidgetContent">
            <div class="text-center"><div class="spinner-border spinner-border-sm"></div> Загрузка...</div>
          </div>
        </div>

        <!-- Виджет допусков для HR/TO -->
        <div class="card span-6" id="permitsWidget" style="display:none">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px">
            <h3 style="margin:0">Допуски сотрудников</h3>
            <a href="#/permits" class="btn" style="padding:4px 12px; font-size:12px">Открыть</a>
          </div>
          <div id="permitsWidgetContent">
            <div class="text-center"><div class="spinner-border spinner-border-sm"></div> Загрузка...</div>
          </div>
        </div>

        <!-- Виджет совещаний (Phase 2) -->
        <div class="card span-6" id="meetingsWidget">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px">
            <h3 style="margin:0"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg> Ближайшие совещания</h3>
            <a href="#/meetings" class="btn" style="padding:4px 12px; font-size:12px">Все</a>
          </div>
          <div id="meetingsWidgetContent">
            <div class="text-center"><div class="spinner-border spinner-border-sm"></div> Загрузка...</div>
          </div>
        </div>

        <!-- Виджет телефонии -->
        <div class="card span-3" id="callToggleContainer"></div>
        
        <!-- Виджет сканера чеков для PM -->
        ${user.role === 'PM' ? `
        <div class="card span-3">
          <h3><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg> Быстрый ввод расходов</h3>
          <p class="help">Сканируйте чеки камерой для автоматического добавления расходов по работам</p>
          <button class="btn primary" onclick="AsgardReceiptScanner.openScanner()" style="width:100%;margin-top:10px">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg> Сканировать чек
          </button>
        </div>
        ` : ''}
        
        <div class="card span-6">
          <h3>Порядок и дисциплина</h3>
          <p>Данные хранятся на сервере PostgreSQL.</p>
        </div>
        <div class="card span-6">
          <h3>Маршрут</h3>
          <p>Сроки → просчёт → согласование → контракт → рейтинг дружины. Все ключевые блоки доступны по меню слева.</p>
        </div>
      </div>
    `;
    await layout(body, {title:"Зал Ярла • Меню", rightBadges:[`Роль: ${user.role}`, `Логин: ${user.login}`]});
    
    // Рендерим виджет телефонии после загрузки страницы
    if(window.AsgardMango){
      setTimeout(() => AsgardMango.renderCallToggle('callToggleContainer'), 100);
    }

    // Загружаем баланс кассы для PM
    if (user.role === "PM" && document.getElementById('cashBalanceData')) {
      (async () => {
        try {
          const auth = AsgardAuth.getAuth();
          const resp = await fetch('/api/cash/my-balance', {
            headers: { 'Authorization': 'Bearer ' + (auth?.token || '') }
          });
          if (resp.ok) {
            const data = await resp.json();
            const formatMoney = (v) => AsgardUI.money(v) + ' руб.';
            document.getElementById('cashBalanceData').innerHTML = `
              <div class="kpi" style="grid-template-columns:repeat(2,1fr)">
                <div class="k"><div class="t">На руках</div><div class="v" style="color:${data.balance > 0 ? 'var(--err-t)' : 'var(--ok-t)'}">${formatMoney(data.balance)}</div></div>
                <div class="k"><div class="t">Активных заявок</div><div class="v">${data.active_requests}</div></div>
              </div>
            `;
          } else {
            document.getElementById('cashBalanceData').innerHTML = '<div class="text-muted">Не удалось загрузить</div>';
          }
        } catch (e) {
          document.getElementById('cashBalanceData').innerHTML = '<div class="text-muted">Ошибка загрузки</div>';
        }
      })();
    }

    // Загружаем виджет задач
    if (document.getElementById('tasksWidgetContent') && window.AsgardAuth && AsgardAuth.hasPermission && AsgardAuth.hasPermission('tasks', 'read')) {
      (async () => {
        try {
          const auth = AsgardAuth.getAuth();
          const resp = await fetch('/api/tasks/my', {
            headers: { 'Authorization': 'Bearer ' + (auth?.token || '') }
          });
          if (resp.ok) {
            const tasks = await resp.json();
            const activeTasks = tasks.filter(t => t.status !== 'done').slice(0, 4);
            if (activeTasks.length === 0) {
              document.getElementById('tasksWidgetContent').innerHTML = '<div class="text-muted">Нет активных задач</div>';
            } else {
              const priorityColors = {urgent: 'var(--err-t)', high: 'var(--orange)', normal: 'var(--info)', low: 'var(--t2)'};
              const statusLabels = {new: 'Новая', accepted: 'Принята', in_progress: 'В работе'};
              document.getElementById('tasksWidgetContent').innerHTML = activeTasks.map(t => {
                const deadlineStr = t.deadline ? new Date(t.deadline).toLocaleDateString('ru-RU') : '';
                const isOverdue = t.deadline && new Date(t.deadline) < new Date();
                return `<div style="padding:12px 16px; margin-bottom:8px; background:rgba(42,59,102,.35); border-left:3px solid ${priorityColors[t.priority] || 'var(--info)'}; border-radius:6px">
                  <div style="font-weight:600">${esc(t.title)}</div>
                  <div style="font-size:12px; color:rgba(184,196,231,.85); margin-top:4px">
                    <span style="background:${priorityColors[t.priority] || 'var(--info)'}20; color:${priorityColors[t.priority] || 'var(--info)'}; border:1px solid ${priorityColors[t.priority] || 'var(--info)'}40; padding:2px 6px; border-radius:3px; font-size:10px">${statusLabels[t.status] || t.status}</span>
                    ${deadlineStr ? `<span style="margin-left:8px; ${isOverdue ? 'color:var(--err-t)' : ''}">${deadlineStr}</span>` : ''}
                  </div>
                </div>`;
              }).join('');
            }
          } else {
            document.getElementById('tasksWidgetContent').innerHTML = '<div class="text-muted">Не удалось загрузить</div>';
          }
        } catch (e) {
          document.getElementById('tasksWidgetContent').innerHTML = '<div class="text-muted">Ошибка загрузки</div>';
        }
      })();
    } else if (document.getElementById('tasksWidgetContent')) {
      document.getElementById('tasksWidgetContent').innerHTML = '<div class="text-muted">Нет доступа</div>';
    }

    // Загружаем виджет todo
    if (document.getElementById('todoWidgetContent') && window.AsgardAuth && AsgardAuth.hasPermission && AsgardAuth.hasPermission('todo', 'read')) {
      (async () => {
        try {
          const auth = AsgardAuth.getAuth();
          const resp = await fetch('/api/tasks/todo', {
            headers: { 'Authorization': 'Bearer ' + (auth?.token || '') }
          });
          if (resp.ok) {
            const todos = await resp.json();
            const activeTodos = todos.filter(t => !t.done).slice(0, 5);
            if (activeTodos.length === 0) {
              document.getElementById('todoWidgetContent').innerHTML = '<div class="text-muted">Список дел пуст</div>';
            } else {
              document.getElementById('todoWidgetContent').innerHTML = activeTodos.map(t =>
                `<div style="padding:12px 16px; margin-bottom:6px; background:rgba(42,59,102,.25); border-radius:4px; display:flex; align-items:center; gap:8px">
                  <span style="color:var(--info)">○</span>
                  <span>${esc(t.text)}</span>
                </div>`
              ).join('');
            }
          } else {
            document.getElementById('todoWidgetContent').innerHTML = '<div class="text-muted">Не удалось загрузить</div>';
          }
        } catch (e) {
          document.getElementById('todoWidgetContent').innerHTML = '<div class="text-muted">Ошибка загрузки</div>';
        }
      })();
    } else if (document.getElementById('todoWidgetContent')) {
      document.getElementById('todoWidgetContent').innerHTML = '<div class="text-muted">Нет доступа</div>';
    }

    // Загружаем виджет допусков для HR/TO/ADMIN
    if (document.getElementById('permitsWidget') && window.AsgardAuth && AsgardAuth.hasPermission && AsgardAuth.hasPermission('permits', 'read')) {
      const showWidget = ['HR', 'TO', 'ADMIN'].includes(user.role) || DIRECTOR_ROLES.includes(user.role);
      if (showWidget) {
        document.getElementById('permitsWidget').style.display = 'block';
        (async () => {
          try {
            const auth = AsgardAuth.getAuth();
            const resp = await fetch('/api/permits/stats', {
              headers: { 'Authorization': 'Bearer ' + (auth?.token || '') }
            });
            if (resp.ok) {
              const stats = await resp.json();
              if (stats.expired > 0 || stats.expiring_14 > 0 || stats.expiring_30 > 0) {
                document.getElementById('permitsWidgetContent').innerHTML = `
                  <div class="kpi" style="grid-template-columns:repeat(3,1fr); margin-top:8px">
                    <div class="k"><div class="t">Истекли</div><div class="v" style="color:var(--red)">${stats.expired || 0}</div></div>
                    <div class="k"><div class="t">14 дн.</div><div class="v" style="color:var(--amber)">${stats.expiring_14 || 0}</div></div>
                    <div class="k"><div class="t">30 дн.</div><div class="v" style="color:var(--yellow,var(--amber))">${stats.expiring_30 || 0}</div></div>
                  </div>
                `;
              } else {
                document.getElementById('permitsWidgetContent').innerHTML = '<div class="text-muted" style="color:var(--green)">Все допуски в норме</div>';
              }
            } else {
              document.getElementById('permitsWidgetContent').innerHTML = '<div class="text-muted">Не удалось загрузить</div>';
            }
          } catch (e) {
            document.getElementById('permitsWidgetContent').innerHTML = '<div class="text-muted">Ошибка загрузки</div>';
          }
        })();
      }
    }

    // Загружаем виджет совещаний (Phase 2)
    if (document.getElementById('meetingsWidgetContent') && window.AsgardMeetings) {
      (async () => {
        try {
          const html = await AsgardMeetings.renderWidget();
          document.getElementById('meetingsWidgetContent').innerHTML = html;
        } catch (e) {
          document.getElementById('meetingsWidgetContent').innerHTML = '<div class="text-muted">Ошибка загрузки</div>';
        }
      })();
    }
  }

  async function placeholder(title){
    const auth=await AsgardAuth.requireUser();
    if(!auth){ location.hash="#/login"; return; }
    const body = `<div class="panel">
      <div class="help">Раздел подключён и защищён ролями. Бизнес‑функции будут добавлены в следующем блоке.</div>
      <hr class="hr"/>
      <div class="help">Ближайшее: реестр, карточки, переходы статусов, документы (ссылки), Гантт и аналитика.</div>
    </div>`;
    await layout(body, {title});
  // Export layout as a global for page modules
  window.layout = layout;

  }

  async function boot({startRouter=true}={}){
    // await AsgardSeed.ensureSeed(); // disabled - needs auth
    try{ await AsgardTemplates.ensureDefaultDocsSettings(); }catch(e){}

    AsgardRouter.add("/welcome", pageWelcome, {auth:false});
    AsgardRouter.add("/login", pageLogin, {auth:false});
    AsgardRouter.add("/register", pageRegister, {auth:false});
    AsgardRouter.add("/home", pageHome, {auth:true, roles:ALL_ROLES});
    AsgardRouter.add("/dashboard", ()=>AsgardDashboardPage.render({layout, title:"Дашборд руководителя"}), {auth:true, roles:["ADMIN",...DIRECTOR_ROLES,...HEAD_ROLES]});
    AsgardRouter.add("/calendar", ()=>AsgardCalendarPage.render({layout, title:"Календарь встреч"}), {auth:true, roles:ALL_ROLES});
    AsgardRouter.add("/birthdays", ()=>AsgardBirthdaysPage.render({layout, title:"Дни рождения"}), {auth:true, roles:ALL_ROLES});

    AsgardRouter.add("/contracts", ()=>AsgardContractsPage.render({layout, title:"Реестр договоров"}), {auth:true, roles:["ADMIN","OFFICE_MANAGER","BUH",...DIRECTOR_ROLES]});
    AsgardRouter.add("/seals", ()=>AsgardSealsPage.render({layout, title:"Реестр печатей"}), {auth:true, roles:["ADMIN","OFFICE_MANAGER",...DIRECTOR_ROLES]});
    AsgardRouter.add("/permits", () => {
      // Permissions verified inside AsgardPermitsPage.render() AFTER requireUser() refresh.
      // The early hasPermission() check was using stale localStorage and blocking PM users
      // who have can_read=true in role_presets but haven't refreshed their asgard_permissions yet.
      AsgardPermitsPage.render({layout, title:"Разрешения и допуски"});
    }, {auth:true, roles:["ADMIN","HR","HR_MANAGER","TO","HEAD_TO","PM","CHIEF_ENGINEER",...DIRECTOR_ROLES]});
    AsgardRouter.add("/permit-applications", ()=>AsgardPermitApplications.render({layout, title:"Заявки на оформление разрешений"}), {auth:true, roles:["ADMIN","HR","HR_MANAGER","TO","HEAD_TO",...DIRECTOR_ROLES]});
    AsgardRouter.add("/permit-application-form", ({query})=>AsgardPermitApplications.renderForm({layout, title: query?.id ? "Редактирование заявки" : "Новая заявка", query}), {auth:true, roles:["ADMIN","HR","HR_MANAGER","TO","HEAD_TO",...DIRECTOR_ROLES]});
    AsgardRouter.add("/pre-tenders", ()=>AsgardPreTendersPage.render({layout, title:"Предварительные заявки"}), {auth:true, roles:["ADMIN","TO","HEAD_TO",...DIRECTOR_ROLES]});
    AsgardRouter.add("/funnel", ()=>AsgardFunnelPage.render({layout, title:"Воронка продаж"}), {auth:true, roles:["ADMIN","TO","HEAD_TO",...DIRECTOR_ROLES]});
    AsgardRouter.add("/tenders", ()=>AsgardTendersPage.render({layout, title:"Сага Тендеров"}), {auth:true, roles:["ADMIN","TO","HEAD_TO",...DIRECTOR_ROLES]});
    AsgardRouter.add("/customers", ()=>AsgardCustomersPage.renderList({layout, title:"Карта Контрагентов"}), {auth:true, roles:["ADMIN","TO","HEAD_TO","PM","HEAD_PM","OFFICE_MANAGER",...DIRECTOR_ROLES]});
    AsgardRouter.add("/customer", ({query})=>AsgardCustomersPage.renderCard({layout, title:"Карточка контрагента", query}), {auth:true, roles:["ADMIN","TO","HEAD_TO","PM","HEAD_PM","OFFICE_MANAGER",...DIRECTOR_ROLES]});
    AsgardRouter.add("/pm-calcs", ()=>AsgardPmCalcsPage.render({layout, title:"Карта Похода • Просчёты"}), {auth:true, roles:["ADMIN","PM","HEAD_PM",...DIRECTOR_ROLES]});
    AsgardRouter.add("/calculator", async ()=>{
      await layout('<div id="calculator-page"></div>', {title:"Калькулятор ᚱ"});
      AsgardCalcV2.renderPage(document.getElementById('calculator-page'));
    }, {auth:true, roles:["ADMIN","PM","TO","HEAD_PM","HEAD_TO",...DIRECTOR_ROLES]});
    AsgardRouter.add("/pm-consents", ()=>AsgardPmConsentsPage.render({layout, title:"Согласия РП"}), {auth:true, roles:["ADMIN","PM",...DIRECTOR_ROLES]});
    AsgardRouter.add("/approvals", ()=>AsgardApprovalsPage.render({layout, title:"Согласование"}), {auth:true, roles:["ADMIN","HEAD_PM",...DIRECTOR_ROLES]});
    AsgardRouter.add("/bonus-approval", ()=>AsgardBonusApproval.render({layout, title:"Согласование премий"}), {auth:true, roles:["ADMIN","PM","HEAD_PM",...DIRECTOR_ROLES]});
    AsgardRouter.add("/pm-works", ()=>AsgardPmWorksPage.render({layout, title:"Карта Похода • Работы"}), {auth:true, roles:["ADMIN","PM","HEAD_PM",...DIRECTOR_ROLES]});
    AsgardRouter.add("/all-works", ()=>AsgardAllWorksPage.render({layout, title:"Свод Контрактов"}), {auth:true, roles:["ADMIN","HEAD_PM",...DIRECTOR_ROLES]});
    AsgardRouter.add("/all-estimates", ()=>AsgardAllEstimatesPage.render({layout, title:"Свод Расчётов"}), {auth:true, roles:["ADMIN","BUH","HEAD_PM",...DIRECTOR_ROLES]});
    AsgardRouter.add("/finances", ()=>AsgardFinancesPage.render({layout, title:"Деньги • Аналитика"}), {auth:true, roles:["ADMIN","BUH",...DIRECTOR_ROLES]});
    AsgardRouter.add("/buh-registry", () => {
      if (!AsgardAuth.hasPermission('buh_registry', 'read')) {
        AsgardUI.toast('Нет доступа', 'Недостаточно прав', 'error');
        location.hash = '#/home';
        return;
      }
      AsgardBuhRegistryPage.render({layout, title:"Реестр расходов • BUH"});
    }, {auth:true, roles:["ADMIN","BUH",...DIRECTOR_ROLES]});
    AsgardRouter.add("/office-expenses", ()=>AsgardOfficeExpensesPage.render({layout, title:"Офисные расходы"}), {auth:true, roles:["ADMIN","OFFICE_MANAGER",...DIRECTOR_ROLES]});
    AsgardRouter.add("/correspondence", ()=>AsgardCorrespondencePage.render({layout, title:"Корреспонденция"}), {auth:true, roles:["ADMIN","OFFICE_MANAGER","DIRECTOR_COMM","DIRECTOR_GEN","DIRECTOR_DEV"]});
    AsgardRouter.add("/telephony", ()=>AsgardTelephonyPage.render({layout, title:"Телефония"}), {auth:true, roles:["ADMIN","TO","HEAD_TO","PM","HEAD_PM",...DIRECTOR_ROLES]});
    AsgardRouter.add("/proxies", ()=>AsgardProxiesPage.render({layout, title:"Доверенности"}), {auth:true, roles:["ADMIN","OFFICE_MANAGER",...DIRECTOR_ROLES]});
    AsgardRouter.add("/travel", ()=>AsgardTravelPage.render({layout, title:"Жильё и билеты"}), {auth:true, roles:["ADMIN","OFFICE_MANAGER","HR","HR_MANAGER","PM",...DIRECTOR_ROLES]});
    AsgardRouter.add("/user-requests", ()=>AsgardUserRequestsPage.render({layout, title:"Заявки на регистрацию"}), {auth:true, roles:["ADMIN"]});
    AsgardRouter.add("/analytics", ()=>{ location.hash = "#/kpi-works"; }, {auth:true, roles:["ADMIN",...DIRECTOR_ROLES]});
    AsgardRouter.add("/kpi-works", () => {
      if (!AsgardAuth.hasPermission('analytics', 'read')) {
        AsgardUI.toast('Нет доступа', 'Недостаточно прав', 'error');
        location.hash = '#/home';
        return;
      }
      AsgardKpiWorksPage.render({layout, title:"Аналитика Ярла • Работы"});
    }, {auth:true, roles:["ADMIN",...DIRECTOR_ROLES]});
    AsgardRouter.add("/kpi-money", () => {
      if (!AsgardAuth.hasPermission('analytics', 'read')) {
        AsgardUI.toast('Нет доступа', 'Недостаточно прав', 'error');
        location.hash = '#/home';
        return;
      }
      AsgardKpiMoneyPage.render({layout, title:"Аналитика Ярла • Деньги"});
    }, {auth:true, roles:["ADMIN",...DIRECTOR_ROLES]});
    AsgardRouter.add("/settings", ()=>AsgardSettingsPage.render({layout, title:"Кузница Настроек"}), {auth:true, roles:["ADMIN"]});
    AsgardRouter.add("/telegram", ()=>AsgardTelegram.renderSettings({layout, title:"Telegram"}), {auth:true, roles:["ADMIN"]});
    AsgardRouter.add("/sync", ()=>AsgardSync.renderSettings({layout, title:"PostgreSQL Sync"}), {auth:true, roles:["ADMIN"]});
    AsgardRouter.add("/mango", ()=>AsgardMango.renderSettings({layout, title:"Телефония"}), {auth:true, roles:["ADMIN"]});
    AsgardRouter.add("/chat", ()=>{ location.hash = '#/messenger'; }, {auth:true, roles:ALL_ROLES});
    AsgardRouter.add("/my-dashboard", () => {
      location.hash = "#/home";
    }, {auth:true, roles:["ADMIN","PM","TO","HR","OFFICE_MANAGER","BUH",...DIRECTOR_ROLES,...HEAD_ROLES]});
    AsgardRouter.add("/big-screen", ()=>AsgardBigScreen.render({layout, title:"Big Screen"}), {auth:true, roles:["ADMIN",...DIRECTOR_ROLES,...HEAD_ROLES]});
    AsgardRouter.add("/backup", ()=>AsgardBackupPage.render({layout, title:"Камень Хроник • Резерв"}), {auth:true, roles:["ADMIN"]});
  AsgardRouter.add("/diag", ()=>AsgardDiagPage.render({layout, title:"Диагностика"}), {auth:true, roles:["ADMIN"]});
    AsgardRouter.add("/alerts", ()=>AsgardAlertsPage.render({layout, title:"Уведомления"}), {auth:true, roles:ALL_ROLES});
    AsgardRouter.add("/personnel", () => {
      if (!AsgardAuth.hasPermission('personnel', 'read')) {
        AsgardUI.toast('Нет доступа', 'Недостаточно прав', 'error');
        location.hash = '#/home';
        return;
      }
      AsgardPersonnelPage.render({layout, title:"Дружина • Персонал"});
    }, {auth:true, roles:["ADMIN","HR","HR_MANAGER","PM","HEAD_PM",...DIRECTOR_ROLES]});
    AsgardRouter.add("/hr-rating", ()=>AsgardHrRatingPage.render({layout, title:"Рейтинг Дружины"}), {auth:true, roles:["ADMIN","HR","HR_MANAGER",...DIRECTOR_ROLES]});
    AsgardRouter.add("/employee", () => {
      if (!AsgardAuth.hasPermission('personnel', 'read')) {
        AsgardUI.toast('Нет доступа', 'Недостаточно прав', 'error');
        location.hash = '#/home';
        return;
      }
      AsgardEmployeePage.render({layout, title:"Личное дело"});
    }, {auth:true, roles:["ADMIN","HR","PM","TO",...DIRECTOR_ROLES]});
    AsgardRouter.add("/collections", () => { AsgardEmployeeCollections.render({layout, title:"Подборки Дружины"}); }, {auth:true, roles:["ADMIN","HR","HR_MANAGER",...DIRECTOR_ROLES]});
    AsgardRouter.add("/hr-requests", () => {
      if (!AsgardAuth.hasPermission('hr_requests', 'read')) {
        AsgardUI.toast('Нет доступа', 'Недостаточно прав', 'error');
        location.hash = '#/home';
        return;
      }
      AsgardHrRequestsPage.render({layout, title:"Заявки персонала"});
    }, {auth:true, roles:["ADMIN","HR","HR_MANAGER",...DIRECTOR_ROLES]});
    AsgardRouter.add("/procurement", ()=>AsgardProcurementPage.render({layout, title:"Закупки"}), {auth:true, roles:["ADMIN","PM","HEAD_PM","PROC","BUH","DIRECTOR_GEN","DIRECTOR_COMM","DIRECTOR_DEV"]});
AsgardRouter.add("/assembly", ()=>AsgardAssemblyPage.render({layout, title:"Сбор"}), {auth:true, roles:["ADMIN","PM","HEAD_PM","WAREHOUSE","DIRECTOR_GEN","DIRECTOR_COMM","DIRECTOR_DEV"]});
    AsgardRouter.add("/training", () => { AsgardTrainingPage.render({layout, title:"Обучение"}); }, {auth:true});
  AsgardRouter.add("/workers-schedule", ()=>AsgardStaffSchedulePage.render({layout, title:"График рабочих"}), {auth:true, roles:["ADMIN","HR","HR_MANAGER",...DIRECTOR_ROLES]});
  AsgardRouter.add("/office-schedule", ()=>AsgardOfficeSchedulePage.render({layout, title:"График Дружины • Офис"}), {auth:true, roles:ALL_ROLES});
    AsgardRouter.add("/gantt-calcs", ()=>AsgardGanttFullPage.renderCalcs({layout}), {auth:true, roles:["ADMIN","PM","HEAD_PM",...DIRECTOR_ROLES]});
    AsgardRouter.add("/gantt-works", ()=>AsgardGanttFullPage.renderWorks({layout}), {auth:true, roles:["ADMIN","PM","HEAD_PM",...DIRECTOR_ROLES]});
    AsgardRouter.add("/gantt", ()=>AsgardGanttFullPage.renderCombined({layout}), {auth:true, roles:["ADMIN","PM","HEAD_PM",...DIRECTOR_ROLES]});
    AsgardRouter.add("/gantt-objects", ()=>AsgardGanttFullPage.renderCombined({layout}), {auth:true, roles:["ADMIN","PM","HEAD_PM",...DIRECTOR_ROLES]});
    
    // Акты и счета
    AsgardRouter.add("/acts", ()=>AsgardActsPage.render({layout, title:"Акты выполненных работ"}), {auth:true, roles:["ADMIN","PM","BUH",...DIRECTOR_ROLES]});
    AsgardRouter.add("/invoices", ()=>AsgardInvoicesPage.render({layout, title:"Счета и оплаты"}), {auth:true, roles:["ADMIN","PM","BUH",...DIRECTOR_ROLES]});
    AsgardRouter.add("/reminders", ()=>AsgardReminders.render({layout, title:"Напоминания"}), {auth:true, roles:ALL_ROLES});
    AsgardRouter.add("/warehouse", ()=>AsgardEquipment.render({layout, title:"Склад ТМЦ"}), {auth:true, roles:ALL_ROLES});
    AsgardRouter.add("/my-equipment", ()=>AsgardMyEquipment.render({layout, title:"Моё оборудование"}), {auth:true, roles:["PM","HEAD_PM","CHIEF_ENGINEER",...DIRECTOR_ROLES,"ADMIN"]});

    // Касса (M2)
    AsgardRouter.add("/cash", async ()=>{
      if (!AsgardAuth.hasPermission('cash', 'read')) {
        AsgardUI.toast('Нет доступа', 'Недостаточно прав', 'error');
        location.hash = '#/home';
        return;
      }
      await layout('<div id="cash-page"></div>', {title:"Касса"});
      AsgardCashPage.render(document.getElementById('cash-page'));
    }, {auth:true, roles:["ADMIN","PM",...DIRECTOR_ROLES]});
    AsgardRouter.add("/cash-admin", async ()=>{
      if (!AsgardAuth.hasPermission('cash_admin', 'read')) {
        AsgardUI.toast('Нет доступа', 'Недостаточно прав', 'error');
        location.hash = '#/home';
        return;
      }
      await layout('<div id="cash-admin-page"></div>', {title:"Касса (управление)"});
      AsgardCashAdminPage.render(document.getElementById('cash-admin-page'));
    }, {auth:true, roles:["ADMIN","BUH",...DIRECTOR_ROLES]});

    AsgardRouter.add("/approval-payment", async ()=>{
      await layout('<div id="approval-payment-page" data-page="approval-payment"></div>', {title:"Очередь оплаты"});
      AsgardApprovalPaymentPage.render(document.getElementById('approval-payment-page'));
    }, {auth:true, roles:["ADMIN","BUH",...DIRECTOR_ROLES]});

    AsgardRouter.add("/payroll", ()=>AsgardPayrollPage.render({layout, title:"Расчёты с рабочими"}), {auth:true, roles:["ADMIN","PM","HEAD_PM","BUH",...DIRECTOR_ROLES]});
    AsgardRouter.add("/payroll-sheet", ({query})=>AsgardPayrollPage.renderSheet({layout, title:"Ведомость", query}), {auth:true, roles:["ADMIN","PM","HEAD_PM","BUH",...DIRECTOR_ROLES]});
    AsgardRouter.add("/self-employed", ()=>AsgardPayrollPage.renderSelfEmployed({layout, title:"Самозанятые"}), {auth:true, roles:["ADMIN","BUH",...DIRECTOR_ROLES]});
    AsgardRouter.add("/one-time-pay", ()=>AsgardPayrollPage.renderOneTimePay({layout, title:"Разовые оплаты"}), {auth:true, roles:["ADMIN","PM","HEAD_PM","BUH",...DIRECTOR_ROLES]});

    // Задачи (M3)
    AsgardRouter.add("/tasks", async ()=>{
      if (!AsgardAuth.hasPermission('tasks', 'read')) {
        AsgardUI.toast('Нет доступа', 'Недостаточно прав', 'error');
        location.hash = '#/home';
        return;
      }
      await layout('<div id="tasks-page"></div>', {title:"Мои задачи"});
      AsgardTasksPage.render(document.getElementById('tasks-page'));
    }, {auth:true, roles:ALL_ROLES});
    AsgardRouter.add("/tasks-admin", async ()=>{
      if (!AsgardAuth.hasPermission('tasks_admin', 'read')) {
        AsgardUI.toast('Нет доступа', 'Недостаточно прав', 'error');
        location.hash = '#/home';
        return;
      }
      await layout('<div id="tasks-admin-page"></div>', {title:"Управление задачами"});
      AsgardTasksAdminPage.render(document.getElementById('tasks-admin-page'));
    }, {auth:true, roles:["ADMIN",...DIRECTOR_ROLES]});

    // ── Phase 2: Kanban, Chat Groups, Meetings ──
    AsgardRouter.add("/kanban", async ()=>{
      if (!AsgardAuth.hasPermission('kanban', 'read')) {
        AsgardUI.toast('Нет доступа', 'Недостаточно прав', 'error');
        location.hash = '#/home';
        return;
      }
      await AsgardKanban.render({layout});
    }, {auth:true, roles:ALL_ROLES});

    // Unified Messenger (both direct + group chats)
    AsgardRouter.add("/messenger", async ()=>{
      await AsgardChatGroups.render({layout});
    }, {auth:true, roles:ALL_ROLES});
    // Backward compatibility aliases
    AsgardRouter.add("/chat-groups", async ()=>{
      location.hash = '#/messenger';
    }, {auth:true, roles:ALL_ROLES});
    AsgardRouter.add("/chat", async ()=>{
      location.hash = '#/messenger';
    }, {auth:true, roles:ALL_ROLES});

    AsgardRouter.add("/meetings", async ()=>{
      if (!AsgardAuth.hasPermission('meetings', 'read')) {
        AsgardUI.toast('Нет доступа', 'Недостаточно прав', 'error');
        location.hash = '#/home';
        return;
      }
      await AsgardMeetings.render({layout});
    }, {auth:true, roles:ALL_ROLES});

    // M15: Аналитика для руководителей отделов
    AsgardRouter.add("/to-analytics", ()=>AsgardTOAnalytics.render({layout, title:"Хроники Тендерного Отдела"}), {auth:true, roles:["ADMIN","HEAD_TO",...DIRECTOR_ROLES]});
    AsgardRouter.add("/pm-analytics", ()=>AsgardPMAnalytics.render({layout, title:"Хроники Руководителей Проектов"}), {auth:true, roles:["ADMIN","HEAD_PM",...DIRECTOR_ROLES]});
    AsgardRouter.add("/engineer-dashboard", ()=>AsgardEngineerDashboard.render({layout, title:"Кузница Инженера"}), {auth:true, roles:["ADMIN","CHIEF_ENGINEER"]});
    AsgardRouter.add("/object-map", ()=>AsgardObjectMap.render({layout, title:"Карта объектов"}), {auth:true, roles:["ADMIN",...DIRECTOR_ROLES,...HEAD_ROLES]});

    // Фаза 8: Почта
    AsgardRouter.add("/mailbox", ()=>AsgardMailboxPage.render({layout, title:"Почтовый ящик"}), {auth:true, roles:["ADMIN","DIRECTOR_GEN","DIRECTOR_COMM","DIRECTOR_DEV","HEAD_TO"]});
    AsgardRouter.add("/my-mail", ()=>AsgardMyMailPage.render({layout, title:"Моя почта"}), {auth:true});
    AsgardRouter.add("/mail-settings", ()=>AsgardMailSettingsPage.render({layout, title:"Настройки почты"}), {auth:true, roles:["ADMIN","DIRECTOR_GEN"]});

    // Фаза 9: AI входящие заявки
    AsgardRouter.add("/inbox-applications", ()=>AsgardInboxApplicationsPage.render({layout, title:"Входящие заявки (AI)"}), {auth:true, roles:["ADMIN","DIRECTOR_GEN","DIRECTOR_COMM","DIRECTOR_DEV","HEAD_TO"]});

    // ── Phase: TKP, Pass Requests, TMC ──
    AsgardRouter.add("/tkp", ()=>AsgardTkpPage.render({layout, title:"ТКП — Коммерческие предложения"}), {auth:true, roles:["ADMIN","PM","HEAD_PM","TO","HEAD_TO",...DIRECTOR_ROLES]});
    AsgardRouter.add("/pass-requests", ()=>AsgardPassRequestsPage.render({layout, title:"Заявки на пропуск"}), {auth:true, roles:["ADMIN","PM","HEAD_PM","TO","HEAD_TO","HR","HR_MANAGER",...DIRECTOR_ROLES]});

    // Фаза 10: Интеграции (Банк/1С, Площадки, ERP)
    AsgardRouter.add("/integrations", ()=>AsgardIntegrationsPage.render({layout, title:"Интеграции"}), {auth:true, roles:["ADMIN","BUH","DIRECTOR_GEN","DIRECTOR_COMM","DIRECTOR_DEV","HEAD_TO","TO"]});
    AsgardRouter.add("/mimir", async ()=>{
      location.hash = "#/home";
    }, {auth:true, roles:ALL_ROLES});

    // Mobile "More" screen — new m-* design
    AsgardRouter.add("/more", async () => {
      if (!MOBILE_V2_ENABLED) {
        location.hash = "#/home";
        return;
      }
      const auth = await AsgardAuth.requireUser();
      const moreUser = auth ? auth.user : null;
      const moreRole = moreUser ? moreUser.role : "GUEST";
      const userNav = NAV.filter(n => n.roles.includes(moreRole) || moreRole === "ADMIN");
      const grouped = {};
      for (const group of NAV_GROUPS) {
        const items = userNav.filter(n => n.g === group.id);
        if (items.length > 0) grouped[group.id] = { ...group, items };
      }

      const roleTitle = (window.AsgardAuth && AsgardAuth.roleTitle) ? AsgardAuth.roleTitle(moreRole) : moreRole;

      const moreBody = `
        <!-- PREMIUM_MORE_MENU -->
        <style>
          .m-more-page { padding:0 4px; }
          .m-premium-card {
            background:linear-gradient(135deg, rgba(30,40,70,.95), rgba(20,30,55,.95));
            border-radius:20px; padding:24px 20px; margin-bottom:20px;
            border:1px solid rgba(212,168,67,.15);
            box-shadow:0 8px 32px rgba(0,0,0,.3), inset 0 1px 0 rgba(255,255,255,.05);
            position:relative; overflow:hidden;
          }
          .m-premium-card::before {
            content:''; position:absolute; top:0; left:0; right:0; height:3px;
            background:linear-gradient(90deg, var(--gold), var(--red), var(--gold));
            opacity:.7;
          }
          .m-premium-card::after {
            content:'ᚦ'; position:absolute; right:20px; top:50%; transform:translateY(-50%);
            font-size:64px; opacity:.04; color:var(--gold); pointer-events:none;
          }
          .m-p-user-row { display:flex; align-items:center; gap:16px; }
          .m-p-avatar {
            width:56px; height:56px; border-radius:50%;
            background:linear-gradient(135deg, var(--gold), var(--red));
            display:flex; align-items:center; justify-content:center;
            font-size:24px; font-weight:900; color:#fff;
            box-shadow:0 4px 16px rgba(212,168,67,.35);
            flex-shrink:0; position:relative;
          }
          .m-p-avatar::after {
            content:''; position:absolute; inset:-3px; border-radius:50%;
            border:2px solid rgba(212,168,67,.25);
          }
          .m-p-info { flex:1; min-width:0; }
          .m-p-name {
            font-size:18px; font-weight:700; color:var(--t1);
            white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
          }
          .m-p-role {
            font-size:12px; color:var(--gold); font-weight:600; margin-top:3px;
            letter-spacing:0.03em;
          }
          .m-p-actions { display:flex; gap:8px; margin-top:16px; }
          .m-p-action {
            flex:1; display:flex; flex-direction:column; align-items:center; gap:4px;
            padding:10px 8px; background:rgba(255,255,255,.04);
            border-radius:12px; border:1px solid rgba(255,255,255,.06);
            text-decoration:none; color:var(--t2); font-size:11px; font-weight:600;
            transition:all .2s ease;
          }
          .m-p-action:active { background:rgba(212,168,67,.1); transform:scale(0.96); }
          .m-p-action-icon { font-size:20px; }

          .m-sec { margin-bottom:16px; }
          .m-sec-title {
            font-size:10px; text-transform:uppercase; letter-spacing:2px;
            color:var(--gold); font-weight:800; padding:0 4px 10px;
          }
          .m-sec-list {
            background:var(--bg2); border-radius:16px;
            border:1px solid var(--brd); overflow:hidden;
          }
          .m-sec-item {
            display:flex; align-items:center; gap:14px;
            padding:15px 16px; color:var(--t1); text-decoration:none;
            border-bottom:1px solid rgba(255,255,255,.04);
            transition:all .15s ease; -webkit-tap-highlight-color:transparent;
          }
          .m-sec-item:last-child { border-bottom:none; }
          .m-sec-item:active { background:rgba(212,168,67,.06); }
          .m-sec-icon {
            width:38px; height:38px; border-radius:11px;
            background:rgba(255,255,255,.04); display:flex;
            align-items:center; justify-content:center; font-size:18px;
            flex-shrink:0; transition:all .2s ease;
          }
          .m-sec-item:active .m-sec-icon { background:rgba(212,168,67,.12); }
          .m-sec-label { flex:1; font-size:15px; font-weight:500; }
          .m-sec-arrow { color:var(--t3); font-size:18px; font-weight:300; }

          .m-logout-btn {
            width:100%; min-height:48px; border-radius:14px;
            border:1.5px solid rgba(239,68,68,.3); background:rgba(239,68,68,.06);
            color:var(--err-t); font-size:15px; font-weight:700;
            cursor:pointer; transition:all .2s ease;
            display:flex; align-items:center; justify-content:center; gap:8px;
          }
          .m-logout-btn:active { background:rgba(239,68,68,.15); transform:scale(0.98); }

          @keyframes m-menu-fade {
            from { opacity:0; transform:translateY(6px); }
            to { opacity:1; transform:translateY(0); }
          }
          .m-sec { animation:m-menu-fade .25s ease-out; }
          .m-sec:nth-child(2) { animation-delay:.05s; }
          .m-sec:nth-child(3) { animation-delay:.1s; }
          .m-sec:nth-child(4) { animation-delay:.15s; }
          .m-sec:nth-child(5) { animation-delay:.2s; }
        </style>
        <div class="m-more-page">
          <div class="m-premium-card">
            <div class="m-p-user-row">
              <div class="m-p-avatar">${(moreUser?.name || 'U')[0].toUpperCase()}</div>
              <div class="m-p-info">
                <div class="m-p-name">${esc(moreUser?.name || 'Пользователь')}</div>
                <div class="m-p-role">${esc(roleTitle)}</div>
              </div>
            </div>
            <div class="m-p-actions">
              <a href="#/alerts" class="m-p-action">
                <span class="m-p-action-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></span>
                <span>Уведомления</span>
              </a>

              <a href="#/settings" class="m-p-action">
                <span class="m-p-action-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></span>
                <span>Настройки</span>
              </a>
              <a href="#/telegram" class="m-p-action">
                <span class="m-p-action-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></span>
                <span>Telegram</span>
              </a>
            </div>
          </div>

          ${Object.values(grouped).map(g => `
            <div class="m-sec">
              <div class="m-sec-title">${g.icon} ${g.label}</div>
              <div class="m-sec-list">
                ${g.items.map(n => `
                  <a href="#${n.r}" class="m-sec-item">
                    <span class="m-sec-icon">${getNavIcon(n.i)}</span>
                    <span class="m-sec-label">${esc(n.l)}</span>
                    <span class="m-sec-arrow">›</span>
                  </a>
                `).join('')}
              </div>
            </div>
          `).join('')}

          <div class="m-sec" style="padding-top:4px">
            <button class="m-logout-btn" id="btnLogoutMob"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg> Выйти из системы</button>
          </div>
        </div>`;

      await layout(moreBody, { title: "Ещё" });

      const btnThemeMob = document.getElementById('btnThemeMob');
      if (btnThemeMob) {
        btnThemeMob.addEventListener('click', () => {
          const html = document.documentElement;
          const curTheme = html.getAttribute('data-theme');
          html.setAttribute('data-theme', curTheme === 'light' ? 'dark' : 'light');
          localStorage.setItem('asg_theme', curTheme === 'light' ? 'dark' : 'light');
        });
      }

      const btnLogoutMob = document.getElementById('btnLogoutMob');
      if (btnLogoutMob) {
        btnLogoutMob.addEventListener('click', () => {
          localStorage.removeItem('asgard_token');
          location.hash = '#/login';
          location.reload();
        });
      }
    }, { auth: true, roles: ALL_ROLES });

    // TKP Follow-up: проверка напоминаний при старте (только если авторизован)
    if(window.AsgardTkpFollowup && localStorage.getItem('asgard_token')){
      try {
        AsgardTkpFollowup.checkAndCreateReminders().catch(e => console.warn('TKP Followup check error:', e));
      } catch(e){ console.warn('TKP Followup init error:', e); }
    }

    // SSE: подключение для real-time обновлений
    initGlobalSSE();

    if(startRouter){
      // Mobile v3 — НЕ запускаем десктопный роутер на мобилке, чтобы не конфликтовал с mobile Router
      const _mob3 = window.ASGARD_FLAGS?.MOBILE_V3_ENABLED === true;
      const _mobDevice = window.innerWidth <= 768 ||
        (window.innerWidth <= 1024 && window.innerHeight <= 500 &&
         window.matchMedia('(orientation: landscape) and (hover: none)').matches);
      if (_mob3 && _mobDevice && window.App && window.Router && window.DS) {
        console.log('[ASGARD] Mobile v3 active — desktop router not starting');
        setTimeout(hideSplashScreen, 300);
      } else {
        if(!location.hash) location.hash="#/welcome";
        /* Wave 4: hideSplashScreen on welcome page (not logged in) */
        if (!AsgardAuth.getAuth() || !AsgardAuth.getAuth().user) {
          setTimeout(hideSplashScreen, 500);
        }
        AsgardRouter.start();
        /* Session Guard — инициализация для уже залогиненных */
        try {
          if (window.AsgardSessionGuard) {
            var _a = AsgardAuth.getAuth();
            if (_a && _a.user) AsgardSessionGuard.init();
          }
        } catch(e) {}
        /* Wave 4: hide splash after session guard init (guard overlay will show on top if locked) */
        setTimeout(hideSplashScreen, 300);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // SSE — Server-Sent Events для real-time уведомлений
  // ═══════════════════════════════════════════════════════════════
  let _sseSource = null;

  function initGlobalSSE() {
    try {
      const token = localStorage.getItem('asgard_token');
      if (!token || _sseSource) return;

      _sseSource = new EventSource('/api/sse/stream?token=' + encodeURIComponent(token));
      window._asgardSSE = _sseSource;

      // Глобальные уведомления о тендерах
      _sseSource.addEventListener('tender:new_assignment', (e) => {
        try {
          const data = JSON.parse(e.data);
          toast('Тендер назначен', `Вам назначен тендер от ${data.customer_name || 'заказчика'}`);
        } catch(_) {}
      });

      _sseSource.addEventListener('tender:new_estimation', (e) => {
        try {
          const data = JSON.parse(e.data);
          toast('Новый просчёт', `Тендер #${data.tender_id} — ${data.customer_name || ''}`);
        } catch(_) {}
      });

      _sseSource.addEventListener('tender:status_changed', (e) => {
        try {
          const data = JSON.parse(e.data);
          toast('Статус тендера', `${data.customer_name || ''}: ${data.old_status} → ${data.new_status}`);
        } catch(_) {}
      });

// Телефония — входящий звонок
      _sseSource.addEventListener("call:incoming", (e) => {
        try {
          const data = JSON.parse(e.data);
          if (window.AsgardTelephonyPopup) window.AsgardTelephonyPopup.showIncoming(data);
        } catch(_) {}
      });

      _sseSource.addEventListener("call:connected", (e) => {
        try {
          const data = JSON.parse(e.data);
          if (window.AsgardTelephonyPopup) window.AsgardTelephonyPopup.showConnected(data);
        } catch(_) {}
      });

      _sseSource.addEventListener("call:ended", (e) => {
        try {
          if (window.AsgardTelephonyPopup) window.AsgardTelephonyPopup.hide();
        } catch(_) {}
_sseSource.addEventListener("call:missed", (e) => {        try {          if (window.AsgardTelephonyPopup) window.AsgardTelephonyPopup.hide();        } catch(_) {}      });

      _sseSource.addEventListener("call:agi_event", (e) => {
        try {
          const data = JSON.parse(e.data);
          if (window.AsgardTelephonyPopup && window.AsgardTelephonyPopup.handleAgiEvent) {
            window.AsgardTelephonyPopup.handleAgiEvent(data);
          }
        } catch(_) {}
      });
      });

      _sseSource.addEventListener('error', () => {
        if (_sseSource) { _sseSource.close(); _sseSource = null; }
        setTimeout(initGlobalSSE, 10000);
      });
    } catch(e) {
      console.warn('[SSE] Global init error:', e);
    }
  }

  // v8.0.0 — Push notification deep linking
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', function(e) {
      if (e.data && e.data.type === 'NOTIFICATION_CLICK' && e.data.url) {
        var url = e.data.url;
        // If it's a hash route, navigate
        if (url.startsWith('#/') || url.startsWith('/#/')) {
          location.hash = url.replace(/^\/#/, '#');
        } else if (url.startsWith('/')) {
          location.hash = '#' + url;
        }
      }
    });
  }

  // Expose boot for self-test harness
  window.AsgardApp = window.AsgardApp || {};
  window.AsgardApp.boot = boot;

  if(window.ASGARD_SELFTEST) return;

  boot({startRouter:true}).catch(e=>{
    console.error(e);
    toast("Ошибка запуска", e.message||String(e), "err", 7000);
    $("#app").innerHTML = `<div style="padding:18px;color:#fff">Ошибка запуска: ${esc(e.message||e)}</div>`;
  });

  // v8.4.0 — Yandex-style offline/online indicator
  (function() {
    var offDiv = document.createElement('div');
    offDiv.id = 'offlineIndicator';
    offDiv.className = 'm-offline-bar';
    offDiv.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-3px"><line x1="1" x2="23" y1="1" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.56 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" x2="12.01" y1="20" y2="20"/></svg> Нет подключения к интернету';
    offDiv.style.display = 'none';
    document.body.appendChild(offDiv);

    function updateOnlineStatus() {
      if (!navigator.onLine) {
        offDiv.style.display = 'flex';
        offDiv.classList.add('show');
      } else {
        offDiv.classList.remove('show');
        setTimeout(function() { offDiv.style.display = 'none'; }, 400);
        // Show brief "back online" toast
        if (window.AsgardMobileUI && AsgardMobileUI.mToast) {
          AsgardMobileUI.mToast('Подключение восстановлено', 'ok');
        }
      }
    }
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    // Check on load
    if (!navigator.onLine) updateOnlineStatus();
  })();

})();
