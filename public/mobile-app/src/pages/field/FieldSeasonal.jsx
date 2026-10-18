import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';
import { ArrowLeft, Clock, Trophy, CheckCircle2, Circle, RefreshCw, ChevronRight, Hourglass, Moon, Swords } from 'lucide-react';
import { Card, IconTile, KeyButton, ProgressBar, Banner, EmptyState } from '@/components/field/ui';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import './field-screens.css';

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
    <div className="flex items-center gap-3 py-2.5 border-b last:border-0" style={{ borderColor: 'var(--tile-brd)' }}>
      <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-base"
        style={{ backgroundColor: task.completed ? `color-mix(in oklab, ${color} 14%, transparent)` : 'var(--bg-surface-alt)' }}>
        {task.icon || <Swords size={15} style={{ color }} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium truncate" style={{ color: task.completed ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
            {task.name}
          </p>
          <span className="text-xs flex-shrink-0 font-semibold" style={{ color: task.completed ? color : 'var(--text-tertiary)' }}>
            {task.current}/{task.target}
          </span>
        </div>
        <div className="mt-1.5">
          <ProgressBar value={pct} color={task.completed ? color : `color-mix(in oklab, ${color} 55%, transparent)`} />
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
    <Card variant="raised" className="overflow-hidden" style={{
      borderColor: `color-mix(in oklab, ${ch.color} 28%, transparent)`,
      boxShadow: ch.fully_completed ? `0 8px 28px color-mix(in oklab, ${ch.color} 22%, transparent)` : undefined,
    }}>
      {/* Header */}
      <div className="p-4" style={{ background: `linear-gradient(135deg, color-mix(in oklab, ${ch.color} 11%, transparent) 0%, transparent 60%)` }}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-3xl" aria-hidden>{ch.icon}</span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base" style={{ color: 'var(--text-primary)' }}>{ch.season_name}</h3>
                {ch.fully_completed && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{ backgroundColor: `color-mix(in oklab, ${ch.color} 16%, transparent)`, color: ch.color }}>
                    Выполнено!
                  </span>
                )}
              </div>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{ch.description}</p>
            </div>
          </div>
          <button onClick={() => { haptic.light(); setExpanded(v => !v); }}
            className="p-1 rounded-lg flex-shrink-0" style={{ color: 'var(--text-tertiary)' }} aria-label={expanded ? 'Свернуть' : 'Развернуть'}>
            <ChevronRight size={18} style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform .2s' }} />
          </button>
        </div>

        {/* Progress summary */}
        <div className="mt-3 flex items-center justify-between">
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                {ch.tasks_done}/{ch.tasks_total} заданий
              </span>
              <span className="text-xs font-bold" style={{ color: ch.color }}>{allPct}%</span>
            </div>
            <ProgressBar value={allPct} color={ch.color} />
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
          style={{ backgroundColor: ch.fully_completed ? `color-mix(in oklab, ${ch.color} 10%, transparent)` : 'var(--bg-surface-alt)',
            border: `1px solid color-mix(in oklab, ${ch.color} 22%, transparent)` }}>
          <div className="flex items-center gap-2">
            <span className="text-xl" aria-hidden>{ch.reward_icon}</span>
            <div>
              <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Награда за сезон</p>
              <p className="text-sm font-bold" style={{ color: ch.color }}>{ch.reward_label}</p>
            </div>
          </div>
          {ch.fully_completed
            ? <Trophy size={20} style={{ color: ch.color }} />
            : <span className="text-xs px-2 py-1 rounded-lg font-medium"
                style={{ backgroundColor: `color-mix(in oklab, ${ch.color} 12%, transparent)`, color: ch.color }}>
                +{ch.reward_value}{' '}
                {ch.reward_type === 'runes' || ch.reward_type === 'xp'
                  ? (ch.reward_type === 'runes' ? 'рун' : 'XP')
                  : 'очков'}
              </span>}
        </div>

        {!ch.fully_completed && (
          <button onClick={() => { haptic.medium(); onRefresh(); }}
            className="mt-2 w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs"
            style={{ color: 'var(--text-tertiary)', backgroundColor: 'var(--bg-surface-alt)' }}>
            <RefreshCw size={12} /> Обновить прогресс
          </button>
        )}
      </div>
    </Card>
  );
}

export default function FieldSeasonal() {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load({ recompute = false } = {}) {
    try {
      setLoading(true);
      if (recompute) {
        try { await fieldApi.post('/seasonal/refresh', {}); } catch { /* non-fatal */ }
      }
      const result = await fieldApi.get('/seasonal/');
      setData(result);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }

  useEffect(() => { load({ recompute: true }); }, []);

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
      <div className="fs-root p-4" style={{ paddingTop: 'max(env(safe-area-inset-top), 16px)' }}>
        <SkeletonList count={4} />
      </div>
    );
  }

  const active = data?.active || [];
  const upcoming = data?.upcoming || [];

  return (
    <div className="fs-root" style={{ minHeight: '100dvh', paddingTop: 'max(env(safe-area-inset-top), 16px)', paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}>
      <div className="fs-scene" aria-hidden><span className="fs-orb fs-orb--a" /><span className="fs-orb fs-orb--b" /></div>

      <div className="fs-content space-y-4">
        {/* Header */}
        <div className="fs-head">
          <button onClick={() => navigate('/field/profile')} className="fs-head__btn" aria-label="Назад">
            <ArrowLeft size={20} strokeWidth={2.3} />
          </button>
          <IconTile icon={Trophy} tone="value" size={40} />
          <div>
            <h1 className="fs-head__title">Сезонные испытания</h1>
            <p className="fs-head__sub">Временные задания с уникальными наградами</p>
          </div>
        </div>

        {/* FOMO banner — days left */}
        {active.length > 0 && !active[0].fully_completed && (
          <Banner
            tone="value"
            icon={Hourglass}
            title={`До конца сезона: ${formatDays(active[0].days_left)}`}
            text="Успей выполнить все задания и получи уникальную награду"
          />
        )}

        {/* Active challenges */}
        {active.length === 0 ? (
          <EmptyState icon={Moon} title="Нет активных испытаний" description="Следующий сезон скоро начнётся" />
        ) : (
          active.map((ch) => (
            <ChallengeCard key={ch.id} ch={ch} onRefresh={refresh} />
          ))
        )}

        {/* Upcoming season preview */}
        {upcoming.map((u) => (
          <Card key={u.slug} variant="flat" style={{ border: '1px dashed var(--tile-brd)', opacity: 0.7 }}>
            <div className="flex items-center gap-3">
              <span className="text-2xl" aria-hidden>{u.icon}</span>
              <div>
                <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Следующий сезон: {u.season_name}</p>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  Начало: {new Date(u.starts_at).toLocaleDateString('ru-RU')}
                </p>
              </div>
            </div>
          </Card>
        ))}

        {/* Refresh button */}
        {active.length > 0 && (
          <KeyButton tone="neutral" block icon={RefreshCw} onClick={() => { haptic.medium(); refresh(); }} disabled={refreshing}>
            {refreshing ? 'Обновляю...' : 'Пересчитать прогресс'}
          </KeyButton>
        )}
      </div>
    </div>
  );
}
