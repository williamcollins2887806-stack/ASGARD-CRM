/**
 * ASGARD CRM — WMS 3D map (vanilla Three.js)
 * window.AsgardWarehouseMap — mount into warehouse-v2 tab
 * Scale: 1 unit = 1 meter. Visual parity with prototypes/warehouse-map-preview.html
 * + parametric multi-type builders + live editor.
 */
window.AsgardWarehouseMap = (function () {
  'use strict';

  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const TYPE_LABEL = {
    shelf_light: 'Лёгкий стеллаж',
    shelf_pallet: 'Паллетный',
    clothing: 'Одежда / СИЗ',
    floor_zone: 'Зона пола',
    scrap: 'Лом',
    workbench: 'Верстак',
    machine: 'Оборудование',
    assembly_pallet: 'Паллет сбора'
  };
  const TOUR_STEPS = [
    '1 · План 2D',
    '2 · Маршрут',
    '3 · Подлёт · 3D',
    '4 · Фасад · полка',
    '5 · Место'
  ];

  let _state = null;

  function hdr() {
    const t = localStorage.getItem('asgard_token') || localStorage.getItem('auth_token');
    return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
  }
  async function defApi(method, url, body) {
    const r = await fetch(url, {
      method,
      headers: hdr(),
      body: body != null ? JSON.stringify(body) : undefined
    });
    const ct = r.headers.get('content-type') || '';
    const d = ct.includes('json') ? await r.json() : await r.text();
    if (!r.ok) throw new Error((d && d.error) || ('HTTP ' + r.status));
    return d;
  }

  function loadThree() {
    return new Promise((resolve, reject) => {
      if (window.THREE) return resolve(window.THREE);
      const urls = [
        'assets/vendor/three.min.js',
        '/assets/vendor/three.min.js',
        'https://unpkg.com/three@0.160.0/build/three.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.0/three.min.js'
      ];
      let i = 0;
      function tryNext() {
        if (i >= urls.length) return reject(new Error('Three.js load failed'));
        const s = document.createElement('script');
        s.src = urls[i++];
        s.onload = () => {
          if (window.THREE) resolve(window.THREE);
          else tryNext();
        };
        s.onerror = () => tryNext();
        document.head.appendChild(s);
      }
      tryNext();
    });
  }

  function injectCSS() {
    let s = document.getElementById('wh-map-css');
    if (!s) { s = document.createElement('style'); s.id = 'wh-map-css'; document.head.appendChild(s); }
    s.textContent = `
      .whm{--whm-panel:rgba(18,22,30,.92);--whm-line:rgba(255,255,255,.1);--whm-accent:#c9a84c;--whm-ok:#2bab62;
        position:relative;height:min(88vh,960px);min-height:640px;border-radius:18px;overflow:hidden;
        background:#0e1117;border:1px solid var(--whm-line);box-shadow:0 22px 56px rgba(0,0,0,.4)}
      .whm__stage{position:absolute;inset:0}
      .whm__view{position:absolute;inset:0;background:
        radial-gradient(ellipse 80% 60% at 50% 35%,#161c26 0%,#0e1117 70%);overflow:hidden}
      .whm--facade .whm__view{background:#5c554a}
      .whm--facade .whm__legend{width:168px;padding:10px 12px;opacity:.92}
      .whm--facade .whm__legend .v{font-size:18px}
      .whm--facade .whm__legend .s{display:none}
      .whm--facade .whm__legfill{margin-top:8px}
      .whm--facade .whm__side{width:min(268px,28vw);bottom:64px;top:52px}
      .whm--facade .whm__status{display:none}
      .whm--facade .whm__hud{padding-bottom:18px;background:linear-gradient(180deg,rgba(8,10,14,.55),transparent)}
      .whm--facade .whm__meta{display:none}
      .whm--facade .whm__hint{max-width:36%;top:10%}
      .whm__view canvas{display:block;width:100%!important;height:100%!important;touch-action:none}
      .whm__hud{position:absolute;left:0;right:0;top:0;z-index:8;display:flex;align-items:center;gap:12px;
        padding:14px 16px 32px;background:linear-gradient(180deg,rgba(8,10,14,.72),transparent);pointer-events:none}
      .whm__brand{font:700 11px/1 Segoe UI,system-ui;letter-spacing:.16em;color:var(--whm-accent);pointer-events:none}
      .whm__title{font:600 13px/1.2 Segoe UI,system-ui;color:#e9eef5}.whm__title small{color:#8d99aa;font-weight:500;margin-left:8px}
      .whm__modes{display:flex;gap:4px;margin-left:8px;pointer-events:auto;padding:3px;border-radius:10px;background:rgba(0,0,0,.35);border:1px solid var(--whm-line)}
      .whm__modes .whm__btn{border:0;background:transparent;border-radius:8px;padding:7px 12px;min-width:64px;color:#9aa6b8}
      .whm__modes .whm__btn--on{background:rgba(201,168,76,.22);color:var(--whm-accent);box-shadow:inset 0 0 0 1px rgba(201,168,76,.35)}
      .whm__search{margin-left:auto;display:flex;gap:6px;align-items:center;pointer-events:auto}
      .whm__search input{width:132px;background:rgba(16,20,28,.9);border:1px solid var(--whm-line);border-radius:8px;color:#e9eef5;padding:8px 10px;font-size:13px}
      .whm__search input:focus{outline:none;border-color:rgba(201,168,76,.55);box-shadow:0 0 0 3px rgba(201,168,76,.12)}
      .whm__meta{color:#8d99aa;font-size:11px;margin-left:8px;pointer-events:none;white-space:nowrap}
      .whm__btn{padding:8px 12px;border-radius:8px;border:1px solid var(--whm-line);background:rgba(26,33,44,.92);color:#e9eef5;font-weight:600;cursor:pointer;font-size:12px;transition:border-color .15s,background .15s,transform .12s}
      .whm__btn:hover{border-color:rgba(201,168,76,.45)}
      .whm__btn:active{transform:translateY(1px)}
      .whm__btn--on{border-color:rgba(201,168,76,.55);color:var(--whm-accent)}
      .whm__btn--pri{background:var(--whm-accent);color:#1a1408;border-color:transparent}
      .whm__btn--pri:hover{filter:brightness(1.06);border-color:transparent}
      .whm__btn:disabled{opacity:.35;cursor:default;transform:none}
      .whm__legend{position:absolute;left:14px;top:58px;z-index:8;width:200px;padding:14px 14px 12px;border-radius:12px;
        background:var(--whm-panel);border:1px solid var(--whm-line);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
        font-size:11px;color:#8d99aa;line-height:1.35;box-shadow:0 12px 28px rgba(0,0,0,.28)}
      .whm__legend .k{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#8d99aa}
      .whm__legend .v{margin-top:4px;font:700 22px/1.05 Segoe UI,system-ui;letter-spacing:.06em;color:var(--whm-accent);min-height:24px}
      .whm__legend .s{margin-top:6px;font-size:11px;line-height:1.35}
      .whm__legfill{display:flex;align-items:center;gap:5px;margin-top:10px;flex-wrap:wrap}
      .whm__legfill i{font-style:normal;font-size:10px;color:#8d99aa;margin-right:4px}
      .whm__legfill__i{width:12px;height:12px;border-radius:3px;border:1px solid rgba(255,255,255,.12);display:inline-block}
      .whm__legfill__i[data-f="low"]{background:#3e4756}
      .whm__legfill__i[data-f="mid"]{background:#5a6578}
      .whm__legfill__i[data-f="hi"]{background:#8a5a48}
      .whm__typelist{display:grid;grid-template-columns:1fr 1fr;gap:8px 12px;margin-top:6px}
      .whm__typelist div{display:flex;align-items:center;gap:8px;font-size:11px;color:#9aa6b8}
      .whm__typelist i{width:14px;height:10px;border-radius:3px;display:inline-block;flex-shrink:0;border:1px solid rgba(255,255,255,.14)}
      .whm__side{position:absolute;top:58px;right:14px;bottom:78px;width:min(300px,32vw);z-index:8;padding:0;
        background:var(--whm-panel);border:1px solid var(--whm-line);border-radius:12px;overflow:auto;
        backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);font-size:13px;color:#e9eef5;
        box-shadow:0 16px 40px rgba(0,0,0,.32);pointer-events:auto}
      .whm__hud{pointer-events:none}
      .whm__modes,.whm__search{pointer-events:auto}
      .whm__side-inner{padding:14px}
      .whm__side h4{margin:0 0 6px;font-size:15px;font-weight:700;color:#f2f5fa;letter-spacing:.01em}
      .whm__side .mut{color:#8d99aa;font-size:12px;line-height:1.45}
      .whm__side label{display:block;margin:10px 0 4px;font-size:10px;color:#8d99aa;text-transform:uppercase;letter-spacing:.08em}
      .whm__side input,.whm__side select{width:100%;box-sizing:border-box;background:rgba(12,16,22,.9);border:1px solid var(--whm-line);border-radius:8px;color:#e9eef5;padding:8px}
      .whm__side .row{display:flex;gap:6px}.whm__side .row>*{flex:1;min-width:0}
      .whm__code{display:inline-block;margin:8px 0;padding:4px 10px;border-radius:6px;background:rgba(201,168,76,.12);color:var(--whm-accent);font:700 18px Segoe UI,system-ui;letter-spacing:.08em}
      .whm__dock{position:absolute;left:50%;bottom:12px;transform:translateX(-50%);z-index:8;display:flex;gap:6px;align-items:center;
        flex-wrap:wrap;justify-content:center;padding:8px 10px;border-radius:12px;background:var(--whm-panel);
        border:1px solid var(--whm-line);backdrop-filter:blur(12px);max-width:calc(100% - 28px);box-shadow:0 10px 28px rgba(0,0,0,.3);
        opacity:0;pointer-events:none;transition:opacity .2s}
      .whm__dock.whm__dock--on{opacity:1;pointer-events:auto}
      .whm__dock .step{color:#8d99aa;font-size:11px;min-width:140px;text-align:center}
      .whm__hint{position:absolute;left:50%;top:12%;transform:translateX(-50%);z-index:6;text-align:center;pointer-events:none;opacity:0;transition:.2s;max-width:42%;padding:8px 14px;border-radius:10px;background:rgba(10,12,16,.55);border:1px solid rgba(255,255,255,.08);backdrop-filter:blur(6px)}
      .whm__hint.show{opacity:1}
      .whm__hint h3{margin:0;font-size:14px;font-weight:700;color:#f2f5fa;text-shadow:none;letter-spacing:.02em}
      .whm__hint p{margin:3px 0 0;color:#8d99aa;font-size:11px}
      .whm__status{position:absolute;left:14px;bottom:70px;z-index:5;background:rgba(14,18,24,.82);border:1px solid var(--whm-line);border-radius:10px;padding:8px 12px;color:#8d99aa;font-size:11px;max-width:42%;backdrop-filter:blur(8px)}
      .whm__pill{position:absolute;left:14px;top:58px;z-index:5;margin-top:0;padding:5px 9px;border-radius:6px;background:rgba(201,168,76,.12);color:var(--whm-accent);font:600 10px/1.2 Segoe UI;letter-spacing:.08em;text-transform:uppercase;border:1px solid rgba(201,168,76,.22)}
      .whm__legend ~ .whm__pill,.whm .whm__pill{left:14px;top:auto;bottom:auto}
      .whm__lab{position:absolute;left:0;top:0;pointer-events:none;padding:2px 6px;border-radius:3px;background:rgba(14,16,20,.88);border:1px solid rgba(201,168,76,.4);color:#e0c078;font:700 10px/1.2 Segoe UI,system-ui;letter-spacing:.03em;white-space:nowrap;transform:translate(-50%,-110%);will-change:transform;z-index:5}
      .whm__lab--plan{font-size:10px;border-color:rgba(255,255,255,.14);color:#e8edf4;background:rgba(10,12,16,.82);font-weight:700;letter-spacing:.04em;opacity:0;transition:opacity .15s}
      .whm__lab--plan.whm__lab--on{opacity:1}
      .whm__lab--room{border:0;background:transparent;color:rgba(160,176,196,.42);font-weight:600;font-size:8px;letter-spacing:.08em;text-transform:uppercase;box-shadow:none;padding:0;border-radius:0}
      .whm__lab--door{border-color:rgba(201,168,76,.85);color:var(--whm-accent);font-size:12px;letter-spacing:.14em;background:rgba(14,16,20,.95);padding:5px 10px;box-shadow:0 0 0 1px rgba(201,168,76,.25),0 8px 20px rgba(0,0,0,.35)}
      .whm__lab--aisle{border:0;background:transparent;color:rgba(140,160,180,.4);font-size:8px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;box-shadow:none}
      .whm__lab--pct{padding:2px 6px;font-size:10px;font-weight:700;border-color:rgba(255,255,255,.16);background:rgba(10,12,16,.88);letter-spacing:.02em}
      .whm__lab--find{border-color:rgba(201,168,76,.65);color:var(--whm-accent);font-size:12px;background:rgba(14,16,20,.92);box-shadow:0 0 0 1px rgba(201,168,76,.2)}
      .whm__place{width:100%;text-align:left;margin:0 0 5px;padding:9px 11px;border-radius:8px;border:1px solid var(--whm-line);background:rgba(255,255,255,.02);color:#e9eef5;cursor:pointer;transition:border-color .15s,background .15s}
      .whm__place:hover,.whm__place.on{border-color:rgba(201,168,76,.45);background:rgba(201,168,76,.08)}
      .whm__place.find{border-color:var(--whm-ok);box-shadow:0 0 0 2px rgba(43,171,98,.18)}
      .whm__place b{display:block;font-size:12px}.whm__place span{color:#8d99aa;font-size:10px}
      .whm__tour{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;align-items:center}
      .whm__tour .step{color:#8d99aa;font-size:11px;min-width:110px}
      .whm__act{display:flex;flex-direction:column;gap:6px;margin-top:12px}
      .whm__act .whm__btn{width:100%}
      @media(max-width:900px){
        .whm__side{width:min(280px,86vw);bottom:86px}
        .whm__legend{display:none}
        .whm__search input{width:100px}
      }
    `;
  }

    function num(v, d) {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : d;
    }
    function parseJson(v, fallback) {
    if (v == null) return fallback;
    if (typeof v === 'object') return v;
    try { return JSON.parse(v); } catch (_) { return fallback; }
  }
  function fillCol(f) {
    // содержимое контейнера: картон / крафт / плотная укладка (не серый кирпич)
    return f < 0.2 ? 0xc4a574 : f < 0.65 ? 0xa07848 : 0x7a4e36;
  }
  function typePlanCol(type, fill) {
    const base = ({
      shelf_light: 0x4a5a6e,
      shelf_pallet: 0x3d5a78,
      clothing: 0x5a4e6a,
      floor_zone: 0x3a4840,
      scrap: 0x5a4840,
      workbench: 0x4a5040,
      machine: 0x405060,
      assembly_pallet: 0x6a5a3a
    })[type] || 0x4a5566;
    // слегка подмешиваем заполнение к базовому цвету типа
    if (fill >= 0.65) return 0x8a5a48;
    if (fill < 0.2) return base;
    return base;
  }
  function ease(t) {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }
  function debounce(fn, ms) {
    let t = null;
    return function () {
      const args = arguments;
      const ctx = this;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(ctx, args), ms);
    };
  }

  async function mount(container, opts = {}) {
    destroy();
    injectCSS();
    const THREE = await loadThree();
    const api = opts.api || {
      get: (u) => defApi('GET', u),
      post: (u, b) => defApi('POST', u, b),
      put: (u, b) => defApi('PUT', u, b),
      del: (u) => defApi('DELETE', u)
    };

    container.innerHTML = `
      <div class="whm">
        <div class="whm__stage">
          <div class="whm__view" id="whm-view">
            <div class="whm__hud">
              <div class="whm__brand">ASGARD WMS</div>
              <div class="whm__title">Адресная карта <small>план → маршрут → фасад</small></div>
              <div class="whm__modes">
                <button type="button" class="whm__btn whm__btn--on" data-a="mode2d">План</button>
                <button type="button" class="whm__btn" data-a="mode3d">3D</button>
              </div>
              <div class="whm__search">
                <input id="whm-find" placeholder="Код места" autocomplete="off">
                <button type="button" class="whm__btn whm__btn--pri" data-a="find">Найти</button>
                <button type="button" class="whm__btn" data-a="edit" title="Редактор">✎</button>
                <button type="button" class="whm__btn" data-a="refresh" title="Обновить">↻</button>
              </div>
              <span class="whm__meta" id="whm-bar-status"></span>
            </div>
            <div class="whm__legend" id="whm-legend">
              <div class="k">Выбрано</div>
              <div class="v" id="whm-legend-code">—</div>
              <div class="s">1 ед = 1 м · золотой маркер — ВХОД</div>
              <div class="whm__legfill" aria-hidden="true">
                <span class="whm__legfill__i" data-f="low"></span><i>мало</i>
                <span class="whm__legfill__i" data-f="mid"></span><i>норма</i>
                <span class="whm__legfill__i" data-f="hi"></span><i>полно</i>
              </div>
              <div class="whm__pill" id="whm-pill" style="position:static;display:inline-block;margin-top:8px">режим: план 2D</div>
            </div>
            <div class="whm__hint" id="whm-hint"><h3></h3><p></p></div>
            <div class="whm__status" id="whm-status">Загрузка карты…</div>
            <div class="whm__dock" id="whm-dock">
              <button type="button" class="whm__btn" data-tour-prev disabled>←</button>
              <span class="step" id="whm-tour-step">Готов к поиску</span>
              <button type="button" class="whm__btn" data-tour-next disabled>→</button>
            </div>
            <aside class="whm__side" id="whm-side"><div class="whm__side-inner mut">Клик по стеллажу или поиск кода места</div></aside>
          </div>
        </div>
      </div>`;

    const view = container.querySelector('#whm-view');
    const hostEl = container.querySelector('.whm');
    const side = container.querySelector('#whm-side');
    const hintEl = container.querySelector('#whm-hint');
    const statusEl = container.querySelector('#whm-status');
    const barStatus = container.querySelector('#whm-bar-status');
    const pillEl = container.querySelector('#whm-pill');
    const legendCode = container.querySelector('#whm-legend-code');

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    view.insertBefore(renderer.domElement, view.firstChild);
    ['wheel', 'contextmenu'].forEach((ev) =>
      renderer.domElement.addEventListener(ev, (e) => e.preventDefault(), { passive: false })
    );

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x12151b);
    scene.fog = new THREE.Fog(0x12151b, 45, 75);

    const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    const persp = new THREE.PerspectiveCamera(36, 1, 0.1, 120);
    let cam = ortho;
    let mode3d = false;
    const look = new THREE.Vector3(0, 0, 0);
    function setPerspFov(facade) {
      persp.fov = facade ? 44 : 36;
      persp.updateProjectionMatrix();
    }

    const ambLight = new THREE.AmbientLight(0xb0bac8, 0.4);
    const hemiLight = new THREE.HemisphereLight(0xd8dee8, 0x1a1712, 0.48);
    scene.add(ambLight);
    scene.add(hemiLight);
    const sun = new THREE.DirectionalLight(0xf5f1ea, 1.05);
    sun.position.set(12, 22, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { near: 2, far: 60, left: -28, right: 28, top: 28, bottom: -28 });
    scene.add(sun);
    const spot = new THREE.SpotLight(0xc9a84c, 0, 36, Math.PI / 5.5, 0.45, 1);
    scene.add(spot);
    scene.add(spot.target);
    // доп. свет только для фасада (ключ / заливка / rim) — иначе стеллаж в «чёрной дыре»
    const facadeKey = new THREE.DirectionalLight(0xfff4e6, 0);
    facadeKey.castShadow = true;
    facadeKey.shadow.mapSize.set(2048, 2048);
    facadeKey.shadow.bias = -0.0008;
    facadeKey.shadow.normalBias = 0.03;
    scene.add(facadeKey);
    const facadeFill = new THREE.DirectionalLight(0xa8bdd8, 0);
    facadeFill.position.set(-8, 5, 4);
    scene.add(facadeFill);
    const facadeRim = new THREE.DirectionalLight(0xd4b56a, 0);
    facadeRim.position.set(0, 4, -10);
    scene.add(facadeRim);
    function setFacadeLights(on, g) {
      const k = on ? 1 : 0;
      // плоский тёплый свет: без жёсткого ключа/теней «на полу»
      facadeKey.intensity = 0.55 * k;
      facadeFill.intensity = 0.85 * k;
      facadeRim.intensity = 0.35 * k;
      ambLight.intensity = on ? 0.72 : 0.4;
      hemiLight.intensity = on ? 0.08 : 0.48;
      sun.intensity = on ? 0 : 1.05;
      facadeKey.castShadow = false; // фасад без теней на «полу» — только стеллаж на тёплом фоне
      sun.castShadow = !on && sun.castShadow;
      if (on) {
        // единый тёплый фон без горизонта стена/пол
        const warm = 0x5c554a;
        scene.background = new THREE.Color(warm);
        scene.fog = null;
        renderer.setClearColor(warm, 1);
        renderer.toneMappingExposure = 1.08;
        setPerspFov(true);
      } else {
        scene.background = new THREE.Color(0x12151b);
        scene.fog = new THREE.Fog(0x12151b, 45, 75);
        renderer.setClearColor(0x12151b, 1);
        renderer.toneMappingExposure = 1.02;
        setPerspFov(false);
      }
      if (on && g) {
        facadeKey.position.set(g.rx + g.fnx * 7 + g.W * 0.15, g.H + 7.5, g.rz + g.fnz * 7);
        facadeKey.target.position.set(g.rx, g.H * 0.35, g.rz);
        const sc = facadeKey.shadow.camera;
        Object.assign(sc, {
          near: 1, far: 35,
          left: -Math.max(6, g.W * 1.6), right: Math.max(6, g.W * 1.6),
          top: Math.max(7, g.H * 1.4), bottom: -1.5
        });
        sc.updateProjectionMatrix();
        facadeFill.position.set(g.rx - g.fnx * 2 - g.W * 1.1, g.H * 0.7, g.rz - g.fnz * 1.5);
        facadeFill.target.position.set(g.rx, g.H * 0.35, g.rz);
        facadeRim.position.set(g.rx - g.fnx * 5, g.H * 0.9, g.rz - g.fnz * 5);
        facadeRim.target.position.set(g.rx, g.H * 0.5, g.rz);
        spot.position.set(g.rx + g.fnx * 3.2, g.H + 2.2, g.rz + g.fnz * 3.2);
        spot.target.position.set(g.rx, g.H * 0.45, g.rz);
        spot.intensity = 2.6;
        spot.angle = Math.PI / 5.5;
        spot.penumbra = 0.55;
        spot.distance = 28;
        if (!facadeKey.target.parent) scene.add(facadeKey.target);
        if (!facadeFill.target.parent) scene.add(facadeFill.target);
        if (!facadeRim.target.parent) scene.add(facadeRim.target);
      } else {
        spot.intensity = 0;
      }
    }

    const M = {
      floor: new THREE.MeshStandardMaterial({ color: 0x3a424e, roughness: 0.9, metalness: 0.04 }),
      floorIn: new THREE.MeshStandardMaterial({ color: 0x454e5c, roughness: 0.85, metalness: 0.05 }),
      wall: new THREE.MeshStandardMaterial({ color: 0x5c6573, roughness: 0.75, metalness: 0.15 }),
      wallIn: new THREE.MeshStandardMaterial({ color: 0x6e7888, roughness: 0.7, metalness: 0.1 }),
      upright: new THREE.MeshStandardMaterial({ color: 0x3d6fa8, roughness: 0.45, metalness: 0.55 }),
      beam: new THREE.MeshStandardMaterial({ color: 0xc4782a, roughness: 0.5, metalness: 0.4 }),
      deck: new THREE.MeshStandardMaterial({ color: 0x6a7380, roughness: 0.65, metalness: 0.35 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x2e3540, roughness: 0.6, metalness: 0.4 }),
      yard: new THREE.MeshStandardMaterial({ color: 0x2a3038, roughness: 1 }),
      wood: new THREE.MeshStandardMaterial({ color: 0x8b6914, roughness: 0.7 }),
      cloth: new THREE.MeshStandardMaterial({ color: 0x5a6a8a, roughness: 0.55, metalness: 0.3 }),
      zone: new THREE.MeshStandardMaterial({ color: 0x3a5068, roughness: 0.9, transparent: true, opacity: 0.55 }),
      scrap: new THREE.MeshStandardMaterial({ color: 0x6a5a4a, roughness: 0.8 }),
      machine: new THREE.MeshStandardMaterial({ color: 0x4a5568, roughness: 0.4, metalness: 0.5 }),
      pallet: new THREE.MeshStandardMaterial({ color: 0xb8956a, roughness: 0.75 })
    };

    const world = new THREE.Group();
    scene.add(world);
    const pathGroup = new THREE.Group();
    scene.add(pathGroup);

    const labelLayer = document.createElement('div');
    labelLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:visible;z-index:2';
    view.appendChild(labelLayer);

    const objectRoots = new Map();
    const clickables = [];
    const labels = [];
    let walls = [];
    let wallMatBackup = [];
    let floorMesh = null;
    let gridHelper = null;
    let doorMark = null;
    let facadeStage = null;
    let planFoots = [];
    let floorData = null;
    let objects = [];
    let shell = null;
    let selectedId = null;
    let selectedLoc = null;
    let editMode = !!opts.editMode;
    let frontMode = false;
    let isolateId = null;
    let dragging = null;
    let animId = 0;
    let camTween = null;
    let routeAnim = null;
    let pulseArrow = null;

    /** Нормализация габаритов: ширина = лицо к проходу. Swap+90° если depth>width; фасад к aisle. */
    function rackDims(obj) {
      let W = num(obj.width_m, 2.7);
      let D = num(obj.depth_m, 0.95);
      let H = num(obj.height_m, 2.4);
      let rotDeg = num(obj.rot_deg, 0);
      if (D > W * 1.15) {
        const t = W;
        W = D;
        D = t;
        rotDeg += 90;
      }
      let rot = (rotDeg * Math.PI) / 180;
      if (shell && (shell.aisleX || shell.aisleZ)) {
        let fnx = Math.sin(rot);
        let fnz = Math.cos(rot);
        const rx = num(obj.x_m, 0);
        const rz = num(obj.z_m, 0);
        if (shell.aisleX && shell.aisleX.length && Math.abs(fnx) >= Math.abs(fnz) * 0.7) {
          const ax = shell.aisleX.reduce((b, v) => Math.abs(v - rx) < Math.abs(b - rx) ? v : b, shell.aisleX[0]);
          if ((ax - rx) * fnx < -0.05) { rotDeg += 180; rot += Math.PI; }
        } else if (shell.aisleZ && shell.aisleZ.length) {
          const az = shell.aisleZ.reduce((b, v) => Math.abs(v - rz) < Math.abs(b - rz) ? v : b, shell.aisleZ[0]);
          if ((az - rz) * fnz < -0.05) { rotDeg += 180; rot += Math.PI; }
        }
      }
      return { W, D, H, rotDeg, rot };
    }
    let tourStep = 0;
    let tourTarget = null;
    let tourCancel = null;
    let liveRebuildTimer = null;

    function setBarStatus(t) { barStatus.textContent = t || ''; }
    function setStatus(t) { statusEl.textContent = t || ''; statusEl.style.display = t ? '' : 'none'; }
    function showHint(title, sub, ms) {
      hintEl.querySelector('h3').textContent = title || '';
      hintEl.querySelector('p').textContent = sub || '';
      hintEl.classList.add('show');
      clearTimeout(showHint._t);
      showHint._t = setTimeout(() => hintEl.classList.remove('show'), ms || 900);
    }
    function setPill(plan) {
      pillEl.textContent = plan ? 'режим: план 2D' : (frontMode ? 'режим: фасад' : 'режим: 3D');
      const legS = container.querySelector('#whm-legend .s');
      if (legS) {
        legS.textContent = plan
          ? '1 ед = 1 м · золотой маркер — ВХОД'
          : (frontMode ? 'фасад стеллажа · слот подсвечен рамкой' : 'стеллаж · полка · место');
      }
    }

    function aspect() {
      return view.clientWidth / Math.max(view.clientHeight, 1);
    }

    function box(mat, w, h, d, x, y, z, parent, cast) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.castShadow = cast !== false;
      m.receiveShadow = true;
      // structural parts get pulse highlight (cloned mat) — no glow spheres
      if (mat && mat.isMeshStandardMaterial && (
        mat === M.upright || mat === M.beam || mat === M.deck || mat === M.dark ||
        mat === M.cloth || mat === M.scrap || mat === M.machine || mat === M.wood ||
        mat === M.pallet || mat === M.zone
      )) {
        markGlowable(m);
      }
      (parent || world).add(m);
      return m;
    }

    function finalizeObjectGlow(root) {
      if (!root) return;
      root.traverse((o) => {
        if (!o.isMesh || !o.material || o.material.visible === false) return;
        if (o.userData && (o.userData.shelfHL || o.userData.placeHL || o.userData.planSlab || o.userData.hlSphere)) return;
        if (o.material.type === 'MeshBasicMaterial' && o.material.visible === false) return;
        if (o.material.emissive) markGlowable(o);
      });
    }

    function addLabel(html, x, y, z, flags) {
      const el = document.createElement('div');
      el.className = 'whm__lab' + (flags && flags.cls ? ' ' + flags.cls : '');
      el.innerHTML = html;
      if (flags && flags.opacity != null) el.style.opacity = String(flags.opacity);
      labelLayer.appendChild(el);
      const rec = {
        el, x, y, z,
        planOnly: !!(flags && flags.planOnly),
        always: !!(flags && flags.always),
        frontOnly: !!(flags && flags.frontOnly),
        objectId: flags && flags.objectId,
        worldPos: !!(flags && flags.worldPos)
      };
      labels.push(rec);
      return rec;
    }

    function projectLabels() {
      const w = view.clientWidth;
      const h = view.clientHeight;
      const placed = [];
      // в плане: приоритет дверь → выбранный → комнаты → коды (с антиколлизией)
      const order = labels.slice().sort((a, b) => {
        const pa = a.el.classList.contains('whm__lab--door') ? 0
          : (a.objectId != null && a.objectId === selectedId) ? 1
          : a.el.classList.contains('whm__lab--room') ? 2
          : a.el.classList.contains('whm__lab--plan') ? 3
          : a.el.classList.contains('whm__lab--aisle') ? 5 : 4;
        const pb = b.el.classList.contains('whm__lab--door') ? 0
          : (b.objectId != null && b.objectId === selectedId) ? 1
          : b.el.classList.contains('whm__lab--room') ? 2
          : b.el.classList.contains('whm__lab--plan') ? 3
          : b.el.classList.contains('whm__lab--aisle') ? 5 : 4;
        return pa - pb;
      });
      order.forEach((l) => {
        if (l.el.style.display === 'none' && l._forceHide) return;
        if (l._local && l._local.parent) {
          try {
            l._local.parent.updateWorldMatrix(true, false);
            const p = new THREE.Vector3(l._local.ox, l._local.oy, l._local.oz);
            p.applyMatrix4(l._local.parent.matrixWorld);
            l.x = p.x; l.y = p.y; l.z = p.z;
          } catch (_) { /* keep last */ }
        }
        const v = new THREE.Vector3(l.x, l.y, l.z).project(cam);
        const ok = v.z < 1 && Math.abs(v.x) < 1.45 && Math.abs(v.y) < 1.45;
        if (!ok || l._forceHide) {
          l.el.style.visibility = 'hidden';
          return;
        }
        const sx = (v.x * 0.5 + 0.5) * w;
        const sy = (-v.y * 0.5 + 0.5) * h;
        // не лезем лейблами в HUD / легенду / сайд / док (кроме двери и find)
        const keepEdge = l.el.classList.contains('whm__lab--find') || l.el.classList.contains('whm__lab--door');
        if (!keepEdge && (sy < 52 || sy > h - 72 || sx < 8 || sx > w - (w > 900 ? 320 : 24))) {
          l.el.style.visibility = 'hidden';
          return;
        }
        // план: коды стеллажей только у выбранного — иначе каша поверх архитектуры
        if (!mode3d && !frontMode && l.el.classList.contains('whm__lab--plan') && l.objectId != null) {
          if (l.objectId !== selectedId) {
            l.el.style.visibility = 'hidden';
            return;
          }
        }
        if (!mode3d && (l.planOnly || l.el.classList.contains('whm__lab--plan') || l.el.classList.contains('whm__lab--room'))) {
          const minD = l.el.classList.contains('whm__lab--room') ? 48
            : l.el.classList.contains('whm__lab--plan') ? 44 : 36;
          for (let i = 0; i < placed.length; i++) {
            const dx = sx - placed[i].x;
            const dy = sy - placed[i].y;
            if (dx * dx + dy * dy < minD * minD) {
              l.el.style.visibility = 'hidden';
              return;
            }
          }
          placed.push({ x: sx, y: sy });
        }
        l.el.style.visibility = 'visible';
        l.el.style.transform = 'translate(' + sx + 'px,' + sy + 'px) translate(-50%,-110%)';
      });
    }

    /** Геометрия стеллажа с учётом rot_deg: local +Z = фасад. */
    function rackGeom(obj) {
      const rx = num(obj.x_m, 0);
      const rz = num(obj.z_m, 0);
      const { W, D, H, rot } = rackDims(obj);
      const fnx = Math.sin(rot);
      const fnz = Math.cos(rot);
      const facePad = 0.65;
      return {
        rx, rz, W, D, H, rot, fnx, fnz,
        faceX: rx + fnx * (D / 2 + facePad),
        faceZ: rz + fnz * (D / 2 + facePad),
        approachX: rx + fnx * (D / 2 + 1.4),
        approachZ: rz + fnz * (D / 2 + 1.4)
      };
    }

    function clearLabels() {
      labels.forEach((l) => l.el.remove());
      labels.length = 0;
    }

    function disposeObject3D(root) {
      root.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach((m) => {
            if (m !== M.upright && m !== M.beam && m !== M.deck && m !== M.dark &&
                m !== M.floorIn && m !== M.wall && m !== M.wallIn && m !== M.wood &&
                m !== M.cloth && m !== M.zone && m !== M.scrap && m !== M.machine &&
                m !== M.pallet && m !== M.floor && m !== M.yard) m.dispose?.();
          });
        }
      });
    }

    function clearWorld() {
      clearPath();
      clearFind();
      clearRings();
      while (world.children.length) {
        const c = world.children.pop();
        disposeObject3D(c);
      }
      objectRoots.clear();
      clickables.length = 0;
      walls = [];
      wallMatBackup = [];
      doorMark = null;
      facadeStage = null;
      planFoots = [];
      floorMesh = null;
      clearLabels();
    }

    function clearPath() {
      if (routeAnim) { routeAnim.cancelled = true; routeAnim = null; }
      while (pathGroup.children.length) {
        const o = pathGroup.children.pop();
        o.geometry?.dispose?.();
      }
    }

    function metaOf(f) {
      return parseJson(f && f.meta_json, {}) || {};
    }
    function roomsOf(f) {
      const r = parseJson(f && f.rooms_json, []);
      return Array.isArray(r) ? r : [];
    }
    function paramsOf(o) {
      return parseJson(o && o.params_json, {}) || {};
    }

    function buildFloorShell(f) {
      const W = num(f.width_m, 15);
      const D = num(f.depth_m, 28);
      const H = num(f.height_m, 5.5);
      const ox = num(f.origin_x, 0);
      const oz = num(f.origin_z, 0);
      const meta = metaOf(f);

      floorMesh = box(M.floorIn, W, 0.08, D, ox, 0.04, oz, world, false);
      floorMesh.userData = { kind: 'floor' };
      // светлая «плитка» внутри — план читается как здание, не тёмный ковёр
      const floorTop = new THREE.Mesh(
        new THREE.BoxGeometry(W - 0.6, 0.02, D - 0.6),
        new THREE.MeshBasicMaterial({ color: 0x4a5566, transparent: true, opacity: 0.55, depthWrite: false })
      );
      floorTop.position.set(ox, 0.095, oz);
      floorTop.userData = { planFoot: true };
      world.add(floorTop);
      planFoots.push(floorTop);

      // асфальт/двор вокруг здания — план читается как «здание на площадке», не плавающий прямоугольник
      const yardPad = new THREE.Mesh(
        new THREE.BoxGeometry(W + 8.5, 0.04, D + 10),
        new THREE.MeshBasicMaterial({ color: 0x222833, transparent: true, opacity: 1, depthWrite: false })
      );
      yardPad.position.set(ox, 0.012, oz + 0.7);
      yardPad.userData = { planFoot: true };
      world.add(yardPad);
      planFoots.push(yardPad);
      // светлая кромка двора — очень тихо, не «ореол»
      const yardRing = new THREE.Mesh(
        new THREE.RingGeometry(Math.max(W, D) * 0.55 + 2.2, Math.max(W, D) * 0.55 + 2.55, 64),
        new THREE.MeshBasicMaterial({ color: 0x3a4558, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false })
      );
      yardRing.rotation.x = -Math.PI / 2;
      yardRing.position.set(ox, 0.02, oz + 0.7);
      yardRing.userData = { planFoot: true };
      world.add(yardRing);
      planFoots.push(yardRing);

      gridHelper = new THREE.GridHelper(W, Math.round(W), 0x5a6578, 0x3a4452);
      gridHelper.position.set(ox, 0.09, oz);
      gridHelper.material.transparent = true;
      gridHelper.material.opacity = 0.14;
      world.add(gridHelper);

      function addWall(w, h, d, x, y, z, tags) {
        const m = box(M.wall, w, h, d, x, y, z);
        m.userData = Object.assign({ isWall: true }, tags || {});
        walls.push(m);
        return m;
      }
      function addPlanFoot(fw, fd, x, z, color, opacity) {
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(fw, 0.05, fd),
          new THREE.MeshBasicMaterial({
            color: color, transparent: true, opacity: opacity == null ? 0.92 : opacity, depthWrite: false
          })
        );
        m.position.set(x, 0.12, z);
        m.userData = { planFoot: true };
        world.add(m);
        planFoots.push(m);
        return m;
      }

      // Вертикальные стены (3D) + жирный контур на полу (план сверху)
      const wallT = 0.45;
      addWall(W, H, wallT, ox, H / 2, oz - D / 2, { backWall: true });
      addWall(wallT, H, D, ox - W / 2, H / 2, oz, { sideWall: true, side: 'L' });
      addWall(wallT, H, D, ox + W / 2, H / 2, oz, { sideWall: true, side: 'R' });
      const doorW = num(meta.door_w, 2.4);
      const frontZ = oz + D / 2;
      addWall((W - doorW) / 2, H, wallT, ox - (doorW / 2 + (W - doorW) / 4), H / 2, frontZ, { frontWall: true });
      addWall((W - doorW) / 2, H, wallT, ox + (doorW / 2 + (W - doorW) / 4), H / 2, frontZ, { frontWall: true });
      addWall(doorW, 0.35, wallT, ox, H - 0.2, frontZ, { frontWall: true });
      box(M.beam, doorW, 0.04, 1.1, ox, 0.06, frontZ + 0.4, world, false);
      // плинтус
      box(M.wallIn, W, 0.35, 0.12, ox, 0.2, oz - D / 2 + 0.05, world, false);
      box(M.wallIn, 0.12, 0.35, D, ox - W / 2 + 0.05, 0.2, oz, world, false);
      box(M.wallIn, 0.12, 0.35, D, ox + W / 2 - 0.05, 0.2, oz, world, false);

      // Контур здания: внешняя тень + яркий плинтус (архитектурный периметр)
      const footOuter = 0x6a788c;
      const footCol = 0xe8eef8;
      addPlanFoot(W + 0.9, 0.85, ox, oz - D / 2, footOuter, 0.55);
      addPlanFoot(0.85, D + 0.9, ox - W / 2, oz, footOuter, 0.55);
      addPlanFoot(0.85, D + 0.9, ox + W / 2, oz, footOuter, 0.55);
      addPlanFoot(W + 0.45, 0.42, ox, oz - D / 2, footCol, 1);
      addPlanFoot(0.42, D + 0.45, ox - W / 2, oz, footCol, 1);
      addPlanFoot(0.42, D + 0.45, ox + W / 2, oz, footCol, 1);
      addPlanFoot((W - doorW) / 2 + 0.15, 0.42, ox - (doorW / 2 + (W - doorW) / 4), frontZ, footCol, 1);
      addPlanFoot((W - doorW) / 2 + 0.15, 0.42, ox + (doorW / 2 + (W - doorW) / 4), frontZ, footCol, 1);

      const door = {
        x: meta.door_x != null ? num(meta.door_x, ox) : ox,
        z: meta.door_z != null ? num(meta.door_z, oz + D / 2 - 0.2) : oz + D / 2 - 0.2
      };
      // площадка входа + порог
      // площадка входа + порог (внутри здания — не клипится кадром)
      const doorPad = new THREE.Mesh(
        new THREE.PlaneGeometry(doorW * 1.8, 2.8),
        new THREE.MeshBasicMaterial({ color: 0xc9a84c, transparent: true, opacity: 0.42, depthWrite: false })
      );
      doorPad.rotation.x = -Math.PI / 2;
      doorPad.position.set(door.x, 0.11, door.z - 0.55);
      doorPad.userData = { planFoot: true };
      world.add(doorPad);
      planFoots.push(doorPad);
      doorMark = new THREE.Mesh(
        new THREE.PlaneGeometry(doorW * 1.35, 0.7),
        new THREE.MeshBasicMaterial({ color: 0xf0d078, transparent: true, opacity: 0.95, depthWrite: false })
      );
      doorMark.rotation.x = -Math.PI / 2;
      doorMark.position.set(door.x, 0.14, door.z - 0.15);
      doorMark.userData = { planFoot: true };
      world.add(doorMark);
      planFoots.push(doorMark);
      // стрелка входа внутрь
      const arrow = new THREE.Mesh(
        new THREE.ConeGeometry(0.5, 1.35, 3),
        new THREE.MeshBasicMaterial({ color: 0xc9a84c, transparent: true, opacity: 0.98 })
      );
      arrow.rotation.x = -Math.PI / 2;
      arrow.position.set(door.x, 0.16, door.z - 1.35);
      arrow.userData = { planFoot: true };
      world.add(arrow);
      planFoots.push(arrow);
      addLabel('<b>ВХОД</b>', door.x, 0.35, door.z - 2.1, { cls: 'whm__lab--door', always: true });

      // Проходы — читаемые полосы + золотой пунктир (навигация)
      const aisleMat = new THREE.MeshBasicMaterial({
        color: 0x445868, transparent: true, opacity: 0.42, depthWrite: false
      });
      const aisleEdge = new THREE.MeshBasicMaterial({
        color: 0x8aa4b8, transparent: true, opacity: 0.7, depthWrite: false
      });
      const dashMat = new THREE.MeshBasicMaterial({
        color: 0xc9a84c, transparent: true, opacity: 0.72, depthWrite: false
      });
      function addDashesNS(ax, len) {
        const step = 1.1;
        const n = Math.max(3, Math.floor(len / step));
        for (let i = 0; i < n; i++) {
          const zz = oz - len / 2 + 0.4 + i * step;
          const dash = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.45), dashMat);
          dash.position.set(num(ax, 0), 0.095, zz);
          dash.userData = { planFoot: true };
          world.add(dash);
          planFoots.push(dash);
        }
      }
      function addDashesEW(az, len) {
        const step = 1.1;
        const n = Math.max(3, Math.floor(len / step));
        for (let i = 0; i < n; i++) {
          const xx = ox - len / 2 + 0.4 + i * step;
          const dash = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.02, 0.08), dashMat);
          dash.position.set(xx, 0.095, num(az, 0));
          dash.userData = { planFoot: true };
          world.add(dash);
          planFoots.push(dash);
        }
      }
      (meta.aisle_x || []).forEach((ax) => {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.022, D * 0.9), aisleMat);
        strip.position.set(num(ax, 0), 0.08, oz);
        strip.userData = { aisleStrip: true, planFoot: true };
        world.add(strip);
        planFoots.push(strip);
        [-0.5, 0.5].forEach((dx) => {
          const edge = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.028, D * 0.9), aisleEdge);
          edge.position.set(num(ax, 0) + dx, 0.09, oz);
          edge.userData = { planFoot: true };
          world.add(edge);
          planFoots.push(edge);
        });
        addDashesNS(ax, D * 0.88);
      });
      (meta.aisle_z || []).forEach((az) => {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(W * 0.9, 0.022, 0.85), aisleMat.clone());
        strip.position.set(ox, 0.08, num(az, 0));
        strip.userData = { aisleStrip: true, planFoot: true };
        world.add(strip);
        planFoots.push(strip);
        addDashesEW(az, W * 0.86);
      });
      // bay-полосы между проходами — ряды стеллажей, не «россыпь плит»
      const bayMat = new THREE.MeshBasicMaterial({
        color: 0x2a333e, transparent: true, opacity: 0.38, depthWrite: false
      });
      const axs = (meta.aisle_x || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
      for (let i = 0; i < axs.length - 1; i++) {
        const left = axs[i];
        const right = axs[i + 1];
        const mid = (left + right) / 2;
        const bw = Math.max(0.6, right - left - 1.15);
        const bay = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.016, D * 0.78), bayMat);
        bay.position.set(mid, 0.068, oz);
        bay.userData = { planFoot: true };
        world.add(bay);
        planFoots.push(bay);
      }
      const azs = (meta.aisle_z || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
      for (let i = 0; i < azs.length - 1; i++) {
        const a = azs[i];
        const b = azs[i + 1];
        const mid = (a + b) / 2;
        const bd = Math.max(0.5, b - a - 0.9);
        const bay = new THREE.Mesh(new THREE.BoxGeometry(W * 0.78, 0.016, bd), bayMat.clone());
        bay.position.set(ox, 0.068, mid);
        bay.userData = { planFoot: true };
        world.add(bay);
        planFoots.push(bay);
      }

      const roomColors = {
        r2: 0x2c3832, r3: 0x35342c, r1: 0x2c343c, kitchen: 0x32302e,
        locksmith: 0x3a322c, weld: 0x3a2c30, chem: 0x32302e, general: 0x2c3238,
        sandblast: 0x382c30, corridor: 0x243028
      };
      roomsOf(f).forEach((r) => {
        const rw = num(r.w, 0);
        const rd = num(r.d, 0);
        const rx = num(r.x, 0);
        const rz = num(r.z, 0);
        if (rw > 0.5 && rd > 0.5 && r.id !== 'corridor') {
          const col = roomColors[r.id] || 0x2e343c;
          const slab = new THREE.Mesh(
            new THREE.BoxGeometry(rw, 0.02, rd),
            new THREE.MeshStandardMaterial({
              color: col, roughness: 0.98, metalness: 0.01,
              transparent: true, opacity: 0.14
            })
          );
          slab.position.set(rx, 0.055, rz);
          slab.receiveShadow = true;
          world.add(slab);
          // рамки комнат убраны — только мягкая заливка под стеллажами
        }
        // подписи комнат на плане убраны — шум, мешают читать стеллажи
      });

      const aisleX = (meta.aisle_x || []).map(Number).filter(Number.isFinite);
      const aisleZ = (meta.aisle_z || []).map(Number).filter(Number.isFinite);
      return { W, D, H, ox, oz, door, aisleX, aisleZ };
    }

    function markGlowable(mesh) {
      if (!mesh || !mesh.isMesh || !mesh.material) return;
      // clone shared materials so pulse never mutates M.* globals
      if (!mesh.userData._matCloned) {
        mesh.material = mesh.material.clone();
        mesh.userData._matCloned = true;
      }
      mesh.userData.glowable = true;
      if (!mesh.userData._glowBase) {
        mesh.userData._glowBase = {
          color: mesh.material.color ? mesh.material.color.clone() : null,
          emissive: mesh.material.emissive ? mesh.material.emissive.clone() : null,
          ei: mesh.material.emissiveIntensity != null ? mesh.material.emissiveIntensity : 0
        };
      }
    }

    function applyRackPulse(root, on) {
      if (!root) return;
      root.userData.pulseTarget = !!on;
      root.traverse((o) => {
        if (!(o.userData && o.userData.glowable && o.material && o.material.emissive)) return;
        const base = o.userData._glowBase;
        if (!base) return;
        if (on) {
          o.material.emissive.setHex(0xd4a843);
          o.material.emissiveIntensity = 0.7;
          if (o.material.color) o.material.color.lerp(new THREE.Color(0xd4a843), 0.35);
        } else {
          if (base.color && o.material.color) o.material.color.copy(base.color);
          if (base.emissive) o.material.emissive.copy(base.emissive);
          o.material.emissiveIntensity = base.ei;
        }
      });
    }

    function makeTote(fill, W, D, H) {
      H = H || 0.36;
      const g = new THREE.Group();
      const t = 0.02;
      // открытый спереди контейнер — коробки читаются с фасада (не «синий куб»)
      const plastic = new THREE.MeshStandardMaterial({
        color: 0x3d7a9a, metalness: 0.22, roughness: 0.32,
        transparent: true, opacity: 0.55, side: THREE.DoubleSide
      });
      const plasticRim = new THREE.MeshStandardMaterial({
        color: 0x6aa8c4, metalness: 0.3, roughness: 0.22,
        emissive: 0x142838, emissiveIntensity: 0.14
      });
      const bottom = new THREE.Mesh(
        new THREE.BoxGeometry(Math.max(0.05, W - t * 2), t, Math.max(0.05, D - t * 2)),
        plastic
      );
      bottom.position.y = t / 2;
      bottom.receiveShadow = true;
      g.add(bottom);
      const wallH = H - t;
      // задняя + боковые; ПЕРЕД открыт
      [
        [0, wallH / 2 + t, -D / 2 + t / 2, W, wallH, t],
        [W / 2 - t / 2, wallH / 2 + t, 0, t, wallH, Math.max(0.05, D - t * 2)],
        [-W / 2 + t / 2, wallH / 2 + t, 0, t, wallH, Math.max(0.05, D - t * 2)]
      ].forEach(([x, y, z, w, h, d]) => {
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(Math.max(0.01, w), Math.max(0.01, h), Math.max(0.01, d)),
          plastic
        );
        m.position.set(x, y, z);
        m.castShadow = true;
        g.add(m);
      });
      // передний низкий бортик
      const lip = new THREE.Mesh(
        new THREE.BoxGeometry(W, 0.045, t),
        plasticRim
      );
      lip.position.set(0, t + 0.022, D / 2 - t / 2);
      g.add(lip);
      const rim = new THREE.Mesh(new THREE.BoxGeometry(W + 0.014, 0.022, D + 0.014), plasticRim);
      rim.position.y = H - 0.006;
      g.add(rim);
      [-1, 1].forEach((side) => {
        const grip = new THREE.Mesh(
          new THREE.BoxGeometry(0.028, 0.055, Math.max(0.1, D * 0.32)),
          plasticRim
        );
        grip.position.set(side * (W / 2 + 0.005), H * 0.68, -D * 0.05);
        g.add(grip);
      });
      [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([sx, sz]) => {
        const foot = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.026, 0.042), plasticRim);
        foot.position.set(sx * (W / 2 - 0.05), 0.013, sz * (D / 2 - 0.05));
        g.add(foot);
      });
      if (fill > 0.03) {
        const fillH = Math.max(0.06, (H - t * 2 - 0.05) * fill);
        const kraft = new THREE.MeshStandardMaterial({
          color: 0xc4a06a, roughness: 0.88, metalness: 0.02,
          emissive: 0x3a2810, emissiveIntensity: 0.1
        });
        const kraftDark = new THREE.MeshStandardMaterial({
          color: 0x9a7544, roughness: 0.9, metalness: 0.02,
          emissive: 0x2a1c08, emissiveIntensity: 0.08
        });
        const cols = Math.min(3, Math.max(2, Math.round(fill * 3 + 0.6)));
        const layers = Math.min(3, Math.max(1, Math.ceil(fill * 3.4)));
        const pw = Math.max(0.1, (W - t * 3.2) / cols * 0.94);
        const pd = Math.max(0.1, D * 0.62);
        const ph = Math.max(0.07, (fillH - 0.015) / layers * 0.95);
        for (let layer = 0; layer < layers; layer++) {
          for (let c = 0; c < cols; c++) {
            const pack = new THREE.Mesh(
              new THREE.BoxGeometry(pw, ph, pd),
              (c + layer) % 2 ? kraft : kraftDark
            );
            const x = -((cols - 1) * (pw + 0.025)) / 2 + c * (pw + 0.025);
            pack.position.set(
              x,
              t + 0.025 + ph / 2 + layer * (ph + 0.01),
              D * 0.08
            );
            pack.castShadow = true;
            pack.receiveShadow = true;
            g.add(pack);
            const tape = new THREE.Mesh(
              new THREE.BoxGeometry(pw * 0.22, ph * 0.95, 0.01),
              new THREE.MeshBasicMaterial({ color: 0xe0c078 })
            );
            tape.position.set(pack.position.x, pack.position.y, pack.position.z + pd / 2 + 0.006);
            g.add(tape);
            // тёмная этикетка на лице коробки
            const label = new THREE.Mesh(
              new THREE.BoxGeometry(pw * 0.55, ph * 0.28, 0.008),
              new THREE.MeshBasicMaterial({ color: 0xf2ead8 })
            );
            label.position.set(pack.position.x, pack.position.y - ph * 0.12, pack.position.z + pd / 2 + 0.008);
            g.add(label);
          }
        }
      }
      const pct = Math.round(fill * 100);
      const col = pct < 20 ? '#7dcea0' : pct < 65 ? '#e0c078' : '#e09084';
      const pctLab = addLabel(
        '<span style="color:' + col + '">' + pct + '%</span>',
        0, H * 0.72, D / 2 + 0.04,
        { cls: 'whm__lab--pct', frontOnly: true, opacity: 0, objectId: g.userData._oid }
      );
      g.userData._pctLabel = pctLab;
      return g;
    }

    function shelfPitch(o, shelves, H) {
      const p = paramsOf(o);
      return num(p.shelf_pitch_m, Math.max(0.35, (H - 0.5) / Math.max(shelves, 1)));
    }
    function shelfY(si, pitch, base) {
      return (base == null ? 0.38 : base) + si * pitch;
    }

    function buildShelfLight(root, o) {
      const W = num(o.width_m, 2.7);
      const D = num(o.depth_m, 0.95);
      const H = num(o.height_m, 2.4);
      const p = paramsOf(o);
      const shelves = parseInt(p.shelf_count || 4, 10);
      const places = Math.max(1, parseInt(p.places_per_shelf || 2, 10));
      const pitch = shelfPitch(o, shelves, H);
      const base = 0.38;
      const fills = Array.isArray(p.fill) ? p.fill : null;
      const tall = new THREE.Group();
      tall.userData.tall = true;
      root.add(tall);

      const postW = 0.07;
      const posts = [[-W / 2, D / 2], [W / 2, D / 2], [-W / 2, -D / 2], [W / 2, -D / 2]];
      posts.forEach(([x, z]) => {
        const post = box(M.upright, postW, H, postW, x, H / 2, z, tall);
        post.castShadow = true;
        box(M.dark, 0.14, 0.03, 0.14, x, 0.015, z, tall, false);
      });
      [-W / 2, W / 2].forEach((x) => {
        for (let i = 0; i < 2; i++) {
          const y0 = 0.4 + i * (H / 2.5);
          const brace = new THREE.Mesh(new THREE.BoxGeometry(0.025, H / 2.2, 0.025), M.upright);
          brace.position.set(x, y0 + H / 4.5, 0);
          brace.rotation.x = (i % 2 ? 1 : -1) * 0.55;
          tall.add(brace);
        }
      });
      box(M.dark, W - 0.1, H - 0.15, 0.03, 0, H / 2, -D / 2 + 0.02, tall, false);
      box(M.beam, W + 0.1, 0.08, D + 0.08, 0, H + 0.02, 0, tall);

      const codeLab = addLabel(
        '<b style="font-size:12px">' + (o.code || ('#' + o.id)) + '</b>',
        root.position.x, H + 0.45, root.position.z + D / 2,
        { always: true, worldPos: true, objectId: o.id }
      );
      codeLab._local = { parent: root, ox: 0, oy: H + 0.38, oz: D / 2 + 0.08 };
      root.userData._codeLab = codeLab;

      for (let si = 0; si < shelves; si++) {
        const y = shelfY(si, pitch, base);
        [-D / 2 + 0.06, D / 2 - 0.06].forEach((z) => {
          box(M.beam, W - 0.08, 0.06, 0.05, 0, y, z, tall);
        });
        box(M.deck, W - 0.12, 0.025, D - 0.14, 0, y + 0.035, 0, tall, false);

        const shLab = addLabel(
          'полка ' + (LETTERS[si] || si),
          root.position.x, y + 0.05, root.position.z + D / 2,
          { frontOnly: true, opacity: 0, worldPos: true, objectId: o.id }
        );
        shLab._local = { parent: root, ox: 0, oy: y + 0.42, oz: D / 2 + 0.12 };
        root.userData._shelfLabs = root.userData._shelfLabs || [];
        root.userData._shelfLabs.push(shLab);

        const hl = new THREE.Mesh(
          new THREE.PlaneGeometry(W - 0.05, 0.72),
          new THREE.MeshBasicMaterial({
            color: 0xd4a843, transparent: true, opacity: 0.42,
            depthWrite: false, depthTest: false, side: THREE.DoubleSide
          })
        );
        hl.position.set(0, y + 0.36, D / 2 + 0.2);
        hl.visible = false;
        hl.renderOrder = 20;
        hl.userData.shelfHL = true;
        hl.userData.shelfIdx = si;
        tall.add(hl);

        const gap = 0.04;
        const usable = W - 0.2;
        const sw = (usable - gap * (places - 1)) / places;
        for (let pi = 0; pi < places; pi++) {
          const x0 = -usable / 2 + sw / 2 + pi * (sw + gap);
          if (pi > 0) {
            box(M.dark, 0.02, 0.42, D - 0.2, x0 - sw / 2 - gap / 2, y + 0.28, 0, tall, false);
          }
          const fill = fills && fills[si] && fills[si][pi] != null
            ? num(fills[si][pi], 0.35)
            : 0.18 + ((si * 3 + pi * 7 + (o.id || 0)) % 70) / 100;
          const tote = makeTote(fill, sw * 0.9, D * 0.55, 0.34);
          tote.position.set(x0, y + 0.05, 0);
          tote.userData._oid = o.id;
          if (tote.userData._pctLabel) {
            const lab = tote.userData._pctLabel;
            lab.objectId = o.id;
            lab._local = { parent: tote, ox: 0, oy: H * 0.55, oz: D * 0.55 / 2 + 0.01 };
          }
          tall.add(tote);

          const hit = new THREE.Mesh(
            new THREE.BoxGeometry(sw, 0.55, D - 0.1),
            new THREE.MeshBasicMaterial({ visible: false })
          );
          hit.position.set(x0, y + 0.32, 0);
          hit.userData = { kind: 'place', id: o.id, shelfIdx: si, placeIdx: pi };
          tall.add(hit);
          clickables.push(hit);
        }
      }

      root.userData.dims = { W, D, H, shelves, places, pitch, base };
      finalizeObjectGlow(root);
      const proxy = box(new THREE.MeshBasicMaterial({ visible: false }), W, Math.max(H, 1), D, 0, Math.max(H, 1) / 2, 0, root, false);
      proxy.userData = { kind: 'object', id: o.id };
      clickables.push(proxy);
    }

    function buildShelfPallet(root, o) {
      const W = num(o.width_m, 2.8);
      const D = num(o.depth_m, 1.2);
      const H = num(o.height_m, 3.5);
      const p = paramsOf(o);
      const levels = parseInt(p.pallet_levels || 3, 10);
      const slots = Math.max(1, parseInt(p.slots_per_level || 2, 10));
      const tall = new THREE.Group();
      tall.userData.tall = true;
      root.add(tall);
      [[-W / 2, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2]].forEach(([x, z]) => {
        box(M.upright, 0.09, H, 0.09, x, H / 2, z, tall);
        box(M.dark, 0.16, 0.04, 0.16, x, 0.02, z, tall, false);
      });
      // X-раскосы на торцах (как в прототипе)
      [-W / 2, W / 2].forEach((x) => {
        for (let i = 0; i < 2; i++) {
          const y0 = 0.35 + i * (H / 2.4);
          const brace = new THREE.Mesh(new THREE.BoxGeometry(0.028, H / 2.1, 0.028), M.upright);
          brace.position.set(x, y0 + H / 4.4, 0);
          brace.rotation.x = (i % 2 ? 1 : -1) * 0.55;
          tall.add(brace);
        }
      });
      box(M.beam, W + 0.1, 0.1, D + 0.08, 0, H + 0.02, 0, tall);
      // задняя панель — читается объём на фасаде
      box(M.dark, W - 0.12, H - 0.2, 0.035, 0, H / 2, -D / 2 + 0.02, tall, false);
      for (let li = 0; li < levels; li++) {
        const y = 0.25 + li * ((H - 0.5) / Math.max(levels, 1));
        box(M.beam, W, 0.1, 0.1, 0, y, -D / 2 + 0.06, tall);
        box(M.beam, W, 0.1, 0.1, 0, y, D / 2 - 0.06, tall);
        // wire deck: прутки, не сплошной брус
        const bars = 9;
        for (let bi = 0; bi < bars; bi++) {
          const zz = -D / 2 + 0.12 + bi * ((D - 0.24) / Math.max(bars - 1, 1));
          box(M.deck, W - 0.16, 0.014, 0.028, 0, y + 0.08, zz, tall, false);
        }
        for (let xi = 0; xi < 4; xi++) {
          const xx = -W / 2 + 0.2 + xi * ((W - 0.4) / 3);
          box(M.dark, 0.022, 0.014, D - 0.18, xx, y + 0.088, 0, tall, false);
        }
        const hl = new THREE.Mesh(
          new THREE.PlaneGeometry(W - 0.05, 0.9),
          new THREE.MeshBasicMaterial({
            color: 0xd4a843, transparent: true, opacity: 0.22,
            depthWrite: false, depthTest: false, side: THREE.DoubleSide
          })
        );
        hl.position.set(0, y + 0.45, D / 2 + 0.25);
        hl.visible = false;
        hl.renderOrder = 20;
        hl.userData.shelfHL = true;
        hl.userData.shelfIdx = li;
        tall.add(hl);
        const sw = W / slots;
        for (let si = 0; si < slots; si++) {
          const x = -W / 2 + sw / 2 + si * sw;
          // паллета: 3 доски + поперечины (не монолитный брус)
          const pw = sw * 0.78;
          const pd = D * 0.68;
          [-0.32, 0, 0.32].forEach((fx) => {
            box(M.pallet, pw * 0.28, 0.045, pd, x + fx * pw * 0.55, y + 0.14, 0, tall);
          });
          box(M.pallet, pw, 0.035, pd * 0.18, x, y + 0.11, -pd * 0.35, tall, false);
          box(M.pallet, pw, 0.035, pd * 0.18, x, y + 0.11, pd * 0.35, tall, false);
          // контейнер с уровнем загрузки (не монолитный «синий брусок»)
          const fill = 0.22 + (((o.id || 0) + li * 5 + si * 3) % 70) / 100;
          const tote = makeTote(fill, pw * 0.86, pd * 0.7, 0.46);
          tote.position.set(x, y + 0.155, 0);
          tote.userData._oid = o.id;
          if (tote.userData._pctLabel) {
            const lab = tote.userData._pctLabel;
            lab.objectId = o.id;
            lab._local = { parent: tote, ox: 0, oy: 0.28, oz: pd * 0.38 };
          }
          tall.add(tote);
          const hit = new THREE.Mesh(
            new THREE.BoxGeometry(sw * 0.9, 0.7, D * 0.85),
            new THREE.MeshBasicMaterial({ visible: false })
          );
          hit.position.set(x, y + 0.4, 0);
          hit.userData = { kind: 'place', id: o.id, shelfIdx: li, placeIdx: si };
          tall.add(hit);
          clickables.push(hit);
        }
      }
      root.userData.dims = { W, D, H, shelves: levels, places: slots, pitch: (H - 0.5) / Math.max(levels, 1), base: 0.25 };
      addLabel('<b>' + (o.code || o.id) + '</b>', root.position.x, H + 0.4, root.position.z + D / 2,
        { always: true, worldPos: true, objectId: o.id });
      finalizeObjectGlow(root);
      const proxy = box(new THREE.MeshBasicMaterial({ visible: false }), W, H, D, 0, H / 2, 0, root, false);
      proxy.userData = { kind: 'object', id: o.id };
      clickables.push(proxy);
    }

    function buildClothing(root, o) {
      const W = num(o.width_m, 3.5);
      const D = num(o.depth_m, 0.7);
      const H = num(o.height_m, 2.1);
      const secs = Math.max(1, parseInt(paramsOf(o).clothing_sections || 6, 10));
      const tall = new THREE.Group();
      tall.userData.tall = true;
      root.add(tall);
      box(M.cloth, 0.06, H, 0.06, -W / 2, H / 2, 0, tall);
      box(M.cloth, 0.06, H, 0.06, W / 2, H / 2, 0, tall);
      box(M.cloth, W, 0.05, 0.05, 0, H * 0.82, 0, tall);
      const sw = W / secs;
      for (let i = 0; i < secs; i++) {
        const x = -W / 2 + sw / 2 + i * sw;
        box(M.dark, 0.04, H * 0.45, 0.04, x, H * 0.55, 0.05, tall);
        box(new THREE.MeshStandardMaterial({ color: 0x3d4a5c, roughness: 0.8 }), sw * 0.35, 0.55, 0.08, x, H * 0.45, 0.12, tall, false);
        const hit = new THREE.Mesh(
          new THREE.BoxGeometry(sw * 0.9, H * 0.7, D),
          new THREE.MeshBasicMaterial({ visible: false })
        );
        hit.position.set(x, H * 0.45, 0);
        hit.userData = { kind: 'place', id: o.id, shelfIdx: 0, placeIdx: i };
        tall.add(hit);
        clickables.push(hit);
      }
      const hl = new THREE.Mesh(
        new THREE.PlaneGeometry(W - 0.05, 0.9),
        new THREE.MeshBasicMaterial({
          color: 0xd4a843, transparent: true, opacity: 0.4,
          depthWrite: false, depthTest: false, side: THREE.DoubleSide
        })
      );
      hl.position.set(0, H * 0.5, D / 2 + 0.15);
      hl.visible = false;
      hl.renderOrder = 20;
      hl.userData.shelfHL = true;
      hl.userData.shelfIdx = 0;
      tall.add(hl);
      root.userData.dims = { W, D, H, shelves: 1, places: secs, pitch: H, base: 0 };
      addLabel('<b>' + (o.code || o.id) + '</b>', root.position.x, H + 0.35, root.position.z,
        { always: true, worldPos: true, objectId: o.id });
      finalizeObjectGlow(root);
      const proxy = box(new THREE.MeshBasicMaterial({ visible: false }), W, H, D, 0, H / 2, 0, root, false);
      proxy.userData = { kind: 'object', id: o.id };
      clickables.push(proxy);
    }

    function buildFloorZone(root, o) {
      const W = num(o.width_m, 4);
      const D = num(o.depth_m, 3);
      const tall = new THREE.Group();
      tall.userData.tall = true;
      root.add(tall);
      const z = box(M.zone, W, 0.04, D, 0, 0.06, 0, tall, false);
      const edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(W, 0.02, D)),
        new THREE.LineBasicMaterial({ color: 0xc9a84c })
      );
      edge.position.y = 0.09;
      tall.add(edge);
      root.userData.dims = { W, D, H: 0.2, shelves: 1, places: 1, pitch: 0.2, base: 0 };
      addLabel('<b>' + (o.code || o.id) + '</b>', root.position.x, 0.5, root.position.z,
        { always: true, worldPos: true, objectId: o.id });
      finalizeObjectGlow(root);
      z.userData = { kind: 'object', id: o.id };
      clickables.push(z);
    }

    function buildScrap(root, o) {
      const W = num(o.width_m, 2);
      const D = num(o.depth_m, 1.5);
      const H = num(o.height_m, 1.2);
      const tall = new THREE.Group();
      tall.userData.tall = true;
      root.add(tall);
      box(M.scrap, W, 0.08, D, 0, 0.04, 0, tall, false);
      box(M.scrap, 0.08, H, D, -W / 2, H / 2, 0, tall);
      box(M.scrap, 0.08, H, D, W / 2, H / 2, 0, tall);
      box(M.scrap, W, H, 0.08, 0, H / 2, -D / 2, tall);
      for (let i = 0; i < 4; i++) {
        box(M.dark, 0.25 + Math.random() * 0.4, 0.15 + Math.random() * 0.25, 0.2,
          (Math.random() - 0.5) * W * 0.5, 0.2 + Math.random() * 0.4, (Math.random() - 0.5) * D * 0.4, tall, false);
      }
      root.userData.dims = { W, D, H, shelves: 1, places: 1, pitch: H, base: 0 };
      addLabel('<b>' + (o.code || o.id) + '</b>', root.position.x, H + 0.3, root.position.z,
        { always: true, worldPos: true, objectId: o.id });
      finalizeObjectGlow(root);
      const proxy = box(new THREE.MeshBasicMaterial({ visible: false }), W, H, D, 0, H / 2, 0, root, false);
      proxy.userData = { kind: 'object', id: o.id };
      clickables.push(proxy);
    }

    function buildWorkbench(root, o) {
      const W = num(o.width_m, 1.8);
      const D = num(o.depth_m, 0.8);
      const H = num(o.height_m, 0.9);
      const tall = new THREE.Group();
      tall.userData.tall = true;
      root.add(tall);
      box(M.wood, W, 0.08, D, 0, H, 0, tall);
      [[-W / 2 + 0.1, -D / 2 + 0.1], [W / 2 - 0.1, -D / 2 + 0.1], [-W / 2 + 0.1, D / 2 - 0.1], [W / 2 - 0.1, D / 2 - 0.1]].forEach(([x, z]) => {
        box(M.dark, 0.08, H, 0.08, x, H / 2, z, tall);
      });
      box(M.dark, W * 0.9, 0.35, D * 0.7, 0, 0.25, 0, tall, false);
      root.userData.dims = { W, D, H, shelves: 1, places: 1, pitch: H, base: 0 };
      addLabel('<b>' + (o.code || o.id) + '</b>', root.position.x, H + 0.35, root.position.z,
        { always: true, worldPos: true, objectId: o.id });
      finalizeObjectGlow(root);
      const proxy = box(new THREE.MeshBasicMaterial({ visible: false }), W, H, D, 0, H / 2, 0, root, false);
      proxy.userData = { kind: 'object', id: o.id };
      clickables.push(proxy);
    }

    function buildMachine(root, o) {
      const W = num(o.width_m, 2.2);
      const D = num(o.depth_m, 1.4);
      const H = num(o.height_m, 2);
      const tall = new THREE.Group();
      tall.userData.tall = true;
      root.add(tall);
      box(M.machine, W * 0.9, H * 0.7, D * 0.85, 0, H * 0.4, 0, tall);
      box(M.beam, W * 0.4, 0.2, D * 0.3, 0, H * 0.85, 0, tall);
      box(M.dark, W * 0.95, 0.08, D * 0.95, 0, 0.04, 0, tall, false);
      root.userData.dims = { W, D, H, shelves: 1, places: 1, pitch: H, base: 0 };
      addLabel('<b>' + (o.code || o.id) + '</b>', root.position.x, H + 0.35, root.position.z,
        { always: true, worldPos: true, objectId: o.id });
      finalizeObjectGlow(root);
      const proxy = box(new THREE.MeshBasicMaterial({ visible: false }), W, H, D, 0, H / 2, 0, root, false);
      proxy.userData = { kind: 'object', id: o.id };
      clickables.push(proxy);
    }

    function buildAssemblyPallet(root, o) {
      const W = num(o.width_m, 1.2);
      const D = num(o.depth_m, 1);
      const H = num(o.height_m, 0.3);
      const tall = new THREE.Group();
      tall.userData.tall = true;
      root.add(tall);
      box(M.pallet, W, 0.12, D, 0, 0.1, 0, tall);
      box(M.dark, W * 0.9, 0.35, D * 0.9, 0, 0.35, 0, tall, false);
      root.userData.dims = { W, D, H: 0.8, shelves: 1, places: 1, pitch: 0.8, base: 0 };
      addLabel('<b>' + (o.code || o.id) + '</b>', root.position.x, 0.85, root.position.z,
        { always: true, worldPos: true, objectId: o.id });
      finalizeObjectGlow(root);
      const proxy = box(new THREE.MeshBasicMaterial({ visible: false }), W, 0.8, D, 0, 0.4, 0, root, false);
      proxy.userData = { kind: 'object', id: o.id };
      clickables.push(proxy);
    }

    const BUILDERS = {
      shelf_light: buildShelfLight,
      shelf_pallet: buildShelfPallet,
      clothing: buildClothing,
      floor_zone: buildFloorZone,
      scrap: buildScrap,
      workbench: buildWorkbench,
      machine: buildMachine,
      assembly_pallet: buildAssemblyPallet
    };

    function avgFill(o) {
      const p = paramsOf(o);
      if (Array.isArray(p.fill)) {
        const flat = p.fill.flat();
        if (flat.length) return flat.reduce((a, b) => a + num(b, 0), 0) / flat.length;
      }
      return 0.35 + ((o.id || 0) % 40) / 100;
    }

    function buildObject(o, keepPlan) {
      const root = new THREE.Group();
      const dims = rackDims(o);
      root.position.set(num(o.x_m, 0), 0, num(o.z_m, 0));
      root.rotation.y = dims.rot;
      const p = paramsOf(o);
      const shelves = parseInt((p.shelf_count || 4), 10);
      const places = Math.max(1, parseInt((p.places_per_shelf || 2), 10));
      const pitch = shelfPitch(o, shelves, dims.H);
      root.userData = {
        object: o,
        id: o.id,
        dims: { W: dims.W, D: dims.D, H: dims.H, shelves, places, pitch, base: 0.38, rot: dims.rot }
      };
      const oN = Object.assign({}, o, {
        width_m: dims.W,
        depth_m: dims.D,
        height_m: dims.H,
        rot_deg: dims.rotDeg
      });
      const fn = BUILDERS[o.object_type] || buildShelfLight;
      fn(root, oN);

      const avg = avgFill(o);
      const baseCol = typePlanCol(o.object_type, avg);
      // тень под плитой — объём на плане, не «наклейка»
      const slabShadow = new THREE.Mesh(
        new THREE.BoxGeometry(dims.W + 0.18, 0.02, dims.D + 0.18),
        new THREE.MeshBasicMaterial({ color: 0x05070c, transparent: true, opacity: 0.45, depthWrite: false })
      );
      slabShadow.position.set(0.04, 0.035, 0.04);
      slabShadow.userData.planSlab = true;
      root.add(slabShadow);
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(dims.W, 0.1, dims.D),
        new THREE.MeshStandardMaterial({
          color: baseCol, roughness: 0.72, metalness: 0.2,
          emissive: baseCol, emissiveIntensity: avg > 0.55 ? 0.16 : 0.08
        })
      );
      slab.position.y = 0.06;
      slab.userData.planSlab = true;
      root.add(slab);
      // полоска заполнения на торце — читается как индикатор, не «цветное пятно»
      const barW = Math.max(0.12, dims.W * Math.min(1, Math.max(0.12, avg)));
      const fillBar = new THREE.Mesh(
        new THREE.BoxGeometry(barW, 0.04, 0.06),
        new THREE.MeshBasicMaterial({
          color: avg < 0.2 ? 0x6a7a90 : avg < 0.65 ? 0xc9a84c : 0xc07060,
          transparent: true, opacity: 0.95
        })
      );
      fillBar.position.set(-dims.W / 2 + barW / 2 + 0.04, 0.13, dims.D / 2 + 0.02);
      fillBar.userData.planSlab = true;
      root.add(fillBar);
      // тонкая цветная «метка типа» на левом краю
      const typeMark = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.05, Math.max(0.25, dims.D * 0.55)),
        new THREE.MeshBasicMaterial({ color: baseCol, transparent: true, opacity: 0.95 })
      );
      typeMark.position.set(-dims.W / 2 - 0.02, 0.12, 0);
      typeMark.userData.planSlab = true;
      root.add(typeMark);
      // обводка на плане — читается как архитектура, не «цветные пятна»
      const slabEdge = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(dims.W + 0.02, 0.02, dims.D + 0.02)),
        new THREE.LineBasicMaterial({ color: 0xe8f0fa, transparent: true, opacity: 0.88 })
      );
      slabEdge.position.y = 0.14;
      slabEdge.userData.planSlab = true;
      root.add(slabEdge);
      // рамка выбора на плане (включается в setRackGlow)
      const selPad = new THREE.Mesh(
        new THREE.BoxGeometry(dims.W + 0.22, 0.018, dims.D + 0.22),
        new THREE.MeshBasicMaterial({ color: 0xc9a84c, transparent: true, opacity: 0, depthWrite: false })
      );
      selPad.position.y = 0.155;
      selPad.userData = { planSlab: true, planSelRing: true };
      root.add(selPad);
      const selEdge = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(dims.W + 0.24, 0.02, dims.D + 0.24)),
        new THREE.LineBasicMaterial({ color: 0xf0d078, transparent: true, opacity: 0 })
      );
      selEdge.position.y = 0.17;
      selEdge.userData = { planSlab: true, planSelRing: true };
      root.add(selEdge);

      const planNum = addLabel(
        '<b style="font-size:12px">' + (o.code || o.id) + '</b>',
        root.position.x, 0.35, root.position.z,
        { cls: 'whm__lab--plan', planOnly: true, worldPos: true, objectId: o.id }
      );
      planNum._local = { parent: root, ox: 0, oy: 0.42, oz: 0 };
      root.userData._planLab = planNum;

      world.add(root);
      objectRoots.set(o.id, root);
      setPlan(root, keepPlan != null ? keepPlan : !mode3d);
      return root;
    }

    function removeObjectMesh(id) {
      const root = objectRoots.get(id);
      if (!root) return;
      for (let i = clickables.length - 1; i >= 0; i--) {
        let p = clickables[i];
        let hit = false;
        while (p) {
          if (p === root) { hit = true; break; }
          p = p.parent;
        }
        if (hit) clickables.splice(i, 1);
      }
      for (let i = labels.length - 1; i >= 0; i--) {
        if (labels[i].objectId === id) {
          labels[i].el.remove();
          labels.splice(i, 1);
        }
      }
      world.remove(root);
      disposeObject3D(root);
      objectRoots.delete(id);
    }

    function rebuildObjectLive(o) {
      const wasPlan = !mode3d;
      const glowOn = selectedId === o.id;
      removeObjectMesh(o.id);
      buildObject(o, wasPlan);
      if (glowOn) setRackGlow(o.id, true);
      syncLabelVisibility();
    }

    function setPlan(root, plan) {
      root.traverse((o) => {
        if (o.userData && o.userData.tall) o.visible = !plan;
        if (o.userData && o.userData.planSlab) o.visible = plan;
      });
    }

    function syncLabelVisibility() {
      labels.forEach((l) => {
        let show = true;
        if (l.planOnly) show = !mode3d;
        if (l.always) show = mode3d && !frontMode ? true : (frontMode ? (l.objectId === isolateId) : mode3d);
        if (l.frontOnly) show = frontMode && l.objectId === isolateId;
        if (frontMode && isolateId != null && l.objectId != null && l.objectId !== isolateId) show = false;
        if (l._forceHide) show = false;
        l.el.style.opacity = show ? (l.frontOnly && !frontMode ? '0' : (l._baseOp != null ? l._baseOp : '1')) : '0';
        if (l.frontOnly) l.el.style.opacity = (frontMode && l.objectId === isolateId) ? '1' : '0';
        if (l.planOnly) {
          // коды мест на плане — только выбранный (класс whm__lab--on), иначе шум
          const on = l.el.classList.contains('whm__lab--on');
          l.el.style.opacity = (!mode3d && !frontMode && on) ? '1' : '0';
        }
        if (l.always && !l.frontOnly) {
          if (l.objectId != null) {
            // код стеллажа — в 3D / фасаде выбранного
            l.el.style.opacity = (mode3d && (!frontMode || l.objectId === isolateId)) ? '1' : '0';
          } else {
            // глобальные (ДВЕРЬ) — план и 3D, прячем только на фасаде
            l.el.style.opacity = frontMode ? '0' : '1';
          }
        }
      });
    }

    function setWorldPlan(plan) {
      mode3d = !plan;
      frontMode = false;
      isolateId = null;
      if (facadeStage) facadeStage.visible = false;
      setFacadeLights(false);
      if (hostEl) hostEl.classList.remove('whm--facade');
      objectRoots.forEach((r) => {
        r.visible = true;
        setPlan(r, plan);
      });
      walls.forEach((w) => {
        // в плане высокие стены почти не видны сверху — прячем, контур на полу
        w.visible = !plan;
        if (!plan && w.userData._clonedMat) {
          w.material = w.userData._origMat || M.wall;
          delete w.userData._clonedMat;
          delete w.userData._origMat;
        }
        if (!plan && w.material) {
          w.material.transparent = false;
          w.material.opacity = 1;
        }
      });
      planFoots.forEach((f) => { f.visible = !!plan; });
      if (gridHelper) gridHelper.visible = plan;
      if (floorMesh) floorMesh.visible = true;
      if (!scene.fog) scene.fog = new THREE.Fog(0x12151b, 45, 75);
      scene.fog.near = plan ? 55 : 30;
      scene.fog.far = plan ? 95 : 58;
      scene.fog.color.setHex(plan ? 0x10141c : 0x12151b);
      scene.background = new THREE.Color(plan ? 0x10141c : 0x12151b);
      spot.intensity = 0;
      renderer.toneMappingExposure = 1.02;
      setPill(plan);
      syncLabelVisibility();
      updateModeBtns();
    }

    function ensureFacadeStage(obj) {
      // Фасад — пустой фон + стеллаж. Никаких площадок, стен, теней-«полов».
      if (!facadeStage) {
        facadeStage = new THREE.Group();
        facadeStage.name = 'facadeStage';
        world.add(facadeStage);
      }
      while (facadeStage.children.length) {
        const c = facadeStage.children.pop();
        c.geometry?.dispose?.();
        if (c.material) {
          if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose?.());
          else c.material.dispose?.();
        }
      }
      const g = rackGeom(obj);
      facadeStage.visible = true;
      setFacadeLights(true, g);
    }

    function isolate(objId) {
      isolateId = objId;
      frontMode = true;
      mode3d = true;
      selectedId = objId;
      const obj = objects.find((o) => o.id === objId);
      if (obj) ensureFacadeStage(obj);
      else setFacadeLights(false);
      objectRoots.forEach((r, id) => {
        r.visible = id === objId;
        if (id === objId) {
          setPlan(r, false);
          r.traverse((o) => {
            if (o.userData && o.userData.planSlab) o.visible = false;
          });
          applyRackPulse(r, true);
        } else {
          applyRackPulse(r, false);
        }
      });
      // фасад: спрятать ВСЁ окружение склада (стены, плинтус, пол, сетка…)
      const rackSet = new Set(objectRoots.values());
      world.children.forEach((ch) => {
        if (rackSet.has(ch)) return;
        if (ch === facadeStage || ch.name === 'facadeStage') return;
        if (ch.isLight) return;
        ch.visible = false;
      });
      walls.forEach((w) => { w.visible = false; });
      planFoots.forEach((f) => { f.visible = false; });
      if (gridHelper) gridHelper.visible = false;
      if (floorMesh) floorMesh.visible = false;
      clearPath();
      clearRings();
      setPill(false);
      syncLabelVisibility();
      updateModeBtns();
      if (hostEl) hostEl.classList.add('whm--facade');
      // spot уже ставит setFacadeLights
    }

    function showWorld() {
      frontMode = false;
      isolateId = null;
      spot.intensity = 0;
      setFacadeLights(false);
      if (hostEl) hostEl.classList.remove('whm--facade');
      clearPath();
      clearRings();
      clearFind();
      setWorldPlan(true);
      fitOrtho();
    }

    function setRackGlow(objId, on) {
      objectRoots.forEach((root, id) => {
        const active = on && id === objId;
        applyRackPulse(root, active);
        // plan-slab only used in 2D; never paint a green "box" under the 3D mesh
        root.traverse((o) => {
          if (!(o.userData && o.userData.planSlab && o.material)) return;
          if (o.userData.planSelRing) {
            if (!o.userData._matCloned) {
              o.material = o.material.clone();
              o.userData._matCloned = true;
            }
            if (o.material.opacity != null) {
              o.material.opacity = (active && !mode3d && !frontMode) ? (o.isLineSegments ? 0.95 : 0.55) : 0;
            }
            return;
          }
          if (!o.material.emissive) return;
          if (!o.userData._matCloned) {
            o.material = o.material.clone();
            o.userData._matCloned = true;
            o.material.transparent = true;
            if (o.material.opacity == null) o.material.opacity = 1;
          }
          // затемнить остальные стеллажи на плане при выборе
          if (on && !active && !mode3d && !frontMode) {
            if (!o.userData._slabDimBackup) {
              o.userData._slabDimBackup = {
                color: o.material.color.clone(),
                ei: o.material.emissiveIntensity != null ? o.material.emissiveIntensity : 0,
                opacity: o.material.opacity != null ? o.material.opacity : 1
              };
            }
            o.material.color.copy(o.userData._slabDimBackup.color).multiplyScalar(0.55);
            o.material.emissiveIntensity = 0.02;
            o.material.opacity = 0.42;
            o.userData.pulseSlab = false;
            return;
          }
          if (o.userData._slabDimBackup && (!on || active)) {
            o.material.color.copy(o.userData._slabDimBackup.color);
            o.material.emissiveIntensity = o.userData._slabDimBackup.ei;
            o.material.opacity = o.userData._slabDimBackup.opacity;
            delete o.userData._slabDimBackup;
          }
          if (active && !mode3d && !frontMode) {
            if (!o.userData._slabBackup) {
              o.userData._slabBackup = {
                color: o.material.color.clone(),
                emissive: o.material.emissive.clone(),
                ei: o.material.emissiveIntensity != null ? o.material.emissiveIntensity : 0,
                opacity: o.material.opacity != null ? o.material.opacity : 1
              };
            }
            // 2D: gold pulse (CRM token), not neon green box
            o.material.color.setHex(0xd4a843);
            o.material.emissive.setHex(0xd4a843);
            o.material.emissiveIntensity = 0.55;
            o.material.opacity = 1;
            o.userData.pulseSlab = true;
          } else if (o.userData._slabBackup) {
            o.material.color.copy(o.userData._slabBackup.color);
            o.material.emissive.copy(o.userData._slabBackup.emissive);
            o.material.emissiveIntensity = o.userData._slabBackup.ei;
            o.material.opacity = o.userData._slabBackup.opacity;
            o.userData.pulseSlab = false;
            delete o.userData._slabBackup;
          } else {
            o.userData.pulseSlab = false;
          }
        });
        const planLab = root.userData._planLab;
        if (planLab && planLab.el) {
          planLab.el.classList.toggle('whm__lab--on', !!(active && !mode3d && !frontMode));
        }
      });
      syncLabelVisibility();
    }

    function clearRings() {
      objectRoots.forEach((root) => applyRackPulse(root, false));
      objectRoots.forEach((_, id) => setRackGlow(id, false));
    }

    function nearestAisleX(x, aisleX, doorX) {
      const ax = aisleX && aisleX.length ? aisleX : [doorX];
      return ax.reduce((best, v) => Math.abs(v - x) < Math.abs(best - x) ? v : best, ax[0]);
    }

    function pathWaypoints(obj) {
      const s = shell || { door: { x: 0, z: 7 }, aisleX: [], aisleZ: [] };
      const door = s.door;
      const aisleX = s.aisleX || [];
      const aisleZ = s.aisleZ || [];
      const y = 0.13;
      const g = rackGeom(obj);
      const doorPt = new THREE.Vector3(door.x, y, door.z);
      const facePt = new THREE.Vector3(g.faceX, y, g.faceZ);
      const approach = new THREE.Vector3(g.approachX, y, g.approachZ);

      // Проходы: к двери → вдоль aisle_x → к поперечному aisle ближе к фасаду → подход → фасад
      const doorSpine = nearestAisleX(door.x, aisleX, door.x);
      const rackAisle = nearestAisleX(g.approachX, aisleX, doorSpine);

      let viaZ = g.approachZ;
      if (aisleZ.length) {
        // ближайший поперечный проход на стороне фасада (не за стеллажом)
        const faceSide = aisleZ.filter((v) => (v - g.rz) * g.fnz >= -0.15);
        const pool = faceSide.length ? faceSide : aisleZ;
        viaZ = pool.reduce((best, v) => Math.abs(v - g.approachZ) < Math.abs(best - g.approachZ) ? v : best, pool[0]);
      }

      const pts = [doorPt];
      if (Math.abs(door.x - doorSpine) > 0.12) pts.push(new THREE.Vector3(doorSpine, y, door.z));
      pts.push(new THREE.Vector3(doorSpine, y, viaZ));
      if (Math.abs(doorSpine - rackAisle) > 0.12) pts.push(new THREE.Vector3(rackAisle, y, viaZ));
      pts.push(new THREE.Vector3(approach.x, y, viaZ));
      if (Math.abs(viaZ - approach.z) > 0.12 || Math.abs(approach.x - g.faceX) > 0.12) {
        pts.push(approach.clone());
      }
      pts.push(facePt);

      const clean = [pts[0]];
      for (let i = 1; i < pts.length; i++) {
        if (clean[clean.length - 1].distanceTo(pts[i]) > 0.12) clean.push(pts[i]);
      }
      return clean;
    }

    function smoothNavigatorPath(waypoints, spacing) {
      spacing = spacing || 0.12;
      if (waypoints.length < 2) return waypoints.map((p) => p.clone());
      const R = 0.55;
      const out = [waypoints[0].clone()];

      function lineTo(target) {
        const from = out[out.length - 1];
        const dist = from.distanceTo(target);
        if (dist < 0.01) return;
        const nSeg = Math.max(1, Math.round(dist / spacing));
        for (let s = 1; s <= nSeg; s++) out.push(from.clone().lerp(target, s / nSeg));
      }

      for (let i = 1; i < waypoints.length - 1; i++) {
        const prev = waypoints[i - 1];
        const cur = waypoints[i];
        const next = waypoints[i + 1];
        const d1 = new THREE.Vector3().subVectors(cur, prev);
        const d2 = new THREE.Vector3().subVectors(next, cur);
        const len1 = d1.length();
        const len2 = d2.length();
        d1.normalize();
        d2.normalize();
        const r = Math.min(R, len1 * 0.42, len2 * 0.42);
        const a = cur.clone().addScaledVector(d1, -r);
        const b = cur.clone().addScaledVector(d2, r);
        lineTo(a);
        const arcN = Math.max(10, Math.round((Math.PI / 2) * r / (spacing * 0.7)));
        for (let s = 1; s <= arcN; s++) {
          const t = s / arcN;
          out.push(new THREE.Vector3()
            .addScaledVector(a, (1 - t) * (1 - t))
            .addScaledVector(cur, 2 * (1 - t) * t)
            .addScaledVector(b, t * t));
        }
      }
      lineTo(waypoints[waypoints.length - 1]);
      return out;
    }

    function makeFloorChevron(dir) {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0.18);
      shape.lineTo(0.11, -0.1);
      shape.lineTo(0, -0.03);
      shape.lineTo(-0.11, -0.1);
      shape.closePath();
      const m = new THREE.Mesh(
        new THREE.ShapeGeometry(shape),
        new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
      );
      m.rotation.x = -Math.PI / 2;
      m.rotation.y = Math.atan2(dir.x, dir.z);
      return m;
    }

    function ribbonGeo(slice, halfW) {
      const n = slice.length;
      const pos = new Float32Array(n * 2 * 3);
      const idx = [];
      for (let i = 0; i < n; i++) {
        const p = slice[i];
        const prev = slice[Math.max(0, i - 1)];
        const next = slice[Math.min(n - 1, i + 1)];
        const dir = new THREE.Vector3(next.x - prev.x, 0, next.z - prev.z);
        if (dir.lengthSq() < 1e-8) dir.set(1, 0, 0);
        else dir.normalize();
        const px = -dir.z * halfW;
        const pz = dir.x * halfW;
        pos[(i * 2) * 3] = p.x + px;
        pos[(i * 2) * 3 + 1] = p.y;
        pos[(i * 2) * 3 + 2] = p.z + pz;
        pos[(i * 2 + 1) * 3] = p.x - px;
        pos[(i * 2 + 1) * 3 + 1] = p.y;
        pos[(i * 2 + 1) * 3 + 2] = p.z - pz;
        if (i < n - 1) {
          const a = i * 2;
          const b = a + 1;
          const c = a + 2;
          const d = a + 3;
          idx.push(a, b, c, b, d, c);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setIndex(idx);
      return g;
    }

    function drawRouteAnimated(waypoints, highlightId, duration) {
      clearPath();
      const pts = smoothNavigatorPath(waypoints, 0.06).map((p) => new THREE.Vector3(p.x, 0.12, p.z));
      if (pts.length < 2) return Promise.resolve();
      duration = duration || 2200;

      const glowMat = new THREE.MeshBasicMaterial({
        color: 0xc9a84c, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide
      });
      const roadMat = new THREE.MeshBasicMaterial({
        color: 0xe8c86a, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide
      });
      let glowMesh = null;
      let roadMesh = null;

      function setRibbon(upto) {
        const slice = pts.slice(0, Math.max(2, upto + 1));
        if (glowMesh) { pathGroup.remove(glowMesh); glowMesh.geometry.dispose(); }
        if (roadMesh) { pathGroup.remove(roadMesh); roadMesh.geometry.dispose(); }
        glowMesh = new THREE.Mesh(ribbonGeo(slice, 0.28), glowMat);
        roadMesh = new THREE.Mesh(ribbonGeo(slice, 0.11), roadMat);
        roadMesh.position.y = 0.01;
        pathGroup.add(glowMesh);
        pathGroup.add(roadMesh);
      }

      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.14, 14, 14),
        new THREE.MeshBasicMaterial({ color: 0xfff0c8 })
      );
      head.position.copy(pts[0]);
      pathGroup.add(head);
      if (highlightId != null) setRackGlow(highlightId, true);

      return new Promise((resolve) => {
        const tw = { cancelled: false };
        routeAnim = tw;
        const t0 = performance.now();
        let lastIdx = 1;
        setRibbon(1);
        (function frame(now) {
          if (tw.cancelled) return;
          const u = Math.min(1, (now - t0) / duration);
          const e = 1 - Math.pow(1 - u, 2.4);
          const idx = Math.max(1, Math.floor(e * (pts.length - 1)));
          if (idx !== lastIdx) { setRibbon(idx); lastIdx = idx; }
          head.position.copy(pts[idx]);
          if (u < 1) requestAnimationFrame(frame);
          else {
            setRibbon(pts.length - 1);
            const a = pts[pts.length - 2];
            const b = pts[pts.length - 1];
            const big = makeFloorChevron(new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize());
            big.scale.setScalar(2.2);
            big.position.set(b.x, 0.16, b.z);
            pathGroup.add(big);
            pathGroup.remove(head);
            routeAnim = null;
            resolve();
          }
        })(t0);
      });
    }

    function showShelfHL(objId, si, on) {
      const root = objectRoots.get(objId);
      if (!root) return;
      root.traverse((o) => {
        if (o.userData && o.userData.shelfHL) o.visible = !!(on && o.userData.shelfIdx === si);
      });
    }

    function clearFind() {
      if (pulseArrow) {
        scene.remove(pulseArrow);
        disposeObject3D(pulseArrow);
        pulseArrow = null;
      }
      objectRoots.forEach((r) => {
        const doomed = [];
        r.traverse((o) => {
          if (o.userData && o.userData.shelfHL) o.visible = false;
          if (o.userData && o.userData.placeHL) doomed.push(o);
        });
        doomed.forEach((o) => {
          o.parent?.remove(o);
          o.geometry?.dispose?.();
          if (o.material) {
            if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose?.());
            else o.material.dispose?.();
          }
        });
      });
    }

    function placeLocal(obj, si, pi) {
      const root = objectRoots.get(obj.id);
      const dims = (root && root.userData.dims) || {
        W: num(obj.width_m, 2.7), D: num(obj.depth_m, 0.95),
        H: num(obj.height_m, 2.4), shelves: 4, places: 2, pitch: 0.4, base: 0.38
      };
      const places = Math.max(1, dims.places || 1);
      const gap = 0.04;
      const usable = dims.W - 0.2;
      const sw = places > 1 ? (usable - gap * (places - 1)) / places : usable;
      const x0 = places > 1 ? (-usable / 2 + sw / 2 + pi * (sw + gap)) : 0;
      const y = shelfY(si, dims.pitch || 0.4, dims.base != null ? dims.base : 0.38);
      return { x0, y, sw, dims, root };
    }

    function showPlaceHL(obj, si, pi) {
      clearFind();
      showShelfHL(obj.id, si, true);
      const { x0, y, sw, dims, root } = placeLocal(obj, si, pi);
      if (!root) return;
      let tall = null;
      root.traverse((o) => { if (o.userData && o.userData.tall) tall = o; });
      // мягкая рамка слота вместо «жёлтого кубика» и игрушечной стрелки
      const boxGeo = new THREE.BoxGeometry(sw * 0.92, 0.48, dims.D * 0.78);
      const boxHL = new THREE.Mesh(
        boxGeo,
        new THREE.MeshBasicMaterial({ color: 0xd4a843, transparent: true, opacity: 0.14, depthWrite: false })
      );
      boxHL.position.set(x0, y + 0.3, 0);
      boxHL.userData.placeHL = true;
      (tall || root).add(boxHL);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(boxGeo),
        new THREE.LineBasicMaterial({ color: 0xe8c96a, transparent: true, opacity: 0.95 })
      );
      edges.position.copy(boxHL.position);
      edges.userData.placeHL = true;
      edges.userData.placeHLEdge = true;
      (tall || root).add(edges);

      const code = (obj.code || 'X') + (LETTERS[si] || si) + (pi + 1);
      const g = rackGeom(obj);
      const tag = addLabel('<b>' + code + '</b>', 0, 0, 0, {
        cls: 'whm__lab--find', worldPos: true, objectId: obj.id
      });
      tag._local = {
        parent: tall || root,
        ox: x0,
        oy: y + 0.72,
        oz: dims.D / 2 + 0.08
      };
      tag.x = g.rx + Math.cos(g.rot) * x0 + g.fnx * (dims.D / 2 + 0.08);
      tag.y = y + 0.72;
      tag.z = g.rz - Math.sin(g.rot) * x0 + g.fnz * (dims.D / 2 + 0.08);
      return { x0, y, code };
    }

    function frontCam(obj) {
      const g = rackGeom(obj);
      const dims = objectRoots.get(obj.id)?.userData?.dims;
      const n = dims ? dims.shelves : 4;
      const faceCx = g.rx + g.fnx * (g.D / 2);
      const faceCz = g.rz + g.fnz * (g.D / 2);
      // дальше и почти фронтально — в кадре пол, стены, не один стеллаж на чёрном
      const dist = Math.max(12.2, g.H * 2.5 + n * 0.55 + g.W * 0.65);
      const camY = Math.min(Math.max(1.65, g.H * 0.55), g.H - 0.05);
      // почти строго по нормали — обе боковые стены в кадре
      const side = 0;
      const sx = -g.fnz;
      const sz = g.fnx;
      return {
        pos: new THREE.Vector3(
          faceCx + g.fnx * dist + sx * side,
          camY,
          faceCz + g.fnz * dist + sz * side
        ),
        target: new THREE.Vector3(faceCx, g.H * 0.42, faceCz)
      };
    }

    function placeCam(obj, si, pi) {
      const { x0, y, dims } = placeLocal(obj, si, pi);
      const g = rackGeom(obj);
      const H = dims.H || g.H;
      const dist = Math.max(3.8, H * 0.85);
      // локальный x0 вдоль ширины → мир с учётом поворота
      const sideX = Math.cos(g.rot) * x0 * 0.35;
      const sideZ = -Math.sin(g.rot) * x0 * 0.35;
      const tx = g.rx + Math.cos(g.rot) * x0;
      const tz = g.rz - Math.sin(g.rot) * x0;
      return {
        pos: new THREE.Vector3(g.rx + g.fnx * dist + sideX, y + 0.55, g.rz + g.fnz * dist + sideZ),
        target: new THREE.Vector3(tx, y + 0.25, tz)
      };
    }

    function fitOrtho() {
      if (!floorData) return;
      const a = aspect();
      const W = num(floorData.width_m, 28);
      const D = num(floorData.depth_m, 15);
      // чуть шире кадр — южный ВХОД не уезжает под док
      const f = Math.max(W, D) * 0.54;
      ortho.left = -f * a;
      ortho.right = f * a;
      ortho.top = f;
      ortho.bottom = -f;
      ortho.updateProjectionMatrix();
      const ox = num(floorData.origin_x, 0);
      const oz = num(floorData.origin_z, 0);
      // камера чуть севернее, look чуть к двери (юг)
      ortho.position.set(ox, 28, oz + Math.min(11, D * 0.5));
      look.set(ox, 0, oz + D * 0.12);
      ortho.up.set(0, 1, 0);
      ortho.lookAt(look);
      cam = ortho;
      renderer.setSize(view.clientWidth, view.clientHeight, false);
    }

    function fitPerspOverview() {
      if (!floorData) return;
      const a = aspect();
      const W = num(floorData.width_m, 28);
      const D = num(floorData.depth_m, 15);
      const ox = num(floorData.origin_x, 0);
      const oz = num(floorData.origin_z, 0);
      persp.aspect = a;
      persp.updateProjectionMatrix();
      persp.position.set(ox, Math.max(W, D) * 0.45, oz + Math.max(W, D) * 0.55);
      look.set(ox, 0, oz);
      persp.lookAt(look);
      cam = persp;
      renderer.setSize(view.clientWidth, view.clientHeight, false);
    }

    function animCam(toPos, toTarget, ms) {
      return new Promise((resolve) => {
        if (camTween) camTween.cancelled = true;
        cam = persp;
        mode3d = true;
        updateModeBtns();
        const from = cam.position.clone();
        const fromT = look.clone();
        const tw = { cancelled: false };
        camTween = tw;
        const t0 = performance.now();
        ms = ms || 1100;
        (function frame(now) {
          if (tw.cancelled) return;
          const u = Math.min(1, (now - t0) / ms);
          const e = ease(u);
          cam.position.lerpVectors(from, toPos, e);
          look.lerpVectors(fromT, toTarget, e);
          cam.lookAt(look);
          if (u < 1) requestAnimationFrame(frame);
          else {
            camTween = null;
            try {
              window.__WHM_DEBUG = {
                cam: { x: cam.position.x, y: cam.position.y, z: cam.position.z },
                look: { x: look.x, y: look.y, z: look.z },
                at: Date.now()
              };
            } catch (_) {}
            resolve();
          }
        })(t0);
      });
    }

    function updateModeBtns() {
      const on2d = !mode3d && !frontMode;
      const on3d = !!(mode3d || frontMode);
      const b2 = container.querySelector('[data-a="mode2d"]');
      const b3 = container.querySelector('[data-a="mode3d"]');
      if (b2) {
        b2.classList.toggle('whm__btn--on', on2d);
        b2.setAttribute('aria-pressed', on2d ? 'true' : 'false');
      }
      if (b3) {
        b3.textContent = frontMode ? 'Фасад' : '3D';
        b3.classList.toggle('whm__btn--on', on3d);
        b3.setAttribute('aria-pressed', on3d ? 'true' : 'false');
      }
      const bed = container.querySelector('[data-a="edit"]');
      if (bed) bed.classList.toggle('whm__btn--on', editMode);
      if (hostEl) {
        hostEl.dataset.mode = frontMode ? 'facade' : (mode3d ? '3d' : 'plan');
      }
    }

    function renderSide(o, loc) {
      selectedLoc = loc || null;
      if (legendCode) legendCode.textContent = (o && (o.code || ('#' + o.id))) || (loc && loc.place_code) || '—';
      const wrap = (html) => { side.innerHTML = '<div class="whm__side-inner">' + html + '</div>'; };

      if (!o) {
        wrap(editMode
          ? `<h4>Редактор</h4>
             <p class="mut">Клик по полу — новый объект. Перетащите выбранный. Размеры в панели перестраивают меш сразу.</p>
             <label>Тип</label><select id="whm-ntype">${Object.keys(TYPE_LABEL).map((k) =>
               '<option value="' + k + '">' + TYPE_LABEL[k] + '</option>').join('')}</select>
             <label>Код</label><input id="whm-ncode" placeholder="R3">
             <label>Ш × Г × В м</label>
             <div class="row"><input id="whm-nw" value="2.4"><input id="whm-nd" value="0.9"><input id="whm-nh" value="2.2"></div>
             <label>Полок / мест на полке</label>
             <div class="row"><input id="whm-nsc" value="4"><input id="whm-npp" value="2"></div>`
          : `<h4>Склад</h4>
             <p class="mut">План ${num(floorData && floorData.width_m, 28)}×${num(floorData && floorData.depth_m, 15)} м · ${objects.length} объектов.</p>
             <p class="mut">Клик по стеллажу или код места → маршрут и фасад.</p>
             <p class="mut" style="margin-top:10px;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:#8d99aa">Типы мест</p>
             <div class="whm__typelist">
               <div><i style="background:#4a5a6e"></i>Лёгкий</div>
               <div><i style="background:#3d5a78"></i>Паллетный</div>
               <div><i style="background:#5a4e6a"></i>Одежда / СИЗ</div>
               <div><i style="background:#3a4840"></i>Зона пола</div>
             </div>
             <div class="whm__act" style="margin-top:12px">
               <button type="button" class="whm__btn whm__btn--pri" data-a-side="findhint">Найти место</button>
             </div>`);
        const hintBtn = side.querySelector('[data-a-side="findhint"]');
        if (hintBtn) {
          hintBtn.onclick = () => {
            const inp = container.querySelector('#whm-find');
            if (inp) { inp.focus(); inp.select(); }
          };
        }
        syncTourDock();
        return;
      }

      const dims = objectRoots.get(o.id)?.userData?.dims;
      const shelves = dims ? dims.shelves : parseInt(paramsOf(o).shelf_count || paramsOf(o).pallet_levels || 1, 10);
      const places = dims ? dims.places : parseInt(paramsOf(o).places_per_shelf || paramsOf(o).slots_per_level || 1, 10);
      let placesHtml = '';
      if (['shelf_light', 'shelf_pallet', 'clothing'].includes(o.object_type)) {
        for (let si = 0; si < shelves; si++) {
          placesHtml += '<div style="margin:10px 0 4px;font-size:10px;color:#8d99aa;letter-spacing:.1em">ПОЛКА ' +
            (LETTERS[si] || si) + '</div>';
          for (let pi = 0; pi < places; pi++) {
            const code = (o.code || 'X') + (LETTERS[si] || si) + (pi + 1);
            const findCls = loc && String(loc.place_code || '').toUpperCase() === code.toUpperCase() ? ' find on' : '';
            placesHtml += '<button type="button" class="whm__place' + findCls + '" data-s="' + si + '" data-p="' + pi + '">' +
              '<b>' + code + '</b><span>место ' + (pi + 1) + '</span></button>';
          }
        }
      }

      wrap(`
        <h4>${TYPE_LABEL[o.object_type] || o.object_type}</h4>
        <div class="whm__code">${o.code || o.id}</div>
        <div class="mut">${o.label || 'Без названия'}</div>
        <div class="mut" style="margin-top:8px">${num(o.width_m, 0).toFixed(2)} × ${num(o.depth_m, 0).toFixed(2)} × ${num(o.height_m, 0).toFixed(2)} м</div>
        ${editMode ? `
          <label>Ширина м</label><input id="whm-ew" value="${num(o.width_m, 0)}">
          <label>Глубина м</label><input id="whm-ed" value="${num(o.depth_m, 0)}">
          <label>Высота м</label><input id="whm-eh" value="${num(o.height_m, 0)}">
          <label>Полок / уровней</label><input id="whm-esc" value="${
            (paramsOf(o).shelf_count || paramsOf(o).pallet_levels || paramsOf(o).clothing_sections) || ''}">
          <label>Мест на полке</label><input id="whm-epp" value="${
            (paramsOf(o).places_per_shelf || paramsOf(o).slots_per_level) || ''}">
          <div class="whm__act">
            <button type="button" class="whm__btn whm__btn--pri" data-sync="1">Синхр. ячейки QR</button>
            <button type="button" class="whm__btn" data-del="1">Удалить</button>
          </div>
        ` : `
          <div class="whm__act">
            <button type="button" class="whm__btn whm__btn--pri" data-route="1">Маршрут</button>
            <button type="button" class="whm__btn" data-facade="1">Фасад</button>
          </div>
          ${placesHtml}
        `}`);

      side.querySelectorAll('.whm__place').forEach((btn) => {
        btn.onclick = async () => {
          const si = +btn.dataset.s;
          const pi = +btn.dataset.p;
          if (!frontMode || isolateId !== o.id) {
            isolate(o.id);
            const fc = frontCam(o);
            await animCam(fc.pos, fc.target, 900);
          }
          showPlaceHL(o, si, pi);
          const pc = placeCam(o, si, pi);
          await animCam(pc.pos, pc.target, 900);
          side.querySelectorAll('.whm__place').forEach((b) => b.classList.remove('find', 'on'));
          btn.classList.add('find', 'on');
          if (legendCode) legendCode.textContent = (o.code || 'X') + (LETTERS[si] || si) + (pi + 1);
        };
      });

      const routeBtn = side.querySelector('[data-route]');
      if (routeBtn) {
        routeBtn.onclick = async () => {
          showWorld();
          await drawRouteAnimated(pathWaypoints(o), o.id, 1800);
        };
      }
      const facadeBtn = side.querySelector('[data-facade]');
      if (facadeBtn) {
        facadeBtn.onclick = async () => {
          isolate(o.id);
          const fc = frontCam(o);
          const g = rackGeom(o);
          spot.intensity = 2.1;
          spot.position.set(fc.target.x + g.fnx * 2.8, g.H + 2.0, fc.target.z + g.fnz * 2.8);
          spot.target.position.copy(fc.target);
          setFacadeLights(true, g);
          await animCam(fc.pos, fc.target, 1200);
        };
      }
      const sync = side.querySelector('[data-sync]');
      if (sync) {
        sync.onclick = async () => {
          const r = await api.post('/api/warehouse-map/objects/' + o.id + '/sync-locations', {});
          setBarStatus('Ячеек: ' + (r.count || 0));
          showHint('Синхронизация', (r.count || 0) + ' ячеек');
        };
      }
      const del = side.querySelector('[data-del]');
      if (del) {
        del.onclick = async () => {
          if (!confirm('Удалить объект ' + (o.code || o.id) + '?')) return;
          await api.del('/api/warehouse-map/objects/' + o.id);
          removeObjectMesh(o.id);
          objects = objects.filter((x) => x.id !== o.id);
          selectedId = null;
          renderSide(null);
        };
      }

      if (editMode) {
        const onLive = debounce(async () => {
          const params = Object.assign({}, paramsOf(o));
          const sc = parseInt((side.querySelector('#whm-esc') || {}).value, 10);
          const pp = parseInt((side.querySelector('#whm-epp') || {}).value, 10);
          if (sc) {
            if (o.object_type === 'shelf_pallet') params.pallet_levels = sc;
            else if (o.object_type === 'clothing') params.clothing_sections = sc;
            else params.shelf_count = sc;
          }
          if (pp) {
            if (o.object_type === 'shelf_pallet') params.slots_per_level = pp;
            else params.places_per_shelf = pp;
          }
          o.width_m = num((side.querySelector('#whm-ew') || {}).value, o.width_m);
          o.depth_m = num((side.querySelector('#whm-ed') || {}).value, o.depth_m);
          o.height_m = num((side.querySelector('#whm-eh') || {}).value, o.height_m);
          o.params_json = params;
          rebuildObjectLive(o);
          try {
            await api.put('/api/warehouse-map/objects/' + o.id, {
              width_m: o.width_m,
              depth_m: o.depth_m,
              height_m: o.height_m,
              params_json: params,
              sync_locations: true
            });
            setBarStatus('Сохранено');
          } catch (e) {
            setBarStatus(e.message || 'Ошибка сохранения');
          }
        }, 350);
        ['#whm-ew', '#whm-ed', '#whm-eh', '#whm-esc', '#whm-epp'].forEach((sel) => {
          const el = side.querySelector(sel);
          if (el) el.addEventListener('input', onLive);
        });
      }
      syncTourDock();
    }

    function syncTourDock() {
      const dock = container.querySelector('#whm-dock');
      const dockStep = container.querySelector('#whm-tour-step');
      const prev = container.querySelector('[data-tour-prev]');
      const next = container.querySelector('[data-tour-next]');
      if (dock) dock.classList.toggle('whm__dock--on', !!tourTarget);
      if (dockStep) dockStep.textContent = tourTarget ? (TOUR_STEPS[tourStep] || '') : 'Готов к поиску';
      if (prev) prev.disabled = !tourTarget || tourStep <= 0;
      if (next) next.disabled = !tourTarget || tourStep >= TOUR_STEPS.length - 1;
    }

    async function goTourStep(i, obj, loc) {
      if (routeAnim) { routeAnim.cancelled = true; routeAnim = null; }
      if (camTween) { camTween.cancelled = true; camTween = null; }
      tourStep = i;
      tourTarget = { obj, loc };
      syncTourDock();

      const shelfIdx = loc && loc.shelf_idx != null ? +loc.shelf_idx : 0;
      const placeIdx = loc && loc.place_idx != null ? +loc.place_idx : 0;
      const H = num(obj.height_m, 2.4);

      if (i === 0) {
        showWorld();
        renderSide(obj, loc);
        showHint('План склада', 'вид сверху');
        setStatus('Шаг 1 · план 2D');
      }
      if (i === 1) {
        showWorld();
        clearRings();
        showHint('Строим маршрут', 'по проходам между стеллажами');
        setStatus('Шаг 2 · маршрут');
        renderSide(obj, loc);
        await drawRouteAnimated(pathWaypoints(obj), obj.id, 2200);
      }
      if (i === 2) {
        if (!pathGroup.children.length) await drawRouteAnimated(pathWaypoints(obj), obj.id, 400);
        else setRackGlow(obj.id, true);
        setWorldPlan(false);
        objectRoots.forEach((r) => setPlan(r, false));
        walls.forEach((w) => {
          w.visible = true;
          w.material.transparent = false;
          w.material.opacity = 1;
        });
        setRackGlow(obj.id, true);
        showHint((obj.code || 'Объект'), 'подлёт · 3D');
        setStatus('Шаг 3 · подлёт 3D');
        cam = persp;
        persp.aspect = aspect();
        persp.updateProjectionMatrix();
        persp.position.copy(ortho.position);
        look.set(num(floorData.origin_x, 0), 0, num(floorData.origin_z, 0));
        const g = rackGeom(obj);
        await animCam(
          new THREE.Vector3(
            g.rx + g.fnx * 5.5 + (Math.abs(g.fnz) > 0.5 ? 2.2 : 0),
            Math.max(7, g.H + 3.5),
            g.rz + g.fnz * 5.5 + (Math.abs(g.fnx) > 0.5 ? 2.2 : 0)
          ),
          new THREE.Vector3(g.rx, g.H * 0.35, g.rz),
          1400
        );
        renderSide(obj, loc);
      }
      if (i === 3) {
        isolate(obj.id);
        setPlan(objectRoots.get(obj.id), false);
        clearFind();
        showShelfHL(obj.id, shelfIdx, true);
        const g = rackGeom(obj);
        const fc = frontCam(obj);
        spot.intensity = 2.1;
        spot.position.set(
          fc.target.x + g.fnx * 2.8,
          g.H + 2.0,
          fc.target.z + g.fnz * 2.8
        );
        spot.target.position.copy(fc.target);
        setFacadeLights(true, g);
        showHint('Полка ' + (LETTERS[shelfIdx] || shelfIdx), 'подсветка полки');
        setStatus('Шаг 4 · фасад · полка');
        renderSide(obj, loc);
        await animCam(fc.pos, fc.target, 1200);
      }
      if (i === 4) {
        if (!frontMode || isolateId !== obj.id) {
          await goTourStep(3, obj, loc);
        }
        const hl = showPlaceHL(obj, shelfIdx, placeIdx);
        const code = (hl && hl.code) || (loc && loc.place_code) || '';
        showHint('Место ' + code, 'приближение к месту на полке');
        setStatus('Шаг 5 · место ' + code);
        renderSide(obj, loc);
        const dims = objectRoots.get(obj.id)?.userData?.dims;
        if (!dims || dims.places >= 2) {
          const pc = placeCam(obj, shelfIdx, placeIdx);
          await animCam(pc.pos, pc.target, 1100);
        }
      }
    }

    async function runFindTour(obj, loc) {
      if (tourCancel) tourCancel();
      let cancelled = false;
      tourCancel = () => { cancelled = true; };
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let i = 0; i < TOUR_STEPS.length; i++) {
        if (cancelled) break;
        await goTourStep(i, obj, loc);
        if (i < TOUR_STEPS.length - 1) await sleep(650);
      }
      updateModeBtns();
      setPill(!mode3d && !frontMode);
      tourCancel = null;
    }

    async function findPlace(code) {
      const c = String(code || '').trim();
      if (!c) return;
      // object code (PR-1, L-R2-1) OR place code (L-R2-1A1)
      let loc = null;
      let obj = objects.find((o) => String(o.code || '').toLowerCase() === c.toLowerCase());
      if (!obj) {
        const d = await api.get('/api/warehouse-map/by-place/' + encodeURIComponent(c));
        loc = (d.items || [])[0];
        if (!loc) throw new Error('Место не найдено: ' + c);
        obj = objects.find((o) => o.id === loc.map_object_id) ||
          objects.find((o) => o.code === loc.object_code);
      }
      if (!obj) {
        setStatus('Место найдено, но объект карты не привязан');
        return loc;
      }
      selectedId = obj.id;
      selectedLoc = loc;
      if (opts.onSelect) opts.onSelect({ object: obj, location: loc });
      await runFindTour(obj, loc);
      return loc || { object_code: obj.code };
    }

    async function refresh() {
      setStatus('Загрузка…');
      const whId = opts.warehouseId;
      let floors = await api.get('/api/warehouse-map/floors' + (whId ? ('?warehouse_id=' + whId) : ''));
      let list = floors.items || [];
      if (!list.length && whId) {
        await api.post('/api/warehouse-map/floors', {
          warehouse_id: whId,
          width_m: 15,
          depth_m: 28,
          meta_json: { entrance: 'south', door_x: 0, door_z: 13.8, aisle_x: [0], aisle_z: [12, 8, 4, 0, -4, -8] }
        });
        floors = await api.get('/api/warehouse-map/floors?warehouse_id=' + whId);
        list = floors.items || [];
      }
      if (!list.length) {
        setStatus('Нет этажа карты — создайте склад и примените миграцию V346');
        return;
      }
      const detail = await api.get('/api/warehouse-map/floors/' + list[0].id);
      floorData = detail.floor;
      floorData.meta_json = metaOf(floorData);
      floorData.rooms_json = roomsOf(floorData);
      objects = (detail.objects || []).map((o) => {
        o.params_json = paramsOf(o);
        return o;
      });
      // QR-места для ops/history: после сида V347 объекты есть, а warehouse_locations могут быть пусты
      try {
        await api.post('/api/warehouse-map/floors/' + list[0].id + '/sync-locations', {});
      } catch (_) { /* read-only роли — пропуск */ }
      clearWorld();
      shell = buildFloorShell(floorData);
      objects.forEach((o) => buildObject(o, !mode3d));
      setWorldPlan(!mode3d);
      if (!mode3d) fitOrtho();
      else fitPerspOverview();
      setStatus(mode3d
        ? '3D · клик по объекту'
        : 'План 2D · 1 ед = 1 м · клик / поиск места');
      setBarStatus(objects.length + ' объектов · ' +
        num(floorData.width_m, 28) + '×' + num(floorData.depth_m, 15) + ' м');
      renderSide(selectedId ? objects.find((o) => o.id === selectedId) : null, selectedLoc);
      if (selectedId) setRackGlow(selectedId, true);
    }

    const ray = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    function pick(ev) {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      ray.setFromCamera(mouse, cam);
      const targets = clickables.slice();
      if (floorMesh) targets.push(floorMesh);
      return ray.intersectObjects(targets, true)[0] || null;
    }

    renderer.domElement.addEventListener('pointerdown', async (ev) => {
      const hit = pick(ev);
      if (!hit) return;
      let ud = hit.object.userData || {};
      let objId = ud.id;
      let placeInfo = ud.kind === 'place' ? ud : null;
      if (!objId) {
        let o = hit.object;
        while (o) {
          if (o.userData && o.userData.kind === 'object') { objId = o.userData.id; break; }
          if (o.userData && o.userData.object) { objId = o.userData.object.id; break; }
          if (o.userData && o.userData.kind === 'place') {
            placeInfo = o.userData;
            objId = o.userData.id;
            break;
          }
          o = o.parent;
        }
      }

      if (frontMode && placeInfo && placeInfo.id === isolateId) {
        const obj = objects.find((x) => x.id === placeInfo.id);
        if (obj) {
          showPlaceHL(obj, placeInfo.shelfIdx, placeInfo.placeIdx);
          renderSide(obj, {
            place_code: (obj.code || 'X') + (LETTERS[placeInfo.shelfIdx] || '') + (placeInfo.placeIdx + 1),
            shelf_idx: placeInfo.shelfIdx,
            place_idx: placeInfo.placeIdx
          });
          if (opts.onSelect) opts.onSelect({ object: obj, place: placeInfo });
        }
        return;
      }

      if (objId) {
        const obj = objects.find((x) => x.id === objId);
        selectedId = objId;
        setRackGlow(objId, true);
        renderSide(obj);
        if (editMode) {
          dragging = {
            id: objId,
            ox: num(obj.x_m, 0),
            oz: num(obj.z_m, 0),
            sx: ev.clientX,
            sy: ev.clientY
          };
        } else if (!mode3d) {
          await drawRouteAnimated(pathWaypoints(obj), obj.id, 1600);
        }
        if (opts.onSelect) opts.onSelect({ object: obj });
        return;
      }

      if (editMode && hit.object === floorMesh) {
        const p = hit.point;
        const type = (side.querySelector('#whm-ntype') || {}).value || 'shelf_light';
        const code = (side.querySelector('#whm-ncode') || {}).value || '';
        const width_m = num((side.querySelector('#whm-nw') || {}).value, 2.4);
        const depth_m = num((side.querySelector('#whm-nd') || {}).value, 0.9);
        const height_m = num((side.querySelector('#whm-nh') || {}).value, 2.2);
        const sc = parseInt((side.querySelector('#whm-nsc') || {}).value, 10) || 4;
        const pp = parseInt((side.querySelector('#whm-npp') || {}).value, 10) || 2;
        const params_json = type === 'shelf_pallet'
          ? { pallet_levels: sc, slots_per_level: pp }
          : type === 'clothing'
            ? { clothing_sections: sc }
            : { shelf_count: sc, places_per_shelf: pp, shelf_pitch_m: 0.4 };
        await api.post('/api/warehouse-map/objects', {
          floor_id: floorData.id,
          object_type: type,
          code: code || undefined,
          x_m: p.x,
          z_m: p.z,
          width_m,
          depth_m,
          height_m,
          params_json,
          sync_locations: true
        });
        await refresh();
      }
    });

    function onPointerUp() {
      if (!dragging) return;
      const root = objectRoots.get(dragging.id);
      const id = dragging.id;
      dragging = null;
      if (!root) return;
      api.put('/api/warehouse-map/objects/' + id, { x_m: root.position.x, z_m: root.position.z })
        .then(() => {
          const obj = objects.find((x) => x.id === id);
          if (obj) { obj.x_m = root.position.x; obj.z_m = root.position.z; }
        })
        .catch((e) => setBarStatus(e.message || 'Ошибка перемещения'));
    }
    window.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointermove', (ev) => {
      if (!dragging) return;
      const root = objectRoots.get(dragging.id);
      if (!root) return;
      const dx = (ev.clientX - dragging.sx) * 0.025;
      const dz = (ev.clientY - dragging.sy) * 0.025;
      root.position.x = dragging.ox + dx;
      root.position.z = dragging.oz + dz;
      labels.forEach((l) => {
        if (l.objectId === dragging.id && l.worldPos) {
          /* plan/always labels follow roughly via rebuild on next refresh; nudge plan label */
        }
      });
      if (root.userData._planLab) {
        root.userData._planLab.x = root.position.x;
        root.userData._planLab.z = root.position.z;
      }
    });

    container.querySelector('[data-a="mode2d"]').onclick = () => {
      if (tourCancel) tourCancel();
      showWorld();
      updateModeBtns();
      showHint('План 2D', 'вид сверху');
    };
    container.querySelector('[data-a="mode3d"]').onclick = () => {
      if (tourCancel) tourCancel();
      setWorldPlan(false);
      objectRoots.forEach((r) => setPlan(r, false));
      walls.forEach((w) => { w.visible = true; });
      fitPerspOverview();
      updateModeBtns();
      showHint('3D', 'обзор склада');
      setStatus('3D · клик по объекту');
    };
    container.querySelector('[data-a="edit"]').onclick = () => {
      editMode = !editMode;
      updateModeBtns();
      renderSide(selectedId ? objects.find((o) => o.id === selectedId) : null, selectedLoc);
    };
    container.querySelector('[data-a="refresh"]').onclick = () => {
      refresh().catch((e) => setStatus(e.message));
    };
    container.querySelector('[data-a="find"]').onclick = () => {
      const v = container.querySelector('#whm-find').value;
      findPlace(v).catch((e) => setStatus(e.message));
    };
    container.querySelector('#whm-find').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        findPlace(e.target.value).catch((err) => setStatus(err.message));
      }
    });
    container.querySelector('[data-tour-prev]').onclick = async () => {
      if (!tourTarget || tourStep <= 0) return;
      await goTourStep(tourStep - 1, tourTarget.obj, tourTarget.loc);
    };
    container.querySelector('[data-tour-next]').onclick = async () => {
      if (!tourTarget || tourStep >= TOUR_STEPS.length - 1) return;
      await goTourStep(tourStep + 1, tourTarget.obj, tourTarget.loc);
    };

    const onResize = () => {
      persp.aspect = aspect();
      persp.updateProjectionMatrix();
      if (!mode3d) fitOrtho();
      else renderer.setSize(view.clientWidth, view.clientHeight, false);
    };
    window.addEventListener('resize', onResize);

    function loop() {
      animId = requestAnimationFrame(loop);
      const t = performance.now() * 0.004;
      objectRoots.forEach((r) => {
        r.traverse((o) => {
          if (o.userData && o.userData.shelfHL && o.visible && o.material) {
            o.material.opacity = 0.18 + Math.sin(t) * 0.08;
          }
          if (o.userData && o.userData.placeHL && !o.userData.placeHLEdge && o.visible && o.material) {
            o.material.opacity = 0.12 + Math.sin(t) * 0.06;
          }
          if (o.userData && o.userData.glowable && r.userData.pulseTarget && o.material && o.material.emissive) {
            o.material.emissiveIntensity = 0.35 + (0.5 + 0.5 * Math.sin(t)) * 0.55;
          }
          if (o.userData && o.userData.pulseSlab && o.material && o.material.emissive) {
            o.material.emissiveIntensity = 0.35 + (0.5 + 0.5 * Math.sin(t)) * 0.45;
          }
        });
      });
      if (pulseArrow) {
        pulseArrow.position.y += Math.sin(t) * 0.002;
        labels.forEach((l) => {
          if (l._followArrow === pulseArrow) {
            l.x = pulseArrow.position.x;
            l.y = pulseArrow.position.y + 0.55;
            l.z = pulseArrow.position.z;
          }
        });
      }
      // update tote % label world positions
      objectRoots.forEach((root) => {
        root.traverse((o) => {
          if (o.userData && o.userData._pctLabel && o.userData._pctLabel._local) {
            const lab = o.userData._pctLabel;
            const wp = new THREE.Vector3();
            o.getWorldPosition(wp);
            lab.x = wp.x;
            lab.y = wp.y + 0.2;
            lab.z = wp.z + num(root.userData.dims && root.userData.dims.D, 0.5) * 0.3;
          }
        });
      });
      cam.lookAt(look);
      renderer.render(scene, cam);
      projectLabels();
    }
    loop();

    _state = {
      container,
      renderer,
      scene,
      api,
      opts,
      findPlace,
      refresh,
      getSelected: () => {
        if (!selectedId) return null;
        return {
          object: objects.find((o) => o.id === selectedId) || null,
          location: selectedLoc
        };
      },
      setEditMode: (v) => {
        editMode = !!v;
        updateModeBtns();
        renderSide(selectedId ? objects.find((o) => o.id === selectedId) : null, selectedLoc);
      },
      destroyHooks: [
        () => cancelAnimationFrame(animId),
        () => window.removeEventListener('resize', onResize),
        () => window.removeEventListener('pointerup', onPointerUp),
        () => { if (routeAnim) routeAnim.cancelled = true; },
        () => { if (camTween) camTween.cancelled = true; },
        () => { if (tourCancel) tourCancel(); }
      ]
    };
    updateModeBtns();
    await refresh();
    return { refresh, findPlace };
  }

  function destroy() {
    if (!_state) return;
    (_state.destroyHooks || []).forEach((fn) => { try { fn(); } catch (_) {} });
    try { _state.renderer.dispose(); } catch (_) {}
    if (_state.container) _state.container.innerHTML = '';
    _state = null;
  }

  function setEditMode(v) {
    if (!_state || !_state.setEditMode) return;
    _state.setEditMode(v);
  }

  function refresh() {
    if (!_state || !_state.refresh) return Promise.resolve();
    return _state.refresh();
  }

  function findPlace(code) {
    if (!_state || !_state.findPlace) return Promise.reject(new Error('Карта не смонтирована'));
    const inp = _state.container.querySelector('#whm-find');
    if (inp) inp.value = code;
    return _state.findPlace(code);
  }

  function getSelected() {
    if (!_state || !_state.getSelected) return null;
    return _state.getSelected();
  }

  return { mount, destroy, setEditMode, refresh, findPlace, getSelected };
})();
