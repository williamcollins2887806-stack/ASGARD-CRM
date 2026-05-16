import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '@/api/client';
import PmTabBar from '@/components/pm/PmTabBar';

const C = {
  bg: '#0d0d12', card: '#16161f', gold: '#c8a84b',
  green: '#22c55e', red: '#ef4444', amber: '#f59e0b',
  blue: '#3b82f6', rune: '#7b61ff', text: '#e8e8f0', muted: '#6b7280',
};

const ROLE_LABELS = {
  worker: 'Рабочий',
  shift_master: 'Мастер смены',
  senior_master: 'Старший мастер',
};

export default function PmWorkers() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const workId = params.get('work_id') || '';

  const [workers, setWorkers] = useState([]);
  const [works, setWorks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // all | checked_in | not_checked
  const [search, setSearch] = useState('');

  useEffect(() => {
    Promise.all([
      api.get(`/pm/workers${workId ? `?work_id=${workId}` : ''}`),
      api.get('/pm/works'),
    ]).then(([wkrs, wks]) => {
      setWorkers(wkrs.workers || []);
      setWorks(wks.works || []);
    }).finally(() => setLoading(false));
  }, [workId]);

  const filtered = workers.filter(w => {
    if (search && !w.fio.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === 'checked_in' && !w.checkin_id) return false;
    if (filter === 'not_checked' && w.checkin_id) return false;
    return true;
  });

  // Группируем: мастера отдельно, рабочие отдельно
  const masters = filtered.filter(w => w.field_role !== 'worker');
  const regularWorkers = filtered.filter(w => w.field_role === 'worker');

  const WorkerRow = ({ w }) => {
    const isCheckedIn = !!w.checkin_id;
    const isActive = w.checkin_status === 'active';
    const isDone = w.checkin_status === 'completed';
    const hasPassed = w.lesson_passed;

    return (
      <div
        onClick={() => navigate(`/pm/workers/${w.id}`)}
        style={{
          background: C.card, borderRadius: 14, padding: '12px 14px',
          marginBottom: 8, cursor: 'pointer',
          border: `1px solid ${isActive ? C.green + '30' : '#ffffff0d'}`,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
        {/* Аватар-заглушка */}
        <div style={{
          width: 42, height: 42, borderRadius: 12, background: '#ffffff0d',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18, flexShrink: 0,
          border: `2px solid ${isActive ? C.green : isCheckedIn && isDone ? C.blue + '60' : '#ffffff15'}`,
        }}>
          {w.field_role !== 'worker' ? '👑' : '👷'}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {w.fio}
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>
            {ROLE_LABELS[w.field_role] || w.field_role}
            {w.work_title && ` · ${w.work_title}`}
          </div>
        </div>

        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          {/* Статус смены */}
          <div style={{
            fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
            background: isActive ? C.green + '20' : isDone ? C.blue + '20' : '#ffffff08',
            color: isActive ? C.green : isDone ? C.blue : C.muted,
          }}>
            {isActive ? '● На смене' : isDone ? '✓ Выполнена' : '◌ Нет смены'}
          </div>
          {/* Мимир */}
          <div style={{ fontSize: 10, color: hasPassed ? C.green : C.amber, marginTop: 3 }}>
            {hasPassed === true ? '✓ Мимир пройден' : hasPassed === false ? '⚠ Не пройден' : ''}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ minHeight: '100vh', background: C.bg, paddingBottom: 90 }}>
      {/* Header */}
      <div style={{ padding: '48px 16px 16px', background: 'linear-gradient(180deg, #0d1a2e 0%, transparent 100%)' }}>
        <button onClick={() => navigate('/pm')}
          style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 14, marginBottom: 10, padding: 0 }}>
          ← Назад
        </button>
        <div style={{ fontSize: 22, fontWeight: 900, color: C.text }}>👷 Рабочие</div>

        {/* Фильтр по объекту */}
        <select
          value={workId}
          onChange={e => navigate(e.target.value ? `/pm/workers?work_id=${e.target.value}` : '/pm/workers')}
          style={{
            marginTop: 10, width: '100%', background: C.card, border: '1px solid #ffffff15',
            borderRadius: 10, padding: '8px 12px', color: C.text, fontSize: 13,
          }}>
          <option value="">Все объекты</option>
          {works.map(w => (
            <option key={w.id} value={w.id}>{w.work_title || `Объект #${w.id}`} ({w.city || '—'})</option>
          ))}
        </select>
      </div>

      <div style={{ padding: '0 16px' }}>
        {/* Поиск */}
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Поиск по имени..."
          style={{
            width: '100%', background: C.card, border: '1px solid #ffffff15',
            borderRadius: 10, padding: '10px 14px', color: C.text, fontSize: 13,
            marginBottom: 12, boxSizing: 'border-box',
          }}
        />

        {/* Фильтр смены */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          {[
            { key: 'all', label: 'Все' },
            { key: 'checked_in', label: '✅ На смене' },
            { key: 'not_checked', label: '◌ Нет смены' },
          ].map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              style={{
                flex: 1, padding: '7px 0', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: filter === f.key ? C.blue : C.card,
                color: filter === f.key ? '#fff' : C.muted,
                fontSize: 12, fontWeight: filter === f.key ? 700 : 400,
              }}>
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: C.gold, fontSize: 32 }}>⚡</div>
        ) : (
          <>
            {/* Мастера */}
            {masters.length > 0 && (
              <>
                <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                  👑 Мастера ({masters.length})
                </div>
                {masters.map(w => <WorkerRow key={w.assignment_id || w.id} w={w} />)}
                <div style={{ height: 1, background: '#ffffff08', margin: '16px 0' }} />
              </>
            )}

            {/* Рабочие */}
            <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
              👷 Рабочие ({regularWorkers.length})
            </div>
            {regularWorkers.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: C.muted }}>Нет рабочих</div>
            ) : (
              regularWorkers.map(w => <WorkerRow key={w.assignment_id || w.id} w={w} />)
            )}
          </>
        )}
      </div>
      <PmTabBar />
    </div>
  );
}
