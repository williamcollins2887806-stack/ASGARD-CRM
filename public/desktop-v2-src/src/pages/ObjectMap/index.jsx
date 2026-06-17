/**
 * Страница /object-map — Карта объектов.
 *
 * Источник: vanilla `public/assets/js/object_map.js` (~664 строки).
 *
 * Реализация: Leaflet + OpenStreetMap + MarkerCluster. CDN-библиотеки подгружаются
 * лениво при первом монтировании страницы (CSS+JS). Тема карты переключается:
 *  - dark: CARTO voyager
 *  - light: OSM standard
 *
 *   - Toolbar: фильтры (Все / Активные / В тендере / Завершённые / Без координат) + кнопки «+ Объект» и «Список»
 *   - Stats: счётчики по типам
 *   - Map: круговые маркеры по статусам, кластеризация, popup, click→drawer
 *   - Drawer (использует DrawerModal): досье объекта — карточка, KPI, работы по годам, тендеры
 *   - Add modal (FormModal): создание объекта + автогеокодинг
 *   - Manual placement: при создании без координат — клик по карте задаёт точку (+reverse-geocode Nominatim)
 *   - List view (DrawerModal): все объекты с переходом по клику
 *
 * Endpoints:
 *   GET  /api/sites
 *   GET  /api/sites/:id
 *   POST /api/sites
 *   PUT  /api/sites/:id
 *   POST /api/sites/geocode
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { useTheme } from '@/theme/ThemeProvider';
import { toast } from '@/modals/Notifications';
import { Btn, MHead, MCard, MBody, MFoot, Field } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import AccessDenied from '@/blocks/AccessDenied';
import { TextInput, SelectInput } from '@/inputs/Inputs';
import { DrawerModal } from '@/modals/Drawer';
import './object-map.css';

// RBAC синхронно с backend `src/routes/sites.js`. GET /api/sites — auth-only,
// но POST/PUT/DELETE — `requireRoles(['ADMIN','PM','HEAD_PM','DIRECTOR_GEN'])`.
// Карту смотрят все, кто хоть как-то работает с проектами; добавление объектов
// и привязка координат — только указанные роли. Inline-литералы (для rbac-audit).
const VIEW_ROLES = [
  'ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO',
  'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV',
  'HR', 'HR_MANAGER', 'BUH', 'OFFICE_MANAGER', 'CHIEF_ENGINEER',
  'WAREHOUSE', 'PROC'
];
const WRITE_ROLES = ['ADMIN', 'PM', 'HEAD_PM', 'DIRECTOR_GEN'];

const DRAWER_OPTS = { shape: 'drawer-right' };

const PIN_COLORS = {
  active: 'var(--ok)',
  tender: 'var(--amber)',
  done: 'var(--t-3)',
  pending: 'var(--err)',
  unknown: 'var(--info)'
};

const STATUS_LABELS = {
  active: 'Активный',
  tender: 'В тендере',
  done: 'Завершённый',
  pending: 'Без координат',
  unknown: 'Новый'
};

const STATUS_ICONS = {
  active: '🟢', tender: '🟡', done: '⚪', pending: '🔴', unknown: '🔵'
};

const SITE_TYPES = [
  { value: 'platform', label: 'Морская платформа' },
  { value: 'terminal', label: 'Терминал' },
  { value: 'refinery', label: 'НПЗ' },
  { value: 'port', label: 'Порт' },
  { value: 'plant', label: 'Завод' },
  { value: 'office', label: 'Офис' },
  { value: 'object', label: 'Объект' }
];

function getSiteStatus(site) {
  if (site.geocode_status === 'pending') return 'pending';
  if (site.active_works > 0) return 'active';
  if (site.tenders_count > 0 && site.works_count === 0) return 'tender';
  if (site.works_count > 0) return 'done';
  return 'unknown';
}

function fmtRub(v) {
  const n = Number(v || 0);
  if (n >= 1e6) return (n / 1e6).toFixed(1) + ' млн ₽';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + ' тыс ₽';
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n) + ' ₽';
}

function workStatusIcon(s) {
  const st = (s || '').toLowerCase();
  if (/завершён|сдали|done|готов/.test(st)) return '✅';
  if (/в работе|на объекте|мобилизация/.test(st)) return '🟢';
  if (/приостановлен|отложен/.test(st)) return '🟡';
  if (/отменён|отказ/.test(st)) return '🔴';
  return '🔵';
}

/* ─── Динамическая загрузка Leaflet с CDN ─── */
let leafletLoadingPromise = null;
function loadLeaflet() {
  if (window.L && window.L.markerClusterGroup) return Promise.resolve(window.L);
  if (leafletLoadingPromise) return leafletLoadingPromise;
  leafletLoadingPromise = new Promise((resolve, reject) => {
    const cssUrls = [
      'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
      'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css',
      'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css'
    ];
    cssUrls.forEach((url) => {
      if (!document.querySelector(`link[href="${url}"]`)) {
        const l = document.createElement('link');
        l.rel = 'stylesheet';
        l.href = url;
        document.head.appendChild(l);
      }
    });
    const loadScript = (src) => new Promise((res, rej) => {
      if (document.querySelector(`script[src="${src}"]`)) return res();
      const s = document.createElement('script');
      s.src = src;
      s.onload = res;
      s.onerror = rej;
      document.head.appendChild(s);
    });
    loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js')
      .then(() => loadScript('https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js'))
      .then(() => resolve(window.L))
      .catch(reject);
  });
  return leafletLoadingPromise;
}

export default function ObjectMapPage() {
  const { user } = useAuth();
  const { theme } = useTheme();
  const { open, close } = useModal();

  const [sites, setSites] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [mapReady, setMapReady] = useState(false);

  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const clusterGroupRef = useRef(null);
  const tileLayerRef = useRef(null);
  const editStateRef = useRef({ mode: false, siteId: null, marker: null });

  const loadSites = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetch('/api/sites', {
        headers: { Authorization: 'Bearer ' + (localStorage.getItem('asgard_token') || '') }
      }).then((r) => r.json());
      setSites(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.error('Не удалось загрузить объекты');
      setSites([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Инициализация карты
  useEffect(() => {
    let cancelled = false;
    loadLeaflet()
      .then((L) => {
        if (cancelled || !mapRef.current || mapInstanceRef.current) return;
        const map = L.map(mapRef.current, { center: [62, 80], zoom: 3, zoomControl: true });
        mapInstanceRef.current = map;

        tileLayerRef.current = getTileLayer(L, theme).addTo(map);

        clusterGroupRef.current = L.markerClusterGroup({
          showCoverageOnHover: false,
          maxClusterRadius: 50,
          spiderfyOnMaxZoom: true,
          iconCreateFunction: (cluster) => {
            const count = cluster.getChildCount();
            let size = 'small';
            if (count >= 100) size = 'large';
            else if (count >= 10) size = 'medium';
            return L.divIcon({
              html: '<div>' + count + '</div>',
              className: 'marker-cluster marker-cluster-' + size,
              iconSize: L.point(40, 40)
            });
          }
        });
        map.addLayer(clusterGroupRef.current);

        map.on('click', (e) => {
          if (editStateRef.current.mode) {
            handlePlacementClick(e.latlng.lat, e.latlng.lng);
          }
        });

        setMapReady(true);
      })
      .catch(() => toast.error('Не удалось загрузить карту'));

    return () => {
      cancelled = true;
      if (mapInstanceRef.current) {
        try { mapInstanceRef.current.remove(); } catch { /* ignore */ }
        mapInstanceRef.current = null;
        clusterGroupRef.current = null;
        tileLayerRef.current = null;
        setMapReady(false);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Загрузка данных при монтировании
  useEffect(() => { loadSites(); }, [loadSites]);

  // Реакция на смену темы — заменить tile layer
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !window.L) return;
    const L = window.L;
    const map = mapInstanceRef.current;
    if (tileLayerRef.current) {
      try { map.removeLayer(tileLayerRef.current); } catch { /* ignore */ }
    }
    tileLayerRef.current = getTileLayer(L, theme).addTo(map);
  }, [theme, mapReady]);

  // Реакция на смену sites/filter — перерендер маркеров
  useEffect(() => {
    if (!mapReady || !clusterGroupRef.current || !window.L) return;
    renderMarkers();
    // авто-zoom при первом рендере
    if (sites.length > 0) {
      try {
        const bounds = clusterGroupRef.current.getBounds();
        if (bounds && bounds.isValid()) {
          mapInstanceRef.current.fitBounds(bounds, { padding: [40, 40] });
        }
      } catch { /* ignore */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sites, filter, mapReady]);

  function renderMarkers() {
    if (!clusterGroupRef.current || !window.L) return;
    const L = window.L;
    clusterGroupRef.current.clearLayers();

    const filtered = sites.filter((s) => {
      if (!s.lat || !s.lng) return filter === 'pending' || filter === 'all';
      if (filter === 'all') return true;
      return getSiteStatus(s) === filter;
    });

    const markers = filtered
      .filter((s) => s.lat && s.lng)
      .map((s) => {
        const status = getSiteStatus(s);
        const color = resolveCssVar(PIN_COLORS[status] || PIN_COLORS.unknown);
        const marker = L.circleMarker([s.lat, s.lng], {
          radius: 8,
          fillColor: color,
          color: '#fff',
          weight: 2,
          opacity: 1,
          fillOpacity: 0.85
        });
        marker.bindPopup(`
          <div style="min-width:200px;font-family:Inter,sans-serif;color:var(--t-1)">
            <div style="font-weight:700;font-size:14px;margin-bottom:4px">${escapeHtml(s.name || '')}</div>
            <div style="font-size:12px;color:var(--t-2);margin-bottom:8px">${escapeHtml(s.customer_name || '')}</div>
            <div style="font-size:12px">
              Работ: <b>${s.works_count || 0}</b> · Активных: <b style="color:${color}">${s.active_works || 0}</b>
            </div>
            ${s.region ? `<div style="font-size:11px;color:var(--t-3);margin-top:4px">${escapeHtml(s.region)}</div>` : ''}
          </div>
        `);
        marker.bindTooltip(s.name || '');
        marker.on('click', () => openSiteDrawer(s.id));
        return marker;
      });
    clusterGroupRef.current.addLayers(markers);
  }

  /* ─── Drawer объекта (досье) ─── */
  async function openSiteDrawer(siteId) {
    open(
      <SiteDrawer siteId={siteId} onStartPlacement={(id) => startManualPlacement(id)} onClose={close} />,
      DRAWER_OPTS
    );
  }

  /* ─── Ручная привязка координат ─── */
  function startManualPlacement(siteId) {
    editStateRef.current = { mode: true, siteId, marker: null };
    if (mapRef.current) mapRef.current.style.cursor = 'crosshair';
    toast.info('Кликните на карте, чтобы указать местоположение объекта', { duration: 8000 });
  }

  async function handlePlacementClick(lat, lng) {
    const state = editStateRef.current;
    if (!state.mode || !state.siteId || !window.L) return;
    const L = window.L;
    const map = mapInstanceRef.current;

    if (state.marker) {
      try { map.removeLayer(state.marker); } catch { /* ignore */ }
    }
    const tmp = L.marker([lat, lng]).addTo(map);
    editStateRef.current.marker = tmp;

    let regionName = '';
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=ru`
      );
      const data = await r.json();
      regionName = data?.address?.state || data?.address?.region || data?.address?.city || '';
    } catch { /* ignore */ }

    try {
      await fetch('/api/sites/' + state.siteId, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + (localStorage.getItem('asgard_token') || '')
        },
        body: JSON.stringify({ lat, lng, region: regionName, geocode_status: 'manual' })
      });
      toast.success('Координаты объекта обновлены');
      editStateRef.current = { mode: false, siteId: null, marker: null };
      try { map.removeLayer(tmp); } catch { /* ignore */ }
      if (mapRef.current) mapRef.current.style.cursor = '';
      await loadSites();
    } catch (e) {
      toast.error(`Не удалось сохранить координаты: ${e?.message || e}`);
    }
  }

  /* ─── Создание объекта ─── */
  function openAddSiteModal() {
    open(<AddSiteModal onCreated={async (newSite, needsManual) => {
      await loadSites();
      if (needsManual) {
        startManualPlacement(newSite.id);
      } else if (newSite.lat && newSite.lng && mapInstanceRef.current) {
        mapInstanceRef.current.setView([newSite.lat, newSite.lng], 10, { animate: true, duration: 0.5 });
      }
    }} onClose={close} />);
  }

  /* ─── Drawer списка объектов ─── */
  function openListView() {
    open(
      <ListDrawer
        sites={sites}
        onPick={(site) => {
          close();
          if (site.lat && site.lng && mapInstanceRef.current) {
            mapInstanceRef.current.setView([site.lat, site.lng], 12, { animate: true, duration: 0.5 });
          }
          setTimeout(() => openSiteDrawer(site.id), 400);
        }}
        onClose={close}
      />,
      DRAWER_OPTS
    );
  }

  /* ─── Статистика ─── */
  const stats = {
    total: sites.length,
    active: sites.filter((s) => s.active_works > 0).length,
    tender: sites.filter((s) => s.tenders_count > 0 && s.active_works === 0).length,
    pending: sites.filter((s) => s.geocode_status === 'pending').length
  };

  if (!user) return null;

  // Inline-RBAC-гейт (после всех хуков — Rules of Hooks).
  // Карта рассчитана на участников проектной деятельности; гостевые/неизвестные
  // роли — увидят явное сообщение, а не пустую страницу.
  if (!VIEW_ROLES.includes(user.role)) {
    return (
      <AccessDenied
        allowed={VIEW_ROLES}
        userRole={user.role}
        title="Карта объектов недоступна"
        message="Раздел открыт ролям, работающим с проектами: PM/HEAD_PM, TO/HEAD_TO, директорам, HR, BUH, складу, закупкам, инженеру, офис-менеджеру и ADMIN."
      />
    );
  }

  const canCreate = WRITE_ROLES.includes(user.role);

  return (
    <div className="map-page">
      <TopActionsBar
        kicker="Аналитика"
        title="Карта объектов"
        subtitle={`${stats.total} объектов · ${stats.active} активных · ${stats.tender} в тендере${stats.pending ? ' · ' + stats.pending + ' без координат' : ''}`}
        actions={
          <>
            <Btn variant="ghost" onClick={openListView}>📋 Список</Btn>
            {canCreate && <Btn variant="primary" onClick={openAddSiteModal}>+ Объект</Btn>}
          </>
        }
      />

      <div className="map-toolbar">
        <div className="map-filters">
          {[
            { id: 'all', label: 'Все', count: stats.total },
            { id: 'active', label: '🟢 Активные', count: stats.active },
            { id: 'tender', label: '🟡 В тендере', count: stats.tender },
            { id: 'done', label: '⚪ Завершённые', count: sites.filter((s) => getSiteStatus(s) === 'done').length },
            { id: 'pending', label: '🔴 Без координат', count: stats.pending }
          ].map((f) => (
            <button
              key={f.id}
              className={'map-filter ' + (filter === f.id ? 'active' : '')}
              onClick={() => setFilter(f.id)}
              type="button"
            >
              {f.label} <span className="cnt">{f.count}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="map-container">
        <div ref={mapRef} className="map-leaflet" />
        {loading && (
          <div className="map-loading">⏳ Загружаем объекты…</div>
        )}
        {!loading && sites.length === 0 && (
          <div className="map-empty">
            <EmptyState
              icon="📍"
              title="Нет объектов"
              hint={canCreate ? 'Создайте первый объект с помощью кнопки «+ Объект».' : 'Объектов пока нет. Создание доступно ADMIN/PM/HEAD_PM/директору.'}
              action={canCreate ? <Btn variant="primary" onClick={openAddSiteModal}>+ Объект</Btn> : null}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * Sub-component: SiteDrawer — досье объекта
 * ═══════════════════════════════════════════════════════════════════════ */
function SiteDrawer({ siteId, onStartPlacement, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/sites/' + siteId, {
      headers: { Authorization: 'Bearer ' + (localStorage.getItem('asgard_token') || '') }
    })
      .then((r) => r.json())
      .then(setData)
      .catch((e) => toast.error(`Ошибка загрузки: ${e?.message || e}`))
      .finally(() => setLoading(false));
  }, [siteId]);

  if (loading) {
    return (
      <DrawerModal title="Загрузка…" onClose={onClose}>
        <div className="p-24 t-center c-t3">⏳ Загружаем досье…</div>
      </DrawerModal>
    );
  }

  const site = data?.site || {};
  const works = Array.isArray(data?.works) ? data.works : [];
  const tenders = Array.isArray(data?.tenders) ? data.tenders : [];
  const status = getSiteStatus(site);

  // Группировка работ по годам
  const worksByYear = {};
  for (const w of works) {
    const year = w.created_at ? new Date(w.created_at).getFullYear() : 'Без даты';
    if (!worksByYear[year]) worksByYear[year] = [];
    worksByYear[year].push(w);
  }
  const sortedYears = Object.keys(worksByYear).sort((a, b) => b - a);
  const totalContract = works.reduce((s, w) => s + Number(w.contract_value || 0), 0);

  return (
    <DrawerModal
      title={site.name || 'Объект'}
      icon="📍"
      onClose={onClose}
      footer={
        <>
          <Btn variant="ghost" onClick={() => { window.location.hash = '#/pm-works?site_id=' + site.id; onClose(); }}>⚒️ Работы</Btn>
          <Btn variant="ghost" onClick={() => { window.location.hash = '#/tenders?site_id=' + site.id; onClose(); }}>📋 Тендеры</Btn>
          <Btn variant="primary" onClick={onClose}>Закрыть</Btn>
        </>
      }
    >
        <div className="site-card">
          <div className="site-card-status">
            {STATUS_ICONS[status]} {STATUS_LABELS[status]}
          </div>
          <div className="site-card-name">{site.name}</div>
          {site.customer_name && <div className="site-card-customer">{site.customer_name}</div>}
          {site.region && <div className="site-card-region">{site.region}</div>}
          {site.address && <div className="site-card-address">{site.address}</div>}
        </div>

        <div className="site-summary">
          <SummaryItem value={works.length} label="Работ" />
          <SummaryItem value={works.filter((w) => /в работе|на объекте|мобилизация/i.test(w.work_status || '')).length} label="Активных" />
          <SummaryItem value={tenders.length} label="Тендеров" />
          <SummaryItem value={fmtRub(totalContract)} label="Контракты" small />
        </div>

        {site.geocode_status === 'pending' && (
          <div className="site-geocode-warning">
            <span className="fs-22">⚠️</span>
            <div className="flex-1">
              <div className="fw-700">Координаты не подтверждены</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>Нажмите на нужное место на карте для привязки</div>
            </div>
            <Btn variant="primary" onClick={() => { onClose(); onStartPlacement(site.id); }}>Указать</Btn>
          </div>
        )}

        {works.length === 0 ? (
          <EmptyState icon="⚒️" title="Нет работ" hint="По этому объекту работы пока не велись." action={null} />
        ) : sortedYears.map((year) => (
          <div key={year}>
            <div className="drawer-section">{year} · {worksByYear[year].length} работ</div>
            {worksByYear[year].map((w) => (
              <div
                key={w.id}
                className="site-work-card"
                onClick={() => { window.location.hash = '#/pm-works?id=' + w.id; onClose(); }}
              >
                <div className="swc-header">
                  <span className="swc-icon">{workStatusIcon(w.work_status)}</span>
                  <div className="swc-title">{w.work_title || w.work_number || 'Без названия'}</div>
                </div>
                <div className="swc-meta">
                  <span className="swc-status">{w.work_status || '—'}</span>
                  {w.contract_value ? <span className="swc-money">{fmtRub(w.contract_value)}</span> : null}
                </div>
                {w.pm_name && <div className="swc-pm">РП: {w.pm_name}</div>}
                {(w.date_start || w.date_end) && (
                  <div className="swc-dates">{fmtDate(w.date_start)} — {fmtDate(w.date_end)}</div>
                )}
              </div>
            ))}
          </div>
        ))}

        {tenders.length > 0 && (
          <div>
            <div className="drawer-section">Тендеры · {tenders.length}</div>
            {tenders.map((t) => (
              <div
                key={t.id}
                className="site-work-card"
                onClick={() => { window.location.hash = '#/tenders?id=' + t.id; onClose(); }}
              >
                <div className="swc-header">
                  <span className="swc-icon">📋</span>
                  <div className="swc-title">{t.tender_title || t.purchase_number || 'Без названия'}</div>
                </div>
                <div className="swc-meta">
                  <span className="swc-status">{t.status || '—'}</span>
                  {t.max_price ? <span className="swc-money">{fmtRub(t.max_price)}</span> : null}
                </div>
              </div>
            ))}
          </div>
        )}
    </DrawerModal>
  );
}

function SummaryItem({ value, label, small }) {
  return (
    <div className="site-summary-item">
      <div className="ssi-val" style={small ? { fontSize: 16 } : undefined}>{value}</div>
      <div className="ssi-label">{label}</div>
    </div>
  );
}

function fmtDate(iso) {
  if (!iso) return '?';
  try { return new Date(iso).toLocaleDateString('ru-RU'); } catch { return '?'; }
}

/* ═══════════════════════════════════════════════════════════════════════
 * Sub-component: AddSiteModal — создание объекта + автогеокодинг
 * ═══════════════════════════════════════════════════════════════════════ */
function AddSiteModal({ onCreated, onClose }) {
  const [name, setName] = useState('');
  const [customer, setCustomer] = useState('');
  const [siteType, setSiteType] = useState('object');
  const [address, setAddress] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Укажите название объекта');
      return;
    }
    setSubmitting(true);
    let lat = null, lng = null, region = '', geoStatus = 'pending';

    if (address.trim() || customer.trim()) {
      try {
        toast.info('Ищем координаты…', { duration: 2000 });
        const geo = await fetch('/api/sites/geocode', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + (localStorage.getItem('asgard_token') || '')
          },
          body: JSON.stringify({ address: [name, customer, address].filter(Boolean).join(', ') })
        }).then((r) => r.json());

        if (geo.found && geo.highConfidence) {
          lat = geo.lat; lng = geo.lng; region = geo.region;
          geoStatus = 'auto';
          toast.success(geo.displayName);
        } else if (geo.found) {
          lat = geo.lat; lng = geo.lng; region = geo.region;
          geoStatus = 'pending';
          toast.warn('Координаты приблизительные — уточните на карте', { duration: 5000 });
        } else {
          toast.warn('Не найдено — укажите местоположение вручную на карте', { duration: 5000 });
        }
      } catch (e) {
        toast.error(`Геокодер: ${e?.message || e}`);
      }
    }

    try {
      const created = await fetch('/api/sites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + (localStorage.getItem('asgard_token') || '')
        },
        body: JSON.stringify({
          name: name.trim(),
          customer_name: customer.trim(),
          site_type: siteType,
          address: address.trim(),
          lat, lng, region, geocode_status: geoStatus
        })
      }).then((r) => r.json());

      onClose();
      onCreated(created, geoStatus === 'pending');
    } catch (e) {
      toast.error(`Не удалось создать: ${e?.message || e}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <MCard>
      <MHead icon="📍" title="Новый объект" subtitle="Создание объекта с автоматической привязкой координат" onClose={onClose} />
      <MBody>
        <Field label="Название объекта" required>
          <TextInput value={name} onChange={setName} placeholder="МЛСП «Приразломная»" />
        </Field>
        <Field label="Заказчик">
          <TextInput value={customer} onChange={setCustomer} placeholder="ООО Заказчик А" />
        </Field>
        <Field label="Тип объекта">
          <SelectInput value={siteType} onChange={setSiteType} options={SITE_TYPES} />
        </Field>
        <Field label="Адрес / местоположение" help="Для автогеокодинга. Чем точнее — тем лучше.">
          <TextInput value={address} onChange={setAddress} placeholder="Печорское море, 60 км от берега" />
        </Field>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={onClose}>Отмена</Btn>
        <Btn variant="primary" onClick={handleSave} disabled={submitting}>
          {submitting ? '⏳ Создаём…' : 'Создать и найти на карте'}
        </Btn>
      </MFoot>
    </MCard>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * Sub-component: ListDrawer — список всех объектов
 * ═══════════════════════════════════════════════════════════════════════ */
function ListDrawer({ sites, onPick, onClose }) {
  const [q, setQ] = useState('');
  const sorted = [...sites]
    .filter((s) => !q || (s.name || '').toLowerCase().includes(q.toLowerCase()) || (s.customer_name || '').toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (b.active_works || 0) - (a.active_works || 0));

  return (
    <DrawerModal
      title={`Все объекты (${sites.length})`}
      icon="📋"
      onClose={onClose}
      footer={<Btn variant="primary" onClick={onClose}>Закрыть</Btn>}
    >
      <div className="mb-12">
        <TextInput value={q} onChange={setQ} placeholder="Поиск по объекту или заказчику…" icon="🔍" clearable />
      </div>
      {sorted.length === 0 ? (
        <EmptyState icon="🔍" title="Ничего не найдено" hint="Попробуйте изменить запрос." action={null} />
      ) : (
        <div className="site-list">
          {sorted.map((s) => {
            const status = getSiteStatus(s);
            const color = PIN_COLORS[status];
            return (
              <div
                key={s.id}
                className="site-list-item"
                onClick={() => onPick(s)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(s); } }}
                role="button"
                tabIndex={0}
                aria-label={`Объект: ${s.name}`}
              >
                <div className="sli-dot" style={{ background: color }} />
                <div className="sli-info">
                  <div className="sli-name">{s.name}</div>
                  <div className="sli-meta">{s.customer_name || ''}{s.region ? ' · ' + s.region : ''}</div>
                </div>
                <div className="sli-stats">
                  <span className="sli-badge">{s.works_count || 0} работ</span>
                  {s.active_works > 0 && <span className="sli-badge green">{s.active_works} акт.</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </DrawerModal>
  );
}

/* ─── Утилиты ─── */
function getTileLayer(L, theme) {
  const isLight = theme === 'light';
  if (isLight) {
    return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19
    });
  }
  return L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OSM &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 19
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function resolveCssVar(c) {
  if (!c) return '#888';
  if (typeof c === 'string' && c.startsWith('var(')) {
    const name = c.slice(4, -1).trim();
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || '#888';
  }
  return c;
}
