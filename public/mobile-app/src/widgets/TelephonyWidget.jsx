import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { WidgetShell } from '@/widgets/WidgetShell';

/**
 * TelephonyWidget — статус телефонии и количество звонков
 * API: GET /telephony/stats → {total, missed}
 */
export default function TelephonyWidget() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/telephony/stats');
        setData(res);
      } catch {
        setData(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <WidgetShell name="Телефония" icon="📞" loading={loading}>
      <button
        className="w-full flex items-center gap-3 spring-tap"
        onClick={() => navigate('/telephony')}
      >
        {/* Icon container */}
        <div
          className="shrink-0 flex items-center justify-center rounded-lg"
          style={{
            width: 40,
            height: 40,
            backgroundColor: 'rgba(48,209,88,0.1)',
          }}
        >
          <span style={{ fontSize: 18, lineHeight: 1 }}>📞</span>
        </div>

        {/* Text block */}
        <div className="flex flex-col text-left">
          <span
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: 'var(--text-primary)',
            }}
          >
            Телефония
          </span>

          {data ? (
            <div className="flex items-center gap-2 mt-0.5">
              <span
                style={{
                  fontSize: 13,
                  color: 'var(--text-secondary)',
                }}
              >
                <span style={{ color: 'var(--green)' }}>●</span>{' '}
                Подключена · {data.total || 0}{' '}
                {data.total === 1 ? 'звонок' : 'звонков'}
              </span>

              {(data.missed || 0) > 0 && (
                <span
                  className="px-1.5 py-0.5 rounded-md"
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: '#fff',
                    backgroundColor: 'var(--red)',
                  }}
                >
                  {data.missed}
                </span>
              )}
            </div>
          ) : (
            <span
              className="mt-0.5"
              style={{
                fontSize: 13,
                color: 'var(--text-tertiary)',
              }}
            >
              ○ Нет данных
            </span>
          )}
        </div>
      </button>
    </WidgetShell>
  );
}
