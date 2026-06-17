/**
 * QuickCalcModal — быстрый ручной просчёт (без AI).
 * Источник: openQuickCalcForm в pm_calcs.js.
 * Сохраняет тендер + базовую оценку (estimate) одним вызовом.
 */
import { useState, useMemo } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { Field, TextInput, NumberInput, MoneyInput, SelectInput, TextareaInput, INNInput, Checkbox } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { useAuth } from '@/api/useAuth';
import { api } from '@/api/client';
import { calcMargin, calcProfitPerManDay, fmtMoney } from '../api';

const PROBABILITY_OPTIONS = [
  { value: '25',  label: '25% — низкая' },
  { value: '50',  label: '50% — средняя' },
  { value: '75',  label: '75% — высокая' },
  { value: '90',  label: '90% — почти точно' }
];

export function QuickCalcModal({ onCreated }) {
  const { close } = useModal();
  const { user } = useAuth();
  // RBAC: создание просчёта (vanilla pm_calcs.js:1274, 1240)
  // Только PM/HEAD_PM/ADMIN могут создавать просчёт. Директора смотрят/согласовывают.
  const canCreate = ['PM', 'HEAD_PM', 'ADMIN'].includes(user?.role);
  const [form, setForm] = useState({
    customer_name: '',
    inn: '',
    tender_name: '',
    city: '',
    distance_km: '',
    people: '',
    days: '',
    price: '',
    cost: '',
    probability: '50',
    note: '',
    requires_payment: false
  });
  const [busy, setBusy] = useState(false);

  const margin = useMemo(() => calcMargin(form.price, form.cost), [form.price, form.cost]);
  const profitPerMD = useMemo(() => calcProfitPerManDay(form.price, form.cost, form.people, form.days), [form.price, form.cost, form.people, form.days]);
  const profit = (Number(form.price) || 0) - (Number(form.cost) || 0);

  const marginTone = margin == null ? 'default' : margin < 5 ? 'rejected' : margin < 15 ? 'question' : 'approved';
  const zoneLabel = margin == null ? '—' : margin < 0 ? '🔴 Убыток' : margin < 5 ? '🟠 Опасно' : margin < 15 ? '🟡 Средне' : margin < 25 ? '🟢 Хорошо' : '⭐ Отлично';

  const save = async () => {
    if (!canCreate) return toast('Права', 'Создать просчёт может только РП / руководитель РП / админ', 'err');
    if (!form.customer_name?.trim()) return toast('Заказчик', 'Укажи заказчика', 'warn');
    if (!form.price || Number(form.price) <= 0) return toast('Цена', 'Укажи цену тендера', 'warn');
    setBusy(true);
    try {
      // 1) создаём тендер
      const tenderCreated = await api('/api/tenders', {
        method: 'POST',
        body: {
          customer_name: form.customer_name,
          inn: form.inn || null,
          tender_name: form.tender_name || null,
          tender_type: 'commercial',
          tender_price: Number(form.price),
          tender_status: 'Отправлено на просчёт',
          tag: form.city || null,
          comment: form.note || null
        }
      });
      const tenderId = tenderCreated?.tender?.id || tenderCreated?.id;
      if (!tenderId) throw new Error('Не пришёл id тендера');

      // 2) создаём первую оценку (estimate) — это быстрый расчёт
      // requires_payment (см. vanilla pm_calcs.js:343) — управляет переходом сметы в бухгалтерию после согласования директором.
      await api('/api/estimates', {
        method: 'POST',
        body: {
          tender_id: tenderId,
          version_no: 1,
          price: Number(form.price),
          cost: Number(form.cost) || 0,
          people: Number(form.people) || null,
          days: Number(form.days) || null,
          distance_km: Number(form.distance_km) || null,
          probability: Number(form.probability) || 50,
          margin_pct: Number.isFinite(margin) ? margin : null,
          profit: profit,
          note: form.note || null,
          approval_status: 'draft',
          requires_payment: !!form.requires_payment
        }
      });

      toast('💾 Создано', `Тендер #${tenderId} + черновик оценки`, 'ok');
      onCreated?.(tenderId);
      window.dispatchEvent(new CustomEvent('asgard:pmcalcs:changed'));
      close();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-lg">
      <MHead icon="🧮" title="Быстрый просчёт" subtitle="Ручной расчёт без AI — для оценки на лету" accent="gold" onClose={close} />
      <MBody>
        <div className="grid-2 gap-16">
          {/* Левая колонка: входные данные */}
          <div className="col gap-10">
            <strong className="section-eyebrow">Заказчик и работа</strong>

            <Field label="Заказчик" required>
              <TextInput value={form.customer_name} onChange={(v) => setForm({ ...form, customer_name: v })} placeholder="ООО «Ромашка»" />
            </Field>
            <Field label="ИНН">
              <INNInput value={form.inn} onChange={(v) => setForm({ ...form, inn: v })} />
            </Field>
            <Field label="Название тендера/работы">
              <TextInput value={form.tender_name} onChange={(v) => setForm({ ...form, tender_name: v })} />
            </Field>

            <div className="grid-2 gap-8">
              <Field label="Город">
                <TextInput value={form.city} onChange={(v) => setForm({ ...form, city: v })} />
              </Field>
              <Field label="Дистанция, км">
                <NumberInput value={form.distance_km} onChange={(v) => setForm({ ...form, distance_km: v })} min={0} />
              </Field>
            </div>

            <strong className="section-eyebrow mt-6">Ресурсы</strong>

            <div className="grid-2 gap-8">
              <Field label="Человек">
                <NumberInput value={form.people} onChange={(v) => setForm({ ...form, people: v })} min={1} />
              </Field>
              <Field label="Дней">
                <NumberInput value={form.days} onChange={(v) => setForm({ ...form, days: v })} min={1} />
              </Field>
            </div>

            <Field label="Вероятность победы">
              <SelectInput value={form.probability} onChange={(v) => setForm({ ...form, probability: v })} options={PROBABILITY_OPTIONS} />
            </Field>

            <Field label="Заметка">
              <TextareaInput value={form.note} onChange={(v) => setForm({ ...form, note: v })} minRows={2} maxRows={4} />
            </Field>

            {/* requires_payment — паритет с vanilla (pm_calcs.js:206) */}
            <Field label="" help="Если включено — после согласования директора смета уйдёт в бухгалтерию">
              <Checkbox
                checked={form.requires_payment}
                onChange={(v) => setForm({ ...form, requires_payment: v })}
                label="Требуется оплата / участие бухгалтерии"
              />
            </Field>
          </div>

          {/* Правая колонка: цены + KPI */}
          <div className="col gap-10">
            <strong className="section-eyebrow">Финансы</strong>

            <Field label="Цена тендера" required>
              <MoneyInput value={form.price} onChange={(v) => setForm({ ...form, price: v })} />
            </Field>
            <Field label="Себестоимость">
              <MoneyInput value={form.cost} onChange={(v) => setForm({ ...form, cost: v })} />
            </Field>

            {/* KPI блок */}
            <div className="kpi-box">
              <div className="kpi-box-title">
                Зона прибыльности
              </div>

              <div className="grid-2 gap-10">
                <KPI label="Маржа" value={margin == null ? '—' : margin.toFixed(1) + '%'} tone={marginTone} />
                <KPI label="Прибыль" value={fmtMoney(profit)} tone={profit > 0 ? 'approved' : profit < 0 ? 'rejected' : 'default'} />
                <KPI label="Прибыль / чел-день" value={profitPerMD == null ? '—' : fmtMoney(profitPerMD)} tone={profitPerMD > 5000 ? 'approved' : profitPerMD > 0 ? 'question' : 'rejected'} />
                <KPI label="Зона" value={zoneLabel} tone={marginTone} />
              </div>

              {margin != null && margin < 5 && (
                <div className="kpi-warn-err">
                  ⚠ Маржа &lt; 5% — высокий риск ухода в минус при любом перерасходе
                </div>
              )}
              {margin != null && margin >= 15 && (
                <div className="kpi-warn-ok">
                  ✓ Хорошая зона — есть запас на отклонения
                </div>
              )}
            </div>
          </div>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn
          variant="primary"
          disabled={busy || !canCreate}
          title={!canCreate ? 'Создание просчёта доступно только PM / HEAD_PM / ADMIN' : ''}
          onClick={save}
        >
          {busy ? 'Сохраняем…' : '💾 Создать тендер + оценку'}
        </Btn>
      </MFoot>
    </MCard>
  );
}

function KPI({ label, value, tone }) {
  const color = {
    approved: 'var(--ok)',
    rejected: 'var(--err)',
    question: 'var(--amber)',
    default:  'var(--t-1)'
  }[tone] || 'var(--t-1)';
  return (
    <div>
      <div className="kpi-mini-label">{label}</div>
      <div className="kpi-mini-value" style={{ color }}>{value}</div>
    </div>
  );
}
