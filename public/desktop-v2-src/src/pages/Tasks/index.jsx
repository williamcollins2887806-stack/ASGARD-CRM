/**
 * Страница /tasks — задачи от руководства + личные todo.
 *
 * Источник: vanilla `public/assets/js/tasks.js` (~660 строк).
 *
 *   ✅ index.jsx              — TopActionsBar + 2-колоночный layout
 *   ✅ api.js                 — все endpoints /api/tasks* + /api/tasks/todo*
 *   ✅ TaskCard.jsx           — карточка задачи с действиями + раскрытие
 *   ✅ TaskCreateModal.jsx    — создание/редактирование (директора)
 *   ✅ TodoPanel.jsx          — личный todo-список с +/edit/delete/toggle
 *   ✅ tasks.css              — раскладка и стили
 *
 * RBAC:
 *   • Все: видят свои задачи, могут принимать/начинать/завершать, todo CRUD
 *   • ADMIN / DIRECTOR_*: дополнительно «Создать задачу» + «Мои поручения»
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import { SearchInput, SelectInput } from '@/inputs/Inputs';
import { useDebounce } from '@/api/useListHelpers';

import { TaskCard } from './TaskCard';
import { TaskCreateModal } from './TaskCreateModal';
import { TodoPanel } from './TodoPanel';
import {
  loadMyTasks, loadCreatedTasks, loadTodo,
  STATUS_LABELS, isDirector
} from './api';
import './tasks.css';

const STATUS_FILTER_OPTS = [
  { value: '',            label: 'Все статусы' },
  { value: 'new',         label: STATUS_LABELS.new },
  { value: 'accepted',    label: STATUS_LABELS.accepted },
  { value: 'in_progress', label: STATUS_LABELS.in_progress },
  { value: 'overdue',     label: STATUS_LABELS.overdue },
  { value: 'done',        label: STATUS_LABELS.done }
];

const VIEW_OPTS = [
  { value: 'my',      label: '📥 Мои задачи' },
  { value: 'created', label: '📤 Мои поручения' }
];

export default function TasksPage() {
  const { user } = useAuth();
  const modal = useModal();

  const canCreate = isDirector(user?.role);

  const [view, setView]     = useState('my');          // 'my' | 'created'
  const [status, setStatus] = useState('');             // фильтр статуса
  const [q, setQ]           = useState('');             // поиск
  const dq = useDebounce(q, 300);                       // G-11: debounce 300мс

  const [myTasks, setMyTasks]       = useState([]);
  const [createdTasks, setCreated]  = useState([]);
  const [todo, setTodo]             = useState([]);
  const [loadingTasks, setLoadingT] = useState(true);
  const [loadingTodo, setLoadingTodo] = useState(true);

  const refreshTasks = () => {
    setLoadingT(true);
    const tasks = [loadMyTasks().then(setMyTasks).catch(() => setMyTasks([]))];
    if (canCreate) {
      tasks.push(loadCreatedTasks().then(setCreated).catch(() => setCreated([])));
    } else {
      setCreated([]);
    }
    Promise.all(tasks).finally(() => setLoadingT(false));
  };

  const refreshTodo = () => {
    setLoadingTodo(true);
    loadTodo().then(setTodo).catch(() => setTodo([])).finally(() => setLoadingTodo(false));
  };

  useEffect(() => {
    if (!user) return;
    refreshTasks();
    refreshTodo();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.role]);

  // Поддержка deep-link ?id=…
  useEffect(() => {
    const checkHash = () => {
      const m = (window.location.hash || '').match(/[?&]id=(\d+)/);
      if (m && m[1]) {
        // ничего открывать не нужно — TaskCard разворачивается по клику;
        // проскроллим к карточке по id
        setTimeout(() => {
          const el = document.querySelector(`[data-task-id="${m[1]}"]`);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.click();
          }
        }, 350);
      }
    };
    checkHash();
    window.addEventListener('hashchange', checkHash);
    return () => window.removeEventListener('hashchange', checkHash);
  }, []);

  const activeList = view === 'created' ? createdTasks : myTasks;

  const visible = useMemo(() => {
    const norm = dq.trim().toLowerCase();
    return activeList.filter((t) => {
      if (status && t.status !== status) return false;
      if (norm) {
        const a = String(t.title || '').toLowerCase();
        const b = String(t.description || '').toLowerCase();
        const c = String(t.assignee_name || t.creator_name || '').toLowerCase();
        if (!a.includes(norm) && !b.includes(norm) && !c.includes(norm)) return false;
      }
      return true;
    });
  }, [activeList, status, dq]);

  const counts = useMemo(() => ({
    my:       myTasks.length,
    created:  createdTasks.length,
    overdue:  myTasks.filter((t) => ['new', 'accepted', 'in_progress'].includes(t.status) && t.deadline && new Date(t.deadline) < new Date()).length,
    new:      myTasks.filter((t) => t.status === 'new').length
  }), [myTasks, createdTasks]);

  const onCreate = () => {
    if (!canCreate) {
      toast.warn('Создавать задачи могут только: ADMIN и директора');
      return;
    }
    modal.open(<TaskCreateModal onSaved={refreshTasks} />);
  };

  return (
    <div className="tasks-page">
      <div className="tasks-main">
        <TopActionsBar
          kicker="Поручения"
          title="Задачи"
          subtitle={`${counts.my} ${pluralize(counts.my, ['задача', 'задачи', 'задач'])}${counts.overdue ? ` · ⚠️ ${counts.overdue} просрочено` : ''}${counts.new ? ` · 🔔 ${counts.new} новых` : ''}`}
          actions={
            <>
              <Btn variant="ghost" onClick={() => { refreshTasks(); refreshTodo(); }}>↻ Обновить</Btn>
              {canCreate && <Btn variant="primary" onClick={onCreate}>+ Создать задачу</Btn>}
            </>
          }
        />

        <div className="tasks-toolbar">
          <div>
            <SearchInput value={q} onChange={setQ} placeholder="Поиск по названию, описанию, исполнителю…" />
          </div>
          <div>
            <SelectInput
              value={view}
              onChange={(v) => { setView(v); setStatus(''); }}
              options={canCreate ? VIEW_OPTS : [VIEW_OPTS[0]]}
              placeholder="Что показать"
            />
          </div>
          <div>
            <SelectInput value={status} onChange={setStatus} options={STATUS_FILTER_OPTS} placeholder="Все статусы" />
          </div>
        </div>

        {loadingTasks ? (
          <div className="card card-empty" >
            ⏳ Загружаем задачи…
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={view === 'created' ? '📤' : '📋'}
            title={q || status ? 'Ничего не нашли' : (view === 'created' ? 'Вы ещё не создавали задач' : 'У вас пока нет задач')}
            hint={
              q || status
                ? 'Попробуйте изменить запрос или фильтр'
                : (view === 'created'
                  ? 'Назначьте первую задачу через «+ Создать задачу»'
                  : 'Когда руководство назначит задачу — она появится здесь.')
            }
            action={canCreate && view === 'created'
              ? <Btn variant="primary" onClick={onCreate}>+ Создать задачу</Btn>
              : null}
          />
        ) : (
          <div className="tasks-list">
            {visible.map((t) => (
              <div key={t.id} data-task-id={t.id}>
                <TaskCard
                  task={t}
                  currentUser={user}
                  onChanged={refreshTasks}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="tasks-side">
        <TodoPanel items={todo} loading={loadingTodo} onChanged={refreshTodo} />
      </div>
    </div>
  );
}

function pluralize(n, forms) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}
