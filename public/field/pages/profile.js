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

  // My Work
  const workData = await API.fetch('/worker/my-work').catch(() => null);
  const workCard = el('div', {
    style: { background: t.surface, borderRadius: '16px', padding: '16px', border: '1px solid ' + t.border, animation: 'fieldSlideUp 0.4s ease ' + nd() + 's both' },
  });
  workCard.appendChild(el('div', {
    style: { color: t.textTer, fontSize: '0.6875rem', fontWeight: '600', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '10px' },
  }, '\uD83D\uDCCB \u041C\u041E\u042F \u0420\u0410\u0411\u041E\u0422\u0410'));

  if (workData && !workData.error && (workData.customer_name || workData.work_title)) {
    // Object + period
    const infoBlock = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' } });
    infoBlock.appendChild(el('div', { style: { color: t.text, fontSize: '0.9375rem', fontWeight: '600' } }, workData.customer_name + (workData.work_title ? ' \u2014 ' + workData.work_title : '')));

    if (workData.start_date || workData.end_date) {
      const startFmt = workData.start_date ? Utils.formatDate(workData.start_date) : '';
      const endFmt = workData.end_date ? Utils.formatDate(workData.end_date) : '';
      const periodText = startFmt && endFmt ? startFmt + ' \u2014 ' + endFmt : startFmt || endFmt;
      infoBlock.appendChild(el('div', { style: { color: t.textSec, fontSize: '0.8125rem' } }, '\uD83D\uDCC5 ' + periodText));
    }

    if (workData.shift_type) {
      const shiftIcon = workData.shift_type === 'night' ? '\uD83C\uDF19' : '\u2600\uFE0F';
      const shiftLabel = workData.shift_type === 'night' ? '\u041D\u043E\u0447\u043D\u0430\u044F' : '\u0414\u043D\u0435\u0432\u043D\u0430\u044F';
      infoBlock.appendChild(el('div', { style: { color: t.textSec, fontSize: '0.8125rem' } }, shiftIcon + ' \u0421\u043C\u0435\u043D\u0430: ' + shiftLabel));
    }
    workCard.appendChild(infoBlock);

    // Masters (из массива masters[])
    const masters = workData.masters || [];
    if (masters.length) {
      const masterBlock = el('div', { style: { borderTop: '1px solid ' + t.border, paddingTop: '10px', marginBottom: '10px' } });
      masterBlock.appendChild(el('div', { style: { color: t.textSec, fontSize: '0.6875rem', fontWeight: '600', marginBottom: '4px' } }, '\uD83D\uDC77 \u041C\u0430\u0441\u0442\u0435\u0440'));
      masters.forEach(m => {
        masterBlock.appendChild(el('div', { style: { color: t.text, fontSize: '0.875rem', fontWeight: '500', marginBottom: '4px' } }, m.name + (m.shift_type ? (m.shift_type === 'night' ? ' \uD83C\uDF19' : ' \u2600\uFE0F') : '')));
        if (m.phone) {
          masterBlock.appendChild(el('a', {
            href: 'tel:' + m.phone.replace(/[\s\-()]/g, ''),
            style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', background: t.goldGrad, borderRadius: '12px', color: '#fff', fontWeight: '600', fontSize: '0.875rem', textDecoration: 'none', justifyContent: 'center', marginBottom: '8px' },
          }, '\uD83D\uDCDE \u041F\u043E\u0437\u0432\u043E\u043D\u0438\u0442\u044C \u043C\u0430\u0441\u0442\u0435\u0440\u0443'));
        }
      });
      workCard.appendChild(masterBlock);
    }

    // PM (из объекта pm{})
    const pm = workData.pm;
    if (pm && pm.name) {
      const pmBlock = el('div', { style: { borderTop: '1px solid ' + t.border, paddingTop: '10px', marginBottom: '10px' } });
      pmBlock.appendChild(el('div', { style: { color: t.textSec, fontSize: '0.6875rem', fontWeight: '600', marginBottom: '4px' } }, '\uD83D\uDC54 \u0420\u041F'));
      pmBlock.appendChild(el('div', { style: { color: t.text, fontSize: '0.875rem', fontWeight: '500', marginBottom: '8px' } }, pm.name));
      if (pm.phone) {
        pmBlock.appendChild(el('a', {
          href: 'tel:' + pm.phone.replace(/[\s\-()]/g, ''),
          style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', background: t.goldGrad, borderRadius: '12px', color: '#fff', fontWeight: '600', fontSize: '0.875rem', textDecoration: 'none', justifyContent: 'center', marginBottom: '8px' },
        }, '\uD83D\uDCDE \u041F\u043E\u0437\u0432\u043E\u043D\u0438\u0442\u044C \u0420\u041F'));
      }
      workCard.appendChild(pmBlock);
    }

    // Коллеги (crew) — список бригады с телефонами
    const crew = workData.crew || [];
    if (crew.length) {
      const crewBlock = el('div', { style: { borderTop: '1px solid ' + t.border, paddingTop: '10px' } });
      crewBlock.appendChild(el('div', { style: { color: t.textSec, fontSize: '0.6875rem', fontWeight: '600', marginBottom: '8px' } }, '\uD83D\uDC65 \u0411\u0420\u0418\u0413\u0410\u0414\u0410 (' + crew.length + ' \u0447\u0435\u043B.)'));
      crew.forEach(c => {
        const row = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' } });
        const nameEl = el('div', { style: { color: t.text, fontSize: '0.8125rem' } },
          c.fio + (c.field_role !== 'worker' ? ' \u2B50' : '') + (c.shift_type === 'night' ? ' \uD83C\uDF19' : ''));
        row.appendChild(nameEl);
        if (c.phone) {
          row.appendChild(el('a', {
            href: 'tel:' + c.phone.replace(/[\s\-()]/g, ''),
            style: { color: t.gold, fontSize: '0.8125rem', textDecoration: 'none' },
          }, '\uD83D\uDCDE'));
        }
        crewBlock.appendChild(row);
      });
      workCard.appendChild(crewBlock);
    }

    // Timesheet button
    if (workData.work_id) {
      const tsBlock = el('div', { style: { borderTop: '1px solid ' + t.border, paddingTop: '12px', marginTop: '4px' } });
      const tsBtn = el('button', {
        style: {
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
          padding: '12px 16px', borderRadius: '12px', fontSize: '0.9375rem', fontWeight: '600',
          background: t.bg2, color: t.text, border: '1px solid ' + t.border, cursor: 'pointer',
        },
        onClick: () => openTimesheet(workData.work_id, t),
      }, '\uD83D\uDCCB \u041C\u043E\u0439 \u0442\u0430\u0431\u0435\u043B\u044C');
      tsBlock.appendChild(tsBtn);
      workCard.appendChild(tsBlock);
    }
  } else {
    workCard.appendChild(el('div', { style: { color: t.textSec, fontSize: '0.875rem', textAlign: 'center', padding: '12px 0' } }, '\u041D\u0435\u0442 \u0430\u043A\u0442\u0438\u0432\u043D\u043E\u0439 \u0440\u0430\u0431\u043E\u0442\u044B'));
  }
  content.appendChild(workCard);

  // Permits / Certifications — loaded from employee_permits
  const permitsCard = el('div', {
    style: { background: t.surface, borderRadius: '16px', padding: '16px', border: '1px solid ' + t.border, animation: 'fieldSlideUp 0.4s ease ' + nd() + 's both' },
  });
  permitsCard.appendChild(el('div', {
    style: { color: t.textTer, fontSize: '0.6875rem', fontWeight: '600', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '10px' },
  }, '\u0414\u041E\u041F\u0423\u0421\u041A\u0418 \u0418 \u0423\u0414\u041E\u0421\u0422\u041E\u0412\u0415\u0420\u0415\u041D\u0418\u042F'));

  const permitsData = await API.fetch('/worker/permits').catch(() => null);
  const permitsList = (permitsData && permitsData.permits) || [];

  if (permitsList.length === 0) {
    permitsCard.appendChild(el('div', { style: { color: t.textSec, fontSize: '0.875rem', textAlign: 'center', padding: '12px 0' } }, '\u0414\u043E\u043F\u0443\u0441\u043A\u0438 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B'));
  } else {
    for (const pm of permitsList) {
      const row = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '8px 0', borderBottom: '1px solid ' + t.border + '40' } });

      const left = el('div', { style: { flex: '1', minWidth: '0' } });
      left.appendChild(el('div', { style: { color: t.text, fontSize: '0.875rem', fontWeight: '600' } }, pm.permit_name || pm.category || '\u0414\u043E\u043F\u0443\u0441\u043A'));
      if (pm.doc_number) {
        left.appendChild(el('div', { style: { color: t.textSec, fontSize: '0.8125rem', marginTop: '2px' } }, pm.doc_number));
      }
      if (pm.issuer) {
        left.appendChild(el('div', { style: { color: t.textTer, fontSize: '0.75rem', marginTop: '2px' } }, pm.issuer));
      }
      row.appendChild(left);

      // Status badge
      const st = pm.status || 'no_expiry';
      let badgeText = '';
      let badgeColor = t.textSec;
      let badgeAnim = '';

      if (st === 'active' && pm.expiry_date) {
        const fmt = new Date(pm.expiry_date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
        badgeText = '\u0434\u043E ' + fmt;
        badgeColor = t.green;
      } else if (st === 'expiring_14') {
        const dLeft = Math.max(0, Math.floor((new Date(pm.expiry_date) - new Date()) / 86400000));
        badgeText = '\u0418\u0441\u0442\u0435\u043A\u0430\u0435\u0442 \u0447\u0435\u0440\u0435\u0437 ' + dLeft + ' \u0434\u043D.';
        badgeColor = t.red;
        badgeAnim = 'fieldPulse 1.5s ease infinite';
      } else if (st === 'expiring_30') {
        const dLeft = Math.max(0, Math.floor((new Date(pm.expiry_date) - new Date()) / 86400000));
        badgeText = '\u0427\u0435\u0440\u0435\u0437 ' + dLeft + ' \u0434\u043D.';
        badgeColor = t.orange;
      } else if (st === 'expired') {
        const fmt = new Date(pm.expiry_date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
        badgeText = '\u0418\u0441\u0442\u0451\u043A ' + fmt;
        badgeColor = t.red;
      } else {
        badgeText = '\u0411\u0435\u0441\u0441\u0440\u043E\u0447\u043D\u044B\u0439';
        badgeColor = t.textSec;
      }

      const badge = F.StatusBadge({ text: badgeText, color: badgeColor });
      if (badgeAnim) badge.style.animation = badgeAnim;
      row.appendChild(badge);

      permitsCard.appendChild(row);
    }
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

  // Personal info — loaded from /worker/personal with edit capability
  const personalData = await API.fetch('/worker/personal').catch(() => null);
  const pe = (personalData && personalData.employee) || {};

  const infoCard = el('div', {
    style: { background: t.surface, borderRadius: '16px', padding: '16px', border: '1px solid ' + t.border, animation: 'fieldSlideUp 0.4s ease ' + nd() + 's both' },
  });
  infoCard.appendChild(el('div', {
    style: { color: t.textTer, fontSize: '0.6875rem', fontWeight: '600', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '8px' },
  }, '\u041B\u0418\u0427\u041D\u042B\u0415 \u0414\u0410\u041D\u041D\u042B\u0415'));

  const PERSONAL_FIELDS = [
    { key: 'fio', label: '\u0424\u0418\u041E', editable: false },
    { key: 'phone', label: '\u0422\u0435\u043B\u0435\u0444\u043E\u043D', editable: true, format: v => Utils.formatPhone(v) },
    { key: 'email', label: 'Email', editable: true },
    { key: 'birth_date', label: '\u0414\u0430\u0442\u0430 \u0440\u043E\u0436\u0434\u0435\u043D\u0438\u044F', editable: true, type: 'date', format: v => Utils.formatDateFull(v) },
    { key: 'gender', label: '\u041F\u043E\u043B', editable: true, format: v => v === 'male' ? '\u041C\u0443\u0436\u0441\u043A\u043E\u0439' : v === 'female' ? '\u0416\u0435\u043D\u0441\u043A\u0438\u0439' : v },
    { key: 'passport_data', label: '\u041F\u0430\u0441\u043F\u043E\u0440\u0442', editable: true, altKey: 'passport_number' },
    { key: 'inn', label: '\u0418\u041D\u041D', editable: true },
    { key: 'snils', label: '\u0421\u041D\u0418\u041B\u0421', editable: true },
    { key: 'city', label: '\u0413\u043E\u0440\u043E\u0434', editable: true },
    { key: 'address', label: '\u0410\u0434\u0440\u0435\u0441', editable: true },
    { key: 'clothing_size', label: '\u0420\u0430\u0437\u043C\u0435\u0440 \u043E\u0434\u0435\u0436\u0434\u044B', editable: true },
    { key: 'shoe_size', label: '\u0420\u0430\u0437\u043C\u0435\u0440 \u043E\u0431\u0443\u0432\u0438', editable: true },
    { key: 'is_self_employed', label: '\u0421\u0430\u043C\u043E\u0437\u0430\u043D\u044F\u0442\u044B\u0439', editable: false, format: v => v ? '\u0414\u0430' : '\u041D\u0435\u0442' },
    { key: 'employment_date', label: '\u0414\u0430\u0442\u0430 \u0442\u0440\u0443\u0434\u043E\u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u0430', editable: false, format: v => Utils.formatDateFull(v) },
  ];

  function renderPersonalFields() {
    // Remove all rows except header
    while (infoCard.children.length > 1) infoCard.removeChild(infoCard.lastChild);

    for (const f of PERSONAL_FIELDS) {
      let rawVal = pe[f.key];
      if (!rawVal && f.altKey) rawVal = pe[f.altKey];
      const displayVal = rawVal ? (f.format ? f.format(rawVal) : String(rawVal)) : '\u041D\u0435 \u0443\u043A\u0430\u0437\u0430\u043D\u043E';
      const isEmpty = !rawVal;

      const row = el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid ' + t.border + '20' } });

      const leftCol = el('div', { style: { flex: '1', minWidth: '0' } });
      leftCol.appendChild(el('div', {
        style: { color: t.textTer, fontSize: '0.6875rem', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.04em' },
      }, f.label));
      leftCol.appendChild(el('div', {
        style: { color: isEmpty ? t.textTer : t.text, fontSize: '0.875rem', marginTop: '2px', fontStyle: isEmpty ? 'italic' : 'normal' },
      }, displayVal));
      row.appendChild(leftCol);

      if (f.editable) {
        const editBtn = el('button', {
          style: {
            background: 'none', border: 'none', color: t.gold, fontSize: '1rem',
            padding: '6px 8px', cursor: 'pointer', flexShrink: '0',
          },
          onClick: () => openEditSheet(f, rawVal),
        }, '\u270F\uFE0F');
        row.appendChild(editBtn);
      }

      infoCard.appendChild(row);
    }
  }

  function openEditSheet(field, currentVal) {
    const sheetContent = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });

    let inputEl;
    if (field.key === 'gender') {
      inputEl = el('select', {
        style: {
          width: '100%', padding: '14px 16px', borderRadius: '12px', fontSize: '1rem',
          background: t.bg2, color: t.text, border: '1px solid ' + t.border,
          appearance: 'auto', WebkitAppearance: 'auto',
        },
      });
      const opts = [['', '\u041D\u0435 \u0443\u043A\u0430\u0437\u0430\u043D\u043E'], ['male', '\u041C\u0443\u0436\u0441\u043A\u043E\u0439'], ['female', '\u0416\u0435\u043D\u0441\u043A\u0438\u0439']];
      for (const [v, l] of opts) {
        const opt = el('option', { value: v }, l);
        if (v === (currentVal || '')) opt.selected = true;
        inputEl.appendChild(opt);
      }
    } else {
      const inputType = field.type === 'date' ? 'date' : 'text';
      let inputValue = currentVal || '';
      if (field.type === 'date' && inputValue) {
        inputValue = new Date(inputValue).toISOString().slice(0, 10);
      }
      inputEl = el('input', {
        type: inputType,
        value: inputValue,
        style: {
          width: '100%', padding: '14px 16px', borderRadius: '12px', fontSize: '1rem',
          background: t.bg2, color: t.text, border: '1px solid ' + t.border,
          boxSizing: 'border-box',
        },
      });
    }
    sheetContent.appendChild(inputEl);

    const btnRow = el('div', { style: { display: 'flex', gap: '10px', marginTop: '4px' } });

    const cancelBtn = el('button', {
      style: {
        flex: '1', padding: '14px', borderRadius: '12px', fontSize: '0.9375rem',
        fontWeight: '600', background: 'none', color: t.textSec,
        border: '1px solid ' + t.border, cursor: 'pointer',
      },
      onClick: () => sheet.remove(),
    }, '\u041E\u0442\u043C\u0435\u043D\u0430');

    const saveBtn = el('button', {
      style: {
        flex: '1', padding: '14px', borderRadius: '12px', fontSize: '0.9375rem',
        fontWeight: '600', background: t.goldGrad, color: '#fff',
        border: 'none', cursor: 'pointer',
      },
      onClick: async () => {
        const newVal = field.key === 'gender' ? inputEl.value : inputEl.value.trim();
        if (!confirm('\u0412\u044B \u0443\u0432\u0435\u0440\u0435\u043D\u044B \u0447\u0442\u043E \u0445\u043E\u0442\u0438\u0442\u0435 \u0438\u0437\u043C\u0435\u043D\u0438\u0442\u044C ' + field.label + '?')) return;
        saveBtn.textContent = '\u0421\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0435...';
        saveBtn.disabled = true;
        const body = {};
        body[field.key] = newVal || null;
        const resp = await API.put('/worker/personal', body);
        if (resp && resp.ok) {
          pe[field.key] = newVal || null;
          renderPersonalFields();
          sheet.remove();
          F.Toast({ message: '\u0414\u0430\u043D\u043D\u044B\u0435 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u044B', type: 'success' });
        } else {
          saveBtn.textContent = '\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C';
          saveBtn.disabled = false;
          F.Toast({ message: (resp && resp.error) || '\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F', type: 'error' });
        }
      },
    }, '\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C');

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(saveBtn);
    sheetContent.appendChild(btnRow);

    const sheet = F.BottomSheet({ title: '\u0418\u0437\u043C\u0435\u043D\u0438\u0442\u044C ' + field.label, content: sheetContent });
    setTimeout(() => inputEl.focus(), 300);
  }

  renderPersonalFields();
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

async function openTimesheet(workId, t) {
  const sheetContent = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '0' } });

  // Loading state
  sheetContent.appendChild(el('div', {
    style: { color: t.textSec, fontSize: '0.875rem', textAlign: 'center', padding: '24px 0' },
  }, '\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430 \u0442\u0430\u0431\u0435\u043B\u044F...'));

  const sheet = F.BottomSheet({ title: '\uD83D\uDCCB \u041C\u043E\u0439 \u0442\u0430\u0431\u0435\u043B\u044C', content: sheetContent });

  const tsData = await API.fetch('/worker/timesheet/' + workId).catch(() => null);
  sheetContent.replaceChildren();

  if (!tsData || !tsData.days || tsData.days.length === 0) {
    sheetContent.appendChild(el('div', {
      style: { color: t.textSec, fontSize: '0.875rem', textAlign: 'center', padding: '24px 0' },
    }, '\u041D\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0445 \u0442\u0430\u0431\u0435\u043B\u044F'));
    return;
  }

  // Work title
  if (tsData.work && tsData.work.work_title) {
    sheetContent.appendChild(el('div', {
      style: { color: t.textSec, fontSize: '0.8125rem', marginBottom: '12px', textAlign: 'center' },
    }, tsData.work.work_title));
  }

  // Header row
  const headerRow = el('div', {
    style: { display: 'flex', alignItems: 'center', padding: '6px 0', borderBottom: '2px solid ' + t.border, marginBottom: '4px' },
  });
  const hCols = [
    { text: '\u0414\u0430\u0442\u0430', flex: '1' },
    { text: '\u0421\u043C\u0435\u043D\u0430', flex: '0 0 40px', align: 'center' },
    { text: '\u0411\u0430\u043B', flex: '0 0 50px', align: 'right' },
    { text: '\u0421\u0443\u043C\u043C\u0430', flex: '0 0 70px', align: 'right' },
  ];
  for (const h of hCols) {
    headerRow.appendChild(el('div', {
      style: { flex: h.flex, color: t.textTer, fontSize: '0.6875rem', fontWeight: '600', textTransform: 'uppercase', textAlign: h.align || 'left' },
    }, h.text));
  }
  sheetContent.appendChild(headerRow);

  // Day rows (reverse to show newest first)
  const days = [...tsData.days].reverse();
  for (const day of days) {
    const d = new Date(day.date);
    const dateFmt = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });

    const shiftIcon = day.shift === 'night' ? '\uD83C\uDF19' : day.shift === 'half' ? '\u00BD' : day.shift === 'travel' ? '\uD83D\uDE97' : '\u2600\uFE0F';
    const hrs = parseFloat(day.hours_worked || 0);
    const earned = parseFloat(day.amount_earned || 0);

    const isCompleted = day.status === 'completed';
    const rowColor = isCompleted ? t.text : t.textTer;

    const row = el('div', {
      style: { display: 'flex', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid ' + t.border + '30' },
    });

    row.appendChild(el('div', { style: { flex: '1', color: rowColor, fontSize: '0.875rem', fontWeight: '500' } }, dateFmt));
    row.appendChild(el('div', { style: { flex: '0 0 40px', textAlign: 'center', fontSize: '1rem' } }, shiftIcon));
    row.appendChild(el('div', { style: { flex: '0 0 50px', textAlign: 'right', color: rowColor, fontSize: '0.8125rem' } }, hrs ? Utils.formatHours(hrs) : '\u2014'));
    row.appendChild(el('div', { style: { flex: '0 0 70px', textAlign: 'right', color: isCompleted ? t.gold : t.textTer, fontSize: '0.875rem', fontWeight: '600' } },
      earned ? Utils.formatMoney(earned) + ' \u20BD' : '\u2014'));

    sheetContent.appendChild(row);
  }

  // Summary footer
  const summary = tsData.summary || {};
  const summaryRow = el('div', {
    style: {
      display: 'flex', alignItems: 'center', padding: '12px 0 4px',
      borderTop: '2px solid ' + t.border, marginTop: '4px',
    },
  });
  summaryRow.appendChild(el('div', {
    style: { flex: '1', color: t.text, fontSize: '0.875rem', fontWeight: '700' },
  }, '\u0418\u0442\u043E\u0433\u043E: ' + (summary.total_days || days.length) + ' \u0434\u043D.'));
  summaryRow.appendChild(el('div', {
    style: { flex: '0 0 50px', textAlign: 'right', color: t.text, fontSize: '0.8125rem', fontWeight: '600' },
  }, Utils.formatHours(summary.total_hours || 0)));
  summaryRow.appendChild(el('div', {
    style: { flex: '0 0 70px', textAlign: 'right', color: t.gold, fontSize: '0.9375rem', fontWeight: '700' },
  }, Utils.formatMoney(summary.total_earned || 0) + ' \u20BD'));
  sheetContent.appendChild(summaryRow);
}

Router.register('/field/profile', ProfilePage);
})();
