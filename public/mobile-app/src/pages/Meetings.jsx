import { useState, useEffect, useCallback, useMemo } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { CalendarDays, Plus, Search, X, ChevronRight, MapPin, Clock, Users } from 'lucide-react';
import { formatDate } from '@/lib/utils';

const FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'upcoming', label: 'Предстоящие' },
  { id: 'past', label: 'Прошедшие' },
];

export default function Meetings() {
  const haptic = useHaptic();
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [detail, setDetail] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const fetchMeetings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/meetings?limit=100');
      setMeetings(api.extractRows(res) || []);
    } catch { setMeetings([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchMeetings(); }, [fetchMeetings]);

  const filtered = useMemo(() => {
    const now = new Date();
    let list = meetings;
    if (filter === 'upcoming') list = list.filter((m) => new Date(m.date || m.start_time || m.start_date) > now);
    else if (filter === 'past') list = list.filter((m) => new Date(m.date || m.start_time || m.start_date) <= now);
    return list;
  }, [meetings, filter]);

  return (
    <PageShell title="Совещания" headerRight={
      <button onClick={() => { haptic.light(); setShowCreate(true); }} className="btn-icon spring-tap c-blue"><Plus size={22} /></button>
    }>
      <PullToRefresh onRefresh={fetchMeetings}>
        <div className="flex gap-1.5 px-1 pb-3 overflow-x-auto no-scrollbar">
          {FILTERS.map((f) => (
            <button key={f.id} onClick={() => { haptic.light(); setFilter(f.id); }} className="filter-pill spring-tap" data-active={filter === f.id}>{f.label}</button>
          ))}
        </div>
        {loading ? <SkeletonList count={4} /> : filtered.length === 0 ? (
          <EmptyState icon={CalendarDays} iconColor="var(--blue)" iconBg="rgba(74,144,217,0.1)" title="Нет совещаний" description="Совещания появятся здесь" />
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {filtered.map((m, i) => {
              const dt = new Date(m.date || m.start_time || m.start_date);
              const isPast = dt <= new Date();
              return (
                <button key={m.id} onClick={() => { haptic.light(); setDetail(m); }} className="w-full text-left rounded-2xl px-4 py-3 spring-tap card-glass" style={{ animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 50}ms both` }}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[14px] font-semibold leading-tight c-primary">{m.topic || m.title || `Совещание #${m.id}`}</p>
                    <ChevronRight size={16} className="c-tertiary" style={{ flexShrink: 0, marginTop: 2 }} />
                  </div>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: isPast ? 'color-mix(in srgb, var(--text-tertiary) 15%, transparent)' : 'color-mix(in srgb, var(--blue) 15%, transparent)', color: isPast ? 'var(--text-tertiary)' : 'var(--blue)' }}>{isPast ? 'Завершено' : 'Предстоит'}</span>
                    <span className="flex items-center gap-0.5 text-[10px] c-tertiary"><Clock size={10} />{formatDate(dt)}</span>
                    {m.location && <span className="flex items-center gap-0.5 text-[10px] c-tertiary"><MapPin size={10} />{m.location}</span>}
                    {m.organizer_name && <span className="text-[10px] c-tertiary">{m.organizer_name}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </PullToRefresh>
      <MeetingDetailSheet meeting={detail} onClose={() => setDetail(null)} />
      <CreateMeetingSheet open={showCreate} onClose={() => setShowCreate(false)} onCreated={fetchMeetings} />
    </PageShell>
  );
}

function MeetingDetailSheet({ meeting, onClose }) {
  if (!meeting) return null;
  const m = meeting;
  const fields = [
    { label: 'Тема', value: m.topic || m.title },
    (m.date || m.start_time) && { label: 'Дата', value: formatDate(m.date || m.start_time) },
    m.start_time && { label: 'Время', value: new Date(m.start_time).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) },
    m.organizer_name && { label: 'Организатор', value: m.organizer_name },
    m.location && { label: 'Место', value: m.location },
    m.description && { label: 'Описание', value: m.description, full: true },
    (m.protocol || m.minutes) && { label: 'Протокол', value: m.protocol || m.minutes, full: true },
  ].filter(Boolean);
  return (
    <BottomSheet open={!!meeting} onClose={onClose} title={m.topic || m.title || 'Совещание'}>
      <div className="flex flex-col gap-3 pb-4">
        {fields.map((f, i) => (
          <div key={i}>
            <p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5 c-tertiary">{f.label}</p>
            <p className={`text-[14px] c-primary ${f.full ? 'whitespace-pre-wrap' : ''}`}>{f.value}</p>
          </div>
        ))}
      </div>
    </BottomSheet>
  );
}

function CreateMeetingSheet({ open, onClose, onCreated }) {
  const haptic = useHaptic();
  const [topic, setTopic] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const handleSubmit = async () => {
    if (!topic.trim() || !date) return;
    haptic.light(); setSaving(true);
    try {
      await api.post('/meetings', { title: topic.trim(), start_time: time ? `${date}T${time}` : date, location: location || null, description: description || null });
      haptic.success(); setTopic(''); setDate(''); setTime(''); setLocation(''); setDescription(''); onClose(); onCreated();
    } catch {} setSaving(false);
  };
  return (
    <BottomSheet open={open} onClose={onClose} title="Новое совещание">
      <div className="flex flex-col gap-3 pb-4">
        <div><label className="input-label">Тема *</label><input type="text" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Тема совещания..." className="input-field" /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="input-label">Дата *</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input-field" /></div>
          <div><label className="input-label">Время</label><input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="input-field" /></div>
        </div>
        <div><label className="input-label">Место</label><input type="text" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Место проведения" className="input-field" /></div>
        <div><label className="input-label">Описание</label><textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Детали..." rows={2} className="input-field resize-none" /></div>
        <button onClick={handleSubmit} disabled={!topic.trim() || !date || saving} className="btn-primary spring-tap mt-1">{saving ? 'Сохранение...' : 'Создать'}</button>
      </div>
    </BottomSheet>
  );
}
