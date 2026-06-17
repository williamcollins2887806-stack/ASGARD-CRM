/**
 * UserEditModal — создание / редактирование пользователя.
 * Поля: login (disabled при edit), name, patronymic, role (только ADMIN),
 *       phone, birth_date, employment_date, email, telegram_chat_id.
 * RBAC role: меняет только ADMIN.
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { TextInput, SelectInput, PhoneInput } from '@/inputs/Inputs';
import { emailError, phoneError, dateNotFutureError } from '@/inputs/validators';
import { ROLES_LIST, createUser, updateUser } from './api';

const today = () => new Date().toISOString().slice(0, 10);

export function UserEditModal({ user, isAdmin, onSaved }) {
  const { close } = useModal();
  const isEdit = !!user?.id;

  const [login, setLogin] = useState(user?.login || '');
  const [name, setName] = useState(user?.name || '');
  const [patronymic, setPatronymic] = useState(user?.patronymic || '');
  const [role, setRole] = useState(user?.role || ROLES_LIST[0].key);
  const [phone, setPhone] = useState(user?.phone || '');
  const [birth, setBirth] = useState(user?.birth_date ? String(user.birth_date).slice(0, 10) : '');
  const [emp, setEmp]     = useState(user?.employment_date ? String(user.employment_date).slice(0, 10) : (isEdit ? '' : today()));
  const [email, setEmail] = useState(user?.email || '');
  const [tg, setTg]       = useState(user?.telegram_chat_id || '');
  const [saving, setSaving] = useState(false);
  const [createdInfo, setCreatedInfo] = useState(null); // { tempPassword, telegramSent }

  // G-4: per-field валидация
  const fieldErrors = {
    email: emailError(email),
    phone: phoneError(phone),
    birth: dateNotFutureError(birth, 'Дата рождения'),
    emp:   dateNotFutureError(emp,   'Дата трудоустройства'),
    login: !isEdit && login && !/^[a-z0-9_.-]{3,32}$/i.test(login)
             ? 'Логин: латиница/цифры/_.- (3-32 симв.)' : null
  };
  const hasFieldErr = Object.values(fieldErrors).some(Boolean);

  const onSave = async () => {
    if (!isEdit) {
      if (!login || login.length < 3) { toast.error('Логин ≥3 символа'); return; }
      if (fieldErrors.login) { toast.error(fieldErrors.login); return; }
    }
    if (!name) { toast.error('Укажите имя'); return; }
    if (!isEdit && !birth) { toast.error('Укажите дату рождения'); return; }
    if (fieldErrors.email) { toast.error(fieldErrors.email); return; }
    if (fieldErrors.phone) { toast.error(fieldErrors.phone); return; }
    if (fieldErrors.birth) { toast.error(fieldErrors.birth); return; }
    if (fieldErrors.emp)   { toast.error(fieldErrors.emp); return; }

    setSaving(true);
    try {
      if (isEdit) {
        const body = {
          name, patronymic: patronymic || null,
          email: email || null, phone: phone || null,
          birth_date: birth || null, employment_date: emp || null,
          telegram_chat_id: tg || null,
        };
        if (isAdmin) body.role = role;
        await updateUser(user.id, body);
        toast.success('Сохранено');
        onSaved?.();
        close();
      } else {
        const body = {
          login: login.trim(),
          name: name.trim(), role,
          phone: phone || '',
          birth_date: birth || null,
          employment_date: emp || null,
          email: email || null,
          telegram_chat_id: tg || null,
        };
        const r = await createUser(body);
        // Показываем временный пароль вместо закрытия — потом пользователь нажмёт «Готово».
        setCreatedInfo({ tempPassword: r.tempPassword, telegramSent: r.telegramSent, name });
      }
    } catch (e) {
      toast.error(e.message || 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  if (createdInfo) {
    return (
      <MCard>
        <MHead icon="✓" title="Пользователь создан" accent="success" onClose={() => { onSaved?.(); close(); }} />
        <MBody>
          <div style={{ textAlign: 'center', padding: '16px 12px' }}>
            <div className="fs-48 mb-12">✅</div>
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 12 }}>{createdInfo.name}</div>
            <div style={{ background: 'var(--inner-bg)', padding: 16, borderRadius: 12, marginBottom: 12 }}>
              <div className="fs-12 c-t3 mb-8">Временный пароль:</div>
              <div style={{ fontSize: 22, fontWeight: 900, fontFamily: 'ui-monospace, monospace', color: 'var(--gold)', letterSpacing: 2 }}>
                {createdInfo.tempPassword}
              </div>
            </div>
            <div style={{ fontSize: 13, color: createdInfo.telegramSent ? 'var(--ok)' : 'var(--amber)' }}>
              {createdInfo.telegramSent ? '✅ Пароль отправлен в Telegram' : '⚠️ Сообщите пароль сотруднику вручную'}
            </div>
            <div className="fs-12 c-t3 mt-12">
              Почту можно привязать в карточке пользователя
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
      <MHead
        icon={isEdit ? '✎' : '+'}
        title={isEdit ? `Редактирование: ${user.name || user.login}` : 'Новый пользователь'}
        subtitle={!isEdit ? 'После создания пользователю придёт временный пароль' : null}
        onClose={() => close()}
      />
      <MBody>
        <div className="m-grid-2">
          <Field label="Логин" required={!isEdit} error={fieldErrors.login}>
            <TextInput value={login} onChange={setLogin} placeholder="ivanov" disabled={isEdit} />
          </Field>
          <Field label="Имя" required>
            <TextInput value={name} onChange={setName} placeholder="Иванов И.И." />
          </Field>

          <Field label="Отчество">
            <TextInput value={patronymic} onChange={setPatronymic} placeholder="Александрович" />
          </Field>
          <Field label="Роль" required>
            <SelectInput value={role} onChange={setRole} options={ROLES_LIST.map(r => ({ value: r.key, label: r.label }))} disabled={isEdit && !isAdmin} />
          </Field>

          <Field label="Телефон" error={fieldErrors.phone}>
            <PhoneInput value={phone} onChange={setPhone} />
          </Field>
          <Field label="Дата рождения" required={!isEdit} error={fieldErrors.birth}>
            <input className="m-input" type="date" value={birth} onChange={(e) => setBirth(e.target.value)} />
          </Field>

          <Field label="Дата трудоустройства" error={fieldErrors.emp}>
            <input className="m-input" type="date" value={emp} onChange={(e) => setEmp(e.target.value)} />
          </Field>
          <Field label="Email" error={fieldErrors.email}>
            <TextInput value={email} onChange={setEmail} placeholder="user@company.ru" type="email" />
          </Field>

          <div className="col-span-2">
            <Field label="Telegram Chat ID" help="Сотрудник пишет боту @asgard_crm_bot /start — придёт ID">
              <TextInput value={tg} onChange={setTg} placeholder="123456789" />
            </Field>
          </div>
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={() => close()} disabled={saving}>Отмена</Btn>
        <Btn variant="primary" onClick={onSave} disabled={saving || hasFieldErr}>
          {saving ? 'Сохраняем…' : (isEdit ? 'Сохранить' : 'Создать пользователя')}
        </Btn>
      </MFoot>
    </MCard>
  );
}
