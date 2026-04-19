import { useState, useEffect } from 'react';
import { api } from '@/api/client';
import { plural } from '@/lib/utils';
import { WidgetShell } from '@/widgets/WidgetShell';

/**
 * PermitsExpiryWidget (WIDE) — истекающие допуски (<=30 дней)
 * API: GET /data/permits + GET /data/users (parallel)
 */
export default function PermitsExpiryWidget() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [permitsRes, usersRes] = await Promise.all([
          api.get('/data/permits?limit=500'),
          api.get('/data/users?limit=200'),
        ]);

        const permits = api.extractRows(permitsRes);
        const users = api.extractRows(usersRes);
        const usersMap = {};
        users.forEach((u) => {
          usersMap[u.id] = u.name || u.full_name || u.login || '—';
        });

        const now = Date.now();
        const expiring = permits
          .filter((p) => p.expiry_date)
          .map((p) => {
            const days = Math.floor(
              (new Date(p.expiry_date).getTime() - now) / 86400000
            );
            return {
              id: p.id,
              userName: usersMap[p.user_id] || '—',
              type: p.type || p.permit_type || '—',
              days,
            };
          })
          .filter((p) => p.days <= 30)
          .sort((a, b) => a.days - b.days)
          .slice(0, 3);

        setItems(expiring);
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const dotColor = (days) => {
    if (days <= 0) return 'var(--red)';
    if (days <= 14) return 'orange';
    return 'var(--gold)';
  };

  return (
    <WidgetShell name="Истекающие допуски" icon="🛡" loading={loading}>
      {items.length === 0 ? (
        <div className="flex items-center gap-2 py-2">
          <span style={{ fontSize: 18 }}>✅</span>
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--green)',
            }}
          >
            Все допуски в порядке
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-2.5">
              {/* Colored dot */}
              <div
                className="shrink-0"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: dotColor(item.days),
                }}
              />

              {/* Name + type */}
              <div className="flex-1 min-w-0">
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {item.userName}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--text-tertiary)',
                  }}
                >
                  {item.type}
                </div>
              </div>

              {/* Days badge */}
              <span
                className="shrink-0 px-2 py-0.5 rounded-md"
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#fff',
                  backgroundColor:
                    item.days <= 0 ? 'var(--red)' : dotColor(item.days),
                }}
              >
                {item.days <= 0
                  ? 'Истёк'
                  : `${item.days} ${plural(item.days, 'дн', 'дн', 'дн')}`}
              </span>
            </div>
          ))}
        </div>
      )}
    </WidgetShell>
  );
}
