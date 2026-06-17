/**
 * PinKeypad — виртуальная клавиатура для ввода PIN-кода (4 цифры).
 * Используется в формах: PIN-проверка, установка PIN при первом входе.
 */
import { useState, useEffect } from 'react';

export function PinKeypad({ length = 4, autoSubmit = true, status = 'idle', hint = '', onComplete, onChange }) {
  const [val, setVal] = useState('');

  useEffect(() => {
    if (status === 'err' || status === 'reset') {
      setVal('');
    }
  }, [status]);

  useEffect(() => {
    onChange?.(val);
    if (autoSubmit && val.length === length) {
      onComplete?.(val);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [val]);

  const push = (d) => {
    if (val.length >= length) return;
    setVal((v) => (v + d).slice(0, length));
  };
  const back = () => setVal((v) => v.slice(0, -1));
  const clear = () => setVal('');

  // Keyboard support
  useEffect(() => {
    const onKey = (e) => {
      if (e.key >= '0' && e.key <= '9') push(e.key);
      else if (e.key === 'Backspace') back();
      else if (e.key === 'Enter' && val.length === length) onComplete?.(val);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [val]);

  return (
    <div className="welcome-v2-pin">
      <div className="welcome-v2-pin-dots">
        {Array.from({ length }).map((_, i) => (
          <div
            key={i}
            className={'welcome-v2-pin-dot ' + (
              status === 'err' ? 'err' :
              status === 'ok'  ? 'ok'  :
              i < val.length   ? 'on'  : ''
            )}
          />
        ))}
      </div>

      <div className="welcome-v2-pin-keypad">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
          <button key={n} type="button" onClick={() => push(String(n))}>{n}</button>
        ))}
        <button type="button" className="action" onClick={clear}>×</button>
        <button type="button" onClick={() => push('0')}>0</button>
        <button type="button" className="action" onClick={back}>⌫</button>
      </div>

      {hint && <div className={'welcome-v2-pin-hint ' + (status === 'err' ? 'err' : '')}>{hint}</div>}
    </div>
  );
}
