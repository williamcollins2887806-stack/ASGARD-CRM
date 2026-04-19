import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { WidgetShell } from './WidgetShell';
import { BigNumber } from '@/components/shared/BigNumber';
import { formatMoney } from '@/lib/utils';
import { useHaptic } from '@/hooks/useHaptic';

/**
 * EquipmentValueWidget — стоимость ТМЦ на балансе
 * API: GET /equipment/balance-value
 */
export default function EquipmentValueWidget() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const haptic = useHaptic();

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/equipment/balance-value');
        setData(res);
      } catch {
        setData(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const totalValue = data?.total_book_value || 0;
  const totalItems = data?.total_items || 0;
  const expiringCount = data?.expiring_soon?.count || 0;

  return (
    <WidgetShell name="Стоимость ТМЦ" icon="📦" loading={loading}>
      <div
        className="spring-tap cursor-pointer"
        onClick={() => {
          haptic.light();
          navigate('/warehouse');
        }}
      >
        <BigNumber
          value={totalValue}
          label="ТМЦ на балансе компании"
          icon="📦"
          format={(v) => formatMoney(v, { short: true })}
        />

        <div className="flex items-center gap-2 mt-3">
          {/* Кол-во единиц */}
          <span
            className="px-2.5 py-1 rounded-full"
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--blue)',
              backgroundColor: 'rgba(26, 74, 138, 0.12)',
            }}
          >
            {totalItems} ед.
          </span>

          {/* Истекающие */}
          {expiringCount > 0 && (
            <span
              className="px-2.5 py-1 rounded-full"
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: '#D4A843',
                backgroundColor: 'rgba(212, 168, 67, 0.12)',
              }}
            >
              {expiringCount} истекает
            </span>
          )}
        </div>
      </div>
    </WidgetShell>
  );
}
