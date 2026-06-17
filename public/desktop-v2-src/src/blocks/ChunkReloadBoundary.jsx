/**
 * ChunkReloadBoundary — auto-reload при ChunkLoadError.
 *
 * Проблема (C-20): после деплоя у пользователя в browser-кэше может остаться
 * старый index.html со ссылкой на index-OLD.js. Когда React.lazy() пытается
 * загрузить старый chunk, backend (после C-20 фикса) отдаёт 404 → import()
 * бросает "Failed to fetch dynamically imported module" / ChunkLoadError.
 *
 * Решение: ловим эту ошибку, force-reload страницы (single retry с маркером
 * в sessionStorage, чтобы не уйти в infinite loop если ошибка не из-за кэша).
 *
 * Так же ловим global window.onerror на эту же категорию ошибок — для
 * dynamic imports внутри обработчиков, не во время рендера.
 */
import { Component, useEffect } from 'react';

const RELOAD_KEY = 'asgard_v2_chunk_reloaded_at';
const RELOAD_COUNT_KEY = 'asgard_v2_chunk_reload_count';
// Минимальный cooldown — только защита от reload-loop, не от частых деплоев.
// До этого было 60 сек: пользователь после 2-го деплоя за минуту тыкал по
// странице, чанк 404, boundary говорил «cooldown» и не перезагружал — клик
// "ничего не делал". Это и есть найденный silent-bug.
const RELOAD_COOLDOWN_MS = 3_000;
const MAX_RELOADS_IN_WINDOW = 3;     // не больше 3 подряд за 30 сек
const RELOAD_WINDOW_MS = 30_000;

function isChunkError(err) {
  if (!err) return false;
  const msg = String(err.message || err.toString());
  return (
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /ChunkLoadError/i.test(msg) ||
    /Loading chunk \d+ failed/i.test(msg) ||
    /Loading CSS chunk/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /'text\/html' is not a valid JavaScript MIME type/i.test(msg) ||
    /Unexpected token '<'/i.test(msg)  // SPA-fallback отдал HTML
  );
}

function tryReload(reason) {
  try {
    const now = Date.now();
    const last = parseInt(sessionStorage.getItem(RELOAD_KEY) || '0', 10);
    // Anti-loop: считаем сколько перезагрузок было в window.
    let history;
    try { history = JSON.parse(sessionStorage.getItem(RELOAD_COUNT_KEY) || '[]'); } catch { history = []; }
    history = history.filter((t) => now - t < RELOAD_WINDOW_MS);
    if (history.length >= MAX_RELOADS_IN_WINDOW) {
      console.error('[ChunkReloadBoundary] reload-loop suspected, suppressing:', reason);
      return false;
    }
    if (now - last < RELOAD_COOLDOWN_MS) {
      console.warn('[ChunkReloadBoundary] reload skipped (cooldown 3s):', reason);
      return false;
    }
    history.push(now);
    sessionStorage.setItem(RELOAD_KEY, String(now));
    sessionStorage.setItem(RELOAD_COUNT_KEY, JSON.stringify(history));
    console.warn('[ChunkReloadBoundary] reloading page:', reason);
    window.location.reload();
    return true;
  } catch {
    return false;
  }
}

/** Глобальный listener — для async dynamic-import вне React-рендера. */
export function ChunkReloadGlobalListener() {
  useEffect(() => {
    const onError = (e) => {
      if (isChunkError(e?.error || e)) tryReload('window.onerror: ' + (e?.message || ''));
    };
    const onRejection = (e) => {
      if (isChunkError(e?.reason)) tryReload('unhandledrejection: ' + (e?.reason?.message || ''));
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
  return null;
}

/** React Error Boundary — для ошибок во время рендера/lazy. */
export class ChunkReloadBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasChunkError: false };
  }
  static getDerivedStateFromError(error) {
    if (isChunkError(error)) return { hasChunkError: true };
    return null;
  }
  componentDidCatch(error, info) {
    if (isChunkError(error)) {
      tryReload('ErrorBoundary: ' + error.message);
    } else {
      console.error('[ChunkReloadBoundary] non-chunk error:', error, info);
    }
  }
  render() {
    if (this.state.hasChunkError) {
      return (
        <div className="p-24 c-t3 t-center">
          ⏳ Обновляем приложение до свежей версии…
        </div>
      );
    }
    return this.props.children;
  }
}
