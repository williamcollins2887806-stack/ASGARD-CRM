/**
 * ASGARD CRM — Big Screen (Director's TV Dashboard)
 * Полноэкранная презентация KPI компании для офисного монитора/ТВ.
 * 8 слайдов, авто-ротация каждые 60 секунд, живое обновление данных.
 */
window.AsgardBigScreen = (function(){
  const { esc } = AsgardUI;
  let intervalId = null;
  let clockId = null;
  let dataRefreshId = null;
  let currentSlide = 0;
  let slides = [];
  let cachedData = {};

  const SLIDE_INTERVAL = 60000; // 60 секунд
  const DATA_REFRESH   = 300000; // обновление данных каждые 5 мин

  function _m(n) {
    return new Intl.NumberFormat('ru-RU', {style:'currency',currency:'RUB',maximumFractionDigits:0}).format(n||0);
  }
  function _short(x) {
    const n = Number(x) || 0;
    if (n >= 1000000000) return (n/1000000000).toFixed(1) + ' млрд';
    if (n >= 1000000) return (n/1000000).toFixed(1) + ' млн';
    if (n >= 1000) return (n/1000).toFixed(0) + ' тыс';
    return n.toFixed(0);
  }
  function _pct(a, b) { return b ? Math.round((a/b)*100) : 0; }
  function _days(d) { return Math.round((new Date() - new Date(d)) / 86400000); }

  // ═══════════════════════════════════════════════════════════
  //  RENDER (entry point)
  // ═══════════════════════════════════════════════════════════
  async function render({ layout, title }) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = "#/login"; return; }
    const user = auth.user;

    const allowed = ['ADMIN','DIRECTOR_COMM','DIRECTOR_GEN','DIRECTOR_DEV','HEAD_TO','HEAD_PM'];
    if (!allowed.includes(user.role)) {
      AsgardUI.toast('Доступ', 'Big Screen доступен руководителям', 'err');
      location.hash = '#/home';
      return;
    }

    const body = `
      <style>
        .bs{position:fixed;inset:0;background:#060a14;z-index:9999;overflow:hidden;display:flex;flex-direction:column;font-family:'Inter',var(--font-sans),system-ui,sans-serif}
        .bs *{box-sizing:border-box}

        /* ── Header ── */
        .bs-hdr{padding:20px 40px;display:flex;align-items:center;background:linear-gradient(180deg,rgba(242,208,138,.06) 0%,transparent 100%);border-bottom:1px solid rgba(242,208,138,.1);flex-shrink:0;gap:20px}
        .bs-brand{display:flex;align-items:center;gap:14px;flex-shrink:0}
        .bs-brand-icon{font-size:28px}
        .bs-brand-name{font-size:22px;font-weight:900;color:#f2d08a;letter-spacing:3px;text-transform:uppercase}
        .bs-brand-sub{font-size:11px;color:rgba(255,255,255,.3);letter-spacing:1px;margin-top:2px}
        .bs-hdr-spacer{flex:1}
        .bs-clock{text-align:right;flex-shrink:0}
        .bs-clock-time{font-size:32px;font-weight:300;color:rgba(255,255,255,.9);font-variant-numeric:tabular-nums;letter-spacing:1px}
        .bs-clock-date{font-size:13px;color:rgba(255,255,255,.35);margin-top:2px}
        .bs-exit{flex-shrink:0;margin-left:16px;background:none;border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.25);width:36px;height:36px;border-radius:50%;cursor:pointer;font-size:14px;transition:all .3s;display:flex;align-items:center;justify-content:center}
        .bs-exit:hover{border-color:#f2d08a;color:#f2d08a}

        /* ── Body ── */
        .bs-body{flex:1;display:flex;align-items:center;justify-content:center;padding:24px 40px;overflow:hidden}
        .bs-slide{width:100%;max-width:1600px;animation:bsIn .6s cubic-bezier(.16,1,.3,1)}
        @keyframes bsIn{from{opacity:0;transform:translateY(30px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}

        /* ── Slide title ── */
        .bs-title{text-align:center;margin-bottom:28px}
        .bs-title h2{font-size:26px;font-weight:800;color:#f2d08a;margin:0 0 4px;letter-spacing:1px}
        .bs-title .bs-subtitle{font-size:13px;color:rgba(255,255,255,.3)}

        /* ── Footer (dots + page indicator) ── */
        .bs-foot{padding:16px 40px 20px;display:flex;justify-content:center;align-items:center;gap:20px;flex-shrink:0}
        .bs-dots{display:flex;gap:8px}
        .bs-dot{width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,.1);transition:all .4s;cursor:pointer}
        .bs-dot:hover{background:rgba(255,255,255,.25)}
        .bs-dot.active{background:#f2d08a;width:24px;border-radius:4px}
        .bs-page{font-size:11px;color:rgba(255,255,255,.2);font-variant-numeric:tabular-nums}
        .bs-progress{position:absolute;bottom:0;left:0;height:2px;background:linear-gradient(90deg,#f2d08a,#c9302c);transition:width linear}

        /* ── KPI Cards ── */
        .bs-kpi{display:grid;grid-template-columns:repeat(4,1fr);gap:2px;background:rgba(148,163,184,.06);border-radius:12px;overflow:hidden;border:1px solid rgba(148,163,184,.08)}
        .bs-kpi-card{background:rgba(15,22,42,.85);border:none;border-radius:0;padding:28px 24px;text-align:center;position:relative;overflow:hidden}
        .bs-kpi-card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px}
        .bs-kpi-card.c-blue::before{background:linear-gradient(90deg,#3b82f6,#60a5fa)}
        .bs-kpi-card.c-gold::before{background:linear-gradient(90deg,#f2d08a,#d4a853)}
        .bs-kpi-card.c-green::before{background:linear-gradient(90deg,#22c55e,#4ade80)}
        .bs-kpi-card.c-purple::before{background:linear-gradient(90deg,#8b5cf6,#a78bfa)}
        .bs-kpi-card.c-red::before{background:linear-gradient(90deg,#ef4444,#f87171)}
        .bs-kpi-card.c-amber::before{background:linear-gradient(90deg,#f59e0b,#fbbf24)}
        .bs-kpi-card.c-cyan::before{background:linear-gradient(90deg,#06b6d4,#22d3ee)}
        .bs-kpi-card.c-pink::before{background:linear-gradient(90deg,#ec4899,#f472b6)}
        .bs-kpi-lbl{font-size:11px;color:rgba(255,255,255,.35);text-transform:uppercase;letter-spacing:2px;font-weight:800;margin-bottom:12px}
        .bs-kpi-val{font-size:48px;font-weight:900;line-height:1.1}
        .bs-kpi-sub{font-size:13px;color:rgba(255,255,255,.35);margin-top:10px}
        .bs-kpi-delta{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;margin-top:8px}
        .bs-kpi-delta.up{background:rgba(34,197,94,.15);color:#4ade80}
        .bs-kpi-delta.down{background:rgba(239,68,68,.15);color:#f87171}

        /* ── Table ── */
        .bs-tbl{width:100%;border-collapse:separate;border-spacing:0 6px}
        .bs-tbl th{font-size:11px;color:rgba(255,255,255,.25);text-transform:uppercase;letter-spacing:1px;text-align:left;padding:8px 16px;font-weight:700}
        .bs-tbl td{padding:14px 16px;background:rgba(15,22,42,.6);font-size:15px;color:rgba(255,255,255,.85)}
        .bs-tbl tr td:first-child{border-radius:8px 0 0 8px}
        .bs-tbl tr td:last-child{border-radius:0 8px 8px 0}
        .bs-tbl .rank{font-size:13px;color:rgba(255,255,255,.2);font-weight:700;width:40px}
        .bs-tbl .highlight{color:#f2d08a;font-weight:700}

        /* ── Bar chart ── */
        .bs-bar{display:flex;align-items:center;gap:16px;margin:10px 0}
        .bs-bar-lbl{width:140px;font-size:14px;color:rgba(255,255,255,.6);text-align:right}
        .bs-bar-track{flex:1;background:rgba(255,255,255,.05);border-radius:6px;height:28px;overflow:hidden}
        .bs-bar-fill{height:100%;border-radius:6px;transition:width .8s cubic-bezier(.16,1,.3,1);display:flex;align-items:center;padding-left:12px;font-size:12px;font-weight:700;color:rgba(255,255,255,.9)}
        .bs-bar-val{width:70px;text-align:right;font-size:18px;font-weight:800}

        /* ── Two-column layout ── */
        .bs-cols{display:grid;grid-template-columns:1fr 1fr;gap:24px}
        .bs-col-title{font-size:13px;color:rgba(255,255,255,.3);text-transform:uppercase;letter-spacing:1.5px;font-weight:800;margin-bottom:14px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,.06)}

        /* ── Status dot ── */
        .bs-status{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:8px}

        /* ── Colors ── */
        .c-green{color:#4ade80} .c-red{color:#f87171} .c-amber{color:#fbbf24}
        .c-blue{color:#60a5fa} .c-gold{color:#f2d08a} .c-purple{color:#a78bfa}
        .c-cyan{color:#22d3ee} .c-white{color:rgba(255,255,255,.85)}

        @media (max-width:1200px){
          .bs-kpi{grid-template-columns:repeat(2,1fr)}
          .bs-cols{grid-template-columns:1fr}
          .bs-kpi-val{font-size:36px}
          .bs-hdr{padding:16px 24px}
          .bs-body{padding:16px 24px}
        }
      </style>
      <div class="bs" id="bsWrap">
        <div class="bs-hdr">
          <div class="bs-brand">
            <div class="bs-brand-icon">&#9876;</div>
            <div>
              <div class="bs-brand-name">ASGARD</div>
              <div class="bs-brand-sub">COMMAND CENTER</div>
            </div>
          </div>
          <div class="bs-hdr-spacer"></div>
          <div class="bs-clock">
            <div class="bs-clock-time" id="bsClock"></div>
            <div class="bs-clock-date" id="bsDate"></div>
          </div>
          <button class="bs-exit" id="bsExit" title="Выход (ESC)">&#10005;</button>
        </div>
        <div class="bs-body"><div class="bs-slide" id="bsSlide"></div></div>
        <div class="bs-foot">
          <div class="bs-dots" id="bsDots"></div>
          <div class="bs-page" id="bsPage"></div>
        </div>
        <div class="bs-progress" id="bsProgress" style="width:0"></div>
      </div>
    `;

    await layout(body, { title: title || 'Big Screen' });

    // Move big screen overlay to document.body so it escapes .main stacking context
    // and renders ABOVE the sidebar (z-index: 9999 vs sidebar z-index: 200)
    const bsWrap = document.getElementById('bsWrap');
    if (bsWrap) document.body.appendChild(bsWrap);

    // Clock
    function updateClock() {
      const el = document.getElementById('bsClock');
      const elD = document.getElementById('bsDate');
      const now = new Date();
      if (el) el.textContent = now.toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
      if (elD) elD.textContent = now.toLocaleDateString('ru-RU', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
    }
    updateClock();
    clockId = setInterval(updateClock, 1000);

    // Progress bar animation
    let progressStart = Date.now();
    function animateProgress() {
      const el = document.getElementById('bsProgress');
      if (!el) return;
      const elapsed = Date.now() - progressStart;
      const pct = Math.min((elapsed / SLIDE_INTERVAL) * 100, 100);
      el.style.width = pct + '%';
      if (pct < 100) requestAnimationFrame(animateProgress);
    }

    // Cleanup
    function cleanup() {
      if (clockId) clearInterval(clockId);
      if (intervalId) clearInterval(intervalId);
      if (dataRefreshId) clearInterval(dataRefreshId);
      document.removeEventListener('keydown', keyHandler);
      const wrap = document.getElementById('bsWrap');
      if (wrap) wrap.remove();
    }

    const keyHandler = (e) => {
      if (e.key === 'Escape') { cleanup(); location.hash = '#/home'; }
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); nextSlide(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); prevSlide(); }
    };
    document.addEventListener('keydown', keyHandler);
    document.getElementById('bsExit')?.addEventListener('click', () => { cleanup(); location.hash = '#/home'; });

    // Load data & build slides
    await loadData();
    slides = buildSlides();
    renderDots();
    currentSlide = 0;
    showSlide();

    // Auto-rotate
    function resetInterval() {
      if (intervalId) clearInterval(intervalId);
      progressStart = Date.now();
      animateProgress();
      intervalId = setInterval(() => {
        currentSlide = (currentSlide + 1) % slides.length;
        showSlide();
        progressStart = Date.now();
        animateProgress();
      }, SLIDE_INTERVAL);
    }
    resetInterval();

    function nextSlide() { currentSlide = (currentSlide + 1) % slides.length; showSlide(); resetInterval(); }
    function prevSlide() { currentSlide = (currentSlide - 1 + slides.length) % slides.length; showSlide(); resetInterval(); }

    // Periodic data refresh
    dataRefreshId = setInterval(async () => {
      await loadData();
      slides = buildSlides();
      renderDots();
    }, DATA_REFRESH);

    // Hash change cleanup
    window.addEventListener('hashchange', function hh() {
      if (!location.hash.includes('big-screen')) { cleanup(); window.removeEventListener('hashchange', hh); }
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  SHOW SLIDE
  // ═══════════════════════════════════════════════════════════
  function showSlide() {
    const el = document.getElementById('bsSlide');
    if (!el || !slides[currentSlide]) return;
    el.style.animation = 'none';
    el.offsetHeight;
    el.style.animation = '';
    el.innerHTML = slides[currentSlide];
    document.querySelectorAll('.bs-dot').forEach((d, i) => d.classList.toggle('active', i === currentSlide));
    const pg = document.getElementById('bsPage');
    if (pg) pg.textContent = (currentSlide + 1) + ' / ' + slides.length;
  }

  function renderDots() {
    const el = document.getElementById('bsDots');
    if (!el) return;
    el.innerHTML = slides.map((_, i) => '<div class="bs-dot' + (i === currentSlide ? ' active' : '') + '" data-i="' + i + '"></div>').join('');
    el.querySelectorAll('.bs-dot').forEach(d => {
      d.onclick = () => { currentSlide = Number(d.dataset.i); showSlide(); };
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  LOAD DATA
  // ═══════════════════════════════════════════════════════════
  async function loadData() {
    const [tenders, works, users, employees, cash, permits] = await Promise.all([
      AsgardDB.getAll('tenders').catch(()=>[]) || [],
      AsgardDB.getAll('works').catch(()=>[]) || [],
      AsgardDB.getAll('users').catch(()=>[]) || [],
      AsgardDB.getAll('employees').catch(()=>[]) || [],
      AsgardDB.getAll('cash_requests').catch(()=>[]) || [],
      AsgardDB.getAll('permits').catch(()=>[]) || []
    ]);

    const y = new Date().getFullYear();
    const now = new Date();

    // API data (server-side)
    let preTenderStats = {};
    let equipmentStats = {};
    try {
      const auth = await AsgardAuth.getAuth();
      const headers = { 'Authorization': 'Bearer ' + auth.token };
      const [ptRes, eqRes] = await Promise.all([
        fetch('/api/pre-tenders/stats', { headers }).then(r => r.json()).catch(() => ({})),
        fetch('/api/equipment/balance-value', { headers }).then(r => r.json()).catch(() => ({}))
      ]);
      if (ptRes.success) preTenderStats = ptRes;
      if (eqRes.success) equipmentStats = eqRes;
    } catch(_) {}

    cachedData = { tenders, works, users, employees, cash, permits, preTenderStats, equipmentStats, y, now };
  }

  // ═══════════════════════════════════════════════════════════
  //  BUILD ALL SLIDES
  // ═══════════════════════════════════════════════════════════
  function buildSlides() {
    const d = cachedData;
    if (!d.tenders) return ['<div style="text-align:center;color:rgba(255,255,255,.4);font-size:20px">Загрузка данных...</div>'];

    const result = [];
    result.push(slideKPI(d));
    result.push(slideFinance(d));
    result.push(slideFunnel(d));
    result.push(slidePM(d));
    result.push(slideActiveWorks(d));
    result.push(slideOverdue(d));
    result.push(slideTeamAndPermits(d));
    result.push(slidePreTendersAndEquipment(d));
    return result;
  }

  // ───────────────────────────────────────────────────────
  //  SLIDE 1: KPI Overview
  // ───────────────────────────────────────────────────────
  function slideKPI(d) {
    const yT = d.tenders.filter(t => String(t.year) === String(d.y) || (t.period || '').startsWith(d.y));
    const won = yT.filter(t => ['Выиграли','Контракт','Клиент согласился'].includes(t.tender_status)).length;
    const yW = d.works.filter(w => { const dt = w.work_start_fact || w.work_start_plan || w.created_at; return dt && new Date(dt).getFullYear() === d.y; });
    const revenue = yW.reduce((s, w) => s + (Number(w.contract_sum) || Number(w.contract_value) || 0), 0);
    const done = yW.filter(w => w.work_status === 'Работы сдали').length;
    const active = yW.filter(w => !['Работы сдали','Закрыт'].includes(w.work_status)).length;
    const overdue = yW.filter(w => w.end_plan && !['Работы сдали','Закрыт'].includes(w.work_status) && new Date(w.end_plan) < d.now).length;
    const teamActive = d.users.filter(u => u.is_active).length;
    const conv = _pct(won, yT.length);

    return `
      <div class="bs-title"><h2>Ключевые показатели ${d.y}</h2><div class="bs-subtitle">Обзор деятельности компании</div></div>
      <div class="bs-kpi">
        <div class="bs-kpi-card c-blue"><div class="bs-kpi-lbl">Тендеров</div><div class="bs-kpi-val c-blue">${yT.length}</div><div class="bs-kpi-sub">Выиграно: <b class="c-green">${won}</b></div></div>
        <div class="bs-kpi-card c-green"><div class="bs-kpi-lbl">Конверсия</div><div class="bs-kpi-val c-green">${conv}%</div><div class="bs-kpi-sub">${won} из ${yT.length} тендеров</div></div>
        <div class="bs-kpi-card c-gold"><div class="bs-kpi-lbl">Выручка</div><div class="bs-kpi-val c-gold">${_short(revenue)}</div><div class="bs-kpi-sub">${_m(revenue)}</div></div>
        <div class="bs-kpi-card c-purple"><div class="bs-kpi-lbl">Работы</div><div class="bs-kpi-val c-purple">${active}</div><div class="bs-kpi-sub">Сдано: <b class="c-green">${done}</b> &middot; Просрочено: <b class="${overdue?'c-red':'c-green'}">${overdue}</b></div></div>
      </div>
      <div class="bs-kpi" style="margin-top:20px">
        <div class="bs-kpi-card c-cyan"><div class="bs-kpi-lbl">Команда</div><div class="bs-kpi-val c-cyan">${teamActive}</div><div class="bs-kpi-sub">активных сотрудников</div></div>
        <div class="bs-kpi-card c-amber"><div class="bs-kpi-lbl">Заявки</div><div class="bs-kpi-val c-amber">${(d.preTenderStats.total_new || 0) + (d.preTenderStats.total_in_review || 0)}</div><div class="bs-kpi-sub">ожидают решения</div></div>
        <div class="bs-kpi-card c-pink"><div class="bs-kpi-lbl">Касса</div><div class="bs-kpi-val c-pink">${d.cash.filter(c => ['requested','approved'].includes(c.status)).length}</div><div class="bs-kpi-sub">заявок в обработке</div></div>
        <div class="bs-kpi-card c-red"><div class="bs-kpi-lbl">Допуски</div><div class="bs-kpi-val c-red">${d.permits.filter(p => p.expiry_date && _days(p.expiry_date) > -30 && _days(p.expiry_date) < 0).length}</div><div class="bs-kpi-sub">истекают в 30 дней</div></div>
      </div>
    `;
  }

  // ───────────────────────────────────────────────────────
  //  SLIDE 2: Financial Summary
  // ───────────────────────────────────────────────────────
  function slideFinance(d) {
    const yW = d.works.filter(w => { const dt = w.contract_date || w.work_start_fact || w.created_at; return dt && new Date(dt).getFullYear() === d.y; });
    const contractTotal = yW.reduce((s, w) => s + (Number(w.contract_sum) || Number(w.contract_value) || 0), 0);
    const received = yW.reduce((s, w) => s + (Number(w.balance_received) || 0) + (Number(w.advance_received) || 0), 0);
    const advanceTotal = yW.reduce((s, w) => s + (Number(w.advance_received) || 0), 0);
    const balanceTotal = yW.reduce((s, w) => s + (Number(w.balance_received) || 0), 0);
    const receivedPct = _pct(received, contractTotal);

    const cashOut = d.cash.filter(c => ['received','reporting'].includes(c.status)).reduce((s, c) => s + (Number(c.amount) || 0), 0);
    const cashPending = d.cash.filter(c => ['requested','approved'].includes(c.status)).reduce((s, c) => s + (Number(c.amount) || 0), 0);

    const eqVal = d.equipmentStats.total_book_value || 0;
    const eqPurch = d.equipmentStats.total_purchase_price || 0;

    return `
      <div class="bs-title"><h2>Финансовая сводка ${d.y}</h2><div class="bs-subtitle">Контракты, поступления, касса, активы</div></div>
      <div class="bs-kpi">
        <div class="bs-kpi-card c-gold"><div class="bs-kpi-lbl">Сумма контрактов</div><div class="bs-kpi-val c-gold">${_short(contractTotal)}</div><div class="bs-kpi-sub">${_m(contractTotal)}</div></div>
        <div class="bs-kpi-card c-green"><div class="bs-kpi-lbl">Получено</div><div class="bs-kpi-val c-green">${_short(received)}</div><div class="bs-kpi-sub">${receivedPct}% от контрактов</div></div>
        <div class="bs-kpi-card c-blue"><div class="bs-kpi-lbl">Авансы / Баланс</div><div class="bs-kpi-val c-blue">${_short(advanceTotal)}</div><div class="bs-kpi-sub">Баланс: ${_m(balanceTotal)}</div></div>
        <div class="bs-kpi-card c-purple"><div class="bs-kpi-lbl">Активы (ТМЦ)</div><div class="bs-kpi-val c-purple">${_short(eqVal)}</div><div class="bs-kpi-sub">Закупка: ${_m(eqPurch)}</div></div>
      </div>
      <div class="bs-kpi" style="margin-top:20px">
        <div class="bs-kpi-card c-amber" style="grid-column:span 2"><div class="bs-kpi-lbl">Касса: выдано (не закрыто)</div><div class="bs-kpi-val c-amber">${_m(cashOut)}</div><div class="bs-kpi-sub">Ожидает выдачи: ${_m(cashPending)}</div></div>
        <div class="bs-kpi-card c-cyan" style="grid-column:span 2"><div class="bs-kpi-lbl">Собираемость</div>
          <div style="margin-top:14px;background:rgba(255,255,255,.06);border-radius:8px;height:24px;overflow:hidden">
            <div style="height:100%;width:${receivedPct}%;background:linear-gradient(90deg,#22c55e,#4ade80);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff">${receivedPct}%</div>
          </div>
          <div class="bs-kpi-sub" style="margin-top:10px">Получено ${_m(received)} из ${_m(contractTotal)}</div>
        </div>
      </div>
    `;
  }

  // ───────────────────────────────────────────────────────
  //  SLIDE 3: Tender Funnel
  // ───────────────────────────────────────────────────────
  function slideFunnel(d) {
    const yT = d.tenders.filter(t => String(t.year) === String(d.y) || (t.period || '').startsWith(d.y));
    const stages = [
      { name: 'Новый', statuses: ['Новый','Получен'], color: '#64748b' },
      { name: 'Отправлено на просчёт', statuses: ['Отправлено на просчёт','В просчёте','На просчёте'], color: '#3b82f6' },
      { name: 'КП отправлено', statuses: ['КП отправлено','ТКП отправлено'], color: '#8b5cf6' },
      { name: 'Переговоры', statuses: ['Переговоры','На согласовании'], color: '#f59e0b' },
      { name: 'Выиграли', statuses: ['Выиграли','Контракт','Клиент согласился'], color: '#22c55e' },
      { name: 'Проиграли', statuses: ['Проиграли','Клиент отказался','Отказ'], color: '#ef4444' }
    ];
    const data = stages.map(s => ({ ...s, count: yT.filter(t => s.statuses.includes(t.tender_status)).length }));
    const max = Math.max(...data.map(s => s.count), 1);

    // Monthly dynamics
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const dt = new Date(d.now.getFullYear(), d.now.getMonth() - i, 1);
      const key = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0');
      const label = dt.toLocaleDateString('ru-RU', { month: 'short' });
      const mT = d.tenders.filter(t => (t.period || '').startsWith(key) || (t.created_at || '').startsWith(key));
      const mWon = mT.filter(t => ['Выиграли','Контракт','Клиент согласился'].includes(t.tender_status)).length;
      months.push({ label, total: mT.length, won: mWon });
    }
    const mMax = Math.max(...months.map(m => m.total), 1);

    return `
      <div class="bs-title"><h2>Воронка тендеров ${d.y}</h2><div class="bs-subtitle">Все тендеры: ${yT.length}</div></div>
      <div class="bs-cols">
        <div>
          <div class="bs-col-title">По стадиям</div>
          ${data.map(s => `
            <div class="bs-bar">
              <div class="bs-bar-lbl">${s.name}</div>
              <div class="bs-bar-track"><div class="bs-bar-fill" style="width:${Math.round((s.count/max)*100)}%;background:${s.color}">${s.count > 0 ? s.count : ''}</div></div>
              <div class="bs-bar-val" style="color:${s.color}">${s.count}</div>
            </div>
          `).join('')}
        </div>
        <div>
          <div class="bs-col-title">Динамика (6 мес.)</div>
          <div style="display:flex;align-items:flex-end;gap:10px;height:180px;padding-top:16px">
            ${months.map(m => {
              const h = Math.max(8, Math.round((m.total / mMax) * 140));
              const wh = m.total > 0 ? Math.round((m.won / m.total) * h) : 0;
              return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">
                <div style="font-size:12px;font-weight:700;color:rgba(255,255,255,.7)">${m.total}</div>
                <div style="width:100%;display:flex;flex-direction:column;justify-content:flex-end;height:${h}px;border-radius:6px;overflow:hidden">
                  <div style="height:${h - wh}px;background:#3b82f6"></div>
                  <div style="height:${wh}px;background:#22c55e"></div>
                </div>
                <div style="font-size:11px;color:rgba(255,255,255,.3)">${esc(m.label)}</div>
              </div>`;
            }).join('')}
          </div>
          <div style="display:flex;gap:16px;margin-top:12px;justify-content:center;font-size:11px">
            <span><span style="display:inline-block;width:10px;height:10px;background:#3b82f6;border-radius:2px;margin-right:4px"></span>Всего</span>
            <span><span style="display:inline-block;width:10px;height:10px;background:#22c55e;border-radius:2px;margin-right:4px"></span>Выиграно</span>
          </div>
        </div>
      </div>
    `;
  }

  // ───────────────────────────────────────────────────────
  //  SLIDE 4: PM Performance
  // ───────────────────────────────────────────────────────
  function slidePM(d) {
    const pms = d.users.filter(u => u.is_active && (u.role === 'PM' || u.role === 'HEAD_PM'));
    const rows = pms.map(pm => {
      const pw = d.works.filter(w => w.pm_id === pm.id);
      const active = pw.filter(w => !['Работы сдали','Закрыт'].includes(w.work_status)).length;
      const completed = pw.filter(w => w.work_status === 'Работы сдали').length;
      const overdue = pw.filter(w => w.end_plan && !['Работы сдали','Закрыт'].includes(w.work_status) && new Date(w.end_plan) < d.now).length;
      const contract = pw.reduce((s,w) => s + (Number(w.contract_sum) || Number(w.contract_value) || 0), 0);
      return { name: pm.name, active, completed, overdue, total: pw.length, contract };
    }).sort((a,b) => b.contract - a.contract).slice(0, 10);

    if (!rows.length) return '<div class="bs-title"><h2>Руководители проектов</h2></div><div style="text-align:center;color:rgba(255,255,255,.3);font-size:18px;padding:40px">Нет данных</div>';

    return `
      <div class="bs-title"><h2>Руководители проектов</h2><div class="bs-subtitle">Загрузка и результативность</div></div>
      <table class="bs-tbl">
        <thead><tr><th>#</th><th>РП</th><th>Активные</th><th>Сдано</th><th>Просрочено</th><th>Всего</th><th>Сумма контрактов</th></tr></thead>
        <tbody>${rows.map((r, i) => `<tr>
          <td class="rank">${i + 1}</td>
          <td style="font-weight:700">${esc(r.name)}</td>
          <td class="c-amber" style="font-weight:700;font-size:18px">${r.active}</td>
          <td class="c-green">${r.completed}</td>
          <td class="${r.overdue ? 'c-red' : 'c-green'}" style="font-weight:${r.overdue?'700':'400'}">${r.overdue}</td>
          <td>${r.total}</td>
          <td class="highlight">${_m(r.contract)}</td>
        </tr>`).join('')}</tbody>
      </table>
    `;
  }

  // ───────────────────────────────────────────────────────
  //  SLIDE 5: Active Works
  // ───────────────────────────────────────────────────────
  function slideActiveWorks(d) {
    const byPm = new Map(d.users.map(u => [u.id, u.name]));
    const activeW = d.works.filter(w => !['Работы сдали','Закрыт'].includes(w.work_status))
      .sort((a,b) => (Number(b.contract_sum)||Number(b.contract_value)||0) - (Number(a.contract_sum)||Number(a.contract_value)||0))
      .slice(0, 10);

    const statusColors = {
      'В работе': '#22c55e', 'Мобилизация': '#3b82f6', 'Подготовка': '#8b5cf6',
      'На объекте': '#06b6d4', 'Демобилизация': '#f59e0b'
    };

    return `
      <div class="bs-title"><h2>Активные работы</h2><div class="bs-subtitle">Топ ${activeW.length} по сумме контракта</div></div>
      <table class="bs-tbl">
        <thead><tr><th>#</th><th>Работа</th><th>Заказчик</th><th>РП</th><th>Статус</th><th>Сумма</th></tr></thead>
        <tbody>${activeW.map((w, i) => {
          const sc = statusColors[w.work_status] || '#94a3b8';
          return `<tr>
            <td class="rank">${i + 1}</td>
            <td style="font-weight:600;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(w.work_title || w.work_name || '')}</td>
            <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(w.customer_name || '—')}</td>
            <td>${esc(byPm.get(w.pm_id) || '—')}</td>
            <td><span class="bs-status" style="background:${sc}"></span>${esc(w.work_status)}</td>
            <td class="highlight">${_m(Number(w.contract_sum) || Number(w.contract_value) || 0)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    `;
  }

  // ───────────────────────────────────────────────────────
  //  SLIDE 6: Overdue Works
  // ───────────────────────────────────────────────────────
  function slideOverdue(d) {
    const byPm = new Map(d.users.map(u => [u.id, u.name]));
    const overdue = d.works.filter(w => w.end_plan && !['Работы сдали','Закрыт'].includes(w.work_status) && new Date(w.end_plan) < d.now)
      .sort((a,b) => new Date(a.end_plan) - new Date(b.end_plan)).slice(0, 10);

    if (!overdue.length) {
      return `
        <div class="bs-title"><h2>Контроль сроков</h2></div>
        <div style="text-align:center;padding:60px 0">
          <div style="font-size:80px;margin-bottom:20px">&#9989;</div>
          <div style="font-size:28px;color:#4ade80;font-weight:700">Все работы в графике</div>
          <div style="font-size:14px;color:rgba(255,255,255,.3);margin-top:12px">Просроченных работ нет</div>
        </div>`;
    }

    return `
      <div class="bs-title"><h2 style="color:#f87171">Просроченные работы</h2><div class="bs-subtitle">${overdue.length} работ требуют внимания</div></div>
      <table class="bs-tbl">
        <thead><tr><th>#</th><th>Работа</th><th>Заказчик</th><th>РП</th><th>Дедлайн</th><th>Просрочка</th></tr></thead>
        <tbody>${overdue.map((w, i) => {
          const days = Math.round((d.now - new Date(w.end_plan)) / 86400000);
          const severity = days > 30 ? 'c-red' : days > 14 ? 'c-amber' : 'c-amber';
          return `<tr>
            <td class="rank">${i + 1}</td>
            <td style="font-weight:600">${esc(w.work_title || w.work_name || '')}</td>
            <td>${esc(w.customer_name || '—')}</td>
            <td>${esc(byPm.get(w.pm_id) || '—')}</td>
            <td>${new Date(w.end_plan).toLocaleDateString('ru-RU')}</td>
            <td class="${severity}" style="font-weight:900;font-size:20px">+${days} дн.</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    `;
  }

  // ───────────────────────────────────────────────────────
  //  SLIDE 7: Team & Permits
  // ───────────────────────────────────────────────────────
  function slideTeamAndPermits(d) {
    // Team by role
    const activeUsers = d.users.filter(u => u.is_active);
    const roleGroups = {};
    activeUsers.forEach(u => { const r = u.role || 'Другое'; roleGroups[r] = (roleGroups[r] || 0) + 1; });
    const roleData = Object.entries(roleGroups).sort((a,b) => b[1] - a[1]);
    const maxRole = Math.max(...roleData.map(r => r[1]), 1);

    const roleNames = {
      ADMIN:'Администратор', PM:'Руководитель проекта', HEAD_PM:'Глав. РП',
      TO:'Тендерный отдел', HEAD_TO:'Глав. ТО', HR:'Кадры', HR_MANAGER:'Директор по кадрам',
      BUH:'Бухгалтерия', PROC:'Снабжение', WAREHOUSE:'Склад', CHIEF_ENGINEER:'Главный инженер',
      OFFICE_MANAGER:'Офис-менеджер', DIRECTOR_GEN:'Ген. директор',
      DIRECTOR_COMM:'Ком. директор', DIRECTOR_DEV:'Тех. директор'
    };

    // Expiring permits
    const expiring = d.permits.filter(p => {
      if (!p.expiry_date) return false;
      const days = Math.round((new Date(p.expiry_date) - d.now) / 86400000);
      return days >= 0 && days <= 60;
    }).sort((a,b) => new Date(a.expiry_date) - new Date(b.expiry_date)).slice(0, 8);

    return `
      <div class="bs-title"><h2>Команда и допуски</h2><div class="bs-subtitle">${activeUsers.length} сотрудников &middot; ${d.permits.length} допусков</div></div>
      <div class="bs-cols">
        <div>
          <div class="bs-col-title">Состав по ролям (${activeUsers.length})</div>
          ${roleData.map(([role, count]) => `
            <div class="bs-bar">
              <div class="bs-bar-lbl">${roleNames[role] || role}</div>
              <div class="bs-bar-track"><div class="bs-bar-fill" style="width:${Math.round((count/maxRole)*100)}%;background:#3b82f6">${count}</div></div>
              <div class="bs-bar-val c-blue">${count}</div>
            </div>
          `).join('')}
        </div>
        <div>
          <div class="bs-col-title">Истекающие допуски (60 дней)</div>
          ${expiring.length ? `<table class="bs-tbl">
            <thead><tr><th>Сотрудник</th><th>Допуск</th><th>Осталось</th></tr></thead>
            <tbody>${expiring.map(p => {
              const days = Math.round((new Date(p.expiry_date) - d.now) / 86400000);
              const color = days <= 7 ? 'c-red' : days <= 21 ? 'c-amber' : 'c-green';
              return `<tr><td style="font-weight:600">${esc(p.employee_name || p.fio || '—')}</td><td>${esc(p.permit_type || p.type || '')}</td><td class="${color}" style="font-weight:700">${days} дн.</td></tr>`;
            }).join('')}</tbody>
          </table>` : '<div style="text-align:center;padding:40px;color:rgba(255,255,255,.3)"><div style="font-size:40px;margin-bottom:8px">&#9989;</div>Все допуски в порядке</div>'}
        </div>
      </div>
    `;
  }

  // ───────────────────────────────────────────────────────
  //  SLIDE 8: Pre-Tenders & Equipment
  // ───────────────────────────────────────────────────────
  function slidePreTendersAndEquipment(d) {
    const pt = d.preTenderStats;
    const eq = d.equipmentStats;
    const totalPT = (pt.total_new || 0) + (pt.total_in_review || 0) + (pt.total_need_docs || 0);

    const eqCount = eq.equipment_count || 0;
    const eqBook = eq.total_book_value || 0;
    const eqPurch = eq.total_purchase_price || 0;
    const eqDepr = eq.total_depreciation || 0;
    const deprecPct = eqPurch > 0 ? Math.round((eqDepr / eqPurch) * 100) : 0;

    // Cash summary
    const cashByStatus = {};
    d.cash.forEach(c => { cashByStatus[c.status] = (cashByStatus[c.status] || 0) + 1; });

    return `
      <div class="bs-title"><h2>Заявки, активы, касса</h2><div class="bs-subtitle">Операционная сводка</div></div>
      <div class="bs-kpi">
        <div class="bs-kpi-card c-blue"><div class="bs-kpi-lbl">Входящие заявки</div><div class="bs-kpi-val c-blue">${totalPT}</div><div class="bs-kpi-sub">Новых: ${pt.total_new || 0} &middot; На рассмотрении: ${pt.total_in_review || 0}</div></div>
        <div class="bs-kpi-card c-green"><div class="bs-kpi-lbl">Принято заявок</div><div class="bs-kpi-val c-green">${pt.total_accepted || 0}</div><div class="bs-kpi-sub">стали тендерами</div></div>
        <div class="bs-kpi-card c-gold"><div class="bs-kpi-lbl">ТМЦ на балансе</div><div class="bs-kpi-val c-gold">${eqCount}</div><div class="bs-kpi-sub">Стоимость: ${_m(eqBook)}</div></div>
        <div class="bs-kpi-card c-purple"><div class="bs-kpi-lbl">Амортизация</div><div class="bs-kpi-val c-purple">${deprecPct}%</div><div class="bs-kpi-sub">${_m(eqDepr)} из ${_m(eqPurch)}</div></div>
      </div>
      <div style="margin-top:24px">
        <div class="bs-col-title" style="text-align:center">Касса — статусы заявок</div>
        <div style="display:flex;gap:16px;justify-content:center;margin-top:12px;flex-wrap:wrap">
          ${[
            { key:'requested', label:'Запрошено', color:'#3b82f6' },
            { key:'approved', label:'Одобрено', color:'#f59e0b' },
            { key:'received', label:'Получено', color:'#22c55e' },
            { key:'reporting', label:'Отчёт', color:'#8b5cf6' },
            { key:'closed', label:'Закрыто', color:'#94a3b8' }
          ].map(s => `
            <div style="text-align:center;min-width:100px">
              <div style="font-size:32px;font-weight:900;color:${s.color}">${cashByStatus[s.key] || 0}</div>
              <div style="font-size:11px;color:rgba(255,255,255,.3);margin-top:4px">${s.label}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  return { render };
})();
