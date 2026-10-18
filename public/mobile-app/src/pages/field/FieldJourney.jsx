/**
 * FieldJourney.jsx — Journey Map ("Карта подвигов")
 * Shows all projects/cities the worker has been deployed to
 * with stats, achievements, and Norse-themed visuals
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { formatMoney } from '@/lib/utils';
import { ArrowLeft, Map as MapIcon, Building2, Landmark, Swords, Briefcase, MapPin, Route, Crown, Compass } from 'lucide-react';
import { Card, IconTile, ProgressBar } from '@/components/field/ui';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import './field-screens.css';

export default function FieldJourney() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fieldApi.get('/gamification/journey-map')
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="fs-root p-4" style={{ paddingTop: 'max(env(safe-area-inset-top), 16px)' }}>
      <SkeletonList count={4} />
    </div>
  );

  const projects = data?.projects || [];
  const stats = data?.stats || {};
  const achievements = data?.achievements || [];

  const STATS = [
    { label: 'Объектов', value: stats.total_projects || 0, icon: Building2 },
    { label: 'Городов', value: stats.total_cities || 0, icon: Landmark },
    { label: 'Смен', value: stats.total_shifts || 0, icon: Swords },
  ];

  return (
    <div className="fs-root" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 20px)' }}>
      <div className="fs-scene" aria-hidden><span className="fs-orb fs-orb--a" /><span className="fs-orb fs-orb--b" /></div>

      {/* Header */}
      <div className="fs-head" style={{
        position: 'sticky', top: 0, zIndex: 20, margin: 0,
        paddingTop: 'max(env(safe-area-inset-top), 14px)',
        background: 'color-mix(in oklab, var(--bg-primary) 88%, transparent)',
        WebkitBackdropFilter: 'blur(14px) saturate(1.5)', backdropFilter: 'blur(14px) saturate(1.5)',
      }}>
        <button onClick={() => navigate(-1)} className="fs-head__btn" aria-label="Назад">
          <ArrowLeft size={20} strokeWidth={2.3} />
        </button>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 900, letterSpacing: '.04em', color: 'var(--value)' }}>КАРТА ПОДВИГОВ</div>
          <div className="fs-head__sub" style={{ letterSpacing: '.12em' }}>ПУТЬ ВОИНА</div>
        </div>
        <span style={{ width: 38 }} />
      </div>

      <div className="fs-content" style={{ maxWidth: 430, margin: '0 auto', paddingTop: 12 }}>
        {/* Stats summary */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 16 }}>
          {STATS.map((s) => (
            <Card key={s.label} variant="raised" className="py-3 text-center" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <IconTile icon={s.icon} tone="value" size={34} />
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--value)' }}>{s.value}</div>
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 600 }}>{s.label}</div>
            </Card>
          ))}
        </div>

        {/* Achievements */}
        {achievements.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.1em', color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 8, textAlign: 'center' }}>
              Достижения путешественника
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              {achievements.map((a) => (
                <div key={a.id} style={{
                  padding: '8px 14px', borderRadius: 14,
                  background: 'color-mix(in oklab, var(--ok) 9%, var(--bg-surface-alt))',
                  border: '1px solid color-mix(in oklab, var(--ok) 24%, transparent)', display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <span style={{ fontSize: 18 }} aria-hidden>{a.icon}</span>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-primary)' }}>{a.name}</div>
                    <div style={{ fontSize: 9, color: 'var(--text-tertiary)' }}>{a.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Project list — visual cards */}
        {projects.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <IconTile icon={MapIcon} tone="value" size={64} />
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-secondary)', marginTop: 12 }}>Путь ещё не начат</div>
            <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 4 }}>Первый объект появится после чекина</div>
          </div>
        ) : projects.map((p, idx) => {
          const isOrphan = !!p.is_orphan;
          const isFirst = !isOrphan && projects.findIndex((x) => !x.is_orphan) === idx;
          const accent = isOrphan ? 'var(--acc)' : isFirst ? 'var(--value)' : 'var(--text-tertiary)';
          const PlaceIcon = isOrphan ? Briefcase : isFirst ? Building2 : MapPin;
          return (
            <Card key={p.work_id ?? 'orphan'} variant="raised" className="overflow-hidden relative" style={{
              marginBottom: 12,
              borderColor: isOrphan || isFirst ? `color-mix(in oklab, ${accent} 26%, transparent)` : undefined,
              boxShadow: isFirst ? '0 8px 26px color-mix(in oklab, var(--value) 16%, transparent)' : undefined,
            }}>
              {/* Left accent */}
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: accent, borderRadius: '4px 0 0 4px' }} />

              <div style={{ padding: '14px 14px 14px 18px' }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                  <IconTile icon={PlaceIcon} tone={isOrphan ? 'accent' : isFirst ? 'value' : 'neutral'} size={44} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text-primary)' }}>
                      {p.object_name || p.work_title}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      {isOrphan ? <Route size={11} /> : <MapPin size={11} />}
                      {isOrphan ? 'МО, дорога, склад, remote…' : (p.city || 'Не указан')}
                    </div>
                  </div>
                  {isFirst && (
                    <div style={{
                      padding: '3px 10px', borderRadius: 10, fontSize: 10, fontWeight: 800,
                      background: 'var(--gold-fill)', color: 'var(--text-on-gold)',
                    }}>СЕЙЧАС</div>
                  )}
                </div>

                {/* Stats row */}
                <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--text-secondary)' }}>
                  <div>
                    <span style={{ color: 'var(--text-tertiary)' }}>{isOrphan ? 'Дней: ' : 'Смен: '}</span>
                    <span style={{ fontWeight: 700 }}>{p.total_shifts}</span>
                  </div>
                  {!isOrphan && (
                    <div>
                      <span style={{ color: 'var(--text-tertiary)' }}>Часов: </span>
                      <span style={{ fontWeight: 700 }}>{Math.round(parseFloat(p.total_hours) || 0)}</span>
                    </div>
                  )}
                  <div style={{ marginLeft: 'auto' }}>
                    <span style={{ fontWeight: 700, color: 'var(--ok)' }}>
                      {formatMoney(parseFloat(p.total_earned))}
                    </span>
                  </div>
                </div>

                {/* Date range */}
                {p.first_shift && (
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {new Date(p.first_shift).toLocaleDateString('ru-RU')} — {p.last_shift ? new Date(p.last_shift).toLocaleDateString('ru-RU') : 'н.в.'}
                    {!isOrphan && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        {p.field_role === 'worker' ? <Swords size={10} /> : <Crown size={10} />}
                        {p.field_role === 'worker' ? 'Рабочий' : 'Мастер'}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </Card>
          );
        })}

        {/* Total earned */}
        {stats.total_earned > 0 && (
          <Card variant="raised" className="text-center" style={{
            marginTop: 8, padding: 16,
            background: 'color-mix(in oklab, var(--ok) 8%, var(--bg-surface))',
            borderColor: 'color-mix(in oklab, var(--ok) 20%, transparent)',
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 4 }}>
              Всего заработано за все объекты
            </div>
            <div style={{ fontSize: 26, fontWeight: 900, color: 'var(--ok)' }}>
              {formatMoney(Math.round(stats.total_earned))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
