/**
 * Модалки действий: Decline / Redirect / Reassign / Escalate / Complete.
 * Все компактные — общий MCard паттерн.
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field, Textarea } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { UserPicker } from './UserPicker';
import { declineTask, redirectTask, reassignTask, escalateTask, completeTask, rateTask, DECLINE_REASONS } from './api';

// ─── DECLINE ─────────────────────────────────────────────────────
export function DeclineModal({ task, onDone }) {
  const { close } = useModal();
  const [reason, setReason] = useState('');
  const [busy, setBusy]     = useState(false);

  const valid = reason.trim().length >= 5;

  const submit = async () => {
    if (!valid) { toast.warn('Укажите причину (мин. 5 символов)'); return; }
    setBusy(true);
    try {
      await declineTask(task.id, reason.trim());
      toast.success('Отказ отправлен — создатель получит уведомление');
      onDone?.(); close();
    } catch (e) { toast.error('Ошибка: ' + (e?.message || e)); }
    finally { setBusy(false); }
  };

  return (
    <MCard>
      <MHead icon="❌" title="Отказаться от задачи" subtitle={task.title} accent="warning" onClose={close} />
      <MBody>
        <Field label="Причина отказа" required help="Создатель её увидит и сможет переназначить или эскалировать">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)}
                    placeholder="Например: «Сейчас сильно загружен срочным тендером»"
                    rows={4} autoFocus />
        </Field>
        <div className="help-preset-list">
          {DECLINE_REASONS.map(r => (
            <button key={r} type="button" className="help-preset-chip" onClick={() => setReason(r)}>
              {r}
            </button>
          ))}
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Назад</Btn>
        <Btn variant="primary" disabled={busy || !valid} onClick={submit}>
          {busy ? 'Отправляем…' : 'Отправить отказ'}
        </Btn>
      </MFoot>
    </MCard>
  );
}

// ─── REDIRECT ────────────────────────────────────────────────────
export function RedirectModal({ task, currentUser, onDone }) {
  const { close } = useModal();
  const [newId, setNewId] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy]   = useState(false);

  const valid = !!newId && reason.trim().length >= 5;

  const submit = async () => {
    if (!valid) { toast.warn('Выберите кому передать и укажите причину'); return; }
    setBusy(true);
    try {
      await redirectTask(task.id, Number(newId), reason.trim());
      toast.success('Задача перенаправлена');
      onDone?.(); close();
    } catch (e) {
      if (String(e?.message || '').match(/уже перенаправляли/i)) {
        toast.error('Эту задачу уже перенаправляли. Откажитесь — создатель перевыдаст сам.');
      } else {
        toast.error('Ошибка: ' + (e?.message || e));
      }
    } finally { setBusy(false); }
  };

  return (
    <MCard>
      <MHead icon="↪️" title="Перенаправить задачу" subtitle={task.title} accent="info" onClose={close} />
      <MBody>
        <div className="help-warn-banner">
          ⚠️ Перенаправление возможно <b>только один раз</b>. Дальше — либо ты выполняешь, либо отказываешься (тогда создатель сам перевыдаст).
        </div>

        <Field label="Кому передать" required>
          <UserPicker value={newId} onChange={setNewId}
                      exclude={[currentUser?.id, task.creator_id]}
                      placeholder="Выбери коллегу, который лучше разбирается" />
        </Field>

        <Field label="Почему именно ему" required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)}
                    placeholder="«Это его компетенция — он работал с этим объектом раньше»"
                    rows={3} />
        </Field>

        <div className="help-explainer">
          Ты останешься <b>наблюдателем</b> в чате — сможешь следить и помогать.
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Назад</Btn>
        <Btn variant="primary" disabled={busy || !valid} onClick={submit}>
          {busy ? 'Передаём…' : '↪️ Перенаправить'}
        </Btn>
      </MFoot>
    </MCard>
  );
}

// ─── REASSIGN (creator после declined) ────────────────────────────
export function ReassignModal({ task, currentUser, onDone }) {
  const { close } = useModal();
  const [newId, setNewId] = useState(null);
  const [busy, setBusy]   = useState(false);

  const submit = async () => {
    if (!newId) { toast.warn('Выберите нового исполнителя'); return; }
    setBusy(true);
    try {
      await reassignTask(task.id, Number(newId));
      toast.success('Задача переназначена');
      onDone?.(); close();
    } catch (e) { toast.error('Ошибка: ' + (e?.message || e)); }
    finally { setBusy(false); }
  };

  return (
    <MCard>
      <MHead icon="🔄" title="Переназначить задачу" subtitle={task.title} accent="info" onClose={close} />
      <MBody>
        <div className="help-warn-banner">
          Предыдущий исполнитель отказался: <b>«{task.declined_reason}»</b>
        </div>
        <Field label="Кому передать" required>
          <UserPicker value={newId} onChange={setNewId}
                      exclude={[currentUser?.id, task.assignee_id]}
                      placeholder="Новый исполнитель" />
        </Field>
        <div className="help-explainer">
          Старый чат продолжит работу — новый исполнитель будет добавлен автоматически.
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Назад</Btn>
        <Btn variant="primary" disabled={busy || !newId} onClick={submit}>
          {busy ? 'Назначаем…' : '✓ Назначить'}
        </Btn>
      </MFoot>
    </MCard>
  );
}

// ─── ESCALATE ────────────────────────────────────────────────────
export function EscalateModal({ task, onDone }) {
  const { close } = useModal();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const r = await escalateTask(task.id);
      toast.success(`🛡 Эскалировано: ${r.escalated_to?.name || ''}`);
      onDone?.(); close();
    } catch (e) {
      toast.error('Ошибка: ' + (e?.message || e));
    } finally { setBusy(false); }
  };

  return (
    <MCard>
      <MHead icon="🛡" title="Эскалировать руководителю отдела"
             subtitle={task.title} accent="warning" onClose={close} />
      <MBody>
        <div className="help-warn-banner">
          Задача будет перенаправлена <b>руководителю отдела</b> прошлого исполнителя. Руководитель получит уведомление с пометкой «эскалация».
        </div>
        <div className="help-explainer">
          Используй когда задача срочная и не получается решить на уровне исполнителя.
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Назад</Btn>
        <Btn variant="primary" disabled={busy} onClick={submit}>
          {busy ? 'Эскалируем…' : '🛡 Эскалировать'}
        </Btn>
      </MFoot>
    </MCard>
  );
}

// ─── RATING (creator оценивает помощника после complete) ────────
export function RatingModal({ task, onDone }) {
  const { close } = useModal();
  const [stars, setStars] = useState(5);
  const [thanks, setThanks] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await rateTask(task.id, stars, thanks.trim() || null);
      toast.success('⭐ Спасибо за оценку!');
      onDone?.(); close();
    } catch (e) { toast.error('Ошибка: ' + (e?.message || e)); }
    finally { setBusy(false); }
  };

  return (
    <MCard>
      <MHead icon="⭐" title="Оцени помощь" subtitle={task.assignee_name || task.title} accent="success" onClose={close} />
      <MBody>
        <Field label="Насколько помог?" required>
          <div className="help-stars">
            {[1,2,3,4,5].map(n => (
              <span key={n} className={`help-star ${stars >= n ? 'is-on' : ''}`}
                    onClick={() => setStars(n)} role="button" aria-label={`${n} stars`}>
                {stars >= n ? '★' : '☆'}
              </span>
            ))}
          </div>
        </Field>
        <Field label="Спасибо (необязательно)" help="Напиши что было особенно полезно — это увидит сам помощник">
          <Textarea value={thanks} onChange={(e) => setThanks(e.target.value)} rows={3}
                    placeholder="«Огромное спасибо! Решил мою проблему за час»" maxLength={500} />
        </Field>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Пропустить</Btn>
        <Btn variant="primary" disabled={busy} onClick={submit}>
          {busy ? 'Отправляем…' : '⭐ Оценить'}
        </Btn>
      </MFoot>
    </MCard>
  );
}

// ─── COMPLETE ─────────────────────────────────────────────────────
export function CompleteModal({ task, onDone }) {
  const { close } = useModal();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await completeTask(task.id, comment.trim() || null);
      toast.success('✅ Задача завершена. Чат архивирован.');
      onDone?.(); close();
    } catch (e) { toast.error('Ошибка: ' + (e?.message || e)); }
    finally { setBusy(false); }
  };

  return (
    <MCard>
      <MHead icon="✅" title="Завершить задачу" subtitle={task.title} accent="success" onClose={close} />
      <MBody>
        <Field label="Комментарий о результате" help="Что сделано, где результат — будет видно создателю и наблюдателям">
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)}
                    placeholder="Например: «Готово, ссылка отправлена в чат»"
                    rows={3} autoFocus />
        </Field>
        <div className="help-explainer">
          После завершения чат <b>архивируется</b> (станет read-only). Историю и файлы можно будет читать.
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={submit}>
          {busy ? 'Завершаем…' : '✅ Завершить'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
