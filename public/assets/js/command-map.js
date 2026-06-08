/**
 * Живая карта директора — #/command-map
 * Объекты из sites (по lat/lng), активные работы + экипаж, рейсы вахты по реальным датам,
 * сводка года. Источники: /api/command-map, /api/command-map/flights, /api/command-map/medical,
 * /api/director-summary, /api/daily-presence/board. PIXI (v7) грузится из index.html.
 */
window.AsgardCommandMap = (function () {
  'use strict';

  const esc = (window.AsgardUI && AsgardUI.esc)
    ? AsgardUI.esc
    : (s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));

  function token() { return localStorage.getItem('asgard_token') || localStorage.getItem('auth_token') || ''; }
  function headers() { return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token() }; }
  async function api(path) {
    try { const r = await fetch(path, { headers: headers() }); return r.ok ? await r.json() : null; }
    catch (e) { return null; }
  }
  const mln = v => (v == null ? '—' : (v < 0 ? '−' : '') + Math.abs(Number(v)).toLocaleString('ru', { maximumFractionDigits: 1 }) + ' млн ₽');
  const fmtDT = ts => { if (!ts) return '—'; const d = new Date(ts); if (isNaN(d)) return '—';
    const p = n => String(n).padStart(2, '0'); return p(d.getDate()) + '.' + p(d.getMonth() + 1) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); };

  // ── одноразовая инъекция стилей ──
  (function css() {
    if (document.getElementById('cmap-css')) return;
    const st = document.createElement('style'); st.id = 'cmap-css';
    st.textContent = `
      .cmap-wrap{display:flex;flex-direction:column;gap:14px}
      .cmap-stage{position:relative;width:100%;height:62vh;min-height:420px;border-radius:14px;overflow:hidden;
        background:#070b12;border:1px solid var(--brd,#243049)}
      .cmap-stage canvas{display:block}
      .cmap-hint{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;
        color:#9fb0c4;font-size:14px;padding:24px;flex-direction:column;gap:10px}
      .cmap-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
      .cmap-card{background:var(--bg2,#0e1422);border:1px solid var(--brd,#243049);border-radius:13px;padding:14px 15px;cursor:pointer;transition:.15s}
      .cmap-card:hover{border-color:var(--gold,#c8a84e);transform:translateY(-1px)}
      .cmap-card .nm{font-weight:800;font-size:15px}
      .cmap-card .meta{font-size:12px;opacity:.7;margin-top:6px;display:flex;gap:10px;flex-wrap:wrap}
      .cmap-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:4px 0 10px}
      .cmap-tab{background:#0e1626;border:1px solid #243049;color:#aebbcf;border-radius:22px;padding:8px 16px;font-size:13px;font-weight:700;cursor:pointer}
      .cmap-tab.on{background:linear-gradient(135deg,#1f6fff,#7a3aff);border-color:transparent;color:#fff}
      .cmap-hero{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
      .cmap-hcard{background:linear-gradient(135deg,#0f1830,#16101c);border:1px solid #2a3550;border-radius:14px;padding:14px 15px}
      .cmap-hcard .cap{font-size:10.5px;text-transform:uppercase;letter-spacing:1px;opacity:.62}
      .cmap-hcard .big{font-size:26px;font-weight:900;margin-top:5px;background:linear-gradient(90deg,#9cc4ff,#ffd36a);-webkit-background-clip:text;background-clip:text;color:transparent}
      .cmap-hcard .sm{font-size:11.5px;opacity:.72;margin-top:6px}
      .cmap-flights{display:flex;flex-direction:column;gap:8px;max-height:260px;overflow:auto}
      .cmap-frow{background:#0f1522;border:1px solid #1d2636;border-radius:10px;padding:9px 12px;font-size:13px;cursor:pointer}
      .cmap-frow:hover{border-color:#3a4f7a}
      .cmap-sec{font-size:12px;text-transform:uppercase;letter-spacing:1.2px;opacity:.6;margin:14px 0 8px}
    `;
    document.head.appendChild(st);
  })();

  function projector(sites) {
    // проекция lat/lng в экранные координаты по bbox объектов с гео
    const geo = sites.filter(s => s.lat != null && s.lng != null);
    if (!geo.length) return null;
    let minLat = 1e9, maxLat = -1e9, minLng = 1e9, maxLng = -1e9;
    geo.forEach(s => { minLat = Math.min(minLat, s.lat); maxLat = Math.max(maxLat, s.lat);
      minLng = Math.min(minLng, s.lng); maxLng = Math.max(maxLng, s.lng); });
    const padLat = (maxLat - minLat) * 0.15 || 1, padLng = (maxLng - minLng) * 0.15 || 1;
    minLat -= padLat; maxLat += padLat; minLng -= padLng; maxLng += padLng;
    return function (lat, lng, W, H) {
      const x = (lng - minLng) / (maxLng - minLng) * (W - 160) + 100;
      const y = (1 - (lat - minLat) / (maxLat - minLat)) * (H - 160) + 80; // север сверху
      return { x, y };
    };
  }

  function drawMap(stageEl, data, flights, onSite, onFlight) {
    const sites = (data && data.sites) || [];
    const proj = projector(sites);
    if (!window.PIXI || !proj) {
      // фолбэк: карточки объектов (нет PIXI или нет гео)
      stageEl.innerHTML = '';
      const hint = document.createElement('div'); hint.className = 'cmap-hint';
      if (!proj) {
        hint.innerHTML = '<div style="font-size:30px">🗺</div>' +
          '<div>У объектов не заданы координаты (lat/lng).</div>' +
          '<div style="opacity:.7">Заполните их в карточке объекта — и они появятся на карте.</div>';
      } else {
        hint.innerHTML = '<div>Карта недоступна (PIXI не загружен)</div>';
      }
      stageEl.appendChild(hint);
      return null;
    }

    stageEl.innerHTML = '';
    const W = stageEl.clientWidth || 900, H = stageEl.clientHeight || 480;
    const app = new PIXI.Application({ width: W, height: H, antialias: true, backgroundColor: 0x070b12,
      autoDensity: true, resolution: Math.min(window.devicePixelRatio || 1, 2) });
    stageEl.appendChild(app.view);
    const world = new PIXI.Container(); world.sortableChildren = true; app.stage.addChild(world);

    function label(t, size, fill, wt) { return new PIXI.Text(t, { fontFamily: 'Segoe UI, Arial', fontSize: size,
      fill: fill, fontWeight: wt || '700', stroke: 0x05070b, strokeThickness: Math.max(3, size / 4) }); }

    // объекты
    const sitePos = {};
    sites.forEach(s => {
      if (s.lat == null || s.lng == null) return;
      const p = proj(s.lat, s.lng, W, H); sitePos[s.id] = p;
      const c = new PIXI.Container(); c.x = p.x; c.y = p.y; c.zIndex = 10;
      const g = new PIXI.Graphics();
      const onShift = (s.crew && s.crew.onShift) || 0;
      g.beginFill(0x1f6fff, .18); g.drawCircle(0, 0, 34); g.endFill();
      g.lineStyle(2.5, 0xd8b15a, .8); g.beginFill(0x16203a); g.drawCircle(0, 0, 22); g.endFill(); g.lineStyle(0);
      g.beginFill(onShift > 0 ? 0x3fb950 : 0x8b97a6); g.drawCircle(0, -2, 9); g.endFill();
      c.addChild(g);
      const ic = new PIXI.Text(s.site_type === 'platform' ? '🛢' : (s.site_type === 'plant' ? '🏭' : '🏗'),
        { fontSize: 16 }); ic.anchor.set(.5); ic.y = -2; c.addChild(ic);
      const nm = label(s.name || ('Объект #' + s.id), 13, 0xeaf3ff, '800'); nm.anchor.set(.5, 0); nm.y = 28; c.addChild(nm);
      const wk = (s.crew ? (s.crew.workers + s.crew.masters) : 0);
      const meta = label('👷 ' + wk + ' · 🟢 ' + onShift, 11, 0xffe39a, '700'); meta.anchor.set(.5, 0); meta.y = 46; c.addChild(meta);
      c.eventMode = 'static'; c.cursor = 'pointer';
      c.on('pointertap', () => onSite && onSite(s));
      world.addChild(c);
    });

    // рейсы — линия Хаб(лево)→объект; борт-точка по доле времени
    const HUB = { x: 60, y: H / 2 };
    const hubG = new PIXI.Graphics(); hubG.beginFill(0x2a3550); hubG.drawRoundedRect(HUB.x - 26, HUB.y - 18, 52, 36, 8); hubG.endFill();
    hubG.zIndex = 5; world.addChild(hubG);
    const hubL = label('🛫 ХАБ', 11, 0xffe39a, '800'); hubL.anchor.set(.5, 0); hubL.x = HUB.x; hubL.y = HUB.y + 20; hubL.zIndex = 5; world.addChild(hubL);

    const vehicles = [];
    (flights || []).forEach(f => {
      if (!f.site || !sitePos[f.site.id]) return;
      const dest = sitePos[f.site.id];
      const a = f.dir === 'home' ? dest : HUB, b = f.dir === 'home' ? HUB : dest;
      const ln = new PIXI.Graphics(); ln.zIndex = 3;
      ln.lineStyle(2, 0x6aa6ff, .25); ln.moveTo(a.x, a.y); ln.lineTo(b.x, b.y); world.addChild(ln);
      const dep = f.departAt ? new Date(f.departAt).getTime() : null;
      const arr = f.arriveAt ? new Date(f.arriveAt).getTime() : null;
      const dot = new PIXI.Container(); dot.zIndex = 12;
      const dg = new PIXI.Graphics(); dg.beginFill(0xeaf0f7); dg.drawCircle(0, 0, 5); dg.endFill();
      dg.beginFill(0x1f6fff); dg.drawCircle(0, 0, 2.5); dg.endFill();
      const icn = new PIXI.Text(f.item_type === 'train' ? '🚂' : (f.item_type === 'transfer' ? '🚌' : '✈'), { fontSize: 13 });
      icn.anchor.set(.5); icn.y = -10; dot.addChild(icn); dot.addChild(dg);
      dot.eventMode = 'static'; dot.cursor = 'pointer'; dot.on('pointertap', () => onFlight && onFlight(f));
      world.addChild(dot);
      vehicles.push({ dot, a, b, dep, arr });
    });

    // тик — позиция бортов по реальному времени (доля departAt..arriveAt)
    app.ticker.add(() => {
      const now = Date.now();
      vehicles.forEach(v => {
        let t = 0.5;
        if (v.dep && v.arr && v.arr > v.dep) {
          t = (now - v.dep) / (v.arr - v.dep);
          t = Math.max(0, Math.min(1, t));
        }
        v.dot.x = v.a.x + (v.b.x - v.a.x) * t;
        v.dot.y = v.a.y + (v.b.y - v.a.y) * t;
        v.dot.visible = !(v.arr && now > v.arr + 6 * 3600000) && !(v.dep && now < v.dep - 24 * 3600000);
      });
    });

    return app;
  }

  // ── досье объекта (drawer через AsgardUI.showModal) ──
  function siteModal(s) {
    let h = '<div style="font-size:13px;opacity:.7;margin-bottom:10px">' + esc(s.region || '') + (s.customer_name ? (' · ' + esc(s.customer_name)) : '') + '</div>';
    h += '<div class="cmap-hero" style="margin-bottom:12px">' +
      hcard('Рабочих', (s.crew ? s.crew.workers : 0)) +
      hcard('Мастеров', (s.crew ? s.crew.masters : 0)) +
      hcard('На смене', (s.crew ? s.crew.onShift : 0)) + '</div>';
    h += '<div class="cmap-sec">Работы на объекте</div>';
    if (s.works && s.works.length) {
      s.works.forEach(w => {
        h += '<div class="cmap-frow" style="cursor:default"><b>' + esc(w.work_title) + '</b>' +
          '<div class="meta" style="font-size:12px;opacity:.7;margin-top:4px">' +
          '<span>' + esc(w.work_status) + '</span>' + (w.pm_name ? ('<span> · РП ' + esc(w.pm_name) + '</span>') : '') +
          '<span> · 👷 ' + (w.workers + w.masters) + ' · 🟢 ' + w.on_shift + '</span></div></div>';
      });
    } else {
      h += '<div style="opacity:.6;font-size:13px">Нет активных работ. Объект создаётся из работ — привяжите работу к этому объекту (site_id).</div>';
    }
    AsgardUI.showModal({ title: '🏗 ' + (s.name || ('Объект #' + s.id)), html: h, wide: true });
  }
  function flightModal(f) {
    let h = '<div class="cmap-hero" style="margin-bottom:12px">' +
      hcard('Вылет', fmtDT(f.departAt)) + hcard('Прилёт', fmtDT(f.arriveAt)) +
      hcard('Направление', f.dir === 'home' ? '← домой' : '→ объект') + '</div>';
    h += '<div class="cmap-sec">Рейс</div><div class="cmap-frow" style="cursor:default">' +
      (f.transport_no ? ('<b>' + esc(f.transport_no) + '</b> · ') : '') + esc(f.title || '') +
      (f.site ? ('<div style="opacity:.7;margin-top:4px">Объект: ' + esc(f.site.name) + '</div>') : '') +
      (f.employee ? ('<div style="opacity:.7;margin-top:2px">Сотрудник: ' + esc(f.employee.fio) + '</div>') : '') + '</div>';
    AsgardUI.showModal({ title: (f.item_type === 'train' ? '🚂 Поезд' : '✈ Рейс'), html: h });
  }
  function hcard(cap, big, sm) {
    return '<div class="cmap-hcard"><div class="cap">' + esc(cap) + '</div><div class="big">' + esc(big) +
      '</div>' + (sm ? ('<div class="sm">' + esc(sm) + '</div>') : '') + '</div>';
  }

  // ── сводка года (вкладки) ──
  let sumTab = 'fin';
  function summaryHtml(D) {
    if (!D) return '<div style="opacity:.6">Сводка недоступна</div>';
    const tabs = [['fin', '💰 Финансы'], ['cash', '🏦 Деньги'], ['se', '📄 Самозанятые'], ['tn', '📜 Тендеры'], ['ppl', '👥 Люди']];
    let h = '<div class="cmap-tabs">' + tabs.map(t => '<button class="cmap-tab' + (t[0] === sumTab ? ' on' : '') + '" data-t="' + t[0] + '">' + t[1] + '</button>').join('') + '</div>';
    h += '<div id="cmap-sumbody">' + tabBody(D) + '</div>';
    return h;
  }
  function tabBody(D) {
    if (sumTab === 'fin') {
      const p = D.pnl;
      return '<div class="cmap-hero">' + hcard('Выручка', mln(p.revenue), 'проектов ' + p.projects) +
        hcard('Валовая', mln(p.gross), 'рент. ' + p.grossPct + '%') +
        hcard('Себест. план', mln(p.costPlan)) + hcard('Себест. факт', mln(p.costFact)) + '</div>';
    }
    if (sumTab === 'cash') {
      const c = D.cash;
      return '<div class="cmap-hero">' + hcard('Получено', mln(c.received)) +
        hcard('Дебиторка', mln(c.receivable), 'просрочка ' + mln(c.overdue)) +
        hcard('Авансы', mln(c.advances)) + '</div>';
    }
    if (sumTab === 'se') {
      const s = D.selfEmployed;
      let h = '<div class="cmap-hero">' + hcard('Самозанятых', s.count) +
        hcard('Лимит года', mln(s.yearLimit), s.count + ' × ' + mln(s.perLimit)) +
        hcard('Израсходовано', mln(s.used), s.utilPct + '%') + hcard('Остаток', mln(s.left)) + '</div>';
      if (s.top && s.top.length) {
        h += '<div class="cmap-sec">Топ по расходу</div>';
        s.top.forEach(t => { h += '<div class="cmap-frow" style="cursor:default">' + esc(t.fio) + ' — <b>' + mln(t.used) + '</b></div>'; });
      }
      return h;
    }
    if (sumTab === 'tn') {
      const t = D.tenders;
      return '<div class="cmap-hero">' + hcard('Подано', t.submitted, 'выигр ' + t.won + ' · проигр ' + t.lost) +
        hcard('Конверсия', t.conv + '%') + hcard('Активных', t.active) + hcard('Сумма выигр.', mln(t.wonSum)) + '</div>';
    }
    const pp = D.people;
    return '<div class="cmap-hero">' + hcard('Численность', pp.headcount) +
      hcard('Самозанятых', pp.selfEmp) + hcard('На смене', pp.onShift) + '</div>';
  }

  async function render({ layout, title }) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = '#/login'; return; }
    const allowed = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_PM', 'HEAD_TO'];
    if (!allowed.includes(auth.user.role)) { AsgardUI.toast('Доступ', 'Раздел для директоров', 'err'); location.hash = '#/home'; return; }

    const body = `
      <div class="cmap-wrap">
        <div class="panel" style="padding:0;overflow:hidden">
          <div class="cmap-stage" id="cmapStage"><div class="cmap-hint">Загрузка карты…</div></div>
        </div>
        <div class="panel">
          <div class="cmap-sec">🛫 Рейсы вахты (ближайшие)</div>
          <div class="cmap-flights" id="cmapFlights">Загрузка…</div>
        </div>
        <div class="panel">
          <div class="cmap-sec">📊 Сводка года</div>
          <div id="cmapSummary">Загрузка…</div>
        </div>
        <div class="panel">
          <div class="cmap-sec">🏗 Объекты</div>
          <div class="cmap-grid" id="cmapGrid">Загрузка…</div>
        </div>
      </div>`;
    await layout(body, { title, motto: 'Видеть всё поле — побеждать' });

    const [mapData, flightsData, summary] = await Promise.all([
      api('/api/command-map'), api('/api/command-map/flights'), api('/api/director-summary')
    ]);
    const sites = (mapData && mapData.sites) || [];
    const flights = (flightsData && flightsData.flights) || [];

    // карта
    const stage = document.getElementById('cmapStage');
    let app = null;
    function buildMap() { if (app) { try { app.destroy(true, true); } catch (e) {} } app = drawMap(stage, mapData, flights, siteModal, flightModal); }
    buildMap();
    window.addEventListener('resize', () => { clearTimeout(window._cmapRz); window._cmapRz = setTimeout(buildMap, 250); });

    // рейсы-список
    const fl = document.getElementById('cmapFlights');
    if (flights.length) {
      fl.innerHTML = flights.slice(0, 40).map((f, i) =>
        '<div class="cmap-frow" data-fi="' + i + '">' +
        (f.item_type === 'train' ? '🚂' : (f.item_type === 'transfer' ? '🚌' : '✈')) + ' ' +
        (f.transport_no ? ('<b>' + esc(f.transport_no) + '</b> ') : '') +
        (f.dir === 'home' ? '← домой' : '→ ' + esc(f.site ? f.site.name : 'объект')) +
        ' · вылет ' + fmtDT(f.departAt) + ' · прилёт ' + fmtDT(f.arriveAt) +
        (f.employee ? (' · ' + esc(f.employee.fio)) : '') + '</div>').join('');
      fl.querySelectorAll('[data-fi]').forEach(el => el.onclick = () => flightModal(flights[+el.dataset.fi]));
    } else {
      fl.innerHTML = '<div style="opacity:.6;font-size:13px">Нет рейсов. Добавьте билеты сотрудникам в разделе «Логистика» (с датой и временем вылета/прилёта).</div>';
    }

    // сводка
    const sumEl = document.getElementById('cmapSummary');
    function renderSum() {
      sumEl.innerHTML = summaryHtml(summary);
      sumEl.querySelectorAll('.cmap-tab').forEach(b => b.onclick = () => {
        sumTab = b.dataset.t;
        sumEl.querySelectorAll('.cmap-tab').forEach(x => x.classList.toggle('on', x.dataset.t === sumTab));
        document.getElementById('cmap-sumbody').innerHTML = tabBody(summary);
      });
    }
    renderSum();

    // объекты-карточки
    const grid = document.getElementById('cmapGrid');
    if (sites.length) {
      grid.innerHTML = '';
      sites.forEach(s => {
        const card = document.createElement('div'); card.className = 'cmap-card';
        const wk = s.crew ? (s.crew.workers + s.crew.masters) : 0;
        card.innerHTML = '<div class="nm">' + (s.site_type === 'platform' ? '🛢 ' : (s.site_type === 'plant' ? '🏭 ' : '🏗 ')) + esc(s.name || ('Объект #' + s.id)) + '</div>' +
          '<div class="meta"><span>работ: ' + (s.works ? s.works.length : 0) + '</span><span>👷 ' + wk + '</span><span>🟢 на смене ' + (s.crew ? s.crew.onShift : 0) + '</span>' +
          (s.lat == null ? '<span style="color:#d29922">⚠ нет координат</span>' : '') + '</div>';
        card.onclick = () => siteModal(s);
        grid.appendChild(card);
      });
    } else {
      grid.innerHTML = '<div style="opacity:.6">Объектов нет. Создайте их в справочнике объектов и привяжите работы.</div>';
    }
  }

  return { render };
})();
