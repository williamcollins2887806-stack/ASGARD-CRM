/**
 * ASGARD CRM — Mobile v3: Контрагенты
 * Route: #/customers
 * Данные: AsgardDB.all('customers')
 */
window.MobileCustomers = (function () {
  'use strict';

  var el = Utils.el;

  async function loadItems() {
    try {
      if (typeof AsgardDB !== 'undefined') {
        var list = (await AsgardDB.all('customers')) || [];
        return list.sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
      }
    } catch (_) {}
    try {
      var data = await API.fetch('/data/customers');
      var items = API.extractRows(data);
      return items.sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
    } catch (_) {}
    return [];
  }

  /* ── Детальная модалка ── */
  function openDetail(cust) {
    var content = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '16px' } });

    var fields = [
      { label: 'ИНН', value: cust.inn || '—', copy: true },
      { label: 'Название', value: cust.name || cust.short_name || '—' },
    ];
    if (cust.full_name) fields.push({ label: 'Полное название', value: cust.full_name });
    if (cust.contact_person) fields.push({ label: 'Контакт', value: cust.contact_person });
    if (cust.phone) fields.push({ label: 'Телефон', value: cust.phone, type: 'phone' });
    if (cust.email) fields.push({ label: 'Email', value: cust.email });
    if (cust.address || cust.legal_address) fields.push({ label: 'Адрес', value: cust.address || cust.legal_address });
    if (cust.kpp) fields.push({ label: 'КПП', value: cust.kpp });
    if (cust.ogrn) fields.push({ label: 'ОГРН', value: cust.ogrn });
    if (cust.region) fields.push({ label: 'Регион', value: cust.region });
    if (cust.category) fields.push({ label: 'Категория', value: cust.category });
    if (cust.notes || cust.comment) fields.push({ label: 'Примечания', value: cust.notes || cust.comment });

    content.appendChild(M.DetailFields({ fields: fields }));

    // Actions
    var actRow = el('div', { style: { display: 'flex', gap: '8px' } });
    actRow.appendChild(M.FullWidthBtn({
      label: '✏️ Редактировать',
      variant: 'secondary',
      onClick: function () {
        document.querySelectorAll('.asgard-sheet-overlay').forEach(function (o) { o.remove(); });
        Utils.unlockScroll();
        openEditForm(cust);
      },
    }));
    actRow.appendChild(M.FullWidthBtn({
      label: '🏆 Тендеры',
      variant: 'secondary',
      onClick: function () {
        document.querySelectorAll('.asgard-sheet-overlay').forEach(function (o) { o.remove(); });
        Utils.unlockScroll();
        Router.navigate('/tenders');
      },
    }));
    content.appendChild(actRow);

    M.BottomSheet({ title: cust.name || cust.short_name || 'Контрагент', content: content, fullscreen: true });
  }

  /* ── Форма создания/редактирования ── */
  function openEditForm(cust) {
    var isEdit = !!cust;
    var data = cust || {};

    var content = M.Form({
      fields: [
        { id: 'inn', label: 'ИНН', value: data.inn || '', required: true },
        { id: 'name', label: 'Краткое наименование', value: data.name || data.short_name || '', required: true },
        { id: 'full_name', label: 'Полное наименование', value: data.full_name || '' },
        { id: 'contact_person', label: 'Контактное лицо', value: data.contact_person || '' },
        { id: 'phone', label: 'Телефон', value: data.phone || '' },
        { id: 'email', label: 'Email', type: 'email', value: data.email || '' },
        { id: 'address', label: 'Адрес', value: data.address || data.legal_address || '' },
        { id: 'kpp', label: 'КПП', value: data.kpp || '' },
        { id: 'notes', label: 'Примечания', type: 'textarea', value: data.notes || data.comment || '' },
      ],
      submitLabel: isEdit ? 'Сохранить' : 'Создать',
      onSubmit: async function (formData) {
        try {
          var obj = {
            inn: formData.inn,
            name: formData.name,
            short_name: formData.name,
            full_name: formData.full_name || formData.name,
            contact_person: formData.contact_person,
            phone: formData.phone,
            email: formData.email,
            address: formData.address,
            legal_address: formData.address,
            kpp: formData.kpp,
            notes: formData.notes,
          };

          if (typeof AsgardDB !== 'undefined') {
            if (isEdit) {
              var cur = await AsgardDB.get('customers', data.inn || data.id);
              if (cur) {
                Object.assign(cur, obj);
                cur.updated_at = new Date().toISOString();
                await AsgardDB.put('customers', cur);
              }
            } else {
              obj.created_at = new Date().toISOString();
              await AsgardDB.add('customers', obj);
            }
          }

          try {
            if (isEdit) {
              await API.fetch('/data/customers/' + (data.inn || data.id), { method: 'PUT', body: obj });
            } else {
              await API.fetch('/data/customers', { method: 'POST', body: obj });
            }
          } catch (_) {}

          M.Toast({ message: isEdit ? 'Контрагент обновлён' : 'Контрагент создан', type: 'success' });
          document.querySelectorAll('.asgard-sheet-overlay').forEach(function (o) { o.remove(); });
          Utils.unlockScroll();
          window.dispatchEvent(new Event('asgard:refresh'));
        } catch (e) {
          M.Toast({ message: 'Ошибка: ' + e.message, type: 'error' });
        }
      },
    });

    // INN lookup button
    var innLookup = el('div', { style: { padding: '0 0 8px' } });
    innLookup.appendChild(M.FullWidthBtn({
      label: '🔍 Найти по ИНН',
      variant: 'secondary',
      onClick: async function () {
        var innInput = content.querySelector('input');
        var inn = innInput ? innInput.value.trim() : '';
        if (!inn || inn.length < 10) {
          M.Toast({ message: 'Введите ИНН (10-12 цифр)', type: 'error' });
          return;
        }
        try {
          var resp = await API.fetch('/customers/lookup/' + inn);
          if (resp && resp.name) {
            M.Toast({ message: 'Найден: ' + resp.name, type: 'success' });
            // Fill form fields
            var inputs = content.querySelectorAll('input, textarea');
            inputs.forEach(function (inp) {
              var id = inp.getAttribute('data-field-id') || inp.id || '';
              if (resp[id] && !inp.value) inp.value = resp[id];
            });
          } else {
            M.Toast({ message: 'Организация не найдена', type: 'info' });
          }
        } catch (e) {
          M.Toast({ message: 'Не удалось найти по ИНН', type: 'error' });
        }
      },
    }));

    var wrapper = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } });
    if (!isEdit) wrapper.appendChild(innLookup);
    wrapper.appendChild(content);

    M.BottomSheet({
      title: isEdit ? 'Редактировать контрагента' : 'Новый контрагент',
      content: wrapper,
      fullscreen: true,
    });
  }

  /* ── Карточка ── */
  function renderCard(cust, idx) {
    var fields = [];
    if (cust.inn) fields.push({ label: 'ИНН', value: cust.inn });
    if (cust.contact_person) fields.push({ label: 'Контакт', value: cust.contact_person });
    if (cust.phone) fields.push({ label: 'Тел', value: cust.phone });

    return M.Card({
      title: cust.name || cust.short_name || 'Контрагент',
      subtitle: cust.full_name || '',
      fields: fields,
      onClick: function () { openDetail(cust); },
      animDelay: idx * 0.02,
    });
  }

  /* ── Рендер ── */
  async function render() {
    var items = [];

    var page = M.TablePage({
      title: 'Контрагенты',
      subtitle: 'Заказчики и партнёры',
      back: true,
      backHref: '/home',
      search: true,
      items: items,
      renderItem: renderCard,
      empty: M.Empty({ text: 'Нет контрагентов', icon: '🏢' }),
      onRefresh: async function () {
        try {
          return await loadItems();
        } catch (e) {
          M.Toast({ message: 'Ошибка загрузки контрагентов', type: 'error' });
          return [];
        }
      },
      fab: {
        icon: '+',
        onClick: function () { openEditForm(null); },
      },
    });

    // Show skeleton while initial data loads
    var listEl = page.querySelector('.asgard-table-page__list');
    if (listEl) listEl.replaceChildren(M.Skeleton({ type: 'card', count: 5 }));
    setTimeout(function () { window.dispatchEvent(new Event('asgard:refresh')); }, 0);

    return page;
  }

  return { render: render };
})();

if (typeof Router !== 'undefined') {
  Router.register('/customers', window.MobileCustomers);
}
