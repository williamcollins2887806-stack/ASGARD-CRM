/**
 * АСГАРД CRM — Валидация полей
 * 
 * - Блокировка букв в числовых полях
 * - Единый формат даты: дд.мм.гггг
 * - Автоматическая инициализация
 */
window.AsgardValidate = (function(){
  
  // ============================================
  // БАЗОВЫЕ ФУНКЦИИ
  // ============================================
  
  function isBlank(v) { 
    return v === null || v === undefined || String(v).trim() === ""; 
  }
  
  function num(v) { 
    const n = Number(v); 
    return Number.isFinite(n) ? n : null; 
  }
  
  function moneyGE0(v) { 
    if (isBlank(v)) return true; 
    const n = num(v); 
    return n !== null && n >= 0; 
  }
  
  // ============================================
  // ДАТЫ — формат дд.мм.гггг
  // ============================================
  
  // Парсинг даты из дд.мм.гггг или гггг-мм-дд
  function parseDate(v) {
    if (isBlank(v)) return null;
    const s = String(v).trim();
    
    // дд.мм.гггг
    let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (m) {
      const d = new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
      return isNaN(d.getTime()) ? null : d;
    }
    
    // гггг-мм-дд (ISO)
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const d = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
      return isNaN(d.getTime()) ? null : d;
    }
    
    return null;
  }
  
  // Формат даты в дд.мм.гггг
  function formatDateRu(v) {
    const d = v instanceof Date ? v : parseDate(v);
    if (!d) return '';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}.${mm}.${yyyy}`;
  }
  
  // Формат даты в гггг-мм-дд (для БД)
  function formatDateISO(v) {
    const d = v instanceof Date ? v : parseDate(v);
    if (!d) return '';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  
  // Проверка ISO даты
  function dateISO(v) {
    if (isBlank(v)) return null;
    const s = String(v).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      // Попробуем конвертировать из дд.мм.гггг
      const d = parseDate(s);
      return d ? formatDateISO(d) : null;
    }
    const d = new Date(s + "T00:00:00");
    return isNaN(d.getTime()) ? null : s;
  }
  
  function dateOrder(start, end) {
    const a = dateISO(start), b = dateISO(end);
    if (!a || !b) return true;
    return a <= b;
  }
  
  function req(obj, fields) {
    const missing = [];
    for (const f of fields) {
      if (isBlank(obj[f])) missing.push(f);
    }
    return missing;
  }
  
  // ============================================
  // БЛОКИРОВКА ВВОДА БУКВ В ЧИСЛОВЫХ ПОЛЯХ
  // ============================================
  
  // Разрешённые клавиши для числовых полей
  const ALLOWED_KEYS = [
    'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
    'Tab', 'Enter', 'Home', 'End', 'Escape'
  ];
  
  function blockNonNumeric(e) {
    const key = e.key;
    
    // Разрешаем управляющие клавиши
    if (ALLOWED_KEYS.includes(key)) return;
    if (e.ctrlKey || e.metaKey) return; // Ctrl+C, Ctrl+V и т.д.
    
    // Разрешаем цифры
    if (/^\d$/.test(key)) return;
    
    // Разрешаем точку и запятую (для десятичных)
    if (key === '.' || key === ',') {
      // Только одна точка/запятая
      if (e.target.value.includes('.') || e.target.value.includes(',')) {
        e.preventDefault();
      }
      return;
    }
    
    // Разрешаем минус в начале
    if (key === '-' && e.target.selectionStart === 0 && !e.target.value.includes('-')) {
      return;
    }
    
    // Блокируем всё остальное
    e.preventDefault();
  }
  
  // Очистка при вставке
  function cleanPastedNumber(e) {
    setTimeout(() => {
      let v = e.target.value;
      // Убираем всё кроме цифр, точки, минуса
      v = v.replace(/[^\d.,-]/g, '');
      // Заменяем запятую на точку
      v = v.replace(',', '.');
      // Оставляем только один минус в начале
      if (v.startsWith('-')) {
        v = '-' + v.slice(1).replace(/-/g, '');
      } else {
        v = v.replace(/-/g, '');
      }
      // Оставляем только одну точку
      const parts = v.split('.');
      if (parts.length > 2) {
        v = parts[0] + '.' + parts.slice(1).join('');
      }
      e.target.value = v;
    }, 0);
  }
  
  // ============================================
  // МАСКА ДАТЫ дд.мм.гггг
  // ============================================
  
  function applyDateMask(e) {
    let v = e.target.value.replace(/\D/g, ''); // Только цифры
    
    if (v.length > 8) v = v.slice(0, 8);
    
    if (v.length >= 4) {
      v = v.slice(0, 2) + '.' + v.slice(2, 4) + '.' + v.slice(4);
    } else if (v.length >= 2) {
      v = v.slice(0, 2) + '.' + v.slice(2);
    }
    
    e.target.value = v;
  }
  
  function blockNonDateKeys(e) {
    const key = e.key;
    
    if (ALLOWED_KEYS.includes(key)) return;
    if (e.ctrlKey || e.metaKey) return;
    
    // Разрешаем только цифры и точку
    if (/^\d$/.test(key)) return;
    if (key === '.') return;
    
    e.preventDefault();
  }
  
  // ============================================
  // АВТОМАТИЧЕСКАЯ ИНИЦИАЛИЗАЦИЯ
  // ============================================
  
  function initField(input) {
    if (!input || input.dataset.validated) return;
    
    const type = input.type?.toLowerCase();
    const classList = input.className || '';
    const placeholder = (input.placeholder || '').toLowerCase();
    const name = (input.name || '').toLowerCase();
    const id = (input.id || '').toLowerCase();
    
    // Числовые поля
    if (type === 'number' || 
        classList.includes('number') || 
        classList.includes('money') ||
        name.includes('amount') || name.includes('sum') || name.includes('price') ||
        id.includes('amount') || id.includes('sum') || id.includes('price') ||
        id.includes('_km') || id.includes('_days') || id.includes('_pct')) {
      
      input.addEventListener('keydown', blockNonNumeric);
      input.addEventListener('paste', cleanPastedNumber);
      input.dataset.validated = 'number';
    }
    
    // Поля даты
    if (type === 'date' ||
        classList.includes('date') ||
        placeholder.includes('дд.мм') || placeholder.includes('дата') ||
        name.includes('date') || name.includes('_at') ||
        id.includes('date') || id.includes('_at') ||
        placeholder.includes('yyyy-mm-dd')) {
      
      // Меняем placeholder
      if (input.placeholder?.includes('YYYY-MM-DD')) {
        input.placeholder = 'дд.мм.гггг';
      }
      
      // Если type=date, не применяем маску (браузер сам)
      if (type !== 'date') {
        input.addEventListener('keydown', blockNonDateKeys);
        input.addEventListener('input', applyDateMask);
        input.placeholder = 'дд.мм.гггг';
      }
      
      input.dataset.validated = 'date';
    }
  }
  
  // Инициализация всех полей на странице
  function initAllFields(container = document) {
    const inputs = container.querySelectorAll('input');
    inputs.forEach(initField);
  }
  
  // MutationObserver для динамически добавляемых полей
  let observer = null;
  
  function startObserver() {
    if (observer) return;
    
    observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1) { // Element
            if (node.tagName === 'INPUT') {
              initField(node);
            }
            // Проверяем вложенные input
            const inputs = node.querySelectorAll?.('input');
            if (inputs) inputs.forEach(initField);
          }
        });
      });
    });
    
    observer.observe(document.body, { childList: true, subtree: true });
  }
  
  // Автозапуск
  document.addEventListener('DOMContentLoaded', () => {
    initAllFields();
    startObserver();
  });
  
  // Также запускаем при загрузке, если DOM уже готов
  if (document.readyState !== 'loading') {
    setTimeout(() => {
      initAllFields();
      startObserver();
    }, 100);
  }
  
  return { 
    isBlank, 
    num, 
    moneyGE0, 
    dateISO, 
    dateOrder, 
    req,
    parseDate,
    formatDateRu,
    formatDateISO,
    initField,
    initAllFields,
    blockNonNumeric,
    applyDateMask
  };
})();

