/**
 * AsgardActionMenu — Универсальный popup-grid меню действий
 * ═══════════════════════════════════════════════════════════
 * Группирует действия модалки в красивое popup-grid меню с иконками и описаниями.
 *
 * Использование:
 *   AsgardActionMenu.show({
 *     title: 'Действия по работе',
 *     actions: [
 *       { icon: '📄', label: 'Скачать', desc: 'Скачать документы', onClick: fn },
 *       { icon: '📊', label: 'ТКП', desc: 'Коммерческое предложение', onClick: fn },
 *       '---',  // разделитель секций
 *       { icon: '💰', label: 'Расходы', desc: 'Реестр расходов по работе', onClick: fn },
 *     ]
 *   });
 */
window.AsgardActionMenu = (function () {
  'use strict';

  const MENU_ID = 'asgard-action-menu-overlay';

  // ─── CSS (injected once) ───────────────────────────────────────────────────
  let _cssInjected = false;
  function injectCSS() {
    if (_cssInjected) return;
    _cssInjected = true;
    const style = document.createElement('style');
    style.textContent = `
      /* ═══ Action Menu Overlay ═══ */
      .aam-overlay {
        position: fixed; inset: 0;
        z-index: 10000;
        background: rgba(8,9,12,0.7);
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
        display: flex; align-items: center; justify-content: center;
        opacity: 0;
        transition: opacity .2s ease;
        font-family: var(--ff, 'Inter', sans-serif);
      }
      .aam-overlay.aam-visible { opacity: 1; }

      /* ═══ Panel ═══ */
      .aam-panel {
        background: linear-gradient(145deg, var(--bg2, #151922), var(--bg1, #0D1117));
        border: 1px solid var(--brd, rgba(255,255,255,0.08));
        border-radius: var(--r-lg, 12px);
        box-shadow: 0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(212,168,67,0.08);
        max-width: 680px;
        width: 92vw;
        max-height: 85vh;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        transform: translateY(16px) scale(0.97);
        transition: transform .25s cubic-bezier(.2,.9,.3,1);
      }
      .aam-overlay.aam-visible .aam-panel {
        transform: translateY(0) scale(1);
      }

      /* ═══ Header ═══ */
      .aam-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 20px 12px;
        border-bottom: 1px solid var(--brd, rgba(255,255,255,0.08));
      }
      .aam-title {
        font-size: 15px;
        font-weight: 700;
        color: var(--t1, rgba(255,255,255,0.95));
        letter-spacing: 0.3px;
      }
      .aam-close {
        width: 32px; height: 32px;
        border: none; background: transparent;
        color: var(--t3, rgba(255,255,255,0.4));
        font-size: 18px;
        cursor: pointer;
        border-radius: 6px;
        display: flex; align-items: center; justify-content: center;
        transition: background .15s, color .15s;
      }
      .aam-close:hover {
        background: rgba(255,255,255,0.06);
        color: var(--t1, rgba(255,255,255,0.95));
      }

      /* ═══ Body (scrollable grid) ═══ */
      .aam-body {
        padding: 16px 20px 20px;
        overflow-y: auto;
        flex: 1;
      }

      /* ═══ Section Label ═══ */
      .aam-section {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 1.2px;
        color: var(--t3, rgba(255,255,255,0.4));
        margin: 16px 0 8px;
        padding-left: 2px;
      }
      .aam-section:first-child { margin-top: 0; }

      /* ═══ Grid ═══ */
      .aam-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
        gap: 10px;
      }

      /* ═══ Action Card ═══ */
      .aam-card {
        position: relative;
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 14px 16px;
        background: var(--bg3, #1C2130);
        border: 1px solid transparent;
        border-radius: var(--r-md, 8px);
        cursor: pointer;
        transition: all .18s ease;
        user-select: none;
        -webkit-user-select: none;
        min-height: 56px;
      }
      .aam-card:hover {
        background: rgba(59,130,246,0.08);
        border-color: var(--info, #3B82F6);
        transform: translateY(-1px);
      }
      .aam-card:active {
        transform: translateY(0);
        background: rgba(59,130,246,0.14);
      }
      .aam-card.aam-danger:hover {
        background: rgba(200,41,59,0.1);
        border-color: var(--err, #C8293B);
      }
      .aam-card.aam-danger:active {
        background: rgba(200,41,59,0.18);
      }
      .aam-card.aam-success:hover {
        background: rgba(45,134,89,0.1);
        border-color: var(--ok, #2D8659);
      }
      .aam-card.aam-disabled {
        opacity: 0.4;
        cursor: not-allowed;
        pointer-events: none;
      }

      /* ═══ Card Icon ═══ */
      .aam-icon {
        font-size: 22px;
        line-height: 1;
        flex-shrink: 0;
        width: 28px;
        text-align: center;
        padding-top: 1px;
      }

      /* ═══ Card Text ═══ */
      .aam-text {
        flex: 1;
        min-width: 0;
      }
      .aam-label {
        font-size: 13px;
        font-weight: 600;
        color: var(--t1, rgba(255,255,255,0.95));
        line-height: 1.3;
      }
      .aam-desc {
        font-size: 11px;
        color: var(--t3, rgba(255,255,255,0.4));
        line-height: 1.3;
        margin-top: 2px;
      }

      /* ═══ Badge ═══ */
      .aam-badge {
        position: absolute;
        top: 8px; right: 10px;
        font-size: 9px;
        font-weight: 700;
        padding: 2px 6px;
        border-radius: 4px;
        letter-spacing: 0.3px;
      }
      .aam-badge-new {
        background: rgba(59,130,246,0.2);
        color: var(--info-t, #60A5FA);
      }
      .aam-badge-count {
        background: rgba(212,168,67,0.2);
        color: var(--gold, #D4A843);
      }

      /* ═══ Responsive ═══ */
      @media (max-width: 480px) {
        .aam-panel { width: 96vw; max-height: 90vh; }
        .aam-grid { grid-template-columns: 1fr; }
        .aam-body { padding: 12px 14px 16px; }
        .aam-header { padding: 12px 14px 10px; }
      }
    `;
    document.head.appendChild(style);
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function hide() {
    const el = document.getElementById(MENU_ID);
    if (!el) return;
    el.style.pointerEvents = 'none';
    el.classList.remove('aam-visible');
    setTimeout(() => el.remove(), 220);
    document.removeEventListener('keydown', _onKey);
  }

  function _onKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); hide(); }
  }

  // ─── Show ──────────────────────────────────────────────────────────────────
  /**
   * @param {Object} opts
   * @param {string} opts.title - Заголовок меню
   * @param {Array} opts.actions - Массив действий или '---' (разделитель) или {section:'Название'}
   *   action: { icon, label, desc, onClick, variant?, badge?, badgeType?, disabled? }
   *     variant: 'danger' | 'success' (опционально)
   *     badge: string (опционально, напр. '3' или 'NEW')
   *     badgeType: 'new' | 'count' (опционально)
   *     disabled: boolean (опционально)
   */
  function show(opts = {}) {
    injectCSS();

    // Remove existing if any
    const existing = document.getElementById(MENU_ID);
    if (existing) existing.remove();

    const title = opts.title || 'Действия';
    const actions = opts.actions || [];

    // Build body
    let bodyHtml = '';
    let inGrid = false;

    for (let i = 0; i < actions.length; i++) {
      const a = actions[i];

      // Section separator: '---' or { section: 'Title' }
      if (a === '---' || (a && a.section)) {
        if (inGrid) { bodyHtml += '</div>'; inGrid = false; }
        if (a.section) {
          bodyHtml += `<div class="aam-section">${esc(a.section)}</div>`;
        }
        continue;
      }

      if (!a || !a.label) continue;

      // Open grid if not open
      if (!inGrid) {
        bodyHtml += '<div class="aam-grid">';
        inGrid = true;
      }

      const variantCls = a.variant === 'danger' ? ' aam-danger' : a.variant === 'success' ? ' aam-success' : '';
      const disabledCls = a.disabled ? ' aam-disabled' : '';
      const badgeHtml = a.badge
        ? `<span class="aam-badge ${a.badgeType === 'count' ? 'aam-badge-count' : 'aam-badge-new'}">${esc(a.badge)}</span>`
        : '';

      bodyHtml += `
        <div class="aam-card${variantCls}${disabledCls}" data-aam-idx="${i}" tabindex="0">
          <div class="aam-icon">${a.icon || '⚡'}</div>
          <div class="aam-text">
            <div class="aam-label">${esc(a.label)}</div>
            ${a.desc ? `<div class="aam-desc">${esc(a.desc)}</div>` : ''}
          </div>
          ${badgeHtml}
        </div>
      `;
    }
    if (inGrid) bodyHtml += '</div>';

    // Build overlay
    const overlay = document.createElement('div');
    overlay.id = MENU_ID;
    overlay.className = 'aam-overlay';
    overlay.innerHTML = `
      <div class="aam-panel">
        <div class="aam-header">
          <div class="aam-title">${esc(title)}</div>
          <button class="aam-close" title="Закрыть">✕</button>
        </div>
        <div class="aam-body">
          ${bodyHtml}
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Animate in
    requestAnimationFrame(() => overlay.classList.add('aam-visible'));

    // ─── Event Handlers ────────────────────────────────────────────────────
    // Close button
    overlay.querySelector('.aam-close').addEventListener('click', hide);

    // Click outside panel
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) AsgardUI.oopsBubble(e.clientX, e.clientY);
    });

    // Escape key
    document.addEventListener('keydown', _onKey);

    // Action cards
    overlay.querySelectorAll('.aam-card').forEach(card => {
      const handler = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const idx = parseInt(card.getAttribute('data-aam-idx'), 10);
        const action = actions[idx];
        if (action && action.onClick && !action.disabled) {
          hide();
          // Slight delay to let menu close animation start
          setTimeout(() => action.onClick(), 80);
        }
      };
      card.addEventListener('click', handler);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(e); }
      });
    });
  }

  // ─── Public API ────────────────────────────────────────────────────────────
  return { show, hide };
})();
