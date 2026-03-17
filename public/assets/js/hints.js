// ASGARD CRM — Умные подсказки Мимира (AsgardHints)
// Визуальные контекстные подсказки + AI-анализ (Level 4 WOW)
// Только десктоп.
window.AsgardHints = (function() {
  'use strict';
  var ui = AsgardUI;
  var $ = ui.$;
  var esc = ui.esc;
  var toast = ui.toast;

  function isMobile() {
    return !!document.getElementById('asgard-shell') || window.innerWidth <= 768;
  }

  // ═══════════════════════════════════════════
  // Стили подсказок по типу
  // ═══════════════════════════════════════════
  var TYPE_CONFIG = {
    error:   { bg: 'rgba(248,113,113,0.15)', glow: true },
    warning: { bg: 'rgba(245,158,11,0.15)',  glow: false },
    info:    { bg: 'rgba(74,144,217,0.15)',   glow: false },
    metric:  { bg: 'rgba(45,134,89,0.15)',    glow: false }
  };

  var currentBar = null;
  var dismissed = new Set();
  var allDismissed = false;
  var _stylesInjected = false;
  var _currentPage = '';
  var _currentParams = null;
  var _pollTimer = null;
  var _pollCount = 0;
  var _analysisDismissed = false;
  var _typewriterTimer = null;

  // ═══════════════════════════════════════════
  // Инъекция CSS-стилей (один раз)
  // ═══════════════════════════════════════════
  function injectStyles() {
    if (_stylesInjected) return;
    _stylesInjected = true;
    var style = document.createElement('style');
    style.id = 'asgard-hints-styles';
    style.textContent =
      '@keyframes hintSlideIn{' +
        'from{opacity:0;transform:translateX(-20px)}' +
        'to{opacity:1;transform:translateX(0)}' +
      '}' +
      '@keyframes hintGlow{' +
        '0%,100%{box-shadow:0 0 0 0 rgba(245,215,142,0)}' +
        '50%{box-shadow:0 0 0 4px rgba(245,215,142,0.12)}' +
      '}' +
      '@keyframes analysisReveal{' +
        'from{opacity:0;max-height:0;padding-top:0;padding-bottom:0}' +
        'to{opacity:1;max-height:300px;padding-top:14px;padding-bottom:14px}' +
      '}' +
      '@keyframes skeletonPulse{' +
        '0%{background-position:200% 0}' +
        '100%{background-position:-200% 0}' +
      '}' +
      // Яркий пульсирующий glow для тизера и иконки Мимира
      '@keyframes mimirOrbPulse{' +
        '0%{box-shadow:0 0 6px 2px rgba(212,168,67,0.3),0 0 12px 4px rgba(192,57,43,0.1)}' +
        '50%{box-shadow:0 0 14px 5px rgba(212,168,67,0.55),0 0 24px 8px rgba(192,57,43,0.2)}' +
        '100%{box-shadow:0 0 6px 2px rgba(212,168,67,0.3),0 0 12px 4px rgba(192,57,43,0.1)}' +
      '}' +
      '@keyframes teaserTextGlow{' +
        '0%,100%{text-shadow:0 0 4px rgba(212,168,67,0.1)}' +
        '50%{text-shadow:0 0 16px rgba(212,168,67,0.5),0 0 30px rgba(212,168,67,0.2)}' +
      '}' +
      // Golden shimmer sweep на раскрытом блоке
      '@keyframes shimmerSweep{' +
        '0%{left:-100%}' +
        '100%{left:200%}' +
      '}' +
      // Мигающий курсор typewriter
      '@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}' +

      '.mimir-hint-card{position:relative;transition:background .2s}' +
      '.mimir-hint-card:hover{background:rgba(255,255,255,0.03)}' +
      '.mimir-hint-card .mimir-hint-x{opacity:0;transition:opacity .2s}' +
      '.mimir-hint-card:hover .mimir-hint-x{opacity:1}' +
      '.mimir-hint-action{' +
        'background:rgba(192,57,43,0.1);' +
        'border:1px solid rgba(192,57,43,0.3);' +
        'color:#D4A843;' +
        'padding:4px 12px;' +
        'border-radius:6px;' +
        'font-size:11px;' +
        'font-weight:600;' +
        'cursor:pointer;' +
        'transition:all .2s;' +
        'white-space:nowrap' +
      '}' +
      '.mimir-hint-action:hover{' +
        'background:rgba(192,57,43,0.2);' +
        'border-color:rgba(192,57,43,0.5);' +
        'box-shadow:0 0 8px rgba(192,57,43,0.2)' +
      '}' +
      '.mimir-hint-link{' +
        'color:var(--blue-l);' +
        'font-size:11px;' +
        'text-decoration:none;' +
        'padding:4px 12px;' +
        'border-radius:6px;' +
        'border:1px solid rgba(74,144,217,0.3);' +
        'transition:all .2s;' +
        'white-space:nowrap;' +
        'cursor:pointer' +
      '}' +
      '.mimir-hint-link:hover{background:rgba(74,144,217,0.1)}' +
      '.mimir-dismiss-all{' +
        'background:none;border:1px solid rgba(255,255,255,0.1);' +
        'color:var(--t3);padding:3px 10px;border-radius:6px;' +
        'font-size:11px;cursor:pointer;transition:all .2s;white-space:nowrap' +
      '}' +
      '.mimir-dismiss-all:hover{border-color:rgba(255,255,255,0.2);color:var(--t2)}' +
      '.mimir-hint-x{' +
        'position:absolute;top:8px;right:8px;' +
        'background:none;border:none;color:var(--t3);' +
        'cursor:pointer;font-size:14px;padding:2px 4px;' +
        'border-radius:4px;transition:color .2s' +
      '}' +
      '.mimir-hint-x:hover{color:var(--t1)}' +
      '.mimir-hint-expanded{padding:16px 20px !important}' +
      '.mimir-hint-expanded .mimir-hint-subtitle{' +
        'font-size:12px;color:var(--t3);margin-top:4px;line-height:1.4' +
      '}' +

      // ── Mimir Orb (glow-кольцо вокруг иконки) ──
      '.mimir-orb{' +
        'width:32px;height:32px;border-radius:50%;' +
        'display:flex;align-items:center;justify-content:center;' +
        'font-size:18px;flex-shrink:0;' +
        'background:radial-gradient(circle,rgba(212,168,67,0.15) 0%,rgba(192,57,43,0.08) 70%,transparent 100%);' +
        'animation:mimirOrbPulse 2.5s ease infinite' +
      '}' +
      '.mimir-orb-sm{' +
        'width:28px;height:28px;border-radius:50%;' +
        'display:flex;align-items:center;justify-content:center;' +
        'font-size:15px;flex-shrink:0;' +
        'background:radial-gradient(circle,rgba(212,168,67,0.12) 0%,transparent 70%);' +
        'animation:mimirOrbPulse 3s ease infinite' +
      '}' +

      // ── AI Analysis: Teaser ──
      '.mimir-analysis-teaser{' +
        'display:flex;align-items:center;gap:12px;' +
        'padding:11px 16px;cursor:pointer;' +
        'border-bottom:1px solid rgba(245,215,142,0.1);' +
        'background:linear-gradient(90deg,rgba(212,168,67,0.03) 0%,rgba(42,59,102,0.04) 100%);' +
        'transition:background .3s,box-shadow .3s' +
      '}' +
      '.mimir-analysis-teaser:hover{' +
        'background:linear-gradient(90deg,rgba(212,168,67,0.08) 0%,rgba(42,59,102,0.06) 100%);' +
        'box-shadow:inset 0 0 30px rgba(212,168,67,0.04)' +
      '}' +
      '.mimir-analysis-teaser .mimir-a-text{' +
        'flex:1;font-size:12.5px;font-style:italic;' +
        'color:#D4A843;' +
        'animation:teaserTextGlow 3s ease infinite' +
      '}' +
      '.mimir-analysis-teaser .mimir-a-chevron{' +
        'font-size:12px;color:#D4A843;opacity:0.5;transition:transform .3s,opacity .3s' +
      '}' +
      '.mimir-analysis-teaser:hover .mimir-a-chevron{opacity:1;transform:translateY(2px)}' +

      // ── AI Analysis: Expanded ──
      '.mimir-analysis-expanded{' +
        'position:relative;padding:14px 16px;overflow:hidden;' +
        'background:linear-gradient(135deg,rgba(212,168,67,0.06) 0%,rgba(42,59,102,0.09) 100%);' +
        'border-bottom:1px solid rgba(245,215,142,0.12);' +
        'animation:analysisReveal .5s ease forwards' +
      '}' +
      // Shimmer sweep overlay
      '.mimir-analysis-expanded::after{' +
        'content:"";position:absolute;top:0;left:-100%;' +
        'width:60%;height:100%;' +
        'background:linear-gradient(90deg,transparent,rgba(212,168,67,0.08),rgba(245,215,142,0.12),rgba(212,168,67,0.08),transparent);' +
        'animation:shimmerSweep 1.5s ease .3s 1 forwards;' +
        'pointer-events:none' +
      '}' +
      '.mimir-analysis-expanded .mimir-a-header{' +
        'display:flex;align-items:center;gap:8px;margin-bottom:10px' +
      '}' +
      '.mimir-analysis-expanded .mimir-a-label{' +
        'font-size:10px;font-weight:700;text-transform:uppercase;' +
        'letter-spacing:1.2px;color:#D4A843;opacity:0.8' +
      '}' +
      '.mimir-analysis-expanded .mimir-a-close{' +
        'margin-left:auto;background:none;border:none;' +
        'color:var(--t3);cursor:pointer;font-size:14px;padding:2px 6px;' +
        'border-radius:4px;transition:color .2s' +
      '}' +
      '.mimir-analysis-expanded .mimir-a-close:hover{color:var(--t1)}' +
      '.mimir-analysis-expanded .mimir-a-body{' +
        'font-size:13px;line-height:1.65;color:var(--t1);' +
        'padding-left:36px' +
      '}' +
      // Мигающий курсор (typewriter)
      '.mimir-cursor{' +
        'display:inline-block;width:2px;height:14px;' +
        'background:#D4A843;margin-left:2px;vertical-align:text-bottom;' +
        'animation:blink .7s step-end infinite' +
      '}' +

      // ── Skeleton ──
      '.mimir-skeleton-wrap{' +
        'padding:14px 16px;' +
        'border-bottom:1px solid rgba(245,215,142,0.1);' +
        'display:flex;align-items:flex-start;gap:12px' +
      '}' +
      '.mimir-skeleton-lines{flex:1}' +
      '.mimir-skeleton-line{' +
        'height:12px;border-radius:6px;margin-bottom:8px;' +
        'background:linear-gradient(90deg,rgba(212,168,67,0.06) 25%,rgba(212,168,67,0.2) 50%,rgba(212,168,67,0.06) 75%);' +
        'background-size:200% 100%;' +
        'animation:skeletonPulse 1.6s ease infinite' +
      '}' +
      '.mimir-skeleton-label{' +
        'font-size:10px;font-weight:700;text-transform:uppercase;' +
        'letter-spacing:1px;color:#D4A843;opacity:0.5;margin-bottom:10px' +
      '}';
    document.head.appendChild(style);
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
      var hints = (data.hints || []).filter(function(h) { return !dismissed.has(h.id); });
      if (!hints.length) return;

      var analysis = data.analysis || null;
      render(hints, page, analysis);
    } catch (e) {
      // Подсказки не должны ломать страницу
    }
  }

  // ═══════════════════════════════════════════
  // TKP расширенные описания
  // ═══════════════════════════════════════════
  var TKP_EXTENDED = {
    'tenders_no_tkp': {
      subtitle: 'Мимир может создать черновики автоматически.',
      actions: [
        { label: '🧙 Создать ТКП через Мимир', type: 'create_tkp' },
        { label: 'Посмотреть тендеры \u2192', type: 'link', href: '#/tenders?filter=no_tkp' }
      ]
    },
    'tkp_stale': {
      subtitle: 'Клиенты молчат \u2014 может стоит напомнить?',
      actions: [
        { label: '🧙 Что посоветует Мимир?', type: 'details' }
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
  // Typewriter-эффект
  // ═══════════════════════════════════════════
  function stopTypewriter() {
    if (_typewriterTimer) { clearInterval(_typewriterTimer); _typewriterTimer = null; }
  }

  function typewriterText(bodyEl, fullText, onDone) {
    var chars = fullText.split('');
    var idx = 0;
    bodyEl.textContent = '';

    // Добавить мигающий курсор
    var cursor = document.createElement('span');
    cursor.className = 'mimir-cursor';
    bodyEl.appendChild(cursor);

    _typewriterTimer = setInterval(function() {
      if (idx >= chars.length) {
        clearInterval(_typewriterTimer);
        _typewriterTimer = null;
        // Убрать курсор через секунду
        setTimeout(function() {
          if (cursor.parentNode) cursor.remove();
        }, 1200);
        if (onDone) onDone();
        return;
      }
      // Вставляем текст перед курсором
      cursor.insertAdjacentText('beforebegin', chars[idx]);
      idx++;
    }, 25); // ~40 символов/сек — быстро но видно
  }

  // ═══════════════════════════════════════════
  // Поллинг AI-анализа
  // ═══════════════════════════════════════════
  function stopPolling() {
    if (_pollTimer) { clearTimeout(_pollTimer); _pollTimer = null; }
    _pollCount = 0;
  }

  function pollForAnalysis() {
    if (_pollCount >= 10) { hideSkeleton(); return; }
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
        if (!data || !data.analysis) return;
        if (data.analysis.status === 'ready' && data.analysis.text) {
          showAnalysisText(data.analysis.text, true);
          return;
        }
        _pollTimer = setTimeout(pollForAnalysis, 3000);
      })
      .catch(function() {
        _pollTimer = setTimeout(pollForAnalysis, 3000);
      });
  }

  function hideSkeleton() {
    var skeleton = document.getElementById('mimir-analysis-skeleton');
    if (skeleton) {
      skeleton.style.transition = 'opacity .4s';
      skeleton.style.opacity = '0';
      setTimeout(function() { skeleton.remove(); }, 400);
    }
    var teaser = document.getElementById('mimir-analysis-teaser');
    if (teaser) teaser.style.display = 'none';
  }

  function showAnalysisText(text, withTypewriter) {
    stopPolling();
    var skeleton = document.getElementById('mimir-analysis-skeleton');
    if (skeleton) skeleton.remove();

    var teaser = document.getElementById('mimir-analysis-teaser');
    if (teaser) teaser.remove();

    var bar = document.getElementById('asgard-hints-bar');
    if (!bar || _analysisDismissed) return;

    var existing = bar.querySelector('.mimir-analysis-expanded');
    if (existing) return;

    var wrap = buildExpandedBlock(text, withTypewriter);
    var cardsWrap = bar.querySelector('div[style*="padding:4px"]');
    if (cardsWrap) {
      bar.insertBefore(wrap, cardsWrap);
    } else {
      bar.appendChild(wrap);
    }
  }

  // ═══════════════════════════════════════════
  // Компоненты UI
  // ═══════════════════════════════════════════

  function buildMimirOrb(size) {
    var orb = document.createElement('div');
    orb.className = size === 'sm' ? 'mimir-orb-sm' : 'mimir-orb';
    orb.textContent = '🧙';
    return orb;
  }

  function buildExpandedBlock(text, withTypewriter) {
    var wrap = document.createElement('div');
    wrap.className = 'mimir-analysis-expanded';

    var headerRow = document.createElement('div');
    headerRow.className = 'mimir-a-header';

    var orb = buildMimirOrb('sm');

    var label = document.createElement('span');
    label.className = 'mimir-a-label';
    label.textContent = 'Мимир анализирует';

    var closeBtn = document.createElement('button');
    closeBtn.className = 'mimir-a-close';
    closeBtn.textContent = '\u00D7';
    closeBtn.title = 'Скрыть анализ';
    closeBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      _analysisDismissed = true;
      stopTypewriter();
      wrap.style.transition = 'opacity .3s,max-height .3s';
      wrap.style.opacity = '0';
      wrap.style.maxHeight = '0';
      setTimeout(function() { wrap.remove(); }, 350);
    });

    headerRow.appendChild(orb);
    headerRow.appendChild(label);
    headerRow.appendChild(closeBtn);

    var body = document.createElement('div');
    body.className = 'mimir-a-body';

    wrap.appendChild(headerRow);
    wrap.appendChild(body);

    if (withTypewriter) {
      // Запускаем typewriter после вставки в DOM (через rAF)
      requestAnimationFrame(function() {
        typewriterText(body, text);
      });
    } else {
      body.textContent = text;
    }

    return wrap;
  }

  function buildSkeleton() {
    var wrap = document.createElement('div');
    wrap.className = 'mimir-skeleton-wrap';
    wrap.id = 'mimir-analysis-skeleton';

    var orb = buildMimirOrb('sm');
    wrap.appendChild(orb);

    var right = document.createElement('div');
    right.className = 'mimir-skeleton-lines';

    var lbl = document.createElement('div');
    lbl.className = 'mimir-skeleton-label';
    lbl.textContent = 'Мимир думает\u2026';
    right.appendChild(lbl);

    var widths = ['85%', '70%', '50%'];
    for (var i = 0; i < widths.length; i++) {
      var line = document.createElement('div');
      line.className = 'mimir-skeleton-line';
      line.style.width = widths[i];
      line.style.animationDelay = (i * 200) + 'ms';
      if (i === widths.length - 1) line.style.marginBottom = '0';
      right.appendChild(line);
    }

    wrap.appendChild(right);
    return wrap;
  }

  function buildTeaser(teaserText) {
    var teaser = document.createElement('div');
    teaser.className = 'mimir-analysis-teaser';
    teaser.id = 'mimir-analysis-teaser';

    var orb = buildMimirOrb();

    var text = document.createElement('span');
    text.className = 'mimir-a-text';
    text.textContent = teaserText || 'Не хотите узнать немного больше?';

    var chevron = document.createElement('span');
    chevron.className = 'mimir-a-chevron';
    chevron.textContent = '\u25BE';

    teaser.appendChild(orb);
    teaser.appendChild(text);
    teaser.appendChild(chevron);
    return teaser;
  }

  // ═══════════════════════════════════════════
  // Рендер подсказок
  // ═══════════════════════════════════════════
  function render(hints, page, analysis) {
    injectStyles();

    var isTkp = (page === 'tkp');

    var bar = document.createElement('div');
    bar.id = 'asgard-hints-bar';
    bar.style.cssText =
      'background:var(--bg2);' +
      'border:1px solid rgba(192,57,43,0.2);' +
      'border-radius:12px;' +
      'overflow:hidden;' +
      'margin:16px 32px 0;' +
      'box-shadow:0 4px 20px rgba(0,0,0,0.3),0 0 0 1px rgba(245,215,142,0.05)';

    // ── Шапка ──
    var header = document.createElement('div');
    header.style.cssText =
      'background:linear-gradient(135deg,rgba(192,57,43,0.15) 0%,rgba(42,59,102,0.15) 100%);' +
      'padding:10px 16px;' +
      'display:flex;justify-content:space-between;align-items:center;' +
      'border-bottom:1px solid rgba(245,215,142,0.1)';

    var headerLeft = document.createElement('div');
    headerLeft.style.cssText = 'display:flex;align-items:center;gap:8px';

    var wizardIcon = document.createElement('span');
    wizardIcon.style.cssText = 'font-size:18px;filter:drop-shadow(0 2px 4px rgba(212,168,67,0.4))';
    wizardIcon.textContent = '🧙';

    var titleSpan = document.createElement('span');
    titleSpan.style.cssText = 'font-weight:700;font-size:13px;color:#D4A843';
    titleSpan.textContent = 'Мимир советует';

    var countSpan = document.createElement('span');
    countSpan.className = 'mimir-hints-count';
    countSpan.style.cssText = 'font-size:11px;color:var(--t3);margin-left:4px';
    countSpan.textContent = '(' + hints.length + ')';

    headerLeft.appendChild(wizardIcon);
    headerLeft.appendChild(titleSpan);
    headerLeft.appendChild(countSpan);

    var dismissAllBtn = document.createElement('button');
    dismissAllBtn.className = 'mimir-dismiss-all';
    dismissAllBtn.textContent = 'Скрыть все';

    header.appendChild(headerLeft);
    header.appendChild(dismissAllBtn);
    bar.appendChild(header);

    // ── AI-анализ (между шапкой и карточками) ──
    if (analysis && !_analysisDismissed) {
      if (analysis.status === 'ready' && analysis.text) {
        // Кеш — сразу раскрытый, без typewriter (уже видел)
        bar.appendChild(buildExpandedBlock(analysis.text, false));
      } else if (analysis.status === 'generating') {
        bar.appendChild(buildSkeleton());
        _pollTimer = setTimeout(pollForAnalysis, 3000);
      } else {
        // pending — тизер
        var teaser = buildTeaser(analysis.teaser);
        bar.appendChild(teaser);

        var hoverTimer = null;
        teaser.addEventListener('mouseenter', function() {
          hoverTimer = setTimeout(function() { revealFromTeaser(bar); }, 600);
        });
        teaser.addEventListener('mouseleave', function() {
          if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
        });
        teaser.addEventListener('click', function() {
          if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
          revealFromTeaser(bar);
        });
      }
    }

    // ── Карточки ──
    var cardsWrap = document.createElement('div');
    cardsWrap.style.cssText = 'padding:4px 0';

    hints.forEach(function(h, idx) {
      var cfg = TYPE_CONFIG[h.type] || TYPE_CONFIG.info;
      var isExpanded = isTkp && TKP_EXTENDED[h.id];
      var ext = isExpanded ? TKP_EXTENDED[h.id] : null;

      var card = document.createElement('div');
      card.className = 'mimir-hint-card' + (isExpanded ? ' mimir-hint-expanded' : '');
      card.dataset.hintId = h.id;

      var slideDelay = idx * 100;
      var animValue = 'hintSlideIn .4s ease ' + slideDelay + 'ms forwards';
      if (cfg.glow) {
        animValue += ',hintGlow 2s ease ' + (slideDelay + 500) + 'ms infinite';
      }

      card.style.cssText =
        'display:flex;align-items:flex-start;gap:12px;' +
        'padding:12px 16px;' +
        'border-bottom:1px solid rgba(255,255,255,0.04);' +
        'animation:' + animValue + ';' +
        'opacity:0';

      var iconWrap = document.createElement('div');
      iconWrap.style.cssText =
        'width:36px;height:36px;border-radius:50%;' +
        'display:flex;align-items:center;justify-content:center;' +
        'font-size:16px;flex-shrink:0;' +
        'background:' + cfg.bg;
      iconWrap.textContent = h.icon || '💡';

      var content = document.createElement('div');
      content.style.cssText = 'flex:1;min-width:0';

      var textEl = document.createElement('div');
      textEl.style.cssText = 'font-size:13px;line-height:1.5;color:var(--t1)';
      textEl.textContent = h.text;
      content.appendChild(textEl);

      if (ext && ext.subtitle) {
        var subEl = document.createElement('div');
        subEl.className = 'mimir-hint-subtitle';
        subEl.textContent = ext.subtitle;
        content.appendChild(subEl);
      }

      var actionsData = [];
      if (ext && ext.actions) {
        actionsData = ext.actions;
      } else {
        if (h.link) {
          actionsData.push({ label: 'Перейти \u2192', type: 'link', href: h.link });
        }
        if (h.actions && h.actions.indexOf('details') >= 0) {
          actionsData.push({ label: '🧙 Подробнее', type: 'details' });
        }
        if (h.actions && h.actions.indexOf('create_tkp') >= 0) {
          actionsData.push({ label: '🧙 Создать ТКП', type: 'create_tkp' });
        }
      }

      if (actionsData.length) {
        var actionsWrap = document.createElement('div');
        actionsWrap.style.cssText = 'margin-top:6px;display:flex;gap:8px;flex-wrap:wrap';

        actionsData.forEach(function(act) {
          var el;
          if (act.type === 'link') {
            el = document.createElement('a');
            el.className = 'mimir-hint-link';
            el.href = act.href;
          } else {
            el = document.createElement('button');
            el.className = 'mimir-hint-action';
            el.dataset.actionType = act.type;
            if (act.type === 'details') el.dataset.hintText = h.text;
          }
          el.textContent = act.label;
          actionsWrap.appendChild(el);
        });

        content.appendChild(actionsWrap);
      }

      var closeBtn = document.createElement('button');
      closeBtn.className = 'mimir-hint-x';
      closeBtn.dataset.hintId = h.id;
      closeBtn.textContent = '\u00D7';
      closeBtn.title = 'Скрыть';

      card.appendChild(iconWrap);
      card.appendChild(content);
      card.appendChild(closeBtn);
      cardsWrap.appendChild(card);
    });

    bar.appendChild(cardsWrap);

    // ── Вставка в DOM ──
    var main = document.querySelector('main.main');
    var layoutDiv = document.getElementById('layout');
    if (main && layoutDiv) {
      main.insertBefore(bar, layoutDiv);
    }
    currentBar = bar;

    // ═══════════════════════════════════════════
    // Обработчики
    // ═══════════════════════════════════════════

    dismissAllBtn.addEventListener('click', function() {
      allDismissed = true;
      stopPolling();
      stopTypewriter();
      bar.style.transition = 'opacity .3s,transform .3s';
      bar.style.opacity = '0';
      bar.style.transform = 'translateY(-10px)';
      setTimeout(function() { bar.remove(); currentBar = null; }, 300);
    });

    cardsWrap.addEventListener('click', function(e) {
      var target = e.target;

      if (target.closest('.mimir-hint-x')) {
        var xBtn = target.closest('.mimir-hint-x');
        dismissed.add(xBtn.dataset.hintId);
        var card = xBtn.closest('.mimir-hint-card');
        if (!card) return;
        card.style.transition = 'opacity .25s,transform .25s';
        card.style.opacity = '0';
        card.style.transform = 'translateX(-20px)';
        setTimeout(function() {
          card.remove();
          var remaining = bar.querySelectorAll('.mimir-hint-card');
          if (!remaining.length) {
            stopPolling();
            stopTypewriter();
            bar.style.transition = 'opacity .3s';
            bar.style.opacity = '0';
            setTimeout(function() { bar.remove(); currentBar = null; }, 300);
          } else {
            var cEl = bar.querySelector('.mimir-hints-count');
            if (cEl) cEl.textContent = '(' + remaining.length + ')';
          }
        }, 250);
        return;
      }

      var actionBtn = target.closest('[data-action-type]');
      if (!actionBtn) return;

      var actionType = actionBtn.dataset.actionType;
      if (actionType === 'details') {
        openMimirWith('Расскажи подробнее: ' + (actionBtn.dataset.hintText || ''));
      } else if (actionType === 'create_tkp') {
        openMimirWith('Создай ТКП по ближайшему просчитанному тендеру');
      }
    });
  }

  function revealFromTeaser(bar) {
    var teaser = document.getElementById('mimir-analysis-teaser');
    if (!teaser) return;

    teaser.remove();
    var skeleton = buildSkeleton();
    var cardsWrap = bar.querySelector('div[style*="padding:4px"]');
    if (cardsWrap) {
      bar.insertBefore(skeleton, cardsWrap);
    } else {
      bar.appendChild(skeleton);
    }

    _pollTimer = setTimeout(pollForAnalysis, 500);
  }

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
  // Удаление подсказок
  // ═══════════════════════════════════════════
  function remove() {
    stopPolling();
    stopTypewriter();
    if (currentBar) { currentBar.remove(); currentBar = null; }
    var old = document.getElementById('asgard-hints-bar');
    if (old) old.remove();
  }

  return { load: load, remove: remove };
})();
