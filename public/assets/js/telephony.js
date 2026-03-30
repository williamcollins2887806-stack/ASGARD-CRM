/* ==========================================================================
 *  ASGARD CRM  --  Telephony Page  v3.0  (Premium)
 *  Vanilla JS SPA page  |  IIFE pattern
 *  Features: skeleton loaders, tab transitions, CSS tooltips, multi-line
 *  chart with crosshair, SSE real-time badges, waveform caching,
 *  drag-and-drop routing, enhanced transcript viewer, responsive & dark-ready
 * ========================================================================== */
window.AsgardTelephonyPage = (function () {
  'use strict';

  /* ---------------- framework shortcuts ---------------- */
  const { $, $$, esc, toast, showModal } = AsgardUI;
  const token = () => AsgardAuth.getToken();
  const user  = () => { const a = AsgardAuth.getAuth(); return a && a.user ? a.user : null; };

  /* ---------------- constants & helpers ---------------- */
  const PAGE_SIZE       = 25;
  const WAVEFORM_BARS   = 200;
  const SPEED_OPTIONS   = [1, 1.5, 2];
  const TABS            = ['log', 'missed', 'stats', 'analytics', 'routing'];
  const TAB_LABELS      = { log: 'Журнал', missed: 'Пропущенные', stats: 'Статистика', analytics: 'Аналитика', routing: 'Маршрутизация' };
  const DIR_ICONS       = { inbound: '\u2199', outbound: '\u2197', missed: '\u21A9', internal: '\u21C4' };
  const DIR_LABELS      = { inbound: 'Входящий', outbound: 'Исходящий', missed: 'Пропущенный', internal: 'Внутренний' };
  const DIR_TOOLTIPS    = { inbound: 'Входящий звонок', outbound: 'Исходящий звонок', missed: 'Пропущенный звонок', internal: 'Внутренний звонок' };
  const STATUS_LABELS   = { done: 'Готов', pending: 'Ожидание', processing: 'Обработка', error: 'Ошибка', none: '\u2014' };
  const STATUS_TOOLTIPS = { done: 'Транскрипт готов', pending: 'В очереди на обработку', processing: 'Обработка\u2026', error: 'Ошибка транскрипции', none: 'Нет транскрипта' };

  let _activeTab   = 'log';
  let _logPage     = 1;
  let _missedBadge = 0;
  let _detailAudio = null;
  let _rafId       = null;
  let _chartTooltipEl = null;
  let _sseInitialized = false;

  /* ---------------- Waveform peaks cache (LRU-limited) --- */
  const _peaksCache = new Map();
  const PEAKS_CACHE_MAX = 20;

  function cachePeaks(key, value) {
    if (_peaksCache.size >= PEAKS_CACHE_MAX) {
      var oldest = _peaksCache.keys().next().value;
      var old = _peaksCache.get(oldest);
      if (old && old.blobUrl) URL.revokeObjectURL(old.blobUrl);
      _peaksCache.delete(oldest);
    }
    _peaksCache.set(key, value);
  }

  /* ======================================================================
   *  CSS INJECTION  (skeleton, tooltips, transitions, chart, transcript)
   * ====================================================================== */
  (function injectStyles() {
    if (document.getElementById('telephony-v3-styles')) return;
    const style = document.createElement('style');
    style.id = 'telephony-v3-styles';
    style.textContent = `
/* --- Filter inputs dark theme --- */      .telephony-filters input,.telephony-filters select{background:var(--bg3,#1e1e2f);color:var(--t1,#e5e7eb);border:1px solid var(--brd,#444);border-radius:6px;padding:8px 12px;font-size:14px;outline:none}      .telephony-filters input::placeholder{color:var(--t3,#6b7280)}      .telephony-filters input:focus,.telephony-filters select:focus{border-color:var(--blue,#3b82f6)}      .telephony-filters select option{background:var(--bg2,#161625);color:var(--t1,#e5e7eb)}      .telephony-page label input,.telephony-page label select{background:var(--bg3,#1e1e2f);color:var(--t1,#e5e7eb);border:1px solid var(--brd,#444);border-radius:6px;padding:8px 12px;font-size:14px}      .telephony-page label{color:var(--t2,#d1d5db)}
      /* --- Skeleton shimmer --- */
      .skeleton{background:linear-gradient(90deg,var(--bg3,#2a2a3e) 25%,var(--bg4,#33334d) 50%,var(--bg3,#2a2a3e) 75%);background-size:200% 100%;animation:skeleton-shimmer 1.5s infinite;border-radius:4px;display:inline-block}
      @keyframes skeleton-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
      .skeleton-row{display:flex;align-items:center;gap:12px;padding:10px 12px;border-bottom:1px solid var(--brd,#333)}
      .skeleton-bar{height:14px}
      .skeleton-card{border:1px solid var(--brd,#333);border-radius:8px;padding:16px;margin-bottom:12px}
      .skeleton-kpi{border:1px solid var(--brd,#333);border-radius:8px;padding:20px;text-align:center;min-width:140px;flex:1}
      .skeleton-chart{border:1px solid var(--brd,#333);border-radius:8px;height:280px;margin-top:16px}

      /* --- Tab content transition --- */
      #telContent{transition:opacity 0.15s ease}

      /* --- CSS-only tooltips --- */
      [data-tooltip]{position:relative}
      [data-tooltip]::after{content:attr(data-tooltip);position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%) scale(0.9);padding:4px 10px;background:var(--bg1,#1a1a2e);color:#fff;font-size:12px;border-radius:4px;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity 0.15s,transform 0.15s;z-index:100;box-shadow:0 2px 8px rgba(0,0,0,.3)}
      [data-tooltip]:hover::after{opacity:1;transform:translateX(-50%) scale(1)}

      /* --- Chart tooltip --- */
      .chart-crosshair-tooltip{position:absolute;pointer-events:none;z-index:50;background:var(--bg1,#1a1a2e);color:#fff;font-size:12px;border-radius:6px;padding:8px 12px;box-shadow:0 4px 16px rgba(0,0,0,.35);line-height:1.6;white-space:nowrap}
      .chart-crosshair-tooltip .ct-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle}
      .chart-legend{display:flex;gap:20px;padding:6px 0 10px;font-size:13px;color:var(--t2,#9ca3af)}
      .chart-legend-item{display:flex;align-items:center;gap:6px}
      .chart-legend-dot{width:10px;height:10px;border-radius:50%}

      /* --- AI Analysis Card --- */
      .ai-analysis-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;margin-top:8px;font-size:13px}
      .ai-analysis-grid dt{color:var(--t3,#6b7280);font-weight:500}
      .ai-analysis-grid dd{color:var(--t1,#e5e7eb);margin:0}
      .ai-analysis-section{margin-top:12px;padding-top:10px;border-top:1px solid var(--brd,#333)}
      .ai-analysis-section-title{font-size:12px;font-weight:600;color:var(--t3,#6b7280);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
      .ai-next-steps{list-style:none;padding:0;margin:4px 0 0}
      .ai-next-steps li{padding:4px 0;color:var(--t2,#d1d5db);font-size:13px}
      .ai-next-steps li::before{content:"→ ";color:var(--blue,#3b82f6)}
      .ai-key-reqs{list-style:disc;padding-left:16px;margin:4px 0 0;font-size:13px;color:var(--t2,#d1d5db)}
      .ai-quality-bar{height:6px;border-radius:3px;background:var(--bg4,#33334d);margin-top:4px;overflow:hidden}
      .ai-quality-fill{height:100%;border-radius:3px;transition:width .3s}
      .ai-urgency-badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600}
      .ai-urgency--critical{background:#dc262622;color:#ef4444;border:1px solid #ef444444}
      .ai-urgency--high{background:#f9731622;color:#f97316;border:1px solid #f9731644}
      .ai-urgency--medium{background:#eab30822;color:#eab308;border:1px solid #eab30844}
      .ai-urgency--low{background:#22c55e22;color:#22c55e;border:1px solid #22c55e44}
      .ai-action-btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
      
      /* --- Transcript viewer --- */
      .transcript-viewer{max-height:340px;overflow-y:auto;padding:12px;background:var(--bg3,#1e1e2f);border-radius:6px;font-family:'Fira Code','JetBrains Mono',monospace;font-size:13px;line-height:1.75}
      .transcript-line{padding:3px 0}
      .transcript-speaker{font-weight:600;margin-right:8px;padding:1px 6px;border-radius:3px;font-size:12px}
      .transcript-speaker--client{background:var(--blue,#3b82f6);color:#fff}
      .transcript-speaker--manager{background:var(--green,#22c55e);color:#fff}
      .transcript-text{color:var(--t2,#d1d5db)}
      .transcript-copy-btn{cursor:pointer;font-size:13px;margin-left:8px;vertical-align:middle;background:none;border:1px solid var(--brd,#444);border-radius:4px;padding:2px 8px;color:var(--t2,#9ca3af)}
      .transcript-copy-btn:hover{background:var(--bg4,#33334d)}

      /* --- Drag-and-drop routing --- */
      .routing-rule-card{transition:transform 0.15s,box-shadow 0.15s;cursor:grab}
      .routing-rule-card--dragging{opacity:0.4;cursor:grabbing}
      .routing-rule-card--drag-above{border-top:2px solid var(--blue,#3b82f6)}
      .routing-rule-card--drag-below{border-bottom:2px solid var(--blue,#3b82f6)}

      /* ═══ WOW KEYFRAME ANIMATIONS ═══ */
      @keyframes telRowSlideIn{0%{opacity:0;transform:translateY(18px)}100%{opacity:1;transform:translateY(0)}}
      @keyframes telCardSlideUp{0%{opacity:0;transform:translateY(24px) scale(.97)}100%{opacity:1;transform:translateY(0) scale(1)}}
      @keyframes telCountFlash{0%{box-shadow:0 0 0 0 rgba(212,168,67,.5)}50%{box-shadow:0 0 18px 4px rgba(212,168,67,.25)}100%{box-shadow:0 0 0 0 transparent}}
      @keyframes telGoldenGlow{0%{box-shadow:0 0 0 0 rgba(212,168,67,0)}50%{box-shadow:0 0 16px 2px rgba(212,168,67,.18)}100%{box-shadow:0 0 0 0 rgba(212,168,67,0)}}
      @keyframes telMissedPulse{0%,100%{border-color:var(--red,#ef4444);box-shadow:0 0 0 0 rgba(239,68,68,.3)}50%{border-color:#ff6b6b;box-shadow:0 0 12px 2px rgba(239,68,68,.15)}}
      @keyframes telShimmerSweep{0%{left:-100%}100%{left:100%}}
      @keyframes telRecordPulse{0%,100%{opacity:.7;transform:scale(1)}50%{opacity:1;transform:scale(1.15)}}
      @keyframes telChartDraw{0%{stroke-dashoffset:var(--path-len,2000)}100%{stroke-dashoffset:0}}

      /* ═══ JOURNAL — WOW ROWS ═══ */
      .call-row-wow{animation:telRowSlideIn .3s ease both;border-left:3px solid transparent;transition:background .15s,box-shadow .15s}
      .call-row-wow--inbound{border-left-color:var(--green,#22c55e)}
      .call-row-wow--outbound{border-left-color:var(--blue,#3b82f6)}
      .call-row-wow--missed{border-left-color:var(--red,#ef4444)}
      .call-row-wow--internal{border-left-color:#D4A843}
      .call-row-wow:hover{background:rgba(212,168,67,.04);box-shadow:inset 0 0 0 1px rgba(212,168,67,.08)}

      /* Record icon in table */
      .call-record-icon{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:rgba(59,130,246,.12);color:var(--blue,#3b82f6);font-size:11px;cursor:pointer;animation:telRecordPulse 2s ease-in-out infinite;vertical-align:middle;margin-left:4px}
      .call-record-icon:hover{background:rgba(59,130,246,.25)}

      /* DaData badge in table */
      .call-dadata-badge{display:inline-block;padding:1px 7px;border-radius:10px;font-size:10px;font-weight:500;background:rgba(212,168,67,.1);color:#D4A843;border:1px solid rgba(212,168,67,.2);margin-left:6px;vertical-align:middle;white-space:nowrap}

      /* AI preview popup on hover */
      .call-ai-preview{position:absolute;z-index:200;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);background:var(--bg1,#1a1a2e);color:#fff;padding:10px 14px;border-radius:8px;font-size:12px;line-height:1.5;max-width:320px;white-space:normal;box-shadow:0 8px 24px rgba(0,0,0,.4);pointer-events:none;opacity:0;transition:opacity .2s;border:1px solid rgba(212,168,67,.15)}
      .call-row-wow:hover .call-ai-preview{opacity:1}

      /* Pill filter buttons */
      .tel-filter-pills{display:flex;gap:4px;flex-wrap:wrap}
      .tel-filter-pill{padding:6px 14px;border-radius:20px;border:1px solid var(--brd,#444);background:transparent;color:var(--t2,#9ca3af);font-size:12px;font-weight:500;cursor:pointer;transition:all .2s}
      .tel-filter-pill:hover{border-color:rgba(212,168,67,.3);color:var(--t1,#e5e7eb)}
      .tel-filter-pill--active{background:linear-gradient(135deg,rgba(200,41,59,.15),rgba(30,77,140,.15));color:#D4A843;border-color:rgba(212,168,67,.3);box-shadow:0 0 8px rgba(212,168,67,.1)}

      /* ═══ KPI CARDS — WOW ═══ */
      .telephony-kpi-wow{position:relative;background:var(--bg3,#1e1e2f);border:none;border-radius:12px;padding:20px 18px;text-align:center;overflow:hidden;transition:transform .25s,box-shadow .25s}
      .telephony-kpi-wow::before{content:'';position:absolute;inset:-1px;border-radius:12px;background:linear-gradient(135deg,#C8293B,#1E4D8C);z-index:0;opacity:.7}
      .telephony-kpi-wow::after{content:'';position:absolute;inset:1px;border-radius:11px;background:var(--bg3,#1e1e2f);z-index:1}
      .telephony-kpi-wow>*{position:relative;z-index:2}
      .telephony-kpi-wow:hover{transform:translateY(-4px);box-shadow:0 8px 24px rgba(212,168,67,.12);animation:telGoldenGlow 1.5s ease-in-out}
      .telephony-kpi-icon-wow{width:42px;height:42px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;font-size:20px;margin-bottom:8px}
      .telephony-kpi-icon-wow--total{background:rgba(59,130,246,.12);color:var(--blue,#3b82f6)}
      .telephony-kpi-icon-wow--inbound{background:rgba(34,197,94,.12);color:var(--green,#22c55e)}
      .telephony-kpi-icon-wow--missed{background:rgba(239,68,68,.12);color:var(--red,#ef4444)}
      .telephony-kpi-icon-wow--duration{background:rgba(212,168,67,.12);color:#D4A843}
      .kpi-trend{display:inline-block;font-size:11px;font-weight:600;margin-top:4px;padding:2px 6px;border-radius:8px}
      .kpi-trend--up{color:#22c55e;background:rgba(34,197,94,.1)}
      .kpi-trend--down{color:#ef4444;background:rgba(239,68,68,.1)}

      /* ═══ MISSED CARDS — WOW ═══ */
      .missed-card-wow{animation:telCardSlideUp .35s ease both;position:relative;overflow:hidden}
      .missed-card-wow--unack{animation:telCardSlideUp .35s ease both,telMissedPulse 2s ease-in-out 3;border:1px solid var(--red,#ef4444)}
      .missed-card-wow--unack::after{content:'';position:absolute;top:0;left:-100%;width:100%;height:100%;background:linear-gradient(90deg,transparent,rgba(239,68,68,.06),transparent);animation:telShimmerSweep 3s ease-in-out infinite;pointer-events:none}
      .missed-time-ago{display:inline-block;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:600;background:rgba(239,68,68,.1);color:var(--red,#ef4444);margin-left:6px}
      .missed-dadata-info{display:inline-block;font-size:10px;color:var(--t3,#6b7280);margin-left:6px;padding:1px 6px;background:rgba(212,168,67,.08);border-radius:8px}

      /* ═══ AI INSIGHTS CARD ═══ */
      .tel-ai-insights{position:relative;background:var(--bg3,#1e1e2f);border-radius:12px;padding:20px;margin-bottom:20px;overflow:hidden;border:1px solid rgba(212,168,67,.2)}
      .tel-ai-insights::before{content:'';position:absolute;inset:-1px;border-radius:12px;background:linear-gradient(135deg,rgba(212,168,67,.3),rgba(59,130,246,.2));z-index:0;pointer-events:none}
      .tel-ai-insights::after{content:'';position:absolute;inset:1px;border-radius:11px;background:var(--bg3,#1e1e2f);z-index:1}
      .tel-ai-insights>*{position:relative;z-index:2}
      .tel-ai-insights-title{font-size:14px;font-weight:600;color:#D4A843;margin-bottom:12px;display:flex;align-items:center;gap:8px}
      .tel-ai-insights-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px}
      .tel-ai-insight-item{text-align:center}
      .tel-ai-insight-value{font-size:24px;font-weight:700;color:var(--t1,#e5e7eb)}
      .tel-ai-insight-label{font-size:11px;color:var(--t3,#6b7280);text-transform:uppercase;letter-spacing:.04em;margin-top:2px}

      /* ═══ TRANSCRIPT SEGMENTS (diarization) ═══ */
      .transcript-seg-row{display:flex;gap:10px;padding:8px 12px;border-radius:6px;transition:background .15s;align-items:flex-start}
      .transcript-seg-row:hover{background:rgba(255,255,255,.03)}
      .transcript-seg-row--active{background:var(--blue-bg,rgba(59,130,246,.1)) !important}
      .transcript-seg-time{font-size:11px;font-family:var(--mono,monospace);color:var(--blue,#3b82f6);cursor:pointer;white-space:nowrap;min-width:44px;padding-top:2px;transition:color .15s}
      .transcript-seg-time:hover{color:#D4A843}
      .transcript-seg-speaker--0{font-size:11px;font-weight:700;color:var(--blue-l,#60a5fa);min-width:60px;padding-top:2px}
      .transcript-seg-speaker--1{font-size:11px;font-weight:700;color:#D4A843;min-width:60px;padding-top:2px}
      .transcript-seg-text{font-size:13px;color:var(--t1,#e5e7eb);line-height:1.5;flex:1}

      /* ═══ DETAIL DADATA CHIPS ═══ */
      .detail-dadata-chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
      .detail-dadata-chip{display:inline-flex;align-items:center;gap:5px;padding:4px 12px;border-radius:16px;font-size:12px;font-weight:500;background:rgba(212,168,67,.08);color:#D4A843;border:1px solid rgba(212,168,67,.15)}
      .detail-dadata-chip-icon{font-size:14px;opacity:.7}

      /* --- Responsive --- */
      @media(max-width:768px){
        .telephony-dashboard{grid-template-columns:1fr 1fr !important}
        .call-log-table{font-size:12px}
        .call-log-table .ai-col{display:none}
        .tel-ai-insights-grid{grid-template-columns:1fr}
      }
      @media(max-width:480px){
        .telephony-dashboard{grid-template-columns:1fr !important}
        .telephony-filters{flex-direction:column}
      }
    `;
    document.head.appendChild(style);
  })();

  /* ---- formatting ---- */
  function fmtPhone(raw) {
    if (!raw) return '\u2014';
    const d = String(raw).replace(/\D/g, '');
    if (d.length === 11 && (d[0] === '7' || d[0] === '8')) {
      return '+7 (' + d.slice(1, 4) + ') ' + d.slice(4, 7) + '-' + d.slice(7, 9) + '-' + d.slice(9, 11);
    }
    return raw;
  }

  function fmtDuration(sec) {
    if (sec == null || sec < 0) return '\u2014';
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function fmtDate(iso) {
    if (!iso) return '\u2014';
    var d = new Date(iso);
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function fmtDateShort(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return pad(d.getDate()) + '.' + pad(d.getMonth() + 1);
  }

  function todayISO()    { return new Date().toISOString().slice(0, 10); }
  function monthAgoISO() { var d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 10); }

  /* ---- WOW helpers ---- */
  function fmtTimeAgo(iso) {
    if (!iso) return '';
    var diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return 'только что';
    if (diff < 3600) return Math.floor(diff / 60) + ' мин. назад';
    if (diff < 86400) return Math.floor(diff / 3600) + ' ч. назад';
    if (diff < 604800) return Math.floor(diff / 86400) + ' дн. назад';
    return fmtDate(iso);
  }

  function animateCountUp(el, target, duration) {
    duration = duration || 800;
    var isNum = typeof target === 'number';
    if (!isNum) { el.textContent = target; return; }
    var start = 0;
    var startTime = null;
    function easeOutQuart(t) { return 1 - Math.pow(1 - t, 4); }
    function step(ts) {
      if (!startTime) startTime = ts;
      var progress = Math.min((ts - startTime) / duration, 1);
      var val = Math.round(easeOutQuart(progress) * target);
      el.textContent = val;
      if (progress < 1) { requestAnimationFrame(step); }
      else { el.textContent = target; el.closest('.telephony-kpi-wow').style.animation = 'telCountFlash .6s ease'; }
    }
    requestAnimationFrame(step);
  }

  function staggerDelay(index, base) { return (base || 40) * index; }

  function lerpColor(hexA, hexB, t) {
    var a = parseInt(hexA.replace('#',''), 16);
    var b = parseInt(hexB.replace('#',''), 16);
    var rA = (a >> 16) & 0xff, gA = (a >> 8) & 0xff, bA = a & 0xff;
    var rB = (b >> 16) & 0xff, gB = (b >> 8) & 0xff, bB = b & 0xff;
    var r = Math.round(rA + (rB - rA) * t);
    var g = Math.round(gA + (gB - gA) * t);
    var bl = Math.round(bA + (bB - bA) * t);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1);
  }

  /* ---- API helper (with retry for GET) ---- */
  async function api(path, opts) {
    opts = opts || {};
    var method = opts.method || 'GET';
    var maxAttempts = method === 'GET' ? 2 : 1;
    var lastErr;

    for (var attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        var res = await fetch('/api/telephony' + path, {
          headers: Object.assign({ 'Authorization': 'Bearer ' + token() }, opts.headers || {}),
          method: method,
          body: opts.body || undefined,
        });
        if (!res.ok) {
          var errMsg = 'API ' + res.status;
          try { var errBody = await res.json(); errMsg = errBody.error || errBody.message || errMsg; } catch (_) {}
          if (res.status === 429) toast('Слишком много запросов, подождите', 'error');
          throw new Error(errMsg);
        }
        var text = await res.text();
        if (!text) throw new Error('Empty response body');
        return JSON.parse(text);
      } catch (err) {
        lastErr = err;
        console.warn('[Telephony] api(' + path + ') attempt ' + attempt + ' failed:', err.message || err);
        if (attempt < maxAttempts) {
          await new Promise(function (r) { setTimeout(r, 600); });
        }
      }
    }
    throw lastErr;
  }

  /* ---- DOM helpers ---- */
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function emptyState(icon, message) {
    return '<div class="telephony-empty"><span style="font-size:2.4rem">' + icon + '</span><p>' + esc(message) + '</p></div>';
  }

  /* ======================================================================
   *  SKELETON LOADERS
   * ====================================================================== */
  function skeletonTable(rows) {
    rows = rows || 5;
    var widths = [90, 30, 130, 55, 100, 160, 60];
    var header = '<div class="skeleton-row" style="opacity:0.4">';
    widths.forEach(function (w) {
      header += '<div class="skeleton skeleton-bar" style="width:' + w + 'px;height:12px"></div>';
    });
    header += '</div>';

    var body = '';
    for (var i = 0; i < rows; i++) {
      body += '<div class="skeleton-row">';
      widths.forEach(function (w) {
        var jitter = Math.round(w * (0.7 + Math.random() * 0.5));
        body += '<div class="skeleton skeleton-bar" style="width:' + jitter + 'px"></div>';
      });
      body += '</div>';
    }
    return '<div>' + header + body + '</div>';
  }

  function skeletonCards(count) {
    count = count || 3;
    var html = '';
    for (var i = 0; i < count; i++) {
      html += '<div class="skeleton-card">' +
        '<div style="display:flex;gap:12px;align-items:center">' +
        '<div class="skeleton" style="width:36px;height:36px;border-radius:50%"></div>' +
        '<div style="flex:1">' +
        '<div class="skeleton skeleton-bar" style="width:' + (120 + Math.round(Math.random() * 80)) + 'px;margin-bottom:8px"></div>' +
        '<div class="skeleton skeleton-bar" style="width:' + (80 + Math.round(Math.random() * 60)) + 'px;height:11px"></div>' +
        '</div>' +
        '<div style="display:flex;gap:8px">' +
        '<div class="skeleton" style="width:80px;height:30px;border-radius:4px"></div>' +
        '<div class="skeleton" style="width:70px;height:30px;border-radius:4px"></div>' +
        '</div></div></div>';
    }
    return html;
  }

  function skeletonStats() {
    var kpis = '';
    for (var i = 0; i < 4; i++) {
      kpis += '<div class="skeleton-kpi">' +
        '<div class="skeleton skeleton-bar" style="width:60px;height:28px;margin:0 auto 10px"></div>' +
        '<div class="skeleton skeleton-bar" style="width:90px;height:12px;margin:0 auto"></div></div>';
    }
    return '<div class="telephony-dashboard">' + kpis + '</div>' +
      '<div class="skeleton skeleton-chart"></div>';
  }

  function skeletonRules() {
    var html = '';
    for (var i = 0; i < 3; i++) {
      html += '<div class="skeleton-card">' +
        '<div style="display:flex;justify-content:space-between;align-items:center">' +
        '<div><div class="skeleton skeleton-bar" style="width:' + (140 + Math.round(Math.random() * 80)) + 'px;margin-bottom:8px"></div>' +
        '<div class="skeleton skeleton-bar" style="width:' + (180 + Math.round(Math.random() * 60)) + 'px;height:11px"></div></div>' +
        '<div style="display:flex;gap:8px">' +
        '<div class="skeleton" style="width:70px;height:28px;border-radius:4px"></div>' +
        '<div class="skeleton" style="width:70px;height:28px;border-radius:4px"></div>' +
        '<div class="skeleton" style="width:60px;height:28px;border-radius:4px"></div>' +
        '</div></div></div>';
    }
    return html;
  }

  /* ======================================================================
   *  SSE REAL-TIME BADGES
   * ====================================================================== */
  function initSSE() {
    if (_sseInitialized) return;
    _sseInitialized = true;

    /* Listen to SSE events dispatched by app.js global SSE handler.
       app.js listens to call:incoming, call:connected, call:ended from SSE
       and we hook into the same global SSE source if available. */
    function onMissed() {
      _missedBadge++;
      updateMissedBadgeUI();
      if (_activeTab === 'missed') {
        var c = $('#telContent');
        if (c) renderMissed(c);
      }
    }

    function onCallEnded() {
      if (_activeTab === 'missed') {
        var c = $('#telContent');
        if (c) renderMissed(c);
      }
      fetchMissedBadge();
    }

    function onCallIncoming() {
      fetchMissedBadge();
    }

    /* Hook into the global SSE source from app.js */
    function hookGlobalSSE() {
      var src = window._asgardSSE || window._sseSource;
      if (src && src.readyState !== 2) {
        src.addEventListener('call:missed', onMissed);
        src.addEventListener('call:ended', onCallEnded);
        src.addEventListener('call:incoming', onCallIncoming);
        return true;
      }
      return false;
    }

    /* Try to hook immediately, or retry a few times */
    if (!hookGlobalSSE()) {
      var attempts = 0;
      var interval = setInterval(function () {
        if (hookGlobalSSE() || ++attempts > 10) clearInterval(interval);
      }, 1000);
    }

    /* Also listen for custom document events (if dispatched) */
    document.addEventListener('telephony:missed', onMissed);
    document.addEventListener('telephony:call_ended', onCallEnded);
    document.addEventListener('telephony:call_incoming', onCallIncoming);
  }

  function updateMissedBadgeUI() {
    var badge = $('.telephony-tab-badge');
    if (badge) badge.textContent = _missedBadge > 0 ? _missedBadge : '';
    document.title = _missedBadge > 0
      ? '(' + _missedBadge + ') \u0422\u0435\u043B\u0435\u0444\u043E\u043D\u0438\u044F \u2014 ASGARD CRM'
      : '\u0422\u0435\u043B\u0435\u0444\u043E\u043D\u0438\u044F \u2014 ASGARD CRM';
  }

  /* ======================================================================
   *  MAIN RENDER
   * ====================================================================== */
  async function render(opts) {
    var layout = opts.layout;
    var query  = opts.query || {};
    // title passed in layout() call

    _activeTab = query.tab || 'log';
    if (TABS.indexOf(_activeTab) === -1) _activeTab = 'log';

    /* pre-fetch missed badge count (non-blocking) */
    fetchMissedBadge();

    /* init SSE listeners */
    initSSE();

    const html =
      '<div class="telephony-page">' +
        '<div class="telephony-tabs" id="telTabs"></div>' +
        '<div id="telContent" style="opacity:1"></div>' +
        '<div class="call-detail-overlay" id="detailOverlay"></div>' +
        '<div class="call-detail-panel" id="detailPanel">' +
          '<div class="call-detail-header" id="detailHeader"></div>' +
          '<div class="call-detail-body" id="detailBody"></div>' +
        '</div>' +
      '</div>';
    await layout(html, { title: '\u0422\u0435\u043b\u0435\u0444\u043e\u043d\u0438\u044f' });

    renderTabs();
    activateTab(_activeTab);

    var overlay = $('#detailOverlay');
    if (overlay) overlay.addEventListener('click', closeDetailPanel);
  }

  /* ---- Tabs ---- */
  function renderTabs() {
    var wrap = $('#telTabs');
    if (!wrap) return;
    var r = user().role || '';
    var isAdmin = r === 'ADMIN' || r === 'DIRECTOR_GEN' || r === 'DIRECTOR_COM';

    wrap.innerHTML = TABS
      .filter(function (t) {
        if (t === 'routing') return isAdmin;
        if (t === 'analytics') return isAdmin || r === 'DIRECTOR_COMM' || r === 'DIRECTOR_DEV';
        return true;
      })
      .map(function (t) {
        var badge = (t === 'missed' && _missedBadge > 0)
          ? '<span class="telephony-tab-badge">' + _missedBadge + '</span>' : '';
        return '<button class="telephony-tab' + (_activeTab === t ? ' telephony-tab--active' : '') + '" data-tab="' + t + '">' + esc(TAB_LABELS[t]) + badge + '</button>';
      }).join('');

    wrap.querySelectorAll('.telephony-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        _activeTab = btn.dataset.tab;
        history.replaceState(null, '', '#/telephony?tab=' + _activeTab);
        $$('.telephony-tab').forEach(function (b) { b.classList.remove('telephony-tab--active'); });
        btn.classList.add('telephony-tab--active');
        activateTab(_activeTab);
      });
    });
  }

  /* ---- Tab switching with fade transition ---- */
  async function activateTab(tab) {
    var c = $('#telContent');
    if (!c) return;
    destroyCurrentAudio();
    destroyChartTooltip();

    /* fade out */
    c.style.opacity = '0';
    await new Promise(function (r) { setTimeout(r, 150); });

    /* render new content */
    switch (tab) {
      case 'log':       renderLog(c);       break;
      case 'missed':    renderMissed(c);    break;
      case 'stats':     renderStats(c);     break;
      case 'analytics': renderAnalytics(c); break;
      case 'routing':   renderRouting(c);   break;
    }

    /* fade in */
    requestAnimationFrame(function () { c.style.opacity = '1'; });
  }

  async function fetchMissedBadge() {
    try {
      var data = await api('/missed?limit=1&acknowledged=false');
      _missedBadge = data.unacknowledged || 0;
      updateMissedBadgeUI();
    } catch (e) { /* silent */ }
  }

  /* ======================================================================
   *  TAB 1  --  ЖУРНАЛ (Call Log)
   * ====================================================================== */
  async function renderLog(container) {
    var pills = [
      { value: '', label: 'Все' },
      { value: 'inbound', label: '\u2199 Входящие' },
      { value: 'outbound', label: '\u2197 Исходящие' },
      { value: 'missed', label: '\u21A9 Пропущенные' },
      { value: 'internal', label: '\u21C4 Внутренние' },
    ];
    var pillsHtml = '<div class="tel-filter-pills" id="fTypePills">' +
      pills.map(function(p) {
        return '<button class="tel-filter-pill' + (p.value === '' ? ' tel-filter-pill--active' : '') + '" data-val="' + p.value + '">' + p.label + '</button>';
      }).join('') + '</div>';

    container.innerHTML =
      '<div class="telephony-filters" id="logFilters">' +
        '<input type="date" id="fDateFrom" value="' + monthAgoISO() + '">' +
        '<input type="date" id="fDateTo" value="' + todayISO() + '">' +
        pillsHtml +
        '<select id="fManager"><option value="">Все менеджеры</option></select>' +
        '<input type="text" id="fSearch" placeholder="Поиск по номеру / клиенту">' +
        '<button class="btn btn--primary" id="fApply">Применить</button>' +
      '</div>' +
      '<div id="logTableWrap">' + skeletonTable(5) + '</div>' +
      '<div class="telephony-pagination" id="logPagination"></div>';

    /* pill toggle */
    var pillWrap = $('#fTypePills');
    if (pillWrap) {
      pillWrap.addEventListener('click', function(e) {
        var btn = e.target.closest('.tel-filter-pill');
        if (!btn) return;
        pillWrap.querySelectorAll('.tel-filter-pill').forEach(function(b){ b.classList.remove('tel-filter-pill--active'); });
        btn.classList.add('tel-filter-pill--active');
        _logPage = 1;
        fetchLog();
      });
    }

    $('#fApply').addEventListener('click', function () { _logPage = 1; fetchLog(); });
    $('#fSearch').addEventListener('keydown', function (e) { if (e.key === 'Enter') { _logPage = 1; fetchLog(); } });

    loadManagerOptions();
    fetchLog();
  }

  async function loadManagerOptions() {
    try {
      var data = await api('/managers');
      var sel = $('#fManager');
      if (!sel) return;
      (data.managers || []).forEach(function (m) {
        var o = document.createElement('option');
        o.value = m.id;
        o.textContent = m.name;
        sel.appendChild(o);
      });
    } catch (e) { /* silent */ }
  }

  async function fetchLog() {
    var wrap = $('#logTableWrap');
    if (!wrap) return;
    wrap.innerHTML = skeletonTable(5);

    var activePill = document.querySelector('.tel-filter-pill--active');
    var callType = activePill ? (activePill.dataset.val || '') : '';
    var params = new URLSearchParams({
      page: _logPage,
      limit: PAGE_SIZE,
      date_from: ($('#fDateFrom') || {}).value || '',
      date_to:   ($('#fDateTo') || {}).value || '',
      call_type: callType,
      user_id: ($('#fManager') || {}).value || '',
      search:    ($('#fSearch') || {}).value || '',
    });

    try {
      var data = await api('/calls?' + params);
      renderLogTable(wrap, data.items || []);
      renderPagination(data.total || 0);
    } catch (err) {
      console.error('[Telephony] fetchLog error:', err);
      wrap.innerHTML = emptyState('\u26A0', 'Не удалось загрузить журнал');
      toast('Ошибка загрузки журнала', err.message || 'error', 'err');
    }
  }

  function renderLogTable(wrap, calls) {
    if (!calls.length) {
      wrap.innerHTML = emptyState('\uD83D\uDCDE', 'Нет звонков за выбранный период');
      return;
    }

    var rows = calls.map(function (c, idx) {
      var dir = c.call_type || 'missed';
      var dirCls  = 'call-dir call-dir--' + dir;
      var dirIcon = DIR_ICONS[dir] || '\u2014';
      var dirTip  = DIR_TOOLTIPS[dir] || '';
      var tStatus = c.transcript_status || 'none';
      var statusCls = 'call-status-badge--' + tStatus;
      var statusTip = STATUS_TOOLTIPS[tStatus] || '';
      var phone = dir === 'inbound' ? c.from_number : (c.line_number || c.to_number);
      var client = c.client_name ? esc(c.client_name) : esc(fmtPhone(phone));
      var hasRecord = c.record_path || c.recording_id;
      var recordIcon = hasRecord ? '<span class="call-record-icon" data-tooltip="Есть запись">\u23FA</span>' : '';
      var dadataBadge = c.dadata_city ? '<span class="call-dadata-badge">' + esc(c.dadata_city) + '</span>' : '';
      var aiPreview = c.ai_summary ? '<div class="call-ai-preview">' + esc(c.ai_summary.slice(0, 160)) + '</div>' : '';
      var delay = staggerDelay(idx, 40);
      var hasAi = !!c.ai_summary;

      var mainRow = '<tr class="call-row call-row-wow call-row-wow--' + dir + (hasAi ? ' call-row--expandable' : '') + '" data-id="' + esc(String(c.id)) + '" style="animation-delay:' + delay + 'ms;position:relative">' +
        '<td>' + esc(fmtDate(c.created_at)) + '</td>' +
        '<td><span class="' + dirCls + '" data-tooltip="' + esc(dirTip) + '">' + dirIcon + '</span>' + recordIcon + '</td>' +
        '<td style="position:relative">' + client + dadataBadge + aiPreview + '</td>' +
        '<td>' + esc(fmtDuration(c.duration_seconds)) + '</td>' +
        '<td>' + esc(c.manager_name || '\u2014') + '</td>' +
        '<td class="ai-col">' + (c.ai_summary ? esc(c.ai_summary.slice(0, 60)) + (c.ai_summary.length > 60 ? '\u2026' : '') : '\u2014') + '</td>' +
        '<td><span class="' + statusCls + '" data-tooltip="' + esc(statusTip) + '">' + esc(STATUS_LABELS[tStatus] || '\u2014') + '</span></td>' +
      '</tr>';

      // Accordion expand row для AI-анализа
      var expandRow = '';
      if (hasAi) {
        var tags = '';
        if (c.ai_is_target != null) {
          tags += '<span class="cr-badge ' + (c.ai_is_target ? 'cr-badge--weekly' : 'cr-badge--daily') + '">' +
            (c.ai_is_target ? '\uD83C\uDFAF Целевой' : '\u2014 Нецелевой') + '</span> ';
        }
        if (c.ai_sentiment) {
          var sentLabel = { positive: '\uD83D\uDFE2 Позитивный', neutral: '\uD83D\uDFE1 Нейтральный', negative: '\uD83D\uDD34 Негативный' };
          tags += '<span class="cr-badge">' + (sentLabel[c.ai_sentiment] || c.ai_sentiment) + '</span> ';
        }
        var ld = {};
        try { ld = typeof c.ai_lead_data === 'string' ? JSON.parse(c.ai_lead_data) : (c.ai_lead_data || {}); } catch(_){}
        if (ld.quality_score) {
          tags += '<span class="cr-badge" style="background:var(--gold-bg,#3d350d);color:var(--gold)">\u2B50 ' + ld.quality_score + '/10</span>';
        }

        expandRow = '<tr class="cr-call-expand" data-call-id="' + c.id + '" style="display:none">' +
          '<td colspan="7">' +
            '<div class="cr-call-analysis" style="padding:12px 16px;background:var(--bg2);border-radius:8px;margin:4px 0">' +
              (tags ? '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">' + tags + '</div>' : '') +
              '<div style="font-size:13px;color:var(--t2);line-height:1.6">' + esc(c.ai_summary) + '</div>' +
              (ld.key_requirements && ld.key_requirements.length ? '<div style="margin-top:8px;font-size:12px;color:var(--t3)">Требования: ' + ld.key_requirements.map(esc).join('; ') + '</div>' : '') +
              (ld.next_steps && ld.next_steps.length ? '<div style="margin-top:6px;font-size:12px;color:var(--t3)">Шаги: ' + ld.next_steps.map(esc).join('; ') + '</div>' : '') +
              '<div style="display:flex;gap:8px;margin-top:10px">' +
                '<button class="fk-btn fk-btn--sm" onclick="event.stopPropagation();openDetailPanel(' + c.id + ')">\uD83D\uDD0D Подробный AI-анализ</button>' +
                (c.ai_is_target ? '<button class="fk-btn fk-btn--sm fk-btn--secondary" onclick="event.stopPropagation();location.hash=\'#/tenders?action=create&from_call=' + c.id + '\'">\uD83D\uDCCB Создать заявку</button>' : '') +
              '</div>' +
            '</div>' +
          '</td>' +
        '</tr>';
      }

      return mainRow + expandRow;
    }).join('');

    wrap.innerHTML = '<table class="call-log-table">' +
      '<thead><tr>' +
        '<th>Дата/время</th><th>Направление</th><th>Клиент/Номер</th>' +
        '<th>Длительность</th><th>Сотрудник</th><th>AI-резюме</th><th>Статус</th>' +
      '</tr></thead>' +
      '<tbody>' + rows + '</tbody></table>';

    wrap.querySelectorAll('.call-row').forEach(function (row) {
      var next = row.nextElementSibling;
      if (next && next.classList.contains('cr-call-expand')) {
        row.style.cursor = 'pointer';
        row.addEventListener('click', function () {
          next.style.display = next.style.display === 'none' ? 'table-row' : 'none';
        });
      } else {
        row.addEventListener('click', function () { openDetailPanel(row.dataset.id); });
      }
    });
  }

  function renderPagination(total) {
    var pag = $('#logPagination');
    if (!pag) return;
    var pages = Math.ceil(total / PAGE_SIZE);
    if (pages <= 1) { pag.innerHTML = ''; return; }

    var html = '';
    /* smart pagination: show first, last, current +/- 2, and ellipses */
    var range = [];
    for (var i = 1; i <= pages; i++) {
      if (i === 1 || i === pages || (i >= _logPage - 2 && i <= _logPage + 2)) {
        range.push(i);
      }
    }
    var prev = 0;
    range.forEach(function (i) {
      if (prev && i - prev > 1) {
        html += '<span class="pagination-ellipsis">\u2026</span>';
      }
      html += '<button class="pagination-btn' + (i === _logPage ? ' pagination-btn--active' : '') + '" data-p="' + i + '">' + i + '</button>';
      prev = i;
    });

    pag.innerHTML = html;
    pag.querySelectorAll('.pagination-btn').forEach(function (b) {
      b.addEventListener('click', function () { _logPage = +b.dataset.p; fetchLog(); });
    });
  }

  /* ======================================================================
   *  TAB 2  --  ПРОПУЩЕННЫЕ (Missed Calls)
   * ====================================================================== */
  async function renderMissed(container) {
    container.innerHTML = skeletonCards(3);

    try {
      var data = await api('/missed');
      var items = data.items || [];
      if (!items.length) {
        container.innerHTML = emptyState('\u2705', 'Нет пропущенных звонков');
        return;
      }

      container.innerHTML = items.map(function (c, idx) {
        var unack = !c.missed_acknowledged;
        var cardCls = 'missed-call-card missed-card-wow' + (unack ? ' missed-card-wow--unack' : '');
        var delay = staggerDelay(idx, 60);
        var timeAgo = fmtTimeAgo(c.created_at);
        var dadataInfo = '';
        if (c.dadata_operator || c.dadata_city) {
          var parts = [];
          if (c.dadata_operator) parts.push(c.dadata_operator);
          if (c.dadata_city) parts.push(c.dadata_city);
          dadataInfo = '<span class="missed-dadata-info">' + esc(parts.join(' \u2022 ')) + '</span>';
        }
        return '<div class="' + cardCls + '" data-id="' + esc(String(c.id)) + '" style="animation-delay:' + delay + 'ms">' +
          '<div class="missed-call-card-icon"><span class="call-dir call-dir--missed" data-tooltip="' + esc(DIR_TOOLTIPS.missed) + '">\u21A9</span></div>' +
          '<div class="missed-call-card-info">' +
            '<strong>' + esc(fmtPhone(c.from_number)) + '</strong>' +
            (timeAgo ? '<span class="missed-time-ago">' + esc(timeAgo) + '</span>' : '') +
            '<span>' + esc(fmtDate(c.created_at)) + dadataInfo + '</span>' +
            (c.client_name ? '<span>' + esc(c.client_name) + '</span>' : '') +
            (c.manager_name ? '<span style="color:var(--t2,#9ca3af);font-size:12px">' + esc(c.manager_name) + '</span>' : '') +
          '</div>' +
          '<div class="missed-call-card-actions">' +
            '<button class="btn missed-call-btn--callback" data-phone="' + esc(c.from_number) + '" data-tooltip="Позвонить клиенту">\u260E Перезвонить</button>' +
            (unack ? '<button class="btn btn--outline" data-ack="' + esc(String(c.id)) + '">Отметить</button>' : '') +
          '</div>' +
        '</div>';
      }).join('');

      /* event delegation */
      container.querySelectorAll('[data-phone]').forEach(function (btn) {
        btn.addEventListener('click', function (e) { e.stopPropagation(); initiateCallback(btn.dataset.phone); });
      });
      container.querySelectorAll('[data-ack]').forEach(function (btn) {
        btn.addEventListener('click', async function (e) {
          e.stopPropagation();
          try {
            await api('/missed/' + btn.dataset.ack + '/acknowledge', { method: 'POST' });
            btn.closest('.missed-call-card').classList.remove('missed-call-card--new');
            btn.remove();
            fetchMissedBadge();
            renderTabs();
            toast('Звонок отмечен');
          } catch (err) { toast('Ошибка', 'error'); }
        });
      });
    } catch (err) {
      console.error('[Telephony] renderMissed error:', err);
      container.innerHTML = emptyState('\u26A0', 'Не удалось загрузить пропущенные');
      toast('Ошибка загрузки пропущенных', err.message || 'error', 'err');
    }
  }

  function initiateCallback(phone) {
    showModal({
      title: 'Перезвонить',
      body: '<p>Позвонить на номер <strong>' + esc(fmtPhone(phone)) + '</strong>?</p><p style="font-size:13px;color:var(--t2,#9ca3af);margin-top:8px">Сначала позвонит ваш телефон, затем произойдёт соединение с клиентом.</p>',
      confirmText: 'Позвонить',
      onConfirm: async function () {
        try {
          var data = await api('/call/start', { method: 'POST', body: JSON.stringify({ to_number: phone }) });
          if (data.success) {
            toast(data.message || 'Звонок инициирован. Ожидайте соединения.', 'success');
          } else {
            toast(data.error || 'Ошибка при инициации звонка', 'error');
          }
        } catch (err) {
          toast(err.message || 'Ошибка соединения с сервером', 'error');
        }
      },
    });
  }

  /* ======================================================================
   *  TAB 3  --  СТАТИСТИКА (Statistics Dashboard)
   * ====================================================================== */
  async function renderStats(container) {
    container.innerHTML =
      '<div class="telephony-filters">' +
        '<input type="date" id="sDateFrom" value="' + monthAgoISO() + '">' +
        '<input type="date" id="sDateTo" value="' + todayISO() + '">' +
        '<button class="btn btn--primary" id="sApply">Обновить</button>' +
      '</div>' +
      '<div id="statsContent">' + skeletonStats() + '</div>';

    $('#sApply').addEventListener('click', function () { fetchStats(); });
    fetchStats();
  }

  async function fetchStats() {
    var content = $('#statsContent');
    if (!content) return;
    content.innerHTML = skeletonStats();

    var from = ($('#sDateFrom') || {}).value || monthAgoISO();
    var to   = ($('#sDateTo') || {}).value || todayISO();
    var qs   = '?date_from=' + from + '&date_to=' + to;

    try {
      var results = await Promise.all([
        api('/stats' + qs),
        api('/stats/managers' + qs),
      ]);
      var stats    = results[0];
      var managers = results[1];

      var t = stats.totals || {};

      var kpiDescriptions = {
        total: 'Общее количество звонков за период',
        inbound: 'Количество входящих звонков',
        missed: 'Пропущенные звонки — требуют внимания',
        avg_duration: 'Среднее время разговора',
      };

      /* AI Insights — hidden data from backend */
      var targetPct = t.total > 0 ? Math.round(((t.target_calls || 0) / t.total) * 100) : 0;
      var convPct = (t.target_calls || 0) > 0 ? Math.round(((t.converted_to_leads || 0) / t.target_calls) * 100) : 0;
      var missedPct = t.total > 0 ? Math.round(((t.missed || 0) / t.total) * 100) : 0;

      var aiInsightsHtml = '<div class="tel-ai-insights">' +
        '<div class="tel-ai-insights-title">\uD83E\uDDD9 AI Insights</div>' +
        '<div class="tel-ai-insights-grid">' +
          '<div class="tel-ai-insight-item"><div class="tel-ai-insight-value">' + targetPct + '%</div><div class="tel-ai-insight-label">Целевые звонки</div></div>' +
          '<div class="tel-ai-insight-item"><div class="tel-ai-insight-value">' + convPct + '%</div><div class="tel-ai-insight-label">Конверсия в заявки</div></div>' +
          '<div class="tel-ai-insight-item"><div class="tel-ai-insight-value">' + missedPct + '%</div><div class="tel-ai-insight-label">Пропущенные</div></div>' +
        '</div>' +
      '</div>';

      content.innerHTML =
        '<div class="telephony-dashboard">' +
          kpiCard('Всего звонков', t.total != null ? t.total : 0, kpiDescriptions.total, 'telephony-kpi-icon-wow--total', '\uD83D\uDCDE') +
          kpiCard('Входящие', t.inbound != null ? t.inbound : 0, kpiDescriptions.inbound, 'telephony-kpi-icon-wow--inbound', '\u2199\uFE0F') +
          kpiCard('Пропущенные', t.missed != null ? t.missed : 0, kpiDescriptions.missed, 'telephony-kpi-icon-wow--missed', '\u21A9\uFE0F') +
          kpiCard('Средняя длительность', fmtDuration(t.avg_duration), kpiDescriptions.avg_duration, 'telephony-kpi-icon-wow--duration', '\u23F1') +
        '</div>' +
        aiInsightsHtml +
        '<div class="telephony-chart-wrap">' +
          '<div class="telephony-chart-title">Звонки по дням</div>' +
          '<div class="chart-legend" id="chartLegend">' +
            '<div class="chart-legend-item" data-series="inbound" style="cursor:pointer"><div class="chart-legend-dot" style="background:var(--green,#22c55e)"></div>Входящие</div>' +
            '<div class="chart-legend-item" data-series="outbound" style="cursor:pointer"><div class="chart-legend-dot" style="background:var(--blue,#3b82f6)"></div>Исходящие</div>' +
            '<div class="chart-legend-item" data-series="missed" style="cursor:pointer"><div class="chart-legend-dot" style="background:var(--red,#ef4444)"></div>Пропущенные</div>' +
          '</div>' +
          '<div style="position:relative">' +
            '<canvas id="chartCallsPerDay" style="width:100%;height:280px"></canvas>' +
          '</div>' +
        '</div>' +
        '<div class="telephony-chart-title" style="margin-top:1.5rem">Активность по сотрудникам</div>' +
        renderEmployeesTable(managers.managers || []);

      /* count-up animation on KPI values */
      content.querySelectorAll('.telephony-kpi-value').forEach(function(el) {
        var raw = el.dataset.target;
        var num = parseInt(raw, 10);
        if (!isNaN(num) && num > 0) { animateCountUp(el, num, 900); }
      });

      drawCallsChart(stats.by_period || []);
    } catch (err) {
      console.error('[Telephony] fetchStats error:', err);
      content.innerHTML = emptyState('\u26A0', 'Не удалось загрузить статистику');
      toast('Ошибка загрузки статистики', err.message || 'error', 'err');
    }
  }

  function kpiCard(label, value, tooltip, iconCls, icon) {
    var tip = tooltip ? ' data-tooltip="' + esc(tooltip) + '"' : '';
    var iconHtml = icon ? '<div class="telephony-kpi-icon-wow ' + (iconCls || '') + '">' + icon + '</div>' : '';
    var valId = 'kpi_' + label.replace(/\s/g,'_') + '_' + Date.now();
    return '<div class="telephony-kpi-wow"' + tip + '>' + iconHtml + '<div class="telephony-kpi-value" id="' + valId + '" data-target="' + esc(String(value)) + '">' + (typeof value === 'number' ? '0' : esc(String(value))) + '</div><div class="telephony-kpi-label">' + esc(label) + '</div></div>';
  }

  function renderEmployeesTable(managers) {
    if (!managers.length) return emptyState('\uD83D\uDC64', 'Нет данных по сотрудникам');
    var rows = managers.map(function (m) {
      return '<tr>' +
        '<td>' + esc(m.name) + '</td>' +
        '<td>' + (m.total_calls != null ? m.total_calls : 0) + '</td>' +
        '<td>' + (m.inbound != null ? m.inbound : 0) + '</td>' +
        '<td>' + (m.outbound != null ? m.outbound : 0) + '</td>' +
        '<td>' + (m.missed != null ? m.missed : 0) + '</td>' +
        '<td>' + esc(fmtDuration(m.avg_duration)) + '</td>' +
        '<td>' + (m.converted != null ? m.converted : 0) + '</td>' +
      '</tr>';
    }).join('');

    return '<table class="managers-stats-table">' +
      '<thead><tr><th>Сотрудник</th><th>Всего</th><th>Вход.</th><th>Исход.</th><th>Пропущ.</th><th>Ср. длит.</th><th>Целевые</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>';
  }

  /* ======================================================================
   *  MULTI-LINE CHART  with crosshair tooltip
   * ====================================================================== */
  function drawCallsChart(dataPoints) {
    var canvas = document.getElementById('chartCallsPerDay');
    if (!canvas || !dataPoints.length) return;

    var dpr  = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    canvas.width  = rect.width * dpr;
    canvas.height = rect.height * dpr;
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var W = rect.width;
    var H = rect.height;
    var PAD = { top: 20, right: 20, bottom: 40, left: 50 };
    var cw = W - PAD.left - PAD.right;
    var ch = H - PAD.top - PAD.bottom;

    /* parse data series */
    var inboundData  = dataPoints.map(function (p) { return p.inbound != null ? p.inbound : 0; });
    var outboundData = dataPoints.map(function (p) { return p.outbound != null ? p.outbound : 0; });
    var missedData   = dataPoints.map(function (p) { return p.missed != null ? p.missed : 0; });
    var labels       = dataPoints.map(function (p) { return p.period || p.date || ''; });

    var allValues = inboundData.concat(outboundData).concat(missedData);
    var maxVal = Math.max.apply(null, allValues.concat([1]));

    var style    = getComputedStyle(document.documentElement);
    var colGreen = style.getPropertyValue('--green').trim() || '#22c55e';
    var colBlue  = style.getPropertyValue('--blue').trim()  || '#3b82f6';
    var colRed   = style.getPropertyValue('--red').trim()   || '#ef4444';
    var colGrid  = style.getPropertyValue('--brd').trim()   || '#e5e7eb';
    var colText  = style.getPropertyValue('--t2').trim()     || '#6b7280';

    /* grid lines */
    ctx.strokeStyle = colGrid;
    ctx.lineWidth = 1;
    var gridLines = 5;
    for (var gi = 0; gi <= gridLines; gi++) {
      var gy = PAD.top + (ch / gridLines) * gi;
      ctx.beginPath();
      ctx.moveTo(PAD.left, gy);
      ctx.lineTo(PAD.left + cw, gy);
      ctx.stroke();
      ctx.fillStyle = colText;
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(String(Math.round(maxVal - (maxVal / gridLines) * gi)), PAD.left - 8, gy + 4);
    }

    /* x-axis labels */
    var step = Math.max(1, Math.floor(labels.length / 10));
    ctx.fillStyle = colText;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    labels.forEach(function (l, i) {
      if (i % step !== 0 && i !== labels.length - 1) return;
      var lx = PAD.left + (cw / Math.max(labels.length - 1, 1)) * i;
      var short = l.length >= 10 ? l.slice(8,10)+"."+l.slice(5,7) : l;
      ctx.fillText(short, lx, H - PAD.bottom + 18);
    });

    /* helper: convert data to x/y points */
    function toPoints(data) {
      return data.map(function (v, i) {
        return {
          x: PAD.left + (cw / Math.max(data.length - 1, 1)) * i,
          y: PAD.top + ch - (v / maxVal) * ch,
        };
      });
    }

    /* helper: draw smooth bezier line */
    function drawSmoothLine(pts, color, fillAlpha) {
      if (pts.length < 2) return;

      /* gradient fill */
      var grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + ch);
      grad.addColorStop(0, color + (fillAlpha || '1a'));
      grad.addColorStop(1, color + '05');

      /* fill path */
      ctx.beginPath();
      ctx.moveTo(pts[0].x, PAD.top + ch);
      ctx.lineTo(pts[0].x, pts[0].y);

      for (var i = 1; i < pts.length; i++) {
        var prev = pts[i - 1];
        var curr = pts[i];
        var cpx = (prev.x + curr.x) / 2;
        ctx.quadraticCurveTo(prev.x + (cpx - prev.x) * 0.8, prev.y, cpx, (prev.y + curr.y) / 2);
        ctx.quadraticCurveTo(curr.x - (curr.x - cpx) * 0.8, curr.y, curr.x, curr.y);
      }

      ctx.lineTo(pts[pts.length - 1].x, PAD.top + ch);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      /* stroke line */
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.moveTo(pts[0].x, pts[0].y);

      for (var j = 1; j < pts.length; j++) {
        var p = pts[j - 1];
        var c = pts[j];
        var cx = (p.x + c.x) / 2;
        ctx.quadraticCurveTo(p.x + (cx - p.x) * 0.8, p.y, cx, (p.y + c.y) / 2);
        ctx.quadraticCurveTo(c.x - (c.x - cx) * 0.8, c.y, c.x, c.y);
      }
      ctx.stroke();

      /* dots */
      pts.forEach(function (pt) {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();
      });
    }

    var ptsInbound  = toPoints(inboundData);
    var ptsOutbound = toPoints(outboundData);
    var ptsMissed   = toPoints(missedData);

    /* series visibility toggle */
    var seriesVisible = { inbound: true, outbound: true, missed: true };

    function redrawChart() {
      ctx.clearRect(0, 0, W, H);
      /* grid */
      ctx.strokeStyle = colGrid; ctx.lineWidth = 1;
      for (var gi = 0; gi <= gridLines; gi++) {
        var gy2 = PAD.top + (ch / gridLines) * gi;
        ctx.beginPath(); ctx.moveTo(PAD.left, gy2); ctx.lineTo(PAD.left + cw, gy2); ctx.stroke();
        ctx.fillStyle = colText; ctx.font = '11px sans-serif'; ctx.textAlign = 'right';
        ctx.fillText(String(Math.round(maxVal - (maxVal / gridLines) * gi)), PAD.left - 8, gy2 + 4);
      }
      /* x labels */
      ctx.fillStyle = colText; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
      labels.forEach(function (l, i) {
        if (i % step !== 0 && i !== labels.length - 1) return;
        var lx = PAD.left + (cw / Math.max(labels.length - 1, 1)) * i;
        var short = l.length >= 10 ? l.slice(8,10)+"."+l.slice(5,7) : l;
        ctx.fillText(short, lx, H - PAD.bottom + 18);
      });
      /* series */
      if (seriesVisible.inbound) drawSmoothLine(ptsInbound, colGreen, '1a');
      if (seriesVisible.outbound) drawSmoothLine(ptsOutbound, colBlue, '1a');
      if (seriesVisible.missed) drawSmoothLine(ptsMissed, colRed, '1a');
      baseImage = ctx.getImageData(0, 0, canvas.width, canvas.height);
    }

    drawSmoothLine(ptsInbound, colGreen, '1a');
    drawSmoothLine(ptsOutbound, colBlue, '1a');
    drawSmoothLine(ptsMissed, colRed, '1a');

    /* clickable legend toggle */
    var legendWrap = document.getElementById('chartLegend');
    if (legendWrap) {
      legendWrap.querySelectorAll('[data-series]').forEach(function(item) {
        item.addEventListener('click', function() {
          var s = item.dataset.series;
          seriesVisible[s] = !seriesVisible[s];
          item.style.opacity = seriesVisible[s] ? '1' : '0.35';
          item.style.textDecoration = seriesVisible[s] ? 'none' : 'line-through';
          redrawChart();
        });
      });
    }

    /* ---- Hover crosshair ---- */
    /* store base image for fast redraw on hover */
    var baseImage = ctx.getImageData(0, 0, canvas.width, canvas.height);

    function findNearestIndex(mouseX) {
      var minDist = Infinity;
      var idx = 0;
      ptsInbound.forEach(function (pt, i) {
        var d = Math.abs(pt.x - mouseX);
        if (d < minDist) { minDist = d; idx = i; }
      });
      return idx;
    }

    function showChartTooltip(e) {
      var cRect = canvas.getBoundingClientRect();
      var mx = e.clientX - cRect.left;
      var my = e.clientY - cRect.top;

      if (mx < PAD.left || mx > W - PAD.right) {
        hideChartTooltip();
        return;
      }

      var idx = findNearestIndex(mx);
      if (idx < 0 || idx >= dataPoints.length) return;

      /* redraw base */
      ctx.putImageData(baseImage, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      /* vertical crosshair line */
      var cx = ptsInbound[idx].x;
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = colText;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, PAD.top);
      ctx.lineTo(cx, PAD.top + ch);
      ctx.stroke();
      ctx.restore();

      /* highlight dots */
      [
        { pt: ptsInbound[idx], col: colGreen },
        { pt: ptsOutbound[idx], col: colBlue },
        { pt: ptsMissed[idx], col: colRed },
      ].forEach(function (item) {
        ctx.beginPath();
        ctx.arc(item.pt.x, item.pt.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = item.col;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
      });

      /* tooltip div */
      if (!_chartTooltipEl) {
        _chartTooltipEl = document.createElement('div');
        _chartTooltipEl.className = 'chart-crosshair-tooltip';
        canvas.parentElement.appendChild(_chartTooltipEl);
      }

      var dp = dataPoints[idx];
      var periodLabel = dp.period || '';
      if (periodLabel.length >= 10) { var _d = new Date(periodLabel); periodLabel = isNaN(_d.getTime()) ? periodLabel.slice(0,10) : _d.toLocaleDateString('ru-RU'); }

      _chartTooltipEl.innerHTML =
        '<div style="font-weight:600;margin-bottom:4px">' + esc(periodLabel) + '</div>' +
        '<div><span class="ct-dot" style="background:' + colGreen + '"></span>Вход.: ' + (dp.inbound != null ? dp.inbound : 0) + '</div>' +
        '<div><span class="ct-dot" style="background:' + colBlue + '"></span>Исход.: ' + (dp.outbound != null ? dp.outbound : 0) + '</div>' +
        '<div><span class="ct-dot" style="background:' + colRed + '"></span>Пропущ.: ' + (dp.missed != null ? dp.missed : 0) + '</div>';

      /* position tooltip */
      var tipLeft = cx + 14;
      var tipWidth = _chartTooltipEl.offsetWidth || 140;
      if (tipLeft + tipWidth > W - 10) {
        tipLeft = cx - tipWidth - 14;
      }
      _chartTooltipEl.style.left = tipLeft + 'px';
      _chartTooltipEl.style.top = Math.max(0, my - 40) + 'px';
      _chartTooltipEl.style.display = 'block';
    }

    function hideChartTooltip() {
      if (_chartTooltipEl) {
        _chartTooltipEl.style.display = 'none';
      }
      /* restore base canvas */
      ctx.putImageData(baseImage, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    canvas.addEventListener('mousemove', showChartTooltip);
    canvas.addEventListener('mouseleave', hideChartTooltip);
  }

  function destroyChartTooltip() {
    if (_chartTooltipEl) {
      _chartTooltipEl.remove();
      _chartTooltipEl = null;
    }
  }

  /* ======================================================================
   *  TAB 4  --  МАРШРУТИЗАЦИЯ (Routing Rules) — admin only
   * ====================================================================== */
  async function renderRouting(container) {
    var ur = user().role || '';
    if (ur !== 'ADMIN' && ur !== 'DIRECTOR_GEN' && ur !== 'DIRECTOR_COM') {
      container.innerHTML = emptyState('\uD83D\uDEAB', 'Доступ только для администраторов');
      return;
    }

    container.innerHTML =
      '<div style="display:flex;justify-content:flex-end;margin-bottom:1rem">' +
        '<button class="btn btn--primary" id="addRuleBtn">+ Добавить правило</button>' +
      '</div>' +
      '<div id="routingList">' + skeletonRules() + '</div>';

    $('#addRuleBtn').addEventListener('click', function () { openRuleModal(); });
    fetchRouting();
  }

  async function fetchRouting() {
    var list = $('#routingList');
    if (!list) return;
    list.innerHTML = skeletonRules();

    try {
      var data = await api('/routing');
      var rules = data.rules || [];
      if (!rules.length) {
        list.innerHTML = emptyState('\uD83D\uDCCB', 'Нет правил маршрутизации');
        return;
      }

      list.innerHTML = rules.map(function (r) {
        var cv = r.condition_value || {};
        var av = r.action_value || {};
        var condLabel = r.condition_type === 'number_prefix' ? 'Префикс: ' + (cv.prefix || '') :
                        r.condition_type === 'time' ? 'По расписанию' + (cv.schedule ? ' (' + cv.schedule + ')' : '') :
                        r.condition_type === 'client_category' ? 'Категория: ' + (cv.category || '') : 'По умолчанию';
        var actLabel  = r.action_type === 'route_to_user' ? 'Менеджеру (ext. ' + (av.extension || '') + ')' :
                        r.action_type === 'route_to_group' ? 'Группе' + (av.extension ? ' (' + av.extension + ')' : '') :
                        r.action_type === 'queue' ? 'В очередь' :
                        r.action_type === 'ivr' ? 'IVR' : (r.action_type || '');
        return '<div class="routing-rule-card" data-id="' + esc(String(r.id)) + '">' +
          '<div class="routing-rule-card-info">' +
            '<strong>' + esc(r.name) + '</strong>' +
            '<span>' + esc(condLabel) + ' &rarr; ' + esc(actLabel) + '</span>' +
            '<span>Приоритет: ' + (r.priority != null ? r.priority : '\u2014') + '</span>' +
          '</div>' +
          '<div class="routing-rule-card-actions">' +
            '<label class="routing-rule-toggle">' +
              '<input type="checkbox" ' + (r.is_active ? 'checked' : '') + ' data-toggle="' + esc(String(r.id)) + '">' +
              '<span>' + (r.is_active ? 'Активно' : 'Неактивно') + '</span>' +
            '</label>' +
            '<button class="btn btn--sm" data-edit="' + esc(String(r.id)) + '">Изменить</button>' +
            '<button class="btn btn--sm routing-rule-delete" data-del="' + esc(String(r.id)) + '">Удалить</button>' +
          '</div>' +
        '</div>';
      }).join('');

      /* toggle active */
      list.querySelectorAll('[data-toggle]').forEach(function (cb) {
        cb.addEventListener('change', async function () {
          try {
            await api('/routing/' + cb.dataset.toggle, { method: 'PUT', body: JSON.stringify({ is_active: cb.checked }) });
            toast(cb.checked ? 'Правило активировано' : 'Правило деактивировано');
            cb.nextElementSibling.textContent = cb.checked ? 'Активно' : 'Неактивно';
          } catch (err) {
            toast('Ошибка обновления', 'error');
            cb.checked = !cb.checked;
          }
        });
      });

      /* edit */
      list.querySelectorAll('[data-edit]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var rule = rules.find(function (r) { return String(r.id) === btn.dataset.edit; });
          if (rule) openRuleModal(rule);
        });
      });

      /* delete */
      list.querySelectorAll('[data-del]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          showModal({
            title: 'Удалить правило',
            body: '<p>Вы уверены, что хотите удалить это правило маршрутизации?</p>',
            confirmText: 'Удалить',
            danger: true,
            onConfirm: async function () {
              try {
                await api('/routing/' + btn.dataset.del, { method: 'DELETE' });
                toast('Правило удалено');
                fetchRouting();
              } catch (err) { toast('Ошибка удаления', 'error'); }
            },
          });
        });
      });

      /* drag-and-drop reordering */
      initDragAndDrop(list, rules);
    } catch (err) {
      list.innerHTML = emptyState('\u26A0', 'Не удалось загрузить правила');
      toast('Ошибка загрузки', 'error');
    }
  }

  /* ---- Drag-and-Drop Routing Rules ---- */
  function initDragAndDrop(container, rules) {
    var draggedEl = null;
    var draggedId = null;

    container.querySelectorAll('.routing-rule-card').forEach(function (card) {
      card.draggable = true;

      card.addEventListener('dragstart', function (e) {
        draggedEl = card;
        draggedId = card.dataset.id;
        card.classList.add('routing-rule-card--dragging');
        e.dataTransfer.effectAllowed = 'move';
        /* Firefox requires setData for drag to work */
        e.dataTransfer.setData('text/plain', draggedId);
      });

      card.addEventListener('dragend', function () {
        card.classList.remove('routing-rule-card--dragging');
        /* clean up all highlight classes */
        container.querySelectorAll('.routing-rule-card').forEach(function (c) {
          c.classList.remove('routing-rule-card--drag-above', 'routing-rule-card--drag-below');
        });
        draggedEl = null;
        draggedId = null;
      });

      card.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        var cardRect = card.getBoundingClientRect();
        var mid = cardRect.top + cardRect.height / 2;
        card.classList.toggle('routing-rule-card--drag-above', e.clientY < mid);
        card.classList.toggle('routing-rule-card--drag-below', e.clientY >= mid);
      });

      card.addEventListener('dragleave', function () {
        card.classList.remove('routing-rule-card--drag-above', 'routing-rule-card--drag-below');
      });

      card.addEventListener('drop', async function (e) {
        e.preventDefault();
        card.classList.remove('routing-rule-card--drag-above', 'routing-rule-card--drag-below');
        if (!draggedEl || !draggedId || draggedId === card.dataset.id) return;

        /* reorder in DOM */
        var cardRect = card.getBoundingClientRect();
        var mid = cardRect.top + cardRect.height / 2;
        if (e.clientY < mid) {
          card.parentNode.insertBefore(draggedEl, card);
        } else {
          card.parentNode.insertBefore(draggedEl, card.nextSibling);
        }

        /* save new priorities to server */
        var cards = container.querySelectorAll('.routing-rule-card');
        var updates = [];
        cards.forEach(function (c, i) {
          updates.push(
            api('/routing/' + c.dataset.id, {
              method: 'PUT',
              body: JSON.stringify({ priority: i }),
            }).catch(function () {})
          );
        });
        await Promise.all(updates);
        toast('Приоритеты обновлены');
      });
    });
  }

  /* ---- Enhanced Routing Rule Modal ---- */
  function openRuleModal(existing) {
    var isEdit = !!existing;
    var cv = (existing && existing.condition_value) ? existing.condition_value : {};
    var av = (existing && existing.action_value) ? existing.action_value : {};

    var condType = (existing && existing.condition_type) ? existing.condition_type : 'default';
    var actType  = (existing && existing.action_type) ? existing.action_type : 'route_to_user';

    /* build dynamic condition value section based on condition type */
    function conditionValueField(type) {
      switch (type) {
        case 'number_prefix':
          return '<label>Префикс номера<input type="text" id="rmCondVal" placeholder="+7495" value="' + esc(cv.prefix || '') + '"></label>';
        case 'time':
          return '<label>Расписание (напр. 09:00-18:00)<input type="text" id="rmCondVal" placeholder="09:00-18:00" value="' + esc(cv.schedule || '') + '"></label>';
        case 'client_category':
          return '<label>Категория клиента<input type="text" id="rmCondVal" placeholder="VIP" value="' + esc(cv.category || '') + '"></label>';
        default:
          return '<input type="hidden" id="rmCondVal" value="">';
      }
    }

    showModal({
      title: isEdit ? 'Редактировать правило' : 'Новое правило',
      body:
        '<label>Название<input type="text" id="rmName" value="' + esc(existing ? existing.name || '' : '') + '"></label>' +
        '<label>Тип условия' +
          '<select id="rmCondType">' +
            '<option value="default"' + (condType === 'default' ? ' selected' : '') + '>По умолчанию</option>' +
            '<option value="number_prefix"' + (condType === 'number_prefix' ? ' selected' : '') + '>Префикс номера</option>' +
            '<option value="time"' + (condType === 'time' ? ' selected' : '') + '>По времени</option>' +
            '<option value="client_category"' + (condType === 'client_category' ? ' selected' : '') + '>Категория клиента</option>' +
          '</select>' +
        '</label>' +
        '<div id="rmCondValWrap">' + conditionValueField(condType) + '</div>' +
        '<label>Действие' +
          '<select id="rmActType">' +
            '<option value="route_to_user"' + (actType === 'route_to_user' ? ' selected' : '') + '>На менеджера</option>' +
            '<option value="route_to_group"' + (actType === 'route_to_group' ? ' selected' : '') + '>На группу</option>' +
            '<option value="queue"' + (actType === 'queue' ? ' selected' : '') + '>В очередь</option>' +
            '<option value="ivr"' + (actType === 'ivr' ? ' selected' : '') + '>IVR</option>' +
          '</select>' +
        '</label>' +
        '<label>Внутренний номер (extension)<input type="text" id="rmExt" value="' + esc(av.extension || '') + '"></label>' +
        '<label>Приоритет<input type="number" id="rmPriority" value="' + (existing && existing.priority != null ? existing.priority : 0) + '"></label>' +
        (isEdit ? '<label style="display:flex;align-items:center;gap:8px;margin-top:8px"><input type="checkbox" id="rmActive" ' + (existing.is_active ? 'checked' : '') + '> Активно</label>' : ''),
      confirmText: isEdit ? 'Сохранить' : 'Создать',
      onConfirm: async function () {
        var condTypeVal = $('#rmCondType').value;
        var condRaw     = ($('#rmCondVal') || {}).value || '';
        condRaw = condRaw.trim();

        var condValue;
        switch (condTypeVal) {
          case 'number_prefix':   condValue = { prefix: condRaw }; break;
          case 'client_category': condValue = { category: condRaw }; break;
          case 'time':            condValue = { schedule: condRaw }; break;
          default:                condValue = {};
        }

        var body = {
          name:            ($('#rmName') || {}).value ? $('#rmName').value.trim() : '',
          condition_type:  condTypeVal,
          condition_value: condValue,
          action_type:     $('#rmActType').value,
          action_value:    { extension: ($('#rmExt') || {}).value ? $('#rmExt').value.trim() : '' },
          priority:        parseInt(($('#rmPriority') || {}).value, 10) || 0,
        };

        if (isEdit && $('#rmActive')) {
          body.is_active = $('#rmActive').checked;
        }

        if (!body.name) { toast('Укажите название', 'error'); return; }
        try {
          if (isEdit) {
            await api('/routing/' + existing.id, { method: 'PUT', body: JSON.stringify(body) });
          } else {
            await api('/routing', { method: 'POST', body: JSON.stringify(body) });
          }
          toast(isEdit ? 'Правило обновлено' : 'Правило создано');
          fetchRouting();
        } catch (err) { toast('Ошибка сохранения', 'error'); }
      },
    });

    /* dynamic condition value field swap */
    setTimeout(function () {
      var sel = $('#rmCondType');
      if (sel) {
        sel.addEventListener('change', function () {
          var wrap = $('#rmCondValWrap');
          if (wrap) wrap.innerHTML = conditionValueField(sel.value);
        });
      }
    }, 50);
  }

  /* ======================================================================
   *  DETAIL PANEL  (slide-in from right)
   * ====================================================================== */
  async function openDetailPanel(callId) {
    var panel   = $('#detailPanel');
    var overlay = $('#detailOverlay');
    var header  = $('#detailHeader');
    var body    = $('#detailBody');
    if (!panel || !body) return;

    destroyCurrentAudio();
    body.innerHTML =
      '<div style="padding:20px">' +
        '<div class="skeleton skeleton-bar" style="width:100%;height:20px;margin-bottom:12px"></div>' +
        '<div class="skeleton skeleton-bar" style="width:80%;height:16px;margin-bottom:12px"></div>' +
        '<div class="skeleton skeleton-bar" style="width:60%;height:16px;margin-bottom:20px"></div>' +
        '<div class="skeleton" style="width:100%;height:64px;margin-bottom:16px"></div>' +
        '<div class="skeleton skeleton-bar" style="width:100%;height:120px"></div>' +
      '</div>';
    panel.classList.add('call-detail-panel--open');
    overlay.classList.add('call-detail-overlay--visible');

    header.innerHTML = '<span>Детали звонка</span><button class="btn btn--icon" id="detailClose">&times;</button>';
    $('#detailClose').addEventListener('click', closeDetailPanel);

    try {
      var call = await api('/calls/' + callId);
      renderDetailBody(body, call);
    } catch (err) {
      body.innerHTML = emptyState('\u26A0', 'Не удалось загрузить данные звонка');
      toast('Ошибка загрузки', 'error');
    }
  }

  function closeDetailPanel() {
    destroyCurrentAudio();
    var panel   = $('#detailPanel');
    var overlay = $('#detailOverlay');
    if (panel)   panel.classList.remove('call-detail-panel--open');
    if (overlay) overlay.classList.remove('call-detail-overlay--visible');
  }

  function renderDetailBody(container, call) {
    var dir = call.call_type || 'missed';
    var dirLabel = DIR_LABELS[dir] || dir;
    var dirTip   = DIR_TOOLTIPS[dir] || '';
    var tStatus = call.transcript_status || 'none';
    var statusTip = STATUS_TOOLTIPS[tStatus] || '';
    var sentimentCls = call.ai_sentiment ? 'sentiment-dot--' + call.ai_sentiment : '';
    var hasRecord = call.record_path || call.recording_id;
    var audioUrl = hasRecord ? '/api/telephony/calls/' + call.id + '/record' : '';

    /* Transcript */
    var transcriptText = (typeof call.transcript === 'string') ? call.transcript.trim() : '';

    /* DaData chips */
    var dadataChips = '';
    if (call.dadata_region || call.dadata_city || call.dadata_operator) {
      dadataChips = '<div class="call-detail-section"><div class="detail-dadata-chips">';
      if (call.dadata_region) dadataChips += '<span class="detail-dadata-chip"><span class="detail-dadata-chip-icon">\uD83C\uDFD4</span>' + esc(call.dadata_region) + '</span>';
      if (call.dadata_city) dadataChips += '<span class="detail-dadata-chip"><span class="detail-dadata-chip-icon">\uD83C\uDFD9</span>' + esc(call.dadata_city) + '</span>';
      if (call.dadata_operator) dadataChips += '<span class="detail-dadata-chip"><span class="detail-dadata-chip-icon">\uD83D\uDCF6</span>' + esc(call.dadata_operator) + '</span>';
      dadataChips += '</div></div>';
    }

    /* key_requirements from ai_lead_data */
    var ld = call.ai_lead_data;
    if (typeof ld === 'string') { try { ld = JSON.parse(ld); } catch(e) { ld = null; } }
    var keyReqsHtml = '';
    if (ld && ld.key_requirements && ld.key_requirements.length) {
      keyReqsHtml = '<div class="call-detail-section"><div class="telephony-chart-title">Ключевые требования</div><ul class="ai-key-reqs">';
      ld.key_requirements.forEach(function(r) { keyReqsHtml += '<li>' + esc(r) + '</li>'; });
      keyReqsHtml += '</ul></div>';
    }

    /* Transcript segments (diarization with timestamps) */
    var segmentsHtml = '';
    var hasSegments = false;
    if (call.transcript_segments) {
      var segs = call.transcript_segments;
      if (typeof segs === 'string') { try { segs = JSON.parse(segs); } catch(e) { segs = null; } }
      if (segs && Array.isArray(segs) && segs.length) {
        hasSegments = true;
        segmentsHtml = '<div class="call-detail-section">' +
          '<div class="telephony-chart-title">Транскрипция (диаризация) <button class="btn btn--sm transcript-copy-btn" id="copyTranscriptBtn" data-tooltip="Скопировать текст">\uD83D\uDCCB</button></div>' +
          '<div class="transcript-viewer" id="transcriptViewer">';
        segs.forEach(function(seg) {
          var startSec = seg.start || 0;
          var endSec = seg.end || 0;
          var speaker = seg.speaker != null ? seg.speaker : 0;
          var spkCls = 'transcript-seg-speaker--' + (speaker % 2);
          var spkLabel = speaker === 0 ? 'Менеджер' : 'Клиент';
          var timeFmt = fmtDuration(startSec);
          segmentsHtml += '<div class="transcript-seg-row" data-start="' + startSec + '" data-end="' + endSec + '">' +
            '<span class="transcript-seg-time">' + timeFmt + '</span>' +
            '<span class="' + spkCls + '">' + esc(spkLabel) + '</span>' +
            '<span class="transcript-seg-text">' + esc(seg.text || '') + '</span>' +
          '</div>';
        });
        segmentsHtml += '</div></div>';
      }
    }

    container.innerHTML =
      /* DaData chips at top */
      dadataChips +

      /* Call info */
      '<div class="call-detail-section">' +
        '<table class="detail-info-table">' +
          '<tr><td>Направление</td><td><span class="call-dir call-dir--' + dir + '" data-tooltip="' + esc(dirTip) + '">' + (DIR_ICONS[dir] || '') + '</span> ' + esc(dirLabel) + '</td></tr>' +
          '<tr><td>От</td><td>' + esc(fmtPhone(call.from_number)) + '</td></tr>' +
          '<tr><td>Линия</td><td>' + esc(fmtPhone(call.line_number || call.to_number)) + '</td></tr>' +
          '<tr><td>Длительность</td><td>' + esc(fmtDuration(call.duration_seconds)) + '</td></tr>' +
          '<tr><td>Дата/время</td><td>' + esc(fmtDate(call.created_at)) + '</td></tr>' +
          (call.started_at ? '<tr><td>Начало</td><td>' + esc(fmtDate(call.started_at)) + '</td></tr>' : '') +
          (call.ended_at ? '<tr><td>Завершение</td><td>' + esc(fmtDate(call.ended_at)) + '</td></tr>' : '') +
          '<tr><td>Менеджер</td><td>' + esc(call.manager_name || (call.user_id ? 'Сотрудник #' + call.user_id : 'Не назначен')) + '</td></tr>' +
          '<tr><td>Статус звонка</td><td>' + esc(call.duration_seconds > 0 ? 'Отвечен' : (dir === 'missed' ? 'Пропущен' : (dir === 'outbound' ? 'Без ответа' : 'Пропущен'))) + '</td></tr>' +
          '<tr><td>Транскрипт</td><td><span class="call-status-badge--' + tStatus + '" data-tooltip="' + esc(statusTip) + '">' + esc(STATUS_LABELS[tStatus] || '\u2014') + '</span></td></tr>' +
        '</table>' +
      '</div>' +

      /* Audio player */
      (hasRecord ? '<div class="call-detail-section"><div class="audio-player" id="audioPlayerWrap"></div></div>' : '') +

      /* Diarized transcript (if segments available) or fallback to plain */
      (hasSegments ? segmentsHtml : renderTranscript(transcriptText)) +

      /* Key requirements */
      keyReqsHtml +

      /* AI Summary & Analysis */
      renderAiAnalysis(call) +

      /* Actions */
      '<div class="call-detail-section" style="display:flex;gap:.5rem;flex-wrap:wrap">' +
        (call.ai_is_target && !call.lead_id ? '<button class="btn btn--primary" id="createLeadBtn" data-tooltip="Создать заявку из данных звонка">Создать заявку</button>' : '') +
        (call.lead_id ? '<span class="ai-summary-tag--target" style="align-self:center">Заявка #' + call.lead_id + ' создана</span>' : '') +
        (hasRecord ? '<button class="btn btn--outline" id="retranscribeBtn" data-tooltip="Перезапустить транскрибацию">Перетранскрибировать</button>' : '') +
        (call.transcript ? '<button class="btn btn--outline" id="reanalyzeBtn" data-tooltip="Перезапустить ИИ-анализ">Переанализировать</button>' : '') +
        '<button class="btn btn--primary" id="callbackBtn" data-tooltip="Инициировать исходящий звонок через Mango Office">\u260E Перезвонить</button>' +
      '</div>';

    /* wire audio player */
    if (hasRecord) {
      createWaveformPlayer($('#audioPlayerWrap'), audioUrl);
      /* wire transcript sync for diarized segments */
      if (hasSegments && _detailAudio) {
        var viewer = $('#transcriptViewer');
        if (viewer) initTranscriptSync(_detailAudio, viewer);
      }
    }

    /* wire copy transcript button */
    var copyBtn = $('#copyTranscriptBtn');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        if (navigator.clipboard && transcriptText) {
          navigator.clipboard.writeText(transcriptText).then(function () {
            toast('Транскрипция скопирована');
          }).catch(function () {
            toast('Не удалось скопировать', 'error');
          });
        }
      });
    }

    /* wire actions */
    var createLeadBtn = $('#createLeadBtn');
    if (createLeadBtn) {
      createLeadBtn.addEventListener('click', async function () {
        try {
          await api('/calls/' + call.id + '/create-lead', { method: 'POST', body: JSON.stringify({}) });
          toast('Заявка создана');
          createLeadBtn.disabled = true;
          createLeadBtn.textContent = 'Заявка создана';
        } catch (err) { toast('Ошибка создания заявки', 'error'); }
      });
    }

    var callbackBtn = $('#callbackBtn');
    if (callbackBtn) {
      var cbPhone = dir === 'inbound' ? call.from_number : (call.line_number || call.to_number);
      callbackBtn.addEventListener('click', function () { initiateCallback(cbPhone); });
    }

    /* Wire retranscribe button */
    var retranscribeBtn = $('#retranscribeBtn');
    if (retranscribeBtn) {
      retranscribeBtn.addEventListener('click', async function () {
        retranscribeBtn.disabled = true;
        retranscribeBtn.textContent = 'Запущено...';
        try {
          var res = await api('/calls/' + call.id + '/transcribe', { method: 'POST' });
          toast(res.message || 'Транскрибация запущена');
        } catch (err) {
          toast(err.message || 'Ошибка', 'error');
          retranscribeBtn.disabled = false;
          retranscribeBtn.textContent = 'Перетранскрибировать';
        }
      });
    }

    /* Wire reanalyze button */
    var reanalyzeBtn = $('#reanalyzeBtn');
    if (reanalyzeBtn) {
      reanalyzeBtn.addEventListener('click', async function () {
        reanalyzeBtn.disabled = true;
        reanalyzeBtn.textContent = 'Запущено...';
        try {
          var res = await api('/calls/' + call.id + '/analyze', { method: 'POST' });
          toast(res.message || 'ИИ-анализ запущен');
        } catch (err) {
          toast(err.message || 'Ошибка', 'error');
          reanalyzeBtn.disabled = false;
          reanalyzeBtn.textContent = 'Переанализировать';
        }
      });
    }
  }

  /* ======================================================================
   *  ENHANCED TRANSCRIPT VIEWER
   * ====================================================================== */
  function renderAiAnalysis(call) {
    if (!call.ai_summary && !call.ai_lead_data) return '';
    var ld = call.ai_lead_data;
    if (typeof ld === 'string') { try { ld = JSON.parse(ld); } catch(e) { ld = null; } }
    if (!ld) ld = {};
    var sentimentLabel = { positive: 'Позитивный', neutral: 'Нейтральный', negative: 'Негативный', aggressive: 'Агрессивный' };
    var urgencyLabel = { critical: 'Критическая', high: 'Высокая', medium: 'Средняя', low: 'Низкая' };
    var classLabel = { new_inquiry: 'Новый запрос', repeat_order: 'Повторный', complaint: 'Жалоба', warranty_claim: 'Гарантия', information_request: 'Инфо', partnership_proposal: 'Партнёрство', supplier_offer: 'Поставщик', spam: 'Спам', wrong_number: 'Ошибка' };
    var wtLabel = { chemical_cleaning: 'Хим. очистка', hydro_cleaning: 'ГДО', hvac_maintenance: 'ТО ОВКВ', hvac_repair: 'Ремонт ОВКВ', hvac_installation: 'Монтаж', industrial_service: 'Пром. сервис', consultation: 'Консульт.', other: 'Прочее' };
    var sentCls = call.ai_sentiment ? 'sentiment-dot--' + call.ai_sentiment : '';
    var sentText = sentimentLabel[call.ai_sentiment] || call.ai_sentiment || '';
    var html = '<div class="call-detail-section"><div class="ai-summary-card">';
    html += '<div class="telephony-chart-title">AI-анализ</div>';
    if (call.ai_summary) html += '<p style="margin:8px 0">' + esc(call.ai_summary) + '</p>';
    html += '<div class="ai-summary-tags" style="margin-bottom:8px">';
    if (call.ai_is_target != null) html += '<span class="ai-summary-tag--' + (call.ai_is_target ? 'target' : 'nontarget') + '">' + (call.ai_is_target ? 'Целевой' : 'Нецелевой') + '</span> ';
    if (call.ai_sentiment) html += '<span class="ai-summary-tag--' + call.ai_sentiment + '"><span class="' + sentCls + '"></span>' + sentText + '</span> ';
    if (ld.classification) html += '<span class="ai-summary-tag">' + esc(classLabel[ld.classification] || ld.classification) + '</span> ';
    if (ld.urgency) html += '<span class="ai-urgency-badge ai-urgency--' + ld.urgency + '">' + esc(urgencyLabel[ld.urgency] || ld.urgency) + '</span>';
    html += '</div>';
    var hasData = ld.company_name || ld.contact_person || ld.object_description || ld.work_type || ld.location;
    if (hasData) {
      html += '<div class="ai-analysis-section"><div class="ai-analysis-section-title">Извлечённые данные</div><dl class="ai-analysis-grid">';
      if (ld.company_name) html += '<dt>Компания</dt><dd>' + esc(ld.company_name) + '</dd>';
      if (ld.contact_person) html += '<dt>Контакт</dt><dd>' + esc(ld.contact_person) + '</dd>';
      if (ld.contact_phone) html += '<dt>Телефон</dt><dd>' + esc(ld.contact_phone) + '</dd>';
      if (ld.contact_email) html += '<dt>Email</dt><dd>' + esc(ld.contact_email) + '</dd>';
      if (ld.work_type) html += '<dt>Тип работ</dt><dd>' + esc(wtLabel[ld.work_type] || ld.work_type) + '</dd>';
      if (ld.object_description) html += '<dt>Объект</dt><dd>' + esc(ld.object_description) + '</dd>';
      if (ld.location) html += '<dt>Адрес</dt><dd>' + esc(ld.location) + '</dd>';
      if (ld.desired_timeline) html += '<dt>Сроки</dt><dd>' + esc(ld.desired_timeline) + '</dd>';
      if (ld.estimated_volume) html += '<dt>Объём</dt><dd>' + esc(ld.estimated_volume) + '</dd>';
      if (ld.source) html += '<dt>Источник</dt><dd>' + esc(ld.source) + '</dd>';
      html += '</dl></div>';
    }
    if (ld.next_steps && ld.next_steps.length > 0) {
      html += '<div class="ai-analysis-section"><div class="ai-analysis-section-title">Рекомендации</div><ul class="ai-next-steps">';
      ld.next_steps.forEach(function(s) { html += '<li>' + esc(s) + '</li>'; });
      html += '</ul></div>';
    }
    if (ld.quality_score != null) {
      var qs = parseInt(ld.quality_score) || 0;
      var qColor = qs >= 8 ? '#22c55e' : qs >= 5 ? '#eab308' : '#ef4444';
      html += '<div class="ai-analysis-section"><div class="ai-analysis-section-title">Качество разговора: ' + qs + '/10</div>';
      html += '<div class="ai-quality-bar"><div class="ai-quality-fill" style="width:' + (qs * 10) + '%;background:' + qColor + '"></div></div>';
      if (ld.quality_notes) html += '<div style="margin-top:6px;font-size:12px;color:var(--t3,#6b7280)">' + esc(ld.quality_notes) + '</div>';
      html += '</div>';
    }
    html += '</div></div>';
    return html;
  }


    function renderTranscript(transcriptText) {
    if (!transcriptText || !transcriptText.trim()) return '';

    var lines = transcriptText.split('\n').filter(function (l) { return l.trim(); });
    var formatted = lines.map(function (line) {
      /* Check for speaker patterns: [Speaker]: text  or  Speaker: text */
      var match = line.match(/^\[?(.+?)\]?:\s*(.+)$/);
      if (match) {
        var speaker = match[1].trim();
        var text = match[2].trim();
        var lc = speaker.toLowerCase();
        var cls = (lc.indexOf('\u043A\u043B\u0438\u0435\u043D\u0442') !== -1 || lc.indexOf('client') !== -1 || lc.indexOf('customer') !== -1)
          ? 'transcript-speaker--client' : 'transcript-speaker--manager';
        return '<div class="transcript-line"><span class="transcript-speaker ' + cls + '">' + esc(speaker) + '</span><span class="transcript-text">' + esc(text) + '</span></div>';
      }
      return '<div class="transcript-line"><span class="transcript-text">' + esc(line) + '</span></div>';
    }).join('');

    return '<div class="call-detail-section">' +
      '<div class="telephony-chart-title">Транскрипция <button class="btn btn--sm transcript-copy-btn" id="copyTranscriptBtn" data-tooltip="Скопировать текст">\uD83D\uDCCB</button></div>' +
      '<div class="transcript-viewer" id="transcriptViewer">' + formatted + '</div>' +
    '</div>';
  }

  /* ======================================================================
   *  WAVEFORM AUDIO PLAYER  (Web Audio API + Peaks Caching)
   * ====================================================================== */
  async function getOrDecodePeaks(audioUrl) {
    if (_peaksCache.has(audioUrl)) return _peaksCache.get(audioUrl);

    var resp = await fetch(audioUrl, { headers: { 'Authorization': 'Bearer ' + token() } });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    var buf = await resp.arrayBuffer();

    /* create blob URL */
    var contentType = resp.headers.get('content-type') || 'audio/mpeg';
    var blob = new Blob([buf], { type: contentType });
    var blobUrl = URL.createObjectURL(blob);

    /* decode for waveform */
    var actx = new (window.AudioContext || window.webkitAudioContext)();
    var decoded = await actx.decodeAudioData(buf.slice(0));
    actx.close();

    var peaks = extractPeaks(decoded, WAVEFORM_BARS);
    var result = { peaks: peaks, duration: decoded.duration, blobUrl: blobUrl };
    cachePeaks(audioUrl, result);
    return result;
  }

  function createWaveformPlayer(container, audioUrl) {
    if (!container) return;

    /* ---- state ---- */
    var peaks = [];
    var audioDuration = 0;
    var speedIdx = 0;

    /* ---- DOM scaffold ---- */
    container.innerHTML =
      '<div class="audio-player-controls">' +
        '<button class="audio-player-play" id="apPlay" disabled>&#9654;</button>' +
        '<span id="apTime">00:00 / 00:00</span>' +
        '<button class="btn btn--sm" id="apSpeed" data-tooltip="Скорость воспроизведения">1x</button>' +
        '<button class="btn btn--sm" id="apDownload" data-tooltip="Скачать запись">&#11015;</button>' +
      '</div>' +
      '<div class="audio-player-progress-wrap" id="apWaveWrap">' +
        '<canvas id="apCanvas" style="width:100%;height:64px;cursor:pointer"></canvas>' +
      '</div>';

    var playBtn   = container.querySelector('#apPlay');
    var timeLabel = container.querySelector('#apTime');
    var speedBtn  = container.querySelector('#apSpeed');
    var canvas    = container.querySelector('#apCanvas');

    /* ---- HTML5 audio element ---- */
    var audio  = new Audio();
    _detailAudio = audio;

    /* ---- fetch / decode (with caching) ---- */
    (async function loadAudio() {
      try {
        var cached = await getOrDecodePeaks(audioUrl);
        peaks = cached.peaks;
        audioDuration = cached.duration;
        audio.src = cached.blobUrl;
        drawWaveform(canvas, peaks, 0);
        playBtn.disabled = false;
      } catch (err) {
        /* fallback: try direct blob without waveform */
        try {
          var resp = await fetch(audioUrl, { headers: { 'Authorization': 'Bearer ' + token() } });
          if (resp.ok) {
            var ct = resp.headers.get('content-type') || 'audio/mpeg';
            var bl = new Blob([await resp.arrayBuffer()], { type: ct });
            audio.src = URL.createObjectURL(bl);
          }
        } catch (e2) { /* silent */ }
        playBtn.disabled = false;
      }
    })();

    /* ---- play / pause ---- */
    playBtn.addEventListener('click', function () {
      if (audio.paused) { audio.play(); } else { audio.pause(); }
    });

    audio.addEventListener('play', function () {
      playBtn.innerHTML = '&#9646;&#9646;';
      startProgressLoop();
    });
    audio.addEventListener('pause', function () { playBtn.innerHTML = '&#9654;'; });
    audio.addEventListener('ended', function () {
      playBtn.innerHTML = '&#9654;';
      drawWaveform(canvas, peaks, 1);
    });

    /* ---- time update ---- */
    function updateTimeLabel() {
      timeLabel.textContent = fmtDuration(audio.currentTime) + ' / ' + fmtDuration(audio.duration || audioDuration);
    }
    audio.addEventListener('timeupdate', updateTimeLabel);

    /* ---- progress animation loop ---- */
    function startProgressLoop() {
      cancelAnimationFrame(_rafId);
      (function loop() {
        if (audio.paused) return;
        var pct = audio.duration ? audio.currentTime / audio.duration : 0;
        drawWaveform(canvas, peaks, pct);
        updateTimeLabel();
        _rafId = requestAnimationFrame(loop);
      })();
    }

    /* ---- speed control ---- */
    speedBtn.addEventListener('click', function () {
      speedIdx = (speedIdx + 1) % SPEED_OPTIONS.length;
      audio.playbackRate = SPEED_OPTIONS[speedIdx];
      speedBtn.textContent = SPEED_OPTIONS[speedIdx] + 'x';
    });

    /* ---- download ---- */
    var dlBtn = container.querySelector('#apDownload');
    if (dlBtn) {
      dlBtn.addEventListener('click', function () {
        if (audio.src && audio.src.indexOf('blob:') === 0) {
          var a = document.createElement('a');
          a.href = audio.src;
          a.download = 'call-recording.mp3';
          a.click();
        }
      });
    }

    /* ---- seek on click ---- */
    canvas.addEventListener('click', function (e) {
      var r = canvas.getBoundingClientRect();
      var pct = (e.clientX - r.left) / r.width;
      if (audio.duration) {
        audio.currentTime = pct * audio.duration;
        drawWaveform(canvas, peaks, pct);
        if (audio.paused) audio.play();
      }
    });
  }

  /* ---- Extract peaks from AudioBuffer ---- */
  function extractPeaks(buffer, barCount) {
    var channel   = buffer.getChannelData(0);
    var blockSize = Math.floor(channel.length / barCount);
    var peaks     = [];

    for (var i = 0; i < barCount; i++) {
      var sum = 0;
      var start = i * blockSize;
      var end   = Math.min(start + blockSize, channel.length);
      for (var j = start; j < end; j++) {
        sum += Math.abs(channel[j]);
      }
      peaks.push(sum / (end - start));
    }

    /* normalize to 0..1 */
    var max = Math.max.apply(null, peaks.concat([0.001]));
    return peaks.map(function (p) { return p / max; });
  }

  /* ---- Draw waveform bars on Canvas ---- */
  function drawWaveform(canvas, peaks, progressPct) {
    if (!peaks.length) return;

    var dpr  = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    canvas.width  = rect.width * dpr;
    canvas.height = rect.height * dpr;
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var W = rect.width;
    var H = rect.height;
    var barW = Math.max(1, (W / peaks.length) * 0.7);
    var gap  = W / peaks.length;
    var mid  = H / 2;
    var maxH = H * 0.42;

    var style     = getComputedStyle(document.documentElement);
    var colBase   = style.getPropertyValue('--bg4').trim()  || '#d1d5db';

    ctx.clearRect(0, 0, W, H);

    peaks.forEach(function (p, i) {
      var x  = i * gap + (gap - barW) / 2;
      var bh = Math.max(2, p * maxH);
      var played = (i / peaks.length) < progressPct;

      if (played) {
        var t = peaks.length > 1 ? i / (peaks.length - 1) : 0;
        ctx.fillStyle = lerpColor('#C8293B', '#1E4D8C', t);
      } else {
        ctx.fillStyle = colBase;
      }
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(x, mid - bh, barW, bh * 2, barW / 2);
      } else {
        ctx.rect(x, mid - bh, barW, bh * 2);
      }
      ctx.fill();
    });
  }

  /* ======================================================================
   *  TRANSCRIPT SYNC  (for future timestamped transcripts)
   * ====================================================================== */
  function initTranscriptSync(audioElement, transcriptContainer) {
    var segments = transcriptContainer.querySelectorAll('.transcript-seg-row');
    if (!segments.length) return;

    function update() {
      var currentTime = audioElement.currentTime;
      var activeEl = null;

      segments.forEach(function (seg) {
        var start = parseFloat(seg.dataset.start);
        var end   = parseFloat(seg.dataset.end);
        var isActive = currentTime >= start && currentTime < end;
        seg.classList.toggle('transcript-seg-row--active', isActive);
        if (isActive) activeEl = seg;
      });

      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }

      if (!audioElement.paused) {
        requestAnimationFrame(update);
      }
    }

    audioElement.addEventListener('play', function () { requestAnimationFrame(update); });
    audioElement.addEventListener('seeked', update);

    segments.forEach(function (seg) {
      var timeEl = seg.querySelector('.transcript-seg-time');
      if (timeEl) {
        timeEl.addEventListener('click', function () {
          audioElement.currentTime = parseFloat(seg.dataset.start);
          audioElement.play();
        });
      }
    });
  }

  /* ======================================================================
   *  TAB 5  --  АНАЛИТИКА (Call Analytics — WOW)
   * ====================================================================== */
  async function renderAnalytics(container) {
    container.innerHTML =
      '<div class="tel-ai-insights cr-wow-card" style="margin-bottom:16px">' +
        '<div class="tel-ai-insights-title">🧙 AI-аналитика звонков</div>' +
        '<div class="tel-ai-insights-grid" id="telAnalyticsKPI">' +
          '<div class="skeleton-kpi"><div class="skeleton skeleton-bar" style="width:60px;height:28px;margin:0 auto 10px"></div><div class="skeleton skeleton-bar" style="width:90px;height:12px;margin:0 auto"></div></div>' +
          '<div class="skeleton-kpi"><div class="skeleton skeleton-bar" style="width:60px;height:28px;margin:0 auto 10px"></div><div class="skeleton skeleton-bar" style="width:90px;height:12px;margin:0 auto"></div></div>' +
          '<div class="skeleton-kpi"><div class="skeleton skeleton-bar" style="width:60px;height:28px;margin:0 auto 10px"></div><div class="skeleton skeleton-bar" style="width:90px;height:12px;margin:0 auto"></div></div>' +
        '</div>' +
      '</div>' +
      '<div id="telAnalyticsList">' + skeletonTable(5) + '</div>';

    try {
      var tkn = token();
      var headers = { Authorization: 'Bearer ' + tkn };

      // Загрузим последний отчёт + статистику за 7 дней
      var [reportsRes, statsRes] = await Promise.all([
        fetch('/api/call-reports?limit=5', { headers: headers }).then(function(r) { return r.json(); }),
        fetch('/api/call-reports/dashboard', { headers: headers }).then(function(r) { return r.json(); }).catch(function() { return {}; })
      ]);

      var reports = (reportsRes && reportsRes.items) || [];
      var stats = (statsRes && statsRes.stats) || {};

      // KPI cards
      var kpiEl = document.getElementById('telAnalyticsKPI');
      if (kpiEl) {
        kpiEl.innerHTML =
          '<div class="tel-ai-insight-item"><div class="tel-ai-insight-value" data-animate="' + (stats.totalCalls || 0) + '">0</div><div class="tel-ai-insight-label">Звонков за период</div></div>' +
          '<div class="tel-ai-insight-item"><div class="tel-ai-insight-value" data-animate="' + (stats.targetCalls || 0) + '">0</div><div class="tel-ai-insight-label">Целевых</div></div>' +
          '<div class="tel-ai-insight-item"><div class="tel-ai-insight-value" data-animate="' + (stats.missedCalls || 0) + '">0</div><div class="tel-ai-insight-label">Пропущенных</div></div>';

        kpiEl.querySelectorAll('[data-animate]').forEach(function(valEl) {
          animateCountUp(valEl, parseInt(valEl.dataset.animate) || 0, 800);
        });
      }

      // Report list with accordion
      var listEl = document.getElementById('telAnalyticsList');
      if (listEl) {
        if (!reports.length) {
          listEl.innerHTML = emptyState('📊', 'Отчётов пока нет');
          return;
        }

        var TYPE_LABELS = { daily: 'Ежедневный', weekly: 'Еженедельный', monthly: 'Ежемесячный' };

        listEl.innerHTML = reports.map(function(rpt, idx) {
          var rptStats = {};
          try { rptStats = typeof rpt.stats_json === 'string' ? JSON.parse(rpt.stats_json) : (rpt.stats_json || {}); } catch(_) {}
          var recs = [];
          try { recs = typeof rpt.recommendations_json === 'string' ? JSON.parse(rpt.recommendations_json) : (rpt.recommendations_json || []); } catch(_) {}

          var badgeCls = rpt.report_type === 'daily' ? 'cr-badge--daily' : (rpt.report_type === 'weekly' ? 'cr-badge--weekly' : 'cr-badge--monthly');

          var bodyHtml = '';
          if (rpt.summary_text) {
            bodyHtml += '<div style="font-size:13px;color:var(--t2);line-height:1.6;margin-bottom:8px;white-space:pre-wrap">' + esc(rpt.summary_text.slice(0, 600)) + '</div>';
          }
          if (rptStats.totalCalls !== undefined) {
            bodyHtml += '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:8px">' +
              '<div class="cr-detail__mini"><div class="cr-detail__mini-value">' + (rptStats.totalCalls || 0) + '</div><div class="cr-detail__mini-label">Звонков</div></div>' +
              '<div class="cr-detail__mini"><div class="cr-detail__mini-value">' + (rptStats.targetCalls || 0) + '</div><div class="cr-detail__mini-label">Целевых</div></div>' +
              '<div class="cr-detail__mini"><div class="cr-detail__mini-value">' + (rptStats.missedCalls || 0) + '</div><div class="cr-detail__mini-label">Пропущ.</div></div>' +
            '</div>';
          }
          if (recs.length) {
            bodyHtml += '<div style="font-size:12px;font-weight:600;color:var(--t3);margin-bottom:4px">РЕКОМЕНДАЦИИ</div>' +
              '<ol style="margin:0;padding-left:18px">' + recs.slice(0, 5).map(function(r) { return '<li style="font-size:13px;color:var(--t2);padding:2px 0">' + esc(r) + '</li>'; }).join('') + '</ol>';
          }
          bodyHtml += '<div style="margin-top:8px"><button class="fk-btn fk-btn--sm" data-report-id="' + rpt.id + '" data-action="openReport">Открыть полный отчёт</button></div>';

          return '<div class="cr-accordion cr-wow-card" style="animation-delay:' + (idx * 60) + 'ms;margin-bottom:8px">' +
            '<div class="cr-accordion__head">' +
              '<span><span class="cr-badge ' + badgeCls + '" style="margin-right:8px">' + (TYPE_LABELS[rpt.report_type] || rpt.report_type) + '</span> ' +
              esc(rpt.title || 'Отчёт #' + rpt.id) + ' <span style="color:var(--t3);font-size:12px;margin-left:8px">' + fmtDate(rpt.created_at) + '</span></span>' +
              '<span class="cr-accordion__arrow">▼</span>' +
            '</div>' +
            '<div class="cr-accordion__body"><div class="cr-accordion__content">' + bodyHtml + '</div></div>' +
          '</div>';
        }).join('');

        // Accordion toggle
        listEl.querySelectorAll('.cr-accordion__head').forEach(function(head) {
          head.addEventListener('click', function() {
            head.parentElement.classList.toggle('cr-accordion--open');
          });
        });

        // Open report detail
        listEl.querySelectorAll('[data-action="openReport"]').forEach(function(btn) {
          btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var id = btn.dataset.reportId;
            if (window.AsgardCallReportsPage) {
              window.AsgardCallReportsPage.openReportDetail(id);
            }
          });
        });
      }

      // Deep link: проверить report=ID в URL
      var params = new URLSearchParams(location.hash.split('?')[1] || '');
      var deepReportId = params.get('report');
      if (deepReportId) {
        var cleanHash = location.hash.replace(/[?&]report=\d+/, '').replace(/\?$/, '');
        history.replaceState(null, '', cleanHash);
        setTimeout(function() {
          if (window.AsgardCallReportsPage) {
            window.AsgardCallReportsPage.openReportDetail(deepReportId);
          }
        }, 400);
      }

    } catch (err) {
      container.innerHTML = '<div style="padding:20px;color:var(--err-t)">Ошибка: ' + esc(err.message) + '</div>';
    }
  }

  /* ======================================================================
   *  CLEANUP HELPERS
   * ====================================================================== */
  function destroyCurrentAudio() {
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
    if (_detailAudio) {
      _detailAudio.pause();
      if (_detailAudio.src && _detailAudio.src.indexOf('blob:') === 0) {
        /* Only revoke if not in cache (cache manages its own blob URLs) */
        var isCached = false;
        _peaksCache.forEach(function (v) {
          if (v.blobUrl === _detailAudio.src) isCached = true;
        });
        if (!isCached) {
          URL.revokeObjectURL(_detailAudio.src);
        }
      }
      _detailAudio.src = '';
      _detailAudio = null;
    }
  }

  /* ======================================================================
   *  PUBLIC API
   * ====================================================================== */
  return { render: render, formatPhone: fmtPhone, formatDuration: fmtDuration };
})();
