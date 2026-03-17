/**
 * ASGARD CRM — Mobile v3 / Дружина (Сотрудники)
 * Окно 3, Сессия 8 — FIX: async skeleton, Toast in catch
 */
var PersonnelPage = {
  render: function () {
    var t = DS.t;
    var el = Utils.el;
    var ROLE_MAP = {
      worker: 'Рабочий', foreman: 'Бригадир', welder: 'Сварщик', fitter: 'Слесарь',
      cleaner: 'Специалист ХО', rigger: 'Стропальщик', driver: 'Водитель',
      engineer: 'Инженер', master: 'Мастер',
    };
    var employees = [];
    var rolePills = [{ label: 'Все', value: 'all', active: true }];

    var page = M.TablePage({
      title: 'Дружина', subtitle: 'ПЕРСОНАЛ', back: true, backHref: '/home',
      items: [], search: true,
      filter: {
        pills: rolePills,
        filterFn: function (item, val) { return val === 'all' || item.role_tag === val; },
      },
      renderItem: function (emp) {
        var rating = emp.rating_avg || 0;
        var card = el('div', { style: {
          display: 'flex', gap: '14px', alignItems: 'center', padding: '14px 16px',
          background: t.surface, borderRadius: '18px', border: '1px solid ' + t.border, cursor: 'pointer',
        } });
        card.appendChild(M.Avatar({ name: emp.fio || emp.name || '?', size: 48, status: (emp.status === 'active' || emp.is_active) ? 'online' : undefined }));
        var info = el('div', { style: { flex: '1', minWidth: '0' } });
        info.appendChild(el('div', { style: Object.assign({}, DS.font('md'), { color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }) }, emp.fio || emp.name || '—'));
        info.appendChild(el('div', { style: Object.assign({}, DS.font('sm'), { color: t.textSec }) }, ROLE_MAP[emp.role_tag] || emp.role_tag || emp.position || '—'));
        if (rating > 0) {
          var rr = el('div', { style: { display: 'flex', gap: '2px', marginTop: '4px' } });
          for (var i = 0; i < 5; i++) rr.appendChild(el('span', { style: { fontSize: '12px', color: i < Math.round(rating) ? t.gold : t.textTer } }, i < Math.round(rating) ? '★' : '☆'));
          info.appendChild(rr);
        }
        card.appendChild(info);
        if (emp.city) card.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: t.textTer, flexShrink: 0 }) }, emp.city));
        card.addEventListener('click', function () { openProfile(emp); });
        return card;
      },
      empty: M.Empty({ text: 'Дружина пуста', icon: '⚔️' }),
      onRefresh: function () {
        return API.fetch('/staff/employees?limit=1000').catch(function () { return API.fetch('/data/employees'); }).then(function (resp) {
          employees = API.extractRows(resp);
          employees.sort(function (a, b) { return (b.rating_avg || 0) - (a.rating_avg || 0) || String(a.fio || '').localeCompare(String(b.fio || ''), 'ru'); });
          // Build role pills dynamically
          var roleSet = new Set();
          employees.forEach(function (e) { if (e.role_tag) roleSet.add(e.role_tag); });
          rolePills.length = 1; // keep "Все"
          roleSet.forEach(function (r) { rolePills.push({ label: ROLE_MAP[r] || r, value: r }); });
          return employees;
        }).catch(function (e) { console.error('[Personnel] Load failed:', e); M.Toast({ message: 'Ошибка загрузки дружины', type: 'error' }); return []; });
      },
    });
    var listEl = page.querySelector('.asgard-table-page__list');
    if (listEl) listEl.replaceChildren(M.Skeleton({ type: 'card', count: 5 }));
    setTimeout(function () { window.dispatchEvent(new Event('asgard:refresh')); }, 0);

    function openProfile(emp) {
      var fields = [
        { label: 'ФИО', value: emp.fio || emp.name || '—' },
        { label: 'Должность', value: ROLE_MAP[emp.role_tag] || emp.role_tag || emp.position || '—' },
        { label: 'Город', value: emp.city || '—' },
      ];
      if (emp.phone) fields.push({ label: 'Телефон', value: emp.phone, type: 'phone' });
      if (emp.rating_avg) fields.push({ label: 'Рейтинг', value: emp.rating_avg + ' / 5' });
      var permits = Array.isArray(emp.permits) ? emp.permits : [];
      if (permits.length) fields.push({ label: 'Допуски', value: permits.join(', ') });
      if (emp.passport_series) fields.push({ label: 'Паспорт', value: emp.passport_series + ' ' + (emp.passport_number || '') });
      if (emp.inn) fields.push({ label: 'ИНН', value: emp.inn, copy: true });
      if (emp.snils) fields.push({ label: 'СНИЛС', value: emp.snils, copy: true });
      var content = el('div');
      var header = el('div', { style: { display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '16px' } });
      header.appendChild(M.Avatar({ name: emp.fio || emp.name || '?', size: 56 }));
      var hInfo = el('div');
      hInfo.appendChild(el('div', { style: Object.assign({}, DS.font('lg'), { color: t.text }) }, emp.fio || emp.name || '—'));
      hInfo.appendChild(el('div', { style: Object.assign({}, DS.font('sm'), { color: t.textSec }) }, ROLE_MAP[emp.role_tag] || emp.role_tag || ''));
      header.appendChild(hInfo);
      content.appendChild(header);
      content.appendChild(M.DetailFields({ fields: fields }));
      var btns = el('div', { style: { display: 'flex', gap: '8px', marginTop: '16px' } });
      if (emp.phone) {
        btns.appendChild(M.FullWidthBtn({ label: '📞 Позвонить', variant: 'secondary', onClick: function () { window.location.href = 'tel:' + emp.phone; } }));
      }
      btns.appendChild(M.FullWidthBtn({ label: '📋 Анкета', variant: 'secondary', onClick: function () { Router.navigate('/worker-profile/' + emp.id); } }));
      content.appendChild(btns);
      M.BottomSheet({ title: emp.fio || 'Сотрудник', content: content, fullscreen: true });
    }
    return page;
  },
};
Router.register('/personnel', PersonnelPage);
if (typeof window !== 'undefined') window.PersonnelPage = PersonnelPage;
