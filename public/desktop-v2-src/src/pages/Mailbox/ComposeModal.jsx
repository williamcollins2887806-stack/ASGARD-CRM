/**
 * ComposeModal — написать новое письмо / ответить / переслать в /mailbox.
 * Источник vanilla: AsgardEmailCompose (вызов из mailbox.js bindEvents/handleDetailAction).
 *
 * POST /api/mailbox/send  { to, cc, subject, body_text, body_html?, in_reply_to?, attachments[], use_letterhead }
 *
 * D-56 (2026-06-18): vanilla-parity (email_compose.js:38-62,197-213,271-274,174,300,316,364):
 *   - templates preload + SelectInput + apply (placeholder replacement)
 *   - preview next outgoing number
 *   - Switch use_letterhead (default true)
 *   - Save Draft (POST /api/mailbox/drafts)
 */
import { useState, useEffect, useMemo } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { TextInput, TextareaInput, SelectInput, FileDrop, Switch } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { api } from '@/api/client';

import { sendEmail, loadAccounts, parseEmailList, fmtEmailDate } from './api';

function fmtAddr(addr) {
  if (!addr) return '';
  if (typeof addr === 'string') return addr;
  if (addr.name) return `${addr.name} <${addr.email || addr.address || ''}>`;
  return addr.email || addr.address || '';
}

function buildQuote(email) {
  if (!email) return '';
  const from = email.from_name ? `${email.from_name} <${email.from_email || ''}>` : (email.from_email || '');
  const dt = fmtEmailDate(email.email_date || email.received_at);
  const body = (email.body_text || '').split('\n').map((l) => '> ' + l).join('\n');
  return `\n\n----- Исходное письмо -----\nОт: ${from}\nДата: ${dt}\nТема: ${email.subject || ''}\n\n${body}`;
}

function buildForwardBody(email) {
  if (!email) return '';
  const toList = parseEmailList(email.to_emails).map(fmtAddr).filter(Boolean).join(', ');
  return `\n\n----- Пересылаемое письмо -----\nОт: ${email.from_name || email.from_email || ''}\nКому: ${toList}\nТема: ${email.subject || ''}\n\n${email.body_text || ''}`;
}

/** Placeholder replacement {{key}} → value (vanilla email_compose.js apply). */
function applyPlaceholders(text, vars) {
  if (!text) return '';
  return String(text).replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const v = vars[k];
    return (v === undefined || v === null) ? '' : String(v);
  });
}

/** Strip HTML → text (vanilla stripHtml, email_compose.js:394-399). */
function stripHtml(html) {
  if (!html) return '';
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}

export function ComposeModal({ mode = 'compose', email, onSent, customer_name, customerName }) {
  const { close } = useModal();
  const [accounts, setAccounts] = useState([]);
  const [busy, setBusy] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [files, setFiles] = useState([]);

  // D-56: templates preload + selection (email_compose.js:38-62,197-213)
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [nextNumber, setNextNumber] = useState('');
  // D-56: use_letterhead switch (email_compose.js:174,300,316)
  const [useLetterhead, setUseLetterhead] = useState(mode === 'compose');

  const initial = useMemo(() => {
    if (mode === 'reply' && email) {
      return {
        to:      email.from_email || (parseEmailList(email.from_emails)[0]?.address || ''),
        cc:      '',
        subject: 'Re: ' + (email.subject || '').replace(/^Re:\s*/i, ''),
        body:    buildQuote(email),
        in_reply_to: email.id
      };
    }
    if (mode === 'reply_all' && email) {
      const allTo = parseEmailList(email.to_emails).map((a) => a.address || a).filter(Boolean);
      const cc    = parseEmailList(email.cc_emails).map((a) => a.address || a).filter(Boolean);
      return {
        to:      [email.from_email, ...allTo].filter(Boolean).join(', '),
        cc:      cc.join(', '),
        subject: 'Re: ' + (email.subject || '').replace(/^Re:\s*/i, ''),
        body:    buildQuote(email),
        in_reply_to: email.id
      };
    }
    if (mode === 'forward' && email) {
      return {
        to:      '',
        cc:      '',
        subject: 'Fwd: ' + (email.subject || '').replace(/^Fwd:\s*/i, ''),
        body:    buildForwardBody(email),
        forward_from: email.id
      };
    }
    return { to: '', cc: '', subject: '', body: '' };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, email?.id]);

  const [accId, setAccId] = useState('');
  const [to, setTo] = useState(initial.to);
  const [cc, setCc] = useState(initial.cc);
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);

  useEffect(() => {
    loadAccounts().then((acc) => {
      setAccounts(acc);
      if (acc.length && !accId) setAccId(String(acc[0].id));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // D-56: preload templates (email_compose.js:43-49)
  useEffect(() => {
    api('/api/mailbox/templates')
      .then((d) => setTemplates(d?.templates || []))
      .catch(() => setTemplates([]));
  }, []);

  // D-56: preview next outgoing number (email_compose.js:52-58)
  useEffect(() => {
    if (mode !== 'compose') { setNextNumber(''); return; }
    const url = accId
      ? `/api/mailbox/next-outgoing-number?account_id=${encodeURIComponent(accId)}`
      : '/api/mailbox/next-outgoing-number';
    api(url)
      .then((d) => setNextNumber(d?.number || ''))
      .catch(() => setNextNumber(''));
  }, [mode, accId]);

  const title = mode === 'reply' ? 'Ответить'
              : mode === 'reply_all' ? 'Ответить всем'
              : mode === 'forward' ? 'Переслать'
              : 'Новое письмо';

  /** D-56: apply template (email_compose.js:197-213,271-274).
   *  Подставляет template.subject / template.body с placeholder-replacement.
   *  Если subject/body не пусты — confirm перед overwrite. */
  const applyTemplate = async (tplId) => {
    setTemplateId(tplId);
    if (!tplId) return;
    if ((subject && subject.trim()) || (body && body.trim())) {
      if (!window.confirm('Применить шаблон? Текущая тема и текст будут перезаписаны.')) {
        return;
      }
    }
    try {
      const data = await api(`/api/mailbox/templates/${encodeURIComponent(tplId)}`);
      const tpl = data?.template || data;
      if (!tpl) {
        toast.error('Шаблон не загрузился');
        return;
      }
      const vars = {
        customer_name: customer_name || customerName || '',
        user_name: '',
        company_name: ''
      };
      const subj = applyPlaceholders(tpl.subject || '', vars);
      const bodyRaw = applyPlaceholders(tpl.body || tpl.body_text || '', vars);
      const bodyText = /<[a-z][\s\S]*>/i.test(bodyRaw) ? stripHtml(bodyRaw) : bodyRaw;
      if (subj) setSubject(subj);
      if (bodyText) setBody(bodyText);
      if (typeof tpl.use_letterhead === 'boolean') setUseLetterhead(!!tpl.use_letterhead);
      toast.success('Шаблон применён');
    } catch (e) {
      toast.error('Не удалось применить шаблон: ' + (e?.message || e));
    }
  };

  /** Сбор attachments для send и draft. */
  const collectAttachments = () => Promise.all(
    Array.from(files).map(
      (f) =>
        new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = () =>
            res({
              filename: f.name,
              content_base64: String(r.result).split(',').pop(),
              size: f.size
            });
          r.onerror = rej;
          r.readAsDataURL(f);
        })
    )
  );

  const submit = async () => {
    if (!to.trim()) {
      toast.warn('Укажите получателя');
      return;
    }
    if (!subject.trim()) {
      toast.warn('Укажите тему');
      return;
    }

    setBusy(true);
    try {
      const attachments = await collectAttachments();

      // D-3 FIX (2026-06-14): vanilla-parity (email_compose.js:295-323).
      // Backend ждёт account_id (НЕ from_account_id), reply_to_email_id (НЕ in_reply_to),
      // forward_of_email_id (НЕ forward_from). Старые имена silently дропались.
      // body_html генерим из body_text (vanilla паттерн).
      const payload = {
        account_id: accId ? Number(accId) : undefined,
        to: to.split(',').map((s) => s.trim()).filter(Boolean),
        subject: subject.trim(),
        body_text: body,
        body_html: (body || '').replace(/\n/g, '<br>'),
        attachments,
        use_letterhead: !!useLetterhead
      };
      if (cc.trim()) payload.cc = cc.split(',').map((s) => s.trim()).filter(Boolean);
      if (initial.in_reply_to) payload.reply_to_email_id = Number(initial.in_reply_to);
      if (initial.forward_from) payload.forward_of_email_id = Number(initial.forward_from);
      if (templateId) payload.template_id = Number(templateId);

      await sendEmail(payload);
      toast.success('📤 Отправлено');
      window.dispatchEvent(new CustomEvent('asgard:mailbox:changed'));
      onSent?.();
      close();
    } catch (e) {
      toast.error('Не удалось отправить: ' + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  /** D-56: save draft (email_compose.js:347-370). POST /api/mailbox/drafts. */
  const saveDraft = async () => {
    setSavingDraft(true);
    try {
      const attachments = await collectAttachments();
      const payload = {
        account_id: accId ? Number(accId) : undefined,
        to: to ? to.split(',').map((s) => s.trim()).filter(Boolean) : [],
        cc: cc ? cc.split(',').map((s) => s.trim()).filter(Boolean) : [],
        bcc: [],
        subject: subject.trim(),
        body: body,
        body_text: body,
        body_html: (body || '').replace(/\n/g, '<br>'),
        attachments,
        use_letterhead: !!useLetterhead
      };
      if (templateId) payload.template_id = Number(templateId);
      if (initial.in_reply_to) payload.reply_to_email_id = Number(initial.in_reply_to);

      await api('/api/mailbox/drafts', { method: 'POST', body: payload });
      toast.success('Черновик сохранён');
      window.dispatchEvent(new CustomEvent('asgard:mailbox:changed'));
      onSent?.();
      close();
    } catch (e) {
      toast.error('Не удалось сохранить: ' + (e?.message || e));
    } finally {
      setSavingDraft(false);
    }
  };

  const templateOptions = useMemo(() => [
    { value: '', label: 'Без шаблона' },
    ...templates.map((t) => ({
      value: String(t.id),
      label: t.category ? `${t.name} · ${t.category}` : t.name
    }))
  ], [templates]);

  return (
    <MCard className="modal-lg">
      <MHead icon="✉" title={title} subtitle={email?.subject} onClose={close} />
      <MBody>
        <div className="col gap-10">
          {accounts.length > 1 && (
            <Field label="От аккаунта">
              <SelectInput
                value={accId}
                onChange={setAccId}
                options={accounts.map((a) => ({ value: String(a.id), label: `${a.name} · ${a.email_address}` }))}
              />
            </Field>
          )}
          {/* D-56: templates SelectInput (email_compose.js:38-62,197-213) */}
          {templates.length > 0 && (
            <Field label="Шаблон">
              <SelectInput
                value={templateId}
                onChange={applyTemplate}
                options={templateOptions}
              />
            </Field>
          )}
          {/* D-56: preview next outgoing number (email_compose.js:52-58) */}
          {mode === 'compose' && nextNumber && (
            <div className="fs-12 c-t3">
              Следующий №: <span className="c-t2">{nextNumber}</span>
              <span className="ml-6 c-t3">(присвоится при отправке)</span>
            </div>
          )}
          <Field label="Кому" required>
            <TextInput value={to} onChange={setTo} placeholder="user@example.com (через запятую если несколько)" />
          </Field>
          <Field label="Копия (Cc)">
            <TextInput value={cc} onChange={setCc} placeholder="boss@example.com" />
          </Field>
          <Field label="Тема" required>
            <TextInput value={subject} onChange={setSubject} />
          </Field>
          <Field label="Текст письма">
            <TextareaInput value={body} onChange={setBody} minRows={8} maxRows={20} />
          </Field>
          {/* D-56: use_letterhead Switch (email_compose.js:174,300,316) */}
          <Field>
            <Switch
              checked={useLetterhead}
              onChange={setUseLetterhead}
              label="📄 Использовать фирменный бланк"
            />
          </Field>
          <Field label="Вложения">
            <FileDrop multiple hint="Перетащите файлы или нажмите для выбора" onFiles={(fs) => setFiles([...files, ...Array.from(fs)])} />
            {files.length > 0 && (
              <div className="mt-6 p-6 bg-inner r-sm fs-12">
                {files.map((f, i) => (
                  <div key={i} className="row-spread py-2">
                    <span>📎 {f.name} <span className="c-t3">({(f.size / 1024).toFixed(1)} КБ)</span></span>
                    <button
                      type="button"
                      onClick={() => setFiles(files.filter((_, j) => j !== i))}
                      style={{
                        background: 'transparent', border: 0, cursor: 'pointer',
                        color: 'var(--t-3)', fontSize: 14
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Field>
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        {/* D-56: save draft (email_compose.js:347-370) */}
        <Btn variant="ghost" disabled={savingDraft || busy} onClick={saveDraft}>
          {savingDraft ? '⏳ Сохраняем…' : '💾 Сохранить черновик'}
        </Btn>
        <Btn variant="primary" disabled={busy || savingDraft} onClick={submit}>
          {busy ? '⏳ Отправляем…' : '📤 Отправить'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
