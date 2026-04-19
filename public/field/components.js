/**
 * ASGARD Field — F.* Components
 */
(() => {
'use strict';
const el = Utils.el;

const F = {

  // ─── Header ──────────────────────────────────────────────────────────
  Header({ title, logo, back, backHref, rightAction }) {
    const t = DS.t;
    const header = el('div', { style: {
      display:'flex', alignItems:'center', gap:'12px',
      padding:'12px 20px', paddingTop: 'max(12px, env(safe-area-inset-top))',
      background: t.bg1, borderBottom: '1px solid ' + t.border,
      position:'sticky', top:'0', zIndex: DS.zIndex.header,
      minHeight: '48px',
    }});

    if (back) {
      const backBtn = el('div', {
        style: { cursor:'pointer', padding:'4px', marginLeft:'-4px', fontSize:'1.25rem', color: t.textSec },
        onClick: () => Router.navigate(backHref || '/field/home'),
        innerHTML: '&#8592;',
      });
      header.appendChild(backBtn);
    }

    if (logo) {
      const img = el('img', {
        src: '/assets/img/logo.png',
        style: { height:'28px', width:'28px', borderRadius:'6px' },
      });
      header.appendChild(img);
    }

    const titleEl = el('div', {
      style: { flex:'1', color: t.text, fontWeight:'600', fontSize:'1.125rem' },
    }, title || '');
    header.appendChild(titleEl);

    if (rightAction) header.appendChild(rightAction);

    return header;
  },

  // ─── Hero Banner ─────────────────────────────────────────────────────
  HeroBanner({ greeting, date, quote, emblemSrc }) {
    const t = DS.t;
    const hero = el('div', { style: {
      position:'relative', padding:'24px 20px 20px',
      background: t.heroGrad, backgroundSize:'200% 200%',
      animation:'fieldGradShift 8s ease infinite',
      overflow:'hidden', borderRadius:'0 0 20px 20px',
    }});

    // Watermark
    const wm = el('div', {
      style: {
        position:'absolute', right:'-10px', top:'50%', transform:'translateY(-50%)',
        fontSize:'4rem', fontWeight:'900', color:'rgba(255,255,255,0.03)',
        letterSpacing:'4px', pointerEvents:'none', userSelect:'none',
      },
    }, 'ASGARD');
    hero.appendChild(wm);

    // Content
    const content = el('div', { style: { position:'relative', zIndex:'1' } });

    if (emblemSrc) {
      const emblem = el('img', {
        src: emblemSrc,
        style: { width:'24px', height:'24px', borderRadius:'4px', marginBottom:'8px', animation:'fieldGlow 3s ease infinite' },
      });
      content.appendChild(emblem);
    }

    if (greeting) {
      content.appendChild(el('div', {
        style: { color: t.text, fontWeight:'700', fontSize:'1.5rem', lineHeight:'1.2', marginBottom:'4px' },
      }, greeting));
    }

    if (date) {
      content.appendChild(el('div', {
        style: { color: t.textSec, fontSize:'0.875rem', marginBottom:'12px' },
      }, date));
    }

    if (quote) {
      const q = el('div', {
        style: {
          color: t.gold, fontStyle:'italic', fontSize:'0.8125rem', lineHeight:'1.4',
          opacity:'0', animation:'fieldFadeIn 1s ease 0.5s both',
        },
      }, quote);
      content.appendChild(q);
    }

    hero.appendChild(content);
    return hero;
  },

  // ─── Big Button ──────────────────────────────────────────────────────
  BigButton({ label, icon, onClick, variant, pulse, loading, disabled }) {
    const t = DS.t;
    const gradients = {
      gold: t.goldGrad,
      green: t.shiftActiveGrad,
      red: t.dangerGrad,
      secondary: t.bg3,
    };
    const bg = gradients[variant] || gradients.gold;

    const btn = el('button', {
      style: {
        width:'100%', height:'64px', border:'none', borderRadius:'44px',
        background: bg, color: variant === 'secondary' ? t.text : '#FFF',
        fontSize:'1.125rem', fontWeight:'700', cursor: disabled ? 'default' : 'pointer',
        display:'flex', alignItems:'center', justifyContent:'center', gap:'10px',
        transition:'transform 0.15s ease, opacity 0.15s',
        opacity: disabled ? '0.5' : '1',
        animation: pulse && !disabled ? 'fieldPulse 2.5s infinite' : 'none',
        WebkitTapHighlightColor: 'transparent', position:'relative', overflow:'hidden',
      },
      onClick: (e) => {
        if (disabled || loading) return;
        Utils.vibrate(50);
        btn.style.transform = 'scale(0.96)';
        setTimeout(() => { btn.style.transform = 'scale(1)'; }, 150);
        if (onClick) onClick(e);
      },
    });

    if (loading) {
      btn.innerHTML = '<div style="width:24px;height:24px;border:3px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:fieldSpin 0.8s linear infinite"></div>';
    } else {
      if (icon) btn.appendChild(el('span', { style: { fontSize:'1.3rem' } }, icon));
      btn.appendChild(el('span', {}, label || ''));
    }

    return btn;
  },

  // ─── Money Card ──────────────────────────────────────────────────────
  MoneyCard({ amount, label, details, animDelay }) {
    const t = DS.t;
    const card = el('div', { style: {
      background: t.goldBg, borderRadius:'16px', padding:'20px',
      border:'1px solid rgba(196,154,42,0.15)',
      animation: `fieldSlideUp 0.4s ease ${animDelay || 0}s both`,
    }});

    if (label) {
      card.appendChild(el('div', {
        style: { color: t.textSec, fontSize:'0.75rem', fontWeight:'600', letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:'8px' },
      }, label));
    }

    const amountEl = el('div', {
      style: { color: t.gold, fontWeight:'700', fontSize:'2rem', lineHeight:'1.1' },
    });
    card.appendChild(amountEl);

    // CountUp animation
    setTimeout(() => Utils.countUp(amountEl, amount, 900), (animDelay || 0) * 1000 + 200);

    const suffix = el('span', {
      style: { fontSize:'1.25rem', fontWeight:'600', marginLeft:'4px', color: t.goldDark },
    }, ' \u20BD'); // ₽
    amountEl.appendChild(suffix);

    if (details) {
      card.appendChild(el('div', {
        style: { color: t.textTer, fontSize:'0.75rem', marginTop:'8px', lineHeight:'1.4' },
      }, details));
    }

    return card;
  },

  // ─── Card ────────────────────────────────────────────────────────────
  Card({ title, subtitle, badge, badgeColor, fields, onClick, animDelay, children }) {
    const t = DS.t;
    const card = el('div', {
      style: {
        background: t.surface, borderRadius:'16px', padding:'16px',
        border:'1px solid ' + t.border, cursor: onClick ? 'pointer' : 'default',
        transition:'transform 0.15s, background 0.15s',
        animation: `fieldSlideUp 0.4s ease ${animDelay || 0}s both`,
      },
      onClick: onClick || null,
    });

    if (onClick) {
      card.addEventListener('touchstart', () => { card.style.transform='scale(0.98)'; card.style.background=t.surfaceHover; }, {passive:true});
      card.addEventListener('touchend', () => { card.style.transform=''; card.style.background=t.surface; }, {passive:true});
    }

    // Top row
    if (title || badge) {
      const top = el('div', { style: { display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:'8px' } });
      if (title) top.appendChild(el('div', { style: { color:t.text, fontWeight:'600', fontSize:'1rem', flex:'1' } }, title));
      if (badge) {
        const bc = badgeColor || t.gold;
        top.appendChild(el('span', {
          style: {
            fontSize:'0.6875rem', fontWeight:'600', padding:'3px 8px', borderRadius:'9999px',
            background: bc + '18', color: bc, whiteSpace:'nowrap',
          },
        }, badge));
      }
      card.appendChild(top);
    }

    if (subtitle) {
      card.appendChild(el('div', { style: { color:t.textSec, fontSize:'0.8125rem', marginTop:'4px' } }, subtitle));
    }

    if (fields) {
      const grid = el('div', { style: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px', marginTop:'12px' } });
      for (const f of fields) {
        const cell = el('div', {});
        cell.appendChild(el('div', { style: { color:t.textTer, fontSize:'0.6875rem', textTransform:'uppercase', letterSpacing:'0.06em' } }, f.label));
        cell.appendChild(el('div', { style: { color:t.text, fontSize:'0.875rem', fontWeight:'500', marginTop:'2px' } }, f.value));
        grid.appendChild(cell);
      }
      card.appendChild(grid);
    }

    if (children) {
      for (const child of (Array.isArray(children) ? children : [children])) {
        if (child instanceof Node) card.appendChild(child);
      }
    }

    return card;
  },

  // ─── Call Button ─────────────────────────────────────────────────────
  CallButton({ name, phone, icon }) {
    const t = DS.t;
    const link = el('a', {
      href: 'tel:' + (phone || '').replace(/[^\d+]/g, ''),
      style: {
        display:'inline-flex', alignItems:'center', gap:'8px',
        padding:'8px 16px', borderRadius:'9999px',
        background: t.bg2, border:'1px solid ' + t.border,
        color: t.text, textDecoration:'none', fontSize:'0.875rem',
        transition:'background 0.15s',
      },
    });
    link.appendChild(el('span', {}, icon || '\uD83D\uDCDE')); // 📞
    link.appendChild(el('span', {}, name || phone || ''));
    link.addEventListener('touchstart', () => { link.style.background = 'rgba(52,199,89,0.15)'; }, {passive:true});
    link.addEventListener('touchend', () => { link.style.background = t.bg2; }, {passive:true});
    return link;
  },

  // ─── Toast ───────────────────────────────────────────────────────────
  Toast({ message, type, duration }) {
    const t = DS.t;
    const colors = { success: t.green, error: t.red, warning: t.orange, info: t.blue };
    const icons = { success: '\u2713', error: '\u2717', warning: '\u26A0', info: '\u2139' };
    const color = colors[type] || colors.info;

    const toast = el('div', {
      style: {
        position:'fixed', bottom:'24px', left:'20px', right:'20px',
        padding:'14px 20px', borderRadius:'14px',
        background: t.bg2, border:'1px solid ' + t.border,
        display:'flex', alignItems:'center', gap:'10px',
        zIndex: DS.zIndex.toast, animation:'fieldSlideUp 0.3s ease',
        boxShadow:'0 8px 32px rgba(0,0,0,0.3)',
      },
    });
    toast.appendChild(el('span', { style: { color, fontSize:'1.1rem', fontWeight:'700' } }, icons[type] || ''));
    toast.appendChild(el('span', { style: { color: t.text, fontSize:'0.875rem', flex:'1' } }, message));

    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, duration || 3000);

    return toast;
  },

  // ─── Bottom Sheet ────────────────────────────────────────────────────
  BottomSheet({ title, content, onClose }) {
    const t = DS.t;
    const overlay = el('div', {
      style: {
        position:'fixed', inset:'0', background:'rgba(0,0,0,0.5)', zIndex: DS.zIndex.overlay,
        animation:'fieldFadeIn 0.2s ease',
      },
      onClick: (e) => { if (e.target === overlay) { overlay.remove(); if (onClose) onClose(); } },
    });

    const sheet = el('div', {
      style: {
        position:'fixed', bottom:'0', left:'0', right:'0',
        background: t.bg1, borderRadius:'20px 20px 0 0',
        padding:'0 20px 24px', paddingBottom:'max(24px, env(safe-area-inset-bottom))',
        maxHeight:'80vh', overflowY:'auto', zIndex: DS.zIndex.modal,
        animation:'fieldSlideUp 0.3s ease',
      },
    });

    // Handle
    const handle = el('div', {
      style: { display:'flex', justifyContent:'center', padding:'12px 0 16px' },
    });
    handle.appendChild(el('div', {
      style: { width:'40px', height:'4px', borderRadius:'2px', background: t.border },
    }));
    sheet.appendChild(handle);

    if (title) {
      sheet.appendChild(el('div', {
        style: { color: t.text, fontWeight:'600', fontSize:'1.125rem', marginBottom:'16px' },
      }, title));
    }

    if (typeof content === 'string') {
      sheet.appendChild(el('div', { innerHTML: content }));
    } else if (content instanceof Node) {
      sheet.appendChild(content);
    }

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
    return overlay;
  },

  // ─── Skeleton ────────────────────────────────────────────────────────
  Skeleton({ type, count }) {
    const t = DS.t;
    const wrap = el('div', { style: { display:'flex', flexDirection:'column', gap:'12px', padding:'0 20px' } });
    const n = count || (type === 'hero' ? 1 : 3);
    for (let i = 0; i < n; i++) {
      const h = type === 'hero' ? '120px' : type === 'card' ? '80px' : '48px';
      wrap.appendChild(el('div', {
        style: {
          height: h, borderRadius:'14px', background: `linear-gradient(90deg, ${t.bg2} 25%, ${t.bg3} 50%, ${t.bg2} 75%)`,
          backgroundSize:'200% 100%', animation:'fieldGradShift 1.5s ease infinite',
        },
      }));
    }
    return wrap;
  },

  // ─── Empty ───────────────────────────────────────────────────────────
  Empty({ text, icon }) {
    const t = DS.t;
    return el('div', {
      style: { textAlign:'center', padding:'48px 24px', color: t.textTer },
    },
      el('div', { style: { fontSize:'2.5rem', marginBottom:'12px' } }, icon || '\uD83D\uDEE1\uFE0F'),
      el('div', { style: { fontSize:'0.9375rem', lineHeight:'1.5' } }, text || '')
    );
  },

  // ─── Status Badge ────────────────────────────────────────────────────
  StatusBadge({ text, color }) {
    const c = color || DS.t.textSec;
    return el('span', {
      style: {
        display:'inline-block', fontSize:'0.6875rem', fontWeight:'600',
        padding:'3px 10px', borderRadius:'9999px',
        background: c + '18', color: c,
      },
    }, text);
  },
};

window.F = F;
})();
