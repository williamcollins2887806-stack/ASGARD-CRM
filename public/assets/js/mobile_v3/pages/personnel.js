/**
 * ASGARD CRM — Mobile v3 / Дружина (Сотрудники)
 * Окно 3, Сессия 8 — 14.03.2026
 */
const PersonnelPage = {
  async render() {
    const t = DS.t;
    const el = Utils.el;

    const ROLE_MAP = {
      worker:   'Рабочий',
      foreman:  'Бригадир',
      welder:   'Сварщик',
      fitter:   'Слесарь',
      cleaner:  'Специалист ХО',
      rigger:   'Стропальщик',
      driver:   'Водитель',
      engineer: 'Инженер',
      master:   'Мастер',
    };

    let employees = [];
    try {
      const resp = await API.fetch('/staff/employees?limit=1000').catch(() => API.fetch('/data/employees'));
      employees = resp.items || resp.data || (Array.isArray(resp) ? resp : []);
    } catch (e) { console.error('[Personnel] load error', e); }

    // Sort by rating desc
    employees.sort((a, b) => (b.rating_avg || 0) - (a.rating_avg || 0) || String(a.fio || '').localeCompare(String(b.fio || ''), 'ru'));

    // Collect unique roles for filter
    const roleSet = new Set();
    employees.forEach(e => { if (e.role_tag) roleSet.add(e.role_tag); });
    const rolePills = [{ label: 'Все', value: 'all', active: true }];
    roleSet.forEach(r => rolePills.push({ label: ROLE_MAP[r] || r, value: r }));

    const page = M.TablePage({
      title: 'Дружина',
      subtitle: 'ПЕРСОНАЛ',
      back: true,
      backHref: '/home',
      items: employees,
      search: true,
      stats: [
        { icon: '⚔️', value: employees.length, label: 'Всего', color: t.blue },
        { icon: '✅', value: employees.filter(e => e.status === 'active' || e.is_active).length, label: 'Активных', color: t.green },
      ],
      filter: {
        pills: rolePills.length > 2 ? rolePills : undefined,
        filterFn: (item, val) => val === 'all' || item.role_tag === val,
      },
      renderItem: (emp) => {
        const rating = emp.rating_avg || 0;
        const stars = '★'.repeat(Math.round(rating)) + '☆'.repeat(5 - Math.round(rating));

        // Employee card (custom layout matching test.js employee card pattern)
        const card = el('div', { style: {
          display: 'flex', gap: '14px', alignItems: 'center',
          padding: '14px 16px', background: t.surface,
          borderRadius: '18px', border: '1px solid ' + t.border,
          cursor: 'pointer',
        } });

        card.appendChild(M.Avatar({
          name: emp.fio || emp.name || '?',
          size: 48,
          status: (emp.status === 'active' || emp.is_active) ? 'online' : undefined,
        }));

        const info = el('div', { style: { flex: '1', minWidth: '0' } });
        info.appendChild(el('div', { style: { ...DS.font('md'), color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, emp.fio || emp.name || '—'));
        info.appendChild(el('div', { style: { ...DS.font('sm'), color: t.textSec } }, ROLE_MAP[emp.role_tag] || emp.role_tag || emp.position || '—'));
        if (rating > 0) {
          const rr = el('div', { style: { display: 'flex', gap: '2px', marginTop: '4px' } });
          for (let i = 0; i < 5; i++) {
            rr.appendChild(el('span', { style: { fontSize: '12px', color: i < Math.round(rating) ? t.gold : t.textTer } }, i < Math.round(rating) ? '★' : '☆'));
          }
          info.appendChild(rr);
        }
        card.appendChild(info);

        if (emp.city) {
          card.appendChild(el('div', { style: { ...DS.font('xs'), color: t.textTer, flexShrink: 0 } }, emp.city));
        }

        card.addEventListener('click', () => openProfile(emp));
        return card;
      },
      empty: M.Empty({ text: 'Дружина пуста', icon: '⚔️' }),
    });

    function openProfile(emp) {
      const fields = [
        { label: 'ФИО', value: emp.fio || emp.name || '—' },
        { label: 'Должность', value: ROLE_MAP[emp.role_tag] || emp.role_tag || emp.position || '—' },
        { label: 'Город', value: emp.city || '—' },
      ];
      if (emp.phone) fields.push({ label: 'Телефон', value: emp.phone, type: 'phone' });
      if (emp.rating_avg) fields.push({ label: 'Рейтинг', value: emp.rating_avg + ' / 5' });

      const permits = Array.isArray(emp.permits) ? emp.permits : [];
      if (permits.length) {
        fields.push({ label: 'Допуски', value: permits.join(', ') });
      }

      if (emp.passport_series) fields.push({ label: 'Паспорт', value: emp.passport_series + ' ' + (emp.passport_number || '') });
      if (emp.inn) fields.push({ label: 'ИНН', value: emp.inn, copy: true });
      if (emp.snils) fields.push({ label: 'СНИЛС', value: emp.snils, copy: true });

      const content = el('div');

      // Avatar + name header
      const header = el('div', { style: { display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '16px' } });
      header.appendChild(M.Avatar({ name: emp.fio || emp.name || '?', size: 56 }));
      const hInfo = el('div');
      hInfo.appendChild(el('div', { style: { ...DS.font('lg'), color: t.text } }, emp.fio || emp.name || '—'));
      hInfo.appendChild(el('div', { style: { ...DS.font('sm'), color: t.textSec } }, ROLE_MAP[emp.role_tag] || emp.role_tag || ''));
      header.appendChild(hInfo);
      content.appendChild(header);

      content.appendChild(M.DetailFields({ fields }));

      if (emp.phone) {
        const btns = el('div', { style: { display: 'flex', gap: '8px', marginTop: '16px' } });
        btns.appendChild(M.FullWidthBtn({
          label: '📞 Позвонить',
          variant: 'secondary',
          onClick: () => { window.location.href = 'tel:' + emp.phone; },
        }));
        content.appendChild(btns);
      }

      M.BottomSheet({ title: emp.fio || 'Сотрудник', content, fullscreen: true });
    }

    return page;
  },
};

Router.register('/personnel', PersonnelPage);
if (typeof window !== 'undefined') window.PersonnelPage = PersonnelPage;
