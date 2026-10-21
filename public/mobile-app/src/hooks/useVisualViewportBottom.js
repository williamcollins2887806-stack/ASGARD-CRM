import { useEffect } from 'react';

/**
 * useVisualViewportBottom — выравнивает элементы, прижатые к низу (`position: fixed;
 * bottom: 0`), по НИЖНЕЙ ГРАНИЦЕ ВИДИМОЙ ОБЛАСТИ.
 *
 * Зачем (21.10.2026, жалоба заказчика: «тап-бар то поднимется, то внизу», «после
 * обновления страницы снова вверху»):
 *   • `position: fixed; bottom: 0` считается от LAYOUT viewport;
 *   • пользователь видит VISUAL viewport — он меньше и/или смещён, когда Safari
 *     показывает панели, открыта клавиатура или идёт свайп-возврат;
 *   • пока эти два не совпадают, бар оказывается выше низа экрана;
 *   • после перезагрузки Safari сбрасывает панели, значения совпадают — и бар
 *     «встаёт на место». Отсюда ощущение «иногда слетает, иногда нет».
 *
 * Решение: считаем зазор между низом visual viewport и низом layout viewport и
 * пишем его в CSS-переменную `--vv-bottom`. Бар использует её как `bottom`.
 * В обычном состоянии зазор равен 0 — поведение не меняется.
 *
 * Учитывает: resize/scroll самого visualViewport (iOS не всегда шлёт window.resize),
 * а также возврат на страницу из bfcache (pageshow) и поворот экрана.
 */
export function useVisualViewportBottom() {
  useEffect(() => {
    const root = document.documentElement;
    let raf = 0;

    const apply = () => {
      const vv = window.visualViewport;
      let offset = 0;
      if (vv) {
        // Расстояние от низа layout viewport до низа visual viewport.
        offset = window.innerHeight - (vv.height + vv.offsetTop);
      }
      // Клавиатура уменьшает visualViewport и поднимает offsetTop — в этом случае
      // бар не должен «улетать» вверх: ограничиваем разумным пределом (клавиатура
      // перекрывает контент, но бар логичнее оставить у низа).
      const safe = Math.max(0, Math.min(Math.round(offset), 120));
      root.style.setProperty('--vv-bottom', `${safe}px`);
    };

    const schedule = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => { raf = 0; apply(); });
    };

    apply();

    const vv = window.visualViewport;
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);
    window.addEventListener('pageshow', apply);
    vv?.addEventListener('resize', schedule);
    vv?.addEventListener('scroll', schedule);

    // Страховка на первые кадры: iOS меняет значения не мгновенно после загрузки.
    const timers = [100, 400, 1000].map((ms) => window.setTimeout(apply, ms));

    return () => {
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', schedule);
      window.removeEventListener('pageshow', apply);
      vv?.removeEventListener('resize', schedule);
      vv?.removeEventListener('scroll', schedule);
      timers.forEach(window.clearTimeout);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, []);
}

export default useVisualViewportBottom;
