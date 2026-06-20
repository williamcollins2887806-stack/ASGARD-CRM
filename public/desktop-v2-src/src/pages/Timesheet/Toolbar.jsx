/**
 * Toolbar — переключаемая шапка таблицы по mode.
 *
 * FIX 10: добавлена кнопка «📅 Сегодня» (быстрый возврат к текущему месяцу).
 * FIX 12: ВСЕ действия (+ Рабочего, ↻ Обновить, 📥 Excel) — в одном месте.
 *
 * Содержит:
 *   - Период (◀ Месяц Год ▶ 📅 Сегодня)
 *   - Mode-зависимые KPI pills (рабочие/чел-дней/баллы/сумма/сутки)
 *   - Действия: + Рабочего (FIX 3), ↻ Обновить, 📥 Excel
 *
 * Props:
 *   year, month, mode, data
 *   onPrev, onNext, onToday
 *   onRefresh, onExport, onAddWorker
 *   canExport, canAddWorker
 */
import { useMemo } from 'react';
import { Btn } from '@/modals/parts';
import { monthLabel, fmtNum, fmtMoney } from './api';

export default function Toolbar({
  year, month, mode: _mode,
  data,
  onPrev, onNext, onToday,
  onRefresh, onExport, onAddWorker,
  canExport = false,
  canAddWorker = false
}) {
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

  return (
    <div className="ts-controls">
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
        {/* FIX 3 + FIX 12 — «+ Рабочего» собрана в Toolbar для всех не-readonly mode'ов */}
        {canAddWorker && (
          <Btn variant="primary" size="sm" onClick={onAddWorker}>＋ Рабочего</Btn>
        )}
        <Btn variant="ghost" size="sm" onClick={onRefresh}>↻ Обновить</Btn>
        {canExport && <Btn variant="primary" size="sm" onClick={onExport}>📥 Excel</Btn>}
      </div>
    </div>
  );
}

export { Toolbar };
