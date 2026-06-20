/**
 * PayWorkerModal — двух-колонная фин-форма для выплаты конкретному рабочему.
 *
 * Источник vanilla: field-tab.js openPayWorkerModal (~311 строк, строки 2971-3279).
 *   Левая колонка — текущий баланс сотрудника (суточные / зарплата / прочее) + preview после выплаты.
 *   Правая колонка — форма (тип / сумма / способ / коммент) + quick-кнопки сумм.
 *
 * Бэк:
 *   GET  /api/worker-payments/employee-summary?work_id=&employee_id=  (SSoT)
 *   POST /api/worker-payments/pay-worker  body {employee_id, work_id, type, amount, payment_method, note}
 */
import { useEffect, useMemo, useState } from 'react';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { TextInput, MoneyInput, SelectInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { useModal, ConfirmModal } from '@/modals';
import { loadEmployeePaymentSummary, payWorkerDirect, loadCrew } from '../../api';

function fmtMoney(n) {
  if (!Number.isFinite(+n)) return '0 ₽';
  return new Intl.NumberFormat('ru-RU').format(Math.round(+n)) + ' ₽';
}

function fmtDate(s) {
  if (!s) return '—';
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return String(s);
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return String(s);
  }
}

const METHOD_LBL = { cash: 'нал', card: 'карта', transfer: 'перевод', auto: 'авто' };

const TYPE_TILES = [
  { value: 'per_diem', icon: '🌙', label: 'Суточные' },
  { value: 'advance',  icon: '💵', label: 'Аванс ЗП' },
  { value: 'salary',   icon: '💼', label: 'Зарплата' },
  { value: 'bonus',    icon: '⭐', label: 'Премия' },
  { value: 'penalty',  icon: '⚠',  label: 'Удержание' }
];

const METHOD_TILES = [
  { value: 'cash',     icon: '💵', label: 'Наличные' },
  { value: 'card',     icon: '💳', label: 'На карту' },
  { value: 'transfer', icon: '🏦', label: 'Перевод' }
];

export function PayWorkerModal({ work, employeeId: initialEmpId, employeeName: initialEmpName, defaultType = 'salary', onSaved }) {
  const { open, close } = useModal();
  const [employeeId, setEmployeeId] = useState(initialEmpId ? String(initialEmpId) : '');
  const [employeeName, setEmployeeName] = useState(initialEmpName || '');
  const [crew, setCrew] = useState([]);
  const [summary, setSummary] = useState(null);
  const [err, setErr] = useState(null);
  const [type, setType] = useState(defaultType);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitErr, setSubmitErr] = useState('');

  // Если сотрудник не задан изначально — грузим список бригады для выбора.
  useEffect(() => {
    if (!initialEmpId) {
      loadCrew(work.id).then(setCrew);
    }
  }, [work.id, initialEmpId]);

  // Подгружаем баланс при выборе сотрудника.
  useEffect(() => {
    if (!employeeId) { setSummary(null); return; }
    setSummary(null);
    setErr(null);
    loadEmployeePaymentSummary(work.id, employeeId)
      .then(setSummary)
      .catch((e) => setErr(String(e?.message || e)));
  }, [work.id, employeeId]);

  const pd  = summary?.per_diem || { accrued: 0, paid: 0, balance: 0 };
  const sal = summary?.salary   || { fot_accrued: 0, advance_paid: 0, salary_paid: 0, balance: 0 };
  const bon = summary?.bonus    || { paid: 0 };
  const pen = summary?.penalty  || { paid: 0 };
  const checkins = summary?.checkins_days || 0;
  const rate = summary?.per_diem_rate || 1000;

  // Vanilla parity: pd.balance = paid - accrued
  //   pd.balance < 0 → должны рабочему (выдали меньше чем начислили)
  //   pd.balance > 0 → переплата (выдали больше)
  // ЗП: sal.balance = fot - advance - salary
  //   sal.balance > 0 → должны
  const pdOwed = pd.balance < 0 ? -pd.balance : 0;
  const pdOver = pd.balance > 0 ? pd.balance : 0;
  const pdTone = pdOwed > 0 ? 'amber' : pdOver > 0 ? 'err' : 'ok';
  const pdValue = pdOwed > 0 ? pdOwed : pdOver > 0 ? pdOver : 0;
  const pdLabel = pdOwed > 0 ? 'Должны рабочему' : pdOver > 0 ? 'Переплата' : 'Закрыто';

  const salOwed = sal.balance > 0 ? sal.balance : 0;
  const salOver = sal.balance < 0 ? -sal.balance : 0;
  const salTone = salOwed > 0 ? 'amber' : salOver > 0 ? 'err' : 'ok';
  const salValue = salOwed > 0 ? salOwed : salOver > 0 ? salOver : 0;
  const salLabel = salOwed > 0 ? 'Должны рабочему' : salOver > 0 ? 'Переплата' : 'Закрыто';

  const quickButtons = useMemo(() => {
    if (type === 'per_diem') {
      const out = [
        { lbl: `+1 день (${fmtMoney(rate)})`, val: rate },
        { lbl: `+5 дней (${fmtMoney(rate * 5)})`, val: rate * 5 },
        { lbl: `+10 дней (${fmtMoney(rate * 10)})`, val: rate * 10 }
      ];
      if (pdOwed > 0) out.push({ lbl: `Весь долг (${fmtMoney(pdOwed)})`, val: pdOwed });
      return out;
    }
    if (type === 'advance' || type === 'salary') {
      const out = [
        { lbl: '5 000', val: 5000 },
        { lbl: '10 000', val: 10000 },
        { lbl: '20 000', val: 20000 }
      ];
      if (salOwed > 0) out.push({ lbl: `Весь долг (${fmtMoney(salOwed)})`, val: salOwed });
      return out;
    }
    return [
      { lbl: '1 000', val: 1000 },
      { lbl: '3 000', val: 3000 },
      { lbl: '5 000', val: 5000 }
    ];
  }, [type, rate, pdOwed, salOwed]);

  const amt = Number(amount) || 0;
  const preview = useMemo(() => {
    if (amt <= 0) return null;
    if (type === 'per_diem') {
      const nb = pd.balance + amt; // выплачиваем — pd.paid растёт — balance → 0
      const lbl = nb < 0 ? 'Останется долг' : nb > 0 ? 'Переплата' : 'Суточные закрыты';
      return { lbl, val: fmtMoney(Math.abs(nb)), was: fmtMoney(Math.abs(pd.balance)) };
    }
    if (type === 'advance' || type === 'salary') {
      const nb = sal.balance - amt;
      const lbl = nb > 0 ? 'Останется долг по ЗП' : nb < 0 ? 'Переплата по ЗП' : 'ЗП закрыта';
      return { lbl, val: fmtMoney(Math.abs(nb)), was: fmtMoney(Math.abs(sal.balance)) };
    }
    if (type === 'bonus') {
      return { lbl: 'Премий всего', val: fmtMoney(bon.paid + amt), was: fmtMoney(bon.paid) };
    }
    if (type === 'penalty') {
      return { lbl: 'Удержаний всего', val: fmtMoney(pen.paid + amt), was: fmtMoney(pen.paid) };
    }
    return null;
  }, [amt, type, pd.balance, sal.balance, bon.paid, pen.paid]);

  const submit = async () => {
    setSubmitErr('');
    if (!employeeId) { setSubmitErr('Выберите сотрудника'); return; }
    if (!amt || amt <= 0) { setSubmitErr('Введите сумму'); return; }
    if (!type) { setSubmitErr('Выберите тип выплаты'); return; }
    if (!method) { setSubmitErr('Выберите способ выплаты'); return; }

    const basePayload = {
      employee_id: Number(employeeId),
      work_id: Number(work.id),
      type,
      amount: amt,
      payment_method: method,
      note: note.trim() || null
    };

    setBusy(true);

    const doPay = async (extra = {}) => {
      await payWorkerDirect({ ...basePayload, ...extra });
      toast('Выплачено', `${fmtMoney(amt)} — ${employeeName || ''}`, 'ok');
      onSaved?.();
      close();
    };

    try {
      await doPay();
    } catch (e) {
      // Stage S — защита от двойной выплаты: 409 duplicate_payment.
      // Сервер вернул `requires_confirmation:true` + список already_paid.
      // Показываем confirm-модалку, после подтверждения — повторяем с
      // `confirm_duplicate:true`, который пропускает проверку.
      const data = e?.data || e?.body || null; // api-client кладёт payload в e.data
      if (e?.status === 409 && data?.requires_confirmation) {
        const alreadyList = (data.already_paid || []).map((p) =>
          `• ${fmtDate(p.paid_at)} — ${fmtMoney(p.amount)} (${METHOD_LBL[p.payment_method] || p.payment_method || '—'})`
        ).join('\n');
        const totalTxt = data.total_already_paid
          ? `\nВсего уже выплачено: ${fmtMoney(data.total_already_paid)}`
          : '';
        const msg = (data.message || 'Возможно двойная выплата.') + (alreadyList ? '\n\n' + alreadyList : '') + totalTxt;

        // Чтобы пользователь видел модалку — снимем busy на время выбора.
        setBusy(false);
        open(<ConfirmModal
          title="⚠ Возможно двойная выплата"
          message={msg}
          tone="warn"
          okText="Подтвердить (новая выплата)"
          cancelText="Отмена"
          onConfirm={async () => {
            setBusy(true);
            try {
              await doPay({ confirm_duplicate: true });
            } catch (e2) {
              setSubmitErr(e2?.serverMsg || e2?.message || String(e2));
            } finally {
              setBusy(false);
            }
          }}
        />);
        return;
      }
      setSubmitErr(e?.serverMsg || e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const onPickEmployee = (id) => {
    setEmployeeId(id);
    const c = crew.find((x) => String(x.employee_id || x.id) === String(id));
    setEmployeeName(c?.employee_name || c?.name || `#${id}`);
  };

  return (
    <MCard className="modal-xl">
      <MHead icon="💰" title="Выплата рабочему" subtitle={employeeName || ''} accent="gold" onClose={close} />
      <MBody>
        {!initialEmpId && (
          <div style={{ marginBottom: 12 }}>
            <Field label="Сотрудник" required>
              <SelectInput
                value={employeeId}
                onChange={onPickEmployee}
                options={[
                  { value: '', label: '— выбрать из бригады —' },
                  ...crew.map((c) => ({
                    value: String(c.employee_id || c.id),
                    label: c.employee_name || c.name || `#${c.employee_id}`
                  }))
                ]}
              />
            </Field>
            {crew.length === 0 && (
              <div className="muted" style={{ fontSize: 12 }}>
                В бригаде нет сотрудников — добавьте их на вкладке «Бригада».
              </div>
            )}
          </div>
        )}
        {err && <div className="ft-pw-err">⚠ {err}</div>}
        {employeeId && !summary && !err && <div className="ft-loading">⏳ Загружаем баланс…</div>}
        {!employeeId && initialEmpId && <div className="ft-loading">⏳ Загружаем…</div>}

        {summary && (
          <div className="ft-pw-grid">
            {/* ── Левая колонка: баланс ── */}
            <div className="ft-pw-card">
              <div className="ft-pw-card-title">💼 Текущее состояние</div>

              <div className="ft-pw-bal-row">
                <div>
                  <div className="ft-pw-bal-lbl">🌙 Суточные</div>
                  <div className="ft-pw-bal-sub">
                    Начислено {fmtMoney(pd.accrued)} · выдано {fmtMoney(pd.paid)} ({checkins} дн)
                  </div>
                </div>
                <div className={'ft-pw-bal-val ft-pw-bal-val--' + pdTone}>
                  {pdValue > 0 ? fmtMoney(pdValue) : fmtMoney(0)}
                  <div className="ft-pw-bal-sub" style={{ textAlign: 'right' }}>{pdLabel}</div>
                </div>
              </div>

              <div className="ft-pw-bal-row">
                <div>
                  <div className="ft-pw-bal-lbl">💼 Зарплата</div>
                  <div className="ft-pw-bal-sub">
                    Заработано {fmtMoney(sal.fot_accrued)} · аванс {fmtMoney(sal.advance_paid)} · ЗП {fmtMoney(sal.salary_paid)}
                  </div>
                </div>
                <div className={'ft-pw-bal-val ft-pw-bal-val--' + salTone}>
                  {salValue > 0 ? fmtMoney(salValue) : fmtMoney(0)}
                  <div className="ft-pw-bal-sub" style={{ textAlign: 'right' }}>{salLabel}</div>
                </div>
              </div>

              {(bon.paid > 0 || pen.paid > 0) && (
                <div className="ft-pw-bal-row">
                  <div>
                    <div className="ft-pw-bal-lbl">⭐ Прочее</div>
                    <div className="ft-pw-bal-sub">
                      {bon.paid > 0 && <>Премии {fmtMoney(bon.paid)}</>}
                      {bon.paid > 0 && pen.paid > 0 && ' · '}
                      {pen.paid > 0 && <>Удержания {fmtMoney(pen.paid)}</>}
                    </div>
                  </div>
                  <div className="ft-pw-bal-val ft-pw-bal-val--mute">—</div>
                </div>
              )}

              {preview && (
                <div className="ft-pw-preview">
                  <div className="ft-pw-preview-ttl">📋 После выплаты</div>
                  <div className="ft-pw-preview-row">
                    <span style={{ fontWeight: 700 }}>{preview.lbl}</span>
                    <span style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{preview.val}</span>
                  </div>
                  <div className="ft-pw-preview-was">Было: {preview.was}</div>
                </div>
              )}
            </div>

            {/* ── Правая колонка: форма ── */}
            <div className="ft-pw-card">
              <div className="ft-pw-card-title">💰 Новая выплата</div>

              {submitErr && <div className="ft-pw-err">⚠ {submitErr}</div>}

              <Field label="Тип выплаты" required>
                <div className="ft-pw-tile-grid">
                  {TYPE_TILES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      className={'ft-pw-tile' + (type === t.value ? ' is-active' : '')}
                      onClick={() => setType(t.value)}
                    >
                      <span className="ic">{t.icon}</span>
                      <span className="nm">{t.label}</span>
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="Сумма, ₽" required>
                <MoneyInput value={amount} onChange={setAmount} />
              </Field>

              {quickButtons.length > 0 && (
                <div className="ft-pw-quick-row">
                  {quickButtons.map((b, i) => (
                    <button key={i} type="button" className="ft-pw-quick" onClick={() => setAmount(String(b.val))}>
                      {b.lbl}
                    </button>
                  ))}
                </div>
              )}

              <Field label="Способ выплаты" required>
                <div className="ft-pw-method-grid">
                  {METHOD_TILES.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      className={'ft-pw-tile' + (method === m.value ? ' is-active' : '')}
                      onClick={() => setMethod(m.value)}
                    >
                      <span className="ic">{m.icon}</span>
                      <span className="nm">{m.label}</span>
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="Комментарий">
                <TextInput value={note} onChange={setNote} placeholder="Например: «За май, выдано на руки»" />
              </Field>
            </div>
          </div>
        )}
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy || !summary || !employeeId} onClick={submit}>
          {busy ? 'Обработка…' : '💰 Выплатить ' + (amt > 0 ? fmtMoney(amt) : '')}
        </Btn>
      </MFoot>
    </MCard>
  );
}
