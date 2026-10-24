import { useState, useEffect, useCallback } from 'react';

/**
 * MobileDiagnostics — временная диагностическая панель для iOS.
 *
 * Зачем (20.10.2026): на iPhone под нижним тап-баром видна полоса фона, то есть
 * бар не доходит до низа экрана. Ни Chromium, ни Playwright-WebKit этот дефект
 * не воспроизводят: оба отдают `dvh == innerHeight` и не эмулируют расхождение
 * layout/visual viewport, которое возникает, когда Safari прячет свои панели.
 * Поэтому замер надо снять НА УСТРОЙСТВЕ.
 *
 * Панель показывает:
 *   • innerHeight / visualViewport (height, offsetTop, scale) — где реальный низ;
 *   • env(safe-area-inset-*) — что отдаёт система;
 *   • положение тап-бара и зазор до низа экрана и до низа visual viewport;
 *   • высоты html/body/#root и их computed position;
 *   • display-mode standalone и navigator.standalone;
 *   • --safe-bottom и --tabbar-total из темы.
 *
 * Включается только по адресу `?diag=1` (или localStorage asgard_diag=1),
 * обычным пользователям не показывается. Кнопка «Скрыть» убирает оверлей.
 */
export default function MobileDiagnostics() {
  const [on, setOn] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [data, setData] = useState(null);

  // Активация: ?diag=1 в адресе или сохранённый флаг.
  useEffect(() => {
    let enabled = false;
    try {
      const q = new URLSearchParams(window.location.search);
      enabled = q.get('diag') === '1' || localStorage.getItem('asgard_diag') === '1';
      if (q.get('diag') === '1') localStorage.setItem('asgard_diag', '1');
    } catch { enabled = false; }
    setOn(enabled);
  }, []);

  /** Собирает все показатели одним снимком. */
  const measure = useCallback(() => {
    const probe = (expr) => {
      const d = document.createElement('div');
      d.style.cssText = 'position:absolute;visibility:hidden;height:' + expr;
      document.body.appendChild(d);
      const h = d.getBoundingClientRect().height;
      d.remove();
      return Math.round(h * 100) / 100;
    };
    const nav = document.querySelector('nav.fixed.bottom-0');
    const nr = nav ? nav.getBoundingClientRect() : null;
    const root = getComputedStyle(document.documentElement);
    const html = getComputedStyle(document.documentElement);
    const body = getComputedStyle(document.body);
    const vv = window.visualViewport;
    return {
      innerHeight: window.innerHeight,
      outerHeight: window.outerHeight,
      screenH: window.screen.height,
      dpr: window.devicePixelRatio,
      vvHeight: vv ? Math.round(vv.height * 100) / 100 : null,
      vvOffsetTop: vv ? Math.round(vv.offsetTop * 100) / 100 : null,
      vvScale: vv ? vv.scale : null,
      vvPageTop: vv ? Math.round(vv.pageTop * 100) / 100 : null,
      safeTop: probe('env(safe-area-inset-top, 0px)'),
      safeBottom: probe('env(safe-area-inset-bottom, 0px)'),
      // Единицы вьюпорта: dvh = видимая область, lvh = физический экран.
      // Их расхождение — корень «полосы» под тап-баром (D-341).
      dvh: probe('100dvh'),
      lvh: probe('100lvh'),
      svh: probe('100svh'),
      appGap: root.getPropertyValue('--app-gap').trim() || '(нет)',
      tabbarLift: root.getPropertyValue('--tabbar-lift').trim() || '(нет)',
      // Реальная геометрия бара: если navBottom меньше screen.height — снизу
      // полоса, и бар не дошёл до физического низа (это и есть D-341).
      stripPixel: (() => {
        const h = window.innerHeight;
        const el = document.elementFromPoint(Math.round(window.innerWidth / 2), h - 2);
        if (!el) return 'за пределами страницы';
        const cs = getComputedStyle(el);
        return `${cs.backgroundColor} (${el.tagName.toLowerCase()})`;
      })(),
      cssSafeBottom: root.getPropertyValue('--safe-bottom').trim(),
      tabbarTotal: root.getPropertyValue('--tabbar-total').trim(),
      tabbarHeight: root.getPropertyValue('--tabbar-height').trim(),
      navTop: nr ? Math.round(nr.top * 100) / 100 : null,
      navBottom: nr ? Math.round(nr.bottom * 100) / 100 : null,
      navH: nr ? Math.round(nr.height * 100) / 100 : null,
      navPadBottom: nav ? getComputedStyle(nav).paddingBottom : null,
      gapToInner: nr ? Math.round((window.innerHeight - nr.bottom) * 100) / 100 : null,
      gapToVisual: nr && vv ? Math.round((vv.height + vv.offsetTop - nr.bottom) * 100) / 100 : null,
      htmlH: html.height, htmlPos: html.position,
      bodyH: body.height, bodyPos: body.position,
      rootH: document.getElementById('root')
        ? Math.round(document.getElementById('root').getBoundingClientRect().height * 100) / 100 : null,
      standaloneMatch: typeof window.matchMedia === 'function'
        ? window.matchMedia('(display-mode: standalone)').matches : null,
      navStandalone: window.navigator.standalone === true,
      htmlClass: document.documentElement.className,
      ua: String(navigator.userAgent || '').replace('Mozilla/5.0 ', '').slice(0, 70),
    };
  }, []);

  // Обновляем показатели при открытии и на каждое изменение вьюпорта.
  useEffect(() => {
    if (!on) return undefined;
    const tick = () => setData(measure());
    tick();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', tick);
    vv?.addEventListener('scroll', tick);
    window.addEventListener('resize', tick);
    window.addEventListener('orientationchange', tick);
    const t = setInterval(tick, 1500);
    return () => {
      vv?.removeEventListener('resize', tick);
      vv?.removeEventListener('scroll', tick);
      window.removeEventListener('resize', tick);
      window.removeEventListener('orientationchange', tick);
      clearInterval(t);
    };
  }, [on, measure]);

  if (!on || hidden || !data) return null;

  /** Строка таблицы: подпись + значение. */
  const Row = ({ k, v, warn }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ color: '#9aa4b2' }}>{k}</span>
      <span style={{ color: warn ? '#ff6b62' : '#e8eef7', fontWeight: 700 }}>{String(v)}</span>
    </div>
  );

  const gapWarn = data.gapToInner > 1;

  return (
    <div
      style={{
        position: 'fixed', left: 0, right: 0, top: 0, zIndex: 99999,
        background: 'rgba(6,8,14,0.94)', color: '#e8eef7',
        fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11, lineHeight: 1.45,
        padding: '8px 10px calc(8px + env(safe-area-inset-top, 0px))',
        borderBottom: '1px solid #2a3550',
        maxHeight: '70vh', overflowY: 'auto',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <b style={{ color: '#c8a84e', fontSize: 12 }}>ДИАГНОСТИКА iOS</b>
        <button
          type="button"
          onClick={() => setHidden(true)}
          style={{
            background: '#1b2233', color: '#e8eef7', border: '1px solid #2a3550',
            borderRadius: 8, padding: '3px 10px', fontSize: 11, fontWeight: 700,
          }}
        >
          Скрыть
        </button>
      </div>

      <Row k="innerHeight" v={data.innerHeight} />
      <Row k="visualViewport.height" v={data.vvHeight} />
      <Row k="vv.offsetTop" v={data.vvOffsetTop} />
      <Row k="screen.height" v={data.screenH} />
      <Row k="dpr" v={data.dpr} />
      <div style={{ height: 6 }} />
      {/* Ключевое для «полосы»: если lvh > dvh — приложение короче экрана. */}
      <Row k="100dvh (видимая)" v={data.dvh} warn={data.lvh > data.dvh} />
      <Row k="100lvh (экран)" v={data.lvh} warn={data.lvh > data.dvh} />
      <Row k="100svh" v={data.svh} />
      <Row k="РАЗНИЦА lvh − dvh" v={(data.lvh - data.dvh).toFixed(1) + ' px'} warn={data.lvh - data.dvh > 1} />
      <Row k="--app-gap" v={data.appGap} />
      <Row k="--tabbar-lift" v={data.tabbarLift} warn={!/calc/.test(String(data.tabbarLift))} />
      <Row k="цвет под баром" v={data.stripPixel} warn={/за пределами/.test(String(data.stripPixel))} />
      <div style={{ height: 6 }} />
      <Row k="env(safe-bottom)" v={data.safeBottom} />
      <Row k="--safe-bottom" v={data.cssSafeBottom} />
      <Row k="--tabbar-total" v={data.tabbarTotal} />
      <div style={{ height: 6 }} />
      <Row k="nav.top" v={data.navTop} />
      <Row k="nav.bottom" v={data.navBottom} />
      <Row k="nav.height" v={data.navH} />
      <Row k="nav.paddingBottom" v={data.navPadBottom} />
      <Row k="ЗАЗОР до низа экрана" v={data.gapToInner + ' px'} warn={gapWarn} />
      <Row k="ЗАЗОР до visual bottom" v={data.gapToVisual + ' px'} warn={data.gapToVisual > 1} />
      <div style={{ height: 6 }} />
      <Row k="html.height / position" v={data.htmlH + ' / ' + data.htmlPos} />
      <Row k="body.height / position" v={data.bodyH + ' / ' + data.bodyPos} />
      <Row k="#root.height" v={data.rootH} />
      <div style={{ height: 6 }} />
      <Row k="display-mode standalone" v={String(data.standaloneMatch)} />
      <Row k="navigator.standalone" v={String(data.navStandalone)} />
      <Row k="html.class" v={data.htmlClass || '(пусто)'} />
      <div style={{ marginTop: 6, color: '#7d8aa0', fontSize: 10, wordBreak: 'break-all' }}>{data.ua}</div>
    </div>
  );
}
