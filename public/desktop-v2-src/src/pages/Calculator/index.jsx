/**
 * Страница /calculator — Рунический Калькулятор v2 (для ТО/PM/директоров).
 *
 * Источник: vanilla `public/assets/js/calculator_v2.js` (1064 строки) — AsgardCalcV2.
 * Справочники: `calc_norms.js`, `calc_equipment.js` (зеркало в api.js → CALC_DEFAULTS_V2 + CALC_EQUIPMENT_V2).
 *
 * Coverage:
 *   ✅ 8 вкладок: Объект / Параметры / Бригада / Сроки / Химия / Оборудование / Логистика / Итоги
 *   ✅ 9 типов работ (heat_exchanger / avo / boiler / tank / pipeline / cooling_tower /
 *      ventilation / heating_system / custom) — встроены, override через settings.calc_v2
 *   ✅ 7 ролей с коэф. + 7 доплат (+pct), некоторые — только для опр. ролей
 *   ✅ Параметры объекта типизированы (number/select) — настройки внутри work_type
 *   ✅ autoFill: бригада/сроки/химия/оборудование по work_type — с учётом manual-флагов
 *   ✅ Авто-подбор транспорта (по грузу+объёму) и мобилизации (по дистанции)
 *   ✅ Каталог оборудования из CALC_EQUIPMENT_V2 + override через settings.calc_v2.equipment_catalog
 *   ✅ Допущения и риски — отдельное поле для согласования с директором
 *   ✅ Светофор минимума прибыли (red/yellow/green) + KPI
 *   ✅ Загрузка/сохранение estimate.calc_summary_json (новый payload v2 + чтение legacy v1)
 *   ✅ Excel-экспорт (sheet «Сводка» + «Бригада» + «Оборудование» + «Химия»)
 *
 * Hash: `#/calculator?tender=123` подгружает тендер.
 * RBAC: ADMIN, PM, HEAD_PM, TO, HEAD_TO, DIRECTOR_*.
 */
import { useState, useEffect, useMemo, useCallback, useReducer } from 'react';
import { useAuth } from '@/api/useAuth';
import { toast } from '@/modals/Notifications';
import { Btn, Field, Pill } from '@/modals/parts';
import { TopActionsBar } from '@/blocks/Blocks';
import { Combobox } from '@/inputs/Inputs';
import {
  loadAppSettings, loadCalcV2Overrides, loadTenders, loadEstimatesByTender,
  createEstimate, updateEstimate,
  createState, autoFillV2, computeV2,
  mergeCalcSettings, mergeEquipmentCatalog,
  fmtMoney, safeParse, num
} from './api';
import ObjectTab from './tabs/ObjectTab';
import ParamsTab from './tabs/ParamsTab';
import CrewTab from './tabs/CrewTab';
import TimeTab from './tabs/TimeTab';
import ChemTab from './tabs/ChemTab';
import EquipmentTab from './tabs/EquipmentTab';
import LogisticsTab from './tabs/LogisticsTab';
import TotalsTab from './tabs/TotalsTab';
import './calculator.css';

const ALLOWED_ROLES = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

const TABS = [
  { id: 'object',    label: '1. Объект' },
  { id: 'params',    label: '2. Параметры' },
  { id: 'crew',      label: '3. Бригада' },
  { id: 'time',      label: '4. Сроки' },
  { id: 'chem',      label: '5. Химия' },
  { id: 'equip',     label: '6. Оборудование' },
  { id: 'logistics', label: '7. Логистика' },
  { id: 'totals',    label: '8. Итоги' }
];

/** Reducer — частичный мердж патча в state. */
function calcReducer(state, action) {
  if (action.type === 'reset') return action.state;
  if (action.type === 'patch') return { ...state, ...action.patch };
  if (action.type === 'autoFill') return autoFillV2(state, action.settings);
  return state;
}

export default function CalculatorPage() {
  const { user } = useAuth();
  const allowed = ALLOWED_ROLES.includes(user?.role);

  const [tab, setTab] = useState('object');
  const [settings, setSettings] = useState(() => mergeCalcSettings(null));
  const [catalog, setCatalog] = useState(() => mergeEquipmentCatalog(null));
  const [appV1, setAppV1] = useState({});            // для чтения legacy estimate.calc_summary_json v1
  const [tenders, setTenders] = useState([]);
  const [tenderId, setTenderId] = useState('');
  const [estimateId, setEstimateId] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [state, dispatch] = useReducer(calcReducer, null, () => createState(null));
  const [saveBusy, setSaveBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);

  // === Загрузка настроек + тендеров ===
  useEffect(() => {
    Promise.all([loadAppSettings(), loadCalcV2Overrides(), loadTenders({ limit: 2000 })])
      .then(([appSettings, calcOverrides, tList]) => {
        setAppV1(appSettings || {});
        const merged = mergeCalcSettings(calcOverrides);
        setSettings(merged);
        setCatalog(mergeEquipmentCatalog(calcOverrides?.equipment_catalog));
        setTenders(tList);
        setLoaded(true);
      })
      .catch((e) => {
        toast.error('Не удалось загрузить настройки: ' + (e?.message || e));
        setLoaded(true);
      });
  }, []);

  // === Deep link `?tender=NN` ===
  useEffect(() => {
    const m = (window.location.hash || '').match(/[?&]tender=(\d+)/);
    if (m && m[1]) setTenderId(Number(m[1]));
  }, []);

  // === Tender lookup ===
  const tender = useMemo(
    () => tenders.find((t) => t.id === Number(tenderId)) || null,
    [tenderId, tenders]
  );

  // === При смене тендера: подгрузить estimate (если есть) или сбросить state ===
  useEffect(() => {
    if (!loaded || !tenderId) {
      dispatch({ type: 'reset', state: createState(null) });
      setEstimateId(null);
      return;
    }
    loadEstimatesByTender(tenderId)
      .then((list) => {
        const latest = list[0];
        if (latest?.calc_summary_json) {
          const saved = safeParse(latest.calc_summary_json, null);
          const isV2 = saved && saved._type === 'asgard_calc_v2_runic';
          const input = isV2 ? saved.input : (saved && saved.input ? saved.input : saved);
          // Базовая структура v2 + override полей из сохранённого input.
          const base = createState(tender);
          const next = { ...base, ...(input || {}), tender_id: tender?.id || null,
            customer_name: tender?.customer_name || base.customer_name,
            tender_title: tender?.tender_title || tender?.title || base.tender_title };
          // Если читали legacy v1 — manual-флаги поднимаем (там не было work_type_id, не пересчитывать).
          if (!isV2) {
            next.crew_manual = true;
            next.days_manual = true;
            next.chem_manual = true;
            next.equip_manual = true;
            if (!next.work_type_id) next.work_type_id = 'custom';
          }
          dispatch({ type: 'reset', state: next });
          setEstimateId(latest.id);
          toast.info(`Загружен расчёт v${latest.version || 1}${isV2 ? '' : ' (legacy)'}`);
        } else if (latest) {
          dispatch({ type: 'reset', state: createState(tender) });
          setEstimateId(latest.id);
        } else {
          dispatch({ type: 'reset', state: createState(tender) });
          setEstimateId(null);
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenderId, loaded]);

  // === Auto-fill при смене work_type_id / params (если не manual) ===
  // Запускаем после каждого изменения state — но autoFillV2 уважает *_manual флаги.
  // Это эмулирует vanilla `render() { st = autoFill(st, s); compute(...); ... }`.
  const stateWithAutoFill = useMemo(() => autoFillV2(state, settings), [state, settings]);
  const summary = useMemo(() => computeV2(stateWithAutoFill, settings, catalog), [stateWithAutoFill, settings, catalog]);

  // === Действия ===
  const set = useCallback((patch) => dispatch({ type: 'patch', patch }), []);

  const toggleCondition = useCallback((id) => {
    const has = (state.conditions || []).includes(id);
    const conditions = has ? state.conditions.filter((x) => x !== id) : [...(state.conditions || []), id];
    const surcharges = has ? (state.surcharges || []).filter((x) => x !== id) : Array.from(new Set([...(state.surcharges || []), id]));
    dispatch({ type: 'patch', patch: { conditions, surcharges } });
  }, [state.conditions, state.surcharges]);

  const toggleSurcharge = useCallback((id) => {
    const has = (state.surcharges || []).includes(id);
    const surcharges = has ? state.surcharges.filter((x) => x !== id) : [...(state.surcharges || []), id];
    dispatch({ type: 'patch', patch: { surcharges } });
  }, [state.surcharges]);

  const onAutoFill = useCallback(() => {
    dispatch({ type: 'patch', patch: { crew_manual: false, days_manual: false, chem_manual: false, equip_manual: false } });
    toast.info('Автоподбор бригады, сроков, химии и оборудования выполнен');
  }, []);

  const onApply = async () => {
    if (!summary) return;
    if (!tender) { toast.warn('Сначала выберите тендер'); return; }
    if (summary.status === 'red') {
      toast.error(`Прибыль/чел-день ${fmtMoney(summary.profit_per_day)} ниже минимума ${fmtMoney(summary.min_profit)}`);
      setTab('totals');
      return;
    }
    setSaveBusy(true);
    try {
      // Используем stateWithAutoFill, чтобы сохранить ровно то, что показывает UI.
      const persisted = { ...stateWithAutoFill, version: (stateWithAutoFill.version || 0) + 1, updated_at: new Date().toISOString() };
      const payload = {
        _type: 'asgard_calc_v2_runic',
        input: persisted,
        output: summary,
        director_view: buildDirectorView(persisted, summary, settings)
      };
      const body = {
        tender_id: tender.id,
        pm_id: tender.responsible_pm_id || tender.pm_id || user?.id,
        version: estimateId ? undefined : 1,
        status: 'Новый',
        cost_plan: Math.round(summary.cost_total),
        price_tkp: Math.round(summary.price_with_vat),
        calc_summary_json: JSON.stringify(payload)
      };
      if (estimateId) {
        await updateEstimate(estimateId, body);
        toast.success(`Просчёт обновлён (v${persisted.version})`);
      } else {
        const r = await createEstimate(body);
        if (r?.estimate?.id) setEstimateId(r.estimate.id);
        else if (r?.id) setEstimateId(r.id);
        toast.success('Просчёт создан');
      }
    } catch (e) {
      toast.error('Не удалось сохранить: ' + (e?.message || e));
    } finally {
      setSaveBusy(false);
    }
  };

  const onExportExcel = () => {
    if (!summary) return;
    setExportBusy(true);
    try {
      if (typeof window.XLSX === 'undefined') {
        toast.error('Библиотека XLSX не загружена');
        return;
      }
      const X = window.XLSX;
      const wb = X.utils.book_new();
      const wt = (settings.work_types || []).find((w) => w.id === stateWithAutoFill.work_type_id);

      // Sheet 1: Сводка
      const dateNow = new Date().toLocaleDateString('ru-RU');
      const summaryData = [
        ['АСГАРД СЕРВИС — Рунический Калькулятор'],
        ['Тендер:', stateWithAutoFill.tender_title || '—'],
        ['Заказчик:', stateWithAutoFill.customer_name || '—'],
        ['Тип работы:', wt ? `${wt.icon || ''} ${wt.name}` : '—'],
        ['Город:', stateWithAutoFill.city || '—'],
        ['Расстояние:', `${summary.distance_km} км`],
        [],
        ['Подготовка:', `${summary.prep_days} дн.`],
        ['Работа:', `${summary.work_days} дн.`],
        ['Демобилизация:', `${summary.demob_days} дн.`],
        ['Всего дней:', `${summary.total_days} дн.`],
        ['Бригада:', `${summary.people_count} чел`],
        [],
        ['СЕБЕСТОИМОСТЬ'],
        ['ФОТ:', Math.round(summary.payroll_total)],
        ['Налоги ФОТ:', Math.round(summary.fot_tax)],
        ['Суточные:', Math.round(summary.per_diem_total)],
        ['Проживание:', Math.round(summary.lodging_total)],
        ['Мобилизация:', Math.round(summary.mobilization_total)],
        ['Химия:', Math.round(summary.chem_total)],
        ['Расходники:', Math.round(summary.consumables)],
        ['Оборудование:', Math.round(summary.equip_total)],
        ['Логистика:', Math.round(summary.logistics_total)],
        ['СИЗ:', Math.round(summary.ppe_total)],
        [`Накладные (${summary.overhead_pct}%):`, Math.round(summary.overhead)],
        ['ИТОГО себестоимость:', Math.round(summary.cost_total)],
        [],
        ['ЦЕНА'],
        ['Маржа:', `${summary.margin_pct}%`],
        ['Цена без НДС:', Math.round(summary.price_no_vat)],
        [`НДС (${summary.vat_pct}%):`, Math.round(summary.price_with_vat - summary.price_no_vat)],
        ['ЦЕНА С НДС:', Math.round(summary.price_with_vat)],
        ['Чистая прибыль:', Math.round(summary.net_profit)],
        ['Прибыль/чел-день:', Math.round(summary.profit_per_day)],
        ['Статус:', { red: 'КРАСНАЯ', yellow: 'ЖЁЛТАЯ', green: 'ЗЕЛЁНАЯ' }[summary.status]],
        [],
        ['Дата расчёта:', dateNow]
      ];
      const ws1 = X.utils.aoa_to_sheet(summaryData);
      ws1['!cols'] = [{ wch: 30 }, { wch: 22 }];
      X.utils.book_append_sheet(wb, ws1, 'Сводка');

      // Sheet 2: Бригада
      const crewData = [['Роль', 'Кол-во', 'Ставка/смена (₽)']];
      for (const c of stateWithAutoFill.crew || []) {
        const role = (settings.roles || []).find((r) => r.id === c.role_id);
        crewData.push([role?.name || c.role_id, num(c.count, 0), Math.round(num(role?.coef, 1) * num(settings.base_rate, 5500))]);
      }
      if (crewData.length > 1) {
        const ws2 = X.utils.aoa_to_sheet(crewData);
        ws2['!cols'] = [{ wch: 22 }, { wch: 10 }, { wch: 18 }];
        X.utils.book_append_sheet(wb, ws2, 'Бригада');
      }

      // Sheet 3: Химия
      if (stateWithAutoFill.chemicals?.length) {
        const chemData = [['Состав', 'Кг', 'Цена ₽/кг', 'Сумма ₽']];
        for (const ch of stateWithAutoFill.chemicals) {
          const chem = (settings.chemicals || []).find((c) => c.id === ch.id);
          chemData.push([chem?.name || ch.id, num(ch.kg, 0), num(chem?.price_kg, 0), num(ch.kg, 0) * num(chem?.price_kg, 0)]);
        }
        const ws3 = X.utils.aoa_to_sheet(chemData);
        ws3['!cols'] = [{ wch: 30 }, { wch: 10 }, { wch: 12 }, { wch: 14 }];
        X.utils.book_append_sheet(wb, ws3, 'Химия');
      }

      // Sheet 4: Оборудование
      if (stateWithAutoFill.equipment?.length) {
        const eqData = [['Позиция', 'Категория', 'Кол.', 'Тип', 'Вес кг', 'Объём м³', 'Ставка ₽/сут']];
        for (const eq of stateWithAutoFill.equipment) {
          const item = catalog.find((e) => e.id === eq.id);
          if (!item) continue;
          eqData.push([
            item.name, item.category, num(eq.qty, 1),
            eq.rent ? 'Аренда' : 'Наше',
            num(item.weight_kg, 0), num(item.volume_m3, 0),
            num(eq.rent ? item.rent_day : item.amort_day, 0)
          ]);
        }
        const ws4 = X.utils.aoa_to_sheet(eqData);
        ws4['!cols'] = [{ wch: 35 }, { wch: 16 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 14 }];
        X.utils.book_append_sheet(wb, ws4, 'Оборудование');
      }

      const filename = `Расчёт_${dateNow.replace(/\./g, '-')}.xlsx`;
      X.writeFile(wb, filename);
      toast.success('Excel-файл скачан');
    } catch (e) {
      toast.error('Не удалось экспортировать: ' + (e?.message || e));
    } finally {
      setExportBusy(false);
    }
  };

  if (!allowed) {
    return (
      <div className="card p-24 t-center">
        <div className="fs-14 c-t3">Доступ только для ADMIN, PM, HEAD_PM, TO, HEAD_TO, директоров.</div>
      </div>
    );
  }
  if (!loaded || !state || !summary) {
    return <div className="card card-empty">⏳ Загружаем настройки калькулятора…</div>;
  }

  const tenderOptions = tenders.map((t) => ({
    value: t.id,
    label: `#${t.id} ${t.customer_name || ''} · ${t.tender_title || t.title || '—'}`
  }));

  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="Просчёты"
        title="Рунический Калькулятор ᚱ"
        subtitle={tender
          ? `${tender.customer_name || '—'} · ${tender.tender_title || tender.title || ''}`
          : 'Выберите тендер или считайте «вслепую»'}
        actions={
          <>
            <Btn variant="ghost" disabled={exportBusy} onClick={onExportExcel}>📥 Excel</Btn>
            {tender && (
              <Btn variant="primary" disabled={saveBusy} onClick={onApply}>
                {saveBusy ? '…' : estimateId ? '💾 Обновить просчёт' : '✓ Применить в просчёт'}
              </Btn>
            )}
          </>
        }
      />

      <div className="calc-head-grid">
        <Field label="Тендер">
          <Combobox
            options={tenderOptions}
            value={tenderId}
            onChange={setTenderId}
            placeholder="Выберите тендер (опционально)"
          />
        </Field>
        <div className="calc-side-pill">
          {estimateId && <Pill tone="info">Просчёт #{estimateId}</Pill>}
          {summary.status === 'green' && <Pill tone="approved">🟢 Зелёная зона</Pill>}
          {summary.status === 'yellow' && <Pill tone="amber">🟡 Жёлтая</Pill>}
          {summary.status === 'red' && <Pill tone="rejected">🔴 Красная</Pill>}
        </div>
      </div>

      <div className="calc-grid">
        {/* Левая часть: вкладки */}
        <div>
          <div className="calc-tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={'calc-tab ' + (tab === t.id ? 'calc-tab--active' : '')}
                onClick={() => setTab(t.id)}
                type="button"
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="card calc-card-inner">
            {tab === 'object'    && <ObjectTab    state={stateWithAutoFill} settings={settings} set={set} toggleCondition={toggleCondition} />}
            {tab === 'params'    && <ParamsTab    state={stateWithAutoFill} settings={settings} set={set} onAutoFill={onAutoFill} />}
            {tab === 'crew'      && <CrewTab      state={stateWithAutoFill} settings={settings} set={set} toggleSurcharge={toggleSurcharge} />}
            {tab === 'time'      && <TimeTab      state={stateWithAutoFill} set={set} />}
            {tab === 'chem'      && <ChemTab      state={stateWithAutoFill} settings={settings} set={set} />}
            {tab === 'equip'     && <EquipmentTab state={stateWithAutoFill} catalog={catalog} set={set} />}
            {tab === 'logistics' && <LogisticsTab state={stateWithAutoFill} settings={settings} summary={summary} set={set} />}
            {tab === 'totals'    && <TotalsTab    state={stateWithAutoFill} summary={summary} set={set} />}
          </div>
        </div>

        {/* Правая часть: sticky-сводка */}
        <div className="calc-summary">
          <div className={'calc-status-card calc-status-card--' + summary.status}>
            <div className="calc-status__lbl">Прибыль / чел-день</div>
            <div className="calc-status__val">{fmtMoney(summary.profit_per_day)}</div>
            <div className="calc-status__sub">
              {summary.status === 'green'  && `≥ нормы ${fmtMoney(summary.norm_profit)}`}
              {summary.status === 'yellow' && `≥ минимума ${fmtMoney(summary.min_profit)}`}
              {summary.status === 'red'    && `ниже минимума ${fmtMoney(summary.min_profit)}`}
            </div>
          </div>
          <div className="calc-kpi">
            <div className="calc-kpi__lbl">Себестоимость</div>
            <div className="calc-kpi__val">{fmtMoney(summary.cost_total)}</div>
            <div className="calc-kpi__sub">база + накладные + ФОТ-налоги</div>
          </div>
          <div className="calc-kpi">
            <div className="calc-kpi__lbl">Цена без НДС</div>
            <div className="calc-kpi__val c-gold">{fmtMoney(summary.price_no_vat)}</div>
            <div className="calc-kpi__sub">маржа {summary.margin_pct}%</div>
          </div>
          <div className="calc-kpi">
            <div className="calc-kpi__lbl">Цена с НДС</div>
            <div className="calc-kpi__val c-gold">{fmtMoney(summary.price_with_vat)}</div>
            <div className="calc-kpi__sub">НДС {summary.vat_pct}%</div>
          </div>
          <div className="calc-kpi">
            <div className="calc-kpi__lbl">Чистая прибыль</div>
            <div className="calc-kpi__val" style={{ color: summary.net_profit > 0 ? 'var(--ok)' : 'var(--err)' }}>
              {fmtMoney(summary.net_profit)}
            </div>
            <div className="calc-kpi__sub">после налога на прибыль</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   director_view — для модалок согласования
   ════════════════════════════════════════════════════════════════════════ */
function buildDirectorView(st, sum, settings) {
  const wt = (settings.work_types || []).find((w) => w.id === st.work_type_id);
  return {
    work_type: wt ? wt.name : st.work_type_id,
    city: st.city || '',
    distance_km: sum.distance_km,
    conditions: (st.conditions || []).slice(),
    assumptions: st.assumptions || '',
    work_days: sum.work_days,
    prep_days: sum.prep_days,
    demob_days: sum.demob_days,
    total_days: sum.total_days,
    crew: (st.crew || []).map((c) => ({
      role_id: c.role_id, role_name: c.role_name, count: num(c.count, 0)
    })),
    people: sum.people_count,
    payroll_total: Math.round(sum.payroll_total),
    fot_tax: Math.round(sum.fot_tax),
    fot_tax_pct: num(sum.fot_tax_pct, 0),
    per_diem_total: Math.round(sum.per_diem_total),
    lodging_total: Math.round(sum.lodging_total),
    lodging_type: st.lodging_type,
    ppe_total: Math.round(sum.ppe_total),
    mobilization_total: Math.round(sum.mobilization_total),
    mobilization_type: sum.mobilization_type,
    chemicals_total: Math.round(sum.chem_total),
    consumables: Math.round(sum.consumables),
    equipment_total: Math.round(sum.equip_total),
    logistics_cost: Math.round(sum.logistics_total),
    transport_name: sum.transport ? sum.transport.name : null,
    total_weight_kg: Math.round(sum.total_weight_kg),
    total_volume_m3: Number(sum.total_volume_m3.toFixed(3)),
    overhead_total: Math.round(sum.overhead),
    overhead_pct: num(sum.overhead_pct, 0),
    cost_total: Math.round(sum.cost_total),
    margin_pct: num(sum.margin_pct, 0),
    profit_tax_pct: num(sum.profit_tax_pct, 0),
    price_tkp_no_vat: Math.round(sum.price_no_vat),
    vat_pct: num(sum.vat_pct, 0),
    price_tkp_with_vat: Math.round(sum.price_with_vat),
    net_profit: Math.round(sum.net_profit),
    profit_per_person_day: Math.round(sum.profit_per_day),
    status: sum.status,
    min_profit_per_person_day: Math.round(sum.min_profit),
    norm_profit_per_person_day: Math.round(sum.norm_profit)
  };
}
