/**
 * Doc Hub — реестр счетов / СФ / УПД (vanilla).
 * API: /api/doc-registry · визуал: assets/css/doc-hub.css
 */
window.AsgardDocHubPage = (function () {
  'use strict';

  const ROLES = [
    'ADMIN', 'BUH', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'DIRECTOR',
    'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'PROC', 'WAREHOUSE', 'OFFICE_MANAGER'
  ];
  // D-201: зеркало бэкендного WH_ROLES (src/routes/doc-registry.js:20). Действие
  // «Склад» (quick action=wh) доступно только складу/бух/admin — бэк отдаёт 403
  // остальным. Кнопку остальным НЕ показываем, иначе роль видит действие,
  // которое всегда падает.
  const WH_ROLES = ['WAREHOUSE', 'ADMIN', 'BUH'];
  // Selectable VAT rates: null = без НДС, 0 = 0%, 0.05/0.1/0.2/0.22 = ставка
  const VAT_RATES = [
    { label: 'Без НДС', value: null },
    { label: '0%',  value: 0 },
    { label: '5%',  value: 0.05 },
    { label: '10%', value: 0.1 },
    { label: '20%', value: 0.2 },
    { label: '22%', value: 0.22 }
  ];
  const DEFAULT_VAT_RATE = 0.22;

  /**
   * Shared VAT calculator (wizard step 2 + drawer).
   * @param {number} gross  - брутто сумма
   * @param {number|null} rateOrNull - ставка (0.22 и т.д.) или null (без НДС)
   */
  function recalcVat(gross, rateOrNull) {
    const g = Number(gross) || 0;
    if (rateOrNull === null || rateOrNull === undefined) {
      return { gross: g, net: g, vat: 0, hasVat: false };
    }
    const r = Number(rateOrNull);
    if (!(r > 0)) return { gross: g, net: g, vat: 0, hasVat: true }; // 0% ставка
    const net = Math.round((g / (1 + r)) * 100) / 100;
    const vat = Math.round((g - net) * 100) / 100;
    return { gross: g, net, vat, hasVat: true };
  }

  const OPS_OPTIONS = [
    ['', 'Все статусы'],
    ['draft', 'Черновик'],
    ['wait_pay', 'К оплате'],
    ['paid', 'Оплачен'],
    ['wait_sf', 'Ждём СФ'],
    ['wait_closing', 'Ждём закрывающие'],
    ['wh_transfer', 'У склада'],
    ['out_sent', 'Исходящий'],
    ['done', 'Готово'],
    ['cancelled', 'Отмена']
  ];

  const state = {
    view: 'registry', // registry | guide
    dir: 'all',
    kpi: 'all',
    q: '',
    scope: 'mine', // только в памяти модуля; F5 → mine
    facetCounterparty: '',
    facetOps: '',
    facetIncomplete: false,
    quarter: '',
    year: '',
    facets: { counterparties: [] },
    rows: [],
    total: 0,
    kpiData: {},
    selectedId: null,
    wizStep: 1,
    wizDraft: null,
    loading: false,
    coachOpen: true
  };

  function esc(s) {
    return (window.AsgardUI && AsgardUI.esc) ? AsgardUI.esc(s) : String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function toast(t, m, k) {
    if (window.AsgardUI && AsgardUI.toast) AsgardUI.toast(t, m, k);
    else console.log(t, m);
  }
  function money(n, opts) {
    const x = Number(n);
    const v = Number.isFinite(x) ? x : 0;
    const max = (opts && opts.fraction != null) ? opts.fraction : (Math.abs(v % 1) > 1e-9 ? 2 : 0);
    return v.toLocaleString('ru-RU', { minimumFractionDigits: max > 0 ? 2 : 0, maximumFractionDigits: max }) + ' ₽';
  }
  function moneyFine(n) {
    return money(n, { fraction: 2 });
  }
  function fmtDate(d) {
    if (!d) return '—';
    const s = String(d).slice(0, 10);
    const [y, m, day] = s.split('-');
    if (!y || !m || !day) return esc(d);
    return `${day}.${m}.${y}`;
  }
  function authHeaders(json) {
    const tok = (window.AsgardAuth && AsgardAuth.token) || localStorage.getItem('asgard_token');
    const h = { Authorization: 'Bearer ' + tok };
    if (json !== false) h['Content-Type'] = 'application/json';
    return h;
  }
  // D-201: роль текущего пользователя (localStorage тише и надёжнее, чем дёргать API).
  function role() {
    try {
      const u = JSON.parse(localStorage.getItem('asgard_user') || '{}');
      return u.role || '';
    } catch (_) {
      return '';
    }
  }
  function canWh() { return WH_ROLES.includes(role()); }

  /** API GET /api/users → { users: [...] }; never return a bare object. */
  function parseUsersList(j) {
    if (!j) return [];
    if (Array.isArray(j)) return j;
    if (Array.isArray(j.users)) return j.users;
    if (Array.isArray(j.items)) return j.items;
    if (Array.isArray(j.data)) return j.data;
    return [];
  }
  /** API GET /api/works → { works: [...] }. */
  function parseWorksList(j) {
    if (!j) return [];
    if (Array.isArray(j)) return j;
    if (Array.isArray(j.works)) return j.works;
    if (Array.isArray(j.items)) return j.items;
    if (Array.isArray(j.data)) return j.data;
    return [];
  }
  function workLabel(w) {
    if (!w) return '';
    const t = w.work_title || w.title || w.name || w.object_name || '';
    return '#' + w.id + (t ? (' ' + t) : '');
  }
  function userLabel(u) {
    if (!u) return '';
    return u.name || u.full_name || u.username || ('ID ' + u.id);
  }
  function docSummary(row) {
    if (!row) return '';
    const no = row.invoice_number ? ('Счёт ' + row.invoice_number) : ('Документ #' + row.id);
    const cp = row.counterparty_name || '—';
    const amt = money(row.amount_gross);
    return no + ' · ' + cp + ' · ' + amt;
  }
  function currentUserId() {
    try {
      const u = JSON.parse(localStorage.getItem('asgard_user') || '{}');
      return u.id || null;
    } catch (_) { return null; }
  }

  async function confirm(title, body) {
    if (window.AsgardConfirm && typeof AsgardConfirm.open === 'function') {
      return !!(await AsgardConfirm.open({ title, body }));
    }
    return window.confirm(String(body || title));
  }

  /**
   * Подсказки контрагента для Doc Hub (мастер + карточка).
   * 1) наша база `/api/customers` (тут есть телефон/почта, которых нет у DaData);
   * 2) DaData: точный lookup по ИНН (10/12 цифр) либо suggest по названию.
   * Формат опций совпадает с CRAutocomplete (value/label/sublabel + полезные поля).
   */
  function normDigits(s) { return String(s || '').replace(/\D/g, ''); }

  async function dhCustomerFetch(path) {
    const r = await fetch(path, { headers: authHeaders(false), cache: 'no-store' });
    if (!r.ok) return null;
    try { return await r.json(); } catch (_) { return null; }
  }

  async function dhCounterpartySuggest(q) {
    const query = String(q || '').trim();
    if (query.length < 2) return [];
    const isDigits = /^\d+$/.test(query);
    const out = [];

    // 1) Наша база контрагентов
    try {
      const j = await dhCustomerFetch('/api/customers?search=' + encodeURIComponent(query) + '&limit=15');
      for (const c of (j && j.customers) || []) {
        const name = c.name || c.full_name || '';
        if (!name) continue;
        const bits = ['в базе'];
        if (c.inn) bits.unshift('ИНН ' + c.inn);
        if (c.phone) bits.push(c.phone);
        out.push({
          value: name, label: name,
          sublabel: bits.join(' · '),
          inn: c.inn || '', email: c.email || '', phone: c.phone || '',
          _source: 'local'
        });
      }
    } catch (_) { /* база недоступна — не блокируем */ }

    // 2) DaData / ЕГРЮЛ
    try {
      if (isDigits && (query.length === 10 || query.length === 12)) {
        const d = await dhCustomerFetch('/api/customers/lookup/' + query);
        const s = d && d.suggestion;
        if (s && s.name) {
          out.push({
            value: s.name, label: s.name,
            sublabel: 'ИНН ' + (s.inn || query) + ' · ЕГРЮЛ',
            inn: s.inn || query, email: '', phone: '', kpp: s.kpp || '', _source: 'dadata'
          });
        }
      } else if (!isDigits && query.length >= 3) {
        const d = await dhCustomerFetch('/api/customers/suggest?q=' + encodeURIComponent(query) + '&type=party');
        for (const s of (d && d.suggestions) || []) {
          const name = (s && s.name) || '';
          if (!name) continue;
          // не дублируем то, что уже есть в нашей базе тем же ИНН
          if (s.inn && out.some((x) => x._source === 'local' && normDigits(x.inn) === normDigits(s.inn))) continue;
          out.push({
            value: name, label: name,
            sublabel: 'ИНН ' + (s.inn || '—') + ' · ЕГРЮЛ',
            inn: s.inn || '', email: '', phone: '', kpp: s.kpp || '', _source: 'dadata'
          });
        }
      }
    } catch (_) { /* DaData недоступна — остаются локальные */ }

    return out;
  }

  /**
   * Применить выбранного контрагента к полям.
   * scope: 'wiz' (мастер, шаг 2) | 'dr' (карточка, drawer).
   */
  function dhApplyCounterparty(scope, item, opts) {
    if (!item) return;
    opts = opts || {};
    const name = item.value || item.label || '';
    const inn = normDigits(item.inn) || '';
    const email = item.email || '';
    const phone = item.phone || '';

    if (scope === 'wiz') {
      const form = document.getElementById('dhWizForm');
      const d = state.wizDraft;
      if (d) { d.counterparty_name = name; if (inn) d.counterparty_inn = inn; if (email) d.counterparty_email = email; if (phone) d.counterparty_phone = phone; }
      const set = (sel, val) => { const el = form && form.querySelector(sel); if (el && val) el.value = val; };
      set('#dhWizCpName', name);
      set('#dhWizInn', inn);
      set('#dhWizEmail', email);
      set('#dhWizPhone', phone);
    } else {
      const d = document.getElementById('dhDrawer');
      const set = (sel, val) => { const el = d && d.querySelector(sel); if (el && val) el.value = val; };
      set('#drCpName', name);
      set('#drCpInn', inn);
      set('#drCpEmail', email);
      set('#drCpPhone', phone);
    }

    // Новый контрагент из ЕГРЮЛ — предложить создать карточку
    if (opts.askCreate && item._source === 'dadata' && inn) {
      dhPromptCreateCustomer({ inn, name, email, phone });
    }
  }

  /** Подтверждение создания карточки контрагента (+ POST /api/customers). */
  async function dhPromptCreateCustomer({ inn, name, email, phone }) {
    const exists = await dhCustomerFetch('/api/customers/' + inn).catch(() => null);
    if (exists && exists.customer) return; // уже есть карточка
    const ok = await confirm('Создать контрагента?',
      `${name}\nИНН ${inn}\n\nКарточки с таким ИНН нет в базе. Создать?`);
    if (!ok) return;
    try {
      const r = await fetch('/api/customers', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ inn, name, email: email || null, phone: phone || null })
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error((j && (j.error || j.message)) || ('HTTP ' + r.status));
      toast('Контрагент', 'Карточка создана: ' + name, 'ok');
    } catch (e) {
      toast('Контрагент', e.message || 'Не удалось создать карточку', 'err');
    }
  }

  /**
   * Contract picker: list by counterparty name/INN + optional create link.
   * AsgardContractsPage.openContractSelector expects counterparty_id (DB id), not INN.
   */
  function openDhContractPicker({ inn, cpName, onSelect }) {
    const ACP = window.AsgardContractsPage;
    const done = (c) => { if (typeof onSelect === 'function' && c) onSelect(c); };
    const hasCp = !!(String(inn || '').trim() || String(cpName || '').trim());

    async function buildFromAll() {
      let list = [];
      try {
        if (ACP && typeof ACP.getAll === 'function') list = await ACP.getAll();
        else if (window.AsgardDB && AsgardDB.getAll) list = (await AsgardDB.getAll('contracts')) || [];
      } catch (_) { list = []; }
      const qInn = String(inn || '').replace(/\D/g, '');
      const qName = String(cpName || '').toLowerCase().trim();
      const filtered = list.filter((c) => {
        const cInn = String(c.counterparty_inn || c.inn || c.customer_inn || c.counterparty_id || '').replace(/\D/g, '');
        const cName = String(c.counterparty_name || c.customer_name || c.party_name || '').toLowerCase();
        if (qInn && cInn && (cInn === qInn || cInn.includes(qInn) || qInn.includes(cInn))) return true;
        if (qName && cName && (cName.includes(qName) || qName.includes(cName.slice(0, 8)))) return true;
        return false;
      });
      showInlineContractModal(filtered, done, qName || qInn, hasCp, { inn, cpName });
    }

    buildFromAll().catch(() => {
      toast('Договоры', 'Не удалось загрузить реестр договоров', 'err');
    });
  }

  function showInlineContractModal(contracts, onSelect, hint, scoped, ctx) {
    document.getElementById('dhContractModal')?.remove();
    const all = contracts || [];
    const ACP = window.AsgardContractsPage;
    const wrap = document.createElement('div');
    wrap.id = 'dhContractModal';
    wrap.className = 'dh-cmodal';
    const itemHtml = (c) => {
      const label = c.number || c.label || ('#' + c.id);
      const sub = [c.subject, c.counterparty_name || c.customer_name, c.amount != null ? money(c.amount) : '']
        .filter(Boolean).join(' · ');
      return `<button type="button" class="dh-cmodal__item" data-id="${esc(String(c.id))}"
        data-label="${esc(label)}" data-date="${esc(String(c.date || c.signed_at || c.start_date || '').slice(0, 10))}">
        <div class="t">${esc(label)}</div>
        <div class="s">${esc(sub || '—')}</div>
      </button>`;
    };
    const emptyText = scoped
      ? 'У этого контрагента договоров нет. Создайте новый — он привяжется автоматически.'
      : 'Договоров нет. Создайте первый.';
    wrap.innerHTML = `
      <div class="dh-cmodal__card" role="dialog" aria-modal="true">
        <header class="dh-cmodal__head">
          <strong>Выберите договор</strong>
          <button type="button" class="dh-cmodal__x" aria-label="Закрыть">✕</button>
        </header>
        <div class="dh-cmodal__hint">${scoped
          ? ('Договоры контрагента: ' + esc(hint || '—'))
          : (hint ? esc(hint) : 'Контрагент не выбран — сначала укажите контрагента в мастере')}</div>
        ${scoped ? '' : '<div class="dh-cmodal__search"><input type="text" id="dhCmodalQ" placeholder="Поиск по номеру, предмету, контрагенту…" autocomplete="off"/></div>'}
        <div class="dh-cmodal__list" id="dhCmodalList">${all.length ? all.map(itemHtml).join('') : ('<div class="dh-empty dh-empty--sm"><div class="dh-empty__t">Нет договоров</div><p>' + esc(emptyText) + '</p></div>')}</div>
        <footer class="dh-cmodal__foot">
          <button type="button" class="dh-btn dh-btn--ghost" id="dhCmodalCancel">Отмена</button>
          <button type="button" class="dh-btn dh-btn--primary" id="dhCmodalCreate">+ Создать договор</button>
        </footer>
      </div>`;
    document.body.appendChild(wrap);
    const listEl = wrap.querySelector('#dhCmodalList');
    const qEl = wrap.querySelector('#dhCmodalQ');
    const bindItems = () => {
      listEl.querySelectorAll('.dh-cmodal__item').forEach((btn) => {
        btn.addEventListener('click', () => {
          onSelect({ id: btn.getAttribute('data-id'), label: btn.getAttribute('data-label'), number: btn.getAttribute('data-label'), date: btn.getAttribute('data-date') });
          close();
        });
      });
    };
    if (qEl) {
      // P1.4: фильтрация списка договоров по debounce 250мс.
      const _cmodalFilter = () => {
        const s = qEl.value.toLowerCase().trim();
        const hit = all.filter((c) => {
          if (!s) return true;
          const hay = [c.number, c.label, c.subject, c.counterparty_name, c.customer_name, c.counterparty_id, c.customer_inn].filter(Boolean).join(' ').toLowerCase();
          return hay.includes(s);
        });
        listEl.innerHTML = hit.length ? hit.map(itemHtml).join('') : '<div class="dh-empty dh-empty--sm"><div class="dh-empty__t">Ничего не найдено</div></div>';
        bindItems();
      };
      qEl.addEventListener('input', (window.AsgardDebounce ? AsgardDebounce(_cmodalFilter, 250) : _cmodalFilter));
    }
    bindItems();
    const close = () => wrap.remove();
    wrap.querySelector('.dh-cmodal__x')?.addEventListener('click', close);
    wrap.querySelector('#dhCmodalCancel')?.addEventListener('click', close);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
    wrap.querySelector('#dhCmodalCreate')?.addEventListener('click', () => {
      close();
      const preset = { name: (ctx && ctx.cpName) || '', inn: (ctx && ctx.inn) || '', type: 'supplier' };
      if (ACP && typeof ACP.openContractModal === 'function') {
        ACP.openContractModal(null, [], {
          preset,
          onSaved: (data) => {
            // Сразу связываем созданный договор со строкой и закрываем пикер
            onSelect({ id: data.id, number: data.number, label: data.number, date: data.start_date || '' });
          }
        });
      } else {
        location.hash = '#/contracts';
        toast('Договоры', 'Откройте создание договора', 'ok');
      }
    });
    setTimeout(() => qEl && qEl.focus(), 30);
  }

  async function api(path, opts = {}) {
    const r = await fetch('/api/doc-registry' + path, {
      ...opts,
      headers: { ...authHeaders(opts.json !== false && !(opts.body instanceof FormData)), ...(opts.headers || {}) },
      cache: 'no-store'
    });
    const text = await r.text();
    let j = null;
    try { j = text ? JSON.parse(text) : null; } catch (_) { j = { raw: text }; }
    if (!r.ok) {
      const err = new Error((j && (j.error || j.message)) || ('HTTP ' + r.status));
      err.status = r.status;
      err.body = j;
      throw err;
    }
    return j;
  }

  // D-211 (B3): в карточке печаталось СЫРОЕ значение wh_status («await»), а не
  // человеческий статус. Список — зеркало WH_CHAIN из src/routes/doc-registry.js:21.
  // Неизвестное значение печатаем как есть (лучше код, чем пустота) — но известные
  // все переведены. Отдельно от statusLabel: у таблицы и карточки разная семантика.
  function whLabel(row) {
    const map = {
      none: 'не задействован',
      await: 'у склада (ждёт обработки)',
      received: 'склад обработал',
      to_office: 'в пути в офис',
      buh_ok: 'принято бухгалтерией'
    };
    const v = row.wh_status;
    if (!v || v === 'none') {
      // цепочка склада могла идти через ops_status (историческая запись)
      if (row.ops_status === 'wh_transfer') return map.await;
      return '—';
    }
    return map[v] || String(v);
  }

  function statusLabel(row) {
    if (row.overdue_pay || row.pay_status === 'overdue') return 'Просрочка оплаты';
    if (row.overdue_sf) return 'Просрочка СФ';
    if (row.ops_status === 'done' || (row.pay_status === 'paid' && row.closing_json && !row.is_incomplete)) return 'Закрыто';
    if (row.wh_status === 'to_office') return 'В пути в офис';
    if (row.wh_status === 'await' || row.ops_status === 'wh_transfer') return 'У склада';
    if (row.is_incomplete) return 'Дозаполнить';
    if (row.dir === 'out' && row.ops_status === 'out_sent') return 'Выставлено';
    if (row.dir === 'out') return 'Черновик исх.';
    if (row.ops_status === 'wait_sf' || row.ops_status === 'wait_closing') return 'Ждём СФ';
    if (row.ops_status === 'wait_pay') return row.dir === 'out' ? 'Ждём оплату' : 'К оплате';
    if (row.ops_status === 'paid' || row.pay_status === 'paid') return 'Оплачен';
    const map = Object.fromEntries(OPS_OPTIONS.filter(([k]) => k));
    return map[row.ops_status] || 'В работе';
  }

  function incompleteReasonsText(row) {
    const reasons = Array.isArray(row.incomplete_reasons) ? row.incomplete_reasons : [];
    const labels = {
      no_invoice_number: 'нет № счёта',
      no_invoice_date: 'нет даты',
      no_counterparty: 'нет контрагента',
      no_contract: 'нет привязанного договора (режим «Привязать»)',
      no_payment_due: 'нет срока оплаты',
      no_work: 'нет объекта (для вида «Работы»)'
    };
    if (!reasons.length) return 'дозаполните обязательные поля';
    return reasons.map((r) => labels[r] || r).join(', ');
  }

  function nextActionText(row) {
    if (row.is_incomplete) {
      return 'Дозаполните: ' + incompleteReasonsText(row);
    }
    if (row.overdue_pay || (row.pay_status === 'overdue')) {
      return 'Просрочена оплата — отправьте в очередь согласования («К оплате»).';
    }
    if (row.dir === 'in' && row.pay_status !== 'paid' && row.pay_status !== 'n_a') {
      return 'Оплата только через очередь #/approval-payment, не «отметить оплаченным» здесь.';
    }
    if (row.overdue_sf || ['wait_sf', 'wait_closing'].includes(row.ops_status)) {
      return 'Ждём закрывающие: отметьте СФ/УПД после получения скана или ЭДО.';
    }
    if (row.wh_status && ['await', 'received', 'to_office'].includes(row.wh_status)) {
      return 'Цепочка склада: следующий шаг — «Склад».';
    }
    if (row.dir === 'out') {
      return 'Исходящий: проверьте выставление, связь с актом и выгрузку в 1С.';
    }
    if (!row.onec_id) return 'Документ ещё не связан с 1С — можно выгрузить CSV.';
    return 'Проверьте вложения и при необходимости отправьте позиции «В каталог».';
  }

  function buildQuery() {
    const p = new URLSearchParams();
    p.set('scope', state.scope);
    p.set('limit', '200');
    if (state.dir === 'in' || state.dir === 'out') p.set('dir', state.dir);
    if (state.q) p.set('q', state.q);
    if (state.facetCounterparty) p.set('counterparty', state.facetCounterparty);
    if (state.facetOps) p.set('ops_status', state.facetOps);
    if (state.facetIncomplete || state.kpi === 'incomplete') p.set('incomplete', '1');
    if (state.kpi === 'pay') p.set('kpi', 'pay');
    if (state.kpi === 'sf') p.set('kpi', 'sf');
    if (state.kpi === 'wh') p.set('kpi', 'wh');
    if (state.kpi === 'out') p.set('dir', 'out');
    if (state.kpi === '1c') p.set('kpi', '1c');
    if (state.kpi === 'incomplete') p.set('kpi', 'incomplete');
    if (state.quarter) p.set('quarter', String(state.quarter));
    if (state.year) p.set('year', String(state.year));
    p.set('sort', 'invoice_date');
    return '?' + p.toString();
  }

  async function loadFacets() {
    try {
      const f = await api('/facets?scope=' + encodeURIComponent(state.scope));
      const list = f.counterparties || f.counterparty || f.items || [];
      state.facets = {
        counterparties: Array.isArray(list)
          ? list.map((x) => (typeof x === 'string' ? x : (x.name || x.counterparty_name || ''))).filter(Boolean)
          : []
      };
    } catch (_) {
      state.facets = { counterparties: [] };
    }
  }

  async function loadData() {
    state.loading = true;
    try {
      const [list, kpi] = await Promise.all([
        api('/' + buildQuery()),
        api('/kpi?scope=' + encodeURIComponent(state.scope))
      ]);
      state.rows = list.items || list.rows || list.data || [];
      state.total = list.total != null ? list.total : state.rows.length;
      state.kpiData = kpi || {};
    } finally {
      state.loading = false;
    }
  }

  function kpiVal(key) {
    const k = state.kpiData || {};
    return k[key] != null ? k[key] : '—';
  }
  function kpiSub(key) {
    const k = state.kpiData || {};
    const n = (x) => (x != null && x !== '—' ? Number(x) : 0);
    if (key === 'all') {
      const t = n(k.all);
      return t ? (state.scope === 'all' ? 'в выборке · все строки' : 'только ваши') : 'нет документов';
    }
    if (key === 'pay') return n(k.pay) ? 'с просроченным сроком' : 'в норме';
    if (key === 'sf') {
      const od = n(k.sf_overdue);
      return od ? `${od} просрочены` : (n(k.sf) ? 'ждём закрывающие' : '—');
    }
    if (key === 'wh') return n(k.wh) ? 'ждут передачи в офис' : '—';
    if (key === 'out') return n(k.out) ? 'СФ / УПД по проектам' : '—';
    if (key === 'no_1c') return n(k.no_1c) ? 'к выгрузке' : 'всё связано';
    if (key === 'incomplete') return n(k.incomplete) ? 'дозаполнить' : 'всё полное';
    return '';
  }

  function rowClass(row) {
    const cls = ['dh-tr'];
    if (row.is_incomplete) cls.push('is-incomplete');
    if (row.overdue_pay || row.pay_status === 'overdue' ||
      (row.payment_due_at && row.pay_status !== 'paid' && row.payment_due_at < new Date().toISOString().slice(0, 10))) {
      cls.push('is-overdue-pay');
    } else if (row.overdue_sf || (row.sf_due_at && ['wait_sf', 'wait_closing'].includes(row.ops_status)
      && row.sf_due_at < new Date().toISOString().slice(0, 10))) {
      cls.push('is-overdue-sf');
    }
    if (row.dir === 'out') cls.push('is-out');
    if (state.selectedId === row.id) cls.push('is-selected');
    return cls.join(' ');
  }

  function statusPill(row) {
    const label = statusLabel(row);
    let kind = 'muted';
    if (row.overdue_pay || row.pay_status === 'overdue') kind = 'err';
    else if (row.overdue_sf) kind = 'warn';
    else if (row.ops_status === 'done' || label === 'Закрыто') kind = 'ok';
    else if (row.dir === 'out' && row.ops_status === 'out_sent') kind = 'ok';
    else if (row.wh_status === 'to_office' || row.ops_status === 'wh_transfer') kind = 'gold';
    else if (['wait_sf', 'wait_closing'].includes(row.ops_status)) kind = 'warn';
    else if (row.is_incomplete) kind = 'info';
    else if (row.dir === 'out') kind = 'muted';
    else if (row.wh_status && row.wh_status !== 'none') kind = 'warn';
    else if (row.ops_status === 'wait_pay') kind = 'warn';
    return `<span class="dh-pill dh-pill--${kind}"><span class="dh-dot"></span>${esc(label)}</span>`;
  }
  function vatCell(row) {
    if (row.has_vat === false || row.has_vat === 0 || row.has_vat === '0') {
      return `<span class="dh-pill dh-pill--muted">без НДС</span>`;
    }
    const rate = row.vat_rate != null ? Number(row.vat_rate) : DEFAULT_VAT_RATE;
    const rateLabel = Math.round(rate * 100) + '%';
    let vatAmt = Number(row.vat_amount);
    if (!(vatAmt > 0)) {
      const gross = Number(row.amount_gross) || 0;
      if (gross > 0 && rate > 0) vatAmt = Math.round((gross - gross / (1 + rate)) * 100) / 100;
    }
    if (!(vatAmt > 0)) {
      return `<span class="dh-pill dh-pill--ok">НДС ${rateLabel}</span>`;
    }
    return `<div class="dh-stack"><span class="dh-pill dh-pill--ok">НДС ${rateLabel}</span><span class="b">${money(vatAmt)}</span></div>`;
  }
  function contractCell(row) {
    const label = String(row.contract_label || '').trim();
    const mode = contractModeLabel(row.contract_mode);
    if (label) {
      return `<div class="dh-stack"><span class="a">${esc(label)}</span><span class="b">${esc(mode)}</span></div>`;
    }
    return `<span class="dh-muted">${esc(mode)}</span>`;
  }
  function receiveChannelLabel(ch) {
    const raw = String(ch || '').trim().toLowerCase();
    if (!raw) return '';
    if (/^(edo|эдо)$/i.test(raw)) return 'ЭДО';
    if (/scan|скан|скан\s*копи/i.test(raw)) return 'скан';
    if (/original|оригинал/i.test(raw)) return 'оригинал';
    return String(ch).trim();
  }
  function receiveCell(row) {
    const label = receiveChannelLabel(row.receive_channel);
    if (!label) return '<span class="dh-muted">—</span>';
    let kind = 'muted';
    if (label === 'ЭДО') kind = 'info';
    else if (label === 'скан') kind = 'warn';
    else if (label === 'оригинал') kind = 'ok';
    return `<span class="dh-pill dh-pill--${kind}">${esc(label)}</span>`;
  }
  function ownersCell(row) {
    const owner = row.doc_owner_name || '—';
    const pm = row.pm_name || '—';
    return `<div class="dh-stack"><span class="a" title="Отв. за документ">${esc(owner)}</span><span class="b" title="РП">${esc(pm)}</span></div>`;
  }
  function payCell(row) {
    const due = fmtDate(row.payment_due_at);
    if (row.pay_status === 'paid') {
      return `<span class="dh-pill dh-pill--ok">оплачен</span><div class="dh-subline">${due}</div>`;
    }
    if (row.overdue_pay || row.pay_status === 'overdue') {
      return `<span class="dh-pill dh-pill--err">просрочен</span><div class="dh-subline">до ${due}</div>`;
    }
    if (row.pay_status === 'wait' || row.ops_status === 'wait_pay' || row.payment_due_at) {
      return `<span class="dh-pill dh-pill--warn">ждём</span><div class="dh-subline">до ${due}</div>`;
    }
    return `<span class="dh-muted">—</span>`;
  }
  function closingCell(row) {
    const closing = Array.isArray(row.closing_json) && row.closing_json[0] ? row.closing_json[0] : null;
    if (!closing) return '<span class="dh-pill dh-pill--warn">нет СФ/УПД</span>';
    return `<div class="dh-stack"><span class="a">${esc((closing.kind || 'СФ') + ': ' + (closing.no || 'б/н'))}</span><span class="b">${fmtDate(closing.date)}</span></div>`;
  }
  function whCell(row) {
    const w = whLabel(row);
    if (!w || w === '—' || w === 'не у склада') return '<span class="dh-muted">—</span>';
    const hot = row.wh_status && !['none', 'buh_ok'].includes(row.wh_status);
    return `<span class="dh-pill dh-pill--${hot ? 'warn' : 'muted'}">${esc(w)}</span>`;
  }
  function purposeFlags(row) {
    return `<div class="dh-flags">
      <span class="dh-flag ${row.purpose_customer ? 'is-on' : ''}" title="На объект заказчика">З</span>
      <span class="dh-flag ${row.purpose_asgard ? 'is-on' : ''}" title="Собственность АСГАРД">А</span>
      <span class="dh-flag ${row.purpose_consumables ? 'is-on' : ''}" title="Расходники">Р</span>
    </div>`;
  }
  function qaIcons() {
    return {
      pay: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16v10H4zM4 10h16M8 14h2"/></svg><span class="lbl">Опл</span>',
      sf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4M9 13h6M9 17h4"/></svg><span class="lbl">СФ</span>',
      wh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 10l9-6 9 6v10H3z"/><path d="M9 20v-6h6v6"/></svg><span class="lbl">Скл</span>',
      open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 6l6 6-6 6"/></svg><span class="lbl">Кар</span>'
    };
  }
  function contractModeLabel(mode) {
    return ({
      none: 'Без договора', linked: 'Привязан', once: 'Разовая поставка',
      general: 'Общий / заявка', created: 'Создать позже'
    })[mode] || mode || '—';
  }

  function quarterLabel(q, y) {
    const roman = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV' };
    return `${roman[q] || q} квартал ${y}`;
  }
  function quarterOf(row) {
    const s = String(row.invoice_date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const y = +s.slice(0, 4);
    const m = +s.slice(5, 7);
    return { y, q: Math.floor((m - 1) / 3) + 1, key: `${y}-Q${Math.floor((m - 1) / 3) + 1}` };
  }

  function renderTable() {
    if (!state.rows.length) {
      return `<div class="dh-empty"><div class="dh-empty__ico">◇</div><div class="dh-empty__t">Пока пусто</div><p>Нажмите «Внести документ» или включите «Показать все».</p></div>`;
    }
    const ico = qaIcons();
    // Keep API order (invoice_date DESC) so quarter separators work
    const rows = state.rows;
    const parts = [];
    let prevKey = null;
    rows.forEach((r) => {
      const qinfo = quarterOf(r);
      const key = qinfo ? qinfo.key : 'none';
      if (key !== prevKey) {
        if (qinfo) {
          const isTransition = prevKey && prevKey !== 'none';
          parts.push(`<tr class="dh-qtr-sep" data-qtr="${qinfo.q}" data-year="${qinfo.y}">
            <td colspan="14"><div class="dh-qtr-sep__in ${isTransition ? 'is-next' : ''}">
              ${isTransition ? '<span class="dh-qtr-sep__arrow">↓</span>' : ''}
              <strong>${esc(quarterLabel(qinfo.q, qinfo.y))}</strong>
              <span class="dh-qtr-sep__hint">по дате документа</span>
            </div></td>
          </tr>`);
        } else {
          parts.push(`<tr class="dh-qtr-sep" data-qtr="0"><td colspan="14"><div class="dh-qtr-sep__in"><strong>Без даты документа</strong></div></td></tr>`);
        }
        prevKey = key;
      }
      parts.push(`<tr class="${rowClass(r)}" data-id="${r.id}">
        <td>${statusPill(r)}</td>
        <td><span class="dh-pill dh-pill--${r.dir === 'out' ? 'gold' : 'info'}">${r.dir === 'out' ? 'исх.' : 'вх.'}</span></td>
        <td>
          <div class="dh-stack"><span class="a dh-mono">${esc(r.invoice_number || 'б/н')}</span><span class="b">${fmtDate(r.invoice_date)}</span></div>
        </td>
        <td>
          <div class="dh-stack"><span class="a">${esc(r.counterparty_name)}</span><span class="b dh-muted">${r.inn ? ('ИНН ' + esc(r.inn)) : esc(r.counterparty_email || r.email || '—')}</span></div>
        </td>
        <td class="dh-col-work"><div class="dh-stack"><span class="a">${esc(r.work_title || 'без объекта')}</span><span class="b">${r.work_id ? ('#' + r.work_id) : '—'}</span></div></td>
        <td class="dh-col-contract">${contractCell(r)}</td>
        <td class="dh-col-recv">${receiveCell(r)}</td>
        <td class="dh-col-purpose">${purposeFlags(r)}</td>
        <td class="dh-col-owners">${ownersCell(r)}</td>
        <td class="dh-money" title="${esc(moneyFine(r.amount_gross))}">${money(r.amount_gross)}</td>
        <td class="dh-col-vat">${vatCell(r)}</td>
        <td>${payCell(r)}</td>
        <td class="dh-col-sf">${closingCell(r)}</td>
        <td class="dh-actions">
          <div class="dh-qa" aria-label="Действия">
            <button type="button" data-qa="pay" title="К оплате" ${r.pay_status === 'paid' ? 'disabled' : ''}>${ico.pay}</button>
            <button type="button" data-qa="sf" title="СФ получена">${ico.sf}</button>
            ${canWh() ? `<button type="button" data-qa="wh" title="Склад">${ico.wh}</button>` : ''}
            <button type="button" data-qa="open" title="Карточка">${ico.open}</button>
            <button type="button" class="dh-cmt-btn${r.comment_text ? ' is-filled' : ''}" data-cmt="${r.id}" data-comment="${esc(r.comment_text || '')}" title="${r.comment_text ? esc(String(r.comment_text).slice(0, 60)) : 'Комментарий'}" aria-label="Комментарий"><svg viewBox="0 0 24 24" fill="${r.comment_text ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></button>
          </div>
        </td>
      </tr>`);
    });
    return `<div class="dh-table-wrap" id="dhTableWrap"><table class="dh-table dh-table--rich">
      <thead><tr>
        <th>Статус</th><th>Напр.</th><th>Счёт</th><th>Контрагент</th><th>Объект</th>
        <th>Договор</th><th>Получение</th><th>Назначение</th><th>Ответственные</th>
        <th>Сумма</th><th>НДС</th><th>Оплата</th><th>СФ/УПД</th><th class="dh-actions">Действия</th>
      </tr></thead>
      <tbody>${parts.join('')}</tbody>
    </table></div><div class="dh-hscroll-bar" id="dhHScrollBar" hidden><div class="dh-hscroll-bar__inner"></div></div>`;
  }

  function renderGuideView() {
    return `
      <div class="dh-view dh-view--guide is-on" id="dhViewGuide">
        <div class="dh-guide-grid">
          <article class="dh-gcard"><div class="n">01</div><h3>Внести счёт</h3><p>Мастер: направление и тип → суммы с авто-НДС → договор, сроки и скан → проверка и позиции каталога.</p><div class="who">Закупки · РП · Бух · ТО</div></article>
          <article class="dh-gcard"><div class="n">02</div><h3>Договор и объект</h3><p>Выберите режим договора и при необходимости укажите работу. Без договора строка попадёт в «Неполные».</p><div class="who">Закупки · Бух</div></article>
          <article class="dh-gcard"><div class="n">03</div><h3>Оплата</h3><p>Кнопка «Опл» / «К оплате» ведёт в очередь согласования платежей. Не дублируйте оплату здесь.</p><div class="who">Бух · Дирекция</div></article>
          <article class="dh-gcard"><div class="n">04</div><h3>СФ и склад</h3><p>СФ — закрывающие; Склад — цепочка кладовщика. Входящие позиции можно отправить в номенклатуру.</p><div class="who">Кладовщик · Бух</div></article>
          <article class="dh-gcard"><div class="n">05</div><h3>1С</h3><p>«В 1С» скачивает CSV с превью; «Из 1С» — сопоставление кода учёта.</p><div class="who">Бух</div></article>
          <article class="dh-gcard"><div class="n">06</div><h3>Исходящие клиенту</h3><p>Выставление нашего СФ/УПД по проекту. Связь со счетами и актами из «Счета и акты», выгрузка в 1С.</p><div class="who">Бух · РП · Дирекция</div></article>
        </div>
      </div>`;
  }

  function facetsHtml() {
    const cps = state.facets.counterparties || [];
    const opts = OPS_OPTIONS.map(([v, l]) =>
      `<option value="${esc(v)}" ${state.facetOps === v ? 'selected' : ''}>${esc(l)}</option>`
    ).join('');
    const yNow = new Date().getFullYear();
    const years = [yNow + 1, yNow, yNow - 1, yNow - 2];
    return `
      <div class="dh-facets" id="dhFacets">
        <div class="dh-facet dh-facet--qtr">
          <span>Квартал</span>
          <div class="dh-qtr-chips" id="dhQtrChips">
            <button type="button" class="dh-qchip ${!state.quarter ? 'is-on' : ''}" data-qtr="">Все</button>
            <button type="button" class="dh-qchip ${state.quarter === '1' ? 'is-on' : ''}" data-qtr="1">1 кв</button>
            <button type="button" class="dh-qchip ${state.quarter === '2' ? 'is-on' : ''}" data-qtr="2">2 кв</button>
            <button type="button" class="dh-qchip ${state.quarter === '3' ? 'is-on' : ''}" data-qtr="3">3 кв</button>
            <button type="button" class="dh-qchip ${state.quarter === '4' ? 'is-on' : ''}" data-qtr="4">4 кв</button>
          </div>
        </div>
        <label class="dh-facet">
          <span>Год</span>
          <select id="dhFacetYear">
            <option value="">Все годы</option>
            ${years.map((y) => `<option value="${y}" ${String(state.year) === String(y) ? 'selected' : ''}>${y}</option>`).join('')}
          </select>
        </label>
        <label class="dh-facet">
          <span>Контрагент</span>
          <input list="dhCpList" id="dhFacetCp" type="text" placeholder="Все" value="${esc(state.facetCounterparty)}" />
          <datalist id="dhCpList">${cps.map((c) => `<option value="${esc(c)}"></option>`).join('')}</datalist>
        </label>
        <label class="dh-facet">
          <span>Статус</span>
          <select id="dhFacetOps">${opts}</select>
        </label>
        <label class="dh-facet dh-facet--check">
          <input type="checkbox" id="dhFacetIncomplete" ${state.facetIncomplete ? 'checked' : ''}/>
          <span>Только неполные</span>
        </label>
      </div>`;
  }

  function registryMainHtml(scopeAll) {
    return `
            <div class="dh-coach ${state.coachOpen ? '' : 'is-collapsed'}" id="dhCoach">
              <div class="dh-coach__ico">i</div>
              <div class="dh-coach__body">
                <strong>С чего начать</strong>
                <p>По умолчанию — только ваши строки. «Показать все» сбрасывается при обновлении страницы (F5). Оплата — через очередь согласования, не второй кнопкой «оплачен».</p>
              </div>
              <button class="dh-coach__close" type="button" id="dhCoachClose">✕</button>
            </div>
            <div class="dh-kpis" id="dhKpis">
              <button class="dh-kpi ${state.kpi === 'all' ? 'is-on' : ''}" type="button" data-kpi="all"><div class="k">Всего</div><div class="v">${kpiVal('all')}</div><div class="s">${esc(kpiSub('all'))}</div></button>
              <button class="dh-kpi is-err ${state.kpi === 'pay' ? 'is-on' : ''}" type="button" data-kpi="pay"><div class="k">Просрочка оплаты</div><div class="v">${kpiVal('pay')}</div><div class="s">${esc(kpiSub('pay'))}</div></button>
              <button class="dh-kpi is-warn ${state.kpi === 'sf' ? 'is-on' : ''}" type="button" data-kpi="sf"><div class="k">Ждём СФ / УПД</div><div class="v">${kpiVal('sf')}</div><div class="s">${esc(kpiSub('sf'))}</div></button>
              <button class="dh-kpi is-info ${state.kpi === 'wh' ? 'is-on' : ''}" type="button" data-kpi="wh"><div class="k">У кладовщика</div><div class="v">${kpiVal('wh')}</div><div class="s">${esc(kpiSub('wh'))}</div></button>
              <button class="dh-kpi is-ok ${state.kpi === 'out' ? 'is-on' : ''}" type="button" data-kpi="out"><div class="k">Исходящие</div><div class="v">${kpiVal('out')}</div><div class="s">${esc(kpiSub('out'))}</div></button>
              <button class="dh-kpi ${state.kpi === '1c' ? 'is-on' : ''}" type="button" data-kpi="1c"><div class="k">Не в 1С</div><div class="v">${kpiVal('no_1c')}</div><div class="s">${esc(kpiSub('no_1c'))}</div></button>
              <button class="dh-kpi is-info ${state.kpi === 'incomplete' ? 'is-on' : ''}" type="button" data-kpi="incomplete"><div class="k">Неполные</div><div class="v">${kpiVal('incomplete')}</div><div class="s">${esc(kpiSub('incomplete'))}</div></button>
            </div>
            <div class="dh-toolbar">
              <div class="dh-seg" id="dhDirSeg">
                <button type="button" class="${state.dir === 'all' ? 'is-on' : ''}" data-dir="all">Все</button>
                <button type="button" class="${state.dir === 'in' ? 'is-on' : ''}" data-dir="in">Входящие</button>
                <button type="button" class="${state.dir === 'out' ? 'is-on' : ''}" data-dir="out">Исходящие</button>
              </div>
              <div class="dh-search">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
                <input id="dhSearch" type="search" placeholder="Номер, поставщик, объект, договор…" value="${esc(state.q)}" />
              </div>
              <button class="dh-chip ${state.facetIncomplete || state.kpi === 'incomplete' ? 'is-on' : ''}" type="button" id="dhChipIncomplete">Неполные <span class="n">${kpiVal('incomplete')}</span></button>
              <label class="dh-scope">
                <input type="checkbox" id="dhScopeAll" ${scopeAll ? 'checked' : ''}/> Показать все
              </label>
            </div>
            ${facetsHtml()}
            <div class="dh-card dh-card--registry">
              <div class="dh-card__head">
                <h2>Документы</h2>
                <span id="dhRowsMeta">показано ${state.rows.length} из ${state.total || state.rows.length}${state.scope === 'all' ? ' · все строки' : ' · только мои'}</span>
              </div>
              <div class="dh-qtr-live" id="dhQtrLive" aria-live="polite"></div>
              <div id="dhTableHost">${state.loading ? '<div class="dh-empty">Загрузка…</div>' : renderTable()}</div>
            </div>`;
  }

  function shellHtml() {
    const scopeAll = state.scope === 'all';
    const isGuide = state.view === 'guide';
    const isWizard = state.view === 'wizard';
    const pageTitle = isGuide ? 'Как пользоваться' : (isWizard ? 'Внести документ' : 'Реестр счетов, СФ и УПД');
    const pageSub = isGuide
      ? 'Роли, шаги и покрытие полей Excel → CRM'
      : (isWizard
        ? 'Пошаговое заполнение с авторасчётом НДС и проверкой дублей'
        : 'Единый хаб входящих и исходящих · работы, договоры, закупки и 1С');
    return `
      <div class="dh-app dh-app--embedded${isWizard ? ' dh-app--wizard' : ''}">
        <div class="dh-shell">
          <header class="dh-top">
            <div class="dh-top__title">
              <div class="dh-top__eyebrow">Финансы · Документы</div>
              <h1 class="dh-top__h1">${pageTitle}</h1>
              <p class="dh-top__sub">${pageSub}</p>
            </div>
            <div class="dh-top__actions">
              ${isWizard
                ? '<button class="dh-btn dh-btn--ghost" type="button" id="dhWizToRegistry">К реестру</button>'
                : `<button class="dh-btn dh-btn--ghost ${isGuide ? 'is-on' : ''}" type="button" id="dhBtnGuide">${isGuide ? 'К реестру' : 'Справка'}</button>
              <button class="dh-btn dh-btn--ghost" type="button" id="dhBtnHelp" title="Подсказка">?</button>
              <button class="dh-btn dh-btn--ghost" type="button" id="dhBtnImport1c">Из 1С</button>
              <button class="dh-btn dh-btn--ghost" type="button" id="dhBtnExport1c">В 1С</button>
              <button class="dh-btn dh-btn--primary" type="button" id="dhBtnNew">Внести документ</button>`}
            </div>
          </header>
          <main class="dh-main">
            ${isGuide ? renderGuideView() : (isWizard ? '<div class="dh-wizard-page" id="dhWizardHost"></div>' : registryMainHtml(scopeAll))}
          </main>
        </div>
        <div class="dh-overlay" id="dhOverlay" hidden></div>
        <aside class="dh-drawer" id="dhDrawer" hidden aria-hidden="true"></aside>
        <div class="dh-modal" id="dhModal" hidden></div>
      </div>`;
  }

  function emptyWizDraft() {
    let currentUserId = '';
    try { currentUserId = String(JSON.parse(localStorage.getItem('asgard_user') || '{}').id || ''); } catch (_) {}
    return {
      dir: 'in',
      doc_kinds: ['invoice'],
      invoice_number: '',
      invoice_date: new Date().toISOString().slice(0, 10),
      counterparty_name: '',
      counterparty_inn: '',
      counterparty_email: '',
      counterparty_phone: '',
      amount_gross: '',
      amount_net: '',
      vat_rate: DEFAULT_VAT_RATE, // null = без НДС
      contract_mode: 'none',
      contract_id: null,
      contract_label: '',
      contract_date: '',
      contract_has_scan: false,
      contract_has_original: false,
      spend_kind: 'work', // work|warehouse|office|other
      payment_due_at: '',
      sf_due_at: '',
      work_id: '',
      work_expense_id: null,
      doc_owner_id: currentUserId,
      pm_id: '',
      comment_text: '',
      purpose_customer: true,
      purpose_asgard: false,
      purpose_consumables: false,
      receive_channel: '',
      parsed_json: '',
      file: null
    };
  }

  function readWizStepFields(form) {
    if (!form || !state.wizDraft) return;
    const fd = new FormData(form);
    const d = state.wizDraft;
    const strFields = ['dir', 'invoice_number', 'invoice_date', 'counterparty_name',
      'counterparty_inn', 'counterparty_email', 'counterparty_phone',
      'amount_gross', 'amount_net',
      'contract_mode', 'contract_label', 'contract_date',
      'spend_kind', 'payment_due_at', 'sf_due_at', 'work_id',
      'doc_owner_id', 'pm_id',
      'comment_text', 'parsed_json', 'receive_channel'];
    for (const k of strFields) {
      if (fd.has(k)) d[k] = String(fd.get(k) ?? '');
    }
    // VAT rate from hidden field
    const vatRateEl = form.querySelector('#dhWizVatRate');
    if (vatRateEl) {
      const raw = vatRateEl.value;
      d.vat_rate = raw === '' || raw === 'null' ? null : parseFloat(raw);
    }
    // contract flags
    d.contract_has_scan = !!form.querySelector('input[name="contract_has_scan"]')?.checked;
    d.contract_has_original = !!form.querySelector('input[name="contract_has_original"]')?.checked;
    // doc_kinds
    d.doc_kinds = [...form.querySelectorAll('input[name="doc_kind"]:checked')].map((el) => el.value);
    if (!d.doc_kinds.length) d.doc_kinds = ['invoice'];
    // purpose flags
    d.purpose_customer = !!form.querySelector('input[name="purpose_customer"]')?.checked;
    d.purpose_asgard = !!form.querySelector('input[name="purpose_asgard"]')?.checked;
    d.purpose_consumables = !!form.querySelector('input[name="purpose_consumables"]')?.checked;
    // file
    const fileInput = form.querySelector('input[name="attachment"]');
    if (fileInput && fileInput.files && fileInput.files[0]) d.file = fileInput.files[0];
  }

  function vatRateChipsHtml(currentRate) {
    return VAT_RATES.map((r) => {
      const selected = currentRate === r.value || (currentRate == null && r.value === null);
      return `<button type="button" class="dh-vat-chip${selected ? ' is-on' : ''}" data-vat-rate="${r.value === null ? 'null' : r.value}">${esc(r.label)}</button>`;
    }).join('');
  }

  function spendKindLabel(k) {
    return ({ work: 'Работы', warehouse: 'Склад/Материалы', office: 'Офис/АХО', other: 'Прочее' })[k] || k || '—';
  }

  function wizStepHtml(step) {
    const d = state.wizDraft || emptyWizDraft();
    const kinds = new Set(d.doc_kinds || ['invoice']);
    const steps = `
      <div class="dh-steps">
        <div class="dh-step ${step === 1 ? 'is-on' : (step > 1 ? 'is-done' : '')}"><span class="n">1</span> Тип</div>
        <div class="dh-step ${step === 2 ? 'is-on' : (step > 2 ? 'is-done' : '')}"><span class="n">2</span> Счёт и суммы</div>
        <div class="dh-step ${step === 3 ? 'is-on' : (step > 3 ? 'is-done' : '')}"><span class="n">3</span> Договор и объект</div>
        <div class="dh-step ${step === 4 ? 'is-on' : ''}"><span class="n">4</span> Вложения</div>
      </div>`;
    if (step === 1) {
      return steps + `
        <div class="dh-coach"><div class="dh-coach__ico">1</div><div class="dh-coach__body"><strong>Что вносим?</strong><p>Входящий — счёт/СФ от поставщика. Исходящий — наш СФ или УПД клиенту по проекту.</p></div></div>
        <input type="hidden" name="dir" id="dhWizDir" value="${esc(d.dir || 'in')}" />
        <div class="dh-dir-cards" id="dhDirCards">
          <button type="button" class="dh-dir-card ${d.dir !== 'out' ? 'is-on' : ''}" data-dir="in">
            <div class="dh-dir-card__t">Входящий</div>
            <div class="dh-dir-card__d">От поставщика: счёт → оплата → СФ/УПД</div>
          </button>
          <button type="button" class="dh-dir-card ${d.dir === 'out' ? 'is-on' : ''}" data-dir="out">
            <div class="dh-dir-card__t">Исходящий</div>
            <div class="dh-dir-card__d">Наш СФ / УПД клиенту по работе</div>
          </button>
        </div>
        <div class="dh-type-cards" id="dhTypeCards">
          ${[['invoice', 'Счёт', 'От поставщика или клиенту'], ['sf', 'СФ', 'Счёт-фактура / закрывающий'], ['upd', 'УПД', 'Универсальный передаточный'], ['act', 'Акт', 'Акт выполненных работ']].map(([v, t, s]) =>
            `<button type="button" class="dh-type-card ${kinds.has(v) ? 'is-on' : ''}" data-kind="${v}"><div class="t">${t}</div><div class="s">${s}</div></button>`
          ).join('')}
        </div>
        <div class="dh-checkrow dh-sr-only" id="dhDocKinds" aria-hidden="true">
          <label class="dh-check"><input type="checkbox" name="doc_kind" value="invoice" ${kinds.has('invoice') ? 'checked' : ''}/> Счёт</label>
          <label class="dh-check"><input type="checkbox" name="doc_kind" value="sf" ${kinds.has('sf') ? 'checked' : ''}/> СФ</label>
          <label class="dh-check"><input type="checkbox" name="doc_kind" value="upd" ${kinds.has('upd') ? 'checked' : ''}/> УПД</label>
          <label class="dh-check"><input type="checkbox" name="doc_kind" value="act" ${kinds.has('act') ? 'checked' : ''}/> Акт</label>
        </div>`;
    }
    if (step === 2) {
      const curRate = d.vat_rate !== undefined ? d.vat_rate : DEFAULT_VAT_RATE;
      const parts0 = recalcVat(parseFloat(d.amount_gross) || 0, curRate);
      return steps + `
        <div class="dh-coach"><div class="dh-coach__ico">2</div><div class="dh-coach__body"><strong>Суммы и контрагент</strong><p>Введите сумму, выберите ставку НДС, укажите поставщика.</p></div></div>
        <div class="dh-sum-strip" id="dhWizSumStrip" aria-live="polite">
          <div><span class="k">С НДС</span><span class="v" id="dhWizStripGross">${moneyFine(parts0.gross || 0)}</span></div>
          <div><span class="k">Без НДС</span><span class="v" id="dhWizStripNet">${moneyFine(parts0.net || 0)}</span></div>
          <div><span class="k">НДС</span><span class="v" id="dhWizStripVat">${moneyFine(parts0.vat || 0)}</span></div>
        </div>
        <div class="dh-grid2">
          <div class="dh-field"><label>№ счёта *</label><input name="invoice_number" required value="${esc(d.invoice_number)}" placeholder="например ФР-2019" /></div>
          <div class="dh-field"><label>Дата счёта *</label><input type="date" name="invoice_date" required value="${esc((d.invoice_date || '').slice(0, 10))}" /></div>
        </div>
        <div class="dh-field" id="dhWizCpContainer">
          <label>Контрагент *</label>
          <input type="hidden" name="counterparty_name" id="dhWizCpName" value="${esc(d.counterparty_name)}" />
          <div id="dhWizCpMount" class="dh-cra-host"></div>
          <div class="dh-help">Начните вводить название или ИНН — подскажем из базы и ЕГРЮЛ</div>
        </div>
        <div class="dh-grid2">
          <div class="dh-field"><label>ИНН</label><input name="counterparty_inn" id="dhWizInn" value="${esc(d.counterparty_inn || '')}" placeholder="XXXXXXXXXX" /></div>
          <div class="dh-field"><label>Email</label><input name="counterparty_email" id="dhWizEmail" type="email" value="${esc(d.counterparty_email || '')}" /></div>
          <div class="dh-field"><label>Телефон</label><input name="counterparty_phone" id="dhWizPhone" value="${esc(d.counterparty_phone || '')}" /></div>
        </div>
        <div class="dh-vat-box">
          <div class="dh-field"><label>Сумма с НДС</label><input name="amount_gross" type="number" step="0.01" min="0" required value="${esc(d.amount_gross)}" placeholder="0.00" id="dhWizGross" /><div class="dh-help">меняете — пересчитаем без НДС</div></div>
          <div class="dh-field"><label>Сумма без НДС</label><input name="amount_net" type="number" step="0.01" min="0" value="${esc(d.amount_net)}" placeholder="0.00" id="dhWizNet" /><div class="dh-help">или вводите сюда</div></div>
          <div class="dh-field">
            <label>НДС</label>
            <div class="dh-vat-box__big" id="dhWizVatAmt">—</div>
            <div class="dh-vat-rate-chips" id="dhWizVatChips" role="group" aria-label="Ставка НДС">${vatRateChipsHtml(curRate)}</div>
            <input type="hidden" id="dhWizVatRate" name="vat_rate" value="${curRate === null ? 'null' : esc(String(curRate))}" />
          </div>
        </div>`;
    }
    if (step === 3) {
      const cmode = d.contract_mode || (d.spend_kind === 'warehouse' || d.spend_kind === 'office' ? 'general' : 'none');
      const sk = d.spend_kind || 'work';
      return steps + `
        <div class="dh-coach"><div class="dh-coach__ico">3</div><div class="dh-coach__body"><strong>Договор, расход и объект</strong><p>«Без договора» и «Общий / заявка» — нормально. «Привязать» — выбор из реестра. Вид расхода: работы / склад / офис / прочее.</p></div></div>
        <input type="hidden" name="contract_mode" id="dhWizContract" value="${esc(cmode)}" />
        <div class="dh-mode-cards" id="dhModeCards">
          ${[['linked','Привязать договор','Из реестра договоров'],['once','Разовая','Разовая поставка'],['general','Общий / заявка','Рамочный'],['none','Без договора','Не указан / позже']].map(([v,t,s]) =>
            `<button type="button" class="dh-mode-card ${cmode === v ? 'is-on' : ''}" data-mode="${v}"><div class="t">${t}</div><div class="s">${s}</div></button>`
          ).join('')}
        </div>
        <div id="dhContractExtra">
          <div id="dhContractPickerRow" ${cmode !== 'linked' ? 'hidden' : ''} style="margin-bottom:10px">
            <button type="button" class="dh-btn dh-btn--ghost" id="dhWizContractPick">
              ${d.contract_id ? '✓ ' + esc(d.contract_label || ('Договор #' + d.contract_id)) : '📎 Выбрать договор из реестра'}
            </button>
          </div>
          <div id="dhContractLabelRow" ${cmode === 'none' ? 'hidden' : ''}>
            <div class="dh-grid2">
              <div class="dh-field"><label>Метка / номер договора</label><input name="contract_label" id="dhWizContractLabel" value="${esc(d.contract_label || '')}" placeholder="Например, ДП-2025/01" /></div>
              <div class="dh-field"><label>Дата договора</label><input type="date" name="contract_date" id="dhWizContractDate" value="${esc((d.contract_date || '').slice(0, 10))}" /></div>
            </div>
            <div class="dh-checkrow" style="margin-bottom:12px">
              <label class="dh-check"><input type="checkbox" name="contract_has_scan" ${d.contract_has_scan ? 'checked' : ''}/> Скан есть</label>
              <label class="dh-check"><input type="checkbox" name="contract_has_original" ${d.contract_has_original ? 'checked' : ''}/> Оригинал есть</label>
            </div>
          </div>
        </div>
        <div class="dh-section-label">Вид расхода</div>
        <div class="dh-spend-cards" id="dhSpendCards">
          ${[['work','Работы','Субподряд, монтаж, услуги на объекте'],['warehouse','Склад/Материалы','Оборудование, стройматериалы'],['office','Офис/АХО','Офисные нужды, связь, аренда'],['other','Прочее','Не вписывается в категории']].map(([v,t,s]) =>
            `<button type="button" class="dh-spend-card${sk === v ? ' is-on' : ''}" data-spend="${v}"><div class="t">${t}</div><div class="s">${s}</div></button>`
          ).join('')}
        </div>
        <input type="hidden" name="spend_kind" id="dhWizSpendKind" value="${esc(sk)}" />
        <div class="dh-field" id="dhWorkField" ${sk !== 'work' ? 'style="display:none"' : ''}>
          <label>Работа / объект <span style="color:var(--t3)">(обязательно для работ)</span></label>
          <input type="hidden" name="work_id" id="dhWizWorkId" value="${esc(d.work_id || '')}" />
          <div id="dhWizWork_w" class="dh-crselect-host"></div>
          <div class="dh-help">Список загружается при открытии шага</div>
        </div>
        <div class="dh-dup" id="dhWizDup" hidden>
          <strong>Похожий расход уже есть на объекте</strong>
          <p>После выбора работы: РП мог внести этот счёт в расходы. Связать или оставить только в реестре?</p>
          <div class="dh-gap-row">
            <button class="dh-btn dh-btn--sm" type="button" id="dhWizDupLink">Связать с расходом</button>
            <button class="dh-btn dh-btn--sm dh-btn--ghost" type="button" id="dhWizDupSkip">Это другой документ</button>
          </div>
          <div id="dhWizDupItems" class="dh-dup-items"></div>
        </div>
        <div class="dh-checkrow">
          <label class="dh-check"><input type="checkbox" name="purpose_customer" ${d.purpose_customer ? 'checked' : ''}/> На объект заказчика</label>
          <label class="dh-check"><input type="checkbox" name="purpose_asgard" ${d.purpose_asgard ? 'checked' : ''}/> Собственность АСГАРД</label>
          <label class="dh-check"><input type="checkbox" name="purpose_consumables" ${d.purpose_consumables ? 'checked' : ''}/> Расходники</label>
        </div>
        <div class="dh-field"><label>Способ получения закрывающих <span class="dh-help" title="Как в Excel: ЭДО / скан / оригинал">(как в Excel)</span></label>
          <select name="receive_channel">
            <option value="" ${!d.receive_channel ? 'selected' : ''}>— не указано —</option>
            <option value="edo" ${d.receive_channel === 'edo' ? 'selected' : ''}>ЭДО</option>
            <option value="scan" ${d.receive_channel === 'scan' ? 'selected' : ''}>скан</option>
            <option value="original" ${d.receive_channel === 'original' ? 'selected' : ''}>оригинал</option>
          </select>
        </div>
        <div class="dh-grid2">
          <div class="dh-field"><label>Срок оплаты</label><input type="date" name="payment_due_at" value="${esc((d.payment_due_at || '').slice(0, 10))}" /></div>
          <div class="dh-field"><label>Срок ожидания СФ</label><input type="date" name="sf_due_at" value="${esc((d.sf_due_at || '').slice(0, 10))}" /></div>
        </div>
        <div class="dh-grid2">
          <div class="dh-field"><label>Отв. за документы</label>
            <input type="hidden" name="doc_owner_id" id="dhWizDocOwnerId" value="${esc(d.doc_owner_id || '')}" />
            <div id="dhWizDocOwner_w" class="dh-crselect-host"></div>
          </div>
          <div class="dh-field"><label>РП</label>
            <input type="hidden" name="pm_id" id="dhWizPmId" value="${esc(d.pm_id || '')}" />
            <div id="dhWizPm_w" class="dh-crselect-host"></div>
          </div>
        </div>`;
    }
    const curRate4 = d.vat_rate !== undefined ? d.vat_rate : DEFAULT_VAT_RATE;
    const parts4 = recalcVat(parseFloat(d.amount_gross) || 0, curRate4);
    const rateLabel4 = curRate4 === null ? 'без НДС' : (Math.round(curRate4 * 100) + '% НДС');
    return steps + `
      <div class="dh-coach"><div class="dh-coach__ico">4</div><div class="dh-coach__body"><strong>Сканы и проверка</strong><p>Прикрепите скан и сверьте суммы. Для входящих добавьте позиции каталога.</p></div></div>
      <div class="dh-field">
        <label>Вложение (скан счёта)</label>
        <label class="dh-drop">
          <input type="file" name="attachment" accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.webp,.json,.txt" />
          <span class="dh-drop__t">${d.file ? esc(d.file.name) : 'Перетащите скан счёта или выберите файл'}</span>
          <span class="dh-drop__s">PDF, JPG, PNG · входящие строки уйдут в номенклатуру</span>
        </label>
      </div>
      <div class="dh-field"><label>Комментарий</label><textarea name="comment_text" rows="2" placeholder="Условия оплаты, ТК, РПО…">${esc(d.comment_text)}</textarea></div>
      <div class="dh-review-grid">
        <div class="dh-review-card"><div class="k">Направление</div><div class="v">${d.dir === 'out' ? 'Исходящий' : 'Входящий'}</div></div>
        <div class="dh-review-card"><div class="k">Типы</div><div class="v">${esc((d.doc_kinds || []).map((x) => ({ invoice: 'Счёт', sf: 'СФ', upd: 'УПД', act: 'Акт' }[x] || x)).join(', ') || 'Счёт')}</div></div>
        <div class="dh-review-card"><div class="k">Счёт</div><div class="v">${esc(d.invoice_number || 'б/н')} · ${fmtDate(d.invoice_date)}</div></div>
        <div class="dh-review-card"><div class="k">Контрагент</div><div class="v">${esc(d.counterparty_name || '—')}</div><div class="s">${esc([d.counterparty_email, d.counterparty_phone].filter(Boolean).join(' · ') || '—')}</div></div>
        <div class="dh-review-card"><div class="k">Сумма</div><div class="v dh-money">${money(parts4.gross)}</div><div class="s">${parts4.hasVat ? 'нетто ' + money(parts4.net) + ' · НДС ' + money(parts4.vat) : 'без НДС'}</div></div>
        <div class="dh-review-card"><div class="k">Ставка НДС</div><div class="v">${esc(rateLabel4)}</div></div>
        <div class="dh-review-card"><div class="k">Договор</div><div class="v">${esc(contractModeLabel(d.contract_mode))}${d.contract_label ? ' · ' + esc(d.contract_label) : ''}</div></div>
        <div class="dh-review-card"><div class="k">Вид расхода</div><div class="v">${esc(spendKindLabel(d.spend_kind))}</div></div>
        <div class="dh-review-card"><div class="k">Работа</div><div class="v">${d.work_id ? '#' + esc(String(d.work_id)) : (d.spend_kind === 'work' ? 'не выбран' : '—')}</div></div>
        <div class="dh-review-card"><div class="k">Отв. документы</div><div class="v">${d.doc_owner_id ? esc(String(d.doc_owner_name || ('#' + d.doc_owner_id))) : 'я (по умолчанию)'}</div></div>
        <div class="dh-review-card"><div class="k">РП</div><div class="v">${d.pm_id ? esc(String(d.pm_name || ('#' + d.pm_id))) : '—'}</div></div>
        <div class="dh-review-card"><div class="k">Получение закрывающих</div><div class="v">${esc(d.receive_channel || '—')}</div></div>
      </div>
      <div class="dh-field"><label>Позиции для каталога (входящие)</label>
        <div class="dh-lines-head"><span>Наименование</span><span>Цена</span><span>Кол-во</span><span>Ед.</span><span></span></div>
        <div class="dh-lines" id="dhWizLines"></div>
        <button type="button" class="dh-btn dh-btn--ghost dh-btn--sm" id="dhWizAddLine">+ позиция</button>
        <textarea name="parsed_json" id="dhWizParsed" class="dh-hidden-json" rows="2">${esc(d.parsed_json)}</textarea>
      </div>`;
  }

  async function openWizard() {
    state.view = 'wizard';
    state.wizStep = 1;
    state.wizDraft = emptyWizDraft();
    await paint(window.__docHubLayout || window.layout);
    const host = document.getElementById('dhWizardHost');
    if (host) paintWizard(host);
  }

  function paintWizard(container) {
    const modal = container || document.getElementById('dhModal');
    if (!modal) return;
    const inline = container && container.id === 'dhWizardHost';
    const step = state.wizStep;
    const inner = `
        <form id="dhWizForm" class="dh-wiz${inline ? ' dh-wiz--page' : ''}" data-step="${step}">
          ${wizStepHtml(step)}
          <footer class="dh-modal__foot dh-wiz__foot">
            <button type="button" class="dh-btn dh-btn--ghost" id="dhWizCancel">Отмена</button>
            <button type="button" class="dh-btn dh-btn--ghost" id="dhWizBack" ${step <= 1 ? 'disabled' : ''}>Назад</button>
            ${step < 4
              ? '<button type="button" class="dh-btn dh-btn--primary" id="dhWizNext">Далее</button>'
              : '<button type="submit" class="dh-btn dh-btn--primary" id="dhWizSubmit">Сохранить в реестр</button>'}
          </footer>
        </form>`;
    if (inline) {
      modal.innerHTML = `
        <div class="dh-coach dh-coach--wiz-master">
          <div class="dh-coach__ico">★</div>
          <div class="dh-coach__body">
            <strong>Мастер внесения</strong>
            <p>Заполняйте шаг за шагом. Система посчитает НДС, проверит дубликаты в расходах и подскажет неполные поля.</p>
          </div>
        </div>
        <div class="dh-card dh-card--wiz">
          <div class="dh-card__head">
            <h2>Новый документ</h2>
            <span>шаг ${step} из 4 · подсказки на каждом шаге</span>
          </div>
          <div class="dh-card__body">${inner}</div>
        </div>`;
    } else {
      modal.hidden = false;
      modal.innerHTML = `
      <div class="dh-modal__card dh-modal__card--wiz">
        <header class="dh-modal__head">
          <div>
            <div class="dh-top__eyebrow">Мастер внесения</div>
            <h2>Внести документ</h2>
            <p class="dh-modal__sub">Пошагово · авто-НДС · проверка похожих расходов</p>
          </div>
          <button type="button" class="dh-modal__x" id="dhModalClose">✕</button>
        </header>
        ${inner}
      </div>`;
    }
    const form = modal.querySelector('#dhWizForm');
    const closeWiz = async () => {
      if (inline) {
        state.view = 'registry';
        await paint(window.__docHubLayout || window.layout);
      } else {
        modal.hidden = true;
      }
    };
    modal.querySelector('#dhModalClose')?.addEventListener('click', closeWiz);
    modal.querySelector('#dhWizCancel')?.addEventListener('click', closeWiz);
    modal.querySelector('#dhWizBack')?.addEventListener('click', () => {
      readWizStepFields(form);
      state.wizStep = Math.max(1, state.wizStep - 1);
      paintWizard(container);
    });
    const next = modal.querySelector('#dhWizNext');
    if (next) {
      next.onclick = () => {
        readWizStepFields(form);
        // Скрытые поля браузер не валидирует (required на hidden не работает) — проверяем сами
        if (state.wizStep === 2) {
          const d2 = state.wizDraft || {};
          const miss = [];
          if (!String(d2.invoice_number || '').trim()) miss.push('№ счёта');
          if (!String(d2.invoice_date || '').trim()) miss.push('дата счёта');
          if (!String(d2.counterparty_name || '').trim()) miss.push('контрагент');
          if (!(Number(d2.amount_gross) > 0)) miss.push('сумма');
          if (miss.length) { toast('Заполните', miss.join(', '), 'warn'); return; }
        } else if (!form.reportValidity()) return;
        state.wizStep = Math.min(4, state.wizStep + 1);
        paintWizard(container);
      };
    }
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      readWizStepFields(form);
      await submitWizard(inline ? null : modal);
    };
    bindWizExtras(form);
  }

  function syncLinesToTextarea(form) {
    const host = form.querySelector('#dhWizLines');
    const ta = form.querySelector('#dhWizParsed, textarea[name="parsed_json"]');
    if (!host || !ta) return;
    const rows = [...host.querySelectorAll('.dh-line')].map((row) => ({
      name: row.querySelector('[data-k="name"]')?.value || '',
      unit_price: parseFloat(row.querySelector('[data-k="price"]')?.value) || 0,
      quantity: parseFloat(row.querySelector('[data-k="qty"]')?.value) || 1,
      unit: row.querySelector('[data-k="unit"]')?.value || 'шт'
    })).filter((x) => x.name.trim());
    ta.value = rows.length ? JSON.stringify(rows) : '';
  }

  function addWizLine(form, pre) {
    const host = form.querySelector('#dhWizLines');
    if (!host) return;
    const row = document.createElement('div');
    row.className = 'dh-line';
    row.innerHTML = `
      <input data-k="name" placeholder="Наименование" value="${esc((pre && pre.name) || '')}" />
      <input data-k="price" type="number" step="0.01" placeholder="Цена" value="${esc((pre && pre.unit_price) != null ? pre.unit_price : '')}" />
      <input data-k="qty" type="number" step="0.01" placeholder="Кол-во" value="${esc((pre && pre.quantity) != null ? pre.quantity : '1')}" />
      <input data-k="unit" placeholder="ед." value="${esc((pre && pre.unit) || 'шт')}" />
      <button type="button" class="dh-line__x" title="Удалить">✕</button>`;
    row.querySelector('.dh-line__x').onclick = () => { row.remove(); syncLinesToTextarea(form); };
    row.querySelectorAll('input').forEach((inp) => inp.addEventListener('input', () => syncLinesToTextarea(form)));
    host.appendChild(row);
    syncLinesToTextarea(form);
  }

  function bindWizExtras(form) {
    if (!form) return;

    // Dir cards (step 1)
    form.querySelectorAll('#dhDirCards [data-dir]').forEach((btn) => {
      btn.onclick = () => {
        const v = btn.getAttribute('data-dir');
        const hid = form.querySelector('#dhWizDir, input[name="dir"]');
        if (hid) hid.value = v;
        form.querySelectorAll('#dhDirCards .dh-dir-card').forEach((b) => b.classList.toggle('is-on', b === btn));
      };
    });

    // Type cards (step 1)
    form.querySelectorAll('#dhTypeCards [data-kind]').forEach((btn) => {
      btn.onclick = () => {
        const v = btn.getAttribute('data-kind');
        const cb = form.querySelector('input[name="doc_kind"][value="' + v + '"]');
        if (!cb) return;
        cb.checked = !cb.checked;
        btn.classList.toggle('is-on', cb.checked);
        if (!form.querySelector('input[name="doc_kind"]:checked')) { cb.checked = true; btn.classList.add('is-on'); }
      };
    });

    // Contract mode cards (step 3)
    // Contract picker (step 3 — linked mode) — объявляем до карточек режима,
    // т.к. вход в режим «Привязать» может сразу открыть список договоров
    const pickBtn = form.querySelector('#dhWizContractPick');
    const dhPickCtx = () => {
      const d = state.wizDraft || {};
      const inn = (form.querySelector('#dhWizInn')?.value || d.counterparty_inn || '').trim();
      // Имя может быть только в черновике: шаг 2 уже размонтирован, поля в DOM нет.
      const cpName = (form.querySelector('#dhWizCpName, input[name="counterparty_name"]')?.value || '')
        || d.counterparty_name || '';
      return { inn, cpName };
    };

    form.querySelectorAll('#dhModeCards [data-mode]').forEach((btn) => {
      btn.onclick = () => {
        const v = btn.getAttribute('data-mode');
        const hid = form.querySelector('#dhWizContract, input[name="contract_mode"]');
        if (hid) hid.value = v;
        if (state.wizDraft) state.wizDraft.contract_mode = v;
        form.querySelectorAll('#dhModeCards .dh-mode-card').forEach((b) => b.classList.toggle('is-on', b === btn));
        const pickerRow = form.querySelector('#dhContractPickerRow');
        if (pickerRow) pickerRow.hidden = v !== 'linked';
        const labelRow = form.querySelector('#dhContractLabelRow');
        if (labelRow) labelRow.hidden = v === 'none';
        // Если контрагент известен — сразу показать его договоры
        if (v === 'linked' && pickBtn) {
          const { inn, cpName } = dhPickCtx();
          if (inn || cpName) setTimeout(() => { try { pickBtn.click(); } catch (_) {} }, 80);
        }
      };
    });
    const dhBindPick = (btn) => {
      if (!btn) return;
      btn.onclick = () => {
        const { inn, cpName } = dhPickCtx();
        const cb = (contract) => {
          if (!contract) return;
          if (state.wizDraft) {
            state.wizDraft.contract_id = contract.id;
            state.wizDraft.contract_label = contract.label || contract.number || '';
            state.wizDraft.contract_date = contract.date || '';
          }
          const labelEl = form.querySelector('#dhWizContractLabel');
          const dateEl = form.querySelector('#dhWizContractDate');
          if (labelEl) labelEl.value = contract.label || contract.number || '';
          if (dateEl && contract.date) dateEl.value = String(contract.date).slice(0, 10);
          btn.textContent = '✓ ' + (contract.label || contract.number || 'Договор выбран');
          toast('Договор', 'Привязан: ' + (contract.label || contract.number || contract.id), 'ok');
        };
        openDhContractPicker({ inn, cpName, onSelect: cb });
      };
    };
    dhBindPick(pickBtn);

    // Если контрагент известен и режим «Привязать» — открываем список сразу
    (function autoOpenContractPicker() {
      if (!pickBtn) return;
      const mode = (form.querySelector('#dhWizContract')?.value) || 'none';
      if (mode !== 'linked') return;
      const { inn, cpName } = dhPickCtx();
      if (!inn && !cpName) return;
      if (pickBtn.dataset.autoOpened === '1') return;
      pickBtn.dataset.autoOpened = '1';
      setTimeout(() => { try { pickBtn.click(); } catch (_) {} }, 120);
    })();

    // Destroy previous CRSelect instances (step 3)
    if (window.CRSelect) {
      ['dhWizWork', 'dhWizDocOwner', 'dhWizPm'].forEach((cid) => { try { CRSelect.destroy(cid); } catch (_) {} });
    }

    // spend_kind cards (step 3)
    form.querySelectorAll('#dhSpendCards [data-spend]').forEach((btn) => {
      btn.onclick = () => {
        const v = btn.getAttribute('data-spend');
        const hid = form.querySelector('#dhWizSpendKind');
        if (hid) hid.value = v;
        if (state.wizDraft) state.wizDraft.spend_kind = v;
        form.querySelectorAll('#dhSpendCards .dh-spend-card').forEach((b) => b.classList.toggle('is-on', b === btn));
        const workField = form.querySelector('#dhWorkField');
        if (workField) workField.style.display = v === 'work' ? '' : 'none';
        if (window.CRSelect && typeof CRSelect.setDisabled === 'function') {
          try { CRSelect.setDisabled('dhWizWork', v !== 'work'); } catch (_) {}
        }
      };
    });

    // Dup check helper (used by CRSelect onChange below)
    const checkWizDup = async (wid) => {
      if (!dup) return;
      if (!wid) { dup.hidden = true; return; }
      const gross = parseFloat(grossEl?.value)
        || parseFloat(state.wizDraft && state.wizDraft.amount_gross)
        || 0;
      if (!gross) { dup.hidden = true; return; }
      try {
        const r = await fetch('/api/works/' + wid, { headers: authHeaders() });
        const j = await r.json();
        const expenses = j.expenses || [];
        const cpName = (state.wizDraft && state.wizDraft.counterparty_name || '').toLowerCase();
        const similar = expenses.filter((e) => {
          const amtMatch = Math.abs((Number(e.amount) || 0) - gross) <= 1;
          const cpMatch = !cpName || (String(e.counterparty_name || '').toLowerCase().includes(cpName.slice(0, 5)));
          return amtMatch || cpMatch;
        });
        if (similar.length) {
          dup.hidden = false;
          const itemsEl = dup.querySelector('#dhWizDupItems');
          if (itemsEl) itemsEl.innerHTML = similar.slice(0, 3).map((e) =>
            `<div class="dh-dup-item" data-exp-id="${e.id}">Расход #${e.id} · ${money(e.amount)} · ${esc(e.counterparty_name || '—')}</div>`
          ).join('');
        } else { dup.hidden = true; }
      } catch (_) { dup.hidden = true; }
    };

    // Load works → CRSelect or native fallback (step 3, async)
    (async () => {
      const workWrap = form.querySelector('#dhWizWork_w');
      if (!workWrap) return;
      try {
        const res = await fetch('/api/works?limit=300', { headers: authHeaders() });
        const j = await res.json();
        const items = parseWorksList(j);
        const curWid = String((state.wizDraft && state.wizDraft.work_id) || '');
        const wopts = [{ value: '', label: '— выбрать объект —' }].concat(
          items.map((w) => ({ value: String(w.id), label: workLabel(w) }))
        );
        if (window.CRSelect) {
          workWrap.innerHTML = '';
          workWrap.appendChild(CRSelect.create({
            id: 'dhWizWork',
            searchable: true,
            clearable: true,
            dropdownClass: 'z-modal',
            placeholder: 'Найти объект…',
            options: wopts,
            value: curWid,
            onChange: (v) => {
              const hid = form.querySelector('#dhWizWorkId');
              if (hid) hid.value = v || '';
              if (state.wizDraft) state.wizDraft.work_id = v || '';
              checkWizDup(v);
            }
          }));
        } else {
          // Graceful fallback: native select
          const sel = document.createElement('select');
          sel.innerHTML = wopts.map((o) => `<option value="${esc(o.value)}"${o.value === curWid ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
          sel.addEventListener('change', () => {
            const hid = form.querySelector('#dhWizWorkId');
            if (hid) hid.value = sel.value;
            if (state.wizDraft) state.wizDraft.work_id = sel.value;
            checkWizDup(sel.value);
          });
          workWrap.appendChild(sel);
        }
      } catch (_) {
        if (workWrap) workWrap.innerHTML = '<span style="color:var(--err,#f87171)">Ошибка загрузки объектов</span>';
      }
    })();

    // Load users → CRSelect or native fallback (doc_owner + pm, step 3, async)
    (async () => {
      const ownerWrap = form.querySelector('#dhWizDocOwner_w');
      const pmWrap = form.querySelector('#dhWizPm_w');
      if (!ownerWrap && !pmWrap) return;
      try {
          const res = await fetch('/api/users?limit=200', { headers: authHeaders() });
          const j = await res.json();
          const users = parseUsersList(j);
          const curOwner = String((state.wizDraft && state.wizDraft.doc_owner_id) || '');
          const curPm = String((state.wizDraft && state.wizDraft.pm_id) || '');
          const uopts = [{ value: '', label: '— выбрать —' }].concat(
            users.map((u) => ({ value: String(u.id), label: userLabel(u) }))
          );
        if (ownerWrap) {
          if (window.CRSelect) {
            ownerWrap.innerHTML = '';
            ownerWrap.appendChild(CRSelect.create({
              id: 'dhWizDocOwner',
              searchable: true, clearable: true, dropdownClass: 'z-modal',
              placeholder: 'Отв. за документы…', options: uopts, value: curOwner,
              onChange: (v) => {
                const hid = form.querySelector('#dhWizDocOwnerId');
                if (hid) hid.value = v || '';
                if (state.wizDraft) state.wizDraft.doc_owner_id = v || '';
              }
            }));
          } else {
            const sel = document.createElement('select');
            sel.innerHTML = uopts.map((o) => `<option value="${esc(o.value)}"${o.value === curOwner ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
            sel.addEventListener('change', () => { const hid = form.querySelector('#dhWizDocOwnerId'); if (hid) hid.value = sel.value; if (state.wizDraft) state.wizDraft.doc_owner_id = sel.value; });
            ownerWrap.appendChild(sel);
          }
        }
        if (pmWrap) {
          if (window.CRSelect) {
            pmWrap.innerHTML = '';
            pmWrap.appendChild(CRSelect.create({
              id: 'dhWizPm',
              searchable: true, clearable: true, dropdownClass: 'z-modal',
              placeholder: 'РП…', options: uopts, value: curPm,
              onChange: (v) => {
                const hid = form.querySelector('#dhWizPmId');
                if (hid) hid.value = v || '';
                if (state.wizDraft) state.wizDraft.pm_id = v || '';
              }
            }));
          } else {
            const sel = document.createElement('select');
            sel.innerHTML = uopts.map((o) => `<option value="${esc(o.value)}"${o.value === curPm ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
            sel.addEventListener('change', () => { const hid = form.querySelector('#dhWizPmId'); if (hid) hid.value = sel.value; if (state.wizDraft) state.wizDraft.pm_id = sel.value; });
            pmWrap.appendChild(sel);
          }
        }
      } catch (_) { /* keep empty */ }
    })();

    // CRAutocomplete для контрагента (шаг 2) — наша база + ЕГРЮЛ
    const cpMount = form.querySelector('#dhWizCpMount');
    if (cpMount && typeof CRAutocomplete !== 'undefined' && typeof CRAutocomplete.create === 'function') {
      try {
        try { CRAutocomplete.destroy('dhWizCp'); } catch (_) {}
        cpMount.innerHTML = '';
        cpMount.appendChild(CRAutocomplete.create({
          id: 'dhWizCp',
          placeholder: 'Название организации или ИНН',
          minChars: 2,
          debounce: 300,
          fullWidth: true,
          clearable: true,
          dropdownClass: 'z-modal-ac',
          value: (state.wizDraft && state.wizDraft.counterparty_name) || '',
          fetchOptions: dhCounterpartySuggest,
          onSelect: (item) => {
            if (item === null) {
              // очистка поля
              const nm = form.querySelector('#dhWizCpName'); if (nm) nm.value = '';
              if (state.wizDraft) state.wizDraft.counterparty_name = '';
              return;
            }
            dhApplyCounterparty('wiz', item, { askCreate: true });
          }
        }));
      } catch (_) { /* CRAutocomplete недоступен — скрытое поле остаётся */ }
    }

    // Catalog lines (step 4)
    const add = form.querySelector('#dhWizAddLine');
    if (add) {
      let initial = [];
      try { const raw = (state.wizDraft && state.wizDraft.parsed_json) || ''; if (raw) initial = JSON.parse(raw); } catch (_) { initial = []; }
      if (Array.isArray(initial) && initial.length) initial.forEach((x) => addWizLine(form, x));
      else { addWizLine(form, { name: '', unit_price: '', quantity: 1, unit: 'шт' }); addWizLine(form, { name: '', unit_price: '', quantity: 1, unit: 'шт' }); }
      add.onclick = () => addWizLine(form);
    }

    // VAT rate chips (step 2) + amount recalc
    const grossEl = form.querySelector('#dhWizGross');
    const netEl = form.querySelector('#dhWizNet');
    const vatAmtEl = form.querySelector('#dhWizVatAmt');
    const vatRateHid = form.querySelector('#dhWizVatRate');
    const dup = form.querySelector('#dhWizDup');
    let lock = false;

    const currentVatRate = () => {
      if (!vatRateHid) return DEFAULT_VAT_RATE;
      const raw = vatRateHid.value;
      return raw === '' || raw === 'null' ? null : parseFloat(raw);
    };

    const paintVat = (from) => {
      if (!grossEl || lock) return;
      lock = true;
      const rate = currentVatRate();
      if (from === 'net' && netEl) {
        const n = parseFloat(netEl.value) || 0;
        const parts = rate !== null && rate > 0
          ? { gross: Math.round(n * (1 + rate) * 100) / 100, vat: Math.round(n * rate * 100) / 100 }
          : { gross: n, vat: 0 };
        grossEl.value = String(parts.gross);
        if (vatAmtEl) vatAmtEl.textContent = moneyFine(parts.vat);
      } else {
        const g = parseFloat(grossEl.value) || 0;
        const parts = recalcVat(g, rate);
        if (netEl) netEl.value = String(parts.net);
        if (vatAmtEl) vatAmtEl.textContent = moneyFine(parts.vat);
      }
      // strip
      const sg = form.querySelector('#dhWizStripGross');
      const sn = form.querySelector('#dhWizStripNet');
      const sv = form.querySelector('#dhWizStripVat');
      if (sg) sg.textContent = moneyFine(parseFloat(grossEl.value) || 0);
      if (sn) sn.textContent = moneyFine(parseFloat(netEl && netEl.value) || 0);
      if (sv) sv.textContent = vatAmtEl ? vatAmtEl.textContent : moneyFine(0);
      // real dup: only show after work_id selected
      if (dup) {
        const wid = (window.CRSelect ? CRSelect.getValue('dhWizWork') : null) || form.querySelector('#dhWizWorkId')?.value || (state.wizDraft && state.wizDraft.work_id);
        dup.hidden = !wid; // only relevant when object chosen; async check below
      }
      lock = false;
    };

    if (grossEl) grossEl.addEventListener('input', () => paintVat('gross'));
    if (netEl) netEl.addEventListener('input', () => paintVat('net'));

    // VAT rate chip click
    form.querySelectorAll('#dhWizVatChips .dh-vat-chip').forEach((btn) => {
      btn.onclick = () => {
        const raw = btn.getAttribute('data-vat-rate');
        const rate = raw === 'null' ? null : parseFloat(raw);
        if (state.wizDraft) state.wizDraft.vat_rate = rate;
        if (vatRateHid) vatRateHid.value = rate === null ? 'null' : String(rate);
        form.querySelectorAll('#dhWizVatChips .dh-vat-chip').forEach((b) => b.classList.toggle('is-on', b === btn));
        paintVat('gross');
      };
    });
    paintVat('gross');

    // Work dup check is triggered via CRSelect onChange or native-select fallback (see work load block above).

    const dupLink = form.querySelector('#dhWizDupLink');
    const dupSkip = form.querySelector('#dhWizDupSkip');
    if (dupLink) dupLink.onclick = () => {
      const expId = form.querySelector('.dh-dup-item')?.getAttribute('data-exp-id');
      if (state.wizDraft && expId) state.wizDraft.work_expense_id = parseInt(expId, 10);
      if (dup) dup.hidden = true;
      toast('Связь', 'Расход будет привязан при сохранении', 'ok');
    };
    if (dupSkip) dupSkip.onclick = () => { if (dup) dup.hidden = true; };
  }

  async function submitWizard(modal) {
    const d = state.wizDraft;
    if (!d) return;
    let parsed = [];
    const raw = String(d.parsed_json || '').trim();
    if (raw) {
      try { parsed = JSON.parse(raw); } catch (_) {
        toast('Ошибка', 'Некорректный JSON строк', 'err');
        return;
      }
      if (!Array.isArray(parsed)) {
        toast('Ошибка', 'Строки каталога — массив', 'err');
        return;
      }
    }
    const vatRate = d.vat_rate !== undefined ? d.vat_rate : DEFAULT_VAT_RATE;
    const hasVat = vatRate !== null;
    const gross = parseFloat(d.amount_gross) || 0;
    const body = {
      dir: d.dir,
      invoice_number: d.invoice_number,
      invoice_date: d.invoice_date,
      counterparty_name: d.counterparty_name,
      counterparty_inn: d.counterparty_inn || null,
      counterparty_email: d.counterparty_email || null,
      counterparty_phone: d.counterparty_phone || null,
      amount_gross: gross,
      has_vat: hasVat,
      vat_rate: vatRate,
      contract_mode: d.contract_mode || 'none',
      contract_id: d.contract_id || null,
      contract_label: d.contract_label || null,
      contract_date: d.contract_date || null,
      contract_has_scan: !!d.contract_has_scan,
      contract_has_original: !!d.contract_has_original,
      spend_kind: d.spend_kind || 'other',
      payment_due_at: d.payment_due_at || null,
      sf_due_at: d.sf_due_at || null,
      comment_text: d.comment_text || '',
      purpose_customer: !!d.purpose_customer,
      purpose_asgard: !!d.purpose_asgard,
      purpose_consumables: !!d.purpose_consumables,
      receive_channel: d.receive_channel || null,
      parsed_json: parsed,
      ops_status: 'draft'
    };
    if (d.work_id) body.work_id = parseInt(d.work_id, 10);
    if (d.work_expense_id) body.work_expense_id = d.work_expense_id;
    if (d.doc_owner_id) body.doc_owner_id = parseInt(d.doc_owner_id, 10) || null;
    if (d.pm_id) body.pm_id = parseInt(d.pm_id, 10) || null;
    try {
      const created = await api('/', { method: 'POST', body: JSON.stringify(body) });
      const id = created && created.id;
      if (id && d.file) {
        try {
          const fd = new FormData();
          fd.append('file', d.file);
          const up = await api('/' + id + '/upload', { method: 'POST', body: fd, json: false });
          if (up && (up.catalog || up.catalog_updated || up.lines)) {
            toast('Каталог', 'Позиции отправлены в номенклатуру', 'ok');
          }
        } catch (ue) {
          toast('Файл', ue.message || 'Документ создан, файл не загружен', 'err');
        }
      } else if (parsed.length && d.dir === 'in') {
        toast('Каталог', 'Строки учтены при создании', 'ok');
      }
      toast('Сохранено', 'Документ #' + (id || '') + ' в реестре', 'ok');
      state.wizDraft = null;
      if (modal) modal.hidden = true;
      else {
        state.view = 'registry';
        await paint(window.__docHubLayout || window.layout);
      }
      await refresh();
      if (id) openDrawer(id);
    } catch (e) {
      if (e.status === 409 && e.body && e.body.existing_id) {
        toast('Дубль', 'Уже есть документ #' + e.body.existing_id, 'err');
      } else {
        toast('Ошибка', e.message || 'Не удалось сохранить', 'err');
      }
    }
  }

  async function quick(id, action) {
    const labels = { sf: 'СФ получена', wh: 'Шаг склада', pay: 'К оплате' };
    const row = (state.rows || []).find((r) => String(r.id) === String(id));
    const summary = row ? docSummary(row) : ('документ #' + id);
    const ok = await confirm('Подтвердите', (labels[action] || action) + ' — ' + summary + '?');
    if (!ok) return;
    try {
      const res = await api('/' + id + '/quick', { method: 'POST', body: JSON.stringify({ action }) });
      if (action === 'pay' && res && res.redirect) {
        location.hash = res.redirect.startsWith('#') ? res.redirect : ('#' + res.redirect);
        return;
      }
      toast('Готово', 'Обновлено', 'ok');
      await refresh();
      if (state.selectedId === id) openDrawer(id);
    } catch (e) {
      toast('Ошибка', e.message || 'quick failed', 'err');
    }
  }

  function attachmentsHtml(row) {
    let atts = row.attachments;
    if (typeof atts === 'string') {
      try { atts = JSON.parse(atts); } catch (_) { atts = []; }
    }
    if (!Array.isArray(atts)) atts = atts ? [atts] : [];
    if (row.original_path_url) {
      atts = atts.concat([{ url: row.original_path_url, name: 'Оригинал / путь' }]);
    }
    if (!atts.length) return '<div class="dh-empty dh-empty--sm"><div class="dh-empty__t">Нет вложений</div><p>Скан счёта или СФ можно приложить при создании документа или позже в этой карточке.</p></div>';
    return atts.map((a) => {
      const url = typeof a === 'string' ? a : (a.url || a.path || '');
      const name = typeof a === 'string' ? a.split('/').pop() : (a.name || a.filename || url || 'файл');
      return `<div class="dh-attach">
        <div class="dh-attach__ico">PDF</div>
        <div class="dh-attach__meta">
          <div class="a">${esc(name)}</div>
          <div class="b">${url ? esc(url) : 'локальный скан'}</div>
        </div>
        ${url ? `<a class="dh-btn dh-btn--sm" href="${esc(url)}" target="_blank" rel="noopener">Открыть</a>` : '<button class="dh-btn dh-btn--sm" type="button" disabled>Нет ссылки</button>'}
      </div>`;
    }).join('');
  }

  function sourceBadge(row) {
    const raw = row.excel_source || row.import_source || row.source_label || row.external_ref || '';
    const comment = String(row.comment_text || '');
    const fromExcel = !!(raw || /excel|реестр|xlsx/i.test(comment));
    if (fromExcel) {
      const line = String(raw || comment || 'Excel').slice(0, 80);
      return `<div class="dh-drawer__src">ИЗ EXCEL · ${esc(line)}</div>`;
    }
    return `<div class="dh-drawer__src dh-drawer__src--muted">РЕЕСТР · #${esc(String(row.id))}</div>`;
  }

  function closeDrawer() {
    const d = document.getElementById('dhDrawer');
    const ov = document.getElementById('dhOverlay');
    if (d) {
      if (window.CRSelect) {
        ['drWork', 'drDocOwner', 'drPm'].forEach((cid) => { try { CRSelect.destroy(cid); } catch (_) {} });
      }
      d.hidden = true;
      d.classList.remove('is-on');
      d.setAttribute('aria-hidden', 'true');
      d.innerHTML = '';
      /* Drawer порталится в <body> — иначе .sidenav (z-index 300+) перекрывает
         его внутри stacking-context #layout{z-index:1}. Возвращаем на место. */
      if (d.dataset.portaled === '1') {
        const home = document.querySelector('.dh-app--embedded');
        if (home) {
          home.appendChild(d);
          d.classList.remove('dh-drawer--portal');
          delete d.dataset.portaled;
        }
      }
    }
    if (ov) {
      ov.hidden = true;
      ov.classList.remove('is-on');
    }
    const prev = state.selectedId;
    state.selectedId = null;
    if (prev) {
      document.querySelector(`#dhTableHost tr[data-id="${prev}"]`)?.classList.remove('is-selected');
    }
  }

  function timelineHtml(row) {
    const paid = row.pay_status === 'paid';
    const closing = !!(row.closing_json || row.sf_number || row.ops_status === 'done');
    const whDone = row.wh_status === 'buh_ok';
    const whActive = row.wh_status && row.wh_status !== 'none' && !whDone;
    const onecDone = !!row.onec_id;
    const steps = [
      { title: 'Счёт внесён', meta: fmtDate(row.invoice_date) || '—', done: true, now: false },
      { title: 'Оплата', meta: paid ? 'оплачен' : (fmtDate(row.payment_due_at) || 'срок не задан'), done: paid, now: !paid },
      { title: 'СФ / УПД', meta: closing ? 'получено' : 'ожидаем', done: closing, now: !closing && paid },
      { title: 'Склад → офис → бух', meta: whLabel(row), done: whDone, now: !!whActive },
      { title: '1С', meta: onecDone ? esc(row.onec_id) : 'не выгружено', done: onecDone, now: false }
    ];
    return steps.map((s) => {
      const cls = s.done ? 'is-done' : (s.now ? 'is-now' : 'is-wait');
      return `<div class="dh-tl-item ${cls}">
        <div class="dh-tl-dot"></div>
        <div><div class="dh-tl-title">${s.title}</div><div class="dh-tl-meta">${s.meta || ''}</div></div>
      </div>`;
    }).join('');
  }

  function sumParts(row) {
    const gross = Number(row.amount_gross) || 0;
    const hasVat = !(row.has_vat === false || row.has_vat === 0 || row.has_vat === '0');
    const rate = row.vat_rate != null ? Number(row.vat_rate) : DEFAULT_VAT_RATE;
    let net = row.amount_net != null ? Number(row.amount_net) : NaN;
    let vat = row.vat_amount != null ? Number(row.vat_amount) : NaN;
    if (!hasVat) return { gross, net: gross, vat: 0, hasVat: false, rate: null };
    if (!(rate > 0)) return { gross, net: gross, vat: 0, hasVat: true, rate: 0 };
    if (!Number.isFinite(net) || !(net > 0) || (Number.isFinite(vat) && !(vat > 0) && gross > 0)) {
      net = Math.round((gross / (1 + rate)) * 100) / 100;
      vat = Math.round((gross - net) * 100) / 100;
    } else if (!Number.isFinite(vat) || !(vat > 0)) {
      vat = Math.round((gross - net) * 100) / 100;
    }
    return { gross, net, vat, hasVat, rate };
  }

  async function openDrawer(id) {
    try {
      // Fetch row + users concurrently; works lazy via select
      const [row, usersRes] = await Promise.all([
        api('/' + id),
        fetch('/api/users?limit=200', { headers: authHeaders() }).then((r) => r.json()).catch(() => ({ users: [] }))
      ]);
      const users = parseUsersList(usersRes);

      state.selectedId = id;
      document.querySelectorAll('#dhTableHost tr[data-id].is-selected').forEach((tr) => tr.classList.remove('is-selected'));
      document.querySelector(`#dhTableHost tr[data-id="${id}"]`)?.classList.add('is-selected');

      const d = document.getElementById('dhDrawer');
      const ov = document.getElementById('dhOverlay');
      if (!d) return;
      /* Portal overlay+drawer to <body>: #layout creates a stacking context
         (z-index:1), so .sidenav (z-index 300+) painted over the drawer.
         Portal keeps drawer above sidebar while staying below Huginn dock (1200). */
      if (ov && ov.parentElement !== document.body) {
        document.body.appendChild(ov);
        ov.classList.add('dh-overlay--portal');
      }
      if (d.parentElement !== document.body) {
        document.body.appendChild(d);
        d.classList.add('dh-drawer--portal');
        d.dataset.portaled = '1';
      }
      d.hidden = false;
      d.classList.add('is-on');
      d.setAttribute('aria-hidden', 'false');
      if (ov) { ov.hidden = false; ov.classList.add('is-on'); ov.onclick = () => closeDrawer(); }

      const sums = sumParts(row);
      const titleNo = row.invoice_number ? ('Счёт ' + row.invoice_number) : ('#' + row.id);
      const grossTxt = money(sums.gross);
      const netTxt = moneyFine(sums.net);
      const vatTxt = moneyFine(sums.vat);
      const rateLabel = sums.rate !== null ? Math.round((sums.rate || 0) * 100) + '%' : 'без НДС';
      const sumSub = sums.hasVat ? `НДС ${rateLabel} · нетто ${netTxt} · НДС ${vatTxt}` : `без НДС · ${grossTxt}`;

      const recv = String(row.receive_channel || '').toLowerCase();
      const recvVal = /edo|эдо/.test(recv) ? 'edo' : (/scan|скан/.test(recv) ? 'scan' : (/original|оригинал/.test(recv) ? 'original' : ''));
      const cmode = row.contract_mode || 'none';
      const sk = row.spend_kind || 'other';
      const payLink = row.payment_invoice_id
        ? `<p class="dh-pay-link"><a href="#/approval-payment?id=${row.payment_invoice_id}">Очередь оплаты #${row.payment_invoice_id}</a></p>`
        : '';

      // Closing JSON editor rows
      let closingItems = [];
      try { closingItems = Array.isArray(row.closing_json) ? row.closing_json : (row.closing_json ? JSON.parse(row.closing_json) : []); } catch (_) {}

      const userOpts = users.map((u) => `<option value="${u.id}">${esc(u.name || u.full_name || u.username || 'ID ' + u.id)}</option>`).join('');
      const makeUserSel = (selId, val) =>
        `<select id="${selId}"><option value="">— выбрать —</option>${userOpts.replace(`value="${val}"`, `value="${val}" selected`)}</select>`;

      const vitya_states = ['', 'ожидает', 'принято', 'отклонено'];

      d.innerHTML = `
        <div class="dh-drawer__card">
          <header class="dh-drawer__head">
            <div class="dh-drawer__head-main">
              <h3>${esc(titleNo)}</h3>
              <p>${esc(row.counterparty_name || '')} · ${esc(row.work_title || 'без объекта')}</p>
              <div class="dh-drawer__amt" data-qa="drawer-amt">${esc(grossTxt)}</div>
              ${sourceBadge(row)}
            </div>
            <button type="button" class="dh-drawer__close" id="dhDrawerClose" aria-label="Закрыть">✕</button>
          </header>
          <div class="dh-drawer__body">
            <div class="dh-coach">
              <div class="dh-coach__ico">→</div>
              <div class="dh-coach__body"><strong>Что дальше</strong><p>${esc(nextActionText(row))}</p></div>
            </div>
            ${payLink}

            <!-- ─── Суммы ─── -->
            <div class="dh-section dh-section--sums">
              <div class="dh-section__h">Суммы</div>
              <div class="dh-section__b">
                <div class="dh-sum-hero" data-gross="${esc(String(sums.gross))}">
                  <div class="dh-sum-hero__main">${esc(grossTxt)}</div>
                  <div class="dh-sum-hero__sub">${esc(sumSub)}</div>
                  <div class="dh-sum-hero__due">Срок оплаты: ${fmtDate(row.payment_due_at) || 'не указан'}</div>
                </div>
                <div class="dh-grid2" style="margin-top:12px">
                  <div class="dh-field"><label>Сумма с НДС</label><input type="number" id="drGross" step="0.01" min="0" value="${esc(String(sums.gross))}"/></div>
                  <div class="dh-field"><label>Сумма без НДС</label><input type="number" id="drNet" step="0.01" min="0" value="${esc(String(sums.net))}"/></div>
                </div>
                <div class="dh-field"><label>Ставка НДС</label>
                  <div class="dh-vat-rate-chips" id="drVatChips">${vatRateChipsHtml(sums.rate)}</div>
                  <input type="hidden" id="drVatRate" value="${sums.rate === null ? 'null' : esc(String(sums.rate || 0))}"/>
                </div>
              </div>
            </div>

            <!-- ─── Контрагент ─── -->
            <div class="dh-section">
              <div class="dh-section__h">Контрагент</div>
              <div class="dh-section__b">
                <div class="dh-field" id="drCpContainer">
                  <label>Название *</label>
                  <input type="hidden" id="drCpName" value="${esc(row.counterparty_name || '')}"/>
                  <div id="drCpMount" class="dh-cra-host"></div>
                </div>
                <div class="dh-grid2">
                  <div class="dh-field"><label>ИНН</label><input id="drCpInn" value="${esc(row.inn || row.counterparty_inn || '')}"/></div>
                  <div class="dh-field"><label>Email</label><input type="email" id="drCpEmail" value="${esc(row.counterparty_email || row.email || '')}"/></div>
                  <div class="dh-field"><label>Телефон</label><input id="drCpPhone" value="${esc(row.counterparty_phone || row.phone || '')}"/></div>
                </div>
              </div>
            </div>

            <!-- ─── Договор ─── -->
            <div class="dh-section">
              <div class="dh-section__h">Договор</div>
              <div class="dh-section__b">
                <div class="dh-mode-cards" id="drContractModeCards">
                  ${[['linked','Привязать договор'],['once','Разовая'],['general','Общий / заявка'],['none','Без договора']].map(([v,t]) =>
                    `<button type="button" class="dh-mode-card${cmode === v ? ' is-on' : ''}" data-mode="${v}"><div class="t">${t}</div></button>`
                  ).join('')}
                </div>
                <input type="hidden" id="drContractMode" value="${esc(cmode)}"/>
                <div id="drContractPickerRow" ${cmode !== 'linked' ? 'hidden' : ''}>
                  <button type="button" class="dh-btn dh-btn--ghost dh-btn--sm" id="drContractPick">
                    ${row.contract_id ? '✓ ' + esc(row.contract_label || 'Договор #' + row.contract_id) : '📎 Выбрать договор'}
                  </button>
                  <input type="hidden" id="drContractId" value="${esc(String(row.contract_id || ''))}"/>
                </div>
                <div id="drContractLabelRow" ${cmode === 'none' ? 'hidden' : ''}>
                  <div class="dh-grid2" style="margin-top:8px">
                    <div class="dh-field"><label>Метка / номер</label><input id="drContractLabel" value="${esc(row.contract_label || '')}"/></div>
                    <div class="dh-field"><label>Дата договора</label><input type="date" id="drContractDate" value="${esc(String(row.contract_date || '').slice(0, 10))}"/></div>
                  </div>
                  <div class="dh-checkrow" style="margin-top:4px">
                    <label class="dh-check"><input type="checkbox" id="drHasScan" ${row.contract_has_scan ? 'checked' : ''}/> Скан есть</label>
                    <label class="dh-check"><input type="checkbox" id="drHasOriginal" ${row.contract_has_original ? 'checked' : ''}/> Оригинал есть</label>
                  </div>
                </div>
              </div>
            </div>

            <!-- ─── Вид расхода + Работа ─── -->
            <div class="dh-section">
              <div class="dh-section__h">Вид расхода</div>
              <div class="dh-section__b">
                <div class="dh-spend-cards" id="drSpendCards">
                  ${[['work','Работы'],['warehouse','Склад'],['office','Офис'],['other','Прочее']].map(([v,t]) =>
                    `<button type="button" class="dh-spend-card${sk === v ? ' is-on' : ''}" data-spend="${v}"><div class="t">${t}</div></button>`
                  ).join('')}
                </div>
                <input type="hidden" id="drSpendKind" value="${esc(sk)}"/>
                <div class="dh-field" id="drWorkField" ${sk !== 'work' ? 'style="display:none"' : ''}>
                  <label>Работа / объект</label>
                  <input type="hidden" id="drWorkId" value="${esc(String(row.work_id || ''))}" /><div id="drWork_w" class="dh-crselect-host"></div>
                </div>
              </div>
            </div>

            <!-- ─── Получение и назначение ─── -->
            <div class="dh-section">
              <div class="dh-section__h">Получение и назначение</div>
              <div class="dh-section__b">
                <div class="dh-field"><label>Способ получения закрывающих <span class="dh-help">(ЭДО / скан / оригинал)</span></label>
                  <select id="drReceive">
                    <option value="" ${!recvVal ? 'selected' : ''}>— не указано —</option>
                    <option value="edo" ${recvVal === 'edo' ? 'selected' : ''}>ЭДО</option>
                    <option value="scan" ${recvVal === 'scan' ? 'selected' : ''}>скан</option>
                    <option value="original" ${recvVal === 'original' ? 'selected' : ''}>оригинал</option>
                  </select>
                </div>
                <div class="dh-checkrow">
                  <label class="dh-check"><input type="checkbox" id="drPurpCust" ${row.purpose_customer ? 'checked' : ''}/> На объект заказчика</label>
                  <label class="dh-check"><input type="checkbox" id="drPurpAsg" ${row.purpose_asgard ? 'checked' : ''}/> Собственность АСГАРД</label>
                  <label class="dh-check"><input type="checkbox" id="drPurpCons" ${row.purpose_consumables ? 'checked' : ''}/> Расходники</label>
                </div>
              </div>
            </div>

            <!-- ─── Витя ─── -->
            <div class="dh-section">
              <div class="dh-section__h">Витя (согласование)</div>
              <div class="dh-section__b">
                <div class="dh-grid2">
                  <div class="dh-field"><label>Статус согласования</label>
                    <select id="drVityaState">
                      ${vitya_states.map((v) => `<option value="${v}" ${(row.vitya_state || '') === v ? 'selected' : ''}>${v || '— не задан —'}</option>`).join('')}
                    </select>
                  </div>
                  <div class="dh-field"><label>Дата передачи</label><input type="date" id="drDelivDue" value="${esc(String(row.delivery_due_at || '').slice(0, 10))}"/></div>
                </div>
                <div class="dh-field"><label>Примечание передачи</label><textarea id="drDelivNote" rows="2">${esc(row.delivery_note || '')}</textarea></div>
              </div>
            </div>

            <!-- ─── Закрывающие ─── -->
            <div class="dh-section">
              <div class="dh-section__h">Закрывающие (СФ / УПД)</div>
              <div class="dh-section__b">
                <div id="drClosingList">${closingItems.map((cl, i) => `
                  <div class="dh-closing-row dr-closing-row" data-i="${i}">
                    <select data-k="kind"><option value="СФ" ${(cl.kind||'СФ')==='СФ'?'selected':''}>СФ</option><option value="УПД" ${cl.kind==='УПД'?'selected':''}>УПД</option><option value="Акт" ${cl.kind==='Акт'?'selected':''}>Акт</option></select>
                    <input data-k="no" placeholder="Номер" value="${esc(cl.no||'')}"/>
                    <input type="date" data-k="date" value="${esc(String(cl.date||'').slice(0,10))}"/>
                    <input type="number" data-k="sum" step="0.01" placeholder="Сумма" value="${esc(String(cl.sum||''))}"/>
                    <button type="button" class="dr-closing-del dh-line__x">✕</button>
                  </div>`).join('')}
                </div>
                <button type="button" class="dh-btn dh-btn--sm dh-btn--ghost" id="drAddClosing">+ добавить</button>
              </div>
            </div>

            <!-- ─── Прочее ─── -->
            <div class="dh-section">
              <div class="dh-section__h">Сроки и примечание сверки</div>
              <div class="dh-section__b">
                <div class="dh-grid2">
                  <div class="dh-field"><label>Срок оплаты</label><input type="date" id="drPayDue" value="${esc(String(row.payment_due_at || '').slice(0, 10))}"/></div>
                  <div class="dh-field"><label>Срок СФ</label><input type="date" id="drSfDue" value="${esc(String(row.sf_due_at || '').slice(0, 10))}"/></div>
                </div>
                <div class="dh-field"><label>Примечание сверки</label><textarea id="drRecNote" rows="2" placeholder="Акт сверки, расхождения…">${esc(row.reconciliation_note || '')}</textarea></div>
              </div>
            </div>

            <!-- ─── Ответственные ─── -->
            <div class="dh-section">
              <div class="dh-section__h">Ответственные</div>
              <div class="dh-section__b dh-grid2">
                <div class="dh-field"><label>Отв. за документы</label><input type="hidden" id="drDocOwner" value="${esc(String(row.doc_owner_id || ''))}" /><div id="drDocOwner_w" class="dh-crselect-host"></div></div>
                <div class="dh-field"><label>РП / объект</label><input type="hidden" id="drPmId" value="${esc(String(row.pm_id || ''))}" /><div id="drPm_w" class="dh-crselect-host"></div></div>
                <div class="dh-field"><label>Код 1С</label><input id="drOnecId" value="${esc(row.onec_id || '')}"/></div>
              </div>
            </div>

            <!-- ─── Комментарий ─── -->
            <div class="dh-section">
              <div class="dh-section__h">Комментарий</div>
              <div class="dh-section__b">
                <textarea id="drComment" rows="3" placeholder="Условия оплаты, примечания, ТК…">${esc(row.comment_text || '')}</textarea>
              </div>
            </div>

            <!-- ─── Вложения ─── -->
            <div class="dh-section">
              <div class="dh-section__h">Вложения</div>
              <div class="dh-section__b">
                ${attachmentsHtml(row)}
                <div class="dh-attach">
                  <div class="dh-attach__ico">+</div>
                  <div class="dh-attach__meta"><div class="a">Добавить скан СФ / УПД</div><div class="b">файл или путь</div></div>
                  <button class="dh-btn dh-btn--sm dh-btn--primary" type="button" data-qa="sf">СФ</button>
                </div>
              </div>
            </div>

            <!-- ─── Жизненный цикл ─── -->
            <div class="dh-section">
              <div class="dh-section__h">Жизненный цикл</div>
              <div class="dh-section__b"><div class="dh-timeline">${timelineHtml(row)}</div></div>
            </div>

            ${row.is_incomplete ? `<div class="dh-coach" style="border-color:color-mix(in srgb,var(--blue-l,#38bdf8) 40%,var(--brd,#334155))">
              <div class="dh-coach__ico" style="background:var(--info-bg);color:var(--info-t)">!</div>
              <div class="dh-coach__body"><strong>Дозаполните</strong><p>${esc(incompleteReasonsText(row))}</p></div>
            </div>` : ''}
          </div>
          <footer class="dh-drawer__foot">
            <button type="button" class="dh-btn dh-btn--ghost" id="dhDrawerClose2">Закрыть</button>
            <button type="button" class="dh-btn dh-btn--ghost" id="dhDrawerSave">💾 Сохранить</button>
            <button type="button" class="dh-btn dh-btn--ok" id="dhParseCatalog" ${row.dir !== 'in' ? 'disabled title="Только входящие"' : ''}>В каталог</button>
            <button type="button" class="dh-btn dh-btn--ghost" id="dhDrawerExpense" ${!row.work_id ? 'disabled title="Нет объекта"' : ''}>В расходы</button>
            ${canWh() ? '<button type="button" class="dh-btn dh-btn--ghost" data-qa="wh">Склад</button>' : ''}
            <button type="button" class="dh-btn dh-btn--primary" data-qa="pay">К оплате</button>
          </footer>
        </div>`;

      // Load works → CRSelect in drawer (async)
      (async () => {
        const wWrap = d.querySelector('#drWork_w');
        if (!wWrap) return;
        if (window.CRSelect) { try { CRSelect.destroy('drWork'); } catch (_) {} }
        try {
          const r2 = await fetch('/api/works?limit=300', { headers: authHeaders() });
          const j2 = await r2.json();
          const wlist = parseWorksList(j2);
          const curWid = String(row.work_id || '');
          const wopts = [{ value: '', label: '— выбрать объект —' }].concat(
            wlist.map((w) => ({ value: String(w.id), label: workLabel(w) }))
          );
          if (window.CRSelect) {
            wWrap.innerHTML = '';
            wWrap.appendChild(CRSelect.create({
              id: 'drWork',
              searchable: true, clearable: true, dropdownClass: 'z-modal',
              placeholder: 'Найти объект…', options: wopts, value: curWid,
              onChange: (v) => { const hid = d.querySelector('#drWorkId'); if (hid) hid.value = v || ''; }
            }));
          } else {
            // Graceful fallback: native select
            const sel = document.createElement('select');
            sel.innerHTML = wopts.map((o) => `<option value="${esc(o.value)}"${o.value === curWid ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
            sel.addEventListener('change', () => { const hid = d.querySelector('#drWorkId'); if (hid) hid.value = sel.value; });
            wWrap.appendChild(sel);
          }
        } catch (_) {}
      })();

      // Mount user CRSelects (doc_owner + pm) in drawer
      (async () => {
        const ownerWrap = d.querySelector('#drDocOwner_w');
        const pmWrap = d.querySelector('#drPm_w');
        if (!ownerWrap && !pmWrap) return;
        if (window.CRSelect) {
          try { CRSelect.destroy('drDocOwner'); } catch (_) {}
          try { CRSelect.destroy('drPm'); } catch (_) {}
        }
        // users already fetched above
        const curOwner = String(row.doc_owner_id || '');
        const curPm = String(row.pm_id || '');
        const uopts = [{ value: '', label: '— выбрать —' }].concat(
          users.map((u) => ({ value: String(u.id), label: userLabel(u) }))
        );
        if (ownerWrap) {
          if (window.CRSelect) {
            ownerWrap.innerHTML = '';
            ownerWrap.appendChild(CRSelect.create({
              id: 'drDocOwner', searchable: true, clearable: true, dropdownClass: 'z-modal',
              placeholder: 'Отв. за документы…', options: uopts, value: curOwner,
              onChange: (v) => { const hid = d.querySelector('#drDocOwner'); if (hid) hid.value = v || ''; }
            }));
          } else {
            const sel = document.createElement('select');
            sel.innerHTML = uopts.map((o) => `<option value="${esc(o.value)}"${o.value === curOwner ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
            sel.addEventListener('change', () => { const hid = d.querySelector('#drDocOwner'); if (hid) hid.value = sel.value; });
            ownerWrap.appendChild(sel);
          }
        }
        if (pmWrap) {
          if (window.CRSelect) {
            pmWrap.innerHTML = '';
            pmWrap.appendChild(CRSelect.create({
              id: 'drPm', searchable: true, clearable: true, dropdownClass: 'z-modal',
              placeholder: 'РП…', options: uopts, value: curPm,
              onChange: (v) => { const hid = d.querySelector('#drPmId'); if (hid) hid.value = v || ''; }
            }));
          } else {
            const sel = document.createElement('select');
            sel.innerHTML = uopts.map((o) => `<option value="${esc(o.value)}"${o.value === curPm ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
            sel.addEventListener('change', () => { const hid = d.querySelector('#drPmId'); if (hid) hid.value = sel.value; });
            pmWrap.appendChild(sel);
          }
        }
      })();

      // VAT chips in drawer
      d.querySelectorAll('#drVatChips .dh-vat-chip').forEach((btn) => {
        btn.onclick = () => {
          const raw = btn.getAttribute('data-vat-rate');
          d.querySelectorAll('#drVatChips .dh-vat-chip').forEach((b) => b.classList.toggle('is-on', b === btn));
          const hid = d.querySelector('#drVatRate');
          if (hid) hid.value = raw;
        };
      });

      // Contract mode cards in drawer
      d.querySelectorAll('#drContractModeCards [data-mode]').forEach((btn) => {
        btn.onclick = () => {
          const v = btn.getAttribute('data-mode');
          d.querySelector('#drContractMode').value = v;
          d.querySelectorAll('#drContractModeCards .dh-mode-card').forEach((b) => b.classList.toggle('is-on', b === btn));
          const pickRow = d.querySelector('#drContractPickerRow');
          const labelRow = d.querySelector('#drContractLabelRow');
          if (pickRow) pickRow.hidden = v !== 'linked';
          if (labelRow) labelRow.hidden = v === 'none';
        };
      });

      // Contract picker in drawer
      d.querySelector('#drContractPick')?.addEventListener('click', () => {
        const inn = d.querySelector('#drCpInn')?.value || row.inn || '';
        const cpName = d.querySelector('#drCpName')?.value || row.counterparty_name || '';
        const cb = (contract) => {
          if (!contract) return;
          const idHid = d.querySelector('#drContractId');
          if (idHid) idHid.value = contract.id || '';
          const lbl = d.querySelector('#drContractLabel');
          if (lbl) lbl.value = contract.label || contract.number || '';
          const dt = d.querySelector('#drContractDate');
          if (dt && contract.date) dt.value = String(contract.date).slice(0, 10);
          d.querySelector('#drContractPick').textContent = '✓ ' + (contract.label || contract.number || 'Привязан');
          toast('Договор', 'Привязан: ' + (contract.label || contract.number || contract.id), 'ok');
        };
        openDhContractPicker({ inn, cpName, onSelect: cb });
      });

      // CRAutocomplete для контрагента в карточке — наша база + ЕГРЮЛ
      (function mountDrCp() {
        const cpMount = d.querySelector('#drCpMount');
        if (!cpMount || typeof CRAutocomplete === 'undefined' || typeof CRAutocomplete.create !== 'function') return;
        try {
          try { CRAutocomplete.destroy('drCp'); } catch (_) {}
          cpMount.innerHTML = '';
          cpMount.appendChild(CRAutocomplete.create({
            id: 'drCp',
            placeholder: 'Название организации или ИНН',
            minChars: 2,
            debounce: 300,
            fullWidth: true,
            clearable: true,
            dropdownClass: 'z-modal-ac',
            value: (row.counterparty_name || ''),
            fetchOptions: dhCounterpartySuggest,
            onSelect: (item) => {
              if (item === null) { const el = d.querySelector('#drCpName'); if (el) el.value = ''; return; }
              dhApplyCounterparty('dr', item, { askCreate: true });
            }
          }));
        } catch (_) { /* CRAutocomplete недоступен — скрытое поле остаётся */ }
      })();

      // spend_kind cards in drawer
      d.querySelectorAll('#drSpendCards [data-spend]').forEach((btn) => {
        btn.onclick = () => {
          const v = btn.getAttribute('data-spend');
          d.querySelector('#drSpendKind').value = v;
          d.querySelectorAll('#drSpendCards .dh-spend-card').forEach((b) => b.classList.toggle('is-on', b === btn));
          const wf = d.querySelector('#drWorkField');
          if (wf) wf.style.display = v === 'work' ? '' : 'none';
        };
      });

      // Closing rows: add + delete
      const addClosingRow = (pre) => {
        const list = d.querySelector('#drClosingList');
        if (!list) return;
        const row2 = document.createElement('div');
        row2.className = 'dh-closing-row dr-closing-row';
        row2.innerHTML = `
          <select data-k="kind"><option value="СФ">СФ</option><option value="УПД">УПД</option><option value="Акт">Акт</option></select>
          <input data-k="no" placeholder="Номер" value="${esc((pre && pre.no) || '')}"/>
          <input type="date" data-k="date" value="${esc(pre && pre.date ? String(pre.date).slice(0, 10) : '')}"/>
          <input type="number" data-k="sum" step="0.01" placeholder="Сумма" value="${esc(pre && pre.sum != null ? String(pre.sum) : '')}"/>
          <button type="button" class="dr-closing-del dh-line__x">✕</button>`;
        if (pre && pre.kind) row2.querySelector('[data-k="kind"]').value = pre.kind;
        row2.querySelector('.dr-closing-del').onclick = () => row2.remove();
        list.appendChild(row2);
      };
      d.querySelector('#drAddClosing')?.addEventListener('click', () => addClosingRow(null));
      d.querySelectorAll('.dr-closing-del').forEach((btn) => { btn.onclick = () => btn.closest('.dr-closing-row').remove(); });

      // saveDrawer: PUT all WRITE fields
      const saveDrawer = async () => {
        const drVatRaw = d.querySelector('#drVatRate')?.value;
        const drVatRate = drVatRaw === '' || drVatRaw === 'null' ? null : parseFloat(drVatRaw);
        const grossVal = parseFloat(d.querySelector('#drGross')?.value);
        const netVal = parseFloat(d.querySelector('#drNet')?.value);
        const closingRows = [...d.querySelectorAll('.dr-closing-row')].map((row2) => ({
          kind: row2.querySelector('[data-k="kind"]')?.value || 'СФ',
          no: row2.querySelector('[data-k="no"]')?.value || '',
          date: row2.querySelector('[data-k="date"]')?.value || null,
          sum: parseFloat(row2.querySelector('[data-k="sum"]')?.value) || null
        })).filter((cl) => cl.no || cl.date);
        const patch = {
          counterparty_name: d.querySelector('#drCpName')?.value || '',
          counterparty_inn: d.querySelector('#drCpInn')?.value || null,
          counterparty_email: d.querySelector('#drCpEmail')?.value || null,
          counterparty_phone: d.querySelector('#drCpPhone')?.value || null,
          amount_gross: Number.isFinite(grossVal) ? grossVal : (sums.gross),
          amount_net: Number.isFinite(netVal) ? netVal : null,
          has_vat: drVatRate !== null,
          vat_rate: drVatRate,
          contract_mode: d.querySelector('#drContractMode')?.value || 'none',
          contract_id: parseInt(d.querySelector('#drContractId')?.value) || null,
          contract_label: d.querySelector('#drContractLabel')?.value || null,
          contract_date: d.querySelector('#drContractDate')?.value || null,
          contract_has_scan: !!d.querySelector('#drHasScan')?.checked,
          contract_has_original: !!d.querySelector('#drHasOriginal')?.checked,
          spend_kind: d.querySelector('#drSpendKind')?.value || 'other',
          work_id: parseInt((window.CRSelect ? CRSelect.getValue('drWork') : null) || d.querySelector('#drWorkId')?.value) || null,
          receive_channel: d.querySelector('#drReceive')?.value || null,
          purpose_customer: !!d.querySelector('#drPurpCust')?.checked,
          purpose_asgard: !!d.querySelector('#drPurpAsg')?.checked,
          purpose_consumables: !!d.querySelector('#drPurpCons')?.checked,
          vitya_state: d.querySelector('#drVityaState')?.value || null,
          delivery_note: d.querySelector('#drDelivNote')?.value || null,
          delivery_due_at: d.querySelector('#drDelivDue')?.value || null,
          payment_due_at: d.querySelector('#drPayDue')?.value || null,
          sf_due_at: d.querySelector('#drSfDue')?.value || null,
          reconciliation_note: d.querySelector('#drRecNote')?.value || null,
          doc_owner_id: parseInt((window.CRSelect ? CRSelect.getValue('drDocOwner') : null) || d.querySelector('#drDocOwner')?.value) || null,
          pm_id: parseInt((window.CRSelect ? CRSelect.getValue('drPm') : null) || d.querySelector('#drPmId')?.value) || null,
          onec_id: d.querySelector('#drOnecId')?.value || null,
          comment_text: d.querySelector('#drComment')?.value || ''
        };
        if (closingRows.length) patch.closing_json = closingRows;
        try {
          await api('/' + id, { method: 'PUT', body: JSON.stringify(patch) });
          toast('Сохранено', 'Карточка обновлена', 'ok');
          await refresh();
          openDrawer(id);
        } catch (e) { toast('Ошибка', e.message || 'PUT failed', 'err'); }
      };

      d.querySelector('#dhDrawerClose')?.addEventListener('click', closeDrawer);
      d.querySelector('#dhDrawerClose2')?.addEventListener('click', closeDrawer);
      d.querySelector('#dhDrawerSave')?.addEventListener('click', saveDrawer);
      d.querySelector('#dhDrawerExpense')?.addEventListener('click', () => {
        if (row.work_id) location.hash = '#/works/' + row.work_id;
        else toast('Объект', 'Сначала укажите работу в карточке', 'warn');
      });
      d.querySelectorAll('[data-qa]').forEach((btn) => {
        btn.addEventListener('click', () => quick(id, btn.getAttribute('data-qa')));
      });
      d.querySelector('#dhParseCatalog')?.addEventListener('click', async () => {
        const ok = await confirm('В каталог', 'Разобрать позиции и обновить номенклатуру — ' + docSummary(row) + '?');
        if (!ok) return;
        try {
          let items = null;
          const pj = row.parsed_json;
          if (Array.isArray(pj)) items = pj;
          else if (pj && Array.isArray(pj.lines)) items = pj.lines;
          const body = items && items.length ? { items } : {};
          const res = await api('/' + id + '/parse-catalog', { method: 'POST', body: JSON.stringify(body) });
          const n = Array.isArray(res && res.lines) ? res.lines.length : 0;
          const touched = res && res.catalog && (res.catalog.products_touched || res.catalog.created || 0);
          toast('Каталог', n ? ('Позиций: ' + n + (touched ? ('; каталог ±' + touched) : '') + '. См. #/suppliers-catalog') : (res && res.pending ? 'Ожидает разбора скана' : 'Готово'), 'ok');
          await refresh();
          openDrawer(id);
        } catch (e) { toast('Ошибка', e.message || 'parse-catalog', 'err'); }
      });
    } catch (e) {
      toast('Ошибка', e.message, 'err');
    }
  }

  async function export1c() {
    try {
      const tok = (window.AsgardAuth && AsgardAuth.token) || localStorage.getItem('asgard_token');
      const r = await fetch('/api/doc-registry/export-1c', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json', Accept: 'application/json, text/csv' },
        body: JSON.stringify({ ids: state.rows.map((x) => x.id) }),
        cache: 'no-store'
      });
      const ct = (r.headers.get('content-type') || '').toLowerCase();
      let csv = '';
      if (ct.includes('application/json')) {
        const j = await r.json();
        if (!r.ok) throw new Error((j && (j.error || j.message)) || ('HTTP ' + r.status));
        csv = j.csv || j.data || '';
      } else {
        const text = await r.text();
        if (!r.ok) throw new Error(text || ('HTTP ' + r.status));
        csv = text;
      }
      if (!csv) throw new Error('Пустой CSV');
      const modal = document.getElementById('dhModal');
      if (modal) {
        modal.hidden = false;
        modal.innerHTML = `<div class="dh-modal__card dh-modal__card--wide">
          <header class="dh-modal__head"><h2>Выгрузка в 1С</h2><button type="button" class="dh-modal__x" id="dhModalClose">✕</button></header>
          <div class="dh-modal__body">
            <p class="dh-hint">CSV готов. Скачайте файл и загрузите в 1С.</p>
            <pre class="dh-csv-preview">${esc(String(csv).slice(0, 1800))}${String(csv).length > 1800 ? '\n…' : ''}</pre>
          </div>
          <footer class="dh-modal__foot">
            <button type="button" class="dh-btn dh-btn--ghost" id="dhExportClose">Закрыть</button>
            <button type="button" class="dh-btn dh-btn--primary" id="dhExportDl">Скачать CSV</button>
          </footer>
        </div>`;
        const close = () => { modal.hidden = true; };
        modal.querySelector('#dhModalClose').onclick = close;
        modal.querySelector('#dhExportClose').onclick = close;
        modal.querySelector('#dhExportDl').onclick = () => {
          const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'doc-registry-1c.csv';
          a.click();
          URL.revokeObjectURL(a.href);
          toast('Выгрузка', 'CSV скачан', 'ok');
        };
      } else {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'doc-registry-1c.csv';
        a.click();
        URL.revokeObjectURL(a.href);
      }
      toast('Выгрузка', 'CSV готов', 'ok');
    } catch (e) {
      toast('Ошибка', e.message, 'err');
    }
  }

  async function import1c() {
    const raw = window.prompt('Вставьте JSON массив [{id, onec_id}] или строки id;onec_id');
    if (!raw) return;
    let rows;
    try {
      rows = JSON.parse(raw);
    } catch (_) {
      rows = raw.split(/\n+/).map((line) => {
        const [id, onec_id] = line.split(/[;,]/);
        return { id: Number(id), onec_id };
      }).filter((x) => x.id && x.onec_id);
    }
    try {
      const res = await api('/import-1c', { method: 'POST', body: JSON.stringify({ rows }) });
      toast('1С', `Сматчено: ${res.matched || 0}, пропущено: ${res.unmatched || res.skipped || 0}`, 'ok');
      await refresh();
    } catch (e) {
      toast('Ошибка', e.message, 'err');
    }
  }

  function bindFacets(root) {
    const apply = async () => {
      state.facetCounterparty = (root.querySelector('#dhFacetCp')?.value || '').trim();
      state.facetOps = root.querySelector('#dhFacetOps')?.value || '';
      state.facetIncomplete = !!root.querySelector('#dhFacetIncomplete')?.checked;
      state.year = root.querySelector('#dhFacetYear')?.value || '';
      if (state.facetIncomplete) state.kpi = 'incomplete';
      syncHash();
      await refresh();
    };
    let t = null;
    root.querySelector('#dhFacetCp')?.addEventListener('change', apply);
    root.querySelector('#dhFacetCp')?.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(apply, 400);
    });
    root.querySelector('#dhFacetOps')?.addEventListener('change', apply);
    root.querySelector('#dhFacetIncomplete')?.addEventListener('change', apply);
    root.querySelector('#dhFacetYear')?.addEventListener('change', apply);
    root.querySelector('#dhQtrChips')?.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('[data-qtr]');
      if (!btn) return;
      state.quarter = btn.getAttribute('data-qtr') || '';
      root.querySelectorAll('#dhQtrChips .dh-qchip').forEach((b) => {
        b.classList.toggle('is-on', (b.getAttribute('data-qtr') || '') === state.quarter);
      });
      syncHash();
      await refresh();
    });
  }

  function syncHash() {
    try {
      const u = new URL(location.href);
      const h = new URLSearchParams((u.hash.split('?')[1] || ''));
      if (state.quarter) h.set('quarter', state.quarter); else h.delete('quarter');
      if (state.year) h.set('year', state.year); else h.delete('year');
      if (state.scope === 'all') h.set('scope', 'all'); else h.delete('scope');
      const base = (u.hash.split('?')[0] || '#/doc-hub');
      const qs = h.toString();
      history.replaceState(null, '', qs ? (base + '?' + qs) : base);
    } catch (_) { /* ignore */ }
  }

  function readHashFilters() {
    try {
      const qs = (location.hash.split('?')[1] || '');
      const h = new URLSearchParams(qs);
      if (h.has('quarter')) state.quarter = h.get('quarter') || '';
      if (h.has('year')) state.year = h.get('year') || '';
      if (h.get('scope') === 'all') state.scope = 'all';
    } catch (_) { /* ignore */ }
  }

  /**
   * Comment bubble for table rows. stopPropagation prevents row → drawer open.
   */
  function bindTableCmt(root) {
    const host = root.querySelector('#dhTableHost');
    if (!host) return;
    let pop = null;
    const closePop = () => { if (pop) { pop.remove(); pop = null; } };

    host.addEventListener('click', (e) => {
      const btn = e.target.closest('.dh-cmt-btn');
      if (!btn) { if (!e.target.closest('.dh-cmt-pop')) closePop(); return; }
      e.stopPropagation();
      if (pop) { closePop(); return; }
      const id = Number(btn.getAttribute('data-cmt'));
      if (!id) return;
      const existing = btn.getAttribute('data-comment') || '';
      const rect = btn.getBoundingClientRect();
      pop = document.createElement('div');
      pop.className = 'dh-cmt-pop';
      pop.innerHTML = `
        <div class="dh-cmt-pop__head">Комментарий</div>
        <textarea class="dh-cmt-pop__ta" rows="4" placeholder="Условия, примечания, ТК…">${esc(existing)}</textarea>
        <div class="dh-cmt-pop__foot">
          <button class="dh-btn dh-btn--sm dh-btn--ghost" id="dhCmtClear">Очистить</button>
          <button class="dh-btn dh-btn--sm dh-btn--primary" id="dhCmtSave">Сохранить</button>
        </div>`;
      // Position near button, avoid overflow
      const top = Math.min(rect.bottom + 6, window.innerHeight - 220);
      const right = Math.max(4, window.innerWidth - rect.right);
      pop.style.cssText = `position:fixed;top:${top}px;right:${right}px;`;
      document.body.appendChild(pop);
      pop.querySelector('.dh-cmt-pop__ta').focus();

      const doSave = async () => {
        const text = pop.querySelector('.dh-cmt-pop__ta').value.trim();
        try {
          await api('/' + id, { method: 'PUT', body: JSON.stringify({ comment_text: text }) });
          btn.setAttribute('data-comment', text);
          btn.classList.toggle('is-filled', !!text);
          btn.title = text ? String(text).slice(0, 60) : 'Комментарий';
          const svg = btn.querySelector('svg');
          if (svg) svg.setAttribute('fill', text ? 'currentColor' : 'none');
          toast('Комментарий', 'Сохранён', 'ok');
          closePop();
          if (state.selectedId === id) openDrawer(id);
        } catch (err) { toast('Ошибка', err.message, 'err'); }
      };
      pop.querySelector('#dhCmtSave').onclick = (ev) => { ev.stopPropagation(); doSave(); };
      pop.querySelector('#dhCmtClear').onclick = (ev) => { ev.stopPropagation(); pop.querySelector('.dh-cmt-pop__ta').value = ''; };
      pop.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) doSave(); ev.stopPropagation(); });
    }, true);

    document.addEventListener('click', (e) => {
      if (pop && !pop.contains(e.target) && !e.target.closest('.dh-cmt-btn')) closePop();
    });
  }

  function bind(root) {
    root.querySelector('#dhWizToRegistry')?.addEventListener('click', async () => {
      state.view = 'registry';
      await paint(window.__docHubLayout || window.layout);
    });
    root.querySelector('#dhBtnNew')?.addEventListener('click', () => { openWizard(); });
    root.querySelector('#dhBtnExport1c')?.addEventListener('click', export1c);
    root.querySelector('#dhBtnImport1c')?.addEventListener('click', import1c);
    root.querySelector('#dhBtnGuide')?.addEventListener('click', async () => {
      state.view = state.view === 'guide' ? 'registry' : 'guide';
      await paint(window.__docHubLayout || window.layout);
    });
    root.querySelector('#dhBtnHelp')?.addEventListener('click', () => {
      state.coachOpen = !state.coachOpen;
      root.querySelector('#dhCoach')?.classList.toggle('is-collapsed', !state.coachOpen);
    });
    root.querySelector('#dhCoachClose')?.addEventListener('click', () => {
      state.coachOpen = false;
      root.querySelector('#dhCoach')?.classList.add('is-collapsed');
    });
    root.querySelector('#dhScopeAll')?.addEventListener('change', async (e) => {
      state.scope = e.target.checked ? 'all' : 'mine';
      await loadFacets();
      await refresh();
    });
    root.querySelector('#dhChipIncomplete')?.addEventListener('click', async () => {
      state.facetIncomplete = !state.facetIncomplete;
      state.kpi = state.facetIncomplete ? 'incomplete' : 'all';
      await refresh();
    });
    root.querySelectorAll('#dhKpis [data-kpi]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        state.kpi = btn.getAttribute('data-kpi');
        if (state.kpi === 'incomplete') state.facetIncomplete = true;
        else if (state.facetIncomplete && state.kpi !== 'incomplete') {
          /* leave facet as-is unless user clears checkbox */
        }
        await refresh();
      });
    });
    root.querySelectorAll('#dhDirSeg [data-dir]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        state.dir = btn.getAttribute('data-dir');
        await refresh();
      });
    });
    let t = null;
    root.querySelector('#dhSearch')?.addEventListener('input', (e) => {
      clearTimeout(t);
      t = setTimeout(async () => {
        state.q = e.target.value.trim();
        await refresh();
      }, 280);
    });
    bindFacets(root);
    bindTableCmt(root);
    root.querySelector('#dhTableHost')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-qa]');
      const tr = e.target.closest('tr[data-id]');
      if (!tr) return;
      const id = Number(tr.getAttribute('data-id'));
      if (btn) {
        const qa = btn.getAttribute('data-qa');
        if (qa === 'open') openDrawer(id);
        else quick(id, qa);
        return;
      }
      openDrawer(id);
    });
    if (!window.__dhEscBound) {
      window.__dhEscBound = true;
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const d = document.getElementById('dhDrawer');
        if (d && !d.hidden) closeDrawer();
      });
    }
  }

  function updateKpiDom() {
    const kpis = document.getElementById('dhKpis');
    if (!kpis) return;
    const map = {
      all: 'all', pay: 'pay', sf: 'sf', wh: 'wh', out: 'out', '1c': 'no_1c', incomplete: 'incomplete'
    };
    kpis.querySelectorAll('[data-kpi]').forEach((b) => {
      const key = b.getAttribute('data-kpi');
      b.classList.toggle('is-on', key === state.kpi);
      const v = b.querySelector('.v');
      const s = b.querySelector('.s');
      if (v && map[key]) v.textContent = kpiVal(map[key]);
      if (s && map[key]) s.textContent = kpiSub(map[key]);
    });
    const meta = document.getElementById('dhRowsMeta');
    if (meta) {
      meta.textContent = `показано ${state.rows.length} из ${state.total || state.rows.length}${state.scope === 'all' ? ' · все строки' : ' · только мои'}`;
    }
    const chip = document.getElementById('dhChipIncomplete');
    if (chip) {
      chip.classList.toggle('is-on', state.facetIncomplete || state.kpi === 'incomplete');
      const n = chip.querySelector('.n');
      if (n) n.textContent = kpiVal('incomplete');
    }
  }

  function bindHScroll() {
    const wrap = document.querySelector('#dhTableHost .dh-table-wrap') || document.getElementById('dhTableWrap');
    const bar = document.getElementById('dhHScrollBar');
    if (!wrap || !bar) return;
    const inner = bar.querySelector('.dh-hscroll-bar__inner');
    if (!inner) return;

    const syncSize = () => {
      const need = wrap.scrollWidth > wrap.clientWidth + 2;
      bar.hidden = !need;
      bar.classList.toggle('is-on', need);
      inner.style.width = need ? wrap.scrollWidth + 'px' : '0px';
      if (need && Math.abs(bar.scrollLeft - wrap.scrollLeft) > 1) bar.scrollLeft = wrap.scrollLeft;
    };
    const onWrapScroll = () => {
      if (bar._dhLock) return;
      bar._dhLock = true;
      bar.scrollLeft = wrap.scrollLeft;
      bar._dhLock = false;
    };
    const onBarScroll = () => {
      if (bar._dhLock) return;
      bar._dhLock = true;
      wrap.scrollLeft = bar.scrollLeft;
      bar._dhLock = false;
    };
    const onWheel = (e) => {
      if (wrap.scrollWidth <= wrap.clientWidth + 2) return;
      const dx = e.deltaX || 0;
      const dy = e.deltaY || 0;
      // Trackpad horizontal → X
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 0) {
        wrap.scrollLeft += dx;
        e.preventDefault();
        return;
      }
      // Shift+wheel → X (явный гориз.)
      if (e.shiftKey && Math.abs(dy) > 0) {
        wrap.scrollLeft += dy;
        e.preventDefault();
        return;
      }
      // Нет вертикального overflow в wrap → deltaY в горизонт (как в плане)
      const canY = wrap.scrollHeight > wrap.clientHeight + 2;
      if (!canY && Math.abs(dy) > 0) {
        wrap.scrollLeft += dy;
        e.preventDefault();
      }
      // иначе оставляем нативный вертикальный скролл таблицы/страницы
    };

    wrap.removeEventListener('scroll', wrap.__dhHScroll || (() => {}));
    wrap.removeEventListener('wheel', wrap.__dhHWheel || (() => {}));
    bar.removeEventListener('scroll', bar.__dhHScroll || (() => {}));
    if (wrap.__dhHRo) try { wrap.__dhHRo.disconnect(); } catch (_) { /* ignore */ }

    wrap.__dhHScroll = onWrapScroll;
    wrap.__dhHWheel = onWheel;
    bar.__dhHScroll = onBarScroll;
    wrap.addEventListener('scroll', onWrapScroll, { passive: true });
    wrap.addEventListener('wheel', onWheel, { passive: false });
    bar.addEventListener('scroll', onBarScroll, { passive: true });
    wrap.__dhHRo = new ResizeObserver(syncSize);
    wrap.__dhHRo.observe(wrap);
    const table = wrap.querySelector('table');
    if (table) wrap.__dhHRo.observe(table);
    syncSize();
    requestAnimationFrame(syncSize);
  }

  function bindQuarterLive() {
    const live = document.getElementById('dhQtrLive');
    const wrap = document.querySelector('#dhTableHost .dh-table-wrap');
    if (!live || !wrap) return;
    const seps = [...wrap.querySelectorAll('.dh-qtr-sep')];
    if (!seps.length) {
      live.classList.remove('is-on');
      live.textContent = '';
      return;
    }
    const update = () => {
      const scrolled = wrap.scrollTop > 24;
      const top = wrap.getBoundingClientRect().top + 8;
      let cur = seps[0];
      for (const sep of seps) {
        const r = sep.getBoundingClientRect();
        if (r.top <= top + 28) cur = sep;
      }
      const q = cur.getAttribute('data-qtr');
      const y = cur.getAttribute('data-year');
      const label = q && q !== '0' ? quarterLabel(+q, +y) : 'Без даты документа';
      const idx = seps.indexOf(cur);
      const next = seps[idx + 1];
      let nextHint = '';
      if (next) {
        const nq = next.getAttribute('data-qtr');
        const ny = next.getAttribute('data-year');
        if (nq && nq !== '0') nextHint = ` → ${quarterLabel(+nq, +ny)}`;
      }
      live.innerHTML = `<span class="arrow">↓</span><span>${esc(label)}</span><span class="dh-qtr-sep__hint">по дате документа${esc(nextHint)}</span>`;
      live.classList.toggle('is-on', scrolled);
    };
    wrap.removeEventListener('scroll', wrap.__dhQtrScroll || (() => {}));
    wrap.__dhQtrScroll = update;
    wrap.addEventListener('scroll', update, { passive: true });
    update();
  }

  async function refresh() {
    if (state.view === 'guide' || state.view === 'wizard') return;
    const host = document.getElementById('dhTableHost');
    if (!host) return;
    await loadData();
    host.innerHTML = renderTable();
    bindQuarterLive();
    bindHScroll();
    updateKpiDom();
    const scopeEl = document.getElementById('dhScopeAll');
    if (scopeEl) scopeEl.checked = state.scope === 'all';
    document.querySelectorAll('#dhDirSeg [data-dir]').forEach((b) => {
      b.classList.toggle('is-on', b.getAttribute('data-dir') === state.dir);
    });
    const inc = document.getElementById('dhFacetIncomplete');
    if (inc) inc.checked = state.facetIncomplete || state.kpi === 'incomplete';
  }

  async function paint(layoutFn) {
    window.__docHubLayout = layoutFn;
    if (state.view === 'registry') {
      await Promise.all([loadData(), loadFacets()]);
    }
    const html = shellHtml();
    if (typeof layoutFn === 'function') {
      await layoutFn(html, { title: state.view === 'wizard' ? 'Внести документ' : 'Реестр документов' });
    } else if (layoutFn && layoutFn.innerHTML !== undefined) {
      layoutFn.innerHTML = html;
    } else if (window.layout) {
      await window.layout(html, { title: state.view === 'wizard' ? 'Внести документ' : 'Реестр документов' });
    }
    bind(document);
    if (state.view === 'registry') {
      bindQuarterLive();
      bindHScroll();
    }
    if (state.view === 'wizard') {
      const host = document.getElementById('dhWizardHost');
      if (host) paintWizard(host);
    }
  }

  async function render({ layout: layoutFn, title }) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = '#/login'; return; }
    const user = auth.user;
    if (!ROLES.includes(user.role)) {
      toast('Доступ', 'Раздел недоступен для вашей роли', 'err');
      location.hash = '#/home';
      return;
    }
    // F5 / новый заход: всегда mine (НЕ sessionStorage)
    state.scope = 'mine';
    state.kpi = 'all';
    state.dir = 'all';
    state.q = '';
    state.facetCounterparty = '';
    state.facetOps = '';
    state.facetIncomplete = false;
    state.quarter = '';
    state.year = '';
    state.view = 'registry';
    state.selectedId = null;
    state.coachOpen = true;
    readHashFilters(); // scope/quarter/year from #/doc-hub?...
    await paint(layoutFn || window.layout);
    try {
      const q = new URLSearchParams((location.hash.split('?')[1] || ''));
      const id = Number(q.get('id'));
      if (id) openDrawer(id);
    } catch (_) { /* ignore */ }
  }

  return { render, openDrawer };
})();
