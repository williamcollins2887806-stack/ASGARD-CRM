import { useState, useEffect, useCallback } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { CreditCard, ChevronRight } from 'lucide-react';
import { formatMoney, relativeTime } from '@/lib/utils';

export default function ApprovalPayment() {
  const haptic = useHaptic();
  const [items, setItems] = useState([]);
  const [cashBalance, setCashBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/approval/pending-buh');
      setItems(res?.items || []);
      setCashBalance(res?.cash_balance || 0);
    } catch { setItems([]); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <PageShell title="Оплаты">
      <PullToRefresh onRefresh={fetchData}>
        {!loading && (
          <div className="card-hero mb-3" style={{ animation: 'fadeInUp var(--motion-normal) var(--ease-spring) forwards' }}>
            <p className="input-label">Баланс кассы</p>
            <p className="text-[24px] font-bold c-primary">{formatMoney(cashBalance)}</p>
            <p className="text-[12px] mt-1 c-secondary">В очереди: {items.length}</p>
          </div>
        )}
        {loading ? <SkeletonList count={4} /> : items.length === 0 ? (
          <EmptyState icon={CreditCard} iconColor="var(--green)" iconBg="rgba(48,209,88,0.1)" title="Нет платежей" description="Очередь оплат пуста" />
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {items.map((item, i) => (
              <button key={item.id || i} onClick={() => { haptic.light(); setDetail(item); }} className="w-full text-left card-glass px-4 py-3 spring-tap" style={{ animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 40}ms both` }}>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[14px] font-semibold leading-tight c-primary">{item.title || item.name || `#${item.entity_id || item.id}`}</p>
                  <ChevronRight size={16} className="c-tertiary" style={{ flexShrink: 0, marginTop: 2 }} />
                </div>
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  {item.entity_type && <span className="status-badge c-blue" style={{ background: 'color-mix(in srgb, var(--blue) 15%, transparent)' }}>{item.entity_type}</span>}
                  <span className="text-[12px] font-semibold c-gold">{formatMoney(item.amount || 0)}</span>
                  {item.initiator_name && <span className="text-[10px] c-tertiary">{item.initiator_name}</span>}
                  {(item.updated_at || item.created_at) && <span className="text-[10px] c-tertiary">{relativeTime(item.updated_at || item.created_at)}</span>}
                </div>
              </button>
            ))}
          </div>
        )}
      </PullToRefresh>
      <PaymentDetailSheet item={detail} onClose={() => setDetail(null)} />
    </PageShell>
  );
}

function PaymentDetailSheet({ item, onClose }) {
  if (!item) return null;
  const fields = [
    item.entity_type && { label: 'Тип', value: item.entity_type, color: 'var(--blue)' },
    { label: 'Название', value: item.title || item.name || '—' },
    { label: 'Сумма', value: formatMoney(item.amount || 0) },
    item.initiator_name && { label: 'Инициатор', value: item.initiator_name || item.created_by_name },
    item.comment && { label: 'Комментарий', value: item.comment, full: true },
    (item.updated_at || item.created_at) && { label: 'Обновлено', value: relativeTime(item.updated_at || item.created_at) },
  ].filter(Boolean);
  return (
    <BottomSheet open={!!item} onClose={onClose} title={item.title || 'Платёж'}>
      <div className="flex flex-col gap-3 pb-4">
        {fields.map((f, i) => <div key={i}><p className="input-label">{f.label}</p>{f.color ? <span className="px-2.5 py-1 rounded-full text-[12px] font-semibold inline-block" style={{ background: `color-mix(in srgb, ${f.color} 15%, transparent)`, color: f.color }}>{f.value}</span> : <p className={`text-[14px] c-primary ${f.full ? 'whitespace-pre-wrap' : ''}`}>{f.value}</p>}</div>)}
      </div>
    </BottomSheet>
  );
}
