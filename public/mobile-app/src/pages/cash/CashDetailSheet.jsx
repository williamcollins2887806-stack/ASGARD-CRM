import { useState, useEffect, useCallback } from 'react';
import { Check, Camera, Undo2, FileCheck, Trash2 } from 'lucide-react';
import { api } from '@/api/client';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { formatMoney, relativeTime } from '@/lib/utils';
import { useHaptic } from '@/hooks/useHaptic';

const STATUS_MAP = {
  requested:    { label: 'На согласовании', color: 'var(--blue)' },
  approved:     { label: 'Согласовано',     color: 'var(--green)' },
  money_issued: { label: 'Наличные выданы', color: 'var(--gold)' },
  received:     { label: 'Получено',        color: 'var(--green)' },
  reporting:    { label: 'На отчёте',       color: 'var(--gold)' },
  closed:       { label: 'Закрыто',         color: 'var(--green)' },
  rejected:     { label: 'Отклонено',       color: 'var(--red-soft)' },
  question:     { label: 'Вопрос',          color: 'var(--gold)' },
  pending:      { label: 'Ожидает подтв.',  color: 'var(--blue)' },
  partial:      { label: 'Частично',        color: 'var(--gold)' },
  not_received: { label: 'Не получено',     color: 'var(--red-soft)' },
  cancelled:    { label: 'Отменено',        color: 'var(--text-tertiary)' },
};

const EXPENSE_CATEGORIES = [
  { code: 'fuel_service',     icon: '⛽', label: 'ГСМ служ.' },
  { code: 'fuel_personal',    icon: '⛽', label: 'ГСМ личн.' },
  { code: 'taxi',             icon: '🚕', label: 'Такси' },
  { code: 'accommodation',    icon: '🏨', label: 'Проживание' },
  { code: 'food_brigade',     icon: '🍲', label: 'Продукты' },
  { code: 'materials',        icon: '🧱', label: 'Материалы' },
  { code: 'tool',             icon: '🔧', label: 'Инструмент' },
  { code: 'tech_rent',        icon: '🚛', label: 'Аренда тех.' },
  { code: 'communication',    icon: '📞', label: 'Связь' },
  { code: 'representational', icon: '🥂', label: 'Представ.' },
  { code: 'urgent_repair',    icon: '🚨', label: 'Срочный ремонт' },
  { code: 'other',            icon: '📦', label: 'Другое' },
];

const MAX_RECEIPT_BYTES = 25 * 1024 * 1024;

function catMeta(code) {
  return EXPENSE_CATEGORIES.find((c) => c.code === code) || { icon: '📦', label: code || 'Прочее' };
}

function fmtDate(val) {
  if (!val) return '—';
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? String(val) : d.toLocaleDateString('ru-RU');
}

function receiptHref(requestId, filename) {
  const token = api.getToken() || '';
  return `/api/cash/${requestId}/receipt/${encodeURIComponent(filename)}?token=${encodeURIComponent(token)}`;
}

function Hint({ children, tone = 'gold' }) {
  const color = tone === 'green' ? 'var(--green)' : tone === 'red' ? 'var(--red-soft)' : 'var(--gold)';
  return (
    <div
      className="rounded-xl px-3 py-2.5 text-[12px] leading-snug"
      style={{
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        color,
        border: `0.5px solid color-mix(in srgb, ${color} 28%, transparent)`,
      }}
    >
      {children}
    </div>
  );
}

export default function CashDetailSheet({ item, onClose, onConfirm, onChanged }) {
  const haptic = useHaptic();
  const [full, setFull] = useState(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState('detail');
  const isHandover = item?._source === 'handover';

  const load = useCallback(async () => {
    if (!item || isHandover || !item.id) {
      setFull(null);
      return;
    }
    setLoading(true);
    try {
      const d = await api.get(`/cash/${item.id}`);
      setFull(d);
    } catch {
      setFull(null);
    } finally {
      setLoading(false);
    }
  }, [item, isHandover]);

  useEffect(() => {
    setView('detail');
    load();
  }, [load]);

  if (!item) return null;

  const r = full || item;
  const st = STATUS_MAP[r.status] || { label: r.status, color: 'var(--text-tertiary)' };
  const cat = !isHandover && catMeta(r.category);
  const remainder = Number(r.balance?.remainder ?? 0);
  const canAct = !isHandover && ['received', 'reporting'].includes(r.status);
  const canReturn = canAct && remainder > 0;
  const pendingReturns = (r.returns || []).filter((x) => !x.confirmed_at);
  const title = view === 'expense'
    ? 'Чек расхода'
    : view === 'return'
      ? 'Вернуть в кассу'
      : (r.purpose || `Заявка #${r.id}`);

  const fields = isHandover ? [
    { label: 'Тип',          value: 'Передача нала от СЗ' },
    { label: 'Самозанятый',  value: r._h?.worker_fio || `#${r._h?.worker_id}` },
    r._h?.expected_amount != null && { label: 'Ожидалось', value: formatMoney(Number(r._h.expected_amount) || 0) },
    r._h?.received_amount != null && { label: 'Получено',  value: formatMoney(Number(r._h.received_amount) || 0) },
    r._h?.work_title && { label: 'Работа',  value: r._h.work_title },
    r._h?.received_at && { label: 'Передано', value: relativeTime(r._h.received_at) },
    r._h?.received_by_name && { label: 'Подтвердил', value: r._h.received_by_name },
    r.comment && { label: 'Комментарий', value: r.comment, full: true },
  ].filter(Boolean) : [
    { label: 'Назначение',   value: r.purpose || r.description || '—' },
    { label: 'Сумма',        value: formatMoney(r.amount || 0) },
    cat && r.category && { label: 'Категория', value: `${cat.icon} ${cat.label}` },
    r.category === 'other' && r.category_other_desc && { label: 'Описание', value: r.category_other_desc, full: true },
    r.work_title && { label: 'Работа', value: r.work_title },
    r.created_at && { label: 'Создано', value: relativeTime(r.created_at) },
    r.comment && { label: 'Комментарий', value: r.comment, full: true },
    r.cover_letter && { label: 'Пояснительная', value: r.cover_letter, full: true },
  ].filter(Boolean);

  const handleClose = () => {
    if (view !== 'detail') {
      setView('detail');
      return;
    }
    onClose();
  };

  return (
    <BottomSheet open={!!item} onClose={handleClose} title={title} maxHeight="90vh">
      {view === 'expense' ? (
        <ExpenseForm
          requestId={r.id}
          onCancel={() => setView('detail')}
          onSaved={async () => {
            setView('detail');
            await load();
            onChanged?.();
          }}
        />
      ) : view === 'return' ? (
        <ReturnForm
          requestId={r.id}
          remainder={remainder}
          onCancel={() => setView('detail')}
          onSaved={async () => {
            setView('detail');
            await load();
            onChanged?.();
          }}
        />
      ) : (
        <div className="flex flex-col gap-3 pb-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-tertiary)' }}>
              Статус
            </p>
            <span
              className="px-3 py-1.5 rounded-full text-[13px] font-semibold inline-block"
              style={{ background: `color-mix(in srgb, ${st.color} 14%, transparent)`, color: st.color }}
            >
              {st.label}
            </span>
            <span
              className="px-3 py-1.5 rounded-full text-[13px] font-semibold inline-block ml-2"
              style={{
                background: isHandover
                  ? 'color-mix(in srgb, var(--green) 14%, transparent)'
                  : 'color-mix(in srgb, var(--blue) 14%, transparent)',
                color: isHandover ? 'var(--green)' : 'var(--blue)',
              }}
            >
              {isHandover ? '💵 От СЗ' : '🏦 Касса'}
            </span>
          </div>

          {loading && (
            <p className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>Загрузка заявки…</p>
          )}

          <div className="rounded-xl overflow-hidden" style={{ border: '0.5px solid var(--border-norse)' }}>
            {fields.map((f, i) => (
              <div
                key={i}
                className="px-4 py-3"
                style={{
                  background: 'var(--bg-surface)',
                  borderBottom: i < fields.length - 1 ? '0.5px solid var(--border-norse)' : 'none',
                }}
              >
                <p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: 'var(--text-tertiary)' }}>
                  {f.label}
                </p>
                <p className={`text-[14px] ${f.full ? 'whitespace-pre-wrap' : ''}`} style={{ color: 'var(--text-primary)' }}>
                  {f.value}
                </p>
              </div>
            ))}
          </div>

          {!isHandover && r.balance && (
            <Hint tone={remainder > 0 ? 'gold' : 'green'}>
              Выдано {formatMoney(r.balance.approved)} · потрачено {formatMoney(r.balance.spent)} ·
              возвращено {formatMoney(r.balance.returned)} · <b>остаток {formatMoney(remainder)}</b>
            </Hint>
          )}

          {r.status === 'money_issued' && !isHandover && (
            <Hint>
              Сначала подтвердите получение. Пока не подтвердите — чек, отчёт и возврат недоступны, хотя сумма уже на вашем балансе.
            </Hint>
          )}

          {pendingReturns.length > 0 && (
            <Hint>
              Возврат {formatMoney(pendingReturns.reduce((s, x) => s + Number(x.amount || 0), 0))} ждёт подтверждения кассы.
              Пока не подтвердят — с баланса не спишется.
            </Hint>
          )}

          {r.status === 'money_issued' && !isHandover && (
            <button
              onClick={async () => {
                const ok = await onConfirm?.(r.id);
                if (ok !== false) {
                  await load();
                  onChanged?.();
                }
              }}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl font-semibold text-[15px] spring-tap"
              style={{ background: 'color-mix(in srgb, var(--green) 15%, transparent)', color: 'var(--green)' }}
            >
              <Check size={18} />
              Подтвердить получение
            </button>
          )}

          {canAct && (
            <div className="flex flex-col gap-2">
              <button
                onClick={() => { haptic.light(); setView('expense'); }}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl font-semibold text-[15px] spring-tap"
                style={{ background: 'color-mix(in srgb, var(--blue) 15%, transparent)', color: 'var(--blue)' }}
              >
                <Camera size={18} />
                Приложить чек
              </button>
              <button
                onClick={async () => {
                  if (!window.confirm('Подать авансовый отчёт? Директор получит уведомление.')) return;
                  haptic.light();
                  try {
                    await api.put(`/cash/${r.id}/submit-report`);
                    haptic.success();
                    await load();
                    onChanged?.();
                  } catch (e) {
                    haptic.error();
                    window.alert('Ошибка: ' + (e.message || 'не удалось подать отчёт'));
                  }
                }}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl font-semibold text-[14px] spring-tap"
                style={{ background: 'color-mix(in srgb, var(--gold) 14%, transparent)', color: 'var(--gold)' }}
              >
                <FileCheck size={16} />
                Отчитаться
              </button>
              {canReturn && (
                <button
                  onClick={() => { haptic.light(); setView('return'); }}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl font-semibold text-[14px] spring-tap"
                  style={{ background: 'color-mix(in srgb, var(--gold) 14%, transparent)', color: 'var(--gold)' }}
                >
                  <Undo2 size={16} />
                  Вернуть остаток в кассу
                </button>
              )}
            </div>
          )}

          {!isHandover && (r.expenses || []).length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-tertiary)' }}>
                Чеки
              </p>
              <div className="rounded-xl overflow-hidden" style={{ border: '0.5px solid var(--border-norse)' }}>
                {r.expenses.map((e, i) => {
                  const meta = catMeta(e.category);
                  return (
                    <div
                      key={e.id}
                      className="px-4 py-3 flex items-start gap-2"
                      style={{
                        background: 'var(--bg-surface)',
                        borderBottom: i < r.expenses.length - 1 ? '0.5px solid var(--border-norse)' : 'none',
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                          {meta.icon} {e.description || meta.label}
                        </p>
                        <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                          {fmtDate(e.expense_date)} · {formatMoney(e.amount)}
                          {e.receipt_file && (
                            <>
                              {' · '}
                              <a
                                href={receiptHref(r.id, e.receipt_file)}
                                target="_blank"
                                rel="noreferrer"
                                style={{ color: 'var(--gold)' }}
                              >
                                {e.receipt_original_name || 'Чек'}
                              </a>
                            </>
                          )}
                        </p>
                      </div>
                      {canAct && (
                        <button
                          type="button"
                          className="spring-tap p-1"
                          style={{ color: 'var(--red-soft)' }}
                          aria-label="Удалить расход"
                          onClick={async () => {
                            if (!window.confirm('Удалить этот расход?')) return;
                            try {
                              await api.delete(`/cash/${r.id}/expense/${e.id}`);
                              haptic.success();
                              await load();
                              onChanged?.();
                            } catch (err) {
                              haptic.error();
                              window.alert('Ошибка: ' + (err.message || 'не удалось удалить'));
                            }
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {!isHandover && (r.returns || []).length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-tertiary)' }}>
                Возвраты
              </p>
              <div className="rounded-xl overflow-hidden" style={{ border: '0.5px solid var(--border-norse)' }}>
                {r.returns.map((ret, i) => (
                  <div
                    key={ret.id}
                    className="px-4 py-3"
                    style={{
                      background: 'var(--bg-surface)',
                      borderBottom: i < r.returns.length - 1 ? '0.5px solid var(--border-norse)' : 'none',
                    }}
                  >
                    <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {formatMoney(ret.amount)}
                    </p>
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                      {ret.confirmed_at ? `Подтверждён ${fmtDate(ret.confirmed_at)}` : 'Ожидает подтверждения кассы'}
                      {ret.note ? ` · ${ret.note}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </BottomSheet>
  );
}

function ExpenseForm({ requestId, onCancel, onSaved }) {
  const haptic = useHaptic();
  const [category, setCategory] = useState('other');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().slice(0, 10));
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);

  const canSubmit = Number(amount) > 0 && description.trim() && file && !saving;

  const submit = async () => {
    if (!canSubmit) return;
    if (file.size > MAX_RECEIPT_BYTES) {
      window.alert('Файл чека слишком большой (макс. 25 МБ)');
      return;
    }
    haptic.light();
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('amount', String(Number(amount)));
      fd.append('description', description.trim());
      fd.append('category', category);
      fd.append('expense_date', expenseDate);
      fd.append('receipt', file);
      await api.postForm(`/cash/${requestId}/expense`, fd);
      haptic.success();
      onSaved?.();
    } catch (e) {
      haptic.error();
      window.alert('Ошибка: ' + (e.message || 'не удалось сохранить чек'));
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 pb-4">
      <Hint>Сумма спишется с вашего баланса кассы. Без фото чека расход не принимается.</Hint>
      <div>
        <label className="input-label">Категория *</label>
        <div className="grid mt-1" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
          {EXPENSE_CATEGORIES.map((c) => {
            const active = category === c.code;
            return (
              <button
                key={c.code}
                type="button"
                onClick={() => { haptic.light(); setCategory(c.code); }}
                className="spring-tap"
                style={{
                  minHeight: 64,
                  borderRadius: 12,
                  background: active
                    ? 'color-mix(in srgb, var(--gold) 18%, transparent)'
                    : 'color-mix(in srgb, var(--bg-surface) 70%, transparent)',
                  border: active
                    ? '0.5px solid color-mix(in srgb, var(--gold) 40%, var(--border-norse))'
                    : '0.5px solid var(--border-norse)',
                  color: active ? 'var(--gold)' : 'var(--text-secondary)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  padding: 6,
                  fontWeight: active ? 700 : 600,
                  fontSize: 11,
                  lineHeight: 1.1,
                  textAlign: 'center',
                }}
              >
                <span style={{ fontSize: 20 }}>{c.icon}</span>
                <span>{c.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <label className="input-label">Сумма (₽) *</label>
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" className="input-field" />
      </div>
      <div>
        <label className="input-label">За что потрачено *</label>
        <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Описание" className="input-field" />
      </div>
      <div>
        <label className="input-label">Дата</label>
        <input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} className="input-field" />
      </div>
      <div>
        <label className="input-label">Фото чека *</label>
        <input
          type="file"
          accept="image/*,.pdf"
          capture="environment"
          className="input-field"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
        {file && (
          <p className="text-[11px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
            {file.name} ({Math.round(file.size / 1024)} КБ)
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={submit}
        disabled={!canSubmit}
        className="btn-primary spring-tap mt-1"
        style={{ opacity: canSubmit ? 1 : 0.5 }}
      >
        {saving ? 'Загрузка…' : 'Списать с баланса'}
      </button>
      <button type="button" onClick={onCancel} className="text-[13px] font-semibold py-2 spring-tap" style={{ color: 'var(--text-tertiary)' }}>
        Назад к заявке
      </button>
    </div>
  );
}

function ReturnForm({ requestId, remainder, onCancel, onSaved }) {
  const haptic = useHaptic();
  const [amount, setAmount] = useState(String(remainder || ''));
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const amt = Number(amount);
  const canSubmit = amt > 0 && amt <= remainder && !saving;

  const submit = async () => {
    if (!canSubmit) return;
    haptic.light();
    setSaving(true);
    try {
      await api.post(`/cash/${requestId}/return`, { amount: amt, note: note.trim() || null });
      haptic.success();
      onSaved?.();
    } catch (e) {
      haptic.error();
      window.alert('Ошибка: ' + (e.message || 'не удалось оформить возврат'));
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 pb-4">
      <Hint>
        Остаток по заявке: <b>{formatMoney(remainder)}</b>. После отправки возврат должен подтвердить директор или бухгалтерия — до этого сумма ещё на вашем балансе.
      </Hint>
      <div>
        <label className="input-label">Сумма возврата *</label>
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="input-field" />
      </div>
      <div>
        <label className="input-label">Комментарий</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="input-field resize-none" placeholder="Необязательно" />
      </div>
      <button
        type="button"
        onClick={submit}
        disabled={!canSubmit}
        className="btn-primary spring-tap mt-1"
        style={{ opacity: canSubmit ? 1 : 0.5 }}
      >
        {saving ? 'Отправка…' : 'Вернуть в кассу'}
      </button>
      <button type="button" onClick={onCancel} className="text-[13px] font-semibold py-2 spring-tap" style={{ color: 'var(--text-tertiary)' }}>
        Назад к заявке
      </button>
    </div>
  );
}
