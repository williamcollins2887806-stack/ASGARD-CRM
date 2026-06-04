import { useState, useEffect, useCallback } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { StatCard, StatRow } from '@/components/shared/StatCard';
import {
  Wallet, ChevronRight, ArrowDownCircle, ArrowUpCircle, Banknote,
} from 'lucide-react';

const fmtMoney = (n) => n != null ? Math.round(n).toLocaleString('ru-RU') + ' ₽' : '—';

export default function PmBalance() {
  const haptic = useHaptic();
  const [pms, setPms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailData, setDetailData] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/payroll-dashboard/pm-balance');
      setPms(api.extractRows(res) || []);
    } catch (e) {
      setPms([]);
      setError(e.message || 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openDetail = async (pm) => {
    haptic.light();
    setDetail(pm);
    setDetailLoading(true);
    try {
      const res = await api.get(`/payroll-dashboard/pm-balance/${pm.pm_id}`);
      setDetailData(res);
    } catch {
      setDetailData(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const totalBalance = pms.reduce((s, p) => s + (Number(p.balance) || 0), 0);

  return (
    <PageShell title="Баланс РП">
      <PullToRefresh onRefresh={fetchData}>
        {!loading && pms.length > 0 && (
          <StatRow cols={1}>
            <StatCard icon={Wallet} label="Всего на руках у РП" value={fmtMoney(totalBalance)}
              color={totalBalance >= 0 ? 'var(--green)' : 'var(--err-t)'} delay={0} />
          </StatRow>
        )}

        {loading ? <SkeletonList count={5} /> : pms.length === 0 ? (
          <EmptyState icon={Wallet} iconColor="var(--gold)" iconBg="color-mix(in srgb, var(--gold) 10%, transparent)"
            title="Нет данных" description="Нет РП с балансом" />
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {pms.map((pm, i) => {
              const balance = Number(pm.balance) || 0;
              const isPositive = balance >= 0;
              return (
                <button key={pm.pm_id || i} onClick={() => openDetail(pm)}
                  className="card-glass w-full text-left px-4 py-3 spring-tap"
                  style={{ animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 40}ms both` }}>
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-semibold truncate c-primary">{pm.pm_name || '—'}</p>
                      <div className="flex items-center gap-3 mt-1 text-[11px] c-secondary">
                        <span className="flex items-center gap-0.5">
                          <ArrowDownCircle size={12} style={{ color: 'var(--green)' }} />
                          +{fmtMoney((Number(pm.cash_in) || 0) + (Number(pm.se_cash_in) || 0))}
                        </span>
                        <span className="flex items-center gap-0.5">
                          <ArrowUpCircle size={12} style={{ color: 'var(--err-t)' }} />
                          −{fmtMoney(Number(pm.cash_out) || 0)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[16px] font-bold"
                        style={{ color: isPositive ? 'var(--green)' : 'var(--err-t)' }}>
                        {fmtMoney(balance)}
                      </span>
                      <ChevronRight size={16} className="c-tertiary" />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </PullToRefresh>

      {/* Detail BottomSheet */}
      <BottomSheet open={!!detail} onClose={() => { setDetail(null); setDetailData(null); }}
        title={detail?.pm_name || 'Баланс РП'}>
        {detail && (
          <div className="flex flex-col gap-3 pb-4">
            {detailLoading ? (
              <SkeletonList count={3} />
            ) : detailData ? (
              <>
                <StatRow cols={2}>
                  <StatCard icon={ArrowDownCircle} label="Из кассы"
                    value={fmtMoney(detailData.cash_in)} color="var(--green)" delay={0} />
                  <StatCard icon={ArrowDownCircle} label="От СЗ"
                    value={fmtMoney(detailData.se_cash_in)} color="var(--blue)" delay={60} />
                </StatRow>
                <StatRow cols={2}>
                  <StatCard icon={ArrowUpCircle} label="Расходы"
                    value={fmtMoney(detailData.cash_out_expenses)} color="var(--warn-t)" delay={120} />
                  <StatCard icon={Banknote} label="Зарплаты"
                    value={fmtMoney(detailData.cash_out_salaries)} color="var(--err-t)" delay={180} />
                </StatRow>

                <div className="card-glass p-3 text-center">
                  <p className="text-xs c-tertiary mb-1">На руках</p>
                  <p className="text-2xl font-bold"
                    style={{ color: (Number(detailData.balance) || 0) >= 0 ? 'var(--green)' : 'var(--err-t)' }}>
                    {fmtMoney(detailData.balance)}
                  </p>
                </div>

                {/* Operations list */}
                {detailData.operations && detailData.operations.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider mb-2 c-tertiary">Операции</p>
                    {detailData.operations.map((op, i) => (
                      <div key={i} className="flex items-center justify-between py-2"
                        style={{ borderBottom: '1px solid var(--border-norse)' }}>
                        <div>
                          <p className="text-[13px] c-primary">{op.description || op.type || '—'}</p>
                          <p className="text-[10px] c-tertiary">{op.date ? new Date(op.date).toLocaleDateString('ru-RU') : ''}</p>
                        </div>
                        <span className="text-[13px] font-semibold"
                          style={{ color: op.amount >= 0 ? 'var(--green)' : 'var(--err-t)' }}>
                          {op.amount >= 0 ? '+' : ''}{fmtMoney(op.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm c-secondary text-center py-4">Не удалось загрузить данные</p>
            )}
          </div>
        )}
      </BottomSheet>
    </PageShell>
  );
}
