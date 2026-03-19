import { useState, useEffect, useCallback, useMemo } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import {
  DollarSign, TrendingUp, TrendingDown, Wrench, Building2,
} from 'lucide-react';
import { formatMoney, formatDate } from '@/lib/utils';

const TABS = [
  { id: 'work',   label: 'Расходы работ' },
  { id: 'office', label: 'Офисные' },
];

export default function Finances() {
  const haptic = useHaptic();
  const [works, setWorks] = useState([]);
  const [workExpenses, setWorkExpenses] = useState([]);
  const [officeExpenses, setOfficeExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('work');

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
    const revenue = works.reduce((s, w) => s + (Number(w.contract_value || w.contract_amount || w.income) || 0), 0);
    const wExp = workExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const oExp = officeExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const totalExp = wExp + oExp;
    const profit = revenue - totalExp;
    return { revenue, totalExp, wExp, oExp, profit };
  }, [works, workExpenses, officeExpenses]);

  const currentExpenses = tab === 'work'
    ? [...workExpenses].sort((a, b) => new Date(b.created_at || b.date || 0) - new Date(a.created_at || a.date || 0)).slice(0, 30)
    : [...officeExpenses].sort((a, b) => new Date(b.created_at || b.date || 0) - new Date(a.created_at || a.date || 0)).slice(0, 30);

  return (
    <PageShell title="Финансы">
      <PullToRefresh onRefresh={fetchData}>
        {/* Profit hero */}
        {!loading && (
          <div
            className="rounded-2xl p-4 mb-3"
            style={{
              background: 'color-mix(in srgb, var(--bg-surface) 85%, transparent)',
              backdropFilter: 'blur(8px)',
              border: '0.5px solid var(--border-norse)',
              animation: 'fadeInUp var(--motion-normal) var(--ease-spring) forwards',
            }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
              Прибыль
            </p>
            <p
              className="text-[24px] font-bold"
              style={{ color: stats.profit >= 0 ? 'var(--green)' : 'var(--red-soft)' }}
            >
              {formatMoney(stats.profit)}
            </p>
            <div className="flex items-center gap-4 mt-2">
              <span className="flex items-center gap-1 text-[12px]" style={{ color: 'var(--green)' }}>
                <TrendingUp size={14} /> {formatMoney(stats.revenue, { short: true })}
              </span>
              <span className="flex items-center gap-1 text-[12px]" style={{ color: 'var(--red-soft)' }}>
                <TrendingDown size={14} /> {formatMoney(stats.totalExp, { short: true })}
              </span>
            </div>
          </div>
        )}

        {/* Stats grid */}
        {!loading && (
          <div
            className="grid grid-cols-4 gap-1.5 px-0 pb-3"
            style={{ animation: 'fadeInUp var(--motion-normal) var(--ease-spring) 50ms both' }}
          >
            <StatCard icon={TrendingUp} label="Выручка" value={formatMoney(stats.revenue, { short: true })} color="var(--blue)" />
            <StatCard icon={TrendingDown} label="Расходы" value={formatMoney(stats.totalExp, { short: true })} color="var(--red-soft)" />
            <StatCard icon={Wrench} label="Работы" value={formatMoney(stats.wExp, { short: true })} color="var(--gold)" />
            <StatCard icon={Building2} label="Офис" value={formatMoney(stats.oExp, { short: true })} color="#7B68EE" />
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 pb-3">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => { haptic.light(); setTab(t.id); }}
              className="flex-1 py-2 rounded-xl text-[13px] font-semibold spring-tap"
              style={{
                background: tab === t.id ? 'var(--bg-elevated)' : 'transparent',
                color: tab === t.id ? 'var(--text-primary)' : 'var(--text-tertiary)',
                border: tab === t.id ? '0.5px solid var(--border-light)' : '0.5px solid transparent',
              }}
            >
              {t.label} ({tab === t.id ? currentExpenses.length : (t.id === 'work' ? workExpenses.length : officeExpenses.length)})
            </button>
          ))}
        </div>

        {/* Expense list */}
        {loading ? (
          <SkeletonList count={5} />
        ) : currentExpenses.length === 0 ? (
          <EmptyState
            icon={DollarSign}
            iconColor="var(--green)"
            iconBg="rgba(48, 209, 88, 0.1)"
            title="Нет расходов"
            description="Расходы появятся здесь"
          />
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {currentExpenses.map((exp, i) => (
              <div
                key={exp.id || i}
                className="rounded-2xl px-4 py-3"
                style={{
                  background: 'color-mix(in srgb, var(--bg-surface) 85%, transparent)',
                  border: '0.5px solid var(--border-norse)',
                  animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 40}ms both`,
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                      {exp.description || exp.category || `Расход #${exp.id}`}
                    </p>
                    {(exp.work_title || exp.category) && exp.description && (
                      <p className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--text-secondary)' }}>
                        {tab === 'work' ? exp.work_title : exp.category}
                      </p>
                    )}
                  </div>
                  <span className="text-[14px] font-bold shrink-0" style={{ color: 'var(--red-soft)' }}>
                    {formatMoney(exp.amount || 0)}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-1.5">
                  {(exp.created_at || exp.date) && (
                    <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                      {formatDate(exp.created_at || exp.date)}
                    </span>
                  )}
                  {exp.user_name && (
                    <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
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

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div
      className="flex flex-col items-center gap-0.5 py-2.5 rounded-xl"
      style={{
        background: 'color-mix(in srgb, var(--bg-surface) 85%, transparent)',
        border: '0.5px solid var(--border-norse)',
      }}
    >
      <Icon size={14} style={{ color }} />
      <p className="text-[11px] font-bold" style={{ color }}>{value}</p>
      <p className="text-[9px]" style={{ color: 'var(--text-tertiary)' }}>{label}</p>
    </div>
  );
}
