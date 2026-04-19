import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { HardDrive, ChevronRight } from 'lucide-react';
import { formatMoney } from '@/lib/utils';

const STATUS_MAP = {
  active: { label: 'Активно', color: 'var(--green)' },
  repair: { label: 'Ремонт', color: 'var(--gold)' },
  decommissioned: { label: 'Списано', color: 'var(--red-soft)' },
};

export default function MyEquipment() {
  const user = useAuthStore((s) => s.user);
  const haptic = useHaptic();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);

  const fetchData = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try { const res = await api.get(`/equipment?responsible_id=${user.id}&limit=200`); setItems(api.extractRows(res) || []); }
    catch { setItems([]); } finally { setLoading(false); }
  }, [user?.id]);
  useEffect(() => { fetchData(); }, [fetchData]);

  const totalValue = items.reduce((s, i) => s + (Number(i.price) || 0), 0);

  return (
    <PageShell title="Моё оборудование">
      <PullToRefresh onRefresh={fetchData}>
        {!loading && items.length > 0 && (
          <div className="grid grid-cols-2 gap-1.5 px-1 pb-3" style={{ animation: 'fadeInUp var(--motion-normal) var(--ease-spring) forwards' }}>
            <div className="flex flex-col items-center gap-0.5 py-2.5 rounded-xl card-glass"><p className="text-[13px] font-bold c-primary">{items.length}</p><p className="text-[9px] c-tertiary">Единиц</p></div>
            <div className="flex flex-col items-center gap-0.5 py-2.5 rounded-xl card-glass"><p className="text-[13px] font-bold c-gold">{formatMoney(totalValue, { short: true })}</p><p className="text-[9px] c-tertiary">Стоимость</p></div>
          </div>
        )}
        {loading ? <SkeletonList count={4} /> : items.length === 0 ? (
          <EmptyState icon={HardDrive} iconColor="var(--blue)" iconBg="rgba(74,144,217,0.1)" title="Нет оборудования" description="Закреплённое за вами оборудование появится здесь" />
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {items.map((item, i) => {
              const st = STATUS_MAP[item.status] || STATUS_MAP.active;
              return (
                <button key={item.id} onClick={() => { haptic.light(); setDetail(item); }} className="w-full text-left rounded-2xl px-4 py-3 spring-tap card-glass" style={{ animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 40}ms both` }}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[14px] font-semibold leading-tight c-primary">{item.name || `#${item.id}`}</p>
                    <ChevronRight size={16} className="c-tertiary" style={{ flexShrink: 0, marginTop: 2 }} />
                  </div>
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <span className="status-badge" style={{ background: `color-mix(in srgb, ${st.color} 15%, transparent)`, color: st.color }}>{st.label}</span>
                    {item.category_name && <span className="text-[10px] c-secondary">{item.category_name}</span>}
                    {item.inventory_number && <span className="text-[10px] c-tertiary">№{item.inventory_number}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </PullToRefresh>
      <EquipmentDetailSheet item={detail} onClose={() => setDetail(null)} />
    </PageShell>
  );
}

function EquipmentDetailSheet({ item, onClose }) {
  if (!item) return null;
  const st = STATUS_MAP[item.status] || STATUS_MAP.active;
  const fields = [
    { label: 'Статус', value: st.label, color: st.color },
    item.inventory_number && { label: 'Инв. номер', value: item.inventory_number },
    item.serial_number && { label: 'Серийный номер', value: item.serial_number },
    item.category_name && { label: 'Категория', value: item.category_name },
    Number(item.price) > 0 && { label: 'Стоимость', value: formatMoney(item.price) },
    item.warehouse_name && { label: 'Склад', value: item.warehouse_name },
    item.assigned_date && { label: 'Закреплено', value: item.assigned_date },
    (item.note || item.comment) && { label: 'Примечание', value: item.note || item.comment, full: true },
  ].filter(Boolean);
  return (
    <BottomSheet open={!!item} onClose={onClose} title={item.name || `#${item.id}`}>
      <div className="flex flex-col gap-3 pb-4">
        {fields.map((f, i) => <div key={i}><p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5 c-tertiary">{f.label}</p>{f.color ? <span className="px-2.5 py-1 rounded-full text-[12px] font-semibold inline-block" style={{ background: `color-mix(in srgb, ${f.color} 15%, transparent)`, color: f.color }}>{f.value}</span> : <p className={`text-[14px] c-primary ${f.full ? 'whitespace-pre-wrap' : ''}`}>{f.value}</p>}</div>)}
      </div>
    </BottomSheet>
  );
}
