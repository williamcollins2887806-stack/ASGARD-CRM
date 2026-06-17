/**
 * Страница /kanban — Канбан-доска задач.
 * Источник: vanilla `public/assets/js/kanban.js` (~470 строк).
 *
 *   ✅ index.jsx           — root + state + drag&drop + фильтры + поиск
 *   ✅ api.js              — endpoints + константы COLUMNS/PRIORITIES + хелперы
 *   ✅ Column.jsx          — колонка с drop-target
 *   ✅ Card.jsx            — карточка задачи (draggable)
 *   ✅ TaskDetailModal.jsx — детали задачи + комментарии + ознакомление + подписка
 *   ✅ kanban.css          — стили (CSS-переменные)
 *
 * Endpoints (см. src/routes/tasks.js):
 *   GET /api/tasks/kanban?priority=&assignee_id=
 *   PUT /api/tasks/:id/move { column, position }
 *   GET /api/tasks/:id  +  /comments  +  /watch  +  /acknowledge
 *
 * Deep-link: `#/kanban?id=123` — открывает модалку задачи при заходе.
 * Поддержка событий `asgard:tasks:changed` для refresh из других страниц.
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar } from '@/blocks/Blocks';
import { SearchInput, SelectInput } from '@/inputs/Inputs';
import { useDebounce } from '@/api/useListHelpers';
import KanbanColumn from './Column';
import TaskDetailModal from './TaskDetailModal';
import {
  loadKanban, moveTask, loadUsers,
  COLUMNS, PRIORITIES
} from './api';
import './kanban.css';

export default function KanbanPage() {
  const { user } = useAuth();
  const modal = useModal();

  const [board, setBoard] = useState({ columns: emptyColumns(), tasks: [] });
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  // Фильтры
  const [q, setQ] = useState('');
  const dq = useDebounce(q, 300);  // G-11: debounce 300мс
  const [priority, setPriority] = useState('');
  const [assignee, setAssignee] = useState('');

  const refresh = () => {
    setLoading(true);
    const filters = {};
    if (priority) filters.priority = priority;
    if (assignee) filters.assignee_id = assignee;
    loadKanban(filters)
      .then(setBoard)
      .catch((e) => {
        toast.error('Не удалось загрузить канбан: ' + (e?.message || e));
        setBoard({ columns: emptyColumns(), tasks: [] });
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadUsers()
      .then((list) => setUsers((list || []).filter((u) => u.is_active && u.name)))
      .catch(() => setUsers([]));
  }, []);

  useEffect(refresh, [priority, assignee]);

  // Внешние события (например, после смены в детали из другого места)
  useEffect(() => {
    const onChanged = () => refresh();
    window.addEventListener('asgard:tasks:changed', onChanged);
    return () => window.removeEventListener('asgard:tasks:changed', onChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep-link `?id=123` — открыть конкретную задачу
  useEffect(() => {
    const check = () => {
      const m = (window.location.hash || '').match(/[?&]id=(\d+)/);
      if (m && m[1]) {
        modal.open(<TaskDetailModal taskId={Number(m[1])} onChanged={refresh} />);
      }
    };
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Фильтрация по поиску (клиент) ──────────────────────────────────── */
  const visibleColumns = useMemo(() => {
    if (!dq.trim()) return board.columns;
    const norm = dq.trim().toLowerCase();
    const out = {};
    for (const c of COLUMNS) {
      out[c.id] = (board.columns[c.id] || []).filter((t) => {
        const a = String(t.title || '').toLowerCase();
        const b = String(t.description || '').toLowerCase();
        const c2 = String(t.assignee_name || '').toLowerCase();
        return a.includes(norm) || b.includes(norm) || c2.includes(norm);
      });
    }
    return out;
  }, [board.columns, dq]);

  /* ── Drag&Drop ──────────────────────────────────────────────────────── */
  const draggedRef = useRef(null);

  const onDragStart = (task, el) => {
    draggedRef.current = { task, el };
    el?.classList?.add('is-dragging');
  };
  const onDragEnd = (_, el) => {
    el?.classList?.remove('is-dragging');
    draggedRef.current = null;
  };

  const onDropTo = async (col) => {
    const drag = draggedRef.current;
    draggedRef.current = null;
    if (!drag) return;
    const t = drag.task;
    const fromCol = t.kanban_column || 'new';
    if (col.id === fromCol) return;

    // Оптимистичный апдейт
    setBoard((prev) => moveInBoard(prev, t.id, fromCol, col.id));
    try {
      await moveTask(t.id, col.id);
      toast.success(`Перенесено: ${labelOfCol(fromCol)} → ${col.label}`);
      // Перезагружаем — на бэке поменялся status и метаданные (acknowledged_at, completed_at и т.п.)
      refresh();
    } catch (e) {
      toast.error('Не удалось перенести: ' + (e?.message || e));
      // Откат
      setBoard((prev) => moveInBoard(prev, t.id, col.id, fromCol));
    }
  };

  /* ── Опции для фильтров ─────────────────────────────────────────────── */
  const priorityOpts = useMemo(() => ([
    { value: '', label: 'Все приоритеты' },
    ...Object.entries(PRIORITIES).map(([k, v]) => ({ value: k, label: `${v.icon} ${v.label}` }))
  ]), []);

  const assigneeOpts = useMemo(() => ([
    { value: '', label: 'Все исполнители' },
    user ? { value: String(user.id), label: '👤 Мои задачи' } : null,
    ...users.filter((u) => !user || u.id !== user.id).map((u) => ({
      value: String(u.id),
      label: u.name + (u.role ? ` · ${u.role}` : '')
    }))
  ].filter(Boolean)), [users, user]);

  const totalCount = (board.tasks || []).length;
  const overdueCount = (board.tasks || []).filter((t) =>
    t.status !== 'done' && t.deadline && new Date(t.deadline) < new Date()
  ).length;

  const onCardOpen = (task) => {
    modal.open(<TaskDetailModal taskId={task.id} onChanged={refresh} />);
  };

  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="Поручения"
        title="Канбан-доска задач"
        subtitle={`${totalCount} задач${overdueCount ? ` · ⚠ ${overdueCount} просрочено` : ''} · перетаскивайте карточки между колонками`}
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            <Btn onClick={() => { window.location.hash = '#/tasks'; }}>📋 К списку</Btn>
          </>
        }
      />

      <div className="kb-toolbar">
        <div>
          <SearchInput
            value={q}
            onChange={setQ}
            placeholder="Поиск по названию, описанию, исполнителю…"
          />
        </div>
        <div>
          <SelectInput value={priority} onChange={setPriority} options={priorityOpts} />
        </div>
        <div>
          <SelectInput value={assignee} onChange={setAssignee} options={assigneeOpts} />
        </div>
        <div>
          {(priority || assignee || q) && (
            <Btn variant="ghost" onClick={() => { setPriority(''); setAssignee(''); setQ(''); }}>
              ✕ Сбросить
            </Btn>
          )}
        </div>
      </div>

      {loading ? (
        <div className="card card-empty" >
          ⏳ Загружаем доску…
        </div>
      ) : (
        <div className="kb-board">
          {COLUMNS.map((c) => (
            <KanbanColumn
              key={c.id}
              column={c}
              tasks={visibleColumns[c.id] || []}
              onCardOpen={onCardOpen}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDropTo={onDropTo}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Хелперы ────────────────────────────────────────────────────────────── */
function emptyColumns() {
  const out = {};
  for (const c of COLUMNS) out[c.id] = [];
  return out;
}

function labelOfCol(id) {
  return COLUMNS.find((c) => c.id === id)?.label || id;
}

function moveInBoard(prev, taskId, fromCol, toCol) {
  const fromList = (prev.columns[fromCol] || []).slice();
  const toList = (prev.columns[toCol] || []).slice();
  const idx = fromList.findIndex((t) => t.id === taskId);
  if (idx < 0) return prev;
  const [item] = fromList.splice(idx, 1);
  const newItem = { ...item, kanban_column: toCol };
  toList.unshift(newItem);
  return {
    ...prev,
    columns: { ...prev.columns, [fromCol]: fromList, [toCol]: toList }
  };
}
