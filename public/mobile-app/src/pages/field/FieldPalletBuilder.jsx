/**
 * FieldPalletBuilder.jsx — Сборщик паллет для рабочего (Field PWA).
 * Главный экран: паллеты, позиции, быстрое добавление (+новая за 10 сек),
 * раскидка по паллетам, отметка «собрано», live-прогресс (несколько сборщиков).
 */
import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';
import {
  ArrowLeft, Plus, Check, Package, PackagePlus, Layers, X,
  ShoppingCart, Warehouse, Hand, Users, RefreshCw,
} from 'lucide-react';

const SOURCE_META = {
  reservation: { label: 'Резерв', icon: Layers, color: '#8b93a3' },
  procurement_warehouse: { label: 'Склад', icon: Warehouse, color: '#5aa0e0' },
  procurement_object: { label: 'Закупка', icon: ShoppingCart, color: '#5aa0e0' },
  manual: { label: 'Вручную', icon: Hand, color: '#8b93a3' },
  on_site_purchase: { label: 'Куплено на объекте', icon: ShoppingCart, color: '#ffb020' },
  from_warehouse: { label: 'Со склада', icon: Warehouse, color: '#5aa0e0' },
};
const SOURCE_OPTIONS = [
  { value: 'from_warehouse', label: 'Со склада', icon: Warehouse },
  { value: 'on_site_purchase', label: 'Куплено на объекте', icon: ShoppingCart },
  { value: 'manual', label: 'Своё / прочее', icon: Hand },
];

export default function FieldPalletBuilder() {
  const { id } = useParams();
  const nav = useNavigate();
  const haptic = useHaptic();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [live, setLive] = useState(null);
  const [activePallet, setActivePallet] = useState(null); // id паллета для «куда кладём»
  const [showAdd, setShowAdd] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);
  function showErr(m) { haptic.error && haptic.error(); setToastMsg(m || 'Ошибка'); setTimeout(() => setToastMsg(null), 3500); }

  async function load() {
    try {
      const d = await fieldApi.get(`/assembly/${id}`);
      setData(d);
      if (d.pallets?.length && activePallet == null) setActivePallet(d.pallets[0].id);
      setErr(null);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }
  async function loadLive() {
    try { setLive(await fieldApi.get(`/assembly/${id}/live`)); } catch (_) {}
  }
  useEffect(() => { load(); loadLive(); }, [id]);
  // лёгкий поллинг live-прогресса (несколько сборщиков)
  useEffect(() => {
    const t = setInterval(loadLive, 12000);
    return () => clearInterval(t);
  }, [id]);

  const order = data?.item;
  const items = data?.items || [];
  const pallets = data?.pallets || [];
  const canPack = order && ['confirmed', 'packing'].includes(order.status);

  async function addPallet() {
    haptic.light();
    try { await fieldApi.post(`/assembly/${id}/pallets`, { label: null }); await load(); }
    catch (e) { showErr(e.message); }
  }

  async function togglePack(item) {
    if (!canPack) return;
    haptic.success();
    // оптимистично
    setData(d => ({ ...d, items: d.items.map(i => i.id === item.id ? { ...i, packed: !i.packed } : i) }));
    try { await fieldApi.put(`/assembly/${id}/items/${item.id}/pack`, { packed: !item.packed }); loadLive(); }
    catch (e) { showErr(e.message); load(); }
  }

  async function assignToPallet(item, palletId) {
    haptic.light();
    setData(d => ({ ...d, items: d.items.map(i => i.id === item.id ? { ...i, pallet_id: palletId } : i) }));
    try { await fieldApi.put(`/assembly/${id}/items/${item.id}/pallet`, { pallet_id: palletId }); }
    catch (e) { showErr(e.message); load(); }
  }

  // группировка: позиции без паллета + по паллетам
  const unassigned = items.filter(i => !i.pallet_id);
  const byPallet = pid => items.filter(i => i.pallet_id === pid);

  if (loading) return <ScreenSkeleton onBack={() => nav(-1)} />;

  return (
    <div className="min-h-screen pb-28" style={{ background: 'var(--bg-base,#0a0a14)', color: '#e6e9ef' }}>
      {/* Шапка */}
      <div className="sticky top-0 z-20 px-4 py-3"
        style={{ background: 'rgba(10,10,20,.92)', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(240,200,80,.15)' }}>
        <div className="flex items-center gap-3">
          <button onClick={() => { haptic.light(); nav(-1); }} className="p-2 -ml-2 rounded-xl active:scale-90 transition"><ArrowLeft size={22} /></button>
          <div className="flex-1 min-w-0">
            <div className="font-bold truncate" style={{ color: '#F0C850' }}>{order?.title || 'Сбор'}</div>
            <div className="text-xs opacity-60 truncate">{order?.work_title}</div>
          </div>
          <button onClick={() => { haptic.light(); load(); loadLive(); }} className="p-2 rounded-xl active:scale-90 transition"><RefreshCw size={18} /></button>
        </div>
        {/* Прогресс + кто собирает */}
        {live && (
          <div className="flex items-center gap-3 mt-2.5">
            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,.08)' }}>
              <div className="h-full rounded-full transition-all"
                style={{ width: `${live.totals.total > 0 ? Math.round(live.totals.packed / live.totals.total * 100) : 0}%`, background: '#30d158' }} />
            </div>
            <span className="text-[11px] opacity-70">{live.totals.packed}/{live.totals.total}</span>
            {live.by_user?.length > 0 && (
              <span className="flex items-center gap-1 text-[11px] opacity-60">
                <Users size={13} />{live.by_user.length}
              </span>
            )}
          </div>
        )}
      </div>

      {!canPack && (
        <div className="mx-4 mt-3 p-3 rounded-xl text-sm" style={{ background: 'rgba(255,176,32,.1)', color: '#ffb020' }}>
          {order?.status === 'draft' ? 'Ведомость ещё не подтверждена РП.' : `Статус: ${order?.status}. Сборка недоступна.`}
        </div>
      )}

      <div className="p-4 space-y-4">
        {/* Выбор активного паллета (куда кладём) */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs uppercase tracking-wide opacity-50 font-semibold">Паллеты</div>
            {canPack && (
              <button onClick={addPallet} className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg active:scale-95 transition"
                style={{ background: 'rgba(240,200,80,.15)', color: '#F0C850' }}><Plus size={14} />Паллет</button>
            )}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {pallets.length === 0 && <div className="text-sm opacity-50 py-2">Нет паллет. Создайте первый.</div>}
            {pallets.map(p => {
              const cnt = byPallet(p.id).length;
              const active = activePallet === p.id;
              return (
                <button key={p.id} onClick={() => { haptic.light(); setActivePallet(p.id); }}
                  className="flex-shrink-0 rounded-xl px-3.5 py-2.5 active:scale-95 transition text-center min-w-[78px]"
                  style={{ background: active ? 'rgba(240,200,80,.18)' : 'rgba(255,255,255,.04)', border: `1px solid ${active ? '#F0C850' : 'rgba(255,255,255,.08)'}` }}>
                  <Package size={18} className="mx-auto mb-1" style={{ color: active ? '#F0C850' : '#8b93a3' }} />
                  <div className="text-xs font-bold">№{p.pallet_number}</div>
                  <div className="text-[10px] opacity-60">{cnt} поз.</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Не распределённые позиции */}
        {unassigned.length > 0 && (
          <Section title={`Не на паллете (${unassigned.length})`}>
            {unassigned.map(it => (
              <ItemRow key={it.id} item={it} canPack={canPack}
                onPack={() => togglePack(it)}
                onAssign={activePallet ? () => assignToPallet(it, activePallet) : null}
                assignLabel={activePallet ? `→ №${pallets.find(p => p.id === activePallet)?.pallet_number}` : null} />
            ))}
          </Section>
        )}

        {/* Позиции по паллетам */}
        {pallets.map(p => {
          const list = byPallet(p.id);
          if (!list.length) return null;
          return (
            <Section key={p.id} title={`Паллет №${p.pallet_number} (${list.length})`}>
              {list.map(it => (
                <ItemRow key={it.id} item={it} canPack={canPack}
                  onPack={() => togglePack(it)}
                  onAssign={() => assignToPallet(it, null)} assignLabel="Снять" />
              ))}
            </Section>
          );
        })}

        {items.length === 0 && (
          <div className="text-center py-12 opacity-50">
            <PackagePlus size={48} className="mx-auto mb-3 opacity-40" />
            <div className="text-sm">Позиций нет. Добавьте первую кнопкой ниже.</div>
          </div>
        )}
      </div>

      {/* FAB добавить позицию */}
      {canPack && (
        <button onClick={() => { haptic.light(); setShowAdd(true); }}
          className="fixed bottom-6 right-5 z-30 flex items-center gap-2 px-5 py-3.5 rounded-2xl font-bold shadow-2xl active:scale-95 transition"
          style={{ background: '#F0C850', color: '#1a1408', boxShadow: '0 8px 30px rgba(240,200,80,.4)' }}>
          <Plus size={20} />Позиция
        </button>
      )}

      {showAdd && (
        <AddItemSheet assemblyId={id} activePallet={activePallet} pallets={pallets}
          onClose={() => setShowAdd(false)} onAdded={() => { setShowAdd(false); load(); loadLive(); }}
          onErr={showErr} />
      )}

      {toastMsg && (
        <div className="fixed left-4 right-4 z-50 px-4 py-3 rounded-xl text-sm font-medium text-center"
          style={{ bottom: 90, background: 'rgba(255,92,92,.95)', color: '#fff', boxShadow: '0 6px 24px rgba(0,0,0,.4)' }}>
          {toastMsg}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide opacity-50 font-semibold mb-2">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function ItemRow({ item, canPack, onPack, onAssign, assignLabel }) {
  const meta = SOURCE_META[item.source] || SOURCE_META.manual;
  return (
    <div className="rounded-xl p-3 flex items-center gap-3"
      style={{ background: 'rgba(255,255,255,.04)', border: `1px solid ${item.packed ? 'rgba(48,209,88,.3)' : 'rgba(255,255,255,.07)'}` }}>
      {/* чек собрано */}
      <button onClick={onPack} disabled={!canPack}
        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 active:scale-90 transition"
        style={{ background: item.packed ? '#30d158' : 'rgba(255,255,255,.06)', border: item.packed ? 'none' : '1px solid rgba(255,255,255,.15)' }}>
        {item.packed && <Check size={18} color="#08210f" strokeWidth={3} />}
      </button>
      <div className="flex-1 min-w-0">
        <div className={`font-medium text-sm truncate ${item.packed ? 'line-through opacity-60' : ''}`}>{item.name}</div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs opacity-70">{Number(item.quantity)} {item.unit}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: `${meta.color}22`, color: meta.color }}>{meta.label}</span>
          {item.over_received && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(255,176,32,.2)', color: '#ffb020' }}>излишек</span>}
        </div>
      </div>
      {onAssign && canPack && (
        <button onClick={onAssign} className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg flex-shrink-0 active:scale-95 transition"
          style={{ background: 'rgba(240,200,80,.12)', color: '#F0C850' }}>{assignLabel}</button>
      )}
    </div>
  );
}

/* ─── Лист добавления позиции: поиск каталога + создание новой за 10 сек ─── */
function AddItemSheet({ assemblyId, activePallet, pallets, onClose, onAdded, onErr }) {
  const haptic = useHaptic();
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [qty, setQty] = useState('1');
  const [unit, setUnit] = useState('шт');
  const [source, setSource] = useState('from_warehouse');
  const [saving, setSaving] = useState(false);
  const debRef = useRef(null);

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    clearTimeout(debRef.current);
    debRef.current = setTimeout(async () => {
      setSearching(true);
      try { const d = await fieldApi.get(`/assembly/catalog-search?q=${encodeURIComponent(q.trim())}`); setResults(d.items || []); }
      catch (_) { setResults([]); }
      finally { setSearching(false); }
    }, 280);
    return () => clearTimeout(debRef.current);
  }, [q]);

  async function add(productName, productId) {
    if (saving) return;
    setSaving(true); haptic.success();
    try {
      await fieldApi.post(`/assembly/${assemblyId}/items/quick`, {
        name: productName, unit, quantity: parseFloat(qty) || 1, source,
        product_id: productId || undefined, pallet_id: activePallet || undefined,
      });
      onAdded();
    } catch (e) { (onErr || (() => {}))(e.message); setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end" style={{ background: 'rgba(0,0,0,.6)' }} onClick={onClose}>
      <div className="w-full rounded-t-3xl p-5 pb-8 max-h-[88vh] overflow-y-auto" onClick={e => e.stopPropagation()}
        style={{ background: '#12121e', border: '1px solid rgba(240,200,80,.2)', animation: 'sheetUp .25s ease' }}>
        <div className="flex items-center justify-between mb-4">
          <div className="font-bold text-lg" style={{ color: '#F0C850' }}>Добавить позицию</div>
          <button onClick={onClose} className="p-1.5 rounded-lg active:scale-90"><X size={22} /></button>
        </div>
        {activePallet && (
          <div className="text-xs opacity-60 mb-3">На паллет №{pallets.find(p => p.id === activePallet)?.pallet_number}</div>
        )}

        {/* Поиск каталога */}
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Что кладём? (поиск по каталогу)"
          className="w-full px-4 py-3 rounded-xl text-base outline-none mb-3"
          style={{ background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.12)', color: '#e6e9ef' }} />

        {/* кол-во + ед + источник */}
        <div className="flex gap-2 mb-3">
          <input value={qty} onChange={e => setQty(e.target.value)} type="number" inputMode="decimal" placeholder="Кол-во"
            className="w-24 px-3 py-2.5 rounded-xl outline-none" style={{ background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.12)', color: '#e6e9ef' }} />
          <input value={unit} onChange={e => setUnit(e.target.value)} placeholder="ед"
            className="w-20 px-3 py-2.5 rounded-xl outline-none" style={{ background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.12)', color: '#e6e9ef' }} />
        </div>
        <div className="flex gap-2 mb-4">
          {SOURCE_OPTIONS.map(o => {
            const Ic = o.icon; const active = source === o.value;
            return (
              <button key={o.value} onClick={() => { haptic.light(); setSource(o.value); }}
                className="flex-1 flex flex-col items-center gap-1 py-2.5 rounded-xl active:scale-95 transition"
                style={{ background: active ? 'rgba(240,200,80,.16)' : 'rgba(255,255,255,.04)', border: `1px solid ${active ? '#F0C850' : 'rgba(255,255,255,.08)'}` }}>
                <Ic size={18} style={{ color: active ? '#F0C850' : '#8b93a3' }} />
                <span className="text-[10px] leading-tight text-center" style={{ color: active ? '#F0C850' : '#8b93a3' }}>{o.label}</span>
              </button>
            );
          })}
        </div>

        {/* Результаты каталога */}
        {searching && <div className="text-sm opacity-50 py-2">Поиск…</div>}
        {results.map(r => (
          <button key={r.id} onClick={() => add(r.name, r.id)} disabled={saving}
            className="w-full text-left rounded-xl px-4 py-3 mb-2 active:scale-[.98] transition flex items-center justify-between"
            style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)' }}>
            <div>
              <div className="font-medium text-sm">{r.name}</div>
              <div className="text-xs opacity-50">{r.category_name || ''}{r.article ? ` • ${r.article}` : ''}</div>
            </div>
            <Plus size={18} style={{ color: '#F0C850' }} />
          </button>
        ))}

        {/* Создать новую «за 10 сек» */}
        {q.trim().length >= 2 && !results.some(r => r.name.toLowerCase() === q.trim().toLowerCase()) && (
          <button onClick={() => add(q.trim(), null)} disabled={saving}
            className="w-full rounded-xl px-4 py-3.5 mt-1 font-semibold active:scale-[.98] transition flex items-center gap-3"
            style={{ background: 'rgba(48,209,88,.12)', border: '1px dashed rgba(48,209,88,.4)', color: '#30d158' }}>
            <PackagePlus size={20} />
            <span>Создать «{q.trim()}» {qty} {unit}</span>
          </button>
        )}
      </div>
      <style>{`@keyframes sheetUp{from{transform:translateY(100%)}to{transform:none}}`}</style>
    </div>
  );
}

function ScreenSkeleton({ onBack }) {
  return (
    <div className="min-h-screen p-4" style={{ background: 'var(--bg-base,#0a0a14)' }}>
      <div className="flex items-center gap-3 mb-5">
        <button onClick={onBack} className="p-2 -ml-2"><ArrowLeft size={22} color="#e6e9ef" /></button>
        <div className="h-5 w-40 rounded animate-pulse" style={{ background: 'rgba(255,255,255,.08)' }} />
      </div>
      {[0, 1, 2, 3].map(i => <div key={i} className="h-16 rounded-xl mb-2 animate-pulse" style={{ background: 'rgba(255,255,255,.05)' }} />)}
    </div>
  );
}
