import { useState, useEffect } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field, Input, Textarea, Select } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { createTask, updateTask, loadAssignees, PRIORITY_LABELS } from './api';

/**
 * Создание / редактирование задачи (директора).
 * Если props.task передан — редактирование, иначе создание.
 */
export function TaskCreateModal({ task, onSaved }) {
  const { close } = useModal();
  const isEdit = !!task?.id;

  const [data, setData] = useState({
    assignee_id: task?.assignee_id ? String(task.assignee_id) : '',
    title:       task?.title || '',
    description: task?.description || '',
    deadline:    task?.deadline ? toLocalDateTime(task.deadline) : '',
    priority:    task?.priority || 'normal',
    creator_comment: task?.creator_comment || ''
  });
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadAssignees()
      .then((arr) => setUsers(arr.filter((u) => u.is_active !== false)))
      .catch(() => setUsers([]))
      .finally(() => setLoadingUsers(false));
  }, []);

  const set = (k, v) => setData((d) => ({ ...d, [k]: v }));

  const missing = [];
  if (!isEdit && !data.assignee_id) missing.push('исполнителя');
  if (!String(data.title).trim()) missing.push('название');

  const submit = async () => {
    if (missing.length) {
      toast.warn('Заполните обязательные поля: ' + missing.join(', '));
      return;
    }
    setSaving(true);
    try {
      const body = {
        title: data.title.trim(),
        description: data.description?.trim() || null,
        deadline: data.deadline ? new Date(data.deadline).toISOString() : null,
        priority: data.priority,
        creator_comment: data.creator_comment?.trim() || null
      };
      if (!isEdit) {
        body.assignee_id = Number(data.assignee_id);
        await createTask(body);
        toast.success('Задача создана');
      } else {
        await updateTask(task.id, body);
        toast.success('Изменения сохранены');
      }
      onSaved?.();
      close();
    } catch (e) {
      toast.error('Ошибка: ' + (e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <MCard>
      <MHead
        icon={isEdit ? '✎' : '📋'}
        title={isEdit ? 'Редактировать задачу' : 'Создать задачу'}
        subtitle={isEdit ? task.title : 'Назначьте исполнителя и опишите задание'}
        accent="info"
        onClose={close}
      />
      <MBody>
        {!isEdit && (
          <Field label="Исполнитель" required>
            {loadingUsers ? (
              <div className="pad-cell-lg c-t3">⏳ Загружаем список…</div>
            ) : (
              <Select value={data.assignee_id} onChange={(e) => set('assignee_id', e.target.value)}>
                <option value="">— выберите исполнителя —</option>
                {users.map((u) => (
                  <option key={u.id} value={String(u.id)}>
                    {u.name || u.login} ({u.role})
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}

        <Field label="Название" required>
          <Input
            value={data.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="Кратко суть задания"
            maxLength={255}
            autoFocus
          />
        </Field>

        <Field label="Описание">
          <Textarea
            value={data.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="Что нужно сделать? Подробности, ссылки…"
            rows={4}
          />
        </Field>

        <div className="m-grid-2">
          <Field label="Дедлайн">
            <Input
              type="datetime-local"
              value={data.deadline}
              onChange={(e) => set('deadline', e.target.value)}
            />
          </Field>
          <Field label="Приоритет">
            <Select value={data.priority} onChange={(e) => set('priority', e.target.value)}>
              {Object.entries(PRIORITY_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Комментарий" help="Дополнительные инструкции для исполнителя">
          <Textarea
            value={data.creator_comment}
            onChange={(e) => set('creator_comment', e.target.value)}
            placeholder="Что важно учесть?"
            rows={2}
          />
        </Field>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={saving} onClick={submit}>
          {saving ? 'Сохраняем…' : (isEdit ? 'Сохранить' : 'Создать задачу')}
        </Btn>
      </MFoot>
    </MCard>
  );
}

function toLocalDateTime(iso) {
  try {
    const d = new Date(iso);
    const off = d.getTimezoneOffset();
    const local = new Date(d.getTime() - off * 60000);
    return local.toISOString().slice(0, 16);
  } catch { return ''; }
}
