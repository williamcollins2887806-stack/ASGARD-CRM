window.AsgardUI = (function(){
  const $ = (s, e=document) => e.querySelector(s);
  const $$ = (s, e=document) => Array.from(e.querySelectorAll(s));
  const esc = (x) => String(x ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));

  const toastWrapId = "asgard_toasts";
  function toast(title, msg="", type="ok", timeout=4000){
    let mtxt = msg;
    if(mtxt && typeof mtxt === "object"){
      if(typeof mtxt.message === "string") mtxt = mtxt.message;
      else{ try{ mtxt = JSON.stringify(mtxt); } catch(e){ mtxt = String(mtxt); } }
    }
    if(mtxt === undefined || mtxt === null) mtxt = "";
    mtxt = String(mtxt);

    let w = document.getElementById(toastWrapId);
    if(!w){
      w = document.createElement("div");
      w.id = toastWrapId;
      w.className = "toastwrap";
      document.body.appendChild(w);
    }

    const icons = { ok: '✓', err: '✕', warn: '⚠', info: 'ℹ' };
    const icon = icons[type] || icons.ok;

    const t = document.createElement("div");
    t.className = "toast toast-" + (type === "err" ? "error" : type === "warn" ? "warning" : type === "info" ? "info" : "success");
    t.innerHTML = `
      <div class="toast-icon">${icon}</div>
      <div class="toast-content">
        <div class="toast-title">${esc(title)}</div>
        ${mtxt ? `<div class="toast-msg">${esc(mtxt)}</div>` : ''}
      </div>
      <button class="toast-close" type="button">✕</button>
      <div class="toast-progress"></div>
    `;

    // Close button
    t.querySelector('.toast-close').addEventListener('click', () => {
      t.classList.add('toast-exit');
      setTimeout(() => t.remove(), 200);
    });

    // Auto-remove
    setTimeout(() => {
      if (t.parentNode) {
        t.classList.add('toast-exit');
        setTimeout(() => t.remove(), 200);
      }
    }, timeout);

    w.appendChild(t);

    // Limit visible toasts to 5
    const all = w.querySelectorAll('.toast');
    if (all.length > 5) all[0].remove();
  }

  // ===== Modal (CR-MODAL v1.0) =====
  let modalBack = null;
  function ensureModal(){
    if(modalBack) return;
    modalBack = document.createElement("div");
    modalBack.className = "cr-m-overlay";
    // Also keep legacy class for any external selectors
    modalBack.classList.add("modalback");

    const modal = document.createElement("div");
    modal.className = "cr-m modal";

    // Top accent line
    const topline = document.createElement("div");
    topline.className = "cr-m__topline";
    modal.appendChild(topline);

    // Drag handle (mobile)
    const dragHandle = document.createElement("div");
    dragHandle.className = "cr-m__drag-handle";
    modal.appendChild(dragHandle);

    // Header
    const header = document.createElement("div");
    header.className = "cr-m__header mh";

    const icon = document.createElement("div");
    icon.className = "cr-m__icon";
    icon.id = "modalIcon";
    icon.textContent = "⚡";
    header.appendChild(icon);

    const titles = document.createElement("div");
    titles.className = "cr-m__titles";
    const titleEl = document.createElement("div");
    titleEl.className = "cr-m__title";
    titleEl.id = "modalTitle";
    titleEl.textContent = "Окно";
    titles.appendChild(titleEl);
    const subtitleEl = document.createElement("div");
    subtitleEl.className = "cr-m__subtitle";
    subtitleEl.id = "modalSubtitle";
    subtitleEl.style.display = "none";
    titles.appendChild(subtitleEl);
    header.appendChild(titles);

    const actions = document.createElement("div");
    actions.className = "cr-m__header-actions";

    const fullBtn = document.createElement("button");
    fullBtn.className = "cr-m__fullscreen-btn";
    fullBtn.id = "modalFull";
    fullBtn.title = "На весь экран";
    fullBtn.type = "button";
    fullBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>';
    actions.appendChild(fullBtn);

    const closeBtn = document.createElement("button");
    closeBtn.className = "cr-m__close";
    closeBtn.id = "modalClose";
    closeBtn.title = "Закрыть";
    closeBtn.type = "button";
    closeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    actions.appendChild(closeBtn);

    header.appendChild(actions);
    modal.appendChild(header);

    // Body
    const body = document.createElement("div");
    body.className = "cr-m__body mc";
    body.id = "modalBody";
    modal.appendChild(body);

    modalBack.appendChild(modal);
    document.body.appendChild(modalBack);

    closeBtn.addEventListener("click", hideModal);
    fullBtn.addEventListener("click", ()=>{
      modal.classList.toggle("cr-m--fullscreen");
      modal.classList.toggle("fullscreen");
    });
    modalBack.addEventListener("click", (e)=>{
      if(e.target === modalBack) _showOopsBubble(e.clientX, e.clientY);
    });
    // ESC to close
    document.addEventListener("keydown", (e)=>{
      if(e.key === "Escape" && modalBack && modalBack.classList.contains("cr-m-overlay--visible")){
        hideModal();
      }
    });
  }

  // Icon map based on common title keywords
  const _modalIconMap = [
    [/тендер|tender/i,      '📋'],
    [/ткп|tkp|предложен/i,  '💰'],
    [/работ|work|объект/i,   '🏗'],
    [/сотрудник|employee|персонал/i, '👤'],
    [/оборудован|equipment/i,'🔧'],
    [/расход|expense|оплат|payment/i,'💳'],
    [/договор|contract/i,    '📄'],
    [/пропуск|pass/i,        '🪪'],
    [/допуск|permit/i,       '📜'],
    [/календар|calendar|встреч|meeting/i, '📅'],
    [/напоминан|reminder/i,  '🔔'],
    [/почт|mail|email|письм/i,'✉️'],
    [/чат|chat|сообщен/i,    '💬'],
    [/загрузк|upload|файл|file/i,'📎'],
    [/настрой|setting/i,     '⚙️'],
    [/удали|delet/i,         '🗑'],
    [/подтвер|confirm/i,     '✅'],
    [/печат|print|qr/i,      '🖨'],
    [/отчёт|report|аналитик/i,'📊'],
    [/зарплат|salary|payroll/i,'💵'],
    [/смет|estimate|просчёт/i,'🧮'],
    [/корреспонд|correspond/i,'📨'],
    [/довереннос|proxy/i,    '📝'],
    [/склад|warehouse/i,     '📦'],
    [/карт|map|объект/i,     '🗺'],
    [/звонок|call|телефон/i, '📞'],
    [/задач|task/i,          '☑️'],
  ];

  function _pickModalIcon(title){
    if(!title) return '⚡';
    for(const [rx, icon] of _modalIconMap){
      if(rx.test(title)) return icon;
    }
    return '⚡';
  }

  /**
   * showModal(title, html)
   * showModal({ title, html, fullscreen, onMount, wide, icon, subtitle })
   */
  const _modalStack = [];

  function showModal(a, b){
    ensureModal();
    const overlay = modalBack;
    const modal = $(".cr-m", overlay);
    // Stack: if modal is already visible, save current state
    if(overlay.classList.contains("cr-m-overlay--visible")){
      _modalStack.push({
        title: $("#modalTitle", overlay).textContent,
        html: $("#modalBody", overlay).innerHTML,
        fullscreen: modal.classList.contains("cr-m--fullscreen"),
        wide: modal.classList.contains("cr-m--wide"),
        icon: $("#modalIcon", overlay).textContent,
        subtitle: $("#modalSubtitle", overlay).textContent
      });
    }
    let title = "Окно";
    let html = "";
    let fullscreen = false;
    let wide = false;
    let onMount = null;
    let icon = null;
    let subtitle = "";

    if(a && typeof a === "object"){
      title = a.title || title;
      html = a.html || "";
      fullscreen = !!a.fullscreen;
      wide = !!a.wide;
      onMount = (typeof a.onMount === "function") ? a.onMount : null;
      icon = a.icon || null;
      subtitle = a.subtitle || "";
    } else {
      title = a || title;
      html = b || "";
    }

    $("#modalTitle", overlay).textContent = title || "Окно";
    $("#modalIcon", overlay).textContent = icon || _pickModalIcon(title);
    const subEl = $("#modalSubtitle", overlay);
    if(subtitle){
      subEl.textContent = subtitle;
      subEl.style.display = "";
    } else {
      subEl.textContent = "";
      subEl.style.display = "none";
    }
    $("#modalBody", overlay).innerHTML = html || "";

    modal.classList.toggle("cr-m--fullscreen", fullscreen);
    modal.classList.toggle("fullscreen", fullscreen);
    modal.classList.toggle("cr-m--wide", wide);
    modal.classList.toggle("wide", wide);

    // Show with animation
    overlay.style.display = "flex";
    // Force reflow for animation
    void overlay.offsetHeight;
    overlay.classList.remove("cr-m-overlay--leaving");
    overlay.classList.add("cr-m-overlay--visible");
    document.body.style.overflow = "hidden";

    if(onMount){
      setTimeout(()=>{
        try{ onMount({back: overlay, modal: modal, body: $("#modalBody", overlay)}); }
        catch(e){ toast("Ошибка", e, "err"); }
      }, 0);
    }
  }

  function hideModal(){
    if(!modalBack) return;
    const overlay = modalBack;
    const modal = $(".cr-m", overlay);

    // Stack: if there's a previous modal, restore it instead of hiding
    if(_modalStack.length > 0){
      const prev = _modalStack.pop();
      $("#modalTitle", overlay).textContent = prev.title;
      $("#modalBody", overlay).innerHTML = prev.html;
      $("#modalIcon", overlay).textContent = prev.icon || '⚡';
      const subEl = $("#modalSubtitle", overlay);
      if(prev.subtitle){
        subEl.textContent = prev.subtitle;
        subEl.style.display = "";
      } else {
        subEl.textContent = "";
        subEl.style.display = "none";
      }
      if(modal){
        modal.classList.toggle("cr-m--fullscreen", prev.fullscreen);
        modal.classList.toggle("fullscreen", prev.fullscreen);
        modal.classList.toggle("cr-m--wide", prev.wide);
        modal.classList.toggle("wide", prev.wide);
      }
      return;
    }

    // Animate close
    overlay.classList.add("cr-m-overlay--leaving");
    overlay.classList.remove("cr-m-overlay--visible");

    setTimeout(function() {
      overlay.style.display = "none";
      overlay.classList.remove("cr-m-overlay--leaving");
      document.body.style.overflow = "";
      $("#modalBody", overlay).innerHTML = "";
      if(modal) {
        modal.classList.remove("cr-m--fullscreen", "fullscreen", "cr-m--wide", "wide");
      }
    }, 300);
  }

  // ═══════════════════════════════════════════════════════════════
  // MOBILE BOTTOM SHEET SWIPE-TO-DISMISS (cr-modal v1.0)
  // ═══════════════════════════════════════════════════════════════
  function initModalSwipeDismiss() {
    if (window.innerWidth > 768) return;

    var swipeStartY = 0;
    var swipeCurrentY = 0;
    var swiping = false;
    var modal = null;

    document.addEventListener('touchstart', function(e) {
      if (!modalBack || !modalBack.classList.contains('cr-m-overlay--visible')) return;
      modal = modalBack.querySelector('.cr-m');
      if (!modal) return;

      // Only start swipe from the top area of modal (drag handle zone)
      var rect = modal.getBoundingClientRect();
      var touchY = e.touches[0].clientY;
      if (touchY < rect.top || touchY > rect.top + 60) return;

      swipeStartY = touchY;
      swiping = true;
    }, { passive: true });

    document.addEventListener('touchmove', function(e) {
      if (!swiping || !modal) return;
      swipeCurrentY = e.touches[0].clientY;
      var delta = swipeCurrentY - swipeStartY;

      // Only allow downward swipe
      if (delta < 0) { delta = 0; }

      modal.style.transform = 'translateY(' + delta + 'px)';
      modal.style.transition = 'none';
      modal.style.opacity = String(Math.max(0.3, 1 - (delta / 400)));
    }, { passive: true });

    document.addEventListener('touchend', function() {
      if (!swiping || !modal) return;
      swiping = false;
      var delta = swipeCurrentY - swipeStartY;

      if (delta > 100) {
        // Dismiss
        hideModal();
      } else {
        // Snap back
        modal.style.transition = 'transform 0.25s cubic-bezier(0.16,1,0.3,1), opacity 0.25s ease';
        modal.style.transform = '';
        modal.style.opacity = '';
        setTimeout(function() {
          if (modal) {
            modal.style.transition = '';
          }
        }, 250);
      }
    }, { passive: true });
  }

  // Auto-init swipe dismiss
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initModalSwipeDismiss);
  } else {
    initModalSwipeDismiss();
  }

  // ═══════════════════════════════════════════════════════════════
  // SLIDE-OVER DRAWER (cr-modal v1.0)
  // ═══════════════════════════════════════════════════════════════
  let drawerEl = null;
  let drawerOverlay = null;

  function ensureDrawer() {
    if (drawerEl) return;

    drawerOverlay = document.createElement('div');
    drawerOverlay.className = 'cr-d-overlay drawer-overlay';
    drawerOverlay.id = 'drawerOverlay';
    document.body.appendChild(drawerOverlay);

    drawerEl = document.createElement('div');
    drawerEl.className = 'cr-d drawer';
    drawerEl.id = 'drawer';

    // Top accent line
    const topline = document.createElement('div');
    topline.className = 'cr-d__topline';
    drawerEl.appendChild(topline);

    // Header
    const header = document.createElement('div');
    header.className = 'cr-d__header drawer-header';
    header.id = 'drawerHeader';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'cr-d__close drawer-close';
    closeBtn.id = 'drawerClose';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Закрыть');
    closeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    header.appendChild(closeBtn);

    const titleEl = document.createElement('div');
    titleEl.className = 'cr-d__title drawer-title';
    titleEl.id = 'drawerTitle';
    header.appendChild(titleEl);

    const actionsEl = document.createElement('div');
    actionsEl.className = 'cr-d__actions drawer-actions';
    actionsEl.id = 'drawerActions';
    header.appendChild(actionsEl);

    drawerEl.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.className = 'cr-d__body drawer-body';
    body.id = 'drawerBody';
    drawerEl.appendChild(body);

    document.body.appendChild(drawerEl);

    closeBtn.addEventListener('click', hideDrawer);
    drawerOverlay.addEventListener('click', hideDrawer);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && drawerEl.classList.contains('cr-d--open')) {
        hideDrawer();
      }
    });
  }

  /**
   * showDrawer(title, html)
   * showDrawer({ title, html, width, onMount, actions })
   *
   * width: 'normal' (480px) | 'wide' (640px) | 'full' (90vw)
   * actions: HTML string for action buttons in header
   */
  function showDrawer(a, b) {
    ensureDrawer();

    let title = 'Детали';
    let html = '';
    let width = 'normal';
    let onMount = null;
    let actions = '';

    if (a && typeof a === 'object') {
      title = a.title || title;
      html = a.html || '';
      width = a.width || 'normal';
      onMount = typeof a.onMount === 'function' ? a.onMount : null;
      actions = a.actions || '';
    } else {
      title = a || title;
      html = b || '';
    }

    $('#drawerTitle').textContent = title;
    $('#drawerBody').innerHTML = html;
    $('#drawerActions').innerHTML = actions;

    drawerEl.className = 'cr-d drawer';
    if (width === 'wide') drawerEl.classList.add('cr-d--wide', 'drawer-wide');
    else if (width === 'full') drawerEl.classList.add('cr-d--full', 'drawer-full');
    else drawerEl.classList.add('drawer-normal');

    requestAnimationFrame(() => {
      drawerOverlay.classList.add('cr-d-overlay--visible', 'open');
      drawerEl.classList.add('cr-d--open', 'open');
      document.body.style.overflow = 'hidden';
    });

    if (onMount) {
      setTimeout(() => {
        try {
          onMount({ drawer: drawerEl, body: $('#drawerBody') });
        } catch (e) {
          console.error('Drawer onMount error:', e);
        }
      }, 50);
    }
  }

  function hideDrawer() {
    if (!drawerEl) return;
    drawerEl.classList.remove('cr-d--open', 'open');
    drawerOverlay.classList.remove('cr-d-overlay--visible', 'open');
    document.body.style.overflow = '';

    setTimeout(() => {
      if (drawerEl) $('#drawerBody').innerHTML = '';
    }, 350);
  }

  // Status CSS class mapper
  function statusClass(statusText) {
    if (!statusText) return 'status-gray';
    const s = statusText.toLowerCase().trim();

    if (/^(новый|новая|черновик|draft|отменён|архив)/.test(s)) return 'status-gray';
    if (/^(отпра��лено на просчёт|в работе|in.progress|выполняется|обработка|подготовка|мобилизация)/.test(s)) return 'status-blue';
    if (/^(кп отправлено|согласование ткп|на проверке|review|ожидание)/.test(s)) return 'status-purple';
    if (/^(на паузе|отложен|истекает|pending|вопрос|приостановлен)/.test(s)) return 'status-yellow';
    if (/^(выиграли|ткп согласовано|оплачен|завершён|done|готов|выполнен|одобрен|работы сдали|подписание акта)/.test(s)) return 'status-green';
    if (/^(проиграли|отклонён|просрочен|expired|rejected|ошибка)/.test(s)) return 'status-red';
    if (/^(vip|премиум|срочный|важный)/.test(s)) return 'status-gold';

    return 'status-blue';
  }

  // ===== Date Formatting =====
  function normalizeDateValue(value, dateOnly) {
    if (value instanceof Date) return new Date(value.getTime());
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') {
      const numDate = new Date(value);
      return isNaN(numDate.getTime()) ? null : numDate;
    }

    const raw = String(value).trim();
    if (!raw) return null;

    // Extract YYYY-MM-DD from any ISO string
    const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (ymd) {
      const hasRealTime = /[T\s](\d{2}):(\d{2})/.test(raw);
      const isMidnight = /T00:00:00/.test(raw);
      // Use local Date constructor when: no time, midnight, or dateOnly mode
      if (!hasRealTime || isMidnight || dateOnly) {
        return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
      }
      // Non-midnight time — parse with timezone
      const d = new Date(raw);
      return isNaN(d.getTime()) ? null : d;
    }

    // DD.MM.YYYY format
    const dmy = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
    if (dmy) {
      return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
    }

    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }

  function padDatePart(value) {
    return String(value).padStart(2, '0');
  }

  function formatDate(value, mode = 'dd.mm.yyyy') {
    if (!value) return '—';
    const d = normalizeDateValue(value, true);
    if (!d) return String(value);

    const year = d.getFullYear();
    const month = padDatePart(d.getMonth() + 1);
    const day = padDatePart(d.getDate());

    if (mode === 'yyyy-mm-dd') return `${year}-${month}-${day}`;
    if (mode === 'yyyy.mm.dd') return `${year}.${month}.${day}`;
    return `${day}.${month}.${year}`;
  }

  function formatDateTime(value, mode = 'dd.mm.yyyy') {
    if (!value) return '—';
    const d = normalizeDateValue(value);
    if (!d) return String(value);

    const hours = padDatePart(d.getHours());
    const minutes = padDatePart(d.getMinutes());
    return `${formatDate(d, mode)} ${hours}:${minutes}`;
  }

  // ===== Clipboard =====
  async function copyToClipboard(text){
    const payload = String(text ?? "");
    try{
      if(navigator.clipboard && navigator.clipboard.writeText){
        await navigator.clipboard.writeText(payload);
        toast("Скопировано", "Текст отправлен в буфер обмена");
        return true;
      }
    }catch(e){}
    // fallback (execCommand)
    try{
      const ta = document.createElement("textarea");
      ta.value = payload;
      ta.style.position = "fixed";
      ta.style.left = "-2000px";
      ta.style.top = "-2000px";
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if(ok) toast("Скопировано", "Текст отправлен в буфер обмена");
      else toast("Не удалось скопировать", "Браузер запретил доступ к буферу", "err");
      return ok;
    }catch(e){
      toast("Не удалось скопировать", "Браузер запретил доступ к буферу", "err");
      return false;
    }
  }

  // Skeleton loading helpers
  function skeleton(type = 'card', count = 3) {
    const templates = {
      card: '<div class="skeleton skeleton-card"></div>',
      text: '<div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text medium"></div><div class="skeleton skeleton-text short"></div>',
      row: '<div class="skeleton skeleton-row"></div>'
    };
    const tpl = templates[type] || templates.card;
    return Array(count).fill(tpl).join('');
  }

  /**
   * makeResponsiveTable(tableSelector)
   * Adds data-label attributes to td cells based on thead text,
   * and adds .responsive-cards class for mobile card view.
   */
  function makeResponsiveTable(selector) {
    const table = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!table) return;

    table.classList.add('responsive-cards');

    const headers = [];
    table.querySelectorAll('thead th').forEach(th => {
      headers.push(th.textContent.trim());
    });

    table.querySelectorAll('tbody tr').forEach(tr => {
      tr.querySelectorAll('td').forEach((td, i) => {
        if (headers[i]) {
          td.setAttribute('data-label', headers[i]);
        }
      });
    });
  }

  /**
   * emptyState({ icon, title, desc, action })
   * Returns HTML for empty state placeholder.
   */
  function emptyState(opts = {}) {
    const icon = opts.icon || '📭';
    const title = opts.title || 'Нет данных';
    const desc = opts.desc || '';
    const action = opts.action;

    return `<div class="empty-state">
      <div class="empty-state-icon">${icon}</div>
      <div class="empty-state-title">${esc(title)}</div>
      ${desc ? `<div class="empty-state-desc">${esc(desc)}</div>` : ''}
      ${action ? `<a class="btn primary" href="${esc(action.href || '#')}">${esc(action.label || 'Создать')}</a>` : ''}
    </div>`;
  }

  /**
   * enableTableSort(tableSelector)
   * Enables click-to-sort on <th> with data-sort attribute.
   */
  function enableTableSort(selector) {
    const table = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!table) return;

    table.querySelectorAll('th[data-sort]').forEach(th => {
      th.style.cursor = 'pointer';
      th.addEventListener('click', () => {
        const tbody = table.querySelector('tbody');
        if (!tbody) return;

        const dir = th.classList.contains('asc') ? 'desc' : 'asc';
        table.querySelectorAll('th[data-sort]').forEach(h => h.classList.remove('asc', 'desc'));
        th.classList.add(dir);

        const rows = Array.from(tbody.querySelectorAll('tr'));
        const colIndex = Array.from(th.parentNode.children).indexOf(th);

        rows.sort((a, b) => {
          const aVal = a.children[colIndex]?.textContent?.trim() || '';
          const bVal = b.children[colIndex]?.textContent?.trim() || '';
          const aNum = parseFloat(aVal.replace(/[^\d.-]/g, ''));
          const bNum = parseFloat(bVal.replace(/[^\d.-]/g, ''));

          if (!isNaN(aNum) && !isNaN(bNum)) {
            return dir === 'asc' ? aNum - bNum : bNum - aNum;
          }
          return dir === 'asc' ? aVal.localeCompare(bVal, 'ru') : bVal.localeCompare(aVal, 'ru');
        });

        rows.forEach(r => tbody.appendChild(r));
      });
    });
  }

  /**
   * formField(label, inputHtml, opts)
   * Returns HTML for a labeled form field.
   * opts: { required, help, fullWidth }
   */
  function formField(label, inputHtml, opts = {}) {
    const req = opts.required ? '<span class="req">*</span>' : '';
    const cls = opts.fullWidth ? ' full-width' : '';
    const help = opts.help ? `<div class="help">${esc(opts.help)}</div>` : '';
    return `<div class="form-field${cls}">
      <label>${esc(label)}${req}</label>
      ${inputHtml}
      ${help}
    </div>`;
  }

  /**
   * money(x) — Canonical currency formatter. All files MUST use this.
   * null/undefined/'' → '0', NaN → '0', valid → ru-RU formatted (e.g. '123 456,78')
   * Does NOT add ₽ suffix — each template adds it where needed.
   */
  function money(x) {
    if (x === null || x === undefined || x === '') return '0';
    const n = Number(x);
    return (isNaN(n) || !isFinite(n)) ? '0' : n.toLocaleString('ru-RU');
  }

  // ═══════════════════════════════════════════════════════════════
  // OOPS BUBBLE — всплывающая подсказка при клике за пределами модалки
  // ═══════════════════════════════════════════════════════════════
  const OOPS_PHRASES = [
    'Закрыть можно крестиком',
    'Модалка не кусается!',
    'Нажми крестик для закрытия',
    'Так не закроешь :)',
    'Крестик наверху справа',
    'Попробуй кнопку «Закрыть»',
    'Мимо! Жми крестик',
    'Почти попал, но нет',
    'Тут ничего нет, а крестик — наверху',
    'Ещё чуть-чуть... шучу, жми крестик',
    'Эй, я тут! Закрой через крестик',
    'Не туда! Крестик правее',
    'Упс, промахнулся',
    'Клик в пустоту...',
    'А вот и нет!',
    'Сюда нажимать бесполезно',
    'Модалку так не закроешь',
    'Крестик ждёт тебя наверху',
    'Не-а, попробуй крестик',
    'Окно закрывается кнопкой «Закрыть»'
  ];

  function _showOopsBubble(x, y) {
    const phrase = OOPS_PHRASES[Math.floor(Math.random() * OOPS_PHRASES.length)];
    const bubble = document.createElement('div');
    bubble.className = 'oops-bubble';
    bubble.textContent = phrase;
    bubble.style.left = x + 'px';
    bubble.style.top = y + 'px';
    document.body.appendChild(bubble);
    setTimeout(() => bubble.remove(), 1800);
  }

  return { renderMarkdown, $, $$, esc, toast, showModal, hideModal, closeModal: hideModal, showDrawer, hideDrawer, statusClass, makeResponsiveTable, emptyState, enableTableSort, formField, confirm: async (t,m) => window.confirm(m), copyToClipboard, formatDate, formatDateTime, skeleton, money, oopsBubble: _showOopsBubble };

  /**
   * renderMarkdown(md) — Renders Markdown text as styled HTML
   * Supports: headers (#, ##, ###), bold (**text**), lists (- item), tables (|col|col|)
   * Themed for ASGARD Viking design (gold headers, styled tables)
   */
  function renderMarkdown(md) {
    if (!md) return '';
    let html = esc(md);
    // Headers
    html = html.replace(/^### (.+)$/gm, '<h4 style="font-size:13px;font-weight:700;color:var(--blue-l,#4A90D9);margin:12px 0 6px">$1</h4>');
    html = html.replace(/^## (\d+\..+)$/gm, '<h3 style="font-size:15px;font-weight:700;color:var(--gold-l,#d4af37);margin:18px 0 10px;border-bottom:2px solid rgba(212,168,67,0.2);padding-bottom:6px">$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h3 style="font-size:15px;font-weight:700;color:var(--gold-l,#d4af37);margin:18px 0 10px">$1</h3>');
    html = html.replace(/^# (.+)$/gm, '<h2 style="font-size:17px;font-weight:800;color:var(--gold,#D4A843);margin:20px 0 12px;border-bottom:2px solid rgba(212,168,67,0.3);padding-bottom:8px">$1</h2>');
    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, '<b style="color:var(--t1)">$1</b>');
    // Lists with better styling
    html = html.replace(/^- (.+)$/gm, '<div style="padding-left:16px;margin:3px 0;position:relative"><span style="position:absolute;left:0;color:var(--gold)">&#8226;</span> $1</div>');
    // Tables
    let tableRows = [];
    let inTable = false;
    let headerDone = false;
    const lines = html.split('\n');
    const processed = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('|') && line.trim().startsWith('|')) {
        const cells = line.split('|').filter(c => c.trim() !== '');
        if (cells.every(c => /^[\s\-:]+$/.test(c))) { headerDone = true; continue; }
        if (!inTable) { inTable = true; headerDone = false; tableRows = []; }
        if (!headerDone && tableRows.length === 0) {
          tableRows.push('<tr>' + cells.map(c =>
            '<th style="padding:10px 12px;font-size:12px;font-weight:700;color:var(--gold-l,#d4af37);background:rgba(212,168,67,0.08);border-bottom:2px solid rgba(212,168,67,0.2);text-align:left;white-space:nowrap">' + c.trim() + '</th>'
          ).join('') + '</tr>');
        } else {
          const rowIdx = tableRows.length;
          const bgColor = rowIdx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)';
          tableRows.push('<tr style="background:' + bgColor + '">' + cells.map(c => {
            const val = c.trim();
            const isNum = /^[\d\s.,\u20BD%]+$/.test(val) || /^\d/.test(val);
            const align = isNum ? 'right' : 'left';
            const isBold = val.toLowerCase().includes('\u0438\u0442\u043e\u0433\u043e') || val.toLowerCase().includes('\u0432\u0441\u0435\u0433\u043e') || val.toLowerCase().includes('total');
            const fw = isBold ? 'font-weight:700;color:var(--gold)' : '';
            return '<td style="padding:8px 12px;font-size:13px;border-bottom:1px solid rgba(255,255,255,0.06);text-align:' + align + ';' + fw + '">' + val + '</td>';
          }).join('') + '</tr>');
        }
      } else {
        if (inTable && tableRows.length > 0) {
          processed.push('<div style="overflow-x:auto;margin:12px 0;border-radius:8px;border:1px solid rgba(255,255,255,0.08)"><table style="width:100%;border-collapse:collapse;min-width:400px">' + tableRows.join('') + '</table></div>');
          tableRows = []; inTable = false; headerDone = false;
        }
        processed.push(line);
      }
    }
    if (tableRows.length > 0) {
      processed.push('<div style="overflow-x:auto;margin:12px 0;border-radius:8px;border:1px solid rgba(255,255,255,0.08)"><table style="width:100%;border-collapse:collapse;min-width:400px">' + tableRows.join('') + '</table></div>');
    }
    html = processed.join('\n');
    html = html.replace(/\n/g, '<br>');
    html = html.replace(/<br>\s*<h[234]/g, function(m) { return m.replace('<br>', ''); });
    html = html.replace(/<\/h[234]>\s*<br>/g, function(m) { return m.replace('<br>', ''); });
    html = html.replace(/<br>\s*<div/g, '<div');
    html = html.replace(/<\/div>\s*<br>/g, '</div>');
    html = html.replace(/<br>\s*<table/g, '<table');
    html = html.replace(/<\/table>\s*<br>/g, '</table>');
    return html;
  }
})();