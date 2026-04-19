/**
 * CRSelect — Unified dropdown select for ASGARD CRM
 * 
 * Usage:
 *   const el = CRSelect.create({
 *     id: 'tender-status',
 *     options: [
 *       { value: 'new', label: 'Новый' },
 *       { value: 'active', label: 'Активный' },
 *       { group: 'Архив', items: [
 *         { value: 'closed', label: 'Закрыт' },
 *         { value: 'cancelled', label: 'Отменён' },
 *       ]},
 *     ],
 *     value: 'new',
 *     placeholder: 'Выберите статус',
 *     searchable: null,        // null = auto (7+ options), true/false = force
 *     clearable: false,
 *     required: false,
 *     disabled: false,
 *     fullWidth: false,
 *     dropdownClass: '',       // extra class on dropdown (for z-index overrides)
 *     onChange: (value, option) => {}
 *   });
 *   document.querySelector('.container').appendChild(el);
 * 
 *   CRSelect.setValue('tender-status', 'active');
 *   CRSelect.getValue('tender-status');        // 'active'
 *   CRSelect.getLabel('tender-status');         // 'Активный'
 *   CRSelect.setOptions('tender-status', [...]);
 *   CRSelect.destroy('tender-status');
 * 
 * Keyboard: ArrowDown/Up to navigate, Enter to select, Escape to close, type to search
 */

const CRSelect = (() => {
  // ── Registry ──────────────────────────────────────────────
  const _instances = new Map();

  // ── SVGs ──────────────────────────────────────────────────
  const ARROW_SVG = `<svg class="cr-select__arrow" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`;
  const CLEAR_SVG = `<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`;
  const CHECK_SVG = `<svg class="cr-select__check" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M6.5 12.5l-4-4 1.4-1.4 2.6 2.6 5.6-5.6 1.4 1.4z"/></svg>`;

  // ── Global click-outside (single listener) ────────────────
  let _globalListenerAttached = false;

  function _attachGlobalListener() {
    if (_globalListenerAttached) return;
    _globalListenerAttached = true;

    document.addEventListener('mousedown', (e) => {
      _instances.forEach((inst) => {
        if (inst.isOpen && inst.root && !inst.root.contains(e.target)) {
          _close(inst);
        }
      });
    });
  }

  // ── Helpers ───────────────────────────────────────────────
  function _flatOptions(options) {
    const flat = [];
    for (const opt of options) {
      if (opt.group && Array.isArray(opt.items)) {
        for (const item of opt.items) {
          flat.push({ ...item, _group: opt.group });
        }
      } else {
        flat.push(opt);
      }
    }
    return flat;
  }

  function _shouldSearch(options, searchable) {
    if (searchable === true) return true;
    if (searchable === false) return false;
    return _flatOptions(options).length >= 7;
  }

  // ── Open / Close ──────────────────────────────────────────
  function _open(inst) {
    if (inst.disabled || inst.isOpen) return;
    inst.isOpen = true;
    inst.focusedIdx = -1;
    inst.root.classList.add('cr-select--open');

    // Auto-detect dropup
    const rect = inst.root.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < 260 && rect.top > spaceBelow) {
      inst.root.classList.add('cr-select--dropup');
    } else {
      inst.root.classList.remove('cr-select--dropup');
    }

    // Focus search if visible
    if (inst.searchInput) {
      inst.searchInput.value = '';
      _filterOptions(inst, '');
      setTimeout(() => inst.searchInput.focus(), 0);
    }

    // Scroll selected into view
    const selectedEl = inst.optionsList.querySelector('.cr-select__option--selected');
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest' });
    }
  }

  function _close(inst) {
    if (!inst.isOpen) return;
    inst.isOpen = false;
    inst.root.classList.remove('cr-select--open', 'cr-select--dropup');
    inst.focusedIdx = -1;
    _clearFocus(inst);
  }

  function _toggle(inst) {
    inst.isOpen ? _close(inst) : _open(inst);
  }

  // ── Rendering ─────────────────────────────────────────────
  function _renderOptions(inst, filterText) {
    const frag = document.createDocumentFragment();
    const query = (filterText || '').toLowerCase().trim();
    let visibleCount = 0;
    let currentGroup = null;

    for (const opt of inst.options) {
      if (opt.group && Array.isArray(opt.items)) {
        let groupHasVisible = false;
        const groupFrag = document.createDocumentFragment();

        const groupLabel = document.createElement('div');
        groupLabel.className = 'cr-select__group-label';
        groupLabel.textContent = opt.group;

        for (const item of opt.items) {
          if (query && !item.label.toLowerCase().includes(query)) continue;
          groupHasVisible = true;
          groupFrag.appendChild(_createOptionEl(inst, item));
          visibleCount++;
        }

        if (groupHasVisible) {
          frag.appendChild(groupLabel);
          frag.appendChild(groupFrag);
        }
      } else {
        if (query && !opt.label.toLowerCase().includes(query)) continue;
        frag.appendChild(_createOptionEl(inst, opt));
        visibleCount++;
      }
    }

    inst.optionsList.innerHTML = '';

    if (visibleCount === 0) {
      const empty = document.createElement('div');
      empty.className = 'cr-select__empty';
      empty.textContent = query ? 'Ничего не найдено' : 'Нет вариантов';
      inst.optionsList.appendChild(empty);
    } else {
      inst.optionsList.appendChild(frag);
    }

    inst._visibleOptions = Array.from(inst.optionsList.querySelectorAll('.cr-select__option'));
  }

  function _createOptionEl(inst, opt) {
    const el = document.createElement('div');
    el.className = 'cr-select__option';
    el.dataset.value = opt.value;
    el.textContent = opt.label;
    el.setAttribute('role', 'option');

    if (opt.disabled) {
      el.classList.add('cr-select__option--disabled');
      el.setAttribute('aria-disabled', 'true');
    }

    if (String(opt.value) === String(inst.value)) {
      el.classList.add('cr-select__option--selected');
      el.setAttribute('aria-selected', 'true');
    }

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (opt.disabled) return;
      _selectValue(inst, opt.value);
      _close(inst);
    });

    return el;
  }

  function _updateTrigger(inst) {
    const flat = _flatOptions(inst.options);
    const selected = flat.find(o => String(o.value) === String(inst.value));

    inst.valueEl.textContent = selected ? selected.label : '';
    inst.valueEl.className = selected ? 'cr-select__value' : 'cr-select__value cr-select__placeholder';
    if (!selected) {
      inst.valueEl.textContent = inst.placeholder;
    }

    // Clear button visibility
    if (inst.clearBtn) {
      inst.clearBtn.style.display = (inst.clearable && inst.value !== '' && inst.value != null) ? 'flex' : 'none';
    }

    // Required validation
    if (inst.required) {
      const valid = inst.value !== '' && inst.value != null;
      inst.root.classList.toggle('cr-select--invalid', !valid);
    }
  }

  // ── Selection ─────────────────────────────────────────────
  function _selectValue(inst, value) {
    const prev = inst.value;
    inst.value = value;
    _updateTrigger(inst);

    // Update selected styling
    inst.optionsList.querySelectorAll('.cr-select__option').forEach(el => {
      const isSelected = String(el.dataset.value) === String(value);
      el.classList.toggle('cr-select__option--selected', isSelected);
      el.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    });

    if (String(prev) !== String(value) && inst.onChange) {
      const flat = _flatOptions(inst.options);
      const opt = flat.find(o => String(o.value) === String(value));
      inst.onChange(value, opt || null);
    }
  }

  // ── Filter ────────────────────────────────────────────────
  function _filterOptions(inst, text) {
    _renderOptions(inst, text);
    inst.focusedIdx = -1;
    _clearFocus(inst);
  }

  // ── Keyboard ──────────────────────────────────────────────
  function _clearFocus(inst) {
    inst.optionsList.querySelectorAll('.cr-select__option--focused').forEach(el => {
      el.classList.remove('cr-select__option--focused');
    });
  }

  function _setFocus(inst, idx) {
    _clearFocus(inst);
    const opts = inst._visibleOptions || [];
    if (idx < 0 || idx >= opts.length) return;
    inst.focusedIdx = idx;
    opts[idx].classList.add('cr-select__option--focused');
    opts[idx].scrollIntoView({ block: 'nearest' });
  }

  function _handleKeydown(inst, e) {
    const opts = inst._visibleOptions || [];

    if (!inst.isOpen) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        _open(inst);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        _setFocus(inst, Math.min(inst.focusedIdx + 1, opts.length - 1));
        break;

      case 'ArrowUp':
        e.preventDefault();
        _setFocus(inst, Math.max(inst.focusedIdx - 1, 0));
        break;

      case 'Enter':
        e.preventDefault();
        if (inst.focusedIdx >= 0 && opts[inst.focusedIdx]) {
          const val = opts[inst.focusedIdx].dataset.value;
          if (!opts[inst.focusedIdx].classList.contains('cr-select__option--disabled')) {
            _selectValue(inst, val);
            _close(inst);
            inst.trigger.focus();
          }
        }
        break;

      case 'Escape':
        e.preventDefault();
        _close(inst);
        inst.trigger.focus();
        break;

      case 'Tab':
        _close(inst);
        break;
    }
  }

  // ── Build DOM ─────────────────────────────────────────────
  function _build(inst) {
    const root = document.createElement('div');
    root.className = 'cr-select';
    root.id = `cr-select-${inst.id}`;
    if (inst.fullWidth) root.classList.add('cr-select--fullwidth');
    if (inst.disabled) root.classList.add('cr-select--disabled');
    root.setAttribute('role', 'combobox');
    root.setAttribute('aria-expanded', 'false');
    root.setAttribute('aria-haspopup', 'listbox');

    // Trigger
    const trigger = document.createElement('div');
    trigger.className = 'cr-select__trigger';
    trigger.tabIndex = inst.disabled ? -1 : 0;

    const valueEl = document.createElement('span');
    valueEl.className = 'cr-select__value';

    trigger.appendChild(valueEl);

    // Clear button
    let clearBtn = null;
    if (inst.clearable) {
      clearBtn = document.createElement('div');
      clearBtn.className = 'cr-select__clear';
      clearBtn.innerHTML = CLEAR_SVG;
      clearBtn.title = 'Очистить';
      clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        _selectValue(inst, '');
        _close(inst);
      });
      trigger.appendChild(clearBtn);
    }

    // Arrow
    const arrowWrap = document.createElement('span');
    arrowWrap.innerHTML = ARROW_SVG;
    trigger.appendChild(arrowWrap);

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      _toggle(inst);
    });

    root.appendChild(trigger);

    // Dropdown
    const dropdown = document.createElement('div');
    dropdown.className = 'cr-select__dropdown';
    if (inst.dropdownClass) dropdown.classList.add(inst.dropdownClass);
    dropdown.setAttribute('role', 'listbox');

    // Search
    let searchInput = null;
    if (_shouldSearch(inst.options, inst.searchable)) {
      const searchWrap = document.createElement('div');
      searchWrap.className = 'cr-select__search';
      searchInput = document.createElement('input');
      searchInput.className = 'cr-select__search-input';
      searchInput.type = 'text';
      searchInput.placeholder = 'Поиск...';
      searchInput.autocomplete = 'off';
      searchInput.addEventListener('input', () => {
        _filterOptions(inst, searchInput.value);
      });
      searchInput.addEventListener('keydown', (e) => _handleKeydown(inst, e));
      searchWrap.appendChild(searchInput);
      dropdown.appendChild(searchWrap);
    }

    // Options container
    const optionsList = document.createElement('div');
    optionsList.className = 'cr-select__options';
    dropdown.appendChild(optionsList);

    root.appendChild(dropdown);

    // Keyboard on trigger
    trigger.addEventListener('keydown', (e) => _handleKeydown(inst, e));

    // Store refs
    inst.root = root;
    inst.trigger = trigger;
    inst.valueEl = valueEl;
    inst.clearBtn = clearBtn;
    inst.dropdown = dropdown;
    inst.searchInput = searchInput;
    inst.optionsList = optionsList;
    inst._visibleOptions = [];
    inst.isOpen = false;
    inst.focusedIdx = -1;

    // Initial render
    _renderOptions(inst, '');
    _updateTrigger(inst);

    return root;
  }

  // ── Public API ────────────────────────────────────────────
  return {
    /**
     * Create a new CRSelect instance
     */
    create(config) {
      const id = config.id;
      if (!id) throw new Error('CRSelect: id is required');
      if (_instances.has(id)) this.destroy(id);

      _attachGlobalListener();

      const inst = {
        id,
        options: config.options || [],
        value: config.value ?? '',
        placeholder: config.placeholder || 'Выберите...',
        searchable: config.searchable ?? null,
        clearable: config.clearable ?? false,
        required: config.required ?? false,
        disabled: config.disabled ?? false,
        fullWidth: config.fullWidth ?? false,
        dropdownClass: config.dropdownClass || '',
        onChange: config.onChange || null,
      };

      const root = _build(inst);
      _instances.set(id, inst);
      return root;
    },

    /**
     * Create CRSelect from an existing <select> element (migration helper)
     * Reads options, value, disabled, required from the DOM element.
     */
    fromNative(selectEl, config = {}) {
      const id = config.id || selectEl.id || `auto-${Date.now()}`;
      const options = [];
      for (const child of selectEl.children) {
        if (child.tagName === 'OPTGROUP') {
          const group = { group: child.label, items: [] };
          for (const opt of child.children) {
            group.items.push({
              value: opt.value,
              label: opt.textContent,
              disabled: opt.disabled,
            });
          }
          options.push(group);
        } else if (child.tagName === 'OPTION') {
          // Skip placeholder options (empty value, first position)
          if (child.value === '' && child === selectEl.children[0]) {
            config.placeholder = config.placeholder || child.textContent;
            continue;
          }
          options.push({
            value: child.value,
            label: child.textContent,
            disabled: child.disabled,
          });
        }
      }

      const el = this.create({
        id,
        options,
        value: selectEl.value,
        placeholder: config.placeholder || 'Выберите...',
        searchable: config.searchable ?? null,
        clearable: config.clearable ?? false,
        required: selectEl.required,
        disabled: selectEl.disabled,
        fullWidth: config.fullWidth ?? false,
        dropdownClass: config.dropdownClass || '',
        onChange: config.onChange || null,
      });

      return el;
    },

    setValue(id, value) {
      const inst = _instances.get(id);
      if (!inst) return;
      _selectValue(inst, value);
    },

    getValue(id) {
      const inst = _instances.get(id);
      return inst ? inst.value : undefined;
    },

    getLabel(id) {
      const inst = _instances.get(id);
      if (!inst) return undefined;
      const flat = _flatOptions(inst.options);
      const opt = flat.find(o => String(o.value) === String(inst.value));
      return opt ? opt.label : '';
    },

    setOptions(id, options) {
      const inst = _instances.get(id);
      if (!inst) return;
      inst.options = options;

      // Rebuild search visibility if auto
      if (inst.searchable === null) {
        const needsSearch = _shouldSearch(options, null);
        if (needsSearch && !inst.searchInput) {
          // Add search
          const searchWrap = document.createElement('div');
          searchWrap.className = 'cr-select__search';
          const input = document.createElement('input');
          input.className = 'cr-select__search-input';
          input.type = 'text';
          input.placeholder = 'Поиск...';
          input.autocomplete = 'off';
          input.addEventListener('input', () => _filterOptions(inst, input.value));
          input.addEventListener('keydown', (e) => _handleKeydown(inst, e));
          searchWrap.appendChild(input);
          inst.dropdown.insertBefore(searchWrap, inst.optionsList);
          inst.searchInput = input;
        } else if (!needsSearch && inst.searchInput) {
          // Remove search
          inst.searchInput.parentElement.remove();
          inst.searchInput = null;
        }
      }

      _renderOptions(inst, inst.searchInput ? inst.searchInput.value : '');
      _updateTrigger(inst);
    },

    setDisabled(id, disabled) {
      const inst = _instances.get(id);
      if (!inst) return;
      inst.disabled = disabled;
      inst.root.classList.toggle('cr-select--disabled', disabled);
      inst.trigger.tabIndex = disabled ? -1 : 0;
      if (disabled) _close(inst);
    },

    destroy(id) {
      const inst = _instances.get(id);
      if (!inst) return;
      if (inst.root && inst.root.parentNode) {
        inst.root.parentNode.removeChild(inst.root);
      }
      _instances.delete(id);
    },

    /** Get all active instance IDs */
    getAll() {
      return Array.from(_instances.keys());
    },
  };
})();

// Export for modules if available
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CRSelect;
}
