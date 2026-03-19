/**
 * ASGARD CRM — Mobile Components v3.0
 * 38 UI-компонентов: Header, HeroCard, Card, Badge, FilterPills,
 * Stats, Section, List, Empty, Skeleton, Toast, BottomSheet, Confirm,
 * FAB, TablePage, BarChart, MiniChart, BigNumber, Form, FullWidthBtn,
 * DetailFields, ProgressBar, Tabs, QuickActions, MimirBanner, SearchBar,
 * ActionSheet, DatePicker, Avatar, NotificationCard, StepWizard,
 * Timeline, ChatBubble, MessageComposer, Chip, SegmentControl,
 * PullToRefresh, SwipeCard
 */

const M = (() => {
  // Use the canonical el() from Utils (core.js) — single source of truth
  const el = Utils.el;

  /* ══════════════════════════════════════════════
     1. HEADER
     ══════════════════════════════════════════════ */
  function Header({ title, subtitle, back = false, backHref, actions = [], transparent = false }) {
    const header = el('header', {
      className: 'asgard-header' + (transparent ? ' asgard-header--transparent' : ''),
    });
    header.setAttribute('role', 'banner');

    // Left: back + titles
    const left = el('div', { className: 'asgard-header__left' });

    if (back) {
      const backBtn = el('button', {
        className: 'asgard-header__back',
        innerHTML: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>',
        onClick: () => {
          if (backHref) Router.navigate(backHref);
          else Router.back();
        },
      });
      backBtn.setAttribute('aria-label', 'Назад');
      left.appendChild(backBtn);
    }

    const titleWrap = el('div', { className: 'asgard-header__titles' });
    if (subtitle) {
      titleWrap.appendChild(el('div', {
        className: 'asgard-header__subtitle',
        textContent: subtitle,
      }));
    }
    titleWrap.appendChild(el('div', {
      className: 'asgard-header__title',
      textContent: title,
    }));
    left.appendChild(titleWrap);
    header.appendChild(left);

    // Right: actions
    if (actions.length > 0) {
      const right = el('div', { className: 'asgard-header__right' });
      actions.forEach(action => {
        const btn = el('button', {
          className: 'asgard-header__action',
          innerHTML: action.icon,
          onClick: action.onClick,
        });
        right.appendChild(btn);
      });
      header.appendChild(right);
    }

    return header;
  }

  /* ══════════════════════════════════════════════
     2. HERO CARD
     ══════════════════════════════════════════════ */
  function HeroCard({ label, value, valuePrefix = '', valueSuffix = '', details = [], gradient }) {
    const card = el('div', {
      className: 'asgard-hero',
      style: Object.assign({ background: gradient || 'var(--hero-grad)' }, DS.anim(0.05)),
    });

    card.appendChild(el('div', { className: 'asgard-hero__watermark', textContent: 'ASGARD' }));

    if (label) {
      card.appendChild(el('div', { className: 'asgard-hero__label', textContent: label }));
    }

    const valEl = el('div', {
      className: 'asgard-hero__value',
      style: Object.assign({}, DS.font('hero'), { color: '#fff', marginBottom: details.length ? '14px' : 0 }),
    });
    const numEl = el('span');
    valEl.appendChild(document.createTextNode(valuePrefix));
    valEl.appendChild(numEl);
    valEl.appendChild(document.createTextNode(valueSuffix));
    card.appendChild(valEl);
    animateNumber(numEl, value);

    if (details.length) {
      const row = el('div', { className: 'asgard-hero__details' });
      details.forEach(d => {
        const item = el('div');
        item.appendChild(el('div', { className: 'asgard-hero__detail-label', textContent: d.label }));
        item.appendChild(el('div', {
          className: 'asgard-hero__detail-value',
          style: { color: d.color || '#fff' },
          textContent: d.value,
        }));
        row.appendChild(item);
      });
      card.appendChild(row);
    }

    return card;
  }

  function animateNumber(el, target, duration = 900) {
    const num = parseFloat(String(target).replace(/[^\d.\u00a0\s-]/g, '').replace(/\s/g, ''));
    if (isNaN(num)) { el.textContent = target; return; }

    const fmt = new Intl.NumberFormat('ru-RU');
    const start = performance.now();

    function update(now) {
      const t = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3); // cubicOut
      const current = Math.round(num * ease);

      // Always format with spaces (12 450 000)
      el.textContent = fmt.format(current);

      if (t < 1) requestAnimationFrame(update);
      else {
        // Final value — use original string if provided, else formatted number
        if (typeof target === 'string') {
          el.textContent = target;
        } else {
          el.textContent = fmt.format(num);
        }
      }
    }
    requestAnimationFrame(update);
  }

  /* ══════════════════════════════════════════════
     3. CARD
     ══════════════════════════════════════════════ */
  function Card({ title, subtitle, badge, badgeColor, fields = [], actions = [], href, arrow = true, time, swipeActions, onClick, style: customStyle, animDelay = 0 }) {
    const borderCls = badgeColor ? (' asgard-card--border-' + badgeColor) : '';
    const linkCls = (href || onClick) ? ' asgard-card--link' : '';
    const dynStyle = Object.assign({}, DS.anim(animDelay), customStyle || {});
    const card = el('div', {
      className: 'asgard-card' + borderCls + linkCls,
      style: Object.keys(dynStyle).length ? dynStyle : undefined,
    });

    if (href || onClick) {
      card.addEventListener('click', () => {
        if (onClick) onClick();
        else if (href) Router.navigate(href);
      });
      card.addEventListener('touchstart', () => card.style.transform = 'scale(0.98)', { passive: true });
      card.addEventListener('touchend', () => card.style.transform = '', { passive: true });
    }

    // Top row: title + badge + arrow
    const topRow = el('div', { className: 'asgard-card__top' + (fields.length ? ' asgard-card__top--has-fields' : '') });

    const titleArea = el('div', { className: 'asgard-card__title-area' });
    titleArea.appendChild(el('div', { className: 'asgard-card__title', textContent: title }));
    if (subtitle) {
      titleArea.appendChild(el('div', { className: 'asgard-card__subtitle', textContent: subtitle }));
    }
    topRow.appendChild(titleArea);

    if (time) {
      topRow.appendChild(el('span', { className: 'asgard-card__time', textContent: time }));
    }

    if (badge) {
      topRow.appendChild(Badge({ text: badge, color: badgeColor }));
    }

    if ((href || onClick) && arrow) {
      topRow.appendChild(el('span', {
        className: 'asgard-card__arrow',
        innerHTML: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>',
      }));
    }

    card.appendChild(topRow);

    // Fields
    if (fields.length) {
      const fieldsWrap = el('div', { className: 'asgard-card__fields' });
      fields.forEach(f => {
        const pair = el('div', { className: 'asgard-card__field-pair' });
        pair.appendChild(el('span', { className: 'asgard-card__field-label', textContent: f.label + ':' }));
        pair.appendChild(el('span', { className: 'asgard-card__field-value', textContent: f.value }));
        fieldsWrap.appendChild(pair);
      });
      card.appendChild(fieldsWrap);
    }

    // Actions row
    if (actions.length) {
      const actRow = el('div', { className: 'asgard-card__actions' });
      actions.forEach(a => {
        const btn = el('button', {
          className: 'asgard-card__action-btn',
          onClick: (e) => { e.stopPropagation(); a.onClick(); },
        });
        if (a.icon) btn.innerHTML = a.icon + ' ';
        btn.appendChild(document.createTextNode(a.label));
        actRow.appendChild(btn);
      });
      card.appendChild(actRow);
    }

    // Swipe actions
    if (swipeActions && swipeActions.length) {
      setTimeout(() => Gestures.setupSwipeActions(card, swipeActions), 0);
    }

    return card;
  }

  /* ══════════════════════════════════════════════
     4. BADGE
     ══════════════════════════════════════════════ */
  function Badge({ text, color, variant = 'solid' }) {
    const presets = {
      success: { c: 'var(--green)', bg: 'var(--green-bg)', border: 'var(--green-border)' },
      danger:  { c: 'var(--red)', bg: 'var(--red-bg)', border: 'var(--red-border)' },
      warning: { c: 'var(--orange)', bg: 'var(--orange-bg)', border: 'var(--orange-border)' },
      info:    { c: 'var(--blue)', bg: 'var(--blue-bg)', border: 'var(--blue-border)' },
      gold:    { c: 'var(--gold)', bg: 'var(--gold-bg)', border: 'var(--gold-border)' },
      neutral: { c: 'var(--text-sec)', bg: 'var(--surface-alt)', border: 'var(--border-strong)' },
    };
    const p = presets[color] || { c: color || 'var(--text-sec)', bg: (color ? color + '15' : 'var(--surface-alt)'), border: color || 'var(--border)' };

    return el('span', {
      className: 'asgard-badge',
      style: { color: p.c, background: variant === 'solid' ? p.bg : 'transparent', border: `1px solid ${p.border}` },
      textContent: text,
    });
  }

  /* ══════════════════════════════════════════════
     5. FILTER PILLS
     ══════════════════════════════════════════════ */
  function FilterPills({ items, onChange }) {
    const wrap = el('div', { className: 'asgard-filter-pills asgard-no-scrollbar' });

    items.forEach(item => {
      const pill = el('button', {
        className: 'asgard-pill' + (item.active ? ' asgard-pill--active' : ''),
        textContent: item.label,
        onClick: () => {
          items.forEach(i => i.active = false);
          item.active = true;
          wrap.querySelectorAll('.asgard-pill').forEach((p, idx) => {
            const isActive = items[idx].active;
            p.className = 'asgard-pill' + (isActive ? ' asgard-pill--active' : '');
          });
          if (onChange) onChange(item.value);
        },
      });
      wrap.appendChild(pill);
    });

    return wrap;
  }


  /* ══════════════════════════════════════════════
     6. STATS
     ══════════════════════════════════════════════ */
  function Stats({ items }) {
    const grid = el('div', {
      className: 'asgard-stats',
    });
    // Force grid layout with !important to prevent desktop CSS overrides
    grid.style.setProperty('display', 'grid', 'important');
    grid.style.setProperty('grid-template-columns', 'repeat(2, 1fr)', 'important');
    grid.style.setProperty('gap', '8px', 'important');
    grid.style.setProperty('padding', '0');

    items.forEach((item, i) => {
      const cell = el('div', {
        className: 'asgard-stat' + (item.href ? ' asgard-stat--link' : ''),
        style: DS.anim(i * 0.05),
      });

      if (item.href) {
        cell.addEventListener('click', () => Router.navigate(item.href));
      }

      if (item.icon) {
        const iconColor = item.color || 'var(--text)';
        const iconWrap = el('div', {
          className: 'asgard-stat__icon',
          style: { color: iconColor, background: `color-mix(in srgb, ${iconColor} 12%, transparent)` },
        });
        if (item.svgIcon) {
          iconWrap.innerHTML = item.svgIcon;
        } else {
          iconWrap.textContent = item.icon;
        }
        cell.appendChild(iconWrap);
      }

      const valEl = el('div', { className: 'asgard-stat__value' });
      if (typeof item.value === 'number') {
        const numSpan = el('span');
        valEl.appendChild(numSpan);
        animateNumber(numSpan, item.value);
      } else {
        valEl.textContent = item.value;
      }
      cell.appendChild(valEl);

      cell.appendChild(el('div', { className: 'asgard-stat__label', textContent: item.label }));

      grid.appendChild(cell);
    });

    return grid;
  }

  /* ══════════════════════════════════════════════
     7. SECTION
     ══════════════════════════════════════════════ */
  function Section({ title, content, collapsible = false, action, collapsed: initCollapsed = false }) {
    const section = el('div', { className: 'asgard-section' });

    const head = el('div', { className: 'asgard-section__head' });

    const titleRow = el('div', {
      className: 'asgard-section__title-row' + (collapsible ? ' asgard-section__title-row--collapsible' : ''),
    });
    titleRow.appendChild(el('span', { className: 'asgard-section__title', textContent: title }));

    let chevron;
    if (collapsible) {
      chevron = el('span', { className: 'asgard-section__chevron', textContent: '▾' });
      titleRow.appendChild(chevron);
    }
    head.appendChild(titleRow);

    if (action) {
      const actionBtn = el('a', { className: 'asgard-section__action', textContent: action.label });
      if (action.href) actionBtn.href = '#' + action.href;
      if (action.onClick) actionBtn.addEventListener('click', action.onClick);
      else if (action.href) actionBtn.addEventListener('click', (e) => { e.preventDefault(); Router.navigate(action.href); });
      head.appendChild(actionBtn);
    }

    section.appendChild(head);

    const body = el('div', { className: 'asgard-section__body' });

    if (content instanceof HTMLElement) body.appendChild(content);
    else if (typeof content === 'string') body.innerHTML = content;

    let isCollapsed = initCollapsed;
    if (collapsible && isCollapsed) {
      body.style.maxHeight = '0';
      body.style.opacity = '0';
      if (chevron) chevron.style.transform = 'rotate(-90deg)';
    } else {
      body.style.maxHeight = 'none';
      body.style.opacity = '1';
    }

    if (collapsible) {
      titleRow.addEventListener('click', () => {
        isCollapsed = !isCollapsed;
        if (isCollapsed) {
          body.style.maxHeight = body.scrollHeight + 'px';
          requestAnimationFrame(() => {
            body.style.maxHeight = '0';
            body.style.opacity = '0';
          });
          if (chevron) chevron.style.transform = 'rotate(-90deg)';
        } else {
          body.style.maxHeight = body.scrollHeight + 'px';
          body.style.opacity = '1';
          if (chevron) chevron.style.transform = 'rotate(0deg)';
          setTimeout(() => { body.style.maxHeight = 'none'; }, 350);
        }
      });
    }

    section.appendChild(body);
    return section;
  }

  /* ══════════════════════════════════════════════
     8. LIST
     ══════════════════════════════════════════════ */
  function List({ items, renderItem, empty, divider = true }) {
    if (!items || items.length === 0) {
      return empty || Empty({});
    }

    const list = el('div', { className: 'asgard-list' });

    items.forEach((item, i) => {
      const rendered = renderItem(item, i);
      if (rendered) {
        list.appendChild(rendered);
        if (divider && i < items.length - 1) {
          list.appendChild(el('div', { className: 'asgard-list-divider' }));
        }
      }
    });

    return list;
  }

  /* ══════════════════════════════════════════════
     9. EMPTY STATE
     ══════════════════════════════════════════════ */
  function Empty({ text, icon, type }) {
    const svgIcons = {
      default: '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="m9 12 2 2 4-4"/></svg>',
      search: '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
      error: '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>',
      mail: '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>',
      bell: '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
      wrench: '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
      clock: '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
      tasks: '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="6" height="6" rx="1"/><path d="m3 17 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/></svg>',
      alert: '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
      construction: '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="8" rx="1"/><path d="M17 14v7"/><path d="M7 14v7"/><path d="M17 3v3"/><path d="M7 3v3"/><path d="M10 14 2.3 6.3"/><path d="m14 6 7.7 7.7"/></svg>',
    };
    // Map emoji icons to SVG keys
    const emojiToSvg = { '⚠️': 'alert', '✅': 'default', '🔧': 'wrench', '🏗️': 'construction', '🏗': 'construction', '✉️': 'mail', '📧': 'mail', '🔔': 'bell', '⏰': 'clock', '🛡️': 'default', '🛡': 'default', 'ᚱ': 'default' };
    const texts = {
      default: 'Нет данных',
      search: 'Ничего не найдено',
      error: 'Ошибка загрузки',
    };

    var svgKey = emojiToSvg[icon] || type || 'default';
    var svgHtml = svgIcons[svgKey] || svgIcons.default;

    var wrapper = el('div', { className: 'asgard-empty', style: DS.anim(0.1) });
    var iconDiv = el('div', { className: 'asgard-empty__icon' });
    iconDiv.innerHTML = svgHtml;
    wrapper.appendChild(iconDiv);
    wrapper.appendChild(el('div', { className: 'asgard-empty__text', textContent: text || texts[type] || texts.default }));
    return wrapper;
  }

  /* ══════════════════════════════════════════════
     10. SKELETON
     ══════════════════════════════════════════════ */
  function Skeleton({ type = 'card', count = 3 }) {
    const wrap = el('div', { className: 'asgard-skeleton' });

    for (let i = 0; i < count; i++) {
      let skel;
      if (type === 'hero') {
        skel = el('div', { className: 'asgard-shimmer', style: { height: '120px', borderRadius: 'var(--r-hero)' } });
      } else if (type === 'stats') {
        const grid = el('div', { className: 'asgard-skeleton-stats' });
        for (let j = 0; j < 4; j++) {
          grid.appendChild(el('div', { className: 'asgard-shimmer', style: { height: '64px', borderRadius: 'var(--r-lg)' } }));
        }
        skel = grid;
      } else if (type === 'list') {
        skel = el('div', { className: 'asgard-skeleton-list' });
        skel.appendChild(el('div', { className: 'asgard-shimmer asgard-skeleton-list__avatar' }));
        const lines = el('div', { className: 'asgard-skeleton-list__lines' });
        lines.appendChild(el('div', { className: 'asgard-shimmer', style: { height: '14px', width: (60 + i * 10) + '%', borderRadius: '4px' } }));
        lines.appendChild(el('div', { className: 'asgard-shimmer', style: { height: '10px', width: (30 + i * 8) + '%', borderRadius: '4px' } }));
        skel.appendChild(lines);
      } else {
        const heights = [78, 64, 52, 72, 60];
        skel = el('div', { className: 'asgard-shimmer', style: { height: heights[i % heights.length] + 'px', borderRadius: 'var(--r-xl)' } });
      }
      wrap.appendChild(skel);
    }

    return wrap;
  }

  function shimmerBlock() {
    return {
      background: 'var(--shimmer-grad, linear-gradient(90deg, #E8E8ED 25%, #F3F4F7 50%, #E8E8ED 75%))',
      backgroundSize: '200% 100%',
      animation: 'asgardShimmer 1.5s infinite ease-in-out',
      borderRadius: '8px',
      minHeight: '10px',
    };
  }

  /* ══════════════════════════════════════════════
     11. TOAST
     ══════════════════════════════════════════════ */
  function Toast({ message, type = 'info', duration = 3000 }) {
    const colors = {
      success: { bg: 'var(--green-bg)', border: 'var(--green-border)', color: 'var(--green)', icon: '✓' },
      error:   { bg: 'var(--red-bg)', border: 'var(--red-border)', color: 'var(--red)', icon: '✕' },
      info:    { bg: 'var(--blue-bg)', border: 'var(--blue-border)', color: 'var(--blue)', icon: 'ℹ' },
    };
    const c = colors[type] || colors.info;

    const toast = el('div', {
      className: 'asgard-toast',
      style: { background: c.bg, border: `1px solid ${c.border}`, color: c.color },
    });

    toast.appendChild(el('span', { className: 'asgard-toast__icon', textContent: c.icon }));
    toast.appendChild(el('span', { className: 'asgard-toast__text', textContent: message }));
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');

    // Swipe up to dismiss
    let startY = 0;
    toast.addEventListener('touchstart', (e) => { startY = e.touches[0].clientY; }, { passive: true });
    toast.addEventListener('touchmove', (e) => {
      const dy = e.touches[0].clientY - startY;
      if (dy < 0) toast.style.transform = `translateY(${dy}px)`;
    }, { passive: true });
    toast.addEventListener('touchend', (e) => {
      if (parseInt(toast.style.transform.replace(/[^\d-]/g, '')) < -30) {
        dismiss();
      } else {
        toast.style.transform = '';
      }
    }, { passive: true });

    document.body.appendChild(toast);

    const timer = setTimeout(dismiss, duration);

    function dismiss() {
      clearTimeout(timer);
      toast.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
      toast.style.transform = 'translateY(-100%)';
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }

    return toast;
  }

  /* ══════════════════════════════════════════════
     12. BOTTOM SHEET
     ══════════════════════════════════════════════ */
  function BottomSheet({ title, content, fullscreen = false, onClose }) {
    const overlay = el('div', { className: 'asgard-sheet-overlay' });
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    const sheet = el('div', {
      className: 'asgard-sheet',
      style: { maxHeight: fullscreen ? '95vh' : '70vh' },
    });

    // Drag handle
    const handle = el('div', { className: 'asgard-sheet__handle' });
    handle.appendChild(el('div', { className: 'asgard-sheet__handle-bar' }));
    sheet.appendChild(handle);

    // Title
    if (title) {
      const titleBar = el('div', { className: 'asgard-sheet__title-bar' });
      titleBar.appendChild(el('div', { className: 'asgard-sheet__title', textContent: title }));
      const closeBtn = el('button', { className: 'asgard-sheet__close', textContent: '✕', onClick: close });
      closeBtn.setAttribute('aria-label', 'Закрыть');
      titleBar.appendChild(closeBtn);
      sheet.appendChild(titleBar);
    }

    // Content
    const body = el('div', { className: 'asgard-sheet-body' });
    if (content instanceof HTMLElement) body.appendChild(content);
    else if (typeof content === 'string') body.innerHTML = content;
    sheet.appendChild(body);

    // Swipe down to close
    let dragStartY = 0;
    let dragging = false;
    handle.addEventListener('touchstart', (e) => { dragStartY = e.touches[0].clientY; dragging = true; }, { passive: true });
    handle.addEventListener('touchmove', (e) => {
      if (!dragging) return;
      const dy = e.touches[0].clientY - dragStartY;
      if (dy > 0) sheet.style.transform = `translateY(${dy}px)`;
    }, { passive: true });
    handle.addEventListener('touchend', () => {
      if (!dragging) return;
      dragging = false;
      const match = sheet.style.transform?.match(/translateY\(([+-]?\d+)/);
      const ty = match ? parseInt(match[1]) : 0;
      if (ty > 100) close();
      else { sheet.style.transition = 'transform 0.3s ease'; sheet.style.transform = ''; setTimeout(() => sheet.style.transition = '', 300); }
    }, { passive: true });

    overlay.addEventListener('click', close);

    Utils.lockScroll();
    document.body.appendChild(overlay);
    document.body.appendChild(sheet);

    // Lifecycle: зарегистрировать в стеке открытых модалок
    if (typeof _asgardOpenModals !== 'undefined') {
      _asgardOpenModals.push(overlay, sheet);
    }

    function close() {
      sheet.style.transition = 'transform 0.3s ease';
      sheet.style.transform = 'translateY(100%)';
      overlay.style.transition = 'opacity 0.3s ease';
      overlay.style.opacity = '0';
      setTimeout(() => {
        overlay.remove();
        sheet.remove();
        Utils.unlockScroll();
        // Lifecycle: убрать из стека
        if (typeof _asgardOpenModals !== 'undefined') {
          _asgardOpenModals = _asgardOpenModals.filter(function(el) { return el !== overlay && el !== sheet; });
        }
        if (onClose) onClose();
      }, 300);
    }

    return { close, sheet, body };
  }

  /* ══════════════════════════════════════════════
     13. CONFIRM DIALOG
     ══════════════════════════════════════════════ */
  function Confirm({ title, message, okText = 'Подтвердить', cancelText = 'Отмена', danger = false }) {
    return new Promise((resolve) => {
      const overlay = el('div', { className: 'asgard-confirm-overlay' });
      overlay.setAttribute('role', 'alertdialog');
      overlay.setAttribute('aria-modal', 'true');

      const dialog = el('div', {
        className: 'asgard-confirm-dialog',
        style: DS.animPop(0),
      });

      if (title) {
        const titleRow = el('div', { className: 'asgard-confirm-title-row' });
        if (danger) titleRow.appendChild(el('span', { textContent: '⚠️' }));
        titleRow.appendChild(el('div', {
          style: { color: danger ? 'var(--red)' : 'var(--text)' },
          textContent: title,
        }));
        dialog.appendChild(titleRow);
      }

      if (message) dialog.appendChild(el('div', {
        className: 'asgard-confirm-message',
        textContent: message,
      }));

      const btns = el('div', { className: 'asgard-confirm-btns' });

      function dismiss(result) {
        overlay.remove();
        Utils.unlockScroll();
        resolve(result);
      }

      btns.appendChild(el('button', {
        className: 'asgard-confirm-cancel',
        textContent: cancelText,
        onClick: () => dismiss(false),
      }));

      btns.appendChild(el('button', {
        className: 'asgard-confirm-ok',
        style: { background: danger ? 'var(--red)' : 'var(--blue)' },
        textContent: okText,
        onClick: () => dismiss(true),
      }));

      dialog.appendChild(btns);
      overlay.appendChild(dialog);
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) dismiss(false);
      });
      Utils.lockScroll();
      document.body.appendChild(overlay);
    });
  }

  /* ══════════════════════════════════════════════
     14. FAB (Floating Action Button)
     ══════════════════════════════════════════════ */
  function FAB({ icon, onClick, gradient = true, pulse = true }) {
    const fab = el('button', {
      className: 'asgard-fab' + (gradient ? ' asgard-fab--gradient' : ' asgard-fab--outline'),
      style: !pulse ? { animation: 'none' } : undefined,
      onClick,
    });
    fab.innerHTML = icon || '+';

    fab.addEventListener('touchstart', () => fab.style.transform = 'scale(0.9)', { passive: true });
    fab.addEventListener('touchend', () => fab.style.transform = '', { passive: true });

    return fab;
  }

  /* ══════════════════════════════════════════════
     15. TABLE PAGE (универсальная страница-список)
     ══════════════════════════════════════════════ */
  function TablePage({ title, subtitle, items = [], renderItem, search = false, filter, chart, empty, loadMore, stats, fab: fabConfig, onRefresh, back = true, backHref, actions: headerActions }) {
    const page = el('div', { className: 'asgard-table-page' });
    let filteredItems = [...items];
    let searchQuery = '';
    let currentFilter = null;
    let listContainer;
    let loading = false;

    // Header
    page.appendChild(Header({ title, subtitle, back, backHref, actions: headerActions }));

    // Search
    if (search) {
      const searchBar = SearchBar({
        placeholder: 'Поиск...',
        sticky: true,
        onSearch: (q) => {
          searchQuery = q.toLowerCase();
          rerender();
        },
      });
      page.appendChild(searchBar);
    }

    // Filter
    if (filter && filter.pills) {
      page.appendChild(FilterPills({
        items: filter.pills,
        onChange: (val) => {
          currentFilter = val;
          rerender();
        },
      }));
    }

    // Stats
    if (stats) {
      const statsWrap = el('div', { className: 'asgard-table-page__stats' });
      statsWrap.appendChild(Stats({ items: stats }));
      page.appendChild(statsWrap);
    }

    // Chart
    if (chart) {
      const chartSection = Section({
        title: chart.title || 'Динамика',
        collapsible: true,
        content: chart.type === 'bar' ? BarChart({ data: chart.data, opts: chart.opts }) : MiniChart({ data: chart.data, opts: chart.opts }),
      });
      page.appendChild(chartSection);
    }

    // List
    listContainer = el('div', { className: 'asgard-table-page__list' });
    page.appendChild(listContainer);

    // FAB
    if (fabConfig) {
      page.appendChild(FAB(fabConfig));
    }

    // Refresh handler
    if (onRefresh) {
      const refreshHandler = async () => {
        loading = true;
        renderList([]);
        listContainer.appendChild(Skeleton({ type: 'card', count: 5 }));
        try {
          const newItems = await onRefresh();
          if (newItems) {
            items.length = 0;
            items.push(...newItems);
            filteredItems = [...items];
          }
        } catch (e) { console.error(e); }
        loading = false;
        rerender();
      };
      window.addEventListener('asgard:refresh', refreshHandler);
    }

    // Initial render
    rerender();

    function getFiltered() {
      let result = [...items];
      if (searchQuery) {
        result = result.filter(item => {
          const text = JSON.stringify(item).toLowerCase();
          return text.includes(searchQuery);
        });
      }
      if (currentFilter && filter && filter.filterFn) {
        result = result.filter(item => filter.filterFn(item, currentFilter));
      }
      return result;
    }

    function rerender() {
      filteredItems = getFiltered();
      renderList(filteredItems);
    }

    function renderList(data) {
      listContainer.innerHTML = '';
      if (loading) {
        listContainer.appendChild(Skeleton({ type: 'card', count: 5 }));
        return;
      }
      if (!data.length) {
        listContainer.appendChild(empty || Empty({ type: searchQuery ? 'search' : 'default' }));
        return;
      }

      const listEl = el('div', { className: 'asgard-table-page__items' });

      // Virtual scroll for large lists
      if (data.length > 50) {
        renderVirtualList(listEl, data);
      } else {
        data.forEach((item, i) => {
          const rendered = renderItem(item, i);
          if (rendered) listEl.appendChild(rendered);
        });
      }

      listContainer.appendChild(listEl);

      // Load more
      if (loadMore && data.length >= 20) {
        const content = Layout.getContentZone();
        if (content) {
          Utils.infiniteScroll(content, async () => {
            const more = await loadMore();
            if (more && more.length) {
              items.push(...more);
              rerender();
            }
          });
        }
      }
    }

    function renderVirtualList(container, data) {
      const ITEM_HEIGHT = 84; // Approximate
      const BUFFER = 5;
      const totalHeight = data.length * ITEM_HEIGHT;
      const scrollParent = Layout.getContentZone();

      container.style.position = 'relative';
      container.style.height = totalHeight + 'px';

      let lastStart = -1;
      const rendered = new Map();

      function updateVisible() {
        if (!scrollParent) return;
        const scrollTop = scrollParent.scrollTop;
        const viewHeight = scrollParent.clientHeight;
        const start = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - BUFFER);
        const end = Math.min(data.length, Math.ceil((scrollTop + viewHeight) / ITEM_HEIGHT) + BUFFER);

        if (start === lastStart) return;
        lastStart = start;

        // Remove out-of-view items
        for (const [idx, el] of rendered) {
          if (idx < start || idx >= end) {
            el.remove();
            rendered.delete(idx);
          }
        }

        // Add visible items
        for (let i = start; i < end; i++) {
          if (!rendered.has(i)) {
            const item = renderItem(data[i], i);
            if (item) {
              item.style.position = 'absolute';
              item.style.top = (i * ITEM_HEIGHT) + 'px';
              item.style.left = '0';
              item.style.right = '0';
              container.appendChild(item);
              rendered.set(i, item);
            }
          }
        }
      }

      if (scrollParent) {
        scrollParent.addEventListener('scroll', Utils.throttle(updateVisible, 50), { passive: true });
      }
      updateVisible();
    }

    // Public API
    page.setItems = (newItems) => {
      items.length = 0;
      items.push(...newItems);
      rerender();
    };
    page.setLoading = (v) => { loading = v; rerender(); };

    return page;
  }

  /* ══════════════════════════════════════════════
     16. BAR CHART
     ══════════════════════════════════════════════ */
  function BarChart({ data, opts = {} }) {
    const { height = 130, color, dual = false } = opts;
    const maxVal = Math.max(...data.map(d => dual ? Math.max(d.value, d.value2 || 0) : d.value), 1);

    function showTooltip(chartEl, parent, value) {
      const existing = chartEl.querySelector('.asgard-bar-tooltip');
      if (existing) existing.remove();
      const tooltip = el('div', {
        className: 'asgard-bar-tooltip',
        style: DS.animPop(0),
        textContent: typeof value === 'number' ? Utils.formatNumber(value) : value,
      });
      parent.appendChild(tooltip);
      setTimeout(() => tooltip.remove(), 2000);
    }

    const chart = el('div', {
      className: 'asgard-bar-chart' + (dual ? ' asgard-bar-chart--dual' : ''),
      style: Object.assign({ height: height + 'px' }, DS.anim(0.1)),
    });

    data.forEach((d, i) => {
      const group = el('div', { className: 'asgard-bar-group' });

      if (dual) {
        const barWrap = el('div', { className: 'asgard-bar-dual-wrap' });

        // Bar 1
        const h1 = ((d.value / maxVal) * (height - 30)) + 'px';
        const bar1 = el('div', {
          className: 'asgard-bar asgard-bar--dual',
          style: {
            background: `linear-gradient(to top, ${color || 'var(--blue)'}, ${color || 'var(--blue-bright)'})`,
            transition: `height 0.5s cubic-bezier(.34,1.56,.64,1) ${i * 0.05}s`,
          },
        });
        bar1.addEventListener('click', () => {
          showTooltip(chart, bar1, d.value);
        });
        barWrap.appendChild(bar1);

        // Bar 2
        const h2 = (((d.value2 || 0) / maxVal) * (height - 30)) + 'px';
        const bar2 = el('div', {
          className: 'asgard-bar asgard-bar--dual',
          style: {
            background: 'linear-gradient(to top, var(--red), var(--red-bright))',
            transition: `height 0.5s cubic-bezier(.34,1.56,.64,1) ${i * 0.05 + 0.05}s`,
          },
        });
        bar2.addEventListener('click', () => {
          showTooltip(chart, bar2, d.value2 || 0);
        });
        barWrap.appendChild(bar2);

        group.appendChild(barWrap);

        // Animate
        setTimeout(() => {
          barWrap.children[0].style.height = h1;
          barWrap.children[1].style.height = h2;
        }, 50);
      } else {
        const h = ((d.value / maxVal) * (height - 30)) + 'px';
        const bar = el('div', {
          className: 'asgard-bar asgard-bar--single',
          style: {
            background: color ? `linear-gradient(to top, ${color}, ${color})` : 'linear-gradient(to top, var(--blue), var(--red-bright))',
            transition: `height 0.5s cubic-bezier(.34,1.56,.64,1) ${i * 0.05}s`,
          },
        });

        // Tooltip
        bar.addEventListener('click', () => {
          showTooltip(chart, bar, d.value);
        });

        group.appendChild(bar);
        setTimeout(() => { bar.style.height = h; }, 50);
      }

      // Label
      const labelEl = el('div', {
        className: 'asgard-bar-label' + (dual ? ' asgard-bar-label--dual' : ''),
        textContent: d.label,
      });
      if (i % 2 === 1) labelEl.dataset.even = '';
      group.appendChild(labelEl);

      chart.appendChild(group);
    });

    return chart;
  }

  /* ══════════════════════════════════════════════
     17. MINI CHART (Sparkline)
     ══════════════════════════════════════════════ */
  function MiniChart({ data, opts = {} }) {
    const { color = 'var(--red)', height = 36 } = opts;
    if (!data || data.length < 2) return el('div');

    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;
    const w = 200;
    const h = height;

    const points = data.map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 4) - 2;
      return { x, y };
    });

    // Smooth cubic bezier path
    let path = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const cpx1 = prev.x + (curr.x - prev.x) / 3;
      const cpx2 = prev.x + (curr.x - prev.x) * 2 / 3;
      path += ` C ${cpx1} ${prev.y} ${cpx2} ${curr.y} ${curr.x} ${curr.y}`;
    }

    const areaPath = path + ` L ${w} ${h} L 0 ${h} Z`;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', h);
    svg.style.display = 'block';

    const gradId = 'mcgrad' + Math.random().toString(36).substr(2, 6);
    svg.innerHTML = `
      <defs>
        <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.3"/>
          <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="${areaPath}" fill="url(#${gradId})" />
      <path d="${path}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>
    `;

    return svg;
  }

  /* ══════════════════════════════════════════════
     18. BIG NUMBER
     ══════════════════════════════════════════════ */
  function BigNumber({ value, label, prefix = '', suffix = '', color, icon, trend }) {
    const wrap = el('div', {
      className: 'asgard-big-num',
      style: DS.anim(0.05),
    });

    const row = el('div', { className: 'asgard-big-num__row' });

    if (icon) row.appendChild(el('span', { textContent: icon }));

    if (prefix) row.appendChild(el('span', { style: { ...DS.font('xl'), color: color || 'var(--text)' }, textContent: prefix }));

    const numEl = el('span', { style: { ...DS.font('hero'), color: color || 'var(--text)' } });
    const numSpan = el('span');
    numEl.appendChild(numSpan);
    animateNumber(numSpan, value);
    row.appendChild(numEl);

    if (suffix) row.appendChild(el('span', { style: { ...DS.font('xl'), color: color || 'var(--text)' }, textContent: suffix }));

    if (trend) {
      const trendColor = trend.up ? 'var(--green)' : 'var(--red)';
      row.appendChild(el('span', {
        style: { ...DS.font('sm'), color: trendColor, fontWeight: 600, marginLeft: '6px' },
        textContent: (trend.up ? '↑' : '↓') + ' ' + trend.value,
      }));
    }

    wrap.appendChild(row);

    if (label) wrap.appendChild(el('div', { className: 'asgard-big-num__label', textContent: label }));

    return wrap;
  }

  /* ══════════════════════════════════════════════
     19. FORM
     ══════════════════════════════════════════════ */
  function Form({ fields, onSubmit, submitLabel = 'Сохранить' }) {
    const form = el('form', {
      className: 'asgard-form',
      onSubmit: (e) => {
        e.preventDefault();
        // Двойной тап защита
        var submitBtn = form.querySelector('[type="submit"], button:last-of-type');
        if (submitBtn && submitBtn._busy) return;
        const data = {};
        let valid = true;
        fields.forEach(f => {
          const input = form.querySelector(`[name="${f.id}"]`);
          if (!input) return;
          const val = f.type === 'toggle' ? input.checked : input.value;
          if (f.required && !val) {
            valid = false;
            showFieldError(input, 'Обязательное поле');
          }
          data[f.id] = val;
        });
        if (valid && onSubmit) {
          if (submitBtn) {
            submitBtn._busy = true;
            submitBtn.style.opacity = '0.5';
            submitBtn.style.pointerEvents = 'none';
          }
          Promise.resolve(onSubmit(data)).finally(function() {
            if (submitBtn) {
              submitBtn._busy = false;
              submitBtn.style.opacity = '1';
              submitBtn.style.pointerEvents = 'auto';
            }
          });
        }
      },
    });

    let currentSection = null;

    fields.forEach((f, i) => {
      // Section heading
      if (f.section && f.section !== currentSection) {
        currentSection = f.section;
        form.appendChild(el('div', {
          className: 'asgard-form__section-heading' + (i > 0 ? ' asgard-form__section-heading--spaced' : ''),
          textContent: f.section,
        }));
      }

      const group = el('div', { className: 'asgard-form__group' });

      if (f.type === 'toggle') {
        // Toggle row
        const row = el('div', { className: 'asgard-form__toggle-row' });
        row.appendChild(el('label', { className: 'asgard-form__toggle-label', textContent: f.label }));

        const toggleWrap = el('div', {
          className: 'asgard-form__toggle-wrap',
          style: { background: f.value ? 'var(--red)' : 'var(--surface-alt)' },
        });
        const toggleThumb = el('span', {
          className: 'asgard-form__toggle-thumb',
          style: { left: f.value ? '22px' : '2px' },
        });
        toggleWrap.appendChild(toggleThumb);
        const toggle = el('input', {
          type: 'checkbox',
          name: f.id,
          className: 'asgard-form__toggle-input',
        });
        if (f.value) toggle.checked = true;
        toggle.addEventListener('change', () => {
          toggleWrap.style.background = toggle.checked ? 'var(--red)' : 'var(--surface-alt)';
          toggleThumb.style.left = toggle.checked ? '22px' : '2px';
        });
        toggleWrap.appendChild(toggle);
        row.appendChild(toggleWrap);
        group.appendChild(row);
      } else if (f.type === 'select') {
        // Select
        group.appendChild(el('label', { className: 'asgard-form__label', textContent: f.label }));

        const select = el('select', {
          name: f.id,
          className: 'asgard-form__input asgard-form__select',
        });
        if (f.placeholder) {
          select.appendChild(el('option', { value: '', textContent: f.placeholder, disabled: true, selected: !f.value }));
        }
        (f.options || []).forEach(opt => {
          const option = el('option', { value: opt.value || opt, textContent: opt.label || opt });
          if (f.value === (opt.value || opt)) option.selected = true;
          select.appendChild(option);
        });
        group.appendChild(select);
      } else if (f.type === 'textarea') {
        group.appendChild(el('label', { className: 'asgard-form__label', textContent: f.label }));
        group.appendChild(el('textarea', {
          name: f.id,
          placeholder: f.placeholder || '',
          className: 'asgard-form__input asgard-form__textarea',
          textContent: f.value || '',
        }));
      } else {
        // Standard input with floating label
        const inputWrap = el('div', { className: 'asgard-form__input-wrap' });

        const input = el('input', {
          type: f.type || 'text',
          name: f.id,
          placeholder: ' ',
          value: f.value || '',
          className: 'asgard-form__input asgard-form__input--floating',
        });
        if (f.required) {
          input.required = true;
          input.setAttribute('aria-required', 'true');
        }

        const label = el('label', {
          className: 'asgard-form__float-label',
          textContent: f.label,
        });

        // Float label on focus/filled
        const floatLabel = () => {
          const filled = input.value || document.activeElement === input;
          if (filled) {
            label.style.top = '6px';
            label.style.fontSize = '10px';
            label.style.fontWeight = '500';
            label.style.color = document.activeElement === input ? 'var(--red)' : 'var(--text-sec)';
            label.style.letterSpacing = '0.3px';
          } else {
            label.style.top = '15px';
            label.style.fontSize = '14px';
            label.style.fontWeight = '400';
            label.style.color = 'var(--text-ter)';
            label.style.letterSpacing = '0';
          }
        };
        input.addEventListener('focus', () => {
          input.style.borderColor = 'var(--red)';
          input.style.boxShadow = '0 0 0 3px var(--red-bg)';
          floatLabel();
        });
        input.addEventListener('blur', () => {
          input.style.borderColor = 'var(--border)';
          input.style.boxShadow = 'none';
          floatLabel();
        });
        input.addEventListener('input', floatLabel);

        inputWrap.appendChild(input);
        inputWrap.appendChild(label);
        group.appendChild(inputWrap);

        // Initial float check
        if (f.value) setTimeout(floatLabel, 0);
      }

      // Error placeholder
      group.appendChild(el('div', { className: 'asgard-form__error' }));

      form.appendChild(group);
    });

    // Submit button
    form.appendChild(FullWidthBtn({ label: submitLabel, onClick: () => form.dispatchEvent(new Event('submit')) }));

    return form;
  }


  function showFieldError(input, msg) {
    input.style.borderColor = 'var(--red)';
    input.style.animation = 'asgardShake 0.3s ease';
    input.setAttribute('aria-invalid', 'true');
    const group = input.closest('.asgard-form__group');
    if (group) {
      const err = group.querySelector('.asgard-form__error');
      if (err) { err.textContent = msg; err.style.display = 'block'; }
    }
    setTimeout(() => { input.style.animation = ''; }, 300);
    input.addEventListener('input', () => {
      input.style.borderColor = 'var(--border)';
      input.removeAttribute('aria-invalid');
      if (group) {
        const err = group.querySelector('.asgard-form__error');
        if (err) err.style.display = 'none';
      }
    }, { once: true });
  }

  /* ══════════════════════════════════════════════
     20. FULL WIDTH BUTTON
     ══════════════════════════════════════════════ */
  function FullWidthBtn({ label, onClick, href, icon, variant = 'primary', loading: isLoading = false }) {
    const btn = el('button', {
      className: 'asgard-btn-full asgard-btn-full--' + (variant || 'primary'),
    });
    // keep v for setLoading restore
    const variants = {
      primary: { background: 'var(--hero-grad)', color: '#fff', border: 'none' },
      secondary: { background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)' },
      danger: { background: 'var(--red)', color: '#fff', border: 'none' },
      ghost: { background: 'transparent', color: 'var(--blue)', border: 'none', textDecoration: 'underline' },
    };
    const v = variants[variant] || variants.primary;

    if (icon) btn.innerHTML = icon + ' ';
    btn.appendChild(document.createTextNode(label));

    // Ripple effect
    btn.addEventListener('click', (e) => {
      const ripple = el('span', {
        className: 'asgard-btn-ripple',
        style: { left: (e.offsetX - 10) + 'px', top: (e.offsetY - 10) + 'px' },
      });
      btn.appendChild(ripple);
      setTimeout(() => ripple.remove(), 500);

      if (onClick) onClick();
      else if (href) Router.navigate(href);
    });

    btn.addEventListener('touchstart', () => btn.style.transform = 'scale(0.98)', { passive: true });
    btn.addEventListener('touchend', () => btn.style.transform = '', { passive: true });

    // Loading state — keeps gradient background
    btn.setLoading = (loading) => {
      if (loading) {
        btn._text = btn.innerHTML;
        btn._bg = btn.style.background;
        btn.innerHTML = '<div style="width:20px;height:20px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:asgardSpin 0.8s linear infinite"></div>';
        btn.disabled = true;
        btn.style.opacity = '0.85';
        // Force keep gradient — some browsers reset bg on disabled
        btn.style.setProperty('background', btn._bg, 'important');
      } else {
        btn.innerHTML = btn._text || label;
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.style.setProperty('background', btn._bg || v.background);
      }
    };

    if (isLoading) btn.setLoading(true);

    return btn;
  }

  /* ══════════════════════════════════════════════
     21. DETAIL FIELDS
     ══════════════════════════════════════════════ */
  function DetailFields({ fields }) {
    const wrap = el('div', { className: 'asgard-detail-fields' });

    fields.forEach((f, i) => {
      const row = el('div', {
        className: 'asgard-detail-row',
        style: DS.anim(i * 0.03),
      });

      row.appendChild(el('div', { className: 'asgard-detail-row__label', textContent: f.label }));

      const valWrap = el('div', { className: 'asgard-detail-row__val' });

      if (f.type === 'badge') {
        valWrap.appendChild(Badge({ text: f.value, color: f.badgeColor || 'neutral' }));
      } else if (f.type === 'progress') {
        valWrap.appendChild(ProgressBar({ value: f.value, max: f.max || 100, label: f.value + '%' }));
      } else if (f.type === 'phone' || f.type === 'email') {
        valWrap.appendChild(el('a', {
          className: 'asgard-detail-row__link',
          href: f.type === 'phone' ? 'tel:' + f.value : 'mailto:' + f.value,
          textContent: f.value,
        }));
      } else if (f.type === 'link') {
        const link = el('a', { className: 'asgard-detail-row__link', textContent: f.value });
        if (f.href) link.addEventListener('click', () => Router.navigate(f.href));
        valWrap.appendChild(link);
      } else {
        valWrap.appendChild(el('span', {
          className: 'asgard-detail-row__val-text',
          textContent: f.value || '—',
        }));
      }

      if (f.copy) {
        const copyBtn = el('button', {
          className: 'asgard-detail-row__copy',
          textContent: '📋',
          onClick: () => {
            navigator.clipboard.writeText(f.value).then(() => {
              Toast({ message: 'Скопировано', type: 'success', duration: 1500 });
            });
          },
        });
        valWrap.appendChild(copyBtn);
      }

      row.appendChild(valWrap);
      wrap.appendChild(row);
    });

    return wrap;
  }

  /* ══════════════════════════════════════════════
     22. PROGRESS BAR
     ══════════════════════════════════════════════ */
  function ProgressBar({ value, max = 100, color, label }) {
    const pct = Math.min(100, Math.max(0, (value / max) * 100));

    const wrap = el('div', { className: 'asgard-progress' });

    const track = el('div', { className: 'asgard-progress__track' });

    const bar = el('div', {
      className: 'asgard-progress__bar',
      style: {
        background: color || (pct >= 75 ? 'var(--green)' : pct >= 50 ? 'var(--gold)' : pct >= 25 ? 'var(--orange)' : 'var(--red)'),
      },
    });
    track.appendChild(bar);
    wrap.appendChild(track);

    setTimeout(() => { bar.style.width = pct + '%'; }, 50);

    if (label) wrap.appendChild(el('span', { className: 'asgard-progress__label', textContent: label }));

    return wrap;
  }

  /* ══════════════════════════════════════════════
     23. TABS (внутренние)
     ══════════════════════════════════════════════ */
  function Tabs({ items, active, onChange }) {
    const wrap = el('div', { className: 'asgard-tabs asgard-no-scrollbar' });
    const indicator = el('div', { className: 'asgard-tabs__indicator' });

    items.forEach((item, i) => {
      const tab = el('button', {
        className: 'asgard-tab' + (item.value === active ? ' asgard-tab--active' : ''),
        textContent: item.label,
        onClick: () => {
          active = item.value;
          wrap.querySelectorAll('.asgard-tab').forEach((t, idx) => {
            const isActive = items[idx].value === active;
            t.className = 'asgard-tab' + (isActive ? ' asgard-tab--active' : '');
          });
          updateIndicator();
          if (onChange) onChange(item.value);
        },
      });
      wrap.appendChild(tab);
    });

    wrap.appendChild(indicator);

    function updateIndicator() {
      const activeTab = wrap.querySelector('.asgard-tab--active');
      if (activeTab) {
        indicator.style.left = activeTab.offsetLeft + 'px';
        indicator.style.width = activeTab.offsetWidth + 'px';
      }
    }

    setTimeout(updateIndicator, 0);
    return wrap;
  }

  /* ══════════════════════════════════════════════
     24. QUICK ACTIONS
     ══════════════════════════════════════════════ */
  function QuickActions({ items }) {
    const wrap = el('div', { className: 'asgard-quick-actions asgard-no-scrollbar' });

    items.forEach((item, i) => {
      const pill = el('button', {
        className: 'asgard-quick-action',
        style: DS.anim(i * 0.05),
        onClick: () => {
          if (item.onClick) item.onClick();
          else if (item.href) Router.navigate(item.href);
        },
      });

      if (item.icon) pill.appendChild(el('span', { textContent: item.icon }));
      pill.appendChild(el('span', { textContent: item.label }));

      pill.addEventListener('touchstart', () => pill.style.transform = 'scale(0.96)', { passive: true });
      pill.addEventListener('touchend', () => pill.style.transform = '', { passive: true });

      wrap.appendChild(pill);
    });

    return wrap;
  }

  /* ══════════════════════════════════════════════
     25. MIMIR BANNER
     ══════════════════════════════════════════════ */
  function MimirBanner({ title, text, icon = '⚡' }) {
    return el('div', {
      className: 'asgard-mimir-banner',
      style: DS.anim(0.1),
    }, [
      el('span', { className: 'asgard-mimir-banner__icon', textContent: icon }),
      el('div', { className: 'asgard-mimir-banner__body' }, [
        el('div', { className: 'asgard-mimir-banner__title', textContent: title || 'Мимир подсказывает' }),
        el('div', { className: 'asgard-mimir-banner__text', textContent: text }),
      ]),
    ]);
  }

  /* ══════════════════════════════════════════════
     26. SEARCH BAR
     ══════════════════════════════════════════════ */
  function SearchBar({ placeholder = 'Поиск...', onSearch, sticky = false, autoFocus = false }) {
    const wrap = el('div', {
      className: 'asgard-search' + (sticky ? ' asgard-search--sticky' : ''),
    });
    wrap.setAttribute('role', 'search');

    const inner = el('div', { className: 'asgard-search__inner' });

    inner.appendChild(el('span', {
      className: 'asgard-search__icon',
      innerHTML: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>',
    }));

    const input = el('input', {
      type: 'search',
      placeholder,
      className: 'asgard-search__input',
    });

    const clearBtn = el('button', {
      className: 'asgard-search__clear',
      textContent: '✕',
      onClick: () => {
        input.value = '';
        clearBtn.style.display = 'none';
        if (onSearch) onSearch('');
        input.focus();
      },
    });

    const debouncedSearch = Utils.debounce((q) => {
      if (onSearch) onSearch(q);
    }, 300);

    input.addEventListener('input', () => {
      clearBtn.style.display = input.value ? 'block' : 'none';
      debouncedSearch(input.value);
    });

    inner.appendChild(input);
    inner.appendChild(clearBtn);
    wrap.appendChild(inner);

    if (autoFocus) setTimeout(() => input.focus(), 100);

    return wrap;
  }

  /* ══════════════════════════════════════════════
     27. ACTION SHEET (iOS-стиль меню действий)
     ══════════════════════════════════════════════ */
  function ActionSheet({ title, actions = [], cancelText = 'Отмена', onClose }) {
    const overlay = el('div', { className: 'asgard-action-sheet-overlay' });
    const sheet = el('div', { className: 'asgard-action-sheet' });
    const group = el('div', { className: 'asgard-action-sheet__group' });

    if (title) {
      group.appendChild(el('div', { className: 'asgard-action-sheet__title', textContent: title }));
    }

    actions.forEach((action, i) => {
      const btn = el('button', {
        className: 'asgard-action-sheet__btn' + (action.danger ? ' asgard-action-sheet__btn--danger' : ''),
        onClick: () => { close(); if (action.onClick) action.onClick(); },
      });
      if (action.icon) btn.appendChild(el('span', { textContent: action.icon }));
      btn.appendChild(document.createTextNode(action.label));
      group.appendChild(btn);
    });
    sheet.appendChild(group);

    const cancelBtn = el('button', {
      className: 'asgard-action-sheet__cancel',
      textContent: cancelText,
      onClick: close,
    });
    sheet.appendChild(cancelBtn);

    overlay.appendChild(sheet);
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    Utils.lockScroll();
    document.body.appendChild(overlay);

    function close() {
      sheet.style.animation = 'asgardSlideSheetDown 0.25s ease forwards';
      overlay.style.animation = 'asgardFadeOut 0.25s ease forwards';
      setTimeout(() => { overlay.remove(); Utils.unlockScroll(); if (onClose) onClose(); }, 250);
    }

    return overlay;
  }

  /* ══════════════════════════════════════════════
     28. DATE PICKER
     ══════════════════════════════════════════════ */
  function DatePicker({ value, label, onChange, min, max }) {
    const wrap = el('div', { className: 'asgard-datepicker' });

    if (label) {
      wrap.appendChild(el('div', { className: 'asgard-datepicker__label', textContent: label }));
    }

    const display = el('div', { className: 'asgard-datepicker__display' });

    const dateText = el('span', {
      className: 'asgard-datepicker__text' + (value ? '' : ' asgard-datepicker__text--placeholder'),
      textContent: value ? formatDate(value) : 'Выберите дату',
    });
    display.appendChild(dateText);

    display.appendChild(el('span', {
      className: 'asgard-datepicker__icon',
      innerHTML: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    }));

    const input = el('input', {
      type: 'date',
      value: value || '',
      className: 'asgard-datepicker__input',
    });
    if (min) input.min = min;
    if (max) input.max = max;

    input.addEventListener('change', () => {
      dateText.textContent = input.value ? formatDate(input.value) : 'Выберите дату';
      dateText.className = 'asgard-datepicker__text' + (input.value ? '' : ' asgard-datepicker__text--placeholder');
      if (onChange) onChange(input.value);
    });

    wrap.appendChild(display);
    wrap.appendChild(input);
    return wrap;
  }

  function formatDate(dateStr) {
    try {
      const d = new Date(dateStr + 'T00:00:00');
      return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch { return dateStr; }
  }

  /* ══════════════════════════════════════════════
     29. AVATAR
     ══════════════════════════════════════════════ */
  function Avatar({ name, src, size = 40, status, onClick }) {
    const colors = [DS.t.red, DS.t.blue, DS.t.green, DS.t.orange, DS.t.gold, '#A855F7', '#14B8A6'];
    const initials = (name || '?').split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
    const colorIdx = (name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0) % colors.length;

    const wrap = el('div', {
      className: 'asgard-avatar',
      style: {
        width: size + 'px', height: size + 'px',
        cursor: onClick ? 'pointer' : 'default',
      },
    });
    if (onClick) wrap.addEventListener('click', onClick);

    if (src) {
      wrap.appendChild(el('img', { src }));
    } else {
      Object.assign(wrap.style, {
        background: `linear-gradient(135deg, ${colors[colorIdx]}, ${colors[(colorIdx + 2) % colors.length]})`,
        color: '#fff', fontSize: Math.round(size * 0.38) + 'px',
      });
      wrap.textContent = initials;
    }

    if (status) {
      const dot = el('div', {
        className: 'asgard-avatar__status asgard-avatar__status--' + status,
        style: {
          width: Math.round(size * 0.28) + 'px',
          height: Math.round(size * 0.28) + 'px',
        },
      });
      wrap.appendChild(dot);
    }

    return wrap;
  }

  /* ══════════════════════════════════════════════
     30. NOTIFICATION CARD
     ══════════════════════════════════════════════ */
  function NotificationCard({ icon, title, text, time, read = false, type = 'info', onClick }) {
    const typeIcons = { info: 'ℹ️', success: '✅', warning: '⚠️', danger: '🚨', task: '📋', chat: '💬', money: '💰' };
    const iconText = icon || typeIcons[type] || typeIcons.info;

    const card = el('div', {
      className: 'asgard-notif' + (read ? ' asgard-notif--read' : ' asgard-notif--unread') + (onClick ? ' asgard-notif--link' : ''),
    });
    if (onClick) card.addEventListener('click', onClick);

    card.appendChild(el('div', { className: 'asgard-notif__icon', textContent: iconText }));

    const body = el('div', { className: 'asgard-notif__body' });
    body.appendChild(el('div', { className: 'asgard-notif__title', textContent: title }));
    if (text) body.appendChild(el('div', { className: 'asgard-notif__text', textContent: text }));
    card.appendChild(body);

    if (time) card.appendChild(el('div', { className: 'asgard-notif__time', textContent: time }));
    if (!read) card.appendChild(el('div', { className: 'asgard-notif__dot' }));

    return card;
  }

  /* ══════════════════════════════════════════════
     31. STEP WIZARD
     ══════════════════════════════════════════════ */
  function StepWizard({ steps, current = 0, onChange }) {
    const wrap = el('div', { className: 'asgard-step-wizard' });

    // Progress bar
    const progressWrap = el('div', { className: 'asgard-wizard__progress' });

    steps.forEach((step, i) => {
      const isActive = i === current;
      const isDone = i < current;

      const stepEl = el('div', { className: 'asgard-wizard__step' });

      const circleCls = isDone ? 'asgard-wizard__circle--done' : isActive ? 'asgard-wizard__circle--active' : 'asgard-wizard__circle--pending';
      const circle = el('div', {
        className: 'asgard-wizard__circle ' + circleCls,
        textContent: isDone ? '✓' : String(i + 1),
      });
      stepEl.appendChild(circle);

      const labelCls = 'asgard-wizard__step-label' + (isActive ? ' asgard-wizard__step-label--active' : '');
      stepEl.appendChild(el('div', { className: labelCls, textContent: step.label }));

      progressWrap.appendChild(stepEl);

      // Connector line
      if (i < steps.length - 1) {
        progressWrap.appendChild(el('div', {
          className: 'asgard-wizard__connector' + (isDone ? ' asgard-wizard__connector--done' : ''),
        }));
      }
    });

    wrap.appendChild(progressWrap);

    // Content area
    const content = el('div', { className: 'asgard-wizard__content' });
    if (steps[current] && steps[current].content) {
      if (steps[current].content instanceof HTMLElement) content.appendChild(steps[current].content);
      else content.innerHTML = steps[current].content;
    }
    wrap.appendChild(content);

    // Navigation buttons
    const nav = el('div', { className: 'asgard-wizard__nav' });

    if (current > 0) {
      nav.appendChild(FullWidthBtn({
        label: 'Назад', variant: 'secondary',
        onClick: () => { if (onChange) onChange(current - 1); },
      }));
    }

    nav.appendChild(FullWidthBtn({
      label: current === steps.length - 1 ? 'Завершить' : 'Далее',
      onClick: () => { if (onChange) onChange(current + 1); },
    }));

    wrap.appendChild(nav);

    return wrap;
  }

  /* ══════════════════════════════════════════════
     32. TIMELINE
     ══════════════════════════════════════════════ */
  function Timeline({ items }) {
    const wrap = el('div', { className: 'asgard-timeline' });

    items.forEach((item, i) => {
      const row = el('div', {
        className: 'asgard-timeline__row',
        style: Object.assign({ paddingBottom: i < items.length - 1 ? '20px' : '0' }, DS.anim(i * 0.04)),
      });

      // Dot + line
      const dotCol = el('div', { className: 'asgard-timeline__dot-col' });

      const dot = el('div', {
        className: 'asgard-timeline__dot',
        style: {
          background: item.color || (i === 0 ? 'var(--blue)' : 'var(--text-ter)'),
          boxShadow: i === 0 ? '0 0 0 4px var(--blue-bg)' : 'none',
        },
      });
      dotCol.appendChild(dot);

      if (i < items.length - 1) {
        dotCol.appendChild(el('div', { className: 'asgard-timeline__line' }));
      }
      row.appendChild(dotCol);

      // Content
      const content = el('div', { className: 'asgard-timeline__content' });

      const headerRow = el('div', { className: 'asgard-timeline__header' });
      headerRow.appendChild(el('div', { className: 'asgard-timeline__title', textContent: item.title }));
      if (item.time) {
        headerRow.appendChild(el('div', { className: 'asgard-timeline__time', textContent: item.time }));
      }
      content.appendChild(headerRow);

      if (item.text) {
        content.appendChild(el('div', { className: 'asgard-timeline__text', textContent: item.text }));
      }

      if (item.badge) {
        content.appendChild(el('div', { className: 'asgard-timeline__badge' }, [
          Badge({ text: item.badge, color: item.badgeColor || 'info' }),
        ]));
      }

      row.appendChild(content);
      wrap.appendChild(row);
    });

    return wrap;
  }

  /* ══════════════════════════════════════════════
     33. CHAT BUBBLE
     ══════════════════════════════════════════════ */
  function ChatBubble({ text, time, mine = false, name, avatar, status }) {
    const row = el('div', {
      className: 'asgard-chat-row' + (mine ? ' asgard-chat-row--mine' : ''),
    });

    if (!mine && avatar !== false) {
      row.appendChild(Avatar({ name: name || '?', size: 28 }));
    }

    const bubble = el('div', { className: 'asgard-bubble' + (mine ? ' asgard-bubble--mine' : '') });

    if (!mine && name) {
      bubble.appendChild(el('div', { className: 'asgard-bubble__sender', textContent: name }));
    }

    bubble.appendChild(el('div', { className: 'asgard-bubble__text', textContent: text }));

    const meta = el('div', { className: 'asgard-bubble__meta' });
    if (time) meta.appendChild(el('span', { className: 'asgard-bubble__time', textContent: time }));
    if (mine && status) {
      meta.appendChild(el('span', {
        className: 'asgard-bubble__status',
        textContent: status === 'read' ? '✓✓' : '✓',
      }));
    }
    bubble.appendChild(meta);

    row.appendChild(bubble);
    return row;
  }

  /* ══════════════════════════════════════════════
     34. MESSAGE COMPOSER
     ══════════════════════════════════════════════ */
  function MessageComposer({ placeholder = 'Сообщение...', onSend, onAttach }) {
    const wrap = el('div', { className: 'asgard-composer' });

    if (onAttach) {
      wrap.appendChild(el('button', {
        className: 'asgard-composer__attach',
        innerHTML: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>',
        onClick: onAttach,
      }));
    }

    const input = el('input', {
      type: 'text',
      placeholder,
      className: 'asgard-composer__input',
    });
    input.addEventListener('focus', () => input.style.borderColor = 'var(--blue)');
    input.addEventListener('blur', () => input.style.borderColor = 'var(--border)');
    wrap.appendChild(input);

    const sendBtn = el('button', {
      className: 'asgard-composer__send',
      innerHTML: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
      onClick: () => {
        if (input.value.trim() && onSend) {
          onSend(input.value.trim());
          input.value = '';
          input.style.height = 'auto';
        }
      },
    });
    sendBtn.addEventListener('touchstart', () => sendBtn.style.transform = 'scale(0.9)', { passive: true });
    sendBtn.addEventListener('touchend', () => sendBtn.style.transform = '', { passive: true });
    wrap.appendChild(sendBtn);

    return wrap;
  }

  /* ══════════════════════════════════════════════
     35. CHIP (тег)
     ══════════════════════════════════════════════ */
  function Chip({ text, color, onRemove, onClick }) {
    const sc = DS.status(color || 'neutral');
    const chip = el('span', {
      className: 'asgard-chip',
      style: {
        background: sc.bg, border: '1px solid ' + sc.border, color: sc.color,
        cursor: onClick ? 'pointer' : 'default',
      },
    });
    if (onClick) chip.addEventListener('click', onClick);

    chip.appendChild(el('span', { textContent: text }));

    if (onRemove) {
      const x = el('button', {
        className: 'asgard-chip__remove',
        textContent: '×',
        onClick: (e) => { e.stopPropagation(); chip.remove(); if (onRemove) onRemove(); },
      });
      chip.appendChild(x);
    }

    return chip;
  }

  /* ══════════════════════════════════════════════
     36. SEGMENT CONTROL
     ══════════════════════════════════════════════ */
  function SegmentControl({ items, active, onChange }) {
    const wrap = el('div', { className: 'asgard-segment' });
    const slider = el('div', { className: 'asgard-segment__slider' });
    wrap.appendChild(slider);

    items.forEach((item, i) => {
      const btn = el('button', {
        className: item.value === active ? 'active' : '',
        textContent: item.label,
        onClick: () => {
          active = item.value;
          updateSegment();
          if (onChange) onChange(item.value);
        },
      });
      wrap.appendChild(btn);
    });

    function updateSegment() {
      const btns = wrap.querySelectorAll('button');
      btns.forEach((btn, idx) => {
        btn.className = items[idx].value === active ? 'active' : '';
      });
      const activeIdx = items.findIndex(i => i.value === active);
      if (activeIdx >= 0 && btns[activeIdx]) {
        slider.style.left = btns[activeIdx].offsetLeft + 'px';
        slider.style.width = btns[activeIdx].offsetWidth + 'px';
      }
    }

    setTimeout(updateSegment, 0);
    window.addEventListener('resize', () => setTimeout(updateSegment, 50));

    return wrap;
  }

  /* ══════════════════════════════════════════════
     37. PULL TO REFRESH (визуальный индикатор)
     ══════════════════════════════════════════════ */
  function PullToRefresh({ onRefresh }) {
    const indicator = el('div', { className: 'asgard-ptr-indicator' });
    const spinner = el('div', { className: 'asgard-ptr-spinner' });
    indicator.appendChild(spinner);

    indicator.show = () => {
      indicator.style.height = '50px';
    };
    indicator.hide = () => {
      indicator.style.height = '0';
    };
    indicator.setRefreshing = (v) => {
      if (v) {
        indicator.show();
        spinner.style.animation = 'asgardSpin 0.8s linear infinite';
      } else {
        setTimeout(() => indicator.hide(), 300);
      }
    };

    return indicator;
  }

  /* ══════════════════════════════════════════════
     38. SWIPE CARD (демо-карточка с явными свайп-действиями)
     ══════════════════════════════════════════════ */
  function SwipeCard({ title, subtitle, leftActions = [], rightActions = [] }) {
    const wrapper = el('div', { className: 'asgard-swipe-card' });

    // Right actions (revealed on left swipe)
    if (rightActions.length) {
      const actionsEl = el('div', { className: 'asgard-swipe-actions' });
      rightActions.forEach(a => {
        actionsEl.appendChild(el('button', {
          className: 'asgard-swipe-action',
          style: { background: a.color || 'var(--red)' },
          innerHTML: (a.icon || '') + '<span>' + a.label + '</span>',
          onClick: a.onClick,
        }));
      });
      wrapper.appendChild(actionsEl);
    }

    // Main card
    const inner = el('div', { className: 'asgard-swipe-inner' });

    inner.appendChild(el('div', { className: 'asgard-swipe-inner__title', textContent: title }));
    if (subtitle) {
      inner.appendChild(el('div', { className: 'asgard-swipe-inner__subtitle', textContent: subtitle }));
    }

    wrapper.appendChild(inner);

    // Touch handling
    let startX = 0, currentX = 0, isDragging = false;
    const maxSwipe = rightActions.length * 72;

    inner.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      isDragging = true;
      inner.style.transition = 'none';
    }, { passive: true });

    inner.addEventListener('touchmove', (e) => {
      if (!isDragging) return;
      currentX = e.touches[0].clientX - startX;
      if (currentX < 0 && rightActions.length) {
        inner.style.transform = `translateX(${Math.max(currentX, -maxSwipe)}px)`;
      }
    }, { passive: true });

    inner.addEventListener('touchend', () => {
      isDragging = false;
      inner.style.transition = 'transform 0.3s cubic-bezier(.34,1.56,.64,1)';
      if (currentX < -maxSwipe / 2) {
        inner.style.transform = `translateX(-${maxSwipe}px)`;
      } else {
        inner.style.transform = 'translateX(0)';
      }
      currentX = 0;
    }, { passive: true });

    return wrapper;
  }

  /* ══════════════════════════════════════════════
     EXTRA: DONUT CHART (прогресс-кольцо)
     ══════════════════════════════════════════════ */
  function DonutChart({ value, max = 100, size = 80, color, label, thickness = 6 }) {
    const pct = Math.min(100, Math.max(0, (value / max) * 100));
    const r = (size - thickness) / 2;
    const c = 2 * Math.PI * r;
    const offset = c * (1 - pct / 100);

    const wrap = el('div', { className: 'asgard-donut' });

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.style.transform = 'rotate(-90deg)';

    const bgColor = DS.getTheme() === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
    const fillColor = color || (pct >= 75 ? 'var(--green)' : pct >= 50 ? 'var(--gold)' : pct >= 25 ? 'var(--orange)' : 'var(--red)');

    svg.innerHTML = `
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}"
        fill="none" stroke="${bgColor}" stroke-width="${thickness}"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}"
        fill="none" stroke="${fillColor}" stroke-width="${thickness}"
        stroke-dasharray="${c}" stroke-dashoffset="${c}"
        stroke-linecap="round"
        style="transition: stroke-dashoffset 1s cubic-bezier(.34,1.56,.64,1)"/>
    `;

    wrap.appendChild(svg);

    // Center text
    const center = el('div', {
      className: 'asgard-donut__center',
      textContent: Math.round(pct) + '%',
    });
    wrap.appendChild(center);

    if (label) wrap.appendChild(el('div', { className: 'asgard-donut__label', textContent: label }));

    // Animate
    setTimeout(() => {
      const circle = svg.querySelectorAll('circle')[1];
      if (circle) circle.style.strokeDashoffset = offset;
    }, 100);

    return wrap;
  }

  /* ══════════════════════════════════════════════
     EXTRA: BURGER MENU (полноэкранное меню)
     ══════════════════════════════════════════════ */
  function BurgerMenu({ user, groups = [], onClose, onNavigate }) {
    const overlay = el('div', { className: 'asgard-burger-overlay' });
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    // Header
    const header = el('div', { className: 'asgard-burger-header' });

    if (user) {
      const userRow = el('div', { className: 'asgard-burger-user-row' });
      userRow.appendChild(Avatar({ name: user.name, src: user.avatar, size: 44, status: 'online' }));
      const info = el('div');
      info.appendChild(el('div', { className: 'asgard-burger-user-name', textContent: user.name }));
      info.appendChild(el('div', { className: 'asgard-burger-user-role', textContent: user.role || '' }));
      userRow.appendChild(info);
      header.appendChild(userRow);
    }

    const closeBtn = el('button', {
      className: 'asgard-burger-close',
      textContent: '✕',
      onClick: close,
    });
    closeBtn.setAttribute('aria-label', 'Закрыть');
    header.appendChild(closeBtn);
    overlay.appendChild(header);

    // Groups
    const content = el('div', { className: 'asgard-burger-content' });

    groups.forEach((group, gi) => {
      const section = el('div', { className: 'asgard-burger-section' });

      const groupHeader = el('div', { className: 'asgard-burger-group-header' });
      groupHeader.appendChild(el('div', { className: 'asgard-burger-group-title', textContent: group.title }));
      const chevron = el('span', { className: 'asgard-burger-chevron', textContent: '▾' });
      groupHeader.appendChild(chevron);

      const items = el('div', { className: 'asgard-burger-items' });

      (group.items || []).forEach(item => {
        const row = el('div', {
          className: 'asgard-burger-item',
          onClick: () => { close(); if (onNavigate) onNavigate(item.href); },
        });
        row.addEventListener('touchstart', () => row.style.background = 'var(--surface-alt)', { passive: true });
        row.addEventListener('touchend', () => row.style.background = '', { passive: true });

        row.appendChild(el('span', { className: 'asgard-burger-item__icon', textContent: item.icon || '•' }));
        row.appendChild(el('span', { className: 'asgard-burger-item__label', textContent: item.label }));
        if (item.badge) {
          row.appendChild(el('span', { className: 'asgard-burger-item__badge', textContent: item.badge }));
        }
        items.appendChild(row);
      });

      let collapsed = gi > 1; // first 2 groups open
      if (collapsed) {
        items.style.maxHeight = '0';
        chevron.style.transform = 'rotate(-90deg)';
      } else {
        items.style.maxHeight = 'none';
      }

      groupHeader.addEventListener('click', () => {
        collapsed = !collapsed;
        if (collapsed) {
          items.style.maxHeight = items.scrollHeight + 'px';
          requestAnimationFrame(() => { items.style.maxHeight = '0'; });
          chevron.style.transform = 'rotate(-90deg)';
        } else {
          items.style.maxHeight = items.scrollHeight + 'px';
          chevron.style.transform = '';
          items.addEventListener('transitionend', () => { items.style.maxHeight = 'none'; }, { once: true });
        }
      });

      section.appendChild(groupHeader);
      section.appendChild(items);
      content.appendChild(section);
    });

    overlay.appendChild(content);
    Utils.lockScroll();
    document.body.appendChild(overlay);

    function close() {
      overlay.style.animation = 'asgardPageExit 0.25s ease forwards';
      setTimeout(() => { overlay.remove(); Utils.unlockScroll(); }, 250);
      if (onClose) onClose();
    }

    return overlay;
  }

  /* ══════════════════════════════════════════════
     ERROR BANNER — Sber-style compact retry strip
     ══════════════════════════════════════════════ */
  function ErrorBanner({ text, onRetry } = {}) {
    const banner = el('div', {
      className: 'asgard-error-banner',
      style: { background: `color-mix(in srgb, ${DS.t.red} 8%, transparent)` },
    });

    const icon = el('div', { className: 'asgard-error-banner__icon' });
    icon.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h.01"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/><path d="M5 12.859a10 10 0 0 1 5.17-2.69"/><path d="M13.83 10.17A10 10 0 0 1 19 12.86"/><path d="M2 8.82a15 15 0 0 1 4.17-2.65"/><path d="M10.66 5c4.01-.36 8.14.9 11.34 3.76"/><line x1="2" y1="2" x2="22" y2="22"/></svg>';
    banner.appendChild(icon);

    banner.appendChild(el('div', {
      className: 'asgard-error-banner__text',
      textContent: text || 'Не удалось загрузить',
    }));

    if (onRetry) {
      const btn = el('button', { className: 'asgard-error-banner__retry', textContent: 'Повторить' });
      btn.addEventListener('click', onRetry);
      banner.appendChild(btn);
    }

    return banner;
  }

  function AccessDenied({ text } = {}) {
    var wrap = el('div', { className: 'asgard-access-denied' });
    var icon = el('div', { className: 'asgard-access-denied__icon' });
    icon.textContent = '\uD83D\uDEE1\uFE0F';
    wrap.appendChild(icon);
    wrap.appendChild(el('div', { className: 'asgard-access-denied__title', textContent: 'Доступ запрещён' }));
    wrap.appendChild(el('div', { className: 'asgard-access-denied__text', textContent: text || 'У вашей роли нет доступа к этому разделу' }));
    var btn = el('button', { className: 'asgard-access-denied__back', textContent: '\u2190 Назад' });
    btn.addEventListener('click', function () { Router.navigate('/home'); });
    wrap.appendChild(btn);
    return wrap;
  }

  function Sparkline(opts) {
    var data = opts.data || [];
    var color = opts.color || 'var(--blue)';
    var w = opts.width || 80;
    var h = opts.height || 28;
    if (!data.length) return document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    var max = Math.max.apply(null, data);
    var min = Math.min.apply(null, data);
    var range = max - min || 1;
    var points = data.map(function (v, i) {
      return (i / (data.length - 1)) * w + ',' + (h - ((v - min) / range) * (h - 4) - 2);
    }).join(' ');
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.style.display = 'block';
    svg.innerHTML = '<polyline points="' + points + '" fill="none" stroke="' + color + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<polygon points="' + points + ' ' + w + ',' + h + ' 0,' + h + '" fill="' + color + '" fill-opacity="0.12"/>';
    return svg;
  }

  /* ══════════════════════════════════════════════
     PUBLIC API
     ══════════════════════════════════════════════ */
  return {
    Header,
    HeroCard,
    Card,
    Badge,
    FilterPills,
    Stats,
    Section,
    List,
    Empty,
    Skeleton,
    Toast,
    BottomSheet,
    Confirm,
    FAB,
    TablePage,
    BarChart,
    MiniChart,
    BigNumber,
    Form,
    FullWidthBtn,
    DetailFields,
    ProgressBar,
    Tabs,
    QuickActions,
    MimirBanner,
    SearchBar,
    ActionSheet,
    DatePicker,
    Avatar,
    NotificationCard,
    StepWizard,
    Timeline,
    ChatBubble,
    MessageComposer,
    Chip,
    SegmentControl,
    PullToRefresh,
    SwipeCard,
    DonutChart,
    BurgerMenu,
    ErrorBanner,
    AccessDenied,
    Sparkline,
  };
})();

// Global export
if (typeof window !== 'undefined') {
  window.M = M;
}
