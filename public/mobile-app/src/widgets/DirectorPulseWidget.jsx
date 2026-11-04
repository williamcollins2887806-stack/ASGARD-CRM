import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { formatMoneyShort } from '@/lib/utils';

/**
 * DirectorPulseWidget (WIDE, hero) — «Пульс директора» на мобильной главной.
 *
 * Заказчик 03.11.2026: директор должен видеть ключевые цифры сразу на главной
 * и одним тапом попадать на полный экран аналитики.
 *
 * Данные (всё считает бэкенд, фронт ничего не выдумывает):
 *   GET /api/director-analytics/overview?period=month   → тендеры / заявки / работы
 *   GET /api/director-analytics/team-hours?period=week  → офис / СРМ / недоработка
 *
 * Тап по любой строке ведёт на /director-analytics (полный экран).
 */

const DIRECTOR_ROLES = ['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'ADMIN'];

function hoursLabel(minutes) {
  if (minutes == null) return '—';
  const m = Math.abs(Math.round(Number(minutes)));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return (minutes < 0 ? '−' : '') + h + 'ч' + (mm ? ' ' + mm + 'м' : '');
}

export default function DirectorPulseWidget() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const haptic = useHaptic();

  const [overview, setOverview] = useState(null);
  const [team, setTeam] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const allowed = DIRECTOR_ROLES.includes(user?.role || '');

  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setFailed(false);
    try {
      const [ov, th] = await Promise.all([
        api.get('/director-analytics/overview?period=month'),
        api.get('/director-analytics/team-hours?period=week'),
      ]);
      setOverview(ov || null);
      setTeam(th || null);
    } catch {
      setFailed(true);
      setOverview(null);
      setTeam(null);
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!allowed) return;
    const t = setInterval(load, 120000);
    return () => clearInterval(t);
  }, [allowed, load]);

  if (!allowed) return null;

  const tenders = overview?.tenders || {};
  const apps = overview?.applications || {};
  const works = overview?.works || {};
  const norm = team?.norm || {};
  const avg = team?.avg || {};
  const quality = team?.data_quality || {};

  const go = () => {
    haptic.light();
    navigate('/director-analytics');
  };

  const underPct = norm.under_pct;
  const underTone = underPct == null ? 'neutral' : underPct >= 50 ? 'bad' : underPct >= 25 ? 'warn' : 'ok';

  // Показываем «нет данных» честно: пока не было импорта СКУД, 0 часов не рисуем.
  const noSkud = !quality.last_import;

  const cells = [
    {
      k: 'Тендеры',
      v: tenders.total ?? '—',
      s: tenders.conversion != null
        ? `конв. ${tenders.conversion}%`
        : (tenders.won != null ? `выиграли ${tenders.won}` : 'за месяц'),
    },
    {
      k: 'Заявки',
      v: apps.total ?? '—',
      s: apps.overdue_count
        ? `просроч. ${apps.overdue_count}`
        : (apps.conversion != null ? `конв. ${apps.conversion}%` : 'в контуре'),
    },
    {
      k: 'Работы',
      v: works.active ?? '—',
      s: works.risk_count
        ? `риск ${works.risk_count}`
        : `${works.pause ?? 0} на паузе`,
    },
    {
      k: 'Норма', v: underPct == null ? '—' : `${underPct}%`,
      s: underPct == null ? 'нет данных' : `${norm.people_under ?? 0} из ${norm.people_total ?? 0}`,
      tone: underTone,
    },
  ];

  return (
    <button
      type="button"
      onClick={go}
      className="w-full text-left spring-tap"
      style={{
        borderRadius: 18,
        overflow: 'hidden',
        background: 'color-mix(in srgb, var(--bg-surface) 90%, transparent)',
        border: '0.5px solid var(--border-norse)',
        boxShadow: 'var(--shadow-sm)',
        animation: 'fadeInUp var(--motion-normal) var(--ease-spring) forwards',
      }}
      aria-label="Пульс директора — открыть аналитику"
    >
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '13px 15px 11px',
          borderBottom: '0.5px solid var(--border-norse)',
        }}
      >
        <span
          style={{
            width: 8, height: 8, borderRadius: 99,
            background: 'var(--gold)',
            boxShadow: '0 0 0 3px color-mix(in srgb, var(--gold) 22%, transparent)',
          }}
        />
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.02em', color: 'var(--text-primary)' }}>
          Пульс директора
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-tertiary)' }}>
          {loading ? 'обновление…' : 'месяц'}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
        {cells.map((c, i) => (
          <div
            key={c.k}
            style={{
              padding: '11px 8px 12px',
              borderRight: i < 3 ? '0.5px solid var(--border-norse)' : 'none',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)' }}>
              {c.k}
            </div>
            <div
              style={{
                marginTop: 3,
                fontSize: 21,
                fontWeight: 800,
                letterSpacing: '-0.02em',
                fontVariantNumeric: 'tabular-nums',
                color: c.tone === 'bad' ? 'var(--danger-ink)'
                  : c.tone === 'ok' ? 'var(--ok-ink, var(--green))'
                    : c.tone === 'warn' ? 'var(--gold-ink, var(--gold))'
                      : 'var(--text-primary)',
              }}
            >
              {failed ? '—' : c.v}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {failed ? 'ошибка' : c.s}
            </div>
          </div>
        ))}
      </div>

      {/* Часы: офис / СРМ — отдельной полосой, потому что это другой контур */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '9px 15px',
          borderTop: '0.5px solid var(--border-norse)',
          background: 'color-mix(in srgb, var(--gold) 5%, transparent)',
          fontSize: 11.5,
          color: 'var(--text-secondary)',
        }}
      >
        {noSkud ? (
          <span style={{ color: 'var(--text-tertiary)' }}>Отчёт СКУД ещё не загружен — часы офиса не считаются</span>
        ) : (
          <>
            <span>
              Офис <b style={{ color: 'var(--text-primary)' }}>{hoursLabel(avg.office_minutes_per_day)}</b>/день
            </span>
            <span style={{ opacity: 0.4 }}>·</span>
            <span>
              СРМ <b style={{ color: 'var(--text-primary)' }}>{hoursLabel(avg.crm_minutes_per_day)}</b>/день
            </span>
          </>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--gold-ink, var(--gold))', fontWeight: 600 }}>
          Открыть →
        </span>
      </div>
    </button>
  );
}
