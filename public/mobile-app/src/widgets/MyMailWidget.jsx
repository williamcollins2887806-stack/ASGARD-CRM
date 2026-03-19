import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { WidgetShell } from './WidgetShell';
import { relativeTime } from '@/lib/utils';
import { useHaptic } from '@/hooks/useHaptic';

/**
 * MyMailWidget — моя почта (последние 5 писем)
 * API: GET /my-mail/emails?limit=5
 */
export default function MyMailWidget() {
  const [emails, setEmails] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const haptic = useHaptic();

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/my-mail/emails?limit=5');
        const rows = api.extractRows(res);
        setEmails(rows.slice(0, 5));
      } catch {
        setEmails([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <WidgetShell name="Моя почта" icon="📧" loading={loading}>
      <div
        className="spring-tap cursor-pointer"
        onClick={() => {
          haptic.light();
          navigate('/my-mail');
        }}
      >
        {emails.length === 0 ? (
          <div className="flex items-center justify-center py-4">
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Нет писем
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {emails.map((email) => {
              const unread = !email.is_read;

              return (
                <div
                  key={email.id}
                  className="flex items-start gap-2.5"
                  style={{
                    backgroundColor: 'var(--bg-surface-alt)',
                    borderRadius: 12,
                    padding: '10px 12px',
                  }}
                >
                  {/* Unread dot */}
                  <div className="flex-shrink-0 mt-1.5">
                    {unread && (
                      <div
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          backgroundColor: 'var(--blue)',
                        }}
                      />
                    )}
                    {!unread && <div style={{ width: 8, height: 8 }} />}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className="truncate"
                        style={{
                          fontSize: 14,
                          fontWeight: unread ? 600 : 400,
                          color: 'var(--text-primary)',
                        }}
                      >
                        {email.from_name || 'Неизвестный'}
                      </span>
                      <span
                        className="flex-shrink-0"
                        style={{
                          fontSize: 11,
                          color: 'var(--text-tertiary)',
                        }}
                      >
                        {relativeTime(email.created_at || email.date)}
                      </span>
                    </div>
                    <p
                      className="truncate mt-0.5"
                      style={{
                        fontSize: 13,
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {email.subject || 'Без темы'}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </WidgetShell>
  );
}
