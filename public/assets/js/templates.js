
window.AsgardTemplates=(function(){
  const {esc, toast} = AsgardUI;

  async function getDocsSettings(){
    const s = await AsgardDB.get("settings","docs");
    return s ? JSON.parse(s.value_json||"{}") : {};
  }
  async function getCompany(){
    const app = await AsgardDB.get("settings","app");
    const cur = app ? JSON.parse(app.value_json||"{}") : {};
    return cur.company_profile || {};
  }

  async function setDocsSettings(val){
    await AsgardDB.put("settings",{key:"docs", value_json: JSON.stringify(val||{})});
  }

  async function loadLogoDataUrl(){
    // cached in settings docs
    const ds = await getDocsSettings();
    if(ds._logo_data_url) return ds._logo_data_url;
    const resp = await fetch("assets/img/asgard_logo.png");
    const blob = await resp.blob();
    const dataUrl = await new Promise((res)=>{ const fr=new FileReader(); fr.onload=()=>res(fr.result); fr.readAsDataURL(blob); });
    ds._logo_data_url = dataUrl;
    await setDocsSettings(ds);
    return dataUrl;
  }

  function downloadFile(filename, mime, content){
    const blob = new Blob([content], {type:mime});
    const a=document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function wrapLetter({title, subtitle, bodyHtml, footerHtml, logoDataUrl, company}){
    const css = `
      body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial; color:#0f172a; margin:0; background:#fff;}
      .page{padding:34px 42px;}
      .top{display:flex; gap:18px; align-items:center; border-bottom:2px solid #0f172a; padding-bottom:12px; margin-bottom:18px;}
      .logo{width:92px; height:auto;}
      .h1{font-size:18px; font-weight:800; letter-spacing:.3px;}
      .h2{font-size:12px; color:#334155; margin-top:4px;}
      .box{border:1px solid #cbd5e1; padding:14px 16px; border-radius:10px;}
      .p{font-size:13px; line-height:1.5; margin:10px 0;}
      .muted{color:#475569; font-size:12px;}
      .sig{margin-top:18px; display:flex; justify-content:space-between; gap:20px; align-items:flex-end;}
      .line{border-bottom:1px solid #0f172a; width:240px; height:18px;}
      .stamp{font-size:11px; color:#475569;}
      .rune{margin:16px 0; border-top:1px dashed #94a3b8;}
    `;
    const c = company||{};
    return `<!doctype html><html><head><meta charset="utf-8"/><title>${esc(title||"Документ")}</title><style>${css}</style></head>
    <body><div class="page">
      <div class="top">
        <img class="logo" src="${logoDataUrl||""}" alt="ASGARD"/>
        <div>
          <div class="h1">${esc((c.company_name||"ООО «АСГАРД‑Сервис»"))} • CRM</div>
          <div class="h2">${esc(subtitle||"Внутренний документ")}</div>
        </div>
      </div>
      <div class="box">
        <div class="h1">${esc(title||"Документ")}</div>
        <div class="muted">${esc(new Date().toLocaleDateString("ru-RU"))}</div>
        <div class="rune"></div>
        ${bodyHtml||""}
        <div class="rune"></div>
        ${footerHtml||""}
        <div class="sig">
          <div>
            <div class="muted">Подпись</div>
            <div class="line"></div>
          </div>
          <div class="stamp">Директор: ${esc(c.director_fio||"")}</div>
        </div>
      </div>
    </div></body></html>`;
  }

  async function buildClientRequest({tender, estimate, extraText=""}){
    const ds = await getDocsSettings();
    const company = await getCompany();
    const logo = await loadLogoDataUrl();
    const body = `
      <div class="p"><b>Кому:</b> ${esc(tender?.customer_name||"")}</div>
      <div class="p"><b>Тема:</b> Запрос уточнений по закупке / объекту работ</div>
      <div class="p">Просим предоставить уточняющие данные и/или документы, необходимые для корректного расчёта и подготовки предложения.</div>
      <div class="p"><b>Закупка / ссылка:</b> ${tender?.purchase_url ? `<span>${esc(tender.purchase_url)}</span>` : `<span class="muted">не указано</span>`}</div>
      <div class="p"><b>Плановые сроки работ:</b> ${esc(tender?.work_start_plan||"—")} — ${esc(tender?.work_end_plan||"—")}</div>
      <div class="p">${esc(extraText||ds.request_extra||"")}</div>
      <div class="p" style="margin-top:14px"><b>Контакты:</b> ${esc(ds.contacts||"")} </div>
    `;
    const footer = `<div class="muted">Примечание: документ сформирован в тестовой сборке CRM (офлайн). Ссылки/вложения прикладываются отдельно.</div>`;
    return wrapLetter({title:"Запрос клиенту", subtitle:"Видим цель. Берём след. Ведём до победы.", bodyHtml:body, footerHtml:footer, logoDataUrl:logo, company});
  }

  async function buildTKP({tender, estimate, extraText=""}){
    const ds = await getDocsSettings();
    const company = await getCompany();
    const logo = await loadLogoDataUrl();
    const price = estimate?.price_tkp ?? tender?.tender_price ?? "";
    const vat = Number(ds.vat_pct ?? 20);
    const n = Number(price||0);
    const withVat = (Number.isFinite(n) && n>0) ? Math.round(n*(1+vat/100)) : "";
    const body = `
      <div class="p"><b>Заказчик:</b> ${esc(tender?.customer_name||"")}</div>
      <div class="p"><b>Работа:</b> ${esc(tender?.tender_title||"")}</div>
      <div class="p"><b>Период:</b> ${esc(tender?.work_start_plan||"—")} — ${esc(tender?.work_end_plan||"—")}</div>
      <div class="p"><b>Цена (без НДС):</b> ${esc(price||"—")}</div>
      <div class="p"><b>НДС, %:</b> ${esc(vat)}</div>
      <div class="p"><b>Цена (с НДС):</b> ${esc(withVat||"—")}</div>
      <div class="p"><b>Условия оплаты:</b> ${esc(estimate?.payment_terms||ds.payment_terms||"")}</div>
      <div class="p">${esc(extraText||ds.tkp_extra||"")}</div>
      <div class="p" style="margin-top:14px"><b>Контакты:</b> ${esc(ds.contacts||"")} </div>
    `;
    const footer = `<div class="muted">Примечание: тестовый шаблон. Финальная ведомость работ/смета подключается в следующей итерации.</div>`;
    return wrapLetter({title:"Технико‑коммерческое предложение (ТКП)", subtitle:"Счёт точен. Решение крепко. Ошибки не проходят.", bodyHtml:body, footerHtml:footer, logoDataUrl:logo, company});
  }

  async function buildCoverLetter({tender, estimate, subject="", bodyText=""}){
    const ds = await getDocsSettings();
    const company = await getCompany();
    const logo = await loadLogoDataUrl();
    const subj = subject || ds.cover_subject || "Сопроводительное письмо";
    const body = `
      <div class="p"><b>Кому:</b> ${esc(tender?.customer_name||"")}</div>
      <div class="p"><b>Тема:</b> ${esc(subj)}</div>
      <div class="p">${esc(bodyText || ds.cover_body || "Направляем документы/материалы по обращению. Готовы оперативно ответить на вопросы и уточнения.")}</div>
      <div class="p"><b>Работа / закупка:</b> ${esc(tender?.tender_title||"—")}</div>
      <div class="p"><b>Ссылка на площадку:</b> ${tender?.purchase_url ? `<span>${esc(tender.purchase_url)}</span>` : `<span class="muted">не указано</span>`}</div>
      <div class="p" style="margin-top:14px"><b>Контакты:</b> ${esc(ds.contacts||"")} </div>
    `;
    const footer = `<div class="muted">Примечание: тестовый шаблон. Вложения прикладываются отдельными файлами/ссылками.</div>`;
    return wrapLetter({title:"Сопроводительное письмо", subtitle:"Слово Ярла — закон. Счёт должен быть чист.", bodyHtml:body, footerHtml:footer, logoDataUrl:logo, company});
  }

  async function downloadRequest(tender, estimate){
    const html = await buildClientRequest({tender, estimate});
    const name = `ASGARD_Request_${(tender?.id||"")}_${new Date().toISOString().slice(0,10)}.html`;
    downloadFile(name, "text/html;charset=utf-8", html);
    toast("Готово","Запрос скачан");
  }

  async function downloadTKP(tender, estimate){
    const html = await buildTKP({tender, estimate});
    const name = `ASGARD_TKP_${(tender?.id||"")}_v${estimate?.version_no||1}_${new Date().toISOString().slice(0,10)}.html`;
    downloadFile(name, "text/html;charset=utf-8", html);
    toast("Готово","ТКП скачано");
  }

  async function downloadCover(tender, estimate){
    const html = await buildCoverLetter({tender, estimate});
    const name = `ASGARD_Cover_${(tender?.id||"")}_${new Date().toISOString().slice(0,10)}.html`;
    downloadFile(name, "text/html;charset=utf-8", html);
    toast("Готово","Сопроводительное скачано");
  }

  async function ensureDefaultDocsSettings(){
    const cur = await getDocsSettings();
    if(cur && Object.keys(cur).length) return;
    const app = await AsgardDB.get("settings","app");
    const base = app ? JSON.parse(app.value_json||"{}") : {};
    const ds = {
      vat_pct: base.vat_pct ?? 20,
      contacts: "info@asgard-service.ru • +7 (___) ___‑__‑__",
      payment_terms: "Предоплата 50% перед выездом, остаток в течение 5 банковских дней после подписания акта.",
      request_extra: "Просим подтвердить условия доступа, требования по безопасности и контакт ответственного лица на площадке.",
      tkp_extra: "Цена включает персонал, инструмент Исполнителя, фотофиксацию и оформление отчёта. Реагенты/закупки — по факту.",
      cover_subject: "Сопроводительное письмо",
      cover_body: "Направляем материалы и документы по обращению. Готовы уточнить детали и оперативно ответить на вопросы.",
    };
    await setDocsSettings(ds);
  }

  return { getDocsSettings, setDocsSettings, ensureDefaultDocsSettings, buildClientRequest, buildTKP, buildCoverLetter, downloadRequest, downloadTKP, downloadCover };
})();
