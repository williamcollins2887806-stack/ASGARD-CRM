/**
 * Модалка создания/редактирования ERP-подключения.
 * Поля: name, erp_type, connection_url, auth_type + creds (basic|bearer|apikey),
 * sync_direction, sync_interval_minutes, is_active.
 *
 * При save:
 *   • новый  → POST /api/integrations/erp/connections
 *   • правка → PUT  /api/integrations/erp/connections/:id
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { TextInput, PasswordInput, NumberInput, SelectInput, Switch } from '@/inputs/Inputs';

import { ERP_TYPES, SYNC_DIRECTIONS, AUTH_TYPES, createConnection, updateConnection } from './api';

export function ConnectionEditModal({ connection, onSaved }) {
  const { close } = useModal();
  const isEdit = !!connection?.id;

  const [name, setName] = useState(connection?.name || '');
  const [erpType, setErpType] = useState(connection?.erp_type || '1c');
  const [url, setUrl] = useState(connection?.connection_url || '');
  const [authType, setAuthType] = useState(connection?.auth_type || 'basic');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [direction, setDirection] = useState(connection?.sync_direction || 'both');
  const [intervalMin, setIntervalMin] = useState(connection?.sync_interval_minutes ?? 60);
  const [isActive, setIsActive] = useState(connection?.is_active !== false);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) {
      toast.warn('Укажите название подключения');
      return;
    }
    setSaving(true);

    const payload = {
      name: name.trim(),
      erp_type: erpType,
      connection_url: url.trim() || null,
      auth_type: authType,
      sync_direction: direction,
      sync_interval_minutes: Math.max(1, Number(intervalMin) || 60),
      is_active: isActive
    };

    // Только при создании или явном вводе передаём creds
    if (authType === 'basic' && (login || password)) {
      payload.auth_credentials = { login, password };
    } else if (authType === 'bearer' && token) {
      payload.auth_credentials = { token };
    } else if (authType === 'apikey' && apiKey) {
      payload.auth_credentials = { api_key: apiKey };
    }

    try {
      if (isEdit) {
        await updateConnection(connection.id, payload);
        toast.success('Подключение обновлено');
      } else {
        await createConnection(payload);
        toast.success('Подключение создано');
      }
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
        title={isEdit ? 'Редактировать подключение' : 'Новое ERP-подключение'}
        subtitle={isEdit ? connection?.name : '1С / SAP / Парус / свой REST'}
        onClose={close}
      />
      <MBody>
        <div className="m-grid-2">
          <div className="col-span-2">
            <Field label="Название" required>
              <TextInput value={name} onChange={setName} placeholder="1С Бухгалтерия — головной офис" />
            </Field>
          </div>

          <Field label="Тип ERP" required>
            <SelectInput value={erpType} onChange={setErpType} options={ERP_TYPES} />
          </Field>

          <Field label="Направление синхронизации">
            <SelectInput value={direction} onChange={setDirection} options={SYNC_DIRECTIONS} />
          </Field>

          <div className="col-span-2">
            <Field label="URL подключения (необязательно)">
              <TextInput
                value={url}
                onChange={setUrl}
                placeholder="https://erp.company.ru/api или оставить пустым для ручного режима"
              />
            </Field>
          </div>

          <Field label="Тип авторизации">
            <SelectInput value={authType} onChange={setAuthType} options={AUTH_TYPES} />
          </Field>

          <Field label="Интервал автосинхронизации (мин)">
            <NumberInput value={intervalMin} onChange={setIntervalMin} min={1} max={1440} step={5} />
          </Field>

          {authType === 'basic' && (
            <>
              <Field label="Логин">
                <TextInput
                  value={login}
                  onChange={setLogin}
                  placeholder={isEdit ? '(оставить пустым, чтобы не менять)' : 'admin'}
                />
              </Field>
              <Field label="Пароль">
                <PasswordInput
                  value={password}
                  onChange={setPassword}
                  placeholder={isEdit ? '(оставить пустым, чтобы не менять)' : ''}
                />
              </Field>
            </>
          )}

          {authType === 'bearer' && (
            <div className="col-span-2">
              <Field label="Bearer token">
                <PasswordInput
                  value={token}
                  onChange={setToken}
                  placeholder={isEdit ? '(оставить пустым, чтобы не менять)' : 'eyJhbGciOi…'}
                />
              </Field>
            </div>
          )}

          {authType === 'apikey' && (
            <div className="col-span-2">
              <Field label="API Key">
                <PasswordInput
                  value={apiKey}
                  onChange={setApiKey}
                  placeholder={isEdit ? '(оставить пустым, чтобы не менять)' : ''}
                />
              </Field>
            </div>
          )}

          <div className="col-span-2">
            <Switch
              checked={isActive}
              onChange={setIsActive}
              label="Подключение активно"
            />
          </div>
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
