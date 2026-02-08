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

  return { $, $$, esc, toast, showModal, hideModal, closeModal: hideModal, confirm: async (t,m) => window.confirm(m), copyToClipboard, formatDate, formatDateTime };
})();
