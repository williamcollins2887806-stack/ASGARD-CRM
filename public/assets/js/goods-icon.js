/**
 * goods-icon.js — vanilla helper для инлайн-вставки SVG-иконок каталога.
 *
 * Используется в:
 *   - warehouse-v2.js          (карточки и таблица расходников)
 *   - warehouse-v2-equipment.js (карточки и таблица оборудования — fallback к photo_url)
 *   - procurement-page.js      (позиции заявки на закупку)
 *
 * Поле icon_path берётся из API (бэк-агент добавляет icon_slug + icon_path).
 * Если бэк ещё не отдал — fallback на построение пути из icon_slug.
 * Если slug нет тоже — рендер не происходит, ничего не ломается.
 *
 * SVG вставляется INLINE (innerHTML), чтобы внутренние <style> могли наследовать
 * CSS-переменные родителя (--icon-ink, --icon-accent). Тег <img> такого не умеет.
 *
 * Использование:
 *   container.innerHTML = AsgardGoodsIcon.placeholder({ slug: 'pump', path: '...', size: 32 });
 *   AsgardGoodsIcon.hydrate(rootElement);   // после вставки в DOM
 *
 * placeholder возвращает <span class="goods-icon" data-icon-src="...">…</span>,
 * hydrate(root) обходит все такие span внутри root и подгружает SVG fetch'ем.
 */
(function () {
  'use strict';

  const _cache = new Map();   // url -> svg-string | 'ERR'
  const _pending = new Map(); // url -> Promise

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function srcFrom(opts) {
    if (!opts) return null;
    if (opts.path) return opts.path;
    if (opts.slug) return '/icons/' + opts.slug + '.svg';
    return null;
  }

  function placeholder(opts) {
    const src = srcFrom(opts);
    if (!src) return '';
    const size = opts.size || 32;
    const alt = opts.alt || '';
    return '<span class="goods-icon goods-icon--loading" data-icon-src="' + esc(src) + '" ' +
      'style="display:inline-block;width:' + size + 'px;height:' + size + 'px;vertical-align:middle;line-height:0"' +
      (alt ? ' role="img" aria-label="' + esc(alt) + '"' : ' aria-hidden="true"') + '></span>';
  }

  function fetchOnce(url) {
    if (_cache.has(url)) {
      const v = _cache.get(url);
      return v === 'ERR' ? Promise.reject(new Error('cached err')) : Promise.resolve(v);
    }
    if (_pending.has(url)) return _pending.get(url);
    const p = fetch(url, { credentials: 'omit', cache: 'force-cache' })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status))))
      .then((t) => {
        if (!/^\s*<\?xml|^\s*<svg/i.test(t)) throw new Error('not svg');
        _cache.set(url, t); _pending.delete(url);
        return t;
      })
      .catch((e) => { _cache.set(url, 'ERR'); _pending.delete(url); throw e; });
    _pending.set(url, p);
    return p;
  }

  function hydrate(root) {
    if (!root || !root.querySelectorAll) return;
    const nodes = root.querySelectorAll('span.goods-icon[data-icon-src]');
    nodes.forEach((node) => {
      const url = node.getAttribute('data-icon-src');
      if (!url) return;
      // Уже инлайн (или ошибка) — пропускаем.
      if (node.dataset.iconLoaded === '1' || node.dataset.iconLoaded === 'err') return;
      fetchOnce(url)
        .then((svg) => { node.innerHTML = svg; node.classList.remove('goods-icon--loading'); node.dataset.iconLoaded = '1'; })
        .catch(() => { node.style.display = 'none'; node.dataset.iconLoaded = 'err'; });
    });
  }

  /**
   * loadInline(slug|path, container) — точечная вставка в контейнер (для модалок).
   */
  function loadInline(opts, container) {
    if (!container) return Promise.reject(new Error('no container'));
    const url = srcFrom(opts);
    if (!url) { container.style.display = 'none'; return Promise.resolve(); }
    return fetchOnce(url)
      .then((svg) => { container.innerHTML = svg; container.classList.add('goods-icon'); })
      .catch(() => { container.style.display = 'none'; });
  }

  window.AsgardGoodsIcon = { placeholder, hydrate, loadInline, _cache };
})();
