/**
 * Director tender approvals — очередь согласования просчётов РП >5 млн без НДС
 */
window.AsgardDirectorTenderApprovalsPage = (function () {
  const API = window.AsgardRegistryAPI;
  const DIRECTOR_ROLES = ['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'ADMIN'];

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function fmtMoney(v) {
    if (v == null || v === '') return '—';
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    return n.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽';
  }

  function fmtDate(v) {
    if (!v) return '—';
    const s = String(v).slice(0, 10);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? m[3] + '.' + m[2] + '.' + m[1] : s;
  }

  function currentRole() {
    try {
      return JSON.parse(localStorage.getItem('asgard_user') || '{}').role || '';
    } catch (_) { return ''; }
  }

  function openDetail(row) {
    if (!window.AsgardRpReviewModal) return;
    if (API.markDirectorReviewSeen) {
      API.markDirectorReviewSeen(row.id).catch(function () {});
      row.director_unread = false;
    }
    const tender = {
      id: row.id,
      customer_name: row.customer_name,
      tender_title: row.tender_title,
      tender_price: row.tender_price,
      docs_deadline: row.docs_deadline,
      registry_status: row.registry_status,
      purchase_url: row.purchase_url
    };
    const extra = {};
    const hash = location.hash || '';
    if (hash.includes('tab=chat')) extra.initialTab = 'thread';
    AsgardRpReviewModal.open(tender, [], refresh, Object.assign({
      role: 'director',
      readOnly: true,
      mode: 'calc'
    }, extra));
  }

  let items = [];
  let layoutRef = null;

  function renderTable() {
    if (!items.length) {
      return '<div class="card" style="padding:24px;text-align:center"><p class="muted">Нет тендеров, ожидающих согласования</p></div>';
    }
    let h = '<div class="card" style="overflow:auto"><table class="tbl" style="width:100%;font-size:13px"><thead><tr>' +
      '<th>№</th><th>Заказчик</th><th>Работа</th><th>НМЦ</th><th>Цена РП без НДС</th><th>Срок подачи</th><th>Срок работ</th><th>РП</th><th></th>' +
      '</tr></thead><tbody>';
    items.forEach((row) => {
      const unread = row.director_unread || row.thread_unread;
      h += '<tr class="dir-tender-row' + (unread ? ' reg-row-unread' : '') + '" data-id="' + row.id + '" style="cursor:pointer">' +
        '<td>' + esc(row.registry_no || row.id) + '</td>' +
        '<td>' + esc(row.customer_name || '—') + '</td>' +
        '<td>' + esc((row.tender_title || '—').slice(0, 60)) + '</td>' +
        '<td>' + esc(fmtMoney(row.tender_price)) + '</td>' +
        '<td><strong>' + esc(fmtMoney(row.work_price_ex_vat)) + '</strong></td>' +
        '<td>' + esc(fmtDate(row.docs_deadline)) + '</td>' +
        '<td>' + (row.duration_days != null ? esc(row.duration_days) + ' дн.' : '—') + '</td>' +
        '<td>' + esc(row.calculator_name || '—') + '</td>' +
        '<td><button type="button" class="btn mini dir-open" data-id="' + row.id + '">Открыть</button></td>' +
        '</tr>';
    });
    return h + '</tbody></table></div>';
  }

  function bindTable() {
    document.querySelectorAll('.dir-tender-row, .dir-open').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.dir-open')) e.stopPropagation();
        const id = Number(el.dataset.id || el.closest('[data-id]')?.dataset.id);
        const row = items.find((r) => r.id === id);
        if (row) openDetail(row);
      });
    });
  }

  function refresh() {
    if (!API?.loadDirectorReviewQueue) return Promise.resolve();
    return API.loadDirectorReviewQueue().then((d) => {
      items = d.items || [];
      const root = document.getElementById('dirTenderApprovalsRoot');
      if (root) {
        root.innerHTML = renderTable();
        bindTable();
      }
      const badge = document.getElementById('dirTenderCount');
      if (badge) badge.textContent = String(items.length);
    }).catch((e) => {
      if (window.toast) toast(e.message, 'err');
    });
  }

  function handleDeepLink() {
    const hash = location.hash || '';
    const qs = hash.includes('?') ? hash.split('?')[1] : '';
    const params = new URLSearchParams(qs);
    const tid = params.get('id');
    if (!tid || !items.length) return;
    const row = items.find((r) => String(r.id) === String(tid));
    if (row) openDetail(row);
  }

  function render(ctx) {
    layoutRef = ctx.layout;
    const role = currentRole();
    if (!DIRECTOR_ROLES.includes(role)) {
      ctx.layout.setContent('<div class="card"><p>Доступ только для директоров</p></div>');
      return;
    }
    ctx.layout.setContent(
      '<div class="page-head" style="margin-bottom:16px">' +
      '<h1 style="margin:0">Согласование тендеров</h1>' +
      '<p class="muted" style="margin:6px 0 0">Просчёты РП свыше 5 млн ₽ без НДС · <span id="dirTenderCount">…</span> в очереди</p>' +
      '<button type="button" class="btn mini ghost" id="dirTenderRefresh" style="margin-top:8px">Обновить</button>' +
      '</div>' +
      '<div id="dirTenderApprovalsRoot"><p class="muted">Загрузка…</p></div>'
    );
    document.getElementById('dirTenderRefresh')?.addEventListener('click', () => refresh());
    refresh().then(() => handleDeepLink());
    window.addEventListener('asgard:tender:registry:changed', refresh);
  }

  return { render, refresh };
})();
