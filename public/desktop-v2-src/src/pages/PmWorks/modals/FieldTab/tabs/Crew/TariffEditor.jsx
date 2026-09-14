/**
 * TariffEditor — ставка в бригаде: база (чтение/выбор) + доплаты галочками/вручную.
 *
 * База — тариф из сетки / role_base_rates.
 * Доплата — combo_tariff_ids[] (галочки) + manual_extra_points (дробные 3.5).
 * Итог = база + сумма галочек + ручная.
 */
import { useEffect, useMemo, useState } from 'react';
import { Btn } from '@/modals/parts';
import { Field, SelectInput, MoneyInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { updateCrewMemberTariff } from '../../api';
import { formatMoney as fmtMoney } from '@/lib/money';

const POINT_VALUE = 500;

function parseComboIds(member) {
  if (Array.isArray(member?.combo_tariff_ids) && member.combo_tariff_ids.length) {
    return member.combo_tariff_ids.map(String);
  }
  if (member?.combination_tariff_id) return [String(member.combination_tariff_id)];
  return [];
}

/** Предпочитаем раздельные presets; старые «Совмещение: A/B/C» тоже показываем. */
function comboLabel(t) {
  const name = t.position_name || t.label || t.name || 'Совмещение';
  const pts = Number(t.points) || 1;
  return `${name} (+${pts}б)`;
}

export default function TariffEditor({
  member,
  tariffs,
  comboTariffs,
  workId,
  keepInactive = false,
  /** Если true — база только для чтения (окно назначения из пресета). */
  baseReadOnly = false,
  onSaved,
  onCancel
}) {
  const [tariffId, setTariffId] = useState(member?.tariff_id ? String(member.tariff_id) : '');
  const [comboIds, setComboIds] = useState(() => parseComboIds(member));
  const [manualExtra, setManualExtra] = useState(
    member?.manual_extra_points != null && member.manual_extra_points !== ''
      ? String(member.manual_extra_points)
      : ''
  );
  const [perDiem, setPerDiem] = useState(member?.per_diem != null ? String(member.per_diem) : '');
  const [shiftType, setShiftType] = useState(member?.shift_type || 'day');
  const [busy, setBusy] = useState(false);

  const calc = useMemo(() => {
    const t = tariffs.find((x) => String(x.id) === String(tariffId));
    const basePoints = t ? (Number(t.points) || 0) : 0;
    const baseRate = t ? (Number(t.rate_per_shift) || 0) : 0;
    const pv = t?.point_value != null ? Number(t.point_value) : POINT_VALUE;

    let comboPoints = 0;
    let comboRate = 0;
    const selected = [];
    for (const id of comboIds) {
      const c = comboTariffs.find((x) => String(x.id) === String(id));
      if (!c) continue;
      selected.push(c);
      comboPoints += Number(c.points) || 0;
      comboRate += Number(c.rate_per_shift) || 0;
    }

    let manual = Number(String(manualExtra).replace(',', '.'));
    if (!Number.isFinite(manual) || manual < 0) manual = 0;
    manual = Math.round(manual * 100) / 100;

    return {
      tariff: t,
      selected,
      basePoints,
      baseRate,
      comboPoints,
      comboRate,
      manualPoints: manual,
      manualRate: manual * pv,
      totalPoints: basePoints + comboPoints + manual,
      totalRate: baseRate + comboRate + manual * pv,
      requiresApproval: selected.some((c) => c.requires_approval)
    };
  }, [tariffId, comboIds, manualExtra, tariffs, comboTariffs]);

  const tariffOptions = useMemo(() => {
    const opts = [
      { value: '', label: '— выберите тариф —' },
      ...tariffs.map((t) => ({
        value: String(t.id),
        label: `${t.position_name || t.label || t.name} · ${t.points || 0}б · ${fmtMoney(t.rate_per_shift)}/смена`
      }))
    ];
    if (tariffId && !opts.some((o) => o.value === String(tariffId))) {
      const orphan = tariffs.find((t) => String(t.id) === String(tariffId))
        || (member?.tariff_id && String(member.tariff_id) === String(tariffId)
          ? {
              id: tariffId,
              position_name: member.position_name || `тариф #${tariffId}`,
              points: member.tariff_points,
              rate_per_shift: member.rate_per_shift
            }
          : null);
      if (orphan) {
        opts.splice(1, 0, {
          value: String(orphan.id),
          label: `${orphan.position_name || orphan.label || orphan.name} · ${orphan.points || 0}б · ${fmtMoney(orphan.rate_per_shift)}/смена`
        });
      }
    }
    return opts;
  }, [tariffs, tariffId, member]);

  const comboList = useMemo(() => {
    const list = (comboTariffs || []).filter((t) => t.is_combinable);
    // Новые раздельные сверху, старые агрегированные ниже
    return list.slice().sort((a, b) => {
      const aNew = /^(Водитель|Электрик|Сварщик совмещение|Высокая нагрузка)/i.test(a.position_name || '') ? 0 : 1;
      const bNew = /^(Водитель|Электрик|Сварщик совмещение|Высокая нагрузка)/i.test(b.position_name || '') ? 0 : 1;
      if (aNew !== bNew) return aNew - bNew;
      return (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0);
    });
  }, [comboTariffs]);

  const toggleCombo = (id) => {
    const sid = String(id);
    setComboIds((prev) => (
      prev.includes(sid) ? prev.filter((x) => x !== sid) : [...prev, sid]
    ));
  };

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
      const ids = comboIds.map(Number).filter((n) => n > 0);
      const r = await updateCrewMemberTariff(workId, {
        employee_id: member.employee_id,
        field_role: member.field_role || member.role_in_field || 'worker',
        shift_type: shiftType,
        tariff_id: tariffId ? Number(tariffId) : null,
        combination_tariff_id: ids[0] || null,
        combo_tariff_ids: ids,
        manual_extra_points: calc.manualPoints,
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
          combination_tariff_id: ids[0] || null,
          combo_tariff_ids: ids,
          manual_extra_points: calc.manualPoints,
          per_diem: perDiem !== '' && perDiem != null ? Number(perDiem) : null,
          shift_type: shiftType,
          tariff_points: calc.totalPoints || null,
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
                {calc.basePoints}б · {fmtMoney(calc.baseRate)}/смена
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
          <p className="ft-assign-rate-hint">Только этому человеку. Галочки и/или ручные баллы (2 / 3 / 3.5…).</p>

          <Field label="Ручные баллы">
            <input
              className="m-input"
              type="number"
              min="0"
              step="0.5"
              placeholder="0"
              value={manualExtra}
              onChange={(e) => setManualExtra(e.target.value)}
            />
          </Field>

          <div className="ft-assign-rate-checks">
            {comboList.length === 0 ? (
              <div className="ft-assign-rate-hint">Нет совмещений в сетке для категории</div>
            ) : comboList.map((c) => {
              const id = String(c.id);
              const checked = comboIds.includes(id);
              return (
                <label key={id} className="ft-assign-rate-check">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleCombo(id)}
                  />
                  <span>{comboLabel(c)}</span>
                </label>
              );
            })}
          </div>
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
            {calc.basePoints}
            {calc.comboPoints || calc.manualPoints
              ? ` + ${calc.comboPoints + calc.manualPoints}`
              : ''}
            {' = '}
            {calc.totalPoints}б · {calc.totalRate ? fmtMoney(calc.totalRate) : '—'}
          </strong>
        </div>
        {calc.requiresApproval && (
          <div className="ft-tariff-editor__warn">⚠ Совмещение требует согласования</div>
        )}
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
