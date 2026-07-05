/**
 * /pm-duty — дежурство РП, очередь отчётов, график
 */
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { TopActionsBar } from '@/blocks/Blocks';
import AccessDenied from '@/blocks/AccessDenied';
import {
  loadPmDutyQueue, loadPmDutyCurrent, savePmDutyRoster, updatePmDutyRoster,
  deletePmDutyRoster, loadPmDutyRoster, loadUsers
} from '@/pages/Tenders/api';
import RpReviewModal from '@/pages/Tenders/modals/RpReviewModal';

const ALLOWED = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
const ASSIGN = ['ADMIN', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

function isoDate(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

function weekPreset(kind) {
  const today = new Date();
  const dow = today.getDay();
  const monOffset = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(today);
  mon.setDate(today.getDate() + monOffset);
  const fri = new Date(mon);
  fri.setDate(mon.getDate() + 4);
  if (kind === 'today6') return { start: isoDate(today), end: addDays(isoDate(today), 6) };
  if (kind === 'thisWeek') return { start: isoDate(mon), end: isoDate(fri) };
  if (kind === 'nextWeek') {
    mon.setDate(mon.getDate() + 7);
    fri.setDate(fri.getDate() + 7);
    return { start: isoDate(mon), end: isoDate(fri) };
  }
  return { start: isoDate(today), end: addDays(isoDate(today), 6) };
}

export default function PmDutyPage() {
  const { user } = useAuth();
  const modal = useModal();
  const [tab, setTab] = useState('need_report');
  const [items, setItems] = useState([]);
  const [roster, setRoster] = useState([]);
  const [banner, setBanner] = useState(null);
  const [duty, setDuty] = useState(null);
  const [isDuty, setIsDuty] = useState(false);
  const [pms, setPms] = useState([]);
  const [form, setForm] = useState({ pm_user_id: '', period_start: '', period_end: '' });
  const [editId, setEditId] = useState(null);

  const refresh = useCallback(() => {
    loadPmDutyQueue(tab).then(d => {
      setItems(d.items || []);
      setBanner(d.banner);
      setDuty(d.duty);
      setIsDuty(!!d.is_duty);
    }).catch(e => toast(e.message, 'err'));
    loadPmDutyCurrent().then(d => setDuty(d.duty || d));
    if (ASSIGN.includes(user?.role)) {
      loadPmDutyRoster(50).then(d => setRoster(d.items || [])).catch(() => {});
    }
  }, [tab, user?.role]);

  useEffect(() => {
    refresh();
    loadUsers('PM,HEAD_PM').then(u => setPms(u || []));
  }, [refresh]);

  if (!user || !ALLOWED.includes(user.role)) {
    return <AccessDenied message="Страница дежурства РП" />;
  }

  const applyPreset = (kind) => {
    const p = weekPreset(kind);
    setForm(f => ({ ...f, period_start: p.start, period_end: p.end }));
  };

  const assign = () => {
    const fn = editId
      ? updatePmDutyRoster(editId, {
          pm_user_id: Number(form.pm_user_id),
          period_start: form.period_start,
          period_end: form.period_end
        })
      : savePmDutyRoster({
          pm_user_id: Number(form.pm_user_id),
          period_start: form.period_start,
          period_end: form.period_end
        });
    fn.then(() => {
      toast(editId ? 'Период обновлён' : 'Дежурный назначен', 'ok');
      setEditId(null);
      setForm({ pm_user_id: '', period_start: '', period_end: '' });
      refresh();
    }).catch(e => toast(e.message, 'err'));
  };

  const removeRoster = (id) => {
    if (!window.confirm('Удалить период дежурства?')) return;
    deletePmDutyRoster(id).then(() => { toast('Удалено', 'ok'); refresh(); })
      .catch(e => toast(e.message, 'err'));
  };

  const startEdit = (r) => {
    setEditId(r.id);
    setForm({
      pm_user_id: String(r.pm_user_id),
      period_start: String(r.period_start).slice(0, 10),
      period_end: String(r.period_end).slice(0, 10)
    });
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
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            <Btn variant="ghost" size="sm" onClick={() => applyPreset('today6')}>Сегодня+6 дней</Btn>
            <Btn variant="ghost" size="sm" onClick={() => applyPreset('thisWeek')}>Пн–Пт этой недели</Btn>
            <Btn variant="ghost" size="sm" onClick={() => applyPreset('nextWeek')}>След. неделя</Btn>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'end' }}>
            <label>РП
              <select className="inp" value={form.pm_user_id} onChange={e => setForm(f => ({ ...f, pm_user_id: e.target.value }))}>
                <option value="">—</option>
                {pms.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label>С<input type="date" className="inp" value={form.period_start} onChange={e => setForm(f => ({ ...f, period_start: e.target.value }))} /></label>
            <label>По<input type="date" className="inp" value={form.period_end} onChange={e => setForm(f => ({ ...f, period_end: e.target.value }))} /></label>
            <Btn onClick={assign}>{editId ? 'Сохранить' : 'Назначить'}</Btn>
            {editId && <Btn variant="ghost" onClick={() => { setEditId(null); setForm({ pm_user_id: '', period_start: '', period_end: '' }); }}>Отмена</Btn>}
          </div>
          {duty?.pm_name && (
            <p className="muted" style={{ marginTop: 8 }}>
              Текущий: {duty.pm_name} ({duty.period_start} — {duty.period_end})
            </p>
          )}
        </div>
      )}

      {ASSIGN.includes(user.role) && (
        <div className="card" style={{ marginBottom: 16, padding: 12 }}>
          <h4>График дежурств</h4>
          <table className="tnd-table" style={{ width: '100%', fontSize: 13 }}>
            <thead>
              <tr><th>РП</th><th>С</th><th>По</th><th>Назначил</th><th></th></tr>
            </thead>
            <tbody>
              {roster.map(r => (
                <tr key={r.id}>
                  <td>{r.pm_name}</td>
                  <td>{String(r.period_start).slice(0, 10)}</td>
                  <td>{String(r.period_end).slice(0, 10)}</td>
                  <td>{r.assigned_by_name || '—'}</td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <Btn size="sm" variant="ghost" onClick={() => startEdit(r)}>✎</Btn>
                    <Btn size="sm" variant="ghost" onClick={() => removeRoster(r.id)}>✕</Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!roster.length && <p className="muted">Нет записей в графике</p>}
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
