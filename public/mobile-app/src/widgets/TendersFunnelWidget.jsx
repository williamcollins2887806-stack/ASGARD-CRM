import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { WidgetShell } from '@/widgets/WidgetShell';

/**
 * TendersFunnelWidget — воронка тендеров (6 этапов)
 * API: GET /data/tenders
 */

const STAGES = [
  {
    label: 'Новый',
    statuses: ['Новый', 'Черновик', 'Получен'],
    color: 'var(--blue)',
  },
  {
    label: 'Просчёт',
    statuses: ['В просчёте', 'На просчёте', 'КП отправлено', 'Согласование ТКП'],
    color: 'var(--gold)',
  },
  {
    label: 'Подано',
    statuses: [
      'ТКП согласовано',
      'ТКП отправлено',
      'Переговоры',
      'На согласовании',
    ],
    color: '#D4A843',
  },
  {
    label: 'В работе',
    statuses: ['В работе', 'Выполняется', 'Мобилизация'],
    color: '#4dabf7',
  },
  {
    label: 'Выиграно',
    statuses: ['Выиграли', 'Клиент согласился', 'Контракт'],
    color: 'var(--green)',
  },
  {
    label: 'Отказ',
    statuses: [
      'Отказ',
      'Проиграли',
      'Клиент отказался',
      'Отменён',
      'Отклонено',
    ],
    color: 'var(--red)',
  },
];

export default function TendersFunnelWidget() {
  const [counts, setCounts] = useState(STAGES.map(() => 0));
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/data/tenders?limit=50');
        const rows = api.extractRows(res);

        const stageCounts = STAGES.map((stage) => {
          const set = new Set(stage.statuses);
          return rows.filter((t) => set.has(t.tender_status)).length;
        });

        setCounts(stageCounts);
      } catch {
        setCounts(STAGES.map(() => 0));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const maxCount = Math.max(...counts, 1);

  return (
    <WidgetShell name="Воронка" icon="📊" loading={loading}>
      <button
        className="w-full text-left spring-tap"
        onClick={() => navigate('/tenders')}
      >
        <div className="flex flex-col">
          {STAGES.map((stage, i) => {
            const count = counts[i];
            const barPct = (count / maxCount) * 100;
            const staggerDelay = i * 60;

            return (
              <div
                key={stage.label}
                className="flex items-center gap-2 mb-1.5"
              >
                {/* Count badge */}
                <div
                  className="shrink-0 flex items-center justify-center rounded-md"
                  style={{
                    width: 26,
                    height: 26,
                    backgroundColor: `color-mix(in srgb, ${stage.color} 22%, transparent)`,
                  }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: stage.color,
                    }}
                  >
                    {count}
                  </span>
                </div>

                {/* Bar */}
                <div
                  className="flex-1 overflow-hidden"
                  style={{
                    height: 24,
                    backgroundColor: 'var(--bg-elevated)',
                    borderRadius: '0 8px 8px 0',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.max(barPct, 2)}%`,
                      background: stage.color,
                      borderRadius: '0 8px 8px 0',
                      opacity: 0.75,
                      transition: `width 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) ${staggerDelay}ms`,
                    }}
                  />
                </div>

                {/* Label */}
                <span
                  className="shrink-0"
                  style={{
                    fontSize: 11,
                    color: 'var(--text-tertiary)',
                    minWidth: 48,
                    textAlign: 'right',
                  }}
                >
                  {stage.label}
                </span>
              </div>
            );
          })}
        </div>
      </button>
    </WidgetShell>
  );
}
