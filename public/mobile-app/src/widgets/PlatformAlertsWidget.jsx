import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { formatMoney } from '@/lib/utils';
import { WidgetShell } from '@/widgets/WidgetShell';

/**
 * PlatformAlertsWidget — тендерные площадки (до 3 карточек)
 * API: GET /integrations/platforms?limit=5
 */
export default function PlatformAlertsWidget() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/integrations/platforms?limit=5');
        const rows = api.extractRows(res);
        setItems(rows.slice(0, 3));
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <WidgetShell name="Тендерные площадки" icon="🏗" loading={loading}>
      <button
        className="w-full text-left spring-tap"
        onClick={() => navigate('/integrations')}
      >
        {items.length === 0 ? (
          <p
            style={{
              fontSize: 13,
              color: 'var(--text-tertiary)',
              fontWeight: 500,
            }}
          >
            Нет данных
          </p>
        ) : (
          <div className="flex flex-col">
            {items.map((item, i) => {
              const daysLeft = item.daysLeft ?? item.days_left ?? 0;
              return (
                <div
                  key={item.id || i}
                  className="rounded-xl p-3 mb-2"
                  style={{ backgroundColor: 'var(--bg-surface-alt)' }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className="flex-1 min-w-0"
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: 'var(--text-primary)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {item.customer_name || item.name || '—'}
                    </span>

                    <span
                      className="shrink-0 px-2 py-0.5 rounded-md"
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: '#fff',
                        backgroundColor:
                          daysLeft <= 3 ? 'var(--red)' : 'orange',
                      }}
                    >
                      {daysLeft} дн
                    </span>
                  </div>

                  {(item.nmck || item.NMCK) && (
                    <p
                      className="mt-1"
                      style={{
                        fontSize: 12,
                        color: 'var(--text-secondary)',
                      }}
                    >
                      НМЦК: {formatMoney(item.nmck || item.NMCK)}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </button>
    </WidgetShell>
  );
}
