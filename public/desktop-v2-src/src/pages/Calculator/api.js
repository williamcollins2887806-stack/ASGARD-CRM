/**
 * API-клиент страницы /calculator.
 * Источник: vanilla `public/assets/js/calculator.js` (786 строк) — AsgardCalc.
 *
 * Калькулятор использует:
 *   - GET /api/settings/app — тарифы, химия, транспорт, нормы (calc.role_rates / chemicals / transport_options / overhead_pct / fot_tax_pct / profit_tax_pct / min_profit_per_person_day)
 *   - GET /api/tenders — выбор тендера для расчёта (опц.)
 *   - GET /api/estimates/:id — загрузка существующего просчёта (calc_summary_json)
 *   - POST /api/estimates — создать новый просчёт с calc_summary_json
 *   - PUT /api/estimates/:id — обновить просчёт
 *
 * Всё считается на клиенте через compute(state, calcSettings).
 */
import { api } from '@/api/client';

export const ROLE_LIST = ['ИТР', 'Мастер', 'Слесарь', 'Промывщик', 'ПТО', 'Химик', 'Сварщик', 'Разнорабочий'];

export function num(v, d = 0) {
  const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : d;
}

export function clamp(n, mn, mx) {
  return Math.min(mx, Math.max(mn, n));
}

export function fmtMoney(v) {
  const n = Number(v) || 0;
  return new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';
}

export function safeParse(s, fallback) {
  if (!s) return fallback;
  try {
    const v = typeof s === 'string' ? JSON.parse(s) : s;
    return v && typeof v === 'object' ? v : fallback;
  } catch (_) {
    return fallback;
  }
}

export function loadAppSettings() {
  return api('/api/settings/app').then((d) => d?.value || d || {}).catch(() => ({}));
}

export function loadTenders(params = {}) {
  const q = new URLSearchParams();
  q.set('limit', String(params.limit || 200));
  if (params.archived) q.set('archived', 'true');
  return api('/api/tenders?' + q.toString())
    .then((d) => d.items || d.tenders || [])
    .catch(() => []);
}

export function loadEstimate(id) {
  return api('/api/estimates/' + id).then((d) => d?.estimate || d?.item || d);
}

export function loadEstimatesByTender(tenderId) {
  return api('/api/estimates?tender_id=' + tenderId)
    .then((d) => d.items || d.estimates || [])
    .catch(() => []);
}

export function createEstimate(body) {
  return api('/api/estimates', { method: 'POST', body });
}

export function updateEstimate(id, body) {
  return api('/api/estimates/' + id, { method: 'PUT', body });
}

/* ════════════════════════════════════════════════════════════════════════
   DEFAULT STATE + MERGE (порт из vanilla calculator.js)
   ════════════════════════════════════════════════════════════════════════ */

export function defaultsFromSettings(app) {
  const c = app.calc || {};
  const roleRates = c.role_rates || {};
  const roles = ROLE_LIST.map((r) => ({ role: r, count: 0, rate: num(roleRates[r], 5000) }));
  return {
    work_days: 10,
    prep_days: 0,
    prep_people: 0,
    prep_rate: num(c.prep_rate_per_day, 3500),
    city: '',
    distance_km: 0,
    per_diem: 0,
    lodging_per_person_day: 0,
    lodging_total: 0,
    ppe_per_person: 0,
    mobilizations: [{ label: 'Мобилизация 1', people: 0, cost_per_person: 0 }],
    roles,
    system_volume_m3: 0,
    chemical_id: (c.chemicals?.[0]?.id) || '',
    equipment: [],
    transport_id: 'AUTO',
    margin_pct: 20,
    vat_pct: num(app.vat_pct, 22)
  };
}

export function mergeState(base, saved) {
  if (!saved || typeof saved !== 'object') return base;
  const next = JSON.parse(JSON.stringify(base));
  for (const k of Object.keys(base)) {
    if (saved[k] !== undefined) next[k] = saved[k];
  }
  if (Array.isArray(saved.roles)) {
    const map = new Map(saved.roles.map((r) => [r.role, r]));
    next.roles = base.roles.map((r) => {
      const s = map.get(r.role);
      return s ? { role: r.role, count: num(s.count, 0), rate: num(s.rate, r.rate) } : r;
    });
  }
  if (Array.isArray(saved.mobilizations)) {
    next.mobilizations = saved.mobilizations.map((m) => ({
      label: String(m.label || ''),
      people: num(m.people, 0),
      cost_per_person: num(m.cost_per_person, 0)
    }));
  }
  if (Array.isArray(saved.equipment)) {
    next.equipment = saved.equipment.map((e) => ({
      name: String(e.name || ''),
      kind: String(e.kind || 'own'),
      cost: num(e.cost, 0),
      rate_per_day: num(e.rate_per_day, 0),
      amort: num(e.amort, 0),
      weight_kg: num(e.weight_kg, 0),
      volume_m3: num(e.volume_m3, 0)
    }));
  }
  return next;
}

/* ════════════════════════════════════════════════════════════════════════
   COMPUTE — порт из vanilla compute()
   ════════════════════════════════════════════════════════════════════════ */

export function compute(state, app) {
  const c = app.calc || {};
  const overhead_pct = num(c.overhead_pct, 10);
  const fot_tax_pct = num(c.fot_tax_pct, 50);
  const profit_tax_pct = num(c.profit_tax_pct, 20);
  const min_ppd = num(c.min_profit_per_person_day, 25000);

  const workDays = clamp(num(state.work_days, 0), 0, 365);
  const prepDays = clamp(num(state.prep_days, 0), 0, 365);
  const totalDays = workDays + prepDays;

  const roleRows = (state.roles || []).map((r) => ({
    role: r.role,
    count: clamp(num(r.count, 0), 0, 999),
    rate: num(r.rate, 0)
  }));
  const peopleWork = roleRows.reduce((s, r) => s + r.count, 0);
  const payrollWork = roleRows.reduce((s, r) => s + r.count * r.rate * workDays, 0);

  const prepPeople = clamp(num(state.prep_people, 0), 0, 999);
  const prepRate = num(state.prep_rate, num(c.prep_rate_per_day, 3500));
  const payrollPrep = prepPeople * prepRate * prepDays;
  const payrollTotal = payrollWork + payrollPrep;

  const perDiem = num(state.per_diem, 0) * totalDays * peopleWork;
  const lodgingPPD = num(state.lodging_per_person_day, 0);
  let lodging = lodgingPPD * totalDays * peopleWork;
  if (!lodging) lodging = num(state.lodging_total, 0);
  const ppe = num(state.ppe_per_person, 0) * peopleWork;
  const mobilization = (state.mobilizations || []).reduce(
    (s, m) => s + num(m.people, 0) * num(m.cost_per_person, 0),
    0
  );

  // Химия
  const chemList = c.chemicals || [];
  const chem = chemList.find((x) => String(x.id) === String(state.chemical_id)) || chemList[0] || null;
  const vol = num(state.system_volume_m3, 0);
  const chemKg = chem ? vol * num(chem.kg_per_m3, 0) : 0;
  const chemCost = chem ? chemKg * num(chem.price_per_kg, 0) : 0;
  const chemVolM3 = chemKg / 1000;

  // Оборудование
  const eq = (state.equipment || []).map((e) => ({
    name: String(e.name || ''),
    kind: String(e.kind || 'own'),
    cost: num(e.cost, 0),
    rate_per_day: num(e.rate_per_day, 0),
    amort: num(e.amort, 0),
    weight_kg: num(e.weight_kg, 0),
    volume_m3: num(e.volume_m3, 0)
  })).filter((e) => e.name.trim());

  const equipCost = eq.reduce((s, e) => {
    if (e.kind === 'buy') return s + e.cost;
    if (e.kind === 'rent') return s + e.rate_per_day * workDays;
    return s + e.amort;
  }, 0);

  const equipWeight = eq.reduce((s, e) => s + e.weight_kg, 0);
  const equipVol = eq.reduce((s, e) => s + e.volume_m3, 0);
  const totalWeightKg = equipWeight + chemKg;
  const totalVolM3 = equipVol + chemVolM3;

  // Транспорт
  const dist = clamp(num(state.distance_km, 0), 0, 200000);
  const trans = c.transport_options || c.transport || [];
  let selected = null;
  if (String(state.transport_id) !== 'AUTO') {
    selected = trans.find((t) => String(t.id) === String(state.transport_id)) || null;
  }
  if (!selected) {
    selected = trans.slice()
      .sort((a, b) => (num(a.max_weight_t, 0) - num(b.max_weight_t, 0)) || (num(a.max_volume_m3, 0) - num(b.max_volume_m3, 0)))
      .find((t) => (totalWeightKg / 1000) <= num(t.max_weight_t, 0) && totalVolM3 <= num(t.max_volume_m3, 0)) ||
      trans[trans.length - 1] || null;
  }
  const transRate = selected ? num(selected.rate_per_km, 0) : 0;
  const logistics = transRate * dist * 2;

  const base = payrollTotal + perDiem + lodging + ppe + mobilization + chemCost + equipCost + logistics;
  const overhead = base * overhead_pct / 100;
  const fotTax = payrollTotal * fot_tax_pct / 100;
  const costTotal = base + overhead + fotTax;

  const m = clamp(num(state.margin_pct, 0), 0, 95) / 100;
  const pt = clamp(profit_tax_pct, 0, 99) / 100;
  const denom = (1 - pt) - m;
  const priceNoVat = denom > 0 ? (costTotal * (1 - pt)) / denom : (costTotal * 1.5);
  const profitBeforeTax = priceNoVat - costTotal;
  const netProfit = profitBeforeTax * (1 - pt);
  const vatPct = clamp(num(state.vat_pct, num(app.vat_pct, 22)), 0, 30);
  const priceWithVat = priceNoVat * (1 + vatPct / 100);
  const ppd = (peopleWork > 0 && workDays > 0) ? (netProfit / (peopleWork * workDays)) : 0;

  return {
    ok: ppd >= min_ppd,
    min_ppd,
    workDays, prepDays, totalDays,
    peopleWork, payrollWork, payrollPrep, payrollTotal,
    perDiem, lodging, ppe, mobilization,
    chem: chem ? {
      id: chem.id,
      name: chem.name,
      kg_per_m3: num(chem.kg_per_m3, 0),
      price_per_kg: num(chem.price_per_kg, 0),
      volume_m3: vol,
      kg: chemKg,
      cost: chemCost
    } : null,
    equipment: eq, equipCost, equipment_total: equipCost,
    totalWeightKg, totalVolM3,
    transport: selected ? {
      id: selected.id,
      name: selected.name,
      max_weight_t: num(selected.max_weight_t, 0),
      max_volume_m3: num(selected.max_volume_m3, 0),
      rate_per_km: transRate
    } : null,
    dist, logistics,
    overhead_pct, overhead,
    fot_tax_pct, fotTax,
    profit_tax_pct,
    costTotal,
    margin_pct: num(state.margin_pct, 0),
    priceNoVat, vatPct, priceWithVat,
    profitBeforeTax, netProfit,
    profit_per_person_day: ppd
  };
}
