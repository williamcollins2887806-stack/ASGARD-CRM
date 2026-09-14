/**
 * Toolbar — переключаемая шапка таблицы по mode.
 */
import { useMemo, useState, useEffect, useCallback } from 'react';
import { Btn } from '@/modals/parts';
import { monthLabel, fmtNum, fmtMoney, getWorksOptions } from './api';

export default function Toolbar({
  year, month, mode,
  data,
  onPrev, onNext, onToday,
  onRefresh, onExport, onAddWorker,
  canExport = false,
  canAddWorker = false,
  fioSearch = '',
  onFioSearchChange,
  projectQuery = '',
  onProjectQueryChange,
  projectFilter = null,
  onProjectFilterClear,
  onProjectFilterApply,
  onWorkFilterApply,
  rosterLoading = false,
}) {
  const [localProjectQ, setLocalProjectQ] = useState(projectQuery);
  const [works, setWorks] = useState([]);
  const [workId, setWorkId] = useState(projectFilter?.work_id ? String(projectFilter.work_id) : '');

  const useWorksDropdown = mode === 'medical' || mode === 'travel' || mode === 'global';

  useEffect(() => { setLocalProjectQ(projectQuery); }, [projectQuery]);
  useEffect(() => {
    setWorkId(projectFilter?.work_id ? String(projectFilter.work_id) : '');
  }, [projectFilter]);

  useEffect(() => {
    if (!useWorksDropdown) return;
    let cancelled = false;
    getWorksOptions()
      .then((r) => { if (!cancelled) setWorks(r?.works || []); })
      .catch(() => { if (!cancelled) setWorks([]); });
    return () => { cancelled = true; };
  }, [useWorksDropdown]);

  const kpi = useMemo(() => {
    const employees = data?.employees || [];
    const totalWorkers = employees.length;
    let totalDays = 0, totalAmount = 0, totalPoints = 0, totalPerDiem = 0;
    for (const e of employees) {
      if (e.days) {
        for (const d of Object.values(e.days)) {
          if (d?.type) totalDays += 1;
        }
      }
      if (e.total_amount != null) totalAmount += Number(e.total_amount);
      if (e.total_points != null) totalPoints += Number(e.total_points);
      if (e.per_diem_total != null) totalPerDiem += Number(e.per_diem_total);
    }
    return { totalWorkers, totalDays, totalAmount, totalPoints, totalPerDiem };
  }, [data]);

  const cols = data?.columns || {};
  const showAmount = cols.amount === 'show';
  const showPerDiem = cols.perDiem === 'show';
  const showPoints = cols.points !== 'none';

  const applyProject = useCallback(() => {
    const q = localProjectQ.trim();
    if (q.length < 2) return;
    onProjectFilterApply?.(q);
  }, [localProjectQ, onProjectFilterApply]);

  const onWorkChange = useCallback((e) => {
    const id = e.target.value;
    setWorkId(id);
    if (!id) {
      onProjectFilterClear?.();
      return;
    }
    const w = works.find((x) => String(x.id) === id);
    onWorkFilterApply?.(Number(id), w?.label || w?.title || `Объект #${id}`);
  }, [works, onWorkFilterApply, onProjectFilterClear]);

  const rosterSummary = useMemo(() => {
    if (!projectFilter?.employees?.length) return null;
    const emps = projectFilter.employees;
    const planned = emps.filter((e) => (e.roster_reasons || []).includes('planned')).length;
    const approved = emps.filter((e) => (e.roster_reasons || []).includes('approved')).length;
    const title = projectFilter.work_matches?.[0]?.work_title || projectFilter.query || projectFilter.title || 'Проект';
    return { title, count: emps.length, planned, approved };
  }, [projectFilter]);

  return (
    <div className="ts-controls" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="ts-period-nav">
          <Btn variant="ghost" size="sm" onClick={onPrev} aria-label="Предыдущий месяц">◀</Btn>
          <span className="ts-period">{monthLabel(year, month)}</span>
          <Btn variant="ghost" size="sm" onClick={onNext} aria-label="Следующий месяц">▶</Btn>
          {onToday && (
            <Btn variant="ghost" size="sm" onClick={onToday} title="К текущему месяцу">
              📅 Сегодня
            </Btn>
          )}
        </div>

        <div className="ts-stats">
          <span className="ts-pill info">{fmtNum(kpi.totalWorkers)} раб.</span>
          <span className="ts-pill ok">{fmtNum(kpi.totalDays)} чел-дней</span>
          {showPoints && kpi.totalPoints > 0 && (
            <span className="ts-pill">{fmtNum(kpi.totalPoints)} баллов</span>
          )}
          {showAmount && (
            <span className="ts-pill gold">{fmtMoney(kpi.totalAmount)}</span>
          )}
          {showPerDiem && (
            <span className="ts-pill gold">Сутки: {fmtMoney(kpi.totalPerDiem)}</span>
          )}
        </div>

        <div className="row gap-8">
          {canAddWorker && (
            <Btn variant="primary" size="sm" onClick={onAddWorker}>＋ Рабочего</Btn>
          )}
          <Btn variant="ghost" size="sm" onClick={onRefresh}>↻ Обновить</Btn>
          {canExport && <Btn variant="primary" size="sm" onClick={onExport}>📥 Excel</Btn>}
        </div>
      </div>

      <div className="ts-toolbar-filters">
        <input
          type="search"
          placeholder="Найти рабочего…"
          value={fioSearch}
          onChange={(e) => onFioSearchChange?.(e.target.value)}
          aria-label="Поиск по ФИО"
        />
        {useWorksDropdown ? (
          <select
            value={workId}
            onChange={onWorkChange}
            aria-label="Фильтр по объекту"
            disabled={rosterLoading}
            style={{ minWidth: 220, maxWidth: 360 }}
          >
            <option value="">Все объекты</option>
            {works.map((w) => (
              <option key={w.id} value={w.id}>{w.label || w.title || `#${w.id}`}</option>
            ))}
          </select>
        ) : (
          <>
            <input
              type="search"
              placeholder="Объект: МЛСП, Пуровский…"
              value={localProjectQ}
              onChange={(e) => {
                setLocalProjectQ(e.target.value);
                onProjectQueryChange?.(e.target.value);
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') applyProject(); }}
              aria-label="Фильтр по объекту"
            />
            <Btn variant="ghost" size="sm" onClick={applyProject} disabled={localProjectQ.trim().length < 2 || rosterLoading}>
              {rosterLoading ? '…' : 'Фильтр'}
            </Btn>
          </>
        )}
        {projectFilter && (
          <Btn variant="ghost" size="sm" onClick={() => { setWorkId(''); onProjectFilterClear?.(); }}>× Сбросить</Btn>
        )}
      </div>

      {rosterSummary && (
        <div className="ts-project-chip">
          {rosterSummary.title} · {rosterSummary.count} чел.
          {rosterSummary.planned > 0 && ` · ${rosterSummary.planned} в плане`}
          {rosterSummary.approved > 0 && ` · ${rosterSummary.approved} утверждён`}
        </div>
      )}
    </div>
  );
}

export { Toolbar };
