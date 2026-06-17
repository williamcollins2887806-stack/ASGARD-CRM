/**
 * ChangePinModal — смена 4-значного PIN-кода.
 *
 * Источник: vanilla `public/assets/js/auth.js:284` (функция changePin)
 * + backend `src/routes/auth.js:311` (POST /api/auth/change-pin).
 *
 * Backend ждёт `{password, newPin}` (newPin pattern `^\d{4}$`, rate-limit 5/мин).
 *
 * PIN вводится виртуальной клавиатурой (как на Welcome) — тогда мобильный/планшетный
 * пользователь не ошибётся, а ввод цифр визуально совпадает с экраном логина.
 *
 * Доступно ЛЮБОМУ авторизованному пользователю.
 */
import { useState } from 'react';
import { api } from '@/api/client';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { PasswordInput } from '@/inputs/Inputs';
import { PinKeypad } from '../../Welcome/PinKeypad';

export function ChangePinModal({ onSuccess }) {
  const { close } = useModal();
  const [password, setPassword] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [saving, setSaving] = useState(false);

  const validPin = /^\d{4}$/.test(newPin);
  const match = newPin === confirmPin && validPin;
  const canSubmit = password.length > 0 && validPin && match && !saving;

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      await api('/api/auth/change-pin', {
        method: 'POST',
        body: { password, newPin }
      });
      toast.success('PIN успешно изменён');
      onSuccess?.();
      close();
    } catch (e) {
      let display = e?.message || 'Не удалось изменить PIN';
      try {
        const m = display.match(/\{.*\}/);
        if (m) {
          const j = JSON.parse(m[0]);
          if (j.error) display = j.error;
        }
      } catch { /* noop */ }
      if (e?.status === 401) display = 'Неверный пароль';
      else if (e?.status === 429) display = 'Слишком много попыток. Попробуйте через минуту.';
      toast.error(display);
      setSaving(false);
    }
  };

  return (
    <MCard>
      <MHead
        icon="🔢"
        title="Смена PIN-кода"
        subtitle="Подтвердите пароль и введите новый 4-значный PIN"
        accent="info"
        onClose={close}
      />
      <MBody>
        <Field label="Пароль" required help="Нужно подтвердить, что это вы">
          <PasswordInput
            value={password}
            onChange={setPassword}
            placeholder="Текущий пароль"
            autoComplete="current-password"
            data-autofocus
          />
        </Field>

        <div className="m-field" style={{ marginTop: 16 }}>
          <label>Новый PIN <span className="req">*</span></label>
          <PinKeypad
            length={4}
            autoSubmit={false}
            onChange={setNewPin}
            hint={validPin ? '✓ 4 цифры' : 'Четыре цифры'}
          />
        </div>

        <div className="m-field" style={{ marginTop: 16 }}>
          <label>Повторите PIN <span className="req">*</span></label>
          <PinKeypad
            length={4}
            autoSubmit={false}
            onChange={setConfirmPin}
            hint={!confirmPin ? '' : match ? '✓ совпадают' : confirmPin.length === 4 ? '✗ не совпадают' : '…'}
            status={confirmPin.length === 4 && !match ? 'err' : 'idle'}
          />
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close} disabled={saving}>Отмена</Btn>
        <Btn variant="primary" onClick={submit} disabled={!canSubmit}>
          {saving ? 'Сохраняем…' : 'Сменить PIN'}
        </Btn>
      </MFoot>
    </MCard>
  );
}

export default ChangePinModal;
