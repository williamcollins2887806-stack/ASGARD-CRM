import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { WidgetShell } from '@/widgets/WidgetShell';

/**
 * AcademyWidget — виджет Академии Асгарда на дашборде
 * Показывает: ранг, прогресс, обязательные уроки, стрик
 * API: GET /office-academy/lessons (stats), GET /office-academy/stats
 */

const RANK_COLORS = {
  'Мастер': '#c8a84b',
  'Воин': '#7b61ff',
  'Страж': '#3b82f6',
  'Ученик': '#6b7280',
};

export default function AcademyWidget() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [d, s] = await Promise.all([
          api.get('/office-academy/lessons'),
          api.get('/office-academy/stats').catch(() => null),
        ]);
        setData(d);
        setStats(s);
      } catch {
        setData(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const total = data?.total || 0;
  const passed = data?.passed || 0;
  const mandatoryPending = data?.mandatory_pending || 0;
  const rank = data?.rank || stats?.rank;
  const streak = stats?.streak || 0;
  const totalXp = stats?.total_xp || data?.total_xp || 0;
  const pct = total > 0 ? Math.round(passed / total * 100) : 0;
  const rankColor = rank ? (RANK_COLORS[rank.name] || '#6b7280') : '#6b7280';

  // Find first unpassed mandatory lesson for CTA
  const firstMandatory = (data?.lessons || []).find(l => l.is_mandatory && !l.passed);
  // Find first lesson needing re-read
  const needsReread = (data?.lessons || []).find(l => l.attempts >= 2 && !l.passed && !l.read_completed_at);

  return (
    <WidgetShell name="Залы Асгарда" icon="🏛️" loading={loading}>
      <div
        onClick={() => navigate('/office-academy')}
        className="spring-tap"
        style={{ cursor: 'pointer' }}
      >
        {/* Top row: Rank + Streak + XP */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          {/* Rank badge */}
          {rank && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              background: `color-mix(in srgb, ${rankColor} 15%, transparent)`,
              border: `1px solid color-mix(in srgb, ${rankColor} 30%, transparent)`,
              borderRadius: 8, padding: '3px 10px',
            }}>
              <span style={{ fontSize: 14 }}>{rank.icon}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: rankColor }}>{rank.name}</span>
            </div>
          )}

          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {streak > 0 && (
              <span style={{
                fontSize: 11, fontWeight: 700,
                color: streak >= 3 ? '#c8a84b' : 'var(--text-tertiary)',
                background: streak >= 3 ? 'rgba(200,168,75,.12)' : 'rgba(255,255,255,.05)',
                borderRadius: 6, padding: '2px 7px',
              }}>🔥 {streak}</span>
            )}
            {totalXp > 0 && (
              <span style={{
                fontSize: 11, fontWeight: 700, color: '#7b61ff',
                background: 'rgba(123,97,255,.12)',
                borderRadius: 6, padding: '2px 7px',
              }}>⚡ {totalXp}</span>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
              Пройдено {passed} из {total}
            </span>
            <span style={{
              fontSize: 12, fontWeight: 700,
              color: pct >= 80 ? 'var(--green)' : pct >= 40 ? '#f59e0b' : 'var(--text-tertiary)',
            }}>{pct}%</span>
          </div>
          <div style={{
            height: 6, borderRadius: 3, overflow: 'hidden',
            background: 'color-mix(in srgb, var(--border-norse) 50%, transparent)',
          }}>
            <div style={{
              height: '100%', borderRadius: 3,
              width: `${pct}%`,
              background: 'linear-gradient(90deg, #c8a84b, #7b61ff)',
              transition: 'width 0.6s ease',
            }} />
          </div>
        </div>

        {/* Alert: mandatory pending */}
        {mandatoryPending > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'rgba(239,68,68,.08)',
            border: '1px solid rgba(239,68,68,.2)',
            borderRadius: 10, padding: '8px 10px', marginBottom: 8,
          }}>
            <span style={{ fontSize: 16 }}>⚠️</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#ef4444' }}>
                {mandatoryPending} обязательн{mandatoryPending === 1 ? 'ый свиток' : mandatoryPending < 5 ? 'ых свитка' : 'ых свитков'}
              </div>
              {firstMandatory && (
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                  {firstMandatory.cover_icon} {firstMandatory.title}
                </div>
              )}
            </div>
            <span style={{ fontSize: 14, color: 'var(--text-tertiary)' }}>›</span>
          </div>
        )}

        {/* Alert: needs re-read */}
        {needsReread && !mandatoryPending && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'rgba(245,158,11,.08)',
            border: '1px solid rgba(245,158,11,.2)',
            borderRadius: 10, padding: '8px 10px', marginBottom: 8,
          }}>
            <span style={{ fontSize: 16 }}>📖</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b' }}>
                Перечитай свиток
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                {needsReread.cover_icon} {needsReread.title}
              </div>
            </div>
            <span style={{ fontSize: 14, color: 'var(--text-tertiary)' }}>›</span>
          </div>
        )}

        {/* All good state */}
        {mandatoryPending === 0 && !needsReread && total > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'rgba(34,197,94,.06)',
            border: '1px solid rgba(34,197,94,.15)',
            borderRadius: 10, padding: '8px 10px',
          }}>
            <span style={{ fontSize: 16 }}>✅</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--green)' }}>
              Все обязательные свитки сданы
            </span>
          </div>
        )}

        {/* Empty state */}
        {total === 0 && (
          <div style={{
            textAlign: 'center', padding: '8px 0',
            fontSize: 12, color: 'var(--text-tertiary)',
          }}>
            Свитки для вашей роли скоро появятся
          </div>
        )}

        {/* CTA */}
        <div style={{
          marginTop: 10, textAlign: 'center',
          fontSize: 12, fontWeight: 600, color: '#7b61ff',
        }}>
          Открыть Залы Асгарда →
        </div>
      </div>
    </WidgetShell>
  );
}
