import { useState, useEffect, useCallback, useMemo } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { ClipboardList, Plus, ChevronRight, Search, X, Check, Trash2 } from 'lucide-react';
import { formatDate, relativeTime } from '@/lib/utils';

const STATUS_MAP = {
  new: { label: 'Новая', color: 'var(--gold)' },
  accepted: { label: 'Принята', color: 'var(--blue)' },
  in_progress: { label: 'В работе', color: 'var(--blue)' },
  done: { label: 'Выполнена', color: 'var(--green)' },
  overdue: { label: 'Просрочена', color: 'var(--red-soft)' },
};
const PRIORITY_MAP = {
  low: { label: 'Низкий', color: 'var(--text-tertiary)' },
  normal: { label: 'Обычный', color: 'var(--blue)' },
  high: { label: 'Высокий', color: 'var(--gold)' },
  urgent: { label: 'Срочный', color: 'var(--red-soft)' },
};
const FILTERS = [
  { id: 'all', label: 'Все' }, { id: 'new', label: 'Новые' },
  { id: 'in_progress', label: 'В работе' }, { id: 'done', label: 'Выполнено' }, { id: 'overdue', label: 'Просрочено' },
];

function getTaskStatus(task) {
  if (task.status === 'done') return 'done';
  if (task.deadline && new Date(task.deadline) < new Date() && task.status !== 'done') return 'overdue';
  return task.status || 'new';
}

export default function TasksAdmin() {
  const haptic = useHaptic();
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [detail, setDetail] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [tRes, uRes] = await Promise.all([
        api.get('/tasks/all'),
        api.get('/users').catch(() => null),
      ]);
      setTasks(api.extractRows(tRes) || []);
      if (uRes) setUsers((api.extractRows(uRes) || []).filter((u) => u.is_active !== false));
    } catch { setTasks([]); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    let list = tasks.map((t) => ({ ...t, _status: getTaskStatus(t) }));
    if (filter !== 'all') list = list.filter((t) => t._status === filter);
    if (search) { const q = search.toLowerCase(); list = list.filter((t) => (t.title || t.text || '').toLowerCase().includes(q) || (t.assignee_name || '').toLowerCase().includes(q)); }
    return list;
  }, [tasks, filter, search]);

  const handleComplete = async (id) => {
    haptic.light();
    try { await api.put(`/tasks/${id}/complete`); fetchData(); setDetail(null); haptic.success(); } catch {}
  };
  const handleDelete = async (id) => {
    haptic.medium();
    try { await api.delete(`/tasks/${id}`); fetchData(); setDetail(null); haptic.success(); } catch {}
  };

  return (
    <PageShell title="Все задачи" headerRight={
      <div className="flex items-center">
        <button onClick={() => { haptic.light(); setShowSearch(!showSearch); }} className="btn-icon spring-tap"><Search size={20} /></button>
        <button onClick={() => { haptic.light(); setShowCreate(true); }} className="btn-icon spring-tap c-blue"><Plus size={22} /></button>
      </div>
    }>
      <PullToRefresh onRefresh={fetchData}>
        {showSearch && (
          <div className="px-1 pb-2" style={{ animation: 'fadeInUp 150ms var(--ease-spring) forwards' }}>
            <div className="search-bar">
              <Search size={16} className="c-tertiary" style={{ flexShrink: 0 }} />
              <input type="text" placeholder="Поиск задач..." value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
              {search && <button onClick={() => setSearch('')} className="c-tertiary"><X size={16} /></button>}
            </div>
          </div>
        )}
        <div className="flex gap-1.5 px-1 pb-3 overflow-x-auto no-scrollbar">
          {FILTERS.map((f) => <button key={f.id} onClick={() => { haptic.light(); setFilter(f.id); }} className="filter-pill spring-tap" data-active={filter === f.id}>{f.label}</button>)}
        </div>
        {loading ? <SkeletonList count={5} /> : filtered.length === 0 ? (
          <EmptyState icon={ClipboardList} iconColor="var(--blue)" iconBg="rgba(74,144,217,0.1)" title={search ? 'Ничего не найдено' : 'Нет задач'} description="Задачи появятся здесь" />
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {filtered.map((task, i) => {
              const st = STATUS_MAP[task._status] || STATUS_MAP.new;
              const pr = PRIORITY_MAP[task.priority] || PRIORITY_MAP.normal;
              return (
                <button key={task.id} onClick={() => { haptic.light(); setDetail(task); }} className="w-full text-left rounded-2xl px-4 py-3 spring-tap card-glass" style={{ animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 40}ms both` }}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[14px] font-semibold leading-tight c-primary">{task.title || task.text || `Задача #${task.id}`}</p>
                    <ChevronRight size={16} className="c-tertiary" style={{ flexShrink: 0, marginTop: 2 }} />
                  </div>
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: `color-mix(in srgb, ${st.color} 15%, transparent)`, color: st.color }}>{st.label}</span>
                    {task.priority && task.priority !== 'normal' && <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: `color-mix(in srgb, ${pr.color} 15%, transparent)`, color: pr.color }}>{pr.label}</span>}
                    {task.assignee_name && <span className="text-[10px] c-tertiary">{task.assignee_name}</span>}
                    {task.deadline && <span className="text-[10px] c-tertiary">до {formatDate(task.deadline)}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </PullToRefresh>
      <TaskAdminDetailSheet task={detail} onClose={() => setDetail(null)} onComplete={handleComplete} onDelete={handleDelete} />
      <CreateTaskAdminSheet open={showCreate} onClose={() => setShowCreate(false)} onCreated={fetchData} users={users} />
    </PageShell>
  );
}

function TaskAdminDetailSheet({ task, onClose, onComplete, onDelete }) {
  if (!task) return null;
  const t = task;
  const st = STATUS_MAP[t._status || getTaskStatus(t)] || STATUS_MAP.new;
  const fields = [
    { label: 'Статус', value: st.label, color: st.color },
    t.description && { label: 'Описание', value: t.description, full: true },
    t.assignee_name && { label: 'Исполнитель', value: t.assignee_name },
    t.creator_name && { label: 'Создатель', value: t.creator_name },
    t.deadline && { label: 'Дедлайн', value: formatDate(t.deadline) },
    t.created_at && { label: 'Создано', value: relativeTime(t.created_at) },
  ].filter(Boolean);
  const isDone = t.status === 'done';
  return (
    <BottomSheet open={!!task} onClose={onClose} title={t.title || t.text || `Задача #${t.id}`}>
      <div className="flex flex-col gap-3 pb-4">
        {fields.map((f, i) => <div key={i}><p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5 c-tertiary">{f.label}</p>{f.color ? <span className="px-2.5 py-1 rounded-full text-[12px] font-semibold inline-block" style={{ background: `color-mix(in srgb, ${f.color} 15%, transparent)`, color: f.color }}>{f.value}</span> : <p className={`text-[14px] c-primary ${f.full ? 'whitespace-pre-wrap' : ''}`}>{f.value}</p>}</div>)}
        {!isDone && (
          <div className="flex gap-2 mt-2">
            <button onClick={() => onComplete(t.id)} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-[14px] spring-tap c-green" style={{ background: 'color-mix(in srgb, var(--green) 15%, transparent)' }}><Check size={16} /> Выполнено</button>
            <button onClick={() => onDelete(t.id)} className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-semibold text-[14px] spring-tap c-red" style={{ background: 'color-mix(in srgb, var(--red-soft) 15%, transparent)' }}><Trash2 size={16} /></button>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}

function CreateTaskAdminSheet({ open, onClose, onCreated, users }) {
  const haptic = useHaptic();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [deadline, setDeadline] = useState('');
  const [priority, setPriority] = useState('normal');
  const [saving, setSaving] = useState(false);
  const handleSubmit = async () => {
    if (!title.trim() || !assigneeId) return;
    haptic.light(); setSaving(true);
    try {
      await api.post('/tasks', { title: title.trim(), description: description || null, assignee_id: Number(assigneeId), deadline: deadline || null, priority });
      haptic.success(); setTitle(''); setDescription(''); setAssigneeId(''); setDeadline(''); setPriority('normal'); onClose(); onCreated();
    } catch {} setSaving(false);
  };
  const valid = title.trim() && assigneeId;
  return (
    <BottomSheet open={open} onClose={onClose} title="Новая задача">
      <div className="flex flex-col gap-3 pb-4">
        <div><label className="input-label">Название *</label><input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Что нужно сделать" className="input-field" /></div>
        <div><label className="input-label">Описание</label><textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Детали..." rows={2} className="input-field resize-none" /></div>
        <div><label className="input-label">Исполнитель *</label><select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="input-field appearance-none"><option value="">Выберите...</option>{users.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.login}</option>)}</select></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="input-label">Дедлайн</label><input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="input-field" /></div>
          <div><label className="input-label">Приоритет</label><select value={priority} onChange={(e) => setPriority(e.target.value)} className="input-field appearance-none"><option value="low">Низкий</option><option value="normal">Обычный</option><option value="high">Высокий</option><option value="urgent">Срочный</option></select></div>
        </div>
        <button onClick={handleSubmit} disabled={!valid || saving} className="btn-primary spring-tap mt-1">{saving ? 'Сохранение...' : 'Создать задачу'}</button>
      </div>
    </BottomSheet>
  );
}
