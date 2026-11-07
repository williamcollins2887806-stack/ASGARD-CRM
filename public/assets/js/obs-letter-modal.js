'use strict';

/**
 * public/assets/js/obs-letter-modal.js
 *
 * V473: модалка «Письмо для оплаты через ОБС».
 *
 * ЗАЧЕМ. До этого письмо создавалось одной кнопкой: сразу брались данные из
 * строки реестра, сразу генерировался PDF и сразу расходовался исходящий
 * номер. Если в счёте не распознались номер, дата или сумма — исправить было
 * нечем, а номер уже «съеден». Инициатор (Д. Путков) вовсе не видел кнопку:
 * контур меняла только бухгалтерия.
 *
 * ЧТО ЗДЕСЬ. Окно, которое повторяет путь человека:
 *   1. что оплачиваем — данные из карточки или свои («счёт такой, дата такая»);
 *   2. через какой ОБС-счёт платим (справочник) и по какому договору;
 *   3. реквизиты счёта (номер, дата, сумма, НДС);
 *   4. перечень услуг;
 *   5. предпросмотр — PDF собирается на сервере, но НИЧЕГО не пишет в БД и
 *      не тратит номер;
 *   6. сохранить — одна транзакция: номер, PDF+Word, переписка, вложение,
 *      строка письма и ссылка в счёте.
 *
 * Зависимости: window.AsgardUI (toast, esc, money) — если есть; иначе
 * локальные заглушки. Никаких прямых обращений к DOM вне своего корня.
 */
window.AsgardObsLetterModal = (function () {
  const API = '/api/doc-registry';

  let state = null;   // { docId, opts, defaults, obsAccounts, subcontracts, dirty, previewed, previewUrl }

  function esc(s) {
    if (window.AsgardUI && AsgardUI.esc) return AsgardUI.esc(s);
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function money(n, frac) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '0';
    const digits = frac === undefined ? (Math.abs(v % 1) > 1e-9 ? 2 : 0) : frac;
    return v.toLocaleString('ru-RU', {
      minimumFractionDigits: digits, maximumFractionDigits: digits,
    });
  }
  function toast(t, m, k) {
    if (window.AsgardUI && AsgardUI.toast) AsgardUI.toast(t, m, k);
    else if (k === 'err') console.error('[obs]', t, m);
    else console.log('[obs]', t, m);
  }
  function token() {
    return (window.AsgardAuth && AsgardAuth.token) || localStorage.getItem('asgard_token');
  }
  function role() {
    try { return JSON.parse(localStorage.getItem('asgard_user') || '{}').role || ''; }
    catch (_) { return ''; }
  }
  function isAdmin() { return role() === 'ADMIN'; }

  async function apiJson(path, opts = {}) {
    const r = await fetch(API + path, {
      ...opts,
      headers: { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' },
      cache: 'no-store',
    });
    const text = await r.text();
    let j = null;
    try { j = text ? JSON.parse(text) : null; } catch (_) { j = { raw: text }; }
    if (!r.ok) {
      const e = new Error((j && (j.error || j.message)) || ('HTTP ' + r.status));
      e.status = r.status;
      e.body = j;
      throw e;
    }
    return j;
  }

  function fmtDate(d) {
    const s = String(d || '').slice(0, 10);
    const [y, m, day] = s.split('-');
    return y && m && day ? `${day}.${m}.${y}` : '';
  }

  // ─── Разметка ───────────────────────────────────────────────────────────
  function shellHtml() {
    return `
<div class="dh-modal dh-obs-modal" id="dhObsModal" hidden>
  <div class="dh-modal__card dh-obs-card" role="dialog" aria-modal="true"
       aria-labelledby="dhObsTitle">
    <header class="dh-modal__head dh-obs-head">
      <div>
        <h3 id="dhObsTitle">Письмо для оплаты через ОБС</h3>
        <p class="dh-modal__sub" id="dhObsSub">Проверьте данные, посмотрите предпросмотр и сохраните</p>
      </div>
      <button type="button" class="dh-modal__x" id="dhObsX" aria-label="Закрыть">✕</button>
    </header>

    <div class="dh-obs-body" id="dhObsBody">
      <!-- левая колонка: форма -->
      <div class="dh-obs-form" id="dhObsForm">

        <section class="dh-obs-sec">
          <div class="dh-obs-sec__h">1. Что оплачиваем</div>
          <label class="dh-obs-check">
            <input type="checkbox" id="dhObsFromCard" checked />
            <span>Взять данные из карточки счёта</span>
          </label>
          <div class="dh-obs-hint" id="dhObsCardHint"></div>
          <div class="dh-obs-warn" id="dhObsClosedWarn" hidden>
            Счёт уже закрыт — письмо создаётся для подшивки.
          </div>
        </section>

        <section class="dh-obs-sec">
          <div class="dh-obs-sec__h">2. ОБС и договор</div>
          <div class="dh-field">
            <label>ОБС-счёт <span class="dh-field__hint">куда платим</span></label>
            <div class="dh-obs-row">
              <select id="dhObsAccount"></select>
              <button type="button" class="dh-btn dh-btn--ghost dh-obs-add" id="dhObsAccountAdd"
                      title="Добавить ОБС-счёт в справочник" hidden>+ ОБС</button>
            </div>
            <div class="dh-obs-hint" id="dhObsAccountInfo"></div>
          </div>
          <div class="dh-field">
            <label>Договор субподряда <span class="dh-field__hint">основание и лимит</span></label>
            <select id="dhObsSub"></select>
            <div class="dh-obs-hint" id="dhObsSubInfo"></div>
          </div>
        </section>

        <section class="dh-obs-sec">
          <div class="dh-obs-sec__h">3. Реквизиты счёта</div>
          <div class="dh-obs-grid2">
            <div class="dh-field">
              <label>Номер счёта</label>
              <input id="dhObsInvNo" autocomplete="off" placeholder="например V052717397" />
            </div>
            <div class="dh-field">
              <label>Дата счёта</label>
              <input type="date" id="dhObsInvDate" />
            </div>
          </div>
          <div class="dh-obs-grid2">
            <div class="dh-field">
              <label>Сумма с НДС</label>
              <input id="dhObsGross" inputmode="decimal" autocomplete="off" />
            </div>
            <div class="dh-field">
              <label>Ставка НДС, %</label>
              <select id="dhObsVatRate">
                <option value="0">без НДС</option>
                <option value="5">5%</option>
                <option value="7">7%</option>
                <option value="10">10%</option>
                <option value="20">20%</option>
                <option value="22">22%</option>
              </select>
            </div>
          </div>
          <div class="dh-obs-grid2">
            <div class="dh-field">
              <label>В том числе НДС</label>
              <input id="dhObsVat" inputmode="decimal" autocomplete="off" />
            </div>
            <div class="dh-field">
              <label>Сумма без НДС</label>
              <input id="dhObsNet" readonly tabindex="-1" />
            </div>
          </div>
          <div class="dh-field">
            <label>Контрагент</label>
            <input id="dhObsCp" autocomplete="off" />
          </div>
        </section>

        <section class="dh-obs-sec">
          <div class="dh-obs-sec__h">
            4. Перечень услуг
            <button type="button" class="dh-btn dh-btn--ghost dh-obs-mini" id="dhObsItemsFromCard">
              Подставить из счёта
            </button>
          </div>
          <div class="dh-field">
            <textarea id="dhObsItems" rows="5"
              placeholder="Одна позиция — одна строка"></textarea>
          </div>
          <div class="dh-obs-hint" id="dhObsItemsHint"></div>
        </section>

        <section class="dh-obs-sec">
          <div class="dh-obs-sec__h">5. Письмо</div>
          <div class="dh-field">
            <label>Дата письма</label>
            <input type="date" id="dhObsLetterDate" />
          </div>
          <div class="dh-obs-hint">
            Исходящий номер выдаётся при сохранении (сквозная нумерация переписки).
            Предпросмотр номер не расходует.
          </div>
        </section>
      </div>

      <!-- правая колонка: предпросмотр -->
      <div class="dh-obs-preview" id="dhObsPreviewPane">
        <div class="dh-obs-preview__empty" id="dhObsPreviewEmpty">
          <div class="dh-obs-preview__ico">PDF</div>
          <div>Нажмите «Предпросмотр», чтобы увидеть письмо</div>
          <div class="dh-obs-hint">Номер исходящего при этом не тратится</div>
        </div>
        <iframe id="dhObsPreviewFrame" class="dh-obs-frame" hidden title="Предпросмотр письма"></iframe>
        <div class="dh-obs-preview__stale" id="dhObsStale" hidden>
          Есть несохранённые изменения — обновите предпросмотр.
        </div>
      </div>
    </div>

    <footer class="dh-modal__foot dh-obs-foot">
      <div class="dh-obs-foot__left" id="dhObsFootLeft"></div>
      <div class="dh-obs-foot__right">
        <button type="button" class="dh-btn dh-btn--ghost" id="dhObsCancel">Отмена</button>
        <button type="button" class="dh-btn dh-btn--ghost" id="dhObsDlPdf" disabled>Скачать PDF</button>
        <button type="button" class="dh-btn dh-btn--ghost" id="dhObsDlDocx" disabled>Скачать Word</button>
        <button type="button" class="dh-btn dh-btn--ghost" id="dhObsPreviewBtn">Предпросмотр</button>
        <button type="button" class="dh-btn dh-btn--primary" id="dhObsSave" disabled>Сохранить</button>
      </div>
    </footer>
  </div>
</div>`;
  }

  // ─── Форма ──────────────────────────────────────────────────────────────
  function el(id) { return document.getElementById(id); }

  function fillAccounts(list, selectedId) {
    const sel = el('dhObsAccount');
    if (!sel) return;
    const opts = ['<option value="">— не выбран —</option>'];
    (list || []).forEach((a) => {
      const tail = [
        a.bank_account ? 'р/с ' + a.bank_account : '',
        a.bank_bik ? 'БИК ' + a.bank_bik : '',
      ].filter(Boolean).join(' · ');
      opts.push(`<option value="${a.id}" ${Number(a.id) === Number(selectedId) ? 'selected' : ''}>`
        + `${esc(a.name)}${tail ? ' · ' + esc(tail) : ''}</option>`);
    });
    sel.innerHTML = opts.join('');
  }

  function fillSubcontracts(list, selectedId, amount) {
    const sel = el('dhObsSub');
    if (!sel) return;
    const opts = ['<option value="">— без договора —</option>'];
    (list || []).forEach((s) => {
      const rem = Number(s.remaining) || 0;
      const lim = Number(s.limit_amount) || 0;
      const covers = amount > 0 ? rem >= amount : true;
      const label = `${s.number} от ${fmtDate(s.agreement_date)} · `
        + (covers
          ? `остаток ${money(rem)} из ${money(lim)} · ${Number(s.used_pct || 0).toFixed(1)}%`
          : `не хватает: остаток ${money(rem)}, счёт ${money(amount)}`);
      opts.push(`<option value="${s.id}" ${Number(s.id) === Number(selectedId) ? 'selected' : ''}>`
        + `${esc(label)}</option>`);
    });
    sel.innerHTML = opts.join('');
  }

  function updateAccountInfo() {
    const sel = el('dhObsAccount');
    const box = el('dhObsAccountInfo');
    if (!sel || !box) return;
    const id = Number(sel.value) || 0;
    const a = (state.obsAccounts || []).find((x) => Number(x.id) === id);
    if (!a) { box.textContent = ''; return; }
    const parts = [];
    if (a.customer_name) parts.push('заказчик ' + a.customer_name);
    if (a.object_name) parts.push('объект ' + a.object_name);
    if (!a.bank_account) parts.push('банковские реквизиты не заполнены — допишет админ в справочнике');
    box.textContent = parts.join(' · ');
  }

  function updateSubInfo() {
    const sel = el('dhObsSub');
    const box = el('dhObsSubInfo');
    if (!sel || !box) return;
    const id = Number(sel.value) || 0;
    const s = (state.subcontracts || []).find((x) => Number(x.id) === id);
    const amount = parseNum(el('dhObsGross') && el('dhObsGross').value);
    if (!s) { box.textContent = 'Договор не выбран — лимит не считается.'; return; }
    const rem = Number(s.remaining) || 0;
    if (amount > 0 && rem < amount) {
      box.innerHTML = `<span class="dh-obs-bad">Лимита не хватает: остаток ${money(rem)}, `
        + `недостаёт ${money(amount - rem)} ₽. Письмо не сохранится.</span>`;
    } else {
      box.textContent = `Остаток после этого счёта: ${money(rem - amount)} из ${money(s.limit_amount)}.`;
    }
  }

  function parseNum(v) {
    const s = String(v == null ? '' : v).replace(/\s+/g, '').replace(',', '.');
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  function recalcVat() {
    const gross = parseNum(el('dhObsGross').value);
    const rate = Number(el('dhObsVatRate').value) || 0;
    const vatInput = el('dhObsVat');
    if (document.activeElement !== vatInput) {
      // НДС «в том числе»: gross * rate / (100 + rate).
      vatInput.value = rate > 0 ? (Math.round(gross * rate / (100 + rate) * 100) / 100).toFixed(2) : '0.00';
    }
    const vat = parseNum(vatInput.value);
    el('dhObsNet').value = (Math.round((gross - vat) * 100) / 100).toFixed(2);
    updateSubInfo();
  }

  function updateItemsHint() {
    const lines = itemsFromTextarea();
    const hint = el('dhObsItemsHint');
    if (!hint) return;
    if (lines.length > 28) {
      hint.textContent = `Позиций ${lines.length}: в письмо попадёт 20 и строка «и ещё ${lines.length - 20} позиций» — полный перечень в счёте.`;
    } else {
      hint.textContent = lines.length ? `Позиций: ${lines.length}` : 'Позиций нет — в письме будет строка «по счёту № …».';
    }
  }

  function itemsFromTextarea() {
    return String((el('dhObsItems') && el('dhObsItems').value) || '')
      .split('\n').map((s) => s.trim()).filter(Boolean);
  }

  function setItems(items) {
    el('dhObsItems').value = (items || []).join('\n');
    updateItemsHint();
  }

  function markDirty() {
    if (!state) return;
    state.dirty = true;
    state.previewed = false;
    // FAIL верификатора 07.11.2026: после успешного save мы оставляли
    // `state.saved = res`, и правки, сделанные ПОСЛЕ сохранения, при закрытии
    // терялись молча: `close()` видел `saved` и не спрашивал подтверждения.
    // Новая правка означает, что сохранённое состояние устарело.
    state.saved = null;
    const stale = el('dhObsStale');
    if (stale) stale.hidden = !el('dhObsPreviewFrame') || el('dhObsPreviewFrame').hidden;
    const save = el('dhObsSave');
    if (save) save.disabled = true;
    const dl1 = el('dhObsDlPdf');
    const dl2 = el('dhObsDlDocx');
    if (dl1) dl1.disabled = true;
    if (dl2) dl2.disabled = true;
  }

  function collectPayload() {
    const fromCard = !!el('dhObsFromCard').checked;
    const payload = {
      invoice_number: el('dhObsInvNo').value.trim(),
      invoice_date: el('dhObsInvDate').value || null,
      amount_gross: parseNum(el('dhObsGross').value),
      vat_rate: Number(el('dhObsVatRate').value) || 0,
      vat_amount: parseNum(el('dhObsVat').value),
      counterparty_name: el('dhObsCp').value.trim(),
      items: itemsFromTextarea(),
      letter_date: el('dhObsLetterDate').value || null,
      payment_source: 'obs',
    };
    const acc = Number(el('dhObsAccount').value) || 0;
    if (acc) payload.obs_account_id = acc;
    const sub = Number(el('dhObsSub').value) || 0;
    if (sub) payload.subcontract_id = sub;
    else if (el('dhObsSub').value === '') payload.subcontract_id = '';
    if (fromCard) payload.from_card = true;
    return payload;
  }

  // ─── Предпросмотр и скачивание ──────────────────────────────────────────
  async function fetchPreviewBlob(format) {
    const r = await fetch(
      `${API}/${state.docId}/obs-letter/preview?format=${format === 'docx' ? 'docx' : 'pdf'}`,
      {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' },
        body: JSON.stringify(collectPayload()),
        cache: 'no-store',
      }
    );
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || ('HTTP ' + r.status));
    }
    return r.blob();
  }

  async function doPreview() {
    const btn = el('dhObsPreviewBtn');
    btn.disabled = true;
    const prev = btn.textContent;
    btn.textContent = 'Собираю…';
    try {
      const blob = await fetchPreviewBlob('pdf');
      if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
      state.previewUrl = URL.createObjectURL(blob);
      const frame = el('dhObsPreviewFrame');
      frame.src = state.previewUrl;
      frame.hidden = false;
      el('dhObsPreviewEmpty').hidden = true;
      el('dhObsStale').hidden = true;
      state.previewed = true;
      // D-397b (замечание верификатора 07.11.2026): здесь стоял сброс
      // `state.dirty = false` при `state.saved = null`. Предпросмотр — это НЕ
      // сохранение: если человек после него закроет окно, введённые данные
      // пропадали без вопроса. Флаг «есть несохранённые правки» держим до
      // фактического save.
      el('dhObsSave').disabled = false;
      el('dhObsDlPdf').disabled = false;
      el('dhObsDlDocx').disabled = false;
    } catch (e) {
      toast('Предпросмотр не собрался', e.message || 'ошибка', 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = prev;
    }
  }

  async function download(format) {
    try {
      const blob = await fetchPreviewBlob(format);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `Письмо ОБС${format === 'docx' ? '.docx' : '.pdf'}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      toast('Скачано', a.download, 'ok');
    } catch (e) {
      toast('Не удалось скачать', e.message || 'ошибка', 'err');
    }
  }

  async function save() {
    const btn = el('dhObsSave');
    btn.disabled = true;
    const prev = btn.textContent;
    btn.textContent = 'Сохраняю…';
    try {
      const res = await apiJson(`/${state.docId}/obs-letter`, {
        method: 'POST',
        body: JSON.stringify(collectPayload()),
      });
      const left = el('dhObsFootLeft');
      left.innerHTML = `<span class="dh-obs-ok">Письмо Исх. № ${esc(res.number || '')} создано. `
        + `Приложено к счёту и в переписку.</span>`;
      btn.textContent = 'Готово';
      state.dirty = false;
      state.saved = res;
      toast('Письмо создано', 'Исх. № ' + (res.number || ''), 'ok');
      if (typeof state.opts.onSaved === 'function') {
        try { await state.opts.onSaved(res); } catch (_) { /* не критично */ }
      }
      // После сохранения оставляем окно открытым: человек видит номер и
      // может скачать файл. Закрытие — осознанное действие.
      el('dhObsCancel').textContent = 'Закрыть';
    } catch (e) {
      btn.disabled = false;
      btn.textContent = prev;
      const body = e.body || {};
      if (e.status === 409 && body.limit) {
        toast('Лимит договора', e.message, 'err');
      } else {
        toast('Не удалось сохранить', e.message || 'ошибка', 'err');
      }
    }
  }

  // ─── Открытие/закрытие ──────────────────────────────────────────────────
  function ensureMounted() {
    let root = document.getElementById('dhObsModal');
    if (root) return root;
    const host = document.createElement('div');
    host.innerHTML = shellHtml();
    root = host.firstElementChild;
    document.body.appendChild(root);
    bind(root);
    return root;
  }

  function bind(root) {
    el('dhObsX').onclick = close;
    el('dhObsCancel').onclick = close;
    root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });
    document.addEventListener('keydown', onKey);

    el('dhObsPreviewBtn').onclick = doPreview;
    el('dhObsSave').onclick = save;
    el('dhObsDlPdf').onclick = () => download('pdf');
    el('dhObsDlDocx').onclick = () => download('docx');
    el('dhObsItemsFromCard').onclick = () => {
      setItems((state.defaults && state.defaults.items) || []);
      markDirty();
    };
    el('dhObsFromCard').onchange = () => {
      applyDefaults(!!el('dhObsFromCard').checked);
      markDirty();
    };
    ['dhObsInvNo', 'dhObsInvDate', 'dhObsGross', 'dhObsVatRate', 'dhObsVat',
      'dhObsCp', 'dhObsItems', 'dhObsLetterDate', 'dhObsSub', 'dhObsAccount']
      .forEach((id) => {
        const node = el(id);
        if (!node) return;
        node.addEventListener('input', () => {
          if (id === 'dhObsGross' || id === 'dhObsVatRate') recalcVat();
          if (id === 'dhObsItems') updateItemsHint();
          if (id === 'dhObsSub') updateSubInfo();
          if (id === 'dhObsAccount') updateAccountInfo();
          markDirty();
        });
        node.addEventListener('change', () => {
          if (id === 'dhObsGross' || id === 'dhObsVatRate') recalcVat();
          if (id === 'dhObsItems') updateItemsHint();
          if (id === 'dhObsSub') updateSubInfo();
          if (id === 'dhObsAccount') updateAccountInfo();
          markDirty();
        });
      });
    el('dhObsAccountAdd').onclick = addAccount;
  }

  function onKey(e) {
    if (!state) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  }

  function applyDefaults(on) {
    const d = state.defaults || {};
    if (on) {
      el('dhObsInvNo').value = d.invoice_number || '';
      el('dhObsInvDate').value = d.invoice_date || '';
      el('dhObsGross').value = d.amount_gross != null ? String(d.amount_gross) : '';
      el('dhObsVat').value = d.vat_amount != null ? String(d.vat_amount) : '0.00';
      el('dhObsCp').value = d.counterparty_name || '';
      const rate = Number(d.vat_rate) || 0;
      const sel = el('dhObsVatRate');
      const pct = rate > 1 ? rate : rate * 100;
      const has = Array.from(sel.options).some((o) => Number(o.value) === Math.round(pct));
      sel.value = has ? String(Math.round(pct)) : '0';
      setItems(d.items || []);
    }
    recalcVat();
  }

  async function addAccount() {
    const name = window.prompt('Название ОБС-счёта (например «ОБС «АГПЗ»»)');
    if (!name) return;
    const bank = window.prompt('Банк (можно пропустить)') || '';
    const rs = window.prompt('Расчётный счёт (можно пропустить)') || '';
    const bik = window.prompt('БИК (можно пропустить)') || '';
    try {
      const res = await apiJson('/obs-accounts', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(), bank_name: bank || null,
          bank_account: rs || null, bank_bik: bik || null,
        }),
      });
      state.obsAccounts = (state.obsAccounts || []).concat([res.item]);
      fillAccounts(state.obsAccounts, res.item.id);
      updateAccountInfo();
      markDirty();
      toast('ОБС добавлен', res.item.name, 'ok');
    } catch (e) {
      toast('Не удалось добавить ОБС', e.message || 'ошибка', 'err');
    }
  }

  function close() {
    if (!state) return;
    if (state.dirty && !state.saved) {
      if (!window.confirm('Выйти без сохранения? Введённые данные будут потеряны.')) return;
    }
    const root = document.getElementById('dhObsModal');
    if (root) root.hidden = true;
    if (state.previewUrl) {
      try { URL.revokeObjectURL(state.previewUrl); } catch (_) { /* */ }
    }
    document.removeEventListener('keydown', onKey);
    const onClosed = state.opts && state.opts.onClosed;
    state = null;
    if (typeof onClosed === 'function') { try { onClosed(); } catch (_) { /* */ } }
  }

  /**
   * Открыть модалку для строки реестра.
   *
   * @param {number} docId
   * @param {{onSaved?:Function, onClosed?:Function}} [opts]
   */
  async function open(docId, opts = {}) {
    const root = ensureMounted();
    root.hidden = false;
    // Если окно закрывали — обработчик keydown снят, ставим снова.
    document.removeEventListener('keydown', onKey);
    document.addEventListener('keydown', onKey);

    state = {
      docId: Number(docId),
      opts: opts || {},
      defaults: {},
      obsAccounts: [],
      subcontracts: [],
      dirty: false,
      previewed: false,
      previewUrl: null,
      saved: null,
    };

    el('dhObsFootLeft').innerHTML = '';
    el('dhObsCancel').textContent = 'Отмена';
    el('dhObsPreviewFrame').hidden = true;
    el('dhObsPreviewEmpty').hidden = false;
    el('dhObsStale').hidden = true;
    el('dhObsSave').disabled = true;
    el('dhObsDlPdf').disabled = true;
    el('dhObsDlDocx').disabled = true;
    el('dhObsSave').textContent = 'Сохранить';
    el('dhObsAccountAdd').hidden = !isAdmin();

    try {
      const opt = await apiJson(`/${docId}/obs-options`);
      if (!state) return;   // окно закрыли, пока грузили
      state.defaults = opt.defaults || {};
      state.obsAccounts = opt.obs_accounts || [];
      state.subcontracts = opt.subcontracts || [];

      el('dhObsCardHint').textContent = [
        opt.invoice_number ? 'Счёт № ' + opt.invoice_number : 'Номер счёта не распознан',
        state.defaults.invoice_date ? 'от ' + fmtDate(state.defaults.invoice_date) : '',
        opt.amount_gross ? money(opt.amount_gross) + ' ₽' : '',
      ].filter(Boolean).join(' · ');
      el('dhObsSub').innerHTML = '';
      el('dhObsSub').value = '';
      el('dhObsSub').value = String(opt.subcontract_id || '');
      el('dhObsAccount').innerHTML = '';
      el('dhObsAccount').value = '';
      el('dhObsAccount').value = String(opt.obs_account_id || '');

      fillAccounts(state.obsAccounts, opt.obs_account_id);
      fillSubcontracts(state.subcontracts, opt.subcontract_id, Number(opt.amount_gross) || 0);
      el('dhObsLetterDate').value = state.defaults.letter_date || new Date().toISOString().slice(0, 10);
      applyDefaults(true);
      updateAccountInfo();
      updateSubInfo();
      updateItemsHint();

      if (!opt.can_create_letter) {
        el('dhObsFootLeft').innerHTML = '<span class="dh-obs-bad">Нет права создавать письмо по этому счёту.</span>';
        el('dhObsPreviewBtn').disabled = true;
      } else {
        el('dhObsPreviewBtn').disabled = false;
      }
    } catch (e) {
      toast('Не удалось открыть письмо', e.message || 'ошибка', 'err');
      close();
    }
  }

  return { open, close };
})();
