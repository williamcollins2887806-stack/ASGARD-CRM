(function(){
  const { $, $$, esc, toast, showModal, hideModal } = AsgardUI;

  const ROLE_LIST = ["ИТР","Мастер","Слесарь","Промывщик","ПТО","Химик","Сварщик","Разнорабочий"];

  function safeParse(s, fallback){
    try{
      const v = JSON.parse(s);
      return (v && typeof v === "object") ? v : fallback;
    }catch(_){ return fallback; }
  }
  function num(v, d=0){
    const n = Number(String(v??"").replace(/\s/g, "").replace(",","."));
    return Number.isFinite(n) ? n : d;
  }
  function money(n){
    const x = Math.round(Number(n||0));
    return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " ₽";
  }
  function clamp(n,min,max){ return Math.min(max, Math.max(min, n)); }

  async function getAppSettings(){
    const s = await AsgardDB.get("settings","app");
    return s || {};
  }
  function defaultsFromSettings(app){
    const c = (app.calc||{});
    const roleRates = c.role_rates || {};
    const roles = ROLE_LIST.map(r=>({role:r, count:0, rate:num(roleRates[r], 5000)}));
    return {
      work_days: 10,
      prep_days: 0,
      prep_people: 0,
      prep_rate: num(c.prep_rate_per_day, 3500),
      city: "",
      distance_km: 0,
      per_diem: 0,
      lodging_per_person_day: 0,
      lodging_total: 0,
      ppe_per_person: 0,
      mobilizations: [ {label:"Мобилизация 1", people:0, cost_per_person:0} ],
      roles,
      system_volume_m3: 0,
      chemical_id: (c.chemicals?.[0]?.id) || "",
      equipment: [],
      transport_id: "AUTO",
      margin_pct: 20,
      vat_pct: num(app.vat_pct, 20)
    };
  }

  function mergeState(base, saved){
    if(!saved || typeof saved!=="object") return base;
    const next = structuredClone(base);
    const keys = Object.keys(base);
    keys.forEach(k=>{
      if(saved[k] !== undefined) next[k] = saved[k];
    });
    // normalize arrays
    if(Array.isArray(saved.roles)){
      const map = new Map(saved.roles.map(r=>[r.role, r]));
      next.roles = base.roles.map(r=>{
        const s = map.get(r.role);
        return s ? {role:r.role, count:num(s.count,0), rate:num(s.rate,r.rate)} : r;
      });
    }
    if(Array.isArray(saved.mobilizations)) next.mobilizations = saved.mobilizations.map(m=>({label:String(m.label||""), people:num(m.people,0), cost_per_person:num(m.cost_per_person,0)}));
    if(Array.isArray(saved.equipment)) next.equipment = saved.equipment.map(e=>({
      name:String(e.name||""),
      kind:String(e.kind||"own"),
      cost:num(e.cost,0),
      rate_per_day:num(e.rate_per_day,0),
      amort:num(e.amort,0),
      weight_kg:num(e.weight_kg,0),
      volume_m3:num(e.volume_m3,0)
    }));
    return next;
  }

  function compute(state, app){
    const c = app.calc || {};
    const overhead_pct = num(c.overhead_pct, 10);
    const fot_tax_pct = num(c.fot_tax_pct, 50);
    const profit_tax_pct = num(c.profit_tax_pct, 20);
    const min_ppd = num(c.min_profit_per_person_day, 25000);

    const workDays = clamp(num(state.work_days, 0), 0, 365);
    const prepDays = clamp(num(state.prep_days, 0), 0, 365);
    const totalDays = workDays + prepDays;

    const roleRows = (state.roles||[]).map(r=>({role:r.role, count:clamp(num(r.count,0),0,999), rate:num(r.rate,0)}));
    const peopleWork = roleRows.reduce((s,r)=>s+r.count,0);
    const payrollWork = roleRows.reduce((s,r)=>s + r.count*r.rate*workDays, 0);

    const prepPeople = clamp(num(state.prep_people,0),0,999);
    const prepRate = num(state.prep_rate, num(c.prep_rate_per_day,3500));
    const payrollPrep = prepPeople*prepRate*prepDays;

    const payrollTotal = payrollWork + payrollPrep;

    const perDiem = num(state.per_diem,0) * totalDays * peopleWork;
    const lodgingPPD = num(state.lodging_per_person_day,0);
    let lodging = lodgingPPD * totalDays * peopleWork;
    if(!lodging) lodging = num(state.lodging_total,0);
    const ppe = num(state.ppe_per_person,0) * peopleWork;
    const mobilization = (state.mobilizations||[]).reduce((s,m)=>s + num(m.people,0)*num(m.cost_per_person,0),0);

    // Chemistry
    const chemList = (c.chemicals||[]);
    const chem = chemList.find(x=>String(x.id)===String(state.chemical_id)) || chemList[0] || null;
    const vol = num(state.system_volume_m3,0);
    const chemKg = chem ? vol * num(chem.kg_per_m3,0) : 0;
    const chemCost = chem ? chemKg * num(chem.price_per_kg,0) : 0;
    const chemVolM3 = chemKg/1000; // ~1 кг = 1 л

    // Equipment
    const eq = (state.equipment||[]).map(e=>({
      name:String(e.name||""),
      kind:String(e.kind||"own"),
      cost:num(e.cost,0),
      rate_per_day:num(e.rate_per_day,0),
      amort:num(e.amort,0),
      weight_kg:num(e.weight_kg,0),
      volume_m3:num(e.volume_m3,0)
    })).filter(e=>e.name.trim());

    const equipCost = eq.reduce((s,e)=>{
      if(e.kind==="buy") return s + e.cost;
      if(e.kind==="rent") return s + e.rate_per_day * workDays;
      return s + e.amort;
    },0);

    const equipWeight = eq.reduce((s,e)=>s+e.weight_kg,0);
    const equipVol = eq.reduce((s,e)=>s+e.volume_m3,0);

    const totalWeightKg = equipWeight + chemKg;
    const totalVolM3 = equipVol + chemVolM3;

    // Transport
    const dist = clamp(num(state.distance_km,0),0,200000);
    // Backward compatibility: older seeds used `transport`, newer settings use `transport_options`
    const trans = (c.transport_options || c.transport || []);
    let selected = null;
    if(String(state.transport_id) !== "AUTO"){
      selected = trans.find(t=>String(t.id)===String(state.transport_id)) || null;
    }
    if(!selected){
      // choose smallest that fits
      selected = trans
        .slice()
        .sort((a,b)=>(num(a.max_weight_t,0)-num(b.max_weight_t,0)) || (num(a.max_volume_m3,0)-num(b.max_volume_m3,0)))
        .find(t=> (totalWeightKg/1000)<=num(t.max_weight_t,0) && totalVolM3<=num(t.max_volume_m3,0))
        || trans[trans.length-1] || null;
    }
    const transRate = selected ? num(selected.rate_per_km,0) : 0;
    const logistics = transRate * dist * 2;

    const base = payrollTotal + perDiem + lodging + ppe + mobilization + chemCost + equipCost + logistics;
    const overhead = base * overhead_pct/100;
    const fotTax = payrollTotal * fot_tax_pct/100;
    const costTotal = base + overhead + fotTax;

    const m = clamp(num(state.margin_pct,0),0,95)/100;
    const pt = clamp(profit_tax_pct,0,99)/100;
    const denom = (1-pt) - m;
    const priceNoVat = denom>0 ? (costTotal*(1-pt))/denom : (costTotal*1.5);
    const profitBeforeTax = priceNoVat - costTotal;
    const netProfit = profitBeforeTax*(1-pt);
    const vatPct = clamp(num(state.vat_pct, num(app.vat_pct,20)),0,30);
    const priceWithVat = priceNoVat * (1 + vatPct/100);

    const ppd = (peopleWork>0 && workDays>0) ? (netProfit/(peopleWork*workDays)) : 0;

    return {
      ok: ppd >= min_ppd,
      min_ppd,
      workDays, prepDays, totalDays,
      peopleWork, payrollWork, payrollPrep, payrollTotal,
      perDiem, lodging, ppe, mobilization,
      chem: chem ? {id:chem.id, name:chem.name, kg_per_m3:num(chem.kg_per_m3,0), price_per_kg:num(chem.price_per_kg,0), volume_m3:vol, kg:chemKg, cost:chemCost} : null,
      equipment: eq,
      equipCost,
      equipment_total: equipCost,
      totalWeightKg,
      totalVolM3,
      transport: selected ? {id:selected.id, name:selected.name, max_weight_t:num(selected.max_weight_t,0), max_volume_m3:num(selected.max_volume_m3,0), rate_per_km:transRate} : null,
      dist,
      logistics,
      overhead_pct, overhead,
      fot_tax_pct, fotTax,
      profit_tax_pct,
      costTotal,
      margin_pct: num(state.margin_pct,0),
      priceNoVat,
      vatPct,
      priceWithVat,
      profitBeforeTax,
      netProfit,
      profit_per_person_day: ppd,
    };
  }

  function tabButton(id,label,active){
    return `<button class="tab ${active?"active":""}" data-tab="${esc(id)}" type="button">${esc(label)}</button>`;
  }

  function renderRoleTable(state){
    const rows = (state.roles||[]).map((r,idx)=>`
      <tr>
        <td style="white-space:nowrap">${esc(r.role)}</td>
        <td><input class="inp" data-role-idx="${idx}" data-k="count" name="role_${idx}_count" type="number" min="0" value="${esc(String(r.count??0))}"/></td>
        <td><input class="inp" data-role-idx="${idx}" data-k="rate" name="role_${idx}_rate" type="number" min="0" value="${esc(String(r.rate??0))}"/></td>
      </tr>
    `).join("");
    return `
      <table class="tbl">
        <thead><tr><th>Роль</th><th>Кол-во</th><th>Ставка, ₽/смена</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  function renderMobilizations(state){
    const rows = (state.mobilizations||[]).map((m,idx)=>`
      <tr>
        <td><input class="inp" data-mob-idx="${idx}" data-k="label" name="mob_${idx}_label" value="${esc(m.label||"")}"/></td>
        <td><input class="inp" data-mob-idx="${idx}" data-k="people" name="mob_${idx}_people" type="number" min="0" value="${esc(String(m.people??0))}"/></td>
        <td><input class="inp" data-mob-idx="${idx}" data-k="cost_per_person" name="mob_${idx}_cost_per_person" type="number" min="0" value="${esc(String(m.cost_per_person??0))}"/></td>
        <td><button class="btn ghost mini" data-mob-del="${idx}" type="button">Удалить</button></td>
      </tr>
    `).join("");
    return `
      <div class="help">Можно добавить несколько мобилизаций с разной ценой и количеством людей. Сумма считается <b>туда‑обратно</b> по введённой цене.</div>
      <table class="tbl">
        <thead><tr><th>Название</th><th>Людей</th><th>₽/чел (туда‑обратно)</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <button class="btn ghost" id="btnAddMob" type="button">+ Добавить мобилизацию</button>
    `;
  }

  function renderEquipment(state){
    const rows = (state.equipment||[]).map((e,idx)=>{
      const kind = String(e.kind||"own");
      const costCell = (kind==="buy")
        ? `<input class="inp" data-eq-idx="${idx}" data-k="cost" type="number" min="0" value="${esc(String(e.cost??0))}"/>`
        : (kind==="rent")
          ? `<input class="inp" data-eq-idx="${idx}" data-k="rate_per_day" type="number" min="0" value="${esc(String(e.rate_per_day??0))}"/>`
          : `<input class="inp" data-eq-idx="${idx}" data-k="amort" type="number" min="0" value="${esc(String(e.amort??0))}"/>`;
      const costLabel = (kind==="buy")?"Стоимость, ₽":(kind==="rent")?"₽/сутки":"Амортизация, ₽";
      return `
        <tr>
          <td><input class="inp" data-eq-idx="${idx}" data-k="name" value="${esc(e.name||"")}" placeholder="Насос, НВД, ..."/></td>
          <td>
            <select class="inp" data-eq-idx="${idx}" data-k="kind">
              <option value="own" ${kind==="own"?"selected":""}>Наше</option>
              <option value="rent" ${kind==="rent"?"selected":""}>Аренда</option>
              <option value="buy" ${kind==="buy"?"selected":""}>Покупка</option>
            </select>
          </td>
          <td>
            <div class="help" style="margin:0 0 4px">${esc(costLabel)}</div>
            ${costCell}
          </td>
          <td><input class="inp" data-eq-idx="${idx}" data-k="weight_kg" type="number" min="0" value="${esc(String(e.weight_kg??0))}"/></td>
          <td><input class="inp" data-eq-idx="${idx}" data-k="volume_m3" type="number" min="0" step="0.01" value="${esc(String(e.volume_m3??0))}"/></td>
          <td><button class="btn ghost mini" data-eq-del="${idx}" type="button">Удалить</button></td>
        </tr>
      `;
    }).join("");
    return `
      <div class="help">Для логистики укажите вес и объём (м³). Для «аренды» ставка умножается на дни работ.</div>
      <table class="tbl">
        <thead><tr><th>Позиция</th><th>Тип</th><th>Стоимость</th><th>Вес, кг</th><th>Объём, м³</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6" class="help">Пока нет позиций.</td></tr>`}</tbody>
      </table>
      <button class="btn ghost" id="btnAddEq" type="button">+ Добавить оборудование</button>
    `;
  }

  function renderChem(app, state){
    const list = app.calc?.chemicals || [];
    const opts = list.map(c=>`<option value="${esc(c.id)}" ${String(state.chemical_id)===String(c.id)?"selected":""}>${esc(c.name)} · ${esc(String(c.price_per_kg))}₽/кг · ${esc(String(c.kg_per_m3))}кг/м³</option>`).join("");
    return `
      <div class="formrow">
        <div><label>Объём системы, м³</label><input class="inp" id="c_sysvol" type="number" min="0" step="0.1" value="${esc(String(state.system_volume_m3??0))}"/></div>
        <div><label>Состав</label><select class="inp" id="c_chem">${opts}</select></div>
      </div>
      <div class="help" style="margin-top:8px">Расход химии считается по норме кг/м³. Вес химии и примерный объём автоматически попадают в логистику.</div>
    `;
  }

  function renderLogistics(app, state, summary){
    // Backward compatibility: older seeds used `transport`, newer settings use `transport_options`
    const list = app.calc?.transport_options || app.calc?.transport || [];
    const opts = [`<option value="AUTO" ${String(state.transport_id)==="AUTO"?"selected":""}>Авто‑подбор</option>`]
      .concat(list.map(t=>`<option value="${esc(t.id)}" ${String(state.transport_id)===String(t.id)?"selected":""}>${esc(t.name)} · до ${esc(String(t.max_weight_t))}т / ${esc(String(t.max_volume_m3))}м³ · ${esc(String(t.rate_per_km))}₽/км</option>`))
      .join("");
    return `
      <div class="formrow">
        <div><label>Город</label>
          <div style="display:flex;gap:8px">
            <input class="inp" id="c_city" value="${esc(state.city||"")}" placeholder="Город выполнения работ" style="flex:1"/>
            <button type="button" class="btn mini" id="btnCalcDist" title="Рассчитать расстояние">📍</button>
          </div>
        </div>
        <div><label>Расстояние, км (в одну сторону)</label><input class="inp" id="c_km" type="number" min="0" value="${esc(String(state.distance_km??0))}"/></div>
        <div><label>Транспорт</label><select class="inp" id="c_trans">${opts}</select></div>
      </div>
      <div class="kpi" style="grid-template-columns:repeat(4,minmax(160px,1fr)); margin-top:10px">
        <div class="k"><div class="t">Вес</div><div class="v">${esc(String(Math.round(summary.totalWeightKg||0)))} кг</div><div class="s">Химия + оборудование</div></div>
        <div class="k"><div class="t">Объём</div><div class="v">${esc(String((summary.totalVolM3||0).toFixed(2)))} м³</div><div class="s">Для подбора транспорта</div></div>
        <div class="k"><div class="t">Транспорт</div><div class="v">${esc(summary.transport? summary.transport.name : "—")}</div><div class="s">${esc(summary.transport? (summary.transport.rate_per_km+" ₽/км") : "")}</div></div>
        <div class="k"><div class="t">Логистика (туда‑обратно)</div><div class="v">${esc(money(summary.logistics||0))}</div><div class="s">км×2</div></div>
      </div>
    `;
  }

  function renderTotals(summary){
    const warn = summary.ok ? "" : `<div class="warn">Прибыль/чел‑день ниже нормы: <b>${esc(money(summary.profit_per_person_day||0))}</b> при минимуме <b>${esc(money(summary.min_ppd||0))}</b>. Сохранение будет заблокировано.</div>`;
    return `
      ${warn}
      <div class="kpi" style="grid-template-columns:repeat(4,minmax(180px,1fr)); margin-top:10px">
        <div class="k"><div class="t">Себестоимость (итог)</div><div class="v">${esc(money(summary.costTotal||0))}</div><div class="s">база + доп.расходы + ФОТ%</div></div>
        <div class="k"><div class="t">Цена ТКП без НДС</div><div class="v">${esc(money(summary.priceNoVat||0))}</div><div class="s">маржа по чистой прибыли</div></div>
        <div class="k"><div class="t">Цена ТКП с НДС</div><div class="v">${esc(money(summary.priceWithVat||0))}</div><div class="s">НДС ${esc(String(summary.vatPct||0))}%</div></div>
        <div class="k"><div class="t">Чистая прибыль</div><div class="v">${esc(money(summary.netProfit||0))}</div><div class="s">после налога на прибыль</div></div>
      </div>
      <div class="kpi" style="grid-template-columns:repeat(4,minmax(180px,1fr)); margin-top:12px">
        <div class="k"><div class="t">Прибыль/чел‑день</div><div class="v">${esc(money(summary.profit_per_person_day||0))}</div><div class="s">${esc(String(summary.peopleWork||0))} чел × ${esc(String(summary.workDays||0))} дней</div></div>
        <div class="k"><div class="t">ФОТ (работы+подготовка)</div><div class="v">${esc(money(summary.payrollTotal||0))}</div><div class="s">суммарно</div></div>
        <div class="k"><div class="t">Налоги ФОТ</div><div class="v">${esc(money(summary.fotTax||0))}</div><div class="s">${esc(String(summary.fot_tax_pct||0))}%</div></div>
        <div class="k"><div class="t">Доп. расходы</div><div class="v">${esc(money(summary.overhead||0))}</div><div class="s">${esc(String(summary.overhead_pct||0))}%</div></div>
      </div>
    `;
  }

  async function open({tender, estimate, actor_user, user}){
    const actor = actor_user || user || null;
    const app = await getAppSettings();
    const base = defaultsFromSettings(app);
    const saved = safeParse(estimate?.calc_summary_json, null);
    const state = mergeState(base, saved && saved.input ? saved.input : saved);

    function summary(){
      return compute(state, app);
    }

    const html = `
      <div class="help">Калькулятор просчёта: <b>${esc(tender?.customer_name||"")}</b> · ${esc(tender?.tender_title||"")}</div>
      <hr class="hr"/>
      <div class="calc-tabs">
        ${tabButton("p","Сроки/персонал",true)}
        ${tabButton("x","Расходы",false)}
        ${tabButton("ch","Химия",false)}
        ${tabButton("eq","Оборудование",false)}
        ${tabButton("lg","Логистика",false)}
        ${tabButton("t","Итоги",false)}
      </div>

      <div class="calc-panels">
        <section class="calc-panel" data-tab="p">
          <div class="formrow">
            <div><label>Срок работ, суток</label><input class="inp" id="c_work" type="number" min="0" value="${esc(String(state.work_days))}"/></div>
            <div><label>Подготовка на складе, суток</label><input class="inp" id="c_prepd" type="number" min="0" value="${esc(String(state.prep_days))}"/></div>
            <div><label>Маржа, % (по чистой прибыли)</label><input class="inp" id="c_margin" type="number" min="0" step="0.1" value="${esc(String(state.margin_pct))}"/></div>
          </div>
          <div class="formrow" style="margin-top:8px">
            <div><label>Подготовку выполняют: людей</label><input class="inp" id="c_prepp" type="number" min="0" value="${esc(String(state.prep_people))}"/></div>
            <div><label>Ставка подготовки, ₽/сутки</label><input class="inp" id="c_prepr" type="number" min="0" value="${esc(String(state.prep_rate))}"/></div>
            <div><label>НДС, %</label><input class="inp" id="c_vat" type="number" min="0" max="30" step="0.1" value="${esc(String(state.vat_pct))}"/></div>
          </div>
          <hr class="hr"/>
          <div class="help"><b>Персонал и ставки по ролям</b></div>
          ${renderRoleTable(state)}
        </section>

        <section class="calc-panel" data-tab="x" style="display:none">
          <div class="formrow">
            <div><label>Суточные, ₽/чел/сутки</label><input class="inp" id="c_perdiem" type="number" min="0" value="${esc(String(state.per_diem))}"/></div>
            <div><label>Проживание, ₽/чел/сутки</label><input class="inp" id="c_lodppd" type="number" min="0" value="${esc(String(state.lodging_per_person_day ?? 0))}"/></div>
            <div><label>СИЗ, ₽/чел</label><input class="inp" id="c_ppe" type="number" min="0" value="${esc(String(state.ppe_per_person))}"/></div>
          </div>
          <hr class="hr"/>
          <div class="help"><b>Мобилизация</b></div>
          ${renderMobilizations(state)}
        </section>

        <section class="calc-panel" data-tab="ch" style="display:none">
          ${renderChem(app, state)}
        </section>

        <section class="calc-panel" data-tab="eq" style="display:none">
          ${renderEquipment(state)}
        </section>

        <section class="calc-panel" data-tab="lg" style="display:none">
          ${renderLogistics(app, state, summary())}
        </section>

        <section class="calc-panel" data-tab="t" style="display:none">
          ${renderTotals(summary())}
          <hr class="hr"/>
          <div class="help">Сохранение запишет результат в просчёт (себестоимость и цену) и сохранит детализацию внутри расчёта.</div>
        </section>
      </div>

      <div class="calc-footer">
        <div class="help" style="margin:0">Порог: <b>${esc(money(num(app.calc?.min_profit_per_person_day,25000)))}</b> / чел‑сутки</div>
        <div class="calc-actions">
          <button class="btn ghost" id="btnCalcCancel" type="button">Закрыть</button>
          <button class="btn ghost" id="btnCalcExport" type="button">📥 Экспорт</button>
          <button class="btn" id="btnCalcApply" type="button">Применить в просчёт</button>
        </div>
      </div>
    `;

    showModal({title:"Калькулятор просчёта", html, fullscreen:true, onMount: ()=>{
      // Tabs
      const setTab = (t)=>{
        $$(".tab").forEach(b=>b.classList.toggle("active", b.dataset.tab===t));
        $$(".calc-panel").forEach(p=>p.style.display = (p.dataset.tab===t?"block":"none"));
        if(t==="lg" || t==="t") repaint();
      };
      $$(".tab").forEach(b=>b.addEventListener("click", ()=>setTab(b.dataset.tab)));

      function wireInputs(){
        // top fields
        $("#c_work").addEventListener("input", e=>{state.work_days=num(e.target.value,0); repaint();});
        $("#c_prepd").addEventListener("input", e=>{state.prep_days=num(e.target.value,0); repaint();});
        $("#c_margin").addEventListener("input", e=>{state.margin_pct=num(e.target.value,0); repaint();});
        $("#c_prepp").addEventListener("input", e=>{state.prep_people=num(e.target.value,0); repaint();});
        $("#c_prepr").addEventListener("input", e=>{state.prep_rate=num(e.target.value,0); repaint();});
        $("#c_vat").addEventListener("input", e=>{state.vat_pct=num(e.target.value,0); repaint();});

        // roles
        $$("[data-role-idx]").forEach(inp=>{
          inp.addEventListener("input", (e)=>{
            const i = Number(e.target.dataset.roleIdx);
            const k = e.target.dataset.k;
            if(!state.roles[i]) return;
            state.roles[i][k] = num(e.target.value,0);
            repaint();
          });
        });

        // expenses
        const perdiem = $("#c_perdiem");
        if(perdiem) perdiem.addEventListener("input", e=>{state.per_diem=num(e.target.value,0); repaint();});
        const lod = $("#c_lodppd");
        if(lod) lod.addEventListener("input", e=>{state.lodging_per_person_day=num(e.target.value,0); repaint();});
        const ppe = $("#c_ppe");
        if(ppe) ppe.addEventListener("input", e=>{state.ppe_per_person=num(e.target.value,0); repaint();});

        // mobilizations
        const addMob = $("#btnAddMob");
        if(addMob) addMob.addEventListener("click", ()=>{
          state.mobilizations.push({label:`Мобилизация ${state.mobilizations.length+1}`, people:0, cost_per_person:0});
          rerender("x");
        });
        $$("[data-mob-del]").forEach(btn=>btn.addEventListener("click", ()=>{
          const i=Number(btn.dataset.mobDel);
          state.mobilizations.splice(i,1);
          if(state.mobilizations.length===0) state.mobilizations.push({label:"Мобилизация 1", people:0, cost_per_person:0});
          rerender("x");
        }));
        $$("[data-mob-idx]").forEach(inp=>{
          inp.addEventListener("input", (e)=>{
            const i=Number(e.target.dataset.mobIdx);
            const k=e.target.dataset.k;
            if(!state.mobilizations[i]) return;
            state.mobilizations[i][k] = (k==="label") ? String(e.target.value||"") : num(e.target.value,0);
            repaint();
          });
        });

        // chemistry
        const sysvol = $("#c_sysvol");
        if(sysvol) sysvol.addEventListener("input", e=>{state.system_volume_m3=num(e.target.value,0); repaint();});
        const chemSel = $("#c_chem");
        if(chemSel) chemSel.addEventListener("change", e=>{state.chemical_id=String(e.target.value||""); repaint();});

        // equipment
        const addEq = $("#btnAddEq");
        if(addEq) addEq.addEventListener("click", ()=>{
          state.equipment.push({name:"",kind:"own",cost:0,rate_per_day:0,amort:0,weight_kg:0,volume_m3:0});
          rerender("eq");
        });
        $$("[data-eq-del]").forEach(btn=>btn.addEventListener("click", ()=>{
          const i=Number(btn.dataset.eqDel);
          state.equipment.splice(i,1);
          rerender("eq");
        }));
        $$("[data-eq-idx]").forEach(inp=>{
          const handler = (e)=>{
            const i=Number(e.target.dataset.eqIdx);
            const k=e.target.dataset.k;
            if(!state.equipment[i]) return;
            if(k==="name" || k==="kind") state.equipment[i][k] = String(e.target.value||"");
            else state.equipment[i][k] = num(e.target.value,0);
            // When kind changes, we need rerender to swap cost input
            if(k==="kind") rerender("eq");
            repaint();
          };
          inp.addEventListener("input", handler);
          inp.addEventListener("change", handler);
        });

        // logistics
        const city = $("#c_city");
        if(city) city.addEventListener("input", e=>{state.city=String(e.target.value||"");});
        const km = $("#c_km");
        if(km) km.addEventListener("input", e=>{state.distance_km=num(e.target.value,0); repaint();});
        const trans = $("#c_trans");
        if(trans) trans.addEventListener("change", e=>{state.transport_id=String(e.target.value||"AUTO"); repaint();});
        
        // Кнопка расчёта расстояния через Яндекс.Карты
        const btnCalcDist = $("#btnCalcDist");
        if(btnCalcDist && window.AsgardGeoScore) {
          btnCalcDist.addEventListener("click", async ()=>{
            const cityInput = $("#c_city");
            const kmInput = $("#c_km");
            const cityVal = cityInput?.value?.trim();
            
            if(cityVal) {
              // Быстрый расчёт если город указан
              btnCalcDist.disabled = true;
              btnCalcDist.textContent = "⏳";
              const dist = await AsgardGeoScore.calculateDistance(cityVal);
              btnCalcDist.disabled = false;
              btnCalcDist.textContent = "📍";
              
              if(dist) {
                kmInput.value = dist;
                state.distance_km = dist;
                repaint();
                AsgardUI.toast("Расстояние", `${cityVal}: ${dist.toLocaleString('ru-RU')} км`, "ok");
              } else {
                // Открываем модалку для ручного расчёта
                AsgardGeoScore.openDistanceCalculator((dist, city)=>{
                  kmInput.value = dist;
                  state.distance_km = dist;
                  if(city) { cityInput.value = city; state.city = city; }
                  repaint();
                });
              }
            } else {
              // Открываем модалку
              AsgardGeoScore.openDistanceCalculator((dist, city)=>{
                kmInput.value = dist;
                state.distance_km = dist;
                if(city) { cityInput.value = city; state.city = city; }
                repaint();
              });
            }
          });
        }
      }

      function rerender(tab){
        // lightweight rerender: replace innerHTML of one panel
        const app = window.__ASG_APP_SETTINGS_CACHE__ || null;
        // we do not rely on cache, but keep fast by using existing settings
        const panels = $$(".calc-panel");
        const p = panels.find(x=>x.dataset.tab===tab);
        if(!p) return;
        // rebuild with current settings
        if(tab==="x") p.innerHTML = `${renderExpensesSection(appSettings, state)}`;
      }

      // To keep implementation robust, we re-render whole modal for complex sections
      function rerenderSection(tab){
        const p = $$(".calc-panel").find(x=>x.dataset.tab===tab);
        if(!p) return;
        if(tab==="x") p.innerHTML = `
          <div class="formrow">
            <div><label>Суточные, ₽/чел/сутки</label><input class="inp" id="c_perdiem" type="number" min="0" value="${esc(String(state.per_diem))}"/></div>
            <div><label>Проживание, ₽/чел/сутки</label><input class="inp" id="c_lodppd" type="number" min="0" value="${esc(String(state.lodging_per_person_day ?? 0))}"/></div>
            <div><label>СИЗ, ₽/чел</label><input class="inp" id="c_ppe" type="number" min="0" value="${esc(String(state.ppe_per_person))}"/></div>
          </div>
          <hr class="hr"/>
          <div class="help"><b>Мобилизация</b></div>
          ${renderMobilizations(state)}
        `;
        if(tab==="eq") p.innerHTML = renderEquipment(state);
        if(tab==="lg") p.innerHTML = renderLogistics(app, state, summary());
        if(tab==="t") p.innerHTML = renderTotals(summary());
        wireInputs();
      }

      function repaint(){
        // refresh dynamic panels
        rerenderSection("lg");
        rerenderSection("t");
      }

      wireInputs();

      // Excel export (SheetJS)
      $("#btnCalcExport").addEventListener("click", ()=>{
        const s = summary();
        if(typeof XLSX === 'undefined'){
          toast("Экспорт","XLSX не загружен","err"); return;
        }
        try {
          const wb = XLSX.utils.book_new();
          const dateNow = new Date().toLocaleDateString('ru-RU');
          // Лист 1: Сводка
          const summaryData = [
            ['АСГАРД СЕРВИС — Калькулятор просчёта'],
            [],
            ['Рабочие дни:', s.workDays],
            ['Подготовка:', s.prepDays + ' дней'],
            ['Всего дней:', s.totalDays + ' дней'],
            ['Бригада:', s.peopleWork + ' чел'],
            [],
            ['ИТОГИ'],
            ['ФОТ (итого):', Math.round(s.payrollTotal)],
            ['Налоги на ФОТ:', Math.round(s.fotTax)],
            ['Суточные:', Math.round(s.perDiem)],
            ['Проживание:', Math.round(s.lodging)],
            ['СИЗ:', Math.round(s.ppe)],
            ['Мобилизация:', Math.round(s.mobilization)],
            ['Оборудование:', Math.round(s.equipCost)],
            ['Химия:', Math.round(s.chem?s.chem.cost:0)],
            ['Логистика:', Math.round(s.logistics)],
            ['Накладные (' + s.overhead_pct + '%):', Math.round(s.overhead)],
            [],
            ['СЕБЕСТОИМОСТЬ:', Math.round(s.costTotal)],
            ['Маржа:', s.margin_pct + '%'],
            ['Цена без НДС:', Math.round(s.priceNoVat)],
            ['НДС (' + s.vatPct + '%):', Math.round(s.priceWithVat - s.priceNoVat)],
            ['ЦЕНА С НДС:', Math.round(s.priceWithVat)],
            ['Чистая прибыль:', Math.round(s.netProfit)],
            ['Прибыль/чел-день:', Math.round(s.profit_per_person_day)],
            ['Статус:', s.ok ? 'НОРМА' : 'НИЗКАЯ'],
            [],
            ['Дата расчёта:', dateNow]
          ];
          const ws1 = XLSX.utils.aoa_to_sheet(summaryData);
          ws1['!cols'] = [{wch:28},{wch:20}];
          XLSX.utils.book_append_sheet(wb, ws1, 'Сводка');

          // Лист 2: Бригада
          const crewData = [['Роль','Кол-во','Ставка/смена']];
          for(const r of (state.roles||[])){
            if(r.count>0) crewData.push([r.role, r.count, r.rate]);
          }
          if(crewData.length>1){
            const ws2 = XLSX.utils.aoa_to_sheet(crewData);
            ws2['!cols'] = [{wch:20},{wch:10},{wch:16}];
            XLSX.utils.book_append_sheet(wb, ws2, 'Бригада');
          }

          // Лист 3: Оборудование
          if(state.equipment?.length){
            const eqData = [['Название','Тип','Вес,кг','Объём,м³','Стоимость']];
            for(const e of state.equipment){
              const cost = e.kind==='buy'?e.cost:(e.kind==='rent'?e.rate_per_day:e.amort)||0;
              eqData.push([e.name||'', e.kind||'own', e.weight_kg||0, e.volume_m3||0, cost]);
            }
            const ws3 = XLSX.utils.aoa_to_sheet(eqData);
            ws3['!cols'] = [{wch:25},{wch:10},{wch:10},{wch:10},{wch:14}];
            XLSX.utils.book_append_sheet(wb, ws3, 'Оборудование');
          }

          const filename = 'Расчёт_V1_' + dateNow.replace(/\./g,'-') + '.xlsx';
          XLSX.writeFile(wb, filename);
          toast("Экспорт","Excel-файл скачан");
        } catch(err){
          console.error('Excel export V1:', err);
          toast("Ошибка","Не удалось экспортировать","err");
        }
      });

      $("#btnCalcCancel").addEventListener("click", hideModal);
      $("#btnCalcApply").addEventListener("click", async ()=>{
        const s = summary();
        if(!s.ok){
          toast("Калькулятор","Прибыль/чел‑день ниже нормы. Измените расчёт.","err");
          setTab("t");
          return;
        }
        const now = new Date().toISOString();
        const next = structuredClone(estimate||{tender_id:tender.id, pm_id:tender.responsible_pm_id, version:1, status:"Новый"});
        next.cost_plan = Math.round(s.costTotal);
        next.price_tkp = Math.round(s.priceWithVat);
        next.updated_at = now;
        const payload = {
          _type:"asgard_calc_v1",
          input: state,
          output: s,
          director_view: {
            ok: !!s.ok,
            min_profit_per_person_day: Math.round(s.min_ppd||0),
            work_days: s.workDays,
            prep_days: s.prepDays,
            total_days: s.totalDays,
            roles: (state.roles||[]).map(r=>({ role:r.role, count:Number(r.count)||0, rate:Number(r.rate)||0 })),
            people: s.peopleWork,
            payroll_total: Math.round(s.payrollTotal),
            fot_tax: Math.round(s.fotTax),
            fot_tax_pct: Number(s.fot_tax_pct||0),
            per_diem_total: Math.round(s.perDiem),
            lodging_total: Math.round(s.lodging),
            ppe_total: Math.round(s.ppe),
            mobilization_total: Math.round(s.mobilization),
            chemicals_total: Math.round((s.chem && s.chem.cost)||0),
            equipment_total: Math.round(s.equipCost||0),
            logistics_cost: Math.round(s.logistics||0),
            transport_name: s.transport? s.transport.name : null,
            total_weight_kg: Math.round(s.totalWeightKg||0),
            total_volume_m3: Number((s.totalVolM3||0).toFixed(3)),
            overhead_total: Math.round(s.overhead||0),
            overhead_pct: Number(s.overhead_pct||0),
            cost_total: Math.round(s.costTotal),
            margin_pct: Number(s.margin_pct||0),
            profit_tax_pct: Number(s.profit_tax_pct||0),
            price_tkp_no_vat: Math.round(s.priceNoVat),
            vat_pct: Number(s.vatPct||0),
            price_tkp_with_vat: Math.round(s.priceWithVat),
            net_profit: Math.round(s.netProfit),
            profit_per_person_day: Math.round(s.profit_per_person_day||0)
          }
        };
        next.calc_summary_json = JSON.stringify(payload);

        let id = next.id;
        if(id) await AsgardDB.put("estimates", next);
        else id = await AsgardDB.add("estimates", next);

        if(actor){
          await AsgardDB.add("audit_log", {
            actor_user_id: actor.id||0,
            entity_type: "estimate",
            entity_id: id,
            action: "calc_apply",
            payload_json: JSON.stringify({tender_id:tender.id, cost:next.cost_plan, price:next.price_tkp}),
            created_at: now
          });
        }

        toast("Калькулятор","Результат записан в просчёт");
        hideModal();
      });

    }});

    return true;
  }

  function view(calc){
    const out = calc?.output || calc;
    if(!out || typeof out !== "object"){
      toast("Калькулятор","Нет сохранённого расчёта","err");
      return;
    }
    const html = `
      ${renderTotals(out)}
      <hr class="hr"/>
      <div class="help"><b>Логистика</b>: ${esc(out.transport? out.transport.name : "—")} · ${esc(money(out.logistics||0))}</div>
      <div class="help"><b>Химия</b>: ${esc(out.chem? out.chem.name : "—")} · ${esc(out.chem? (Math.round(out.chem.kg||0)+" кг") : "")} · ${esc(money(out.chem? out.chem.cost:0))}</div>
    `;
    showModal({title:"Итоги расчёта", html, fullscreen:true});
  }

  window.AsgardCalc = { open, view, compute };
})();
