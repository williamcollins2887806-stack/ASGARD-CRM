// Stage 6: booking + conflict checks for workers schedule
window.AsgardBooking = (function(){
  const dayMs = 24*60*60*1000;

  function ymd(d){
    const x = (d instanceof Date) ? new Date(d) : new Date(String(d));
    if(isNaN(x.getTime())) return null;
    const y=x.getFullYear();
    const m=String(x.getMonth()+1).padStart(2,'0');
    const dd=String(x.getDate()).padStart(2,'0');
    return `${y}-${m}-${dd}`;
  }
  function startOfDay(d){ const x=new Date(d); x.setHours(0,0,0,0); return x; }
  function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }

  function listDates(startIso, endIso){
    const s = startOfDay(new Date(String(startIso)));
    const e = startOfDay(new Date(String(endIso)));
    if(isNaN(s.getTime())||isNaN(e.getTime())) return [];
    if(e < s) return [];
    const out=[];
    for(let t=s.getTime(); t<=e.getTime(); t+=dayMs){
      out.push(ymd(new Date(t)));
    }
    return out;
  }

  async function getAppSettings(){
    const s = await AsgardDB.get('settings','app');
    try{ return s ? JSON.parse(s.value_json||'{}') : {}; }catch(_){ return {}; }
  }

  async function getWorkDateRange(work){
    // Prefer explicit work dates, then tender plan dates
    if(!work) return {start:null,end:null};
    let start = work.start_in_work_date || work.start_plan || null;
    let end = work.end_fact || work.end_plan || null;
    if(!start || !end){
      try{
        const t = work.tender_id ? await AsgardDB.get('tenders', work.tender_id) : null;
        if(!start) start = t?.work_start_plan || null;
        if(!end) end = t?.work_end_plan || null;
      }catch(_){ }
    }
    return { start:start?String(start).slice(0,10):null, end:end?String(end).slice(0,10):null };
  }

  async function findConflictsForEmployees(employeeIds, dates, workId){
    const all = await AsgardDB.all('employee_plan');
    const byEmp = new Map();
    for(const id of employeeIds){ byEmp.set(id, []); }

    const dateSet = new Set(dates||[]);
    (all||[]).forEach(rec=>{
      if(!rec || !rec.employee_id || !rec.date) return;
      if(!byEmp.has(rec.employee_id)) return;
      if(!dateSet.has(rec.date)) return;
      const k = String(rec.kind||'');
      // Занятость: "Работа" и "Запас" блокируют подбор/замены
      if(!(k === 'work' || k === 'reserve')) return;
      const wid = Number(rec.work_id||0);
      if(wid && Number(wid) === Number(workId||0)) return;
      byEmp.get(rec.employee_id).push(rec);
    });

    const conflicts=[];
    for(const [empId, rows] of byEmp.entries()){
      if(rows.length){
        const uniq = new Map();
        rows.forEach(r=>{
          const k = `${r.date}|${r.work_id||''}`;
          if(!uniq.has(k)) uniq.set(k, r);
        });
        conflicts.push({ employee_id: empId, rows: Array.from(uniq.values()).sort((a,b)=>String(a.date).localeCompare(String(b.date))) });
      }
    }
    return conflicts;
  }

  async function bookEmployeesForDates({employeeIds, dates, work, staff_request_id, actor_user_id, note}){
    if(!work || !work.id) return { ok:false, error:'NO_WORK' };
    if(!Array.isArray(dates) || !dates.length) return { ok:false, error:'NO_DATES' };

    const app = await getAppSettings();
    const blockOnConflict = (app.schedules && app.schedules.block_on_conflict!==false);
    const conflicts = await findConflictsForEmployees(employeeIds, dates, work.id);
    if(blockOnConflict && conflicts.length){
      return { ok:false, error:'CONFLICT', conflicts };
    }

    const existing = await AsgardDB.all('employee_plan');
    const existingByKey = new Map();
    (existing||[]).forEach(r=>{ if(r && r.employee_id && r.date){ existingByKey.set(`${r.employee_id}|${r.date}`, r); } });

    let written=0;
    for(const empId of employeeIds){
      for(const d of dates){
        const key = `${empId}|${d}`;
        const cur = existingByKey.get(key);
        if(cur) await AsgardDB.del('employee_plan', cur.id);
        await AsgardDB.add('employee_plan', {
          employee_id: empId,
          date: d,
          kind: 'work',
          work_id: work.id,
          note: note || '',
          source: 'staff_request',
          staff_request_id: staff_request_id || null,
          locked: true,
          updated_at: new Date().toISOString()
        });
        written++;
      }
    }

    // Attach roster to work (union)
    try{
      const prev = (()=>{ try{return JSON.parse(work.staff_ids_json||'[]');}catch(_){return [];} })();
      const set = new Set([...(prev||[]), ...(employeeIds||[])]);
      work.staff_ids_json = JSON.stringify(Array.from(set));
      work.updated_at = new Date().toISOString();
      await AsgardDB.put('works', work);
    }catch(_){ }

    try{
      await AsgardDB.add('audit_log', {
        actor_user_id: actor_user_id || null,
        entity_type: 'staff_request',
        entity_id: staff_request_id || null,
        action: 'auto_book_dates',
        payload_json: JSON.stringify({ work_id: work.id, employees: employeeIds, dates_count: dates.length, note: note||'' }),
        created_at: new Date().toISOString()
      });
    }catch(_){ }

    return { ok:true, written, dates_count: dates.length };
  }

  async function bookEmployeesForWork({employeeIds, work, staff_request_id, actor_user_id}){
    const { start, end } = await getWorkDateRange(work);
    if(!start || !end) return { ok:false, error:'NO_DATES', start, end };

    const dates = listDates(start, end);
    if(!dates.length) return { ok:false, error:'NO_DATES', start, end };

    const app = await getAppSettings();
    const blockOnConflict = (app.schedules && app.schedules.block_on_conflict!==false);

    const conflicts = await findConflictsForEmployees(employeeIds, dates, work.id);
    if(blockOnConflict && conflicts.length){
      return { ok:false, error:'CONFLICT', start, end, conflicts };
    }

    // Upsert plans per day (replace any existing record for that day)
    const existing = await AsgardDB.all('employee_plan');
    const existingByKey = new Map();
    (existing||[]).forEach(r=>{
      if(r && r.employee_id && r.date){ existingByKey.set(`${r.employee_id}|${r.date}`, r); }
    });

    let written=0;
    for(const empId of employeeIds){
      for(const d of dates){
        const key = `${empId}|${d}`;
        const cur = existingByKey.get(key);
        if(cur) await AsgardDB.del('employee_plan', cur.id);
        await AsgardDB.add('employee_plan', {
          employee_id: empId,
          date: d,
          kind: 'work',
          work_id: work.id,
          note: '',
          source: 'staff_request',
          staff_request_id: staff_request_id || null,
          locked: true,
          updated_at: new Date().toISOString()
        });
        written++;
      }
    }

    // Attach roster to work (for later rating etc.)
    try{
      work.staff_ids_json = JSON.stringify(employeeIds);
      work.updated_at = new Date().toISOString();
      await AsgardDB.put('works', work);
    }catch(_){ }

    // Audit
    try{
      await AsgardDB.add('audit_log', {
        actor_user_id: actor_user_id || null,
        entity_type: 'staff_request',
        entity_id: staff_request_id || null,
        action: 'auto_book',
        payload_json: JSON.stringify({ work_id: work.id, start, end, employees: employeeIds }),
        created_at: new Date().toISOString()
      });
    }catch(_){ }

    return { ok:true, start, end, written };
  }

  return {
    ymd,
    listDates,
    getWorkDateRange,
    findConflictsForEmployees,
    bookEmployeesForWork,
    bookEmployeesForDates
  };
})();
