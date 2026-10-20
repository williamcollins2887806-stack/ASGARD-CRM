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
  // V394: кто может запрашивать/снимать корректировку СФ/акта (зеркало бэка
  // src/routes/doc-registry.js action=correction).
  const CORR_ROLES = ['BUH', 'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'DIRECTOR'];
  // Светофор: цвет → человекочитаемая метка (для title/aria).
  const TRAFFIC_META = {
    red: 'Красный: просрочка или корректировка',
    blue: 'Синий: не заполнены обязательные поля',
    yellow: 'Жёлтый: срок ≤ 5 рабочих дней',
    green: 'Зелёный: действий не требуется'
  };
  // D-298 (заказчик 20.10.2026): типы закрывающих документов.
  // Было только СФ/УПД/Акт — не было чека и СЗ, хотя они встречаются.
  // Дублируется справочником settings.doc_closing_kinds (V423) для бэка.
  const CLOSING_KINDS = ['СФ', 'УПД', 'Акт', 'Чек', 'СЗ', 'ТОРГ-12', 'Иное'];
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
    facetOwners: [],
    facetPms: [],
    facetIncomplete: false,
    quarter: '',
    year: '',
    // Сортировка реестра (заказчик 19.10.2026: «где фильтр по дате внесения?»).
    // invoice_desc — как было (дата счёта), created_desc — по дате внесения в CRM.
    sort: 'invoice_desc',
    actsTab: false,      // V394: вкладка «Акты сверки»
    archiveTab: false,   // паритет с «Выплатами»: вкладка «Архив»
    archTab: 'summary',  // D-291: внутри Архива — сводка по месяцам или корзина
    payTab: false,       // D-291: вкладка «График оплат»
    payMode: 'approved', // D-292: 'approved' — только согласованные директором
    sfTab: false,        // V394: экран «Входящие СФ» (кладовщик)
    sfOnlyPending: true, // на экране СФ по умолчанию только те, что ждут получения
    facets: { counterparties: [] },
    rows: [],
    total: 0,
    page: 1,
    pageSize: (window.AsgardPagination ? AsgardPagination.getPageSize() : 20),
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
  // Акты сверки ведёт бухгалтерия/офис/директора — зеркало RECON_ROLES на бэке.
  function canReconAct() { return ['BUH', 'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'DIRECTOR', 'OFFICE_MANAGER'].includes(role()); }
  function canCorrect() { return CORR_ROLES.includes(role()); }

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
    return w.work_title || w.title || w.name || w.object_name || ('Работа #' + w.id);
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

  /** Разметка строки подсказки: наш контрагент подсвечен бейджем «В CRM». */
  function dhCounterpartyItemHtml(item) {
    const name = esc(item.label || item.value || '');
    const sub = esc(item.sublabel || '');
    if (item._crm) {
      const bits = [];
      if (item.docs_count) bits.push(item.docs_count + ' сч.');
      if (item.contracts_count) bits.push(item.contracts_count + ' дог.');
      return '<div class="cr-ac__option-label dh-cp-in"><span class="dh-cp-badge">В CRM</span>' + name +
        (bits.length ? '<span class="dh-cp-cnt">' + esc(bits.join(' · ')) + '</span>' : '') + '</div>' +
        (sub ? '<div class="cr-ac__option-sublabel">' + sub + '</div>' : '');
    }
    return '<div class="cr-ac__option-label">' + name + '</div>' +
      (sub ? '<div class="cr-ac__option-sublabel">' + sub + '</div>' : '');
  }

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

    // 1) Наши контрагенты (поставщики, с которыми уже работаем).
    // Приоритет: у кого больше счетов в реестре — тот и первый в списке.
    try {
      const j = await dhCustomerFetch('/api/customers/registry-suggest?q=' + encodeURIComponent(query) + '&limit=12');
      for (const c of (j && j.suppliers) || []) {
        const name = c.name || '';
        if (!name) continue;
        const bits = [];
        if (c.inn) bits.push('ИНН ' + c.inn);
        if (c.phone) bits.push(c.phone);
        if (c.email) bits.push(c.email);
        out.push({
          value: name, label: name,
          sublabel: bits.join(' · '),
          inn: c.inn || '', email: c.email || '', phone: c.phone || '',
          docs_count: c.docs_count || 0, contracts_count: c.contracts_count || 0,
          _crm: true, _source: 'local'
        });
      }
    } catch (_) { /* база недоступна — не блокируем */ }

    // 1b) Заказчики из customers (у них контакты заполнены чаще)
    try {
      const j2 = await dhCustomerFetch('/api/customers?search=' + encodeURIComponent(query) + '&limit=8');
      for (const c of (j2 && j2.customers) || []) {
        const name = c.name || c.full_name || '';
        if (!name) continue;
        if (c.inn && out.some((x) => normDigits(x.inn) === normDigits(c.inn))) continue;
        const bits = [];
        if (c.inn) bits.push('ИНН ' + c.inn);
        if (c.phone) bits.push(c.phone);
        bits.push('заказчик');
        out.push({
          value: name, label: name, sublabel: bits.join(' · '),
          inn: c.inn || '', email: c.email || '', phone: c.phone || '',
          _crm: true, _source: 'customer'
        });
      }
    } catch (_) { /* ignore */ }

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
          if (s.inn && out.some((x) => normDigits(x.inn) === normDigits(s.inn))) continue;
          out.push({
            value: name, label: name,
            sublabel: 'ИНН ' + (s.inn || '—') + ' · ЕГРЮЛ',
            inn: s.inn || '', email: '', phone: '', kpp: s.kpp || '', _source: 'dadata'
          });
        }
      }
    } catch (_) { /* DaData недоступна — остаются локальные */ }

    // Наши контрагенты — всегда выше ЕГРЮЛ
    out.sort((a, b) => (b._crm ? 1 : 0) - (a._crm ? 1 : 0) || (b.docs_count || 0) - (a.docs_count || 0));
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
    let email = item.email || '';
    let phone = item.phone || '';

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

    // Телефон/почта могли не прийти в подсказке — догружаем из карточки/документов
    if (inn && (!phone || !email)) {
      dhCustomerFetch('/api/customers/registry-contacts/' + inn).then((c) => {
        if (!c) return;
        const ph = phone || c.phone || '';
        const em = email || c.email || '';
        if (scope === 'wiz') {
          const form = document.getElementById('dhWizForm');
          const d = state.wizDraft;
          if (d) { if (ph) d.counterparty_phone = ph; if (em) d.counterparty_email = em; }
          const set = (sel, val) => { const el = form && form.querySelector(sel); if (el && val) el.value = val; };
          set('#dhWizEmail', em);
          set('#dhWizPhone', ph);
        } else {
          const d = document.getElementById('dhDrawer');
          const set = (sel, val) => { const el = d && d.querySelector(sel); if (el && val) el.value = val; };
          set('#drCpEmail', em);
          set('#drCpPhone', ph);
        }
      }).catch(() => {});
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
      let forbidden = false;
      try {
        // 403 кэшируется в AsgardDB как запрещённая таблица — проверяем явно,
        // чтобы не писать ложно «договоров нет» вместо «нет доступа».
        if (window.AsgardDB && typeof AsgardDB.isForbidden === 'function') {
          forbidden = AsgardDB.isForbidden('contracts');
        }
        if (ACP && typeof ACP.getAll === 'function') list = await ACP.getAll();
        else if (window.AsgardDB && AsgardDB.getAll) list = (await AsgardDB.getAll('contracts')) || [];
        if (!list || !list.length) {
          if (window.AsgardDB && typeof AsgardDB.isForbidden === 'function') forbidden = AsgardDB.isForbidden('contracts');
        }
      } catch (_) { list = []; }
      if (forbidden) { showNoAccessModal(); return; }
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

  /** Отдельная модалка: реестр договоров недоступен по правам (403). */
  function showNoAccessModal() {
    document.getElementById('dhContractModal')?.remove();
    const wrap = document.createElement('div');
    wrap.id = 'dhContractModal';
    wrap.className = 'dh-cmodal';
    wrap.innerHTML = `
      <div class="dh-cmodal__card" role="dialog" aria-modal="true">
        <header class="dh-cmodal__head">
          <strong>Договоры недоступны</strong>
          <button type="button" class="dh-cmodal__x" aria-label="Закрыть">✕</button>
        </header>
        <div class="dh-empty dh-empty--sm" style="padding:18px">
          <div class="dh-empty__t">Нет доступа к реестру договоров</div>
          <p>У вашей роли нет прав на чтение договоров, поэтому список пуст. Обратитесь к администратору.</p>
        </div>
        <footer class="dh-cmodal__foot">
          <button type="button" class="dh-btn dh-btn--ghost" id="dhCmodalCancel">Закрыть</button>
        </footer>
      </div>`;
    document.body.appendChild(wrap);
    wrap.querySelector('.dh-cmodal__x')?.addEventListener('click', () => wrap.remove());
    wrap.querySelector('#dhCmodalCancel')?.addEventListener('click', () => wrap.remove());
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
    return map[v] || 'у склада';;
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

  /**
   * D-291 (заказчик 20.10.2026): «contract_not_found не должно быть англицизмов,
   * всё на русском и понятно пользователю».
   * В базе `incomplete_reasons` — массив кодов (snake_case). Раньше словарь
   * покрывал не всё, и непокрытые коды печатались КАК ЕСТЬ прямо в карточке
   * («Дозаполните: contract_not_found»). Теперь:
   *   • все известные коды переведены;
   *   • неизвестный код НИКОГДА не показывается — «требует проверки»;
   *   • технический код уходит в title (для поддержки).
   */
  function incompleteReasonLabel(code) {
    const map = {
      no_invoice_number: 'нет номера счёта',
      no_invoice_date: 'нет даты счёта',
      no_counterparty: 'нет контрагента',
      no_contract: 'нет привязанного договора',
      contract_not_found: 'договор из счёта не найден в справочнике договоров',
      no_payment_due: 'нет срока оплаты',
      no_payment_terms: 'не указаны условия оплаты (срок или «не требуется»)',
      no_work: 'нет объекта работ',
      no_amount: 'нет суммы',
      no_vat: 'не указан НДС',
      no_scan: 'нет скана документа',
      duplicate_suspect: 'похоже на дубль — проверьте',
      needs_manual: 'требует ручной проверки'
    };
    return map[code] || 'требует проверки';
  }
  /** Есть ли среди причин непереведённые коды (для title-подсказки). */
  function incompleteReasonsText(row) {
    const reasons = Array.isArray(row.incomplete_reasons) ? row.incomplete_reasons : [];
    if (!reasons.length) return 'дозаполните обязательные поля';
    return reasons.map((r) => incompleteReasonLabel(r)).join(', ');
  }
  /** Технические коды — в подсказку, не в текст. */
  function incompleteReasonsTitle(row) {
    const reasons = Array.isArray(row.incomplete_reasons) ? row.incomplete_reasons : [];
    return reasons.length ? reasons.join(', ') : '';
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
    if (state.facetOwners && state.facetOwners.length) p.set('doc_owner_id', state.facetOwners.join(','));
    if (state.facetPms && state.facetPms.length) p.set('pm_id', state.facetPms.join(','));
    if (state.facetIncomplete || state.kpi === 'incomplete') p.set('incomplete', '1');
    if (state.kpi === 'pay') p.set('kpi', 'pay');
    if (state.kpi === 'sf') p.set('kpi', 'sf');
    if (state.kpi === 'wh') p.set('kpi', 'wh');
    if (state.kpi === 'out') p.set('dir', 'out');
    if (state.kpi === '1c') p.set('kpi', '1c');
    if (state.kpi === 'incomplete') p.set('kpi', 'incomplete');
    // V394: светофор-фильтры (единый цвет с бэком).
    if (/^tl-(red|blue|yellow|green)$/.test(state.kpi)) p.set('traffic', state.kpi.slice(3));
    if (state.quarter) p.set('quarter', String(state.quarter));
    if (state.year) p.set('year', String(state.year));
    // Заказчик 19.10.2026: сортировка была ЖЁСТКО invoice_date — «фильтра по дате
    // внесения» не было вовсе. Теперь выбирается (дата счёта / дата внесения / сумма).
    const sortMap = {
      invoice_desc: ['invoice_date', 'desc'],
      invoice_asc: ['invoice_date', 'asc'],
      created_desc: ['created_at', 'desc'],
      created_asc: ['created_at', 'asc'],
      amount_desc: ['amount_gross', 'desc'],
      amount_asc: ['amount_gross', 'asc']
    };
    const [sortField, sortDir] = sortMap[state.sort] || ['invoice_date', 'desc'];
    p.set('sort', sortField);
    p.set('order', sortDir);
    return '?' + p.toString();
  }

  async function loadFacets() {
    try {
      const f = await api('/facets?scope=' + encodeURIComponent(state.scope));
      const list = f.counterparties || f.counterparty || f.items || [];
      state.facets = {
        counterparties: Array.isArray(list)
          ? list.map((x) => (typeof x === 'string' ? x : (x.name || x.counterparty_name || ''))).filter(Boolean)
          : [],
        // Ответственные для мультивыбора: отв. за документы и РП
        doc_owners: Array.isArray(f.doc_owners) ? f.doc_owners : [],
        pms: Array.isArray(f.pms) ? f.pms : []
      };
    } catch (_) {
      state.facets = { counterparties: [], doc_owners: [], pms: [] };
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
      // План §12: признак фичефлага с бэка — UI светофора только когда включена.
      state.trafficLight = list.traffic_light === true;
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
    if (key === 'tl-red') return n(k.traffic_red) ? 'просрочка / корректировка' : 'просрочек нет';
    if (key === 'tl-blue') return n(k.traffic_blue) ? 'не заполнены поля' : 'всё заполнено';
    if (key === 'tl-yellow') return n(k.traffic_yellow) ? 'срок близко' : '—';
    if (key === 'tl-green') return n(k.traffic_green) ? 'действий не требуется' : '—';
    if (key === 'out') return n(k.out) ? 'СФ / УПД по проектам' : '—';
    if (key === 'no_1c') return n(k.no_1c) ? 'к выгрузке' : 'всё связано';
    if (key === 'incomplete') return n(k.incomplete) ? 'дозаполнить' : 'всё полное';
    return '';
  }

  function rowClass(row) {
    const cls = ['dh-tr'];
    // V394: светофор — единый цвет с бэка (row.traffic), класс строки для левого бара.
    const tr = row.traffic || '';
    if (tr) cls.push('is-traffic-' + tr);
    if (row.dir === 'out') cls.push('is-out');
    if (state.selectedId === row.id) cls.push('is-selected');
    return cls.join(' ');
  }

  /** V394: бейдж-светофор (первая колонка). aria-label — для дальтоников/скринридера. */
  function trafficPill(row) {
    const c = ['red', 'blue', 'yellow', 'green'].includes(row.traffic) ? row.traffic : 'green';
    const label = TRAFFIC_META[c] || '';
    const reason = row.traffic_reason || label;
    const corr = String(row.correction_state || '') === 'requested';
    return `<span class="dh-tl dh-tl--${c}" title="${esc(reason)}" aria-label="${esc(reason)}" role="img">`
      + `<span class="dh-tl__dot"></span>`
      + `${corr ? '<span class="dh-tl__flag">🚩</span>' : ''}</span>`;
  }

  /** V394: крупный баннер корректировки над строкой/в карточке. */
  function correctionBanner(row) {
    if (String(row.correction_state || '') !== 'requested') return '';
    const kind = row.correction_kind === 'both' ? 'СФ И АКТ'
      : row.correction_kind === 'act' ? 'АКТ' : 'СФ';
    return `<div class="dh-corr-banner" role="alert">`
      + `<span class="dh-corr-banner__t">🚩 ${kind} НЕ КОРРЕКТЕН</span>`
      + (row.correction_comment ? `<span class="dh-corr-banner__c">${esc(row.correction_comment)}</span>` : '')
      + (canCorrect() ? `<button type="button" class="dh-corr-banner__x" data-corr-clear="${row.id}">Снять</button>` : '')
      + `</div>`;
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
  /**
   * D-291 (заказчик 20.10.2026): в базе 20+ вариантов написания одного и того же
   * канала («ЭДО+оригинал», «ЭДО (СБИС)», «эдо», «Оригинал у Антона», «Нарочно»).
   * Приводим к трём каноническим значениям. Миграция V419 чистит старые данные,
   * а эта функция страхует от новых ручных вводов.
   */
  function receiveChannelCanon(ch) {
    const raw = String(ch || '').trim().toLowerCase();
    if (!raw) return '';
    if (/^(эдо|edo)(\s*\(.*\))?$/.test(raw)) return 'edo';
    // Названия операторов ЭДО без слова «ЭДО» — это тот же канал.
    if (/^(контур|сбис|sbis|диадок|ати-су|ати)$/.test(raw)) return 'edo';
    if (/^эдо\s+\S+$/.test(raw)) return 'edo';           // «ЭДО сбис», «ЭДО контур»
    if (/(эдо|edo)/.test(raw) && /(оригинал|ориг|скан)/.test(raw)) return 'edo';
    if (/^(оригинал|оринигал|нарочн)/.test(raw) || /^оригинал\b/.test(raw)) return 'original';
    if (/полис/.test(raw)) return 'original';
    if (/^(скан|scan)/.test(raw)) return 'scan';
    if (/^(---|—|-|__|нет)$/.test(raw)) return '';
    return raw; // неизвестное — покажем как есть, но помеченным
  }
  function receiveChannelLabel(ch) {
    const raw = String(ch || '').trim().toLowerCase();
    if (!raw) return '';
    const canon = receiveChannelCanon(ch);
    if (canon === 'edo') return 'ЭДО';
    if (canon === 'scan') return 'скан';
    if (canon === 'original') return 'оригинал';
    return String(ch).trim();
  }
  function receiveCell(row) {
    const label = receiveChannelLabel(row.receive_channel);
    if (!label) return '<span class="dh-muted">—</span>';
    let kind = 'muted';
    if (label === 'ЭДО') kind = 'info';
    else if (label === 'скан') kind = 'warn';
    else if (label === 'оригинал') kind = 'ok';
    // Исходный текст — в подсказку: приведённое значение не теряет данные.
    const raw = String(row.receive_channel || '').trim();
    const title = raw && raw.toLowerCase() !== label.toLowerCase() ? ` title="${esc(raw)}"` : '';
    return `<span class="dh-pill dh-pill--${kind}"${title}>${esc(label)}</span>`;
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
    // D-305: любой закрывающий документ закрывает этап — не только «СФ».
    // УПД / Акт / Чек / СЗ / ТОРГ-12 считаются такими же, и мусорные заметки
    // («нет», «запросила», ФИО вместо номера) документом НЕ считаются.
    let arr = row.closing_json;
    if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch (_) { arr = null; } }
    if (!Array.isArray(arr) || !arr.length) {
      return row.sf_received_at
        ? '<span class="dh-pill dh-pill--ok">получено</span>'
        : '<span class="dh-pill dh-pill--warn">нет СФ/УПД</span>';
    }
    const NOISE = /^(нет|не\s*т|запросила?|запрошен|в\s*процессе|ожидаем?|ждём|ждем|позже|потом|—|-|\.*)$/i;
    const real = arr.filter((it) => {
      if (it == null) return false;
      const no = String((it && (it.no || it.number)) || (typeof it === 'string' ? it : '')).trim();
      if (!no || no.length < 2) return false;
      if (NOISE.test(no)) return false;
      if (/^[А-ЯЁ][а-яё]+\s+[А-ЯЁ]\./.test(no)) return false;
      return true;
    });
    if (!real.length) return '<span class="dh-pill dh-pill--warn">нет СФ/УПД</span>';
    // Показываем первый реальный + счётчик остальных.
    const c = real[0];
    const kind = String((c && c.kind) || 'СФ');
    const no = String((c && (c.no || c.number)) || (typeof c === 'string' ? c : 'б/н'));
    const extra = real.length > 1 ? ` +${real.length - 1}` : '';
    return `<div class="dh-stack"><span class="a">${esc(kind + ': ' + no + extra)}</span><span class="b">${fmtDate(c && c.date)}</span></div>`;
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
    // V413: премиум-иконки (заказчик 19.10.2026: «системные иконки и кнопки,
    // не красиво и не премиально»). Единая сетка 18×18, stroke-width 1.7,
    // без буквенных подписей — смысл читается из иконки и tooltip.
    const S = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';
    return {
      // Оплата: карта
      pay: `<svg ${S}><rect x="2.5" y="5.5" width="19" height="13" rx="2.5"/><path d="M2.5 10h19"/><path d="M6.5 15h3"/></svg>`,
      // СФ получена: документ с галочкой
      sf: `<svg ${S}><path d="M14 3H7a1.8 1.8 0 0 0-1.8 1.8v14.4A1.8 1.8 0 0 0 7 21h10a1.8 1.8 0 0 0 1.8-1.8V7.8z"/><path d="M14 3v5h4.8"/><path d="M9 14.5l2 2 4-4.5"/></svg>`,
      // Склад: коробка
      wh: `<svg ${S}><path d="M3 8.2 12 3.5l9 4.7v7.6L12 20.5 3 15.8z"/><path d="M3 8.2 12 13l9-4.8"/><path d="M12 13v7.5"/></svg>`,
      // Открыть карточку
      open: `<svg ${S}><path d="M9 5.5h9.5V15"/><path d="M18.5 5.5 9.5 14.5"/><path d="M14 9.5H6a1.5 1.5 0 0 0-1.5 1.5v8A1.5 1.5 0 0 0 6 20.5h8A1.5 1.5 0 0 0 15.5 19v-8"/></svg>`,
      // Снять отметку СФ
      undo: `<svg ${S}><path d="M4 9h11a5 5 0 0 1 0 10h-3"/><path d="M8 5 4 9l4 4"/></svg>`,
      // Оплачено вручную
      paid: `<svg ${S}><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/></svg>`,
      // Корректировка
      corr: `<svg ${S}><path d="M12 3.5 21 20H3z"/><path d="M12 9.5v4.5"/><circle cx="12" cy="17" r=".9" fill="currentColor" stroke="none"/></svg>`,
      // D-305: удаление строки — корзина (soft-delete на бэке, восстановимо).
      del: `<svg ${S}><path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/></svg>`,
      // Комментарий
      cmt: `<svg ${S}><path d="M20.5 14.5a2 2 0 0 1-2 2H7.5L3.5 20.5V6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z"/></svg>`
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
    // PERF: рендерим только страницу (10/20/50/Все). Раньше при 500+ строках
    // в DOM строились все строки разом → блокировка главного потока на секунды.
    const allRows = state.rows;
    const paged = (window.AsgardPagination)
      ? AsgardPagination.paginate(allRows, state.page, state.pageSize)
      : allRows;
    const rows = paged;
    const parts = [];
    let prevKey = null;
    rows.forEach((r) => {
      const qinfo = quarterOf(r);
      const key = qinfo ? qinfo.key : 'none';
      if (key !== prevKey) {
        if (qinfo) {
          const isTransition = prevKey && prevKey !== 'none';
          parts.push(`<tr class="dh-qtr-sep" data-qtr="${qinfo.q}" data-year="${qinfo.y}">
            <td colspan="${state.trafficLight ? 15 : 14}"><div class="dh-qtr-sep__in ${isTransition ? 'is-next' : ''}">
              ${isTransition ? '<span class="dh-qtr-sep__arrow">↓</span>' : ''}
              <strong>${esc(quarterLabel(qinfo.q, qinfo.y))}</strong>
              <span class="dh-qtr-sep__hint">по дате документа</span>
            </div></td>
          </tr>`);
        } else {
          parts.push(`<tr class="dh-qtr-sep" data-qtr="0"><td colspan="${state.trafficLight ? 15 : 14}"><div class="dh-qtr-sep__in"><strong>Без даты документа</strong></div></td></tr>`);
        }
        prevKey = key;
      }
      parts.push(`<tr class="${rowClass(r)}" data-id="${r.id}">
        ${state.trafficLight ? `<td class="dh-col-tl">${trafficPill(r)}</td>` : ''}
        <td>${statusPill(r)}</td>
        <td><span class="dh-pill dh-pill--${r.dir === 'out' ? 'gold' : 'info'}">${r.dir === 'out' ? 'исх.' : 'вх.'}</span></td>
        <td>
          <div class="dh-stack"><span class="a dh-mono">${esc(r.invoice_number || 'б/н')}</span><span class="b">${fmtDate(r.invoice_date)}</span></div>
        </td>
        <td>
          <div class="dh-stack"><span class="a">${esc(r.counterparty_name)}</span><span class="b dh-muted">${r.inn ? ('ИНН ' + esc(r.inn)) : esc(r.counterparty_email || r.email || '—')}</span></div>
        </td>
        <td class="dh-col-work"><div class="dh-stack"><span class="a">${esc(r.work_title || 'без объекта')}</span>${r.work_number ? `<span class="b">№ ${esc(r.work_number)}</span>` : ''}</div></td>
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
            <button type="button" class="dh-qa__pay" data-qa="pay" title="В очередь оплаты (со сканом)" aria-label="В очередь оплаты" ${r.pay_status === 'paid' ? 'disabled' : ''}>${ico.pay}</button>
            <button type="button" class="dh-qa__sf" data-qa="sf" title="СФ получена" aria-label="СФ получена">${ico.sf}</button>
            ${(Array.isArray(r.closing_json) && r.closing_json.length) ? `<button type="button" data-qa="unmark_sf" title="Снять отметку «СФ получена»" aria-label="Снять отметку СФ" class="dh-qa__undo">${ico.undo}</button>` : ''}
            ${(canWh() && r.pay_status !== 'paid') ? `<button type="button" data-qa="mark_paid" title="Отметить оплачено без согласования" aria-label="Отметить оплачено" class="dh-qa__paid">${ico.paid}</button>` : ''}
            ${canWh() ? `<button type="button" data-qa="wh" title="Склад" aria-label="Склад">${ico.wh}</button>` : ''}
            ${canCorrect() ? `<button type="button" data-qa="corr" class="dh-qa__corr${r.correction_state === 'requested' ? ' is-on' : ''}" title="${r.correction_state === 'requested' ? 'Корректировка запрошена' : 'СФ/Акт не корректен'}" aria-label="Корректировка">${ico.corr}</button>` : ''}
            <button type="button" data-qa="open" title="Карточка" aria-label="Открыть карточку">${ico.open}</button>
            ${(canWh() || canCorrect()) ? `<button type="button" class="dh-qa__del" data-qa="del" title="Удалить строку (в корзину, можно восстановить)" aria-label="Удалить">${ico.del || '✕'}</button>` : ''}
            <button type="button" class="dh-cmt-btn${r.comment_text ? ' is-filled' : ''}" data-cmt="${r.id}" data-comment="${esc(r.comment_text || '')}" title="${r.comment_text ? esc(String(r.comment_text).slice(0, 60)) : 'Комментарий'}" aria-label="Комментарий">${ico.cmt}</button>
          </div>
        </td>
      </tr>`);
    });
    return `<div class="dh-table-wrap" id="dhTableWrap"><table class="dh-table dh-table--rich">
      <thead><tr>
        ${state.trafficLight ? '<th class="dh-col-tl" title="Светофор">⏱</th>' : ''}<th>Статус</th><th>Напр.</th><th>Счёт</th><th>Контрагент</th><th>Объект</th>
        <th>Договор</th><th>Получение</th><th>Назначение</th><th>Ответственные</th>
        <th>Сумма</th><th>НДС</th><th>Оплата</th><th>СФ/УПД</th><th class="dh-actions">Действия</th>
      </tr></thead>
      <tbody>${parts.join('')}</tbody>
    </table></div><div class="dh-hscroll-bar" id="dhHScrollBar" hidden><div class="dh-hscroll-bar__inner"></div></div>`
      // PERF: контролы пагинации — «Строк: 10 20 50 Все» + номера страниц.
      + (window.AsgardPagination && allRows.length > 20
          ? '<div id="dhPagination">' + AsgardPagination.renderControls(allRows.length, state.page, state.pageSize) + '</div>'
          : '');
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

  /**
   * Мультивыбор с поиском и чипами (ответственные: отв. документы / РП).
   * Возвращает HTML; логика — в bindDhMultiSelect.
   */
  function dhMultiSelectHtml({ id, options, selected, placeholder }) {
    const sel = Array.isArray(selected) ? selected.map(String) : [];
    const byId = new Map((options || []).map((o) => [String(o.value), o.label || String(o.value)]));
    const chips = sel.slice(0, 2).map((v) =>
      `<span class="dh-ms__chip">${esc(byId.get(v) || v)}<button type="button" class="dh-ms__chip-x" data-unset="${esc(v)}" aria-label="Убрать">✕</button></span>`
    ).join('');
    const more = sel.length > 2 ? `<span class="dh-ms__more">+${sel.length - 2}</span>` : '';
    return `<div class="dh-ms" id="${esc(id)}" data-ms>
      <button type="button" class="dh-ms__trigger" aria-expanded="false">
        <span class="dh-ms__chips">${sel.length ? chips + more : `<span class="dh-ms__ph">${esc(placeholder || 'Все')}</span>`}</span>
        <span class="dh-ms__caret">▾</span>
      </button>
      <div class="dh-ms__drop" hidden>
        <input type="text" class="dh-ms__search" placeholder="Поиск…" autocomplete="off"/>
        <div class="dh-ms__acts">
          <button type="button" class="dh-ms__all">Выбрать все</button>
          <button type="button" class="dh-ms__clear">Очистить</button>
        </div>
        <div class="dh-ms__list">
          ${(options || []).map((o) => `<label class="dh-ms__item" data-label="${esc(String(o.label || o.value).toLowerCase())}">
            <input type="checkbox" value="${esc(String(o.value))}" ${sel.includes(String(o.value)) ? 'checked' : ''}/>
            <span>${esc(o.label || o.value)}</span></label>`).join('') || '<div class="dh-ms__empty">Нет данных</div>'}
        </div>
      </div>
    </div>`;
  }

  /** Значение мультивыбора (массив id-строк). */
  function dhMultiSelectValue(id) {
    const host = document.getElementById(id);
    if (!host) return [];
    return [...host.querySelectorAll('.dh-ms__item input:checked')].map((i) => i.value);
  }

  /** Перерисовать чипы в триггере по текущим отметкам. */
  function dhMultiSelectSync(id, options, placeholder) {
    const host = document.getElementById(id);
    if (!host) return;
    const sel = dhMultiSelectValue(id);
    const byId = new Map((options || []).map((o) => [String(o.value), o.label || String(o.value)]));
    const box = host.querySelector('.dh-ms__chips');
    if (!box) return;
    const chips = sel.slice(0, 2).map((v) =>
      `<span class="dh-ms__chip">${esc(byId.get(v) || v)}<button type="button" class="dh-ms__chip-x" data-unset="${esc(v)}" aria-label="Убрать">✕</button></span>`
    ).join('');
    const more = sel.length > 2 ? `<span class="dh-ms__more">+${sel.length - 2}</span>` : '';
    box.innerHTML = sel.length ? chips + more : `<span class="dh-ms__ph">${esc(placeholder || 'Все')}</span>`;
  }

  /** Открытие/закрытие/поиск для всех мультивыборов внутри root. */
  function bindDhMultiSelects(root, onChange) {
    root.querySelectorAll('[data-ms]').forEach((host) => {
      const trig = host.querySelector('.dh-ms__trigger');
      const drop = host.querySelector('.dh-ms__drop');
      const search = host.querySelector('.dh-ms__search');
      const id = host.id;
      const opts = () => {
        const key = id.indexOf('Owner') >= 0 ? 'doc_owners' : 'pms';
        const raw = (state.facets && state.facets[key]) || [];
        return raw.map((u) => ({ value: u.id, label: u.name }));
      };
      trig?.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = !drop.hidden;
        document.querySelectorAll('.dh-ms__drop').forEach((d) => { d.hidden = true; });
        document.querySelectorAll('.dh-ms__trigger').forEach((t) => t.setAttribute('aria-expanded', 'false'));
        drop.hidden = open;
        trig.setAttribute('aria-expanded', open ? 'false' : 'true');
        if (!open && search) { search.value = ''; host.querySelectorAll('.dh-ms__item').forEach((i) => { i.hidden = false; }); search.focus(); }
      });
      drop?.addEventListener('click', (e) => e.stopPropagation());
      search?.addEventListener('input', () => {
        const q = search.value.trim().toLowerCase();
        host.querySelectorAll('.dh-ms__item').forEach((it) => {
          it.hidden = !!q && !String(it.getAttribute('data-label') || '').includes(q);
        });
      });
      host.querySelectorAll('.dh-ms__item input').forEach((cb) => {
        cb.addEventListener('change', () => { dhMultiSelectSync(id, opts(), 'Все'); onChange && onChange(); });
      });
      host.querySelector('.dh-ms__all')?.addEventListener('click', () => {
        host.querySelectorAll('.dh-ms__item:not([hidden]) input').forEach((cb) => { cb.checked = true; });
        dhMultiSelectSync(id, opts(), 'Все'); onChange && onChange();
      });
      host.querySelector('.dh-ms__clear')?.addEventListener('click', () => {
        host.querySelectorAll('.dh-ms__item input').forEach((cb) => { cb.checked = false; });
        dhMultiSelectSync(id, opts(), 'Все'); onChange && onChange();
      });
      host.querySelector('.dh-ms__chips')?.addEventListener('click', (e) => {
        const x = e.target.closest('.dh-ms__chip-x');
        if (!x) return;
        e.stopPropagation();
        const v = x.getAttribute('data-unset');
        const esc2 = (window.CSS && CSS.escape) ? CSS.escape(v) : String(v).replace(/"/g, '\\"');
        const cb = host.querySelector('.dh-ms__item input[value="' + esc2 + '"]');
        if (cb) cb.checked = false;
        dhMultiSelectSync(id, opts(), 'Все'); onChange && onChange();
      });
    });
    if (!bindDhMultiSelects._outside) {
      bindDhMultiSelects._outside = true;
      document.addEventListener('click', () => {
        document.querySelectorAll('.dh-ms__drop').forEach((d) => { d.hidden = true; });
        document.querySelectorAll('.dh-ms__trigger').forEach((t) => t.setAttribute('aria-expanded', 'false'));
      });
    }
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
        <label class="dh-facet dh-facet--sort">
          <span>Сортировка</span>
          <select id="dhSort">
            <option value="invoice_desc" ${state.sort === 'invoice_desc' ? 'selected' : ''}>Дата счёта ↓ (свежие сверху)</option>
            <option value="invoice_asc"  ${state.sort === 'invoice_asc' ? 'selected' : ''}>Дата счёта ↑ (свежие снизу)</option>
            <option value="created_desc" ${state.sort === 'created_desc' ? 'selected' : ''}>Дата внесения ↓ (свежие сверху)</option>
            <option value="created_asc"  ${state.sort === 'created_asc' ? 'selected' : ''}>Дата внесения ↑ (свежие снизу)</option>
            <option value="amount_desc"  ${state.sort === 'amount_desc' ? 'selected' : ''}>Сумма ↓</option>
            <option value="amount_asc"   ${state.sort === 'amount_asc' ? 'selected' : ''}>Сумма ↑</option>
          </select>
        </label>
        <div class="dh-facet">
          <span>Отв. документы</span>
          ${dhMultiSelectHtml({
            id: 'dhFacetOwners',
            options: (state.facets.doc_owners || []).map((u) => ({ value: u.id, label: u.name })),
            selected: state.facetOwners,
            placeholder: 'Все'
          })}
        </div>
        <div class="dh-facet">
          <span>Отв. за объект</span>
          ${dhMultiSelectHtml({
            id: 'dhFacetPms',
            options: (state.facets.pms || []).map((u) => ({ value: u.id, label: u.name })),
            selected: state.facetPms,
            placeholder: 'Все'
          })}
        </div>
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
              ${state.trafficLight ? `
              <button class="dh-kpi is-err ${state.kpi === 'tl-red' ? 'is-on' : ''}" type="button" data-kpi="tl-red"><div class="k">🔴 Красный</div><div class="v">${kpiVal('traffic_red')}</div><div class="s">${esc(kpiSub('tl-red'))}</div></button>
              <button class="dh-kpi is-info ${state.kpi === 'tl-blue' ? 'is-on' : ''}" type="button" data-kpi="tl-blue"><div class="k">🔵 Дозаполнить</div><div class="v">${kpiVal('traffic_blue')}</div><div class="s">${esc(kpiSub('tl-blue'))}</div></button>
              <button class="dh-kpi is-warn ${state.kpi === 'tl-yellow' ? 'is-on' : ''}" type="button" data-kpi="tl-yellow"><div class="k">🟡 Срок ≤ 5 раб. дн.</div><div class="v">${kpiVal('traffic_yellow')}</div><div class="s">${esc(kpiSub('tl-yellow'))}</div></button>
              <button class="dh-kpi is-ok ${state.kpi === 'tl-green' ? 'is-on' : ''}" type="button" data-kpi="tl-green"><div class="k">🟢 В норме</div><div class="v">${kpiVal('traffic_green')}</div><div class="s">${esc(kpiSub('tl-green'))}</div></button>` : ''}
              <button class="dh-kpi ${state.kpi === 'sf' ? 'is-on' : ''}" type="button" data-kpi="sf"><div class="k">Ждём СФ / УПД</div><div class="v">${kpiVal('sf')}</div><div class="s">${esc(kpiSub('sf'))}</div></button>
              <button class="dh-kpi is-info ${state.kpi === 'wh' ? 'is-on' : ''}" type="button" data-kpi="wh"><div class="k">У кладовщика</div><div class="v">${kpiVal('wh')}</div><div class="s">${esc(kpiSub('wh'))}</div></button>
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
                : `<button class="dh-btn dh-btn--ghost ${state.actsTab ? 'is-on' : ''}" type="button" id="dhBtnActs">Акты сверки</button>
              <button class="dh-btn dh-btn--ghost ${state.sfTab ? 'is-on' : ''}" type="button" id="dhBtnSf">Входящие СФ</button>
              <button class="dh-btn dh-btn--ghost ${state.payTab ? 'is-on' : ''}" type="button" id="dhBtnPay">График оплат</button>
              <button class="dh-btn dh-btn--ghost ${state.archiveTab ? 'is-on' : ''}" type="button" id="dhBtnArchive">Архив</button>
              <button class="dh-btn dh-btn--ghost ${isGuide ? 'is-on' : ''}" type="button" id="dhBtnGuide">${isGuide ? 'К реестру' : 'Справка'}</button>
              <button class="dh-btn dh-btn--ghost" type="button" id="dhBtnHelp" title="Подсказка">?</button>
              <button class="dh-btn dh-btn--ghost" type="button" id="dhBtnImport1c">Из 1С</button>
              <button class="dh-btn dh-btn--ghost" type="button" id="dhBtnExport1c">В 1С</button>
              <button class="dh-btn dh-btn--ghost" type="button" id="dhBtnExportXlsx" title="Выгрузить в Excel все строки по текущему фильтру">Экспорт в Excel</button>
              <button class="dh-btn dh-btn--primary" type="button" id="dhBtnNew">Внести документ</button>`}
            </div>
          </header>
          <main class="dh-main">
            ${isGuide ? renderGuideView() : (isWizard ? '<div class="dh-wizard-page" id="dhWizardHost"></div>'
              : (state.actsTab ? '<div class="dh-acts" id="dhActsHost"><div class="dh-empty">Загрузка актов сверки…</div></div>'
                : (state.sfTab ? '<div class="dh-sf" id="dhSfHost"><div class="dh-empty">Загрузка входящих СФ…</div></div>'
                : (state.payTab ? '<div class="dh-paysched" id="dhPaySchedHost"><div class="dh-empty">Загрузка графика оплат…</div></div>'
                : (state.archiveTab ? '<div class="dh-archive" id="dhArchiveHost"><div class="dh-empty">Загрузка архива…</div></div>'
                  : registryMainHtml(scopeAll))))))}
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
      // D-201/S1: кладовщик создаёт складские строки — иначе он их не увидит
      // (матрица видимости показывает WAREHOUSE только складское).
      spend_kind: role() === 'WAREHOUSE' ? 'warehouse' : 'work', // work|warehouse|office|other
      payment_due_at: '',
      sf_due_at: '',
      payment_kind: 'postpay',
      sf_basis: 'invoice',
      service_done_at: '',
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
      'payment_kind', 'sf_basis', 'service_done_at',
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
          <div class="dh-field"><label>Тип оплаты</label>
            <select name="payment_kind">
              <option value="postpay" ${(d.payment_kind || 'postpay') === 'postpay' ? 'selected' : ''}>Постоплата</option>
              <option value="prepay" ${d.payment_kind === 'prepay' ? 'selected' : ''}>Предоплата</option>
              <option value="partial" ${d.payment_kind === 'partial' ? 'selected' : ''}>Частичная (график)</option>
            </select>
          </div>
          <div class="dh-field"><label>Основание СФ</label>
            <select name="sf_basis">
              <option value="invoice" ${(d.sf_basis || 'invoice') === 'invoice' ? 'selected' : ''}>По счёту</option>
              <option value="service" ${d.sf_basis === 'service' ? 'selected' : ''}>По оказанию услуги</option>
            </select>
          </div>
        </div>
        <div class="dh-field"><label>Услуга оказана</label><input type="date" name="service_done_at" value="${esc((d.service_done_at || '').slice(0, 10))}" /></div>
        <div class="dh-grid2">
          <div class="dh-field"><label>Отв. за документы</label>
            <input type="hidden" name="doc_owner_id" id="dhWizDocOwnerId" value="${esc(d.doc_owner_id || '')}" />
            <div id="dhWizDocOwner_w" class="dh-crselect-host"></div>
          </div>
          <div class="dh-field"><label>Отв. за объект</label>
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
        <div class="dh-review-card"><div class="k">Отв. за объект</div><div class="v">${d.pm_id ? esc(String(d.pm_name || ('#' + d.pm_id))) : '—'}</div></div>
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
          renderItem: dhCounterpartyItemHtml,
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
      payment_kind: d.payment_kind || 'postpay',
      sf_basis: d.sf_basis || 'invoice',
      service_done_at: d.service_done_at || null,
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
    const labels = {
      sf: 'СФ получена',
      unmark_sf: 'Снять отметку «СФ получена»',
      wh: 'Шаг склада',
      pay: 'Отправить в очередь оплаты',
      mark_paid: 'Отметить оплачено (без согласования)'
    };
    const notes = {
      unmark_sf: 'Закрывающий документ уберётся из карточки, статус вернётся в «ждём закрывающие».',
      mark_paid: 'Ручная отметка для старых оплат: очередь согласования и скан счёта не требуются.'
    };
    const row = (state.rows || []).find((r) => String(r.id) === String(id));
    const summary = row ? docSummary(row) : ('документ #' + id);
    const body = (labels[action] || action) + ' — ' + summary + '?' + (notes[action] ? ('\n\n' + notes[action]) : '');
    const ok = await confirm('Подтвердите', body);
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
      atts = atts.concat([{ url: row.original_path_url, name: row.original_filename || null, _orig: true }]);
    }
    if (!atts.length) return '<div class="dh-empty dh-empty--sm"><div class="dh-empty__t">Нет вложений</div><p>Скан счёта или СФ можно приложить при создании документа или позже в этой карточке.</p></div>';
    /**
     * D-291 (заказчик 20.10.2026): «Почему тут Вложения …» — в блоке печатался
     * СЫРОЙ путь (`uploads/mail/2026-10-19/uuid/Счёт.pdf`) вместо имени файла.
     * Теперь: имя из URL, человеческая подпись типа, кнопки «Открыть»/«Скачать».
     */
    const fileExt = (u) => {
      const clean = String(u || '').split('?')[0];
      const m = clean.match(/\.([a-z0-9]{2,5})$/i);
      return m ? m[1].toUpperCase() : '';
    };
    const niceName = (u, given) => {
      if (given) return given;
      const clean = String(u || '').split('?')[0];
      const last = clean.split('/').pop() || '';
      try { return decodeURIComponent(last) || 'файл'; } catch (_) { return last || 'файл'; }
    };
    const isPdf = (u) => /\.pdf($|\?)/i.test(String(u || ''));
    const isImg = (u) => /\.(png|jpe?g|webp|gif)($|\?)/i.test(String(u || ''));

    return atts.map((a) => {
      const url = typeof a === 'string' ? a : (a.url || a.path || '');
      const name = niceName(url, typeof a === 'string' ? null : (a.name || a.filename));
      const ext = fileExt(url) || (typeof a === 'object' && a.kind ? String(a.kind).toUpperCase() : 'FILE');
      const kindWord = isPdf(url) ? 'PDF-документ' : (isImg(url) ? 'изображение' : 'файл');
      const openBtn = url
        ? `<a class="dh-btn dh-btn--sm" href="${esc(url)}" target="_blank" rel="noopener">Открыть</a>
           <a class="dh-btn dh-btn--sm dh-btn--ghost" href="${esc(url)}" download title="Скачать">Скачать</a>`
        : '<button class="dh-btn dh-btn--sm" type="button" disabled>Нет ссылки</button>';
      return `<div class="dh-attach">
        <div class="dh-attach__ico">${esc(ext.slice(0, 4))}</div>
        <div class="dh-attach__meta">
          <div class="a" title="${esc(name)}">${esc(name)}</div>
          <div class="b">${esc(kindWord)}</div>
        </div>
        <div class="dh-attach__acts">${openBtn}</div>
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
    // ДЕФЕКТ (заказчик 19.10.2026): `closing_json` приходит как `[]` — пустой МАССИВ,
    // а в JS `[]` truthy. Поэтому СФ помечалась «получено», хотя её нет
    // (`sf_received_at = NULL`, closing пуст). Проверяем РЕАЛЬНОЕ наличие данных.
    const closingArr = Array.isArray(row.closing_json) ? row.closing_json : [];
    const closing = closingArr.length > 0
      || !!row.sf_number
      || !!row.sf_received_at
      || row.ops_status === 'done'
      || row.ops_status === 'closed';
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

  /**
   * V394: строки графика частичной оплаты (payment_schedule) для drawer.
   * Каждый этап: процент/сумма/срок/оплачен.
   */
  function scheduleRowsHtml(row) {
    let sched = row.payment_schedule;
    if (typeof sched === 'string') { try { sched = JSON.parse(sched); } catch (_) { sched = null; } }
    if (!Array.isArray(sched) || !sched.length) sched = [{ pct: 50, amount: null, due_at: '', paid_at: null }];
    return sched.map((st, i) => `<div class="dh-stage" data-stage="${i}">
      <input type="number" class="dh-stage__pct" min="0" max="100" step="1" placeholder="%" value="${st.pct != null ? esc(String(st.pct)) : ''}" title="Процент"/>
      <input type="number" class="dh-stage__amt" min="0" step="0.01" placeholder="Сумма ₽" value="${st.amount != null ? esc(String(st.amount)) : ''}" title="Сумма"/>
      <input type="date" class="dh-stage__due" value="${esc(String(st.due_at || '').slice(0, 10))}" title="Срок"/>
      <label class="dh-stage__paid"><input type="checkbox" ${st.paid_at ? 'checked' : ''}/> оплачен</label>
      <button type="button" class="dh-stage__x" data-stage-del="${i}" aria-label="Удалить этап">✕</button>
    </div>`).join('');
  }

  /** Собрать график из DOM drawer. */
  function readSchedule(d) {
    const rows = Array.from(d.querySelectorAll('#drScheduleRows .dh-stage'));
    return rows.map((r) => {
      const paid = !!r.querySelector('.dh-stage__paid input')?.checked;
      return {
        pct: parseFloat(r.querySelector('.dh-stage__pct')?.value) || null,
        amount: parseFloat(r.querySelector('.dh-stage__amt')?.value) || null,
        due_at: r.querySelector('.dh-stage__due')?.value || null,
        paid_at: paid ? new Date().toISOString() : null
      };
    }).filter((s) => s.pct != null || s.amount != null || s.due_at);
  }

  /**
   * V394: вкладка «Акты сверки» (#/doc-hub?tab=acts).
   * Список контрагентов с оборотами за период, дедлайн, статус, баланс.
   */
  const MONTH_NAMES = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
  function periodLabel(y, q) { return q ? `${q} кв. ${y}` : `Год ${y}`; }

  async function renderActsTab() {
    const host = document.getElementById('dhActsHost');
    if (!host) return;
    const y = state.actsYear || new Date().getFullYear();
    const q = state.actsQuarter != null ? state.actsQuarter : Math.floor(new Date().getMonth() / 3) + 1;
    try {
      // Акты сверки — по контрагенту за период, а не «мои строки»: всегда scope=all
      // (сервер для привилегированных всё равно форсит период целиком).
      const data = await api(`/reconciliation?year=${y}&quarter=${q}&scope=all`);
      const items = data.items || [];
      const today = new Date().toISOString().slice(0, 10);
      const rows = items.length ? items.map((it) => {
        const bal = it.balance_rub != null ? Number(it.balance_rub) : null;
        const balCls = bal == null ? 'muted' : bal > 0 ? 'ok' : bal < 0 ? 'err' : 'muted';
        const balTxt = bal == null ? '—'
          : (bal === 0 ? 'сошлось' : (bal > 0 ? `в нашу пользу ${money(bal)}` : `мы должны ${money(Math.abs(bal))}`));
        // Статус акта + светофор: получен (зелёный) / запрошен (жёлтый) /
        // нужно запросить (серый) / просрочен (красный — дедлайн прошёл, акта нет).
        const dueYmd = it.due_at ? String(it.due_at).slice(0, 10) : null;
        const overdue = !it.received_at && dueYmd && dueYmd < today;
        const st = it.received_at
          ? '<span class="dh-pill dh-pill--ok">получен</span>'
          : overdue ? '<span class="dh-pill dh-pill--err">просрочен</span>'
            : it.status === 'requested' ? '<span class="dh-pill dh-pill--warn">запрошен</span>'
              : '<span class="dh-pill dh-pill--muted">нужно запросить</span>';
        const actsBadge = (it.adjustments_count || 0) > 0
          ? `<span class="dh-flag is-on" title="Взаимозачётов: ${it.adjustments_count}">↔ ${it.adjustments_count}</span>` : '';
        const fileBtn = it.has_file
          ? `<a class="dh-btn dh-btn--ghost dh-btn--sm" href="/api/doc-registry/reconciliation/${it.act_id}/file" target="_blank" rel="noopener" title="Файл акта от контрагента">${esc((it.file_name || 'файл').slice(0, 14))}</a>`
          : '';
        return `<tr${overdue ? ' class="is-overdue-pay"' : ''}>
          <td><div class="dh-stack"><span class="a">${esc(it.name || '—')}</span><span class="b dh-muted">ИНН ${esc(String(it.inn || '—'))} ${actsBadge}</span></div></td>
          <td>${it.docs || 0}</td>
          <td class="dh-money">${it.amount ? money(it.amount) : '—'}</td>
          <td><div class="dh-stack"><span class="a">${fmtDate(it.due_at) || '—'}</span>${overdue ? '<span class="b dh-money--err">срок прошёл</span>' : ''}</div></td>
          <td>${st}</td>
          <td class="dh-money dh-money--${balCls}">${esc(balTxt)}</td>
          <td class="dh-actions"><div class="dh-qa">
            <button type="button" data-act="detail" data-inn="${esc(String(it.inn || ''))}" data-name="${esc(it.name || '')}" title="Детали и баланс">${qaIcons().open}</button>
            ${fileBtn}
            ${it.received_at ? '' : `<button type="button" data-act="requested" data-inn="${esc(String(it.inn || ''))}" data-name="${esc(it.name || '')}" title="Запросить акт у контрагента">↗</button>`}
            <button type="button" data-act="received" data-inn="${esc(String(it.inn || ''))}" data-name="${esc(it.name || '')}" title="Отметить полученным">✓</button>
            ${canReconAct() ? `<button type="button" data-act="upload" data-inn="${esc(String(it.inn || ''))}" data-name="${esc(it.name || '')}" data-year="${y}" data-quarter="${q}" title="Загрузить файл акта от контрагента">📎</button>` : ''}
          </div></td>
        </tr>`;
      }).join('') : '<tr><td colspan="7"><div class="dh-empty dh-empty--sm"><div class="dh-empty__t">За период оборотов нет</div><p>Смените период или дождитесь оплат/оказанных услуг.</p></div></td></tr>';

      host.innerHTML = `
        <div class="dh-acts__bar">
          <div class="dh-seg" id="dhActsPeriod">
            ${[1, 2, 3, 4, 0].map((qq) => `<button type="button" class="${qq === q ? 'is-on' : ''}" data-q="${qq}">${qq ? qq + ' кв.' : 'Год'}</button>`).join('')}
          </div>
          <select id="dhActsYear" class="input" style="max-width:120px">
            ${[y - 1, y, y + 1].map((yy) => `<option ${yy === y ? 'selected' : ''}>${yy}</option>`).join('')}
          </select>
          <span class="dh-muted">Дедлайн: ${fmtDate(data.due_at) || '—'} · предварительный расчёт</span>
        </div>
        <div class="dh-card">
          <div class="dh-card__head"><h2>Акты сверки · ${esc(periodLabel(y, q))}</h2></div>
          <div class="dh-table-wrap"><table class="dh-table">
            <thead><tr><th>Контрагент</th><th>Документов</th><th>Сумма</th><th>Дедлайн</th><th>Статус</th><th>Баланс</th><th class="dh-actions">Действия</th></tr></thead>
            <tbody>${rows}</tbody>
          </table></div>
        </div>
        <div id="dhActDetail"></div>`;
      host.querySelector('#dhActsPeriod')?.addEventListener('click', (e) => {
        const b = e.target.closest('[data-q]');
        if (b) { state.actsQuarter = parseInt(b.getAttribute('data-q'), 10); renderActsTab(); }
      });
      host.querySelector('#dhActsYear')?.addEventListener('change', (e) => {
        state.actsYear = parseInt(e.target.value, 10); renderActsTab();
      });
      host.querySelectorAll('[data-act]').forEach((b) => {
        b.addEventListener('click', async () => {
          const act = b.getAttribute('data-act');
          const inn = b.getAttribute('data-inn'); const name = b.getAttribute('data-name');
          if (act === 'detail') return renderActDetail(inn, name, y, q);
          if (act === 'upload') return pickReconFile(inn, name, y, q);
          try {
            await api('/reconciliation/status', { method: 'POST', body: JSON.stringify({ inn: inn || null, name, year: y, quarter: q, status: act }) });
            toast('Акт сверки', act === 'received' ? 'Отмечен полученным' : 'Запрошен', 'ok');
            renderActsTab();
          } catch (e) { toast('Ошибка', e.message || 'не удалось', 'err'); }
        });
      });
    } catch (e) {
      host.innerHTML = `<div class="dh-empty"><div class="dh-empty__t">Не удалось загрузить</div><p>${esc(e.message || '')}</p></div>`;
    }
  }

  /** Выбор файла акта от контрагента и загрузка (multipart, whitelist на бэке). */
  function pickReconFile(inn, name, year, quarter) {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.pdf,.jpg,.jpeg,.png,.xls,.xlsx,.doc,.docx';
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.onchange = async () => {
      const f = inp.files && inp.files[0];
      inp.remove();
      if (!f) return;
      if (f.size > 20 * 1024 * 1024) { toast('Акт сверки', 'Файл больше 20 МБ', 'err'); return; }
      const fd = new FormData();
      fd.append('file', f);
      fd.append('inn', inn || '');
      fd.append('name', name || '');
      fd.append('year', String(year));
      fd.append('quarter', String(quarter));
      try {
        await api('/reconciliation/file', { method: 'POST', body: fd, json: false });
        toast('Акт сверки', 'Файл акта загружен — статус «получен»', 'ok');
        renderActsTab();
      } catch (e) { toast('Ошибка', e.message || 'не удалось загрузить', 'err'); }
    };
    inp.click();
  }

  /** Модалка добавления взаимозачёта (ручная корректировка баланса). */
  function openAdjModal(inn, name, year, quarter) {
    const host = document.getElementById('dhModal');
    if (!host) return;
    host.hidden = false;
    host.innerHTML = `
      <div class="dh-modal__card">
        <header class="dh-modal__head"><h2>Взаимозачёт · ${esc(name || ('ИНН ' + inn))}</h2>
          <button type="button" class="dh-modal__x" id="dhAdjX" aria-label="Закрыть">✕</button></header>
        <div class="dh-modal__body">
          <p class="dh-hint">Сумма со знаком: плюс — уменьшает наш долг, минус — увеличивает. Отразится в балансе акта.</p>
          <label class="dh-field"><span>Сумма, ₽</span>
            <input class="input" id="dhAdjAmt" type="number" step="0.01" placeholder="Например: -12000 или 5000"></label>
          <label class="dh-field"><span>Комментарий (обязателен)</span>
            <input class="input" id="dhAdjNote" placeholder="Например: зачёт за бой товара по акту №…"></label>
        </div>
        <footer class="dh-modal__foot">
          <button type="button" class="dh-btn dh-btn--ghost" id="dhAdjCancel">Отмена</button>
          <button type="button" class="dh-btn dh-btn--primary" id="dhAdjSave">Добавить</button>
        </footer>
      </div>`;
    const close = () => { host.hidden = true; host.innerHTML = ''; };
    host.querySelector('#dhAdjX').onclick = close;
    host.querySelector('#dhAdjCancel').onclick = close;
    host.querySelector('#dhAdjSave').onclick = async () => {
      const amount = parseFloat(host.querySelector('#dhAdjAmt').value);
      const note = host.querySelector('#dhAdjNote').value.trim();
      if (!Number.isFinite(amount) || amount === 0) { toast('Взаимозачёт', 'Укажите сумму (не 0)', 'err'); return; }
      if (!note) { toast('Взаимозачёт', 'Комментарий обязателен', 'err'); return; }
      try {
        await api('/reconciliation/adjustment', { method: 'POST', body: JSON.stringify({ inn, name, year, quarter, amount, note }) });
        toast('Взаимозачёт', 'Добавлен', 'ok');
        close();
        renderActDetail(inn, name, year, quarter);
        renderActsTab();
      } catch (e) { toast('Ошибка', e.message || 'не удалось', 'err'); }
    };
  }

  async function renderActDetail(inn, name, year, quarter) {
    const host = document.getElementById('dhActDetail');
    if (!host) return;
    host.innerHTML = '<div class="dh-empty dh-empty--sm">Загрузка…</div>';
    try {
      const d = await api(`/reconciliation/detail?inn=${encodeURIComponent(inn)}&name=${encodeURIComponent(name)}&year=${year}&quarter=${quarter}`);
      const docs = (d.docs || []).map((x) => `<tr>
        <td>${esc(x.invoice_number || 'б/н')}</td>
        <td>${fmtDate(x.invoice_date) || '—'}</td>
        <td>${fmtDate(x.service_done_at) || '—'}</td>
        <td class="dh-money">${money(x.amount)}</td>
        <td>${x.paid ? '<span class="dh-pill dh-pill--ok">оплачен</span>' : '<span class="dh-pill dh-pill--muted">не оплачен</span>'}</td>
      </tr>`).join('');
      const bal = Number(d.balanceRub) || 0;
      const adj = Array.isArray(d.adjustments) ? d.adjustments : [];
      const adjRows = adj.length ? adj.map((a, i) => `<tr>
          <td>${esc(a.note || '—')}</td>
          <td class="dh-money">${money(Number(a.amount) || 0)}</td>
          <td class="dh-muted">${fmtDate(a.at) || ''}</td>
          <td class="dh-actions">${canReconAct() ? `<button type="button" class="dh-btn dh-btn--ghost dh-btn--sm" data-adj-remove="${i}" title="Удалить взаимозачёт">✕</button>` : ''}</td>
        </tr>`).join('') : '<tr><td colspan="4" class="dh-muted">Взаимозачётов нет</td></tr>';
      const actFile = !!d.act_id;
      host.innerHTML = `
        <div class="dh-card">
          <div class="dh-card__head"><h2>${esc(name || ('ИНН ' + inn))} · ${esc(periodLabel(year, quarter))}</h2>
            <span class="dh-muted">${esc(d.note || '')}</span></div>
          <div class="dh-table-wrap"><table class="dh-table">
            <thead><tr><th>Счёт</th><th>Дата</th><th>Услуга</th><th>Сумма</th><th>Оплата</th></tr></thead>
            <tbody>${docs || '<tr><td colspan="5">Нет документов</td></tr>'}</tbody>
          </table></div>
          <div class="dh-act-balance ${bal > 0 ? 'is-pos' : bal < 0 ? 'is-neg' : ''}">
            Баланс: <strong>${bal > 0 ? ('в нашу пользу ' + money(bal)) : bal < 0 ? ('мы должны ' + money(Math.abs(bal))) : 'сошлось'}</strong>
            <span class="dh-muted">· оплаты ${money(d.paidSum)} − документы ${money(d.docsSum)}${adj.length ? ` + взаимозачёты ${money(adj.reduce((s, x) => s + (Number(x.amount) || 0), 0))}` : ''}</span>
          </div>
        </div>
        <div class="dh-card">
          <div class="dh-card__head"><h2>Взаимозачёты</h2>
            ${canReconAct() ? '<button type="button" class="dh-btn dh-btn--ghost dh-btn--sm" id="dhAdjAdd">＋ Добавить</button>' : ''}
          </div>
          <div class="dh-table-wrap"><table class="dh-table">
            <thead><tr><th>Комментарий</th><th>Сумма</th><th>Дата</th><th class="dh-actions"></th></tr></thead>
            <tbody>${adjRows}</tbody>
          </table></div>
        </div>`;
      host.querySelector('#dhAdjAdd')?.addEventListener('click', () => openAdjModal(inn, name, year, quarter));
      host.querySelectorAll('[data-adj-remove]').forEach((b) => b.addEventListener('click', async () => {
        const idx = parseInt(b.getAttribute('data-adj-remove'), 10);
        try {
          await api('/reconciliation/adjustment', { method: 'POST', body: JSON.stringify({ act_id: null, inn, name, year, quarter, remove_at: idx, amount: 1, note: 'удаление' }) });
          toast('Взаимозачёт', 'Удалён', 'ok');
          renderActDetail(inn, name, year, quarter);
          renderActsTab();
        } catch (e) { toast('Ошибка', e.message || 'не удалось', 'err'); }
      }));
    } catch (e) {
      host.innerHTML = `<div class="dh-empty"><div class="dh-empty__t">Не удалось загрузить детали</div><p>${esc(e.message || '')}</p></div>`;
    }
  }

  /**
   * Паритет с эталоном «Выплаты»: вкладка «Архив» (год/месяц + разбивка + график).
   */
  async function renderArchiveTab() {
    const host = document.getElementById('dhArchiveHost');
    if (!host) return;
    const now = new Date();
    const y = state.archYear || now.getFullYear();
    const m = state.archMonth || (now.getMonth() + 1);
    let years = [y];
    try { years = (await api(`/archive/years?scope=${encodeURIComponent(state.scope)}`)).years || [y]; } catch (_) { /* необязательно */ }
    if (!years.includes(y)) years.unshift(y);
    // D-291: у «Архива» теперь два режима — сводка по месяцам и КОРЗИНА
    // удалённых строк (заказчик спросил: «что за архив, туда попадают удалённые?»).
    const tab = state.archTab || 'summary';
    host.innerHTML = `
      <div class="dh-seg" id="dhArchSeg" style="margin-bottom:12px">
        <button type="button" class="${tab === 'summary' ? 'is-on' : ''}" data-arch-tab="summary">Сводка по месяцам</button>
        <button type="button" class="${tab === 'trash' ? 'is-on' : ''}" data-arch-tab="trash">Корзина (удалённые)</button>
      </div>
      <div id="dhArchSummary" ${tab === 'trash' ? 'hidden' : ''}>
        <div class="dh-arch__bar">
          <label>Год: <select id="dhArchYear" class="input">${years.map((yy) => `<option ${yy === y ? 'selected' : ''}>${yy}</option>`).join('')}</select></label>
          <label>Месяц: <select id="dhArchMonth" class="input">${MONTH_NAMES.map((mn, i) => `<option value="${i + 1}" ${i + 1 === m ? 'selected' : ''}>${mn}</option>`).join('')}</select></label>
        </div>
        <div class="dh-arch__chart" id="dhArchChart"><div class="dh-empty dh-empty--sm">График…</div></div>
        <div id="dhArchBody"><div class="dh-empty dh-empty--sm">Загрузка…</div></div>
      </div>
      <div id="dhTrashHost" ${tab === 'trash' ? '' : 'hidden'}></div>`;
    host.querySelectorAll('[data-arch-tab]').forEach((b) => {
      b.onclick = () => { state.archTab = b.getAttribute('data-arch-tab'); renderArchiveTab(); };
    });
    const yr = host.querySelector('#dhArchYear');
    const mo = host.querySelector('#dhArchMonth');
    if (yr) yr.onchange = (e) => { state.archYear = parseInt(e.target.value, 10); renderArchiveTab(); };
    if (mo) mo.onchange = (e) => { state.archMonth = parseInt(e.target.value, 10); renderArchiveTab(); };
    if (tab === 'trash') { await renderTrashTab(host); return; }
    await Promise.all([loadArchiveMonth(host, y, m), renderArchiveChart(host, y)]);
  }

  /**
   * D-291 (заказчик 20.10.2026): вкладка «График оплат».
   * Календарь платежей: какие счета и на какую сумму ждут оплаты по дням,
   * с KPI «просрочено / на этой неделе / в этом месяце».
   */
  async function renderPayScheduleTab() {
    const host = document.getElementById('dhPaySchedHost');
    if (!host) return;
    host.innerHTML = '<div class="dh-empty">Загрузка графика оплат…</div>';
    let d;
    // D-292: график показывает ТОЛЬКО счета, согласованные директором
    // (status='pending_payment'). Несогласованные в оплату не попадают и в
    // сумму графика не входят — их видно отдельным переключателем.
    const mode = state.payMode || 'approved';   // 'approved' | 'pending'
    const qs = mode === 'pending' ? 'approved=false' : 'approved=true&paid=1';
    try { d = await api('/payment-schedule?' + qs); } catch (e) {
      host.innerHTML = `<div class="dh-empty"><div class="dh-empty__t">Не удалось загрузить график</div><p>${esc(e.message || '')}</p></div>`;
      return;
    }
    const items = d.items || [];
    const byDay = (d.byDay || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const kpi = d.kpi || {};
    const kpiCard = (label, o, cls) => `<div class="dh-kpi ${cls || ''}"><div class="k">${label}</div><div class="v">${money(o && o.amount || 0)}</div><div class="s">${o && o.count || 0} шт.</div></div>`;

    const seg = `<div class="dh-seg" id="dhPaySeg" style="margin-bottom:12px">
      <button type="button" class="${mode === 'approved' ? 'is-on' : ''}" data-paymode="approved">Согласованные директором</button>
      <button type="button" class="${mode === 'pending' ? 'is-on' : ''}" data-paymode="pending">Ещё не согласованы</button>
    </div>`;

    if (!items.length) {
      host.innerHTML = seg + `<div class="dh-kpis">${kpiCard('Просрочено', kpi.overdue, 'is-err')}${kpiCard('На этой неделе', kpi.week, 'is-warn')}${kpiCard('В этом месяце', kpi.month, 'is-info')}</div>
        <div class="dh-empty"><div class="dh-empty__t">${mode === 'approved' ? 'Нет согласованных счетов к оплате' : 'Нет счетов, ждущих решения директора'}</div><p>${mode === 'approved' ? 'Счета появятся здесь после согласования директором.' : 'Все счета либо согласованы, либо отклонены.'}</p></div>`;
      bindPaySeg(host, mode);
      return;
    }

    const dayCell = (g) => {
      const dt = new Date(g.date + 'T00:00:00');
      const wd = Number.isNaN(dt.getTime()) ? '' : ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][dt.getDay()];
      const dd = g.date.slice(8, 10) + '.' + g.date.slice(5, 7);
      return `<button type="button" class="dh-pday${g.overdue ? ' is-overdue' : ''}" data-pday="${esc(g.date)}">
        <span class="dh-pday__wd">${wd}</span>
        <span class="dh-pday__d">${dd}</span>
        <span class="dh-pday__sum">${money(g.amount)}</span>
        <span class="dh-pday__n">${g.count} сч.</span>
      </button>`;
    };

    // Статус: у согласованных — «ждёт оплаты», у несогласованных — «у директора».
    const statusPill = (it) => {
      if (it.pay_status === 'paid') return '<span class="dh-pill dh-pill--ok">оплачен</span>';
      if (it.status === 'pending_payment') return '<span class="dh-pill dh-pill--info">ждёт оплаты</span>';
      if (it.status === 'awaiting_dir') return '<span class="dh-pill dh-pill--warn">у директора</span>';
      return `<span class="dh-pill dh-pill--muted">${esc(it.status || '—')}</span>`;
    };
    const dueCell = (it) => it.has_due
      ? fmtDate(it.due_at)
      : '<span class="dh-muted" title="Срок не указан в счёте и в реестре">без срока</span>';

    const rowsHtml = items.map((it) => `<tr>
      <td>${dueCell(it)}</td>
      <td><div class="dh-stack"><span class="a">${esc(it.counterparty_name || '—')}</span><span class="b dh-muted">${esc(it.owner_name || 'без ответственного')}</span></div></td>
      <td>${esc(it.invoice_number || 'б/н')}</td>
      <td class="dh-money">${money(it.amount)}</td>
      <td>${it.overdue ? '<span class="dh-pill dh-pill--err">просрочено</span>' : statusPill(it)}</td>
      <td class="dh-actions"><button type="button" class="dh-btn dh-btn--sm" data-popen="${it.registry_id || ''}" ${it.registry_id ? '' : 'disabled title="Нет строки реестра"'}>Открыть</button></td>
    </tr>`).join('');

    host.innerHTML = seg + `
      <div class="dh-kpis">${kpiCard('Просрочено', kpi.overdue, 'is-err')}${kpiCard('На этой неделе', kpi.week, 'is-warn')}${kpiCard('В этом месяце', kpi.month, 'is-info')}${kpiCard('Всего', kpi.total, '')}${(kpi.no_due && kpi.no_due.count) ? kpiCard('Без срока', kpi.no_due, 'is-warn') : ''}</div>
      ${byDay.length ? `<div class="dh-card"><div class="dh-card__head"><h2>Календарь платежей</h2><span>${esc(mode === 'approved' ? 'Согласованные счета' : 'Ожидают согласования')}</span></div>
        <div class="dh-pdays">${byDay.map(dayCell).join('')}</div>
      </div>` : ''}
      <div class="dh-card" style="margin-top:14px"><div class="dh-card__head"><h2>${mode === 'approved' ? 'Согласовано к оплате' : 'Ждут решения директора'}</h2><span>${items.length} шт. · ${money(kpi.total && kpi.total.amount || 0)}</span></div>
        <div class="dh-table-wrap"><table class="dh-table dh-sf__table">
          <thead><tr><th>Срок</th><th>Контрагент</th><th>Счёт</th><th>Сумма</th><th>Статус</th><th class="dh-actions">Открыть</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table></div>
      </div>`;

    bindPaySeg(host, mode);
    host.querySelectorAll('[data-popen]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = Number(b.getAttribute('data-popen'));
        if (id) openDrawer(id);
      });
    });
    host.querySelectorAll('[data-pday]').forEach((b) => {
      b.addEventListener('click', () => {
        const date = b.getAttribute('data-pday');
        host.querySelectorAll('[data-pday]').forEach((x) => x.classList.toggle('is-on', x === b));
        const rows = host.querySelectorAll('table.dh-sf__table tbody tr');
        rows.forEach((tr) => {
          const first = tr.querySelector('td');
          const hit = first && first.textContent.includes(date.slice(8, 10) + '.' + date.slice(5, 7));
          tr.style.display = hit ? '' : 'none';
        });
      });
    });
  }

  /** Переключатель «Согласованные / Ещё не согласованы» на графике. */
  function bindPaySeg(host, mode) {
    host.querySelectorAll('[data-paymode]').forEach((b) => {
      b.onclick = () => {
        state.payMode = b.getAttribute('data-paymode');
        renderPayScheduleTab();
      };
    });
  }

  /** D-291: корзина удалённых строк с восстановлением. */
  async function renderTrashTab(host) {    const box = host.querySelector('#dhTrashHost');
    if (!box) return;
    box.innerHTML = '<div class="dh-empty dh-empty--sm">Загрузка корзины…</div>';
    let d;
    try { d = await api('/trash'); } catch (e) {
      box.innerHTML = `<div class="dh-empty"><div class="dh-empty__t">Не удалось загрузить корзину</div><p>${esc(e.message || '')}</p></div>`;
      return;
    }
    const items = d.items || [];
    if (!items.length) {
      box.innerHTML = '<div class="dh-empty"><div class="dh-empty__t">Корзина пуста</div><p>Удалённые документы хранятся здесь и могут быть восстановлены.</p></div>';
      return;
    }
    box.innerHTML = `<div class="dh-card"><div class="dh-card__head"><h2>Удалённые документы</h2><span>${items.length} шт. · восстановление доступно</span></div>
      <div class="dh-table-wrap"><table class="dh-table dh-sf__table">
        <thead><tr><th>Контрагент</th><th>Счёт</th><th>Сумма</th><th>Ответственный</th><th>Удалён</th><th class="dh-actions">Восстановить</th></tr></thead>
        <tbody>${items.map((it) => `<tr>
          <td><div class="dh-stack"><span class="a">${esc(it.counterparty_name || '—')}</span><span class="b dh-muted">${it.counterparty_inn ? 'ИНН ' + esc(it.counterparty_inn) : '—'}</span></div></td>
          <td><div class="dh-stack"><span class="a">${esc(it.invoice_number || 'б/н')}</span><span class="b dh-muted">${fmtDate(it.invoice_date)}</span></div></td>
          <td class="dh-money">${money(it.amount_gross)}</td>
          <td>${esc(it.owner_name || '—')}</td>
          <td><div class="dh-stack"><span class="a">${fmtDate(it.deleted_at)}</span><span class="b dh-muted">${esc(it.deleted_by_name || '')}</span></div></td>
          <td class="dh-actions"><button type="button" class="dh-btn dh-btn--sm dh-btn--primary" data-restore="${it.id}">Восстановить</button></td>
        </tr>`).join('')}</tbody>
      </table></div></div>`;
    box.querySelectorAll('[data-restore]').forEach((b) => {
      b.addEventListener('click', async () => {
        const id = Number(b.getAttribute('data-restore'));
        b.disabled = true;
        try {
          await api(`/${id}/restore`, { method: 'POST' });
          toast('Восстановлено', 'Документ вернулся в реестр', 'ok');
          renderTrashTab(host);
        } catch (e) {
          b.disabled = false;
          toast('Ошибка', e.message || 'Не удалось восстановить', 'err');
        }
      });
    });
  }

  async function loadArchiveMonth(host, y, m) {
    const body = host.querySelector('#dhArchBody');
    try {
      const d = await api(`/archive/${y}/${m}?scope=${encodeURIComponent(state.scope)}`);
      const rows = d.rows || [];
      if (!rows.length) { body.innerHTML = '<div class="dh-empty dh-empty--sm"><div class="dh-empty__t">Нет документов за этот период</div></div>'; return; }
      const t = d.totals || {};
      const kpi = (l, v, cls) => `<div class="dh-kpi ${cls || ''}"><div class="k">${l}</div><div class="v">${v}</div></div>`;
      const kindLabel = (k) => ({ work: 'Работы', warehouse: 'Склад', office: 'Офис', other: 'Прочее' }[k] || k || '—');
      body.innerHTML = `
        <div class="dh-kpis dh-kpis--arch">
          ${kpi('Всего документов', t.cnt != null ? t.cnt : '—', 'is-info')}
          ${kpi('Сумма', money(t.amount || 0))}
          ${kpi('🔴 Красный', t.red || 0, 'is-err')}
          ${kpi('🔵 Дозаполнить', t.blue || 0, 'is-info')}
          ${kpi('🟡 Срок', t.yellow || 0, 'is-warn')}
          ${kpi('🟢 В норме', t.green || 0, 'is-ok')}
        </div>
        <div class="dh-card"><div class="dh-card__head"><h2>Разбивка · ${esc(MONTH_NAMES[m - 1])} ${y}</h2></div>
        <div class="dh-table-wrap"><table class="dh-table">
          <thead><tr><th>Вид расхода</th><th>Документов</th><th>Сумма</th><th>🔴</th><th>🔵</th><th>🟡</th><th>🟢</th></tr></thead>
          <tbody>${rows.map((r) => `<tr>
            <td>${esc(kindLabel(r.spend_kind))}</td><td>${r.cnt}</td>
            <td class="dh-money">${money(Number(r.amount) || 0)}</td>
            <td>${r.red}</td><td>${r.blue}</td><td>${r.yellow}</td><td>${r.green}</td></tr>`).join('')}</tbody>
        </table></div></div>`;
    } catch (e) {
      body.innerHTML = `<div class="dh-empty"><div class="dh-empty__t">Ошибка загрузки</div><p>${esc(e.message || '')}</p></div>`;
    }
  }

  /**
   * V394: экран «Входящие СФ» для кладовщика (can_mark_sf_received).
   * Минимум полей: контрагент, № и дата счёта, сумма, срок СФ, скан.
   * Двухшаговое подтверждение: склад отмечает получение → владелец/бух подтверждает.
   */
  async function renderSfTab() {
    const host = document.getElementById('dhSfHost');
    if (!host) return;
    host.innerHTML = `
      <div class="dh-sf__bar">
        <label class="dh-sf__chk"><input type="checkbox" id="dhSfPending" ${state.sfOnlyPending ? 'checked' : ''}> Только ждущие получения</label>
        <span class="dh-muted" id="dhSfCount"></span>
      </div>
      <div id="dhSfBody"><div class="dh-empty dh-empty--sm">Загрузка…</div></div>`;
    host.querySelector('#dhSfPending').onchange = (e) => {
      state.sfOnlyPending = !!e.target.checked;
      loadSfList(host);
    };
    await loadSfList(host);
  }

  async function loadSfList(host) {
    const body = host.querySelector('#dhSfBody');
    const cnt = host.querySelector('#dhSfCount');
    try {
      const d = await api(`/incoming-sf?scope=${encodeURIComponent(state.scope)}${state.sfOnlyPending ? '&only_pending=1' : ''}`);
      const items = d.items || [];
      if (cnt) cnt.textContent = `Всего: ${d.total != null ? d.total : items.length}`;
      if (!items.length) {
        body.innerHTML = state.sfOnlyPending
          ? '<div class="dh-empty"><div class="dh-empty__t">Ждущих получения СФ нет</div><p>Снимите галочку «Только ждущие получения», чтобы увидеть уже отмеченные.</p></div>'
          : '<div class="dh-empty"><div class="dh-empty__t">Входящих СФ нет</div><p>Появятся, когда по счёту наступит срок закрывающих (СФ/УПД).</p></div>';
        return;
      }
      const today = new Date().toISOString().slice(0, 10);
      body.innerHTML = `<div class="dh-card"><div class="dh-table-wrap"><table class="dh-table dh-sf__table">
        <thead><tr><th>Контрагент</th><th>Счёт</th><th>Сумма</th><th>Срок СФ</th><th>Статус</th><th class="dh-actions">Отметка</th></tr></thead>
        <tbody>${items.map((it) => {
          const overdue = it.sf_due_at && !it.sf_received_at && String(it.sf_due_at).slice(0, 10) < today;
          const st = it.sf_received_at
            ? '<span class="dh-pill dh-pill--ok">склад отметил</span>'
            : overdue ? '<span class="dh-pill dh-pill--err">просрочен</span>'
              : '<span class="dh-pill dh-pill--warn">ждём получения</span>';
          const scan = it.scan
            ? `<a class="dh-btn dh-btn--ghost dh-btn--sm" href="${esc(it.scan)}" target="_blank" rel="noopener">Скачать</a>`
            : '<span class="dh-muted">нет</span>';
          return `<tr>
            <td><div class="dh-stack"><span class="a">${esc(it.counterparty_name || '—')}</span><span class="b dh-muted">${esc(it.owner_name || 'без ответственного')}</span></div></td>
            <td><div class="dh-stack"><span class="a">${esc(it.invoice_number || 'б/н')}</span><span class="b dh-muted">${fmtDate(it.invoice_date)}</span></div></td>
            <td class="dh-money">${money(it.amount)}</td>
            <td>${fmtDate(it.sf_due_at)}</td>
            <td>${st}</td>
            <td class="dh-actions"><div class="dh-qa">
              ${scan}
              ${it.sf_received_at
                ? '<span class="dh-muted dh-sf__done">✔ отмечено</span>'
                : `<button type="button" class="dh-btn dh-btn--primary dh-btn--sm" data-sf="${it.id}">СФ получена</button>`}
            </div></td>
          </tr>`;
        }).join('')}</tbody>
      </table></div></div>`;
      body.querySelectorAll('[data-sf]').forEach((b) => {
        b.addEventListener('click', async () => {
          const id = Number(b.getAttribute('data-sf'));
          b.disabled = true;
          try {
            await api(`/${id}/quick`, { method: 'POST', body: JSON.stringify({ action: 'receive_sf' }) });
            toast('СФ', 'Отмечено получение. Ответственный подтвердит.', 'ok');
            await loadSfList(host);
          } catch (e) {
            b.disabled = false;
            toast('Ошибка', e.message || 'Не удалось отметить', 'err');
          }
        });
      });
    } catch (e) {
      body.innerHTML = `<div class="dh-empty"><div class="dh-empty__t">Ошибка загрузки</div><p>${esc(e.message || '')}</p></div>`;
    }
  }

  async function renderArchiveChart(host, y) {
    const box = host.querySelector('#dhArchChart');
    if (!box) return;
    box.innerHTML = `<div class="dh-chart-box">
      <div class="dh-chart-head">
        <div class="dh-chart-cap">Документы и оплачено по месяцам ${y}</div>
        <div class="dh-chart-legend">
          <span class="dh-lg"><i class="dh-lg-dot dh-lg-docs"></i>Документы</span>
          <span class="dh-lg"><i class="dh-lg-dot dh-lg-paid"></i>Оплачено</span>
        </div>
      </div>
      <canvas class="dh-canvas"></canvas></div>`;
    let docs; let paid;
    try {
      const s = (await api(`/monthly-series/${y}?scope=${encodeURIComponent(state.scope)}`)).series || [];
      docs = s.map((x) => x.docs || 0); paid = s.map((x) => x.paid || 0);
    } catch (_) { docs = new Array(12).fill(0); paid = new Array(12).fill(0); }
    drawDualChart(box.querySelector('.dh-canvas'), docs, paid, MONTH_NAMES.map((x) => x.slice(0, 3)));
  }

  /** Две линии с заливкой — зеркало графика выплат (единый стиль). */
  function drawDualChart(canvas, docsValues, paidValues, labels) {
    if (!canvas) return;
    const css = getComputedStyle(document.documentElement);
    const pick = (...names) => { for (const n of names) { const v = css.getPropertyValue(n).trim(); if (v) return v; } return 'transparent'; };
    const colDocs = pick('--blue-l', '--blue', '--info-t');
    const colPaid = pick('--ok-t', '--ok', '--green');
    const colGrid = pick('--brd');
    const colText = pick('--t3', '--t2');
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth || 640;
    const H = 220;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.height = H + 'px';
    const g = canvas.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const PAD = { top: 16, right: 16, bottom: 28, left: 56 };
    const cw = W - PAD.left - PAD.right;
    const ch = H - PAD.top - PAD.bottom;
    const maxVal = Math.max(1, ...docsValues, ...paidValues);
    const fmtShort = (v) => (v >= 1000000 ? (v / 1000000).toFixed(1) + 'М' : v >= 1000 ? Math.round(v / 1000) + 'К' : String(Math.round(v)));
    g.strokeStyle = colGrid; g.lineWidth = 1;
    const lines = 4;
    for (let i = 0; i <= lines; i++) {
      const yy = PAD.top + (ch * i) / lines;
      g.beginPath(); g.moveTo(PAD.left, yy); g.lineTo(PAD.left + cw, yy); g.stroke();
      g.fillStyle = colText; g.font = '11px system-ui'; g.textAlign = 'right';
      g.fillText(fmtShort(maxVal * (1 - i / lines)), PAD.left - 8, yy + 4);
    }
    const n = labels.length;
    const xAt = (i) => PAD.left + (n <= 1 ? cw / 2 : (cw * i) / (n - 1));
    const yAt = (v) => PAD.top + ch - (ch * (v / maxVal));
    const line = (vals, color) => {
      g.strokeStyle = color; g.lineWidth = 2; g.beginPath();
      vals.forEach((v, i) => { const x = xAt(i); const yy = yAt(v); i ? g.lineTo(x, yy) : g.moveTo(x, yy); });
      g.stroke();
      g.fillStyle = color + '22';
      g.beginPath(); g.moveTo(xAt(0), PAD.top + ch);
      vals.forEach((v, i) => g.lineTo(xAt(i), yAt(v)));
      g.lineTo(xAt(n - 1), PAD.top + ch); g.closePath(); g.fill();
    };
    line(docsValues, colDocs); line(paidValues, colPaid);
    g.fillStyle = colText; g.font = '11px system-ui'; g.textAlign = 'center';
    labels.forEach((l, i) => g.fillText(l, xAt(i), H - 8));
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
      const recvCanon = receiveChannelCanon(row.receive_channel);
      const recvVal = recvCanon === 'edo' ? 'edo' : (recvCanon === 'scan' ? 'scan' : (recvCanon === 'original' ? 'original' : ''));
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
              <h3>${trafficPill(row)} ${esc(titleNo)}</h3>
              <p>${esc(row.counterparty_name || '')} · ${esc(row.work_title || 'без объекта')}</p>
              <div class="dh-drawer__amt" data-qa="drawer-amt">${esc(grossTxt)}</div>
              ${sourceBadge(row)}
            </div>
            <button type="button" class="dh-drawer__close" id="dhDrawerClose" aria-label="Закрыть">✕</button>
          </header>
          <div class="dh-drawer__body">
            ${correctionBanner(row)}
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
              <div class="dh-section__h">Закрывающие документы</div>
              <div class="dh-section__b">
                <div id="drClosingList">${closingItems.map((cl, i) => `
                  <div class="dh-closing-row dr-closing-row" data-i="${i}">
                    <select data-k="kind" title="Тип документа">${CLOSING_KINDS.map((k) => `<option value="${esc(k)}" ${((cl.kind || 'СФ') === k) ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select>
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

            <!-- ─── Условия оплаты (V394) ─── -->
            <div class="dh-section dh-section--terms">
              <div class="dh-section__h">Условия оплаты</div>
              <div class="dh-section__b">
                <div class="dh-grid2">
                  <div class="dh-field"><label>Тип оплаты</label>
                    <select id="drPayKind">
                      <option value="postpay" ${(row.payment_kind || 'postpay') === 'postpay' ? 'selected' : ''}>Постоплата (после услуги)</option>
                      <option value="prepay" ${row.payment_kind === 'prepay' ? 'selected' : ''}>Предоплата</option>
                      <option value="partial" ${row.payment_kind === 'partial' ? 'selected' : ''}>Частичная (график)</option>
                    </select>
                  </div>
                  <div class="dh-field"><label>Основание СФ</label>
                    <select id="drSfBasis">
                      <option value="invoice" ${(row.sf_basis || 'invoice') === 'invoice' ? 'selected' : ''}>По счёту</option>
                      <option value="service" ${row.sf_basis === 'service' ? 'selected' : ''}>По оказанию услуги</option>
                    </select>
                  </div>
                  <div class="dh-field"><label>Услуга оказана</label><input type="date" id="drServiceDone" value="${esc(String(row.service_done_at || '').slice(0, 10))}"/></div>
                  <div class="dh-field"><label>Уже оплачено (без очереди)</label>
                    <label class="dh-check"><input type="checkbox" id="drNoPaymentTerms" ${row.no_payment_terms ? 'checked' : ''}/> срок оплаты не требуется</label>
                  </div>
                </div>
                <div class="dh-field" id="drScheduleWrap" ${row.payment_kind === 'partial' ? '' : 'hidden'}>
                  <label>График платежей (этапы)</label>
                  <div id="drScheduleRows">${scheduleRowsHtml(row)}</div>
                  <button type="button" class="dh-btn dh-btn--sm dh-btn--ghost" id="drAddStage">+ этап</button>
                  <p class="dh-hint">Каждый неоплаченный этап — своя контрольная точка светофора. Суммы в ₽, дата — срок.</p>
                </div>
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
            ${canWh() || canCorrect() ? `<button type="button" class="dh-btn dh-btn--danger" id="dhDrawerDelete" title="Удалить документ (переместится в корзину)">Удалить</button>` : ''}
            <button type="button" class="dh-btn dh-btn--ghost" id="dhDrawerSave">💾 Сохранить</button>
            <button type="button" class="dh-btn dh-btn--ok" id="dhParseCatalog" ${row.dir !== 'in' ? 'disabled title="Только входящие"' : ''}>В каталог</button>
            <button type="button" class="dh-btn dh-btn--ghost" id="dhDrawerExpense" ${!row.work_id ? 'disabled title="Нет объекта"' : ''}>В расходы</button>
            ${canWh() ? '<button type="button" class="dh-btn dh-btn--ghost" data-qa="wh">Склад</button>' : ''}
            ${(Array.isArray(row.closing_json) && row.closing_json.length) ? '<button type="button" class="dh-btn dh-btn--ghost" data-qa="unmark_sf" title="Убрать последний закрывающий, вернуть статус">↩ Снять СФ</button>' : ''}
            ${(canWh() && row.pay_status !== 'paid') ? '<button type="button" class="dh-btn dh-btn--ghost" data-qa="mark_paid" title="Ручная отметка для старых оплат, без очереди и скана">₽ Отметить оплачено</button>' : ''}
            <button type="button" class="dh-btn dh-btn--primary" data-qa="pay">В очередь оплаты</button>
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
            renderItem: dhCounterpartyItemHtml,
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
          <select data-k="kind" title="Тип документа">${CLOSING_KINDS.map((k) => `<option value="${esc(k)}">${esc(k)}</option>`).join('')}</select>
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
          payment_kind: d.querySelector('#drPayKind')?.value || null,
          sf_basis: d.querySelector('#drSfBasis')?.value || null,
          service_done_at: d.querySelector('#drServiceDone')?.value || null,
          no_payment_terms: !!d.querySelector('#drNoPaymentTerms')?.checked,
          payment_schedule: readSchedule(d),
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
          // D-297: обновляем только строку в таблице, а не всю страницу.
          // Раньше здесь был refresh() + openDrawer(id) — таблица перерисовывалась
          // целиком, прокрутка сбрасывалась наверх, и приходилось листать заново.
          const keep = captureScroll();
          await refreshRow(id);
          restoreScroll(keep);
          openDrawer(id);
        } catch (e) { toast('Ошибка', e.message || 'PUT failed', 'err'); }
      };

      d.querySelector('#dhDrawerClose')?.addEventListener('click', closeDrawer);
      d.querySelector('#dhDrawerClose2')?.addEventListener('click', closeDrawer);
      d.querySelector('#dhDrawerSave')?.addEventListener('click', saveDrawer);
      // D-291: удаление документа → в корзину (soft-delete на бэке, восстановимо).
      d.querySelector('#dhDrawerDelete')?.addEventListener('click', async () => {
        if (!window.confirm('Удалить документ? Он переместится в корзину (Архив → Корзина), откуда его можно восстановить.')) return;
        try {
          await api(`/${row.id}`, { method: 'DELETE' });
          toast('Удалено', 'Документ в корзине — можно восстановить', 'ok');
          closeDrawer();
          await refresh();
        } catch (e) {
          toast('Ошибка', e.message || 'Не удалось удалить', 'err');
        }
      });
      // V394: условия оплаты — переключение графика и добавление/удаление этапов.
      const payKind = d.querySelector('#drPayKind');
      const schedWrap = d.querySelector('#drScheduleWrap');
      payKind?.addEventListener('change', () => {
        if (schedWrap) schedWrap.hidden = payKind.value !== 'partial';
      });
      d.querySelector('#drAddStage')?.addEventListener('click', () => {
        const host = d.querySelector('#drScheduleRows');
        if (!host) return;
        host.insertAdjacentHTML('beforeend', scheduleRowsHtml({ payment_schedule: [{}] }));
      });
      d.querySelector('#drScheduleRows')?.addEventListener('click', (e) => {
        const del = e.target.closest('[data-stage-del]');
        if (del) del.closest('.dh-stage')?.remove();
      });
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

  /**
   * Выгрузка в Excel по текущему фильтру — сервер берёт ВСЕ совпавшие строки
   * (не только загруженную страницу) и отдаёт файл по форме реестра 2026.
   */
  async function exportXlsx() {
    const btn = document.getElementById('dhBtnExportXlsx');
    const prev = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Готовим файл…'; }
    try {
      const tok = (window.AsgardAuth && AsgardAuth.token) || localStorage.getItem('asgard_token');
      // buildQuery отдаёт '?...'; убираем limit/sort — сервер отдаёт всё по фильтру
      const qs = new URLSearchParams(buildQuery().replace(/^\?/, ''));
      qs.delete('limit');
      qs.delete('page');
      qs.delete('sort');
      const r = await fetch('/api/doc-registry/export-xlsx?' + qs.toString(), {
        headers: { Authorization: 'Bearer ' + tok }
      });
      if (!r.ok) {
        let msg = 'HTTP ' + r.status;
        try { const j = await r.json(); msg = j.error || j.message || msg; } catch (_) {}
        throw new Error(msg);
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Реестр счетов ' + new Date().toISOString().slice(0, 10) + '.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast('Экспорт', 'Файл сформирован по текущему фильтру', 'ok');
    } catch (e) {
      toast('Экспорт', e.message || 'Не удалось выгрузить', 'err');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = prev || 'Экспорт в Excel'; }
    }
  }

  /**
   * V394: модалка корректировки — бухгалтерия/директор/админ помечает СФ или акт
   * НЕ КОРРЕКТНЫМ (обязательный комментарий) либо снимает пометку.
   */
  function openCorrectionModal(id) {
    const row = (state.rows || []).find((r) => String(r.id) === String(id));
    const modal = document.getElementById('dhModal');
    if (!modal) return;
    const isReq = row && String(row.correction_state || '') === 'requested';
    const kind = (row && row.correction_kind) || 'sf';
    modal.hidden = false;
    modal.innerHTML = `<div class="dh-modal__card dh-modal__card--corr">
      <header class="dh-modal__head">
        <h2>${isReq ? 'Корректировка запрошена' : 'Что не корректно?'}</h2>
        <button type="button" class="dh-modal__x" id="dhCorrX" aria-label="Закрыть">✕</button>
      </header>
      <div class="dh-modal__body">
        <p class="dh-hint">${esc(row ? docSummary(row) : ('документ #' + id))}</p>
        ${isReq ? `<div class="dh-corr-banner" role="alert"><span class="dh-corr-banner__t">🚩 ${kind === 'both' ? 'СФ И АКТ' : (kind === 'act' ? 'АКТ' : 'СФ')} НЕ КОРРЕКТЕН</span>${row.correction_comment ? `<span class="dh-corr-banner__c">${esc(row.correction_comment)}</span>` : ''}</div>
          <p class="dh-hint">Пока пометка активна, отправка на оплату и отметка СФ заблокированы. Снимите её после исправления контрагентом.</p>`
        : `<fieldset class="dh-corr-kinds">
            <legend>Тип</legend>
            <label><input type="radio" name="dhCorrKind" value="sf" ${kind !== 'act' && kind !== 'both' ? 'checked' : ''}/> СФ не корректна</label>
            <label><input type="radio" name="dhCorrKind" value="act" ${kind === 'act' ? 'checked' : ''}/> Акт не корректен</label>
            <label><input type="radio" name="dhCorrKind" value="both" ${kind === 'both' ? 'checked' : ''}/> И СФ, и акт</label>
          </fieldset>
          <label class="dh-corr-comment"><span>Комментарий (обязательно)</span>
            <textarea id="dhCorrComment" rows="3" maxlength="2000" placeholder="Что именно неверно: номер, сумма, дата, подпись…"></textarea>
          </label>`}
      </div>
      <footer class="dh-modal__foot">
        <button type="button" class="dh-btn dh-btn--ghost" id="dhCorrCancel">Отмена</button>
        ${isReq
          ? '<button type="button" class="dh-btn dh-btn--primary" id="dhCorrClear">Снять пометку</button>'
          : '<button type="button" class="dh-btn dh-btn--danger" id="dhCorrSend">Запросить корректировку</button>'}
      </footer>
    </div>`;
    const close = () => { modal.hidden = true; modal.innerHTML = ''; };
    modal.querySelector('#dhCorrX').onclick = close;
    modal.querySelector('#dhCorrCancel').onclick = close;
    if (isReq) {
      modal.querySelector('#dhCorrClear').onclick = async () => {
        try {
          await api('/' + id + '/quick', { method: 'POST', body: JSON.stringify({ action: 'correction', clear: true }) });
          toast('Корректировка', 'Пометка снята', 'ok');
          close(); await refresh();
        } catch (e) { toast('Ошибка', e.message || 'не удалось снять', 'err'); }
      };
      return;
    }
    modal.querySelector('#dhCorrSend').onclick = async () => {
      const k = modal.querySelector('input[name="dhCorrKind"]:checked')?.value || 'sf';
      const comment = (modal.querySelector('#dhCorrComment')?.value || '').trim();
      if (!comment) { toast('Нужен комментарий', 'Опишите, что именно неверно', 'err'); return; }
      try {
        await api('/' + id + '/quick', { method: 'POST', body: JSON.stringify({ action: 'correction', kind: k, comment }) });
        toast('Корректировка', 'Запрошена у владельца', 'ok');
        close(); await refresh();
      } catch (e) { toast('Ошибка', e.message || 'не удалось запросить', 'err'); }
    };
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
      state.facetOwners = dhMultiSelectValue('dhFacetOwners');
      state.facetPms = dhMultiSelectValue('dhFacetPms');
      state.facetIncomplete = !!root.querySelector('#dhFacetIncomplete')?.checked;
      state.year = root.querySelector('#dhFacetYear')?.value || '';
      state.sort = root.querySelector('#dhSort')?.value || 'invoice_desc';
      if (state.facetIncomplete) state.kpi = 'incomplete';
      // Снятие галочки обязано вернуть фильтр: раньше state.kpi навсегда
      // оставался 'incomplete', и «Только неполные» не отключался (D-296).
      else if (state.kpi === 'incomplete') state.kpi = 'all';
      syncHash();
      await refresh();
    };
    let t = null;
    bindDhMultiSelects(root, () => { apply(); });
    root.querySelector('#dhFacetCp')?.addEventListener('change', apply);
    root.querySelector('#dhFacetCp')?.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(apply, 400);
    });
    root.querySelector('#dhFacetOps')?.addEventListener('change', apply);
    root.querySelector('#dhFacetIncomplete')?.addEventListener('change', apply);
    root.querySelector('#dhFacetYear')?.addEventListener('change', apply);
    // Сортировка реестра (дата счёта / дата внесения / сумма).
    root.querySelector('#dhSort')?.addEventListener('change', apply);
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
    root.querySelector('#dhBtnExportXlsx')?.addEventListener('click', exportXlsx);
    root.querySelector('#dhBtnImport1c')?.addEventListener('click', import1c);
    root.querySelector('#dhBtnGuide')?.addEventListener('click', async () => {
      state.actsTab = false;
      state.view = state.view === 'guide' ? 'registry' : 'guide';
      await paint(window.__docHubLayout || window.layout);
    });
    // V394: вкладка «Акты сверки».
    root.querySelector('#dhBtnActs')?.addEventListener('click', async () => {
      state.view = 'registry';
      state.archiveTab = false;
      state.sfTab = false;
      state.actsTab = !state.actsTab;
      const hash = state.actsTab ? '#/doc-hub?tab=acts' : '#/doc-hub';
      if (location.hash !== hash) { location.hash = hash; return; }
      await paint(window.__docHubLayout || window.layout);
    });
    // V394: экран «Входящие СФ» (кладовщик).
    root.querySelector('#dhBtnSf')?.addEventListener('click', async () => {
      state.view = 'registry';
      state.actsTab = false;
      state.archiveTab = false;
      state.sfTab = !state.sfTab;
      const hash = state.sfTab ? '#/doc-hub?tab=sf' : '#/doc-hub';
      if (location.hash !== hash) { location.hash = hash; return; }
      await paint(window.__docHubLayout || window.layout);
    });
    // D-291: вкладка «График оплат».
    root.querySelector('#dhBtnPay')?.addEventListener('click', async () => {
      state.view = 'registry';
      state.actsTab = false;
      state.sfTab = false;
      state.archiveTab = false;
      state.payTab = !state.payTab;
      const hash = state.payTab ? '#/doc-hub?tab=pay' : '#/doc-hub';
      if (location.hash !== hash) { location.hash = hash; return; }
      await paint(window.__docHubLayout || window.layout);
    });
    // Паритет с «Выплатами»: вкладка «Архив».
    root.querySelector('#dhBtnArchive')?.addEventListener('click', async () => {
      state.view = 'registry';
      state.actsTab = false;
      state.sfTab = false;
      state.payTab = false;
      state.archiveTab = !state.archiveTab;
      const hash = state.archiveTab ? '#/doc-hub?tab=archive' : '#/doc-hub';
      if (location.hash !== hash) { location.hash = hash; return; }
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
      // Фасеты зависят от scope (для «мои» ответственных может не быть) —
      // перерисовываем блок фильтров, иначе списки останутся пустыми.
      const f = root.querySelector('#dhFacets');
      if (f) { f.outerHTML = facetsHtml(); bindFacets(root); }
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
      const clr = e.target.closest('[data-corr-clear]');
      if (clr) {
        e.stopPropagation();
        const cid = Number(clr.getAttribute('data-corr-clear'));
        (async () => {
          try {
            await api('/' + cid + '/quick', { method: 'POST', body: JSON.stringify({ action: 'correction', clear: true }) });
            toast('Корректировка', 'Пометка снята', 'ok');
            await refresh();
          } catch (err) { toast('Ошибка', err.message || 'не удалось снять', 'err'); }
        })();
        return;
      }
      const btn = e.target.closest('[data-qa]');
      const tr = e.target.closest('tr[data-id]');
      if (!tr) return;
      const id = Number(tr.getAttribute('data-id'));
      if (btn) {
        const qa = btn.getAttribute('data-qa');
        if (qa === 'open') openDrawer(id);
        else if (qa === 'corr') openCorrectionModal(id);
        else if (qa === 'del') {
          // D-305: удаление строки прямо из таблицы (заказчик: «а где кнопка
          // удалить строку?»). Soft-delete на бэке → строка уходит в корзину
          // (Архив → Корзина), откуда её можно восстановить.
          if (!window.confirm('Удалить строку? Она переместится в корзину (Архив → Корзина), откуда её можно восстановить.')) return;
          btn.disabled = true;
          api(`/${id}`, { method: 'DELETE' })
            .then(() => { toast('Удалено', 'Строка в корзине — можно восстановить', 'ok'); refresh(); })
            .catch((err) => { btn.disabled = false; toast('Ошибка', err.message || 'Не удалось удалить', 'err'); });
        } else quick(id, qa);
        return;
      }
      openDrawer(id);
    });
    if (!window.__dhEscBound) {
      window.__dhEscBound = true;
      document.addEventListener('keydown', (e) => {
        const d = document.getElementById('dhDrawer');
        const open = d && !d.hidden;
        if (e.key === 'Escape' && open) { closeDrawer(); return; }
        // U7: фокус-трап — Tab внутри открытого drawer не уходит в фон.
        if (e.key === 'Tab' && open) {
          const nodes = Array.from(d.querySelectorAll(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )).filter((el) => el.offsetParent !== null);
          if (!nodes.length) return;
          const first = nodes[0];
          const last = nodes[nodes.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      });
    }
  }

  function updateKpiDom() {
    const kpis = document.getElementById('dhKpis');
    if (!kpis) return;
    const map = {
      all: 'all', pay: 'pay', sf: 'sf', wh: 'wh', out: 'out', '1c': 'no_1c', incomplete: 'incomplete',
      'tl-red': 'traffic_red', 'tl-blue': 'traffic_blue', 'tl-yellow': 'traffic_yellow', 'tl-green': 'traffic_green'
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
      // PERF: показываем диапазон видимой страницы, а не только общее число.
      const total = state.total || state.rows.length;
      const ps = state.pageSize;
      let shown = `${state.rows.length} из ${total}`;
      if (window.AsgardPagination && ps > 0 && state.rows.length > ps) {
        const from = (state.page - 1) * ps + 1;
        const to = Math.min(state.rows.length, state.page * ps);
        shown = `${from}–${to} из ${total}`;
      }
      meta.textContent = `показано ${shown}${state.scope === 'all' ? ' · все строки' : ' · только мои'}`;
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

  /**
   * D-297: перерисовка таблицы не должна «прыгать» наверх.
   * `host.innerHTML = ...` уничтожает DOM, поэтому браузер теряет позицию
   * прокрутки — приходилось листать вниз заново после каждой правки даты.
   * Снимаем scrollTop/scrollLeft у всех прокручиваемых контейнеров и
   * возвращаем их после перерисовки.
   */
  function captureScroll() {
    const snap = [];
    // В этом приложении прокрутка живёт во внутренних контейнерах (body overflow:hidden),
    // главный — #layout. Поэтому перебираем все реально прокручиваемые узлы, а не только document.
    const preferred = [
      document.getElementById('layout'),
      document.getElementById('dhTableHost'),
      document.querySelector('.main'),
      document.querySelector('.main-content'),
      document.querySelector('.dh-tablewrap'),
      document.scrollingElement,
    ];
    const extra = [...document.querySelectorAll('#layout .dh-tablewrap, #layout .dh-scroll, .dh-main')];
    const seen = new Set();
    for (const el of preferred.concat(extra)) {
      if (!el || seen.has(el) || typeof el.scrollTop !== 'number') continue;
      seen.add(el);
      if (el.scrollTop || el.scrollLeft) snap.push([el, el.scrollTop, el.scrollLeft]);
    }
    return snap;
  }

  function restoreScroll(snap) {
    if (!snap || !snap.length) return;
    const apply = () => {
      for (const [el, top, left] of snap) {
        if (!el || !el.isConnected) continue;
        try { el.scrollTop = top; el.scrollLeft = left; } catch (_) { /* элемент мог исчезнуть */ }
      }
    };
    apply();
    // Повтор в следующем кадре: контент досчитывает высоту после вставки.
    requestAnimationFrame(apply);
  }

  /**
   * D-297: точечное обновление одной строки таблицы после сохранения карточки.
   * Полный refresh() пересоздаёт всю таблицу и сбрасывает прокрутку — здесь
   * перерисовывается только строка с нужным id, позиция списка сохраняется.
   */
  async function refreshRow(id) {
    const host = document.getElementById('dhTableHost');
    if (!host) { await refresh(); return; }

    // Подтягиваем актуальные данные строки, не трогая остальную таблицу.
    let fresh = null;
    try { fresh = await api('/' + id); } catch (_) { fresh = null; }
    if (fresh) {
      const item = (fresh.row || fresh.document || fresh);
      const idx = state.rows.findIndex((r) => Number(r.id) === Number(id));
      if (idx >= 0) state.rows[idx] = Object.assign({}, state.rows[idx], item);
    }

    // Находим существующий <tr> и заменяем его HTML.
    const tr = host.querySelector(`tr[data-id="${id}"]`);
    if (!tr) { await refresh(); return; }

    const tpl = document.createElement('tbody');
    tpl.innerHTML = renderTable();
    const newTr = tpl.querySelector(`tr[data-id="${id}"]`);
    if (!newTr) { await refresh(); return; }

    tr.replaceWith(newTr);
    bindQuarterLive();
    bindHScroll();
  }

  async function refresh() {
    if (state.view === 'guide' || state.view === 'wizard') return;
    const host = document.getElementById('dhTableHost');
    if (!host) return;
    await loadData();
    // PERF: не сбрасываем страницу при перерисовке; клампим к доступному диапазону.
    if (window.AsgardPagination && state.pageSize > 0) {
      const maxPage = Math.max(1, Math.ceil(state.rows.length / state.pageSize));
      if (state.page > maxPage) state.page = maxPage;
    }
    const keepScroll = captureScroll();
    host.innerHTML = renderTable();
    bindQuarterLive();
    bindHScroll();
    restoreScroll(keepScroll);
    // PERF: переключение страницы/размера без полного refresh() — только перерисовка таблицы.
    if (window.AsgardPagination) {
      AsgardPagination.attachHandlers('dhPagination',
        (p) => { state.page = p; if (host) { host.innerHTML = renderTable(); bindQuarterLive(); bindHScroll(); } },
        (s) => { state.pageSize = s; state.page = 1; if (host) { host.innerHTML = renderTable(); bindQuarterLive(); bindHScroll(); } }
      );
    }
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
    if (state.view === 'registry' && !state.actsTab && !state.archiveTab && !state.sfTab) {
      bindQuarterLive();
      bindHScroll();
    }
    if (state.actsTab) {
      await renderActsTab();
    }
    if (state.sfTab) {
      await renderSfTab();
    }
    if (state.payTab) {
      await renderPayScheduleTab();
    }
    if (state.archiveTab) {
      await renderArchiveTab();
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
    state.trafficLight = true;   // до ответа API считаем включённым (не мигаем)
    // Вкладки сбрасываем: единственный источник истины — hash (иначе залипнут).
    state.actsTab = false;
    state.archiveTab = false;
    state.sfTab = false;
    state.payTab = false;
    readHashFilters(); // scope/quarter/year from #/doc-hub?...
    // V394: вкладка актов сверки по #/doc-hub?tab=acts
    try {
      const tab = (new URLSearchParams((location.hash.split('?')[1] || ''))).get('tab');
      if (tab === 'acts') state.actsTab = true;
      if (tab === 'archive') state.archiveTab = true;
      if (tab === 'sf') state.sfTab = true;
      if (tab === 'pay') state.payTab = true;
    } catch (_) { /* ignore */ }
    // Кладовщик живёт на экране «Входящие СФ» — это его рабочий стол (канонический доступ).
    if (user.role === 'WAREHOUSE' && !state.actsTab && !state.archiveTab && !state.sfTab && !state.payTab) {
      state.sfTab = true;
    }
    await paint(layoutFn || window.layout);
    try {
      const q = new URLSearchParams((location.hash.split('?')[1] || ''));
      const id = Number(q.get('id'));
      if (id) openDrawer(id);
    } catch (_) { /* ignore */ }
  }

  return { render, openDrawer };
})();
