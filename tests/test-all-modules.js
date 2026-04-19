/**
 * S8 Post-migration audit — CRSelect / CREmployeePicker / CRAutocomplete
 *
 * Run in browser console on any page after login:
 *   fetch('/tests/test-all-modules.js').then(r=>r.text()).then(eval)
 *
 * Or via Node for static checks:
 *   node tests/test-all-modules.js
 */
(function runAudit() {
  const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
  const results = { pass: 0, fail: 0, warn: 0, details: [] };

  function ok(msg) { results.pass++; results.details.push('✅ ' + msg); }
  function fail(msg) { results.fail++; results.details.push('❌ ' + msg); }
  function warn(msg) { results.warn++; results.details.push('⚠️ ' + msg); }

  // ── 1. Global availability ──
  if (isBrowser) {
    if (typeof CRSelect !== 'undefined' && CRSelect.create) ok('CRSelect is globally available');
    else fail('CRSelect is NOT available globally');

    if (typeof CREmployeePicker !== 'undefined' && CREmployeePicker.create) ok('CREmployeePicker is globally available');
    else fail('CREmployeePicker is NOT available globally');

    if (typeof CRAutocomplete !== 'undefined' && CRAutocomplete.create) ok('CRAutocomplete is globally available');
    else warn('CRAutocomplete is not loaded (may be OK if not used on this page)');
  }

  // ── 2. Unique IDs check ──
  if (isBrowser && typeof CRSelect !== 'undefined') {
    const ids = CRSelect.getAll();
    const dups = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dups.length === 0) ok('CRSelect: all ' + ids.length + ' IDs are unique');
    else fail('CRSelect: duplicate IDs found: ' + dups.join(', '));
  }

  if (isBrowser && typeof CREmployeePicker !== 'undefined' && CREmployeePicker.getAll) {
    const ids = CREmployeePicker.getAll();
    const dups = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dups.length === 0) ok('CREmployeePicker: all ' + ids.length + ' IDs are unique');
    else fail('CREmployeePicker: duplicate IDs found: ' + dups.join(', '));
  }

  // ── 3. Orphaned DOM elements ──
  if (isBrowser) {
    const crSelectEls = document.querySelectorAll('.cr-select-wrap');
    const registeredIds = (typeof CRSelect !== 'undefined') ? new Set(CRSelect.getAll()) : new Set();
    let orphaned = 0;
    crSelectEls.forEach(el => {
      const id = el.dataset.crSelectId || el.querySelector('[data-cr-select-id]')?.dataset.crSelectId;
      if (id && !registeredIds.has(id)) {
        orphaned++;
        warn('Orphaned .cr-select-wrap with id="' + id + '" (DOM present, no instance)');
      }
    });
    if (orphaned === 0) ok('No orphaned .cr-select-wrap DOM elements (' + crSelectEls.length + ' total)');

    const pickerEls = document.querySelectorAll('.cr-emp-picker-wrap');
    const pickerIds = (typeof CREmployeePicker !== 'undefined' && CREmployeePicker.getAll)
      ? new Set(CREmployeePicker.getAll()) : new Set();
    let orphanedPickers = 0;
    pickerEls.forEach(el => {
      const id = el.dataset.pickerId;
      if (id && !pickerIds.has(id)) {
        orphanedPickers++;
        warn('Orphaned .cr-emp-picker-wrap with id="' + id + '"');
      }
    });
    if (orphanedPickers === 0) ok('No orphaned .cr-emp-picker-wrap DOM elements (' + pickerEls.length + ' total)');
  }

  // ── 4. Check for leftover native <select> in main content ──
  if (isBrowser) {
    const layout = document.getElementById('layout') || document.body;
    const nativeSelects = layout.querySelectorAll('select:not(.cr-select-internal)');
    if (nativeSelects.length === 0) {
      ok('No native <select> elements found in #layout');
    } else {
      nativeSelects.forEach(sel => {
        const id = sel.id || '(no id)';
        const parent = sel.parentElement?.id || sel.parentElement?.className || '?';
        warn('Native <select> found: id=' + id + ', parent=' + parent);
      });
    }
  }

  // ── 5. Check for legacy datalist elements ──
  if (isBrowser) {
    const datalists = document.querySelectorAll('datalist');
    if (datalists.length === 0) {
      ok('No <datalist> elements found');
    } else {
      datalists.forEach(dl => {
        warn('Legacy <datalist> found: id=' + (dl.id || '(no id)'));
      });
    }
  }

  // ── Report ──
  console.log('\n========================================');
  console.log('  S8 POST-MIGRATION AUDIT REPORT');
  console.log('========================================');
  results.details.forEach(d => console.log(d));
  console.log('----------------------------------------');
  console.log('Pass: ' + results.pass + '  Fail: ' + results.fail + '  Warn: ' + results.warn);
  console.log('========================================\n');

  return results;
})();
