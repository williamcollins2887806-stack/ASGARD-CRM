/**
 * AsgardPmBalancePage — Баланс РП (наличные на руках)
 * ======================================================
 * Routes:
 *   #/pm-balance        → render()       — сводная таблица всех РП
 *   #/pm-balance/:pm_id → renderDetail() — детальная расшифровка одного РП
 *
 * Roles: ADMIN, DIRECTOR_GEN, DIRECTOR_COMM, BUH
 *
 * API:
 *   GET /api/payroll-dashboard/pm-balance
 *   GET /api/payroll-dashboard/pm-balance/:pm_id
 */
window.AsgardPmBalancePage = (function () {
  'use strict';

  const { $, $$, esc, toast } = AsgardUI;

  const ALLOWED = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'BUH'];

  /* ── one-time CSS injection ──────────────────────────────────────────── */
  (function injectStyles() {
    if (document.getElementById('pmb-styles')) return;
    const s = document.createElement('style');
    s.id = 'pmb-styles';
    s.textContent = `.pmb-hover-row:hover td { background: var(--bg2); }
      .pmb-row:hover td { background: var(--bg2); }`;
    document.head.appendChild(s);
  })();

  /* ── helpers ────────────────────────────────────────────────────────── */

  function getToken() {
    return localStorage.getItem('asgard_token') || localStorage.getItem('auth_token') || '';
  }

  async function apiFetch(path, token) {
    const r = await fetch(path, {
      headers: { Authorization: 'Bearer ' + (token || getToken()) },
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.message || e.error || 'HTTP ' + r.status);
    }
    return r.json();
  }

  const rub = n => new Intl.NumberFormat('ru-RU', {
    style: 'currency', currency: 'RUB', maximumFractionDigits: 0,
  }).format(n || 0);

  const fmtDate = s => s ? new Date(s).toLocaleDateString('ru-RU') : '—';

  function balanceColor(n) {
    if (n > 0) return 'var(--ok-t)';
    if (n < 0) return 'var(--err-t)';
    return 'var(--t2)';
  }

  function statCard(label, value, bgVar, colorVar) {
    return `
      <div style="padding:12px 18px;background:${bgVar};border-radius:var(--r-md);min-width:140px;">
        <div style="font-size:11px;color:${colorVar};opacity:.75;font-weight:500;
                    text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px;">
          ${label}
        </div>
        <div style="font-size:18px;font-weight:700;color:${colorVar};">${value}</div>
      </div>`;
  }

  /* ── month filter ───────────────────────────────────────────────────── */

  function buildMonthOptions(selectedValue) {
    const now   = new Date();
    const opts  = ['<option value="">Все месяцы</option>'];
    for (let i = 0; i < 12; i++) {
      const d   = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const lbl = d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
      const sel = val === selectedValue ? ' selected' : '';
      opts.push(`<option value="${val}"${sel}>${esc(lbl)}</option>`);
    }
    return opts.join('');
  }

  /* ══════════════════════════════════════════════════════════════════════
     LIST VIEW — render()
  ══════════════════════════════════════════════════════════════════════ */

  function buildListTable(rows, filterMonth) {
    /* client-side month filter if server doesn't filter */
    let list = rows;
    if (filterMonth) {
      list = rows.filter(pm => {
        /* keep rows that have any activity in the selected month */
        if (pm.last_activity) {
          return pm.last_activity.slice(0, 7) === filterMonth;
        }
        return true; /* no date — always show */
      });
    }

    if (!list.length) {
      return `<p style="text-align:center;padding:48px;color:var(--t3);font-size:14px;">
                Нет данных по балансу РП
              </p>`;
    }

    const th = label => `
      <th style="padding:10px 14px;text-align:left;color:var(--t2);font-size:13px;
                 font-weight:600;white-space:nowrap;border-bottom:2px solid var(--brd);">
        ${label}
      </th>`;

    const theads = ['РП', 'Получил из кассы', 'Получил от СЗ', 'Потратил', 'Вернул', 'На руках']
      .map(th).join('');

    const tbodies = list.map(pm => {
      const bal      = pm.balance || 0;
      const bColor   = balanceColor(bal);
      const name     = pm.pm_name || pm.name || '—';
      return `
        <tr class="pmb-row" data-pm="${pm.pm_id || pm.id}"
            style="border-bottom:1px solid var(--brd);cursor:pointer;transition:background .12s;"
            title="Открыть детали по ${esc(name)}">
          <td style="padding:10px 14px;color:var(--t1);font-weight:500;">${esc(name)}</td>
          <td style="padding:10px 14px;color:var(--t2);">${rub(pm.cash_in)}</td>
          <td style="padding:10px 14px;color:var(--t2);">${rub(pm.se_cash_in)}</td>
          <td style="padding:10px 14px;color:var(--t2);">${rub(pm.cash_out)}</td>
          <td style="padding:10px 14px;color:var(--t2);">${rub(pm.cash_returned)}</td>
          <td style="padding:10px 14px;font-weight:700;font-size:15px;color:${bColor};">
            ${rub(bal)}
          </td>
        </tr>`;
    }).join('');

    /* totals */
    const totalIn      = list.reduce((s, p) => s + (p.cash_in    || 0), 0);
    const totalSeIn    = list.reduce((s, p) => s + (p.se_cash_in || 0), 0);
    const totalOut     = list.reduce((s, p) => s + (p.cash_out   || 0), 0);
    const totalReturn  = list.reduce((s, p) => s + (p.cash_returned || 0), 0);
    const totalBal     = list.reduce((s, p) => s + (p.balance    || 0), 0);
    const tColor       = balanceColor(totalBal);

    const tfoot = `
      <tfoot>
        <tr style="background:var(--bg2);border-top:2px solid var(--brd);">
          <td style="padding:10px 14px;color:var(--t1);font-weight:700;">Итого (${list.length} РП)</td>
          <td style="padding:10px 14px;color:var(--t1);font-weight:600;">${rub(totalIn)}</td>
          <td style="padding:10px 14px;color:var(--t1);font-weight:600;">${rub(totalSeIn)}</td>
          <td style="padding:10px 14px;color:var(--t1);font-weight:600;">${rub(totalOut)}</td>
          <td style="padding:10px 14px;color:var(--t1);font-weight:600;">${rub(totalReturn)}</td>
          <td style="padding:10px 14px;font-weight:800;font-size:15px;color:${tColor};">${rub(totalBal)}</td>
        </tr>
      </tfoot>`;

    return `
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr style="background:var(--bg2);">${theads}</tr></thead>
          <tbody>${tbodies}</tbody>
          ${tfoot}
        </table>
      </div>`;
  }

  async function render({ layout, title }) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = '#/login'; return; }
    const user  = auth.user;
    const token = auth.token || getToken();

    if (!ALLOWED.includes(user.role)) {
      toast('Доступ', 'Недостаточно прав', 'err');
      location.hash = '#/home';
      return;
    }

    const html = `
      <div class="panel">
        <div style="display:flex;align-items:center;justify-content:space-between;
                    margin-bottom:12px;flex-wrap:wrap;gap:10px;">
          <div class="help">
            Сколько наличных на руках у каждого РП прямо сейчас.
            Кликните на строку для детальной расшифровки.
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            <select id="pmb_month"
              style="padding:7px 10px;border:1px solid var(--brd);border-radius:var(--r-sm);
                     background:var(--bg2);color:var(--t2);font-size:13px;cursor:pointer;">
              ${buildMonthOptions('')}
            </select>
            <button class="btn ghost" id="pmb_refresh">🔄 Обновить</button>
          </div>
        </div>

        <div id="pmb_stats"
             style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;"></div>

        <div id="pmb_table_wrap"
             style="background:var(--bg1);border:1px solid var(--brd);
                    border-radius:var(--r-md);overflow:hidden;">
        </div>
      </div>`;

    await layout(html, { title: title || 'Баланс РП' });

    let _allData = [];

    function renderFiltered() {
      const month  = $('#pmb_month').value;
      const wrap   = $('#pmb_table_wrap');
      wrap.innerHTML = buildListTable(_allData, month);

      $$('.pmb-row').forEach(tr => {
        tr.addEventListener('mouseenter', () => { tr.style.background = 'var(--bg2)'; });
        tr.addEventListener('mouseleave', () => { tr.style.background = ''; });
        tr.addEventListener('click', () => {
          location.hash = `#/pm-balance/${tr.dataset.pm}`;
        });
      });
    }

    async function load() {
      $('#pmb_table_wrap').innerHTML =
        `<p style="text-align:center;padding:36px;color:var(--t3);">Загрузка…</p>`;
      try {
        const res  = await apiFetch('/api/payroll-dashboard/pm-balance', token);
        _allData   = res.balances || (Array.isArray(res) ? res : []);

        /* stats bar */
        const totalBal = _allData.reduce((s, p) => s + (p.balance || 0), 0);
        const totalIn  = _allData.reduce((s, p) => s + (p.cash_in || 0) + (p.se_cash_in || 0), 0);
        const totalOut = _allData.reduce((s, p) => s + (p.cash_out || 0), 0);
        const negative = _allData.filter(p => (p.balance || 0) < 0).length;

        const statsEl = $('#pmb_stats');
        if (statsEl) {
          statsEl.innerHTML =
            statCard('Всего получено',  rub(totalIn),  'var(--ok-bg)',   'var(--ok-t)') +
            statCard('Потрачено',       rub(totalOut), 'var(--warn-bg)', 'var(--warn-t)') +
            statCard('На руках итого',  rub(totalBal), totalBal >= 0 ? 'var(--ok-bg)'  : 'var(--err-bg)',
                                                                       totalBal >= 0 ? 'var(--ok-t)'   : 'var(--err-t)') +
            (negative ? statCard('В минусе РП', negative, 'var(--err-bg)', 'var(--err-t)') : '');
        }

        renderFiltered();
      } catch (e) {
        $('#pmb_table_wrap').innerHTML = `
          <p style="text-align:center;padding:36px;color:var(--err-t);">
            Ошибка загрузки: ${esc(e.message)}
          </p>`;
      }
    }

    $('#pmb_refresh').addEventListener('click', load);
    $('#pmb_month').addEventListener('change', renderFiltered);
    await load();
  }

  /* ══════════════════════════════════════════════════════════════════════
     DETAIL VIEW — renderDetail()
  ══════════════════════════════════════════════════════════════════════ */

  function sectionTable(heading, rows, columns, accentColor) {
    const colCount = columns.length;

    if (!rows || !rows.length) {
      return `
        <div style="margin-bottom:24px;">
          <h3 style="color:var(--t1);font-size:15px;font-weight:600;
                     margin:0 0 10px;padding-bottom:8px;
                     border-bottom:2px solid ${accentColor || 'var(--brd)'};">
            ${heading}
          </h3>
          <p style="color:var(--t3);font-size:13px;padding:10px 0;">
            Нет операций
          </p>
        </div>`;
    }

    const totalAmount = rows.reduce((s, r) => {
      const amountCol = columns.find(c => c.type === 'money');
      return s + (amountCol ? (r[amountCol.key] || 0) : 0);
    }, 0);

    const th = c => `
      <th style="padding:9px 12px;text-align:left;color:var(--t2);font-size:12px;
                 font-weight:600;white-space:nowrap;border-bottom:1px solid var(--brd);">
        ${c.label}
      </th>`;

    const td = (r, c) => {
      if (c.type === 'money') {
        const n = r[c.key] || 0;
        return `<td style="padding:8px 12px;font-weight:600;color:var(--t1);">${rub(n)}</td>`;
      }
      if (c.type === 'date') {
        return `<td style="padding:8px 12px;color:var(--t2);white-space:nowrap;">${fmtDate(r[c.key])}</td>`;
      }
      return `<td style="padding:8px 12px;color:var(--t2);">${esc(String(r[c.key] || '—'))}</td>`;
    };

    return `
      <div style="margin-bottom:24px;">
        <div style="display:flex;align-items:center;justify-content:space-between;
                    margin-bottom:10px;padding-bottom:8px;
                    border-bottom:2px solid ${accentColor || 'var(--brd)'};">
          <h3 style="color:var(--t1);font-size:15px;font-weight:600;margin:0;">
            ${heading}
          </h3>
          <span style="font-size:14px;font-weight:700;color:${accentColor || 'var(--t1)'};">
            ${rub(totalAmount)}
          </span>
        </div>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;">
            <thead>
              <tr style="background:var(--bg2);">
                ${columns.map(th).join('')}
              </tr>
            </thead>
            <tbody>
              ${rows.map(r => `
                <tr style="border-bottom:1px solid var(--brd);transition:background .1s;"
                    class="pmb-hover-row">
                  ${columns.map(c => td(r, c)).join('')}
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  async function renderDetail({ layout, title }) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = '#/login'; return; }
    const user  = auth.user;
    const token = auth.token || getToken();

    if (!ALLOWED.includes(user.role)) {
      toast('Доступ', 'Недостаточно прав', 'err');
      location.hash = '#/home';
      return;
    }

    /* parse pm_id from hash: #/pm-balance/123 */
    const pmId = location.hash.split('/').pop();
    if (!pmId || isNaN(Number(pmId))) {
      toast('Ошибка', 'ID РП не указан', 'err');
      location.hash = '#/pm-balance';
      return;
    }

    const html = `
      <div class="panel">
        <div style="margin-bottom:16px;">
          <button class="btn ghost" id="pmbd_back">← Назад к списку</button>
        </div>
        <div id="pmbd_loading" style="text-align:center;padding:48px;color:var(--t3);">
          Загрузка…
        </div>
        <div id="pmbd_content" style="display:none;"></div>
      </div>`;

    await layout(html, { title: title || 'Баланс РП' });

    $('#pmbd_back').addEventListener('click', () => { location.hash = '#/pm-balance'; });

    try {
      const data = await apiFetch(`/api/payroll-dashboard/pm-balance/${pmId}`, token);
      const bal  = data.balance || 0;
      const bColor = balanceColor(bal);
      const name   = data.pm_name || `РП #${pmId}`;

      const cashIn  = (data.cash_in   || 0);
      const seIn    = (data.se_cash_in || 0);
      const out     = (data.cash_out  || 0);
      const returned = (data.cash_returned || 0);

      const content = $('#pmbd_content');
      content.innerHTML = `
        <!-- Header with PM name and balance summary -->
        <div style="display:flex;align-items:flex-start;justify-content:space-between;
                    margin-bottom:20px;flex-wrap:wrap;gap:12px;">
          <div>
            <h2 style="margin:0 0 4px;color:var(--t1);font-size:20px;font-weight:700;">
              ${esc(name)}
            </h2>
            <p style="margin:0;font-size:13px;color:var(--t3);">Детальная расшифровка движения наличных</p>
          </div>
          <button class="btn ghost" id="pmbd_back2">← К списку</button>
        </div>

        <!-- Summary cards -->
        <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:24px;">
          ${statCard('Из кассы',       rub(cashIn),   'var(--ok-bg)',                     'var(--ok-t)')}
          ${statCard('От самозанятых', rub(seIn),     'var(--info-bg)',                   'var(--info-t)')}
          ${statCard('Потрачено',      rub(out),      'var(--warn-bg)',                   'var(--warn-t)')}
          ${statCard('Возвращено',     rub(returned), 'var(--bg2)',                       'var(--t2)')}
          ${statCard('На руках',       rub(bal),      bal >= 0 ? 'var(--ok-bg)'  : 'var(--err-bg)',
                                                                 bal >= 0 ? 'var(--ok-t)'   : 'var(--err-t)')}
        </div>

        <!-- 5 operational sections -->
        ${sectionTable(
          '💵 Получено из кассы',
          data.cash_requests || [],
          [
            { key: 'created_at',  type: 'date',  label: 'Дата'       },
            { key: 'amount',      type: 'money', label: 'Сумма'      },
            { key: 'purpose',               label: 'Назначение'  },
            { key: 'status',                label: 'Статус'      },
          ],
          'var(--ok-t)'
        )}

        ${sectionTable(
          '🔄 Получено от самозанятых',
          data.se_returns || data.se_transfer_returns || [],
          [
            { key: 'returned_at',          type: 'date',  label: 'Дата'        },
            { key: 'cash_return_amount',   type: 'money', label: 'Сумма'       },
            { key: 'employee_name',                        label: 'Рабочий'     },
            { key: 'comment',                              label: 'Комментарий' },
          ],
          'var(--info-t)'
        )}

        ${sectionTable(
          '💳 Выплаты наличкой',
          data.salary_payments || data.worker_payments || [],
          [
            { key: 'created_at',     type: 'date',  label: 'Дата'    },
            { key: 'amount',         type: 'money', label: 'Сумма'   },
            { key: 'employee_name',               label: 'Рабочий' },
            { key: 'type',                        label: 'Тип'     },
          ],
          'var(--warn-t)'
        )}

        ${sectionTable(
          '🧾 Расходы',
          data.expenses || data.cash_expenses || [],
          [
            { key: 'created_at',   type: 'date',  label: 'Дата'       },
            { key: 'amount',       type: 'money', label: 'Сумма'      },
            { key: 'description',               label: 'Описание'   },
          ],
          'var(--err-t)'
        )}

        ${sectionTable(
          '↩️ Возвраты в кассу',
          data.cash_returns || [],
          [
            { key: 'created_at', type: 'date',  label: 'Дата'        },
            { key: 'amount',     type: 'money', label: 'Сумма'       },
            { key: 'comment',                   label: 'Комментарий' },
          ],
          'var(--t2)'
        )}`;

      $('#pmbd_loading').style.display = 'none';
      content.style.display = '';

      /* second back button inside content */
      $('#pmbd_back2').addEventListener('click', () => { location.hash = '#/pm-balance'; });

    } catch (e) {
      $('#pmbd_loading').innerHTML = `
        <p style="color:var(--err-t);">Ошибка загрузки: ${esc(e.message)}</p>
        <button class="btn ghost" onclick="location.hash='#/pm-balance'">← Назад</button>`;
    }
  }

  return { render, renderDetail };
})();
