window.AsgardRouter=(function(){
  const routes={};
  let _current=null;

  function add(path, handler, opts={}){ routes[path]={handler,opts}; }

  function parseHash(){
    // Default landing: public welcome page
    const h=(location.hash||"#/welcome").replace(/^#/, "");
    const [p,qs]=h.split("?");
    const path=(p.startsWith("/")?p:"/"+p);
    const query={};
    if(qs){
      qs.split("&").forEach(kv=>{
        const [k,v]=kv.split("=");
        query[decodeURIComponent(k)] = decodeURIComponent(v||"");
      });
    }
    return {path, query};
  }

  function current(){ return _current; }

  function roleAllowed(allowed, role){
    if(!Array.isArray(allowed) || !allowed.length) return true;
    if(role==="ADMIN") return true;
    if(allowed.includes(role)) return true;
    // backward compatibility: allow DIRECTOR_* when route expects DIRECTOR
    if(allowed.includes("DIRECTOR") && window.AsgardAuth && AsgardAuth.isDirectorRole && AsgardAuth.isDirectorRole(role)) return true;
    return false;
  }

  async function render(){
    // Закрываем модалку при переходе между страницами
    try { if(window.AsgardUI && AsgardUI.hideModal) AsgardUI.hideModal(); } catch(_) {}
    const {path, query}=parseHash();
    _current=path;
    const r=routes[path]||routes["/home"];
    if(!r) return;

    if(r.opts.auth){
      const u=await AsgardAuth.requireUser();
      if(!u){ location.hash="#/login"; return; }
      const role=u.user.role;
      if(r.opts.roles && !roleAllowed(r.opts.roles, role)){
        AsgardUI.toast("Доступ закрыт","Недостаточно прав","err");
        location.hash="#/home";
        return;
      }

      // SLA tick (best-effort): notifications without blocking navigation.
      try{
        if(window.AsgardSLA && typeof AsgardSLA.tick === 'function'){
          await AsgardSLA.tick(u.user);
        }
      }catch(_){ /* non-fatal */ }
    }

    try{
      await r.handler({path, query});
    }catch(e){
      console.error(e);
      try{ AsgardUI.toast("Ошибка","Сбой рендера страницы: "+(e?.message||e),"err",6000); }catch(_){ }
      try{
        const app=document.getElementById("app");
        if(app) app.innerHTML = `<div style="padding:18px;color:#fff"><b>Ошибка рендера</b><div style="opacity:.85;margin-top:6px">${(e?.message||String(e)).replace(/</g,"&lt;")}</div><div style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap"><a href="#/home" style="color:#9bd">На главную</a><a href="#/diag" style="color:#9bd">Диагностика</a><button id="btnSafeMode" style="background:#111827;border:1px solid #374151;color:#e5e7eb;padding:6px 10px;border-radius:10px;cursor:pointer">Включить safe-mode</button></div></div>`;
        try{
          const b = document.getElementById("btnSafeMode");
          if(b){ b.onclick = ()=>{ try{ localStorage.setItem("asgard_safe_mode","1"); }catch(_){} location.hash="#/home"; }; }
        }catch(_){ }
      }catch(_){ }
    }
  }

  function start(){ window.addEventListener("hashchange", render); render(); }

  return { add, start, current };
})();
