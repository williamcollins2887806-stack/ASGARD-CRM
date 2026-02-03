// SLA engine (stage 3 - minimal): deadlines, workday math, notification generation.
// No server, no timers: tick() runs on navigation (router) and is idempotent per day.

window.AsgardSLA = (function(){
  function isoNow(){ return new Date().toISOString(); }

  function toDate(d){
    if(!d) return null;
    if(d instanceof Date) return d;
    const s=String(d).trim();
    if(!s) return null;
    // Accept YYYY-MM-DD or ISO.
    const m=s.match(/^\d{4}-\d{2}-\d{2}/);
    if(m){
      const [y,mo,da]=m[0].split('-').map(Number);
      return new Date(Date.UTC(y,mo-1,da,0,0,0));
    }
    const dt=new Date(s);
    return isFinite(dt.getTime()) ? dt : null;
  }

  function dayKey(d){
    const dt = (d instanceof Date) ? d : new Date();
    const y=dt.getFullYear();
    const m=String(dt.getMonth()+1).padStart(2,'0');
    const da=String(dt.getDate()).padStart(2,'0');
    return `${y}-${m}-${da}`;
  }

  function isWeekend(d){
    const dt = (d instanceof Date) ? d : toDate(d);
    if(!dt) return false;
    const w = dt.getDay();
    return w===0 || w===6; // Sun / Sat
  }

  function addWorkdays(base, workdays){
    const b = toDate(base);
    if(!b) return null;
    let n = Number(workdays||0);
    if(!Number.isFinite(n)) n=0;
    // Workdays are added forward; 0 returns same date.
    let dt = new Date(b.getTime());
    while(n>0){
      dt.setUTCDate(dt.getUTCDate()+1);
      if(!isWeekend(dt)) n--;
    }
    return dt;
  }

  async function getApp(){
    const s = await AsgardDB.get('settings','app');
    const v = s ? JSON.parse(s.value_json||'{}') : {};
    v.sla = v.sla || {};
    v.limits = v.limits || {};
    // Defaults per TZ / typical policy.
    v.sla.docs_deadline_notice_days = Number.isFinite(v.sla.docs_deadline_notice_days) ? v.sla.docs_deadline_notice_days : 5;
    v.sla.direct_request_deadline_days = Number.isFinite(v.sla.direct_request_deadline_days) ? v.sla.direct_request_deadline_days : 5;
    v.sla.birthday_notice_days = Number.isFinite(v.sla.birthday_notice_days) ? v.sla.birthday_notice_days : 5;
    v.sla.pm_calc_due_workdays = Number.isFinite(v.sla.pm_calc_due_workdays) ? v.sla.pm_calc_due_workdays : 3;
    v.sla.director_approval_due_workdays = Number.isFinite(v.sla.director_approval_due_workdays) ? v.sla.director_approval_due_workdays : 2;
    v.sla.pm_rework_due_workdays = Number.isFinite(v.sla.pm_rework_due_workdays) ? v.sla.pm_rework_due_workdays : 1;
    v.limits.pm_active_calcs_limit = Number.isFinite(v.limits.pm_active_calcs_limit) ? v.limits.pm_active_calcs_limit : 6;
    v.limits.pm_active_calcs_done_statuses = (typeof v.limits.pm_active_calcs_done_statuses==="string" ? v.limits.pm_active_calcs_done_statuses : "").trim() || "Согласование ТКП, Клиент согласился, Клиент отказался";
    return v;
  }

  async function listUsers(){
    const users = await AsgardDB.all('users');
    return (users||[]).filter(u=>u && u.is_active);
  }

  function mkDedup({kind, entity_type, entity_id, day}){
    return `sla:${kind}:${entity_type}:${entity_id}:${day}`;
  }

  async function alreadyNotified(user_id, dedup_key){
    const nots = await AsgardDB.byIndex('notifications','user_id', user_id);
    return (nots||[]).some(n=>n && n.dedup_key===dedup_key);
  }

  async function notifyOnce({user_id, title, message, link_hash, kind, entity_type, entity_id, day}){
    const dedup_key = mkDedup({kind, entity_type, entity_id, day});
    if(await alreadyNotified(user_id, dedup_key)) return false;
    await AsgardDB.add('notifications', {
      user_id,
      is_read:false,
      created_at: isoNow(),
      title,
      message,
      link_hash: link_hash || '#/alerts',
      kind,
      entity_type,
      entity_id,
      day_key: day,
      dedup_key
    });
    return true;
  }

  function diffDaysUTC(a,b){
    const da=toDate(a); const db=toDate(b);
    if(!da||!db) return null;
    const ms = (db.getTime()-da.getTime());
    return Math.floor(ms/(24*3600*1000));
  }

  async function tick(currentUser){
    if(!currentUser || !currentUser.id) return;

    const app = await getApp();
    const sla = app.sla;
    const today = dayKey(new Date());

    // Fetch core entities once.
    const [users, tenders, estimates] = await Promise.all([
      listUsers(),
      AsgardDB.all('tenders'),
      AsgardDB.all('estimates')
    ]);
    const tos = users.filter(u=> (u.role==='TO') || (Array.isArray(u.roles) && u.roles.includes('TO')) );
    const directors = users.filter(u=>{
      if(window.AsgardAuth && AsgardAuth.isDirectorRole){
        const roles = Array.isArray(u.roles) ? u.roles : [u.role];
        return roles.some(r=>AsgardAuth.isDirectorRole(r));
      }
      const roles = Array.isArray(u.roles) ? u.roles : [u.role];
      return roles.some(r=>(r==='DIRECTOR'||String(r||'').startsWith('DIRECTOR_')));
    });
    const byId = new Map(users.map(u=>[u.id,u]));

    // Index estimates by tender_id.
    const estByTender = new Map();
    for(const e of (estimates||[])){
      if(!e || e.tender_id==null) continue;
      const arr = estByTender.get(e.tender_id) || [];
      arr.push(e);
      estByTender.set(e.tender_id, arr);
    }
    for(const [tid, arr] of estByTender.entries()){
      arr.sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
    }

    // A) Дедлайн заявки: напоминания (ежедневно в последние N дней).
    for(const t of (tenders||[])){
      const dl = toDate(t.docs_deadline);
      if(!dl) continue;
      const daysLeft = diffDaysUTC(new Date(), dl);
      if(daysLeft==null) continue;
      if(daysLeft<0) continue; // already missed (will be covered by separate overdue stage later)
      if(daysLeft > sla.docs_deadline_notice_days) continue;      const recipients = new Set();
      // По ТЗ: напоминания по дедлайну получают все TO и директора; РП — только по своим просчётам (если назначен).
      for(const u of tos) recipients.add(u.id);
      for(const u of directors) recipients.add(u.id);
      if(t.responsible_pm_id && byId.get(t.responsible_pm_id)) recipients.add(t.responsible_pm_id);
      const recU = Array.from(recipients);
      for(const uid of recU){
        await notifyOnce({
          user_id: uid,
          title: 'Срок подачи документов',
          message: `Тендер #${t.id}: осталось ${daysLeft} дн. (до ${String(t.docs_deadline)})`,
          link_hash: '#/tenders',
          kind: 'docs_deadline',
          entity_type: 'tender',
          entity_id: t.id,
          day: today
        });
      }
    }

    // B) PM: due for initial estimate after handoff (daily reminders + escalation to directors on overdue).
    for(const t of (tenders||[])){
      if(!t || !t.handoff_at) continue;
      const pmId = t.responsible_pm_id;
      if(!pmId) continue;
      const pm = byId.get(pmId);
      if(!pm || pm.role!=='PM') continue;

      const estList = estByTender.get(t.id) || [];
      const hasAnyEstimate = estList.some(e=>e && e.pm_id===pmId);
      if(hasAnyEstimate) continue;

      const due = addWorkdays(t.handoff_at, sla.pm_calc_due_workdays);
      if(!due) continue;
      const overdue = (new Date()).getTime() > due.getTime();

      // PM daily reminder until estimate exists.
      await notifyOnce({
        user_id: pmId,
        title: 'Требуется просчёт',
        message: `Тендер #${t.id}: нет просчёта. Срок: ${due.toLocaleDateString('ru-RU')}.`,
        link_hash: '#/pm-calcs',
        kind: 'pm_calc_due',
        entity_type: 'tender',
        entity_id: t.id,
        day: today
      });

      // Escalation to directors only if overdue.
      if(overdue){
        for(const d of directors){
          await notifyOnce({
            user_id: d.id,
            title: 'Просрочка просчёта',
            message: `Тендер #${t.id}: РП ${pm.name||pm.login||pmId} просрочил просчёт (срок был ${due.toLocaleDateString('ru-RU')}).`,
            link_hash: '#/pm-calcs',
            kind: 'pm_calc_overdue',
            entity_type: 'tender',
            entity_id: t.id,
            day: today
          });
        }
      }
    }

    // C) DIRECTOR: approval due for sent estimates (daily reminder when overdue).
    for(const e of (estimates||[])){
      if(!e || e.approval_status!=='sent') continue;
      const base = e.sent_for_approval_at || e.created_at;
      const due = addWorkdays(base, sla.director_approval_due_workdays);
      if(!due) continue;
      const overdue = (new Date()).getTime() > due.getTime();
      if(!overdue) continue;
      for(const d of directors){
        await notifyOnce({
          user_id: d.id,
          title: 'Просрочка согласования',
          message: `Просчёт #${e.id} (тендер #${e.tender_id}): просрочено согласование. Срок был ${due.toLocaleDateString('ru-RU')}.`,
          link_hash: '#/approvals',
          kind: 'approval_overdue',
          entity_type: 'estimate',
          entity_id: e.id,
          day: today
        });
      }
    }

    // D) PM: rework/question due (daily reminder if overdue).
    for(const e of (estimates||[])){
      if(!e) continue;
      if(!(e.approval_status==='rework' || e.approval_status==='question')) continue;
      const base = e.rework_requested_at || e.decided_at || e.updated_at || e.created_at;
      const due = addWorkdays(base, sla.pm_rework_due_workdays);
      if(!due) continue;
      const overdue = (new Date()).getTime() > due.getTime();
      if(!overdue) continue;
      if(e.pm_id){
        await notifyOnce({
          user_id: e.pm_id,
          title: 'Просрочка доработки',
          message: `Просчёт #${e.id} (тендер #${e.tender_id}): доработка/ответ просрочены. Срок был ${due.toLocaleDateString('ru-RU')}.`,
          link_hash: '#/pm-calcs',
          kind: 'rework_overdue',
          entity_type: 'estimate',
          entity_id: e.id,
          day: today
        });
      }
    }

    // E) Birthdays (office users: store "users")
    // Offline mode: "ежедневно" = on app open / navigation tick.
    try{
      const app = await getApp();
      const N = Math.max(0, Math.round(Number(app?.sla?.birthday_notice_days ?? 5)));
      if(N>=0){
        const users = (await AsgardDB.all('users')) || [];
        const office = users.filter(u=>u && u.is_active && u.birth_date);

        const toDateYMD = (ymd)=>{
          const s=String(ymd||'').trim();
          const m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);
          if(!m) return null;
          const y=Number(m[1]), mo=Number(m[2]), d=Number(m[3]);
          return new Date(Date.UTC(y, mo-1, d, 0,0,0));
        };
        const dayKeyLocal = (dt)=>{
          const d = dt instanceof Date ? dt : new Date();
          const y=d.getFullYear();
          const m=String(d.getMonth()+1).padStart(2,'0');
          const da=String(d.getDate()).padStart(2,'0');
          return `${y}-${m}-${da}`;
        };
        const nextBirthday = (birth_ymd, now)=>{
          const b=toDateYMD(birth_ymd);
          if(!b) return null;
          const mm=b.getUTCMonth()+1;
          const dd=b.getUTCDate();
          const y = (now||new Date()).getFullYear();
          const today = toDateYMD(dayKeyLocal(now||new Date()));
          const thisYear = toDateYMD(`${y}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`);
          if(!thisYear) return null;
          if(!today) return thisYear;
          if(thisYear.getTime()>=today.getTime()) return thisYear;
          return toDateYMD(`${y+1}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`);
        };
        const diffDaysUTC = (a,b)=>Math.floor((b.getTime()-a.getTime())/(24*3600*1000));

        const todayLocal = dayKeyLocal(new Date());
        const todayUTC = toDateYMD(todayLocal);
        if(todayUTC){
          for(const b of office){
            const nb = nextBirthday(b.birth_date, new Date());
            if(!nb) continue;
            const days = diffDaysUTC(todayUTC, nb);
            if(days==null || days<0) continue;

            // recipients: all office users except birthday person
            const recipients = office.filter(u=>u.id && u.id!==b.id).map(u=>u.id);
            if(!recipients.length) continue;

            if(days===0){
              for(const uid of recipients){
                await notifyOnce({
                  user_id: uid,
                  title: 'День рождения сегодня',
                  message: `${b.name||b.login||'Сотрудник'}: сегодня день рождения 🎉`,
                  link_hash: '#/birthdays',
                  kind: 'birthday_today',
                  entity_type: 'user',
                  entity_id: b.id,
                  day: today
                });
              }
            }else if(days>0 && days<=N){
              for(const uid of recipients){
                await notifyOnce({
                  user_id: uid,
                  title: 'Скоро день рождения',
                  message: `${b.name||b.login||'Сотрудник'}: через ${days} дн. (${nb.toLocaleDateString('ru-RU')})`,
                  link_hash: '#/birthdays',
                  kind: 'birthday_soon',
                  entity_type: 'user',
                  entity_id: b.id,
                  day: today
                });
              }
            }
          }
        }
      }

    // F) Birthdays (workers: store "employees")
    // Recipients: HR + Directors only.
    try{
      const usersAll = (await AsgardDB.all("users")) || [];
      const recipients = usersAll
        .filter(u=>u && u.is_active && (String(u.role||"" ).toUpperCase()==="HR" || String(u.role||"" ).toUpperCase()==="DIRECTOR" || String(u.role||"" ).toUpperCase().startsWith("DIRECTOR_")))
        .map(u=>u.id)
        .filter(Boolean);
      if(recipients.length){
        const emps = (await AsgardDB.all("employees")) || [];
        const todayLocal2 = dayKeyLocal(new Date());
        const todayUTC2 = toDateYMD(todayLocal2);
        if(todayUTC2){
          for(const e of emps){
            const bday = e && e.birth_date ? String(e.birth_date) : "";
            if(!bday) continue;
            const nb = nextBirthday(bday, new Date());
            if(!nb) continue;
            const days = diffDaysUTC(todayUTC2, nb);
            if(days==null || days<0) continue;
            const who = e.fio || e.full_name || e.name || (e.id?`Сотрудник #${e.id}`:"Сотрудник");
            if(days===0){
              for(const uid of recipients){
                await notifyOnce({
                  user_id: uid,
                  title: "День рождения (рабочие)",
                  message: `${who}: сегодня день рождения 🎉`,
                  link_hash: "#/birthdays?tab=workers",
                  kind: "emp_birthday_today",
                  entity_type: "employee",
                  entity_id: e.id,
                  day: today
                });
              }
            }else if(days>0 && days<=N){
              for(const uid of recipients){
                await notifyOnce({
                  user_id: uid,
                  title: "Скоро день рождения (рабочие)",
                  message: `${who}: через ${days} дн. (${nb.toLocaleDateString("ru-RU")})`,
                  link_hash: "#/birthdays?tab=workers",
                  kind: "emp_birthday_soon",
                  entity_type: "employee",
                  entity_id: e.id,
                  day: today
                });
              }
            }
          }
        }
      }
    }catch(_){ /* best-effort */ }

    }catch(_){ /* best-effort */ }
  }

  return { tick, addWorkdays };
})();
