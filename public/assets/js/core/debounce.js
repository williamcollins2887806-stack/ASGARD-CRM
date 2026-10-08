// ASGARD CRM — Debounce / throttle utility (vanilla)
// Единая точка для задержки частых событий ввода (поиск, фильтры).
// Причина: обработчики addEventListener('input') без debounce перерисовывают
// список и/или дёргают сеть на каждый символ — главный источник лага на
// страницах с большим количеством строк (см. CRM-PERFORMANCE-REPAIR-PLAN.md).
//
// Использование:
//   const search = AsgardDebounce(() => applyFilters(), 300);
//   input.addEventListener('input', search);
//   // принудительный сброс (например, кнопка «Сброс»):
//   search.cancel();
//   // немедленный вызов с отменой хвоста:
//   search.flush();
window.AsgardDebounce = (function () {
  /**
   * @param {Function} fn    функция, которую нужно вызывать не чаще одного раза в wait мс
   * @param {number}   wait  задержка в мс (по умолчанию 300)
   * @param {object}   [opts] { leading: boolean } — вызвать сразу на первом событии
   * @returns {Function & {cancel: Function, flush: Function}}
   */
  function debounce(fn, wait, opts) {
    if (typeof fn !== 'function') throw new TypeError('AsgardDebounce: fn must be a function');
    var delay = Number(wait);
    if (!Number.isFinite(delay) || delay < 0) delay = 300;
    var leading = !!(opts && opts.leading);
    var timer = null;
    var lastArgs = null;
    var invokedLeading = false;

    function invoke() {
      timer = null;
      invokedLeading = false;
      if (lastArgs) {
        var args = lastArgs;
        lastArgs = null;
        fn.apply(this, args);
      }
    }

    function debounced() {
      lastArgs = arguments;
      if (leading && !invokedLeading) {
        invokedLeading = true;
        var args = lastArgs;
        lastArgs = null;
        fn.apply(this, args);
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(invoke, delay);
    }

    debounced.cancel = function () {
      if (timer) clearTimeout(timer);
      timer = null;
      lastArgs = null;
      invokedLeading = false;
    };

    debounced.flush = function () {
      if (timer) clearTimeout(timer);
      invoke();
    };

    return debounced;
  }

  /**
   * Throttle: не чаще одного вызова в wait мс (для скролла, resize).
   */
  function throttle(fn, wait) {
    if (typeof fn !== 'function') throw new TypeError('AsgardDebounce: fn must be a function');
    var delay = Number(wait);
    if (!Number.isFinite(delay) || delay < 0) delay = 200;
    var last = 0;
    var timer = null;
    var lastArgs = null;
    return function () {
      var now = Date.now();
      lastArgs = arguments;
      if (now - last >= delay) {
        last = now;
        fn.apply(this, lastArgs);
      } else if (!timer) {
        timer = setTimeout(function () {
          timer = null;
          last = Date.now();
          fn.apply(this, lastArgs);
        }, delay - (now - last));
      }
    };
  }

  // Удобный хелпер: повесить debounce-обработчик на элемент.
  //   AsgardDebounce.bind(inputEl, 'input', () => apply(), 300);
  function bind(el, event, fn, wait, opts) {
    if (!el || !el.addEventListener) return null;
    var d = debounce(fn, wait, opts);
    el.addEventListener(event, d);
    return d;
  }

  return Object.assign(debounce, { debounce: debounce, throttle: throttle, bind: bind });
})();
