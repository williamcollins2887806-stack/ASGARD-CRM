// Жильё, Билеты и Направления — Логистика сотрудников
// Использует /api/field/logistics (field-logistics.js)

window.AsgardTravelPage = (function(){
  'use strict';
  const { $, $$, esc, toast, showModal, formatDate } = AsgardUI;

  // Разрешённые роли
  const ALLOWED_ROLES = ['ADMIN','OFFICE_MANAGER','HR','PM','HEAD_PM','DIRECTOR_COMM','DIRECTOR_GEN','DIRECTOR_DEV','TO'];

  // Типы записей с вкладками
  const TAB_DEFS = [
    {
      id: 'tickets',
      label: '✈️ Билеты',
      types: ['ticket_to','ticket_back','flight','train','transfer'],
    },
    {
      id: 'housing',
      label: '🏠 Жильё',
      types: ['hotel','housing','hostel'],
    },
    {
      id: 'directives',
      label: '📋 Направления МО',
      types: ['directive_mo'],
    },
    {
      id: 'training',
      label: '📚 Обучение',
      types: ['training','certification'],
    },
  ];

  const TYPE_OPTS = [
    { key:'ticket_to',   label:'✈️ Билет туда',       tab:'tickets'  },
    { key:'ticket_back', label:'✈️ Билет обратно',     tab:'tickets'  },
    { key:'flight',      label:'✈️ Авиабилет',         tab:'tickets'  },
    { key:'train',       label:'🚂 Ж/Д билет',         tab:'tickets'  },
    { key:'transfer',    label:'🚐 Трансфер',          tab:'tickets'  },
    { key:'hotel',       label:'🏨 Гостиница',         tab:'housing'  },
    { key:'housing',     label:'🏠 Жильё / аренда',    tab:'housing'  },
    { key:'hostel',      label:'🛏 Хостел',            tab:'housing'  },
    { key:'directive_mo',label:'📋 Направление МО',    tab:'directives'},
    { key:'training',    label:'📚 Обучение',          tab:'training' },
    { key:'certification',label:'🎓 Аттестация/допуск', tab:'training' },
  ];

  function typeLabel(key) {
    return (TYPE_OPTS.find(t => t.key === key) || { label: key }).label;
  }

  function today() { return new Date().toISOString().slice(0,10); }

  async function getToken() {
    return localStorage.getItem('asgard_token') || '';
  }

  async function apiGet(path) {
    const res = await fetch('/api/field/logistics' + path, {
      headers: { Authorization: 'Bearer ' + await getToken() }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function apiPost(path, body) {
    const res = await fetch('/api/field/logistics' + path, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + await getToken(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Ошибка');
    }
    return res.json();
  }

  async function uploadFile(logisticsId, file) {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/field/logistics/' + logisticsId + '/attach', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + await getToken() },
      body: fd
    });
    if (!res.ok) throw new Error('Ошибка загрузки файла');
    return res.json();
  }

  async function render({ layout, title }) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = '#/login'; return; }
    const user = auth.user;

    if (!ALLOWED_ROLES.includes(user.role)) {
      toast('Доступ', 'Раздел недоступен', 'err');
      location.hash = '#/home';
      return;
    }

    // Загрузка данных
    let items = [], works = [], employees = [];
    try {
      const data = await apiGet('/');
      items = Array.isArray(data.logistics) ? data.logistics : [];
    } catch(e) { toast('Ошибка', 'Не удалось загрузить данные', 'err'); }

    try { works = await AsgardDB.all('works'); } catch(e){}
    try { employees = await AsgardDB.all('employees'); } catch(e){}

    const worksMap = new Map(works.map(w => [w.id, w]));
    const empMap   = new Map(employees.map(e => [e.id, e]));

    let activeTab = 'tickets';
    let searchQ = '';

    function filteredItems() {
      const tab = TAB_DEFS.find(t => t.id === activeTab);
      if (!tab) return items;
      return items.filter(it => {
        if (!tab.types.includes(it.item_type)) return false;
        if (searchQ) {
          const s = searchQ.toLowerCase();
          const emp = empMap.get(it.employee_id);
          const work = worksMap.get(it.work_id);
          const match = (it.title || '').toLowerCase().includes(s)
            || (it.description || '').toLowerCase().includes(s)
            || (emp?.fio || '').toLowerCase().includes(s)
            || (work?.work_title || '').toLowerCase().includes(s);
          if (!match) return false;
        }
        return true;
      });
    }

    function tabCounts() {
      const counts = {};
      TAB_DEFS.forEach(tab => {
        counts[tab.id] = items.filter(it => tab.types.includes(it.item_type)).length;
      });
      return counts;
    }

    function renderPage() {
      const filtered = filteredItems();
      const counts = tabCounts();
      const totalAmount = items.reduce((s,i) => s + (parseFloat(i.amount)||0), 0);

      const css = `
        <style>
          .tl-header { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px; margin-bottom:20px; }
          .tl-tabs { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px; }
          .tl-tab {
            padding:8px 16px; border-radius:8px; border:1px solid rgba(148,163,184,.2);
            background:var(--bg3); color:var(--t2); font-size:13px; font-weight:600; cursor:pointer;
            transition: all .2s ease;
          }
          .tl-tab.active { background:var(--gold); color:#000; border-color:var(--gold); }
          .tl-tab .badge {
            display:inline-block; background:rgba(255,255,255,.25); border-radius:10px;
            padding:1px 7px; font-size:11px; margin-left:6px;
          }
          .tl-tab.active .badge { background:rgba(0,0,0,.15); }

          .tl-kpi { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:12px; margin-bottom:20px; }
          .tl-kpi-card {
            background:linear-gradient(135deg,var(--bg3),var(--bg2));
            border:1px solid rgba(148,163,184,.15);
            border-radius:8px; padding:16px; position:relative; overflow:hidden;
          }
          .tl-kpi-card::before { content:''; position:absolute; top:0;left:0;right:0;height:3px;background:var(--acc,var(--gold)); }
          .tl-kpi-label { font-size:10px; color:var(--muted); text-transform:uppercase; letter-spacing:1px; font-weight:700; }
          .tl-kpi-value { font-size:22px; font-weight:900; margin-top:6px; }
          .tl-kpi-icon { position:absolute; right:12px; top:50%; transform:translateY(-50%); font-size:28px; opacity:.15; }

          .tl-search { width:100%; padding:10px 14px; border-radius:8px; border:1px solid rgba(148,163,184,.2);
            background:var(--bg3); color:var(--text); font-size:13px; margin-bottom:16px; }

          .tl-grid { display:flex; flex-direction:column; gap:10px; }
          .tl-card {
            background:linear-gradient(135deg,var(--bg3),var(--bg2));
            border:1px solid rgba(148,163,184,.12);
            border-radius:10px; padding:16px;
            display:grid; grid-template-columns:1fr auto; gap:12px; align-items:start;
            transition:border-color .2s;
          }
          .tl-card:hover { border-color:rgba(242,208,138,.3); }
          .tl-card-type {
            display:inline-flex; align-items:center; gap:5px;
            padding:3px 10px; border-radius:6px;
            background:rgba(242,208,138,.12); color:var(--gold);
            font-size:11px; font-weight:700; margin-bottom:8px;
          }
          .tl-card-title { font-size:14px; font-weight:700; color:var(--text); }
          .tl-card-sub { font-size:12px; color:var(--muted); margin-top:3px; }
          .tl-card-meta { display:flex; gap:12px; flex-wrap:wrap; margin-top:8px; }
          .tl-card-meta span { font-size:11px; color:var(--t3); }
          .tl-card-amount { font-size:16px; font-weight:800; color:var(--gold); }
          .tl-card-vat { font-size:10px; color:var(--ok); font-weight:600; }
          .tl-card-actions { display:flex; flex-direction:column; gap:6px; align-items:flex-end; }
          .tl-btn {
            padding:6px 12px; border-radius:6px; border:1px solid rgba(148,163,184,.2);
            background:var(--bg3); color:var(--text); font-size:12px; cursor:pointer;
            white-space:nowrap; transition:all .15s;
          }
          .tl-btn:hover { border-color:var(--gold); color:var(--gold); }
          .tl-btn-send {
            background:linear-gradient(135deg,var(--ok),#1a7a50);
            border-color:var(--ok); color:#fff;
          }
          .tl-btn-send:hover { opacity:.9; }
          .tl-status-badge {
            display:inline-block; padding:2px 8px; border-radius:10px;
            font-size:10px; font-weight:700;
          }
          .st-pending { background:rgba(234,179,8,.15); color:#eab308; }
          .st-ready { background:rgba(59,130,246,.15); color:#3b82f6; }
          .st-sent { background:rgba(34,197,94,.15); color:#22c55e; }
          .tl-empty { text-align:center; padding:60px; color:var(--muted); font-size:14px; }
          .tl-file-link { font-size:11px; color:var(--blue); text-decoration:none; }
          .tl-file-link:hover { text-decoration:underline; }
        </style>
      `;

      const html = css + `
        <div class="panel">
          <div class="tl-header">
            <div>
              <h2 class="page-title" style="margin:0">Логистика сотрудников</h2>
              <div class="help" style="margin-top:6px">Жильё, авиабилеты, ж/д, направления МО и обучение</div>
            </div>
            <button class="btn" id="btnAddItem">➕ Добавить</button>
          </div>

          <div class="tl-kpi">
            <div class="tl-kpi-card" style="--acc:var(--gold)">
              <div class="tl-kpi-label">Всего записей</div>
              <div class="tl-kpi-value" style="color:var(--gold)">${items.length}</div>
              <div class="tl-kpi-icon">📋</div>
            </div>
            <div class="tl-kpi-card" style="--acc:var(--blue)">
              <div class="tl-kpi-label">Сумма расходов</div>
              <div class="tl-kpi-value" style="color:var(--blue)">${AsgardUI.money(totalAmount)} ₽</div>
              <div class="tl-kpi-icon">💰</div>
            </div>
            <div class="tl-kpi-card" style="--acc:var(--ok)">
              <div class="tl-kpi-label">Отправлено рабочим</div>
              <div class="tl-kpi-value" style="color:var(--ok)">${items.filter(i=>i.sent_to_employee).length}</div>
              <div class="tl-kpi-icon">✅</div>
            </div>
            <div class="tl-kpi-card" style="--acc:#f59e0b">
              <div class="tl-kpi-label">Ожидают отправки</div>
              <div class="tl-kpi-value" style="color:#f59e0b">${items.filter(i=>!i.sent_to_employee && i.status !== 'cancelled').length}</div>
              <div class="tl-kpi-icon">⏳</div>
            </div>
          </div>

          <div class="tl-tabs">
            ${TAB_DEFS.map(tab => `
              <button class="tl-tab ${activeTab===tab.id?'active':''}" data-tab="${tab.id}">
                ${tab.label}
                <span class="badge">${counts[tab.id]||0}</span>
              </button>
            `).join('')}
          </div>

          <input class="tl-search" id="tlSearch" placeholder="Поиск по сотруднику, проекту, описанию..." value="${esc(searchQ)}"/>

          ${filtered.length ? `
            <div class="tl-grid">
              ${filtered.map(item => {
                const emp  = empMap.get(item.employee_id);
                const work = worksMap.get(item.work_id);
                const stClass = item.status === 'sent' ? 'st-sent' : item.status === 'ready' ? 'st-ready' : 'st-pending';
                const stLabel = item.status === 'sent' ? 'Отправлено' : item.status === 'ready' ? 'Готово' : 'Ожидает';
                const fileUrl = item.download_url || null;

                return `
                  <div class="tl-card">
                    <div>
                      <div class="tl-card-type">${typeLabel(item.item_type)}</div>
                      <div class="tl-card-title">${esc(item.title || '—')}</div>
                      ${item.description ? `<div class="tl-card-sub">${esc(item.description)}</div>` : ''}
                      <div class="tl-card-meta">
                        ${emp ? `<span>👤 ${esc(emp.fio || '')}</span>` : ''}
                        ${work ? `<span>📁 ${esc(work.work_title || '')}</span>` : ''}
                        ${item.date_from ? `<span>📅 ${formatDate(item.date_from)}${item.date_to && item.date_to !== item.date_from ? ' — ' + formatDate(item.date_to) : ''}</span>` : ''}
                        ${fileUrl ? `<a class="tl-file-link" href="${esc(fileUrl)}" target="_blank">📎 Файл</a>` : ''}
                        <span class="tl-status-badge ${stClass}">${stLabel}</span>
                      </div>
                    </div>
                    <div class="tl-card-actions">
                      ${item.amount ? `<div class="tl-card-amount">${AsgardUI.money(item.amount)} ₽</div>` : ''}
                      ${item.vat_included ? `<div class="tl-card-vat">С НДС</div>` : ''}
                      <button class="tl-btn" data-upload="${item.id}">📎 Файл</button>
                      ${!item.sent_to_employee ? `<button class="tl-btn tl-btn-send" data-send="${item.id}">📨 Отправить</button>` : ''}
                      <button class="tl-btn" data-del="${item.id}">🗑</button>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          ` : `
            <div class="tl-empty">
              <div style="font-size:48px;margin-bottom:12px">📋</div>
              <div style="font-weight:700;margin-bottom:6px">Нет записей</div>
              <div style="font-size:12px">Добавьте билет, жильё или направление</div>
            </div>
          `}
        </div>
      `;

      layout(html, { title: title || 'Логистика сотрудников' }).then(bindEvents);
    }

    function bindEvents() {
      // Вкладки
      $$('.tl-tab').forEach(btn => {
        btn.addEventListener('click', () => {
          activeTab = btn.dataset.tab;
          renderPage();
        });
      });

      // Поиск
      $('#tlSearch')?.addEventListener('input', e => {
        searchQ = e.target.value;
        renderPage();
      });

      // Добавить
      $('#btnAddItem')?.addEventListener('click', () => openAddModal());

      // Загрузить файл
      $$('[data-upload]').forEach(btn => {
        btn.addEventListener('click', () => openUploadModal(Number(btn.dataset.upload)));
      });

      // Отправить уведомление
      $$('[data-send]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = Number(btn.dataset.send);
          btn.textContent = '⏳';
          btn.disabled = true;
          try {
            const r = await apiPost('/' + id + '/send', {});
            const parts = [];
            if (r.sms_sent) parts.push('SMS');
            if (r.push_sent) parts.push('Push');
            toast('Отправлено', 'Уведомление: ' + (parts.join(' + ') || 'сохранено'));
            // Refresh
            const data = await apiGet('/');
            items = Array.isArray(data.logistics) ? data.logistics : [];
            renderPage();
          } catch(e) {
            toast('Ошибка', e.message, 'err');
            btn.textContent = '📨 Отправить';
            btn.disabled = false;
          }
        });
      });

      // Удалить
      $$('[data-del]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Удалить запись?')) return;
          // Используем generic data API для удаления
          await AsgardDB.del('field_logistics', Number(btn.dataset.del));
          toast('Удалено', 'Запись удалена');
          const data = await apiGet('/');
          items = Array.isArray(data.logistics) ? data.logistics : [];
          renderPage();
        });
      });
    }

    function openAddModal() {
      const typeOptsHtml = TYPE_OPTS.map(t => `<option value="${t.key}">${t.label}</option>`).join('');
      const empOptsHtml = [{ id:'', fio:'— Выберите сотрудника —' }, ...employees]
        .map(e => `<option value="${e.id||''}">${esc(e.fio||'')}</option>`).join('');
      const workOptsHtml = [{ id:'', work_title:'— Не привязано к проекту —' }, ...works.filter(w=>w.work_status!=='Работы сдали')]
        .map(w => `<option value="${w.id||''}">${esc(w.work_title||'Проект #'+w.id)}</option>`).join('');

      const html = `
        <div class="formrow">
          <div><label>Тип *</label>
            <select id="ti_type" class="field">${typeOptsHtml}</select>
          </div>
          <div><label>Сотрудник *</label>
            <select id="ti_emp" class="field">${empOptsHtml}</select>
          </div>
        </div>
        <div class="formrow">
          <div style="grid-column:1/-1"><label>Название / Маршрут *</label>
            <input id="ti_title" class="field" placeholder="Авиабилет Саратов-Москва / Гостиница Охотник / Направление на МО"/>
          </div>
        </div>
        <div class="formrow">
          <div style="grid-column:1/-1"><label>Описание (необязательно)</label>
            <input id="ti_desc" class="field" placeholder="Рейс SU-1234, № брони, инструктаж..."/>
          </div>
        </div>
        <div class="formrow">
          <div><label>Дата (с)</label><input type="date" id="ti_from" class="field" value="${today()}"/></div>
          <div><label>Дата (по)</label><input type="date" id="ti_to" class="field"/></div>
        </div>
        <div class="formrow">
          <div><label>Сумма (₽)</label><input type="number" id="ti_amount" class="field" placeholder="0"/></div>
          <div style="display:flex;align-items:center;gap:10px;padding-top:22px">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px">
              <input type="checkbox" id="ti_vat" style="width:16px;height:16px"/> С НДС
            </label>
          </div>
        </div>
        <div class="formrow">
          <div style="grid-column:1/-1"><label>Проект (привязать расход)</label>
            <select id="ti_work" class="field">${workOptsHtml}</select>
          </div>
        </div>
        <div class="formrow">
          <div style="grid-column:1/-1"><label>Файл (билет / ваучер / направление)</label>
            <input type="file" id="ti_file" class="field" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"/>
          </div>
        </div>
        <div class="help" style="margin-bottom:12px">
          💡 Если указан проект и сумма — расход автоматически добавится к расходам проекта.
        </div>
        <div style="display:flex;gap:10px">
          <button class="btn" id="btnSaveTi">Сохранить</button>
        </div>
      `;

      showModal('Новая запись', html);

      $('#btnSaveTi')?.addEventListener('click', async () => {
        const type    = $('#ti_type')?.value;
        const empId   = parseInt($('#ti_emp')?.value);
        const title   = $('#ti_title')?.value?.trim();
        const desc    = $('#ti_desc')?.value?.trim();
        const from    = $('#ti_from')?.value;
        const to      = $('#ti_to')?.value;
        const amount  = parseFloat($('#ti_amount')?.value) || 0;
        const vat     = $('#ti_vat')?.checked;
        const workId  = parseInt($('#ti_work')?.value) || null;
        const file    = $('#ti_file')?.files?.[0];

        if (!type || !empId || !title) {
          toast('Ошибка', 'Заполните тип, сотрудника и название', 'err');
          return;
        }

        const btn = $('#btnSaveTi');
        btn.textContent = 'Сохранение...';
        btn.disabled = true;

        try {
          const result = await apiPost('/', {
            item_type: type,
            employee_id: empId,
            title,
            description: desc || null,
            date_from: from || null,
            date_to:   to   || null,
            amount:    amount || null,
            vat_included: vat,
            work_id:   workId,
          });

          const logId = result.logistics_id;

          if (file && logId) {
            try {
              await uploadFile(logId, file);
              toast('Файл', 'Файл прикреплён');
            } catch(e) {
              toast('Файл', 'Запись создана, но файл не загружен: ' + e.message, 'warn');
            }
          }

          toast('Добавлено', 'Запись сохранена');
          const data = await apiGet('/');
          items = Array.isArray(data.logistics) ? data.logistics : [];
          // Определить вкладку для нового типа
          const tabForType = TAB_DEFS.find(t => t.types.includes(type));
          if (tabForType) activeTab = tabForType.id;
          // Закрыть модалку
          document.querySelector('.modal-backdrop')?.click();
          renderPage();
        } catch(e) {
          toast('Ошибка', e.message, 'err');
          btn.textContent = 'Сохранить';
          btn.disabled = false;
        }
      });
    }

    function openUploadModal(logId) {
      const html = `
        <div class="formrow">
          <div style="grid-column:1/-1"><label>Файл (билет, ваучер, направление)</label>
            <input type="file" id="uf_file" class="field" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"/>
          </div>
        </div>
        <button class="btn" id="btnUploadFile">Загрузить</button>
      `;
      showModal('Прикрепить файл', html);

      $('#btnUploadFile')?.addEventListener('click', async () => {
        const file = $('#uf_file')?.files?.[0];
        if (!file) { toast('Ошибка', 'Выберите файл', 'err'); return; }
        const btn = $('#btnUploadFile');
        btn.textContent = 'Загрузка...';
        btn.disabled = true;
        try {
          await uploadFile(logId, file);
          toast('Готово', 'Файл прикреплён');
          const data = await apiGet('/');
          items = Array.isArray(data.logistics) ? data.logistics : [];
          document.querySelector('.modal-backdrop')?.click();
          renderPage();
        } catch(e) {
          toast('Ошибка', e.message, 'err');
          btn.textContent = 'Загрузить';
          btn.disabled = false;
        }
      });
    }

    renderPage();
  }

  return { render };
})();
