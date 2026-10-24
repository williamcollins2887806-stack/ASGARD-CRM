import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { StatCard, StatRow } from '@/components/shared/StatCard';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Users, Inbox, ChevronRight, Briefcase, TrendingUp } from 'lucide-react';
import { formatMoney } from '@/lib/utils';

/**
 * DirectorApplications — дашборд заявок по руководителям проектов (D-343).
 *
 * Зачем (требование заказчика 23.10.2026): директор должен видеть, как работают
 * его РП — сколько заявок пришло, сколько в работе, принято, отклонено, без
 * движения — и провалиться в конкретного РП, чтобы посмотреть его заявки.
 *
 * Цепочка заявки (проверено по коду):
 *   письмо (IMAP) → inbox_applications («Корзина заявок», директор назначает РП)
 *   → pre_tender_requests («Маркетплейс», РП забирает в работу)
 *   → карточка канбана → works (работы).
 *
 * Данные: GET /api/pre-tenders/pm-summary — считает БД, фронт ничего не выдумывает.
 * Где данных нет, показываем «—», а не ноль ради красоты.
 */
const DIRECTOR_ROLES = ['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'ADMIN'];

export default function DirectorApplications() {
  const haptic = useHaptic();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [opened, setOpened] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/pre-tenders/pm-summary');
      setData(res);
    } catch (e) {
      setError(e?.message || 'Не удалось загрузить сводку');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const items = data?.items || [];
  const totals = data?.totals || {};

  // Сортировка: сначала те, у кого больше заявок в работе — это живые РП.
  const sorted = useMemo(
    () => [...items].sort((a, b) => (b.in_work || 0) - (a.in_work || 0)),
    [items]
  );

  return (
    <PageShell
      title="Заявки по РП"
      subtitle={items.length ? `${items.length} руководителей` : 'Сводка по заявкам'}
    >
      <PullToRefresh onRefresh={fetchData}>
        {loading ? (
          <SkeletonList count={4} />
        ) : error ? (
          <EmptyState
            icon={Inbox}
            iconColor="var(--danger-ink)"
            iconBg="color-mix(in srgb, var(--danger) 12%, transparent)"
            title="Не удалось загрузить"
            description={error}
          />
        ) : !items.length ? (
          <EmptyState
            icon={Users}
            iconColor="var(--blue)"
            iconBg="color-mix(in srgb, var(--blue) 12%, transparent)"
            title="Нет руководителей"
            description="Активных РП с заявками не найдено"
          />
        ) : (
          <>
            {/* Итоги по всем РП — общая картина сверху */}
            <StatRow>
              <StatCard label="Всего заявок" color="var(--blue)" value={totals.total || 0} />
              <StatCard label="В работе" color="var(--gold)" value={totals.in_work || 0} />
              <StatCard label="Работ создано" color="var(--green)" value={totals.works_total || 0} />
            </StatRow>

            {/* Тендеры по РП: подались / выиграли / проиграли / отмена — то,
                что заказчик назвал ключевыми показателями работы РП. */}
            {totals.tenders_total > 0 && (
              <StatRow>
                <StatCard label="Подались" color="var(--blue)" value={totals.submitted || 0} />
                <StatCard label="Выиграли" color="var(--green)" value={totals.won || 0} />
                <StatCard label="Проиграли" color="var(--danger-ink)" value={totals.lost || 0} />
              </StatRow>
            )}

            {/* Заявки без РП: их не видно ни у одного РП, но они существуют.
                Директор должен знать, что часть заявок ещё не распределена. */}
            {data?.unassigned?.total > 0 && (
              <div
                className="card-glass"
                style={{
                  padding: '12px 14px',
                  marginBottom: 10,
                  border: '0.5px solid color-mix(in srgb, var(--gold) 35%, var(--border-norse))',
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="c-primary" style={{ fontSize: 14, fontWeight: 700 }}>
                      Без РП
                    </p>
                    <p className="c-tertiary" style={{ fontSize: 11.5, marginTop: 2 }}>
                      Не распределены ни на одного руководителя
                    </p>
                  </div>
                  <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--gold)', flexShrink: 0 }}>
                    {data.unassigned.total}
                  </span>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2 pb-4">
              {sorted.map((pm, i) => (
                <button
                  key={pm.pm_id}
                  type="button"
                  className="card-glass spring-tap w-full text-left"
                  style={{ padding: '14px 16px', animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 35}ms both` }}
                  onClick={() => { haptic.light(); setOpened(pm); }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="c-primary" style={{ fontSize: 15, fontWeight: 700 }}>
                        {pm.pm_name}
                      </p>
                      <p className="c-tertiary" style={{ fontSize: 11.5, marginTop: 2 }}>
                        Заявок: {pm.total} · тендеров: {pm.tenders_total} · работы: {pm.works_total}
                      </p>
                    </div>
                    <ChevronRight size={16} className="c-tertiary" style={{ flexShrink: 0 }} />
                  </div>

                  {/* Мини-сводка: заявки и результаты тендеров */}
                  <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
                    {pm.in_work > 0 && (
                      <StatusBadge status="в работе" label={`заявок ${pm.in_work}`} />
                    )}
                    {pm.submitted > 0 && (
                      <StatusBadge status="в работе" label={`подались ${pm.submitted}`} />
                    )}
                    {pm.won > 0 && (
                      <StatusBadge status="выиграли" label={`выиграли ${pm.won}`} />
                    )}
                    {pm.lost > 0 && (
                      <StatusBadge status="отклонено" label={`проиграли ${pm.lost}`} />
                    )}
                    {pm.cancelled > 0 && (
                      <StatusBadge status="завершен" label={`отмена ${pm.cancelled}`} />
                    )}
                    {pm.in_work === 0 && pm.submitted === 0 && pm.won === 0
                      && pm.lost === 0 && pm.cancelled === 0 && (
                      <span className="c-tertiary" style={{ fontSize: 11.5 }}>нет активности</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </PullToRefresh>

      {/* Деталь по РП: его заявки в реальном статусе (без выдумок — данные из API) */}
      <PmApplicationsSheet pm={opened} onClose={() => setOpened(null)} />
    </PageShell>
  );
}

/** Заявки конкретного РП: путь /api/pre-tenders с фильтром assigned_to. */
function PmApplicationsSheet({ pm, onClose }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!pm?.pm_id) return undefined;
    let cancelled = false;
    setLoading(true);
    setError('');
    api.get(`/pre-tenders/?assigned_to=${pm.pm_id}&limit=100`)
      .then((res) => { if (!cancelled) setRows(res.items || res.data || res.rows || []); })
      .catch((e) => { if (!cancelled) setError(e?.message || 'Не удалось загрузить заявки'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [pm?.pm_id]);

  if (!pm) return null;

  const statusLabel = (s) => ({
    new: 'новая', in_review: 'в работе', need_docs: 'нужны документы',
    pending_approval: 'на согласовании', approved: 'одобрена',
    accepted: 'принята', rejected: 'отклонена', expired: 'истекла',
  }[s] || s || '—');

  return (
    <BottomSheet
      open={!!pm}
      onClose={onClose}
      title={pm.pm_name}
      maxHeight="90vh"
    >
      <div className="flex flex-col gap-3 pb-4">
        {/* Сводка по РП */}
        <div className="grid grid-cols-2 gap-2">
          <div className="card-glass" style={{ padding: '10px 12px' }}>
            <div className="c-tertiary" style={{ fontSize: 11, marginBottom: 4 }}>Всего заявок</div>
            <div className="c-primary" style={{ fontSize: 20, fontWeight: 800 }}>{pm.total}</div>
          </div>
          <div className="card-glass" style={{ padding: '10px 12px' }}>
            <div className="c-tertiary" style={{ fontSize: 11, marginBottom: 4 }}>В работе</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--gold)' }}>{pm.in_work}</div>
          </div>
          <div className="card-glass" style={{ padding: '10px 12px' }}>
            <div className="c-tertiary" style={{ fontSize: 11, marginBottom: 4 }}>Принято</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--green)' }}>{pm.accepted}</div>
          </div>
          <div className="card-glass" style={{ padding: '10px 12px' }}>
            <div className="c-tertiary" style={{ fontSize: 11, marginBottom: 4 }}>Отклонено</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--danger-ink)' }}>{pm.rejected}</div>
          </div>
          <div className="card-glass" style={{ padding: '10px 12px' }}>
            <div className="c-tertiary" style={{ fontSize: 11, marginBottom: 4 }}>Работ создано</div>
            <div className="c-primary" style={{ fontSize: 20, fontWeight: 800 }}>{pm.works_total}</div>
          </div>
          <div className="card-glass" style={{ padding: '10px 12px' }}>
            <div className="c-tertiary" style={{ fontSize: 11, marginBottom: 4 }}>В тендер</div>
            <div className="c-primary" style={{ fontSize: 20, fontWeight: 800 }}>{pm.converted}</div>
          </div>
        </div>

        {/* Результаты тендеров этого РП — то, что заказчик просил показать */}
        <div className="c-secondary" style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>
          Тендеры: {pm.tenders_total}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="card-glass" style={{ padding: '10px 12px' }}>
            <div className="c-tertiary" style={{ fontSize: 11, marginBottom: 4 }}>Подались</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--blue)' }}>{pm.submitted}</div>
          </div>
          <div className="card-glass" style={{ padding: '10px 12px' }}>
            <div className="c-tertiary" style={{ fontSize: 11, marginBottom: 4 }}>Выиграли</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--green)' }}>{pm.won}</div>
          </div>
          <div className="card-glass" style={{ padding: '10px 12px' }}>
            <div className="c-tertiary" style={{ fontSize: 11, marginBottom: 4 }}>Проиграли</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--danger-ink)' }}>{pm.lost}</div>
          </div>
          <div className="card-glass" style={{ padding: '10px 12px' }}>
            <div className="c-tertiary" style={{ fontSize: 11, marginBottom: 4 }}>Отмена</div>
            <div className="c-primary" style={{ fontSize: 20, fontWeight: 800 }}>{pm.cancelled}</div>
          </div>
          <div className="card-glass" style={{ padding: '10px 12px' }}>
            <div className="c-tertiary" style={{ fontSize: 11, marginBottom: 4 }}>В работе</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--gold)' }}>{pm.tenders_in_progress}</div>
          </div>
          <div className="card-glass" style={{ padding: '10px 12px' }}>
            <div className="c-tertiary" style={{ fontSize: 11, marginBottom: 4 }}>Работ</div>
            <div className="c-primary" style={{ fontSize: 20, fontWeight: 800 }}>{pm.works_total}</div>
          </div>
        </div>

        {/* Список заявок */}
        <div className="c-secondary" style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>
          Заявки ({rows.length})
        </div>

        {loading ? (
          <SkeletonList count={3} />
        ) : error ? (
          <p style={{ fontSize: 13, color: 'var(--danger-ink)' }}>{error}</p>
        ) : !rows.length ? (
          <p className="c-tertiary" style={{ fontSize: 13 }}>Заявок нет</p>
        ) : rows.map((r) => (
          <div key={r.id} className="card-glass" style={{ padding: 12, marginBottom: 8 }}>
            <div className="c-primary" style={{ fontSize: 14, fontWeight: 600 }}>
              {r.customer_name || `Заявка #${r.id}`}
            </div>
            {(r.work_title || r.work_description) && (
              <div className="c-secondary" style={{ fontSize: 12, marginTop: 3, lineHeight: 1.35 }}>
                {String(r.work_title || r.work_description).slice(0, 90)}
              </div>
            )}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <StatusBadge status={r.status} label={statusLabel(r.status)} />
              {r.estimated_sum != null && (
                <span className="c-tertiary" style={{ fontSize: 11.5 }}>
                  {formatMoney(Number(r.estimated_sum))}
                </span>
              )}
              {r.created_at && (
                <span className="c-tertiary" style={{ fontSize: 11 }}>
                  {new Date(r.created_at).toLocaleDateString('ru-RU')}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </BottomSheet>
  );
}
