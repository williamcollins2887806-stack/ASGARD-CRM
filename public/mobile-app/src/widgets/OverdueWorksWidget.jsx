import { useState, useEffect } from 'react';
import { api } from '@/api/client';
import { WidgetShell } from './WidgetShell';

const DONE_STATUSES = ['Работы сдали', 'Завершена', 'Закрыт', 'Выполнена', 'Выполнено'];

function getOverdueDays(endPlan) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const end = new Date(endPlan);
  end.setHours(0, 0, 0, 0);
  return Math.ceil((now - end) / 86400000);
}

/**
 * OverdueWorksWidget (WIDE) — просроченные работы
 * API: GET /works
 */
export default function OverdueWorksWidget() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/works?limit=200');
        const rows = api.extractRows(res);
        const now = new Date();

        const overdue = rows
          .filter(
            (w) =>
              w.end_plan &&
              new Date(w.end_plan) < now &&
              !DONE_STATUSES.includes(w.status)
          )
          .sort((a, b) => new Date(a.end_plan) - new Date(b.end_plan))
          .slice(0, 3);

        setItems(overdue);
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <WidgetShell name="Просроченные работы" icon="⚠️" loading={loading}>
      {items.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-4">
          <span style={{ fontSize: 20 }}>✅</span>
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--green)',
            }}
          >
            Всё в срок
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {items.map((work) => {
            const days = getOverdueDays(work.end_plan);

            return (
              <div
                key={work.id}
                className="rounded-xl p-3"
                style={{
                  backgroundColor: 'var(--bg-surface-alt)',
                }}
              >
                {/* Title + badge */}
                <div className="flex items-start justify-between gap-2">
                  <span
                    className="flex-1"
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: 'var(--text-primary)',
                      lineHeight: 1.3,
                    }}
                  >
                    {work.title || work.name || 'Без названия'}
                  </span>

                  <span
                    className="flex-shrink-0 px-2.5 py-0.5 rounded-full"
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#fff',
                      backgroundColor: 'var(--red)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Просрочено {days} дн
                  </span>
                </div>

                {/* Object name */}
                {work.object_name && (
                  <p
                    className="mt-1"
                    style={{
                      fontSize: 12,
                      color: 'var(--text-tertiary)',
                    }}
                  >
                    {work.object_name}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </WidgetShell>
  );
}
