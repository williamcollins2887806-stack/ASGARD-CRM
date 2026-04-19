// ASGARD CRM — Умные подсказки Мимира (AsgardHints)
// Визуал: персонаж Мимира с мыслями из головы (комиксовый стиль)
// Три состояния: интрига → думает → раскрытие
// Только десктоп.
window.AsgardHints = (function() {
  'use strict';

  function isMobile() {
    return !!document.getElementById('asgard-shell') || window.innerWidth <= 768;
  }

  // ═══════════════════════════════════════════
  // Конфиг
  // ═══════════════════════════════════════════
  var LABELS = [
    'Мимир заметил кое-что',
    'Мимир тут подумал\u2026',
    'Руны подсказывают',
    'У Мимира мысли',
    'Хм, интересно\u2026',
    'Мимир на страже',
    'Мимир анализирует',
    'Совет хранителя'
  ];

  var TYPE_CONFIG = {
    error:   { bg: 'rgba(248,113,113,0.15)', glow: true },
    warning: { bg: 'rgba(245,158,11,0.15)',  glow: false },
    info:    { bg: 'rgba(74,144,217,0.15)',   glow: false },
    metric:  { bg: 'rgba(45,134,89,0.15)',    glow: false }
  };

  var TKP_EXTENDED = {
    'tenders_no_tkp': {
      subtitle: 'Мимир может создать черновики автоматически.',
      actions: [
        { label: '\uD83E\uDDD9 Создать ТКП через Мимир', type: 'create_tkp' },
        { label: 'Посмотреть тендеры \u2192', type: 'link', href: '#/tenders?filter=no_tkp' }
      ]
    },
    'tkp_stale': {
      subtitle: 'Клиенты молчат \u2014 может стоит напомнить?',
      actions: [
        { label: '\uD83E\uDDD9 Что посоветует Мимир?', type: 'details' }
      ]
    },
    'tkp_old_drafts': {
      subtitle: 'Отправить или удалить?',
      actions: [
        { label: 'Открыть черновики \u2192', type: 'link', href: '#/tkp?filter=draft' }
      ]
    }
  };

  // ═══════════════════════════════════════════
  // Состояние
  // ═══════════════════════════════════════════
  var currentContainer = null;
  var dismissed = new Set();
  var allDismissed = false;
  var _stylesInjected = false;
  var _currentPage = '';
  var _currentParams = null;
  var _pollTimer = null;
  var _pollCount = 0;
  var _analysisDismissed = false;
  var _typewriterTimer = null;
  // Текущие данные для показа
  var _hints = [];
  var _currentHintIndex = 0;
  var _analysis = null;
  var _state = 'teaser'; // 'teaser' | 'thinking' | 'revealed'
  var _showingAnalysis = false;

  // ═══════════════════════════════════════════
  // Утилиты
  // ═══════════════════════════════════════════
  function randomLabel() {
    return LABELS[Math.floor(Math.random() * LABELS.length)];
  }

  function makeTeaser(text) {
    if (!text) return 'Мимир думает\u2026';
    if (text.length <= 45) return text;
    return text.slice(0, 42) + '\u2026';
  }

  function getCurrentHint() {
    if (_showingAnalysis) return null;
    var visible = _hints.filter(function(h) { return !dismissed.has(h.id); });
    if (_currentHintIndex >= visible.length) _currentHintIndex = 0;
    return visible[_currentHintIndex] || null;
  }

  function getVisibleCount() {
    return _hints.filter(function(h) { return !dismissed.has(h.id); }).length;
  }

  // ═══════════════════════════════════════════
  // Инъекция CSS-стилей
  // ═══════════════════════════════════════════
  function injectStyles() {
    if (_stylesInjected) return;
    _stylesInjected = true;
    var s = document.createElement('style');
    s.id = 'asgard-hints-styles';
    s.textContent =
      /* ── Аватар пульсация ── */
      '@keyframes mhAvatarPulse{' +
        '0%{box-shadow:0 0 8px 2px rgba(212,168,67,0.25),0 0 16px 6px rgba(192,57,43,0.1)}' +
        '50%{box-shadow:0 0 16px 6px rgba(212,168,67,0.5),0 0 28px 10px rgba(192,57,43,0.18)}' +
        '100%{box-shadow:0 0 8px 2px rgba(212,168,67,0.25),0 0 16px 6px rgba(192,57,43,0.1)}' +
      '}' +
      /* ── Точки pop-in ── */
      '@keyframes mhDotPop{' +
        '0%{transform:scale(0);opacity:0}' +
        '60%{transform:scale(1.3);opacity:1}' +
        '100%{transform:scale(1);opacity:1}' +
      '}' +
      /* ── Точки золотая пульсация (thinking) ── */
      '@keyframes mhDotGold{' +
        '0%,100%{background:var(--bg2,#1e2330);border-color:rgba(245,215,142,0.08)}' +
        '50%{background:rgba(212,168,67,0.35);border-color:rgba(212,168,67,0.5)}' +
      '}' +
      /* ── Облачко появление ── */
      '@keyframes mhCloudIn{' +
        '0%{opacity:0;transform:scale(0.88) translateY(4px)}' +
        '100%{opacity:1;transform:scale(1) translateY(0)}' +
      '}' +
      /* ── Облачко скрытие ── */
      '@keyframes mhCloudOut{' +
        '0%{opacity:1;transform:scale(1) translateY(0)}' +
        '100%{opacity:0;transform:scale(0.92) translateY(6px)}' +
      '}' +
      /* ── CTA стрелка bounce ── */
      '@keyframes mhArrowBounce{' +
        '0%,100%{transform:translateX(0)}' +
        '50%{transform:translateX(4px)}' +
      '}' +
      /* ── Thinking dots ── */
      '@keyframes mhThinkDot{' +
        '0%,100%{opacity:0.3;transform:scale(0.8)}' +
        '50%{opacity:1;transform:scale(1.2)}' +
      '}' +
      /* ── Аватар wobble (thinking) ── */
      '@keyframes mhAvatarWobble{' +
        '0%{transform:rotate(0deg) scale(1)}' +
        '25%{transform:rotate(3deg) scale(1.05)}' +
        '50%{transform:rotate(0deg) scale(1)}' +
        '75%{transform:rotate(-3deg) scale(1.05)}' +
        '100%{transform:rotate(0deg) scale(1)}' +
      '}' +
      /* ── Typewriter cursor ── */
      '@keyframes mhBlink{0%,100%{opacity:1}50%{opacity:0}}' +
      /* ── Shimmer sweep ── */
      '@keyframes mhShimmer{' +
        '0%{left:-100%}' +
        '100%{left:200%}' +
      '}' +
      /* ── Skeleton pulse ── */
      '@keyframes mhSkelPulse{' +
        '0%{background-position:200% 0}' +
        '100%{background-position:-200% 0}' +
      '}' +
      /* ── Pill fade-in ── */
      '@keyframes mhPillIn{' +
        '0%{opacity:0;transform:translateX(-8px)}' +
        '100%{opacity:1;transform:translateX(0)}' +
      '}' +
      /* ── Container fade-out ── */
      '@keyframes mhFadeOut{' +
        '0%{opacity:1;transform:translateY(0)}' +
        '100%{opacity:0;transform:translateY(-10px)}' +
      '}' +
      /* ── Expanded area reveal ── */
      '@keyframes mhExpandReveal{' +
        'from{opacity:0;max-height:0}' +
        'to{opacity:1;max-height:500px}' +
      '}' +
      /* ── Label dot pulse ── */
      '@keyframes mhLabelDot{' +
        '0%,100%{opacity:0.4}' +
        '50%{opacity:1}' +
      '}' +

      /* ═══ Component styles ═══ */

      /* Container */
      '.mh-wrap{position:relative;margin:16px 32px 0;display:flex;flex-direction:column;align-items:flex-start}' +

      /* Avatar */
      '.mh-avatar{' +
        'width:56px;height:56px;border-radius:50%;' +
        'background:linear-gradient(135deg,#c0392b 0%,#2a3b66 100%);' +
        'border:2px solid var(--gold-l,#c4a84e);' +
        'display:flex;align-items:center;justify-content:center;' +
        'font-size:26px;position:relative;cursor:pointer;' +
        'flex-shrink:0;z-index:2;' +
        'animation:mhAvatarPulse 4s ease infinite;' +
        'transition:border-color .3s,transform .3s,box-shadow .3s' +
      '}' +
      '.mh-avatar:hover{' +
        'border-color:#e8c94a;transform:scale(1.06);' +
        'box-shadow:0 0 20px 8px rgba(212,168,67,0.45),0 0 36px 14px rgba(192,57,43,0.2)' +
      '}' +
      '.mh-avatar.mh-wobble{animation:mhAvatarWobble 1.2s ease infinite,mhAvatarPulse 4s ease infinite}' +

      /* Rune badge */
      '.mh-rune{' +
        'position:absolute;top:-2px;left:-2px;' +
        'width:20px;height:20px;border-radius:50%;' +
        'background:var(--gold-l,#c4a84e);' +
        'color:#2a3b66;font-size:11px;font-weight:800;' +
        'display:flex;align-items:center;justify-content:center;' +
        'line-height:1' +
      '}' +

      /* Dots chain */
      '.mh-dots{position:absolute;z-index:1}' +
      '.mh-dot{' +
        'position:absolute;border-radius:50%;' +
        'background:var(--bg2,#1e2330);' +
        'border:1px solid rgba(245,215,142,0.08);' +
        'transform:scale(0);opacity:0' +
      '}' +
      '.mh-dot.mh-pop{animation:mhDotPop .3s ease forwards}' +
      '.mh-dot.mh-gold{animation:mhDotGold 1.5s ease infinite}' +

      /* Cloud */
      '.mh-cloud{' +
        'position:relative;' +
        'background:var(--bg2,#1e2330);' +
        'border:1px solid rgba(192,57,43,0.2);' +
        'border-radius:20px;' +
        'box-shadow:0 4px 20px rgba(0,0,0,0.3),0 0 0 1px rgba(245,215,142,0.05);' +
        'margin-left:74px;margin-top:-16px;' +
        'min-width:260px;max-width:520px;' +
        'padding:16px 20px;z-index:3;' +
        'animation:mhCloudIn .45s ease .5s both;' +
        'transition:border-color .3s,box-shadow .3s,max-width .4s ease' +
      '}' +
      '.mh-cloud:hover{border-color:rgba(192,57,43,0.35);box-shadow:0 4px 24px rgba(0,0,0,0.35),0 0 0 1px rgba(245,215,142,0.1)}' +
      '.mh-cloud.mh-thinking{border-color:rgba(212,168,67,0.35)}' +
      '.mh-cloud.mh-wide{max-width:620px}' +

      /* Cloud lobe decorations */
      '.mh-cloud::before{' +
        'content:"";position:absolute;bottom:-6px;left:18px;' +
        'width:16px;height:12px;border-radius:50%;' +
        'background:var(--bg2,#1e2330);' +
        'border:1px solid rgba(192,57,43,0.15);' +
        'border-top-color:transparent' +
      '}' +
      '.mh-cloud::after{' +
        'content:"";position:absolute;top:-5px;right:30px;' +
        'width:14px;height:10px;border-radius:50%;' +
        'background:var(--bg2,#1e2330);' +
        'border:1px solid rgba(192,57,43,0.12);' +
        'border-bottom-color:transparent' +
      '}' +

      /* Label row */
      '.mh-label-row{display:flex;align-items:center;gap:6px;margin-bottom:8px}' +
      '.mh-label-dot{' +
        'width:6px;height:6px;border-radius:50%;' +
        'background:var(--gold-l,#c4a84e);' +
        'animation:mhLabelDot 2s ease infinite;flex-shrink:0' +
      '}' +
      '.mh-label{' +
        'font-size:10px;font-weight:700;text-transform:uppercase;' +
        'letter-spacing:1.2px;color:var(--gold-l,#c4a84e);opacity:0.7' +
      '}' +
      '.mh-counter{font-size:10px;color:var(--t3,#666);margin-left:2px;text-transform:none;letter-spacing:0}' +

      /* Dismiss X */
      '.mh-dismiss{' +
        'position:absolute;top:10px;right:12px;' +
        'background:none;border:none;color:var(--t3,#666);' +
        'cursor:pointer;font-size:16px;padding:2px 6px;' +
        'border-radius:4px;transition:color .2s,opacity .2s;' +
        'opacity:0;line-height:1' +
      '}' +
      '.mh-cloud:hover .mh-dismiss{opacity:1}' +
      '.mh-dismiss:hover{color:var(--t1,#eee)}' +

      /* Teaser text */
      '.mh-teaser{font-size:13.5px;color:var(--t1,#eee);line-height:1.5;margin-bottom:6px}' +

      /* CTA */
      '.mh-cta{' +
        'font-size:11px;color:var(--gold-l,#c4a84e);opacity:0.5;' +
        'cursor:pointer;display:inline-flex;align-items:center;gap:4px;' +
        'background:none;border:none;padding:0;transition:opacity .2s' +
      '}' +
      '.mh-cta:hover{opacity:1}' +
      '.mh-cta .mh-cta-arrow{display:inline-block;animation:mhArrowBounce 1.2s ease infinite}' +
      '.mh-cloud.mh-clickable{cursor:pointer}' +

      /* Скрыть все */
      '.mh-dismiss-all{' +
        'font-size:10px;color:var(--t3,#666);opacity:0;' +
        'cursor:pointer;background:none;border:none;padding:0;' +
        'transition:opacity .2s;position:absolute;top:12px;right:34px' +
      '}' +
      '.mh-cloud:hover .mh-dismiss-all{opacity:0.7}' +
      '.mh-dismiss-all:hover{opacity:1!important;color:var(--t2,#aaa)}' +

      /* Thinking dots */
      '.mh-think-dots{display:flex;align-items:center;justify-content:center;gap:8px;padding:12px 0}' +
      '.mh-think-dot{' +
        'width:8px;height:8px;border-radius:50%;' +
        'background:var(--gold-l,#c4a84e);' +
        'animation:mhThinkDot 1s ease infinite' +
      '}' +

      /* Expanded area */
      '.mh-expanded{' +
        'border-top:1px solid rgba(245,215,142,0.1);' +
        'margin-top:10px;padding-top:10px;' +
        'animation:mhExpandReveal .5s ease forwards;overflow:hidden' +
      '}' +
      '.mh-expanded-text{font-size:13px;line-height:1.6;color:var(--t2,#aaa)}' +
      '.mh-expanded-text.mh-typed{color:var(--t1,#eee)}' +

      /* Shimmer on expanded */
      '.mh-expanded.mh-shimmer{position:relative;overflow:hidden}' +
      '.mh-expanded.mh-shimmer::after{' +
        'content:"";position:absolute;top:0;left:-100%;' +
        'width:60%;height:100%;' +
        'background:linear-gradient(90deg,transparent,rgba(212,168,67,0.08),rgba(245,215,142,0.12),rgba(212,168,67,0.08),transparent);' +
        'animation:mhShimmer 1.5s ease .3s 1 forwards;pointer-events:none' +
      '}' +

      /* Action buttons */
      '.mh-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}' +
      '.mh-btn-primary{' +
        'background:linear-gradient(135deg,#c4a84e 0%,#a08030 100%);' +
        'border:none;color:#1e2330;' +
        'padding:6px 14px;border-radius:8px;' +
        'font-size:12px;font-weight:600;cursor:pointer;' +
        'transition:all .2s;white-space:nowrap' +
      '}' +
      '.mh-btn-primary:hover{filter:brightness(1.1);box-shadow:0 0 10px rgba(212,168,67,0.3)}' +
      '.mh-btn-ghost{' +
        'background:none;' +
        'border:1px solid rgba(196,168,78,0.3);color:var(--gold-l,#c4a84e);' +
        'padding:5px 14px;border-radius:8px;' +
        'font-size:12px;cursor:pointer;' +
        'transition:all .2s;white-space:nowrap' +
      '}' +
      '.mh-btn-ghost:hover{border-color:rgba(196,168,78,0.5);background:rgba(196,168,78,0.06)}' +

      /* Next hint button */
      '.mh-next{' +
        'font-size:11px;color:var(--gold-l,#c4a84e);opacity:0.6;' +
        'cursor:pointer;background:none;border:none;padding:0;' +
        'transition:opacity .2s;margin-left:auto' +
      '}' +
      '.mh-next:hover{opacity:1}' +

      /* Skeleton lines */
      '.mh-skel-wrap{display:flex;flex-direction:column;gap:8px;padding:8px 0}' +
      '.mh-skel-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#D4A843;opacity:0.5}' +
      '.mh-skel-line{' +
        'height:12px;border-radius:6px;' +
        'background:linear-gradient(90deg,rgba(212,168,67,0.06) 25%,rgba(212,168,67,0.2) 50%,rgba(212,168,67,0.06) 75%);' +
        'background-size:200% 100%;animation:mhSkelPulse 1.6s ease infinite' +
      '}' +

      /* Typewriter cursor */
      '.mh-cursor{' +
        'display:inline-block;width:2px;height:14px;' +
        'background:#D4A843;margin-left:2px;vertical-align:text-bottom;' +
        'animation:mhBlink .7s step-end infinite' +
      '}' +

      /* Pill (collapsed state) */
      '.mh-pill{' +
        'display:inline-flex;align-items:center;gap:6px;' +
        'margin-left:12px;margin-top:14px;' +
        'background:var(--bg2,#1e2330);' +
        'border:1px solid rgba(192,57,43,0.2);' +
        'border-radius:20px;padding:6px 14px;' +
        'font-size:12px;color:var(--gold-l,#c4a84e);' +
        'cursor:pointer;opacity:0.8;' +
        'transition:opacity .2s,border-color .2s,box-shadow .2s;' +
        'animation:mhPillIn .4s ease both' +
      '}' +
      '.mh-pill:hover{opacity:1;border-color:rgba(212,168,67,0.4);box-shadow:0 0 12px rgba(212,168,67,0.15)}' +
      '.mh-pill-emoji{font-size:16px}' +
      '';
    document.head.appendChild(s);
  }

  // ═══════════════════════════════════════════
  // Typewriter
  // ═══════════════════════════════════════════
  function stopTypewriter() {
    if (_typewriterTimer) { clearInterval(_typewriterTimer); _typewriterTimer = null; }
  }

  function typewriterText(el, text, onDone) {
    var chars = text.split('');
    var idx = 0;
    el.textContent = '';
    el.classList.add('mh-typed');
    var cursor = document.createElement('span');
    cursor.className = 'mh-cursor';
    el.appendChild(cursor);

    _typewriterTimer = setInterval(function() {
      if (idx >= chars.length) {
        clearInterval(_typewriterTimer);
        _typewriterTimer = null;
        setTimeout(function() { if (cursor.parentNode) cursor.remove(); }, 1200);
        if (onDone) onDone();
        return;
      }
      cursor.insertAdjacentText('beforebegin', chars[idx]);
      idx++;
    }, 25);
  }

  // ═══════════════════════════════════════════
  // Polling AI-анализа
  // ═══════════════════════════════════════════
  function stopPolling() {
    if (_pollTimer) { clearTimeout(_pollTimer); _pollTimer = null; }
    _pollCount = 0;
  }

  function pollForAnalysis() {
    if (_pollCount >= 10) { onPollExhausted(); return; }
    _pollCount++;

    var token = localStorage.getItem('asgard_token');
    if (!token) return;

    var url = '/api/hints/analysis?page=' + encodeURIComponent(_currentPage);
    if (_currentParams && _currentParams.employee_id) {
      url += '&employee_id=' + encodeURIComponent(_currentParams.employee_id);
    }

    fetch(url, { headers: { Authorization: 'Bearer ' + token } })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) {
        if (!data || !data.analysis) { _pollTimer = setTimeout(pollForAnalysis, 3000); return; }
        if (data.analysis.status === 'ready' && data.analysis.text) {
          _analysis = data.analysis;
          showAnalysisRevealed(data.analysis.text, true);
          return;
        }
        _pollTimer = setTimeout(pollForAnalysis, 3000);
      })
      .catch(function() {
        _pollTimer = setTimeout(pollForAnalysis, 3000);
      });
  }

  function onPollExhausted() {
    // Polling exhausted — revert to teaser or hide
    var cloud = document.querySelector('.mh-cloud');
    if (!cloud) return;
    if (_showingAnalysis) {
      _showingAnalysis = false;
      var hint = getCurrentHint();
      if (hint) {
        renderCloudContent(cloud, 'teaser');
      } else {
        hideCloudAnimated();
      }
    }
  }

  // ═══════════════════════════════════════════
  // FAB Мимир интеграция
  // ═══════════════════════════════════════════
  function openMimirWith(question) {
    if (!window.AsgardMimir || !AsgardMimir.open) return;
    AsgardMimir.open();
    setTimeout(function() {
      var input = document.querySelector('#mimirInput, .mimir-input');
      if (!input) return;
      input.value = question;
      input.dispatchEvent(new Event('input'));
      var sendBtn = document.querySelector('.mimir-send-btn, #mimirSend');
      if (sendBtn) sendBtn.click();
    }, 500);
  }

  // ═══════════════════════════════════════════
  // Загрузка подсказок
  // ═══════════════════════════════════════════
  async function load(page, params) {
    if (isMobile()) return;
    if (!page) return;
    if (allDismissed) { remove(); return; }

    if (page === 'employee' && params && params.id && !params.employee_id) {
      params.employee_id = params.id;
    }

    _currentPage = page;
    _currentParams = params;
    _analysisDismissed = false;
    _showingAnalysis = false;
    _currentHintIndex = 0;
    _state = 'teaser';
    stopPolling();
    stopTypewriter();
    remove();

    try {
      var token = localStorage.getItem('asgard_token');
      if (!token) return;

      var url = '/api/hints?page=' + encodeURIComponent(page);
      if (params && params.employee_id) {
        url += '&employee_id=' + encodeURIComponent(params.employee_id);
      }

      var resp = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
      if (!resp.ok) return;
      var data = await resp.json();
      _hints = (data.hints || []).filter(function(h) { return !dismissed.has(h.id); });
      _analysis = data.analysis || null;

      if (!_hints.length && !_analysis) return;

      render();
    } catch (e) {
      // Подсказки не должны ломать страницу
    }
  }

  // ═══════════════════════════════════════════
  // Основной рендер
  // ═══════════════════════════════════════════
  function render() {
    injectStyles();

    var wrap = document.createElement('div');
    wrap.className = 'mh-wrap';
    wrap.id = 'asgard-hints-bar';

    // ── Облачко (сверху) ──
    var cloud = document.createElement('div');
    cloud.className = 'mh-cloud';
    renderCloudContent(cloud, 'teaser');
    wrap.appendChild(cloud);

    // ── Точки (абсолютные, между облачком и аватаром) ──
    var dotsContainer = document.createElement('div');
    dotsContainer.className = 'mh-dots';
    dotsContainer.style.cssText = 'position:relative;width:74px;height:24px;margin-left:8px;margin-top:-8px';

    var dotSizes = [8, 12, 16];
    var dotPositions = [
      { left: 44, top: 12 },
      { left: 30, top: 6 },
      { left: 16, top: 0 }
    ];
    var dotDelays = [120, 260, 400];

    for (var i = 0; i < 3; i++) {
      var dot = document.createElement('div');
      dot.className = 'mh-dot';
      dot.style.cssText =
        'width:' + dotSizes[i] + 'px;height:' + dotSizes[i] + 'px;' +
        'left:' + dotPositions[i].left + 'px;top:' + dotPositions[i].top + 'px';
      // Delayed pop animation
      (function(d, delay) {
        setTimeout(function() { d.classList.add('mh-pop'); }, delay);
      })(dot, dotDelays[i]);
      dotsContainer.appendChild(dot);
    }
    wrap.appendChild(dotsContainer);

    // ── Аватар (внизу слева) ──
    var avatar = document.createElement('div');
    avatar.className = 'mh-avatar';
    avatar.innerHTML = '\uD83E\uDDD9';

    var rune = document.createElement('div');
    rune.className = 'mh-rune';
    rune.textContent = '\u16D7'; // ᛗ
    avatar.appendChild(rune);

    avatar.addEventListener('click', function() {
      onAvatarClick(wrap);
    });

    wrap.appendChild(avatar);

    // ── Вставка в DOM ──
    var main = document.querySelector('main.main');
    var layoutDiv = document.getElementById('layout');
    if (main && layoutDiv) {
      main.insertBefore(wrap, layoutDiv);
    }
    currentContainer = wrap;

    // ── AI Analysis: если generating — начинаем polling ──
    if (_analysis && !_analysisDismissed) {
      if (_analysis.status === 'generating') {
        // Если нет hints — показать скелетон сразу в облачке
        if (!_hints.length) {
          _showingAnalysis = true;
          renderCloudContent(cloud, 'skeleton');
        }
        _pollTimer = setTimeout(pollForAnalysis, 3000);
      } else if (_analysis.status === 'ready' && _analysis.text && !_hints.length) {
        _showingAnalysis = true;
        renderCloudContent(cloud, 'analysis-ready');
      }
    }
  }

  // ═══════════════════════════════════════════
  // Содержимое облачка
  // ═══════════════════════════════════════════
  function renderCloudContent(cloud, mode) {
    stopTypewriter();
    cloud.innerHTML = '';
    cloud.classList.remove('mh-thinking', 'mh-wide', 'mh-clickable');

    var hint = getCurrentHint();
    var visibleCount = getVisibleCount();
    var isTkp = (_currentPage === 'tkp');

    // Dismiss button (always present)
    var dismissBtn = document.createElement('button');
    dismissBtn.className = 'mh-dismiss';
    dismissBtn.innerHTML = '&times;';
    dismissBtn.title = 'Скрыть';
    dismissBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      onDismissCurrent();
    });
    cloud.appendChild(dismissBtn);

    // «Скрыть все» button (when multiple hints)
    if (visibleCount > 1 && (mode === 'teaser' || mode === 'revealed')) {
      var dismissAllBtn = document.createElement('button');
      dismissAllBtn.className = 'mh-dismiss-all';
      dismissAllBtn.textContent = 'Скрыть все';
      dismissAllBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        dismissAll();
      });
      cloud.appendChild(dismissAllBtn);
    }

    if (mode === 'teaser') {
      _state = 'teaser';
      // Клик по всему облачку → thinking
      cloud.classList.add('mh-clickable');
      cloud.addEventListener('click', function(e) {
        if (e.target.closest('.mh-dismiss') || e.target.closest('.mh-dismiss-all')) return;
        if (_state === 'teaser') transitionToThinking(cloud);
      });
      // Label row
      var labelRow = document.createElement('div');
      labelRow.className = 'mh-label-row';

      var labelDot = document.createElement('span');
      labelDot.className = 'mh-label-dot';
      labelRow.appendChild(labelDot);

      var label = document.createElement('span');
      label.className = 'mh-label';
      label.textContent = randomLabel();
      labelRow.appendChild(label);

      if (visibleCount > 1) {
        var counter = document.createElement('span');
        counter.className = 'mh-counter';
        counter.textContent = ' (' + (_currentHintIndex + 1) + '/' + visibleCount + ')';
        labelRow.appendChild(counter);
      }

      cloud.appendChild(labelRow);

      // Teaser text
      var teaserEl = document.createElement('div');
      teaserEl.className = 'mh-teaser';
      if (hint) {
        teaserEl.textContent = hint.teaser || makeTeaser(hint.text);
        if (hint.icon) teaserEl.textContent += ' ' + hint.icon;
      } else if (_analysis && !_analysisDismissed) {
        teaserEl.textContent = _analysis.teaser || 'Не хотите узнать немного больше?';
      }
      cloud.appendChild(teaserEl);

      // CTA
      var cta = document.createElement('button');
      cta.className = 'mh-cta';
      cta.innerHTML = 'Узнать <span class="mh-cta-arrow">\u2192</span>';
      cta.addEventListener('click', function(e) {
        e.stopPropagation();
        transitionToThinking(cloud);
      });
      cloud.appendChild(cta);

    } else if (mode === 'thinking') {
      _state = 'thinking';
      cloud.classList.add('mh-thinking');

      var labelRow2 = document.createElement('div');
      labelRow2.className = 'mh-label-row';
      var labelDot2 = document.createElement('span');
      labelDot2.className = 'mh-label-dot';
      var label2 = document.createElement('span');
      label2.className = 'mh-label';
      label2.textContent = 'Мимир анализирует';
      labelRow2.appendChild(labelDot2);
      labelRow2.appendChild(label2);
      cloud.appendChild(labelRow2);

      var dotsWrap = document.createElement('div');
      dotsWrap.className = 'mh-think-dots';
      for (var i = 0; i < 3; i++) {
        var d = document.createElement('span');
        d.className = 'mh-think-dot';
        d.style.animationDelay = (i * 0.15) + 's';
        dotsWrap.appendChild(d);
      }
      cloud.appendChild(dotsWrap);

      // Аватар wobble
      setAvatarWobble(true);
      // Dots golden
      setDotsGolden(true);

    } else if (mode === 'revealed') {
      _state = 'revealed';
      cloud.classList.add('mh-wide');

      var labelRow3 = document.createElement('div');
      labelRow3.className = 'mh-label-row';
      var labelDot3 = document.createElement('span');
      labelDot3.className = 'mh-label-dot';
      var label3 = document.createElement('span');
      label3.className = 'mh-label';
      label3.textContent = randomLabel();
      labelRow3.appendChild(labelDot3);
      labelRow3.appendChild(label3);
      if (visibleCount > 1) {
        var counter3 = document.createElement('span');
        counter3.className = 'mh-counter';
        counter3.textContent = ' (' + (_currentHintIndex + 1) + '/' + visibleCount + ')';
        labelRow3.appendChild(counter3);
      }
      cloud.appendChild(labelRow3);

      // Teaser (smaller, faded)
      if (hint) {
        var teaserSmall = document.createElement('div');
        teaserSmall.className = 'mh-teaser';
        teaserSmall.textContent = hint.teaser || makeTeaser(hint.text);
        if (hint.icon) teaserSmall.textContent += ' ' + hint.icon;
        cloud.appendChild(teaserSmall);
      }

      // Expanded detail
      var expanded = document.createElement('div');
      expanded.className = 'mh-expanded mh-shimmer';

      if (hint) {
        var detailText = document.createElement('div');
        detailText.className = 'mh-expanded-text';
        detailText.textContent = hint.text;
        expanded.appendChild(detailText);

        // Subtitle for TKP
        var ext = (isTkp && TKP_EXTENDED[hint.id]) ? TKP_EXTENDED[hint.id] : null;
        if (ext && ext.subtitle) {
          var sub = document.createElement('div');
          sub.style.cssText = 'font-size:12px;color:var(--t3,#666);margin-top:4px;line-height:1.4';
          sub.textContent = ext.subtitle;
          expanded.appendChild(sub);
        }

        // Actions
        var actionsData = buildActionsData(hint, ext);
        if (actionsData.length || visibleCount > 1) {
          var actionsRow = document.createElement('div');
          actionsRow.className = 'mh-actions';

          actionsData.forEach(function(act) {
            var btn;
            if (act.type === 'link') {
              btn = document.createElement('a');
              btn.className = 'mh-btn-primary';
              btn.href = act.href;
            } else {
              btn = document.createElement('button');
              btn.className = act.primary ? 'mh-btn-primary' : 'mh-btn-ghost';
              btn.dataset.actionType = act.type;
              if (act.type === 'details') btn.dataset.hintText = hint.text;
            }
            btn.textContent = act.label;
            btn.addEventListener('click', function(e) {
              e.stopPropagation();
              handleAction(act, hint);
            });
            actionsRow.appendChild(btn);
          });

          // "Позже" button
          var laterBtn = document.createElement('button');
          laterBtn.className = 'mh-btn-ghost';
          laterBtn.textContent = 'Позже';
          laterBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            onDismissCurrent();
          });
          actionsRow.appendChild(laterBtn);

          // "Следующая ›" if multiple
          if (visibleCount > 1) {
            var nextBtn = document.createElement('button');
            nextBtn.className = 'mh-next';
            nextBtn.textContent = 'Следующая \u203A';
            nextBtn.addEventListener('click', function(e) {
              e.stopPropagation();
              goNextHint(cloud);
            });
            actionsRow.appendChild(nextBtn);
          }

          expanded.appendChild(actionsRow);
        }
      }

      cloud.appendChild(expanded);

      // Остановить wobble/golden
      setAvatarWobble(false);
      setDotsGolden(false);

    } else if (mode === 'skeleton') {
      // AI skeleton loading
      _state = 'thinking';
      cloud.classList.add('mh-thinking');

      var skelWrap = document.createElement('div');
      skelWrap.className = 'mh-skel-wrap';

      var skelLabel = document.createElement('div');
      skelLabel.className = 'mh-skel-label';
      skelLabel.textContent = 'Мимир думает\u2026';
      skelWrap.appendChild(skelLabel);

      var widths = ['85%', '70%', '50%'];
      for (var j = 0; j < widths.length; j++) {
        var line = document.createElement('div');
        line.className = 'mh-skel-line';
        line.style.width = widths[j];
        line.style.animationDelay = (j * 200) + 'ms';
        skelWrap.appendChild(line);
      }
      cloud.appendChild(skelWrap);

      setAvatarWobble(true);
      setDotsGolden(true);

    } else if (mode === 'analysis-ready') {
      // AI analysis text, no typewriter (cached)
      _state = 'revealed';
      cloud.classList.add('mh-wide');

      var labelRow4 = document.createElement('div');
      labelRow4.className = 'mh-label-row';
      var labelDot4 = document.createElement('span');
      labelDot4.className = 'mh-label-dot';
      var label4 = document.createElement('span');
      label4.className = 'mh-label';
      label4.textContent = 'Мимир анализирует';
      labelRow4.appendChild(labelDot4);
      labelRow4.appendChild(label4);
      cloud.appendChild(labelRow4);

      var exp4 = document.createElement('div');
      exp4.className = 'mh-expanded mh-shimmer';
      var text4 = document.createElement('div');
      text4.className = 'mh-expanded-text mh-typed';
      text4.textContent = _analysis.text;
      exp4.appendChild(text4);
      cloud.appendChild(exp4);

    } else if (mode === 'analysis-typewriter') {
      // AI analysis text with typewriter
      _state = 'revealed';
      cloud.classList.add('mh-wide');

      var labelRow5 = document.createElement('div');
      labelRow5.className = 'mh-label-row';
      var labelDot5 = document.createElement('span');
      labelDot5.className = 'mh-label-dot';
      var label5 = document.createElement('span');
      label5.className = 'mh-label';
      label5.textContent = 'Мимир анализирует';
      labelRow5.appendChild(labelDot5);
      labelRow5.appendChild(label5);
      cloud.appendChild(labelRow5);

      var exp5 = document.createElement('div');
      exp5.className = 'mh-expanded mh-shimmer';
      var text5 = document.createElement('div');
      text5.className = 'mh-expanded-text';
      exp5.appendChild(text5);
      cloud.appendChild(exp5);

      requestAnimationFrame(function() {
        typewriterText(text5, _analysis.text);
      });

      setAvatarWobble(false);
      setDotsGolden(false);
    }
  }

  // ═══════════════════════════════════════════
  // Переходы между состояниями
  // ═══════════════════════════════════════════
  function transitionToThinking(cloud) {
    var hint = getCurrentHint();
    var isAnalysisTrigger = !hint && _analysis && !_analysisDismissed &&
      (_analysis.status === 'pending' || _analysis.status === 'generating');

    renderCloudContent(cloud, 'thinking');

    if (isAnalysisTrigger) {
      // Start polling for analysis
      _showingAnalysis = true;
      if (_analysis.status === 'pending' || _analysis.status === 'generating') {
        _pollTimer = setTimeout(pollForAnalysis, 500);
      }
      // After delay show skeleton
      setTimeout(function() {
        if (_state === 'thinking' && _showingAnalysis) {
          renderCloudContent(cloud, 'skeleton');
        }
      }, 1200);
    } else {
      // Regular hint reveal after 1.2s
      setTimeout(function() {
        if (_state === 'thinking') {
          renderCloudContent(cloud, 'revealed');
        }
      }, 1200);
    }
  }

  function showAnalysisRevealed(text, withTypewriter) {
    stopPolling();
    var cloud = document.querySelector('.mh-cloud');
    if (!cloud || _analysisDismissed) return;

    _showingAnalysis = true;
    renderCloudContent(cloud, withTypewriter ? 'analysis-typewriter' : 'analysis-ready');
  }

  // ═══════════════════════════════════════════
  // Аватар и точки
  // ═══════════════════════════════════════════
  function setAvatarWobble(on) {
    var avatar = document.querySelector('.mh-avatar');
    if (!avatar) return;
    if (on) {
      avatar.classList.add('mh-wobble');
    } else {
      avatar.classList.remove('mh-wobble');
    }
  }

  function setDotsGolden(on) {
    var dots = document.querySelectorAll('.mh-dot');
    dots.forEach(function(d) {
      if (on) {
        d.classList.add('mh-gold');
      } else {
        d.classList.remove('mh-gold');
      }
    });
  }

  // ═══════════════════════════════════════════
  // Действия
  // ═══════════════════════════════════════════
  function buildActionsData(hint, ext) {
    if (ext && ext.actions) return ext.actions;
    var actions = [];
    if (hint.link) {
      actions.push({ label: 'Показать \u2192', type: 'link', href: hint.link, primary: true });
    }
    if (hint.actions && hint.actions.indexOf('details') >= 0) {
      actions.push({ label: '\uD83E\uDDD9 Подробнее', type: 'details', primary: !hint.link });
    }
    if (hint.actions && hint.actions.indexOf('create_tkp') >= 0) {
      actions.push({ label: '\uD83E\uDDD9 Создать ТКП', type: 'create_tkp', primary: true });
    }
    return actions;
  }

  function handleAction(act, hint) {
    if (act.type === 'link' && act.href) {
      window.location.hash = act.href.replace(/^#/, '');
    } else if (act.type === 'details') {
      openMimirWith('Расскажи подробнее: ' + (hint ? hint.text : ''));
    } else if (act.type === 'create_tkp') {
      openMimirWith('Создай ТКП по ближайшему просчитанному тендеру');
    }
  }

  // ═══════════════════════════════════════════
  // Dismiss / Navigate
  // ═══════════════════════════════════════════
  function onDismissCurrent() {
    var cloud = document.querySelector('.mh-cloud');
    if (!cloud) return;

    if (_showingAnalysis) {
      _analysisDismissed = true;
      _showingAnalysis = false;
      stopPolling();
      stopTypewriter();
      // Check if there are hints to show
      var hint = getCurrentHint();
      if (hint) {
        reanimateCloud(cloud, 'teaser');
        return;
      }
    } else {
      var h = getCurrentHint();
      if (h) dismissed.add(h.id);
    }

    var remaining = getVisibleCount();
    var hasAnalysis = _analysis && !_analysisDismissed &&
      (_analysis.status === 'pending' || _analysis.status === 'generating' || _analysis.status === 'ready');

    if (remaining > 0) {
      _currentHintIndex = 0;
      _state = 'teaser';
      reanimateCloud(cloud, 'teaser');
    } else if (hasAnalysis) {
      _showingAnalysis = true;
      _currentHintIndex = 0;
      reanimateCloud(cloud, 'teaser');
    } else {
      // All dismissed — collapse to pill
      collapseToHidden();
    }
  }

  function goNextHint(cloud) {
    var visible = _hints.filter(function(h) { return !dismissed.has(h.id); });
    if (visible.length <= 1) return;
    _currentHintIndex = (_currentHintIndex + 1) % visible.length;
    _state = 'teaser';
    reanimateCloud(cloud, 'teaser');
  }

  function reanimateCloud(cloud, mode) {
    cloud.style.animation = 'none';
    cloud.offsetHeight; // trigger reflow
    cloud.style.animation = 'mhCloudIn .35s ease both';
    renderCloudContent(cloud, mode);
  }

  function hideCloudAnimated() {
    var cloud = document.querySelector('.mh-cloud');
    var dotsContainer = document.querySelector('.mh-dots');
    if (cloud) {
      cloud.style.animation = 'mhCloudOut .3s ease forwards';
    }
    if (dotsContainer) {
      dotsContainer.style.transition = 'opacity .3s';
      dotsContainer.style.opacity = '0';
    }
  }

  function collapseToHidden() {
    stopPolling();
    stopTypewriter();

    var cloud = document.querySelector('.mh-cloud');
    var dotsContainer = document.querySelector('.mh-dots');

    if (cloud) {
      cloud.style.animation = 'mhCloudOut .3s ease forwards';
      setTimeout(function() { if (cloud.parentNode) cloud.style.display = 'none'; }, 300);
    }
    if (dotsContainer) {
      dotsContainer.style.transition = 'opacity .3s';
      dotsContainer.style.opacity = '0';
      setTimeout(function() { if (dotsContainer.parentNode) dotsContainer.style.display = 'none'; }, 300);
    }

    // Show pill next to avatar
    var wrap = document.getElementById('asgard-hints-bar');
    if (!wrap) return;

    var existingPill = wrap.querySelector('.mh-pill');
    if (existingPill) return;

    var pill = document.createElement('div');
    pill.className = 'mh-pill';
    pill.innerHTML = '<span class="mh-pill-emoji">\uD83E\uDDD9</span> У Мимира есть мысль\u2026';
    pill.addEventListener('click', function() {
      expandFromPill(pill);
    });
    wrap.appendChild(pill);
  }

  function expandFromPill(pill) {
    if (pill && pill.parentNode) pill.remove();

    var cloud = document.querySelector('.mh-cloud');
    var dotsContainer = document.querySelector('.mh-dots');

    // Reset state
    _state = 'teaser';
    _showingAnalysis = false;
    _currentHintIndex = 0;

    // Find first available content
    var hint = getCurrentHint();
    var hasAnalysis = _analysis && !_analysisDismissed;

    if (!hint && !hasAnalysis) return;

    if (hint) {
      // Un-dismiss hints (reset dismissed for re-show)
      // Actually, keep dismissed. Just show the remaining ones.
    } else if (hasAnalysis) {
      _showingAnalysis = true;
    }

    // Show cloud and dots
    if (cloud) {
      cloud.style.display = '';
      cloud.style.animation = 'mhCloudIn .45s ease both';
      renderCloudContent(cloud, 'teaser');
    }
    if (dotsContainer) {
      dotsContainer.style.display = '';
      dotsContainer.style.opacity = '1';
      // Re-pop dots
      var dots = dotsContainer.querySelectorAll('.mh-dot');
      var delays = [120, 260, 400];
      dots.forEach(function(d, i) {
        d.classList.remove('mh-pop');
        d.offsetHeight;
        setTimeout(function() { d.classList.add('mh-pop'); }, delays[i]);
      });
    }
  }

  function onAvatarClick(wrap) {
    var cloud = wrap.querySelector('.mh-cloud');
    if (!cloud) return;

    // If cloud is hidden (collapsed) — expand from pill state
    if (cloud.style.display === 'none') {
      var pill = wrap.querySelector('.mh-pill');
      expandFromPill(pill);
      return;
    }

    // If in teaser — go to thinking
    if (_state === 'teaser') {
      transitionToThinking(cloud);
    }
  }

  // ═══════════════════════════════════════════
  // Dismiss all
  // ═══════════════════════════════════════════
  function dismissAll() {
    allDismissed = true;
    stopPolling();
    stopTypewriter();
    var wrap = document.getElementById('asgard-hints-bar');
    if (!wrap) return;
    wrap.style.animation = 'mhFadeOut .3s ease forwards';
    setTimeout(function() { wrap.remove(); currentContainer = null; }, 300);
  }

  // ═══════════════════════════════════════════
  // Удаление подсказок
  // ═══════════════════════════════════════════
  function remove() {
    stopPolling();
    stopTypewriter();
    if (currentContainer) { currentContainer.remove(); currentContainer = null; }
    var old = document.getElementById('asgard-hints-bar');
    if (old) old.remove();
  }

  return { load: load, remove: remove };
})();
