/**
 * /tasks-admin — Управление задачами всех РП (директора / ADMIN / HEAD).
 * Vanilla: public/assets/js/tasks_admin.js (~1119 строк).
 *
 * Покрытие vanilla:
 *   ✅ render — TopActionsBar + KPI-ряд (новые/в работе/выполнено/просрочено) + StatCardRow
 *   ✅ loadData — GET /api/tasks/all + /api/users (для фильтров и матрицы)
 *   ✅ Фильтры: статус, исполнитель, создатель, поиск (новое в v2)
 *   ✅ Матрица «РП × статус» — новая в v2 для контроля распределения задач
 *   ✅ renderTasksTable — таблица (id/задача/исполнитель/приоритет/дедлайн/статус/создатель/действия)
 *   ✅ Подсветка просроченных
 *   ✅ showCreateModal/editTask  → TaskEditModal (создание/редактирование) с поддержкой файлов
 *   ✅ viewTask                  → TaskViewModal (просмотр + редактирование/эскалация/отмена/удаление)
 *   ✅ deleteTask                → ConfirmModal danger в TaskViewModal
 *   ✅ submitTask / uploadFiles  → createTask + uploadTaskFiles в TaskEditModal
 *   ✅ resetFilters              → кнопка ↺ Сбросить
 *   ✅ Эскалация задачи          → PromptModal с urgent + комментарий (новое в v2)
 *   ✅ Отмена задачи             → PromptModal на причину + PUT /:id/status (новое в v2)
 *
 * RBAC: ADMIN/DIRECTOR_GEN/DIRECTOR_COMM/DIRECTOR_DEV/HEAD_PM/HEAD_TO.
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import { SearchInput, SelectInput } from '@/inputs/Inputs';
import { useDebounce } from '@/api/useListHelpers';

import { TaskEditModal } from './TaskEditModal';
import { TaskViewModal } from './TaskViewModal';
import {
  loadAllTasks, loadAssignees,
  STATUS_LABELS, STATUS_CLASS, PRIORITY_LABELS, PRIORITY_CLASS,
  isOverdue, formatDateTime, effectiveStatus, buildKpi, buildAssigneeMatrix,
  canAdminTasks
} from './api';
import './tasks-admin.css';

const STATUS_FILTER_OPTS = [
  { value: '',            label: 'Все статусы' },
  { value: 'new',         label: STATUS_LABELS.new },
  { value: 'accepted',    label: STATUS_LABELS.accepted },
  { value: 'in_progress', label: STATUS_LABELS.in_progress },
  { value: 'overdue',     label: STATUS_LABELS.overdue },
  { value: 'done',        label: STATUS_LABELS.done },
  { value: 'cancelled',   label: STATUS_LABELS.cancelled }
];

export default function TasksAdminPage() {
  const { user } = useAuth();
  const modal = useModal();

  const canCreate = canAdminTasks(user?.role);

  const [tasks, setTasks]       = useState([]);
  const [users, setUsers]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [status, setStatus]     = useState('');
  const [assignee, setAssignee] = useState('');
  const [creator, setCreator]   = useState('');
  const [q, setQ]               = useState('');
  const dq = useDebounce(q, 300);  // G-11: debounce 300мс

  const refresh = () => {
    setLoading(true);
    Promise.all([
      loadAllTasks({ limit: 1000 }).catch((e) => {
        toast.error('Не удалось загрузить задачи: ' + (e?.message || e));
        return [];
      }),
      loadAssignees().catch(() => [])
    ]).then(([list, allUsers]) => {
      setTasks(list || []);
      setUsers(allUsers || []);
    }).finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!user) return;
    if (!canCreate) {
      toast.warn('Доступ только у ADMIN / директоров / руководителей отделов');
      return;
    }
    refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const usersById = useMemo(() => {
    const m = {};
    for (const u of users) m[u.id] = u;
    return m;
  }, [users]);

  // Активные исполнители (по которым в задачах есть assignee_id) — для селекта.
  const activeAssignees = useMemo(() => {
    return users.filter((u) => u.is_active !== false && (u.name || u.login || '').trim());
  }, [users]);

  const visible = useMemo(() => {
    const norm = dq.trim().toLowerCase();
    return tasks.filter((t) => {
      if (status) {
        const eff = effectiveStatus(t);
        if (eff !== status) return false;
      }
      if (assignee && String(t.assignee_id || '') !== assignee) return false;
      if (creator  && String(t.creator_id  || '') !== creator)  return false;
      if (norm) {
        const a = String(t.title || '').toLowerCase();
        const b = String(t.description || '').toLowerCase();
        const c = String(t.assignee_name || '').toLowerCase();
        const d = String(t.creator_name || '').toLowerCase();
        if (!a.includes(norm) && !b.includes(norm) && !c.includes(norm) && !d.includes(norm)) return false;
      }
      return true;
    });
  }, [tasks, status, assignee, creator, dq]);

  const kpi = useMemo(() => buildKpi(tasks), [tasks]);
  const matrix = useMemo(() => buildAssigneeMatrix(tasks, usersById), [tasks, usersById]);

  const onCreate = () => {
    modal.open(<TaskEditModal onSaved={refresh} />);
  };

  const onResetFilters = () => {
    setStatus(''); setAssignee(''); setCreator(''); setQ('');
  };

  const onOpenTask = (t) => {
    modal.open(<TaskViewModal task={t} onChanged={refresh} />);
  };

  const onEditTask = (t, e) => {
    e?.stopPropagation?.();
    modal.open(<TaskEditModal task={t} onSaved={refresh} />);
  };

  const onMatrixClick = (row) => {
    setAssignee(String(row.assignee_id));
    setStatus(''); setQ('');
    const el = document.querySelector('.tadm-table-wrap');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (!canCreate) {
    return (
      <EmptyState
        icon="⛔"
        title="Доступ ограничен"
        hint="Управлять задачами могут ADMIN, директора (HEAD_PM/HEAD_TO/DIRECTOR_*)"
      />
    );
  }

  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="Поручения"
        title="Управление задачами"
        subtitle={`${tasks.length} ${pl(tasks.length)} · ${visible.length} в выборке`}
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            <Btn variant="ghost" onClick={onResetFilters}>↺ Сбросить</Btn>
            <Btn variant="primary" onClick={onCreate}>+ Создать задачу</Btn>
          </>
        }
      />

      <div className="tadm-kpis">
        <KpiCard tone="amber"  icon="🆕" label="Новых"       value={kpi.new}     />
        <KpiCard tone="orange" icon="🔄" label="В работе"    value={kpi.active}  />
        <KpiCard tone="ok"     icon="✅" label="Выполнено"   value={kpi.done}    />
        <KpiCard tone="err"    icon="⚠️" label="Просрочено"  value={kpi.overdue} />
      </div>

      <div className="tadm-toolbar">
        <div>
          <SearchInput value={q} onChange={setQ} placeholder="Поиск по названию, описанию, ФИО…" />
        </div>
        <div>
          <SelectInput value={status} onChange={setStatus} options={STATUS_FILTER_OPTS} placeholder="Все статусы" />
        </div>
        <div>
          <SelectInput
            value={assignee}
            onChange={setAssignee}
            options={[
              { value: '', label: 'Все исполнители' },
              ...activeAssignees.map((u) => ({ value: String(u.id), label: (u.name || u.login) + ' (' + (u.role || '?') + ')' }))
            ]}
            placeholder="Все исполнители"
          />
        </div>
        <div>
          <SelectInput
            value={creator}
            onChange={setCreator}
            options={[
              { value: '', label: 'Все создатели' },
              ...activeAssignees.map((u) => ({ value: String(u.id), label: (u.name || u.login) + ' (' + (u.role || '?') + ')' }))
            ]}
            placeholder="Все создатели"
          />
        </div>
      </div>

      {/* Матрица «РП × статус» — обзор распределения нагрузки. */}
      {matrix.length > 0 && (
        <div className="tadm-matrix">
          <h3>
            <span>📊 Матрица РП × статус</span>
            <span className="hint">Клик по строке — фильтр по исполнителю</span>
          </h3>
          <div className="ov-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Исполнитель</th>
                  <th>Новых</th>
                  <th>Принято</th>
                  <th>В работе</th>
                  <th>Просрочено</th>
                  <th>Выполнено</th>
                  <th>Отменено</th>
                  <th>Всего</th>
                </tr>
              </thead>
              <tbody>
                {matrix.map((row) => (
                  <tr key={row.assignee_id} onClick={() => onMatrixClick(row)}>
                    <td>
                      {row.assignee_name}
                      {row.assignee_role && <span className="role">· {row.assignee_role}</span>}
                    </td>
                    <td className={cellCls(row.new, 'warm')}>{row.new}</td>
                    <td className={cellCls(row.accepted, null)}>{row.accepted}</td>
                    <td className={cellCls(row.in_progress, null)}>{row.in_progress}</td>
                    <td className={cellCls(row.overdue, 'hot')}>{row.overdue}</td>
                    <td className={cellCls(row.done, 'cold')}>{row.done}</td>
                    <td className={cellCls(row.cancelled, null)}>{row.cancelled}</td>
                    <td className="fw-700">{row.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {loading ? (
        <div className="card card-empty" >
          ⏳ Загружаем задачи…
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon="📋"
          title={q || status || assignee || creator ? 'Ничего не нашли' : 'Задач пока нет'}
          hint={q || status || assignee || creator
            ? 'Попробуйте изменить фильтры или сбросить поиск'
            : 'Создайте первую через «+ Создать задачу»'}
          action={!q && !status && !assignee && !creator ? <Btn variant="primary" onClick={onCreate}>+ Создать задачу</Btn> : null}
        />
      ) : (
        <div className="tadm-table-wrap">
          <div className="ov-x-auto">
            <table className="tadm-table">
              <thead>
                <tr>
                  <th style={{ width: 56 }}>ID</th>
                  <th>Задача</th>
                  <th className="w-180">Исполнитель</th>
                  <th className="w-110">Приоритет</th>
                  <th className="w-160">Дедлайн</th>
                  <th className="w-130">Статус</th>
                  <th className="w-180">Создатель</th>
                  <th className="w-110"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((t) => {
                  const overdue = isOverdue(t.deadline, t.status);
                  const stCls = STATUS_CLASS[t.status] || 'st-new';
                  const stLbl = STATUS_LABELS[t.status] || t.status;
                  const pCls  = PRIORITY_CLASS[t.priority] || PRIORITY_CLASS.normal;
                  const pLbl  = PRIORITY_LABELS[t.priority] || t.priority;
                  return (
                    <tr key={t.id} className={overdue ? 'row-overdue' : ''} onClick={() => onOpenTask(t)}>
                      <td className="tadm-id">#{t.id}</td>
                      <td className="tadm-title-cell">
                        <strong>{t.title || '—'}</strong>
                        {t.description && <div className="desc">{t.description}</div>}
                      </td>
                      <td>{t.assignee_name || '—'}</td>
                      <td><span className={'tadm-prio ' + pCls}>{pLbl}</span></td>
                      <td className={'tadm-deadline ' + (overdue ? 'is-overdue' : '')}>
                        {t.deadline ? formatDateTime(t.deadline) : '—'}{overdue ? ' ⚠️' : ''}
                      </td>
                      <td>
                        <span className={'tadm-st ' + (overdue ? 'st-overdue' : stCls)}>
                          {overdue ? 'Просрочена' : stLbl}
                        </span>
                      </td>
                      <td>{t.creator_name || '—'}</td>
                      <td>
                        <div className="tadm-actions-cell">
                          <button
                            className="tadm-icon-btn"
                            title="Редактировать"
                            onClick={(e) => onEditTask(t, e)}
                          >✎</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function KpiCard({ tone, icon, label, value }) {
  return (
    <div className={'tadm-kpi tadm-kpi--' + tone}>
      <div className="tadm-kpi__ic">{icon}</div>
      <div className="tadm-kpi__v">{value}</div>
      <div className="tadm-kpi__l">{label}</div>
    </div>
  );
}

function cellCls(value, tone) {
  if (!value) return 'is-zero';
  if (tone === 'hot')  return 'is-hot';
  if (tone === 'warm') return 'is-warm';
  if (tone === 'cold') return 'is-cold';
  return '';
}

function pl(n) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return 'задач';
  if (b > 1 && b < 5) return 'задачи';
  if (b === 1) return 'задача';
  return 'задач';
}
