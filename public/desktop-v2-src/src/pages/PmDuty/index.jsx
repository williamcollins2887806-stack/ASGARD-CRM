/**
 * /pm-duty — дежурство РП, очередь отчётов
 */
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { TopActionsBar } from '@/blocks/Blocks';
import AccessDenied from '@/blocks/AccessDenied';
import {
  loadPmDutyQueue, loadPmDutyCurrent, savePmDutyRoster, loadUsers
} from '@/pages/Tenders/api';
import RpReviewModal from '@/pages/Tenders/modals/RpReviewModal';

const ALLOWED = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
const ASSIGN = ['ADMIN', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

export default function PmDutyPage() {
  const { user } = useAuth();
  const modal = useModal();
  const [tab, setTab] = useState('need_report');
  const [items, setItems] = useState([]);
  const [banner, setBanner] = useState(null);
  const [duty, setDuty] = useState(null);
  const [isDuty, setIsDuty] = useState(false);
  const [pms, setPms] = useState([]);
  const [form, setForm] = useState({ pm_user_id: '', period_start: '', period_end: '' });

  const refresh = useCallback(() => {
    loadPmDutyQueue(tab).then(d => {
      setItems(d.items || []);
      setBanner(d.banner);
      setDuty(d.duty);
      setIsDuty(!!d.is_duty);
    }).catch(e => toast(e.message, 'err'));
    loadPmDutyCurrent().then(d => setDuty(d.duty || d));
  }, [tab]);

  useEffect(() => {
    refresh();
    loadUsers('PM,HEAD_PM').then(u => setPms(u || []));
  }, [refresh]);

  if (!user || !ALLOWED.includes(user.role)) {
    return <AccessDenied message="Страница дежурства РП" />;
  }

  const assign = () => {
    savePmDutyRoster({
      pm_user_id: Number(form.pm_user_id),
      period_start: form.period_start,
      period_end: form.period_end
    }).then(() => { toast('Дежурный назначен', 'ok'); refresh(); })
      .catch(e => toast(e.message, 'err'));
  };

  const openReview = (tender) => {
    modal.open(({ close }) => (
      <RpReviewModal tender={tender} pms={pms} onClose={close} onSaved={refresh} />
    ));
  };

  return (
    <div className="page pm-duty-page">
      <TopActionsBar title="Дежурство РП" subtitle="Проверка тендеров и отчёты" />

      {ASSIGN.includes(user.role) && (
        <div className="card" style={{ marginBottom: 16, padding: 12 }}>
          <h4>Назначить дежурного</h4>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'end' }}>
            <label>РП
              <select className="inp" value={form.pm_user_id} onChange={e => setForm(f => ({ ...f, pm_user_id: e.target.value }))}>
                <option value="">—</option>
                {pms.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label>С<input type="date" className="inp" value={form.period_start} onChange={e => setForm(f => ({ ...f, period_start: e.target.value }))} /></label>
            <label>По<input type="date" className="inp" value={form.period_end} onChange={e => setForm(f => ({ ...f, period_end: e.target.value }))} /></label>
            <Btn onClick={assign}>Назначить</Btn>
          </div>
          {duty?.pm_name && (
            <p className="muted" style={{ marginTop: 8 }}>
              Текущий: {duty.pm_name} ({duty.period_start} — {duty.period_end})
            </p>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <Btn variant={tab === 'need_report' ? 'primary' : 'ghost'} onClick={() => setTab('need_report')}>Нужен отчёт</Btn>
        <Btn variant={tab === 'my_reviewed' ? 'primary' : 'ghost'} onClick={() => setTab('my_reviewed')}>Мои проверенные</Btn>
      </div>

      {banner && (
        <div className="alert warn" style={{ marginBottom: 12 }}>{banner.message}</div>
      )}

      {!isDuty && tab === 'need_report' && items.length === 0 && !banner && (
        <div className="alert" style={{ marginBottom: 12 }}>
          Вы не дежурный.{duty?.pm_name ? ` Дежурный: ${duty.pm_name}.` : ''} Обратитесь к TO / рук. ТО.
        </div>
      )}

      <table className="tnd-table" style={{ width: '100%', fontSize: 13 }}>
        <thead>
          <tr><th>ID</th><th>Заказчик / Тендер</th><th>Дедлайн</th><th>Решение</th><th></th></tr>
        </thead>
        <tbody>
          {items.map(row => (
            <tr key={row.id}>
              <td>{row.id}</td>
              <td>{row.customer_name}<br /><small>{row.tender_title}</small></td>
              <td>{row.docs_deadline ? String(row.docs_deadline).slice(0, 10) : '—'}</td>
              <td>{row.decision || 'pending'}{row.is_final ? ' ✓' : ''}</td>
              <td>
                {(isDuty || tab === 'my_reviewed') && !row.is_final && tab === 'need_report' && (
                  <Btn size="sm" onClick={() => openReview(row)}>Отчёт</Btn>
                )}
                {tab === 'my_reviewed' && (
                  <Btn size="sm" variant="ghost" onClick={() => openReview(row)}>Открыть</Btn>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length === 0 && <p className="muted">Нет тендеров в этом списке</p>}
    </div>
  );
}
