/**
 * ASGARD CRM — Очередь оплаты (Бухгалтерия)
 * ═══════════════════════════════════════════════════════════════
 * Показывает заявки, одобренные директором и ожидающие оплаты.
 * Бухгалтер выбирает: ПП или наличные.
 */
window.AsgardApprovalPaymentPage = (function() {
  'use strict';

  const { showModal, hideModal, toast, esc } = AsgardUI;

  const PAYMENT_STATUS_MAP = {
    pending_payment:   { label: 'Ожидает оплаты',  color: '#f59e0b', bg: 'rgba(245,158,11,.12)' },
    paid:             { label: 'Оплачено (ПП)',    color: '#22c55e', bg: 'rgba(34,197,94,.12)' },
    cash_issued:      { label: 'Наличные выданы',   color: '#3b82f6', bg: 'rgba(59,130,246,.12)' },
    cash_received:    { label: 'Получено',          color: '#22c55e', bg: 'rgba(34,197,94,.12)' },
    expense_reported: { label: 'Отчёт приложен',    color: '#10b981', bg: 'rgba(16,185,129,.12)' },
    rework:           { label: 'На доработке',      color: '#f59e0b', bg: 'rgba(245,158,11,.12)' },
    question:         { label: 'Вопрос',            color: '#a855f7', bg: 'rgba(168,85,247,.12)' }
  };

  function paymentPill(status) {
    const s = PAYMENT_STATUS_MAP[status] || { label: status || '—', color: '#6b7280', bg: 'rgba(107,114,128,.12)' };
    return `<span style="display:inline-block;padding:4px 10px;border-radius:6px;font-size:12px;font-weight:600;color:${s.color};background:${s.bg};border:1px solid ${s.color}30">${s.label}</span>`;
  }

  function money(x) {
    if (x === null || x === undefined || x === '') return '—';
    return Number(x).toLocaleString('ru-RU');
  }

  function getHeaders() {
    const auth = typeof AsgardAuth !== 'undefined' ? AsgardAuth.getAuth() : null;
    return {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + (auth?.token || localStorage.getItem('asgard_token') || '')
    };
  }

  // ─── Загрузка данных ───
  async function loadPending() {
    const resp = await fetch('/api/approval/pending-buh', { headers: getHeaders() });
    if (!resp.ok) throw new Error('Ошибка загрузки');
    return resp.json();
  }

  // ─── RENDER ───
  async function render(container) {
    container.innerHTML = `
      <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div>
          <h1>Очередь оплаты</h1>
          <p style="color:var(--text-muted);font-size:var(--text-sm);margin:0">Заявки, одобренные директором и ожидающие оплаты</p>
        </div>
        <div id="cash-badge" style="padding:10px 16px;border-radius:10px;background:var(--bg2);border:1px solid var(--brd)">
          <div style="font-size:11px;color:var(--t3)">Баланс кассы</div>
          <div style="font-size:20px;font-weight:700;color:var(--gold)" id="cash-balance-val">...</div>
        </div>
      </div>
      <div id="payment-list" style="margin-top:16px">
        <div style="text-align:center;padding:40px;color:var(--text-muted)">Загрузка...</div>
      </div>`;

    try {
      const data = await loadPending();
      document.getElementById('cash-balance-val').textContent = money(data.cash_balance) + ' ₽';

      const list = document.getElementById('payment-list');
      if (!data.items || !data.items.length) {
        list.innerHTML = `<div style="text-align:center;padding:60px">
          <div style="font-size:48px;margin-bottom:12px">✅</div>
          <div style="font-size:16px;font-weight:600;color:var(--t2)">Нет заявок на оплату</div>
          <div class="help" style="margin-top:8px">Все заявки обработаны</div>
        </div>`;
        return;
      }

      list.innerHTML = data.items.map(item => `
        <div class="card" style="padding:16px;margin-bottom:12px;border:1px solid var(--brd);border-radius:10px;background:var(--bg1);cursor:pointer" data-entity="${item.entity_type}" data-id="${item.id}">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
            <div>
              <div style="font-weight:600">${esc(item.label)} #${item.id}</div>
              <div class="help" style="margin-top:4px">${new Date(item.updated_at).toLocaleString('ru-RU')}</div>
            </div>
            ${paymentPill(item.payment_status)}
          </div>
        </div>
      `).join('');

      list.addEventListener('click', ev => {
        const card = ev.target.closest('[data-entity]');
        if (!card) return;
        showPaymentModal(card.dataset.entity, Number(card.dataset.id), data.cash_balance);
      });

    } catch (err) {
      document.getElementById('payment-list').innerHTML =
        `<div style="text-align:center;padding:40px;color:var(--red)">${esc(err.message)}</div>`;
    }
  }

  // ─── Модалка выбора способа оплаты ───
  function showPaymentModal(entityType, entityId, cashBalance) {
    const html = `
      <div style="max-width:480px">
        <div style="text-align:center;margin-bottom:20px">
          <div style="font-size:14px;color:var(--t3)">Выберите способ оплаты</div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">
          <div id="opt-bank" style="padding:20px;border-radius:12px;border:2px solid var(--brd);background:var(--bg2);cursor:pointer;text-align:center;transition:all .15s ease"
               onmouseover="this.style.borderColor='#3b82f6'" onmouseout="this.style.borderColor='var(--brd)'">
            <div style="font-size:32px;margin-bottom:8px">💳</div>
            <div style="font-weight:700;font-size:14px">Платёжное поручение</div>
            <div class="help" style="margin-top:4px">Оплата через банк</div>
          </div>
          <div id="opt-cash" style="padding:20px;border-radius:12px;border:2px solid var(--brd);background:var(--bg2);cursor:pointer;text-align:center;transition:all .15s ease"
               onmouseover="this.style.borderColor='#22c55e'" onmouseout="this.style.borderColor='var(--brd)'">
            <div style="font-size:32px;margin-bottom:8px">💵</div>
            <div style="font-weight:700;font-size:14px">Наличные из кассы</div>
            <div class="help" style="margin-top:4px">Баланс: <b>${money(cashBalance)} ₽</b></div>
          </div>
        </div>

        <!-- Форма ПП (скрыта) -->
        <div id="form-bank" style="display:none">
          <div style="padding:16px;border-radius:10px;background:var(--bg2);border:1px solid var(--brd)">
            <div style="font-weight:600;margin-bottom:12px">💳 Оплата через ПП</div>
            <div style="margin-bottom:10px">
              <label style="font-size:13px;color:var(--t3)">Комментарий</label>
              <input id="pay-bank-comment" placeholder="Номер ПП, дата и т.д." style="width:100%;margin-top:4px"/>
            </div>
            <button class="btn" id="btn-pay-bank" style="background:#3b82f6;color:#fff;border:none;width:100%">💳 Оплачено</button>
          </div>
        </div>

        <!-- Форма наличные (скрыта) -->
        <div id="form-cash" style="display:none">
          <div style="padding:16px;border-radius:10px;background:var(--bg2);border:1px solid var(--brd)">
            <div style="font-weight:600;margin-bottom:8px">💵 Выдача наличных</div>
            <div style="padding:10px;border-radius:8px;background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.3);margin-bottom:12px;text-align:center">
              <div style="font-size:11px;color:var(--t3)">Баланс кассы</div>
              <div style="font-size:22px;font-weight:700;color:#22c55e">${money(cashBalance)} ₽</div>
            </div>
            <div style="margin-bottom:10px">
              <label style="font-size:13px;color:var(--t3)">Сумма выдачи, ₽</label>
              <input id="pay-cash-amount" type="number" min="1" step="0.01" placeholder="0" style="width:100%;margin-top:4px;font-size:18px;font-weight:700;text-align:center"/>
            </div>
            <div style="margin-bottom:12px">
              <label style="font-size:13px;color:var(--t3)">Комментарий</label>
              <input id="pay-cash-comment" placeholder="Кому, на что" style="width:100%;margin-top:4px"/>
            </div>
            <button class="btn" id="btn-pay-cash" style="background:#22c55e;color:#fff;border:none;width:100%">💵 Выдать наличные</button>
          </div>
        </div>

        <!-- Доработка / Вопрос -->
        <div style="display:flex;gap:8px;margin-top:16px;justify-content:center">
          <button class="btn ghost" id="btn-buh-rework" style="font-size:12px">🔄 На доработку</button>
          <button class="btn ghost" id="btn-buh-question" style="font-size:12px">❓ Вопрос</button>
        </div>
      </div>`;

    showModal(`Оплата: ${entityType.replace(/_/g, ' ')} #${entityId}`, html);

    // Переключение форм
    document.getElementById('opt-bank').addEventListener('click', () => {
      document.getElementById('form-bank').style.display = 'block';
      document.getElementById('form-cash').style.display = 'none';
      document.getElementById('opt-bank').style.borderColor = '#3b82f6';
      document.getElementById('opt-cash').style.borderColor = 'var(--brd)';
    });
    document.getElementById('opt-cash').addEventListener('click', () => {
      document.getElementById('form-cash').style.display = 'block';
      document.getElementById('form-bank').style.display = 'none';
      document.getElementById('opt-cash').style.borderColor = '#22c55e';
      document.getElementById('opt-bank').style.borderColor = 'var(--brd)';
    });

    // ─── Оплата через ПП ───
    document.getElementById('btn-pay-bank').addEventListener('click', async () => {
      const comment = document.getElementById('pay-bank-comment').value.trim();
      try {
        const resp = await fetch(`/api/approval/${entityType}/${entityId}/pay-bank`, {
          method: 'POST', headers: getHeaders(),
          body: JSON.stringify({ comment })
        });
        if (!resp.ok) { const e = await resp.json(); throw new Error(e.error); }
        toast('Оплачено', 'Платёж через ПП зарегистрирован', 'ok');
        hideModal();
        render(document.querySelector('[data-page="approval-payment"]') || document.getElementById('main-content'));
      } catch (err) { toast('Ошибка', err.message, 'err'); }
    });

    // ─── Выдача наличных ───
    document.getElementById('btn-pay-cash').addEventListener('click', async () => {
      const amount = parseFloat(document.getElementById('pay-cash-amount').value);
      const comment = document.getElementById('pay-cash-comment').value.trim();
      if (!amount || amount <= 0) { toast('Ошибка', 'Укажите сумму', 'err'); return; }
      if (amount > cashBalance) { toast('Ошибка', `Недостаточно средств. Баланс: ${money(cashBalance)} ₽`, 'err'); return; }
      try {
        const resp = await fetch(`/api/approval/${entityType}/${entityId}/issue-cash`, {
          method: 'POST', headers: getHeaders(),
          body: JSON.stringify({ amount, comment })
        });
        if (!resp.ok) { const e = await resp.json(); throw new Error(e.error); }
        const data = await resp.json();
        toast('Выдано', `${money(amount)} ₽ из кассы. Баланс: ${money(data.cash_balance)} ₽`, 'ok');
        hideModal();
        render(document.querySelector('[data-page="approval-payment"]') || document.getElementById('main-content'));
      } catch (err) { toast('Ошибка', err.message, 'err'); }
    });

    // ─── Доработка ───
    document.getElementById('btn-buh-rework').addEventListener('click', () => {
      showCommentModal('На доработку', async (comment) => {
        const resp = await fetch(`/api/approval/${entityType}/${entityId}/rework`, {
          method: 'POST', headers: getHeaders(),
          body: JSON.stringify({ comment })
        });
        if (!resp.ok) { const e = await resp.json(); throw new Error(e.error); }
        toast('Готово', 'Возвращено на доработку', 'ok');
        hideModal();
        render(document.querySelector('[data-page="approval-payment"]') || document.getElementById('main-content'));
      });
    });

    // ─── Вопрос ───
    document.getElementById('btn-buh-question').addEventListener('click', () => {
      showCommentModal('Вопрос', async (comment) => {
        const resp = await fetch(`/api/approval/${entityType}/${entityId}/question`, {
          method: 'POST', headers: getHeaders(),
          body: JSON.stringify({ comment })
        });
        if (!resp.ok) { const e = await resp.json(); throw new Error(e.error); }
        toast('Готово', 'Вопрос отправлен', 'ok');
        hideModal();
        render(document.querySelector('[data-page="approval-payment"]') || document.getElementById('main-content'));
      });
    });
  }

  // ─── Модалка ввода комментария ───
  function showCommentModal(title, onSubmit) {
    const html = `
      <div style="max-width:400px">
        <div style="margin-bottom:12px">
          <label style="font-size:13px;color:var(--t3)">Комментарий (обязательно)</label>
          <textarea id="buh-comment" rows="3" placeholder="Напишите..." style="width:100%;margin-top:4px;resize:vertical"></textarea>
        </div>
        <button class="btn" id="btn-submit-comment" style="width:100%">Отправить</button>
      </div>`;
    showModal(title, html);
    document.getElementById('btn-submit-comment').addEventListener('click', async () => {
      const comment = document.getElementById('buh-comment').value.trim();
      if (!comment) { toast('Ошибка', 'Нужен комментарий', 'err'); return; }
      try { await onSubmit(comment); } catch (err) { toast('Ошибка', err.message, 'err'); }
    });
  }

  return { render };
})();
