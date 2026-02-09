/**
 * АСГАРД CRM — Карта объектов
 * Яндекс.Карты 2.1 + кластеризация + drawer
 */
window.AsgardObjectMap = (function() {
  const { $, $$, esc, toast, showDrawer, hideDrawer, showModal, hideModal } = AsgardUI;

  let map = null;
  let clusterer = null;
  let sites = [];
  let editMode = false;
  let editingSiteId = null;

  // ═════════════════════════════════════════════════════════════
  // PIN COLORS BY STATUS
  // ═════════════════════════════════════════════════════════════
  const PIN_COLORS = {
    active:   { preset: 'islands#greenCircleDotIcon',   color: '#22c55e' },
    tender:   { preset: 'islands#yellowCircleDotIcon',  color: '#f59e0b' },
    done:     { preset: 'islands#grayCircleDotIcon',    color: '#94a3b8' },
    pending:  { preset: 'islands#redCircleDotIcon',     color: '#ef4444' },
    unknown:  { preset: 'islands#blueCircleDotIcon',    color: '#3b82f6' }
  };

  function getSiteStatus(site) {
    if (site.geocode_status === 'pending') return 'pending';
    if (site.active_works > 0) return 'active';
    if (site.tenders_count > 0 && site.works_count === 0) return 'tender';
    if (site.works_count > 0) return 'done';
    return 'unknown';
  }

  // ═════════════════════════════════════════════════════════════
  // RENDER PAGE
  // ═════════════════════════════════════════════════════════════
  async function render({ layout, title }) {
    const html = `
      <div class="map-page">
        <div class="map-toolbar">
          <div class="map-filters">
            <button class="btn ghost map-filter active" data-filter="all">Все</button>
            <button class="btn ghost map-filter" data-filter="active">🟢 Активные</button>
            <button class="btn ghost map-filter" data-filter="tender">🟡 В тендере</button>
            <button class="btn ghost map-filter" data-filter="done">⚪ Завершённые</button>
            <button class="btn ghost map-filter" data-filter="pending">🔴 Без координат</button>
          </div>
          <div class="map-actions">
            <button class="btn ghost" id="btnAddSite" title="Добавить объект">+ Объект</button>
            <button class="btn ghost" id="btnMapList" title="Список">📋 Список</button>
          </div>
        </div>

        <div class="map-stats" id="mapStats"></div>

        <div class="map-container" id="mapContainer">
          <div id="yaMap" style="width:100%;height:100%"></div>
        </div>
      </div>
    `;

    await layout(html, { title: title || 'Карта объектов' });
    await loadSites();
    initMap();
    bindEvents();
  }

  // ═════════════════════════════════════════════════════════════
  // LOAD DATA
  // ═════════════════════════════════════════════════════════════
  async function loadSites() {
    try {
      const auth = await AsgardAuth.getAuth();
      const resp = await fetch('/api/sites', {
        headers: { 'Authorization': 'Bearer ' + auth.token }
      });
      sites = await resp.json();
      if (!Array.isArray(sites)) sites = [];
      updateStats();
    } catch (err) {
      toast('Ошибка', 'Не удалось загрузить объекты', 'err');
      sites = [];
    }
  }

  function updateStats() {
    const el = $('#mapStats');
    if (!el) return;

    const active = sites.filter(s => s.active_works > 0).length;
    const tender = sites.filter(s => s.tenders_count > 0 && s.active_works === 0).length;
    const pending = sites.filter(s => s.geocode_status === 'pending').length;

    el.innerHTML = `
      <div class="stat-chip"><span class="stat-num">${sites.length}</span> объектов</div>
      <div class="stat-chip green"><span class="stat-num">${active}</span> активных</div>
      <div class="stat-chip yellow"><span class="stat-num">${tender}</span> в тендере</div>
      ${pending > 0 ? `<div class="stat-chip red"><span class="stat-num">${pending}</span> без координат</div>` : ''}
    `;
  }

  // ═════════════════════════════════════════════════════════════
  // YANDEX MAP INITIALIZATION
  // ═════════════════════════════════════════════════════════════
  function initMap() {
    if (typeof ymaps === 'undefined') {
      toast('Ошибка', 'Яндекс.Карты не загружены. Проверьте API-ключ.', 'err');
      const el = document.getElementById('yaMap');
      if (el) el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted)">Карты недоступны</div>';
      return;
    }

    ymaps.ready(() => {
      map = new ymaps.Map('yaMap', {
        center: [62.0, 80.0],
        zoom: 3,
        controls: ['zoomControl', 'typeSelector', 'fullscreenControl', 'rulerControl']
      }, {
        searchControlProvider: 'yandex#search'
      });

      // Dark theme: CSS inversion
      if (document.documentElement.dataset.theme !== 'light') {
        const mapEl = document.getElementById('yaMap');
        if (mapEl) {
          mapEl.style.filter = 'invert(0.9) hue-rotate(180deg) saturate(0.3) brightness(0.8)';
        }
      }

      // Clusterer
      clusterer = new ymaps.Clusterer({
        preset: 'islands#invertedDarkBlueClusterIcons',
        clusterDisableClickZoom: false,
        clusterOpenBalloonOnClick: false,
        groupByCoordinates: false,
        clusterBalloonContentLayout: 'cluster#balloonCarousel',
        clusterIconLayout: 'default#pieChart',
        clusterIconPieChartRadius: 22,
        clusterIconPieChartCoreRadius: 14,
        clusterIconPieChartStrokeWidth: 2
      });

      clusterer.events.add('click', (e) => {
        const target = e.get('target');
        if (target.getGeoObjects) {
          map.setCenter(target.geometry.getCoordinates(), map.getZoom() + 2, { duration: 300 });
        }
      });

      addPlacemarks();
      map.geoObjects.add(clusterer);

      // Auto-zoom to fit all objects
      const withCoords = sites.filter(s => s.lat && s.lng);
      if (withCoords.length > 0) {
        map.setBounds(clusterer.getBounds(), { checkZoomRange: true, zoomMargin: 40 });
      }

      // Map click for manual placement mode
      map.events.add('click', (e) => {
        if (editMode) {
          onMapClickForPlacement(e.get('coords'));
        }
      });
    });
  }

  // ═════════════════════════════════════════════════════════════
  // PLACEMARKS
  // ═════════════════════════════════════════════════════════════
  function addPlacemarks(filter) {
    if (!clusterer) return;
    filter = filter || 'all';
    clusterer.removeAll();

    const filtered = sites.filter(s => {
      if (!s.lat || !s.lng) return filter === 'pending';
      if (filter === 'all') return true;
      return getSiteStatus(s) === filter;
    });

    const placemarks = filtered
      .filter(s => s.lat && s.lng)
      .map(s => {
        const status = getSiteStatus(s);
        const pin = PIN_COLORS[status] || PIN_COLORS.unknown;

        const pm = new ymaps.Placemark([s.lat, s.lng], {
          hintContent: s.name,
          balloonContent: `
            <div style="min-width:200px;font-family:Manrope,sans-serif">
              <div style="font-weight:700;font-size:14px;margin-bottom:4px">${esc(s.name)}</div>
              <div style="font-size:12px;color:#666;margin-bottom:8px">${esc(s.customer_name || '')}</div>
              <div style="font-size:12px">
                Работ: <b>${s.works_count || 0}</b> · Активных: <b style="color:${pin.color}">${s.active_works || 0}</b>
              </div>
              ${s.region ? `<div style="font-size:11px;color:#999;margin-top:4px">${esc(s.region)}</div>` : ''}
            </div>
          `,
          siteId: s.id,
          siteStatus: status
        }, {
          preset: pin.preset,
          iconColor: pin.color
        });

        pm.events.add('click', () => openSiteDrawer(s.id));
        return pm;
      });

    clusterer.add(placemarks);
  }

  // ═════════════════════════════════════════════════════════════
  // SITE DRAWER — FULL DOSSIER
  // ═════════════════════════════════════════════════════════════
  async function openSiteDrawer(siteId) {
    showDrawer({ title: 'Загрузка...', html: AsgardUI.skeleton('card', 3), width: 'wide' });

    try {
      const auth = await AsgardAuth.getAuth();
      const resp = await fetch('/api/sites/' + siteId, {
        headers: { 'Authorization': 'Bearer ' + auth.token }
      });
      const { site, works, tenders } = await resp.json();

      const status = getSiteStatus(site);
      const statusLabels = {
        active: '🟢 Активный',
        tender: '🟡 В тендере',
        done: '⚪ Завершённый',
        pending: '🔴 Без координат',
        unknown: '🔵 Новый'
      };

      // Group works by year
      const worksByYear = {};
      for (const w of works) {
        const year = w.created_at ? new Date(w.created_at).getFullYear() : 'Без даты';
        if (!worksByYear[year]) worksByYear[year] = [];
        worksByYear[year].push(w);
      }

      const totalContract = works.reduce((s, w) => s + Number(w.contract_value || 0), 0);

      const fmtRub = (v) => {
        const n = Number(v || 0);
        if (n >= 1000000) return (n / 1000000).toFixed(1) + ' млн ₽';
        if (n >= 1000) return (n / 1000).toFixed(0) + ' тыс ₽';
        return n.toLocaleString('ru-RU') + ' ₽';
      };

      const workStatusIcon = (s) => {
        const st = (s || '').toLowerCase();
        if (/завершён|сдали|done|готов/.test(st)) return '✅';
        if (/в работе|на объекте|мобилизация/.test(st)) return '🟢';
        if (/приостановлен|отложен/.test(st)) return '🟡';
        if (/отменён|отказ/.test(st)) return '🔴';
        return '🔵';
      };

      let worksHtml = '';
      const sortedYears = Object.keys(worksByYear).sort((a, b) => b - a);

      for (const year of sortedYears) {
        const yearWorks = worksByYear[year];
        worksHtml += `<div class="drawer-section">${year} · ${yearWorks.length} работ</div>`;
        for (const w of yearWorks) {
          worksHtml += `
            <div class="site-work-card" data-work-id="${w.id}">
              <div class="swc-header">
                <span class="swc-icon">${workStatusIcon(w.work_status)}</span>
                <div class="swc-title">${esc(w.work_title || w.work_number || 'Без названия')}</div>
              </div>
              <div class="swc-meta">
                <span class="swc-status">${esc(w.work_status || '—')}</span>
                ${w.contract_value ? `<span class="swc-money">${fmtRub(w.contract_value)}</span>` : ''}
              </div>
              ${w.pm_name ? `<div class="swc-pm">РП: ${esc(w.pm_name)}</div>` : ''}
              ${w.date_start || w.date_end ? `<div class="swc-dates">${esc(w.date_start || '?')} — ${esc(w.date_end || '?')}</div>` : ''}
            </div>`;
        }
      }

      let tendersHtml = '';
      if (tenders.length > 0) {
        tendersHtml = `<div class="drawer-section">Тендеры · ${tenders.length}</div>`;
        for (const t of tenders) {
          tendersHtml += `
            <div class="site-work-card" data-tender-id="${t.id}">
              <div class="swc-header">
                <span class="swc-icon">📋</span>
                <div class="swc-title">${esc(t.tender_title || t.purchase_number || 'Без названия')}</div>
              </div>
              <div class="swc-meta">
                <span class="swc-status">${esc(t.status || '—')}</span>
                ${t.max_price ? `<span class="swc-money">${fmtRub(t.max_price)}</span>` : ''}
              </div>
            </div>`;
        }
      }

      const drawerHtml = `
        <div class="site-drawer">
          <div class="site-card">
            <div class="site-card-status">${statusLabels[status] || status}</div>
            <div class="site-card-name">${esc(site.name)}</div>
            ${site.customer_name ? `<div class="site-card-customer">${esc(site.customer_name)}</div>` : ''}
            ${site.region ? `<div class="site-card-region">${esc(site.region)}</div>` : ''}
            ${site.address ? `<div class="site-card-address">${esc(site.address)}</div>` : ''}
          </div>

          <div class="site-summary">
            <div class="site-summary-item">
              <div class="ssi-val">${works.length}</div>
              <div class="ssi-label">Работ</div>
            </div>
            <div class="site-summary-item">
              <div class="ssi-val">${works.filter(w => /в работе|на объекте|мобилизация/i.test(w.work_status || '')).length}</div>
              <div class="ssi-label">Активных</div>
            </div>
            <div class="site-summary-item">
              <div class="ssi-val">${tenders.length}</div>
              <div class="ssi-label">Тендеров</div>
            </div>
            <div class="site-summary-item">
              <div class="ssi-val">${fmtRub(totalContract)}</div>
              <div class="ssi-label">Контракты</div>
            </div>
          </div>

          ${site.geocode_status === 'pending' ? `
            <div class="site-geocode-warning">
              <span>⚠️</span>
              <div>
                <div style="font-weight:700">Координаты не подтверждены</div>
                <div style="font-size:12px;margin-top:4px">Нажмите на нужное место на карте для привязки</div>
              </div>
              <button class="btn primary" id="btnStartPlacement" data-site-id="${site.id}">Указать</button>
            </div>
          ` : ''}

          ${works.length > 0 ? worksHtml : AsgardUI.emptyState({ icon: '⚒️', title: 'Нет работ' })}
          ${tendersHtml}
        </div>
      `;

      showDrawer({
        title: site.name,
        html: drawerHtml,
        width: 'wide',
        actions: `
          <button class="btn ghost" id="drawerWorksLink" title="Работы">⚒️</button>
          <button class="btn ghost" id="drawerTendersLink" title="Тендеры">📋</button>
        `,
        onMount: () => {
          const btnPlace = document.getElementById('btnStartPlacement');
          if (btnPlace) {
            btnPlace.addEventListener('click', () => {
              editMode = true;
              editingSiteId = parseInt(btnPlace.dataset.siteId);
              hideDrawer();
              toast('Привязка', 'Кликните на карте, чтобы указать местоположение объекта', 'info', 6000);
              const mapEl = document.getElementById('yaMap');
              if (mapEl) mapEl.style.cursor = 'crosshair';
            });
          }

          document.getElementById('drawerWorksLink')?.addEventListener('click', () => {
            location.hash = '#/pm-works?site_id=' + site.id;
            hideDrawer();
          });
          document.getElementById('drawerTendersLink')?.addEventListener('click', () => {
            location.hash = '#/tenders?site_id=' + site.id;
            hideDrawer();
          });

          document.querySelectorAll('.site-work-card[data-work-id]').forEach(card => {
            card.style.cursor = 'pointer';
            card.addEventListener('click', () => {
              location.hash = '#/pm-works?id=' + card.dataset.workId;
              hideDrawer();
            });
          });

          document.querySelectorAll('.site-work-card[data-tender-id]').forEach(card => {
            card.style.cursor = 'pointer';
            card.addEventListener('click', () => {
              location.hash = '#/tenders?id=' + card.dataset.tenderId;
              hideDrawer();
            });
          });
        }
      });
    } catch (err) {
      showDrawer({ title: 'Ошибка', html: '<div class="help">' + esc(err.message) + '</div>' });
    }
  }

  // ═════════════════════════════════════════════════════════════
  // MANUAL PIN PLACEMENT
  // ═════════════════════════════════════════════════════════════
  async function onMapClickForPlacement(coords) {
    if (!editMode || !editingSiteId) return;
    const [lat, lng] = coords;

    // Reverse geocode for region name
    let regionName = '';
    try {
      const geo = await ymaps.geocode(coords);
      const firstObj = geo.geoObjects.get(0);
      if (firstObj) {
        regionName = firstObj.getAdministrativeAreas()?.[0] || firstObj.getLocalities()?.[0] || '';
      }
    } catch (e) { /* ignore */ }

    try {
      const auth = await AsgardAuth.getAuth();
      await fetch('/api/sites/' + editingSiteId, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + auth.token
        },
        body: JSON.stringify({ lat, lng, region: regionName, geocode_status: 'manual' })
      });

      toast('Привязано', 'Координаты объекта обновлены', 'ok');
      editMode = false;
      editingSiteId = null;
      const mapEl = document.getElementById('yaMap');
      if (mapEl) mapEl.style.cursor = '';

      await loadSites();
      addPlacemarks();
    } catch (err) {
      toast('Ошибка', err.message, 'err');
    }
  }

  // ═════════════════════════════════════════════════════════════
  // ADD NEW SITE MODAL
  // ═════════════════════════════════════════════════════════════
  function openAddSiteModal() {
    showModal({
      title: 'Новый объект',
      html: `
        <div class="form-grid">
          <div class="form-field full-width">
            <label>Название объекта <span class="req">*</span></label>
            <input class="inp" id="siteNameInput" placeholder="МЛСП «Приразломная»" />
          </div>
          <div class="form-field">
            <label>Заказчик</label>
            <input class="inp" id="siteCustomerInput" placeholder="ООО Газпром нефть" />
          </div>
          <div class="form-field">
            <label>Тип объекта</label>
            <select class="inp" id="siteTypeInput">
              <option value="platform">Морская платформа</option>
              <option value="terminal">Терминал</option>
              <option value="refinery">НПЗ</option>
              <option value="port">Порт</option>
              <option value="plant">Завод</option>
              <option value="office">Офис</option>
              <option value="object" selected>Объект</option>
            </select>
          </div>
          <div class="form-field full-width">
            <label>Адрес / местоположение</label>
            <input class="inp" id="siteAddressInput" placeholder="Печорское море, 60 км от берега" />
            <div class="help">Для автогеокодинга. Чем точнее — тем лучше.</div>
          </div>
        </div>
        <div class="form-actions">
          <button class="btn ghost" onclick="AsgardUI.hideModal()">Отмена</button>
          <button class="btn primary" id="btnSaveSite">Создать и найти на карте</button>
        </div>
      `,
      onMount: () => {
        document.getElementById('btnSaveSite').addEventListener('click', async () => {
          const name = document.getElementById('siteNameInput').value.trim();
          if (!name) { toast('Ошибка', 'Укажите название', 'err'); return; }

          const customer = document.getElementById('siteCustomerInput').value.trim();
          const siteType = document.getElementById('siteTypeInput').value;
          const address = document.getElementById('siteAddressInput').value.trim();

          let lat = null, lng = null, region = '', geoStatus = 'pending';

          if (address || customer) {
            try {
              toast('Поиск', 'Ищем координаты...', 'info', 2000);
              const auth = await AsgardAuth.getAuth();
              const geoResp = await fetch('/api/sites/geocode', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': 'Bearer ' + auth.token
                },
                body: JSON.stringify({ address: [name, customer, address].filter(Boolean).join(', ') })
              });
              const geoData = await geoResp.json();

              if (geoData.found && geoData.highConfidence) {
                lat = geoData.lat;
                lng = geoData.lng;
                region = geoData.region;
                geoStatus = 'auto';
                toast('Найдено', geoData.displayName, 'ok');
              } else if (geoData.found) {
                lat = geoData.lat;
                lng = geoData.lng;
                region = geoData.region;
                geoStatus = 'pending';
                toast('Внимание', 'Координаты приблизительные. Уточните на карте.', 'warn', 5000);
              } else {
                toast('Не найдено', 'Укажите местоположение вручную на карте', 'warn', 5000);
              }
            } catch (e) {
              toast('Ошибка геокодера', e.message, 'err');
            }
          }

          try {
            const auth = await AsgardAuth.getAuth();
            const resp = await fetch('/api/sites', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + auth.token
              },
              body: JSON.stringify({ name, customer_name: customer, site_type: siteType, address, lat, lng, region, geocode_status: geoStatus })
            });
            const newSite = await resp.json();

            hideModal();
            await loadSites();
            addPlacemarks();

            if (geoStatus === 'pending') {
              editMode = true;
              editingSiteId = newSite.id;
              document.getElementById('yaMap').style.cursor = 'crosshair';
              toast('Привязка', 'Кликните на карте, чтобы указать местоположение объекта', 'info', 8000);
            } else if (lat && lng && map) {
              map.setCenter([lat, lng], 10, { duration: 500 });
            }
          } catch (err) {
            toast('Ошибка', err.message, 'err');
          }
        });
      }
    });
  }

  // ═════════════════════════════════════════════════════════════
  // LIST VIEW
  // ═════════════════════════════════════════════════════════════
  function openListView() {
    const sorted = [...sites].sort((a, b) => (b.active_works || 0) - (a.active_works || 0));

    const listHtml = sorted.map(s => {
      const status = getSiteStatus(s);
      const pin = PIN_COLORS[status];
      return `
        <div class="site-list-item" data-id="${s.id}" style="cursor:pointer">
          <div class="sli-dot" style="background:${pin.color}"></div>
          <div class="sli-info">
            <div class="sli-name">${esc(s.name)}</div>
            <div class="sli-meta">${esc(s.customer_name || '')} · ${esc(s.region || '')}</div>
          </div>
          <div class="sli-stats">
            <span class="sli-badge">${s.works_count || 0} работ</span>
            ${s.active_works > 0 ? `<span class="sli-badge green">${s.active_works} акт.</span>` : ''}
          </div>
        </div>`;
    }).join('');

    showDrawer({
      title: 'Все объекты (' + sites.length + ')',
      html: '<div class="site-list">' + listHtml + '</div>',
      width: 'normal',
      onMount: () => {
        document.querySelectorAll('.site-list-item').forEach(item => {
          item.addEventListener('click', () => {
            const id = parseInt(item.dataset.id);
            hideDrawer();
            const site = sites.find(s => s.id === id);
            if (site?.lat && site?.lng && map) {
              map.setCenter([site.lat, site.lng], 12, { duration: 500 });
            }
            setTimeout(() => openSiteDrawer(id), 400);
          });
        });
      }
    });
  }

  // ═════════════════════════════════════════════════════════════
  // EVENT BINDINGS
  // ═════════════════════════════════════════════════════════════
  function bindEvents() {
    $$('.map-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.map-filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        addPlacemarks(btn.dataset.filter);
      });
    });

    $('#btnAddSite')?.addEventListener('click', openAddSiteModal);
    $('#btnMapList')?.addEventListener('click', openListView);
  }

  return { render, openSiteDrawer };
})();
