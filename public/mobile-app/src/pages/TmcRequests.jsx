import { useState, useEffect, useCallback, useMemo } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { Package, Plus, ChevronRight, Download } from 'lucide-react';
import { formatMoney, relativeTime } from '@/lib/utils';

const STATUS_MAP = {
  draft: { label: 'Черновик', color: 'var(--text-tertiary)' },
  submitted: { label: 'Подана', color: 'var(--blue)' },
  approved: { label: 'Одобрена', color: 'var(--green)' },
  rejected: { label: 'Отклонена', color: 'var(--red-soft)' },
  ordered: { label: 'Заказано', color: 'var(--blue)' },
  delivered: { label: 'Доставлено', color: 'var(--green)' },
  closed: { label: 'Закрыта', color: 'var(--text-tertiary)' },
};
const PRIORITY_MAP = {
  low: { label: 'Низкий', color: 'var(--text-tertiary)' },
  normal: { label: 'Обычный', color: 'var(--blue)' },
  high: { label: 'Высокий', color: 'var(--gold)' },
  urgent: { label: 'Срочный', color: 'var(--red-soft)' },
};
const FILTERS = [
  { id: 'all', label: 'Все' }, { id: 'submitted', label: 'Подана' },
  { id: 'approved', label: 'Одобрена' }, { id: 'ordered', label: 'Заказано' }, { id: 'delivered', label: 'Доставлено' },
];

export default function TmcRequests() {
  const haptic = useHaptic();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [detail, setDetail] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try { const res = await api.get('/tmc-requests'); setRequests(api.extractRows(res) || []); }
    catch { setRequests([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    if (filter === 'all') return requests;
    return requests.filter((r) => r.status === filter);
  }, [requests, filter]);

  return (
    <PageShell title="Заявки ТМЦ" headerRight={<button onClick={() => { haptic.light(); setShowCreate(true); }} className="btn-icon spring-tap c-blue"><Plus size={22} /></button>}>
      <PullToRefresh onRefresh={fetchData}>
        <div className="flex gap-1.5 px-1 pb-3 overflow-x-auto no-scrollbar">
          {FILTERS.map((f) => <button key={f.id} onClick={() => { haptic.light(); setFilter(f.id); }} className="filter-pill spring-tap" data-active={filter === f.id}>{f.label}</button>)}
        </div>
        {loading ? <SkeletonList count={4} /> : filtered.length === 0 ? (
          <EmptyState icon={Package} iconColor="var(--gold)" iconBg="color-mix(in srgb, var(--gold) 10%, transparent)" title="Нет заявок" description="Заявки на ТМЦ появятся здесь" />
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {filtered.map((req, i) => {
              const st = STATUS_MAP[req.status] || STATUS_MAP.draft;
              const pr = PRIORITY_MAP[req.priority] || PRIORITY_MAP.normal;
              return (
                <button key={req.id} onClick={() => { haptic.light(); setDetail(req); }} className="w-full text-left rounded-2xl px-4 py-3 spring-tap card-glass" style={{ animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 40}ms both` }}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[14px] font-semibold leading-tight c-primary">{req.title || `Заявка #${req.id}`}</p>
                    <ChevronRight size={16} className="c-tertiary" style={{ flexShrink: 0, marginTop: 2 }} />
                  </div>
                  {req.work_title && <p className="text-[12px] mt-0.5 truncate c-secondary">{req.work_title}</p>}
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: `color-mix(in srgb, ${st.color} 15%, transparent)`, color: st.color }}>{st.label}</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: `color-mix(in srgb, ${pr.color} 15%, transparent)`, color: pr.color }}>{pr.label}</span>
                    {Number(req.total_sum) > 0 && <span className="text-[10px] font-semibold c-gold">{formatMoney(req.total_sum, { short: true })}</span>}
                    {req.created_at && <span className="text-[10px] c-tertiary">{relativeTime(req.created_at)}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </PullToRefresh>
      <TmcDetailSheet request={detail} onClose={() => setDetail(null)} />
      <CreateTmcSheet open={showCreate} onClose={() => setShowCreate(false)} onCreated={fetchData} />
    </PageShell>
  );
}

function TmcDetailSheet({ request, onClose }) {
  if (!request) return null;
  const r = request;
  const st = STATUS_MAP[r.status] || STATUS_MAP.draft;
  const pr = PRIORITY_MAP[r.priority] || PRIORITY_MAP.normal;
  let items = [];
  try { items = typeof r.items_json === 'string' ? JSON.parse(r.items_json) : (r.items_json || []); } catch {}
  const fields = [
    { label: 'Статус', value: st.label, color: st.color },
    { label: 'Приоритет', value: pr.label, color: pr.color },
    r.work_title && { label: 'Проект', value: r.work_title },
    Number(r.total_sum) > 0 && { label: 'Сумма', value: formatMoney(r.total_sum) },
    r.comment && { label: 'Комментарий', value: r.comment, full: true },
  ].filter(Boolean);
  return (
    <BottomSheet open={!!request} onClose={onClose} title={r.title || `Заявка #${r.id}`}>
      <div className="flex flex-col gap-3 pb-4">
        {fields.map((f, i) => <div key={i}><p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5 c-tertiary">{f.label}</p>{f.color ? <span className="px-2.5 py-1 rounded-full text-[12px] font-semibold inline-block" style={{ background: `color-mix(in srgb, ${f.color} 15%, transparent)`, color: f.color }}>{f.value}</span> : <p className={`text-[14px] c-primary ${f.full ? 'whitespace-pre-wrap' : ''}`}>{f.value}</p>}</div>)}
        {items.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider mb-1.5 c-tertiary">Состав ({items.length})</p>
            <div className="flex flex-col gap-1.5">
              {items.map((item, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-2 rounded-xl" style={{ background: 'var(--bg-surface-alt)', border: '0.5px solid var(--border-norse)' }}>
                  <span className="text-[13px] c-primary">{item.name || item.title || '—'}</span>
                  <span className="text-[12px] font-semibold c-secondary">{item.quantity || ''} {item.unit || ''}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}

function CreateTmcSheet({ open, onClose, onCreated }) {
  const haptic = useHaptic();
  const [title, setTitle] = useState('');
  const [workTitle, setWorkTitle] = useState('');
  const [priority, setPriority] = useState('normal');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const handleSubmit = async () => {
    if (!title.trim()) return;
    haptic.light(); setSaving(true);
    try {
      await api.post('/tmc-requests', { title: title.trim(), work_title: workTitle || null, priority, comment: comment || null });
      haptic.success(); setTitle(''); setWorkTitle(''); setPriority('normal'); setComment(''); onClose(); onCreated();
    } catch {} setSaving(false);
  };
  return (
    <BottomSheet open={open} onClose={onClose} title="Новая заявка ТМЦ">
      <div className="flex flex-col gap-3 pb-4">
        <div><label className="input-label">Название *</label><input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название заявки" className="input-field" /></div>
        <div><label className="input-label">Проект</label><input type="text" value={workTitle} onChange={(e) => setWorkTitle(e.target.value)} placeholder="Название проекта" className="input-field" /></div>
        <div><label className="input-label">Приоритет</label><select value={priority} onChange={(e) => setPriority(e.target.value)} className="input-field appearance-none"><option value="low">Низкий</option><option value="normal">Обычный</option><option value="high">Высокий</option><option value="urgent">Срочный</option></select></div>
        <div><label className="input-label">Комментарий</label><textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Детали..." rows={2} className="input-field resize-none" /></div>
        <button onClick={handleSubmit} disabled={!title.trim() || saving} className="btn-primary spring-tap mt-1">{saving ? 'Сохранение...' : 'Создать заявку'}</button>
      </div>
    </BottomSheet>
  );
}
