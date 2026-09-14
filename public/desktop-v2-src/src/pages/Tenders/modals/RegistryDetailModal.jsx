/**
 * Registry row detail — карточка и история
 */
import { useState, useEffect } from 'react';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { formatMoney } from '@/lib/money';
import { patchRegistryField, loadRegistryHistory, loadRpReview } from '../api';
import { useAuth } from '@/api/useAuth';
import RpReportSnippet from './RpReportSnippet';
import InlineDocsBar from './InlineDocsBar';
import TenderDocsReadOnly from './TenderDocsReadOnly';

function fmtDate(v) {
  if (!v) return '—';
  const s = String(v).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : s;
}

export default function RegistryDetailModal({ row, onClose, onRefresh, onEdit }) {
  const { user } = useAuth();
  const canEditDocs = ['TO', 'HEAD_TO', 'ADMIN'].includes(user?.role || '');
  const [tab, setTab] = useState('info');
  const [history, setHistory] = useState([]);
  const [reviewData, setReviewData] = useState(null);
  const [reviewLogs, setReviewLogs] = useState([]);
  const [comment, setComment] = useState(row.comment_to || '');

  useEffect(() => {
    loadRegistryHistory(row.id).then((d) => setHistory(d.history || d.items || [])).catch(() => {});
    loadRpReview(row.id).then((d) => {
      setReviewData(d);
      setReviewLogs(d?.logs || []);
    }).catch(() => {});
  }, [row.id]);

  const rev = reviewData?.review || row.rp_review;
  const estimate = reviewData?.estimate_file;
  const reportDoc = reviewData?.report_file;

  const saveComment = () => {
    patchRegistryField(row.id, 'comment_to', comment)
      .then(() => { toast.success('Сохранено'); onRefresh?.(); })
      .catch((e) => toast.error(e.message));
  };

  return (
    <MCard style={{ width: 'min(560px, 96vw)' }}>
      <MHead title={`Строка реестра #${row.id}`} onClose={onClose} />
      <MBody>
        <p className="muted" style={{ marginTop: 0 }}>{row.customer_name} — {row.tender_title}</p>
        <div className="reg-detail-tabs" style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {['info', 'history'].map((t) => (
            <Btn key={t} size="sm" variant={tab === t ? 'primary' : 'ghost'} onClick={() => setTab(t)}>
              {t === 'info' ? 'Карточка' : 'История'}
            </Btn>
          ))}
        </div>

        {tab === 'info' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              <div><span className="muted">Дедлайн</span><br /><strong>{fmtDate(row.docs_deadline)}</strong></div>
              <div><span className="muted">НМЦ</span><br /><strong>{formatMoney(row.tender_price)}</strong></div>
              <div>
                <span className="muted">Сбор за участие</span><br />
                <strong>
                  {row.participation_paid
                    ? (row.participation_fee != null ? formatMoney(row.participation_fee) : 'платно')
                    : 'бесплатно'}
                </strong>
              </div>
              <div><span className="muted">Анализ до</span><br /><strong>{fmtDate(row.analysis_deadline)}</strong></div>
              <div><span className="muted">Внёс</span><br />{row.created_by_name || '—'}</div>
              <div><span className="muted">Считает</span><br />{row.calculator_user_name || '—'}</div>
            </div>
            <label className="muted" style={{ fontSize: 12 }}>Комментарий ТО</label>
            <textarea className="inp" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} style={{ width: '100%' }} />
            <Btn size="sm" onClick={saveComment} style={{ marginTop: 8 }}>Сохранить комментарий</Btn>
            <hr style={{ margin: '12px 0', borderColor: 'var(--brd-1)' }} />
            <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>Документы (ТЗ и прочее)</h4>
            {canEditDocs ? <InlineDocsBar tenderId={row.id} /> : <TenderDocsReadOnly tenderId={row.id} />}
            {rev && (
              <>
                <hr style={{ margin: '12px 0', borderColor: 'var(--brd-1)' }} />
                <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>Отчёт просчёта</h4>
                <RpReportSnippet review={rev} estimateFile={estimate} reportFile={reportDoc} />
                {!rev.is_final && (
                  <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Цена и смета появятся после финализации отчёта.</p>
                )}
                {reviewLogs.length > 0 && (
                  <>
                    <hr style={{ margin: '12px 0', borderColor: 'var(--brd-1)' }} />
                    <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>История просчёта</h4>
                    <ul style={{ paddingLeft: 16, margin: 0, fontSize: 13 }}>
                      {reviewLogs.slice(0, 12).map((l) => (
                        <li key={l.id || l.created_at} style={{ marginBottom: 6 }}>
                          <small className="muted">
                            {new Date(l.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            {' — '}{l.actor_name || '—'}
                          </small>
                          <br />{l.action || l.event || ''}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
          </>
        )}

        {tab === 'history' && (
          <ul style={{ maxHeight: 320, overflow: 'auto', paddingLeft: 16 }}>
            {history.map((item) => (
              <li key={item.id || item.created_at} style={{ marginBottom: 8 }}>
                <small className="muted">{new Date(item.created_at).toLocaleString('ru-RU')} — {item.actor_name || '—'}</small><br />
                {item.action}{item.field ? ` · ${item.field}` : ''}
              </li>
            ))}
            {!history.length && <li className="muted">Нет записей</li>}
          </ul>
        )}
      </MBody>
      <MFoot align="spread">
        {onEdit ? <Btn variant="ghost" onClick={onEdit}>Редактировать</Btn> : <span />}
        <Btn variant="ghost" onClick={onClose}>Закрыть</Btn>
      </MFoot>
    </MCard>
  );
}
