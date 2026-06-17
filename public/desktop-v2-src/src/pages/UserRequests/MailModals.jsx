/**
 * Mail-модалки для UserRequests.
 *   • BindEmailModal     — привязать существующий ящик (ввод email + пароль + IMAP/SMTP)
 *   • CreateYandexModal  — создать Яндекс-ящик (nickname + пароль)
 *   • BindYandexModal    — привязать корп-ящик через Яндекс 360 Admin API
 *   • MailSettingsModal  — настройки уже привязанного ящика
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { TextInput, PasswordInput, TextareaInput } from '@/inputs/Inputs';
import { bindEmail, testEmail, createYandexBox, bindYandexBox, updateEmail, timeAgo } from './api';

/* ───────────────────────── Bind Email (manual) ───────────────────────── */
export function BindEmailModal({ user, onSaved }) {
  const { close } = useModal();
  const [email, setEmail] = useState('');
  const [pass, setPass]   = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [imapHost, setImapHost] = useState('imap.yandex.ru');
  const [imapPort, setImapPort] = useState(993);
  const [smtpHost, setSmtpHost] = useState('smtp.yandex.ru');
  const [smtpPort, setSmtpPort] = useState(465);
  const [displayName, setDisplayName] = useState(user.name || '');

  const [test, setTest] = useState(null); // {kind:'busy'|'ok'|'err', msg}
  const [bindOk, setBindOk] = useState(false);
  const [saving, setSaving] = useState(false);

  const runTest = async () => {
    if (!email || !pass) { toast.error('Укажите email и пароль'); return; }
    setTest({ kind: 'busy', msg: 'Проверка подключения…' });
    try {
      const r = await testEmail(user.id, {
        email_address: email, password: pass,
        imap_host: imapHost, imap_port: Number(imapPort) || 993,
        smtp_host: smtpHost, smtp_port: Number(smtpPort) || 465
      });
      if (r.success) {
        setTest({ kind: 'ok', msg: '✓ IMAP: OK · SMTP: OK — Подключение успешно' });
        setBindOk(true);
      } else {
        const parts = [];
        if (!r.imap?.ok) parts.push('IMAP: ' + (r.imap?.error || 'ошибка'));
        if (!r.smtp?.ok) parts.push('SMTP: ' + (r.smtp?.error || 'ошибка'));
        setTest({ kind: 'err', msg: parts.join(' | ') || 'Ошибка' });
        setBindOk(false);
      }
    } catch (e) {
      setTest({ kind: 'err', msg: e.message || 'Ошибка' });
    }
  };

  const onBind = async () => {
    if (!email || !pass) { toast.error('Укажите email и пароль'); return; }
    setSaving(true);
    try {
      await bindEmail(user.id, {
        email_address: email,
        imap_password: pass, smtp_password: pass,
        imap_host: imapHost, imap_port: Number(imapPort) || 993,
        smtp_host: smtpHost, smtp_port: Number(smtpPort) || 465,
        display_name: displayName || user.name
      });
      toast.success(`Почта ${email} привязана к ${user.name}`);
      onSaved?.();
      close();
    } catch (e) {
      toast.error(e.message || 'Не удалось привязать');
    } finally {
      setSaving(false);
    }
  };

  return (
    <MCard>
      <MHead icon="📧" title={`Привязать почту — ${user.name}`} subtitle="По умолчанию настройки Яндекс Почты" onClose={() => close()} />
      <MBody>
        <div className="m-grid-2">
          <Field label="Email" required>
            <TextInput type="email" value={email} onChange={setEmail} placeholder="user@asgard-service.com" />
          </Field>
          <Field label="Пароль для IMAP/SMTP" required>
            <PasswordInput value={pass} onChange={setPass} placeholder="Пароль" />
          </Field>
        </div>

        <button className="m-btn ghost" style={{ marginTop: 8, fontSize: 12 }} onClick={() => setAdvanced(s => !s)}>
          {advanced ? '▾' : '▸'} Расширенные настройки (IMAP/SMTP)
        </button>

        {advanced && (
          <div className="m-grid-2 mt-10" >
            <Field label="IMAP хост">
              <TextInput value={imapHost} onChange={setImapHost} />
            </Field>
            <Field label="IMAP порт">
              <TextInput type="number" value={imapPort} onChange={setImapPort} />
            </Field>
            <Field label="SMTP хост">
              <TextInput value={smtpHost} onChange={setSmtpHost} />
            </Field>
            <Field label="SMTP порт">
              <TextInput type="number" value={smtpPort} onChange={setSmtpPort} />
            </Field>
            <div className="col-span-2">
              <Field label="Отображаемое имя">
                <TextInput value={displayName} onChange={setDisplayName} placeholder="Имя Фамилия" />
              </Field>
            </div>
          </div>
        )}

        {test && (
          <div className={'ur-result ' + (test.kind === 'ok' ? 'ok' : test.kind === 'busy' ? 'busy' : 'err')}>
            {test.msg}
          </div>
        )}
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={runTest}>Проверить подключение</Btn>
        <Btn variant="primary" disabled={!bindOk || saving} onClick={onBind}>
          {saving ? 'Привязка…' : 'Привязать'}
        </Btn>
      </MFoot>
    </MCard>
  );
}

/* ───────────────────────── Create Yandex Box ───────────────────────── */
export function CreateYandexModal({ user, onSaved }) {
  const { close } = useModal();
  const suggested = (user.login || '').toLowerCase().replace(/[^a-z0-9._-]/g, '');
  const [nick, setNick] = useState(suggested);
  const [pass, setPass] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(null);

  const onCreate = async () => {
    if (!nick || nick.length < 2) { toast.error('Логин ≥2 символа'); return; }
    if (!pass || pass.length < 8) { toast.error('Пароль ≥8 символов'); return; }
    setSaving(true);
    try {
      const r = await createYandexBox(user.id, { nickname: nick, password: pass });
      setDone({ email: r.email || `${nick}@asgard-service.com` });
    } catch (e) {
      toast.error(e.message || 'Не удалось создать');
    } finally {
      setSaving(false);
    }
  };

  if (done) {
    return (
      <MCard>
        <MHead icon="✓" title="Ящик создан" accent="success" onClose={() => { onSaved?.(); close(); }} />
        <MBody>
          <div className="t-center p-12">
            <div className="fs-48 mb-12">✉️</div>
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>{done.email}</div>
            <div className="c-t3 mb-16">Ящик создан и привязан к {user.name}</div>
            <div style={{ background: 'var(--ok-bg)', padding: 14, borderRadius: 12, color: 'var(--ok)', fontSize: 13 }}>
              Пользователь может войти в «Моя Почта» в CRM или через mail.yandex.ru
            </div>
          </div>
        </MBody>
        <MFoot align="center">
          <Btn variant="primary" onClick={() => { onSaved?.(); close(); }}>Готово</Btn>
        </MFoot>
      </MCard>
    );
  }

  return (
    <MCard>
      <MHead icon="✉️" title={`Создать Яндекс-ящик — ${user.name}`}
        subtitle="Создать новый ящик в Яндекс 360 для сотрудника и привязать к CRM" onClose={() => close()} />
      <MBody>
        <div className="m-grid-2">
          <Field label="Логин (nickname)" required>
            <TextInput value={nick} onChange={(v) => setNick(v.toLowerCase().replace(/[^a-z0-9._-]/g, ''))} placeholder="i.ivanov" />
          </Field>
          <Field label="Пароль (≥8 символов)" required>
            <PasswordInput value={pass} onChange={setPass} placeholder="Минимум 8 символов" />
          </Field>
        </div>
        <div style={{ marginTop: 12, padding: 12, background: 'var(--info-bg)', borderRadius: 8, fontFamily: 'ui-monospace, monospace', color: 'var(--blue)', textAlign: 'center' }}>
          {(nick || '???')}@asgard-service.com
        </div>
        <div className="mt-10 fs-12 c-t3">
          Ящик будет создан в Яндекс 360 вашей организации. Пароль также будет использоваться для IMAP/SMTP.
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={() => close()} disabled={saving}>Отмена</Btn>
        <Btn variant="primary" onClick={onCreate} disabled={saving}>
          {saving ? 'Создание…' : 'Создать и привязать'}
        </Btn>
      </MFoot>
    </MCard>
  );
}

/* ───────────────────────── Bind via Yandex 360 Admin ───────────────────────── */
export function BindYandexModal({ user, onSaved }) {
  const { close } = useModal();
  const suggested = user.email || (user.login ? user.login.toLowerCase().replace(/[^a-z0-9._-]/g, '') + '@asgard-service.com' : '');
  const [email, setEmail] = useState(suggested);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const onBind = async () => {
    if (!email || !email.includes('@')) { toast.error('Укажите корректный email'); return; }
    setBusy(true);
    setResult({ kind: 'busy', msg: 'Поиск в Яндекс 360 и сброс пароля…' });
    try {
      const r = await bindYandexBox(user.id, { email });
      setResult({ kind: 'ok', msg: `Ящик привязан: ${r.email}` });
      toast.success(`${r.email} привязан к ${user.name}`);
      setTimeout(() => { onSaved?.(); close(); }, 900);
    } catch (e) {
      setResult({ kind: 'err', msg: e.message || 'Ошибка' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <MCard>
      <MHead icon="🔗" title={`Привязать корп. ящик — ${user.name}`}
        subtitle="Через Яндекс 360 Admin API (без ввода пароля сотрудника)" onClose={() => close()} />
      <MBody>
        <Field label="Email корпоративного ящика" required>
          <TextInput value={email} onChange={setEmail} placeholder="i.ivanov@asgard-service.com" />
        </Field>
        <div style={{ marginTop: 14, padding: 12, background: 'var(--orange-bg)', border: '1px solid color-mix(in srgb, var(--amber) 30%, transparent)', borderRadius: 8, fontSize: 13, color: 'var(--amber)' }}>
          <strong>Внимание:</strong> пароль сотрудника в Яндекс будет сброшен на автоматически сгенерированный.
          Сотрудник сможет войти в почту только через CRM (Моя Почта) или запросив новый пароль у администратора.
        </div>
        {result && (
          <div className={'ur-result ' + (result.kind === 'ok' ? 'ok' : result.kind === 'busy' ? 'busy' : 'err')}>
            {result.msg}
          </div>
        )}
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={() => close()} disabled={busy}>Отмена</Btn>
        <Btn variant="primary" onClick={onBind} disabled={busy}>
          {busy ? 'Привязка…' : 'Привязать через Яндекс 360'}
        </Btn>
      </MFoot>
    </MCard>
  );
}

/* ───────────────────────── Mail Settings (existing) ───────────────────────── */
export function MailSettingsModal({ user, account, onSaved }) {
  const { close } = useModal();
  const [displayName, setDisplayName] = useState(account.display_name || '');
  const [imapHost, setImapHost] = useState(account.imap_host || 'imap.yandex.ru');
  const [imapPort, setImapPort] = useState(account.imap_port || 993);
  const [smtpHost, setSmtpHost] = useState(account.smtp_host || 'smtp.yandex.ru');
  const [smtpPort, setSmtpPort] = useState(account.smtp_port || 465);
  const [imapPass, setImapPass] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [signature, setSignature] = useState(account.signature_html || '');
  const [test, setTest] = useState(null);
  const [saving, setSaving] = useState(false);

  const onSave = async () => {
    const body = {
      display_name: displayName || null,
      signature_html: signature || null,
      imap_host: imapHost || null,
      imap_port: Number(imapPort) || null,
      smtp_host: smtpHost || null,
      smtp_port: Number(smtpPort) || null
    };
    if (imapPass) body.imap_password = imapPass;
    if (smtpPass) body.smtp_password = smtpPass;
    Object.keys(body).forEach((k) => body[k] === null && delete body[k]);
    if (Object.keys(body).length === 0) { toast.warn('Нет изменений'); return; }

    setSaving(true);
    try {
      await updateEmail(user.id, body);
      toast.success('Настройки обновлены');
      onSaved?.();
      close();
    } catch (e) {
      toast.error(e.message || 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    setTest({ kind: 'busy', msg: 'Проверка…' });
    try {
      const r = await testEmail(user.id, {});
      if (r.success || r.imap?.ok) setTest({ kind: 'ok', msg: '✓ Подключение успешно' });
      else setTest({ kind: 'err', msg: r.imap?.error || r.error || 'Ошибка подключения' });
    } catch (e) {
      setTest({ kind: 'err', msg: e.message || 'Ошибка' });
    }
  };

  return (
    <MCard>
      <MHead icon="⚙️" title={`Настройки почты — ${user.name}`} subtitle={account.email_address} onClose={() => close()} />
      <MBody>
        <div className="m-grid-2">
          <Field label="Email">
            <TextInput value={account.email_address} onChange={() => {}} disabled />
          </Field>
          <Field label="Отображаемое имя">
            <TextInput value={displayName} onChange={setDisplayName} />
          </Field>

          <Field label="IMAP хост"><TextInput value={imapHost} onChange={setImapHost} /></Field>
          <Field label="IMAP порт"><TextInput type="number" value={imapPort} onChange={setImapPort} /></Field>
          <Field label="SMTP хост"><TextInput value={smtpHost} onChange={setSmtpHost} /></Field>
          <Field label="SMTP порт"><TextInput type="number" value={smtpPort} onChange={setSmtpPort} /></Field>
          <Field label="Новый IMAP пароль"><PasswordInput value={imapPass} onChange={setImapPass} placeholder="Оставьте пустым если не менять" /></Field>
          <Field label="Новый SMTP пароль"><PasswordInput value={smtpPass} onChange={setSmtpPass} placeholder="Оставьте пустым если не менять" /></Field>

          <div className="col-span-2">
            <Field label="HTML-подпись">
              <TextareaInput value={signature} onChange={setSignature} minRows={4} maxRows={10} />
            </Field>
          </div>
        </div>

        <div style={{ marginTop: 12, fontSize: 12.5, color: 'var(--t-3)' }}>
          Статус: {account.is_active ? <span className="c-ok">Активен</span> : <span className="c-err">Неактивен</span>}
          {account.last_sync_at && <> · Последняя синхр: {timeAgo(account.last_sync_at)}</>}
          {account.last_sync_error && <> · <span className="c-err">Ошибка: {account.last_sync_error}</span></>}
        </div>

        {test && (
          <div className={'ur-result ' + (test.kind === 'ok' ? 'ok' : test.kind === 'busy' ? 'busy' : 'err')}>
            {test.msg}
          </div>
        )}
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={runTest}>Проверить подключение</Btn>
        <Btn variant="primary" onClick={onSave} disabled={saving}>
          {saving ? 'Сохраняем…' : 'Сохранить'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
