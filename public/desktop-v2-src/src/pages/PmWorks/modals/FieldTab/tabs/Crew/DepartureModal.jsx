/**
 * DepartureModal — оформление отъезда работника с фин-сводкой и чек-листом возврата.
 *
 * Источник vanilla: field-tab.js:3658-3818 (showDepartureModal, ~250 строк).
 * Что делает:
 *   1. GET /api/field/manage/projects/:work_id/departure-preview/:employee_id
 *      → { employee, assignment, days_on_site, finances }
 *   2. Показывает 4 фин-карточки: Главный баланс / Суточные / Заработок / Выплаты
 *   3. Чек-лист «возврат имущества» (берётся из позиций packing у работы)
 *   4. Дата + причина + select (плановый / больничный / увольнение / иное)
 *   5. POST /api/field/manage/projects/:work_id/departure/:employee_id
 *      → отмечает is_active=false + departure_date.
 *   6. Опц. галка «отправить SMS» → переиспользуем /send-invites одному.
 */
import { useEffect, useState } from 'react';
import { MCard, MHead, MBody, MFoot, Btn, Textarea } from '@/modals/parts';
import { Field, SelectInput, DatePicker, Checkbox } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import {
  loadDeparturePreview, departCrewMember, sendSingleInvite, loadPacking, loadPackingDetail
} from '../../api';

function fmtMoney(n) {
  if (!Number.isFinite(+n)) return '0 ₽';
  return new Intl.NumberFormat('ru-RU').format(Math.round(+n)) + ' ₽';
}

const DEPARTURE_REASONS = [
  { value: 'planned',       label: 'Плановый отъезд (вахта закончилась)' },
  { value: 'sick',          label: 'Больничный / медотвод' },
  { value: 'dismissal',     label: 'Увольнение' },
  { value: 'family',        label: 'По семейным обстоятельствам' },
  { value: 'punishment',    label: 'Снят с объекта (дисциплинарно)' },
  { value: 'other',         label: 'Иное' }
];

export default function DepartureModal({ work, member, onDone, onClose }) {
  const [preview, setPreview] = useState(null);
  const [packingItems, setPackingItems] = useState([]);
  const [returnedItems, setReturnedItems] = useState(() => new Set());
  const [depDate, setDepDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reasonKind, setReasonKind] = useState('planned');
  const [reasonNote, setReasonNote] = useState('');
  const [sendSms, setSendSms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      loadDeparturePreview(work.id, member.employee_id).catch((e) => ({ _err: String(e?.message || e) })),
      // Чек-лист «возврат имущества» — берём позиции packing-листов работы,
      // которые числятся за этим работником (assigned_to / employee_id).
      loadPacking(work.id).catch(() => [])
    ]).then(async ([prev, lists]) => {
      if (!alive) return;
      if (prev?._err) { setErr(prev._err); return; }
      setPreview(prev);

      const empId = member.employee_id;
      const items = [];
      // Подтягиваем детали каждого листа, фильтруем строки по получателю.
      // Если работнику ничего не выдавали — список останется пустым (валидно).
      const detailPromises = (lists || [])
        .filter((l) => Number(l.assigned_to) === Number(empId) || Number(l.employee_id) === Number(empId))
        .slice(0, 10)
        .map((l) => loadPackingDetail(l.id).catch(() => null));
      const details = await Promise.all(detailPromises);
      details.forEach((d) => {
        if (d?.items?.length) {
          d.items.forEach((it) => {
            items.push({
              id: `pack-${d.list?.id || d.id}-${it.id}`,
              name: it.name || it.item_name || `Позиция #${it.id}`,
              qty: it.quantity || 1,
              list_id: d.list?.id || d.id
            });
          });
        }
      });
      if (alive) setPackingItems(items);
    });
    return () => { alive = false; };
  }, [work.id, member.employee_id]);

  if (err) {
    return (
      <MCard className="modal-md">
        <MHead icon="❌" title="Ошибка загрузки" onClose={onClose} accent="err" />
        <MBody><div className="ft-loading" style={{ color: 'var(--err)' }}>{err}</div></MBody>
        <MFoot><Btn onClick={onClose}>Закрыть</Btn></MFoot>
      </MCard>
    );
  }
  if (!preview) {
    return (
      <MCard className="modal-md">
        <MHead icon="🚪" title={`Отъезд — ${member.employee_name || member.name || '#' + member.employee_id}`} onClose={onClose} accent="amber" />
        <MBody><div className="ft-loading">⏳ Загружаем финансы…</div></MBody>
      </MCard>
    );
  }

  const fin = preview.finances || null;
  const asgn = preview.assignment || {};
  const empName = preview.employee?.fio || member.employee_name || member.name || `#${member.employee_id}`;

  const fot              = fin?.fot || 0;
  const perDiemAccrued   = fin?.per_diem_accrued || 0;
  const perDiemPaid      = fin?.per_diem_paid || 0;
  const perDiemBalance   = perDiemAccrued - perDiemPaid;
  const advancePaid      = fin?.advance_paid || 0;
  const salaryPaid       = fin?.salary_paid || 0;
  const bonusPaid        = fin?.bonus_paid || 0;
  const penalty          = fin?.penalty || 0;
  const totalEarned      = fin?.total_earned || 0;
  const totalPaid        = fin?.total_paid || 0;
  const totalPending     = fin?.total_pending || 0;
  const perDiemRate      = asgn?.per_diem || 0;
  const daysOnSite       = preview.days_on_site || 0;
  const positionName     = asgn?.position_name || 'Рабочий';

  const pendingTone =
    totalPending > 0 ? 'err' : totalPending < 0 ? 'ok' : 'muted';
  const pendingLabel =
    totalPending > 0 ? 'Компания должна работнику' :
    totalPending < 0 ? 'Переплата (работник должен)' : 'Баланс закрыт';

  const perDiemTone =
    perDiemBalance > 0 ? 'err' : perDiemBalance < 0 ? 'ok' : 'muted';
  const perDiemLabel =
    perDiemBalance > 0 ? 'Долг по суточным' :
    perDiemBalance < 0 ? 'Переплата суточных' : 'Суточные в балансе';

  const toggleReturn = (id) => {
    setReturnedItems((s) => {
      const ns = new Set(s);
      if (ns.has(id)) ns.delete(id); else ns.add(id);
      return ns;
    });
  };

  const reasonText = () => {
    const kindLbl = DEPARTURE_REASONS.find((r) => r.value === reasonKind)?.label || '';
    const note = reasonNote.trim();
    return note ? `${kindLbl} — ${note}` : kindLbl;
  };

  const onConfirm = async (alsoSms = false) => {
    if (!depDate) { toast('Ошибка', 'Укажите дату отъезда', 'err'); return; }
    setBusy(true);
    try {
      await departCrewMember(work.id, member.employee_id, {
        departure_date: depDate,
        reason: reasonText()
      });
      if (alsoSms) {
        try {
          await sendSingleInvite(work.id, member.employee_id);
        } catch (smsErr) {
          // SMS — best-effort. Отъезд уже зафиксирован.
          toast('SMS', 'Отъезд оформлен, но SMS не отправлено: ' + String(smsErr?.message || smsErr), 'warn');
        }
      }
      toast('Отъезд', `${empName} — отъезд оформлен`, 'ok');
      if (onDone) onDone({ departure_date: depDate, reason: reasonText() });
      if (onClose) onClose();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    } finally {
      setBusy(false);
    }
  };

  const unreturnedCount = packingItems.length - returnedItems.size;

  return (
    <MCard className="modal-lg">
      <MHead
        icon="🚪"
        title={`Отъезд — ${empName}`}
        subtitle={`${positionName} · ${daysOnSite} дн. на объекте · ${fmtMoney(perDiemRate)}/день суточных`}
        accent="amber"
        onClose={onClose}
      />
      <MBody>
        <div className="ft-dep-stack">
          {/* Главный баланс */}
          <div className={`ft-dep-card ft-dep-card--${pendingTone}`}>
            <div className="ft-dep-card__eyebrow">{pendingLabel}</div>
            <div className="ft-dep-card__big">{fmtMoney(Math.abs(totalPending))}</div>
          </div>

          {/* Суточные */}
          <div className="ft-dep-card">
            <h4>🌙 Суточные</h4>
            <div className="ft-dep-row">
              <span>Начислено (~{daysOnSite} дн. × {fmtMoney(perDiemRate)})</span>
              <strong>{fmtMoney(perDiemAccrued)}</strong>
            </div>
            <div className="ft-dep-row">
              <span>Выплачено</span>
              <strong>{fmtMoney(perDiemPaid)}</strong>
            </div>
            <div className="ft-dep-row ft-dep-row--total">
              <span className={`ft-dep-tone--${perDiemTone}`}>{perDiemLabel}</span>
              <strong className={`ft-dep-tone--${perDiemTone}`}>{fmtMoney(Math.abs(perDiemBalance))}</strong>
            </div>
          </div>

          {/* Заработок */}
          <div className="ft-dep-card">
            <h4>💰 Заработок</h4>
            <div className="ft-dep-row"><span>ФОТ (отработано)</span><strong>{fmtMoney(fot)}</strong></div>
            {bonusPaid > 0 && (
              <div className="ft-dep-row"><span>Премии</span><strong className="ft-dep-tone--ok">+{fmtMoney(bonusPaid)}</strong></div>
            )}
            {penalty > 0 && (
              <div className="ft-dep-row"><span>Штрафы</span><strong className="ft-dep-tone--err">−{fmtMoney(penalty)}</strong></div>
            )}
            <div className="ft-dep-row ft-dep-row--total">
              <span>Итого начислено</span>
              <strong className="c-gold">{fmtMoney(totalEarned)}</strong>
            </div>
          </div>

          {/* Выплаты */}
          <div className="ft-dep-card">
            <h4>💳 Выплаты</h4>
            <div className="ft-dep-row"><span>Зарплата</span><strong>{fmtMoney(salaryPaid)}</strong></div>
            <div className="ft-dep-row"><span>Суточные</span><strong>{fmtMoney(perDiemPaid)}</strong></div>
            {advancePaid > 0 && (
              <div className="ft-dep-row"><span>Авансы</span><strong className="ft-dep-tone--amber">{fmtMoney(advancePaid)}</strong></div>
            )}
            <div className="ft-dep-row ft-dep-row--total">
              <span>Итого выплачено</span>
              <strong>{fmtMoney(totalPaid)}</strong>
            </div>
          </div>

          {/* Чек-лист возврата */}
          <div className="ft-dep-card">
            <h4>
              📦 Возврат имущества
              {packingItems.length > 0 && (
                <span className="ft-dep-chip">
                  {returnedItems.size} / {packingItems.length}
                </span>
              )}
            </h4>
            {packingItems.length === 0 ? (
              <div className="ft-dep-row ft-dep-row--muted">
                Имущество за работником не числится (нет сборов).
              </div>
            ) : (
              <div className="ft-dep-checklist">
                {packingItems.map((it) => (
                  <label key={it.id} className="ft-dep-checklist__row">
                    <Checkbox
                      checked={returnedItems.has(it.id)}
                      onChange={() => toggleReturn(it.id)}
                      aria-label={`Возвращено: ${it.name}`}
                    />
                    <span className={returnedItems.has(it.id) ? 'ft-dep-strikethrough' : ''}>
                      {it.name}
                    </span>
                    <span className="ft-dep-checklist__qty">×{it.qty}</span>
                  </label>
                ))}
                {unreturnedCount > 0 && (
                  <div className="ft-dep-warn">
                    ⚠ Не возвращено: {unreturnedCount} {unreturnedCount === 1 ? 'позиция' : 'позиций'}. Можно оформить отъезд и завершить возврат позже.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Форма */}
          <div className="ft-dep-card ft-dep-card--form">
            <h4>📋 Оформление отъезда</h4>
            <div className="ft-row-grid-2">
              <Field label="Дата отъезда" required>
                <DatePicker value={depDate} onChange={setDepDate} />
              </Field>
              <Field label="Тип отъезда">
                <SelectInput value={reasonKind} onChange={setReasonKind} options={DEPARTURE_REASONS} />
              </Field>
            </div>
            <Field label="Причина / комментарий">
              <Textarea
                value={reasonNote}
                onChange={(e) => setReasonNote(e.target.value)}
                placeholder="Замена болезнью, завершение вахты, конкретика…"
                rows={2}
              />
            </Field>
            <label className="ft-dep-sms">
              <Checkbox
                checked={sendSms}
                onChange={setSendSms}
                aria-label="Отправить SMS"
              />
              <span>Отправить SMS работнику об отъезде и расчётах</span>
            </label>
          </div>
        </div>
      </MBody>
      <MFoot>
        <Btn onClick={onClose} disabled={busy}>Отмена</Btn>
        {sendSms ? (
          <Btn variant="primary" disabled={busy} onClick={() => onConfirm(true)}>
            {busy ? 'Сохраняем…' : '🚪 Сохранить и отправить SMS'}
          </Btn>
        ) : (
          <Btn variant="primary" disabled={busy} onClick={() => onConfirm(false)}>
            {busy ? 'Сохраняем…' : '🚪 Подтвердить отъезд'}
          </Btn>
        )}
      </MFoot>
    </MCard>
  );
}
