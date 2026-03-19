import { useState, useEffect, useRef } from 'react';

/**
 * AnimatedCounter — count-up эффект
 * 0 → target за duration ms, ease-out cubic
 */
export function AnimatedCounter({ to, duration = 800, format, className = '', style = {} }) {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef(null);

  useEffect(() => {
    const target = Number(to) || 0;
    if (target === 0) { setDisplay(0); return; }
    const start = performance.now();

    function tick(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      setDisplay(Math.round(target * eased));
      if (progress < 1) rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [to, duration]);

  const text = format ? format(display) : display.toLocaleString('ru-RU');

  return <span className={className} style={style}>{text}</span>;
}
