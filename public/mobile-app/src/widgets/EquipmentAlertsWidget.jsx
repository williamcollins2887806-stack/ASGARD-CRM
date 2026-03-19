import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { useHaptic } from '@/hooks/useHaptic';
import { WidgetShell } from '@/widgets/WidgetShell';

/**
 * EquipmentAlertsWidget — алерты по обслуживанию оборудования
 * API: GET /equipment/maintenance/upcoming
 */
export default function EquipmentAlertsWidget() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const haptic = useHaptic();

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/equipment/maintenance/upcoming');
        const rows = api.extractRows(res);
        setAlerts(rows.slice(0, 3));
      } catch {
        setAlerts([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <WidgetShell name="Оборудование \u2022 Алерты" icon="🛠" loading={loading}>
      <button
        className="w-full text-left spring-tap"
        onClick={() => {
          haptic.light();
          navigate('/warehouse');
        }}
      >
        {alerts.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-4">
            <span
              style={{
                fontSize: 13,
                color: 'var(--text-tertiary)',
                fontWeight: 500,
              }}
            >
              Нет алертов
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {alerts.map((alert, i) => (
              <div
                key={alert.id || i}
                className="flex items-start gap-2.5 p-2.5"
                style={{
                  backgroundColor: 'var(--bg-surface-alt)',
                  borderRadius: 10,
                }}
              >
                {/* Warning icon */}
                <span
                  style={{
                    fontSize: 16,
                    lineHeight: 1,
                    color: 'orange',
                    flexShrink: 0,
                    marginTop: 1,
                  }}
                >
                  ⚠️
                </span>

                <div className="flex-1 min-w-0">
                  {/* Equipment name */}
                  <p
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: 'var(--text-primary)',
                      lineHeight: 1.3,
                    }}
                  >
                    {alert.name || alert.equipment_name || 'Оборудование'}
                  </p>

                  {/* Alert text */}
                  <p
                    className="mt-0.5"
                    style={{
                      fontSize: 11,
                      color: 'orange',
                      fontWeight: 500,
                      lineHeight: 1.3,
                    }}
                  >
                    {alert.alert_text || alert.description || alert.message || 'Требуется обслуживание'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </button>
    </WidgetShell>
  );
}
