// ASGARD CRM — Умные подсказки Мимира (AsgardHints)
// Визуальные контекстные подсказки в стиле Мимира
// Только десктоп. AI не используется (только SQL).
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

      render(hints, page);
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
  // Рендер подсказок
  // ═══════════════════════════════════════════
  function render(hints, page) {
    injectStyles();

    var isTkp = (page === 'tkp');

    var bar = document.createElement('div');
    bar.id = 'asgard-hints-bar';
    bar.style.cssText =
      'background:var(--bg2);' +
      'border:1px solid rgba(192,57,43,0.2);' +
      'border-radius:12px;' +
      'overflow:hidden;' +
      'margin-bottom:16px;' +
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
    headerLeft.innerHTML =
      '<span style="font-size:18px;filter:drop-shadow(0 2px 4px rgba(212,168,67,0.4))">🧙</span>' +
      '<span style="font-weight:700;font-size:13px;color:#D4A843">Мимир советует</span>' +
      '<span style="font-size:11px;color:var(--t3);margin-left:4px">(' + hints.length + ')</span>';

    var dismissAllBtn = document.createElement('button');
    dismissAllBtn.className = 'mimir-dismiss-all';
    dismissAllBtn.textContent = 'Скрыть все';

    header.appendChild(headerLeft);
    header.appendChild(dismissAllBtn);
    bar.appendChild(header);

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
      card.style.cssText =
        'display:flex;align-items:flex-start;gap:12px;' +
        'padding:12px 16px;' +
        'border-bottom:1px solid rgba(255,255,255,0.04);' +
        'animation:hintSlideIn .4s ease forwards' +
        (cfg.glow ? ',hintGlow 2s ease infinite .5s' : '') + ';' +
        'animation-delay:' + (idx * 100) + 'ms;' +
        'opacity:0';

      // Круглая иконка
      var iconWrap = document.createElement('div');
      iconWrap.style.cssText =
        'width:36px;height:36px;border-radius:50%;' +
        'display:flex;align-items:center;justify-content:center;' +
        'font-size:16px;flex-shrink:0;' +
        'background:' + cfg.bg;
      iconWrap.textContent = h.icon || '\uD83D\uDCA1';

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
          if (act.type === 'link') {
            var a = document.createElement('a');
            a.className = 'mimir-hint-link';
            a.href = act.href;
            a.textContent = act.label;
            actionsWrap.appendChild(a);
          } else if (act.type === 'details') {
            var btn = document.createElement('button');
            btn.className = 'mimir-hint-action';
            btn.dataset.hintText = h.text;
            btn.dataset.actionType = 'details';
            btn.textContent = act.label;
            actionsWrap.appendChild(btn);
          } else if (act.type === 'create_tkp') {
            var btn2 = document.createElement('button');
            btn2.className = 'mimir-hint-action';
            btn2.dataset.actionType = 'create_tkp';
            btn2.textContent = act.label;
            actionsWrap.appendChild(btn2);
          }
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

    // ── Вставка в DOM ──
    var target = document.querySelector('[id$="-page"]') ||
                 document.querySelector('#app-content') ||
                 document.querySelector('.page-content') ||
                 document.querySelector('.panel');
    if (target) {
      var h2 = target.querySelector('h2, h3, [style*="justify-content:space-between"]');
      if (h2 && h2.nextSibling) {
        h2.parentNode.insertBefore(bar, h2.nextSibling);
      } else {
        target.prepend(bar);
      }
    }
    currentBar = bar;

    // ═══════════════════════════════════════════
    // Обработчики
    // ═══════════════════════════════════════════

    // Скрыть все
    dismissAllBtn.addEventListener('click', function() {
      allDismissed = true;
      bar.style.transition = 'opacity .3s,transform .3s';
      bar.style.opacity = '0';
      bar.style.transform = 'translateY(-10px)';
      setTimeout(function() { bar.remove(); currentBar = null; }, 300);
    });

    // Скрыть одну подсказку
    bar.querySelectorAll('.mimir-hint-x').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var hintId = btn.dataset.hintId;
        dismissed.add(hintId);
        var card = btn.closest('.mimir-hint-card');
        if (card) {
          card.style.transition = 'opacity .25s,transform .25s';
          card.style.opacity = '0';
          card.style.transform = 'translateX(-20px)';
          setTimeout(function() {
            card.remove();
            // Обновить счётчик
            var remaining = bar.querySelectorAll('.mimir-hint-card');
            if (!remaining.length) {
              bar.style.transition = 'opacity .3s';
              bar.style.opacity = '0';
              setTimeout(function() { bar.remove(); currentBar = null; }, 300);
            } else {
              var countEl = bar.querySelector('span[style*="margin-left:4px"]');
              if (countEl) countEl.textContent = '(' + remaining.length + ')';
            }
          }, 250);
        }
      });
    });

    // Кнопка "Подробнее" → открыть Мимир
    bar.querySelectorAll('[data-action-type="details"]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        if (window.AsgardMimir && AsgardMimir.open) {
          AsgardMimir.open();
          setTimeout(function() {
            var input = document.querySelector('#mimirInput, .mimir-input');
            if (input) {
              input.value = 'Расскажи подробнее: ' + (btn.dataset.hintText || '');
              input.dispatchEvent(new Event('input'));
              var sendBtn = document.querySelector('.mimir-send-btn, #mimirSend');
              if (sendBtn) sendBtn.click();
            }
          }, 500);
        }
      });
    });

    // Кнопка "Создать ТКП" → открыть Мимир
    bar.querySelectorAll('[data-action-type="create_tkp"]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        if (window.AsgardMimir && AsgardMimir.open) {
          AsgardMimir.open();
          setTimeout(function() {
            var input = document.querySelector('#mimirInput, .mimir-input');
            if (input) {
              input.value = 'Создай ТКП по ближайшему просчитанному тендеру';
              input.dispatchEvent(new Event('input'));
              var sendBtn = document.querySelector('.mimir-send-btn, #mimirSend');
              if (sendBtn) sendBtn.click();
            }
          }, 500);
        }
      });
    });
  }

  // ═══════════════════════════════════════════
  // Удаление подсказок
  // ═══════════════════════════════════════════
  function remove() {
    if (currentBar) { currentBar.remove(); currentBar = null; }
    var old = document.getElementById('asgard-hints-bar');
    if (old) old.remove();
  }

  return { load: load, remove: remove };
})();
