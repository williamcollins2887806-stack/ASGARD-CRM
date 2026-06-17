/**
 * Страница /reminders — Напоминания.
 *
 * Источник: vanilla `public/assets/js/reminders.js` (~525 строк, vanilla хранил в IndexedDB).
 * В v2 используем backend через `/api/data/reminders` (generic CRUD).
 *
 *   ✅ index.jsx — список с фильтрами + KPI + ReminderEditModal
 *
 * RBAC: все авторизованные (видят только свои).
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal, ConfirmModal } from '@/modals';
import { api } from '@/api/client';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import { SearchInput, SelectInput } from '@/inputs/Inputs';
import { useDebounce } from '@/api/useListHelpers';
import { ReminderEditModal } from './ReminderEditModal';

const TYPES = {
  deadline: { label: 'Дедлайн', icon: '⏰', color: 'var(--amber)' },
  invoice:  { label: 'Счёт',    icon: '💰', color: 'var(--err)' },
  work:     { label: 'Работа',  icon: '🔧', color: 'var(--info)' },
  tender:   { label: 'Тендер',  icon: '📋', color: 'var(--purple)' },
  custom:   { label: 'Напоминание', icon: '🔔', color: 'var(--t-2)' }
};

const PRIORITIES = {
  low:    { label: 'Низкий', color: 'var(--t-3)' },
  normal: { label: 'Обычный', color: 'var(--info)' },
  high:   { label: 'Высокий', color: 'var(--amber)' },
  urgent: { label: 'Срочный', color: 'var(--err)' }
};

export default function RemindersPage() {
  const { user } = useAuth();
  const modal = useModal();

  const [items, setItems] = useState([]);
  const [filters, setFilters] = useState({ q: '', type: '', view: 'active' });
  const dq = useDebounce(filters.q, 300);  // G-11: debounce 300мс
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    if (!user?.id) return;
    setLoading(true);
    // /api/data/reminders возвращает все записи; фильтруем на клиенте по user_id
    api(`/api/data/reminders?limit=2000`)
      .then((d) => {
        const all = d?.items || d?.rows || [];
        const mine = all.filter((r) => !r.user_id || r.user_id === user.id);
        setItems(mine);
      })
      .catch((e) => toast.error('Не удалось загрузить: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (user) refresh(); }, [user?.id]);

  useEffect(() => {
    const onChange = () => refresh();
    window.addEventListener('asgard:reminders:changed', onChange);
    return () => window.removeEventListener('asgard:reminders:changed', onChange);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const visible = useMemo(() => {
    let v = items;
    if (filters.view === 'active') v = v.filter((r) => !r.completed && !r.dismissed);
    if (filters.view === 'completed') v = v.filter((r) => r.completed);
    if (filters.view === 'dismissed') v = v.filter((r) => r.dismissed);
    if (filters.type) v = v.filter((r) => r.type === filters.type);
    if (dq.trim()) {
      const lq = dq.toLowerCase();
      v = v.filter((r) =>
        (r.title || '').toLowerCase().includes(lq) ||
        (r.description || '').toLowerCase().includes(lq)
      );
    }
    // Sort by remind_at ascending
    v = [...v].sort((a, b) => {
      const ta = new Date(a.remind_at || a.created_at || 0).getTime();
      const tb = new Date(b.remind_at || b.created_at || 0).getTime();
      return ta - tb;
    });
    return v;
  }, [items, filters.view, filters.type, dq]);

  const stats = useMemo(() => ({
    active: items.filter((r) => !r.completed && !r.dismissed).length,
    overdue: items.filter((r) => !r.completed && !r.dismissed && r.remind_at && new Date(r.remind_at).getTime() < Date.now()).length,
    completed: items.filter((r) => r.completed).length,
    urgent: items.filter((r) => !r.completed && !r.dismissed && r.priority === 'urgent').length
  }), [items]);

  const openCreate = () => modal.open(<ReminderEditModal onSaved={refresh} />);
  const openEdit = (r) => modal.open(<ReminderEditModal reminder={r} onSaved={refresh} />);

  const onComplete = async (r) => {
    try {
      await api(`/api/data/reminders/${r.id}`, {
        method: 'PUT',
        body: { ...r, completed: true, completed_at: new Date().toISOString() }
      });
      toast.success('Выполнено');
      window.dispatchEvent(new CustomEvent('asgard:reminders:changed'));
    } catch (e) {
      toast.error('Не удалось: ' + (e?.message || e));
    }
  };

  const onDismiss = async (r) => {
    try {
      await api(`/api/data/reminders/${r.id}`, {
        method: 'PUT',
        body: { ...r, dismissed: true, dismissed_at: new Date().toISOString() }
      });
      toast.success('Отклонено');
      window.dispatchEvent(new CustomEvent('asgard:reminders:changed'));
    } catch (e) {
      toast.error('Не удалось: ' + (e?.message || e));
    }
  };

  const onDelete = (r) => modal.open(<ConfirmModal tone="danger" title="Удалить напоминание?" onConfirm={async () => {
    try {
      await api(`/api/data/reminders/${r.id}`, { method: 'DELETE' });
      toast.success('Удалено');
      window.dispatchEvent(new CustomEvent('asgard:reminders:changed'));
    } catch (e) {
      toast.error('Не удалось: ' + (e?.message || e));
    }
  }} />);

  // RBAC inline-литералы (все авторизованные; ADMIN видит все, остальные — свои)
  const _hasAuth = !!user;
  const _isAdmin = ['ADMIN'].includes(user?.role);

  return (
    <div className="col gap-14">
      <TopActionsBar
        kicker="Личное"
        title="🔔 Напоминания"
        subtitle={`${visible.length} в выборке`}
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            {_hasAuth && <Btn variant="primary" onClick={openCreate}>+ Напоминание</Btn>}
          </>
        }
      />

      <div className="grid-auto-160 gap-10">
        <Stat label="Активные" value={stats.active} tone="info" />
        <Stat label="Просрочены" value={stats.overdue} tone="err" />
        <Stat label="Срочные" value={stats.urgent} tone="amber" />
        <Stat label="Выполнено" value={stats.completed} tone="ok" />
      </div>

      <div className="filter-grid-3">
        <SearchInput value={filters.q} onChange={(v) => setFilters({ ...filters, q: v })} placeholder="Поиск по заголовку или описанию…" />
        <SelectInput
          value={filters.type}
          onChange={(v) => setFilters({ ...filters, type: v })}
          options={[
            { value: '', label: 'Все типы' },
            ...Object.entries(TYPES).map(([k, v]) => ({ value: k, label: `${v.icon} ${v.label}` }))
          ]}
        />
        <SelectInput
          value={filters.view}
          onChange={(v) => setFilters({ ...filters, view: v })}
          options={[
            { value: 'active', label: '🔥 Активные' },
            { value: 'completed', label: '✓ Выполненные' },
            { value: 'dismissed', label: 'Отклонённые' },
            { value: 'all', label: 'Все' }
          ]}
        />
      </div>

      {loading ? (
        <div className="card card-empty" >⏳ Загружаем…</div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon="🔔"
          title="Напоминаний нет"
          hint="Создай первое — кнопка «+ Напоминание»."
          action={null}
        />
      ) : (
        <div className="col gap-8">
          {visible.map((r) => (
            <ReminderRow
              key={r.id}
              r={r}
              onEdit={() => openEdit(r)}
              onComplete={() => onComplete(r)}
              onDismiss={() => onDismiss(r)}
              onDelete={() => onDelete(r)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ReminderRow({ r, onEdit, onComplete, onDismiss, onDelete }) {
  const t = TYPES[r.type] || TYPES.custom;
  const p = PRIORITIES[r.priority] || PRIORITIES.normal;
  const remindAt = r.remind_at ? new Date(r.remind_at) : null;
  const isOverdue = remindAt && !r.completed && !r.dismissed && remindAt.getTime() < Date.now();
  return (
    <div style={{
      padding: 14,
      background: 'var(--card-bg)',
      border: '1px solid ' + (isOverdue ? 'var(--err)' : 'var(--brd-1)'),
      borderLeft: '4px solid ' + p.color,
      borderRadius: 'var(--r-md)',
      display: 'grid',
      gridTemplateColumns: '32px 1fr auto',
      gap: 12,
      alignItems: 'center',
      opacity: r.completed || r.dismissed ? 0.55 : 1
    }}>
      <div className="fs-22">{t.icon}</div>
      <div className="min-w-0">
        <div style={{ fontWeight: 700, fontSize: 14, textDecoration: r.completed ? 'line-through' : 'none' }}>{r.title || '—'}</div>
        {r.description && <div className="fs-12 c-t3 mt-2">{r.description}</div>}
        <div className="u-flex gap-10 mt-6 fs-11">
          <span style={{ color: t.color, fontWeight: 700 }}>{t.label}</span>
          <span style={{ color: p.color, fontWeight: 700 }}>{p.label}</span>
          {remindAt && (
            <span style={{ color: isOverdue ? 'var(--err)' : 'var(--t-3)', fontWeight: 600 }}>
              {isOverdue ? '⏰ Просрочено: ' : '🗓 '}{remindAt.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
      </div>
      <div className="u-flex gap-4">
        {!r.completed && !r.dismissed && (
          <>
            <button className="m-btn ghost px-8 py-4"  onClick={onComplete} title="Выполнить">✓</button>
            <button className="m-btn ghost px-8 py-4"  onClick={onEdit} title="Редактировать">✎</button>
            <button className="m-btn ghost py-4 px-8 c-err" onClick={onDismiss} title="Отклонить">✕</button>
          </>
        )}
        <button className="m-btn ghost py-4 px-8 c-err" onClick={onDelete} title="Удалить">🗑</button>
      </div>
    </div>
  );
}

function Stat({ label, value, _tone = 'default' }) {
  const _colors = { default: 'var(--t-1)', ok: 'var(--ok)', info: 'var(--info)', amber: 'var(--amber)', err: 'var(--err)' };
  return (
    <div className="bg-inner r-md p-14">
      <div className="mini-kpi-label">{label}</div>
      <div className="mini-kpi-value">{value}</div>
    </div>
  );
}
