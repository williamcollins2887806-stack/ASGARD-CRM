/**
 * FieldJourney.jsx — Journey Map ("Карта подвигов")
 * Shows all projects/cities the worker has been deployed to
 * with stats, achievements, and Norse-themed visuals
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';

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
    <div style={{ background: '#0b0e1a', minHeight: '100dvh', padding: 20 }}>
      {[1,2,3].map(i => (
        <div key={i} style={{ height: 120, borderRadius: 18, marginBottom: 12,
          background: 'linear-gradient(90deg,#141828 25%,#1a2040 50%,#141828 75%)',
          backgroundSize: '200% 100%', animation: 'jm-shimmer 1.5s infinite' }} />
      ))}
      <style>{`@keyframes jm-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
    </div>
  );

  const projects = data?.projects || [];
  const stats = data?.stats || {};
  const achievements = data?.achievements || [];

  return (
    <div style={{
      background: '#0b0e1a', minHeight: '100dvh', color: '#fff',
      fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Round',system-ui,sans-serif",
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
        paddingTop: 'max(env(safe-area-inset-top), 10px)',
        background: 'linear-gradient(180deg, rgba(11,14,26,.95), rgba(11,14,26,.7))',
        backdropFilter: 'blur(12px)', position: 'sticky', top: 0, zIndex: 20,
      }}>
        <button onClick={() => navigate(-1)} style={{
          width: 36, height: 36, borderRadius: 12, background: 'rgba(255,255,255,.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer',
        }}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="rgba(255,255,255,.7)" strokeWidth="2.2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ fontFamily: "'Cinzel',serif", fontSize: 16, fontWeight: 900, letterSpacing: '.12em', color: '#F0C850' }}>КАРТА ПОДВИГОВ</div>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,.4)', letterSpacing: '.15em' }}>ПУТЬ ВОИНА</div>
        </div>
        <div style={{ width: 36 }} />
      </div>

      <div style={{ padding: '12px 16px', maxWidth: 430, margin: '0 auto' }}>
        {/* Stats summary */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 16,
        }}>
          {[
            { label: 'Объектов', value: stats.total_projects || 0, icon: '🏗' },
            { label: 'Городов', value: stats.total_cities || 0, icon: '🏙' },
            { label: 'Смен', value: stats.total_shifts || 0, icon: '⚔️' },
          ].map(s => (
            <div key={s.label} style={{
              padding: '12px 8px', borderRadius: 16, textAlign: 'center',
              background: '#141828', border: '1px solid rgba(255,255,255,.04)',
            }}>
              <div style={{ fontSize: 24, marginBottom: 4 }}>{s.icon}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#F0C850' }}>{s.value}</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,.5)', fontWeight: 600 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Achievements */}
        {achievements.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.1em', color: 'rgba(255,255,255,.4)', textTransform: 'uppercase', marginBottom: 8, textAlign: 'center' }}>
              Достижения путешественника
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              {achievements.map(a => (
                <div key={a.id} style={{
                  padding: '8px 14px', borderRadius: 14,
                  background: 'linear-gradient(135deg, rgba(61,220,132,.1), rgba(61,220,132,.04))',
                  border: '1px solid rgba(61,220,132,.25)', display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <span style={{ fontSize: 18 }}>{a.icon}</span>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 800 }}>{a.name}</div>
                    <div style={{ fontSize: 9, color: 'rgba(255,255,255,.5)' }}>{a.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Project list — visual cards */}
        {projects.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <div style={{ fontSize: 60, marginBottom: 12 }}>🗺️</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'rgba(255,255,255,.5)' }}>Путь ещё не начат</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,.3)', marginTop: 4 }}>Первый объект появится после чекина</div>
          </div>
        ) : projects.map((p, idx) => {
          const isFirst = idx === 0;
          return (
            <div key={p.work_id} style={{
              marginBottom: 12, borderRadius: 18, overflow: 'hidden', position: 'relative',
              background: isFirst
                ? 'linear-gradient(135deg, rgba(240,200,80,.06), rgba(240,200,80,.02))'
                : '#141828',
              border: `1px solid ${isFirst ? 'rgba(240,200,80,.2)' : 'rgba(255,255,255,.04)'}`,
              boxShadow: isFirst ? '0 4px 20px rgba(240,200,80,.08)' : '0 4px 16px rgba(0,0,0,.2)',
            }}>
              {/* Left accent */}
              <div style={{
                position: 'absolute', left: 0, top: 0, bottom: 0, width: 4,
                background: isFirst ? 'linear-gradient(180deg, #F0C850, #C8940A)' : 'rgba(255,255,255,.06)',
                borderRadius: '4px 0 0 4px',
              }} />

              <div style={{ padding: '14px 14px 14px 18px' }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 22,
                    background: isFirst ? 'rgba(240,200,80,.1)' : 'rgba(255,255,255,.04)',
                    border: `1px solid ${isFirst ? 'rgba(240,200,80,.2)' : 'rgba(255,255,255,.06)'}`,
                  }}>
                    {isFirst ? '🏗' : '📍'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {p.object_name || p.work_title}
                    </div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span>📍</span> {p.city || 'Не указан'}
                    </div>
                  </div>
                  {isFirst && (
                    <div style={{
                      padding: '3px 10px', borderRadius: 10, fontSize: 10, fontWeight: 800,
                      background: 'linear-gradient(135deg, #C8940A, #F0C850)', color: '#1a1000',
                    }}>СЕЙЧАС</div>
                  )}
                </div>

                {/* Stats row */}
                <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
                  <div>
                    <span style={{ color: 'rgba(255,255,255,.4)' }}>Смен: </span>
                    <span style={{ fontWeight: 700 }}>{p.total_shifts}</span>
                  </div>
                  <div>
                    <span style={{ color: 'rgba(255,255,255,.4)' }}>Часов: </span>
                    <span style={{ fontWeight: 700 }}>{Math.round(parseFloat(p.total_hours))}</span>
                  </div>
                  <div style={{ marginLeft: 'auto' }}>
                    <span style={{ fontWeight: 700, color: '#3DDC84' }}>
                      {parseFloat(p.total_earned).toLocaleString('ru-RU')} ₽
                    </span>
                  </div>
                </div>

                {/* Date range */}
                {p.first_shift && (
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', marginTop: 6 }}>
                    {new Date(p.first_shift).toLocaleDateString('ru-RU')} — {p.last_shift ? new Date(p.last_shift).toLocaleDateString('ru-RU') : 'н.в.'}
                    <span style={{ marginLeft: 8, color: 'rgba(255,255,255,.2)' }}>{p.field_role === 'worker' ? '⚔️ Рабочий' : '👑 Мастер'}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Total earned */}
        {stats.total_earned > 0 && (
          <div style={{
            marginTop: 8, padding: 16, borderRadius: 18, textAlign: 'center',
            background: 'linear-gradient(135deg, rgba(61,220,132,.06), rgba(61,220,132,.02))',
            border: '1px solid rgba(61,220,132,.15)',
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.4)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 4 }}>
              Всего заработано за все объекты
            </div>
            <div style={{ fontSize: 26, fontWeight: 900, color: '#3DDC84' }}>
              {Math.round(stats.total_earned).toLocaleString('ru-RU')} ₽
            </div>
          </div>
        )}

        <div style={{ height: 'max(env(safe-area-inset-bottom), 20px)' }} />
      </div>
    </div>
  );
}
