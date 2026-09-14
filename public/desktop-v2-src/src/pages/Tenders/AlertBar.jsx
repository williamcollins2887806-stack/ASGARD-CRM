/**
 * Алёрт-бар горящих дедлайнов.
 */
export default function AlertBar({ burnCount = 0, onShow, hotIds = [] }) {
  if (!burnCount) return null;
  const idsHint = hotIds.length
    ? hotIds.slice(0, 5).map((id) => `#${id}`).join(', ') + (hotIds.length > 5 ? ` …+${hotIds.length - 5}` : '')
    : '';
  return (
    <div className="tnd-hub-alert-bar" role="alert">
      <span className="tnd-hub-alert-ic" aria-hidden>🔥</span>
      <div className="tnd-hub-alert-text">
        <strong>Горящие дедлайны</strong>
        <span> ≤ 3 дней: <b>{burnCount}</b>{idsHint ? <> · {idsHint}</> : null}</span>
      </div>
      {typeof onShow === 'function' && (
        <button type="button" className="tnd-hub-alert-btn" onClick={onShow}>
          Показать в реестре
        </button>
      )}
    </div>
  );
}
