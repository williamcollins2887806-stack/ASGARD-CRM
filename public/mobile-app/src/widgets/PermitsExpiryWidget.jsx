import { useState, useEffect } from 'react';
import { api } from '@/api/client';
import { plural } from '@/lib/utils';
import { WidgetShell } from '@/widgets/WidgetShell';

/**
 * PermitsExpiryWidget (WIDE) — истекающие допуски (<=30 дней)
 * API: GET /permits + GET /staff/employees (parallel)
 */
export default function PermitsExpiryWidget() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [permitsRes, empRes] = await Promise.all([
          api.get('/permits?limit=500'),
          api.get('/staff/employees?limit=1000').catch(() => null),
        ]);

        const permits = api.extractRows(permitsRes);
        const empMap = {};
        if (empRes) {
          api.extractRows(empRes).forEach((e) => {
            empMap[e.id] = e.full_name || e.fio || e.last_name || '—';
          });
        }

        const now = Date.now();
        const expiring = permits
          .filter((p) => p.valid_to)
          .map((p) => {
            const days = Math.floor(
              (new Date(p.valid_to).getTime() - now) / 86400000
            );
            return {
              id: p.id,
              userName: empMap[p.employee_id] || '—',
              type: p.permit_type || p.type_name || '—',
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
