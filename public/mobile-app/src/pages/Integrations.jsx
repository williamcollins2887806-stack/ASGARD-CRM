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
              <button key={t.id} onClick={() => { haptic.light(); setTab(t.id); }} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl filter-pill spring-tap" data-active={tab === t.id}>
                <Icon size={14} />{t.label}
              </button>
            );
          })}
        </div>

        {tab === 'bank' && (
          <>
            {bankStats && !loading && (
              <div className="card-hero mb-3" style={{ animation: 'fadeInUp var(--motion-normal) var(--ease-spring) forwards' }}>
                <div className="flex items-center gap-2 mb-2">
                  <Building2 size={16} className="c-green" />
                  <span className="text-[12px] font-semibold c-green">Подключено</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div><p className="text-[10px] c-tertiary">Транзакций</p><p className="text-[14px] font-bold c-primary">{bankStats.total_transactions || 0}</p></div>
                  <div><p className="text-[10px] c-tertiary">Разнесено</p><p className="text-[14px] font-bold c-green">{bankStats.classified_count || 0}</p></div>
                  <div><p className="text-[10px] c-tertiary">Ожидает</p><p className="text-[14px] font-bold c-gold">{bankStats.pending_count || 0}</p></div>
                </div>
              </div>
            )}
            {loading ? <SkeletonList count={3} /> : batches.length === 0 ? (
              <EmptyState icon={Building2} iconColor="var(--blue)" iconBg="rgba(74,144,217,0.1)" title="Нет загрузок" description="Банковские выписки появятся здесь" />
            ) : (
              <div className="flex flex-col gap-2 pb-4">
                {batches.map((b, i) => (
                  <div key={b.id || i} className="rounded-2xl px-4 py-3 card-glass" style={{ animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 40}ms both` }}>
                    <p className="text-[14px] font-semibold c-primary">{b.filename || `Загрузка #${b.id}`}</p>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <span className="status-badge c-green" style={{ background: 'color-mix(in srgb, var(--green) 15%, transparent)' }}>{b.status || 'OK'}</span>
                      {b.transaction_count && <span className="text-[10px] c-tertiary">{b.transaction_count} транзакций</span>}
                      {b.created_at && <span className="text-[10px] c-tertiary">{relativeTime(b.created_at)}</span>}
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
                <div key={p.id || i} className="rounded-2xl px-4 py-3 card-glass" style={{ animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 40}ms both` }}>
                  <div className="flex items-center justify-between">
                    <p className="text-[14px] font-semibold c-primary">{p.name || `Площадка #${p.id}`}</p>
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: p.status === 'active' ? 'var(--green)' : 'var(--text-tertiary)' }} />
                  </div>
                  {p.last_parsed_at && <p className="text-[10px] mt-1 c-tertiary">Обновлено: {relativeTime(p.last_parsed_at)}</p>}
                </div>
              ))}
            </div>
          )
        )}

        {tab === 'erp' && (
          <div className="flex flex-col gap-2 pb-4">
            {ERP_ITEMS.map((item, i) => (
              <div key={i} className="rounded-2xl px-4 py-3 card-glass" style={{ animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 60}ms both` }}>
                <div className="flex items-center justify-between">
                  <p className="text-[14px] font-semibold c-primary">{item.name}</p>
                  <span className={`status-badge ${item.status === 'active' ? 'c-green' : 'c-tertiary'}`} style={{ background: item.status === 'active' ? 'color-mix(in srgb, var(--green) 15%, transparent)' : 'var(--bg-surface-alt)' }}>{item.status === 'active' ? 'Активно' : 'Не подключено'}</span>
                </div>
                <p className="text-[12px] mt-0.5 c-tertiary">{item.desc}</p>
              </div>
            ))}
          </div>
        )}
      </PullToRefresh>
    </PageShell>
  );
}
