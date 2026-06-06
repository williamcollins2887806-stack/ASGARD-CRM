/**
 * Assembly.jsx — Сборка (офисная мобилка, PM/WAREHOUSE/директора).
 * Список ведомостей, прогресс, деталь с позициями/паллетами, подтверждение и отправка.
 * Собирают рабочие (Field PWA) и desktop; здесь — контроль и управление статусом.
 */
import { useState, useEffect, useCallback } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { Boxes, Truck, RefreshCw, ChevronRight, Check, Package } from 'lucide-react';

const TYPE = {
  mobilization: { label: 'Мобилизация', color: '#D4A843' },
  demobilization: { label: 'Демобилизация', color: '#4A90D9' },
  transfer: { label: 'Перемещение', color: '#30d158' },
};
const STATUS = {
  draft: 'Черновик', confirmed: 'К сборке', packing: 'Сборка', packed: 'Собрано',
  in_transit: 'В пути', received: 'Принято', returned: 'Возвращено', closed: 'Закрыто',
};

export default function Assembly() {
  const haptic = useHaptic();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailData, setDetailData] = useState(null);
  const [detailError, setDetailError] = useState(null);
  const [actionErr, setActionErr] = useState(null);
  const [filter, setFilter] = useState('active'); // active | all

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await api.get('/assembly?limit=100');
      setItems(api.extractRows ? (api.extractRows(res) || []) : (res.items || []));
    } catch (e) { setError(e.message || 'Не удалось загрузить'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchData(); }, [fetchData]);

  async function openDetail(id) {
    haptic.light(); setDetail(id); setDetailData(null); setDetailError(null); setActionErr(null);
    try { setDetailData(await api.get(`/assembly/${id}`)); } catch (e) { setDetailError(e.message || 'Ошибка загрузки'); }
  }
  async function confirm(id) {
    haptic.success(); setActionErr(null);
    try { await api.put(`/assembly/${id}/confirm`); await openDetail(id); fetchData(); } catch (e) { haptic.error(); setActionErr(e.message || 'Ошибка'); }
  }
  async function send(id) {
    haptic.success(); setActionErr(null);
    try { await api.put(`/assembly/${id}/send`); await openDetail(id); fetchData(); } catch (e) { haptic.error(); setActionErr(e.message || 'Ошибка'); }
  }
  const visibleItems = filter === 'active'
    ? items.filter(a => !['closed', 'returned'].includes(a.status))
    : items;

  return (
    <PageShell title="Сборка" subtitle="Ведомости мобилизации">
      <PullToRefresh onRefresh={fetchData}>
        {/* фильтр статуса */}
        {!loading && !error && items.length > 0 && (
          <div className="flex gap-2 px-4 pt-3">
            {[{ v: 'active', l: 'Активные' }, { v: 'all', l: 'Все' }].map(f => (
              <button key={f.v} onClick={() => { haptic.light(); setFilter(f.v); }}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg transition"
                style={{ background: filter === f.v ? 'rgba(212,168,67,.16)' : 'var(--bg-elevated,#161a22)', color: filter === f.v ? '#D4A843' : 'var(--t2,#8b93a3)', border: `1px solid ${filter === f.v ? '#D4A843' : 'var(--border,#262c38)'}` }}>{f.l}</button>
            ))}
          </div>
        )}
        {loading ? <SkeletonList count={5} /> : error ? (
          <EmptyState icon={Boxes} title="Ошибка загрузки" subtitle={error + ' · потяните вниз для повтора'} />
        ) : visibleItems.length === 0 ? (
          <EmptyState icon={Boxes} title="Нет ведомостей" subtitle={filter === 'active' ? 'Активных сборов нет' : 'Сборы появятся здесь'} />
        ) : (
          <div className="p-4 space-y-3">
            {visibleItems.map(a => {
              const meta = TYPE[a.type] || TYPE.mobilization;
              const pct = a.items_count > 0 ? Math.round((a.packed_count / a.items_count) * 100) : 0;
              return (
                <button key={a.id} onClick={() => openDetail(a.id)}
                  className="w-full text-left rounded-2xl p-4 active:scale-[.98] transition"
                  style={{ background: 'var(--bg-elevated,#161a22)', border: '1px solid var(--border,#262c38)' }}>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${meta.color}22` }}>
                      <Truck size={20} style={{ color: meta.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold truncate" style={{ color: 'var(--t1,#e6e9ef)' }}>{a.title || meta.label}</div>
                      <div className="text-xs truncate" style={{ color: 'var(--t2,#8b93a3)' }}>{a.work_title || ''}</div>
                    </div>
                    <ChevronRight size={18} style={{ color: 'var(--t2,#8b93a3)', flexShrink: 0 }} />
                  </div>
                  <div className="flex items-center gap-2 mt-2.5">
                    <span className="text-[11px] px-2 py-0.5 rounded-full font-bold" style={{ background: `${meta.color}22`, color: meta.color }}>{STATUS[a.status] || a.status}</span>
                    <span className="text-xs" style={{ color: 'var(--t2,#8b93a3)' }}>{a.items_count || 0} поз. • {a.pallets_count || 0} мест</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,.08)' }}>
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: meta.color }} />
                    </div>
                    <span className="text-[11px]" style={{ color: 'var(--t2,#8b93a3)' }}>{pct}%</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </PullToRefresh>

      {detail && (
        <BottomSheet open={!!detail} onClose={() => setDetail(null)} title={detailData?.item?.title || 'Ведомость'}>
          {detailError ? (
            <div className="p-6 text-center space-y-3">
              <div className="opacity-70 text-sm">{detailError}</div>
              <button onClick={() => openDetail(detail)} className="px-5 py-2.5 rounded-xl font-semibold" style={{ background: '#D4A843', color: '#1a1408' }}>Повторить</button>
            </div>
          ) : !detailData ? <div className="p-6 text-center opacity-60">Загрузка…</div> : (
            <div className="p-4 space-y-4">
              <div className="text-sm" style={{ color: 'var(--t2,#8b93a3)' }}>
                {detailData.item.work_title} • {STATUS[detailData.item.status]}
              </div>
              {actionErr && <div className="text-sm rounded-xl p-3" style={{ background: 'rgba(255,92,92,.12)', color: '#ff5c5c' }}>{actionErr}</div>}
              {/* паллеты */}
              {detailData.pallets?.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {detailData.pallets.map(p => (
                    <div key={p.id} className="rounded-xl px-3 py-2 text-center" style={{ background: 'var(--bg-elevated,#161a22)', border: '1px solid var(--border,#262c38)' }}>
                      <Package size={16} className="mx-auto mb-1" style={{ color: '#D4A843' }} />
                      <div className="text-xs font-bold">№{p.pallet_number}</div>
                    </div>
                  ))}
                </div>
              )}
              {/* позиции */}
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {(detailData.items || []).map(it => (
                  <div key={it.id} className="flex items-center gap-3 rounded-xl p-3" style={{ background: 'var(--bg-elevated,#161a22)' }}>
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: it.packed ? '#30d158' : 'rgba(255,255,255,.06)' }}>
                      {it.packed && <Check size={16} color="#08210f" strokeWidth={3} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm truncate ${it.packed ? 'opacity-60 line-through' : ''}`} style={{ color: 'var(--t1,#e6e9ef)' }}>{it.name}</div>
                      <div className="text-xs" style={{ color: 'var(--t2,#8b93a3)' }}>{Number(it.quantity)} {it.unit}</div>
                    </div>
                  </div>
                ))}
              </div>
              {/* действия */}
              <div className="flex gap-2">
                {detailData.item.status === 'draft' && (
                  <button onClick={() => confirm(detail)} className="flex-1 py-3 rounded-xl font-semibold active:scale-95 transition" style={{ background: '#D4A843', color: '#1a1408' }}>✅ Подтвердить</button>
                )}
                {['confirmed', 'packing', 'packed'].includes(detailData.item.status) && (
                  <button onClick={() => send(detail)} className="flex-1 py-3 rounded-xl font-semibold active:scale-95 transition" style={{ background: '#4A90D9', color: '#fff' }}>🚛 Отправить</button>
                )}
              </div>
            </div>
          )}
        </BottomSheet>
      )}
    </PageShell>
  );
}
