/**
 * MeetingDetailModal — карточка совещания: метаданные + участники + протокол + действия.
 */
import { useState, useEffect } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal, ConfirmModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { Field, TextareaInput, SelectInput, Combobox } from '@/inputs/Inputs';
import { StatusBadge } from '@/modals/Notifications';
import {
  loadOne, addMinutes, updateMinute as _updateMinute, createTaskFromMinutes, finalize,
  rsvp, updateMeeting, loadUsers, ITEM_TYPE_MAP, RSVP_MAP, STATUS_MAP, STATUS_TONES
} from './api';
import { MeetingEditModal } from './MeetingEditModal';
import './meetings.css';

function emit() { window.dispatchEvent(new CustomEvent('asgard:meetings:changed')); }

export function MeetingDetailModal({ id, onChanged }) {
  const { user } = useAuth();
  const { close, open } = useModal();
  const [data, setData] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newItem, setNewItem] = useState({ item_type: 'note', content: '', responsible_user_id: '' });
  const [finalizeText, setFinalizeText] = useState('');

  const refresh = async () => {
    setLoading(true);
    try {
      const [d, us] = await Promise.all([loadOne(id), loadUsers()]);
      setData(d);
      setUsers(us);
      setFinalizeText(d?.meeting?.minutes_text || '');
    } catch (e) {
      toast.error('Не удалось загрузить: ' + (e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [id]);

  if (loading || !data) {
    return (
      <MCard>
        <MHead title="Совещание" onClose={close} />
        <MBody><div className="t-center p-32 c-t3">⏳ Загрузка…</div></MBody>
      </MCard>
    );
  }

  const m = data.meeting;
  const participants = data.participants || [];
  const minutes = data.minutes || [];
  const role = user?.role;

  const isOrganizer = m.organizer_id === user?.id;
  const _isDir = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(role);
  const isCancelled = m.status === 'cancelled';
  const canEdit = (isOrganizer || _isDir) && (m.status === 'scheduled' || m.status === 'in_progress');
  const canFinalize = (isOrganizer || _isDir) && m.status !== 'completed' && !isCancelled;
  const canCancel = (isOrganizer || _isDir) && m.status === 'scheduled';

  const myPart = participants.find((p) => p.user_id === user?.id);
  const userOptions = users.filter((u) => u.is_active).map((u) => ({ value: String(u.id), label: u.name }));

  const onAddMinute = async () => {
    if (!newItem.content.trim()) { toast.error('Введите содержание'); return; }
    try {
      await addMinutes(id, {
        item_type: newItem.item_type,
        content: newItem.content.trim(),
        responsible_user_id: newItem.responsible_user_id ? Number(newItem.responsible_user_id) : null
      });
      setNewItem({ item_type: 'note', content: '', responsible_user_id: '' });
      emit();
      refresh();
      onChanged?.();
    } catch (e) {
      toast.error('Не удалось добавить: ' + (e?.message || e));
    }
  };

  const onCreateTask = async (itemId) => {
    try {
      await createTaskFromMinutes(id, itemId);
      toast.success('Задача создана');
      emit();
      refresh();
    } catch (e) {
      toast.error('Не удалось: ' + (e?.message || e));
    }
  };

  const onFinalize = () => open(<ConfirmModal tone="success" title="Завершить совещание?" message="Текст протокола будет сохранён, статус сменится на «Завершено»." onConfirm={async () => {
    try {
      await finalize(id, finalizeText);
      toast.success('Совещание завершено');
      emit();
      refresh();
      onChanged?.();
    } catch (e) {
      toast.error('Не удалось: ' + (e?.message || e));
    }
  }} />);

  const onRsvp = async (status) => {
    try {
      await rsvp(id, status);
      toast.success('Ответ сохранён');
      emit();
      refresh();
    } catch (e) {
      toast.error('Не удалось: ' + (e?.message || e));
    }
  };

  const onEdit = () => {
    close();
    setTimeout(() => open(<MeetingEditModal meeting={m} onSaved={() => { emit(); onChanged?.(); }} />), 30);
  };

  const onCancel = () => open(<ConfirmModal tone="danger" title="Отменить встречу?" message="Совещание будет помечено как отменённое." onConfirm={async () => {
    try {
      await updateMeeting(id, { status: 'cancelled' });
      toast.success('Встреча отменена');
      emit();
      close();
      onChanged?.();
    } catch (e) {
      toast.error('Не удалось: ' + (e?.message || e));
    }
  }} />);

  const start = m.start_time ? new Date(m.start_time) : null;
  const end = m.end_time ? new Date(m.end_time) : null;

  return (
    <MCard>
      <MHead
        icon="📅"
        title={m.title || '—'}
        subtitle={`Организатор: ${m.organizer_name || '—'}`}
        accent="gold"
        onClose={close}
      />
      <MBody>
        <div className="mb-14 u-flex gap-8">
          <StatusBadge tone={STATUS_TONES[m.status]} label={STATUS_MAP[m.status] || m.status} />
          {isCancelled && <StatusBadge tone="rejected" label="❌ Отменена" />}
        </div>

        {m.description && (
          <Section title="Описание">
            <div className="fs-13 c-t2 lh-15 u-prewrap">{m.description}</div>
          </Section>
        )}

        {m.agenda && (
          <Section title="Повестка">
            <div className="agenda-block">
              <pre className="fs-13 c-t2 lh-15 u-prewrap mtg-agenda-pre">{m.agenda}</pre>
            </div>
          </Section>
        )}

        <Section title="Когда и где">
          <div className="grid-auto-180 gap-10">
            <KV label="Дата" value={start ? start.toLocaleDateString('ru-RU') : '—'} />
            <KV label="Время" value={`${start ? start.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—'}${end ? ' — ' + end.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : ''}`} />
            {m.location && <KV label="Место" value={m.location} />}
          </div>
        </Section>

        {myPart && m.status === 'scheduled' && (
          <Section title="Мой ответ">
            <div className="u-flex gap-8">
              {['accepted', 'tentative', 'declined'].map((s) => {
                const active = myPart.rsvp_status === s;
                const cls = 'mtg-rsvp-btn' + (active ? ' mtg-rsvp-btn--active' : '');
                return (
                  <button key={s} onClick={() => onRsvp(s)} className={cls}>
                    {s === 'accepted' ? '✓ Приду' : s === 'tentative' ? '? Возможно' : '✕ Не приду'}
                  </button>
                );
              })}
            </div>
          </Section>
        )}

        <Section title={`Участники (${participants.length})`}>
          {participants.length === 0 ? (
            <div className="c-t3">Пока нет</div>
          ) : (
            <div className="col gap-4">
              {participants.map((p) => (
                <div key={p.user_id} className="row gap-10 bg-inner r-sm" style={{ padding: '6px 10px' }}>
                  <span>{rsvpIcon(p.rsvp_status)}</span>
                  <span className="flex-1 fw-600 fs-13">{p.name}</span>
                  <span className="fs-11 c-t3">{p.user_role || ''}</span>
                  <span className="fs-11 c-t3">{RSVP_MAP[p.rsvp_status] || p.rsvp_status}</span>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title={`Протокол (${minutes.length})`}>
          {minutes.length === 0 ? (
            <div className="c-t3">Протокол пуст</div>
          ) : (
            <div className="col gap-6">
              {minutes.map((mn) => (
                <div key={mn.id} className="row-spread gap-10 p-10 bg-inner r-sm">
                  <div className="flex-1">
                    <div className="fs-13">
                      <span className="fw-600">{ITEM_TYPE_MAP[mn.item_type] || mn.item_type}</span>
                      <span className="c-t3 mtg-dot">·</span>
                      {mn.content}
                    </div>
                    {mn.responsible_user_id && (
                      <div className="fs-11 c-t3 mt-2">
                        → {users.find((u) => u.id === mn.responsible_user_id)?.name || ''}
                      </div>
                    )}
                  </div>
                  {mn.item_type === 'action' && !mn.task_id && mn.responsible_user_id && (
                    <button
                      onClick={() => onCreateTask(mn.id)}
                      className="m-btn primary mtg-task-btn"
                    >→ Задача</button>
                  )}
                  {mn.task_id && (
                    <a href={`#/kanban?id=${mn.task_id}`} className="fs-11 c-gold">Задача #{mn.task_id}</a>
                  )}
                </div>
              ))}
            </div>
          )}
          {/* Add minute */}
          {m.status !== 'completed' && (
            <div className="mt-12 p-12 bg-inner r-sm">
              <div className="grid-140-1fr gap-8 mb-8">
                <SelectInput
                  value={newItem.item_type}
                  onChange={(v) => setNewItem({ ...newItem, item_type: v })}
                  options={Object.entries(ITEM_TYPE_MAP).map(([v, l]) => ({ value: v, label: l }))}
                />
                {newItem.item_type === 'action' && (
                  <Combobox
                    value={newItem.responsible_user_id}
                    onChange={(v) => setNewItem({ ...newItem, responsible_user_id: v?.value || v || '' })}
                    options={userOptions}
                    placeholder="Ответственный…"
                  />
                )}
              </div>
              <TextareaInput
                value={newItem.content}
                onChange={(v) => setNewItem({ ...newItem, content: v })}
                placeholder="Содержание пункта…"
              />
              <div className="mt-8 t-right">
                <Btn variant="primary" onClick={onAddMinute}>+ В протокол</Btn>
              </div>
            </div>
          )}
        </Section>

        {canFinalize && (
          <Section title="Завершить">
            <Field label="Резюме совещания">
              <TextareaInput value={finalizeText} onChange={setFinalizeText} placeholder="Главные итоги…" />
            </Field>
            <Btn variant="primary" onClick={onFinalize}>🏁 Завершить и сохранить</Btn>
          </Section>
        )}
      </MBody>
      <MFoot align="spread">
        <div className="u-flex gap-8">
          {canCancel && !isCancelled && <Btn variant="ghost" className="c-err" onClick={onCancel}>✕ Отменить</Btn>}
          {canEdit && <Btn variant="ghost" onClick={onEdit}>✎ Редактировать</Btn>}
        </div>
        <Btn variant="ghost" onClick={close}>Закрыть</Btn>
      </MFoot>
    </MCard>
  );
}

function rsvpIcon(s) {
  return { accepted: '✅', declined: '❌', tentative: '❓', pending: '⏳' }[s] || '⏳';
}
function Section({ title, children }) {
  return (
    <div className="mt-18 pt-14 brd-2-t">
      <div className="label-cap-lg mb-8">{title}</div>
      {children}
    </div>
  );
}
function KV({ label, value }) {
  return (
    <div>
      <div className="fs-11 c-t3 fw-700">{label}</div>
      <div className="fs-14 fw-600 mt-2">{value}</div>
    </div>
  );
}
