import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '@/api/client';
import PmTabBar from '@/components/pm/PmTabBar';

const C = {
  bg: '#0d0d12', card: '#16161f', gold: '#c8a84b',
  green: '#22c55e', red: '#ef4444', amber: '#f59e0b',
  blue: '#3b82f6', rune: '#7b61ff', text: '#e8e8f0', muted: '#6b7280',
};

const fmt = (n) => n != null ? Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : '0';

export default function PmTimesheet() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const now = new Date();
  const [year, setYear]   = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [workId, setWorkId] = useState(params.get('work_id') || '');
  const [works, setWorks]   = useState([]);
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(false);
  const [editCell, setEditCell] = useState(null); // {empId, day, checkin}
  const [addForm, setAddForm] = useState(null);   // {empId, day, workId}
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.get('/pm/works').then(r => setWorks(r.works || []));
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams({ year, month });
    if (workId) q.set('work_id', workId);
    api.get(`/pm/timesheet?${q}`)
      .then(setData)
      .catch(e => setMsg(e.message))
      .finally(() => setLoading(false));
  }, [year, month, workId]);

  useEffect(() => { load(); }, [load]);

  function changeMonth(delta) {
    let m = month + delta;
    let y = year;
    if (m > 12) { m = 1; y++; }
    if (m < 1)  { m = 12; y--; }
    setMonth(m); setYear(y);
  }

  async function handleEditSave(checkinId, fields) {
    setSaving(true);
    try {
      await api.put(`/pm/timesheet/${checkinId}`, fields);
      setMsg('Сохранено'); setEditCell(null); load();
    } catch (e) { setMsg('Ошибка: ' + e.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(checkinId) {
    if (!confirm('Отменить эту смену?')) return;
    setSaving(true);
    try {
      await api.delete(`/pm/timesheet/${checkinId}`);
      setMsg('Смена отменена'); setEditCell(null); load();
    } catch (e) { setMsg('Ошибка: ' + e.message); }
    finally { setSaving(false); }
  }

  async function handleAdd(empId, day, wId) {
    setSaving(true);
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    try {
      await api.post('/pm/timesheet', {
        employee_id: empId,
        work_id: wId || (workId ? parseInt(workId) : null),
        date: dateStr,
        shift: 'day',
        hours_worked: 8,
        amount_earned: 0,
        note: 'РП вручную',
      });
      setMsg('Смена добавлена'); setAddForm(null); load();
    } catch (e) { setMsg('Ошибка: ' + e.message); }
    finally { setSaving(false); }
  }

  const { workers = [], days = [] } = data || {};

  return (
    <div style={{ minHeight: '100vh', background: C.bg, paddingBottom: 90 }}>
      {/* Header */}
      <div style={{ padding: '48px 16px 16px', background: 'linear-gradient(180deg, #0d1429 0%, transparent 100%)' }}>
        <button onClick={() => navigate('/pm')}
          style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 14, marginBottom: 10, padding: 0 }}>
          ← Назад
        </button>
        <div style={{ fontSize: 22, fontWeight: 900, color: C.text }}>📋 Табель</div>

        {/* Навигация по месяцам */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
          <button onClick={() => changeMonth(-1)}
            style={{ background: C.card, border: 'none', color: C.text, borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 16 }}>‹</button>
          <div style={{ flex: 1, textAlign: 'center', fontSize: 15, fontWeight: 700, color: C.text }}>
            {data?.month_name || ''} {year}
          </div>
          <button onClick={() => changeMonth(1)}
            style={{ background: C.card, border: 'none', color: C.text, borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 16 }}>›</button>
        </div>

        {/* Фильтр объекта */}
        <select value={workId} onChange={e => setWorkId(e.target.value)}
          style={{ marginTop: 10, width: '100%', background: C.card, border: '1px solid #ffffff15', borderRadius: 10, padding: '8px 12px', color: C.text, fontSize: 13 }}>
          <option value="">Все объекты</option>
          {works.map(w => <option key={w.id} value={w.id}>{w.work_title || `Объект #${w.id}`}</option>)}
        </select>
      </div>

      {msg && (
        <div style={{ margin: '0 16px 10px', padding: '10px 14px', borderRadius: 10, background: C.card, color: C.green, fontSize: 13, textAlign: 'center' }}>
          {msg}
          <button onClick={() => setMsg('')} style={{ marginLeft: 10, background: 'none', border: 'none', color: C.muted, cursor: 'pointer' }}>✕</button>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: C.gold, fontSize: 32 }}>⚡</div>
      ) : workers.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: C.muted }}>Нет рабочих на выбранном объекте</div>
      ) : (
        <div style={{ padding: '0 16px', overflowX: 'auto' }}>
          {/* Таблица: вертикальный список рабочих с горизонтальными днями */}
          {workers.map(worker => (
            <div key={worker.id} style={{ background: C.card, borderRadius: 14, marginBottom: 12, overflow: 'hidden', border: '1px solid #ffffff0d' }}>
              {/* Заголовок рабочего */}
              <div style={{ padding: '10px 14px', background: '#ffffff05', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                onClick={() => navigate(`/pm/workers/${worker.id}`)}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{worker.fio}</div>
                  <div style={{ fontSize: 11, color: C.muted }}>{worker.work_title}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.gold }}>{worker.total_shifts} смен</div>
                  <div style={{ fontSize: 11, color: C.muted }}>{fmt(worker.total_earned)} ₽</div>
                </div>
              </div>

              {/* Дни месяца — горизонтальная лента */}
              <div style={{ padding: '8px 10px', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {days.map(day => {
                  const checkin = worker.checkins[day];
                  const dateObj = new Date(year, month - 1, day);
                  const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;

                  return (
                    <div key={day}
                      onClick={() => {
                        if (checkin) setEditCell({ empId: worker.id, day, checkin, workId: worker.work_id });
                        else setAddForm({ empId: worker.id, day, workId: worker.work_id });
                      }}
                      style={{
                        width: 36, height: 36, borderRadius: 8, cursor: 'pointer',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                        background: checkin
                          ? (checkin.shift === 'day' ? C.green + '25' : C.blue + '25')
                          : isWeekend ? '#ffffff05' : '#ffffff08',
                        border: `1px solid ${checkin
                          ? (checkin.shift === 'day' ? C.green + '60' : C.blue + '60')
                          : '#ffffff10'}`,
                      }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: checkin ? C.text : C.muted }}>{day}</div>
                      {checkin && (
                        <div style={{ fontSize: 8, color: checkin.shift === 'day' ? C.green : C.blue }}>
                          {checkin.shift === 'day' ? '☀' : '🌙'}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Модал редактирования смены */}
      {editCell && (
        <div style={{ position: 'fixed', inset: 0, background: '#000000cc', zIndex: 100, display: 'flex', alignItems: 'flex-end' }}>
          <EditShiftModal
            checkin={editCell.checkin}
            day={editCell.day}
            month={month}
            year={year}
            onSave={(fields) => handleEditSave(editCell.checkin.id, fields)}
            onDelete={() => handleDelete(editCell.checkin.id)}
            onClose={() => setEditCell(null)}
            saving={saving}
          />
        </div>
      )}

      {/* Модал добавления смены */}
      {addForm && (
        <div style={{ position: 'fixed', inset: 0, background: '#000000cc', zIndex: 100, display: 'flex', alignItems: 'flex-end' }}>
          <AddShiftModal
            day={addForm.day}
            month={month}
            year={year}
            works={works}
            defaultWorkId={addForm.workId}
            onAdd={(wId) => handleAdd(addForm.empId, addForm.day, wId)}
            onClose={() => setAddForm(null)}
            saving={saving}
          />
        </div>
      )}
      <PmTabBar />
    </div>
  );
}

function EditShiftModal({ checkin, day, month, year, onSave, onDelete, onClose, saving }) {
  const [amount, setAmount] = useState(checkin.amount_earned || '');
  const [hours, setHours]   = useState(checkin.hours_worked || 8);
  const [shift, setShift]   = useState(checkin.shift || 'day');
  const C2 = { card: '#1e1e2e', text: '#e8e8f0', muted: '#6b7280', green: '#22c55e', red: '#ef4444', blue: '#3b82f6' };

  return (
    <div style={{ width: '100%', background: '#16161f', borderRadius: '20px 20px 0 0', padding: '20px 16px 40px' }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: C2.text, marginBottom: 4 }}>
        Смена {day}.{String(month).padStart(2,'0')}.{year}
      </div>
      <div style={{ height: 1, background: '#ffffff10', margin: '12px 0' }} />
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {['day', 'night'].map(s => (
          <button key={s} onClick={() => setShift(s)}
            style={{ flex: 1, padding: '8px 0', borderRadius: 10, border: 'none', cursor: 'pointer',
              background: shift === s ? (s === 'day' ? C2.green : C2.blue) : '#ffffff10',
              color: shift === s ? '#000' : C2.muted, fontWeight: 700, fontSize: 13 }}>
            {s === 'day' ? '☀️ День' : '🌙 Ночь'}
          </button>
        ))}
      </div>
      <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
        placeholder="Сумма ₽"
        style={{ width: '100%', background: '#1a1a2e', border: '1px solid #ffffff15', borderRadius: 8, padding: '10px 12px', color: C2.text, fontSize: 14, marginBottom: 8, boxSizing: 'border-box' }} />
      <input type="number" value={hours} onChange={e => setHours(e.target.value)}
        placeholder="Часов"
        style={{ width: '100%', background: '#1a1a2e', border: '1px solid #ffffff15', borderRadius: 8, padding: '10px 12px', color: C2.text, fontSize: 14, marginBottom: 12, boxSizing: 'border-box' }} />
      <button onClick={() => onSave({ amount_earned: parseFloat(amount), hours_worked: parseFloat(hours), shift })}
        disabled={saving}
        style={{ width: '100%', padding: '12px 0', borderRadius: 12, border: 'none', cursor: 'pointer', background: C2.green, color: '#000', fontWeight: 700, marginBottom: 8 }}>
        {saving ? '...' : 'Сохранить'}
      </button>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onDelete} disabled={saving}
          style={{ flex: 1, padding: '10px 0', borderRadius: 12, border: 'none', cursor: 'pointer', background: C2.red + '20', color: C2.red, fontWeight: 700 }}>
          Удалить смену
        </button>
        <button onClick={onClose}
          style={{ flex: 1, padding: '10px 0', borderRadius: 12, border: 'none', cursor: 'pointer', background: '#ffffff10', color: C2.muted, fontWeight: 700 }}>
          Отмена
        </button>
      </div>
    </div>
  );
}

function AddShiftModal({ day, month, year, works, defaultWorkId, onAdd, onClose, saving }) {
  const [wId, setWId] = useState(defaultWorkId || (works[0]?.id || ''));
  const C2 = { text: '#e8e8f0', muted: '#6b7280', green: '#22c55e' };

  return (
    <div style={{ width: '100%', background: '#16161f', borderRadius: '20px 20px 0 0', padding: '20px 16px 40px' }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: C2.text, marginBottom: 12 }}>
        Добавить смену {day}.{String(month).padStart(2,'0')}.{year}
      </div>
      <select value={wId} onChange={e => setWId(e.target.value)}
        style={{ width: '100%', background: '#1a1a2e', border: '1px solid #ffffff15', borderRadius: 8, padding: '10px 12px', color: C2.text, fontSize: 13, marginBottom: 12, boxSizing: 'border-box' }}>
        {works.map(w => <option key={w.id} value={w.id}>{w.work_title || `Объект #${w.id}`}</option>)}
      </select>
      <button onClick={() => onAdd(parseInt(wId))} disabled={saving || !wId}
        style={{ width: '100%', padding: '12px 0', borderRadius: 12, border: 'none', cursor: 'pointer', background: C2.green, color: '#000', fontWeight: 700, marginBottom: 8 }}>
        {saving ? '...' : 'Добавить смену'}
      </button>
      <button onClick={onClose}
        style={{ width: '100%', padding: '10px 0', borderRadius: 12, border: 'none', cursor: 'pointer', background: '#ffffff10', color: C2.muted, fontWeight: 700 }}>
        Отмена
      </button>
    </div>
  );
}
