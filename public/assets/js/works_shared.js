/**
 * ASGARD CRM — Общие утилиты модуля «Работы»
 * Подключается ПЕРЕД pm_works.js, all_works.js, kpi_works.js
 * Закрывает: F8, F9 (дедупликация), F2 (hardcoded HR), F5 (единая формула прибыли), F10 (Toast API)
 */
window.AsgardWorksShared = (function(){

  // ═══ Базовые утилиты (F9) ═══

  function isoNow(){ return new Date().toISOString(); }

  function ymNow(){
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
  }

  function num(x, fallback){
    if(x===null||x===undefined||x==="") return fallback !== undefined ? fallback : null;
    const n = Number(String(x).replace(/\s/g,"").replace(",", "."));
    return isNaN(n) ? (fallback !== undefined ? fallback : null) : n;
  }

  function safeJson(s, def){ if(Array.isArray(s)||(typeof s==='object'&&s!==null))return s; try{return JSON.parse(s||"");}catch(_){return def;} }

  function toDate(d){
    if(!d) return null;
    const s = String(d).trim();
    if(!s) return null;
    const m = s.match(/^\d{4}-\d{2}-\d{2}/);
    if(m){
      const y=+m[0].slice(0,4), mo=+m[0].slice(5,7), da=+m[0].slice(8,10);
      return new Date(Date.UTC(y, mo-1, da, 0,0,0));
    }
    const dt = new Date(s);
    return isFinite(dt.getTime()) ? dt : null;
  }

  function diffDays(a, b){
    const da = toDate(a), db = toDate(b);
    if(!da||!db) return null;
    return Math.round((db.getTime()-da.getTime())/(24*3600*1000));
  }

  function daysBetween(a, b){
    const d = diffDays(a, b);
    return d !== null ? d + 1 : null;
  }

  function pctDelta(fact, plan){
    const p = Number(plan||0), f = Number(fact||0);
    if(!isFinite(p) || p<=0) return null;
    return ((f-p)/p)*100;
  }

  function workDate(value){
    return value ? (AsgardUI.formatDate ? AsgardUI.formatDate(value) : new Date(value).toLocaleDateString('ru-RU')) : "\u2014";
  }

  // ═══ Период (F8) ═══

  function generatePeriodOptions(currentYm) {
    const now = new Date();
    let html = '<option value="">Все</option>';
    for (let i = 0; i < 24; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
      html += `<option value="${val}"${val === currentYm ? ' selected' : ''}>${label}</option>`;
    }
    return html;
  }

  // ═══ Единая формула прибыли (F5) ═══

  function calcProfit(work) {
    const contract = num(work.contract_value) || 0;
    const cost = work.cost_fact != null ? num(work.cost_fact) : num(work.cost_plan);
    if (!contract || cost === null) return null;
    return contract - cost;
  }

  function calcProfitPerDay(work) {
    const profit = calcProfit(work);
    if (profit === null) return null;
    const start = work.start_in_work_date || work.start_plan;
    const end = work.end_fact || work.end_plan;
    const days = daysBetween(start, end);
    return (days && days > 0) ? profit / days : null;
  }

  function calcProfitPerManDay(work) {
    const profit = calcProfit(work);
    if (profit === null) return null;
    const start = work.start_in_work_date || work.start_plan;
    const end = work.end_fact || work.end_plan;
    const days = daysBetween(start, end);
    const crew = num(work.crew_size) || 1;
    return (days && days > 0) ? profit / (crew * days) : null;
  }

  // ═══ HR lookup по роли, не по login (F2) ═══

  async function findHrUserId(){
    const users = await AsgardDB.all("users");
    const hr = (users||[]).find(u => u.is_active &&
      (u.role === 'HR' || u.role === 'HR_MANAGER' || (Array.isArray(u.roles) && u.roles.includes('HR'))));
    return hr ? hr.id : null;
  }

  // ═══ Audit & Notify (F9) ═══

  async function audit(actorId, entityType, entityId, action, payload){
    await AsgardDB.add("audit_log",{
      actor_user_id: actorId, entity_type: entityType, entity_id: entityId,
      action, payload_json: JSON.stringify(payload||{}), created_at: isoNow()
    });
  }

  async function notify(userId, title, body, linkHash){
    if(!userId) return;
    await AsgardDB.add("notifications",{
      user_id: userId, title: String(title||""), message: String(body||""),
      link_hash: String(linkHash||""), is_read: false, created_at: isoNow()
    });
  }

  async function notifyDirectors(title, message, linkHash){
    const users = await AsgardDB.all("users");
    const isDirRole = (r) => (window.AsgardAuth && AsgardAuth.isDirectorRole)
      ? AsgardAuth.isDirectorRole(r)
      : (String(r||"") === "DIRECTOR" || String(r||"").startsWith("DIRECTOR_"));
    const directors = (users||[]).filter(u => u && u.is_active && isDirRole(u.role));
    for(const d of directors){ await notify(d.id, title, message, linkHash); }
  }

  // ═══ Сортировка (F9) ═══

  function sortBy(key, dir){
    return (a,b) => {
      const av = (a[key] ?? ""), bv = (b[key] ?? "");
      if(typeof av === "number" && typeof bv === "number") return dir * (av - bv);
      return dir * String(av).localeCompare(String(bv), "ru", {sensitivity:"base"});
    };
  }

  // ═══ Toast API (F10) ═══

  function showToast(title, message, type) {
    if (AsgardUI && AsgardUI.toast) {
      AsgardUI.toast(title, message || '', type || 'ok');
    }
  }

  return {
    isoNow, ymNow, num, safeJson, toDate, diffDays, daysBetween,
    pctDelta, workDate, generatePeriodOptions,
    calcProfit, calcProfitPerDay, calcProfitPerManDay,
    findHrUserId, audit, notify, notifyDirectors, sortBy, showToast
  };
})();
