/**
 * API-клиент страницы /settings.
 * Источник истины — vanilla `public/assets/js/settings.js` + backend `src/routes/settings.js`.
 *
 * Endpoint'ы:
 *   GET    /api/settings           — все настройки разом ({ settings: { app, refs, ... } })
 *   GET    /api/settings/refs/all  — справочники (tender/work-статусы, отказы и т.п.)
 *   GET    /api/settings/:key      — один ключ
 *   PUT    /api/settings/:key      — { value }
 *   DELETE /api/settings/:key      — только ADMIN
 *
 * Чувствительные ключи (smtp_config, api_keys, telegram_bot_token) скрыты для не-ADMIN.
 *
 * Доступ к редактированию (UI): ADMIN + DIRECTOR_*.
 */
import { api } from '@/api/client';

export const EDIT_ROLES = [
  'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'
];

/* ── defaults — точная копия из vanilla settings.js / seed ─────────────── */
export const DEFAULT_APP = {
  vat_pct: 22,
  gantt_start_iso: '2026-01-01T00:00:00.000Z',
  docs_folder_hint: '',
  require_docs_on_handoff: true,
  require_answer_on_question: true,
  correspondence_start_number: 1,
  reminder_auto_delete_hours: 48,
  work_close_trigger_status: 'Подписание акта',
  sla: {
    docs_deadline_notice_days: 5,
    birthday_notice_days: 5,
    pm_calc_due_workdays: 3,
    director_approval_due_workdays: 2,
    pm_rework_due_workdays: 1,
    tkp_followup_first_delay_days: 3,
    direct_request_deadline_days: 5
  },
  limits: {
    pm_active_calcs_limit: 5,
    pm_active_calcs_done_statuses: 'Согласование ТКП, ТКП согласовано, Выиграли, Проиграли'
  },
  schedules: {
    office_strict_own: true,
    workers_shift_logins: ['trukhin'],
    block_on_conflict: true
  },
  calc: {
    min_profit_per_person_day: 20000,
    norm_profit_per_person_day: 25000,
    overhead_pct: 10,
    fot_tax_pct: 50,
    profit_tax_pct: 20,
    base_rate: 5500,
    auto_days_multiplier: 1.2,
    auto_people_multiplier: 1.1,
    role_rates: {},
    chemicals: [],
    transport: []
  },
  company_profile: {
    company_name: '',
    director_fio: '',
    inn: '',
    kpp: '',
    ogrn: '',
    phone: '',
    email: '',
    address: '',
    website: ''
  },
  doc_types: []
};

export const DEFAULT_REFS = {
  tender_statuses: [
    'Черновик', 'Новый', 'На анализе', 'Отправлено на просчёт',
    'Согласование ТКП', 'ТКП согласовано', 'Готово к отправке КП',
    'КП отправлено', 'Выиграли', 'Проиграли', 'Не подходит'
  ],
  work_statuses: [
    'Новая', 'Подготовка', 'Мобилизация', 'В работе',
    'На паузе', 'Подписание акта', 'Работы сдали', 'Закрыт'
  ],
  reject_reasons: ['Цена', 'Сроки', 'Выбрали другого', 'Отмена тендера'],
  permits: [],
  expense_categories: ['ФОТ', 'Логистика', 'Проживание', 'Материалы', 'Субподряд', 'Прочее']
};

/* ── загрузка ──────────────────────────────────────────────────────────── */
export async function loadAllSettings() {
  const data = await api('/api/settings');
  return data?.settings || {};
}

export async function loadRefs() {
  const data = await api('/api/settings/refs/all');
  return data?.refs || DEFAULT_REFS;
}

export async function loadKey(key) {
  const data = await api('/api/settings/' + encodeURIComponent(key));
  return data?.value ?? null;
}

export function saveKey(key, value) {
  return api('/api/settings/' + encodeURIComponent(key), {
    method: 'PUT', body: { value }
  });
}

/* ── утилиты ───────────────────────────────────────────────────────────── */
export function parseLines(txt) {
  return uniqNonEmpty(
    String(txt || '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

function uniqNonEmpty(arr) {
  const out = [];
  const seen = new Set();
  for (const x of arr || []) {
    const s = String(x || '').trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

export function num(v, def) {
  const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : def;
}

export function dateFromIso(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  } catch {/* noop */}
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return String(iso);
  return '';
}

export function isoFromDate(ymd) {
  if (!ymd) return null;
  const d = new Date(ymd + 'T00:00:00.000Z');
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function safeParseJSON(txt, fallback) {
  try {
    const v = JSON.parse(txt || 'null');
    return v && typeof v === 'object' ? v : fallback;
  } catch {
    return fallback;
  }
}

export function deepMerge(target, src) {
  if (!src || typeof src !== 'object') return target;
  const out = { ...(target || {}) };
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = deepMerge(out[k] || {}, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/* ──────────────────────────────────────────────────────────────────────────
 * AI-конфигурация (YandexGPT / OpenAI / Anthropic) — ADMIN only.
 * Backend: src/routes/admin-system.js
 *   GET    /api/admin/system/ai-config
 *   POST   /api/admin/system/ai-config — сохраняет ключи/модели/url
 *   POST   /api/admin/system/ai-test   — пробный запрос
 * ────────────────────────────────────────────────────────────────────────── */
export async function loadAiConfig() {
  return api('/api/admin/system/ai-config');
}

export async function saveAiConfig(payload) {
  return api('/api/admin/system/ai-config', { method: 'POST', body: payload });
}

export async function testAi({ provider = 'auto', prompt = '' } = {}) {
  return api('/api/admin/system/ai-test', {
    method: 'POST',
    body: { provider, prompt },
    silent: true,                  // 502 от внешнего AI обрабатываем сами
    timeout: 60000
  });
}

/* ──────────────────────────────────────────────────────────────────────────
 * Push-уведомления (Web Push API + VAPID).
 * Backend: src/routes/push.js
 *   GET    /api/push/vapid-key
 *   POST   /api/push/subscribe
 *   POST   /api/push/unsubscribe
 * ────────────────────────────────────────────────────────────────────────── */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function pushIsSupported() {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function pushPermission() {
  if (!pushIsSupported()) return 'unsupported';
  return Notification.permission;
}

export async function pushGetCurrentSubscription() {
  if (!pushIsSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

export async function pushSubscribe() {
  if (!pushIsSupported()) return { ok: false, reason: 'unsupported' };
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, reason: 'denied' };

  // VAPID
  const v = await api('/api/push/vapid-key');
  if (!v?.publicKey) return { ok: false, reason: 'no_vapid_key' };

  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    try { await existing.unsubscribe(); } catch { /* noop */ }
  }
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(v.publicKey)
  });
  const json = sub.toJSON();

  await api('/api/push/subscribe', {
    method: 'POST',
    body: {
      endpoint: json.endpoint,
      keys: json.keys,
      device_info: navigator.userAgent.slice(0, 200)
    }
  });
  try { localStorage.setItem('asgard_push_subscribed', '1'); } catch { /* noop */ }
  return { ok: true };
}

export async function pushUnsubscribe() {
  if (!pushIsSupported()) return { ok: false, reason: 'unsupported' };
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      try { await sub.unsubscribe(); } catch { /* noop */ }
      await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint } });
    }
    try { localStorage.removeItem('asgard_push_subscribed'); } catch { /* noop */ }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * WebAuthn (биометрия / ключи безопасности).
 * Backend: src/routes/webauthn.js
 * Использует @simplewebauthn/browser (CDN, window.SimpleWebAuthnBrowser)
 * либо нативные navigator.credentials API.
 * ────────────────────────────────────────────────────────────────────────── */
export async function webauthnIsSupported() {
  if (typeof window === 'undefined') return false;
  if (!window.PublicKeyCredential) return false;
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export async function webauthnList() {
  const r = await api('/api/webauthn/credentials');
  return Array.isArray(r?.credentials) ? r.credentials : [];
}

export async function webauthnDelete(id) {
  return api(`/api/webauthn/credentials/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function webauthnRename(id, device_name) {
  return api(`/api/webauthn/credentials/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { device_name }
  });
}

/**
 * Регистрация устройства WebAuthn.
 * Использует window.SimpleWebAuthnBrowser если она загружена (старый desktop
 * подгружал её с CDN), иначе нативные navigator.credentials.create.
 */
export async function webauthnRegister(deviceName) {
  const supported = await webauthnIsSupported();
  if (!supported) throw new Error('WebAuthn недоступен на этом устройстве');

  // 1) Опции от сервера
  const opts = await api('/api/webauthn/register/options', { method: 'POST' });
  if (opts?.error) throw new Error(opts.error);

  let attResp;
  const swab = typeof window !== 'undefined' ? window.SimpleWebAuthnBrowser : null;
  if (swab && typeof swab.startRegistration === 'function') {
    try {
      attResp = await swab.startRegistration({ optionsJSON: opts });
    } catch (e) {
      if (e?.name === 'NotAllowedError') throw new Error('Отменено пользователем');
      throw new Error(e?.message || 'Ошибка биометрии');
    }
  } else {
    // Нативный fallback (упрощённая ветка — не для prod, но и не stub):
    // конвертируем base64url challenge → ArrayBuffer и обратно atestation → base64.
    const b64u2ab = (s) => {
      const pad = '='.repeat((4 - (s.length % 4)) % 4);
      const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
      const raw = atob(b64);
      const buf = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
      return buf.buffer;
    };
    const ab2b64u = (buf) => {
      const bytes = new Uint8Array(buf);
      let bin = '';
      for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    };
    const publicKey = {
      ...opts,
      challenge: b64u2ab(opts.challenge),
      user: { ...opts.user, id: b64u2ab(opts.user.id) },
      excludeCredentials: (opts.excludeCredentials || []).map((c) => ({
        ...c, id: b64u2ab(c.id)
      }))
    };
    const cred = await navigator.credentials.create({ publicKey });
    if (!cred) throw new Error('Не удалось создать ключ');
    attResp = {
      id: cred.id,
      rawId: ab2b64u(cred.rawId),
      type: cred.type,
      response: {
        clientDataJSON:    ab2b64u(cred.response.clientDataJSON),
        attestationObject: ab2b64u(cred.response.attestationObject)
      },
      clientExtensionResults: cred.getClientExtensionResults
        ? cred.getClientExtensionResults()
        : {}
    };
  }

  // 2) Отправка на сервер
  const v = await api('/api/webauthn/register/verify', {
    method: 'POST',
    body: { ...attResp, device_name: deviceName || undefined }
  });
  if (!v?.verified) throw new Error(v?.error || 'Не удалось подтвердить ключ');
  return v;
}
