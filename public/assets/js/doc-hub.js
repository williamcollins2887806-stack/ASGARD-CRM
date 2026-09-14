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
    facets: { counterparties: [] },
    rows: [],
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
  function money(n) {
    const x = Number(n) || 0;
    return x.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽';
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

  function statusLabel(row) {
    if (row.overdue_pay || row.pay_status === 'overdue') return 'Просрочка оплаты';
    if (row.overdue_sf) return 'Просрочка СФ';
    if (row.is_incomplete) return 'Дозаполнить';
    if (row.wh_status === 'to_office') return 'В пути в офис';
    if (row.wh_status === 'await' || row.ops_status === 'wh_transfer') return 'У склада';
    if (row.ops_status === 'done' || (row.pay_status === 'paid' && row.closing_json)) return 'Закрыто';
    if (row.dir === 'out' && row.ops_status === 'out_sent') return 'Выставлено';
    if (row.dir === 'out') return 'Черновик исх.';
    if (row.ops_status === 'wait_sf' || row.ops_status === 'wait_closing') return 'Ждём СФ';
    if (row.ops_status === 'wait_pay') return 'Ждём оплату';
    if (row.ops_status === 'paid') return 'Оплачен';
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
      state.kpiData = kpi || {};
    } finally {
      state.loading = false;
    }
  }

  function kpiVal(key) {
    const k = state.kpiData || {};
    return k[key] != null ? k[key] : '—';
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
    else if (row.is_incomplete) kind = 'info';
    else if (row.wh_status === 'to_office') kind = 'gold';
    else if (['wait_sf', 'wait_closing'].includes(row.ops_status)) kind = 'warn';
    else if (row.ops_status === 'done' || (row.pay_status === 'paid' && row.closing_json)) kind = 'ok';
    else if (row.dir === 'out' && row.ops_status === 'out_sent') kind = 'ok';
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

  function renderTable() {
    if (!state.rows.length) {
      return `<div class="dh-empty"><div class="dh-empty__ico">◇</div><div class="dh-empty__t">Пока пусто</div><p>Нажмите «Внести документ» или включите «Показать все».</p></div>`;
    }
    const ico = qaIcons();
    const body = state.rows.map((r) => {
      return `<tr class="${rowClass(r)}" data-id="${r.id}">
        <td>${statusPill(r)}</td>
        <td><span class="dh-pill dh-pill--${r.dir === 'out' ? 'gold' : 'info'}">${r.dir === 'out' ? 'исходящий' : 'входящий'}</span></td>
        <td>
          <div class="dh-stack"><span class="a dh-mono">${esc(r.invoice_number || 'б/н')}</span><span class="b">${fmtDate(r.invoice_date)}</span></div>
        </td>
        <td>
          <div class="dh-stack"><span class="a">${esc(r.counterparty_name)}</span><span class="b">${esc(r.work_title || 'без объекта')}</span></div>
        </td>
        <td class="dh-money">${money(r.amount_gross)}</td>
        <td>${vatCell(r)}</td>
        <td><span class="dh-pill dh-pill--muted">${esc(contractModeLabel(r.contract_mode))}</span></td>
        <td>${payCell(r)}</td>
        <td>${closingCell(r)}</td>
        <td>${purposeFlags(r)}</td>
        <td>
          <div class="dh-stack"><span class="a">${esc(r.doc_owner_name || '—')}</span><span class="b">РП: ${esc(r.pm_name || '—')}</span></div>
        </td>
        <td class="dh-actions">
          <div class="dh-qa">
            <button type="button" data-qa="pay" title="К оплате" ${r.pay_status === 'paid' ? 'disabled' : ''}>${ico.pay}</button>
            <button type="button" data-qa="sf" title="СФ получена">${ico.sf}</button>
            <button type="button" data-qa="wh" title="Склад">${ico.wh}</button>
            <button type="button" data-qa="open" title="Карточка">${ico.open}</button>
          </div>
        </td>
      </tr>`;
    }).join('');
    return `<div class="dh-table-wrap"><table class="dh-table dh-table--rich">
      <thead><tr>
        <th>Статус</th><th>Напр.</th><th>Счёт</th><th>Контрагент / объект</th><th>Сумма</th><th>НДС</th><th>Договор</th><th>Оплата</th><th>Закр.</th><th>ТМЦ</th><th>Отв.</th><th></th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table></div>`;
  }

  function renderGuideView() {
    return `
      <div class="dh-view is-on" id="dhViewGuide">
        <div class="dh-coach">
          <div class="dh-coach__ico">i</div>
          <div class="dh-coach__body">
            <strong>Как пользоваться Doc Hub</strong>
            <p>По умолчанию — только ваши строки. «Показать все» живёт до ухода со страницы; после F5 снова «мои». Оплата — только через очередь согласования.</p>
          </div>
        </div>
        <div class="dh-guide-grid">
          <article class="dh-gcard"><div class="n">01</div><h3>Внести счёт</h3><p>Мастер: направление и тип → суммы с авто-НДС → договор, сроки и скан → проверка и позиции каталога.</p><div class="who">Закупки · РП · Бух · ТО</div></article>
          <article class="dh-gcard"><div class="n">02</div><h3>Договор и объект</h3><p>Выберите режим договора и при необходимости укажите работу. Без договора строка попадёт в «Неполные».</p><div class="who">Закупки · Бух</div></article>
          <article class="dh-gcard"><div class="n">03</div><h3>Оплата</h3><p>Кнопка «Опл» / «К оплате» ведёт в очередь согласования платежей. Не дублируйте оплату здесь.</p><div class="who">Бух · Дирекция</div></article>
          <article class="dh-gcard"><div class="n">04</div><h3>СФ и склад</h3><p>СФ — закрывающие; Склад — цепочка кладовщика. Входящие позиции можно отправить в номенклатуру.</p><div class="who">Кладовщик · Бух</div></article>
          <article class="dh-gcard"><div class="n">05</div><h3>1С</h3><p>«В 1С» скачивает CSV с превью; «Из 1С» — сопоставление кода учёта.</p><div class="who">Бух</div></article>
          <article class="dh-gcard"><div class="n">06</div><h3>Неполные</h3><p>KPI и фильтр показывают документы без обязательных полей. Дозаполнение — в карточке справа.</p><div class="who">Все роли хаба</div></article>
        </div>
        <div class="dh-card dh-guide-coverage">
          <div class="dh-card__head"><h2>Покрытие Excel → CRM</h2><span>колонки реестра счетов</span></div>
          <div class="dh-table-wrap dh-table-wrap--auto">
            <table class="dh-map">
              <thead><tr><th>Excel</th><th>В CRM</th><th>Заметка</th></tr></thead>
              <tbody>
                <tr><td>Ответственный за документы</td><td>Ответственный за документы</td><td>кто ведёт бумагу/ЭДО</td></tr>
                <tr><td>Ответственный за объект</td><td>РП работы</td><td>из работы / вручную</td></tr>
                <tr><td>Объект</td><td>Работа в CRM</td><td>связь с работами</td></tr>
                <tr><td>Счёт: номер / дата / сумма</td><td>Поля счёта</td><td>входящий счёт</td></tr>
                <tr><td>НДС да/нет</td><td>Признак НДС + ставка</td><td>автопересчёт</td></tr>
                <tr><td>Контрагент</td><td>Контрагент</td><td>фильтр + поиск</td></tr>
                <tr><td>Договор</td><td>Режим договора</td><td>привязан / разовая / общий…</td></tr>
                <tr><td>Состояние</td><td>Статус операции</td><td>фильтр в списке</td></tr>
                <tr><td>СРОК ОПЛАТЫ</td><td>Срок оплаты</td><td>KPI просрочки</td></tr>
                <tr><td>Срок СФ</td><td>Срок СФ</td><td>KPI «Ждём СФ»</td></tr>
                <tr><td>Закрывающие</td><td>Закрывающие документы</td><td>СФ / УПД</td></tr>
                <tr><td>Вложения / путь</td><td>Вложения</td><td>загрузка файла</td></tr>
                <tr><td>Комментарий</td><td>Комментарий</td><td>—</td></tr>
                <tr><td>Назначение ТМЦ</td><td>Назначение</td><td>заказчик / Асгард / расходники</td></tr>
                <tr><td>1С</td><td>Связь с 1С</td><td>выгрузка / загрузка CSV</td></tr>
                <tr><td>Склад</td><td>Статус склада</td><td>цепочка до бух</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>`;
  }

  function facetsHtml() {
    const cps = state.facets.counterparties || [];
    const opts = OPS_OPTIONS.map(([v, l]) =>
      `<option value="${esc(v)}" ${state.facetOps === v ? 'selected' : ''}>${esc(l)}</option>`
    ).join('');
    return `
      <div class="dh-facets" id="dhFacets">
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

  function shellHtml() {
    const scopeAll = state.scope === 'all';
    const isGuide = state.view === 'guide';
    return `
      <link rel="stylesheet" href="assets/css/doc-hub.css" />
      <div class="dh-app dh-app--embedded">
        <div class="dh-shell">
          <header class="dh-top">
            <div class="dh-top__title">
              <div class="dh-top__eyebrow">Финансы · Документы</div>
              <h1 class="dh-top__h1">${isGuide ? 'Как пользоваться · покрытие Excel' : 'Реестр счетов, СФ и УПД'}</h1>
              <p class="dh-top__sub">${isGuide ? 'Справка и колонки Excel → CRM' : 'Единый хаб входящих и исходящих · работы, договоры, закупки, 1С'}</p>
            </div>
            <div class="dh-top__actions">
              <button class="dh-btn dh-btn--ghost ${isGuide ? 'is-on' : ''}" type="button" id="dhBtnGuide">${isGuide ? 'К реестру' : 'Справка'}</button>
              <button class="dh-btn dh-btn--ghost" type="button" id="dhBtnHelp" title="Подсказка">?</button>
              <button class="dh-btn dh-btn--ghost" type="button" id="dhBtnImport1c">Из 1С</button>
              <button class="dh-btn dh-btn--ghost" type="button" id="dhBtnExport1c">В 1С</button>
              <button class="dh-btn dh-btn--primary" type="button" id="dhBtnNew">Внести документ</button>
            </div>
          </header>
          <main class="dh-main">
            ${isGuide ? renderGuideView() : `
            <div class="dh-coach ${state.coachOpen ? '' : 'is-collapsed'}" id="dhCoach">
              <div class="dh-coach__ico">i</div>
              <div class="dh-coach__body">
                <strong>С чего начать</strong>
                <p>По умолчанию — только ваши строки. «Показать все» сбрасывается при обновлении страницы (F5). Оплата — через очередь согласования, не второй кнопкой «оплачен».</p>
              </div>
              <button class="dh-coach__close" type="button" id="dhCoachClose">✕</button>
            </div>
            <div class="dh-kpis" id="dhKpis">
              <button class="dh-kpi ${state.kpi === 'all' ? 'is-on' : ''}" type="button" data-kpi="all"><div class="k">Всего</div><div class="v">${kpiVal('all')}</div></button>
              <button class="dh-kpi is-err ${state.kpi === 'pay' ? 'is-on' : ''}" type="button" data-kpi="pay"><div class="k">Просрочка оплаты</div><div class="v">${kpiVal('pay')}</div></button>
              <button class="dh-kpi is-warn ${state.kpi === 'sf' ? 'is-on' : ''}" type="button" data-kpi="sf"><div class="k">Ждём СФ</div><div class="v">${kpiVal('sf')}</div></button>
              <button class="dh-kpi is-info ${state.kpi === 'wh' ? 'is-on' : ''}" type="button" data-kpi="wh"><div class="k">У кладовщика</div><div class="v">${kpiVal('wh')}</div></button>
              <button class="dh-kpi is-ok ${state.kpi === 'out' ? 'is-on' : ''}" type="button" data-kpi="out"><div class="k">Исходящие</div><div class="v">${kpiVal('out')}</div></button>
              <button class="dh-kpi ${state.kpi === '1c' ? 'is-on' : ''}" type="button" data-kpi="1c"><div class="k">Не в 1С</div><div class="v">${kpiVal('no_1c')}</div></button>
              <button class="dh-kpi is-info ${state.kpi === 'incomplete' ? 'is-on' : ''}" type="button" data-kpi="incomplete"><div class="k">Неполные</div><div class="v">${kpiVal('incomplete')}</div></button>
            </div>
            <div class="dh-toolbar">
              <div class="dh-seg" id="dhDirSeg">
                <button type="button" class="${state.dir === 'all' ? 'is-on' : ''}" data-dir="all">Все</button>
                <button type="button" class="${state.dir === 'in' ? 'is-on' : ''}" data-dir="in">Входящие</button>
                <button type="button" class="${state.dir === 'out' ? 'is-on' : ''}" data-dir="out">Исходящие</button>
              </div>
              <label class="dh-scope">
                <input type="checkbox" id="dhScopeAll" ${scopeAll ? 'checked' : ''}/> Показать все
              </label>
              <input class="dh-search" id="dhSearch" type="search" placeholder="Поиск: счёт, контрагент, объект…" value="${esc(state.q)}" />
            </div>
            ${facetsHtml()}
            <div id="dhTableHost">${state.loading ? '<div class="dh-empty">Загрузка…</div>' : renderTable()}</div>
            `}
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
        <div class="dh-step ${step === 1 ? 'is-on' : (step > 1 ? 'is-done' : '')}"><span class="n">1</span> Тип и суммы</div>
        <div class="dh-step ${step === 2 ? 'is-on' : (step > 2 ? 'is-done' : '')}"><span class="n">2</span> Договор и файл</div>
        <div class="dh-step ${step === 3 ? 'is-on' : ''}"><span class="n">3</span> Проверка</div>
      </div>`;
    if (step === 1) {
      return steps + `
        <div class="dh-coach dh-coach--compact"><div class="dh-coach__ico">1</div><div class="dh-coach__body"><strong>Что вносим?</strong><p>Входящий — счёт/СФ от поставщика. Исходящий — наш СФ или УПД клиенту. Суммы: меняете «с НДС» или «без» — вторая и НДС пересчитаются (ставка 22%).</p></div></div>
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
        <div class="dh-checkrow" id="dhDocKinds">
          <label class="dh-check"><input type="checkbox" name="doc_kind" value="invoice" ${kinds.has('invoice') ? 'checked' : ''}/> Счёт</label>
          <label class="dh-check"><input type="checkbox" name="doc_kind" value="sf" ${kinds.has('sf') ? 'checked' : ''}/> СФ</label>
          <label class="dh-check"><input type="checkbox" name="doc_kind" value="upd" ${kinds.has('upd') ? 'checked' : ''}/> УПД</label>
          <label class="dh-check"><input type="checkbox" name="doc_kind" value="act" ${kinds.has('act') ? 'checked' : ''}/> Акт</label>
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
        </div>
        <div class="dh-dup" id="dhWizDup" hidden>
          <strong>Похожий расход уже может быть на объекте</strong>
          <p>РП мог внести этот счёт в расходы. После сохранения проверьте дубли в карточке и связях объекта.</p>
        </div>`;
    }
    if (step === 2) {
      return steps + `
        <div class="dh-coach dh-coach--compact"><div class="dh-coach__ico">2</div><div class="dh-coach__body"><strong>Объект и договор</strong><p>Без договора сохранение возможно, но строка попадёт в «Неполные». Прикрепите скан — для входящих позиции уйдут в номенклатуру.</p></div></div>
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
        <div class="dh-field"><label>Работа / объект (ID в CRM)</label><input name="work_id" type="number" min="1" step="1" placeholder="оставьте пустым, если объекта ещё нет" value="${esc(d.work_id)}" /><div class="dh-help">необязательно — можно дозаполнить позже</div></div>
        <div class="dh-field"><label>Комментарий</label><textarea name="comment_text" rows="2" placeholder="Условия оплаты, ТК, РПО…">${esc(d.comment_text)}</textarea></div>
        <div class="dh-field">
          <label>Вложение (скан счёта)</label>
          <label class="dh-drop">
            <input type="file" name="attachment" accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.webp,.json,.txt" />
            <span class="dh-drop__t">${d.file ? esc(d.file.name) : 'Перетащите скан счёта или выберите файл'}</span>
            <span class="dh-drop__s">PDF, JPG, PNG · входящие строки уйдут в номенклатуру</span>
          </label>
        </div>`;
    }
    const hasVat = d.has_vat === '1';
    const gross = parseFloat(d.amount_gross) || 0;
    const net = hasVat ? +(gross / (1 + VAT_RATE)).toFixed(2) : gross;
    const vat = hasVat ? +(gross - net).toFixed(2) : 0;
    return steps + `
      <div class="dh-coach dh-coach--compact"><div class="dh-coach__ico">3</div><div class="dh-coach__body"><strong>Проверка перед сохранением</strong><p>Сверьте суммы и договор. Для входящих добавьте позиции каталога — по строкам с названием, ценой и количеством.</p></div></div>
      <div class="dh-review-grid">
        <div class="dh-review-card"><div class="k">Направление</div><div class="v">${d.dir === 'out' ? 'Исходящий' : 'Входящий'}</div></div>
        <div class="dh-review-card"><div class="k">Типы</div><div class="v">${esc((d.doc_kinds || []).map((x) => ({ invoice: 'Счёт', sf: 'СФ', upd: 'УПД', act: 'Акт' }[x] || x)).join(', ') || 'Счёт')}</div></div>
        <div class="dh-review-card"><div class="k">Счёт</div><div class="v">${esc(d.invoice_number)} · ${fmtDate(d.invoice_date)}</div></div>
        <div class="dh-review-card"><div class="k">Контрагент</div><div class="v">${esc(d.counterparty_name)}</div></div>
        <div class="dh-review-card"><div class="k">Сумма</div><div class="v dh-money">${money(gross)}</div><div class="s">${hasVat ? 'НДС ' + money(vat) + ' · нетто ' + money(net) : 'без НДС'}</div></div>
        <div class="dh-review-card"><div class="k">Договор</div><div class="v">${esc(contractModeLabel(d.contract_mode))}</div></div>
        <div class="dh-review-card"><div class="k">Сроки</div><div class="v">оплата ${fmtDate(d.payment_due_at)}</div><div class="s">СФ ${fmtDate(d.sf_due_at)}</div></div>
        <div class="dh-review-card"><div class="k">Файл</div><div class="v">${d.file ? esc(d.file.name) : 'нет скана'}</div></div>
      </div>
      <div class="dh-field"><label>Позиции для каталога (входящие)</label>
        <div class="dh-lines-head"><span>Наименование</span><span>Цена</span><span>Кол-во</span><span>Ед.</span><span></span></div>
        <div class="dh-lines" id="dhWizLines"></div>
        <button type="button" class="dh-btn dh-btn--ghost dh-btn--sm" id="dhWizAddLine">+ позиция</button>
        <textarea name="parsed_json" id="dhWizParsed" class="dh-hidden-json" rows="2">${esc(d.parsed_json)}</textarea>
      </div>`;
  }

  function openWizard() {
    const modal = document.getElementById('dhModal');
    if (!modal) return;
    state.wizStep = 1;
    state.wizDraft = emptyWizDraft();
    modal.hidden = false;
    paintWizard(modal);
  }

  function paintWizard(modal) {
    const step = state.wizStep;
    modal.innerHTML = `
      <div class="dh-modal__card dh-modal__card--wiz">
        <header class="dh-modal__head">
          <h2>Внести документ</h2>
          <button type="button" class="dh-modal__x" id="dhModalClose">✕</button>
        </header>
        <form id="dhWizForm" class="dh-wiz" data-step="${step}">
          ${wizStepHtml(step)}
          <footer class="dh-modal__foot">
            <button type="button" class="dh-btn dh-btn--ghost" id="dhWizCancel">Отмена</button>
            <button type="button" class="dh-btn dh-btn--ghost" id="dhWizBack" ${step <= 1 ? 'disabled' : ''}>Назад</button>
            ${step < 3
              ? '<button type="button" class="dh-btn dh-btn--primary" id="dhWizNext">Далее</button>'
              : '<button type="submit" class="dh-btn dh-btn--primary" id="dhWizSubmit">Сохранить</button>'}
          </footer>
        </form>
      </div>`;
    const form = modal.querySelector('#dhWizForm');
    modal.querySelector('#dhModalClose').onclick = () => { modal.hidden = true; };
    modal.querySelector('#dhWizCancel').onclick = () => { modal.hidden = true; };
    modal.querySelector('#dhWizBack').onclick = () => {
      readWizStepFields(form);
      state.wizStep = Math.max(1, state.wizStep - 1);
      paintWizard(modal);
    };
    const next = modal.querySelector('#dhWizNext');
    if (next) {
      next.onclick = () => {
        if (!form.reportValidity()) return;
        readWizStepFields(form);
        state.wizStep = Math.min(3, state.wizStep + 1);
        paintWizard(modal);
      };
    }
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      readWizStepFields(form);
      await submitWizard(modal);
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
          if (vatAmt) vatAmt.textContent = money(v);
        } else {
          grossEl.value = String(n);
          if (vatAmt) vatAmt.textContent = money(0);
        }
      } else {
        const g = parseFloat(grossEl.value) || 0;
        if (on) {
          const n = Math.round((g / (1 + VAT_RATE)) * 100) / 100;
          const v = Math.round((g - n) * 100) / 100;
          if (netEl) netEl.value = String(n);
          if (vatAmt) vatAmt.textContent = money(v);
        } else {
          if (netEl) netEl.value = String(g);
          if (vatAmt) vatAmt.textContent = money(0);
        }
        if (dup) {
          const g2 = parseFloat(grossEl.value) || 0;
          dup.hidden = !(g2 === 2200 || g2 === 500 || g2 === 1000);
        }
      }
      lock = false;
    };
    if (grossEl) grossEl.addEventListener('input', () => paintVat('gross'));
    if (netEl) netEl.addEventListener('input', () => paintVat('net'));
    if (hasChk) hasChk.addEventListener('change', () => paintVat('gross'));
    paintVat('gross');
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
      modal.hidden = true;
      state.wizDraft = null;
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
    if (!atts.length) return '<div class="dh-empty dh-empty--sm"><div class="dh-empty__t">Нет вложений</div><p>Добавьте скан счёта или СФ при создании / через API upload.</p></div>';
    return atts.map((a) => {
      const url = typeof a === 'string' ? a : (a.url || a.path || '');
      const name = typeof a === 'string' ? a.split('/').pop() : (a.name || a.filename || url || 'файл');
      return `<div class="dh-attach">
        <div class="dh-attach__ico">PDF</div>
        <div class="dh-attach__meta">
          <div class="a">${esc(name)}</div>
          <div class="b">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">открыть</a>` : '—'}</div>
        </div>
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

  async function openDrawer(id) {
    try {
      const row = await api('/' + id);
      state.selectedId = id;
      const d = document.getElementById('dhDrawer');
      if (!d) return;
      d.hidden = false;
      d.classList.add('is-on');
      const payLink = row.payment_invoice_id
        ? `<p><a href="#/approval-payment?id=${row.payment_invoice_id}">Очередь оплаты #${row.payment_invoice_id}</a></p>`
        : '';
      d.innerHTML = `
        <div class="dh-drawer__card">
          <header class="dh-drawer__head">
            <div>
              <h3>${esc(row.invoice_number || '#' + row.id)}</h3>
              <p>${esc(row.counterparty_name || '')} · ${esc(row.work_title || 'без объекта')}</p>
            </div>
            <button type="button" id="dhDrawerClose">✕</button>
          </header>
          <div class="dh-drawer__body">
            <div class="dh-coach dh-coach--compact">
              <div class="dh-coach__ico">→</div>
              <div class="dh-coach__body"><strong>Что дальше</strong><p>${esc(nextActionText(row))}</p></div>
            </div>
            ${payLink}
            <dl class="dh-dl">
              <dt>Контрагент</dt><dd>${esc(row.counterparty_name)}</dd>
              <dt>Сумма</dt><dd>${money(row.amount_gross)}</dd>
              <dt>Статус</dt><dd>${esc(statusLabel(row))}</dd>
              <dt>Объект</dt><dd>${esc(row.work_title || '—')}${row.work_id ? ' (#' + row.work_id + ')' : ''}</dd>
              <dt>Договор</dt><dd>${esc(contractModeLabel(row.contract_mode))}</dd>
              <dt>Отв. док.</dt><dd>${esc(row.doc_owner_name || '—')}</dd>
              <dt>РП</dt><dd>${esc(row.pm_name || '—')}</dd>
              <dt>1С</dt><dd>${esc(row.onec_id || 'не связан')}</dd>
              <dt>Склад</dt><dd>${esc(row.wh_status || '—')}</dd>
              <dt>Оплата до</dt><dd>${fmtDate(row.payment_due_at)}</dd>
            </dl>
            <div class="dh-section">
              <div class="dh-section__h">Вложения</div>
              <div class="dh-section__b">${attachmentsHtml(row)}</div>
            </div>
            ${editIncompleteHtml(row)}
            <div class="dh-drawer__actions">
              <button type="button" class="dh-btn dh-btn--ghost" data-qa="sf">СФ</button>
              <button type="button" class="dh-btn dh-btn--ghost" data-qa="wh">Склад</button>
              <button type="button" class="dh-btn dh-btn--primary" data-qa="pay">К оплате</button>
              <button type="button" class="dh-btn dh-btn--ok" id="dhParseCatalog" ${row.dir !== 'in' ? 'disabled title="Только входящие"' : ''}>В каталог</button>
            </div>
          </div>
        </div>`;
      d.querySelector('#dhDrawerClose').onclick = () => {
        d.hidden = true;
        d.classList.remove('is-on');
        state.selectedId = null;
      };
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
      if (state.facetIncomplete) state.kpi = 'incomplete';
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
  }

  function bind(root) {
    root.querySelector('#dhBtnNew')?.addEventListener('click', openWizard);
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
      if (v && map[key]) v.textContent = kpiVal(map[key]);
    });
  }

  async function refresh() {
    if (state.view === 'guide') return;
    const host = document.getElementById('dhTableHost');
    if (!host) return;
    await loadData();
    host.innerHTML = renderTable();
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
      await layoutFn(html, { title: 'Реестр документов' });
    } else if (layoutFn && layoutFn.innerHTML !== undefined) {
      layoutFn.innerHTML = html;
    } else if (window.layout) {
      await window.layout(html, { title: 'Реестр документов' });
    }
    bind(document);
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
    state.view = 'registry';
    state.selectedId = null;
    state.coachOpen = true;
    await paint(layoutFn || window.layout);
    try {
      const q = new URLSearchParams((location.hash.split('?')[1] || ''));
      const id = Number(q.get('id'));
      if (id) openDrawer(id);
    } catch (_) { /* ignore */ }
  }

  return { render };
})();
