/**
 * ChangePasswordModal — смена пароля пользователя.
 *
 * Источник: vanilla `public/assets/js/auth.js:266` (функция changePassword)
 * + backend `src/routes/auth.js:267` (POST /api/auth/change-password).
 *
 * Backend ждёт `{currentPassword, newPassword}` (схема валидации, newPassword.minLength=6).
 *
 * Доступно ЛЮБОМУ авторизованному пользователю — открывается из Settings (через хедер)
 * и Welcome flow setup-credentials (отдельный экран, не эта модалка).
 *
 * Валидация UX:
 *   - currentPassword: непустой
 *   - newPassword: ≥6 символов
 *   - confirmPassword: совпадает с newPassword
 *   - newPassword ≠ currentPassword (защита от случайного «сменил на тот же»)
 */
import { useState } from 'react';
import { api } from '@/api/client';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { PasswordInput } from '@/inputs/Inputs';

export function ChangePasswordModal({ onSuccess }) {
  const { close } = useModal();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const minLen = newPassword.length >= 6;
  const match = newPassword === confirmPassword && newPassword.length > 0;
  const notSame = newPassword !== currentPassword || newPassword.length === 0;
  const canSubmit = currentPassword.length > 0 && minLen && match && notSame && !saving;

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      await api('/api/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword }
      });
      toast.success('Пароль успешно изменён');
      onSuccess?.();
      close();
    } catch (e) {
      // backend: 401 «Неверный текущий пароль», 404 «Пользователь не найден»
      const msg = e?.message || 'Не удалось изменить пароль';
      // Сообщения от Fastify обычно вида "HTTP 401: {...}" — вытащим суть.
      let display = msg;
      try {
        const m = msg.match(/\{.*\}/);
        if (m) {
          const j = JSON.parse(m[0]);
          if (j.error) display = j.error;
        }
      } catch { /* noop */ }
      if (e?.status === 401) display = 'Неверный текущий пароль';
      toast.error(display);
      setSaving(false);
    }
  };

  const onKey = (e) => { if (e.key === 'Enter' && canSubmit) submit(); };

  return (
    <MCard>
      <MHead
        icon="🔐"
        title="Смена пароля"
        subtitle="Введите текущий пароль, затем дважды новый"
        accent="info"
        onClose={close}
      />
      <MBody>
        <div className="m-grid-2">
          <div style={{ gridColumn: 'span 2' }}>
            <Field label="Текущий пароль" required>
              <PasswordInput
                value={currentPassword}
                onChange={setCurrentPassword}
                placeholder="Введите текущий пароль"
                autoComplete="current-password"
                onKeyDown={onKey}
                data-autofocus
              />
            </Field>
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <Field
              label="Новый пароль"
              required
              help={!newPassword ? 'Минимум 6 символов' : minLen ? '✓ длина OK' : '✗ нужно ≥6 символов'}
            >
              <PasswordInput
                value={newPassword}
                onChange={setNewPassword}
                placeholder="Не менее 6 символов"
                autoComplete="new-password"
                onKeyDown={onKey}
              />
            </Field>
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <Field
              label="Повторите новый пароль"
              required
              help={!confirmPassword ? '' : match ? '✓ совпадают' : '✗ пароли не совпадают'}
            >
              <PasswordInput
                value={confirmPassword}
                onChange={setConfirmPassword}
                placeholder="Ещё раз новый пароль"
                autoComplete="new-password"
                onKeyDown={onKey}
              />
            </Field>
          </div>
          {!notSame && newPassword.length > 0 && (
            <div style={{ gridColumn: 'span 2', color: 'var(--err)', fontSize: 12 }}>
              ⚠ Новый пароль совпадает с текущим — нужно придумать другой.
            </div>
          )}
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close} disabled={saving}>Отмена</Btn>
        <Btn variant="primary" onClick={submit} disabled={!canSubmit}>
          {saving ? 'Сохраняем…' : 'Сменить пароль'}
        </Btn>
      </MFoot>
    </MCard>
  );
}

export default ChangePasswordModal;
