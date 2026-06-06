window.AsgardSuppliersPage = (function() {
  'use strict';

  /* ─── Shared helpers (same pattern as procurement-page.js) ─── */
  const UI        = window.AsgardUI || {};
  const $         = UI.$ || (s => document.querySelector(s));
  const esc       = UI.esc || (s => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])));
  const toast     = UI.toast || ((t, m, type) => console.log('[' + type + '] ' + t + ': ' + m));
  const showModal = UI.showModal || (() => {});
  const closeModal= UI.closeModal || (() => {});

  function hdr() {
    const t = localStorage.getItem('asgard_token') || localStorage.getItem('auth_token');
    return { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' };
  }
  async function apiFetch(url, opts) {
    opts = opts || {};
    const r = await fetch(url, Object.assign({ headers: hdr() }, opts));
    if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + url);
    return r.json();
  }
  async function apiPost(url, body) { return apiFetch(url, { method: 'POST', body: JSON.stringify(body || {}) }); }
  async function apiPut(url, body)  { return apiFetch(url, { method: 'PUT',  body: JSON.stringify(body || {}) }); }
  async function apiDel(url)        { return apiFetch(url, { method: 'DELETE' }); }

  /* ─── Formatters ─── */
  const money = v  => v != null ? Number(v).toLocaleString('ru-RU') + ' ₽' : '—';
  const dt    = d  => d ? new Date(d).toLocaleDateString('ru-RU') : '—';
  const dtFull= d  => d ? new Date(d).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';

  const CAT_LABELS = { materials: 'Материалы', equipment_rental: 'Аренда техники', services: 'Услуги', other: 'Прочее' };
  const SRC_LABELS = { manual: 'Вручную', quote: 'КП', ai_search: 'AI-поиск', market_monitoring: 'Мониторинг', procurement: 'Из закупки' };

  function catBadge(c) {
    const lbl = CAT_LABELS[c] || c || '—';
    return '<span class="sup-cat sup-cat--' + esc(c || 'other') + '">' + esc(lbl) + '</span>';
  }
  function srcBadge(s) {
    const lbl = SRC_LABELS[s] || s || '—';
    return '<span class="sup-src sup-src--' + esc(s || 'manual') + '">' + esc(lbl) + '</span>';
  }
  function activeBadge(v) {
    return v ? '<span class="sup-active sup-active--yes">Активен</span>'
             : '<span class="sup-active sup-active--no">Неактивен</span>';
  }
  function stars(rating) {
    const r = Number(rating) || 0;
    let html = '<span class="sup-stars">';
    for (let i = 1; i <= 5; i++) {
      html += '<span class="sup-stars__star' + (i <= r ? ' sup-stars__star--on' : '') + '">★</span>';
    }
    return html + '</span>';
  }

  /* ─── State ─── */
  let _user = null;
  let _activeTab = 'suppliers';
  let _suppFilters = { search: '', category: '', is_active: '' };
  let _catFilters  = { search: '', category_id: '' };
  let _priceFilters= { search: '', source: '', date_from: '', date_to: '' };
  let _categories  = [];  // product categories cache
  let _pageEl = null;

  function isAdmin() { return _user && _user.role === 'ADMIN'; }
  function canWrite() { return _user && ['PROC','ADMIN'].includes(_user.role); }

  /* ═══════════════════════════════════════════════════════════
     TAB SWITCHING
  ═══════════════════════════════════════════════════════════ */
  function switchTab(tab) {
    _activeTab = tab;
    if (!_pageEl) return;
    _pageEl.querySelectorAll('.sup-tab').forEach(t => {
      t.classList.toggle('sup-tab--active', t.dataset.tab === tab);
    });
    const content = _pageEl.querySelector('#sup-tab-content');
    if (!content) return;
    if (tab === 'suppliers')  renderSuppliersTab(content);
    else if (tab === 'catalog') renderCatalogTab(content);
    else if (tab === 'prices')  renderPricesTab(content);
  }

  /* ═══════════════════════════════════════════════════════════
     TAB 1 — ПОСТАВЩИКИ
  ═══════════════════════════════════════════════════════════ */
  async function renderSuppliersTab(el) {
    el.innerHTML = `
      <div class="sup-toolbar">
        <input type="text" id="sup-s-search" placeholder="Поиск по названию / ИНН..." value="${esc(_suppFilters.search)}">
        <div id="sup-s-cat_w" style="display:inline-block;min-width:160px"></div>
        <div id="sup-s-active_w" style="display:inline-block;min-width:140px"></div>
        ${canWrite() ? '<button class="btn primary" id="sup-s-create">+ Поставщик</button>' : ''}
      </div>
      <div id="sup-s-table"></div>`;

    /* Category filter */
    const catOpts = [
      { value: '', label: 'Все категории' },
      { value: 'materials',        label: 'Материалы' },
      { value: 'equipment_rental', label: 'Аренда техники' },
      { value: 'services',         label: 'Услуги' },
      { value: 'other',            label: 'Прочее' }
    ];
    el.querySelector('#sup-s-cat_w').appendChild(
      CRSelect.create({ id: 'sup-s-cat', options: catOpts, value: _suppFilters.category,
        onChange: v => { _suppFilters.category = v; loadSuppliers(el.querySelector('#sup-s-table')); }
      })
    );

    const activeOpts = [
      { value: '', label: 'Все' },
      { value: 'true', label: 'Активные' },
      { value: 'false', label: 'Неактивные' }
    ];
    el.querySelector('#sup-s-active_w').appendChild(
      CRSelect.create({ id: 'sup-s-active', options: activeOpts, value: _suppFilters.is_active,
        onChange: v => { _suppFilters.is_active = v; loadSuppliers(el.querySelector('#sup-s-table')); }
      })
    );

    let tmr;
    el.querySelector('#sup-s-search').oninput = e => {
      clearTimeout(tmr);
      tmr = setTimeout(() => { _suppFilters.search = e.target.value; loadSuppliers(el.querySelector('#sup-s-table')); }, 300);
    };

    const createBtn = el.querySelector('#sup-s-create');
    if (createBtn) createBtn.onclick = () => openSupplierCreateModal();

    await loadSuppliers(el.querySelector('#sup-s-table'));
  }

  async function loadSuppliers(tableEl) {
    tableEl.innerHTML = '<div class="sup-empty">Загрузка...</div>';
    try {
      const params = new URLSearchParams();
      if (_suppFilters.search)    params.append('search',    _suppFilters.search);
      if (_suppFilters.category)  params.append('category',  _suppFilters.category);
      if (_suppFilters.is_active) params.append('is_active', _suppFilters.is_active);
      const d = await apiFetch('/api/suppliers?' + params.toString());
      renderSuppliersTable(d.items || [], tableEl);
    } catch(e) {
      tableEl.innerHTML = '<div class="sup-empty" style="color:var(--err)">Ошибка загрузки: ' + esc(e.message) + '</div>';
    }
  }

  function renderSuppliersTable(items, el) {
    if (!items.length) { el.innerHTML = '<div class="sup-empty">Поставщиков нет</div>'; return; }
    el.innerHTML = `<div class="sup-table-wrap"><table class="sup-table proc-items-table">
      <thead><tr>
        <th>Название</th><th>ИНН</th><th>Телефон</th><th>Категория</th>
        <th>Рейтинг</th><th>Контакты</th><th>Статус</th>
      </tr></thead>
      <tbody>${items.map(r => `<tr data-id="${r.id}">
        <td><strong>${esc(r.name)}</strong></td>
        <td style="color:var(--t2)">${esc(r.inn || '—')}</td>
        <td>${esc(r.phone || '—')}</td>
        <td>${catBadge(r.category)}</td>
        <td>${stars(r.rating)}</td>
        <td style="text-align:center">${r.contacts_count || 0}</td>
        <td>${activeBadge(r.is_active !== false)}</td>
      </tr>`).join('')}</tbody></table></div>`;
    el.querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => openSupplierDetail(+tr.dataset.id));
  }

  /* ─ Supplier Detail Modal ─ */
  async function openSupplierDetail(id) {
    try {
      const [d, statsD] = await Promise.all([
        apiFetch('/api/suppliers/' + id),
        apiFetch('/api/suppliers/' + id + '/stats').catch(() => null)
      ]);
      const s = d.item || d;
      const contacts = d.contacts || [];
      const stats   = statsD && statsD.summary ? statsD.summary : null;
      const topItems= statsD && statsD.top_items ? statsD.top_items : [];

      let html = `<div class="sup-detail">
        <div class="sup-detail__header">
          <div>
            <h2 class="sup-detail__title">${esc(s.name)}</h2>
            <div style="margin-top:4px;display:flex;gap:var(--sp-2);flex-wrap:wrap">
              ${catBadge(s.category)} ${activeBadge(s.is_active !== false)}
            </div>
          </div>
          <div style="display:flex;gap:var(--sp-2)">
            ${stars(s.rating)}
          </div>
        </div>`;

      /* ── Поля поставщика ── */
      html += `<div class="sup-detail__section">
        <div class="sup-detail__section-title">Реквизиты</div>
        <form id="sup-edit-form">
        <div class="sup-form">
          <label>Название <input name="name" value="${esc(s.name)}" ${canWrite()?'':'readonly'}></label>
          <label>ИНН <input name="inn" value="${esc(s.inn||'')}" ${canWrite()?'':'readonly'}></label>
          <label>КПП <input name="kpp" value="${esc(s.kpp||'')}" ${canWrite()?'':'readonly'}></label>
          <label>ОГРН <input name="ogrn" value="${esc(s.ogrn||'')}" ${canWrite()?'':'readonly'}></label>
          <label>Телефон <input name="phone" value="${esc(s.phone||'')}" ${canWrite()?'':'readonly'}></label>
          <label>Email <input name="email" value="${esc(s.email||'')}" ${canWrite()?'':'readonly'}></label>
          <label>Сайт <input name="website" value="${esc(s.website||'')}" ${canWrite()?'':'readonly'}></label>
          <label>Адрес <input name="address" value="${esc(s.address||'')}" ${canWrite()?'':'readonly'}></label>
          <label>Рейтинг
            <div id="sup-edit-cat_w"></div>
          </label>
          <label>Оценка (1-5) <input name="rating" type="number" min="0" max="5" value="${s.rating||''}" ${canWrite()?'':'readonly'}></label>
          <label class="span2">Примечание <textarea name="notes" rows="2" ${canWrite()?'':'readonly'}>${esc(s.notes||'')}</textarea></label>
          ${canWrite() ? `<div class="span2" style="display:flex;gap:var(--sp-2);align-items:center">
            <label style="flex-direction:row;align-items:center;gap:var(--sp-1);color:var(--t1)">
              <input type="checkbox" name="is_active" ${s.is_active!==false?'checked':''}>
              Активен
            </label>
            <button type="submit" class="btn primary" style="margin-left:auto">💾 Сохранить</button>
            ${isAdmin() ? `<button type="button" id="sup-del-btn" class="btn ghost" style="color:var(--err)">🗑 Удалить</button>` : ''}
          </div>` : ''}
        </div>
        </form>
      </div>`;

      /* ── Контакты ── */
      html += `<div class="sup-detail__section">
        <div class="sup-detail__section-title">Контакты (${contacts.length})
          ${canWrite() ? `<button class="btn ghost" id="sup-add-contact" style="font-size:12px;padding:2px 8px;margin-left:var(--sp-2)">+ Добавить</button>` : ''}
        </div>
        <div id="sup-contacts-list">`;
      if (contacts.length) {
        contacts.forEach(c => {
          html += `<div class="sup-contact-row" data-cid="${c.id}">
            <span class="sup-contact-row__name">${esc(c.full_name)}</span>
            <span class="sup-contact-row__role">${esc(c.role||'')}</span>
            <span class="sup-contact-row__links">
              ${c.phone  ? `<a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : ''}
              ${c.email  ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : ''}
              ${c.telegram ? `<a href="https://t.me/${esc(c.telegram)}" target="_blank">@${esc(c.telegram)}</a>` : ''}
            </span>
            <span class="sup-contact-primary" title="${c.is_primary?'Основной':'Сделать основным'}">${c.is_primary ? '⭐' : '☆'}</span>
            ${canWrite() ? `<button class="btn ghost" style="font-size:11px;padding:2px 6px;color:var(--err)" data-del-cid="${c.id}">✕</button>` : ''}
          </div>`;
        });
      } else {
        html += '<div style="color:var(--t2);padding:var(--sp-2);font-size:13px">Контактов нет</div>';
      }
      html += `</div></div>`;

      /* ── Статистика ── */
      if (stats) {
        html += `<div class="sup-detail__section">
          <div class="sup-detail__section-title">Статистика</div>
          <div class="sup-stat-row">
            <div class="sup-stat-card"><div class="sup-stat-card__val">${stats.deals_count || 0}</div><div class="sup-stat-card__lbl">Закупок</div></div>
            <div class="sup-stat-card"><div class="sup-stat-card__val">${stats.price_points || 0}</div><div class="sup-stat-card__lbl">Записей цен</div></div>
            <div class="sup-stat-card"><div class="sup-stat-card__val">${dt(stats.last_price_at)}</div><div class="sup-stat-card__lbl">Последняя цена</div></div>
          </div>`;
        if (topItems.length) {
          html += `<div class="sup-detail__section-title" style="margin-top:var(--sp-2)">Топ товаров</div>`;
          topItems.forEach(ti => {
            html += `<div class="sup-top-item">
              <span class="sup-top-item__name">${esc(ti.item_name)}</span>
              <span class="sup-top-item__meta">
                <span>${ti.cnt} поз.</span>
                <span>${money(ti.avg_price)}</span>
              </span>
            </div>`;
          });
        }
        html += `</div>`;
      }

      /* ── История цен ── */
      html += `<div class="sup-detail__section" id="sup-ph-section">
        <div class="sup-detail__section-title">История цен</div>
        <div id="sup-ph-content"><div class="sup-empty">Загрузка...</div></div>
      </div>`;

      html += `</div>`;

      showModal({ title: 'Поставщик: ' + s.name, html: html });

      /* Рейтинг / категория в форме */
      const catW = document.getElementById('sup-edit-cat_w');
      if (catW) {
        catW.appendChild(CRSelect.create({
          id: 'sup-edit-cat',
          options: [
            { value: 'materials',        label: 'Материалы' },
            { value: 'equipment_rental', label: 'Аренда техники' },
            { value: 'services',         label: 'Услуги' },
            { value: 'other',            label: 'Прочее' }
          ],
          value: s.category || 'other',
          dropdownClass: 'z-modal'
        }));
      }

      /* Сохранение формы */
      const form = document.getElementById('sup-edit-form');
      if (form && canWrite()) {
        form.onsubmit = async e => {
          e.preventDefault();
          const fd  = new FormData(form);
          const body = {
            name:     fd.get('name'),
            inn:      fd.get('inn') || null,
            kpp:      fd.get('kpp') || null,
            ogrn:     fd.get('ogrn') || null,
            phone:    fd.get('phone') || null,
            email:    fd.get('email') || null,
            website:  fd.get('website') || null,
            address:  fd.get('address') || null,
            rating:   fd.get('rating') ? +fd.get('rating') : null,
            notes:    fd.get('notes') || null,
            is_active: !!fd.get('is_active'),
            category: CRSelect.getValue('sup-edit-cat') || 'other'
          };
          try {
            await apiPut('/api/suppliers/' + id, body);
            toast('Сохранено', '', 'ok');
            closeModal();
            refreshSuppliersTab();
          } catch(err) { toast('Ошибка', err.message, 'err'); }
        };
      }

      /* Удаление поставщика */
      const delBtn = document.getElementById('sup-del-btn');
      if (delBtn) {
        delBtn.onclick = async () => {
          if (!confirm('Удалить поставщика «' + s.name + '»? Это действие необратимо.')) return;
          try {
            await apiDel('/api/suppliers/' + id);
            toast('Удалено', '', 'ok'); closeModal(); refreshSuppliersTab();
          } catch(err) { toast('Ошибка', err.message, 'err'); }
        };
      }

      /* Добавить контакт */
      const addContactBtn = document.getElementById('sup-add-contact');
      if (addContactBtn) addContactBtn.onclick = () => openAddContactModal(id, () => openSupplierDetail(id));

      /* Удалить контакт */
      document.querySelectorAll('[data-del-cid]').forEach(btn => {
        btn.onclick = async () => {
          if (!confirm('Удалить контакт?')) return;
          try {
            await apiDel('/api/suppliers/' + id + '/contacts/' + btn.dataset.delCid);
            openSupplierDetail(id);
          } catch(err) { toast('Ошибка', err.message, 'err'); }
        };
      });

      /* Пометка primary */
      document.querySelectorAll('.sup-contact-primary').forEach((star, idx) => {
        star.onclick = async () => {
          const cid = contacts[idx] && contacts[idx].id;
          if (!cid) return;
          try {
            await apiPut('/api/suppliers/' + id + '/contacts/' + cid, { is_primary: true });
            openSupplierDetail(id);
          } catch(err) { toast('Ошибка', err.message, 'err'); }
        };
      });

      /* История цен */
      apiFetch('/api/suppliers/' + id + '/price-history').then(ph => {
        const phEl = document.getElementById('sup-ph-content');
        if (!phEl) return;
        const rows = ph.items || ph.rows || ph || [];
        if (!rows.length) { phEl.innerHTML = '<div style="color:var(--t2);font-size:13px;padding:var(--sp-2)">Записей нет</div>'; return; }
        phEl.innerHTML = `<div class="sup-table-wrap"><table class="sup-ph-table">
          <thead><tr><th>Товар</th><th>Ед.</th><th>Цена</th><th>Источник</th><th>Дата</th></tr></thead>
          <tbody>${rows.slice(0, 50).map(r => `<tr>
            <td>${esc(r.item_name || r.product_ref_name || '—')}</td>
            <td>${esc(r.unit || '—')}</td>
            <td><strong>${money(r.unit_price)}</strong></td>
            <td>${srcBadge(r.source)}</td>
            <td>${dt(r.recorded_at)}</td>
          </tr>`).join('')}</tbody></table></div>`;
      }).catch(() => {
        const phEl = document.getElementById('sup-ph-content');
        if (phEl) phEl.innerHTML = '<div style="color:var(--t2);font-size:13px;padding:var(--sp-2)">Нет данных</div>';
      });

    } catch(e) {
      toast('Ошибка', e.message, 'err');
    }
  }

  function openAddContactModal(supplierId, onDone) {
    const html = `<div class="sup-form sup-form--single" id="sup-contact-form">
      <label>ФИО * <input id="sc-name" required></label>
      <label>Должность <input id="sc-role"></label>
      <label>Телефон <input id="sc-phone" type="tel"></label>
      <label>Email <input id="sc-email" type="email"></label>
      <label>Telegram <input id="sc-telegram" placeholder="без @"></label>
      <label>Примечание <textarea id="sc-notes" rows="2"></textarea></label>
      <label style="flex-direction:row;align-items:center;gap:var(--sp-1);color:var(--t1)">
        <input type="checkbox" id="sc-primary"> Основной контакт
      </label>
      <div class="sup-form__footer">
        <button class="btn ghost" id="sc-cancel">Отмена</button>
        <button class="btn primary" id="sc-submit">Добавить</button>
      </div>
    </div>`;
    showModal({ title: 'Новый контакт', html: html });
    document.getElementById('sc-cancel').onclick = () => closeModal();
    document.getElementById('sc-submit').onclick = async () => {
      const name = document.getElementById('sc-name').value.trim();
      if (!name) { toast('Ошибка', 'Укажите ФИО', 'err'); return; }
      const body = {
        full_name:  name,
        role:       document.getElementById('sc-role').value   || null,
        phone:      document.getElementById('sc-phone').value  || null,
        email:      document.getElementById('sc-email').value  || null,
        telegram:   document.getElementById('sc-telegram').value || null,
        notes:      document.getElementById('sc-notes').value  || null,
        is_primary: document.getElementById('sc-primary').checked
      };
      try {
        await apiPost('/api/suppliers/' + supplierId + '/contacts', body);
        toast('Контакт добавлен', '', 'ok');
        closeModal();
        if (onDone) onDone();
      } catch(err) { toast('Ошибка', err.message, 'err'); }
    };
  }

  function openSupplierCreateModal() {
    const html = `<div id="sup-create-form">
      <div class="sup-form">
        <label>Название * <input id="snc-name" required></label>
        <label>ИНН <input id="snc-inn"></label>
        <label>КПП <input id="snc-kpp"></label>
        <label>ОГРН <input id="snc-ogrn"></label>
        <label>Телефон <input id="snc-phone" type="tel"></label>
        <label>Email <input id="snc-email" type="email"></label>
        <label>Сайт <input id="snc-website" type="url"></label>
        <label>Адрес <input id="snc-address"></label>
        <label>Категория <div id="snc-cat_w"></div></label>
        <label>Рейтинг (1-5) <input id="snc-rating" type="number" min="0" max="5"></label>
        <label class="span2">Примечание <textarea id="snc-notes" rows="2"></textarea></label>
        <div class="span2 sup-form__footer">
          <button class="btn ghost" id="snc-cancel">Отмена</button>
          <button class="btn primary" id="snc-submit">Создать</button>
        </div>
      </div>
    </div>`;
    showModal({ title: 'Новый поставщик', html: html });

    document.getElementById('snc-cat_w').appendChild(CRSelect.create({
      id: 'snc-cat',
      options: [
        { value: 'materials',        label: 'Материалы' },
        { value: 'equipment_rental', label: 'Аренда техники' },
        { value: 'services',         label: 'Услуги' },
        { value: 'other',            label: 'Прочее' }
      ],
      value: 'materials',
      dropdownClass: 'z-modal'
    }));

    document.getElementById('snc-cancel').onclick = () => closeModal();
    document.getElementById('snc-submit').onclick = async () => {
      const name = document.getElementById('snc-name').value.trim();
      if (!name) { toast('Ошибка', 'Укажите название', 'err'); return; }
      const body = {
        name,
        inn:      document.getElementById('snc-inn').value     || null,
        kpp:      document.getElementById('snc-kpp').value     || null,
        ogrn:     document.getElementById('snc-ogrn').value    || null,
        phone:    document.getElementById('snc-phone').value   || null,
        email:    document.getElementById('snc-email').value   || null,
        website:  document.getElementById('snc-website').value || null,
        address:  document.getElementById('snc-address').value || null,
        category: CRSelect.getValue('snc-cat') || 'other',
        rating:   document.getElementById('snc-rating').value ? +document.getElementById('snc-rating').value : null,
        notes:    document.getElementById('snc-notes').value   || null
      };
      try {
        const r = await apiPost('/api/suppliers', body);
        toast('Поставщик создан', '', 'ok');
        closeModal();
        refreshSuppliersTab();
        if (r.item && r.item.id) openSupplierDetail(r.item.id);
      } catch(err) { toast('Ошибка', err.message, 'err'); }
    };
  }

  function refreshSuppliersTab() {
    const content = _pageEl && _pageEl.querySelector('#sup-tab-content');
    if (content && _activeTab === 'suppliers') loadSuppliers(content.querySelector('#sup-s-table'));
  }

  /* ═══════════════════════════════════════════════════════════
     TAB 2 — КАТАЛОГ ТОВАРОВ
  ═══════════════════════════════════════════════════════════ */
  async function renderCatalogTab(el) {
    el.innerHTML = '<div class="sup-empty">Загрузка...</div>';
    try {
      const cd = await apiFetch('/api/product-categories');
      _categories = cd.items || [];
    } catch(e) {
      _categories = [];
    }

    el.innerHTML = `
      <div class="sup-toolbar">
        <input type="text" id="sup-c-search" placeholder="Поиск товара..." value="${esc(_catFilters.search)}">
        ${canWrite() ? '<button class="btn primary" id="sup-c-prod-create">+ Товар</button>' : ''}
        ${isAdmin() ? '<button class="btn ghost" id="sup-c-cat-create">+ Категория</button>' : ''}
      </div>
      <div class="sup-catalog-layout">
        <div>
          <div class="sup-cat-list" id="sup-cat-list"></div>
        </div>
        <div id="sup-c-products"></div>
      </div>`;

    let tmr;
    el.querySelector('#sup-c-search').oninput = e => {
      clearTimeout(tmr);
      tmr = setTimeout(() => { _catFilters.search = e.target.value; loadProducts(el.querySelector('#sup-c-products')); }, 300);
    };

    const prodCreateBtn = el.querySelector('#sup-c-prod-create');
    if (prodCreateBtn) prodCreateBtn.onclick = () => openProductCreateModal(() => loadProducts(el.querySelector('#sup-c-products')));

    const catCreateBtn = el.querySelector('#sup-c-cat-create');
    if (catCreateBtn) catCreateBtn.onclick = () => openCategoryCreateModal(() => renderCatalogTab(el));

    renderCategoryList(el.querySelector('#sup-cat-list'), el.querySelector('#sup-c-products'), el);
    await loadProducts(el.querySelector('#sup-c-products'));
  }

  function renderCategoryList(listEl, productsEl, tabEl) {
    const all = [{ id: '', name: 'Все товары', products_count: null }].concat(_categories);
    listEl.innerHTML = all.map(c => `<div class="sup-cat-list__item ${_catFilters.category_id === String(c.id) ? 'sup-cat-list__item--active' : ''}" data-cid="${c.id}">
      <span>${esc(c.name)}</span>
      ${c.products_count != null ? `<span class="sup-cat-list__count">${c.products_count}</span>` : ''}
    </div>`).join('');

    listEl.querySelectorAll('.sup-cat-list__item').forEach(item => {
      item.onclick = () => {
        _catFilters.category_id = item.dataset.cid;
        listEl.querySelectorAll('.sup-cat-list__item').forEach(i => i.classList.remove('sup-cat-list__item--active'));
        item.classList.add('sup-cat-list__item--active');
        loadProducts(productsEl);
      };
    });
  }

  async function loadProducts(tableEl) {
    tableEl.innerHTML = '<div class="sup-empty">Загрузка...</div>';
    try {
      const params = new URLSearchParams();
      if (_catFilters.search)      params.append('search', _catFilters.search);
      if (_catFilters.category_id) params.append('category_id', _catFilters.category_id);
      const d = await apiFetch('/api/products?' + params.toString());
      renderProductsTable(d.items || [], tableEl);
    } catch(e) {
      tableEl.innerHTML = '<div class="sup-empty" style="color:var(--err)">Ошибка: ' + esc(e.message) + '</div>';
    }
  }

  function renderProductsTable(items, el) {
    if (!items.length) { el.innerHTML = '<div class="sup-empty">Товаров нет</div>'; return; }
    el.innerHTML = `<div class="sup-table-wrap"><table class="sup-table proc-items-table">
      <thead><tr>
        <th>Наименование</th><th>Артикул</th><th>Ед.</th><th>Категория</th><th>Статус</th>
      </tr></thead>
      <tbody>${items.map(r => `<tr data-id="${r.id}">
        <td><strong>${esc(r.name)}</strong></td>
        <td style="color:var(--t2)">${esc(r.article || '—')}</td>
        <td>${esc(r.unit || '—')}</td>
        <td style="color:var(--t2)">${esc(r.category_name || '—')}</td>
        <td>${activeBadge(r.is_active !== false)}</td>
      </tr>`).join('')}</tbody></table></div>`;
    el.querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => openProductDetail(+tr.dataset.id));
  }

  async function openProductDetail(id) {
    try {
      const [pd, statsD] = await Promise.all([
        apiFetch('/api/products/' + id),
        apiFetch('/api/products/' + id + '/price-stats?days=90').catch(() => null)
      ]);
      const p = pd.item || pd;
      const stats = statsD && statsD.stats ? statsD.stats : null;

      let html = `<div class="sup-detail">
        <div class="sup-detail__header">
          <div>
            <h2 class="sup-detail__title">${esc(p.name)}</h2>
            <div style="margin-top:4px">${activeBadge(p.is_active !== false)}</div>
          </div>
        </div>
        <div class="sup-detail__section">
          <div class="sup-detail__section-title">Сведения</div>
          <form id="sup-prod-form">
          <div class="sup-form">
            <label>Наименование * <input name="name" value="${esc(p.name)}" ${canWrite()?'':'readonly'}></label>
            <label>Артикул <input name="article" value="${esc(p.article||'')}" ${canWrite()?'':'readonly'}></label>
            <label>Единица изм. <input name="unit" value="${esc(p.unit||'')}" ${canWrite()?'':'readonly'}></label>
            <label>Категория <div id="sup-prod-cat_w"></div></label>
            <label class="span2">Примечание <textarea name="notes" rows="2" ${canWrite()?'':'readonly'}>${esc(p.notes||'')}</textarea></label>
            ${canWrite() ? `<div class="span2 sup-form__footer">
              <button type="submit" class="btn primary">💾 Сохранить</button>
            </div>` : ''}
          </div>
          </form>
        </div>`;

      /* Price stats block */
      if (stats && stats.sample_count) {
        html += `<div class="sup-detail__section">
          <div class="sup-detail__section-title">Ценовая статистика (90 дней, ${stats.sample_count} записей)</div>
          <div class="sup-price-stats">
            <div class="sup-price-stat sup-price-stat--min">
              <div class="sup-price-stat__val">${money(stats.min_price)}</div>
              <div class="sup-price-stat__lbl">Минимум</div>
            </div>
            <div class="sup-price-stat sup-price-stat--avg">
              <div class="sup-price-stat__val">${money(stats.avg_price)}</div>
              <div class="sup-price-stat__lbl">Среднее</div>
            </div>
            <div class="sup-price-stat sup-price-stat--med">
              <div class="sup-price-stat__val">${money(stats.median_price)}</div>
              <div class="sup-price-stat__lbl">Медиана</div>
            </div>
            <div class="sup-price-stat sup-price-stat--max">
              <div class="sup-price-stat__val">${money(stats.max_price)}</div>
              <div class="sup-price-stat__lbl">Максимум</div>
            </div>
          </div>
        </div>`;
      }

      /* Price history */
      html += `<div class="sup-detail__section">
        <div class="sup-detail__section-title">История цен</div>
        <div id="sup-prod-ph"><div class="sup-empty">Загрузка...</div></div>
      </div></div>`;

      showModal({ title: 'Товар: ' + p.name, html: html });

      /* Category select in form */
      const catW = document.getElementById('sup-prod-cat_w');
      if (catW) {
        const catOpts = [{ value: '', label: '— без категории —' }].concat(
          _categories.map(c => ({ value: String(c.id), label: c.name }))
        );
        catW.appendChild(CRSelect.create({
          id: 'sup-prod-cat',
          options: catOpts,
          value: p.category_id ? String(p.category_id) : '',
          searchable: true,
          dropdownClass: 'z-modal'
        }));
      }

      /* Save form */
      const form = document.getElementById('sup-prod-form');
      if (form && canWrite()) {
        form.onsubmit = async e => {
          e.preventDefault();
          const fd = new FormData(form);
          const body = {
            name:        fd.get('name'),
            article:     fd.get('article') || null,
            unit:        fd.get('unit') || null,
            category_id: CRSelect.getValue('sup-prod-cat') ? +CRSelect.getValue('sup-prod-cat') : null,
            notes:       fd.get('notes') || null
          };
          try {
            await apiPut('/api/products/' + id, body);
            toast('Сохранено', '', 'ok');
            closeModal();
            const content = _pageEl && _pageEl.querySelector('#sup-tab-content');
            if (content && _activeTab === 'catalog') loadProducts(content.querySelector('#sup-c-products'));
          } catch(err) { toast('Ошибка', err.message, 'err'); }
        };
      }

      /* Load price history */
      apiFetch('/api/products/' + id + '/price-history').then(ph => {
        const phEl = document.getElementById('sup-prod-ph');
        if (!phEl) return;
        const rows = ph.items || ph.rows || ph || [];
        if (!rows.length) { phEl.innerHTML = '<div style="color:var(--t2);font-size:13px;padding:var(--sp-2)">Записей нет</div>'; return; }
        phEl.innerHTML = `<div class="sup-table-wrap"><table class="sup-ph-table">
          <thead><tr><th>Поставщик</th><th>Ед.</th><th>Цена</th><th>Источник</th><th>Дата</th><th>Кто внёс</th></tr></thead>
          <tbody>${rows.slice(0, 50).map(r => `<tr>
            <td>${esc(r.supplier_name || r.supplier_ref_name || '—')}</td>
            <td>${esc(r.unit || '—')}</td>
            <td><strong>${money(r.unit_price)}</strong></td>
            <td>${srcBadge(r.source)}</td>
            <td>${dt(r.recorded_at)}</td>
            <td style="color:var(--t2)">${esc(r.recorded_by_name || '—')}</td>
          </tr>`).join('')}</tbody></table></div>`;
      }).catch(() => {
        const phEl = document.getElementById('sup-prod-ph');
        if (phEl) phEl.innerHTML = '<div style="color:var(--t2);font-size:13px;padding:var(--sp-2)">Нет данных</div>';
      });

    } catch(e) { toast('Ошибка', e.message, 'err'); }
  }

  function openProductCreateModal(onDone) {
    const catOpts = [{ value: '', label: '— без категории —' }].concat(
      _categories.map(c => ({ value: String(c.id), label: c.name }))
    );
    const html = `<div class="sup-form" id="sup-prod-create-form">
      <label>Наименование * <input id="pnc-name" required></label>
      <label>Артикул <input id="pnc-article"></label>
      <label>Единица изм. <input id="pnc-unit" placeholder="шт, кг, м, л..."></label>
      <label>Категория <div id="pnc-cat_w"></div></label>
      <label class="span2">Примечание <textarea id="pnc-notes" rows="2"></textarea></label>
      <div class="span2 sup-form__footer">
        <button class="btn ghost" id="pnc-cancel">Отмена</button>
        <button class="btn primary" id="pnc-submit">Создать</button>
      </div>
    </div>`;
    showModal({ title: 'Новый товар', html: html });

    document.getElementById('pnc-cat_w').appendChild(CRSelect.create({
      id: 'pnc-cat', options: catOpts, value: '', searchable: true, dropdownClass: 'z-modal'
    }));

    document.getElementById('pnc-cancel').onclick = () => closeModal();
    document.getElementById('pnc-submit').onclick = async () => {
      const name = document.getElementById('pnc-name').value.trim();
      if (!name) { toast('Ошибка', 'Укажите наименование', 'err'); return; }
      const body = {
        name,
        article:     document.getElementById('pnc-article').value  || null,
        unit:        document.getElementById('pnc-unit').value      || null,
        category_id: CRSelect.getValue('pnc-cat') ? +CRSelect.getValue('pnc-cat') : null,
        notes:       document.getElementById('pnc-notes').value     || null
      };
      try {
        await apiPost('/api/products', body);
        toast('Товар создан', '', 'ok'); closeModal(); if (onDone) onDone();
      } catch(err) { toast('Ошибка', err.message, 'err'); }
    };
  }

  function openCategoryCreateModal(onDone) {
    const parentOpts = [{ value: '', label: '— корневая —' }].concat(
      _categories.map(c => ({ value: String(c.id), label: c.name }))
    );
    const html = `<div class="sup-form sup-form--single" id="sup-cat-create-form">
      <label>Название * <input id="cnc-name" required></label>
      <label>Родитель <div id="cnc-parent_w"></div></label>
      <label>Порядок сортировки <input id="cnc-sort" type="number" value="0"></label>
      <div class="sup-form__footer">
        <button class="btn ghost" id="cnc-cancel">Отмена</button>
        <button class="btn primary" id="cnc-submit">Создать</button>
      </div>
    </div>`;
    showModal({ title: 'Новая категория', html: html });

    document.getElementById('cnc-parent_w').appendChild(CRSelect.create({
      id: 'cnc-parent', options: parentOpts, value: '', dropdownClass: 'z-modal'
    }));

    document.getElementById('cnc-cancel').onclick = () => closeModal();
    document.getElementById('cnc-submit').onclick = async () => {
      const name = document.getElementById('cnc-name').value.trim();
      if (!name) { toast('Ошибка', 'Укажите название', 'err'); return; }
      const body = {
        name,
        parent_id:  CRSelect.getValue('cnc-parent') ? +CRSelect.getValue('cnc-parent') : null,
        sort_order: +document.getElementById('cnc-sort').value || 0
      };
      try {
        await apiPost('/api/product-categories', body);
        toast('Категория создана', '', 'ok'); closeModal(); if (onDone) onDone();
      } catch(err) { toast('Ошибка', err.message, 'err'); }
    };
  }

  /* ═══════════════════════════════════════════════════════════
     TAB 3 — БАЗА ЦЕН
  ═══════════════════════════════════════════════════════════ */
  async function renderPricesTab(el) {
    el.innerHTML = `
      <div class="sup-toolbar">
        <input type="text" id="sup-p-search" placeholder="Поиск по товару..." value="${esc(_priceFilters.search)}">
        <div id="sup-p-src_w" style="display:inline-block;min-width:160px"></div>
        <input type="date" id="sup-p-from" value="${esc(_priceFilters.date_from)}" title="Дата с">
        <input type="date" id="sup-p-to"   value="${esc(_priceFilters.date_to)}"   title="Дата по">
        ${canWrite() ? '<button class="btn primary" id="sup-p-create">+ Цена вручную</button>' : ''}
      </div>
      <div id="sup-p-table"></div>`;

    const srcOpts = [
      { value: '', label: 'Все источники' },
      { value: 'manual',             label: 'Вручную' },
      { value: 'quote',              label: 'КП' },
      { value: 'ai_search',          label: 'AI-поиск' },
      { value: 'market_monitoring',  label: 'Мониторинг' },
      { value: 'procurement',        label: 'Из закупки' }
    ];
    el.querySelector('#sup-p-src_w').appendChild(CRSelect.create({
      id: 'sup-p-src', options: srcOpts, value: _priceFilters.source,
      onChange: v => { _priceFilters.source = v; loadPrices(el.querySelector('#sup-p-table')); }
    }));

    let tmr;
    el.querySelector('#sup-p-search').oninput = e => {
      clearTimeout(tmr);
      tmr = setTimeout(() => { _priceFilters.search = e.target.value; loadPrices(el.querySelector('#sup-p-table')); }, 300);
    };

    el.querySelector('#sup-p-from').onchange = e => { _priceFilters.date_from = e.target.value; loadPrices(el.querySelector('#sup-p-table')); };
    el.querySelector('#sup-p-to').onchange   = e => { _priceFilters.date_to   = e.target.value; loadPrices(el.querySelector('#sup-p-table')); };

    const createBtn = el.querySelector('#sup-p-create');
    if (createBtn) createBtn.onclick = () => openPriceCreateModal(() => loadPrices(el.querySelector('#sup-p-table')));

    await loadPrices(el.querySelector('#sup-p-table'));
  }

  async function loadPrices(tableEl) {
    tableEl.innerHTML = '<div class="sup-empty">Загрузка...</div>';
    try {
      const params = new URLSearchParams();
      if (_priceFilters.search)    params.append('search',    _priceFilters.search);
      if (_priceFilters.source)    params.append('source',    _priceFilters.source);
      if (_priceFilters.date_from) params.append('date_from', _priceFilters.date_from);
      if (_priceFilters.date_to)   params.append('date_to',   _priceFilters.date_to);
      const d = await apiFetch('/api/price-records?' + params.toString());
      renderPricesTable(d.items || [], tableEl);
    } catch(e) {
      tableEl.innerHTML = '<div class="sup-empty" style="color:var(--err)">Ошибка: ' + esc(e.message) + '</div>';
    }
  }

  function renderPricesTable(items, el) {
    if (!items.length) { el.innerHTML = '<div class="sup-empty">Записей нет</div>'; return; }
    el.innerHTML = `<div class="sup-table-wrap"><table class="sup-table proc-items-table">
      <thead><tr>
        <th>Товар</th><th>Ед.</th><th>Цена</th><th>Поставщик</th>
        <th>Источник</th><th>Дата</th><th>Кто внёс</th>
      </tr></thead>
      <tbody>${items.map(r => `<tr>
        <td><strong>${esc(r.item_name || r.product_ref_name || '—')}</strong></td>
        <td>${esc(r.unit || '—')}</td>
        <td><strong>${money(r.unit_price)}</strong></td>
        <td style="color:var(--t2)">${esc(r.supplier_name || r.supplier_ref_name || '—')}</td>
        <td>${srcBadge(r.source)}</td>
        <td style="color:var(--t2)">${dt(r.recorded_at)}</td>
        <td style="color:var(--t3)">${esc(r.recorded_by_name || '—')}</td>
      </tr>`).join('')}</tbody></table></div>`;
  }

  function openPriceCreateModal(onDone) {
    /* Prepare supplier options lazily */
    const html = `<div class="sup-form" id="sup-price-create-form">
      <label class="span2">Наименование товара * <input id="prc-name" required placeholder="Введите или выберите..."></label>
      <label>Цена за ед. * <input id="prc-price" type="number" min="0" step="0.01" required></label>
      <label>Единица изм. <input id="prc-unit" placeholder="шт, кг, м..."></label>
      <label>Поставщик <div id="prc-sup_w"></div></label>
      <label>Источник <div id="prc-src_w"></div></label>
      <label class="span2">Ссылка на источник <input id="prc-url" type="url"></label>
      <label class="span2">Примечание <textarea id="prc-notes" rows="2"></textarea></label>
      <div class="span2 sup-form__footer">
        <button class="btn ghost" id="prc-cancel">Отмена</button>
        <button class="btn primary" id="prc-submit">Сохранить</button>
      </div>
    </div>`;
    showModal({ title: 'Добавить цену вручную', html: html });

    /* Supplier select — load async */
    const supW = document.getElementById('prc-sup_w');
    supW.innerHTML = '<span style="color:var(--t2);font-size:13px">Загрузка...</span>';
    apiFetch('/api/suppliers?is_active=true').then(sd => {
      supW.innerHTML = '';
      const supOpts = [{ value: '', label: '— не выбрано —' }].concat(
        (sd.items || []).map(s => ({ value: String(s.id), label: s.name }))
      );
      supW.appendChild(CRSelect.create({ id: 'prc-sup', options: supOpts, value: '', searchable: true, dropdownClass: 'z-modal' }));
    }).catch(() => { supW.innerHTML = '<span style="color:var(--t2);font-size:13px">—</span>'; });

    document.getElementById('prc-src_w').appendChild(CRSelect.create({
      id: 'prc-src',
      options: [
        { value: 'manual',            label: 'Вручную' },
        { value: 'quote',             label: 'КП' },
        { value: 'ai_search',         label: 'AI-поиск' },
        { value: 'market_monitoring', label: 'Мониторинг' }
      ],
      value: 'manual',
      dropdownClass: 'z-modal'
    }));

    document.getElementById('prc-cancel').onclick = () => closeModal();
    document.getElementById('prc-submit').onclick = async () => {
      const name  = document.getElementById('prc-name').value.trim();
      const price = document.getElementById('prc-price').value;
      if (!name)  { toast('Ошибка', 'Укажите наименование', 'err'); return; }
      if (!price) { toast('Ошибка', 'Укажите цену', 'err'); return; }
      const body = {
        item_name:   name,
        unit_price:  +price,
        unit:        document.getElementById('prc-unit').value    || null,
        supplier_id: CRSelect.getValue('prc-sup') ? +CRSelect.getValue('prc-sup') : null,
        source:      CRSelect.getValue('prc-src') || 'manual',
        source_url:  document.getElementById('prc-url').value     || null,
        notes:       document.getElementById('prc-notes').value   || null
      };
      try {
        await apiPost('/api/price-records', body);
        toast('Цена добавлена', '', 'ok'); closeModal(); if (onDone) onDone();
      } catch(err) { toast('Ошибка', err.message, 'err'); }
    };
  }

  /* ═══════════════════════════════════════════════════════════
     RENDER (entry point)
  ═══════════════════════════════════════════════════════════ */
  async function render(opts) {
    const layout = opts.layout;
    const title  = opts.title || 'Справочники закупок';

    /* Load current user */
    try {
      const ud = await apiFetch('/api/users/me');
      _user = ud.user || ud;
    } catch(e) {
      _user = { role: 'PROC' };
    }

    await layout('', { title: title });

    const layoutEl = document.getElementById('layout');
    layoutEl.innerHTML = '';

    _pageEl = document.createElement('div');
    _pageEl.className = 'sup-page';

    /* Tab bar */
    _pageEl.innerHTML = `
      <div class="sup-tabs">
        <button class="sup-tab sup-tab--active" data-tab="suppliers">Поставщики</button>
        <button class="sup-tab" data-tab="catalog">Каталог товаров</button>
        <button class="sup-tab" data-tab="prices">База цен</button>
      </div>
      <div id="sup-tab-content"></div>`;

    layoutEl.appendChild(_pageEl);

    _pageEl.querySelectorAll('.sup-tab').forEach(tab => {
      tab.onclick = () => switchTab(tab.dataset.tab);
    });

    /* Render default tab */
    _activeTab = 'suppliers';
    await switchTab('suppliers');
  }

  /* ─── Public API ─── */
  return { render, openSupplierDetail, openProductDetail };

})();
