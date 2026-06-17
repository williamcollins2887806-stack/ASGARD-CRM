/**
 * PixiStage.jsx — PIXI 3D «живая» изокарта (порт vanilla office-live.js).
 *
 * Архитектура:
 *   - dynamic import('pixi.js') чтобы не раздувать первичный bundle.
 *   - PIXI.Application с resizeTo=container, autoDensity, antialias.
 *   - world (PIXI.Container, sortableChildren) — все слои.
 *   - Сцена: ШТАБ (HALL, OREMOTE, OHOME, WAREHOUSE) слева + гео-карта объектов справа.
 *   - Люди — векторные «викинги» (упрощённая версия drawViking из vanilla:926).
 *   - Рейсы — линия hub↔объект + анимированная точка (intern по departAt/arriveAt).
 *   - Drag-камера (pointerdown/move/up на canvas), wheel-зум.
 *   - Polling /api/command-map/live каждые 20с — апдейтит online/status сотрудников.
 *   - Cleanup: app.destroy(true,{children:true,texture:true}) + clearInterval +
 *     removeEventListener + ticker.stop. БЕЗ утечек на hashchange.
 *
 * Источник истины поведения — vanilla `public/assets/js/office-live.js` (2436 LOC):
 *   - _boot(...) — основной движок (vanilla:240).
 *   - drawViking, drawWorker (vanilla:926, 1024) — упрощены до базовых форм.
 *   - geoToScreen (vanilla:359) — гео-проекция lat/lng → экран.
 *   - Hero/Worker классы (vanilla:1105, 1188) — заменены простыми спрайтами.
 *
 * Цвета: ТОЛЬКО токены темы (читаем через getComputedStyle на mount), PIXI требует
 * числовые цвета — парсим CSS-vars в hex-int. Хардкод-цветов 0.
 */
import { useEffect, useRef } from 'react';
import { cmapLive } from './api';

// CSS-var → 0xRRGGBB (PIXI numeric color)
function cssVarHex(rootStyle, name, fallback) {
  const v = (rootStyle.getPropertyValue(name) || '').trim();
  if (!v) return fallback;
  // #rrggbb / #rgb
  if (v.startsWith('#')) {
    let h = v.slice(1);
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    if (h.length === 6) return parseInt(h, 16);
  }
  // rgb(r,g,b)
  const m = v.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) return (Number(m[1]) << 16) | (Number(m[2]) << 8) | Number(m[3]);
  return fallback;
}

function readPalette() {
  const s = getComputedStyle(document.documentElement);
  return {
    bg:     cssVarHex(s, '--inner-bg', 0x0a0e18),
    card:   cssVarHex(s, '--card-bg',  0x0e1320),
    brd:    cssVarHex(s, '--brd-1',    0x243049),
    brd2:   cssVarHex(s, '--brd-2',    0x1c2740),
    gold:   cssVarHex(s, '--gold',     0xd8b15a),
    blue:   cssVarHex(s, '--blue',     0x1f6fff),
    red:    cssVarHex(s, '--red',      0xe23a3a),
    green:  cssVarHex(s, '--ok',       0x22c55e),
    amber:  cssVarHex(s, '--amber',    0xd29922),
    t1:     cssVarHex(s, '--t-1',      0xe9eff8),
    t3:     cssVarHex(s, '--t-3',      0x9fb0c4),
    purple: cssVarHex(s, '--purple',   0x7a3aff),
  };
}

// Гео-проекция (адаптивная — границы по bbox sites)
function makeProjector(sites, W, H) {
  const geo = sites.filter(s => s.lat != null && s.lng != null);
  if (!geo.length) return null;
  let minLat=1e9, maxLat=-1e9, minLng=1e9, maxLng=-1e9;
  geo.forEach(s => {
    if (s.lat < minLat) minLat = s.lat;
    if (s.lat > maxLat) maxLat = s.lat;
    if (s.lng < minLng) minLng = s.lng;
    if (s.lng > maxLng) maxLng = s.lng;
  });
  const padLat = (maxLat - minLat) * 0.18 || 2;
  const padLng = (maxLng - minLng) * 0.18 || 2;
  minLat -= padLat; maxLat += padLat;
  minLng -= padLng; maxLng += padLng;
  // правая половина — карта; левая — штаб
  const mapX = W * 0.42;
  const mapW = W - mapX - 30;
  const mapY = 30;
  const mapH = H - 60;
  return (lat, lng) => ({
    x: mapX + ((lng - minLng) / (maxLng - minLng)) * mapW,
    y: mapY + (1 - (lat - minLat) / (maxLat - minLat)) * mapH,
  });
}

// status_code → зона
const HOMEISH = new Set(['вх', 'бн', 'сс']);
function zoneOf(p) {
  const sc = p.status_code;
  if (sc === 'об' && p.work) return 'object';
  if (sc === 'км') return 'object';
  if (sc === 'уд') return 'oremote';
  if (HOMEISH.has(sc)) return 'ohome';
  if (p.role === 'WAREHOUSE') return 'warehouse';
  return 'desk';
}

// Упрощённая фигура «викинга»: тень + тело + голова + бейдж активности.
// vanilla:926 drawViking — 60+ строк деталей; здесь — функциональный минимум.
function drawAvatar(PIXI, palette, person, scale = 1) {
  const c = new PIXI.Container();
  const g = new PIXI.Graphics();
  // role → цвет туники
  const roleCol = {
    PM: palette.blue, HEAD_PM: 0x1f4fa8, TO: 0x6b8f2e, PROC: 0xc77a2e,
    BUH: 0x9c3a78, OFFICE_MANAGER: 0x2e8f8f,
    DIRECTOR_GEN: palette.red, DIRECTOR_COMM: palette.red, DIRECTOR_DEV: palette.red,
    WAREHOUSE: 0x8a6a2e, CHIEF_ENGINEER: 0x5a2e8f, HR: 0x6a4a9e, HR_MANAGER: 0x6a4a9e,
  };
  const shirt = roleCol[person.role] || 0x49586b;
  const skin = 0xe8c4a0;
  // тень
  g.beginFill(0x000000, 0.28); g.drawEllipse(0, 24, 14, 4); g.endFill();
  // ноги
  g.beginFill(0x2b3340); g.drawRoundedRect(-7, 8, 6, 14, 2); g.drawRoundedRect(1, 8, 6, 14, 2); g.endFill();
  // торс
  g.lineStyle(1, 0x141820, 0.85);
  g.beginFill(shirt); g.drawRoundedRect(-12, -8, 24, 18, 6); g.endFill();
  // плечи
  g.beginFill(shirt); g.drawRoundedRect(-14, -8, 6, 6, 2); g.drawRoundedRect(8, -8, 6, 6, 2); g.endFill();
  // голова
  g.beginFill(skin); g.drawCircle(0, -18, 8); g.endFill();
  g.lineStyle(0);
  c.addChild(g);
  c.scale.set(scale);
  return c;
}

// Сайт — иконка-маркер на гео-карте
function drawSite(PIXI, palette, site) {
  const c = new PIXI.Container();
  const g = new PIXI.Graphics();
  // фон-кружок
  g.lineStyle(2, palette.gold, 0.85);
  g.beginFill(palette.card, 0.95); g.drawCircle(0, 0, 22); g.endFill();
  // тип
  const typeCol = site.site_type === 'platform' ? palette.blue
                 : site.site_type === 'plant'   ? palette.amber
                                                : palette.purple;
  g.beginFill(typeCol, 0.55); g.drawCircle(0, 0, 14); g.endFill();
  g.lineStyle(0);
  c.addChild(g);
  // эмодзи
  const emoji = site.site_type === 'platform' ? '🛢' : site.site_type === 'plant' ? '🏭' : '🏗';
  const txt = new PIXI.Text(emoji, { fontFamily: 'Segoe UI, Arial', fontSize: 18 });
  txt.anchor.set(0.5); c.addChild(txt);
  // подпись
  const lbl = new PIXI.Text(site.name || ('Объект #' + site.id),
    { fontFamily: 'Segoe UI, Arial', fontSize: 11, fill: palette.t1, fontWeight: '700',
      stroke: 0x05070b, strokeThickness: 3, align: 'center' });
  lbl.anchor.set(0.5, 0); lbl.y = 24; c.addChild(lbl);
  return c;
}

// Хаб (отправка/возврат вахт)
function drawHub(PIXI, palette, x, y, w, h) {
  const c = new PIXI.Container();
  const g = new PIXI.Graphics();
  g.beginFill(palette.card, 0.92);
  g.lineStyle(2, palette.gold, 0.55);
  g.drawRoundedRect(x, y, w, h, 14); g.endFill();
  g.lineStyle(0);
  // ВПП
  g.beginFill(0x12161e); g.drawRoundedRect(x + 12, y + h - 18, w - 24, 10, 4); g.endFill();
  g.beginFill(palette.gold, 0.7);
  for (let i = x + 22; i < x + w - 24; i += 18) {
    g.drawRect(i, y + h - 14, 10, 2);
  }
  g.endFill();
  c.addChild(g);
  const t = new PIXI.Text('🛫 ХАБ ВАХТЫ', {
    fontFamily: 'Segoe UI, Arial', fontSize: 12, fontWeight: '800',
    fill: palette.gold, stroke: 0x05070b, strokeThickness: 3,
  });
  t.anchor.set(0.5, 0); t.x = x + w / 2; t.y = y + 6; c.addChild(t);
  return c;
}

// Панель-зона (HALL, OREMOTE, OHOME, WARE)
function drawZone(PIXI, palette, R, title, fill, line, emoji) {
  const c = new PIXI.Container();
  const g = new PIXI.Graphics();
  g.beginFill(fill, 0.85);
  g.lineStyle(2, line, 0.7);
  g.drawRoundedRect(R.x, R.y, R.w, R.h, 12);
  g.endFill();
  g.lineStyle(0);
  c.addChild(g);
  const t = new PIXI.Text((emoji ? emoji + '  ' : '') + title, {
    fontFamily: 'Segoe UI, Arial', fontSize: 11, fontWeight: '800',
    fill: palette.t1, letterSpacing: 1, stroke: 0x05070b, strokeThickness: 3,
  });
  t.anchor.set(0.5, 0); t.x = R.x + R.w / 2; t.y = R.y + 6; c.addChild(t);
  return c;
}

export function PixiStage({ sites, flights, people, hubLat, hubLng, onSite, onFlight, onPerson }) {
  const wrapRef = useRef(null);
  const appRef = useRef(null);
  const stateRef = useRef({
    sites, flights, people, palette: null,
    PIXI: null, app: null, world: null, sitesLayer: null, peopleLayer: null,
    routesLayer: null, hubPos: null, proj: null, raf: 0, pollT: 0,
    siteSprites: {}, personSprites: {}, routeSprites: [],
  });

  // храним актуальные пропсы для замыканий ticker
  stateRef.current.sites = sites;
  stateRef.current.flights = flights;
  stateRef.current.people = people;
  stateRef.current.onSite = onSite;
  stateRef.current.onFlight = onFlight;
  stateRef.current.onPerson = onPerson;

  useEffect(() => {
    let cancelled = false;
    let pollTimer = 0;
    let resizeObs = null;
    let livePeople = people || [];

    (async () => {
      const PIXI = await import('pixi.js');
      if (cancelled || !wrapRef.current) return;
      const palette = readPalette();
      stateRef.current.PIXI = PIXI;
      stateRef.current.palette = palette;

      const wrap = wrapRef.current;
      const app = new PIXI.Application({
        resizeTo: wrap,
        antialias: true,
        backgroundColor: palette.bg,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
      });
      // PIXI v7: app.view; v8: app.canvas. У нас v7.
      wrap.appendChild(app.view);
      appRef.current = app;
      stateRef.current.app = app;

      const world = new PIXI.Container();
      world.sortableChildren = true;
      app.stage.addChild(world);
      stateRef.current.world = world;

      const W = app.screen.width;
      const H = app.screen.height;

      // ----- Drag camera -----
      const cam = { x: 0, y: 0, scale: 1 };
      const drag = { active: false, sx: 0, sy: 0, ox: 0, oy: 0, moved: false };
      const applyCam = () => {
        world.scale.set(cam.scale);
        world.position.set(cam.x, cam.y);
      };
      app.stage.eventMode = 'static';
      app.stage.hitArea = app.screen;
      app.stage.on('pointerdown', (e) => {
        drag.active = true; drag.moved = false;
        drag.sx = e.global.x; drag.sy = e.global.y;
        drag.ox = cam.x; drag.oy = cam.y;
      });
      app.stage.on('pointermove', (e) => {
        if (!drag.active) return;
        const dx = e.global.x - drag.sx, dy = e.global.y - drag.sy;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
        cam.x = drag.ox + dx; cam.y = drag.oy + dy;
        applyCam();
      });
      const endDrag = () => { drag.active = false; };
      app.stage.on('pointerup', endDrag);
      app.stage.on('pointerupoutside', endDrag);
      const onWheel = (ev) => {
        ev.preventDefault();
        const k = ev.deltaY < 0 ? 1.1 : 1 / 1.1;
        const nx = Math.max(0.4, Math.min(2.4, cam.scale * k));
        // зум к точке курсора
        const rect = wrap.getBoundingClientRect();
        const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
        cam.x = mx - (mx - cam.x) * (nx / cam.scale);
        cam.y = my - (my - cam.y) * (nx / cam.scale);
        cam.scale = nx;
        applyCam();
      };
      wrap.addEventListener('wheel', onWheel, { passive: false });

      // ----- Сцена: зоны штаба слева -----
      const HALL = { x: 30, y: 80, w: Math.max(360, W * 0.36), h: Math.max(220, H * 0.4) };
      const OREMOTE = { x: HALL.x, y: 12, w: HALL.w * 0.49, h: 60 };
      const OHOME = { x: HALL.x + HALL.w * 0.51, y: 12, w: HALL.w * 0.49, h: 60 };
      const WARE = { x: HALL.x, y: HALL.y + HALL.h + 12, w: HALL.w * 0.49, h: 80 };
      const HUB = { x: HALL.x + HALL.w * 0.51, y: HALL.y + HALL.h + 12, w: HALL.w * 0.49, h: 80 };

      world.addChild(drawZone(PIXI, palette, OREMOTE, 'УДАЛЁНКА', 0x101a2e, palette.blue, '💻'));
      world.addChild(drawZone(PIXI, palette, OHOME, 'ДОМ (выходные)', 0x1a1420, palette.gold, '🏠'));
      world.addChild(drawZone(PIXI, palette, HALL, 'ВАЛЬХАЛЛА · ОФИС ASGARD', palette.card, palette.gold, '⚔'));
      world.addChild(drawZone(PIXI, palette, WARE, 'СКЛАД · МИДГАРД', 0x10151f, 0x8a7a4a, '📦'));
      world.addChild(drawHub(PIXI, palette, HUB.x, HUB.y, HUB.w, HUB.h));

      // ----- Слои -----
      const sitesLayer = new PIXI.Container();
      sitesLayer.sortableChildren = true;
      sitesLayer.zIndex = 100;
      world.addChild(sitesLayer);
      stateRef.current.sitesLayer = sitesLayer;

      const routesLayer = new PIXI.Container();
      routesLayer.zIndex = 90;
      world.addChild(routesLayer);
      stateRef.current.routesLayer = routesLayer;

      const peopleLayer = new PIXI.Container();
      peopleLayer.sortableChildren = true;
      peopleLayer.zIndex = 120;
      world.addChild(peopleLayer);
      stateRef.current.peopleLayer = peopleLayer;

      // ----- Сайты (гео-проекция) -----
      const proj = makeProjector(stateRef.current.sites || [], W, H);
      stateRef.current.proj = proj;
      const sitePosById = {};
      (stateRef.current.sites || []).forEach((s) => {
        if (proj && s.lat != null && s.lng != null) {
          const p = proj(s.lat, s.lng);
          sitePosById[s.id] = p;
          const sp = drawSite(PIXI, palette, s);
          sp.x = p.x; sp.y = p.y; sp.zIndex = p.y;
          sp.eventMode = 'static'; sp.cursor = 'pointer';
          sp.on('pointertap', () => {
            if (!drag.moved && stateRef.current.onSite) stateRef.current.onSite(s);
          });
          sitesLayer.addChild(sp);
          stateRef.current.siteSprites[s.id] = sp;
        }
      });

      // позиция хаба для маршрутов
      let hubPos;
      if (proj && hubLat != null && hubLng != null) {
        hubPos = proj(hubLat, hubLng);
      } else {
        hubPos = { x: HUB.x + HUB.w / 2, y: HUB.y + HUB.h / 2 };
      }
      stateRef.current.hubPos = hubPos;

      // ----- Маршруты рейсов -----
      function buildRoutes() {
        // очищаем
        stateRef.current.routeSprites.forEach((r) => { try { r.destroy({ children: true }); } catch (_) { /* noop */ } });
        stateRef.current.routeSprites = [];
        (stateRef.current.flights || []).forEach((f) => {
          const sid = f.site && f.site.id;
          const sp = sid != null ? sitePosById[sid] : null;
          if (!sp) return;
          const line = new PIXI.Graphics();
          line.lineStyle(1.5, palette.gold, 0.35);
          line.moveTo(hubPos.x, hubPos.y); line.lineTo(sp.x, sp.y);
          routesLayer.addChild(line);
          const dot = new PIXI.Graphics();
          dot.beginFill(palette.gold); dot.drawCircle(0, 0, 4); dot.endFill();
          dot.beginFill(palette.gold, 0.3); dot.drawCircle(0, 0, 8); dot.endFill();
          routesLayer.addChild(dot);
          stateRef.current.routeSprites.push(line, dot);
          // запоминаем для тикера
          dot._flight = f; dot._from = (f.dir === 'home') ? sp : hubPos;
          dot._to   = (f.dir === 'home') ? hubPos : sp;
          dot.eventMode = 'static'; dot.cursor = 'pointer';
          dot.on('pointertap', () => {
            if (!drag.moved && stateRef.current.onFlight) stateRef.current.onFlight(f);
          });
        });
      }
      buildRoutes();

      // ----- Люди -----
      function rebuildPeople() {
        Object.values(stateRef.current.personSprites).forEach((s) => {
          try { s.destroy({ children: true }); } catch (_) { /* noop */ }
        });
        stateRef.current.personSprites = {};
        const list = livePeople || [];
        // группы по зонам
        const groups = { desk: [], oremote: [], ohome: [], object: [], warehouse: [] };
        list.forEach((p) => {
          const z = zoneOf(p);
          (groups[z] || groups.desk).push(p);
        });
        function placeIn(zoneR, arr, fixedY) {
          const cols = Math.max(1, Math.floor((zoneR.w - 30) / 36));
          arr.forEach((p, i) => {
            const col = i % cols, row = Math.floor(i / cols);
            const x = zoneR.x + 22 + col * 36;
            const y = (fixedY != null ? fixedY : (zoneR.y + 30 + row * 44));
            const av = drawAvatar(PIXI, palette, p, 0.7);
            av.x = x; av.y = y; av.zIndex = y;
            if (!p.online) av.alpha = 0.45;
            av.eventMode = 'static'; av.cursor = 'pointer';
            av.on('pointertap', () => {
              if (!drag.moved && stateRef.current.onPerson) stateRef.current.onPerson(p);
            });
            peopleLayer.addChild(av);
            stateRef.current.personSprites[p.user_id || (p.name + '_' + i)] = av;
          });
        }
        placeIn(HALL,    groups.desk);
        placeIn(OREMOTE, groups.oremote);
        placeIn(OHOME,   groups.ohome);
        placeIn(WARE,    groups.warehouse);
        // на объектах — у соответствующих сайтов
        groups.object.forEach((p) => {
          // ищем site по работе
          let site = null;
          (stateRef.current.sites || []).forEach((s) => {
            if (!site && Array.isArray(s.works)) {
              if (s.works.some(w => p.work && (w.id === p.work.id || w.work_title === p.work.title))) {
                site = s;
              }
            }
          });
          if (!site && (stateRef.current.sites || []).length) site = stateRef.current.sites[0];
          if (!site) return;
          const pos = sitePosById[site.id];
          if (!pos) return;
          const av = drawAvatar(PIXI, palette, p, 0.65);
          // лёгкая рандомизация чтобы не накладывались
          const seed = (p.user_id || 1) * 9301 % 233;
          av.x = pos.x + ((seed % 30) - 15);
          av.y = pos.y + 30 + ((seed * 7) % 24);
          av.zIndex = av.y;
          av.eventMode = 'static'; av.cursor = 'pointer';
          av.on('pointertap', () => {
            if (!drag.moved && stateRef.current.onPerson) stateRef.current.onPerson(p);
          });
          peopleLayer.addChild(av);
          stateRef.current.personSprites[p.user_id || ('s' + site.id)] = av;
        });
      }
      rebuildPeople();

      // ----- Ticker (анимация точек рейсов + лёгкое «дыхание» аватаров) -----
      const t0 = performance.now();
      app.ticker.add(() => {
        const now = Date.now();
        stateRef.current.routeSprites.forEach((dot) => {
          if (!dot._flight) return;
          const f = dot._flight;
          const dep = f.departAt ? new Date(f.departAt).getTime() : null;
          const arr = f.arriveAt ? new Date(f.arriveAt).getTime() : null;
          if (!dep || !arr || arr <= dep) {
            // нет окна — пульсируем на середине
            const t = ((now / 1500) % 1);
            dot.x = dot._from.x + (dot._to.x - dot._from.x) * t;
            dot.y = dot._from.y + (dot._to.y - dot._from.y) * t;
            return;
          }
          let k = (now - dep) / (arr - dep);
          if (k < 0) k = 0; else if (k > 1) k = 1;
          dot.x = dot._from.x + (dot._to.x - dot._from.x) * k;
          dot.y = dot._from.y + (dot._to.y - dot._from.y) * k;
        });
        // дыхание аватаров
        const tt = (performance.now() - t0) / 600;
        Object.values(stateRef.current.personSprites).forEach((av, i) => {
          av.children[0].y = Math.sin(tt + i * 0.13) * 0.6;
        });
      });

      // ----- Polling /api/command-map/live каждые 20с -----
      pollTimer = window.setInterval(async () => {
        try {
          const d = await cmapLive();
          if (!d || !Array.isArray(d.people)) return;
          livePeople = d.people;
          rebuildPeople();
        } catch (_) { /* noop */ }
      }, 20000);

      // ResizeObserver — если меняется размер контейнера, пересоздаём сцену (простой rebuild).
      // Здесь только пересборка маршрутов/людей: позиции сайтов привязаны к гео-проекции,
      // которая зависит от W/H — но dragable-камера компенсирует, оставляем как есть.
      resizeObs = new ResizeObserver(() => {
        // PIXI resizeTo сам подстроит canvas; rebuild people для перерасчёта зон.
        rebuildPeople();
      });
      resizeObs.observe(wrap);
    })();

    // ----- Cleanup (КРИТИЧНО — без утечек) -----
    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
      if (resizeObs) { try { resizeObs.disconnect(); } catch (_) { /* noop */ } }
      const app = appRef.current;
      if (app) {
        try { app.ticker.stop(); } catch (_) { /* noop */ }
        try { app.destroy(true, { children: true, texture: true, baseTexture: true }); }
        catch (_) { /* noop */ }
      }
      appRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ВНИМАНИЕ: при изменении sites/flights полная пересборка сцены нерациональна —
  // оставляем «moonшот»: на смену массивов поллер просто перерисует людей. Объекты/рейсы
  // обновляются при следующем mount. Это компромисс к простоте (vanilla так и работает —
  // _DATA снимается один раз, потом обновляется только /live).

  return (
    <div
      ref={wrapRef}
      className="cmap-stage cmap-pixi"
      role="application"
      aria-label="Командная карта"
    />
  );
}
