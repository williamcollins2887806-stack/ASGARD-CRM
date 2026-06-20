/**
 * Алёрт-бар горящих дедлайнов (показывается при burn>0).
 * Дизайн 1:1 с vanilla S-13 .hub-alert-bar.
 *
 * props:
 *   burnCount — количество тендеров с deadline ≤ 3 дня
 *   onShow — handler «Показать» (применяет period/status фильтр)
 *   hotIds — массив ID для отображения в подписи (опционально)
 */
export default function AlertBar({ burnCount = 0, onShow, hotIds = [] }) {
  if (!burnCount) return null;
  const idsHint = hotIds.length
    ? hotIds.slice(0, 5).map((id) => `#${id}`).join(', ') + (hotIds.length > 5 ? ` …+${hotIds.length - 5}` : '')
    : '';
  return (
    <div className="tnd-hub-alert-bar" role="alert">
      <span className="tnd-hub-alert-ic" aria-hidden>🔥</span>
      <span className="tnd-hub-alert-text">
        Горящие дедлайны: <b>{burnCount}</b>
        {idsHint ? <> · {idsHint}</> : null}
      </span>
      {typeof onShow === 'function' && (
        <button
          type="button"
          className="tnd-hub-alert-btn"
          onClick={onShow}
        >
          Показать
        </button>
      )}
    </div>
  );
}
