import { useState, useEffect, useCallback, useMemo } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { ShoppingCart, Plus, ChevronRight } from 'lucide-react';
import { formatMoney, relativeTime } from '@/lib/utils';

const STATUS_MAP = {
  draft: { label: 'Черновик', color: 'var(--text-tertiary)' },
  sent: { label: 'Отправлена', color: 'var(--blue)' },
  answered: { label: 'Получен ответ', color: 'var(--gold)' },
  approved: { label: 'Одобрена', color: 'var(--green)' },
  rework: { label: 'Доработка', color: 'var(--gold)' },
  ordered: { label: 'Заказано', color: 'var(--blue)' },
  closed: { label: 'Закрыта', color: 'var(--text-tertiary)' },
};
const FILTERS = [
  { id: 'all', label: 'Все' }, { id: 'sent', label: 'Отправлена' },
  { id: 'answered', label: 'Ответ' }, { id: 'approved', label: 'Одобрена' }, { id: 'rework', label: 'Доработка' },
];

export default function ProcRequests() {
  const haptic = useHaptic();
  const [requests, setRequests] = useState([]);
  const [users, setUsers] = useState({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [detail, setDetail] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [reqRes, usersRes] = await Promise.all([
        api.get('/data/proc_requests?limit=200'),
        api.get('/users').catch(() => null),
      ]);
      setRequests(api.extractRows(reqRes) || []);
      if (usersRes) {
        const rows = api.extractRows(usersRes) || [];
        const map = {};
        rows.forEach((u) => { map[u.id] = u.full_name || u.login || `#${u.id}`; });
        setUsers(map);
      }
    } catch { setRequests([]); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    if (filter === 'all') return requests;
    return requests.filter((r) => r.status === filter);
  }, [requests, filter]);

  return (
    <PageShell title="Закупки" headerRight={<button onClick={() => { haptic.light(); setShowCreate(true); }} className="btn-icon spring-tap c-blue"><Plus size={22} /></button>}>
      <PullToRefresh onRefresh={fetchData}>
        <div className="flex gap-1.5 px-1 pb-3 overflow-x-auto no-scrollbar">
          {FILTERS.map((f) => <button key={f.id} onClick={() => { haptic.light(); setFilter(f.id); }} className="filter-pill spring-tap" data-active={filter === f.id}>{f.label}</button>)}
        </div>
        {loading ? <SkeletonList count={4} /> : filtered.length === 0 ? (
          <EmptyState icon={ShoppingCart} iconColor="var(--blue)" iconBg="rgba(74,144,217,0.1)" title="Нет заявок" description="Заявки на закупку появятся здесь" />
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {filtered.map((req, i) => {
              const st = STATUS_MAP[req.status] || STATUS_MAP.draft;
              let itemsCount = 0;
              try { const arr = typeof req.items_json === 'string' ? JSON.parse(req.items_json) : (req.items_json || []); itemsCount = arr.length; } catch {}
              return (
                <button key={req.id} onClick={() => { haptic.light(); setDetail(req); }} className="w-full text-left rounded-2xl px-4 py-3 spring-tap card-glass" style={{ animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 40}ms both` }}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[14px] font-semibold leading-tight c-primary">{req.work_title || req.title || `Заявка #${req.id}`}</p>
                    <ChevronRight size={16} className="c-tertiary" style={{ flexShrink: 0, marginTop: 2 }} />
                  </div>
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: `color-mix(in srgb, ${st.color} 15%, transparent)`, color: st.color }}>{st.label}</span>
                    {itemsCount > 0 && <span className="text-[10px] c-secondary">{itemsCount} поз.</span>}
                    {Number(req.total_sum) > 0 && <span className="text-[10px] font-semibold c-gold">{formatMoney(req.total_sum, { short: true })}</span>}
                    {req.pm_id && users[req.pm_id] && <span className="text-[10px] c-tertiary">{users[req.pm_id]}</span>}
                    {req.created_at && <span className="text-[10px] c-tertiary">{relativeTime(req.created_at)}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </PullToRefresh>
      <ProcDetailSheet request={detail} onClose={() => setDetail(null)} users={users} />
      <CreateProcSheet open={showCreate} onClose={() => setShowCreate(false)} onCreated={fetchData} />
    </PageShell>
  );
}

function ProcDetailSheet({ request, onClose, users }) {
  if (!request) return null;
  const r = request;
  const st = STATUS_MAP[r.status] || STATUS_MAP.draft;
  let items = [];
  try { items = typeof r.items_json === 'string' ? JSON.parse(r.items_json) : (r.items_json || []); } catch {}
  const fields = [
    { label: 'Статус', value: st.label, color: st.color },
    r.pm_id && users[r.pm_id] && { label: 'РП', value: users[r.pm_id] },
    r.work_title && { label: 'Проект', value: r.work_title },
    Number(r.total_sum) > 0 && { label: 'Сумма', value: formatMoney(r.total_sum) },
    r.comment && { label: 'Комментарий', value: r.comment, full: true },
  ].filter(Boolean);
  return (
    <BottomSheet open={!!request} onClose={onClose} title={r.work_title || `Заявка #${r.id}`}>
      <div className="flex flex-col gap-3 pb-4">
        {fields.map((f, i) => <div key={i}><p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5 c-tertiary">{f.label}</p>{f.color ? <span className="px-2.5 py-1 rounded-full text-[12px] font-semibold inline-block" style={{ background: `color-mix(in srgb, ${f.color} 15%, transparent)`, color: f.color }}>{f.value}</span> : <p className={`text-[14px] c-primary ${f.full ? 'whitespace-pre-wrap' : ''}`}>{f.value}</p>}</div>)}
        {items.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider mb-1.5 c-tertiary">Состав ({items.length})</p>
            <div className="flex flex-col gap-1.5">
              {items.map((item, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-2 rounded-xl" style={{ background: 'var(--bg-surface-alt)', border: '0.5px solid var(--border-norse)' }}>
                  <span className="text-[13px] c-primary">{item.name || '—'}</span>
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

function CreateProcSheet({ open, onClose, onCreated }) {
  const haptic = useHaptic();
  const [workTitle, setWorkTitle] = useState('');
  const [itemsText, setItemsText] = useState('');
  const [totalSum, setTotalSum] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const handleSubmit = async () => {
    if (!workTitle.trim() || !itemsText.trim()) return;
    haptic.light(); setSaving(true);
    const items = itemsText.trim().split('\n').filter(Boolean).map((line) => ({ name: line.trim() }));
    try {
      await api.post('/data/proc_requests', { work_title: workTitle.trim(), items_json: JSON.stringify(items), total_sum: totalSum ? Number(totalSum) : null, comment: comment || null, status: 'sent' });
      haptic.success(); setWorkTitle(''); setItemsText(''); setTotalSum(''); setComment(''); onClose(); onCreated();
    } catch {} setSaving(false);
  };
  const valid = workTitle.trim() && itemsText.trim();
  return (
    <BottomSheet open={open} onClose={onClose} title="Новая заявка">
      <div className="flex flex-col gap-3 pb-4">
        <div><label className="input-label">Проект *</label><input type="text" value={workTitle} onChange={(e) => setWorkTitle(e.target.value)} placeholder="Название проекта" className="input-field" /></div>
        <div><label className="input-label">Позиции * (по одной на строку)</label><textarea value={itemsText} onChange={(e) => setItemsText(e.target.value)} placeholder="Кабель ВВГнг 3x2.5&#10;Автомат ABB 25A&#10;..." rows={4} className="input-field resize-none" /></div>
        <div><label className="input-label">Сумма (₽)</label><input type="number" value={totalSum} onChange={(e) => setTotalSum(e.target.value)} placeholder="0" className="input-field" /></div>
        <div><label className="input-label">Комментарий</label><textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Детали..." rows={2} className="input-field resize-none" /></div>
        <button onClick={handleSubmit} disabled={!valid || saving} className="btn-primary spring-tap mt-1">{saving ? 'Сохранение...' : 'Создать заявку'}</button>
      </div>
    </BottomSheet>
  );
}
