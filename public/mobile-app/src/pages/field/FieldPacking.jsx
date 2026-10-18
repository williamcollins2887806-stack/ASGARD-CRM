import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';
import {
  ArrowLeft, Package, CheckCircle, Circle, PlayCircle, AlertTriangle, Camera, PackageCheck,
  RotateCcw, Square, ImagePlus,
} from 'lucide-react';
import { Card, IconTile, KeyButton, BottomSheet, ProgressBar, SectionLabel, EmptyState } from '@/components/field/ui';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import './field-screens.css';

const STATUS_CONFIG = {
  draft: { label: 'Черновик', color: 'var(--text-secondary)' },
  sent: { label: 'Назначен', color: 'var(--value-ink)' },
  active: { label: 'Активный', color: 'var(--acc)' },
  in_progress: { label: 'В сборке', color: 'var(--acc)' },
  completed: { label: 'Собран', color: 'var(--ok)' },
  shipped: { label: 'Отправлен', color: 'var(--acc)' },
};

const ITEM_STATUS = {
  pending: { label: 'Ожидает', color: 'var(--text-secondary)', Icon: Square },
  packed: { label: 'Собрано', color: 'var(--ok)', Icon: CheckCircle },
  shortage: { label: 'Недостача', color: 'var(--danger-ink)', Icon: AlertTriangle },
  replaced: { label: 'Замена', color: 'var(--value-ink)', Icon: RotateCcw },
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
      <div className="fs-root p-4" style={{ paddingTop: 'max(env(safe-area-inset-top), 16px)' }}>
        <SkeletonList count={3} />
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
    <div className="fs-root" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}>
      <div className="fs-scene" aria-hidden><span className="fs-orb fs-orb--a" /><span className="fs-orb fs-orb--b" /></div>

      <div className="fs-content space-y-4">
        {/* Header */}
        <div className="fs-head">
          <button onClick={() => navigate('/field/home')} className="fs-head__btn" aria-label="Назад">
            <ArrowLeft size={20} strokeWidth={2.3} />
          </button>
          <IconTile icon={Package} tone="value" size={40} />
          <h1 className="fs-head__title">Сборы</h1>
        </div>

        {error && (
          <Card variant="flat" tone="danger" className="p-3 text-sm" style={{ color: 'var(--danger-ink)' }}>{error}</Card>
        )}

        {/* Summary hero card */}
        {lists.length > 0 && (
          <Card variant="raised" className="p-5 relative overflow-hidden">
            <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-tertiary)' }}>Сборка</p>
            <p className="text-3xl font-bold" style={{ color: 'var(--value-ink)' }}>{pct}%</p>
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              {totalPacked} из {totalItems} позиций собрано
            </p>
            {/* Progress bar */}
            <div className="mt-2">
              <ProgressBar value={pct} color="linear-gradient(90deg, var(--value), var(--acc))" />
            </div>
            <div className="flex justify-center gap-6 mt-3">
              <span className="text-xs font-semibold flex items-center gap-1.5" style={{ color: 'var(--value-ink)' }}>
                <Package size={13} strokeWidth={2.4} /> Активных: {totalActive}
              </span>
              <span className="text-xs font-semibold flex items-center gap-1.5" style={{ color: 'var(--ok)' }}>
                <CheckCircle size={13} strokeWidth={2.4} /> Завершено: {totalCompleted}
              </span>
            </div>
          </Card>
        )}

        {lists.length === 0 ? (
          <EmptyState icon={Package} title="Нет назначенных листов сборки" description="Листы появятся, когда РП назначит сбор" />
        ) : (
          <div className="space-y-3">
            {lists.map((list) => {
              const cfg = STATUS_CONFIG[list.status] || STATUS_CONFIG.draft;
              const items = list.items || [];
              const packed = list.items_packed || items.filter((it) => it.is_packed || it.status === 'packed').length;
              const total = list.items_total || items.length;
              const listPct = total > 0 ? Math.round((packed / total) * 100) : 0;
              const isExpanded = expandedId === list.id;

              return (
                <Card key={list.id} variant="raised" className="overflow-hidden p-0">
                  {/* Header */}
                  <button onClick={() => setExpandedId(isExpanded ? null : list.id)} className="w-full p-4 text-left">
                    <div className="flex items-center justify-between gap-2">
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
                      <span className="text-xs px-2 py-0.5 rounded-full flex-shrink-0" style={{ backgroundColor: `color-mix(in oklab, ${cfg.color} 13%, transparent)`, color: cfg.color }}>{cfg.label}</span>
                    </div>
                    {list.description && (
                      <p className="text-xs mt-2 line-clamp-2" style={{ color: 'var(--text-tertiary)' }}>{list.description}</p>
                    )}
                    {/* Progress bar */}
                    {total > 0 && (
                      <div className="mt-2">
                        <ProgressBar value={listPct} color={cfg.color} />
                      </div>
                    )}
                  </button>

                  {/* Expanded items */}
                  {isExpanded && (
                    <div className="px-4 pb-4 space-y-2">
                      {items.map((item) => {
                        const st = ITEM_STATUS[item.status] || ITEM_STATUS.pending;
                        const StatusIcon = st.Icon;
                        const isPacked = item.status === 'packed' || item.status === 'replaced';
                        return (
                          <div key={item.id} className="flex items-center gap-3 p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-surface-alt)' }}>
                            <button onClick={() => toggleItem(list.id, item.id, item.status)} className="flex-shrink-0" aria-label="Отметить собранным">
                              <StatusIcon size={18} strokeWidth={2.3} style={{ color: st.color }} />
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
                                <span className="text-xs font-medium flex items-center gap-1" style={{ color: st.color }}>
                                  <StatusIcon size={11} strokeWidth={2.4} aria-hidden />
                                  {st.label}
                                </span>
                              )}
                            </div>
                            {/* Shortage button */}
                            {list.status === 'in_progress' && !isPacked && item.status !== 'shortage' && (
                              <button onClick={() => setShortageForm({ listId: list.id, itemId: item.id })}
                                className="p-1 flex-shrink-0" title="Недостача" aria-label="Отметить недостачу">
                                <AlertTriangle size={14} style={{ color: 'var(--danger-ink)' }} />
                              </button>
                            )}
                          </div>
                        );
                      })}

                      {/* Actions */}
                      <div className="flex gap-2 mt-2">
                        {/* 23.06.2026 BUG-FIX (🟡 S-FIELD-06): убрана мёртвая ветка status==='active'
                            (field_packing_lists.status — canon draft/sent/in_progress/completed/shipped, V061:84-85;
                            'active' бэкенд не записывает). */}
                        {list.status === 'sent' && (
                          <KeyButton tone="accent" size="sm" icon={PlayCircle} style={{ flex: 1 }} onClick={() => startList(list.id)}>
                            Начать сборку
                          </KeyButton>
                        )}
                        {list.status === 'in_progress' && packed === total && total > 0 && (
                          <KeyButton tone="status" size="sm" icon={PackageCheck} style={{ flex: 1 }} onClick={() => completeList(list.id)}>
                            Завершить
                          </KeyButton>
                        )}
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Shortage report sheet */}
      <BottomSheet open={!!shortageForm} onClose={() => setShortageForm(null)} title="Отчёт о недостаче">
        <div className="space-y-3 pb-2">
          <textarea value={shortageNote} onChange={(e) => setShortageNote(e.target.value)} rows={2} placeholder="Описание проблемы"
            className="w-full px-3 py-2.5 rounded-lg text-sm outline-none resize-none"
            style={{ backgroundColor: 'var(--bg-surface-alt)', border: '1px solid var(--tile-brd)', color: 'var(--text-primary)' }} />
          <label className="flex items-center gap-2 p-3 rounded-lg cursor-pointer"
            style={{ backgroundColor: 'var(--bg-surface-alt)', border: '1px dashed var(--tile-brd)' }}>
            <Camera size={16} style={{ color: 'var(--value-ink)' }} />
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Фото недостачи</span>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" />
          </label>
          <div className="flex gap-2">
            <KeyButton tone="neutral" style={{ flex: 1 }} onClick={() => setShortageForm(null)}>Отмена</KeyButton>
            <KeyButton tone="danger" style={{ flex: 1 }} onClick={() => reportShortage(shortageForm?.listId, shortageForm?.itemId)}>Недостача</KeyButton>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
