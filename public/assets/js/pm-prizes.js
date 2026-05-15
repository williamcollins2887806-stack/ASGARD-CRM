/**
 * AsgardPmPrizesPage — PM Prize Requests Management
 * ════════════════════════════════════════════════════
 * Route: #/pm-prizes
 * Roles: ADMIN, PM, HEAD_PM, DIRECTOR_*
 */
window.AsgardPmPrizesPage = (function () {
  'use strict';

  const { esc, toast } = AsgardUI;

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

  const STATUS_LABEL = {
    pending:   { text: 'Ожидает',  color: '#9ca3af', bg: 'rgba(156,163,175,.12)' },
    requested: { text: 'Запрошен', color: '#fbbf24', bg: 'rgba(251,191,36,.12)'  },
    ready:     { text: 'Готов',    color: '#60a5fa', bg: 'rgba(96,165,250,.12)'   },
    delivered: { text: 'Выдан',    color: '#4ade80', bg: 'rgba(74,222,128,.12)'   },
    confirmed: { text: 'Получен',  color: '#34d399', bg: 'rgba(52,211,153,.12)'   },
  };

  const CAT_META = {
    food:       { icon: '🍜', label: 'Еда',         color: '#f97316', bg: 'rgba(249,115,22,.12)'  },
    merch:      { icon: '🎁', label: 'Мерч',        color: '#D4A843', bg: 'rgba(212,168,67,.1)'   },
    cosmetic:   { icon: '🎮', label: 'Косметика',   color: '#a855f7', bg: 'rgba(168,85,247,.12)'  },
    digital:    { icon: '💎', label: 'Цифровые',    color: '#3b82f6', bg: 'rgba(59,130,246,.12)'  },
    privilege:  { icon: '⭐', label: 'Привилегии',  color: '#fbbf24', bg: 'rgba(251,191,36,.1)'   },
    spin_prize: { icon: '✨', label: 'Спины',        color: '#ec4899', bg: 'rgba(236,72,153,.1)'   },
  };

  function catMeta(cat) { return CAT_META[cat] || { icon: '🎁', label: cat || 'Мерч', color: '#D4A843', bg: 'rgba(212,168,67,.1)' }; }

  function statusBadge(status) {
    const s = STATUS_LABEL[status] || { text: status, color: '#9ca3af', bg: 'rgba(156,163,175,.1)' };
    return `<span style="display:inline-flex;align-items:center;padding:3px 10px;border-radius:8px;font-size:11px;font-weight:700;background:${s.bg};color:${s.color};white-space:nowrap">${esc(s.text)}</span>`;
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  // ── Deliver modal ──
  function openDeliverModal(row, onDone) {
    const existing = document.getElementById('pp-deliver-modal');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = 'pp-deliver-modal';
    overlay.style.cssText = `position:fixed;inset:0;z-index:1100;background:rgba(0,0,0,.75);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:20px`;
    overlay.innerHTML = `
      <div style="background:var(--bg2);border-radius:20px;border:1px solid var(--brd);padding:28px;width:100%;max-width:440px;box-shadow:var(--shadow-xl)">
        <h3 style="font-family:'Cinzel',serif;font-size:18px;font-weight:800;color:#F0C850;margin:0 0 4px">⚔️ Выдача приза</h3>
        <p style="font-size:13px;color:var(--t3);margin:0 0 20px">
          ${esc(row.employee_name)} — <strong style="color:var(--t1)">${esc(row.item_name)}</strong>
        </p>
        <label style="display:block;font-size:12px;color:var(--t3);margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em">Заметка о выдаче (необязательно)</label>
        <textarea id="pp-deliver-note" rows="3" placeholder="Например: выдано на объекте ул. Ленина"
          style="width:100%;box-sizing:border-box;background:var(--bg3);border:1.5px solid var(--brd);border-radius:12px;padding:12px;color:var(--t1);font-size:14px;resize:vertical;outline:none;font-family:-apple-system,system-ui,sans-serif"></textarea>
        <div style="display:flex;gap:10px;margin-top:16px">
          <button id="pp-deliver-cancel" style="flex:1;padding:14px;border-radius:12px;border:1.5px solid var(--brd);background:transparent;color:var(--t2);font-size:14px;font-weight:700;cursor:pointer">Отмена</button>
          <button id="pp-deliver-confirm" style="flex:2;padding:14px;border-radius:12px;border:none;background:linear-gradient(135deg,#C8940A,#F0C850);color:#1a1000;font-size:14px;font-weight:800;cursor:pointer;box-shadow:0 4px 0 #8B6914">⚔️ Подтвердить выдачу</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#pp-deliver-cancel').onclick = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('#pp-deliver-confirm').onclick = async () => {
      const btn = overlay.querySelector('#pp-deliver-confirm');
      const note = overlay.querySelector('#pp-deliver-note').value.trim();
      btn.disabled = true; btn.textContent = 'Выдаём…';
      try {
        await apiFetch('PUT', `/inventory/${row.id}/deliver`, { delivery_note: note || undefined });
        toast('Приз выдан! Рабочему отправлено уведомление.', 'success');
        overlay.remove(); onDone();
      } catch (e) {
        toast('Ошибка: ' + e.message, 'error');
        btn.disabled = false; btn.textContent = '⚔️ Подтвердить выдачу';
      }
    };
  }

  // ── Grouped requests view ──
  function renderRequests(container, deliveries, onDeliver) {
    if (!deliveries || deliveries.length === 0) {
      container.innerHTML = `
        <div style="text-align:center;padding:80px 20px;color:var(--t3)">
          <div style="font-size:56px;margin-bottom:16px;opacity:.35">⚔️</div>
          <div style="font-family:'Cinzel',serif;font-size:16px;margin-bottom:8px;color:var(--t3)">Нет активных запросов</div>
          <div style="font-size:13px">Воины ещё не запросили свои призы</div>
        </div>`;
      return;
    }

    // Group by worker
    const workerMap = new Map();
    deliveries.forEach(row => {
      if (!workerMap.has(row.employee_id)) {
        workerMap.set(row.employee_id, { id: row.employee_id, name: row.employee_name, phone: row.employee_phone, work: row.work_name, items: [] });
      }
      workerMap.get(row.employee_id).items.push(row);
    });

    // Sort items: requested first → by date
    workerMap.forEach(w => w.items.sort((a, b) => {
      if (a.status === 'requested' && b.status !== 'requested') return -1;
      if (b.status === 'requested' && a.status !== 'requested') return 1;
      return new Date(b.requested_at || b.created_at) - new Date(a.requested_at || a.created_at);
    }));

    const workers = [...workerMap.values()].sort((a, b) => {
      const aU = a.items.some(i => i.status === 'requested') ? 0 : 1;
      const bU = b.items.some(i => i.status === 'requested') ? 0 : 1;
      return aU !== bU ? aU - bU : a.name.localeCompare(b.name, 'ru');
    });

    const cats = [...new Set(deliveries.map(d => d.item_category || 'merch'))];

    container.innerHTML = `
<style>
@keyframes pp-urgent-pulse { 0%,100%{box-shadow:0 0 0 0 rgba(251,191,36,0)} 50%{box-shadow:0 0 22px 3px rgba(251,191,36,.12)} }
.pp-chip { display:inline-flex;align-items:center;gap:4px;padding:6px 13px;border-radius:20px;font-size:12px;font-weight:700;
  cursor:pointer;border:1.5px solid var(--brd);background:var(--bg3);color:var(--t3);
  transition:all .17s;user-select:none;white-space:nowrap; }
.pp-chip:hover:not(.pp-active) { background:var(--brd);color:var(--t2); }
.pp-chip.pp-active { border-color:rgba(240,200,80,.5);background:rgba(240,200,80,.12);color:#F0C850; }
.pp-wcard { border-radius:18px;border:1.5px solid var(--brd);overflow:hidden;margin-bottom:10px;
  background:var(--bg2);transition:border-color .25s,box-shadow .25s; }
.pp-wcard.pp-urgent { border-color:rgba(251,191,36,.3);animation:pp-urgent-pulse 3s ease-in-out infinite; }
.pp-whdr { display:flex;align-items:center;gap:12px;padding:14px 18px;cursor:pointer;user-select:none;transition:background .15s; }
.pp-whdr:hover { background:var(--bg3); }
.pp-wavatar { width:46px;height:46px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-size:15px;font-weight:900;flex-shrink:0; }
.pp-wname { font-size:14px;font-weight:700;color:var(--t1);line-height:1.3; }
.pp-wmeta { font-size:11px;color:var(--t3);margin-top:2px;display:flex;flex-wrap:wrap;gap:8px; }
.pp-cbadge { display:inline-flex;align-items:center;gap:3px;padding:3px 9px;border-radius:10px;font-size:11px;font-weight:800; }
.pp-cbadge-req  { background:rgba(251,191,36,.15);color:#fbbf24;border:1px solid rgba(251,191,36,.25); }
.pp-cbadge-pend { background:rgba(156,163,175,.1);color:var(--t2);border:1px solid rgba(156,163,175,.2); }
.pp-chevron { color:var(--t3);font-size:11px;transition:transform .2s;flex-shrink:0; }
.pp-chevron.pp-open { transform:rotate(180deg); }
.pp-wbody { border-top:1px solid var(--brd); }
.pp-item { display:flex;align-items:center;gap:11px;padding:11px 18px;
  border-bottom:1px solid var(--brd);transition:background .12s; }
.pp-item:last-child { border-bottom:none; }
.pp-item:hover { background:var(--bg3); }
.pp-item.pp-req { background:rgba(251,191,36,.04); }
.pp-iicon { width:34px;height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0; }
.pp-iname { font-size:13px;font-weight:600;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
.pp-idate { font-size:10px;color:var(--t3);margin-top:2px; }
.pp-dbtn { padding:7px 13px;border-radius:10px;border:none;
  background:linear-gradient(135deg,#C8940A,#F0C850);color:#1a1000;
  font-size:11px;font-weight:800;cursor:pointer;white-space:nowrap;flex-shrink:0;
  box-shadow:0 2px 0 #7a5a10;transition:all .12s; }
.pp-dbtn:hover { transform:translateY(-1px);box-shadow:0 3px 8px rgba(240,200,80,.25); }
.pp-dbtn:active { transform:translateY(1px);box-shadow:none; }
.pp-no-match { text-align:center;padding:32px 20px;color:var(--t3);font-size:13px; }
</style>

<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px;align-items:center">
  <div style="position:relative;flex:1;min-width:180px;max-width:260px">
    <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);pointer-events:none;font-size:14px">🔍</span>
    <input id="pp-search" placeholder="Поиск по воину…"
      style="width:100%;box-sizing:border-box;padding:8px 12px 8px 34px;border-radius:20px;
      background:var(--bg3);border:1.5px solid var(--brd);
      color:var(--t1);font-size:13px;outline:none;transition:border-color .2s"
      onfocus="this.style.borderColor='rgba(240,200,80,.4)'" onblur="this.style.borderColor='var(--brd)'">
  </div>
  <div style="display:flex;gap:5px;flex-wrap:wrap" id="pp-status-chips">
    <button class="pp-chip pp-active" data-filter="all">Все <span id="pp-cnt-all" style="opacity:.6"></span></button>
    <button class="pp-chip" data-filter="requested">📩 Запрошено <span id="pp-cnt-req" style="opacity:.6"></span></button>
    <button class="pp-chip" data-filter="pending">⏳ Ожидают <span id="pp-cnt-pend" style="opacity:.6"></span></button>
  </div>
</div>

<div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:18px" id="pp-cat-chips">
  <button class="pp-chip pp-active" data-cat="all">Все категории</button>
  ${cats.map(c => { const m = catMeta(c); return `<button class="pp-chip" data-cat="${esc(c)}">${m.icon} ${esc(m.label)}</button>`; }).join('')}
</div>

<div id="pp-wlist">
${workers.map(w => {
  const ini = w.name.trim().split(/\s+/).map(p => p[0]||'').join('').slice(0,2).toUpperCase();
  const hasReq = w.items.some(i => i.status === 'requested');
  const reqCnt = w.items.filter(i => i.status === 'requested').length;
  const pendCnt = w.items.filter(i => i.status === 'pending').length;
  const ac = hasReq ? '#D4A843' : 'var(--t3)';
  const ab = hasReq ? 'linear-gradient(135deg,rgba(212,168,67,.22),rgba(180,130,8,.1))' : 'var(--bg3)';
  const abord = hasReq ? '2px solid rgba(212,168,67,.4)' : '2px solid var(--brd)';
  return `
<div class="pp-wcard${hasReq ? ' pp-urgent' : ''}" data-wid="${w.id}" data-wname="${esc(w.name)}">
  <div class="pp-whdr">
    <div class="pp-wavatar" style="background:${ab};color:${ac};border:${abord}">${esc(ini)}</div>
    <div style="flex:1;min-width:0">
      <div class="pp-wname">${esc(w.name)}</div>
      <div class="pp-wmeta">
        ${w.work ? `<span>🏗 ${esc(w.work)}</span>` : ''}
        ${w.phone ? `<span>📞 ${esc(w.phone)}</span>` : ''}
      </div>
    </div>
    <div style="display:flex;gap:5px;align-items:center;margin-right:10px">
      ${reqCnt ? `<span class="pp-cbadge pp-cbadge-req">📩 ${reqCnt}</span>` : ''}
      ${pendCnt ? `<span class="pp-cbadge pp-cbadge-pend">⏳ ${pendCnt}</span>` : ''}
    </div>
    <span class="pp-chevron pp-open">▼</span>
  </div>
  <div class="pp-wbody">
    ${w.items.map(row => {
      const cat = row.item_category || 'merch';
      const m = catMeta(cat);
      const isReq = row.status === 'requested';
      const dl = row.requested_at ? fmtDate(row.requested_at) : fmtDate(row.created_at);
      return `
    <div class="pp-item${isReq ? ' pp-req' : ''}" data-status="${row.status}" data-cat="${esc(cat)}">
      <div class="pp-iicon" style="background:${m.bg};color:${m.color}">${m.icon}</div>
      <div style="flex:1;min-width:0">
        <div class="pp-iname">${esc(row.item_name)}</div>
        <div class="pp-idate">${isReq ? '📩' : '📋'} ${dl}</div>
      </div>
      ${statusBadge(row.status)}
      <button class="pp-dbtn" data-row='${JSON.stringify(row).replace(/'/g,"&#39;")}'>⚔️ Выдать</button>
    </div>`;
    }).join('')}
  </div>
</div>`;
}).join('')}
</div>
<div id="pp-no-match" class="pp-no-match" style="display:none">Ничего не найдено</div>`;

    // Update count chips
    const totalAll = deliveries.length;
    const totalReq = deliveries.filter(d => d.status === 'requested').length;
    const totalPend = deliveries.filter(d => d.status === 'pending').length;
    const cntAll = container.querySelector('#pp-cnt-all');
    const cntReq = container.querySelector('#pp-cnt-req');
    const cntPend = container.querySelector('#pp-cnt-pend');
    if (cntAll) cntAll.textContent = totalAll ? `(${totalAll})` : '';
    if (cntReq) cntReq.textContent = totalReq ? `(${totalReq})` : '';
    if (cntPend) cntPend.textContent = totalPend ? `(${totalPend})` : '';

    // Expand/collapse worker cards
    container.querySelectorAll('.pp-whdr').forEach(hdr => {
      hdr.addEventListener('click', () => {
        const body = hdr.nextElementSibling;
        const chev = hdr.querySelector('.pp-chevron');
        const isOpen = body.style.display !== 'none';
        body.style.display = isOpen ? 'none' : '';
        chev.classList.toggle('pp-open', !isOpen);
      });
    });

    // Deliver buttons
    container.querySelectorAll('.pp-dbtn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        openDeliverModal(JSON.parse(btn.dataset.row), onDeliver);
      });
    });

    // Filter logic
    let activeStatus = 'all';
    let activeCat = 'all';
    let searchQ = '';

    function applyFilters() {
      let anyVisible = false;
      container.querySelectorAll('.pp-wcard').forEach(card => {
        const wname = (card.dataset.wname || '').toLowerCase();
        const nameOk = !searchQ || wname.includes(searchQ);

        let visItems = 0;
        card.querySelectorAll('.pp-item').forEach(item => {
          const statusOk = activeStatus === 'all' || item.dataset.status === activeStatus;
          const catOk = activeCat === 'all' || item.dataset.cat === activeCat;
          const show = nameOk && statusOk && catOk;
          item.style.display = show ? '' : 'none';
          if (show) visItems++;
        });

        const show = nameOk && visItems > 0;
        card.style.display = show ? '' : 'none';
        if (show) anyVisible = true;
      });
      const noMatch = container.querySelector('#pp-no-match');
      if (noMatch) noMatch.style.display = anyVisible ? 'none' : '';
    }

    container.querySelector('#pp-search').addEventListener('input', e => {
      searchQ = e.target.value.toLowerCase().trim();
      applyFilters();
    });

    container.querySelector('#pp-status-chips').addEventListener('click', e => {
      const chip = e.target.closest('.pp-chip[data-filter]');
      if (!chip) return;
      container.querySelectorAll('#pp-status-chips .pp-chip').forEach(c => c.classList.remove('pp-active'));
      chip.classList.add('pp-active');
      activeStatus = chip.dataset.filter;
      applyFilters();
    });

    container.querySelector('#pp-cat-chips').addEventListener('click', e => {
      const chip = e.target.closest('.pp-chip[data-cat]');
      if (!chip) return;
      container.querySelectorAll('#pp-cat-chips .pp-chip').forEach(c => c.classList.remove('pp-active'));
      chip.classList.add('pp-active');
      activeCat = chip.dataset.cat;
      applyFilters();
    });
  }

  // ── History tab ──
  function renderHistory(container, history) {
    if (!history || history.length === 0) {
      container.innerHTML = `
        <div style="text-align:center;padding:80px 20px;color:var(--t3)">
          <div style="font-size:56px;margin-bottom:16px;opacity:.35">📜</div>
          <div style="font-family:'Cinzel',serif;font-size:16px;margin-bottom:8px;color:var(--t3)">История пуста</div>
          <div style="font-size:13px">Ещё ни один приз не был выдан</div>
        </div>`;
      return;
    }
    container.innerHTML = history.map(row => `
      <div style="display:flex;align-items:center;gap:14px;padding:13px 16px;border-radius:14px;
        background:var(--bg3);border:1px solid var(--brd);margin-bottom:8px">
        <div style="width:38px;height:38px;border-radius:10px;background:rgba(74,222,128,.08);
          display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">✅</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(row.item_name)}</div>
          <div style="font-size:11px;color:var(--t3);margin-top:2px">
            👤 ${esc(row.employee_name)}${row.delivered_by_name ? ` &nbsp;|&nbsp; Выдал: ${esc(row.delivered_by_name)}` : ''}
          </div>
          ${row.delivery_note ? `<div style="font-size:11px;color:var(--t3);margin-top:2px;font-style:italic">"${esc(row.delivery_note)}"</div>` : ''}
        </div>
        <div style="text-align:right;flex-shrink:0">
          ${statusBadge(row.status)}
          <div style="font-size:10px;color:var(--t3);margin-top:4px">${fmtDate(row.delivered_at)}</div>
        </div>
      </div>`).join('');
  }

  // ── Main render ──
  async function render({ layout, title }) {
    await layout(`
      <style>
        .pp-tab-btn { background:var(--bg3);border:1.5px solid var(--brd);color:var(--t3);
          padding:10px 22px;border-radius:12px;font-size:13px;font-weight:700;cursor:pointer;transition:all .2s; }
        .pp-tab-btn.active { background:rgba(240,200,80,.1);border-color:rgba(240,200,80,.35);color:#F0C850; }
        .pp-tab-btn:not(.active):hover { background:var(--brd);color:var(--t2); }
      </style>
      <div style="max-width:960px;margin:0 auto;padding:24px 16px">
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:8px">
          <div style="width:48px;height:48px;border-radius:16px;background:linear-gradient(135deg,rgba(240,200,80,.15),rgba(200,148,10,.08));
            border:1.5px solid rgba(240,200,80,.25);display:flex;align-items:center;justify-content:center;font-size:24px">⚔️</div>
          <div>
            <h1 style="font-family:'Cinzel',serif;font-size:22px;font-weight:900;color:#F0C850;margin:0;line-height:1.2">Призы воинов</h1>
            <p style="font-size:13px;color:var(--t3);margin:2px 0 0">Запросы на выдачу и история призов</p>
          </div>
          <button id="pp-refresh" title="Обновить"
            style="margin-left:auto;width:36px;height:36px;border-radius:10px;border:1.5px solid var(--brd);
            background:var(--bg3);color:var(--t3);cursor:pointer;font-size:16px;
            display:flex;align-items:center;justify-content:center;transition:all .2s">↻</button>
        </div>
        <div id="pp-stats" style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap"></div>
        <div style="display:flex;gap:8px;margin-bottom:20px">
          <button class="pp-tab-btn active" id="pp-tab-requests" data-tab="requests">📩 Запросы</button>
          <button class="pp-tab-btn" id="pp-tab-history" data-tab="history">📜 История</button>
        </div>
        <div id="pp-loading" style="text-align:center;padding:40px;color:var(--t3)">
          <div style="font-size:28px;margin-bottom:8px">⚔️</div>Загрузка данных…
        </div>
        <div id="pp-requests-content" style="display:none"></div>
        <div id="pp-history-content" style="display:none"></div>
      </div>`, { title });

    const loading = document.getElementById('pp-loading');
    const reqContent = document.getElementById('pp-requests-content');
    const hisContent = document.getElementById('pp-history-content');
    const stats = document.getElementById('pp-stats');

    let activeTab = 'requests';
    let deliveries = [];
    let history = [];

    function showTab(tab) {
      activeTab = tab;
      document.querySelectorAll('.pp-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
      reqContent.style.display = tab === 'requests' ? '' : 'none';
      hisContent.style.display = tab === 'history' ? '' : 'none';
    }

    function updateStats() {
      const requested = deliveries.filter(d => d.status === 'requested').length;
      const pending = deliveries.filter(d => d.status === 'pending').length;
      const workers = new Set(deliveries.map(d => d.employee_id)).size;
      stats.innerHTML = [
        { icon: '⚔️', label: 'Воинов с призами', val: workers, color: '#F0C850', bg: 'rgba(240,200,80,.06)', border: 'rgba(240,200,80,.15)' },
        { icon: '📩', label: 'Запрошено',        val: requested, color: '#fbbf24', bg: 'rgba(251,191,36,.06)', border: 'rgba(251,191,36,.15)' },
        { icon: '⏳', label: 'Ожидают',          val: pending, color: '#9ca3af', bg: 'rgba(156,163,175,.05)', border: 'rgba(156,163,175,.12)' },
      ].map(s => `
        <div style="padding:11px 16px;border-radius:12px;background:${s.bg};border:1px solid ${s.border};display:flex;align-items:center;gap:10px">
          <span style="font-size:20px">${s.icon}</span>
          <div>
            <div style="font-size:20px;font-weight:800;color:${s.color};line-height:1">${s.val}</div>
            <div style="font-size:11px;color:var(--t3);margin-top:1px">${s.label}</div>
          </div>
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
        deliveries = [...(deliData.requested || []), ...(deliData.won || [])];
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

    document.getElementById('pp-tab-requests')?.addEventListener('click', () => showTab('requests'));
    document.getElementById('pp-tab-history')?.addEventListener('click', () => showTab('history'));
    document.getElementById('pp-refresh')?.addEventListener('click', loadData);

    await loadData();
  }

  return { render };
})();
