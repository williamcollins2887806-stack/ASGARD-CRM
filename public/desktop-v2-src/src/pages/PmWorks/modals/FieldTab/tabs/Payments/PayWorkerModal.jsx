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
import { api } from '@/api/client';
import { loadEmployeePaymentSummary, payWorkerDirect, loadCrew, loadCrewAll } from '../../api';

function fmtMoney(n) {
  if (!Number.isFinite(+n)) return '0 ₽';
  return new Intl.NumberFormat('ru-RU').format(Math.round(+n)) + ' ₽';
}

function workerHint({ isOfficial, isSelfEmployed }) {
  if (isOfficial) return 'Работник оформлен как штатник — оф-часть обычно идёт через банк, доплаты налом из кассы РП.';
  if (isSelfEmployed) return 'Работник — самозанятый, основные суммы идут через СЗ-сервис, мелочи можно налом.';
  return 'Тип работника не определён — выберите источник вручную.';
}

function disabledReason(card, { isOfficial, isSelfEmployed }) {
  if (card.requireOfficial && !isOfficial) return 'Доступно только для штатников';
  if (card.requireSelfEmployed && !isSelfEmployed) return 'Доступно только для самозанятых';
  return '';
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

const METHOD_LBL = { cash: 'нал', card: 'карта', transfer: 'перевод', bank: 'банк', self: 'СЗ-сервис', auto: 'авто' };

const TYPE_TILES = [
  { value: 'per_diem', icon: '🌙', label: 'Суточные' },
  { value: 'advance',  icon: '💵', label: 'Аванс ЗП' },
  { value: 'salary',   icon: '💼', label: 'Зарплата' },
  { value: 'bonus',    icon: '⭐', label: 'Премия' },
  { value: 'penalty',  icon: '⚠',  label: 'Удержание' }
];

/**
 * 2026-06-29 — радио-карточки «откуда деньги».
 *  • cash     — я выдал наличкой из своей кассы (paid_by=me)
 *  • transfer — я перевёл со своей карты (paid_by=me) — тоже «моя касса»
 *  • bank     — бухгалтерия через банк (paid_by=NULL) — только для штатников
 *  • self     — через СЗ-сервис (paid_by=NULL) — только для самозанятых
 *
 * Поле в БД — `payment_method`. paid_by_role вычисляется на бэке по этому методу.
 */
const SOURCE_CARDS = [
  {
    value: 'cash',
    icon: '📤',
    title: 'Я выдал наличкой из своей кассы',
    desc: 'Уйдёт с баланса моей кассы РП',
    tech: "payment_method='cash' · paid_by=Я"
  },
  {
    value: 'transfer',
    icon: '💳',
    title: 'Я перевёл со своей карты',
    desc: 'Тоже уйдёт с моей кассы (перевод считается налом)',
    tech: "payment_method='transfer' · paid_by=Я"
  },
  {
    value: 'bank',
    icon: '🏦',
    title: 'Бухгалтерия через банк (оф)',
    desc: 'Не из моей кассы — справочно отметить',
    tech: "payment_method='bank' · paid_by=NULL",
    requireOfficial: true
  },
  {
    value: 'self',
    icon: '📱',
    title: 'Через СЗ-сервис (ReStaff)',
    desc: 'Бухгалтерия переведёт самозанятому. Не из моей кассы.',
    tech: "payment_method='self' · paid_by=NULL",
    requireSelfEmployed: true
  }
];

/**
 * Дефолтный источник по типу работника + типу выплаты.
 *   штатник + salary → bank
 *   СЗ + salary → self
 *   иначе → cash
 */
function defaultSourceFor({ isOfficial, isSelfEmployed, payType }) {
  if (payType === 'salary' && isOfficial) return 'bank';
  if (payType === 'salary' && isSelfEmployed) return 'self';
  return 'cash';
}

/** disabled-источник если работник не того типа. */
function isSourceDisabled(srcValue, { isOfficial, isSelfEmployed }) {
  const card = SOURCE_CARDS.find((s) => s.value === srcValue);
  if (!card) return false;
  if (card.requireOfficial && !isOfficial) return true;
  if (card.requireSelfEmployed && !isSelfEmployed) return true;
  return false;
}

export function PayWorkerModal({
  work,
  employeeId: initialEmpId,
  employeeName: initialEmpName,
  defaultType = 'salary',
  crewOptions, // FIX (24.06): seed-список бригады с готовыми employee_name из summary
  onSaved
}) {
  const { open, close } = useModal();
  const [employeeId, setEmployeeId] = useState(initialEmpId ? String(initialEmpId) : '');
  const [employeeName, setEmployeeName] = useState(initialEmpName || '');
  const [crew, setCrew] = useState(Array.isArray(crewOptions) ? crewOptions : []);
  const [summary, setSummary] = useState(null);
  const [err, setErr] = useState(null);
  const [type, setType] = useState(defaultType);
  const [amount, setAmount] = useState('');
  // 2026-06-29 — источник денег (payment_method).
  // Initial='cash'; пересчитывается на изменение employee+type через эффект ниже.
  const [method, setMethod] = useState('cash');
  const [methodTouched, setMethodTouched] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitErr, setSubmitErr] = useState('');

  // FIX 24.06: используем новый /crew-all эндпоинт — он отдаёт «на объекте»
  // (assignments ∪ checkins, с ФИО) и «остальные активные сотрудники».
  // Это решает кейс: бригада пустая → раньше select был пустой → выплатить
  // премию/удержание невозможно. Теперь юзер выбирает любого.
  // Если родитель передал crewOptions из summary (быстрый кейс — бригада уже
  // загружена в KPI-таблице) — используем их + догружаем «прочих» в фоне.
  const [othersList, setOthersList] = useState([]);
  useEffect(() => {
    if (initialEmpId) return;
    loadCrewAll(work.id).then(({ on_site, others }) => {
      // Если crewOptions передан и не пустой — используем его как on_site (там
      // же дополнительно есть per_diem_rate из summary). Иначе берём из crew-all.
      const seedOnSite = (Array.isArray(crewOptions) && crewOptions.length > 0) ? crewOptions : on_site;
      setCrew(seedOnSite);
      setOthersList(others);
    });
  }, [work.id, initialEmpId, crewOptions]);

  // Подгружаем баланс при выборе сотрудника.
  useEffect(() => {
    if (!employeeId) { setSummary(null); return; }
    setSummary(null);
    setErr(null);
    loadEmployeePaymentSummary(work.id, employeeId)
      .then(setSummary)
      .catch((e) => setErr(String(e?.message || e)));
  }, [work.id, employeeId]);

  // 2026-06-29 — определяем тип работника (штатник / СЗ).
  // Сперва пробуем crew-списки (если флаги пришли), затем — `summary.employee`,
  // в крайнем случае — fetch /api/staff/employees/:id.
  const [empInfo, setEmpInfo] = useState(null);
  useEffect(() => {
    if (!employeeId) { setEmpInfo(null); return; }
    let cancel = false;
    // Сначала ищем в crew
    const empIdStr = String(employeeId);
    const all = [...(crew || []), ...(othersList || [])];
    const fromCrew = all.find((c) => String(c.employee_id ?? c.id) === empIdStr);
    if (fromCrew && (fromCrew.is_officially_employed !== undefined || fromCrew.is_self_employed !== undefined)) {
      setEmpInfo(fromCrew);
      return;
    }
    // Иначе — fetch employee
    api(`/api/staff/employees/${empIdStr}`)
      .then((d) => { if (!cancel) setEmpInfo(d?.employee || d || null); })
      .catch(() => {
        // Fallback на список — может вернёт нужные поля
        api(`/api/employees?limit=2000`).then((d) => {
          if (cancel) return;
          const arr = Array.isArray(d) ? d : (d?.employees || d?.items || []);
          const e = arr.find((x) => String(x.id) === empIdStr);
          if (e) setEmpInfo(e);
        }).catch(() => {});
      });
    return () => { cancel = true; };
  }, [employeeId, crew, othersList]);

  const workerType = useMemo(() => {
    const src = empInfo || summary?.employee || null;
    return {
      isOfficial: !!(src?.is_officially_employed),
      isSelfEmployed: !!(src?.is_self_employed)
    };
  }, [empInfo, summary]);

  // Дефолт source при смене работника или типа выплаты (если юзер не трогал руками).
  useEffect(() => {
    if (methodTouched) return;
    if (!employeeId) return;
    const next = defaultSourceFor({
      isOfficial: workerType.isOfficial,
      isSelfEmployed: workerType.isSelfEmployed,
      payType: type
    });
    setMethod(next);
  }, [employeeId, type, workerType.isOfficial, workerType.isSelfEmployed, methodTouched]);

  // Если выбранный method стал недоступен (например, юзер сменил с СЗ на штатника) — переключим.
  useEffect(() => {
    if (!employeeId) return;
    if (isSourceDisabled(method, workerType)) {
      setMethod(defaultSourceFor({
        isOfficial: workerType.isOfficial,
        isSelfEmployed: workerType.isSelfEmployed,
        payType: type
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId, workerType.isOfficial, workerType.isSelfEmployed]);

  const pickMethod = (v) => {
    setMethod(v);
    setMethodTouched(true);
  };

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

  const labelOf = (c) => {
    if (!c) return '';
    if (c.employee_name) return c.employee_name;
    if (c.name) return c.name;
    if (c.fio) return c.fio;
    if (c.full_name) return c.full_name;
    const ln = c.last_name || '';
    const fn = c.first_name || '';
    const mn = c.middle_name || '';
    const composed = [ln, fn, mn].filter(Boolean).join(' ').trim();
    if (composed) return composed;
    const id = c.employee_id || c.id;
    return id ? `#${id}` : '—';
  };

  const onPickEmployee = (id) => {
    setEmployeeId(id);
    const all = [...crew, ...othersList];
    const c = all.find((x) => String(x.employee_id || x.id) === String(id));
    setEmployeeName(labelOf(c) || `#${id}`);
  };

  const selectOptions = useMemo(() => {
    const out = [{ value: '', label: '— выбрать сотрудника —' }];
    const onSite = crew
      .filter((c) => c.employee_id || c.id)
      .map((c) => ({ value: String(c.employee_id || c.id), label: labelOf(c) }));
    if (onSite.length > 0) {
      out.push({ value: '__hdr_on_site', label: '── На объекте ──', disabled: true });
      out.push(...onSite);
    }
    const others = othersList
      .filter((c) => c.employee_id || c.id)
      .map((c) => ({ value: String(c.employee_id || c.id), label: labelOf(c) }));
    if (others.length > 0) {
      out.push({ value: '__hdr_others', label: '── Прочие сотрудники ──', disabled: true });
      out.push(...others);
    }
    return out;
  }, [crew, othersList]);

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
                options={selectOptions}
              />
            </Field>
            {crew.length === 0 && othersList.length === 0 && (
              <div className="muted" style={{ fontSize: 12 }}>
                Загрузка списка сотрудников…
              </div>
            )}
            {crew.length === 0 && othersList.length > 0 && (
              <div className="muted" style={{ fontSize: 12 }}>
                На объекте нет назначений и чекинов — выберите из списка ниже.
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

              <Field label="Источник денег" required help={workerHint(workerType)}>
                <div className="ft-pw-src-group" role="radiogroup" aria-label="Источник денег">
                  {SOURCE_CARDS.map((s) => {
                    const disabled = isSourceDisabled(s.value, workerType);
                    const selected = method === s.value;
                    return (
                      <label
                        key={s.value}
                        className={
                          'ft-pw-src-card'
                          + (selected ? ' is-selected' : '')
                          + (disabled ? ' is-disabled' : '')
                        }
                        title={disabled ? disabledReason(s, workerType) : ''}
                      >
                        <input
                          type="radio"
                          name="ft-pw-source"
                          value={s.value}
                          checked={selected}
                          disabled={disabled}
                          onChange={() => !disabled && pickMethod(s.value)}
                        />
                        <span className="ft-pw-src-ico" aria-hidden="true">{s.icon}</span>
                        <span className="ft-pw-src-body">
                          <span className="ft-pw-src-ttl">{s.title}</span>
                          <span className="ft-pw-src-desc">
                            {disabled ? disabledReason(s, workerType) : s.desc}
                          </span>
                          <span className="ft-pw-src-tech">{s.tech}</span>
                        </span>
                      </label>
                    );
                  })}
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
