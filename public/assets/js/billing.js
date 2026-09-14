/**
 * ASGARD CRM — Счета и акты (vanilla)
 * Единый зал + конструктор выставления (как ТКП): работа → заказчик, позиции, живой лист, PDF, отправка.
 */
window.AsgardBillingPage = (function () {
  const PAGE = 25;
  const VAT_DEFAULT = 22;
  const ALLOWED = ['ADMIN', 'PM', 'HEAD_PM', 'BUH', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
  const WRITE_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'HEAD_PM', 'PM', 'BUH'];

  const INV_STATUSES = {
    draft: { label: 'Черновик', tone: 'draft' },
    sent: { label: 'Выставлен', tone: 'info' },
    pending: { label: 'Ожидает', tone: 'warn' },
    partial: { label: 'Частично', tone: 'warn' },
    paid: { label: 'Оплачен', tone: 'ok' },
    cancelled: { label: 'Отменён', tone: 'err' }
  };
  const ACT_STATUSES = {
    draft: { label: 'Черновик', tone: 'draft' },
    sent: { label: 'Отправлен', tone: 'info' },
    signed: { label: 'Подписан', tone: 'ok' },
    paid: { label: 'Оплачен', tone: 'ok' }
  };

  const ui = () => window.AsgardUI || {};
  const esc = (s) => (ui().esc || ((x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))))(s);
  const toast = (t, m, k) => (ui().toast || console.log)(t, m || '', k || 'ok');
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  function topModalBody() {
    const nodes = document.querySelectorAll('.cr-m-overlay #modalBody');
    return nodes.length ? nodes[nodes.length - 1] : null;
  }

  let S = {
    invoices: [],
    acts: [],
    tab: 'all',
    query: '',
    status: '',
    queue: '',
    page: 1,
    layout: null,
    title: 'Счета и акты',
    bound: false
  };
  let _ctor = null;
  let _searchTimer = 0;

  function role() {
    return AsgardAuth.getAuth()?.user?.role || '';
  }
  function canWrite() {
    return WRITE_ROLES.includes(role());
  }
  function hasAccess() {
    const r = role();
    return !r || ALLOWED.includes(r);
  }
  function money2(n) {
    const fn = ui().moneyRub || (window.AsgardMoney && AsgardMoney.formatMoney);
    if (fn) return fn(n, { fractionDigits: 2 });
    const x = Number(n);
    if (!Number.isFinite(x)) return '—';
    return x.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽';
  }
  function fmtDate(s) {
    if (ui().formatDate) return ui().formatDate(s);
    if (!s) return '—';
    const d = new Date(s);
    return Number.isFinite(d.getTime()) ? d.toLocaleDateString('ru-RU') : '—';
  }
  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }
  function addDaysISO(days) {
    const d = new Date();
    d.setDate(d.getDate() + (Number(days) || 0));
    return d.toISOString().slice(0, 10);
  }
  function displayText(value, fallback) {
    const t = String(value || '').trim();
    if (!t) return fallback == null ? '—' : fallback;
    const junk = (t.match(/[?\uFFFD]/g) || []).length;
    if (junk >= 3 || junk / t.length > 0.25) return fallback == null ? '—' : fallback;
    return t;
  }
  function emptyItem() {
    return { id: Date.now() + Math.random(), name: '', unit: 'усл.', qty: 1, price: 0 };
  }
  function parseItems(raw) {
    if (!raw) return [];
    let v = raw;
    if (typeof v === 'string') {
      try { v = JSON.parse(v); } catch (e) { return []; }
    }
    if (!Array.isArray(v)) return [];
    return v.map((it, i) => ({
      id: Date.now() + i,
      name: it.name || it.description || '',
      unit: it.unit || 'усл.',
      qty: it.qty || it.quantity || 1,
      price: it.price || 0
    }));
  }
  function calcTotals(items, vatPct) {
    let netto = 0;
    (items || []).forEach((it) => { netto += (Number(it.qty) || 0) * (Number(it.price) || 0); });
    const vat = netto * (Number(vatPct) || 0) / 100;
    return { netto, vat, total: netto + vat };
  }
  function statusMeta(kind, status) {
    const map = kind === 'act' ? ACT_STATUSES : INV_STATUSES;
    return map[status] || { label: status || '—', tone: 'draft' };
  }
  function statusOpts(tab) {
    if (tab === 'acts') return [
      { value: 'draft', label: 'Черновик' },
      { value: 'sent', label: 'Отправлен' },
      { value: 'signed', label: 'Подписан' },
      { value: 'paid', label: 'Оплачен' }
    ];
    if (tab === 'invoices') return [
      { value: 'draft', label: 'Черновик' },
      { value: 'sent', label: 'Выставлен' },
      { value: 'pending', label: 'Ожидает' },
      { value: 'partial', label: 'Частично' },
      { value: 'paid', label: 'Оплачен' },
      { value: 'cancelled', label: 'Отменён' }
    ];
    return [
      { value: 'draft', label: 'Черновик' },
      { value: 'sent', label: 'Выставлен / отправлен' },
      { value: 'pending', label: 'Ожидает оплаты' },
      { value: 'partial', label: 'Частично оплачен' },
      { value: 'signed', label: 'Подписан' },
      { value: 'paid', label: 'Оплачен' },
      { value: 'cancelled', label: 'Отменён' }
    ];
  }
  function ruCount(n, one, few, many) {
    const n10 = n % 10;
    const n100 = n % 100;
    if (n10 === 1 && n100 !== 11) return one;
    if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return few;
    return many;
  }
  function invoiceOpen(r) {
    if (r.status === 'cancelled' || r.status === 'draft') return false;
    return Number(r.total_amount || 0) > Number(r.paid_amount || 0) + 0.009;
  }
  function actUnsigned(r) {
    return r.status !== 'signed' && r.status !== 'paid';
  }
  function dueUrgency(due) {
    if (!due) return '';
    const d = new Date(due);
    if (!Number.isFinite(d.getTime())) return '';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.round((d.getTime() - today.getTime()) / 86400000);
    if (days < 0) return 'hot';
    if (days <= 3) return 'soon';
    return '';
  }
  function emitChanged() {
    window.dispatchEvent(new CustomEvent('asgard:billing:changed'));
    window.dispatchEvent(new CustomEvent('asgard:invoices:changed'));
    window.dispatchEvent(new CustomEvent('asgard:acts:changed'));
  }

  async function api(path, opts) {
    const auth = AsgardAuth.getAuth();
    const headers = Object.assign({ Authorization: 'Bearer ' + (auth && auth.token || '') }, opts && opts.headers || {});
    const init = Object.assign({}, opts || {});
    if (init.body && typeof init.body !== 'string' && !(init.body instanceof Blob)) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(init.body);
    }
    init.headers = headers;
    const resp = await fetch(path, init);
    if (opts && opts.blob) {
      if (!resp.ok) {
        const e = await resp.json().catch(() => ({}));
        throw new Error(e.message || e.error || 'HTTP ' + resp.status);
      }
      return resp.blob();
    }
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.message || data.error || 'HTTP ' + resp.status);
    return data;
  }

  function buildPayload(kind, form, totals, status) {
    const items = (form.items || [])
      .filter((it) => String(it.name || '').trim())
      .map((it) => ({
        name: String(it.name).trim(),
        unit: it.unit || 'усл.',
        qty: Number(it.qty) || 0,
        price: Number(it.price) || 0
      }));
    const base = {
      customer_name: form.customer_name || null,
      customer_inn: form.inn || null,
      customer_kpp: form.kpp || null,
      customer_address: form.address || null,
      customer_id: form.customer_id || null,
      contact_person: form.contact_person || null,
      contact_email: form.contact_email || null,
      contact_phone: form.contact_phone || null,
      work_id: form.work_id ? Number(form.work_id) : null,
      description: form.description || form.subject || null,
      items,
      items_json: items,
      amount: totals.netto,
      vat_pct: Number(form.vat_pct) || VAT_DEFAULT,
      vat_amount: totals.vat,
      total_amount: totals.total,
      status: status || form.status || 'draft'
    };
    const iss = form.issuer;
    if (iss && (iss.name || iss.full_name || iss.inn || iss.bank_rs)) {
      base.issuer = iss;
      base.issuer_json = iss;
    }
    if (kind === 'act') {
      return Object.assign({}, base, {
        act_number: form.number || undefined,
        act_date: form.date,
        act_type: form.origin === 'register' ? 'registered' : 'issued',
        signed_date: form.signed_date || null
      });
    }
    return Object.assign({}, base, {
      invoice_number: form.number || undefined,
      invoice_date: form.date,
      invoice_type: form.origin === 'register' ? 'incoming' : 'outgoing',
      due_date: form.due_date || null
    });
  }

  async function openPdf(url, doPrint) {
    const blob = await api(url, { blob: true });
    const u = URL.createObjectURL(blob);
    const w = window.open(u, '_blank');
    if (doPrint && w) setTimeout(() => { try { w.focus(); w.print(); } catch (e) {} }, 700);
    setTimeout(() => URL.revokeObjectURL(u), 60000);
  }

  function officePath(kind, id, ext) {
    return (kind === 'act' ? '/api/acts/' : '/api/invoices/') + id + '/' + ext;
  }

  function officePreviewPath(kind, ext) {
    return (kind === 'act' ? '/api/acts/preview-' : '/api/invoices/preview-') + ext;
  }

  function officeFilename(kind, rec, ext) {
    const num = rec && (kind === 'act'
      ? (rec.act_number || rec.number)
      : (rec.invoice_number || rec.number)) || 'doc';
    const safe = String(num || 'doc').replace(/[\\/:*?"<>|]+/g, '_');
    return (kind === 'act' ? 'Akt_' : 'Schet_') + safe + '.' + ext;
  }

  async function downloadOffice(url, filename, opts) {
    const blob = await api(url, Object.assign({ blob: true }, opts || {}));
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = u;
    a.download = filename || 'document';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 5000);
  }

  async function loadCompany() {
    try {
      const d = await api('/api/settings/app');
      const app = d.value || d.app || {};
      const all = await api('/api/settings').catch(() => ({}));
      const keyProfile = (all.settings && all.settings.company_profile) || {};
      const appProfile = app.company_profile || {};
      const c = Object.assign({}, appProfile, keyProfile);
      return {
        name: c.company_name || c.name || 'ООО «Асгард-Сервис»',
        full_name: c.full_name || c.company_name || c.name || 'ООО «Асгард-Сервис»',
        inn: c.inn || '',
        kpp: c.kpp || '',
        ogrn: c.ogrn || '',
        address: c.address || c.legal_address || '',
        phone: c.phone || '',
        email: c.email || '',
        director: c.director_fio || c.director_name || '',
        director_title: c.director_title || 'Генеральный директор',
        accountant: c.accountant_name || '',
        bank_name: c.bank_name || '',
        bank_rs: c.bank_rs || c.rs || '',
        bank_ks: c.bank_ks || c.ks || '',
        bank_bik: c.bank_bik || c.bik || ''
      };
    } catch (e) {
      return { name: 'ООО «Асгард-Сервис»', full_name: 'ООО «Асгард-Сервис»' };
    }
  }

  function issuerFromCompany(c) {
    c = c || {};
    return {
      name: c.name || '',
      full_name: c.full_name || c.name || '',
      inn: c.inn || '',
      kpp: c.kpp || '',
      ogrn: c.ogrn || '',
      address: c.address || c.legal_address || '',
      phone: c.phone || '',
      email: c.email || '',
      director: c.director || c.director_name || '',
      director_title: c.director_title || 'Генеральный директор',
      accountant: c.accountant || c.accountant_name || '',
      bank_name: c.bank_name || '',
      bank_rs: c.bank_rs || '',
      bank_ks: c.bank_ks || '',
      bank_bik: c.bank_bik || ''
    };
  }

  function parseIssuerJson(raw) {
    if (!raw) return null;
    if (typeof raw === 'object' && !Array.isArray(raw)) return issuerFromCompany(raw);
    if (typeof raw === 'string') {
      try { return issuerFromCompany(JSON.parse(raw)); } catch (e) { return null; }
    }
    return null;
  }

  function fillIssuerDom(iss) {
    if (!iss) return;
    $$('[data-iss]').forEach((el) => {
      const k = el.dataset.iss;
      if (Object.prototype.hasOwnProperty.call(iss, k)) el.value = iss[k] || '';
    });
  }

  function issuerFieldsHtml(iss) {
    iss = iss || {};
    return `<div class="bill-section-head">
        <strong class="bill-section-title">2. Наши реквизиты</strong>
        <button type="button" class="btn ghost mini" data-ctor="issuer-reset">Из настроек</button>
      </div>
      <p class="bill-bind-hint">По умолчанию из настроек компании. Правки сохраняются только в этом документе.</p>
      <div class="bill-grid-2">
        <div class="bill-field"><label>Краткое название</label><input class="inp" data-iss="name" value="${esc(iss.name || '')}"/></div>
        <div class="bill-field"><label>Полное название</label><input class="inp" data-iss="full_name" value="${esc(iss.full_name || '')}"/></div>
        <div class="bill-field"><label>ИНН</label><input class="inp" data-iss="inn" value="${esc(iss.inn || '')}" maxlength="12"/></div>
        <div class="bill-field"><label>КПП</label><input class="inp" data-iss="kpp" value="${esc(iss.kpp || '')}" maxlength="9"/></div>
        <div class="bill-field"><label>ОГРН</label><input class="inp" data-iss="ogrn" value="${esc(iss.ogrn || '')}"/></div>
        <div class="bill-field"><label>Телефон</label><input class="inp" data-iss="phone" value="${esc(iss.phone || '')}"/></div>
        <div class="bill-field bill-span-2"><label>Адрес</label><input class="inp" data-iss="address" value="${esc(iss.address || '')}"/></div>
        <div class="bill-field"><label>Email</label><input class="inp" data-iss="email" value="${esc(iss.email || '')}"/></div>
        <div class="bill-field"><label>Должность руководителя</label><input class="inp" data-iss="director_title" value="${esc(iss.director_title || '')}"/></div>
        <div class="bill-field"><label>Руководитель</label><input class="inp" data-iss="director" value="${esc(iss.director || '')}"/></div>
        <div class="bill-field"><label>Главный бухгалтер</label><input class="inp" data-iss="accountant" value="${esc(iss.accountant || '')}"/></div>
        <div class="bill-field"><label>Банк</label><input class="inp" data-iss="bank_name" value="${esc(iss.bank_name || '')}"/></div>
        <div class="bill-field"><label>БИК</label><input class="inp" data-iss="bank_bik" value="${esc(iss.bank_bik || '')}"/></div>
        <div class="bill-field"><label>Р/с</label><input class="inp" data-iss="bank_rs" value="${esc(iss.bank_rs || '')}"/></div>
        <div class="bill-field"><label>К/с</label><input class="inp" data-iss="bank_ks" value="${esc(iss.bank_ks || '')}"/></div>
      </div>`;
  }

  function kpi() {
    const invoices = S.invoices;
    const acts = S.acts;
    const openInv = invoices.filter(invoiceOpen);
    return {
      invSum: invoices.reduce((s, i) => s + Number(i.total_amount || 0), 0),
      invPaid: invoices.reduce((s, i) => s + Number(i.paid_amount || 0), 0),
      invLeft: openInv.reduce((s, i) => s + Math.max(0, Number(i.total_amount || 0) - Number(i.paid_amount || 0)), 0),
      actSum: acts.reduce((s, a) => s + Number(a.total_amount || 0), 0),
      unsigned: acts.filter(actUnsigned).length,
      unpaidN: openInv.length,
      invN: invoices.length,
      actN: acts.length
    };
  }

  function filteredRows() {
    const invRows = S.invoices.map((i) => Object.assign({}, i, {
      kind: 'invoice',
      number: i.invoice_number,
      date: i.invoice_date,
      sortAt: i.created_at || i.invoice_date
    }));
    const actRows = S.acts.map((a) => Object.assign({}, a, {
      kind: 'act',
      number: a.act_number,
      date: a.act_date,
      sortAt: a.created_at || a.act_date
    }));
    let list = S.tab === 'invoices' ? invRows : S.tab === 'acts' ? actRows : invRows.concat(actRows);
    list.sort((a, b) => String(b.sortAt || '').localeCompare(String(a.sortAt || '')));
    if (S.queue === 'unpaid') list = list.filter((r) => r.kind === 'invoice' && invoiceOpen(r));
    else if (S.queue === 'unsigned') list = list.filter((r) => r.kind === 'act' && actUnsigned(r));
    else if (S.status) list = list.filter((r) => r.status === S.status);
    const q = (S.query || '').trim().toLowerCase();
    if (q) {
      list = list.filter((r) =>
        (r.number || '').toLowerCase().includes(q) ||
        (r.customer_name || '').toLowerCase().includes(q) ||
        (r.customer_inn || '').includes(q) ||
        (r.description || '').toLowerCase().includes(q) ||
        (r.work_title || '').toLowerCase().includes(q) ||
        String(r.id).includes(q)
      );
    }
    return list;
  }

  function hallHtml() {
    const k = kpi();
    const write = canWrite();
    return `
      <div class="bill-page" id="billPage">
        <div class="bill-hero">
          <div>
            <div class="bill-hero-kicker">Казна</div>
            <h1>Счета и акты</h1>
            <p>Очередь выставления: как ТКП — привязать работу или заполнить вручную</p>
          </div>
          <div class="bill-hero-actions">
            <button type="button" class="btn ghost" data-bill="refresh">Обновить</button>
            ${write ? '<button type="button" class="btn ghost" data-bill="register">Внести</button>' : ''}
            ${write ? '<button type="button" class="btn ghost" data-bill="act">Акт</button>' : ''}
            ${write ? '<button type="button" class="btn primary" data-bill="invoice" title="Ctrl+N">Выставить счёт</button>' : ''}
          </div>
        </div>
        <div id="billQueue"></div>
        <div class="bill-kpis" id="billKpis"></div>
        <div class="bill-board">
          <div class="bill-board-head">
            <div class="bill-chips" role="tablist" id="billChips"></div>
            <div class="bill-toolbar">
              <input class="inp" id="billSearch" type="search" placeholder="Номер, заказчик, ИНН, работа…" value="${esc(S.query)}"/>
              <div id="billStatus_w"></div>
            </div>
          </div>
          <div id="billBody"></div>
        </div>
      </div>`;
  }

  function paintHall() {
    const k = kpi();
    const qEl = $('#billQueue');
    if (qEl) {
      let qh = '';
      if (k.unpaidN > 0 || k.unsigned > 0) {
        qh = '<div class="bill-queue">';
        if (k.unpaidN > 0) {
          qh += `<button type="button" class="bill-alert is-pay${S.queue === 'unpaid' ? ' is-on' : ''}" data-bill="unpaid">
            <span class="bill-alert-k">Очередь</span>
            <div class="bill-alert-t"><strong>К оплате ${esc(money2(k.invLeft))}</strong>
            <span>${k.unpaidN} ${ruCount(k.unpaidN, 'счёт', 'счёта', 'счетов')} без полного закрытия</span></div>
            <span class="bill-alert-go">Показать</span></button>`;
        }
        if (k.unsigned > 0) {
          qh += `<button type="button" class="bill-alert is-sign${S.queue === 'unsigned' ? ' is-on' : ''}" data-bill="unsigned">
            <span class="bill-alert-k">Подпись</span>
            <div class="bill-alert-t"><strong>Ждут подписи: ${k.unsigned}</strong>
            <span>акты ещё не подписаны заказчиком</span></div>
            <span class="bill-alert-go">Показать</span></button>`;
        }
        qh += '</div>';
      }
      qEl.innerHTML = qh;
    }
    const kpis = $('#billKpis');
    if (kpis) {
      kpis.innerHTML = `
        <button type="button" class="bill-kpi${S.tab === 'invoices' && !S.queue ? ' is-on' : ''}" data-bill="tab-invoices">
          <div class="k">Счета</div><div class="v">${k.invN}</div><div class="s">${esc(money2(k.invSum))}</div></button>
        <button type="button" class="bill-kpi is-warn${S.queue === 'unpaid' ? ' is-on' : ''}${k.unpaidN > 0 ? ' is-alert' : ''}" data-bill="unpaid">
          <div class="k">К оплате</div><div class="v">${esc(money2(k.invLeft))}</div><div class="s">пришло ${esc(money2(k.invPaid))}</div></button>
        <button type="button" class="bill-kpi is-gold${S.tab === 'acts' && !S.queue ? ' is-on' : ''}" data-bill="tab-acts">
          <div class="k">Акты</div><div class="v">${k.actN}</div><div class="s">${esc(money2(k.actSum))}</div></button>
        <button type="button" class="bill-kpi is-ok${S.queue === 'unsigned' ? ' is-on' : ''}" data-bill="unsigned">
          <div class="k">Ждут подписи</div><div class="v">${k.unsigned}</div><div class="s">не подписаны заказчиком</div></button>`;
    }
    const chips = $('#billChips');
    if (chips) {
      const items = [
        { id: 'all', label: 'Все', n: S.invoices.length + S.acts.length },
        { id: 'invoices', label: 'Счета', n: S.invoices.length },
        { id: 'acts', label: 'Акты', n: S.acts.length }
      ];
      chips.innerHTML = items.map((t) =>
        `<button type="button" class="bill-chip${S.tab === t.id && !S.queue ? ' is-on' : ''}" data-bill="tab-${t.id}">${esc(t.label)}<span class="n">${t.n}</span></button>`
      ).join('');
    }
    paintList();
  }

  function paintList() {
    const rows = filteredRows();
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    if (S.page > pages) S.page = pages;
    const slice = rows.slice((S.page - 1) * PAGE, S.page * PAGE);
    const write = canWrite();
    const body = $('#billBody');
    if (!body) return;
    if (!slice.length) {
      const filtered = !!(S.query || S.status || S.queue);
      body.innerHTML = `<div class="bill-empty">
        <h3>${filtered ? 'Ничего не нашли' : 'Документов пока нет'}</h3>
        <p>${filtered ? 'Смените фильтр или очередь' : 'Выставьте первый счёт — конструктор как у ТКП'}</p>
        ${write && !filtered ? '<button type="button" class="btn primary" data-bill="invoice">Выставить счёт</button>' : ''}
      </div>`;
      return;
    }
    body.innerHTML = `
      <div class="bill-tbl-scroll">
        <table class="bill-table">
          <thead><tr>
            <th>Документ</th><th>Заказчик</th><th>Дата</th>
            <th class="num">Сумма</th><th>Статус</th><th></th>
          </tr></thead>
          <tbody>${slice.map(rowHtml).join('')}</tbody>
        </table>
      </div>
      <div class="bill-pager">
        <button type="button" class="btn ghost mini" data-bill="prev" ${S.page <= 1 ? 'disabled' : ''}>←</button>
        <span>${S.page} / ${pages} · ${rows.length}</span>
        <button type="button" class="btn ghost mini" data-bill="next" ${S.page >= pages ? 'disabled' : ''}>→</button>
      </div>`;
  }

  function rowHtml(r) {
    const st = statusMeta(r.kind, r.status);
    const total = Number(r.total_amount || 0);
    const paid = Number(r.paid_amount || 0);
    const pct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
    const urg = r.kind === 'invoice' && invoiceOpen(r) ? dueUrgency(r.due_date) : '';
    const name = displayText(r.customer_name, 'без названия');
    const number = displayText(r.number, '#' + r.id);
    const work = displayText(r.work_title, '');
    const write = canWrite();
    return `<tr class="bill-row" data-kind="${r.kind}" data-id="${r.id}" data-status="${esc(r.status || '')}" data-urgency="${urg || ''}">
      <td><div class="bill-doc">
        <span class="bill-kind ${r.kind === 'act' ? 'is-act' : 'is-inv'}">${r.kind === 'act' ? 'Акт' : 'Счёт'}</span>
        <div><div class="bill-num">${esc(number)}</div>${work ? `<div class="bill-sub">${esc(work)}</div>` : ''}</div>
      </div></td>
      <td><div class="bill-cust">${esc(name)}</div>${r.customer_inn ? `<div class="bill-sub">ИНН ${esc(r.customer_inn)}</div>` : ''}</td>
      <td><div>${esc(fmtDate(r.date))}</div>${r.kind === 'invoice' && r.due_date ? `<span class="bill-due${urg ? ' is-' + urg : ''}">до ${esc(fmtDate(r.due_date))}</span>` : ''}</td>
      <td class="num"><div class="bill-price">${esc(money2(total))}</div>
        ${r.kind === 'invoice' ? `<div class="bill-paybar"><i style="width:${pct}%"></i></div>` : ''}</td>
      <td><span class="bill-st is-${st.tone}">${esc(st.label)}</span></td>
      <td><div class="bill-row-actions">
        <button type="button" class="btn ghost mini" data-act="pdf">PDF</button>
        <button type="button" class="btn ghost mini" data-act="docx">Word</button>
        <button type="button" class="btn ghost mini" data-act="xlsx">Excel</button>
        ${r.kind === 'invoice' && write && invoiceOpen(r) ? '<button type="button" class="btn ghost mini" data-act="pay">Оплата</button>' : ''}
        ${write ? '<button type="button" class="btn ghost mini" data-act="edit">Править</button>' : ''}
      </div></td>
    </tr>`;
  }

  function bindHall() {
    const page = $('#billPage');
    if (!page || page.dataset.bound) return;
    page.dataset.bound = '1';
    page.addEventListener('click', onHallClick);
    $('#billSearch')?.addEventListener('input', (e) => {
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(() => {
        S.query = e.target.value;
        S.page = 1;
        paintList();
      }, 280);
    });
    mountStatusSelect();
    if (!window.__asgBillKeys) {
      window.__asgBillKeys = true;
      window.addEventListener('keydown', (ev) => {
        if (ev.target && /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName)) return;
        if (!((ev.ctrlKey || ev.metaKey) && String(ev.key).toLowerCase() === 'n')) return;
        if (!$('#billPage')) return;
        if (!canWrite()) return;
        ev.preventDefault();
        openCtor({ kind: 'invoice' });
      });
    }
  }

  function mountStatusSelect() {
    const wrap = $('#billStatus_w');
    if (!wrap) return;
    wrap.innerHTML = '';
    if (window.CRSelect && CRSelect.destroy) CRSelect.destroy('billStatus');
    wrap.appendChild(CRSelect.create({
      id: 'billStatus',
      placeholder: 'Все статусы',
      clearable: true,
      options: statusOpts(S.tab),
      value: S.queue ? '' : S.status,
      onChange: (v) => {
        S.queue = '';
        S.status = v || '';
        S.page = 1;
        paintHall();
      }
    }));
  }

  function onHallClick(e) {
    const t = e.target && e.target.nodeType === 3 ? e.target.parentElement : e.target;
    if (!t || !t.closest) return;
    const actBtn = t.closest('[data-act]');
    const row = t.closest('tr.bill-row');
    if (actBtn && row) {
      e.stopPropagation();
      const kind = row.dataset.kind;
      const id = Number(row.dataset.id);
      const rec = findRow(kind, id);
      if (actBtn.dataset.act === 'pdf') return openPdf(kind === 'act' ? '/api/acts/' + id + '/pdf' : '/api/invoices/' + id + '/pdf').catch((err) => toast('PDF', String(err.message || err), 'err'));
      if (actBtn.dataset.act === 'docx' || actBtn.dataset.act === 'xlsx') {
        const ext = actBtn.dataset.act;
        return downloadOffice(officePath(kind, id, ext), officeFilename(kind, rec, ext))
          .catch((err) => toast(ext === 'xlsx' ? 'Excel' : 'Word', String(err.message || err), 'err'));
      }
      if (actBtn.dataset.act === 'pay' && rec) return openPay(rec);
      if (actBtn.dataset.act === 'edit') return openCtor({ kind, editId: id });
    }
    if (row && !actBtn) {
      return openDetail(row.dataset.kind, Number(row.dataset.id));
    }
    const btn = t.closest('[data-bill]');
    if (!btn) return;
    const a = btn.dataset.bill;
    if (a === 'refresh') return refresh();
    if (a === 'register') return openChooser();
    if (a === 'invoice') return openCtor({ kind: 'invoice' });
    if (a === 'act') return openCtor({ kind: 'act' });
    if (a === 'unpaid') {
      S.tab = 'invoices'; S.status = ''; S.queue = 'unpaid'; S.page = 1; mountStatusSelect(); paintHall(); return;
    }
    if (a === 'unsigned') {
      S.tab = 'acts'; S.status = ''; S.queue = 'unsigned'; S.page = 1; mountStatusSelect(); paintHall(); return;
    }
    if (a === 'tab-all' || a === 'tab-invoices' || a === 'tab-acts') {
      S.tab = a.replace('tab-', ''); S.status = ''; S.queue = ''; S.page = 1; mountStatusSelect(); paintHall(); return;
    }
    if (a === 'prev') { S.page = Math.max(1, S.page - 1); paintList(); }
    if (a === 'next') { S.page += 1; paintList(); }
  }

  function findRow(kind, id) {
    const list = kind === 'act' ? S.acts : S.invoices;
    return (list || []).find((x) => Number(x.id) === Number(id));
  }

  async function fetchAll() {
    try {
      const [inv, ac] = await Promise.all([
        api('/api/invoices?limit=2000'),
        api('/api/acts?limit=2000')
      ]);
      S.invoices = inv.invoices || [];
      S.acts = ac.acts || [];
    } catch (e) {
      toast('Счета и акты', 'Не удалось загрузить: ' + (e.message || e), 'err');
      S.invoices = [];
      S.acts = [];
    }
  }

  async function refresh() {
    await fetchAll();
    paintHall();
  }

  async function render({ layout, title, query, tab }) {
    S.layout = layout;
    S.title = title || 'Счета и акты';
    S.tab = tab || 'all';
    S.status = '';
    S.queue = '';
    S.page = 1;
    if (!hasAccess()) {
      await layout('<div class="help">Раздел открыт PM, бухгалтерии, директорам и ADMIN.</div>', { title: S.title });
      return;
    }
    await fetchAll();
    await layout(hallHtml(), { title: S.title });
    bindHall();
    paintHall();
    const id = query && query.id ? Number(query.id) : 0;
    if (id && (tab === 'invoices' || tab === 'acts')) {
      openDetail(tab === 'acts' ? 'act' : 'invoice', id);
    }
  }

  function needWrite() {
    if (canWrite()) return true;
    toast('Нет прав', 'Выставлять документы могут ADMIN, директора, PM, BUH', 'warn');
    return false;
  }

  function openChooser() {
    if (!needWrite()) return;
    ui().showModal({
      title: 'Что делаем?',
      subtitle: 'Выставить конструктором или внести уже существующий',
      icon: '✦',
      wide: true,
      html: `<div class="bill-choose">
        <button type="button" class="bill-choose-card is-main" data-ch="inv"><div class="badge">Конструктор</div><div class="ttl">Выставить счёт</div><div class="ds">Заказчик, позиции, НДС, живой лист, PDF / Word / Excel</div></button>
        <button type="button" class="bill-choose-card is-main" data-ch="act"><div class="badge">Конструктор</div><div class="ttl">Выставить акт</div><div class="ds">Сдача-приёмка. Можно привязать работу и подтянуть заказчика</div></button>
        <button type="button" class="bill-choose-card" data-ch="reg-inv"><div class="badge">Реестр</div><div class="ttl">Внести счёт</div><div class="ds">Уже выставлен в 1С или на бумаге — только реестр</div></button>
        <button type="button" class="bill-choose-card" data-ch="reg-act"><div class="badge">Реестр</div><div class="ttl">Внести акт</div><div class="ds">Готовый акт заказчика — зафиксировать без конструктора</div></button>
        <div class="bill-choose-hint">Конструктор — основной путь. «Внести» — для входящих документов.</div>
      </div>`,
      onMount: ({ body }) => {
        body.addEventListener('click', (ev) => {
          const b = ev.target.closest('[data-ch]');
          if (!b) return;
          ui().hideModal();
          const m = b.dataset.ch;
          if (m === 'inv') openCtor({ kind: 'invoice' });
          if (m === 'act') openCtor({ kind: 'act' });
          if (m === 'reg-inv') openRegister('invoice');
          if (m === 'reg-act') openRegister('act');
        });
      }
    });
  }

  function workLabel(w) {
    const title = displayText(w.work_title || w.work_name, 'без названия');
    const cust = displayText(w.customer_name || w.customer, '');
    const num = displayText(w.work_number, '#' + w.id);
    return `${num} · ${title}${cust ? ' · ' + cust : ''}`;
  }

  function paperHtml(kind, form, totals, company) {
    const isAct = kind === 'act';
    const items = (form.items || []).filter((it) => String(it.name || '').trim());
    const co = form.issuer || company || {};
    const coName = displayText(co.full_name || co.name, 'ООО «Асгард-Сервис»');
    const coMeta = [co.inn && 'ИНН ' + co.inn, co.kpp && 'КПП ' + co.kpp, co.phone].filter(Boolean).map((x) => displayText(x, '')).filter(Boolean).join(' · ');
    const hasBank = !!(displayText(co.bank_name, '') || displayText(co.bank_rs, ''));
    const chk = (ok, label) => `<span class="bill-check${ok ? ' is-ok' : ''}">${ok ? '✓' : '○'} ${esc(label)}</span>`;
    return `<div class="bill-paper-wrap">
      <div class="bill-paper-kicker"><span>Живой лист</span><span>${isAct ? 'Акт сдачи-приёмки' : 'Счёт на оплату'}</span></div>
      <div class="bill-checks">
        ${chk(!!String(form.customer_name || '').trim(), 'Заказчик')}
        ${chk(items.length > 0, 'Позиции')}
        ${chk(totals.total > 0, 'Сумма')}
        ${chk(!!form.number, 'Номер')}
      </div>
      <div class="bill-paper">
        <div class="bill-paper-head">
          <div class="bill-brand"><img src="/assets/img/asgard_logo.png" alt="АСГАРД-СЕРВИС"></div>
          <div class="bill-co"><div class="n">${esc(coName)}</div>${coMeta ? `<div class="m">${esc(coMeta)}</div>` : ''}</div>
        </div>
        <div class="bill-paper-rule"></div>
        <h3>${isAct ? 'Акт сдачи-приёмки выполненных работ' : 'Счёт на оплату'}</h3>
        <div class="numline">№ ${esc(form.number || 'б/н')}  ·  ${esc(fmtDate(form.date))}</div>
        ${!isAct && hasBank ? `<div class="bill-bank">
          <div><div class="k">Банк</div>${esc(displayText(co.bank_name, '—'))}</div>
          <div><div class="k">БИК</div>${esc(displayText(co.bank_bik, '—'))}</div>
          <div><div class="k">Р/с</div>${esc(displayText(co.bank_rs, '—'))}</div>
          <div><div class="k">К/с</div>${esc(displayText(co.bank_ks, '—'))}</div>
        </div>` : ''}
        <div class="bill-parties">
          <div class="party"><div class="l">${isAct ? 'Исполнитель' : 'Поставщик'}</div><div class="n">${esc(coName)}</div><div class="m">${esc(displayText(co.address, coMeta || 'реквизиты компании'))}</div></div>
          <div class="party"><div class="l">${isAct ? 'Заказчик' : 'Покупатель'}</div><div class="n">${esc(form.customer_name || '—')}</div>
            <div class="m">${esc([form.inn && 'ИНН ' + form.inn, form.kpp && 'КПП ' + form.kpp, form.address].filter(Boolean).join(' · ') || (form.customer_name ? '' : 'укажите заказчика слева'))}</div>
          </div>
        </div>
        ${form.subject || form.description ? `<div class="bill-paper-subject"><div class="l">${isAct ? 'Основание / работы' : 'Назначение'}</div><div>${esc(form.subject || form.description)}</div></div>` : ''}
        <table>
          <thead><tr><th>Наименование</th><th class="r">Ед.</th><th class="r">Кол.</th><th class="r">Цена</th><th class="r">Сумма</th></tr></thead>
          <tbody>${items.length ? items.map((it) => `<tr>
            <td>${esc(it.name || '—')}</td><td class="r">${esc(it.unit || '')}</td>
            <td class="r">${esc(it.qty || 0)}</td>
            <td class="r">${esc(money2(Number(it.price) || 0))}</td>
            <td class="r">${esc(money2((Number(it.qty) || 0) * (Number(it.price) || 0)))}</td>
          </tr>`).join('') : '<tr><td colspan="5" class="bill-paper-empty">Заполните таблицу слева — строки появятся здесь</td></tr>'}</tbody>
        </table>
        <div class="sum"><span>Без НДС</span><span>${esc(money2(totals.netto))}</span></div>
        <div class="sum"><span>НДС ${esc(form.vat_pct || VAT_DEFAULT)}%</span><span>${esc(money2(totals.vat))}</span></div>
        <div class="sum grand"><span>${isAct ? 'Всего с НДС' : 'К оплате'}</span><span>${esc(money2(totals.total))}</span></div>
        ${!isAct && form.due_date ? `<div class="bill-paper-subject bill-paper-due"><div class="l">Оплатить до</div><div class="n">${esc(fmtDate(form.due_date))}</div></div>` : ''}
        <div class="signs">
          <div class="bill-sign-col">
            <div>${esc(isAct ? 'Сдал (Исполнитель)' : (co.director_title || 'Руководитель'))}</div>
            <div class="bill-sign-mark">
              <img class="bill-sign-img" src="/assets/img/signature.png" alt="">
              <img class="bill-stamp-img" src="/assets/img/stamp.png" alt="">
            </div>
            <div class="ln"></div>
            <div>${esc(co.director || '')}</div>
          </div>
          <div></div>
          <div class="bill-sign-col">
            <div>${isAct ? 'Принял (Заказчик)' : 'Главный бухгалтер'}</div>
            <div class="ln"></div>
            <div>${esc(isAct ? (form.contact_person || '') : (co.accountant || ''))}</div>
          </div>
        </div>
      </div>
    </div>`;
  }

  function itemsTableHtml(form, totals) {
    const rows = form.items || [];
    if (!rows.length) {
      return `<div class="bill-items-card"><table class="bill-items-table"><tbody><tr><td colspan="7" class="bill-items-empty">
        Таблица как в ТКП: одна строка на всю работу или детализация.
        <div><button type="button" class="bill-items-cta" data-ctor="add">+ Добавить позицию</button></div>
      </td></tr></tbody></table></div>`;
    }
    return `<div class="bill-items-card"><table class="bill-items-table">
      <thead><tr>
        <th class="bill-col-40">№</th><th>Наименование</th><th class="bill-col-70">Ед.</th>
        <th class="bill-col-90">Кол-во</th><th class="bill-col-120">Цена</th><th class="bill-col-120">Сумма</th><th class="bill-col-40"></th>
      </tr></thead>
      <tbody>
        ${rows.map((it, i) => `<tr data-idx="${i}">
          <td class="bill-cell-idx">${i + 1}</td>
          <td><input class="inp" data-f="name" value="${esc(it.name)}" placeholder="Что делаем"/></td>
          <td><input class="inp" data-f="unit" value="${esc(it.unit)}"/></td>
          <td><input class="inp" data-f="qty" type="number" min="0" step="0.01" value="${esc(it.qty)}"/></td>
          <td><input class="inp" data-f="price" type="number" min="0" step="0.01" value="${esc(it.price)}"/></td>
          <td class="bill-totals-val">${esc(money2((Number(it.qty) || 0) * (Number(it.price) || 0)))}</td>
          <td><button type="button" class="btn ghost mini" data-ctor="rm" title="Удалить">×</button></td>
        </tr>`).join('')}
        <tr><td colspan="5" class="bill-totals-cell">НДС, %</td>
          <td colspan="2"><input class="inp" id="ctorVat" type="number" min="0" max="100" value="${esc(form.vat_pct)}"/></td></tr>
        <tr><td colspan="5" class="bill-totals-cell">Без НДС:</td><td class="bill-totals-val" id="ctorNetto">${esc(money2(totals.netto))}</td><td></td></tr>
        <tr><td colspan="5" class="bill-totals-cell">НДС ${esc(form.vat_pct)}%:</td><td class="t-right" id="ctorVatAmt">${esc(money2(totals.vat))}</td><td></td></tr>
        <tr class="bill-total-row"><td colspan="5" class="bill-total-label">ИТОГО с НДС:</td>
          <td class="bill-total-val" id="ctorGrand">${esc(money2(totals.total))}</td><td></td></tr>
      </tbody>
    </table></div>`;
  }

  function ctorFormHtml(kind, form, locked) {
    const isAct = kind === 'act';
    return `
      ${locked ? '' : `<div class="bill-seg" role="tablist">
        <button type="button" class="bill-seg-btn${!isAct ? ' on' : ''}" data-ctor="kind-invoice"><div class="t">Счёт на оплату</div><div class="d">Выставить заказчику, PDF / Word / Excel</div></button>
        <button type="button" class="bill-seg-btn${isAct ? ' on' : ''}" data-ctor="kind-act"><div class="t">Акт выполненных работ</div><div class="d">Сдача-приёмка с позициями и подписями</div></button>
      </div>`}
      <div class="bill-ctor">
        <div class="bill-ctor-form">
          <div class="bill-bind${form.work_id ? ' is-on' : ''}" id="ctorBind">
            <div class="bill-bind-top">
              <div class="lab">Привязка к работе</div>
              ${form.work_id ? '<button type="button" class="bill-bind-clear" data-ctor="unbind">Снять</button>' : ''}
            </div>
            <div id="ctorWork_w"></div>
            <div class="bill-bind-hint">${form.work_id
              ? 'Заказчик подтянут из работы. Позиции и реквизиты можно править вручную.'
              : 'Или заполните заказчика ниже вручную — как в конструкторе ТКП.'}</div>
          </div>
          <div class="bill-livebar" id="ctorLive"></div>
          <div class="bill-section-head"><strong class="bill-section-title">1. Заказчик</strong></div>
          <div class="bill-grid-2">
            <div class="bill-field"><label>Заказчик *</label><input class="inp" id="ctorName" value="${esc(form.customer_name)}" placeholder="Название или ИНН"/></div>
            <div class="bill-field"><label>ИНН</label><div class="bill-inn-row">
              <input class="inp" id="ctorInn" value="${esc(form.inn)}" maxlength="12"/>
              <button type="button" class="btn ghost" data-ctor="egrul">ЕГРЮЛ</button>
            </div></div>
            <div class="bill-field"><label>КПП</label><input class="inp" id="ctorKpp" value="${esc(form.kpp)}" maxlength="9"/></div>
            <div class="bill-field"><label>Адрес</label><input class="inp" id="ctorAddr" value="${esc(form.address)}"/></div>
            <div class="bill-field"><label>Контакт</label><input class="inp" id="ctorPerson" value="${esc(form.contact_person)}"/></div>
            <div class="bill-field"><label>Телефон</label><input class="inp" id="ctorPhone" value="${esc(form.contact_phone)}"/></div>
            <div class="bill-field bill-span-2"><label>Email</label><input class="inp" id="ctorEmail" value="${esc(form.contact_email)}" placeholder="для отправки PDF"/></div>
          </div>
          ${issuerFieldsHtml(form.issuer)}
          <div class="bill-section-head"><strong class="bill-section-title">${isAct ? '3. Предмет акта' : '3. Предмет счёта'}</strong></div>
          <div class="bill-grid-3">
            <div class="bill-field"><label>Номер</label><input class="inp" id="ctorNumber" value="${esc(form.number)}" placeholder="${isAct ? 'АКТ-2026-001' : 'СЧ-2026-001'}"/></div>
            <div class="bill-field"><label>Дата *</label><input class="inp" id="ctorDate" type="date" value="${esc(form.date)}"/></div>
            ${isAct
              ? `<div class="bill-field"><label>Дата подписания</label><input class="inp" id="ctorSigned" type="date" value="${esc(form.signed_date)}"/></div>`
              : `<div class="bill-field"><label>Оплатить до</label><input class="inp" id="ctorDue" type="date" value="${esc(form.due_date)}"/></div>`}
          </div>
          <div class="bill-field" style="margin-top:10px"><label>Наименование работ</label>
            <input class="inp" id="ctorSubject" value="${esc(form.subject)}" placeholder="Капитальный ремонт, монтаж, ПНР…"/></div>
          <div class="bill-field" style="margin-top:10px"><label>Описание / основание</label>
            <textarea class="inp" id="ctorDesc" rows="3" placeholder="Договор, доп. соглашение, объект">${esc(form.description)}</textarea></div>
          <div class="bill-section-head"><strong class="bill-section-title">4. Позиции</strong>
            <button type="button" class="btn primary" data-ctor="add">+ Строка</button></div>
          <div id="ctorItems"></div>
        </div>
        <div class="bill-ctor-preview" id="ctorPaper"></div>
      </div>
      <div class="bill-ctor-foot">
        <button type="button" class="btn ghost" data-ctor="cancel">Отмена</button>
        <div class="bill-foot-actions">
          <button type="button" class="btn ghost" data-ctor="pdf">PDF</button>
          <button type="button" class="btn ghost" data-ctor="docx">Word</button>
          <button type="button" class="btn ghost" data-ctor="xlsx">Excel</button>
          <button type="button" class="btn ghost" data-ctor="print">Печать</button>
          <button type="button" class="btn ghost" data-ctor="draft">Черновик</button>
          <button type="button" class="btn ghost" data-ctor="send">Выставить и отправить</button>
          <button type="button" class="btn primary" data-ctor="issue">${isAct ? 'Выставить акт' : 'Выставить счёт'}</button>
        </div>
      </div>`;
  }

  function bindCtorEvents(root) {
    if (!root || root.dataset.ctorBound) return;
    root.dataset.ctorBound = '1';
    root.addEventListener('click', onCtorClick);
    root.addEventListener('input', onCtorInput);
  }

  function readCtorFields() {
    if (!_ctor) return;
    const f = _ctor.form;
    f.customer_name = $('#ctorName') ? $('#ctorName').value : f.customer_name;
    f.inn = $('#ctorInn') ? $('#ctorInn').value : f.inn;
    f.kpp = $('#ctorKpp') ? $('#ctorKpp').value : f.kpp;
    f.address = $('#ctorAddr') ? $('#ctorAddr').value : f.address;
    f.contact_person = $('#ctorPerson') ? $('#ctorPerson').value : f.contact_person;
    f.contact_phone = $('#ctorPhone') ? $('#ctorPhone').value : f.contact_phone;
    f.contact_email = $('#ctorEmail') ? $('#ctorEmail').value : f.contact_email;
    f.number = $('#ctorNumber') ? $('#ctorNumber').value : f.number;
    f.date = $('#ctorDate') ? $('#ctorDate').value : f.date;
    if ($('#ctorDue')) f.due_date = $('#ctorDue').value;
    if ($('#ctorSigned')) f.signed_date = $('#ctorSigned').value;
    f.subject = $('#ctorSubject') ? $('#ctorSubject').value : f.subject;
    f.description = $('#ctorDesc') ? $('#ctorDesc').value : f.description;
    if ($('#ctorVat')) f.vat_pct = $('#ctorVat').value;
    const iss = f.issuer || (f.issuer = issuerFromCompany(_ctor.company));
    $$('[data-iss]').forEach((el) => { iss[el.dataset.iss] = el.value; });
    iss.full_name = iss.full_name || iss.name;
    f.issuer = iss;
  }

  function paintCtorLive(rebuildItems) {
    if (!_ctor) return;
    const totals = calcTotals(_ctor.form.items, Number(_ctor.form.vat_pct) || VAT_DEFAULT);
    const isAct = _ctor.kind === 'act';
    const live = $('#ctorLive');
    if (live) {
      live.innerHTML = `<div><div class="k">${isAct ? 'Акт' : 'Счёт'} ${esc(_ctor.form.number || 'б/н')}</div>
        <div class="w">${esc(_ctor.form.customer_name || 'Заказчик ещё не указан')}</div></div>
        <div class="sum">${esc(money2(totals.total))}</div>`;
    }
    const paper = $('#ctorPaper');
    if (paper) paper.innerHTML = paperHtml(_ctor.kind, _ctor.form, totals, _ctor.form.issuer || _ctor.company);
    const items = $('#ctorItems');
    if (items && rebuildItems !== false) items.innerHTML = itemsTableHtml(_ctor.form, totals);
    if (items && rebuildItems === false) {
      $$('#ctorItems tr[data-idx]').forEach((tr) => {
        const it = _ctor.form.items[Number(tr.dataset.idx)];
        const cell = tr.querySelector('td.bill-totals-val');
        if (cell && it) cell.textContent = money2((Number(it.qty) || 0) * (Number(it.price) || 0));
      });
      const netto = $('#ctorNetto'); if (netto) netto.textContent = money2(totals.netto);
      const vatAmt = $('#ctorVatAmt'); if (vatAmt) vatAmt.textContent = money2(totals.vat);
      const grand = $('#ctorGrand'); if (grand) grand.textContent = money2(totals.total);
    }
    const bind = $('#ctorBind');
    if (bind) bind.classList.toggle('is-on', !!_ctor.form.work_id);
  }

  function applyCustomer(c) {
    if (!c || !_ctor) return;
    const f = _ctor.form;
    f.customer_id = c.id || f.customer_id;
    f.customer_name = c.name || c.full_name || f.customer_name;
    f.inn = c.inn || f.inn;
    f.kpp = c.kpp || f.kpp;
    f.address = c.address || c.legal_address || f.address;
    f.contact_person = c.contact_person || f.contact_person;
    f.contact_phone = c.phone || c.contact_phone || f.contact_phone;
    f.contact_email = c.email || f.contact_email;
    if ($('#ctorName')) $('#ctorName').value = f.customer_name || '';
    if ($('#ctorInn')) $('#ctorInn').value = f.inn || '';
    if ($('#ctorKpp')) $('#ctorKpp').value = f.kpp || '';
    if ($('#ctorAddr')) $('#ctorAddr').value = f.address || '';
    if ($('#ctorPerson')) $('#ctorPerson').value = f.contact_person || '';
    if ($('#ctorPhone')) $('#ctorPhone').value = f.contact_phone || '';
    if ($('#ctorEmail')) $('#ctorEmail').value = f.contact_email || '';
    paintCtorLive();
  }

  async function applyWork(workId) {
    if (!_ctor) return;
    if (!workId) {
      _ctor.form.work_id = '';
      _ctor.form.work_label = '';
      paintCtorLive();
      return;
    }
    try {
      const full = await api('/api/works/' + workId).catch(() => null);
      const w = Object.assign({}, (_ctor.works || []).find((x) => String(x.id) === String(workId)) || {}, (full && (full.work || full)) || {});
      w.id = w.id || workId;
      const title = w.work_title || w.work_name || '';
      const customer = w.customer_name || w.customer || '';
      const inn = w.customer_inn || '';
      const vat = w.vat_pct != null ? Number(w.vat_pct) : Number(_ctor.form.vat_pct) || VAT_DEFAULT;
      const contract = Number(w.contract_value || w.contract_sum || 0);
      const netto = contract > 0 ? Math.round((contract / (1 + vat / 100)) * 100) / 100 : 0;
      const s = _ctor.form;
      const placeholder = !s.items.length || (s.items.length === 1 && !String(s.items[0].name || '').trim() && !Number(s.items[0].price));
      if (placeholder && (title || netto)) s.items = [Object.assign(emptyItem(), { name: title || 'Работы по договору', qty: 1, price: netto })];
      s.work_id = String(w.id);
      s.work_label = workLabel(w);
      s.customer_name = customer || s.customer_name;
      s.inn = inn || s.inn;
      s.contact_person = w.contact_person || s.contact_person;
      s.contact_phone = w.contact_phone || s.contact_phone;
      s.subject = title || s.subject;
      s.description = title || s.description;
      s.vat_pct = String(vat);
      if ($('#ctorName')) $('#ctorName').value = s.customer_name || '';
      if ($('#ctorInn')) $('#ctorInn').value = s.inn || '';
      if ($('#ctorSubject')) $('#ctorSubject').value = s.subject || '';
      if ($('#ctorDesc')) $('#ctorDesc').value = s.description || '';
      paintCtorLive();
      if (inn) {
        api('/api/customers/lookup/' + encodeURIComponent(inn)).then((res) => {
          const c = res && (res.suggestion || res.customer || (res.found ? res : null));
          if (c && (c.name || c.kpp || c.address)) applyCustomer(c);
        }).catch(() => {});
      }
      toast('Работа', 'Заказчик и сумма подтянуты — можно править', 'ok');
    } catch (e) {
      toast('Работа', String(e.message || e), 'err');
    }
  }

  async function persistCtor(status) {
    readCtorFields();
    const form = _ctor.form;
    const totals = calcTotals(form.items, Number(form.vat_pct) || VAT_DEFAULT);
    const liveItems = (form.items || []).filter((it) => String(it.name || '').trim());
    if (!String(form.customer_name || '').trim()) { toast('Проверка', 'Укажите заказчика', 'warn'); return null; }
    if (!form.date) { toast('Проверка', 'Укажите дату', 'warn'); return null; }
    if (!liveItems.length) { toast('Проверка', 'Добавьте хотя бы одну позицию', 'warn'); return null; }
    if (!(totals.total > 0)) { toast('Проверка', 'Сумма должна быть больше нуля', 'warn'); return null; }
    const payload = buildPayload(_ctor.kind, form, totals, status);
    const isAct = _ctor.kind === 'act';
    try {
      let saved;
      if (_ctor.editId && _ctor.editKind === _ctor.kind) {
        saved = isAct
          ? await api('/api/acts/' + _ctor.editId, { method: 'PUT', body: payload })
          : await api('/api/invoices/' + _ctor.editId, { method: 'PUT', body: payload });
      } else {
        saved = isAct
          ? await api('/api/acts', { method: 'POST', body: payload })
          : await api('/api/invoices', { method: 'POST', body: payload });
      }
      const row = saved.act || saved.invoice || saved;
      emitChanged();
      refresh();
      return row;
    } catch (e) {
      toast('Не удалось сохранить', String(e.message || e), 'err');
      return null;
    }
  }

  function destroyCtorSelects() {
    try { CRSelect.destroy('ctorWork'); } catch (e) {}
    try { CRSelect.destroy('regWork'); } catch (e) {}
  }

  function mountWorkSelect() {
    const wrap = $('#ctorWork_w');
    if (!wrap || !window.CRSelect) return;
    try { CRSelect.destroy('ctorWork'); } catch (e) {}
    wrap.innerHTML = '';
    const opts = [{ value: '', label: '— Без привязки —' }].concat(
      (_ctor.works || []).slice(0, 400).map((w) => ({ value: String(w.id), label: workLabel(w) }))
    );
    wrap.appendChild(CRSelect.create({
      id: 'ctorWork',
      searchable: true,
      clearable: true,
      dropdownClass: 'z-modal',
      placeholder: 'Найти работу — подтянется заказчик, ИНН и сумма',
      options: opts,
      value: _ctor.form.work_id || '',
      onChange: (v) => applyWork(v)
    }));
  }

  function openCtor({ kind, editId }) {
    if (!needWrite()) return;
    const startKind = kind || 'invoice';
    _ctor = {
      kind: startKind,
      editId: editId || null,
      editKind: editId ? startKind : null,
      form: {
        number: '',
        date: todayISO(),
        due_date: addDaysISO(14),
        signed_date: '',
        work_id: '',
        work_label: '',
        customer_id: null,
        customer_name: '',
        inn: '', kpp: '', address: '',
        contact_person: '', contact_phone: '', contact_email: '',
        subject: '', description: '',
        vat_pct: String(VAT_DEFAULT),
        items: [emptyItem()],
        origin: 'issue',
        status: 'draft',
        issuer: {}
      },
      works: [],
      company: null,
      busy: false
    };
    const locked = !!editId;
    const title = editId ? (startKind === 'act' ? 'Акт' : 'Счёт') : (startKind === 'act' ? 'Новый акт' : 'Новый счёт');
    ui().showModal({
      title,
      subtitle: 'Можно привязать работу или заполнить вручную',
      icon: startKind === 'act' ? '📄' : '🧾',
      fullscreen: true,
      html: `<div class="bill-ctor-root">${ctorFormHtml(startKind, _ctor.form, locked)}</div>`,
      onMount: async ({ body }) => {
        bindCtorEvents(body);
        _ctor.company = await loadCompany();
        try {
          const wd = await api('/api/works?limit=500');
          _ctor.works = wd.works || wd.items || [];
        } catch (e) { _ctor.works = []; }
        if (editId) {
          try {
            const d = startKind === 'act' ? await api('/api/acts/' + editId) : await api('/api/invoices/' + editId);
            const row = d.act || d.invoice || d;
            const items = parseItems(row.items_json || row.items);
            _ctor.form = Object.assign(_ctor.form, {
              number: row.act_number || row.invoice_number || '',
              date: String(row.act_date || row.invoice_date || '').slice(0, 10) || todayISO(),
              due_date: String(row.due_date || '').slice(0, 10) || '',
              signed_date: String(row.signed_date || '').slice(0, 10) || '',
              work_id: row.work_id ? String(row.work_id) : '',
              customer_id: row.customer_id || null,
              customer_name: row.customer_name || '',
              inn: row.customer_inn || '',
              kpp: row.customer_kpp || '',
              address: row.customer_address || '',
              contact_person: row.contact_person || '',
              contact_phone: row.contact_phone || '',
              contact_email: row.contact_email || '',
              subject: row.description || '',
              description: row.description || '',
              vat_pct: row.vat_pct != null ? String(row.vat_pct) : String(VAT_DEFAULT),
              items: items.length ? items : [emptyItem()],
              origin: (row.invoice_type === 'incoming' || row.act_type === 'registered') ? 'register' : 'issue',
              status: row.status || 'draft',
              issuer: parseIssuerJson(row.issuer_json) || issuerFromCompany(_ctor.company)
            });
            ui().replaceModal({
              title: (startKind === 'act' ? 'Акт № ' : 'Счёт № ') + (_ctor.form.number || editId),
              subtitle: _ctor.form.work_id ? 'Работа привязана' : 'Можно привязать работу или заполнить вручную',
              icon: startKind === 'act' ? '📄' : '🧾',
              fullscreen: true,
              html: `<div class="bill-ctor-root">${ctorFormHtml(_ctor.kind, _ctor.form, true)}</div>`
            });
            bindCtorEvents(topModalBody());
          } catch (e) {
            toast('Документ', 'Не удалось загрузить: ' + (e.message || e), 'err');
          }
        } else {
          _ctor.form.issuer = issuerFromCompany(_ctor.company);
          fillIssuerDom(_ctor.form.issuer);
          const kindAtFetch = startKind;
          const next = startKind === 'act' ? '/api/acts/next-number' : '/api/invoices/next-number';
          api(next).then((d) => {
            if (!_ctor || _ctor.kind !== kindAtFetch) return;
            const el = $('#ctorNumber');
            if (d && d.number && el && !el.value) {
              _ctor.form.number = d.number;
              el.value = d.number;
              paintCtorLive(false);
            }
          }).catch(() => {});
        }
        mountWorkSelect();
        paintCtorLive();
      }
    });
  }

  function onCtorInput(e) {
    if (!_ctor) return;
    const tr = e.target.closest('tr[data-idx]');
    if (tr && e.target && e.target.dataset && e.target.dataset.f) {
      const i = Number(tr.dataset.idx);
      const f = e.target.dataset.f;
      const v = e.target.value;
      _ctor.form.items[i][f] = v;
      paintCtorLive(false);
      return;
    }
    readCtorFields();
    paintCtorLive(false);
  }

  async function onCtorClick(e) {
    const b = e.target.closest('[data-ctor]');
    if (!b || !_ctor) return;
    const a = b.dataset.ctor;
    if (a === 'cancel') { destroyCtorSelects(); ui().hideModal(); return; }
    if (a === 'add') {
      readCtorFields();
      _ctor.form.items.push(emptyItem());
      paintCtorLive();
      return;
    }
    if (a === 'rm') {
      const tr = e.target.closest('tr[data-idx]');
      if (!tr) return;
      readCtorFields();
      _ctor.form.items.splice(Number(tr.dataset.idx), 1);
      paintCtorLive();
      return;
    }
    if (a === 'unbind') { applyWork(''); if (window.CRSelect) CRSelect.setValue('ctorWork', ''); return; }
    if (a === 'kind-invoice' || a === 'kind-act') {
      if (_ctor.editId) return;
      const next = a === 'kind-act' ? 'act' : 'invoice';
      if (next === _ctor.kind) return;
      readCtorFields();
      _ctor.kind = next;
      _ctor.form.number = '';
      if (next === 'invoice' && !_ctor.form.due_date) _ctor.form.due_date = addDaysISO(14);
      ui().replaceModal({
        title: next === 'act' ? 'Новый акт' : 'Новый счёт',
        subtitle: 'Можно привязать работу или заполнить вручную',
        icon: next === 'act' ? '📄' : '🧾',
        fullscreen: true,
        html: `<div class="bill-ctor-root">${ctorFormHtml(_ctor.kind, _ctor.form, false)}</div>`
      });
      bindCtorEvents(topModalBody());
      mountWorkSelect();
      paintCtorLive();
      const url = next === 'act' ? '/api/acts/next-number' : '/api/invoices/next-number';
      const kindAtFetch = next;
      api(url).then((d) => {
        if (!_ctor || _ctor.kind !== kindAtFetch) return;
        const el = $('#ctorNumber');
        if (d && d.number && el) {
          _ctor.form.number = d.number;
          el.value = d.number;
          paintCtorLive(false);
        }
      }).catch(() => {});
      return;
    }
    if (a === 'issuer-reset') {
      readCtorFields();
      try {
        _ctor.company = await loadCompany();
        _ctor.form.issuer = issuerFromCompany(_ctor.company);
        fillIssuerDom(_ctor.form.issuer);
        paintCtorLive(false);
        toast('Реквизиты', 'Подставлены из настроек компании', 'ok');
      } catch (err) {
        toast('Реквизиты', String(err.message || err), 'err');
      }
      return;
    }
    if (a === 'egrul') {
      readCtorFields();
      const inn = String(_ctor.form.inn || '').replace(/\D/g, '');
      if (inn.length < 10) return toast('ИНН', 'Введи 10 или 12 цифр', 'warn');
      try {
        const res = await api('/api/customers/lookup/' + encodeURIComponent(inn));
        const c = res && (res.suggestion || res.customer || (res.found ? res : null));
        if (c && (c.name || c.full_name)) { applyCustomer(c); toast('ЕГРЮЛ', 'Заполнено из реестра', 'ok'); }
        else toast('ИНН', 'В реестре не найдено', 'warn');
      } catch (err) {
        toast('ЕГРЮЛ', String(err.message || err), 'err');
      }
      return;
    }
    if (a === 'docx' || a === 'xlsx') {
      readCtorFields();
      const form = _ctor.form;
      const totals = calcTotals(form.items, Number(form.vat_pct) || VAT_DEFAULT);
      if (!String(form.customer_name || '').trim()) return toast('Проверка', 'Укажите заказчика', 'warn');
      if (!(form.items || []).some((it) => String(it.name || '').trim())) return toast('Проверка', 'Добавьте позицию', 'warn');
      try {
        const ext = a;
        await downloadOffice(
          officePreviewPath(_ctor.kind, ext),
          officeFilename(_ctor.kind, form, ext),
          { method: 'POST', body: buildPayload(_ctor.kind, form, totals, 'draft') }
        );
      } catch (err) {
        toast(a === 'xlsx' ? 'Excel' : 'Word', String(err.message || err), 'err');
      }
      return;
    }
    if (a === 'pdf' || a === 'print') {
      readCtorFields();
      const form = _ctor.form;
      const totals = calcTotals(form.items, Number(form.vat_pct) || VAT_DEFAULT);
      if (!String(form.customer_name || '').trim()) return toast('Проверка', 'Укажите заказчика', 'warn');
      if (!(form.items || []).some((it) => String(it.name || '').trim())) return toast('Проверка', 'Добавьте позицию', 'warn');
      try {
        const url = _ctor.kind === 'act' ? '/api/acts/preview-pdf' : '/api/invoices/preview-pdf';
        const blob = await api(url, { method: 'POST', body: buildPayload(_ctor.kind, form, totals, 'draft'), blob: true });
        const u = URL.createObjectURL(blob);
        const w = window.open(u, '_blank');
        if (a === 'print' && w) setTimeout(() => { try { w.focus(); w.print(); } catch (e) {} }, 700);
        setTimeout(() => URL.revokeObjectURL(u), 60000);
      } catch (err) {
        toast(a === 'print' ? 'Печать' : 'PDF', String(err.message || err), 'err');
      }
      return;
    }
    if (a === 'draft') {
      const row = await persistCtor('draft');
      if (row) { toast('Черновик', 'Сохранён', 'ok'); destroyCtorSelects(); ui().hideModal(); }
      return;
    }
    if (a === 'issue') {
      const row = await persistCtor('sent');
      if (row) {
        toast(_ctor.kind === 'act' ? 'Акт выставлен' : 'Счёт выставлен', '', 'ok');
        destroyCtorSelects();
        ui().hideModal();
      }
      return;
    }
    if (a === 'send') {
      const row = await persistCtor('sent');
      if (!row || !row.id) return;
      destroyCtorSelects();
      ui().hideModal();
      openSend(_ctor.kind, row);
    }
  }

  function openRegister(kind) {
    if (!needWrite()) return;
    const isAct = kind === 'act';
    ui().showModal({
      title: isAct ? 'Внести акт' : 'Внести счёт',
      subtitle: 'Если документ уже выставлен на бумаге / в 1С — зафиксируйте его в CRM',
      icon: '📥',
      wide: true,
      html: `<div class="bill-grid-2">
        <div class="bill-field"><label>Номер</label><input class="inp" id="regNumber"/></div>
        <div class="bill-field"><label>Дата *</label><input class="inp" id="regDate" type="date" value="${todayISO()}"/></div>
        <div class="bill-field bill-span-2"><label>Контрагент *</label><input class="inp" id="regName"/></div>
        <div class="bill-field"><label>ИНН</label><input class="inp" id="regInn" maxlength="12"/></div>
        <div class="bill-field"><label>Работа</label><div id="regWork_w"></div></div>
        <div class="bill-field"><label>Сумма без НДС *</label><input class="inp" id="regAmount" type="number" min="0" step="0.01"/></div>
        <div class="bill-field"><label>НДС %</label><input class="inp" id="regVat" type="number" min="0" max="100" value="${VAT_DEFAULT}"/></div>
        ${isAct ? '' : '<div class="bill-field"><label>Оплатить до</label><input class="inp" id="regDue" type="date"/></div>'}
        <div class="bill-field bill-span-2"><label>Описание</label><textarea class="inp" id="regDesc" rows="2"></textarea></div>
      </div>
      <div class="bill-ctor-foot">
        <button type="button" class="btn ghost" id="regCancel">Отмена</button>
        <button type="button" class="btn primary" id="regSave">Сохранить</button>
      </div>`,
      onMount: async ({ body }) => {
        let works = [];
        try { works = (await api('/api/works?limit=500')).works || []; } catch (e) {}
        body.querySelector('#regWork_w').appendChild(CRSelect.create({
          id: 'regWork',
          searchable: true,
          dropdownClass: 'z-modal',
          options: [{ value: '', label: '— Без привязки —' }].concat(works.map((w) => ({ value: String(w.id), label: workLabel(w) })))
        }));
        const next = isAct ? '/api/acts/next-number' : '/api/invoices/next-number';
        api(next).then((d) => { if (d.number) $('#regNumber').value = d.number; }).catch(() => {});
        $('#regCancel').onclick = () => ui().hideModal();
        $('#regSave').onclick = async () => {
          const date = $('#regDate').value;
          const customerName = $('#regName').value.trim();
          const amount = Number($('#regAmount').value);
          const vatPct = Number($('#regVat').value) || 0;
          if (!date) return toast('Проверка', 'Укажите дату', 'warn');
          if (!customerName) return toast('Проверка', 'Укажите контрагента', 'warn');
          if (!(amount > 0)) return toast('Проверка', 'Сумма должна быть больше нуля', 'warn');
          const total = amount + (amount * vatPct) / 100;
          const workId = CRSelect.getValue('regWork');
          try {
            if (isAct) {
              await api('/api/acts', { method: 'POST', body: {
                act_number: $('#regNumber').value || undefined,
                act_date: date, customer_name: customerName,
                customer_inn: $('#regInn').value || undefined,
                work_id: workId ? Number(workId) : null,
                amount, vat_pct: vatPct, total_amount: total,
                description: $('#regDesc').value.trim() || undefined,
                status: 'signed', act_type: 'registered'
              }});
              toast('Акт внесён', '', 'ok');
            } else {
              await api('/api/invoices', { method: 'POST', body: {
                invoice_number: $('#regNumber').value || undefined,
                invoice_date: date, customer_name: customerName,
                customer_inn: $('#regInn').value || undefined,
                work_id: workId ? Number(workId) : null,
                amount, vat_pct: vatPct, total_amount: total,
                description: $('#regDesc').value.trim() || undefined,
                due_date: $('#regDue') && $('#regDue').value || null,
                status: 'pending', invoice_type: 'incoming'
              }});
              toast('Счёт внесён', '', 'ok');
            }
            emitChanged();
            refresh();
            ui().hideModal();
          } catch (err) {
            toast('Ошибка', String(err.message || err), 'err');
          }
        };
      }
    });
  }

  function openPay(invoice) {
    if (!needWrite()) return;
    const total = Number(invoice.total_amount || 0);
    const paid = Number(invoice.paid_amount || 0);
    const remaining = Math.max(0, total - paid);
    ui().showModal({
      title: 'Внести оплату',
      subtitle: 'Счёт № ' + (invoice.invoice_number || invoice.id),
      icon: '💰',
      html: `<div class="bill-pay-info">
        <div class="k">Сумма счёта</div><div class="v accent">${esc(money2(total))}</div>
        <div class="k">Уже оплачено</div><div class="v ok">${esc(money2(paid))}</div>
        <div class="k">Остаток</div><div class="v ${remaining > 0 ? 'warn' : 'ok'}">${esc(money2(remaining))}</div>
      </div>
      <div class="bill-field" style="margin-top:12px"><label>Сумма платежа *</label><input class="inp" id="payAmt" type="number" min="0.01" step="0.01" value="${esc(remaining)}"/></div>
      <div class="bill-field" style="margin-top:10px"><label>Дата *</label><input class="inp" id="payDate" type="date" value="${todayISO()}"/></div>
      <div class="bill-field" style="margin-top:10px"><label>Комментарий</label><textarea class="inp" id="payCmt" rows="2" placeholder="п/п №12345"></textarea></div>
      <div class="bill-ctor-foot">
        <button type="button" class="btn ghost" id="payCancel">Отмена</button>
        <button type="button" class="btn primary" id="paySave">Внести платёж</button>
      </div>`,
      onMount: ({ body }) => {
        $('#payCancel').onclick = () => ui().hideModal();
        $('#paySave').onclick = async () => {
          const amt = Number($('#payAmt').value);
          if (!(amt > 0)) return toast('Проверка', 'Сумма платежа должна быть положительной', 'warn');
          try {
            await api('/api/invoices/' + invoice.id + '/payments', {
              method: 'POST',
              body: { amount: amt, payment_date: $('#payDate').value, comment: $('#payCmt').value.trim() || undefined }
            });
            toast('Платёж внесён', '', 'ok');
            emitChanged();
            refresh();
            ui().hideModal();
          } catch (err) {
            toast('Ошибка', String(err.message || err), 'err');
          }
        };
      }
    });
  }

  function openSend(kind, doc) {
    const isAct = kind === 'act';
    const number = isAct ? (doc.act_number || doc.id) : (doc.invoice_number || doc.id);
    const greet = doc.contact_person ? 'Здравствуйте, ' + String(doc.contact_person).split(' ')[0] + '!' : 'Добрый день!';
    const bodyTxt = [
      greet, '',
      isAct ? 'Во вложении направляем акт выполненных работ № ' + number + '.' : 'Во вложении направляем счёт на оплату № ' + number + '.',
      doc.total_amount ? 'Сумма: ' + money2(doc.total_amount) + '.' : '',
      '', 'Готовы ответить на вопросы.', '', 'С уважением,', 'ООО «Асгард-Сервис»'
    ].filter((x, i, arr) => !(x === '' && arr[i - 1] === '')).join('\n');
    ui().showModal({
      title: isAct ? 'Отправить акт' : 'Отправить счёт',
      subtitle: '№ ' + number + ' · ' + (doc.customer_name || ''),
      icon: '📤',
      wide: true,
      html: `<div class="bill-grid-2 bill-send">
        <div>
          <div class="bill-field"><label>Кому *</label><input class="inp" id="sendTo" value="${esc(doc.contact_email || '')}"/></div>
          <div class="bill-field"><label>Копия (Cc)</label><input class="inp" id="sendCc"/></div>
          <div class="bill-field"><label>Тема</label><input class="inp" id="sendSubj" value="${esc(isAct ? 'Акт выполненных работ № ' + number : 'Счёт на оплату № ' + number)}"/></div>
          <div class="bill-field"><label>Текст письма</label><textarea class="inp" id="sendBody" rows="8">${esc(bodyTxt)}</textarea></div>
        </div>
        <div>
          <div class="bill-eyebrow">Вложение</div>
          <div style="font-weight:700">${isAct ? 'Акт' : 'Счёт'} № ${esc(number)}.pdf</div>
          <div class="bill-sub">${esc(money2(doc.total_amount))} · ${esc(fmtDate(doc.act_date || doc.invoice_date))}</div>
          <button type="button" class="bill-linkish" id="sendPdf" style="margin-top:10px">Открыть PDF</button>
          <div class="bill-send-note" style="margin-top:12px">Письмо уйдёт с корпоративной почты. Получатель увидит документ как PDF-вложение.</div>
        </div>
      </div>
      <div class="bill-ctor-foot">
        <button type="button" class="btn ghost" id="sendCancel">Отмена</button>
        <button type="button" class="btn primary" id="sendGo">Отправить</button>
      </div>`,
      onMount: ({ body }) => {
        $('#sendCancel').onclick = () => ui().hideModal();
        $('#sendPdf').onclick = () => openPdf(isAct ? '/api/acts/' + doc.id + '/pdf' : '/api/invoices/' + doc.id + '/pdf').catch((err) => toast('PDF', String(err.message || err), 'err'));
        $('#sendGo').onclick = async () => {
          const to = $('#sendTo').value.trim();
          if (!to) return toast('Проверка', 'Укажите адрес получателя', 'warn');
          if (!/.+@.+\..+/.test(to)) return toast('Проверка', 'Невалидный email', 'warn');
          try {
            const url = isAct ? '/api/acts/' + doc.id + '/send' : '/api/invoices/' + doc.id + '/send';
            await api(url, { method: 'POST', body: { to, cc: $('#sendCc').value, subject: $('#sendSubj').value, body: $('#sendBody').value } });
            toast('Отправлено', to, 'ok');
            emitChanged();
            ui().hideModal();
          } catch (err) {
            toast('Отправка', String(err.message || err), 'err');
          }
        };
      }
    });
  }

  function kv(label, value) {
    if (value == null || value === '') return '';
    return `<div class="bill-kv"><div class="c-t3">${esc(label)}</div><div>${esc(value)}</div></div>`;
  }

  async function openDetail(kind, id) {
    const isAct = kind === 'act';
    ui().showModal({
      title: isAct ? 'Акт' : 'Счёт',
      subtitle: '#' + id,
      icon: isAct ? '📄' : '🧾',
      wide: true,
      html: '<div class="t-center p-40 c-t3">Загружаем…</div>',
      onMount: async () => {
        try {
          const d = isAct ? await api('/api/acts/' + id) : await api('/api/invoices/' + id);
          const row = d.act || d.invoice || d;
          const payments = d.payments || [];
          paintDetail(kind, row, payments);
        } catch (e) {
          ui().replaceModal({ title: 'Не найдено', html: '<p>Запись удалена или недоступна.</p>', wide: true });
        }
      }
    });
  }

  function paintDetail(kind, row, payments) {
    const isAct = kind === 'act';
    const write = canWrite();
    const st = statusMeta(kind, row.status);
    const number = isAct ? (row.act_number || row.id) : (row.invoice_number || row.id);
    const remaining = Math.max(0, Number(row.total_amount || 0) - Number(row.paid_amount || 0));
    const items = parseItems(row.items_json || row.items);
    ui().replaceModal({
      title: (isAct ? 'Акт № ' : 'Счёт № ') + number,
      subtitle: fmtDate(row.act_date || row.invoice_date),
      icon: isAct ? '📄' : '🧾',
      wide: true,
      html: `<div class="bill-detail">
        <div class="bill-detail-bar">
          <span class="bill-st is-${st.tone}">${esc(st.label)}</span>
          <div style="margin-left:auto;font-weight:800;color:var(--gold)">${esc(money2(row.total_amount))}</div>
        </div>
        ${kv('Заказчик', displayText(row.customer_name, ''))}
        ${kv('ИНН', row.customer_inn)}
        ${kv('КПП', row.customer_kpp)}
        ${kv('Адрес', row.customer_address)}
        ${kv('Работа', row.work_title || row.work_number)}
        ${kv('Описание', row.description)}
        ${!isAct ? kv('Оплатить до', fmtDate(row.due_date)) : ''}
        ${isAct ? kv('Подписан', fmtDate(row.signed_date)) : ''}
        ${items.length ? `<table class="bill-items-table" style="margin-top:12px"><thead><tr><th>Наименование</th><th>Ед.</th><th class="num">Кол.</th><th class="num">Цена</th></tr></thead>
          <tbody>${items.map((it) => `<tr><td>${esc(it.name)}</td><td>${esc(it.unit)}</td><td class="num">${esc(it.qty)}</td><td class="num">${esc(money2(it.price))}</td></tr>`).join('')}</tbody></table>` : ''}
        ${!isAct && payments.length ? `<div class="bill-payments" style="margin-top:12px">${payments.map((p) =>
          `<div class="bill-payment-row"><span class="date">${esc(fmtDate(p.payment_date))}</span><span>${esc(p.comment || '')}</span><span class="amount">${esc(money2(p.amount))}</span></div>`
        ).join('')}</div>` : ''}
        ${!isAct && remaining > 0 ? `<div class="bill-sub" style="margin-top:8px">Остаток ${esc(money2(remaining))}</div>` : ''}
        <div class="bill-ctor-foot">
          <button type="button" class="btn ghost" data-d="close">Закрыть</button>
          <div class="bill-foot-actions">
            <button type="button" class="btn ghost" data-d="pdf">PDF</button>
            <button type="button" class="btn ghost" data-d="docx">Word</button>
            <button type="button" class="btn ghost" data-d="xlsx">Excel</button>
            <button type="button" class="btn ghost" data-d="print">Печать</button>
            ${write ? '<button type="button" class="btn ghost" data-d="send">Отправить</button>' : ''}
            ${write ? '<button type="button" class="btn ghost" data-d="edit">Править</button>' : ''}
            ${write && !isAct && remaining > 0 ? '<button type="button" class="btn ghost" data-d="pay">Оплата</button>' : ''}
            ${write && isAct && actUnsigned(row) ? '<button type="button" class="btn ghost" data-d="sign">Подписать</button>' : ''}
            ${write ? '<button type="button" class="btn ghost" data-d="del">Удалить</button>' : ''}
          </div>
        </div>
      </div>`
    });
    const bodyEl = topModalBody();
    if (!bodyEl) return;
    bodyEl.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-d]');
      if (!b) return;
      const a = b.dataset.d;
      if (a === 'close') return ui().hideModal();
      if (a === 'pdf' || a === 'print') {
        return openPdf(isAct ? '/api/acts/' + row.id + '/pdf' : '/api/invoices/' + row.id + '/pdf', a === 'print')
          .catch((err) => toast(a === 'print' ? 'Печать' : 'PDF', String(err.message || err), 'err'));
      }
      if (a === 'docx' || a === 'xlsx') {
        return downloadOffice(officePath(kind, row.id, a), officeFilename(kind, row, a))
          .catch((err) => toast(a === 'xlsx' ? 'Excel' : 'Word', String(err.message || err), 'err'));
      }
      if (a === 'send') { ui().hideModal(); return openSend(kind, row); }
      if (a === 'edit') { ui().hideModal(); return openCtor({ kind, editId: row.id }); }
      if (a === 'pay') { ui().hideModal(); return openPay(row); }
      if (a === 'sign') {
        if (!confirm('Отметить акт подписанным?')) return;
        try {
          await api('/api/acts/' + row.id, { method: 'PUT', body: { status: 'signed', signed_date: row.signed_date || todayISO() } });
          toast('Акт подписан', '', 'ok'); emitChanged(); refresh(); ui().hideModal();
        } catch (err) { toast('Ошибка', String(err.message || err), 'err'); }
      }
      if (a === 'del') {
        if (!confirm(isAct ? 'Удалить акт?' : 'Удалить счёт?')) return;
        try {
          await api((isAct ? '/api/acts/' : '/api/invoices/') + row.id, { method: 'DELETE' });
          toast('Удалено', '', 'ok'); emitChanged(); refresh(); ui().hideModal();
        } catch (err) { toast('Ошибка', String(err.message || err), 'err'); }
      }
    });
  }

  window.addEventListener('asgard:billing:changed', () => { if ($('#billPage')) refresh(); });

  return { render };
})();
