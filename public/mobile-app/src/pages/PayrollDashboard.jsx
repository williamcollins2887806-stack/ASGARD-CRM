import { useState, useEffect, useCallback } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { useAuthStore } from '@/stores/authStore';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { StatCard, StatRow } from '@/components/shared/StatCard';
import {
  BarChart3, ChevronLeft, ChevronRight, Plus, CheckCircle,
  Wallet, ArrowDownCircle, ArrowUpCircle, Banknote, Users,
} from 'lucide-react';

const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const fmtMoney = (n) => n != null ? Math.round(n).toLocaleString('ru-RU') + ' ₽' : '—';

const OP_TYPE_LABELS = { work_transfer: 'За работу', agreement_transfer: 'По договорённости' };
const STATUS_LABELS = {
  planned: 'Запланировано', transferred: 'Переведено',
  returned: 'Наличные получены', completed: 'Завершено', cancelled: 'Отменено',
};
const STATUS_COLORS = {
  planned: 'var(--text-tertiary)', transferred: 'var(--blue)',
  returned: 'var(--green)', completed: 'var(--green)', cancelled: 'var(--err-t)',
};

export default function PayrollDashboard() {
  const haptic = useHaptic();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [summary, setSummary] = useState(null);
  const [transfers, setTransfers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [seWorkers, setSeWorkers] = useState([]);

  // Create form
  const [formEmpId, setFormEmpId] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formComment, setFormComment] = useState('');
  const [formSaving, setFormSaving] = useState(false);
  const [error, setError] = useState(null);
  const [confirmingId, setConfirmingId] = useState(null);

  const [seLimits, setSeLimits] = useState([]);

  // Редактирование финансовых лимитов (ADMIN/DIRECTOR_GEN)
  const user = useAuthStore((s) => s.user);
  const canEditLimits = user?.role === 'ADMIN' || user?.role === 'DIRECTOR_GEN';
  const [showLimits, setShowLimits] = useState(false);
  const [limMonthly, setLimMonthly] = useState('');
  const [limYearly, setLimYearly] = useState('');
  const [limSaving, setLimSaving] = useState(false);

  const openLimitsEdit = async () => {
    haptic.medium();
    setError(null);
    let cur = { monthly: 350000, yearly: 2400000 };
    try { cur = await api.get('/admin/system/settings/finance-limits'); } catch { /* дефолты */ }
    setLimMonthly(String(Number(cur.monthly) || 350000));
    setLimYearly(String(Number(cur.yearly) || 2400000));
    setShowLimits(true);
  };

  const handleSaveLimits = async () => {
    const monthly = Number(limMonthly);
    const yearly = Number(limYearly);
    if (!Number.isFinite(monthly) || monthly < 0) { setError('Месячный лимит — число ≥ 0'); return; }
    if (!Number.isFinite(yearly) || yearly < 0) { setError('Годовой лимит — число ≥ 0'); return; }
    haptic.medium();
    setLimSaving(true);
    setError(null);
    try {
      await api.put('/admin/system/settings/finance-limits', { monthly, yearly });
      haptic.success();
      setShowLimits(false);
      await fetchData();
    } catch (e) {
      setError(e.message || 'Ошибка сохранения');
      haptic.error();
    } finally {
      setLimSaving(false);
    }
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sum, tr, lim] = await Promise.all([
        api.get(`/payroll-dashboard/summary/${year}/${month}`),
        api.get(`/payroll-dashboard/se-transfers/${year}/${month}`),
        api.get('/payroll-dashboard/self-employed-limits'),
      ]);
      setSummary(sum);
      setTransfers(api.extractRows(tr) || []);
      setSeLimits(api.extractRows(lim) || []);
    } catch (e) {
      setSummary(null);
      setTransfers([]);
      setSeLimits([]);
      setError(e.message || 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const prevMonth = () => {
    haptic.light();
    if (month === 1) { setMonth(12); setYear(y => y - 1); } else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    haptic.light();
    if (month === 12) { setMonth(1); setYear(y => y + 1); } else setMonth(m => m + 1);
  };

  const openCreate = async () => {
    haptic.medium();
    setFormEmpId(''); setFormAmount(''); setFormComment('');
    setError(null);
    try {
      const limits = await api.get('/payroll-dashboard/self-employed-limits');
      setSeWorkers(api.extractRows(limits) || []);
    } catch { setSeWorkers([]); }
    setShowCreate(true);
  };

  const handleCreate = async () => {
    if (!formEmpId || !formAmount) return;
    haptic.medium();
    setFormSaving(true);
    setError(null);
    try {
      await api.post('/payroll-dashboard/se-transfers', {
        employee_id: Number(formEmpId),
        year, month,
        operation_type: 'agreement_transfer',
        transfer_amount: Number(formAmount),
        earned_amount: 0,
        comment: formComment || 'По договорённости',
      });
      haptic.success();
      setShowCreate(false);
      setFormEmpId(''); setFormAmount(''); setFormComment('');
      await fetchData();
    } catch (e) {
      haptic.error();
      setError(e.message);
    } finally {
      setFormSaving(false);
    }
  };

  const handleConfirmReturn = async (id) => {
    haptic.medium();
    setConfirmingId(id);
    try {
      await api.put(`/payroll-dashboard/se-transfers/${id}/confirm-return`);
      haptic.success();
      await fetchData();
    } catch (e) {
      haptic.error();
      setError(e.message);
    } finally {
      setConfirmingId(null);
    }
  };

  return (
    <PageShell title="Финансы персонала">
      <PullToRefresh onRefresh={fetchData}>
        {/* Month selector */}
        <div className="flex items-center justify-between px-1 mb-3">
          <button onClick={prevMonth} className="p-2 spring-tap">
            <ChevronLeft size={20} style={{ color: 'var(--text-primary)' }} />
          </button>
          <p className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            {MONTHS[month - 1]} {year}
          </p>
          <button onClick={nextMonth} className="p-2 spring-tap">
            <ChevronRight size={20} style={{ color: 'var(--text-primary)' }} />
          </button>
        </div>

        {loading ? <SkeletonList count={4} /> : !summary ? (
          <EmptyState icon={BarChart3} iconColor="var(--green)" iconBg="color-mix(in srgb, var(--green) 10%, transparent)"
            title="Нет данных" description="За этот месяц нет данных" />
        ) : (
          <>
            {/* Stats */}
            <StatRow cols={2}>
              <StatCard icon={Wallet}          label="Заработано"  value={fmtMoney(summary.total_earned)}       color="var(--gold)"  delay={0} />
              <StatCard icon={ArrowUpCircle}   label="К переводу"  value={fmtMoney(summary.total_transfer)}     color="var(--blue)"  delay={60} />
            </StatRow>
            <StatRow cols={2}>
              <StatCard icon={Banknote}        label="Из кассы"    value={fmtMoney(summary.total_cash_needed)}  color="var(--warn-t)" delay={120} />
              <StatCard icon={ArrowDownCircle} label="Возврат"     value={fmtMoney(summary.total_cash_return)}  color="var(--green)"  delay={180} />
            </StatRow>

            {/* By mode */}
            {summary.by_mode && (
              <div className="card-glass p-3 mb-3" style={{ animation: 'fadeInUp var(--motion-normal) var(--ease-spring) 240ms both' }}>
                <p className="text-[11px] font-semibold uppercase tracking-wider mb-2 c-tertiary">По типу оплаты</p>
                <div className="flex gap-3">
                  {[
                    { label: 'Самозанятые', value: summary.by_mode.self_employed || 0, color: 'var(--blue)' },
                    { label: 'Официальные', value: summary.by_mode.official || 0, color: 'var(--green)' },
                    { label: 'Наличка', value: summary.by_mode.cash || 0, color: 'var(--warn-t)' },
                  ].map(m => (
                    <div key={m.label} className="flex-1 text-center">
                      <p className="text-lg font-bold" style={{ color: m.color }}>{m.value}</p>
                      <p className="text-[10px] c-tertiary">{m.label}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* SE Transfers */}
            <div className="mb-3" style={{ animation: 'fadeInUp var(--motion-normal) var(--ease-spring) 300ms both' }}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold uppercase tracking-wider c-tertiary">
                  Операции с самозанятыми
                </p>
                <button onClick={openCreate}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium spring-tap"
                  style={{
                    background: 'color-mix(in srgb, var(--blue) 15%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--blue) 35%, transparent)',
                    color: 'var(--blue)',
                  }}>
                  <Plus size={14} /> По договорённости
                </button>
              </div>

              {transfers.length === 0 ? (
                <div className="card-glass p-4 text-center">
                  <p className="text-sm c-secondary">Нет операций за этот месяц</p>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {transfers.map((t, i) => (
                    <div key={t.id || i} className="card-glass px-4 py-3"
                      style={{ animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${360 + i * 40}ms both` }}>
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-[13px] font-semibold c-primary">{t.fio || t.employee_name || '—'}</p>
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                          style={{
                            background: `color-mix(in srgb, ${STATUS_COLORS[t.status] || 'var(--text-tertiary)'} 15%, transparent)`,
                            color: STATUS_COLORS[t.status] || 'var(--text-tertiary)',
                          }}>
                          {STATUS_LABELS[t.status] || t.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] c-secondary">
                        <span>{OP_TYPE_LABELS[t.operation_type] || t.operation_type}</span>
                        <span>Перевод: <b className="c-primary">{fmtMoney(t.transfer_amount)}</b></span>
                        {t.cash_return_amount > 0 && (
                          <span>Возврат: <b className="c-green">{fmtMoney(t.cash_return_amount)}</b></span>
                        )}
                      </div>
                      {t.status === 'transferred' && (
                        <button onClick={() => handleConfirmReturn(t.id)}
                          disabled={confirmingId === t.id}
                          className="mt-2 flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium spring-tap disabled:opacity-50"
                          style={{
                            background: 'color-mix(in srgb, var(--green) 15%, transparent)',
                            border: '1px solid color-mix(in srgb, var(--green) 35%, transparent)',
                            color: 'var(--green)',
                          }}>
                          <CheckCircle size={14} /> Наличные получены
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Yearly limits */}
            {(seLimits.length > 0 || canEditLimits) && (
              <div style={{ animation: 'fadeInUp var(--motion-normal) var(--ease-spring) 400ms both' }}>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold uppercase tracking-wider c-tertiary">
                    Годовые лимиты самозанятых
                  </p>
                  {canEditLimits && (
                    <button onClick={openLimitsEdit}
                      className="text-[11px] font-semibold px-2 py-1 rounded-lg"
                      style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-secondary)' }}>
                      ⚙️ Лимиты
                    </button>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  {seLimits.map((l, i) => {
                    const yearlyLimit = Number(summary?.yearly_limit) || 2400000;
                    const transferred = Number(l.transferred_year) || 0;
                    const remaining = Number(l.remaining) || 0;
                    const pct = yearlyLimit > 0 ? Math.min(100, (transferred / yearlyLimit) * 100) : 0;
                    const danger = remaining < 700000;
                    return (
                      <div key={i} className="card-glass px-4 py-3">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-[13px] font-medium c-primary">{l.fio || '—'}</p>
                          <p className="text-[11px] font-semibold" style={{ color: danger ? 'var(--err-t)' : 'var(--green)' }}>
                            {fmtMoney(remaining)} ост.
                          </p>
                        </div>
                        <div style={{
                          height: 6, borderRadius: 3,
                          background: 'var(--bg-primary)',
                          overflow: 'hidden',
                        }}>
                          <div style={{
                            height: '100%', borderRadius: 3,
                            width: `${pct}%`,
                            background: danger
                              ? 'linear-gradient(90deg, var(--err-t), var(--warn-t))'
                              : 'linear-gradient(90deg, var(--green), var(--blue))',
                            transition: 'width 0.5s ease',
                          }} />
                        </div>
                        <p className="text-[10px] mt-1 c-tertiary">
                          {fmtMoney(transferred)} из {fmtMoney(yearlyLimit)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </PullToRefresh>

      {/* Create agreement transfer BottomSheet */}
      <BottomSheet open={showCreate} onClose={() => setShowCreate(false)} title="Перевод по договорённости">
        <div className="flex flex-col gap-3 pb-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider mb-1 c-tertiary">Рабочий</p>
            <select value={formEmpId} onChange={e => setFormEmpId(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg text-sm"
              style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }}>
              <option value="">Выберите рабочего</option>
              {seWorkers.map(w => (
                <option key={w.id || w.employee_id} value={w.id || w.employee_id}>
                  {w.fio || w.name} — ост. {fmtMoney(w.remaining || 0)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider mb-1 c-tertiary">Сумма перевода</p>
            <input type="number" value={formAmount} onChange={e => setFormAmount(e.target.value)}
              placeholder="350000"
              className="w-full px-3 py-2.5 rounded-lg text-sm"
              style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }} />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider mb-1 c-tertiary">Комментарий</p>
            <input type="text" value={formComment} onChange={e => setFormComment(e.target.value)}
              placeholder="По договорённости"
              className="w-full px-3 py-2.5 rounded-lg text-sm"
              style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }} />
          </div>
          <button onClick={handleCreate} disabled={formSaving || !formEmpId || !formAmount}
            className="w-full py-3 rounded-xl font-semibold text-sm disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, var(--blue), var(--info))', color: '#fff' }}>
            {formSaving ? 'Создаю...' : '📨 Создать перевод'}
          </button>
        </div>
      </BottomSheet>

      {/* Edit finance limits BottomSheet (ADMIN/DIRECTOR_GEN) */}
      <BottomSheet open={showLimits} onClose={() => setShowLimits(false)} title="Финансовые лимиты самозанятых">
        <div className="flex flex-col gap-3 pb-4">
          {error && showLimits && (
            <div className="text-[12px] px-3 py-2 rounded-lg" style={{ backgroundColor: 'var(--err-bg)', color: 'var(--err-t)' }}>{error}</div>
          )}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider mb-1 c-tertiary">Месячный лимит на самозанятого (₽)</p>
            <input type="number" min="0" step="1000" value={limMonthly} onChange={e => setLimMonthly(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg text-sm"
              style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }} />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider mb-1 c-tertiary">Годовой лимит на самозанятого (₽)</p>
            <input type="number" min="0" step="10000" value={limYearly} onChange={e => setLimYearly(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg text-sm"
              style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }} />
          </div>
          <p className="text-[10px] c-tertiary">Применяется ко всем самозанятым при расчёте остатка лимита.</p>
          <button onClick={handleSaveLimits} disabled={limSaving}
            className="w-full py-3 rounded-xl font-semibold text-sm disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, var(--green), var(--blue))', color: '#fff' }}>
            {limSaving ? 'Сохраняю...' : '💾 Сохранить'}
          </button>
        </div>
      </BottomSheet>
    </PageShell>
  );
}
