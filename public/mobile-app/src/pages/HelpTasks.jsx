/**
 * Мобильная страница «🤝 Помощь коллеги» (модуль help-tasks).
 *
 * Backend: src/routes/tasks.js (расширен V212):
 *   GET /api/tasks/help/inbox|outbox|watching|stats
 *   POST /api/tasks {task_kind:'help'}
 *   PUT /:id/{accept|decline|redirect|reassign|escalate|complete}
 *
 * Чат: переход на /chat/:chatId (существующая страница, c task_card pinned).
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { StatusBadge } from '@/components/shared/StatusBadge';
import {
  Handshake, Inbox, Send, Eye, Plus, User, Clock, Flag, Check, X,
  CornerUpRight, MessageSquare, Shield, RotateCw, AlertTriangle, Search
} from 'lucide-react';
import { formatDate, relativeTime } from '@/lib/utils';

const PRIORITY = {
  urgent: { label: '🔥 Горит', color: '#ff7575', bg: 'rgba(255,69,58,0.12)' },
  high:   { label: '⚠️ Важно', color: '#d4a017', bg: 'rgba(200,168,78,0.12)' },
  normal: { label: 'Обычно',   color: '#6a9fd4', bg: 'rgba(74,144,217,0.12)' },
  low:    { label: 'Низкий',   color: '#909090', bg: 'rgba(142,142,147,0.10)' }
};
const STATUS_LABEL = {
  new:'Новая', accepted:'Принята', in_progress:'В работе',
  done:'Завершена', declined:'Отказ', overdue:'Просрочена', cancelled:'Отменена'
};
const ROLE_LABELS = {
  ADMIN:'Админ', PM:'РП', HEAD_PM:'Глава РП', TO:'ТО', HEAD_TO:'Глава ТО',
  PROC:'Закупки', BUH:'Бухгалтерия', HR:'Кадры', HR_MANAGER:'Глава кадров',
  WAREHOUSE:'Склад', CHIEF_ENGINEER:'Гл. инженер', OFFICE_MANAGER:'Офис-менеджер',
  DIRECTOR_GEN:'Ген. директор', DIRECTOR_COMM:'Ком. директор', DIRECTOR_DEV:'Дир. развития'
};
const DECLINE_PRESETS = [
  'Сильно загружен срочной работой',
  'Не моя зона — лучше к коллеге',
  'Не хватает информации',
  'Сейчас в отпуске / на объекте'
];

function timeLeft(deadline) {
  if (!deadline) return null;
  const diff = new Date(deadline) - Date.now();
  if (diff < 0) {
    const past = Math.floor(-diff / 3600000);
    return { overdue: true, label: past < 24 ? `просрочено ${past}ч назад` : `просрочено ${Math.floor(past/24)}д назад` };
  }
  const h = Math.floor(diff / 3600000);
  if (h < 1)  return { hot: true, label: `${Math.max(1, Math.floor(diff/60000))} мин` };
  if (h < 24) return { hot: h < 4, label: `${h} ч` };
  return { label: `${Math.floor(h/24)} д` };
}

// ─── Карточка задачи ─────────────────────────────────────────────
function HelpCard({ task, mode, onOpen, delay }) {
  const p = PRIORITY[task.priority] || PRIORITY.normal;
  const tl = timeLeft(task.deadline);
  const counterpart = mode === 'inbox' ? task.creator_name : task.assignee_name;
  const role = mode === 'inbox' ? task.creator_role : task.assignee_role;

  return (
    <button
      onClick={onOpen}
      className="w-full text-left rounded-2xl spring-tap"
      style={{
        background: 'color-mix(in srgb, var(--bg-surface) 92%, transparent)',
        border: task.priority === 'urgent'
          ? '0.5px solid rgba(192,69,69,0.45)'
          : '0.5px solid var(--border-norse)',
        padding: '14px 16px',
        animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${delay}ms both`
      }}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full"
              style={{ color: p.color, background: p.bg }}>
          <Flag size={10}/> {p.label}
        </span>
        <StatusBadge status={STATUS_LABEL[task.status] || task.status} size="xs"/>
        {tl && (
          <span className="text-[11px] font-medium"
                style={{ color: tl.overdue ? '#e08585' : tl.hot ? '#d4a017' : 'var(--text-tertiary)' }}>
            <Clock size={10} className="inline mr-1"/>{tl.label}
          </span>
        )}
      </div>

      <p className="text-[15px] font-semibold leading-snug mb-2" style={{ color:'var(--text-primary)' }}>
        {task.title}
      </p>

      {task.description && (
        <p className="text-[12px] leading-snug mb-2" style={{ color:'var(--text-tertiary)' }}>
          {String(task.description).slice(0, 110)}{task.description.length > 110 ? '…' : ''}
        </p>
      )}

      <div className="flex items-center gap-3 flex-wrap text-[11px]" style={{ color:'var(--text-tertiary)' }}>
        {counterpart && (
          <span className="flex items-center gap-1">
            <User size={10}/> {counterpart} · {ROLE_LABELS[role] || role || ''}
          </span>
        )}
        {task.redirected_once && <span>↪️ перенаправлено</span>}
        {parseInt(task.watchers_count) > 0 && <span>👁 +{task.watchers_count}</span>}
        {parseInt(task.messages_count) > 0 && <span>💬 {task.messages_count}</span>}
      </div>

      {task.declined_reason && task.status === 'declined' && (
        <div className="mt-2 px-2 py-1.5 rounded-lg text-[11px]"
             style={{ background:'rgba(192,69,69,0.08)', color:'#d49595' }}>
          ❌ {task.declined_reason}
        </div>
      )}
    </button>
  );
}

// ─── Лист деталей + действия ─────────────────────────────────────
function HelpDetail({ task, onClose, onRefresh, currentUser, users }) {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const [view, setView]  = useState('main'); // main | decline | redirect | reassign | escalate | complete
  const [busy, setBusy]  = useState(false);
  const [reason, setReason] = useState('');
  const [newId, setNewId]   = useState('');
  const [comment, setComment] = useState('');

  if (!task) return null;

  const me = currentUser?.id;
  const isMine = task.assignee_id === me;
  const isCreator = task.creator_id === me;
  const p = PRIORITY[task.priority] || PRIORITY.normal;

  // Кнопки в зависимости от состояния
  const showAccept   = isMine && task.status === 'new';
  const showComplete = isMine && ['accepted','in_progress'].includes(task.status);
  const showDecline  = isMine && ['new','accepted','in_progress'].includes(task.status);
  const showRedirect = isMine && ['new','accepted','in_progress'].includes(task.status) && !task.redirected_once;
  const showReassign = isCreator && task.status === 'declined';
  const showEscalate = isCreator && task.status === 'declined';

  const usersFiltered = users.filter(u =>
    u.is_active !== false && u.id !== me && u.id !== task.creator_id && u.id !== task.assignee_id
  );

  const onAccept = async () => {
    haptic.light(); setBusy(true);
    try { await api.put(`/tasks/${task.id}/accept`); haptic.success(); onRefresh(); onClose(); }
    catch (e) { haptic.error?.(); }
    finally { setBusy(false); }
  };

  const onComplete = async () => {
    haptic.light(); setBusy(true);
    try { await api.put(`/tasks/${task.id}/complete`, { comment: comment.trim() || null });
          haptic.success(); onRefresh(); onClose(); }
    catch (e) { haptic.error?.(); }
    finally { setBusy(false); }
  };

  const onDecline = async () => {
    if (reason.trim().length < 5) { haptic.error?.(); return; }
    haptic.light(); setBusy(true);
    try { await api.put(`/tasks/${task.id}/decline`, { reason: reason.trim() });
          haptic.success(); onRefresh(); onClose(); }
    catch (e) { haptic.error?.(); }
    finally { setBusy(false); }
  };

  const onRedirect = async () => {
    if (!newId || reason.trim().length < 5) { haptic.error?.(); return; }
    haptic.light(); setBusy(true);
    try { await api.put(`/tasks/${task.id}/redirect`,
                        { new_assignee_id: Number(newId), reason: reason.trim() });
          haptic.success(); onRefresh(); onClose(); }
    catch (e) { haptic.error?.(); }
    finally { setBusy(false); }
  };

  const onReassign = async () => {
    if (!newId) { haptic.error?.(); return; }
    haptic.light(); setBusy(true);
    try { await api.put(`/tasks/${task.id}/reassign`, { new_assignee_id: Number(newId) });
          haptic.success(); onRefresh(); onClose(); }
    catch (e) { haptic.error?.(); }
    finally { setBusy(false); }
  };

  const onEscalate = async () => {
    haptic.light(); setBusy(true);
    try { await api.put(`/tasks/${task.id}/escalate`);
          haptic.success(); onRefresh(); onClose(); }
    catch (e) { haptic.error?.(); }
    finally { setBusy(false); }
  };

  // ── РЕНДЕР ─────────────────────────────────────────────────
  let content;
  if (view === 'main') {
    content = (
      <div className="flex flex-col gap-3 pb-6">
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={STATUS_LABEL[task.status] || task.status}/>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full"
                style={{ color:p.color, background:p.bg }}>
            <Flag size={10}/> {p.label}
          </span>
        </div>

        <p className="text-[13px] leading-relaxed" style={{ color:'var(--text-secondary)' }}>
          {task.description || <i style={{ opacity:.5 }}>Без описания</i>}
        </p>

        <div className="rounded-2xl overflow-hidden"
             style={{ background:'var(--bg-surface)', border:'0.5px solid var(--border-norse)' }}>
          {[
            { label:'От',          value:`${task.creator_name || '—'} · ${ROLE_LABELS[task.creator_role]||task.creator_role||''}`, icon:User },
            { label:'Исполнитель', value:`${task.assignee_name || '—'} · ${ROLE_LABELS[task.assignee_role]||task.assignee_role||''}`, icon:User },
            task.deadline && { label:'Срок',  value:formatDate(task.deadline), icon:Clock },
            task.created_at && { label:'Создана', value:relativeTime(task.created_at), icon:Clock }
          ].filter(Boolean).map((r, i, arr) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3"
                 style={{ borderBottom: i < arr.length-1 ? '0.5px solid var(--border-norse)' : 'none' }}>
              <r.icon size={14} style={{ color:'var(--text-tertiary)', flexShrink:0 }}/>
              <span className="text-[12px]" style={{ color:'var(--text-tertiary)' }}>{r.label}</span>
              <span className="text-[13px] font-medium ml-auto" style={{ color:'var(--text-primary)' }}>{r.value}</span>
            </div>
          ))}
        </div>

        {task.declined_reason && task.status === 'declined' && (
          <div className="px-3 py-2 rounded-xl text-[12px]"
               style={{ background:'rgba(192,69,69,0.08)', color:'#d49595', border:'0.5px solid rgba(192,69,69,0.25)' }}>
            <b>❌ Отказ:</b> {task.declined_reason}
          </div>
        )}

        {Array.isArray(task.files) && task.files.length > 0 && (
          <div className="text-[12px]" style={{ color:'var(--text-tertiary)' }}>
            📎 Файлов: {task.files.length}
          </div>
        )}

        {/* Действия */}
        <div className="flex flex-col gap-2 mt-2">
          {showAccept && (
            <button disabled={busy} onClick={onAccept}
                    className="rounded-xl py-3 spring-tap flex items-center justify-center gap-2"
                    style={{ background:'#4a7d3a', color:'#fff' }}>
              <Check size={16}/> Принять задачу
            </button>
          )}
          {showComplete && (
            <button onClick={() => { setComment(''); setView('complete'); }}
                    className="rounded-xl py-3 spring-tap flex items-center justify-center gap-2"
                    style={{ background:'#4a7d3a', color:'#fff' }}>
              <Check size={16}/> Завершить
            </button>
          )}
          {showDecline && (
            <button onClick={() => { setReason(''); setView('decline'); }}
                    className="rounded-xl py-3 spring-tap flex items-center justify-center gap-2"
                    style={{ background:'rgba(192,69,69,0.18)', color:'#e08585', border:'0.5px solid rgba(192,69,69,0.5)' }}>
              <X size={16}/> Отказаться
            </button>
          )}
          {showRedirect && (
            <button onClick={() => { setReason(''); setNewId(''); setView('redirect'); }}
                    className="rounded-xl py-3 spring-tap flex items-center justify-center gap-2"
                    style={{ background:'rgba(74,125,200,0.15)', color:'#80a8d8', border:'0.5px solid rgba(74,125,200,0.45)' }}>
              <CornerUpRight size={16}/> Перенаправить (1 раз)
            </button>
          )}
          {showReassign && (
            <button onClick={() => { setNewId(''); setView('reassign'); }}
                    className="rounded-xl py-3 spring-tap flex items-center justify-center gap-2"
                    style={{ background:'#4a7d3a', color:'#fff' }}>
              <RotateCw size={16}/> Переназначить
            </button>
          )}
          {showEscalate && (
            <button onClick={() => setView('escalate')}
                    className="rounded-xl py-3 spring-tap flex items-center justify-center gap-2"
                    style={{ background:'rgba(212,160,23,0.18)', color:'#e8c060', border:'0.5px solid rgba(212,160,23,0.55)' }}>
              <Shield size={16}/> Эскалировать руководителю
            </button>
          )}
          {task.chat_id && (
            <button onClick={() => { onClose(); navigate(`/chat/${task.chat_id}`); }}
                    className="rounded-xl py-3 spring-tap flex items-center justify-center gap-2"
                    style={{ background:'rgba(160,120,196,0.15)', color:'#b89ad4', border:'0.5px solid rgba(160,120,196,0.4)' }}>
              <MessageSquare size={16}/> Чат Хугинна
            </button>
          )}
        </div>
      </div>
    );
  } else if (view === 'decline') {
    content = (
      <div className="flex flex-col gap-3 pb-6">
        <p className="text-[13px]" style={{ color:'var(--text-secondary)' }}>
          Создатель получит уведомление и сможет переназначить или эскалировать руководителю отдела.
        </p>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)}
                  placeholder="Причина (мин. 5 символов)…" rows={4}
                  className="rounded-xl p-3 text-[14px]"
                  style={{ background:'var(--bg-surface)', border:'0.5px solid var(--border-norse)', color:'var(--text-primary)' }}/>
        <div className="flex flex-wrap gap-1.5">
          {DECLINE_PRESETS.map(r => (
            <button key={r} onClick={() => setReason(r)}
                    className="text-[12px] px-3 py-1.5 rounded-full spring-tap"
                    style={{ background:'rgba(196,160,98,0.08)', color:'var(--text-secondary)', border:'0.5px solid rgba(196,160,98,0.25)' }}>
              {r}
            </button>
          ))}
        </div>
        <div className="flex gap-2 mt-2">
          <button onClick={() => setView('main')} className="flex-1 py-3 rounded-xl"
                  style={{ background:'var(--bg-surface)', color:'var(--text-secondary)' }}>Назад</button>
          <button disabled={busy || reason.trim().length < 5} onClick={onDecline}
                  className="flex-1 py-3 rounded-xl"
                  style={{ background: reason.trim().length>=5?'#c04545':'rgba(192,69,69,0.3)', color:'#fff', opacity: busy?0.5:1 }}>
            Отправить отказ
          </button>
        </div>
      </div>
    );
  } else if (view === 'redirect') {
    content = (
      <div className="flex flex-col gap-3 pb-6">
        <div className="px-3 py-2 rounded-xl text-[12px]"
             style={{ background:'rgba(212,160,23,0.07)', borderLeft:'3px solid rgba(212,160,23,0.55)', color:'#e8c060' }}>
          ⚠️ Перенаправление возможно <b>только один раз</b>. Дальше — выполни или откажись.
        </div>
        <UserSelect users={usersFiltered} value={newId} onChange={setNewId} placeholder="Кому передать"/>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)}
                  placeholder="Почему именно ему (мин. 5 символов)…" rows={3}
                  className="rounded-xl p-3 text-[14px]"
                  style={{ background:'var(--bg-surface)', border:'0.5px solid var(--border-norse)', color:'var(--text-primary)' }}/>
        <p className="text-[12px]" style={{ color:'var(--text-tertiary)' }}>
          Ты останешься <b>наблюдателем</b> — сможешь следить и помогать.
        </p>
        <div className="flex gap-2 mt-2">
          <button onClick={() => setView('main')} className="flex-1 py-3 rounded-xl"
                  style={{ background:'var(--bg-surface)', color:'var(--text-secondary)' }}>Назад</button>
          <button disabled={busy || !newId || reason.trim().length < 5} onClick={onRedirect}
                  className="flex-1 py-3 rounded-xl"
                  style={{ background: (newId && reason.trim().length>=5)?'#4a6da0':'rgba(74,125,200,0.3)', color:'#fff', opacity: busy?0.5:1 }}>
            ↪️ Перенаправить
          </button>
        </div>
      </div>
    );
  } else if (view === 'reassign') {
    content = (
      <div className="flex flex-col gap-3 pb-6">
        <div className="px-3 py-2 rounded-xl text-[12px]"
             style={{ background:'rgba(212,160,23,0.07)', borderLeft:'3px solid rgba(212,160,23,0.55)', color:'#e8c060' }}>
          Предыдущий исполнитель отказался: <b>«{task.declined_reason}»</b>
        </div>
        <UserSelect users={usersFiltered} value={newId} onChange={setNewId} placeholder="Новый исполнитель"/>
        <div className="flex gap-2 mt-2">
          <button onClick={() => setView('main')} className="flex-1 py-3 rounded-xl"
                  style={{ background:'var(--bg-surface)', color:'var(--text-secondary)' }}>Назад</button>
          <button disabled={busy || !newId} onClick={onReassign}
                  className="flex-1 py-3 rounded-xl"
                  style={{ background: newId?'#4a7d3a':'rgba(74,125,58,0.3)', color:'#fff' }}>
            ✓ Назначить
          </button>
        </div>
      </div>
    );
  } else if (view === 'escalate') {
    content = (
      <div className="flex flex-col gap-3 pb-6">
        <div className="px-3 py-2 rounded-xl text-[13px]"
             style={{ background:'rgba(212,160,23,0.07)', borderLeft:'3px solid rgba(212,160,23,0.55)', color:'#e8c060' }}>
          Задача будет перенаправлена <b>руководителю отдела</b> прошлого исполнителя с пометкой «эскалация».
        </div>
        <div className="flex gap-2 mt-2">
          <button onClick={() => setView('main')} className="flex-1 py-3 rounded-xl"
                  style={{ background:'var(--bg-surface)', color:'var(--text-secondary)' }}>Назад</button>
          <button disabled={busy} onClick={onEscalate}
                  className="flex-1 py-3 rounded-xl"
                  style={{ background:'#d4a017', color:'#1a1410', fontWeight:600 }}>
            🛡 Эскалировать
          </button>
        </div>
      </div>
    );
  } else if (view === 'complete') {
    content = (
      <div className="flex flex-col gap-3 pb-6">
        <p className="text-[13px]" style={{ color:'var(--text-secondary)' }}>Что сделано, где результат — будет видно создателю и наблюдателям.</p>
        <textarea value={comment} onChange={(e) => setComment(e.target.value)}
                  placeholder="Комментарий о результате (необязательно)…" rows={3}
                  className="rounded-xl p-3 text-[14px]"
                  style={{ background:'var(--bg-surface)', border:'0.5px solid var(--border-norse)', color:'var(--text-primary)' }}/>
        <p className="text-[12px]" style={{ color:'var(--text-tertiary)' }}>
          После завершения чат <b>архивируется</b> (read-only).
        </p>
        <div className="flex gap-2 mt-2">
          <button onClick={() => setView('main')} className="flex-1 py-3 rounded-xl"
                  style={{ background:'var(--bg-surface)', color:'var(--text-secondary)' }}>Назад</button>
          <button disabled={busy} onClick={onComplete}
                  className="flex-1 py-3 rounded-xl"
                  style={{ background:'#4a7d3a', color:'#fff' }}>
            ✅ Завершить
          </button>
        </div>
      </div>
    );
  }

  return (
    <BottomSheet open={!!task} onClose={onClose} title={task.title}>
      {content}
    </BottomSheet>
  );
}

// ─── Селект сотрудника с поиском ─────────────────────────────────
function UserSelect({ users, value, onChange, placeholder='Выбери' }) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const norm = q.trim().toLowerCase();
    if (!norm) return users.slice(0, 50);
    return users.filter(u => `${u.name||u.login} ${ROLE_LABELS[u.role]||u.role}`.toLowerCase().includes(norm)).slice(0, 50);
  }, [users, q]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
           style={{ background:'var(--bg-surface)', border:'0.5px solid var(--border-norse)' }}>
        <Search size={14} style={{ color:'var(--text-tertiary)' }}/>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder}
               className="flex-1 bg-transparent text-[14px] outline-none"
               style={{ color:'var(--text-primary)' }}/>
      </div>
      <div className="max-h-[280px] overflow-y-auto rounded-xl"
           style={{ background:'var(--bg-surface)', border:'0.5px solid var(--border-norse)' }}>
        {filtered.map(u => (
          <button key={u.id} onClick={() => onChange(u.id)}
                  className="w-full text-left px-3 py-2.5 flex items-center justify-between gap-2 spring-tap"
                  style={{ background: value === u.id ? 'rgba(74,125,58,0.12)' : 'transparent',
                           borderBottom:'0.5px solid var(--border-norse)' }}>
            <div className="flex flex-col">
              <span className="text-[14px]" style={{ color:'var(--text-primary)' }}>{u.name || u.login}</span>
              <span className="text-[11px]" style={{ color:'var(--text-tertiary)' }}>{ROLE_LABELS[u.role] || u.role}</span>
            </div>
            {value === u.id && <Check size={16} style={{ color:'#4a7d3a' }}/>}
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="text-center text-[12px] py-4" style={{ color:'var(--text-tertiary)' }}>
            Никого не нашли
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Создание задачи ─────────────────────────────────────────────
function CreateModal({ open, onClose, onCreated, users, currentUser }) {
  const haptic = useHaptic();
  const [step, setStep] = useState(1); // 1=кому, 2=что, 3=когда
  const [assigneeId, setAssigneeId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [deadline, setDeadline] = useState('');
  const [priority, setPriority] = useState('normal');
  const [busy, setBusy] = useState(false);

  const reset = () => { setStep(1); setAssigneeId(''); setTitle(''); setDescription(''); setDeadline(''); setPriority('normal'); };

  const handleClose = () => { reset(); onClose(); };

  const submit = async () => {
    if (!assigneeId || title.trim().length < 3) { haptic.error?.(); return; }
    setBusy(true);
    try {
      await api.post('/tasks', {
        task_kind: 'help',
        assignee_id: Number(assigneeId),
        title: title.trim(),
        description: description.trim() || null,
        deadline: deadline ? new Date(deadline).toISOString() : null,
        priority
      });
      haptic.success();
      reset(); onCreated(); onClose();
    } catch (e) { haptic.error?.(); }
    finally { setBusy(false); }
  };

  const applyDeadline = (h) => {
    const d = new Date(Date.now() + h * 3600000);
    const off = d.getTimezoneOffset();
    const local = new Date(d.getTime() - off * 60000);
    setDeadline(local.toISOString().slice(0, 16));
  };

  const usersFiltered = users.filter(u => u.is_active !== false && u.id !== currentUser?.id);

  return (
    <BottomSheet open={open} onClose={handleClose} title="🤝 Попросить помощи">
      <div className="flex flex-col gap-3 pb-6">
        {/* Шаги */}
        <div className="flex items-center gap-2 text-[11px]" style={{ color:'var(--text-tertiary)' }}>
          {[1,2,3].map(n => (
            <div key={n} className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full inline-flex items-center justify-center font-semibold"
                    style={{ background: step >= n ? '#c4a062':'var(--bg-surface)', color: step >= n ? '#1a1410':'var(--text-tertiary)' }}>{n}</span>
              <span style={{ color: step === n ? 'var(--text-primary)' : 'inherit' }}>
                {n === 1 ? 'Кому' : n === 2 ? 'О чём' : 'Когда'}
              </span>
              {n < 3 && <span style={{ opacity:.3 }}>→</span>}
            </div>
          ))}
        </div>

        {step === 1 && (
          <>
            <UserSelect users={usersFiltered} value={assigneeId} onChange={setAssigneeId} placeholder="Имя или роль…"/>
            <button disabled={!assigneeId} onClick={() => setStep(2)}
                    className="rounded-xl py-3 mt-2"
                    style={{ background: assigneeId ? '#c4a062':'rgba(196,160,98,0.3)', color:'#1a1410', fontWeight:600 }}>
              Дальше →
            </button>
          </>
        )}

        {step === 2 && (
          <>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={255}
                   placeholder="Кратко: что нужно сделать"
                   className="rounded-xl px-3 py-3 text-[15px]"
                   style={{ background:'var(--bg-surface)', border:'0.5px solid var(--border-norse)', color:'var(--text-primary)' }}/>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                      placeholder="Подробности (необязательно)" rows={4}
                      className="rounded-xl px-3 py-3 text-[14px]"
                      style={{ background:'var(--bg-surface)', border:'0.5px solid var(--border-norse)', color:'var(--text-primary)' }}/>
            <div className="flex gap-2">
              <button onClick={() => setStep(1)} className="flex-1 py-3 rounded-xl"
                      style={{ background:'var(--bg-surface)', color:'var(--text-secondary)' }}>Назад</button>
              <button disabled={title.trim().length < 3} onClick={() => setStep(3)}
                      className="flex-1 py-3 rounded-xl"
                      style={{ background: title.trim().length>=3 ? '#c4a062':'rgba(196,160,98,0.3)', color:'#1a1410', fontWeight:600 }}>
                Дальше →
              </button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div className="text-[12px] font-semibold" style={{ color:'var(--text-secondary)' }}>Срок</div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { h:2,  label:'🔥 2 часа' },
                { h:6,  label:'⏰ К концу дня' },
                { h:24, label:'📅 Завтра' },
                { h:72, label:'📆 3 дня' }
              ].map(p => (
                <button key={p.h} onClick={() => applyDeadline(p.h)}
                        className="rounded-xl py-2.5 text-[13px]"
                        style={{ background:'var(--bg-surface)', border:'0.5px solid var(--border-norse)', color:'var(--text-secondary)' }}>
                  {p.label}
                </button>
              ))}
            </div>
            <input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)}
                   className="rounded-xl px-3 py-2.5 text-[14px]"
                   style={{ background:'var(--bg-surface)', border:'0.5px solid var(--border-norse)', color:'var(--text-primary)' }}/>

            <div className="text-[12px] font-semibold mt-2" style={{ color:'var(--text-secondary)' }}>Приоритет</div>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(PRIORITY).map(([k, p]) => (
                <button key={k} onClick={() => setPriority(k)}
                        className="rounded-xl py-2.5 text-[13px] font-medium"
                        style={{
                          background: priority === k ? p.bg : 'var(--bg-surface)',
                          border: priority === k ? `1px solid ${p.color}` : '0.5px solid var(--border-norse)',
                          color: priority === k ? p.color : 'var(--text-secondary)'
                        }}>
                  {p.label}
                </button>
              ))}
            </div>

            <div className="text-[11px] mt-2 px-3 py-2 rounded-xl"
                 style={{ background:'rgba(74,125,200,0.07)', color:'var(--text-tertiary)', borderLeft:'3px solid rgba(74,125,200,0.4)' }}>
              После отправки создастся чат в Хугинне с участниками.
            </div>

            <div className="flex gap-2">
              <button onClick={() => setStep(2)} className="flex-1 py-3 rounded-xl"
                      style={{ background:'var(--bg-surface)', color:'var(--text-secondary)' }}>Назад</button>
              <button disabled={busy} onClick={submit} className="flex-1 py-3 rounded-xl"
                      style={{ background:'#c4a062', color:'#1a1410', fontWeight:600, opacity: busy ? 0.5 : 1 }}>
                {busy ? 'Отправляем…' : '🤝 Попросить'}
              </button>
            </div>
          </>
        )}
      </div>
    </BottomSheet>
  );
}

// ─── Главный компонент ───────────────────────────────────────────
const TABS = [
  { id:'inbox',    label:'Входящие',    icon: Inbox },
  { id:'outbox',   label:'Отправленные', icon: Send },
  { id:'watching', label:'Наблюдаю',    icon: Eye }
];

export default function HelpTasksPage() {
  const { user } = useAuthStore();
  const haptic = useHaptic();
  const [tab, setTab] = useState('inbox');
  const [inbox, setInbox]       = useState([]);
  const [outbox, setOutbox]     = useState([]);
  const [watching, setWatching] = useState([]);
  const [stats, setStats]       = useState({});
  const [users, setUsers]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [opened, setOpened]     = useState(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [i, o, w, s] = await Promise.all([
        api.get('/tasks/help/inbox').then(r => r.tasks || []).catch(() => []),
        api.get('/tasks/help/outbox').then(r => r.tasks || []).catch(() => []),
        api.get('/tasks/help/watching').then(r => r.tasks || []).catch(() => []),
        api.get('/tasks/help/stats').catch(() => ({}))
      ]);
      setInbox(i); setOutbox(o); setWatching(w); setStats(s);
    } finally { setLoading(false); }
  }, []);

  const loadUsers = useCallback(async () => {
    try {
      const r = await api.get('/users?is_active=true&limit=500');
      setUsers(r.users || []);
    } catch (e) { setUsers([]); }
  }, []);

  useEffect(() => { if (user?.id) { load(); loadUsers(); } }, [user?.id, load, loadUsers]);

  const list = tab === 'inbox' ? inbox : tab === 'outbox' ? outbox : watching;
  const sorted = useMemo(() => {
    const pr = { urgent:0, high:1, normal:2, low:3 };
    return [...list].sort((a, b) => {
      const pa = pr[a.priority] ?? 2, pb = pr[b.priority] ?? 2;
      if (pa !== pb) return pa - pb;
      return (a.deadline ? +new Date(a.deadline) : Infinity) - (b.deadline ? +new Date(b.deadline) : Infinity);
    });
  }, [list]);

  const inboxNew = parseInt(stats.inbox_new || 0);
  const outDecl  = parseInt(stats.outbox_declined || 0);

  return (
    <PageShell
      title="🤝 Помощь коллеги"
      subtitle={inboxNew > 0 ? `📥 ${inboxNew} новых · ${stats.inbox_active || 0} в работе` : 'Любой → любому'}
      rightAction={
        <button onClick={() => { haptic.light(); setCreateOpen(true); }}
                className="rounded-full p-2 spring-tap"
                style={{ background:'#c4a062', color:'#1a1410' }}>
          <Plus size={20}/>
        </button>
      }
    >
      <PullToRefresh onRefresh={load}>
        {/* Табы */}
        <div className="flex gap-1 px-2 py-2 sticky top-0 z-10"
             style={{ background:'var(--bg-primary)', borderBottom:'0.5px solid var(--border-norse)' }}>
          {TABS.map(t => {
            const count = t.id === 'inbox' ? inbox.length : t.id === 'outbox' ? outbox.length : watching.length;
            const badge = t.id === 'inbox' && inboxNew > 0 ? inboxNew : (t.id === 'outbox' && outDecl > 0 ? outDecl : null);
            return (
              <button key={t.id} onClick={() => { haptic.light(); setTab(t.id); }}
                      className="flex-1 py-2 rounded-xl flex flex-col items-center gap-0.5 spring-tap"
                      style={{ background: tab === t.id ? 'rgba(196,160,98,0.15)' : 'transparent', color: tab === t.id ? '#c4a062' : 'var(--text-secondary)' }}>
                <div className="flex items-center gap-1.5">
                  <t.icon size={14}/>
                  <span className="text-[12px] font-semibold">{t.label}</span>
                  {badge && (
                    <span className="text-[10px] font-bold px-1.5 rounded-full"
                          style={{ background:'#c04545', color:'#fff' }}>{badge}</span>
                  )}
                </div>
                <span className="text-[10px]" style={{ opacity:.6 }}>{count}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-2 p-3">
          {loading ? (
            <SkeletonList count={4}/>
          ) : sorted.length === 0 ? (
            <EmptyState
              icon={Handshake}
              title={tab === 'inbox' ? 'Никто пока не просил' : tab === 'outbox' ? 'Ты ещё ни о чём не просил' : 'Ты ни за чем не наблюдаешь'}
              description={tab === 'outbox' ? 'Нажми + чтобы попросить помощи' : 'Когда коллеги попросят твоей помощи — появится здесь'}
            />
          ) : (
            sorted.map((t, i) => (
              <HelpCard key={t.id} task={t} mode={tab} delay={i * 40}
                        onOpen={() => { haptic.light(); setOpened(t); }}/>
            ))
          )}
        </div>
      </PullToRefresh>

      <HelpDetail task={opened} onClose={() => setOpened(null)} onRefresh={load}
                  currentUser={user} users={users}/>

      <CreateModal open={createOpen} onClose={() => setCreateOpen(false)}
                   onCreated={load} users={users} currentUser={user}/>
    </PageShell>
  );
}
