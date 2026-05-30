// ASGARD CRM — Карточка-светофор контрагента
// Универсальный компонент: AsgardCustomerCard.mount(container, inn, opts)
// Монтируется в любой DOM-контейнер. Не зависит от страницы.
window.AsgardCustomerCard = (function () {
  'use strict';

  const COLORS = { green: '#2E7D32', yellow: '#E65100', red: '#B71C1C', gray: '#757575' };
  const EMOJI  = { green: '🟢', yellow: '🟡', red: '🔴', gray: '⚪' };

  function esc(s) {
    return String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function fmt(n) {
    const v = Number(n || 0);
    if (v >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + ' млн';
    if (v >= 1e3) return (v / 1e3).toFixed(0) + ' тыс';
    return v.toLocaleString('ru-RU');
  }

  function kpi(icon, label, val, sub) {
    return `<div class="cc-kpi">
      <div class="cc-kpi-label">${icon} ${esc(label)}</div>
      <div class="cc-kpi-val">${val == null ? '—' : esc(String(val))}</div>
      ${sub ? `<div class="cc-kpi-sub">${esc(String(sub))}</div>` : ''}
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

    const col = tl.color || 'gray';
    const accentColor = COLORS[col];

    const convStr = t.conversion_pct != null
      ? t.won + ' выигр · ' + t.conversion_pct + '%'
      : (t.won || 0) + ' выигр';

    const lastContact = d.last_contact
      ? new Date(d.last_contact).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: '2-digit' })
      : '—';

    const statusRows = (t.by_status || []).slice(0, 6).map(s =>
      `<tr>
        <td style="padding:2px 6px">${esc(s.tender_status)}</td>
        <td style="text-align:right;padding:2px 6px">${s.cnt}</td>
        <td style="text-align:right;padding:2px 6px;color:var(--t3)">${fmt(s.sum)} ₽</td>
      </tr>`
    ).join('');

    return `
      <style>
        .cc-wrap{font-size:12px;line-height:1.4;font-family:inherit}
        .cc-head{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:10px}
        .cc-name{font-weight:700;font-size:14px;color:var(--text)}
        .cc-inn{font-size:10px;color:var(--t3);margin-top:2px}
        .cc-badge{text-align:right;flex-shrink:0}
        .cc-badge-pill{display:inline-block;padding:3px 10px;border-radius:12px;font-weight:600;font-size:11px}
        .cc-badge-reason{font-size:10px;color:var(--t3);margin-top:3px;max-width:180px;line-height:1.2}
        .cc-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:8px}
        .cc-grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:8px}
        .cc-kpi{background:var(--bg3,#f5f7fa);padding:7px 8px;border-radius:8px}
        .cc-kpi-label{font-size:9px;color:var(--t3);text-transform:uppercase;letter-spacing:.3px}
        .cc-kpi-val{font-weight:700;font-size:13px;color:var(--text);margin-top:2px}
        .cc-kpi-sub{font-size:9px;color:var(--t3);margin-top:1px}
        .cc-details summary{cursor:pointer;color:var(--t2);font-size:10px;padding:2px 0;user-select:none}
        .cc-details table{width:100%;border-collapse:collapse;margin-top:4px;font-size:10px}
        .cc-details tr:nth-child(even){background:var(--bg3,#f5f7fa)}
        @media(max-width:500px){.cc-grid{grid-template-columns:repeat(2,1fr)}.cc-grid3{grid-template-columns:repeat(2,1fr)}}
      </style>
      <div class="cc-wrap">
        <div class="cc-head">
          <div>
            <div class="cc-name">${esc(p.name || p.full_name || 'Контрагент')}</div>
            <div class="cc-inn">ИНН ${esc(p.inn || '')}${p.kpp ? ' · КПП ' + esc(p.kpp) : ''}</div>
          </div>
          <div class="cc-badge">
            <div class="cc-badge-pill" style="background:${accentColor}22;color:${accentColor}">
              ${EMOJI[col]} ${esc(tl.label || col)}
            </div>
            ${tl.reason ? `<div class="cc-badge-reason">${esc(tl.reason)}</div>` : ''}
          </div>
        </div>

        <div class="cc-grid">
          ${kpi('🎯', 'Тендеры', t.total || 0, convStr)}
          ${kpi('💰', 'Выиграно', fmt(t.won_sum) + ' ₽', 'в работе ' + fmt(t.in_work_sum) + ' ₽')}
          ${kpi('📩', 'Заявки', pt.total || 0, (pt.accepted || 0) + ' прин · ' + (pt.rejected || 0) + ' отказ')}
          ${kpi('📑', 'ТКП', k.total || 0, (k.accepted || 0) + '✓ · ' + (k.rejected || 0) + '✗ · ' + (k.awaiting || 0) + '⏳')}
        </div>

        <div class="cc-grid3">
          ${kpi('🛠', 'Работы', w.total || 0, (w.active || 0) + ' активн · ' + fmt(w.active_value) + ' ₽')}
          ${kpi('🧾', 'Задолженность', fmt(f.invoices_outstanding) + ' ₽', (f.overdue_invoices_cnt || 0) + ' просроч.')}
          ${kpi('📅', 'Контакт', lastContact, '')}
        </div>

        ${statusRows ? `
          <details class="cc-details">
            <summary>📊 Разбивка по статусам тендеров</summary>
            <table>${statusRows}</table>
          </details>` : ''}
      </div>`;
  }

  /**
   * Монтировать карточку контрагента в DOM-контейнер.
   * @param {Element} container  Куда рендерить
   * @param {string}  inn        ИНН контрагента
   * @param {object}  [opts]     Доп. опции (пока не используются)
   */
  async function mount(container, inn, opts) {
    if (!container) return;
    const cleanInn = String(inn || '').replace(/\D/g, '');
    if (cleanInn.length !== 10 && cleanInn.length !== 12) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = '<div style="color:var(--t3);font-size:12px;padding:8px">Загрузка данных контрагента…</div>';

    try {
      const auth = window.AsgardAuth ? await AsgardAuth.getAuth() : {};
      const token = auth.token || localStorage.getItem('asgard_token') || '';
      const r = await fetch('/api/customers/' + cleanInn + '/dashboard', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      container.innerHTML = renderHtml(d);
    } catch (e) {
      container.innerHTML = '<div style="color:var(--t3);font-size:11px;padding:8px">Не удалось загрузить данные контрагента</div>';
    }
  }

  /**
   * Рендеринг из уже загруженных данных (без HTTP-запроса).
   * Используется когда данные уже есть (e.g. из tkp-quick сессии).
   */
  function mountFromData(container, data) {
    if (!container || !data) return;
    container.innerHTML = renderHtml(data);
  }

  return { mount, mountFromData };
})();
