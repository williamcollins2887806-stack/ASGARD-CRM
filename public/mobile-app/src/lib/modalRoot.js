/**
 * MODAL_ROOT / getModalRoot — D-267
 *
 * Единая точка монтирования модалок и шторок через портал.
 *
 * Зачем: `position: fixed` «прилипает» к ближайшему предку с `transform`/`filter`/
 * `backdrop-filter` (любой `transform ≠ none` делает предка containing block).
 * В приложении контейнер роутов имеет `animation: pageTransitionIn ... both`, а
 * `PageShell` — `.page-enter ... forwards`, поэтому и после завершения анимации
 * остаётся вычисленный `transform`. Модалка, отрендеренная в потоке, из-за этого
 * уезжает за пределы экрана (кнопки «под панелью браузера», закрыть нельзя).
 *
 * Узел `#modal-root` лежит в `index.html` рядом с `#root`, вне анимированных
 * контейнеров → fixed внутри него считается от вьюпорта.
 */

export const MODAL_ROOT_ID = 'modal-root';

let cached = null;

/**
 * Возвращает узел для портала. Всегда непустой: если в HTML узла нет
 * (старый закешированный `index.html` у PWA/service worker), создаём его сами —
 * без этого модалки исчезли бы полностью.
 */
export function getModalRoot() {
  if (cached && cached.isConnected) return cached;

  if (typeof document === 'undefined') return null;

  let el = document.getElementById(MODAL_ROOT_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = MODAL_ROOT_ID;
    document.body.appendChild(el);
  }
  cached = el;
  return el;
}
