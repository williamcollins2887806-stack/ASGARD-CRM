import { Component } from 'react';
import { reportClientError } from '@/lib/reportClientError';

/**
 * Ловит render-ошибки React в /m/ и шлёт на /api/client-errors.
 * Показывает простой fallback, чтобы не оставлять белый экран.
 */
export class MobileErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    try {
      reportClientError({
        source: 'm',
        kind: 'boundary',
        message: error?.message || 'React render error',
        stack: [error?.stack, info?.componentStack].filter(Boolean).join('\n'),
      });
    } catch { /* noop */ }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        role="alert"
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          background: 'var(--bg-base, #0a0a14)',
          color: 'var(--text-primary, #e6e9ef)',
          fontFamily: 'system-ui, sans-serif',
          textAlign: 'center',
        }}
      >
        <div style={{ maxWidth: 420 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }} aria-hidden="true">⚠️</div>
          <h1 style={{ fontSize: 20, margin: '0 0 10px' }}>Что-то пошло не так</h1>
          <p style={{ opacity: 0.7, margin: '0 0 20px', lineHeight: 1.45 }}>
            Ошибка в интерфейсе. Попробуйте перезагрузить страницу.
          </p>
          <button
            type="button"
            onClick={() => { try { window.location.reload(); } catch { /* noop */ } }}
            style={{
              padding: '10px 18px',
              borderRadius: 10,
              border: 'none',
              background: 'var(--gold, #d4a04a)',
              color: '#111',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Перезагрузить
          </button>
        </div>
      </div>
    );
  }
}

export default MobileErrorBoundary;
