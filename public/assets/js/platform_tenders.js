/**
 * Platform tenders — TenderGuru candidates (#/tenders → С площадок)
 */
window.AsgardPlatformTenders = (function () {
  const { esc, toast } = AsgardUI;
  const API = AsgardRegistryApi;
  let mountEl = null;
  let onRefreshCb = null;

  function render(items, tg, loading) {
    const apiOff = tg.enabled === false;
    const noKey = !tg.api_key_set;
    let html = '<div class="platform-tenders">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
      '<p class="muted" style="margin:0">Тендеры из TenderGuru API — дополнение к ручному реестру.</p>' +
      '<a href="#/tenderguru-settings" class="btn mini ghost">⚙ Настройки</a></div>';

    if (apiOff) html += '<div class="alert warn" style="margin-bottom:12px">TenderGuru API выключен администратором.</div>';
    if (noKey) html += '<div class="alert warn" style="margin-bottom:12px">На сервере не задан <code>TENDERGURU_API_KEY</code>.</div>';
    if (tg.last_sync_at) {
      html += '<p class="muted" style="font-size:12px;margin-bottom:8px">Последняя синхронизация: ' +
        new Date(tg.last_sync_at).toLocaleString('ru') + '</p>';
    }
    if (loading) html += '<p>Загрузка…</p>';
    html += '<div style="overflow-x:auto"><table class="tnd-table asg" style="width:100%;font-size:13px"><thead><tr>' +
      '<th>Тендер</th><th>Заказчик</th><th>НМЦ</th><th>Срок</th><th>Действия</th></tr></thead><tbody>';
    items.forEach((row) => {
      html += '<tr data-id="' + row.id + '">' +
        '<td>' + esc(row.title || row.tender_title || '—') + '</td>' +
        '<td>' + esc(row.customer_name || '—') + '</td>' +
        '<td>' + (row.nmc != null ? Number(row.nmc).toLocaleString('ru-RU') : (row.tender_price != null ? Number(row.tender_price).toLocaleString('ru-RU') : '—')) + '</td>' +
        '<td>' + (row.deadline || row.docs_deadline ? String(row.deadline || row.docs_deadline).slice(0, 10) : '—') + '</td>' +
        '<td style="display:flex;gap:6px;flex-wrap:wrap">' +
        '<button type="button" class="btn mini plat-accept">Принять</button>' +
        '<button type="button" class="btn mini ghost plat-dup">Дубликат</button>' +
        '<button type="button" class="btn mini ghost plat-hide">Скрыть</button>' +
        (row.purchase_url ? '<a href="' + esc(row.purchase_url) + '" target="_blank" rel="noopener" class="btn mini ghost">↗</a>' : '') +
        '</td></tr>';
    });
    html += '</tbody></table></div>';
    if (!loading && !items.length) {
      html += '<p class="muted">' + (apiOff ? 'API выключен — новые кандидаты не загружаются.' : 'Нет новых кандидатов из API') + '</p>';
    }
    html += '</div>';
    return html;
  }

  function bindActions() {
    mountEl.querySelectorAll('.plat-accept').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.closest('tr')?.dataset.id;
        API.acceptPlatformCandidate(id).then(() => {
          toast('Принято в реестр', 'ok');
          refresh();
          onRefreshCb && onRefreshCb();
        }).catch((e) => toast(e.message, 'err'));
      });
    });
    mountEl.querySelectorAll('.plat-dup').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.closest('tr')?.dataset.id;
        API.dismissPlatformCandidate(id, true).then(refresh).catch((e) => toast(e.message, 'err'));
      });
    });
    mountEl.querySelectorAll('.plat-hide').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.closest('tr')?.dataset.id;
        API.dismissPlatformCandidate(id, false).then(refresh).catch((e) => toast(e.message, 'err'));
      });
    });
  }

  async function refresh() {
    if (!mountEl) return;
    mountEl.innerHTML = render([], {}, true);
    try {
      const [d, s] = await Promise.all([
        API.loadRegistry({ subtab: 'platform' }),
        API.loadTenderGuruSettings().catch(() => ({ settings: {} }))
      ]);
      mountEl.innerHTML = render(d.items || [], s.settings || {}, false);
      bindActions();
    } catch (e) {
      mountEl.innerHTML = '<p class="err">' + esc(e.message) + '</p>';
    }
  }

  return {
    mount(el, opts) {
      mountEl = el;
      onRefreshCb = opts && opts.onRefresh;
      refresh();
    },
    refresh,
    unmount() { mountEl = null; }
  };
})();
