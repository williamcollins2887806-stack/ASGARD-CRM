/**
 * CREmployeePicker — Unified employee selection for ASGARD CRM
 * 
 * Usage (multi-select):
 *   const el = CREmployeePicker.create({
 *     id: 'brigade-members',
 *     employees: [
 *       { id: 1, name: 'Иванов И.И.', position: 'Инженер', role: 'TO', avatar: '/avatars/1.jpg' },
 *       { id: 2, name: 'Петров П.П.', position: 'Слесарь', role: 'TO', avatar: null },
 *     ],
 *     selected: [1],
 *     maxSelect: 0,           // 0 = unlimited
 *     placeholder: 'Выберите сотрудников',
 *     showChips: true,        // show chips in trigger (false = just counter)
 *     maxChips: 3,            // max chips before "+N more"
 *     title: 'Бригада',       // modal title
 *     onChange: (selectedIds) => {}
 *   });
 * 
 * Usage (single-select, pickOne mode):
 *   const el = CREmployeePicker.create({
 *     id: 'responsible-pm',
 *     employees: [...],
 *     maxSelect: 1,           // single select mode
 *     onChange: (selectedIds) => {}
 *   });
 * 
 *   CREmployeePicker.getSelected('brigade-members');   // [1, 2]
 *   CREmployeePicker.setSelected('brigade-members', [1, 3]);
 *   CREmployeePicker.clear('brigade-members');
 *   CREmployeePicker.setEmployees('brigade-members', [...]);
 *   CREmployeePicker.destroy('brigade-members');
 */

const CREmployeePicker = (() => {
  const _instances = new Map();

  // ── SVGs ──────────────────────────────────────────────────
  const CHECK_SVG = `<svg class="cr-emp-picker__checkbox-icon" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M6.5 12.5l-4-4 1.4-1.4 2.6 2.6 5.6-5.6 1.4 1.4z" fill="currentColor"/></svg>`;
  const CLOSE_SVG = `<svg width="14" height="14" viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  const REMOVE_SVG = `<svg width="8" height="8" viewBox="0 0 8 8" xmlns="http://www.w3.org/2000/svg"><path d="M1.5 1.5l5 5M6.5 1.5l-5 5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`;

  // ── Employee cache ────────────────────────────────────────
  let _employeeCache = null;
  let _cacheTime = 0;
  const CACHE_TTL = 30000; // 30 seconds

  async function _fetchEmployees() {
    const now = Date.now();
    if (_employeeCache && (now - _cacheTime) < CACHE_TTL) {
      return _employeeCache;
    }
    try {
      const res = await fetch('/api/employees?active=true');
      if (res.ok) {
        const data = await res.json();
        _employeeCache = (data.rows || data || []).map(e => ({
          id: e.id,
          name: e.full_name || e.name || `${e.last_name || ''} ${e.first_name || ''}`.trim(),
          position: e.position || e.role_display || '',
          role: e.role || '',
          avatar: e.avatar || null,
        }));
        _cacheTime = now;
        return _employeeCache;
      }
    } catch (err) {
      console.warn('CREmployeePicker: failed to fetch employees', err);
    }
    return _employeeCache || [];
  }

  // ── Helpers ───────────────────────────────────────────────
  function _getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name[0].toUpperCase();
  }

  function _getRoles(employees) {
    const roles = new Set();
    employees.forEach(e => { if (e.role) roles.add(e.role); });
    return Array.from(roles).sort();
  }

  function _filterEmployees(employees, query, roleFilter) {
    let filtered = employees;
    if (roleFilter) {
      filtered = filtered.filter(e => e.role === roleFilter);
    }
    if (query) {
      const q = query.toLowerCase();
      filtered = filtered.filter(e =>
        (e.name && e.name.toLowerCase().includes(q)) ||
        (e.position && e.position.toLowerCase().includes(q))
      );
    }
    return filtered;
  }

  // ── Trigger rendering ─────────────────────────────────────
  function _renderTrigger(inst) {
    const container = inst.chipsContainer;
    container.innerHTML = '';

    const selected = inst.selected;
    const emps = inst.employees;

    if (selected.length === 0) {
      const ph = document.createElement('span');
      ph.className = 'cr-emp-picker__placeholder';
      ph.textContent = inst.placeholder;
      container.appendChild(ph);
      if (inst.countEl) inst.countEl.style.display = 'none';
      return;
    }

    if (inst.showChips) {
      const show = selected.slice(0, inst.maxChips);
      for (const id of show) {
        const emp = emps.find(e => e.id === id);
        if (!emp) continue;

        const chip = document.createElement('span');
        chip.className = 'cr-emp-picker__chip';

        if (emp.avatar) {
          const img = document.createElement('img');
          img.className = 'cr-emp-picker__chip-avatar';
          img.src = emp.avatar;
          img.alt = '';
          img.loading = 'lazy';
          chip.appendChild(img);
        }

        const nameSpan = document.createElement('span');
        nameSpan.className = 'cr-emp-picker__chip-name';
        // Short name: Фамилия И.
        const parts = emp.name.split(/\s+/);
        nameSpan.textContent = parts.length >= 2
          ? `${parts[0]} ${parts[1][0]}.`
          : emp.name;
        chip.appendChild(nameSpan);

        const removeBtn = document.createElement('span');
        removeBtn.className = 'cr-emp-picker__chip-remove';
        removeBtn.innerHTML = REMOVE_SVG;
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          _toggleEmployee(inst, id);
          _renderTrigger(inst);
        });
        chip.appendChild(removeBtn);

        container.appendChild(chip);
      }

      if (selected.length > inst.maxChips) {
        const more = document.createElement('span');
        more.className = 'cr-emp-picker__chip';
        more.style.cursor = 'default';
        more.textContent = `+${selected.length - inst.maxChips}`;
        container.appendChild(more);
      }
    } else {
      const text = document.createElement('span');
      text.className = 'cr-select__value';
      text.textContent = `Выбрано: ${selected.length}`;
      container.appendChild(text);
    }

    if (inst.countEl) {
      inst.countEl.textContent = selected.length;
      inst.countEl.style.display = 'inline';
    }
  }

  // ── Modal ─────────────────────────────────────────────────
  function _openModal(inst) {
    // Temporary selection (confirm on Apply, revert on Cancel)
    inst._tempSelected = [...inst.selected];

    const overlay = document.createElement('div');
    overlay.className = 'cr-emp-picker__overlay';

    const isSingle = inst.maxSelect === 1;

    const modal = document.createElement('div');
    modal.className = 'cr-emp-picker__modal' + (isSingle ? ' cr-emp-picker--single' : '');

    // Header
    const header = document.createElement('div');
    header.className = 'cr-emp-picker__header';
    const title = document.createElement('div');
    title.className = 'cr-emp-picker__title';
    title.textContent = inst.title;
    const closeBtn = document.createElement('div');
    closeBtn.className = 'cr-emp-picker__close';
    closeBtn.innerHTML = CLOSE_SVG;
    closeBtn.addEventListener('click', () => _closeModal(inst));
    header.appendChild(title);
    header.appendChild(closeBtn);
    modal.appendChild(header);

    // Filters
    const filters = document.createElement('div');
    filters.className = 'cr-emp-picker__filters';

    const searchInput = document.createElement('input');
    searchInput.className = 'cr-emp-picker__search';
    searchInput.type = 'text';
    searchInput.placeholder = 'Поиск по имени или должности...';
    searchInput.autocomplete = 'off';
    filters.appendChild(searchInput);

    const roles = _getRoles(inst.employees);
    if (roles.length > 1) {
      const roleSelect = document.createElement('select');
      roleSelect.className = 'cr-emp-picker__role-filter';
      const allOpt = document.createElement('option');
      allOpt.value = '';
      allOpt.textContent = 'Все роли';
      roleSelect.appendChild(allOpt);
      for (const role of roles) {
        const opt = document.createElement('option');
        opt.value = role;
        opt.textContent = role;
        roleSelect.appendChild(opt);
      }
      roleSelect.addEventListener('change', () => {
        _renderModalList(inst, searchInput.value, roleSelect.value);
      });
      filters.appendChild(roleSelect);
      inst._roleSelect = roleSelect;
    }

    modal.appendChild(filters);

    // List
    const list = document.createElement('div');
    list.className = 'cr-emp-picker__list';
    modal.appendChild(list);
    inst._modalList = list;

    // Footer (multi only)
    if (!isSingle) {
      const footer = document.createElement('div');
      footer.className = 'cr-emp-picker__footer';

      const countLabel = document.createElement('div');
      countLabel.className = 'cr-emp-picker__selected-count';
      inst._modalCountLabel = countLabel;

      const actions = document.createElement('div');
      actions.className = 'cr-emp-picker__actions';

      const clearBtn = document.createElement('button');
      clearBtn.className = 'cr-emp-picker__btn cr-emp-picker__btn--secondary';
      clearBtn.textContent = 'Сбросить';
      clearBtn.addEventListener('click', () => {
        inst._tempSelected = [];
        _renderModalList(inst, searchInput.value, inst._roleSelect?.value || '');
        _updateModalCount(inst);
      });

      const applyBtn = document.createElement('button');
      applyBtn.className = 'cr-emp-picker__btn cr-emp-picker__btn--primary';
      applyBtn.textContent = 'Применить';
      applyBtn.addEventListener('click', () => {
        inst.selected = [...inst._tempSelected];
        _renderTrigger(inst);
        _closeModal(inst);
        if (inst.onChange) inst.onChange([...inst.selected]);
      });

      actions.appendChild(clearBtn);
      actions.appendChild(applyBtn);
      footer.appendChild(countLabel);
      footer.appendChild(actions);
      modal.appendChild(footer);
    }

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    inst._overlay = overlay;

    // Animate in
    requestAnimationFrame(() => {
      overlay.classList.add('cr-emp-picker__overlay--visible');
    });

    // Initial render
    _renderModalList(inst, '', '');
    _updateModalCount(inst);

    // Search handler
    searchInput.addEventListener('input', () => {
      _renderModalList(inst, searchInput.value, inst._roleSelect?.value || '');
    });

    // Close on overlay click
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) _closeModal(inst);
    });

    // Close on Escape
    inst._escHandler = (e) => {
      if (e.key === 'Escape') _closeModal(inst);
    };
    document.addEventListener('keydown', inst._escHandler);

    // Focus search
    setTimeout(() => searchInput.focus(), 50);
  }

  function _closeModal(inst) {
    if (!inst._overlay) return;
    inst._overlay.classList.remove('cr-emp-picker__overlay--visible');
    setTimeout(() => {
      if (inst._overlay && inst._overlay.parentNode) {
        inst._overlay.parentNode.removeChild(inst._overlay);
      }
      inst._overlay = null;
    }, 160);
    if (inst._escHandler) {
      document.removeEventListener('keydown', inst._escHandler);
      inst._escHandler = null;
    }
    // pickOne cancel support
    if (inst._pickOneResolve) {
      inst._pickOneResolve();
      inst._pickOneResolve = null;
    }
  }

  function _renderModalList(inst, query, roleFilter) {
    const list = inst._modalList;
    if (!list) return;
    list.innerHTML = '';

    const filtered = _filterEmployees(inst.employees, query, roleFilter);
    const isSingle = inst.maxSelect === 1;

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'cr-emp-picker__empty';
      empty.textContent = query ? 'Никого не найдено' : 'Нет сотрудников';
      list.appendChild(empty);
      return;
    }

    const frag = document.createDocumentFragment();

    for (const emp of filtered) {
      const isSelected = inst._tempSelected.includes(emp.id);

      const item = document.createElement('div');
      item.className = 'cr-emp-picker__item' + (isSelected ? ' cr-emp-picker__item--selected' : '');

      // Checkbox
      const checkbox = document.createElement('div');
      checkbox.className = 'cr-emp-picker__checkbox';
      checkbox.innerHTML = CHECK_SVG;
      item.appendChild(checkbox);

      // Avatar
      if (emp.avatar) {
        const img = document.createElement('img');
        img.className = 'cr-emp-picker__avatar';
        img.src = emp.avatar;
        img.alt = '';
        img.loading = 'lazy';
        item.appendChild(img);
      } else {
        const ph = document.createElement('div');
        ph.className = 'cr-emp-picker__avatar-placeholder';
        ph.textContent = _getInitials(emp.name);
        item.appendChild(ph);
      }

      // Info
      const info = document.createElement('div');
      info.className = 'cr-emp-picker__info';
      const name = document.createElement('div');
      name.className = 'cr-emp-picker__name';
      name.textContent = emp.name;
      const position = document.createElement('div');
      position.className = 'cr-emp-picker__position';
      position.textContent = emp.position || emp.role || '';
      info.appendChild(name);
      info.appendChild(position);
      item.appendChild(info);

      item.addEventListener('click', () => {
        if (isSingle) {
          // Single select: pick and close immediately
          inst.selected = [emp.id];
          _renderTrigger(inst);
          _closeModal(inst);
          if (inst.onChange) inst.onChange([emp.id]);
          return;
        }

        // Multi select
        _toggleTempEmployee(inst, emp.id);
        item.classList.toggle('cr-emp-picker__item--selected', inst._tempSelected.includes(emp.id));
        _updateModalCount(inst);
      });

      frag.appendChild(item);
    }

    list.appendChild(frag);
  }

  function _toggleTempEmployee(inst, empId) {
    const idx = inst._tempSelected.indexOf(empId);
    if (idx >= 0) {
      inst._tempSelected.splice(idx, 1);
    } else {
      if (inst.maxSelect > 0 && inst._tempSelected.length >= inst.maxSelect) {
        return; // Max reached
      }
      inst._tempSelected.push(empId);
    }
  }

  function _toggleEmployee(inst, empId) {
    const idx = inst.selected.indexOf(empId);
    if (idx >= 0) {
      inst.selected.splice(idx, 1);
    } else {
      if (inst.maxSelect > 0 && inst.selected.length >= inst.maxSelect) return;
      inst.selected.push(empId);
    }
    if (inst.onChange) inst.onChange([...inst.selected]);
  }

  function _updateModalCount(inst) {
    if (inst._modalCountLabel) {
      const count = inst._tempSelected.length;
      const max = inst.maxSelect > 0 ? ` / ${inst.maxSelect}` : '';
      inst._modalCountLabel.textContent = `Выбрано: ${count}${max}`;
    }
  }

  // ── Build trigger DOM ─────────────────────────────────────
  function _build(inst) {
    const root = document.createElement('div');
    root.className = 'cr-emp-picker';
    root.id = `cr-emp-picker-${inst.id}`;
    if (inst.fullWidth) root.classList.add('cr-emp-picker--fullwidth');

    const trigger = document.createElement('div');
    trigger.className = 'cr-emp-picker__trigger';

    const chipsContainer = document.createElement('div');
    chipsContainer.className = 'cr-emp-picker__chips';
    trigger.appendChild(chipsContainer);

    const countEl = document.createElement('span');
    countEl.className = 'cr-emp-picker__count';
    countEl.style.display = 'none';
    trigger.appendChild(countEl);

    trigger.addEventListener('click', () => _openModal(inst));

    root.appendChild(trigger);

    inst.root = root;
    inst.trigger = trigger;
    inst.chipsContainer = chipsContainer;
    inst.countEl = countEl;

    _renderTrigger(inst);

    return root;
  }

  // ── Public API ────────────────────────────────────────────
  return {
    create(config) {
      const id = config.id;
      if (!id) throw new Error('CREmployeePicker: id is required');
      if (_instances.has(id)) this.destroy(id);

      const inst = {
        id,
        employees: config.employees || [],
        selected: config.selected ? [...config.selected] : [],
        maxSelect: config.maxSelect ?? 0,
        placeholder: config.placeholder || 'Выберите сотрудников',
        showChips: config.showChips ?? true,
        maxChips: config.maxChips ?? 3,
        title: config.title || 'Выбор сотрудников',
        fullWidth: config.fullWidth ?? false,
        onChange: config.onChange || null,
        // Internal
        _overlay: null,
        _modalList: null,
        _modalCountLabel: null,
        _tempSelected: [],
        _escHandler: null,
        _roleSelect: null,
      };

      const root = _build(inst);
      _instances.set(id, inst);
      return root;
    },

    /**
     * Create picker that auto-fetches employees from API.
     * Usage: const el = await CREmployeePicker.createAsync({ id: '...', ... });
     */
    async createAsync(config) {
      const employees = await _fetchEmployees();
      return this.create({ ...config, employees });
    },

    getSelected(id) {
      const inst = _instances.get(id);
      return inst ? [...inst.selected] : [];
    },

    setSelected(id, ids) {
      const inst = _instances.get(id);
      if (!inst) return;
      inst.selected = [...ids];
      _renderTrigger(inst);
    },

    clear(id) {
      const inst = _instances.get(id);
      if (!inst) return;
      inst.selected = [];
      _renderTrigger(inst);
      if (inst.onChange) inst.onChange([]);
    },

    setEmployees(id, employees) {
      const inst = _instances.get(id);
      if (!inst) return;
      inst.employees = employees;
      _renderTrigger(inst);
    },

    destroy(id) {
      const inst = _instances.get(id);
      if (!inst) return;
      _closeModal(inst);
      if (inst.root && inst.root.parentNode) {
        inst.root.parentNode.removeChild(inst.root);
      }
      _instances.delete(id);
    },

    /** Invalidate employee cache (call after adding/removing employees) */
    invalidateCache() {
      _employeeCache = null;
      _cacheTime = 0;
    },

    getAll() {
      return Array.from(_instances.keys());
    },

    /**
     * Open a one-shot picker modal and return the selected employee.
     * Returns { id, name, position, role, avatar } or null if cancelled.
     * Compat bridge: also sets .fio = .name for legacy callers.
     */
    async pickOne({ filter, title, placeholder } = {}) {
      const employees = await _fetchEmployees();
      const filtered = filter ? employees.filter(filter) : employees;

      return new Promise(resolve => {
        const tempId = '__pickOne_' + Date.now();
        let resolved = false;

        const inst = {
          id: tempId,
          employees: filtered,
          selected: [],
          maxSelect: 1,
          placeholder: placeholder || 'Выберите сотрудника',
          showChips: false,
          maxChips: 0,
          title: title || 'Выберите сотрудника',
          fullWidth: false,
          onChange: (ids) => {
            if (resolved) return;
            resolved = true;
            const empId = ids[0];
            const emp = filtered.find(e => e.id === empId);
            _instances.delete(tempId);
            if (emp) emp.fio = emp.name; // compat
            resolve(emp || null);
          },
          _overlay: null,
          _modalList: null,
          _modalCountLabel: null,
          _tempSelected: [],
          _escHandler: null,
          _roleSelect: null,
          _pickOneResolve: () => {
            if (resolved) return;
            resolved = true;
            _instances.delete(tempId);
            resolve(null);
          },
          root: document.createElement('div'),
          trigger: document.createElement('div'),
          chipsContainer: document.createElement('div'),
          countEl: document.createElement('span'),
        };

        _instances.set(tempId, inst);
        _openModal(inst);
      });
    },

    /**
     * Mount a single-select picker into a container element.
     * Sets container.pickerValue on selection.
     * Compat bridge for legacy AsgardEmployeePicker.renderButton().
     */
    async renderButton(containerId, { placeholder, title, filter, onChange } = {}) {
      const container = document.getElementById(containerId);
      if (!container) return;
      const employees = await _fetchEmployees();
      const filtered = filter ? employees.filter(filter) : employees;
      const el = this.create({
        id: containerId,
        employees: filtered,
        maxSelect: 1,
        placeholder: placeholder || 'Выберите сотрудника',
        title: title || 'Выберите сотрудника',
        fullWidth: true,
        onChange: (ids) => {
          const empId = ids[0];
          container.pickerValue = empId || '';
          const emp = filtered.find(e => e.id === empId);
          if (onChange) onChange(emp || null);
        }
      });
      container.innerHTML = '';
      container.appendChild(el);
    },
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CREmployeePicker;
}
