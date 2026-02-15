// ASGARD CRM — ТКП (Техническо-коммерческое предложение)
window.AsgardTkpPage = (function() {
  const { $, esc, toast, showModal, hideModal } = AsgardUI;

  const STATUS_MAP = {
    draft: { label: 'Черновик', color: '#64748b' },
    sent: { label: 'Отправлено', color: '#3b82f6' },
    accepted: { label: 'Принято', color: '#22c55e' },
    rejected: { label: 'Отклонено', color: '#ef4444' },
    expired: { label: 'Просрочено', color: '#f59e0b' }
  };

  async function render({ layout, title }) {
    await layout('<div id="tkp-page"><div class="loading">Загрузка...</div></div>', { title });
    await loadList();
  }

  async function loadList() {
    const el = $('#tkp-page');
    if (!el) return;
    try {
      const token = localStorage.getItem('asgard_token');
      const resp = await fetch('/api/tkp', { headers: { Authorization: 'Bearer ' + token } });
      const data = await resp.json();
      const items = data.items || [];

      el.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h3 style="margin:0">ТКП (${items.length})</h3>
          <button class="btn primary" id="btnNewTkp">+ Создать ТКП</button>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr>
              <th>№</th><th>Название</th><th>Заказчик</th><th>Сумма</th><th>Статус</th><th>Дата</th><th></th>
            </tr></thead>
            <tbody>${items.map(i => {
              const st = STATUS_MAP[i.status] || STATUS_MAP.draft;
              return `<tr>
                <td>${i.id}</td>
                <td>${esc(i.title || '')}</td>
                <td>${esc(i.customer_name || i.tender_customer || '—')}</td>
                <td style="text-align:right">${i.total_sum ? Number(i.total_sum).toLocaleString('ru-RU') + ' ₽' : '—'}</td>
                <td><span style="color:${st.color};font-weight:600">${st.label}</span></td>
                <td>${i.created_at ? new Date(i.created_at).toLocaleDateString('ru-RU') : ''}</td>
                <td>
                  <button class="btn ghost btn-sm" data-action="pdf" data-id="${i.id}" title="PDF">📄</button>
                  <button class="btn ghost btn-sm" data-action="edit" data-id="${i.id}" title="Редактировать">✏️</button>
                </td>
              </tr>`;
            }).join('')}</tbody>
          </table>
        </div>`;

      $('#btnNewTkp')?.addEventListener('click', () => openForm());
      el.querySelectorAll('[data-action="pdf"]').forEach(b => {
        b.addEventListener('click', () => {
          const token = localStorage.getItem('asgard_token');
          window.open(`/api/tkp/${b.dataset.id}/pdf?token=${token}`, '_blank');
        });
      });
      el.querySelectorAll('[data-action="edit"]').forEach(b => {
        b.addEventListener('click', () => openForm(b.dataset.id));
      });
    } catch (e) {
      el.innerHTML = `<div class="err">Ошибка загрузки: ${esc(e.message)}</div>`;
    }
  }

  async function openForm(id) {
    let item = {};
    if (id) {
      const token = localStorage.getItem('asgard_token');
      const resp = await fetch(`/api/tkp/${id}`, { headers: { Authorization: 'Bearer ' + token } });
      const data = await resp.json();
      item = data.item || {};
    }

    const html = `
      <div class="formrow"><div style="grid-column:1/-1">
        <label>Название</label>
        <input id="tkpTitle" value="${esc(item.title || '')}" placeholder="Название ТКП" />
      </div></div>
      <div class="formrow">
        <div><label>Заказчик</label><input id="tkpCustomer" value="${esc(item.customer_name || '')}" /></div>
        <div><label>Email заказчика</label><input id="tkpEmail" value="${esc(item.customer_email || '')}" type="email" /></div>
      </div>
      <div class="formrow">
        <div><label>Сумма, ₽</label><input id="tkpSum" type="number" value="${item.total_sum || ''}" /></div>
        <div><label>Срок выполнения</label><input id="tkpDeadline" value="${esc(item.deadline || '')}" /></div>
        <div><label>Действие, дней</label><input id="tkpValidity" type="number" value="${item.validity_days || 30}" /></div>
      </div>
      <div class="formrow"><div style="grid-column:1/-1">
        <label>Перечень услуг</label>
        <textarea id="tkpServices" rows="4">${esc(item.services || '')}</textarea>
      </div></div>
      <hr class="hr"/>
      <div style="display:flex;gap:10px">
        <button class="btn primary" id="btnSaveTkp" style="flex:1">${id ? '💾 Сохранить' : '➕ Создать'}</button>
        ${id ? '<button class="btn" id="btnSendTkp">📨 Отправить</button>' : ''}
      </div>`;

    showModal(id ? `ТКП #${id}` : 'Новое ТКП', html);

    $('#btnSaveTkp')?.addEventListener('click', async () => {
      const body = {
        title: $('#tkpTitle')?.value,
        customer_name: $('#tkpCustomer')?.value,
        customer_email: $('#tkpEmail')?.value,
        total_sum: parseFloat($('#tkpSum')?.value) || 0,
        deadline: $('#tkpDeadline')?.value,
        validity_days: parseInt($('#tkpValidity')?.value) || 30,
        services: $('#tkpServices')?.value
      };
      const token = localStorage.getItem('asgard_token');
      const url = id ? `/api/tkp/${id}` : '/api/tkp';
      const method = id ? 'PUT' : 'POST';
      const resp = await fetch(url, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
      if (resp.ok) { toast('Готово', id ? 'ТКП обновлено' : 'ТКП создано'); hideModal(); loadList(); }
      else { const err = await resp.json(); toast('Ошибка', err.error || 'Не удалось сохранить', 'err'); }
    });

    $('#btnSendTkp')?.addEventListener('click', async () => {
      const email = $('#tkpEmail')?.value;
      if (!email) { toast('Ошибка', 'Укажите email заказчика', 'err'); return; }
      const token = localStorage.getItem('asgard_token');
      const resp = await fetch(`/api/tkp/${id}/send`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ email }) });
      if (resp.ok) { toast('Готово', `ТКП отправлено на ${email}`); hideModal(); loadList(); }
      else { const err = await resp.json(); toast('Ошибка', err.error || 'Не удалось отправить', 'err'); }
    });
  }

  return { render };
})();
