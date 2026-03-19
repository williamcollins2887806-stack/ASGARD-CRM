import { useState, useEffect } from 'react';
import { api } from '@/api/client';
import { WidgetShell } from '@/widgets/WidgetShell';

/**
 * BirthdaysWidget — дни рождения в ближайшие 30 дней
 * API: GET /data/users
 */

function getInitials(name) {
  if (!name) return '??';
  const parts = name.trim().split(/\s+/);
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');
}

function getDaysUntilBirthday(birthDate) {
  const today = new Date();
  const bd = new Date(birthDate);
  const thisYear = new Date(today.getFullYear(), bd.getMonth(), bd.getDate());
  const nextYear = new Date(today.getFullYear() + 1, bd.getMonth(), bd.getDate());

  // Reset time parts for accurate day comparison
  today.setHours(0, 0, 0, 0);
  thisYear.setHours(0, 0, 0, 0);
  nextYear.setHours(0, 0, 0, 0);

  const diffThis = Math.round((thisYear - today) / 86400000);
  if (diffThis >= 0) return diffThis;
  return Math.round((nextYear - today) / 86400000);
}

function formatBirthdayDate(birthDate) {
  const bd = new Date(birthDate);
  const day = String(bd.getDate()).padStart(2, '0');
  const month = String(bd.getMonth() + 1).padStart(2, '0');
  return `${day}.${month}`;
}

function getFirstName(fullName) {
  if (!fullName) return '';
  const parts = fullName.trim().split(/\s+/);
  return parts.length > 1 ? parts[1] : parts[0];
}

export default function BirthdaysWidget() {
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/data/users?limit=200');
        const rows = api.extractRows(res);

        const upcoming = rows
          .filter((u) => u.birth_date)
          .map((u) => ({
            ...u,
            _days: getDaysUntilBirthday(u.birth_date),
          }))
          .filter((u) => u._days <= 30)
          .sort((a, b) => a._days - b._days)
          .slice(0, 3);

        setPeople(upcoming);
      } catch {
        setPeople([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <WidgetShell name="Дни рождения" icon="🎂" loading={loading}>
      {people.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-4">
          <span style={{ fontSize: 28 }}>🎂</span>
          <span
            style={{
              fontSize: 13,
              color: 'var(--text-tertiary)',
              fontWeight: 500,
            }}
          >
            Нет ДР в ближайшие 30 дней
          </span>
        </div>
      ) : (
        <div className="flex gap-2.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {people.map((person) => (
            <div
              key={person.id}
              className="flex flex-col items-center gap-1.5 shrink-0 py-3 px-2"
              style={{
                backgroundColor: 'var(--bg-surface-alt)',
                borderRadius: 14,
                minWidth: 100,
                textAlign: 'center',
              }}
            >
              {/* Avatar with initials */}
              <div
                className="flex items-center justify-center rounded-full"
                style={{
                  width: 40,
                  height: 40,
                  background: 'var(--hero-gradient)',
                  fontSize: 14,
                  fontWeight: 700,
                  color: '#fff',
                }}
              >
                {getInitials(person.full_name)}
              </div>

              {/* First name */}
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  lineHeight: 1.2,
                }}
              >
                {getFirstName(person.full_name)}
              </span>

              {/* Date + cake */}
              <div className="flex items-center gap-1">
                <span
                  style={{
                    fontSize: 12,
                    color: 'var(--text-secondary)',
                    fontWeight: 500,
                  }}
                >
                  {formatBirthdayDate(person.birth_date)}
                </span>
                <span style={{ fontSize: 14 }}>🎂</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </WidgetShell>
  );
}
