/**
 * ASGARD CRM — Живой офис директора (#/command-map).
 * Изометрический «живой офис» (порт public/office-live-demo.html) на РЕАЛЬНЫХ данных:
 *   аватары = офисные сотрудники (/command-map/live), объекты = работы (/command-map),
 *   рейсы = /command-map/flights (по реальному времени), сводка = /director-summary.
 * Файл СГЕНЕРИРОВАН scripts/build-office-live.js из демо — правки вносить в демо+билдер.
 * PIXI v7 грузится из index.html.
 */
window.AsgardOfficeLive = (function () {
  'use strict';

  const _CSS = "  :root{\n    --gold:#d8b15a; --blue:#1f6fff; --red:#e23a3a; --ink:#070a10;\n    --panel:#0e1320cc; --line:#243049;\n  }\n  html,body{margin:0;height:100%;background:#070a10;color:#e9eff8;\n    font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;overflow:hidden}\n  #ofl-wrap{position:fixed;inset:0}\n  canvas{display:block}\n\n  /* ---------- Логотип / HUD ---------- */\n  #hud{position:absolute;left:20px;top:16px;z-index:10;pointer-events:none}\n  #logo{display:flex;align-items:center;gap:15px;\n    background:linear-gradient(120deg,#0e1730e0,#1a1018e0);border:1.5px solid #ffffff14;\n    border-radius:16px;padding:10px 18px 10px 12px;backdrop-filter:blur(10px);\n    box-shadow:0 8px 30px #000a, inset 0 0 0 1px #d8b15a22}\n  #logo .mark{width:58px;height:58px;border-radius:14px;\n    background:linear-gradient(135deg,var(--blue) 8%,#7a3aff 50%,var(--red));\n    display:flex;align-items:center;justify-content:center;font-size:32px;\n    box-shadow:0 6px 22px #0009, inset 0 0 0 2px #ffffff2a, 0 0 0 2px #d8b15a44}\n  #logo .txt h1{margin:0;font-size:30px;letter-spacing:3px;font-weight:900;line-height:1;\n    background:linear-gradient(90deg,#6aa6ff,#ffd36a 55%,#ff6a6a);\n    -webkit-background-clip:text;background-clip:text;color:transparent;\n    text-shadow:0 2px 20px #000c;filter:drop-shadow(0 1px 0 #00000080)}\n  #logo .txt .sub{font-size:11.5px;opacity:.78;letter-spacing:5px;margin-top:3px;\n    color:var(--gold);font-weight:700}\n  #runebar{margin-top:9px;margin-left:4px;font-size:14px;letter-spacing:8px;color:var(--gold);opacity:.6}\n  #demoNote{font-size:10.5px;opacity:.45;margin-top:5px;margin-left:4px}\n\n  #topbar{position:absolute;right:18px;top:14px;z-index:10;display:flex;gap:10px;align-items:center}\n  .stat{background:var(--panel);border:1px solid var(--line);border-radius:11px;\n    padding:7px 13px;backdrop-filter:blur(8px);text-align:center;min-width:74px}\n  .stat .n{font-size:19px;font-weight:800;line-height:1}\n  .stat.office .n{color:#6aa6ff}.stat.field .n{color:var(--gold)}.stat.home .n{color:#8b97a6}\n  .stat.transit .n{color:#7fd0ff}\n  .stat .l{font-size:9.5px;opacity:.6;margin-top:3px;text-transform:uppercase;letter-spacing:.5px}\n  #clock{font-size:25px;font-weight:700;font-variant-numeric:tabular-nums;\n    text-shadow:0 2px 8px #000;margin-left:6px}\n\n  #legend{position:absolute;left:18px;bottom:14px;z-index:10;display:flex;gap:8px;\n    flex-wrap:wrap;font-size:11px;opacity:.92;max-width:60vw}\n  #legend .it{display:flex;align-items:center;gap:6px;background:var(--panel);\n    padding:4px 9px;border-radius:18px;backdrop-filter:blur(6px);border:1px solid #1c2740}\n  #legend .dot{width:9px;height:9px;border-radius:50%}\n  #help{position:absolute;right:18px;bottom:14px;z-index:10;font-size:11px;\n    opacity:.5;text-align:right;line-height:1.7}\n\n  #sitenav{position:absolute;left:50%;top:56px;transform:translateX(-50%);z-index:11;\n    display:flex;gap:7px;flex-wrap:wrap;justify-content:center;max-width:70vw}\n  #sitenav button{background:#0e1626cc;border:1px solid #243049;color:#cdd9ec;border-radius:20px;\n    padding:6px 13px;font-size:12px;font-weight:700;cursor:pointer;backdrop-filter:blur(6px);transition:.16s}\n  #sitenav button:hover{border-color:var(--gold);color:#fff;box-shadow:0 0 0 1px var(--gold)}\n  #sitenav button.hub{border-color:#3a4f7a}\n  #btn-summary{position:absolute;left:50%;top:14px;transform:translateX(-50%);z-index:11;\n    background:linear-gradient(135deg,#16203a,#1a1622);border:1px solid var(--gold);\n    color:var(--gold);border-radius:11px;padding:8px 18px;font-size:13px;font-weight:800;\n    cursor:pointer;backdrop-filter:blur(8px);letter-spacing:.5px}\n  #btn-summary:hover{box-shadow:0 0 0 1px var(--gold)}\n\n  /* ---------- Сводка ---------- */\n  #summary{position:absolute;inset:0;z-index:25;background:#05070bf5;backdrop-filter:blur(5px);\n    display:none;overflow:auto;padding:58px 5vw 48px}\n  #summary .wrapinner{max-width:1180px;margin:0 auto}\n  #summary h2{margin:0;font-size:23px;letter-spacing:1px;\n    background:linear-gradient(90deg,#6aa6ff,#ffd36a);-webkit-background-clip:text;\n    background-clip:text;color:transparent}\n  .sum-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:13px}\n  .sum-card{background:#0d1320;border:1px solid var(--line);border-radius:14px;padding:16px 17px}\n  .sum-card .cap{font-size:11px;text-transform:uppercase;letter-spacing:1px;opacity:.55}\n  .sum-card .big{font-size:27px;font-weight:800;margin-top:7px;line-height:1}\n  .sum-card .sm{font-size:12px;opacity:.7;margin-top:6px}\n  .sbar{height:9px;border-radius:5px;background:#16203a;overflow:hidden;margin-top:11px;display:flex}\n  .sbar > i{display:block;height:100%}\n  .sect-h{font-size:13px;text-transform:uppercase;letter-spacing:1.5px;opacity:.6;\n    margin:26px 0 13px;display:flex;align-items:center;gap:10px}\n  .sect-h::after{content:\"\";flex:1;height:1px;background:var(--line)}\n  /* hero-полоса ключевых цифр */\n  .hero-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:13px}\n  .hero-card{position:relative;border-radius:16px;padding:16px 17px;overflow:hidden;\n    background:linear-gradient(135deg,#0f1830,#16101c);border:1px solid #2a3550}\n  .hero-card::before{content:\"\";position:absolute;inset:0;\n    background:linear-gradient(135deg,#1f6fff22,transparent 45%,#e23a3a18);pointer-events:none}\n  .hero-card .cap{font-size:10.5px;text-transform:uppercase;letter-spacing:1px;opacity:.62}\n  .hero-card .big{font-size:30px;font-weight:900;margin-top:6px;line-height:1;\n    background:linear-gradient(90deg,#9cc4ff,#ffd36a);-webkit-background-clip:text;background-clip:text;color:transparent}\n  .hero-card .sm{font-size:11.5px;opacity:.72;margin-top:7px}\n  .hero-card.danger .big{background:linear-gradient(90deg,#ff8a8a,#ffb36a);-webkit-background-clip:text;background-clip:text;color:transparent}\n  .hero-card.green .big{background:linear-gradient(90deg,#7ee29a,#bff07a);-webkit-background-clip:text;background-clip:text;color:transparent}\n  .sum-tbl{width:100%;border-collapse:collapse;font-size:13px}\n  .sum-tbl td{padding:9px 12px;border-bottom:1px solid #1b2536}\n  .sum-tbl tr:last-child td{border-bottom:0}\n  .sum-tbl td.r{text-align:right;font-variant-numeric:tabular-nums;font-weight:700}\n  .chartbox{background:#0d1320;border:1px solid var(--line);border-radius:14px;padding:16px 18px}\n  .chart{display:flex;align-items:flex-end;gap:6px;height:140px;margin-top:6px}\n  .chart .col{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:3px;height:100%}\n  .chart .col .b{width:70%;border-radius:4px 4px 0 0;background:linear-gradient(180deg,#3a8bff,#1f6fff);min-height:2px}\n  .chart .col .b2{width:46%;border-radius:3px 3px 0 0;background:#e23a3a99;min-height:2px;margin-top:-2px}\n  .chart .col .mn{font-size:10px;opacity:.5;margin-top:3px}\n  .chip{display:inline-block;font-size:11px;padding:3px 10px;border-radius:20px;background:#16203a;margin:0 6px 6px 0}\n  /* вкладки сводки */\n  .sum-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 20px;position:sticky;top:0;\n    background:#05070bf0;padding:6px 0;z-index:3}\n  .sum-tab{background:#0e1626;border:1px solid #243049;color:#aebbcf;border-radius:24px;\n    padding:9px 18px;font-size:14px;font-weight:700;cursor:pointer;transition:.18s}\n  .sum-tab:hover{border-color:#3a4f7a;color:#dce6f4}\n  .sum-tab.on{background:linear-gradient(135deg,#1f6fff,#7a3aff);border-color:transparent;\n    color:#fff;box-shadow:0 4px 16px #1f6fff44, inset 0 0 0 1px #d8b15a55}\n  #sum-tabbody{animation:sumfade .22s ease}\n  @keyframes sumfade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}\n  .hero-grid{margin-bottom:4px}\n  .hero-card .big{font-size:34px}\n\n  /* ---------- Досье ---------- */\n  #drawer{position:absolute;top:0;right:0;height:100%;width:min(430px,88vw);\n    background:#0a0e18f2;border-left:2px solid;border-image:linear-gradient(180deg,var(--blue),var(--red)) 1;\n    backdrop-filter:blur(14px);z-index:30;transform:translateX(110%);\n    transition:transform .28s cubic-bezier(.2,.8,.2,1);box-shadow:-20px 0 60px #000a;overflow-y:auto}\n  #drawer.open{transform:translateX(0)}\n  #drawer .dh{padding:18px 20px 14px;border-bottom:1px solid var(--line);display:flex;\n    gap:14px;align-items:center;position:sticky;top:0;background:#0a0e18f8;z-index:2}\n  #drawer .dh .ava{width:56px;height:56px;border-radius:13px;\n    background:linear-gradient(135deg,#16203a,#241620);display:flex;align-items:center;\n    justify-content:center;font-size:27px;border:1px solid #2a3550}\n  #drawer .dh h2{margin:0;font-size:18px}\n  #drawer .dh .role{font-size:12px;color:var(--gold);margin-top:3px}\n  #drawer .dh .pres{font-size:11px;opacity:.6;margin-top:2px}\n  #drawer .dx{margin-left:auto;cursor:pointer;font-size:23px;opacity:.6;line-height:1}\n  #drawer .body{padding:16px 20px 44px}\n  #drawer .kpis{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px}\n  #drawer .kpi{background:#111726;border:1px solid #20293a;border-radius:11px;padding:11px 12px}\n  #drawer .kpi .v{font-size:21px;font-weight:800;line-height:1}\n  #drawer .kpi .k{font-size:10.5px;opacity:.6;margin-top:5px;text-transform:uppercase;letter-spacing:.4px}\n  #drawer h3{font-size:12px;text-transform:uppercase;letter-spacing:1px;opacity:.55;margin:18px 0 10px}\n  .wrow{background:#0f1522;border:1px solid #1d2636;border-radius:11px;padding:11px 12px;margin-bottom:9px}\n  .wrow .t{font-weight:600;font-size:13.5px}\n  .wrow .meta{font-size:11.5px;opacity:.72;margin-top:4px;display:flex;flex-wrap:wrap;gap:10px}\n  .bar{height:7px;border-radius:4px;background:#16203a;overflow:hidden;margin-top:8px}\n  .bar > i{display:block;height:100%;border-radius:4px}\n  .pill{display:inline-block;font-size:10.5px;padding:2px 8px;border-radius:20px;background:#16203a}\n  .good{color:#3fb950}.warn{color:#d29922}.bad{color:#f85149}\n\n  #loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;\n    font-size:15px;opacity:.9;z-index:40;background:#070a10;flex-direction:column;gap:16px;text-align:center}\n  #loading .ring{width:36px;height:36px;border:3px solid #2a3550;\n    border-top-color:var(--gold);border-radius:50%;animation:spin 1s linear infinite}\n  @keyframes spin{to{transform:rotate(360deg)}}";
  const _HUD = "  <div id=\"hud\">\n    <div id=\"logo\">\n      <div class=\"mark\">⚔</div>\n      <div class=\"txt\"><h1>ASGARD&nbsp;SERVICE</h1><div class=\"sub\">КОМАНДНЫЙ ЭКРАН</div></div>\n    </div>\n    <div id=\"runebar\">ᚨᛋᚷᚨᚱᛞ</div>\n    \n  </div>\n\n  <div id=\"topbar\">\n    <div class=\"stat office\"><div class=\"n\" id=\"st-office\">0</div><div class=\"l\">в офисе</div></div>\n    <div class=\"stat field\"><div class=\"n\" id=\"st-field\">0</div><div class=\"l\">на объектах</div></div>\n    <div class=\"stat transit\"><div class=\"n\" id=\"st-transit\">0</div><div class=\"l\">🛫 в пути</div></div>\n    <div class=\"stat home\"><div class=\"n\" id=\"st-home\">0</div><div class=\"l\">удалёнка/дом</div></div>\n    <div id=\"clock\">--:--</div>\n  </div>\n\n  <div id=\"legend\"></div>\n  <div id=\"help\">ЛКМ по герою/борту/объекту — досье · колесо — зум · тащить — карта<br>\n    пробел — пауза · 1–5 — облёт объектов · 0/F — вся карта · S — сводка</div>\n\n  <div id=\"sitenav\"></div>\n  <button id=\"btn-summary\">📊 Сводка года</button>\n  <div id=\"summary\">\n    <div class=\"wrapinner\">\n      <div style=\"display:flex;align-items:center;gap:14px;margin-bottom:8px\">\n        <h2>📊 ASGARD SERVICE · Сводка года — командный отчёт директора</h2>\n        <span id=\"sum-close\" style=\"margin-left:auto;cursor:pointer;font-size:26px;opacity:.6\">✕</span>\n      </div>\n      <div id=\"sum-body\"></div>\n    </div>\n  </div>\n\n  <div id=\"drawer\">\n    <div class=\"dh\">\n      <div class=\"ava\" id=\"d-ava\">🧔</div>\n      <div><h2 id=\"d-name\">—</h2><div class=\"role\" id=\"d-role\">—</div><div class=\"pres\" id=\"d-pres\">—</div></div>\n      <div class=\"dx\" id=\"d-close\">✕</div>\n    </div>\n    <div class=\"body\" id=\"d-body\"></div>\n  </div>";

  function _tok(){ return localStorage.getItem('asgard_token') || localStorage.getItem('auth_token') || ''; }
  function _hdr(){ return { 'Content-Type':'application/json', 'Authorization':'Bearer '+_tok() }; }
  async function _api(p){ try{ const r=await fetch(p,{headers:_hdr()}); return r.ok? await r.json():null; }catch(e){ return null; } }

  // ─── Маппинг РОЛЕЙ для аватара (цвет туники/досье) ───
  const ROLE_RUS = {
    PM:'Руководитель проекта', HEAD_PM:'Главный РП', TO:'Тендерный специалист',
    HEAD_TO:'Глава тендерного', PROC:'Закупщик / снабженец', BUH:'Бухгалтер',
    OFFICE_MANAGER:'Офис-менеджер', DIRECTOR_GEN:'Генеральный директор',
    DIRECTOR_COMM:'Коммерческий директор', DIRECTOR_DEV:'Директор по развитию',
    WAREHOUSE:'Кладовщик', CHIEF_ENGINEER:'Главный инженер', HR:'Кадры', HR_MANAGER:'HR-менеджер', ADMIN:'Администратор'
  };
  // presence status_code → act аватара (только ключи из ACT движка!)
  const STATUS_ACT = { 'оф':'work','уд':'remote','об':'remote','км':'remote','пг':'phone','уч':'work','ск':'work','бн':'home','сс':'home','вх':'home' };
  // валидные действия движка (ACT в office-live-demo) — фолбэк-защита
  const ACT_KEYS = new Set(['work','invoice','tender','estimate','phone','approve','mimir','coffee','smoke','lunch','remote','home']);
  // work_status → фаза для объекта
  function _phase(ws){ return ws || '—'; }

  // Транспорт по item_type рейса
  const KIND_BY_ITEM = { flight:'plane', ticket_to:'plane', ticket_back:'plane', train:'train', transfer:'bus' };

  // ─── Сбор _DATA из реальных API ───
  async function _buildData(){
    const [mapData, liveData, flightsData, summary] = await Promise.all([
      _api('/api/command-map'), _api('/api/command-map/live'),
      _api('/api/command-map/flights'), _api('/api/director-summary')
    ]);
    const sites = (mapData && mapData.sites) || [];
    const people = (liveData && liveData.people) || [];
    const flights = (flightsData && flightsData.flights) || [];

    // STAFF — офисные сотрудники. Для КАЖДОГО считаем ЗОНУ размещения (_zone) и действие (_act).
    //   _zone: 'object' (отмечен «на объекте» об + есть работа) → фигура НА объекте;
    //          'remote' (удалёнка уд, или онлайн+уд) → зона УДАЛЁНКА;
    //          'home'   (офлайн / выходной вх / больничный бн / отпуск сс / НЕ отмечен и не в сети) → зона ДОМ/ОФЛАЙН;
    //          'desk'   (онлайн в офисе / на звонке / просто онлайн без статуса) → стол в опенспейсе.
    // НОВАЯ модель: ВСЕ офисные сотрудники сидят за столами в офисе (online — ярко, offline — приглушённо).
    //   Исключение: отметился «на объекте» (об) → фигура у объекта. Удалёнка (уд) → бейдж 💻 за столом.
    //   Зоны «дома/готовность» — ТОЛЬКО для полевых рабочих (из _DATA.readiness), офисных там НЕТ.
    // Отметка «где я сегодня» (staff_plan) ОПРЕДЕЛЯЕТ ЗОНУ на карте:
    const _HOMEISH = new Set(['вх','бн','сс']);   // выходной/больничный/за свой счёт → ДОМ
    function _zoneOf(p){
      const sc = p.status_code;
      if (sc === 'об' && p.work) return 'object';          // на объекте → к объекту
      if (sc === 'км') return 'object';                    // командировка → к объекту/в путь
      if (sc === 'уд') return 'oremote';                   // удалёнка → зона УДАЛЁНКА (офисная)
      if (_HOMEISH.has(sc)) return 'ohome';                // выходной/больничный/отпуск → зона ДОМ (офисная)
      if (p.role === 'WAREHOUSE') return 'warehouse';      // кладовщик → на складе
      // нет «домашней» отметки: в офисе (оф) / онлайн / без статуса → за стол
      return 'desk';
    }
    const staff = people.map(p => {
      const zone = _zoneOf(p);
      const female = /(а|я)s*$/.test((p.name||'').split(' ')[0]) || false;
      let act;
      if (p.on_call) act = 'phone';
      else if (zone === 'remote') act = 'remote';
      else if (zone === 'home') act = 'home';
      else if (p.online) act = (STATUS_ACT[p.status_code] || 'work');
      else act = 'work';
      if (!ACT_KEYS.has(act)) act = 'work';            // защита: только валидные действия движка
      return {
        user_id: p.user_id, name: p.name || ('Сотрудник #'+p.user_id), role: p.role, rus: ROLE_RUS[p.role] || p.role,
        female, online: !!p.online, on_call: !!p.on_call, status_code: p.status_code || null,
        status_label: p.status_label || null, work: p.work, idle: !!p.idle, self_act: p.self_act || null,
        _zone: zone, _act: act, doing: p.doing
      };
    });

    // worker-объект под движок из РЕАЛЬНОГО досье (никакой генерации!)
    let _wid = 1;
    function _mkCrew(c){
      return {
        wid: _wid++, name: c.name || ('Раб. #'+_wid), master: !!c.master, status: c.status || 'site',
        spec: c.spec || (c.master ? 'Бригадир / мастер' : 'Рабочий'),
        grade: c.grade || null,
        permits: Array.isArray(c.permits) ? c.permits : [],
        shift: c.shift || null,
        employ: c.employ || 'Штат',
        rate: (c.rate!=null) ? c.rate : null,
        city: c.city || null, phone: c.phone || null,
        date_from: c.date_from || null, date_to: c.date_to || null,
        medOk: c.status!=='medical', checkin: c.status==='site' ? 'сегодня' : null
      };
    }

    // SITE_META + WORKS из реальных sites. Координаты — по lat/lng на карте (репроекция в движке).
    const siteMeta = {}; const works = [];
    const crewResults = await Promise.all(sites.map(s => _api('/api/command-map/site/' + s.id + '/crew')));
    let hasPlatform = false;
    sites.forEach((s, i) => {
      const key = String(s.id);
      const typeMap = { platform:'platform', plant:'plant', gas:'gas', object:'plant' };
      const type = typeMap[s.site_type] || 'plant';
      if (type === 'platform') hasPlatform = true;
      const realCrew = (crewResults[i] && crewResults[i].crew) || [];
      const crew = realCrew.map(_mkCrew);
      siteMeta[key] = {
        name: s.name || ('Объект #' + s.id), type,
        lat: s.lat, lng: s.lng,                 // для проекции на карту
        x: 2750 + (i%3)*560, y: 280 + Math.floor(i/3)*460,  // временно (репроекция geoToScreen в движке)
        w: 360, h: 280,
        pm: (s.works && s.works[0] && s.works[0].pm_name) || '',
        lodging: 'общежитие', lodgeName: 'Вахтовый посёлок',
        customer: s.customer_name || '', site_id: s.id,
        crew: crew
      };
      (s.works || []).forEach(w => works.push({
        id: w.work_title, t: w.work_title, object: key, pm: w.pm_name || '',
        phase: _phase(w.work_status), ready: 100, daysLeft: null,
        margin: null, profit: null, workers: (w.workers||0)+(w.masters||0), on_shift: w.on_shift||0
      }));
    });

    // ПЛАТФОРМА всегда видна (даже без работ) — добавляем синтетический морской объект, если в БД нет platform.
    if (!hasPlatform) {
      const pk = 'platform0';
      siteMeta[pk] = {
        name: 'МЛСП (шельф)', type: 'platform',
        lat: 69.25, lng: 57.30,               // Печорское море (Приразломная ~)
        x: 3300, y: 360, w: 360, h: 280,
        pm: '', lodging: 'судно', lodgeName: 'Судно-отель',
        customer: '', site_id: null, crew: [], _placeholder: true
      };
      works.push({ id:'platform0_idle', t:'Платформа на дежурстве', object: pk,
        phase:'Без активных работ', ready:100, daysLeft:null, margin:null, profit:null, workers:0, on_shift:0 });
    }

    // дружина дома: готовность (ready/not_ready) — реальные field-рабочие (без архива/тестов)
    const readiness = (await _api('/api/command-map/readiness')) || { people: [], summary: {} };

    // ROUTES из рейсов: один маршрут на объект назначения, вид транспорта по item_type.
    const routeByKey = {};
    flights.forEach(f => {
      if (!f.site || f.site.id == null) return;
      const key = String(f.site.id);
      if (routeByKey[key]) return;
      const kind = KIND_BY_ITEM[f.item_type] || 'plane';
      routeByKey[key] = { siteKey: key, kind, label: (f.transport_no? f.transport_no+' · ':'') + (f.site.name||'рейс') };
    });
    const routes = Object.values(routeByKey);

    return { staff, siteMeta, works, routes, flights, summary, sites, readiness };
  }

  let _destroy = null;

  async function render({ layout, title }) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = '#/login'; return; }
    const allowed = ['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','HEAD_PM','HEAD_TO'];
    if (!allowed.includes(auth.user.role)) { AsgardUI.toast('Доступ','Раздел для директоров','err'); location.hash='#/home'; return; }

    // CSS HUD (один раз)
    if (!document.getElementById('ofl-css')) {
      const st = document.createElement('style'); st.id = 'ofl-css'; st.textContent = _CSS;
      document.head.appendChild(st);
    }
    const wrapHtml = '<div id="ofl-wrap" style="position:relative;width:100%;height:calc(100vh - 120px);min-height:520px;border-radius:14px;overflow:hidden;background:#070a10;border:1px solid #243049">' +
      '<div id="ofl-loading" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#9fb0c4;font-size:15px;z-index:50">Загрузка живого офиса…</div>' +
      _HUD + '</div>';
    await layout(wrapHtml, { title: title || 'Командный экран', motto: 'Видеть всё поле — побеждать' });

    const _MOUNT = document.getElementById('ofl-wrap');
    if (!window.PIXI) { _MOUNT.innerHTML = '<div style="padding:24px;color:#9fb0c4">PIXI не загружен</div>'; return; }

    const _DATA = await _buildData();
    const ld = document.getElementById('ofl-loading'); if (ld) ld.remove();

    // ── боевой движок (порт демо) ──
    try {
      _destroy = _boot(_MOUNT, _DATA);
    } catch (e) {
      console.error('[OfficeLive] boot error:', e);
      _MOUNT.innerHTML = '<div style="padding:24px;color:#f85149">Ошибка отрисовки: ' + (e && e.message) + '</div>';
    }

    // ── Фаза 3: применить реальные сигналы сразу + поллить /live каждые 20с ──
    try { if (window.__oflApplyLive) window.__oflApplyLive(((await _api('/api/command-map/live'))||{}).people || []); } catch(e){}
    const _livePoll = setInterval(async () => {
      try { const d = await _api('/api/command-map/live'); if (d && d.people && window.__oflApplyLive) window.__oflApplyLive(d.people); } catch(e){}
    }, 20000);

    // ── Фаза 3: панель самоотметки ☕/💨/🍖 (POST /self-act) ──
    _mountSelfActBar(_MOUNT);

    // очистка при уходе
    window.addEventListener('hashchange', function cleanup(){
      if (location.hash.indexOf('command-map') === -1) {
        try { clearInterval(_livePoll); } catch(e){}
        try { _destroy && _destroy(); } catch(e){}
        window.removeEventListener('hashchange', cleanup);
      }
    });
  }

  // Панель самоотметки текущего пользователя (его аватар на карте сменит действие).
  function _mountSelfActBar(mount){
    if (mount.querySelector('#ofl-selfact')) return;
    const bar = document.createElement('div');
    bar.id = 'ofl-selfact';
    bar.style.cssText = 'position:absolute;left:50%;bottom:14px;transform:translateX(-50%);z-index:60;display:flex;gap:8px;background:rgba(10,14,24,.86);border:1px solid #2a3550;border-radius:24px;padding:7px 10px;backdrop-filter:blur(6px)';
    const acts = [['', '🟢 в строю'], ['coffee', '☕ кофе'], ['smoke', '💨 перекур'], ['lunch', '🍖 обед']];
    bar.innerHTML = acts.map(a =>
      '<button data-act="' + a[0] + '" style="border:1px solid #2a3550;background:#111726;color:#cdd9ec;border-radius:18px;padding:6px 13px;font-size:13px;font-weight:700;cursor:pointer">' + a[1] + '</button>'
    ).join('');
    bar.querySelectorAll('button').forEach(b => b.onclick = async () => {
      bar.querySelectorAll('button').forEach(x => { x.style.background = '#111726'; x.style.color = '#cdd9ec'; });
      b.style.background = 'linear-gradient(135deg,#1f6fff,#7a3aff)'; b.style.color = '#fff';
      try { await fetch('/api/daily-presence/self-act', { method:'POST', headers:_hdr(), body: JSON.stringify({ act: b.dataset.act || null }) }); } catch(e){}
      // тут же отразить на своём аватаре (не ждать полла)
      try {
        const a = AsgardAuth.getAuth();
        if (a && a.user && window.__oflApplyLive) window.__oflApplyLive([{ user_id: a.user.id, online:true, self_act: b.dataset.act || null }]);
      } catch(e){}
    });
    mount.appendChild(bar);
  }

  // _boot(mountEl, data) — тело демо-движка (см. scripts/build-office-live.js).
  function _boot(_MOUNT, _DATA) {
    // трекер window-листенеров (снимаются в destroy, чтобы не текли между переходами SPA)
    const _winListeners = [];
    function _W(ev, fn, opts){ window.addEventListener(ev, fn, opts); _winListeners.push([ev, fn, opts]); }
  // ======================================================================
  //  ASGARD SERVICE — командный экран директора (ДЕМО, всё векторно).
  //  Никаких внешних спрайтов — рисуем PIXI.Graphics: чётко на любом зуме.
  //  Поведение/метрики имитируются, структура — под реальные данные CRM.
  // ======================================================================

  // ---------- палитра ----------
  const COL = {
    gold:0xd8b15a, blue:0x1f6fff, red:0xe23a3a,
    floor:0x171d2a, floor2:0x1b2233, wall:0x2a3550, beam:0x3a2c1c,
    carpet:0x2a1d2a, deskTop:0x6b4f37, deskEdge:0x4a3624,
    sea:0x12314a, sea2:0x163a57, snow:0x223040, snow2:0x26384a,
    steel:0x49586b, steelD:0x35404f, mon:0x0b1320, scr:0x3aa0ff,
  };
  const FONT = 'Segoe UI, Arial, sans-serif';
  function label(txt,size,fill,wt){ return new PIXI.Text(txt,{fontFamily:FONT,fontSize:size,
    fill:fill,fontWeight:wt||'700',stroke:0x05070b,strokeThickness:Math.max(3,size/4),
    align:'center'}); }
  // смешать два цвета 0xRRGGBB с долей t (0..1) второго
  function mix(a,b,t){ const ar=(a>>16)&255,ag=(a>>8)&255,ab=a&255,
    br=(b>>16)&255,bg=(b>>8)&255,bb=b&255;
    const r=Math.round(ar+(br-ar)*t),g=Math.round(ag+(bg-ag)*t),bl=Math.round(ab+(bb-ab)*t);
    return (r<<16)|(g<<8)|bl; }

  // ---------- приложение ----------
  const app = new PIXI.Application({ resizeTo:_MOUNT, antialias:true,
    backgroundColor:0x070a10, autoDensity:true, resolution:Math.min(window.devicePixelRatio||1,2) });
  _MOUNT.appendChild(app.view);
  PIXI.Text.defaultResolution = Math.min(window.devicePixelRatio||1,2);

  const world = new PIXI.Container(); world.sortableChildren = true; app.stage.addChild(world);

  // ---------- симулированный календарь (демо-ускорение времени) ----------
  // Реальные данные: field_logistics.date_from/date_to (DATE) + departure_at/arrival_at (TIMESTAMP, добавить).
  // В демо «ускоряем» время: 1 сим-сутки ≈ DAY_MS реальных мс. Перелёт длится свои реальные часы → плавно.
  // SIM убран: используем реальное время.
  function simNow(){ return Date.now(); }
  function simFmt(ts){ const d=new Date(ts);
    const dd=String(d.getDate()).padStart(2,'0'), mm=String(d.getMonth()+1).padStart(2,'0');
    const hh=String(d.getHours()).padStart(2,'0'), mi=String(d.getMinutes()).padStart(2,'0');
    return dd+'.'+mm+' '+hh+':'+mi; }
  function simDateShort(ts){ const d=new Date(ts); return String(d.getDate()).padStart(2,'0')+'.'+String(d.getMonth()+1).padStart(2,'0'); }
  const HOUR=3600000, DAY=86400000;

  // ======================= КОМПОНОВКА (ГЕО-КАРТА) =======================
  // ШТАБ (офис+склад+дом+удалёнка+архив+хаб) — левый кластер. Объекты разнесены ДАЛЕКО
  // по «географии»: между ними большие биом-зоны, по которым летят/едут вахты.
  const TOTAL_W = 4200, TOTAL_H = 2700;

  // --- ШТАБ слева ---
  // размеры зон считаем из реальных счётчиков (растягиваются, чтобы все влезли)
  const _officeN  = (_DATA.staff||[]).filter(s=>(s._zone||'desk')==='desk').length;   // только «в офисе» за столами
  const _oremoteN = (_DATA.staff||[]).filter(s=>s._zone==='oremote').length;          // офисные на удалёнке
  const _ohomeN   = (_DATA.staff||[]).filter(s=>s._zone==='ohome').length;            // офисные дома (выходной/больн./отпуск)
  const _rdyPpl  = (_DATA.readiness&&_DATA.readiness.people)||[];
  const _readyN    = _rdyPpl.filter(p=>p.ready).length;
  const _notReadyN = _rdyPpl.length - _readyN;
  // ОФИС (HALL): сетка столов до 6 в ряд, высота под число рядов
  const _deskCols = Math.max(1, Math.min(6, Math.ceil(Math.sqrt(Math.max(1,_officeN)))));
  const _deskRows = Math.max(1, Math.ceil(Math.max(1,_officeN)/_deskCols));
  const HALL = { x:470, y:760, w: Math.max(1180, 150+ _deskCols*270 +90), h: Math.max(300, 150+ _deskRows*180 +60) };
  // высота офисной зоны под число фигур (по ~110px на фигуру в ряд)
  function _ozoneH(n, w){ const cols=Math.max(1,Math.floor((w-40)/96)); const rows=Math.ceil(Math.max(1,n)/cols); return Math.max(96, 44+rows*72); }
  // УДАЛЁНКА и ДОМ (офисные) — две полосы НАД офисом
  const OREMOTE = { x:HALL.x, y:0, w:HALL.w*0.5-8, h:_ozoneH(_oremoteN, HALL.w*0.5-8) };
  const OHOME   = { x:HALL.x+HALL.w*0.5+8, y:0, w:HALL.w*0.5-8, h:_ozoneH(_ohomeN, HALL.w*0.5-8) };
  const _topH = Math.max(OREMOTE.h, OHOME.h);
  OREMOTE.y = HALL.y - _topH - 26; OHOME.y = OREMOTE.y;
  const REMOTE = { x:HALL.x, y:HALL.y-2, w:0, h:0 };   // legacy (не используется)
  const WARE   = { x:80, y:HALL.y+30, w:350, h: Math.min(HALL.h-60, 560) };
  // ДРУЖИНА (полевые): слева ГОТОВЫ, справа НЕ ГОТОВЫ. Высота под число с учётом сжатия фигур.
  function _zoneH(n, w){ const cols=Math.max(3, Math.floor((w-30)/Math.max(22,Math.min(46,Math.sqrt((w-30)*180/Math.max(1,n)))))); const rows=Math.ceil(Math.max(1,n)/cols); return Math.max(120, 50+rows*Math.min(42,Math.max(22,((w-30)/cols)))); }
  const _homeW = HALL.w*0.52-14, _arW = HALL.w*0.48-10;
  const HOME   = { x:HALL.x, y:HALL.y+HALL.h+24, w:_homeW, h: _zoneH(_readyN, _homeW) };
  const ARCH   = { x:HALL.x+HALL.w*0.52+10, y:HALL.y+HALL.h+24, w:_arW, h: _zoneH(_notReadyN, _arW) };
  // --- ХАБ ВАХТЫ (аэропорт-вокзал) — точка отправки/возврата, под штабом ---
  const HUB = { x:HALL.x+HALL.w*0.5-230, y: Math.max(HOME.y+HOME.h, ARCH.y+ARCH.h)+40, w:460, h:170 };
  // --- МЕДЦЕНТР (медосмотр перед вылетом, Москва/Саратов) — координаты заранее (нужны в areaForStatus) ---
  const MEDHUB = { city:'Москва', x:HUB.x+HUB.w+34, y:HUB.y, w:230, h:HUB.h };

  // --- БИОМЫ (большие подложки регионов) ---
  const BIOMES = [
    { key:'sea',    name:'Баренцево море',  x:2550, y:120,  w:1500, h:1000, c1:COL.sea,  c2:COL.sea2 },
    { key:'taiga',  name:'Тайга · Усинск',  x:2050, y:1180, w:900,  h:760,  c1:0x1c2a1e, c2:0x213122 },
    { key:'tundra', name:'Тундра · Варандей',x:3050, y:1180, w:900,  h:760,  c1:COL.snow, c2:COL.snow2 },
    { key:'steppe', name:'Прикаспий · Астрахань', x:2550, y:2000, w:1500, h:620, c1:0x2c2a1c, c2:0x322f20 },
  ];
  // запас слева от объектов под «зону прилёта» оставляем внутри сцены объекта
  const FIELDX = 2600;   // ориентир для совместимости со старым кодом (не критичен)

  // ---------- помощники рисования ----------
  function tiledFloor(g, R, c1, c2, t){ t=t||40;
    for(let y=R.y;y<R.y+R.h;y+=t) for(let x=R.x;x<R.x+R.w;x+=t){
      g.beginFill((((x-R.x)/t+(y-R.y)/t)%2)?c1:c2); g.drawRect(x,y,t,t); g.endFill(); } }
  function panel(R, fill, lineCol, runes){
    const g=new PIXI.Graphics();
    g.beginFill(fill); g.drawRoundedRect(R.x,R.y,R.w,R.h,16); g.endFill();
    g.lineStyle(2.5, lineCol, .85); g.drawRoundedRect(R.x,R.y,R.w,R.h,16); g.lineStyle(0);
    return g;
  }

  // ===== РИСОВАНАЯ КАРТА РОССИИ (подложка) + проекция lat/lng → экран =====
  // нормализованный контур РФ (грубый, узнаваемый силуэт) в координатах 0..1 (x=запад→восток, y=север→юг)
  const RU_OUTLINE = [
    [0.02,0.42],[0.06,0.30],[0.10,0.33],[0.14,0.26],[0.20,0.30],[0.24,0.22],[0.30,0.26],
    [0.34,0.18],[0.42,0.20],[0.46,0.12],[0.52,0.16],[0.58,0.10],[0.64,0.14],[0.70,0.09],
    [0.78,0.13],[0.84,0.08],[0.90,0.12],[0.96,0.10],[0.99,0.18],[0.95,0.24],[0.98,0.30],
    [0.93,0.34],[0.97,0.40],[0.90,0.44],[0.93,0.52],[0.86,0.55],[0.88,0.62],[0.80,0.60],
    [0.78,0.68],[0.70,0.64],[0.66,0.72],[0.58,0.66],[0.52,0.74],[0.46,0.68],[0.40,0.76],
    [0.34,0.70],[0.28,0.78],[0.22,0.72],[0.18,0.80],[0.12,0.72],[0.08,0.62],[0.04,0.54],[0.02,0.42]
  ];
  // прямоугольник карты в мире (правее штаба)
  const MAP = { x: 2350, y: 180, w: 1700, h: 1300 };
  // гео-границы РФ (прибл.): запад 19°E … восток 180°E ; север 78°N … юг 41°N
  const GEO = { lonW: 19, lonE: 179, latN: 78, latS: 41 };
  function geoToScreen(lat, lng){
    if (lat==null || lng==null) return null;
    const fx = Math.max(0, Math.min(1, (lng - GEO.lonW)/(GEO.lonE - GEO.lonW)));
    const fy = Math.max(0, Math.min(1, (GEO.latN - lat)/(GEO.latN - GEO.latS)));
    return { x: MAP.x + fx*MAP.w, y: MAP.y + fy*MAP.h };
  }
  (function(){
    const g=new PIXI.Graphics(); g.zIndex=-1000;
    // фон-океан вокруг
    g.beginFill(0x070d16); g.drawRect(MAP.x-200, MAP.y-160, MAP.w+400, MAP.h+360); g.endFill();
    // суша РФ — заливка по контуру
    const pts = RU_OUTLINE.map(p=>({x:MAP.x+p[0]*MAP.w, y:MAP.y+p[1]*MAP.h}));
    g.lineStyle(2.5, 0x35506e, .85); g.beginFill(0x16202e, 1);
    g.moveTo(pts[0].x, pts[0].y); pts.forEach(p=>g.lineTo(p.x,p.y)); g.closePath(); g.endFill(); g.lineStyle(0);
    // лёгкая внутренняя штриховка-«рельеф»
    g.lineStyle(1, 0x223247, .35);
    for(let i=0;i<26;i++){ const yy=MAP.y+20+i*((MAP.h-40)/26); g.moveTo(MAP.x+30,yy); g.lineTo(MAP.x+MAP.w-30,yy); }
    g.lineStyle(0);
    // надпись
    const tt=new PIXI.Text('РОССИЯ',{fontFamily:FONT,fontSize:30,fill:0x24364c,fontWeight:'900',letterSpacing:8});
    tt.anchor.set(.5); tt.x=MAP.x+MAP.w*0.5; tt.y=MAP.y+MAP.h*0.5; tt.alpha=.5; tt.zIndex=-990;
    world.addChild(g); world.addChild(tt);
  })();
  const seaShips=[];   // (совместимость: тикер ниже обращается к массиву)

  // ======================= ФОН ЗОН =======================
  // чертог-офис: тёплый деревянный пол + ковровые дорожки
  const hallBg = new PIXI.Graphics();
  hallBg.beginFill(0x0b1018); hallBg.drawRoundedRect(HALL.x-4,HALL.y-4,HALL.w+8,HALL.h+8,18); hallBg.endFill();
  tiledFloor(hallBg, HALL, COL.floor, COL.floor2, 44);
  // ковровые дорожки между рядами столов
  for(let i=0;i<3;i++){ const cy=HALL.y+150+i*210;
    hallBg.beginFill(COL.carpet,.5); hallBg.drawRoundedRect(HALL.x+30,cy,HALL.w-60,46,8); hallBg.endFill(); }
  // деревянные балки с золотым руническим орнаментом по верху
  hallBg.beginFill(COL.beam); hallBg.drawRect(HALL.x-4,HALL.y-4,HALL.w+8,20); hallBg.endFill();
  for(let x=HALL.x+10;x<HALL.x+HALL.w-10;x+=70){ hallBg.beginFill(COL.gold,.25);
    hallBg.drawRect(x,HALL.y+1,46,5); hallBg.endFill(); }
  // рамка с сине-красным акцентом
  hallBg.lineStyle(3, COL.blue,.55); hallBg.drawRoundedRect(HALL.x-4,HALL.y-4,HALL.w+8,HALL.h+8,18);
  hallBg.lineStyle(0); hallBg.zIndex=-300; world.addChild(hallBg);

  // факелы-светильники по периметру (мерцают)
  const torches=[];
  [[HALL.x+8,HALL.y+90],[HALL.x+HALL.w-8,HALL.y+90],[HALL.x+8,HALL.y+HALL.h-90],
   [HALL.x+HALL.w-8,HALL.y+HALL.h-90]].forEach(([tx,ty])=>{
    const t=new PIXI.Container(); t.x=tx;t.y=ty; t.zIndex=ty;
    const br=new PIXI.Graphics(); br.beginFill(0x4a3a26); br.drawRect(-3,0,6,22); br.endFill(); t.addChild(br);
    const fl=new PIXI.Graphics(); t.addChild(fl); t.fl=fl;
    const glow=new PIXI.Graphics(); glow.beginFill(0xffae3a,.10); glow.drawCircle(0,-6,42); glow.endFill();
    glow.zIndex=-1; t.addChildAt(glow,0);
    world.addChild(t); torches.push(t);
  });

  // щиты с рунами на стене (верх чертога)
  for(let i=0;i<5;i++){ const sx=HALL.x+150+i*220, sy=HALL.y+22;
    const sh=new PIXI.Graphics();
    sh.beginFill(i%2?0x2a3a5e:0x5e2a2a); sh.drawCircle(sx,sy,17); sh.endFill();
    sh.lineStyle(2.5,COL.gold,.8); sh.drawCircle(sx,sy,17); sh.drawCircle(sx,sy,8); sh.lineStyle(0);
    sh.zIndex=-280; world.addChild(sh);
    const rune=label(['ᚨ','ᚱ','ᛟ','ᛋ','ᚷ'][i],14,COL.gold,'800'); rune.anchor.set(.5);
    rune.x=sx; rune.y=sy; rune.zIndex=-279; world.addChild(rune); }

  // заголовок чертога
  const hallTitle = label('⚔  ВАЛЬХАЛЛА · ОФИС ASGARD SERVICE  ⚔',19,COL.gold,'800');
  hallTitle.anchor.set(.5,0); hallTitle.x=HALL.x+HALL.w/2; hallTitle.y=HALL.y+38; hallTitle.zIndex=-150;
  world.addChild(hallTitle);

  // ---- зональные панели (удалёнка / склад / дом / архив) ----
  function zone(R, title, fill, lineCol, emoji){
    const g=panel(R, fill, lineCol); g.zIndex=-260; world.addChild(g);
    tiledFloor(g, R, fill, fill); // фон уже залит; оставляем рамку
    const t=label(emoji+'  '+title,14,0xcdd9ec,'800'); t.anchor.set(.5,0);
    t.x=R.x+R.w/2; t.y=R.y+8; t.zIndex=-150; world.addChild(t);
    return g;
  }
  // офисные зоны по отметке: УДАЛЁНКА (уд) и ДОМ (выходной/больничный/отпуск) — НАД офисом
  if(OREMOTE.h>0) zone(OREMOTE,'УДАЛЁНКА', 0x101a2e, 0x2e6bd6, '💻');
  if(OHOME.h>0) zone(OHOME,'ДОМ · не работают сегодня', 0x1a1420, 0x6b5b3a, '🏠');
  zone(HOME, 'ДРУЖИНА · ГОТОВЫ к выезду', 0x0e1c12, 0x2e7d4f, '✅');
  zone(ARCH, 'ДРУЖИНА · НЕ ГОТОВЫ', 0x1c160e, 0x7d5e2e, '⏳');

  // ======================= СКЛАД (слева, детальный) =======================
  (function(){
    const g=panel(WARE, 0x10151f, 0x8a7a4a); g.zIndex=-260; world.addChild(g);
    const det=new PIXI.Graphics(); det.zIndex=WARE.y;
    // ворота склада
    det.beginFill(0x1c2533); det.drawRect(WARE.x+WARE.w/2-34,WARE.y+WARE.h-10,68,10); det.endFill();
    // стеллажи с разноцветными ящиками
    for(let r=0;r<4;r++) for(let c=0;c<4;c++){
      const bx=WARE.x+34+c*78, by=WARE.y+70+r*120;
      det.beginFill(0x3a2e1d); det.drawRect(bx,by+34,64,8); det.endFill();          // полка
      det.beginFill(0x33415a); det.drawRect(bx-3,by-2,70,40); det.endFill();         // короб-каркас
      const boxc=[0x6b8cae,0xae6b6b,0x6bae7e,0xae9b6b,0x8b6bae,0x6baea0];
      det.beginFill(boxc[(r+c)%6]); det.drawRect(bx+4,by+6,26,26); det.endFill();
      det.beginFill(boxc[(r*c+2)%6]); det.drawRect(bx+34,by+10,24,22); det.endFill();
      det.lineStyle(1,0x000000,.25); det.moveTo(bx+4,by+19); det.lineTo(bx+30,by+19); det.lineStyle(0);
    }
    world.addChild(det);
    const t=label('📦  СКЛАД · МИДГАРД',14,0xd9c79a,'800'); t.anchor.set(.5,0);
    t.x=WARE.x+WARE.w/2; t.y=WARE.y+8; t.zIndex=-150; world.addChild(t);
    const hit=new PIXI.Graphics(); hit.beginFill(0xffffff,.001); hit.drawRect(WARE.x,WARE.y,WARE.w,WARE.h); hit.endFill();
    hit.eventMode='static'; hit.cursor='pointer'; hit.zIndex=WARE.y+1;
    hit.on('pointertap',()=>{ if(!drag.moved){ const wm=STAFF.find(x=>x.role==='WAREHOUSE'); if(wm) openDrawer(wm); } });
    world.addChild(hit);
  })();

  // ===== МИМИР · ИИ-панель (компактный голо-экран на стойке) =====
  const wellX=HALL.x+HALL.w/2, wellY=HALL.y+HALL.h-70;
  const well=new PIXI.Container(); well.x=wellX; well.y=wellY; well.zIndex=wellY-1; world.addChild(well);
  (function(){
    const g=new PIXI.Graphics();
    // тень
    g.beginFill(0x000000,.28); g.drawEllipse(0,18,40,8); g.endFill();
    // стойка/основание
    g.beginFill(0x1a2230); g.drawRoundedRect(-7,4,14,16,3); g.endFill();
    g.beginFill(0x232f40); g.drawRoundedRect(-22,16,44,6,3); g.endFill();
    // рамка экрана (наклонный планшет)
    g.lineStyle(2,0x2bd4c9,.55);
    g.beginFill(0x0c1620); g.drawRoundedRect(-46,-44,92,52,8); g.endFill();
    g.lineStyle(0);
    // голо-заливка экрана (бирюзовый градиент полосами)
    for(let i=0;i<9;i++){ const t=i/9; g.beginFill(mix(0x0c2330,0x123a44,t),.85); g.drawRect(-43,-41+i*5.4,86,5.4); }
    g.endFill();
    // «нейросеть» — узлы и связи
    g.lineStyle(1,0x4fe6da,.5);
    const nodes=[[-30,-30],[-10,-20],[8,-32],[26,-22],[-18,-8],[14,-10],[0,-26]];
    nodes.forEach((n,i)=>{ const m=nodes[(i+2)%nodes.length]; g.moveTo(n[0],n[1]); g.lineTo(m[0],m[1]); });
    g.lineStyle(0); g.beginFill(0x6ef0e6,.9); nodes.forEach(n=>g.drawCircle(n[0],n[1],1.8)); g.endFill();
    // блик стекла
    g.beginFill(0xffffff,.07); g.drawPolygon([-43,-41, -20,-41, -34,8, -43,8]); g.endFill();
    well.addChild(g); well.glow=g;
  })();
  const wlbl=label('🧠 МИМИР · ИИ-аналитик',12,0x6ef0e6,'800');
  wlbl.anchor.set(.5,0); wlbl.x=wellX; wlbl.y=wellY+24; wlbl.zIndex=9000; world.addChild(wlbl);
  // mimir-аватар = парящий «глаз»-дрон ИИ перед экраном (компактный)
  const mimir=new PIXI.Container(); mimir.x=wellX; mimir.y=wellY-22; mimir.zIndex=wellY; world.addChild(mimir);
  (function(){
    const g=new PIXI.Graphics();
    g.lineStyle(1.5,0x2bd4c9,.8); g.beginFill(0x10202a); g.drawCircle(0,0,9); g.endFill(); g.lineStyle(0);
    g.beginFill(0x2bd4c9,.9); g.drawCircle(0,0,4.5); g.endFill();
    g.beginFill(0xeafff9); g.drawCircle(-1.2,-1.2,1.8); g.endFill();
    g.beginFill(0x6ef0e6,.25); g.drawCircle(0,0,13); g.endFill();
    mimir.addChild(g);
  })();

  // ======================= ОБЪЕКТЫ (справа) =======================
  function fire(parent,x,y,scale){ // факел/факельная стрела с анимацией
    const f=new PIXI.Graphics(); f.x=x;f.y=y; f.scale.set(scale||1); parent.addChild(f); return f; }
  function smoke(parent,x,y){ const s=new PIXI.Graphics(); s.x=x;s.y=y; parent.addChild(s); return s; }

  // ---- генератор досье рабочего (вахтовая модель: смены, статусы) ----
  // status: 'site' (на объекте/на смене), 'rest' (комната отдыха), 'sleep' (спит в общежитии/на судне),
  //         'transit' (в дороге на объект), 'medical' (медосмотр)
  const SPEC = ['Слесарь-монтажник','Сварщик НАКС','Дефектоскопист','Электромонтёр','Стропальщик',
                'Изолировщик','Машинист крана','Газорезчик','Трубопроводчик','Аппаратчик'];
  const PERMITS_POOL = ['Высота','Газоопасные','ОЗП','НАКС','Стропальщик','Электробезопасность III гр.',
                        'ПБ (пожарная)','ГПМ (краны)'];
  let _wid=1;
  function mkWorker(name, isMaster, opts){
    opts=opts||{};
    name = (name==null||name==='') ? 'Сотрудник' : String(name);
    const seed = name.length + (name.charCodeAt(0)||0);
    const spec = isMaster ? 'Бригадир / мастер СМР' : SPEC[seed % SPEC.length];
    const nperm = isMaster?4:(2+seed%3);
    const permits=[]; for(let i=0;i<nperm;i++) permits.push(PERMITS_POOL[(seed+i*3)%PERMITS_POOL.length]);
    const rate = isMaster ? 6200 : (3800 + (seed%7)*180);   // ₽/смена
    const shift = (seed%2) ? 'day' : 'night';
    return {
      wid:_wid++, name, master:!!isMaster, spec,
      permits:[...new Set(permits)],
      shift,                                   // day/night
      status: opts.status || 'site',
      employ: isMaster ? 'Штат' : ((seed%3===0)?'Самозанятый':'Штат'),
      rate, daysOn: 8+seed%16, daysLeft: 6+seed%20,
      medOk: opts.status!=='medical', medDate: '0'+(1+seed%9)+'.06.2026',
      docOk: (seed%5!==0),
      checkin: opts.status==='site' ? ('сегодня '+(shift==='day'?'08:0':'20:0')+seed%9) : null,
    };
  }

  // ---- массовая генерация бригады по раскладке статусов ----
  const NAMES_POOL = ['Магнус','Хаки','Олег','Свен','Ульф','Грим','Аки','Бьорг','Туре','Эрик','Коль','Рут',
    'Сигурд','Сван','Ярл','Бер','Снур','Гест','Торд','Гуни','Хальф','Регин','Вёлунд','Аск','Эмбла','Скёль',
    'Фроди','Ингвар','Сёльви','Хравн','Колль','Стейн','Хьюки','Дан','Орвар','Бьярки','Лейв','Кетиль','Снорри',
    'Хёгни','Вест','Гаут','Ринг','Тости','Фарман','Эйстен','Сигват','Тьодольв','Бранд','Хольти'];
  let _nameI=0;
  function nm(){ const n=NAMES_POOL[_nameI%NAMES_POOL.length]+' '+
    String.fromCharCode(1040+(_nameI*7)%32)+'.'; _nameI++; return n; }
  // dist: {site,rest,sleep,transit,medical}; masters — сколько мастеров (на смене)
  function genCrew(dist, masters){
    const crew=[]; masters=masters||0;
    for(let m=0;m<masters;m++) crew.push(mkWorker(nm(),1,{status:'site'}));
    Object.entries(dist).forEach(([st,n])=>{ for(let i=0;i<n;i++) crew.push(mkWorker(nm(),0,{status:st})); });
    return crew;
  }

  // ОБЪЕКТЫ/РАБОТЫ — из реальных данных (data.sites уже сгруппированы по работам на бэке).
  const SITE_META = _DATA.siteMeta;   // {key:{name,type,x,y,w,h,pm,lodging,lodgeName,crew:[]}}
  const WORKS = _DATA.works;           // [{id,t,object,pm,phase,ready,daysLeft,margin,profit}]
  function buildSitesFromWorks(works, meta){
    const byObj={};
    works.forEach(w=>{ (byObj[w.object]=byObj[w.object]||[]).push(w); });
    return Object.keys(byObj).map(key=>{
      const m=meta[key]||{}; const jobs=byObj[key].map(w=>({t:w.t,phase:w.phase,ready:w.ready,daysLeft:w.daysLeft,id:w.id}));
      return Object.assign({ key, jobs, worksCount:jobs.length }, m);
    });
  }
  const SITES = buildSitesFromWorks(WORKS, SITE_META);
  (function(){
    let noGeoIdx=0;
    SITES.forEach(s=>{
      const p = geoToScreen(s.lat, s.lng);
      if(p){ s.x = p.x - s.w/2; s.y = p.y - s.h/2; }
      else { s.x = MAP.x + MAP.w + 60; s.y = MAP.y + 40 + (noGeoIdx++)*(s.h+40); }  // без гео — колонкой справа
      s.cx = s.x + s.w/2; s.cy = s.y + s.h/2;
    });
  })();

  // зона размещения (общежитие/судно) — справа от объекта, БЕЗ наложений (объекты разнесены)
  SITES.forEach(s=>{ s.lodge = { x:s.x+s.w+30, y:s.y+s.h*0.16, w:170, h:s.h*0.62 }; });

  SITES.forEach(s=>{
    const g=new PIXI.Graphics(); g.zIndex=-200;
    if(s.type==='platform'){
      // ----- МОРЕ: без жёсткого прямоугольника — мягкое пятно воды поверх биома + волны -----
      const mcx=s.x+s.w/2, mcy=s.y+s.h/2;
      for(let i=7;i>=0;i--){ const f=i/7; g.beginFill(mix(COL.sea2,COL.sea,1-f), .10+.26*(1-f));
        g.drawEllipse(mcx,mcy,s.w*0.5*(0.6+0.5*f),s.h*0.5*(0.6+0.5*f)); g.endFill(); }
      g.lineStyle(1.5,0x3a6f96,.35);
      for(let y=s.y+30;y<s.y+s.h-20;y+=30){ g.moveTo(s.x+20,y); for(let x=s.x+20;x<s.x+s.w-20;x+=24) g.lineTo(x+12,y-4),g.lineTo(x+24,y); }
      g.lineStyle(0);

      const cx=s.x+s.w*0.46, base=s.y+s.h-44;       // уровень моря
      // ===== КЕССОН (массивное гравитационное основание в воде) =====
      g.beginFill(0x2a3340); g.drawRoundedRect(cx-180,base-30,360,64,10); g.endFill();   // подводная часть
      g.beginFill(0x3a4555); g.drawRoundedRect(cx-180,base-30,360,16,8); g.endFill();     // ватерлиния
      g.lineStyle(2,0xe23a3a,.7); g.moveTo(cx-180,base-14); g.lineTo(cx+180,base-14); g.lineStyle(0); // красная марка
      // буруны у основания
      g.beginFill(0xeaf2fb,.16); g.drawEllipse(cx-180,base-12,30,9); g.drawEllipse(cx+180,base-12,30,9); g.endFill();

      // ===== ОСНОВНАЯ ПАЛУБА-ИНТЕГРИРОВАННЫЙ ТОПСАЙД =====
      const dkY=base-110, dkX=cx-170, dkW=340, dkH=82;
      g.beginFill(0x59636f); g.drawRoundedRect(dkX,dkY,dkW,dkH,6); g.endFill();
      g.beginFill(0x6b7682); g.drawRoundedRect(dkX,dkY,dkW,12,6); g.endFill();           // верх. кромка
      g.beginFill(0x3f4855); g.drawRect(dkX,dkY+dkH-10,dkW,10); g.endFill();
      // опорные колонны от кессона к палубе
      g.beginFill(0x44505e); [-150,-60,60,150].forEach(dx=> g.drawRect(cx+dx-9,dkY+dkH-4,18,base-30-(dkY+dkH-4)+6)); g.endFill();
      g.lineStyle(2,0x33404e,.9); [-150,-60,60,150].forEach(dx=>{ g.moveTo(cx+dx-9,dkY+dkH); g.lineTo(cx+dx+9,base-26); }); g.lineStyle(0);

      // ===== ЖИЛОЙ МОДУЛЬ (многоэтажный блок, левый край) =====
      const acX=dkX+10, acY=dkY-78;
      g.beginFill(0xc6d0da); g.drawRoundedRect(acX,acY,96,80,5); g.endFill();
      g.beginFill(0xaeb9c4); g.drawRoundedRect(acX,acY,96,12,5); g.endFill();
      for(let r=0;r<4;r++) for(let cc=0;cc<5;cc++){ g.beginFill(0x2bd4c9,.55+0.08*((r+cc)%2)); g.drawRect(acX+10+cc*16,acY+18+r*15,11,9); g.endFill(); }
      // ВЕРТОЛЁТНАЯ ПЛОЩАДКА над жилым модулем
      g.beginFill(0x394250); g.drawEllipse(acX+48,acY-16,52,16); g.endFill();
      g.lineStyle(2,0xffd86a,.9); g.drawEllipse(acX+48,acY-16,52,16); g.lineStyle(0);
      g.beginFill(0xffd86a,.85); g.drawRect(acX+44,acY-25,8,18); g.drawRect(acX+39,acY-19,18,6); g.endFill(); // «H»

      // ===== БУРОВАЯ ВЫШКА (решётчатая ферма, правее центра) =====
      const tx=cx+60, ty=dkY; const th=150;
      g.lineStyle(3,0xd8b15a,.95);
      g.moveTo(tx-30,ty); g.lineTo(tx,ty-th); g.lineTo(tx+30,ty);             // контур
      g.moveTo(tx-30,ty); g.lineTo(tx+30,ty);
      for(let i=1;i<=5;i++){ const yy=ty-th*i/6, wn=30*(1-i/6.5);
        g.moveTo(tx-wn,yy); g.lineTo(tx+wn,yy); }                              // горизонтали
      for(let i=0;i<6;i++){ const y1=ty-th*i/6, y2=ty-th*(i+1)/6, w1=30*(1-i/6.5), w2=30*(1-(i+1)/6.5);
        g.moveTo(tx-w1,y1); g.lineTo(tx+w2,y2); g.moveTo(tx+w1,y1); g.lineTo(tx-w2,y2); } // раскосы
      g.lineStyle(0);
      g.beginFill(0xd8b15a); g.drawCircle(tx,ty-th-3,4); g.endFill();          // кронблок

      // ===== ТЕХНОЛОГИЧЕСКИЕ КОЛОННЫ / СЕПАРАТОРЫ на палубе =====
      g.beginFill(0x8a929f); g.drawRoundedRect(dkX+dkW-120,dkY-54,18,56,6); g.drawRoundedRect(dkX+dkW-92,dkY-66,18,68,6); g.endFill();
      g.beginFill(0x9aa2af); g.drawRoundedRect(dkX+dkW-120,dkY-54,18,8,4); g.drawRoundedRect(dkX+dkW-92,dkY-66,18,8,4); g.endFill();
      // горизонтальный резервуар
      g.beginFill(0x7a8290); g.drawRoundedRect(dkX+dkW-150,dkY-26,46,20,10); g.endFill();
      g.beginFill(0x8a929f); g.drawRoundedRect(dkX+dkW-150,dkY-26,46,7,6); g.endFill();

      // ===== ФАКЕЛЬНАЯ СТРЕЛА + ОГОНЬ (вынесена в море, правый верх) =====
      const fbX=dkX+dkW, fbY=dkY+6;
      g.lineStyle(5,0x44505e,1); g.moveTo(fbX,fbY); g.lineTo(fbX+92,fbY-70); g.lineStyle(0);
      g.lineStyle(2,0x33404e,.8); g.moveTo(fbX,fbY+10); g.lineTo(fbX+92,fbY-60); g.lineStyle(0);
      s.fire = fire(world, fbX+96, fbY-74, 1.3); s.fire.zIndex=9001;

      // ===== ПОВОРОТНЫЙ КРАН (стрела) =====
      g.beginFill(0xe23a3a,.9); g.drawRect(dkX+20,dkY-150,8,150); g.endFill();    // мачта
      g.lineStyle(4,0xe23a3a,.9); g.moveTo(dkX+24,dkY-150); g.lineTo(dkX+120,dkY-128); g.lineStyle(0);
      g.lineStyle(1.5,0x222,.6); g.moveTo(dkX+110,dkY-130); g.lineTo(dkX+110,dkY-96); g.lineStyle(0); // трос
      g.beginFill(0x222); g.drawRect(dkX+106,dkY-98,8,6); g.endFill();             // крюк
    } else if(s.type==='plant'){
      // ===== ПЛОЩАДКА ЗАВОДА =====
      for(let y=s.y;y<s.y+s.h;y+=44) for(let x=s.x;x<s.x+s.w;x+=44){
        g.beginFill((((x-s.x)/44+(y-s.y)/44)%2)?0x232a20:0x272f24); g.drawRect(x,y,44,44); g.endFill(); }
      const cx=s.x+s.w/2, base=s.y+s.h-42;
      // забор по периметру
      g.lineStyle(2,0x6a6a52,.55); g.drawRect(s.x+16,s.y+46,s.w-32,s.h-78);
      for(let x=s.x+16;x<s.x+s.w-16;x+=22){ g.moveTo(x,s.y+46); g.lineTo(x,s.y+54); } g.lineStyle(0);

      // ===== УСТАНОВКА: ректификационные колонны (узнаваемый силуэт НПЗ) =====
      const colX=cx-118;
      [[colX,150,16],[colX+44,180,18],[colX+92,120,14]].forEach(([bx,hh,r],i)=>{
        g.beginFill(0x7a8290); g.drawRoundedRect(bx-r,base-hh,r*2,hh,r); g.endFill();
        g.beginFill(0x8e96a3); g.drawRoundedRect(bx-r,base-hh,r*2,10,r); g.endFill();   // купол
        g.lineStyle(1.5,0x556,.5); for(let yy=base-hh+18;yy<base;yy+=18){ g.moveTo(bx-r,yy);g.lineTo(bx+r,yy);} g.lineStyle(0); // тарелки
        g.beginFill(0x5a626e); g.drawRect(bx-r-4,base-hh+8,4,hh-8); g.endFill();        // стояк
      });
      // эстакада трубопроводов между колоннами
      g.lineStyle(4,0x9aa2af,.7); g.moveTo(colX,base-90); g.lineTo(colX+92,base-90);
      g.moveTo(colX,base-78); g.lineTo(colX+92,base-78); g.lineStyle(0);
      g.lineStyle(2,0x6a727e,.6); for(let x=colX;x<=colX+92;x+=20){ g.moveTo(x,base-96);g.lineTo(x,base-72);} g.lineStyle(0);

      // ===== РЕЗЕРВУАРНЫЙ ПАРК (цилиндры-цистерны) =====
      [[cx+60,40],[cx+118,52],[cx+72,80]].forEach(([tx,r],i)=>{
        g.beginFill(0x6f7884); g.drawCircle(tx,base-r/2-10,r/2); g.endFill();
        g.beginFill(0x828b97); g.drawEllipse(tx,base-r-10,r/2,r/6); g.endFill();         // крыша-эллипс
        g.lineStyle(1.5,0x556,.4); g.drawCircle(tx,base-r/2-10,r/2*0.7); g.lineStyle(0);
      });
      // ===== ДЫМОВЫЕ ТРУБЫ с дымом =====
      [[s.x+40,150],[s.x+72,120]].forEach(([sx,h],i)=>{
        g.beginFill(0x8a4a3a); g.drawRect(sx-8,base-h,16,h); g.endFill();
        g.beginFill(0xb05a46); g.drawRect(sx-10,base-h,20,7); g.endFill();
        g.lineStyle(2,0xe8e8e8,.5); g.drawRect(sx-8,base-h*0.6,16,4); g.lineStyle(0);  // полоса
        s['smoke'+i]=smoke(world, sx, base-h-6); s['smoke'+i].zIndex=8000;
      });
      // ===== ФАКЕЛ завода =====
      g.beginFill(0x6a727e); g.drawRect(s.x+s.w-46,base-160,9,160); g.endFill();
      g.lineStyle(1.5,0x556,.6); for(let yy=base-150;yy<base;yy+=24){ g.moveTo(s.x+s.w-50,yy);g.lineTo(s.x+s.w-32,yy);} g.lineStyle(0);
      s.smoke2=smoke(world, s.x+s.w-41, base-168); s.smoke2.zIndex=8000;
      s.fire=fire(world, s.x+s.w-41, base-164, 0.8); s.fire.zIndex=9001;
      // КПП/проходная
      g.beginFill(0x4a525e); g.drawRoundedRect(s.x+s.w/2-22,s.y+38,44,18,4); g.endFill();
      g.beginFill(0x2bd4c9,.4); g.drawRect(s.x+s.w/2-14,s.y+42,28,8); g.endFill();
    } else if(s.type==='gas'){
      // ===== АГПЗ — газоперерабатывающий завод (узнаваемо: сферы + колонны + факел) =====
      for(let y=s.y;y<s.y+s.h;y+=44) for(let x=s.x;x<s.x+s.w;x+=44){
        g.beginFill((((x-s.x)/44+(y-s.y)/44)%2)?0x2a2a1e:0x2f2f22); g.drawRect(x,y,44,44); g.endFill(); }
      const base=s.y+s.h-46, L0=s.x+40;
      // забор
      g.lineStyle(2,0x6a6a52,.5); g.drawRect(s.x+18,s.y+50,s.w-36,s.h-86);
      for(let x=s.x+18;x<s.x+s.w-18;x+=26){ g.moveTo(x,s.y+50);g.lineTo(x,s.y+58);} g.lineStyle(0);
      // ---- СФЕРИЧЕСКИЕ ГАЗГОЛЬДЕРЫ (визитная карточка ГПЗ) ----
      [[L0+70,46],[L0+170,54],[L0+270,42]].forEach(([sx,r])=>{
        g.lineStyle(2,0x33404e,.9);
        g.beginFill(0x9aa6b4); g.drawCircle(sx,base-r-18,r); g.endFill(); g.lineStyle(0);
        g.beginFill(0xffffff,.20); g.drawEllipse(sx-r*0.4,base-r-18-r*0.4,r*0.35,r*0.45); g.endFill(); // блик
        g.lineStyle(1.4,0x6a7480,.6); for(let a=-1;a<=1;a+=0.5){ g.moveTo(sx+a*r,base-r-18-r);g.lineTo(sx+a*r,base-r-18+r);} // меридианы
        g.drawEllipse(sx,base-r-18,r,r*0.5); g.lineStyle(0);
        // опоры-ноги сферы
        g.lineStyle(3,0x5a626e,.9); [-0.7,-0.3,0.3,0.7].forEach(k=>{ g.moveTo(sx+k*r,base-18); g.lineTo(sx+k*r*0.7,base);}); g.lineStyle(0);
      });
      // ---- ВЫСОКИЕ ТЕХНОЛОГИЧЕСКИЕ КОЛОННЫ ----
      const colX=s.x+s.w*0.62;
      [[colX,220,17],[colX+50,260,20],[colX+104,180,15],[colX+150,210,16]].forEach(([bx,hh,r])=>{
        g.lineStyle(1.6,0x33404e,.8);
        g.beginFill(0x808892); g.drawRoundedRect(bx-r,base-hh,r*2,hh,r); g.endFill();
        g.beginFill(0x949ca8); g.drawRoundedRect(bx-r,base-hh,r*2,12,r); g.endFill(); g.lineStyle(0);
        g.beginFill(0xffffff,.16); g.drawRoundedRect(bx-r,base-hh,r*0.7,hh,r); g.endFill();
        g.lineStyle(1.3,0x556,.45); for(let yy=base-hh+22;yy<base;yy+=22){ g.moveTo(bx-r,yy);g.lineTo(bx+r,yy);} g.lineStyle(0);
      });
      // эстакада труб между колоннами и сферами (на опорах)
      g.lineStyle(5,0x9aa2af,.7); g.moveTo(L0+30,base-120); g.lineTo(colX+150,base-120); g.lineStyle(0);
      g.lineStyle(2,0x6a727e,.6); for(let x=L0+30;x<colX+150;x+=34){ g.moveTo(x,base-130);g.lineTo(x,base);} g.lineStyle(0);
      // ---- ГРАДИРНИ (кулеры) ----
      [[s.x+s.w*0.5,base],[s.x+s.w*0.5+62,base]].forEach(([cxx,by])=>{
        g.beginFill(0x6f7884); g.moveTo(cxx-30,by); g.quadraticCurveTo(cxx-14,by-70,cxx-18,by-96);
        g.lineTo(cxx+18,by-96); g.quadraticCurveTo(cxx+14,by-70,cxx+30,by); g.closePath(); g.endFill();
        g.beginFill(0x4a525e); g.drawEllipse(cxx,by-96,18,6); g.endFill(); });
      // ---- НАЛИВНАЯ Ж/Д ЭСТАКАДА (цистерны на рельсах) ----
      const ry=s.y+s.h-22;
      g.lineStyle(3,0x4a4036,.8); g.moveTo(s.x+30,ry);g.lineTo(s.x+s.w-30,ry); g.moveTo(s.x+30,ry+6);g.lineTo(s.x+s.w-30,ry+6); g.lineStyle(0);
      g.lineStyle(2,0x3a342c,.6); for(let x=s.x+30;x<s.x+s.w-30;x+=18){ g.moveTo(x,ry-2);g.lineTo(x,ry+8);} g.lineStyle(0);
      for(let i=0;i<5;i++){ const tx=s.x+70+i*70; g.beginFill(i%2?0x7a5a44:0x5a6470); g.drawRoundedRect(tx-26,ry-22,52,18,9); g.endFill();
        g.beginFill(0x2a2f38); g.drawCircle(tx-16,ry+2,4); g.drawCircle(tx+16,ry+2,4); g.endFill(); }
      // ---- ФАКЕЛЬНАЯ СВЕЧА с огнём (высокая) ----
      const flX=s.x+s.w-58;
      g.beginFill(0x6a727e); g.drawRect(flX-6,base-250,12,250); g.endFill();
      g.lineStyle(1.5,0x556,.6); for(let yy=base-240;yy<base;yy+=26){ g.moveTo(flX-10,yy);g.lineTo(flX+10,yy);} g.lineStyle(0);
      s.fire=fire(world, flX, base-256, 1.5); s.fire.zIndex=9001;
      s.smoke2=smoke(world, flX, base-262); s.smoke2.zIndex=8000;
      // ---- АДМИН-корпус ----
      g.beginFill(0x3a4350); g.drawRoundedRect(s.x+24,s.y+58,90,40,5); g.endFill();
      g.beginFill(0x2bd4c9,.5); for(let i=0;i<4;i++) g.drawRect(s.x+32+i*20,s.y+66,12,12); g.endFill();
    } else { // снежный объект
      for(let y=s.y;y<s.y+s.h;y+=44) for(let x=s.x;x<s.x+s.w;x+=44){
        g.beginFill((((x-s.x)/44+(y-s.y)/44)%2)?COL.snow:COL.snow2); g.drawRect(x,y,44,44); g.endFill(); }
      const cx=s.x+s.w/2, base=s.y+s.h-60;
      // вагончики-бытовки на сваях
      [[-90,0x8a7a5a],[10,0x5a7a8a],[100,0x7a5a6a]].forEach(([dx,c])=>{
        g.beginFill(0x2a3038); g.drawRect(cx+dx-4,base,6,18); g.drawRect(cx+dx+46,base,6,18); g.endFill();
        g.beginFill(c); g.drawRoundedRect(cx+dx-6,base-44,60,46,5); g.endFill();
        g.beginFill(0xeef3f8,.85); g.drawRect(cx+dx-6,base-46,60,6); g.endFill(); // снег на крыше
        g.beginFill(COL.scr,.5); g.drawRect(cx+dx+8,base-32,20,16); g.endFill();
      });
      // сугробы
      g.beginFill(0xeef3f8,.10); g.drawEllipse(cx,base+24,150,20); g.endFill();
    }
    // рамка объекта — для моря почти невидимая (без жёсткого прямоугольника)
    if(s.type==='platform'){ g.lineStyle(2,COL.gold,.16); g.drawRoundedRect(s.x+4,s.y+4,s.w-8,s.h-8,40); g.lineStyle(0); }
    else { g.lineStyle(3,COL.gold,.5); g.drawRoundedRect(s.x,s.y,s.w,s.h,14); g.lineStyle(0); }
    world.addChild(g);
    const hit=new PIXI.Graphics(); hit.beginFill(0xffffff,.001); hit.drawRoundedRect(s.x,s.y,s.w,s.h,14); hit.endFill();
    hit.zIndex=-199; hit.eventMode='static'; hit.cursor='pointer';
    hit.on('pointertap',()=>{ if(!drag.moved) openSiteDrawer(s); }); world.addChild(hit);

    // подпись с тёмной плашкой-подложкой (читаемо на любом фоне)
    const _icn0 = s.type==='platform'?'🛢 ':(s.type==='gas'?'⛽ ':(s.type==='plant'?'🏭 ':'🏗 '));
    const lbl=label(_icn0+s.name, s.big?19:16, 0xeaf3ff,'800'); lbl.anchor.set(.5,0);
    const lpad=12, lbg=new PIXI.Graphics();
    lbg.beginFill(0x0a0e18,.72); lbg.drawRoundedRect(s.x+s.w/2-lbl.width/2-lpad, s.y+5, lbl.width+lpad*2, lbl.height+6, 9); lbg.endFill();
    lbg.lineStyle(1.5,COL.gold,.5); lbg.drawRoundedRect(s.x+s.w/2-lbl.width/2-lpad, s.y+5, lbl.width+lpad*2, lbl.height+6, 9); lbg.lineStyle(0);
    lbg.zIndex=8999; world.addChild(lbg);
    lbl.x=s.x+s.w/2; lbl.y=s.y+8; lbl.zIndex=9000; world.addChild(lbl);
    const nW=s.crew.filter(c=>!c.master).length, nM=s.crew.filter(c=>c.master).length;
    const nSite=s.crew.filter(c=>c.status==='site').length;
    const badge=label('👷 '+nW+' раб · 🪖 '+nM+' маст · 🟢 '+nSite+' на смене', 13, 0xffe39a,'800');
    badge.anchor.set(.5,0); badge.x=s.x+s.w/2; badge.y=s.y+(s.big?30:28); badge.zIndex=9000; world.addChild(badge);
    if(s.customer){ const cu=label(s.customer.replace(/«|»/g,''), 11, 0x9fb6cf,'700'); cu.anchor.set(.5,0); cu.x=s.x+s.w/2; cu.y=s.y+(s.big?48:44); cu.zIndex=9000; cu.alpha=.85; world.addChild(cu); }
    s.cx=s.x+s.w/2; s.cy=s.y+s.h/2;

    // зона размещения и комната отдыха НЕ рисуются (компактная карта) — крю внутри объекта.
    s._restRoom = { x:s.x+10, y:s.y+s.h-30, w:Math.min(120,s.w-20), h:24 };
    // transit (в дороге) и medical (медосмотр) теперь НЕ у объекта:
    //  — летящие показаны в бортах (ЛОГИСТИКА), медосмотр — в медцентре Москва/Саратов (MEDHUB).
  });

  // ======================= ДАННЫЕ: ГОД + СОТРУДНИКИ =======================
  const YEAR = {
    year: 2026,
    // ---- проекты ----
    projects:34, projectsActive:11, projectsClosed:21, projectsPrep:2,
    // ---- финансы (млн ₽) ----
    revenue:611.0,         // выручка по контрактам за год
    costPlan:412.0,        // плановая себестоимость
    costFact:388.5,        // фактическая себестоимость
    backlog:1240.0,        // законтрактованный портфель (бэклог) к исполнению
    sgna:54.0,             // АУП / накладные (SG&A)
    tax:31.0,              // налоги/прочее
    // ---- деньги / cash flow ----
    received:503.0,        // получено от заказчиков
    ar:108.0,              // дебиторка всего
    arOverdue:21.4,        // из неё просрочено
    advances:46.0,         // авансы полученные
    ap:62.0,               // кредиторка (поставщики/субподряд)
    cash:74.0,             // остаток на счетах
    // ---- самозанятые (НПД) ----  лимит 2.4 млн ₽/чел в год (CRM: settings.self_employed_yearly_limit)
    szPeople:38, szPerLimit:2.4,   // 38 чел × 2.4 млн = годовой лимит флота
    szUsed:54.6,                   // израсходовано (se_transfers SUM за год)
    szNearLimit:5, szOverRisk:2,   // близко к лимиту / риск превышения
    // ---- тендеры / портфель ----
    tnSubmitted:96, tnWon:31, tnLost:38, tnActive:27, tnWonSum:742.0, tnPipeline:1180.0,
    // ---- персонал / HSE ----
    headcount:214, staffPerm:142, staffSelfEmp:38, staffField:118, staffOffice:42,
    onShift:7, lti:0, nearMiss:3, hseDays:214, permitsValid:96, // % допусков действительны
    mobDays:12,                    // средний срок мобилизации (start_fact − start_plan)
  };
  YEAR.toReceive  = +(YEAR.revenue - YEAR.received).toFixed(1);
  YEAR.szLimit    = +(YEAR.szPeople * YEAR.szPerLimit).toFixed(1);          // суммарный годовой лимит
  YEAR.szLeft     = +(YEAR.szLimit - YEAR.szUsed).toFixed(1);
  YEAR.szUtilPct  = Math.round(YEAR.szUsed/YEAR.szLimit*100);
  YEAR.szAvg      = +(YEAR.szUsed/YEAR.szPeople).toFixed(2);                // средний расход на человека
  // демо-разбивка по нескольким самозанятым (как payroll-dashboard /self-employed-limits)
  YEAR.szTop = [
    {n:'Хравн Ж.', used:2.28, inn:'30•••41'}, {n:'Скёль П.', used:2.15, inn:'30•••07'},
    {n:'Аск Н.',   used:1.96, inn:'30•••88'}, {n:'Туре В.',  used:1.74, inn:'30•••22'},
    {n:'Орм С.',   used:1.61, inn:'30•••55'},
  ];
  YEAR.gross      = +(YEAR.revenue - YEAR.costFact).toFixed(1);            // валовая прибыль
  YEAR.grossPct   = +(YEAR.gross/YEAR.revenue*100).toFixed(1);
  YEAR.ebitda     = +(YEAR.gross - YEAR.sgna).toFixed(1);                  // EBITDA
  YEAR.ebitdaPct  = +(YEAR.ebitda/YEAR.revenue*100).toFixed(1);
  YEAR.net        = +(YEAR.ebitda - YEAR.tax).toFixed(1);                  // чистая прибыль
  YEAR.netPct     = +(YEAR.net/YEAR.revenue*100).toFixed(1);
  YEAR.profitFact = +(YEAR.received - YEAR.costFact).toFixed(1);           // прибыль факт (кэш) сегодня
  YEAR.tnConv     = Math.round(YEAR.tnWon/(YEAR.tnWon+YEAR.tnLost)*100);   // конверсия тендеров
  YEAR.costSave   = +(YEAR.costPlan - YEAR.costFact).toFixed(1);           // экономия себестоимости
  // помесячная выручка (млн) — для графика
  YEAR.months = ['Я','Ф','М','А','М','И','И','А','С','О','Н','Д'];
  YEAR.revMonth  = [38,42,51,47,55,62,58,49,53,57,0,0];   // факт по месяц (0 — будущее)
  YEAR.costMonth = [25,28,33,31,35,40,38,33,35,38,0,0];
  // топ-проекты и убыточные
  YEAR.topProjects = [
    {n:'Кап.ремонт МЛСП «Приразломная»', rev:214.0, margin:21.4},
    {n:'Сервис МЛСП «Приразломная»',      rev:96.0,  margin:9.1},
    {n:'Демонтаж узлов «Усинск»',         rev:78.0,  margin:14.2},
  ];
  YEAR.lossProjects = [
    {n:'Ремонт трубопровода «Усинск»', rev:34.0, margin:-3.2, why:'перерасход ФОТ + простой'},
  ];

  const STAFF = _DATA.staff;   // [{name,role,rus,female?,helm?,beard?, ...досье}]

  // ======================= ВЕКТОРНЫЙ ВИКИНГ (детальный, читаемый) =======================
  // Анатомия три-четверти: тень → ноги/ботинки → торс-туника → пояс → руки/кисти →
  // плечи-наплечники → шея → голова с лицом → причёска/борода → шлем. Контур + рим-лайт.
  const ROLE_COL = {
    PM:0x2e6bd6, HEAD_PM:0x1f4fa8, TO:0x6b8f2e, PROC:0xc77a2e, BUH:0x9c3a78,
    OFFICE_MANAGER:0x2e8f8f, DIRECTOR_GEN:0xb01f2e, WAREHOUSE:0x8a6a2e, CHIEF_ENGINEER:0x5a2e8f,
  };
  const BEARD_COL = { red:0xb5532a, blonde:0xd9b35a, black:0x3a2f28 };
  const HAIR_COL  = { red:0xa8542a, blonde:0xc9a84e, black:0x2e2620 };
  const SKIN = 0xe8c4a0, SKIN_F = 0xf0cfae, OUT = 0x141820;   // OUT — цвет тонкой обводки

  function drawHelmet(g, kind){
    // садится на голову (центр головы ~ y=-30, r~12)
    const hy=-30;
    if(kind==='horn'){               // рогатый шлем
      g.lineStyle(1.4,OUT,.9);
      g.beginFill(0x9aa0aa); g.arc(0,hy,13,Math.PI,0); g.lineTo(13,hy); g.lineTo(-13,hy); g.closePath(); g.endFill();
      g.beginFill(0x6f757f); g.drawRoundedRect(-13,hy-1,26,5,2); g.endFill();           // обод
      g.lineStyle(0);
      g.beginFill(0xffffff,.18); g.drawEllipse(-4,hy-5,4,7); g.endFill();               // блик металла
      g.lineStyle(1.4,OUT,.9); g.beginFill(0xeae0cf);                                    // рога
      g.moveTo(-12,hy-1); g.quadraticCurveTo(-26,hy-12,-18,hy-22); g.quadraticCurveTo(-15,hy-12,-7,hy-3); g.closePath();
      g.moveTo(12,hy-1);  g.quadraticCurveTo(26,hy-12,18,hy-22);  g.quadraticCurveTo(15,hy-12,7,hy-3);  g.closePath();
      g.endFill(); g.lineStyle(0);
    } else if(kind==='viking'){      // конический с наносником
      g.lineStyle(1.4,OUT,.9);
      g.beginFill(0xa4abb5); g.arc(0,hy,13,Math.PI,0); g.closePath(); g.endFill();
      g.beginFill(0x868d98); g.moveTo(-13,hy);g.lineTo(0,hy-22);g.lineTo(13,hy);g.closePath(); g.endFill();
      g.lineStyle(0); g.beginFill(0xffffff,.20); g.drawEllipse(-4,hy-6,3,8); g.endFill();
      g.beginFill(0x6f757f); g.drawRoundedRect(-2.5,hy,5,12,2); g.endFill();             // наносник
      g.beginFill(0xd8b15a); g.drawCircle(0,hy-22,2.4); g.endFill();                     // навершие
    } else {                         // spangen — клёпаный округлый
      g.lineStyle(1.4,OUT,.9);
      g.beginFill(0xb0b6c0); g.arc(0,hy,13,Math.PI,0); g.closePath(); g.endFill();
      g.beginFill(0x868d98); g.drawRoundedRect(-13,hy-1,26,5,2); g.endFill();
      g.lineStyle(1.2,0x7a808a,.8); g.moveTo(0,hy-13);g.lineTo(0,hy); g.moveTo(-9,hy-9);g.lineTo(9,hy-9); g.lineStyle(0);
      g.beginFill(0xffffff,.18); g.drawEllipse(-4,hy-6,3,7); g.endFill();
      g.beginFill(0xd8b15a); [-9,-3,3,9].forEach(x=>g.drawCircle(x,hy+1,1.1)); g.endFill(); // заклёпки
    }
  }

  // s: {role, female, helm, beard, director}
  function drawViking(s, scale){
    scale = scale||1;
    const c=new PIXI.Container();
    const body=new PIXI.Graphics();
    const shirt = ROLE_COL[s.role] || 0x49586b;
    const shirtD = mix(shirt, 0x000000, .32);
    const skin = s.female?SKIN_F:SKIN, skinSh = mix(skin,0x000000,.16);
    const isDir = s.role==='DIRECTOR_GEN' || s.role==='DIRECTOR_COMM' || s.role==='DIRECTOR_DEV' || s.director;
    // тень
    body.beginFill(0x000000,.28); body.drawEllipse(0,29,16,5); body.endFill();
    // НОГИ — брюки (тёмные)
    body.lineStyle(1.2,OUT,.85);
    body.beginFill(0x2b3340); body.drawRoundedRect(-8,12,7,17,3); body.drawRoundedRect(1,12,7,17,3); body.endFill();
    body.beginFill(0x14181f); body.drawRoundedRect(-9,26,8,5,2); body.drawRoundedRect(1,26,8,5,2); body.endFill(); // туфли
    body.lineStyle(0);
    // ТОРС — рубашка/пиджак по роли
    body.lineStyle(1.3,OUT,.9);
    body.beginFill(shirt); body.drawRoundedRect(-14,-8,28,22,8); body.endFill(); body.lineStyle(0);
    body.beginFill(0xffffff,.12); body.drawRoundedRect(-14,-8,28,6,6); body.endFill();   // рим-лайт
    body.beginFill(shirtD,.5); body.drawRoundedRect(-14,8,28,6,6); body.endFill();        // тень снизу
    // воротник-рубашка (светлый V)
    body.beginFill(0xeef2f8); body.moveTo(-6,-8); body.lineTo(0,0); body.lineTo(6,-8); body.lineTo(3,-8); body.lineTo(0,-3); body.lineTo(-3,-8); body.closePath(); body.endFill();
    // директор — галстук/платок акцентом
    if(isDir){ body.beginFill(0xc8a84e); body.drawRoundedRect(-1.6,-4,3.2,12,1); body.endFill(); }
    // плечи (чуть светлее)
    body.lineStyle(1.2,OUT,.7); body.beginFill(mix(shirt,0xffffff,.14));
    body.drawRoundedRect(-16,-8,7,7,3); body.drawRoundedRect(9,-8,7,7,3); body.endFill(); body.lineStyle(0);
    // РУКИ + кисти
    body.lineStyle(1.2,OUT,.8);
    body.beginFill(shirt); body.drawRoundedRect(-18,-4,5,15,3); body.drawRoundedRect(13,-4,5,15,3); body.endFill();
    body.beginFill(skin); body.drawCircle(-15.5,12,3.2); body.drawCircle(15.5,12,3.2); body.endFill();
    body.lineStyle(0);
    // БЕЙДЖ-ЛАНЬЯРД (шнурок + карточка) — офисный признак
    body.lineStyle(1.4,0x2a3340,.8); body.moveTo(-5,-6); body.lineTo(-2,4); body.moveTo(5,-6); body.lineTo(2,4); body.lineStyle(0);
    body.beginFill(0xf2f5fa); body.drawRoundedRect(-4,3,8,6,1.5); body.endFill();
    body.beginFill(shirt,.7); body.drawRect(-3,4,6,1.6); body.endFill();
    // ШЕЯ
    body.beginFill(skinSh); body.drawRoundedRect(-3.5,-13,7,6,2); body.endFill();
    // ГОЛОВА
    body.lineStyle(1.3,OUT,.85);
    body.beginFill(skin); body.drawCircle(0,-28,11); body.endFill(); body.lineStyle(0);
    body.beginFill(skin); body.drawEllipse(0,-21,8,4); body.endFill();                 // подбородок
    body.beginFill(0xffffff,.13); body.drawEllipse(-3.5,-31,3.5,4.5); body.endFill();   // блик
    body.beginFill(skinSh); body.drawCircle(-11,-28,2.2); body.drawCircle(11,-28,2.2); body.endFill(); // уши
    // ПРИЧЁСКА (аккуратная), цвет по полу
    const hair = s.female?0x6a4a32:0x3a3026;
    if(s.female){
      body.lineStyle(1.1,OUT,.5); body.beginFill(hair);
      body.arc(0,-28,12,Math.PI*0.92,Math.PI*2.08); body.endFill();
      body.drawRoundedRect(-12,-30,3.5,16,2); body.drawRoundedRect(8.5,-30,3.5,16,2); body.endFill(); // волосы по бокам
      body.lineStyle(0);
    } else {
      body.beginFill(hair); body.arc(0,-28,11.5,Math.PI*1.05,Math.PI*1.95); body.endFill();
      body.beginFill(hair); body.drawRoundedRect(-11,-30,22,4,2); body.endFill();
    }
    // ЛИЦО: брови, глаза, нос, рот
    body.beginFill(mix(hair,0x000000,.2)); body.drawRect(-6.5,-31,4.5,1.4); body.drawRect(2,-31,4.5,1.4); body.endFill();
    body.beginFill(0xffffff); body.drawEllipse(-3.6,-29,2,2.4); body.drawEllipse(3.6,-29,2,2.4); body.endFill();
    body.beginFill(0x1a1a22); body.drawCircle(-3.2,-29,1.2); body.drawCircle(4,-29,1.2); body.endFill();
    body.beginFill(skinSh); body.drawRoundedRect(-1,-28,2.2,4.5,1); body.endFill();    // нос
    if(s.female){ body.beginFill(0xc66a6a,.7); body.drawEllipse(0,-22,2.4,1.2); body.endFill(); }
    else { body.beginFill(skinSh); body.drawEllipse(0,-22,4,1.6); body.endFill(); }
    c.addChild(body); c._body=body; c.scale.set(scale);
    return c;
  }

  // рабочий: спецовка со светополосами, каска (оранж/бел), перчатки; мастер — с рацией
  function drawWorker(name, isMaster, scale){
    scale = scale||1;
    const c=new PIXI.Container(); const g=new PIXI.Graphics();
    const robe = isMaster?0xdfe4ec:0x2f6b3a, robeD=mix(robe,0x000000,.32);
    const hc = isMaster?0xf2f4f7:0xff8c2a, hcD=mix(hc,0x000000,.3);
    // тень
    g.beginFill(0x000000,.30); g.drawEllipse(0,27,15,5); g.endFill();
    // ноги + ботинки
    g.lineStyle(1.2,OUT,.85);
    g.beginFill(0x2a323e); g.drawRoundedRect(-7,11,6,16,3); g.drawRoundedRect(1,11,6,16,3); g.endFill();
    g.beginFill(0x15191f); g.drawRoundedRect(-8,24,8,5,2); g.drawRoundedRect(0,24,8,5,2); g.endFill();
    g.lineStyle(0);
    // роба
    g.lineStyle(1.3,OUT,.9);
    g.beginFill(robe); g.drawRoundedRect(-13,-7,26,21,7); g.endFill(); g.lineStyle(0);
    g.beginFill(0xffffff,.12); g.drawRoundedRect(-13,-7,26,6,6); g.endFill();
    g.beginFill(robeD,.5); g.drawRoundedRect(-13,8,26,6,6); g.endFill();
    // светоотражающие полосы (2) + вертикальная
    g.beginFill(0xffe14a,.95); g.drawRect(-13,-2,26,3.2); g.drawRect(-13,5,26,3.2); g.endFill();
    g.beginFill(0xffe14a,.8); g.drawRect(-2.2,-7,4.4,21); g.endFill();
    // руки + перчатки
    g.lineStyle(1.2,OUT,.8);
    g.beginFill(robe); g.drawRoundedRect(-16,-4,5,14,3); g.drawRoundedRect(11,-4,5,14,3); g.endFill();
    g.beginFill(0xffe14a,.9); g.drawRect(-16,2,5,2.2); g.drawRect(11,2,5,2.2); g.endFill();           // полоса на рукаве
    g.beginFill(0x2a2f38); g.drawCircle(-13.5,11,3.2); g.drawCircle(13.5,11,3.2); g.endFill();         // перчатки
    g.lineStyle(0);
    // рация у мастера
    if(isMaster){ g.beginFill(0x1a1f27); g.drawRoundedRect(12,2,5,9,2); g.endFill();
      g.beginFill(0x3a4350); g.drawRect(13.5,-1,2,4); g.endFill();
      g.beginFill(0x3fb950); g.drawCircle(14.5,5,1); g.endFill(); }
    // шея + голова
    g.beginFill(mix(SKIN,0x000000,.15)); g.drawRoundedRect(-3.5,-12,7,6,2); g.endFill();
    g.lineStyle(1.3,OUT,.85);
    g.beginFill(SKIN); g.drawCircle(0,-25,10); g.endFill(); g.lineStyle(0);
    g.beginFill(0xffffff,.14); g.drawEllipse(-3,-27,3,4); g.endFill();
    g.beginFill(mix(SKIN,0x000000,.15)); g.drawCircle(-10,-25,2); g.drawCircle(10,-25,2); g.endFill(); // уши
    // лицо
    g.beginFill(0xffffff); g.drawEllipse(-3.4,-26,1.9,2.2); g.drawEllipse(3.4,-26,1.9,2.2); g.endFill();
    g.beginFill(0x1a1a22); g.drawCircle(-3,-26,1.1); g.drawCircle(3.8,-26,1.1); g.endFill();
    g.beginFill(mix(SKIN,0x000000,.18)); g.drawRoundedRect(-1,-25,2,4,1); g.endFill();                 // нос
    g.beginFill(0x6a4a2a); g.drawEllipse(0,-19,5,2); g.endFill();                                      // короткая борода/щетина
    // КАСКА с козырьком и ремешком
    g.lineStyle(1.3,OUT,.85);
    g.beginFill(hc); g.arc(0,-30,11,Math.PI,0); g.closePath(); g.endFill();
    g.beginFill(hcD); g.drawRoundedRect(-13,-30,26,3.5,2); g.endFill();                                // козырёк
    g.lineStyle(0);
    g.beginFill(0xffffff,.22); g.drawEllipse(-4,-33,3.5,4); g.endFill();                               // блик
    g.lineStyle(1.1,hcD,.9); g.moveTo(0,-41);g.lineTo(0,-30); g.moveTo(-7,-37);g.lineTo(7,-37); g.lineStyle(0); // рёбра
    g.lineStyle(1,0x3a2c1c,.7); g.moveTo(-9,-27);g.quadraticCurveTo(0,-21,9,-27); g.lineStyle(0);       // ремешок
    c.addChild(g); c._body=g; c.scale.set(scale);
    return c;
  }

  // ======================= ДЕТАЛЬНЫЕ РАБОЧИЕ МЕСТА =======================
  const desks=[];
  (function(){
    const deskStaff = STAFF.filter(s => (s._zone||'desk')==='desk');
    const N = deskStaff.length;
    const cols = Math.max(1, Math.min(6, Math.ceil(Math.sqrt(N))));   // до 6 в ряд
    const colW = Math.max(190, Math.min(270, (HALL.w-220)/cols));
    let di=0;
    for(let i=0;i<N;i++){
      const col=i%cols, row=Math.floor(i/cols);
      const x=HALL.x+150+col*colW, y=HALL.y+150+row*180;
      desks.push({ x, y, who:deskStaff[i] }); di++;
    }
    desks.forEach(d=>{
      const g=new PIXI.Graphics(); g.zIndex=d.y-40;
      // ковровый коврик
      g.beginFill(COL.carpet,.6); g.drawRoundedRect(d.x-60,d.y-8,120,46,8); g.endFill();
      // стол
      g.beginFill(COL.deskEdge); g.drawRoundedRect(d.x-58,d.y-58,116,34,7); g.endFill();
      g.beginFill(COL.deskTop);  g.drawRoundedRect(d.x-56,d.y-60,112,30,7); g.endFill();
      g.beginFill(0xffffff,.06);  g.drawRoundedRect(d.x-56,d.y-60,112,7,5); g.endFill();
      // монитор со свечением
      g.beginFill(0x05080e); g.drawRoundedRect(d.x-22,d.y-82,44,28,3); g.endFill();
      g.beginFill(COL.scr,.85); g.drawRoundedRect(d.x-19,d.y-79,38,22,2); g.endFill();
      g.beginFill(0xffffff,.18); g.drawRect(d.x-15,d.y-75,20,3); g.drawRect(d.x-15,d.y-69,28,2); g.endFill();
      g.beginFill(0x222a36); g.drawRect(d.x-4,d.y-54,8,5); g.drawRoundedRect(d.x-10,d.y-50,20,3,2); g.endFill();
      // клавиатура
      g.beginFill(0x1a2230); g.drawRoundedRect(d.x-20,d.y-44,40,10,2); g.endFill();
      // настольная лампа (тёплый свет)
      g.beginFill(0x3a4350); g.drawRect(d.x+40,d.y-44,3,14); g.endFill();
      g.beginFill(COL.gold); g.drawCircle(d.x+44,d.y-46,6); g.endFill();
      g.beginFill(0xffd27a,.18); g.drawCircle(d.x+44,d.y-40,22); g.endFill();
      // кружка + бумаги
      g.beginFill(0xb05a46); g.drawRoundedRect(d.x-44,d.y-44,9,9,2); g.endFill();
      g.beginFill(0xe8e4d8); g.drawRect(d.x+26,d.y-44,16,11); g.endFill();
      g.beginFill(0xffffff,.5); g.drawRect(d.x+28,d.y-41,12,1.5); g.drawRect(d.x+28,d.y-38,12,1.5); g.endFill();
      // кресло
      g.beginFill(0x222b3a); g.drawRoundedRect(d.x-14,d.y+18,28,16,6); g.endFill();
      g.beginFill(0x2c3850); g.drawRoundedRect(d.x-13,d.y+8,26,12,6); g.endFill();
      world.addChild(g);
    });
  })();

  // ======================= КЛАСС ГЕРОЯ =======================
  const ACT = {
    work:    {c:0x3fb950,e:'⚒',l:'работает в СРМ'},
    invoice: {c:0x2ea043,e:'🪙',l:'оплачивает счёт'},
    tender:  {c:0x1f8fff,e:'📜',l:'заносит тендер'},
    estimate:{c:0x9b7bff,e:'🧮',l:'делает просчёт'},
    phone:   {c:0x58a6ff,e:'☎',l:'переговоры'},
    approve: {c:0xd29922,e:'🤝',l:'согласование'},
    mimir:   {c:0x2bd4c9,e:'🦉',l:'совет у Мимира (ИИ)'},
    coffee:  {c:0xb5764a,e:'☕',l:'кофе-пауза'},
    smoke:   {c:0x8b97a6,e:'💨',l:'перекур'},
    lunch:   {c:0xe8a13a,e:'🍖',l:'обед'},
    remote:  {c:0x6aa6ff,e:'💻',l:'на удалёнке'},
    home:    {c:0x6e7681,e:'🏠',l:'дома / офлайн'},
  };

  class Hero {
    constructor(d){
      this.home={x:d.x, y:d.y}; this.s=d.who; this.dir='down'; this.t=0; this.bob=Math.random()*6;
      this.c=drawViking(d.who, 0.95); this.c.x=d.x; this.c.y=d.y-6; this.c.zIndex=d.y;
      this.tag=label(d.who.name.split(' ')[0],11,0xe6eef8,'700'); this.tag.anchor.set(.5,0);
      this.tag.y=34; this.c.addChild(this.tag);
      this.bub=new PIXI.Container(); this.bub.y=-58; this.c.addChild(this.bub);
      this.bbg=new PIXI.Graphics(); this.bub.addChild(this.bbg);
      this.bic=new PIXI.Text('',{fontFamily:FONT,fontSize:13}); this.bic.anchor.set(.5); this.bub.addChild(this.bic);
      this.c.eventMode='static'; this.c.cursor='pointer';
      this.c.on('pointertap',()=>{ if(!drag.moved) openDrawer(this.s, this.act); });
      world.addChild(this.c);
      this.state='idle'; this.act='work'; this.target=null;
      this.hold = 8+Math.random()*10;            // минимум секунд в активности (инерция)
      this.setAct((d.who && d.who._act) || 'work');
    }
    setAct(a){ if(!ACT[a]) a='work'; this.act=a; const def=ACT[a]; this.bic.text=def.e;
      this.bbg.clear(); this.bbg.beginFill(def.c,.95); this.bbg.drawRoundedRect(-13,-12,26,21,7); this.bbg.endFill();
      this.bbg.beginFill(def.c,.95); this.bbg.moveTo(-4,9);this.bbg.lineTo(4,9);this.bbg.lineTo(0,14);this.bbg.closePath(); this.bbg.endFill();
      this.c.alpha = (a==='home')?0.25:1; }
    faceTo(tx,ty){ const dx=tx-this.c.x,dy=ty-this.c.y; this.dir=Math.abs(dx)>Math.abs(dy)?(dx>0?'right':'left'):(dy>0?'down':'up'); }
    walkTo(tx,ty,cb){ this.target={x:tx,y:ty,cb}; this.state='walking'; }
    update(dt){
      this.c.zIndex=this.c.y; this.t+=dt;
      this.bub.y=-58+Math.sin(performance.now()/420+this.bob)*2;
      if(this.state==='walking' && this.target){
        const dx=this.target.x-this.c.x, dy=this.target.y-this.c.y, dist=Math.hypot(dx,dy), sp=34*dt;
        // покачивание при ходьбе
        this.c._body.rotation=Math.sin(performance.now()/140)*0.045;
        if(dist<sp){ this.c.x=this.target.x; this.c.y=this.target.y; this.c._body.rotation=0;
          const cb=this.target.cb; this.target=null; this.state='idle'; if(cb)cb(); }
        else { this.faceTo(this.target.x,this.target.y); this.c.x+=dx/dist*sp; this.c.y+=dy/dist*sp; }
      } else {
        this.c._body.rotation=0;
        if(this.act==='work'||this.act==='invoice'||this.act==='tender'||this.act==='estimate'){
          this.c._body.y = Math.sin(performance.now()/150+this.bob)*0.9;     // «печатает»
        } else this.c._body.y = Math.sin(performance.now()/600+this.bob)*0.4; // лёгкое дыхание
      }
    }
  }
  const heroes = desks.map(d=> new Hero(d));

  // ----- кладовщик внутри склада (живая фигура) -----
  (function(){
    const wm = STAFF.find(x=>x.role==='WAREHOUSE'); if(!wm) return;
    const c = drawViking(wm, 0.95);
    c.x = WARE.x + WARE.w/2; c.y = WARE.y + WARE.h - 70; c.zIndex = c.y;
    if(!wm.online) c.alpha = 0.4;   // офлайн-кладовщик — приглушён
    const tg = label(wm.name.split(' ')[0]+' · кладовщик',11,0xe6eef8,'700'); tg.anchor.set(.5,0); tg.y=34; c.addChild(tg);
    // бабл «работает на складе»
    const bub=new PIXI.Container(); bub.y=-58; c.addChild(bub);
    const bbg=new PIXI.Graphics(); bbg.beginFill(wm.online?0x3fb950:0x5a6675,.95); bbg.drawRoundedRect(-13,-12,26,21,7);
    bbg.moveTo(-4,9);bbg.lineTo(4,9);bbg.lineTo(0,14);bbg.closePath(); bbg.endFill(); bub.addChild(bbg);
    const bic=new PIXI.Text(wm.online?'📦':'🌙',{fontFamily:FONT,fontSize:13}); bic.anchor.set(.5); bub.addChild(bic);
    c.eventMode='static'; c.cursor='pointer';
    c.on('pointertap',()=>{ if(!drag.moved) openDrawer(wm); });
    world.addChild(c); wm._fig=c;
    // лёгкое покачивание + перемещение между стеллажами
    let tgt=null, wait=2;
    app.ticker.add(()=>{ if(paused) return; const dt=Math.min(app.ticker.deltaMS/1000,.05);
      c._body.y=Math.sin(performance.now()/500)*0.6;
      if(!tgt){ wait-=dt; if(wait<=0){ tgt={x:WARE.x+40+Math.random()*(WARE.w-80), y:WARE.y+120+Math.random()*(WARE.h-200)}; } return; }
      const dx=tgt.x-c.x, dy=tgt.y-c.y, dist=Math.hypot(dx,dy), sp=13*dt;
      if(dist<sp){ c.x=tgt.x; c.y=tgt.y; tgt=null; wait=3+Math.random()*5; c._body.rotation=0; }
      else { c.x+=dx/dist*sp; c.y+=dy/dist*sp; c.zIndex=c.y; c._body.rotation=Math.sin(performance.now()/100)*0.05; }
    });
  })();

  // ======================= РАБОЧИЕ / ДРУЖИНА =======================
  // счётчик «участков» на каждом объекте — чтобы 80 чел на смене не сбивались в кашу
  const _sitePlot={};
  function plotFor(site){
    // все, кто физически НА объекте (site+rest+sleep) — в сетку в нижних ~58% площадки объекта
    const onSite=(site.crew||[]).filter(c=>c.status==='site'||c.status==='rest'||c.status==='sleep').length;
    const cols=Math.max(3, Math.ceil(Math.sqrt(Math.max(1,onSite))));
    const rows=Math.max(1, Math.ceil(Math.max(1,onSite)/cols));
    const i=(_sitePlot[site.key]=(_sitePlot[site.key]||0)+1)-1;
    const gx=i%cols, gy=Math.floor(i/cols)%rows;
    const zx=site.x+14, zy=site.y+site.h*0.44, zw=site.w-28, zh=site.h*0.52;
    const cw=zw/cols, ch=zh/rows;
    return { x:zx+gx*cw, y:zy+gy*ch, w:cw, h:ch, _plot:true };
  }
  // зоны-маршруты для статусов
  function areaForStatus(site, st){
    // медосмотр — ВСЕГДА в медцентре (Москва/Саратов), ДО объекта, не на объекте
    if(st==='medical') return { x:MEDHUB.x+14, y:MEDHUB.y+44, w:MEDHUB.w-28, h:MEDHUB.h-62 };
    if(!site) return null;
    if(st==='sleep'||st==='rest') return plotFor(site);   // спят/отдыхают — внутри объекта, не во внешних боксах
    if(st==='transit') return { x:Math.max(HALL.x+HALL.w+8,site.x-120), y:site.y+site.h*0.4, w:104, h:site.h*0.3 };
    return plotFor(site); // site — индивидуальный участок (без каши)
  }
  class Worker {
    constructor(site, data, area){
      this.site=site; this.data=data; this.name=data.name; this.master=data.master;
      this.status = data.status || 'site';
      this.area = area || areaForStatus(site, this.status) || {x:0,y:0,w:60,h:60};
      this.c=drawWorker(data.name, data.master, 0.8); this.dir='down'; this.t=Math.random()*5; this.target=null;
      this.state = (this.status==='sleep')?'still':'roam';   // медосмотр — мельтешат у клиники
      this.reposition(); this.c.zIndex=this.c.y;
      // спящие — лёгкая прозрачность + «Z»
      if(this.status==='sleep'){ this.c.alpha=.55; }
      this.c.eventMode='static'; this.c.cursor='pointer';
      this.c.on('pointertap',()=>{ if(!drag.moved) openWorkerDrawer(this.data, this.site); });
      world.addChild(this.c);
    }
    rndPoint(){ const a=this.area, pad=14; return { x:a.x+pad+Math.random()*(Math.max(20,a.w-pad*2)), y:a.y+pad+18+Math.random()*(Math.max(20,a.h-pad*2-18)) }; }
    reposition(){ const p=this.rndPoint(); this.c.x=p.x; this.c.y=p.y; }
    update(dt){
      this.c.zIndex=this.c.y;
      if(this.state!=='roam') return;
      if(!this.target){ this.t-=dt; if(this.t<=0) this.target=this.rndPoint(); else return; }
      const dx=this.target.x-this.c.x, dy=this.target.y-this.c.y, dist=Math.hypot(dx,dy), sp=13*dt;
      if(dist<sp){ this.c.x=this.target.x; this.c.y=this.target.y; this.target=null; this.t=5+Math.random()*8; this.c.children[0].rotation=0; }
      else { this.c.x+=dx/dist*sp; this.c.y+=dy/dist*sp; this.c.children[0].rotation=Math.sin(performance.now()/170)*0.04; }
    }
  }
  const workers=[];
  // transit-рабочие НЕ роумят боксом — они летят/едут в бортах (см. ЛОГИСТИКА ниже)
  SITES.forEach(s=>{ (s.crew||[]).forEach(d=>{ if(d.status!=='transit') workers.push(new Worker(s,d)); }); });
  // ── РЕАЛЬНОЕ размещение офисных по зонам: ДОМ/ОФЛАЙН, УДАЛЁНКА, НА ОБЪЕКТЕ (вместо фейк-викингов демо) ──
  const remotes=[];
  // викинг-фигура офисного сотрудника в произвольной зоне (клик → его досье)
  function _placeStaffFig(s, x, y, suffix, alpha){
    const c=drawViking(s, 0.85); c.x=x; c.y=y; c.zIndex=c.y; if(alpha!=null) c.alpha=alpha;
    const nm0=(s.name||'').split(' ')[0]||s.name||'—';
    const tg=label(nm0+(suffix||''),11,0xbcd0e6,'700'); tg.anchor.set(.5,0); tg.y=30; c.addChild(tg);
    c.eventMode='static'; c.cursor='pointer'; c.on('pointertap',()=>{ if(!drag.moved) openDrawer(s, s._act||'work'); });
    world.addChild(c); s._fig=c; return c;
  }
  // НА ОБЪЕКТЕ — офисные, отметившиеся «на объекте» (_zone==="object"): фигура у их объекта
  STAFF.filter(s=>s._zone==='object').forEach((s)=>{
    let site=null;
    SITES.forEach(si=>{ if((si.jobs||[]).some(j=>String(j.id)===String((s.work&&s.work.title)||(s.work&&s.work.id)))) site=si; });
    if(!site && SITES.length) site=SITES[0];
    if(site){ _placeStaffFig(s, site.cx+(Math.random()*40-20), site.cy+10, " 🛠 (РП)"); }
  });
  // ── УДАЛЁНКА (отметка «уд») → OREMOTE; ДОМ (выходной/больничный/отпуск) → OHOME ──
  function _fillOfficeZone(zone, list, fixedSuffix){
    const cols=Math.max(1, Math.floor((zone.w-40)/96));
    list.forEach((s,i)=>{ const col=i%cols, row=Math.floor(i/cols);
      const suf = fixedSuffix!=null ? fixedSuffix : (s.status_label?(' · '+s.status_label):'');
      _placeStaffFig(s, zone.x+50+col*96, zone.y+46+row*72, suf, s.online?1:0.6); });
  }
  _fillOfficeZone(OREMOTE, STAFF.filter(s=>s._zone==='oremote'), ' 💻');
  _fillOfficeZone(OHOME,   STAFF.filter(s=>s._zone==='ohome'), null);
  // ── ДРУЖИНА (полевые рабочие) по готовности: СЛЕВА готовы (READY), СПРАВА не готовы (NOTREADY) ──
  // фигуры в сетку, размер подгоняется чтобы ВСЕ влезли (30/100+).
  function _fillReadiness(zone, list, ringCol){
    const n=list.length; if(!n) return;
    const innerW=zone.w-30, innerH=zone.h-44;
    // подбираем колонки так, чтобы все поместились в зону; шаг уменьшаем при большом n
    let cols=Math.max(3, Math.ceil(Math.sqrt(n*innerW/Math.max(1,innerH))));
    let step=Math.min(46, Math.max(20, innerW/cols));
    cols=Math.max(1, Math.floor(innerW/step));
    let rows=Math.ceil(n/cols);
    let stepY=Math.min(42, Math.max(20, innerH/rows));
    const fscale=Math.max(0.36, Math.min(0.6, step/52));
    list.forEach((r,i)=>{
      const col=i%cols, row=Math.floor(i/cols);
      const x=zone.x+18+col*step+step/2, y=zone.y+40+row*stepY+stepY/2;
      const c=drawWorker(r.name, false, fscale); c.x=x; c.y=y; c.zIndex=c.y;
      const ring=new PIXI.Graphics(); ring.lineStyle(2.2,ringCol,.95); ring.drawCircle(0,2,15); c.addChildAt(ring,0);
      const fig={ name:r.name, master:false, status:r.ready?"ready":"not_ready", spec:r.spec, employ:r.employ, permits:[], rate:null, city:r.city, _readiness:r.status, _reason:r.reason };
      c.eventMode='static'; c.cursor='pointer'; c.on('pointertap',()=>{ if(!drag.moved) openWorkerDrawer(fig, null); });
      world.addChild(c);
    });
  }
  (function(){
    const ppl=(_DATA.readiness && _DATA.readiness.people)||[];
    const ready=ppl.filter(p=>p.ready);
    const notReady=ppl.filter(p=>!p.ready);   // not_ready + unknown
    _fillReadiness(HOME, ready, 0x22C55E);     // СЛЕВА — готовы (зелёные)
    _fillReadiness(ARCH, notReady, 0xe0a000);  // СПРАВА — не готовы / не определились (оранжевые)
    const l1=label('✅ ГОТОВЫ к выезду · '+ready.length,12,0x8ff0b0,'800'); l1.anchor.set(.5,0); l1.x=HOME.x+HOME.w/2; l1.y=HOME.y+20; l1.zIndex=9000; world.addChild(l1);
    const l2=label('⏳ НЕ ГОТОВЫ · '+notReady.length,12,0xffd98a,'800'); l2.anchor.set(.5,0); l2.x=ARCH.x+ARCH.w/2; l2.y=ARCH.y+20; l2.zIndex=9000; world.addChild(l2);
  })();

  // ======================= ЛОГИСТИКА В ДВИЖЕНИИ =======================
  // ХАБ ВАХТЫ (аэропорт-вокзал) — точка отправки/возврата вахты домой и на объекты.
  (function(){
    const H=HUB; const g=new PIXI.Graphics(); g.zIndex=H.y;
    g.beginFill(0x0e1422); g.drawRoundedRect(H.x,H.y,H.w,H.h,16); g.endFill();
    g.lineStyle(2.5,COL.gold,.6); g.drawRoundedRect(H.x,H.y,H.w,H.h,16); g.lineStyle(0);
    // терминал
    g.beginFill(0x2a3550); g.drawRoundedRect(H.x+20,H.y+40,H.w-40,H.h-70,8); g.endFill();
    g.beginFill(0x1a2336); g.moveTo(H.x+20,H.y+40); g.lineTo(H.x+H.w/2,H.y+18); g.lineTo(H.x+H.w-20,H.y+40); g.closePath(); g.endFill();
    g.beginFill(0x2bd4c9,.5); for(let i=0;i<8;i++) g.drawRect(H.x+34+i*((H.w-68)/8),H.y+54,16,20); g.endFill();
    // ВПП с разметкой
    g.beginFill(0x12161e); g.drawRoundedRect(H.x+30,H.y+H.h-26,H.w-60,16,6); g.endFill();
    g.beginFill(0xe6c45a,.8); for(let x=H.x+44;x<H.x+H.w-40;x+=26) g.drawRect(x,H.y+H.h-19,14,3); g.endFill();
    // ж/д платформа сбоку
    g.lineStyle(3,0x4a4036,.8); g.moveTo(H.x+10,H.y+H.h-40);g.lineTo(H.x+H.w-10,H.y+H.h-40); g.lineStyle(0);
    world.addChild(g);
    const t=label('🛫 ХАБ ВАХТЫ · Москва (отправка / возврат)',14,0xffe39a,'800'); t.anchor.set(.5,0);
    t.x=H.x+H.w/2; t.y=H.y+6; t.zIndex=9000; world.addChild(t);
    HUB.cx=H.x+H.w/2; HUB.cy=H.y+H.h/2;
  })();

  // ======================= МЕДЦЕНТР (медосмотр ПЕРЕД вылетом, в Москве/Саратове) =======================
  // По ТЗ: медосмотр все проходят в одном месте (Москва/Саратов) ДО объекта, а не на объекте.
  // Данные CRM: field_trip_stages(stage_type='medical', date_from) + worker_training(training_type='medical').
  (function(){
    const M=MEDHUB; const g=new PIXI.Graphics(); g.zIndex=M.y;
    g.beginFill(0x0e1a18); g.drawRoundedRect(M.x,M.y,M.w,M.h,16); g.endFill();
    g.lineStyle(2.5,0x3fb98a,.7); g.drawRoundedRect(M.x,M.y,M.w,M.h,16); g.lineStyle(0);
    // корпус клиники
    g.beginFill(0x223a38); g.drawRoundedRect(M.x+18,M.y+38,M.w-36,M.h-66,8); g.endFill();
    g.beginFill(0xc9d4de,.85); for(let i=0;i<4;i++) for(let j=0;j<2;j++) g.drawRect(M.x+30+i*((M.w-60)/4),M.y+52+j*30,18,18); g.endFill();
    // зелёный крест
    g.beginFill(0x3fb950); g.drawRect(M.x+M.w/2-5,M.y+M.h-44,10,28); g.drawRect(M.x+M.w/2-14,M.y+M.h-35,28,10); g.endFill();
    // кушетки
    g.beginFill(0xeef3f8); g.drawRoundedRect(M.x+24,M.y+M.h-22,50,10,4); g.drawRoundedRect(M.x+M.w-74,M.y+M.h-22,50,10,4); g.endFill();
    world.addChild(g);
    const t=label('🩺 МЕДЦЕНТР · '+MEDHUB.city,13,0x8fe6c0,'800'); t.anchor.set(.5,0);
    t.x=M.x+M.w/2; t.y=M.y+6; t.zIndex=9000; world.addChild(t);
    const sub=label('медосмотр перед вылетом',10,0x9fc0b4,'700'); sub.anchor.set(.5,0);
    sub.x=M.x+M.w/2; sub.y=M.y+22; sub.zIndex=9000; world.addChild(sub);
    MEDHUB.cx=M.x+M.w/2; MEDHUB.cy=M.y+M.h/2;
  })();

  // точки отправления у объекта (где садятся/высаживаются) и узлы
  function sitePort(s){ return { x:s.x-40, y:s.y+s.h*0.5 }; }
  const HUBP = { x:HUB.cx, y:HUB.y+10 };

  // маршруты: from→to через контрольную точку (дуга). kind задаёт вид транспорта.
  const ROUTES = (_DATA.routes || []).map(r=>{
    const s = SITES.find(x=>String(x.key)===String(r.siteKey));
    if(!s) return null;
    const b = sitePort(s);
    const a = (r.kind==='ship'||r.kind==='bus') ? {x:s.x-280,y:s.y+s.h*0.7} : HUBP;
    const c = {x:(a.x+b.x)/2, y:Math.min(a.y,b.y)-200};
    return { kind:r.kind, label:r.label, site:s, a, b, c };
  }).filter(Boolean);

  // ---- маршрутные линии (рисуем заранее) ----
  function bez(a,c,b,t){ const u=1-t; return { x:u*u*a.x+2*u*t*c.x+t*t*b.x, y:u*u*a.y+2*u*t*c.y+t*t*b.y }; }
  const routeTrails=[]; const routeLabels=[];
  ROUTES.forEach(r=>{
    const ln=new PIXI.Graphics(); ln.zIndex=-150;
    const col = r.kind==='ship'?0x4a9fd0 : r.kind==='heli'?0x8fe0ff : r.kind==='train'?0xe0bc5e : r.kind==='bus'?0xaad88a : 0x8ab8ff;
    // мягкое свечение-подложка (несколько слоёв пунктира)
    [[7,0.10],[4.5,0.16],[2.6,0.42]].forEach(([wd,al])=>{
      for(let t=0;t<1;t+=0.012){ const p=bez(r.a,r.c,r.b,t), q=bez(r.a,r.c,r.b,t+0.007);
        ln.lineStyle(wd,col,al); ln.moveTo(p.x,p.y); ln.lineTo(q.x,q.y); } });
    ln.lineStyle(0);
    // рельсы для поезда (шпалы)
    if(r.kind==='train'){ for(let t=0;t<1;t+=0.025){ const p=bez(r.a,r.c,r.b,t),
        n=bez(r.a,r.c,r.b,t+0.001); const ang=Math.atan2(n.y-p.y,n.x-p.x)+Math.PI/2;
      ln.lineStyle(2.6,0x7a6a44,.6); ln.moveTo(p.x+Math.cos(ang)*8,p.y+Math.sin(ang)*8);
      ln.lineTo(p.x-Math.cos(ang)*8,p.y-Math.sin(ang)*8);} ln.lineStyle(0); }
    // конечные «порты» — пульсирующие маркеры
    [r.a,r.b].forEach(pt=>{ ln.beginFill(col,.5); ln.drawCircle(pt.x,pt.y,7); ln.endFill();
      ln.lineStyle(2,col,.9); ln.drawCircle(pt.x,pt.y,11); ln.lineStyle(0); });
    world.addChild(ln);
    // бегущая «змейка» (анимируется в тикере)
    const tg=new PIXI.Graphics(); tg.zIndex=-140; world.addChild(tg);
    routeTrails.push({ g:tg, a:r.a, b:r.b, c:r.c, col });
    // подпись маршрута у середины с подложкой-плашкой
    const mid=bez(r.a,r.c,r.b,0.5);
    const tl=label(r.label,13,0xeaf2ff,'800'); tl.anchor.set(.5,.5);
    const pad=8; const bg=new PIXI.Graphics();
    bg.beginFill(0x0a0e18,.78); bg.drawRoundedRect(-tl.width/2-pad,-tl.height/2-3,tl.width+pad*2,tl.height+6,9); bg.endFill();
    bg.lineStyle(1.5,col,.8); bg.drawRoundedRect(-tl.width/2-pad,-tl.height/2-3,tl.width+pad*2,tl.height+6,9); bg.lineStyle(0);
    const wrap=new PIXI.Container(); wrap.addChild(bg); wrap.addChild(tl);
    wrap.x=mid.x; wrap.y=mid.y-14; wrap.zIndex=8500; world.addChild(wrap); routeLabels.push(wrap);
  });

  // мини-пассажир (голова в каске) в окне
  function paxHead(g,x,y,r){ r=r||2.4;
    g.beginFill(0xe8c4a0); g.drawCircle(x,y+r*0.3,r); g.endFill();          // лицо
    g.beginFill(0xff8c2a); g.arc(x,y,r,Math.PI,0); g.endFill();             // оранжевая каска
    g.beginFill(0xffb86a); g.drawRect(x-r,y-1,r*2,1.4); g.endFill(); }
  // ---- векторные транспортные средства ----
  function drawVehicle(kind, dir, npax){
    npax = npax||0;
    const c=new PIXI.Container(); const g=new PIXI.Graphics();
    const fwd = dir==='home' ? -1 : 1;   // повернём по направлению
    if(kind==='plane'){
      g.beginFill(0x000000,.22); g.drawEllipse(0,16,26,6); g.endFill();              // тень
      g.lineStyle(1.4,OUT,.7);
      g.beginFill(0xeaf0f7); g.moveTo(-26,0); g.quadraticCurveTo(-30,-5,-22,-6);
      g.lineTo(20,-6); g.quadraticCurveTo(30,-5,30,0); g.quadraticCurveTo(30,5,20,6);
      g.lineTo(-22,6); g.quadraticCurveTo(-30,5,-26,0); g.closePath(); g.endFill();   // фюзеляж
      g.beginFill(0xc7d2de); g.moveTo(-8,-5); g.lineTo(2,-26); g.lineTo(10,-26); g.lineTo(6,-4); g.closePath();
      g.moveTo(-8,5);  g.lineTo(2,26);  g.lineTo(10,26);  g.lineTo(6,4);  g.closePath(); g.endFill(); // крылья
      g.beginFill(0xc7d2de); g.moveTo(-24,-4); g.lineTo(-30,-12); g.lineTo(-22,-4); g.closePath();
      g.moveTo(-24,4);  g.lineTo(-30,12);  g.lineTo(-22,4);  g.closePath(); g.endFill(); // хвост
      g.lineStyle(0);
      // ИЛЛЮМИНАТОРЫ с пассажирами
      g.beginFill(0x0a1422); for(let i=-18;i<18;i+=5) g.drawCircle(i,0,2); g.endFill();
      let shown=0; for(let i=-18;i<18 && shown<Math.min(npax,8);i+=5){ paxHead(g,i,0.4,1.6); shown++; }
      g.beginFill(0x3aa0ff,.55); for(let i=-18;i<18;i+=5) g.drawCircle(i,-0.5,2); g.endFill(); // стекло-блик
      g.beginFill(0xe23a3a); g.drawCircle(24,0,2.4); g.endFill();                      // нос-маркер
      g.beginFill(0x1f6fff); g.drawRect(-2,-26,4,3); g.endFill();                       // киль-цвет
    } else if(kind==='heli'){
      g.beginFill(0x000000,.22); g.drawEllipse(0,16,22,6); g.endFill();
      g.lineStyle(1.4,OUT,.7);
      g.beginFill(0x2e6bd6); g.drawEllipse(-2,0,18,11); g.endFill();                   // кабина
      g.beginFill(0x1f4fa8); g.drawRect(14,-3,26,6); g.endFill();                       // хвостовая балка
      g.beginFill(0x2e6bd6); g.drawRect(38,-9,3,16); g.endFill();                        // киль
      g.lineStyle(0); g.beginFill(0x0a1422); g.drawEllipse(-8,-2,7,6); g.endFill();      // остекление
      // пассажиры в кабине
      let sh=0; for(let i=0;i<Math.min(npax,3);i++){ paxHead(g,-12+i*5,-2,1.6); sh++; }
      g.beginFill(0x9cd0ff,.45); g.drawEllipse(-8,-3,7,6); g.endFill();                  // блик стекла
      g.beginFill(0x222); g.drawRect(-12,11,24,2); g.endFill();                          // полозья
      const rot=new PIXI.Graphics(); rot.beginFill(0xcfd8e2,.9); rot.drawRoundedRect(-34,-2,68,4,2); rot.endFill();
      rot.beginFill(0xcfd8e2,.6); rot.drawRoundedRect(-2,-34,4,68,2); rot.endFill();
      rot.y=-12; c._rotor=rot;
      g.beginFill(0x333); g.drawCircle(-2,-12,3); g.endFill();
      c.addChild(g); c.addChild(rot); c._body=g; c.scale.set(1);
      if(fwd<0) c.scale.x=-1;
      return c;
    } else if(kind==='train'){
      g.beginFill(0x000000,.20); g.drawEllipse(0,12,40,5); g.endFill();
      g.lineStyle(1.3,OUT,.7);
      // локомотив + 2 вагона
      g.beginFill(0xe23a3a); g.drawRoundedRect(-46,-10,26,18,4); g.endFill();
      g.beginFill(0xb02a2a); g.drawRect(-46,-10,26,5); g.endFill();
      g.beginFill(0x9ad0ff,.8); g.drawRect(-42,-6,8,7); g.endFill();
      let ti=0; [[-16],[14]].forEach(([x])=>{ g.beginFill(0x3a6b8a); g.drawRoundedRect(x,-9,26,16,4); g.endFill();
        for(let i=0;i<3;i++){ g.beginFill(0x0a1422); g.drawRect(x+4+i*7,-5,5,7); g.endFill();
          if(ti<npax){ paxHead(g,x+6.5+i*7,-2,1.5); ti++; }
          g.beginFill(0x9cd0ff,.5); g.drawRect(x+4+i*7,-5,5,3); g.endFill(); } });
      g.lineStyle(0); g.beginFill(0x15191f); [-40,-26,-6,8,22,38].forEach(x=>g.drawCircle(x,9,3)); g.endFill();
      g.beginFill(0xcfd8e2,.5); g.drawEllipse(-44,-16,4,6); g.endFill();                 // дымок-намёк
    } else if(kind==='bus'){
      g.beginFill(0x000000,.20); g.drawEllipse(0,13,24,5); g.endFill();
      g.lineStyle(1.3,OUT,.75);
      g.beginFill(0x2f6b3a); g.drawRoundedRect(-22,-12,30,20,4); g.endFill();            // кунг
      g.beginFill(0x244f2c); g.drawRect(-22,-12,30,5); g.endFill();
      // окна кунга с пассажирами
      let bi=0; for(let i=0;i<4;i++){ const wx=-19+i*7.5; g.beginFill(0x0a1422); g.drawRect(wx,-8,5,6); g.endFill();
        if(bi<npax){ paxHead(g,wx+2.5,-5,1.5); bi++; } g.beginFill(0x9cd0ff,.5); g.drawRect(wx,-8,5,3); g.endFill(); }
      g.beginFill(0xffe14a,.9); g.drawRect(-22,-1,30,3); g.endFill();                      // светополоса
      g.beginFill(0x3a4350); g.drawRoundedRect(8,-8,16,16,3); g.endFill();                 // кабина
      g.beginFill(0x9cd0ff,.8); g.drawRect(11,-5,11,7); g.endFill();
      g.lineStyle(0); g.beginFill(0x15191f); [-16,-2,16].forEach(x=>g.drawCircle(x,9,5)); g.endFill();
      g.beginFill(0x3a4350); [-16,-2,16].forEach(x=>g.drawCircle(x,9,2)); g.endFill();
    } else { // ship
      g.beginFill(0x000000,.18); g.drawEllipse(0,16,40,7); g.endFill();
      g.lineStyle(1.4,OUT,.7);
      g.beginFill(0x2a3a4e); g.moveTo(-42,0); g.lineTo(40,0); g.lineTo(30,16); g.lineTo(-32,16); g.closePath(); g.endFill(); // корпус
      g.beginFill(0xe23a3a); g.drawRect(-42,-3,82,4); g.endFill();                          // борт
      g.lineStyle(0); g.beginFill(0xc9d4de); g.drawRoundedRect(-6,-22,30,22,3); g.endFill(); // надстройка
      // окна надстройки + пассажиры на палубе
      let si=0; for(let i=0;i<4;i++){ g.beginFill(0x0a1422); g.drawRect(-2+i*7,-18,5,6); g.endFill();
        if(si<Math.min(npax,2)){ paxHead(g,0.5+i*7,-15,1.5); si++; } g.beginFill(0x9cd0ff,.5); g.drawRect(-2+i*7,-18,5,3); g.endFill(); }
      for(let i=0;i<Math.min(npax,4);i++){ paxHead(g,-26+i*6,-1,1.6); }                    // на палубе
      g.beginFill(0xb05a46); g.drawRect(28,-30,7,18); g.endFill();                            // труба
      g.beginFill(0x3a4350); g.drawRect(-30,-14,16,14); g.endFill();                          // кран-палуба
    }
    c.addChild(g); c._body=g; if(fwd<0) c.scale.x=-1;
    return c;
  }

  const ICON = { plane:'✈', heli:'🚁', train:'🚂', bus:'🚌', ship:'🚢' };
  // длительность рейса (сим-часы). Подобрано так, чтобы перелёт был ПЛАВНЫМ и заметным (не «за секунду»),
  // но в небе почти всегда кто-то летит. Реально маппится на field_logistics.date_from/date_to.
  const TRAVEL_HOURS = { plane:14, heli:8, train:30, bus:20, ship:34 };
  class Vehicle {
    constructor(route, dir, pax){
      this.r=route; this.dir=dir; this.pax=pax||[]; this.kind=route.kind;
      this.hours = TRAVEL_HOURS[route.kind]||14;
      // первый вылет — скоро (0..0.5 сим-суток), борты стартуют вразнобой
            if (route._real && route._real.departAt) {
        this.departAt = new Date(route._real.departAt).getTime();
        this.arriveAt = route._real.arriveAt ? new Date(route._real.arriveAt).getTime() : (this.departAt + this.hours*HOUR);
        this.dir = route._real.dir === "home" ? "home" : "to";
        this._realFlight = true; this.dwell = 0;
      } else {
        // нет реального рейса — лёгкая «дежурная» анимация, чтобы небо не пустовало
        this.departAt = simNow() + (Math.random()*0.5)*DAY;
        this.arriveAt = this.departAt + this.hours*HOUR;
        this.dwell = (0.4+Math.random()*0.8)*DAY;
      }
      this.c=drawVehicle(route.kind, dir, this.pax.length); this.c.zIndex=route.b.y+5;
      this.c.visible=false;
      // плашка с ДАТАМИ рейса
      this.plate=new PIXI.Container(); this.plate.y=-36;
      this.pg=new PIXI.Graphics(); this.tl=new PIXI.Text('',{fontFamily:FONT,fontSize:11,fill:0xeaf2ff,fontWeight:'700',align:'center'});
      this.tl.anchor.set(.5); this.plate.addChild(this.pg); this.plate.addChild(this.tl); this.c.addChild(this.plate);
      this.c.eventMode='static'; this.c.cursor='pointer';
      this.c.on('pointertap',()=>{ if(!drag.moved) openFlightDrawer(this); });
      LOGI.addChild(this.c);
      this._lastTxt='';
    }
    setPlate(txt, col){ if(txt===this._lastTxt) return; this._lastTxt=txt;
      this.tl.text=txt; const w=this.tl.width+18, h=this.tl.height+8;
      this.pg.clear(); this.pg.beginFill(0x0a0e18,.92); this.pg.drawRoundedRect(-w/2,-h/2,w,h,7); this.pg.endFill();
      this.pg.lineStyle(1.5,col,.9); this.pg.drawRoundedRect(-w/2,-h/2,w,h,7); this.pg.lineStyle(0);
      this.pg.beginFill(0x0a0e18,.92); this.pg.moveTo(-4,h/2);this.pg.lineTo(4,h/2);this.pg.lineTo(0,h/2+5);this.pg.closePath(); this.pg.endFill();
    }
    pos(t){ const a=this.dir==='to'?this.r.a:this.r.b, b=this.dir==='to'?this.r.b:this.r.a;
      return bez(a,this.r.c,b,t); }
    update(){
      const now=simNow();
      if(now < this.departAt){ this.c.visible=false; return; }      // ещё не вылетел (народ на медосмотре/дома)
      if(now <= this.arriveAt){
        // ЛЕТИТ/ЕДЕТ — позиция по доле пройденного календарного времени
        this.c.visible=true;
        const frac=(now-this.departAt)/(this.arriveAt-this.departAt);
        const p=this.pos(frac), q=this.pos(Math.min(1,frac+0.01));
        this.c.x=p.x; this.c.y=p.y; this.c.zIndex=p.y+5;
        this.c.scale.x=(this.dir==='home')?-1:1;
        const ang=Math.atan2(q.y-p.y,q.x-p.x);
        if(this.kind==='plane') this.c.rotation=ang*0.5*(this.c.scale.x<0?-1:1);
        this.plate.rotation=-this.c.rotation;
        if(this.c._rotor) this.c._rotor.rotation += 0.5;
        const toObj=this.dir==='to';
        const etaH=Math.max(0,Math.round((this.arriveAt-now)/HOUR));
        this.setPlate(ICON[this.kind]+' '+this.pax.length+' чел · '+(toObj?'→ '+this.r.site.name.replace(/«|»/g,''):'← домой')+
          '\nвылет '+simDateShort(this.departAt)+' · ETA '+etaH+' ч', toObj?0x3fb950:0x3a7fd0);
        return;
      }
      // ПРИБЫЛ → стоянка, затем разворот и новый рейс
      this.c.visible=false;
      if(!this._realFlight && now > this.arriveAt + this.dwell){
        this.dir = this.dir==='to'?'home':'to';
        this.departAt = now + (0.2+Math.random()*0.6)*DAY;
        this.arriveAt = this.departAt + this.hours*HOUR;
        this.dwell = (0.4+Math.random()*0.8)*DAY;
      }
    }
  }
  const LOGI=new PIXI.Container(); LOGI.sortableChildren=true; world.addChild(LOGI);

  // собрать пассажиров из transit-рабочих по объектам и раскидать по маршрутам
  const vehicles=[];
  (function(){
    const transitBySite={};
    SITES.forEach(s=>{ transitBySite[s.key]=(s.crew||[]).filter(c=>c.status==='transit'); });
    ROUTES.forEach(r=>{
      const cap = r.kind==='ship'?5 : r.kind==='heli'?3 : r.kind==='plane'?8 : 5;
      let pax = transitBySite[r.site.key] ? transitBySite[r.site.key].splice(0, cap) : [];
      // фейк-пассажиров НЕ добавляем — только реальный transit-крю (борт может быть пустым, тогда не летит)
      const _rf = (_DATA.flights||[]).find(fl => fl.site && String(fl.site.id)===String(r.site.key));
      if(_rf){ r._real = { departAt:_rf.departAt, arriveAt:_rf.arriveAt, dir:_rf.dir }; }
      if(!_rf && !pax.length) return;   // нет реального рейса и некого везти — пропускаем
      const v=new Vehicle(r, _rf ? (_rf.dir==='home'?'home':'to') : 'to', pax);
      // проставляем пассажирам даты рейса + медосмотр перед вылетом (как field_logistics + field_trip_stages)
      pax.forEach(p=>{ p.flight={ kind:r.kind, departAt:v.departAt, arriveAt:v.arriveAt, site:r.site, dir:v.dir };
        p.medAt = v.departAt - (1+Math.floor(Math.random()*2))*DAY;   // медосмотр за 1-2 дня до вылета
        p.medPlace = MEDHUB.city; });
      vehicles.push(v);
    });
  })();

  // ======================= ПОВЕДЕНИЕ (спокойное) =======================
  const DESK_ACTS = { PM:['work','tender','estimate','phone'], HEAD_PM:['work','approve','phone'],
    TO:['tender','work','phone'], PROC:['work','invoice','approve'], BUH:['invoice','work'],
    OFFICE_MANAGER:['work','phone'], DIRECTOR_GEN:['approve','work'], WAREHOUSE:['work'],
    CHIEF_ENGINEER:['work','phone'], default:['work'] };
  let lastApprove=0, lastMimir=0;

  function pickDeskAct(h){ const arr=DESK_ACTS[h.s.role]||DESK_ACTS.default; return arr[Math.floor(Math.random()*arr.length)]; }

  function tick(){
    if(paused) return;
    const now=performance.now()/1000;
    heroes.forEach(h=>{
      if(h.state==='walking') return;
      if(h._realBreak || (h._real && (h._real.on_call || h._real.idle || h._real.self_act || h._real.online===false))) return; // реальный режим важнее случайного
      if(h.t < h.hold) return;                    // инерция: рано менять
      h.t=0; h.hold=8+Math.random()*10;
      const r=Math.random();
      if(r<0.12){ doBreak(h); }                   // редкий перекур/кофе/обед
      else if(r<0.18){ h.setAct(pickDeskAct(h)); } // редкая смена занятия за столом
      // иначе — продолжает текущее (спокойно сидит)
    });
    // согласование (двое идут навстречу) — не чаще раза в ~35с
    if(now-lastApprove>35 && Math.random()<0.5){ lastApprove=now; doApproval(); }
    // визит к Мимиру — не чаще раза в ~45с
    if(now-lastMimir>45 && Math.random()<0.5){ lastMimir=now; doMimir(); }
  }

  function doBreak(h){
    const kind=['coffee','smoke','lunch'][Math.floor(Math.random()*3)];
    const sx = HALL.x+60+Math.random()*40, sy = HALL.y+HALL.h-150+Math.random()*60; // угол-кухня
    h.setAct(kind); h.state='walking';
    h.walkTo(sx,sy,()=>{ h.setAct(kind);
      setTimeout(()=>{ if(paused){return;} h.setAct('work'); h.walkTo(h.home.x,h.home.y-6,()=>{ h.setAct(pickDeskAct(h)); }); }, 5000+Math.random()*4000);
    });
  }
  function doApproval(){
    const cand=heroes.filter(h=>h.state!=='walking' && ['PM','HEAD_PM','PROC','DIRECTOR_GEN'].includes(h.s.role));
    if(cand.length<2) return;
    const a=cand[Math.floor(Math.random()*cand.length)];
    let b=cand[Math.floor(Math.random()*cand.length)]; if(a===b) return;
    const mx=(a.home.x+b.home.x)/2, my=(a.home.y+b.home.y)/2;
    [a,b].forEach(h=>{ h.setAct('approve'); h.walkTo(mx + (h===a?-26:26), my,()=>{ h.setAct('approve');
      setTimeout(()=>{ if(paused)return; h.walkTo(h.home.x,h.home.y-6,()=>h.setAct(pickDeskAct(h))); }, 4500); }); });
  }
  function doMimir(){
    const cand=heroes.filter(h=>h.state!=='walking');
    if(!cand.length) return; const h=cand[Math.floor(Math.random()*cand.length)];
    h.setAct('mimir'); h.walkTo(wellX-46, wellY-6,()=>{ h.setAct('mimir');
      setTimeout(()=>{ if(paused)return; h.walkTo(h.home.x,h.home.y-6,()=>h.setAct(pickDeskAct(h))); }, 5000); });
  }

  // индекс героев по реальному user_id (staff несёт user_id из /live)
  const _heroByUser = {};
  heroes.forEach(h=>{ if(h.s && h.s.user_id!=null) _heroByUser[h.s.user_id]=h; });
  const _liveState = {}; // user_id → последний применённый «реальный» режим (чтобы не дёргать зря)

  // увести героя на перерыв конкретного вида (coffee/smoke/lunch) и держать пока режим активен
  function _heroBreak(h, kind){
    if(h._realBreak===kind) return;        // уже на этом перерыве
    h._realBreak=kind; if(h.state==='walking') return;
    const sx = HALL.x+60+Math.random()*40, sy = HALL.y+HALL.h-150+Math.random()*60;
    h.setAct(kind); h.state='walking';
    h.walkTo(sx,sy,()=>{ h.setAct(kind); });
  }
  // вернуть героя за стол
  function _heroDesk(h, act){
    h._realBreak=null;
    if(h.state==='walking') return;
    if(Math.hypot(h.c.x-h.home.x, h.c.y-(h.home.y-6))>6){
      h.setAct(act||'work'); h.walkTo(h.home.x,h.home.y-6,()=>{ h.setAct(act||pickDeskAct(h)); });
    } else h.setAct(act||pickDeskAct(h));
  }

  // применить снимок /live к аватарам. people: [{user_id,online,on_call,idle,self_act,status_code}]
  function _applyLive(people){
    (people||[]).forEach(p=>{
      const h=_heroByUser[p.user_id]; if(!h) return;
      h._real = p; // храним для drawer/«что делает»
      let mode;
      if(p.self_act) mode = p.self_act;                 // coffee/smoke/lunch
      else if(p.on_call) mode = 'phone';
      else if(p.idle) mode = 'coffee';                  // отошёл → кофе-зона
      else if(!p.online) mode = 'home';
      else if(p.status_code==='уд') mode = 'remote';
      else mode = 'work';
      if(_liveState[p.user_id]===mode) return;          // без изменений
      _liveState[p.user_id]=mode;
      if(mode==='coffee'||mode==='smoke'||mode==='lunch') _heroBreak(h, mode);
      else if(mode==='phone'){ h._realBreak=null; if(h.state!=='walking') h.setAct('phone'); }
      else if(mode==='remote'){ h._realBreak=null; if(h.state!=='walking') h.setAct('remote'); }
      else if(mode==='home'){ h._realBreak=null; h.setAct('home'); }   // alpha .25 (см. setAct)
      else _heroDesk(h, pickDeskAct(h));
    });
  }
  window.__oflApplyLive = _applyLive;
  setInterval(tick, 1500);

  // ======================= ТИКЕР =======================
  let paused=false;
  app.ticker.add(()=>{
    const dt=Math.min(app.ticker.deltaMS/1000, .05);
    if(!paused){ heroes.forEach(h=>h.update(dt)); workers.forEach(w=>w.update(dt));
      vehicles.forEach(v=>v.update()); }
    // факелы мерцают
    const fl=0.7+Math.sin(performance.now()/120)*0.3;
    torches.forEach((t,i)=>{ const g=t.fl; g.clear();
      const h=14+Math.sin(performance.now()/100+i)*3;
      g.beginFill(0xff8a2a,.9); g.drawEllipse(0,-h/2,5,h); g.endFill();
      g.beginFill(0xffd86a,.95); g.drawEllipse(0,-h/2+2,2.5,h*0.6); g.endFill(); });
    // колодец пульсирует
    if(well.glow) well.glow.alpha=0.85+Math.sin(performance.now()/700)*0.15;
    // факел платформы + дым завода
    SITES.forEach(s=>{
      if(s.fire){ const g=s.fire; g.clear(); const h=18+Math.sin(performance.now()/90)*5;
        g.beginFill(0xff7a2a,.92); g.drawEllipse(0,-h/2,7,h); g.endFill();
        g.beginFill(0xffd86a,.9); g.drawEllipse(0,-h/2+3,3.5,h*0.6); g.endFill(); }
      ['smoke0','smoke1','smoke2'].forEach((k,i)=>{ if(!s[k]) return; const g=s[k]; g.clear();
        for(let p=0;p<3;p++){ const ph=(performance.now()/700+p*0.4+i)%1;
          g.beginFill(0xaab0b8, .25*(1-ph)); g.drawCircle(Math.sin(ph*5+i)*6, -ph*40, 5+ph*9); g.endFill(); } });
    });
    // дрейф судов в море + покачивание
    if(!paused) seaShips.forEach(sh=>{ sh.x += sh._spd*sh._dir*dt;
      sh.rotation=Math.sin(performance.now()/800+sh.x*0.01)*0.04;
      const sea=BIOMES[0]; if(sh.x>sea.x+sea.w-80){ sh._dir=-1; sh.scale.x=-1; } if(sh.x<sea.x+80){ sh._dir=1; sh.scale.x=1; } });
    // маршрутные следы-пунктиры (бегущая «змейка»)
    routeTrails.forEach(rt=>{ rt.g.clear(); const off=(performance.now()/600)%1;
      for(let t=0;t<1;t+=0.05){ const tt=(t+off)%1; const p=bez(rt.a,rt.c,rt.b,tt);
        rt.g.beginFill(rt.col,.5*(1-Math.abs(tt-0.5)*1.2)); rt.g.drawCircle(p.x,p.y,2.4); rt.g.endFill(); } });
    updateStats();
  });

  // ======================= КАМЕРА =======================
  const cam={x:0,y:0,scale:0.6}; const drag={on:false,moved:false,sx:0,sy:0,cx:0,cy:0};
  function applyCam(){ world.scale.set(cam.scale); world.x=-cam.x*cam.scale+app.renderer.width/2/(app.renderer.resolution);
    world.y=-cam.y*cam.scale+app.renderer.height/2/(app.renderer.resolution); }
  function fitAll(){ const vw=window.innerWidth, vh=window.innerHeight;
    cam.scale=Math.min(vw/TOTAL_W, vh/TOTAL_H)*0.94; cam.x=TOTAL_W/2; cam.y=TOTAL_H/2; applyCam(); }
  function focusOn(x,y,sc){ cam.x=x; cam.y=y; if(sc)cam.scale=sc; applyCam(); }
  // плавный пролёт камеры к объекту
  let camAnim=null;
  function flyTo(x,y,sc){ camAnim={x0:cam.x,y0:cam.y,s0:cam.scale,x1:x,y1:y,s1:sc||1.0,t:0}; }
  app.ticker.add(()=>{ if(!camAnim) return; camAnim.t=Math.min(1,camAnim.t+0.045);
    const k=1-Math.pow(1-camAnim.t,3);
    cam.x=camAnim.x0+(camAnim.x1-camAnim.x0)*k; cam.y=camAnim.y0+(camAnim.y1-camAnim.y0)*k;
    cam.scale=camAnim.s0+(camAnim.s1-camAnim.s0)*k; applyCam();
    if(camAnim.t>=1) camAnim=null; });
  _W('resize',()=>{ applyCam(); });
  app.view.addEventListener('wheel',e=>{ e.preventDefault(); camAnim=null;
    const f=e.deltaY<0?1.12:0.89; cam.scale=Math.max(0.12,Math.min(2.6,cam.scale*f)); applyCam(); },{passive:false});
  app.view.addEventListener('pointerdown',e=>{ drag.on=true; drag.moved=false; drag.sx=e.clientX; drag.sy=e.clientY; drag.cx=cam.x; drag.cy=cam.y; });
  _W('pointermove',e=>{ if(!drag.on)return; const dx=e.clientX-drag.sx, dy=e.clientY-drag.sy;
    if(Math.abs(dx)+Math.abs(dy)>4) drag.moved=true; cam.x=drag.cx-dx/cam.scale; cam.y=drag.cy-dy/cam.scale; applyCam(); });
  _W('pointerup',()=>{ drag.on=false; setTimeout(()=>drag.moved=false,30); });
  _W('keydown',e=>{
    if(e.code==='Space'){ paused=!paused; }
    else if(e.key==='f'||e.key==='F'){ flyTo(HALL.x+HALL.w/2,HALL.y+HALL.h/2,0.5); }
    else if(e.key==='s'||e.key==='S'){ toggleSummary(); }
    else if(e.key>='1' && e.key<='5'){ const s=SITES[+e.key-1]; if(s) flyTo(s.cx,s.cy,0.55); }
    else if(e.key==='0'){ fitAll(); }
    else if(e.key==='Escape'){ closeDrawer(); document.getElementById('summary').style.display='none'; }
  });

  // ======================= СТАТИСТИКА =======================
  function updateStats(){
    const $=(id)=>document.getElementById(id);
    const inOffice = STAFF.filter(s=>s._zone==='desk').length;
    const onRemote = STAFF.filter(s=>s._zone==='oremote').length;
    const atHome   = STAFF.filter(s=>s._zone==='ohome').length;
    const onObject = STAFF.filter(s=>s._zone==='object').length;
    const onField  = SITES.reduce((a,s)=>a+(s.crew||[]).filter(c=>c.status==='site').length,0) + onObject;
    if($('st-office')) $('st-office').textContent = inOffice;
    if($('st-field'))  $('st-field').textContent  = onField;
    const inAir = vehicles.filter(v=>v.c.visible).reduce((a,v)=>a+v.pax.length,0);
    if($('st-transit')) $('st-transit').textContent = inAir;
    if($('st-home')) $('st-home').textContent = onRemote + atHome;
    if($('clock')){ const d=new Date(); $('clock').textContent = String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }
  }
  // легенда
  (function(){ const L=document.getElementById('legend');
    [['work','работа'],['tender','тендер'],['invoice','счета'],['approve','согласование'],
     ['mimir','Мимир'],['remote','удалёнка']].forEach(([k,t])=>{
      const it=document.createElement('div'); it.className='it';
      it.innerHTML='<span class="dot" style="background:#'+ACT[k].c.toString(16).padStart(6,'0')+'"></span>'+ACT[k].e+' '+t;
      L.appendChild(it); });
    // транспорт-легенда
    [['✈','самолёт'],['🚁','вертолёт'],['🚂','поезд'],['🚌','вахтовка'],['🚢','судно']].forEach(([e,t])=>{
      const it=document.createElement('div'); it.className='it'; it.innerHTML=e+' '+t; L.appendChild(it); }); })();

  // мини-навигация: облёт камеры по объектам + вся карта + штаб
  (function(){ const N=document.getElementById('sitenav'); if(!N) return;
    const all=document.createElement('button'); all.className='hub'; all.textContent='🗺 Вся карта';
    all.onclick=()=>fitAll(); N.appendChild(all);
    const hub=document.createElement('button'); hub.className='hub'; hub.textContent='🏛 Штаб';
    hub.onclick=()=>flyTo(HALL.x+HALL.w/2,HALL.y+HALL.h/2,0.5); N.appendChild(hub);
    const ICN={platform:'🛢',gas:'⛽',plant:'🏭',snow:'❄'};
    SITES.forEach((s,i)=>{ const b=document.createElement('button');
      b.textContent=(ICN[s.type]||'📍')+' '+s.name.replace(/«|»/g,'')+' ['+(i+1)+']';
      b.onclick=()=>flyTo(s.cx,s.cy,0.55); N.appendChild(b); }); })();

  // ======================= ДОСЬЕ =======================
  const drawer=document.getElementById('drawer');
  function closeDrawer(){ drawer.classList.remove('open'); }
  document.getElementById('d-close').onclick=closeDrawer;
  const money=v=>(v==null?'—':(v<0?'−':'')+Math.abs(v).toLocaleString('ru')+' млн ₽');
  const pct=v=>(v==null?'—':v+'%');
  function bar(v,col){ return '<div class="bar"><i style="width:'+Math.max(0,Math.min(100,v))+'%;background:'+col+'"></i></div>'; }

  function openDrawer(s, act){
    document.getElementById('d-ava').textContent = s.female?'🧝‍♀️':'🧔';
    document.getElementById('d-name').textContent = s.name;
    document.getElementById('d-role').textContent = s.rus;
    const a = s._remote?'на удалёнке':(act?ACT[act].l:'в офисе');
    document.getElementById('d-pres').textContent = '● '+a;
    const B=document.getElementById('d-body'); let h='';

    if(s.role==='PM'||s.role==='HEAD_PM'){
      const works=s.works||[];
      h+='<div class="kpis">'+
        '<div class="kpi"><div class="v">'+works.length+'</div><div class="k">работ в ведении</div></div>'+
        '<div class="kpi"><div class="v">'+works.reduce((a,w)=>a+(w.workers||0),0)+'</div><div class="k">рабочих сейчас</div></div>'+
       '</div>';
      h+='<h3>Работы</h3>';
      works.forEach(w=>{
        const prep = w.phase==='Подготовка'||w.phase==='Мобилизация';
        const mcol = w.margin<0?'#f85149':(w.margin<10?'#d29922':'#3fb950');
        h+='<div class="wrow"><div class="t">'+w.t+'</div>'+
          '<div class="meta"><span class="pill">'+w.phase+'</span>'+
          (prep?('<span>готовность '+w.ready+'%</span>'):('<span>⏳ '+(w.daysLeft!=null?w.daysLeft+' дн.':'—')+'</span>'))+
          '<span>👷 '+w.workers+'</span></div>'+
          (prep? bar(w.ready,'linear-gradient(90deg,#1f6fff,#2bd4c9)') :
                 ('<div class="meta" style="margin-top:8px"><span>маржа <b style="color:'+mcol+'">'+pct(w.margin)+'</b></span>'+
                  '<span>прибыль сегодня <b style="color:'+mcol+'">'+money(w.profit)+'</b></span></div>'))+
          '</div>';
      });
    } else if(s.role==='TO'){
      const t=s.to; h+='<div class="kpis">'+
        '<div class="kpi"><div class="v">'+t.month+'</div><div class="k">тендеров за месяц</div></div>'+
        '<div class="kpi"><div class="v">'+t.conv+'%</div><div class="k">конверсия</div></div>'+
        '<div class="kpi"><div class="v good">'+t.won+'</div><div class="k">выиграно</div></div>'+
        '<div class="kpi"><div class="v bad">'+t.lost+'</div><div class="k">проиграно</div></div></div>'+
        '<h3>Активные</h3><div class="wrow"><div class="t">В работе: '+t.active+' тендеров</div>'+
        '<div class="meta"><span>сумма выигранных: <b>'+money(t.wonSum)+'</b></span></div></div>';
    } else if(s.role==='PROC'){
      const p=s.proc; h+='<div class="kpis">'+
        '<div class="kpi"><div class="v">'+p.inWork+'</div><div class="k">закупок в работе</div></div>'+
        '<div class="kpi"><div class="v">'+p.positions+'</div><div class="k">позиций</div></div>'+
        '<div class="kpi"><div class="v warn">'+p.waiting+'</div><div class="k">ждут согласования</div></div>'+
        '<div class="kpi"><div class="v bad">'+p.overdue+'</div><div class="k">просрочены</div></div></div>'+
        '<h3>Оплаты</h3><div class="wrow"><div class="t">Оплачено: '+p.paid+'</div></div>';
    } else if(s.role==='BUH'){
      const b=s.buh; h+='<div class="kpis">'+
        '<div class="kpi"><div class="v">'+b.invoicesMonth+'</div><div class="k">счетов за месяц</div></div>'+
        '<div class="kpi"><div class="v good">'+money(b.paidSum)+'</div><div class="k">оплачено</div></div>'+
        '<div class="kpi"><div class="v warn">'+b.pending+'</div><div class="k">в ожидании</div></div></div>';
    } else if(s.role==='OFFICE_MANAGER'){
      const o=s.office; h+='<div class="kpis">'+
        '<div class="kpi"><div class="v">'+o.corr+'</div><div class="k">корреспонденция</div></div>'+
        '<div class="kpi"><div class="v">'+o.contracts+'</div><div class="k">договоров</div></div>'+
        '<div class="kpi"><div class="v">'+o.seals+'</div><div class="k">печатей</div></div>'+
        '<div class="kpi"><div class="v">'+o.proxies+'</div><div class="k">доверенностей</div></div></div>';
    } else if(s.role==='WAREHOUSE'){
      const w=s.wh; h+='<div class="kpis">'+
        '<div class="kpi"><div class="v">'+w.incoming+'</div><div class="k">приёмка</div></div>'+
        '<div class="kpi"><div class="v">'+w.requests+'</div><div class="k">заявки на выдачу</div></div>'+
        '<div class="kpi"><div class="v">'+w.issued+'</div><div class="k">выдано</div></div>'+
        '<div class="kpi"><div class="v bad">'+w.lowStock+'</div><div class="k">низкий остаток</div></div></div>';
    } else if(s.role==='CHIEF_ENGINEER'){
      const e=s.eng; h+='<div class="kpis">'+
        '<div class="kpi"><div class="v bad">'+e.equipAlerts+'</div><div class="k">аварии оборуд.</div></div>'+
        '<div class="kpi"><div class="v">'+e.permits+'</div><div class="k">допусков</div></div>'+
        '<div class="kpi"><div class="v">'+e.maintenance+'</div><div class="k">ТО запланировано</div></div></div>';
    } else if(s.role==='DIRECTOR_GEN'){
      h+=yearBlock();
    }
    B.innerHTML=h; drawer.classList.add('open');
    document.getElementById('summary').style.display='none';
  }

  function yearBlock(){
    const recvPct = Math.round(YEAR.received/YEAR.revenue*100);
    const szPct = Math.round(YEAR.szUsed/YEAR.szLimit*100);
    const factPct = Math.round(YEAR.costFact/YEAR.costPlan*100);
    const arOvd = Math.round(YEAR.arOverdue/YEAR.ar*100);
    return ''+
    '<h3>Итоги года '+YEAR.year+' · P&L</h3><div class="kpis">'+
      '<div class="kpi"><div class="v">'+money(YEAR.revenue)+'</div><div class="k">выручка</div></div>'+
      '<div class="kpi"><div class="v good">'+money(YEAR.gross)+'</div><div class="k">валовая · '+YEAR.grossPct+'%</div></div>'+
      '<div class="kpi"><div class="v">'+money(YEAR.ebitda)+'</div><div class="k">EBITDA · '+YEAR.ebitdaPct+'%</div></div>'+
      '<div class="kpi"><div class="v '+(YEAR.net>=0?'good':'bad')+'">'+money(YEAR.net)+'</div><div class="k">чистая · '+YEAR.netPct+'%</div></div>'+
    '</div>'+
    '<div class="kpis">'+
      '<div class="kpi"><div class="v">'+YEAR.projects+'</div><div class="k">проектов за год</div></div>'+
      '<div class="kpi"><div class="v good">'+money(YEAR.profitFact)+'</div><div class="k">прибыль факт (кэш)</div></div>'+
    '</div>'+
    '<h3>Себестоимость за год</h3><div class="wrow"><div class="meta">'+
      '<span>план <b>'+money(YEAR.costPlan)+'</b></span><span>факт <b>'+money(YEAR.costFact)+'</b></span>'+
      '<span class="'+(YEAR.costFact<=YEAR.costPlan?'good':'bad')+'">'+factPct+'% плана</span></div>'+
      bar(factPct, YEAR.costFact<=YEAR.costPlan?'#3fb950':'#f85149')+'</div>'+
    '<h3>Деньги и расчёты</h3><div class="wrow"><div class="meta">'+
      '<span>получено <b class="good">'+money(YEAR.received)+'</b></span>'+
      '<span>осталось получить <b class="warn">'+money(YEAR.toReceive)+'</b></span></div>'+
      bar(recvPct,'linear-gradient(90deg,#1f6fff,#3fb950)')+
      '<div class="meta" style="margin-top:8px"><span>дебиторка <b>'+money(YEAR.ar)+'</b></span>'+
      '<span>просрочено <b class="bad">'+money(YEAR.arOverdue)+'</b> ('+arOvd+'%)</span>'+
      '<span>касса <b class="good">'+money(YEAR.cash)+'</b></span></div></div>'+
    '<h3>Самозанятые · лимит года</h3><div class="wrow"><div class="meta">'+
      '<span>лимит <b>'+money(YEAR.szLimit)+'</b></span>'+
      '<span>израсходовано <b class="warn">'+money(YEAR.szUsed)+'</b></span>'+
      '<span>остаток <b class="good">'+money(YEAR.szLeft)+'</b></span></div>'+
      bar(szPct, szPct>90?'#f85149':'#d29922')+'</div>'+
    '<h3>Тендеры · ОТ и ПБ</h3><div class="wrow"><div class="meta">'+
      '<span>конверсия <b>'+YEAR.tnConv+'%</b></span>'+
      '<span>выигр. сумма <b>'+money(YEAR.tnWonSum)+'</b></span>'+
      '<span>LTI <b class="'+(YEAR.lti===0?'good':'bad')+'">'+YEAR.lti+'</b></span>'+
      '<span>числ. <b>'+YEAR.headcount+'</b></span></div>'+
      '<div style="margin-top:8px;font-size:11.5px;opacity:.7">Полная аналитика — кнопка «📊 Сводка года»</div></div>';
  }

  // карта статусов вахты для досье/объекта
  const VST = {
    site:    {e:'🟢',l:'на смене (на объекте)',c:'#3fb950'},
    rest:    {e:'🛋',l:'отдых (комната отдыха)',c:'#d4b0e6'},
    sleep:   {e:'💤',l:'спит (вне смены)',c:'#9fb0c4'},
    transit: {e:'🚐',l:'в дороге на объект',c:'#9fd0ff'},
    medical: {e:'🩺',l:'медосмотр',c:'#8fe6c0'},
    home:    {e:'🏠',l:'дома · ожидает работу',c:'#c9b07a'},
    archive: {e:'🗄',l:'в архиве',c:'#8b97a6'},
  };

  function openSiteDrawer(s){
    document.getElementById('d-ava').textContent = s.type==='platform'?'🛢':(s.type==='plant'?'🏭':(s.type==='gas'?'⛽':'❄'));
    document.getElementById('d-name').textContent = s.name;
    document.getElementById('d-role').textContent = 'Объект · РП '+s.pm;
    const nW=s.crew.filter(c=>!c.master).length, nM=s.crew.filter(c=>c.master).length;
    const by={}; s.crew.forEach(c=>{ by[c.status]=(by[c.status]||0)+1; });
    document.getElementById('d-pres').textContent = '👷 '+nW+' рабочих · 🪖 '+nM+' мастеров · 🟢 '+(by.site||0)+' на смене';
    let h='<div style="font-size:11.5px;opacity:.6;margin-bottom:10px">📋 объект создан из работ · работ на объекте: <b>'+s.jobs.length+'</b></div>';
    h+='<div class="kpis">'+
      '<div class="kpi"><div class="v">'+(by.site||0)+'</div><div class="k">на смене сейчас</div></div>'+
      '<div class="kpi"><div class="v">'+(s.crew.length)+'</div><div class="k">всего в вахте</div></div></div>';
    // разбивка по статусам вахты
    h+='<h3>Вахта · где люди сейчас</h3><div class="wrow"><div class="meta">'+
      ['site','rest','sleep','transit','medical'].filter(k=>by[k]).map(k=>
        '<span class="pill" style="background:#16203a">'+VST[k].e+' '+VST[k].l.split(' ')[0]+' '+by[k]+'</span>').join(' ')+
      '</div><div class="meta" style="margin-top:6px"><span>'+(s.lodging==='судно'?'🚢 ':'🏨 ')+s.lodgeName+'</span></div></div>';
    h+='<h3>Работы</h3>';
    s.jobs.forEach(j=>{ const prep=j.phase==='Подготовка'||j.phase==='Мобилизация';
      h+='<div class="wrow"><div class="t">'+j.t+'</div><div class="meta"><span class="pill">'+j.phase+'</span>'+
        (prep?('<span>готовность '+j.ready+'%</span>'):('<span>⏳ '+(j.daysLeft!=null?j.daysLeft+' дн.':'—')+'</span>'))+'</div>'+
        (prep?bar(j.ready,'linear-gradient(90deg,#1f6fff,#2bd4c9)'):'')+'</div>'; });
    if(s.crew.length){ h+='<h3>Состав вахты · клик по имени → досье</h3>';
      s.crew.forEach(c=>{ const v=VST[c.status]||VST.site;
        h+='<div class="wrow wclick" data-wid="'+c.wid+'" style="cursor:pointer">'+
          '<div class="t">'+(c.master?'🪖 ':'👷 ')+c.name+' <span class="pill" style="background:#1d2636;font-weight:600">'+c.spec+'</span></div>'+
          '<div class="meta"><span style="color:'+v.c+'">'+v.e+' '+v.l+'</span>'+
          '<span>'+(c.shift==='day'?'☀ дневная':'🌙 ночная')+'</span>'+
          '<span class="pill">'+c.employ+'</span></div></div>'; });
    }
    const B=document.getElementById('d-body'); B.innerHTML=h; drawer.classList.add('open');
    document.getElementById('summary').style.display='none';
    // делегируем клики по строкам состава → личное досье
    B.querySelectorAll('.wclick').forEach(el=> el.onclick=()=>{
      const w=s.crew.find(c=>c.wid==el.dataset.wid); if(w) openWorkerDrawer(w,s); });
  }

  function openWorkerDrawer(w, site){
    const v=VST[w.status]||VST.site;
    document.getElementById('d-ava').textContent = w.master?'🪖':'👷';
    document.getElementById('d-name').textContent = w.name;
    document.getElementById('d-role').textContent = w.spec+(site?(' · '+site.name):'');
    document.getElementById('d-pres').textContent = '● '+v.e+' '+v.l;
    let h='<div class="kpis">'+
      '<div class="kpi"><div class="v" style="font-size:15px;color:'+v.c+'">'+v.e+'</div><div class="k">'+v.l+'</div></div>'+
      '<div class="kpi"><div class="v">'+(w.shift==='day'?'☀':'🌙')+'</div><div class="k">'+(w.shift==='day'?'дневная смена':'ночная смена')+'</div></div>'+
      '<div class="kpi"><div class="v">'+w.daysOn+'</div><div class="k">дней на вахте</div></div>'+
      '<div class="kpi"><div class="v">'+w.daysLeft+'</div><div class="k">дней до пересменки</div></div>'+
      '</div>';
    h+='<h3>Статус смены</h3><div class="wrow"><div class="meta">'+
      '<span style="color:'+v.c+'"><b>'+v.e+' '+v.l+'</b></span>'+
      (w.checkin?('<span>✅ отметился: '+w.checkin+'</span>'):'<span class="warn">⛔ не отметился на смене</span>')+'</div>'+
      (site?('<div class="meta" style="margin-top:6px"><span>размещение: '+(site.lodging==='судно'?'🚢 ':'🏨 ')+site.lodgeName+'</span></div>'):'')+'</div>';
    h+='<h3>Специальность и оформление</h3><div class="wrow"><div class="meta">'+
      '<span>'+w.spec+'</span><span class="pill" style="background:'+(w.employ==='Самозанятый'?'#3a2d1a':'#1d2636')+'">'+w.employ+'</span>'+
      '<span>ставка <b>'+w.rate.toLocaleString('ru')+' ₽/смена</b></span></div></div>';
    // рейс / перелёт (если есть данные о билете)
    if(w.flight){ const f=w.flight, toObj=f.dir==='to';
      h+='<h3>🛫 Командировка · билет (field_logistics)</h3><div class="wrow"><div class="meta">'+
        '<span>'+(VKIND[f.kind]?VKIND[f.kind].e:'✈')+' '+(VKIND[f.kind]?VKIND[f.kind].l:'рейс')+'</span>'+
        '<span class="pill">'+(toObj?'→ на объект':'← домой')+'</span></div>'+
        '<div class="meta" style="margin-top:6px">'+
        '<span>вылет: <b>'+simFmt(f.departAt)+'</b></span>'+
        '<span>прилёт: <b>'+simFmt(f.arriveAt)+'</b></span></div></div>'; }
    h+='<h3>Допуски / аттестации</h3><div class="wrow"><div class="meta">'+
      w.permits.map(p=>'<span class="pill" style="background:#16263a">✔ '+p+'</span>').join(' ')+'</div></div>';
    h+='<h3>🩺 Медосмотр и документы</h3><div class="wrow"><div class="meta">'+
      (w.medAt?('<span class="good">🩺 медосмотр: <b>'+simDateShort(w.medAt)+'</b> · '+(w.medPlace||'Москва')+'</span>'):
        '<span class="'+(w.medOk?'good':'bad')+'">'+(w.medOk?'✅ медосмотр пройден ('+w.medDate+')':'⛔ медосмотр не пройден')+'</span>')+
      '<span class="'+(w.docOk?'good':'warn')+'">'+(w.docOk?'✅ документы в порядке':'⚠ документы на проверке')+'</span></div>'+
      '<div class="meta" style="margin-top:6px"><span style="opacity:.6;font-size:11px">медосмотр проходят в медцентре (Москва/Саратов) ПЕРЕД вылетом</span></div></div>';
    document.getElementById('d-body').innerHTML=h; drawer.classList.add('open');
    document.getElementById('summary').style.display='none';
  }

  // ======================= ДОСЬЕ РЕЙСА / БОРТА =======================
  const VKIND = { plane:{e:'✈',l:'Самолёт (рейс)'}, heli:{e:'🚁',l:'Вертолёт'},
    train:{e:'🚂',l:'Поезд (вахта)'}, bus:{e:'🚌',l:'Вахтовка (зимник)'}, ship:{e:'🚢',l:'Судно снабжения'} };
  function openFlightDrawer(v){
    const k=VKIND[v.kind]||VKIND.plane; const toObj=v.dir==='to';
    const now=simNow(); const etaH=Math.max(0,Math.round((v.arriveAt-now)/HOUR));
    document.getElementById('d-ava').textContent = k.e;
    document.getElementById('d-name').textContent = k.l;
    document.getElementById('d-role').textContent = (toObj?'→ на объект · ':'← домой · ')+v.r.site.name;
    document.getElementById('d-pres').textContent = (toObj?'● в пути на объект':'● возвращается домой')+' · ETA ~'+etaH+' ч';
    let h='<div class="kpis">'+
      '<div class="kpi"><div class="v" style="font-size:18px">'+k.e+'</div><div class="k">'+k.l+'</div></div>'+
      '<div class="kpi"><div class="v">'+v.pax.length+'</div><div class="k">пассажиров</div></div>'+
      '<div class="kpi"><div class="v" style="font-size:14px">'+simFmt(v.departAt)+'</div><div class="k">вылет</div></div>'+
      '<div class="kpi"><div class="v" style="font-size:14px">'+simFmt(v.arriveAt)+'</div><div class="k">прилёт (ETA '+etaH+' ч)</div></div>'+
      '</div>';
    h+='<h3>Маршрут</h3><div class="wrow"><div class="meta">'+
      '<span>'+v.r.label+'</span></div><div class="meta" style="margin-top:6px"><span>объект: <b>'+v.r.site.name+'</b></span>'+
      '<span>размещение: '+(v.r.site.lodging==='судно'?'🚢 ':'🏨 ')+v.r.site.lodgeName+'</span></div>'+
      '<div class="meta" style="margin-top:6px"><span style="opacity:.6;font-size:11px">данные рейса: field_logistics.date_from/date_to · item_type='+
      (v.kind==='plane'?'flight':v.kind==='train'?'train':'transfer')+'</span></div></div>';
    if(v.pax.length){ h+='<h3>На борту · клик по имени → досье</h3>';
      v.pax.forEach(p=>{ h+='<div class="wrow wclick" data-wid="'+p.wid+'" style="cursor:pointer">'+
        '<div class="t">'+(p.master?'🪖 ':'👷 ')+p.name+' <span class="pill" style="background:#1d2636;font-weight:600">'+p.spec+'</span></div>'+
        '<div class="meta"><span>'+(p.shift==='day'?'☀ дневная':'🌙 ночная')+'</span><span class="pill">'+p.employ+'</span></div></div>'; });
    } else {
      h+='<h3>На борту</h3><div class="wrow"><div class="meta"><span>группа вахты следует '+(toObj?'на объект':'домой')+'</span></div></div>';
    }
    const B=document.getElementById('d-body'); B.innerHTML=h; drawer.classList.add('open');
    document.getElementById('summary').style.display='none';
    B.querySelectorAll('.wclick').forEach(el=> el.onclick=()=>{
      const p=v.pax.find(x=>x.wid==el.dataset.wid); if(p) openWorkerDrawer(p, v.r.site); });
  }

  // ======================= СВОДКА ГОДА =======================
  const sumEl=document.getElementById('summary');
  function toggleSummary(){ const open=sumEl.style.display!=='none' && sumEl.style.display!=='';
    if(open){ sumEl.style.display='none'; } else { buildSummary(); sumEl.style.display='block'; } }
  document.getElementById('btn-summary').onclick=()=>{ buildSummary(); sumEl.style.display='block'; };
  document.getElementById('sum-close').onclick=()=>{ sumEl.style.display='none'; };

  const Y=YEAR;
  function mln(v){ return (v==null?'—':(v<0?'−':'')+Math.abs(v).toLocaleString('ru',{maximumFractionDigits:1})+' млн ₽'); }
  function chartHtml(){
    const max=Math.max(...Y.revMonth, ...Y.costMonth, 1);
    let c='<div class="chart">';
    Y.months.forEach((m,i)=>{ const future=Y.revMonth[i]===0;
      const rh=Y.revMonth[i]/max*100, ch=Y.costMonth[i]/max*100;
      c+='<div class="col" title="'+m+': выручка '+Y.revMonth[i]+' / себест '+Y.costMonth[i]+'">'+
         (future?'<div style="flex:1"></div>':
           '<div class="b" style="height:'+rh+'%;'+'"></div><div class="b2" style="height:'+ch+'%"></div>')+
         '<div class="mn">'+m+'</div></div>'; });
    c+='</div>';
    return c;
  }
  // hero-плитка: одна крупная цифра + короткая подпись
  function hero(cap, big, sub, cls){ return '<div class="hero-card '+(cls||'')+'">'+
    '<div class="cap">'+cap+'</div><div class="big">'+big+'</div>'+(sub?'<div class="sm">'+sub+'</div>':'')+'</div>'; }

  // ----- вкладки -----
  const SUM_TABS = [
    { k:'fin',    t:'💰 Финансы' },
    { k:'cash',   t:'🏦 Деньги' },
    { k:'selfemp',t:'📄 Самозанятые' },
    { k:'tender', t:'📜 Тендеры' },
    { k:'people', t:'👥 Люди и ОТиПБ' },
    { k:'sites',  t:'🏗 Объекты' },
  ];
  let sumTab = 'fin';

  function tabFin(){
    const factPct=Math.round(Y.costFact/Y.costPlan*100);
    let h='<div class="hero-grid">';
    h+=hero('Выручка года', mln(Y.revenue), 'по '+Y.projects+' проектам');
    h+=hero('Валовая прибыль', mln(Y.gross), 'рентабельность '+Y.grossPct+'%','green');
    h+=hero('EBITDA', mln(Y.ebitda), Y.ebitdaPct+'% от выручки');
    h+=hero('Чистая прибыль', mln(Y.net), 'маржа '+Y.netPct+'%', Y.net>=0?'green':'danger');
    h+='</div>';
    h+='<div class="chartbox" style="margin-top:16px"><div style="font-size:12px;opacity:.7;margin-bottom:10px">Динамика по месяцам · '+
       '<span class="chip" style="background:#1f6fff44">выручка</span><span class="chip" style="background:#e23a3a44">себестоимость</span></div>'+chartHtml()+'</div>';
    const revPerHead=+(Y.revenue/Y.headcount*1000).toFixed(0);   // тыс ₽ на человека
    const advPct=Math.round(Y.advances/Y.revenue*100);
    h+='<div class="chartbox" style="margin-top:14px"><table class="sum-tbl">'+
       '<tr><td>Себестоимость · план</td><td class="r">'+mln(Y.costPlan)+'</td></tr>'+
       '<tr><td>Себестоимость · факт</td><td class="r">'+mln(Y.costFact)+' <span style="opacity:.6">('+factPct+'%)</span></td></tr>'+
       '<tr><td>Экономия к плану</td><td class="r '+(Y.costSave>=0?'good':'bad')+'">'+mln(Y.costSave)+'</td></tr>'+
       '<tr><td>Законтрактованный портфель (бэклог)</td><td class="r">'+mln(Y.backlog)+'</td></tr>'+
       '<tr><td>Выручка на человека</td><td class="r">'+revPerHead.toLocaleString('ru')+' тыс ₽</td></tr>'+
       '<tr><td>Авансирование (авансы / выручка)</td><td class="r">'+advPct+'%</td></tr>'+
       '<tr><td>Средн. срок мобилизации</td><td class="r">'+Y.mobDays+' дн</td></tr>'+
       '</table></div>';
    return h;
  }
  function tabCash(){
    const recvPct=Math.round(Y.received/Y.revenue*100), arOvdPct=Math.round(Y.arOverdue/Y.ar*100);
    const szPct=Math.round(Y.szUsed/Y.szLimit*100);
    let h='<div class="hero-grid">';
    h+=hero('Получено от заказчиков', mln(Y.received), recvPct+'% выручки','green');
    h+=hero('Дебиторка', mln(Y.ar), 'просрочено '+mln(Y.arOverdue)+' ('+arOvdPct+'%)','danger');
    h+=hero('Остаток на счетах', mln(Y.cash), 'свободные средства','green');
    h+=hero('Самозанятые · остаток', mln(Y.szLeft), 'из лимита '+mln(Y.szLimit)+' ('+szPct+'% израсх.)', szPct>90?'danger':'');
    h+='</div>';
    h+='<div class="chartbox" style="margin-top:16px"><table class="sum-tbl">'+
       '<tr><td>Осталось получить</td><td class="r warn">'+mln(Y.toReceive)+'</td></tr>'+
       '<tr><td>Кредиторка (поставщики, субподряд)</td><td class="r">'+mln(Y.ap)+'</td></tr>'+
       '<tr><td>Авансы заказчиков (к отработке)</td><td class="r">'+mln(Y.advances)+'</td></tr>'+
       '<tr><td>Чистый оборотный капитал</td><td class="r">'+mln(+(Y.ar+Y.cash-Y.ap-Y.advances).toFixed(1))+'</td></tr>'+
       '<tr><td>Самозанятые · израсходовано лимита</td><td class="r warn">'+mln(Y.szUsed)+' / '+mln(Y.szLimit)+'</td></tr>'+
       '</table></div>';
    return h;
  }
  function tabTender(){
    let h='<div class="hero-grid">';
    h+=hero('Подано заявок', Y.tnSubmitted, 'выиграно '+Y.tnWon+' · проиграно '+Y.tnLost);
    h+=hero('Конверсия', Y.tnConv+'%', Y.tnConv>=45?'выше рынка':'есть резерв', Y.tnConv>=45?'green':'');
    h+=hero('Сумма выигранных', mln(Y.tnWonSum), 'активных тендеров '+Y.tnActive,'green');
    h+=hero('Воронка (pipeline)', mln(Y.tnPipeline), 'потенциал в работе');
    h+='</div>';
    h+='<div class="chartbox" style="margin-top:16px"><div style="font-size:12px;opacity:.7;margin-bottom:8px">Воронка тендеров</div>'+
       '<table class="sum-tbl">'+
       '<tr><td>Подано</td><td class="r">'+Y.tnSubmitted+'</td><td style="width:55%">'+bar(100,'linear-gradient(90deg,#1f6fff,#3aa0ff)')+'</td></tr>'+
       '<tr><td>В работе</td><td class="r">'+Y.tnActive+'</td><td>'+bar(Math.round(Y.tnActive/Y.tnSubmitted*100),'#3aa0ff')+'</td></tr>'+
       '<tr><td>Выиграно</td><td class="r good">'+Y.tnWon+'</td><td>'+bar(Math.round(Y.tnWon/Y.tnSubmitted*100),'#3fb950')+'</td></tr>'+
       '</table></div>';
    return h;
  }
  function tabPeople(){
    let h='<div class="hero-grid">';
    h+=hero('Численность', Y.headcount, 'штат '+Y.staffPerm+' · самозан. '+Y.staffSelfEmp);
    h+=hero('Полевой / офис', Y.staffField+' / '+Y.staffOffice, 'на смене сейчас '+Y.onShift);
    h+=hero('LTI (травмы)', Y.lti, Y.hseDays+' дней без происшествий', Y.lti===0?'green':'danger');
    h+=hero('Допуски действ.', Y.permitsValid+'%', 'near-miss '+Y.nearMiss, Y.permitsValid>=95?'green':'');
    h+='</div>';
    h+='<div class="chartbox" style="margin-top:16px"><div style="margin-bottom:8px">'+
       '<span class="chip">👷 полевой персонал '+Y.staffField+'</span>'+
       '<span class="chip">🧑‍💼 офис '+Y.staffOffice+'</span>'+
       '<span class="chip">📄 самозанятые '+Y.staffSelfEmp+'</span>'+
       '<span class="chip" style="background:#1a3a1f">🦺 '+Y.hseDays+' дней без LTI</span>'+
       '<span class="chip" style="background:#3a2d1a">⚠ near-miss '+Y.nearMiss+'</span></div></div>';
    return h;
  }
  function tabSites(){
    let h='<div class="sum-grid">';
    SITES.forEach(s=>{ const nW=s.crew.filter(c=>!c.master).length, nM=s.crew.filter(c=>c.master).length;
      const onS=s.crew.filter(c=>c.status==='site').length;
      const avg=Math.round(s.jobs.reduce((a,j)=>a+j.ready,0)/s.jobs.length);
      h+='<div class="sum-card"><div class="cap">'+s.name+'</div><div class="big">'+(nW+nM)+' чел.</div>'+
         '<div class="sm">👷 '+nW+' · 🪖 '+nM+' · 🟢 на смене '+onS+' · работ '+s.jobs.length+'</div>'+
         '<div class="sbar"><i style="width:'+avg+'%;background:linear-gradient(90deg,#1f6fff,#2bd4c9)"></i></div>'+
         '<div class="sm">средняя готовность работ '+avg+'%</div></div>'; });
    h+='</div>';
    h+='<div class="chartbox" style="margin-top:14px"><div style="font-size:12px;opacity:.7;margin-bottom:6px">Топ-проекты по выручке</div><table class="sum-tbl">';
    Y.topProjects.forEach(p=>{ h+='<tr><td>'+p.n+'</td><td class="r">'+mln(p.rev)+'</td>'+
      '<td class="r '+(p.margin>=10?'good':'warn')+'">'+p.margin+'%</td></tr>'; });
    h+='</table></div>';
    h+='<div class="chartbox" style="margin-top:12px;border-color:#5a2330"><div style="font-size:12px;color:#f88;margin-bottom:6px">⚠ Убыточные — внимание</div><table class="sum-tbl">';
    Y.lossProjects.forEach(p=>{ h+='<tr><td>'+p.n+'<div style="font-size:11px;opacity:.6">'+p.why+'</div></td>'+
      '<td class="r">'+mln(p.rev)+'</td><td class="r bad">'+p.margin+'%</td></tr>'; });
    h+='</table></div>';
    return h;
  }
  function tabSelfEmp(){
    const util=Y.szUtilPct;
    let h='<div class="hero-grid">';
    h+=hero('Самозанятых (НПД)', Y.szPeople, 'активных исполнителей');
    h+=hero('Годовой лимит', mln(Y.szLimit), Y.szPeople+' чел × 2.4 млн ₽');
    h+=hero('Израсходовано', mln(Y.szUsed), util+'% лимита · ср. '+Y.szAvg+' млн/чел', util>=85?'danger':'');
    h+=hero('Остаток лимита', mln(Y.szLeft), util>=85?'⚠ контроль превышения':'в норме', util>=85?'danger':'green');
    h+='</div>';
    h+='<div class="chartbox" style="margin-top:16px"><div style="font-size:12px;opacity:.7;margin-bottom:8px">Использование годового лимита НПД</div>'+
       '<div class="sbar" style="height:14px">'+
       '<i style="width:'+util+'%;background:'+(util>=85?'#f85149':'#d29922')+'"></i>'+
       '<i style="width:'+(100-util)+'%;background:#1a2a1a"></i></div>'+
       '<div class="meta" style="margin-top:8px"><span>израсходовано <b class="warn">'+mln(Y.szUsed)+'</b></span>'+
       '<span>остаток <b class="good">'+mln(Y.szLeft)+'</b></span>'+
       '<span>близко к лимиту: <b>'+Y.szNearLimit+'</b> чел</span>'+
       '<span class="bad">риск превышения: <b>'+Y.szOverRisk+'</b> чел</span></div></div>';
    h+='<div class="chartbox" style="margin-top:14px"><div style="font-size:12px;opacity:.7;margin-bottom:6px">Топ по расходу лимита (se_transfers)</div><table class="sum-tbl">';
    Y.szTop.forEach(p=>{ const pc=Math.round(p.used/Y.szPerLimit*100);
      h+='<tr><td>'+p.n+' <span style="opacity:.5;font-size:11px">ИНН '+p.inn+'</span></td>'+
         '<td class="r">'+mln(p.used)+' / 2.4</td>'+
         '<td style="width:38%"><div class="bar"><i style="width:'+pc+'%;background:'+(pc>=85?'#f85149':'#d29922')+'"></i></div></td></tr>'; });
    h+='</table><div style="font-size:11px;opacity:.55;margin-top:8px">Источник: employees.is_self_employed + se_transfers · лимит settings.self_employed_yearly_limit</div></div>';
    return h;
  }
  const TAB_FN = { fin:tabFin, cash:tabCash, selfemp:tabSelfEmp, tender:tabTender, people:tabPeople, sites:tabSites };

  function buildSummary(){
    let h='<div class="sum-tabs">';
    SUM_TABS.forEach(tb=>{ h+='<button class="sum-tab'+(tb.k===sumTab?' on':'')+'" data-tab="'+tb.k+'">'+tb.t+'</button>'; });
    h+='</div><div id="sum-tabbody">'+(TAB_FN[sumTab]||tabFin)()+'</div>';
    const B=document.getElementById('sum-body'); B.innerHTML=h;
    B.querySelectorAll('.sum-tab').forEach(el=> el.onclick=()=>{
      sumTab=el.dataset.tab;
      B.querySelectorAll('.sum-tab').forEach(x=>x.classList.toggle('on', x.dataset.tab===sumTab));
      document.getElementById('sum-tabbody').innerHTML=(TAB_FN[sumTab]||tabFin)();
    });
  }

  // ======================= СТАРТ · кинематографичный облёт =======================
  { const _l=document.getElementById('loading')||document.getElementById('ofl-loading'); if(_l) _l.remove(); }
  // стартуем КРУПНО на штабе (а не на пустой карте целиком)
  cam.scale=0.62; cam.x=HALL.x+HALL.w/2; cam.y=HALL.y+HALL.h/2; applyCam();
  let _introTimers=[];
  function stopIntro(){ _introTimers.forEach(clearTimeout); _introTimers=[]; camAnim=null; }
  function introSequence(){
    const _s0=SITES[0], _s1=SITES[1], _s2=SITES[2];
    const steps=[
      [0,    ()=>flyTo(HALL.x+HALL.w/2, HALL.y+HALL.h/2, 0.62)],
      [2600, ()=>{ if(_s0) flyTo(_s0.cx, _s0.cy, 0.5); }],
      [5200, ()=>{ if(_s1) flyTo(_s1.cx, _s1.cy, 0.5); }],
      [7800, ()=>{ if(_s2) flyTo(_s2.cx, _s2.cy, 0.45); }],
      [10600,()=>fitAll()],
    ];
    steps.forEach(([ms,fn])=> _introTimers.push(setTimeout(fn,ms)));
  }
  introSequence();
  // любой клик/тащ/колесо/клавиша — прерывает облёт (директор берёт управление)
  ['pointerdown','wheel','keydown'].forEach(ev=> _W(ev, stopIntro, {once:false, passive:true}));

  // ---- LOD подписей: на дальнем зуме прячем мелкие подписи маршрутов, оставляем регионы ----
  app.ticker.add(()=>{
    const sc=cam.scale;
    routeLabels.forEach(w=> w.visible = sc>0.32);
    // подписи регионов ярче на общем плане, бледнее на ближнем
    world.children.forEach(ch=>{ if(ch._regionLabel) ch.alpha = sc<0.4? 0.13 : 0.05; });
  });

  // отладочный хук (для авто-смоука; на UX не влияет)
  window.__officeLiveDbg = { SITES, STAFF, WORKS, vehicles, ROUTES, BIOMES, vehiclesPax:()=>vehicles.map(v=>v.pax.length),
    openSiteDrawer, openWorkerDrawer, openDrawer, openFlightDrawer, buildSummary, flyTo, fitAll, introSequence, stopIntro };

    // вернуть функцию очистки: снять window-листенеры + остановить интро + уничтожить PIXI-приложение
    return function destroy(){
      try { _winListeners.forEach(([ev,fn,opts])=>window.removeEventListener(ev,fn,opts)); } catch(e){}
      try { stopIntro(); } catch(e){}
      try { app.destroy(true, { children:true, texture:true, baseTexture:true }); } catch(e){}
    };
  } // _boot

  return { render };
})();
