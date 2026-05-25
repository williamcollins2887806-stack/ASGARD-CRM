/**
 * FieldEarningsMonthly.jsx — Зарплата по месяцам
 *
 * Главный экран финансов рабочего.
 * Жёсткое разделение: ЗА СМЕНЫ (ФОТ + аванс) и СУТОЧНЫЕ — это два разных потока.
 * Аванс вычитается ТОЛЬКО из ЗП, не из суточных.
 *
 * Кнопка «🚩 Я не согласен» — открывает форму спора по месяцу.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import DisputeForm from '@/components/field/DisputeForm';

const C = {
  bg: '#0d0d12', card: '#16161f', gold: '#c8a84b',
  green: '#22c55e', red: '#ef4444', amber: '#f59e0b',
  blue: '#3b82f6', rune: '#7b61ff',
  text: '#e8e8f0', muted: '#6b7280',
};

const fmtMoney = (n) =>
  n != null ? Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽' : '—';

const STATUS_CFG = {
  paid:      { label: 'Выплачено',           color: C.green,  icon: '✓' },
  upcoming:  { label: 'Будет',               color: C.blue,   icon: '🗓' },
  in_window: { label: 'Ожидайте перевод',    color: C.amber,  icon: '⏳' },
  overdue:   { label: 'Задержана',           color: C.red,    icon: '⚠️' },
};

/* ────────────────────────────────────────────────────────────── */

function Row({ label, value, color, bold, sub, strike }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      padding: sub ? '3px 0 3px 12px' : '6px 0',
      borderBottom: sub ? 'none' : '1px solid #ffffff07',
    }}>
      <span style={{ fontSize: sub ? 12 : 13, color: sub ? C.muted : C.text }}>{label}</span>
      <span style={{
        fontSize: sub ? 12 : 14, fontWeight: bold ? 700 : 400,
        color: color || (sub ? C.muted : C.text),
        textDecoration: strike ? 'line-through' : 'none',
      }}>
        {value}
      </span>
    </div>
  );
}

function SectionTitle({ icon, label, color }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      fontSize: 11, color: color || C.muted,
      textTransform: 'uppercase', letterSpacing: 1.2,
      marginTop: 14, marginBottom: 6, fontWeight: 700,
    }}>
      <span style={{ fontSize: 14 }}>{icon}</span>
      <span>{label}</span>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────── */

function MonthCard({ m, onDispute, disputesByMonth }) {
  const [open, setOpen] = useState(false);
  const st = STATUS_CFG[m.payment_status] || STATUS_CFG.upcoming;

  // Раздельные блоки
  const salaryEarned   = m.fot;
  const salaryAdvance  = m.advance_paid;
  const salaryPaid     = m.salary_paid;
  const salaryRemaining = Math.max(0, salaryEarned - salaryAdvance - salaryPaid);

  const perDiemAccrued = m.per_diem_accrued;
  const perDiemPaid    = m.per_diem_paid;
  const perDiemRemaining = Math.max(0, perDiemAccrued - perDiemPaid);

  const bonusPaid = m.bonus_paid;

  // Открытые споры по месяцу
  const monthDisputes = disputesByMonth?.get(`${m.year}-${m.month}`) || [];
  const openDisputes = monthDisputes.filter(d => d.status === 'open' || d.status === 'in_review');

  // Статус Зарплаты (учитываем только salary-поток)
  const salaryStatusKey = salaryRemaining === 0
    ? (salaryEarned > 0 ? 'paid' : 'upcoming')
    : m.payment_status;
  const salStatus = STATUS_CFG[salaryStatusKey] || STATUS_CFG.upcoming;
  const perDiemStatusKey = perDiemRemaining === 0 ? 'paid' : (perDiemAccrued > 0 ? 'in_window' : 'upcoming');
  const pdStatus = STATUS_CFG[perDiemStatusKey] || STATUS_CFG.upcoming;

  return (
    <div style={{
      background: C.card, borderRadius: 16, marginBottom: 12,
      border: `1px solid ${salaryStatusKey === 'paid' ? C.green + '33' : salaryStatusKey === 'overdue' ? C.red + '33' : '#ffffff11'}`,
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
            {m.per_diem_days > 0 ? ` · ${m.per_diem_days} дн. суточных` : ''}
          </div>
          {openDisputes.length > 0 && (
            <div style={{ fontSize: 11, color: C.amber, marginTop: 4, fontWeight: 700 }}>
              ⚠️ {openDisputes.length} разногласи{openDisputes.length === 1 ? 'е' : 'я'} в работе
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', justifyContent: 'flex-end' }}>
            <span style={{ fontSize: 18, fontWeight: 900, color: C.gold }}>{fmtMoney(salaryEarned)}</span>
          </div>
          {perDiemAccrued > 0 && (
            <div style={{ fontSize: 12, color: C.amber, marginTop: 1 }}>+ {fmtMoney(perDiemAccrued)} сут.</div>
          )}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4,
            fontSize: 11, fontWeight: 700, color: salStatus.color,
            background: `${salStatus.color}18`, borderRadius: 20, padding: '2px 8px',
          }}>
            <span>{salStatus.icon}</span>
            <span>{salStatus.label}</span>
          </div>
        </div>
      </div>

      {/* Expanded detail */}
      {open && (
        <div style={{ padding: '0 16px 16px', borderTop: '1px solid #ffffff08' }}>

          {/* ═════════ ЗАРПЛАТА ЗА СМЕНЫ ═════════ */}
          <SectionTitle icon="💼" label="Зарплата за смены" color={C.gold} />
          <Row label={`Заработано (${m.shifts_count} см.)`} value={fmtMoney(salaryEarned)} color={C.text} bold />

          {salaryAdvance > 0 && (
            <Row label="Аванс выдан" value={'− ' + fmtMoney(salaryAdvance)} color={C.amber} sub />
          )}
          {salaryPaid > 0 && (
            <Row label="ЗП уже выплачена" value={'− ' + fmtMoney(salaryPaid)} color={C.green} sub />
          )}

          <Row
            label={salaryRemaining > 0 ? 'К выплате' : '✓ Полностью выплачено'}
            value={salaryRemaining > 0 ? fmtMoney(salaryRemaining) : ''}
            color={salaryRemaining > 0
              ? (m.payment_status === 'overdue' ? C.red : C.gold)
              : C.green}
            bold
          />
          {salaryRemaining > 0 && (
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2, marginBottom: 6 }}>
              {m.payment_status === 'paid'
                ? '✓ Закрыто'
                : `Выплата: ${m.pay_window}`}
            </div>
          )}

          {/* ═════════ СУТОЧНЫЕ ═════════ */}
          {perDiemAccrued > 0 && (
            <>
              <SectionTitle icon="🌙" label="Суточные" color={C.amber} />
              <Row label={`Начислено (${m.per_diem_days} дн.)`} value={fmtMoney(perDiemAccrued)} color={C.text} bold />
              {perDiemPaid > 0 && (
                <Row label="Получено" value={fmtMoney(perDiemPaid)} color={C.green} sub />
              )}
              {perDiemRemaining > 0 && (
                <Row label="Ожидает" value={fmtMoney(perDiemRemaining)} color={C.amber} sub />
              )}
              {perDiemRemaining === 0 && perDiemAccrued > 0 && (
                <div style={{ fontSize: 12, color: C.green, marginTop: 4, fontWeight: 600 }}>
                  ✓ Суточные закрыты
                </div>
              )}
            </>
          )}

          {/* ═════════ БОНУС ═════════ */}
          {bonusPaid > 0 && (
            <>
              <SectionTitle icon="⭐" label="Бонус" color={C.rune} />
              <Row label="Выплачено" value={fmtMoney(bonusPaid)} color={C.rune} bold />
            </>
          )}

          {/* ═════════ КНОПКА СПОРА ═════════ */}
          <div style={{
            marginTop: 16, paddingTop: 12,
            borderTop: '1px solid #ffffff10',
          }}>
            <button
              onClick={() => onDispute(m)}
              style={{
                width: '100%', padding: '10px 12px',
                background: 'rgba(245,158,11,0.08)',
                border: '1px solid rgba(245,158,11,0.3)',
                borderRadius: 10, color: C.amber,
                fontSize: 13, fontWeight: 700,
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              🚩 Я не согласен с этим месяцем
            </button>
            {openDisputes.length > 0 && (
              <div style={{ fontSize: 11, color: C.muted, marginTop: 6, textAlign: 'center' }}>
                У вас {openDisputes.length} активных обращений по этому месяцу
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────── */

export default function FieldEarningsMonthly() {
  const navigate = useNavigate();
  const [months, setMonths]   = useState([]);
  const [disputes, setDisputes] = useState([]);
  const [activeWorkId, setActiveWorkId] = useState(null);
  const [activeWorkTitle, setActiveWorkTitle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  // Модалка спора
  const [disputeMonth, setDisputeMonth] = useState(null);  // { year, month }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [monthly, myDisputes, project] = await Promise.all([
        fieldApi.get('/earnings/monthly'),
        fieldApi.get('/worker/disputes').catch(() => ({ disputes: [] })),
        fieldApi.get('/worker/active-project').catch(() => null),
      ]);
      setMonths(monthly.months || []);
      setDisputes(myDisputes.disputes || []);
      const p = project?.project || project;
      if (p?.work_id) {
        setActiveWorkId(p.work_id);
        setActiveWorkTitle(p.work_title || p.title);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Группируем мои споры по (year, month) для бейджей
  const disputesByMonth = (() => {
    const map = new Map();
    for (const d of disputes) {
      const key = d.dispute_date
        ? (() => { const dt = new Date(d.dispute_date); return `${dt.getFullYear()}-${dt.getMonth() + 1}`; })()
        : `${d.dispute_year}-${d.dispute_month}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(d);
    }
    return map;
  })();

  // Сводные суммы — раздельно ЗП и суточные
  const totals = months.reduce((acc, m) => ({
    salary_earned:    acc.salary_earned    + m.fot,
    per_diem_accrued: acc.per_diem_accrued + m.per_diem_accrued,
    salary_paid:      acc.salary_paid      + m.salary_paid + m.advance_paid,
    per_diem_paid:    acc.per_diem_paid    + m.per_diem_paid,
    bonus_paid:       acc.bonus_paid       + m.bonus_paid,
    salary_pending:   acc.salary_pending   + Math.max(0, m.fot - m.salary_paid - m.advance_paid),
    per_diem_pending: acc.per_diem_pending + Math.max(0, m.per_diem_accrued - m.per_diem_paid),
  }), { salary_earned: 0, per_diem_accrued: 0, salary_paid: 0, per_diem_paid: 0, bonus_paid: 0, salary_pending: 0, per_diem_pending: 0 });

  const openDisputesCount = disputes.filter(d => d.status === 'open' || d.status === 'in_review').length;

  function handleOpenDispute(m) {
    setDisputeMonth({ year: m.year, month: m.month });
  }

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
          Выплата ЗП: 10–15 числа следующего месяца
        </div>
      </div>

      <div style={{ padding: '0 16px' }}>

        {/* Сводная карточка — РАЗДЕЛЬНО ЗП и суточные */}
        {months.length > 0 && (
          <div style={{
            background: 'linear-gradient(135deg, #0d1a0d, #16201a)',
            border: '1px solid #22c55e33',
            borderRadius: 16, padding: 16, marginBottom: 12,
          }}>
            <div style={{ fontSize: 12, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
              За всё время
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: C.gold, fontWeight: 700, marginBottom: 4 }}>💼 ЗАРПЛАТА</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Tile label="Заработано" value={fmtMoney(totals.salary_earned)} color={C.gold} />
                <Tile label="Выплачено"  value={fmtMoney(totals.salary_paid)}   color={C.green} />
                {totals.salary_pending > 0 && (
                  <Tile label="Ожидает выплаты" value={fmtMoney(totals.salary_pending)} color={C.amber} span={2} />
                )}
              </div>
            </div>

            {totals.per_diem_accrued > 0 && (
              <div>
                <div style={{ fontSize: 11, color: C.amber, fontWeight: 700, marginBottom: 4 }}>🌙 СУТОЧНЫЕ</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <Tile label="Начислено" value={fmtMoney(totals.per_diem_accrued)} color={C.amber} />
                  <Tile label="Получено"  value={fmtMoney(totals.per_diem_paid)}    color={C.green} />
                  {totals.per_diem_pending > 0 && (
                    <Tile label="Ожидает" value={fmtMoney(totals.per_diem_pending)} color={C.amber} span={2} />
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Бейдж по открытым спорам */}
        {openDisputesCount > 0 && (
          <div style={{
            background: 'rgba(245,158,11,0.08)',
            border: '1px solid rgba(245,158,11,0.3)',
            borderRadius: 12, padding: '10px 14px', marginBottom: 12,
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ fontSize: 18 }}>⏳</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.amber }}>
                У вас {openDisputesCount} активных обращений к РП
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                РП получит уведомление и ответит вам здесь же
              </div>
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
          months.map(m => (
            <MonthCard
              key={`${m.year}-${m.month}`}
              m={m}
              onDispute={handleOpenDispute}
              disputesByMonth={disputesByMonth}
            />
          ))
        )}
      </div>

      {/* Модалка спора */}
      {disputeMonth && activeWorkId && (
        <DisputeForm
          workId={activeWorkId}
          workTitle={activeWorkTitle}
          defaultMonth={disputeMonth}
          onClose={() => setDisputeMonth(null)}
          onSubmitted={() => { setDisputeMonth(null); load(); }}
        />
      )}
      {disputeMonth && !activeWorkId && (
        <div onClick={() => setDisputeMonth(null)} style={{
          position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div style={{ background: C.card, borderRadius: 16, padding: 20, maxWidth: 400, textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>📋</div>
            <div style={{ color: C.text, fontWeight: 700, marginBottom: 8 }}>
              Не определена ваша текущая работа
            </div>
            <div style={{ color: C.muted, fontSize: 13, marginBottom: 14 }}>
              Чтобы оставить разногласие — сначала зайдите в раздел «Сейчас» (выбрать активный проект).
            </div>
            <button onClick={() => setDisputeMonth(null)}
              style={{ background: C.gold, color: '#0d0d12', border: 'none', borderRadius: 8, padding: '10px 20px', fontWeight: 700, cursor: 'pointer' }}>
              Понятно
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, color, span }) {
  return (
    <div style={{
      background: '#ffffff07', borderRadius: 10, padding: '10px 12px',
      gridColumn: span ? `span ${span}` : 'auto',
    }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: color || C.text }}>{value}</div>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{label}</div>
    </div>
  );
}
