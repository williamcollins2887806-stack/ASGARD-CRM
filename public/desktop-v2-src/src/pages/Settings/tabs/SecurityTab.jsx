/**
 * Settings → таб «AI и безопасность»:
 *   1. YandexGPT / OpenAI / Anthropic — выбор провайдера + ключи + тест-запрос
 *   2. Push-уведомления — подписка/отписка
 *   3. WebAuthn — список устройств (биометрия / ключи безопасности) + добавление
 *
 * Backend:
 *   • /api/admin/system/ai-config (GET/POST), /ai-test (POST)
 *   • /api/push/vapid-key, /subscribe, /unsubscribe
 *   • /api/webauthn/register/options + /register/verify, /credentials (GET/DELETE/PATCH)
 */
import { useEffect, useState, useCallback } from 'react';
import { useModal, ConfirmModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn, Field, Input, Select } from '@/modals/parts';
import {
  loadAiConfig, saveAiConfig, testAi,
  pushIsSupported, pushPermission, pushGetCurrentSubscription,
  pushSubscribe, pushUnsubscribe,
  webauthnIsSupported, webauthnList, webauthnDelete, webauthnRename, webauthnRegister
} from '../api';

const PROVIDERS = [
  { value: 'openai',    label: 'OpenAI / routerai (по умолчанию)' },
  { value: 'anthropic', label: 'Anthropic Claude (нативный API)' },
  { value: 'yandexgpt', label: 'YandexGPT / Yandex Cloud' }
];

const YANDEX_MODELS = [
  { value: 'qwen3-235b-a22b-fp8/latest', label: 'Qwen3-235B (через Yandex Cloud)' },
  { value: 'yandexgpt/latest',           label: 'YandexGPT Pro (Foundation)' },
  { value: 'yandexgpt-32k/latest',       label: 'YandexGPT 32k (Foundation)' },
  { value: 'yandexgpt-lite/latest',      label: 'YandexGPT Lite' }
];

export default function SecurityTab({ user }) {
  const modal = useModal();

  /* ── 1. AI ───────────────────────────────────────────────────────────── */
  const [ai, setAi] = useState(null);
  const [aiForm, setAiForm] = useState({
    provider: 'openai',
    anthropic_model: '',
    openai_model: '',
    openai_url: '',
    yandex_folder_id: '',
    yandex_model: 'qwen3-235b-a22b-fp8/latest',
    anthropic_api_key: '',
    openai_api_key: '',
    yandex_gpt_api_key: ''
  });
  const [aiSaving, setAiSaving] = useState(false);
  const [aiTesting, setAiTesting] = useState(false);
  const [aiTestResult, setAiTestResult] = useState(null);
  const [aiTestProvider, setAiTestProvider] = useState('auto');

  const refreshAi = useCallback(() => {
    loadAiConfig()
      .then((r) => {
        setAi(r);
        setAiForm((f) => ({
          ...f,
          provider:         r.provider         || 'openai',
          anthropic_model:  r.anthropic_model  || '',
          openai_model:     r.openai_model     || '',
          openai_url:       r.openai_url       || '',
          yandex_folder_id: r.yandex_folder_id || '',
          yandex_model:     r.yandex_model     || 'qwen3-235b-a22b-fp8/latest'
        }));
      })
      .catch((e) => toast.error('AI-конфиг: ' + (e?.message || e)));
  }, []);

  useEffect(() => { refreshAi(); }, [refreshAi]);

  const onSaveAi = async () => {
    setAiSaving(true);
    try {
      const payload = {
        provider:         aiForm.provider,
        anthropic_model:  aiForm.anthropic_model,
        openai_model:     aiForm.openai_model,
        openai_url:       aiForm.openai_url,
        yandex_folder_id: aiForm.yandex_folder_id,
        yandex_model:     aiForm.yandex_model
      };
      // Ключи — только если введены непустые (форма не показывает существующие)
      if (aiForm.anthropic_api_key.trim())  payload.anthropic_api_key  = aiForm.anthropic_api_key.trim();
      if (aiForm.openai_api_key.trim())     payload.openai_api_key     = aiForm.openai_api_key.trim();
      if (aiForm.yandex_gpt_api_key.trim()) payload.yandex_gpt_api_key = aiForm.yandex_gpt_api_key.trim();

      await saveAiConfig(payload);
      toast.success('AI-настройки сохранены');
      setAiForm((f) => ({ ...f, anthropic_api_key: '', openai_api_key: '', yandex_gpt_api_key: '' }));
      refreshAi();
    } catch (e) {
      toast.error('Не удалось сохранить AI-настройки: ' + (e?.message || e));
    } finally {
      setAiSaving(false);
    }
  };

  const onClearKey = (which) => {
    modal.open(
      <ConfirmModal
        title="Удалить ключ?"
        message={`Очистить сохранённый ${which.toUpperCase()} API-ключ из настроек?`}
        tone="warn"
        okText="Удалить"
        cancelText="Отмена"
        onConfirm={async () => {
          try {
            const payload = {};
            if (which === 'anthropic') payload.clear_anthropic_key = true;
            if (which === 'openai')    payload.clear_openai_key    = true;
            if (which === 'yandex')    payload.clear_yandex_key    = true;
            await saveAiConfig(payload);
            toast.success('Ключ удалён');
            refreshAi();
          } catch (e) {
            toast.error('Не удалось: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  const onTestAi = async () => {
    setAiTesting(true);
    setAiTestResult(null);
    try {
      const r = await testAi({ provider: aiTestProvider });
      if (r?.ok) {
        setAiTestResult({
          ok: true,
          text: r.text || '',
          info: `${r.provider || '?'} · ${r.model || '?'} · ${r.ms} мс`
        });
      } else {
        setAiTestResult({ ok: false, text: r?.error || 'Ошибка', info: '' });
      }
    } catch (e) {
      setAiTestResult({ ok: false, text: e?.message || String(e), info: '' });
    } finally {
      setAiTesting(false);
    }
  };

  /* ── 2. Push ─────────────────────────────────────────────────────────── */
  const [pushSupported] = useState(pushIsSupported());
  const [pushPerm, setPushPerm] = useState(pushPermission());
  const [pushSubscribed, setPushSubscribed] = useState(null); // null=loading, bool=known
  const [pushBusy, setPushBusy] = useState(false);

  const refreshPush = useCallback(async () => {
    if (!pushSupported) { setPushSubscribed(false); return; }
    setPushPerm(pushPermission());
    const sub = await pushGetCurrentSubscription();
    setPushSubscribed(!!sub);
  }, [pushSupported]);

  useEffect(() => { refreshPush(); }, [refreshPush]);

  const onPushOn = async () => {
    setPushBusy(true);
    try {
      const r = await pushSubscribe();
      if (r.ok) {
        toast.success('Push-уведомления включены');
      } else if (r.reason === 'denied') {
        toast.warn('Разрешение на уведомления не выдано');
      } else if (r.reason === 'unsupported') {
        toast.warn('Браузер не поддерживает push');
      } else if (r.reason === 'no_vapid_key') {
        toast.error('Сервер не вернул VAPID ключ — обратитесь к админу');
      } else {
        toast.error('Не удалось подключить: ' + (r.reason || 'ошибка'));
      }
      await refreshPush();
    } finally {
      setPushBusy(false);
    }
  };

  const onPushOff = async () => {
    setPushBusy(true);
    try {
      const r = await pushUnsubscribe();
      if (r.ok) {
        toast.success('Подписка снята');
      } else {
        toast.error('Не удалось: ' + (r.reason || 'ошибка'));
      }
      await refreshPush();
    } finally {
      setPushBusy(false);
    }
  };

  /* ── 3. WebAuthn ─────────────────────────────────────────────────────── */
  const [waSupported, setWaSupported] = useState(false);
  const [waList, setWaList] = useState([]);
  const [waLoading, setWaLoading] = useState(true);
  const [waBusy, setWaBusy] = useState(false);

  const refreshWa = useCallback(async () => {
    setWaLoading(true);
    try {
      setWaSupported(await webauthnIsSupported());
      const list = await webauthnList();
      setWaList(list);
    } catch (e) {
      toast.error('Не удалось загрузить ключи: ' + (e?.message || e));
    } finally {
      setWaLoading(false);
    }
  }, []);

  useEffect(() => { refreshWa(); }, [refreshWa]);

  const onAddKey = async () => {
    setWaBusy(true);
    try {
      const name = window.prompt('Название ключа (например: «iPhone Никиты»):', '');
      if (name === null) return; // Отмена
      const trimmed = (name || '').trim();
      await webauthnRegister(trimmed || undefined);
      toast.success('Ключ безопасности добавлен');
      refreshWa();
    } catch (e) {
      if (String(e?.message || '').includes('Отменено')) return;
      toast.error('Не удалось добавить ключ: ' + (e?.message || e));
    } finally {
      setWaBusy(false);
    }
  };

  const onDeleteKey = (cred) => {
    modal.open(
      <ConfirmModal
        title="Удалить ключ?"
        message={`Устройство «${cred.device_name || '—'}» больше не сможет входить без пароля.`}
        tone="danger"
        okText="Удалить"
        cancelText="Отмена"
        onConfirm={async () => {
          try {
            await webauthnDelete(cred.id);
            toast.success('Ключ удалён');
            refreshWa();
          } catch (e) {
            toast.error('Не удалось: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  const onRenameKey = async (cred, newName) => {
    if (!newName || newName.trim() === (cred.device_name || '').trim()) return;
    try {
      await webauthnRename(cred.id, newName.trim());
      toast.success('Переименовано');
      refreshWa();
    } catch (e) {
      toast.error('Не удалось: ' + (e?.message || e));
    }
  };

  const fmtDate = (iso) => {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString('ru-RU'); } catch { return '—'; }
  };

  return (
    <div className="sett-grid">
      {/* ───────────── 1. AI ───────────── */}
      <div className="sett-card">
        <h3>🤖 AI-ассистент</h3>
        <p className="sett-hint">
          Подключение к AI-провайдеру. Используется Мимиром, авто-просчётом, анализом
          входящих, отчётами по звонкам, голосовым секретарём.
        </p>

        <div className="sett-row">
          <Field label="Активный провайдер" htmlFor="ai-provider">
            <Select
              id="ai-provider"
              value={aiForm.provider}
              onChange={(e) => setAiForm({ ...aiForm, provider: e.target.value })}
            >
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </Select>
          </Field>
        </div>

        {/* OpenAI/routerai */}
        <fieldset className="sett-fieldset">
          <legend>OpenAI / routerai</legend>
          <div className="sett-row">
            <Field label="Модель (openai_model)" htmlFor="ai-openai-model">
              <Input
                id="ai-openai-model"
                value={aiForm.openai_model}
                onChange={(e) => setAiForm({ ...aiForm, openai_model: e.target.value })}
                placeholder="anthropic/claude-opus-4.6"
              />
            </Field>
            <Field label="URL (openai_url)" htmlFor="ai-openai-url">
              <Input
                id="ai-openai-url"
                value={aiForm.openai_url}
                onChange={(e) => setAiForm({ ...aiForm, openai_url: e.target.value })}
                placeholder="https://routerai.ru/api/v1/chat/completions"
              />
            </Field>
          </div>
          <div className="sett-row">
            <Field label={`API-ключ ${ai?.openai_key_mask ? `(текущий: ${ai.openai_key_mask})` : ''}`} htmlFor="ai-openai-key">
              <Input
                id="ai-openai-key"
                type="password"
                value={aiForm.openai_api_key}
                onChange={(e) => setAiForm({ ...aiForm, openai_api_key: e.target.value })}
                placeholder={ai?.hasOpenAIKey ? 'Оставьте пустым чтобы не менять' : 'sk-…'}
                autoComplete="new-password"
              />
            </Field>
            {ai?.hasOpenAIKey && (
              <div className="sett-field-action">
                <Btn variant="ghost" onClick={() => onClearKey('openai')}>Удалить ключ</Btn>
              </div>
            )}
          </div>
        </fieldset>

        {/* Anthropic */}
        <fieldset className="sett-fieldset">
          <legend>Anthropic (нативный Claude API)</legend>
          <div className="sett-row">
            <Field label="Модель (anthropic_model)" htmlFor="ai-anthropic-model">
              <Input
                id="ai-anthropic-model"
                value={aiForm.anthropic_model}
                onChange={(e) => setAiForm({ ...aiForm, anthropic_model: e.target.value })}
                placeholder="claude-opus-4-7"
              />
            </Field>
            <Field label={`API-ключ ${ai?.anthropic_key_mask ? `(текущий: ${ai.anthropic_key_mask})` : ''}`} htmlFor="ai-anthropic-key">
              <Input
                id="ai-anthropic-key"
                type="password"
                value={aiForm.anthropic_api_key}
                onChange={(e) => setAiForm({ ...aiForm, anthropic_api_key: e.target.value })}
                placeholder={ai?.hasAnthropicKey ? 'Оставьте пустым чтобы не менять' : 'sk-ant-…'}
                autoComplete="new-password"
              />
            </Field>
            {ai?.hasAnthropicKey && (
              <div className="sett-field-action">
                <Btn variant="ghost" onClick={() => onClearKey('anthropic')}>Удалить ключ</Btn>
              </div>
            )}
          </div>
        </fieldset>

        {/* YandexGPT */}
        <fieldset className="sett-fieldset">
          <legend>🟡 YandexGPT / Yandex Cloud Foundation Models</legend>
          <p className="sett-hint">
            Получите ключи в{' '}
            <a href="https://console.cloud.yandex.ru" target="_blank" rel="noreferrer">
              Yandex Cloud Console
            </a>
            . Folder ID — из настроек каталога. Сервисный аккаунт → роль{' '}
            <code>ai.languageModels.user</code> → API-ключ.
          </p>
          <div className="sett-row">
            <Field label="Folder ID" htmlFor="ai-yandex-folder">
              <Input
                id="ai-yandex-folder"
                value={aiForm.yandex_folder_id}
                onChange={(e) => setAiForm({ ...aiForm, yandex_folder_id: e.target.value })}
                placeholder="b1gxxxxxxxxxx"
              />
            </Field>
            <Field label="Модель YandexGPT" htmlFor="ai-yandex-model">
              <Select
                id="ai-yandex-model"
                value={aiForm.yandex_model}
                onChange={(e) => setAiForm({ ...aiForm, yandex_model: e.target.value })}
              >
                {YANDEX_MODELS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="sett-row">
            <Field label={`API-ключ ${ai?.yandex_key_mask ? `(текущий: ${ai.yandex_key_mask})` : ''}`} htmlFor="ai-yandex-key">
              <Input
                id="ai-yandex-key"
                type="password"
                value={aiForm.yandex_gpt_api_key}
                onChange={(e) => setAiForm({ ...aiForm, yandex_gpt_api_key: e.target.value })}
                placeholder={ai?.hasYandexKey ? 'Оставьте пустым чтобы не менять' : 'AQVN…'}
                autoComplete="new-password"
              />
            </Field>
            {ai?.hasYandexKey && (
              <div className="sett-field-action">
                <Btn variant="ghost" onClick={() => onClearKey('yandex')}>Удалить ключ</Btn>
              </div>
            )}
          </div>
        </fieldset>

        <div className="sett-toolbar">
          <Btn onClick={onSaveAi} disabled={aiSaving}>
            {aiSaving ? 'Сохраняем…' : '💾 Сохранить настройки AI'}
          </Btn>
        </div>

        <hr className="sett-sep" />

        <h4 style={{ margin: '0 0 8px 0' }}>🧪 Тест подключения</h4>
        <p className="sett-hint">
          Отправляет короткий запрос «Ответь одной фразой» текущему провайдеру и
          показывает ответ. Идёт без расхода токенов на размышление.
        </p>
        <div className="sett-row">
          <Field label="Кого тестируем" htmlFor="ai-test-provider">
            <Select
              id="ai-test-provider"
              value={aiTestProvider}
              onChange={(e) => setAiTestProvider(e.target.value)}
            >
              <option value="auto">Активного провайдера (auto)</option>
              <option value="openai">openai / routerai</option>
              <option value="anthropic">anthropic</option>
              <option value="yandexgpt">yandexgpt</option>
            </Select>
          </Field>
          <div className="sett-field-action">
            <Btn onClick={onTestAi} disabled={aiTesting}>
              {aiTesting ? '⏳ Запрос…' : '🚀 Отправить тест'}
            </Btn>
          </div>
        </div>

        {aiTestResult && (
          <div
            className={'sett-ai-test ' + (aiTestResult.ok ? 'ok' : 'err')}
            style={{
              marginTop: 10,
              padding: 12,
              borderRadius: 8,
              border: '1px solid ' + (aiTestResult.ok ? 'rgba(34,197,94,.4)' : 'rgba(239,68,68,.4)'),
              background: aiTestResult.ok ? 'rgba(34,197,94,.07)' : 'rgba(239,68,68,.07)'
            }}
          >
            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>
              {aiTestResult.ok ? `✅ Успех · ${aiTestResult.info}` : '⛔ Ошибка'}
            </div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{aiTestResult.text}</div>
          </div>
        )}
      </div>

      {/* ───────────── 2. Push ───────────── */}
      <div className="sett-card">
        <h3>🔔 Push-уведомления</h3>
        <p className="sett-hint">
          Включите, чтобы получать важные события CRM (задачи, согласования,
          чаты) даже когда вкладка закрыта. Использует Service Worker + VAPID.
        </p>
        {/* v2 BONUS: визуальные подсказки — поддержка браузера + разрешение в одну колонку (vanilla — простой текст) */}
        <div className="sett-pill-row" style={{ marginBottom: 8 }}>
          <span className={'sett-pill ' + (pushSupported ? 'ok' : 'off')}>
            {pushSupported ? '✓ Браузер поддерживает' : '⚠️ Браузер не поддерживает'}
          </span>
          <span className={'sett-pill ' + (pushPerm === 'granted' ? 'ok' : pushPerm === 'denied' ? 'off' : '')}>
            permission: {pushPerm || 'unknown'}
          </span>
        </div>

        {!pushSupported && (
          <div className="sett-warn">⚠️ Браузер не поддерживает push-уведомления.</div>
        )}
        {pushSupported && pushPerm === 'denied' && (
          <div className="sett-warn">
            ⚠️ Уведомления заблокированы в настройках сайта. Разрешите их в адресной строке
            браузера, затем подпишитесь снова.
          </div>
        )}

        {pushSupported && pushPerm !== 'denied' && (
          <>
            <div className="sett-row">
              <Field label="Статус подписки">
                <div className="sett-pill-row">
                  {pushSubscribed === null && <span className="sett-pill">⏳ Проверяем…</span>}
                  {pushSubscribed === true && <span className="sett-pill ok">🟢 Подписан</span>}
                  {pushSubscribed === false && <span className="sett-pill off">⚪ Не подписан</span>}
                  <span className="sett-pill-meta">permission: {pushPerm}</span>
                </div>
              </Field>
            </div>
            <div className="sett-toolbar">
              {!pushSubscribed && (
                <Btn onClick={onPushOn} disabled={pushBusy}>
                  {pushBusy ? '⏳ Подключаем…' : '🔔 Подписаться на пуши'}
                </Btn>
              )}
              {pushSubscribed && (
                <Btn variant="ghost" onClick={onPushOff} disabled={pushBusy}>
                  {pushBusy ? '⏳…' : '🔕 Отписаться'}
                </Btn>
              )}
            </div>
          </>
        )}
      </div>

      {/* ───────────── 3. WebAuthn ───────────── */}
      <div className="sett-card">
        <h3>🔐 Ключи безопасности / биометрия</h3>
        <p className="sett-hint">
          Привяжите Face ID, Touch ID, отпечаток пальца или внешний ключ безопасности
          (YubiKey, Titan), чтобы входить в CRM без пароля.
        </p>
        {/* v2 BONUS: статус-плитка с количеством ключей и поддержкой (vanilla — без визуальной сводки) */}
        <div className="sett-pill-row" style={{ marginBottom: 8 }}>
          <span className={'sett-pill ' + (waSupported ? 'ok' : 'off')}>
            {waSupported ? '✓ WebAuthn поддерживается' : '⚠️ WebAuthn недоступен'}
          </span>
          <span className={'sett-pill ' + (waList.length > 0 ? 'ok' : '')}>
            {waList.length > 0 ? `🔑 Привязано: ${waList.length}` : '⚪ Нет привязанных'}
          </span>
        </div>

        {!waSupported && (
          <div className="sett-warn">⚠️ Это устройство не поддерживает WebAuthn (нужны HTTPS и платформенный аутентификатор).</div>
        )}

        {waLoading ? (
          <div>⏳ Загружаем список…</div>
        ) : waList.length === 0 ? (
          <div className="sett-empty">
            <div className="sett-empty-ic">🔑</div>
            <div className="sett-empty-title">Пока не привязано ни одного ключа</div>
            <div className="sett-empty-hint">Добавьте первое устройство, чтобы входить без пароля.</div>
          </div>
        ) : (
          <table className="sett-tbl">
            <thead>
              <tr>
                <th>Название</th>
                <th>Создан</th>
                <th>Последний вход</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {waList.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Input
                      defaultValue={c.device_name || ''}
                      onBlur={(e) => onRenameKey(c, e.target.value)}
                      style={{ maxWidth: 260 }}
                    />
                  </td>
                  <td>{fmtDate(c.created_at)}</td>
                  <td>{fmtDate(c.last_used_at)}</td>
                  <td>
                    <Btn variant="ghost" onClick={() => onDeleteKey(c)}>Удалить</Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {waSupported && (
          <div className="sett-toolbar">
            <Btn onClick={onAddKey} disabled={waBusy}>
              {waBusy ? '⏳ Подключаем…' : '➕ Добавить ключ безопасности'}
            </Btn>
          </div>
        )}

        {user?.login && (
          <p className="sett-hint" style={{ marginTop: 10 }}>
            Привязка делается к учётной записи <b>{user.login}</b>.
          </p>
        )}
      </div>
    </div>
  );
}
