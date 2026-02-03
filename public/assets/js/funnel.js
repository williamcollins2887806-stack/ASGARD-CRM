window.AsgardFunnelPage = (function(){
  const {$, $$, esc, toast, showModal, closeModal} = AsgardUI;
  
  // Стадии воронки
  const STAGES = [
    {id: 'new', label: 'Новые', color: '#64748b', statuses: ['Новый', 'Получен']},
    {id: 'calc', label: 'В просчёте', color: '#2563eb', statuses: ['В просчёте', 'На просчёте']},
    {id: 'tkp', label: 'КП отправлено', color: '#8b5cf6', statuses: ['КП отправлено', 'ТКП отправлено', 'Согласование ТКП']},
    {id: 'negotiation', label: 'Переговоры', color: '#f59e0b', statuses: ['Переговоры', 'На согласовании', 'ТКП согласовано']},
    {id: 'won', label: 'Выиграли', color: '#16a34a', statuses: ['Выиграли', 'Клиент согласился', 'Контракт']},
    {id: 'lost', label: 'Проиграли', color: '#dc2626', statuses: ['Проиграли', 'Клиент отказался', 'Отказ']}
  ];
  
  function getStageForStatus(status) {
    if (!status) return 'new';
    const s = status.toLowerCase();
    for (const stage of STAGES) {
      for (const st of stage.statuses) {
        if (s.includes(st.toLowerCase()) || st.toLowerCase().includes(s)) {
          return stage.id;
        }
      }
    }
    return 'new';
  }
  
  function money(x) {
    const num = parseFloat(x) || 0;
    if (!num && num !== 0) return '—';
    return num.toLocaleString('ru-RU') + ' ₽';
  }
  
  async function render({layout, title}) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = '#/login'; return; }
    const user = auth.user;
    
    const tenders = await AsgardDB.all('tenders') || [];
    const estimates = await AsgardDB.all('estimates') || [];
    const users = await AsgardDB.all('users') || [];
    const usersById = new Map(users.map(u => [u.id, u]));
    
    // Группируем по стадиям
    const byStage = {};
    STAGES.forEach(s => byStage[s.id] = []);
    
    tenders.forEach(t => {
      const stage = getStageForStatus(t.tender_status);
      // Добавляем сумму из estimate если есть
      const est = estimates.find(e => e.tender_id === t.id);
      t._sum = est?.total_sum || t.estimated_sum || 0;
      t._pm = usersById.get(t.responsible_pm_id)?.name || '—';
      byStage[stage].push(t);
    });
    
    // Считаем статистику
    const stats = STAGES.map(s => {
      const items = byStage[s.id];
      const count = items.length;
      const sum = items.reduce((a, t) => a + (t._sum || 0), 0);
      return {id: s.id, count, sum};
    });
    
    const totalCount = tenders.length;
    const totalSum = tenders.reduce((a, t) => a + (t._sum || 0), 0);
    const wonSum = byStage.won.reduce((a, t) => a + (t._sum || 0), 0);
    const conversionRate = totalCount > 0 ? ((byStage.won.length / totalCount) * 100).toFixed(1) : 0;
    
    // Рендер колонок
    const columnsHtml = STAGES.map(stage => {
      const items = byStage[stage.id];
      const stat = stats.find(s => s.id === stage.id);
      
      const cardsHtml = items.slice(0, 20).map(t => `
        <div class="funnel-card" data-id="${t.id}" draggable="true">
          <div class="funnel-card-header">
            <span class="funnel-card-customer">${esc(t.customer || 'Без заказчика')}</span>
            <span class="funnel-card-sum">${money(t._sum)}</span>
          </div>
          <div class="funnel-card-title">${esc(t.tender_number || t.tag || 'Без номера')}</div>
          <div class="funnel-card-meta">
            <span>${esc(t._pm)}</span>
            ${t.deadline ? `<span>⏰ ${esc(t.deadline)}</span>` : ''}
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
        location.hash = `#/tenders?highlight=${id}`;
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
        
        if (!draggedCard) return;
        
        const tenderId = Number(draggedCard.dataset.id);
        const newStage = col.dataset.stage;
        const stageInfo = STAGES.find(s => s.id === newStage);
        
        if (!stageInfo) return;
        
        // Обновляем статус тендера
        const tender = await AsgardDB.get('tenders', tenderId);
        if (!tender) return;
        
        const newStatus = stageInfo.statuses[0]; // Первый статус стадии
        tender.tender_status = newStatus;
        tender.updated_at = new Date().toISOString();
        
        await AsgardDB.put('tenders', tender);
        toast('Готово', `Статус изменён: ${newStatus}`, 'ok');
        
        // Перезагрузка страницы
        location.hash = '#/funnel';
      });
    });
  }
  
  return { render };
})();
