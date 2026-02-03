window.AsgardDocsPack=(function(){
  const { esc, toast } = AsgardUI;

  function isoNow(){ return new Date().toISOString(); }
  function b64utf8(str){
    // UTF‑8 safe base64
    return btoa(unescape(encodeURIComponent(str)));
  }

  async function ensurePack({tender_id=null, work_id=null, name="Комплект документов"}={}){
    const all = await AsgardDB.all("doc_sets");
    let pack = (all||[]).find(p=>Number(p.tender_id||0)===Number(tender_id||0) && Number(p.work_id||0)===Number(work_id||0));
    if(!pack){
      const id = await AsgardDB.add("doc_sets", { tender_id:tender_id||null, work_id:work_id||null, name, created_at: isoNow() });
      pack = await AsgardDB.get("doc_sets", id);
    }
    return pack;
  }

  async function docsFor({tender_id=null, work_id=null}={}){
    const dt = tender_id ? await AsgardDB.byIndex("documents","tender_id", tender_id) : [];
    const dw = work_id ? await AsgardDB.byIndex("documents","work_id", work_id) : [];
    return [...(dt||[]), ...(dw||[])].sort((a,b)=>String(b.created_at||"").localeCompare(String(a.created_at||"")));
  }

  async function addLink({tender_id=null, work_id=null, type="Документ", name="", url="", user_id=null}={}){
    if(!url) throw new Error("Укажите ссылку");
    await ensurePack({tender_id, work_id});
    const id = await AsgardDB.add("documents", {
      tender_id:tender_id||null,
      work_id:work_id||null,
      type,
      name: name || url,
      data_url: url,
      storage: "link",
      uploaded_by_user_id: user_id,
      created_at: isoNow()
    });
    return id;
  }

  async function addGeneratedHtml({tender_id=null, work_id=null, type="Документ", name="", html="", user_id=null}={}){
    if(!html) throw new Error("Пустой документ");
    await ensurePack({tender_id, work_id});
    const data_url = "data:text/html;base64," + b64utf8(String(html));
    const id = await AsgardDB.add("documents", {
      tender_id:tender_id||null,
      work_id:work_id||null,
      type,
      name: name || (type+".html"),
      data_url,
      storage:"data_url",
      uploaded_by_user_id:user_id,
      created_at: isoNow()
    });
    return id;
  }

  async function exportPack({tender_id=null, work_id=null}={}){
    const pack = await ensurePack({tender_id, work_id});
    const docs = await docsFor({tender_id, work_id});
    return { pack, docs };
  }

  async function downloadPackJson({tender_id=null, work_id=null}={}){
    const payload = await exportPack({tender_id, work_id});
    const content = JSON.stringify(payload, null, 2);
    const blob = new Blob([content], {type:"application/json;charset=utf-8"});
    const a=document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ASGARD_DocPack_${tender_id||""}${work_id?"_W"+work_id:""}_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 500);
    toast("Комплект","Экспорт JSON выполнен");
  }

  async function importPackJson(file,{tender_id=null, work_id=null, user_id=null}={}){
    const txt = await file.text();
    let payload=null;
    try{ payload = JSON.parse(txt); }catch(_){ throw new Error("Некорректный JSON"); }
    const docs = payload?.docs || [];
    await ensurePack({tender_id, work_id});
    for(const d of docs){
      await AsgardDB.add("documents", {
        tender_id:tender_id||d.tender_id||null,
        work_id:work_id||d.work_id||null,
        type:d.type||"Документ",
        name:d.name||"",
        data_url:d.data_url||"",
        storage:d.storage||"link",
        uploaded_by_user_id:user_id,
        created_at: isoNow()
      });
    }
    toast("Комплект","Импорт выполнен");
  }

  return { ensurePack, docsFor, addLink, addGeneratedHtml, exportPack, downloadPackJson, importPackJson };
})();
