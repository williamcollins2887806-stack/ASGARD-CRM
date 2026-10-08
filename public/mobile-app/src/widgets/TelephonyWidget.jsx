import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Phone } from 'lucide-react';
import { api } from '@/api/client';
import { WidgetShell } from '@/widgets/WidgetShell';
import { callTitle, formatCallTime } from '@/components/telephony/CallRow';

export default function TelephonyWidget() {
  const [data, setData] = useState(null);
  const [onLine, setOnLine] = useState(false);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const [sum, op] = await Promise.all([
          api.get('/telephony/me/summary'),
          api.get('/telephony/pbx/operator/status').catch(() => ({})),
        ]);
        setData(sum);
        setOnLine(!!op.on_line);
      } catch {
        setData(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const missed = data?.missed_unack || 0;
  const last = data?.recent?.[0];
  const lastLabel = last ? `${callTitle(last)} · ${formatCallTime(last.created_at)}` : 'Позвонить';

  return (
    <WidgetShell name="Телефон" icon="📞" loading={loading}>
      <button
        type="button"
        className="w-full flex items-center gap-3 spring-tap"
        style={{ minHeight: missed > 0 ? 44 : 36 }}
        onClick={() => navigate('/telephony')}
      >
        <div
          className="shrink-0 flex items-center justify-center rounded-lg"
          style={{
            width: missed > 0 ? 40 : 32,
            height: missed > 0 ? 40 : 32,
            backgroundColor: 'color-mix(in srgb, var(--gold) 12%, transparent)',
            color: 'var(--gold)',
          }}
        >
          <Phone size={missed > 0 ? 18 : 16} />
        </div>
        <div className="flex flex-col text-left min-w-0 flex-1">
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
            Телефон
          </span>
          <span className="mt-0.5 truncate" style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>
            {onLine ? 'На линии · ' : ''}
            {missed > 0
              ? `пропущено ${missed}`
              : lastLabel}
          </span>
        </div>
        {missed > 0 && (
          <span
            className="ml-auto px-1.5 py-0.5 rounded-md shrink-0"
            style={{ fontSize: 10, fontWeight: 700, color: 'var(--bg-primary)', backgroundColor: 'var(--red)' }}
          >
            {missed}
          </span>
        )}
      </button>
    </WidgetShell>
  );
}
