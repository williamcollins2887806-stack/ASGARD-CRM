import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import PmTabBar from '@/components/pm/PmTabBar';

const C = {
  bg: '#0d0d12', card: '#16161f', gold: '#c8a84b',
  green: '#22c55e', red: '#ef4444', amber: '#f59e0b',
  blue: '#3b82f6', rune: '#7b61ff', text: '#e8e8f0', muted: '#6b7280',
};
const fmt = (n) => n != null ? Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽' : '—';

const PAY_TYPES  = { salary: 'Зарплата', advance: 'Аванс', per_diem: 'Суточные', bonus: 'Бонус', penalty: 'Штраф' };
const PAY_COLORS = { salary: C.green, advance: C.blue, per_diem: C.amber, bonus: C.rune, penalty: C.red };
const STATUS_CFG = {
  pending:   { label: 'Ожидает',    color: C.amber },
  paid:      { label: 'Выплачено',  color: C.green },
  confirmed: { label: 'Подтверждено', color: C.blue },
  cancelled: { label: 'Отменена',   color: C.muted },
};
const MONTHS = ['', 'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

export default function PmPayments() {
  const navigate = useNavigate();
  const now = new Date();
  const [statusFilter, setStatusFilter] = useState('pending');
  const [workId, setWorkId]     = useState('');
  const [month, setMonth]       = useState('');
  const [works, setWorks]       = useState([]);
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(false);
  const [showNew, setShowNew]   = useState(false);
  const [workers, setWorkers]   = useState([]);
  const [form, setForm]         = useState({
    employee_id: '', work_id: '', type: 'advance', amount: '',
    pay_month: now.getMonth() + 1, pay_year: now.getFullYear(), comment: '',
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg]       = useState('');

  useEffect(() => {
    api.get('/pm/works').then(r => setWorks(r.works || []));
    api.get('/pm/workers').then(r => setWorkers(r.workers || []));
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams();
    if (statusFilter) q.set('status', statusFilter);
    if (workId) q.set('work_id', workId);
    if (month) { q.set('month', month); q.set('year', now.getFullYear()); }
    api.get(`/pm/payments?${q}`)
      .then(setData)
      .catch(e => setMsg(e.message))
      .finally(() => setLoading(false));
  }, [statusFilter, workId, month]);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.employee_id || !form.work_id || !form.amount) {
      setMsg('Заполните все поля'); return;
    }
    setSaving(true);
    try {
      await api.post('/pm/payments', {
        employee_id: parseInt(form.employee_id),
        work_id: parseInt(form.work_id),
        type: form.type,
        amount: parseFloat(form.amount),
        pay_month: form.pay_month,
        pay_year: form.pay_year,
        comment: form.comment,
      });
      setMsg('Выплата создана');
      setShowNew(false);
      setForm(f => ({ ...f, employee_id: '', amount: '', comment: '' }));
      load();
    } catch (e) { setMsg('Ошибка: ' + e.message); }
    finally { setSaving(false); }
  }

  async function handleMarkPaid(payId) {
    if (!confirm('Отметить как выплачено?')) return;
    try {
      await api.put(`/pm/payments/${payId}/paid`, {});
      setMsg('Отмечено как выплачено');
      load();
    } catch (e) { setMsg('Ошибка: ' + e.message); }
  }

  async function handleCancel(payId) {
    if (!confirm('Отменить выплату?')) return;
    try {
      await api.delete(`/pm/payments/${payId}`);
      setMsg('Выплата отменена');
      load();
    } catch (e) { setMsg('Ошибка: ' + e.message); }
  }

  const payments = data?.payments || [];
  const summary  = data?.summary  || {};
  const totalPending = Math.round(summary.pending || 0);

  return (
    <div style={{ minHeight: '100vh', background: C.bg, paddingBottom: 90 }}>
      {/* Header */}
      <div style={{ padding: '48px 16px 16px', background: 'linear-gradient(180deg, #0d1a0d 0%, transparent 100%)' }}>
        <button onClick={() => navigate('/pm')}
          style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 14, marginBottom: 10, padding: 0 }}>
          ← Назад
        </button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: C.text }}>💰 Выплаты</div>
          <button onClick={() => setShowNew(!showNew)}
            style={{ background: C.green, border: 'none', color: '#000', borderRadius: 10, padding: '8px 14px', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
            + Новая
          </button>
        </div>

        {/* Итого ожидает */}
        {totalPending > 0 && (
          <div style={{ marginTop: 12, background: C.amber + '15', border: `1px solid ${C.amber}40`, borderRadius: 12, padding: '10px 14px', display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, color: C.amber }}>Всего ожидает выплаты</span>
            <span style={{ fontSize: 15, fontWeight: 900, color: C.amber }}>{fmt(totalPending)}</span>
          </div>
        )}
      </div>

      <div style={{ padding: '0 16px' }}>
        {/* Форма новой выплаты */}
        {showNew && (
          <form onSubmit={handleCreate} style={{ background: C.card, borderRadius: 14, padding: 16, marginBottom: 14, border: `1px solid ${C.green}30` }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.green, marginBottom: 12 }}>Новая выплата</div>
            <select value={form.work_id} onChange={e => setForm(f => ({ ...f, work_id: e.target.value }))}
              style={selectStyle}>
              <option value="">Объект</option>
              {works.map(w => <option key={w.id} value={w.id}>{w.work_title}</option>)}
            </select>
            <select value={form.employee_id} onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))}
              style={selectStyle}>
              <option value="">Рабочий</option>
              {workers.filter(w => !form.work_id || w.work_id === parseInt(form.work_id)).map(w => (
                <option key={w.id} value={w.id}>{w.fio}</option>
              ))}
            </select>
            <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              style={selectStyle}>
              <option value="advance">Аванс</option>
              <option value="per_diem">Суточные</option>
              <option value="salary">Зарплата</option>
              <option value="bonus">Бонус</option>
              <option value="penalty">Штраф</option>
            </select>
            <input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
              placeholder="Сумма ₽" style={inputStyle} />
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <select value={form.pay_month} onChange={e => setForm(f => ({ ...f, pay_month: parseInt(e.target.value) }))}
                style={{ ...selectStyle, flex: 1, marginBottom: 0 }}>
                {MONTHS.slice(1).map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
              </select>
              <input type="number" value={form.pay_year} onChange={e => setForm(f => ({ ...f, pay_year: parseInt(e.target.value) }))}
                style={{ ...inputStyle, flex: '0 0 80px', marginBottom: 0 }} />
            </div>
            <input value={form.comment} onChange={e => setForm(f => ({ ...f, comment: e.target.value }))}
              placeholder="Комментарий" style={inputStyle} />
            <button type="submit" disabled={saving}
              style={{ width: '100%', padding: '10px 0', borderRadius: 10, border: 'none', cursor: 'pointer', background: C.green, color: '#000', fontWeight: 700 }}>
              {saving ? '...' : 'Создать'}
            </button>
          </form>
        )}

        {msg && (
          <div style={{ padding: '10px 14px', borderRadius: 10, background: C.card, color: C.green, fontSize: 13, marginBottom: 10, textAlign: 'center' }}>
            {msg} <button onClick={() => setMsg('')} style={{ marginLeft: 6, background: 'none', border: 'none', color: C.muted, cursor: 'pointer' }}>✕</button>
          </div>
        )}

        {/* Фильтры */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {[
            { key: 'pending', label: '⏳ Ожидает' },
            { key: 'paid',    label: '✅ Выплачено' },
            { key: '',        label: 'Все' },
          ].map(f => (
            <button key={f.key} onClick={() => setStatusFilter(f.key)}
              style={{
                flex: 1, padding: '7px 0', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: statusFilter === f.key ? C.blue : C.card,
                color: statusFilter === f.key ? '#fff' : C.muted,
                fontSize: 12, fontWeight: statusFilter === f.key ? 700 : 400,
              }}>
              {f.label}
            </button>
          ))}
        </div>

        {/* Фильтр объекта */}
        <select value={workId} onChange={e => setWorkId(e.target.value)}
          style={{ ...selectStyle, marginBottom: 12 }}>
          <option value="">Все объекты</option>
          {works.map(w => <option key={w.id} value={w.id}>{w.work_title}</option>)}
        </select>

        {/* Список выплат */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: C.gold, fontSize: 32 }}>⚡</div>
        ) : payments.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: C.muted }}>Нет выплат</div>
        ) : (
          payments.map(p => {
            const st = STATUS_CFG[p.status] || STATUS_CFG.pending;
            const typeColor = PAY_COLORS[p.type] || C.text;
            return (
              <div key={p.id} style={{ background: C.card, borderRadius: 14, padding: '12px 14px', marginBottom: 8, border: `1px solid ${p.status === 'pending' ? C.amber + '30' : '#ffffff0d'}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: C.text }}>{p.fio}</div>
                    <div style={{ fontSize: 12, color: typeColor, fontWeight: 700, marginTop: 1 }}>
                      {PAY_TYPES[p.type] || p.type}
                      {p.pay_month ? ` · ${MONTHS[p.pay_month]} ${p.pay_year}` : ''}
                    </div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>{p.work_title}</div>
                    {p.comment && <div style={{ fontSize: 11, color: C.muted, marginTop: 2, fontStyle: 'italic' }}>{p.comment}</div>}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 10 }}>
                    <div style={{ fontSize: 16, fontWeight: 900, color: C.text }}>{fmt(p.amount)}</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: st.color, marginTop: 2 }}>{st.label}</div>
                  </div>
                </div>

                {/* Кнопки действий для pending */}
                {p.status === 'pending' && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                    <button onClick={() => handleMarkPaid(p.id)}
                      style={{ flex: 1, padding: '7px 0', borderRadius: 10, border: 'none', cursor: 'pointer', background: C.green + '20', color: C.green, fontWeight: 700, fontSize: 12 }}>
                      ✓ Выплачено
                    </button>
                    <button onClick={() => handleCancel(p.id)}
                      style={{ padding: '7px 14px', borderRadius: 10, border: 'none', cursor: 'pointer', background: C.red + '15', color: C.red, fontWeight: 700, fontSize: 12 }}>
                      ✕
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      <PmTabBar />
    </div>
  );
}

const selectStyle = {
  width: '100%', background: '#1a1a2e', border: '1px solid #ffffff15',
  borderRadius: 8, padding: '9px 10px', color: '#e8e8f0', fontSize: 13,
  marginBottom: 8, boxSizing: 'border-box',
};
const inputStyle = {
  width: '100%', background: '#1a1a2e', border: '1px solid #ffffff15',
  borderRadius: 8, padding: '9px 10px', color: '#e8e8f0', fontSize: 13,
  marginBottom: 8, boxSizing: 'border-box',
};
