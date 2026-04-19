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
        <button onClick={() => { haptic.light(); setShowQr(true); }} className="btn-icon spring-tap c-gold"><QrCode size={20} /></button>
        <button onClick={() => { haptic.light(); setShowSearch(!showSearch); }} className="btn-icon spring-tap"><Search size={20} /></button>
      </div>
    }>
      <PullToRefresh onRefresh={fetchData}>
        {showSearch && (
          <div className="px-1 pb-2" style={{ animation: 'fadeInUp 150ms var(--ease-spring) forwards' }}>
            <div className="search-bar">
              <Search size={16} className="c-tertiary" style={{ flexShrink: 0 }} />
              <input type="text" placeholder="Поиск оборудования..." value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
              {search && <button onClick={() => setSearch('')} className="c-tertiary"><X size={16} /></button>}
            </div>
          </div>
        )}
        <div className="flex gap-1.5 px-1 pb-3 overflow-x-auto no-scrollbar">
          <button onClick={() => { haptic.light(); setFilter('all'); }} className="filter-pill spring-tap" data-active={filter === 'all'}>Все</button>
          {warehouses.map((w) => <button key={w.id} onClick={() => { haptic.light(); setFilter(String(w.id)); }} className="filter-pill spring-tap" data-active={filter === String(w.id)}>{w.name || `Склад #${w.id}`}</button>)}
        </div>
        {loading ? <SkeletonList count={5} /> : filtered.length === 0 ? (
          <EmptyState icon={Boxes} iconColor="var(--gold)" iconBg="color-mix(in srgb, var(--gold) 10%, transparent)" title={search ? 'Ничего не найдено' : 'Склад пуст'} description="Оборудование появится здесь" />
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {filtered.map((item, i) => (
              <button key={item.id} onClick={() => { haptic.light(); setDetail(item); }} className="w-full text-left rounded-2xl px-4 py-3 spring-tap card-glass" style={{ animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 40}ms both` }}>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[14px] font-semibold leading-tight c-primary">{item.name || `#${item.id}`}</p>
                  <ChevronRight size={16} className="c-tertiary" style={{ flexShrink: 0, marginTop: 2 }} />
                </div>
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  {item.category_name && <span className="status-badge c-blue" style={{ background: 'color-mix(in srgb, var(--blue) 15%, transparent)' }}>{item.category_name}</span>}
                  {item.inventory_number && <span className="text-[10px] c-secondary">№{item.inventory_number}</span>}
                  {item.quantity && <span className="text-[10px] c-tertiary">{item.quantity} {item.unit || 'шт.'}</span>}
                  {item.warehouse_name && <span className="text-[10px] c-tertiary">{item.warehouse_name}</span>}
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
        {fields.map((f, i) => <div key={i}><p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5 c-tertiary">{f.label}</p><p className={`text-[14px] c-primary ${f.full ? 'whitespace-pre-wrap' : ''}`}>{f.value}</p></div>)}
      </div>
    </BottomSheet>
  );
}

function QrSearchSheet({ open, onClose, onSearch }) {
  const [query, setQuery] = useState('');
  return (
    <BottomSheet open={open} onClose={onClose} title="Поиск по номеру">
      <div className="flex flex-col gap-3 pb-4">
        <div><label className="input-label">Инв. номер или QR</label><input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Введите номер..." autoFocus className="input-field" /></div>
        <button onClick={() => onSearch(query)} disabled={!query.trim()} className="btn-primary spring-tap">Найти</button>
      </div>
    </BottomSheet>
  );
}
