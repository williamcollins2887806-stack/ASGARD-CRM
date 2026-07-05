/**
 * RpReviewModal — отчёт отказа / проработки + коллабораторы
 */
import { useState, useEffect } from 'react';
import { Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { loadRpReview, saveRpReview, inviteRpCollaborator } from '../api';

const REJECT_TEMPLATE = [{ point: '', reason: '' }];
const WORK_TEMPLATE = { summary: '', scope: '', risks: '', questions_for_customer: [], missing_info: [] };

export default function RpReviewModal({ tender, pms = [], onClose, onSaved }) {
  const [review, setReview] = useState(null);
  const [logs, setLogs] = useState([]);
  const [collabs, setCollabs] = useState([]);
  const [decision, setDecision] = useState('pending');
  const [reportKind, setReportKind] = useState('work');
  const [reportJson, setReportJson] = useState(WORK_TEMPLATE);
  const [workPrice, setWorkPrice] = useState('');
  const [invitePm, setInvitePm] = useState('');
  const [tab, setTab] = useState('report');

  useEffect(() => {
    if (!tender?.id) return;
    loadRpReview(tender.id).then(d => {
      setReview(d.review);
      setLogs(d.logs || []);
      setCollabs(d.collaborators || []);
      setDecision(d.review?.decision || 'pending');
      setReportKind(d.review?.report_kind || 'work');
      setReportJson(d.review?.report_json || WORK_TEMPLATE);
      setWorkPrice(d.review?.work_price ?? '');
    }).catch(e => toast(e.message, 'err'));
  }, [tender?.id]);

  const save = (finalize = false) => {
    saveRpReview(tender.id, {
      decision,
      report_kind: reportKind,
      report_json: reportJson,
      work_price: workPrice ? Number(workPrice) : null,
      finalize
    }).then(d => {
      setReview(d.review);
      toast(finalize ? 'Отчёт закрыт' : 'Сохранено', 'ok');
      onSaved?.();
      if (finalize) onClose?.();
    }).catch(e => toast(e.message, 'err'));
  };

  const invite = () => {
    if (!invitePm) return;
    inviteRpCollaborator(tender.id, Number(invitePm))
      .then(() => {
        toast('РП приглашён', 'ok');
        loadRpReview(tender.id).then(d => setCollabs(d.collaborators || []));
      })
      .catch(e => toast(e.message, 'err'));
  };

  if (!tender) return null;

  return (
    <div className="modal-body" style={{ minWidth: 480 }}>
      <h3>Отчёт РП — #{tender.id}</h3>
      <p className="muted">{tender.customer_name} · {tender.tender_title}</p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <Btn variant={tab === 'report' ? 'primary' : 'ghost'} size="sm" onClick={() => setTab('report')}>Отчёт</Btn>
        <Btn variant={tab === 'history' ? 'primary' : 'ghost'} size="sm" onClick={() => setTab('history')}>История</Btn>
      </div>

      {tab === 'report' && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <label><input type="radio" checked={decision === 'submit'} onChange={() => { setDecision('submit'); setReportKind('work'); }} /> Подаём</label>
            <label><input type="radio" checked={decision === 'reject'} onChange={() => { setDecision('reject'); setReportKind('reject'); setReportJson({ points: REJECT_TEMPLATE }); }} /> Не подаём</label>
          </div>

          {decision === 'reject' && (
            <div>
              {(reportJson.points || REJECT_TEMPLATE).map((p, i) => (
                <div key={i} style={{ marginBottom: 8 }}>
                  <input className="inp" placeholder="Пункт" value={p.point} style={{ width: '100%', marginBottom: 4 }}
                    onChange={e => {
                      const points = [...(reportJson.points || REJECT_TEMPLATE)];
                      points[i] = { ...points[i], point: e.target.value };
                      setReportJson({ ...reportJson, points });
                    }} />
                  <input className="inp" placeholder="Причина (1–2 строки)" value={p.reason} style={{ width: '100%' }}
                    onChange={e => {
                      const points = [...(reportJson.points || REJECT_TEMPLATE)];
                      points[i] = { ...points[i], reason: e.target.value };
                      setReportJson({ ...reportJson, points });
                    }} />
                </div>
              ))}
            </div>
          )}

          {decision === 'submit' && (
            <div>
              <textarea className="inp" rows={3} placeholder="Суть работ для ТО" style={{ width: '100%', marginBottom: 8 }}
                value={reportJson.summary || ''} onChange={e => setReportJson({ ...reportJson, summary: e.target.value })} />
              <textarea className="inp" rows={2} placeholder="Чего не хватает / что запросить" style={{ width: '100%', marginBottom: 8 }}
                value={(reportJson.missing_info || []).join('\n')}
                onChange={e => setReportJson({ ...reportJson, missing_info: e.target.value.split('\n').filter(Boolean) })} />
              <input className="inp" type="number" placeholder="Цена работ" value={workPrice}
                onChange={e => setWorkPrice(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
            </div>
          )}

          <div style={{ marginTop: 12, padding: 8, background: 'var(--bg-2)', borderRadius: 8 }}>
            <strong>Привлечь РП</strong>
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <select className="inp" value={invitePm} onChange={e => setInvitePm(e.target.value)} style={{ flex: 1 }}>
                <option value="">— РП —</option>
                {pms.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <Btn size="sm" onClick={invite}>Пригласить</Btn>
            </div>
            {collabs.length > 0 && (
              <ul style={{ margin: '8px 0 0', paddingLeft: 16 }}>
                {collabs.map(c => <li key={c.id}>{c.pm_name}</li>)}
              </ul>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <Btn onClick={() => save(false)}>Сохранить черновик</Btn>
            <Btn onClick={() => save(true)}>Закрыть отчёт</Btn>
            <Btn variant="ghost" onClick={onClose}>Выход</Btn>
          </div>
        </>
      )}

      {tab === 'history' && (
        <ul style={{ maxHeight: 280, overflow: 'auto', paddingLeft: 16 }}>
          {logs.map(l => (
            <li key={l.id} style={{ marginBottom: 6 }}>
              <small>{new Date(l.created_at).toLocaleString('ru')} — {l.actor_name}: {l.action}</small>
            </li>
          ))}
          {logs.length === 0 && <li className="muted">Пока нет действий</li>}
        </ul>
      )}
    </div>
  );
}
