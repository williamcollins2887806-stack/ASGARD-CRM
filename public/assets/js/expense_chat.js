/**
 * ASGARD CRM — Мимир Кошелёк Проекта (десктоп)
 *
 * Модалка: выбор работы → чат → QR/фото/текст → распознавание → подтверждение → сводка.
 * Вызов: window.openExpenseChat(workId?)
 */
(function() {
  'use strict';

  const CAT_ICONS = { payroll: '👷', cash: '💵', per_diem: '🍽', tickets: '✈', accommodation: '🏨', materials: '📦', subcontract: '🤝', other: '📋' };
  const CAT_LABELS = { payroll: 'ФОТ', cash: 'Наличные', per_diem: 'Суточные', tickets: 'Билеты', accommodation: 'Проживание', materials: 'Материалы', subcontract: 'Субподряд', other: 'Прочее' };
  const money = (v) => Number(v || 0).toLocaleString('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 });

  function getToken() {
    try { return JSON.parse(localStorage.getItem('asgard_session') || '{}').token || localStorage.getItem('asgard_token') || ''; }
    catch { return ''; }
  }

  async function apiFetch(url, opts = {}) {
    const r = await fetch(url, {
      ...opts,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken(), ...(opts.headers || {}) }
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
    return r.json();
  }

  // ── Основная функция ──
  window.openExpenseChat = async function(workId) {
    // Overlay
    const overlay = document.createElement('div');
    overlay.className = 'mimir-ae-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:1100;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;animation:fadeIn .2s ease-out';
    document.body.appendChild(overlay);

    const panel = document.createElement('div');
    panel.style.cssText = 'width:560px;max-height:85vh;background:var(--surface,#1a1a2e);border-radius:20px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.5);animation:slideUp .3s ease-out';
    overlay.appendChild(panel);

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'padding:18px 20px;border-bottom:0.5px solid rgba(255,255,255,0.08);display:flex;align-items:center;gap:12px';
    header.innerHTML = '<span style="font-size:22px">💰</span><div style="flex:1"><div style="font-size:15px;font-weight:700;color:#fff">Кошелёк проекта</div><div id="ecSubtitle" style="font-size:11px;color:rgba(255,255,255,0.4)">Загружаю...</div></div><button id="ecClose" style="background:none;border:none;color:rgba(255,255,255,0.4);font-size:20px;cursor:pointer">✕</button>';
    panel.appendChild(header);

    // Messages area
    const msgs = document.createElement('div');
    msgs.style.cssText = 'flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px';
    panel.appendChild(msgs);

    // Input area
    const inputArea = document.createElement('div');
    inputArea.style.cssText = 'padding:12px 16px;border-top:0.5px solid rgba(255,255,255,0.08);display:flex;align-items:end;gap:8px';
    inputArea.innerHTML = `
      <input type="file" id="ecFileInput" accept="image/*,.pdf,.xlsx,.xls,.doc,.docx" style="display:none">
      <button id="ecQrBtn" style="width:36px;height:36px;border-radius:10px;border:none;background:rgba(212,168,67,0.1);color:#D4A843;cursor:pointer;font-size:16px" title="QR-код">📱</button>
      <button id="ecPhotoBtn" style="width:36px;height:36px;border-radius:10px;border:none;background:rgba(212,168,67,0.1);color:#D4A843;cursor:pointer;font-size:16px" title="Фото/файл">📎</button>
      <input id="ecTextInput" placeholder="Опишите расход..." style="flex:1;padding:8px 14px;border-radius:14px;border:0.5px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:#fff;font-size:13px;outline:none">
      <button id="ecSendBtn" style="width:36px;height:36px;border-radius:10px;border:none;background:linear-gradient(135deg,#D4A843,#B88B2E);color:#fff;cursor:pointer;font-size:14px" title="Отправить">↗</button>
    `;
    panel.appendChild(inputArea);

    // State
    let financials = null;

    // Close handler
    const close = () => { overlay.style.animation = 'fadeOut .2s ease-out forwards'; setTimeout(() => overlay.remove(), 200); };
    header.querySelector('#ecClose').onclick = close;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };

    // Load data
    if (!workId) {
      // Show work picker
      addMimirMsg(msgs, 'Выберите работу для учёта расходов:');
      try {
        const res = await apiFetch('/api/mimir/expense-works');
        const works = (res.works || []).filter(w => w.status && !w.status.toLowerCase().includes('закрыт'));
        if (works.length === 0) { addMimirMsg(msgs, 'Нет активных работ.'); return; }
        const list = document.createElement('div');
        list.style.cssText = 'display:flex;flex-direction:column;gap:6px';
        for (const w of works.slice(0, 10)) {
          const btn = document.createElement('button');
          btn.style.cssText = 'padding:10px 14px;border-radius:12px;border:0.5px solid rgba(212,168,67,0.15);background:rgba(212,168,67,0.04);text-align:left;cursor:pointer;color:#fff;font-size:13px;display:flex;justify-content:space-between;align-items:center';
          btn.innerHTML = `<span>${w.work_title || '#' + w.work_number}</span><span style="color:rgba(255,255,255,0.4);font-size:11px">${money(w.cost_fact)} / ${money(w.contract_value)}</span>`;
          btn.onclick = () => { list.remove(); initChat(w.id); };
          list.appendChild(btn);
        }
        msgs.appendChild(list);
      } catch (e) { addMimirMsg(msgs, 'Ошибка: ' + e.message); }
    } else {
      initChat(workId);
    }

    async function initChat(wId) {
      workId = wId;
      try {
        const res = await apiFetch('/api/mimir/expense-history?work_id=' + wId);
        financials = res.financials;
        updateSubtitle();
        addMimirMsg(msgs, 'Загрузите чек (QR или фото), файл (PDF/Excel) или напишите текстом — я распознаю и предложу внести в расходы.');
        if (res.expenses && res.expenses.length > 0) {
          addMimirMsg(msgs, `Последних расходов: ${res.expenses.length}. Себестоимость: ${money(financials.cost_fact)}.`);
        }
      } catch (e) { addMimirMsg(msgs, 'Ошибка: ' + e.message); }
    }

    function updateSubtitle() {
      if (!financials) return;
      header.querySelector('#ecSubtitle').textContent =
        `${financials.work_title || ''} / Расходы: ${money(financials.cost_fact)} / Маржа: ${financials.margin_pct}%`;
    }

    // QR
    inputArea.querySelector('#ecQrBtn').onclick = () => {
      const qr = prompt('Вставьте содержимое QR-кода фискального чека:');
      if (qr) recognize('qr', qr);
    };

    // Photo/File
    inputArea.querySelector('#ecPhotoBtn').onclick = () => inputArea.querySelector('#ecFileInput').click();
    inputArea.querySelector('#ecFileInput').onchange = async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      e.target.value = '';
      addUserMsg(msgs, '📎 ' + file.name);
      const base64 = await fileToBase64(file);
      recognize('image', base64, file.type);
    };

    // Text
    const textInput = inputArea.querySelector('#ecTextInput');
    inputArea.querySelector('#ecSendBtn').onclick = () => {
      const t = textInput.value.trim();
      if (!t) return;
      textInput.value = '';
      addUserMsg(msgs, t);
      recognize('text', t);
    };
    textInput.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); inputArea.querySelector('#ecSendBtn').click(); } };

    async function recognize(type, data, mimeType) {
      addThinking(msgs);
      try {
        const body = { work_id: Number(workId), type, data };
        if (mimeType) body.mime_type = mimeType;
        const res = await apiFetch('/api/mimir/expense-recognize', { method: 'POST', body: JSON.stringify(body) });
        removeThinking(msgs);
        if (res.success) {
          financials = res.financials;
          showPreview(msgs, res.preview);
        } else {
          addMimirMsg(msgs, 'Не удалось распознать: ' + (res.error || ''));
        }
      } catch (e) {
        removeThinking(msgs);
        addMimirMsg(msgs, 'Ошибка: ' + e.message);
      }
    }

    function showPreview(container, preview) {
      const cat = preview.category || 'other';
      const card = document.createElement('div');
      card.style.cssText = 'border-radius:14px;border:0.5px solid rgba(212,168,67,0.25);background:rgba(26,26,46,0.95);overflow:hidden;animation:scaleIn .3s ease-out';

      const src = preview.source === 'fns' ? '<span style="background:rgba(63,185,80,0.15);color:#3FB950;font-size:10px;padding:2px 8px;border-radius:10px">ФНС</span>' : '';

      card.innerHTML = `
        <div style="padding:10px 14px;display:flex;align-items:center;gap:8px;background:rgba(212,168,67,0.06);border-bottom:0.5px solid rgba(255,255,255,0.06)">
          <span style="color:#D4A843;font-size:14px">✨</span>
          <span style="color:#D4A843;font-size:12px;font-weight:600">Мимир распознал</span>
          ${src}
        </div>
        <div style="padding:12px 14px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <div style="display:flex;align-items:center;gap:6px">
              <span style="font-size:18px">${CAT_ICONS[cat] || '📋'}</span>
              <span style="font-size:12px;font-weight:600;color:#D4A843">${CAT_LABELS[cat] || 'Прочее'}</span>
            </div>
            <span style="font-size:18px;font-weight:700;color:#fff">${money(preview.amount)}</span>
          </div>
          ${preview.supplier ? `<div style="font-size:12px;color:rgba(255,255,255,0.6);margin-bottom:4px">${preview.supplier}${preview.inn ? ' (ИНН: ' + preview.inn + ')' : ''}</div>` : ''}
          ${preview.description ? `<div style="font-size:11px;color:rgba(255,255,255,0.4);margin-bottom:4px">${preview.description}</div>` : ''}
          <div style="font-size:10px;color:rgba(255,255,255,0.3)">${preview.date || ''}${preview.items && preview.items.length ? ' / ' + preview.items.length + ' позиций' : ''}</div>
        </div>
        <div style="display:flex;border-top:0.5px solid rgba(255,255,255,0.06)">
          <button class="ec-reject" style="flex:1;padding:11px;border:none;background:none;color:#F85149;font-size:13px;font-weight:600;cursor:pointer">✕ Отмена</button>
          <div style="width:0.5px;background:rgba(255,255,255,0.06)"></div>
          <button class="ec-confirm" style="flex:1;padding:11px;border:none;background:rgba(63,185,80,0.06);color:#3FB950;font-size:13px;font-weight:700;cursor:pointer">✓ Внести</button>
        </div>
      `;

      card.querySelector('.ec-reject').onclick = () => {
        card.remove();
        addMimirMsg(container, 'Отменено. Загрузите другой чек или опишите расход.');
      };
      card.querySelector('.ec-confirm').onclick = async () => {
        card.querySelector('.ec-confirm').disabled = true;
        card.querySelector('.ec-confirm').textContent = '...';
        try {
          const res = await apiFetch('/api/mimir/expense-confirm', {
            method: 'POST',
            body: JSON.stringify({
              work_id: Number(workId),
              amount: preview.amount,
              date: preview.date,
              category: preview.category,
              supplier: preview.supplier,
              description: preview.description,
              inn: preview.inn || null,
              doc_number: preview.doc_number || null,
              vat_rate: preview.vat_rate || null,
              vat_amount: preview.vat_amount || null,
              amount_ex_vat: preview.amount_ex_vat || null,
              items: preview.items || [],
            })
          });
          card.remove();
          if (res.success) {
            financials = res.after;
            updateSubtitle();
            showConfirmation(container, res);
          } else {
            addMimirMsg(container, 'Ошибка: ' + (res.error || ''));
          }
        } catch (e) {
          card.remove();
          addMimirMsg(container, 'Ошибка: ' + e.message);
        }
      };

      container.appendChild(card);
      card.scrollIntoView({ behavior: 'smooth' });
    }

    function showConfirmation(container, res) {
      const div = document.createElement('div');
      div.style.cssText = 'border-radius:14px;padding:14px;background:rgba(63,185,80,0.06);border:0.5px solid rgba(63,185,80,0.2);animation:goldenFlash .5s ease-out';
      div.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
          <span style="color:#3FB950;font-size:16px">✓</span>
          <span style="color:#3FB950;font-size:14px;font-weight:700">Внесено: ${money(res.delta.cost_fact)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:8px">
          <div>
            <div style="color:rgba(255,255,255,0.4)">Себестоимость (с налогами)</div>
            <div style="color:#fff">${money(res.before.cost_with_tax)} → <b>${money(res.after.cost_with_tax)}</b></div>
          </div>
          <div style="text-align:right">
            <div style="color:rgba(255,255,255,0.4)">Маржа</div>
            <div style="color:${res.delta.margin_pct < 0 ? '#F85149' : '#3FB950'}">${res.before.margin_pct}% → <b>${res.after.margin_pct}%</b> (${res.delta.margin_pct > 0 ? '+' : ''}${res.delta.margin_pct}%)</div>
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:12px">
          <div>
            <div style="color:rgba(255,255,255,0.4)">Чистая прибыль</div>
            <div style="color:${res.after.profit >= 0 ? '#3FB950' : '#F85149'};font-weight:700">${money(res.before.profit)} → <b>${money(res.after.profit)}</b></div>
          </div>
          <div style="text-align:right">
            <div style="color:rgba(255,255,255,0.4)">Налог. нагрузка</div>
            <div style="color:rgba(255,255,255,0.6)">${money(res.after.tax_burden)}</div>
          </div>
        </div>
      `;
      container.appendChild(div);
      div.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // Helpers
  function addMimirMsg(container, text) {
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;gap:8px;align-items:flex-start;animation:slideUp .2s ease-out';
    div.innerHTML = `<div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#D4A843,#B88B2E);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex-shrink:0">M</div><div style="padding:8px 12px;border-radius:4px 14px 14px 14px;background:rgba(255,255,255,0.04);border:0.5px solid rgba(255,255,255,0.06);color:rgba(255,255,255,0.85);font-size:13px;max-width:80%">${text}</div>`;
    container.appendChild(div);
    div.scrollIntoView({ behavior: 'smooth' });
  }

  function addUserMsg(container, text) {
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;justify-content:flex-end';
    div.innerHTML = `<div style="padding:8px 12px;border-radius:14px 14px 4px 14px;background:rgba(212,168,67,0.12);color:#fff;font-size:13px;max-width:75%">${text}</div>`;
    container.appendChild(div);
    div.scrollIntoView({ behavior: 'smooth' });
  }

  function addThinking(container) {
    const div = document.createElement('div');
    div.className = 'ec-thinking';
    div.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 0';
    div.innerHTML = '<span style="color:#D4A843;font-size:11px">✨ Мимир распознаёт...</span>';
    container.appendChild(div);
  }

  function removeThinking(container) {
    const t = container.querySelector('.ec-thinking');
    if (t) t.remove();
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.includes(',') ? reader.result.split(',')[1] : reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
})();
