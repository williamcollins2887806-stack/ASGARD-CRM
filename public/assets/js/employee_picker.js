/**
 * AsgardEmployeePicker — универсальный компонент выбора сотрудников
 * Чистый API без авто-детекции. Каждый файл вызывает явно.
 *
 * API:
 *   pickOne({selected, title, filter}) → Promise<{id, fio, role_tag}|null>
 *   pickMany({selected, title, filter}) → Promise<number[]|null>
 *   renderButton(id, opts) → вставляет кнопку-пикер в DOM-элемент
 */
window.AsgardEmployeePicker = (function(){
  const { esc, showModal, closeModal } = AsgardUI;

  let _cache = null, _cacheTime = 0;
  const CACHE_TTL = 30000;

  async function getEmployees() {
    if (_cache && (Date.now() - _cacheTime) < CACHE_TTL) return _cache;
    try { _cache = await AsgardDB.all("employees"); } catch(e) { _cache = []; }
    _cacheTime = Date.now();
    return _cache || [];
  }

  function avatarColor(name) {
    let h = 0;
    for (let i = 0; i < (name||'').length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
    return `hsl(${Math.abs(h) % 360}, 55%, 45%)`;
  }

  function initials(fio) {
    const parts = (fio||'').trim().split(/\s+/);
    return parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : (fio||'?')[0].toUpperCase();
  }

  // ─── CSS ───────────────────────────────────────────────
  const CSS = `
    .ep-search-row{display:flex;gap:8px;margin-bottom:12px}
    .ep-search-row input,.ep-search-row select{padding:8px 12px;border-radius:8px;border:1px solid var(--line);background:var(--glass);color:var(--text);font-size:14px}
    .ep-search-row input{flex:1}
    .ep-search-row select{min-width:140px}
    .ep-list{max-height:400px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;padding:4px 0}
    .ep-item{display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:12px;border:1px solid transparent;transition:all .15s;cursor:pointer}
    .ep-item:hover{background:rgba(59,130,246,.1);border-color:var(--info)}
    .ep-selected{background:rgba(34,197,94,.1)!important;border-color:var(--ok-t)!important}
    .ep-avatar{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:15px;flex-shrink:0;box-shadow:0 2px 8px rgba(0,0,0,.15)}
    .ep-info{flex:1;min-width:0}
    .ep-name{font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ep-meta{font-size:12px;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ep-check{color:var(--ok-t);font-size:20px;font-weight:900}
    .ep-count{font-size:12px;color:var(--muted);margin-top:8px;text-align:right}
    .ep-actions{display:flex;gap:8px;align-items:center;justify-content:space-between;margin-top:12px}
    .ep-btn{display:flex;align-items:center;gap:10px;width:100%;padding:10px 14px;border-radius:10px;border:1px solid var(--line);background:var(--glass);color:var(--text);font-size:14px;cursor:pointer;text-align:left;transition:all .2s}
    .ep-btn:hover{border-color:var(--info);background:rgba(59,130,246,.05)}
    .ep-btn .ep-mini-av{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:12px;flex-shrink:0;box-shadow:0 1px 4px rgba(0,0,0,.15)}
    .ep-btn .ep-btn-name{font-weight:600;flex:1}
    .ep-btn .ep-btn-arrow{opacity:0.4;font-size:12px;margin-left:auto}
    .ep-btn-placeholder{color:var(--muted)}
  `;
  if (!document.getElementById('ep-css')) {
    const s = document.createElement('style'); s.id = 'ep-css'; s.textContent = CSS;
    document.head.appendChild(s);
  }

  // ─── Helpers ───────────────────────────────────────────
  function filterList(list, search, role) {
    const s = (search||'').toLowerCase();
    return list.filter(e => {
      if (s && !(e.fio||'').toLowerCase().includes(s) && !(e.phone||'').includes(s) && !(e.role_tag||'').toLowerCase().includes(s) && !(e.city||'').toLowerCase().includes(s)) return false;
      if (role && e.role_tag !== role) return false;
      return true;
    });
  }

  function buildItem(e, isSelected) {
    const bg = avatarColor(e.fio);
    const ini = initials(e.fio);
    return `<div class="ep-item${isSelected?' ep-selected':''}" data-id="${e.id}">
      <div class="ep-avatar" style="background:${bg}">${ini}</div>
      <div class="ep-info">
        <div class="ep-name">${esc(e.fio||'')}</div>
        <div class="ep-meta">${esc(e.role_tag||'')}${e.grade?' \u00b7 р.'+esc(e.grade):''}${e.city?' \u00b7 '+esc(e.city):''}${e.phone?' \u00b7 '+esc(e.phone):''}</div>
      </div>
      ${isSelected?'<span class="ep-check">\u2713</span>':''}
    </div>`;
  }

  // ─── pickOne ───────────────────────────────────────────
  function pickOne(opts = {}) {
    return new Promise(async (resolve) => {
      const all = await getEmployees();
      let list = (all||[]).filter(e => !e.deleted && e.is_active !== false && (e.fio||'').trim());
      if (opts.filter) list = list.filter(opts.filter);
      list.sort((a,b) => String(a.fio||'').localeCompare(String(b.fio||''), 'ru'));

      const roleTags = [...new Set(list.map(e => e.role_tag).filter(Boolean))].sort();
      const selId = opts.selected ? Number(opts.selected) : null;

      const html = `
        <div class="ep-search-row">
          <input id="ep_s" placeholder="\u041f\u043e\u0438\u0441\u043a: \u0424\u0418\u041e, \u0440\u043e\u043b\u044c, \u0433\u043e\u0440\u043e\u0434, \u0442\u0435\u043b\u0435\u0444\u043e\u043d..." autofocus/>
          <select id="ep_r"><option value="">\u0412\u0441\u0435 \u0440\u043e\u043b\u0438</option>${roleTags.map(r=>`<option value="${esc(r)}">${esc(r)}</option>`).join('')}</select>
        </div>
        <div class="ep-list" id="ep_l">${list.map(e=>buildItem(e, e.id===selId)).join('')}</div>
        <div class="ep-count" id="ep_c">${list.length} \u0441\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a\u043e\u0432</div>
      `;

      let resolved = false;
      showModal({title: opts.title || '\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0441\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a\u0430', html, wide: false, onClose: () => { if(!resolved) resolve(null); }, onMount: () => {
        const sEl = document.getElementById('ep_s');
        const rEl = document.getElementById('ep_r');
        const lEl = document.getElementById('ep_l');
        const cEl = document.getElementById('ep_c');

        function refresh() {
          const f = filterList(list, sEl.value, rEl.value);
          lEl.innerHTML = f.map(e=>buildItem(e, e.id===selId)).join('') || '<div style="padding:24px;text-align:center;color:var(--muted)">\u041d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u043e</div>';
          cEl.textContent = f.length + ' \u0438\u0437 ' + list.length;
          bind();
        }
        function bind() {
          lEl.querySelectorAll('.ep-item').forEach(el => {
            el.onclick = () => {
              const id = Number(el.dataset.id);
              const emp = list.find(e => e.id === id);
              resolved = true;
              closeModal();
              resolve(emp ? {id:emp.id, fio:emp.fio, role_tag:emp.role_tag, city:emp.city, phone:emp.phone} : null);
            };
          });
        }
        let t;
        sEl.oninput = () => { clearTimeout(t); t = setTimeout(refresh, 150); };
        rEl.onchange = refresh;
        bind();
      }});
    });
  }

  // ─── pickMany ──────────────────────────────────────────
  function pickMany(opts = {}) {
    return new Promise(async (resolve) => {
      const all = await getEmployees();
      let list = (all||[]).filter(e => !e.deleted && e.is_active !== false && (e.fio||'').trim());
      if (opts.filter) list = list.filter(opts.filter);
      list.sort((a,b) => String(a.fio||'').localeCompare(String(b.fio||''), 'ru'));

      const roleTags = [...new Set(list.map(e => e.role_tag).filter(Boolean))].sort();
      const selected = new Set((opts.selected||[]).map(Number));

      function buildList(search, role) {
        const f = filterList(list, search, role);
        return f.map(e => buildItem(e, selected.has(e.id))).join('') || '<div style="padding:24px;text-align:center;color:var(--muted)">\u041d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u043e</div>';
      }

      const html = `
        <div class="ep-search-row">
          <input id="ep_s" placeholder="\u041f\u043e\u0438\u0441\u043a..." autofocus/>
          <select id="ep_r"><option value="">\u0412\u0441\u0435 \u0440\u043e\u043b\u0438</option>${roleTags.map(r=>`<option value="${esc(r)}">${esc(r)}</option>`).join('')}</select>
        </div>
        <div class="ep-list" id="ep_l">${buildList('','')}</div>
        <div class="ep-actions">
          <div class="ep-count" id="ep_c">\u0412\u044b\u0431\u0440\u0430\u043d\u043e: ${selected.size}</div>
          <div style="display:flex;gap:8px">
            <button class="btn ghost mini" id="ep_sa">\u0412\u0441\u0435</button>
            <button class="btn ghost mini" id="ep_da">\u0421\u0431\u0440\u043e\u0441</button>
            <button class="btn" id="ep_ok">\u041f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044c (${selected.size})</button>
          </div>
        </div>
      `;

      let resolved = false;
      showModal({title: opts.title || '\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0441\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a\u043e\u0432', html, wide: true, onClose: () => { if(!resolved) resolve(null); }, onMount: () => {
        const sEl = document.getElementById('ep_s');
        const rEl = document.getElementById('ep_r');
        const lEl = document.getElementById('ep_l');
        const cEl = document.getElementById('ep_c');
        const okBtn = document.getElementById('ep_ok');

        function refresh() {
          lEl.innerHTML = buildList(sEl.value, rEl.value);
          cEl.textContent = '\u0412\u044b\u0431\u0440\u0430\u043d\u043e: ' + selected.size;
          okBtn.textContent = '\u041f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044c (' + selected.size + ')';
          bind();
        }
        function bind() {
          lEl.querySelectorAll('.ep-item').forEach(el => {
            el.onclick = () => {
              const id = Number(el.dataset.id);
              if (selected.has(id)) selected.delete(id); else selected.add(id);
              el.classList.toggle('ep-selected', selected.has(id));
              const chk = el.querySelector('.ep-check');
              if (selected.has(id) && !chk) el.insertAdjacentHTML('beforeend','<span class="ep-check">\u2713</span>');
              else if (!selected.has(id) && chk) chk.remove();
              cEl.textContent = '\u0412\u044b\u0431\u0440\u0430\u043d\u043e: ' + selected.size;
              okBtn.textContent = '\u041f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044c (' + selected.size + ')';
            };
          });
        }
        let t;
        sEl.oninput = () => { clearTimeout(t); t = setTimeout(refresh, 150); };
        rEl.onchange = refresh;
        document.getElementById('ep_sa').onclick = () => { filterList(list,sEl.value,rEl.value).forEach(e=>selected.add(e.id)); refresh(); };
        document.getElementById('ep_da').onclick = () => { selected.clear(); refresh(); };
        okBtn.onclick = () => { resolved = true; closeModal(); resolve([...selected]); };
        bind();
      }});
    });
  }

  // ─── renderButton ──────────────────────────────────────
  /**
   * Вставляет кнопку-пикер в указанный контейнер
   * @param {string|HTMLElement} container - ID элемента или DOM-узел
   * @param {Object} opts
   * @param {number|null} opts.value - текущий ID
   * @param {string} opts.name - текущее ФИО (если известно)
   * @param {string} opts.placeholder - текст-заглушка
   * @param {Function} opts.onChange - callback({id, fio, ...}) при выборе
   * @param {Function} opts.filter - фильтр сотрудников
   * @param {string} opts.title - заголовок модалки
   * @param {boolean} opts.allowClear - показать кнопку очистки
   */
  function renderButton(container, opts = {}) {
    const el = typeof container === 'string' ? document.getElementById(container) : container;
    if (!el) return;

    let currentValue = opts.value || null;
    let currentName = opts.name || '';

    function render() {
      if (currentValue && currentName) {
        const bg = avatarColor(currentName);
        const ini = initials(currentName);
        el.innerHTML = `<button type="button" class="ep-btn" data-ep-trigger>
          <span class="ep-mini-av" style="background:${bg}">${ini}</span>
          <span class="ep-btn-name">${esc(currentName)}</span>
          ${opts.allowClear ? '<span class="ep-btn-clear" data-ep-clear title="\u041e\u0447\u0438\u0441\u0442\u0438\u0442\u044c" style="cursor:pointer;padding:4px;opacity:0.5">\u2715</span>' : ''}
          <span class="ep-btn-arrow">\u25be</span>
        </button>`;
      } else {
        el.innerHTML = `<button type="button" class="ep-btn" data-ep-trigger>
          <span class="ep-btn-placeholder">${esc(opts.placeholder || '\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0441\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a\u0430...')}</span>
          <span class="ep-btn-arrow">\u25be</span>
        </button>`;
      }

      el.querySelector('[data-ep-trigger]').onclick = async () => {
        const result = await pickOne({
          selected: currentValue,
          filter: opts.filter,
          title: opts.title
        });
        if (result) {
          currentValue = result.id;
          currentName = result.fio;
          render();
          if (opts.onChange) opts.onChange(result);
        }
      };

      const clearBtn = el.querySelector('[data-ep-clear]');
      if (clearBtn) {
        clearBtn.onclick = (ev) => {
          ev.stopPropagation();
          currentValue = null;
          currentName = '';
          render();
          if (opts.onChange) opts.onChange(null);
        };
      }
    }

    render();

    // Expose getter
    Object.defineProperty(el, 'pickerValue', {
      get: () => currentValue,
      set: (v) => { currentValue = v; render(); },
      configurable: true
    });

    return { getValue: () => currentValue, setValue: (id, name) => { currentValue = id; currentName = name; render(); } };
  }

  return { pickOne, pickMany, renderButton, invalidateCache: () => { _cache = null; _cacheTime = 0; } };
})();
