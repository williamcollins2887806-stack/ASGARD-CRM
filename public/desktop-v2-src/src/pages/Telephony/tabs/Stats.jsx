/**
 * Telephony / Таб «Статистика».
 *
 * Источник vanilla: public/assets/js/telephony.js (renderStatsTab) +
 * backend telephony.js:1002 (GET /stats) и :1053 (GET /stats/managers).
 *
 *   • Карточки KPI: total/inbound/outbound/missed/avg_duration/% answered.
 *   • Период: сегодня / неделя / месяц (быстрые чипы) + ручные даты.
 *   • SVG-график распределения по дням (по результатам group_by=day).
 *   • Таблица по менеджерам.
 *
 * Никаких внешних chart-библиотек — рисуем SVG руками (как в BigScreen / charts.js).
 */
import { useEffect, useState, useMemo } from 'react';
import { Btn } from '@/modals/parts';
import { DatePicker, Segmented } from '@/inputs/Inputs';
import { StatusBadge } from '@/modals/Notifications';
import { loadStatsRange, loadManagerStats, fmtDuration } from '../api';

function fmtDate(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toISOString().slice(0, 10);
}

const RANGES = [
  { value: 'today', label: 'Сегодня' },
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
  { value: 'custom', label: 'Период' }
];

function rangeToDates(r) {
  const today = new Date();
  const to = fmtDate(today);
  if (r === 'today') return { from: to, to };
  if (r === 'week') return { from: fmtDate(new Date(Date.now() - 6 * 86400000)), to };
  if (r === 'month') return { from: fmtDate(new Date(Date.now() - 29 * 86400000)), to };
  return { from: '', to: '' };
}

function Kpi({ icon, label, value, hint, tone = 'default' }) {
  const accentMap = {
    success: 'var(--ok-bg)',
    danger: 'var(--err-bg)',
    warn: 'var(--warn-bg)',
    info: 'var(--inner-bg)',
    default: 'var(--card-bg)'
  };
  return (
    <div className="card" style={{
      padding: 14,
      background: accentMap[tone],
      border: '1px solid var(--brd-2)',
      borderRadius: 'var(--r-md)',
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
      minHeight: 86
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--t-3)', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        <span aria-hidden>{icon}</span> {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {hint && <div style={{ color: 'var(--t-3)', fontSize: 11.5 }}>{hint}</div>}
    </div>
  );
}

// SVG-stacked-bar по дням (inbound/outbound/missed)
function PeriodChart({ data }) {
  const rows = Array.isArray(data) ? data : [];
  if (!rows.length) {
    return (
      <div className="card card-empty" style={{ padding: 18 }}>
        Нет данных за выбранный период
      </div>
    );
  }
  const W = 760;
  const H = 200;
  const padL = 36;
  const padR = 12;
  const padT = 14;
  const padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const maxV = Math.max(1, ...rows.map((r) => Number(r.total) || 0));
  const barW = Math.max(6, Math.floor(innerW / rows.length) - 4);
  const stepX = innerW / rows.length;

  return (
    <div className="card" style={{ padding: 12, overflow: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <div className="fs-12 c-t3">Звонки по дням</div>
        <div style={{ display: 'flex', gap: 12, fontSize: 11.5 }}>
          <span><span style={{ display: 'inline-block', width: 8, height: 8, background: '#4a90d9', borderRadius: 2, marginRight: 4 }} />входящие</span>
          <span><span style={{ display: 'inline-block', width: 8, height: 8, background: '#c9a84c', borderRadius: 2, marginRight: 4 }} />исходящие</span>
          <span><span style={{ display: 'inline-block', width: 8, height: 8, background: '#c8293b', borderRadius: 2, marginRight: 4 }} />пропущенные</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img" aria-label="График звонков по дням">
        {/* Y-grid */}
        {[0, 0.25, 0.5, 0.75, 1].map((p) => {
          const y = padT + innerH - p * innerH;
          return (
            <g key={p}>
              <line x1={padL} y1={y} x2={padL + innerW} y2={y} stroke="var(--brd-m)" strokeWidth="0.5" strokeDasharray="2,3" />
              <text x={padL - 6} y={y + 3} fontSize="9" textAnchor="end" fill="var(--t-3)">{Math.round(maxV * p)}</text>
            </g>
          );
        })}
        {/* bars */}
        {rows.map((r, i) => {
          const x = padL + i * stepX + (stepX - barW) / 2;
          const inb = Number(r.inbound) || 0;
          const out = Number(r.outbound) || 0;
          const miss = Number(r.missed) || 0;
          const tot = inb + out + miss || 1;
          const total = Number(r.total) || tot;
          const totalH = (total / maxV) * innerH;
          const inbH = totalH * (inb / tot);
          const outH = totalH * (out / tot);
          const missH = totalH * (miss / tot);
          let yCur = padT + innerH;
          const segs = [
            { v: inbH, color: '#4a90d9' },
            { v: outH, color: '#c9a84c' },
            { v: missH, color: '#c8293b' }
          ];
          return (
            <g key={i}>
              {segs.map((s, idx) => {
                if (s.v <= 0) return null;
                yCur -= s.v;
                return <rect key={idx} x={x} y={yCur} width={barW} height={s.v} fill={s.color} rx="1.5" />;
              })}
              {/* X label */}
              {(rows.length <= 16 || i % Math.ceil(rows.length / 14) === 0) && (
                <text x={x + barW / 2} y={H - 8} fontSize="9" textAnchor="middle" fill="var(--t-3)">
                  {String(r.period || '').slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function StatsTab() {
  const [range, setRange] = useState('week');
  const [dates, setDates] = useState(() => rangeToDates('week'));
  const [stats, setStats] = useState({ totals: {}, by_period: [] });
  const [managers, setManagers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (range !== 'custom') setDates(rangeToDates(range));
  }, [range]);

  useEffect(() => {
    if (!dates.from || !dates.to) return undefined;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      loadStatsRange({ date_from: dates.from, date_to: dates.to, group_by: 'day' }),
      loadManagerStats({ date_from: dates.from, date_to: dates.to })
    ]).then(([s, m]) => {
      if (cancelled) return;
      setStats(s || { totals: {}, by_period: [] });
      setManagers(m || []);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dates.from, dates.to]);

  const t = stats.totals || {};
  const total = Number(t.total) || 0;
  const inbound = Number(t.inbound) || 0;
  const outbound = Number(t.outbound) || 0;
  const missed = Number(t.missed) || 0;
  const avgDur = Number(t.avg_duration) || 0;
  const answeredPct = total ? Math.round(((total - missed) / total) * 100) : 0;
  const missedPct = total ? Math.round((missed / total) * 100) : 0;
  const convPct = inbound ? Math.round(((Number(t.converted_to_leads) || 0) / inbound) * 100) : 0;

  const sortedManagers = useMemo(
    () => [...managers].sort((a, b) => (Number(b.total_calls) || 0) - (Number(a.total_calls) || 0)),
    [managers]
  );

  return (
    <div className="col gap-14">
      {/* Период */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Segmented value={range} onChange={setRange} options={RANGES} aria-label="Период" />
        {range === 'custom' && (
          <>
            <DatePicker value={dates.from} onChange={(v) => setDates((d) => ({ ...d, from: v }))} placeholder="С" />
            <DatePicker value={dates.to} onChange={(v) => setDates((d) => ({ ...d, to: v }))} placeholder="По" />
          </>
        )}
        <span className="c-t3 fs-12">{dates.from} — {dates.to}</span>
      </div>

      {loading ? (
        <div className="card card-empty">⏳ Загружаем статистику…</div>
      ) : (
        <>
          {/* KPI */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            <Kpi icon="📞" label="Всего звонков" value={total} hint={`${inbound} вх · ${outbound} исх`} tone="info" />
            <Kpi icon="✓" label="Принято" value={`${answeredPct}%`} hint={`${total - missed} из ${total}`} tone="success" />
            <Kpi icon="☎" label="Пропущено" value={missed} hint={`${missedPct}% от общего`} tone={missedPct > 15 ? 'danger' : 'default'} />
            <Kpi icon="⏱" label="Средняя длительность" value={fmtDuration(avgDur)} hint="по принятым" tone="default" />
            <Kpi icon="🎯" label="Конверсия в лиды" value={`${convPct}%`} hint={`${t.converted_to_leads || 0} из ${inbound} вх`} tone={convPct > 20 ? 'success' : 'default'} />
            <Kpi icon="👥" label="Активных менеджеров" value={managers.length} hint={dates.from + ' — ' + dates.to} tone="info" />
          </div>

          {/* Chart */}
          <PeriodChart data={stats.by_period || []} />

          {/* Таблица по менеджерам */}
          <div className="card card-pad-overflow">
            <div className="ov-x-auto">
              <table className="t-list w-full tbl-base">
                <thead>
                  <tr className="bg-inner tbl-row-brd">
                    <th>Менеджер</th>
                    <th className="w-100">Всего</th>
                    <th className="w-100">Входящих</th>
                    <th className="w-100">Исходящих</th>
                    <th className="w-100">Пропущено</th>
                    <th className="w-120">Средняя длит.</th>
                    <th className="w-120">Конвертировано</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedManagers.length === 0 && (
                    <tr><td colSpan={7} className="c-t3" style={{ padding: 18, textAlign: 'center' }}>Нет данных по менеджерам</td></tr>
                  )}
                  {sortedManagers.map((m) => (
                    <tr key={m.id} className="row-hover">
                      <td className="fw-600">{m.name}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{m.total_calls}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{m.inbound}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{m.outbound}</td>
                      <td>
                        {Number(m.missed) > 0
                          ? <StatusBadge tone="rejected" label={String(m.missed)} />
                          : <span className="c-t3">—</span>}
                      </td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtDuration(m.avg_duration)}</td>
                      <td>
                        {Number(m.converted) > 0
                          ? <StatusBadge tone="approved" label={String(m.converted)} />
                          : <span className="c-t3">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
