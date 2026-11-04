/* ═══════════════════════════════════════════════════════════════════════════
   БАННЕР ПРИВЯЗКИ ФИО ИЗ СКУД (V453)

   Зачем. В отчёте СКУД человек записан строкой «Морозов Иван Михайлович»,
   в CRM аккаунт может называться «Морозов Иван», а часть людей нам вообще
   не принадлежит («Аурелия Уборка»). Автоматически угадывать нельзя: ошибка
   привязки запишет часы не тому человеку.

   Поэтому офис-менеджер при входе видит баннер: «такое-то ФИО без привязки»,
   выбирает сотрудника одним кликом (или «в CRM нет — пропускать всегда»),
   и часы сразу пересчитываются за все периоды.

   Баннер неблокирующий (в отличие от недельного гейта): его можно закрыть,
   но он вернётся при следующем входе, пока не разобрано.

   window.AsgardSkudBanner.mount({ auth, onMapped })
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* Роли, которые видят баннер: офис-менеджер и директора. */
  var ROLES = { OFFICE_MANAGER: 1, ADMIN: 1, DIRECTOR_GEN: 1, DIRECTOR_COMM: 1, DIRECTOR_DEV: 1 };

  var _mounted = false;
  var _el = null;
  var _collapsed = true;
  var _outsideBound = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function token() {
    try { return localStorage.getItem('asgard_token') || ''; } catch (_) { return ''; }
  }

  function hdr() {
    return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token() };
  }

  async function apiGet(path) {
    try {
      var r = await fetch(path, { headers: hdr() });
      if (!r.ok) return null;
      return await r.json();
    } catch (_) { return null; }
  }

  async function apiPost(path, body) {
    var r = await fetch(path, { method: 'POST', headers: hdr(), body: JSON.stringify(body) });
    var j = null;
    try { j = await r.json(); } catch (_) {}
    if (!r.ok) {
      var e = new Error((j && (j.message || j.error)) || ('HTTP ' + r.status));
      e.code = (j && j.error) || 'http_' + r.status;
      throw e;
    }
    return j;
  }

  /* «Морозов Иван (TO)» + уверенность в процентах, когда это догадка. */
  function optLabel(c) {
    var role = c.role ? ' (' + c.role + ')' : '';
    return esc(c.name) + role;
  }

  function confidenceLabel(v) {
    var pct = Math.round((Number(v) || 0) * 100);
    if (pct >= 100) return 'точное совпадение';
    if (pct >= 80) return pct + '%';
    return pct + '% — проверь';
  }

  function render(items) {
    if (!items || !items.length) { remove(); return; }

    if (!_el) {
      _el = document.createElement('div');
      _el.className = 'skud-banner is-collapsed';
      _el.id = 'asgardSkudBanner';
      // Свёрнуто по умолчанию: в развёрнутом виде баннер закрывает правый
      // нижний угол графика офиса, и ячейки под ним не кликаются.
      _collapsed = true;
      document.body.appendChild(_el);
    }

    var total = items.length;
    var shown = items.slice(0, 3);

    var rows = shown.map(function (it) {
      var opts = (it.candidates || []).map(function (c) {
        return '<button class="skud-opt" type="button" data-act="map" data-raw="' + esc(it.raw_name) +
          '" data-staff="' + c.staff_id + '">' +
          optLabel(c) +
          '<span class="skud-opt__conf">' + esc(confidenceLabel(c.confidence)) + '</span>' +
          '</button>';
      }).join('');

      if (!opts) {
        opts = '<span class="skud-banner__sub">Похожих сотрудников нет</span>';
      }

      return '<div class="skud-map-item">' +
        '<div class="skud-map-item__name">' + esc(it.raw_name) + '</div>' +
        '<div class="skud-map-item__days">' + it.days + ' дн. в отчёте' +
          (it.first_date ? ' · ' + esc(String(it.first_date).slice(0, 10)) + '…' + esc(String(it.last_date).slice(0, 10)) : '') +
        '</div>' +
        '<div class="skud-map-item__opts">' + opts +
          '<button class="skud-opt is-skip" type="button" data-act="skip" data-raw="' + esc(it.raw_name) + '">В CRM нет — пропускать</button>' +
        '</div>' +
      '</div>';
    }).join('');

    _el.innerHTML =
      '<div class="skud-banner__head">' +
        '<div class="skud-banner__title">В отчёте СКУД ' + total + ' ФИО без привязки</div>' +
        '<button class="skud-banner__x" type="button" data-act="close" aria-label="Закрыть">×</button>' +
      '</div>' +
      '<div class="skud-banner__sub">Выберите сотрудника — часы пересчитаются сразу за все периоды.</div>' +
      rows +
      (total > shown.length ? '<div class="skud-banner__more">и ещё ' + (total - shown.length) + ' — откройте график офиса</div>' : '');

    bind();
  }

  function bind() {
    if (!_el || _el._bound) return;
    _el._bound = true;
    _el.addEventListener('click', async function (e) {
      var btn = e.target.closest('[data-act]');
      var act = btn ? btn.getAttribute('data-act') : null;

      // Клик по свёрнутому баннеру (мимо кнопок) — развернуть список.
      if (!act && _collapsed) {
        _collapsed = false;
        _el.classList.remove('is-collapsed');
        bindOutsideClose();
        return;
      }

      if (act === 'close') {
        // Не «навсегда»: баннер вернётся при следующем входе, пока не разобрано.
        _el.style.display = 'none';
        unbindOutsideClose();
        return;
      }

      if (!btn) return;
      btn.disabled = true;
      try {
        if (act === 'skip') {
          await apiPost('/api/office-attendance/map', { raw_name: btn.getAttribute('data-raw'), skip: true });
        } else if (act === 'map') {
          await apiPost('/api/office-attendance/map', {
            raw_name: btn.getAttribute('data-raw'),
            staff_id: parseInt(btn.getAttribute('data-staff'), 10)
          });
        }
        _el._bound = false;
        _el.remove();
        _el = null;
        await load();
      } catch (err) {
        btn.disabled = false;
        if (window.AsgardUI && AsgardUI.toast) {
          AsgardUI.toast('Ошибка', 'Не удалось привязать: ' + (err.message || ''), 'err');
        }
      }
    }, true);
  }

  function remove() {
    unbindOutsideClose();
    if (_el && _el.parentNode) _el.parentNode.removeChild(_el);
    _el = null;
  }

  /**
   * Развёрнутый баннер закрывает правый нижний угол графика офиса: ячейки
   * под ним не кликаются. Поэтому по клику вне баннера он сворачивается
   * обратно в одну строку — окно не «залипает» поверх интерфейса.
   */
  function onOutsideClick(e) {
    if (!_el || _collapsed) return;
    if (_el.contains(e.target)) return;
    _collapsed = true;
    _el.classList.add('is-collapsed');
    unbindOutsideClose();
  }

  function bindOutsideClose() {
    if (_outsideBound) return;
    _outsideBound = true;
    // capture: ловим раньше обработчиков страницы, ничего не отменяем.
    document.addEventListener('mousedown', onOutsideClick, true);
  }

  function unbindOutsideClose() {
    if (!_outsideBound) return;
    _outsideBound = false;
    document.removeEventListener('mousedown', onOutsideClick, true);
  }

  async function load() {
    var j = await apiGet('/api/office-attendance/pending-map');
    if (!j || !j.ok) return;
    render(j.items || []);
  }

  /**
   * Монтирование. Неблокирующее: любые ошибки (нет таблиц до миграции,
   * нет прав, офлайн) просто оставляют страницу без баннера.
   */
  function mount(cfg) {
    cfg = cfg || {};
    var auth = cfg.auth;
    if (!auth || !auth.user) return;
    var role = String(auth.user.role || '');
    if (!ROLES[role]) return;
    if (_mounted) return;
    _mounted = true;

    // Не мешаем странице отрисоваться: грузим после первого кадра.
    setTimeout(function () { load().catch(function () {}); }, 1200);
  }

  window.AsgardSkudBanner = { mount: mount, reload: load, remove: remove };
})();
