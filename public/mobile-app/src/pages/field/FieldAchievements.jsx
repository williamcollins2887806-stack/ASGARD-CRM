import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';
import { ArrowLeft, Trophy, Star, Medal, Award, Crown, Lock, Users } from 'lucide-react';

const TIER_COLORS = { cup: '#cd7f32', medal: '#c0c0c0', order: '#ffd700', legend: '#8b5cf6' };
const TIER_LABELS = { cup: 'Кубок', medal: 'Медаль', order: 'Орден', legend: 'Легенда' };
const CAT_LABELS = {
  onboarding: 'Вступление', discipline: 'Дисциплина', endurance: 'Выносливость',
  travel: 'Командировки', finance: 'Финансы', mastery: 'Мастерство', secret: 'Секретные',
};

export default function FieldAchievements() {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedCat, setSelectedCat] = useState(null);
  const [detail, setDetail] = useState(null);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      setLoading(true);
      const result = await fieldApi.get('/achievements/');
      setData(result);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }

  if (loading) {
    return (
      <div className="p-4 space-y-4 animate-pulse">
        <div className="h-20 rounded-xl" style={{ backgroundColor: 'var(--bg-elevated)' }} />
        <div className="grid grid-cols-5 gap-3">{[...Array(15)].map((_, i) => <div key={i} className="aspect-square rounded-lg" style={{ backgroundColor: 'var(--bg-elevated)' }} />)}</div>
      </div>
    );
  }

  const achievements = data?.achievements || [];
  const categories = [...new Set(achievements.map((a) => a.category))];
  const filtered = selectedCat ? achievements.filter((a) => a.category === selectedCat) : achievements;

  return (
    <div className="p-4 pb-24 space-y-4" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/field/profile')} className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <ArrowLeft size={20} style={{ color: 'var(--text-primary)' }} />
        </button>
        <Trophy size={22} style={{ color: 'var(--gold)' }} />
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Достижения</h1>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg p-3 text-center" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
          <p className="text-xl font-bold" style={{ color: 'var(--gold)' }}>{data?.earned_count || 0}</p>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Получено</p>
        </div>
        <div className="rounded-lg p-3 text-center" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
          <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{data?.total_count || 0}</p>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Всего</p>
        </div>
        <div className="rounded-lg p-3 text-center" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
          <p className="text-xl font-bold" style={{ color: '#8b5cf6' }}>{data?.points || 0}</p>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Баллы</p>
        </div>
      </div>

      {/* Leaderboard link */}
      <button
        onClick={() => { haptic.light(); navigate('/field/leaderboard'); }}
        className="w-full py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2"
        style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)', color: 'var(--gold)' }}
      >
        <Users size={16} /> Таблица лидеров
      </button>

      {/* Category filter */}
      <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
        <button onClick={() => setSelectedCat(null)} className="px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap" style={{ backgroundColor: !selectedCat ? 'var(--gold)' : 'var(--bg-elevated)', color: !selectedCat ? '#fff' : 'var(--text-secondary)' }}>Все</button>
        {categories.map((cat) => (
          <button key={cat} onClick={() => setSelectedCat(cat)} className="px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap" style={{ backgroundColor: selectedCat === cat ? 'var(--gold)' : 'var(--bg-elevated)', color: selectedCat === cat ? '#fff' : 'var(--text-secondary)' }}>
            {CAT_LABELS[cat] || cat}
          </button>
        ))}
      </div>

      {/* Achievement grid */}
      <div className="grid grid-cols-4 gap-3">
        {filtered.map((ach) => {
          const tierColor = TIER_COLORS[ach.tier] || '#6b7280';
          return (
            <button
              key={ach.id}
              onClick={() => { haptic.light(); setDetail(ach); }}
              className="flex flex-col items-center p-2 rounded-xl transition-transform active:scale-95"
              style={{
                backgroundColor: 'var(--bg-elevated)',
                border: `1px solid ${ach.earned ? tierColor + '60' : 'var(--border-norse)'}`,
                opacity: ach.earned ? 1 : 0.5,
                filter: ach.earned ? 'none' : 'grayscale(0.8)',
              }}
            >
              <span className="text-2xl">{ach.icon}</span>
              <span className="text-[9px] mt-1 text-center leading-tight line-clamp-2" style={{ color: 'var(--text-secondary)' }}>{ach.name}</span>
              {/* Progress bar for in-progress */}
              {!ach.earned && ach.current > 0 && (
                <div className="w-full h-1 rounded-full mt-1 overflow-hidden" style={{ backgroundColor: 'var(--bg-primary)' }}>
                  <div className="h-full rounded-full" style={{ width: `${(ach.current / ach.threshold) * 100}%`, backgroundColor: tierColor }} />
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Detail modal */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={() => setDetail(null)}>
          <div className="w-full max-w-lg rounded-t-2xl p-6" style={{ backgroundColor: 'var(--bg-elevated)' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-4 mb-4">
              <span className="text-4xl">{detail.icon}</span>
              <div>
                <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{detail.name}</h3>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: (TIER_COLORS[detail.tier] || '#6b7280') + '20', color: TIER_COLORS[detail.tier] }}>{TIER_LABELS[detail.tier]}</span>
                  <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{detail.points} очков</span>
                </div>
              </div>
            </div>
            <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>{detail.description}</p>
            {/* Progress */}
            {!detail.earned && detail.threshold > 0 && (
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span style={{ color: 'var(--text-tertiary)' }}>Прогресс</span>
                  <span style={{ color: 'var(--text-secondary)' }}>{detail.current} / {detail.threshold}</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-primary)' }}>
                  <div className="h-full rounded-full" style={{ width: `${(detail.current / detail.threshold) * 100}%`, backgroundColor: TIER_COLORS[detail.tier] || 'var(--gold)' }} />
                </div>
              </div>
            )}
            {detail.earned && (
              <p className="text-xs" style={{ color: '#22c55e' }}>Получено {detail.earned_at ? new Date(detail.earned_at).toLocaleDateString('ru-RU') : ''}</p>
            )}
            <button onClick={() => setDetail(null)} className="w-full mt-4 py-3 rounded-xl text-sm font-medium" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>Закрыть</button>
          </div>
        </div>
      )}
    </div>
  );
}
