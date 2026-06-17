/**
 * Лёгкий API-клиент для v2.
 *
 * G-10 (error handling):
 *   • Унифицированный mapping HTTP-статусов в toast + специфика:
 *     - 401            → токен слетел → сброс localStorage и редирект /#/welcome
 *     - 403            → «Нет доступа» (toast.warn)
 *     - 404            → НЕ показываем toast по умолчанию (вызывающий
 *                        решает: EmptyState / null) — но err.status проставлен
 *     - 408 / timeout  → «Запрос истёк» (toast.warn)
 *     - 409            → НЕ показываем toast по умолчанию (бизнес-конфликт,
 *                        обрабатывается на месте — см. CartDrawer/stock_changed)
 *     - 413            → «Файл слишком большой»
 *     - 422            → НЕ показываем toast (form-validation, вызывающий обрабатывает)
 *     - 429            → «Слишком много запросов» (toast.warn)
 *     - 500/502/503/504 → «Сервер недоступен» + опциональный retry
 *     - network / fetch failed → «Нет соединения» (toast.error)
 *   • Опция `silent:true` подавляет toast (если страница рендерит свою ошибку).
 *   • Опция `retry: N` делает до N повторов на 5xx и network.
 *   • Опция `timeout: ms` — таймаут через AbortController.
 *
 * Совместимость: err.status сохраняется. Сигнатура api(path, opts) — та же.
 * Поэтому существующие .catch(e => ...) продолжают работать.
 */

/* eslint-disable no-console */

// ─── Стандартные лимиты выгрузок ───────────────────────────────────────────
// История активного PM/TO/ADMIN растёт — старые контракты не должны выпадать.
// Баг найден на Андросове: limit:500 на /api/works терял старые «Завершена».
// Используется в страницах вместо хардкода `limit: 500` / `limit: 300` / etc.
export const LIST_LIMITS = {
  WORKS: 2000,        // PM/HEAD_PM/ADMIN — все работы по фильтру pm_id
  TENDERS: 2000,      // TO/HEAD_TO — все тендеры по фильтру/году
  ESTIMATES: 2000,    // Approvals/AllEstimates — копятся годами
  INVOICES: 2000,     // БУХ — историчная таблица
  ACTS: 2000,         // БУХ — историчная таблица
  PROCUREMENT: 2000,  // Канбан без фильтра по статусу
  NOTIFICATIONS: 2000,// Активный юзер копит сотни в месяц
  CALLS: 2000,        // Активные продажи: >300 звонков в неделю
  EQUIPMENT: 2000,    // На проде уже 1243 единицы
  STOCK_MOVEMENTS: 2000,
  PASS_REQUESTS: 2000,
  PERMITS: 2000,
  PERMIT_APPLICATIONS: 2000,
  PAYROLL_SHEETS: 2000,
  CUSTOMERS: 2000,
  USERS: 1000         // Юзеров обычно ≤500, но с запасом
};

// Импорт toast lazy — чтобы избежать циклической зависимости с modals/.
// При первой ошибке подгружаем модуль и кэшируем функцию.
let _toastFn = null;
async function _getToast() {
  if (_toastFn) return _toastFn;
  try {
    const m = await import('@/modals/Notifications');
    _toastFn = m.toast || null;
  } catch { /* noop */ }
  return _toastFn;
}

function getToken() {
  try { return localStorage.getItem('asgard_token') || ''; } catch { return ''; }
}

function _isOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function _redirectToWelcome() {
  // Сохраняем текущий маршрут, чтобы после логина вернуться.
  try {
    const cur = window.location.hash || '';
    if (cur && !/^#\/(welcome|login|register)/.test(cur)) {
      sessionStorage.setItem('asgard_return_url', cur);
    }
  } catch { /* noop */ }
  try {
    localStorage.removeItem('asgard_token');
    localStorage.removeItem('asgard_user');
  } catch { /* noop */ }
  // Защита от спама редиректов.
  // CRIT-фикс: было `location.href='/#/welcome'` — при 401 в /v2/ юзер уходил в
  // vanilla v1 на корень. Теперь относительный hash сохраняет /v2/ префикс.
  if (typeof window !== 'undefined' && !/^#\/(welcome|login|register)/.test(window.location.hash || '')) {
    window.location.hash = '#/welcome';
  }
}

// Анти-спам: одна и та же тоаст-надпись не чаще раза в 3с.
const _recentToasts = new Map();
function _toastOnce(tone, msg) {
  const key = tone + '|' + msg;
  const now = Date.now();
  const last = _recentToasts.get(key) || 0;
  if (now - last < 3000) return;
  _recentToasts.set(key, now);
  _getToast().then((toast) => {
    if (!toast) return;
    const fn = toast[tone];
    if (typeof fn === 'function') fn(msg);
  });
}

/**
 * Обработка не-ok ответа: бросаем Error со status, при необходимости показываем toast.
 */
async function _handleErrorResponse(r, opts) {
  const text = await r.text().catch(() => '');
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { /* noop */ }
  const serverMsg = payload?.error || payload?.message || '';
  const err = new Error(`HTTP ${r.status}: ${serverMsg || text || r.statusText}`);
  err.status = r.status;
  err.data = payload;
  err.serverMsg = serverMsg;

  if (!opts?.silent) {
    if (r.status === 401) {
      _toastOnce('warn', 'Сессия истекла. Войдите снова.');
      // Редиректим только если действительно потеряли auth (не для /api/auth/login).
      setTimeout(_redirectToWelcome, 300);
    } else if (r.status === 403) {
      _toastOnce('warn', serverMsg || 'Нет доступа');
    } else if (r.status === 413) {
      _toastOnce('error', 'Файл слишком большой');
    } else if (r.status === 429) {
      _toastOnce('warn', 'Слишком много запросов. Подождите немного.');
    } else if (r.status >= 500) {
      _toastOnce('error', serverMsg || 'Сервер недоступен. Попробуйте позже.');
    }
    // 404 / 422 / 409 — silent by default (вызывающий решает что показать)
  }
  throw err;
}

/**
 * Основной API-клиент.
 *
 * @param {string} path
 * @param {{
 *   method?: string,
 *   body?: any,
 *   signal?: AbortSignal,
 *   silent?: boolean,          // не показывать toast (страница покажет свою ошибку)
 *   retry?: number,            // повторы на 5xx и network errors (по умолчанию 0)
 *   timeout?: number,          // мс, AbortController (по умолчанию 30000)
 *   headers?: Record<string,string>
 * }} opts
 */
export async function api(path, opts = {}) {
  const {
    method = 'GET',
    body,
    signal,
    silent = false,
    retry = 0,
    timeout = 30000,
    headers: extraHeaders
  } = opts;

  // Offline detection: рубим сразу, не тратим попытки.
  if (!_isOnline()) {
    if (!silent) _toastOnce('error', 'Нет соединения с интернетом');
    const err = new Error('Network offline');
    err.status = 0;
    err.offline = true;
    throw err;
  }

  const headers = { Authorization: 'Bearer ' + getToken(), ...(extraHeaders || {}) };
  if (body) headers['Content-Type'] = 'application/json';

  // Комбинируем внешний signal с timeout-signal.
  const ctrl = new AbortController();
  const timerId = timeout > 0 ? setTimeout(() => ctrl.abort('timeout'), timeout) : null;
  let cleanupExternal = null;
  if (signal) {
    if (signal.aborted) ctrl.abort(signal.reason);
    else {
      const onAbort = () => ctrl.abort(signal.reason);
      signal.addEventListener('abort', onAbort);
      cleanupExternal = () => signal.removeEventListener('abort', onAbort);
    }
  }

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const r = await fetch(path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal
      });
      if (timerId) clearTimeout(timerId);
      if (cleanupExternal) cleanupExternal();

      if (!r.ok) {
        // 5xx — retry если просили
        if (r.status >= 500 && attempt < retry) {
          attempt++;
          await new Promise((res) => setTimeout(res, 500 * attempt));
          continue;
        }
        await _handleErrorResponse(r, opts);
      }
      if (r.status === 204) return null;
      return await r.json();
    } catch (e) {
      if (timerId) clearTimeout(timerId);
      if (cleanupExternal) cleanupExternal();

      // Распознаём timeout/abort
      if (e?.name === 'AbortError') {
        // Если abort пришёл по нашему таймеру — показываем «Запрос истёк»
        if (ctrl.signal.reason === 'timeout') {
          if (!silent) _toastOnce('warn', 'Запрос истёк (таймаут). Попробуйте ещё раз.');
          const err = new Error('Request timeout');
          err.status = 408;
          err.timeout = true;
          throw err;
        }
        // Внешний abort — пробрасываем как есть, без toast.
        throw e;
      }

      // Network error (fetch отвалился до получения статуса).
      // Это TypeError 'Failed to fetch' / 'NetworkError' и т.п.
      const isNetwork = e?.status === undefined && /failed to fetch|network|load failed/i.test(String(e?.message || ''));
      if (isNetwork) {
        if (attempt < retry) {
          attempt++;
          await new Promise((res) => setTimeout(res, 500 * attempt));
          continue;
        }
        if (!silent) _toastOnce('error', _isOnline() ? 'Сеть недоступна. Попробуйте позже.' : 'Нет соединения с интернетом');
        const err = new Error('Network error');
        err.status = 0;
        err.network = true;
        throw err;
      }
      // Иначе уже обработанная _handleErrorResponse ошибка — пробрасываем.
      throw e;
    }
  }
}
