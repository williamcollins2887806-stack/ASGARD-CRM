
window.AsgardBackupPage=(function(){
  const {$, $$, esc, toast} = AsgardUI;
  const isDirRole = (r)=> (window.AsgardAuth&&AsgardAuth.isDirectorRole)?AsgardAuth.isDirectorRole(r):(r==="DIRECTOR"||String(r||"").startsWith("DIRECTOR_"));

  function dl(name, data){
    const blob = new Blob([data], {type:"application/json;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url; a.download=name;
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 150);
  }

  async function render({layout, title}={}){
    const auth = await AsgardAuth.requireUser();
    const user = auth.user;
    const isAllowed = (user.role==="ADMIN"||isDirRole(user.role));
    if(!isAllowed){ toast("Недостаточно прав"); location.hash="#/home"; return; }

    const body = `
      <div class="card">
        <div class="kpi"><span class="dot" style="background:#38bdf8"></span> Камень Хроник • Резерв</div>
        <div class="help">Экспорт и импорт базы CRM одним JSON-файлом. Для тестов и переноса на другой ПК.</div>
        <hr class="hr"/>

        <div class="grid" style="grid-template-columns: 1fr 1fr; gap:14px">
          <div class="card" style="margin:0">
            <div class="who"><b>Экспорт</b></div>
            <div class="help">Скачает все данные из базы: тендеры, просчёты, работы, документы, настройки.</div>
            <div class="row" style="gap:10px; margin-top:12px; flex-wrap:wrap">
              <button class="btn" id="btnExp">Скачать JSON</button>
              <button class="btn ghost" id="btnExpMini">Скачать без уведомлений</button>
            </div>
            <div class="help" id="expInfo" style="margin-top:10px"></div>
          </div>

          <div class="card" style="margin:0">
            <div class="who"><b>Импорт</b></div>
            <div class="help">Загрузит JSON. Можно поверх или с полным очищением базы.</div>
            <div class="row" style="gap:10px; margin-top:12px; flex-wrap:wrap">
              <input type="file" id="impFile" accept=".json,application/json" />
            </div>
            <div class="row" style="gap:10px; margin-top:10px; flex-wrap:wrap">
              <label class="row" style="gap:8px; align-items:center"><input type="checkbox" id="wipe" checked/> Полностью очистить и загрузить заново</label>
              <label class="row" style="gap:8px; align-items:center"><input type="checkbox" id="keepNot" /> Сохранить текущие уведомления</label>
            </div>
            <div class="row" style="gap:10px; margin-top:12px; flex-wrap:wrap">
              <button class="btn" id="btnImp" disabled>Импортировать</button>
            </div>
            <div class="help" id="impInfo" style="margin-top:10px"></div>
          </div>
        </div>

        <hr class="hr"/>
        <div class="help">
          Примечание: пароли пользователей хранятся в базе. После импорта будут восстановлены вместе с пользователями.
        </div>
      </div>
    `;

    await layout(body, {title: title||"Резерв", motto:"Кто хранит хроники — тот управляет будущим."});

    const expInfo=$("#expInfo"), impInfo=$("#impInfo");
    $("#btnExp").addEventListener("click", async ()=>{
      try{
        const data = await AsgardDB.exportJSON();
        const stamp = new Date().toISOString().replace(/[:.]/g,"-");
        dl(`asgard_crm_backup_${stamp}.json`, JSON.stringify(data,null,2));
        expInfo.textContent = `Экспорт готов: ${Object.keys(AsgardDB.STORES).length} таблиц.`;
        toast("Экспорт завершён");
      }catch(e){ expInfo.textContent=String(e.message||e); toast("Ошибка экспорта"); }
    });

    $("#btnExpMini").addEventListener("click", async ()=>{
      try{
        const data = await AsgardDB.exportJSON();
        data.notifications = [];
        const stamp = new Date().toISOString().replace(/[:.]/g,"-");
        dl(`asgard_crm_backup_min_${stamp}.json`, JSON.stringify(data,null,2));
        expInfo.textContent = `Экспорт готов (без уведомлений).`;
        toast("Экспорт завершён");
      }catch(e){ expInfo.textContent=String(e.message||e); toast("Ошибка экспорта"); }
    });

    let parsed=null;
    $("#impFile").addEventListener("change", async (e)=>{
      parsed=null;
      impInfo.textContent="";
      $("#btnImp").disabled=true;
      const f=e.target.files?.[0];
      if(!f) return;
      try{
        const txt = await f.text();
        parsed = JSON.parse(txt);
        // basic sanity
        if(!parsed || typeof parsed!=="object") throw new Error("Некорректный JSON");
        const meta = parsed.__meta ? ` (${parsed.__meta.exported_at||""})` : "";
        impInfo.textContent = `Файл загружен${meta}. Готов к импорту.`;
        $("#btnImp").disabled=false;
      }catch(err){
        impInfo.textContent = `Ошибка: ${String(err.message||err)}`;
        toast("Не удалось прочитать файл");
      }
    });

    $("#btnImp").addEventListener("click", async ()=>{
      if(!parsed) return;
      const wipe=$("#wipe").checked;
      const keepNot=$("#keepNot").checked;
      const ok = await AsgardConfirm.open({title:"Подтверждение", body:(wipe ? "Очистить базу и импортировать файл?" : "Импортировать поверх текущих данных?"), okText:"Да", cancelText:"Нет", danger:wipe});
      if(!ok) return;
      try{
        let keep = null;
        if(keepNot){
          keep = await AsgardDB.all("notifications");
        }
        await AsgardDB.importJSON(parsed, {wipe});
        if(keepNot && keep){
          // restore notifications on top
          for(const n of keep) await AsgardDB.put("notifications", n);
        }
        toast("Импорт завершён");
        impInfo.textContent = "Импорт выполнен. Перезагрузите страницу (Ctrl+R) для актуального состояния.";
      }catch(err){
        impInfo.textContent = `Ошибка импорта: ${String(err.message||err)}`;
        toast("Ошибка импорта");
      }
    });
  }

  return {render};
})();
