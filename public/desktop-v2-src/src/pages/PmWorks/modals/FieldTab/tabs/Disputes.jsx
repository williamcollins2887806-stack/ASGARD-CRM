/**
 * Disputes — разногласия рабочих по сменам/тарифам/бонусам.
 * Полный CRUD: список, «Взять в работу» (take), «Разрешить» (resolve с компенсацией).
 * Бэк: GET /api/pm/disputes, POST /api/pm/disputes/:id/take, /resolve
 */
import { useEffect, useState } from 'react';
import { Btn } from '@/modals/parts';
import { EmptyState } from '@/blocks/Blocks';
import { StatusBadge, toast } from '@/modals/Notifications';
import { Field, TextareaInput, SelectInput, NumberInput, DatePicker } from '@/inputs/Inputs';
import { loadDisputes, takeDispute, resolveDispute } from '../api';
import { DISPUTE_TYPE_LABELS } from '../constants';

function fmtDateTime(s) {
  if (!s) return '';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleString('ru-RU') : '';
}

/**
 * D-3 FIX (2026-06-14): vanilla-parity (field-tab.js:1879-1973).
 *   Backend ждёт {resolution: 'add_shift'|'reject', pm_response, checkin_data?}.
 *   Раньше React слал {verdict, compensation, comment} → бэк отвечал 400.
 *   verdict «compensate» = vanilla `add_shift` (создать смену), «reject» = reject.
 *   «partial» в backend НЕ поддержан → удалён из UI.
 *   checkin_data (date/shift/hours_worked/hours_paid/day_rate/amount_earned) обязателен для add_shift.
 */
export default function DisputesTab({ work }) {
  const [list, setList] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [resolveForm, setResolveForm] = useState({
    resolution: 'add_shift',
    pm_response: '',
    date: '',
    shift: 'day',
    hours_worked: 8,
    day_rate: 0,
    amount_earned: 0
  });
  const [busy, setBusy] = useState(false);

  const reload = () => loadDisputes(work.id).then(setList);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [work.id]);

  const onTake = async (id) => {
    try {
      await takeDispute(id);
      toast('В работе', 'Спор взят в работу', 'ok');
      reload();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    }
  };

  const startResolve = (d) => {
    setEditingId(d.id);
    setResolveForm({
      resolution: 'add_shift',
      pm_response: '',
      date: (d.dispute_date || '').slice(0, 10) || new Date().toISOString().slice(0, 10),
      shift: 'day',
      hours_worked: 8,
      day_rate: 0,
      amount_earned: 0
    });
  };

  const submitResolve = async () => {
    if (!editingId) return;
    if (!resolveForm.pm_response?.trim() || resolveForm.pm_response.trim().length < 5) {
      return toast('Комментарий', 'Напиши ответ рабочему (минимум 5 символов)', 'warn');
    }
    if (resolveForm.resolution === 'add_shift') {
      if (!resolveForm.date) return toast('Дата', 'Укажи дату смены', 'warn');
    }
    setBusy(true);
    try {
      const payload = {
        resolution: resolveForm.resolution,
        pm_response: resolveForm.pm_response.trim()
      };
      if (resolveForm.resolution === 'add_shift') {
        const hours = Number(resolveForm.hours_worked) || 8;
        const rate = Number(resolveForm.day_rate) || 0;
        const amount = Number(resolveForm.amount_earned) || 0;
        payload.checkin_data = {
          date: resolveForm.date,
          shift: resolveForm.shift || 'day',
          hours_worked: hours,
          hours_paid: hours,
          day_rate: rate,
          amount_earned: amount > 0 ? amount : Math.round(hours * rate)
        };
      }
      const r = await resolveDispute(editingId, payload);
      toast('Готово', resolveForm.resolution === 'add_shift'
        ? (r?.created_checkin_id ? `Смена создана (id=${r.created_checkin_id})` : 'Решено')
        : 'Спор отклонён', 'ok');
      setEditingId(null);
      reload();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ft-stack-10">
      <div>
        <strong className="ft-toolbar-title">Разногласия от рабочих</strong>
        <div className="ft-toolbar-sub">Рабочие подают споры через Field PWA — здесь ты их разрешаешь.</div>
      </div>

      {list === null && <div className="muted">⏳ Загружаем…</div>}

      {list && list.length === 0 && (
        <EmptyState icon="✅" title="Разногласий нет" hint="Никто не подавал жалоб по этой работе" />
      )}

      {list && list.length > 0 && (
        <div className="ft-stack-8">
          {list.map((d) => {
            const isOpen = d.status === 'open' || d.status === 'new';
            const isTaken = d.status === 'in_progress' || d.status === 'taken';
            const isResolved = d.status === 'resolved' || d.status === 'closed';
            const cardCls = ['ft-disp-card'];
            if (isResolved) cardCls.push('ft-disp-card--done');
            else if (isTaken) cardCls.push('ft-disp-card--in');
            return (
              <div key={d.id} className={cardCls.join(' ')}>
                <div className="ft-disp-head">
                  <div className="ft-disp-head-main">
                    <div className="ft-disp-title-row">
                      <strong>{d.employee_name || `#${d.employee_id}`}</strong>
                      <StatusBadge tone={isResolved ? 'approved' : isTaken ? 'sent' : 'rejected'} label={d.status} />
                    </div>
                    <div className="ft-disp-desc">
                      <strong>{DISPUTE_TYPE_LABELS[d.dispute_type] || d.dispute_type}:</strong>{' '}
                      {d.message || d.description || '—'}
                    </div>
                    {d.created_at && <div className="ft-disp-time">{fmtDateTime(d.created_at)}</div>}
                    {d.resolution_comment && (
                      <div className="ft-disp-resolution">
                        <strong>Решение:</strong> {d.resolution_comment}
                        {d.compensation > 0 && <> · компенсация {Number(d.compensation).toLocaleString('ru-RU')} ₽</>}
                      </div>
                    )}
                  </div>
                  <div className="ft-disp-actions">
                    {isOpen && <Btn size="sm" onClick={() => onTake(d.id)}>В работу</Btn>}
                    {(isOpen || isTaken) && <Btn size="sm" variant="primary" onClick={() => startResolve(d)}>Разрешить</Btn>}
                  </div>
                </div>

                {editingId === d.id && (
                  <div className="ft-disp-edit">
                    <Field label="Решение">
                      <SelectInput value={resolveForm.resolution} onChange={(v) => setResolveForm({ ...resolveForm, resolution: v })} options={[
                        { value: 'add_shift', label: '✅ Подтвердить и создать смену' },
                        { value: 'reject',    label: '❌ Отклонить' }
                      ]} />
                    </Field>
                    {resolveForm.resolution === 'add_shift' && (
                      <>
                        <div className="ft-row-grid-2">
                          <Field label="Дата смены" required>
                            <DatePicker value={resolveForm.date} onChange={(v) => setResolveForm({ ...resolveForm, date: v })} />
                          </Field>
                          <Field label="Смена">
                            <SelectInput value={resolveForm.shift} onChange={(v) => setResolveForm({ ...resolveForm, shift: v })} options={[
                              { value: 'day', label: 'День' },
                              { value: 'night', label: 'Ночь' }
                            ]} />
                          </Field>
                        </div>
                        <div className="ft-row-grid-2">
                          <Field label="Часов отработано">
                            <NumberInput value={resolveForm.hours_worked} onChange={(v) => setResolveForm({ ...resolveForm, hours_worked: v })} min={0} step={0.5} />
                          </Field>
                          <Field label="Ставка ₽/смена">
                            <NumberInput value={resolveForm.day_rate} onChange={(v) => setResolveForm({ ...resolveForm, day_rate: v })} min={0} />
                          </Field>
                        </div>
                        <Field label="Сумма к начислению (если 0 — рассчитается как часы × ставка)">
                          <NumberInput value={resolveForm.amount_earned} onChange={(v) => setResolveForm({ ...resolveForm, amount_earned: v })} min={0} />
                        </Field>
                      </>
                    )}
                    <Field label={resolveForm.resolution === 'add_shift' ? 'Комментарий рабочему' : 'Причина отклонения'} required>
                      <TextareaInput value={resolveForm.pm_response} onChange={(v) => setResolveForm({ ...resolveForm, pm_response: v })} minRows={2} maxRows={5} placeholder={resolveForm.resolution === 'add_shift' ? 'Например: добавил смену 12 апреля, оплачено 4500₽' : 'Например: 12 апреля по графику был выходной'} />
                    </Field>
                    <div className="ft-disp-edit-actions">
                      <Btn size="sm" onClick={() => setEditingId(null)}>Отмена</Btn>
                      <Btn size="sm" variant="primary" disabled={busy} onClick={submitResolve}>{busy ? 'Сохраняем…' : 'Подтвердить'}</Btn>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
