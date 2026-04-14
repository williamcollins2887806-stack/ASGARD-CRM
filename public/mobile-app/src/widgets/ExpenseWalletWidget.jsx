import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { useHaptic } from '@/hooks/useHaptic';
import { WidgetShell } from '@/widgets/WidgetShell';
import { formatMoney } from '@/lib/utils';
import { Wallet, ChevronRight, TrendingUp, TrendingDown } from 'lucide-react';

/**
 * ExpenseWalletWidget — «Кошелёк проекта»
 * Показывает суммарные расходы по работам РП + навигация в ExpenseChat
 */
export default function ExpenseWalletWidget() {
  const [works, setWorks] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const haptic = useHaptic();

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/mimir/expense-works');
        setWorks(res.works || []);
      } catch {
        setWorks([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const activeWorks = works.filter(w =>
    w.work_status && !['закрыт', 'завершен', 'отменено'].some(s => w.work_status.toLowerCase().includes(s))
  );
  const totalCost = activeWorks.reduce((s, w) => s + (w.cost_fact || 0), 0);
  const totalContract = activeWorks.reduce((s, w) => s + (w.contract_value || 0), 0);
  const totalProfit = totalContract - totalCost;
  const avgMargin = totalContract > 0 ? Math.round((totalProfit / totalContract) * 100) : 0;

  const handleTap = useCallback((workId) => {
    haptic.light();
    navigate(`/expense-chat/${workId}`);
  }, [navigate, haptic]);

  return (
    <WidgetShell name="Кошелёк проекта" icon="💰">
      {/* Summary */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Расходы / Контракт</div>
          <div className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
            {formatMoney(totalCost, { short: true })} / {formatMoney(totalContract, { short: true })}
          </div>
        </div>
        <div className="flex items-center gap-1" style={{
          padding: '4px 10px', borderRadius: 20,
          background: avgMargin >= 20 ? 'rgba(63,185,80,0.1)' : 'rgba(248,81,73,0.1)',
        }}>
          {avgMargin >= 20 ? <TrendingUp size={14} style={{ color: 'var(--green)' }} /> : <TrendingDown size={14} style={{ color: 'var(--red-soft)' }} />}
          <span className="text-xs font-bold" style={{ color: avgMargin >= 20 ? 'var(--green)' : 'var(--red-soft)' }}>
            {avgMargin}%
          </span>
        </div>
      </div>

      {/* Work list */}
      <div className="flex flex-col gap-1.5">
        {activeWorks.slice(0, 3).map(w => (
          <button
            key={w.id}
            className="flex items-center gap-3 w-full text-left spring-tap"
            style={{ padding: '8px 10px', borderRadius: 12, background: 'rgba(255,255,255,0.03)' }}
            onClick={() => handleTap(w.id)}
          >
            <Wallet size={16} style={{ color: 'var(--gold)', opacity: 0.7 }} />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                {w.work_title || `#${w.work_number}`}
              </div>
              <div className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                {formatMoney(w.cost_fact, { short: true })} из {formatMoney(w.contract_value, { short: true })}
              </div>
            </div>
            {/* Mini progress bar */}
            <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)' }}>
              <div style={{
                width: `${Math.min(100, w.contract_value > 0 ? (w.cost_fact / w.contract_value * 100) : 0)}%`,
                height: '100%', borderRadius: 2,
                background: w.margin_pct >= 20 ? 'var(--green)' : w.margin_pct >= 0 ? 'var(--gold)' : 'var(--red-soft)',
              }} />
            </div>
            <ChevronRight size={14} style={{ color: 'var(--text-tertiary)' }} />
          </button>
        ))}
      </div>

      {activeWorks.length === 0 && !loading && (
        <div className="text-center py-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>
          Нет активных работ
        </div>
      )}
    </WidgetShell>
  );
}
