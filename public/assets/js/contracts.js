/**
 * АСГАРД CRM — Реестр договоров
 * Этап 29
 */
window.AsgardContractsPage = (function(){
  
  const CONTRACT_TYPES = [
    { id: 'customer', name: 'Покупатель (заказчик)' },
    { id: 'supplier', name: 'Поставщик' }
  ];
  
  const CONTRACT_STATUSES = [
    { id: 'draft', name: 'Черновик', color: 'var(--text-muted)' },
    { id: 'active', name: 'Действует', color: 'var(--green)' },
    { id: 'expiring', name: 'Истекает', color: 'var(--amber)' },
    { id: 'expired', name: 'Истёк', color: 'var(--red)' },
    { id: 'terminated', name: 'Расторгнут', color: 'var(--red)' }
  ];

  // Получить store договоров
  async function getStore() {
    const db = await AsgardDB.open();
    // Создаём store если не существует
    if (!db.objectStoreNames.contains('contracts')) {
      // Нужно пересоздать через версию БД, пока используем localStorage fallback
    }
    return 'contracts';
  }

  // CRUD операции
  async function getAll() {
    try {
      const db = await AsgardDB.open();
      return await AsgardDB.getAll('contracts') || [];
    } catch(e) {
      // Fallback to localStorage
      const data = localStorage.getItem('asgard_contracts');
      return data ? JSON.parse(data) : [];
    }
  }

  async function save(contract) {
    try {
      const db = await AsgardDB.open();
      await AsgardDB.put('contracts', contract);
    } catch(e) {
      // Fallback
      const all = await getAll();
      const idx = all.findIndex(c => c.id === contract.id);
      if (idx >= 0) all[idx] = contract;
      else all.push(contract);
      localStorage.setItem('asgard_contracts', JSON.stringify(all));
    }
  }

  async function remove(id) {
    try {
      await AsgardDB.delete('contracts', id);
    } catch(e) {
      const all = await getAll();
      const filtered = all.filter(c => c.id !== id);
      localStorage.setItem('asgard_contracts', JSON.stringify(filtered));
    }
  }

  // Вычислить статус на основе дат
  function computeStatus(contract) {
    if (contract.status === 'terminated' || contract.status === 'draft') {
      return contract.status;
    }
    if (!contract.end_date || contract.is_perpetual) {
      return 'active';
    }
    const today = new Date();
    const endDate = new Date(contract.end_date);
    const daysLeft = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
    
    if (daysLeft < 0) return 'expired';
    if (daysLeft <= 30) return 'expiring';
    return 'active';
  }

  // Поиск договоров по контрагенту
  async function findByCounterparty(counterpartyId, type = null) {
    const all = await getAll();
    return all.filter(c => {
      const matchCounterparty = c.counterparty_id === counterpartyId;
      const matchType = !type || c.type === type;
      const isActive = computeStatus(c) === 'active' || computeStatus(c) === 'expiring';
      return matchCounterparty && matchType && isActive;
    });
  }

  // Рендер списка
  async function render({ layout, title }) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = "#/login"; return; }
    
    const user = auth.user;
    const allowedRoles = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'OFFICE_MANAGER', 'BUH'];
    if (!allowedRoles.includes(user.role)) {
      AsgardUI.toast('Доступ', 'Недостаточно прав', 'err');
      location.hash = '#/home';
      return;
    }

    const contracts = await getAll();
    const customers = await AsgardDB.getAll('customers') || [];
    
    // Обновляем статусы
    contracts.forEach(c => c.computed_status = computeStatus(c));
    
    // Сортировка по дате (новые первые)
    contracts.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

    const filterHtml = `
      <div class="filters" style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px">
        <input type="text" id="fltSearch" class="inp" placeholder="Поиск по номеру/названию..." style="flex:1;min-width:200px"/>
        <select id="fltType" class="inp" style="width:180px">
          <option value="">Все типы</option>
          ${CONTRACT_TYPES.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
        </select>
        <select id="fltStatus" class="inp" style="width:160px">
          <option value="">Все статусы</option>
          ${CONTRACT_STATUSES.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
        </select>
        <button class="btn primary" id="btnAddContract">+ Новый договор</button>
      </div>
    `;

    const tableHtml = `
      <div class="tbl-wrap">
        <table class="tbl" id="contractsTable">
          <thead>
            <tr>
              <th>Номер</th>
              <th>Тип</th>
              <th>Контрагент</th>
              <th>Предмет</th>
              <th>Дата</th>
              <th>Срок до</th>
              <th>Сумма</th>
              <th>Статус</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="contractsBody">
            ${renderRows(contracts, customers)}
          </tbody>
        </table>
      </div>
      ${contracts.length === 0 ? '<div class="help" style="text-align:center;padding:40px">Договоров пока нет. Нажмите «+ Новый договор» для добавления.</div>' : ''}
    `;

    const body = `
      <div class="panel">
        ${filterHtml}
        ${tableHtml}
      </div>
    `;

    await layout(body, { title: title || 'Реестр договоров' });

    // Обработчики
    document.getElementById('btnAddContract')?.addEventListener('click', () => openContractModal(null, customers));
    
    // Фильтры
    const applyFilters = () => {
      const search = document.getElementById('fltSearch')?.value.toLowerCase() || '';
      const type = document.getElementById('fltType')?.value || '';
      const status = document.getElementById('fltStatus')?.value || '';
      
      const filtered = contracts.filter(c => {
        const matchSearch = !search || 
          (c.number || '').toLowerCase().includes(search) ||
          (c.subject || '').toLowerCase().includes(search) ||
          (c.counterparty_name || '').toLowerCase().includes(search);
        const matchType = !type || c.type === type;
        const matchStatus = !status || c.computed_status === status;
        return matchSearch && matchType && matchStatus;
      });
      
      document.getElementById('contractsBody').innerHTML = renderRows(filtered, customers);
      attachRowHandlers(customers);
    };

    document.getElementById('fltSearch')?.addEventListener('input', applyFilters);
    document.getElementById('fltType')?.addEventListener('change', applyFilters);
    document.getElementById('fltStatus')?.addEventListener('change', applyFilters);

    attachRowHandlers(customers);
  }

  function renderRows(contracts, customers) {
    if (!contracts.length) return '';
    
    return contracts.map(c => {
      const status = CONTRACT_STATUSES.find(s => s.id === c.computed_status) || CONTRACT_STATUSES[0];
      const type = CONTRACT_TYPES.find(t => t.id === c.type);
      const customer = customers.find(cust => cust.id === c.counterparty_id);
      
      const esc = AsgardUI.esc;
      return `
        <tr data-id="${c.id}" style="background:transparent">
          <td><strong>${esc(c.number) || '—'}</strong></td>
          <td><span class="badge" style="background:${c.type === 'customer' ? 'var(--green-glow)' : 'var(--blue-glow)'}; color:${c.type === 'customer' ? 'var(--green)' : 'var(--blue)'}">${esc(type?.name || c.type)}</span></td>
          <td>${esc(customer?.name || c.counterparty_name) || '—'}</td>
          <td style="max-width:250px;overflow:hidden;text-overflow:ellipsis">${esc(c.subject) || '—'}</td>
          <td>${c.start_date ? formatDate(c.start_date) : '—'}</td>
          <td>${c.is_perpetual ? '<span style="opacity:0.7">Бессрочный</span>' : (c.end_date ? formatDate(c.end_date) : '—')}</td>
          <td>${c.amount ? formatMoney(c.amount) : '—'}</td>
          <td><span class="badge" style="background:${status.color}20;color:${status.color}">${status.name}</span></td>
          <td>
            <div style="display:flex;gap:6px">
              <button class="btn mini ghost btnEdit" title="Редактировать">✏️</button>
              <button class="btn mini ghost btnDelete" title="Удалить">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  function attachRowHandlers(customers) {
    document.querySelectorAll('#contractsBody tr').forEach(row => {
      const id = row.dataset.id;
      row.querySelector('.btnEdit')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const contracts = await getAll();
        const contract = contracts.find(c => String(c.id) === String(id));
        if (contract) openContractModal(contract, customers);
      });
      row.querySelector('.btnDelete')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm('Удалить договор?')) {
          await remove(id);
          AsgardUI.toast('Удалено', 'Договор удалён', 'ok');
          render({ layout: window.layout, title: 'Реестр договоров' });
        }
      });
    });
  }

  // ═══════ Premium modal styles (injected once) ═══════
  const CM_STYLE_ID = 'cm-premium-styles';
  function ensureModalStyles() {
    if (document.getElementById(CM_STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = CM_STYLE_ID;
    s.textContent = `
      #contractModal .cm-overlay,
      #contractSelectorModal .cm-overlay { position:fixed;inset:0;background:rgba(0,0,0,.65);backdrop-filter:blur(4px);display:flex;align-items:flex-start;justify-content:center;padding:40px 20px;overflow-y:auto;z-index:1100;animation:cmFadeIn .2s ease }
      @keyframes cmFadeIn { from{opacity:0} to{opacity:1} }
      @keyframes cmSlideUp { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }

      #contractModal .cm-card,
      #contractSelectorModal .cm-card { width:100%;background:#111827;border:1px solid rgba(255,255,255,.08);border-radius:14px;box-shadow:0 24px 80px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.04) inset;animation:cmSlideUp .25s ease;color:#e5e7eb }

      /* ── Premium inputs ── */
      #contractModal .cm-inp,
      #contractSelectorModal .cm-inp {
        width:100%;height:42px;padding:0 14px;font-size:14px;font-family:inherit;color:#f3f4f6;
        background:#0d1117;border:1px solid rgba(255,255,255,.1);border-radius:8px;
        outline:none;transition:border .15s,box-shadow .15s;
        -webkit-appearance:none;appearance:none;
      }
      #contractModal .cm-inp:hover { border-color:rgba(255,255,255,.2) }
      #contractModal .cm-inp:focus { border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.2) }
      #contractModal .cm-inp::placeholder { color:rgba(255,255,255,.25) }
      #contractModal .cm-inp:disabled { opacity:.35;cursor:not-allowed }
      #contractModal .cm-inp.cm-err { border-color:#ef4444;box-shadow:0 0 0 3px rgba(239,68,68,.15) }

      /* Textarea */
      #contractModal textarea.cm-inp { height:auto;padding:10px 14px;resize:vertical;min-height:64px;line-height:1.5 }

      /* Select — custom arrow */
      #contractModal select.cm-inp {
        padding-right:36px;cursor:pointer;
        background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='M2 4l4 4 4-4'/%3E%3C/svg%3E");
        background-repeat:no-repeat;background-position:right 12px center;background-size:12px;
      }
      #contractModal select.cm-inp option { background:#1f2937;color:#e5e7eb }

      /* Date inputs */
      #contractModal input[type=date].cm-inp { color-scheme:dark }
      #contractModal input[type=number].cm-inp::-webkit-inner-spin-button { opacity:.5 }

      /* Section */
      .cm-section { padding:18px;border-radius:10px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.05);margin-bottom:14px }
      .cm-section-title { display:flex;align-items:center;gap:8px;margin-bottom:14px;font-weight:600;font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:.6px }
      .cm-label { display:block;font-size:12px;font-weight:500;color:#9ca3af;margin-bottom:5px }
      .cm-label .req { color:#ef4444;margin-left:2px }
      .cm-grid2 { display:grid;grid-template-columns:1fr 1fr;gap:12px }
      .cm-mt { margin-top:14px }

      /* Toggle switch */
      .cm-toggle { display:flex;align-items:center;gap:10px;cursor:pointer;user-select:none;padding:9px 14px;border-radius:8px;border:1px solid rgba(255,255,255,.1);transition:all .15s;white-space:nowrap }
      .cm-toggle:hover { border-color:rgba(255,255,255,.2) }
      .cm-toggle.active { border-color:#3b82f6;background:rgba(59,130,246,.08) }
      .cm-toggle-track { width:36px;height:20px;border-radius:10px;background:rgba(255,255,255,.12);position:relative;transition:background .2s;flex-shrink:0 }
      .cm-toggle.active .cm-toggle-track { background:#3b82f6 }
      .cm-toggle-thumb { position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .2s;box-shadow:0 1px 3px rgba(0,0,0,.3) }
      .cm-toggle.active .cm-toggle-thumb { transform:translateX(16px) }
      .cm-toggle-text { font-size:13px;color:#9ca3af }

      /* Hint */
      .cm-hint { margin-top:8px;font-size:12px;padding:6px 10px;border-radius:6px;display:inline-flex;align-items:center;gap:6px }
      .cm-hint-green { background:rgba(34,197,94,.08);color:#22c55e }
      .cm-hint-amber { background:rgba(245,158,11,.08);color:#f59e0b }
      .cm-hint-red { background:rgba(239,68,68,.08);color:#ef4444 }

      /* Footer */
      .cm-footer { display:flex;gap:10px;justify-content:flex-end;padding:16px 24px;border-top:1px solid rgba(255,255,255,.05) }
      .cm-btn { padding:10px 22px;border-radius:8px;font-size:14px;font-weight:600;border:none;cursor:pointer;transition:all .15s;font-family:inherit }
      .cm-btn-ghost { background:transparent;color:#9ca3af;border:1px solid rgba(255,255,255,.1) }
      .cm-btn-ghost:hover { background:rgba(255,255,255,.04);color:#e5e7eb }
      .cm-btn-primary { background:#3b82f6;color:#fff }
      .cm-btn-primary:hover { background:#2563eb;box-shadow:0 4px 12px rgba(59,130,246,.3) }

      /* Amount suffix */
      .cm-amount-wrap { position:relative }
      .cm-amount-wrap .cm-suffix { position:absolute;right:12px;top:50%;transform:translateY(-50%);color:#6b7280;font-size:14px;pointer-events:none;font-weight:500 }
      .cm-amount-wrap .cm-inp { padding-right:36px }

      /* Кнопка «+ контрагент» */
      .cm-btn-add-customer { width:42px;height:42px;flex-shrink:0;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:transparent;color:#3b82f6;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s }
      .cm-btn-add-customer:hover { background:rgba(59,130,246,.1);border-color:#3b82f6 }

      /* ═══ WOW Модалка контрагента — z-index:1200 поверх модалки договора (1100) ═══ */
      #newCustomerModal .cm-overlay { z-index:1200 }
      #newCustomerModal .cm-inp { width:100%;height:42px;padding:0 14px;font-size:14px;font-family:inherit;color:#f3f4f6;background:#0d1117;border:1px solid rgba(255,255,255,.1);border-radius:8px;outline:none;transition:border .15s,box-shadow .15s,background .3s;-webkit-appearance:none;appearance:none }
      #newCustomerModal .cm-inp:hover { border-color:rgba(255,255,255,.2) }
      #newCustomerModal .cm-inp:focus { border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.2) }
      #newCustomerModal .cm-inp::placeholder { color:rgba(255,255,255,.25) }
      #newCustomerModal .cm-inp.cm-err { border-color:#ef4444;box-shadow:0 0 0 3px rgba(239,68,68,.15) }
      #newCustomerModal select.cm-inp { padding-right:36px;cursor:pointer;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='M2 4l4 4 4-4'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;background-size:12px }

      /* Спиннер для кнопки */
      @keyframes ncmSpin { to { transform:rotate(360deg) } }
      .ncm-spinner { display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,.2);border-top-color:#fff;border-radius:50%;animation:ncmSpin .6s linear infinite;vertical-align:middle;margin-right:6px }

      /* ═══ WOW: DaData Suggest Dropdown ═══ */
      .ncm-suggest-dropdown { position:absolute;z-index:1250;background:#111827;border:1px solid rgba(212,168,67,.3);border-radius:10px;max-height:240px;overflow-y:auto;display:none;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.5),0 0 0 1px rgba(212,168,67,.1) inset;backdrop-filter:blur(8px) }
      .ncm-suggest-item { padding:12px 16px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.04);transition:all .15s }
      .ncm-suggest-item:last-child { border-bottom:none }
      .ncm-suggest-item:hover { background:rgba(212,168,67,.08) }
      .ncm-suggest-item .ncm-s-name { font-weight:600;font-size:14px;color:#f3f4f6 }
      .ncm-suggest-item .ncm-s-meta { color:#6b7280;font-size:11px;margin-top:2px }

      /* ═══ WOW: Cascade fill animations ═══ */
      @keyframes ncmFieldFill { from{opacity:.3;transform:translateX(-8px)} to{opacity:1;transform:translateX(0)} }
      @keyframes ncmGoldenFlash { 0%{box-shadow:0 0 0 0 rgba(212,168,67,.4)} 50%{box-shadow:0 0 12px 3px rgba(212,168,67,.3)} 100%{box-shadow:none} }
      @keyframes ncmShimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
      .ncm-field-filled { animation:ncmFieldFill .3s ease,ncmGoldenFlash .8s ease .2s }
      .ncm-shimmer-bar { height:3px;border-radius:2px;background:linear-gradient(90deg,transparent,rgba(212,168,67,.6),transparent);background-size:200% 100%;animation:ncmShimmer 1.5s ease;margin:8px 0 }

      /* ═══ WOW: Mimir button in customer modal ═══ */
      .ncm-mimir-btn { display:flex;align-items:center;gap:8px;padding:10px 18px;border:none;border-radius:10px;background:linear-gradient(135deg,#C0392B,#D4A843);color:#fff;font-weight:700;font-size:13px;cursor:pointer;transition:all .2s;font-family:inherit;box-shadow:0 2px 12px rgba(192,57,43,.3) }
      .ncm-mimir-btn:hover { transform:translateY(-1px);box-shadow:0 4px 20px rgba(192,57,43,.4) }
      .ncm-mimir-btn:disabled { opacity:.7;cursor:wait;transform:none }
      @keyframes ncmMimirPulse { 0%,100%{box-shadow:0 2px 12px rgba(192,57,43,.3)} 50%{box-shadow:0 2px 20px rgba(212,168,67,.5)} }
      .ncm-mimir-btn.pulsing { animation:ncmMimirPulse 2s ease infinite }

      /* ═══ WOW: ЕГРЮЛ badge ═══ */
      .ncm-egrjul-badge { display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:8px;font-size:12px;font-weight:600;animation:ncmFieldFill .4s ease }
      .ncm-egrjul-badge.ok { background:rgba(16,185,129,.1);color:#10b981;border:1px solid rgba(16,185,129,.2) }
      .ncm-egrjul-badge.warn { background:rgba(245,158,11,.1);color:#f59e0b;border:1px solid rgba(245,158,11,.2) }

      /* ═══ WOW: Skeleton loading in fields ═══ */
      @keyframes ncmSkeleton { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
      .ncm-skeleton-inp { background:linear-gradient(90deg,#0d1117 25%,rgba(212,168,67,.08) 50%,#0d1117 75%) !important;background-size:200% 100% !important;animation:ncmSkeleton 1.5s ease infinite !important;color:transparent !important;pointer-events:none !important }
    `;
    document.head.appendChild(s);
  }

  // Модальное окно создания/редактирования
  async function openContractModal(contract, customers) {
    ensureModalStyles();
    const isEdit = !!contract;
    const esc = AsgardUI.esc;
    const isPerpetual = !!contract?.is_perpetual;

    const statusBadge = isEdit ? (() => {
      const cs = computeStatus(contract);
      const st = CONTRACT_STATUSES.find(s => s.id === cs) || CONTRACT_STATUSES[0];
      return `<span style="font-size:11px;padding:4px 10px;border-radius:20px;background:${st.color}15;color:${st.color};font-weight:600;letter-spacing:.3px">${st.name}</span>`;
    })() : '';

    const html = `
      <div id="contractModal">
        <div class="cm-overlay">
          <div class="cm-card" style="max-width:660px">

            <div style="padding:22px 24px 18px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,.05)">
              <div style="display:flex;align-items:center;gap:14px">
                <div style="width:42px;height:42px;border-radius:11px;background:linear-gradient(135deg,#3b82f6,#6366f1);display:flex;align-items:center;justify-content:center;flex-shrink:0">
                  <svg width="20" height="20" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V4a2 2 0 00-2-2z"/><path d="M8 6h4M8 10h4M8 14h2"/></svg>
                </div>
                <div>
                  <div style="font-size:17px;font-weight:700;color:#f9fafb">${isEdit ? 'Редактирование договора' : 'Новый договор'}</div>
                  ${isEdit ? `<div style="font-size:12px;color:#6b7280;margin-top:2px">${esc(contract.number || '')}</div>` : '<div style="font-size:12px;color:#6b7280;margin-top:2px">Заполните данные договора</div>'}
                </div>
              </div>
              <div style="display:flex;align-items:center;gap:10px">
                ${statusBadge}
                <button class="btnClose" style="width:34px;height:34px;border:1px solid rgba(255,255,255,.08);border-radius:8px;background:transparent;color:#6b7280;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s;font-size:16px" onmouseover="this.style.background='rgba(255,255,255,.05)';this.style.color='#e5e7eb'" onmouseout="this.style.background='transparent';this.style.color='#6b7280'">&#10005;</button>
              </div>
            </div>

            <div style="max-height:64vh;overflow-y:auto;padding:22px 24px">
              <form id="contractForm" autocomplete="off">

                <div class="cm-section">
                  <div class="cm-section-title"><svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="10" height="10" rx="1.5"/><path d="M6 6h4M6 8h3"/></svg>Основная информация</div>
                  <div class="cm-grid2">
                    <div>
                      <div class="cm-label">Номер договора <span class="req">*</span></div>
                      <input type="text" name="number" class="cm-inp" value="${esc(contract?.number || '')}" placeholder="Д-2026/001" required/>
                    </div>
                    <div>
                      <div class="cm-label">Тип договора <span class="req">*</span></div>
                      <select name="type" class="cm-inp" required>
                        ${CONTRACT_TYPES.map(t => `<option value="${t.id}" ${contract?.type === t.id ? 'selected' : ''}>${t.name}</option>`).join('')}
                      </select>
                    </div>
                  </div>
                  <div class="cm-mt">
                    <div class="cm-label">Контрагент <span class="req">*</span></div>
                    <div style="display:flex;gap:8px;align-items:center">
                      <select name="counterparty_id" class="cm-inp" required style="flex:1">
                        <option value="">-- Выберите контрагента --</option>
                        ${customers.map(c => `<option value="${esc(c.inn)}" ${contract?.counterparty_id === c.inn ? 'selected' : ''}>${esc(c.name)}${c.inn ? ' (' + esc(c.inn) + ')' : ''}</option>`).join('')}
                      </select>
                      <button type="button" id="btnAddCustomerInline" class="cm-btn-add-customer" title="Создать нового контрагента">
                        <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="9" y1="4" x2="9" y2="14"/><line x1="4" y1="9" x2="14" y2="9"/></svg>
                      </button>
                    </div>
                  </div>
                  <div class="cm-mt">
                    <div class="cm-label">Предмет договора</div>
                    <textarea name="subject" class="cm-inp" rows="2" placeholder="Краткое описание предмета договора...">${esc(contract?.subject || '')}</textarea>
                  </div>
                </div>

                <div class="cm-section">
                  <div class="cm-section-title"><svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="10" height="10" rx="1.5"/><path d="M3 7h10M7 3v10"/></svg>Сроки и финансы</div>
                  <div class="cm-grid2">
                    <div>
                      <div class="cm-label">Дата заключения</div>
                      <input type="date" name="start_date" class="cm-inp" value="${contract?.start_date || ''}"/>
                    </div>
                    <div>
                      <div class="cm-label">Сумма</div>
                      <div class="cm-amount-wrap">
                        <input type="number" name="amount" class="cm-inp" step="0.01" value="${contract?.amount || ''}" placeholder="0.00"/>
                        <span class="cm-suffix">&#8381;</span>
                      </div>
                    </div>
                  </div>
                  <div class="cm-mt" style="display:grid;grid-template-columns:1fr auto;gap:12px;align-items:end">
                    <div>
                      <div class="cm-label">Срок действия до</div>
                      <input type="date" name="end_date" class="cm-inp" id="cmEndDate" value="${contract?.end_date || ''}" ${isPerpetual ? 'disabled' : ''}/>
                    </div>
                    <div id="cmPerpetualToggle" class="cm-toggle${isPerpetual ? ' active' : ''}">
                      <div class="cm-toggle-track"><div class="cm-toggle-thumb"></div></div>
                      <span class="cm-toggle-text">Бессрочный</span>
                    </div>
                  </div>
                  <div id="cmDateHint"></div>
                </div>

                <div class="cm-section">
                  <div class="cm-section-title"><svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="8" cy="8" r="5.5"/><path d="M8 5.5v3l2 1.5"/></svg>Дополнительно</div>
                  <div class="cm-grid2">
                    <div>
                      <div class="cm-label">Ответственный</div>
                      <input type="text" name="responsible" class="cm-inp" value="${esc(contract?.responsible || '')}" placeholder="ФИО сотрудника"/>
                    </div>
                    <div>
                      <div class="cm-label">Статус</div>
                      <select name="status" class="cm-inp">
                        <option value="draft" ${contract?.status === 'draft' ? 'selected' : ''}>Черновик</option>
                        <option value="active" ${(!contract?.status || contract?.status === 'active') ? 'selected' : ''}>Действует</option>
                        <option value="terminated" ${contract?.status === 'terminated' ? 'selected' : ''}>Расторгнут</option>
                      </select>
                    </div>
                  </div>
                  <div class="cm-mt">
                    <div class="cm-label">Файл договора (ссылка)</div>
                    <input type="url" name="file_url" class="cm-inp" placeholder="https://drive.google.com/..." value="${esc(contract?.file_url || '')}"/>
                  </div>
                  <div class="cm-mt">
                    <div class="cm-label">Комментарий</div>
                    <textarea name="comment" class="cm-inp" rows="2" placeholder="Заметки по договору...">${esc(contract?.comment || '')}</textarea>
                  </div>
                </div>

              </form>
            </div>

            <div class="cm-footer" style="justify-content:space-between">
              <div id="cmMimirSlot"></div>
              <div style="display:flex;gap:10px">
                <button class="cm-btn cm-btn-ghost btnClose">Отмена</button>
                <button class="cm-btn cm-btn-primary" id="btnSaveContract">${isEdit ? 'Сохранить' : 'Создать договор'}</button>
              </div>
            </div>

          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);

    const modal = document.getElementById('contractModal');
    const overlay = modal.querySelector('.cm-overlay');
    const form = document.getElementById('contractForm');
    const endDateInput = document.getElementById('cmEndDate');
    const perpetualToggle = document.getElementById('cmPerpetualToggle');
    const dateHintEl = document.getElementById('cmDateHint');
    let _isPerpetual = isPerpetual;

    // ── Date hint ──
    function updateDateHint() {
      if (!endDateInput.value || _isPerpetual) { dateHintEl.innerHTML = ''; return; }
      const days = Math.ceil((new Date(endDateInput.value) - new Date()) / 86400000);
      let cls, text;
      if (days < 0) { cls = 'cm-hint-red'; text = 'Истёк ' + Math.abs(days) + ' дн. назад'; }
      else if (days <= 30) { cls = 'cm-hint-amber'; text = 'Истекает через ' + days + ' дн.'; }
      else { cls = 'cm-hint-green'; text = 'Осталось ' + days + ' дн.'; }
      dateHintEl.innerHTML = '<div class="cm-hint ' + cls + '">' + text + '</div>';
    }
    updateDateHint();
    endDateInput.addEventListener('change', updateDateHint);

    // ── Perpetual toggle (DIV, not label — no auto-toggle bug) ──
    perpetualToggle.addEventListener('click', () => {
      _isPerpetual = !_isPerpetual;
      perpetualToggle.classList.toggle('active', _isPerpetual);
      endDateInput.disabled = _isPerpetual;
      if (_isPerpetual) endDateInput.value = '';
      updateDateHint();
    });

    // ── Close ──
    function closeModal() { modal.remove(); document.removeEventListener('keydown', onKey); }
    const onKey = (e) => { if (e.key === 'Escape') closeModal(); };
    document.addEventListener('keydown', onKey);
    modal.querySelectorAll('.btnClose').forEach(b => b.addEventListener('click', closeModal));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

    // ── Кнопка «+ Новый контрагент» ──
    document.getElementById('btnAddCustomerInline')?.addEventListener('click', () => {
      openNewCustomerModal((created) => {
        const sel = form.querySelector('[name="counterparty_id"]');
        // Проверка дубля: если ИНН уже в dropdown — выбрать существующий
        const existing = sel.querySelector(`option[value="${created.inn}"]`);
        if (existing) {
          existing.selected = true;
          sel.classList.remove('cm-err');
          return;
        }
        const opt = document.createElement('option');
        opt.value = created.inn;
        opt.textContent = `${created.name}${created.inn ? ' (' + created.inn + ')' : ''}`;
        opt.selected = true;
        sel.appendChild(opt);
        sel.classList.remove('cm-err');
        customers.push(created);
      });
    });

    // ── Validation ──
    form.querySelectorAll('.cm-inp[required]').forEach(f => {
      f.addEventListener('blur', () => { f.classList.toggle('cm-err', !f.value.trim()); });
      f.addEventListener('input', () => { if (f.value.trim()) f.classList.remove('cm-err'); });
    });

    // ── WOW: Mimir auto-fill для формы договора ──
    if (window.MimirForms) {
      const mimirSlot = document.getElementById('cmMimirSlot');
      if (mimirSlot) {
        MimirForms.inject(form, 'contract', () => ({
          counterparty_id: form.querySelector('[name="counterparty_id"]')?.value || '',
          tender_id: null
        }), {
          target: mimirSlot,
          position: 'after',
          buttonText: 'Мимир заполнит'
        });
      }
    }

    // ── Save ──
    document.getElementById('btnSaveContract').addEventListener('click', async () => {
      const fd = new FormData(form);
      const number = fd.get('number')?.trim();
      const counterparty_id = fd.get('counterparty_id');
      let hasErr = false;

      if (!number) {
        const el = form.querySelector('[name="number"]'); el.classList.add('cm-err'); el.focus();
        AsgardUI.toast('Ошибка', 'Укажите номер договора', 'err'); hasErr = true;
      }
      if (!counterparty_id) {
        const el = form.querySelector('[name="counterparty_id"]'); el.classList.add('cm-err');
        if (!hasErr) el.focus();
        AsgardUI.toast('Ошибка', 'Выберите контрагента', 'err'); hasErr = true;
      }
      if (hasErr) return;

      const startDate = fd.get('start_date'), endDate = fd.get('end_date');
      if (startDate && endDate && endDate < startDate) {
        AsgardUI.toast('Ошибка', 'Дата окончания раньше даты заключения', 'err'); return;
      }

      const customer = customers.find(c => c.inn === counterparty_id);
      const data = {
        id: contract?.id || undefined,
        number, type: fd.get('type'), counterparty_id,
        counterparty_name: customer?.name || '',
        subject: fd.get('subject')?.trim() || '',
        start_date: startDate || null, end_date: endDate || null,
        is_perpetual: _isPerpetual,
        amount: fd.get('amount') ? parseFloat(fd.get('amount')) : null,
        responsible: fd.get('responsible')?.trim() || '',
        status: fd.get('status'),
        file_url: fd.get('file_url')?.trim() || '',
        comment: fd.get('comment')?.trim() || '',
        created_at: contract?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      await save(data);
      closeModal();
      AsgardUI.toast('Сохранено', isEdit ? 'Договор обновлён' : 'Договор добавлен', 'ok');
      render({ layout: window.layout, title: 'Реестр договоров' });
    });
  }

  // Модальное окно выбора/создания договора
  async function openContractSelector(counterpartyId, type, onSelect) {
    ensureModalStyles();
    const contracts = await findByCounterparty(counterpartyId, type);
    const customers = await AsgardDB.getAll('customers') || [];
    const esc = AsgardUI.esc;

    const html = `
      <div id="contractSelectorModal">
        <div class="cm-overlay">
          <div class="cm-card" style="max-width:500px">
            <div style="padding:22px 24px 18px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,.05)">
              <div style="display:flex;align-items:center;gap:14px">
                <div style="width:38px;height:38px;border-radius:10px;background:linear-gradient(135deg,#3b82f6,#6366f1);display:flex;align-items:center;justify-content:center;flex-shrink:0">
                  <svg width="18" height="18" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"><path d="M14 2H6a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V4a2 2 0 00-2-2z"/><path d="M8 6h4M8 10h4M8 14h2"/></svg>
                </div>
                <div style="font-size:16px;font-weight:700;color:#f9fafb">Выберите договор</div>
              </div>
              <button class="btnClose" style="width:34px;height:34px;border:1px solid rgba(255,255,255,.08);border-radius:8px;background:transparent;color:#6b7280;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px">&#10005;</button>
            </div>
            <div style="padding:20px 24px;max-height:60vh;overflow-y:auto">
              ${contracts.length > 0 ? `
                <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">
                  ${contracts.map((c, i) => {
                    const st = CONTRACT_STATUSES.find(s => s.id === computeStatus(c)) || CONTRACT_STATUSES[1];
                    return `
                    <div data-cid="${c.id}" class="csel-item" style="display:flex;align-items:center;gap:14px;padding:14px 16px;border-radius:10px;border:2px solid ${i === 0 ? '#3b82f6' : 'rgba(255,255,255,.06)'};cursor:pointer;transition:all .15s;background:${i === 0 ? 'rgba(59,130,246,.05)' : 'transparent'}">
                      <span class="csel-radio" style="width:20px;height:20px;border-radius:50%;border:2px solid ${i === 0 ? '#3b82f6' : 'rgba(255,255,255,.15)'};display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .15s;background:${i === 0 ? '#3b82f6' : 'transparent'}"><span style="width:8px;height:8px;border-radius:50%;background:#fff;display:${i === 0 ? 'block' : 'none'}"></span></span>
                      <div style="flex:1;min-width:0">
                        <div style="font-weight:600;font-size:14px;color:#f3f4f6">${esc(c.number)}</div>
                        <div style="font-size:12px;color:#6b7280;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.subject || 'Без предмета')}${c.amount ? ' &middot; ' + formatMoney(c.amount) : ''}</div>
                      </div>
                      <span style="font-size:11px;padding:3px 8px;border-radius:20px;background:${st.color}15;color:${st.color};font-weight:600;flex-shrink:0">${st.name}</span>
                    </div>`;
                  }).join('')}
                </div>
                <div style="text-align:center;margin:12px 0;font-size:12px;color:#4b5563;display:flex;align-items:center;gap:12px"><span style="flex:1;height:1px;background:rgba(255,255,255,.06)"></span>или<span style="flex:1;height:1px;background:rgba(255,255,255,.06)"></span></div>
              ` : '<div style="text-align:center;padding:24px;color:#6b7280;font-size:14px">Договоров с этим контрагентом не найдено</div>'}
              <button id="btnCreateNewContract" style="width:100%;padding:12px;border-radius:10px;border:1px dashed rgba(255,255,255,.12);background:transparent;color:#9ca3af;font-size:14px;cursor:pointer;font-family:inherit;transition:all .15s" onmouseover="this.style.borderColor='#3b82f6';this.style.color='#3b82f6'" onmouseout="this.style.borderColor='rgba(255,255,255,.12)';this.style.color='#9ca3af'">+ Создать новый договор</button>
            </div>
            <div class="cm-footer">
              <button class="cm-btn cm-btn-ghost btnClose">Отмена</button>
              <button class="cm-btn cm-btn-primary" id="btnSelectContract" ${contracts.length === 0 ? 'disabled style="opacity:.4;pointer-events:none"' : ''}>Выбрать</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);
    const modal = document.getElementById('contractSelectorModal');
    const overlay = modal.querySelector('.cm-overlay');
    let selectedId = contracts.length > 0 ? String(contracts[0].id) : null;

    // Radio card selection
    modal.querySelectorAll('.csel-item').forEach(item => {
      item.addEventListener('click', () => {
        modal.querySelectorAll('.csel-item').forEach(el => {
          el.style.borderColor = 'rgba(255,255,255,.06)';
          el.style.background = 'transparent';
          const r = el.querySelector('.csel-radio'), d = r.querySelector('span');
          r.style.borderColor = 'rgba(255,255,255,.15)'; r.style.background = 'transparent'; d.style.display = 'none';
        });
        item.style.borderColor = '#3b82f6'; item.style.background = 'rgba(59,130,246,.05)';
        const r = item.querySelector('.csel-radio'), d = r.querySelector('span');
        r.style.borderColor = '#3b82f6'; r.style.background = '#3b82f6'; d.style.display = 'block';
        selectedId = item.dataset.cid;
        const btn = document.getElementById('btnSelectContract');
        btn.disabled = false; btn.style.opacity = '1'; btn.style.pointerEvents = 'auto';
      });
    });

    function closeModal() { modal.remove(); document.removeEventListener('keydown', onKey); }
    const onKey = (e) => { if (e.key === 'Escape') closeModal(); };
    document.addEventListener('keydown', onKey);
    modal.querySelectorAll('.btnClose').forEach(b => b.addEventListener('click', closeModal));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

    document.getElementById('btnCreateNewContract')?.addEventListener('click', () => {
      closeModal();
      const customer = customers.find(c => c.id === counterpartyId);
      openContractModal({ counterparty_id: counterpartyId, counterparty_name: customer?.name, type }, customers);
    });

    document.getElementById('btnSelectContract')?.addEventListener('click', () => {
      if (selectedId) {
        const contract = contracts.find(c => String(c.id) === selectedId);
        closeModal();
        if (onSelect) onSelect(contract);
      }
    });
  }

  // Helpers
  function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('ru-RU');
  }

  function formatMoney(amount) {
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(amount);
  }

  // ═══════ WOW Модалка создания нового контрагента (inline из договора) ═══════
  function openNewCustomerModal(onCreated) {
    ensureModalStyles();
    const esc = AsgardUI.esc;

    // Маска телефона: +7 (XXX) XXX-XX-XX
    const formatPhone = (val) => {
      const d = val.replace(/\D/g, '').slice(0, 11);
      if (!d) return '';
      let r = '+7';
      if (d.length > 1) r += ' (' + d.slice(1, 4);
      if (d.length > 4) r += ') ' + d.slice(4, 7);
      if (d.length > 7) r += '-' + d.slice(7, 9);
      if (d.length > 9) r += '-' + d.slice(9, 11);
      return r;
    };

    const html = `
      <div id="newCustomerModal">
        <div class="cm-overlay">
          <div class="cm-card" style="max-width:580px">

            <div style="padding:22px 24px 18px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,.05)">
              <div style="display:flex;align-items:center;gap:14px">
                <div style="width:46px;height:46px;border-radius:13px;background:linear-gradient(135deg,#10b981,#059669);display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 4px 16px rgba(16,185,129,.3)">
                  <svg width="22" height="22" fill="none" stroke="#fff" stroke-width="1.8"><path d="M16 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="10" cy="7" r="4"/><line x1="18" y1="8" x2="18" y2="14"/><line x1="15" y1="11" x2="21" y2="11"/></svg>
                </div>
                <div>
                  <div style="font-size:18px;font-weight:700;color:#f9fafb">Новый контрагент</div>
                  <div style="font-size:12px;color:#6b7280;margin-top:2px">Начните вводить название или ИНН</div>
                </div>
              </div>
              <button class="ncm-close" style="width:34px;height:34px;border:1px solid rgba(255,255,255,.08);border-radius:8px;background:transparent;color:#6b7280;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s;font-size:16px" onmouseover="this.style.background='rgba(255,255,255,.05)';this.style.color='#e5e7eb'" onmouseout="this.style.background='transparent';this.style.color='#6b7280'">&#10005;</button>
            </div>

            <div style="max-height:64vh;overflow-y:auto;padding:22px 24px">
              <form id="newCustomerForm" autocomplete="off">

                <!-- ═══ WOW: Smart Search Bar ═══ -->
                <div style="margin-bottom:16px;padding:16px;border-radius:12px;background:linear-gradient(135deg,rgba(212,168,67,.06),rgba(59,130,246,.04));border:1px solid rgba(212,168,67,.15)">
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
                    <span style="font-size:16px">🔍</span>
                    <span style="font-size:13px;font-weight:600;color:#D4A843">Умный поиск</span>
                    <span style="font-size:11px;color:#6b7280">— введите название или ИНН, мы найдём всё сами</span>
                  </div>
                  <div style="position:relative" id="ncmSearchWrap">
                    <input type="text" id="ncmSmartSearch" class="cm-inp" placeholder="ООО «Газпром» или 7736050003..." style="height:48px;font-size:15px;padding-right:90px;border-color:rgba(212,168,67,.2)"/>
                    <button type="button" id="ncmLookup" style="position:absolute;right:4px;top:4px;height:40px;padding:0 16px;border-radius:7px;border:none;background:linear-gradient(135deg,#10b981,#059669);color:#fff;font-size:13px;font-weight:600;cursor:pointer;transition:all .15s;display:flex;align-items:center;justify-content:center;gap:4px">
                      <svg width="14" height="14" fill="none" stroke="#fff" stroke-width="2"><circle cx="6" cy="6" r="5"/><line x1="10" y1="10" x2="13" y2="13"/></svg>
                      Найти
                    </button>
                    <div id="ncmSuggestDropdown" class="ncm-suggest-dropdown"></div>
                  </div>
                </div>

                <!-- ═══ ЕГРЮЛ Badge ═══ -->
                <div id="ncmEgrjulBadge" style="display:none;margin-bottom:14px"></div>

                <div class="cm-section" id="ncmSectionReq">
                  <div class="cm-section-title">
                    <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="10" height="10" rx="1.5"/><path d="M6 6h4M6 8h3"/></svg>Реквизиты
                  </div>
                  <div class="cm-grid2">
                    <div>
                      <div class="cm-label">ИНН <span class="req">*</span></div>
                      <input type="text" name="inn" class="cm-inp" placeholder="10 или 12 цифр" required maxlength="12" inputmode="numeric"/>
                    </div>
                    <div>
                      <div class="cm-label">КПП</div>
                      <input type="text" name="kpp" class="cm-inp" placeholder="9 цифр" maxlength="9" inputmode="numeric"/>
                    </div>
                  </div>
                  <div class="cm-mt">
                    <div class="cm-label">Наименование <span class="req">*</span></div>
                    <input type="text" name="name" class="cm-inp" placeholder="ООО «Компания»" required/>
                  </div>
                  <div class="cm-mt">
                    <div class="cm-label">Полное наименование</div>
                    <input type="text" name="full_name" class="cm-inp" placeholder="Полное юридическое наименование"/>
                  </div>
                  <div class="cm-mt">
                    <div class="cm-label">Адрес</div>
                    <input type="text" name="address" class="cm-inp" placeholder="Юридический адрес"/>
                  </div>
                </div>

                <div class="cm-section" id="ncmSectionContacts">
                  <div class="cm-section-title">
                    <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 5a2 2 0 012-2h6a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2V5z"/><path d="M7 7h2"/></svg>Контакты
                  </div>
                  <div class="cm-grid2">
                    <div>
                      <div class="cm-label">Контактное лицо</div>
                      <input type="text" name="contact_person" class="cm-inp" placeholder="ФИО"/>
                    </div>
                    <div>
                      <div class="cm-label">Телефон</div>
                      <input type="tel" name="phone" class="cm-inp" placeholder="+7 (___) ___-__-__"/>
                    </div>
                  </div>
                  <div class="cm-mt">
                    <div class="cm-label">Email</div>
                    <input type="email" name="email" class="cm-inp" placeholder="info@company.ru"/>
                  </div>
                </div>

                <div id="ncmStatus" style="display:none;padding:10px 14px;border-radius:8px;font-size:13px;align-items:center;gap:8px"></div>
              </form>
            </div>

            <div class="cm-footer" style="justify-content:space-between">
              <button type="button" class="ncm-mimir-btn pulsing" id="ncmMimirBtn" title="Мимир заполнит форму по контексту">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" fill="rgba(255,255,255,.2)"/></svg>
                Мимир заполнит
              </button>
              <div style="display:flex;gap:10px">
                <button class="cm-btn cm-btn-ghost ncm-close">Отмена</button>
                <button class="cm-btn cm-btn-primary" id="ncmSave">Создать контрагента</button>
              </div>
            </div>

          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);

    const ncModal = document.getElementById('newCustomerModal');
    const ncOverlay = ncModal.querySelector('.cm-overlay');
    const ncForm = document.getElementById('newCustomerForm');
    const ncStatus = document.getElementById('ncmStatus');
    const smartSearch = document.getElementById('ncmSmartSearch');
    const innInput = ncForm.querySelector('[name="inn"]');
    const kppInput = ncForm.querySelector('[name="kpp"]');
    const nameInput = ncForm.querySelector('[name="name"]');
    const fullNameInput = ncForm.querySelector('[name="full_name"]');
    const addressInput = ncForm.querySelector('[name="address"]');
    const phoneInput = ncForm.querySelector('[name="phone"]');
    const emailInput = ncForm.querySelector('[name="email"]');
    const contactInput = ncForm.querySelector('[name="contact_person"]');
    const lookupBtn = document.getElementById('ncmLookup');
    const saveBtn = document.getElementById('ncmSave');
    const suggestDropdown = document.getElementById('ncmSuggestDropdown');
    const egrjulBadge = document.getElementById('ncmEgrjulBadge');
    const mimirBtn = document.getElementById('ncmMimirBtn');
    let searchTimer = null;

    // ── Закрытие ──
    const closeNcm = () => { ncModal.remove(); document.removeEventListener('keydown', ncKey); };
    const ncKey = (e) => { if (e.key === 'Escape') closeNcm(); };
    document.addEventListener('keydown', ncKey);
    ncModal.querySelectorAll('.ncm-close').forEach(b => b.addEventListener('click', closeNcm));
    ncOverlay.addEventListener('click', (e) => { if (e.target === ncOverlay) closeNcm(); });

    // ── Статусная строка ──
    const showStatus = (msg, type) => {
      ncStatus.style.display = 'flex';
      const colors = { ok: ['rgba(16,185,129,.1)', '#10b981'], err: ['rgba(239,68,68,.1)', '#ef4444'], info: ['rgba(59,130,246,.1)', '#3b82f6'] };
      const [bg, fg] = colors[type] || colors.info;
      ncStatus.style.background = bg;
      ncStatus.style.color = fg;
      ncStatus.textContent = msg;
    };
    const hideStatus = () => { ncStatus.style.display = 'none'; };

    // ═══ WOW: Cascade fill — делегируем в MimirForms (единая реализация) ═══
    const cascadeFill = (fieldsMap) => {
      if (window.MimirForms) {
        return MimirForms.cascadeFill(ncForm, fieldsMap);
      }
      // Fallback если MimirForms ещё не загружен
      Object.entries(fieldsMap).forEach(([k, v]) => {
        if (!v) return;
        const inp = ncForm.querySelector(`[name="${k}"]`);
        if (inp && !inp.value) inp.value = v;
      });
      return Object.keys(fieldsMap).length;
    };

    // ═══ WOW: Smart Search — DaData autocomplete по названию ═══
    smartSearch.addEventListener('input', () => {
      clearTimeout(searchTimer);
      const q = smartSearch.value.trim();
      // Если похоже на ИНН (только цифры) — не делаем suggest
      if (!q || q.length < 3 || /^\d+$/.test(q)) {
        suggestDropdown.style.display = 'none';
        return;
      }
      searchTimer = setTimeout(async () => {
        try {
          const token = localStorage.getItem('asgard_token');
          const r = await fetch('/api/customers/suggest?q=' + encodeURIComponent(q) + '&type=party', {
            headers: { 'Authorization': 'Bearer ' + token }
          });
          const data = await r.json();
          if (!data.suggestions?.length) { suggestDropdown.style.display = 'none'; return; }
          suggestDropdown.innerHTML = data.suggestions.map((s, i) =>
            `<div class="ncm-suggest-item" data-idx="${i}">
              <div class="ncm-s-name">${esc(s.name || '')}</div>
              <div class="ncm-s-meta">ИНН ${esc(s.inn || '')}${s.address ? ' \u2022 ' + esc(s.address.slice(0, 60)) : ''}</div>
            </div>`
          ).join('');
          suggestDropdown.style.display = 'block';
          suggestDropdown.querySelectorAll('.ncm-suggest-item').forEach(el => {
            el.addEventListener('click', () => {
              const idx = parseInt(el.dataset.idx);
              const s = data.suggestions[idx];
              suggestDropdown.style.display = 'none';
              smartSearch.value = s.name || '';
              // Cascade заполнение
              cascadeFill({
                inn: s.inn,
                kpp: s.kpp,
                name: s.name,
                full_name: s.full_name,
                address: s.address
              });
              // ЕГРЮЛ badge
              egrjulBadge.innerHTML = '<div class="ncm-egrjul-badge ok"><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 7 7 11 13 3"/></svg>Данные из ЕГРЮЛ</div>';
              egrjulBadge.style.display = 'block';
            });
          });
        } catch (_) { suggestDropdown.style.display = 'none'; }
      }, 300);
    });

    // Скрыть dropdown при клике вне
    ncModal.addEventListener('click', (e) => {
      if (!smartSearch.contains(e.target) && !suggestDropdown.contains(e.target)) {
        suggestDropdown.style.display = 'none';
      }
    });

    // ── Smart Search: если ввели цифры (ИНН) — подставить в поле ИНН ──
    smartSearch.addEventListener('blur', () => {
      const v = smartSearch.value.trim();
      if (/^\d{10,12}$/.test(v) && !innInput.value) {
        innInput.value = v;
      }
    });

    // Кнопка "Найти" — lookup по ИНН
    lookupBtn.addEventListener('click', () => {
      const v = smartSearch.value.trim();
      if (/^\d+$/.test(v)) {
        innInput.value = v.replace(/\D/g, '').slice(0, 12);
        doLookup();
      } else if (innInput.value.replace(/\D/g, '').length >= 10) {
        doLookup();
      } else {
        // Попробовать поиск по названию — trigger suggest
        smartSearch.dispatchEvent(new Event('input'));
      }
    });

    // ── Маска ИНН: только цифры ──
    innInput.addEventListener('input', () => {
      innInput.value = innInput.value.replace(/\D/g, '').slice(0, 12);
      innInput.classList.remove('cm-err');
      hideStatus();
      // Авто-lookup при 10 или 12 цифрах
      const v = innInput.value;
      if (v.length === 10 || v.length === 12) {
        doLookup();
      }
    });

    // ── Маска КПП: только цифры ──
    kppInput.addEventListener('input', () => {
      kppInput.value = kppInput.value.replace(/\D/g, '').slice(0, 9);
    });

    // ── Маска телефона ──
    phoneInput.addEventListener('input', () => {
      const pos = phoneInput.selectionStart;
      const before = phoneInput.value.length;
      phoneInput.value = formatPhone(phoneInput.value);
      const after = phoneInput.value.length;
      phoneInput.setSelectionRange(pos + (after - before), pos + (after - before));
    });
    phoneInput.addEventListener('focus', () => {
      if (!phoneInput.value) phoneInput.value = '+7';
    });
    phoneInput.addEventListener('blur', () => {
      if (phoneInput.value === '+7') phoneInput.value = '';
    });

    // ── Валидация email при blur ──
    emailInput.addEventListener('blur', () => {
      const v = emailInput.value.trim();
      if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
        emailInput.classList.add('cm-err');
        showStatus('Некорректный формат email', 'err');
      } else {
        emailInput.classList.remove('cm-err');
      }
    });
    emailInput.addEventListener('input', () => emailInput.classList.remove('cm-err'));

    // ── Убираем ошибку при вводе в required полях ──
    nameInput.addEventListener('input', function() { this.classList.remove('cm-err'); hideStatus(); });

    // ═══ WOW: DaData lookup по ИНН с cascade-анимацией ═══
    const doLookup = async () => {
      const innVal = innInput.value.replace(/\D/g, '');
      if (innVal.length !== 10 && innVal.length !== 12) {
        showStatus('ИНН должен содержать 10 или 12 цифр', 'err');
        innInput.classList.add('cm-err');
        innInput.focus();
        return;
      }

      // Спиннер на кнопке + skeleton в полях
      lookupBtn.disabled = true;
      lookupBtn.innerHTML = '<span class="ncm-spinner"></span>';
      const skeletonFields = [nameInput, fullNameInput, kppInput, addressInput];
      skeletonFields.forEach(f => { if (!f.value) f.classList.add('ncm-skeleton-inp'); });

      try {
        const token = localStorage.getItem('asgard_token');
        const resp = await fetch('/api/customers/lookup/' + innVal, {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        const data = await resp.json();

        skeletonFields.forEach(f => f.classList.remove('ncm-skeleton-inp'));

        if (data.found && data.suggestion) {
          const s = data.suggestion;
          // WOW cascade fill
          const fields = {};
          if (s.name && !nameInput.value) fields.name = s.name;
          if (s.full_name && !fullNameInput.value) fields.full_name = s.full_name;
          if (s.kpp && !kppInput.value) fields.kpp = s.kpp;
          if (s.address && !addressInput.value) fields.address = s.address;
          cascadeFill(fields);

          // ЕГРЮЛ badge
          egrjulBadge.innerHTML = '<div class="ncm-egrjul-badge ok"><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 7 7 11 13 3"/></svg>Данные загружены из ЕГРЮЛ</div>';
          egrjulBadge.style.display = 'block';

          // Обновить smart search
          if (s.name && !smartSearch.value) smartSearch.value = s.name;
        } else {
          egrjulBadge.innerHTML = '<div class="ncm-egrjul-badge warn"><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="7" cy="7" r="6"/><line x1="7" y1="4" x2="7" y2="8"/><circle cx="7" cy="10" r=".5" fill="currentColor"/></svg>' + esc(data.message || 'Не найдено в ЕГРЮЛ') + '</div>';
          egrjulBadge.style.display = 'block';
        }
      } catch (err) {
        skeletonFields.forEach(f => f.classList.remove('ncm-skeleton-inp'));
        showStatus('Ошибка запроса: ' + err.message, 'err');
      } finally {
        lookupBtn.disabled = false;
        lookupBtn.innerHTML = '<svg width="14" height="14" fill="none" stroke="#fff" stroke-width="2"><circle cx="6" cy="6" r="5"/><line x1="10" y1="10" x2="13" y2="13"/></svg> Найти';
      }
    };

    innInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doLookup(); } });
    smartSearch.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const v = smartSearch.value.trim();
        if (/^\d{10,12}$/.test(v)) {
          innInput.value = v;
          doLookup();
        }
      }
    });

    // ═══ WOW: Мимир-кнопка — единый запрос через suggest-form (без двойного lookup) ═══
    mimirBtn.addEventListener('click', async () => {
      const context = smartSearch.value.trim() || nameInput.value.trim() || innInput.value.trim();
      if (!context) {
        AsgardUI.toast('Мимир', 'Сначала введите название или ИНН контрагента', 'warn');
        return;
      }

      mimirBtn.disabled = true;
      mimirBtn.classList.remove('pulsing');
      mimirBtn.innerHTML = '<span class="ncm-spinner"></span> Мимир думает\u2026';

      // Skeleton на пустых полях
      const emptyFields = ncForm.querySelectorAll('.cm-inp');
      emptyFields.forEach(f => { if (!f.value && window.MimirForms) f.classList.add('mimir-field-skeleton'); });

      try {
        const token = localStorage.getItem('asgard_token');
        const inn = innInput.value.replace(/\D/g, '');

        // Один запрос: suggest-form сам проверит ИНН в БД или вызовет AI
        const resp = await fetch('/api/mimir/suggest-form', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({
            form_type: 'customer',
            context: {
              search_query: context,
              inn: inn || undefined,
              name: nameInput.value.trim() || undefined
            }
          })
        });

        emptyFields.forEach(f => f.classList.remove('mimir-field-skeleton'));

        if (resp.ok) {
          const data = await resp.json();
          if (data.fields && Object.keys(data.fields).length > 0) {
            const filled = cascadeFill(data.fields);
            const source = data.source === 'database' ? 'из реестра' : 'через AI';
            AsgardUI.toast('Мимир', `Заполнил ${filled} полей (${source})`, 'ok');

            // ЕГРЮЛ badge если из БД
            if (data.source === 'database') {
              egrjulBadge.innerHTML = '<div class="ncm-egrjul-badge ok"><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 7 7 11 13 3"/></svg>Найден в реестре контрагентов</div>';
              egrjulBadge.style.display = 'block';
            }
          } else {
            // Если suggest-form не нашёл — пробуем ЕГРЮЛ lookup
            if (inn.length === 10 || inn.length === 12) {
              await doLookup();
            } else {
              AsgardUI.toast('Мимир', 'Недостаточно данных. Попробуйте ввести ИНН.', 'warn');
            }
          }
        } else {
          // Fallback на ЕГРЮЛ
          if (inn.length === 10 || inn.length === 12) {
            await doLookup();
          } else {
            AsgardUI.toast('Мимир', 'Ошибка сервера', 'err');
          }
        }
      } catch (err) {
        emptyFields.forEach(f => f.classList.remove('mimir-field-skeleton'));
        AsgardUI.toast('Мимир', 'Не удалось заполнить: ' + err.message, 'err');
      } finally {
        mimirBtn.disabled = false;
        mimirBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" fill="rgba(255,255,255,.2)"/></svg> Мимир заполнит';
        mimirBtn.classList.add('pulsing');
      }
    });

    // ── Сохранение ──
    saveBtn.addEventListener('click', async () => {
      const inn = innInput.value.replace(/\D/g, '');
      const name = nameInput.value.trim();
      const email = emailInput.value.trim();

      // Валидация ИНН
      if (!inn || (inn.length !== 10 && inn.length !== 12)) {
        showStatus('ИНН должен содержать 10 или 12 цифр', 'err');
        innInput.classList.add('cm-err');
        innInput.focus();
        return;
      }
      // Валидация наименования
      if (!name) {
        showStatus('Укажите наименование организации', 'err');
        nameInput.classList.add('cm-err');
        nameInput.focus();
        return;
      }
      // Валидация email (если заполнен)
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showStatus('Некорректный формат email', 'err');
        emailInput.classList.add('cm-err');
        emailInput.focus();
        return;
      }

      const body = {
        inn,
        name,
        full_name: fullNameInput.value.trim(),
        kpp: kppInput.value.trim(),
        address: addressInput.value.trim(),
        contact_person: contactInput.value.trim(),
        phone: phoneInput.value.trim(),
        email
      };

      // Спиннер на кнопке сохранения
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span class="ncm-spinner"></span>Сохранение...';

      try {
        const token = localStorage.getItem('asgard_token');
        const resp = await fetch('/api/customers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify(body)
        });
        const result = await resp.json();

        if (!resp.ok) {
          showStatus(result.error || 'Ошибка сохранения', 'err');
          saveBtn.disabled = false;
          saveBtn.innerHTML = 'Создать контрагента';
          return;
        }

        const created = result.customer;
        // Сохраняем в IndexedDB для локального кэша
        try { await AsgardDB.put('customers', created); } catch (_) { /* fallback не критичен */ }

        // ═══ WOW: Success animation ═══
        const card = ncModal.querySelector('.cm-card');
        card.style.transition = 'all .3s ease';
        card.style.borderColor = 'rgba(16,185,129,.4)';
        card.style.boxShadow = '0 0 40px rgba(16,185,129,.2)';

        AsgardUI.toast('Контрагент', `${esc(created.name)} добавлен в реестр`, 'ok');
        setTimeout(() => {
          closeNcm();
          if (onCreated) onCreated(created);
        }, 400);
      } catch (err) {
        showStatus('Ошибка сети: ' + err.message, 'err');
        saveBtn.disabled = false;
        saveBtn.innerHTML = 'Создать контрагента';
      }
    });

    // ── Автофокус на Smart Search ──
    setTimeout(() => smartSearch.focus(), 100);
  }

  // Проверка истекающих договоров для уведомлений
  async function checkExpiringContracts() {
    const contracts = await getAll();
    const expiring = contracts.filter(c => {
      const status = computeStatus(c);
      return status === 'expiring';
    });
    return expiring;
  }

  return {
    render,
    getAll,
    save,
    remove,
    findByCounterparty,
    openContractSelector,
    checkExpiringContracts,
    CONTRACT_TYPES,
    CONTRACT_STATUSES
  };
})();
