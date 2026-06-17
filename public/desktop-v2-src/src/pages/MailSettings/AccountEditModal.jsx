/**
 * Модалка создания/редактирования email-аккаунта.
 * Поля: name/email + IMAP + SMTP + параметры синхронизации.
 * Тестовые кнопки IMAP / SMTP — POST /api/mailbox/accounts/test-imap | test-smtp.
 *
 * При сохранении пароль НЕ перезаписывается, если поле пустое (редактирование).
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { TextInput, PasswordInput, NumberInput, Switch } from '@/inputs/Inputs';

import { createAccount, updateAccount, testImap, testSmtp } from './api';

// Имя файла = имя экспорта, чтобы coverage-audit нашёл и не пометил как unused.
// Совместимость: alias `AccountModal` для импортов под старым именем (vanilla `openAccountModal`).
export { AccountEditModal as AccountModal };
export function AccountEditModal({ account, onSaved }) {
  const { close } = useModal();
  const isEdit = !!account?.id;

  const a = account || {};
  const [name, setName] = useState(a.name || '');
  const [email, setEmail] = useState(a.email_address || '');

  const [imapHost, setImapHost] = useState(a.imap_host || '');
  const [imapPort, setImapPort] = useState(a.imap_port ?? 993);
  const [imapUser, setImapUser] = useState(a.imap_user || '');
  const [imapPass, setImapPass] = useState('');
  const [imapTls, setImapTls] = useState(a.imap_tls !== false);
  const [imapFolder, setImapFolder] = useState(a.imap_folder || 'INBOX');

  const [smtpHost, setSmtpHost] = useState(a.smtp_host || '');
  const [smtpPort, setSmtpPort] = useState(a.smtp_port ?? 587);
  const [smtpUser, setSmtpUser] = useState(a.smtp_user || '');
  const [smtpPass, setSmtpPass] = useState('');
  const [smtpTls, setSmtpTls] = useState(a.smtp_tls !== false);
  const [smtpFromName, setSmtpFromName] = useState(a.smtp_from_name || 'ООО «Асгард Сервис»');

  const [syncEnabled, setSyncEnabled] = useState(a.sync_enabled !== false);
  const [syncInterval, setSyncInterval] = useState(a.sync_interval_sec ?? 120);
  const [syncMax, setSyncMax] = useState(a.sync_max_emails ?? 200);
  const [isActive, setIsActive] = useState(a.is_active !== false);

  const [testingImap, setTestingImap] = useState(false);
  const [testingSmtp, setTestingSmtp] = useState(false);
  const [saving, setSaving] = useState(false);

  const onTestImap = async () => {
    setTestingImap(true);
    try {
      const r = await testImap({
        imap_host: imapHost,
        imap_port: Number(imapPort) || 993,
        imap_user: imapUser,
        imap_pass: imapPass,
        imap_tls: imapTls,
        imap_folder: imapFolder || 'INBOX'
      });
      if (r?.success) {
        toast.success(
          `IMAP OK · ${r.messages ?? '—'} писем · ${r.unseen ?? '—'} непрочитанных`
        );
      } else {
        toast.error('IMAP ошибка: ' + (r?.error || 'unknown'));
      }
    } catch (e) {
      toast.error('IMAP ошибка: ' + (e?.message || e));
    } finally {
      setTestingImap(false);
    }
  };

  const onTestSmtp = async () => {
    setTestingSmtp(true);
    try {
      const r = await testSmtp({
        smtp_host: smtpHost,
        smtp_port: Number(smtpPort) || 587,
        smtp_user: smtpUser,
        smtp_pass: smtpPass,
        smtp_tls: smtpTls
      });
      if (r?.success) toast.success(r?.message || 'SMTP OK');
      else toast.error('SMTP ошибка: ' + (r?.error || 'unknown'));
    } catch (e) {
      toast.error('SMTP ошибка: ' + (e?.message || e));
    } finally {
      setTestingSmtp(false);
    }
  };

  const submit = async () => {
    if (!name.trim() || !email.trim()) {
      toast.warn('Заполните название и email');
      return;
    }
    setSaving(true);

    const body = {
      name: name.trim(),
      email_address: email.trim(),
      imap_host: imapHost.trim(),
      imap_port: Number(imapPort) || 993,
      imap_user: imapUser.trim(),
      imap_tls: imapTls,
      imap_folder: imapFolder || 'INBOX',
      smtp_host: smtpHost.trim(),
      smtp_port: Number(smtpPort) || 587,
      smtp_user: smtpUser.trim(),
      smtp_tls: smtpTls,
      smtp_from_name: smtpFromName.trim(),
      sync_enabled: syncEnabled,
      sync_interval_sec: Math.max(10, Number(syncInterval) || 120),
      sync_max_emails: Math.max(1, Number(syncMax) || 200),
      is_active: isActive
    };

    if (imapPass) body.imap_pass = imapPass;
    if (smtpPass) body.smtp_pass = smtpPass;

    try {
      if (isEdit) await updateAccount(account.id, body);
      else        await createAccount(body);
      toast.success(isEdit ? 'Аккаунт обновлён' : 'Аккаунт создан');
      onSaved?.();
      close();
    } catch (e) {
      toast.error('Не удалось сохранить: ' + (e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <MCard>
      <MHead
        icon={isEdit ? '✎' : '＋'}
        title={isEdit ? 'Редактирование email-аккаунта' : 'Новый email-аккаунт'}
        subtitle={isEdit ? account.email_address : 'IMAP/SMTP подключение к почтовому ящику'}
        onClose={close}
      />
      <MBody>
        {/* — Основное — */}
        <div className="ms-formgrid">
          <Field label="Название" required>
            <TextInput value={name} onChange={setName} placeholder="Основной ящик" />
          </Field>
          <Field label="Email" required>
            <TextInput value={email} onChange={setEmail} placeholder="info@company.ru" />
          </Field>
        </div>

        {/* — IMAP — */}
        <div className="ms-section-title">📥 IMAP — получение</div>
        <div className="ms-formgrid">
          <div className="span-2">
            <Field label="IMAP-хост" required>
              <TextInput value={imapHost} onChange={setImapHost} placeholder="imap.yandex.ru" />
            </Field>
          </div>
          <Field label="Порт">
            <NumberInput value={imapPort} onChange={setImapPort} min={1} max={65535} step={1} />
          </Field>
          <Field label="Папка IMAP">
            <TextInput value={imapFolder} onChange={setImapFolder} placeholder="INBOX" />
          </Field>
          <Field label="Логин IMAP">
            <TextInput value={imapUser} onChange={setImapUser} placeholder="info@company.ru" />
          </Field>
          <Field label="Пароль IMAP" help={isEdit ? 'оставить пустым, чтобы не менять' : undefined}>
            <PasswordInput
              value={imapPass}
              onChange={setImapPass}
              placeholder={isEdit ? '(оставить пустым)' : ''}
            />
          </Field>
          <div className="span-2 row-spread gap-10" >
            <Switch checked={imapTls} onChange={setImapTls} label="TLS/SSL включён" />
            <Btn variant="ghost" size="sm" onClick={onTestImap} disabled={testingImap}>
              {testingImap ? '⏳ Тест…' : '🛰 Тест IMAP'}
            </Btn>
          </div>
        </div>

        {/* — SMTP — */}
        <div className="ms-section-title">📤 SMTP — отправка</div>
        <div className="ms-formgrid">
          <div className="span-2">
            <Field label="SMTP-хост" required>
              <TextInput value={smtpHost} onChange={setSmtpHost} placeholder="smtp.yandex.ru" />
            </Field>
          </div>
          <Field label="Порт">
            <NumberInput value={smtpPort} onChange={setSmtpPort} min={1} max={65535} step={1} />
          </Field>
          <Field label="Имя отправителя">
            <TextInput value={smtpFromName} onChange={setSmtpFromName} />
          </Field>
          <Field label="Логин SMTP">
            <TextInput value={smtpUser} onChange={setSmtpUser} placeholder="info@company.ru" />
          </Field>
          <Field label="Пароль SMTP" help={isEdit ? 'оставить пустым, чтобы не менять' : undefined}>
            <PasswordInput
              value={smtpPass}
              onChange={setSmtpPass}
              placeholder={isEdit ? '(оставить пустым)' : ''}
            />
          </Field>
          <div className="span-2 row-spread gap-10" >
            <Switch checked={smtpTls} onChange={setSmtpTls} label="TLS/SSL включён" />
            <Btn variant="ghost" size="sm" onClick={onTestSmtp} disabled={testingSmtp}>
              {testingSmtp ? '⏳ Тест…' : '🛰 Тест SMTP'}
            </Btn>
          </div>
        </div>

        {/* — Синхронизация — */}
        <div className="ms-section-title">⚙️ Синхронизация</div>
        <div className="ms-formgrid">
          <Field label="Интервал, сек">
            <NumberInput
              value={syncInterval}
              onChange={setSyncInterval}
              min={10} max={3600} step={10}
            />
          </Field>
          <Field label="Макс. писем за раз">
            <NumberInput value={syncMax} onChange={setSyncMax} min={1} max={5000} step={10} />
          </Field>
          <Switch checked={syncEnabled} onChange={setSyncEnabled} label="Синхронизация включена" />
          <Switch checked={isActive} onChange={setIsActive} label="Аккаунт активен" />
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" onClick={submit} disabled={saving}>
          {saving ? 'Сохраняем…' : isEdit ? 'Сохранить' : 'Создать'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
