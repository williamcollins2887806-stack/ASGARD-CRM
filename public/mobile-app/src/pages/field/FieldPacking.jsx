import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';
import { ArrowLeft, Package, CheckCircle, Circle, PlayCircle } from 'lucide-react';

const STATUS_CONFIG = {
  draft: { label: 'Черновик', color: '#6b7280' },
  active: { label: 'Активный', color: '#3b82f6' },
  in_progress: { label: 'В работе', color: '#f59e0b' },
  completed: { label: 'Готово', color: '#22c55e' },
};

export default function FieldPacking() {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      setLoading(true);
      const data = await fieldApi.get('/packing/my');
      setLists(Array.isArray(data) ? data : data?.rows || data?.lists || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function startList(id) {
    haptic.medium();
    try {
      await fieldApi.put(`/packing/my/${id}/start`);
      loadData();
    } catch (e) { setError(e.message); }
  }

  async function completeList(id) {
    haptic.success();
    try {
      await fieldApi.put(`/packing/my/${id}/complete`);
      loadData();
    } catch (e) { setError(e.message); }
  }

  async function toggleItem(listId, itemId, packed) {
    haptic.light();
    try {
      await fieldApi.put(`/packing/my/${listId}/items/${itemId}`, { is_packed: !packed });
      setLists((prev) => prev.map((l) => {
        if (l.id !== listId) return l;
        return { ...l, items: (l.items || []).map((it) => it.id === itemId ? { ...it, is_packed: !packed } : it) };
      }));
    } catch (e) { setError(e.message); }
  }

  if (loading) {
    return (
      <div className="p-4 space-y-4 animate-pulse">
        {[1, 2, 3].map((i) => <div key={i} className="h-24 rounded-xl" style={{ backgroundColor: 'var(--bg-elevated)' }} />)}
      </div>
    );
  }

  return (
    <div className="p-4 pb-24 space-y-4" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/field/home')} className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <ArrowLeft size={20} style={{ color: 'var(--text-primary)' }} />
        </button>
        <Package size={22} style={{ color: 'var(--gold)' }} />
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Упаковка</h1>
      </div>

      {error && <div className="p-3 rounded-lg text-sm" style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>{error}</div>}

      {lists.length === 0 ? (
        <div className="rounded-xl p-8 text-center" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <Package size={32} className="mx-auto mb-2" style={{ color: 'var(--text-tertiary)' }} />
          <p style={{ color: 'var(--text-tertiary)' }}>Нет упаковочных листов</p>
        </div>
      ) : (
        <div className="space-y-3">
          {lists.map((list) => {
            const cfg = STATUS_CONFIG[list.status] || STATUS_CONFIG.draft;
            const items = list.items || [];
            const packed = items.filter((it) => it.is_packed).length;
            const isExpanded = expandedId === list.id;
            return (
              <div key={list.id} className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
                {/* Header */}
                <button onClick={() => setExpandedId(isExpanded ? null : list.id)} className="w-full p-4 text-left">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{list.title || list.purpose || 'Упаковочный лист'}</p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{packed}/{items.length} собрано</p>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: cfg.color + '20', color: cfg.color }}>{cfg.label}</span>
                  </div>
                  {/* Progress bar */}
                  {items.length > 0 && (
                    <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-primary)' }}>
                      <div className="h-full rounded-full transition-all" style={{ width: `${(packed / items.length) * 100}%`, backgroundColor: cfg.color }} />
                    </div>
                  )}
                </button>

                {/* Expanded items */}
                {isExpanded && (
                  <div className="px-4 pb-4 space-y-2">
                    {items.map((item) => (
                      <button key={item.id} onClick={() => toggleItem(list.id, item.id, item.is_packed)} className="w-full flex items-center gap-3 p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-primary)' }}>
                        {item.is_packed ? <CheckCircle size={18} style={{ color: '#22c55e' }} /> : <Circle size={18} style={{ color: 'var(--text-tertiary)' }} />}
                        <span className="text-sm" style={{ color: item.is_packed ? 'var(--text-tertiary)' : 'var(--text-primary)', textDecoration: item.is_packed ? 'line-through' : 'none' }}>{item.name || item.title}</span>
                        {item.quantity > 1 && <span className="text-xs ml-auto" style={{ color: 'var(--text-tertiary)' }}>x{item.quantity}</span>}
                      </button>
                    ))}
                    {/* Actions */}
                    <div className="flex gap-2 mt-2">
                      {list.status === 'active' && (
                        <button onClick={() => startList(list.id)} className="flex-1 py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1" style={{ backgroundColor: '#3b82f620', color: '#3b82f6' }}>
                          <PlayCircle size={14} /> Начать сборку
                        </button>
                      )}
                      {list.status === 'in_progress' && packed === items.length && (
                        <button onClick={() => completeList(list.id)} className="flex-1 py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1" style={{ backgroundColor: '#22c55e20', color: '#22c55e' }}>
                          <CheckCircle size={14} /> Завершить
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
