/**
 * AppErrorBoundary — generic React Error Boundary для render-ошибок.
 *
 * Отличие от ChunkReloadBoundary (C-20): тот ловит ТОЛЬКО ChunkLoadError
 * (после деплоя устарел кэш chunks) и сам делает reload. Здесь — всё
 * остальное: TypeError в рендере страницы, undefined.map, кривой prop и т.п.
 *
 * Поведение:
 *   • Показываем дружелюбный экран «Что-то пошло не так» с кнопками:
 *       — Перезагрузить страницу
 *       — На главную (#/home)
 *   • В dev-сборке (import.meta.env.DEV) — детали ошибки + stack.
 *   • В prod — только короткое сообщение, ошибка идёт в console.error.
 *
 * Где монтировать: оборачиваем <App/> в main.jsx (см. также App.jsx,
 * там уже есть ChunkReloadBoundary внутри ThemeProvider — этот выше).
 */
import { Component } from 'react';

export class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
    this._reload = this._reload.bind(this);
    this._home = this._home.bind(this);
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[AppErrorBoundary] render error:', error, info);
    this.setState({ info });
  }
  _reload() {
    try { window.location.reload(); } catch { /* noop */ }
  }
  _home() {
    try { window.location.hash = '#/home'; window.location.reload(); } catch { /* noop */ }
  }
  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;
    const isDev = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV;
    return (
      <div
        role="alert"
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          background: 'var(--bg-1, #0d1117)',
          color: 'var(--t-1, #eee)',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        <div style={{ maxWidth: 560, textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }} aria-hidden="true">⚠️</div>
          <h1 style={{ fontSize: 22, margin: '0 0 12px' }}>Что-то пошло не так</h1>
          <p style={{ color: 'var(--t-2, #aaa)', margin: '0 0 24px', lineHeight: 1.5 }}>
            Произошла непредвиденная ошибка в интерфейсе. Попробуйте перезагрузить страницу.
            Если ошибка повторится — сообщите в поддержку.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={this._reload}
              style={{
                padding: '10px 18px',
                background: 'var(--gold, #d4a04a)',
                color: '#000',
                border: 'none',
                borderRadius: 8,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              🔄 Перезагрузить
            </button>
            <button
              type="button"
              onClick={this._home}
              style={{
                padding: '10px 18px',
                background: 'transparent',
                color: 'var(--t-1, #eee)',
                border: '1px solid var(--brd-1, #333)',
                borderRadius: 8,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              🏠 На главную
            </button>
          </div>
          {isDev && (
            <details style={{ marginTop: 28, textAlign: 'left', color: 'var(--t-3, #888)' }}>
              <summary style={{ cursor: 'pointer', userSelect: 'none' }}>
                Детали (dev only)
              </summary>
              <pre style={{
                marginTop: 12,
                padding: 12,
                background: 'rgba(255,0,0,0.06)',
                border: '1px solid rgba(255,0,0,0.2)',
                borderRadius: 6,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontSize: 12,
                lineHeight: 1.4,
                maxHeight: 320,
                overflow: 'auto',
              }}>
                {String(error?.stack || error?.message || error)}
                {info?.componentStack ? '\n\nComponent stack:\n' + info.componentStack : ''}
              </pre>
            </details>
          )}
        </div>
      </div>
    );
  }
}

export default AppErrorBoundary;
