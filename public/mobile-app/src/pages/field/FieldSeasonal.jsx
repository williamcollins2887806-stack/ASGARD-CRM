import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';
import { ArrowLeft, Clock, Trophy, CheckCircle2, Circle, RefreshCw, ChevronRight } from 'lucide-react';

function formatDays(d) {
  if (d <= 0) return 'Завершено';
  if (d === 1) return '1 день';
  if (d <= 4) return `${d} дня`;
  return `${d} дней`;
}

function CountdownTimer({ endsAt }) {
  const [label, setLabel] = useState('');
  useEffect(() => {
    function tick() {
      const ms = new Date(endsAt) - new Date();
      if (ms <= 0) { setLabel('Завершено'); return; }
      const d = Math.floor(ms / 86400000);
      const h = Math.floor((ms % 86400000) / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      if (d > 0) setLabel(`${d}д ${h}ч`);
      else if (h > 0) setLabel(`${h}ч ${m}м`);
      else setLabel(`${m}м`);
    }
    tick();
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, [endsAt]);
  return <span>{label}</span>;
}

function TaskRow({ task, color }) {
  const pct = task.target > 0 ? Math.min(100, (task.current / task.target) * 100) : (task.completed ? 100 : 0);
  return (
    <div className="flex items-center gap-3 py-2.5 border-b last:border-0" style={{ borderColor: 'var(--border-norse)' }}>
      <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-base"
        style={{ backgroundColor: task.completed ? color + '20' : 'var(--bg-primary)' }}>
        {task.icon || '⚔️'}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium truncate" style={{ color: task.completed ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
            {task.name}
          </p>
          <span className="text-xs flex-shrink-0" style={{ color: task.completed ? color : 'var(--text-tertiary)' }}>
            {task.current}/{task.target}
          </span>
        </div>
        <div className="h-1.5 rounded-full mt-1.5 overflow-hidden" style={{ backgroundColor: 'var(--bg-primary)' }}>
          <div className="h-full rounded-full transition-all duration-700"
            style={{ width: `${pct}%`, backgroundColor: task.completed ? color : color + '80' }} />
        </div>
      </div>
      <div className="flex-shrink-0">
        {task.completed
          ? <CheckCircle2 size={18} style={{ color }} />
          : <Circle size={18} style={{ color: 'var(--text-tertiary)', opacity: 0.4 }} />}
      </div>
    </div>
  );
}

function ChallengeCard({ ch, onRefresh }) {
  const [expanded, setExpanded] = useState(true);
  const haptic = useHaptic();
  const allPct = ch.tasks_total > 0 ? Math.round((ch.tasks_done / ch.tasks_total) * 100) : 0;

  return (
    <div className="rounded-2xl overflow-hidden" style={{
      backgroundColor: 'var(--bg-elevated)',
      border: `1px solid ${ch.color}40`,
      boxShadow: ch.fully_completed ? `0 0 20px ${ch.color}30` : undefined,
    }}>
      {/* Header */}
      <div className="p-4" style={{ background: `linear-gradient(135deg, ${ch.color}18 0%, transparent 60%)` }}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-3xl">{ch.icon}</span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base" style={{ color: 'var(--text-primary)' }}>{ch.season_name}</h3>
                {ch.fully_completed && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{ backgroundColor: ch.color + '25', color: ch.color }}>
                    Выполнено!
                  </span>
                )}
              </div>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{ch.description}</p>
            </div>
          </div>
          <button onClick={() => { haptic.light(); setExpanded(v => !v); }}
            className="p-1 rounded-lg flex-shrink-0" style={{ color: 'var(--text-tertiary)' }}>
            <ChevronRight size={18} style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform .2s' }} />
          </button>
        </div>

        {/* Progress ring summary */}
        <div className="mt-3 flex items-center justify-between">
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                {ch.tasks_done}/{ch.tasks_total} заданий
              </span>
              <span className="text-xs font-bold" style={{ color: ch.color }}>{allPct}%</span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-primary)' }}>
              <div className="h-full rounded-full transition-all duration-700"
                style={{ width: `${allPct}%`, backgroundColor: ch.color,
                  boxShadow: ch.fully_completed ? `0 0 8px ${ch.color}80` : undefined }} />
            </div>
          </div>
          <div className="ml-4 flex items-center gap-1.5" style={{ color: 'var(--text-tertiary)' }}>
            <Clock size={12} />
            <span className="text-xs"><CountdownTimer endsAt={ch.ends_at} /></span>
          </div>
        </div>
      </div>

      {/* Tasks list */}
      {expanded && (
        <div className="px-4 pb-2">
          {ch.tasks.map((t) => <TaskRow key={t.slug} task={t} color={ch.color} />)}
        </div>
      )}

      {/* Reward strip */}
      <div className="px-4 pb-4 pt-2">
        <div className="flex items-center justify-between p-3 rounded-xl"
          style={{ backgroundColor: ch.fully_completed ? ch.color + '18' : 'var(--bg-primary)',
            border: `1px solid ${ch.color}30` }}>
          <div className="flex items-center gap-2">
            <span className="text-xl">{ch.reward_icon}</span>
            <div>
              <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Награда за сезон</p>
              <p className="text-sm font-bold" style={{ color: ch.color }}>{ch.reward_label}</p>
            </div>
          </div>
          {ch.fully_completed
            ? <Trophy size={20} style={{ color: ch.color }} />
            : <span className="text-xs px-2 py-1 rounded-lg font-medium"
                style={{ backgroundColor: ch.color + '15', color: ch.color }}>
                +{ch.reward_value} очков
              </span>}
        </div>

        {!ch.fully_completed && (
          <button onClick={() => { haptic.medium(); onRefresh(); }}
            className="mt-2 w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs"
            style={{ color: 'var(--text-tertiary)', backgroundColor: 'var(--bg-primary)' }}>
            <RefreshCw size={12} /> Обновить прогресс
          </button>
        )}
      </div>
    </div>
  );
}

export default function FieldSeasonal() {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      setLoading(true);
      const result = await fieldApi.get('/seasonal/');
      setData(result);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }

  async function refresh() {
    try {
      setRefreshing(true);
      await fieldApi.post('/seasonal/refresh', {});
      await load();
    } catch { /* silent */ }
    finally { setRefreshing(false); }
  }

  if (loading) {
    return (
      <div className="p-4 space-y-4 animate-pulse">
        <div className="h-12 rounded-xl" style={{ backgroundColor: 'var(--bg-elevated)' }} />
        <div className="h-64 rounded-2xl" style={{ backgroundColor: 'var(--bg-elevated)' }} />
      </div>
    );
  }

  const active = data?.active || [];
  const upcoming = data?.upcoming || [];

  return (
    <div className="p-4 pb-24 space-y-4" style={{ backgroundColor: 'var(--bg-primary)', minHeight: '100vh' }}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/field/profile')} className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <ArrowLeft size={20} style={{ color: 'var(--text-primary)' }} />
        </button>
        <span className="text-2xl">🏆</span>
        <div>
          <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Сезонные испытания</h1>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Временные задания с уникальными наградами</p>
        </div>
      </div>

      {/* FOMO banner — days left */}
      {active.length > 0 && !active[0].fully_completed && (
        <div className="flex items-center gap-3 p-3 rounded-xl"
          style={{ backgroundColor: active[0].color + '18', border: `1px solid ${active[0].color}40` }}>
          <span className="text-2xl">⏳</span>
          <div>
            <p className="text-sm font-bold" style={{ color: active[0].color }}>
              До конца сезона: {formatDays(active[0].days_left)}
            </p>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Успей выполнить все задания и получи уникальную награду
            </p>
          </div>
        </div>
      )}

      {/* Active challenges */}
      {active.length === 0 ? (
        <div className="text-center py-16">
          <span className="text-4xl">🌙</span>
          <p className="mt-3 font-medium" style={{ color: 'var(--text-secondary)' }}>Нет активных испытаний</p>
          <p className="text-sm mt-1" style={{ color: 'var(--text-tertiary)' }}>Следующий сезон скоро начнётся</p>
        </div>
      ) : (
        active.map((ch) => (
          <ChallengeCard key={ch.id} ch={ch} onRefresh={refresh} />
        ))
      )}

      {/* Upcoming season preview */}
      {upcoming.map((u) => (
        <div key={u.slug} className="flex items-center gap-3 p-3 rounded-xl opacity-60"
          style={{ backgroundColor: 'var(--bg-elevated)', border: '1px dashed var(--border-norse)' }}>
          <span className="text-2xl">{u.icon}</span>
          <div>
            <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Следующий сезон: {u.season_name}</p>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Начало: {new Date(u.starts_at).toLocaleDateString('ru-RU')}
            </p>
          </div>
        </div>
      ))}

      {/* Refresh button */}
      {active.length > 0 && (
        <button
          onClick={() => { haptic.medium(); refresh(); }}
          disabled={refreshing}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium"
          style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-norse)' }}>
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Обновляю...' : 'Пересчитать прогресс'}
        </button>
      )}
    </div>
  );
}
