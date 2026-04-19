window.AsgardFunnelPage = (function(){
  const {$, $$, esc, toast, showModal, closeModal, formatDate} = AsgardUI;

  // 9 стадий воронки — 1:1 со статусами тендеров
  const STAGES = [
    {id: 'draft',    label: 'Черновики',           color: '#6c757d', statuses: ['Черновик']},
    {id: 'new',      label: 'Новые',               color: '#5b8def', statuses: ['Новый']},
    {id: 'calc',     label: 'На просчёте',         color: '#f39c12', statuses: ['Отправлено на просчёт']},
    {id: 'approval', label: 'Согласование',        color: '#e67e22', statuses: ['Согласование ТКП']},
    {id: 'approved', label: 'Согласовано',          color: '#27ae60', statuses: ['ТКП согласовано']},
    {id: 'sent',     label: 'КП отправлено',       color: '#17a2b8', statuses: ['КП отправлено']},
    {id: 'won',      label: 'Выиграли',            color: '#2ecc71', statuses: ['Выиграли']},
    {id: 'completed',label: 'Завершено',             color: '#1abc9c', statuses: ['Завершена']},
    {id: 'lost',     label: 'Проиграли',           color: '#e74c3c', statuses: ['Проиграли']},
    {id: 'rejected', label: 'Не подходит',          color: '#95a5a6', statuses: ['Не подходит']}
  ];

  // Transition map — загружается с сервера при инициализации
  let _transitionMap = null; // { transitions: {...}, can_move: bool }
  let _archiveReasons = null; // string[]

  async function _authHeaders() {
    const token = localStorage.getItem('asgard_token') || '';
    return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token };
  }

  async function loadTransitionMap() {
    if (_transitionMap) return _transitionMap;
    try {
      const h = await _authHeaders();
      const r = await fetch('/api/tenders/transition-map', { headers: h });
      if (r.ok) _transitionMap = await r.json();
      else _transitionMap = { transitions: {}, can_move: false };
    } catch(e) {
      console.warn('Funnel: failed to load transition-map', e);
      _transitionMap = { transitions: {}, can_move: false };
    }
    return _transitionMap;
  }

  async function loadArchiveReasons() {
    if (_archiveReasons) return _archiveReasons;
    try {
      const h = await _authHeaders();
      const r = await fetch('/api/tenders/archive-reasons', { headers: h });
      if (r.ok) { const d = await r.json(); _archiveReasons = d.reasons || []; }
      else _archiveReasons = [];
    } catch(e) {
      console.warn('Funnel: failed to load archive-reasons', e);
      _archiveReasons = [];
    }
    return _archiveReasons;
  }

  function getStageForStatus(status) {
    if (!status) return 'new';
    for (const stage of STAGES) {
      if (stage.statuses.includes(status)) return stage.id;
    }
    return 'new';
  }

  function money(x) { return AsgardUI.money(x) + ' ₽'; }

  // ── Модалка перехода статуса ──────────────────────────────────────────────
  async function showTransitionModal(tenderId, currentStatus, newStatus) {
    return new Promise(async (resolve) => {
      let html = '';
      const modalId = 'funnelTransitionModal';

      if (newStatus === 'Не подходит') {
        const reasons = await loadArchiveReasons();
        html = `
          <div id="${modalId}">
            <div class="form-group" style="margin-bottom:12px">
              <label class="label">Категория отсева <span style="color:#e74c3c">*</span></label>
              <div id="crw_archiveReason"></div>
            </div>
            <div class="form-group" style="margin-bottom:16px">
              <label class="label">Комментарий <span style="color:#e74c3c">*</span></label>
              <textarea id="funnelComment" class="input" rows="3" placeholder="Почему тендер не подходит?"></textarea>
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end">
              <button class="btn ghost" id="funnelCancel">Отмена</button>
              <button class="btn primary" id="funnelConfirm">Подтвердить</button>
            </div>
          </div>`;
        showModal('Отсеять тендер', html);
        // mount CRSelect for reasons
        const wrap = $('#crw_archiveReason');
        if (wrap && typeof CRSelect !== 'undefined') {
          wrap.appendChild(CRSelect.create({
            id: 'archiveReason', fullWidth: true, placeholder: '— Выберите категорию —',
            options: reasons.map(r => ({ value: r, label: r })),
            searchable: true, dropdownClass: 'z-modal'
          }));
        }
      } else if (newStatus === 'Проиграли') {
        html = `
          <div id="${modalId}">
            <div class="form-group" style="margin-bottom:12px">
              <label class="label">Причина отказа <span style="color:#e74c3c">*</span></label>
              <textarea id="funnelRejectReason" class="input" rows="3" placeholder="Почему проиграли тендер?"></textarea>
            </div>
            <div class="form-group" style="margin-bottom:16px">
              <label class="label">Кто победил</label>
              <input type="text" id="funnelWinner" class="input" placeholder="Название компании-победителя">
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end">
              <button class="btn ghost" id="funnelCancel">Отмена</button>
              <button class="btn primary" id="funnelConfirm">Подтвердить</button>
            </div>
          </div>`;
        showModal('Проиграли тендер', html);
      } else if (newStatus === 'Выиграли') {
        html = `
          <div id="${modalId}">
            <div class="form-group" style="margin-bottom:16px">
              <label class="label">Сумма контракта <span style="color:#e74c3c">*</span></label>
              <input type="number" id="funnelContractSum" class="input" placeholder="0" min="0" step="0.01">
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end">
              <button class="btn ghost" id="funnelCancel">Отмена</button>
              <button class="btn primary" id="funnelConfirm">Подтвердить</button>
            </div>
          </div>`;
        showModal('Выиграли тендер', html);
      } else if (newStatus === 'Новый' && (currentStatus === 'Проиграли' || currentStatus === 'Не подходит')) {
        html = `
          <div id="${modalId}">
            <div class="form-group" style="margin-bottom:16px">
              <label class="label">Причина перезапуска</label>
              <textarea id="funnelRestartReason" class="input" rows="3" placeholder="Почему возвращаем тендер?"></textarea>
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end">
              <button class="btn ghost" id="funnelCancel">Отмена</button>
              <button class="btn primary" id="funnelConfirm">Подтвердить</button>
            </div>
          </div>`;
        showModal(currentStatus === 'Не подходит' ? 'Вернуть из архива' : 'Перезапустить тендер', html);
      } else {
        // Возврат на предыдущий шаг — комментарий
        const stageIdx = s => STAGES.findIndex(st => st.statuses.includes(s));
        const isBackward = stageIdx(newStatus) < stageIdx(currentStatus);
        if (isBackward) {
          html = `
            <div id="${modalId}">
              <div class="form-group" style="margin-bottom:16px">
                <label class="label">Комментарий</label>
                <textarea id="funnelBackComment" class="input" rows="3" placeholder="Причина возврата"></textarea>
              </div>
              <div style="display:flex;gap:8px;justify-content:flex-end">
                <button class="btn ghost" id="funnelCancel">Отмена</button>
                <button class="btn primary" id="funnelConfirm">Подтвердить</button>
              </div>
            </div>`;
          showModal('Вернуть на предыдущий этап', html);
        } else {
          // Прямой переход вперёд — без модалки
          resolve({ confirmed: true, data: {} });
          return;
        }
      }

      // Bind cancel/confirm
      const cancel = $('#funnelCancel');
      const confirm = $('#funnelConfirm');
      if (cancel) cancel.addEventListener('click', () => { closeModal(); resolve({ confirmed: false }); });
      if (confirm) confirm.addEventListener('click', () => {
        // Validate and collect data
        if (newStatus === 'Не подходит') {
          const reason = typeof CRSelect !== 'undefined' ? CRSelect.getValue('archiveReason') : '';
          const comment = ($('#funnelComment')?.value || '').trim();
          if (!reason) { toast('Ошибка', 'Выберите категорию отсева', 'err'); return; }
          if (!comment) { toast('Ошибка', 'Комментарий обязателен', 'err'); return; }
          closeModal();
          resolve({ confirmed: true, data: { reason, comment } });
        } else if (newStatus === 'Проиграли') {
          const reject_reason = ($('#funnelRejectReason')?.value || '').trim();
          const winner = ($('#funnelWinner')?.value || '').trim();
          if (!reject_reason) { toast('Ошибка', 'Укажите причину отказа', 'err'); return; }
          closeModal();
          resolve({ confirmed: true, data: { reject_reason, winner } });
        } else if (newStatus === 'Выиграли') {
          const contract_sum = parseFloat($('#funnelContractSum')?.value || '0');
          if (!contract_sum || contract_sum <= 0) { toast('Ошибка', 'Укажите сумму контракта', 'err'); return; }
          closeModal();
          resolve({ confirmed: true, data: { contract_sum } });
        } else if (newStatus === 'Новый' && (currentStatus === 'Проиграли' || currentStatus === 'Не подходит')) {
          const comment = ($('#funnelRestartReason')?.value || '').trim();
          closeModal();
          resolve({ confirmed: true, data: { comment } });
        } else {
          // backward step
          const comment = ($('#funnelBackComment')?.value || '').trim();
          closeModal();
          resolve({ confirmed: true, data: { comment } });
        }
      });
    });
  }

  async function render({layout, title}) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = '#/login'; return; }
    const user = auth.user;
    const role = user.role;

    // Загружаем transition map с сервера (роль-зависимый)
    const tmap = await loadTransitionMap();
    const canMove = tmap.can_move;
    const transitions = tmap.transitions || {};

    const tenders = await AsgardDB.all('tenders') || [];
    const estimates = await AsgardDB.all('estimates') || [];
    const works = await AsgardDB.all('works') || [];
    const users = await AsgardDB.all('users') || [];
    const usersById = new Map(users.map(u => [u.id, u]));

    // Группируем по стадиям
    const byStage = {};
    STAGES.forEach(s => byStage[s.id] = []);

    tenders.forEach(t => {
      const est = estimates.find(e => e.tender_id === t.id);
      const work = works.find(w => w.tender_id === t.id);

      // Сумма: estimate → works.contract_value → tenders.tender_price → 0
      t._sum = parseFloat(est?.total_sum || work?.contract_value || t.tender_price || t.estimated_sum || 0) || 0;

      // Если работа завершена (акт подписан) — показывать в колонке «Завершено»
      let stage;
      if (work && work.work_status === 'Завершена') {
        stage = 'completed';
      } else {
        stage = getStageForStatus(t.tender_status);
      }
      t._pm = usersById.get(t.responsible_pm_id)?.name || '—';
      if (byStage[stage]) byStage[stage].push(t);
      else byStage.new.push(t);
    });

    // Статистика
    const stats = STAGES.map(s => {
      const items = byStage[s.id];
      const count = items.length;
      const sum = items.reduce((a, t) => a + (t._sum || 0), 0);
      return {id: s.id, count, sum};
    });

    const nonDraftTenders = tenders.filter(t => t.tender_status !== 'Черновик');
    const totalCount = nonDraftTenders.length;
    const totalSum = nonDraftTenders.reduce((a, t) => a + (t._sum || 0), 0);
    const wonSum = byStage.won.reduce((a, t) => a + (t._sum || 0), 0);
    const conversionRate = totalCount > 0 ? ((byStage.won.length / totalCount) * 100).toFixed(1) : 0;

    // Рендер колонок
    const columnsHtml = STAGES.map(stage => {
      const items = byStage[stage.id];
      const stat = stats.find(s => s.id === stage.id);

      const cardsHtml = items.slice(0, 20).map(t => `
        <div class="funnel-card" data-id="${t.id}" data-status="${esc(t.tender_status || '')}" draggable="${canMove}">
          <div class="funnel-card-header">
            <span class="funnel-card-customer">${esc(t.customer_name || t.customer_display || t.customer || 'Без заказчика')}</span>
            <span class="funnel-card-sum">${money(t._sum)}</span>
          </div>
          <div class="funnel-card-title">${esc(t.tender_title || t.tender_number || t.subject || t.tag || 'Без номера')}</div>
          <div class="funnel-card-meta">
            <span>${esc(t._pm)}</span>
            ${t.deadline ? `<span>${esc(formatDate(t.deadline))}</span>` : ''}
          </div>
        </div>
      `).join('');

      const moreHtml = items.length > 20 ? `<div class="funnel-more">+${items.length - 20} ещё</div>` : '';

      return `
        <div class="funnel-column" data-stage="${stage.id}">
          <div class="funnel-column-header" style="--stage-color: ${stage.color}">
            <div class="funnel-column-title">${esc(stage.label)}</div>
            <div class="funnel-column-stats">
              <span class="funnel-count">${stat.count}</span>
              <span class="funnel-sum">${money(stat.sum)}</span>
            </div>
          </div>
          <div class="funnel-cards" data-stage="${stage.id}">
            ${cardsHtml}
            ${moreHtml}
          </div>
        </div>
      `;
    }).join('');

    const html = `
      <div class="page-head">
        <h1>Воронка продаж</h1>
        <div class="motto">Сделки в движении — деньги в кассе.</div>
      </div>

      <div class="card">
        <div class="funnel-stats">
          <div class="funnel-stat">
            <div class="funnel-stat-value">${totalCount}</div>
            <div class="funnel-stat-label">Всего тендеров</div>
          </div>
          <div class="funnel-stat">
            <div class="funnel-stat-value">${money(totalSum)}</div>
            <div class="funnel-stat-label">Общая сумма</div>
          </div>
          <div class="funnel-stat won">
            <div class="funnel-stat-value">${money(wonSum)}</div>
            <div class="funnel-stat-label">Выиграно</div>
          </div>
          <div class="funnel-stat">
            <div class="funnel-stat-value">${conversionRate}%</div>
            <div class="funnel-stat-label">Конверсия</div>
          </div>
        </div>
      </div>

      <div class="funnel-board">
        ${columnsHtml}
      </div>

      <div class="muted small" style="margin-top:12px">
        Перетаскивайте карточки между колонками для изменения статуса. Клик открывает карточку тендера.
      </div>
    `;

    await layout(html, {title: title || 'Воронка продаж', motto: 'Сделки в движении — деньги в кассе.'});

    // Drag & Drop
    let draggedCard = null;

    $$('.funnel-card').forEach(card => {
      card.addEventListener('dragstart', (e) => {
        if (!canMove) { e.preventDefault(); return; }
        draggedCard = card;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });

      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        draggedCard = null;
        $$('.funnel-cards').forEach(col => col.classList.remove('drag-over'));
      });

      card.addEventListener('click', () => {
        const id = card.dataset.id;
        location.hash = `#/tenders?id=${id}`;
      });
    });

    $$('.funnel-cards').forEach(col => {
      col.addEventListener('dragover', (e) => {
        e.preventDefault();
        col.classList.add('drag-over');
      });

      col.addEventListener('dragleave', () => {
        col.classList.remove('drag-over');
      });

      col.addEventListener('drop', async (e) => {
        e.preventDefault();
        col.classList.remove('drag-over');

        if (!draggedCard || !canMove) return;

        const tenderId = Number(draggedCard.dataset.id);
        const currentStatus = draggedCard.dataset.status;
        const newStage = col.dataset.stage;
        const stageInfo = STAGES.find(s => s.id === newStage);

        if (!stageInfo) return;

        const newStatus = stageInfo.statuses[0];
        if (newStatus === currentStatus) return;

        // Проверяем допустимость перехода по серверной карте
        const allowed = transitions[currentStatus] || [];
        if (!allowed.includes(newStatus)) {
          toast('Ошибка', `Переход «${currentStatus}» → «${newStatus}» недоступен для вашей роли`, 'err');
          return;
        }

        // Показываем модалку (если нужна для данного перехода)
        const modal = await showTransitionModal(tenderId, currentStatus, newStatus);
        if (!modal.confirmed) return;

        const headers = await _authHeaders();

        // Выбираем правильный API endpoint
        try {
          if (newStatus === 'Не подходит') {
            // Архивировать: POST /api/tenders/:id/archive
            const r = await fetch(`/api/tenders/${tenderId}/archive`, {
              method: 'POST', headers,
              body: JSON.stringify({ reason: modal.data.reason, comment: modal.data.comment })
            });
            if (!r.ok) { const err = await r.json().catch(() => ({})); toast('Ошибка', err.error || 'Не удалось отсеять тендер', 'err'); return; }
          } else if (newStatus === 'Новый' && currentStatus === 'Не подходит') {
            // Вернуть из архива: POST /api/tenders/:id/unarchive
            const comment = modal.data.comment || 'Возврат из архива';
            const r = await fetch(`/api/tenders/${tenderId}/unarchive`, {
              method: 'POST', headers,
              body: JSON.stringify({ comment })
            });
            if (!r.ok) { const err = await r.json().catch(() => ({})); toast('Ошибка', err.error || 'Не удалось вернуть из архива', 'err'); return; }
          } else {
            // Все остальные переходы: PUT /api/tenders/:id
            const body = { tender_status: newStatus };
            if (modal.data.reject_reason) body.reject_reason = modal.data.reject_reason;
            if (modal.data.winner) body.winner_name = modal.data.winner;
            if (modal.data.contract_sum) body.contract_sum = modal.data.contract_sum;
            if (modal.data.comment) body.status_comment = modal.data.comment;
            const r = await fetch(`/api/tenders/${tenderId}`, {
              method: 'PUT', headers,
              body: JSON.stringify(body)
            });
            if (!r.ok) { const err = await r.json().catch(() => ({})); toast('Ошибка', err.error || 'Не удалось изменить статус', 'err'); return; }
          }

          // Обновляем локальный кэш
          const tender = await AsgardDB.get('tenders', tenderId);
          if (tender) {
            tender.tender_status = newStatus;
            tender.updated_at = new Date().toISOString();
            await AsgardDB.put('tenders', tender);
          }

          toast('Готово', `Статус изменён: ${newStatus}`, 'ok');

          // Перерисовываем карточку в воронке (перемещаем из старой колонки в новую)
          const targetCards = col;
          if (draggedCard && targetCards) {
            draggedCard.dataset.status = newStatus;
            targetCards.appendChild(draggedCard);
          }
          // Пересчитываем счётчики — проще перерисовать страницу
          location.hash = '#/funnel';
        } catch(err) {
          console.warn('Funnel: server save failed', err);
          toast('Ошибка', 'Не удалось сохранить изменения', 'err');
        }
      });
    });
  }

  return { render };
})();
