/**
 * Российские маски для vanilla (паритет с desktop-v2-src/src/lib/ruMasks.js).
 * window.AsgardRuMasks
 */
window.AsgardRuMasks = (function () {
  function digitsOf(v) {
    return String(v || '').replace(/\D/g, '');
  }

  function normalizeRuPhoneDigits(raw) {
    let d = digitsOf(raw);
    if (!d) return '';
    if (d.startsWith('8') && d.length === 11) d = '7' + d.slice(1);
    if (d.length === 10) d = '7' + d;
    if (d.length > 11) d = d.slice(0, 11);
    return d;
  }

  function formatRuPhoneDisplay(raw) {
    const d = normalizeRuPhoneDigits(raw);
    if (!d) return '';
    if (d.length <= 1) return '+7';
    const rest = d.startsWith('7') ? d.slice(1) : d;
    if (rest.length <= 3) return '+7(' + rest;
    if (rest.length <= 6) return '+7(' + rest.slice(0, 3) + ')-' + rest.slice(3);
    if (rest.length <= 8) return '+7(' + rest.slice(0, 3) + ')-' + rest.slice(3, 6) + '-' + rest.slice(6);
    return '+7(' + rest.slice(0, 3) + ')-' + rest.slice(3, 6) + '-' + rest.slice(6, 8) + '-' + rest.slice(8, 10);
  }

  function formatSnilsDisplay(raw) {
    const d = digitsOf(raw).slice(0, 11);
    if (!d) return '';
    if (d.length <= 3) return d;
    if (d.length <= 6) return d.slice(0, 3) + '-' + d.slice(3);
    if (d.length <= 9) return d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6);
    return d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6, 9) + ' ' + d.slice(9);
  }

  function formatPassportCodeDisplay(raw) {
    const d = digitsOf(raw).slice(0, 6);
    if (!d) return '';
    if (d.length <= 3) return d;
    return d.slice(0, 3) + '-' + d.slice(3);
  }

  function bindPhoneInput(el) {
    if (!el) return;
    el.value = formatRuPhoneDisplay(el.value);
    el.addEventListener('input', function () {
      const caretEnd = el.selectionStart === el.value.length;
      el.value = formatRuPhoneDisplay(el.value);
      if (caretEnd) el.setSelectionRange(el.value.length, el.value.length);
    });
  }

  function bindDigitsInput(el, maxLen, formatter) {
    if (!el) return;
    if (formatter) el.value = formatter(el.value);
    else el.value = digitsOf(el.value).slice(0, maxLen);
    el.addEventListener('input', function () {
      const d = digitsOf(el.value).slice(0, maxLen);
      el.value = formatter ? formatter(d) : d;
    });
  }

  function phoneDigitsFromInput(el) {
    return normalizeRuPhoneDigits(el && el.value);
  }

  function digitsFromInput(el, maxLen) {
    return digitsOf(el && el.value).slice(0, maxLen || 99);
  }

  return {
    digitsOf,
    normalizeRuPhoneDigits,
    formatRuPhoneDisplay,
    formatSnilsDisplay,
    formatPassportCodeDisplay,
    bindPhoneInput,
    bindDigitsInput,
    phoneDigitsFromInput,
    digitsFromInput,
  };
})();
