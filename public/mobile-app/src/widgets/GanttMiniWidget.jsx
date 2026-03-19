import { useState, useEffect } from 'react';
import { api } from '@/api/client';
import { WidgetShell } from './WidgetShell';
import { formatDate } from '@/lib/utils';

const DONE_STATUSES = ['Работы сдали', 'Завершена', 'Закрыт'];

function getDaysUntil(dateStr) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target - now) / 86400000);
}

function getDeadlineColor(days) {
  if (days <= 3) return 'var(--red)';
  if (days <= 7) return '#D4A843';
  return 'var(--blue)';
}

/**
 * GanttMiniWidget — ближайшие дедлайны
 * API: GET /works
 */
export default function GanttMiniWidget() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/works?limit=200');
        const rows = api.extractRows(res);
        const now = new Date();

        const filtered = rows
          .filter(
            (w) =>
              w.end_plan &&
              !DONE_STATUSES.includes(w.status) &&
              new Date(w.end_plan) >= now
          )
          .sort((a, b) => new Date(a.end_plan) - new Date(b.end_plan))
          .slice(0, 5);

        setItems(filtered);
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <WidgetShell name="Ближайшие дедлайны" icon="⏰" loading={loading}>
      {items.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-4">
          <span style={{ fontSize: 20 }}>✅</span>
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--text-secondary)',
            }}
          >
            Нет дедлайнов
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((item) => {
            const days = getDaysUntil(item.end_plan);
            const color = getDeadlineColor(days);

            return (
              <div key={item.id} className="flex items-center gap-3">
                {/* Date badge */}
                <div
                  className="flex-shrink-0 flex items-center justify-center rounded-lg"
                  style={{
                    width: 50,
                    height: 36,
                    backgroundColor: color + '26',
                    color: color,
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {formatDate(item.end_plan)}
                </div>

                {/* Title */}
                <span
                  className="flex-1 truncate"
                  style={{
                    fontSize: 14,
                    color: 'var(--text-primary)',
                  }}
                >
                  {item.title || item.name || 'Без названия'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </WidgetShell>
  );
}
