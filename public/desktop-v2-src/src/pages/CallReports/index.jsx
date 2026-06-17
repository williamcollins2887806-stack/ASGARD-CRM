/**
 * Страница /call-reports — Отчёты по звонкам Mango.
 *
 * Источник: vanilla `public/assets/js/call_reports.js` (~588 строк).
 *
 *   ✅ index.jsx        — список отчётов + дашборд + расписание
 *   ✅ ReportDetailModal — карточка отчёта с summary, insights, attention items
 *   ✅ GenerateModal     — ручная генерация (daily/weekly/monthly + период)
 *   ✅ ScheduleModal     — настройка получения отчётов
 *
 * Endpoints:
 *   GET  /api/call-reports                  — список
 *   GET  /api/call-reports/:id               — детали
 *   POST /api/call-reports/generate          — ручная генерация
 *   GET  /api/call-reports/dashboard         — сводные
 *   GET/PUT /api/call-reports/schedule       — расписание
 *
 * RBAC: ADMIN, DIRECTOR_GEN, DIRECTOR_COMM, DIRECTOR_DEV.
 */
import { useState, useEffect } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { api } from '@/api/client';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import { SelectInput } from '@/inputs/Inputs';
import { ReportDetailModal } from './ReportDetailModal';
import { GenerateModal } from './GenerateModal';
import { ScheduleModal } from './ScheduleModal';
import { TYPE_MAP, TYPE_TONES } from './api';

const _ALLOWED = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

export default function CallReportsPage() {
  const { user } = useAuth();
  const modal = useModal();

  const [items, setItems] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  // v2 BONUS: тип-фильтр персистится между сессиями (vanilla сбрасывал) + sort newest/oldest
  const [typeFilter, setTypeFilter] = useState(() => {
    try { return localStorage.getItem('callreports.type') || ''; } catch { return ''; }
  });
  const [sortDir, setSortDir] = useState('-1'); // -1 = newest first
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try { localStorage.setItem('callreports.type', typeFilter); } catch { /* noop */ }
  }, [typeFilter]);

  // RBAC inline-литералы
  const _allowed = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(user?.role);

  const refresh = () => {
    setLoading(true);
    const q = new URLSearchParams();
    if (typeFilter) q.set('type', typeFilter);
    q.set('limit', '50');
    Promise.all([
      api(`/api/call-reports?${q.toString()}`).then((d) => d?.items || []).catch(() => []),
      api('/api/call-reports/dashboard').catch(() => null)
    ])
      .then(([its, dash]) => { setItems(its); setDashboard(dash); })
      .catch((e) => toast.error('Не удалось загрузить отчёты: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!user) return;
    if (!_allowed) {
      toast.error('Отчёты по звонкам доступны только руководству');
      window.location.hash = '#/home';
      return;
    }
    refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role, typeFilter]);

  // Deep-link через ?id=
  useEffect(() => {
    const m = window.location.hash.match(/[?&]id=(\d+)/);
    if (m) modal.open(<ReportDetailModal id={Number(m[1])} />, { size: 'wide' });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (user && !_allowed) return null;

  const openDetail = (it) => modal.open(<ReportDetailModal id={it.id} />, { size: 'wide' });
  const openGenerate = () => modal.open(<GenerateModal onCreated={refresh} />);
  const openSchedule = () => modal.open(<ScheduleModal />);

  const stats = dashboard?.stats || {};

  // v2 BONUS: сортированная выборка newest/oldest (vanilla — только по умолчанию newest)
  const sortedItems = (() => {
    const arr = [...items];
    const d = Number(sortDir) || -1;
    arr.sort((a, b) => {
      const va = a.created_at ? new Date(a.created_at).getTime() : 0;
      const vb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return (va - vb) * d;
    });
    return arr;
  })();

  // v2 BONUS: CSV-экспорт выборки отчётов (vanilla не имеет — только просмотр в карточке)
  const exportCsv = () => {
    if (!sortedItems.length) { toast.warn('Список пуст'); return; }
    const head = ['№','Тип','Название','С','По','Создан'];
    const esc = (v) => {
      const s = v == null ? '' : String(v);
      return /[;,"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const rows = sortedItems.map((it) => [
      it.id, TYPE_MAP[it.report_type] || it.report_type, it.title || '',
      fmtDate(it.period_from), fmtDate(it.period_to), fmtDateTime(it.created_at)
    ].map(esc).join(';'));
    const csv = '﻿' + head.join(';') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `call_reports_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success('CSV скачан');
  };

  return (
    <div className="col gap-14">
      <TopActionsBar
        kicker="Звонки"
        title="Отчёты Mango"
        subtitle={`${items.length} отчётов в выборке`}
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            {/* v2 BONUS: CSV-экспорт выборки (vanilla не имеет) */}
            <Btn variant="ghost" onClick={exportCsv} title="CSV выборки">📤 CSV</Btn>
            <Btn variant="ghost" onClick={openSchedule}>⚙ Расписание</Btn>
            <Btn variant="primary" onClick={openGenerate}>+ Сгенерировать</Btn>
          </>
        }
      />

      {/* Dashboard KPI */}
      {dashboard && (
        <div className="grid-auto-180 gap-10">
          <Stat label="Всего звонков" value={stats.totalCalls || 0} />
          <Stat label="Целевых" value={stats.targetCalls || 0} tone="ok" />
          <Stat label="Пропущено" value={stats.missedCalls || 0} tone="err" />
          <Stat label="Длительность (мин)" value={Math.round((stats.totalDurationMin || 0))} tone="info" />
        </div>
      )}

      {/* Last 14 days chart */}
      {dashboard?.chartData && dashboard.chartData.length > 0 && (
        <div className="card p-16" >
          <h3 className="m-0 mb-10 fs-15 fw-700">📊 Динамика за 14 дней</h3>
          <ChartBars data={dashboard.chartData} />
        </div>
      )}

      {/* Latest summary */}
      {stats.latestSummary && (
        <div className="card p-16" >
          <h3 className="m-0 mb-10 fs-15 fw-700">📝 Резюме последнего отчёта</h3>
          <div style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--t-2)', whiteSpace: 'pre-wrap' }}>{stats.latestSummary}</div>
        </div>
      )}

      {/* Filter */}
      <div className="row gap-10">
        <div className="min-w-180">
          <SelectInput
            value={typeFilter}
            onChange={setTypeFilter}
            options={[
              { value: '', label: 'Все типы' },
              ...Object.entries(TYPE_MAP).map(([v, l]) => ({ value: v, label: l }))
            ]}
          />
        </div>
        {/* v2 BONUS: сортировка по дате (vanilla — фиксированная) */}
        <div className="min-w-180">
          <SelectInput
            value={sortDir}
            onChange={setSortDir}
            options={[
              { value: '-1', label: '⬇ Новые сначала' },
              { value: '1',  label: '⬆ Старые сначала' }
            ]}
          />
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="card card-empty" >⏳ Загружаем…</div>
      ) : items.length === 0 ? (
        <EmptyState
          icon="📞"
          title="Отчётов нет"
          hint="Нажмите «Сгенерировать» чтобы создать первый."
          action={null}
        />
      ) : (
        <div className="card card-pad-overflow">
          {sortedItems.map((it) => (
            <div
              key={it.id}
              onClick={() => openDetail(it)}
              style={{
                padding: '14px 18px',
                borderBottom: '1px solid var(--brd-2)',
                cursor: 'pointer',
                display: 'grid',
                gridTemplateColumns: '50px 1fr 130px 140px',
                gap: 12,
                alignItems: 'center'
              }}
            >
              <div className="fs-22">
                {it.report_type === 'daily' ? '☀' : it.report_type === 'weekly' ? '📅' : '📆'}
              </div>
              <div>
                <div className="fw-700 fs-14">{it.title || 'Без названия'}</div>
                <div className="fs-11 c-t3">
                  Период: {fmtDate(it.period_from)} — {fmtDate(it.period_to)}
                </div>
              </div>
              <div className="fs-12 c-t2">
                <span style={{
                  background: 'var(--inner-bg)',
                  borderRadius: 'var(--r-pill)',
                  padding: '2px 8px',
                  fontWeight: 700,
                  color: TYPE_TONES[it.report_type] || 'var(--t-2)'
                }}>{TYPE_MAP[it.report_type] || it.report_type}</span>
              </div>
              <div className="fs-11 c-t3 t-right">
                {fmtDateTime(it.created_at)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, _tone = 'default' }) {
  const _colors = { default: 'var(--t-1)', ok: 'var(--ok)', err: 'var(--err)', info: 'var(--info)', gold: 'var(--gold)' };
  return (
    <div className="bg-inner r-md p-14">
      <div className="mini-kpi-label">{label}</div>
      <div className="mini-kpi-value">{value}</div>
    </div>
  );
}

function ChartBars({ data }) {
  const max = Math.max(...data.map((d) => d.total), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 140 }}>
      {data.map((d, i) => {
        const h = (d.total / max) * 100;
        const tgt = d.total > 0 ? (d.target / d.total) * 100 : 0;
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }} title={`${d.label}: всего ${d.total}, целевых ${d.target}, пропущено ${d.missed}`}>
            <div style={{ position: 'relative', width: '100%', height: 100, display: 'flex', alignItems: 'flex-end' }}>
              <div style={{ width: '100%', height: h + '%', background: 'var(--info)', borderRadius: '4px 4px 0 0', position: 'relative' }}>
                <div style={{ width: '100%', height: tgt + '%', background: 'var(--ok)', borderRadius: '4px 4px 0 0', position: 'absolute', bottom: 0 }} />
              </div>
            </div>
            <div className="fs-10 c-t3">{d.label}</div>
          </div>
        );
      })}
    </div>
  );
}
function fmtDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('ru-RU'); } catch { return '—'; }
}
function fmtDateTime(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return '—'; }
}
