import { useState, useEffect, useCallback, useMemo } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { Boxes, ChevronRight, Search, X, QrCode } from 'lucide-react';
import { formatMoney } from '@/lib/utils';

export default function Warehouse() {
  const haptic = useHaptic();
  const [items, setItems] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [filter, setFilter] = useState('all');
  const [detail, setDetail] = useState(null);
  const [showQr, setShowQr] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [iRes, wRes] = await Promise.all([
        api.get('/equipment?limit=500'),
        api.get('/equipment/warehouses').catch(() => null),
      ]);
      setItems(api.extractRows(iRes) || []);
      if (wRes) setWarehouses(api.extractRows(wRes) || []);
    } catch { setItems([]); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    let list = items;
    if (filter !== 'all') list = list.filter((i) => String(i.warehouse_id) === filter);
    if (search) { const q = search.toLowerCase(); list = list.filter((i) => (i.name || '').toLowerCase().includes(q) || (i.inventory_number || '').toLowerCase().includes(q)); }
    return list;
  }, [items, filter, search]);

  const handleQrSearch = async (query) => {
    if (!query.trim()) return;
    haptic.light();
    try {
      const res = await api.get(`/equipment/by-qr/${encodeURIComponent(query.trim())}`);
      if (res) { setDetail(res); setShowQr(false); }
    } catch {}
  };

  return (
    <PageShell title="Склад" headerRight={
      <div className="flex items-center">
        <button onClick={() => { haptic.light(); setShowQr(true); }} className="flex items-center justify-center spring-tap" style={{ width: 44, height: 44, color: 'var(--gold)' }}><QrCode size={20} /></button>
        <button onClick={() => { haptic.light(); setShowSearch(!showSearch); }} className="flex items-center justify-center spring-tap" style={{ width: 44, height: 44, color: 'var(--text-tertiary)' }}><Search size={20} /></button>
      </div>
    }>
      <PullToRefresh onRefresh={fetchData}>
        {showSearch && (
          <div className="px-1 pb-2" style={{ animation: 'fadeInUp 150ms var(--ease-spring) forwards' }}>
            <div className="flex items-center gap-2 px-3 rounded-xl" style={{ height: 36, background: 'var(--bg-surface-alt)', border: '0.5px solid var(--border-norse)' }}>
              <Search size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
              <input type="text" placeholder="Поиск оборудования..." value={search} onChange={(e) => setSearch(e.target.value)} autoFocus className="flex-1 bg-transparent outline-none text-[14px]" style={{ color: 'var(--text-primary)', caretColor: 'var(--gold)' }} />
              {search && <button onClick={() => setSearch('')} style={{ color: 'var(--text-tertiary)' }}><X size={16} /></button>}
            </div>
          </div>
        )}
        <div className="flex gap-1.5 px-1 pb-3 overflow-x-auto no-scrollbar">
          <button onClick={() => { haptic.light(); setFilter('all'); }} className="shrink-0 px-3 py-1.5 rounded-full text-[12px] font-semibold spring-tap" style={{ background: filter === 'all' ? 'var(--bg-elevated)' : 'transparent', color: filter === 'all' ? 'var(--text-primary)' : 'var(--text-tertiary)', border: filter === 'all' ? '0.5px solid var(--border-light)' : '0.5px solid transparent' }}>Все</button>
          {warehouses.map((w) => <button key={w.id} onClick={() => { haptic.light(); setFilter(String(w.id)); }} className="shrink-0 px-3 py-1.5 rounded-full text-[12px] font-semibold spring-tap" style={{ background: filter === String(w.id) ? 'var(--bg-elevated)' : 'transparent', color: filter === String(w.id) ? 'var(--text-primary)' : 'var(--text-tertiary)', border: filter === String(w.id) ? '0.5px solid var(--border-light)' : '0.5px solid transparent' }}>{w.name || `Склад #${w.id}`}</button>)}
        </div>
        {loading ? <SkeletonList count={5} /> : filtered.length === 0 ? (
          <EmptyState icon={Boxes} iconColor="var(--gold)" iconBg="color-mix(in srgb, var(--gold) 10%, transparent)" title={search ? 'Ничего не найдено' : 'Склад пуст'} description="Оборудование появится здесь" />
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {filtered.map((item, i) => (
              <button key={item.id} onClick={() => { haptic.light(); setDetail(item); }} className="w-full text-left rounded-2xl px-4 py-3 spring-tap" style={{ background: 'color-mix(in srgb, var(--bg-surface) 85%, transparent)', backdropFilter: 'blur(8px)', border: '0.5px solid var(--border-norse)', animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 40}ms both` }}>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[14px] font-semibold leading-tight" style={{ color: 'var(--text-primary)' }}>{item.name || `#${item.id}`}</p>
                  <ChevronRight size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0, marginTop: 2 }} />
                </div>
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  {item.category_name && <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: 'color-mix(in srgb, var(--blue) 15%, transparent)', color: 'var(--blue)' }}>{item.category_name}</span>}
                  {item.inventory_number && <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>№{item.inventory_number}</span>}
                  {item.quantity && <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{item.quantity} {item.unit || 'шт.'}</span>}
                  {item.warehouse_name && <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{item.warehouse_name}</span>}
                </div>
              </button>
            ))}
          </div>
        )}
      </PullToRefresh>
      <EquipmentDetailSheet item={detail} onClose={() => setDetail(null)} />
      <QrSearchSheet open={showQr} onClose={() => setShowQr(false)} onSearch={handleQrSearch} />
    </PageShell>
  );
}

function EquipmentDetailSheet({ item, onClose }) {
  if (!item) return null;
  const it = item;
  const fields = [
    { label: 'Название', value: it.name || '—' },
    it.inventory_number && { label: 'Инв. номер', value: it.inventory_number },
    it.category_name && { label: 'Категория', value: it.category_name },
    it.quantity && { label: 'Количество', value: `${it.quantity} ${it.unit || 'шт.'}` },
    it.warehouse_name && { label: 'Склад', value: it.warehouse_name },
    it.responsible_name && { label: 'Ответственный', value: it.responsible_name },
    Number(it.price) > 0 && { label: 'Стоимость', value: formatMoney(it.price) },
    it.status && { label: 'Состояние', value: it.status },
    (it.note || it.comment) && { label: 'Примечание', value: it.note || it.comment, full: true },
  ].filter(Boolean);
  return (
    <BottomSheet open={!!item} onClose={onClose} title={it.name || `#${it.id}`}>
      <div className="flex flex-col gap-3 pb-4">
        {(it.photo_url || it.image_url) && <img src={it.photo_url || it.image_url} alt="" className="w-full h-40 object-cover rounded-xl" style={{ background: 'var(--bg-surface-alt)' }} />}
        {fields.map((f, i) => <div key={i}><p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: 'var(--text-tertiary)' }}>{f.label}</p><p className={`text-[14px] ${f.full ? 'whitespace-pre-wrap' : ''}`} style={{ color: 'var(--text-primary)' }}>{f.value}</p></div>)}
      </div>
    </BottomSheet>
  );
}

function QrSearchSheet({ open, onClose, onSearch }) {
  const [query, setQuery] = useState('');
  const is = { background: 'var(--bg-surface-alt)', color: 'var(--text-primary)', border: '0.5px solid var(--border-norse)', caretColor: 'var(--gold)' };
  return (
    <BottomSheet open={open} onClose={onClose} title="Поиск по номеру">
      <div className="flex flex-col gap-3 pb-4">
        <div><label className="text-[11px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-tertiary)' }}>Инв. номер или QR</label><input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Введите номер..." autoFocus className="w-full px-3 py-2.5 rounded-xl text-[14px] outline-none" style={is} /></div>
        <button onClick={() => onSearch(query)} disabled={!query.trim()} className="w-full py-3 rounded-xl font-semibold text-[14px] spring-tap" style={{ background: query.trim() ? 'var(--gold-gradient)' : 'var(--bg-elevated)', color: query.trim() ? '#fff' : 'var(--text-tertiary)' }}>Найти</button>
      </div>
    </BottomSheet>
  );
}
