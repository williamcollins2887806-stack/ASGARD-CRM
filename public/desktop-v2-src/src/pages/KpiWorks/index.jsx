/**
 * Страница /kpi-works — KPI по работам с разбором по РП.
 *
 * Источник: vanilla `public/assets/js/kpi_works.js` (~575 строк).
 *
 * KPI рассчитываются на клиенте из `/api/works?limit=2000`:
 *  - cost score = откло-ние факт vs план себестоимости (35% веса)
 *  - time score = откло-ние сроков (35%)
 *  - conversion score = тендеры выиграно / всего тендеров (30%)
 *  - combined = взвешенная сумма
 *
 * RBAC: ADMIN, HEAD_PM, DIRECTOR_GEN, DIRECTOR_COMM, DIRECTOR_DEV.
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { api } from '@/api/client';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import { SelectInput } from '@/inputs/Inputs';
import './kpi-works.css';

const _ALLOWED = ['ADMIN', 'HEAD_PM', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

const MODE_OPTIONS = [
  { value: 'month', label: 'Месяц' },
  { value: 'year', label: 'Год' },
  { value: 'last12', label: 'Последние 12 мес' },
  { value: 'all', label: 'Всё время' }
];

function toDate(s) {
  if (!s) return null;
  try { const d = new Date(s); return Number.isFinite(d.getTime()) ? d : null; } catch { return null; }
}
function durDays(a, b) {
  const da = toDate(a), db = toDate(b);
  if (!da || !db) return null;
  const d = Math.round((db.getTime() - da.getTime()) / 86400000);
  return Number.isFinite(d) ? Math.max(0, d) : null;
}
function safePct(plan, fact) {
  const p = Number(plan || 0), f = Number(fact || 0);
  if (p <= 0 || !Number.isFinite(p)) return null;
  return ((f - p) / p) * 100;
}
function deviationToScore(pct) {
  if (pct === null || pct === undefined) return null;
  return Math.max(0, Math.round(100 - Math.abs(pct)));
}
function conversionToScore(rate) {
  if (rate === null || rate === undefined) return null;
  return Math.min(100, Math.round(rate * (100 / 30)));
}
function calcCombined(costS, timeS, convS) {
  const vals = [];
  if (costS != null) vals.push({ s: costS, w: 0.35 });
  if (timeS != null) vals.push({ s: timeS, w: 0.35 });
  if (convS != null) vals.push({ s: convS, w: 0.30 });
  if (!vals.length) return null;
  const tw = vals.reduce((a, v) => a + v.w, 0);
  return Math.round(vals.reduce((a, v) => a + v.s * v.w, 0) / tw);
}
function scoreColor(s) {
  if (s == null) return 'var(--t-3)';
  if (s >= 75) return 'var(--ok)';
  if (s >= 50) return 'var(--amber)';
  if (s >= 25) return 'var(--orange)';
  return 'var(--err)';
}
function scoreGrade(s) {
  if (s == null) return '—';
  if (s >= 90) return 'S';
  if (s >= 75) return 'A';
  if (s >= 60) return 'B';
  if (s >= 45) return 'C';
  if (s >= 30) return 'D';
  return 'F';
}
function _fmtMoney(n) {
  const x = Number(n) || 0;
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(x) + ' ₽';
}

export default function KpiWorksPage() {
  const { user } = useAuth();
  const now = new Date();

  const [mode, setMode] = useState('year');
  const [year, setYear] = useState(now.getFullYear());
  const [works, setWorks] = useState([]);
  const [tenders, setTenders] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  // RBAC inline-литералы
  const _allowed = ['ADMIN', 'HEAD_PM', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(user?.role);

  const refresh = () => {
    setLoading(true);
    Promise.all([
      api('/api/works?limit=2000').then((d) => d?.works || d?.items || []).catch(() => []),
      api('/api/tenders?limit=2000').then((d) => d?.tenders || []).catch(() => []),
      api('/api/users?limit=500').then((d) => d?.users || []).catch(() => [])
    ])
      .then(([w, t, u]) => { setWorks(w); setTenders(t); setUsers(u); })
      .catch((e) => toast.error('Не удалось загрузить: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!user) return;
    if (!_allowed) {
      toast.error('Раздел доступен руководству');
      window.location.hash = '#/home';
      return;
    }
    refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role]);

  // Period filter
  const range = useMemo(() => {
    if (mode === 'all') return { start: null, end: null, label: 'Всё время' };
    if (mode === 'last12') {
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const start = new Date(end.getFullYear(), end.getMonth() - 12, 1);
      return { start, end, label: 'Последние 12 мес' };
    }
    if (mode === 'year') {
      return { start: new Date(year, 0, 1), end: new Date(year + 1, 0, 1), label: `${year} год` };
    }
    // month — текущий
    return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: new Date(now.getFullYear(), now.getMonth() + 1, 1), label: `${now.getMonth() + 1}.${now.getFullYear()}` };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, year, now.getFullYear(), now.getMonth()]);

  const inRange = (d) => {
    if (!d) return false;
    if (!range.start && !range.end) return true;
    const t = d.getTime();
    if (range.start && t < range.start.getTime()) return false;
    if (range.end && t >= range.end.getTime()) return false;
    return true;
  };

  // Collect PMs from users with role PM or from works' pm_id
  const pms = useMemo(() => {
    const byId = new Map(users.map((u) => [u.id, u]));
    const pmMap = new Map();
    for (const u of users) {
      if (u.role === 'PM' || (Array.isArray(u.roles) && u.roles.includes('PM'))) pmMap.set(u.id, u);
    }
    for (const w of works) {
      if (w.pm_id && byId.has(w.pm_id) && !pmMap.has(w.pm_id)) pmMap.set(w.pm_id, byId.get(w.pm_id));
    }
    return Array.from(pmMap.values());
  }, [users, works]);

  const tenderIdsWithWork = useMemo(() => new Set(works.map((w) => w.tender_id).filter(Boolean)), [works]);

  const kpiList = useMemo(() => {
    if (loading) return [];
    return pms.map((pm) => {
      const items = works.filter((w) => String(w.pm_id) === String(pm.id));

      // 1. Cost
      const costItems = items.filter((w) => w.cost_plan != null && w.cost_fact != null);
      const planCost = costItems.reduce((s, w) => s + (Number(w.cost_plan) || 0), 0);
      const factCost = costItems.reduce((s, w) => s + (Number(w.cost_fact) || 0), 0);
      const costPct = safePct(planCost, factCost);
      const costScore = deviationToScore(costPct);

      // 2. Time
      const timeItems = items.filter((w) => w.start_in_work_date && w.end_plan && w.end_fact);
      const planDur = timeItems.reduce((s, w) => s + (durDays(w.start_in_work_date, w.end_plan) || 0), 0);
      const factDur = timeItems.reduce((s, w) => s + (durDays(w.start_in_work_date, w.end_fact) || 0), 0);
      const timePct = safePct(planDur, factDur);
      const timeScore = deviationToScore(timePct);

      // 3. Conversion
      const pmTenders = tenders.filter((t) => {
        const pmMatch = String(t.pm_id) === String(pm.id) || String(t.responsible_pm_id) === String(pm.id);
        if (!pmMatch) return false;
        const td = toDate(t.created_at);
        return inRange(td);
      });
      const won = pmTenders.filter((t) => tenderIdsWithWork.has(t.id));
      const convRate = pmTenders.length > 0 ? (won.length / pmTenders.length) * 100 : null;
      const convScore = conversionToScore(convRate);

      const combined = calcCombined(costScore, timeScore, convScore);

      return {
        pm, items,
        costPct, costScore, planCost, factCost, costItemsCnt: costItems.length,
        timePct, timeScore, planDur, factDur, timeItemsCnt: timeItems.length,
        convRate, convScore, totalTenders: pmTenders.length, wonTenders: won.length,
        combined
      };
    })
      .filter((k) => k.items.length > 0 || k.totalTenders > 0)
      .sort((a, b) => (b.combined || 0) - (a.combined || 0));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pms, works, tenders, tenderIdsWithWork, range, loading]);

  if (user && !_allowed) return null;

  const yearOptions = [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2, now.getFullYear() - 3, now.getFullYear() - 4]
    .map((y) => ({ value: String(y), label: String(y) }));

  return (
    <div className="col gap-14">
      <TopActionsBar
        kicker="Аналитика"
        title="Ярл • Аналитика Работ"
        subtitle={`${range.label} · ${kpiList.length} ${plural(kpiList.length, ['РП', 'РП', 'РП'])} в выборке`}
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            <Btn variant="ghost" onClick={() => { window.location.hash = '#/gantt-works'; }}>📊 Гантт</Btn>
          </>
        }
      />

      {/* Filters */}
      <div className="row gap-10 u-wrap">
        <div className="min-w-180">
          <SelectInput value={mode} onChange={setMode} options={MODE_OPTIONS} />
        </div>
        {mode === 'year' && (
          <div className="min-w-120">
            <SelectInput value={String(year)} onChange={(v) => setYear(Number(v))} options={yearOptions} />
          </div>
        )}
      </div>

      {loading ? (
        <div className="card card-empty" >⏳ Считаем KPI…</div>
      ) : kpiList.length === 0 ? (
        <EmptyState icon="📊" title="Нет данных" hint="За выбранный период работ и тендеров не найдено" action={null} />
      ) : (
        <>
          {/* Header card */}
          <div className="card p-16" >
            <h3 className="m-0 mb-8 fs-15 fw-700">KPI РП — Общий рейтинг</h3>
            <div className="fs-12 c-t3">
              Балл = себестоимость (35%) + сроки (35%) + конверсия (30%). Кликни по карточке для деталей.
            </div>
          </div>

          {/* PM cards grid */}
          <div className="grid-auto-280 gap-12">
            {kpiList.map((k) => (
              <PmKpiCard key={k.pm.id} kpi={k} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function PmKpiCard({ kpi }) {
  const { pm, costScore, timeScore, convScore, combined, costPct, timePct, convRate, totalTenders, wonTenders, items } = kpi;
  const c = scoreColor(combined);
  return (
    <div className="card p-18 pos-rel ov-hidden">
      <div className="pos-abs fs-24 fw-800" style={{ top: 10, right: 14, opacity: 0.15 }}>
        {scoreGrade(combined)}
      </div>
      <div className="row gap-12 mb-12">
        <div className="row-center bg-inner fw-700 fs-16" style={{ width: 40, height: 40, borderRadius: '50%' }}>
          {initials(pm.name)}
        </div>
        <div className="flex-1">
          <div className="fw-700 fs-14 ellipsis">
            {pm.name || '—'}
          </div>
          <div className="fs-11 c-t3">
            {items.length} {plural(items.length, ['работа', 'работы', 'работ'])} · {totalTenders} {plural(totalTenders, ['тендер', 'тендера', 'тендеров'])}
          </div>
        </div>
      </div>

      <Bar label="Себест." score={costScore} pct={costPct} />
      <Bar label="Сроки" score={timeScore} pct={timePct} />
      <Bar label="Конверсия" score={convScore} pct={convRate} prefix={wonTenders + '/' + totalTenders} />

      <div className="row-center gap-10 mt-12 pt-12 fs-13" style={{ borderTop: '1px solid var(--brd-2)' }}>
        <span className="c-t3">Общий балл:</span>
        <span className="fs-22 fw-800" style={{ color: c }}>{combined ?? '—'}</span>
      </div>
    </div>
  );
}

function Bar({ label, score, _pct, _prefix }) {
  const c = scoreColor(score);
  const w = score == null ? 0 : Math.max(0, Math.min(100, score));
  return (
    <div className="kpw-bar-row">
      <div className="c-t3 fw-700 upper" style={{ letterSpacing: '0.03em' }}>{label}</div>
      <div className="kpw-bar-track">
        <div className="kpw-bar-fill" style={{ width: w + '%', background: c }} />
      </div>
      <div className="t-right fw-700 fs-12" style={{ color: c }}>
        {score == null ? '—' : score}
      </div>
    </div>
  );
}

function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}
function plural(n, forms) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}
