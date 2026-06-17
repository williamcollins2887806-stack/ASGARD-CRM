/**
 * Composer — модалка написания письма (vanilla my_mail.js:765..1216 openCompose).
 *
 * Реализует:
 *  - режимы: новое / ответить / переслать
 *  - rich text через contentEditable (B/I/U/маркеры/нумерованные/ссылка)
 *  - прикрепление файлов через FileDrop
 *  - auto-save черновика каждые 30 секунд
 *  - Ctrl+Enter — отправить
 *  - Esc — закрыть (через ModalProvider)
 *
 * Использует Backend POST /send и POST /drafts (vanilla строки 1088 / 1121).
 */
import { useState, useEffect, useRef } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { TextInput, SelectInput, FileDrop } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import {
  sendMessage, saveDraft,
  loadTemplates, renderTemplate, nextOutgoingNumber,
  fmtFullDate, fmtFileSize
} from './api';

function quoteBlock(e) {
  if (!e) return '';
  const body = e.body_html || (e.body_text || '').replace(/\n/g, '<br>');
  return `<br><br><blockquote style="border-left:3px solid #cbb98a;padding-left:12px;margin:0;color:#555">` +
    `<div style="font-size:12px;color:#777;margin-bottom:6px">${fmtFullDate(e.email_date)}, ` +
    `${(e.from_name || e.from_email || '')}:</div>${body}</blockquote>`;
}

function forwardBlock(e) {
  if (!e) return '';
  const body = e.body_html || (e.body_text || '').replace(/\n/g, '<br>');
  return `<br><br><div style="border-top:1px solid #ddd;padding-top:10px;color:#555">` +
    `<div>---------- Пересланное сообщение ----------</div>` +
    `<div>От: ${(e.from_name || '')} &lt;${(e.from_email || '')}&gt;</div>` +
    `<div>Дата: ${fmtFullDate(e.email_date)}</div>` +
    `<div>Тема: ${e.subject || ''}</div></div><br>${body}`;
}

export function Composer({ replyTo, forward, defaultTo }) {
  const { close } = useModal();
  const bodyRef = useRef(null);
  const autoSaveTimer = useRef(null);
  const lastDraftSnapshot = useRef('');

  const [to, setTo] = useState(replyTo?.from_email || defaultTo || '');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState(
    replyTo
      ? (/^Re:/i.test(replyTo.subject || '') ? replyTo.subject : 'Re: ' + (replyTo.subject || ''))
      : forward
        ? (/^Fwd:/i.test(forward.subject || '') ? forward.subject : 'Fwd: ' + (forward.subject || ''))
        : ''
  );
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [outgoingNumber, setOutgoingNumber] = useState('');
  const [autosaveStatus, setAutosaveStatus] = useState('');
  const initialBody = useRef(
    replyTo ? quoteBlock(replyTo) : forward ? forwardBlock(forward) : ''
  );

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.innerHTML = initialBody.current;
    }
    loadTemplates().then(setTemplates).catch(() => {});
    nextOutgoingNumber().then((d) => setOutgoingNumber(d?.number || '')).catch(() => {});

    // Auto-save каждые 30 секунд
    autoSaveTimer.current = setInterval(() => {
      void doAutoSave();
    }, 30000);

    return () => {
      if (autoSaveTimer.current) clearInterval(autoSaveTimer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ctrl+Enter — отправить (внутри composer body)
  const onBodyKey = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      void submit(false);
    }
  };

  const exec = (cmd, value) => {
    document.execCommand(cmd, false, value);
    bodyRef.current?.focus();
  };

  const insertLink = () => {
    // eslint-disable-next-line no-alert
    const url = window.prompt('Введите URL:');
    if (url) exec('createLink', url);
  };

  const applyTemplate = async (tplId) => {
    if (!tplId) return;
    try {
      const data = await renderTemplate(tplId, {
        sender_name: 'ООО «Асгард Сервис»',
        outgoing_number: outgoingNumber
      });
      if (data?.subject) setSubject(data.subject);
      if (bodyRef.current && data?.body) {
        bodyRef.current.innerHTML = data.body;
      }
      toast('Шаблон', 'Применён', 'ok');
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    }
  };

  const collectAttachments = async () => {
    const out = [];
    for (const f of files) {
      // eslint-disable-next-line no-await-in-loop
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(',').pop());
        r.onerror = rej;
        r.readAsDataURL(f);
      });
      out.push({ filename: f.name, content: base64, size: f.size });
    }
    return out;
  };

  const collectPayload = async () => {
    const bodyHtml = bodyRef.current?.innerHTML || '';
    const bodyText = bodyRef.current?.innerText || '';
    const attachments = await collectAttachments();
    return {
      to: (to || '').split(',').map((s) => s.trim()).filter(Boolean),
      cc: cc ? cc.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
      subject,
      body_html: bodyHtml,
      body_text: bodyText,
      reply_to_email_id: replyTo?.id,
      forward_of_email_id: forward?.id,
      attachments,
      is_crm_action: false
    };
  };

  const submit = async (asDraft) => {
    if (!asDraft) {
      if (!to.trim()) { toast('Кому', 'Укажите получателя', 'warn'); return; }
      if (!subject.trim()) { toast('Тема', 'Укажите тему', 'warn'); return; }
    }
    setBusy(true);
    try {
      const payload = await collectPayload();
      if (asDraft) await saveDraft(payload);
      else await sendMessage(payload);
      toast(asDraft ? 'Черновик сохранён' : '📤 Отправлено', '', 'ok');
      window.dispatchEvent(new CustomEvent('asgard:mymail:changed'));
      close();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
      setBusy(false);
    }
  };

  const doAutoSave = async () => {
    try {
      const bodyText = bodyRef.current?.innerText || '';
      if (bodyText.trim().length < 10 && !subject.trim()) return;
      const snapshot = JSON.stringify({ to, cc, subject, body: bodyRef.current?.innerHTML || '' });
      if (snapshot === lastDraftSnapshot.current) return;
      lastDraftSnapshot.current = snapshot;
      const payload = await collectPayload();
      await saveDraft(payload);
      setAutosaveStatus('Сохранено · ' + new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }));
    } catch {
      setAutosaveStatus('Не удалось сохранить');
    }
  };

  return (
    <MCard className="modal-lg mm-composer-card">
      <MHead
        icon="✉"
        title={replyTo ? 'Ответить' : forward ? 'Переслать' : 'Новое письмо'}
        subtitle={outgoingNumber ? 'Исх. №: ' + outgoingNumber : undefined}
        onClose={close}
      />
      <MBody>
        <div className="mm-composer">
          {templates.length > 0 && (
            <Field label="📝 Шаблон">
              <SelectInput
                value=""
                onChange={applyTemplate}
                options={[
                  { value: '', label: '— выбрать шаблон —' },
                  ...templates.map((t) => ({ value: String(t.id), label: t.name || ('Шаблон #' + t.id) }))
                ]}
              />
            </Field>
          )}
          <Field label="Кому" required>
            <TextInput value={to} onChange={setTo} placeholder="user@example.com (через запятую — несколько)" />
          </Field>
          <Field label="Копия (Cc)">
            <TextInput value={cc} onChange={setCc} placeholder="cc@example.com" />
          </Field>
          <Field label="Тема" required>
            <TextInput value={subject} onChange={setSubject} />
          </Field>
          <Field label="Текст">
            <div className="mm-rt">
              <div className="mm-rt__bar" role="toolbar" aria-label="Форматирование">
                <button type="button" onClick={() => exec('bold')} title="Жирный (Ctrl+B)"><b>B</b></button>
                <button type="button" onClick={() => exec('italic')} title="Курсив (Ctrl+I)"><i>I</i></button>
                <button type="button" onClick={() => exec('underline')} title="Подчёркнутый (Ctrl+U)"><u>U</u></button>
                <button type="button" onClick={() => exec('strikeThrough')} title="Зачёркнутый"><s>S</s></button>
                <span className="mm-rt__sep" />
                <button type="button" onClick={() => exec('insertUnorderedList')} title="Маркированный список">•</button>
                <button type="button" onClick={() => exec('insertOrderedList')} title="Нумерованный">1.</button>
                <span className="mm-rt__sep" />
                <button type="button" onClick={insertLink} title="Вставить ссылку">🔗</button>
                <button type="button" onClick={() => exec('removeFormat')} title="Очистить">⌫</button>
              </div>
              <div
                ref={bodyRef}
                contentEditable
                suppressContentEditableWarning
                onKeyDown={onBodyKey}
                className="mm-rt__body"
                spellCheck
              />
            </div>
          </Field>
          <Field label="Вложения">
            <FileDrop multiple hint="Перетащите файлы или нажмите" onFiles={(fs) => setFiles([...files, ...Array.from(fs)])} />
            {files.length > 0 && (
              <div className="mm-composer__files">
                {files.map((f, i) => (
                  <div key={i} className="mm-composer__file">
                    <span>📎 {f.name} <span className="mm-composer__file-size">({fmtFileSize(f.size)})</span></span>
                    <button type="button" className="mm-composer__file-x" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Удалить">×</button>
                  </div>
                ))}
              </div>
            )}
          </Field>
        </div>
      </MBody>
      <MFoot align="spread">
        <div className="mm-composer__autosave" title="Авто-сохранение черновика раз в 30с">{autosaveStatus}</div>
        <div className="u-flex gap-6">
          <Btn variant="ghost" onClick={close} disabled={busy}>Отмена</Btn>
          <Btn variant="ghost" onClick={() => submit(true)} disabled={busy}>💾 Черновик</Btn>
          <Btn variant="primary" onClick={() => submit(false)} disabled={busy}>📤 Отправить</Btn>
        </div>
      </MFoot>
    </MCard>
  );
}
