/**
 * CRDatePicker — Кастомный DatePicker для ASGARD CRM
 * Отображение: ДД.ММ.ГГГГ | Хранение: YYYY-MM-DD
 * Стиль: cr-datepicker namespace, CSS-переменные из design-tokens
 */
window.CRDatePicker = (function() {
  'use strict';

  const _instances = new Map();
  const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const DAYS = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

  function toISO(value) {
    if (!value) return '';
    const s = String(value).trim();
    // DD.MM.YYYY
    const ru = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (ru) {
      const dd = ru[1].padStart(2, '0'), mm = ru[2].padStart(2, '0');
      return `${ru[3]}-${mm}-${dd}`;
    }
    // YYYY-MM-DD
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    // ISO timestamp
    const ts = s.match(/^(\d{4})-(\d{2})-(\d{2})T/);
    if (ts) return `${ts[1]}-${ts[2]}-${ts[3]}`;
    return '';
  }

  function toDisplay(iso) {
    if (!iso) return '';
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
  }

  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function daysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
  }

  function firstDayOfWeek(year, month) {
    const d = new Date(year, month, 1).getDay();
    return d === 0 ? 6 : d - 1; // Monday = 0
  }

  function buildCalendarGrid(year, month, selected, today) {
    const days = daysInMonth(year, month);
    const startDay = firstDayOfWeek(year, month);
    const prevDays = daysInMonth(year, month - 1);

    let html = '<div class="cr-dp__grid">';
    // Day headers
    for (const d of DAYS) html += `<div class="cr-dp__day-hdr">${d}</div>`;

    // Previous month trailing days
    for (let i = startDay - 1; i >= 0; i--) {
      html += `<div class="cr-dp__day cr-dp__day--other">${prevDays - i}</div>`;
    }

    // Current month
    for (let d = 1; d <= days; d++) {
      const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const cls = ['cr-dp__day'];
      if (iso === selected) cls.push('cr-dp__day--sel');
      if (iso === today) cls.push('cr-dp__day--today');
      html += `<div class="${cls.join(' ')}" data-date="${iso}">${d}</div>`;
    }

    // Next month leading days
    const totalCells = startDay + days;
    const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let d = 1; d <= remaining; d++) {
      html += `<div class="cr-dp__day cr-dp__day--other">${d}</div>`;
    }

    html += '</div>';
    return html;
  }

  function create(config) {
    const { id, value, placeholder, disabled, onChange, dropdownClass, clearable } = config || {};
    if (!id) throw new Error('CRDatePicker: id is required');
    if (_instances.has(id)) destroy(id);

    const wrap = document.createElement('div');
    wrap.className = 'cr-datepicker' + (disabled ? ' cr-datepicker--disabled' : '');
    wrap.dataset.crDpId = id;

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'cr-datepicker__trigger';

    const labelEl = document.createElement('span');
    labelEl.className = 'cr-datepicker__label';

    const iconEl = document.createElement('span');
    iconEl.className = 'cr-datepicker__icon';
    iconEl.innerHTML = '&#x1F4C5;';

    trigger.append(labelEl, iconEl);
    wrap.appendChild(trigger);

    const state = {
      value: toISO(value || ''),
      viewYear: 0,
      viewMonth: 0,
      isOpen: false,
      dropdown: null
    };

    const now = new Date();
    if (state.value) {
      const [y, m] = state.value.split('-').map(Number);
      state.viewYear = y;
      state.viewMonth = m - 1;
    } else {
      state.viewYear = now.getFullYear();
      state.viewMonth = now.getMonth();
    }

    function updateLabel() {
      if (state.value) {
        labelEl.textContent = toDisplay(state.value);
        labelEl.classList.remove('cr-datepicker__placeholder');
      } else {
        labelEl.textContent = placeholder || 'Выберите дату';
        labelEl.classList.add('cr-datepicker__placeholder');
      }
    }
    updateLabel();

    function renderDropdown() {
      const dd = state.dropdown;
      if (!dd) return;
      const today = todayISO();
      dd.innerHTML = `
        <div class="cr-dp__header">
          <button type="button" class="cr-dp__nav" data-dir="-1">&#x276E;</button>
          <span class="cr-dp__title">${MONTHS[state.viewMonth]} ${state.viewYear}</span>
          <button type="button" class="cr-dp__nav" data-dir="1">&#x276F;</button>
        </div>
        ${buildCalendarGrid(state.viewYear, state.viewMonth, state.value, today)}
        <div class="cr-dp__footer">
          <button type="button" class="cr-dp__today-btn">Сегодня</button>
          ${clearable && state.value ? '<button type="button" class="cr-dp__clear-btn">Очистить</button>' : ''}
        </div>
      `;

      // Navigation
      dd.querySelectorAll('.cr-dp__nav').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const dir = Number(btn.dataset.dir);
          state.viewMonth += dir;
          if (state.viewMonth > 11) { state.viewMonth = 0; state.viewYear++; }
          if (state.viewMonth < 0) { state.viewMonth = 11; state.viewYear--; }
          renderDropdown();
        });
      });

      // Day click
      dd.querySelectorAll('.cr-dp__day[data-date]').forEach(cell => {
        cell.addEventListener('click', (e) => {
          e.stopPropagation();
          state.value = cell.dataset.date;
          updateLabel();
          closeDropdown();
          if (onChange) onChange(state.value);
        });
      });

      // Today button
      const todayBtn = dd.querySelector('.cr-dp__today-btn');
      if (todayBtn) {
        todayBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const t = todayISO();
          state.value = t;
          const [y, m] = t.split('-').map(Number);
          state.viewYear = y;
          state.viewMonth = m - 1;
          updateLabel();
          closeDropdown();
          if (onChange) onChange(state.value);
        });
      }

      // Clear button
      const clearBtn = dd.querySelector('.cr-dp__clear-btn');
      if (clearBtn) {
        clearBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          state.value = '';
          updateLabel();
          closeDropdown();
          if (onChange) onChange('');
        });
      }
    }

    function openDropdown() {
      if (state.isOpen || disabled) return;
      state.isOpen = true;
      wrap.classList.add('cr-datepicker--open');

      const dd = document.createElement('div');
      dd.className = 'cr-datepicker__dropdown' + (dropdownClass ? ' ' + dropdownClass : '');
      state.dropdown = dd;

      wrap.appendChild(dd);
      renderDropdown();

      // Check if dropup needed
      requestAnimationFrame(() => {
        const rect = dd.getBoundingClientRect();
        if (rect.bottom > window.innerHeight - 8) {
          dd.classList.add('cr-datepicker__dropdown--up');
        }
      });
    }

    function closeDropdown() {
      if (!state.isOpen) return;
      state.isOpen = false;
      wrap.classList.remove('cr-datepicker--open');
      if (state.dropdown) {
        state.dropdown.remove();
        state.dropdown = null;
      }
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (disabled) return;
      if (state.isOpen) closeDropdown(); else openDropdown();
    });

    _instances.set(id, { wrap, state, updateLabel, closeDropdown, openDropdown, config });
    return wrap;
  }

  function getValue(id) {
    const inst = _instances.get(id);
    return inst ? inst.state.value : '';
  }

  function setValue(id, value) {
    const inst = _instances.get(id);
    if (!inst) return;
    inst.state.value = toISO(value || '');
    if (inst.state.value) {
      const [y, m] = inst.state.value.split('-').map(Number);
      inst.state.viewYear = y;
      inst.state.viewMonth = m - 1;
    }
    inst.updateLabel();
  }

  function setDisabled(id, disabled) {
    const inst = _instances.get(id);
    if (!inst) return;
    inst.config.disabled = disabled;
    if (disabled) {
      inst.wrap.classList.add('cr-datepicker--disabled');
      inst.closeDropdown();
    } else {
      inst.wrap.classList.remove('cr-datepicker--disabled');
    }
  }

  function destroy(id) {
    const inst = _instances.get(id);
    if (!inst) return;
    inst.closeDropdown();
    inst.wrap.remove();
    _instances.delete(id);
  }

  // Global click-outside listener
  document.addEventListener('mousedown', (e) => {
    _instances.forEach((inst) => {
      if (inst.state.isOpen && !inst.wrap.contains(e.target)) {
        inst.closeDropdown();
      }
    });
  });

  // Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      _instances.forEach((inst) => {
        if (inst.state.isOpen) inst.closeDropdown();
      });
    }
  });

  return { create, getValue, setValue, setDisabled, destroy, toISO, toDisplay };
})();
