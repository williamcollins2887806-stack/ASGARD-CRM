/**
 * ASGARD CRM — Theme Selector
 * Первый выбор темы при открытии приложения
 * Показывается один раз, результат сохраняется в localStorage
 */
(function() {
  'use strict';

  var CHOSEN_KEY = 'asgard_theme_chosen';
  var _selected = null;

  function hasChosen() {
    try { return !!localStorage.getItem(CHOSEN_KEY); }
    catch(e) { return true; }
  }

  function markChosen() {
    try { localStorage.setItem(CHOSEN_KEY, '1'); }
    catch(e) {}
  }

  function pick(el, theme) {
    _selected = theme;
    var cards = document.querySelectorAll('.ats-theme-card');
    for (var i = 0; i < cards.length; i++) {
      cards[i].classList.remove('ats-selected');
    }
    el.classList.add('ats-selected');
    var btn = document.getElementById('atsContinue');
    if (btn) btn.removeAttribute('disabled');
    if (window.AsgardTheme) window.AsgardTheme.apply(theme);
  }

  function confirm() {
    if (!_selected) return;
    markChosen();
    var overlay = document.getElementById('asgard-theme-selector');
    if (!overlay) return;
    overlay.classList.remove('ats-visible');
    setTimeout(function() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }, 450);
  }

  function createBanner() {
    var el = document.createElement('div');
    el.id = 'asgard-theme-selector';
    el.innerHTML = [
      '<div class="ats-card">',
        '<div class="ats-rune-bar">ᚠ ᚢ ᚦ ᚨ ᚱ ᚲ</div>',
        '<h2 class="ats-title">ВЫБЕРИТЕ ВАШ АСГАРД</h2>',
        '<p class="ats-sub">Тему можно изменить в любой момент в настройках</p>',

        '<div class="ats-themes">',

          /* — DARK — */
          '<div class="ats-theme-card" data-theme="dark" onclick="AsgardThemeSelector._pick(this,\'dark\')">',
            '<div class="ats-preview ats-preview--dark">',
              '<div class="ats-prev-topbar">',
                '<div class="ats-prev-logo"></div>',
                '<div style="flex:1"></div>',
                '<div class="ats-prev-dot" style="background:#C8293B"></div>',
                '<div class="ats-prev-dot" style="background:#D4A843"></div>',
              '</div>',
              '<div class="ats-prev-body">',
                '<div class="ats-prev-sidebar">',
                  '<div class="ats-prev-item ats-prev-item--active"></div>',
                  '<div class="ats-prev-item"></div>',
                  '<div class="ats-prev-item"></div>',
                  '<div class="ats-prev-item"></div>',
                '</div>',
                '<div class="ats-prev-content">',
                  '<div class="ats-prev-row">',
                    '<div class="ats-prev-kpi" style="border-top:2px solid #C8293B"></div>',
                    '<div class="ats-prev-kpi" style="border-top:2px solid #D4A843"></div>',
                    '<div class="ats-prev-kpi" style="border-top:2px solid #1E4D8C"></div>',
                  '</div>',
                  '<div class="ats-prev-card-dark"></div>',
                  '<div class="ats-prev-card-dark" style="height:24px"></div>',
                '</div>',
              '</div>',
            '</div>',
            '<div class="ats-theme-check">✓</div>',
            '<div class="ats-theme-info">',
              '<div class="ats-theme-name">Тёмная</div>',
              '<div class="ats-theme-desc">Строгость и сила. Для вечернего контроля.</div>',
            '</div>',
          '</div>',

          /* — LIGHT — */
          '<div class="ats-theme-card" data-theme="light" onclick="AsgardThemeSelector._pick(this,\'light\')">',
            '<div class="ats-preview ats-preview--light">',
              '<div class="ats-prev-topbar ats-prev-topbar--light">',
                '<div class="ats-prev-logo ats-prev-logo--light"></div>',
                '<div style="flex:1"></div>',
                '<div class="ats-prev-dot" style="background:#A82030"></div>',
                '<div class="ats-prev-dot" style="background:#B8841A"></div>',
              '</div>',
              '<div class="ats-prev-body">',
                '<div class="ats-prev-sidebar ats-prev-sidebar--light">',
                  '<div class="ats-prev-item ats-prev-item--active-light"></div>',
                  '<div class="ats-prev-item ats-prev-item--light"></div>',
                  '<div class="ats-prev-item ats-prev-item--light"></div>',
                  '<div class="ats-prev-item ats-prev-item--light"></div>',
                '</div>',
                '<div class="ats-prev-content ats-prev-content--light">',
                  '<div class="ats-prev-row">',
                    '<div class="ats-prev-kpi ats-prev-kpi--light" style="border-left:2px solid #A82030"></div>',
                    '<div class="ats-prev-kpi ats-prev-kpi--light" style="border-left:2px solid #B8841A"></div>',
                    '<div class="ats-prev-kpi ats-prev-kpi--light" style="border-left:2px solid #1A3F74"></div>',
                  '</div>',
                  '<div class="ats-prev-card-light"></div>',
                  '<div class="ats-prev-card-light" style="height:24px"></div>',
                '</div>',
              '</div>',
            '</div>',
            '<div class="ats-theme-check">✓</div>',
            '<div class="ats-theme-info">',
              '<div class="ats-theme-name">Светлая</div>',
              '<div class="ats-theme-desc">Пергамент и золото. Для дневной работы.</div>',
            '</div>',
          '</div>',

        '</div>',

        '<button class="ats-btn" id="atsContinue" disabled onclick="AsgardThemeSelector._confirm()">',
          'Продолжить →',
        '</button>',

        '<p class="ats-hint">Нажмите на тему для предпросмотра</p>',
      '</div>'
    ].join('');
    return el;
  }

  function show() {
    if (hasChosen()) return;
    if (document.getElementById('asgard-theme-selector')) return;
    var banner = createBanner();
    document.body.appendChild(banner);
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        banner.classList.add('ats-visible');
      });
    });
  }

  function watchForWelcome() {
    if (hasChosen()) return;
    var app = document.getElementById('app') || document.body;
    if (document.querySelector('.welcome-page')) {
      setTimeout(show, 700);
      return;
    }
    var observer = new MutationObserver(function() {
      if (document.querySelector('.welcome-page') && !hasChosen()) {
        observer.disconnect();
        setTimeout(show, 700);
      }
    });
    observer.observe(app, { childList: true, subtree: true });
  }

  window.AsgardThemeSelector = {
    show:      show,
    _pick:     pick,
    _confirm:  confirm,
    hasChosen: hasChosen,
    reset: function() {
      try { localStorage.removeItem(CHOSEN_KEY); } catch(e) {}
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watchForWelcome);
  } else {
    watchForWelcome();
  }
})();
