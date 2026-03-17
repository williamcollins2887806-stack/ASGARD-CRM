// ASGARD CRM — Умные подсказки (AsgardHints)
// Ненавязчивая полоска с контекстными подсказками
// Только десктоп. AI не используется (только SQL).
window.AsgardHints = (function() {
  'use strict';
  const { $, esc, toast } = AsgardUI;

  function isMobile() {
    return !!document.getElementById('asgard-shell') || window.innerWidth <= 768;
  }

  const TYPE_STYLES = {
    error:   { bg: 'rgba(220,38,38,0.08)', border: 'var(--err-t)',  color: 'var(--err-t)' },
    warning: { bg: 'rgba(245,158,11,0.08)', border: 'var(--amber)',  color: 'var(--amber)' },
    info:    { bg: 'rgba(59,130,246,0.06)', border: 'var(--blue-l)', color: 'var(--blue-l)' },
    metric:  { bg: 'rgba(16,185,129,0.06)', border: 'var(--ok)',     color: 'var(--ok)' }
  };

  let currentBar = null;
  const dismissed = new Set();

  async function load(page, params) {
    if (isMobile()) return;
    if (!page) return;

    // Маппинг: URL #/employee?id=123 → employee_id для API
    if (page === 'employee' && params && params.id && !params.employee_id) {
      params.employee_id = params.id;
    }

    remove();

    try {
      const token = localStorage.getItem('asgard_token');
      if (!token) return;

      let url = '/api/hints?page=' + encodeURIComponent(page);
      if (params && params.employee_id) {
        url += '&employee_id=' + encodeURIComponent(params.employee_id);
      }

      const resp = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
      if (!resp.ok) return;
      const data = await resp.json();
      const hints = (data.hints || []).filter(function(h) { return !dismissed.has(h.id); });
      if (!hints.length) return;

      render(hints);
    } catch (e) {
      // Подсказки не должны ломать страницу — молча
    }
  }

  function render(hints) {
    var bar = document.createElement('div');
    bar.id = 'asgard-hints-bar';
    bar.style.cssText = 'margin:0 0 12px 0;display:flex;flex-direction:column;gap:6px;';

    hints.forEach(function(h) {
      var style = TYPE_STYLES[h.type] || TYPE_STYLES.info;
      var item = document.createElement('div');
      item.className = 'hint-item';
      item.style.cssText =
        'display:flex;align-items:center;gap:10px;padding:8px 14px;' +
        'background:' + style.bg + ';border-left:3px solid ' + style.border + ';' +
        'border-radius:6px;font-size:13px;color:var(--t1);';

      var html = '<span style="font-size:16px;flex-shrink:0">' + (h.icon || '💡') + '</span>';
      html += '<span style="flex:1">' + esc(h.text) + '</span>';

      if (h.link) {
        html += '<a href="' + esc(h.link) + '" style="color:' + style.color +
          ';font-size:12px;white-space:nowrap;text-decoration:none">Перейти →</a>';
      }

      if (h.actions && h.actions.indexOf('details') >= 0) {
        html += '<button class="hint-detail-btn" data-text="' + esc(h.text) + '"' +
          ' style="background:none;border:1px solid ' + style.border + ';color:' + style.color +
          ';padding:2px 8px;border-radius:4px;font-size:11px;cursor:pointer;white-space:nowrap">' +
          '🧙 Подробнее</button>';
      }

      if (h.actions && h.actions.indexOf('create_tkp') >= 0) {
        html += '<button class="hint-tkp-btn"' +
          ' style="background:none;border:1px solid var(--blue-l);color:var(--blue-l);' +
          'padding:2px 8px;border-radius:4px;font-size:11px;cursor:pointer;white-space:nowrap">' +
          '🧙 Создать ТКП</button>';
      }

      html += '<button class="hint-close" data-id="' + esc(h.id) + '"' +
        ' style="background:none;border:none;color:var(--t3);cursor:pointer;font-size:14px;padding:0 2px"' +
        ' title="Скрыть">×</button>';

      item.innerHTML = html;
      bar.appendChild(item);
    });

    // Вставить в начало контента
    var target = document.querySelector('[id$="-page"]') ||
                   document.querySelector('#app-content') ||
                   document.querySelector('.page-content') ||
                   document.querySelector('.panel');
    if (target) {
      var header = target.querySelector('h2, h3, [style*="justify-content:space-between"]');
      if (header && header.nextSibling) {
        header.parentNode.insertBefore(bar, header.nextSibling);
      } else {
        target.prepend(bar);
      }
    }
    currentBar = bar;

    // ── Обработчики ──
    bar.querySelectorAll('.hint-close').forEach(function(btn) {
      btn.addEventListener('click', function() {
        dismissed.add(btn.dataset.id);
        btn.closest('.hint-item').remove();
        if (!bar.querySelector('.hint-item')) bar.remove();
      });
    });

    bar.querySelectorAll('.hint-detail-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        if (window.AsgardMimir && AsgardMimir.open) {
          AsgardMimir.open();
          setTimeout(function() {
            var input = document.querySelector('#mimirInput, .mimir-input');
            if (input) {
              input.value = 'Расскажи подробнее: ' + btn.dataset.text;
              input.dispatchEvent(new Event('input'));
              var sendBtn = document.querySelector('.mimir-send-btn, #mimirSend');
              if (sendBtn) sendBtn.click();
            }
          }, 500);
        }
      });
    });

    bar.querySelectorAll('.hint-tkp-btn').forEach(function(btn) {
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

  function remove() {
    if (currentBar) { currentBar.remove(); currentBar = null; }
    var old = document.getElementById('asgard-hints-bar');
    if (old) old.remove();
  }

  return { load: load, remove: remove };
})();
