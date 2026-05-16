/**
 * FieldEarningsMonthly.jsx — Зарплата по месяцам
 * FOT (смены) и суточные показываются раздельно.
 * Выплата ЗП: 10–15 числе следующего за расчётным месяца.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';

const C = {
  bg: '#0d0d12', card: '#16161f', gold: '#c8a84b',
  green: '#22c55e', red: '#ef4444', amber: '#f59e0b',
  blue: '#3b82f6', rune: '#7b61ff',
  text: '#e8e8f0', muted: '#6b7280',
};

const fmtMoney = (n) =>
  n != null ? Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽' : '—';

const STATUS_CFG = {
  paid:      { label: 'Выплачено',          color: C.green,  icon: '✓' },
  upcoming:  { label: 'Будет',              color: C.blue,   icon: '🗓' },
  in_window: { label: 'Ожидай перевод',     color: C.amber,  icon: '⏳' },
  overdue:   { label: 'Задержана',          color: C.red,    icon: '⚠️' },
};

function Row({ label, value, color, bold, sub }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      padding: sub ? '3px 0 3px 12px' : '6px 0',
      borderBottom: sub ? 'none' : '1px solid #ffffff07',
    }}>
      <span style={{ fontSize: sub ? 12 : 13, color: sub ? C.muted : C.text }}>{label}</span>
      <span style={{ fontSize: sub ? 12 : 14, fontWeight: bold ? 700 : 400, color: color || (sub ? C.muted : C.text) }}>
        {value}
      </span>
    </div>
  );
}

function MonthCard({ m }) {
  const [open, setOpen] = useState(false);
  const st = STATUS_CFG[m.payment_status] || STATUS_CFG.upcoming;

  const hasPaidAdv  = m.advance_paid  > 0;
  const hasPaidSal  = m.salary_paid   > 0;
  const hasPaidPD   = m.per_diem_paid > 0;
  const hasPaidBon  = m.bonus_paid    > 0;
  const hasPerdiem  = m.per_diem_accrued > 0;

  return (
    <div style={{
      background: C.card, borderRadius: 16, marginBottom: 12,
      border: `1px solid ${m.payment_status === 'paid' ? C.green + '33' : m.payment_status === 'overdue' ? C.red + '33' : '#ffffff11'}`,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{ padding: '14px 16px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>
            {m.month_name} {m.year}
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
            {m.shifts_count} {m.shifts_count === 1 ? 'смена' : m.shifts_count < 5 ? 'смены' : 'смен'}
            {hasPerdiem ? ` · ${m.per_diem_days}д суточных` : ''}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 18, fontWeight: 900, color: C.gold }}>{fmtMoney(m.fot)}</div>
          {hasPerdiem && (
            <div style={{ fontSize: 12, color: C.amber, marginTop: 1 }}>+ {fmtMoney(m.per_diem_accrued)} сут.</div>
          )}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4,
            fontSize: 11, fontWeight: 700, color: st.color,
            background: `${st.color}18`, borderRadius: 20, padding: '2px 8px',
          }}>
            <span>{st.icon}</span>
            <span>{st.label}</span>
          </div>
        </div>
      </div>

      {/* Expanded detail */}
      {open && (
        <div style={{ padding: '0 16px 16px', borderTop: '1px solid #ffffff08' }}>

          {/* Начислено */}
          <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginTop: 12, marginBottom: 6 }}>
            Начислено
          </div>
          <Row label="Смены (ФОТ)" value={fmtMoney(m.fot)} color={C.gold} bold />
          {hasPerdiem && (
            <Row label={`Суточные (${m.per_diem_days} дн.)`} value={fmtMoney(m.per_diem_accrued)} color={C.amber} bold />
          )}
          <Row label="Итого начислено" value={fmtMoney(m.total_earned)} bold />

          {/* Выплачено */}
          {m.total_paid > 0 && (
            <>
              <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginTop: 14, marginBottom: 6 }}>
                Выплачено
              </div>
              {hasPaidAdv  && <Row label="Аванс"     value={fmtMoney(m.advance_paid)}  color={C.green} sub />}
              {hasPaidSal  && <Row label="Зарплата"  value={fmtMoney(m.salary_paid)}   color={C.green} sub />}
              {hasPaidPD   && <Row label="Суточные"  value={fmtMoney(m.per_diem_paid)} color={C.amber} sub />}
              {hasPaidBon  && <Row label="Бонус"     value={fmtMoney(m.bonus_paid)}    color={C.rune}  sub />}
              <Row label="Итого выплачено" value={fmtMoney(m.total_paid)} color={C.green} bold />
            </>
          )}

          {/* К выплате */}
          {m.to_pay > 0 && (
            <>
              <div style={{ height: 1, background: '#ffffff10', margin: '10px 0' }} />
              <Row
                label="К выплате"
                value={fmtMoney(m.to_pay)}
                color={m.payment_status === 'overdue' ? C.red : C.text}
                bold
              />
              <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
                {m.payment_status === 'paid'
                  ? '✓ Расчёт закрыт'
                  : `Выплата: ${m.pay_window}`}
              </div>
            </>
          )}

          {m.to_pay === 0 && m.total_earned > 0 && (
            <div style={{ marginTop: 10, fontSize: 13, color: C.green, fontWeight: 700, textAlign: 'center' }}>
              ✓ Расчёт полностью закрыт
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function FieldEarningsMonthly() {
  const navigate = useNavigate();
  const [months, setMonths]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fieldApi.get('/earnings/monthly');
      setMonths(data.months || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Итоговые суммы
  const totals = months.reduce((acc, m) => ({
    fot:         acc.fot + m.fot,
    per_diem:    acc.per_diem + m.per_diem_accrued,
    total_paid:  acc.total_paid + m.total_paid,
    to_pay:      acc.to_pay + m.to_pay,
  }), { fot: 0, per_diem: 0, total_paid: 0, to_pay: 0 });

  return (
    <div style={{ minHeight: '100vh', background: C.bg, paddingBottom: 80 }}>
      {/* Header */}
      <div style={{ padding: '48px 16px 16px', background: 'linear-gradient(180deg, #0d1a0d 0%, transparent 100%)' }}>
        <button onClick={() => navigate(-1)}
          style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 14, marginBottom: 12, padding: 0 }}>
          ← Назад
        </button>
        <div style={{ fontSize: 22, fontWeight: 900, color: C.text }}>💰 Зарплата по месяцам</div>
        <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>
          Выплата ЗП: 10–15 числе следующего месяца
        </div>
      </div>

      <div style={{ padding: '0 16px' }}>

        {/* Суммарная карточка */}
        {months.length > 0 && (
          <div style={{
            background: 'linear-gradient(135deg, #0d1a0d, #16201a)',
            border: '1px solid #22c55e33',
            borderRadius: 16, padding: 16, marginBottom: 20,
          }}>
            <div style={{ fontSize: 12, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
              За всё время
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[
                { label: 'Заработано смен',   value: fmtMoney(totals.fot),        color: C.gold  },
                { label: 'Суточные',          value: fmtMoney(totals.per_diem),   color: C.amber },
                { label: 'Выплачено',         value: fmtMoney(totals.total_paid), color: C.green },
                { label: 'Ожидает выплаты',   value: fmtMoney(totals.to_pay),     color: totals.to_pay > 0 ? C.text : C.muted },
              ].map(s => (
                <div key={s.label} style={{ background: '#ffffff07', borderRadius: 10, padding: '10px 12px' }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Список месяцев */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: C.gold, fontSize: 32 }}>⚡</div>
        ) : error ? (
          <div style={{ textAlign: 'center', padding: 40, color: C.red }}>{error}</div>
        ) : months.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, color: C.muted }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
            <div>Нет данных о сменах</div>
          </div>
        ) : (
          months.map(m => <MonthCard key={`${m.year}-${m.month}`} m={m} />)
        )}
      </div>
    </div>
  );
}
