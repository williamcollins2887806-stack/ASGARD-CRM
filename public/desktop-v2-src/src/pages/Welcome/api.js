/* API для Welcome / Login / Register. Тонкая обёртка над /api/auth/*. */

async function call(path, body) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  let data = null;
  try { data = await r.json(); } catch { /* noop */ }
  if (!r.ok) {
    const msg = data?.error || data?.message || `HTTP ${r.status}`;
    const err = new Error(msg);
    err.status = r.status;
    err.data = data;
    throw err;
  }
  return data;
}

/** Шаг 1: логин + пароль → возвращает status: 'ok' | 'need_pin' | 'need_setup'. */
export function loginStep1({ login, password }) {
  return call('/api/auth/login', { login, password });
}

/** Шаг 2: проверка PIN. */
export function verifyPin({ pin }, tokenOverride) {
  return fetch('/api/auth/verify-pin', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + (tokenOverride || ''),
    },
    body: JSON.stringify({ pin })
  }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error(data.error || data.message || 'PIN неверен');
      e.status = r.status;
      throw e;
    }
    return data;
  });
}

/** Установить новый пароль и PIN при первом входе. */
export function setupCredentials({ newPassword, pin }, tokenOverride) {
  return fetch('/api/auth/setup-credentials', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + (tokenOverride || ''),
    },
    body: JSON.stringify({ newPassword, pin })
  }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error(data.error || data.message || 'Не удалось сохранить');
      e.status = r.status;
      throw e;
    }
    return data;
  });
}

/** Регистрация (создаёт user_request, требует одобрения админа). */
export function register({ login, password, name, email }) {
  return call('/api/auth/register', { login, password, name, email });
}

/** Сохранение токена + user в localStorage (совместимо с useAuth). */
export function persistSession({ token, user }) {
  try {
    if (token) localStorage.setItem('asgard_token', token);
    if (user)  localStorage.setItem('asgard_user', JSON.stringify(user));
  } catch { /* noop */ }
}
