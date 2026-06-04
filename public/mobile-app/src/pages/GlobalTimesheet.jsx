import { useState, useEffect, useCallback, useRef } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import {
  CalendarDays, ChevronLeft, ChevronRight, Download, RefreshCw,
} from 'lucide-react';

const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

const CELL_COLORS = {
  day:       { bg: 'color-mix(in srgb, var(--green) 20%, transparent)', text: 'var(--green)',  label: 'Д', name: 'Дневная смена' },
  night:     { bg: 'color-mix(in srgb, var(--blue) 20%, transparent)',  text: 'var(--blue)',   label: 'Н', name: 'Ночная смена' },
  travel:    { bg: 'color-mix(in srgb, var(--warn-t) 15%, transparent)', text: 'var(--warn-t)', label: '🚗', name: 'Дорога' },
  warehouse: { bg: 'color-mix(in srgb, var(--info-t) 15%, transparent)', text: 'var(--info-t)', label: '📦', name: 'Склад' },
  medical:   { bg: 'color-mix(in srgb, var(--err-t) 12%, transparent)',  text: 'var(--err-t)',  label: '🏥', name: 'Медосмотр' },
  waiting:   { bg: 'color-mix(in srgb, var(--text-tertiary) 15%, transparent)', text: 'var(--text-tertiary)', label: '⏳', name: 'Ожидание' },
};

function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }

export default function GlobalTimesheet() {
  const haptic = useHaptic();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cellDetail, setCellDetail] = useState(null);
  const scrollRef = useRef(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/timesheet/global/${year}/${month}`);
      setData(res);
    } catch (e) {
      setData(null);
      setError(e.message || 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const prevMonth = () => {
    haptic.light();
    if (month === 1) { setMonth(12); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    haptic.light();
    if (month === 12) { setMonth(1); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  };

  const [error, setError] = useState(null);

  const handleExport = async () => {
    haptic.medium();
    try {
      const token = api.getToken ? api.getToken() : localStorage.getItem('asgard_token');
      const url = `/api/timesheet/global/${year}/${month}/export`;
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!resp.ok) throw new Error('Ошибка экспорта');
      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `Табель_${year}_${month}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e.message);
    }
  };

  const days = daysInMonth(year, month);
  const workers = data?.workers || [];

  return (
    <PageShell title="Общий табель">
      <PullToRefresh onRefresh={fetchData}>
        {/* Month selector */}
        <div className="flex items-center justify-between px-1 mb-3">
          <button onClick={prevMonth} className="p-2 spring-tap">
            <ChevronLeft size={20} style={{ color: 'var(--text-primary)' }} />
          </button>
          <p className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            {MONTHS[month - 1]} {year}
          </p>
          <button onClick={nextMonth} className="p-2 spring-tap">
            <ChevronRight size={20} style={{ color: 'var(--text-primary)' }} />
          </button>
        </div>

        {/* Export button */}
        <div className="flex gap-2 px-1 mb-3">
          <button onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium spring-tap"
            style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)', color: 'var(--text-secondary)' }}>
            <Download size={14} /> Excel
          </button>
          <button onClick={fetchData}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium spring-tap"
            style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)', color: 'var(--text-secondary)' }}>
            <RefreshCw size={14} /> Обновить
          </button>
        </div>

        {loading ? <SkeletonList count={5} /> : workers.length === 0 ? (
          <EmptyState icon={CalendarDays} iconColor="var(--blue)" iconBg="color-mix(in srgb, var(--blue) 10%, transparent)"
            title="Нет данных" description="За этот месяц нет отметок" />
        ) : (
          <div ref={scrollRef} className="overflow-x-auto pb-4 -mx-1" style={{ WebkitOverflowScrolling: 'touch' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: days * 36 + 140 }}>
              <thead>
                <tr>
                  <th style={{
                    position: 'sticky', left: 0, zIndex: 2,
                    background: 'var(--bg-primary)',
                    padding: '6px 8px', textAlign: 'left',
                    fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)',
                    borderBottom: '1px solid var(--border-norse)',
                    minWidth: 120,
                  }}>
                    ФИО
                  </th>
                  {Array.from({ length: days }, (_, i) => (
                    <th key={i} style={{
                      padding: '6px 2px', textAlign: 'center',
                      fontSize: 10, fontWeight: 500, color: 'var(--text-tertiary)',
                      borderBottom: '1px solid var(--border-norse)',
                      minWidth: 32,
                    }}>
                      {i + 1}
                    </th>
                  ))}
                  <th style={{
                    padding: '6px 8px', textAlign: 'center',
                    fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)',
                    borderBottom: '1px solid var(--border-norse)',
                    minWidth: 50,
                  }}>
                    Итого
                  </th>
                </tr>
              </thead>
              <tbody>
                {workers.map((w, wi) => (
                  <tr key={w.employee_id || wi}>
                    <td style={{
                      position: 'sticky', left: 0, zIndex: 1,
                      background: 'var(--bg-primary)',
                      padding: '4px 8px',
                      fontSize: 11, fontWeight: 500, color: 'var(--text-primary)',
                      borderBottom: '1px solid var(--border-norse)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      maxWidth: 120,
                    }}>
                      {w.fio || '—'}
                    </td>
                    {Array.from({ length: days }, (_, di) => {
                      const dayData = w.days?.[di + 1];
                      const cellType = dayData?.type;
                      const cellCfg = cellType ? CELL_COLORS[cellType] : null;
                      return (
                        <td key={di}
                          onClick={() => { if (dayData) { haptic.light(); setCellDetail({ worker: w, day: di + 1, ...dayData }); } }}
                          style={{
                            padding: 2, textAlign: 'center',
                            borderBottom: '1px solid var(--border-norse)',
                            cursor: dayData ? 'pointer' : 'default',
                          }}
                        >
                          {cellCfg ? (
                            <div style={{
                              width: 28, height: 24, borderRadius: 4, margin: '0 auto',
                              background: cellCfg.bg, color: cellCfg.text,
                              fontSize: 10, fontWeight: 700,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                              {cellCfg.label}
                            </div>
                          ) : null}
                        </td>
                      );
                    })}
                    <td style={{
                      padding: '4px 8px', textAlign: 'center',
                      fontSize: 11, fontWeight: 600, color: 'var(--gold)',
                      borderBottom: '1px solid var(--border-norse)',
                    }}>
                      {w.total_days || 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PullToRefresh>

      {/* Cell detail BottomSheet */}
      <BottomSheet open={!!cellDetail} onClose={() => setCellDetail(null)}
        title={cellDetail ? `${cellDetail.worker?.fio} — ${cellDetail.day} ${MONTHS[month - 1]}` : ''}>
        {cellDetail && (
          <div className="flex flex-col gap-3 pb-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5 c-tertiary">Тип</p>
              <p className="text-[14px] c-primary">
                {CELL_COLORS[cellDetail.type]?.name || cellDetail.type || '—'}
              </p>
            </div>
            {cellDetail.amount != null && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5 c-tertiary">Сумма</p>
                <p className="text-[14px] font-semibold c-gold">
                  {Math.round(cellDetail.amount).toLocaleString('ru-RU')} ₽
                </p>
              </div>
            )}
            {cellDetail.hours != null && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5 c-tertiary">Часы</p>
                <p className="text-[14px] c-primary">{cellDetail.hours}ч</p>
              </div>
            )}
            {cellDetail.work_title && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5 c-tertiary">Объект</p>
                <p className="text-[14px] c-primary">{cellDetail.work_title}</p>
              </div>
            )}
          </div>
        )}
      </BottomSheet>
    </PageShell>
  );
}
