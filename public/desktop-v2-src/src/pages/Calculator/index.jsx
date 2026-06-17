/**
 * Страница /calculator — Калькулятор работ (для ТО/PM).
 *
 * Источник: vanilla `public/assets/js/calculator.js` (786 строк) — AsgardCalc.
 *
 * Coverage:
 *   ✅ 6 вкладок: Сроки/персонал, Расходы, Химия, Оборудование, Логистика, Итоги
 *   ✅ Роли (8) с count/rate из настроек
 *   ✅ Мобилизации (множественные с label/people/cost_per_person)
 *   ✅ Химия (выбор + объём системы + авто-расчёт кг и стоимости)
 *   ✅ Оборудование (own/rent/buy + вес + объём, авто-расчёт по типу)
 *   ✅ Логистика (город + км + транспорт AUTO/из списка)
 *   ✅ Сводная панель (sticky) — себестоимость / цена ТКП без+с НДС / чистая прибыль / прибыль за чел-день
 *   ✅ Загрузка настроек из /api/settings/app (calc.role_rates / chemicals / transport_options / overhead_pct / fot_tax_pct / profit_tax_pct / min_profit_per_person_day)
 *   ✅ Выбор тендера + загрузка существующего просчёта (calc_summary_json)
 *   ✅ «Применить в просчёт» — создать/обновить estimate с calc_summary_json
 *   ✅ Excel-экспорт (через SheetJS если доступен)
 *   ✅ Светофор минимума прибыли (ok/warn)
 *
 * Hash: `#/calculator?tender=123` подгружает тендер.
 *
 * RBAC: ADMIN, PM, HEAD_PM, TO, HEAD_TO, DIRECTOR_*.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/api/useAuth';
import { toast } from '@/modals/Notifications';
import { Btn, Field, Pill } from '@/modals/parts';
import { TopActionsBar } from '@/blocks/Blocks';
import { TextInput, NumberInput, SelectInput, Combobox, MoneyInput as _MoneyInput } from '@/inputs/Inputs';
import {
  loadAppSettings, loadTenders, loadEstimatesByTender, loadEstimate as _loadEstimate,
  createEstimate, updateEstimate,
  defaultsFromSettings, mergeState, compute, safeParse,
  fmtMoney, num, clamp as _clamp, ROLE_LIST as _ROLE_LIST
} from './api';
import './calculator.css';

const ALLOWED_ROLES = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

const TABS = [
  { id: 'p',  label: 'Сроки/Персонал' },
  { id: 'x',  label: 'Расходы' },
  { id: 'ch', label: 'Химия' },
  { id: 'eq', label: 'Оборудование' },
  { id: 'lg', label: 'Логистика' },
  { id: 't',  label: 'Итоги' }
];

export default function CalculatorPage() {
  const { user } = useAuth();
  const allowed = ALLOWED_ROLES.includes(user?.role);

  const [tab, setTab] = useState('p');
  const [app, setApp] = useState({});
  const [appLoaded, setAppLoaded] = useState(false);
  const [tenders, setTenders] = useState([]);
  const [tenderId, setTenderId] = useState('');
  const [estimateId, setEstimateId] = useState(null);
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);

  // Загрузка настроек + тендеров
  useEffect(() => {
    Promise.all([loadAppSettings(), loadTenders({ limit: 2000 })])
      .then(([appSettings, tList]) => {
        setApp(appSettings);
        setTenders(tList);
        setAppLoaded(true);
        setState(defaultsFromSettings(appSettings));
      })
      .catch((e) => toast.error('Не удалось загрузить настройки: ' + (e?.message || e)));
  }, []);

  // Deep link `?tender=NN`
  useEffect(() => {
    const m = (window.location.hash || '').match(/[?&]tender=(\d+)/);
    if (m && m[1]) setTenderId(Number(m[1]));
  }, []);

  // Подгрузить просчёт по тендеру
  useEffect(() => {
    if (!appLoaded || !tenderId) return;
    loadEstimatesByTender(tenderId)
      .then((list) => {
        const latest = list[0];
        if (latest?.calc_summary_json) {
          const saved = safeParse(latest.calc_summary_json, null);
          const input = saved && saved.input ? saved.input : saved;
          const base = defaultsFromSettings(app);
          setState(mergeState(base, input));
          setEstimateId(latest.id);
          toast.info('Загружен расчёт версии ' + (latest.version || 1));
        } else if (latest) {
          setEstimateId(latest.id);
        } else {
          setEstimateId(null);
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenderId, appLoaded]);

  const tender = useMemo(() => tenders.find((t) => t.id === Number(tenderId)) || null, [tenderId, tenders]);
  const summary = useMemo(() => state ? compute(state, app) : null, [state, app]);

  const set = useCallback((k, v) => setState((s) => ({ ...s, [k]: v })), []);
  const setRole = (idx, k, v) => setState((s) => {
    const roles = s.roles.slice();
    roles[idx] = { ...roles[idx], [k]: num(v, 0) };
    return { ...s, roles };
  });
  const setMob = (idx, k, v) => setState((s) => {
    const mobilizations = s.mobilizations.slice();
    mobilizations[idx] = { ...mobilizations[idx], [k]: k === 'label' ? String(v || '') : num(v, 0) };
    return { ...s, mobilizations };
  });
  const addMob = () => setState((s) => ({
    ...s,
    mobilizations: [...s.mobilizations, { label: `Мобилизация ${s.mobilizations.length + 1}`, people: 0, cost_per_person: 0 }]
  }));
  const delMob = (idx) => setState((s) => {
    const mobilizations = s.mobilizations.filter((_, i) => i !== idx);
    return {
      ...s,
      mobilizations: mobilizations.length ? mobilizations : [{ label: 'Мобилизация 1', people: 0, cost_per_person: 0 }]
    };
  });
  const setEq = (idx, k, v) => setState((s) => {
    const equipment = s.equipment.slice();
    equipment[idx] = { ...equipment[idx], [k]: k === 'name' || k === 'kind' ? String(v || '') : num(v, 0) };
    return { ...s, equipment };
  });
  const addEq = () => setState((s) => ({
    ...s,
    equipment: [...s.equipment, { name: '', kind: 'own', cost: 0, rate_per_day: 0, amort: 0, weight_kg: 0, volume_m3: 0 }]
  }));
  const delEq = (idx) => setState((s) => ({
    ...s,
    equipment: s.equipment.filter((_, i) => i !== idx)
  }));

  const onApply = async () => {
    if (!summary) return;
    if (!tender) {
      toast.warn('Сначала выберите тендер');
      return;
    }
    if (!summary.ok) {
      toast.error(`Прибыль/чел-день ${fmtMoney(summary.profit_per_person_day)} < минимум ${fmtMoney(summary.min_ppd)}`);
      setTab('t');
      return;
    }
    setSaveBusy(true);
    try {
      const payload = {
        _type: 'asgard_calc_v1',
        input: state,
        output: summary,
        director_view: buildDirectorView(state, summary)
      };
      const calcJson = JSON.stringify(payload);
      const body = {
        tender_id: tender.id,
        pm_id: tender.responsible_pm_id || tender.pm_id || user?.id,
        version: estimateId ? undefined : 1,
        status: 'Новый',
        cost_plan: Math.round(summary.costTotal),
        price_tkp: Math.round(summary.priceWithVat),
        calc_summary_json: calcJson
      };
      if (estimateId) {
        await updateEstimate(estimateId, body);
        toast.success('Просчёт обновлён');
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

  const onExportExcel = async () => {
    if (!summary) return;
    setBusy(true);
    try {
      if (typeof window.XLSX === 'undefined') {
        toast.error('Библиотека XLSX не загружена');
        setBusy(false);
        return;
      }
      const X = window.XLSX;
      const wb = X.utils.book_new();
      const dateNow = new Date().toLocaleDateString('ru-RU');
      const summaryData = [
        ['АСГАРД СЕРВИС — Калькулятор просчёта'],
        [],
        ['Рабочие дни:', summary.workDays],
        ['Подготовка:', summary.prepDays + ' дн.'],
        ['Всего дней:', summary.totalDays + ' дн.'],
        ['Бригада:', summary.peopleWork + ' чел'],
        [],
        ['ИТОГИ'],
        ['ФОТ (итого):', Math.round(summary.payrollTotal)],
        ['Налоги ФОТ:', Math.round(summary.fotTax)],
        ['Суточные:', Math.round(summary.perDiem)],
        ['Проживание:', Math.round(summary.lodging)],
        ['СИЗ:', Math.round(summary.ppe)],
        ['Мобилизация:', Math.round(summary.mobilization)],
        ['Оборудование:', Math.round(summary.equipCost)],
        ['Химия:', Math.round(summary.chem ? summary.chem.cost : 0)],
        ['Логистика:', Math.round(summary.logistics)],
        ['Накладные (' + summary.overhead_pct + '%):', Math.round(summary.overhead)],
        [],
        ['СЕБЕСТОИМОСТЬ:', Math.round(summary.costTotal)],
        ['Маржа:', summary.margin_pct + '%'],
        ['Цена без НДС:', Math.round(summary.priceNoVat)],
        ['НДС (' + summary.vatPct + '%):', Math.round(summary.priceWithVat - summary.priceNoVat)],
        ['ЦЕНА С НДС:', Math.round(summary.priceWithVat)],
        ['Чистая прибыль:', Math.round(summary.netProfit)],
        ['Прибыль/чел-день:', Math.round(summary.profit_per_person_day)],
        ['Статус:', summary.ok ? 'НОРМА' : 'НИЗКАЯ'],
        [],
        ['Дата расчёта:', dateNow]
      ];
      const ws1 = X.utils.aoa_to_sheet(summaryData);
      ws1['!cols'] = [{ wch: 28 }, { wch: 20 }];
      X.utils.book_append_sheet(wb, ws1, 'Сводка');
      const crewData = [['Роль', 'Кол-во', 'Ставка/смена']];
      for (const r of state.roles || []) {
        if (r.count > 0) crewData.push([r.role, r.count, r.rate]);
      }
      if (crewData.length > 1) {
        const ws2 = X.utils.aoa_to_sheet(crewData);
        ws2['!cols'] = [{ wch: 20 }, { wch: 10 }, { wch: 16 }];
        X.utils.book_append_sheet(wb, ws2, 'Бригада');
      }
      if (state.equipment?.length) {
        const eqData = [['Название', 'Тип', 'Вес,кг', 'Объём,м³', 'Стоимость']];
        for (const e of state.equipment) {
          const cost = e.kind === 'buy' ? e.cost : (e.kind === 'rent' ? e.rate_per_day : e.amort) || 0;
          eqData.push([e.name || '', e.kind || 'own', e.weight_kg || 0, e.volume_m3 || 0, cost]);
        }
        const ws3 = X.utils.aoa_to_sheet(eqData);
        ws3['!cols'] = [{ wch: 25 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 14 }];
        X.utils.book_append_sheet(wb, ws3, 'Оборудование');
      }
      const filename = 'Расчёт_' + dateNow.replace(/\./g, '-') + '.xlsx';
      X.writeFile(wb, filename);
      toast.success('Excel-файл скачан');
    } catch (e) {
      toast.error('Не удалось экспортировать: ' + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  if (!allowed) {
    return (
      <div className="card p-24 t-center" >
        <div className="fs-14 c-t3">
          Доступ только для ADMIN, PM, HEAD_PM, TO, HEAD_TO, директоров.
        </div>
      </div>
    );
  }
  if (!state || !summary) {
    return (
      <div className="card card-empty" >
        ⏳ Загружаем настройки калькулятора…
      </div>
    );
  }

  const tenderOptions = tenders.map((t) => ({
    value: t.id,
    label: `#${t.id} ${t.customer_name || ''} · ${t.tender_title || t.title || '—'}`
  }));

  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="Просчёты"
        title="Калькулятор работ"
        subtitle={tender ? `${tender.customer_name || '—'} · ${tender.tender_title || tender.title || ''}` : 'Выберите тендер или считайте «вслепую»'}
        actions={
          <>
            <Btn variant="ghost" disabled={busy || !summary} onClick={onExportExcel}>📥 Excel</Btn>
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
          {!summary.ok && <Pill tone="rejected">Прибыль ниже нормы</Pill>}
          {summary.ok && <Pill tone="approved">Норма</Pill>}
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
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="card calc-card-inner">
            {tab === 'p' && (
              <PersonnelTab state={state} set={set} setRole={setRole} />
            )}
            {tab === 'x' && (
              <ExpensesTab
                state={state}
                set={set}
                setMob={setMob}
                addMob={addMob}
                delMob={delMob}
              />
            )}
            {tab === 'ch' && (
              <ChemistryTab state={state} app={app} set={set} />
            )}
            {tab === 'eq' && (
              <EquipmentTab
                state={state}
                setEq={setEq}
                addEq={addEq}
                delEq={delEq}
              />
            )}
            {tab === 'lg' && (
              <LogisticsTab state={state} app={app} set={set} summary={summary} />
            )}
            {tab === 't' && (
              <TotalsTab summary={summary} />
            )}
          </div>
        </div>

        {/* Правая часть: sticky-сводка */}
        <div className="calc-summary">
          {summary.ok ? (
            <div className="calc-ok">
              ✓ Прибыль/чел-день: <strong>{fmtMoney(summary.profit_per_person_day)}</strong>
              <div className="calc-help-sub">норма: {fmtMoney(summary.min_ppd)}</div>
            </div>
          ) : (
            <div className="calc-warn">
              ⚠ Прибыль/чел-день: <strong>{fmtMoney(summary.profit_per_person_day)}</strong>
              <div className="calc-help-sub">минимум: {fmtMoney(summary.min_ppd)}</div>
            </div>
          )}
          <div className="calc-kpi">
            <div className="calc-kpi__lbl">Себестоимость</div>
            <div className="calc-kpi__val">{fmtMoney(summary.costTotal)}</div>
            <div className="calc-kpi__sub">база + накладные + ФОТ-налоги</div>
          </div>
          <div className="calc-kpi">
            <div className="calc-kpi__lbl">Цена ТКП без НДС</div>
            <div className="calc-kpi__val c-gold" >{fmtMoney(summary.priceNoVat)}</div>
            <div className="calc-kpi__sub">маржа {summary.margin_pct}%</div>
          </div>
          <div className="calc-kpi">
            <div className="calc-kpi__lbl">Цена ТКП с НДС</div>
            <div className="calc-kpi__val c-gold" >{fmtMoney(summary.priceWithVat)}</div>
            <div className="calc-kpi__sub">НДС {summary.vatPct}%</div>
          </div>
          <div className="calc-kpi">
            <div className="calc-kpi__lbl">Чистая прибыль</div>
            <div className="calc-kpi__val" style={{ color: summary.netProfit > 0 ? 'var(--ok)' : 'var(--err)' }}>
              {fmtMoney(summary.netProfit)}
            </div>
            <div className="calc-kpi__sub">после налога на прибыль</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   ВКЛАДКИ
   ════════════════════════════════════════════════════════════════════════ */

function PersonnelTab({ state, set, setRole }) {
  return (
    <div>
      <div className="calc-row">
        <Field label="Срок работ, суток">
          <NumberInput value={state.work_days} onChange={(v) => set('work_days', num(v, 0))} min={0} />
        </Field>
        <Field label="Подготовка на складе, суток">
          <NumberInput value={state.prep_days} onChange={(v) => set('prep_days', num(v, 0))} min={0} />
        </Field>
        <Field label="Маржа, % (по чистой прибыли)">
          <NumberInput value={state.margin_pct} onChange={(v) => set('margin_pct', num(v, 0))} min={0} step={0.1} />
        </Field>
      </div>
      <div className="calc-row">
        <Field label="Подготовку выполняют: людей">
          <NumberInput value={state.prep_people} onChange={(v) => set('prep_people', num(v, 0))} min={0} />
        </Field>
        <Field label="Ставка подготовки, ₽/сутки">
          <NumberInput value={state.prep_rate} onChange={(v) => set('prep_rate', num(v, 0))} min={0} />
        </Field>
        <Field label="НДС, %">
          <NumberInput value={state.vat_pct} onChange={(v) => set('vat_pct', num(v, 0))} min={0} max={30} step={0.1} />
        </Field>
      </div>

      <h3 className="mt-18 mb-8 fs-14">Персонал и ставки по ролям</h3>
      <div className="ov-x-auto">
        <table className="calc-tbl">
          <thead>
            <tr>
              <th className="calc-th-40">Роль</th>
              <th>Количество</th>
              <th>Ставка, ₽/смена</th>
            </tr>
          </thead>
          <tbody>
            {(state.roles || []).map((r, idx) => (
              <tr key={r.role}>
                <td><strong>{r.role}</strong></td>
                <td><NumberInput value={r.count} onChange={(v) => setRole(idx, 'count', v)} min={0} /></td>
                <td><NumberInput value={r.rate} onChange={(v) => setRole(idx, 'rate', v)} min={0} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ExpensesTab({ state, set, setMob, addMob, delMob }) {
  return (
    <div>
      <div className="calc-row">
        <Field label="Суточные, ₽/чел/сутки">
          <NumberInput value={state.per_diem} onChange={(v) => set('per_diem', num(v, 0))} min={0} />
        </Field>
        <Field label="Проживание, ₽/чел/сутки">
          <NumberInput value={state.lodging_per_person_day} onChange={(v) => set('lodging_per_person_day', num(v, 0))} min={0} />
        </Field>
        <Field label="СИЗ, ₽/чел">
          <NumberInput value={state.ppe_per_person} onChange={(v) => set('ppe_per_person', num(v, 0))} min={0} />
        </Field>
      </div>

      <h3 className="mt-18 mb-8 fs-14">Мобилизация</h3>
      <div className="calc-hint">
        Можно добавить несколько мобилизаций с разной ценой и количеством людей. Сумма считается туда-обратно по введённой цене.
      </div>
      <div className="ov-x-auto">
        <table className="calc-tbl">
          <thead>
            <tr>
              <th>Название</th>
              <th>Людей</th>
              <th>₽/чел (туда-обратно)</th>
              <th className="w-80">&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {(state.mobilizations || []).map((m, idx) => (
              <tr key={idx}>
                <td><TextInput value={m.label} onChange={(v) => setMob(idx, 'label', v)} /></td>
                <td><NumberInput value={m.people} onChange={(v) => setMob(idx, 'people', v)} min={0} /></td>
                <td><NumberInput value={m.cost_per_person} onChange={(v) => setMob(idx, 'cost_per_person', v)} min={0} /></td>
                <td><Btn size="sm" variant="ghost" onClick={() => delMob(idx)}>✕</Btn></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-10">
        <Btn size="sm" onClick={addMob}>+ Мобилизация</Btn>
      </div>
    </div>
  );
}

function ChemistryTab({ state, app, set }) {
  const chemList = app.calc?.chemicals || [];
  return (
    <div>
      <div className="calc-row-2">
        <Field label="Объём системы, м³">
          <NumberInput value={state.system_volume_m3} onChange={(v) => set('system_volume_m3', num(v, 0))} min={0} step={0.1} />
        </Field>
        <Field label="Состав">
          <SelectInput
            value={String(state.chemical_id || '')}
            onChange={(v) => set('chemical_id', String(v || ''))}
            options={chemList.map((c) => ({
              value: String(c.id),
              label: `${c.name} · ${c.price_per_kg}₽/кг · ${c.kg_per_m3}кг/м³`
            }))}
          />
        </Field>
      </div>
      <div className="calc-hint-tight">
        Расход химии считается по норме кг/м³. Вес химии и примерный объём автоматически попадают в логистику.
      </div>
    </div>
  );
}

function EquipmentTab({ state, setEq, addEq, delEq }) {
  const KIND_OPTS = [
    { value: 'own',  label: 'Наше' },
    { value: 'rent', label: 'Аренда' },
    { value: 'buy',  label: 'Покупка' }
  ];
  return (
    <div>
      <div className="calc-hint-mb-10">
        Для логистики укажите вес и объём (м³). Для «аренды» ставка умножается на дни работ.
      </div>
      <div className="ov-x-auto">
        <table className="calc-tbl">
          <thead>
            <tr>
              <th className="min-w-160">Позиция</th>
              <th className="w-130">Тип</th>
              <th className="w-160">Стоимость</th>
              <th className="w-110">Вес, кг</th>
              <th className="w-110">Объём, м³</th>
              <th className="w-60">&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {(state.equipment || []).map((e, idx) => {
              const costKey = e.kind === 'buy' ? 'cost' : e.kind === 'rent' ? 'rate_per_day' : 'amort';
              const costLabel = e.kind === 'buy' ? 'Стоимость, ₽' : e.kind === 'rent' ? '₽/сутки' : 'Амортизация, ₽';
              return (
                <tr key={idx}>
                  <td><TextInput value={e.name} onChange={(v) => setEq(idx, 'name', v)} placeholder="Насос, НВД…" /></td>
                  <td>
                    <SelectInput value={e.kind} onChange={(v) => setEq(idx, 'kind', v)} options={KIND_OPTS} />
                  </td>
                  <td>
                    <div className="fs-11 c-t3 mb-4">{costLabel}</div>
                    <NumberInput value={e[costKey]} onChange={(v) => setEq(idx, costKey, v)} min={0} />
                  </td>
                  <td><NumberInput value={e.weight_kg} onChange={(v) => setEq(idx, 'weight_kg', v)} min={0} /></td>
                  <td><NumberInput value={e.volume_m3} onChange={(v) => setEq(idx, 'volume_m3', v)} min={0} step={0.01} /></td>
                  <td><Btn size="sm" variant="ghost" onClick={() => delEq(idx)}>✕</Btn></td>
                </tr>
              );
            })}
            {!(state.equipment || []).length && (
              <tr><td colSpan={6} className="calc-empty-cell">Пока нет позиций.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-10">
        <Btn size="sm" onClick={addEq}>+ Оборудование</Btn>
      </div>
    </div>
  );
}

function LogisticsTab({ state, app, set, summary }) {
  const transList = app.calc?.transport_options || app.calc?.transport || [];
  const transOpts = [{ value: 'AUTO', label: 'Авто-подбор' }].concat(
    transList.map((t) => ({
      value: String(t.id),
      label: `${t.name} · до ${t.max_weight_t}т / ${t.max_volume_m3}м³ · ${t.rate_per_km}₽/км`
    }))
  );
  return (
    <div>
      <div className="calc-row">
        <Field label="Город">
          <TextInput value={state.city} onChange={(v) => set('city', String(v || ''))} placeholder="Город выполнения работ" />
        </Field>
        <Field label="Расстояние, км (в одну сторону)">
          <NumberInput value={state.distance_km} onChange={(v) => set('distance_km', num(v, 0))} min={0} />
        </Field>
        <Field label="Транспорт">
          <SelectInput
            value={String(state.transport_id || 'AUTO')}
            onChange={(v) => set('transport_id', String(v || 'AUTO'))}
            options={transOpts}
          />
        </Field>
      </div>

      <div className="calc-row mt-16 mb-0" >
        <div className="calc-kpi">
          <div className="calc-kpi__lbl">Вес</div>
          <div className="calc-kpi__val">{Math.round(summary.totalWeightKg || 0)} кг</div>
          <div className="calc-kpi__sub">химия + оборудование</div>
        </div>
        <div className="calc-kpi">
          <div className="calc-kpi__lbl">Объём</div>
          <div className="calc-kpi__val">{(summary.totalVolM3 || 0).toFixed(2)} м³</div>
          <div className="calc-kpi__sub">для подбора транспорта</div>
        </div>
        <div className="calc-kpi">
          <div className="calc-kpi__lbl">Транспорт</div>
          <div className="calc-kpi__val">{summary.transport ? summary.transport.name : '—'}</div>
          <div className="calc-kpi__sub">{summary.transport ? summary.transport.rate_per_km + ' ₽/км' : ''}</div>
        </div>
      </div>
      <div className="mt-12">
        <Pill tone="info">Логистика туда-обратно: {fmtMoney(summary.logistics || 0)}</Pill>
      </div>
    </div>
  );
}

function TotalsTab({ summary }) {
  return (
    <div>
      <div className="calc-row mb-0" >
        <div className="calc-kpi">
          <div className="calc-kpi__lbl">Себестоимость (итог)</div>
          <div className="calc-kpi__val">{fmtMoney(summary.costTotal)}</div>
          <div className="calc-kpi__sub">база + накладные + ФОТ-налоги</div>
        </div>
        <div className="calc-kpi">
          <div className="calc-kpi__lbl">Цена ТКП без НДС</div>
          <div className="calc-kpi__val">{fmtMoney(summary.priceNoVat)}</div>
          <div className="calc-kpi__sub">маржа по чистой прибыли</div>
        </div>
        <div className="calc-kpi">
          <div className="calc-kpi__lbl">Цена ТКП с НДС</div>
          <div className="calc-kpi__val">{fmtMoney(summary.priceWithVat)}</div>
          <div className="calc-kpi__sub">НДС {summary.vatPct}%</div>
        </div>
      </div>
      <div className="calc-row mt-14 mb-0" >
        <div className="calc-kpi">
          <div className="calc-kpi__lbl">Чистая прибыль</div>
          <div className="calc-kpi__val">{fmtMoney(summary.netProfit)}</div>
          <div className="calc-kpi__sub">после налога на прибыль</div>
        </div>
        <div className="calc-kpi">
          <div className="calc-kpi__lbl">Прибыль/чел-день</div>
          <div className="calc-kpi__val">{fmtMoney(summary.profit_per_person_day)}</div>
          <div className="calc-kpi__sub">{summary.peopleWork} чел × {summary.workDays} дн.</div>
        </div>
        <div className="calc-kpi">
          <div className="calc-kpi__lbl">ФОТ (работы + подгот.)</div>
          <div className="calc-kpi__val">{fmtMoney(summary.payrollTotal)}</div>
          <div className="calc-kpi__sub">+ налоги {fmtMoney(summary.fotTax)}</div>
        </div>
      </div>
      <div className="calc-row mt-14 mb-0" >
        <div className="calc-kpi">
          <div className="calc-kpi__lbl">Суточные</div>
          <div className="calc-kpi__val">{fmtMoney(summary.perDiem)}</div>
        </div>
        <div className="calc-kpi">
          <div className="calc-kpi__lbl">Проживание</div>
          <div className="calc-kpi__val">{fmtMoney(summary.lodging)}</div>
        </div>
        <div className="calc-kpi">
          <div className="calc-kpi__lbl">Накладные</div>
          <div className="calc-kpi__val">{fmtMoney(summary.overhead)}</div>
          <div className="calc-kpi__sub">{summary.overhead_pct}%</div>
        </div>
      </div>
      <div className="mt-18 c-t3 fs-13">
        Сохранение запишет результат в просчёт (себестоимость + цена) и сохранит детализацию в <code>calc_summary_json</code>.
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   director_view (для модалок согласования) — порт из vanilla
   ════════════════════════════════════════════════════════════════════════ */
function buildDirectorView(state, s) {
  return {
    ok: !!s.ok,
    min_profit_per_person_day: Math.round(s.min_ppd || 0),
    work_days: s.workDays,
    prep_days: s.prepDays,
    total_days: s.totalDays,
    roles: (state.roles || []).map((r) => ({ role: r.role, count: Number(r.count) || 0, rate: Number(r.rate) || 0 })),
    people: s.peopleWork,
    payroll_total: Math.round(s.payrollTotal),
    fot_tax: Math.round(s.fotTax),
    fot_tax_pct: Number(s.fot_tax_pct || 0),
    per_diem_total: Math.round(s.perDiem),
    lodging_total: Math.round(s.lodging),
    ppe_total: Math.round(s.ppe),
    mobilization_total: Math.round(s.mobilization),
    chemicals_total: Math.round((s.chem && s.chem.cost) || 0),
    equipment_total: Math.round(s.equipCost || 0),
    logistics_cost: Math.round(s.logistics || 0),
    transport_name: s.transport ? s.transport.name : null,
    total_weight_kg: Math.round(s.totalWeightKg || 0),
    total_volume_m3: Number((s.totalVolM3 || 0).toFixed(3)),
    overhead_total: Math.round(s.overhead || 0),
    overhead_pct: Number(s.overhead_pct || 0),
    cost_total: Math.round(s.costTotal),
    margin_pct: Number(s.margin_pct || 0),
    profit_tax_pct: Number(s.profit_tax_pct || 0),
    price_tkp_no_vat: Math.round(s.priceNoVat),
    vat_pct: Number(s.vatPct || 0),
    price_tkp_with_vat: Math.round(s.priceWithVat),
    net_profit: Math.round(s.netProfit),
    profit_per_person_day: Math.round(s.profit_per_person_day || 0)
  };
}
