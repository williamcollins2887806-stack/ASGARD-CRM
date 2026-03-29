import { useState, useEffect, useCallback } from 'react';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { StatCard } from '@/components/shared/StatCard';
import { Sparkline } from '@/components/shared/Sparkline';
import { Phone, PhoneIncoming, PhoneMissed, Clock, BarChart3, ChevronDown } from 'lucide-react';

const TYPE_LABELS = { daily: 'День', weekly: 'Неделя', monthly: 'Месяц' };
const TYPE_COLORS = {
  daily: 'var(--blue)',
  weekly: 'var(--green)',
  monthly: 'var(--gold)',
};

function plural(n, one, few, many) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}

export default function CallAnalytics() {
  const [reports, setReports] = useState([]);
  const [stats, setStats] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [reportsRes, dashRes] = await Promise.all([
        api.get('/call-reports?limit=15' + (filter ? '&type=' + filter : '')),
        api.get('/call-reports/dashboard').catch(() => ({})),
      ]);
      setReports(reportsRes?.items || []);
      setStats(dashRes?.stats || null);
      setChartData(dashRes?.chartData || []);
    } catch {
      setReports([]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  // Deep link: report=ID из query string
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reportId = params.get('report');
    if (reportId) {
      setExpanded(reportId);
    }
  }, []);

  const sparklineData = chartData.map(d => d.total || 0);

  return (
    <PageShell title="Аналитика звонков" scrollable>
      <PullToRefresh onRefresh={load}>
        {/* ═══ KPI Grid ═══ */}
        {stats && (
          <div
            className="grid grid-cols-2 gap-3 mb-4"
            style={{ animation: 'fadeInUp var(--motion-normal) var(--ease-spring) both' }}
          >
            <StatCard
              icon={Phone}
              iconColor="var(--blue)"
              iconBg="rgba(74, 144, 217, 0.1)"
              value={stats.totalCalls || 0}
              label="Всего звонков"
              delay={0}
            />
            <StatCard
              icon={PhoneIncoming}
              iconColor="var(--green)"
              iconBg="rgba(48, 209, 88, 0.1)"
              value={stats.targetCalls || 0}
              label="Целевых"
              delay={80}
            />
            <StatCard
              icon={PhoneMissed}
              iconColor="var(--red)"
              iconBg="rgba(198, 40, 40, 0.1)"
              value={stats.missedCalls || 0}
              label="Пропущенных"
              delay={160}
            />
            <StatCard
              icon={Clock}
              iconColor="var(--gold)"
              iconBg="rgba(200, 168, 78, 0.1)"
              value={stats.avgDuration ? Math.round(stats.avgDuration) + 'с' : '—'}
              label="Средн. длительность"
              delay={240}
            />
          </div>
        )}

        {/* ═══ Sparkline Chart ═══ */}
        {sparklineData.length > 1 && (
          <div
            className="rounded-2xl p-4 mb-4"
            style={{
              backgroundColor: 'var(--bg-surface)',
              animation: 'fadeInUp var(--motion-normal) var(--ease-spring) 200ms both',
            }}
          >
            <div className="flex items-center justify-between mb-3">
              <span
                className="text-sm font-semibold"
                style={{ color: 'var(--text-primary)' }}
              >
                Динамика за 14 дней
              </span>
              <span
                className="text-xs"
                style={{ color: 'var(--text-tertiary)' }}
              >
                {chartData.length} {plural(chartData.length, 'день', 'дня', 'дней')}
              </span>
            </div>
            <Sparkline data={sparklineData} width={320} height={48} color="var(--blue)" />
            {/* Legend */}
            <div className="flex gap-4 mt-2">
              {[
                { label: 'Всего', color: 'var(--blue)', data: chartData.map(d => d.total) },
                { label: 'Целевые', color: 'var(--green)', data: chartData.map(d => d.target) },
                { label: 'Пропущ.', color: 'var(--red)', data: chartData.map(d => d.missed) },
              ].map((s, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: s.color }}
                  />
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{s.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ═══ AI Insight ═══ */}
        {stats?.latestSummary && (
          <div
            className="rounded-2xl p-4 mb-4 relative overflow-hidden"
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '0.5px solid rgba(200, 168, 78, 0.2)',
              animation: 'fadeInUp var(--motion-normal) var(--ease-spring) 280ms both',
            }}
          >
            <div className="flex items-center gap-2 mb-2">
              <span style={{ fontSize: 16 }}>🧙</span>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--gold)',
                }}
              >
                Инсайт Мимира
              </span>
            </div>
            <p
              className="text-sm leading-relaxed"
              style={{ color: 'var(--text-secondary)' }}
            >
              {stats.latestSummary.slice(0, 300)}
            </p>
            {/* Gold gradient line */}
            <div
              className="absolute bottom-0 left-0 right-0 h-[2px]"
              style={{ background: 'var(--gold-gradient)' }}
            />
          </div>
        )}

        {/* ═══ Filter Pills ═══ */}
        <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
          {[
            { key: '', label: 'Все' },
            { key: 'daily', label: 'Дневные' },
            { key: 'weekly', label: 'Недельные' },
            { key: 'monthly', label: 'Месячные' },
          ].map(f => (
            <button
              key={f.key}
              className="shrink-0 px-4 py-1.5 rounded-full text-xs font-semibold spring-tap"
              style={{
                backgroundColor: filter === f.key
                  ? 'color-mix(in srgb, var(--gold) 15%, transparent)'
                  : 'var(--bg-elevated)',
                color: filter === f.key ? 'var(--gold)' : 'var(--text-secondary)',
                border: filter === f.key
                  ? '0.5px solid rgba(200, 168, 78, 0.3)'
                  : '0.5px solid var(--border-norse)',
              }}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* ═══ Report List ═══ */}
        {loading ? (
          <SkeletonList count={3} />
        ) : reports.length === 0 ? (
          <EmptyState
            icon={BarChart3}
            iconColor="var(--blue)"
            iconBg="rgba(74, 144, 217, 0.1)"
            title="Нет отчётов"
            description="AI-отчёты по звонкам появятся автоматически по расписанию"
          />
        ) : (
          <div className="space-y-2 pb-4">
            {reports.map((r, i) => (
              <ReportCard
                key={r.id}
                report={r}
                index={i}
                expanded={expanded === r.id}
                onToggle={() => setExpanded(expanded === r.id ? null : r.id)}
              />
            ))}
          </div>
        )}
      </PullToRefresh>
    </PageShell>
  );
}

/* ─── Report Card (Accordion) ─── */
function ReportCard({ report, index, expanded, onToggle }) {
  const r = report;
  let stats = {};
  try { stats = typeof r.stats_json === 'string' ? JSON.parse(r.stats_json) : (r.stats_json || {}); } catch { /* */ }
  let recs = [];
  try { recs = typeof r.recommendations_json === 'string' ? JSON.parse(r.recommendations_json) : (r.recommendations_json || []); } catch { /* */ }

  const typeColor = TYPE_COLORS[r.report_type] || 'var(--blue)';
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }) : '—';

  return (
    <div
      className="rounded-2xl overflow-hidden spring-tap"
      style={{
        backgroundColor: 'var(--bg-surface)',
        border: '0.5px solid var(--border-norse)',
        animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${index * 60}ms both`,
      }}
    >
      {/* Header */}
      <button
        className="w-full flex items-center gap-3 px-4 py-3.5"
        onClick={onToggle}
      >
        {/* Type badge */}
        <div
          className="shrink-0 px-2.5 py-1 rounded-lg text-xs font-bold"
          style={{
            backgroundColor: `color-mix(in srgb, ${typeColor} 12%, transparent)`,
            color: typeColor,
          }}
        >
          {TYPE_LABELS[r.report_type] || r.report_type}
        </div>

        {/* Title + period */}
        <div className="flex-1 min-w-0 text-left">
          <div
            className="text-sm font-semibold truncate"
            style={{ color: 'var(--text-primary)' }}
          >
            {r.title || 'Отчёт #' + r.id}
          </div>
          <div
            className="text-xs mt-0.5"
            style={{ color: 'var(--text-tertiary)' }}
          >
            {fmtDate(r.period_from)} — {fmtDate(r.period_to)}
          </div>
        </div>

        {/* Chevron */}
        <ChevronDown
          size={16}
          style={{
            color: 'var(--text-tertiary)',
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform var(--motion-normal) var(--ease-spring)',
          }}
        />
      </button>

      {/* Expanded content */}
      {expanded && (
        <div
          className="px-4 pb-4 space-y-3"
          style={{
            animation: 'fadeInUp 200ms var(--ease-spring) both',
            borderTop: '0.5px solid var(--border-norse)',
          }}
        >
          {/* Mini metrics */}
          {stats.totalCalls !== undefined && (
            <div className="flex gap-2 pt-3">
              {[
                { v: stats.totalCalls || 0, l: 'Звонков', c: 'var(--blue)' },
                { v: stats.targetCalls || 0, l: 'Целевых', c: 'var(--green)' },
                { v: stats.missedCalls || 0, l: 'Пропущ.', c: 'var(--red)' },
              ].map((m, j) => (
                <div
                  key={j}
                  className="flex-1 rounded-xl p-2.5 text-center"
                  style={{ backgroundColor: 'var(--bg-elevated)' }}
                >
                  <div
                    className="text-lg font-bold tabular-nums"
                    style={{ color: m.c }}
                  >
                    {m.v}
                  </div>
                  <div
                    className="text-[10px] mt-0.5"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    {m.l}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Summary */}
          {r.summary_text && (
            <p
              className="text-xs leading-relaxed"
              style={{ color: 'var(--text-secondary)' }}
            >
              {r.summary_text.slice(0, 300)}
            </p>
          )}

          {/* Recommendations */}
          {recs.length > 0 && (
            <div>
              <div
                className="text-[10px] font-semibold uppercase tracking-wider mb-1.5"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Рекомендации
              </div>
              <div className="space-y-1">
                {recs.slice(0, 3).map((rec, j) => (
                  <div key={j} className="flex gap-2">
                    <span style={{ color: 'var(--gold)', fontSize: 12 }}>→</span>
                    <span
                      className="text-xs leading-relaxed"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {rec}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
