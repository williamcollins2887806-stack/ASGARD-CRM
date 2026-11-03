/**
 * TariffEditor — ставка в бригаде: база (тариф) + доплата в ₽.
 * С 01.11.2026: без галочек совмещения и без «ручных баллов».
 */
import { useEffect, useMemo, useState } from 'react';
import { Btn } from '@/modals/parts';
import { Field, SelectInput, MoneyInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { updateCrewMemberTariff } from '../../api';
import { formatMoney as fmtMoney } from '@/lib/money';
import { snapRubStep10 } from '@/lib/moneyCompact';

export default function TariffEditor({
  member,
  tariffs,
  comboTariffs: _comboTariffs,
  workId,
  keepInactive = false,
  /** Если true — база только для чтения (окно назначения из пресета). */
  baseReadOnly = false,
  onSaved,
  onCancel
}) {
  const [tariffId, setTariffId] = useState(member?.tariff_id ? String(member.tariff_id) : '');
  const initExtra = (() => {
    if (member?.manual_extra_rub != null && member.manual_extra_rub !== '') {
      return String(member.manual_extra_rub);
    }
    // Legacy: manual_extra_points × 500
    const pts = Number(member?.manual_extra_points);
    if (Number.isFinite(pts) && pts > 0) return String(snapRubStep10(pts * 500));
    return '';
  })();
  const [manualExtra, setManualExtra] = useState(initExtra);
  const [perDiem, setPerDiem] = useState(member?.per_diem != null ? String(member.per_diem) : '');
  const [shiftType, setShiftType] = useState(member?.shift_type || 'day');
  const [busy, setBusy] = useState(false);

  const calc = useMemo(() => {
    const t = tariffs.find((x) => String(x.id) === String(tariffId));
    const baseRate = t ? (Number(t.rate_per_shift) || 0) : 0;
    let manual = Number(String(manualExtra).replace(',', '.').replace(/\s/g, ''));
    if (!Number.isFinite(manual) || manual < 0) manual = 0;
    manual = snapRubStep10(manual);
    return {
      tariff: t,
      baseRate,
      manualExtra: manual,
      totalRate: baseRate + manual
    };
  }, [tariffId, manualExtra, tariffs]);

  const tariffOptions = useMemo(() => {
    const opts = [
      { value: '', label: '— выберите тариф —' },
      ...tariffs.map((t) => ({
        value: String(t.id),
        label: `${t.position_name || t.label || t.name} · ${fmtMoney(t.rate_per_shift)}/смена`
      }))
    ];
    if (tariffId && !opts.some((o) => o.value === String(tariffId))) {
      const orphan = tariffs.find((t) => String(t.id) === String(tariffId))
        || (member?.tariff_id && String(member.tariff_id) === String(tariffId)
          ? {
              id: tariffId,
              position_name: member.position_name || `тариф #${tariffId}`,
              rate_per_shift: member.day_rate_rub ?? member.rate_per_shift
            }
          : null);
      if (orphan) {
        opts.splice(1, 0, {
          value: String(orphan.id),
          label: `${orphan.position_name || orphan.label || orphan.name} · ${fmtMoney(orphan.rate_per_shift)}/смена`
        });
      }
    }
    return opts;
  }, [tariffs, tariffId, member]);

  const shiftOptions = [
    { value: 'day',   label: '☀ День' },
    { value: 'night', label: '🌙 Ночь' },
    { value: 'swing', label: '↻ Качающаяся' }
  ];

  const onSave = async () => {
    if (!member?.employee_id) {
      toast('Ошибка', 'Не определён employee_id', 'err');
      return;
    }
    setBusy(true);
    try {
      const r = await updateCrewMemberTariff(workId, {
        employee_id: member.employee_id,
        field_role: member.field_role || member.role_in_field || 'worker',
        shift_type: shiftType,
        tariff_id: tariffId ? Number(tariffId) : null,
        combination_tariff_id: null,
        combo_tariff_ids: [],
        manual_extra_rub: calc.manualExtra,
        // база без доплаты — иначе resolveAssignmentRates сложит дважды
        day_rate_rub: calc.baseRate,
        per_diem: perDiem !== '' && perDiem != null ? Number(perDiem) : null,
        keep_inactive: keepInactive || undefined
      });
      if (r?.count === 0 && Array.isArray(r?.results) && r.results[0]?.error) {
        throw new Error(r.results[0].error);
      }
      toast('Тариф', 'Сохранено', 'ok');
      if (onSaved) {
        onSaved({
          tariff_id: tariffId ? Number(tariffId) : null,
          combination_tariff_id: null,
          combo_tariff_ids: [],
          manual_extra_rub: calc.manualExtra,
          day_rate_rub: calc.baseRate,
          per_diem: perDiem !== '' && perDiem != null ? Number(perDiem) : null,
          shift_type: shiftType,
          rate: calc.totalRate
        });
      }
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && onCancel && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, busy]);

  return (
    <div className="ft-tariff-editor ft-assign-rate">
      <div className="ft-tariff-editor__head">
        <strong>{member?.employee_name || member?.name || `#${member?.employee_id}`}</strong>
        <span className="ft-tariff-editor__hint">ставка в бригаде</span>
      </div>

      <div className="ft-assign-rate-grid">
        <div className="ft-assign-rate-col ft-assign-rate-col--base">
          <div className="ft-assign-rate-col__title">База</div>
          <p className="ft-assign-rate-hint">Из базовых ставок объекта / сетки. Не путать с доплатой.</p>
          {baseReadOnly && calc.tariff ? (
            <div className="ft-assign-rate-base-ro">
              <div className="ft-assign-rate-base-ro__name">
                {calc.tariff.position_name || calc.tariff.name}
              </div>
              <div className="ft-assign-rate-base-ro__meta">
                {fmtMoney(calc.baseRate)}/смена
              </div>
            </div>
          ) : (
            <Field label="Тариф (основной)">
              <SelectInput value={tariffId} onChange={setTariffId} options={tariffOptions} />
            </Field>
          )}
        </div>

        <div className="ft-assign-rate-col ft-assign-rate-col--extra">
          <div className="ft-assign-rate-col__title">Доплата</div>
          <p className="ft-assign-rate-hint">Только этому человеку · шаг 10 ₽.</p>
          <Field label="Доплата ₽">
            <input
              className="m-input"
              type="number"
              min="0"
              step="10"
              placeholder="0"
              value={manualExtra}
              onChange={(e) => setManualExtra(e.target.value)}
              onBlur={() => {
                if (manualExtra === '') return;
                setManualExtra(String(snapRubStep10(manualExtra)));
              }}
            />
          </Field>
        </div>
      </div>

      <div className="ft-row-grid-2" style={{ marginTop: 10 }}>
        <Field label="Смена">
          <SelectInput value={shiftType} onChange={setShiftType} options={shiftOptions} />
        </Field>
        <Field label="Суточные / день">
          <MoneyInput value={perDiem} onChange={setPerDiem} />
        </Field>
      </div>

      <div className="ft-tariff-editor__calc ft-assign-rate-total">
        <div>
          <span className="ft-tariff-editor__calc-l">Итого:</span>
          <strong>
            {fmtMoney(calc.baseRate)}
            {calc.manualExtra ? ` + ${fmtMoney(calc.manualExtra)}` : ''}
            {' = '}
            {calc.totalRate ? fmtMoney(calc.totalRate) : '—'}
          </strong>
        </div>
      </div>

      <div className="ft-row-r">
        <Btn onClick={onCancel} disabled={busy}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={onSave}>
          {busy ? 'Сохраняем…' : 'Сохранить'}
        </Btn>
      </div>
    </div>
  );
}
