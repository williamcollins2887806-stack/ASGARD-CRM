import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';
import { ArrowLeft, Trophy, Star, Medal, Award, Crown, Lock, Users, Activity, CheckCircle2, Target } from 'lucide-react';
import { Card, IconTile, KeyButton, BottomSheet, ProgressBar, Chip, StatusBadge } from '@/components/field/ui';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import './field-screens.css';

const TIER_COLORS = { cup: 'var(--value)', medal: 'var(--text-secondary)', order: 'var(--value)', legend: 'var(--acc)' };
const TIER_LABELS = { cup: 'Кубок', medal: 'Медаль', order: 'Орден', legend: 'Легенда' };
const CAT_LABELS = {
  onboarding: 'Вступление', discipline: 'Дисциплина', endurance: 'Выносливость',
  travel: 'Командировки', finance: 'Финансы', mastery: 'Мастерство',
  brigade: 'Бригадные', secret: 'Секретные',
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
      <div className="fs-root p-4 space-y-4" style={{ paddingTop: 'max(env(safe-area-inset-top), 16px)' }}>
        <SkeletonList count={6} />
      </div>
    );
  }

  const achievements = data?.achievements || [];
  const categories = [...new Set(achievements.map((a) => a.category))];
  const filtered = selectedCat ? achievements.filter((a) => a.category === selectedCat) : achievements;

  return (
    <div className="fs-root" style={{ paddingTop: 'max(env(safe-area-inset-top), 16px)', paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}>
      <div className="fs-scene" aria-hidden><span className="fs-orb fs-orb--a" /><span className="fs-orb fs-orb--b" /></div>

      <div className="fs-content space-y-4">
        {/* Header */}
        <div className="fs-head">
          <button onClick={() => navigate('/field/profile')} className="fs-head__btn" aria-label="Назад">
            <ArrowLeft size={20} strokeWidth={2.3} />
          </button>
          <IconTile icon={Trophy} tone="value" size={40} />
          <h1 className="fs-head__title">Достижения</h1>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { v: data?.earned_count || 0, l: 'Получено', icon: CheckCircle2, c: 'var(--ok)' },
            { v: data?.total_count || 0, l: 'Всего', icon: Target, c: 'var(--text-primary)' },
            { v: data?.points || 0, l: 'Баллы', icon: Activity, c: 'var(--value)' },
          ].map((s) => (
            <Card key={s.l} variant="raised" className="p-3 text-center" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <s.icon size={16} strokeWidth={2.3} style={{ color: s.c }} />
              <p className="text-xl font-bold" style={{ color: s.c }}>{s.v}</p>
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{s.l}</p>
            </Card>
          ))}
        </div>

        {/* Leaderboard link */}
        <KeyButton tone="value" block icon={Users} onClick={() => { haptic.light(); navigate('/field/leaderboard'); }}>
          Таблица лидеров
        </KeyButton>

        {/* Category filter */}
        <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          <Chip tone="value" active={!selectedCat} onClick={() => setSelectedCat(null)}>Все</Chip>
          {categories.map((cat) => (
            <Chip key={cat} tone="value" active={selectedCat === cat} onClick={() => setSelectedCat(cat)}>
              {CAT_LABELS[cat] || cat}
            </Chip>
          ))}
        </div>

        {/* Achievement grid */}
        <div className="grid grid-cols-4 gap-3">
          {filtered.map((ach) => {
            const tierColor = TIER_COLORS[ach.tier] || 'var(--text-tertiary)';
            return (
              <Card
                key={ach.id}
                as="button"
                variant="raised"
                className="flex flex-col items-center p-2 transition-transform active:scale-95"
                onClick={() => { haptic.light(); setDetail(ach); }}
                style={{
                  border: `1px solid ${ach.earned ? `color-mix(in oklab, ${tierColor} 45%, transparent)` : 'var(--tile-brd)'}`,
                  opacity: ach.earned ? 1 : 0.55,
                  filter: ach.earned ? 'none' : 'grayscale(0.8)',
                }}
              >
                <span className="text-2xl" aria-hidden>{ach.icon}</span>
                <span className="text-[9px] mt-1 text-center leading-tight line-clamp-2" style={{ color: 'var(--text-secondary)' }}>{ach.name}</span>
                {/* Progress bar for in-progress */}
                {!ach.earned && ach.current > 0 && (
                  <div className="w-full mt-1.5">
                    <ProgressBar value={ach.current} max={ach.threshold} color={tierColor} />
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </div>

      {/* Detail sheet */}
      <BottomSheet open={!!detail} onClose={() => setDetail(null)} title={detail?.name || ''}>
        {detail && (
          <div className="pb-2">
            <div className="flex items-center gap-4 mb-4">
              <IconTile icon={Trophy} tone={detail.earned ? 'value' : 'neutral'} size={52} />
              <div>
                <div className="flex items-center gap-2 mt-1">
                  <StatusBadge status={detail.earned ? 'получено' : 'в процессе'} />
                  <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{TIER_LABELS[detail.tier]} · {detail.points} очков</span>
                </div>
              </div>
            </div>
            <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>{detail.description}</p>
            {!detail.earned && detail.threshold > 0 && (
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span style={{ color: 'var(--text-tertiary)' }}>Прогресс</span>
                  <span style={{ color: 'var(--text-secondary)' }}>{detail.current} / {detail.threshold}</span>
                </div>
                <ProgressBar value={detail.current} max={detail.threshold} color={TIER_COLORS[detail.tier] || 'var(--value)'} />
              </div>
            )}
            {detail.earned && (
              <p className="text-xs" style={{ color: 'var(--ok)' }}>
                Получено {detail.earned_at ? new Date(detail.earned_at).toLocaleDateString('ru-RU') : ''}
              </p>
            )}
            <KeyButton tone="neutral" block className="mt-4" onClick={() => setDetail(null)}>Закрыть</KeyButton>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
