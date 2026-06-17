/**
 * ReworkBanner — баннер «Работа на доработке» (или «Вопрос директора»).
 * Vanilla: estimate_report.js:664..675 (renderReworkBanner).
 *
 * Показывается, когда approval_status === 'rework' или 'question'.
 * Поля: estimate.last_director_comment, estimate.director_name, approval_status.
 */
export default function ReworkBanner({ estimate }) {
  const est = estimate || {};
  if (!['rework', 'question'].includes(est.approval_status)) return null;

  const isQuestion = est.approval_status === 'question';
  const actionLabel = isQuestion ? 'Вопрос директора' : 'Замечание директора';
  const icon = isQuestion ? '❓' : '↻';

  return (
    <div className={'card er-rework-banner ' + (isQuestion ? 'er-rework-banner--question' : 'er-rework-banner--rework')}>
      <div className="er-rework-banner__icon" aria-hidden="true">{icon}</div>
      <div className="er-rework-banner__body">
        <div className="er-rework-banner__title">{actionLabel}</div>
        {est.last_director_comment && (
          <div className="er-rework-banner__text">{est.last_director_comment}</div>
        )}
        {est.director_name && (
          <div className="er-rework-banner__who">— {est.director_name}</div>
        )}
      </div>
    </div>
  );
}
