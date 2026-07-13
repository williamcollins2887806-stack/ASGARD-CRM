/**
 * RpReportSnippet — краткий блок отчёта в карточке реестра (parity vanilla renderReportSnippet)
 */
import '../../../../../assets/css/rp-review-modal.css';
import {
  parseRj, fmtMoney, priceRangeLabel
} from './rpReviewHelpers';

export default function RpReportSnippet({ review, estimateFile, reportFile }) {
  if (!review) return null;
  const rj = parseRj(review.report_json, 'calc');
  const dec = review.decision;
  const cls = dec === 'submit' ? ' submit' : (dec === 'reject' ? ' reject' : '');
  const label = dec === 'submit' ? '✓ Подаём' : (dec === 'reject' ? '✕ Не подаём' : 'Черновик');
  const priceTxt = priceRangeLabel(rj, review.work_price);

  return (
    <div className="rp-review-snippet">
      <div className={'rp-review-summary-card' + cls}>
        <strong>{label}</strong>
        {priceTxt !== '—' && <> · {priceTxt}</>}
      </div>
      {rj.summary && (
        <div className="rp-review-ro"><div className="lbl">Суть</div><div>{rj.summary}</div></div>
      )}
      {rj.risks && (
        <div className="rp-review-ro"><div className="lbl">Риски</div><div>{rj.risks}</div></div>
      )}
      {rj.recommendation && (
        <div className="rp-review-ro"><div className="lbl">Рекомендация</div><div>{rj.recommendation}</div></div>
      )}
      {estimateFile && (
        <a className="btn mini" href={estimateFile.download_url} target="_blank" rel="noreferrer">Скачать смету</a>
      )}
      {reportFile && (
        <a className="btn mini" href={reportFile.download_url} target="_blank" rel="noreferrer" style={{ marginLeft: 8 }}>Скачать отчёт</a>
      )}
    </div>
  );
}
