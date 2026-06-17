/**
 * Dashboard — KPI / прогресс / онлайн-список / неделя.
 *
 * Источник vanilla: field-tab.js:1065-1181 (renderDashboardTab).
 * Backend: GET /api/field/manage/projects/:work_id/dashboard
 *
 * Что показываем (parity 1:1):
 *   • 4 KPI: «Сейчас на объекте» (online_now.length / total_crew),
 *           «Сегодня отмечено» (today_count чекинов),
 *           «Часов сегодня» (today_hours),
 *           «Заработок сегодня» (today_earned).
 *   • Прогресс-бар работы (data.progress: {pct, done, total, unit}).
 *   • Чипы «🟢 Сейчас на объекте» — ФИО + время чекина.
 *   • Таблица «📊 За неделю» — Дата / Чел. / Часов / Заработок.
 *   • Кнопка «🔄 Обновить».
 */
import { useEffect, useState } from 'react';
import { Btn } from '@/modals/parts';
import { loadDashboard } from '../api';

function fmtMoney(n) {
  if (!Number.isFinite(+n)) return '—';
  return new Intl.NumberFormat('ru-RU').format(Math.round(+n)) + ' ₽';
}
function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('ru-RU') : '—';
}
function fmtTime(s) {
  if (!s) return '';
  const d = new Date(s);
  return Number.isFinite(d.getTime())
    ? d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : '';
}
function pl(n) {
  const a = n % 10, b = n % 100;
  if (b > 10 && b < 20) return 'человек';
  if (a === 1) return 'человек';
  if (a > 1 && a < 5) return 'человека';
  return 'человек';
}

function KpiCard({ icon, label, value, hint, tone = 'gold' }) {
  return (
    <div className={'ft-kpi ft-kpi--' + tone}>
      <div className="ft-kpi-label">
        {icon} {label}
      </div>
      <div className="ft-kpi-value">{value}</div>
      {hint && <div className="ft-kpi-hint">{hint}</div>}
    </div>
  );
}

export default function DashboardTab({ work }) {
  const [data, setData] = useState(null);
  const [reloading, setReloading] = useState(false);

  const reload = () => {
    setReloading(true);
    return loadDashboard(work.id)
      .then(setData)
      .finally(() => setReloading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [work.id]);

  if (!data) return <div className="ft-loading">⏳ Загружаем…</div>;

  // Vanilla parity — точные имена полей бэка (field-tab.js:1083-1088)
  const onlineNow = Array.isArray(data.online_now) ? data.online_now : [];
  const totalCrew = data.total_crew || 0;
  const todayCount = data.today_count || 0;
  const todayHours = Number(data.today_hours || 0);
  const todayEarned = Number(data.today_earned || 0);
  const progress = data.progress && (data.progress.pct != null || data.progress.done != null)
    ? data.progress
    : null;
  const weekSummary = Array.isArray(data.week_summary) ? data.week_summary : [];

  return (
    <div className="ft-stack-14">
      {/* ── 4 KPI карточки (vanilla parity) ── */}
      <div className="ft-kpis">
        <KpiCard
          icon="🟢"
          label="Сейчас на объекте"
          value={`${onlineNow.length} / ${totalCrew}`}
          hint={`из ${totalCrew} ${pl(totalCrew)}`}
          tone="ok"
        />
        <KpiCard
          icon="📋"
          label="Сегодня отмечено"
          value={todayCount}
          hint="чекинов"
          tone="info"
        />
        <KpiCard
          icon="⏱"
          label="Часов сегодня"
          value={todayHours.toFixed(1)}
          hint="всего"
          tone="purple"
        />
        <KpiCard
          icon="💰"
          label="Заработок сегодня"
          value={fmtMoney(todayEarned)}
          hint="по бригаде"
          tone="gold"
        />
      </div>

      {/* ── Прогресс работы (если бэк возвращает progress) ── */}
      {progress && (
        <div className="ft-card-soft">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: 8
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600 }}>Прогресс</span>
            <span
              style={{ fontSize: 13, color: 'var(--gold)', fontWeight: 600 }}
            >
              {progress.pct || 0}%
            </span>
          </div>
          <div
            style={{
              width: '100%',
              height: 8,
              background: 'var(--bg-3)',
              borderRadius: 4,
              overflow: 'hidden'
            }}
          >
            <div
              style={{
                width: Math.min(progress.pct || 0, 100) + '%',
                height: '100%',
                background: 'linear-gradient(90deg,#D4A843,#B8922E)',
                borderRadius: 4,
                transition: 'width .5s'
              }}
            />
          </div>
          <div
            style={{ fontSize: 12, color: 'var(--t-3)', marginTop: 6 }}
          >
            {progress.done || 0} / {progress.total ?? '?'} {progress.unit || ''}
          </div>
        </div>
      )}

      {/* ── 🟢 Сейчас на объекте — список ФИО + время ── */}
      {onlineNow.length > 0 && (
        <div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              marginBottom: 8
            }}
          >
            🟢 Сейчас на объекте ({onlineNow.length})
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {onlineNow.map((p, i) => (
              <span
                key={p.employee_id || p.id || i}
                style={{
                  padding: '5px 12px',
                  borderRadius: 8,
                  fontSize: 12,
                  background: 'rgba(16,185,129,0.12)',
                  color: 'var(--ok, #10b981)',
                  fontWeight: 500
                }}
              >
                {p.fio || `#${p.employee_id || '?'}`}
                {p.checkin_at && <> · {fmtTime(p.checkin_at)}</>}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── 📊 За неделю — таблица день/чел/час/₽ ── */}
      {weekSummary.length > 0 && (
        <div className="ft-card-soft">
          <div
            className="ft-card-eyebrow ft-card-eyebrow--lg"
            style={{ marginBottom: 8 }}
          >
            📊 За неделю
          </div>
          <table
            className="t-list ft-table"
            style={{ width: '100%', fontSize: 12 }}
          >
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Дата</th>
                <th style={{ textAlign: 'center' }}>Чел.</th>
                <th style={{ textAlign: 'center' }}>Часов</th>
                <th style={{ textAlign: 'right' }}>Заработок</th>
              </tr>
            </thead>
            <tbody>
              {weekSummary.map((d, i) => (
                <tr key={d.date || i}>
                  <td>{fmtDate(d.date)}</td>
                  <td style={{ textAlign: 'center' }}>{d.workers || 0}</td>
                  <td style={{ textAlign: 'center' }}>
                    {Number(d.hours || 0).toFixed(1)}
                  </td>
                  <td
                    style={{ textAlign: 'right', color: 'var(--gold)' }}
                  >
                    {fmtMoney(d.earned)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Activity chart (если бэк отдаёт массив) — оставляем как было ── */}
      {Array.isArray(data.activity_by_day) && data.activity_by_day.length > 0 && (
        <div className="ft-card-soft">
          <div className="ft-card-eyebrow ft-card-eyebrow--lg">
            📈 Активность по дням
          </div>
          <div className="ft-chart-bars">
            {data.activity_by_day.slice(-14).map((d, i) => {
              const h = Math.max(4, Math.min(80, (d.count || d.value || 0) * 4));
              return (
                <div key={i} className="ft-chart-bar">
                  <div className="ft-chart-bar-fill" style={{ height: h }} />
                  <span className="ft-chart-bar-label">
                    {d.label || i + 1}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {data.summary_text && (
        <div className="ft-summary-soft">{data.summary_text}</div>
      )}

      {/* ── 🔄 Обновить — кнопка из vanilla (field-tab.js:1174) ── */}
      <div className="ft-row-r">
        <Btn variant="ghost" size="sm" disabled={reloading} onClick={reload}>
          {reloading ? '⏳' : '🔄 Обновить'}
        </Btn>
      </div>
    </div>
  );
}
