/**
 * AsgardPhoneMask — единый формат телефона по всей СРМ.
 *
 * Канон: +7 (916) 061-48-09
 *   • 8916… → 7916… (ведущую «8» исправляем на «7»)
 *   • 916…  → +7 (916) …  (локальный номер трактуем как РФ)
 *   • «+7(916)061-48-09» (без пробелов) — только для отображения, ввод маскируется
 *   • ввод «8916» сам превращается в «+7 (916)»
 *
 * Работает с любым фреймворком: вешает capture-слушатель на document и
 * маскирует ЛЮБОЕ поле телефона (type=tel / inputmode=tel / name~phone).
 * React читает значение на фазе bubble — то есть получает уже
 * отформатированную строку, дополнительно ничего подключать не нужно.
 *
 * Отключить для конкретного поля: <input data-phone-mask="off">.
 *
 * API:
 *   AsgardPhoneMask.format(v)  → '+7 (916) 061-48-09'
 *   AsgardPhoneMask.digits(v)  → '79160614809'
 *   AsgardPhoneMask.attach(el) → повесить маску на один input
 */
(function (global) {
  'use strict';

  var MARK = 'phoneMaskBound';
  var SKIP = 'phoneMaskOff';

  function digits(v) {
    return String(v == null ? '' : v).replace(/\D/g, '');
  }

  /** Приводим к 11 цифрам РФ: 8XXXXXXXXXX → 7XXXXXXXXXX, XXXXXXXXXX → 7XXXXXXXXXX. */
  function toRuDigits(v) {
    var d = digits(v);
    if (!d) return '';
    if (d[0] === '8') d = '7' + d.slice(1);
    if (d[0] !== '7') d = '7' + d;
    return d.slice(0, 11);
  }

  /** Прогрессивная маска: печатаешь цифры — на лету достраивается +7 (XXX) XXX-XX-XX. */
  function format(v) {
    var d = toRuDigits(v);
    if (!d) return '';
    var rest = d.slice(1); // 10 цифр после «7»
    var r = '+7';
    if (rest.length) r += ' (' + rest.slice(0, 3);
    if (rest.length >= 3) r += ')';
    if (rest.length > 3) r += ' ' + rest.slice(3, 6);
    if (rest.length > 6) r += '-' + rest.slice(6, 8);
    if (rest.length > 8) r += '-' + rest.slice(8, 10);
    return r;
  }

  /** Полный номер без форматирования — для API/БД. */
  function e164(v) {
    var d = toRuDigits(v);
    return d.length === 11 ? ('+' + d) : '';
  }

  /** Похоже ли поле на телефон. */
  function looksLikePhone(el) {
    if (!el || el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return false;
    if (el.getAttribute('data-phone-mask') === 'off') return false;
    if (el.type === 'tel') return true;
    if ((el.getAttribute('inputmode') || '').toLowerCase() === 'tel') return true;
    var name = (el.getAttribute('name') || '') + ' ' + (el.getAttribute('id') || '') + ' ' + (el.getAttribute('placeholder') || '');
    if (/phone|tel|телефон|мобил/i.test(name)) return true;
    return false;
  }

  function mask(el) {
    if (!looksLikePhone(el)) return;
    var before = el.value;
    var after = format(before);
    if (after === before) return;
    // Сохраняем позицию каретки по числу цифр слева, чтобы ввод в середину не «прыгал».
    var start = el.selectionStart;
    var digitsLeft = digits(String(before).slice(0, start == null ? before.length : start)).length;
    el.value = after;
    try {
      var pos = after.length;
      var seen = 0;
      for (var i = 0; i < after.length; i++) {
        if (/\d/.test(after[i])) seen++;
        if (seen >= digitsLeft) { pos = i + 1; break; }
      }
      el.setSelectionRange(pos, pos);
    } catch (_) { /* type=tel обычно поддерживает setSelectionRange */ }
  }

  function attach(el) {
    if (!el || el[MARK]) return el;
    if (!looksLikePhone(el)) return el;
    el[MARK] = true;
    if (el.getAttribute('autocomplete') == null) el.setAttribute('autocomplete', 'tel');
    if (el.getAttribute('inputmode') == null) el.setAttribute('inputmode', 'tel');
    // Стартовое значение (если пришло из БД в «сыром» виде).
    if (el.value) mask(el);
    ['input', 'blur', 'change'].forEach(function (ev) {
      el.addEventListener(ev, function () { mask(el); }, false);
    });
    return el;
  }

  function scan(root) {
    var scope = root || global.document;
    if (!scope || !scope.querySelectorAll) return;
    scope.querySelectorAll('input[type="tel"], input[inputmode="tel"]').forEach(attach);
    scope.querySelectorAll('input[name], input[id], input[placeholder]').forEach(function (el) {
      if (looksLikePhone(el)) attach(el);
    });
  }

  function install() {
    if (typeof global.document === 'undefined') return;
    // Новые поля (SPA/модалки/React) — ловим мутации DOM.
    try {
      var mo = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var added = muts[i].addedNodes || [];
          for (var j = 0; j < added.length; j++) {
            var n = added[j];
            if (!n || n.nodeType !== 1) continue;
            if (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA') attach(n);
            else if (n.querySelectorAll) scan(n);
          }
        }
      });
      mo.observe(global.document.documentElement, { childList: true, subtree: true });
    } catch (_) { /* старый браузер — обойдёмся начальным scan */ }
    scan(global.document);
  }

  var api = { format: format, digits: function (v) { return toRuDigits(v); }, e164: e164, attach: attach, scan: scan };
  global.AsgardPhoneMask = api;

  if (global.document) {
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', install);
    } else {
      install();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
