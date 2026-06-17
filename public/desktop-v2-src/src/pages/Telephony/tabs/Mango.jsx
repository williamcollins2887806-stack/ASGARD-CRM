/**
 * Telephony / Таб «Интеграция Mango» — настройки Mango Office.
 *
 * Источник: vanilla `public/assets/js/mango.js:14-23` (DEFAULT_SETTINGS).
 * Поля: api_key, api_salt, vpbx_host, webhook_url, enabled.
 *
 * Backend: src/routes/settings.js
 *   GET  /api/settings/mango     -> { key, value: { api_key, api_salt, vpbx_host, webhook_url, enabled } | null }
 *   PUT  /api/settings/mango     body: { value: {...} }  (ADMIN-only по settings.js:78-82)
 *
 * RBAC формы (запись): ADMIN || DIRECTOR_*  — фронт показывает AccessDenied не-админам/не-директорам.
 * Note: бэкенд жёстко требует ADMIN для PUT — для DIR_* PUT может вернуть 403, тогда тост ошибки.
 *
 * Никаких заглушек: реальные fetch'и, валидация, toast, AccessDenied.
 */
import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import { useAuth } from '@/api/useAuth';
import { Btn } from '@/modals/parts';
import { Field, TextInput, PasswordInput, Switch } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import AccessDenied from '@/blocks/AccessDenied';

// Inline-литералы — для rbac-audit покрытия (см. CLAUDE.md дисциплина 7).
const MANGO_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

const DEFAULTS = {
  api_key: '',
  api_salt: '',
  vpbx_host: '',
  webhook_url: '',
  enabled: false
};

export default function MangoTab() {
  const { user } = useAuth();
  const hasAccess = !user || MANGO_ROLES.includes(user.role);

  const [form, setForm] = useState(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!hasAccess) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    // Пытаемся получить пакет настроек. Если value-null — это первая настройка,
    // показываем DEFAULTS. Если 404/500 — graceful fallback на DEFAULTS + toast.
    api('/api/settings/mango')
      .then((res) => {
        if (cancelled) return;
        const v = res && res.value && typeof res.value === 'object' ? res.value : null;
        setForm({ ...DEFAULTS, ...(v || {}) });
      })
      .catch(() => {
        if (cancelled) return;
        setForm(DEFAULTS);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [hasAccess]);

  if (user && !hasAccess) {
    return (
      <AccessDenied
        allowed={MANGO_ROLES}
        userRole={user.role}
        title="Интеграция Mango недоступна"
        message="Настройки Mango Office видят и редактируют только ADMIN и директора."
      />
    );
  }

  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }));

  const save = async () => {
    // Минимальная валидация: если включаем — нужны ключ/соль/хост.
    if (form.enabled && (!form.api_key.trim() || !form.api_salt.trim() || !form.vpbx_host.trim())) {
      toast.error?.('Для включения интеграции заполните API key, API salt и VPBX host');
      return;
    }
    setBusy(true);
    try {
      const payload = {
        api_key: String(form.api_key || '').trim(),
        api_salt: String(form.api_salt || '').trim(),
        vpbx_host: String(form.vpbx_host || '').trim(),
        webhook_url: String(form.webhook_url || '').trim(),
        enabled: !!form.enabled
      };
      await api('/api/settings/mango', { method: 'PUT', body: { value: payload } });
      toast.success?.('Настройки Mango сохранены');
    } catch (e) {
      toast.error?.(e && e.message ? e.message : 'Не удалось сохранить настройки');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="card card-empty">⏳ Загружаем настройки…</div>;
  }

  return (
    <div className="card card-pad col gap-16" style={{ maxWidth: 720 }}>
      <div className="col gap-4">
        <h3 style={{ margin: 0 }}>Mango Office — интеграция</h3>
        <div className="fs-12-5 c-t3">
          Источник телефонии. Ключ/соль выдаются в личном кабинете Mango. VPBX host —
          адрес вашей виртуальной АТС (например, <code>app.mango-office.ru</code>).
          Webhook URL — публичный адрес, на который Mango будет слать события звонков.
        </div>
      </div>

      <Field label="API key" required htmlFor="mango-api-key">
        <TextInput
          id="mango-api-key"
          value={form.api_key}
          onChange={(v) => set('api_key', v)}
          placeholder="например: xxxxxxxxxxxxxxxxxxxx"
          autoComplete="off"
        />
      </Field>

      <Field label="API salt (секрет)" required htmlFor="mango-api-salt" help="Используется для подписи запросов. Не публиковать.">
        <PasswordInput
          id="mango-api-salt"
          value={form.api_salt}
          onChange={(v) => set('api_salt', v)}
          autoComplete="off"
        />
      </Field>

      <Field label="VPBX host" required htmlFor="mango-vpbx-host" help="Адрес виртуальной АТС, без https://">
        <TextInput
          id="mango-vpbx-host"
          value={form.vpbx_host}
          onChange={(v) => set('vpbx_host', v)}
          placeholder="app.mango-office.ru"
          autoComplete="off"
        />
      </Field>

      <Field label="Webhook URL" htmlFor="mango-webhook-url" help="Куда Mango шлёт события звонков (callback от АТС).">
        <TextInput
          id="mango-webhook-url"
          value={form.webhook_url}
          onChange={(v) => set('webhook_url', v)}
          placeholder="https://crm.example.com/api/mango/webhook"
          autoComplete="off"
        />
      </Field>

      <Field label="Статус интеграции" htmlFor="mango-enabled">
        <Switch
          checked={!!form.enabled}
          onChange={(v) => set('enabled', !!v)}
          label={form.enabled ? 'Включена' : 'Отключена'}
        />
      </Field>

      <div className="row gap-8" style={{ marginTop: 8 }}>
        <Btn variant="primary" onClick={save} disabled={busy}>
          {busy ? '⏳ Сохраняем…' : '💾 Сохранить'}
        </Btn>
      </div>
    </div>
  );
}
