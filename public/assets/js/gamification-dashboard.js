/**
 * AsgardGamificationDashboard — Director's Gamification Overview
 * ═══════════════════════════════════════════════════════════════════
 * Route: #/gamification-dashboard
 * Roles: ADMIN, DIRECTOR_*, HR, HEAD_PM
 * API: GET /api/gamification/admin/dashboard
 */
window.AsgardGamificationDashboard = (function () {
  'use strict';

  const { $, $$, esc, toast, money } = AsgardUI;

  function hdr() {
    const t = localStorage.getItem('asgard_token') || localStorage.getItem('auth_token');
    return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
  }
  async function api(path) {
    const r = await fetch('/api/gamification/admin' + path, { headers: hdr() });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  async function render({ layout, title }) {
    layout.innerHTML = `<div style="max-width:1200px;margin:0 auto;padding:24px 16px">
      <h1 style="font-size:22px;font-weight:800;color:var(--gold,#D4A843);margin-bottom:4px">${esc(title)}</h1>
      <p style="font-size:13px;color:var(--t3,#888);margin-bottom:24px">Экономика и активность рабочих</p>
      <div id="gd-loading" style="text-align:center;padding:40px;color:var(--t3,#888)">Загрузка данных…</div>
      <div id="gd-content" style="display:none"></div>
    </div>`;

    let data;
    try {
      data = await api('/dashboard');
    } catch (e) {
      document.getElementById('gd-loading').innerHTML = '<span style="color:#ef4444">Ошибка: ' + esc(String(e)) + '</span>';
      return;
    }

    if (data.error) {
      document.getElementById('gd-loading').innerHTML = '<span style="color:#ef4444">' + esc(data.error) + '</span>';
      return;
    }

    document.getElementById('gd-loading').style.display = 'none';
    const content = document.getElementById('gd-content');
    content.style.display = '';

    const kpi = data.kpi || {};

    // ── KPI Cards ──
    const kpiRow = document.createElement('div');
    kpiRow.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:24px';
    [
      { icon: '💰', label: 'Монет в обращении', val: fmtNum(kpi.runes_in_circulation), color: '#F0C850', bg: 'rgba(240,200,80,.06)', border: 'rgba(240,200,80,.15)' },
      { icon: '🎰', label: 'Круток сегодня', val: kpi.spins_today, color: '#E84057', bg: 'rgba(232,64,87,.06)', border: 'rgba(232,64,87,.15)' },
      { icon: '🎁', label: 'Призов (30 дн)', val: kpi.prizes_delivered_month, color: '#22c55e', bg: 'rgba(34,197,94,.06)', border: 'rgba(34,197,94,.15)' },
      { icon: '👥', label: 'Активных (7 дн)', val: kpi.active_workers_7d, color: '#4A90FF', bg: 'rgba(74,144,255,.06)', border: 'rgba(74,144,255,.15)' },
    ].forEach(k => {
      const card = document.createElement('div');
      card.style.cssText = `padding:20px;border-radius:16px;background:${k.bg};border:1px solid ${k.border};transition:transform .2s`;
      card.innerHTML = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span style="font-size:24px">${k.icon}</span>
          <span style="font-size:11px;font-weight:600;color:${k.color};text-transform:uppercase;letter-spacing:.05em">${k.label}</span>
        </div>
        <div style="font-size:32px;font-weight:900;color:${k.color};font-variant-numeric:tabular-nums">${k.val ?? '—'}</div>`;
      kpiRow.appendChild(card);
    });
    content.appendChild(kpiRow);

    // ── Two-column layout ──
    const cols = document.createElement('div');
    cols.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px';

    // Top Prizes
    const topPrizes = data.top_prizes || [];
    const prizesCard = makeCard('🏆 Топ призов', topPrizes.length > 0
      ? '<table style="width:100%;font-size:12px">' + topPrizes.map((p, i) =>
        `<tr style="border-bottom:1px solid var(--brd,rgba(255,255,255,.04))">
          <td style="padding:6px 0;color:var(--t3,#888)">${i + 1}.</td>
          <td style="padding:6px 8px;color:var(--t1,#fff);font-weight:600">${esc(p.prize_name)}</td>
          <td style="padding:6px 0;text-align:right;color:var(--gold,#D4A843);font-weight:700">${p.cnt}x</td>
        </tr>`).join('') + '</table>'
      : '<div style="padding:20px;text-align:center;color:var(--t3,#888)">Нет данных</div>'
    );
    cols.appendChild(prizesCard);

    // Top Workers
    const topWorkers = data.top_workers || [];
    const workersCard = makeCard('⚔ Топ рабочих', topWorkers.length > 0
      ? '<table style="width:100%;font-size:12px">' + topWorkers.map((w, i) =>
        `<tr style="border-bottom:1px solid var(--brd,rgba(255,255,255,.04))">
          <td style="padding:6px 0;color:var(--t3,#888)">${i + 1}.</td>
          <td style="padding:6px 8px;color:var(--t1,#fff);font-weight:600">${esc(w.name)}</td>
          <td style="padding:6px 0;text-align:right;color:var(--gold,#D4A843);font-weight:700">${w.spins} спинов</td>
        </tr>`).join('') + '</table>'
      : '<div style="padding:20px;text-align:center;color:var(--t3,#888)">Нет данных</div>'
    );
    cols.appendChild(workersCard);
    content.appendChild(cols);

    // ── Recent Operations ──
    const recentOps = data.recent_operations || [];
    if (recentOps.length > 0) {
      const opsCard = makeCard('📜 Последние операции', '');
      const table = document.createElement('table');
      table.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px';
      table.innerHTML = `<thead><tr style="color:var(--t3,#888);border-bottom:1px solid var(--brd,rgba(255,255,255,.08))">
        <th style="text-align:left;padding:6px 8px">Время</th>
        <th style="text-align:left;padding:6px 8px">Рабочий</th>
        <th style="text-align:left;padding:6px 8px">Тип</th>
        <th style="text-align:right;padding:6px 8px">Сумма</th>
        <th style="text-align:left;padding:6px 8px">Операция</th>
      </tr></thead><tbody></tbody>`;
      const tbody = table.querySelector('tbody');
      recentOps.forEach(op => {
        const tr = document.createElement('tr');
        tr.style.cssText = 'border-bottom:1px solid var(--brd,rgba(255,255,255,.04))';
        const opColor = op.amount > 0 ? '#22c55e' : '#ef4444';
        const opLabel = { spin_win: '🎰 Спин', shop_buy: '🛍 Покупка', convert: '🔄 Конверт', quest_claim: '⚔ Квест' }[op.operation] || op.operation;
        tr.innerHTML = `<td style="padding:6px 8px;color:var(--t3,#888);white-space:nowrap">${new Date(op.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
          <td style="padding:6px 8px;color:var(--t1,#fff)">${esc(op.employee_name || '—')}</td>
          <td style="padding:6px 8px;color:var(--t2,#aaa)">${op.currency}</td>
          <td style="padding:6px 8px;text-align:right;color:${opColor};font-weight:700">${op.amount > 0 ? '+' : ''}${op.amount}</td>
          <td style="padding:6px 8px;color:var(--t3,#888)">${opLabel}</td>`;
        tbody.appendChild(tr);
      });
      opsCard.querySelector('.gd-card-body').appendChild(table);
      content.appendChild(opsCard);
    }
  }

  function makeCard(title, bodyHTML) {
    const card = document.createElement('div');
    card.style.cssText = 'border-radius:16px;background:var(--card,#141828);border:1px solid var(--brd,rgba(255,255,255,.06));overflow:hidden';
    card.innerHTML = `<div style="padding:12px 16px;border-bottom:1px solid var(--brd,rgba(255,255,255,.06));font-size:14px;font-weight:700;color:var(--t1,#fff)">${title}</div>
      <div class="gd-card-body" style="padding:12px 16px">${bodyHTML}</div>`;
    return card;
  }

  function fmtNum(n) {
    if (n == null) return '—';
    return Number(n).toLocaleString('ru-RU');
  }

  return { render };
})();
