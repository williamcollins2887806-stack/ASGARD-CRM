/**
 * Funds — подотчёт мастерам (выдача / трекинг трат / возвраты / закрытие).
 *
 * Бэк (src/routes/field-funds.js):
 *   GET  /api/field/funds/?work_id=…           — список (CRM auth)
 *   POST /api/field/funds/                     — выдать (master_employee_id+amount+purpose обязательны)
 *   GET  /api/field/funds/:id                  — детали + expenses + returns
 *   PUT  /api/field/funds/:id/close            — закрыть
 *
 * Vanilla coverage checklist (field-tab.js:2030/2147):
 *   ✅ список с колонками Выдано/Потрачено/Остаток/Назначение/Статус
 *   ✅ колонка «Возврат» (returned)             — добавлена
 *   ✅ поле дедлайн confirm_deadline в форме   — добавлено
 *   ✅ footer-summary: Выдано/Возвращено/Остаток — добавлен
 *   ✅ openFundDetailModal — расходы + возвраты + операции (без stub)
 */
import { useEffect, useState } from 'react';
import { Btn, MCard, MHead, MBody, MFoot } from '@/modals/parts';
import { EmptyState } from '@/blocks/Blocks';
import { StatusBadge, toast } from '@/modals/Notifications';
import { Field, MoneyInput, SelectInput, TextareaInput, DatePicker } from '@/inputs/Inputs';
import { useModal, ConfirmModal } from '@/modals';
import { loadFunds, loadCrew, createFund, closeFund, loadFundDetail } from '../api';
import { FUND_STATUS_LABELS } from '../constants';

function fmtMoney(n) {
  if (!Number.isFinite(+n)) return '—';
  return new Intl.NumberFormat('ru-RU').format(Math.round(+n)) + ' ₽';
}
function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('ru-RU') : '—';
}

export default function FundsTab({ work }) {
  const { open } = useModal();
  const [list, setList] = useState(null);
  const [crew, setCrew] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ master_id: '', amount: '', purpose: '', confirm_deadline: '' });
  const [busy, setBusy] = useState(false);

  const reload = () => loadFunds(work.id).then(setList);
  useEffect(() => {
    reload();
    // loadCrew теперь возвращает сырые employee_assignments (поле field_role,
    // НЕ role_in_field). Фильтруем по любому из ключей для совместимости.
    loadCrew(work.id).then((c) => setCrew(c.filter((m) => {
      const r = m.role_in_field || m.field_role;
      return ['shift_master', 'object_master', 'senior_master', 'pm'].includes(r);
    })));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [work.id]);

  const submit = async () => {
    if (!form.master_id) return toast('Мастер', 'Выбери мастера', 'warn');
    if (!form.amount || Number(form.amount) <= 0) return toast('Сумма', 'Укажи сумму', 'warn');
    if (!form.purpose?.trim()) return toast('Назначение', 'Укажи назначение (обязательно)', 'warn');
    setBusy(true);
    try {
      await createFund({
        work_id: work.id,
        master_employee_id: Number(form.master_id),
        amount: Number(form.amount),
        purpose: form.purpose.trim(),
        confirm_deadline: form.confirm_deadline || null
      });
      toast('Выдано', fmtMoney(form.amount), 'ok');
      setForm({ master_id: '', amount: '', purpose: '', confirm_deadline: '' });
      setShowForm(false);
      reload();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    } finally {
      setBusy(false);
    }
  };

  const onClose = (id) => {
    open(<ConfirmModal
      title="Закрыть подотчёт"
      message="Закрыть подотчёт? Остаток нужно вернуть в кассу."
      tone="warn"
      okText="Закрыть"
      onConfirm={async () => {
        try {
          await closeFund(id);
          toast('Закрыт', '', 'ok');
          reload();
        } catch (e) {
          toast('Ошибка', String(e?.message || e), 'err');
        }
      }}
    />);
  };

  const openDetail = (id) => {
    open(<FundDetailModal fundId={id} onChanged={reload} />, { size: 'wide' });
  };

  // ─── Footer summary (vanilla parity — суммы по проекту) ──────────────
  const totals = (list || []).reduce((acc, f) => {
    acc.issued   += Number(f.issued || f.amount) || 0;
    acc.spent    += Number(f.spent) || 0;
    acc.returned += Number(f.returned) || 0;
    return acc;
  }, { issued: 0, spent: 0, returned: 0 });
  const remainder = totals.issued - totals.spent - totals.returned;

  return (
    <div className="ft-stack">
      <div className="row-spread">
        <strong className="ft-toolbar-title">Подотчётные средства мастерам</strong>
        <Btn variant="primary" onClick={() => setShowForm((s) => !s)}>
          {showForm ? '× Скрыть' : '+ Выдать средства'}
        </Btn>
      </div>

      {showForm && (
        <div className="ft-add-form">
          <Field label="Мастер" required>
            <SelectInput
              value={form.master_id}
              onChange={(v) => setForm({ ...form, master_id: v })}
              options={[{ value: '', label: '— выбрать —' }, ...crew.map((m) => ({
                value: String(m.employee_id || m.id),
                label: `${m.employee_name || m.name || m.fio || `#${m.employee_id}`} · ${m.role_in_field || m.field_role || ''}`
              }))]}
            />
          </Field>
          <div className="ft-row-grid-2">
            <Field label="Сумма выдачи" required>
              <MoneyInput value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} />
            </Field>
            <Field label="Дедлайн отчёта" help="К какой дате мастер должен подтвердить получение">
              <DatePicker value={form.confirm_deadline} onChange={(v) => setForm({ ...form, confirm_deadline: v })} />
            </Field>
          </div>
          <Field label="Назначение" required help="На что выдаём (закупка, расходники, питание и т.п.)">
            <TextareaInput value={form.purpose} onChange={(v) => setForm({ ...form, purpose: v })} minRows={2} maxRows={4} />
          </Field>
          <div className="ft-row-r">
            <Btn onClick={() => setShowForm(false)}>Отмена</Btn>
            <Btn variant="primary" disabled={busy} onClick={submit}>{busy ? 'Сохраняем…' : 'Выдать'}</Btn>
          </div>
        </div>
      )}

      {list === null && <div className="muted">⏳ Загружаем…</div>}

      {list && list.length === 0 && !showForm && (
        <EmptyState icon="💰" title="Подотчётов нет" hint="Выдай первое поручение кнопкой выше" />
      )}

      {list && list.length > 0 && (
        <>
          <div className="card card-pad-0">
            <table className="t-list ft-table">
              <thead>
                <tr>
                  <th>Мастер</th>
                  <th>Выдано</th>
                  <th>Потрачено</th>
                  <th>Возврат</th>
                  <th>Остаток</th>
                  <th>Дедлайн</th>
                  <th>Назначение</th>
                  <th>Статус</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list.map((f) => {
                  const issued = Number(f.issued || f.amount) || 0;
                  const spent = Number(f.spent) || 0;
                  const returned = Number(f.returned) || 0;
                  const rem = issued - spent - returned;
                  const canClose = f.status !== 'closed' && f.status !== 'returned';
                  return (
                    <tr key={f.id} className="row-hover" style={{ cursor: 'pointer' }} onClick={() => openDetail(f.id)}>
                      <td>{f.master_name || `#${f.master_employee_id || f.master_id}`}</td>
                      <td>{fmtMoney(issued)}</td>
                      <td>{fmtMoney(spent)}</td>
                      <td style={{ color: returned > 0 ? 'var(--ok)' : 'var(--t-3)' }}>{fmtMoney(returned)}</td>
                      <td><strong style={{ color: rem > 0 ? 'var(--amber)' : 'var(--ok)' }}>{fmtMoney(rem)}</strong></td>
                      <td>{fmtDate(f.confirm_deadline)}</td>
                      <td className="ft-purpose-cell" title={f.purpose}>{f.purpose || '—'}</td>
                      <td><StatusBadge tone={f.status === 'closed' ? 'approved' : f.status === 'issued' ? 'sent' : 'draft'} label={FUND_STATUS_LABELS[f.status] || f.status} /></td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {canClose && <Btn size="sm" variant="ghost" onClick={() => onClose(f.id)}>Закрыть</Btn>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── Footer summary по проекту ───────────────────────── */}
          <div className="ft-summary-soft">
            <span>Выдано всего: <strong>{fmtMoney(totals.issued)}</strong></span>
            <span style={{ marginLeft: 16 }}>Потрачено: <strong style={{ color: 'var(--err)' }}>{fmtMoney(totals.spent)}</strong></span>
            <span style={{ marginLeft: 16 }}>Возвращено: <strong style={{ color: 'var(--ok)' }}>{fmtMoney(totals.returned)}</strong></span>
            <span style={{ marginLeft: 16 }}>Остаток: <strong style={{ color: remainder > 0 ? 'var(--amber)' : 'var(--ok)' }}>{fmtMoney(remainder)}</strong></span>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Детальная модалка подотчёта: KPI + список расходов + список возвратов.
 * Операции добавляет мастер через Field PWA (фотография чека) — здесь
 * PM/BUH видит читаемый аудит-лог без возможности «дорисовать» строку.
 */
function FundDetailModal({ fundId, onChanged }) {
  const { close } = useModal();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    loadFundDetail(fundId).then((d) => {
      if (!d || !d.fund) { setErr('Не удалось загрузить'); return; }
      setData(d);
    });
  }, [fundId]);

  if (err) return (
    <MCard>
      <MHead icon="💰" title="Ошибка" onClose={close} />
      <MBody><p>{err}</p></MBody>
      <MFoot><Btn onClick={close}>Закрыть</Btn></MFoot>
    </MCard>
  );

  if (!data) return (
    <MCard>
      <MHead icon="💰" title="Загрузка…" onClose={close} />
      <MBody><div className="ft-loading">⏳</div></MBody>
    </MCard>
  );

  const f = data.fund;
  const expenses = data.expenses || [];
  const returns = data.returns || [];
  const issued = Number(f.amount) || 0;
  const spent = Number(f.spent) || 0;
  const returned = Number(f.returned) || 0;
  const ownSpent = Number(f.own_spent) || 0;
  const remainder = issued - spent - returned;
  // Сводный таймлайн «инкрементальных операций» — расходы + возвраты в одном списке.
  const ops = [
    ...expenses.map((e) => ({ kind: 'expense', date: e.expense_date || e.created_at, amount: Number(e.amount) || 0, comment: e.description || '', extra: e })),
    ...returns.map((r) => ({ kind: 'return', date: r.created_at, amount: Number(r.amount) || 0, comment: r.note || '', extra: r }))
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  return (
    <MCard>
      <MHead icon="💰" title={f.purpose || `Подотчёт #${f.id}`} subtitle={`Мастер: ${f.master_name || '—'}`} onClose={close} />
      <MBody>
        {/* KPI row */}
        <div className="ft-kpis">
          <div className="ft-kpi ft-kpi--info">
            <div className="ft-kpi-label">Выдано</div>
            <div className="ft-kpi-value">{fmtMoney(issued)}</div>
          </div>
          <div className="ft-kpi ft-kpi--err">
            <div className="ft-kpi-label">Потрачено</div>
            <div className="ft-kpi-value">{fmtMoney(spent)}</div>
          </div>
          <div className="ft-kpi ft-kpi--ok">
            <div className="ft-kpi-label">Возвращено</div>
            <div className="ft-kpi-value">{fmtMoney(returned)}</div>
          </div>
          <div className="ft-kpi ft-kpi--gold">
            <div className="ft-kpi-label">Остаток</div>
            <div className="ft-kpi-value">{fmtMoney(remainder)}</div>
          </div>
        </div>

        {ownSpent > 0 && (
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--t-3)' }}>
            Свои средства мастера: <strong>{fmtMoney(ownSpent)}</strong> (подлежат компенсации).
          </div>
        )}

        {/* Операции */}
        <div className="ft-section-title" style={{ marginTop: 16 }}>Операции ({ops.length})</div>
        {ops.length === 0 && (
          <div className="ft-section-sub">Операций ещё нет. Мастер добавляет траты и возвраты из мобильного приложения.</div>
        )}
        {ops.length > 0 && (
          <table className="t-list ft-table" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>Дата</th>
                <th>Тип</th>
                <th>Сумма</th>
                <th>Описание</th>
                <th>Источник</th>
                <th>Чек</th>
              </tr>
            </thead>
            <tbody>
              {ops.map((op, i) => (
                <tr key={`${op.kind}-${op.extra?.id || i}`}>
                  <td>{fmtDate(op.date)}</td>
                  <td>{op.kind === 'expense' ? '💸 Трата' : '↩️ Возврат'}</td>
                  <td><strong style={{ color: op.kind === 'expense' ? 'var(--err)' : 'var(--ok)' }}>{fmtMoney(op.amount)}</strong></td>
                  <td>{op.comment || '—'}</td>
                  <td>
                    {op.kind === 'expense'
                      ? (op.extra?.source === 'own' ? '💳 Свои' : '💰 Аванс')
                      : '—'}
                  </td>
                  <td>
                    {op.kind === 'expense' && op.extra?.receipt_filename
                      ? <a href={`/uploads/receipts/${op.extra.receipt_filename}`} target="_blank" rel="noopener noreferrer">📎</a>
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="ft-section-sub" style={{ marginTop: 12 }}>
          Операции добавляет мастер через мобильное приложение (фото чека обязательно).
          PM закрывает подотчёт после получения остатка в кассу.
        </div>
      </MBody>
      <MFoot align="spread">
        <span style={{ fontSize: 12, color: 'var(--t-3)' }}>
          Статус: <strong>{FUND_STATUS_LABELS[f.status] || f.status}</strong>
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          {f.status !== 'closed' && (
            <Btn variant="warn" onClick={async () => {
              try {
                await closeFund(f.id);
                toast('Закрыт', '', 'ok');
                onChanged?.();
                close();
              } catch (e) {
                toast('Ошибка', String(e?.message || e), 'err');
              }
            }}>Закрыть подотчёт</Btn>
          )}
          <Btn onClick={close}>Готово</Btn>
        </div>
      </MFoot>
    </MCard>
  );
}
