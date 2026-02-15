/**
 * M16: Big Screen — Режим «Большой Экран»
 * Авто-ротация KPI-слайдов для офисного монитора
 */
window.AsgardBigScreen = (function(){
  const { esc } = AsgardUI;
  let intervalId = null;
  let clockId = null;
  let currentSlide = 0;

  function _m(n) {
    return new Intl.NumberFormat('ru-RU', {style:'currency', currency:'RUB', maximumFractionDigits:0}).format(n || 0);
  }
  function _short(x) {
    const n = Number(x) || 0;
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'М';
    if (n >= 1000) return (n / 1000).toFixed(0) + 'К';
    return n.toFixed(0);
  }
  function _pct(a, b) { return b ? Math.round((a / b) * 100) + '%' : '—'; }

  async function render({ layout, title }) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = "#/login"; return; }
    const user = auth.user;

    // Big Screen доступен директорам и админу
    const allowed = ['ADMIN','DIRECTOR_COMM','DIRECTOR_GEN','DIRECTOR_DEV','HEAD_TO','HEAD_PM'];
    if (!allowed.includes(user.role)) {
      AsgardUI.toast('Доступ', 'Big Screen доступен руководителям', 'err');
      location.hash = '#/home';
      return;
    }

    const body = `
      <style>
        .bs-wrap{position:fixed;inset:0;background:var(--bg-deep);z-index:9999;overflow:hidden;display:flex;flex-direction:column}
        .bs-header{padding:16px 32px;display:flex;justify-content:space-between;align-items:center;background:var(--bg-surface);border-bottom:1px solid rgba(242,208,138,.15)}
        .bs-logo{font-size:24px;font-weight:900;color:var(--gold,#f2d08a);letter-spacing:2px}
        .bs-time{font-size:18px;color:var(--muted);font-variant-numeric:tabular-nums}
        .bs-exit{background:none;border:1px solid var(--border);color:var(--muted);padding:8px 16px;border-radius:6px;cursor:pointer;font-size:12px;transition:all .2s}
        .bs-exit:hover{border-color:var(--gold,#f2d08a);color:var(--gold,#f2d08a)}
        .bs-body{flex:1;display:flex;align-items:center;justify-content:center;padding:32px}
        .bs-slide{width:100%;max-width:1400px;animation:bsFadeIn .5s ease}
        @keyframes bsFadeIn{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
        .bs-dots{display:flex;justify-content:center;gap:8px;padding:16px}
        .bs-dot{width:10px;height:10px;border-radius:50%;background:var(--glass);transition:all .3s;cursor:pointer}
        .bs-dot:hover{background:var(--glass-hover)}
        .bs-dot.active{background:var(--gold,#f2d08a);transform:scale(1.3)}
        .bs-kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px}
        .bs-card{background:var(--bg-surface);border-radius:6px;padding:32px;text-align:center}
        .bs-card-title{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:2px;font-weight:800;margin-bottom:16px}
        .bs-card-value{font-size:56px;font-weight:900;line-height:1.1}
        .bs-card-sub{font-size:14px;color:var(--muted);margin-top:12px}
        .bs-table{width:100%;border-collapse:collapse}
        .bs-table th{font-size:11px;color:var(--muted);text-transform:uppercase;text-align:left;padding:8px 16px;border-bottom:2px solid var(--border)}
        .bs-table td{padding:16px;font-size:16px;border-bottom:1px solid var(--border)}
        .bs-table tbody tr:last-child td{border-bottom:none}
        .green{color:#4ade80} .red{color:#f87171} .amber{color:#fbbf24} .blue{color:#60a5fa} .gold{color:#f2d08a}
        .bs-nav{display:flex;gap:12px;position:absolute;bottom:80px;left:50%;transform:translateX(-50%)}
        .bs-nav button{background:var(--glass);border:1px solid var(--border);color:var(--muted);padding:8px 16px;border-radius:6px;cursor:pointer;font-size:14px;transition:all .2s}
        .bs-nav button:hover{background:var(--glass-hover);color:var(--text)}
      </style>
      <div class="bs-wrap" id="bsWrap">
        <div class="bs-header">
          <div class="bs-logo">⚔️ ASGARD CRM</div>
          <div class="bs-time" id="bsClock"></div>
          <button class="bs-exit" id="bsExit">✕ Выход (ESC)</button>
        </div>
        <div class="bs-body"><div class="bs-slide" id="bsSlide">Загрузка...</div></div>
        <div class="bs-nav">
          <button id="bsPrev">◀ Назад</button>
          <button id="bsNext">Далее ▶</button>
        </div>
        <div class="bs-dots" id="bsDots"></div>
      </div>
    `;

    await layout(body, { title: title || 'Big Screen' });

    // Clock
    function updateClock() {
      const el = document.getElementById('bsClock');
      if (el) el.textContent = new Date().toLocaleString('ru-RU', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
    }
    updateClock();
    clockId = setInterval(updateClock, 1000);

    // Exit handler
    function cleanup() {
      if (clockId) clearInterval(clockId);
      if (intervalId) clearInterval(intervalId);
      document.removeEventListener('keydown', escHandler);
      const wrap = document.getElementById('bsWrap');
      if (wrap) wrap.remove();
    }

    const escHandler = (e) => {
      if (e.key === 'Escape') {
        cleanup();
        location.hash = '#/home';
      }
    };
    document.addEventListener('keydown', escHandler);

    document.getElementById('bsExit')?.addEventListener('click', () => {
      cleanup();
      location.hash = '#/home';
    });

    // Build slides
    const slides = await buildSlides();
    const dotsEl = document.getElementById('bsDots');
    if (dotsEl) {
      dotsEl.innerHTML = slides.map((_, i) =>
        '<div class="bs-dot' + (i === 0 ? ' active' : '') + '" data-i="' + i + '"></div>'
      ).join('');
      dotsEl.querySelectorAll('.bs-dot').forEach(d => {
        d.onclick = () => {
          currentSlide = Number(d.dataset.i);
          showSlide(slides);
          resetInterval(slides);
        };
      });
    }

    currentSlide = 0;
    showSlide(slides);

    // Manual navigation
    document.getElementById('bsPrev')?.addEventListener('click', () => {
      currentSlide = (currentSlide - 1 + slides.length) % slides.length;
      showSlide(slides);
      resetInterval(slides);
    });
    document.getElementById('bsNext')?.addEventListener('click', () => {
      currentSlide = (currentSlide + 1) % slides.length;
      showSlide(slides);
      resetInterval(slides);
    });

    // Auto-rotate every 15 sec
    function resetInterval(slides) {
      if (intervalId) clearInterval(intervalId);
      intervalId = setInterval(() => {
        currentSlide = (currentSlide + 1) % slides.length;
        showSlide(slides);
      }, 15000);
    }
    resetInterval(slides);

    // Listen for hash change to cleanup
    const hashHandler = () => {
      if (!location.hash.includes('big-screen')) cleanup();
    };
    window.addEventListener('hashchange', hashHandler, { once: true });
  }

  function showSlide(slides) {
    const el = document.getElementById('bsSlide');
    if (!el || !slides[currentSlide]) return;
    el.style.animation = 'none';
    el.offsetHeight; // reflow
    el.style.animation = '';
    el.innerHTML = slides[currentSlide];
    document.querySelectorAll('.bs-dot').forEach((d, i) => {
      d.classList.toggle('active', i === currentSlide);
    });
  }

  async function buildSlides() {
    const [tenders, works, users] = await Promise.all([
      AsgardDB.getAll('tenders') || [],
      AsgardDB.getAll('works') || [],
      AsgardDB.getAll('users') || []
    ]);
    const y = new Date().getFullYear();
    const now = new Date();

    // --- Slide 1: Общие KPI ---
    const yTenders = tenders.filter(t => String(t.year) === String(y) || (t.period || '').startsWith(y));
    const won = yTenders.filter(t => ['Выиграли','Контракт','Клиент согласился'].includes(t.tender_status)).length;
    const yWorks = works.filter(w => { const d = w.work_start_fact || w.work_start_plan; return d && new Date(d).getFullYear() === y; });
    const revenue = yWorks.reduce((s, w) => s + (Number(w.contract_sum) || Number(w.contract_value) || 0), 0);
    const done = yWorks.filter(w => w.work_status === 'Работы сдали').length;
    const overdue = yWorks.filter(w => w.end_plan && !['Работы сдали','Закрыт'].includes(w.work_status) && new Date(w.end_plan) < now).length;

    const slide1 = `
      <h2 style="text-align:center;color:var(--gold,#f2d08a);margin-bottom:32px;font-size:28px">📊 Ключевые показатели ${y}</h2>
      <div class="bs-kpi">
        <div class="bs-card"><div class="bs-card-title">Тендеров</div><div class="bs-card-value blue">${yTenders.length}</div><div class="bs-card-sub">Выиграно: <b class="green">${won}</b> · Конверсия: <b>${_pct(won, yTenders.length)}</b></div></div>
        <div class="bs-card"><div class="bs-card-title">Выручка</div><div class="bs-card-value gold">${_short(revenue)}</div><div class="bs-card-sub">${_m(revenue)}</div></div>
        <div class="bs-card"><div class="bs-card-title">Работы</div><div class="bs-card-value green">${yWorks.length}</div><div class="bs-card-sub">Сдано: <b class="green">${done}</b> · Просрочено: <b class="${overdue?'red':'green'}">${overdue}</b></div></div>
        <div class="bs-card"><div class="bs-card-title">Команда</div><div class="bs-card-value" style="color:#a78bfa">${users.filter(u=>u.is_active).length}</div><div class="bs-card-sub">активных сотрудников</div></div>
      </div>
    `;

    // --- Slide 2: Топ РП ---
    const pms = users.filter(u => u.is_active && (u.role === 'PM' || u.role === 'HEAD_PM'));
    const pmRows = pms.map(pm => {
      const pw = works.filter(w => w.pm_id === pm.id);
      const active = pw.filter(w => !['Работы сдали','Закрыт'].includes(w.work_status)).length;
      const contract = pw.reduce((s,w) => s + (Number(w.contract_sum) || Number(w.contract_value) || 0), 0);
      return { name: pm.name, active, total: pw.length, contract };
    }).sort((a,b) => b.contract - a.contract).slice(0, 8);

    const slide2 = pmRows.length ? `
      <h2 style="text-align:center;color:var(--gold,#f2d08a);margin-bottom:32px;font-size:28px">👷 Загрузка руководителей проектов</h2>
      <table class="bs-table">
        <thead><tr><th>РП</th><th>Активные</th><th>Всего</th><th>Сумма контрактов</th></tr></thead>
        <tbody>${pmRows.map(r => `<tr><td style="font-weight:700">${esc(r.name)}</td><td class="amber" style="font-weight:700">${r.active}</td><td>${r.total}</td><td class="gold">${_m(r.contract)}</td></tr>`).join('')}</tbody>
      </table>
    ` : `<h2 style="text-align:center;color:var(--gold,#f2d08a);margin-bottom:32px">👷 Руководители проектов</h2><div class="asg-empty"><div class="asg-empty-icon">📋</div><div class="asg-empty-text">Нет данных</div></div>`;

    // --- Slide 3: Просроченные ---
    const overdueList = works.filter(w => w.end_plan && !['Работы сдали','Закрыт'].includes(w.work_status) && new Date(w.end_plan) < now)
      .sort((a,b) => new Date(a.end_plan) - new Date(b.end_plan)).slice(0, 8);
    const byPm = new Map(users.map(u => [u.id, u.name]));

    const slide3 = overdueList.length ? `
      <h2 style="text-align:center;color:#f87171;margin-bottom:32px;font-size:28px">⚠️ Просроченные работы</h2>
      <table class="bs-table">
        <thead><tr><th>Работа</th><th>РП</th><th>Дедлайн</th><th>Просрочка</th></tr></thead>
        <tbody>${overdueList.map(w => {
          const days = Math.round((now - new Date(w.end_plan)) / 86400000);
          return `<tr><td style="font-weight:600">${esc(w.work_title || w.work_name || '')}</td><td>${esc(byPm.get(w.pm_id) || '—')}</td><td>${new Date(w.end_plan).toLocaleDateString('ru-RU')}</td><td class="red" style="font-weight:900;font-size:20px">+${days} дн.</td></tr>`;
        }).join('')}</tbody>
      </table>
    ` : `<div class="asg-empty"><div class="asg-empty-icon">✅</div><div class="asg-empty-text">Просроченных работ нет</div></div>`;

    // --- Slide 4: Тендерная воронка ---
    const stages = [
      { name: 'Новый', statuses: ['Новый', 'Получен'], color: '#64748b' },
      { name: 'В просчёте', statuses: ['В просчёте', 'На просчёте'], color: '#2563eb' },
      { name: 'КП отправлено', statuses: ['КП отправлено', 'ТКП отправлено'], color: '#8b5cf6' },
      { name: 'Переговоры', statuses: ['Переговоры', 'На согласовании'], color: '#f59e0b' },
      { name: 'Выиграли', statuses: ['Выиграли', 'Контракт', 'Клиент согласился'], color: '#16a34a' },
      { name: 'Проиграли', statuses: ['Проиграли', 'Клиент отказался', 'Отказ'], color: '#dc2626' }
    ];

    const funnelData = stages.map(s => {
      const count = yTenders.filter(t => s.statuses.includes(t.tender_status)).length;
      return { ...s, count };
    });
    const maxFunnel = Math.max(...funnelData.map(s => s.count), 1);

    const slide4 = `
      <h2 style="text-align:center;color:var(--gold,#f2d08a);margin-bottom:32px;font-size:28px">📈 Воронка тендеров ${y}</h2>
      <div style="max-width:800px;margin:0 auto">
        ${funnelData.map(s => {
          const pct = Math.round((s.count / maxFunnel) * 100);
          return `<div style="display:flex;align-items:center;gap:16px;margin:12px 0">
            <div style="width:120px;font-size:14px;color:var(--text)">${s.name}</div>
            <div style="flex:1;background:var(--glass);border-radius:6px;height:32px;overflow:hidden">
              <div style="height:100%;width:${pct}%;background:${s.color};border-radius:6px;transition:width .5s"></div>
            </div>
            <div style="width:60px;text-align:right;font-size:20px;font-weight:700;color:${s.color}">${s.count}</div>
          </div>`;
        }).join('')}
      </div>
    `;

    return [slide1, slide2, slide3, slide4];
  }

  return { render };
})();
