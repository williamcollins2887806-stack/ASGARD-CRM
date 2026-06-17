/**
 * BulkPerDiemModal — массовое начисление суточных бригаде.
 *
 * Источник vanilla: field-tab.js openBulkPerDiemModal (~80 строк, строки 3282-3360).
 *
 * Бэк: POST /api/worker-payments/bulk-per-diem
 *   body { work_id, employee_ids: [], period_from, period_to, rate_per_day, payment_method?, comment? }
 *   создаёт worker_payments(type='per_diem', status='pending') по строке на каждого выбранного сотрудника.
 */
import { useEffect, useState } from 'react';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { MoneyInput, DatePicker, TextInput, Checkbox } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { useModal } from '@/modals';
import { loadCrew, bulkPerDiem } from '../../api';

function todayISO() { return new Date().toISOString().slice(0, 10); }

export function BulkPerDiemModal({ work, onSaved }) {
  const { close } = useModal();
  const [crew, setCrew] = useState([]);
  const [selected, setSelected] = useState({}); // empId → bool
  const [periodFrom, setPeriodFrom] = useState(todayISO());
  const [periodTo, setPeriodTo] = useState(todayISO());
  const [rate, setRate] = useState('1000');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    loadCrew(work.id).then((list) => {
      setCrew(list);
      // По умолчанию вся бригада выбрана (vanilla parity).
      const sel = {};
      for (const c of list) {
        const id = c.employee_id || c.id;
        if (id) sel[id] = true;
      }
      setSelected(sel);
    });
  }, [work.id]);

  const days = (() => {
    if (!periodFrom || !periodTo) return 0;
    const a = new Date(periodFrom).getTime();
    const b = new Date(periodTo).getTime();
    if (!isFinite(a) || !isFinite(b) || b < a) return 0;
    return Math.round((b - a) / 86400000) + 1;
  })();

  const rateNum = Number(rate) || 0;
  const selectedIds = Object.entries(selected).filter(([, v]) => v).map(([k]) => Number(k));
  const totalPerWorker = days * rateNum;
  const totalAll = totalPerWorker * selectedIds.length;

  const toggleAll = (val) => {
    const sel = {};
    for (const c of crew) {
      const id = c.employee_id || c.id;
      if (id) sel[id] = val;
    }
    setSelected(sel);
  };

  const submit = async () => {
    setErr('');
    if (selectedIds.length === 0) { setErr('Выберите хотя бы одного сотрудника'); return; }
    if (!periodFrom || !periodTo) { setErr('Укажите период'); return; }
    if (days <= 0) { setErr('Дата «по» не может быть раньше «с»'); return; }
    if (rateNum <= 0) { setErr('Ставка должна быть больше 0'); return; }

    setBusy(true);
    try {
      const r = await bulkPerDiem({
        work_id: Number(work.id),
        employee_ids: selectedIds,
        period_from: periodFrom,
        period_to: periodTo,
        rate_per_day: rateNum,
        comment: comment.trim() || null
      });
      toast('Суточные начислены', `${r.count || selectedIds.length} чел. × ${days} дн.`, 'ok');
      onSaved?.();
      close();
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <MCard>
      <MHead icon="🍱" title="Массовые суточные" subtitle={work.work_title || `Работа #${work.id}`} accent="gold" onClose={close} />
      <MBody>
        {err && <div className="ft-pw-err" style={{ marginBottom: 10 }}>⚠ {err}</div>}

        <Field label={`Сотрудники бригады (${selectedIds.length} из ${crew.length})`} required>
          <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <Btn size="sm" variant="ghost" onClick={() => toggleAll(true)}>Выбрать всех</Btn>
            <Btn size="sm" variant="ghost" onClick={() => toggleAll(false)}>Снять выбор</Btn>
          </div>
          <div className="ft-pay-employee-list">
            {crew.length === 0 && <div className="muted">В бригаде нет сотрудников</div>}
            {crew.map((c) => {
              const id = c.employee_id || c.id;
              const name = c.employee_name || c.name || `#${id}`;
              const role = c.role_in_field || c.field_role || '';
              return (
                <div key={id} className="ft-pay-employee-row">
                  <Checkbox
                    checked={!!selected[id]}
                    onChange={(v) => setSelected((s) => ({ ...s, [id]: v }))}
                    label={name}
                  />
                  {role && <span className="ft-pay-employee-sub">{role}</span>}
                </div>
              );
            })}
          </div>
        </Field>

        <div className="ft-pay-modal-grid-3" style={{ marginTop: 10 }}>
          <Field label="Период с" required>
            <DatePicker value={periodFrom} onChange={setPeriodFrom} />
          </Field>
          <Field label="по" required>
            <DatePicker value={periodTo} onChange={setPeriodTo} />
          </Field>
          <Field label="Ставка, ₽/день" required>
            <MoneyInput value={rate} onChange={setRate} />
          </Field>
        </div>

        <Field label="Комментарий">
          <TextInput value={comment} onChange={setComment} placeholder="Например: «Суточные за майскую вахту»" />
        </Field>

        <div className="ft-pw-preview" style={{ marginTop: 10 }}>
          <div className="ft-pw-preview-ttl">📊 Расчёт</div>
          <div className="ft-pw-preview-row">
            <span>На одного сотрудника</span>
            <strong>{new Intl.NumberFormat('ru-RU').format(totalPerWorker)} ₽</strong>
          </div>
          <div className="ft-pw-preview-row">
            <span>Всего ({selectedIds.length} чел. × {days} дн.)</span>
            <strong>{new Intl.NumberFormat('ru-RU').format(totalAll)} ₽</strong>
          </div>
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={submit}>
          {busy ? 'Начисляем…' : `Начислить ${selectedIds.length || ''}`}
        </Btn>
      </MFoot>
    </MCard>
  );
}
