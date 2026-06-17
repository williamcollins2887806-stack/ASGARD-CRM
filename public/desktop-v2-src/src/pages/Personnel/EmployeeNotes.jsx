/**
 * Лента комментариев / заметок по сотруднику.
 *
 * Источник: vanilla `employee.js` блок «Комментарии» (строки 360–379, 582–598).
 *
 * В vanilla комментарии хранились в IndexedDB как `emp.comments = []` (массив JSON).
 * На бэке Postgres такой колонки `employees.comments` НЕТ — миграции этой колонки
 * не существует (см. V001:241–255 + последующие ALTER, поле так и не появилось).
 *
 * Пока бэк не доработан, ленту храним в обычном текстовом поле `notes` (есть в
 * EMPLOYEE_COLS, см. staff.js:8). Каждый новый комментарий добавляется в начало
 * с подписью «— author, дата». Для полной ленты с отдельными авторами/датами
 * нужен `employee_comments` table + endpoint (см. отчёт «backend нужен»).
 */
import { useState, useEffect } from 'react';
import { Btn, Field } from '@/modals/parts';
import { TextareaInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { useAuth } from '@/api/useAuth';
import { updateEmployee } from './api';

export function EmployeeNotes({ employee, canEdit, onSaved }) {
  const { user } = useAuth();
  const e = employee || {};
  const [notes, setNotes] = useState(e.notes || '');
  const [newComment, setNewComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setNotes(e.notes || '');
    setDirty(false);
  }, [e.id, e.notes]);

  const addComment = async () => {
    const txt = newComment.trim();
    if (!txt) {
      toast.warn('Введите комментарий');
      return;
    }
    const author = (user?.name || user?.login || 'Пользователь');
    const date = new Date().toLocaleString('ru-RU');
    const entry = `[${date}] ${author}: ${txt}`;
    const updated = notes ? entry + '\n\n' + notes : entry;
    setBusy(true);
    try {
      await updateEmployee(employee.id, { notes: updated });
      toast.success('Комментарий добавлен');
      setNotes(updated);
      setNewComment('');
      onSaved?.();
    } catch (err) {
      toast.error('Ошибка: ' + (err?.serverMsg || err?.message || err));
    } finally {
      setBusy(false);
    }
  };

  const saveRaw = async () => {
    setBusy(true);
    try {
      await updateEmployee(employee.id, { notes: notes || null });
      toast.success('Заметки сохранены');
      setDirty(false);
      onSaved?.();
    } catch (err) {
      toast.error('Ошибка: ' + (err?.serverMsg || err?.message || err));
    } finally {
      setBusy(false);
    }
  };

  // Парсим строку notes в «карточки» по маркеру [дата] автор: …
  const entries = parseEntries(notes);

  return (
    <div className="emp-notes">
      {canEdit && (
        <div className="emp-notes-add">
          <Field label="Новый комментарий">
            <TextareaInput
              value={newComment}
              onChange={setNewComment}
              placeholder="Что хочешь добавить о сотруднике?"
              minRows={2}
              maxRows={4}
            />
          </Field>
          <div className="row-end">
            <Btn variant="primary" size="sm" disabled={busy || !newComment.trim()} onClick={addComment}>
              {busy ? 'Сохраняем…' : '+ Добавить'}
            </Btn>
          </div>
        </div>
      )}

      {entries.length === 0 && !notes ? (
        <div className="emp-modal-empty">Комментариев пока нет.</div>
      ) : entries.length > 0 ? (
        <div className="emp-notes-list">
          {entries.map((en, i) => (
            <div key={i} className="emp-notes-item">
              <div className="emp-notes-item-head">
                <b>{en.author}</b>
                <span className="emp-notes-item-date">{en.date}</span>
              </div>
              <div className="emp-notes-item-body">{en.text}</div>
            </div>
          ))}
        </div>
      ) : (
        // notes есть, но без маркеров — показываем как «сырое примечание HR»
        <div className="emp-notes-raw">{notes}</div>
      )}

      {canEdit && (
        <details className="emp-notes-raw-edit">
          <summary>✎ Править как обычное примечание</summary>
          <div className="col gap-10 mt-10">
            <TextareaInput
              value={notes}
              onChange={(v) => { setNotes(v); setDirty(true); }}
              minRows={4}
              maxRows={12}
              placeholder="Сюда можно писать примечание свободным текстом…"
            />
            <div className="row-end">
              <Btn variant="ghost" size="sm" disabled={!dirty || busy} onClick={saveRaw}>
                {busy ? 'Сохраняем…' : '💾 Сохранить'}
              </Btn>
            </div>
          </div>
        </details>
      )}
    </div>
  );
}

// Парсер: ищет строки вида `[дата] автор: текст`. Если в notes такого формата нет — возвращает [].
function parseEntries(text) {
  if (!text || typeof text !== 'string') return [];
  const blocks = text.split(/\n\n+/);
  const out = [];
  for (const b of blocks) {
    const m = b.match(/^\[([^\]]+)\]\s+([^:]+):\s*([\s\S]*)$/);
    if (m) {
      out.push({ date: m[1].trim(), author: m[2].trim(), text: m[3].trim() });
    }
  }
  return out;
}
