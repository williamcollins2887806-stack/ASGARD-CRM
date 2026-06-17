/**
 * /system-panel → Логи.
 * Два режима:
 *   • Ручная загрузка через GET /logs?lines=…&level=…
 *   • SSE стрим через /logs/stream
 */
import { useState, useRef, useEffect } from 'react';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { loadLogs, openLogStream } from '../api';

const MAX_LIVE = 500;

export default function LogsTab() {
  const [level, setLevel]   = useState('all');
  const [lines, setLines]   = useState(300);
  const [logs, setLogs]     = useState([]);
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState(false);
  const esRef = useRef(null);
  const boxRef = useRef(null);

  useEffect(() => () => { if (esRef.current) esRef.current.close(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const list = await loadLogs({ lines, level });
      setLogs(list);
      // прокрутка вниз
      setTimeout(() => {
        if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
      }, 50);
    } catch (e) {
      toast.error('Не удалось загрузить логи: ' + (e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  const startLive = () => {
    if (esRef.current) esRef.current.close();
    setLive(true);
    esRef.current = openLogStream(
      (line) => {
        setLogs((prev) => {
          const next = [line, ...prev];
          return next.length > MAX_LIVE ? next.slice(0, MAX_LIVE) : next;
        });
      },
      () => {
        setLive(false);
        if (esRef.current) { esRef.current.close(); esRef.current = null; }
      }
    );
  };

  const stopLive = () => {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    setLive(false);
  };

  const filteredLogs = logs.filter((l) => {
    if (level === 'all') return true;
    if (level === 'warn') return l.sev !== 'info';
    if (level === 'error') return l.sev === 'error';
    return true;
  });

  return (
    <div>
      <div className="sysp-header-row">
        <div className="sysp-section-title" style={{ marginBottom: 0 }}>Логи сервера</div>
        <div className={'sysp-live-badge ' + (live ? '' : 'off')}>
          <span className={'sysp-status-dot ' + (live ? '' : 'dead')} />
          {live ? 'Live' : 'Стрим выкл'}
        </div>
      </div>

      <div className="sysp-log-toolbar" style={{ marginBottom: 12 }}>
        <label className="sett-field">
          <span className="sett-pill-meta">Уровень</span>
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            className="m-select"
          >
            <option value="all">Все записи</option>
            <option value="warn">Warn + Error</option>
            <option value="error">Только ошибки</option>
          </select>
        </label>
        <label className="sett-field">
          <span className="sett-pill-meta">Строк</span>
          <select
            value={lines}
            onChange={(e) => setLines(+e.target.value)}
            className="m-select"
          >
            <option value={100}>100</option>
            <option value={300}>300</option>
            <option value={500}>500</option>
            <option value={1000}>1000</option>
          </select>
        </label>
        <Btn variant="ghost" onClick={load} disabled={loading}>
          {loading ? '⏳ Загрузка…' : '↻ Загрузить'}
        </Btn>
        {!live ? (
          <Btn onClick={startLive}>▶ Live стрим</Btn>
        ) : (
          <Btn variant="ghost" onClick={stopLive}>⏹ Стоп</Btn>
        )}
        <Btn variant="ghost" onClick={() => setLogs([])} style={{ marginLeft: 'auto' }}>
          ✕ Очистить
        </Btn>
      </div>

      <div className="sysp-log-box" ref={boxRef}>
        {filteredLogs.length === 0 ? (
          <div className="sysp-empty">
            Логи пусты. Нажмите «Загрузить» или включите Live стрим.
          </div>
        ) : (
          filteredLogs.map((l, i) => (
            <div key={i} className={'sysp-log-line ' + (l.sev || 'info')}>
              {l.line}
            </div>
          ))
        )}
      </div>

      <div style={{ marginTop: 10, color: 'var(--t-3)', fontSize: 12 }}>
        Показано {filteredLogs.length} строк{live ? ' (live, новые сверху)' : ''}
      </div>
    </div>
  );
}
