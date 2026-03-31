/**
 * АСГАРД CRM — Глобальный поиск
 * 
 * Функции:
 * - Поиск по всем разделам (тендеры, работы, клиенты, сотрудники)
 * - Быстрый доступ по Ctrl+K
 * - Фильтрация по типу
 * - История поиска
 */
window.AsgardSearch = (function(){
  const { $, $$, esc, toast, showModal, closeModal } = AsgardUI;

  const NAV_GROUPS_FOR_SEARCH = [
    { icon: '🏠', label: 'Главная', route: '#/home' },
    { icon: '📋', label: 'Тендеры', route: '#/tenders' },
    { icon: '⚒️', label: 'Работы', route: '#/pm-works' },
    { icon: '💰', label: 'Финансы', route: '#/finances' },
    { icon: '👥', label: 'Персонал', route: '#/personnel' },
    { icon: '📧', label: 'Корреспонденция', route: '#/correspondence' },
    { icon: '⚙️', label: 'Настройки', route: '#/settings' }
  ];

  const SEARCH_TYPES = {
    all: { label: 'Везде', icon: '🔍' },
    tender: { label: 'Тендеры', icon: '📋', table: 'tenders', fields: ['tender_title', 'customer_name', 'customer_inn', 'purchase_url'] },
    work: { label: 'Работы', icon: '🔧', table: 'works', fields: ['work_title', 'work_number', 'customer_name'] },
    customer: { label: 'Клиенты', icon: '🏢', table: 'customers', fields: ['name', 'inn', 'city'], keyField: 'inn' },
    employee: { label: 'Сотрудники', icon: '👤', table: 'employees', fields: ['name', 'phone', 'position'] },
    invoice: { label: 'Счета', icon: '💰', table: 'invoices', fields: ['invoice_number', 'customer_name'] },
    act: { label: 'Акты', icon: '📄', table: 'acts', fields: ['act_number', 'customer_name'] },
    task: { label: 'Задачи', icon: '✅', table: 'tasks', fields: ['title', 'description'] },
    contract: { label: 'Договоры', icon: '📑', table: 'contracts', fields: ['number', 'subject', 'counterparty_name'] },
    correspondence: { label: 'Корреспонденция', icon: '📧', table: 'correspondence', fields: ['subject', 'counterparty', 'doc_number'] },
    estimate: { label: 'Расчёты', icon: '📊', table: 'estimates', fields: ['title', 'customer_name'] },
    equipment: { label: 'Оборудование', icon: '🔩', table: 'equipment', fields: ['name', 'inventory_number', 'serial_number'] }
  };
  
  let searchHistory = [];
  let isOpen = false;
  
  // Загрузка истории
  async function loadHistory() {
    try {
      const data = localStorage.getItem('asgard_search_history');
      searchHistory = data ? JSON.parse(data) : [];
    } catch (e) {
      searchHistory = [];
    }
  }
  
  // Сохранение в историю
  function saveToHistory(query) {
    if (!query || query.length < 2) return;
    
    searchHistory = searchHistory.filter(h => h !== query);
    searchHistory.unshift(query);
    searchHistory = searchHistory.slice(0, 10);
    
    localStorage.setItem('asgard_search_history', JSON.stringify(searchHistory));
  }
  
  // Очистка истории
  function clearHistory() {
    searchHistory = [];
    localStorage.removeItem('asgard_search_history');
  }
  
  // Поиск
  async function search(query, type = 'all') {
    if (!query || query.length < 2) return [];
    
    const results = [];
    const q = query.toLowerCase().trim();
    
    const searchInType = async (typeKey) => {
      const config = SEARCH_TYPES[typeKey];
      if (!config.table) return;
      
      try {
        const items = await AsgardDB.all(config.table) || [];
        
        for (const item of items) {
          const searchText = config.fields.map(f => String(item[f] || '')).join(' ').toLowerCase();
          
          if (searchText.includes(q)) {
            results.push({
              type: typeKey,
              icon: config.icon,
              id: item[config.keyField || 'id'] || item.id,
              title: item[config.fields[0]] || item.name || item.id,
              subtitle: config.fields.slice(1).map(f => item[f]).filter(Boolean).join(' · '),
              item: item
            });
          }
        }
      } catch (e) {
        console.error(`Search error in ${typeKey}:`, e);
      }
    };
    
    if (type === 'all') {
      for (const key of Object.keys(SEARCH_TYPES)) {
        if (key !== 'all') await searchInType(key);
      }
    } else {
      await searchInType(type);
    }
    
    return results.slice(0, 50); // Лимит результатов
  }
  
  // Переход к результату
  function navigateToResult(result) {
    const routes = {
      tender: '#/tenders?id=',
      work: '#/pm-works?id=',
      customer: '#/customer?inn=',
      employee: '#/employee?id=',
      invoice: '#/invoices?id=',
      act: '#/acts?id=',
      task: '#/tasks?id=',
      contract: '#/contracts?id=',
      correspondence: '#/correspondence?id=',
      estimate: '#/all-estimates?id=',
      equipment: '#/warehouse?id='
    };

    const route = routes[result.type];
    if (route) {
      location.hash = route + result.id;
    }

    closeSearchModal();
  }
  
  // Рендер результатов
  function renderResults(results, query) {
    if (!query || query.length < 2) {
      // Показываем историю
      if (searchHistory.length > 0) {
        return `
          <div class="search-section">
            <div class="search-section-title">
              <span>🕐 История поиска</span>
              <button class="btn mini ghost" id="clearHistory">Очистить</button>
            </div>
            ${searchHistory.map(h => `
              <div class="search-result-item" data-history="${esc(h)}">
                <span class="search-result-icon">🔍</span>
                <span class="search-result-title">${esc(h)}</span>
              </div>
            `).join('')}
          </div>
        `;
      }
      // Quick navigation
      return `
        <div class="search-section">
          <div class="search-section-title">⚡ Быстрый доступ</div>
          ${NAV_GROUPS_FOR_SEARCH.map(g => `
            <div class="search-result-item" data-route="${g.route}">
              <span class="search-result-icon">${g.icon}</span>
              <div class="search-result-content">
                <div class="search-result-title">${g.label}</div>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }
    
    if (results.length === 0) {
      return `<div class="search-empty">По запросу "${esc(query)}" ничего не найдено</div>`;
    }
    
    // Группируем по типу
    const grouped = {};
    for (const r of results) {
      if (!grouped[r.type]) grouped[r.type] = [];
      grouped[r.type].push(r);
    }
    
    let html = '';
    for (const [type, items] of Object.entries(grouped)) {
      const config = SEARCH_TYPES[type];
      html += `
        <div class="search-section">
          <div class="search-section-title">${config.icon} ${config.label} (${items.length})</div>
          ${items.slice(0, 10).map(r => `
            <div class="search-result-item" data-type="${r.type}" data-id="${r.id}">
              <span class="search-result-icon">${r.icon}</span>
              <div class="search-result-content">
                <div class="search-result-title">${highlightMatch(r.title, query)}</div>
                ${r.subtitle ? `<div class="search-result-subtitle">${highlightMatch(r.subtitle, query)}</div>` : ''}
              </div>
            </div>
          `).join('')}
          ${items.length > 10 ? `<div class="search-more">+${items.length - 10} ещё</div>` : ''}
        </div>
      `;
    }
    
    return html;
  }
  
  // Подсветка совпадений
  function highlightMatch(text, query) {
    if (!text || !query) return esc(text || '');
    const escaped = esc(text);
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return escaped.replace(regex, '<mark>$1</mark>');
  }
  
  // Открыть модалку поиска
  async function openSearchModal() {
    if (isOpen) return;
    isOpen = true;
    
    await loadHistory();
    
    const typeOptions = Object.entries(SEARCH_TYPES).map(([k, v]) =>
      `<option value="${k}">${v.icon} ${v.label}</option>`
    ).join('');
    
    const overlay = document.createElement('div');
    overlay.className = 'search-overlay';
    overlay.id = 'searchOverlay';
    overlay.innerHTML = `
      <div class="search-modal">
        <div class="search-header">
          <div class="search-input-wrap">
            <span class="search-icon">🔍</span>
            <input type="text" id="searchInput" class="search-input" placeholder="Поиск по CRM..." autofocus/>
            <select id="searchType" class="search-type">${typeOptions}</select>
          </div>
          <button class="btn ghost" id="closeSearch">✕</button>
        </div>
        <div class="search-results" id="searchResults">
          ${renderResults([], '')}
        </div>
        <div class="search-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> навигация</span>
          <span><kbd>Enter</kbd> открыть</span>
          <span><kbd>Esc</kbd> закрыть</span>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    const input = $('#searchInput');
    const resultsEl = $('#searchResults');
    let currentResults = [];
    let selectedIndex = -1;
    let debounceTimer;
    
    async function doSearch() {
      const query = input.value.trim();
      const type = $('#searchType')?.value || 'all';
      
      currentResults = await search(query, type);
      resultsEl.innerHTML = renderResults(currentResults, query);
      selectedIndex = -1;
      
      bindResultEvents();
    }
    
    function bindResultEvents() {
      $$('.search-result-item').forEach((item, idx) => {
        item.addEventListener('click', () => {
          if (item.dataset.route) {
            location.hash = item.dataset.route.replace('#','');
            closeSearchModal();
          } else if (item.dataset.history) {
            input.value = item.dataset.history;
            doSearch();
          } else {
            const result = currentResults.find(r => r.type === item.dataset.type && String(r.id) === item.dataset.id);
            if (result) {
              saveToHistory(input.value);
              navigateToResult(result);
            }
          }
        });
        
        item.addEventListener('mouseenter', () => {
          $$('.search-result-item').forEach(i => i.classList.remove('selected'));
          item.classList.add('selected');
          selectedIndex = idx;
        });
      });
      
      $('#clearHistory')?.addEventListener('click', (e) => {
        e.stopPropagation();
        clearHistory();
        resultsEl.innerHTML = renderResults([], '');
      });
    }
    
    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(doSearch, 200);
    });
    
    $('#searchType').addEventListener('change', doSearch);
    
    input.addEventListener('keydown', (e) => {
      const items = $$('.search-result-item');
      
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
        items.forEach((i, idx) => i.classList.toggle('selected', idx === selectedIndex));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, 0);
        items.forEach((i, idx) => i.classList.toggle('selected', idx === selectedIndex));
      } else if (e.key === 'Enter' && selectedIndex >= 0) {
        e.preventDefault();
        items[selectedIndex]?.click();
      } else if (e.key === 'Escape') {
        closeSearchModal();
      }
    });
    
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) AsgardUI.oopsBubble(e.clientX, e.clientY);
    });
    
    $('#closeSearch').addEventListener('click', closeSearchModal);
    
    bindResultEvents();
    input.focus();
  }
  
  // Закрыть модалку
  function closeSearchModal() {
    const overlay = $('#searchOverlay');
    if (overlay) {
      overlay.remove();
    }
    isOpen = false;
  }
  
  // Глобальный хоткей Ctrl+K
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      if (isOpen) {
        closeSearchModal();
      } else {
        openSearchModal();
      }
    }
    
    if (e.key === 'Escape' && isOpen) {
      closeSearchModal();
    }
  });
  
  // CSS is now in app.css (Command Palette section)

  return {
    open: openSearchModal,
    openSearchModal,
    closeSearchModal,
    search,
    saveToHistory,
    clearHistory,
    SEARCH_TYPES
  };
})();
