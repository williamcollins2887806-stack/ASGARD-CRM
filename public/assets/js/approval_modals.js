/**
 * ASGARD CRM — Модалки универсального согласования v2
 * ═══════════════════════════════════════════════════════════════
 * Premium-стиль: анимации, loading-состояния, выделение выбранного.
 */
window.AsgardApprovalModals = (function() {
  'use strict';
  const { showModal, hideModal, toast, esc } = AsgardUI;

  function getHeaders() {
    return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (localStorage.getItem('asgard_token') || '') };
  }

  async function apiPost(path, body) {
    const resp = await fetch('/api/approval' + path, { method: 'POST', headers: getHeaders(), body: JSON.stringify(body || {}) });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Ошибка');
    return data;
  }

  async function apiGet(path) {
    const resp = await fetch('/api/approval' + path, { headers: getHeaders() });
    return resp.json();
  }

  async function uploadFile(file, type) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', type || 'Документ');
    const resp = await fetch('/api/files/upload', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('asgard_token') || '') },
      body: formData
    });
    if (!resp.ok) throw new Error('Ошибка загрузки файла');
    const data = await resp.json();
    return data.id || data.document?.id || null;
  }

  function setLoading(btn, loading) {
    if (!btn) return;
    if (loading) {
      btn._origText = btn.textContent;
      btn.textContent = '⏳ Обработка...';
      btn.disabled = true;
      btn.style.opacity = '0.7';
    } else {
      btn.textContent = btn._origText || btn.textContent;
      btn.disabled = false;
      btn.style.opacity = '';
    }
  }

  // Цветные pill-статусы оплаты
  const STATUS_STYLES = {
    pending_payment:  { label: 'Ожидает оплаты',    color: '#f59e0b', bg: 'rgba(245,158,11,.12)' },
    paid:             { label: 'Оплачено (ПП)',      color: '#22c55e', bg: 'rgba(34,197,94,.12)' },
    cash_issued:      { label: 'Наличные выданы',    color: '#3b82f6', bg: 'rgba(59,130,246,.12)' },
    cash_received:    { label: 'Получено',           color: '#6366f1', bg: 'rgba(99,102,241,.12)' },
    expense_reported: { label: 'Отчёт приложен',     color: '#22c55e', bg: 'rgba(34,197,94,.12)' },
    rework:           { label: 'На доработке',       color: '#f59e0b', bg: 'rgba(245,158,11,.12)' },
    question:         { label: 'Вопрос',             color: '#a855f7', bg: 'rgba(168,85,247,.12)' }
  };

  function paymentPill(status) {
    const s = STATUS_STYLES[status] || { label: status || '—', color: '#6b7280', bg: 'rgba(107,114,128,.12)' };
    return '<span style="display:inline-block;padding:3px 8px;border-radius:5px;font-size:11px;font-weight:600;' +
      'color:' + s.color + ';background:' + s.bg + ';border:1px solid ' + s.color + '30">' + esc(s.label) + '</span>';
  }

  // CSS для карточек выбора (инъектируется один раз)
  function injectStyles() {
    if (document.getElementById('asg-approval-styles')) return;
    const style = document.createElement('style');
    style.id = 'asg-approval-styles';
    style.textContent = `
      .asg-pay-card { padding:16px; border-radius:12px; background:var(--bg2); border:2px solid var(--brd);
        cursor:pointer; transition:all .2s ease; margin-bottom:12px; }
      .asg-pay-card:hover { border-color:var(--blue); transform:translateY(-1px); box-shadow:0 4px 12px rgba(0,0,0,.08); }
      .asg-pay-card.selected { border-color:var(--blue); background:rgba(59,130,246,.06); }
      .asg-pay-card.selected-amber { border-color:var(--amber); background:rgba(245,158,11,.06); }
      .asg-pay-card .card-header { display:flex; align-items:center; gap:12px; }
      .asg-pay-card .card-icon { font-size:28px; width:44px; height:44px; display:flex; align-items:center; justify-content:center;
        border-radius:10px; background:var(--bg3); }
      .asg-pay-card .card-title { font-weight:700; font-size:14px; }
      .asg-pay-card .card-subtitle { font-size:12px; color:var(--t3); margin-top:2px; }
      .asg-pay-card .card-form { display:none; margin-top:14px; padding-top:14px; border-top:1px solid var(--brd); }
      .asg-pay-card.selected .card-form,
      .asg-pay-card.selected-amber .card-form { display:block; }
      .asg-balance-badge { padding:12px; border-radius:10px; background:rgba(59,130,246,.06); border:1px solid rgba(59,130,246,.15);
        text-align:center; margin-bottom:14px; }
      .asg-balance-badge .value { font-size:26px; font-weight:800; color:var(--blue); }
      .asg-balance-badge .label { font-size:11px; color:var(--t3); margin-top:2px; }
      .asg-btn-full { width:100%; padding:10px; font-size:14px; font-weight:600; border-radius:8px; cursor:pointer;
        border:none; transition:all .15s; }
      .asg-btn-full:hover { opacity:.9; transform:translateY(-1px); }
      .asg-btn-full:disabled { opacity:.5; cursor:not-allowed; transform:none; }
      .asg-btn-green { background:#22c55e; color:#fff; }
      .asg-btn-amber { background:#f59e0b; color:#fff; }
      .asg-btn-blue { background:#3b82f6; color:#fff; }
      .asg-confirm-icon { font-size:56px; margin-bottom:16px; animation:asg-bounce .5s ease; }
      @keyframes asg-bounce { 0%{transform:scale(.8)} 50%{transform:scale(1.1)} 100%{transform:scale(1)} }
    `;
    document.head.appendChild(style);
  }

  // ═══════════════════════════════════════════════════════════════
  // 1. Модалка бухгалтерии: выбор способа оплаты
  // ═══════════════════════════════════════════════════════════════
  async function showBuhPaymentModal(entityType, entityId, onDone) {
    injectStyles();
    let balance = 0;
    try { const d = await apiGet('/cash-balance'); balance = d.balance || 0; } catch (e) {}

    const html = `
      <div style="max-width:480px">
        <div style="text-align:center;margin-bottom:20px">
          <div style="font-size:16px;font-weight:700;color:var(--t1)">Способ оплаты</div>
          <div style="font-size:12px;color:var(--t3);margin-top:4px">Выберите как оплатить эту заявку</div>
        </div>

        <div class="asg-pay-card" id="buh_pp_card">
          <div class="card-header">
            <div class="card-icon">💳</div>
            <div>
              <div class="card-title">Платёжное поручение</div>
              <div class="card-subtitle">Безналичный перевод через банк</div>
            </div>
          </div>
          <div class="card-form">
            <label style="font-size:13px;font-weight:500">Комментарий</label>
            <input id="buh_pp_comment" placeholder="Номер ПП, дата, банк..." style="width:100%;margin-top:4px"/>
            <div style="margin-top:10px">
              <label style="font-size:13px;font-weight:500">Файл ПП</label>
              <input id="buh_pp_file" type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" style="margin-top:4px"/>
            </div>
            <button class="asg-btn-full asg-btn-green" id="buh_pp_submit" style="margin-top:14px">✅ Подтвердить оплату</button>
          </div>
        </div>

        <div class="asg-pay-card" id="buh_cash_card">
          <div class="card-header">
            <div class="card-icon">💵</div>
            <div>
              <div class="card-title">Выдать наличные</div>
              <div class="card-subtitle">Из кассы предприятия</div>
            </div>
          </div>
          <div class="card-form">
            <div class="asg-balance-badge">
              <div class="label">Текущий баланс кассы</div>
              <div class="value">${balance.toLocaleString('ru-RU')} ₽</div>
            </div>
            <label style="font-size:13px;font-weight:500">Сумма выдачи</label>
            <input id="buh_cash_amount" type="number" min="1" step="0.01" placeholder="0" style="width:100%;margin-top:4px;font-size:18px;font-weight:700;text-align:center"/>
            <label style="font-size:13px;font-weight:500;margin-top:10px;display:block">Комментарий</label>
            <input id="buh_cash_comment" placeholder="Примечание для получателя" style="width:100%;margin-top:4px"/>
            <button class="asg-btn-full asg-btn-amber" id="buh_cash_submit" style="margin-top:14px">💵 Выдать из кассы</button>
          </div>
        </div>

        <div style="display:flex;gap:8px;margin-top:16px">
          <button class="btn ghost" id="buh_rework_btn" style="flex:1;font-size:13px">🔄 На доработку</button>
          <button class="btn ghost" id="buh_question_btn" style="flex:1;font-size:13px">❓ Вопрос</button>
        </div>
        <div id="buh_comment_section" style="display:none;margin-top:10px">
          <input id="buh_action_comment" placeholder="Комментарий (обязательно)" style="width:100%"/>
          <button class="asg-btn-full asg-btn-blue" id="buh_action_submit" style="margin-top:8px">Отправить</button>
        </div>
      </div>`;

    showModal('Оплата', html);

    // Card selection logic
    const ppCard = document.getElementById('buh_pp_card');
    const cashCard = document.getElementById('buh_cash_card');

    ppCard.addEventListener('click', function(e) {
      if (e.target.closest('.card-form')) return;
      ppCard.classList.add('selected');
      cashCard.classList.remove('selected-amber');
    });

    cashCard.addEventListener('click', function(e) {
      if (e.target.closest('.card-form')) return;
      cashCard.classList.add('selected-amber');
      ppCard.classList.remove('selected');
    });

    // Submit ПП
    document.getElementById('buh_pp_submit').addEventListener('click', async function() {
      const btn = this;
      const comment = (document.getElementById('buh_pp_comment').value || '').trim();
      const file = document.getElementById('buh_pp_file').files[0];
      setLoading(btn, true);
      try {
        let documentId = null;
        if (file) documentId = await uploadFile(file, 'Платёжное поручение');
        await apiPost('/' + entityType + '/' + entityId + '/pay-bank', { comment, document_id: documentId });
        toast('Готово', 'Оплачено через ПП', 'ok');
        hideModal();
        if (onDone) onDone();
      } catch (err) { toast('Ошибка', err.message, 'err'); setLoading(btn, false); }
    });

    // Submit Cash
    document.getElementById('buh_cash_submit').addEventListener('click', async function() {
      const btn = this;
      const amount = parseFloat(document.getElementById('buh_cash_amount').value);
      const comment = (document.getElementById('buh_cash_comment').value || '').trim();
      if (!amount || amount <= 0) { toast('Ошибка', 'Введите сумму', 'err'); return; }
      if (amount > balance) { toast('Ошибка', 'Недостаточно средств в кассе (' + balance.toLocaleString('ru-RU') + ' ₽)', 'err'); return; }
      setLoading(btn, true);
      try {
        const result = await apiPost('/' + entityType + '/' + entityId + '/issue-cash', { amount, comment });
        toast('Готово', 'Выдано ' + amount.toLocaleString('ru-RU') + ' ₽', 'ok');
        hideModal();
        if (onDone) onDone();
      } catch (err) { toast('Ошибка', err.message, 'err'); setLoading(btn, false); }
    });

    // Rework / Question
    let pendingAction = null;
    document.getElementById('buh_rework_btn').addEventListener('click', function() {
      pendingAction = 'rework';
      document.getElementById('buh_comment_section').style.display = 'block';
      document.getElementById('buh_action_comment').placeholder = 'Что нужно доработать?';
      document.getElementById('buh_action_comment').focus();
    });
    document.getElementById('buh_question_btn').addEventListener('click', function() {
      pendingAction = 'question';
      document.getElementById('buh_comment_section').style.display = 'block';
      document.getElementById('buh_action_comment').placeholder = 'Ваш вопрос';
      document.getElementById('buh_action_comment').focus();
    });
    document.getElementById('buh_action_submit').addEventListener('click', async function() {
      const btn = this;
      const comment = (document.getElementById('buh_action_comment').value || '').trim();
      if (!comment) { toast('Ошибка', 'Введите комментарий', 'err'); return; }
      setLoading(btn, true);
      try {
        await apiPost('/' + entityType + '/' + entityId + '/' + pendingAction, { comment });
        toast('Готово', pendingAction === 'question' ? 'Вопрос отправлен' : 'Возвращено на доработку', 'ok');
        hideModal();
        if (onDone) onDone();
      } catch (err) { toast('Ошибка', err.message, 'err'); setLoading(btn, false); }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // 2. Подтверждение получения наличных
  // ═══════════════════════════════════════════════════════════════
  async function showConfirmCashModal(entityType, entityId, onDone) {
    injectStyles();
    const html = `
      <div style="text-align:center;max-width:400px;padding:10px 0">
        <div class="asg-confirm-icon">💵</div>
        <div style="font-weight:700;font-size:18px;margin-bottom:6px">Подтвердите получение</div>
        <div style="color:var(--t3);font-size:13px;margin-bottom:24px;line-height:1.5">
          Нажмите после получения наличных в бухгалтерии.<br>
          После подтверждения нужно будет отчитаться о расходах.
        </div>
        <button class="asg-btn-full asg-btn-green" id="confirm_cash_btn">✅ Деньги получены</button>
      </div>`;
    showModal('Получение наличных', html);
    document.getElementById('confirm_cash_btn').addEventListener('click', async function() {
      const btn = this;
      setLoading(btn, true);
      try {
        await apiPost('/' + entityType + '/' + entityId + '/confirm-cash', {});
        toast('Готово', 'Получение подтверждено', 'ok');
        hideModal();
        if (onDone) onDone();
      } catch (err) { toast('Ошибка', err.message, 'err'); setLoading(btn, false); }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // 3. Отчёт о расходах
  // ═══════════════════════════════════════════════════════════════
  async function showExpenseReportModal(entityType, entityId, onDone) {
    injectStyles();
    const html = `
      <div style="max-width:440px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
          <div style="font-size:32px">📋</div>
          <div>
            <div style="font-weight:700;font-size:16px">Отчёт о расходах</div>
            <div style="font-size:12px;color:var(--t3)">Приложите чеки и документы, подтверждающие расходы</div>
          </div>
        </div>
        <div style="padding:14px;border-radius:10px;background:var(--bg2);border:1px solid var(--brd);margin-bottom:14px">
          <label style="font-size:13px;font-weight:600">📎 Файл (чек, акт, накладная)</label>
          <input id="report_file" type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx" style="margin-top:6px;width:100%"/>
        </div>
        <label style="font-size:13px;font-weight:500">Описание расходов</label>
        <textarea id="report_comment" rows="3" placeholder="Что и на какую сумму было потрачено..." style="width:100%;margin-top:4px;resize:vertical"></textarea>
        <button class="asg-btn-full asg-btn-green" id="report_submit" style="margin-top:16px">📤 Отправить отчёт</button>
      </div>`;
    showModal('Отчёт о расходах', html);
    document.getElementById('report_submit').addEventListener('click', async function() {
      const btn = this;
      const comment = (document.getElementById('report_comment').value || '').trim();
      const file = document.getElementById('report_file').files[0];
      if (!comment && !file) { toast('Ошибка', 'Приложите файл или опишите расходы', 'err'); return; }
      setLoading(btn, true);
      try {
        let documentId = null;
        if (file) documentId = await uploadFile(file, 'Отчёт о расходах');
        await apiPost('/' + entityType + '/' + entityId + '/expense-report', { comment: comment || 'Отчёт приложен', document_id: documentId });
        toast('Готово', 'Отчёт отправлен', 'ok');
        hideModal();
        if (onDone) onDone();
      } catch (err) { toast('Ошибка', err.message, 'err'); setLoading(btn, false); }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // 4. Возврат наличных
  // ═══════════════════════════════════════════════════════════════
  async function showReturnCashModal(entityType, entityId, onDone) {
    injectStyles();
    const html = `
      <div style="max-width:400px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
          <div style="font-size:32px">💵</div>
          <div>
            <div style="font-weight:700;font-size:16px">Возврат остатка в кассу</div>
            <div style="font-size:12px;color:var(--t3)">Неизрасходованные средства возвращаются в кассу</div>
          </div>
        </div>
        <div style="padding:14px;border-radius:10px;background:var(--bg2);border:1px solid var(--brd);margin-bottom:14px">
          <label style="font-size:13px;font-weight:600">Сумма возврата</label>
          <input id="return_amount" type="number" min="1" step="0.01" placeholder="0" style="width:100%;margin-top:6px;font-size:20px;font-weight:700;text-align:center"/>
        </div>
        <label style="font-size:13px;font-weight:500">Комментарий</label>
        <input id="return_comment" placeholder="Причина возврата (необязательно)" style="width:100%;margin-top:4px"/>
        <button class="asg-btn-full asg-btn-amber" id="return_submit" style="margin-top:16px">💵 Вернуть в кассу</button>
      </div>`;
    showModal('Возврат в кассу', html);
    document.getElementById('return_submit').addEventListener('click', async function() {
      const btn = this;
      const amount = parseFloat(document.getElementById('return_amount').value);
      const comment = (document.getElementById('return_comment').value || '').trim();
      if (!amount || amount <= 0) { toast('Ошибка', 'Введите сумму', 'err'); return; }
      setLoading(btn, true);
      try {
        await apiPost('/' + entityType + '/' + entityId + '/return-cash', { amount, comment });
        toast('Готово', 'Возвращено ' + amount.toLocaleString('ru-RU') + ' ₽ в кассу', 'ok');
        hideModal();
        if (onDone) onDone();
      } catch (err) { toast('Ошибка', err.message, 'err'); setLoading(btn, false); }
    });
  }

  return { showBuhPaymentModal, showConfirmCashModal, showExpenseReportModal, showReturnCashModal, paymentPill };
})();
