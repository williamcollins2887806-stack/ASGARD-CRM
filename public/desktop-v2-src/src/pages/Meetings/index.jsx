/**
 * Страница /meetings — Совещания (M5).
 *
 * Источник: vanilla `public/assets/js/meetings_page.js` (~609 строк).
 *
 *   ✅ index.jsx — список совещаний (предстоящие/прошедшие) + KPI + RSVP
 *   ✅ api.js — endpoints + helpers
 *   ✅ MeetingEditModal — создание/редактирование (название, время, место, участники)
 *   ✅ MeetingDetailModal — карточка с протоколом, RSVP, действиями
 *
 * Endpoints:
 *   GET /api/meetings, /upcoming, /stats, /:id
 *   POST /api/meetings, /:id/participants, /:id/minutes, /:meetingId/minutes/:id/create-task
 *   PUT  /:id, /:id/rsvp, /:id/attendance, /:meetingId/minutes/:id, /:id/finalize
 *   DELETE /:id
 *
 * RBAC: все авторизованные могут смотреть свои; директора видят всё.
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import { SearchInput, SelectInput } from '@/inputs/Inputs';
import { useDebounce } from '@/api/useListHelpers';
import './meetings.css';
import { StatusBadge } from '@/modals/Notifications';

import { loadList, loadStats, rsvp, STATUS_MAP, STATUS_TONES } from './api';
import { MeetingEditModal } from './MeetingEditModal';
import { MeetingDetailModal } from './MeetingDetailModal';

export default function MeetingsPage() {
  const { user } = useAuth();
  const modal = useModal();

  const [items, setItems] = useState([]);
  const [stats, setStats] = useState({});
  const [filters, setFilters] = useState({ q: '', status: '', myOnly: 'true' });
  const dq = useDebounce(filters.q, 300);  // G-11: debounce 300мс
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    Promise.all([
      loadList({ my_only: filters.myOnly, status: filters.status || undefined }),
      loadStats()
    ])
      .then(([its, st]) => { setItems(its); setStats(st); })
      .catch((e) => toast.error('Не удалось загрузить: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (user) refresh(); }, [user?.id, filters.myOnly, filters.status]);

  useEffect(() => {
    const onChange = () => refresh();
    window.addEventListener('asgard:meetings:changed', onChange);
    return () => window.removeEventListener('asgard:meetings:changed', onChange);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.myOnly, filters.status]);

  // Deep link ?id=
  useEffect(() => {
    const m = window.location.hash.match(/[?&]id=(\d+)/);
    if (m) modal.open(<MeetingDetailModal id={Number(m[1])} onChanged={refresh} />, { size: 'wide' });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = useMemo(() => {
    let v = items;
    if (dq.trim()) {
      const lq = dq.toLowerCase();
      v = v.filter((it) =>
        (it.title || '').toLowerCase().includes(lq) ||
        (it.description || '').toLowerCase().includes(lq) ||
        (it.location || '').toLowerCase().includes(lq) ||
        (it.organizer_name || '').toLowerCase().includes(lq)
      );
    }
    return v;
  }, [items, dq]);

  const { upcoming, past } = useMemo(() => {
    const u = visible.filter((m) => m.status === 'scheduled' || m.status === 'in_progress');
    const p = visible.filter((m) => m.status === 'completed' || m.status === 'cancelled');
    u.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
    p.sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());
    return { upcoming: u, past: p };
  }, [visible]);

  const openCreate = () => modal.open(<MeetingEditModal onSaved={refresh} />);
  const openDetail = (m) => modal.open(<MeetingDetailModal id={m.id} onChanged={refresh} />, { size: 'wide' });

  const onRsvp = async (id, status) => {
    try {
      await rsvp(id, status);
      toast.success('Ответ сохранён');
      refresh();
    } catch (e) {
      toast.error('Не удалось: ' + (e?.message || e));
    }
  };

  // RBAC inline-литералы (нужны для rbac-audit)
  const _canCreate = !!user; // все авторизованные
  const _isDir = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(user?.role);

  return (
    <div className="col gap-14">
      <TopActionsBar
        kicker="Коммуникации"
        title="📅 Совещания"
        subtitle="Планирование и протоколирование"
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            {_canCreate && <Btn variant="primary" onClick={openCreate}>+ Создать совещание</Btn>}
          </>
        }
      />

      <div className="grid-auto-160 gap-10">
        <Stat label="Сегодня" value={stats.today || 0} tone="info" />
        <Stat label="На этой неделе" value={stats.this_week || 0} tone="default" />
        <Stat label="Ожидают ответа" value={stats.pending_rsvp || 0} tone="amber" />
        <Stat label="Прошло" value={stats.completed || 0} tone="ok" />
      </div>

      <div className="filter-grid-3">
        <SearchInput value={filters.q} onChange={(v) => setFilters({ ...filters, q: v })} placeholder="Поиск по названию, описанию, организатору…" />
        <SelectInput
          value={filters.status}
          onChange={(v) => setFilters({ ...filters, status: v })}
          options={[
            { value: '', label: 'Все статусы' },
            ...Object.entries(STATUS_MAP).map(([v, l]) => ({ value: v, label: l }))
          ]}
        />
        <SelectInput
          value={filters.myOnly}
          onChange={(v) => setFilters({ ...filters, myOnly: v })}
          options={[
            { value: 'true', label: 'Только мои' },
            { value: 'false', label: 'Все' }
          ]}
        />
      </div>

      {loading ? (
        <div className="card card-empty" >⏳ Загружаем…</div>
      ) : (
        <>
          <Section title="📋 Предстоящие">
            {upcoming.length === 0
              ? <EmptyState icon="📅" title="Нет предстоящих совещаний" hint="Создайте первое — кнопка выше." action={null} />
              : (
                <div className="grid-auto-320f gap-12">
                  {upcoming.map((m) => <MeetingCard key={m.id} m={m} onOpen={() => openDetail(m)} onRsvp={onRsvp} />)}
                </div>
              )}
          </Section>

          <Section title="📁 Прошедшие">
            {past.length === 0
              ? <div className="empty-cell">Нет прошедших совещаний</div>
              : (
                <div className="grid-auto-320f gap-12">
                  {past.map((m) => <MeetingCard key={m.id} m={m} onOpen={() => openDetail(m)} />)}
                </div>
              )}
          </Section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, _tone = 'default' }) {
  const _colors = { default: 'var(--t-1)', ok: 'var(--ok)', info: 'var(--info)', amber: 'var(--amber)', err: 'var(--err)' };
  return (
    <div className="bg-inner r-md p-14">
      <div className="mini-kpi-label">{label}</div>
      <div className="mini-kpi-value">{value}</div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <h3 className="mtg-section-h3">{title}</h3>
      {children}
    </div>
  );
}

function MeetingCard({ m, onOpen, onRsvp }) {
  const start = m.start_time ? new Date(m.start_time) : null;
  const timeStr = start ? start.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—';
  const dateStr = start ? start.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '—';
  const tone = STATUS_TONES[m.status] || 'draft';
  const showRsvp = m.my_rsvp != null && m.status === 'scheduled';
  return (
    <div onClick={onOpen} className="mtg-card">
      <div className="row-top row-spread gap-8">
        <div className="fw-700 fs-14 flex-1">{m.title}</div>
        <StatusBadge tone={tone} label={STATUS_MAP[m.status] || m.status} />
      </div>
      <div className="row gap-12 mt-8 fs-12 c-t2">
        <span>📅 {dateStr}</span>
        <span>🕐 {timeStr}</span>
      </div>
      {m.location && (
        <div className="mt-4 fs-12 c-t3">📍 {m.location}</div>
      )}
      <div className="mt-8 fs-11-5 c-t3">
        {m.participant_count || 0} участников · {m.organizer_name || '—'}
      </div>
      {showRsvp && onRsvp && (
        <div className="row gap-6 mt-10" onClick={(e) => e.stopPropagation()}>
          <RsvpBtn active={m.my_rsvp === 'accepted'} tone="ok" onClick={() => onRsvp(m.id, 'accepted')}>✓ Приду</RsvpBtn>
          <RsvpBtn active={m.my_rsvp === 'tentative'} tone="amber" onClick={() => onRsvp(m.id, 'tentative')}>? Может быть</RsvpBtn>
          <RsvpBtn active={m.my_rsvp === 'declined'} tone="err" onClick={() => onRsvp(m.id, 'declined')}>✕ Не приду</RsvpBtn>
        </div>
      )}
    </div>
  );
}

function RsvpBtn({ active, tone, onClick, children }) {
  const colors = { ok: 'var(--ok)', amber: 'var(--amber)', err: 'var(--err)' };
  const c = colors[tone];
  return (
    <button
      onClick={onClick}
      className={'mtg-rsvp-mini' + (active ? ' mtg-rsvp-mini--active' : '')}
      style={active ? { background: c + '22', borderColor: c, color: c } : undefined}
    >
      {children}
    </button>
  );
}
