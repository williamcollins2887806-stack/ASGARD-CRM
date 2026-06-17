import { useState } from 'react';
import { useModal, PromptModal, ConfirmModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TextInput } from '@/inputs/Inputs';
import { addTodoItem, toggleTodoItem, editTodoItem, deleteTodoItem } from './api';

/**
 * Правая колонка — личный todo-список.
 * Реал-апдейты после каждой операции через onChanged().
 */
export function TodoPanel({ items, loading, onChanged }) {
  const modal = useModal();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const total = items.length;
  const done = items.filter((x) => x.done).length;

  const add = async () => {
    const text = draft.trim();
    if (!text) return;
    setBusy(true);
    try {
      await addTodoItem(text);
      setDraft('');
      onChanged?.();
    } catch (e) {
      toast.error('Не удалось добавить: ' + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (it) => {
    try {
      await toggleTodoItem(it.id);
      onChanged?.();
    } catch (e) {
      toast.error('Ошибка: ' + (e?.message || e));
    }
  };

  const edit = (it) => {
    modal.open(
      <PromptModal
        title="Редактировать пункт"
        label="Текст"
        initial={it.text || ''}
        okText="Сохранить"
        onSubmit={async (text) => {
          try {
            await editTodoItem(it.id, text.trim());
            onChanged?.();
          } catch (e) {
            toast.error('Не удалось: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  const remove = (it) => {
    modal.open(
      <ConfirmModal
        title="Удалить пункт?"
        message={it.text}
        tone="danger"
        okText="Удалить"
        onConfirm={async () => {
          try {
            await deleteTodoItem(it.id);
            onChanged?.();
          } catch (e) {
            toast.error('Не удалось: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  return (
    <div className="todo-panel">
      <h3>
        📝 Мои дела
        <span className="cnt">{done}/{total}</span>
      </h3>

      <div className="todo-add">
        <div>
          <TextInput
            value={draft}
            onChange={setDraft}
            placeholder="Что нужно сделать?…"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          />
        </div>
        <Btn variant="primary" disabled={!draft.trim() || busy} onClick={add}>+</Btn>
      </div>

      <div className="todo-list">
        {loading ? (
          <div className="todo-empty">⏳ Загружаем…</div>
        ) : items.length === 0 ? (
          <div className="todo-empty">Список пуст. Добавьте первое дело ↑</div>
        ) : items.map((it) => (
          <TodoItem key={it.id} it={it} onToggle={() => toggle(it)} onEdit={() => edit(it)} onDelete={() => remove(it)} />
        ))}
      </div>
    </div>
  );
}

function TodoItem({ it, onToggle, onEdit, onDelete }) {
  const remaining = remainingTimeText(it);
  return (
    <div className={'todo-item ' + (it.done ? 'done' : '')}>
      <input
        type="checkbox"
        className="todo-cb"
        checked={!!it.done}
        onChange={onToggle}
      />
      <span className="todo-text" onDoubleClick={onEdit} title="Двойной клик — редактировать">
        {it.text}
      </span>
      {remaining && <span className="todo-timer" title="До автоудаления">⏳ {remaining}</span>}
      <button className="todo-x" onClick={onDelete} title="Удалить">×</button>
    </div>
  );
}

function remainingTimeText(item) {
  if (!item.done || !item.done_at) return null;
  try {
    const doneAt = new Date(item.done_at);
    const deleteHours = item.auto_delete_hours || 48;
    const deleteAt = new Date(doneAt.getTime() + deleteHours * 3600 * 1000);
    const now = new Date();
    const ms = deleteAt.getTime() - now.getTime();
    if (ms <= 0) return null;
    const hours = Math.floor(ms / 3600000);
    if (hours > 0) return `${hours} ч`;
    const mins = Math.floor((ms % 3600000) / 60000);
    return `${mins} мин`;
  } catch { return null; }
}
