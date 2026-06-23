/**
 * GoodsIcon — отображает SVG-иконку из каталога /v2/assets/icons/.
 *
 * Инлайнит SVG через fetch+cache, чтобы внутренние <style> SVG могли наследовать
 * CSS-переменные родителя (--icon-ink, --icon-accent). Это ограничение `<img>` —
 * у тега `img` shadow-style не наследует CSS-переменные родителя.
 *
 * Props:
 *   slug  — slug категории/товара (без .svg)
 *   path  — полный путь (если бэк уже отдал icon_path), приоритет над slug
 *   size  — пиксели (32 — строки таблиц, 48 — карточки)
 *   alt   — для a11y, по умолчанию пусто (декоративно)
 *   fallback — что показать если иконки нет (по умолчанию null = ничего)
 */
import { useEffect, useState, useRef } from 'react';

// Глобальный кэш fetched SVG-текстов в сессии: { url: 'svg-string' | 'ERR' }
const _cache = new Map();
const _pending = new Map();

function fetchIconOnce(url) {
  if (_cache.has(url)) return Promise.resolve(_cache.get(url));
  if (_pending.has(url)) return _pending.get(url);
  const p = fetch(url, { credentials: 'omit', cache: 'force-cache' })
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status))))
    .then((t) => {
      // Минимальная защита: убедимся что вернулся SVG, а не SPA-fallback HTML.
      if (!/^\s*<\?xml|^\s*<svg/i.test(t)) throw new Error('not svg');
      _cache.set(url, t);
      _pending.delete(url);
      return t;
    })
    .catch((e) => {
      _cache.set(url, 'ERR');
      _pending.delete(url);
      throw e;
    });
  _pending.set(url, p);
  return p;
}

export function GoodsIcon({ slug, path, size = 32, alt = '', fallback = null }) {
  const src = path || (slug ? '/icons/' + slug + '.svg' : null);
  const [svg, setSvg] = useState(() => (src && _cache.get(src) && _cache.get(src) !== 'ERR' ? _cache.get(src) : ''));
  const [err, setErr] = useState(() => src && _cache.get(src) === 'ERR');
  const ref = useRef(null);

  useEffect(() => {
    if (!src) return;
    if (_cache.get(src) && _cache.get(src) !== 'ERR') { setSvg(_cache.get(src)); setErr(false); return; }
    if (_cache.get(src) === 'ERR') { setErr(true); return; }
    let cancelled = false;
    fetchIconOnce(src)
      .then((t) => { if (!cancelled) { setSvg(t); setErr(false); } })
      .catch(() => { if (!cancelled) { setSvg(''); setErr(true); } });
    return () => { cancelled = true; };
  }, [src]);

  if (!src || err) return fallback;

  // Если SVG ещё не загружен — место под него (избегаем layout shift).
  if (!svg) {
    return (
      <span
        className="goods-icon goods-icon--loading"
        style={{ display: 'inline-block', width: size, height: size, verticalAlign: 'middle' }}
        aria-hidden="true"
      />
    );
  }

  return (
    <span
      ref={ref}
      className="goods-icon"
      style={{ display: 'inline-block', width: size, height: size, verticalAlign: 'middle', lineHeight: 0 }}
      role={alt ? 'img' : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : 'true'}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export default GoodsIcon;
