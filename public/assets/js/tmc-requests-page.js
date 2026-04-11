// ASGARD CRM — Заявки на ТМЦ
window.AsgardTmcRequestsPage = (function() {
  let allItems = [], currentPage = 1, pageSize = window.AsgardPagination ? AsgardPagination.getPageSize() : 20;
  const { $, esc, toast, showModal, hideModal } = AsgardUI;

  const STATUS_MAP = {
    draft: { label: 'Черновик', color: 'var(--t2)' },
    submitted: { label: 'Подана', color: 'var(--info)' },
    approved: { label: 'Одобрена', color: 'var(--ok-t)' },
    rejected: { label: 'Отклонена', color: 'var(--err-t)' },
    ordered: { label: 'Заказано', color: 'var(--purple)' },
    delivered: { label: 'Доставлено', color: 'var(--cyan)' },
    closed: { label: 'Закрыта', color: 'var(--t2)' }
  };

  const PRIORITY_MAP = {
    low: { label: 'Низкий', color: 'var(--t2)' },
    normal: { label: 'Обычный', color: 'var(--info)' },
    high: { label: 'Высокий', color: 'var(--amber)' },
    urgent: { label: 'Срочный', color: 'var(--err-t)' }
  };

  async function render({ layout, title }) {
    await layout('<div id="tmc-page"><div class="loading">Загрузка...</div></div>', { title });
    await loadList();
  }

  async function loadList() {
    const el = $('#tmc-page');
    if (!el) return;
    try {
      const token = localStorage.getItem('asgard_token');
      const resp = await fetch('/api/tmc-requests', { headers: { Authorization: 'Bearer ' + token } });
      const data = await resp.json();
      const items = data.items;
      allItems = items;
      const pagedItems = window.AsgardPagination ? AsgardPagination.paginate(items, currentPage, pageSize) : items || [];

      el.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
          <h3 style="margin:0">Заявки на ТМЦ (${items.length})</h3>
          <div style="display:flex;gap:8px">
            <button class="btn" id="btnExportTmc">📥 Excel</button>
            <button class="btn primary" id="btnNewTmc">+ Новая заявка</button>
          </div>
        </div>
        <div class="tbl-wrap">
          <table class="data-table">
            <thead><tr>
              <th>№</th><th>Название</th><th>Проект</th><th>Сумма</th><th>Приоритет</th><th>Статус</th><th>Дата</th><th></th>
            </tr></thead>
            <tbody>${pagedItems.map(i => {
              const st = STATUS_MAP[i.status] || STATUS_MAP.draft;
              const pr = PRIORITY_MAP[i.priority] || PRIORITY_MAP.normal;
              return `<tr>
                <td>${i.id}</td>
                <td>${esc(i.title || '—')}</td>
                <td>${esc(i.work_title || '—')}</td>
                <td style="text-align:right">${i.total_sum ? Number(i.total_sum).toLocaleString('ru-RU') + ' ₽' : '—'}</td>
                <td><span style="color:${pr.color}">${pr.label}</span></td>
                <td><span style="color:${st.color};font-weight:600">${st.label}</span></td>
                <td>${i.created_at ? new Date(i.created_at).toLocaleDateString('ru-RU') : ''}</td>
                <td>
                  <button class="btn ghost mini" data-action="excel" data-id="${i.id}" title="Excel">📥</button>
                  <button class="btn ghost mini" data-action="edit" data-id="${i.id}" title="Открыть">✏️</button>
                </td>
              </tr>`;
      // Пагинация
      if (window.AsgardPagination) {
        let pgEl = document.getElementById("tmcreq_pagination");
        if (!pgEl) { pgEl = document.createElement("div"); pgEl.id = "tmcreq_pagination"; el.appendChild(pgEl); }
        pgEl.innerHTML = AsgardPagination.renderControls(items.length, currentPage, pageSize);
        AsgardPagination.attachHandlers("tmcreq_pagination",
          (p) => { currentPage = p; loadList(); },
          (s) => { pageSize = s; currentPage = 1; loadList(); }
        );
      }
            }).join('')}</tbody>
          </table>
        </div>`;

      $('#btnNewTmc')?.addEventListener('click', () => openForm());
      $('#btnExportTmc')?.addEventListener('click', () => {
        const token = localStorage.getItem('asgard_token');
        window.open(`/api/tmc-requests/export?token=${token}`, '_blank');
      });
      el.querySelectorAll('[data-action="excel"]').forEach(b => {
        b.addEventListener('click', () => {
          const token = localStorage.getItem('asgard_token');
          window.open(`/api/tmc-requests/${b.dataset.id}/excel?token=${token}`, '_blank');
        });
      });
      el.querySelectorAll('[data-action="edit"]').forEach(b => {
        b.addEventListener('click', () => openForm(b.dataset.id));
      });
    } catch (e) {
      el.innerHTML = `<div class="err">Ошибка: ${esc(e.message)}</div>`;
    }
  }

  async function openForm(id) {
    let item = {};
    if (id) {
      const token = localStorage.getItem('asgard_token');
      const resp = await fetch(`/api/tmc-requests/${id}`, { headers: { Authorization: 'Bearer ' + token } });
      const data = await resp.json();
      item = data.item || {};
    }

    const items = Array.isArray(item.items_json) ? item.items_json : [];
    const itemsText = items.map(i => `${i.name || ''}|${i.unit || 'шт.'}|${i.quantity || 0}|${i.price || 0}`).join('\n');

    const html = `
      <div class="formrow"><div style="grid-column:1/-1">
        <label>Название заявки</label>
        <input id="tmcTitle" value="${esc(item.title || '')}" placeholder="Заявка на материалы для..." />
      </div></div>
      <div class="formrow">
        <div><label>Приоритет</label>
          <div id="crw_tmcPriority"></div>
        </div>
        <div><label>Нужно к дате</label><input id="tmcNeeded" type="date" value="${(item.needed_by || '').slice(0,10)}" /></div>
      </div>
      <div class="formrow">
        <div><label>Поставщик</label><input id="tmcSupplier" value="${esc(item.supplier || '')}" /></div>
        <div><label>Адрес доставки</label><input id="tmcAddr" value="${esc(item.delivery_address || '')}" /></div>
      </div>
      <div class="formrow"><div style="grid-column:1/-1">
        <label>Позиции (наименование|ед.|кол-во|цена, по одной на строку)</label>
        <textarea id="tmcItems" rows="6" placeholder="Труба 89x6|м.п.|100|1500&#10;Электрод ОК 46.00|кг|50|800">${esc(itemsText)}</textarea>
      </div></div>
      <div class="formrow"><div style="grid-column:1/-1">
        <label>Примечания</label><textarea id="tmcNotes" rows="2">${esc(item.notes || '')}</textarea>
      </div></div>
      <hr class="hr"/>
      <div style="display:flex;gap:10px">
        <button class="btn primary" id="btnSaveTmc" style="flex:1">${id ? '💾 Сохранить' : '➕ Создать'}</button>
        ${id && ['draft','submitted'].includes(item.status) ? '<button class="btn" id="btnSubmitTmc">📨 Подать</button>' : ''}
      </div>`;

    showModal(id ? `Заявка ТМЦ #${id}` : 'Новая заявка на ТМЦ', html);

    const tmcPriorityVal = item.priority || 'normal';
    $('#crw_tmcPriority')?.appendChild(CRSelect.create({
      id: 'tmcPriority', fullWidth: true, dropdownClass: 'z-modal',
      options: [
        { value: 'low', label: 'Низкий' },
        { value: 'normal', label: 'Обычный' },
        { value: 'high', label: 'Высокий' },
        { value: 'urgent', label: 'Срочный' }
      ],
      value: tmcPriorityVal
    }));

    $('#btnSaveTmc')?.addEventListener('click', async () => {
      const lines = ($('#tmcItems')?.value || '').split('\n').filter(s => s.trim());
      const parsedItems = lines.map(line => {
        const parts = line.split('|');
        const qty = parseFloat(parts[2]) || 0;
        const price = parseFloat(parts[3]) || 0;
        return { name: (parts[0] || '').trim(), unit: (parts[1] || 'шт.').trim(), quantity: qty, price: price, total: qty * price };
      });
      const totalSum = parsedItems.reduce((s, i) => s + (i.total || 0), 0);

      const body = {
        title: $('#tmcTitle')?.value,
        priority: CRSelect.getValue('tmcPriority'),
        needed_by: $('#tmcNeeded')?.value || null,
        supplier: $('#tmcSupplier')?.value,
        delivery_address: $('#tmcAddr')?.value,
        items_json: parsedItems,
        total_sum: totalSum,
        notes: $('#tmcNotes')?.value
      };
      const token = localStorage.getItem('asgard_token');
      const url = id ? `/api/tmc-requests/${id}` : '/api/tmc-requests';
      const method = id ? 'PUT' : 'POST';
      const resp = await fetch(url, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
      if (resp.ok) { toast('Готово', id ? 'Заявка обновлена' : 'Заявка создана'); hideModal(); loadList(); }
      else { const err = await resp.json(); toast('Ошибка', err.error || 'Ошибка', 'err'); }
    });

    $('#btnSubmitTmc')?.addEventListener('click', async () => {
      const token = localStorage.getItem('asgard_token');
      const resp = await fetch(`/api/tmc-requests/${id}/status`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ status: 'submitted' }) });
      if (resp.ok) { toast('Готово', 'Заявка подана'); hideModal(); loadList(); }
      else { const err = await resp.json(); toast('Ошибка', err.error || 'Ошибка', 'err'); }
    });
  }

  return { render };
})();
