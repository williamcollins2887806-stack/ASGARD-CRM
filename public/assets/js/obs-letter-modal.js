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
        <p class="dh-modal__sub" id="dhObsSubtitle">Проверьте данные, посмотрите предпросмотр и сохраните</p>
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
          <div class="dh-obs-sec__h">Основание и доля оплаты</div>
          <div class="dh-obs-preflight" id="dhObsPreflight" hidden></div>
          <div class="dh-field">
            <label>Контекст работ <span class="dh-field__hint">первый абзац письма</span></label>
            <textarea id="dhObsWorkCtx" rows="3"
              placeholder="выполняет работы по…"></textarea>
          </div>
          <div class="dh-field">
            <label>Сторона договора субподряда</label>
            <div class="dh-obs-row">
              <select id="dhObsSubParty">
                <option value="ООО «ГСП Ремонт»">ООО «ГСП Ремонт»</option>
                <option value="__custom__">Другое…</option>
              </select>
              <input id="dhObsSubPartyCustom" placeholder="наименование" hidden autocomplete="off" />
            </div>
          </div>
          <div class="dh-obs-grid2">
            <div class="dh-field">
              <label>Доля оплаты, %</label>
              <input id="dhObsPayPct" inputmode="decimal" value="100" />
            </div>
            <div class="dh-field">
              <label>Срок / период оплаты</label>
              <input id="dhObsPayPeriod" autocomplete="off" placeholder="например: в течение 10 дней" />
            </div>
          </div>
          <div class="dh-obs-row" style="margin-top:8px">
            <button type="button" class="dh-btn dh-btn--ghost dh-obs-mini" id="dhObsSpecialBtn">
              Спецправила
            </button>
            <span class="dh-obs-hint" id="dhObsSpecialHint"></span>
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
          <div class="dh-obs-sec__h">
            5. Текст письма
            <button type="button" class="dh-btn dh-btn--ghost dh-obs-mini" id="dhObsComposeBtn">
              Собрать текст
            </button>
          </div>
          <div class="dh-field">
            <label>Дата письма</label>
            <input type="date" id="dhObsLetterDate" />
          </div>
          <div class="dh-field">
            <label>Абзацы письма</label>
            <textarea id="dhObsLetterText" rows="10"
              placeholder="Нажмите «Собрать текст» — здесь появятся абзацы, их можно править вручную"></textarea>
          </div>
          <div class="dh-obs-hint">
            Исходящий номер выдаётся при сохранении. Сохранить можно после «Собрать текст» и успешного предпросмотра этого текста.
          </div>
          <button type="button" class="dh-btn dh-btn--ghost dh-obs-mini" id="dhObsDraftReset" style="margin-top:6px">
            Сбросить черновик
          </button>
        </section>
      </div>

      <!-- V487: перетаскиваемая ручка ширины, как в «Пропусках МЛСП».
           Форма и предпросмотр независимы: кому нужен широкий бланк —
           тянет влево, кому длинные наименования позиций — вправо. -->
      <div class="dh-obs-grip" id="dhObsGrip" title="Потяните — ширина формы и превью"
           role="separator" aria-orientation="vertical" tabindex="0"></div>

      <!-- правая колонка: предпросмотр -->
      <div class="dh-obs-preview" id="dhObsPreviewPane">
        <!-- V487: панель предпросмотра как в «Пропусках МЛСП» —
             заголовок, масштаб, обновление. Было: голая заглушка «PDF» и
             кнопка «Предпросмотр» в подвале, из-за чего окно выглядело
             дёшево, а масштабировать письмо было нельзя. -->
        <div class="dh-obs-prev-bar">
          <div class="dh-obs-prev-bar__main">
            <div class="dh-obs-prev-bar__title">Предпросмотр письма</div>
            <div class="dh-obs-prev-bar__meta" id="dhObsPrevMeta">A4 · банковский бланк</div>
          </div>
          <div class="dh-obs-prev-tools" role="toolbar" aria-label="Масштаб предпросмотра">
            <button type="button" class="dh-obs-zbtn" id="dhObsZoomOut" title="Уменьшить">−</button>
            <button type="button" class="dh-obs-zbtn dh-obs-zbtn--label" id="dhObsZoomLabel" title="По ширине">100%</button>
            <button type="button" class="dh-obs-zbtn" id="dhObsZoomIn" title="Увеличить">+</button>
            <span class="dh-obs-prev-tools__sep" aria-hidden="true"></span>
            <button type="button" class="dh-obs-zbtn" id="dhObsZoomFit" title="Вписать по ширине">↔</button>
            <button type="button" class="dh-obs-zbtn" id="dhObsNewWindow" title="Открыть в новом окне">↗</button>
          </div>
        </div>
        <div class="dh-obs-prev-viewport" id="dhObsPrevViewport">
          <div class="dh-obs-preview__empty" id="dhObsPreviewEmpty">
            <div class="dh-obs-preview__ico">PDF</div>
            <div>Нажмите «Предпросмотр», чтобы увидеть письмо</div>
            <div class="dh-obs-hint">Номер исходящего при этом не тратится</div>
          </div>
          <div class="dh-obs-prev-scaler" id="dhObsPrevScaler">
            <iframe id="dhObsPreviewFrame" class="dh-obs-frame" hidden title="Предпросмотр письма"></iframe>
          </div>
        </div>
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
      // V488: в списке — КОРОТКАЯ подпись.
      //
      // Было: «КР-433п26 от 11.08.2026 · остаток 2 584 671 из 3 000 000 · 13.8%»
      // в одну строку на каждый договор. В шапке окна это сливалось в кашу
      // («— без договора — КР-433п26 … 13.8% КР320п26 … 2.7%»), заказчик
      // справедливо спросил «это зачем?». Полные цифры нужны при выборе, а не
      // в закрытом списке. Детали показываем в подсказке под селектом.
      const parts = [s.number];
      if (s.agreement_date) parts.push('от ' + fmtDate(s.agreement_date));
      if (s.object_name) parts.push('· ' + s.object_name);
      const covers = amount > 0 ? (Number(s.remaining) || 0) >= amount : true;
      if (!covers) parts.push('· лимита не хватает');
      opts.push(`<option value="${s.id}" ${Number(s.id) === Number(selectedId) ? 'selected' : ''}>`
        + `${esc(parts.join(' '))}</option>`);
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
    if (!s) {
      // V488: подсказка не должна звучать как поломка, когда договоров
      // несколько и человек ещё не выбрал.
      const total = (state.subcontracts || []).length;
      box.textContent = total > 1
        ? `Выберите договор — от него зависит лимит существенности (доступно ${total}).`
        : 'Договор не выбран — лимит не считается.';
      return;
    }
    const rem = Number(s.remaining) || 0;
    const lim = Number(s.limit_amount) || 0;
    const usedPct = Number(s.used_pct || 0).toFixed(1);
    if (amount > 0 && rem < amount) {
      box.innerHTML = `<span class="dh-obs-bad">Лимита не хватает: остаток ${money(rem)}, `
        + `недостаёт ${money(amount - rem)} ₽. Письмо не сохранится.</span>`;
    } else {
      const after = amount > 0 ? ` · после этого счёта останется ${money(rem - amount)}` : '';
      box.textContent = `Остаток ${money(rem)} из ${money(lim)} · использовано ${usedPct}%${after}.`;
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

  const draftKey = (docId) => `dh_obs_draft_v1_${docId}`;

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
    state.previewOkForLetter = false;
    // V492: реквизиты изменились — кеш собранных файлов недействителен.
    state.fileCache = {};
    state.inflight = {};
    const dl1 = el('dhObsDlPdf');
    const dl2 = el('dhObsDlDocx');
    if (dl1) dl1.disabled = true;
    if (dl2) dl2.disabled = true;
    persistDraft();
  }

  function subcontractPartyValue() {
    const sel = el('dhObsSubParty');
    const custom = el('dhObsSubPartyCustom');
    if (sel && sel.value === '__custom__') return (custom && custom.value || '').trim();
    return (sel && sel.value) || 'ООО «ГСП Ремонт»';
  }

  function letterParagraphsFromTextarea() {
    const raw = String((el('dhObsLetterText') && el('dhObsLetterText').value) || '');
    return raw.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  }

  function letterTextFingerprint() {
  return String((el('dhObsLetterText') && el('dhObsLetterText').value) || '').trim();
  }

  function persistDraft() {
    if (!state || !state.docId) return;
    try {
      const data = {
        fromCard: !!el('dhObsFromCard').checked,
        invoice_number: el('dhObsInvNo').value,
        invoice_date: el('dhObsInvDate').value,
        gross: el('dhObsGross').value,
        vat_rate: el('dhObsVatRate').value,
        vat: el('dhObsVat').value,
        counterparty: el('dhObsCp').value,
        items: el('dhObsItems').value,
        letter_date: el('dhObsLetterDate').value,
        obs_account: el('dhObsAccount').value,
        subcontract: el('dhObsSub').value,
        work_context: el('dhObsWorkCtx').value,
        sub_party: el('dhObsSubParty').value,
        sub_party_custom: el('dhObsSubPartyCustom').value,
        pay_pct: el('dhObsPayPct').value,
        pay_period: el('dhObsPayPeriod').value,
        special_context: state.specialContext || '',
        letter_text: el('dhObsLetterText').value,
      };
      localStorage.setItem(draftKey(state.docId), JSON.stringify(data));
    } catch (_) { /* приватный режим */ }
  }

  function restoreDraft() {
    if (!state || !state.docId) return false;
    try {
      const raw = localStorage.getItem(draftKey(state.docId));
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return false;
      if (data.fromCard != null) el('dhObsFromCard').checked = !!data.fromCard;
      if (data.invoice_number != null) el('dhObsInvNo').value = data.invoice_number;
      if (data.invoice_date) el('dhObsInvDate').value = data.invoice_date;
      if (data.gross != null) el('dhObsGross').value = data.gross;
      if (data.vat_rate != null) el('dhObsVatRate').value = data.vat_rate;
      if (data.vat != null) el('dhObsVat').value = data.vat;
      if (data.counterparty != null) el('dhObsCp').value = data.counterparty;
      if (data.items != null) el('dhObsItems').value = data.items;
      if (data.letter_date) el('dhObsLetterDate').value = data.letter_date;
      if (data.obs_account != null && el('dhObsAccount').querySelector(`option[value="${data.obs_account}"]`)) {
        el('dhObsAccount').value = data.obs_account;
      }
      if (data.subcontract != null && el('dhObsSub').querySelector(`option[value="${data.subcontract}"]`)) {
        el('dhObsSub').value = data.subcontract;
      }
      if (data.work_context != null) el('dhObsWorkCtx').value = data.work_context;
      if (data.sub_party) {
        el('dhObsSubParty').value = data.sub_party;
        el('dhObsSubPartyCustom').hidden = data.sub_party !== '__custom__';
        if (data.sub_party === '__custom__' && data.sub_party_custom) {
          el('dhObsSubPartyCustom').value = data.sub_party_custom;
        }
      }
      if (data.pay_pct != null) el('dhObsPayPct').value = data.pay_pct;
      if (data.pay_period != null) el('dhObsPayPeriod').value = data.pay_period;
      if (data.special_context != null) state.specialContext = data.special_context;
      if (data.letter_text != null) el('dhObsLetterText').value = data.letter_text;
      recalcVat();
      updateItemsHint();
      updateAccountInfo();
      updateSubInfo();
      // V492: любое изменение реквизитов делает собранный текст устаревшим.
      // Без этого человек правил сумму, а текст оставался от старой — и
      // «Сохранить» пропускала письмо с расхождением.
      state.fileCache = {};
      state.inflight = {};
      return true;
    } catch (_) { return false; }
  }

  function clearDraftStorage() {
    if (!state || !state.docId) return;
    try { localStorage.removeItem(draftKey(state.docId)); } catch (_) { /* */ }
  }

  function renderPreflight(warnings) {
    const box = el('dhObsPreflight');
    if (!box) return;
    const list = Array.isArray(warnings) ? warnings.filter(Boolean) : [];
    if (!list.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = '<div class="dh-obs-preflight__title">Проверьте перед сохранением</div><ul>'
      + list.map((w) => `<li>${esc(w)}</li>`).join('') + '</ul>';
  }

  async function doCompose(opts) {
    const o = opts || {};
    const btn = el('dhObsComposeBtn');
    if (!btn || !state) return;
    btn.disabled = true;
    const prev = btn.textContent;
    btn.textContent = 'Собираю…';
    try {
      const res = await apiJson(`/${state.docId}/obs-letter/compose`, {
        method: 'POST',
        // V492: при сборке НЕ шлём старый текст из textarea (override перебил
        // бы сборку) и не ждём модель — быстрый детерминированный каркас.
        body: JSON.stringify(collectPayload({ skipOverride: true, noAi: true })),
      });
      const text = (res.paragraphs || []).join('\n\n');
      el('dhObsLetterText').value = text;
      state.composedFingerprint = text.trim();
      state.previewOkForLetter = false;
      el('dhObsSave').disabled = true;
      persistDraft();
      if (!o.silent) {
        toast('Текст письма', `Собрано абзацев: ${(res.paragraphs || []).length}`, 'ok');
        // При автоподготовке (открытие окна) не помечаем форму грязной:
        // иначе человек закрывает окно, ничего не тронув, и получает вопрос
        // «есть несохранённые изменения».
        markDirty();
      }
    } catch (e) {
      if (!o.silent) toast('Не удалось собрать текст', e.message || 'ошибка', 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = prev;
    }
  }

  function openSpecialRules() {
    const root = document.getElementById('dhObsModal');
    if (!root) return;
    const hint = state && state.specialRule ? state.specialRule.label : '';
    const host = document.createElement('div');
    host.className = 'dh-obs-submodal';
    host.innerHTML = `
      <div class="dh-obs-submodal__card">
        <div class="dh-obs-submodal__head">
          <span>Спецправила${hint ? ' · ' + esc(hint) : ''}</span>
          <button type="button" class="dh-modal__x" id="dhObsSpecX" aria-label="Закрыть">✕</button>
        </div>
        <div class="dh-obs-submodal__body">
          <label class="dh-field"><span>Дополнительный контекст для письма</span>
            <textarea id="dhObsSpecialText" rows="6">${esc(state.specialContext || '')}</textarea>
          </label>
        </div>
        <div class="dh-obs-submodal__foot">
          <button type="button" class="dh-btn dh-btn--ghost" id="dhObsSpecCancel">Отмена</button>
          <button type="button" class="dh-btn dh-btn--primary" id="dhObsSpecOk">Применить</button>
        </div>
      </div>`;
    root.appendChild(host);
    const q = (id) => host.querySelector('#' + id);
    const closeSub = () => host.remove();
    q('dhObsSpecX').onclick = closeSub;
    q('dhObsSpecCancel').onclick = closeSub;
    q('dhObsSpecOk').onclick = () => {
      state.specialContext = (q('dhObsSpecialText').value || '').trim();
      const h = el('dhObsSpecialHint');
      if (h) h.textContent = state.specialContext ? 'Спецконтекст задан' : '';
      markDirty();
      closeSub();
    };
    q('dhObsSpecialText').focus();
  }

  function collectPayload(opts) {
    const o = opts || {};
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
      work_context: String(el('dhObsWorkCtx').value || '').trim(),
      subcontract_party: subcontractPartyValue(),
      payment_pct: parseNum(el('dhObsPayPct').value) || 100,
      payment_period: String(el('dhObsPayPeriod').value || '').trim(),
      special_context: String(state && state.specialContext || '').trim(),
    };
    if (o.noAi) payload.no_ai = true;
    // При compose текст из textarea НЕ отправляем: иначе сервер вернёт его же
    // (override перебивает сборку) и кнопка «Собрать текст» перестанет собирать.
    if (!o.skipOverride) {
      const paras = letterParagraphsFromTextarea();
      if (paras.length) payload.paragraphs_override = paras;
    }
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
    const fmt = format === 'docx' ? 'docx' : 'pdf';
    // V492: кеш уже собранного файла по отпечатку формы.
    //
    // Жалоба 12.11.2026: «очень долго скачивается Word и PDF, нажимаю —
    // ничего не происходит 2–3 секунды, иногда не скачивается». Причина:
    // каждая кнопка заново гоняла полный серверный рендер (Word + LibreOffice),
    // а при живом предпросмотре на каждое изменение ещё и повторно.
    // Теперь результат предпросмотра переиспользуется, пока текст/суммы не
    // изменились; параллельные запросы на один и тот же формат схлопываются.
    const fp = fmt + '|' + JSON.stringify(collectPayload({ noAi: true }));
    if (state.fileCache && state.fileCache[fp]) return state.fileCache[fp];
    if (state.inflight && state.inflight[fp]) return state.inflight[fp];
    state.inflight = state.inflight || {};
    const p = (async () => {
      const r = await fetch(
        `${API}/${state.docId}/obs-letter/preview?format=${fmt}`,
        {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' },
          // no_ai: сервер не зовёт модель — фолбэк детерминированный. Ещё и
          // поэтому текст в предпросмотре совпадает с тем, что человек правил.
          body: JSON.stringify(collectPayload({ noAi: true })),
          cache: 'no-store',
        }
      );
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || ('HTTP ' + r.status));
      }
      return r.blob();
    })();
    state.inflight[fp] = p;
    try {
      const blob = await p;
      state.fileCache = state.fileCache || {};
      // Держим только последние 4 файла — письмо на 1 лист, память не жалко.
      const keys = Object.keys(state.fileCache);
      if (keys.length >= 4) delete state.fileCache[keys[0]];
      state.fileCache[fp] = blob;
      return blob;
    } finally {
      delete state.inflight[fp];
    }
  }

  // ─── V487: масштаб предпросмотра, split-ручка, живое обновление ──────────
  //
  // Заказчик 11.11.2026: «предпросмотр как у МЛСП (split + масштаб), живое
  // обновление превью, всё должно быть дорого».
  //
  // Что было: статичный iframe высотой 62vh, который появлялся ТОЛЬКО по
  // кнопке «Предпросмотр». Ни масштаба, ни перетаскивания, ни авто-обновления.
  // Если человек правил сумму после предпросмотра, он видел старый бланк с
  // пометкой «есть изменения» — и должен был жать кнопку заново.
  //
  // Что стало: панель инструментов (масштаб −/+/по ширине/в новом окне),
  // перетаскиваемая граница формы и превью (процент в localStorage), и
  // авто-обновление через debounce после любой правки.
  const ZOOM_KEY = 'dh_obs_zoom';
  const SPLIT_KEY = 'dh_obs_split_pct';
  const MIN_ZOOM = 0.5;
  const MAX_ZOOM = 2.0;
  const ZOOM_STEP = 0.1;

  function zoomNow() {
    const v = parseFloat(state.zoom);
    return Number.isFinite(v) && v >= MIN_ZOOM && v <= MAX_ZOOM ? v : 1;
  }

  /** Применить масштаб к «бумаге» превью. 1:1 = реальная ширина A4 (210 мм). */
  function applyZoom() {
    // V488: защита от вызова до open(). Раньше любая такая попытка роняла
    // модалку целиком (TypeError), и человек видел пустые списки и мёртвые кнопки.
    if (!state) return;
    const z = zoomNow();
    const scaler = el('dhObsPrevScaler');
    const frame = el('dhObsPreviewFrame');
    const viewport = el('dhObsPrevViewport');
    const label = el('dhObsZoomLabel');
    if (label) label.textContent = Math.round(z * 100) + '%';
    if (!scaler || !frame) return;
    // Ширина листа A4 при 96 dpi ≈ 794 px. Масштабируем трансформом, чтобы
    // iframe не перерисовывался: PDF внутри сохраняет своё разрешение.
    const paperW = 794;
    const w = Math.round(paperW * z);
    frame.style.width = w + 'px';
    frame.style.height = Math.round(w * 1.414) + 'px';
    if (scaler) {
      scaler.style.width = w + 'px';
      scaler.style.height = frame.style.height;
    }
    if (viewport) viewport.classList.toggle('is-zoomed', z !== 1);
  }

  function setZoom(z) {
    const v = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(z * 100) / 100));
    state.zoom = v;
    try { localStorage.setItem(ZOOM_KEY, String(v)); } catch (_) { /* приватный режим */ }
    applyZoom();
  }

  /** «По ширине»: подогнать лист под ширину видимой области. */
  function fitToWidth() {
    const viewport = el('dhObsPrevViewport');
    if (!viewport) return;
    const avail = Math.max(220, viewport.clientWidth - 36);
    setZoom(avail / 794);
  }

  /**
   * V492: вписать лист в панель, если сохранённый масштаб шире неё.
   *
   * Жалоба 12.11.2026: «в модалке справа окно, внутри которого живёт
   * предпросмотр, и его можно туда-сюда перемещать — он не ровно по рамку
   * поля». Причина: масштаб помнится в localStorage. На узком окне (или после
   * перетаскивания ручки) лист при 100 % шире панели, появляется горизонтальный
   * скролл — и лист читается как отдельный «остров», который ездит внутри
   * рамки. Теперь при открытии масштаб подрезается под фактическую ширину.
   */
  function clampZoomToPane() {
    const viewport = el('dhObsPrevViewport');
    if (!viewport || !state) return;
    // Явный выбор масштаба человеком не перебиваем: он мог специально
    // увеличить лист. Подрезаем только стартовый/унаследованный масштаб.
    if (state.zoomTouched) { applyZoom(); return; }
    const avail = Math.max(220, viewport.clientWidth - 36);
    const w = Math.round(794 * zoomNow());
    if (w > avail) {
      const fitted = Math.max(MIN_ZOOM, avail / 794);
      state.zoom = Math.round(fitted * 100) / 100;
    }
    applyZoom();
  }

  // ─── Перетаскивание ручки (как mlsp_split_grip) ─────────────────────────
  function applySplit(pct) {
    const body = el('dhObsBody');
    if (!body) return;
    const v = Math.max(28, Math.min(68, Number(pct) || 46));
    body.style.setProperty('--dh-obs-split', v + '%');
    // V488: без state ручка всё равно двигает колонки, но нечего запоминать.
    if (state) state.splitPct = v;
  }

  function bindGrip() {
    const grip = el('dhObsGrip');
    if (!grip) return;
    let dragging = false;
    const onMove = (e) => {
      if (!dragging) return;
      const body = el('dhObsBody');
      if (!body) return;
      const rect = body.getBoundingClientRect();
      const x = (e.touches ? e.touches[0].clientX : e.clientX);
      const pct = ((x - rect.left) / rect.width) * 100;
      applySplit(pct);
      e.preventDefault();
    };
    const stop = () => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('dh-obs-resizing');
      try { localStorage.setItem(SPLIT_KEY, String(state.splitPct)); } catch (_) { /* */ }
      // После смены ширины «по ширине» надо пересчитать.
      clampZoomToPane();
    };
    const start = (e) => {
      dragging = true;
      document.body.classList.add('dh-obs-resizing');
      e.preventDefault();
    };
    grip.addEventListener('mousedown', start);
    grip.addEventListener('touchstart', start, { passive: false });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mouseup', stop);
    document.addEventListener('touchend', stop);
    // Клавиатура: ручка — separator, должна двигаться стрелками.
    grip.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 6 : 2;
      if (e.key === 'ArrowLeft') { applySplit((state.splitPct || 46) - step); e.preventDefault(); }
      if (e.key === 'ArrowRight') { applySplit((state.splitPct || 46) + step); e.preventDefault(); }
    });
  }

  // ─── Живое обновление превью ────────────────────────────────────────────
  //
  // Ключевое отличие от «обновить по кнопке»: человек меняет сумму и сразу
  // видит результат в бланке. Debounce 700 мс — чтобы не собирать PDF на
  // каждое нажатие клавиши (один прогон = LibreOffice, это дорого).
  //
  // Живое обновление включается ТОЛЬКО после первого ручного предпросмотра:
  // иначе при открытии окна сразу пойдёт сборка, хотя человек ещё ничего не
  // смотрел. Это и экономия, и предсказуемость.
  let liveTimer = null;
  function scheduleLivePreview() {
    if (!state || !state.previewed) return;
    if (liveTimer) clearTimeout(liveTimer);
    liveTimer = setTimeout(() => {
      liveTimer = null;
      refreshPreviewQuiet();
    }, 700);
  }

  /** Тихое обновление: без тостов и без спиннера на кнопке. */
  async function refreshPreviewQuiet() {
    try {
      const blob = await fetchPreviewBlob('pdf');
      if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
      state.previewUrl = URL.createObjectURL(blob);
      const frame = el('dhObsPreviewFrame');
      frame.src = state.previewUrl;
      frame.hidden = false;
      const empty = el('dhObsPreviewEmpty');
      if (empty) empty.hidden = true;
      const stale = el('dhObsStale');
      if (stale) stale.hidden = true;
      applyZoom();
    } catch (e) {
      // Тихое обновление не должно ругаться: человек не просил его явно.
      console.warn('[obs-letter] live preview failed:', e && e.message);
      const stale = el('dhObsStale');
      if (stale) stale.hidden = false;
    }
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
      const fp = letterTextFingerprint();
      // V492: достаточно, чтобы текст был собран (compose) и предпросмотр
      // отрисован. Раньше требовалось точное совпадение отпечатка с моментом
      // compose: любая правка пробела в textarea блокировала «Сохранить», и
      // кнопка оставалась серой без объяснения — со стороны «не работает».
      if (state.composedFingerprint && fp) {
        state.previewOkForLetter = true;
        el('dhObsSave').disabled = false;
      } else {
        state.previewOkForLetter = false;
        el('dhObsSave').disabled = true;
      }
      // Первый предпросмотр — подгоняем по ширине, если человек ещё не
      // выбирал масштаб вручную.
      if (!state.zoomTouched) fitToWidth();
      else applyZoom();
      // D-397b (замечание верификатора 07.11.2026): здесь стоял сброс
      // `state.dirty = false` при `state.saved = null`. Предпросмотр — это НЕ
      // сохранение: если человек после него закроет окно, введённые данные
      // пропадали без вопроса. Флаг «есть несохранённые правки» держим до
      // фактического save.
      if (!state.previewOkForLetter) el('dhObsSave').disabled = true;
      el('dhObsDlPdf').disabled = false;
      el('dhObsDlDocx').disabled = false;
      const meta = el('dhObsPrevMeta');
      if (meta) meta.textContent = 'A4 · банковский бланк · готов';
    } catch (e) {
      toast('Предпросмотр не собрался', e.message || 'ошибка', 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = prev;
    }
  }

  async function download(format) {
    try {
      // V486: после сохранения качаем РЕАЛЬНЫЙ файл письма с его номером.
      //
      // Дефект (жалоба 11.11.2026 «ворд не работает»): обе кнопки «Скачать»
      // всегда шли в эндпоинт ПРЕДПРОСМОТРА, а он печатает «Исх. № б/н».
      // Человек сохранял письмо, жал «Скачать» — и получал файл без номера,
      // то есть непригодный для банка.
      //
      // Если письмо уже сохранено (`state.saved.letter_doc_id`) — берём файл
      // из ACL-роута письма, где номер настоящий.
      const savedId = state.saved && state.saved.letter_doc_id;
      let blob;
      let fileName;
      if (savedId) {
        const r = await fetch(`/api/doc-registry/${savedId}/letter-file`
          + (format === 'docx' ? '?format=docx' : ''), {
          headers: { Authorization: 'Bearer ' + token() },
          cache: 'no-store',
        });
        if (!r.ok) {
          let msg = 'HTTP ' + r.status;
          try { const j = await r.json(); msg = j.error || msg; } catch (_) { /* не JSON */ }
          throw new Error(msg);
        }
        blob = await r.blob();
        const num = String((state.saved && state.saved.number) || '').replace(/^Исх\.\s*/i, '');
        fileName = `Письмо ОБС${num ? ' ' + num : ''}${format === 'docx' ? '.docx' : '.pdf'}`;
      } else {
        blob = await fetchPreviewBlob(format);
        fileName = `Письмо ОБС (черновик)${format === 'docx' ? '.docx' : '.pdf'}`;
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      toast('Скачано', fileName, 'ok');
    } catch (e) {
      toast('Не удалось скачать', e.message || 'ошибка', 'err');
    }
  }

  async function save() {
    if (!state.previewOkForLetter || !letterTextFingerprint()) {
      // V492: вместо сухого отказа — сразу собрать текст и предпросмотр.
      // Раньше человек видел «Сначала соберите текст», шёл искать кнопку и
      // возвращался; теперь порядок доводится автоматически.
      toast('Сохранение', 'Готовлю текст и предпросмотр…', 'ok');
      try {
        if (!letterTextFingerprint()) await doCompose({ silent: true });
        await doPreview();
      } catch (_) { /* ошибку покажет doPreview */ }
      if (!state.previewOkForLetter) return;
    }
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
      // V492: после сохранения файл уже существует и не меняется — кеш
      // оставляем, чтобы «Скачать Word/PDF» шли из ACL-роута без рендера.
      clearDraftStorage();
      toast('Письмо создано', 'Исх. № ' + (res.number || ''), 'ok');
      // V492: привязка к карточке проверяется сразу и показывается человеку.
      //
      // Жалоба 12.11.2026: «после создания письмо не прикрепляется к карточке
      // счёта». Корень был в ReferenceError из attachments (letterDocId до
      // объявления) — транзакция откатывалась. Теперь, если сервер ответил
      // успешно, но ссылки на письмо в карточке нет, говорим об этом прямо.
      const attachedId = Number(res.letter_doc_id || 0);
      if (!attachedId) {
        el('dhObsFootLeft').innerHTML = '<span class="dh-obs-bad">Письмо создано, но карточка счёта не '
          + 'связана с ним. Сообщите в поддержку: письмо Исх. № ' + esc(res.number || '') + '.</span>';
      }
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

  /**
   * V488: КРИТИЧЕСКИЙ ДЕФЕКТ — модалка падала целиком.
   *
   * `ensureMounted()` вызывает `bind()` ПЕРЕД созданием `state` (он создаётся
   * в `open()`). А в `bind()` в конце стояли `applySplit(state.splitPct)` и
   * `applyZoom()` → `TypeError: Cannot read properties of null (reading
   * 'splitPct')`. Из консоли заказчика:
   *
   *   obs-letter-modal.js:778 Uncaught TypeError: ... reading 'splitPct'
   *     at bind → at ensureMounted → at Object.open
   *
   * Последствия были не косметические: исключение прерывало `open()`, поэтому
   * НЕ заполнялись списки ОБС и договоров, НЕ включались кнопки, не работало
   * живое обновление превью. Сообщения «список договоров пуст», «предпросмотр
   * сломан», «кнопки не работают» — всё это следствие одной строки.
   *
   * Теперь `bind()` не трогает `state` вовсе: масштаб и split применяются из
   * `open()`, когда данные уже есть.
   */
  function bind(root) {
    el('dhObsX').onclick = close;
    el('dhObsCancel').onclick = close;
    root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });
    document.addEventListener('keydown', onKey);

    el('dhObsPreviewBtn').onclick = doPreview;
    el('dhObsComposeBtn').onclick = doCompose;
    el('dhObsSpecialBtn').onclick = openSpecialRules;
    el('dhObsDraftReset').onclick = () => {
      if (!window.confirm('Сбросить черновик и подставить значения из карточки?')) return;
      clearDraftStorage();
      applyDefaults(!!el('dhObsFromCard').checked);
      applyObsFieldDefaults();
      el('dhObsLetterText').value = '';
      state.composedFingerprint = null;
      state.specialContext = (state.defaults && state.defaults.special_context) || '';
      markDirty();
    };
    el('dhObsSubParty').onchange = () => {
      const custom = el('dhObsSubPartyCustom');
      const isCustom = el('dhObsSubParty').value === '__custom__';
      if (custom) custom.hidden = !isCustom;
      markDirty();
    };
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
      'dhObsCp', 'dhObsItems', 'dhObsLetterDate', 'dhObsSub', 'dhObsAccount',
      'dhObsWorkCtx', 'dhObsSubPartyCustom', 'dhObsPayPct', 'dhObsPayPeriod', 'dhObsLetterText']
      .forEach((id) => {
        const node = el(id);
        if (!node) return;
        node.addEventListener('input', () => {
          if (id === 'dhObsGross' || id === 'dhObsVatRate') recalcVat();
          if (id === 'dhObsItems') updateItemsHint();
          if (id === 'dhObsSub') updateSubInfo();
          if (id === 'dhObsAccount') updateAccountInfo();
          markDirty();
          // V487: живое обновление бланка после правки.
          scheduleLivePreview();
        });
        node.addEventListener('change', () => {
          if (id === 'dhObsGross' || id === 'dhObsVatRate') recalcVat();
          if (id === 'dhObsItems') updateItemsHint();
          if (id === 'dhObsSub') updateSubInfo();
          if (id === 'dhObsAccount') updateAccountInfo();
          markDirty();
          scheduleLivePreview();
        });
      });
    el('dhObsAccountAdd').onclick = addAccount;

    // ─── V487: панель масштаба и ручка ширины ─────────────────────────────
    const zoomIn = el('dhObsZoomIn');
    const zoomOut = el('dhObsZoomOut');
    const zoomFit = el('dhObsZoomFit');
    const newWin = el('dhObsNewWindow');
    const zoomLabel = el('dhObsZoomLabel');
    if (zoomIn) zoomIn.onclick = () => { state.zoomTouched = true; setZoom(zoomNow() + ZOOM_STEP); };
    if (zoomOut) zoomOut.onclick = () => { state.zoomTouched = true; setZoom(zoomNow() - ZOOM_STEP); };
    if (zoomFit) zoomFit.onclick = () => { state.zoomTouched = true; fitToWidth(); };
    // Клик по проценту — сброс на 1:1 (масштаб в натуральную величину).
    if (zoomLabel) zoomLabel.onclick = () => { state.zoomTouched = true; setZoom(1); };
    if (newWin) {
      newWin.onclick = () => {
        if (!state.previewUrl) { toast('Предпросмотр', 'Сначала соберите бланк', 'info'); return; }
        window.open(state.previewUrl, '_blank', 'noopener');
      };
    }
    // Ctrl+колесо над превью — как в МЛСП.
    const viewport = el('dhObsPrevViewport');
    if (viewport) {
      viewport.addEventListener('wheel', (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        state.zoomTouched = true;
        setZoom(zoomNow() + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
      }, { passive: false });
    }
    bindGrip();
    // V488: масштаб и ширина колонок применяются в open(), когда state уже
    // создан. Здесь только навешиваем обработчики — обращаться к state на этой
    // стадии нельзя, иначе модалка падает целиком (см. комментарий ниже).
  }

  function onKey(e) {
    if (!state) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  }

  function applyObsFieldDefaults() {
    const d = state.defaults || {};
    if (d.work_context != null) el('dhObsWorkCtx').value = d.work_context;
    if (d.payment_pct != null) el('dhObsPayPct').value = String(d.payment_pct);
    if (d.payment_period != null) el('dhObsPayPeriod').value = d.payment_period;
    state.specialContext = d.special_context || '';
    const hint = el('dhObsSpecialHint');
    if (hint) hint.textContent = state.specialContext ? `Правило: ${(state.specialRule && state.specialRule.label) || 'спецконтекст'}` : '';
    const party = d.subcontract_party || 'ООО «ГСП Ремонт»';
    const partySel = el('dhObsSubParty');
    const customIn = el('dhObsSubPartyCustom');
    if (partySel) {
      const has = Array.from(partySel.options).some((o) => o.value === party);
      if (has) {
        partySel.value = party;
        if (customIn) customIn.hidden = true;
      } else {
        partySel.value = '__custom__';
        if (customIn) { customIn.hidden = false; customIn.value = party; }
      }
    }
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

  /**
   * V486: добавить ОБС-счёт прямо из модалки письма.
   *
   * Заказчик 11.11.2026: «надо сделать, чтобы можно было в модалке добавить и
   * привязать, и чтобы РП и ТО могли это сделать тоже».
   *
   * Почему не `window.prompt`: так заводятся только название, банк, р/с и БИК —
   * ИНН, КПП, корр. счёт и ОБЪЕКТ остаются пустыми. А без объекта новый счёт
   * не встаёт первым в списке для своего счёта, и человек снова ищет его руками.
   * Плюс `prompt` блокирует окно и на светлой теме выглядит системным.
   *
   * Здесь — нормальная форма внутри модалки: все поля реквизитов + выбор
   * объекта. Обязательно только название: реквизиты можно дозаполнить позже
   * (заказчик пришлёт их отдельно).
   */
  async function addAccount() {
    const root = document.getElementById('dhObsModal');
    if (!root) return;
    // Список объектов для выбора — из уже загруженных договоров (там есть
    // object_name и work_id) плюс текущий объект счёта.
    const worksMap = new Map();
    for (const s of (state.subcontracts || [])) {
      if (s.work_id) worksMap.set(String(s.work_id), s.object_name || ('#' + s.work_id));
    }
    if (state.docWorkId && !worksMap.has(String(state.docWorkId))) {
      worksMap.set(String(state.docWorkId), state.docWorkName || ('#' + state.docWorkId));
    }
    const workOpts = ['<option value="">— не привязан к объекту —</option>']
      .concat([...worksMap.entries()].map(([id, nm]) =>
        `<option value="${esc(id)}"${String(state.docWorkId) === String(id) ? ' selected' : ''}>${esc(nm)}</option>`))
      .join('');

    const host = document.createElement('div');
    host.className = 'dh-obs-submodal';
    host.innerHTML = `
      <div class="dh-obs-submodal__card">
        <div class="dh-obs-submodal__head">
          <span>Новый ОБС-счёт</span>
          <button type="button" class="dh-modal__x" id="dhObsAccX" aria-label="Закрыть">✕</button>
        </div>
        <div class="dh-obs-submodal__body">
          <label class="dh-field"><span>Название *</span>
            <input id="dhAccName" placeholder="ОБС «АГПЗ»" /></label>
          <label class="dh-field"><span>Заказчик (кому подряд)</span>
            <input id="dhAccCustomer" placeholder="ООО «ГСП Ремонт»" /></label>
          <div class="dh-obs-grid2">
            <label class="dh-field"><span>ИНН</span><input id="dhAccInn" inputmode="numeric" /></label>
            <label class="dh-field"><span>КПП</span><input id="dhAccKpp" inputmode="numeric" /></label>
          </div>
          <label class="dh-field"><span>Банк</span><input id="dhAccBank" /></label>
          <div class="dh-obs-grid2">
            <label class="dh-field"><span>Р/с</span><input id="dhAccRs" inputmode="numeric" /></label>
            <label class="dh-field"><span>К/с</span><input id="dhAccKs" inputmode="numeric" /></label>
          </div>
          <label class="dh-field"><span>БИК</span><input id="dhAccBik" inputmode="numeric" /></label>
          <label class="dh-field"><span>Объект <span class="dh-field__hint">к какому объекту относится счёт</span></span>
            <select id="dhAccWork">${workOpts}</select></label>
          <div class="dh-obs-hint">Реквизиты можно оставить пустыми и дозаполнить позже — письмо соберётся и без них.</div>
        </div>
        <div class="dh-obs-submodal__foot">
          <button type="button" class="dh-btn dh-btn--ghost" id="dhAccCancel">Отмена</button>
          <button type="button" class="dh-btn dh-btn--primary" id="dhAccSave">Создать ОБС</button>
        </div>
      </div>`;
    root.appendChild(host);
    const q = (id) => host.querySelector('#' + id);
    const closeSub = () => host.remove();
    q('dhObsAccX').onclick = closeSub;
    q('dhAccCancel').onclick = closeSub;
    q('dhAccName').focus();

    q('dhAccSave').onclick = async () => {
      const name = (q('dhAccName').value || '').trim();
      if (!name) { toast('Название', 'Укажите название ОБС-счёта', 'err'); return; }
      const val = (id) => {
        const v = (q(id).value || '').trim();
        return v || null;
      };
      try {
        const res = await apiJson('/obs-accounts', {
          method: 'POST',
          body: JSON.stringify({
            name,
            customer_name: val('dhAccCustomer'),
            inn: val('dhAccInn'),
            kpp: val('dhAccKpp'),
            bank_name: val('dhAccBank'),
            bank_account: val('dhAccRs'),
            bank_corr_account: val('dhAccKs'),
            bank_bik: val('dhAccBik'),
            work_id: q('dhAccWork').value || null,
          }),
        });
        state.obsAccounts = (state.obsAccounts || []).concat([res.item]);
        fillAccounts(state.obsAccounts, res.item.id);
        updateAccountInfo();
        markDirty();
        closeSub();
        toast('ОБС добавлен', res.item.name, 'ok');
      } catch (e) {
        toast('Не удалось добавить ОБС', e.message || 'ошибка', 'err');
      }
    };
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
      previewOkForLetter: false,
      composedFingerprint: null,
      specialContext: '',
      specialRule: null,
      previewUrl: null,
      saved: null,
      // V492: кеш собранных файлов предпросмотра и склейка параллельных
      // запросов — иначе каждая кнопка «Скачать» заново рендерила Word/PDF.
      fileCache: {},
      inflight: {},
      // V487: масштаб и ширина колонок запоминаются между открытиями окна —
      // человек настраивает рабочее место один раз, а не на каждый счёт.
      zoom: (() => {
        try {
          const v = parseFloat(localStorage.getItem(ZOOM_KEY));
          return Number.isFinite(v) && v >= MIN_ZOOM && v <= MAX_ZOOM ? v : 1;
        } catch (_) { return 1; }
      })(),
      zoomTouched: (() => {
        try { return !!localStorage.getItem(ZOOM_KEY); } catch (_) { return false; }
      })(),
      splitPct: (() => {
        try {
          const v = parseFloat(localStorage.getItem(SPLIT_KEY));
          return Number.isFinite(v) ? Math.max(28, Math.min(68, v)) : 46;
        } catch (_) { return 46; }
      })(),
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

    // V488: масштаб и ширина колонок применяются ЗДЕСЬ, а не в bind().
    // В bind() `state` ещё не существует — именно на этом модалка падала
    // (TypeError reading 'splitPct'), из-за чего не заполнялись договоры.
    applySplit(state.splitPct);
    applyZoom();
    // V492: после раскладки подрезаем масштаб под ширину панели, иначе лист
    // шире рамки и «ездит» внутри предпросмотра. rAF — чтобы clientWidth был
    // уже посчитан после показа окна.
    requestAnimationFrame(() => { try { clampZoomToPane(); } catch (_) { /* */ } });
    // V486: заводить ОБС-счёт могут РП и ТО, а не только админ.
    //
    // Заказчик 11.11.2026: «надо сделать, чтобы можно было в модалке добавить
    // и привязать, и чтобы РП и ТО могли это сделать тоже». Раньше кнопка была
    // скрыта для всех, кроме ADMIN, и человек без ОБС под свой объект шёл к
    // админу. Справочник ОБС — это реквизиты для письма, не денежный лимит,
    // поэтому права шире. Договоры субподряда по-прежнему только админ:
    // ошибка в лимите разрешает платежи за пределы договора.
    const OBS_ACCOUNT_ROLES = ['ADMIN', 'BUH', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'OFFICE_MANAGER'];
    el('dhObsAccountAdd').hidden = !OBS_ACCOUNT_ROLES.includes(String(role() || '').toUpperCase());

    try {
      // V490: пока идёт запрос, в списках — явное «Загружаю…».
      //
      // Заказчик: «выпадающие списки не сразу показываются, сначала они пустые».
      // Причина: списки рендерятся пустыми, а obs-options приходит после
      // (иногда секунду-две). Пустой select читается как «договоров нет».
      const loadingOpt = '<option value="" disabled selected>Загружаю…</option>';
      const accSel = el('dhObsAccount');
      const subSel = el('dhObsSub');
      if (accSel) accSel.innerHTML = loadingOpt;
      if (subSel) subSel.innerHTML = loadingOpt;

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

      // Сначала заполняем опции, потом ставим value — иначе select
      // молча сбрасывает выбранный договор/ОБС.
      const subDefault = opt.default_subcontract_id || opt.subcontract_id;
      fillAccounts(state.obsAccounts, opt.obs_account_id);
      fillSubcontracts(state.subcontracts, subDefault, Number(opt.amount_gross) || 0);
      state.specialRule = opt.special_rule || null;
      renderPreflight(opt.preflight_warnings);
      el('dhObsLetterDate').value = state.defaults.letter_date || new Date().toISOString().slice(0, 10);
      const hadDraft = restoreDraft();
      if (!hadDraft) {
        applyDefaults(true);
        applyObsFieldDefaults();
      } else if (el('dhObsLetterText').value.trim()) {
        state.composedFingerprint = el('dhObsLetterText').value.trim();
      }
      updateAccountInfo();
      updateSubInfo();
      updateItemsHint();

      // V492: текст собирается сразу при открытии.
      //
      // Заказчик 12.11.2026: «сделай так, чтобы перед созданием письма мы
      // видели текст и могли его править». Раньше человек должен был сам
      // догадаться нажать «Собрать текст», а без этого «Сохранить» оставалась
      // серой — со стороны это выглядело как «кнопка не работает».
      // Сборка идёт быстрым фолбэком (no_ai), занимает миллисекунды.
      if (!el('dhObsLetterText').value.trim()) {
        doCompose({ silent: true }).catch(() => { /* не блокируем открытие */ });
      }

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
