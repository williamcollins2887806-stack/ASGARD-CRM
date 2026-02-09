window.AsgardUI = (function(){
  const $ = (s, e=document) => e.querySelector(s);
  const $$ = (s, e=document) => Array.from(e.querySelectorAll(s));
  const esc = (x) => String(x ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));

  const toastWrapId = "asgard_toasts";
  function toast(title, msg="", type="ok", timeout=3500){
    // Normalize message to readable string (avoid "[object Object]")
    let mtxt = msg;
    if(mtxt && typeof mtxt === "object"){
      if(typeof mtxt.message === "string") mtxt = mtxt.message;
      else{
        try{ mtxt = JSON.stringify(mtxt); } catch(e){ mtxt = String(mtxt); }
      }
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
    const t = document.createElement("div");
    t.className = "toast " + (type==="err" ? "err" : "ok");
    t.innerHTML = `<div class="h">${esc(title)}</div><div class="m">${esc(mtxt||"")}</div>`;
    w.appendChild(t);
    setTimeout(()=>t.remove(), timeout);
  }

  // ===== Modal =====
  let modalBack = null;
  function ensureModal(){
    if(modalBack) return;
    modalBack = document.createElement("div");
    modalBack.className = "modalback";
    modalBack.innerHTML = `
      <div class="modal">
        <div class="mh">
          <div class="h" id="modalTitle">Окно</div>
          <div style="display:flex; gap:8px; align-items:center;">
            <button class="btn ghost" id="modalFull" title="На весь экран">⛨</button>
            <button class="btn ghost" id="modalClose">Закрыть</button>
          </div>
        </div>
        <div class="mc" id="modalBody"></div>
      </div>`;
    document.body.appendChild(modalBack);

    $("#modalClose", modalBack).addEventListener("click", hideModal);
    $("#modalFull", modalBack).addEventListener("click", ()=>{
      const m = $(".modal", modalBack);
      m.classList.toggle("fullscreen");
    });
    modalBack.addEventListener("click", (e)=>{
      if(e.target === modalBack) hideModal();
    });
  }

  /**
   * showModal(title, html)
   * showModal({ title, html, fullscreen, onMount })
   */
  function showModal(a, b){
    ensureModal();
    let title = "Окно";
    let html = "";
    let fullscreen = false;
    let onMount = null;

    if(a && typeof a === "object"){
      title = a.title || title;
      html = a.html || "";
      fullscreen = !!a.fullscreen;
      onMount = (typeof a.onMount === "function") ? a.onMount : null;
    } else {
      title = a || title;
      html = b || "";
    }

    $("#modalTitle", modalBack).textContent = title || "Окно";
    $("#modalBody", modalBack).innerHTML = html || "";
    const m = $(".modal", modalBack);
    if(fullscreen) m.classList.add("fullscreen");
    modalBack.style.display = "flex";

    if(onMount){
      // Run after DOM is painted
      setTimeout(()=>{
        try{ onMount({back: modalBack, modal: m, body: $("#modalBody", modalBack)}); }
        catch(e){ toast("Ошибка", e, "err"); }
      }, 0);
    }
  }

  function hideModal(){
    if(!modalBack) return;
    modalBack.style.display = "none";
    $("#modalBody", modalBack).innerHTML = "";
    const m = $(".modal", modalBack);
    if(m) m.classList.remove("fullscreen");
  }

  // ═══════════════════════════════════════════════════════════════
  // SLIDE-OVER DRAWER
  // ═══════════════════════════════════════════════════════════════
  let drawerEl = null;
  let drawerOverlay = null;

  function ensureDrawer() {
    if (drawerEl) return;

    drawerOverlay = document.createElement('div');
    drawerOverlay.className = 'drawer-overlay';
    drawerOverlay.id = 'drawerOverlay';
    document.body.appendChild(drawerOverlay);

    drawerEl = document.createElement('div');
    drawerEl.className = 'drawer';
    drawerEl.id = 'drawer';
    drawerEl.innerHTML = `
      <div class="drawer-header" id="drawerHeader">
        <button class="drawer-close" id="drawerClose" type="button" aria-label="Закрыть">✕</button>
        <div class="drawer-title" id="drawerTitle"></div>
        <div class="drawer-actions" id="drawerActions"></div>
      </div>
      <div class="drawer-body" id="drawerBody"></div>
    `;
    document.body.appendChild(drawerEl);

    $('#drawerClose').addEventListener('click', hideDrawer);
    drawerOverlay.addEventListener('click', hideDrawer);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && drawerEl.classList.contains('open')) {
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

    drawerEl.className = `drawer drawer-${width}`;

    requestAnimationFrame(() => {
      drawerOverlay.classList.add('open');
      drawerEl.classList.add('open');
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
    drawerEl.classList.remove('open');
    drawerOverlay.classList.remove('open');
    document.body.style.overflow = '';

    setTimeout(() => {
      if (drawerEl) $('#drawerBody').innerHTML = '';
    }, 300);
  }

  // Status CSS class mapper
  function statusClass(statusText) {
    if (!statusText) return 'status-gray';
    const s = statusText.toLowerCase().trim();

    if (/^(новый|новая|получен|черновик|draft|отменён|архив)/.test(s)) return 'status-gray';
    if (/^(в просчёте|на просчёте|в работе|in.progress|выполняется|обработка)/.test(s)) return 'status-blue';
    if (/^(кп отправлено|ткп отправлено|на согласовании|на проверке|review|ожидание)/.test(s)) return 'status-purple';
    if (/^(переговоры|отложен|истекает|pending|вопрос|приостановлен)/.test(s)) return 'status-yellow';
    if (/^(выиграли|контракт|оплачен|завершён|done|готов|выполнен|одобрен|согласован|подписан)/.test(s)) return 'status-green';
    if (/^(проиграли|отказ|отклонён|просрочен|expired|rejected|ошибка)/.test(s)) return 'status-red';
    if (/^(vip|премиум|срочный|важный)/.test(s)) return 'status-gold';

    return 'status-blue';
  }

  // ===== Date Formatting =====
  function formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  }

  function formatDateTime(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
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

  return { $, $$, esc, toast, showModal, hideModal, closeModal: hideModal, showDrawer, hideDrawer, statusClass, makeResponsiveTable, emptyState, confirm: async (t,m) => window.confirm(m), copyToClipboard, formatDate, formatDateTime, skeleton };
})();
