/**
 * HelpRequestModal — модалка «Попросить помощи».
 * Большая, но красивая: пикер исполнителя, наблюдатели, описание, дедлайн-пресеты, файлы.
 */
import { useState, useEffect, useRef } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field, Input, Textarea } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { UserPicker } from './UserPicker';
import { createHelpTask, uploadFiles, PRIORITY_LABELS, DEADLINE_PRESETS,
         loadTemplates, useTemplate, aiSuggestAssignee, ROLE_LABELS } from './api';

const DRAFT_KEY = 'help_request_draft';

export function HelpRequestModal({ defaultWorkId=null, defaultAssigneeId=null, onSaved }) {
  const { close } = useModal();

  // Восстанавливаем черновик из localStorage
  const draft = (() => {
    try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null') || {}; } catch { return {}; }
  })();

  const [assigneeId, setAssigneeId] = useState(defaultAssigneeId || draft.assigneeId || null);
  const [watcherIds, setWatcherIds] = useState(Array.isArray(draft.watcherIds) ? draft.watcherIds : []);
  const [title, setTitle] = useState(draft.title || '');
  const [description, setDescription] = useState(draft.description || '');
  const [deadline, setDeadline] = useState(draft.deadline || '');
  const [priority, setPriority] = useState(draft.priority || 'normal');
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  // Phase 8: templates + ai-suggest
  const [templates, setTemplates] = useState([]);
  const [showTpl, setShowTpl] = useState(false);
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [aiResult, setAiResult] = useState(null); // { suggested:[], dept_hint }

  useEffect(() => {
    loadTemplates().then(setTemplates).catch(() => {});
  }, []);

  const applyTemplate = async (tpl) => {
    setShowTpl(false);
    if (tpl.default_assignee_id) setAssigneeId(tpl.default_assignee_id);
    if (tpl.title_pattern) setTitle(tpl.title_pattern.replace(/\{\{me\}\}/g, '').replace(/\{\{date\}\}/g, new Date().toLocaleDateString('ru-RU')));
    else if (tpl.name) setTitle(tpl.name);
    if (tpl.description) setDescription(tpl.description);
    if (tpl.priority) setPriority(tpl.priority);
    if (tpl.deadline_hours) {
      const d = new Date(Date.now() + tpl.deadline_hours * 3600000);
      const off = d.getTimezoneOffset();
      const local = new Date(d.getTime() - off * 60000);
      setDeadline(local.toISOString().slice(0, 16));
    }
    toast.success(`Применён шаблон «${tpl.name}»`);
  };

  const askAi = async () => {
    if ((title + ' ' + description).trim().length < 5) {
      toast.warn('Опиши задачу подробнее, чтобы AI понял');
      return;
    }
    setAiSuggesting(true);
    try {
      const r = await aiSuggestAssignee(description || title, title);
      setAiResult(r);
      if (!r.suggested?.length) toast.info('Не нашёл подходящих исполнителей по описанию');
    } catch (e) { toast.error('Ошибка AI: ' + (e?.message || e)); }
    finally { setAiSuggesting(false); }
  };

  // Автосохранение черновика
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ assigneeId, watcherIds, title, description, deadline, priority }));
      } catch (e) {}
    }, 800);
    return () => clearTimeout(t);
  }, [assigneeId, watcherIds, title, description, deadline, priority]);

  const applyPreset = (preset) => {
    if (preset.resolve) {
      setDeadline(toLocalInput(preset.resolve()));
    } else if (preset.ms) {
      setDeadline(toLocalInput(new Date(Date.now() + preset.ms).toISOString()));
    }
  };

  const addFiles = (newOnes) => {
    const arr = Array.from(newOnes || []);
    if (!arr.length) return;
    const total = files.length + arr.length;
    if (total > 5) { toast.warn('Максимум 5 файлов'); return; }
    const bigOne = arr.find(f => f.size > 50 * 1024 * 1024);
    if (bigOne) { toast.warn(`Файл «${bigOne.name}» больше 50 МБ`); return; }
    setFiles([...files, ...arr]);
  };

  const onDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    addFiles(e.dataTransfer?.files);
  };

  const submit = async () => {
    if (!assigneeId) { toast.warn('Выберите кому отправить'); return; }
    if (!title.trim()) { toast.warn('Опишите что нужно сделать'); return; }
    if (title.trim().length < 3) { toast.warn('Слишком короткое название'); return; }

    setSaving(true);
    try {
      const body = {
        assignee_id: Number(assigneeId),
        title: title.trim(),
        description: description?.trim() || null,
        deadline: deadline ? new Date(deadline).toISOString() : null,
        priority,
        watcher_ids: watcherIds.map(Number),
        work_id: defaultWorkId || null
      };
      const r = await createHelpTask(body);

      // Файлы (если есть) — отдельным запросом
      if (files.length && r?.task?.id) {
        const fd = new FormData();
        files.forEach(f => fd.append('files', f, f.name));
        try { await uploadFiles(r.task.id, fd); }
        catch (e) { toast.warn('Задача создана, но файлы не загрузились: ' + (e?.message || e)); }
      }

      try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
      toast.success('🤝 Помощь запрошена');
      onSaved?.(r?.task);
      close();
    } catch (e) {
      toast.error('Ошибка: ' + (e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <MCard wide>
      <MHead
        icon="🤝"
        title="Попросить о помощи"
        subtitle="Сильные плечо к плечу — слабые в одиночку"
        accent="info"
        onClose={close}
      />
      <MBody>
        {templates.length > 0 && (
          <div style={{ marginBottom: 12, position: 'relative' }}>
            <Btn variant="ghost" onClick={() => setShowTpl(s => !s)}>
              📋 Шаблоны ({templates.length}) {showTpl ? '▲' : '▼'}
            </Btn>
            {showTpl && (
              <div className="help-tpl-dropdown">
                {templates.map(t => (
                  <button key={t.id} type="button" className="help-tpl-item" onClick={() => applyTemplate(t)}>
                    <span className="help-tpl-emoji">{t.emoji || '🤝'}</span>
                    <span className="help-tpl-name">{t.name}</span>
                    {t.default_assignee_name && <span className="help-tpl-meta">→ {t.default_assignee_name}</span>}
                    {parseInt(t.use_count) > 0 && <span className="help-tpl-meta">· {t.use_count}×</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <Field label="Кого просишь" required help={
          <button type="button" onClick={askAi} disabled={aiSuggesting} className="help-ai-btn">
            {aiSuggesting ? '⏳ Думаю…' : '🤖 Подсказать кому'}
          </button>
        }>
          <UserPicker
            value={assigneeId}
            onChange={setAssigneeId}
            placeholder="Имя сотрудника или название отдела…"
          />
          {aiResult && (
            <div className="help-ai-result">
              <div className="help-ai-head">
                🤖 По описанию подходит отдел <b>{ROLE_LABELS[aiResult.dept_hint] || aiResult.dept_hint || '?'}</b>:
              </div>
              {aiResult.suggested?.length ? (
                <div className="help-ai-list">
                  {aiResult.suggested.map(s => (
                    <button key={s.user_id} type="button" className="help-ai-card"
                            onClick={() => { setAssigneeId(s.user_id); setAiResult(null); }}>
                      <b>{s.name}</b>
                      <span className="help-ai-role">{ROLE_LABELS[s.role] || s.role}</span>
                      <span className="help-ai-meta">{s.reason}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="help-ai-empty">Не нашёл подходящих сотрудников</div>
              )}
            </div>
          )}
        </Field>

        <Field label="Кто ещё поможет" help="Наблюдатели увидят задачу и смогут писать в чат">
          <UserPicker
            value={watcherIds}
            onChange={setWatcherIds}
            multi
            exclude={assigneeId ? [assigneeId] : []}
            limit={20}
            placeholder="Добавить наблюдателя… (необязательно)"
          />
        </Field>

        <Field label="О чём задача" required>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Кратко: найти ТЗ по объекту X / помочь со сметой / уточнить у заказчика"
            maxLength={255}
            autoFocus
          />
        </Field>

        <Field label="Подробности">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Опиши контекст: что именно нужно, где искать, кому передать…"
            rows={4}
          />
        </Field>

        <Field label="Файлы" help={`До 5 файлов, каждый до 50 МБ${files.length ? ` · выбрано ${files.length}` : ''}`}>
          <div
            className={`help-dropzone ${dragOver ? 'is-over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <span>📎 Перетащи файлы сюда или кликни</span>
            <input ref={fileInputRef} type="file" multiple style={{ display:'none' }}
                   onChange={(e) => addFiles(e.target.files)} />
          </div>
          {files.length > 0 && (
            <ul className="help-file-list">
              {files.map((f, i) => (
                <li key={i}>
                  <span>📄 {f.name} <i>({(f.size/1024).toFixed(1)} КБ)</i></span>
                  <button type="button" className="help-pill-x" onClick={() => setFiles(files.filter((_,idx) => idx !== i))}>×</button>
                </li>
              ))}
            </ul>
          )}
        </Field>

        <Field label="Когда нужно">
          <div className="help-presets">
            {DEADLINE_PRESETS.map(p => (
              <button key={p.key} type="button" className="help-preset-chip" onClick={() => applyPreset(p)}>
                {p.label}
              </button>
            ))}
            <Input
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              style={{ maxWidth: 240, marginLeft: 'auto' }}
            />
          </div>
        </Field>

        <Field label="Приоритет">
          <div className="help-prio-radio">
            {Object.entries(PRIORITY_LABELS).map(([v, l]) => (
              <label key={v} className={`help-radio ${priority === v ? 'is-active' : ''} help-radio-${v}`}>
                <input type="radio" name="prio" value={v} checked={priority === v} onChange={() => setPriority(v)} />
                <span>{l}</span>
              </label>
            ))}
          </div>
        </Field>

        <div className="help-explainer">
          После отправки автоматически:<br/>
          • Создастся чат в Хугинне с участниками<br/>
          • Исполнитель получит уведомление в Telegram (если настроен)<br/>
          • Сможешь добавить ещё наблюдателей и общаться в чате
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={saving} onClick={submit}>
          {saving ? 'Отправляем…' : '🤝 Попросить помощи'}
        </Btn>
      </MFoot>
    </MCard>
  );
}

function toLocalInput(iso) {
  try {
    const d = new Date(iso);
    const off = d.getTimezoneOffset();
    const local = new Date(d.getTime() - off * 60000);
    return local.toISOString().slice(0, 16);
  } catch { return ''; }
}
