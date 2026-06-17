/**
 * /system-panel → Терминал.
 *
 * Источник: vanilla `system-panel.js:653-862` (loadXterm + startPty + destroyPty).
 * Backend: `src/routes/admin-system.js:557-607` (GET /terminal с websocket: true,
 *          spawn /bin/bash через node-pty, JWT-auth по ?token=, требует role=ADMIN).
 *
 * Подгружаем xterm.js@5.3.0 + xterm-addon-fit@0.8.0 через CDN (jsdelivr) лениво —
 * чтобы не утяжелять основной бандл. Соединяемся по WebSocket к
 * /api/admin/system/terminal?token=<jwt>.
 *
 * Доступ: только ADMIN (родительская страница уже фильтрует).
 */
import { useEffect, useRef, useState } from 'react';
import { Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';

const XTERM_CSS = 'https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.min.css';
const XTERM_JS  = 'https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.min.js';
const XTERM_FIT = 'https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.min.js';

function loadXterm() {
  if (window.Terminal && window.FitAddon) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (!document.getElementById('xterm-css')) {
      const link = document.createElement('link');
      link.id = 'xterm-css';
      link.rel = 'stylesheet';
      link.href = XTERM_CSS;
      document.head.appendChild(link);
    }
    if (window.Terminal) {
      // только FitAddon
      const s = document.createElement('script');
      s.src = XTERM_FIT;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Не удалось загрузить xterm-addon-fit'));
      document.head.appendChild(s);
      return;
    }
    const s1 = document.createElement('script');
    s1.src = XTERM_JS;
    s1.onload = () => {
      const s2 = document.createElement('script');
      s2.src = XTERM_FIT;
      s2.onload = () => resolve();
      s2.onerror = () => reject(new Error('Не удалось загрузить xterm-addon-fit'));
      document.head.appendChild(s2);
    };
    s1.onerror = () => reject(new Error('Не удалось загрузить xterm.js'));
    document.head.appendChild(s1);
  });
}

export default function TerminalTab() {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const wsRef = useRef(null);
  const fitRef = useRef(null);
  const roRef = useRef(null);

  const [status, setStatus] = useState('idle'); // idle | loading | connected | error | closed
  const [error, setError] = useState(null);

  const disconnect = () => {
    if (roRef.current) { try { roRef.current.disconnect(); } catch (_) {} roRef.current = null; }
    if (wsRef.current) { try { wsRef.current.close(); } catch (_) {} wsRef.current = null; }
    if (termRef.current) { try { termRef.current.dispose(); } catch (_) {} termRef.current = null; }
    fitRef.current = null;
    setStatus('closed');
  };

  // Cleanup on unmount.
  useEffect(() => {
    return () => disconnect();
  }, []);

  const connect = async () => {
    setStatus('loading');
    setError(null);
    try {
      await loadXterm();
    } catch (e) {
      setError(e?.message || 'Не удалось загрузить xterm.js');
      setStatus('error');
      toast.error('Не удалось загрузить xterm.js. Проверьте интернет-соединение.');
      return;
    }

    const container = containerRef.current;
    if (!container) { setStatus('error'); return; }

    const term = new window.Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'Fira Code', 'Courier New', monospace",
      theme: {
        background: '#0a0a0f',
        foreground: '#e2e8f0',
        cursor:     '#22c55e',
        black:      '#1a1a2e',
        green:      '#22c55e',
        yellow:     '#fbbf24',
        red:        '#f87171',
        blue:       '#60a5fa',
        cyan:       '#22d3ee',
        white:      '#e2e8f0',
        brightGreen:'#4ade80'
      },
      allowProposedApi: true
    });
    const fitAddon = new window.FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    try { fitAddon.fit(); } catch (_) {}
    termRef.current = term;
    fitRef.current = fitAddon;

    // Подгоняем размер контейнера при ресайзе.
    const ro = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch (_) {}
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows })); } catch (_) {}
      }
    });
    ro.observe(container);
    roRef.current = ro;

    // JWT из localStorage. Backend проверит role=ADMIN.
    const token = localStorage.getItem('asgard_token') || '';
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${proto}://${window.location.host}/api/admin/system/terminal?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('connected');
      try { ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows })); } catch (_) {}
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'output') term.write(msg.data);
        else if (msg.type === 'exit') term.write('\r\n\x1b[33m[Сессия завершена]\x1b[0m\r\n');
        else if (msg.type === 'error') term.write(msg.data);
      } catch (_) { /* noop */ }
    };

    ws.onclose = () => {
      setStatus('closed');
      if (termRef.current) try { termRef.current.write('\r\n\x1b[31m[Соединение закрыто]\x1b[0m\r\n'); } catch (_) {}
    };

    ws.onerror = () => {
      setError('WebSocket ошибка. Проверьте, что node-pty установлен на сервере.');
      setStatus('error');
    };

    term.onData((data) => {
      const w = wsRef.current;
      if (w && w.readyState === WebSocket.OPEN) {
        try { w.send(JSON.stringify({ type: 'input', data })); } catch (_) {}
      }
    });

    term.focus();
  };

  const isConnected = status === 'connected';

  return (
    <div>
      <div className="sysp-header-row">
        <div className="sysp-section-title" style={{ marginBottom: 0 }}>
          💻 Терминал · root@asgard-crm
        </div>
        <div className="sysp-refresh-info">
          {status === 'idle'      && 'Нажмите «Подключиться» для запуска bash'}
          {status === 'loading'   && 'Загрузка xterm.js…'}
          {status === 'connected' && 'Подключено · полноценный bash'}
          {status === 'closed'    && 'Соединение закрыто'}
          {status === 'error'     && (error || 'Ошибка')}
        </div>
        {isConnected ? (
          <Btn variant="ghost" onClick={disconnect}>✕ Отключиться</Btn>
        ) : (
          <Btn onClick={connect} disabled={status === 'loading'}>
            {status === 'loading' ? '⏳ Загрузка…' : '▶ Подключиться'}
          </Btn>
        )}
      </div>

      <div
        style={{
          background: '#0a0a0f',
          border: '1px solid var(--brd-1)',
          borderRadius: 10,
          padding: 8,
          minHeight: 320,
          position: 'relative'
        }}
      >
        {status === 'idle' && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: 300, color: 'var(--t-3)', fontSize: 14,
            flexDirection: 'column', gap: 10
          }}>
            <div style={{ fontSize: 32 }}>🖥</div>
            <div>Нажмите «Подключиться» для запуска терминала</div>
            <div style={{ fontSize: 12, opacity: 0.6 }}>xterm.js · node-pty · /bin/bash</div>
          </div>
        )}
        <div
          ref={containerRef}
          style={{
            display: status === 'idle' ? 'none' : 'block',
            width: '100%',
            height: 420
          }}
        />
      </div>
      {status === 'error' && error && (
        <div style={{ marginTop: 8, color: 'var(--err-t, #f87171)', fontSize: 12 }}>
          {error}
        </div>
      )}
    </div>
  );
}
