import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { StatCard, StatRow } from '@/components/shared/StatCard';
import { StatusBadge } from '@/components/shared/StatusBadge';
import {
  CheckSquare, Clock, AlertTriangle, CheckCircle2,
  ChevronRight, Plus, User, Calendar, Flag,
  Play, Check, X, RotateCcw, MessageSquare,
} from 'lucide-react';
import { formatDate, relativeTime } from '@/lib/utils';

// ─── Приоритеты ─────────────────────────────────────────────────────────────
const PRIORITY = {
  urgent: { label: 'Срочно',   color: 'var(--red-soft)',  bg: 'rgba(255,69,58,0.12)',   dot: '🔴' },
  high:   { label: 'Высокий',  color: 'var(--gold)',      bg: 'rgba(200,168,78,0.12)',  dot: '🟡' },
  normal: { label: 'Обычный',  color: 'var(--blue)',      bg: 'rgba(74,144,217,0.12)', dot: '🔵' },
  low:    { label: 'Низкий',   color: 'var(--text-tertiary)', bg: 'rgba(142,142,147,0.1)', dot: '⚪' },
};

// ─── Статусы ─────────────────────────────────────────────────────────────────
const STATUS_LABEL = {
  new:         'Новая',
  accepted:    'Принята',
  in_progress: 'В работе',
  done:        'Выполнена',
  cancelled:   'Отменена',
  overdue:     'Просрочена',
};

const FILTERS = [
  { id: 'active',    label: 'Активные' },
  { id: 'overdue',   label: 'Просроченные' },
  { id: 'done',      label: 'Выполненные' },
  { id: 'all',       label: 'Все' },
];

const DIRECTOR_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
const CAN_CREATE     = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_PM', 'HEAD_TO'];

function isOverdue(task) {
  return task.deadline && new Date(task.deadline) < new Date()
    && !['done', 'cancelled'].includes(task.status);
}

function deadlineColor(task) {
  if (!task.deadline) return 'var(--text-tertiary)';
  const diff = new Date(task.deadline) - Date.now();
  if (diff < 0)          return 'var(--red-soft)';
  if (diff < 86400000)   return 'var(--gold)';
  return 'var(--text-tertiary)';
}

// ─── Компонент карточки задачи ───────────────────────────────────────────────
function TaskCard({ task, onOpen, delay }) {
  const p = PRIORITY[task.priority] || PRIORITY.normal;
  const dColor = deadlineColor(task);
  const statusText = STATUS_LABEL[task.status] || task.status;

  return (
    <button
      onClick={onOpen}
      className="w-full text-left rounded-2xl spring-tap ripple-container"
      style={{
        background: 'color-mix(in srgb, var(--bg-surface) 92%, transparent)',
        border: '0.5px solid var(--border-norse)',
        padding: '14px 16px',
        animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${delay}ms both`,
      }}
    >
      {/* Шапка: приоритет + статус */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <span
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full"
          style={{ color: p.color, background: p.bg }}
        >
          <Flag size={10} />
          {p.label}
        </span>
        <StatusBadge status={statusText} size="xs" />
      </div>

      {/* Заголовок */}
      <p
        className="text-[15px] font-semibold leading-snug mb-2"
        style={{
          color: 'var(--text-primary)',
          textDecoration: task.status === 'done' ? 'line-through' : 'none',
          opacity: task.status === 'done' ? 0.6 : 1,
        }}
      >
        {task.title}
      </p>

      {/* Мета */}
      <div className="flex items-center gap-3 flex-wrap">
        {task.creator_name && (
          <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
            <User size={10} />
            {task.creator_name}
          </span>
        )}
        {task.deadline && (
          <span className="flex items-center gap-1 text-[11px] font-medium" style={{ color: dColor }}>
            <Clock size={10} />
            {formatDate(task.deadline)}
          </span>
        )}
      </div>

      {/* Полоска просрочки */}
      {isOverdue(task) && (
        <div
          className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold"
          style={{ color: 'var(--red-soft)' }}
        >
          <AlertTriangle size={11} />
          Просрочена
        </div>
      )}

      <ChevronRight
        size={14}
        style={{
          color: 'var(--text-tertiary)',
          position: 'absolute',
          right: 14,
          top: '50%',
          transform: 'translateY(-50%)',
        }}
      />
    </button>
  );
}

// ─── Детальный лист ──────────────────────────────────────────────────────────
function TaskDetail({ task, onClose, onRefresh, userId, role }) {
  const haptic = useHaptic();
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [showComment, setShowComment] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);

  if (!task) return null;

  const isAssignee = task.assignee_id === userId;
  const isCreator  = task.creator_id  === userId;
  const isDirector = DIRECTOR_ROLES.includes(role);
  const p = PRIORITY[task.priority] || PRIORITY.normal;
  const dColor = deadlineColor(task);
  const statusText = STATUS_LABEL[task.status] || task.status;

  // Доступные действия для текущего пользователя
  const actions = [];
  if (task.status === 'new' && (isAssignee || isDirector)) {
    actions.push({ id: 'accept', label: 'Принять',    icon: Check,   color: 'var(--blue)',  bg: 'rgba(74,144,217,0.12)', needComment: false });
  }
  if (['new', 'accepted'].includes(task.status) && (isAssignee || isDirector)) {
    actions.push({ id: 'start', label: 'В работу',   icon: Play,    color: 'var(--green)', bg: 'rgba(48,209,88,0.12)',  needComment: false });
  }
  if (['new','accepted','in_progress','overdue'].includes(task.status) && (isAssignee || isDirector)) {
    actions.push({ id: 'complete', label: 'Выполнено', icon: CheckCircle2, color: 'var(--green)', bg: 'rgba(48,209,88,0.12)', needComment: true });
  }
  if (['new','accepted','in_progress'].includes(task.status) && (isCreator || isDirector)) {
    actions.push({ id: 'cancel', label: 'Отменить',  icon: X,       color: 'var(--red-soft)', bg: 'rgba(255,69,58,0.10)', needComment: false });
  }

  const handleAction = async (action) => {
    if (action.needComment && !showComment) {
      setPendingAction(action);
      setShowComment(true);
      return;
    }
    haptic.light();
    setLoading(true);
    try {
      const endpointMap = { accept: 'accept', start: 'start', complete: 'complete' };
      if (action.id === 'cancel') {
        await api.put(`/tasks/${task.id}/status`, { status: 'cancelled' });
      } else if (endpointMap[action.id]) {
        await api.put(`/tasks/${task.id}/${endpointMap[action.id]}`, { comment: comment || null });
      }
      haptic.success();
      setComment('');
      setShowComment(false);
      setPendingAction(null);
      onClose();
      onRefresh();
    } catch (e) {
      haptic.error?.();
    } finally {
      setLoading(false);
    }
  };

  return (
    <BottomSheet open={!!task} onClose={onClose} title={task.title}>
      <div className="flex flex-col gap-3 pb-6">
        {/* Статус и приоритет */}
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={statusText} />
          <span
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full"
            style={{ color: p.color, background: p.bg }}
          >
            <Flag size={10} /> {p.label}
          </span>
        </div>

        {/* Детали */}
        <div
          className="rounded-2xl overflow-hidden"
          style={{ background: 'var(--bg-surface)', border: '0.5px solid var(--border-norse)' }}
        >
          {[
            task.creator_name  && { label: 'Автор',      value: task.creator_name,             icon: User },
            task.assignee_name && { label: 'Исполнитель', value: task.assignee_name,            icon: User },
            task.deadline      && { label: 'Дедлайн',    value: formatDate(task.deadline),      icon: Calendar, color: dColor },
            task.created_at    && { label: 'Создана',    value: relativeTime(task.created_at),  icon: Clock },
          ].filter(Boolean).map((row, i, arr) => (
            <div
              key={i}
              className="flex items-center gap-3 px-4 py-3"
              style={{ borderBottom: i < arr.length - 1 ? '0.5px solid var(--border-norse)' : 'none' }}
            >
              <row.icon size={14} style={{ color: row.color || 'var(--text-tertiary)', flexShrink: 0 }} />
              <span className="text-[12px] c-secondary flex-shrink-0">{row.label}</span>
              <span className="text-[13px] font-medium ml-auto" style={{ color: row.color || 'var(--text-primary)' }}>
                {row.value}
              </span>
            </div>
          ))}
        </div>

        {/* Описание */}
        {task.description && (
          <div
            className="rounded-2xl px-4 py-3"
            style={{ background: 'var(--bg-surface)', border: '0.5px solid var(--border-norse)' }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wider c-tertiary mb-1.5">Описание</p>
            <p className="text-[14px] c-primary leading-relaxed whitespace-pre-wrap">{task.description}</p>
          </div>
        )}

        {/* Комментарий создателя */}
        {task.creator_comment && (
          <div
            className="rounded-2xl px-4 py-3"
            style={{ background: 'rgba(200,168,78,0.06)', border: '0.5px solid rgba(200,168,78,0.2)' }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--gold)' }}>
              Комментарий автора
            </p>
            <p className="text-[14px] c-primary leading-relaxed">{task.creator_comment}</p>
          </div>
        )}

        {/* Поле комментария для выполнения */}
        {showComment && (
          <div style={{ animation: 'fadeInUp 150ms var(--ease-spring) both' }}>
            <p className="text-[11px] font-semibold uppercase tracking-wider c-tertiary mb-1.5">
              {pendingAction?.id === 'complete' ? 'Комментарий к выполнению' : 'Комментарий'}
            </p>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Что было сделано..."
              rows={3}
              className="w-full px-3 py-2.5 rounded-xl text-[14px] outline-none resize-none"
              style={{
                background: 'var(--bg-surface-alt)',
                color: 'var(--text-primary)',
                border: '0.5px solid var(--border-norse)',
                caretColor: 'var(--gold)',
              }}
              autoFocus
            />
            {pendingAction && (
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => { setShowComment(false); setComment(''); setPendingAction(null); }}
                  className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold spring-tap"
                  style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                >
                  Отмена
                </button>
                <button
                  onClick={() => handleAction(pendingAction)}
                  disabled={loading}
                  className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold spring-tap"
                  style={{ background: pendingAction.bg, color: pendingAction.color, opacity: loading ? 0.6 : 1 }}
                >
                  {loading ? 'Отправка...' : pendingAction.label}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Кнопки действий */}
        {actions.length > 0 && !showComment && (
          <div className="flex gap-2 flex-wrap">
            {actions.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.id}
                  onClick={() => handleAction(action)}
                  disabled={loading}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[13px] font-semibold spring-tap"
                  style={{
                    minWidth: 100,
                    background: action.bg,
                    color: action.color,
                    opacity: loading ? 0.6 : 1,
                    border: `0.5px solid color-mix(in srgb, ${action.color} 20%, transparent)`,
                  }}
                >
                  <Icon size={15} />
                  {action.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </BottomSheet>
  );
}

// ─── Форма создания задачи ────────────────────────────────────────────────────
function CreateTaskSheet({ open, onClose, onCreated }) {
  const haptic = useHaptic();
  const [employees, setEmployees] = useState([]);
  const [title, setTitle]       = useState('');
  const [desc, setDesc]         = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [priority, setPriority] = useState('normal');
  const [deadline, setDeadline] = useState('');
  const [crComment, setCrComment] = useState('');
  const [saving, setSaving]     = useState(false);

  useEffect(() => {
    if (!open) return;
    api.get('/users/list').then((res) => {
      const rows = api.extractRows(res) || [];
      setEmployees(rows.filter((u) => u.is_active));
    }).catch(() => {});
  }, [open]);

  const reset = () => {
    setTitle(''); setDesc(''); setAssigneeId('');
    setPriority('normal'); setDeadline(''); setCrComment('');
  };

  const handleSubmit = async () => {
    if (!title.trim() || !assigneeId) return;
    haptic.light();
    setSaving(true);
    try {
      await api.post('/tasks', {
        title: title.trim(),
        description: desc.trim() || null,
        assignee_id: parseInt(assigneeId),
        priority,
        deadline: deadline || null,
        creator_comment: crComment.trim() || null,
      });
      haptic.success();
      reset();
      onClose();
      onCreated();
    } catch (e) {
      haptic.error?.();
    } finally {
      setSaving(false);
    }
  };

  const isValid = title.trim() && assigneeId;

  return (
    <BottomSheet open={open} onClose={onClose} title="Новая задача">
      <div className="flex flex-col gap-3 pb-6">

        <Field label="Название задачи">
          <input
            type="text" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Что нужно сделать..."
            className="w-full px-3 py-2.5 rounded-xl text-[14px] outline-none"
            style={inputStyle}
          />
        </Field>

        <Field label="Исполнитель">
          <select
            value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl text-[14px] outline-none"
            style={inputStyle}
          >
            <option value="">Выберите сотрудника...</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.name || e.login}</option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Приоритет">
            <select
              value={priority} onChange={(e) => setPriority(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-[14px] outline-none"
              style={inputStyle}
            >
              <option value="low">Низкий</option>
              <option value="normal">Обычный</option>
              <option value="high">Высокий</option>
              <option value="urgent">Срочно</option>
            </select>
          </Field>
          <Field label="Дедлайн">
            <input
              type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-[14px] outline-none"
              style={inputStyle}
            />
          </Field>
        </div>

        <Field label="Описание (необязательно)">
          <textarea
            value={desc} onChange={(e) => setDesc(e.target.value)}
            placeholder="Подробности задачи..."
            rows={3}
            className="w-full px-3 py-2.5 rounded-xl text-[14px] outline-none resize-none"
            style={inputStyle}
          />
        </Field>

        <Field label="Комментарий для исполнителя">
          <textarea
            value={crComment} onChange={(e) => setCrComment(e.target.value)}
            placeholder="Контекст, советы, ресурсы..."
            rows={2}
            className="w-full px-3 py-2.5 rounded-xl text-[14px] outline-none resize-none"
            style={inputStyle}
          />
        </Field>

        <button
          onClick={handleSubmit}
          disabled={!isValid || saving}
          className="w-full py-3.5 rounded-xl font-semibold text-[14px] spring-tap"
          style={{
            background: isValid ? 'var(--gold-gradient)' : 'var(--bg-elevated)',
            color: isValid ? '#fff' : 'var(--text-tertiary)',
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? 'Создание...' : 'Назначить задачу'}
        </button>
      </div>
    </BottomSheet>
  );
}

const inputStyle = {
  background: 'var(--bg-surface-alt)',
  color: 'var(--text-primary)',
  border: '0.5px solid var(--border-norse)',
  caretColor: 'var(--gold)',
};

function Field({ label, children }) {
  return (
    <div>
      <label
        className="block mb-1.5"
        style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)' }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

// ─── Главная страница ─────────────────────────────────────────────────────────
export default function Tasks() {
  const user    = useAuthStore((s) => s.user);
  const haptic  = useHaptic();
  const [tasks,   setTasks]   = useState([]);
  const [stats,   setStats]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState('active');
  const [detail,  setDetail]  = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  // Директор: переключение между "Мне назначили" и "Я назначил"
  const [view, setView] = useState('my');

  const isDirector = user && DIRECTOR_ROLES.includes(user.role);
  const canCreate  = user && CAN_CREATE.includes(user.role);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [taskRes, statRes] = await Promise.all([
        api.get(view === 'created' ? '/tasks/created' : '/tasks/my'),
        api.get('/tasks/stats').catch(() => null),
      ]);
      const rows = (taskRes?.tasks || api.extractRows(taskRes) || []);
      setTasks(rows);
      if (statRes) setStats(statRes);
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [view]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    if (filter === 'active')  return tasks.filter((t) => ['new','accepted','in_progress'].includes(t.status));
    if (filter === 'overdue') return tasks.filter((t) => isOverdue(t));
    if (filter === 'done')    return tasks.filter((t) => ['done','cancelled'].includes(t.status));
    return tasks;
  }, [tasks, filter]);

  const openDetail = (task) => { haptic.light(); setDetail(task); };

  return (
    <PageShell
      title="Задачи"
      headerRight={
        canCreate && (
          <button
            onClick={() => { haptic.light(); setShowCreate(true); }}
            className="flex items-center justify-center spring-tap"
            style={{ width: 44, height: 44, color: 'var(--blue)' }}
          >
            <Plus size={22} />
          </button>
        )
      }
    >
      <PullToRefresh onRefresh={fetchData}>

        {/* Статистика */}
        {stats && !loading && (
          <StatRow cols={3}>
            <StatCard
              icon={CheckSquare}
              label="Активные"
              value={stats.active ?? 0}
              color="var(--blue)"
              delay={0}
            />
            <StatCard
              icon={AlertTriangle}
              label="Просрочены"
              value={stats.overdue ?? 0}
              color="var(--red-soft)"
              delay={50}
            />
            <StatCard
              icon={CheckCircle2}
              label="Выполнены"
              value={stats.done_count ?? 0}
              color="var(--green)"
              delay={100}
            />
          </StatRow>
        )}

        {/* Переключатель вид (директор) */}
        {isDirector && (
          <div
            className="flex gap-1 mb-3 p-1 rounded-2xl"
            style={{ background: 'var(--bg-surface)', border: '0.5px solid var(--border-norse)' }}
          >
            {[
              { id: 'my',      label: 'Назначены мне' },
              { id: 'created', label: 'Я назначил' },
            ].map((v) => (
              <button
                key={v.id}
                onClick={() => { haptic.light(); setView(v.id); }}
                className="flex-1 py-2 rounded-xl text-[13px] font-semibold spring-tap"
                style={{
                  background: view === v.id ? 'var(--bg-elevated)' : 'transparent',
                  color: view === v.id ? 'var(--text-primary)' : 'var(--text-tertiary)',
                  transition: 'all var(--motion-fast) var(--ease-smooth)',
                }}
              >
                {v.label}
              </button>
            ))}
          </div>
        )}

        {/* Фильтры */}
        <div className="flex gap-1.5 mb-3 overflow-x-auto no-scrollbar">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => { haptic.light(); setFilter(f.id); }}
              className="shrink-0 px-3 py-1.5 rounded-full text-[12px] font-semibold spring-tap"
              style={{
                background: filter === f.id ? 'var(--bg-elevated)' : 'transparent',
                color: filter === f.id ? 'var(--text-primary)' : 'var(--text-tertiary)',
                border: filter === f.id ? '0.5px solid var(--border-light)' : '0.5px solid transparent',
              }}
            >
              {f.label}
              {f.id === 'overdue' && stats?.overdue > 0 && (
                <span
                  className="ml-1.5 inline-flex items-center justify-center rounded-full text-[10px] font-bold"
                  style={{ minWidth: 16, height: 16, background: 'var(--red-soft)', color: '#fff', padding: '0 4px' }}
                >
                  {stats.overdue}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Список */}
        {loading ? (
          <SkeletonList count={5} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={CheckSquare}
            iconColor="var(--blue)"
            iconBg="rgba(74,144,217,0.1)"
            title={filter === 'active' ? 'Нет активных задач' : filter === 'done' ? 'Нет выполненных' : 'Нет задач'}
            description={filter === 'active' ? 'Все задачи выполнены — отличная работа!' : 'Задачи появятся здесь'}
          />
        ) : (
          <div className="flex flex-col gap-2 pb-4" style={{ position: 'relative' }}>
            {filtered.map((task, i) => (
              <TaskCard
                key={task.id}
                task={task}
                onOpen={() => openDetail(task)}
                delay={i * 40}
              />
            ))}
          </div>
        )}
      </PullToRefresh>

      <TaskDetail
        task={detail}
        onClose={() => setDetail(null)}
        onRefresh={fetchData}
        userId={user?.id}
        role={user?.role}
      />

      <CreateTaskSheet
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={fetchData}
      />
    </PageShell>
  );
}
