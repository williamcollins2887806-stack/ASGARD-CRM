/**
 * AsgardFieldTariffsPage — Тарифная сетка Полевого модуля
 * ═══════════════════════════════════════════════════════
 * Роут: #/field-tariffs  |  Доступ: ADMIN
 */
window.AsgardFieldTariffsPage = (function () {
  'use strict';

  const { $, $$, esc, toast, money } = AsgardUI;

  function hdr() {
    const t = localStorage.getItem('asgard_token') || localStorage.getItem('auth_token');
    return { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' };
  }

  async function api(path, opts) {
    const r = await fetch('/api/field/manage' + path, { headers: hdr(), ...opts });
    return r.json();
  }

  const CATEGORY_LABELS = {
    mlsp: 'МЛСП (морские)',
    ground: 'Наземные (обычные)',
    ground_hard: 'Наземные (тяжёлые)',
    warehouse: 'Склад/база',
    special: 'Специальные',
  };
  const CATEGORY_ORDER = ['mlsp', 'ground', 'ground_hard', 'warehouse', 'special'];

  async function render({ layout, title }) {
    await layout('', { title });
    const root = document.getElementById('layout');
    root.innerHTML = '<div id="ftPage" style="padding:16px;max-width:1100px;margin:0 auto"><div class="help">Загрузка тарифов…</div></div>';
    loadTariffs();
  }

  async function loadTariffs() {
    const wrap = document.getElementById('ftPage');
    if (!wrap) return;

    let data;
    try {
      data = await api('/tariffs?category=all');
    } catch (e) {
      wrap.innerHTML = '<div class="help" style="color:#ef4444">Ошибка загрузки тарифов</div>';
      return;
    }

    const all = [...(data.tariffs || []), ...(data.specials || [])];
    wrap.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:16px';
    header.innerHTML = `<h2 style="margin:0;font-size:18px;font-weight:700">Тарифная сетка <span style="color:var(--t2);font-weight:400;font-size:14px">(${all.length} записей)</span></h2>`;

    const addBtn = document.createElement('button');
    addBtn.className = 'btn gold';
    addBtn.textContent = '+ Добавить тариф';
    addBtn.style.cssText = 'font-size:13px;padding:8px 18px';
    addBtn.addEventListener('click', () => openAddModal());
    header.appendChild(addBtn);
    wrap.appendChild(header);

    // Group by category
    const grouped = {};
    for (const t of all) {
      const cat = t.category || 'special';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(t);
    }

    for (const cat of CATEGORY_ORDER) {
      const items = grouped[cat];
      if (!items || items.length === 0) continue;

      const section = document.createElement('div');
      section.style.cssText = 'margin-bottom:20px';

      const catHeader = document.createElement('div');
      catHeader.style.cssText = 'font-weight:600;font-size:14px;padding:8px 12px;background:var(--bg2, #151922);border-radius:8px 8px 0 0;border-bottom:2px solid var(--gold, #D4A843)';
      catHeader.textContent = CATEGORY_LABELS[cat] || cat;
      section.appendChild(catHeader);

      const table = document.createElement('table');
      table.style.cssText = 'width:100%;border-collapse:collapse;font-size:13px';
      table.innerHTML = `<thead><tr>
        <th style="text-align:left;padding:8px;border-bottom:1px solid var(--brd);font-weight:500;color:var(--t2)">Должность</th>
        <th style="text-align:center;padding:8px;border-bottom:1px solid var(--brd);font-weight:500;color:var(--t2);width:80px">Баллы</th>
        <th style="text-align:right;padding:8px;border-bottom:1px solid var(--brd);font-weight:500;color:var(--t2);width:120px">Ставка ₽/смена</th>
        <th style="text-align:center;padding:8px;border-bottom:1px solid var(--brd);font-weight:500;color:var(--t2);width:60px">Комби</th>
        <th style="text-align:center;padding:8px;border-bottom:1px solid var(--brd);font-weight:500;color:var(--t2);width:60px">Согл.</th>
        <th style="text-align:left;padding:8px;border-bottom:1px solid var(--brd);font-weight:500;color:var(--t2)">Заметки</th>
        <th style="width:40px;border-bottom:1px solid var(--brd)"></th>
      </tr></thead>`;

      const tbody = document.createElement('tbody');
      for (const t of items) {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--brd, rgba(255,255,255,0.04))';
        tr.dataset.id = t.id;

        tr.innerHTML = `
          <td style="padding:6px 8px" class="ft-name">${esc(t.position_name)}</td>
          <td style="padding:6px 8px;text-align:center" class="ft-pts">${t.points}</td>
          <td style="padding:6px 8px;text-align:right;font-weight:600" class="ft-rate">${money(t.rate_per_shift)} ₽</td>
          <td style="padding:6px 8px;text-align:center">${t.is_combinable ? '✓' : ''}</td>
          <td style="padding:6px 8px;text-align:center">${t.requires_approval ? '✓' : ''}</td>
          <td style="padding:6px 8px;color:var(--t2);font-size:12px">${esc(t.notes || '')}</td>
          <td style="padding:6px 8px;text-align:center">
            <button class="ft-del" data-id="${t.id}" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:14px" title="Удалить">✕</button>
          </td>`;

        // Inline editing on double-click for name, points, rate
        const nameCell = tr.querySelector('.ft-name');
        nameCell.style.cursor = 'pointer';
        nameCell.title = 'Дважды кликните для редактирования';
        nameCell.addEventListener('dblclick', () => inlineEdit(nameCell, t.id, 'position_name', t.position_name));

        const ptsCell = tr.querySelector('.ft-pts');
        ptsCell.style.cursor = 'pointer';
        ptsCell.addEventListener('dblclick', () => inlineEdit(ptsCell, t.id, 'points', t.points, 'number'));

        const rateCell = tr.querySelector('.ft-rate');
        rateCell.style.cursor = 'pointer';
        rateCell.addEventListener('dblclick', () => inlineEdit(rateCell, t.id, 'rate_per_shift', t.rate_per_shift, 'number'));

        // Delete button
        tr.querySelector('.ft-del').addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm('Удалить тариф "' + t.position_name + '"?')) return;
          try {
            await api('/tariffs/' + t.id, { method: 'DELETE' });
            toast('Тарифы', 'Удалён', 'ok');
            loadTariffs();
          } catch (err) {
            toast('Ошибка', String(err), 'err');
          }
        });

        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      section.appendChild(table);
      wrap.appendChild(section);
    }

    // Point value note
    const note = document.createElement('div');
    note.className = 'help';
    note.style.cssText = 'margin-top:12px;font-size:12px;color:var(--t2)';
    note.textContent = 'Стоимость 1 балла: 500 ₽. Ставка = Баллы × 500.';
    wrap.appendChild(note);
  }

  function inlineEdit(cell, tariffId, field, currentValue, type) {
    const origHtml = cell.innerHTML;
    const input = document.createElement('input');
    input.type = type || 'text';
    input.value = currentValue;
    input.style.cssText = 'width:100%;padding:4px 6px;font-size:13px;border:1px solid var(--gold);border-radius:4px;background:var(--bg1);color:var(--t1);outline:none';
    cell.innerHTML = '';
    cell.appendChild(input);
    input.focus();
    input.select();

    async function save() {
      const newVal = type === 'number' ? parseFloat(input.value) : input.value.trim();
      if (newVal === currentValue || (type === 'number' && isNaN(newVal))) {
        cell.innerHTML = origHtml;
        return;
      }
      try {
        await api('/tariffs/' + tariffId, {
          method: 'PUT',
          body: JSON.stringify({ [field]: newVal }),
        });
        cell.style.transition = 'background 0.5s';
        cell.style.background = 'rgba(16,185,129,0.15)';
        setTimeout(() => { cell.style.background = ''; }, 800);
        loadTariffs();
      } catch (err) {
        toast('Ошибка', String(err), 'err');
        cell.innerHTML = origHtml;
      }
    }

    input.addEventListener('blur', save);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { cell.innerHTML = origHtml; }
    });
  }

  function openAddModal() {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:1200;display:flex;align-items:center;justify-content:center';

    const modal = document.createElement('div');
    modal.style.cssText = 'background:var(--bg1, #0d1117);border:1px solid var(--brd);border-radius:12px;padding:24px;width:480px;max-width:90vw';
    modal.innerHTML = `
      <h3 style="margin:0 0 16px;font-size:16px">Новый тариф</h3>
      <div style="display:grid;gap:12px">
        <div>
          <label style="font-size:12px;color:var(--t2)">Категория</label>
          <select id="ftAddCat" style="width:100%;padding:8px;border:1px solid var(--brd);border-radius:6px;background:var(--bg2);color:var(--t1);font-size:13px">
            <option value="mlsp">МЛСП (морские)</option>
            <option value="ground" selected>Наземные (обычные)</option>
            <option value="ground_hard">Наземные (тяжёлые)</option>
            <option value="warehouse">Склад/база</option>
            <option value="special">Специальные</option>
          </select>
        </div>
        <div>
          <label style="font-size:12px;color:var(--t2)">Должность</label>
          <input id="ftAddName" type="text" placeholder="Слесарь полный функционал" style="width:100%;padding:8px;border:1px solid var(--brd);border-radius:6px;background:var(--bg2);color:var(--t1);font-size:13px;box-sizing:border-box">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div>
            <label style="font-size:12px;color:var(--t2)">Баллы</label>
            <input id="ftAddPts" type="number" value="12" style="width:100%;padding:8px;border:1px solid var(--brd);border-radius:6px;background:var(--bg2);color:var(--t1);font-size:13px;box-sizing:border-box">
          </div>
          <div>
            <label style="font-size:12px;color:var(--t2)">Ставка (₽/смена)</label>
            <input id="ftAddRate" type="number" value="6000" style="width:100%;padding:8px;border:1px solid var(--brd);border-radius:6px;background:var(--bg2);color:var(--t1);font-size:13px;box-sizing:border-box">
          </div>
        </div>
        <div style="display:flex;gap:16px">
          <label style="font-size:13px;display:flex;align-items:center;gap:6px">
            <input id="ftAddCombo" type="checkbox"> Комбинируется
          </label>
          <label style="font-size:13px;display:flex;align-items:center;gap:6px">
            <input id="ftAddAppr" type="checkbox"> Требует согласования
          </label>
        </div>
        <div>
          <label style="font-size:12px;color:var(--t2)">Заметки</label>
          <input id="ftAddNotes" type="text" placeholder="Необязательно" style="width:100%;padding:8px;border:1px solid var(--brd);border-radius:6px;background:var(--bg2);color:var(--t1);font-size:13px;box-sizing:border-box">
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:20px">
        <button id="ftAddCancel" class="btn" style="padding:8px 18px;font-size:13px">Отмена</button>
        <button id="ftAddSave" class="btn gold" style="padding:8px 18px;font-size:13px">Создать</button>
      </div>`;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    modal.querySelector('#ftAddCancel').addEventListener('click', () => overlay.remove());

    modal.querySelector('#ftAddSave').addEventListener('click', async () => {
      const cat = modal.querySelector('#ftAddCat').value;
      const name = modal.querySelector('#ftAddName').value.trim();
      const pts = parseInt(modal.querySelector('#ftAddPts').value) || 0;
      const rate = parseFloat(modal.querySelector('#ftAddRate').value) || 0;
      const combo = modal.querySelector('#ftAddCombo').checked;
      const appr = modal.querySelector('#ftAddAppr').checked;
      const notes = modal.querySelector('#ftAddNotes').value.trim();

      if (!name) { toast('Ошибка', 'Укажите должность', 'err'); return; }

      try {
        await api('/tariffs', {
          method: 'POST',
          body: JSON.stringify({
            category: cat, position_name: name, points: pts,
            rate_per_shift: rate, is_combinable: combo,
            requires_approval: appr, notes: notes || null,
          }),
        });
        toast('Тарифы', 'Тариф создан', 'ok');
        overlay.remove();
        loadTariffs();
      } catch (err) {
        toast('Ошибка', String(err), 'err');
      }
    });
  }

  return { render };
})();
