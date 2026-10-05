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
  const VAT_RATE = 0.22;
  const OPS_OPTIONS = [
    ['', 'Все статусы'],
    ['draft', 'Черновик'],
    ['wait_pay', 'Ждём оплату'],
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
  async function confirm(title, body) {
    if (window.AsgardConfirm && typeof AsgardConfirm.open === 'function') {
      return !!(await AsgardConfirm.open({ title, body }));
    }
    return window.confirm(String(body || title));
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
    if (row.ops_status === 'wait_pay') return 'Ждём оплату';
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
      no_contract: 'нет договора',
      no_payment_due: 'нет срока оплаты',
      no_work: 'нет объекта / назначения'
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
    const vat = row.vat_amount != null ? money(row.vat_amount) : '';
    return `<div class="dh-stack"><span class="dh-pill dh-pill--ok">с НДС</span>${vat ? `<span class="b">${vat}</span>` : ''}</div>`;
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
            <td colspan="10"><div class="dh-qtr-sep__in ${isTransition ? 'is-next' : ''}">
              ${isTransition ? '<span class="dh-qtr-sep__arrow">↓</span>' : ''}
              <strong>${esc(quarterLabel(qinfo.q, qinfo.y))}</strong>
              <span class="dh-qtr-sep__hint">по дате документа</span>
            </div></td>
          </tr>`);
        } else {
          parts.push(`<tr class="dh-qtr-sep" data-qtr="0"><td colspan="10"><div class="dh-qtr-sep__in"><strong>Без даты документа</strong></div></td></tr>`);
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
          </div>
        </td>
      </tr>`);
    });
    return `<div class="dh-table-wrap"><table class="dh-table dh-table--rich">
      <thead><tr>
        <th>Статус</th><th>Напр.</th><th>Счёт</th><th>Контрагент</th><th>Объект</th><th>Сумма</th><th>НДС</th><th>Оплата</th><th>СФ/УПД</th><th class="dh-actions">Действия</th>
      </tr></thead>
      <tbody>${parts.join('')}</tbody>
    </table></div>`;
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
      <link rel="stylesheet" href="assets/css/doc-hub.css?v=20.28.84" />
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
        <div class="dh-drawer" id="dhDrawer" hidden></div>
        <div class="dh-modal" id="dhModal" hidden></div>
      </div>`;
  }

  function emptyWizDraft() {
    return {
      dir: 'in',
      doc_kinds: ['invoice'],
      invoice_number: '',
      invoice_date: new Date().toISOString().slice(0, 10),
      counterparty_name: '',
      amount_gross: '',
      amount_net: '',
      has_vat: '1',
      contract_mode: 'none',
      payment_due_at: '',
      sf_due_at: '',
      work_id: '',
      comment_text: '',
      purpose_customer: true,
      purpose_asgard: false,
      purpose_consumables: false,
      parsed_json: '',
      file: null
    };
  }

  function readWizStepFields(form) {
    if (!form || !state.wizDraft) return;
    const fd = new FormData(form);
    const d = state.wizDraft;
    for (const k of ['dir', 'invoice_number', 'invoice_date', 'counterparty_name', 'amount_gross', 'amount_net', 'has_vat',
      'contract_mode', 'payment_due_at', 'sf_due_at', 'work_id', 'comment_text', 'parsed_json']) {
      if (fd.has(k)) d[k] = String(fd.get(k) ?? '');
    }
    d.doc_kinds = [...form.querySelectorAll('input[name="doc_kind"]:checked')].map((el) => el.value);
    if (!d.doc_kinds.length) d.doc_kinds = ['invoice'];
    d.purpose_customer = !!form.querySelector('input[name="purpose_customer"]')?.checked;
    d.purpose_asgard = !!form.querySelector('input[name="purpose_asgard"]')?.checked;
    d.purpose_consumables = !!form.querySelector('input[name="purpose_consumables"]')?.checked;
    const fileInput = form.querySelector('input[name="attachment"]');
    if (fileInput && fileInput.files && fileInput.files[0]) d.file = fileInput.files[0];
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
      const g0 = parseFloat(d.amount_gross) || 0;
      const n0 = parseFloat(d.amount_net) || (g0 ? +(g0 / (1 + VAT_RATE)).toFixed(2) : 0);
      const v0 = g0 ? +(g0 - n0).toFixed(2) : 0;
      return steps + `
        <div class="dh-coach"><div class="dh-coach__ico">2</div><div class="dh-coach__body"><strong>Суммы</strong><p>Введите сумму с НДС или без — вторая и сам НДС посчитаются. Ставка по умолчанию 22%.</p></div></div>
        <div class="dh-sum-strip" id="dhWizSumStrip" aria-live="polite">
          <div><span class="k">С НДС</span><span class="v" id="dhWizStripGross">${moneyFine(g0 || 2200)}</span></div>
          <div><span class="k">Без НДС</span><span class="v" id="dhWizStripNet">${moneyFine(n0 || 1803.28)}</span></div>
          <div><span class="k">НДС 22%</span><span class="v" id="dhWizStripVat">${moneyFine(v0 || 396.72)}</span></div>
        </div>
        <div class="dh-dup" id="dhWizDup" hidden>
          <strong>Похожий расход уже есть на объекте</strong>
          <p>РП мог внести этот счёт в расходы. Связать с существующей записью или оставить только в реестре?</p>
          <div class="dh-gap-row">
            <button class="dh-btn dh-btn--sm" type="button" id="dhWizDupLink">Связать с расходом</button>
            <button class="dh-btn dh-btn--sm dh-btn--ghost" type="button" id="dhWizDupSkip">Это другой документ</button>
          </div>
        </div>
        <div class="dh-grid2">
          <div class="dh-field"><label>№ счёта *</label><input name="invoice_number" required value="${esc(d.invoice_number)}" placeholder="например ФР-2019" /></div>
          <div class="dh-field"><label>Дата счёта *</label><input type="text" name="invoice_date" required pattern="\\d{4}-\\d{2}-\\d{2}" placeholder="2026-09-14" value="${esc(d.invoice_date)}" /><div class="dh-help">формат ГГГГ-ММ-ДД</div></div>
        </div>
        <div class="dh-field"><label>Контрагент *</label><input name="counterparty_name" required list="dhCpListWiz" value="${esc(d.counterparty_name)}" placeholder="Начните вводить название или ИНН" />
          <datalist id="dhCpListWiz">${(state.facets.counterparties || []).map((c) => `<option value="${esc(c)}"></option>`).join('')}</datalist>
        </div>
        <div class="dh-vat-box">
          <div class="dh-field"><label>Сумма с НДС</label><input name="amount_gross" type="number" step="0.01" min="0" required value="${esc(d.amount_gross)}" placeholder="0.00" id="dhWizGross" /><div class="dh-help">меняете — пересчитаем без НДС</div></div>
          <div class="dh-field"><label>Сумма без НДС</label><input name="amount_net" type="number" step="0.01" min="0" value="${esc(d.amount_net)}" placeholder="0.00" id="dhWizNet" /><div class="dh-help">или вводите сюда</div></div>
          <div class="dh-field"><label>НДС 22%</label>
            <div class="dh-vat-box__big" id="dhWizVatAmt">—</div>
            <div class="dh-help"><label class="dh-check dh-check--bare"><input type="checkbox" id="dhWizHasVatChk" ${d.has_vat === '1' ? 'checked' : ''}/> с НДС</label></div>
            <input type="hidden" name="has_vat" id="dhWizHasVat" value="${esc(d.has_vat)}" />
          </div>
        </div>`;
    }
    if (step === 3) {
      return steps + `
        <div class="dh-coach"><div class="dh-coach__ico">3</div><div class="dh-coach__body"><strong>Объект и договор</strong><p>Без договора сохранение возможно, но строка попадёт в «Неполные» и придёт уведомление.</p></div></div>
        <input type="hidden" name="contract_mode" id="dhWizContract" value="${esc(d.contract_mode || 'none')}" />
        <div class="dh-mode-cards" id="dhModeCards">
          ${[['linked','Привязать договор','Из реестра договоров'],['once','Разовая','Без договора'],['general','Общий / заявка','Рамочный'],['none','Без договора','Не указан / позже']].map(([v,t,s]) =>
            `<button type="button" class="dh-mode-card ${d.contract_mode === v ? 'is-on' : ''}" data-mode="${v}"><div class="t">${t}</div><div class="s">${s}</div></button>`
          ).join('')}
        </div>
        <div class="dh-checkrow">
          <label class="dh-check"><input type="checkbox" name="purpose_customer" ${d.purpose_customer ? 'checked' : ''}/> На объект заказчика</label>
          <label class="dh-check"><input type="checkbox" name="purpose_asgard" ${d.purpose_asgard ? 'checked' : ''}/> Собственность АСГАРД</label>
          <label class="dh-check"><input type="checkbox" name="purpose_consumables" ${d.purpose_consumables ? 'checked' : ''}/> Расходники</label>
        </div>
        <div class="dh-grid2">
          <div class="dh-field"><label>Срок оплаты</label><input type="text" name="payment_due_at" pattern="\\d{4}-\\d{2}-\\d{2}" placeholder="2026-09-30" value="${esc(d.payment_due_at)}" /><div class="dh-help">ГГГГ-ММ-ДД</div></div>
          <div class="dh-field"><label>Срок ожидания СФ</label><input type="text" name="sf_due_at" pattern="\\d{4}-\\d{2}-\\d{2}" placeholder="2026-10-15" value="${esc(d.sf_due_at)}" /><div class="dh-help">ГГГГ-ММ-ДД</div></div>
        </div>
        <div class="dh-field"><label>Работа / объект (ID в CRM)</label><input name="work_id" type="number" min="1" step="1" placeholder="оставьте пустым, если объекта ещё нет" value="${esc(d.work_id)}" /><div class="dh-help">необязательно — можно дозаполнить позже</div></div>`;
    }
    const hasVat = d.has_vat === '1';
    const gross = parseFloat(d.amount_gross) || 0;
    const net = hasVat ? +(gross / (1 + VAT_RATE)).toFixed(2) : gross;
    const vat = hasVat ? +(gross - net).toFixed(2) : 0;
    return steps + `
      <div class="dh-coach"><div class="dh-coach__ico">4</div><div class="dh-coach__body"><strong>Сканы и проверка</strong><p>Прикрепите скан и сверьте суммы. Для входящих добавьте позиции каталога — по строкам с названием, ценой и количеством.</p></div></div>
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
        <div class="dh-review-card"><div class="k">Счёт</div><div class="v">${esc(d.invoice_number)} · ${fmtDate(d.invoice_date)}</div></div>
        <div class="dh-review-card"><div class="k">Контрагент</div><div class="v">${esc(d.counterparty_name)}</div></div>
        <div class="dh-review-card"><div class="k">Сумма</div><div class="v dh-money">${money(gross)}</div><div class="s">${hasVat ? 'НДС ' + money(vat) + ' · нетто ' + money(net) : 'без НДС'}</div></div>
        <div class="dh-review-card"><div class="k">Договор</div><div class="v">${esc(contractModeLabel(d.contract_mode))}</div></div>
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
            <p class="dh-modal__sub">Пошагово · авто-НДС 22% · проверка похожих расходов</p>
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
        if (!form.reportValidity()) return;
        readWizStepFields(form);
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
    form.querySelectorAll('#dhDirCards [data-dir]').forEach((btn) => {
      btn.onclick = () => {
        const v = btn.getAttribute('data-dir');
        const hid = form.querySelector('#dhWizDir, input[name="dir"]');
        if (hid) hid.value = v;
        form.querySelectorAll('#dhDirCards .dh-dir-card').forEach((b) => b.classList.toggle('is-on', b === btn));
      };
    });
    form.querySelectorAll('#dhTypeCards [data-kind]').forEach((btn) => {
      btn.onclick = () => {
        const v = btn.getAttribute('data-kind');
        const cb = form.querySelector('input[name="doc_kind"][value="' + v + '"]');
        if (!cb) return;
        cb.checked = !cb.checked;
        btn.classList.toggle('is-on', cb.checked);
        const any = form.querySelector('input[name="doc_kind"]:checked');
        if (!any) {
          cb.checked = true;
          btn.classList.add('is-on');
        }
      };
    });
    form.querySelectorAll('#dhModeCards [data-mode]').forEach((btn) => {
      btn.onclick = () => {
        const v = btn.getAttribute('data-mode');
        const hid = form.querySelector('#dhWizContract, input[name="contract_mode"]');
        if (hid) hid.value = v;
        form.querySelectorAll('#dhModeCards .dh-mode-card').forEach((b) => b.classList.toggle('is-on', b === btn));
      };
    });
    const add = form.querySelector('#dhWizAddLine');
    if (add) {
      let initial = [];
      try {
        const raw = (state.wizDraft && state.wizDraft.parsed_json) || '';
        if (raw) initial = JSON.parse(raw);
      } catch (_) { initial = []; }
      if (Array.isArray(initial) && initial.length) initial.forEach((x) => addWizLine(form, x));
      else {
        addWizLine(form, { name: '', unit_price: '', quantity: 1, unit: 'шт' });
        addWizLine(form, { name: '', unit_price: '', quantity: 1, unit: 'шт' });
      }
      add.onclick = () => addWizLine(form);
    }
    const grossEl = form.querySelector('#dhWizGross');
    const netEl = form.querySelector('#dhWizNet');
    const vatAmt = form.querySelector('#dhWizVatAmt');
    const hasChk = form.querySelector('#dhWizHasVatChk');
    const hasHid = form.querySelector('#dhWizHasVat');
    const dup = form.querySelector('#dhWizDup');
    let lock = false;
    const paintVat = (from) => {
      if (!grossEl || lock) return;
      lock = true;
      const on = hasChk ? !!hasChk.checked : (hasHid && hasHid.value === '1');
      if (hasHid) hasHid.value = on ? '1' : '0';
      if (from === 'net' && netEl) {
        const n = parseFloat(netEl.value) || 0;
        if (on) {
          const g = Math.round(n * (1 + VAT_RATE) * 100) / 100;
          const v = Math.round((g - n) * 100) / 100;
          grossEl.value = String(g);
          if (vatAmt) vatAmt.textContent = moneyFine(v);
        } else {
          grossEl.value = String(n);
          if (vatAmt) vatAmt.textContent = moneyFine(0);
        }
      } else {
        const g = parseFloat(grossEl.value) || 0;
        if (on) {
          const n = Math.round((g / (1 + VAT_RATE)) * 100) / 100;
          const v = Math.round((g - n) * 100) / 100;
          if (netEl) netEl.value = String(n);
          if (vatAmt) vatAmt.textContent = moneyFine(v);
        } else {
          if (netEl) netEl.value = String(g);
          if (vatAmt) vatAmt.textContent = moneyFine(0);
        }
        if (dup) {
          const g2 = parseFloat(grossEl.value) || 0;
          dup.hidden = !(g2 === 2200 || g2 === 500 || g2 === 1000);
        }
      }
      const sg = form.querySelector('#dhWizStripGross');
      const sn = form.querySelector('#dhWizStripNet');
      const sv = form.querySelector('#dhWizStripVat');
      if (sg) sg.textContent = moneyFine(parseFloat(grossEl.value) || 0);
      if (sn) sn.textContent = moneyFine(parseFloat(netEl && netEl.value) || 0);
      if (sv) sv.textContent = (vatAmt && vatAmt.textContent) || moneyFine(0);
      lock = false;
    };
    if (grossEl) grossEl.addEventListener('input', () => paintVat('gross'));
    if (netEl) netEl.addEventListener('input', () => paintVat('net'));
    if (hasChk) hasChk.addEventListener('change', () => paintVat('gross'));
    paintVat('gross');
    const dupLink = form.querySelector('#dhWizDupLink');
    const dupSkip = form.querySelector('#dhWizDupSkip');
    if (dupLink) dupLink.onclick = () => { if (dup) dup.hidden = true; toast('Связь', 'После сохранения проверьте расходы объекта', 'ok'); };
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
    const hasVat = d.has_vat === '1';
    const gross = parseFloat(d.amount_gross) || 0;
    const body = {
      dir: d.dir,
      invoice_number: d.invoice_number,
      invoice_date: d.invoice_date,
      counterparty_name: d.counterparty_name,
      amount_gross: gross,
      has_vat: hasVat,
      vat_rate: VAT_RATE,
      payment_due_at: d.payment_due_at || null,
      sf_due_at: d.sf_due_at || null,
      contract_mode: d.contract_mode || 'none',
      comment_text: d.comment_text || '',
      parsed_json: parsed,
      ops_status: 'draft'
    };
    if (d.work_id) body.work_id = parseInt(d.work_id, 10);
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
    const ok = await confirm('Подтвердите', (labels[action] || action) + ' для #' + id + '?');
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

  function editIncompleteHtml(row) {
    if (!row.is_incomplete) return '';
    return `
      <div class="dh-section" id="dhEditIncomplete">
        <div class="dh-section__h">Дозаполнить</div>
        <div class="dh-section__b">
          <div class="dh-field"><label>Режим договора</label>
            <select id="dhEditContract">
              <option value="none" ${row.contract_mode === 'none' ? 'selected' : ''}>Без договора</option>
              <option value="linked" ${row.contract_mode === 'linked' ? 'selected' : ''}>Привязан</option>
              <option value="once" ${row.contract_mode === 'once' ? 'selected' : ''}>Разовая поставка</option>
              <option value="general" ${row.contract_mode === 'general' ? 'selected' : ''}>Общий / заявка</option>
              <option value="created" ${row.contract_mode === 'created' ? 'selected' : ''}>Создать позже</option>
            </select>
          </div>
          <div class="dh-grid2">
            <div class="dh-field"><label>Срок оплаты</label><input type="text" id="dhEditPayDue" pattern="\\d{4}-\\d{2}-\\d{2}" placeholder="ГГГГ-ММ-ДД" value="${esc(String(row.payment_due_at || '').slice(0, 10))}" /></div>
            <div class="dh-field"><label>Срок СФ</label><input type="text" id="dhEditSfDue" pattern="\\d{4}-\\d{2}-\\d{2}" placeholder="ГГГГ-ММ-ДД" value="${esc(String(row.sf_due_at || '').slice(0, 10))}" /></div>
          </div>
          <div class="dh-field"><label>ID работы в CRM</label><input type="number" id="dhEditWorkId" value="${row.work_id || ''}" placeholder="необязательно" /></div>
          <button type="button" class="dh-btn dh-btn--primary dh-btn--sm" id="dhEditSave">Сохранить поля</button>
        </div>
      </div>`;
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
    let net = row.amount_net != null ? Number(row.amount_net) : NaN;
    let vat = row.vat_amount != null ? Number(row.vat_amount) : NaN;
    if (!Number.isFinite(net)) net = hasVat ? +(gross / (1 + VAT_RATE)).toFixed(2) : gross;
    if (!Number.isFinite(vat)) vat = hasVat ? +(gross - net).toFixed(2) : 0;
    return { gross, net, vat, hasVat };
  }

  async function openDrawer(id) {
    try {
      const row = await api('/' + id);
      state.selectedId = id;
      const d = document.getElementById('dhDrawer');
      if (!d) return;
      d.hidden = false;
      d.classList.add('is-on');
      const payLink = row.payment_invoice_id
        ? `<p class="dh-pay-link"><a href="#/approval-payment?id=${row.payment_invoice_id}">Очередь оплаты #${row.payment_invoice_id}</a></p>`
        : '';
      const sums = sumParts(row);
      const titleNo = row.invoice_number ? ('Счёт ' + row.invoice_number) : ('#' + row.id);
      const srcLine = row.excel_source || row.import_source || row.source_label || row.external_ref
        || (row.comment_text && /excel|реестр/i.test(row.comment_text) ? row.comment_text : null)
        || 'реестр';
      const grossTxt = money(sums.gross);
      const netTxt = moneyFine(sums.net);
      const vatTxt = moneyFine(sums.vat);
      d.innerHTML = `
        <div class="dh-drawer__card">
          <header class="dh-drawer__head">
            <div>
              <h3>${esc(titleNo)}</h3>
              <p>${esc(row.counterparty_name || '')} · ${esc(row.work_title || 'без объекта')}</p>
              <div class="dh-drawer__amt" data-qa="drawer-amt">${esc(grossTxt)}</div>
              <div class="dh-drawer__src">ИЗ EXCEL · ${esc(String(srcLine))}</div>
            </div>
            <button type="button" id="dhDrawerClose" aria-label="Закрыть">✕</button>
          </header>
          <div class="dh-drawer__body">
            <div class="dh-coach">
              <div class="dh-coach__ico">→</div>
              <div class="dh-coach__body"><strong>Что дальше</strong><p>${esc(nextActionText(row))}</p></div>
            </div>
            ${payLink}
            <div class="dh-section dh-section--sums">
              <div class="dh-section__h">Суммы</div>
              <div class="dh-section__b">
                <div class="dh-sum-hero" data-qa="sum-hero" data-gross="${esc(String(sums.gross))}">
                  <div class="dh-sum-hero__main" data-qa="sum-hero-main">${esc(grossTxt)}</div>
                  <div class="dh-sum-hero__sub">с НДС · нетто ${esc(netTxt)} · НДС ${esc(vatTxt)}</div>
                  <div class="dh-sum-hero__due">Срок оплаты: ${fmtDate(row.payment_due_at) || 'не указан'}</div>
                  <div class="dh-sum-hero__grid">
                    <div><span class="k">С НДС</span><span class="v">${esc(grossTxt)}</span></div>
                    <div><span class="k">Без НДС</span><span class="v">${esc(netTxt)}</span></div>
                    <div><span class="k">НДС</span><span class="v">${esc(vatTxt)}</span></div>
                  </div>
                </div>
              </div>
            </div>
            <div class="dh-section">
              <div class="dh-section__h">Договор и связи</div>
              <div class="dh-section__b">
                <div class="dh-grid2">
                  <div class="dh-field"><label>Договор</label><div class="val">${esc(contractModeLabel(row.contract_mode))}</div>
                    <div class="hint">${row.is_incomplete ? 'Нужно привязать или отметить разовую поставку' : 'Можно сменить не выходя из реестра'}</div></div>
                  <div class="dh-field"><label>Работа</label><div class="val">${esc(row.work_title || '—')}${row.work_id ? ' (#' + row.work_id + ')' : ''}</div></div>
                  <div class="dh-field"><label>Статус</label><div class="val">${statusPill(row)}</div></div>
                  <div class="dh-field"><label>Склад</label><div class="val">${esc(whLabel(row))}</div></div>
                </div>
              </div>
            </div>
            <div class="dh-section">
              <div class="dh-section__h">Жизненный цикл</div>
              <div class="dh-section__b"><div class="dh-timeline">${timelineHtml(row)}</div></div>
            </div>
            <div class="dh-section">
              <div class="dh-section__h">Вложения</div>
              <div class="dh-section__b">
                ${attachmentsHtml(row)}
                <div class="dh-attach">
                  <div class="dh-attach__ico">+</div>
                  <div class="dh-attach__meta"><div class="a">Добавить скан СФ / УПД</div><div class="b">файл или путь, где лежит оригинал</div></div>
                  <button class="dh-btn dh-btn--sm dh-btn--primary" type="button" data-qa="sf">СФ</button>
                </div>
              </div>
            </div>
            <div class="dh-section">
              <div class="dh-section__h">Ответственные</div>
              <div class="dh-section__b dh-grid2">
                <div class="dh-field"><label>Отв. за документы</label><div class="val">${esc(row.doc_owner_name || '—')}</div></div>
                <div class="dh-field"><label>РП / объект</label><div class="val">${esc(row.pm_name || '—')}</div></div>
                <div class="dh-field"><label>1С</label><div class="val">${esc(row.onec_id || 'не связан')}</div></div>
                <div class="dh-field"><label>Комментарий</label><div class="val">${esc(row.comment_text || '—')}</div></div>
              </div>
            </div>
            ${editIncompleteHtml(row)}
          </div>
          <footer class="dh-drawer__foot">
            <button type="button" class="dh-btn dh-btn--ghost" id="dhDrawerEdit">Править</button>
            <button type="button" class="dh-btn dh-btn--ghost" id="dhDrawerSave">Сохранить</button>
            <button type="button" class="dh-btn dh-btn--ok" id="dhParseCatalog" ${row.dir !== 'in' ? 'disabled title="Только входящие"' : ''}>В каталог</button>
            <button type="button" class="dh-btn dh-btn--ghost" id="dhDrawerExpense" ${!row.work_id ? 'disabled title="Нет объекта"' : ''}>В расходы</button>
            ${canWh() ? '<button type="button" class="dh-btn dh-btn--ghost" data-qa="wh">Склад</button>' : ''}
            <button type="button" class="dh-btn dh-btn--primary" data-qa="pay">К оплате</button>
          </footer>
        </div>`;
      d.querySelector('#dhDrawerClose').onclick = () => {
        d.hidden = true;
        d.classList.remove('is-on');
        state.selectedId = null;
      };
      d.querySelector('#dhDrawerEdit')?.addEventListener('click', () => {
        const block = d.querySelector('#dhEditIncomplete') || d.querySelector('.dh-section');
        if (block) block.scrollIntoView({ behavior: 'smooth', block: 'start' });
        toast('Правка', row.is_incomplete ? 'Заполните поля ниже и сохраните' : 'Откройте неполные поля или обновите сроки в блоке договора', 'ok');
      });
      d.querySelector('#dhDrawerSave')?.addEventListener('click', () => {
        const save = d.querySelector('#dhEditSave');
        if (save) save.click();
        else toast('Сохранено', 'Нет изменяемых полей — карточка актуальна', 'ok');
      });
      d.querySelector('#dhDrawerExpense')?.addEventListener('click', () => {
        if (row.work_id) location.hash = '#/works/' + row.work_id;
        else toast('Объект', 'Сначала укажите работу в карточке', 'warn');
      });
      d.querySelectorAll('[data-qa]').forEach((btn) => {
        btn.onclick = () => quick(id, btn.getAttribute('data-qa'));
      });
      d.querySelector('#dhParseCatalog')?.addEventListener('click', async () => {
        const ok = await confirm('В каталог', 'Разобрать позиции и обновить номенклатуру для #' + id + '?');
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
          toast(
            'Каталог',
            n
              ? ('Позиций: ' + n + (touched ? ('; каталог ±' + touched) : '') + '. См. #/suppliers-catalog')
              : (res && res.pending ? 'Ожидает разбора скана' : 'Готово'),
            'ok'
          );
          await refresh();
          openDrawer(id);
        } catch (e) {
          toast('Ошибка', e.message || 'parse-catalog', 'err');
        }
      });
      d.querySelector('#dhEditSave')?.addEventListener('click', async () => {
        const patch = {
          contract_mode: d.querySelector('#dhEditContract')?.value || 'none',
          payment_due_at: d.querySelector('#dhEditPayDue')?.value || null,
          sf_due_at: d.querySelector('#dhEditSfDue')?.value || null
        };
        const wid = d.querySelector('#dhEditWorkId')?.value;
        if (wid) patch.work_id = parseInt(wid, 10);
        else patch.work_id = null;
        try {
          await api('/' + id, { method: 'PUT', body: JSON.stringify(patch) });
          toast('Сохранено', 'Поля обновлены', 'ok');
          await refresh();
          openDrawer(id);
        } catch (e) {
          toast('Ошибка', e.message || 'PUT failed', 'err');
        }
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
    if (state.view === 'registry') bindQuarterLive();
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
