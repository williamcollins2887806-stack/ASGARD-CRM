/**
 * ASGARD CRM — CrField v1.0
 * Библиотека WOW-компонентов для модалок
 * Каждый метод возвращает DOM-элемент
 */
window.CrField = (function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════
  // 1. PERSON PICKER — карточка сотрудника с аватаром
  // ═══════════════════════════════════════════════════════════════
  function personPicker(cfg) {
    // cfg: { name, role, avatar?, initials?, color?, onChange? }
    const wrap = document.createElement('div');
    wrap.className = 'cr-f-person';

    const av = document.createElement('div');
    av.className = 'cr-f-person__av';
    if (cfg.color) av.style.background = cfg.color;
    if (cfg.avatar) {
      const img = document.createElement('img');
      img.src = cfg.avatar;
      img.className = 'cr-f-person__av-img';
      av.appendChild(img);
    } else {
      av.textContent = cfg.initials || _initials(cfg.name);
    }
    wrap.appendChild(av);

    const info = document.createElement('div');
    info.className = 'cr-f-person__info';
    const nameEl = document.createElement('div');
    nameEl.className = 'cr-f-person__name';
    nameEl.textContent = cfg.name || '—';
    info.appendChild(nameEl);
    if (cfg.role) {
      const roleEl = document.createElement('div');
      roleEl.className = 'cr-f-person__role';
      roleEl.textContent = cfg.role;
      info.appendChild(roleEl);
    }
    wrap.appendChild(info);

    const changeBtn = document.createElement('div');
    changeBtn.className = 'cr-f-person__change';
    changeBtn.textContent = 'Изменить';
    wrap.appendChild(changeBtn);

    if (typeof cfg.onChange === 'function') {
      wrap.addEventListener('click', cfg.onChange);
    }

    // Public API
    wrap._crUpdate = function (newCfg) {
      nameEl.textContent = newCfg.name || '—';
      if (newCfg.role) {
        let r = info.querySelector('.cr-f-person__role');
        if (!r) { r = document.createElement('div'); r.className = 'cr-f-person__role'; info.appendChild(r); }
        r.textContent = newCfg.role;
      }
      if (newCfg.avatar) {
        av.textContent = '';
        let img = av.querySelector('img');
        if (!img) { img = document.createElement('img'); img.className = 'cr-f-person__av-img'; av.appendChild(img); }
        img.src = newCfg.avatar;
      } else {
        av.textContent = newCfg.initials || _initials(newCfg.name);
        const img = av.querySelector('img');
        if (img) img.remove();
      }
      if (newCfg.color) av.style.background = newCfg.color;
    };

    return wrap;
  }

  function _initials(name) {
    if (!name) return '?';
    return name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  }

  // ═══════════════════════════════════════════════════════════════
  // 2. CHIPS — кликабельные теги
  // ═══════════════════════════════════════════════════════════════
  function chips(cfg) {
    // cfg: { options: [{value, label}], selected: value|[values], multi?: bool, onChange? }
    const wrap = document.createElement('div');
    wrap.className = 'cr-f-chips';
    const multi = !!cfg.multi;
    let selected = multi
      ? new Set(Array.isArray(cfg.selected) ? cfg.selected : (cfg.selected != null ? [cfg.selected] : []))
      : (cfg.selected != null ? cfg.selected : null);

    function render() {
      wrap.replaceChildren();
      (cfg.options || []).forEach(opt => {
        const chip = document.createElement('span');
        chip.className = 'cr-f-chip';
        chip.textContent = opt.label || opt.value;
        chip.dataset.value = opt.value;

        const isActive = multi ? selected.has(opt.value) : selected === opt.value;
        if (isActive) chip.classList.add('cr-f-chip--active');

        chip.addEventListener('click', () => {
          if (multi) {
            if (selected.has(opt.value)) selected.delete(opt.value); else selected.add(opt.value);
          } else {
            selected = opt.value;
          }
          render();
          if (typeof cfg.onChange === 'function') {
            cfg.onChange(multi ? Array.from(selected) : selected);
          }
        });
        wrap.appendChild(chip);
      });
    }
    render();

    wrap._crGetValue = () => multi ? Array.from(selected) : selected;
    wrap._crSetValue = (v) => {
      selected = multi ? new Set(Array.isArray(v) ? v : [v]) : v;
      render();
    };
    return wrap;
  }

  // ═══════════════════════════════════════════════════════════════
  // 3. TOGGLE GROUP — переключатель с подсветкой
  // ═══════════════════════════════════════════════════════════════
  function toggleGroup(cfg) {
    // cfg: { options: [{value, label}], selected: value, color?: 'green'|'gold'|'blue'|'red'|'orange', onChange? }
    const wrap = document.createElement('div');
    wrap.className = 'cr-f-toggle';
    if (cfg.color) wrap.dataset.color = cfg.color;
    let selected = cfg.selected != null ? cfg.selected : (cfg.options[0] && cfg.options[0].value);

    function render() {
      wrap.replaceChildren();
      (cfg.options || []).forEach(opt => {
        const btn = document.createElement('button');
        btn.className = 'cr-f-toggle__btn';
        btn.type = 'button';
        btn.textContent = opt.label || opt.value;
        btn.dataset.value = opt.value;
        if (opt.value === selected) btn.classList.add('cr-f-toggle__btn--active');

        btn.addEventListener('click', () => {
          selected = opt.value;
          render();
          if (typeof cfg.onChange === 'function') cfg.onChange(selected);
        });
        wrap.appendChild(btn);
      });
    }
    render();

    wrap._crGetValue = () => selected;
    wrap._crSetValue = (v) => { selected = v; render(); };
    return wrap;
  }

  // ═══════════════════════════════════════════════════════════════
  // 4. SEARCH INPUT — инпут с иконкой, live-dropdown
  // ═══════════════════════════════════════════════════════════════
  function searchInput(cfg) {
    // cfg: { placeholder?, onSearch: async (q) => [{label, sublabel, icon?, avatar?}], onSelect?, value?, hint? }
    const wrap = document.createElement('div');
    wrap.className = 'cr-f-search';

    // Search icon
    const icon = document.createElement('div');
    icon.className = 'cr-f-search__icon';
    icon.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
    wrap.appendChild(icon);

    const input = document.createElement('input');
    input.className = 'cr-f-search__input';
    input.type = 'text';
    input.placeholder = cfg.placeholder || 'Поиск...';
    if (cfg.value) input.value = cfg.value;
    wrap.appendChild(input);

    if (cfg.hint) {
      const hint = document.createElement('div');
      hint.className = 'cr-f-search__hint';
      hint.textContent = cfg.hint;
      wrap.appendChild(hint);
    }

    // Dropdown
    const dd = document.createElement('div');
    dd.className = 'cr-f-search__dropdown';
    wrap.appendChild(dd);

    let timer;
    let isOpen = false;

    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const q = input.value.trim();
        if (q.length < 2) { _closeDD(); return; }
        if (typeof cfg.onSearch !== 'function') return;
        try {
          const results = await cfg.onSearch(q);
          _renderDD(results, q);
        } catch (e) {
          _closeDD();
        }
      }, 250);
    });

    input.addEventListener('focus', () => {
      if (dd.childElementCount > 0) _openDD();
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) _closeDD();
    }, true);

    function _renderDD(results, q) {
      dd.replaceChildren();
      if (!results || !results.length) {
        const empty = document.createElement('div');
        empty.className = 'cr-f-search__empty';
        empty.textContent = 'Ничего не найдено';
        dd.appendChild(empty);
        _openDD();
        return;
      }
      results.slice(0, 8).forEach(r => {
        const item = document.createElement('div');
        item.className = 'cr-f-search__item';

        if (r.avatar || r.icon) {
          const av = document.createElement('div');
          av.className = 'cr-f-search__item-icon';
          if (r.avatar) {
            const img = document.createElement('img');
            img.src = r.avatar;
            av.appendChild(img);
          } else {
            av.textContent = r.icon;
          }
          item.appendChild(av);
        }

        const content = document.createElement('div');
        content.className = 'cr-f-search__item-content';
        const label = document.createElement('div');
        label.className = 'cr-f-search__item-label';
        label.innerHTML = _highlight(r.label || '', q);
        content.appendChild(label);
        if (r.sublabel) {
          const sub = document.createElement('div');
          sub.className = 'cr-f-search__item-sub';
          sub.textContent = r.sublabel;
          content.appendChild(sub);
        }
        item.appendChild(content);

        item.addEventListener('click', () => {
          input.value = r.label || '';
          _closeDD();
          if (typeof cfg.onSelect === 'function') cfg.onSelect(r);
        });
        dd.appendChild(item);
      });
      _openDD();
    }

    function _openDD() { isOpen = true; dd.classList.add('cr-f-search__dropdown--open'); }
    function _closeDD() { isOpen = false; dd.classList.remove('cr-f-search__dropdown--open'); }

    function _highlight(text, q) {
      if (!q) return _esc(text);
      const escaped = _esc(text);
      const rx = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
      return escaped.replace(rx, '<mark>$1</mark>');
    }

    function _esc(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

    wrap._crGetValue = () => input.value;
    wrap._crSetValue = (v) => { input.value = v || ''; };
    wrap._crInput = input;
    return wrap;
  }

  // ═══════════════════════════════════════════════════════════════
  // 5. STEPPER — навигация по шагам с прогресс-баром
  // ═══════════════════════════════════════════════════════════════
  function stepper(cfg) {
    // cfg: { steps: [{label, id}], current: 0, color?: string (css gradient), onChange? }
    const wrap = document.createElement('div');
    wrap.className = 'cr-f-stepper';
    let current = cfg.current || 0;
    const steps = cfg.steps || [];
    const color = cfg.color || 'linear-gradient(90deg, var(--gold), var(--gold-l))';

    // Progress bar
    const bar = document.createElement('div');
    bar.className = 'cr-f-stepper__bar';
    const fill = document.createElement('div');
    fill.className = 'cr-f-stepper__fill';
    fill.style.background = color;
    bar.appendChild(fill);
    wrap.appendChild(bar);

    // Step dots
    const dotsWrap = document.createElement('div');
    dotsWrap.className = 'cr-f-stepper__dots';
    wrap.appendChild(dotsWrap);

    function render() {
      const pct = steps.length > 1 ? ((current + 1) / steps.length) * 100 : 100;
      fill.style.width = pct + '%';

      dotsWrap.replaceChildren();
      steps.forEach((step, i) => {
        const dot = document.createElement('div');
        dot.className = 'cr-f-stepper__step';
        if (i < current) dot.classList.add('cr-f-stepper__step--done');
        if (i === current) dot.classList.add('cr-f-stepper__step--active');

        const circle = document.createElement('div');
        circle.className = 'cr-f-stepper__circle';
        if (i < current) {
          circle.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>';
        } else {
          circle.textContent = String(i + 1);
        }
        dot.appendChild(circle);

        const label = document.createElement('div');
        label.className = 'cr-f-stepper__label';
        label.textContent = step.label;
        dot.appendChild(label);

        dot.addEventListener('click', () => {
          if (i <= current + 1) { // can go forward 1 or backward
            current = i;
            render();
            if (typeof cfg.onChange === 'function') cfg.onChange(current, step);
          }
        });

        dotsWrap.appendChild(dot);
      });
    }
    render();

    wrap._crGetStep = () => current;
    wrap._crSetStep = (n) => { current = Math.max(0, Math.min(n, steps.length - 1)); render(); };
    wrap._crNext = () => { if (current < steps.length - 1) { current++; render(); if (typeof cfg.onChange === 'function') cfg.onChange(current, steps[current]); } };
    wrap._crPrev = () => { if (current > 0) { current--; render(); if (typeof cfg.onChange === 'function') cfg.onChange(current, steps[current]); } };
    return wrap;
  }

  // ═══════════════════════════════════════════════════════════════
  // 6. DROP ZONE — drag-n-drop загрузка файлов
  // ═══════════════════════════════════════════════════════════════
  function dropZone(cfg) {
    // cfg: { accept?, maxSize?, multiple?, onUpload: (files) => void, text? }
    const wrap = document.createElement('div');
    wrap.className = 'cr-f-dropzone';

    const icon = document.createElement('div');
    icon.className = 'cr-f-dropzone__icon';
    icon.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
    wrap.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'cr-f-dropzone__text';
    label.textContent = cfg.text || 'Прикрепить фото или PDF';
    wrap.appendChild(label);

    const input = document.createElement('input');
    input.type = 'file';
    input.style.display = 'none';
    if (cfg.accept) input.accept = cfg.accept;
    if (cfg.multiple) input.multiple = true;
    wrap.appendChild(input);

    // Files list
    const list = document.createElement('div');
    list.className = 'cr-f-dropzone__list';
    wrap.parentElement && wrap.parentElement.appendChild(list);

    // Click to open file picker
    wrap.addEventListener('click', () => input.click());

    // Drag events
    wrap.addEventListener('dragover', (e) => { e.preventDefault(); wrap.classList.add('cr-f-dropzone--dragover'); });
    wrap.addEventListener('dragleave', () => wrap.classList.remove('cr-f-dropzone--dragover'));
    wrap.addEventListener('drop', (e) => {
      e.preventDefault();
      wrap.classList.remove('cr-f-dropzone--dragover');
      _handleFiles(e.dataTransfer.files);
    });

    input.addEventListener('change', () => {
      if (input.files.length) _handleFiles(input.files);
      input.value = '';
    });

    const _files = [];

    function _handleFiles(fileList) {
      const maxSize = cfg.maxSize || 50 * 1024 * 1024; // 50MB default
      for (const f of fileList) {
        if (f.size > maxSize) {
          if (window.AsgardUI) AsgardUI.toast('Ошибка', 'Файл слишком большой: ' + f.name, 'err');
          continue;
        }
        _files.push(f);
        _renderFile(f);
      }
      if (typeof cfg.onUpload === 'function') cfg.onUpload([..._files]);
    }

    function _renderFile(f) {
      // Ensure list is in DOM
      if (!list.parentElement) {
        wrap.parentElement ? wrap.parentElement.appendChild(list) : wrap.appendChild(list);
      }

      const card = document.createElement('div');
      card.className = 'cr-f-dropzone__file';

      const ext = (f.name.split('.').pop() || '').toUpperCase();
      const typeIcon = document.createElement('div');
      typeIcon.className = 'cr-f-dropzone__file-icon';
      typeIcon.textContent = ext.slice(0, 4);
      card.appendChild(typeIcon);

      const name = document.createElement('div');
      name.className = 'cr-f-dropzone__file-name';
      name.textContent = f.name;
      card.appendChild(name);

      const size = document.createElement('div');
      size.className = 'cr-f-dropzone__file-size';
      size.textContent = _formatSize(f.size);
      card.appendChild(size);

      const del = document.createElement('button');
      del.className = 'cr-f-dropzone__file-del';
      del.type = 'button';
      del.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = _files.indexOf(f);
        if (idx >= 0) _files.splice(idx, 1);
        card.remove();
        if (typeof cfg.onUpload === 'function') cfg.onUpload([..._files]);
      });
      card.appendChild(del);

      list.appendChild(card);
    }

    function _formatSize(bytes) {
      if (bytes < 1024) return bytes + ' Б';
      if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' КБ';
      return (bytes / 1048576).toFixed(1) + ' МБ';
    }

    wrap._crGetFiles = () => [..._files];
    wrap._crClear = () => { _files.length = 0; list.replaceChildren(); };
    wrap._crList = list;
    return wrap;
  }

  // ═══════════════════════════════════════════════════════════════
  // 7. SECTION LABEL — заголовок секции с иконкой
  // ═══════════════════════════════════════════════════════════════
  function sectionLabel(cfg) {
    // cfg: { icon?: string (svg html), label: string, color?: string }
    const wrap = document.createElement('div');
    wrap.className = 'cr-f-section';
    if (cfg.icon) {
      const iconWrap = document.createElement('span');
      iconWrap.className = 'cr-f-section__icon';
      iconWrap.innerHTML = cfg.icon;
      if (cfg.color) iconWrap.style.color = cfg.color;
      wrap.appendChild(iconWrap);
    }
    const text = document.createElement('span');
    text.textContent = cfg.label || '';
    wrap.appendChild(text);
    return wrap;
  }

  // ═══════════════════════════════════════════════════════════════
  // 8. LABEL — красивый лейбл с опциональной звёздочкой
  // ═══════════════════════════════════════════════════════════════
  function label(text, required) {
    const el = document.createElement('div');
    el.className = 'cr-f-label';
    el.textContent = text;
    if (required) {
      const star = document.createElement('span');
      star.className = 'cr-f-label__req';
      star.textContent = ' *';
      el.appendChild(star);
    }
    return el;
  }

  // ═══════════════════════════════════════════════════════════════
  // 9. GRID ROW — formrow с grid 2-col
  // ═══════════════════════════════════════════════════════════════
  function row(children, opts) {
    // opts: { cols?: 2, fullWidth?: bool, gap?: string }
    const el = document.createElement('div');
    el.className = 'cr-f-row';
    if (opts && opts.cols === 2) el.classList.add('cr-f-row--2');
    if (opts && opts.fullWidth) el.style.gridColumn = '1 / -1';
    (children || []).forEach(c => {
      if (typeof c === 'string') { el.innerHTML += c; }
      else if (c instanceof HTMLElement) el.appendChild(c);
    });
    return el;
  }

  // ═══════════════════════════════════════════════════════════════
  // 10. FIELD WRAP — поле = label + input
  // ═══════════════════════════════════════════════════════════════
  function field(labelText, inputEl, opts) {
    // opts: { required?, help?, fullWidth? }
    const wrap = document.createElement('div');
    wrap.className = 'cr-f-field';
    if (opts && opts.fullWidth) wrap.style.gridColumn = '1 / -1';

    wrap.appendChild(label(labelText, opts && opts.required));

    if (typeof inputEl === 'string') {
      const tmp = document.createElement('div');
      tmp.innerHTML = inputEl;
      while (tmp.firstChild) wrap.appendChild(tmp.firstChild);
    } else if (inputEl instanceof HTMLElement) {
      wrap.appendChild(inputEl);
    }

    if (opts && opts.help) {
      const help = document.createElement('div');
      help.className = 'cr-f-help';
      help.textContent = opts.help;
      wrap.appendChild(help);
    }
    return wrap;
  }

  return { personPicker, chips, toggleGroup, searchInput, stepper, dropZone, sectionLabel, label, row, field };
})();
