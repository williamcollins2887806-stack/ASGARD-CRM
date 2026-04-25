/**
 * AsgardGamificationLeaderboard — Worker Leaderboard & Tournament for PM/Director
 * ═══════════════════════════════════════════════════════════════════════════════
 * Route: #/gamification-leaderboard
 * Roles: PM, HEAD_PM, DIRECTOR_*, ADMIN, HR
 * API: GET /api/gamification/admin/leaderboard
 */
window.AsgardGamificationLeaderboard = (function () {
  'use strict';

  const { $, esc, toast } = AsgardUI;

  function hdr() {
    const t = localStorage.getItem('asgard_token') || localStorage.getItem('auth_token');
    return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
  }
  async function api(path) {
    const r = await fetch('/api/gamification/admin' + path, { headers: hdr() });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  /* ── Rank colors ── */
  const RANK_COLORS = {
    'Трэль': '#9ca3af', 'Карл': '#a78bfa', 'Хускарл': '#60a5fa',
    'Дружинник': '#34d399', 'Витязь': '#f97316', 'Ярл': '#D4A843', 'Конунг': '#ef4444',
  };

  function fmt(n) { return (parseInt(n)||0).toLocaleString('ru-RU'); }

  /* ── Animated counter ── */
  function animateCounter(el, target, ms = 1200) {
    let start = null;
    const to = parseInt(target) || 0;
    function step(ts) {
      if (!start) start = ts;
      const p = Math.min((ts - start) / ms, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(to * eased).toLocaleString('ru-RU');
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* ── Render ── */
  async function render({ layout, title }) {
    layout.innerHTML = `
<style>
@keyframes gl-gold-pulse { 0%,100%{box-shadow:0 0 10px rgba(212,168,67,.35)} 50%{box-shadow:0 0 22px rgba(212,168,67,.65)} }
@keyframes gl-row-in    { from{transform:translateX(-12px);opacity:0} to{transform:translateX(0);opacity:1} }
@keyframes gl-fire      { 0%,100%{transform:translateY(0);opacity:.9} 50%{transform:translateY(-6px);opacity:.4} }
@keyframes gl-champion  { 0%,100%{text-shadow:0 0 8px #FFD700} 50%{text-shadow:0 0 20px #FFD700,0 0 40px #fbbf24} }
.gl-wrap  { max-width:1200px;margin:0 auto;padding:24px 16px }
.gl-card  { background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:20px }
.gl-tab   { padding:8px 20px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;border:none;transition:all .2s }
.gl-tab.active{ background:#D4A843;color:#000 }
.gl-tab:not(.active){ background:rgba(255,255,255,.06);color:#9ca3af }
.gl-sort  { padding:6px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid;transition:all .2s }
.gl-row   { display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:12px;animation:gl-row-in .3s ease both }
.gl-row:hover { background:rgba(255,255,255,.04) }
.gl-row.self  { background:rgba(212,168,67,.08);border:1.5px solid #D4A84355 }
.gl-row.top1  { animation:gl-gold-pulse 2.5s infinite }
.gl-avatar{ width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;flex-shrink:0 }
.gl-bar   { height:6px;border-radius:4px;background:rgba(255,255,255,.06);overflow:hidden;margin-top:4px }
.gl-bar-fill{ height:100%;border-radius:4px;transition:width 1.2s ease }
.gl-match { border:1px solid rgba(255,255,255,.08);border-radius:8px;overflow:hidden;min-width:120px;background:rgba(255,255,255,.025) }
.gl-match-row { display:flex;align-items:center;justify-content:space-between;padding:6px 10px;gap:8px }
.gl-match-row.winner { background:rgba(212,168,67,.12);border-left:2px solid #D4A843 }
.gl-podium{ display:flex;align-items:flex-end;gap:12px;justify-content:center;padding:20px 0 0 }
</style>
<div class="gl-wrap">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;flex-wrap:wrap">
    <div style="font-size:24px">🏆</div>
    <div style="flex:1">
      <h1 style="font-size:22px;font-weight:800;color:#D4A843;margin:0">Зал Одина — Рейтинг рабочих</h1>
      <p id="gl-subtitle" style="font-size:13px;color:#6b7280;margin:4px 0 0">Загрузка…</p>
    </div>
    <div style="display:flex;gap:6px">
      <button class="gl-tab active" data-tab="rating">⚔️ Рейтинг</button>
      <button class="gl-tab" data-tab="tournament">🏆 Турнир</button>
    </div>
  </div>

  <!-- Summary cards -->
  <div id="gl-summary" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:20px"></div>

  <!-- Rating tab -->
  <div id="gl-tab-rating">
    <!-- Sort controls -->
    <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
      <span style="font-size:12px;color:#6b7280;align-self:center">Сортировка:</span>
      <button class="gl-sort active-sort" data-sort="runes" style="color:#D4A843;border-color:#D4A84355;background:rgba(212,168,67,.1)">ᚱ Руны</button>
      <button class="gl-sort" data-sort="xp"    style="color:#9ca3af;border-color:rgba(255,255,255,.1);background:transparent">⚡ XP</button>
      <button class="gl-sort" data-sort="shifts" style="color:#9ca3af;border-color:rgba(255,255,255,.1);background:transparent">📅 Смены</button>
      <button class="gl-sort" data-sort="monthly" style="color:#9ca3af;border-color:rgba(255,255,255,.1);background:transparent">📆 За месяц</button>
    </div>

    <!-- Podium -->
    <div class="gl-card" style="margin-bottom:16px">
      <div style="font-size:11px;color:rgba(212,168,67,.5);text-align:center;letter-spacing:3px;margin-bottom:12px">— ВАЛГАЛЛА —</div>
      <div class="gl-podium" id="gl-podium"></div>
    </div>

    <!-- Table -->
    <div class="gl-card">
      <div id="gl-table"></div>
    </div>
  </div>

  <!-- Tournament tab -->
  <div id="gl-tab-tournament" style="display:none">
    <div class="gl-card" id="gl-tournament"></div>
  </div>
</div>`;

    /* ── Tab switching ── */
    layout.querySelectorAll('.gl-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        layout.querySelectorAll('.gl-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const t = btn.dataset.tab;
        $('gl-tab-rating', layout).style.display = t === 'rating' ? '' : 'none';
        $('gl-tab-tournament', layout).style.display = t === 'tournament' ? '' : 'none';
      });
    });

    /* ── Load data ── */
    let data;
    try {
      data = await api('/leaderboard');
    } catch (e) {
      layout.querySelector('#gl-subtitle').innerHTML = `<span style="color:#ef4444">Ошибка: ${esc(String(e))}</span>`;
      return;
    }

    const { leaderboard = [], tournament } = data;
    let sortBy = 'runes';
    const maxRunes = parseInt(leaderboard[0]?.earned_runes) || 1;
    const totalRunes = leaderboard.reduce((s, p) => s + (parseInt(p.earned_runes)||0), 0);
    const totalXp    = leaderboard.reduce((s, p) => s + (parseInt(p.earned_xp)||0), 0);
    const totalShifts = leaderboard.reduce((s, p) => s + (parseInt(p.total_shifts)||0), 0);

    /* ── Subtitle ── */
    layout.querySelector('#gl-subtitle').textContent = `${leaderboard.length} воинов · ${fmt(totalRunes)} ᚱ суммарно заработано`;

    /* ── Summary cards ── */
    const summaryEl = layout.querySelector('#gl-summary');
    const summaryItems = [
      { icon: '⚔️', label: 'Воинов',   val: leaderboard.length, color: '#D4A843', counter: false },
      { icon: 'ᚱ',   label: 'Рун выдано', val: totalRunes, color: '#D4A843', counter: true },
      { icon: '⚡',  label: 'XP суммарно', val: totalXp, color: '#a855f7', counter: true },
      { icon: '📅',  label: 'Смен всего',  val: totalShifts, color: '#60a5fa', counter: true },
      { icon: '🔥',  label: 'Лидер месяца', val: (leaderboard[0]?.fio||'').split(' ')[0], color: '#f97316', counter: false },
    ];
    summaryEl.innerHTML = summaryItems.map((s, i) => `
      <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:14px;text-align:center">
        <div style="font-size:20px">${esc(String(s.icon))}</div>
        <div id="gl-sum-${i}" style="font-size:18px;font-weight:800;color:${s.color};margin:4px 0">${s.counter ? '0' : esc(String(s.val))}</div>
        <div style="font-size:11px;color:#6b7280">${esc(s.label)}</div>
      </div>
    `).join('');
    // Animate counters
    summaryItems.forEach((s, i) => {
      if (s.counter) animateCounter(layout.querySelector(`#gl-sum-${i}`), s.val);
    });

    /* ── Podium ── */
    function renderPodium() {
      const sorted = getSorted();
      const top3 = sorted.slice(0, 3);
      const podiumEl = layout.querySelector('#gl-podium');
      const order = [top3[1], top3[0], top3[2]]; // 2-1-3 layout
      const ranks = [2, 1, 3];
      const HEIGHTS = { 1: 130, 2: 105, 3: 88 };
      const COLORS  = { 1: '#FFD700', 2: '#C0C0C0', 3: '#CD7F32' };
      const MEDALS  = { 1: '👑', 2: '🥈', 3: '🥉' };

      podiumEl.innerHTML = order.map((p, i) => {
        if (!p) return '<div style="flex:1"></div>';
        const rank = ranks[i];
        const c = COLORS[rank];
        const parts = (p.fio||'').trim().split(' ');
        const initials = parts.map(w=>w[0]||'').join('').slice(0,2).toUpperCase();
        const firstName = parts[0]||'?';
        const statVal = sortBy === 'xp' ? fmt(p.earned_xp) + ' XP' : sortBy === 'shifts' ? fmt(p.total_shifts) + ' смен' : fmt(p.earned_runes) + ' ᚱ';
        const rt = p.rank_title || {};
        return `
          <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:8px;min-height:${HEIGHTS[rank]}px;justify-content:flex-end">
            <div style="font-size:${rank===1?24:18}px;${rank===1?'animation:lb-crown-bob 2s ease-in-out infinite':''}">${MEDALS[rank]}</div>
            <div style="width:${rank===1?52:42}px;height:${rank===1?52:42}px;border-radius:50%;
              background:linear-gradient(135deg,${c},${c}99);color:#000;
              display:flex;align-items:center;justify-content:center;font-size:${rank===1?18:14}px;font-weight:800;
              border:2px solid ${c};box-shadow:0 0 14px ${c}66">
              ${esc(initials)}
            </div>
            <div style="text-align:center;background:${c}18;border:1.5px solid ${c}44;border-radius:10px;padding:8px 10px;width:100%;
              ${rank===1?'animation:gl-gold-pulse 2.5s ease-in-out infinite':''}">
              <div style="font-size:12px;font-weight:700;color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(firstName)}</div>
              <div style="font-size:14px;font-weight:800;color:${c};margin:3px 0">${esc(statVal)}</div>
              <div style="font-size:10px;color:${rt.color||'#9ca3af'};background:${rt.color||'#9ca3af'}22;border-radius:5px;padding:1px 6px;display:inline-block">${esc(rt.icon||'')} ${esc(rt.title||'')}</div>
            </div>
            <div style="width:85%;height:${rank===1?18:rank===2?12:8}px;border-radius:6px 6px 0 0;
              background:linear-gradient(180deg,${c}88,${c}33);border:1px solid ${c}55"></div>
          </div>
        `;
      }).join('');
    }

    /* ── Table ── */
    function getSorted() {
      return [...leaderboard].sort((a, b) => {
        if (sortBy === 'xp')      return parseInt(b.earned_xp) - parseInt(a.earned_xp);
        if (sortBy === 'shifts')  return parseInt(b.total_shifts) - parseInt(a.total_shifts);
        if (sortBy === 'monthly') return parseInt(b.monthly_runes) - parseInt(a.monthly_runes);
        return parseInt(b.earned_runes) - parseInt(a.earned_runes);
      });
    }

    function renderTable() {
      const sorted = getSorted();
      const maxVal = sortBy === 'xp'  ? (parseInt(sorted[0]?.earned_xp)||1)
                   : sortBy==='shifts' ? (parseInt(sorted[0]?.total_shifts)||1)
                   : sortBy==='monthly'? (parseInt(sorted[0]?.monthly_runes)||1)
                   : (parseInt(sorted[0]?.earned_runes)||1);
      const MEDALS = {1:'🥇',2:'🥈',3:'🥉'};
      const tableEl = layout.querySelector('#gl-table');

      tableEl.innerHTML = `
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="color:#6b7280;font-size:11px;font-weight:700;border-bottom:1px solid rgba(255,255,255,.07)">
              <th style="text-align:left;padding:8px 0 8px 6px;width:36px">#</th>
              <th style="text-align:left;padding:8px 0">Воин</th>
              <th style="text-align:right;padding:8px 4px">ᚱ Всего</th>
              <th style="text-align:right;padding:8px 4px">ᚱ Месяц</th>
              <th style="text-align:right;padding:8px 4px">XP</th>
              <th style="text-align:right;padding:8px 6px">Смен</th>
            </tr>
          </thead>
          <tbody>
            ${sorted.map((p, i) => {
              const rank = i + 1;
              const isTop3 = rank <= 3;
              const rt = p.rank_title || {};
              const rc = RANK_COLORS[rt.title] || '#9ca3af';
              const parts = (p.fio||'').trim().split(' ');
              const initials = parts.map(w=>w[0]||'').join('').slice(0,2).toUpperCase();
              const val = sortBy==='xp' ? parseInt(p.earned_xp)
                        : sortBy==='shifts' ? parseInt(p.total_shifts)
                        : sortBy==='monthly' ? parseInt(p.monthly_runes)
                        : parseInt(p.earned_runes);
              const pct = Math.round((val / maxVal) * 100);
              return `
                <tr class="gl-row${isTop3 ? (rank===1?' top1':'') : ''}" style="animation-delay:${i*0.03}s;border-bottom:1px solid rgba(255,255,255,.04)">
                  <td style="padding:10px 0 10px 6px;font-size:${isTop3?18:12}px;font-weight:700;color:#6b7280;text-align:center">
                    ${isTop3 ? MEDALS[rank] : '#'+rank}
                  </td>
                  <td style="padding:10px 4px">
                    <div style="display:flex;align-items:center;gap:10px">
                      <div class="gl-avatar" style="background:${isTop3?'linear-gradient(135deg,'+['#FFD700','#C0C0C0','#CD7F32'][rank-1]+','+['#FFD700','#C0C0C0','#CD7F32'][rank-1]+'99)':'rgba(255,255,255,.06)'};color:${isTop3?'#000':'#9ca3af'};border:1px solid ${isTop3?['#FFD700','#C0C0C0','#CD7F32'][rank-1]:'rgba(255,255,255,.1)'}">
                        ${esc(initials)}
                      </div>
                      <div style="flex:1;min-width:0">
                        <div style="font-weight:700;color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px">${esc(p.fio||'')}</div>
                        <div style="display:flex;align-items:center;gap:6px;margin-top:2px;flex-wrap:wrap">
                          <span style="font-size:10px;color:${rc};background:${rc}22;border:1px solid ${rc}44;border-radius:5px;padding:1px 6px">${esc(rt.icon||'')} ${esc(rt.title||'')}</span>
                          <span style="font-size:10px;color:#6b7280">Ур.${esc(String(p.level||1))}</span>
                          ${p.streak > 0 ? `<span style="font-size:10px;color:#f97316">🔥 ${esc(String(p.streak))}</span>` : ''}
                        </div>
                        <div class="gl-bar" style="max-width:160px">
                          <div class="gl-bar-fill" style="width:${pct}%;background:linear-gradient(90deg,#D4A843,#f59e0b)"></div>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td style="text-align:right;padding:10px 4px;font-weight:800;color:#D4A843;white-space:nowrap">${fmt(p.earned_runes)} ᚱ</td>
                  <td style="text-align:right;padding:10px 4px;font-weight:600;color:#f97316;white-space:nowrap">${fmt(p.monthly_runes)} ᚱ</td>
                  <td style="text-align:right;padding:10px 4px;font-weight:600;color:#a855f7;white-space:nowrap">${fmt(p.earned_xp)} XP</td>
                  <td style="text-align:right;padding:10px 6px;color:#60a5fa;white-space:nowrap">${fmt(p.total_shifts)}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      `;
    }

    /* ── Sort controls ── */
    layout.querySelectorAll('.gl-sort').forEach(btn => {
      btn.addEventListener('click', () => {
        sortBy = btn.dataset.sort;
        layout.querySelectorAll('.gl-sort').forEach(b => {
          b.style.color = '#9ca3af';
          b.style.borderColor = 'rgba(255,255,255,.1)';
          b.style.background = 'transparent';
        });
        btn.style.color = '#D4A843';
        btn.style.borderColor = '#D4A84355';
        btn.style.background = 'rgba(212,168,67,.1)';
        renderPodium();
        renderTable();
      });
    });

    /* ── Tournament ── */
    function renderTournament() {
      const tEl = layout.querySelector('#gl-tournament');
      if (!tournament) {
        tEl.innerHTML = '<p style="color:#6b7280;text-align:center;padding:40px">Недостаточно данных для турнира</p>';
        return;
      }
      const { month, week, rounds, champion } = tournament;
      const ROUND_LABELS = ['1/8 финала','Четвертьфинал','Полуфинал','Финал'];

      tEl.innerHTML = `
        <div style="text-align:center;margin-bottom:20px">
          <div style="font-size:20px;font-weight:800;color:#D4A843;animation:gl-champion 3s ease-in-out infinite">⚔️ Битва за Вальхаллу</div>
          <div style="font-size:13px;color:#6b7280;margin-top:4px">${esc(month)} · Неделя ${week}/4</div>
          ${champion ? `<div style="margin-top:8px;font-size:14px;color:#D4A843;font-weight:700">👑 Текущий лидер: ${esc(champion.name)} (${fmt(champion.monthly_runes)}ᚱ за месяц)</div>` : ''}
        </div>
        <div style="overflow-x:auto;padding-bottom:8px">
          <div style="display:flex;gap:0;min-width:max-content">
            ${rounds.map((round, ri) => `
              <div style="display:flex;flex-direction:column">
                <div style="text-align:center;font-size:10px;font-weight:700;color:#6b7280;padding:0 8px;margin-bottom:8px;text-transform:uppercase;letter-spacing:1px">${ROUND_LABELS[ri]}</div>
                <div style="display:flex;flex-direction:column;justify-content:space-around;flex:1;gap:${ri===0?8:ri===1?24:ri===2?48:96}px;padding:0 4px">
                  ${round.map(match => {
                    if (!match) return '';
                    const { p1, p2, winner_id } = match;
                    function pLine(p, side) {
                      if (!p) return `<div class="gl-match-row" style="color:#4b5563;font-size:11px;font-style:italic">TBD</div>`;
                      const isW = winner_id === p.employee_id;
                      return `
                        <div class="gl-match-row${isW?' winner':''}">
                          <span style="font-size:11px;font-weight:${isW?800:500};color:${isW?'#D4A843':'#9ca3af'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:90px">${esc(p.name||'?')}</span>
                          <span style="font-size:10px;color:${isW?'#D4A843':'#6b7280'};font-weight:700;flex-shrink:0">${fmt(p.monthly_runes)}ᚱ</span>
                        </div>
                      `;
                    }
                    return `
                      <div style="display:flex;align-items:center;gap:2px">
                        <div class="gl-match">
                          ${pLine(p1)}
                          <div style="height:1px;background:rgba(255,255,255,.06)"></div>
                          ${pLine(p2)}
                        </div>
                        ${ri < rounds.length-1 ? '<div style="color:#374151;font-size:12px;padding:0 2px">→</div>' : ''}
                      </div>
                    `;
                  }).join('')}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
        <p style="font-size:11px;color:#4b5563;text-align:center;margin-top:12px">Лидер каждого матча — по рунам за текущий месяц</p>
      `;
    }

    renderPodium();
    renderTable();
    renderTournament();
  }

  return { render };
})();
