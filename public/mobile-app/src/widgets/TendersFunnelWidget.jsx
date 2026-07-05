import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/api/client';
import { loadRegistry } from '@/api/tendersRegistry';
import { REGISTRY_STATUS_LABELS, isToRole } from '@/lib/registryStatus';
import { WidgetShell } from '@/widgets/WidgetShell';

const PM_STAGES = [
  { label: 'Новый', statuses: ['Новый', 'Черновик', 'На анализе', 'Получен'], color: 'var(--blue)' },
  { label: 'Просчёт', statuses: ['Отправлено на просчёт', 'Согласование ТКП'], color: 'var(--gold)' },
  { label: 'ТКП', statuses: ['ТКП согласовано', 'Готово к отправке КП'], color: '#D4A843' },
  { label: 'КП отправлено', statuses: ['КП отправлено', 'ТКП отправлено', 'Переговоры'], color: '#9C7BC0' },
  { label: 'В работе', statuses: ['В работе', 'Выполняется', 'Мобилизация'], color: '#4dabf7' },
  { label: 'Выиграно', statuses: ['Выиграли'], color: 'var(--green)' },
  { label: 'Отказ', statuses: ['Проиграли', 'Отменён', 'Отклонено', 'Не подходит'], color: 'var(--red)' },
];

const TO_STAGES = [
  { key: 'рассмотрение', label: REGISTRY_STATUS_LABELS.рассмотрение, color: 'var(--text-tertiary)' },
  { key: 'готовим', label: REGISTRY_STATUS_LABELS.готовим, color: 'var(--blue)' },
  { key: 'подались', label: REGISTRY_STATUS_LABELS.подались, color: 'var(--gold)' },
  { key: 'выиграли', label: REGISTRY_STATUS_LABELS.выиграли, color: 'var(--green)' },
  { key: 'проиграли', label: REGISTRY_STATUS_LABELS.проиграли, color: 'var(--red)' },
  { key: 'отмена', label: REGISTRY_STATUS_LABELS.отмена, color: 'var(--text-tertiary)' },
];

export default function TendersFunnelWidget() {
  const user = useAuthStore((s) => s.user);
  const useRegistry = isToRole(user?.role);
  const stages = useRegistry ? TO_STAGES : PM_STAGES;

  const [counts, setCounts] = useState(stages.map(() => 0));
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        if (useRegistry) {
          const res = await loadRegistry({ subtab: 'registry', period: '', limit: 1000 });
          const rows = res.items || [];
          setCounts(TO_STAGES.map((s) => rows.filter((t) => t.registry_status === s.key).length));
        } else {
          const res = await api.get('/tenders?limit=500');
          const rows = api.extractRows(res);
          setCounts(PM_STAGES.map((stage) => {
            const set = new Set(stage.statuses);
            return rows.filter((t) => set.has(t.tender_status)).length;
          }));
        }
      } catch {
        setCounts(stages.map(() => 0));
      } finally {
        setLoading(false);
      }
    })();
  }, [useRegistry, stages]);

  const maxCount = Math.max(...counts, 1);
  const displayStages = useRegistry ? TO_STAGES : PM_STAGES;

  return (
    <WidgetShell name="Воронка тендеров" icon="📊" loading={loading}>
      <button className="w-full text-left spring-tap" onClick={() => navigate('/tenders')}>
        <div className="flex flex-col gap-2">
          {displayStages.map((stage, i) => (
            <div key={stage.key || stage.label} className="flex items-center gap-2">
              <span className="text-[10px] w-16 shrink-0 truncate c-secondary">{stage.label}</span>
              <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-elevated)' }}>
                <div
                  style={{
                    width: `${(counts[i] / maxCount) * 100}%`,
                    height: '100%',
                    background: stage.color,
                    borderRadius: 999,
                    transition: 'width 400ms ease',
                  }}
                />
              </div>
              <span className="text-[11px] font-semibold w-5 text-right tabular-nums" style={{ color: stage.color }}>
                {counts[i]}
              </span>
            </div>
          ))}
        </div>
      </button>
    </WidgetShell>
  );
}
