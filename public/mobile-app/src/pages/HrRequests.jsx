import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { UserPlus, Plus, ChevronRight, Check, X as XIcon } from 'lucide-react';
import { relativeTime, formatDate } from '@/lib/utils';
import AsgardSelect from '@/components/ui/AsgardSelect';

const STATUS_MAP = {
  draft: { label: 'Черновик', color: 'var(--text-tertiary)' },
  pending: { label: 'На рассмотрении', color: 'var(--blue)' },
  approved: { label: 'Одобрена', color: 'var(--green)' },
  rejected: { label: 'Отклонена', color: 'var(--red-soft)' },
  in_progress: { label: 'В работе', color: 'var(--blue)' },
  completed: { label: 'Завершена', color: 'var(--green)' },
  cancelled: { label: 'Отменена', color: 'var(--text-tertiary)' },
};
const TYPE_MAP = { hire: 'Найм', dismiss: 'Увольнение', transfer: 'Перевод', vacation: 'Отпуск', sick: 'Больничный', document: 'Документ', other: 'Прочее' };
const FILTERS = [
  { id: 'all', label: 'Все' }, { id: 'pending', label: 'На рассмотрении' },
  { id: 'approved', label: 'Одобрена' }, { id: 'in_progress', label: 'В работе' }, { id: 'rejected', label: 'Отклонена' },
];
const APPROVE_ROLES = ['ADMIN', 'HR', 'HR_MANAGER', 'DIRECTOR_GEN', 'DIRECTOR_COMM'];

export default function HrRequests() {
  const user = useAuthStore((s) => s.user);
  const haptic = useHaptic();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [detail, setDetail] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const canApprove = user && APPROVE_ROLES.includes(user.role);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try { const res = await api.get('/data/hr_requests'); setRequests(api.extractRows(res) || []); }
    catch { setRequests([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const filtered = useMemo(() => {
    if (filter === 'all') return requests;
    return requests.filter((r) => r.status === filter);
  }, [requests, filter]);

  const handleAction = async (id, status) => {
    haptic.light();
    try { await api.put(`/data/hr_requests/${id}`, { status }); setRequests((p) => p.map((r) => r.id === id ? { ...r, status } : r)); setDetail(null); haptic.success(); } catch {}
  };

  return (
    <PageShell title="Заявки HR" headerRight={<button onClick={() => { haptic.light(); setShowCreate(true); }} className="btn-icon spring-tap c-blue"><Plus size={22} /></button>}>
      <PullToRefresh onRefresh={fetchRequests}>
        <div className="flex gap-1.5 px-1 pb-3 overflow-x-auto no-scrollbar">
          {FILTERS.map((f) => <button key={f.id} onClick={() => { haptic.light(); setFilter(f.id); }} className="filter-pill spring-tap" data-active={filter === f.id}>{f.label}</button>)}
        </div>
        {loading ? <SkeletonList count={4} /> : filtered.length === 0 ? (
          <EmptyState icon={UserPlus} iconColor="#7B68EE" iconBg="rgba(123,104,238,0.1)" title="Нет заявок" description="HR-заявки появятся здесь" />
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {filtered.map((req, i) => {
              const st = STATUS_MAP[req.status] || STATUS_MAP.draft;
              const typeName = TYPE_MAP[req.type] || req.type || '—';
              return (
                <button key={req.id} onClick={() => { haptic.light(); setDetail(req); }} className="w-full text-left rounded-2xl px-4 py-3 spring-tap card-glass" style={{ animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 40}ms both` }}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[14px] font-semibold leading-tight c-primary">{typeName}: {req.employee_name || req.employee_fio || '—'}</p>
                    <ChevronRight size={16} className="c-tertiary" style={{ flexShrink: 0, marginTop: 2 }} />
                  </div>
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: `color-mix(in srgb, ${st.color} 15%, transparent)`, color: st.color }}>{st.label}</span>
                    {req.created_at && <span className="text-[10px] c-tertiary">{relativeTime(req.created_at)}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </PullToRefresh>
      <HrDetailSheet request={detail} onClose={() => setDetail(null)} canApprove={canApprove} onAction={handleAction} />
      <CreateHrSheet open={showCreate} onClose={() => setShowCreate(false)} onCreated={fetchRequests} />
    </PageShell>
  );
}

function HrDetailSheet({ request, onClose, canApprove, onAction }) {
  if (!request) return null;
  const r = request;
  const st = STATUS_MAP[r.status] || STATUS_MAP.draft;
  const fields = [
    { label: 'Статус', value: st.label, color: st.color },
    { label: 'Тип', value: TYPE_MAP[r.type] || r.type },
    { label: 'Сотрудник', value: r.employee_name || r.employee_fio || '—' },
    r.position && { label: 'Должность', value: r.position },
    r.department && { label: 'Отдел', value: r.department },
    r.date_from && { label: 'С', value: formatDate(r.date_from) },
    r.date_to && { label: 'По', value: formatDate(r.date_to) },
    r.comment && { label: 'Комментарий', value: r.comment, full: true },
    r.reason && { label: 'Причина', value: r.reason, full: true },
  ].filter(Boolean);
  return (
    <BottomSheet open={!!request} onClose={onClose} title={`${TYPE_MAP[r.type] || 'Заявка'}: ${r.employee_name || ''}`}>
      <div className="flex flex-col gap-3 pb-4">
        {fields.map((f, i) => <div key={i}><p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5 c-tertiary">{f.label}</p>{f.color ? <span className="px-2.5 py-1 rounded-full text-[12px] font-semibold inline-block" style={{ background: `color-mix(in srgb, ${f.color} 15%, transparent)`, color: f.color }}>{f.value}</span> : <p className={`text-[14px] c-primary ${f.full ? 'whitespace-pre-wrap' : ''}`}>{f.value}</p>}</div>)}
        {canApprove && r.status === 'pending' && (
          <div className="flex gap-2 mt-2">
            <button onClick={() => onAction(r.id, 'approved')} className="btn-action spring-tap c-green" style={{ background: 'color-mix(in srgb, var(--green) 15%, transparent)' }}><Check size={16} /> Одобрить</button>
            <button onClick={() => onAction(r.id, 'rejected')} className="btn-action spring-tap c-red" style={{ background: 'color-mix(in srgb, var(--red-soft) 15%, transparent)' }}><XIcon size={16} /> Отклонить</button>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}

function CreateHrSheet({ open, onClose, onCreated }) {
  const haptic = useHaptic();
  const [type, setType] = useState('hire');
  const [employee, setEmployee] = useState('');
  const [position, setPosition] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const handleSubmit = async () => {
    if (!employee.trim()) return;
    haptic.light(); setSaving(true);
    try {
      await api.post('/data/hr_requests', { type, employee_name: employee.trim(), position: position || null, date_from: dateFrom || null, date_to: dateTo || null, comment: comment || null, status: 'pending' });
      haptic.success(); setType('hire'); setEmployee(''); setPosition(''); setDateFrom(''); setDateTo(''); setComment(''); onClose(); onCreated();
    } catch {} setSaving(false);
  };
  return (
    <BottomSheet open={open} onClose={onClose} title="Новая заявка HR">
      <div className="flex flex-col gap-3 pb-4">
        <div><label className="input-label">Тип *</label><AsgardSelect options={Object.entries(TYPE_MAP).map(([k, v]) => ({ value: k, label: v }))} value={type} onChange={(val) => setType(val)} placeholder="Тип заявки" /></div>
        <div><label className="input-label">Сотрудник *</label><input type="text" value={employee} onChange={(e) => setEmployee(e.target.value)} placeholder="ФИО сотрудника" className="input-field" /></div>
        <div><label className="input-label">Должность</label><input type="text" value={position} onChange={(e) => setPosition(e.target.value)} placeholder="Должность" className="input-field" /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="input-label">С</label><input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input-field" /></div>
          <div><label className="input-label">По</label><input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input-field" /></div>
        </div>
        <div><label className="input-label">Комментарий</label><textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Детали..." rows={2} className="input-field resize-none" /></div>
        <button onClick={handleSubmit} disabled={!employee.trim() || saving} className="btn-primary spring-tap mt-1">{saving ? 'Сохранение...' : 'Создать заявку'}</button>
      </div>
    </BottomSheet>
  );
}
