/**
 * AsgardSiteInspection — Модуль «Осмотр объекта»
 * ═══════════════════════════════════════════════════════════
 * Workflow: Заявка → Отправка → Одобрение → Командировка → Авансы
 *
 * Интеграция:
 *   - Вызывается из popup-grid меню работы (pm_works.js)
 *   - Использует AsgardEmployeePicker для выбора сотрудников
 *   - Использует AsgardEmail для предпросмотра/отправки email
 *   - Создаёт cash_request при необходимости аванса
 *   - Уведомляет OFFICE_MANAGER при необходимости билетов/карты
 */
window.AsgardSiteInspection = (function () {
  'use strict';

  const { $, $$, esc, toast, showModal, hideModal } = AsgardUI;

  // Helpers
  function isoNow() { return new Date().toISOString(); }
  function today() { return new Date().toISOString().slice(0, 10); }

  const TRANSPORT_TYPES = [
    { id: 'auto', label: 'Автомобиль', icon: '🚗' },
    { id: 'rail', label: 'Ж/Д', icon: '🚂' },
    { id: 'air',  label: 'Авиа', icon: '✈️' },
    { id: 'mixed', label: 'Комбинированный', icon: '🔄' }
  ];

  const STATUS_LABELS = {
    draft: 'Черновик', sent: 'Отправлена', approved: 'Одобрена',
    rejected: 'Отклонена', trip_planned: 'Командировка', trip_sent: 'Командировка отправлена',
    completed: 'Завершена'
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. Открыть модалку создания/редактирования заявки на осмотр
  // ═══════════════════════════════════════════════════════════════════════════
  async function openInspectionModal(work, user, existingId) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) return;
    user = user || auth.user;

    // Load existing inspection if editing
    let si = null;
    if (existingId) {
      try {
        const resp = await fetch(`/api/site-inspections/${existingId}`, {
          headers: { 'Authorization': 'Bearer ' + (await AsgardAuth.getToken()) }
        });
        const data = await resp.json();
        si = data.data;
      } catch (_) {}
    }

    // Auto-fill from work
    const tender = work?.tender_id ? await AsgardDB.get('tenders', work.tender_id) : null;

    // State
    let dates = si ? (typeof si.inspection_dates === 'string' ? JSON.parse(si.inspection_dates) : si.inspection_dates) || [] : [];
    let employees = si ? (typeof si.employees_json === 'string' ? JSON.parse(si.employees_json) : si.employees_json) || [] : [];
    let vehicles = si ? (typeof si.vehicles_json === 'string' ? JSON.parse(si.vehicles_json) : si.vehicles_json) || [] : [];

    // Auto-add PM to employees if new
    if (!si && user) {
      const emp = await findEmployeeByUserId(user.id);
      if (emp) {
        employees.push({
          employee_id: emp.id,
          fio: emp.fio || user.name || '',
          position: emp.position || user.role || 'РП',
          passport_series: emp.passport_series || '',
          passport_number: emp.passport_number || '',
          phone: emp.phone || ''
        });
      }
    }

    // Auto-add one empty vehicle if new
    if (!si && !vehicles.length) {
      vehicles.push({ brand: '', model: '', plate_number: '', driver_fio: '' });
    }

    function renderDates() {
      return dates.map((d, i) => `
        <div class="formrow" style="grid-template-columns:1fr 1fr 1fr auto; align-items:end">
          <div><label>Дата ${i + 1}</label><input class="si-date" data-i="${i}" type="date" value="${esc(d.date || '')}"/></div>
          <div><label>С</label><input class="si-tf" data-i="${i}" type="time" value="${esc(d.time_from || '09:00')}"/></div>
          <div><label>До</label><input class="si-tt" data-i="${i}" type="time" value="${esc(d.time_to || '18:00')}"/></div>
          <div><button class="btn ghost" data-del-date="${i}" style="padding:8px" title="Удалить">✕</button></div>
        </div>
      `).join('');
    }

    function renderEmployees() {
      return employees.map((e, i) => `
        <div class="pill" style="gap:8px; flex-wrap:wrap; padding:10px; border:1px solid var(--brd); border-radius:8px; margin-bottom:6px">
          <div style="flex:1;min-width:200px"><b>${esc(e.fio || '—')}</b> <span style="color:var(--t3)">${esc(e.position || '')}</span></div>
          <div style="color:var(--t3); font-size:12px">
            ${e.passport_series ? 'Паспорт: ' + esc(e.passport_series) + ' ' + esc(e.passport_number || '') : 'Паспорт не указан'}
            ${e.phone ? ' | Тел: ' + esc(e.phone) : ''}
          </div>
          <button class="btn ghost" data-del-emp="${i}" style="padding:4px 8px" title="Убрать">✕</button>
        </div>
      `).join('');
    }

    function renderVehicles() {
      return vehicles.map((v, i) => `
        <div class="formrow" style="grid-template-columns:1fr 1fr 1fr 1fr auto; align-items:end">
          <div><label>Марка</label><input class="si-vbrand" data-i="${i}" value="${esc(v.brand || '')}"/></div>
          <div><label>Модель</label><input class="si-vmodel" data-i="${i}" value="${esc(v.model || '')}"/></div>
          <div><label>Гос. номер</label><input class="si-vplate" data-i="${i}" value="${esc(v.plate_number || '')}"/></div>
          <div><label>Водитель</label><input class="si-vdriver" data-i="${i}" value="${esc(v.driver_fio || '')}"/></div>
          <div><button class="btn ghost" data-del-veh="${i}" style="padding:8px" title="Удалить">✕</button></div>
        </div>
      `).join('');
    }

    function buildHtml() {
      return `
        <div class="help" style="margin-bottom:12px">
          ${si ? `<b>Заявка #${si.id}</b> — ${esc(STATUS_LABELS[si.status] || si.status)}` : '<b>Новая заявка на осмотр объекта</b>'}
        </div>

        <div class="formrow">
          <div style="grid-column:1/-1"><label>Объект *</label><input id="si_obj" value="${esc(si?.object_name || work?.work_title || tender?.tender_title || '')}" placeholder="Название объекта"/></div>
          <div style="grid-column:1/-1"><label>Адрес объекта</label><input id="si_addr" value="${esc(si?.object_address || tender?.object_address || '')}" placeholder="Полный адрес"/></div>
        </div>

        <div class="formrow">
          <div><label>Заказчик</label><input id="si_cust" value="${esc(si?.customer_name || work?.customer_name || tender?.customer_name || '')}" placeholder="Наименование заказчика"/></div>
          <div><label>Контактное лицо</label><input id="si_cp" value="${esc(si?.customer_contact_person || '')}" placeholder="ФИО контакта"/></div>
          <div><label>Email контакта</label><input id="si_email" value="${esc(si?.customer_contact_email || '')}" placeholder="email@example.com" type="email"/></div>
          <div><label>Телефон контакта</label><input id="si_phone" value="${esc(si?.customer_contact_phone || '')}" placeholder="+7..." type="tel"/></div>
        </div>

        <hr class="hr"/>
        <div class="help"><b>Возможные даты осмотра</b></div>
        <div id="si_dates_wrap">${renderDates()}</div>
        <button class="btn ghost" id="btnAddDate" style="margin-top:6px">+ Добавить дату</button>

        <hr class="hr"/>
        <div class="help"><b>Сотрудники на осмотр</b></div>
        <div id="si_emp_wrap">${renderEmployees()}</div>
        <button class="btn ghost" id="btnAddEmp" style="margin-top:6px">+ Добавить сотрудника</button>

        <hr class="hr"/>
        <div class="help"><b>Транспорт (данные на пропуск)</b></div>
        <div id="si_veh_wrap">${renderVehicles()}</div>
        <button class="btn ghost" id="btnAddVeh" style="margin-top:6px">+ Добавить авто</button>

        <hr class="hr"/>
        <div class="formrow">
          <div style="grid-column:1/-1"><label>Примечания</label><textarea id="si_notes" rows="3" placeholder="Дополнительная информация">${esc(si?.notes || '')}</textarea></div>
        </div>

        <hr class="hr"/>
        <div style="display:flex; gap:10px; flex-wrap:wrap">
          <button class="btn" id="btnSiSave">Сохранить черновик</button>
          <button class="btn ghost" id="btnSiPdf">📄 Скачать PDF</button>
          <button class="btn ghost" id="btnSiEmail">📨 Отправить по email</button>
        </div>
      `;
    }

    showModal(si ? `Заявка на осмотр #${si.id}` : 'Осмотр объекта', buildHtml());

    // ─── Collect form data ───────────────────────────────────────────────
    function collectData() {
      // Sync dates from DOM
      document.querySelectorAll('.si-date').forEach(inp => {
        const i = parseInt(inp.dataset.i);
        if (dates[i]) dates[i].date = inp.value;
      });
      document.querySelectorAll('.si-tf').forEach(inp => {
        const i = parseInt(inp.dataset.i);
        if (dates[i]) dates[i].time_from = inp.value;
      });
      document.querySelectorAll('.si-tt').forEach(inp => {
        const i = parseInt(inp.dataset.i);
        if (dates[i]) dates[i].time_to = inp.value;
      });

      // Sync vehicles from DOM
      document.querySelectorAll('.si-vbrand').forEach(inp => {
        const i = parseInt(inp.dataset.i);
        if (vehicles[i]) vehicles[i].brand = inp.value;
      });
      document.querySelectorAll('.si-vmodel').forEach(inp => {
        const i = parseInt(inp.dataset.i);
        if (vehicles[i]) vehicles[i].model = inp.value;
      });
      document.querySelectorAll('.si-vplate').forEach(inp => {
        const i = parseInt(inp.dataset.i);
        if (vehicles[i]) vehicles[i].plate_number = inp.value;
      });
      document.querySelectorAll('.si-vdriver').forEach(inp => {
        const i = parseInt(inp.dataset.i);
        if (vehicles[i]) vehicles[i].driver_fio = inp.value;
      });

      return {
        work_id: work?.id || si?.work_id || null,
        estimate_id: si?.estimate_id || null,
        tender_id: work?.tender_id || si?.tender_id || null,
        object_name: ($('#si_obj')?.value || '').trim(),
        object_address: ($('#si_addr')?.value || '').trim(),
        customer_name: ($('#si_cust')?.value || '').trim(),
        customer_contact_person: ($('#si_cp')?.value || '').trim(),
        customer_contact_email: ($('#si_email')?.value || '').trim(),
        customer_contact_phone: ($('#si_phone')?.value || '').trim(),
        inspection_dates: dates.filter(d => d.date),
        employees_json: employees,
        vehicles_json: vehicles.filter(v => v.brand || v.plate_number),
        notes: ($('#si_notes')?.value || '').trim()
      };
    }

    async function saveInspection(silent) {
      const data = collectData();
      if (!data.object_name) { toast('Осмотр', 'Укажите название объекта', 'err'); return null; }

      const token = await AsgardAuth.getToken();
      const method = si ? 'PUT' : 'POST';
      const url = si ? `/api/site-inspections/${si.id}` : '/api/site-inspections';

      try {
        const resp = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify(data)
        });
        if (!resp.ok) {
          const err = await resp.json();
          throw new Error(err.error || 'Ошибка сохранения');
        }
        const result = await resp.json();
        si = result.data;
        if (!silent) toast('Осмотр', si ? 'Заявка обновлена' : 'Заявка создана');
        return si;
      } catch (e) {
        toast('Ошибка', e.message, 'err');
        return null;
      }
    }

    // ─── Event Handlers ──────────────────────────────────────────────────

    // Add date
    const btnAddDate = document.getElementById('btnAddDate');
    if (btnAddDate) btnAddDate.addEventListener('click', () => {
      dates.push({ date: '', time_from: '09:00', time_to: '18:00' });
      document.getElementById('si_dates_wrap').innerHTML = renderDates();
      attachDeleteHandlers();
    });

    // Add employee via picker
    const btnAddEmp = document.getElementById('btnAddEmp');
    if (btnAddEmp) btnAddEmp.addEventListener('click', async () => {
      if (!window.AsgardEmployeePicker) { toast('Ошибка', 'Модуль выбора сотрудников не загружен', 'err'); return; }
      const picked = await AsgardEmployeePicker.pickOne({
        filter: e => !employees.some(ex => ex.employee_id === e.id)
      });
      if (picked) {
        employees.push({
          employee_id: picked.id,
          fio: picked.fio || '',
          position: picked.position || picked.role_tag || '',
          passport_series: picked.passport_series || '',
          passport_number: picked.passport_number || '',
          phone: picked.phone || ''
        });
        document.getElementById('si_emp_wrap').innerHTML = renderEmployees();
        attachDeleteHandlers();
      }
    });

    // Add vehicle
    const btnAddVeh = document.getElementById('btnAddVeh');
    if (btnAddVeh) btnAddVeh.addEventListener('click', () => {
      vehicles.push({ brand: '', model: '', plate_number: '', driver_fio: '' });
      document.getElementById('si_veh_wrap').innerHTML = renderVehicles();
      attachDeleteHandlers();
    });

    // Save
    const btnSave = document.getElementById('btnSiSave');
    if (btnSave) btnSave.addEventListener('click', () => saveInspection());

    // Download PDF
    const btnPdf = document.getElementById('btnSiPdf');
    if (btnPdf) btnPdf.addEventListener('click', async () => {
      const saved = await saveInspection(true);
      if (!saved) return;
      window.open(`/api/site-inspections/${saved.id}/pdf`, '_blank');
      // Prompt to change status
      promptStatusChange(saved, work);
    });

    // Send email
    const btnEmail = document.getElementById('btnSiEmail');
    if (btnEmail) btnEmail.addEventListener('click', async () => {
      const saved = await saveInspection(true);
      if (!saved) return;
      openEmailPreview(saved, work, user);
    });

    function attachDeleteHandlers() {
      document.querySelectorAll('[data-del-date]').forEach(btn => {
        btn.addEventListener('click', () => {
          dates.splice(parseInt(btn.dataset.delDate), 1);
          document.getElementById('si_dates_wrap').innerHTML = renderDates();
          attachDeleteHandlers();
        });
      });
      document.querySelectorAll('[data-del-emp]').forEach(btn => {
        btn.addEventListener('click', () => {
          employees.splice(parseInt(btn.dataset.delEmp), 1);
          document.getElementById('si_emp_wrap').innerHTML = renderEmployees();
          attachDeleteHandlers();
        });
      });
      document.querySelectorAll('[data-del-veh]').forEach(btn => {
        btn.addEventListener('click', () => {
          collectData(); // sync vehicle inputs before delete
          vehicles.splice(parseInt(btn.dataset.delVeh), 1);
          document.getElementById('si_veh_wrap').innerHTML = renderVehicles();
          attachDeleteHandlers();
        });
      });
    }

    attachDeleteHandlers();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. Предпросмотр email перед отправкой
  // ═══════════════════════════════════════════════════════════════════════════
  async function openEmailPreview(si, work, user) {
    const dates = (typeof si.inspection_dates === 'string' ? JSON.parse(si.inspection_dates) : si.inspection_dates) || [];
    const employees = (typeof si.employees_json === 'string' ? JSON.parse(si.employees_json) : si.employees_json) || [];
    const vehicles = (typeof si.vehicles_json === 'string' ? JSON.parse(si.vehicles_json) : si.vehicles_json) || [];

    // Build default email body
    let body = `Уважаемый(ая) ${si.customer_contact_person || 'коллега'},\n\n`;
    body += `Направляем заявку на осмотр объекта: ${si.object_name}\n`;
    if (si.object_address) body += `Адрес: ${si.object_address}\n`;
    body += '\n';

    if (dates.length) {
      body += 'Возможные даты осмотра:\n';
      dates.forEach((d, i) => { body += `  ${i + 1}. ${d.date || '—'} с ${d.time_from || '—'} до ${d.time_to || '—'}\n`; });
      body += '\n';
    }

    if (employees.length) {
      body += 'Данные сотрудников:\n';
      employees.forEach((e, i) => {
        const passport = (e.passport_series && e.passport_number) ? `, паспорт: ${e.passport_series} ${e.passport_number}` : '';
        body += `  ${i + 1}. ${e.fio}${e.position ? ', ' + e.position : ''}${passport}${e.phone ? ', тел: ' + e.phone : ''}\n`;
      });
      body += '\n';
    }

    if (vehicles.length) {
      body += 'Транспорт:\n';
      vehicles.forEach((v, i) => {
        if (v.brand || v.plate_number) body += `  ${i + 1}. ${v.brand || ''} ${v.model || ''}, гос. номер: ${v.plate_number || '—'}${v.driver_fio ? ', водитель: ' + v.driver_fio : ''}\n`;
      });
      body += '\n';
    }

    body += 'С уважением,\nООО «АСГАРД-СЕРВИС»';

    const html = `
      <div class="formrow">
        <div><label>Кому (Email)</label><input id="ep_to" value="${esc(si.customer_contact_email || '')}" placeholder="email@example.com"/></div>
        <div><label>Тема</label><input id="ep_subj" value="${esc('Заявка на осмотр объекта: ' + (si.object_name || ''))}"/></div>
      </div>
      <div class="formrow">
        <div style="grid-column:1/-1"><label>Текст письма</label><textarea id="ep_body" rows="16" style="font-family:var(--mono); font-size:12px; white-space:pre-wrap">${esc(body)}</textarea></div>
      </div>
      <div class="help" style="margin:8px 0">PDF заявки будет автоматически приложен к письму.</div>
      <div style="display:flex; gap:10px; flex-wrap:wrap">
        <button class="btn" id="btnEpSend">📨 Отправить</button>
        <button class="btn ghost" id="btnEpCancel">Отмена</button>
      </div>
    `;

    showModal('Предпросмотр письма', html);

    document.getElementById('btnEpCancel')?.addEventListener('click', () => {
      hideModal();
      openInspectionModal(work, user, si.id);
    });

    document.getElementById('btnEpSend')?.addEventListener('click', async () => {
      const to = ($('#ep_to')?.value || '').trim();
      const subject = ($('#ep_subj')?.value || '').trim();
      const emailBody = ($('#ep_body')?.value || '').trim();

      if (!to) { toast('Email', 'Укажите email получателя', 'err'); return; }

      try {
        const token = await AsgardAuth.getToken();
        const resp = await fetch(`/api/site-inspections/${si.id}/send-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ to, subject, body: emailBody })
        });
        if (!resp.ok) throw new Error((await resp.json()).error || 'Ошибка отправки');

        toast('Email', 'Письмо отправлено');
        hideModal();
        promptStatusChange(si, work);
      } catch (e) {
        toast('Ошибка', e.message, 'err');
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. Prompt — изменить статус на "Запрос отправлен"
  // ═══════════════════════════════════════════════════════════════════════════
  function promptStatusChange(si, work) {
    showModal('Статус заявки', `
      <div class="help">Заявка на осмотр объекта <b>${esc(si.object_name)}</b> была скачана/отправлена.</div>
      <div style="display:flex; gap:10px; margin-top:16px; flex-wrap:wrap">
        <button class="btn" id="btnMarkSent">Отметить как «Запрос отправлен»</button>
        <button class="btn ghost" id="btnSkipMark">Пропустить</button>
      </div>
    `);

    document.getElementById('btnMarkSent')?.addEventListener('click', async () => {
      await changeInspectionStatus(si.id, 'sent');
      toast('Осмотр', 'Статус: Запрос отправлен');
      hideModal();
    });
    document.getElementById('btnSkipMark')?.addEventListener('click', () => hideModal());
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. Действия по заявке (после создания) — вызывается из popup-grid
  // ═══════════════════════════════════════════════════════════════════════════
  async function openInspectionActions(work, user) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) return;
    user = user || auth.user;

    // Find existing inspection for this work
    const token = await AsgardAuth.getToken();
    let si = null;
    try {
      const resp = await fetch(`/api/site-inspections?work_id=${work.id}`, {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      const data = await resp.json();
      si = (data.data || []).sort((a, b) => b.id - a.id)[0] || null;
    } catch (_) {}

    if (!si) {
      // No inspection exists — open creation form
      openInspectionModal(work, user);
      return;
    }

    // Show actions based on status
    if (si.status === 'draft') {
      openInspectionModal(work, user, si.id);
      return;
    }

    if (si.status === 'sent') {
      showModal('Действия по заявке', `
        <div class="help">Заявка на осмотр <b>${esc(si.object_name)}</b> отправлена клиенту.</div>
        <div class="help" style="margin-top:8px">Статус: <b>${esc(STATUS_LABELS[si.status])}</b></div>
        <div style="display:flex; gap:10px; margin-top:16px; flex-wrap:wrap">
          <button class="btn" id="btnApproved" style="background:var(--ok)">Осмотр одобрен</button>
          <button class="btn" id="btnRejected" style="background:var(--err)">Осмотр отклонён</button>
          <button class="btn ghost" id="btnEditSi">Открыть заявку</button>
        </div>
      `);

      document.getElementById('btnApproved')?.addEventListener('click', async () => {
        await changeInspectionStatus(si.id, 'approved');
        toast('Осмотр', 'Осмотр одобрен! Оформите командировку.');
        hideModal();
        // Open trip modal
        const updated = await fetchInspection(si.id);
        if (updated) openTripModal(updated, work, user);
      });

      document.getElementById('btnRejected')?.addEventListener('click', async () => {
        const reason = prompt('Причина отклонения (необязательно):');
        await changeInspectionStatus(si.id, 'rejected', reason);
        toast('Осмотр', 'Осмотр отклонён. Заявка возвращена в черновик.');
        hideModal();
      });

      document.getElementById('btnEditSi')?.addEventListener('click', () => {
        hideModal();
        openInspectionModal(work, user, si.id);
      });
      return;
    }

    if (si.status === 'approved') {
      // Open trip modal directly
      openTripModal(si, work, user);
      return;
    }

    if (['trip_planned', 'trip_sent', 'completed'].includes(si.status)) {
      // Show summary
      showModal('Осмотр объекта', `
        <div class="help"><b>${esc(si.object_name)}</b></div>
        <div class="help">Статус: <b>${esc(STATUS_LABELS[si.status])}</b></div>
        ${si.trips && si.trips.length ? `
          <hr class="hr"/>
          <div class="help"><b>Командировки:</b></div>
          ${si.trips.map(t => `
            <div class="pill" style="margin-top:6px; padding:10px; border:1px solid var(--brd); border-radius:8px">
              <span>${t.date_from || '?'} — ${t.date_to || '?'}</span>
              <span style="color:var(--t3); margin-left:12px">${esc(STATUS_LABELS[t.status] || t.status)}</span>
            </div>
          `).join('')}
        ` : ''}
        <div style="display:flex; gap:10px; margin-top:16px; flex-wrap:wrap">
          <button class="btn ghost" id="btnViewSi">Открыть заявку</button>
          ${si.status !== 'completed' ? '<button class="btn" id="btnCompleteSi">Завершить осмотр</button>' : ''}
        </div>
      `);

      document.getElementById('btnViewSi')?.addEventListener('click', () => {
        hideModal();
        openInspectionModal(work, user, si.id);
      });
      document.getElementById('btnCompleteSi')?.addEventListener('click', async () => {
        await changeInspectionStatus(si.id, 'completed');
        toast('Осмотр', 'Осмотр объекта завершён');
        hideModal();
      });
      return;
    }

    // Fallback: rejected → re-open creation
    if (si.status === 'rejected') {
      await changeInspectionStatus(si.id, 'draft');
      openInspectionModal(work, user, si.id);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. Модалка командировки
  // ═══════════════════════════════════════════════════════════════════════════
  async function openTripModal(inspection, work, user) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) return;
    user = user || auth.user;

    // Load employees from inspection
    let empList = (typeof inspection.employees_json === 'string' ? JSON.parse(inspection.employees_json) : inspection.employees_json) || [];

    const html = `
      <div class="help"><b>Командировка на осмотр: ${esc(inspection.object_name)}</b></div>
      ${inspection.object_address ? `<div class="help" style="color:var(--t3)">${esc(inspection.object_address)}</div>` : ''}

      <hr class="hr"/>
      <div class="formrow">
        <div><label>Дата начала</label><input id="tr_from" type="date" value="${today()}"/></div>
        <div><label>Дата окончания</label><input id="tr_to" type="date" value=""/></div>
      </div>

      <div class="help" style="margin-top:12px"><b>Сотрудники</b></div>
      <div id="tr_emp_wrap">
        ${empList.map((e, i) => `
          <div class="pill" style="gap:8px; padding:8px; margin-top:4px; border:1px solid var(--brd); border-radius:6px">
            <b>${esc(e.fio || '—')}</b> <span style="color:var(--t3)">${esc(e.position || '')}</span>
            <button class="btn ghost" data-del-tremp="${i}" style="padding:2px 6px; margin-left:auto">✕</button>
          </div>
        `).join('')}
      </div>
      <button class="btn ghost" id="btnTrAddEmp" style="margin-top:6px">+ Добавить сотрудника</button>

      <hr class="hr"/>
      <div class="help"><b>Способ передвижения</b></div>
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:8px">
        ${TRANSPORT_TYPES.map(t => `
          <label style="display:flex; align-items:center; gap:6px; cursor:pointer; padding:8px 14px; border:1px solid var(--brd); border-radius:8px; transition:all .15s" class="tr-transport-opt">
            <input type="radio" name="tr_transport" value="${t.id}"/> ${t.icon} ${t.label}
          </label>
        `).join('')}
      </div>

      <hr class="hr"/>
      <div class="help"><b>Потребности</b></div>
      <div style="display:flex; flex-direction:column; gap:10px; margin-top:8px">
        <label style="display:flex; align-items:center; gap:8px; cursor:pointer">
          <input type="checkbox" id="tr_fuel"/> Нужна топливная карта
        </label>
        <label style="display:flex; align-items:center; gap:8px; cursor:pointer">
          <input type="checkbox" id="tr_air"/> Нужен авиабилет
        </label>
        <label style="display:flex; align-items:center; gap:8px; cursor:pointer">
          <input type="checkbox" id="tr_advance"/> Нужен аванс
        </label>
        <div id="tr_adv_wrap" style="display:none; margin-left:24px">
          <label>Сумма аванса, ₽</label>
          <input id="tr_adv_amount" type="number" placeholder="0" style="max-width:200px"/>
        </div>
      </div>

      <div class="formrow" style="margin-top:12px">
        <div style="grid-column:1/-1"><label>Примечания</label><textarea id="tr_notes" rows="2" placeholder="Дополнительная информация"></textarea></div>
      </div>

      <hr class="hr"/>
      <div style="display:flex; gap:10px; flex-wrap:wrap">
        <button class="btn" id="btnTrSend">Отправить</button>
        <button class="btn ghost" id="btnTrPreview">Предпросмотр</button>
        <button class="btn ghost" id="btnTrCancel">Отмена</button>
      </div>
    `;

    showModal('Командировка на осмотр объекта', html);

    // Toggle advance amount field
    const advCb = document.getElementById('tr_advance');
    const advWrap = document.getElementById('tr_adv_wrap');
    if (advCb && advWrap) {
      advCb.addEventListener('change', () => {
        advWrap.style.display = advCb.checked ? 'block' : 'none';
      });
    }

    // Highlight selected transport
    document.querySelectorAll('.tr-transport-opt input').forEach(radio => {
      radio.addEventListener('change', () => {
        document.querySelectorAll('.tr-transport-opt').forEach(opt => {
          opt.style.borderColor = opt.querySelector('input').checked ? 'var(--info)' : 'var(--brd)';
          opt.style.background = opt.querySelector('input').checked ? 'rgba(59,130,246,0.08)' : 'transparent';
        });
      });
    });

    // Delete employee
    document.querySelectorAll('[data-del-tremp]').forEach(btn => {
      btn.addEventListener('click', () => {
        empList.splice(parseInt(btn.dataset.delTremp), 1);
        // Re-render would be complex, just remove the pill
        btn.closest('.pill')?.remove();
      });
    });

    // Add employee
    document.getElementById('btnTrAddEmp')?.addEventListener('click', async () => {
      if (!window.AsgardEmployeePicker) { toast('Ошибка', 'Модуль выбора сотрудников не загружен', 'err'); return; }
      const picked = await AsgardEmployeePicker.pickOne({
        filter: e => !empList.some(ex => ex.employee_id === e.id)
      });
      if (picked) {
        empList.push({ employee_id: picked.id, fio: picked.fio || '', position: picked.position || '' });
        const wrap = document.getElementById('tr_emp_wrap');
        const idx = empList.length - 1;
        wrap.insertAdjacentHTML('beforeend', `
          <div class="pill" style="gap:8px; padding:8px; margin-top:4px; border:1px solid var(--brd); border-radius:6px">
            <b>${esc(picked.fio || '—')}</b> <span style="color:var(--t3)">${esc(picked.position || '')}</span>
          </div>
        `);
      }
    });

    // Collect trip data
    function collectTripData() {
      const transportRadio = document.querySelector('input[name="tr_transport"]:checked');
      return {
        inspection_id: inspection.id,
        work_id: work?.id || inspection.work_id,
        date_from: $('#tr_from')?.value || null,
        date_to: $('#tr_to')?.value || null,
        employees_json: empList,
        transport_type: transportRadio?.value || null,
        need_fuel_card: !!$('#tr_fuel')?.checked,
        need_air_ticket: !!$('#tr_air')?.checked,
        need_advance: !!$('#tr_advance')?.checked,
        advance_amount: $('#tr_advance')?.checked ? Number($('#tr_adv_amount')?.value || 0) : null,
        notes: ($('#tr_notes')?.value || '').trim()
      };
    }

    // Preview
    document.getElementById('btnTrPreview')?.addEventListener('click', () => {
      const d = collectTripData();
      const transportLabel = TRANSPORT_TYPES.find(t => t.id === d.transport_type)?.label || '—';
      const needs = [];
      if (d.need_fuel_card) needs.push('Топливная карта');
      if (d.need_air_ticket) needs.push('Авиабилет');
      if (d.need_advance) needs.push(`Аванс: ${Number(d.advance_amount || 0).toLocaleString('ru-RU')} ₽`);

      showModal('Предпросмотр командировки', `
        <div class="help"><b>${esc(inspection.object_name)}</b></div>
        <div style="margin-top:12px">
          <div><b>Даты:</b> ${d.date_from || '—'} — ${d.date_to || '—'}</div>
          <div><b>Транспорт:</b> ${transportLabel}</div>
          <div><b>Сотрудники:</b> ${empList.map(e => e.fio).join(', ') || '—'}</div>
          ${needs.length ? `<div><b>Потребности:</b> ${needs.join(', ')}</div>` : ''}
          ${d.notes ? `<div><b>Примечания:</b> ${esc(d.notes)}</div>` : ''}
        </div>
        <div style="display:flex; gap:10px; margin-top:16px">
          <button class="btn" id="btnTrConfirm">Подтвердить и отправить</button>
          <button class="btn ghost" id="btnTrBack">Назад</button>
        </div>
      `);

      document.getElementById('btnTrBack')?.addEventListener('click', () => {
        hideModal();
        openTripModal(inspection, work, user);
      });
      document.getElementById('btnTrConfirm')?.addEventListener('click', () => doSendTrip(d));
    });

    // Send directly
    document.getElementById('btnTrSend')?.addEventListener('click', () => doSendTrip(collectTripData()));

    // Cancel
    document.getElementById('btnTrCancel')?.addEventListener('click', () => hideModal());

    async function doSendTrip(data) {
      if (!data.date_from) { toast('Командировка', 'Укажите дату начала', 'err'); return; }
      if (!data.transport_type) { toast('Командировка', 'Выберите способ передвижения', 'err'); return; }

      try {
        const token = await AsgardAuth.getToken();

        // 1. Create trip
        const createResp = await fetch('/api/site-inspections/trips', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify(data)
        });
        if (!createResp.ok) throw new Error((await createResp.json()).error || 'Ошибка создания');
        const trip = (await createResp.json()).data;

        // 2. Send trip (notify + create advance)
        const sendResp = await fetch(`/api/site-inspections/trips/${trip.id}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }
        });
        if (!sendResp.ok) throw new Error((await sendResp.json()).error || 'Ошибка отправки');
        const result = await sendResp.json();

        let msg = 'Командировка отправлена!';
        if (data.need_fuel_card || data.need_air_ticket) msg += ' Офис-менеджер уведомлён.';
        if (result.cash_request_id) msg += ` Заявка на аванс #${result.cash_request_id} создана.`;

        toast('Командировка', msg);
        hideModal();
      } catch (e) {
        toast('Ошибка', e.message, 'err');
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════════════════
  async function changeInspectionStatus(id, status, reason) {
    const token = await AsgardAuth.getToken();
    await fetch(`/api/site-inspections/${id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ status, reason })
    });
  }

  async function fetchInspection(id) {
    const token = await AsgardAuth.getToken();
    const resp = await fetch(`/api/site-inspections/${id}`, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!resp.ok) return null;
    return (await resp.json()).data;
  }

  async function findEmployeeByUserId(userId) {
    try {
      const employees = await AsgardDB.all('employees');
      return (employees || []).find(e => Number(e.user_id) === Number(userId));
    } catch (_) { return null; }
  }

  /**
   * Determine the label and action for the inspection button in work modal
   * Returns: { label, icon, desc, onClick, variant? }
   */
  async function getInspectionButtonState(work, user) {
    const token = await AsgardAuth.getToken();
    let si = null;
    try {
      const resp = await fetch(`/api/site-inspections?work_id=${work.id}`, {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      const data = await resp.json();
      si = (data.data || []).sort((a, b) => b.id - a.id)[0] || null;
    } catch (_) {}

    if (!si || si.status === 'rejected') {
      return { icon: '🔍', label: 'Осмотр объекта', desc: 'Создать заявку на осмотр', onClick: () => openInspectionModal(work, user) };
    }
    if (si.status === 'draft') {
      return { icon: '📝', label: 'Заявка (черновик)', desc: 'Продолжить заполнение заявки', onClick: () => openInspectionModal(work, user, si.id) };
    }
    if (si.status === 'sent') {
      return { icon: '📩', label: 'Действия по заявке', desc: 'Одобрен ли осмотр?', onClick: () => openInspectionActions(work, user) };
    }
    if (si.status === 'approved') {
      return { icon: '✈️', label: 'Оформить командировку', desc: 'Осмотр одобрен — оформите командировку', onClick: () => openInspectionActions(work, user), variant: 'success' };
    }

    return {
      icon: '🔍', label: 'Осмотр объекта',
      desc: STATUS_LABELS[si.status] || si.status,
      onClick: () => openInspectionActions(work, user)
    };
  }

  // ═══ Public API ════════════════════════════════════════════════════════════
  return {
    openInspectionModal,
    openInspectionActions,
    openTripModal,
    getInspectionButtonState,
    STATUS_LABELS,
    TRANSPORT_TYPES
  };
})();
