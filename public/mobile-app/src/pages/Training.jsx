import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { GraduationCap, Plus, ChevronRight, Check, X as XIcon } from 'lucide-react';
import { formatMoney, formatDate } from '@/lib/utils';
import AsgardSelect from '@/components/ui/AsgardSelect';

const STATUS_MAP = {
  draft: { label: 'Черновик', color: 'var(--text-tertiary)' },
  pending_approval: { label: 'На согласовании', color: 'var(--blue)' },
  approved: { label: 'Одобрена', color: 'var(--green)' },
  budget_approved: { label: 'Бюджет одобрен', color: 'var(--green)' },
  paid: { label: 'Оплачено', color: 'var(--green)' },
  completed: { label: 'Завершена', color: 'var(--green)' },
  rejected: { label: 'Отклонена', color: 'var(--red-soft)' },
};
const TYPE_MAP = { external: 'Внешнее', internal: 'Внутреннее', conference: 'Конференция', certification: 'Сертификация', online: 'Онлайн' };
const FILTERS = [
  { id: 'all', label: 'Все' }, { id: 'pending_approval', label: 'На согласовании' },
  { id: 'approved', label: 'Одобрена' }, { id: 'paid', label: 'Оплачено' }, { id: 'rejected', label: 'Отклонена' },
];
const APPROVE_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'HEAD_PM', 'HR_MANAGER'];

export default function Training() {
  const user = useAuthStore((s) => s.user);
  const haptic = useHaptic();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [detail, setDetail] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const canApprove = user && APPROVE_ROLES.includes(user.role);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try { const res = await api.get('/training-applications'); setItems(api.extractRows(res) || []); }
    catch { setItems([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    if (filter === 'all') return items;
    return items.filter((i) => i.status === filter);
  }, [items, filter]);

  const handleAction = async (id, action) => {
    haptic.light();
    try { await api.post(`/training-applications/${id}/${action}`); fetchData(); setDetail(null); haptic.success(); } catch {}
  };

  return (
    <PageShell title="Обучение" headerRight={<button onClick={() => { haptic.light(); setShowCreate(true); }} className="btn-icon spring-tap c-blue"><Plus size={22} /></button>}>
      <PullToRefresh onRefresh={fetchData}>
        <div className="flex gap-1.5 px-1 pb-3 overflow-x-auto no-scrollbar">
          {FILTERS.map((f) => <button key={f.id} onClick={() => { haptic.light(); setFilter(f.id); }} className="filter-pill spring-tap" data-active={filter === f.id}>{f.label}</button>)}
        </div>
        {loading ? <SkeletonList count={4} /> : filtered.length === 0 ? (
          <EmptyState icon={GraduationCap} iconColor="#7B68EE" iconBg="rgba(123,104,238,0.1)" title="Нет заявок" description="Заявки на обучение появятся здесь" />
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {filtered.map((item, i) => {
              const st = STATUS_MAP[item.status] || STATUS_MAP.draft;
              return (
                <button key={item.id} onClick={() => { haptic.light(); setDetail(item); }} className="w-full text-left rounded-2xl px-4 py-3 spring-tap card-glass" style={{ animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 40}ms both` }}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[14px] font-semibold leading-tight c-primary">{item.title || item.course_name || `#${item.id}`}</p>
                    <ChevronRight size={16} className="c-tertiary" style={{ flexShrink: 0, marginTop: 2 }} />
                  </div>
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: `color-mix(in srgb, ${st.color} 15%, transparent)`, color: st.color }}>{st.label}</span>
                    {item.type && <span className="text-[10px] c-secondary">{TYPE_MAP[item.type] || item.type}</span>}
                    {Number(item.cost) > 0 && <span className="text-[10px] font-semibold c-gold">{formatMoney(item.cost, { short: true })}</span>}
                    {(item.employee_name || item.employee_fio) && <span className="text-[10px] c-tertiary">{item.employee_name || item.employee_fio}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </PullToRefresh>
      <TrainingDetailSheet item={detail} onClose={() => setDetail(null)} canApprove={canApprove} onAction={handleAction} />
      <CreateTrainingSheet open={showCreate} onClose={() => setShowCreate(false)} onCreated={fetchData} />
    </PageShell>
  );
}

function TrainingDetailSheet({ item, onClose, canApprove, onAction }) {
  if (!item) return null;
  const st = STATUS_MAP[item.status] || STATUS_MAP.draft;
  const fields = [
    { label: 'Статус', value: st.label, color: st.color },
    item.type && { label: 'Тип', value: TYPE_MAP[item.type] || item.type },
    (item.employee_name || item.employee_fio) && { label: 'Сотрудник', value: item.employee_name || item.employee_fio },
    item.provider && { label: 'Провайдер', value: item.provider },
    Number(item.cost) > 0 && { label: 'Стоимость', value: formatMoney(item.cost) },
    item.date_from && { label: 'Начало', value: formatDate(item.date_from) },
    item.date_to && { label: 'Окончание', value: formatDate(item.date_to) },
    item.comment && { label: 'Обоснование', value: item.comment, full: true },
  ].filter(Boolean);
  return (
    <BottomSheet open={!!item} onClose={onClose} title={item.title || item.course_name || 'Обучение'}>
      <div className="flex flex-col gap-3 pb-4">
        {fields.map((f, i) => <div key={i}><p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5 c-tertiary">{f.label}</p>{f.color ? <span className="px-2.5 py-1 rounded-full text-[12px] font-semibold inline-block" style={{ background: `color-mix(in srgb, ${f.color} 15%, transparent)`, color: f.color }}>{f.value}</span> : <p className={`text-[14px] c-primary ${f.full ? 'whitespace-pre-wrap' : ''}`}>{f.value}</p>}</div>)}
        {canApprove && item.status === 'pending_approval' && (
          <div className="flex gap-2 mt-2">
            <button onClick={() => onAction(item.id, 'approve')} className="btn-action spring-tap c-green" style={{ background: 'color-mix(in srgb, var(--green) 15%, transparent)' }}><Check size={16} /> Одобрить</button>
            <button onClick={() => onAction(item.id, 'reject')} className="btn-action spring-tap c-red" style={{ background: 'color-mix(in srgb, var(--red-soft) 15%, transparent)' }}><XIcon size={16} /> Отклонить</button>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}

function CreateTrainingSheet({ open, onClose, onCreated }) {
  const haptic = useHaptic();
  const [title, setTitle] = useState('');
  const [type, setType] = useState('external');
  const [employee, setEmployee] = useState('');
  const [provider, setProvider] = useState('');
  const [cost, setCost] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const handleSubmit = async () => {
    if (!title.trim()) return;
    haptic.light(); setSaving(true);
    try {
      await api.post('/training-applications', { title: title.trim(), type, employee_name: employee || null, provider: provider || null, cost: cost ? Number(cost) : null, date_from: dateFrom || null, date_to: dateTo || null, comment: comment || null, status: 'pending_approval' });
      haptic.success(); setTitle(''); setType('external'); setEmployee(''); setProvider(''); setCost(''); setDateFrom(''); setDateTo(''); setComment(''); onClose(); onCreated();
    } catch {} setSaving(false);
  };
  return (
    <BottomSheet open={open} onClose={onClose} title="Заявка на обучение">
      <div className="flex flex-col gap-3 pb-4">
        <div><label className="input-label">Название *</label><input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Курс, тренинг..." className="input-field" /></div>
        <div><label className="input-label">Тип</label><AsgardSelect options={Object.entries(TYPE_MAP).map(([k, v]) => ({ value: k, label: v }))} value={type} onChange={(val) => setType(val)} placeholder="Тип обучения" /></div>
        <div><label className="input-label">Сотрудник</label><input type="text" value={employee} onChange={(e) => setEmployee(e.target.value)} placeholder="ФИО" className="input-field" /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="input-label">Провайдер</label><input type="text" value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="Компания" className="input-field" /></div>
          <div><label className="input-label">Стоимость (₽)</label><input type="number" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0" className="input-field" /></div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="input-label">Начало</label><input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input-field" /></div>
          <div><label className="input-label">Окончание</label><input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input-field" /></div>
        </div>
        <div><label className="input-label">Обоснование</label><textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Зачем нужно обучение..." rows={2} className="input-field resize-none" /></div>
        <button onClick={handleSubmit} disabled={!title.trim() || saving} className="btn-primary spring-tap mt-1">{saving ? 'Сохранение...' : 'Создать заявку'}</button>
      </div>
    </BottomSheet>
  );
}
