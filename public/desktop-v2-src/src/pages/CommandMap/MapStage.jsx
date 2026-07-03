/**
 * SVG-карта объектов (без PIXI). Подсвечивает хаб слева, объекты — кружки
 * с эмодзи, рейсы — линии хаб↔объект с движущейся точкой по таймеру (real-time
 * между departAt и arriveAt).
 */
import { useEffect, useMemo, useState, useRef } from 'react';

function projector(sites) {
  const geo = sites.filter((s) => s.lat != null && s.lng != null);
  if (!geo.length) return null;
  let minLat = 1e9, maxLat = -1e9, minLng = 1e9, maxLng = -1e9;
  geo.forEach((s) => {
    minLat = Math.min(minLat, s.lat); maxLat = Math.max(maxLat, s.lat);
    minLng = Math.min(minLng, s.lng); maxLng = Math.max(maxLng, s.lng);
  });
  const padLat = (maxLat - minLat) * 0.15 || 1;
  const padLng = (maxLng - minLng) * 0.15 || 1;
  minLat -= padLat; maxLat += padLat; minLng -= padLng; maxLng += padLng;
  return (lat, lng, W, H) => ({
    x: ((lng - minLng) / (maxLng - minLng)) * (W - 160) + 100,
    y: (1 - (lat - minLat) / (maxLat - minLat)) * (H - 160) + 80
  });
}

// 23.06.2026 BUG-FIX (Sites D-M2): добавлены остальные значения sites.site_type
// (terminal/refinery/port/office/object). До фикса все они рендерились дефолтным 🏗
// и были визуально неразличимы на карте.
const SITE_EMOJI = {
  platform: '🛢',
  plant:    '🏭',
  refinery: '🛢',
  terminal: '⛴',
  port:     '⚓',
  office:   '🏢',
  object:   '🏗',
  other:    '🏗'
};

export function MapStage({ sites, flights, onSite, onFlight }) {
  const ref = useRef(null);
  const [size, setSize] = useState({ W: 900, H: 480 });
  const [tick, setTick] = useState(0);
  // v2 BONUS: показ/скрытие легенды (vanilla PIXI-карта не имела вообще)
  const [showLegend, setShowLegend] = useState(true);
  // v2 BONUS: fullscreen toggle (vanilla не имеет)
  const [full, setFull] = useState(false);

  useEffect(() => {
    const update = () => {
      if (!ref.current) return;
      const r = ref.current.getBoundingClientRect();
      setSize({ W: Math.max(640, Math.floor(r.width)), H: Math.max(420, Math.floor(r.height)) });
    };
    update();
    const ro = new ResizeObserver(update);
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  // авто-перерисовка раз в 30с (двигаются точки рейсов)
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const proj = useMemo(() => projector(sites), [sites]);

  if (!proj) {
    return (
      <div className="cmap-stage" ref={ref}>
        <div className="cmap-hint">
          <div className="fs-32">🗺</div>
          <div>У объектов не заданы координаты (lat/lng).</div>
          <div className="c-t3">Заполните их в карточке объекта — и они появятся на карте.</div>
        </div>
      </div>
    );
  }

  const { W, H } = size;
  const HUB = { x: 60, y: H / 2 };

  const sitePos = {};
  const sitesWithPos = [];
  sites.forEach((s) => {
    if (s.lat == null || s.lng == null) return;
    const p = proj(s.lat, s.lng, W, H);
    sitePos[s.id] = p;
    sitesWithPos.push({ s, p });
  });

  const now = Date.now();
  // eslint-disable-next-line no-unused-vars
  const _t = tick;

  // v2 BONUS: счётчик активных рейсов в зоне видимости (vanilla не имеет)
  const visibleFlightsCnt = (flights || []).filter((f) => {
    if (!f.site || !sitePos[f.site.id]) return false;
    const dep = f.departAt ? new Date(f.departAt).getTime() : null;
    const arr = f.arriveAt ? new Date(f.arriveAt).getTime() : null;
    if ((arr && now > arr + 6 * 3600e3) || (dep && now < dep - 24 * 3600e3)) return false;
    return true;
  }).length;

  return (
    <div className={'cmap-stage' + (full ? ' cmap-stage--full' : '')} ref={ref}
         style={full ? { position: 'fixed', inset: 0, zIndex: 9000, background: 'var(--bg)', padding: 12 } : undefined}>
      {/* v2 BONUS: панель управления — fullscreen + toggle legend (vanilla PIXI-карта без неё) */}
      <div style={{ position: 'absolute', top: 8, right: 12, zIndex: 3, display: 'flex', gap: 6 }}>
        <button
          type="button"
          onClick={() => setShowLegend((v) => !v)}
          title={showLegend ? 'Скрыть легенду' : 'Показать легенду'}
          style={{ background: 'var(--inner-bg)', border: '1px solid var(--brd-1)', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12, color: 'var(--t-2)' }}
        >{showLegend ? '👁 Легенда' : '🙈 Легенда'}</button>
        <button
          type="button"
          onClick={() => setFull((v) => !v)}
          title={full ? 'Свернуть карту' : 'Развернуть карту на весь экран'}
          style={{ background: 'var(--inner-bg)', border: '1px solid var(--brd-1)', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12, color: 'var(--t-2)' }}
        >{full ? '🗗 Свернуть' : '🗖 Развернуть'}</button>
      </div>
      {/* v2 BONUS: легенда с эмодзи-знаками карты и счётчиками (vanilla не имеет) */}
      {showLegend && (
        <div style={{
          position: 'absolute', left: 12, bottom: 12, zIndex: 3,
          background: 'rgba(0,0,0,.48)', backdropFilter: 'blur(6px)',
          border: '1px solid var(--brd-1)', borderRadius: 8, padding: '8px 12px',
          fontSize: 11, color: 'var(--t-1)', display: 'grid', gap: 4, minWidth: 180
        }}>
          <div style={{ fontWeight: 700, marginBottom: 2 }}>Легенда</div>
          <div>🛢 платформа · 🏭 завод · 🏗 объект</div>
          <div>🛫 ХАБ (база) · линия пунктиром — маршрут</div>
          <div>✈ 🚂 🚌 — рейс в движении</div>
          <div>🟢 есть на смене · ⚫ никого</div>
          <div style={{ marginTop: 4, color: 'var(--gold)', fontWeight: 600 }}>
            Объектов: {sitesWithPos.length} · в рейсах: {visibleFlightsCnt}
          </div>
        </div>
      )}
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        {/* линии рейсов */}
        {(flights || []).map((f) => {
          if (!f.site || !sitePos[f.site.id]) return null;
          const dest = sitePos[f.site.id];
          const a = f.dir === 'home' ? dest : HUB;
          const b = f.dir === 'home' ? HUB : dest;
          return (
            <line
              key={'l' + f.id}
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke="var(--blue)" strokeWidth="2" opacity="0.28"
              strokeDasharray="6 4"
            />
          );
        })}

        {/* хаб */}
        <g>
          <rect x={HUB.x - 26} y={HUB.y - 18} width="52" height="36" rx="8"
                fill="var(--inner-bg)" stroke="var(--brd-1)" />
          <text x={HUB.x} y={HUB.y + 6} fontSize="18" textAnchor="middle" fill="var(--gold)">🛫</text>
          <text x={HUB.x} y={HUB.y + 32} fontSize="11" textAnchor="middle" fill="var(--gold)" fontWeight="800">ХАБ</text>
        </g>

        {/* объекты */}
        {sitesWithPos.map(({ s, p }) => {
          const onShift = (s.crew && s.crew.onShift) || 0;
          const wk = s.crew ? s.crew.workers + s.crew.masters : 0;
          return (
            <g key={'s' + s.id} className="cmap-site-pin" onClick={() => onSite?.(s)}>
              <circle cx={p.x} cy={p.y} r="34" fill="var(--blue)" opacity="0.16" />
              <circle cx={p.x} cy={p.y} r="22" fill="var(--inner-bg)" stroke="var(--gold)" strokeWidth="2.5" />
              <circle cx={p.x} cy={p.y - 2} r="9" fill={onShift > 0 ? 'var(--ok)' : 'var(--t-3)'} />
              <text x={p.x} y={p.y + 3} fontSize="16" textAnchor="middle">{SITE_EMOJI[s.site_type] || SITE_EMOJI.other}</text>
              <text x={p.x} y={p.y + 32} fontSize="12" textAnchor="middle" fill="var(--t-1)" fontWeight="800">
                {s.name || ('Объект #' + s.id)}
              </text>
              <text x={p.x} y={p.y + 50} fontSize="11" textAnchor="middle" fill="var(--gold)" fontWeight="700">
                👷 {wk} · 🟢 {onShift}
              </text>
            </g>
          );
        })}

        {/* движущиеся точки рейсов */}
        {(flights || []).map((f) => {
          if (!f.site || !sitePos[f.site.id]) return null;
          const dest = sitePos[f.site.id];
          const a = f.dir === 'home' ? dest : HUB;
          const b = f.dir === 'home' ? HUB : dest;
          const dep = f.departAt ? new Date(f.departAt).getTime() : null;
          const arr = f.arriveAt ? new Date(f.arriveAt).getTime() : null;
          let t = 0.5;
          if (dep && arr && arr > dep) t = Math.max(0, Math.min(1, (now - dep) / (arr - dep)));
          // прячем если прибыл >6 часов назад или вылет ещё через 24+ часов
          if ((arr && now > arr + 6 * 3600e3) || (dep && now < dep - 24 * 3600e3)) return null;
          const x = a.x + (b.x - a.x) * t;
          const y = a.y + (b.y - a.y) * t;
          const ic = f.item_type === 'train' ? '🚂' : f.item_type === 'transfer' ? '🚌' : '✈';
          return (
            <g key={'v' + f.id} className="cur-p" onClick={() => onFlight?.(f)}>
              <circle cx={x} cy={y} r="6" fill="var(--t-1)" />
              <circle cx={x} cy={y} r="3" fill="var(--blue)" />
              <text x={x} y={y - 12} fontSize="14" textAnchor="middle">{ic}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
