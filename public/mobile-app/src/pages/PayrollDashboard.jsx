import { useState, useEffect, useCallback, useMemo } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { useAuthStore } from '@/stores/authStore';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { StatCard, StatRow } from '@/components/shared/StatCard';
import { PaymentBreakdown } from '@/components/shared/PaymentBreakdown';
import { formatMoney as fmtMoneyShort } from '@/lib/utils';
import {
  BarChart3, ChevronLeft, ChevronRight, Plus, CheckCircle,
  Wallet, ArrowDownCircle, ArrowUpCircle, Banknote, Users,
  Rocket, AlertCircle, Check as CheckIcon,
} from 'lucide-react';

const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const fmtMoney = (n) => n != null ? Math.round(n).toLocaleString('ru-RU') + ' ₽' : '—';

// Лимит строк в bulk-операции на мобиле (совпадает с серверным лимитом 100).
const MOBILE_BULK_LIMIT = 100;

const BULK_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'BUH'];

const OP_TYPE_LABELS = { work_transfer: 'За работу', agreement_transfer: 'По договорённости' };
const STATUS_LABELS = {
  planned: 'Запланировано', transferred: 'Переведено',
  returned: 'Наличные получены', completed: 'Завершено', cancelled: 'Отменено',
};
const STATUS_COLORS = {
  planned: 'var(--text-tertiary)', transferred: 'var(--blue)',
  returned: 'var(--green)', completed: 'var(--green)', cancelled: 'var(--err-t)',
};

const PAY_TYPE_LABELS = { self_employed: 'Самозанятый', official: 'Официальный', cash: 'Наличка' };
const PAY_TYPE_COLORS = { self_employed: 'var(--blue)', official: 'var(--gold)', cash: 'var(--warn-t)' };
const CC_TABS = [
  { key: 'all', label: 'Все' },
  { key: 'self_employed', label: 'Самозанятые' },
  { key: 'official', label: 'Официальные' },
  { key: 'cash', label: 'Наличка' },
];

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

  // Расчёт кассы (4 вкладки)
  const [cashCalc, setCashCalc] = useState(null);
  const [ccTab, setCcTab] = useState('all');

  // Разбивка выплат по источникам (новая фича)
  // Маппинг по employee_id → { pm_cash, company_bank, company_se, auto_fot, total_paid, total_accrued, remaining }
  const [payoutsBySource, setPayoutsBySource] = useState({});
  const [breakdownWorker, setBreakdownWorker] = useState(null); // { employee_id, fio } | null

  // Редактирование финансовых лимитов (ADMIN/DIRECTOR_GEN)
  const user = useAuthStore((s) => s.user);
  const canEditLimits = user?.role === 'ADMIN' || user?.role === 'DIRECTOR_GEN';
  const canBulkSe = !!user?.role && BULK_ROLES.includes(user.role);
  const [showBulk, setShowBulk] = useState(false);
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
      // Период month/year → from/to для /payouts-by-source (server принимает обе формы,
      // мы шлём from/to чтобы попадать в общий контракт `/api/payroll-dashboard/payouts-by-source`)
      const from = `${year}-${String(month).padStart(2, '0')}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

      const [sum, tr, lim, cc, pbs] = await Promise.all([
        api.get(`/payroll-dashboard/summary/${year}/${month}`),
        api.get(`/payroll-dashboard/se-transfers/${year}/${month}`),
        api.get('/payroll-dashboard/self-employed-limits'),
        api.get(`/payroll-dashboard/cash-calc/${year}/${month}`).catch(() => null),
        api.get(`/payroll-dashboard/payouts-by-source?from=${from}&to=${to}`).catch(() => null),
      ]);
      setSummary(sum);
      setTransfers(api.extractRows(tr) || []);
      setSeLimits(api.extractRows(lim) || []);
      setCashCalc(cc);

      // Маппинг по employee_id для быстрого доступа в рендере карточек.
      // Бэкенд может вернуть { items: [...] } или { rows: [...] } или массив — нормализуем.
      const rows = api.extractRows(pbs) || [];
      const map = {};
      for (const r of rows) {
        const id = Number(r.employee_id || r.id);
        if (!id) continue;
        const pmCash = (Number(r.pm_cash) || 0) + (Number(r.pm_cash_legacy) || 0);
        map[id] = {
          pm_cash:      pmCash,
          company_bank: Number(r.company_bank) || 0,
          company_se:   Number(r.company_se)   || 0,
          auto_fot:     Number(r.auto_fot)     || 0,
          total_paid:   Number(r.total_paid    ?? (pmCash + (Number(r.company_bank) || 0) + (Number(r.company_se) || 0) + (Number(r.auto_fot) || 0))),
          total_accrued: Number(r.total_accrued) || 0,
          remaining:    Number(r.remaining)    || 0,
        };
      }
      setPayoutsBySource(map);
    } catch (e) {
      setSummary(null);
      setTransfers([]);
      setSeLimits([]);
      setCashCalc(null);
      setPayoutsBySource({});
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

            {/* Расчёт кассы (4 вкладки) */}
            {(() => {
              const items = (cashCalc && cashCalc.items) ? cashCalc.items : [];
              const list = ccTab === 'all' ? items : items.filter(i => i.pay_type === ccTab);
              const sum = list.reduce((a, i) => ({
                earned: a.earned + (i.earned || 0), transfer: a.transfer + (i.transfer || 0),
                cash_return: a.cash_return + (i.cash_return || 0), cash_payout: a.cash_payout + (i.cash_payout || 0),
              }), { earned: 0, transfer: 0, cash_return: 0, cash_payout: 0 });
              const netCash = sum.cash_return - sum.cash_payout;
              return (
                <div className="mb-3" style={{ animation: 'fadeInUp var(--motion-normal) var(--ease-spring) 260ms both' }}>
                  <p className="text-xs font-semibold uppercase tracking-wider c-tertiary mb-2">Расчёт кассы</p>
                  <div className="flex gap-1.5 mb-2 overflow-x-auto no-scrollbar">
                    {CC_TABS.map(t => (
                      <button key={t.key} onClick={() => { haptic.light(); setCcTab(t.key); }}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap spring-tap"
                        style={ccTab === t.key
                          ? { background: 'var(--blue)', color: 'var(--text-on-accent)' }
                          : { backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-secondary)' }}>
                        {t.label}
                      </button>
                    ))}
                  </div>
                  {list.length === 0 ? (
                    <div className="card-glass p-4 text-center">
                      <p className="text-sm c-secondary">Нет данных за этот месяц</p>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-col gap-1.5">
                        {list.map((i, idx) => {
                          const src = payoutsBySource[Number(i.employee_id)] || null;
                          const owe = src ? Math.max(0, Number(src.remaining) || 0) : 0;
                          return (
                            <button
                              key={i.employee_id || idx}
                              type="button"
                              onClick={() => {
                                haptic.light();
                                setBreakdownWorker({ employee_id: i.employee_id, fio: i.fio });
                              }}
                              className="card-glass px-4 py-3 spring-tap text-left w-full"
                              style={{ minHeight: 44 }}
                            >
                              <div className="flex items-center justify-between mb-1">
                                <p className="text-[13px] font-semibold c-primary">{i.fio || '—'}</p>
                                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                                  style={{
                                    background: `color-mix(in srgb, ${PAY_TYPE_COLORS[i.pay_type] || 'var(--text-tertiary)'} 15%, transparent)`,
                                    color: PAY_TYPE_COLORS[i.pay_type] || 'var(--text-tertiary)',
                                  }}>
                                  {PAY_TYPE_LABELS[i.pay_type] || i.pay_type}
                                </span>
                              </div>
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] c-secondary">
                                <span>Заработал: <b className="c-primary">{fmtMoney(i.earned)}</b></span>
                                <span>Переводим: <b className="c-primary">{fmtMoney(i.transfer)}</b></span>
                                {i.cash_return > 0 && <span>Возврат: <b className="c-green">{fmtMoney(i.cash_return)}</b></span>}
                                {i.cash_payout > 0 && <span>Из кассы: <b style={{ color: 'var(--warn-t)' }}>{fmtMoney(i.cash_payout)}</b></span>}
                              </div>

                              {/* Источники выплат (3 колонки + К доплате) */}
                              <div
                                className="grid grid-cols-4 gap-1.5 mt-2 pt-2"
                                style={{ borderTop: '0.5px dashed var(--border-norse)' }}
                              >
                                <SourceCell
                                  icon="📤" label="Касса РП"
                                  value={src ? src.pm_cash : null}
                                  color="var(--green)"
                                />
                                <SourceCell
                                  icon="🏦" label="Банк"
                                  value={src ? src.company_bank : null}
                                  color="var(--blue)"
                                />
                                <SourceCell
                                  icon="📱" label="СЗ-серв."
                                  value={src ? src.company_se : null}
                                  color="var(--purple)"
                                />
                                <SourceCell
                                  icon="⚠" label="К доплате"
                                  value={owe > 0 ? owe : (src ? 0 : null)}
                                  color={owe > 0 ? 'var(--orange)' : 'var(--green)'}
                                  emptyAsZero={!!src && owe === 0}
                                />
                              </div>
                            </button>
                          );
                        })}
                      </div>
                      <div className="card-glass px-4 py-3 mt-1.5" style={{ background: 'color-mix(in srgb, var(--blue) 8%, transparent)' }}>
                        <div className="flex items-center justify-between">
                          <p className="text-[12px] font-semibold c-primary">ИТОГО В КАССЕ</p>
                          <p className="text-[15px] font-bold" style={{ color: netCash >= 0 ? 'var(--green)' : 'var(--err-t)' }}>
                            {fmtMoney(netCash)}
                          </p>
                        </div>
                        <p className="text-[10px] c-tertiary mt-0.5">возврат {fmtMoney(sum.cash_return)} − выдача {fmtMoney(sum.cash_payout)}</p>
                      </div>
                    </>
                  )}
                </div>
              );
            })()}

            {/* SE Transfers */}
            <div className="mb-3" style={{ animation: 'fadeInUp var(--motion-normal) var(--ease-spring) 300ms both' }}>
              <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                <p className="text-xs font-semibold uppercase tracking-wider c-tertiary">
                  Операции с самозанятыми
                </p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {canBulkSe && (
                    <button onClick={() => { haptic.medium(); setShowBulk(true); }}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold spring-tap"
                      style={{
                        background: 'linear-gradient(135deg, var(--gold), var(--warn-t))',
                        border: '1px solid color-mix(in srgb, var(--gold) 35%, transparent)',
                        color: 'var(--text-on-gold)',
                      }}>
                      <Rocket size={14} /> Массовая выплата
                    </button>
                  )}
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
            style={{ background: 'linear-gradient(135deg, var(--blue), var(--info))', color: 'var(--text-on-accent)' }}>
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
            style={{ background: 'linear-gradient(135deg, var(--green), var(--blue))', color: 'var(--text-on-accent)' }}>
            {limSaving ? 'Сохраняю...' : '💾 Сохранить'}
          </button>
        </div>
      </BottomSheet>

      {/* Bulk SE Transfer BottomSheet (BUH/DIRECTOR/ADMIN) */}
      <BulkSeTransferSheet
        open={showBulk}
        onClose={() => setShowBulk(false)}
        year={year}
        month={month}
        seWorkers={seLimits}
        cashCalc={cashCalc}
        yearlyLimit={Number(summary?.yearly_limit) || 2400000}
        onCreated={fetchData}
      />

      {/* Разбивка выплат работника по источникам */}
      <PaymentBreakdown
        open={!!breakdownWorker}
        onClose={() => setBreakdownWorker(null)}
        worker={breakdownWorker}
        params={(() => {
          const from = `${year}-${String(month).padStart(2, '0')}-01`;
          const lastDay = new Date(year, month, 0).getDate();
          const to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
          return { from, to };
        })()}
      />
    </PageShell>
  );
}

/**
 * SourceCell — мини-колонка в строке работника. Если value=null → «—»
 * (нет данных по источнику). Если value=0 + emptyAsZero=true → «0».
 */
function SourceCell({ icon, label, value, color, emptyAsZero }) {
  const show = value == null
    ? '—'
    : (value === 0 && !emptyAsZero ? '—' : fmtMoney(value));
  const isEmpty = show === '—';
  return (
    <div
      className="rounded-md px-1.5 py-1 text-center"
      style={{
        background: isEmpty
          ? 'transparent'
          : `color-mix(in srgb, ${color} 10%, var(--bg-surface))`,
        border: '0.5px solid var(--border-norse)',
      }}
    >
      <div className="text-[9px] uppercase tracking-wide leading-none" style={{ color: 'var(--text-tertiary)' }}>
        <span style={{ marginRight: 2 }}>{icon}</span>{label}
      </div>
      <div
        className="text-[11px] font-bold mt-0.5 leading-none truncate"
        style={{ color: isEmpty ? 'var(--text-tertiary)' : color }}
      >
        {isEmpty ? '—' : fmtMoneyShort(value, { short: true })}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   BulkSeTransferSheet — массовая выдача СЗ-переводов.
   Mobile UX: accordion-список (1 СЗ развёрнут за раз) + Назад/Далее.
   Лимит MOBILE_BULK_LIMIT строк на мобиле — больше неудобно.

   Поток:
     Шаг 1 «Выбор» — чекбоксы СЗ
     Шаг 2 «Настройка» — для каждого выбранного СЗ заполняем тип/суммы/работу/куда остаток
     Шаг 3 «Превью + Submit» — Σ-цифры + кнопка
   ══════════════════════════════════════════════════════════════ */
function BulkSeTransferSheet({ open, onClose, year, month, seWorkers, cashCalc, yearlyLimit, onCreated }) {
  const haptic = useHaptic();

  const [step, setStep] = useState(1);        // 1=select, 2=configure, 3=preview
  const [selected, setSelected] = useState({}); // { [empId]: true }
  const [rows, setRows] = useState([]);         // configured items
  const [accordionIdx, setAccordionIdx] = useState(0);
  const [works, setWorks] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  // Reset при открытии/закрытии
  useEffect(() => {
    if (!open) {
      setStep(1); setSelected({}); setRows([]); setAccordionIdx(0);
      setSaving(false); setError(null); setResult(null);
    }
  }, [open]);

  // Загрузка работ (для select работы в строке)
  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const res = await api.get('/works');
        const list = api.extractRows(res) || [];
        setWorks(list.slice(0, 200));
      } catch { setWorks([]); }
    })();
  }, [open]);

  // helper: earned для (emp, work) из cashCalc
  const lookupEarned = (empId) => {
    if (!cashCalc?.items) return 0;
    const row = cashCalc.items.find((i) => Number(i.employee_id) === Number(empId));
    return Number(row?.earned) || 0;
  };

  const goToConfigure = () => {
    const ids = Object.keys(selected).filter((id) => selected[id]).map(Number);
    if (ids.length === 0) { setError('Выберите хотя бы одного СЗ'); return; }
    if (ids.length > MOBILE_BULK_LIMIT) {
      setError(`На мобиле максимум ${MOBILE_BULK_LIMIT} строк за раз`);
      return;
    }
    setError(null);
    const next = ids.map((empId) => {
      const w = (seWorkers || []).find((x) => Number(x.id || x.employee_id) === empId) || {};
      const earned = lookupEarned(empId);
      return {
        employee_id: empId,
        fio: w.fio || w.name || `#${empId}`,
        remaining: Number(w.remaining) || 0,
        operation_type: 'work_transfer',
        transfer_amount: 350000,
        earned_amount: earned,
        remainder_destination: 'pm',
        work_id: '',
        comment: '',
      };
    });
    setRows(next);
    setAccordionIdx(0);
    setStep(2);
    haptic.medium();
  };

  const updateRow = (idx, patch) => {
    setRows((prev) => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
  };

  const validateRow = (r) => {
    if (!r.transfer_amount || Number(r.transfer_amount) <= 0) return 'Сумма перевода обязательна';
    if (r.operation_type === 'work_transfer') {
      if (!r.earned_amount || Number(r.earned_amount) <= 0) return 'Заработано обязательно для «За работу»';
      if (!r.work_id) return 'Выберите работу';
    }
    if (r.operation_type === 'agreement_transfer' && Number(r.earned_amount) !== 0) {
      return '«По договорённости» = earned должен быть 0';
    }
    if (r.remainder_destination === 'pm' && !r.work_id) {
      // pm-id берётся из work, без work_id мы не сможем направить остаток РП
      return 'Для остатка → РП нужна привязка к работе';
    }
    const remaining = Number(r.transfer_amount) - Number(r.earned_amount || 0);
    if (remaining < 0) return 'Заработано не может быть > перевода';
    if (yearlyLimit && Number(r.remaining) > 0 && Number(r.transfer_amount) > Number(r.remaining)) {
      return `Превышает остаток лимита (${fmtMoney(r.remaining)})`;
    }
    return null;
  };

  const allValid = useMemo(() => rows.length > 0 && rows.every((r) => !validateRow(r)), [rows, yearlyLimit]);

  const summary = useMemo(() => {
    const s = { transfer: 0, earned: 0, remainder_pm: 0, remainder_company: 0 };
    rows.forEach((r) => {
      const t = Number(r.transfer_amount) || 0;
      const e = Number(r.earned_amount) || 0;
      const rem = Math.max(0, t - e);
      s.transfer += t;
      s.earned += e;
      if (r.remainder_destination === 'pm') s.remainder_pm += rem;
      else s.remainder_company += rem;
    });
    return s;
  }, [rows]);

  const handleSubmit = async () => {
    setError(null);
    if (!allValid) { setError('Проверьте строки — есть ошибки'); return; }
    haptic.medium();
    setSaving(true);
    try {
      const payload = {
        year, month,
        transfers: rows.map((r) => ({
          employee_id: r.employee_id,
          work_id: r.work_id ? Number(r.work_id) : null,
          operation_type: r.operation_type,
          transfer_amount: Number(r.transfer_amount),
          earned_amount: r.operation_type === 'work_transfer' ? Number(r.earned_amount) : 0,
          remainder_destination: r.remainder_destination,
          comment: r.comment || null,
        })),
      };
      const res = await api.post('/payroll-dashboard/se-transfers/bulk', payload);
      haptic.success();
      setResult(res);
      onCreated();
    } catch (e) {
      haptic.error();
      setError(e.message || 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const selectedCount = Object.values(selected).filter(Boolean).length;

  return (
    <BottomSheet open={open} onClose={onClose} title={`🚀 Массовая выплата СЗ · шаг ${step}/3`}>
      <div className="flex flex-col gap-3 pb-4">
        {error && (
          <div className="text-[12px] px-3 py-2 rounded-lg flex items-start gap-2"
            style={{ backgroundColor: 'var(--err-bg)', color: 'var(--err-t)' }}>
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {result && (
          <div className="flex flex-col gap-3">
            <div className="text-center py-4">
              <div className="text-[40px]">✅</div>
              <p className="text-[15px] font-semibold mt-1 c-primary">Готово</p>
              <p className="text-[12px] c-tertiary mt-0.5">batch_id: {result.batch_id?.slice(0, 8)}...</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <ResultCell label="СЗ-переводов" value={result.summary?.se_transfers || 0} color="var(--blue)" />
              <ResultCell label="Handover (pending)" value={result.summary?.handovers || 0} color="var(--green)" />
              <ResultCell label="Σ перевод" value={fmtMoney(result.summary?.total_transferred)} color="var(--gold)" />
              <ResultCell label="Σ остаток РП" value={fmtMoney(result.summary?.total_remainder_to_pm)} color="var(--green)" />
            </div>
            {Array.isArray(result.errors) && result.errors.length > 0 && (
              <div className="rounded-lg p-3"
                style={{ background: 'color-mix(in srgb, var(--err-t) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--err-t) 25%, transparent)' }}>
                <p className="text-[12px] font-semibold mb-1" style={{ color: 'var(--err-t)' }}>
                  Ошибок: {result.errors.length}
                </p>
                <div className="flex flex-col gap-1">
                  {result.errors.slice(0, 5).map((e, i) => (
                    <p key={i} className="text-[11px] c-secondary">
                      • строка {(e.index ?? 0) + 1} (СЗ #{e.employee_id}): {e.error}
                    </p>
                  ))}
                  {result.errors.length > 5 && (
                    <p className="text-[11px] c-tertiary">…и ещё {result.errors.length - 5}</p>
                  )}
                </div>
              </div>
            )}
            <button onClick={onClose}
              className="w-full py-3 rounded-xl font-semibold text-sm"
              style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-norse)' }}>
              Закрыть
            </button>
          </div>
        )}

        {!result && step === 1 && (
          <>
            <p className="text-[12px] c-secondary">
              Выберите СЗ для массовой выплаты за {MONTHS[month - 1]} {year}.
              Максимум {MOBILE_BULK_LIMIT} строк.
            </p>
            <div className="flex flex-col gap-1.5 max-h-[50vh] overflow-y-auto">
              {(seWorkers || []).length === 0 && (
                <p className="text-[12px] c-tertiary text-center py-4">
                  Нет данных по СЗ за месяц. Откройте «Финансы персонала» с другим периодом.
                </p>
              )}
              {(seWorkers || []).map((w) => {
                const id = Number(w.id || w.employee_id);
                const active = !!selected[id];
                const danger = Number(w.remaining) < 700000;
                return (
                  <label key={id}
                    className="flex items-center gap-2 spring-tap"
                    style={{
                      padding: '10px 12px', borderRadius: 10,
                      background: active ? 'color-mix(in srgb, var(--gold) 10%, var(--bg-surface))' : 'var(--bg-surface)',
                      border: active
                        ? '0.5px solid color-mix(in srgb, var(--gold) 35%, var(--border-norse))'
                        : '0.5px solid var(--border-norse)',
                      cursor: 'pointer',
                    }}>
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={(e) => { haptic.light(); setSelected((p) => ({ ...p, [id]: e.target.checked })); }}
                      style={{ width: 18, height: 18, accentColor: 'var(--gold)' }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold truncate c-primary">{w.fio || w.name || `#${id}`}</p>
                      <p className="text-[11px]" style={{ color: danger ? 'var(--err-t)' : 'var(--text-tertiary)' }}>
                        Остаток лимита: {fmtMoney(Number(w.remaining) || 0)}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className="text-[12px] c-secondary">Выбрано: <b className="c-primary">{selectedCount}</b></span>
              <button onClick={goToConfigure}
                disabled={selectedCount === 0}
                className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 flex items-center gap-1"
                style={{ background: 'linear-gradient(135deg, var(--blue), var(--info))', color: 'var(--text-on-accent)' }}>
                Далее <ChevronRight size={16} />
              </button>
            </div>
          </>
        )}

        {!result && step === 2 && rows.length > 0 && (
          <>
            <p className="text-[12px] c-secondary">
              СЗ {accordionIdx + 1} из {rows.length}. Заполните и переходите к следующему.
            </p>

            {/* Accordion-tabs (mini-pagination) */}
            <div className="flex gap-1 overflow-x-auto no-scrollbar">
              {rows.map((r, i) => {
                const err = validateRow(r);
                const isCur = i === accordionIdx;
                return (
                  <button key={r.employee_id}
                    onClick={() => { haptic.light(); setAccordionIdx(i); }}
                    className="shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-semibold spring-tap flex items-center gap-1"
                    style={{
                      background: isCur ? 'var(--blue)' : 'var(--bg-surface)',
                      color: isCur ? 'var(--text-on-accent)' : (err ? 'var(--err-t)' : 'var(--text-secondary)'),
                      border: '0.5px solid var(--border-norse)',
                    }}>
                    {err ? <AlertCircle size={11} /> : <CheckIcon size={11} />}
                    {i + 1}
                  </button>
                );
              })}
            </div>

            {/* Текущая строка — полная форма */}
            <RowForm
              row={rows[accordionIdx]}
              works={works}
              error={validateRow(rows[accordionIdx])}
              onChange={(patch) => updateRow(accordionIdx, patch)}
            />

            {/* Навигация Назад/Далее */}
            <div className="flex items-center justify-between mt-1 gap-2">
              <button onClick={() => { haptic.light(); setStep(1); }}
                className="px-3 py-2 rounded-lg text-xs font-medium"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-norse)', color: 'var(--text-secondary)' }}>
                ← Назад к списку
              </button>
              <div className="flex gap-1.5">
                <button onClick={() => { haptic.light(); setAccordionIdx((i) => Math.max(0, i - 1)); }}
                  disabled={accordionIdx === 0}
                  className="px-3 py-2 rounded-lg text-xs font-medium disabled:opacity-40"
                  style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }}>
                  ← Пред.
                </button>
                {accordionIdx < rows.length - 1 ? (
                  <button onClick={() => { haptic.light(); setAccordionIdx((i) => Math.min(rows.length - 1, i + 1)); }}
                    className="px-3 py-2 rounded-lg text-xs font-semibold"
                    style={{ background: 'linear-gradient(135deg, var(--blue), var(--info))', color: 'var(--text-on-accent)' }}>
                    След. →
                  </button>
                ) : (
                  <button onClick={() => { haptic.medium(); setStep(3); }}
                    disabled={!allValid}
                    className="px-3 py-2 rounded-lg text-xs font-semibold disabled:opacity-40"
                    style={{ background: 'linear-gradient(135deg, var(--green), var(--blue))', color: 'var(--text-on-accent)' }}>
                    К превью →
                  </button>
                )}
              </div>
            </div>
          </>
        )}

        {!result && step === 3 && (
          <>
            <p className="text-[12px] c-secondary">
              Проверьте сводку и подтвердите. После отправки операции записываются сразу.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <ResultCell label="Строк" value={rows.length} color="var(--text-primary)" />
              <ResultCell label="Σ перевод" value={fmtMoney(summary.transfer)} color="var(--blue)" />
              <ResultCell label="Σ заработано" value={fmtMoney(summary.earned)} color="var(--gold)" />
              <ResultCell label="Σ остаток" value={fmtMoney(summary.remainder_pm + summary.remainder_company)} color="var(--green)" />
              <ResultCell label="→ РП" value={fmtMoney(summary.remainder_pm)} color="var(--green)" />
              <ResultCell label="→ Касса" value={fmtMoney(summary.remainder_company)} color="var(--warn-t)" />
            </div>

            <div className="flex flex-col gap-1 mt-1 max-h-[30vh] overflow-y-auto">
              {rows.map((r, i) => (
                <div key={r.employee_id} className="card-glass px-3 py-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[12px] font-semibold c-primary truncate">{i + 1}. {r.fio}</p>
                    <p className="text-[12px] font-bold" style={{ color: 'var(--blue)' }}>{fmtMoney(r.transfer_amount)}</p>
                  </div>
                  <p className="text-[10px] c-tertiary">
                    {r.operation_type === 'work_transfer' ? 'За работу' : 'По договорённости'}
                    {' · '}остаток → {r.remainder_destination === 'pm' ? 'РП' : 'Касса'}
                  </p>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between mt-1 gap-2">
              <button onClick={() => { haptic.light(); setStep(2); }}
                className="px-3 py-2 rounded-lg text-xs font-medium"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-norse)', color: 'var(--text-secondary)' }}>
                ← Назад к настройке
              </button>
              <button onClick={handleSubmit} disabled={saving || !allValid}
                className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 flex items-center gap-1"
                style={{ background: 'linear-gradient(135deg, var(--green), var(--blue))', color: 'var(--text-on-accent)' }}>
                <Rocket size={14} />
                {saving ? 'Отправляю...' : `Создать ${rows.length} перевод(ов)`}
              </button>
            </div>
          </>
        )}
      </div>
    </BottomSheet>
  );
}

function ResultCell({ label, value, color }) {
  return (
    <div className="rounded-lg px-3 py-2"
      style={{ background: 'var(--bg-surface)', border: '0.5px solid var(--border-norse)' }}>
      <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>{label}</p>
      <p className="text-[14px] font-bold mt-0.5" style={{ color }}>{value}</p>
    </div>
  );
}

function RowForm({ row, works, error, onChange }) {
  const r = row;
  const isWork = r.operation_type === 'work_transfer';
  const remainder = Math.max(0, Number(r.transfer_amount || 0) - Number(r.earned_amount || 0));
  return (
    <div className="flex flex-col gap-2 rounded-xl p-3"
      style={{ background: 'var(--bg-surface)', border: '0.5px solid var(--border-norse)' }}>
      <div>
        <p className="text-[13px] font-bold c-primary">{r.fio}</p>
        <p className="text-[10px] c-tertiary">
          Остаток годового лимита: {fmtMoney(r.remaining)}
        </p>
      </div>

      {/* operation_type */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider mb-1 c-tertiary">Тип</p>
        <div className="flex gap-1.5">
          {[
            { code: 'work_transfer',     label: '💼 За работу' },
            { code: 'agreement_transfer', label: '🤝 По договорённости' },
          ].map((t) => (
            <button key={t.code}
              onClick={() => onChange({
                operation_type: t.code,
                earned_amount: t.code === 'work_transfer' ? r.earned_amount : 0,
              })}
              className="flex-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold spring-tap"
              style={{
                background: r.operation_type === t.code
                  ? 'color-mix(in srgb, var(--blue) 18%, transparent)'
                  : 'var(--bg-primary)',
                color: r.operation_type === t.code ? 'var(--blue)' : 'var(--text-secondary)',
                border: '0.5px solid var(--border-norse)',
              }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* transfer_amount */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider mb-1 c-tertiary">Перевод (₽) *</p>
        <input
          type="number" inputMode="numeric" value={r.transfer_amount}
          onChange={(e) => onChange({ transfer_amount: e.target.value })}
          className="input-field"
          placeholder="350000"
        />
      </div>

      {/* earned_amount (только для work_transfer) */}
      {isWork && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider mb-1 c-tertiary">Заработал (₽) *</p>
          <input
            type="number" inputMode="numeric" value={r.earned_amount}
            onChange={(e) => onChange({ earned_amount: e.target.value })}
            className="input-field"
            placeholder="71000"
          />
          <p className="text-[10px] c-tertiary mt-0.5">Автозаполнено из расчёта кассы. Можно править.</p>
        </div>
      )}

      {/* work_id */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider mb-1 c-tertiary">
          Работа {r.remainder_destination === 'pm' ? '*' : '(опц.)'}
        </p>
        <select
          value={r.work_id}
          onChange={(e) => onChange({ work_id: e.target.value })}
          className="input-field"
        >
          <option value="">— Без привязки —</option>
          {works.map((w) => (
            <option key={w.id} value={w.id}>
              {w.work_title || w.title || `Работа #${w.id}`}
            </option>
          ))}
        </select>
      </div>

      {/* remainder_destination */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider mb-1 c-tertiary">
          Куда остаток ({fmtMoney(remainder)})
        </p>
        <div className="flex gap-1.5">
          {[
            { code: 'pm',      label: '👤 РП', desc: 'Передаст налом' },
            { code: 'company', label: '🏦 Касса', desc: 'В кассу Асгарда' },
          ].map((t) => (
            <button key={t.code}
              onClick={() => onChange({ remainder_destination: t.code })}
              className="flex-1 px-2 py-2 rounded-lg text-[11px] font-semibold spring-tap"
              style={{
                background: r.remainder_destination === t.code
                  ? 'color-mix(in srgb, var(--green) 18%, transparent)'
                  : 'var(--bg-primary)',
                color: r.remainder_destination === t.code ? 'var(--green)' : 'var(--text-secondary)',
                border: '0.5px solid var(--border-norse)',
              }}>
              <div>{t.label}</div>
              <div className="text-[9px] opacity-70 mt-0.5">{t.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* comment */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider mb-1 c-tertiary">Комментарий</p>
        <input
          type="text" value={r.comment}
          onChange={(e) => onChange({ comment: e.target.value })}
          placeholder="Расчёт за июль..."
          className="input-field"
        />
      </div>

      {error && (
        <div className="text-[11px] px-2 py-1.5 rounded-md flex items-start gap-1.5"
          style={{ background: 'color-mix(in srgb, var(--err-t) 12%, transparent)', color: 'var(--err-t)' }}>
          <AlertCircle size={12} className="shrink-0 mt-0.5" />
          {error}
        </div>
      )}
    </div>
  );
}
