window.AsgardConfirm=(function(){
  const { showModal, $, esc } = AsgardUI;
  function open(opts={}){
    const title = opts.title || "Подтверждение";
    const body = opts.body || "Подтвердите действие.";
    const okText = opts.okText || "Подтвердить";
    const cancelText = opts.cancelText || "Отмена";
    const danger = !!opts.danger;

    return new Promise((resolve)=>{
      showModal({
        title,
        html: `
          <div class="confirm-body">${body}</div>
          <div class="confirm-actions">
            <button id="cfCancel" class="btn btn-ghost">${esc(cancelText)}</button>
            <button id="cfOk" class="btn ${danger?'btn-danger':'btn-primary'}">${esc(okText)}</button>
          </div>
        `,
        onMount: (root)=>{
          const btnOk = $("#cfOk", root);
          const btnCancel = $("#cfCancel", root);
          const done = (v)=>{ try{ AsgardUI.hideModal(); }catch(e){} resolve(v); };
          btnOk?.addEventListener("click", ()=>done(true));
          btnCancel?.addEventListener("click", ()=>done(false));
          // ESC -> cancel
          root.addEventListener("keydown", (e)=>{ if(e.key==="Escape") done(false); });
          setTimeout(()=>btnOk?.focus(), 0);
        }
      });
    });
  }
  return { open };
})();
