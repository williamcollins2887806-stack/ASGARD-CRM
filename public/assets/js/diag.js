window.AsgardDiagPage=(function(){
  const { $, esc, toast } = AsgardUI;

  async function dbSummary(){
    const db = await AsgardDB.open();
    const sum = { stores: {}, total: 0 };
    const storeNames = Object.keys(AsgardDB.STORES || {});
    for(const name of storeNames){
      try{
        const c = await AsgardDB.count(name);
        sum.stores[name]=c;
        sum.total += c;
      }catch(e){
        sum.stores[name]="ERR";
      }
    }
    return sum;
  }

  async function storageEstimate(){
    if(navigator.storage && navigator.storage.estimate){
      try{ return await navigator.storage.estimate(); }catch(e){ return null; }
    }
    return null;
  }

  async function lastAudit(){
    try{
      const rows = await AsgardDB.list("audit_log", {limit: 25, orderBy:"created_at", desc:true});
      return rows || [];
    }catch(e){
      return [];
    }
  }

  function fmtBytes(n){
    if(n===null||n===undefined||!Number.isFinite(n)) return "—";
    const u=["B","KB","MB","GB"]; let i=0; let v=n;
    while(v>=1024 && i<u.length-1){ v/=1024; i++; }
    return (i===0?String(v):v.toFixed(1))+" "+u[i];
  }

  async function buildHtml(){
    const ver = (window.ASGARD_BUILD && window.ASGARD_BUILD.version) ? window.ASGARD_BUILD.version : "unknown";
    const builtAt = (window.ASGARD_BUILD && window.ASGARD_BUILD.built_at) ? window.ASGARD_BUILD.built_at : "unknown";
    const lastBackup = localStorage.getItem("asgard_last_backup_iso") || "—";
    const safe = AsgardSafeMode?.isOn?.() ? "ON" : "OFF";

    const est = await storageEstimate();
    const sum = await dbSummary();
    const audit = await lastAudit();

    const auditRows = audit.map(a=>`
      <tr>
        <td class="mono">${esc(a.created_at||"")}</td>
        <td>${esc(a.action||"")}</td>
        <td>${esc(a.entity_type||"")}</td>
        <td class="mono">${esc(a.entity_id||"")}</td>
        <td class="mono">${esc(a.actor_user_id||"")}</td>
      </tr>
    `).join("");

    const storeRows = Object.entries(sum.stores).map(([k,v])=>`
      <tr><td class="mono">${esc(k)}</td><td class="mono">${esc(String(v))}</td></tr>
    `).join("");

    return `
      <div class="diag-grid">
        <div class="card">
          <h3>Сборка</h3>
          <div class="kv"><div>Версия</div><div class="mono">${esc(ver)}</div></div>
          <div class="kv"><div>Собрано</div><div class="mono">${esc(builtAt)}</div></div>
          <div class="kv"><div>Safe-mode</div><div class="mono">${esc(safe)}</div></div>
          <div class="actions">
            <button id="btnSafeToggle" class="btn btn-ghost">Переключить safe-mode</button>
            <a class="btn btn-ghost" href="#/backup">Backup/Import</a>
          </div>
        </div>

        <div class="card">
          <h3>Хранилище</h3>
          <div class="kv"><div>Записей (всего)</div><div class="mono">${esc(String(sum.total))}</div></div>
          <div class="kv"><div>Last backup</div><div class="mono">${esc(lastBackup)}</div></div>
          <div class="kv"><div>Storage estimate</div><div class="mono">${esc(est? (fmtBytes(est.usage)+" / "+fmtBytes(est.quota)) : "—")}</div></div>
          <details>
            <summary>По таблицам</summary>
            <table class="table">
              <thead><tr><th>store</th><th>count</th></tr></thead>
              <tbody>${storeRows}</tbody>
            </table>
          </details>
        </div>

        <div class="card">
          <h3>Self-test</h3>
          <p class="muted">Запустите быстрый самотест. Отчёт откроется в новой вкладке.</p>
          <div class="actions">
            <a class="btn btn-primary" href="tools/selftest.html" target="_blank" rel="noopener">Открыть self-test</a>
            <button id="btnRunSelf" class="btn btn-ghost">Прогнать self-test тут</button>
          </div>
          <pre id="selfInline" class="pre"></pre>
        </div>

        <div class="card">
          <h3>Последние события audit_log</h3>
          <table class="table">
            <thead><tr><th>when</th><th>action</th><th>type</th><th>id</th><th>actor</th></tr></thead>
            <tbody>${auditRows || "<tr><td colspan='5' class='muted'>нет данных</td></tr>"}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  async function onMount(root){
    $("#btnSafeToggle", root)?.addEventListener("click", ()=>{
      AsgardSafeMode.toggle();
      toast("Safe-mode: "+(AsgardSafeMode.isOn()?"ON":"OFF"));
    });
    $("#btnRunSelf", root)?.addEventListener("click", async ()=>{
      const pre = $("#selfInline", root);
      pre.textContent = "Running...";
      try{
        if(typeof window.AsgardSelftestRun === "function"){
          const r = await window.AsgardSelftestRun({silent:true});
          pre.textContent = (r && r.ok) ? "PASS" : ("FAIL\n"+(r?.errors||[]).join("\n"));
        } else {
          pre.textContent = "Self-test runner not available here. Open /tools/selftest.html";
        }
      }catch(e){
        pre.textContent = "FAIL\n"+String(e);
      }
    });
  }

  return {
    render: async function({layout}){
      const html = await buildHtml();
      await layout(html, {title:"Диагностика", motto:"Проверка крепости. Логи и стража без суеты."});
      const root=document;
      await onMount(root);
    }
  };
})();
