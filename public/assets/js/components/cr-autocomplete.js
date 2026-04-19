/**
 * CRAutocomplete — Unified autocomplete/typeahead for ASGARD CRM
 *
 * Replaces: native <datalist>, inline DaData dropdowns, custom suggest panels
 *
 * Usage:
 *   const el = CRAutocomplete.create({
 *     id: 'city-search',
 *     placeholder: 'Москва, Сургут...',
 *     minChars: 2,
 *     debounce: 300,
 *     fetchOptions: async (query) => [
 *       { value: 'msk', label: 'Москва', sublabel: '0 км' },
 *     ],
 *     onSelect: (item) => { console.log(item); },
 *     renderItem: (item) => `<b>${item.label}</b>`,   // optional custom HTML
 *     clearable: true,
 *     fullWidth: false,
 *     dropdownClass: '',       // extra class for z-index overrides
 *     inputClass: '',          // extra class on the <input>
 *     disabled: false,
 *     value: '',               // initial text value
 *   });
 *   document.querySelector('.wrap').appendChild(el);
 *
 *   CRAutocomplete.setValue('city-search', 'Москва');
 *   CRAutocomplete.getValue('city-search');
 *   CRAutocomplete.focus('city-search');
 *   CRAutocomplete.destroy('city-search');
 */

const CRAutocomplete = (() => {
  const _instances = new Map();

  // SVGs
  const CLEAR_SVG = `<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`;
  const SPINNER_SVG = `<svg class="cr-ac__spinner-icon" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="28" stroke-dashoffset="8" stroke-linecap="round"/></svg>`;

  // Global click-outside
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

  // ── Open / Close ────────────────────────────────────────
  function _open(inst) {
    if (inst.disabled || inst.isOpen) return;
    inst.isOpen = true;
    inst.root.classList.add('cr-ac--open');

    // Auto-detect dropup
    const rect = inst.root.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < 260 && rect.top > spaceBelow) {
      inst.root.classList.add('cr-ac--dropup');
    } else {
      inst.root.classList.remove('cr-ac--dropup');
    }
  }

  function _close(inst) {
    if (!inst.isOpen) return;
    inst.isOpen = false;
    inst.focusedIdx = -1;
    inst.root.classList.remove('cr-ac--open', 'cr-ac--dropup');
    _clearFocus(inst);
  }

  // ── Rendering ───────────────────────────────────────────
  function _renderItems(inst, items) {
    inst._items = items || [];
    inst.optionsList.innerHTML = '';

    if (inst._loading) {
      const spin = document.createElement('div');
      spin.className = 'cr-ac__loading';
      spin.innerHTML = SPINNER_SVG + ' Поиск\u2026';
      inst.optionsList.appendChild(spin);
      _open(inst);
      return;
    }

    if (!items || items.length === 0) {
      if (inst.input.value.trim().length >= inst.minChars) {
        const empty = document.createElement('div');
        empty.className = 'cr-ac__empty';
        empty.textContent = 'Ничего не найдено';
        inst.optionsList.appendChild(empty);
        _open(inst);
      } else {
        _close(inst);
      }
      return;
    }

    const frag = document.createDocumentFragment();
    items.forEach((item, i) => {
      const el = document.createElement('div');
      el.className = 'cr-ac__option';
      el.dataset.idx = i;
      el.setAttribute('role', 'option');

      if (inst.renderItem) {
        el.innerHTML = inst.renderItem(item);
      } else {
        const nameDiv = document.createElement('div');
        nameDiv.className = 'cr-ac__option-label';
        nameDiv.textContent = item.label || item.value || '';
        el.appendChild(nameDiv);

        if (item.sublabel) {
          const sub = document.createElement('div');
          sub.className = 'cr-ac__option-sublabel';
          sub.textContent = item.sublabel;
          el.appendChild(sub);
        }
      }

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        _selectItem(inst, i);
      });

      frag.appendChild(el);
    });

    inst.optionsList.appendChild(frag);
    inst._visibleOptions = Array.from(inst.optionsList.querySelectorAll('.cr-ac__option'));
    inst.focusedIdx = -1;
    _open(inst);
  }

  // ── Selection ───────────────────────────────────────────
  function _selectItem(inst, idx) {
    const item = inst._items[idx];
    if (!item) return;

    inst.input.value = item.label || item.value || '';
    inst._selectedItem = item;
    _updateClear(inst);
    _close(inst);

    if (inst.onSelect) {
      inst.onSelect(item);
    }
  }

  function _updateClear(inst) {
    if (inst.clearBtn) {
      inst.clearBtn.style.display = (inst.clearable && inst.input.value) ? 'flex' : 'none';
    }
  }

  // ── Keyboard navigation ─────────────────────────────────
  function _clearFocus(inst) {
    if (inst.optionsList) {
      inst.optionsList.querySelectorAll('.cr-ac__option--focused').forEach(el => {
        el.classList.remove('cr-ac__option--focused');
      });
    }
  }

  function _setFocus(inst, idx) {
    _clearFocus(inst);
    const opts = inst._visibleOptions || [];
    if (idx < 0 || idx >= opts.length) return;
    inst.focusedIdx = idx;
    opts[idx].classList.add('cr-ac__option--focused');
    opts[idx].scrollIntoView({ block: 'nearest' });
  }

  function _handleKeydown(inst, e) {
    const opts = inst._visibleOptions || [];

    if (!inst.isOpen) {
      if (e.key === 'ArrowDown' && opts.length > 0) {
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
          _selectItem(inst, parseInt(opts[inst.focusedIdx].dataset.idx));
        }
        break;

      case 'Escape':
        e.preventDefault();
        _close(inst);
        break;

      case 'Tab':
        _close(inst);
        break;
    }
  }

  // ── Debounced fetch ─────────────────────────────────────
  function _triggerFetch(inst) {
    clearTimeout(inst._timer);
    const query = inst.input.value.trim();

    if (query.length < inst.minChars) {
      inst._loading = false;
      _close(inst);
      return;
    }

    // Show spinner
    inst._loading = true;
    _renderItems(inst, []);

    inst._timer = setTimeout(async () => {
      try {
        const items = await inst.fetchOptions(query);
        // Only render if input hasn't changed
        if (inst.input.value.trim() === query) {
          inst._loading = false;
          _renderItems(inst, items || []);
        }
      } catch (err) {
        inst._loading = false;
        _renderItems(inst, []);
      }
    }, inst.debounce);
  }

  // ── Build DOM ───────────────────────────────────────────
  function _build(inst) {
    const root = document.createElement('div');
    root.className = 'cr-ac';
    root.id = `cr-ac-${inst.id}`;
    if (inst.fullWidth) root.classList.add('cr-ac--fullwidth');
    if (inst.disabled) root.classList.add('cr-ac--disabled');
    root.setAttribute('role', 'combobox');
    root.setAttribute('aria-expanded', 'false');
    root.setAttribute('aria-haspopup', 'listbox');

    // Input wrapper
    const inputWrap = document.createElement('div');
    inputWrap.className = 'cr-ac__input-wrap';

    const input = document.createElement('input');
    input.className = 'cr-ac__input';
    if (inst.inputClass) input.classList.add(inst.inputClass);
    input.type = 'text';
    input.placeholder = inst.placeholder;
    input.autocomplete = 'off';
    input.value = inst.value || '';
    if (inst.disabled) input.disabled = true;

    input.addEventListener('input', () => {
      inst._selectedItem = null;
      _updateClear(inst);
      _triggerFetch(inst);
    });

    input.addEventListener('keydown', (e) => _handleKeydown(inst, e));

    input.addEventListener('focus', () => {
      // Reopen if there are results and text matches
      if (inst._items && inst._items.length > 0 && inst.input.value.trim().length >= inst.minChars) {
        _open(inst);
      }
    });

    inputWrap.appendChild(input);

    // Clear button
    let clearBtn = null;
    if (inst.clearable) {
      clearBtn = document.createElement('div');
      clearBtn.className = 'cr-ac__clear';
      clearBtn.innerHTML = CLEAR_SVG;
      clearBtn.title = 'Очистить';
      clearBtn.style.display = 'none';
      clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        input.value = '';
        inst._selectedItem = null;
        inst._items = [];
        _updateClear(inst);
        _close(inst);
        input.focus();
        if (inst.onSelect) inst.onSelect(null);
      });
      inputWrap.appendChild(clearBtn);
    }

    root.appendChild(inputWrap);

    // Dropdown
    const dropdown = document.createElement('div');
    dropdown.className = 'cr-ac__dropdown';
    if (inst.dropdownClass) dropdown.classList.add(inst.dropdownClass);
    dropdown.setAttribute('role', 'listbox');

    const optionsList = document.createElement('div');
    optionsList.className = 'cr-ac__options';
    dropdown.appendChild(optionsList);

    root.appendChild(dropdown);

    // Store refs
    inst.root = root;
    inst.input = input;
    inst.clearBtn = clearBtn;
    inst.dropdown = dropdown;
    inst.optionsList = optionsList;
    inst._visibleOptions = [];
    inst._items = [];
    inst._selectedItem = null;
    inst.isOpen = false;
    inst.focusedIdx = -1;
    inst._timer = null;
    inst._loading = false;

    _updateClear(inst);

    return root;
  }

  // ── Public API ──────────────────────────────────────────
  return {
    create(config) {
      const id = config.id;
      if (!id) throw new Error('CRAutocomplete: id is required');
      if (!config.fetchOptions) throw new Error('CRAutocomplete: fetchOptions is required');
      if (_instances.has(id)) this.destroy(id);

      _attachGlobalListener();

      const inst = {
        id,
        placeholder: config.placeholder || 'Начните вводить...',
        minChars: config.minChars ?? 2,
        debounce: config.debounce ?? 300,
        fetchOptions: config.fetchOptions,
        onSelect: config.onSelect || null,
        renderItem: config.renderItem || null,
        clearable: config.clearable ?? true,
        fullWidth: config.fullWidth ?? false,
        disabled: config.disabled ?? false,
        dropdownClass: config.dropdownClass || '',
        inputClass: config.inputClass || '',
        value: config.value || '',
      };

      const root = _build(inst);
      _instances.set(id, inst);
      return root;
    },

    setValue(id, value) {
      const inst = _instances.get(id);
      if (!inst) return;
      inst.input.value = value || '';
      inst._selectedItem = null;
      _updateClear(inst);
    },

    getValue(id) {
      const inst = _instances.get(id);
      return inst ? inst.input.value : undefined;
    },

    getSelectedItem(id) {
      const inst = _instances.get(id);
      return inst ? inst._selectedItem : null;
    },

    getInput(id) {
      const inst = _instances.get(id);
      return inst ? inst.input : null;
    },

    focus(id) {
      const inst = _instances.get(id);
      if (inst && inst.input) inst.input.focus();
    },

    setDisabled(id, disabled) {
      const inst = _instances.get(id);
      if (!inst) return;
      inst.disabled = disabled;
      inst.input.disabled = disabled;
      inst.root.classList.toggle('cr-ac--disabled', disabled);
      if (disabled) _close(inst);
    },

    destroy(id) {
      const inst = _instances.get(id);
      if (!inst) return;
      clearTimeout(inst._timer);
      if (inst.root && inst.root.parentNode) {
        inst.root.parentNode.removeChild(inst.root);
      }
      _instances.delete(id);
    },

    getAll() {
      return Array.from(_instances.keys());
    },
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CRAutocomplete;
}
