import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AppErrorBoundary } from '@/blocks/AppErrorBoundary';
import './styles/theme.css';
import './styles/utils.css';
import './styles/shell.css';
import './styles/dashboard.css';
import './styles/home.css';
import './styles/modals.css';
import './styles/catalog.css';
import './styles/inputs.css';
import './styles/blocks.css';
import './styles/fullscreen.css';
import './styles/ai-workspace.css';
import './styles/specials.css';
import './styles/notifications.css';
import './styles/sidebar.css';
import './modals/compat.jsx';

// G-10: AppErrorBoundary — generic boundary для render-ошибок (вне ChunkLoadError).
// Должен быть САМЫМ ВНЕШНИМ, иначе ошибка в ThemeProvider/AuthProvider не поймается.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>
);

// PWA: регистрируем общий Service Worker (/sw.js). Один SW обслуживает и vanilla, и v2 —
// он же отвечает за cache-busting через SHELL_VERSION (см. public/sw.js:5).
// Без register() Service Worker НЕ устанавливается на /v2/* — push-уведомления и
// offline-страница не работают для юзеров, заходящих сразу на /v2/.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then((reg) => { console.info('[PWA v2] SW registered, scope=' + reg.scope); })
      .catch((err) => { console.warn('[PWA v2] SW registration failed:', err?.message || err); });
  });
}
