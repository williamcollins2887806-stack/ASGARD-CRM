/**
 * АСГАРД CRM — Мимир: Универсальное автозаполнение форм
 * WOW-визуал: cascade fill, typewriter, golden glow, skeleton loading
 *
 * Использование:
 *   MimirForms.inject(formElement, 'contract', () => ({ tender_id: 123 }))
 *   MimirForms.inject(formElement, 'correspondence', () => ({ subject: '...' }))
 */
window.MimirForms = (function() {
  'use strict';

  const STYLE_ID = 'mimir-forms-styles';

  // ═══════ CSS (inject once) ═══════
  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      /* ═══ Mimir Form Button ═══ */
      .mimir-form-btn {
        display:inline-flex;align-items:center;gap:8px;
        padding:8px 16px;border:none;border-radius:10px;
        background:linear-gradient(135deg,#C0392B,#D4A843);
        color:#fff;font-weight:700;font-size:13px;cursor:pointer;
        transition:all .25s;font-family:inherit;
        box-shadow:0 2px 12px rgba(192,57,43,.25);
        position:relative;overflow:hidden;
      }
      .mimir-form-btn:hover {
        transform:translateY(-1px);
        box-shadow:0 4px 20px rgba(192,57,43,.35);
      }
      .mimir-form-btn:active { transform:scale(.97) }
      .mimir-form-btn:disabled { opacity:.7;cursor:wait;transform:none }

      /* Shimmer effect on button */
      .mimir-form-btn::after {
        content:'';position:absolute;top:0;left:-100%;width:100%;height:100%;
        background:linear-gradient(90deg,transparent,rgba(255,255,255,.15),transparent);
        transition:none;
      }
      .mimir-form-btn.pulsing::after {
        animation:mimirBtnShimmer 3s ease infinite;
      }
      @keyframes mimirBtnShimmer {
        0%{left:-100%} 50%{left:100%} 100%{left:100%}
      }

      /* Pulse glow */
      @keyframes mimirFormPulse {
        0%,100%{box-shadow:0 2px 12px rgba(192,57,43,.25)}
        50%{box-shadow:0 2px 24px rgba(212,168,67,.45)}
      }
      .mimir-form-btn.pulsing { animation:mimirFormPulse 2.5s ease infinite }

      /* ═══ Spinner ═══ */
      @keyframes mimirFormSpin { to{transform:rotate(360deg)} }
      .mimir-form-spinner {
        display:inline-block;width:14px;height:14px;
        border:2px solid rgba(255,255,255,.25);border-top-color:#fff;
        border-radius:50%;animation:mimirFormSpin .6s linear infinite;
      }

      /* ═══ Field fill animation ═══ */
      @keyframes mimirFieldSlideIn {
        from{opacity:.3;transform:translateX(-6px)}
        to{opacity:1;transform:translateX(0)}
      }
      @keyframes mimirFieldGlow {
        0%{box-shadow:0 0 0 0 rgba(212,168,67,.5)}
        40%{box-shadow:0 0 12px 3px rgba(212,168,67,.3)}
        100%{box-shadow:none}
      }
      .mimir-field-filled {
        animation:mimirFieldSlideIn .3s ease, mimirFieldGlow .8s ease .15s !important;
      }

      /* ═══ Skeleton loading ═══ */
      @keyframes mimirSkelPulse {
        0%{background-position:-200% 0}
        100%{background-position:200% 0}
      }
      .mimir-field-skeleton {
        background:linear-gradient(90deg,transparent 25%,rgba(212,168,67,.08) 50%,transparent 75%) !important;
        background-size:200% 100% !important;
        animation:mimirSkelPulse 1.5s ease infinite !important;
        color:transparent !important;
        pointer-events:none !important;
      }

      /* ═══ Typewriter cursor ═══ */
      @keyframes mimirCursorBlink { 0%,100%{opacity:1} 50%{opacity:0} }
      .mimir-typewriter-cursor::after {
        content:'|';color:#D4A843;font-weight:700;
        animation:mimirCursorBlink .6s ease infinite;
        margin-left:1px;
      }

      /* ═══ Golden shimmer sweep ═══ */
      @keyframes mimirShimmerSweep {
        0%{background-position:-200% 0}
        100%{background-position:200% 0}
      }
      .mimir-shimmer-sweep {
        height:2px;border-radius:1px;margin:6px 0;
        background:linear-gradient(90deg,transparent,rgba(212,168,67,.7),transparent);
        background-size:200% 100%;
        animation:mimirShimmerSweep 1.2s ease forwards;
      }

      /* ═══ Success badge ═══ */
      .mimir-fill-badge {
        display:inline-flex;align-items:center;gap:6px;
        padding:6px 12px;border-radius:8px;font-size:12px;font-weight:600;
        background:rgba(212,168,67,.1);color:#D4A843;
        border:1px solid rgba(212,168,67,.2);
        animation:mimirFieldSlideIn .4s ease;
        margin-top:8px;
      }
    `;
    document.head.appendChild(s);
  }

  // ═══════ Typewriter effect for text inputs/textareas ═══════
  function typewriterFill(input, text, onDone) {
    const isTextarea = input.tagName === 'TEXTAREA';
    const totalSteps = Math.min(text.length, 60);
    const stepSize = Math.ceil(text.length / totalSteps);
    let step = 0;
    input.classList.add('mimir-typewriter-cursor');

    const interval = setInterval(() => {
      step++;
      const chars = Math.min(step * stepSize, text.length);
      input.value = text.slice(0, chars);
      if (chars >= text.length) {
        clearInterval(interval);
        input.classList.remove('mimir-typewriter-cursor');
        if (onDone) onDone();
      }
    }, 35);
  }

  // ═══════ Cascade fill with WOW animations ═══════
  function cascadeFill(form, fieldsMap, opts = {}) {
    const entries = Object.entries(fieldsMap).filter(([, v]) => v != null && v !== '');
    let filled = 0;
    const useTypewriter = opts.typewriter !== false;

    entries.forEach(([fieldName, value], i) => {
      const inp = form.querySelector(`[name="${fieldName}"]`);
      if (!inp) return;
      // Skip if already has value (unless force)
      if (inp.value && !opts.force) return;

      setTimeout(() => {
        // Skeleton briefly
        inp.classList.add('mimir-field-skeleton');
        setTimeout(() => {
          inp.classList.remove('mimir-field-skeleton');

          // Typewriter for textareas and long text
          const isLongText = (inp.tagName === 'TEXTAREA' || String(value).length > 50) && useTypewriter;
          if (isLongText) {
            typewriterFill(inp, String(value));
          } else {
            inp.value = value;
          }

          // Set select values
          if (inp.tagName === 'SELECT') {
            const opt = inp.querySelector(`option[value="${value}"]`);
            if (opt) opt.selected = true;
          }

          inp.classList.add('mimir-field-filled');
          filled++;
          setTimeout(() => inp.classList.remove('mimir-field-filled'), 1200);

          // Dispatch change event for reactive listeners
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
        }, 180);
      }, i * 130);
    });

    // Shimmer sweep after all
    if (entries.length > 0) {
      setTimeout(() => {
        const sweep = document.createElement('div');
        sweep.className = 'mimir-shimmer-sweep';
        form.appendChild(sweep);
        setTimeout(() => sweep.remove(), 1500);
      }, entries.length * 130 + 400);
    }

    return entries.length;
  }

  // ═══════ Create the Mimir button ═══════
  function createButton(text) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mimir-form-btn pulsing';
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" fill="rgba(255,255,255,.2)"/>
      </svg>
      ${text || 'Мимир заполнит'}
    `;
    return btn;
  }

  // ═══════ Main: inject Mimir button into a form ═══════
  function inject(formOrSelector, formType, contextFn, opts = {}) {
    ensureStyles();

    const form = typeof formOrSelector === 'string'
      ? document.querySelector(formOrSelector)
      : formOrSelector;
    if (!form) return null;

    // Don't inject twice (check by form + target)
    const existingBtn = (opts.target || form).querySelector('.mimir-form-btn');
    if (existingBtn) return existingBtn;

    const btn = createButton(opts.buttonText);
    const target = opts.target || form.querySelector('.cm-footer') || form;

    if (opts.position === 'before') {
      target.insertBefore(btn, target.firstChild);
    } else if (opts.position === 'after' || target === form) {
      target.appendChild(btn);
    } else {
      target.insertBefore(btn, target.firstChild);
    }

    btn.addEventListener('click', async () => {
      const context = typeof contextFn === 'function' ? contextFn() : (contextFn || {});

      // Collect existing form values as context
      const existingFields = {};
      form.querySelectorAll('input, select, textarea').forEach(inp => {
        if (inp.name && inp.value) existingFields[inp.name] = inp.value;
      });

      btn.disabled = true;
      btn.classList.remove('pulsing');
      btn.innerHTML = '<span class="mimir-form-spinner"></span> Мимир думает\u2026';

      // Show skeleton on empty fields
      const emptyFields = form.querySelectorAll('input:not([type=hidden]):not([type=submit]), textarea, select');
      emptyFields.forEach(f => { if (!f.value) f.classList.add('mimir-field-skeleton'); });

      try {
        const token = localStorage.getItem('asgard_token');
        const resp = await fetch('/api/mimir/suggest-form', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({
            form_type: formType,
            context: { ...context, existing_fields: existingFields }
          })
        });

        emptyFields.forEach(f => f.classList.remove('mimir-field-skeleton'));

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error(err.error || 'Ошибка сервера');
        }

        const data = await resp.json();
        if (data.fields && Object.keys(data.fields).length > 0) {
          const count = cascadeFill(form, data.fields, { typewriter: true });

          // Success badge
          const badge = document.createElement('div');
          badge.className = 'mimir-fill-badge';
          badge.innerHTML = `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 7 7 11 13 3"/></svg>Мимир заполнил ${count} полей`;
          const badgeTarget = form.querySelector('.cm-section:last-of-type') || form;
          badgeTarget.appendChild(badge);
          setTimeout(() => badge.remove(), 4000);

          if (window.AsgardUI) AsgardUI.toast('Мимир', `Заполнил ${count} полей`, 'ok');
        } else {
          // Мало данных — открыть Мимир FAB с подсказкой
          if (window.AsgardMimir) {
            AsgardMimir.open();
            setTimeout(() => {
              const msgs = document.getElementById('mimirMessages');
              if (msgs) {
                const tip = document.createElement('div');
                tip.style.cssText = 'padding:12px 16px;background:linear-gradient(135deg,rgba(212,168,67,.1),rgba(59,130,246,.05));border:1px solid rgba(212,168,67,.2);border-radius:12px;margin:8px 0;font-size:13px;color:#e5e7eb;line-height:1.5';
                tip.innerHTML = '🧙 <b style="color:#D4A843">Воин, мало информации!</b><br>Заполни хотя бы пару полей — название, номер или контрагента — и я смогу помочь дальше.';
                msgs.appendChild(tip);
                msgs.scrollTop = msgs.scrollHeight;
              }
            }, 200);
          } else {
            if (window.AsgardUI) AsgardUI.toast('Мимир', 'Заполни хотя бы пару полей — и я помогу дальше', 'warn');
          }
        }
      } catch (err) {
        emptyFields.forEach(f => f.classList.remove('mimir-field-skeleton'));
        // Ошибка AI — открыть Мимир FAB с объяснением
        if (window.AsgardMimir) {
          AsgardMimir.open();
          setTimeout(() => {
            const msgs = document.getElementById('mimirMessages');
            if (msgs) {
              const tip = document.createElement('div');
              tip.style.cssText = 'padding:12px 16px;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:12px;margin:8px 0;font-size:13px;color:#e5e7eb;line-height:1.5';
              tip.innerHTML = '🧙 <b style="color:#ef4444">Не получилось</b><br>' + (err.message || 'Ошибка') + '<br><span style="color:#9ca3af;font-size:12px">Попробуй заполнить пару полей вручную и нажми кнопку снова.</span>';
              msgs.appendChild(tip);
              msgs.scrollTop = msgs.scrollHeight;
            }
          }, 200);
        } else {
          if (window.AsgardUI) AsgardUI.toast('Мимир', err.message || 'Ошибка', 'err');
        }
      } finally {
        btn.disabled = false;
        btn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" fill="rgba(255,255,255,.2)"/>
          </svg>
          ${opts.buttonText || 'Мимир заполнит'}
        `;
        btn.classList.add('pulsing');
      }
    });

    return btn;
  }

  // ═══════ Public API ═══════
  return {
    inject,
    cascadeFill,
    typewriterFill,
    createButton,
    ensureStyles
  };
})();
