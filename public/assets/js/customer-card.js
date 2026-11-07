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

        <div class="cp-panel" style="padding:12px" id="ccChecklistsBlock">
          <div class="help" style="margin-bottom:8px;font-weight:700">Чек-листы анализа</div>
          <div id="ccChecklists"><div class="help">Загрузка…</div></div>
        </div>
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
