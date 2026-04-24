/**
 * AsgardPmPrizesPage — PM Prize Requests Management
 * ════════════════════════════════════════════════════
 * Route: #/pm-prizes
 * Roles: ADMIN, PM, HEAD_PM, DIRECTOR_*
 * API:
 *   GET  /api/gamification/admin/pending-deliveries  — active requests
 *   GET  /api/gamification/admin/delivered-history   — delivery history
 *   PUT  /api/gamification/admin/inventory/:id/deliver — mark as delivered
 */
window.AsgardPmPrizesPage = (function () {
  'use strict';

  const { $, esc, toast } = AsgardUI;

  function hdr() {
    const t = localStorage.getItem('asgard_token') || localStorage.getItem('auth_token');
    return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
  }

  async function apiFetch(method, path, body) {
    const opts = { method, headers: hdr() };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const r = await fetch('/api/gamification/admin' + path, opts);
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || 'HTTP ' + r.status);
    }
    return r.json();
  }

  // ── Status helpers ──
  const STATUS_LABEL = {
    pending:   { text: 'Ожидает',   color: '#9ca3af', bg: 'rgba(156,163,175,.12)' },
    requested: { text: 'Запрошен',  color: '#fbbf24', bg: 'rgba(251,191,36,.12)'  },
    ready:     { text: 'Готов',     color: '#60a5fa', bg: 'rgba(96,165,250,.12)'   },
    delivered: { text: 'Выдан',     color: '#4ade80', bg: 'rgba(74,222,128,.12)'   },
    confirmed: { text: 'Получен',   color: '#34d399', bg: 'rgba(52,211,153,.12)'   },
  };

  function statusBadge(status) {
    const s = STATUS_LABEL[status] || { text: status, color: '#9ca3af', bg: 'rgba(156,163,175,.1)' };
    return `<span style="display:inline-flex;align-items:center;padding:3px 10px;border-radius:8px;
      font-size:11px;font-weight:700;background:${s.bg};color:${s.color}">${esc(s.text)}</span>`;
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  // ── Deliver modal ──
  function openDeliverModal(row, onDone) {
    // Remove any existing modal
    const existing = document.getElementById('pp-deliver-modal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'pp-deliver-modal';
    overlay.style.cssText = `position:fixed;inset:0;z-index:1100;background:rgba(0,0,0,.75);
      backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:20px`;

    overlay.innerHTML = `
      <div style="background:linear-gradient(180deg,#1a2040,#141828);border-radius:20px;
        border:1px solid rgba(255,255,255,.08);padding:28px;width:100%;max-width:440px;
        box-shadow:0 20px 60px rgba(0,0,0,.5)">
        <h3 style="font-family:'Cinzel',serif;font-size:18px;font-weight:800;color:#F0C850;margin:0 0 4px">
          ⚔️ Выдача приза
        </h3>
        <p style="font-size:13px;color:rgba(255,255,255,.5);margin:0 0 20px">
          ${esc(row.employee_name)} — <strong style="color:rgba(255,255,255,.85)">${esc(row.item_name)}</strong>
        </p>
        <label style="display:block;font-size:12px;color:rgba(255,255,255,.5);margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em">
          Заметка о выдаче (необязательно)
        </label>
        <textarea id="pp-deliver-note" rows="3" placeholder="Например: выдано на объекте ул. Ленина"
          style="width:100%;box-sizing:border-box;background:rgba(255,255,255,.04);border:1.5px solid rgba(255,255,255,.1);
          border-radius:12px;padding:12px;color:#fff;font-size:14px;resize:vertical;outline:none;
          font-family:-apple-system,system-ui,sans-serif"></textarea>
        <div style="display:flex;gap:10px;margin-top:16px">
          <button id="pp-deliver-cancel" style="flex:1;padding:14px;border-radius:12px;border:1.5px solid rgba(255,255,255,.1);
            background:transparent;color:rgba(255,255,255,.6);font-size:14px;font-weight:700;cursor:pointer;transition:all .2s">
            Отмена
          </button>
          <button id="pp-deliver-confirm" style="flex:2;padding:14px;border-radius:12px;border:none;
            background:linear-gradient(135deg,#C8940A,#F0C850);color:#1a1000;font-size:14px;font-weight:800;
            cursor:pointer;box-shadow:0 4px 0 #8B6914,0 6px 16px rgba(240,200,80,.2);transition:all .15s">
            ⚔️ Подтвердить выдачу
          </button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    overlay.querySelector('#pp-deliver-cancel').onclick = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#pp-deliver-confirm').onclick = async () => {
      const btn = overlay.querySelector('#pp-deliver-confirm');
      const note = overlay.querySelector('#pp-deliver-note').value.trim();
      btn.disabled = true;
      btn.textContent = 'Выдаём…';
      try {
        await apiFetch('PUT', `/inventory/${row.id}/deliver`, { delivery_note: note || undefined });
        toast('Приз выдан! Рабочему отправлено уведомление.', 'success');
        overlay.remove();
        onDone();
      } catch (e) {
        toast('Ошибка: ' + e.message, 'error');
        btn.disabled = false;
        btn.textContent = '⚔️ Подтвердить выдачу';
      }
    };
  }

  // ── Render requests tab ──
  function renderRequests(container, deliveries, onDeliver) {
    if (!deliveries || deliveries.length === 0) {
      container.innerHTML = `
        <div style="text-align:center;padding:60px 20px;color:rgba(255,255,255,.35)">
          <div style="font-size:56px;margin-bottom:12px;opacity:.4">⚔️</div>
          <div style="font-family:'Cinzel',serif;font-size:16px;margin-bottom:6px;color:rgba(255,255,255,.4)">Нет активных запросов</div>
          <div style="font-size:13px">Воины ещё не запросили свои призы</div>
        </div>`;
      return;
    }

    const html = deliveries.map(row => {
      const dateLabel = row.requested_at ? fmtDate(row.requested_at) : fmtDate(row.created_at);
      const isRequested = row.status === 'requested';

      return `
        <div class="pp-row" data-id="${row.id}" style="display:flex;align-items:center;gap:14px;padding:16px;
          border-radius:16px;background:linear-gradient(135deg,rgba(240,200,80,.04),rgba(26,32,64,.8));
          border:1.5px solid ${isRequested ? 'rgba(251,191,36,.3)' : 'rgba(255,255,255,.05)'};
          margin-bottom:10px;transition:all .2s;cursor:default;
          ${isRequested ? 'animation:pp-glow 3s ease-in-out infinite' : ''}">
          <div style="width:44px;height:44px;border-radius:12px;background:rgba(240,200,80,.1);
            display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">🎁</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:14px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              ${esc(row.item_name)}
            </div>
            <div style="font-size:12px;color:rgba(255,255,255,.5);margin-top:2px;display:flex;align-items:center;gap:8px">
              <span>👤 ${esc(row.employee_name)}</span>
              ${row.work_name ? `<span style="color:rgba(255,255,255,.3)">|</span><span>🏗 ${esc(row.work_name)}</span>` : ''}
            </div>
            <div style="font-size:11px;color:rgba(255,255,255,.35);margin-top:3px">
              ${isRequested ? '📩 Запрошен' : '📋 Создан'}: ${dateLabel}
            </div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;flex-shrink:0">
            ${statusBadge(row.status)}
            <button class="pp-deliver-btn" data-row='${JSON.stringify(row).replace(/'/g, '&#39;')}'
              style="padding:8px 16px;border-radius:10px;border:none;
              background:linear-gradient(135deg,#C8940A,#F0C850);color:#1a1000;
              font-size:12px;font-weight:800;cursor:pointer;
              box-shadow:0 3px 0 #8B6914,0 4px 12px rgba(240,200,80,.2);
              transition:all .15s;white-space:nowrap">
              ⚔️ Выдать
            </button>
          </div>
        </div>`;
    }).join('');

    container.innerHTML = `<style>@keyframes pp-glow{0%,100%{box-shadow:0 0 0 0 rgba(251,191,36,0)}
      50%{box-shadow:0 0 16px 2px rgba(251,191,36,.12)}}</style>` + html;

    container.querySelectorAll('.pp-deliver-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const row = JSON.parse(btn.dataset.row);
        openDeliverModal(row, onDeliver);
      });
      btn.addEventListener('mouseenter', () => { btn.style.transform = 'translateY(-2px)'; });
      btn.addEventListener('mouseleave', () => { btn.style.transform = ''; });
      btn.addEventListener('mousedown', () => { btn.style.transform = 'translateY(2px)'; btn.style.boxShadow = '0 1px 0 #8B6914'; });
      btn.addEventListener('mouseup', () => { btn.style.transform = ''; btn.style.boxShadow = '0 3px 0 #8B6914,0 4px 12px rgba(240,200,80,.2)'; });
    });
  }

  // ── Render history tab ──
  function renderHistory(container, history) {
    if (!history || history.length === 0) {
      container.innerHTML = `
        <div style="text-align:center;padding:60px 20px;color:rgba(255,255,255,.35)">
          <div style="font-size:56px;margin-bottom:12px;opacity:.4">📜</div>
          <div style="font-family:'Cinzel',serif;font-size:16px;margin-bottom:6px;color:rgba(255,255,255,.4)">История пуста</div>
          <div style="font-size:13px">Ещё ни один приз не был выдан</div>
        </div>`;
      return;
    }

    container.innerHTML = history.map(row => `
      <div style="display:flex;align-items:center;gap:14px;padding:14px 16px;border-radius:14px;
        background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.04);margin-bottom:8px">
        <div style="width:38px;height:38px;border-radius:10px;background:rgba(74,222,128,.08);
          display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">✅</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;color:rgba(255,255,255,.85);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${esc(row.item_name)}
          </div>
          <div style="font-size:11px;color:rgba(255,255,255,.4);margin-top:2px">
            👤 ${esc(row.employee_name)}
            ${row.delivered_by_name ? ` &nbsp;|&nbsp; Выдал: ${esc(row.delivered_by_name)}` : ''}
          </div>
          ${row.delivery_note ? `<div style="font-size:11px;color:rgba(255,255,255,.35);margin-top:2px;font-style:italic">"${esc(row.delivery_note)}"</div>` : ''}
        </div>
        <div style="text-align:right;flex-shrink:0">
          ${statusBadge(row.status)}
          <div style="font-size:10px;color:rgba(255,255,255,.3);margin-top:4px">${fmtDate(row.delivered_at)}</div>
        </div>
      </div>`).join('');
  }

  // ── Main render ──
  async function render({ layout, title }) {
    layout.innerHTML = `
      <style>
        .pp-tab-btn { background: rgba(255,255,255,.04); border: 1.5px solid rgba(255,255,255,.07); color: rgba(255,255,255,.5);
          padding: 10px 22px; border-radius: 12px; font-size: 13px; font-weight: 700; cursor: pointer; transition: all .2s; }
        .pp-tab-btn.active { background: rgba(240,200,80,.1); border-color: rgba(240,200,80,.35); color: #F0C850; }
        .pp-tab-btn:not(.active):hover { background: rgba(255,255,255,.07); color: rgba(255,255,255,.75); }
      </style>
      <div style="max-width:900px;margin:0 auto;padding:24px 16px">

        <!-- Header -->
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:8px">
          <div style="width:48px;height:48px;border-radius:16px;background:linear-gradient(135deg,rgba(240,200,80,.15),rgba(200,148,10,.08));
            border:1.5px solid rgba(240,200,80,.25);display:flex;align-items:center;justify-content:center;font-size:24px">⚔️</div>
          <div>
            <h1 style="font-family:'Cinzel',serif;font-size:22px;font-weight:900;color:#F0C850;margin:0;line-height:1.2">
              Призы воинов
            </h1>
            <p style="font-size:13px;color:rgba(255,255,255,.4);margin:2px 0 0">Запросы на выдачу и история призов</p>
          </div>
          <button id="pp-refresh" title="Обновить"
            style="margin-left:auto;width:36px;height:36px;border-radius:10px;border:1.5px solid rgba(255,255,255,.1);
            background:rgba(255,255,255,.04);color:rgba(255,255,255,.5);cursor:pointer;font-size:16px;
            display:flex;align-items:center;justify-content:center;transition:all .2s">↻</button>
        </div>

        <!-- Stats bar -->
        <div id="pp-stats" style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap"></div>

        <!-- Tabs -->
        <div style="display:flex;gap:8px;margin-bottom:16px">
          <button class="pp-tab-btn active" id="pp-tab-requests" data-tab="requests">📩 Запросы</button>
          <button class="pp-tab-btn" id="pp-tab-history" data-tab="history">📜 История</button>
        </div>

        <!-- Content -->
        <div id="pp-loading" style="text-align:center;padding:40px;color:rgba(255,255,255,.4)">
          <div style="font-size:28px;margin-bottom:8px">⚔️</div>
          Загрузка данных…
        </div>
        <div id="pp-requests-content" style="display:none"></div>
        <div id="pp-history-content" style="display:none"></div>
      </div>`;

    const loading = document.getElementById('pp-loading');
    const reqContent = document.getElementById('pp-requests-content');
    const hisContent = document.getElementById('pp-history-content');
    const stats = document.getElementById('pp-stats');

    let activeTab = 'requests';
    let deliveries = [];
    let history = [];

    function showTab(tab) {
      activeTab = tab;
      document.querySelectorAll('.pp-tab-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === tab);
      });
      reqContent.style.display = tab === 'requests' ? '' : 'none';
      hisContent.style.display = tab === 'history' ? '' : 'none';
    }

    function updateStats() {
      const requested = deliveries.filter(d => d.status === 'requested').length;
      const pending = deliveries.filter(d => d.status === 'pending').length;
      const total = deliveries.length;

      stats.innerHTML = [
        { label: 'Всего активных', val: total, color: '#F0C850', bg: 'rgba(240,200,80,.06)', border: 'rgba(240,200,80,.15)' },
        { label: 'Запрошено воинами', val: requested, color: '#fbbf24', bg: 'rgba(251,191,36,.06)', border: 'rgba(251,191,36,.15)' },
        { label: 'Ожидают обработки', val: pending, color: '#9ca3af', bg: 'rgba(156,163,175,.05)', border: 'rgba(156,163,175,.12)' },
      ].map(s => `
        <div style="padding:12px 18px;border-radius:12px;background:${s.bg};border:1px solid ${s.border};display:flex;align-items:center;gap:10px">
          <span style="font-size:22px;font-weight:800;color:${s.color}">${s.val}</span>
          <span style="font-size:12px;color:rgba(255,255,255,.45)">${s.label}</span>
        </div>`).join('');
    }

    async function loadData() {
      loading.style.display = '';
      reqContent.style.display = 'none';
      hisContent.style.display = 'none';
      try {
        const [deliData, hisData] = await Promise.all([
          apiFetch('GET', '/pending-deliveries'),
          apiFetch('GET', '/delivered-history'),
        ]);
        deliveries = deliData.deliveries || [];
        history = hisData.history || [];
        loading.style.display = 'none';
        updateStats();
        renderRequests(reqContent, deliveries, loadData);
        renderHistory(hisContent, history);
        showTab(activeTab);
      } catch (e) {
        loading.innerHTML = `<span style="color:#ef4444">Ошибка: ${esc(String(e))}</span>`;
      }
    }

    // Tab clicks
    document.getElementById('pp-tab-requests').addEventListener('click', () => showTab('requests'));
    document.getElementById('pp-tab-history').addEventListener('click', () => showTab('history'));

    // Refresh
    document.getElementById('pp-refresh').addEventListener('click', loadData);

    await loadData();
  }

  return { render };
})();
