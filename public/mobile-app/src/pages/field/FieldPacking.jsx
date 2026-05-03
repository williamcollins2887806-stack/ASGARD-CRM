import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';
import { ArrowLeft, Package, CheckCircle, Circle, PlayCircle, AlertTriangle, RefreshCw, Camera } from 'lucide-react';

const STATUS_CONFIG = {
  draft: { label: 'Черновик', color: '#6b7280' },
  sent: { label: 'Назначен', color: '#f59e0b' },
  active: { label: 'Активный', color: '#3b82f6' },
  in_progress: { label: 'В сборке', color: '#5AC8FA' },
  completed: { label: 'Собран', color: '#22c55e' },
  shipped: { label: 'Отправлен', color: '#8b5cf6' },
};

const ITEM_STATUS = {
  pending: { label: 'Ожидает', color: '#6b7280', icon: '⬜' },
  packed: { label: 'Собрано', color: '#22c55e', icon: '✅' },
  shortage: { label: 'Недостача', color: '#ef4444', icon: '⚠️' },
  replaced: { label: 'Замена', color: '#f59e0b', icon: '🔄' },
};

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('ru-RU') : '';

export default function FieldPacking() {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [error, setError] = useState(null);
  const [shortageForm, setShortageForm] = useState(null); // { listId, itemId }
  const [shortageNote, setShortageNote] = useState('');
  const fileRef = useRef(null);

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

  async function toggleItem(listId, itemId, currentStatus) {
    haptic.light();
    const newStatus = currentStatus === 'packed' ? 'pending' : 'packed';
    try {
      await fieldApi.put(`/packing/my/${listId}/items/${itemId}`, { status: newStatus, is_packed: newStatus === 'packed' });
      setLists(prev => prev.map(l => {
        if (l.id !== listId) return l;
        return {
          ...l,
          items: (l.items || []).map(it => it.id === itemId ? { ...it, status: newStatus, is_packed: newStatus === 'packed' } : it),
          items_packed: (l.items || []).filter(it => (it.id === itemId ? newStatus === 'packed' : (it.is_packed || it.status === 'packed'))).length,
        };
      }));
    } catch (e) { setError(e.message); }
  }

  async function reportShortage(listId, itemId) {
    haptic.medium();
    try {
      const body = { status: 'shortage', note: shortageNote };
      if (fileRef.current?.files?.[0]) {
        const formData = new FormData();
        formData.append('status', 'shortage');
        formData.append('note', shortageNote);
        formData.append('photo', fileRef.current.files[0]);
        const token = localStorage.getItem('field_token');
        await fetch(`/api/field/packing/my/${listId}/items/${itemId}/photo`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
      } else {
        await fieldApi.put(`/packing/my/${listId}/items/${itemId}`, body);
      }
      haptic.success();
      setShortageForm(null);
      setShortageNote('');
      loadData();
    } catch (e) { setError(e.message); }
  }

  if (loading) {
    return (
      <div className="p-4 space-y-4 animate-pulse">
        {[1, 2, 3].map(i => <div key={i} className="h-24 rounded-xl" style={{ backgroundColor: 'var(--bg-elevated)' }} />)}
      </div>
    );
  }

  // Summary stats
  let totalActive = 0, totalCompleted = 0, totalItems = 0, totalPacked = 0;
  lists.forEach(l => {
    if (['completed', 'shipped'].includes(l.status)) totalCompleted++;
    else totalActive++;
    totalItems += parseInt(l.items_total || (l.items || []).length) || 0;
    totalPacked += parseInt(l.items_packed || (l.items || []).filter(it => it.is_packed || it.status === 'packed').length) || 0;
  });
  const pct = totalItems > 0 ? Math.round((totalPacked / totalItems) * 100) : 0;

  return (
    <div className="p-4 pb-24 space-y-4" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/field/home')} className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <ArrowLeft size={20} style={{ color: 'var(--text-primary)' }} />
        </button>
        <Package size={22} style={{ color: 'var(--gold)' }} />
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Сборы</h1>
      </div>

      {error && <div className="p-3 rounded-lg text-sm" style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>{error}</div>}

      {/* Summary hero card */}
      {lists.length > 0 && (
        <div className="rounded-xl p-5 relative overflow-hidden" style={{
          background: 'linear-gradient(135deg, var(--bg-elevated) 0%, rgba(196,154,42,0.08) 100%)',
          border: '1px solid var(--border-norse)',
        }}>
          <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-tertiary)' }}>Сборка</p>
          <p className="text-3xl font-bold" style={{ color: 'var(--gold)' }}>{pct}%</p>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            {totalPacked} из {totalItems} позиций собрано
          </p>
          {/* Progress bar */}
          <div className="mt-2 rounded" style={{ background: 'rgba(255,255,255,0.08)', height: '6px', overflow: 'hidden' }}>
            <div className="rounded" style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg, var(--gold), #f5c542)', transition: 'width 0.8s ease' }} />
          </div>
          <div className="flex justify-center gap-6 mt-3">
            <span className="text-xs font-semibold" style={{ color: '#f59e0b' }}>🔥 Активных: {totalActive}</span>
            <span className="text-xs font-semibold" style={{ color: '#22c55e' }}>✅ Завершено: {totalCompleted}</span>
          </div>
        </div>
      )}

      {lists.length === 0 ? (
        <div className="rounded-xl p-8 text-center" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <Package size={32} className="mx-auto mb-2" style={{ color: 'var(--text-tertiary)' }} />
          <p style={{ color: 'var(--text-tertiary)' }}>Нет назначенных листов сборки</p>
        </div>
      ) : (
        <div className="space-y-3">
          {lists.map((list) => {
            const cfg = STATUS_CONFIG[list.status] || STATUS_CONFIG.draft;
            const items = list.items || [];
            const packed = list.items_packed || items.filter(it => it.is_packed || it.status === 'packed').length;
            const total = list.items_total || items.length;
            const listPct = total > 0 ? Math.round((packed / total) * 100) : 0;
            const isExpanded = expandedId === list.id;

            return (
              <div key={list.id} className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
                {/* Header */}
                <button onClick={() => setExpandedId(isExpanded ? null : list.id)} className="w-full p-4 text-left">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{list.title || list.purpose || 'Лист сборки'}</p>
                      {list.work_title && (
                        <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-tertiary)' }}>{list.work_title}</p>
                      )}
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{packed}/{total} собрано</span>
                        {list.due_date && (
                          <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>· Срок: {fmtDate(list.due_date)}</span>
                        )}
                      </div>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full flex-shrink-0" style={{ backgroundColor: cfg.color + '20', color: cfg.color }}>{cfg.label}</span>
                  </div>
                  {list.description && (
                    <p className="text-xs mt-2 line-clamp-2" style={{ color: 'var(--text-tertiary)' }}>{list.description}</p>
                  )}
                  {/* Progress bar */}
                  {total > 0 && (
                    <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-primary)' }}>
                      <div className="h-full rounded-full transition-all" style={{ width: `${listPct}%`, backgroundColor: cfg.color }} />
                    </div>
                  )}
                </button>

                {/* Expanded items */}
                {isExpanded && (
                  <div className="px-4 pb-4 space-y-2">
                    {items.map((item) => {
                      const st = ITEM_STATUS[item.status] || ITEM_STATUS.pending;
                      const isPacked = item.status === 'packed' || item.status === 'replaced';
                      return (
                        <div key={item.id} className="flex items-center gap-3 p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-primary)' }}>
                          <button onClick={() => toggleItem(list.id, item.id, item.status)} className="flex-shrink-0">
                            {isPacked ? <CheckCircle size={18} style={{ color: '#22c55e' }} /> : item.status === 'shortage' ? <AlertTriangle size={18} style={{ color: '#ef4444' }} /> : <Circle size={18} style={{ color: 'var(--text-tertiary)' }} />}
                          </button>
                          <div className="flex-1 min-w-0">
                            <span className="text-sm" style={{ color: isPacked ? 'var(--text-tertiary)' : 'var(--text-primary)', textDecoration: isPacked ? 'line-through' : 'none' }}>
                              {item.name || item.title}
                            </span>
                            {/* Category + unit */}
                            <div className="flex items-center gap-2">
                              {item.item_category && (
                                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{item.item_category}</span>
                              )}
                              {item.quantity > 1 && (
                                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>x{item.quantity} {item.unit || 'шт'}</span>
                              )}
                            </div>
                            {/* Status badge for shortage/replaced */}
                            {(item.status === 'shortage' || item.status === 'replaced') && (
                              <span className="text-xs font-medium" style={{ color: st.color }}>{st.icon} {st.label}</span>
                            )}
                          </div>
                          {/* Shortage button */}
                          {list.status === 'in_progress' && !isPacked && item.status !== 'shortage' && (
                            <button onClick={() => setShortageForm({ listId: list.id, itemId: item.id })}
                              className="p-1 flex-shrink-0" title="Недостача">
                              <AlertTriangle size={14} style={{ color: '#ef4444' }} />
                            </button>
                          )}
                        </div>
                      );
                    })}

                    {/* Actions */}
                    <div className="flex gap-2 mt-2">
                      {(list.status === 'active' || list.status === 'sent') && (
                        <button onClick={() => startList(list.id)} className="flex-1 py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1" style={{ backgroundColor: '#3b82f620', color: '#3b82f6' }}>
                          <PlayCircle size={14} /> Начать сборку
                        </button>
                      )}
                      {list.status === 'in_progress' && packed === total && total > 0 && (
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

      {/* Shortage report form */}
      {shortageForm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={() => setShortageForm(null)}>
          <div className="w-full max-w-md rounded-t-2xl p-5 space-y-3" style={{ backgroundColor: 'var(--bg-primary)' }} onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>Отчёт о недостаче</h2>
            <textarea value={shortageNote} onChange={e => setShortageNote(e.target.value)} rows={2} placeholder="Описание проблемы"
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none resize-none"
              style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }} />
            <label className="flex items-center gap-2 p-3 rounded-lg cursor-pointer"
              style={{ backgroundColor: 'var(--bg-elevated)', border: '1px dashed var(--border-norse)' }}>
              <Camera size={16} style={{ color: 'var(--gold)' }} />
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Фото недостачи</span>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" />
            </label>
            <div className="flex gap-2">
              <button onClick={() => setShortageForm(null)} className="flex-1 py-2.5 rounded-lg text-sm"
                style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>Отмена</button>
              <button onClick={() => reportShortage(shortageForm.listId, shortageForm.itemId)}
                className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white"
                style={{ backgroundColor: '#ef4444' }}>Недостача</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
