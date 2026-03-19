import { useState, useEffect, useCallback, useMemo } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { Plane, Plus, ChevronRight, MapPin, Calendar } from 'lucide-react';
import { formatDate, formatMoney } from '@/lib/utils';

function getTripStatus(trip) {
  if (trip.status === 'cancelled') return { label: 'Отменена', color: 'var(--red-soft)' };
  const now = new Date();
  const start = new Date(trip.start_date);
  const end = new Date(trip.end_date);
  if (start > now) return { label: 'Предстоит', color: 'var(--gold)' };
  if (end < now) return { label: 'Завершена', color: 'var(--green)' };
  return { label: 'В командировке', color: 'var(--blue)' };
}

const FILTERS = [
  { id: 'all', label: 'Все' }, { id: 'active', label: 'Текущие' },
  { id: 'upcoming', label: 'Предстоящие' }, { id: 'completed', label: 'Завершённые' },
];

export default function Travel() {
  const haptic = useHaptic();
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [detail, setDetail] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const fetchTrips = useCallback(async () => {
    setLoading(true);
    try { const res = await api.get('/travel?limit=100'); setTrips(api.extractRows(res) || []); }
    catch { setTrips([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchTrips(); }, [fetchTrips]);

  const filtered = useMemo(() => {
    const now = new Date();
    if (filter === 'active') return trips.filter((t) => new Date(t.start_date) <= now && new Date(t.end_date) >= now);
    if (filter === 'upcoming') return trips.filter((t) => new Date(t.start_date) > now);
    if (filter === 'completed') return trips.filter((t) => new Date(t.end_date) < now);
    return trips;
  }, [trips, filter]);

  return (
    <PageShell title="Командировки" headerRight={<button onClick={() => { haptic.light(); setShowCreate(true); }} className="btn-icon spring-tap c-blue"><Plus size={22} /></button>}>
      <PullToRefresh onRefresh={fetchTrips}>
        <div className="flex gap-1.5 px-1 pb-3 overflow-x-auto no-scrollbar">
          {FILTERS.map((f) => <button key={f.id} onClick={() => { haptic.light(); setFilter(f.id); }} className="filter-pill spring-tap" data-active={filter === f.id}>{f.label}</button>)}
        </div>
        {loading ? <SkeletonList count={4} /> : filtered.length === 0 ? (
          <EmptyState icon={Plane} iconColor="var(--blue)" iconBg="rgba(74,144,217,0.1)" title="Нет командировок" description="Командировки появятся здесь" />
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {filtered.map((trip, i) => {
              const st = getTripStatus(trip);
              return (
                <button key={trip.id} onClick={() => { haptic.light(); setDetail(trip); }} className="w-full text-left rounded-2xl px-4 py-3 spring-tap card-glass" style={{ animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 50}ms both` }}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[14px] font-semibold leading-tight c-primary">{trip.destination || trip.city || `Командировка #${trip.id}`}</p>
                    <ChevronRight size={16} className="c-tertiary" style={{ flexShrink: 0, marginTop: 2 }} />
                  </div>
                  {(trip.purpose || trip.object_name) && <p className="text-[12px] mt-0.5 truncate c-secondary">{trip.purpose || trip.object_name}</p>}
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: `color-mix(in srgb, ${st.color} 15%, transparent)`, color: st.color }}>{st.label}</span>
                    <span className="flex items-center gap-0.5 text-[10px] c-tertiary"><Calendar size={10} />{formatDate(trip.start_date)} — {formatDate(trip.end_date)}</span>
                    {trip.employee_name && <span className="text-[10px] c-tertiary">{trip.employee_name}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </PullToRefresh>
      <TripDetailSheet trip={detail} onClose={() => setDetail(null)} />
      <CreateTripSheet open={showCreate} onClose={() => setShowCreate(false)} onCreated={fetchTrips} />
    </PageShell>
  );
}

function TripDetailSheet({ trip, onClose }) {
  if (!trip) return null;
  const st = getTripStatus(trip);
  const fields = [
    { label: 'Статус', value: st.label, color: st.color },
    { label: 'Направление', value: trip.destination || trip.city || '—' },
    trip.purpose && { label: 'Цель', value: trip.purpose },
    { label: 'Начало', value: formatDate(trip.start_date) },
    { label: 'Окончание', value: formatDate(trip.end_date) },
    trip.employee_name && { label: 'Сотрудник', value: trip.employee_name },
    trip.object_name && { label: 'Объект', value: trip.object_name },
    Number(trip.budget) > 0 && { label: 'Бюджет', value: formatMoney(trip.budget) },
    trip.accommodation && { label: 'Жильё', value: trip.accommodation },
    trip.transport && { label: 'Транспорт', value: trip.transport },
  ].filter(Boolean);
  return (
    <BottomSheet open={!!trip} onClose={onClose} title={trip.destination || trip.city || 'Командировка'}>
      <div className="flex flex-col gap-3 pb-4">
        {fields.map((f, i) => <div key={i}><p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5 c-tertiary">{f.label}</p>{f.color ? <span className="px-2.5 py-1 rounded-full text-[12px] font-semibold inline-block" style={{ background: `color-mix(in srgb, ${f.color} 15%, transparent)`, color: f.color }}>{f.value}</span> : <p className="text-[14px] c-primary">{f.value}</p>}</div>)}
      </div>
    </BottomSheet>
  );
}

function CreateTripSheet({ open, onClose, onCreated }) {
  const haptic = useHaptic();
  const [dest, setDest] = useState('');
  const [purpose, setPurpose] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [budget, setBudget] = useState('');
  const [saving, setSaving] = useState(false);
  const handleSubmit = async () => {
    if (!dest.trim() || !startDate || !endDate) return;
    haptic.light(); setSaving(true);
    try {
      await api.post('/travel', { destination: dest.trim(), purpose: purpose || null, start_date: startDate, end_date: endDate, budget: budget ? Number(budget) : null });
      haptic.success(); setDest(''); setPurpose(''); setStartDate(''); setEndDate(''); setBudget(''); onClose(); onCreated();
    } catch {} setSaving(false);
  };
  const valid = dest.trim() && startDate && endDate;
  return (
    <BottomSheet open={open} onClose={onClose} title="Новая командировка">
      <div className="flex flex-col gap-3 pb-4">
        <div><label className="input-label">Направление *</label><input type="text" value={dest} onChange={(e) => setDest(e.target.value)} placeholder="Город / регион" className="input-field" /></div>
        <div><label className="input-label">Цель</label><input type="text" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Цель поездки" className="input-field" /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="input-label">Начало *</label><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input-field" /></div>
          <div><label className="input-label">Окончание *</label><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="input-field" /></div>
        </div>
        <div><label className="input-label">Бюджет (₽)</label><input type="number" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="0" className="input-field" /></div>
        <button onClick={handleSubmit} disabled={!valid || saving} className="btn-primary spring-tap mt-1">{saving ? 'Сохранение...' : 'Создать'}</button>
      </div>
    </BottomSheet>
  );
}
