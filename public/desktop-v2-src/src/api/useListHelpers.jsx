/**
 * Общие хуки для списочных страниц CRM 2.0.
 *
 *   • useDebounce(value, delayMs) — задерживает значение (поиск на 300 мс).
 *   • useListPagination(items, opts) — page state с авто-сбросом при изменении входа.
 *   • useSortState(initialKey, initialDir) — обвязка над {key,dir} с toggle.
 *
 * Цель — единый паттерн поиска/пагинации/сортировки.
 * Эталоны до G-11: Tenders/PmWorks/PmCalcs (PAGE=25, useMemo сортировка,
 * pages/safePage/slice, кнопки ‹ N/M › в .pager).
 *
 * RBAC: помощники чистые, никаких ролей не проверяют.
 */
import { useState, useEffect, useMemo, useRef } from 'react';

/**
 * useDebounce — возвращает значение, изменяющееся не чаще раза в `delay` мс.
 * Используется в SearchInput чтобы не ловить onChange на каждый символ.
 *
 * @example
 *   const [q, setQ] = useState('');
 *   const debouncedQ = useDebounce(q, 300);
 *   const visible = useMemo(() => filterByQuery(list, debouncedQ), [list, debouncedQ]);
 */
export function useDebounce(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/**
 * useListPagination — клиентская пагинация над in-memory массивом.
 *
 * @param {Array} items — данные (уже отфильтрованы + отсортированы)
 * @param {Object} opts — { pageSize=25, resetDeps=[] }
 * @returns { page, setPage, pages, safePage, slice, total }
 *
 * Авто-сброс page→1 при изменении любого из `resetDeps` (filters/sort).
 * Защита от Math.ceil(0/N)=0: pages всегда ≥1.
 * Защита от safePage>pages (после удаления элементов): Math.min.
 */
export function useListPagination(items, { pageSize = 25, resetDeps = [] } = {}) {
  const [page, setPage] = useState(1);
  const total = items?.length || 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pages);
  const slice = useMemo(
    () => (items || []).slice((safePage - 1) * pageSize, safePage * pageSize),
    [items, safePage, pageSize]
  );
  // Сброс page=1 при смене фильтров/сортировки/режима.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(1); }, resetDeps);
  return { page, setPage, pages, safePage, slice, total };
}

/**
 * useSortState — {key, dir} с toggle одной кнопкой.
 * Клик по той же колонке инвертирует dir; клик по другой — выставляет dir=-1.
 *
 * @example
 *   const { sort, onSortChange } = useSortState('id', -1);
 *   <Th onClick={() => onSortChange('customer_name')}>Заказчик</Th>
 */
export function useSortState(initialKey = 'id', initialDir = -1) {
  const [sort, setSort] = useState({ key: initialKey, dir: initialDir });
  const onSortChange = (key) =>
    setSort((s) => ({ key, dir: s.key === key ? -s.dir : -1 }));
  return { sort, setSort, onSortChange };
}

/**
 * sortByKey — единый компаратор: numeric→numeric, локаль 'ru', null в конец.
 * Используется внутри useMemo на странице/таблице.
 *
 * @example
 *   const sorted = useMemo(() => sortByKey(items, sort), [items, sort]);
 */
export function sortByKey(items, { key, dir }, accessor) {
  const get = accessor || ((row) => row?.[key]);
  return [...(items || [])].sort((a, b) => {
    const va = get(a, key);
    const vb = get(b, key);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
    return String(va).localeCompare(String(vb), 'ru') * dir;
  });
}

/**
 * Pager — общий футер пагинации (‹ N/M · X шт. ›).
 * Чистый компонент без CSS-зависимостей кроме .pager (есть в base.css).
 *
 * Использовать в любой таблице:
 *   <Pager safePage={safePage} pages={pages} total={total} onPage={setPage} />
 *
 * Скрывается сам если pages<=1.
 */
export function Pager({ safePage, pages, total, onPage }) {
  if (!pages || pages <= 1) return null;
  return (
    <div className="pager" role="navigation" aria-label="Постраничная навигация">
      <button
        className="btn-ghost"
        disabled={safePage === 1}
        onClick={() => onPage((p) => Math.max(1, p - 1))}
        aria-label="Предыдущая страница"
      >‹</button>
      <span className="pager-info">
        {safePage} / {pages}{typeof total === 'number' ? ` · ${total} шт.` : ''}
      </span>
      <button
        className="btn-ghost"
        disabled={safePage === pages}
        onClick={() => onPage((p) => Math.min(pages, p + 1))}
        aria-label="Следующая страница"
      >›</button>
    </div>
  );
}

/**
 * usePrevious — возвращает значение из прошлого рендера.
 * Часто нужно для сравнения «фильтры реально изменились» без false-positive.
 */
export function usePrevious(value) {
  const ref = useRef(value);
  useEffect(() => { ref.current = value; }, [value]);
  return ref.current;
}

// v2 BONUS: useLocalStorage — auto-save фильтров/состояния между сессиями (vanilla не имеет).
// Делает draft-save «бесплатно» для любой страницы.
//   const [filters, setFilters] = useLocalStorage('pmw-filters', { q:'', status:'' });
// При смене filters автоматически persist в LS. При первом монтировании — читает.
export function useLocalStorage(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return typeof initial === 'function' ? initial() : initial;
      return JSON.parse(raw);
    } catch {
      return typeof initial === 'function' ? initial() : initial;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* noop */ }
  }, [key, value]);
  return [value, setValue];
}

// v2 BONUS: useHotkeys — keyboard shortcuts на странице (vanilla не имеет).
// map = { 'ctrl+s': fn, 'esc': fn, '/': fn, 'mod+k': fn }
// 'mod' = Cmd на mac, Ctrl на остальных. Игнорирует если фокус в input/textarea (кроме esc/mod+k).
export function useHotkeys(map, deps = []) {
  useEffect(() => {
    if (!map) return undefined;
    const handler = (e) => {
      const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
      const mod = isMac ? e.metaKey : e.ctrlKey;
      const tgt = e.target;
      const inField = tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable);
      const key = (e.key || '').toLowerCase();
      // Build canonical combo string
      const parts = [];
      if (mod) parts.push('mod');
      if (e.ctrlKey && !isMac) parts.push('ctrl');
      if (e.metaKey && isMac) parts.push('cmd');
      if (e.altKey) parts.push('alt');
      if (e.shiftKey) parts.push('shift');
      parts.push(key);
      const combo = parts.join('+');
      // Allow esc and mod+combos even from inputs
      const alwaysAllow = key === 'escape' || combo.startsWith('mod+');
      if (inField && !alwaysAllow) return;
      for (const [k, fn] of Object.entries(map)) {
        const want = String(k).toLowerCase().split('+').map((p) => p.trim()).sort().join('+');
        const got = parts.slice().sort().join('+');
        if (want === got) {
          e.preventDefault();
          fn(e);
          return;
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

// v2 BONUS: exportToCsv — общий хелпер для XLSX/CSV-экспорта.
// rows = массив объектов, columns = [{key, label, format?}].
export function exportToCsv(filename, rows, columns) {
  const sep = ';'; // RU-Excel-friendly
  const escape = (v) => {
    if (v == null) return '';
    const s = String(v);
    if (s.includes(sep) || s.includes('\n') || s.includes('"')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const header = columns.map((c) => escape(c.label)).join(sep);
  const body = rows.map((row, idx) =>
    columns.map((c) => {
      const raw = typeof c.key === 'function' ? c.key(row, idx) : row[c.key];
      return escape(c.format ? c.format(raw, row) : raw);
    }).join(sep)
  ).join('\n');
  // BOM для корректного открытия в Excel (UTF-8).
  const blob = new Blob(['﻿' + header + '\n' + body], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

// v2 BONUS: copyToClipboard — копирование в буфер с тостом (vanilla не имеет).
// Поддерживает fallback на execCommand для legacy-окружений.
export async function copyToClipboard(text) {
  if (!text) return false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(String(text));
      return true;
    }
  } catch { /* fallthrough */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = String(text);
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
