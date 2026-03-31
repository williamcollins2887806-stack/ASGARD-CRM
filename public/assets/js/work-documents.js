/**
 * АСГАРД CRM — WOW-модалки «Счёт» и «Акт» из карточки работы
 * window.AsgardWorkDocuments
 */
window.AsgardWorkDocuments = (function () {
  const { esc, toast, showModal, hideModal, money } = AsgardUI;

  /* ─── CSS (однократно) ─────────────────────────────────────────────── */
  let _cssInjected = false;
  function injectCSS() {
    if (_cssInjected) return;
    _cssInjected = true;
    const s = document.createElement('style');
    s.textContent = `
@keyframes wdSlideInField {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes wdGoldFlash {
  0%   { color: var(--gold, #D4A843); transform: scale(1.04); }
  50%  { color: #FFD700; }
  100% { color: var(--gold, #D4A843); transform: scale(1); }
}
@keyframes wdPulseCheck {
  0%   { transform: scale(0); opacity: 0; }
  50%  { transform: scale(1.3); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}
.wd-modal-wrap {
  font-size: 14px;
}
.wd-header-card {
  background: linear-gradient(135deg, #1e40af 0%, #4338ca 100%);
  border-radius: 10px;
  padding: 18px 20px 16px;
  margin-bottom: 20px;
  box-shadow: 0 4px 20px rgba(67,56,202,.35);
}
.wd-header-card h2 {
  margin: 0 0 6px;
  font-size: 20px;
  font-weight: 700;
  color: #fff;
}
.wd-work-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(255,255,255,.15);
  color: rgba(255,255,255,.9);
  border-radius: 20px;
  padding: 3px 10px;
  font-size: 12px;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wd-form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 16px;
}
.wd-form-grid .full { grid-column: 1 / -1; }
.wd-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  animation: wdSlideInField 0.3s ease both;
}
.wd-field label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .5px;
  color: var(--t2, #888);
}
.wd-field input, .wd-field textarea {
  padding: 9px 12px;
  border-radius: 7px;
  border: 1.5px solid var(--border, #333);
  background: var(--bg-input, #1a1f2e);
  color: var(--text, #e0e6f0);
  font-size: 14px;
  transition: border-color .2s;
  width: 100%;
  box-sizing: border-box;
}
.wd-field input:focus, .wd-field textarea:focus {
  outline: none;
  border-color: #4338ca;
}
.wd-field input.gold-prefill {
  border-color: var(--gold, #D4A843);
  box-shadow: 0 0 0 2px rgba(212,168,67,.2);
}
.wd-total-bar {
  background: var(--bg-card, #141820);
  border-radius: 8px;
  padding: 14px 18px;
  margin: 16px 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border: 1.5px solid rgba(212,168,67,.3);
}
.wd-total-label {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .5px;
  color: var(--t2, #888);
}
.wd-total-value {
  font-size: 22px;
  font-weight: 800;
  color: var(--gold, #D4A843);
  transition: all .2s;
}
.wd-total-value.flash {
  animation: wdGoldFlash 0.4s ease;
}
.wd-footer {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  margin-top: 20px;
  flex-wrap: wrap;
}
.wd-btn-cancel {
  padding: 10px 18px;
  border-radius: 8px;
  border: 1.5px solid var(--border, #333);
  background: transparent;
  color: var(--t2, #888);
  cursor: pointer;
  font-size: 14px;
  transition: all .2s;
}
.wd-btn-cancel:hover { border-color: var(--text, #e0e6f0); color: var(--text, #e0e6f0); }
.wd-btn-pdf {
  padding: 10px 18px;
  border-radius: 8px;
  border: 1.5px solid rgba(255,255,255,.15);
  background: rgba(255,255,255,.05);
  color: var(--text, #e0e6f0);
  cursor: pointer;
  font-size: 14px;
  transition: all .2s;
  display: none;
}
.wd-btn-pdf:hover { background: rgba(255,255,255,.1); }
.wd-btn-submit {
  padding: 10px 22px;
  border-radius: 8px;
  border: none;
  background: linear-gradient(135deg, #1e40af 0%, #4338ca 100%);
  color: #fff;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  transition: all .2s;
  box-shadow: 0 2px 10px rgba(67,56,202,.4);
}
.wd-btn-submit:hover {
  background: linear-gradient(135deg, #c0392b 0%, #1e40af 100%);
  box-shadow: 0 4px 18px rgba(192,57,43,.4);
  transform: translateY(-1px);
}
.wd-btn-submit:disabled { opacity: .6; cursor: not-allowed; transform: none; }
.wd-success-box {
  display: flex;
  align-items: center;
  gap: 14px;
  background: rgba(39,174,96,.1);
  border: 1.5px solid rgba(39,174,96,.4);
  border-radius: 10px;
  padding: 16px 18px;
  margin-top: 16px;
}
.wd-check-icon {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--ok, #27ae60);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  flex-shrink: 0;
  animation: wdPulseCheck 0.4s ease both;
}
.wd-success-text { flex: 1; }
.wd-success-text b { color: var(--ok-t, #2ecc71); font-size: 15px; }
.wd-success-text p { margin: 4px 0 0; font-size: 12px; color: var(--t2, #888); }
.wd-open-link {
  color: #4338ca;
  font-size: 13px;
  text-decoration: none;
  font-weight: 600;
  white-space: nowrap;
}
.wd-open-link:hover { text-decoration: underline; }
`;
    document.head.appendChild(s);
  }

  /* ─── Утилиты ─────────────────────────────────────────────────────── */
  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function todayPlus(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  async function authHeaders() {
    const auth = await AsgardAuth.getAuth();
    return { 'Authorization': 'Bearer ' + auth.token };
  }

  async function getToken() {
    const auth = await AsgardAuth.getAuth();
    return auth.token;
  }

  async function fetchNextNumber(type) {
    /* type: 'invoice' | 'act' */
    const url = type === 'invoice' ? '/api/invoices/next-number' : '/api/acts/next-number';
    try {
      const resp = await fetch(url, { headers: await authHeaders() });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();
      return data.number || '';
    } catch (e) {
      return '';
    }
  }

  function calcTotal(amountStr, vatStr) {
    const amount = parseFloat(String(amountStr).replace(/\s/g, '').replace(',', '.')) || 0;
    const vat = parseFloat(String(vatStr).replace(/\s/g, '').replace(',', '.')) || 0;
    return amount + amount * vat / 100;
  }

  function fmtMoney(n) {
    if (!n && n !== 0) return '0 ₽';
    return money(Math.round(n)) + ' ₽';
  }

  function flashTotal(el) {
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 500);
  }

  /* ─── openInvoiceModal ─────────────────────────────────────────────── */
  async function openInvoiceModal(work, user) {
    injectCSS();

    const nextNum = await fetchNextNumber('invoice');
    const hasAmount = Number(work.contract_value || 0) > 0;
    const amountVal = hasAmount ? Number(work.contract_value) : '';

    const html = `
<div class="wd-modal-wrap">
  <div class="wd-header-card">
    <h2>💰 Счёт на оплату</h2>
    <span class="wd-work-badge">Работа: ${esc(work.work_title || work.customer_name || 'ID ' + work.id)}</span>
  </div>

  <div class="wd-form-grid">
    <div class="wd-field" style="animation-delay:0ms">
      <label>№ счёта</label>
      <input id="wd_inv_num" type="text" value="${esc(nextNum)}" placeholder="СЧ-2026-001"/>
    </div>
    <div class="wd-field" style="animation-delay:50ms">
      <label>Дата</label>
      <input id="wd_inv_date" type="date" value="${today()}"/>
    </div>
    <div class="wd-field full" style="animation-delay:100ms">
      <label>Контрагент</label>
      <input id="wd_inv_customer" type="text" value="${esc(work.customer_name || '')}" placeholder="Наименование организации"/>
    </div>
    <div class="wd-field" style="animation-delay:150ms">
      <label>ИНН</label>
      <input id="wd_inv_inn" type="text" value="${esc(work.customer_inn || '')}" placeholder="0000000000"/>
    </div>
    <div class="wd-field" style="animation-delay:200ms">
      <label>Срок оплаты</label>
      <input id="wd_inv_due" type="date" value="${todayPlus(14)}"/>
    </div>
    <div class="wd-field full" style="animation-delay:250ms">
      <label>Описание / Наименование работ</label>
      <input id="wd_inv_desc" type="text" value="${esc(work.work_title || '')}" placeholder="Описание работ по договору"/>
    </div>
    <div class="wd-field" style="animation-delay:300ms">
      <label>Сумма без НДС, ₽</label>
      <input id="wd_inv_amount" type="number" step="0.01" value="${amountVal}" placeholder="0" class="${hasAmount ? 'gold-prefill' : ''}"/>
    </div>
    <div class="wd-field" style="animation-delay:350ms">
      <label>НДС, %</label>
      <input id="wd_inv_vat" type="number" step="1" value="20" placeholder="20"/>
    </div>
    <div class="wd-field full" style="animation-delay:400ms">
      <label>Примечание</label>
      <input id="wd_inv_note" type="text" placeholder="Дополнительная информация (необязательно)"/>
    </div>
  </div>

  <div class="wd-total-bar">
    <span class="wd-total-label">ИТОГО С НДС</span>
    <span class="wd-total-value" id="wd_inv_total">${fmtMoney(calcTotal(amountVal, 20))}</span>
  </div>

  <div id="wd_inv_success" style="display:none"></div>

  <div class="wd-footer" id="wd_inv_footer">
    <button class="wd-btn-cancel" id="wd_inv_cancel">Отмена</button>
    <button class="wd-btn-pdf" id="wd_inv_pdf">📄 Печать PDF</button>
    <button class="wd-btn-submit" id="wd_inv_submit">💾 Создать счёт</button>
  </div>
</div>`;

    showModal({ title: '', html, noPad: true });

    /* ── live calc ── */
    let _invId = null;
    const totalEl = document.getElementById('wd_inv_total');
    const amountEl = document.getElementById('wd_inv_amount');
    const vatEl = document.getElementById('wd_inv_vat');

    function updateTotal() {
      const t = calcTotal(amountEl.value, vatEl.value);
      totalEl.textContent = fmtMoney(t);
      flashTotal(totalEl);
    }
    amountEl.addEventListener('input', updateTotal);
    vatEl.addEventListener('input', updateTotal);

    /* ── cancel ── */
    document.getElementById('wd_inv_cancel').addEventListener('click', () => hideModal());

    /* ── PDF ── */
    document.getElementById('wd_inv_pdf').addEventListener('click', async () => {
      if (!_invId) return;
      const token = await getToken();
      window.open(`/api/invoices/${_invId}/pdf?token=${encodeURIComponent(token)}`, '_blank');
    });

    /* ── submit ── */
    document.getElementById('wd_inv_submit').addEventListener('click', async () => {
      const btn = document.getElementById('wd_inv_submit');
      const amount = parseFloat(amountEl.value) || 0;
      const vat = parseFloat(vatEl.value) || 0;
      if (!amount) {
        toast('Счёт', 'Укажите сумму', 'err');
        amountEl.focus();
        return;
      }
      btn.disabled = true;
      btn.textContent = '⏳ Создаём…';
      try {
        const headers = { ...(await authHeaders()), 'Content-Type': 'application/json' };
        const body = {
          invoice_number: document.getElementById('wd_inv_num').value.trim() || undefined,
          invoice_date: document.getElementById('wd_inv_date').value || today(),
          status: 'sent',
          work_id: work.id || undefined,
          customer_name: document.getElementById('wd_inv_customer').value.trim(),
          customer_inn: document.getElementById('wd_inv_inn').value.trim() || undefined,
          description: document.getElementById('wd_inv_desc').value.trim(),
          amount: amount,
          vat_pct: vat,
          total_amount: calcTotal(amount, vat),
          due_date: document.getElementById('wd_inv_due').value || undefined,
          notes: document.getElementById('wd_inv_note').value.trim() || undefined
        };
        const resp = await fetch('/api/invoices', { method: 'POST', headers, body: JSON.stringify(body) });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error(err.error || err.message || 'HTTP ' + resp.status);
        }
        const data = await resp.json();
        _invId = data.invoice?.id;

        /* success UI */
        document.getElementById('wd_inv_footer').style.display = 'none';
        const invNum = data.invoice?.invoice_number || '#' + _invId;
        document.getElementById('wd_inv_success').style.display = 'flex';
        document.getElementById('wd_inv_success').innerHTML = `
<div class="wd-success-box">
  <div class="wd-check-icon">✓</div>
  <div class="wd-success-text">
    <b>Счёт ${esc(invNum)} создан!</b>
    <p>Статус: Выставлен • Сумма: ${fmtMoney(data.invoice?.total_amount)}</p>
  </div>
  <a class="wd-open-link" href="#/invoices">Открыть в реестре →</a>
</div>
<div class="wd-footer" style="margin-top:12px">
  <button class="wd-btn-pdf" id="wd_inv_pdf2" style="display:inline-block">📄 Печать PDF</button>
  <button class="wd-btn-cancel" id="wd_inv_close2">Закрыть</button>
</div>`;

        document.getElementById('wd_inv_close2')?.addEventListener('click', () => hideModal());
        document.getElementById('wd_inv_pdf2')?.addEventListener('click', async () => {
          const token = await getToken();
          window.open(`/api/invoices/${_invId}/pdf?token=${encodeURIComponent(token)}`, '_blank');
        });

        toast('Счёт', `${invNum} создан`, 'ok');
      } catch (e) {
        toast('Счёт', e.message || 'Ошибка', 'err');
        btn.disabled = false;
        btn.textContent = '💾 Создать счёт';
      }
    });
  }

  /* ─── openActModal ─────────────────────────────────────────────────── */
  async function openActModal(work, user) {
    injectCSS();

    const nextNum = await fetchNextNumber('act');
    const hasAmount = Number(work.contract_value || 0) > 0;
    const amountVal = hasAmount ? Number(work.contract_value) : '';

    const html = `
<div class="wd-modal-wrap">
  <div class="wd-header-card" style="background:linear-gradient(135deg,#065f46 0%,#047857 100%);box-shadow:0 4px 20px rgba(4,120,87,.35)">
    <h2>📋 Акт выполненных работ</h2>
    <span class="wd-work-badge">Работа: ${esc(work.work_title || work.customer_name || 'ID ' + work.id)}</span>
  </div>

  <div class="wd-form-grid">
    <div class="wd-field" style="animation-delay:0ms">
      <label>№ акта</label>
      <input id="wd_act_num" type="text" value="${esc(nextNum)}" placeholder="АКТ-2026-001"/>
    </div>
    <div class="wd-field" style="animation-delay:50ms">
      <label>Дата</label>
      <input id="wd_act_date" type="date" value="${today()}"/>
    </div>
    <div class="wd-field full" style="animation-delay:100ms">
      <label>Контрагент</label>
      <input id="wd_act_customer" type="text" value="${esc(work.customer_name || '')}" placeholder="Наименование организации"/>
    </div>
    <div class="wd-field" style="animation-delay:150ms">
      <label>ИНН</label>
      <input id="wd_act_inn" type="text" value="${esc(work.customer_inn || '')}" placeholder="0000000000"/>
    </div>
    <div class="wd-field" style="animation-delay:200ms">
      <label>Дата подписания</label>
      <input id="wd_act_signed" type="date" value=""/>
    </div>
    <div class="wd-field full" style="animation-delay:250ms">
      <label>Наименование работ</label>
      <input id="wd_act_desc" type="text" value="${esc(work.work_title || '')}" placeholder="Описание выполненных работ"/>
    </div>
    <div class="wd-field" style="animation-delay:300ms">
      <label>Сумма без НДС, ₽</label>
      <input id="wd_act_amount" type="number" step="0.01" value="${amountVal}" placeholder="0" class="${hasAmount ? 'gold-prefill' : ''}"/>
    </div>
    <div class="wd-field" style="animation-delay:350ms">
      <label>НДС, %</label>
      <input id="wd_act_vat" type="number" step="1" value="20" placeholder="20"/>
    </div>
    <div class="wd-field full" style="animation-delay:400ms">
      <label>Примечание</label>
      <input id="wd_act_note" type="text" placeholder="Дополнительная информация (необязательно)"/>
    </div>
  </div>

  <div class="wd-total-bar">
    <span class="wd-total-label">ИТОГО С НДС</span>
    <span class="wd-total-value" id="wd_act_total">${fmtMoney(calcTotal(amountVal, 20))}</span>
  </div>

  <div id="wd_act_success" style="display:none"></div>

  <div class="wd-footer" id="wd_act_footer">
    <button class="wd-btn-cancel" id="wd_act_cancel">Отмена</button>
    <button class="wd-btn-pdf" id="wd_act_pdf">📄 Печать PDF</button>
    <button class="wd-btn-submit" id="wd_act_submit" style="background:linear-gradient(135deg,#065f46 0%,#047857 100%);box-shadow:0 2px 10px rgba(4,120,87,.4)">📋 Оформить акт</button>
  </div>
</div>`;

    showModal({ title: '', html, noPad: true });

    let _actId = null;
    const totalEl = document.getElementById('wd_act_total');
    const amountEl = document.getElementById('wd_act_amount');
    const vatEl = document.getElementById('wd_act_vat');

    function updateTotal() {
      const t = calcTotal(amountEl.value, vatEl.value);
      totalEl.textContent = fmtMoney(t);
      flashTotal(totalEl);
    }
    amountEl.addEventListener('input', updateTotal);
    vatEl.addEventListener('input', updateTotal);

    document.getElementById('wd_act_cancel').addEventListener('click', () => hideModal());

    document.getElementById('wd_act_pdf').addEventListener('click', async () => {
      if (!_actId) return;
      const token = await getToken();
      window.open(`/api/acts/${_actId}/pdf?token=${encodeURIComponent(token)}`, '_blank');
    });

    document.getElementById('wd_act_submit').addEventListener('click', async () => {
      const btn = document.getElementById('wd_act_submit');
      const amount = parseFloat(amountEl.value) || 0;
      const vat = parseFloat(vatEl.value) || 0;
      if (!amount) {
        toast('Акт', 'Укажите сумму', 'err');
        amountEl.focus();
        return;
      }
      btn.disabled = true;
      btn.textContent = '⏳ Создаём…';
      try {
        const headers = { ...(await authHeaders()), 'Content-Type': 'application/json' };
        const body = {
          act_number: document.getElementById('wd_act_num').value.trim() || undefined,
          act_date: document.getElementById('wd_act_date').value || today(),
          status: 'sent',
          work_id: work.id || undefined,
          customer_name: document.getElementById('wd_act_customer').value.trim(),
          customer_inn: document.getElementById('wd_act_inn').value.trim() || undefined,
          description: document.getElementById('wd_act_desc').value.trim(),
          amount: amount,
          vat_pct: vat,
          total_amount: calcTotal(amount, vat),
          signed_date: document.getElementById('wd_act_signed').value || undefined
        };
        const resp = await fetch('/api/acts', { method: 'POST', headers, body: JSON.stringify(body) });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error(err.error || err.message || 'HTTP ' + resp.status);
        }
        const data = await resp.json();
        _actId = data.act?.id;

        document.getElementById('wd_act_footer').style.display = 'none';
        const actNum = data.act?.act_number || '#' + _actId;
        document.getElementById('wd_act_success').style.display = 'flex';
        document.getElementById('wd_act_success').innerHTML = `
<div class="wd-success-box">
  <div class="wd-check-icon">✓</div>
  <div class="wd-success-text">
    <b>Акт ${esc(actNum)} оформлен!</b>
    <p>Статус: Отправлен • Сумма: ${fmtMoney(data.act?.total_amount)}</p>
  </div>
  <a class="wd-open-link" href="#/acts">Открыть в реестре →</a>
</div>
<div class="wd-footer" style="margin-top:12px">
  <button class="wd-btn-pdf" id="wd_act_pdf2" style="display:inline-block">📄 Печать PDF</button>
  <button class="wd-btn-cancel" id="wd_act_close2">Закрыть</button>
</div>`;

        document.getElementById('wd_act_close2')?.addEventListener('click', () => hideModal());
        document.getElementById('wd_act_pdf2')?.addEventListener('click', async () => {
          const token = await getToken();
          window.open(`/api/acts/${_actId}/pdf?token=${encodeURIComponent(token)}`, '_blank');
        });

        toast('Акт', `${actNum} оформлен`, 'ok');
      } catch (e) {
        toast('Акт', e.message || 'Ошибка', 'err');
        btn.disabled = false;
        btn.textContent = '📋 Оформить акт';
      }
    });
  }

  return { openInvoiceModal, openActModal };
})();
