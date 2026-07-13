/**

 * /pm-duty — дежурство РП, очередь отчётов, график

 */

import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';

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
const DIRECTOR_ROLES = ['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

function userCanRole(user, roles) {
  if (!user) return false;
  if (user.role === 'ADMIN') return true;
  const rs = user.roles?.length ? user.roles : (user.role ? [user.role] : []);
  return roles.some((r) => rs.includes(r));
}

const QUEUE_TABS = [
  { id: 'analysis', label: 'Анализ' },
  { id: 'calc', label: 'Просчёты' },
  { id: 'archive', label: 'Архив' }
];

function normalizeTab(tab) {
  if (!tab || tab === 'need_report') return 'analysis';
  if (tab === 'drafts' || tab === 'my_reviewed') return tab === 'my_reviewed' ? 'archive' : 'calc';
  return QUEUE_TABS.some((t) => t.id === tab) ? tab : 'analysis';
}

function queueSourceLabel(row, tab) {
  if (row.queue_source) return row.queue_source;
  if (tab === 'analysis') return 'Дежурная очередь';
  if (row.created_by_name) return 'Назначил ТО';
  return '—';
}

function tabHint(tab) {
  if (tab === 'analysis') return 'Быстрый анализ: подаём / не подаём (дежурная очередь «рассмотрение»)';
  if (tab === 'calc') return 'Назначили мне + черновики — полный просчёт со сметой';
  return 'Закрытые отчёты — бывший «Свод расчётов»';
}

function queueStatusLabel(row) {
  if (row.is_final) return 'Отчёт готов';
  if (row.decision === 'submit') return 'Подаём';
  if (row.decision === 'reject') return 'Не подаём';
  if (row.review_id && !row.is_final) return 'Черновик';
  return 'Новый';
}

function fmtDateRu(value) {
  if (!value) return '—';
  const s = String(value).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
  return s || '—';
}



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
  const location = useLocation();
  const modal = useModal();

  const [tab, setTab] = useState(() => {
    const params = new URLSearchParams(location.search || '');
    if (!params.get('tab') && location.hash) {
      const q = location.hash.indexOf('?');
      if (q >= 0) return normalizeTab(new URLSearchParams(location.hash.slice(q + 1)).get('tab'));
    }
    return normalizeTab(params.get('tab'));
  });

  const [items, setItems] = useState([]);

  const [roster, setRoster] = useState([]);

  const [banner, setBanner] = useState(null);

  const [duty, setDuty] = useState(null);

  const [isDuty, setIsDuty] = useState(false);

  const [pms, setPms] = useState([]);

  const [form, setForm] = useState({ pm_user_id: '', period_start: '', period_end: '' });

  const [editId, setEditId] = useState(null);

  const canAssign = userCanRole(user, ASSIGN);



  const refresh = useCallback(() => {

    loadPmDutyQueue(tab).then(d => {

      setItems(d.items || []);

      setBanner(d.banner);

      setDuty(d.duty);

      setIsDuty(!!d.is_duty);

    }).catch(e => toast(e.message, 'err'));

    loadPmDutyCurrent().then(d => setDuty(d.duty || d));

    if (userCanRole(user, ASSIGN)) {

      loadPmDutyRoster(50).then(d => setRoster(d.items || [])).catch(() => {});

    }

  }, [tab, user]);

  useEffect(() => {
    const params = new URLSearchParams(location.search || '');
    let t = params.get('tab');
    if (!t && location.hash) {
      const q = location.hash.indexOf('?');
      if (q >= 0) t = new URLSearchParams(location.hash.slice(q + 1)).get('tab');
    }
    const next = normalizeTab(t);
    if (next !== tab) setTab(next);
  }, [location.search, location.hash, tab]);

  useEffect(() => {
    refresh();
    loadUsers('PM,HEAD_PM').then(u => setPms(u || []));
  }, [refresh]);

  useEffect(() => {
    const params = new URLSearchParams(location.search || '');
    let roster = params.get('roster');
    if (!roster && location.hash) {
      const q = location.hash.indexOf('?');
      if (q >= 0) roster = new URLSearchParams(location.hash.slice(q + 1)).get('roster');
    }
    if (roster === '1' && canAssign) {
      const el = document.getElementById('pm-duty-roster');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [location.search, location.hash, canAssign]);



  if (!user || !userCanRole(user, ALLOWED)) {

    return <AccessDenied message="Просчёты РП" />;

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
    const readOnly = tab === 'archive' || !!tender.is_final;
    const mode = tab === 'calc' ? 'calc' : 'analysis';
    const role = user?.role || '';
    let reviewRole = '';
    let locked = readOnly;
    if (DIRECTOR_ROLES.includes(role)) {
      reviewRole = 'viewer';
      locked = true;
    } else if (role === 'HEAD_TO') {
      locked = true;
      reviewRole = tender.is_final ? 'to' : 'viewer';
    }
    modal.open(({ close }) => (
      <RpReviewModal
        tender={tender}
        pms={pms}
        readOnly={locked}
        role={reviewRole}
        mode={mode}
        onClose={close}
        onSaved={refresh}
      />
    ), { size: 'wide' });
  };



  return (

    <div className="page pm-duty-page">

      <TopActionsBar title="Просчёты РП" subtitle="Анализ, просчёты (включая черновики) и архив" />



      {canAssign && (

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

              Текущий: {duty.pm_name} ({fmtDateRu(duty.period_start)} — {fmtDateRu(duty.period_end)})

            </p>

          )}

        </div>

      )}



      {canAssign && (

        <div className="card" style={{ marginBottom: 16, padding: 12 }} id="pm-duty-roster">

          <h4>График дежурств</h4>

          <table className="tnd-table" style={{ width: '100%', fontSize: 13 }}>

            <thead>

              <tr><th>РП</th><th>С</th><th>По</th><th>Назначил</th><th></th></tr>

            </thead>

            <tbody>

              {roster.map(r => (

                <tr key={r.id}>

                  <td>{r.pm_name}</td>

                  <td>{fmtDateRu(r.period_start)}</td>

                  <td>{fmtDateRu(r.period_end)}</td>

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



      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {QUEUE_TABS.map((t) => (
          <Btn
            key={t.id}
            variant={tab === t.id ? 'primary' : 'ghost'}
            onClick={() => {
              setTab(t.id);
              window.location.hash = `#/pm-calculations?tab=${t.id}`;
            }}
          >
            {t.label}
          </Btn>
        ))}
      </div>



      {banner && (

        <div className="alert warn" style={{ marginBottom: 12 }}>{banner.message}</div>

      )}



      {!isDuty && tab === 'analysis' && items.length === 0 && !banner && (

        <div className="alert" style={{ marginBottom: 12 }}>

          Вы не дежурный.{duty?.pm_name ? ` Дежурный: ${duty.pm_name}.` : ''} Обратитесь к TO / рук. ТО.

        </div>

      )}



      <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>{tabHint(tab)}</p>

      <table className="tnd-table" style={{ width: '100%', fontSize: 13 }}>

        <thead>

          <tr><th>ID</th><th>Заказчик / Тендер</th><th>Дедлайн</th><th>Источник</th><th>Статус</th><th></th></tr>

        </thead>

        <tbody>

          {items.map(row => (

            <tr key={row.id}>

              <td>{row.id}</td>

              <td>{row.customer_name}<br /><small>{row.tender_title}</small></td>

              <td>{fmtDateRu(row.docs_deadline)}</td>

              <td className="muted" style={{ fontSize: 12 }}>
                {queueSourceLabel(row, tab)}
                {(row.started_by_name || row.created_by_name) && queueSourceLabel(row, tab).includes('ТО') && (
                  <><br /><small>{row.started_by_name || row.created_by_name}</small></>
                )}
              </td>

              <td>
                <span className={`pill${row.is_final ? ' ok' : (queueStatusLabel(row) === 'Черновик' ? ' warn' : '')}`}>
                  {queueStatusLabel(row)}
                </span>
              </td>

              <td>
                {(tab === 'analysis' || tab === 'calc') && !row.is_final && (
                  <Btn size="sm" onClick={() => openReview(row)}>Отчёт</Btn>
                )}
                {tab === 'archive' && (
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

