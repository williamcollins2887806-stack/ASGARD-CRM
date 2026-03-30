/**
 * ASGARD Field — Profile Page
 * Avatar, permits, achievements, theme toggle, logout
 */
(() => {
'use strict';
const el = Utils.el;

const ACHIEVEMENTS = [
  { id: 'first_shift',  icon: '\uD83D\uDD25', name: '\u041F\u0435\u0440\u0432\u0430\u044F \u0441\u043C\u0435\u043D\u0430',    desc: '\u041E\u0442\u0440\u0430\u0431\u043E\u0442\u0430\u043B \u043F\u0435\u0440\u0432\u044B\u0439 \u0434\u0435\u043D\u044C',       key: 'total_shifts', min: 1 },
  { id: 'iron_warrior', icon: '\u26A1',        name: '\u0416\u0435\u043B\u0435\u0437\u043D\u044B\u0439 \u0432\u043E\u0438\u043D', desc: '10 \u0441\u043C\u0435\u043D \u0431\u0435\u0437 \u043F\u0440\u043E\u043F\u0443\u0441\u043A\u043E\u0432',   key: 'consecutive_shifts', min: 10 },
  { id: 'veteran',      icon: '\uD83C\uDFC6',  name: '\u0412\u0435\u0442\u0435\u0440\u0430\u043D \u0410\u0441\u0433\u0430\u0440\u0434\u0430', desc: '50+ \u0441\u043C\u0435\u043D \u0432 \u043A\u043E\u043C\u043F\u0430\u043D\u0438\u0438',       key: 'total_shifts', min: 50 },
  { id: 'chronicler',   icon: '\uD83D\uDCF7',  name: '\u041B\u0435\u0442\u043E\u043F\u0438\u0441\u0435\u0446',     desc: '100+ \u0444\u043E\u0442\u043E \u0432 \u043E\u0442\u0447\u0451\u0442\u0430\u0445', key: 'total_photos', min: 100 },
  { id: 'punctual',     icon: '\u23F0',        name: '\u041F\u0443\u043D\u043A\u0442\u0443\u0430\u043B\u044C\u043D\u044B\u0439', desc: '20 \u0441\u043C\u0435\u043D \u0432\u043E\u0432\u0440\u0435\u043C\u044F',       key: 'on_time_shifts', min: 20 },
  { id: 'berserker',    icon: '\uD83D\uDEE1\uFE0F', name: '\u0411\u0435\u0440\u0441\u0435\u0440\u043A',     desc: '5 \u0441\u043C\u0435\u043D \u043F\u043E 12+ \u0447\u0430\u0441\u043E\u0432',    key: 'long_shifts', min: 5 },
  { id: 'traveler',     icon: '\uD83D\uDDFA\uFE0F', name: '\u0421\u0442\u0440\u0430\u043D\u043D\u0438\u043A',      desc: '5+ \u0433\u043E\u0440\u043E\u0434\u043E\u0432 \u0440\u0430\u0431\u043E\u0442\u044B',  key: 'cities_count', min: 5 },
  { id: 'golden',       icon: '\uD83D\uDC8E',  name: '\u0417\u043E\u043B\u043E\u0442\u043E\u0439 \u0444\u043E\u043D\u0434',  desc: '\u0420\u0435\u0439\u0442\u0438\u043D\u0433 5.0 \u043E\u0442 \u0420\u041F',    key: 'rating', min: 5 },
  { id: 'mentor',       icon: '\uD83C\uDF93',  name: '\u041D\u0430\u0441\u0442\u0430\u0432\u043D\u0438\u043A',     desc: '\u0421\u0442\u0430\u043B \u043C\u0430\u0441\u0442\u0435\u0440\u043E\u043C \u0441\u043C\u0435\u043D\u044B',  key: 'was_master', min: 1 },
  { id: 'all_weather',  icon: '\uD83C\uDF27\uFE0F', name: '\u0412\u0441\u0435\u043F\u043E\u0433\u043E\u0434\u043D\u044B\u0439', desc: '\u0420\u0430\u0431\u043E\u0442\u0430\u043B \u043F\u0440\u0438 \u221220\u00B0C', key: 'winter_shifts', min: 1 },
];

const ProfilePage = {
  render() {
    const t = DS.t;
    const page = el('div', { className: 'field-page field-profile' });

    page.appendChild(F.Header({ title: '\u041F\u0440\u043E\u0444\u0438\u043B\u044C', logo: true, back: true }));

    const content = el('div', { style: { padding: '16px 20px 100px', display: 'flex', flexDirection: 'column', gap: '16px' } });
    content.appendChild(F.Skeleton({ type: 'hero' }));
    content.appendChild(F.Skeleton({ type: 'card', count: 3 }));
    page.appendChild(content);

    setTimeout(() => loadProfile(content), 0);
    return page;
  }
};

async function loadProfile(content) {
  const t = DS.t;
  const data = await API.fetch('/worker/me');

  content.replaceChildren();
  if (!data || data.error) {
    content.appendChild(F.Empty({ text: '\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u043F\u0440\u043E\u0444\u0438\u043B\u044C', icon: '\uD83D\uDC64' }));
    return;
  }

  const emp = data.employee || data;
  const achievements = data.achievements || emp.achievements || {};

  let delay = 0;
  const nd = () => { delay += 0.08; return delay; };

  // Avatar + name
  const header = el('div', {
    style: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px 0 12px', animation: 'fieldSlideUp 0.4s ease both' },
  });

  // Avatar circle with first letter
  const initials = (emp.fio || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const avatar = el('div', {
    style: {
      width: '80px', height: '80px', borderRadius: '50%',
      background: t.goldGrad, display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '1.75rem', fontWeight: '700', color: '#FFF',
      boxShadow: '0 4px 20px rgba(196,154,42,0.3)',
      marginBottom: '12px',
    },
  }, initials);
  header.appendChild(avatar);

  header.appendChild(el('div', { style: { color: t.text, fontWeight: '700', fontSize: '1.25rem' } }, emp.fio || ''));
  header.appendChild(el('div', { style: { color: t.textSec, fontSize: '0.875rem', marginTop: '2px' } }, emp.position || emp.role_tag || ''));
  if (emp.phone) {
    header.appendChild(el('div', { style: { color: t.textTer, fontSize: '0.8125rem', marginTop: '4px' } }, Utils.formatPhone(emp.phone)));
  }
  content.appendChild(header);

  // Permits / Certifications
  const permitsCard = el('div', {
    style: { background: t.surface, borderRadius: '16px', padding: '16px', border: '1px solid ' + t.border, animation: 'fieldSlideUp 0.4s ease ' + nd() + 's both' },
  });
  permitsCard.appendChild(el('div', {
    style: { color: t.textTer, fontSize: '0.6875rem', fontWeight: '600', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '10px' },
  }, '\u0414\u041E\u041F\u0423\u0421\u041A\u0418 \u0418 \u0423\u0414\u041E\u0421\u0422\u041E\u0412\u0415\u0420\u0415\u041D\u0418\u042F'));

  const permits = [
    { label: '\u041D\u0410\u041A\u0421', value: emp.naks || '\u041D\u0435 \u0443\u043A\u0430\u0437\u0430\u043D\u043E', expiry: emp.naks_expiry },
    { label: '\u0418\u041C\u0422', value: emp.imt_number || '\u041D\u0435 \u0443\u043A\u0430\u0437\u0430\u043D\u043E', expiry: emp.imt_expires },
  ];

  // Parse JSON permits
  if (emp.permits && typeof emp.permits === 'object') {
    const p = Array.isArray(emp.permits) ? emp.permits : Object.entries(emp.permits);
    for (const item of p) {
      if (Array.isArray(item)) {
        permits.push({ label: item[0], value: item[1] || '\u0415\u0441\u0442\u044C' });
      } else if (typeof item === 'object') {
        permits.push({ label: item.name || item.type, value: item.number || '\u0415\u0441\u0442\u044C', expiry: item.expires });
      }
    }
  }

  for (const p of permits) {
    const row = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' } });

    const left = el('div', {});
    left.appendChild(el('div', { style: { color: t.textSec, fontSize: '0.6875rem', fontWeight: '600' } }, p.label));
    left.appendChild(el('div', { style: { color: t.text, fontSize: '0.875rem', marginTop: '1px' } }, String(p.value)));
    row.appendChild(left);

    if (p.expiry) {
      const expiryDate = new Date(p.expiry);
      const daysLeft = Math.floor((expiryDate - new Date()) / 86400000);
      const isExpiring = daysLeft < 30;
      const isExpired = daysLeft < 0;
      const color = isExpired ? t.red : isExpiring ? t.orange : t.green;
      const label = isExpired ? '\u0418\u0441\u0442\u0451\u043A' : isExpiring ? '\u0427\u0435\u0440\u0435\u0437 ' + daysLeft + ' \u0434\u043D.' : Utils.formatDate(p.expiry);
      row.appendChild(F.StatusBadge({ text: label, color }));
    }

    permitsCard.appendChild(row);
  }
  content.appendChild(permitsCard);

  // Achievements
  const achCard = el('div', {
    style: { background: t.surface, borderRadius: '16px', padding: '16px', border: '1px solid ' + t.border, animation: 'fieldSlideUp 0.4s ease ' + nd() + 's both' },
  });
  achCard.appendChild(el('div', {
    style: { color: t.textTer, fontSize: '0.6875rem', fontWeight: '600', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '12px' },
  }, '\u0414\u041E\u0421\u0422\u0418\u0416\u0415\u041D\u0418\u042F'));

  const achGrid = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px' } });

  for (const ach of ACHIEVEMENTS) {
    const earned = achievements[ach.key] >= ach.min;
    const achEl = el('div', {
      style: {
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
        padding: '10px 4px', borderRadius: '12px',
        background: earned ? t.goldBg : 'transparent',
        opacity: earned ? '1' : '0.35',
        cursor: 'pointer', transition: 'transform 0.15s',
      },
      onClick: () => {
        F.BottomSheet({
          title: ach.icon + ' ' + ach.name,
          content: el('div', { style: { color: t.textSec, fontSize: '0.9375rem' } },
            ach.desc + (earned ? '\n\n\u2713 \u041F\u043E\u043B\u0443\u0447\u0435\u043D\u043E!' : '\n\n\u0415\u0449\u0451 \u043D\u0435 \u043F\u043E\u043B\u0443\u0447\u0435\u043D\u043E')),
        });
      },
    });
    achEl.appendChild(el('span', {
      style: {
        fontSize: '1.5rem',
        filter: earned ? 'none' : 'grayscale(1)',
        animation: earned ? 'fieldGlow 3s ease infinite' : 'none',
      },
    }, ach.icon));
    achEl.appendChild(el('span', {
      style: { fontSize: '0.5625rem', color: earned ? t.gold : t.textTer, textAlign: 'center', lineHeight: '1.2' },
    }, ach.name));
    achGrid.appendChild(achEl);
  }
  achCard.appendChild(achGrid);
  content.appendChild(achCard);

  // Personal info
  const infoCard = el('div', {
    style: { background: t.surface, borderRadius: '16px', padding: '16px', border: '1px solid ' + t.border, animation: 'fieldSlideUp 0.4s ease ' + nd() + 's both' },
  });
  infoCard.appendChild(el('div', {
    style: { color: t.textTer, fontSize: '0.6875rem', fontWeight: '600', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '8px' },
  }, '\u041B\u0418\u0427\u041D\u042B\u0415 \u0414\u0410\u041D\u041D\u042B\u0415'));

  const infoRows = [];
  if (emp.city) infoRows.push({ l: '\u0413\u043E\u0440\u043E\u0434', v: emp.city });
  if (emp.is_self_employed) infoRows.push({ l: '\u0421\u0442\u0430\u0442\u0443\u0441', v: '\u0421\u0430\u043C\u043E\u0437\u0430\u043D\u044F\u0442\u044B\u0439' });
  if (emp.clothing_size) infoRows.push({ l: '\u0421\u043F\u0435\u0446\u043E\u0434\u0435\u0436\u0434\u0430', v: emp.clothing_size });
  if (emp.shoe_size) infoRows.push({ l: '\u041E\u0431\u0443\u0432\u044C', v: emp.shoe_size });

  for (const r of infoRows) {
    const row = el('div', { style: { display: 'flex', justifyContent: 'space-between', padding: '5px 0' } });
    row.appendChild(el('span', { style: { color: t.textSec, fontSize: '0.8125rem' } }, r.l));
    row.appendChild(el('span', { style: { color: t.text, fontSize: '0.8125rem', fontWeight: '500' } }, r.v));
    infoCard.appendChild(row);
  }
  content.appendChild(infoCard);

  // Theme toggle
  const themeCard = el('div', {
    style: {
      background: t.surface, borderRadius: '16px', padding: '16px',
      border: '1px solid ' + t.border, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      animation: 'fieldSlideUp 0.4s ease ' + nd() + 's both', cursor: 'pointer',
    },
    onClick: () => {
      const current = DS.getTheme();
      const next = current === 'dark' ? 'light' : 'dark';
      DS.setTheme(next);
      Store.set('theme', next);
      // Refresh page
      Router.navigate('/field/profile');
    },
  });
  themeCard.appendChild(el('div', { style: { color: t.text, fontSize: '0.9375rem' } },
    (DS.getTheme() === 'dark' ? '\uD83C\uDF19' : '\u2600\uFE0F') + '  \u0422\u0435\u043C\u0430: ' + (DS.getTheme() === 'dark' ? '\u0422\u0451\u043C\u043D\u0430\u044F' : '\u0421\u0432\u0435\u0442\u043B\u0430\u044F')));
  themeCard.appendChild(el('span', { style: { color: t.textSec, fontSize: '0.8125rem' } }, '\u041F\u0435\u0440\u0435\u043A\u043B\u044E\u0447\u0438\u0442\u044C'));
  content.appendChild(themeCard);

  // Logout button
  const logoutBtn = el('button', {
    style: {
      width: '100%', padding: '16px', borderRadius: '14px', border: '1px solid ' + t.red + '40',
      background: t.redBg, color: t.red, fontSize: '0.9375rem', fontWeight: '600',
      cursor: 'pointer', animation: 'fieldSlideUp 0.4s ease ' + nd() + 's both',
    },
    onClick: async () => {
      await API.post('/auth/logout');
      API.clearToken();
      Store.remove('me');
      Router.navigate('/field/login', { replace: true });
    },
  }, '\u0412\u044B\u0439\u0442\u0438');
  content.appendChild(logoutBtn);

  // Version
  content.appendChild(el('div', {
    style: { textAlign: 'center', color: t.textTer, fontSize: '0.625rem', marginTop: '8px' },
  }, 'ASGARD Field v1.2.0'));
}

Router.register('/field/profile', ProfilePage);
})();
