// ASGARD CRM — Умные подсказки Мимира (AsgardHints)
// Визуальные контекстные подсказки + AI-анализ (Level 4)
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
        'to{opacity:1;max-height:200px;padding-top:12px;padding-bottom:12px}' +
      '}' +
      '@keyframes skeletonPulse{' +
        '0%{background-position:200% 0}' +
        '100%{background-position:-200% 0}' +
      '}' +
      '@keyframes teaserGlow{' +
        '0%,100%{text-shadow:0 0 0 rgba(212,168,67,0)}' +
        '50%{text-shadow:0 0 8px rgba(212,168,67,0.3)}' +
      '}' +
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
      // AI Analysis styles
      '.mimir-analysis-teaser{' +
        'display:flex;align-items:center;gap:10px;' +
        'padding:10px 16px;cursor:pointer;' +
        'border-bottom:1px solid rgba(245,215,142,0.08);' +
        'transition:background .2s' +
      '}' +
      '.mimir-analysis-teaser:hover{background:rgba(212,168,67,0.06)}' +
      '.mimir-analysis-teaser .mimir-a-icon{' +
        'font-size:20px;flex-shrink:0;' +
        'filter:drop-shadow(0 0 6px rgba(212,168,67,0.5));' +
        'animation:teaserGlow 2.5s ease infinite' +
      '}' +
      '.mimir-analysis-teaser .mimir-a-text{' +
        'flex:1;font-size:12px;font-style:italic;' +
        'color:#D4A843;opacity:0.85' +
      '}' +
      '.mimir-analysis-teaser .mimir-a-chevron{' +
        'font-size:11px;color:var(--t3);transition:transform .3s' +
      '}' +
      '.mimir-analysis-expanded{' +
        'padding:12px 16px;overflow:hidden;' +
        'background:linear-gradient(135deg,rgba(212,168,67,0.05) 0%,rgba(42,59,102,0.08) 100%);' +
        'border-bottom:1px solid rgba(245,215,142,0.1);' +
        'animation:analysisReveal .4s ease forwards' +
      '}' +
      '.mimir-analysis-expanded .mimir-a-header{' +
        'display:flex;align-items:center;gap:8px;margin-bottom:8px' +
      '}' +
      '.mimir-analysis-expanded .mimir-a-label{' +
        'font-size:10px;font-weight:700;text-transform:uppercase;' +
        'letter-spacing:1px;color:#D4A843;opacity:0.7' +
      '}' +
      '.mimir-analysis-expanded .mimir-a-close{' +
        'margin-left:auto;background:none;border:none;' +
        'color:var(--t3);cursor:pointer;font-size:13px;padding:2px 6px;' +
        'border-radius:4px;transition:color .2s' +
      '}' +
      '.mimir-analysis-expanded .mimir-a-close:hover{color:var(--t1)}' +
      '.mimir-analysis-expanded .mimir-a-body{' +
        'font-size:13px;line-height:1.6;color:var(--t1)' +
      '}' +
      // Skeleton
      '.mimir-skeleton-wrap{padding:12px 16px;border-bottom:1px solid rgba(245,215,142,0.08)}' +
      '.mimir-skeleton-line{' +
        'height:12px;border-radius:6px;margin-bottom:8px;' +
        'background:linear-gradient(90deg,rgba(212,168,67,0.08) 25%,rgba(212,168,67,0.18) 50%,rgba(212,168,67,0.08) 75%);' +
        'background-size:200% 100%;' +
        'animation:skeletonPulse 1.8s ease infinite' +
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
          showAnalysisText(data.analysis.text);
          return;
        }
        // Ещё генерируется — повтор через 3с
        _pollTimer = setTimeout(pollForAnalysis, 3000);
      })
      .catch(function() {
        _pollTimer = setTimeout(pollForAnalysis, 3000);
      });
  }

  function hideSkeleton() {
    var skeleton = document.getElementById('mimir-analysis-skeleton');
    if (skeleton) skeleton.remove();
    // Показать тизер как fallback
    var teaser = document.getElementById('mimir-analysis-teaser');
    if (teaser) teaser.style.display = 'none';
  }

  function showAnalysisText(text) {
    stopPolling();
    // Убрать skeleton
    var skeleton = document.getElementById('mimir-analysis-skeleton');
    if (skeleton) skeleton.remove();

    // Убрать тизер
    var teaser = document.getElementById('mimir-analysis-teaser');
    if (teaser) teaser.remove();

    // Вставить раскрытый блок
    var bar = document.getElementById('asgard-hints-bar');
    if (!bar || _analysisDismissed) return;

    var header = bar.querySelector('.mimir-analysis-expanded');
    if (header) return; // уже показан

    var wrap = buildExpandedBlock(text);
    var cardsWrap = bar.querySelector('div[style*="padding:4px"]');
    if (cardsWrap) {
      bar.insertBefore(wrap, cardsWrap);
    } else {
      bar.appendChild(wrap);
    }
  }

  function buildExpandedBlock(text) {
    var wrap = document.createElement('div');
    wrap.className = 'mimir-analysis-expanded';

    var headerRow = document.createElement('div');
    headerRow.className = 'mimir-a-header';

    var icon = document.createElement('span');
    icon.style.cssText = 'font-size:16px;filter:drop-shadow(0 0 4px rgba(212,168,67,0.5))';
    icon.textContent = '🧙';

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
      wrap.style.transition = 'opacity .3s,max-height .3s';
      wrap.style.opacity = '0';
      wrap.style.maxHeight = '0';
      setTimeout(function() { wrap.remove(); }, 300);
    });

    headerRow.appendChild(icon);
    headerRow.appendChild(label);
    headerRow.appendChild(closeBtn);

    var body = document.createElement('div');
    body.className = 'mimir-a-body';
    body.textContent = text;

    wrap.appendChild(headerRow);
    wrap.appendChild(body);
    return wrap;
  }

  function buildSkeleton() {
    var wrap = document.createElement('div');
    wrap.className = 'mimir-skeleton-wrap';
    wrap.id = 'mimir-analysis-skeleton';

    var widths = ['85%', '70%', '55%'];
    for (var i = 0; i < widths.length; i++) {
      var line = document.createElement('div');
      line.className = 'mimir-skeleton-line';
      line.style.width = widths[i];
      if (i === widths.length - 1) line.style.marginBottom = '0';
      wrap.appendChild(line);
    }
    return wrap;
  }

  function buildTeaser(teaserText) {
    var teaser = document.createElement('div');
    teaser.className = 'mimir-analysis-teaser';
    teaser.id = 'mimir-analysis-teaser';

    var icon = document.createElement('span');
    icon.className = 'mimir-a-icon';
    icon.textContent = '🧙';

    var text = document.createElement('span');
    text.className = 'mimir-a-text';
    text.textContent = teaserText || 'Не хотите узнать немного больше?';

    var chevron = document.createElement('span');
    chevron.className = 'mimir-a-chevron';
    chevron.textContent = '\u25BE';

    teaser.appendChild(icon);
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
        // Анализ готов — сразу раскрытый блок
        bar.appendChild(buildExpandedBlock(analysis.text));
      } else if (analysis.status === 'generating') {
        // AI думает — skeleton + поллинг
        bar.appendChild(buildSkeleton());
        _pollTimer = setTimeout(pollForAnalysis, 3000);
      } else {
        // pending — тизер, при клике запустит поллинг
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

      // Раздельные animation-delay для slide и glow
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

      // Круглая иконка
      var iconWrap = document.createElement('div');
      iconWrap.style.cssText =
        'width:36px;height:36px;border-radius:50%;' +
        'display:flex;align-items:center;justify-content:center;' +
        'font-size:16px;flex-shrink:0;' +
        'background:' + cfg.bg;
      iconWrap.textContent = h.icon || '💡';

      // Контент: текст + кнопки
      var content = document.createElement('div');
      content.style.cssText = 'flex:1;min-width:0';

      var textEl = document.createElement('div');
      textEl.style.cssText = 'font-size:13px;line-height:1.5;color:var(--t1)';
      textEl.textContent = h.text;
      content.appendChild(textEl);

      // Подзаголовок (для расширенных TKP-карточек)
      if (ext && ext.subtitle) {
        var subEl = document.createElement('div');
        subEl.className = 'mimir-hint-subtitle';
        subEl.textContent = ext.subtitle;
        content.appendChild(subEl);
      }

      // Кнопки действий
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

      // Кнопка × (показывается на hover)
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

    // ── Вставка в DOM: между topbar и #layout (вне контента страницы) ──
    var main = document.querySelector('main.main');
    var layoutDiv = document.getElementById('layout');
    if (main && layoutDiv) {
      main.insertBefore(bar, layoutDiv);
    }
    currentBar = bar;

    // ═══════════════════════════════════════════
    // Обработчики (делегирование на контейнер)
    // ═══════════════════════════════════════════

    dismissAllBtn.addEventListener('click', function() {
      allDismissed = true;
      stopPolling();
      bar.style.transition = 'opacity .3s,transform .3s';
      bar.style.opacity = '0';
      bar.style.transform = 'translateY(-10px)';
      setTimeout(function() { bar.remove(); currentBar = null; }, 300);
    });

    // Единый обработчик на весь блок карточек
    cardsWrap.addEventListener('click', function(e) {
      var target = e.target;

      // × закрыть подсказку
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

      // Кнопки действий
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

  // Раскрыть анализ из тизера (hover 600ms или click)
  function revealFromTeaser(bar) {
    var teaser = document.getElementById('mimir-analysis-teaser');
    if (!teaser) return;

    // Заменить тизер на skeleton
    teaser.remove();
    var skeleton = buildSkeleton();
    var cardsWrap = bar.querySelector('div[style*="padding:4px"]');
    if (cardsWrap) {
      bar.insertBefore(skeleton, cardsWrap);
    } else {
      bar.appendChild(skeleton);
    }

    // Запустить поллинг
    _pollTimer = setTimeout(pollForAnalysis, 500);
  }

  // Открыть Мимир с вопросом
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
    if (currentBar) { currentBar.remove(); currentBar = null; }
    var old = document.getElementById('asgard-hints-bar');
    if (old) old.remove();
  }

  return { load: load, remove: remove };
})();
