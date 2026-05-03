/**
 * AsgardGamificationCrud — Управление геймификацией
 * ═══════════════════════════════════════════════════════════════════
 * 4 вкладки: Товары | Рулетка | Квесты | Победители
 * Роли: ADMIN, DIRECTOR_GEN, OFFICE_MANAGER, HR
 */
window.AsgardGamificationCrud = (function () {
  'use strict';

  const { $, esc, toast } = AsgardUI;

  const GOLD = 'var(--gold,#D4A843)';
  const TIER_COLORS = { common: '#22c55e', rare: '#4A90FF', epic: '#A56EFF', legendary: '#F0C850' };
  const TIER_RU = { common: 'Обычный', rare: 'Редкий', epic: 'Эпик', legendary: 'Легенда' };
  const CAT_RU = { merch: 'Мерч', digital: 'Цифровое', privilege: 'Привилегия', cosmetic: 'Косметика', food: 'Еда' };
  const DELIVERY_RU = { pending: '⏳ Ожидает', ready: '📦 Готово к выдаче', delivered: '✅ Выдано' };
  const DELIVERY_COLOR = { pending: '#f59e0b', ready: '#4A90FF', delivered: '#22c55e' };

  const inputStyle = 'width:100%;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:#141828;color:#fff;font-size:13px;box-sizing:border-box;';

  let currentTab = 'shop';
  let layoutEl = null;

  function hdr() {
    const t = localStorage.getItem('asgard_token') || localStorage.getItem('auth_token');
    return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
  }
  async function api(path, opts = {}) {
    const r = await fetch('/api/gamification/crud' + path, { headers: hdr(), ...opts });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || 'HTTP ' + r.status); }
    return r.json();
  }
  async function adminApi(path, opts = {}) {
    const r = await fetch('/api/gamification/admin' + path, { headers: hdr(), ...opts });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || 'HTTP ' + r.status); }
    return r.json();
  }

  // ═══ RENDER ═══
  async function render({ layout, title }) {
    layoutEl = layout;
    layout.innerHTML = `
      <div style="max-width:1300px;margin:0 auto;padding:24px 16px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:8px">
          <h1 style="font-size:22px;font-weight:800;color:${GOLD};margin:0">⚔ ${esc(title)}</h1>
          <span id="gc-stats" style="font-size:12px;color:rgba(255,255,255,.4)">…</span>
        </div>
        <div id="gc-tabs" style="display:flex;gap:4px;margin-bottom:20px;border-bottom:1px solid rgba(255,255,255,.08);padding-bottom:0"></div>
        <div id="gc-content"></div>
      </div>`;

    const tabs = [
      { id: 'shop', label: '🛍 Товары магазина' },
      { id: 'prizes', label: '🎰 Рулетка' },
      { id: 'quests', label: '⚔ Квесты' },
      { id: 'winners', label: '🏆 Победители' },
    ];

    const tabBar = document.getElementById('gc-tabs');
    tabs.forEach(tab => {
      const btn = document.createElement('button');
      btn.dataset.tab = tab.id;
      btn.style.cssText = `padding:10px 18px;font-size:13px;font-weight:600;border:none;border-bottom:2px solid transparent;
        background:transparent;cursor:pointer;color:rgba(255,255,255,.5);transition:all .2s;`;
      btn.textContent = tab.label;
      btn.addEventListener('click', () => {
        currentTab = tab.id;
        tabBar.querySelectorAll('button').forEach(b => {
          b.style.borderBottomColor = 'transparent'; b.style.color = 'rgba(255,255,255,.5)';
        });
        btn.style.borderBottomColor = GOLD; btn.style.color = '#fff';
        renderTab();
      });
      if (tab.id === currentTab) { btn.style.borderBottomColor = GOLD; btn.style.color = '#fff'; }
      tabBar.appendChild(btn);
    });

    renderTab();
    loadStats();
  }

  async function loadStats() {
    try {
      const d = await adminApi('/dashboard');
      const s = document.getElementById('gc-stats');
      if (s) s.textContent = `${d.kpi.runes_in_circulation} ᚱ в обороте · ${d.kpi.spins_today} спинов сегодня · ${d.kpi.prizes_delivered_month} выдач за месяц`;
    } catch { /* ignore */ }
  }

  async function renderTab() {
    const content = document.getElementById('gc-content');
    if (!content) return;
    content.innerHTML = '<div style="text-align:center;padding:40px;color:rgba(255,255,255,.4)">Загрузка…</div>';
    try {
      if (currentTab === 'shop') await renderShopTab(content);
      else if (currentTab === 'prizes') await renderPrizesTab(content);
      else if (currentTab === 'quests') await renderQuestsTab(content);
      else await renderWinnersTab(content);
    } catch (e) {
      content.innerHTML = `<div style="color:#ef4444;padding:20px;border-radius:12px;background:rgba(239,68,68,.08)">⚠ Ошибка: ${esc(String(e))}</div>`;
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // 🛍 SHOP TAB
  // ══════════════════════════════════════════════════════════════════════
  async function renderShopTab(container) {
    const { items } = await api('/shop-items');
    container.innerHTML = '';

    // Header row
    const hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px';
    hdr.innerHTML = `
      <div style="font-size:13px;color:rgba(255,255,255,.4)">${items.length} товаров в магазине</div>
      <button id="gc-add-shop" style="padding:10px 20px;border-radius:12px;background:${GOLD};color:#1a1000;font-weight:700;font-size:13px;border:none;cursor:pointer">+ Добавить товар</button>`;
    container.appendChild(hdr);
    document.getElementById('gc-add-shop').addEventListener('click', () => showItemForm(null));

    // Cards grid
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px';

    items.forEach(item => {
      const card = document.createElement('div');
      card.style.cssText = `background:#141828;border-radius:14px;padding:16px;border:1px solid rgba(255,255,255,.06);
        transition:transform .15s,box-shadow .15s;cursor:pointer;position:relative;
        opacity:${item.is_active ? 1 : 0.5}`;
      card.addEventListener('mouseenter', () => { card.style.transform = 'translateY(-2px)'; card.style.boxShadow = '0 8px 24px rgba(0,0,0,.4)'; });
      card.addEventListener('mouseleave', () => { card.style.transform = ''; card.style.boxShadow = ''; });

      const pct = item.roulette_pct ? `<span style="color:${GOLD};font-size:11px">🎰 ${item.roulette_pct}% в рулетке</span>` : `<span style="font-size:11px;color:rgba(255,255,255,.3)">не в рулетке</span>`;
      const tierColor = TIER_COLORS[item.rarity] || '#888';

      card.innerHTML = `
        <div style="display:flex;align-items:flex-start;gap:12px">
          <div style="font-size:32px;flex-shrink:0;width:48px;height:48px;display:flex;align-items:center;justify-content:center;
            background:rgba(255,255,255,.04);border-radius:12px">${esc(item.icon || '📦')}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:14px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(item.name)}</div>
            <div style="font-size:11px;color:rgba(255,255,255,.4);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(item.description || '')}</div>
            <div style="display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap">
              <span style="background:rgba(212,168,67,.15);color:${GOLD};border-radius:6px;padding:2px 8px;font-size:12px;font-weight:700">${item.price_runes} ᚱ</span>
              <span style="background:${tierColor}22;color:${tierColor};border-radius:6px;padding:2px 8px;font-size:11px">${TIER_RU[item.rarity] || item.rarity}</span>
              <span style="background:rgba(255,255,255,.06);color:rgba(255,255,255,.5);border-radius:6px;padding:2px 8px;font-size:11px">${CAT_RU[item.category] || item.category}</span>
            </div>
          </div>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,.06)">
          <div style="display:flex;flex-direction:column;gap:2px">
            ${pct}
            <span style="font-size:11px;color:rgba(255,255,255,.3)">Запас: ${item.max_stock ? `${item.current_stock}/${item.max_stock}` : '∞'}</span>
          </div>
          <div style="display:flex;gap:6px">
            <button class="gc-edit-shop" data-id="${item.id}" style="padding:6px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:transparent;color:rgba(255,255,255,.7);font-size:12px;cursor:pointer">✏ Изменить</button>
            <button class="gc-del-shop" data-id="${item.id}" style="padding:6px 10px;border-radius:8px;border:1px solid rgba(239,68,68,.3);background:transparent;color:#ef4444;font-size:12px;cursor:pointer">✕</button>
          </div>
        </div>`;
      grid.appendChild(card);
    });

    container.appendChild(grid);
    window._gcShopItems = items;

    // Delegate events
    grid.addEventListener('click', e => {
      const editBtn = e.target.closest('.gc-edit-shop');
      const delBtn = e.target.closest('.gc-del-shop');
      if (editBtn) {
        const item = (window._gcShopItems || []).find(i => i.id === parseInt(editBtn.dataset.id));
        if (item) showItemForm(item);
      }
      if (delBtn) confirmDeactivate(parseInt(delBtn.dataset.id));
    });
  }

  function confirmDeactivate(id) {
    const item = (window._gcShopItems || []).find(i => i.id === id);
    if (!item) return;
    if (!confirm(`Деактивировать "${item.name}"? Товар исчезнет из магазина и рулетки.`)) return;
    api('/shop-items/' + id, { method: 'DELETE' }).then(() => {
      toast('Готово', 'Товар деактивирован', 'ok'); renderTab();
    }).catch(e => toast('Ошибка', e.message, 'err'));
  }

  function showItemForm(item) {
    const isEdit = !!item;
    AsgardUI.showModal({
      title: isEdit ? '✏ Редактировать товар' : '+ Новый товар',
      html: `<div style="padding:16px;display:flex;flex-direction:column;gap:12px;max-height:80vh;overflow-y:auto">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div style="grid-column:1/-1">
            <label style="font-size:11px;color:rgba(255,255,255,.4);display:block;margin-bottom:4px">Название *</label>
            <input id="gc-name" placeholder="Доширак Ролтон" value="${esc(item?.name || '')}" style="${inputStyle}">
          </div>
          <div style="grid-column:1/-1">
            <label style="font-size:11px;color:rgba(255,255,255,.4);display:block;margin-bottom:4px">Описание</label>
            <textarea id="gc-desc" placeholder="Вкусный обед прямо на объекте" rows="2" style="${inputStyle}resize:vertical">${esc(item?.description || '')}</textarea>
          </div>
          <div>
            <label style="font-size:11px;color:rgba(255,255,255,.4);display:block;margin-bottom:4px">Цена (руны) *</label>
            <input id="gc-price" type="number" min="1" placeholder="100" value="${item?.price_runes || ''}" style="${inputStyle}">
          </div>
          <div>
            <label style="font-size:11px;color:rgba(255,255,255,.4);display:block;margin-bottom:4px">Иконка (emoji)</label>
            <input id="gc-icon" placeholder="🍜" value="${esc(item?.icon || '')}" style="${inputStyle}">
          </div>
          <div>
            <label style="font-size:11px;color:rgba(255,255,255,.4);display:block;margin-bottom:4px">Категория</label>
            <select id="gc-cat" style="${inputStyle}">
              ${['food','merch','digital','privilege','cosmetic'].map(c => `<option value="${c}"${(item?.category||'food')===c?' selected':''}>${CAT_RU[c]||c}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="font-size:11px;color:rgba(255,255,255,.4);display:block;margin-bottom:4px">Редкость</label>
            <select id="gc-rarity" style="${inputStyle}">
              ${['common','rare','epic','legendary'].map(r => `<option value="${r}"${(item?.rarity||'common')===r?' selected':''}>${TIER_RU[r]}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="font-size:11px;color:rgba(255,255,255,.4);display:block;margin-bottom:4px">Макс. запас (пусто = ∞)</label>
            <input id="gc-stock" type="number" min="0" placeholder="∞" value="${item?.max_stock || ''}" style="${inputStyle}">
          </div>
          <div>
            <label style="font-size:11px;color:rgba(255,255,255,.4);display:block;margin-bottom:4px">Текущий остаток</label>
            <input id="gc-curstock" type="number" min="0" placeholder="0" value="${item?.current_stock ?? ''}" style="${inputStyle}">
          </div>
        </div>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:rgba(255,255,255,.6);cursor:pointer">
          <input type="checkbox" id="gc-delivery" ${item?.requires_delivery ? 'checked' : ''} style="width:16px;height:16px">
          Физический товар (требует доставки / выдачи РП)
        </label>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:rgba(255,255,255,.6);cursor:pointer">
          <input type="checkbox" id="gc-active" ${item?.is_active !== false ? 'checked' : ''} style="width:16px;height:16px">
          Активен (виден в магазине и рулетке)
        </label>
        <div style="background:rgba(212,168,67,.08);border:1px solid rgba(212,168,67,.2);border-radius:10px;padding:10px;font-size:12px;color:rgba(255,255,255,.5)">
          💡 При сохранении товар <b style="color:${GOLD}">автоматически попадёт в рулетку</b>.
          Вероятность = обратная цене: дешевле → чаще выпадает.
        </div>
        <button id="gc-save" style="padding:14px;border-radius:14px;border:none;background:${GOLD};color:#1a1000;font-size:15px;font-weight:800;cursor:pointer">
          ${isEdit ? '💾 Сохранить' : '✚ Создать товар'}
        </button>
      </div>`,
      onMount: () => {
        document.getElementById('gc-save')?.addEventListener('click', async () => {
          const body = {
            name: document.getElementById('gc-name').value.trim(),
            description: document.getElementById('gc-desc').value.trim() || undefined,
            price_runes: parseInt(document.getElementById('gc-price').value) || 0,
            category: document.getElementById('gc-cat').value,
            rarity: document.getElementById('gc-rarity').value,
            icon: document.getElementById('gc-icon').value.trim() || undefined,
            max_stock: parseInt(document.getElementById('gc-stock').value) || undefined,
            current_stock: parseInt(document.getElementById('gc-curstock').value) ?? undefined,
            requires_delivery: document.getElementById('gc-delivery').checked,
            is_active: document.getElementById('gc-active').checked,
          };
          if (!body.name || !body.price_runes) return toast('Ошибка', 'Укажите название и цену', 'err');
          try {
            if (isEdit) await api('/shop-items/' + item.id, { method: 'PUT', body: JSON.stringify(body) });
            else await api('/shop-items', { method: 'POST', body: JSON.stringify(body) });
            toast('Готово', isEdit ? 'Товар обновлён и рулетка синхронизирована' : 'Товар создан и добавлен в рулетку', 'ok');
            document.querySelector('.modal-overlay')?.click();
            renderTab();
          } catch (e) { toast('Ошибка', e.message, 'err'); }
        });
      },
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // 🎰 PRIZES TAB (только просмотр + toggle active)
  // ══════════════════════════════════════════════════════════════════════
  async function renderPrizesTab(container) {
    const { prizes, total_weight } = await api('/prizes');
    container.innerHTML = '';

    const info = document.createElement('div');
    info.style.cssText = 'margin-bottom:16px;padding:12px 16px;background:rgba(74,144,255,.08);border:1px solid rgba(74,144,255,.2);border-radius:12px;font-size:12px;color:rgba(255,255,255,.6)';
    info.innerHTML = `🎰 <b>Все призы рулетки — это товары магазина.</b> Чтобы добавить приз — добавьте товар на вкладке "Товары".
      Суммарный вес: <b style="color:#fff">${total_weight}</b>.
      Активных призов: <b style="color:#22c55e">${prizes.filter(p => p.is_active).length}</b>.`;
    container.appendChild(info);

    const table = makeTable(
      ['', 'Товар', 'Редкость', 'Категория', 'Цена', 'Вес', '% шанс', 'Вкл/Выкл'],
      prizes.map(p => {
        const tierColor = TIER_COLORS[p.tier] || '#888';
        const statusDot = p.is_active
          ? `<span style="color:#22c55e;font-size:16px">●</span>`
          : `<span style="color:rgba(255,255,255,.2);font-size:16px">●</span>`;
        return [
          statusDot,
          `<b>${esc(p.name)}</b><br><span style="font-size:11px;color:rgba(255,255,255,.4)">${esc(p.description || '')}</span>`,
          `<span style="color:${tierColor};font-weight:700">${TIER_RU[p.tier]||p.tier}</span>`,
          CAT_RU[p.item_category] || (p.item_category || '—'),
          p.price_runes ? `${p.price_runes} ᚱ` : '—',
          p.weight,
          p.is_active ? `<b style="color:${GOLD}">${p.roulette_pct}%</b>` : '<span style="color:rgba(255,255,255,.3)">0%</span>',
          `<button class="gc-toggle-prize" data-id="${p.id}" style="padding:5px 12px;border-radius:8px;border:1px solid ${p.is_active ? 'rgba(239,68,68,.3)' : 'rgba(34,197,94,.3)'};
            background:transparent;color:${p.is_active ? '#ef4444' : '#22c55e'};font-size:11px;cursor:pointer">
            ${p.is_active ? 'Отключить' : 'Включить'}</button>`,
        ];
      })
    );
    container.appendChild(table);
    window._gcPrizes = prizes;

    table.addEventListener('click', async e => {
      const btn = e.target.closest('.gc-toggle-prize');
      if (!btn) return;
      const id = parseInt(btn.dataset.id);
      try {
        const r = await api('/prizes/' + id + '/toggle', { method: 'PUT', body: '{}' });
        toast('Готово', r.is_active ? 'Приз включён' : 'Приз отключён', 'ok');
        renderTab();
      } catch (e) { toast('Ошибка', e.message, 'err'); }
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // ⚔ QUESTS TAB
  // ══════════════════════════════════════════════════════════════════════
  async function renderQuestsTab(container) {
    const { quests } = await api('/quests');
    container.innerHTML = '';

    const hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;align-items:center;justify-content:flex-end;margin-bottom:16px';
    hdr.innerHTML = `<button id="gc-add-quest" style="padding:10px 20px;border-radius:12px;background:${GOLD};color:#1a1000;font-weight:700;font-size:13px;border:none;cursor:pointer">+ Добавить квест</button>`;
    container.appendChild(hdr);
    document.getElementById('gc-add-quest').addEventListener('click', () => showQuestForm(null));

    const table = makeTable(
      ['', 'Тип', 'Название', 'Цель', 'Награда', 'Действия'],
      quests.map(q => [
        q.is_active ? '<span style="color:#22c55e">●</span>' : '<span style="color:rgba(255,255,255,.2)">●</span>',
        q.quest_type,
        `<b>${esc(q.name)}</b><br><span style="font-size:11px;color:rgba(255,255,255,.4)">${esc(q.description || '')}</span>`,
        `${esc(q.target_action)} × ${q.target_count}`,
        `<b style="color:${GOLD}">${q.reward_amount} ${q.reward_type}</b>`,
        `<button class="gc-edit-quest" data-id="${q.id}" style="padding:5px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:transparent;color:rgba(255,255,255,.7);font-size:12px;cursor:pointer">✏</button>
         <button class="gc-del-quest" data-id="${q.id}" style="padding:5px 10px;border-radius:8px;border:1px solid rgba(239,68,68,.3);background:transparent;color:#ef4444;font-size:12px;cursor:pointer;margin-left:4px">✕</button>`,
      ])
    );
    container.appendChild(table);
    window._gcQuests = quests;

    table.addEventListener('click', e => {
      const editBtn = e.target.closest('.gc-edit-quest');
      const delBtn = e.target.closest('.gc-del-quest');
      if (editBtn) {
        const quest = (window._gcQuests || []).find(q => q.id === parseInt(editBtn.dataset.id));
        if (quest) showQuestForm(quest);
      }
      if (delBtn) {
        if (!confirm('Деактивировать квест?')) return;
        api('/quests/' + parseInt(delBtn.dataset.id), { method: 'DELETE' })
          .then(() => { toast('Готово', 'Квест деактивирован', 'ok'); renderTab(); })
          .catch(e => toast('Ошибка', e.message, 'err'));
      }
    });
  }

  function showQuestForm(quest) {
    const isEdit = !!quest;
    AsgardUI.showModal({
      title: isEdit ? '✏ Редактировать квест' : '+ Новый квест',
      html: `<div style="padding:16px;display:flex;flex-direction:column;gap:12px">
        <div><label style="font-size:11px;color:rgba(255,255,255,.4);display:block;margin-bottom:4px">Название *</label>
          <input id="gc-name" placeholder="Выполни 5 объектов за неделю" value="${esc(quest?.name || '')}" style="${inputStyle}"></div>
        <div><label style="font-size:11px;color:rgba(255,255,255,.4);display:block;margin-bottom:4px">Описание</label>
          <textarea id="gc-desc" rows="2" style="${inputStyle}resize:vertical">${esc(quest?.description || '')}</textarea></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div><label style="font-size:11px;color:rgba(255,255,255,.4);display:block;margin-bottom:4px">Тип</label>
            <select id="gc-qtype" style="${inputStyle}">
              ${['daily','weekly','seasonal','permanent'].map(t => `<option value="${t}"${quest?.quest_type===t?' selected':''}>${t}</option>`).join('')}
            </select></div>
          <div><label style="font-size:11px;color:rgba(255,255,255,.4);display:block;margin-bottom:4px">Иконка</label>
            <input id="gc-icon" placeholder="⚔" value="${esc(quest?.icon || '')}" style="${inputStyle}"></div>
          <div><label style="font-size:11px;color:rgba(255,255,255,.4);display:block;margin-bottom:4px">target_action</label>
            <input id="gc-action" placeholder="complete_work" value="${esc(quest?.target_action || '')}" style="${inputStyle}"></div>
          <div><label style="font-size:11px;color:rgba(255,255,255,.4);display:block;margin-bottom:4px">target_count</label>
            <input id="gc-count" type="number" min="1" value="${quest?.target_count || 1}" style="${inputStyle}"></div>
          <div><label style="font-size:11px;color:rgba(255,255,255,.4);display:block;margin-bottom:4px">Награда (кол-во)</label>
            <input id="gc-reward" type="number" min="0" value="${quest?.reward_amount || 0}" style="${inputStyle}"></div>
          <div><label style="font-size:11px;color:rgba(255,255,255,.4);display:block;margin-bottom:4px">Тип награды</label>
            <select id="gc-rtype" style="${inputStyle}">
              ${['runes','xp'].map(t => `<option value="${t}"${quest?.reward_type===t?' selected':''}>${t}</option>`).join('')}
            </select></div>
        </div>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:rgba(255,255,255,.6);cursor:pointer">
          <input type="checkbox" id="gc-active" ${quest?.is_active !== false ? 'checked' : ''} style="width:16px;height:16px"> Активен
        </label>
        <button id="gc-save" style="padding:14px;border-radius:14px;border:none;background:${GOLD};color:#1a1000;font-size:15px;font-weight:800;cursor:pointer">
          ${isEdit ? '💾 Сохранить' : '✚ Создать'}
        </button>
      </div>`,
      onMount: () => {
        document.getElementById('gc-save')?.addEventListener('click', async () => {
          const body = {
            name: document.getElementById('gc-name').value.trim(),
            description: document.getElementById('gc-desc').value.trim() || undefined,
            quest_type: document.getElementById('gc-qtype').value,
            icon: document.getElementById('gc-icon').value.trim() || undefined,
            target_action: document.getElementById('gc-action').value.trim(),
            target_count: parseInt(document.getElementById('gc-count').value) || 1,
            reward_amount: parseInt(document.getElementById('gc-reward').value) || 0,
            reward_type: document.getElementById('gc-rtype').value,
            is_active: document.getElementById('gc-active').checked,
          };
          if (!body.name || !body.target_action) return toast('Ошибка', 'Укажите название и target_action', 'err');
          try {
            if (isEdit) await api('/quests/' + quest.id, { method: 'PUT', body: JSON.stringify(body) });
            else await api('/quests', { method: 'POST', body: JSON.stringify(body) });
            toast('Готово', isEdit ? 'Квест обновлён' : 'Квест создан', 'ok');
            document.querySelector('.modal-overlay')?.click();
            renderTab();
          } catch (e) { toast('Ошибка', e.message, 'err'); }
        });
      },
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // 🏆 WINNERS TAB
  // ══════════════════════════════════════════════════════════════════════
  let winnersFilter = { status: '', from: '', to: '' };

  async function renderWinnersTab(container) {
    container.innerHTML = '';

    // Filter bar
    const filterBar = document.createElement('div');
    filterBar.style.cssText = 'display:flex;align-items:flex-end;gap:10px;margin-bottom:16px;flex-wrap:wrap;background:#141828;padding:14px;border-radius:14px;border:1px solid rgba(255,255,255,.06)';
    filterBar.innerHTML = `
      <div>
        <label style="font-size:11px;color:rgba(255,255,255,.4);display:block;margin-bottom:4px">Статус</label>
        <select id="gc-w-status" style="${inputStyle}width:140px">
          <option value="">Все</option>
          <option value="pending" ${winnersFilter.status==='pending'?'selected':''}>⏳ Ожидает выдачи</option>
          <option value="delivered" ${winnersFilter.status==='delivered'?'selected':''}>✅ Выдано</option>
        </select>
      </div>
      <div>
        <label style="font-size:11px;color:rgba(255,255,255,.4);display:block;margin-bottom:4px">С даты</label>
        <input id="gc-w-from" type="date" value="${winnersFilter.from}" style="${inputStyle}width:150px">
      </div>
      <div>
        <label style="font-size:11px;color:rgba(255,255,255,.4);display:block;margin-bottom:4px">По дату</label>
        <input id="gc-w-to" type="date" value="${winnersFilter.to}" style="${inputStyle}width:150px">
      </div>
      <button id="gc-w-apply" style="padding:10px 20px;border-radius:10px;background:${GOLD};color:#1a1000;font-weight:700;font-size:13px;border:none;cursor:pointer;height:38px">Применить</button>
      <button id="gc-w-reset" style="padding:10px 16px;border-radius:10px;border:1px solid rgba(255,255,255,.1);background:transparent;color:rgba(255,255,255,.6);font-size:13px;cursor:pointer;height:38px">Сбросить</button>`;
    container.appendChild(filterBar);

    document.getElementById('gc-w-apply').addEventListener('click', () => {
      winnersFilter.status = document.getElementById('gc-w-status').value;
      winnersFilter.from = document.getElementById('gc-w-from').value;
      winnersFilter.to = document.getElementById('gc-w-to').value;
      loadWinnersData(container);
    });
    document.getElementById('gc-w-reset').addEventListener('click', () => {
      winnersFilter = { status: '', from: '', to: '' };
      document.getElementById('gc-w-status').value = '';
      document.getElementById('gc-w-from').value = '';
      document.getElementById('gc-w-to').value = '';
      loadWinnersData(container);
    });

    const statsEl = document.createElement('div');
    statsEl.id = 'gc-w-stats';
    statsEl.style.cssText = 'margin-bottom:12px';
    container.appendChild(statsEl);

    const tableWrap = document.createElement('div');
    tableWrap.id = 'gc-w-table';
    container.appendChild(tableWrap);

    await loadWinnersData(container);
  }

  async function loadWinnersData(container) {
    const tableWrap = document.getElementById('gc-w-table');
    const statsEl = document.getElementById('gc-w-stats');
    if (!tableWrap) return;
    tableWrap.innerHTML = '<div style="text-align:center;padding:20px;color:rgba(255,255,255,.4)">Загрузка…</div>';

    const params = new URLSearchParams();
    if (winnersFilter.status) params.set('status', winnersFilter.status);
    if (winnersFilter.from) params.set('from', winnersFilter.from);
    if (winnersFilter.to) params.set('to', winnersFilter.to);

    try {
      const { wins, stats } = await api('/winners?' + params.toString());

      // Stats cards
      if (statsEl) {
        statsEl.innerHTML = `
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin-bottom:16px">
            <div style="background:#141828;border-radius:12px;padding:14px;border:1px solid rgba(255,255,255,.06);text-align:center">
              <div style="font-size:24px;font-weight:800;color:#fff">${stats.total_spins}</div>
              <div style="font-size:11px;color:rgba(255,255,255,.4);margin-top:4px">Всего спинов</div>
            </div>
            <div style="background:#141828;border-radius:12px;padding:14px;border:1px solid rgba(255,255,255,.06);text-align:center">
              <div style="font-size:24px;font-weight:800;color:#f59e0b">${stats.pending_deliveries}</div>
              <div style="font-size:11px;color:rgba(255,255,255,.4);margin-top:4px">Ждут выдачи</div>
            </div>
            <div style="background:#141828;border-radius:12px;padding:14px;border:1px solid rgba(255,255,255,.06);text-align:center">
              <div style="font-size:24px;font-weight:800;color:#22c55e">${stats.delivered}</div>
              <div style="font-size:11px;color:rgba(255,255,255,.4);margin-top:4px">Выдано</div>
            </div>
            <div style="background:#141828;border-radius:12px;padding:14px;border:1px solid rgba(255,255,255,.06);text-align:center">
              <div style="font-size:24px;font-weight:800;color:${GOLD}">${stats.rare_wins}</div>
              <div style="font-size:11px;color:rgba(255,255,255,.4);margin-top:4px">Редких призов</div>
            </div>
          </div>`;
      }

      if (!wins.length) {
        tableWrap.innerHTML = '<div style="text-align:center;padding:40px;color:rgba(255,255,255,.3)">Нет данных по выбранным фильтрам</div>';
        return;
      }

      const table = makeTable(
        ['Дата', 'Сотрудник', 'Объект', 'Приз', 'Редкость', 'Статус', 'Действие'],
        wins.map(w => {
          const dt = new Date(w.spin_at);
          const dateStr = `${dt.getDate().toString().padStart(2,'0')}.${(dt.getMonth()+1).toString().padStart(2,'0')}.${dt.getFullYear()}`;
          const tierColor = TIER_COLORS[w.tier] || '#888';
          const statusColor = DELIVERY_COLOR[w.delivery_status] || '#888';
          const statusRu = DELIVERY_RU[w.delivery_status] || (w.delivery_status ? w.delivery_status : '—');
          const icon = w.item_icon ? `${w.item_icon} ` : '';

          let actionBtn = '';
          if (w.fulfillment_id && w.delivery_status === 'pending') {
            actionBtn = `<button class="gc-mark-ready" data-fid="${w.fulfillment_id}"
              style="padding:5px 10px;border-radius:8px;border:1px solid rgba(74,144,255,.4);background:transparent;color:#4A90FF;font-size:11px;cursor:pointer;white-space:nowrap">
              📦 Готово</button>`;
          } else if (w.fulfillment_id && w.delivery_status === 'ready') {
            actionBtn = `<button class="gc-mark-delivered" data-fid="${w.fulfillment_id}"
              style="padding:5px 10px;border-radius:8px;border:1px solid rgba(34,197,94,.4);background:transparent;color:#22c55e;font-size:11px;cursor:pointer;white-space:nowrap">
              ✅ Выдать</button>`;
          } else if (w.delivery_status === 'delivered') {
            actionBtn = `<span style="font-size:11px;color:rgba(255,255,255,.3)">${w.delivered_at ? new Date(w.delivered_at).toLocaleDateString('ru') : '✓'}</span>`;
          }

          return [
            `<span style="font-size:12px;white-space:nowrap">${dateStr}</span>`,
            `<b style="font-size:13px">${esc(w.employee_name || '—')}</b><br><span style="font-size:11px;color:rgba(255,255,255,.4)">${esc(w.employee_phone || '')}</span>`,
            `<span style="font-size:12px;color:rgba(255,255,255,.5)">${esc(w.work_name || '—')}</span>`,
            `<b>${icon}${esc(w.prize_name)}</b>`,
            `<span style="color:${tierColor};font-weight:700;font-size:12px">${TIER_RU[w.tier]||w.tier}</span>`,
            `<span style="color:${statusColor};font-size:12px;white-space:nowrap">${statusRu}</span>`,
            actionBtn,
          ];
        })
      );
      tableWrap.innerHTML = '';
      tableWrap.appendChild(table);
      window._gcWins = wins;

      // Delivery actions
      table.addEventListener('click', async e => {
        const readyBtn = e.target.closest('.gc-mark-ready');
        const delivBtn = e.target.closest('.gc-mark-delivered');
        if (readyBtn) {
          try {
            await api('/winners/delivery/' + readyBtn.dataset.fid, { method: 'PUT', body: JSON.stringify({ status: 'ready' }) });
            toast('Готово', 'Статус обновлён: готово к выдаче', 'ok');
            loadWinnersData(container);
          } catch (ex) { toast('Ошибка', ex.message, 'err'); }
        }
        if (delivBtn) {
          const note = prompt('Комментарий к выдаче (необязательно):') ?? '';
          try {
            await api('/winners/delivery/' + delivBtn.dataset.fid, { method: 'PUT', body: JSON.stringify({ status: 'delivered', delivery_note: note }) });
            toast('Выдан', 'Приз отмечен как выданный', 'ok');
            loadWinnersData(container);
          } catch (ex) { toast('Ошибка', ex.message, 'err'); }
        }
      });

    } catch (e) {
      tableWrap.innerHTML = `<div style="color:#ef4444;padding:20px">${esc(String(e))}</div>`;
    }
  }

  // ═══ HELPERS ═══
  function makeTable(headers, rows) {
    const t = document.createElement('table');
    t.style.cssText = 'width:100%;border-collapse:collapse;font-size:13px';
    t.innerHTML = `
      <thead>
        <tr style="border-bottom:1px solid rgba(255,255,255,.08)">
          ${headers.map(h => `<th style="text-align:left;padding:10px 12px;color:rgba(255,255,255,.4);font-size:11px;font-weight:600;white-space:nowrap">${h}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${rows.map(row => `
          <tr style="border-bottom:1px solid rgba(255,255,255,.04)" class="gc-row">
            ${row.map(cell => `<td style="padding:10px 12px;color:#fff;vertical-align:middle">${cell}</td>`).join('')}
          </tr>`).join('')}
      </tbody>`;

    // Row hover effect
    t.querySelectorAll('.gc-row').forEach(tr => {
      tr.addEventListener('mouseenter', () => tr.style.background = 'rgba(255,255,255,.02)');
      tr.addEventListener('mouseleave', () => tr.style.background = '');
    });
    return t;
  }

  return { render };
})();
