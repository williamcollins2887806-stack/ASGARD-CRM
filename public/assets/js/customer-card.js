// ASGARD CRM — компактный виджет контрагента (embed в тендеры/ТКП)
// AsgardCustomerCard.mount(container, inn, opts) — те же .cp-* токены, без emoji.
window.AsgardCustomerCard = (function () {
  'use strict';

  const RISK_CLS = {
    green: 'cp-chip--risk-ok',
    yellow: 'cp-chip--risk-warn',
    red: 'cp-chip--risk-err',
    gray: 'cp-chip--risk-gray'
  };

  function esc(s) {
    return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function fmt(n) {
    const v = Number(n || 0);
    if (v >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + ' млн';
    if (v >= 1e3) return (v / 1e3).toFixed(0) + ' тыс';
    return v.toLocaleString('ru-RU');
  }

  function kpiItem(label, val, sub) {
    return `<div class="cp-kpi__item">
      <b>${val == null ? '—' : esc(String(val))}</b>
      <span>${esc(label)}</span>
      ${sub ? `<div class="help" style="margin-top:2px;font-size:11px">${esc(String(sub))}</div>` : ''}
    </div>`;
  }

  function renderHtml(d) {
    const tl = d.traffic_light || {};
    const t  = d.tenders     || {};
    const pt = d.pre_tenders || {};
    const k  = d.tkp         || {};
    const w  = d.works       || {};
    const f  = d.finance     || {};
    const p  = d.profile     || {};
    const kpi = d.kpi || {};
    const col = tl.color || 'gray';

    const convStr = t.conversion_pct != null
      ? t.won + ' выигр · ' + t.conversion_pct + '%'
      : (t.won || 0) + ' выигр';

    const lastContact = d.last_contact
      ? new Date(d.last_contact).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: '2-digit' })
      : '—';

    const statusRows = (t.by_status || []).slice(0, 6).map((s) =>
      `<tr>
        <td>${esc(s.tender_status)}</td>
        <td>${s.cnt}</td>
        <td>${fmt(s.sum)} ₽</td>
      </tr>`
    ).join('');

    return `
      <div class="cp-page" style="padding:0;max-width:none">
        <section class="cp-hero" style="padding:16px 18px;margin-bottom:10px">
          <p class="cp-hero__kicker">Контрагент</p>
          <h2 class="cp-hero__title" style="font-size:18px">${esc(p.name || p.full_name || 'Контрагент')}</h2>
          <p class="cp-hero__sub">ИНН ${esc(p.inn || '')}${p.kpp ? ' · КПП ' + esc(p.kpp) : ''}</p>
          <div class="cp-hero__chips">
            <span class="cp-chip ${RISK_CLS[col] || RISK_CLS.gray}">${esc(tl.label || col)}</span>
            ${d.roles ? `<span class="cp-chip">${esc(d.roles === 'both' ? 'Покупатель · Поставщик' : d.roles === 'supplier' ? 'Поставщик' : 'Покупатель')}</span>` : ''}
          </div>
          ${tl.reason ? `<p class="help" style="margin:8px 0 0">${esc(tl.reason)}</p>` : ''}
        </section>

        <div class="cp-kpi" style="margin-bottom:10px">
          ${kpiItem('Договоры', kpi.contracts != null ? kpi.contracts : '—')}
          ${kpiItem('Тендеры', t.total || 0, convStr)}
          ${kpiItem('Работы', w.total || 0, (w.active || 0) + ' активн')}
          ${kpiItem('Счета', kpi.docs != null ? kpi.docs : ((d.docs && d.docs.incoming) || 0))}
          ${kpiItem('Выиграно', fmt(t.won_sum) + ' ₽')}
          ${kpiItem('Задолженность', fmt(f.invoices_outstanding) + ' ₽', (f.overdue_invoices_cnt || 0) + ' просроч.')}
        </div>

        <div class="cp-kpi" style="margin-bottom:10px">
          ${kpiItem('Заявки', pt.total || 0)}
          ${kpiItem('ТКП', k.total || 0)}
          ${kpiItem('Контакт', lastContact)}
        </div>

        ${statusRows ? `
          <div class="cp-panel" style="padding:12px;margin-bottom:8px">
            <div class="help" style="margin-bottom:8px;font-weight:700">Статусы тендеров</div>
            <table class="cp-table"><thead><tr><th>Статус</th><th>Кол-во</th><th>Сумма</th></tr></thead>
            <tbody>${statusRows}</tbody></table>
          </div>` : ''}

        ${contractsHtml(d.contracts_list)}

        ${obsContractsHtml(d.obs_contracts_list, d.obs_limits)}

        ${docsHtml(d.docs_list, d.docs_total || (d.kpi && d.kpi.docs_in))}

        <div class="cp-panel" style="padding:12px" id="ccChecklistsBlock">
          <div class="help" style="margin-bottom:8px;font-weight:700">Чек-листы анализа</div>
          <div id="ccChecklists"><div class="help">Загрузка…</div></div>
        </div>
      </div>`;
  }

  /**
   * D-402 (08.11.2026): список договоров контрагента.
   *
   * Заказчик: «в карточке контрагента видеть все договора и счета по этому
   * контрагенту». Раньше был только счётчик «Договоры: 3» — какие именно,
   * приходилось искать в реестре договоров вручную.
   */
  function contractsHtml(list) {
    if (!Array.isArray(list) || !list.length) {
      return `<div class="cp-panel" style="padding:12px;margin-bottom:8px">
        <div class="help" style="margin-bottom:8px;font-weight:700">Договоры</div>
        <div class="help">Договоров по этому контрагенту нет.</div>
      </div>`;
    }
    const rows = list.map((c) => {
      const sum = c.amount != null ? fmt(c.amount) + ' ₽' : '—';
      const date = c.date ? String(c.date).slice(0, 10).split('-').reverse().join('.') : '—';
      const scan = c.has_scan ? 'есть' : '—';
      const linked = c.docs_count > 0 ? c.docs_count : '—';
      return `<tr>
        <td>${esc(c.number || '—')}</td>
        <td>${esc(date)}</td>
        <td>${esc(sum)}</td>
        <td>${esc(scan)}</td>
        <td>${esc(String(linked))}</td>
        <td>${esc(c.status || '')}</td>
      </tr>`;
    }).join('');
    return `<div class="cp-panel" style="padding:12px;margin-bottom:8px">
      <div class="help" style="margin-bottom:8px;font-weight:700">Договоры (${list.length})</div>
      <table class="cp-table">
        <thead><tr><th>Номер</th><th>Дата</th><th>Сумма</th><th>Скан</th><th>Счетов</th><th>Статус</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }

  /** V475: компактный блок ОБС-лимитов в embed-карточке. */
  function obsContractsHtml(list, limits) {
    if ((!Array.isArray(list) || !list.length) && !(limits && limits.limit > 0)) {
      return '';
    }
    const items = Array.isArray(list) ? list : [];
    const summary = limits && limits.limit > 0 ? (() => {
      const pct = Math.min(100, Math.max(0, Number(limits.used_pct) || 0));
      const color = limits.exhausted_count > 0 ? 'var(--red)'
        : (limits.near_limit ? 'var(--amber)' : 'var(--green)');
      return `<div style="margin-bottom:8px">
        <div style="font-size:12px;color:var(--t2)">
          ОБС: <b style="color:${color}">${esc(fmt(limits.spent))}</b>
          из ${esc(fmt(limits.limit))} (${pct}%)
          · остаток ${esc(fmt(limits.remaining))}
          ${limits.near_limit && !(limits.exhausted_count > 0) ? ' · &lt;10%' : ''}
          ${limits.exhausted_count > 0 ? ' · лимит исчерпан' : ''}
        </div>
        <div style="height:5px;border-radius:3px;background:var(--bg4);overflow:hidden;margin-top:4px">
          <div style="height:100%;width:${pct}%;background:${color}"></div>
        </div>
      </div>`;
    })() : '';

    const rows = items.map((c) => {
      const l = c.limit || {};
      const pct = Math.min(100, Math.max(0, Number(l.used_pct) || 0));
      const color = l.exhausted ? 'var(--red)' : (pct >= 90 ? 'var(--amber)' : 'var(--green)');
      const limitLabel = l.amount > 0
        ? `${esc(fmt(l.spent || 0))} / ${esc(fmt(l.amount))} (${pct}%)`
        : 'лимит не задан';
      return `<tr>
        <td><b>${esc(c.number || '—')}</b></td>
        <td style="color:${color};font-weight:600">${limitLabel}</td>
        <td>${esc(fmt(l.remaining || 0))}</td>
        <td>${c.docs_count || 0}</td>
      </tr>`;
    }).join('');

    return `<div class="cp-panel" style="padding:12px;margin-bottom:8px">
      <div class="help" style="margin-bottom:8px;font-weight:700">ОБС-договоры (${items.length})</div>
      ${summary}
      ${items.length ? `<table class="cp-table">
        <thead><tr><th>Номер</th><th>Выработано</th><th>Остаток</th><th>Счетов</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>` : ''}
    </div>`;
  }

  /** D-402: список счетов контрагента — с номером договора, если привязан. */
  function docsHtml(list, totalHint) {
    if (!Array.isArray(list) || !list.length) {
      return `<div class="cp-panel" style="padding:12px;margin-bottom:8px">
        <div class="help" style="margin-bottom:8px;font-weight:700">Счета</div>
        <div class="help">Счетов по этому контрагенту нет.</div>
      </div>`;
    }
    const total = Number(totalHint) > 0 ? Number(totalHint) : list.length;
    const shown = list.slice(0, 40);
    const rows = shown.map((d) => {
      const sum = d.amount != null ? fmt(d.amount) + ' ₽' : '—';
      const date = d.invoice_date ? String(d.invoice_date).slice(0, 10).split('-').reverse().join('.') : '—';
      const obj = d.object_name ? String(d.object_name).slice(0, 40) : (d.work_number || '—');
      return `<tr>
        <td>${esc(d.invoice_number || 'б/н')}</td>
        <td>${esc(date)}</td>
        <td>${esc(sum)}</td>
        <td>${esc(obj)}</td>
        <td>${d.contract_id ? 'да' : '—'}</td>
        <td>${esc(d.ops_status || '')}</td>
      </tr>`;
    }).join('');
    const more = total > shown.length
      ? `<div class="help" style="margin-top:6px">Показаны ${shown.length} из ${total}.</div>`
      : '';
    return `<div class="cp-panel" style="padding:12px;margin-bottom:8px">
      <div class="help" style="margin-bottom:8px;font-weight:700">Счета (${total})</div>
      <table class="cp-table">
        <thead><tr><th>Счёт</th><th>Дата</th><th>Сумма</th><th>Объект</th><th>Договор</th><th>Статус</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${more}
    </div>`;
  }

  function checklistsHtml(items) {
    if (!items || !items.length) {
      return '<div class="help">Чек-листов по этому контрагенту пока нет.</div>';
    }
    return '<table class="cp-table"><thead><tr><th>Дата</th><th>Объект</th><th>Статус</th></tr></thead><tbody>' +
      items.slice(0, 20).map((x) =>
        `<tr><td>${esc(String(x.created_at || x.updated_at || '').slice(0, 10))}</td>
         <td>${esc(x.tender_title || x.work_title || x.title || '—')}</td>
         <td>${esc(x.status || '')}</td></tr>`
      ).join('') + '</tbody></table>';
  }

  async function loadChecklists(inn, root) {
    const box = root.querySelector('#ccChecklists');
    if (!box) return;
    try {
      const auth = await AsgardAuth.getAuth();
      const r = await fetch('/api/customers/' + encodeURIComponent(inn) + '/analysis-checklists', {
        headers: { Authorization: 'Bearer ' + (auth && auth.token ? auth.token : '') }
      });
      const data = await r.json().catch(() => ({}));
      const items = data.items || data.checklists || data.rows || [];
      box.innerHTML = checklistsHtml(items);
    } catch (_) {
      box.innerHTML = '<div class="help">История недоступна.</div>';
    }
  }

  async function mount(container, inn, opts) {
    if (!container) return;
    const cleanInn = String(inn || '').replace(/\D/g, '');
    if (cleanInn.length !== 10 && cleanInn.length !== 12) {
      container.innerHTML = '<div class="help">Некорректный ИНН</div>';
      return;
    }
    container.innerHTML = '<div class="help">Загрузка карточки…</div>';
    try {
      const auth = await AsgardAuth.getAuth();
      const r = await fetch('/api/customers/' + encodeURIComponent(cleanInn) + '/dashboard', {
        headers: { Authorization: 'Bearer ' + (auth && auth.token ? auth.token : '') }
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      container.innerHTML = renderHtml(d);
      loadChecklists(cleanInn, container);
      if (opts && typeof opts.onLoaded === 'function') opts.onLoaded(d);
    } catch (e) {
      container.innerHTML = '<div class="help">Не удалось загрузить: ' + esc(e.message || e) + '</div>';
    }
  }

  function mountFromData(container, data) {
    if (!container || !data) return;
    container.innerHTML = renderHtml(data);
    const inn = data.profile && data.profile.inn;
    if (inn) loadChecklists(inn, container);
  }

  return { mount, mountFromData, renderHtml };
})();
