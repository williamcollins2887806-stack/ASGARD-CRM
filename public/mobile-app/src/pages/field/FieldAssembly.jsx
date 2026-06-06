/**
 * FieldAssembly.jsx — Сбор паллет рабочими (Field PWA).
 * Список ведомостей моих работ → переход в сборщик паллет.
 * Решает главную боль: рабочие собирают паллеты в телефоне, а не «на листочек».
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';
import { ArrowLeft, Package, Boxes, Truck, RefreshCw, ChevronRight, ClipboardList } from 'lucide-react';

const TYPE_META = {
  mobilization: { label: 'Мобилизация', icon: Truck, color: '#F0C850' },
  demobilization: { label: 'Демобилизация', icon: Boxes, color: '#5aa0e0' },
  transfer: { label: 'Перемещение', icon: RefreshCw, color: '#30d158' },
};
const STATUS_LABEL = {
  draft: 'Черновик', confirmed: 'К сборке', packing: 'Идёт сборка', packed: 'Собрано',
  in_transit: 'В пути', received: 'Принято', returned: 'Возвращено', closed: 'Закрыто',
};

export default function FieldAssembly() {
  const nav = useNavigate();
  const haptic = useHaptic();
  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  async function load() {
    setLoading(true); setErr(null);
    try {
      const d = await fieldApi.get('/assembly/my');
      setLists(d.items || []);
    } catch (e) { setErr(e.message || 'Ошибка загрузки'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base,#0a0a14)', color: '#e6e9ef' }}>
      {/* Шапка */}
      <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3"
        style={{ background: 'rgba(10,10,20,.92)', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(240,200,80,.15)' }}>
        <button onClick={() => { haptic.light(); nav(-1); }} className="p-2 -ml-2 rounded-xl active:scale-90 transition">
          <ArrowLeft size={22} />
        </button>
        <div className="flex-1">
          <div className="font-bold text-lg" style={{ fontFamily: 'Cinzel,serif', color: '#F0C850' }}>Сбор паллет</div>
          <div className="text-xs opacity-60">Комплектация на склад и объект</div>
        </div>
        <button onClick={() => { haptic.light(); load(); }} className="p-2 rounded-xl active:scale-90 transition">
          <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="p-4 space-y-3">
        {loading && (
          <div className="space-y-3">
            {[0, 1, 2].map(i => (
              <div key={i} className="rounded-2xl h-24 animate-pulse" style={{ background: 'rgba(255,255,255,.04)' }} />
            ))}
          </div>
        )}

        {err && !loading && (
          <div className="text-center py-12">
            <Package size={48} className="mx-auto mb-3 opacity-30" />
            <div className="opacity-70">{err}</div>
            <button onClick={load} className="mt-4 px-5 py-2.5 rounded-xl font-semibold active:scale-95 transition"
              style={{ background: '#F0C850', color: '#1a1408' }}>Повторить</button>
          </div>
        )}

        {!loading && !err && lists.length === 0 && (
          <div className="text-center py-16">
            <ClipboardList size={56} className="mx-auto mb-4 opacity-25" />
            <div className="font-semibold mb-1">Нет ведомостей</div>
            <div className="text-sm opacity-50">Когда РП создаст сбор для вашей работы,<br />он появится здесь.</div>
          </div>
        )}

        {!loading && !err && lists.map((l, idx) => {
          const meta = TYPE_META[l.type] || TYPE_META.mobilization;
          const Icon = meta.icon;
          const pct = l.items_count > 0 ? Math.round((l.packed_count / l.items_count) * 100) : 0;
          return (
            <button key={l.id}
              onClick={() => { haptic.light(); nav(`/field/assembly/${l.id}`); }}
              className="w-full text-left rounded-2xl p-4 active:scale-[.98] transition"
              style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(240,200,80,.12)', animation: `fadeUp .3s ${idx * 0.04}s both` }}>
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: `${meta.color}22` }}>
                  <Icon size={22} style={{ color: meta.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{l.title || meta.label}</div>
                  <div className="text-xs opacity-60 truncate">{l.work_title}{l.object_name ? ` • ${l.object_name}` : ''}</div>
                </div>
                <ChevronRight size={18} className="opacity-40 flex-shrink-0" />
              </div>
              <div className="flex items-center gap-3 mt-3">
                <span className="text-[11px] px-2 py-0.5 rounded-full font-bold"
                  style={{ background: `${meta.color}22`, color: meta.color }}>{STATUS_LABEL[l.status] || l.status}</span>
                <span className="text-xs opacity-60">{l.items_count || 0} поз. • {l.pallets_count || 0} мест</span>
              </div>
              {/* прогресс */}
              <div className="mt-2.5 flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,.08)' }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: meta.color }} />
                </div>
                <span className="text-[11px] opacity-60 w-9 text-right">{pct}%</span>
              </div>
            </button>
          );
        })}
      </div>
      <style>{`@keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}`}</style>
    </div>
  );
}
