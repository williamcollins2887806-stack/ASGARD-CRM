import { useState, useEffect, useMemo } from 'react';
import { Search, X as XIcon } from 'lucide-react';
import { api } from '@/api/client';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { formatMoney } from '@/lib/utils';
import { useHaptic } from '@/hooks/useHaptic';

const EXPENSE_TYPES = [
  { code: 'per_diem', icon: '🌙', label: 'Суточные' },
  { code: 'taxi',     icon: '🚕', label: 'Такси' },
  { code: 'office',   icon: '🏢', label: 'Офис' },
  { code: 'other',    icon: '📦', label: 'Прочее' },
];

function extractList(res) {
  if (Array.isArray(res)) return res;
  if (Array.isArray(res?.employees)) return res.employees;
  if (Array.isArray(res?.works)) return res.works;
  if (Array.isArray(res?.items)) return res.items;
  if (Array.isArray(res?.suggestions)) return res.suggestions;
  return [];
}

export default function QuickExpenseSheet({ open, onClose, onSaved }) {
  const haptic = useHaptic();
  const now = new Date();
  const [expenseType, setExpenseType] = useState('per_diem');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [employee, setEmployee] = useState(null);
  const [empQuery, setEmpQuery] = useState('');
  const [employees, setEmployees] = useState([]);
  const [workId, setWorkId] = useState('');
  const [works, setWorks] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [confirmDup, setConfirmDup] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hint, setHint] = useState('');

  useEffect(() => {
    if (!open) return;
    setExpenseType('per_diem');
    setAmount('');
    setDescription('');
    setEmployee(null);
    setEmpQuery('');
    setWorkId('');
    setConfirmDup(false);
    setHint('');
    (async () => {
      try {
        const [wRes, sRes, eRes] = await Promise.all([
          api.get('/works?limit=2000').catch(() => null),
          api.get(`/cash/per-diem-suggestions?year=${now.getFullYear()}&month=${now.getMonth() + 1}`).catch(() => null),
          api.get('/employees?limit=2000').catch(() => null),
        ]);
        setWorks(extractList(wRes));
        setSuggestions(Array.isArray(sRes?.suggestions) ? sRes.suggestions : extractList(sRes));
        setEmployees(extractList(eRes));
      } catch {
        setWorks([]);
        setSuggestions([]);
        setEmployees([]);
      }
    })();
  }, [open]);

  const empCandidates = useMemo(() => {
    if (employee || empQuery.trim().length < 2) return [];
    const q = empQuery.trim().toLowerCase();
    return employees.filter((e) => {
      const name = String(e.fio || e.full_name || e.name || '').toLowerCase();
      return name.includes(q);
    }).slice(0, 8);
  }, [employee, empQuery, employees]);

  const suggestionForEmployee = useMemo(() => {
    if (!employee) return null;
    const eId = Number(employee.id);
    const wId = workId ? Number(workId) : null;
    return suggestions.find((s) => s.employee_id === eId && (wId == null || s.work_id === wId))
      || suggestions.find((s) => s.employee_id === eId)
      || null;
  }, [employee, workId, suggestions]);

  useEffect(() => {
    if (expenseType !== 'per_diem' || !suggestionForEmployee) return;
    if (!amount && suggestionForEmployee.suggested_amount > 0) {
      setAmount(String(suggestionForEmployee.suggested_amount));
    }
    if (!workId && suggestionForEmployee.work_id) {
      setWorkId(String(suggestionForEmployee.work_id));
    }
  }, [expenseType, suggestionForEmployee]); // eslint-disable-line react-hooks/exhaustive-deps

  const amt = Number(amount);
  const canSubmit = amt > 0
    && (expenseType === 'per_diem' ? !!employee : !!description.trim())
    && !saving;

  const submit = async () => {
    if (!canSubmit) return;
    haptic.light();
    setSaving(true);
    setHint('');
    try {
      const body = {
        expense_type: expenseType,
        amount: amt,
        description: description.trim() || undefined,
        note: description.trim() || undefined,
        confirm_duplicate: confirmDup || undefined,
      };
      if (expenseType === 'per_diem') {
        body.employee_id = Number(employee.id);
        if (workId) body.work_id = Number(workId);
      }
      await api.post('/cash/quick-expense', body);
      haptic.success();
      onClose();
      onSaved?.();
    } catch (e) {
      const dup = e.status === 409 || e.body?.error === 'duplicate_payment' || e.body?.requires_confirmation;
      if (dup) {
        setConfirmDup(true);
        setHint(e.body?.message || e.message || 'Суточные уже выплачены. Нажмите ещё раз, чтобы подтвердить.');
        haptic.error();
        setSaving(false);
        return;
      }
      haptic.error();
      window.alert('Ошибка: ' + (e.message || 'не удалось записать расход'));
      setSaving(false);
    }
  };

  return (
    <BottomSheet open={open} onClose={onClose} title="Добавить расход" maxHeight="90vh">
      <div className="flex flex-col gap-3 pb-4">
        <p className="text-[12px] leading-snug" style={{ color: 'var(--text-secondary)' }}>
          Суточные списываются с вашей кассы сразу. Такси и хознужды — только если есть полученный аванс.
        </p>
        <div>
          <label className="input-label">Тип</label>
          <div className="flex gap-1.5 mt-1">
            {EXPENSE_TYPES.map((t) => (
              <button
                key={t.code}
                type="button"
                onClick={() => {
                  haptic.light();
                  setExpenseType(t.code);
                  setConfirmDup(false);
                  setHint('');
                }}
                className="flex-1 spring-tap"
                style={{
                  padding: '8px 4px',
                  borderRadius: 12,
                  background: expenseType === t.code
                    ? 'color-mix(in srgb, var(--gold) 15%, transparent)'
                    : 'var(--bg-surface)',
                  color: expenseType === t.code ? 'var(--gold)' : 'var(--text-secondary)',
                  border: expenseType === t.code
                    ? '0.5px solid color-mix(in srgb, var(--gold) 30%, var(--border-norse))'
                    : '0.5px solid var(--border-norse)',
                  fontWeight: 600,
                  fontSize: 11,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 2,
                }}
              >
                <span style={{ fontSize: 18 }}>{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {expenseType === 'per_diem' && suggestions.length > 0 && (
          <div>
            <label className="input-label">Из табеля дороги</label>
            <div className="flex flex-col gap-1 mt-1">
              {suggestions.slice(0, 6).map((s) => (
                <button
                  key={`${s.employee_id}-${s.work_id || 'x'}`}
                  type="button"
                  className="text-left rounded-xl px-3 py-2 spring-tap text-[13px]"
                  style={{
                    background: 'var(--bg-surface)',
                    border: '0.5px solid var(--border-norse)',
                    color: 'var(--text-primary)',
                  }}
                  onClick={() => {
                    haptic.light();
                    setEmployee({ id: s.employee_id, fio: s.employee_fio });
                    if (s.work_id) setWorkId(String(s.work_id));
                    setAmount(String(s.suggested_amount || ''));
                    setConfirmDup(false);
                  }}
                >
                  {s.employee_fio}
                  {s.travel_days ? ` · ${s.travel_days} дн.` : ''}
                  {' · '}{formatMoney(s.suggested_amount || 0)}
                </button>
              ))}
            </div>
          </div>
        )}

        {expenseType === 'per_diem' && (
          <div>
            <label className="input-label">Рабочий *</label>
            {employee ? (
              <div
                className="flex items-center justify-between gap-2 mt-1 rounded-xl px-3 py-2"
                style={{ background: 'var(--bg-surface)', border: '0.5px solid var(--border-norse)' }}
              >
                <span className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {employee.fio || employee.full_name || employee.name || `#${employee.id}`}
                </span>
                <button type="button" className="spring-tap p-1" onClick={() => { setEmployee(null); setEmpQuery(''); }}>
                  <XIcon size={16} style={{ color: 'var(--text-tertiary)' }} />
                </button>
              </div>
            ) : (
              <>
                <div className="relative mt-1">
                  <Search size={14} style={{ position: 'absolute', left: 10, top: 14, color: 'var(--text-tertiary)' }} />
                  <input
                    type="text"
                    value={empQuery}
                    onChange={(e) => setEmpQuery(e.target.value)}
                    placeholder="ФИО рабочего…"
                    className="input-field"
                    style={{ paddingLeft: 32 }}
                  />
                </div>
                {empCandidates.length > 0 && (
                  <div className="mt-1 rounded-xl overflow-hidden" style={{ border: '0.5px solid var(--border-norse)' }}>
                    {empCandidates.map((emp) => (
                      <button
                        key={emp.id}
                        type="button"
                        className="w-full text-left spring-tap px-3 py-2 text-[13px]"
                        style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)', borderBottom: '0.5px solid var(--border-norse)' }}
                        onClick={() => {
                          haptic.light();
                          setEmployee(emp);
                          setEmpQuery('');
                          setConfirmDup(false);
                        }}
                      >
                        {emp.fio || emp.full_name || emp.name || `#${emp.id}`}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
            {suggestionForEmployee && (
              <p className="text-[11px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
                По табелю: {suggestionForEmployee.travel_days} дн., уже выплачено {formatMoney(suggestionForEmployee.paid_amount || 0)}
              </p>
            )}
          </div>
        )}

        {expenseType === 'per_diem' && works.length > 0 && (
          <div>
            <label className="input-label">Работа (необязательно)</label>
            <select
              value={workId}
              onChange={(e) => setWorkId(e.target.value)}
              className="input-field"
            >
              <option value="">Без объекта</option>
              {works.slice(0, 400).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.work_title || w.title || `Работа #${w.id}`}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="input-label">Сумма (₽) *</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => { setAmount(e.target.value); setConfirmDup(false); }}
            className="input-field"
          />
        </div>

        {expenseType !== 'per_diem' && (
          <div>
            <label className="input-label">За что потрачено *</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={expenseType === 'taxi' ? 'Такси до офиса' : 'Описание'}
              className="input-field"
            />
          </div>
        )}

        {hint && (
          <p className="text-[12px] leading-snug" style={{ color: 'var(--gold)' }}>{hint}</p>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="btn-primary spring-tap mt-1"
          style={{ opacity: canSubmit ? 1 : 0.5 }}
        >
          {saving ? 'Сохранение…' : (confirmDup ? 'Подтвердить выплату' : 'Списать с кассы')}
        </button>
      </div>
    </BottomSheet>
  );
}
