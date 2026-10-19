/**
 * ASGARD CRM — ОЧЕРЕДЬ БУХГАЛТЕРИИ по партии счетов (V412)
 * ═══════════════════════════════════════════════════════════════════════════
 * Заказчик 19.10.2026: «доделай модалки директора и бухгалтера, чтобы всё это
 * обрабатывать, согласовывать и оплачивать».
 *
 * Бухгалтерия видит согласованные счета (pending_payment) и оплачивает КАЖДЫЙ
 * отдельно: № и дата платёжного поручения, комментарий, реквизиты для копирования.
 * «Оплатить все» доступно, но решение по каждому — отдельное.
 *
 * Работает поверх существующего проверенного роута POST /:id/pay-bank
 * (условный UPDATE по payment_status='pending_payment' → без двойных оплат).
 */
window.AsgardPaymentBuh = (function () {
  const UI = window.AsgardUI || {};
  const esc = UI.esc || ((s) => String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])));
  const toast = UI.toast || ((t, m) => console.log(t, m));
  const showModal = UI.showModal || (() => {});
  const closeModal = UI.closeModal || (() => {});

  function hdr() {
    const t = localStorage.getItem('asgard_token') || '';
    return t ? { Authorization: 'Bearer ' + t } : {};
  }
  async function api(url, opts) {
    const r = await fetch(url, { ...(opts || {}), headers: { ...hdr(), ...((opts && opts.headers) || {}) } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    return j;
  }
  const money2 = (v) => (Number(v || 0)).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽';
  const niceDate = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('.') : '');

  /**
   * Экран оплаты партии. Показывает только согласованные счета (pending_payment);
   * ждущие решения директора — отдельной пометкой, оплатить их нельзя.
   * @param {number} batchId
   * @param {Function} [onDone] — колбэк после оплаты (обновить список)
   */
  async function open(batchId, onDone) {
    let data;
    try { data = await api('/api/payment-invoices/batches/' + batchId); }
    catch (e) { toast('Партия', e.message || 'не загрузилась', 'err'); return; }
    const b = data.batch || {};
    const items = data.items || [];
    const payable = items.filter((x) => x.payment_status === 'pending_payment' || x.status === 'pending_payment');
    const waiting = items.filter((x) => x.status === 'awaiting_dir');
    const paid = items.filter((x) => x.payment_status === 'paid' || x.status === 'paid');
    const total = payable.reduce((s, x) => s + Number(x.amount || 0), 0);

    const rowOf = (it) => {
      const isPayable = it.payment_status === 'pending_payment' || it.status === 'pending_payment';
      const isPaid = it.payment_status === 'paid' || it.status === 'paid';
      const st = isPaid ? 'ok' : isPayable ? 'ready' : 'wait';
      const stLabel = isPaid ? 'Оплачен' : isPayable ? 'К оплате' : 'У директора';
      const req = it.payee_requisites || {};
      return `<div class="pbuh__row ${isPaid ? 'is-paid' : ''}" data-row="${it.id}">
        <div class="pbuh__main">
          <div class="pbuh__sup">${esc(it.supplier_name || '—')}</div>
          <div class="pbuh__meta">
            ${it.invoice_number ? '№ ' + esc(it.invoice_number) : 'б/н'}${it.invoice_date ? ' от ' + niceDate(it.invoice_date) : ''}
            ${it.vat_amount ? ' · НДС ' + money2(it.vat_amount) : ''}
            ${it.contract_basis_number ? ' · дог. ' + esc(it.contract_basis_number) : ''}
          </div>
          ${isPayable && (req.bik || req.rs) ? `<div class="pbuh__req">
            ${req.bik ? `<button type="button" class="pbuh__copy" data-copy="${esc(req.bik)}">БИК ${esc(req.bik)}</button>` : ''}
            ${req.rs ? `<button type="button" class="pbuh__copy" data-copy="${esc(req.rs)}">р/с ${esc(req.rs)}</button>` : ''}
            ${req.ks ? `<button type="button" class="pbuh__copy" data-copy="${esc(req.ks)}">к/с ${esc(req.ks)}</button>` : ''}
          </div>` : ''}
        </div>
        <div class="pbuh__sum">${money2(it.amount)}</div>
        <div class="pbuh__st pbuh__st--${st}">${stLabel}</div>
        <div class="pbuh__act">
          ${isPaid ? (it.pp_number ? `<span class="pbuh__pp">п/п ${esc(it.pp_number)}</span>` : '<span class="pbuh__pp">—</span>')
            : isPayable ? `<button type="button" class="btn primary pbuh__pay" data-pay="${it.id}">Оплатить</button>`
            : '<span class="pbuh__pp">ждёт директора</span>'}
        </div>
      </div>`;
    };

    const html = `<div class="pbuh">
      <div class="pbuh__head">
        <div>
          <div class="pbuh__t">Оплата заявки №${b.id}</div>
          <div class="pbuh__s">${items.length} ${items.length === 1 ? 'счёт' : 'счетов'}
            · к оплате <b>${payable.length}</b> на <b>${money2(total)}</b>
            ${paid.length ? ` · оплачено ${paid.length}` : ''}
            ${waiting.length ? ` · у директора ${waiting.length}` : ''}</div>
        </div>
        ${payable.length > 1 ? '<button type="button" class="btn ghost" id="pbuh-all">Оплатить все</button>' : ''}
      </div>
      <div class="pbuh__list">${items.map(rowOf).join('')}</div>
      <div class="pbuh__foot">
        <div class="pbuh__hint">Платёжное поручение: № и дату можно указать при каждой оплате. Без п/п оплата не проводится.</div>
        <button type="button" class="btn ghost" id="pbuh-close">Закрыть</button>
      </div>
    </div>`;
    showModal({ title: 'Бухгалтерия · оплата счетов', html, wide: true });

    document.getElementById('pbuh-close').onclick = () => closeModal();

    // Копирование реквизитов в буфер (1 клик — для платёжки).
    document.querySelectorAll('[data-copy]').forEach((btn) => {
      btn.onclick = async () => {
        try { await navigator.clipboard.writeText(btn.getAttribute('data-copy')); toast('Скопировано', btn.getAttribute('data-copy'), 'ok'); }
        catch (_) { toast('Не удалось', 'скопируйте вручную', 'warn'); }
      };
    });

    // Оплата одного счёта — форма п/п.
    document.querySelectorAll('[data-pay]').forEach((btn) => {
      btn.onclick = () => openPayForm(+btn.getAttribute('data-pay'), items.find((x) => x.id === +btn.getAttribute('data-pay')), onDone);
    });
    // «Оплатить все» — по очереди, каждый со своим п/п (требуем ввести один номер? нет:
    // проводим по каждому отдельно, чтобы не было фиктивных оплат).
    const allBtn = document.getElementById('pbuh-all');
    if (allBtn) allBtn.onclick = async () => {
      const ok = confirm(`Оплатить ${payable.length} счетов? Для каждого нужно будет указать № п/п.`);
      if (!ok) return;
      for (const it of payable) openPayForm(it.id, it, onDone);
      toast('По очереди', 'Заполните п/п по каждому счёту', 'info');
    };
  }

  /** Форма оплаты одного счёта: № п/п, дата, комментарий. */
  function openPayForm(payId, pay, onDone) {
    const today = new Date().toISOString().slice(0, 10);
    const html = `<div class="pbuh__form">
      <div class="pbuh__form-head">
        <div class="pbuh__sup">${esc((pay && pay.supplier_name) || '—')}</div>
        <div class="pbuh__sum">${money2(pay && pay.amount)}</div>
      </div>
      <div class="pbuh__frow"><label>№ платёжного поручения</label><input id="pbuh-pp" placeholder="например 1234"></div>
      <div class="pbuh__frow"><label>Дата п/п</label><input id="pbuh-ppd" type="date" value="${today}"></div>
      <div class="pbuh__frow"><label>Комментарий</label><input id="pbuh-cmt" placeholder="необязательно"></div>
      <div class="pbuh__actions">
        <button type="button" class="btn ghost" id="pbuh-cancel">Отмена</button>
        <button type="button" class="btn primary" id="pbuh-confirm">Провести оплату</button>
      </div>
    </div>`;
    showModal({ title: 'Оплата счёта', html });
    document.getElementById('pbuh-cancel').onclick = () => closeModal();
    document.getElementById('pbuh-confirm').onclick = async () => {
      const pp = (document.getElementById('pbuh-pp').value || '').trim();
      const ppd = document.getElementById('pbuh-ppd').value || null;
      const cmt = (document.getElementById('pbuh-cmt').value || '').trim() || null;
      if (!pp) { toast('№ п/п', 'Укажите номер платёжного поручения', 'err'); return; }
      try {
        await api('/api/payment-invoices/' + payId + '/pay-bank', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pp_number: pp, pp_date: ppd, comment: cmt })
        });
        toast('Оплачено', 'Счёт проведён, расход записан', 'ok');
        closeModal();
        if (typeof onDone === 'function') onDone();
      } catch (e) { toast('Ошибка', e.message, 'err'); }
    };
  }

  return { open, openPayForm };
})();
