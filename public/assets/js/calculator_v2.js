// АСГАРД CRM — Рунический Калькулятор ᚱ
(function(){
  const { $, $$, esc, toast, showModal, hideModal } = AsgardUI;
  
  const CALC_NAME = "Рунический Калькулятор ᚱ";
  
  const num = (v, d=0) => {
    const n = Number(String(v??"").replace(/\s/g,"").replace(",","."));
    return Number.isFinite(n) ? n : d;
  };
  
  const money = (n) => AsgardUI.money(Math.round(Number(n || 0))) + ' ₽';
  
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
    
    const marginPct = clamp(num(state.margin_pct), 5, 100);
    const priceNoVat = costTotal / (1 - marginPct/100);
    const profitBeforeTax = priceNoVat - costTotal;
    const profitTax = profitBeforeTax * ((s.profit_tax_pct || 20) / 100);
    const netProfit = profitBeforeTax - profitTax;
    const priceWithVat = priceNoVat * (1 + (s.vat_pct || 22)/100);
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
      profit_tax: profitTax, net_profit: netProfit, vat_pct: s.vat_pct || 22, price_with_vat: priceWithVat,
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
    const conds = (s.surcharges || []).filter(x => !x.roles).map(x => `<label class="cbl"><input type="checkbox" data-cond="${x.id}"${st.conditions?.includes(x.id)?' checked':''}> ${x.name} (+${x.pct}%)</label>`).join('');
    return `
      <div class="csec"><h3>📋 Тендер</h3>
        <div class="fr"><div><label>Заказчик</label><input class="inp" value="${esc(st.customer_name)}" disabled></div><div><label>Объект</label><input class="inp" value="${esc(st.tender_title)}" disabled></div></div>
      </div>
      <div class="csec"><h3>🎯 Тип работы</h3>
        <div id="cr-wt-wrap"></div>
      </div>
      <div class="csec"><h3>📍 Место выполнения</h3>
        <div class="fr">
          <div>
            <label>Город <small style="color:var(--muted)">(выберите из списка или введите любой)</small></label>
            <div id="cr-city-wrap"></div>
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
        return `<div><label>${esc(p.name)}</label><div id="cr-param-${p.id}"></div></div>`;
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
    const surchs = (s.surcharges||[]).map(x => `<label class="cbl"><input type="checkbox" data-sur="${x.id}"${st.surcharges?.includes(x.id)?' checked':''}> ${x.name} (+${x.pct}%)</label>`).join('');
    return `<div class="csec"><h3>👷 Бригада</h3>
      <label class="cbl"><input type="checkbox" id="crewMan"${st.crew_manual?' checked':''}> Ручной режим</label>
      <table class="tbl"><thead><tr><th>Роль</th><th>Кол-во</th><th>Ставка</th><th></th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td>Итого</td><td><b>${total}</b></td><td></td><td></td></tr></tfoot></table>
      <div style="display:flex;gap:8px;margin-top:12px"><div id="cr-addRole-wrap"></div><button class="btn ghost" id="addCrewBtn">+ Добавить</button></div></div>
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
    return `<div class="csec"><h3>🧪 Химия</h3>
      <label class="cbl"><input type="checkbox" id="chemMan"${st.chem_manual?' checked':''}> Ручной режим</label>
      <table class="tbl"><thead><tr><th>Состав</th><th>Кг</th><th>Цена</th><th>Сумма</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="5" class="help">Нет</td></tr>'}</tbody><tfoot><tr><td colspan="3">Итого</td><td><b>${money(total)}</b></td><td></td></tr></tfoot></table>
      <div style="display:flex;gap:8px;margin-top:12px"><div id="cr-addChem-wrap"></div><button class="btn ghost" id="addChemBtn">+ Добавить</button></div></div>`;
  }

  function tabEquip(st, s) {
    const all = window.CALC_EQUIPMENT || [];
    const rows = (st.equipment||[]).map((eq,i) => {
      const item = all.find(e => e.id === eq.id);
      if (!item) return '';
      const rate = eq.rent ? (item.rent_day||item.amort_day||0) : (item.amort_day||0);
      return `<tr><td>${esc(item.name)}</td><td><input class="inp" type="number" min="1" data-eqi="${i}" value="${eq.qty||1}" style="width:60px"></td>
        <td><div id="cr-eqr-${i}"></div></td>
        <td>${money(rate)}/сут</td><td><button class="btn ghost mini" data-eqdel="${i}">✕</button></td></tr>`;
    }).join('');
    return `<div class="csec"><h3>🔧 Оборудование</h3>
      <label class="cbl"><input type="checkbox" id="equipMan"${st.equip_manual?' checked':''}> Ручной режим</label>
      <table class="tbl"><thead><tr><th>Позиция</th><th>Кол.</th><th>Тип</th><th>Ставка</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="5" class="help">Нет</td></tr>'}</tbody></table>
      <div style="display:flex;gap:8px;margin-top:12px"><div id="cr-addEq-wrap"></div><button class="btn ghost" id="addEqBtn">+ Добавить</button></div></div>`;
  }
  
  function tabLogistics(st, s, sum) {
    return `<div class="csec"><h3>🚛 Доставка</h3>
      <div id="cr-tr-wrap"></div>
      <div class="kpi4"><div class="k"><div class="t">Груз</div><div class="v">${Math.round(sum.total_weight_kg)} кг</div></div><div class="k"><div class="t">Транспорт</div><div class="v">${sum.transport?.name||'—'}</div></div><div class="k"><div class="t">Расстояние</div><div class="v">${sum.distance_km} км ×2</div></div><div class="k"><div class="t">Итого</div><div class="v">${money(sum.logistics_total)}</div></div></div></div>
      <div class="csec"><h3>🏨 Проживание</h3><div id="cr-lod-wrap"></div>
      <div class="kpi3"><div class="k"><div class="t">Ставка</div><div class="v">${money(s.lodging?.[st.lodging_type]?.rate_per_day||2500)}/сут</div></div><div class="k"><div class="t">Чел×Дней</div><div class="v">${sum.people_count}×${sum.total_days}</div></div><div class="k"><div class="t">Итого</div><div class="v">${money(sum.lodging_total)}</div></div></div></div>
      <div class="csec"><h3>✈️ Мобилизация</h3><div id="cr-mob-wrap"></div>
      <div class="kpi3"><div class="k"><div class="t">Способ</div><div class="v">${s.mobilization?.[sum.mobilization_type]?.name||'Авто'}</div></div><div class="k"><div class="t">Чел×2</div><div class="v">${sum.people_count}×2</div></div><div class="k"><div class="t">Итого</div><div class="v">${money(sum.mobilization_total)}</div></div></div></div>`;
  }
  
  function tabTotals(st, s, sum) {
    const col = { red: '#e03a4a', yellow: 'var(--amber)', green: 'var(--ok-t)' };
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
        <div class="fr"><div><label>Маржа, %</label><input class="inp" type="number" id="c_margin" min="5" max="100" value="${st.margin_pct||20}"></div></div>
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
        .calc-tabs .tab{padding:8px 12px;border-radius:6px;background:rgba(13,20,40,.5);border:none;cursor:pointer;font-size:12px}
        .calc-tabs .tab.active{background:rgba(42,108,241,.3);border-color:var(--accent)}
        .calc-tabs .tab.warn{border-color:rgba(245,158,11,.6)}
        .csec{background:rgba(13,20,40,.4);border:none;border-radius:6px;padding:16px;margin-bottom:16px}
        .csec h3{margin:0 0 12px;font-size:14px;color:var(--gold)}
        .cbl{display:flex;align-items:center;gap:8px;cursor:pointer;padding:4px 0}
        .cbl input{width:18px;height:18px}
        .cgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px}
        .fr{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
        .tbl{width:100%;border-collapse:collapse}
        .tbl th,.tbl td{padding:8px 10px;text-align:left;border-bottom:1px solid rgba(255,255,255,.04)}
        .tbl th{font-size:11px;color:var(--muted);font-weight:600}
        .tbl tfoot td{font-weight:600;background:rgba(42,108,241,.1)}
        .kpi3,.kpi4{display:grid;gap:12px;margin-top:12px}
        .kpi3{grid-template-columns:repeat(3,1fr)}
        .kpi4{grid-template-columns:repeat(4,1fr)}
        .k{background:rgba(13,20,40,.5);border-radius:6px;padding:12px;text-align:center}
        .k .t{font-size:11px;color:var(--muted)}
        .k .v{font-size:18px;font-weight:700;color:var(--gold)}
        .mini{padding:4px 8px;font-size:11px}
        @media(max-width:768px){.kpi3{grid-template-columns:repeat(2,1fr)}.kpi4{grid-template-columns:repeat(2,1fr)}}
        @media(max-width:480px){.kpi3{grid-template-columns:1fr}.kpi4{grid-template-columns:1fr}}
      </style>
      <div class="help" style="margin-bottom:12px"><b>ᚱ ${CALC_NAME}</b> — ${esc(st.customer_name)}</div>
      ${tabs(tab)}
      <div id="tabContent">${content}</div>
      <div style="margin-top:16px;padding:12px;background:rgba(13,20,40,.5);border-radius:6px;display:flex;justify-content:space-between">
        <div><span style="color:var(--muted)">Цена с НДС:</span> <b style="font-size:18px;color:var(--gold)">${money(sum.price_with_vat)}</b></div>
        <div><span style="color:var(--muted)">Прибыль/чел-день:</span> <b style="font-size:18px;color:${sum.status==='green'?'var(--ok-t)':sum.status==='yellow'?'var(--amber)':'#e03a4a'}">${money(sum.profit_per_day)}</b></div>
      </div>`;
      
      showModal("Калькулятор просчёта", html, { wide: true });
      bind();
    }
    
    function bind() {
      $$('.calc-tabs .tab').forEach(btn => btn.onclick = () => { tab = btn.dataset.tab; render(); });

      // Object tab
      const wtWrap = $('#cr-wt-wrap'); if(wtWrap) { const wtOpts = (s.work_types || []).map(w => ({ value: w.id, label: (w.icon||'') + ' ' + w.name })); wtWrap.appendChild(CRSelect.create({ id: 'c_wt', options: wtOpts, value: st.work_type_id, placeholder: 'Тип работы...', onChange: (v) => { st.work_type_id = v; st.params = {}; st.crew_manual = st.days_manual = st.chem_manual = st.equip_manual = false; render(); } })); }
      const cityWrap = $('#cr-city-wrap'); if(cityWrap) { cityWrap.appendChild(CRAutocomplete.create({ id: 'c_city', value: st.city, placeholder: 'Москва, Екатеринбург, Сургут...', minChars: 2, fullWidth: true, inputClass: 'inp', fetchOptions: async (q) => { if(!window.findCity) return []; return window.findCity(q).map(c => ({ value: c.name, label: c.name, sublabel: c.km + ' км от Москвы', km: c.km })); }, onSelect: (item) => { if(!item) return; st.city = item.label; if(item.km != null){ st.distance_km = item.km; const inp=$('#c_km'); if(inp) inp.value = item.km; } } })); const cityInput = CRAutocomplete.getInput('c_city'); if(cityInput) cityInput.addEventListener('input', () => { st.city = cityInput.value; }); }
      const km = $('#c_km'); if(km) km.oninput = () => { st.distance_km = num(km.value); };
      $$('[data-cond]').forEach(cb => cb.onchange = () => { const id = cb.dataset.cond; if(cb.checked){ if(!st.conditions.includes(id)) st.conditions.push(id); if(!st.surcharges.includes(id)) st.surcharges.push(id); } else { st.conditions = st.conditions.filter(x=>x!==id); st.surcharges = st.surcharges.filter(x=>x!==id); } });
      const assumptions = $('#c_assumptions'); if(assumptions) assumptions.oninput = () => { st.assumptions = assumptions.value; };
      
      // Params tab
      $$('[data-p]').forEach(inp => inp.oninput = () => { st.params[inp.dataset.p] = inp.type==='number' ? num(inp.value) : inp.value; });
      { const wt = s.work_types?.find(w => w.id === st.work_type_id); if(wt?.params?.length) { wt.params.forEach(p => { if(p.type === 'select') { const wrap = $('#cr-param-' + p.id); if(wrap) { const pOpts = (p.options||[]).map(o => ({ value: o, label: o })); wrap.appendChild(CRSelect.create({ id: 'param_' + p.id, options: pOpts, value: st.params[p.id] ?? '', placeholder: 'Выберите...', onChange: (v) => { st.params[p.id] = v; } })); } } }); } }
      const autoBtn = $('#autoBtn'); if(autoBtn) autoBtn.onclick = () => { st.crew_manual = st.days_manual = st.chem_manual = st.equip_manual = false; render(); toast("Авто","Пересчитано"); };

      // Crew tab
      const crewMan = $('#crewMan'); if(crewMan) crewMan.onchange = () => { st.crew_manual = crewMan.checked; };
      $$('[data-ci]').forEach(inp => inp.oninput = () => { const i = +inp.dataset.ci; if(st.crew[i]) { st.crew[i].count = num(inp.value); st.crew_manual = true; render(); } });
      $$('[data-cdel]').forEach(btn => btn.onclick = () => { st.crew.splice(+btn.dataset.cdel, 1); st.crew_manual = true; render(); });
      const addRoleWrap = $('#cr-addRole-wrap'); if(addRoleWrap) { const roleOpts = (s.roles||[]).map(r => ({ value: r.id, label: r.name })); addRoleWrap.appendChild(CRSelect.create({ id: 'addRole', options: roleOpts, value: roleOpts[0]?.value || '', placeholder: 'Роль...', onChange: () => {} })); }
      const addCrewBtn = $('#addCrewBtn'); if(addCrewBtn) addCrewBtn.onclick = () => { const rid = CRSelect.getValue('addRole'); if(rid && !st.crew.find(c=>c.role_id===rid)){ const role = s.roles?.find(r=>r.id===rid); st.crew.push({ role_id: rid, role_name: role?.name||rid, count: 1, per_diem: role?.per_diem||1000 }); st.crew_manual = true; render(); } };
      $$('[data-sur]').forEach(cb => cb.onchange = () => { const id = cb.dataset.sur; if(cb.checked){ if(!st.surcharges.includes(id)) st.surcharges.push(id); } else { st.surcharges = st.surcharges.filter(x=>x!==id); } render(); });

      // Time tab
      const daysMan = $('#daysMan'); if(daysMan) daysMan.onchange = () => { st.days_manual = daysMan.checked; };
      ['prep','work','demob'].forEach(k => { const inp = $(`#c_${k}`); if(inp) inp.oninput = () => { st[k+'_days'] = num(inp.value); st.days_manual = true; render(); }; });
      
      // Chem tab
      const chemMan = $('#chemMan'); if(chemMan) chemMan.onchange = () => { st.chem_manual = chemMan.checked; };
      $$('[data-chi]').forEach(inp => inp.oninput = () => { const i = +inp.dataset.chi; if(st.chemicals[i]) { st.chemicals[i].kg = num(inp.value); st.chem_manual = true; render(); } });
      $$('[data-chdel]').forEach(btn => btn.onclick = () => { st.chemicals.splice(+btn.dataset.chdel, 1); st.chem_manual = true; render(); });
      const addChemWrap = $('#cr-addChem-wrap'); if(addChemWrap) { const chemOpts = (s.chemicals||[]).map(c => ({ value: c.id, label: c.name + ' (' + c.price_kg + '\u20BD/\u043A\u0433)' })); addChemWrap.appendChild(CRSelect.create({ id: 'addChem', options: chemOpts, value: chemOpts[0]?.value || '', placeholder: 'Химия...', onChange: () => {} })); }
      const addChemBtn = $('#addChemBtn'); if(addChemBtn) addChemBtn.onclick = () => { const cid = CRSelect.getValue('addChem'); if(cid && !st.chemicals.find(c=>c.id===cid)){ st.chemicals.push({ id: cid, kg: 100 }); st.chem_manual = true; render(); } };

      // Equip tab
      const equipMan = $('#equipMan'); if(equipMan) equipMan.onchange = () => { st.equip_manual = equipMan.checked; };
      $$('[data-eqi]').forEach(inp => inp.oninput = () => { const i = +inp.dataset.eqi; if(st.equipment[i]) { st.equipment[i].qty = num(inp.value); st.equip_manual = true; render(); } });
      (st.equipment||[]).forEach((eq, i) => { const eqrWrap = $('#cr-eqr-' + i); if(eqrWrap) { eqrWrap.appendChild(CRSelect.create({ id: 'eqr_' + i, options: [{ value: '0', label: 'Наше' }, { value: '1', label: 'Аренда' }], value: eq.rent ? '1' : '0', searchable: false, onChange: (v) => { if(st.equipment[i]) { st.equipment[i].rent = v === '1'; st.equip_manual = true; render(); } } })); } });
      $$('[data-eqdel]').forEach(btn => btn.onclick = () => { st.equipment.splice(+btn.dataset.eqdel, 1); st.equip_manual = true; render(); });
      const addEqWrap = $('#cr-addEq-wrap'); if(addEqWrap) { const allEq = window.CALC_EQUIPMENT || []; const eqCats = [...new Set(allEq.map(e => e.category))]; const eqGrouped = eqCats.map(cat => ({ group: cat, items: allEq.filter(e => e.category === cat).map(e => ({ value: e.id, label: e.name })) })); addEqWrap.appendChild(CRSelect.create({ id: 'addEq', options: eqGrouped, value: '', placeholder: 'Оборудование...', onChange: () => {} })); }
      const addEqBtn = $('#addEqBtn'); if(addEqBtn) addEqBtn.onclick = () => { const eid = CRSelect.getValue('addEq'); if(eid && !st.equipment.find(e=>e.id===eid)){ st.equipment.push({ id: eid, qty: 1, rent: false }); st.equip_manual = true; render(); } };

      // Logistics tab
      const trWrap = $('#cr-tr-wrap'); if(trWrap) { const trOpts = [{ value: 'auto', label: '\uD83E\uDD16 Авто' }].concat((s.transport||[]).map(t => ({ value: t.id, label: t.name + ' (до ' + (t.max_kg/1000) + 'т) \u2014 ' + t.rate_km + '\u20BD/км' }))); trWrap.appendChild(CRSelect.create({ id: 'c_tr', options: trOpts, value: st.transport_id, placeholder: 'Транспорт...', onChange: (v) => { st.transport_id = v; render(); } })); }
      const lodWrap = $('#cr-lod-wrap'); if(lodWrap) { const lodOpts = Object.entries(s.lodging||{}).map(([id,l]) => ({ value: id, label: l.name + ' \u2014 ' + l.rate_per_day + '\u20BD/сут' })); lodWrap.appendChild(CRSelect.create({ id: 'c_lod', options: lodOpts, value: st.lodging_type, placeholder: 'Проживание...', onChange: (v) => { st.lodging_type = v; render(); } })); }
      const mobWrap = $('#cr-mob-wrap'); if(mobWrap) { const mobOpts = [{ value: 'auto', label: '\uD83E\uDD16 Авто' }].concat(Object.entries(s.mobilization||{}).map(([id,m]) => ({ value: id, label: m.name + ' \u2014 ' + m.rate_per_person + '\u20BD/чел' }))); mobWrap.appendChild(CRSelect.create({ id: 'c_mob', options: mobOpts, value: st.mobilization_type, placeholder: 'Мобилизация...', onChange: (v) => { st.mobilization_type = v; render(); } })); }
      
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
        window._asgardCalcExcelExport(st, s, sum, toast);
      };
    }
    
    render();
  }
  
  /**
   * Рендер калькулятора как автономной страницы (не модалка).
   * Используется маршрутом /calculator.
   */
  async function renderPage(container) {
    const s = await getSettings();
    let st = createState(null);
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

      container.innerHTML = `
        <style>
          .calc-page{max-width:1000px;margin:0 auto}
          .calc-tabs{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:16px}
          .calc-tabs .tab{padding:8px 12px;border-radius:6px;background:rgba(13,20,40,.5);border:none;cursor:pointer;font-size:12px}
          .calc-tabs .tab.active{background:rgba(42,108,241,.3);border-color:var(--accent)}
          .calc-tabs .tab.warn{border-color:rgba(245,158,11,.6)}
          .csec{background:rgba(13,20,40,.4);border:none;border-radius:6px;padding:16px;margin-bottom:16px}
          .csec h3{margin:0 0 12px;font-size:14px;color:var(--gold)}
          .cbl{display:flex;align-items:center;gap:8px;cursor:pointer;padding:4px 0}
          .cbl input{width:18px;height:18px}
          .cgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px}
          .fr{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
          .tbl{width:100%;border-collapse:collapse}
          .tbl th,.tbl td{padding:8px 10px;text-align:left;border-bottom:1px solid rgba(255,255,255,.04)}
          .tbl th{font-size:11px;color:var(--muted);font-weight:600}
          .tbl tfoot td{font-weight:600;background:rgba(42,108,241,.1)}
          .kpi3,.kpi4{display:grid;gap:12px;margin-top:12px}
          .kpi3{grid-template-columns:repeat(3,1fr)}
          .kpi4{grid-template-columns:repeat(4,1fr)}
          .k{background:rgba(13,20,40,.5);border-radius:6px;padding:12px;text-align:center}
          .k .t{font-size:11px;color:var(--muted)}
          .k .v{font-size:18px;font-weight:700;color:var(--gold)}
          .mini{padding:4px 8px;font-size:11px}
          .calc-bottom-bar{margin-top:16px;padding:16px;background:rgba(13,20,40,.5);border-radius:6px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px}
          @media(max-width:768px){
            .calc-bottom-bar{flex-direction:column;text-align:center}
            .kpi3{grid-template-columns:repeat(2,1fr)}
            .kpi4{grid-template-columns:repeat(2,1fr)}
          }
          @media(max-width:480px){
            .kpi3{grid-template-columns:1fr}
            .kpi4{grid-template-columns:1fr}
          }
        </style>
        <div class="calc-page">
          <div class="help" style="margin-bottom:12px">
            <b>ᚱ Рунический Калькулятор</b> — автономный расчёт стоимости работ
          </div>
          ${tabs(tab)}
          <div id="tabContent">${content}</div>
          <div class="calc-bottom-bar">
            <div>
              <span style="color:var(--muted)">Цена с НДС:</span>
              <b style="font-size:18px;color:var(--gold)">${money(sum.price_with_vat)}</b>
            </div>
            <div>
              <span style="color:var(--muted)">Прибыль/чел-день:</span>
              <b style="font-size:18px;color:${sum.status==='green'?'var(--ok-t)':sum.status==='yellow'?'var(--amber)':'#e03a4a'}">${money(sum.profit_per_day)}</b>
            </div>
          </div>
        </div>`;

      bindPage();
    }

    function bindPage() {
      $$('.calc-tabs .tab').forEach(btn => btn.onclick = () => { tab = btn.dataset.tab; render(); });

      // Object tab
      const wtWrap = $('#cr-wt-wrap'); if(wtWrap) { const wtOpts = (s.work_types || []).map(w => ({ value: w.id, label: (w.icon||'') + ' ' + w.name })); wtWrap.appendChild(CRSelect.create({ id: 'c_wt', options: wtOpts, value: st.work_type_id, placeholder: 'Тип работы...', onChange: (v) => { st.work_type_id = v; st.params = {}; st.crew_manual = st.days_manual = st.chem_manual = st.equip_manual = false; render(); } })); }
      const cityWrap = $('#cr-city-wrap'); if(cityWrap) { cityWrap.appendChild(CRAutocomplete.create({ id: 'c_city', value: st.city, placeholder: 'Москва, Екатеринбург, Сургут...', minChars: 2, fullWidth: true, inputClass: 'inp', fetchOptions: async (q) => { if(!window.findCity) return []; return window.findCity(q).map(c => ({ value: c.name, label: c.name, sublabel: c.km + ' км от Москвы', km: c.km })); }, onSelect: (item) => { if(!item) return; st.city = item.label; if(item.km != null){ st.distance_km = item.km; const inp=$('#c_km'); if(inp) inp.value = item.km; } } })); const cityInput = CRAutocomplete.getInput('c_city'); if(cityInput) cityInput.addEventListener('input', () => { st.city = cityInput.value; }); }
      const km = $('#c_km'); if(km) km.oninput = () => { st.distance_km = num(km.value); };
      $$('[data-cond]').forEach(cb => cb.onchange = () => { const id = cb.dataset.cond; if(cb.checked){ if(!st.conditions.includes(id)) st.conditions.push(id); if(!st.surcharges.includes(id)) st.surcharges.push(id); } else { st.conditions = st.conditions.filter(x=>x!==id); st.surcharges = st.surcharges.filter(x=>x!==id); } });
      const assumptions = $('#c_assumptions'); if(assumptions) assumptions.oninput = () => { st.assumptions = assumptions.value; };

      // Params tab
      $$('[data-p]').forEach(inp => inp.oninput = () => { st.params[inp.dataset.p] = inp.type==='number' ? num(inp.value) : inp.value; });
      { const wt = s.work_types?.find(w => w.id === st.work_type_id); if(wt?.params?.length) { wt.params.forEach(p => { if(p.type === 'select') { const wrap = $('#cr-param-' + p.id); if(wrap) { const pOpts = (p.options||[]).map(o => ({ value: o, label: o })); wrap.appendChild(CRSelect.create({ id: 'param_' + p.id, options: pOpts, value: st.params[p.id] ?? '', placeholder: 'Выберите...', onChange: (v) => { st.params[p.id] = v; } })); } } }); } }
      const autoBtn = $('#autoBtn'); if(autoBtn) autoBtn.onclick = () => { st.crew_manual = st.days_manual = st.chem_manual = st.equip_manual = false; render(); toast("Авто","Пересчитано"); };

      // Crew tab
      const crewMan = $('#crewMan'); if(crewMan) crewMan.onchange = () => { st.crew_manual = crewMan.checked; };
      $$('[data-ci]').forEach(inp => inp.oninput = () => { const i = +inp.dataset.ci; if(st.crew[i]) { st.crew[i].count = num(inp.value); st.crew_manual = true; render(); } });
      $$('[data-cdel]').forEach(btn => btn.onclick = () => { st.crew.splice(+btn.dataset.cdel, 1); st.crew_manual = true; render(); });
      const addRoleWrap = $('#cr-addRole-wrap'); if(addRoleWrap) { const roleOpts = (s.roles||[]).map(r => ({ value: r.id, label: r.name })); addRoleWrap.appendChild(CRSelect.create({ id: 'addRole', options: roleOpts, value: roleOpts[0]?.value || '', placeholder: 'Роль...', onChange: () => {} })); }
      const addCrewBtn = $('#addCrewBtn'); if(addCrewBtn) addCrewBtn.onclick = () => { const rid = CRSelect.getValue('addRole'); if(rid && !st.crew.find(c=>c.role_id===rid)){ const role = s.roles?.find(r=>r.id===rid); st.crew.push({ role_id: rid, role_name: role?.name||rid, count: 1, per_diem: role?.per_diem||1000 }); st.crew_manual = true; render(); } };
      $$('[data-sur]').forEach(cb => cb.onchange = () => { const id = cb.dataset.sur; if(cb.checked){ if(!st.surcharges.includes(id)) st.surcharges.push(id); } else { st.surcharges = st.surcharges.filter(x=>x!==id); } render(); });

      // Time tab
      const daysMan = $('#daysMan'); if(daysMan) daysMan.onchange = () => { st.days_manual = daysMan.checked; };
      ['prep','work','demob'].forEach(k => { const inp = $(`#c_${k}`); if(inp) inp.oninput = () => { st[k+'_days'] = num(inp.value); st.days_manual = true; render(); }; });

      // Chem tab
      const chemMan = $('#chemMan'); if(chemMan) chemMan.onchange = () => { st.chem_manual = chemMan.checked; };
      $$('[data-chi]').forEach(inp => inp.oninput = () => { const i = +inp.dataset.chi; if(st.chemicals[i]) { st.chemicals[i].kg = num(inp.value); st.chem_manual = true; render(); } });
      $$('[data-chdel]').forEach(btn => btn.onclick = () => { st.chemicals.splice(+btn.dataset.chdel, 1); st.chem_manual = true; render(); });
      const addChemWrap = $('#cr-addChem-wrap'); if(addChemWrap) { const chemOpts = (s.chemicals||[]).map(c => ({ value: c.id, label: c.name + ' (' + c.price_kg + '\u20BD/\u043A\u0433)' })); addChemWrap.appendChild(CRSelect.create({ id: 'addChem', options: chemOpts, value: chemOpts[0]?.value || '', placeholder: 'Химия...', onChange: () => {} })); }
      const addChemBtn = $('#addChemBtn'); if(addChemBtn) addChemBtn.onclick = () => { const cid = CRSelect.getValue('addChem'); if(cid && !st.chemicals.find(c=>c.id===cid)){ st.chemicals.push({ id: cid, kg: 100 }); st.chem_manual = true; render(); } };

      // Equip tab
      const equipMan = $('#equipMan'); if(equipMan) equipMan.onchange = () => { st.equip_manual = equipMan.checked; };
      $$('[data-eqi]').forEach(inp => inp.oninput = () => { const i = +inp.dataset.eqi; if(st.equipment[i]) { st.equipment[i].qty = num(inp.value); st.equip_manual = true; render(); } });
      (st.equipment||[]).forEach((eq, i) => { const eqrWrap = $('#cr-eqr-' + i); if(eqrWrap) { eqrWrap.appendChild(CRSelect.create({ id: 'eqr_' + i, options: [{ value: '0', label: 'Наше' }, { value: '1', label: 'Аренда' }], value: eq.rent ? '1' : '0', searchable: false, onChange: (v) => { if(st.equipment[i]) { st.equipment[i].rent = v === '1'; st.equip_manual = true; render(); } } })); } });
      $$('[data-eqdel]').forEach(btn => btn.onclick = () => { st.equipment.splice(+btn.dataset.eqdel, 1); st.equip_manual = true; render(); });
      const addEqWrap = $('#cr-addEq-wrap'); if(addEqWrap) { const allEq = window.CALC_EQUIPMENT || []; const eqCats = [...new Set(allEq.map(e => e.category))]; const eqGrouped = eqCats.map(cat => ({ group: cat, items: allEq.filter(e => e.category === cat).map(e => ({ value: e.id, label: e.name })) })); addEqWrap.appendChild(CRSelect.create({ id: 'addEq', options: eqGrouped, value: '', placeholder: 'Оборудование...', onChange: () => {} })); }
      const addEqBtn = $('#addEqBtn'); if(addEqBtn) addEqBtn.onclick = () => { const eid = CRSelect.getValue('addEq'); if(eid && !st.equipment.find(e=>e.id===eid)){ st.equipment.push({ id: eid, qty: 1, rent: false }); st.equip_manual = true; render(); } };

      // Logistics tab
      const trWrap = $('#cr-tr-wrap'); if(trWrap) { const trOpts = [{ value: 'auto', label: '\uD83E\uDD16 Авто' }].concat((s.transport||[]).map(t => ({ value: t.id, label: t.name + ' (до ' + (t.max_kg/1000) + 'т) \u2014 ' + t.rate_km + '\u20BD/км' }))); trWrap.appendChild(CRSelect.create({ id: 'c_tr', options: trOpts, value: st.transport_id, placeholder: 'Транспорт...', onChange: (v) => { st.transport_id = v; render(); } })); }
      const lodWrap = $('#cr-lod-wrap'); if(lodWrap) { const lodOpts = Object.entries(s.lodging||{}).map(([id,l]) => ({ value: id, label: l.name + ' \u2014 ' + l.rate_per_day + '\u20BD/сут' })); lodWrap.appendChild(CRSelect.create({ id: 'c_lod', options: lodOpts, value: st.lodging_type, placeholder: 'Проживание...', onChange: (v) => { st.lodging_type = v; render(); } })); }
      const mobWrap = $('#cr-mob-wrap'); if(mobWrap) { const mobOpts = [{ value: 'auto', label: '\uD83E\uDD16 Авто' }].concat(Object.entries(s.mobilization||{}).map(([id,m]) => ({ value: id, label: m.name + ' \u2014 ' + m.rate_per_person + '\u20BD/чел' }))); mobWrap.appendChild(CRSelect.create({ id: 'c_mob', options: mobOpts, value: st.mobilization_type, placeholder: 'Мобилизация...', onChange: (v) => { st.mobilization_type = v; render(); } })); }

      // Totals tab
      const margin = $('#c_margin'); if(margin) margin.oninput = () => { st.margin_pct = num(margin.value); render(); };

      // Excel-экспорт (используем общую функцию)
      const exportBtn = $('#exportBtn'); if(exportBtn) exportBtn.onclick = () => {
        const sum = compute(st, s);
        window._asgardCalcExcelExport(st, s, sum, toast);
      };
    }

    render();
  }

  window.AsgardCalcV2 = { open, renderPage, compute, getSettings };
  console.log('[CALC] Calculator v2 loaded');
})();

// ============================================================================
// АСГАРД CRM — Профессиональный Excel-экспорт из Рунического Калькулятора
// Формат: полный отчёт «Просчёт стоимости работ» для директора / печати А4
// Библиотека: xlsx-js-style (поддержка стилей ячеек)
// ============================================================================

(function() {
  'use strict';

  // ═══════════════════════════════════════════
  // Сумма прописью (русский язык)
  // ═══════════════════════════════════════════
  function sumInWords(n) {
    n = Math.round(Math.abs(n));
    if (n === 0) return 'Ноль рублей 00 копеек';
    const ones = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять',
      'десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать',
      'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
    const tens = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
    const hunds = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];
    function group(num, fem) {
      let r = '';
      const h = Math.floor(num / 100), t = Math.floor((num % 100) / 10), o = num % 10;
      if (h) r += hunds[h] + ' ';
      if (t >= 2) { r += tens[t] + ' '; if (o) r += (fem && o <= 2 ? (o === 1 ? 'одна' : 'две') : ones[o]) + ' '; }
      else if (num % 100 >= 1 && num % 100 <= 19) { r += (fem && num % 100 <= 2 ? (num % 100 === 1 ? 'одна' : 'две') : ones[num % 100]) + ' '; }
      return r;
    }
    function decline(n, f1, f2, f5) {
      const m = n % 100;
      if (m >= 11 && m <= 19) return f5;
      const d = m % 10;
      if (d === 1) return f1;
      if (d >= 2 && d <= 4) return f2;
      return f5;
    }
    let result = '';
    const billions = Math.floor(n / 1e9);
    const millions = Math.floor((n % 1e9) / 1e6);
    const thousands = Math.floor((n % 1e6) / 1e3);
    const remainder = n % 1e3;
    if (billions) result += group(billions, false) + decline(billions, 'миллиард ', 'миллиарда ', 'миллиардов ');
    if (millions) result += group(millions, false) + decline(millions, 'миллион ', 'миллиона ', 'миллионов ');
    if (thousands) result += group(thousands, true) + decline(thousands, 'тысяча ', 'тысячи ', 'тысяч ');
    if (remainder) result += group(remainder, false);
    result = result.trim();
    result += ' ' + decline(remainder || (thousands ? thousands : 0), 'рубль', 'рубля', 'рублей') + ' 00 копеек';
    return result.charAt(0).toUpperCase() + result.slice(1);
  }

  // ═══════════════════════════════════════════
  // Хелпер: установить стиль ячейки
  // ═══════════════════════════════════════════
  function sc(ws, r, c, style) {
    const ref = XLSX.utils.encode_cell({ r, c });
    if (!ws[ref]) ws[ref] = { v: '', t: 's' };
    ws[ref].s = style;
  }

  function scRange(ws, r1, c1, r2, c2, style) {
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        sc(ws, r, c, style);
      }
    }
  }

  function setNumFmt(ws, r, c, fmt) {
    const ref = XLSX.utils.encode_cell({ r, c });
    if (ws[ref]) ws[ref].z = fmt;
  }

  // ═══════════════════════════════════════════
  // Стили (ASGARD Brand: темно-синий + золото)
  // HEADER_FILL = 1A2D52
  // ═══════════════════════════════════════════
  const BRAND_DARK  = '0D1428';
  const BRAND_NAVY  = '1A2D52';
  const BRAND_GOLD  = 'C8A85C';
  const BRAND_LIGHT = 'F2F6FC';
  const WHITE       = 'FFFFFF';
  const GRAY_TEXT   = '666666';
  const BLACK       = '000000';
  const GOLD_FILL   = 'FFF8E7';

  const BORDER_THIN = {
    top:    { style: 'thin', color: { rgb: '999999' } },
    bottom: { style: 'thin', color: { rgb: '999999' } },
    left:   { style: 'thin', color: { rgb: '999999' } },
    right:  { style: 'thin', color: { rgb: '999999' } }
  };
  const BORDER_MEDIUM = {
    top:    { style: 'medium', color: { rgb: BRAND_NAVY } },
    bottom: { style: 'medium', color: { rgb: BRAND_NAVY } },
    left:   { style: 'medium', color: { rgb: BRAND_NAVY } },
    right:  { style: 'medium', color: { rgb: BRAND_NAVY } }
  };
  const BORDER_BOTTOM_DOUBLE = {
    top:    { style: 'thin', color: { rgb: '999999' } },
    bottom: { style: 'double', color: { rgb: BRAND_NAVY } },
    left:   { style: 'thin', color: { rgb: '999999' } },
    right:  { style: 'thin', color: { rgb: '999999' } }
  };
  const BORDER_TOP_MEDIUM = {
    top:    { style: 'medium', color: { rgb: BRAND_NAVY } },
    bottom: { style: 'thin', color: { rgb: '999999' } },
    left:   { style: 'thin', color: { rgb: '999999' } },
    right:  { style: 'thin', color: { rgb: '999999' } }
  };

  const FMT_NUM  = '#,##0';
  const FMT_NUM2 = '#,##0.00';

  // ═══════════════════════════════════════════
  // Главная функция экспорта
  // ═══════════════════════════════════════════
  window._asgardCalcExcelExport = function(st, s, sum, toast) {

    // Fallback на txt если XLSX не загружен
    if (typeof XLSX === 'undefined') {
      const money = (n) => AsgardUI.money(Math.round(Number(n || 0))) + ' р.';
      const txt = [
        'АСГАРД СЕРВИС',
        '═══════════════════════════════════════',
        'ПРОСЧЁТ СТОИМОСТИ РАБОТ',
        '',
        'Заказчик: ' + (st.customer_name || '—'),
        'Объект: ' + (st.tender_title || '—'),
        'Город: ' + (st.city || '—') + ' (' + (st.distance_km || 0) + ' км)',
        'Бригада: ' + sum.people_count + ' чел',
        'Сроки: ' + sum.work_days + ' дней',
        '',
        'Цена без НДС: ' + money(sum.price_no_vat),
        'НДС ' + sum.vat_pct + '%: ' + money(sum.price_with_vat - sum.price_no_vat),
        'ИТОГО С НДС: ' + money(sum.price_with_vat),
        '',
        'Дата: ' + new Date().toLocaleDateString('ru-RU')
      ].join('\n');
      const blob = new Blob([txt], { type: 'text/plain' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = 'calc_' + (st.tender_id || 'new') + '.txt'; a.click();
      toast('Экспорт', 'Файл скачан (TXT — XLSX не загружен)');
      return;
    }

    try {
      const wb = XLSX.utils.book_new();
      const dateNow = new Date().toLocaleDateString('ru-RU');
      const wt = s.work_types ? s.work_types.find(function(w) { return w.id === st.work_type_id; }) : null;
      const vatPct = sum.vat_pct || 22;
      const vatMult = vatPct / 100;

      function line(n, name, unit, qty, priceNoVat) {
        const sumNoVat = Math.round(priceNoVat);
        const vatAmt   = Math.round(sumNoVat * vatMult);
        const sumVat   = sumNoVat + vatAmt;
        const unitPrice = qty > 0 ? Math.round(sumNoVat / qty) : 0;
        return [n, name, unit, qty, unitPrice, sumNoVat, vatAmt, sumVat];
      }

      const costTotal = sum.cost_total || 1;
      function priceShare(costItem) {
        return Math.round((costItem / costTotal) * sum.price_no_vat);
      }

      var dataRows = [
        line(1,  'Фонд оплаты труда (работа, подготовка, демобилизация)', 'чел-дн', sum.people_count * sum.total_days, priceShare(sum.payroll_total)),
        line(2,  'Налоги и отчисления на ФОТ (' + (s.fot_tax_pct || 50) + '%)', 'усл.',   1, priceShare(sum.fot_tax)),
        line(3,  'Суточные', 'чел-дн', sum.people_count * sum.total_days, priceShare(sum.per_diem_total)),
        line(4,  'Проживание', 'чел-дн', sum.people_count * sum.total_days, priceShare(sum.lodging_total)),
        line(5,  'Мобилизация / демобилизация персонала', 'чел',   sum.people_count * 2, priceShare(sum.mobilization_total)),
        line(6,  'Химические реагенты и составы', 'компл.', 1, priceShare(sum.chem_total)),
        line(7,  'Расходные материалы', 'компл.', 1, priceShare(sum.consumables)),
        line(8,  'Оборудование и инструмент', 'компл.', 1, priceShare(sum.equip_total)),
        line(9,  'Логистика (' + (sum.transport ? sum.transport.name : 'авто') + ', ' + (st.distance_km || 0) + ' км x 2)', 'рейс', 1, priceShare(sum.logistics_total)),
        line(10, 'Средства индивидуальной защиты (СИЗ)', 'чел',   sum.people_count, priceShare(sum.ppe_total)),
        line(11, 'Накладные расходы (' + (sum.overhead_pct || 10) + '%)', 'усл.',   1, priceShare(sum.overhead))
      ];

      var totalNoVat = Math.round(sum.price_no_vat);
      var totalVatAmt = Math.round(sum.price_with_vat - sum.price_no_vat);
      var totalWithVat = Math.round(sum.price_with_vat);

      var aoa = [];
      aoa.push(['', '', '', '', '', '', '', '']);
      aoa.push(['АСГАРД СЕРВИС', '', '', '', '', '', '', '']);
      aoa.push(['ООО "Асгард-Сервис"', '', '', '', '', '', '', '']);
      aoa.push(['Большая Почтовая ул., д. 55/59, стр. 1, помещ. №37, Москва, 105082', '', '', '', '', '', '', '']);
      aoa.push(['Тел.: +7 (499) 322-30-62  |  info@asgard-service.ru  |  www.asgard-service.ru', '', '', '', '', '', '', '']);
      aoa.push(['', '', '', '', '', '', '', '']);
      aoa.push(['', '', '', '', '', '', '', '']);
      aoa.push(['ПРОСЧЁТ СТОИМОСТИ РАБОТ', '', '', '', '', '', '', '']);
      aoa.push(['', '', '', '', '', '', '', '']);
      aoa.push(['', '', '', '', '', '', '', '']);
      aoa.push(['Заказчик:', st.customer_name || '—', '', '', '', 'Дата расчёта:', dateNow, '']);
      aoa.push(['Объект:', st.tender_title || '—', '', '', '', 'Вид работ:', (wt ? wt.name : '—'), '']);
      aoa.push(['Город:', (st.city || '—') + (st.distance_km ? ' (' + st.distance_km + ' км)' : ''), '', '', '', 'Бригада:', sum.people_count + ' чел, ' + sum.total_days + ' дней', '']);
      aoa.push(['', '', '', '', '', '', '', '']);
      aoa.push(['№', 'Наименование работ / услуг', 'Ед. изм.', 'Кол-во', 'Цена без НДС, руб.', 'Сумма без НДС, руб.', 'НДС (' + vatPct + '%), руб.', 'Сумма с НДС, руб.']);
      for (var i = 0; i < dataRows.length; i++) {
        aoa.push(dataRows[i]);
      }
      aoa.push(['', 'Итого без НДС:', '', '', '', totalNoVat, '', '']);
      aoa.push(['', 'НДС (' + vatPct + '%):', '', '', '', '', totalVatAmt, '']);
      aoa.push(['', 'ИТОГО С НДС:', '', '', '', '', '', totalWithVat]);
      aoa.push(['', '', '', '', '', '', '', '']);
      aoa.push(['Итого к оплате: ' + sumInWords(totalWithVat), '', '', '', '', '', '', '']);
      aoa.push(['', '', '', '', '', '', '', '']);

      var assumptionsRow = -1;
      if (st.assumptions && st.assumptions.trim()) {
        aoa.push(['Допущения и примечания: ' + st.assumptions.trim(), '', '', '', '', '', '', '']);
        assumptionsRow = aoa.length - 1;
        aoa.push(['', '', '', '', '', '', '', '']);
      }

      var signRow = aoa.length;
      aoa.push(['Расчёт подготовил:', '', '_____________________', '', '/', '_____________________', '/', '']);
      aoa.push(['', '', '(подпись)', '', '', '(Ф.И.О.)', '', '']);
      aoa.push(['', '', '', '', '', '', '', '']);

      var footerRow1 = aoa.length;
      aoa.push(['ООО "Асгард-Сервис"  |  ИНН: 7736244785  |  КПП: 770101001  |  ОГРН: 1157746216498', '', '', '', '', '', '', '']);
      var footerRow2 = aoa.length;
      aoa.push(['Тел.: +7 (499) 322-30-62  |  info@asgard-service.ru  |  Большая Почтовая ул., д. 55/59, стр. 1, Москва, 105082', '', '', '', '', '', '', '']);

      var ws = XLSX.utils.aoa_to_sheet(aoa);

      ws['!cols'] = [
        { wch: 4  }, { wch: 38 }, { wch: 8  }, { wch: 8  },
        { wch: 15 }, { wch: 16 }, { wch: 14 }, { wch: 16 }
      ];

      ws['!rows'] = [];
      ws['!rows'][0]  = { hpt: 50 };
      ws['!rows'][1]  = { hpt: 28 };
      ws['!rows'][6]  = { hpt: 4 };
      ws['!rows'][7]  = { hpt: 30 };
      ws['!rows'][8]  = { hpt: 4 };
      ws['!rows'][14] = { hpt: 36 };

      ws['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 7 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: 7 } },
        { s: { r: 2, c: 0 }, e: { r: 2, c: 7 } },
        { s: { r: 3, c: 0 }, e: { r: 3, c: 7 } },
        { s: { r: 4, c: 0 }, e: { r: 4, c: 7 } },
        { s: { r: 6, c: 0 }, e: { r: 6, c: 7 } },
        { s: { r: 7, c: 0 }, e: { r: 7, c: 7 } },
        { s: { r: 8, c: 0 }, e: { r: 8, c: 7 } },
        { s: { r: 10, c: 1 }, e: { r: 10, c: 4 } },
        { s: { r: 11, c: 1 }, e: { r: 11, c: 4 } },
        { s: { r: 12, c: 1 }, e: { r: 12, c: 4 } },
        { s: { r: 26, c: 1 }, e: { r: 26, c: 4 } },
        { s: { r: 27, c: 1 }, e: { r: 27, c: 5 } },
        { s: { r: 28, c: 1 }, e: { r: 28, c: 6 } },
        { s: { r: 30, c: 0 }, e: { r: 30, c: 7 } },
        { s: { r: footerRow1, c: 0 }, e: { r: footerRow1, c: 7 } },
        { s: { r: footerRow2, c: 0 }, e: { r: footerRow2, c: 7 } }
      ];

      if (assumptionsRow >= 0) {
        ws['!merges'].push({ s: { r: assumptionsRow, c: 0 }, e: { r: assumptionsRow, c: 7 } });
      }

      // Стили
      scRange(ws, 0, 0, 0, 7, {
        fill: { fgColor: { rgb: BRAND_DARK } },
        font: { bold: true, sz: 20, color: { rgb: BRAND_GOLD }, name: 'Calibri' },
        alignment: { horizontal: 'center', vertical: 'center' }
      });
      var logoRef = XLSX.utils.encode_cell({ r: 0, c: 0 });
      ws[logoRef].v = 'ASGARD';

      sc(ws, 1, 0, {
        font: { bold: true, sz: 18, color: { rgb: BRAND_NAVY }, name: 'Calibri' },
        alignment: { horizontal: 'center', vertical: 'center' }
      });
      sc(ws, 2, 0, {
        font: { sz: 10, color: { rgb: GRAY_TEXT }, name: 'Calibri' },
        alignment: { horizontal: 'center', vertical: 'center' }
      });
      sc(ws, 3, 0, {
        font: { sz: 9, color: { rgb: GRAY_TEXT }, name: 'Calibri' },
        alignment: { horizontal: 'center', vertical: 'center' }
      });
      sc(ws, 4, 0, {
        font: { sz: 9, color: { rgb: GRAY_TEXT }, name: 'Calibri' },
        alignment: { horizontal: 'center', vertical: 'center' }
      });
      sc(ws, 6, 0, {
        fill: { fgColor: { rgb: BRAND_GOLD } },
        font: { sz: 2, color: { rgb: BRAND_GOLD } }
      });
      sc(ws, 7, 0, {
        font: { bold: true, sz: 16, color: { rgb: BRAND_DARK }, name: 'Calibri' },
        alignment: { horizontal: 'center', vertical: 'center' },
        fill: { fgColor: { rgb: GOLD_FILL } }
      });
      sc(ws, 8, 0, {
        fill: { fgColor: { rgb: BRAND_GOLD } },
        font: { sz: 2, color: { rgb: BRAND_GOLD } }
      });

      for (var infoR = 10; infoR <= 12; infoR++) {
        sc(ws, infoR, 0, { font: { bold: true, sz: 10, color: { rgb: BRAND_NAVY }, name: 'Calibri' }, alignment: { horizontal: 'right', vertical: 'center' } });
        sc(ws, infoR, 1, { font: { sz: 10, color: { rgb: BLACK }, name: 'Calibri' }, alignment: { horizontal: 'left', vertical: 'center' }, border: { bottom: { style: 'thin', color: { rgb: 'CCCCCC' } } } });
        sc(ws, infoR, 5, { font: { bold: true, sz: 10, color: { rgb: BRAND_NAVY }, name: 'Calibri' }, alignment: { horizontal: 'right', vertical: 'center' } });
        sc(ws, infoR, 6, { font: { sz: 10, color: { rgb: BLACK }, name: 'Calibri' }, alignment: { horizontal: 'left', vertical: 'center' }, border: { bottom: { style: 'thin', color: { rgb: 'CCCCCC' } } } });
      }

      var headerStyle = {
        font: { bold: true, sz: 9, color: { rgb: WHITE }, name: 'Calibri' },
        fill: { fgColor: { rgb: BRAND_NAVY } },
        border: BORDER_MEDIUM,
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true }
      };
      for (var hc = 0; hc <= 7; hc++) { sc(ws, 14, hc, headerStyle); }

      for (var dr = 0; dr < 11; dr++) {
        var rowIdx = 15 + dr;
        var isAlt = (dr % 2 === 1);
        var bgFill = isAlt ? { fgColor: { rgb: BRAND_LIGHT } } : undefined;
        sc(ws, rowIdx, 0, { font: { sz: 9, color: { rgb: GRAY_TEXT }, name: 'Calibri' }, border: BORDER_THIN, alignment: { horizontal: 'center', vertical: 'center' }, fill: bgFill });
        sc(ws, rowIdx, 1, { font: { sz: 9, color: { rgb: BLACK }, name: 'Calibri' }, border: BORDER_THIN, alignment: { horizontal: 'left', vertical: 'center', wrapText: true }, fill: bgFill });
        sc(ws, rowIdx, 2, { font: { sz: 9, color: { rgb: GRAY_TEXT }, name: 'Calibri' }, border: BORDER_THIN, alignment: { horizontal: 'center', vertical: 'center' }, fill: bgFill });
        sc(ws, rowIdx, 3, { font: { sz: 9, color: { rgb: BLACK }, name: 'Calibri' }, border: BORDER_THIN, alignment: { horizontal: 'center', vertical: 'center' }, fill: bgFill });
        for (var mc = 4; mc <= 7; mc++) {
          sc(ws, rowIdx, mc, { font: { sz: 9, color: { rgb: BLACK }, name: 'Calibri' }, border: BORDER_THIN, alignment: { horizontal: 'right', vertical: 'center' }, fill: bgFill });
          setNumFmt(ws, rowIdx, mc, FMT_NUM);
        }
      }

      for (var bc = 0; bc <= 7; bc++) {
        var lastDataRef = XLSX.utils.encode_cell({ r: 25, c: bc });
        if (ws[lastDataRef] && ws[lastDataRef].s) { ws[lastDataRef].s.border = BORDER_BOTTOM_DOUBLE; }
      }

      sc(ws, 26, 0, { font: { sz: 1, color: { rgb: WHITE } } });
      sc(ws, 26, 1, { font: { bold: true, sz: 10, color: { rgb: BRAND_NAVY }, name: 'Calibri' }, alignment: { horizontal: 'right', vertical: 'center' } });
      sc(ws, 26, 5, { font: { bold: true, sz: 11, color: { rgb: BRAND_NAVY }, name: 'Calibri' }, border: BORDER_TOP_MEDIUM, alignment: { horizontal: 'right', vertical: 'center' } });
      setNumFmt(ws, 26, 5, FMT_NUM);
      sc(ws, 26, 6, { font: { sz: 9 }, border: { top: { style: 'medium', color: { rgb: BRAND_NAVY } } } });
      sc(ws, 26, 7, { font: { sz: 9 }, border: { top: { style: 'medium', color: { rgb: BRAND_NAVY } } } });

      sc(ws, 27, 1, { font: { bold: true, sz: 10, color: { rgb: BRAND_NAVY }, name: 'Calibri' }, alignment: { horizontal: 'right', vertical: 'center' } });
      sc(ws, 27, 6, { font: { bold: true, sz: 11, color: { rgb: BRAND_NAVY }, name: 'Calibri' }, border: BORDER_THIN, alignment: { horizontal: 'right', vertical: 'center' } });
      setNumFmt(ws, 27, 6, FMT_NUM);
      sc(ws, 27, 7, { font: { sz: 9 } });

      sc(ws, 28, 0, { fill: { fgColor: { rgb: GOLD_FILL } } });
      sc(ws, 28, 1, { font: { bold: true, sz: 12, color: { rgb: BRAND_DARK }, name: 'Calibri' }, alignment: { horizontal: 'right', vertical: 'center' }, fill: { fgColor: { rgb: GOLD_FILL } } });
      for (var tc = 2; tc <= 6; tc++) { sc(ws, 28, tc, { fill: { fgColor: { rgb: GOLD_FILL } } }); }
      sc(ws, 28, 7, {
        font: { bold: true, sz: 14, color: { rgb: BRAND_DARK }, name: 'Calibri' },
        border: { top: { style: 'medium', color: { rgb: BRAND_GOLD } }, bottom: { style: 'double', color: { rgb: BRAND_GOLD } }, left: { style: 'medium', color: { rgb: BRAND_GOLD } }, right: { style: 'medium', color: { rgb: BRAND_GOLD } } },
        alignment: { horizontal: 'right', vertical: 'center' },
        fill: { fgColor: { rgb: GOLD_FILL } }
      });
      setNumFmt(ws, 28, 7, FMT_NUM);

      sc(ws, 30, 0, { font: { italic: true, sz: 9, color: { rgb: GRAY_TEXT }, name: 'Calibri' }, alignment: { horizontal: 'left', vertical: 'center', wrapText: true } });

      if (assumptionsRow >= 0) {
        sc(ws, assumptionsRow, 0, { font: { italic: true, sz: 9, color: { rgb: GRAY_TEXT }, name: 'Calibri' }, alignment: { horizontal: 'left', vertical: 'top', wrapText: true }, border: { top: { style: 'thin', color: { rgb: 'CCCCCC' } }, bottom: { style: 'thin', color: { rgb: 'CCCCCC' } } } });
        ws['!rows'][assumptionsRow] = { hpt: 30 };
      }

      sc(ws, signRow, 0, { font: { sz: 10, color: { rgb: BLACK }, name: 'Calibri' }, alignment: { horizontal: 'left', vertical: 'bottom' } });
      sc(ws, signRow, 2, { font: { sz: 10, color: { rgb: BLACK }, name: 'Calibri' }, alignment: { horizontal: 'center', vertical: 'bottom' }, border: { bottom: { style: 'thin', color: { rgb: BLACK } } } });
      sc(ws, signRow, 5, { font: { sz: 10, color: { rgb: BLACK }, name: 'Calibri' }, alignment: { horizontal: 'center', vertical: 'bottom' }, border: { bottom: { style: 'thin', color: { rgb: BLACK } } } });
      sc(ws, signRow + 1, 2, { font: { sz: 8, color: { rgb: GRAY_TEXT }, name: 'Calibri' }, alignment: { horizontal: 'center' } });
      sc(ws, signRow + 1, 5, { font: { sz: 8, color: { rgb: GRAY_TEXT }, name: 'Calibri' }, alignment: { horizontal: 'center' } });

      sc(ws, footerRow1, 0, { font: { sz: 8, color: { rgb: GRAY_TEXT }, name: 'Calibri' }, alignment: { horizontal: 'center', vertical: 'center' }, border: { top: { style: 'thin', color: { rgb: BRAND_GOLD } } } });
      sc(ws, footerRow2, 0, { font: { sz: 8, color: { rgb: GRAY_TEXT }, name: 'Calibri' }, alignment: { horizontal: 'center', vertical: 'center' } });

      ws['!print'] = { paperSize: 9, orientation: 'landscape', fitToWidth: 1, fitToHeight: 1 };
      ws['!margins'] = { left: 0.4, right: 0.4, top: 0.3, bottom: 0.3, header: 0.2, footer: 0.2 };
      XLSX.utils.book_append_sheet(wb, ws, 'Просчёт стоимости');

      // Лист 2: Детали
      var detailsData = [
        ['ДЕТАЛИ КАЛЬКУЛЯЦИИ (внутренний документ)', '', ''], [],
        ['Статья расходов', 'Себестоимость, руб.', 'Примечание'],
        ['ФОТ (работа + подготовка + демоб.)', Math.round(sum.payroll_total), sum.people_count + ' чел x ' + sum.work_days + ' дней работы'],
        ['Налоги на ФОТ', Math.round(sum.fot_tax), (s.fot_tax_pct || 50) + '%'],
        ['Суточные', Math.round(sum.per_diem_total), sum.total_days + ' дней'],
        ['Проживание', Math.round(sum.lodging_total), st.lodging_type],
        ['Мобилизация', Math.round(sum.mobilization_total), sum.mobilization_type],
        ['Химия', Math.round(sum.chem_total), (st.chemicals ? st.chemicals.length : 0) + ' позиций'],
        ['Расходные материалы', Math.round(sum.consumables), (s.consumables_pct || 5) + '%'],
        ['Оборудование', Math.round(sum.equip_total), (st.equipment ? st.equipment.length : 0) + ' позиций'],
        ['Логистика', Math.round(sum.logistics_total), (sum.transport ? sum.transport.name : 'авто') + ', ' + (st.distance_km * 2) + ' км'],
        ['СИЗ', Math.round(sum.ppe_total), sum.people_count + ' чел'],
        ['Накладные', Math.round(sum.overhead), (sum.overhead_pct || 10) + '%'],
        [],
        ['ИТОГО себестоимость:', Math.round(sum.cost_total), ''],
        ['Маржа:', sum.margin_pct + '%', ''],
        ['Цена без НДС:', Math.round(sum.price_no_vat), ''],
        ['НДС (' + vatPct + '%):', Math.round(sum.price_with_vat - sum.price_no_vat), ''],
        ['ЦЕНА С НДС:', Math.round(sum.price_with_vat), ''],
        [],
        ['Чистая прибыль:', Math.round(sum.net_profit), ''],
        ['Прибыль / чел-день:', Math.round(sum.profit_per_day), sum.status === 'green' ? 'ЗЕЛЁНАЯ ЗОНА' : (sum.status === 'yellow' ? 'ЖЁЛТАЯ ЗОНА' : 'КРАСНАЯ ЗОНА')]
      ];
      var wsDetails = XLSX.utils.aoa_to_sheet(detailsData);
      wsDetails['!cols'] = [{ wch: 35 }, { wch: 20 }, { wch: 30 }];
      wsDetails['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }];
      wsDetails['!print'] = { paperSize: 9, orientation: 'portrait', fitToWidth: 1 };
      XLSX.utils.book_append_sheet(wb, wsDetails, 'Детали');

      // Лист 3: Бригада
      var crewData = [['Роль', 'Кол-во', 'Ставка/день, руб.', 'Суточные, руб.', 'Итого за работу, руб.']];
      var crewTotalPay = 0;
      var crewArr = st.crew || [];
      for (var ci = 0; ci < crewArr.length; ci++) {
        var c = crewArr[ci];
        var role = s.roles ? s.roles.find(function(r) { return r.id === c.role_id; }) : null;
        if (!role) continue;
        var rate = window.calcRateWithSurcharges ? window.calcRateWithSurcharges(c.role_id, st.surcharges, s) : (s.base_rate * role.coef);
        var perDiem = role.per_diem || 1000;
        var crewLineTotal = rate * c.count * sum.work_days + perDiem * c.count * sum.total_days;
        crewTotalPay += crewLineTotal;
        crewData.push([role.name || c.role_id, c.count, Math.round(rate), Math.round(perDiem), Math.round(crewLineTotal)]);
      }
      crewData.push(['', '', '', 'ИТОГО:', Math.round(crewTotalPay)]);
      if (crewData.length > 2) {
        var wsCrew = XLSX.utils.aoa_to_sheet(crewData);
        wsCrew['!cols'] = [{ wch: 25 }, { wch: 10 }, { wch: 16 }, { wch: 14 }, { wch: 20 }];
        wsCrew['!print'] = { paperSize: 9, orientation: 'portrait', fitToWidth: 1 };
        XLSX.utils.book_append_sheet(wb, wsCrew, 'Бригада');
      }

      // Лист 4: Параметры
      var paramsData = [['Параметр', 'Значение']];
      if (st.params) {
        var paramKeys = Object.keys(st.params);
        for (var pi = 0; pi < paramKeys.length; pi++) {
          var pk = paramKeys[pi];
          var pv = st.params[pk];
          if (pv !== null && pv !== undefined && pv !== '') { paramsData.push([pk, pv]); }
        }
      }
      paramsData.push(['Маржа, %', st.margin_pct]);
      paramsData.push(['Подготовка, дн.', st.prep_days]);
      paramsData.push(['Работа, дн.', st.work_days]);
      paramsData.push(['Демобилизация, дн.', st.demob_days]);
      paramsData.push(['Расстояние, км', st.distance_km]);
      paramsData.push(['Транспорт', st.transport_id]);
      paramsData.push(['Проживание', st.lodging_type]);
      if (st.assumptions) paramsData.push(['Допущения', st.assumptions]);
      var wsParams = XLSX.utils.aoa_to_sheet(paramsData);
      wsParams['!cols'] = [{ wch: 28 }, { wch: 35 }];
      wsParams['!print'] = { paperSize: 9, orientation: 'portrait', fitToWidth: 1 };
      XLSX.utils.book_append_sheet(wb, wsParams, 'Параметры');

      // Генерация файла
      var objName = (st.tender_title || st.city || 'объект').replace(/[^\w\u0400-\u04FF\s-]/g, '').substring(0, 30).trim();
      var filename = 'Просчёт_' + objName + '_' + dateNow.replace(/\./g, '-') + '.xlsx';
      XLSX.writeFile(wb, filename);
      toast('Экспорт', 'Excel-отчёт скачан');

    } catch (err) {
      console.error('Excel export error:', err);
      toast('Ошибка', 'Не удалось экспортировать: ' + (err.message || err), 'err');
    }
  };

  console.log('[CALC] Excel export module loaded (inline)');
})();
