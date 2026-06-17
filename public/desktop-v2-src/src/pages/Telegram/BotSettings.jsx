/**
 * Вкладка «Настройки бота» — токен, username, webhook, флаг enabled,
 * кнопка «Проверить бота» (вызов /check-bot).
 *
 * Безопасность: с сервера приходит только маскированный токен (`...wxyz`).
 * Поле ввода токена — пустое; если оставить пустым при сохранении, текущий
 * токен сохраняется. Если ввести новый — он перезапишет предыдущий.
 */
import { useEffect, useState } from 'react';
import { Field, TextInput, PasswordInput, Switch } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { fetchSettings, saveSettings, checkBot } from './api';

export default function BotSettings() {
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [tokenMask, setTokenMask] = useState('');
  const [hasToken, setHasToken] = useState(false);
  const [newToken, setNewToken] = useState('');
  const [botUsername, setBotUsername] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [botInfo, setBotInfo] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const s = await fetchSettings();
        setTokenMask(s.bot_token_mask || '');
        setHasToken(Boolean(s.has_token));
        setBotUsername(s.bot_username || '');
        setWebhookUrl(s.webhook_url || '');
        setEnabled(s.enabled !== false);
        setUpdatedAt(s.updated_at || null);
      } catch (e) {
        toast.error('Не удалось загрузить настройки: ' + (e.message || e));
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const body = {
        bot_username: botUsername,
        webhook_url: webhookUrl,
        enabled
      };
      // Передаём token только если ввели новый.
      if (newToken && newToken.trim()) body.bot_token = newToken.trim();

      const s = await saveSettings(body);
      setTokenMask(s.bot_token_mask || '');
      setHasToken(Boolean(s.has_token));
      setBotUsername(s.bot_username || '');
      setWebhookUrl(s.webhook_url || '');
      setEnabled(s.enabled !== false);
      setUpdatedAt(s.updated_at || null);
      setNewToken('');
      toast.success('Настройки сохранены' + (s.restarted ? ' (бот перезапущен)' : ''));
    } catch (e) {
      toast.error('Не удалось сохранить: ' + (e.message || e));
    } finally {
      setSaving(false);
    }
  }

  async function handleCheck() {
    setChecking(true);
    setBotInfo(null);
    try {
      const info = await checkBot();
      setBotInfo(info);
      if (info.username && info.username !== botUsername) setBotUsername(info.username);
      toast.success('Бот в порядке: @' + (info.username || info.first_name || info.id));
    } catch (e) {
      toast.error('Проверка не удалась: ' + (e.message || e));
    } finally {
      setChecking(false);
    }
  }

  if (!loaded) {
    return <div className="card p-16 c-t3">⏳ Загружаем настройки…</div>;
  }

  const updatedHuman = updatedAt
    ? new Date(updatedAt).toLocaleString('ru-RU')
    : '—';

  return (
    <div className="card p-16 col gap-16" style={{ maxWidth: 720 }}>
      <div className="row gap-12 ai-center">
        <span style={{ fontSize: 28 }}>🤖</span>
        <div className="col">
          <div className="t-h3">Настройки Telegram-бота</div>
          <div className="c-t3 t-small">
            Бот: {hasToken ? <span className="c-ok">подключён ({tokenMask})</span> : <span className="c-err">не настроен</span>}
            {botUsername ? <span> · @{botUsername}</span> : null}
            <span> · обновлено: {updatedHuman}</span>
          </div>
        </div>
      </div>

      <Field
        label={hasToken ? 'Новый токен бота (оставьте пустым, чтобы не менять)' : 'Токен бота'}
        help="Получите у @BotFather в Telegram"
        htmlFor="tg-token"
      >
        <PasswordInput
          id="tg-token"
          value={newToken}
          onChange={setNewToken}
          placeholder={hasToken ? tokenMask : '123456789:ABCdefGHIjklmno...'}
        />
      </Field>

      <Field
        label="Username бота (без @)"
        help="Подставится автоматически при проверке"
        htmlFor="tg-username"
      >
        <TextInput
          id="tg-username"
          value={botUsername}
          onChange={setBotUsername}
          placeholder="asgard_crm_bot"
        />
      </Field>

      <Field
        label="Webhook URL (опционально)"
        help="Если задан — Telegram будет слать обновления HTTPS-вебхуком вместо polling"
        htmlFor="tg-webhook"
      >
        <TextInput
          id="tg-webhook"
          type="url"
          value={webhookUrl}
          onChange={setWebhookUrl}
          placeholder="https://your-server.com/api/tg/webhook"
        />
      </Field>

      <div className="row gap-12 ai-center">
        <Switch checked={enabled} onChange={setEnabled} label="Уведомления включены" />
      </div>

      <div className="row gap-12">
        <button className="btn primary" onClick={handleSave} disabled={saving}>
          {saving ? '⏳ Сохраняем…' : '💾 Сохранить'}
        </button>
        <button
          className="btn ghost"
          onClick={handleCheck}
          disabled={checking || !hasToken}
          title={!hasToken ? 'Сначала сохраните токен' : 'Запрос getMe к Telegram API'}
        >
          {checking ? '⏳ Проверяем…' : '🔌 Проверить бота'}
        </button>
      </div>

      {botInfo && botInfo.ok && (
        <div className="card p-12" style={{ background: 'var(--bg-elevated, #f0f9ff)', borderLeft: '4px solid var(--ok, #16a34a)' }}>
          <div className="t-h4 c-ok">✅ Бот отвечает</div>
          <div className="t-small">
            <div>ID: <code>{botInfo.id}</code></div>
            <div>Username: <code>@{botInfo.username}</code></div>
            <div>Имя: <strong>{botInfo.first_name}</strong></div>
            <div className="c-t3">
              Может присоединяться к группам: {botInfo.can_join_groups ? 'да' : 'нет'} ·
              Inline-режим: {botInfo.supports_inline_queries ? 'да' : 'нет'}
            </div>
          </div>
        </div>
      )}

      <div className="card p-12 t-small c-t3" style={{ background: 'var(--bg-elevated, #fafafa)' }}>
        <div className="t-h4">💡 Как использовать</div>
        <ol style={{ marginLeft: 16, lineHeight: 1.6 }}>
          <li>Создайте бота через <strong>@BotFather</strong> в Telegram и получите токен.</li>
          <li>Вставьте токен в поле выше и нажмите «Сохранить».</li>
          <li>Нажмите «Проверить бота» — username подтянется автоматически.</li>
          <li>Перейдите во вкладку «Пользователи» и привяжите Chat ID коллегам.</li>
          <li>Chat ID можно узнать у бота <strong>@userinfobot</strong> или попросив коллегу написать <code>/start</code> вашему боту.</li>
        </ol>
      </div>
    </div>
  );
}
