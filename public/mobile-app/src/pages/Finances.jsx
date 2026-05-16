import { useState, useEffect, useCallback, useMemo } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { StatCard, StatRow } from '@/components/shared/StatCard';
import {
  DollarSign, TrendingUp, TrendingDown, Wrench, Building2,
} from 'lucide-react';
import { formatMoney, formatDate } from '@/lib/utils';

const PERIOD_OPTIONS = [
  { id: 'month',  label: 'Месяц' },
  { id: 'q3',     label: '3 мес' },
  { id: 'year',   label: 'Год' },
  { id: 'all',    label: 'Всё' },
];

const TABS = [
  { id: 'work',   label: 'Расходы работ' },
  { id: 'office', label: 'Офисные' },
];

function filterByPeriod(items, period, dateField) {
  if (period === 'all') return items;
  const now = new Date();
  const from = new Date();
  if (period === 'month') from.setMonth(from.getMonth() - 1);
  if (period === 'q3')    from.setMonth(from.getMonth() - 3);
  if (period === 'year')  from.setFullYear(from.getFullYear() - 1);
  return items.filter((item) => {
    const d = item[dateField] || item.created_at || item.date;
    if (!d) return true;
    return new Date(d) >= from && new Date(d) <= now;
  });
}

export default function Finances() {
  const haptic = useHaptic();
  const [works,          setWorks]          = useState([]);
  const [workExpenses,   setWorkExpenses]   = useState([]);
  const [officeExpenses, setOfficeExpenses] = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [tab,            setTab]            = useState('work');
  const [period,         setPeriod]         = useState('month');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [wRes, weRes, oeRes] = await Promise.all([
        api.get('/works?limit=500'),
        api.get('/expenses/work').catch(() => ({ expenses: [] })),
        api.get('/expenses/office').catch(() => ({ expenses: [] })),
      ]);
      setWorks(api.extractRows(wRes) || []);
      setWorkExpenses(api.extractRows(weRes) || []);
      setOfficeExpenses(api.extractRows(oeRes) || []);
    } catch {
      setWorks([]); setWorkExpenses([]); setOfficeExpenses([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const stats = useMemo(() => {
    // revenue — только contract_value, без угадывания поля
    const revenue  = works.reduce((s, w) => s + (Number(w.contract_value) || 0), 0);
    const wExp     = filterByPeriod(workExpenses, period, 'date').reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const oExp     = filterByPeriod(officeExpenses, period, 'date').reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const totalExp = wExp + oExp;
    const profit   = revenue - totalExp;
    return { revenue, totalExp, wExp, oExp, profit };
  }, [works, workExpenses, officeExpenses, period]);

  const currentExpenses = useMemo(() => {
    const raw = tab === 'work' ? workExpenses : officeExpenses;
    return filterByPeriod(raw, period, 'date')
      .sort((a, b) => new Date(b.created_at || b.date || 0) - new Date(a.created_at || a.date || 0))
      .slice(0, 50);
  }, [tab, workExpenses, officeExpenses, period]);

  const profitColor = stats.profit >= 0 ? 'var(--green)' : 'var(--red-soft)';

  return (
    <PageShell title="Финансы">
      <PullToRefresh onRefresh={fetchData}>

        {/* Период */}
        <div className="flex gap-1.5 pb-3 overflow-x-auto no-scrollbar">
          {PERIOD_OPTIONS.map((p) => (
            <button
              key={p.id}
              onClick={() => { haptic.light(); setPeriod(p.id); }}
              className="shrink-0 px-3 py-1.5 rounded-full text-[12px] font-semibold spring-tap"
              style={{
                background: period === p.id ? 'var(--gold)' : 'var(--bg-surface)',
                color:      period === p.id ? '#0a0a0c'     : 'var(--text-tertiary)',
                border:     period === p.id ? 'none'         : '0.5px solid var(--border-norse)',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Герой — прибыль */}
        {!loading && (
          <div
            className="rounded-2xl px-5 py-4 mb-3"
            style={{
              background: `linear-gradient(135deg, color-mix(in srgb, ${profitColor} 12%, var(--bg-surface)), color-mix(in srgb, ${profitColor} 4%, var(--bg-surface)))`,
              border: `0.5px solid color-mix(in srgb, ${profitColor} 25%, var(--border-norse))`,
              animation: 'fadeInUp var(--motion-normal) var(--ease-spring) forwards',
            }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
              Прибыль
            </p>
            <p className="text-[28px] font-bold leading-tight" style={{ color: profitColor }}>
              {formatMoney(stats.profit)}
            </p>
            <div className="flex items-center gap-5 mt-2">
              <span className="flex items-center gap-1 text-[12px]" style={{ color: 'var(--green)' }}>
                <TrendingUp size={14} />
                Выручка {formatMoney(stats.revenue, { short: true })}
              </span>
              <span className="flex items-center gap-1 text-[12px]" style={{ color: 'var(--red-soft)' }}>
                <TrendingDown size={14} />
                Расходы {formatMoney(stats.totalExp, { short: true })}
              </span>
            </div>
          </div>
        )}

        {/* Статкарточки */}
        {!loading && (
          <StatRow cols={3}>
            <StatCard icon={TrendingUp}   label="Выручка"  value={formatMoney(stats.revenue,  { short: true })} color="var(--blue)"     delay={0} />
            <StatCard icon={Wrench}       label="Работы"   value={formatMoney(stats.wExp,     { short: true })} color="var(--gold)"     delay={60} />
            <StatCard icon={Building2}    label="Офис"     value={formatMoney(stats.oExp,     { short: true })} color="#7B68EE"         delay={120} />
          </StatRow>
        )}

        {/* Табы */}
        <div className="flex gap-1.5 pb-3">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => { haptic.light(); setTab(t.id); }}
              className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold spring-tap"
              style={{
                background: tab === t.id ? 'var(--bg-elevated)' : 'transparent',
                color:      tab === t.id ? 'var(--text-primary)' : 'var(--text-tertiary)',
                border:     tab === t.id ? '0.5px solid var(--border-light)' : '0.5px solid transparent',
              }}
            >
              {t.label}
              <span
                className="ml-1 text-[11px]"
                style={{ color: tab === t.id ? 'var(--gold)' : 'var(--text-tertiary)' }}
              >
                ({currentExpenses.length})
              </span>
            </button>
          ))}
        </div>

        {/* Список расходов */}
        {loading ? (
          <SkeletonList count={5} />
        ) : currentExpenses.length === 0 ? (
          <EmptyState
            icon={DollarSign}
            iconColor="var(--green)"
            iconBg="rgba(48, 209, 88, 0.1)"
            title="Нет расходов"
            description="Расходы за выбранный период появятся здесь"
          />
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {currentExpenses.map((exp, i) => (
              <div
                key={exp.id || i}
                className="rounded-2xl px-4 py-3"
                style={{
                  background: 'color-mix(in srgb, var(--bg-surface) 92%, transparent)',
                  border:     '0.5px solid var(--border-norse)',
                  animation:  `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 30}ms both`,
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                      {exp.description || exp.category || `Расход #${exp.id}`}
                    </p>
                    {tab === 'work' && exp.work_title && (
                      <p className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--text-secondary)' }}>
                        {exp.work_title}
                      </p>
                    )}
                    {tab === 'office' && exp.category && exp.description && (
                      <p className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--text-secondary)' }}>
                        {exp.category}
                      </p>
                    )}
                  </div>
                  <span className="text-[15px] font-bold shrink-0" style={{ color: 'var(--red-soft)' }}>
                    {formatMoney(exp.amount || 0)}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-1.5">
                  {(exp.created_at || exp.date) && (
                    <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                      {formatDate(exp.created_at || exp.date)}
                    </span>
                  )}
                  {exp.user_name && (
                    <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                      {exp.user_name}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </PullToRefresh>
    </PageShell>
  );
}
