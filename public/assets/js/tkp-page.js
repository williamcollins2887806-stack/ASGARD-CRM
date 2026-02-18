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

  // Типы ТКП
  const TKP_TYPES = {
    to: 'ТО (техническое обслуживание)',
    rp: 'РП (ремонтные работы)'
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
        <div class="tbl-wrap">
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
                  <button class="btn ghost mini" data-action="send" data-id="${i.id}" title="Отправить ТКП по email">📨</button>
                  <button class="btn ghost mini" data-action="pdf" data-id="${i.id}" title="PDF">📄</button>
                  <button class="btn ghost mini" data-action="edit" data-id="${i.id}" title="Редактировать">✏️</button>
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
      el.querySelectorAll('[data-action="send"]').forEach(b => {
        b.addEventListener('click', () => openSendTkpModal(b.dataset.id));
      });
    } catch (e) {
      el.innerHTML = `<div class="err">Ошибка загрузки: ${esc(e.message)}</div>`;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Отправка ТКП по email — через модальное окно с шаблоном
  // ═══════════════════════════════════════════════════════════════
  async function openSendTkpModal(id) {
    const token = localStorage.getItem('asgard_token');
    let tkp = {};
    try {
      const resp = await fetch(`/api/tkp/${id}`, { headers: { Authorization: 'Bearer ' + token } });
      const data = await resp.json();
      tkp = data.item || {};
    } catch (e) {
      toast('Ошибка', 'Не удалось загрузить ТКП', 'err');
      return;
    }

    const customerEmail = tkp.contact_email || tkp.customer_email || '';
    const customerName = tkp.customer_name || tkp.tender_customer || '';
    const tkpTitle = tkp.subject || tkp.title || '';
    const totalSum = tkp.total_sum ? Number(tkp.total_sum).toLocaleString('ru-RU') + ' руб.' : 'по запросу';
    const validityDays = tkp.validity_days || 30;
    const services = tkp.services || '';
    const tkpType = tkp.tkp_type || 'to';
    const deadline = tkp.deadline || '';

    // Формируем тело письма
    const emailBody = buildTkpEmailBody({ tkp, customerName, tkpTitle, totalSum, validityDays, services, tkpType, deadline });
    const emailSubject = `Коммерческое предложение: ${tkpTitle}`;

    // Пробуем открыть через AsgardEmailCompose (полноценное модальное окно)
    if (window.AsgardEmailCompose) {
      // Закрываем текущее модальное окно (если открыто из формы редактирования)
      try { hideModal(); } catch(_) {}

      AsgardEmailCompose.open({
        mode: 'compose',
        email: {
          to_prefill: customerEmail,
          subject_prefill: emailSubject,
          body_prefill: emailBody,
          tkp_id: id
        }
      });

      // После открытия — заполняем поля (AsgardEmailCompose рендерит асинхронно)
      setTimeout(() => {
        const toInput = document.getElementById('compose-to');
        const subjectInput = document.getElementById('compose-subject');
        const bodyInput = document.getElementById('compose-body');
        if (toInput && !toInput.value) toInput.value = customerEmail;
        if (subjectInput && !subjectInput.value) subjectInput.value = emailSubject;
        if (bodyInput && !bodyInput.value) bodyInput.value = emailBody;
      }, 300);

      return;
    }

    // Fallback: AsgardEmail.openEmailModal (упрощённый модальный)
    if (window.AsgardEmail && AsgardEmail.openEmailModal) {
      try { hideModal(); } catch(_) {}

      AsgardEmail.openEmailModal({
        to: customerEmail,
        templateType: 'tkp',
        data: {
          tkp_title: tkpTitle,
          total_sum: totalSum,
          validity_days: validityDays,
          customer_name: customerName,
          services: services,
          deadline: deadline
        },
        attachments: [{ name: `TKP_${id}.pdf`, url: `/api/tkp/${id}/pdf?token=${token}` }],
        entityType: 'tkp',
        entityId: id
      });

      return;
    }

    // Крайний fallback: прямая отправка через API (как было раньше)
    if (!customerEmail) {
      toast('Ошибка', 'Укажите email заказчика в карточке ТКП', 'err');
      return;
    }
    const resp = await fetch(`/api/tkp/${id}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ email: customerEmail })
    });
    if (resp.ok) {
      toast('Готово', `ТКП отправлено на ${customerEmail}`);
      loadList();
    } else {
      const err = await resp.json();
      toast('Ошибка', err.error || 'Не удалось отправить', 'err');
    }
  }

  // Генерация тела письма для ТКП
  function buildTkpEmailBody(opts) {
    const { customerName, tkpTitle, totalSum, validityDays, services, tkpType, deadline } = opts;
    const typeLabel = tkpType === 'rp' ? 'ремонтных работ' : 'технического обслуживания';

    let body = `Добрый день!

Направляем Вам коммерческое предложение на выполнение ${typeLabel}.

Наименование: ${tkpTitle}`;

    if (customerName) {
      body += `\nЗаказчик: ${customerName}`;
    }

    body += `\nСумма: ${totalSum}`;

    if (deadline) {
      body += `\nСрок выполнения: ${deadline}`;
    }

    body += `\nСрок действия предложения: ${validityDays} дней`;

    if (services) {
      body += `\n\nПеречень услуг:\n${services}`;
    }

    body += `\n\nДетали предложения во вложении (PDF).

С уважением,
ООО «Асгард Сервис»
Тел: +7 (XXX) XXX-XX-XX
Email: info@asgard-service.ru`;

    return body;
  }

  async function openForm(id) {
    let item = {};
    if (id) {
      const token = localStorage.getItem('asgard_token');
      const resp = await fetch(`/api/tkp/${id}`, { headers: { Authorization: 'Bearer ' + token } });
      const data = await resp.json();
      item = data.item || {};
    }

    const tkpTypeVal = item.tkp_type || 'to';

    const html = `
      <div class="formrow"><div style="grid-column:1/-1">
        <label>Название</label>
        <input id="tkpTitle" value="${esc(item.title || item.subject || '')}" placeholder="Название ТКП" />
      </div></div>
      <div class="formrow">
        <div><label>Заказчик</label><input id="tkpCustomer" value="${esc(item.customer_name || '')}" /></div>
        <div><label>Email заказчика</label><input id="tkpEmail" value="${esc(item.contact_email || item.customer_email || '')}" type="email" /></div>
      </div>
      <div class="formrow">
        <div><label>Тип ТКП</label>
          <select id="tkpType">
            <option value="to" ${tkpTypeVal === 'to' ? 'selected' : ''}>ТО (техническое обслуживание)</option>
            <option value="rp" ${tkpTypeVal === 'rp' ? 'selected' : ''}>РП (ремонтные работы)</option>
          </select>
        </div>
        <div><label>Сумма, ₽</label><input id="tkpSum" type="number" value="${item.total_sum || ''}" /></div>
      </div>
      <div class="formrow">
        <div><label>Срок выполнения</label><input id="tkpDeadline" value="${esc(item.deadline || '')}" /></div>
        <div><label>Действие, дней</label><input id="tkpValidity" type="number" value="${item.validity_days || 30}" /></div>
      </div>
      <div class="formrow"><div style="grid-column:1/-1">
        <label>Перечень услуг</label>
        <textarea id="tkpServices" rows="4">${esc(item.services || '')}</textarea>
      </div></div>
      <hr class="hr"/>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn primary" id="btnSaveTkp" style="flex:1">${id ? 'Сохранить' : 'Создать'}</button>
        ${id ? '<button class="btn" id="btnSendTkpEmail" title="Отправить ТКП по email с возможностью редактирования письма">📨 Отправить ТКП</button>' : ''}
        ${id ? '<button class="btn ghost" id="btnSendTkpDirect" title="Быстрая отправка на email заказчика">Быстрая отправка</button>' : ''}
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
        services: $('#tkpServices')?.value,
        tkp_type: $('#tkpType')?.value || 'to'
      };
      const token = localStorage.getItem('asgard_token');
      const url = id ? `/api/tkp/${id}` : '/api/tkp';
      const method = id ? 'PUT' : 'POST';
      const resp = await fetch(url, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
      if (resp.ok) { toast('Готово', id ? 'ТКП обновлено' : 'ТКП создано'); hideModal(); loadList(); }
      else { const err = await resp.json(); toast('Ошибка', err.error || 'Не удалось сохранить', 'err'); }
    });

    // Отправить ТКП — открывает модальное окно email compose
    $('#btnSendTkpEmail')?.addEventListener('click', () => {
      openSendTkpModal(id);
    });

    // Быстрая отправка (как раньше — без модального окна)
    $('#btnSendTkpDirect')?.addEventListener('click', async () => {
      const email = $('#tkpEmail')?.value;
      if (!email) { toast('Ошибка', 'Укажите email заказчика', 'err'); return; }
      const token = localStorage.getItem('asgard_token');
      const resp = await fetch(`/api/tkp/${id}/send`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ email }) });
      if (resp.ok) { toast('Готово', `ТКП отправлено на ${email}`); hideModal(); loadList(); }
      else { const err = await resp.json(); toast('Ошибка', err.error || 'Не удалось отправить', 'err'); }
    });
  }

  return { render, openSendTkpModal };
})();
