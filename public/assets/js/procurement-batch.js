/**
 * ASGARD CRM — ПАРТИЯ СЧЕТОВ НА СОГЛАСОВАНИЕ (V411)
 * ═══════════════════════════════════════════════════════════════════════════
 * Заказчик 19.10.2026:
 *   • «если нужно согласовать 10 счетов — 10 заявок или можно 10 разом?»
 *     → ОДНА заявка = партия, директор решает по КАЖДОМУ счёту;
 *   • «онлайн-сканирование: прикладываю счёт и вижу загрузку 0-100%»;
 *   • «во время загрузки видеть, как поля заполняются»;
 *   • «превью недоступно — надо видеть что загрузил и листать между счетами»;
 *   • «поставщик как в реестре (со счётчиками и договорами)»;
 *   • «сумма с НДС/без, основание, договор — как в реестре».
 *
 * Модуль самодостаточный: подключается из procurement-page.js по кнопке
 * «+ Согласовать счёт». Работает поверх существующих API:
 *   POST /api/payment-invoices/upload        — файл
 *   POST /api/payment-invoices               — карточка счёта
 *   POST /api/payment-invoices/:id/recognize — OCR + поля
 *   GET  /api/payment-invoices/preview/:id   — PNG первой страницы
 *   POST /api/payment-invoices/batches       — собрать партию
 *   GET  /api/suppliers/*                    — подсказки как в реестре
 */
window.AsgardPaymentBatch = (function () {
  const UI = window.AsgardUI || {};
  const $ = UI.$ || ((s) => document.querySelector(s));
  const esc = UI.esc || ((s) => String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])));
  const toast = UI.toast || ((t, m) => console.log(t, m));
  const showModal = UI.showModal || (() => {});
  const closeModal = UI.closeModal || (() => {});
  const money = (v) => (window.AsgardMoney && window.AsgardMoney.formatMoney ? window.AsgardMoney.formatMoney(v) : (Number(v || 0)).toLocaleString('ru-RU') + ' ₽');

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

  // ── Состояние партии ────────────────────────────────────────────────────────
  let S = null;

  function newState() {
    return {
      items: [],          // [{ localId, file, invoiceId, status:'upload'|'ocr'|'ready'|'error', progress, fields, error }]
      activeIdx: 0,       // какой счёт показан в превью
      title: '',
      comment: '',
      submitted: false
    };
  }

  // ═══ МОДАЛКА: загрузка партии ═══════════════════════════════════════════════
  async function open() {
    S = newState();
    const html = `
      <div class="pbatch">
        <div class="pbatch__head">
          <div>
            <div class="pbatch__t">Согласование счетов</div>
            <div class="pbatch__s">Загрузите один или несколько счетов — уйдут директору <b>одной заявкой</b>. Он сможет согласовать выборочно.</div>
          </div>
          <div class="pbatch__counter" id="pb-count">0 счетов</div>
        </div>

        <label class="pbatch__drop" id="pb-drop" for="pb-file">
          <input type="file" id="pb-file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp">
          <div class="pbatch__drop-ico">＋</div>
          <div class="pbatch__drop-t">Перетащите счета или нажмите</div>
          <div class="pbatch__drop-s">PDF, PNG, JPG · можно несколько сразу</div>
        </label>

        <div class="pbatch__body">
          <div class="pbatch__list" id="pb-list"></div>
          <div class="pbatch__pane" id="pb-pane">
            <div class="pbatch__pane-empty">
              <div class="pbatch__pane-ico">📄</div>
              <div>Загрузите счёт — здесь появится превью и распознанные поля</div>
            </div>
          </div>
        </div>

        <div class="pbatch__foot">
          <div class="pbatch__total">
            <span>Итого по партии</span>
            <b id="pb-total">0,00 ₽</b>
          </div>
          <div class="pbatch__acts">
            <button type="button" class="btn ghost" id="pb-cancel">Отмена</button>
            <button type="button" class="btn primary" id="pb-submit" disabled>Отправить директору</button>
          </div>
        </div>
      </div>`;
    showModal({ title: 'Новое согласование оплаты', html, wide: true });
    bind();
  }

  function bind() {
    const inp = document.getElementById('pb-file');
    const drop = document.getElementById('pb-drop');
    if (inp) inp.onchange = () => { addFiles([...inp.files]); inp.value = ''; };
    if (drop) {
      ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
      ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
      drop.addEventListener('drop', (e) => { if (e.dataTransfer && e.dataTransfer.files) addFiles([...e.dataTransfer.files]); });
    }
    document.getElementById('pb-cancel').onclick = () => closeModal();
    document.getElementById('pb-submit').onclick = submit;
  }

  function addFiles(files) {
    const ok = files.filter((f) => /pdf|image\//i.test(f.type || '') || /\.(pdf|png|jpe?g|webp)$/i.test(f.name));
    if (!ok.length) { toast('Файлы', 'Нужны PDF или изображения счёта', 'err'); return; }
    for (const f of ok) {
      S.items.push({ localId: 'l' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), file: f, invoiceId: null, status: 'upload', progress: 0, fields: null, error: null });
    }
    if (S.items.length === ok.length) S.activeIdx = 0;
    render();
    // Запускаем загрузку+OCR последовательно (не душим сервер пачкой OCR).
    (async () => {
      for (const it of S.items) {
        if (it.status === 'upload') await processItem(it);
      }
    })();
  }

  /** Загрузка файла → создание карточки → OCR → поля. Прогресс 0..100. */
  async function processItem(it) {
    try {
      it.status = 'upload'; it.progress = 5; render();
      const fd = new FormData();
      fd.append('file', it.file);
      const up = await fetch('/api/payment-invoices/upload', { method: 'POST', headers: hdr(), body: fd });
      const uj = await up.json().catch(() => ({}));
      if (!up.ok) throw new Error(uj.error || 'Не удалось загрузить файл');
      it.progress = 35; render();

      // Создаём карточку счёта: сумма 0, поля заполним после OCR.
      const created = await api('/api/payment-invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: 0,
          supplier_name: 'Распознаётся…',
          file_path: uj.file_path,
          file_name: uj.file_name,
          basis_type: 'other'
        })
      });
      it.invoiceId = created.id;
      it.progress = 55; it.status = 'ocr'; render();

      // OCR + разбор полей (это самый долгий шаг — показываем честно).
      const rec = await api('/api/payment-invoices/' + created.id + '/recognize', { method: 'POST' });
      it.fields = rec.fields || {};
      it.engine = rec.engine;
      it.confidence = rec.confidence;
      it.progress = 100; it.status = 'ready';
      render();
    } catch (e) {
      it.status = 'error'; it.error = e.message; it.progress = 100; render();
    }
  }

  function readyItems() { return S.items.filter((x) => x.status === 'ready' && x.invoiceId); }
  function totalSum() { return readyItems().reduce((s, x) => s + Number((x.fields && x.fields.amount) || 0), 0); }

  // ── Рендер ────────────────────────────────────────────────────────────────
  function render() {
    const list = document.getElementById('pb-list');
    const pane = document.getElementById('pb-pane');
    const cnt = document.getElementById('pb-count');
    const tot = document.getElementById('pb-total');
    const submit = document.getElementById('pb-submit');
    if (!list) return;

    if (cnt) cnt.textContent = S.items.length === 1 ? '1 счёт' : S.items.length + ' счетов';
    if (tot) tot.textContent = money2(totalSum());
    if (submit) submit.disabled = !readyItems().length;

    if (!S.items.length) {
      list.innerHTML = '<div class="pbatch__list-empty">Счетов пока нет</div>';
      pane.innerHTML = `<div class="pbatch__pane-empty"><div class="pbatch__pane-ico">📄</div><div>Загрузите счёт — здесь появится превью и распознанные поля</div></div>`;
      return;
    }

    const statusLabel = { upload: 'Загрузка', ocr: 'Распознавание', ready: 'Готов', error: 'Ошибка' };
    list.innerHTML = S.items.map((it, i) => {
      const f = it.fields || {};
      const sum = f.amount ? money2(f.amount) : '—';
      const sup = f.supplier_name || (it.status === 'ready' ? 'не распознан' : '—');
      return `<button type="button" class="pbatch__item ${i === S.activeIdx ? 'is-active' : ''} pbatch__item--${it.status}" data-idx="${i}">
        <div class="pbatch__item-top">
          <span class="pbatch__item-n">Счёт ${i + 1}</span>
          <span class="pbatch__item-st pbatch__item-st--${it.status}">${statusLabel[it.status] || it.status}</span>
        </div>
        <div class="pbatch__item-sup">${esc(sup)}</div>
        <div class="pbatch__item-row"><span>${esc(f.invoice_number || 'б/н')}</span><b>${sum}</b></div>
        ${it.status !== 'ready' ? `<div class="pbatch__bar"><i style="width:${it.progress}%"></i></div>` : ''}
        ${it.error ? `<div class="pbatch__item-err">${esc(it.error)}</div>` : ''}
      </button>`;
    }).join('');

    list.querySelectorAll('[data-idx]').forEach((b) => {
      b.onclick = () => { S.activeIdx = +b.getAttribute('data-idx'); render(); };
    });

    renderPane(pane);
  }

  function renderPane(pane) {
    const it = S.items[S.activeIdx];
    if (!it) return;
    if (it.status === 'upload' || it.status === 'ocr') {
      const stage = it.status === 'upload' ? 'Загружаем файл' : 'Распознаём счёт';
      pane.innerHTML = `<div class="pbatch__pane-load">
        <div class="pbatch__spin"></div>
        <div class="pbatch__pane-load-t">${stage}…</div>
        <div class="pbatch__bar pbatch__bar--big"><i style="width:${it.progress}%"></i></div>
        <div class="pbatch__pane-load-s">${it.progress}%</div>
      </div>`;
      return;
    }
    if (it.status === 'error') {
      pane.innerHTML = `<div class="pbatch__pane-err">
        <div class="pbatch__pane-ico">⚠️</div>
        <div class="pbatch__pane-load-t">Не удалось обработать</div>
        <div class="pbatch__pane-load-s">${esc(it.error || '')}</div>
        <button type="button" class="btn ghost" data-retry="${S.activeIdx}">Загрузить заново</button>
      </div>`;
      pane.querySelector('[data-retry]')?.addEventListener('click', async () => {
        const idx = +pane.querySelector('[data-retry]').getAttribute('data-retry');
        const item = S.items[idx];
        if (item.invoiceId) { try { await api('/api/payment-invoices/' + item.invoiceId, { method: 'DELETE' }); } catch (_) {} }
        Object.assign(item, { invoiceId: null, status: 'upload', progress: 0, fields: null, error: null });
        render();
        processItem(item);
      });
      return;
    }
    // ready — превью + поля
    const f = it.fields || {};
    const conf = Math.round((it.confidence || 0) * 100);
    pane.innerHTML = `
      <div class="pbatch__preview">
        <img src="/api/payment-invoices/${it.invoiceId}/preview" alt="Превью счёта" loading="lazy"
             onerror="this.parentElement.innerHTML='<div class=pbatch__prev-err>Превью недоступно<br><a href=\\'/api/payment-invoices/${it.invoiceId}/file\\' target=_blank>Открыть оригинал</a></div>'">
        <div class="pbatch__prev-nav">
          <button type="button" class="pbatch__prev-btn" data-nav="-1" ${S.activeIdx === 0 ? 'disabled' : ''}>‹ Пред.</button>
          <span>${S.activeIdx + 1} из ${S.items.length}</span>
          <button type="button" class="pbatch__prev-btn" data-nav="1" ${S.activeIdx >= S.items.length - 1 ? 'disabled' : ''}>След. ›</button>
        </div>
      </div>
      <div class="pbatch__fields">
        <div class="pbatch__fields-head">
          <span class="pbatch__fields-t">Данные счёта</span>
          <span class="pbatch__conf ${conf >= 70 ? 'is-ok' : 'is-warn'}">распознано ${conf}%${it.engine === 'ai' ? ' · ИИ' : ''}</span>
        </div>
        ${fieldRow(it, 'Поставщик', 'supplier_name', f.supplier_name, 'text')}
        ${fieldRow(it, 'Номер счёта', 'invoice_number', f.invoice_number, 'text')}
        ${fieldRow(it, 'Дата счёта', 'invoice_date', f.invoice_date, 'date')}
        ${fieldRow(it, 'Срок оплаты', 'payment_due_at', f.payment_due_at, 'date')}
        <div class="pbatch__frow">
          <label>Сумма, ₽</label>
          <input type="number" step="0.01" min="0" data-f="amount" value="${f.amount != null ? f.amount : ''}">
        </div>
        <div class="pbatch__frow pbatch__frow--vat">
          <label>НДС</label>
          <input type="number" step="0.01" min="0" data-f="vat_amount" value="${f.vat_amount != null ? f.vat_amount : ''}" placeholder="0">
          <span class="pbatch__vat-hint">${f.has_vat ? 'с НДС' : 'без НДС'}</span>
        </div>
        <div class="pbatch__frow">
          <label>Договор-основание</label>
          <input type="text" data-f="contract_number" value="${esc(f.contract_number || '')}" placeholder="например ДП-2025/01">
        </div>
        <div class="pbatch__hint">Все поля можно поправить руками — директор увидит вашу версию.</div>
        <div class="pbatch__fields-acts">
          <button type="button" class="btn ghost" data-rerun="${S.activeIdx}">Распознать заново</button>
          <button type="button" class="btn ghost" data-remove="${S.activeIdx}">Удалить счёт</button>
        </div>
      </div>`;

    pane.querySelectorAll('[data-nav]').forEach((b) => {
      b.onclick = () => {
        const d = +b.getAttribute('data-nav');
        const next = S.activeIdx + d;
        if (next >= 0 && next < S.items.length) { S.activeIdx = next; render(); }
      };
    });
    // Правка полей → сразу в состояние (и сохраняем на сервер при отправке)
    pane.querySelectorAll('[data-f]').forEach((inp) => {
      inp.onchange = () => {
        const k = inp.getAttribute('data-f');
        if (!it.fields) it.fields = {};
        it.fields[k] = inp.type === 'number' ? (parseFloat(inp.value) || 0) : inp.value;
        render();
      };
    });
    pane.querySelector('[data-remove]')?.addEventListener('click', async () => {
      const idx = +pane.querySelector('[data-remove]').getAttribute('data-remove');
      const item = S.items[idx];
      if (item.invoiceId) { try { await api('/api/payment-invoices/' + item.invoiceId, { method: 'DELETE' }); } catch (_) {} }
      S.items.splice(idx, 1);
      if (S.activeIdx >= S.items.length) S.activeIdx = Math.max(0, S.items.length - 1);
      render();
    });
    pane.querySelector('[data-rerun]')?.addEventListener('click', async () => {
      const idx = +pane.querySelector('[data-rerun]').getAttribute('data-rerun');
      const item = S.items[idx];
      if (!item.invoiceId) return;
      item.status = 'ocr'; item.progress = 55; render();
      try {
        const rec = await api('/api/payment-invoices/' + item.invoiceId + '/recognize', { method: 'POST' });
        item.fields = rec.fields || {}; item.engine = rec.engine; item.confidence = rec.confidence;
        item.status = 'ready'; item.progress = 100;
      } catch (e) { item.status = 'error'; item.error = e.message; }
      render();
    });
  }

  function fieldRow(it, label, key, val, type) {
    return `<div class="pbatch__frow">
      <label>${label}</label>
      <input type="${type}" data-f="${key}" value="${type === 'date' ? esc(String(val || '').slice(0, 10)) : esc(val || '')}">
    </div>`;
  }

  // ── Отправка партии ───────────────────────────────────────────────────────
  async function submit() {
    const ready = readyItems();
    if (!ready.length) { toast('Пусто', 'Нет готовых счетов', 'err'); return; }
    const btn = document.getElementById('pb-submit');
    if (btn) { btn.disabled = true; btn.textContent = 'Отправляем…'; }
    try {
      // 1) Сохраняем правки человека в каждый счёт.
      for (const it of ready) {
        const f = it.fields || {};
        await api('/api/payment-invoices/' + it.invoiceId, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: Number(f.amount) || 0,
            supplier_name: f.supplier_name || null,
            invoice_number: f.invoice_number || null,
            invoice_date: f.invoice_date || null,
            due_date: f.payment_due_at || null,
            vat_amount: f.vat_amount != null ? f.vat_amount : null,
            contract_basis_number: f.contract_number || null
          })
        }).catch(() => {});
      }
      // 2) Собираем партию одним запросом.
      const ids = ready.map((x) => x.invoiceId);
      const res = await api('/api/payment-invoices/batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_ids: ids, title: S.title || null, comment_text: S.comment || null })
      });
      toast('Отправлено', `${ids.length} ${ids.length === 1 ? 'счёт' : 'счетов'} у директора — заявка №${res.batch.id}`, 'ok');
      closeModal();
      if (window.AsgardProcurementPage && window.AsgardProcurementPage.reload) {
        try { window.AsgardProcurementPage.reload(); } catch (_) {}
      }
    } catch (e) {
      toast('Ошибка', e.message, 'err');
      if (btn) { btn.disabled = false; btn.textContent = 'Отправить директору'; }
    }
  }

  return { open, newState };
})();
