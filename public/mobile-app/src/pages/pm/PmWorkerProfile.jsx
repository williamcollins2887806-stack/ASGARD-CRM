import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '@/api/client';

const C = {
  bg: '#0d0d12', card: '#16161f', gold: '#c8a84b',
  green: '#22c55e', red: '#ef4444', amber: '#f59e0b',
  blue: '#3b82f6', rune: '#7b61ff', text: '#e8e8f0', muted: '#6b7280',
};

const fmt = (n) => n != null ? Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽' : '—';

const MONTHS = ['', 'Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
const PAY_TYPES = { salary: 'Зарплата', advance: 'Аванс', per_diem: 'Суточные', bonus: 'Бонус', penalty: 'Штраф' };
const PAY_COLORS = { salary: C.green, advance: C.blue, per_diem: C.amber, bonus: C.rune, penalty: C.red };
const STATUS_COLORS = { paid: C.green, pending: C.amber, confirmed: C.blue, cancelled: C.muted };

export default function PmWorkerProfile() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('shifts');
  const [showPayForm, setShowPayForm] = useState(false);
  const [showRemoveForm, setShowRemoveForm] = useState(false);
  const [payForm, setPayForm] = useState({ type: 'advance', amount: '', work_id: '', comment: '' });
  const [removeForm, setRemoveForm] = useState({ work_id: '', reason: '' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.get(`/pm/workers/${id}`)
      .then(setData)
      .catch(e => setMsg('Ошибка: ' + e.message))
      .finally(() => setLoading(false));
  }, [id]);

  async function handlePay(e) {
    e.preventDefault();
    if (!payForm.work_id) { setMsg('Выберите объект'); return; }
    setSaving(true);
    try {
      await api.post('/pm/payments', {
        employee_id: parseInt(id),
        work_id: parseInt(payForm.work_id),
        type: payForm.type,
        amount: parseFloat(payForm.amount),
        comment: payForm.comment,
      });
      setMsg('Выплата создана');
      setShowPayForm(false);
      const fresh = await api.get(`/pm/workers/${id}`);
      setData(fresh);
    } catch (e) { setMsg('Ошибка: ' + e.message); }
    finally { setSaving(false); }
  }

  async function handleRemove(e) {
    e.preventDefault();
    if (!removeForm.work_id) { setMsg('Выберите объект'); return; }
    setSaving(true);
    try {
      await api.post(`/pm/workers/${id}/remove`, {
        work_id: parseInt(removeForm.work_id),
        departure_reason: removeForm.reason,
      });
      setMsg('Рабочий убран с объекта');
      setShowRemoveForm(false);
      const fresh = await api.get(`/pm/workers/${id}`);
      setData(fresh);
    } catch (e) { setMsg('Ошибка: ' + e.message); }
    finally { setSaving(false); }
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ fontSize: 36, color: C.gold }}>⚡</div>
    </div>
  );

  const { employee: emp, assignments, shifts, payments, achievements, academy, spins } = data || {};
  if (!emp) return <div style={{ color: C.red, padding: 40 }}>{msg || 'Не найден'}</div>;

  const activeAssignments = (assignments || []).filter(a => a.is_active);

  return (
    <div style={{ minHeight: '100vh', background: C.bg, paddingBottom: 40 }}>
      {/* Header */}
      <div style={{ padding: '48px 16px 16px', background: 'linear-gradient(180deg, #0d1429 0%, transparent 100%)' }}>
        <button onClick={() => navigate(-1)}
          style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 14, marginBottom: 10, padding: 0 }}>
          ← Назад
        </button>

        {/* Профиль */}
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 16 }}>
          <div style={{
            width: 58, height: 58, borderRadius: 16, background: C.card,
            border: `2px solid ${C.gold}40`, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 26, flexShrink: 0,
          }}>
            👷
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 900, color: C.text }}>{emp.fio}</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{emp.city || '—'} · рейтинг {emp.rating_avg || '—'}</div>
            <div style={{ fontSize: 12, color: C.muted }}>{emp.phone || '—'}</div>
          </div>
        </div>

        {/* Кошельки */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {[
            { label: 'XP', value: emp.xp || 0, color: C.rune, icon: '⭐' },
            { label: 'Руны', value: emp.runes || 0, color: C.gold, icon: '🔮' },
            { label: 'Серебро', value: emp.silver || 0, color: C.muted, icon: '🪙' },
          ].map(w => (
            <div key={w.label} style={{ flex: 1, background: C.card, borderRadius: 10, padding: '8px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: w.color }}>{w.icon} {w.value}</div>
              <div style={{ fontSize: 10, color: C.muted }}>{w.label}</div>
            </div>
          ))}
        </div>

        {/* Действия */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowPayForm(!showPayForm)}
            style={{
              flex: 1, padding: '10px 0', borderRadius: 12, border: 'none', cursor: 'pointer',
              background: C.green + '20', color: C.green, fontWeight: 700, fontSize: 13,
            }}>
            💰 Выплатить
          </button>
          <button onClick={() => setShowPayForm(false) || setShowRemoveForm(!showRemoveForm)}
            style={{
              flex: 1, padding: '10px 0', borderRadius: 12, border: 'none', cursor: 'pointer',
              background: C.red + '18', color: C.red, fontWeight: 700, fontSize: 13,
            }}>
            🚪 Убрать
          </button>
          <button onClick={() => navigate(`/pm/timesheet?emp_id=${id}`)}
            style={{
              flex: 1, padding: '10px 0', borderRadius: 12, border: 'none', cursor: 'pointer',
              background: C.blue + '18', color: C.blue, fontWeight: 700, fontSize: 13,
            }}>
            📋 Табель
          </button>
        </div>
      </div>

      <div style={{ padding: '0 16px' }}>
        {/* Форма выплаты */}
        {showPayForm && (
          <form onSubmit={handlePay} style={{ background: C.card, borderRadius: 14, padding: 16, marginBottom: 14, border: `1px solid ${C.green}30` }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.green, marginBottom: 12 }}>💰 Новая выплата</div>
            <select value={payForm.work_id} onChange={e => setPayForm(p => ({ ...p, work_id: e.target.value }))}
              style={{ width: '100%', background: '#1a1a2e', border: '1px solid #ffffff15', borderRadius: 8, padding: '8px 10px', color: C.text, fontSize: 13, marginBottom: 8, boxSizing: 'border-box' }}>
              <option value="">Выберите объект</option>
              {activeAssignments.map(a => (
                <option key={a.id} value={a.work_id}>{a.work_title}</option>
              ))}
            </select>
            <select value={payForm.type} onChange={e => setPayForm(p => ({ ...p, type: e.target.value }))}
              style={{ width: '100%', background: '#1a1a2e', border: '1px solid #ffffff15', borderRadius: 8, padding: '8px 10px', color: C.text, fontSize: 13, marginBottom: 8, boxSizing: 'border-box' }}>
              <option value="advance">Аванс</option>
              <option value="per_diem">Суточные</option>
              <option value="salary">Зарплата</option>
              <option value="bonus">Бонус</option>
            </select>
            <input type="number" value={payForm.amount} onChange={e => setPayForm(p => ({ ...p, amount: e.target.value }))}
              placeholder="Сумма ₽" min="1"
              style={{ width: '100%', background: '#1a1a2e', border: '1px solid #ffffff15', borderRadius: 8, padding: '8px 10px', color: C.text, fontSize: 13, marginBottom: 8, boxSizing: 'border-box' }} />
            <input value={payForm.comment} onChange={e => setPayForm(p => ({ ...p, comment: e.target.value }))}
              placeholder="Комментарий (необязательно)"
              style={{ width: '100%', background: '#1a1a2e', border: '1px solid #ffffff15', borderRadius: 8, padding: '8px 10px', color: C.text, fontSize: 13, marginBottom: 10, boxSizing: 'border-box' }} />
            <button type="submit" disabled={saving || !payForm.amount || !payForm.work_id}
              style={{ width: '100%', padding: '10px 0', borderRadius: 10, border: 'none', cursor: 'pointer', background: C.green, color: '#000', fontWeight: 700 }}>
              {saving ? '...' : 'Создать выплату'}
            </button>
          </form>
        )}

        {/* Форма убрать */}
        {showRemoveForm && (
          <form onSubmit={handleRemove} style={{ background: C.card, borderRadius: 14, padding: 16, marginBottom: 14, border: `1px solid ${C.red}30` }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.red, marginBottom: 12 }}>🚪 Убрать с объекта</div>
            <select value={removeForm.work_id} onChange={e => setRemoveForm(p => ({ ...p, work_id: e.target.value }))}
              style={{ width: '100%', background: '#1a1a2e', border: '1px solid #ffffff15', borderRadius: 8, padding: '8px 10px', color: C.text, fontSize: 13, marginBottom: 8, boxSizing: 'border-box' }}>
              <option value="">Выберите объект</option>
              {activeAssignments.map(a => (
                <option key={a.id} value={a.work_id}>{a.work_title}</option>
              ))}
            </select>
            <input value={removeForm.reason} onChange={e => setRemoveForm(p => ({ ...p, reason: e.target.value }))}
              placeholder="Причина отъезда"
              style={{ width: '100%', background: '#1a1a2e', border: '1px solid #ffffff15', borderRadius: 8, padding: '8px 10px', color: C.text, fontSize: 13, marginBottom: 10, boxSizing: 'border-box' }} />
            <button type="submit" disabled={saving || !removeForm.work_id}
              style={{ width: '100%', padding: '10px 0', borderRadius: 10, border: 'none', cursor: 'pointer', background: C.red, color: '#fff', fontWeight: 700 }}>
              {saving ? '...' : 'Подтвердить'}
            </button>
          </form>
        )}

        {msg && (
          <div style={{ padding: '10px 14px', borderRadius: 10, background: C.card, color: C.green, fontSize: 13, marginBottom: 12, textAlign: 'center' }}>
            {msg}
          </div>
        )}

        {/* Назначения */}
        {activeAssignments.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Назначения</div>
            {activeAssignments.map(a => (
              <div key={a.id} style={{ background: C.card, borderRadius: 12, padding: '12px 14px', marginBottom: 6, border: '1px solid #ffffff0d' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{a.work_title}</div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>
                  {a.tariff_name || 'Нет тарифа'} · {a.shift_type === 'day' ? 'День' : 'Ночь'} · Суточные: {a.per_diem ? a.per_diem + ' ₽/д' : '—'}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Вкладки */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          {[
            { key: 'shifts', label: '📅 Смены' },
            { key: 'payments', label: '💰 Выплаты' },
            { key: 'academy', label: '🏛️ Мимир' },
            { key: 'achievements', label: '🏆 Достиж.' },
          ].map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{
                flex: 1, padding: '7px 0', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: tab === t.key ? C.blue : C.card,
                color: tab === t.key ? '#fff' : C.muted,
                fontSize: 10, fontWeight: tab === t.key ? 700 : 400,
              }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Смены */}
        {tab === 'shifts' && (
          <div>
            {(shifts || []).length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: C.muted }}>Нет смен</div>
            ) : (
              (shifts || []).slice(0, 30).map(s => (
                <div key={s.id} style={{ background: C.card, borderRadius: 12, padding: '10px 14px', marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
                      {new Date(s.date).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })}
                      {' · '}{s.shift === 'day' ? '☀️ День' : '🌙 Ночь'}
                    </div>
                    <div style={{ fontSize: 11, color: C.muted }}>{s.work_title}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: s.status === 'completed' ? C.gold : C.muted }}>
                      {fmt(s.amount_earned)}
                    </div>
                    <div style={{ fontSize: 10, color: C.muted }}>{s.hours_worked}ч</div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Выплаты */}
        {tab === 'payments' && (
          <div>
            {(payments || []).length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: C.muted }}>Нет выплат</div>
            ) : (
              (payments || []).map(p => (
                <div key={p.id} style={{ background: C.card, borderRadius: 12, padding: '10px 14px', marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: PAY_COLORS[p.type] || C.text }}>
                      {PAY_TYPES[p.type] || p.type}
                    </div>
                    <div style={{ fontSize: 11, color: C.muted }}>
                      {p.pay_month ? `${p.pay_month}/${p.pay_year}` : '—'} · {p.work_title}
                    </div>
                    {p.comment && <div style={{ fontSize: 10, color: C.muted }}>{p.comment}</div>}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: C.text }}>{fmt(p.amount)}</div>
                    <div style={{ fontSize: 10, color: STATUS_COLORS[p.status] || C.muted }}>{p.status}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Мимир */}
        {tab === 'academy' && (
          <div>
            {(academy || []).length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: C.muted }}>Нет данных</div>
            ) : (
              (academy || []).map(a => (
                <div key={a.lesson_id} style={{ background: C.card, borderRadius: 12, padding: '10px 14px', marginBottom: 6, display: 'flex', gap: 10, alignItems: 'center' }}>
                  <div style={{ fontSize: 22 }}>{a.cover_icon}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{a.title}</div>
                    <div style={{ fontSize: 11, color: C.muted }}>Неделя {a.week_number} · {a.attempts} попыток</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: a.passed ? C.green : C.red }}>
                      {a.passed ? `✓ ${a.score}%` : '✗'}
                    </div>
                    {a.xp_earned > 0 && <div style={{ fontSize: 10, color: C.rune }}>+{a.xp_earned} XP</div>}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Достижения */}
        {tab === 'achievements' && (
          <div>
            {(achievements || []).length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: C.muted }}>Нет достижений</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {(achievements || []).map(a => (
                  <div key={a.achievement_id} style={{ background: C.card, borderRadius: 12, padding: '12px 14px', border: '1px solid #ffffff0d' }}>
                    <div style={{ fontSize: 24, marginBottom: 6 }}>{a.icon}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{a.name}</div>
                    <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{a.rarity}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Призы */}
            {(spins || []).length > 0 && (
              <>
                <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, margin: '16px 0 8px' }}>
                  🎡 Последние призы (Колесо)
                </div>
                {(spins || []).map((s, i) => (
                  <div key={i} style={{ background: C.card, borderRadius: 10, padding: '8px 12px', marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
                    <div style={{ fontSize: 13, color: C.text }}>{s.prize_name}</div>
                    <div style={{ fontSize: 12, color: C.gold, fontWeight: 700 }}>{s.prize_tier}</div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
