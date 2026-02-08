// АСГАРД CRM — Рунический Калькулятор ᚱ
(function(){
  const { $, $$, esc, toast, showModal, hideModal } = AsgardUI;
  
  const CALC_NAME = "Рунический Калькулятор ᚱ";
  
  const num = (v, d=0) => {
    const n = Number(String(v??"").replace(/\s/g,"").replace(",","."));
    return Number.isFinite(n) ? n : d;
  };
  
  const money = (n) => {
    const x = Math.round(Number(n||0));
    return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " ₽";
  };
  
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const isoNow = () => new Date().toISOString();
  
  async function getSettings() {
    const app = await AsgardDB.get("settings", "app") || {};
    const defaults = window.CALC_DEFAULTS || {};
    return { ...defaults, ...app.calc_v2 };
  }
  
  function createState(tender) {
    return {
      tender_id: tender?.id || null,
      customer_name: tender?.customer_name || "",
      tender_title: tender?.tender_title || "",
      work_type_id: "heat_exchanger",
      city: "", distance_km: 0,
      conditions: [], surcharges: [],
      params: {},
      crew: [], crew_manual: false,
      prep_days: 2, work_days: 10, demob_days: 1, days_manual: false,
      chemicals: [], chem_manual: false,
      equipment: [], equip_manual: false,
      transport_id: "auto",
      mobilization_type: "auto",
      lodging_type: "hotel_3",
      margin_pct: 20,
      assumptions: "", // Допущения и риски
      version: 1,
      created_at: isoNow()
    };
  }
  
  function compute(state, s) {
    const dist = clamp(num(state.distance_km), 0, 15000);
    const prepDays = clamp(num(state.prep_days), 0, 30);
    const workDays = clamp(num(state.work_days), 1, 365);
    const demobDays = clamp(num(state.demob_days), 0, 14);
    const totalDays = prepDays + workDays + demobDays;
    
    let peopleCount = 0, payrollWork = 0, perDiemTotal = 0;
    for (const c of (state.crew || [])) {
      const role = s.roles?.find(r => r.id === c.role_id);
      if (!role) continue;
      const count = clamp(num(c.count), 0, 50);
      peopleCount += count;
      const rate = window.calcRateWithSurcharges ? window.calcRateWithSurcharges(c.role_id, state.surcharges, s) : (s.base_rate * role.coef);
      payrollWork += rate * count * workDays;
      perDiemTotal += (role.per_diem || 1000) * count * totalDays;
    }
    
    const prepPeople = Math.min(2, peopleCount);
    const prepRate = s.base_rate * 1.15;
    const payrollPrep = prepRate * prepPeople * prepDays;
    const payrollDemob = prepRate * prepPeople * demobDays;
    const payrollTotal = payrollWork + payrollPrep + payrollDemob;
    const fotTax = payrollTotal * (s.fot_tax_pct || 50) / 100;
    
    const lodging = s.lodging?.[state.lodging_type] || { rate_per_day: 2500 };
    const lodgingTotal = (lodging.rate_per_day || 2500) * peopleCount * totalDays;
    
    const mob = window.autoSelectMobilization ? window.autoSelectMobilization(dist, s) : { rate_per_person: 3500, id: 'auto' };
    const mobilizationTotal = (mob.rate_per_person || 3500) * peopleCount * 2;
    
    let chemTotal = 0, chemWeight = 0;
    for (const ch of (state.chemicals || [])) {
      const chem = s.chemicals?.find(c => c.id === ch.id);
      if (!chem) continue;
      const kg = num(ch.kg);
      chemTotal += kg * (chem.price_kg || 0);
      chemWeight += kg;
    }
    const consumables = chemTotal * ((s.consumables_pct || 5) / 100);
    
    const eqResult = window.calcEquipmentCost ? window.calcEquipmentCost(state.equipment || [], workDays) : { total: 0, totalWeight: 0, totalVolume: 0 };
    const totalWeightKg = chemWeight + eqResult.totalWeight;
    const totalVolM3 = (chemWeight / 1000) + eqResult.totalVolume;
    
    const transport = state.transport_id === "auto" ?
      (window.autoSelectTransport ? window.autoSelectTransport(totalWeightKg, totalVolM3, s) : s.transport?.[0]) :
      s.transport?.find(t => t.id === state.transport_id) || s.transport?.[0];
    const logisticsTotal = (transport?.rate_km || 40) * dist * 2;
    
    const ppeTotal = (s.ppe_per_person || 3000) * peopleCount;
    const baseCost = payrollTotal + perDiemTotal + lodgingTotal + mobilizationTotal + chemTotal + consumables + eqResult.total + logisticsTotal + ppeTotal;
    const overhead = baseCost * ((s.overhead_pct || 10) / 100);
    const costTotal = baseCost + overhead + fotTax;
    
    const marginPct = clamp(num(state.margin_pct), 5, 50);
    const priceNoVat = costTotal / (1 - marginPct/100);
    const profitBeforeTax = priceNoVat - costTotal;
    const profitTax = profitBeforeTax * ((s.profit_tax_pct || 20) / 100);
    const netProfit = profitBeforeTax - profitTax;
    const priceWithVat = priceNoVat * (1 + (s.vat_pct || 20)/100);
    const profitPerDay = (peopleCount > 0 && workDays > 0) ? netProfit / (peopleCount * workDays) : 0;
    
    let status = "red";
    if (profitPerDay >= (s.profit_per_day_norm || 25000)) status = "green";
    else if (profitPerDay >= (s.profit_per_day_min || 20000)) status = "yellow";
    
    return {
      distance_km: dist, prep_days: prepDays, work_days: workDays, demob_days: demobDays, total_days: totalDays,
      people_count: peopleCount, payroll_total: payrollTotal, fot_tax: fotTax, per_diem_total: perDiemTotal,
      lodging_total: lodgingTotal, mobilization_total: mobilizationTotal, mobilization_type: mob.id,
      chem_total: chemTotal, consumables, equip_total: eqResult.total,
      total_weight_kg: totalWeightKg, total_volume_m3: totalVolM3,
      transport, logistics_total: logisticsTotal, ppe_total: ppeTotal,
      base_cost: baseCost, overhead, overhead_pct: s.overhead_pct || 10, cost_total: costTotal,
      margin_pct: marginPct, price_no_vat: priceNoVat, profit_before_tax: profitBeforeTax,
      profit_tax, net_profit: netProfit, vat_pct: s.vat_pct || 20, price_with_vat: priceWithVat,
      profit_per_day: profitPerDay, min_profit: s.profit_per_day_min || 20000, norm_profit: s.profit_per_day_norm || 25000, status
    };
  }
  
  function autoFill(state, s) {
    const wt = s.work_types?.find(w => w.id === state.work_type_id);
    if (!wt) return state;
    if (!state.crew_manual && wt.base_crew) {
      state.crew = [];
      for (const [roleId, count] of Object.entries(wt.base_crew)) {
        const role = s.roles?.find(r => r.id === roleId);
        if (role) state.crew.push({ role_id: roleId, role_name: role.name, count: Math.ceil(count * (s.auto_people_multiplier || 1.1)), per_diem: role.per_diem });
      }
    }
    if (!state.days_manual && wt.norm_per_person_day) {
      let vol = state.params.surface_m2 || state.params.volume_m3 || state.params.length_m || state.params.fill_area || state.params.building_area || 100;
      const crewSize = state.crew.reduce((a, c) => a + (c.count || 0), 0) || 6;
      state.work_days = Math.max(3, Math.min(90, Math.ceil((vol / (wt.norm_per_person_day * crewSize)) * (s.auto_days_multiplier || 1.2))));
    }
    if (!state.chem_manual && wt.recommended_chem) {
      state.chemicals = [];
      const vol = state.params.system_volume_m3 || state.params.volume_m3 || 0;
      const area = state.params.surface_m2 || state.params.fill_area || 0;
      for (const chemId of wt.recommended_chem) {
        const chem = s.chemicals?.find(c => c.id === chemId);
        if (chem) {
          const kg = Math.ceil(vol ? vol * chem.kg_per_m3 : area * chem.kg_per_m2) || 50;
          state.chemicals.push({ id: chemId, kg });
        }
      }
    }
    if (!state.equip_manual && wt.equipment_ids) {
      state.equipment = wt.equipment_ids.slice(0, 8).map(id => ({ id, qty: 1, rent: false }));
    }
    return state;
  }

  // === UI TABS ===
  function tabs(active) {
    const list = [
      { id: "object", label: "1. Объект" },
      { id: "params", label: "2. Параметры" },
      { id: "crew", label: "3. Бригада" },
      { id: "time", label: "4. Сроки" },
      { id: "chem", label: "5. Химия" },
      { id: "equip", label: "6. Оборудование" },
      { id: "logistics", label: "7. Логистика" },
      { id: "totals", label: "8. Итоги" }
    ];
    return `<div class="calc-tabs">${list.map(t => `<button class="tab${t.id===active?' active':''}" data-tab="${t.id}">${t.label}</button>`).join('')}</div>`;
  }
  
  function tabObject(st, s) {
    const wtOpts = (s.work_types || []).map(w => `<option value="${w.id}"${st.work_type_id===w.id?' selected':''}>${w.icon||''} ${w.name}</option>`).join('');
    const conds = (s.surcharges || []).filter(x => !x.roles).map(x => `<label class="cbl"><input type="checkbox" data-cond="${x.id}"${st.conditions?.includes(x.id)?' checked':''}> ${x.name} (+${x.pct}%)</label>`).join('');
    return `
      <div class="csec"><h3>📋 Тендер</h3>
        <div class="fr"><div><label>Заказчик</label><input class="inp" value="${esc(st.customer_name)}" disabled></div><div><label>Объект</label><input class="inp" value="${esc(st.tender_title)}" disabled></div></div>
      </div>
      <div class="csec"><h3>🎯 Тип работы</h3>
        <select class="inp" id="c_wt">${wtOpts}</select>
      </div>
      <div class="csec"><h3>📍 Место выполнения</h3>
        <div class="fr">
          <div>
            <label>Город <small style="color:var(--muted)">(выберите из списка или введите любой)</small></label>
            <input class="inp" id="c_city" value="${esc(st.city)}" list="citylist" placeholder="Москва, Екатеринбург, Сургут...">
            <datalist id="citylist"></datalist>
          </div>
          <div>
            <label>Расстояние от Москвы, км <small style="color:var(--muted)">(можно ввести вручную)</small></label>
            <input class="inp" id="c_km" type="number" min="0" max="15000" value="${st.distance_km||0}" placeholder="0">
            <div class="help" style="margin-top:4px">Если города нет в списке — введите расстояние вручную</div>
          </div>
        </div>
      </div>
      <div class="csec"><h3>⚠️ Условия работы <small style="color:var(--muted)">(влияют на ставки)</small></h3><div class="cgrid">${conds}</div></div>
      <div class="csec"><h3>📝 Допущения и риски</h3>
        <textarea class="inp" id="c_assumptions" rows="3" placeholder="Например: доступ на объект с 8:00 до 20:00, требуется пропуск, возможны простои из-за погоды...">${esc(st.assumptions||'')}</textarea>
        <div class="help" style="margin-top:4px">Укажите важные допущения, от которых зависит расчёт. Это поможет директору при согласовании.</div>
      </div>`;
  }
  
  function tabParams(st, s) {
    const wt = s.work_types?.find(w => w.id === st.work_type_id);
    if (!wt?.params?.length) return `<div class="csec"><p class="help">Нет параметров для этого типа работ.</p></div>`;
    const fields = wt.params.map(p => {
      const v = st.params[p.id] ?? "";
      if (p.type === "select") {
        return `<div><label>${esc(p.name)}</label><select class="inp" data-p="${p.id}">${(p.options||[]).map(o => `<option${v===o?' selected':''}>${o}</option>`).join('')}</select></div>`;
      }
      return `<div><label>${esc(p.name)}${p.unit?` (${p.unit})`:''}</label><input class="inp" data-p="${p.id}" type="${p.type==='number'?'number':'text'}" value="${esc(String(v))}"></div>`;
    }).join('');
    return `<div class="csec"><h3>📐 ${wt.icon||''} ${wt.name}</h3><p class="help">${wt.desc||''}</p><div class="fr">${fields}</div>
      <button class="btn" id="autoBtn" style="margin-top:12px">🤖 Автоподбор</button></div>`;
  }
  
  function tabCrew(st, s) {
    const rows = (st.crew||[]).map((c,i) => {
      const role = s.roles?.find(r => r.id === c.role_id);
      const rate = window.calcRateWithSurcharges ? window.calcRateWithSurcharges(c.role_id, st.surcharges, s) : 5500;
      return `<tr><td>${esc(role?.name||c.role_id)}</td><td><input class="inp" type="number" min="0" data-ci="${i}" name="crew_${i}" value="${c.count||0}" style="width:70px"></td><td>${money(rate)}</td><td><button class="btn ghost mini" data-cdel="${i}">✕</button></td></tr>`;
    }).join('');
    const total = (st.crew||[]).reduce((a,c)=>a+(c.count||0),0);
    const roleOpts = (s.roles||[]).map(r => `<option value="${r.id}">${r.name}</option>`).join('');
    const surchs = (s.surcharges||[]).map(x => `<label class="cbl"><input type="checkbox" data-sur="${x.id}"${st.surcharges?.includes(x.id)?' checked':''}> ${x.name} (+${x.pct}%)</label>`).join('');
    return `<div class="csec"><h3>👷 Бригада</h3>
      <label class="cbl"><input type="checkbox" id="crewMan"${st.crew_manual?' checked':''}> Ручной режим</label>
      <table class="tbl"><thead><tr><th>Роль</th><th>Кол-во</th><th>Ставка</th><th></th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td>Итого</td><td><b>${total}</b></td><td></td><td></td></tr></tfoot></table>
      <div style="display:flex;gap:8px;margin-top:12px"><select class="inp" id="addRole">${roleOpts}</select><button class="btn ghost" id="addCrewBtn">+ Добавить</button></div></div>
      <div class="csec"><h3>💰 Доплаты</h3><div class="cgrid">${surchs}</div></div>`;
  }
  
  function tabTime(st, s) {
    const total = (st.prep_days||0) + (st.work_days||0) + (st.demob_days||0);
    return `<div class="csec"><h3>📅 Сроки</h3>
      <label class="cbl"><input type="checkbox" id="daysMan"${st.days_manual?' checked':''}> Ручной режим</label>
      <div class="fr">
        <div><label>Подготовка, дн.</label><input class="inp" type="number" id="c_prep" value="${st.prep_days||2}"></div>
        <div><label>Работа, дн.</label><input class="inp" type="number" id="c_work" value="${st.work_days||10}"></div>
        <div><label>Демоб., дн.</label><input class="inp" type="number" id="c_demob" value="${st.demob_days||1}"></div>
      </div>
      <div class="kpi3"><div class="k"><div class="t">Подготовка</div><div class="v">${st.prep_days||2}</div></div><div class="k"><div class="t">Работа</div><div class="v">${st.work_days||10}</div></div><div class="k"><div class="t">ВСЕГО</div><div class="v">${total}</div></div></div></div>`;
  }
  
  function tabChem(st, s) {
    const rows = (st.chemicals||[]).map((ch,i) => {
      const chem = s.chemicals?.find(c => c.id === ch.id);
      return `<tr><td>${esc(chem?.name||ch.id)}</td><td><input class="inp" type="number" data-chi="${i}" value="${ch.kg||0}" style="width:80px"></td><td>${money(chem?.price_kg||0)}/кг</td><td>${money((ch.kg||0)*(chem?.price_kg||0))}</td><td><button class="btn ghost mini" data-chdel="${i}">✕</button></td></tr>`;
    }).join('');
    const total = (st.chemicals||[]).reduce((a,ch) => { const c = s.chemicals?.find(x=>x.id===ch.id); return a + (ch.kg||0)*(c?.price_kg||0); }, 0);
    const opts = (s.chemicals||[]).map(c => `<option value="${c.id}">${c.name} (${c.price_kg}₽/кг)</option>`).join('');
    return `<div class="csec"><h3>🧪 Химия</h3>
      <label class="cbl"><input type="checkbox" id="chemMan"${st.chem_manual?' checked':''}> Ручной режим</label>
      <table class="tbl"><thead><tr><th>Состав</th><th>Кг</th><th>Цена</th><th>Сумма</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="5" class="help">Нет</td></tr>'}</tbody><tfoot><tr><td colspan="3">Итого</td><td><b>${money(total)}</b></td><td></td></tr></tfoot></table>
      <div style="display:flex;gap:8px;margin-top:12px"><select class="inp" id="addChem">${opts}</select><button class="btn ghost" id="addChemBtn">+ Добавить</button></div></div>`;
  }

  function tabEquip(st, s) {
    const all = window.CALC_EQUIPMENT || [];
    const rows = (st.equipment||[]).map((eq,i) => {
      const item = all.find(e => e.id === eq.id);
      if (!item) return '';
      const rate = eq.rent ? (item.rent_day||item.amort_day||0) : (item.amort_day||0);
      return `<tr><td>${esc(item.name)}</td><td><input class="inp" type="number" min="1" data-eqi="${i}" value="${eq.qty||1}" style="width:60px"></td>
        <td><select class="inp" data-eqr="${i}"><option value="0"${!eq.rent?' selected':''}>Наше</option><option value="1"${eq.rent?' selected':''}>Аренда</option></select></td>
        <td>${money(rate)}/сут</td><td><button class="btn ghost mini" data-eqdel="${i}">✕</button></td></tr>`;
    }).join('');
    const cats = [...new Set(all.map(e => e.category))];
    const opts = cats.map(cat => `<optgroup label="${cat}">${all.filter(e=>e.category===cat).map(e=>`<option value="${e.id}">${e.name}</option>`).join('')}</optgroup>`).join('');
    return `<div class="csec"><h3>🔧 Оборудование</h3>
      <label class="cbl"><input type="checkbox" id="equipMan"${st.equip_manual?' checked':''}> Ручной режим</label>
      <table class="tbl"><thead><tr><th>Позиция</th><th>Кол.</th><th>Тип</th><th>Ставка</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="5" class="help">Нет</td></tr>'}</tbody></table>
      <div style="display:flex;gap:8px;margin-top:12px"><select class="inp" id="addEq">${opts}</select><button class="btn ghost" id="addEqBtn">+ Добавить</button></div></div>`;
  }
  
  function tabLogistics(st, s, sum) {
    const trOpts = (s.transport||[]).map(t => `<option value="${t.id}"${st.transport_id===t.id?' selected':''}>${t.name} (до ${t.max_kg/1000}т) — ${t.rate_km}₽/км</option>`).join('');
    const lodOpts = Object.entries(s.lodging||{}).map(([id,l]) => `<option value="${id}"${st.lodging_type===id?' selected':''}>${l.name} — ${l.rate_per_day}₽/сут</option>`).join('');
    const mobOpts = Object.entries(s.mobilization||{}).map(([id,m]) => `<option value="${id}"${st.mobilization_type===id?' selected':''}>${m.name} — ${m.rate_per_person}₽/чел</option>`).join('');
    return `<div class="csec"><h3>🚛 Доставка</h3>
      <select class="inp" id="c_tr"><option value="auto"${st.transport_id==='auto'?' selected':''}>🤖 Авто</option>${trOpts}</select>
      <div class="kpi4"><div class="k"><div class="t">Груз</div><div class="v">${Math.round(sum.total_weight_kg)} кг</div></div><div class="k"><div class="t">Транспорт</div><div class="v">${sum.transport?.name||'—'}</div></div><div class="k"><div class="t">Расстояние</div><div class="v">${sum.distance_km} км ×2</div></div><div class="k"><div class="t">Итого</div><div class="v">${money(sum.logistics_total)}</div></div></div></div>
      <div class="csec"><h3>🏨 Проживание</h3><select class="inp" id="c_lod">${lodOpts}</select>
      <div class="kpi3"><div class="k"><div class="t">Ставка</div><div class="v">${money(s.lodging?.[st.lodging_type]?.rate_per_day||2500)}/сут</div></div><div class="k"><div class="t">Чел×Дней</div><div class="v">${sum.people_count}×${sum.total_days}</div></div><div class="k"><div class="t">Итого</div><div class="v">${money(sum.lodging_total)}</div></div></div></div>
      <div class="csec"><h3>✈️ Мобилизация</h3><select class="inp" id="c_mob"><option value="auto"${st.mobilization_type==='auto'?' selected':''}>🤖 Авто</option>${mobOpts}</select>
      <div class="kpi3"><div class="k"><div class="t">Способ</div><div class="v">${s.mobilization?.[sum.mobilization_type]?.name||'Авто'}</div></div><div class="k"><div class="t">Чел×2</div><div class="v">${sum.people_count}×2</div></div><div class="k"><div class="t">Итого</div><div class="v">${money(sum.mobilization_total)}</div></div></div></div>`;
  }
  
  function tabTotals(st, s, sum) {
    const col = { red: '#e03a4a', yellow: '#f59e0b', green: '#22c55e' };
    const lbl = { red: '🔴 КРАСНАЯ', yellow: '🟡 ЖЁЛТАЯ', green: '🟢 ЗЕЛЁНАЯ' };
    return `<div class="csec"><h3>📊 Себестоимость</h3>
      <table class="tbl"><tbody>
        <tr><td>ФОТ + налоги</td><td style="text-align:right">${money(sum.payroll_total + sum.fot_tax)}</td></tr>
        <tr><td>Суточные</td><td style="text-align:right">${money(sum.per_diem_total)}</td></tr>
        <tr><td>Проживание</td><td style="text-align:right">${money(sum.lodging_total)}</td></tr>
        <tr><td>Мобилизация</td><td style="text-align:right">${money(sum.mobilization_total)}</td></tr>
        <tr><td>Химия</td><td style="text-align:right">${money(sum.chem_total + sum.consumables)}</td></tr>
        <tr><td>Оборудование</td><td style="text-align:right">${money(sum.equip_total)}</td></tr>
        <tr><td>Логистика</td><td style="text-align:right">${money(sum.logistics_total)}</td></tr>
        <tr><td>СИЗ</td><td style="text-align:right">${money(sum.ppe_total)}</td></tr>
        <tr><td>Накладные (${sum.overhead_pct}%)</td><td style="text-align:right">${money(sum.overhead)}</td></tr>
        <tr style="background:rgba(42,108,241,.2)"><td><b>СЕБЕСТОИМОСТЬ</b></td><td style="text-align:right"><b>${money(sum.cost_total)}</b></td></tr>
      </tbody></table></div>
      <div class="csec"><h3>💰 Цена</h3>
        <div class="fr"><div><label>Маржа, %</label><input class="inp" type="number" id="c_margin" min="5" max="50" value="${st.margin_pct||20}"></div></div>
        <table class="tbl" style="margin-top:12px"><tbody>
          <tr><td>Цена без НДС</td><td style="text-align:right">${money(sum.price_no_vat)}</td></tr>
          <tr><td>НДС ${sum.vat_pct}%</td><td style="text-align:right">${money(sum.price_with_vat - sum.price_no_vat)}</td></tr>
          <tr style="background:rgba(242,208,138,.2)"><td><b>ЦЕНА С НДС</b></td><td style="text-align:right"><b>${money(sum.price_with_vat)}</b></td></tr>
          <tr style="background:rgba(34,197,94,.15)"><td><b>Чистая прибыль</b></td><td style="text-align:right"><b>${money(sum.net_profit)}</b></td></tr>
        </tbody></table></div>
      <div class="csec" style="background:${col[sum.status]}22;border:2px solid ${col[sum.status]}">
        <div style="text-align:center"><span style="font-size:16px;font-weight:700;color:${col[sum.status]}">${lbl[sum.status]} ЗОНА</span></div>
        <div style="text-align:center;margin-top:12px"><span style="font-size:28px;font-weight:700;color:${col[sum.status]}">${money(sum.profit_per_day)}</span><br><small>прибыль / чел-день</small></div>
        <div class="help" style="margin-top:12px;text-align:center">${sum.people_count} чел × ${sum.work_days} дней = ${sum.people_count * sum.work_days} чел-дней</div>
      </div>
      <div style="margin-top:16px;display:flex;gap:10px"><button class="btn" id="saveBtn" style="flex:1">💾 Сохранить</button><button class="btn ghost" id="exportBtn">📥 Экспорт</button></div>`;
  }

  // === OPEN CALCULATOR ===
  async function open({ tender, estimate, user }) {
    const s = await getSettings();
    let st = estimate?.calc_v2_json ? JSON.parse(estimate.calc_v2_json) : createState(tender);
    st.tender_id = tender?.id;
    st.customer_name = tender?.customer_name || "";
    st.tender_title = tender?.tender_title || "";
    
    let tab = "object";
    
    function render() {
      st = autoFill(st, s);
      const sum = compute(st, s);
      
      let content = '';
      switch(tab) {
        case 'object': content = tabObject(st, s); break;
        case 'params': content = tabParams(st, s); break;
        case 'crew': content = tabCrew(st, s); break;
        case 'time': content = tabTime(st, s); break;
        case 'chem': content = tabChem(st, s); break;
        case 'equip': content = tabEquip(st, s); break;
        case 'logistics': content = tabLogistics(st, s, sum); break;
        case 'totals': content = tabTotals(st, s, sum); break;
      }
      
      const html = `<style>
        .calc-tabs{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:16px}
        .calc-tabs .tab{padding:8px 12px;border-radius:8px;background:rgba(13,20,40,.5);border:1px solid rgba(42,59,102,.5);cursor:pointer;font-size:12px}
        .calc-tabs .tab.active{background:rgba(42,108,241,.3);border-color:var(--accent)}
        .calc-tabs .tab.warn{border-color:rgba(245,158,11,.6)}
        .csec{background:rgba(13,20,40,.4);border:1px solid rgba(42,59,102,.5);border-radius:12px;padding:16px;margin-bottom:16px}
        .csec h3{margin:0 0 12px;font-size:14px;color:var(--gold)}
        .cbl{display:flex;align-items:center;gap:8px;cursor:pointer;padding:4px 0}
        .cbl input{width:18px;height:18px}
        .cgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px}
        .fr{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
        .tbl{width:100%;border-collapse:collapse}
        .tbl th,.tbl td{padding:8px 10px;text-align:left;border-bottom:1px solid rgba(42,59,102,.3)}
        .tbl th{font-size:11px;color:var(--muted);font-weight:600}
        .tbl tfoot td{font-weight:600;background:rgba(42,108,241,.1)}
        .kpi3,.kpi4{display:grid;gap:12px;margin-top:12px}
        .kpi3{grid-template-columns:repeat(3,1fr)}
        .kpi4{grid-template-columns:repeat(4,1fr)}
        .k{background:rgba(13,20,40,.5);border-radius:10px;padding:12px;text-align:center}
        .k .t{font-size:11px;color:var(--muted)}
        .k .v{font-size:18px;font-weight:700;color:var(--gold)}
        .mini{padding:4px 8px;font-size:11px}
      </style>
      <div class="help" style="margin-bottom:12px"><b>ᚱ ${CALC_NAME}</b> — ${esc(st.customer_name)}</div>
      ${tabs(tab)}
      <div id="tabContent">${content}</div>
      <div style="margin-top:16px;padding:12px;background:rgba(13,20,40,.5);border-radius:10px;display:flex;justify-content:space-between">
        <div><span style="color:var(--muted)">Цена с НДС:</span> <b style="font-size:18px;color:var(--gold)">${money(sum.price_with_vat)}</b></div>
        <div><span style="color:var(--muted)">Прибыль/чел-день:</span> <b style="font-size:18px;color:${sum.status==='green'?'#22c55e':sum.status==='yellow'?'#f59e0b':'#e03a4a'}">${money(sum.profit_per_day)}</b></div>
      </div>`;
      
      showModal("Калькулятор просчёта", html, { wide: true });
      bind();
    }
    
    function bind() {
      $$('.calc-tabs .tab').forEach(btn => btn.onclick = () => { tab = btn.dataset.tab; render(); });
      
      // Object tab
      const wt = $('#c_wt'); if(wt) wt.onchange = () => { st.work_type_id = wt.value; st.params = {}; st.crew_manual = st.days_manual = st.chem_manual = st.equip_manual = false; render(); };
      const city = $('#c_city'); if(city) { city.oninput = () => { st.city = city.value; if(window.findCity){ const dl=$('#citylist'); if(dl) dl.innerHTML = window.findCity(city.value).map(c=>`<option value="${c.name}">${c.name} (${c.km} км)</option>`).join(''); } };
        city.onchange = () => { if(window.getCityDistance){ const km = window.getCityDistance(city.value); if(km!==null){ st.distance_km = km; const inp=$('#c_km'); if(inp) inp.value = km; } } }; }
      const km = $('#c_km'); if(km) km.oninput = () => { st.distance_km = num(km.value); };
      $$('[data-cond]').forEach(cb => cb.onchange = () => { const id = cb.dataset.cond; if(cb.checked){ if(!st.conditions.includes(id)) st.conditions.push(id); if(!st.surcharges.includes(id)) st.surcharges.push(id); } else { st.conditions = st.conditions.filter(x=>x!==id); st.surcharges = st.surcharges.filter(x=>x!==id); } });
      const assumptions = $('#c_assumptions'); if(assumptions) assumptions.oninput = () => { st.assumptions = assumptions.value; };
      
      // Params tab
      $$('[data-p]').forEach(inp => inp.oninput = () => { st.params[inp.dataset.p] = inp.type==='number' ? num(inp.value) : inp.value; });
      const autoBtn = $('#autoBtn'); if(autoBtn) autoBtn.onclick = () => { st.crew_manual = st.days_manual = st.chem_manual = st.equip_manual = false; render(); toast("Авто","Пересчитано"); };
      
      // Crew tab
      const crewMan = $('#crewMan'); if(crewMan) crewMan.onchange = () => { st.crew_manual = crewMan.checked; };
      $$('[data-ci]').forEach(inp => inp.oninput = () => { const i = +inp.dataset.ci; if(st.crew[i]) { st.crew[i].count = num(inp.value); st.crew_manual = true; render(); } });
      $$('[data-cdel]').forEach(btn => btn.onclick = () => { st.crew.splice(+btn.dataset.cdel, 1); st.crew_manual = true; render(); });
      const addCrewBtn = $('#addCrewBtn'); if(addCrewBtn) addCrewBtn.onclick = () => { const rid = $('#addRole')?.value; if(rid && !st.crew.find(c=>c.role_id===rid)){ const role = s.roles?.find(r=>r.id===rid); st.crew.push({ role_id: rid, role_name: role?.name||rid, count: 1, per_diem: role?.per_diem||1000 }); st.crew_manual = true; render(); } };
      $$('[data-sur]').forEach(cb => cb.onchange = () => { const id = cb.dataset.sur; if(cb.checked){ if(!st.surcharges.includes(id)) st.surcharges.push(id); } else { st.surcharges = st.surcharges.filter(x=>x!==id); } render(); });
      
      // Time tab
      const daysMan = $('#daysMan'); if(daysMan) daysMan.onchange = () => { st.days_manual = daysMan.checked; };
      ['prep','work','demob'].forEach(k => { const inp = $(`#c_${k}`); if(inp) inp.oninput = () => { st[k+'_days'] = num(inp.value); st.days_manual = true; render(); }; });
      
      // Chem tab
      const chemMan = $('#chemMan'); if(chemMan) chemMan.onchange = () => { st.chem_manual = chemMan.checked; };
      $$('[data-chi]').forEach(inp => inp.oninput = () => { const i = +inp.dataset.chi; if(st.chemicals[i]) { st.chemicals[i].kg = num(inp.value); st.chem_manual = true; render(); } });
      $$('[data-chdel]').forEach(btn => btn.onclick = () => { st.chemicals.splice(+btn.dataset.chdel, 1); st.chem_manual = true; render(); });
      const addChemBtn = $('#addChemBtn'); if(addChemBtn) addChemBtn.onclick = () => { const cid = $('#addChem')?.value; if(cid && !st.chemicals.find(c=>c.id===cid)){ st.chemicals.push({ id: cid, kg: 100 }); st.chem_manual = true; render(); } };
      
      // Equip tab
      const equipMan = $('#equipMan'); if(equipMan) equipMan.onchange = () => { st.equip_manual = equipMan.checked; };
      $$('[data-eqi]').forEach(inp => inp.oninput = () => { const i = +inp.dataset.eqi; if(st.equipment[i]) { st.equipment[i].qty = num(inp.value); st.equip_manual = true; render(); } });
      $$('[data-eqr]').forEach(sel => sel.onchange = () => { const i = +sel.dataset.eqr; if(st.equipment[i]) { st.equipment[i].rent = sel.value==='1'; st.equip_manual = true; render(); } });
      $$('[data-eqdel]').forEach(btn => btn.onclick = () => { st.equipment.splice(+btn.dataset.eqdel, 1); st.equip_manual = true; render(); });
      const addEqBtn = $('#addEqBtn'); if(addEqBtn) addEqBtn.onclick = () => { const eid = $('#addEq')?.value; if(eid && !st.equipment.find(e=>e.id===eid)){ st.equipment.push({ id: eid, qty: 1, rent: false }); st.equip_manual = true; render(); } };
      
      // Logistics tab
      const tr = $('#c_tr'); if(tr) tr.onchange = () => { st.transport_id = tr.value; render(); };
      const lod = $('#c_lod'); if(lod) lod.onchange = () => { st.lodging_type = lod.value; render(); };
      const mob = $('#c_mob'); if(mob) mob.onchange = () => { st.mobilization_type = mob.value; render(); };
      
      // Totals tab
      const margin = $('#c_margin'); if(margin) margin.oninput = () => { st.margin_pct = num(margin.value); render(); };
      const saveBtn = $('#saveBtn'); if(saveBtn) saveBtn.onclick = async () => {
        st.updated_at = isoNow(); st.version = (st.version||0) + 1;
        const sum = compute(st, s);
        if(estimate?.id) {
          estimate.calc_v2_json = JSON.stringify(st);
          estimate.price_with_vat = Math.round(sum.price_with_vat);
          estimate.profit_per_day = Math.round(sum.profit_per_day);
          estimate.status = sum.status;
          estimate.updated_at = isoNow();
          await AsgardDB.put("estimates", estimate);
          toast("Сохранено", `v${st.version}`);
        } else { toast("Ошибка", "Нет estimate", "err"); }
      };
      const exportBtn = $('#exportBtn'); if(exportBtn) exportBtn.onclick = () => {
        const sum = compute(st, s);

        // Проверяем наличие SheetJS (XLSX)
        if (typeof XLSX === 'undefined') {
          // Fallback на txt если xlsx не загружен
          const txt = `КАЛЬКУЛЯТОР v2\n==============\nЗаказчик: ${st.customer_name}\nОбъект: ${st.tender_title}\nГород: ${st.city} (${st.distance_km} км)\nБригада: ${sum.people_count} чел\nСроки: ${sum.work_days} дней\nСебестоимость: ${money(sum.cost_total)}\nЦена с НДС: ${money(sum.price_with_vat)}\nЧистая прибыль: ${money(sum.net_profit)}\nПрибыль/чел-день: ${money(sum.profit_per_day)} (${sum.status.toUpperCase()})\nДата: ${new Date().toLocaleDateString('ru-RU')}`;
          const blob = new Blob([txt], { type: 'text/plain' });
          const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
          a.download = `calc_${st.tender_id||'new'}.txt`; a.click();
          toast("Экспорт", "Файл скачан (TXT)");
          return;
        }

        // Excel-экспорт через SheetJS
        try {
          const wb = XLSX.utils.book_new();
          const dateNow = new Date().toLocaleDateString('ru-RU');
          const wt = s.work_types?.find(w => w.id === st.work_type_id);

          // Лист 1: Сводка
          const summaryData = [
            ['АСГАРД СЕРВИС — Рунический Калькулятор ᚱ'],
            [],
            ['Заказчик:', st.customer_name || '—'],
            ['Объект:', st.tender_title || '—'],
            ['Вид работ:', wt?.name || st.work_type_id || '—'],
            ['Город:', st.city || '—'],
            ['Расстояние:', `${st.distance_km || 0} км`],
            [],
            ['СРОКИ И ПЕРСОНАЛ'],
            ['Подготовка:', `${sum.prep_days} дней`],
            ['Работы:', `${sum.work_days} дней`],
            ['Демобилизация:', `${sum.demob_days} дней`],
            ['Всего дней:', `${sum.total_days} дней`],
            ['Бригада:', `${sum.people_count} чел`],
            [],
            ['ИТОГИ РАСЧЁТА'],
            ['Себестоимость (без НДС):', sum.cost_total],
            ['Цена клиенту (без НДС):', sum.price_no_vat],
            ['НДС:', `${sum.vat_pct}%`],
            ['Цена клиенту (с НДС):', sum.price_with_vat],
            ['Чистая прибыль:', sum.net_profit],
            ['Прибыль/чел-день:', sum.profit_per_day],
            ['Статус:', sum.status === 'green' ? 'НОРМА' : sum.status === 'yellow' ? 'ВНИМАНИЕ' : 'НИЗКАЯ'],
            [],
            ['Дата расчёта:', dateNow],
            ['Версия:', `v${st.version || 1}`]
          ];
          const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
          wsSummary['!cols'] = [{ wch: 28 }, { wch: 35 }];
          XLSX.utils.book_append_sheet(wb, wsSummary, 'Сводка');

          // Лист 2: Детали (статьи расходов)
          const detailsData = [
            ['Статья расходов', 'Сумма, руб', 'Примечание'],
            ['ФОТ (работа + подготовка + демоб.)', sum.payroll_total, `${sum.people_count} чел x ${sum.work_days} дней работы`],
            ['Налоги на ФОТ', sum.fot_tax, `${s.fot_tax_pct || 50}%`],
            ['Суточные', sum.per_diem_total, `${sum.total_days} дней`],
            ['Проживание', sum.lodging_total, st.lodging_type],
            ['Мобилизация', sum.mobilization_total, sum.mobilization_type],
            ['Химия', sum.chem_total, `${st.chemicals?.length || 0} позиций`],
            ['Расходные материалы', sum.consumables, `${s.consumables_pct || 5}%`],
            ['Оборудование', sum.equip_total, `${st.equipment?.length || 0} позиций`],
            ['Логистика', sum.logistics_total, `${sum.transport?.name || 'авто'}, ${st.distance_km * 2} км`],
            ['СИЗ', sum.ppe_total, `${sum.people_count} чел`],
            ['Накладные', sum.overhead, `${sum.overhead_pct}%`],
            [],
            ['ИТОГО себестоимость:', sum.cost_total, ''],
            ['Маржа:', sum.margin_pct + '%', ''],
            ['Цена без НДС:', sum.price_no_vat, ''],
            ['НДС:', sum.price_with_vat - sum.price_no_vat, `${sum.vat_pct}%`],
            ['ЦЕНА С НДС:', sum.price_with_vat, '']
          ];
          const wsDetails = XLSX.utils.aoa_to_sheet(detailsData);
          wsDetails['!cols'] = [{ wch: 35 }, { wch: 18 }, { wch: 30 }];
          XLSX.utils.book_append_sheet(wb, wsDetails, 'Детали');

          // Лист 3: Бригада
          const crewData = [['Роль', 'Кол-во', 'Ставка/день', 'Суточные', 'Итого за работу']];
          for (const c of (st.crew || [])) {
            const role = s.roles?.find(r => r.id === c.role_id);
            if (!role) continue;
            const rate = window.calcRateWithSurcharges ? window.calcRateWithSurcharges(c.role_id, st.surcharges, s) : (s.base_rate * role.coef);
            const perDiem = role.per_diem || 1000;
            const total = rate * c.count * sum.work_days + perDiem * c.count * sum.total_days;
            crewData.push([role.name || c.role_id, c.count, rate, perDiem, total]);
          }
          if (crewData.length > 1) {
            const wsCrew = XLSX.utils.aoa_to_sheet(crewData);
            wsCrew['!cols'] = [{ wch: 25 }, { wch: 10 }, { wch: 15 }, { wch: 12 }, { wch: 18 }];
            XLSX.utils.book_append_sheet(wb, wsCrew, 'Бригада');
          }

          // Лист 4: Параметры
          const paramsData = [['Параметр', 'Значение']];
          if (st.params) {
            for (const [key, val] of Object.entries(st.params)) {
              if (val !== null && val !== undefined && val !== '') {
                paramsData.push([key, val]);
              }
            }
          }
          paramsData.push(['margin_pct', st.margin_pct]);
          paramsData.push(['prep_days', st.prep_days]);
          paramsData.push(['work_days', st.work_days]);
          paramsData.push(['demob_days', st.demob_days]);
          paramsData.push(['distance_km', st.distance_km]);
          paramsData.push(['transport_id', st.transport_id]);
          paramsData.push(['lodging_type', st.lodging_type]);
          if (st.assumptions) paramsData.push(['assumptions', st.assumptions]);

          const wsParams = XLSX.utils.aoa_to_sheet(paramsData);
          wsParams['!cols'] = [{ wch: 25 }, { wch: 30 }];
          XLSX.utils.book_append_sheet(wb, wsParams, 'Параметры');

          // Генерация имени файла
          const objName = (st.tender_title || 'объект').replace(/[^\w\u0400-\u04FF\s-]/g, '').substring(0, 30).trim();
          const filename = `Расчёт_${objName}_${dateNow.replace(/\./g, '-')}.xlsx`;

          // Скачивание
          XLSX.writeFile(wb, filename);
          toast("Экспорт", "Excel-файл скачан");
        } catch (err) {
          console.error('Excel export error:', err);
          toast("Ошибка", "Не удалось экспортировать в Excel", "err");
        }
      };
    }
    
    render();
  }
  
  window.AsgardCalcV2 = { open, compute, getSettings };
  console.log('[CALC] Calculator v2 loaded');
})();
