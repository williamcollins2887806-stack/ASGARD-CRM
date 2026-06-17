/**
 * ReportDetailModal — карточка отчёта по звонкам.
 */
import { useState, useEffect } from 'react';
import { useModal } from '@/modals';
import { api } from '@/api/client';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { TYPE_MAP } from './api';

export function ReportDetailModal({ id }) {
  const { close } = useModal();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api(`/api/call-reports/${id}`)
      .then((d) => setData(d?.item || null))
      .catch((e) => toast.error('Не удалось загрузить: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <MCard>
        <MHead title="Отчёт" onClose={close} />
        <MBody><div className="t-center p-32 c-t3">⏳ Загрузка…</div></MBody>
      </MCard>
    );
  }
  // Tier-A silent-fix: после loading=false если data=null (backend 404) модалка
  // схлопывалась молча. Теперь явный fallback с кнопкой закрытия.
  if (!data) {
    return (
      <MCard>
        <MHead icon="📞" title="Отчёт не найден" onClose={close} />
        <MBody><div className="t-center p-32 c-t3">Не удалось загрузить отчёт. Возможно он был удалён.</div></MBody>
      </MCard>
    );
  }

  let stats = {};
  try { stats = typeof data.stats_json === 'string' ? JSON.parse(data.stats_json) : (data.stats_json || { /* noop */ }); } catch { /* noop */ }
  let insights = data.insights || [];
  if (typeof insights === 'string') { try { insights = JSON.parse(insights); } catch { insights = []; } }
  let attention = data.attention_items || [];
  if (typeof attention === 'string') { try { attention = JSON.parse(attention); } catch { attention = []; } }

  return (
    <MCard>
      <MHead
        icon="📞"
        title={data.title || `Отчёт #${data.id}`}
        subtitle={`${TYPE_MAP[data.report_type] || data.report_type} · ${fmtDate(data.period_from)} — ${fmtDate(data.period_to)}`}
        accent="gold"
        onClose={close}
      />
      <MBody>
        {/* Summary */}
        {data.summary_text && (
          <Section title="Резюме">
            <div style={{ fontSize: 13.5, lineHeight: 1.7, color: 'var(--t-2)', whiteSpace: 'pre-wrap' }}>{data.summary_text}</div>
          </Section>
        )}

        {/* KPI */}
        {Object.keys(stats).length > 0 && (
          <Section title="Показатели">
            <div className="grid-auto-180 gap-10">
              {stats.totalCalls != null && <Kpi label="Звонков" value={stats.totalCalls} />}
              {stats.targetCalls != null && <Kpi label="Целевых" value={stats.targetCalls} tone="ok" />}
              {stats.missedCalls != null && <Kpi label="Пропущено" value={stats.missedCalls} tone="err" />}
              {stats.totalDurationMin != null && <Kpi label="Длительность, мин" value={Math.round(stats.totalDurationMin)} tone="info" />}
              {stats.avgDurationMin != null && <Kpi label="Средняя, мин" value={(Number(stats.avgDurationMin) || 0).toFixed(1)} />}
              {stats.uniqueClients != null && <Kpi label="Клиентов" value={stats.uniqueClients} />}
            </div>
          </Section>
        )}

        {/* Insights */}
        {insights.length > 0 && (
          <Section title="💡 Инсайты">
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {insights.map((i, idx) => (
                <li key={idx} style={{ marginBottom: 8, fontSize: 13.5, color: 'var(--t-2)', lineHeight: 1.6 }}>{i}</li>
              ))}
            </ul>
          </Section>
        )}

        {/* Attention items */}
        {attention.length > 0 && (
          <Section title="⚠ Требует внимания">
            <div className="col gap-8">
              {attention.map((a, idx) => (
                <div key={idx} style={{
                  padding: 10,
                  background: 'var(--inner-bg)',
                  borderLeft: '3px solid var(--err)',
                  borderRadius: 'var(--r-sm)',
                  fontSize: 13.5,
                  color: 'var(--t-2)'
                }}>
                  {a}
                </div>
              ))}
            </div>
          </Section>
        )}
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Закрыть</Btn>
      </MFoot>
    </MCard>
  );
}

function Section({ title, children }) {
  return (
    <div className="mb-18">
      <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700, color: 'var(--t-1)' }}>{title}</h3>
      {children}
    </div>
  );
}
function Kpi({ label, value, tone = 'default' }) {
  const colors = { default: 'var(--t-1)', ok: 'var(--ok)', err: 'var(--err)', info: 'var(--info)', gold: 'var(--gold)' };
  return (
    <div className="bg-inner r-sm p-10">
      <div className="fs-11 c-t3 fw-700">{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: colors[tone], marginTop: 2 }}>{value}</div>
    </div>
  );
}
function fmtDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('ru-RU'); } catch { return '—'; }
}
