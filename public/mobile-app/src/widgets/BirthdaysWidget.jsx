import { useState, useEffect } from 'react';
import { api } from '@/api/client';
import { WidgetShell } from '@/widgets/WidgetShell';
import { openBirthdayAtelier } from '@/components/BirthdayGreetOverlay';
import { ageTodayLabel } from '@/lib/ageRu';

/**
 * BirthdaysWidget — сегодняшние ДР + ближайшие + CTA в ателье даров
 */

function getInitials(name) {
  if (!name) return '??';
  const parts = name.trim().split(/\s+/);
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');
}

function getFirstName(fullName) {
  if (!fullName) return '';
  const parts = fullName.trim().split(/\s+/);
  return parts.length > 1 ? parts[1] : parts[0];
}

export default function BirthdaysWidget() {
  const [today, setToday] = useState([]);
  const [upcoming, setUpcoming] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [t, u] = await Promise.all([
          api.get('/birthday-gifts/today').catch(() => ({ items: [] })),
          api.get('/birthdays?days=30').catch(() => ({ items: [] })),
        ]);
        const peers = (t.items || []).filter((it) => !it.is_me);
        setToday(peers);
        setUpcoming((u.items || []).filter((it) => !it.is_today).slice(0, 3));
      } catch {
        setToday([]);
        setUpcoming([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const empty = !today.length && !upcoming.length;

  return (
    <WidgetShell name="Дни рождения" icon="✦" loading={loading}>
      {empty ? (
        <div className="flex flex-col items-center gap-2 py-4">
          <span style={{ fontSize: 22, color: 'var(--gold, #D4A843)' }}>✦</span>
          <span style={{ fontSize: 13, color: 'var(--text-tertiary)', fontWeight: 500 }}>
            Нет ДР в ближайшие 30 дней
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {today.map((person) => (
            <div
              key={person.id}
              className="flex items-center gap-2.5 py-2 px-2"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--gold, #D4A843) 10%, var(--bg-surface-alt))',
                borderRadius: 14,
                border: '1px solid color-mix(in srgb, var(--gold, #D4A843) 28%, transparent)',
              }}
            >
              <div
                className="shrink-0 flex items-center justify-center"
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  background: 'linear-gradient(145deg, #F0D078, #D4A843 55%, #8B6914)',
                  color: '#0B0A09',
                  fontWeight: 700,
                  fontSize: 13,
                }}
              >
                {getInitials(person.name)}
              </div>
              <div className="flex-1 min-w-0">
                <div style={{ fontSize: 13, fontWeight: 650 }}>{getFirstName(person.name) || person.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                  {ageTodayLabel(person.age)}
                </div>
              </div>
              <button
                type="button"
                disabled={!!person.already_sent}
                onClick={() => openBirthdayAtelier(person)}
                style={{
                  borderRadius: 999,
                  border: '1px solid color-mix(in srgb, var(--gold, #D4A843) 45%, transparent)',
                  background: person.already_sent
                    ? 'transparent'
                    : 'linear-gradient(135deg, #F0D078, #D4A843)',
                  color: person.already_sent ? 'var(--gold, #D4A843)' : '#0B0A09',
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  padding: '7px 10px',
                  opacity: person.already_sent ? 0.7 : 1,
                }}
              >
                {person.already_sent ? 'Готово' : 'Поздравить'}
              </button>
            </div>
          ))}

          {upcoming.map((person) => (
            <div
              key={person.id}
              className="flex items-center gap-2.5 py-2 px-2"
              style={{ backgroundColor: 'var(--bg-surface-alt)', borderRadius: 14 }}
            >
              <div
                className="shrink-0 flex items-center justify-center"
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  background: 'color-mix(in srgb, var(--gold, #D4A843) 22%, transparent)',
                  color: 'var(--gold, #D4A843)',
                  fontWeight: 700,
                  fontSize: 13,
                }}
              >
                {getInitials(person.name)}
              </div>
              <div className="flex-1 min-w-0">
                <div style={{ fontSize: 13, fontWeight: 650 }}>{getFirstName(person.name) || person.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                  через {person.days_until} дн.
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </WidgetShell>
  );
}
