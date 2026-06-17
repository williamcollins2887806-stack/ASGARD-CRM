/**
 * MimirActualsModal — внесение факта завершённой работы в эталоны Мимира.
 * Источник vanilla: openSaveActualsModal в pm_works.js:1809-1929.
 * Бэк: POST /api/mimir/conductor/reference/import (создаёт эталон в mimir_reference_projects)
 *
 * Полный набор полей (22) согласно vanilla:
 * - customer_name, object_name, city, work_type, industry_sector
 * - cost_planned, cost_actual, contract_value_actual, profit_actual, margin_actual_pct
 * - duration_planned_calendar_days, duration_actual_calendar_days
 * - crew_size_planned, crew_size_actual, work_regime, crew_composition_actual (JSON)
 * - resources_actual (JSON), variance (JSON), insights (JSON)
 * - notes, source_work_id, quality_score
 */
import { useEffect, useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { Field, TextInput, MoneyInput, TextareaInput, NumberInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { api } from '@/api/client';
import { loadFinancialSummary } from '../api';
import { loadCrew } from './FieldTab/api';

/** Безопасный JSON.parse → null при ошибке, выбрасывает только если строка непустая. */
function tryParseJSON(str) {
  if (!str || !String(str).trim()) return null;
  try { return JSON.parse(str); } catch (e) { throw new Error(`JSON-ошибка: ${e.message}`); }
}

export function MimirActualsModal({ work }) {
  const { close } = useModal();
  const [busy, setBusy] = useState(false);
  const [_fin, setFin] = useState(null);
  const [form, setForm] = useState({
    // Базовые поля (заполняются из work + financial-summary)
    customer_name: work.customer_name || '',
    object_name: work.object_name || work.work_title || '',
    city: work.city || work.object_place || '',
    work_type: work.work_title || 'Подрядные работы',
    industry_sector: '',
    // Финансы
    cost_planned: work.cost_plan || '',
    cost_actual: work.cost_fact || '',
    contract_value_actual: work.contract_value || work.tender_price || '',
    profit_actual: '',
    margin_actual_pct: '',
    // Сроки
    duration_planned_calendar_days: '',
    duration_actual_calendar_days: '',
    // Бригада
    crew_size_planned: '',
    crew_size_actual: '',
    work_regime: '',
    crew_composition_actual: '', // JSON-строка
    // Детализация (JSON-строки)
    resources_actual: '',
    variance: '',
    insights: '',
    notes: ''
  });

  useEffect(() => {
    Promise.all([
      loadFinancialSummary(work.id),
      loadCrew(work.id).catch(() => [])
    ]).then(([f, crew]) => {
      setFin(f || {});
      const crewSize = crew.length || '';
      const contract = +(work.contract_value || work.tender_price || 0);
      const cost = +(work.cost_fact || f?.expense_total || 0);
      const margin = (contract > 0 && cost >= 0) ? ((contract - cost) / contract) * 100 : '';
      const profit = (contract > 0 && cost >= 0) ? contract - cost : '';
      let days = '';
      if (work.start_date && work.end_fact) {
        const d1 = new Date(work.start_date).getTime();
        const d2 = new Date(work.end_fact).getTime();
        if (Number.isFinite(d1) && Number.isFinite(d2)) {
          days = Math.max(1, Math.round((d2 - d1) / 86400000));
        }
      }
      setForm((s) => ({
        ...s,
        cost_actual: cost || s.cost_actual,
        contract_value_actual: contract || s.contract_value_actual,
        profit_actual: Number.isFinite(profit) ? profit : s.profit_actual,
        crew_size_actual: crewSize || s.crew_size_actual,
        duration_actual_calendar_days: days || s.duration_actual_calendar_days,
        margin_actual_pct: Number.isFinite(margin) ? Number(margin.toFixed(1)) : s.margin_actual_pct
      }));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [work.id]);

  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }));

  const save = async () => {
    if (!form.insights?.trim()) {
      return toast('Выводы (insights)', 'Опиши главные уроки в JSON-формате', 'warn');
    }

    let crewComp, resources, variance, insightsJson;
    try {
      crewComp = tryParseJSON(form.crew_composition_actual);
      resources = tryParseJSON(form.resources_actual);
      variance = tryParseJSON(form.variance);
      insightsJson = tryParseJSON(form.insights);
    } catch (e) {
      return toast('Ошибка JSON', String(e.message || e), 'err');
    }

    setBusy(true);
    try {
      // Полный набор полей — точная копия vanilla body (см. pm_works.js:1892-1915).
      // Inline-объект (а не через `const body = ...; api(url, {body})`) — нужен,
      // чтобы payload-audit.cjs корректно распарсил поля.
      const r = await api('/api/mimir/conductor/reference/import', {
        method: 'POST',
        body: {
          customer_name: form.customer_name || '',
          object_name: form.object_name || form.work_type || '',
          city: form.city || null,
          work_type: form.work_type || work.work_title || 'Подрядные работы',
          industry_sector: form.industry_sector || null,
          cost_planned: Number(form.cost_planned) || null,
          cost_actual: Number(form.cost_actual) || null,
          contract_value_actual: Number(form.contract_value_actual) || null,
          profit_actual: Number(form.profit_actual) || null,
          margin_actual_pct: Number(form.margin_actual_pct) || null,
          duration_planned_calendar_days: Number(form.duration_planned_calendar_days) || null,
          duration_actual_calendar_days: Number(form.duration_actual_calendar_days) || null,
          crew_size_planned: Number(form.crew_size_planned) || null,
          crew_size_actual: Number(form.crew_size_actual) || null,
          work_regime: form.work_regime || null,
          crew_composition_actual: crewComp,
          resources_actual: resources,
          variance: variance,
          insights: insightsJson,
          notes: form.notes || null,
          source_work_id: work.id,
          quality_score: 8 // РП сам внёс — высокая достоверность (vanilla)
        }
      });
      toast('📊 Эталон сохранён', `Reference id=${r?.reference_id || '—'}. Мимир будет использовать его в похожих просчётах.`, 'ok');
      close();
    } catch (e) {
      toast('Ошибка сохранения', String(e?.message || e), 'err');
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-xl">
      <MHead
        icon="📊"
        title={`Внести факт работы #${work.id}`}
        subtitle="Эталон для эталонов Мимира (RAG)"
        accent="purple"
        onClose={close}
      />
      <MBody>
        <div className="mimir-banner">
          💡 Внеси фактические показатели завершённой работы. Эти данные сохранятся как <strong>эталон</strong>
          и Mimir Conductor будет использовать их для расчёта похожих тендеров в будущем
          (точность просчётов растёт с каждым эталоном).
        </div>

        {/* Объект и отрасль (2 поля) */}
        <div className="grid-2 gap-10 mb-12">
          <Field label="Тип работ (канон.)" help="напр.: гидромеханическая очистка теплообменных труб">
            <TextInput value={form.work_type} onChange={(v) => set('work_type', v)} />
          </Field>
          <Field label="Отрасль" help="химия / СПГ / нефтехимия / газопереработка">
            <TextInput value={form.industry_sector} onChange={(v) => set('industry_sector', v)} placeholder="химия" />
          </Field>
        </div>

        {/* Объект (3 поля) */}
        <div className="grid-2-2-1 gap-10 mb-12">
          <Field label="Заказчик">
            <TextInput value={form.customer_name} onChange={(v) => set('customer_name', v)} />
          </Field>
          <Field label="Объект">
            <TextInput value={form.object_name} onChange={(v) => set('object_name', v)} />
          </Field>
          <Field label="Город">
            <TextInput value={form.city} onChange={(v) => set('city', v)} />
          </Field>
        </div>

        {/* Финансы план/факт (6 полей в 3×2) */}
        <div className="section-eyebrow">
          Финансы (план / факт)
        </div>
        <div className="grid-3 gap-10 mb-12">
          <Field label="Себест. план, ₽" help="напр.: 13 750 000">
            <MoneyInput value={form.cost_planned} onChange={(v) => set('cost_planned', v)} />
          </Field>
          <Field label="Себест. ФАКТ, ₽" help="напр.: 26 400 000">
            <MoneyInput value={form.cost_actual} onChange={(v) => set('cost_actual', v)} />
          </Field>
          <Field label="Цена договора факт (с НДС), ₽" help="после ДС">
            <MoneyInput value={form.contract_value_actual} onChange={(v) => set('contract_value_actual', v)} />
          </Field>
          <Field label="Прибыль факт, ₽" help="отрицательная = убыток">
            <MoneyInput value={form.profit_actual} onChange={(v) => set('profit_actual', v)} />
          </Field>
          <Field label="Маржа факт, %" help="напр.: −41,3">
            <NumberInput value={form.margin_actual_pct} onChange={(v) => set('margin_actual_pct', v)} step={0.1} />
          </Field>
          <Field label="Длительность план, кал. дней" help="напр.: 57">
            <NumberInput value={form.duration_planned_calendar_days} onChange={(v) => set('duration_planned_calendar_days', v)} min={1} />
          </Field>
        </div>

        {/* Сроки/бригада (3 поля) */}
        <div className="grid-3 gap-10 mb-12">
          <Field label="Длительность ФАКТ, кал. дней" help="напр.: 72">
            <NumberInput value={form.duration_actual_calendar_days} onChange={(v) => set('duration_actual_calendar_days', v)} min={1} />
          </Field>
          <Field label="Бригада план, чел." help="напр.: 15">
            <NumberInput value={form.crew_size_planned} onChange={(v) => set('crew_size_planned', v)} min={1} />
          </Field>
          <Field label="Бригада ФАКТ, чел." help="напр.: 21">
            <NumberInput value={form.crew_size_actual} onChange={(v) => set('crew_size_actual', v)} min={1} />
          </Field>
        </div>

        {/* Состав и режим работ */}
        <Field label="Состав бригады (JSON)" help='Напр.: {"ИТР":1,"мастер":2,"слесарь":18}'>
          <TextareaInput
            value={form.crew_composition_actual}
            onChange={(v) => set('crew_composition_actual', v)}
            minRows={2} maxRows={5}
            placeholder='{"ИТР":1,"мастер":2,"слесарь":18}'
          />
        </Field>
        <Field label="Режим работ" help="напр.: круглосуточно 2 смены, 6/1">
          <TextInput value={form.work_regime} onChange={(v) => set('work_regime', v)} placeholder="круглосуточно 2 смены, 6/1" />
        </Field>

        {/* Resources JSON (опц.) */}
        <Field
          label="Ресурсы факт (JSON)"
          help='См. эталон КАО Азот для образца. Например: {"labor":{...},"materials":[...],"travel_costs_rub":{...}}'
        >
          <TextareaInput
            value={form.resources_actual}
            onChange={(v) => set('resources_actual', v)}
            minRows={3} maxRows={8}
            placeholder='{"labor":{...},"materials":[...],"travel_costs_rub":{...}}'
          />
        </Field>

        {/* Variance JSON */}
        <Field
          label="Отклонения (план vs факт, JSON)"
          help='Напр.: {"cost_pct":92,"duration_pct":26,"root_causes":["..."]}'
        >
          <TextareaInput
            value={form.variance}
            onChange={(v) => set('variance', v)}
            minRows={2} maxRows={6}
            placeholder='{"cost_pct":92,"duration_pct":26,"root_causes":["..."]}'
          />
        </Field>

        {/* Insights JSON (required) */}
        <Field
          label="Инсайты — уроки и стратегия (JSON)"
          required
          help='Напр.: {"lessons_learned":["..."],"what_to_check_before_bid":["..."],"pricing_strategy_for_similar":["..."]}'
        >
          <TextareaInput
            value={form.insights}
            onChange={(v) => set('insights', v)}
            minRows={3} maxRows={8}
            placeholder='{"lessons_learned":["погода ограничила работу на 5 дней"],"what_to_check_before_bid":["..."],"pricing_strategy_for_similar":["..."]}'
          />
        </Field>

        {/* Примечание */}
        <Field label="Примечание">
          <TextareaInput
            value={form.notes}
            onChange={(v) => set('notes', v)}
            minRows={2} maxRows={4}
          />
        </Field>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={save}>
          {busy ? 'Сохраняем…' : '📊 Сохранить эталон'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
