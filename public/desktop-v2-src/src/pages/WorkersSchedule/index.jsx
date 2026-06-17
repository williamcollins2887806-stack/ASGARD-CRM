/**
 * Страница /workers-schedule — График рабочих.
 *
 * Источник: vanilla `public/assets/js/staff_schedule.js` (~798 строк).
 *
 *   ✅ index.jsx — календарная сетка месяц × рабочие с 6 статусами + StatusPickerModal
 *
 * RBAC: ADMIN, HR, HR_MANAGER, DIRECTOR_*.
 *
 * Сохранение через `/api/data/employee_plan` (generic CRUD).
 * Источники: `/api/staff/employees` (только полевые без user_id), `/api/works` (для контрактов).
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { api } from '@/api/client';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import { SearchInput, SelectInput } from '@/inputs/Inputs';
// v2 BONUS: hotkeys + CSV export + LS-persist (vanilla не имеет)
import { useDebounce, useHotkeys, exportToCsv, useLocalStorage } from '@/api/useListHelpers';

import { StatusPickerModal } from './StatusPickerModal';
import ScheduleGantt from './ScheduleGantt';
import { STATUS_LIST, STATUS_BY_CODE, fmtDateIso } from './api';
import './workers-schedule.css';

const _ALLOWED = ['ADMIN', 'HR', 'HR_MANAGER', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

const MONTHS_RU = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

function daysInMonth(year, month) { return new Date(year, month + 1, 0).getDate(); }
function isWeekend(year, month, day) { const d = new Date(year, month, day).getDay(); return d === 0 || d === 6; }

export default function WorkersSchedulePage() {
  const { user } = useAuth();
  const modal = useModal();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [employees, setEmployees] = useState([]);
  const [planByKey, setPlanByKey] = useState(new Map()); // key = `${emp_id}|${dateIso}` → row
  const [works, setWorks] = useState([]);
  const [query, setQuery] = useState('');
  const dQuery = useDebounce(query, 300);  // G-11: debounce 300мс (2000 сотрудников)
  // v2 BONUS: запоминаем последний фильтр статуса между сессиями (vanilla не имеет)
  const [statusFilter, setStatusFilter] = useLocalStorage('ws-status', 'all');
  // Режим отображения — список (календарь) / Гантт (vanilla staff_schedule.js:483-611)
  // v2 BONUS: запоминаем выбранный режим (vanilla сбрасывала на «таблица»).
  const [viewMode, setViewMode] = useLocalStorage('ws-view', 'calendar');
  const [loading, setLoading] = useState(true);

  // RBAC inline-литералы
  const _allowed = ['ADMIN', 'HR', 'HR_MANAGER', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(user?.role);

  const days = daysInMonth(year, month);
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month, days);
  const monthStartIso = fmtDateIso(monthStart);
  const monthEndIso = fmtDateIso(monthEnd);

  const refresh = async () => {
    setLoading(true);
    try {
      const [emps, ws, plans] = await Promise.all([
        api('/api/staff/employees?limit=2000').then((d) => d?.employees || []).catch(() => []),
        api('/api/works?limit=2000').then((d) => d?.works || d?.items || []).catch(() => []),
        api('/api/data/employee_plan?limit=10000').then((d) => d?.items || d?.rows || []).catch(() => [])
      ]);
      // Только полевые без user_id, активные
      const filtered = emps.filter((e) => !e.user_id && e.is_active !== false && !e.deleted);
      filtered.sort((a, b) => String(a.fio || a.full_name || '').localeCompare(String(b.fio || b.full_name || ''), 'ru'));
      setEmployees(filtered);
      setWorks(ws);
      // Build plan map
      const m = new Map();
      for (const p of plans) {
        const d = (p.date || '').slice(0, 10);
        if (!d || d < monthStartIso || d > monthEndIso) continue;
        m.set(`${p.employee_id}|${d}`, p);
      }
      setPlanByKey(m);
    } catch (e) {
      toast.error('Не удалось загрузить: ' + (e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    if (!_allowed) {
      toast.error('График доступен HR и руководству');
      window.location.hash = '#/home';
      return;
    }
    refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role, year, month]);

  // Build works map id → title
  const worksMap = useMemo(() => {
    const m = new Map();
    for (const w of works) {
      m.set(w.id, w.work_title || w.customer_name || `Работа #${w.id}`);
    }
    return m;
  }, [works]);

  const visibleEmployees = useMemo(() => {
    let v = employees;
    if (dQuery.trim()) {
      const lq = dQuery.toLowerCase();
      v = v.filter((e) =>
        (e.fio || e.full_name || '').toLowerCase().includes(lq) ||
        (e.role_tag || '').toLowerCase().includes(lq) ||
        (e.city || '').toLowerCase().includes(lq)
      );
    }
    if (statusFilter !== 'all') {
      const todayIso = fmtDateIso(new Date());
      v = v.filter((e) => {
        const cur = planByKey.get(`${e.id}|${todayIso}`);
        if (statusFilter === 'free') return !cur;
        return cur?.kind === statusFilter;
      });
    }
    return v;
  }, [employees, dQuery, statusFilter, planByKey]);

  if (user && !_allowed) return null;

  const onCellClick = (emp, dateIso) => {
    const current = planByKey.get(`${emp.id}|${dateIso}`) || {};
    modal.open(
      <StatusPickerModal
        emp={emp}
        dateIso={dateIso}
        current={current}
        worksMap={worksMap}
        onSaved={async (payload) => {
          try {
            // Generic CRUD: если есть запись — DELETE+POST, иначе только POST
            if (current.id) {
              await api(`/api/data/employee_plan/${current.id}`, { method: 'DELETE' });
            }
            if (payload && !payload.clear && payload.kind) {
              await api('/api/data/employee_plan', {
                method: 'POST',
                body: {
                  employee_id: emp.id,
                  date: dateIso,
                  kind: payload.kind,
                  work_id: payload.work_id || null,
                  note: payload.note || '',
                  source: current.source || null,
                  staff_request_id: current.staff_request_id || null,
                  locked: !!current.locked
                }
              });
            }
            toast.success('Сохранено');
            refresh();
          } catch (e) {
            toast.error('Не удалось сохранить: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  const prev = () => {
    if (month === 0) { setMonth(11); setYear(year - 1); }
    else setMonth(month - 1);
  };
  // v2 BONUS: hotkeys для навигации (vanilla не имеет).
  // ←/→ — месяц назад/вперёд; T — сегодня; / — фокус поиска;
  // E — экспорт CSV (плоский слепок месяца).
  // PgUp/PgDn нагружены браузером, используем стрелки.
  // ☝ исключение: не реагируем когда фокус в input (стандарт useHotkeys).
  const onExportCsv = () => {
    const rows = [];
    for (const emp of visibleEmployees) {
      for (let d = 1; d <= days; d++) {
        const dateIso = fmtDateIso(new Date(year, month, d));
        const cur = planByKey.get(`${emp.id}|${dateIso}`);
        if (!cur) continue;
        const st = STATUS_BY_CODE[cur.kind];
        rows.push({
          fio: emp.fio || emp.full_name || '',
          role: emp.role_tag || '',
          city: emp.city || '',
          date: dateIso,
          status: st?.label || cur.kind,
          work: cur.work_id ? (worksMap.get(cur.work_id) || ('#' + cur.work_id)) : '',
          note: cur.note || ''
        });
      }
    }
    if (!rows.length) { toast.warn('Нет данных в выбранном месяце'); return; }
    exportToCsv(`workers-schedule-${year}-${String(month + 1).padStart(2, '0')}.csv`, rows, [
      { key: 'fio', label: 'ФИО' },
      { key: 'role', label: 'Специальность' },
      { key: 'city', label: 'Город' },
      { key: 'date', label: 'Дата' },
      { key: 'status', label: 'Статус' },
      { key: 'work', label: 'Работа' },
      { key: 'note', label: 'Заметка' }
    ]);
    toast.success(`Экспортировано ${rows.length} записей`);
  };

  const next = () => {
    if (month === 11) { setMonth(0); setYear(year + 1); }
    else setMonth(month + 1);
  };

  // v2 BONUS: keyboard hotkeys (vanilla работала только мышью).
  useHotkeys({
    'arrowleft': prev,
    'arrowright': next,
    't': () => { setYear(now.getFullYear()); setMonth(now.getMonth()); },
    '/': () => {
      const inp = document.querySelector('.filter-grid-2 input[type=text]');
      if (inp) inp.focus();
    },
    'mod+e': onExportCsv
  }, [month, year, visibleEmployees.length]);

  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="Кадры"
        title="График Дружины"
        subtitle={`${MONTHS_RU[month]} ${year} · ${visibleEmployees.length} рабочих в выборке`}
        actions={
          <>
            <Btn
              variant={viewMode === 'calendar' ? 'primary' : 'ghost'}
              onClick={() => setViewMode('calendar')}
              title="Календарь · месяц × дни"
            >📅 Календарь</Btn>
            <Btn
              variant={viewMode === 'gantt' ? 'primary' : 'ghost'}
              onClick={() => setViewMode('gantt')}
              title="Диаграмма Ганта · сотрудник × недели"
            >📊 Гантт</Btn>
            <Btn variant="ghost" onClick={prev} title="Предыдущий месяц (←)">◀ Месяц</Btn>
            <Btn variant="ghost" onClick={() => { setYear(now.getFullYear()); setMonth(now.getMonth()); }} title="К текущему месяцу (T)">Сегодня</Btn>
            <Btn variant="ghost" onClick={next} title="Следующий месяц (→)">Месяц ▶</Btn>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            {/* v2 BONUS: CSV-экспорт месячного графика для согласований/отчётов (vanilla не имеет) */}
            <Btn variant="ghost" onClick={onExportCsv} title="Экспорт CSV (Ctrl+E)">📥 CSV</Btn>
          </>
        }
      />

      <div className="filter-grid-2">
        <SearchInput value={query} onChange={setQuery} placeholder="Поиск по ФИО, роли, городу…" />
        <SelectInput
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: 'all', label: 'Все статусы' },
            { value: 'free', label: 'Свободен' },
            ...STATUS_LIST.map((s) => ({ value: s.code, label: s.label }))
          ]}
        />
      </div>

      {/* Legend */}
      <div className="ws-legend">
        {STATUS_LIST.map((s) => (
          <div key={s.code} className="row gap-6">
            <span className="ws-legend-dot" style={{ background: s.color }} />
            <span>{s.label}</span>
          </div>
        ))}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="card card-empty" >⏳ Загружаем график…</div>
      ) : visibleEmployees.length === 0 ? (
        employees.length === 0 ? (
          <EmptyState
            icon="👷"
            title="Полевых рабочих не найдено"
            hint="Добавьте активных полевых сотрудников (без user_id) в справочнике персонала."
          />
        ) : (
          <EmptyState
            icon="🔍"
            title="Нет рабочих с такими фильтрами"
            hint="Попробуйте сбросить фильтры по поиску и статусу."
            action={
              <Btn variant="ghost" onClick={() => { setQuery(''); setStatusFilter('all'); }}>
                ↺ Сбросить фильтры
              </Btn>
            }
          />
        )
      ) : viewMode === 'gantt' ? (
        <ScheduleGantt
          employees={visibleEmployees}
          planByKey={planByKey}
          worksMap={worksMap}
          year={year}
          month={month}
        />
      ) : (
        <div className="card ws-table-wrap">
          <table className="ws-table">
            <thead className="pos-stk bg-inner">
              <tr>
                <th className="ws-th-name">ФИО</th>
                {Array.from({ length: days }, (_, i) => i + 1).map((d) => {
                  const we = isWeekend(year, month, d);
                  const isToday = year === now.getFullYear() && month === now.getMonth() && d === now.getDate();
                  const cls = 'ws-th-day' + (we ? ' ws-th-day--we' : '') + (isToday ? ' ws-th-day--today' : '');
                  return (
                    <th key={d} className={cls}>
                      {d}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visibleEmployees.map((emp) => (
                <tr key={emp.id} className="ws-row">
                  <td className="ws-td-name">
                    <div className="ws-name-fio">{emp.fio || emp.full_name || '—'}</div>
                    <div className="ws-name-sub">{emp.role_tag || ''}{emp.city ? ' · ' + emp.city : ''}</div>
                  </td>
                  {Array.from({ length: days }, (_, i) => i + 1).map((d) => {
                    const dateIso = fmtDateIso(new Date(year, month, d));
                    const cur = planByKey.get(`${emp.id}|${dateIso}`);
                    const st = cur ? STATUS_BY_CODE[cur.kind] : null;
                    const we = isWeekend(year, month, d);
                    const cls = 'ws-cell' + (!cur && we ? ' ws-cell--we' : '');
                    return (
                      <td
                        key={d}
                        onClick={() => onCellClick(emp, dateIso)}
                        title={cur ? `${st?.label || cur.kind}${cur.work_id ? ': ' + (worksMap.get(cur.work_id) || '#' + cur.work_id) : ''}${cur.note ? ' · ' + cur.note : ''}` : 'Свободен'}
                        className={cls}
                        style={cur ? { background: st?.color } : undefined}
                      >
                        {cur && (
                          <span className="ws-cell-mark">
                            {st?.short || ''}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
