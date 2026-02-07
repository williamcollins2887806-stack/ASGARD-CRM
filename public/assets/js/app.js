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
  const OFFICE_ROLES = ["TO","PM","HR","BUH","OFFICE_MANAGER","WAREHOUSE",...DIRECTOR_ROLES,"ADMIN"];
  const ALL_ROLES = [...OFFICE_ROLES,"PROC"];


  window.__ASG_SHARED_TABLE_CSS__ = `
<style>
  table.asg{width:100%; border-collapse:separate; border-spacing:0 10px;}
  table.asg th{font-size:11px; color:rgba(184,196,231,.92); font-weight:800; text-align:left; padding:0 10px;}
  table.asg td{padding:10px; background:rgba(13,20,40,.40); border:1px solid rgba(42,59,102,.85); vertical-align:top}
  table.asg tr td:first-child{border-top-left-radius:14px;border-bottom-left-radius:14px;}
  table.asg tr td:last-child{border-top-right-radius:14px;border-bottom-right-radius:14px;}
  .tools{display:flex; gap:10px; flex-wrap:wrap; align-items:end}
  .tools .field{min-width:220px}
  .kpi{display:grid; grid-template-columns:repeat(6,minmax(140px,1fr)); gap:12px}
  .kpi .k{background:rgba(13,20,40,.40); border:1px solid rgba(42,59,102,.85); border-radius:16px; padding:12px}
  .kpi .k .t{font-size:11px; color:rgba(184,196,231,.85); font-weight:900}
  .kpi .k .v{font-size:22px; font-weight:1000; margin-top:6px; color:rgba(242,208,138,.95)}
  .kpi .k .s{font-size:12px; color:rgba(184,196,231,.85); margin-top:6px}
  .chart{background:rgba(13,20,40,.40); border:1px solid rgba(42,59,102,.85); border-radius:16px; padding:12px}
  .barrow{display:grid; grid-template-columns: 200px 1fr 70px; gap:12px; align-items:center; margin:10px 0}
  .bar{height:14px; border-radius:999px; background:rgba(42,59,102,.35); overflow:hidden}
  .bar > div{height:100%}
</style>
`;

  // M1: Добавлено поле p (permission key) для модульных ролей
  const NAV=[
    {r:"/home",l:"Зал Ярла • Меню",d:"Порталы и сводка",roles:ALL_ROLES,i:"home",p:"home"},
    {r:"/dashboard",l:"Дашборд руководителя",d:"Сводная аналитика",roles:["ADMIN",...DIRECTOR_ROLES],i:"dashboard",p:"dashboard"},
    {r:"/calendar",l:"Календарь встреч",d:"Совещания и события",roles:ALL_ROLES,i:"schedule",p:"calendar"},
    {r:"/birthdays",l:"Дни рождения",d:"Офисный календарь ДР",roles:ALL_ROLES,i:"birthdays",p:"birthdays"},
    {r:"/funnel",l:"Воронка продаж",d:"Канбан тендеров",roles:["ADMIN","TO",...DIRECTOR_ROLES],i:"tenders",p:"funnel"},
    {r:"/tenders",l:"Сага Тендеров",d:"Реестр тендеров",roles:["ADMIN","TO",...DIRECTOR_ROLES],i:"tenders",p:"tenders"},
    {r:"/customers",l:"Карта Контрагентов",d:"Справочник организаций",roles:["ADMIN","TO","PM",...DIRECTOR_ROLES],i:"customers",p:"customers"},
    {r:"/pm-calcs",l:"Карта Похода • Просчёты",d:"Inbox РП",roles:["ADMIN","PM",...DIRECTOR_ROLES],i:"pmcalcs",p:"pm_calcs"},
    {r:"/approvals",l:"Согласование",d:"Решения Ярла",roles:["ADMIN",...DIRECTOR_ROLES],i:"approvals",p:"approvals"},
    {r:"/bonus-approval",l:"Согласование премий",d:"Премии рабочим",roles:["ADMIN","PM",...DIRECTOR_ROLES],i:"approvals",p:"bonus_approval"},
    {r:"/pm-works",l:"Карта Похода • Работы",d:"Проекты РП",roles:["ADMIN","PM",...DIRECTOR_ROLES],i:"pmworks",p:"pm_works"},
    {r:"/all-works",l:"Свод Контрактов",d:"Все работы",roles:["ADMIN",...DIRECTOR_ROLES],i:"allworks",p:"all_works"},
    {r:"/all-estimates",l:"Свод Расчётов",d:"Все просчёты",roles:["ADMIN",...DIRECTOR_ROLES],i:"allestimates",p:"all_estimates"},
    {r:"/finances",l:"Финансы",d:"Аналитика и реестр расходов",roles:["ADMIN","BUH",...DIRECTOR_ROLES],i:"finances",p:"finances"},
    {r:"/invoices",l:"Счета и оплаты",d:"Выставление и отслеживание",roles:["ADMIN","PM","BUH",...DIRECTOR_ROLES],i:"finances",p:"invoices"},
    {r:"/acts",l:"Акты выполненных работ",d:"Создание и подписание",roles:["ADMIN","PM","BUH",...DIRECTOR_ROLES],i:"buh",p:"acts"},
    {r:"/warehouse",l:"Склад ТМЦ",d:"Оборудование и инструменты",roles:ALL_ROLES,i:"backup",p:"warehouse"},
    {r:"/my-equipment",l:"Моё оборудование",d:"Выданное мне",roles:["PM",...DIRECTOR_ROLES,"ADMIN"],i:"pmworks",p:"my_equipment"},
    {r:"/office-expenses",l:"Офисные расходы",d:"Управление и согласование",roles:["ADMIN","OFFICE_MANAGER",...DIRECTOR_ROLES],i:"office",p:"office_expenses"},
    {r:"/correspondence",l:"Корреспонденция",d:"Входящие и исходящие",roles:["ADMIN","OFFICE_MANAGER","DIRECTOR_COMM","DIRECTOR_GEN","DIRECTOR_DEV"],i:"correspondence",p:"correspondence"},
    {r:"/contracts",l:"Реестр договоров",d:"Договора поставщиков и покупателей",roles:["ADMIN","OFFICE_MANAGER","BUH",...DIRECTOR_ROLES],i:"proxies",p:"contracts"},
    {r:"/seals",l:"Реестр печатей",d:"Учёт и передача печатей",roles:["ADMIN","OFFICE_MANAGER",...DIRECTOR_ROLES],i:"proxies",p:"seals"},
    {r:"/permits",l:"Разрешения и допуски",d:"Сроки действия, уведомления",roles:["ADMIN","HR","TO",...DIRECTOR_ROLES],i:"workers",p:"permits"},
    {r:"/proxies",l:"Доверенности",d:"7 шаблонов документов",roles:["ADMIN","OFFICE_MANAGER",...DIRECTOR_ROLES],i:"proxies",p:"proxies"},
    {r:"/travel",l:"Жильё и билеты",d:"Проживание и транспорт",roles:["ADMIN","OFFICE_MANAGER","HR","PM",...DIRECTOR_ROLES],i:"travel",p:"travel"},
    {r:"/user-requests",l:"Заявки на регистрацию",d:"Одобрение новых пользователей",roles:["ADMIN",...DIRECTOR_ROLES],i:"requests",p:"users_admin"},
    {r:"/analytics",l:"Аналитика Ярла",d:"KPI работ и денег",roles:["ADMIN",...DIRECTOR_ROLES],i:"kpiworks",p:"analytics"},
    {r:"/alerts",l:"Воронья почта • Уведомления",d:"События и ответы",roles:ALL_ROLES,i:"alerts",p:"alerts"},
    {r:"/office-schedule",l:"График Дружины • Офис",d:"Статусы по дням",roles:ALL_ROLES,i:"schedule",p:"office_schedule"},
    {r:"/workers-schedule",l:"График Дружины • Рабочие",d:"Бронь и доступность",roles:["ADMIN","HR",...DIRECTOR_ROLES],i:"workers",p:"workers_schedule"},
    {r:"/hr-rating",l:"Рейтинг Дружины",d:"Оценки и средний балл",roles:["ADMIN","HR",...DIRECTOR_ROLES],i:"rating",p:"hr_rating"},
    {r:"/gantt-calcs",l:"Гантт • Просчёты",d:"Пересечения по срокам",roles:["ADMIN","PM",...DIRECTOR_ROLES],i:"ganttcalcs",p:"gantt"},
    {r:"/gantt-works",l:"Гантт • Работы",d:"План и факты",roles:["ADMIN","PM",...DIRECTOR_ROLES],i:"ganttworks",p:"gantt"},
    {r:"/backup",l:"Камень Хроник • Резерв",d:"Экспорт/импорт базы",roles:["ADMIN",...DIRECTOR_ROLES],i:"backup",p:"backup"},
    {r:"/diag",l:"Диагностика",d:"Версия, база, self-test, логи",roles:["ADMIN"],i:"diag",p:"diag"},
    {r:"/settings",l:"Кузница Настроек",d:"Справочники и цвета",roles:["ADMIN",...DIRECTOR_ROLES],i:"settings",p:"settings"},
    {r:"/telegram",l:"Telegram",d:"Уведомления и SMS",roles:["ADMIN"],i:"alerts",p:"telegram_admin"},
    {r:"/sync",l:"PostgreSQL Sync",d:"Синхронизация с сервером",roles:["ADMIN"],i:"backup",p:"sync"},
    {r:"/mango",l:"Телефония",d:"Манго Телеком",roles:["ADMIN"],i:"alerts",p:"telegram_admin"},
    {r:"/chat",l:"Чат дружины",d:"Общение и согласования",roles:["ADMIN","PM","TO","HR","OFFICE_MANAGER","BUH",...DIRECTOR_ROLES],i:"correspondence",p:"chat"},
    {r:"/my-dashboard",l:"Мой дашборд",d:"Настраиваемые виджеты",roles:["ADMIN","PM","TO","HR","OFFICE_MANAGER","BUH",...DIRECTOR_ROLES],i:"dashboard",p:"my_dashboard"},
    {r:"/personnel",l:"Персонал",d:"Дружина — сотрудники",roles:["ADMIN","HR",...DIRECTOR_ROLES],i:"workers",p:"personnel"},
    {r:"/hr-requests",l:"Заявки персонала",d:"HR-заявки",roles:["ADMIN","HR",...DIRECTOR_ROLES],i:"workers",p:"hr_requests"},
    {r:"/proc-requests",l:"Заявки закупок",d:"Закупки",roles:["ADMIN","PROC",...DIRECTOR_ROLES],i:"approvals",p:"proc_requests"},
    {r:"/buh-registry",l:"Реестр расходов",d:"Бухгалтерский реестр",roles:["ADMIN","BUH",...DIRECTOR_ROLES],i:"finances",p:"buh_registry"},
    {r:"/cash",l:"Касса",d:"Авансовые отчёты",roles:["ADMIN","PM",...DIRECTOR_ROLES],i:"finances",p:"cash"},
    {r:"/cash-admin",l:"Касса (управление)",d:"Согласование и контроль",roles:["ADMIN",...DIRECTOR_ROLES],i:"finances",p:"cash_admin"},
    {r:"/tasks",l:"Мои задачи",d:"Задачи и Todo-список",roles:ALL_ROLES,i:"approvals",p:"tasks"},
    {r:"/tasks-admin",l:"Управление задачами",d:"Контроль задач сотрудников",roles:["ADMIN",...DIRECTOR_ROLES],i:"approvals",p:"tasks_admin"},
  ];

  async function layout(body,{title,motto,rightBadges=[]}={}){
    // Сохраняем позицию скролла меню
    const sidenav = document.querySelector('.sidenav');
    const savedScroll = sidenav ? sidenav.scrollTop : (window.__ASG_NAV_SCROLL__ || 0);
    
    const auth=await AsgardAuth.requireUser();
    const user=auth?auth.user:null;
    const role=user?user.role:"GUEST";
    const cur=AsgardRouter.current();
    let unreadCount=0;
    try{
      const nots = await AsgardDB.byIndex("notifications","user_id", user?.id||-1);
      unreadCount = (nots||[]).filter(n=>!n.is_read).length;
    }catch(e){}
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

    const navHtml = (role==="GUEST") ? "" : NAV.filter(n => {
      // 1. Старая проверка по ролям (обратная совместимость)
      if (!roleAllowed(n.roles, role)) return false;
      // 2. Новая проверка по пермишенам (если поле p задано)
      if (n.p && role !== 'ADMIN') {
        if (!permissions[n.p] || !permissions[n.p].read) return false;
      }
      // 3. Скрытые пользователем вкладки
      if (hiddenRoutes.includes('#' + n.r)) return false;
      return true;
    }).map(n=>{
      const a=(cur===n.r)?"active":"";
      return `<a class="navitem ${a}" href="#${n.r}">
        <div class="ico"><img src="assets/icons/nav/${esc(n.i)}.svg" alt="" loading="lazy"/></div>
        <div class="lbl"><div class="name">${esc(n.l)}</div><div class="desc">${esc(n.d)}</div></div>
      </a>`;
    }).join("");    const switchCtl = (user && window.AsgardAuth && AsgardAuth.canSwitch) ? AsgardAuth.canSwitch(user) : null;
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
    $("#app").innerHTML = `<div class="app">
      <aside class="sidenav">
        <a class="brand" href="#/welcome" aria-label="На главную">
          <img src="${logo}" alt="АСГАРД‑СЕРВИС" onerror="this.style.display='none'"/>
          <div>
            <div class="h">CRM</div>
            <div class="s">ᚠᚢᚦᚨᚱᚲ</div>
          </div>
        </a>
        <nav class="nav">
          <div class="group-title">Навигация</div>
          ${navHtml || `<div class="help" style="padding:10px 10px">Войдите, чтобы открыть разделы.</div>`}
        </nav>
        <div class="sidefoot">
          ${authBtns}
          <button class="btn ghost" id="btnBackup">Экспорт/Импорт</button>
        </div>
      </aside>
      <div class="nav-overlay" id="navOverlay"></div>
      <main class="main">
        <div class="topbar">
          <div class="mnav"><button class="iconbtn" id="btnMenu" aria-label="Меню">☰</button></div>
          <div class="title">
            <h1 class="page-title">${esc(title||"")}</h1>
            <p class="page-motto">${esc(motto||MOTTOS[cur]||"")}</p>
          </div>
          <div class="badges">${[
  ...(user ? [
    `<button class="themebtn icononly" id="btnTheme" type="button" aria-label="Переключить тему"><span class="iconwrap" aria-hidden="true"><svg class="icon icon-sun" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Zm0-16V1m0 22v-1m11-10h-1M2 12H1m18.364 6.364-.707-.707M6.343 6.343l-.707-.707m13.435-0.293-.707.707M6.343 17.657l-.707.707" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><svg class="icon icon-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 13.5A8.5 8.5 0 1 1 10.5 3a6.8 6.8 0 0 0 10.5 10.5Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg></span></button>
    <button class="bellbtn" id="btnBell" type="button" aria-label="Уведомления">
      <span class="bell">🔔</span>
      <span class="belltext">Уведомления</span>
      ${unreadCount?`<span class="bellcount">${unreadCount}</span>`:''}
    </button>
    <div class="bellpop" id="bellPop" style="display:none">
      <div class="bellpop-head">
        <div><b>Воронья почта</b></div>
        <button class="xbtn" id="bellClose" type="button" aria-label="Закрыть">✕</button>
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
        ${body}
        <div class="runesep" aria-hidden="true"></div>
        <hr class="hr"/>
        <div class="help">Данные хранятся на сервере. Резервное копирование автоматическое.</div>
        <div class="credit">ᚠᚹ Сей сайт выкован Androsov’ым — да служит АСГАРД-СЕРВИС ᚹᚠ</div>
      </main>
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

    addMobileClick($("#btnLogout"), ()=>{ AsgardAuth.logout(); toast("Выход","Сессия завершена"); location.hash="#/welcome"; });
    addMobileClick($("#btnLoginGo"), ()=>location.hash="#/login");
    addMobileClick($("#btnRegGo"), ()=>location.hash="#/register");
    addMobileClick($("#btnBackup"), backupModal);
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
        try{ items = await AsgardDB.byIndex("notifications","user_id", user.id); }catch(e){ items=[]; }
        items.sort((a,b)=>String(b.created_at||"").localeCompare(String(a.created_at||"")));
        items = items.slice(0,8);
        if(!items.length){
          list.innerHTML = `<div class="help" style="padding:10px">Нет уведомлений.</div>`;
          return;
        }
        list.innerHTML = items.map(n=>{
          const when = n.created_at ? new Date(n.created_at).toLocaleString("ru-RU") : "—";
          const dot = n.is_read ? `<span class="dot" style="background:#64748b"></span>` : `<span class="dot" style="background:#f59e0b"></span>`;
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

        // Mark read on open
        $$(".bellitem").forEach(a=>a.addEventListener("click", async ()=>{
          const id = Number(a.getAttribute("data-nid"));
          try{
            const n = await AsgardDB.get("notifications", id);
            if(n && !n.is_read){ n.is_read=true; await AsgardDB.put("notifications", n); }
          }catch(e){}
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
    });
    
    // Инициализируем AI-ассистента (только для авторизованных)
    if(window.AsgardAssistant && auth){
      AsgardAssistant.init();
    }
  }

  async function pageWelcome(){
    // Public landing (no auth). If user is already logged in — show portal / home.
    const auth = AsgardAuth.getAuth();
    if(auth && auth.user){ location.hash = "#/home"; return; }

    // SVG драккар (викингский корабль)
    const drakkarSVG = `
      <svg viewBox="0 0 400 200" class="drakkar-svg" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="seaGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" style="stop-color:#1e40af;stop-opacity:0.6"/>
            <stop offset="100%" style="stop-color:#0f172a;stop-opacity:0.9"/>
          </linearGradient>
          <linearGradient id="hullGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" style="stop-color:#92400e"/>
            <stop offset="100%" style="stop-color:#451a03"/>
          </linearGradient>
          <linearGradient id="sailGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#dc2626"/>
            <stop offset="100%" style="stop-color:#7f1d1d"/>
          </linearGradient>
        </defs>
        <!-- Море -->
        <ellipse cx="200" cy="185" rx="180" ry="20" fill="url(#seaGrad)" opacity="0.7"/>
        <!-- Волны -->
        <path d="M20,175 Q60,165 100,175 T180,175 T260,175 T340,175 T380,175" stroke="#3b82f6" stroke-width="2" fill="none" opacity="0.5"/>
        <path d="M30,180 Q70,170 110,180 T190,180 T270,180 T350,180" stroke="#60a5fa" stroke-width="1.5" fill="none" opacity="0.4"/>
        <!-- Корпус -->
        <path d="M60,150 Q80,170 200,175 Q320,170 340,150 L320,150 Q200,160 80,150 Z" fill="url(#hullGrad)" stroke="#78350f" stroke-width="2"/>
        <!-- Щиты на борту -->
        <circle cx="100" cy="152" r="8" fill="#fbbf24" stroke="#78350f" stroke-width="1.5"/>
        <circle cx="130" cy="155" r="8" fill="#dc2626" stroke="#78350f" stroke-width="1.5"/>
        <circle cx="160" cy="157" r="8" fill="#fbbf24" stroke="#78350f" stroke-width="1.5"/>
        <circle cx="190" cy="158" r="8" fill="#dc2626" stroke="#78350f" stroke-width="1.5"/>
        <circle cx="220" cy="158" r="8" fill="#fbbf24" stroke="#78350f" stroke-width="1.5"/>
        <circle cx="250" cy="157" r="8" fill="#dc2626" stroke="#78350f" stroke-width="1.5"/>
        <circle cx="280" cy="155" r="8" fill="#fbbf24" stroke="#78350f" stroke-width="1.5"/>
        <circle cx="310" cy="152" r="8" fill="#dc2626" stroke="#78350f" stroke-width="1.5"/>
        <!-- Нос корабля - голова дракона -->
        <path d="M340,150 Q360,140 370,120 Q375,100 365,90 Q355,85 350,95 Q345,85 335,90 L340,105 Q335,115 340,130 Z" fill="#451a03" stroke="#78350f" stroke-width="2"/>
        <circle cx="355" cy="100" r="3" fill="#fbbf24"/>
        <!-- Корма -->
        <path d="M60,150 Q40,140 35,120 Q30,100 45,95 L55,110 Q50,125 60,140 Z" fill="#451a03" stroke="#78350f" stroke-width="2"/>
        <!-- Мачта -->
        <rect x="195" y="50" width="10" height="105" fill="#78350f" stroke="#451a03" stroke-width="1"/>
        <!-- Парус -->
        <path d="M100,55 Q200,40 300,55 L290,130 Q200,145 110,130 Z" fill="url(#sailGrad)" stroke="#991b1b" stroke-width="2"/>
        <!-- Полосы на парусе -->
        <line x1="120" y1="60" x2="130" y2="128" stroke="#fbbf24" stroke-width="3"/>
        <line x1="200" y1="48" x2="200" y2="138" stroke="#fbbf24" stroke-width="3"/>
        <line x1="280" y1="60" x2="270" y2="128" stroke="#fbbf24" stroke-width="3"/>
        <!-- Верёвки -->
        <line x1="200" y1="50" x2="100" y2="55" stroke="#a16207" stroke-width="1.5"/>
        <line x1="200" y1="50" x2="300" y2="55" stroke="#a16207" stroke-width="1.5"/>
        <line x1="200" y1="50" x2="60" y2="140" stroke="#a16207" stroke-width="1"/>
        <line x1="200" y1="50" x2="340" y2="140" stroke="#a16207" stroke-width="1"/>
      </svg>
    `;

    // Полностраничный Welcome без sidebar
    const appEl = $("#app");
    if (!appEl) {
      console.warn("[pageWelcome] #app element not found, skipping render");
      return;
    }
    appEl.innerHTML = `
      <div class="welcome-page">
        <div class="welcome-bg"></div>
        <div class="welcome-content">
          <div class="welcome-header">
            <img src="${ASSETS_BASE}img/logo.png" alt="АСГАРД" class="welcome-logo" onerror="this.style.display='none'"/>
            <div class="welcome-brand">
              <div class="welcome-title">АСГАРД‑СЕРВИС</div>
              <div class="welcome-runes">ᚠᚢᚦᚨᚱᚲ • CRM</div>
            </div>
          </div>

          <div class="welcome-ship">
            ${drakkarSVG}
          </div>

          <div class="welcome-motto">
            «Сталь и порядок. Пусть каждый день приносит добычу.»
          </div>

          <div class="welcome-desc">
            Порядок в делах • Честный счёт • Быстрые решения
          </div>

          <div class="welcome-actions" id="welcomeActions">
            <button class="btn welcome-btn" id="btnShowLogin" type="button" style="touch-action:manipulation;-webkit-tap-highlight-color:transparent;user-select:none;position:relative;z-index:10">Войти</button>
          </div>

          <!-- Форма входа: Шаг 1 - логин/пароль -->
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

          <!-- Форма: Шаг 2 - ввод PIN -->
          <div class="welcome-form" id="pinForm" style="display:none">
            <div class="welcome-form-title">Введите PIN</div>
            <div class="welcome-form-subtitle" id="pinUserName"></div>
            <div class="welcome-form-fields">
              <div class="field" style="text-align:center">
                <label for="w_pin">PIN-код (4 цифры)</label>
                <input id="w_pin" name="pin" type="password" maxlength="4" pattern="[0-9]*" inputmode="numeric" 
                       placeholder="••••" style="text-align:center; font-size:24px; letter-spacing:8px; width:140px; margin:0 auto" autocomplete="off"/>
              </div>
            </div>
            <div class="welcome-form-actions">
              <button class="btn" id="btnVerifyPin">Войти</button>
              <button class="btn ghost" id="btnBackToLogin">Назад</button>
            </div>
          </div>

          <!-- Форма: Первый вход - смена пароля + PIN -->
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
              <div class="field">
                <label for="s_pin">PIN-код (4 цифры)</label>
                <input id="s_pin" name="new_pin" type="password" maxlength="4" pattern="[0-9]*" inputmode="numeric" 
                       placeholder="0000" style="text-align:center; font-size:20px; letter-spacing:6px" autocomplete="off"/>
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
    }

    function showPin(){
      welcomeActions.style.display = "none";
      loginForm.style.display = "none";
      setupForm.style.display = "none";
      pinForm.style.display = "block";
      $("#pinUserName").textContent = loginState.userName || "";
      setTimeout(()=>$("#w_pin")?.focus(), 100);
    }

    function showSetup(){
      welcomeActions.style.display = "none";
      loginForm.style.display = "none";
      pinForm.style.display = "none";
      setupForm.style.display = "block";
      $("#setupUserName").textContent = loginState.userName || "";
      setTimeout(()=>$("#s_pass")?.focus(), 100);
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
      const login = $("#w_login").value.trim();
      const pass = $("#w_pass").value;
      const remember = $("#w_remember").checked;
      if(!login || !pass){ toast("Ошибка","Заполните логин и пароль","err"); return; }

      try{
        const result = await AsgardAuth.loginStep1({login, password:pass});
        loginState.userId = result.userId;
        loginState.userName = result.userName;
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

    // Шаг 2a: ввод PIN
    async function verifyPin(){
      const pin = $("#w_pin").value;
      if(!pin || pin.length !== 4){ toast("Ошибка","Введите 4 цифры PIN","err"); return; }

      try{
        await AsgardAuth.verifyPin({
          userId: loginState.userId,
          pin: pin,
          remember: loginState.remember
        });
        await showLoadingScreen();
      }catch(e){
        toast("Ошибка", e.message||"Неверный PIN", "err");
        $("#w_pin").value = "";
        $("#w_pin").focus();
      }
    }
    addMobileClick($("#btnVerifyPin"), verifyPin);

    // Enter для PIN
    $("#w_pin")?.addEventListener("keydown", (e)=>{ if(e.key==="Enter") $("#btnVerifyPin").click(); });

    // Шаг 2b: первый вход - установка пароля и PIN
    async function setupCredentials(){
      const pass1 = $("#s_pass").value;
      const pass2 = $("#s_pass2").value;
      const pin = $("#s_pin").value;

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
    const quote = LOADING_QUOTES[Math.floor(Math.random() * LOADING_QUOTES.length)];

    $("#app").innerHTML = `
      <div class="loading-screen">
        <div class="loading-content">
          <div class="loading-logo">
            <img src="${ASSETS_BASE}img/logo.png" alt="АСГАРД" onerror="this.style.display='none'"/>
          </div>
          <div class="loading-spinner">
            <div class="spinner-ring"></div>
            <div class="spinner-ring"></div>
            <div class="spinner-ring"></div>
          </div>
          <div class="loading-quote">${esc(quote)}</div>
          <div class="loading-runes">ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ</div>
        </div>
      </div>
    `;

    // Ждём 2.5 секунды и переходим на главную
    await new Promise(r => setTimeout(r, 2500));
    location.hash = "#/home";
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

  async function pageLogin(){
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
    // Redirect to welcome - registration is now on welcome page
    location.hash = "#/welcome";
  }

  async function pageHome(){
    const auth=await AsgardAuth.requireUser();
    if(!auth){ location.hash="#/login"; return; }
    const user=auth.user;

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

    const fmtRub = (v)=>{
      const n = Number(v||0);
      try{ return n.toLocaleString('ru-RU') + ' ₽'; }catch(_){ return String(n) + ' ₽'; }
    };
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
      TO: [ ['#/tenders','Тендеры'], ['#/tasks','Задачи'], ['#/birthdays','ДР'], ['#/alerts','Уведомления'] ],
      PM: [ ['#/pm-calcs','Просчёты'], ['#/pm-works','Работы'], ['#/tasks','Задачи'], ['#/cash','Касса'], ['#/travel','Жильё/билеты'], ['#/gantt-works','Гантт'], ['#/alerts','Уведомления'] ],
      DIRECTOR_COMM: [ ['#/dashboard','📊 Дашборд'], ['#/approvals','Согласование'], ['#/tasks-admin','Задачи'], ['#/cash-admin','Касса'], ['#/user-requests','Пользователи'], ['#/finances','Деньги'], ['#/birthdays','ДР'] ],
      DIRECTOR_GEN: [ ['#/dashboard','📊 Дашборд'], ['#/approvals','Согласование'], ['#/tasks-admin','Задачи'], ['#/cash-admin','Касса'], ['#/user-requests','Пользователи'], ['#/finances','Деньги'], ['#/birthdays','ДР'] ],
      DIRECTOR_DEV: [ ['#/dashboard','📊 Дашборд'], ['#/approvals','Согласование'], ['#/tasks-admin','Задачи'], ['#/cash-admin','Касса'], ['#/user-requests','Пользователи'], ['#/finances','Деньги'], ['#/birthdays','ДР'] ],
      DIRECTOR: [ ['#/dashboard','📊 Дашборд'], ['#/approvals','Согласование'], ['#/tasks-admin','Задачи'], ['#/cash-admin','Касса'], ['#/user-requests','Пользователи'], ['#/finances','Деньги'], ['#/birthdays','ДР'] ],
      HR: [ ['#/personnel','Персонал'], ['#/tasks','Задачи'], ['#/travel','Жильё/билеты'], ['#/workers-schedule','График'], ['#/hr-rating','Рейтинг'], ['#/alerts','Уведомления'] ],
      PROC: [ ['#/proc-requests','Заявки'], ['#/birthdays','ДР'], ['#/alerts','Уведомления'] ],
      BUH: [ ['#/buh-registry','Реестр расходов'], ['#/tasks','Задачи'], ['#/finances','Деньги'], ['#/birthdays','ДР'], ['#/alerts','Уведомления'] ],
      OFFICE_MANAGER: [ ['#/office-expenses','Офис.расходы'], ['#/tasks','Задачи'], ['#/travel','Жильё/билеты'], ['#/proxies','Доверенности'], ['#/correspondence','Корреспонденция'] ],
      ADMIN: [ ['#/dashboard','📊 Дашборд'], ['#/user-requests','Пользователи'], ['#/finances','Деньги'], ['#/settings','Настройки'], ['#/backup','Backup'] ]
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

        <!-- Виджет телефонии -->
        <div class="card span-3" id="callToggleContainer"></div>
        
        <!-- Виджет сканера чеков для PM -->
        ${user.role === 'PM' ? `
        <div class="card span-3">
          <h3>📷 Быстрый ввод расходов</h3>
          <p class="help">Сканируйте чеки камерой для автоматического добавления расходов по работам</p>
          <button class="btn primary" onclick="AsgardReceiptScanner.openScanner()" style="width:100%;margin-top:10px">
            📷 Сканировать чек
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
            const formatMoney = (v) => (parseFloat(v) || 0).toLocaleString('ru-RU', {minimumFractionDigits: 2}) + ' руб.';
            document.getElementById('cashBalanceData').innerHTML = `
              <div class="kpi" style="grid-template-columns:repeat(2,1fr)">
                <div class="k"><div class="t">На руках</div><div class="v" style="color:${data.balance > 0 ? '#ef4444' : '#22c55e'}">${formatMoney(data.balance)}</div></div>
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
              const priorityColors = {urgent: '#ef4444', high: '#f97316', normal: '#3b82f6', low: '#6b7280'};
              const statusLabels = {new: 'Новая', accepted: 'Принята', in_progress: 'В работе'};
              document.getElementById('tasksWidgetContent').innerHTML = activeTasks.map(t => {
                const deadlineStr = t.deadline ? new Date(t.deadline).toLocaleDateString('ru-RU') : '';
                const isOverdue = t.deadline && new Date(t.deadline) < new Date();
                return `<div style="padding:8px 10px; margin-bottom:8px; background:rgba(42,59,102,.35); border-left:3px solid ${priorityColors[t.priority] || '#3b82f6'}; border-radius:6px">
                  <div style="font-weight:600">${esc(t.title)}</div>
                  <div style="font-size:12px; color:rgba(184,196,231,.85); margin-top:4px">
                    <span style="background:${priorityColors[t.priority]}; color:#fff; padding:2px 6px; border-radius:3px; font-size:10px">${statusLabels[t.status] || t.status}</span>
                    ${deadlineStr ? `<span style="margin-left:8px; ${isOverdue ? 'color:#ef4444' : ''}">${deadlineStr}</span>` : ''}
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
                `<div style="padding:6px 10px; margin-bottom:6px; background:rgba(42,59,102,.25); border-radius:4px; display:flex; align-items:center; gap:8px">
                  <span style="color:#3b82f6">○</span>
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
    AsgardRouter.add("/dashboard", ()=>AsgardDashboardPage.render({layout, title:"Дашборд"}), {auth:true, roles:["ADMIN",...DIRECTOR_ROLES]});
    AsgardRouter.add("/calendar", ()=>AsgardCalendarPage.render({layout, title:"Календарь встреч"}), {auth:true, roles:ALL_ROLES});
    AsgardRouter.add("/birthdays", ()=>AsgardBirthdaysPage.render({layout, title:"Дни рождения"}), {auth:true, roles:ALL_ROLES});

    AsgardRouter.add("/contracts", ()=>AsgardContractsPage.render({layout, title:"Реестр договоров"}), {auth:true, roles:["ADMIN","OFFICE_MANAGER","BUH",...DIRECTOR_ROLES]});
    AsgardRouter.add("/seals", ()=>AsgardSealsPage.render({layout, title:"Реестр печатей"}), {auth:true, roles:["ADMIN","OFFICE_MANAGER",...DIRECTOR_ROLES]});
    AsgardRouter.add("/permits", ()=>AsgardPermitsPage.render({layout, title:"Разрешения и допуски"}), {auth:true, roles:["ADMIN","HR","TO",...DIRECTOR_ROLES]});
    AsgardRouter.add("/funnel", ()=>AsgardFunnelPage.render({layout, title:"Воронка продаж"}), {auth:true, roles:["ADMIN","TO",...DIRECTOR_ROLES]});
    AsgardRouter.add("/tenders", ()=>AsgardTendersPage.render({layout, title:"Сага Тендеров"}), {auth:true, roles:["ADMIN","TO",...DIRECTOR_ROLES]});
    AsgardRouter.add("/customers", ()=>AsgardCustomersPage.renderList({layout, title:"Карта Контрагентов"}), {auth:true, roles:["ADMIN","TO","PM",...DIRECTOR_ROLES]});
    AsgardRouter.add("/customer", ({query})=>AsgardCustomersPage.renderCard({layout, title:"Карточка контрагента", query}), {auth:true, roles:["ADMIN","TO","PM",...DIRECTOR_ROLES]});
    AsgardRouter.add("/pm-calcs", ()=>AsgardPmCalcsPage.render({layout, title:"Карта Похода • Просчёты"}), {auth:true, roles:["ADMIN","PM",...DIRECTOR_ROLES]});
    AsgardRouter.add("/pm-consents", ()=>AsgardPmConsentsPage.render({layout, title:"Согласия РП"}), {auth:true, roles:["ADMIN","PM",...DIRECTOR_ROLES]});
    AsgardRouter.add("/approvals", ()=>AsgardApprovalsPage.render({layout, title:"Согласование"}), {auth:true, roles:["ADMIN",...DIRECTOR_ROLES]});
    AsgardRouter.add("/bonus-approval", ()=>AsgardBonusApproval.render({layout, title:"Согласование премий"}), {auth:true, roles:["ADMIN","PM",...DIRECTOR_ROLES]});
    AsgardRouter.add("/pm-works", ()=>AsgardPmWorksPage.render({layout, title:"Карта Похода • Работы"}), {auth:true, roles:["ADMIN","PM",...DIRECTOR_ROLES]});
    AsgardRouter.add("/all-works", ()=>AsgardAllWorksPage.render({layout, title:"Свод Контрактов"}), {auth:true, roles:["ADMIN",...DIRECTOR_ROLES]});
    AsgardRouter.add("/all-estimates", ()=>AsgardAllEstimatesPage.render({layout, title:"Свод Расчётов"}), {auth:true, roles:["ADMIN",...DIRECTOR_ROLES]});
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
    AsgardRouter.add("/proxies", ()=>AsgardProxiesPage.render({layout, title:"Доверенности"}), {auth:true, roles:["ADMIN","OFFICE_MANAGER",...DIRECTOR_ROLES]});
    AsgardRouter.add("/travel", ()=>AsgardTravelPage.render({layout, title:"Жильё и билеты"}), {auth:true, roles:["ADMIN","OFFICE_MANAGER","HR","PM",...DIRECTOR_ROLES]});
    AsgardRouter.add("/user-requests", ()=>AsgardUserRequestsPage.render({layout, title:"Заявки на регистрацию"}), {auth:true, roles:["ADMIN",...DIRECTOR_ROLES]});
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
    AsgardRouter.add("/settings", ()=>AsgardSettingsPage.render({layout, title:"Кузница Настроек"}), {auth:true, roles:["ADMIN",...DIRECTOR_ROLES]});
    AsgardRouter.add("/telegram", ()=>AsgardTelegram.renderSettings({layout, title:"Telegram"}), {auth:true, roles:["ADMIN"]});
    AsgardRouter.add("/sync", ()=>AsgardSync.renderSettings({layout, title:"PostgreSQL Sync"}), {auth:true, roles:["ADMIN"]});
    AsgardRouter.add("/mango", ()=>AsgardMango.renderSettings({layout, title:"Телефония"}), {auth:true, roles:["ADMIN"]});
    AsgardRouter.add("/chat", ()=>AsgardChat.render({layout, title:"Чат дружины"}), {auth:true, roles:["ADMIN","PM","TO","HR","OFFICE_MANAGER","BUH",...DIRECTOR_ROLES]});
    AsgardRouter.add("/my-dashboard", ()=>AsgardCustomDashboard.render({layout, title:"Мой дашборд"}), {auth:true, roles:["ADMIN","PM","TO","HR","OFFICE_MANAGER","BUH",...DIRECTOR_ROLES]});
    AsgardRouter.add("/backup", ()=>AsgardBackupPage.render({layout, title:"Камень Хроник • Резерв"}), {auth:true, roles:["ADMIN",...DIRECTOR_ROLES]});
  AsgardRouter.add("/diag", ()=>AsgardDiagPage.render({layout, title:"Диагностика"}), {auth:true, roles:["ADMIN"]});
    AsgardRouter.add("/alerts", ()=>AsgardAlertsPage.render({layout, title:"Уведомления"}), {auth:true, roles:ALL_ROLES});
    AsgardRouter.add("/personnel", () => {
      if (!AsgardAuth.hasPermission('personnel', 'read')) {
        AsgardUI.toast('Нет доступа', 'Недостаточно прав', 'error');
        location.hash = '#/home';
        return;
      }
      AsgardPersonnelPage.render({layout, title:"Дружина • Персонал"});
    }, {auth:true, roles:["ADMIN","HR","PROC","TO","PM",...DIRECTOR_ROLES]});
    AsgardRouter.add("/hr-rating", ()=>AsgardHrRatingPage.render({layout, title:"Рейтинг Дружины"}), {auth:true, roles:["ADMIN","HR",...DIRECTOR_ROLES]});
    AsgardRouter.add("/employee", () => {
      if (!AsgardAuth.hasPermission('personnel', 'read')) {
        AsgardUI.toast('Нет доступа', 'Недостаточно прав', 'error');
        location.hash = '#/home';
        return;
      }
      AsgardEmployeePage.render({layout, title:"Личное дело"});
    }, {auth:true, roles:["ADMIN","HR","PM","TO",...DIRECTOR_ROLES]});
    AsgardRouter.add("/hr-requests", () => {
      if (!AsgardAuth.hasPermission('hr_requests', 'read')) {
        AsgardUI.toast('Нет доступа', 'Недостаточно прав', 'error');
        location.hash = '#/home';
        return;
      }
      AsgardHrRequestsPage.render({layout, title:"Заявки персонала"});
    }, {auth:true, roles:["ADMIN","HR",...DIRECTOR_ROLES]});
    AsgardRouter.add("/proc-requests", () => {
      if (!AsgardAuth.hasPermission('proc_requests', 'read')) {
        AsgardUI.toast('Нет доступа', 'Недостаточно прав', 'error');
        location.hash = '#/home';
        return;
      }
      AsgardProcRequestsPage.render({layout, title:"Заявки закупок"});
    }, {auth:true, roles:["ADMIN","PROC",...DIRECTOR_ROLES]});
  AsgardRouter.add("/workers-schedule", ()=>AsgardStaffSchedulePage.render({layout, title:"График рабочих"}), {auth:true, roles:["ADMIN","HR",...DIRECTOR_ROLES]});
  AsgardRouter.add("/office-schedule", ()=>AsgardOfficeSchedulePage.render({layout, title:"График Дружины • Офис"}), {auth:true, roles:ALL_ROLES});
    AsgardRouter.add("/gantt-calcs", ()=>AsgardGanttFullPage.renderCalcs({layout}), {auth:true, roles:["ADMIN","PM",...DIRECTOR_ROLES]});
    AsgardRouter.add("/gantt-works", ()=>AsgardGanttFullPage.renderWorks({layout}), {auth:true, roles:["ADMIN","PM",...DIRECTOR_ROLES]});
    
    // Акты и счета
    AsgardRouter.add("/acts", ()=>AsgardActsPage.render({layout, title:"Акты выполненных работ"}), {auth:true, roles:["ADMIN","PM","BUH",...DIRECTOR_ROLES]});
    AsgardRouter.add("/invoices", ()=>AsgardInvoicesPage.render({layout, title:"Счета и оплаты"}), {auth:true, roles:["ADMIN","PM","BUH",...DIRECTOR_ROLES]});
    AsgardRouter.add("/reminders", ()=>AsgardReminders.render({layout, title:"Напоминания"}), {auth:true, roles:ALL_ROLES});
    AsgardRouter.add("/warehouse", ()=>AsgardWarehouse.render({layout, title:"Склад ТМЦ"}), {auth:true, roles:ALL_ROLES});
    AsgardRouter.add("/my-equipment", ()=>AsgardMyEquipment.render({layout, title:"Моё оборудование"}), {auth:true, roles:["PM",...DIRECTOR_ROLES,"ADMIN"]});

    // Касса (M2)
    AsgardRouter.add("/cash", async ()=>{
      if (!AsgardAuth.hasPermission('cash', 'read')) {
        AsgardUI.toast('Нет доступа', 'Недостаточно прав', 'error');
        location.hash = '#/home';
        return;
      }
      await layout('<div id="cash-page"></div>', {title:"Касса"});
      CashPage.render(document.getElementById('cash-page'));
    }, {auth:true, roles:["ADMIN","PM",...DIRECTOR_ROLES]});
    AsgardRouter.add("/cash-admin", async ()=>{
      if (!AsgardAuth.hasPermission('cash_admin', 'read')) {
        AsgardUI.toast('Нет доступа', 'Недостаточно прав', 'error');
        location.hash = '#/home';
        return;
      }
      await layout('<div id="cash-admin-page"></div>', {title:"Касса (управление)"});
      CashAdminPage.render(document.getElementById('cash-admin-page'));
    }, {auth:true, roles:["ADMIN",...DIRECTOR_ROLES]});

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

    // TKP Follow-up: проверка напоминаний при старте
    if(window.AsgardTkpFollowup){
      try { 
        AsgardTkpFollowup.checkAndCreateReminders().catch(e => console.warn('TKP Followup check error:', e));
      } catch(e){ console.warn('TKP Followup init error:', e); }
    }

    if(startRouter){
      if(!location.hash) location.hash="#/welcome";
      AsgardRouter.start();
    }
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
})();