/**
 * AsgardGamificationCrud — CRUD for Shop Items, Prizes, Quests
 * ═══════════════════════════════════════════════════════════════════
 * Route: #/gamification-admin
 * 3 tabs: Shop Items | Prizes | Quests
 */
window.AsgardGamificationCrud = (function () {
  'use strict';

  const { $, $$, esc, toast } = AsgardUI;

  function hdr() {
    const t = localStorage.getItem('asgard_token') || localStorage.getItem('auth_token');
    return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
  }
  async function api(path, opts = {}) {
    const r = await fetch('/api/gamification/crud' + path, { headers: hdr(), ...opts });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || 'HTTP ' + r.status); }
    return r.json();
  }

  let currentTab = 'shop';
  let layoutEl = null;

  async function render({ layout, title }) {
    layoutEl = layout;
    layout.innerHTML = `<div style="max-width:1200px;margin:0 auto;padding:24px 16px">
      <h1 style="font-size:22px;font-weight:800;color:var(--gold,#D4A843);margin-bottom:16px">${esc(title)}</h1>
      <div id="gc-tabs" style="display:flex;gap:6px;margin-bottom:16px;border-bottom:1px solid var(--brd,rgba(255,255,255,.08));padding-bottom:8px"></div>
      <div id="gc-content"></div>
    </div>`;

    const tabs = [
      { id: 'shop', label: '🛍 Товары магазина' },
      { id: 'prizes', label: '🎰 Призы рулетки' },
      { id: 'quests', label: '⚔ Квесты' },
    ];

    const tabBar = document.getElementById('gc-tabs');
    tabs.forEach(tab => {
      const btn = document.createElement('button');
      btn.className = 'btn ghost';
      btn.textContent = tab.label;
      btn.dataset.tab = tab.id;
      btn.style.cssText = 'padding:8px 16px;font-size:13px;border-radius:8px 8px 0 0;cursor:pointer;' +
        (tab.id === currentTab ? 'border-bottom:2px solid var(--gold,#D4A843);color:var(--gold,#D4A843);' : '');
      btn.addEventListener('click', () => {
        currentTab = tab.id;
        tabBar.querySelectorAll('button').forEach(b => { b.style.borderBottom = 'none'; b.style.color = ''; });
        btn.style.borderBottom = '2px solid var(--gold,#D4A843)';
        btn.style.color = 'var(--gold,#D4A843)';
        renderTab();
      });
      tabBar.appendChild(btn);
    });

    renderTab();
  }

  async function renderTab() {
    const content = document.getElementById('gc-content');
    if (!content) return;
    content.innerHTML = '<div style="text-align:center;padding:20px;color:var(--t3,#888)">Загрузка…</div>';

    try {
      if (currentTab === 'shop') await renderShopTab(content);
      else if (currentTab === 'prizes') await renderPrizesTab(content);
      else await renderQuestsTab(content);
    } catch (e) {
      content.innerHTML = '<div style="color:#ef4444;padding:20px">Ошибка: ' + esc(String(e)) + '</div>';
    }
  }

  // ═══ SHOP TAB ═══
  async function renderShopTab(container) {
    const data = await api('/shop-items');
    const items = data.items || [];
    container.innerHTML = '';

    const addBtn = document.createElement('button');
    addBtn.className = 'btn';
    addBtn.style.cssText = 'margin-bottom:16px;padding:8px 20px;border-radius:10px;background:var(--gold,#D4A843);color:#1a1000;font-weight:700;border:none;cursor:pointer';
    addBtn.textContent = '+ Добавить товар';
    addBtn.addEventListener('click', () => showItemForm(null));
    container.appendChild(addBtn);

    const table = makeTable(['Статус', 'Название', 'Категория', 'Цена (руны)', 'Запас', 'Действия'], items.map(item => [
      item.is_active ? '<span style="color:#22c55e">✓</span>' : '<span style="color:#ef4444">✗</span>',
      `<b>${esc(item.name)}</b><br><span style="font-size:11px;color:var(--t3,#888)">${esc(item.description || '')}</span>`,
      esc(item.category),
      item.price_runes,
      item.max_stock ? `${item.current_stock}/${item.max_stock}` : '∞',
      `<button class="btn ghost" style="font-size:11px;padding:4px 10px" onclick="AsgardGamificationCrud._editShop(${item.id})">✏</button>`,
    ]));
    container.appendChild(table);

    // Store items for edit
    window._gcShopItems = items;
  }

  function showItemForm(item) {
    const isEdit = !!item;
    AsgardUI.showModal({
      title: isEdit ? '✏ Редактировать товар' : '+ Новый товар',
      html: `<div style="padding:16px;display:flex;flex-direction:column;gap:12px">
        <input id="gc-name" placeholder="Название" value="${esc(item?.name || '')}" style="${inputStyle}">
        <textarea id="gc-desc" placeholder="Описание" rows="2" style="${inputStyle}">${esc(item?.description || '')}</textarea>
        <div style="display:flex;gap:8px">
          <input id="gc-price" type="number" placeholder="Цена (руны)" value="${item?.price_runes || ''}" style="${inputStyle}flex:1">
          <select id="gc-cat" style="${inputStyle}flex:1">
            ${['merch','digital','privilege','cosmetic'].map(c => `<option value="${c}"${item?.category === c ? ' selected' : ''}>${c}</option>`).join('')}
          </select>
        </div>
        <div style="display:flex;gap:8px">
          <input id="gc-icon" placeholder="Иконка (emoji)" value="${esc(item?.icon || '')}" style="${inputStyle}flex:1">
          <input id="gc-stock" type="number" placeholder="Макс. запас" value="${item?.max_stock || ''}" style="${inputStyle}flex:1">
        </div>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--t2,#aaa)">
          <input type="checkbox" id="gc-delivery" ${item?.requires_delivery ? 'checked' : ''}> Требует доставки (физический товар)
        </label>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--t2,#aaa)">
          <input type="checkbox" id="gc-active" ${item?.is_active !== false ? 'checked' : ''}> Активен
        </label>
        <button id="gc-save" style="padding:14px;border-radius:14px;border:none;background:var(--gold,#D4A843);color:#1a1000;font-size:15px;font-weight:800;cursor:pointer">
          ${isEdit ? 'Сохранить' : 'Создать'}
        </button>
      </div>`,
      onMount: () => {
        document.getElementById('gc-save')?.addEventListener('click', async () => {
          const body = {
            name: document.getElementById('gc-name').value,
            description: document.getElementById('gc-desc').value,
            price_runes: parseInt(document.getElementById('gc-price').value) || 0,
            category: document.getElementById('gc-cat').value,
            icon: document.getElementById('gc-icon').value || null,
            max_stock: parseInt(document.getElementById('gc-stock').value) || null,
            requires_delivery: document.getElementById('gc-delivery').checked,
            is_active: document.getElementById('gc-active').checked,
          };
          try {
            if (isEdit) await api('/shop-items/' + item.id, { method: 'PUT', body: JSON.stringify(body) });
            else await api('/shop-items', { method: 'POST', body: JSON.stringify(body) });
            toast('Готово', isEdit ? 'Товар обновлён' : 'Товар создан', 'ok');
            document.querySelector('.modal-overlay')?.click();
            renderTab();
          } catch (e) { toast('Ошибка', e.message, 'err'); }
        });
      },
    });
  }

  // ═══ PRIZES TAB ═══
  async function renderPrizesTab(container) {
    const data = await api('/prizes');
    const prizes = data.prizes || [];
    container.innerHTML = '';

    const addBtn = document.createElement('button');
    addBtn.className = 'btn';
    addBtn.style.cssText = 'margin-bottom:16px;padding:8px 20px;border-radius:10px;background:var(--gold,#D4A843);color:#1a1000;font-weight:700;border:none;cursor:pointer';
    addBtn.textContent = '+ Добавить приз';
    addBtn.addEventListener('click', () => showPrizeForm(null));
    container.appendChild(addBtn);

    // Weight total for probability display
    const totalWeight = prizes.reduce((s, p) => s + (p.is_active ? p.weight : 0), 0);

    const table = makeTable(['Статус', 'Tier', 'Тип', 'Название', 'Weight', '% шанс', 'Действия'], prizes.map(p => {
      const pct = totalWeight > 0 && p.is_active ? ((p.weight / totalWeight) * 100).toFixed(1) : '—';
      const tierColors = { common: '#22c55e', rare: '#4A90FF', epic: '#A56EFF', legendary: '#F0C850' };
      return [
        p.is_active ? '<span style="color:#22c55e">✓</span>' : '<span style="color:#ef4444">✗</span>',
        `<span style="color:${tierColors[p.tier] || '#888'};font-weight:700">${p.tier}</span>`,
        p.prize_type,
        `<b>${esc(p.name)}</b>`,
        p.weight,
        `${pct}%`,
        `<button class="btn ghost" style="font-size:11px;padding:4px 10px" onclick="AsgardGamificationCrud._editPrize(${p.id})">✏</button>`,
      ];
    }));
    container.appendChild(table);
    window._gcPrizes = prizes;
  }

  function showPrizeForm(prize) {
    const isEdit = !!prize;
    AsgardUI.showModal({
      title: isEdit ? '✏ Редактировать приз' : '+ Новый приз',
      html: `<div style="padding:16px;display:flex;flex-direction:column;gap:12px">
        <input id="gc-name" placeholder="Название" value="${esc(prize?.name || '')}" style="${inputStyle}">
        <textarea id="gc-desc" placeholder="Описание" rows="2" style="${inputStyle}">${esc(prize?.description || '')}</textarea>
        <div style="display:flex;gap:8px">
          <select id="gc-tier" style="${inputStyle}flex:1">
            ${['common','rare','epic','legendary'].map(t => `<option value="${t}"${prize?.tier === t ? ' selected' : ''}>${t}</option>`).join('')}
          </select>
          <select id="gc-type" style="${inputStyle}flex:1">
            ${['runes','xp','multiplier','extra_spin','merch','sticker','avatar_frame','vip'].map(t => `<option value="${t}"${prize?.prize_type === t ? ' selected' : ''}>${t}</option>`).join('')}
          </select>
        </div>
        <div style="display:flex;gap:8px">
          <input id="gc-value" type="number" placeholder="Value" value="${prize?.value || 0}" style="${inputStyle}flex:1">
          <input id="gc-weight" type="number" placeholder="Weight (вероятность)" value="${prize?.weight || 100}" style="${inputStyle}flex:1">
        </div>
        <input id="gc-icon" placeholder="Иконка (emoji)" value="${esc(prize?.icon || '')}" style="${inputStyle}">
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--t2,#aaa)">
          <input type="checkbox" id="gc-delivery" ${prize?.requires_delivery ? 'checked' : ''}> Требует доставки
        </label>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--t2,#aaa)">
          <input type="checkbox" id="gc-active" ${prize?.is_active !== false ? 'checked' : ''}> Активен
        </label>
        <button id="gc-save" style="padding:14px;border-radius:14px;border:none;background:var(--gold,#D4A843);color:#1a1000;font-size:15px;font-weight:800;cursor:pointer">
          ${isEdit ? 'Сохранить' : 'Создать'}
        </button>
      </div>`,
      onMount: () => {
        document.getElementById('gc-save')?.addEventListener('click', async () => {
          const body = {
            name: document.getElementById('gc-name').value,
            description: document.getElementById('gc-desc').value,
            tier: document.getElementById('gc-tier').value,
            prize_type: document.getElementById('gc-type').value,
            value: parseInt(document.getElementById('gc-value').value) || 0,
            weight: parseInt(document.getElementById('gc-weight').value) || 100,
            icon: document.getElementById('gc-icon').value || null,
            requires_delivery: document.getElementById('gc-delivery').checked,
            is_active: document.getElementById('gc-active').checked,
          };
          try {
            if (isEdit) await api('/prizes/' + prize.id, { method: 'PUT', body: JSON.stringify(body) });
            else await api('/prizes', { method: 'POST', body: JSON.stringify(body) });
            toast('Готово', isEdit ? 'Приз обновлён' : 'Приз создан', 'ok');
            document.querySelector('.modal-overlay')?.click();
            renderTab();
          } catch (e) { toast('Ошибка', e.message, 'err'); }
        });
      },
    });
  }

  // ═══ QUESTS TAB ═══
  async function renderQuestsTab(container) {
    const data = await api('/quests');
    const quests = data.quests || [];
    container.innerHTML = '';

    const addBtn = document.createElement('button');
    addBtn.className = 'btn';
    addBtn.style.cssText = 'margin-bottom:16px;padding:8px 20px;border-radius:10px;background:var(--gold,#D4A843);color:#1a1000;font-weight:700;border:none;cursor:pointer';
    addBtn.textContent = '+ Добавить квест';
    addBtn.addEventListener('click', () => showQuestForm(null));
    container.appendChild(addBtn);

    const table = makeTable(['Статус', 'Тип', 'Название', 'Цель', 'Награда', 'Действия'], quests.map(q => [
      q.is_active ? '<span style="color:#22c55e">✓</span>' : '<span style="color:#ef4444">✗</span>',
      q.quest_type,
      `<b>${esc(q.name)}</b><br><span style="font-size:11px;color:var(--t3,#888)">${esc(q.description || '')}</span>`,
      `${q.target_action} x${q.target_count}`,
      `${q.reward_amount} ${q.reward_type}`,
      `<button class="btn ghost" style="font-size:11px;padding:4px 10px" onclick="AsgardGamificationCrud._editQuest(${q.id})">✏</button>`,
    ]));
    container.appendChild(table);
    window._gcQuests = quests;
  }

  function showQuestForm(quest) {
    const isEdit = !!quest;
    AsgardUI.showModal({
      title: isEdit ? '✏ Редактировать квест' : '+ Новый квест',
      html: `<div style="padding:16px;display:flex;flex-direction:column;gap:12px">
        <input id="gc-name" placeholder="Название" value="${esc(quest?.name || '')}" style="${inputStyle}">
        <textarea id="gc-desc" placeholder="Описание" rows="2" style="${inputStyle}">${esc(quest?.description || '')}</textarea>
        <div style="display:flex;gap:8px">
          <select id="gc-qtype" style="${inputStyle}flex:1">
            ${['daily','weekly','seasonal','permanent'].map(t => `<option value="${t}"${quest?.quest_type === t ? ' selected' : ''}>${t}</option>`).join('')}
          </select>
          <input id="gc-icon" placeholder="Иконка" value="${esc(quest?.icon || '')}" style="${inputStyle}flex:1">
        </div>
        <div style="display:flex;gap:8px">
          <input id="gc-action" placeholder="target_action" value="${esc(quest?.target_action || '')}" style="${inputStyle}flex:1">
          <input id="gc-count" type="number" placeholder="target_count" value="${quest?.target_count || 1}" style="${inputStyle}flex:1">
        </div>
        <div style="display:flex;gap:8px">
          <input id="gc-reward" type="number" placeholder="Награда (рун)" value="${quest?.reward_amount || 0}" style="${inputStyle}flex:1">
          <select id="gc-rtype" style="${inputStyle}flex:1">
            ${['runes','xp'].map(t => `<option value="${t}"${quest?.reward_type === t ? ' selected' : ''}>${t}</option>`).join('')}
          </select>
        </div>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--t2,#aaa)">
          <input type="checkbox" id="gc-active" ${quest?.is_active !== false ? 'checked' : ''}> Активен
        </label>
        <button id="gc-save" style="padding:14px;border-radius:14px;border:none;background:var(--gold,#D4A843);color:#1a1000;font-size:15px;font-weight:800;cursor:pointer">
          ${isEdit ? 'Сохранить' : 'Создать'}
        </button>
      </div>`,
      onMount: () => {
        document.getElementById('gc-save')?.addEventListener('click', async () => {
          const body = {
            name: document.getElementById('gc-name').value,
            description: document.getElementById('gc-desc').value,
            quest_type: document.getElementById('gc-qtype').value,
            icon: document.getElementById('gc-icon').value || null,
            target_action: document.getElementById('gc-action').value,
            target_count: parseInt(document.getElementById('gc-count').value) || 1,
            reward_amount: parseInt(document.getElementById('gc-reward').value) || 0,
            reward_type: document.getElementById('gc-rtype').value,
            is_active: document.getElementById('gc-active').checked,
          };
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

  // ═══ HELPERS ═══
  const inputStyle = 'padding:10px;border-radius:10px;border:1px solid var(--brd,rgba(255,255,255,.1));background:var(--card,#141828);color:var(--t1,#fff);font-size:13px;';

  function makeTable(headers, rows) {
    const t = document.createElement('table');
    t.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px';
    t.innerHTML = `<thead><tr style="color:var(--t3,#888);border-bottom:1px solid var(--brd,rgba(255,255,255,.08))">
      ${headers.map(h => `<th style="text-align:left;padding:8px">${h}</th>`).join('')}
    </tr></thead><tbody>
      ${rows.map(row => `<tr style="border-bottom:1px solid var(--brd,rgba(255,255,255,.04))">
        ${row.map(cell => `<td style="padding:8px;color:var(--t1,#fff)">${cell}</td>`).join('')}
      </tr>`).join('')}
    </tbody>`;
    return t;
  }

  // Public edit callbacks (called from onclick in table)
  function _editShop(id) { showItemForm((window._gcShopItems || []).find(i => i.id === id)); }
  function _editPrize(id) { showPrizeForm((window._gcPrizes || []).find(p => p.id === id)); }
  function _editQuest(id) { showQuestForm((window._gcQuests || []).find(q => q.id === id)); }

  return { render, _editShop, _editPrize, _editQuest };
})();
