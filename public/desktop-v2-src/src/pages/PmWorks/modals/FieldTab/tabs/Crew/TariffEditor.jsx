/**
 * TariffEditor — inline-редактор тарифа в строке бригады.
 *
 * Источник vanilla: field-tab.js:613-664 (selTariffEl + selComboEl + updatePointsRate).
 * Что делает:
 *   • два <SelectInput>: тариф (основной) + совмещение (CR/Combination)
 *   • опц. поле «суточные ₽/день»
 *   • живой авто-recalc: баллы + ₽/смена (base + combo)
 *   • PUT-эндпоинт: переиспользуем POST /projects/:work_id/crew (бэк upsert'ит).
 *
 * Бэк-структура field_tariff_grid (field-manage.js:119):
 *   { id, position_name, points, rate_per_shift, category, is_combinable }
 */
import { useEffect, useMemo, useState } from 'react';
import { Btn } from '@/modals/parts';
import { Field, SelectInput, MoneyInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { updateCrewMemberTariff } from '../../api';

function fmtMoney(n) {
  if (!Number.isFinite(+n)) return '—';
  return new Intl.NumberFormat('ru-RU').format(Math.round(+n)) + ' ₽';
}

export default function TariffEditor({
  member,
  tariffs,
  comboTariffs,
  workId,
  onSaved,
  onCancel
}) {
  const [tariffId, setTariffId] = useState(member?.tariff_id ? String(member.tariff_id) : '');
  const [comboId, setComboId] = useState(member?.combination_tariff_id ? String(member.combination_tariff_id) : '');
  const [perDiem, setPerDiem] = useState(member?.per_diem != null ? String(member.per_diem) : '');
  const [shiftType, setShiftType] = useState(member?.shift_type || 'day');
  const [busy, setBusy] = useState(false);

  // Live recalc (vanilla updatePointsRate, field-tab.js:817-841)
  const calc = useMemo(() => {
    const t = tariffs.find((x) => String(x.id) === String(tariffId));
    const c = comboTariffs.find((x) => String(x.id) === String(comboId));
    const basePoints = t ? (Number(t.points) || 0) : 0;
    const comboPoints = c ? (Number(c.points) || 1) : 0;
    const baseRate = t ? (Number(t.rate_per_shift) || 0) : 0;
    const comboRate = c ? (Number(c.rate_per_shift) || 0) : 0;
    return {
      tariff: t,
      combo: c,
      totalPoints: basePoints + (c ? comboPoints : 0),
      totalRate: baseRate + comboRate,
      requiresApproval: !!(c && c.requires_approval)
    };
  }, [tariffId, comboId, tariffs, comboTariffs]);

  const tariffOptions = useMemo(() => [
    { value: '', label: '— выберите тариф —' },
    ...tariffs.map((t) => ({
      value: String(t.id),
      label: `${t.position_name || t.label || t.name} · ${t.points || 0}б · ${fmtMoney(t.rate_per_shift)}/смена`
    }))
  ], [tariffs]);

  const comboOptions = useMemo(() => [
    { value: '', label: 'Нет (без совмещения)' },
    ...comboTariffs
      .filter((t) => t.is_combinable)
      .map((t) => ({
        value: String(t.id),
        label: `${t.position_name || t.label || t.name} (+${t.points || 1}б · +${fmtMoney(t.rate_per_shift)})`
      }))
  ], [comboTariffs]);

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
        combination_tariff_id: comboId ? Number(comboId) : null,
        per_diem: perDiem !== '' && perDiem != null ? Number(perDiem) : null
      });
      // Backend возвращает { results, count }. Берём count>0 → ok.
      if (r?.count === 0 && Array.isArray(r?.results) && r.results[0]?.error) {
        throw new Error(r.results[0].error);
      }
      toast('Тариф', 'Сохранено', 'ok');
      if (onSaved) {
        onSaved({
          tariff_id: tariffId ? Number(tariffId) : null,
          combination_tariff_id: comboId ? Number(comboId) : null,
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

  // ESC = отмена (UX-приятность для inline-редактирования)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && onCancel && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, busy]);

  return (
    <div className="ft-tariff-editor">
      <div className="ft-tariff-editor__head">
        <strong>{member?.employee_name || member?.name || `#${member?.employee_id}`}</strong>
        <span className="ft-tariff-editor__hint">тарификация в строке</span>
      </div>

      <div className="ft-row-grid-2">
        <Field label="Тариф (основной)">
          <SelectInput value={tariffId} onChange={setTariffId} options={tariffOptions} />
        </Field>
        <Field label="Совмещение">
          <SelectInput value={comboId} onChange={setComboId} options={comboOptions} />
        </Field>
      </div>

      <div className="ft-row-grid-2">
        <Field label="Смена">
          <SelectInput value={shiftType} onChange={setShiftType} options={shiftOptions} />
        </Field>
        <Field label="Суточные / день">
          <MoneyInput value={perDiem} onChange={setPerDiem} />
        </Field>
      </div>

      <div className="ft-tariff-editor__calc">
        <div>
          <span className="ft-tariff-editor__calc-l">Баллы:</span>
          <strong>{calc.totalPoints || '—'}</strong>
        </div>
        <div>
          <span className="ft-tariff-editor__calc-l">₽/смена:</span>
          <strong className="c-gold">{calc.totalRate ? fmtMoney(calc.totalRate) : '—'}</strong>
        </div>
        {calc.requiresApproval && (
          <div className="ft-tariff-editor__warn">⚠ Совмещение требует согласования</div>
        )}
      </div>

      <div className="ft-row-r">
        <Btn onClick={onCancel} disabled={busy}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={onSave}>
          {busy ? 'Сохраняем…' : 'Сохранить тариф'}
        </Btn>
      </div>
    </div>
  );
}
