import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { formatMoney } from '@/lib/utils';
import { WidgetShell } from '@/widgets/WidgetShell';

/**
 * PreTendersWidget — заявки (pre-tenders) new/in_review, до 3 штук
 * API: GET /pre-tenders?limit=10
 */
export default function PreTendersWidget() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/pre-tenders?limit=10');
        const rows = api.extractRows(res);
        const filtered = rows
          .filter(
            (r) => r.status === 'new' || r.status === 'in_review'
          )
          .slice(0, 3);
        setItems(filtered);
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const aiBadge = (score) => {
    const n = Number(score) || 0;
    if (n >= 70)
      return { label: 'Высокий шанс', bg: 'var(--green)', color: '#fff' };
    if (n >= 40)
      return { label: 'Средний шанс', bg: 'var(--gold)', color: '#0a0a0c' };
    return { label: 'Низкий шанс', bg: 'var(--red)', color: '#fff' };
  };

  return (
    <WidgetShell name="Заявки" icon="🤖" loading={loading}>
      <button
        className="w-full text-left spring-tap"
        onClick={() => navigate('/pre-tenders')}
      >
        {items.length === 0 ? (
          <p
            style={{
              fontSize: 13,
              color: 'var(--text-tertiary)',
              fontWeight: 500,
            }}
          >
            Нет активных заявок
          </p>
        ) : (
          <div className="flex flex-col">
            {items.map((item, i) => {
              // 23.06.2026 BUG-FIX (PreTenders D-9): реальные поля pre_tender_requests —
              //   `customer_name` (заголовок), `work_description` (описание),
              //   `ai_work_match_score` (AI score 0-100), `estimated_sum` (сумма).
              // До фикса виджет читал несуществующие `title/ai_score/nmck` → ВСЕ карточки были без названия и без суммы.
              const titleText = item.customer_name || item.work_description || item.title || item.name || '—';
              const aiScore   = item.ai_work_match_score ?? item.ai_score;
              const amount    = item.estimated_sum ?? item.nmck ?? item.NMCK ?? item.nmck_amount;
              const badge     = aiBadge(aiScore);
              return (
                <div
                  key={item.id || i}
                  className="rounded-xl p-3 mb-2"
                  style={{ backgroundColor: 'var(--bg-surface-alt)' }}
                >
                  {/* Title */}
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
                    {titleText}
                  </div>

                  <div className="flex items-center gap-2 mt-1.5">
                    {/* AI badge */}
                    <span
                      className="px-2 py-0.5 rounded-md"
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: badge.color,
                        backgroundColor: badge.bg,
                      }}
                    >
                      {badge.label}
                    </span>

                    {/* Сумма (НМЦК / оценка) */}
                    {amount && (
                      <span
                        style={{
                          fontSize: 12,
                          color: 'var(--text-secondary)',
                        }}
                      >
                        Сумма: {formatMoney(amount)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </button>
    </WidgetShell>
  );
}
