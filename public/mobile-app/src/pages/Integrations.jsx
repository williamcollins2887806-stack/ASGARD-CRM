import { useState, useEffect, useCallback } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { Plug, Building2, Globe, Database, RefreshCw } from 'lucide-react';
import { formatMoney, relativeTime } from '@/lib/utils';

const TABS = [
  { id: 'bank', label: 'Банк/1С', icon: Building2 },
  { id: 'platforms', label: 'Площадки', icon: Globe },
  { id: 'erp', label: 'ERP', icon: Database },
];

const ERP_ITEMS = [
  { name: '1С:Бухгалтерия', status: 'active', desc: 'Синхронизация счетов и платежей' },
  { name: '1С:Зарплата', status: 'inactive', desc: 'Зарплатные ведомости' },
  { name: 'SAP', status: 'inactive', desc: 'Не подключено' },
];

export default function Integrations() {
  const haptic = useHaptic();
  const [tab, setTab] = useState('bank');
  const [bankStats, setBankStats] = useState(null);
  const [batches, setBatches] = useState([]);
  const [platforms, setPlatforms] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === 'bank') {
        const [statsRes, batchRes] = await Promise.all([
          api.get('/integrations/bank/stats').catch(() => null),
          api.get('/integrations/bank/batches').catch(() => null),
        ]);
        setBankStats(statsRes);
        setBatches(api.extractRows(batchRes) || []);
      } else if (tab === 'platforms') {
        const res = await api.get('/integrations/platforms').catch(() => null);
        setPlatforms(api.extractRows(res) || []);
      }
    } catch {}
    finally { setLoading(false); }
  }, [tab]);
  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <PageShell title="Интеграции">
      <PullToRefresh onRefresh={fetchData}>
        {/* Tabs */}
        <div className="flex gap-1.5 px-1 pb-3">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button key={t.id} onClick={() => { haptic.light(); setTab(t.id); }} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[12px] font-semibold spring-tap" style={{ background: tab === t.id ? 'var(--bg-elevated)' : 'transparent', color: tab === t.id ? 'var(--text-primary)' : 'var(--text-tertiary)', border: tab === t.id ? '0.5px solid var(--border-light)' : '0.5px solid transparent' }}>
                <Icon size={14} />{t.label}
              </button>
            );
          })}
        </div>

        {tab === 'bank' && (
          <>
            {bankStats && !loading && (
              <div className="rounded-2xl p-4 mb-3" style={{ background: 'color-mix(in srgb, var(--bg-surface) 85%, transparent)', border: '0.5px solid var(--border-norse)', animation: 'fadeInUp var(--motion-normal) var(--ease-spring) forwards' }}>
                <div className="flex items-center gap-2 mb-2">
                  <Building2 size={16} style={{ color: 'var(--green)' }} />
                  <span className="text-[12px] font-semibold" style={{ color: 'var(--green)' }}>Подключено</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div><p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Транзакций</p><p className="text-[14px] font-bold" style={{ color: 'var(--text-primary)' }}>{bankStats.total_transactions || 0}</p></div>
                  <div><p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Разнесено</p><p className="text-[14px] font-bold" style={{ color: 'var(--green)' }}>{bankStats.classified_count || 0}</p></div>
                  <div><p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Ожидает</p><p className="text-[14px] font-bold" style={{ color: 'var(--gold)' }}>{bankStats.pending_count || 0}</p></div>
                </div>
              </div>
            )}
            {loading ? <SkeletonList count={3} /> : batches.length === 0 ? (
              <EmptyState icon={Building2} iconColor="var(--blue)" iconBg="rgba(74,144,217,0.1)" title="Нет загрузок" description="Банковские выписки появятся здесь" />
            ) : (
              <div className="flex flex-col gap-2 pb-4">
                {batches.map((b, i) => (
                  <div key={b.id || i} className="rounded-2xl px-4 py-3" style={{ background: 'color-mix(in srgb, var(--bg-surface) 85%, transparent)', border: '0.5px solid var(--border-norse)', animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 40}ms both` }}>
                    <p className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>{b.filename || `Загрузка #${b.id}`}</p>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: 'color-mix(in srgb, var(--green) 15%, transparent)', color: 'var(--green)' }}>{b.status || 'OK'}</span>
                      {b.transaction_count && <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{b.transaction_count} транзакций</span>}
                      {b.created_at && <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{relativeTime(b.created_at)}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'platforms' && (
          loading ? <SkeletonList count={4} /> : platforms.length === 0 ? (
            <EmptyState icon={Globe} iconColor="var(--blue)" iconBg="rgba(74,144,217,0.1)" title="Нет площадок" description="Тендерные площадки появятся здесь" />
          ) : (
            <div className="flex flex-col gap-2 pb-4">
              {platforms.map((p, i) => (
                <div key={p.id || i} className="rounded-2xl px-4 py-3" style={{ background: 'color-mix(in srgb, var(--bg-surface) 85%, transparent)', border: '0.5px solid var(--border-norse)', animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 40}ms both` }}>
                  <div className="flex items-center justify-between">
                    <p className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>{p.name || `Площадка #${p.id}`}</p>
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: p.status === 'active' ? 'var(--green)' : 'var(--text-tertiary)' }} />
                  </div>
                  {p.last_parsed_at && <p className="text-[10px] mt-1" style={{ color: 'var(--text-tertiary)' }}>Обновлено: {relativeTime(p.last_parsed_at)}</p>}
                </div>
              ))}
            </div>
          )
        )}

        {tab === 'erp' && (
          <div className="flex flex-col gap-2 pb-4">
            {ERP_ITEMS.map((item, i) => (
              <div key={i} className="rounded-2xl px-4 py-3" style={{ background: 'color-mix(in srgb, var(--bg-surface) 85%, transparent)', border: '0.5px solid var(--border-norse)', animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 60}ms both` }}>
                <div className="flex items-center justify-between">
                  <p className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>{item.name}</p>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: item.status === 'active' ? 'color-mix(in srgb, var(--green) 15%, transparent)' : 'var(--bg-surface-alt)', color: item.status === 'active' ? 'var(--green)' : 'var(--text-tertiary)' }}>{item.status === 'active' ? 'Активно' : 'Не подключено'}</span>
                </div>
                <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{item.desc}</p>
              </div>
            ))}
          </div>
        )}
      </PullToRefresh>
    </PageShell>
  );
}
