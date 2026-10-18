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
import { formatMoney as fmtMoney } from '@/lib/utils';
import {
  ArrowLeft, Wallet, Briefcase, Moon, Star, Flag, Hourglass, CalendarClock, Check, AlertTriangle,
  ListChecks, Zap,
} from 'lucide-react';
import { Card, IconTile, KeyButton, BottomSheet, SectionLabel, EmptyState } from '@/components/field/ui';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import './field-screens.css';

const C = {
  bg: 'var(--bg-primary)', card: 'var(--bg-surface)', gold: 'var(--value-ink)',
  green: 'var(--ok)', red: 'var(--danger-ink)', amber: 'var(--value-ink)',
  blue: 'var(--acc)', rune: 'var(--acc)',
  text: 'var(--text-primary)', muted: 'var(--text-secondary)',
};

const STATUS_CFG = {
  paid:      { label: 'Выплачено',        color: C.green,  Icon: Check },
  upcoming:  { label: 'Будет',            color: C.blue,   Icon: CalendarClock },
  in_window: { label: 'Ожидайте перевод', color: C.amber,  Icon: Hourglass },
  overdue:   { label: 'Задержана',        color: C.red,    Icon: AlertTriangle },
};

/* ────────────────────────────────────────────────────────────── */

function Row({ label, value, color, bold, sub, strike }) {
  return (
    <div className="fs-row" style={{ padding: sub ? '3px 0 3px 12px' : '6px 0', borderTop: sub ? 'none' : undefined }}>
      <span className="fs-row__k" style={{ fontSize: sub ? 12 : 13 }}>{label}</span>
      <span className="fs-row__v" style={{
        fontSize: sub ? 12 : 14,
        fontWeight: bold ? 700 : 400,
        color: color || (sub ? C.muted : C.text),
        textDecoration: strike ? 'line-through' : 'none',
      }}>
        {value}
      </span>
    </div>
  );
}

function SectionTitle({ icon: Icon, label, color }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      fontSize: 11, color: color || C.muted,
      textTransform: 'uppercase', letterSpacing: 1.2,
      marginTop: 14, marginBottom: 6, fontWeight: 700,
    }}>
      {Icon ? <Icon size={13} strokeWidth={2.5} aria-hidden /> : null}
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
  const openDisputes = monthDisputes.filter((d) => d.status === 'open' || d.status === 'in_review');

  // Статус Зарплаты (учитываем только salary-поток)
  const salaryStatusKey = salaryRemaining === 0
    ? (salaryEarned > 0 ? 'paid' : 'upcoming')
    : m.payment_status;
  const salStatus = STATUS_CFG[salaryStatusKey] || STATUS_CFG.upcoming;
  const perDiemStatusKey = perDiemRemaining === 0 ? 'paid' : (perDiemAccrued > 0 ? 'in_window' : 'upcoming');
  const pdStatus = STATUS_CFG[perDiemStatusKey] || STATUS_CFG.upcoming;
  const SalIcon = salStatus.Icon;

  return (
    <Card variant="raised" className="overflow-hidden p-0" style={{
      borderColor: salaryStatusKey === 'paid'
        ? 'color-mix(in oklab, var(--ok) 24%, transparent)'
        : salaryStatusKey === 'overdue'
          ? 'color-mix(in oklab, var(--danger) 24%, transparent)'
          : undefined,
    }}>
      {/* Header */}
      <div
        onClick={() => setOpen((o) => !o)}
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
            <div style={{ fontSize: 11, color: C.amber, marginTop: 4, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
              <AlertTriangle size={11} strokeWidth={2.6} aria-hidden />
              {openDisputes.length} разногласи{openDisputes.length === 1 ? 'е' : 'я'} в работе
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
            background: `color-mix(in oklab, ${salStatus.color} 9%, transparent)`, borderRadius: 20, padding: '2px 8px',
          }}>
            <SalIcon size={11} strokeWidth={2.6} aria-hidden />
            <span>{salStatus.label}</span>
          </div>
        </div>
      </div>

      {/* Expanded detail */}
      {open && (
        <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--tile-brd)' }}>

          {/* ═════════ ЗАРПЛАТА ЗА СМЕНЫ ═════════ */}
          <SectionTitle icon={Briefcase} label="Зарплата за смены" color={C.gold} />
          <Row label={`Заработано (${m.shifts_count} см.)`} value={fmtMoney(salaryEarned)} color={C.text} bold />

          {salaryAdvance > 0 && (
            <Row label="Аванс выдан" value={'− ' + fmtMoney(salaryAdvance)} color={C.amber} sub />
          )}
          {salaryPaid > 0 && (
            <Row label="ЗП уже выплачена" value={'− ' + fmtMoney(salaryPaid)} color={C.green} sub />
          )}

          <Row
            label={salaryRemaining > 0 ? 'К выплате' : 'Полностью выплачено'}
            value={salaryRemaining > 0 ? fmtMoney(salaryRemaining) : ''}
            color={salaryRemaining > 0
              ? (m.payment_status === 'overdue' ? C.red : C.gold)
              : C.green}
            bold
          />
          {salaryRemaining > 0 && (
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2, marginBottom: 6 }}>
              {m.payment_status === 'paid' ? 'Закрыто' : `Выплата: ${m.pay_window}`}
            </div>
          )}

          {/* ═════════ СУТОЧНЫЕ ═════════ */}
          {perDiemAccrued > 0 && (
            <>
              <SectionTitle icon={Moon} label="Суточные" color={C.amber} />
              <Row label={`Начислено (${m.per_diem_days} дн.)`} value={fmtMoney(perDiemAccrued)} color={C.text} bold />
              {perDiemPaid > 0 && (
                <Row label="Получено" value={fmtMoney(perDiemPaid)} color={C.green} sub />
              )}
              {perDiemRemaining > 0 && (
                <Row label="Ожидает" value={fmtMoney(perDiemRemaining)} color={C.amber} sub />
              )}
              {perDiemRemaining === 0 && perDiemAccrued > 0 && (
                <div style={{ fontSize: 12, color: C.green, marginTop: 4, fontWeight: 600 }}>
                  Суточные закрыты
                </div>
              )}
            </>
          )}

          {/* ═════════ БОНУС ═════════ */}
          {bonusPaid > 0 && (
            <>
              <SectionTitle icon={Star} label="Бонус" color={C.rune} />
              <Row label="Выплачено" value={fmtMoney(bonusPaid)} color={C.rune} bold />
            </>
          )}

          {/* ═════════ КНОПКА СПОРА ═════════ */}
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--tile-brd)' }}>
            <KeyButton tone="danger" block icon={Flag} onClick={() => onDispute(m)}>
              Я не согласен с этим месяцем
            </KeyButton>
            {openDisputes.length > 0 && (
              <div style={{ fontSize: 11, color: C.muted, marginTop: 6, textAlign: 'center' }}>
                У вас {openDisputes.length} активных обращений по этому месяцу
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

/* ────────────────────────────────────────────────────────────── */

export default function FieldEarningsMonthly() {
  const navigate = useNavigate();
  const [months, setMonths]   = useState([]);
  const [disputes, setDisputes] = useState([]);
  const [activeWorkId, setActiveWorkId] = useState(null);
  const [activeWorkTitle, setActiveWorkTitle] = useState(null);
  const [perDiemStagesOnly, setPerDiemStagesOnly] = useState(false);
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
      setPerDiemStagesOnly(p?.per_diem_on_checkins === false);
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
    <div className="fs-root" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}>
      <div className="fs-scene" aria-hidden><span className="fs-orb fs-orb--a" /><span className="fs-orb fs-orb--b" /></div>

      <div className="fs-content">
        {/* Header */}
        <div className="fs-head">
          <button onClick={() => navigate(-1)} className="fs-head__btn" aria-label="Назад">
            <ArrowLeft size={20} strokeWidth={2.3} />
          </button>
          <IconTile icon={Wallet} tone="value" size={40} />
          <div>
            <h1 className="fs-head__title">Зарплата по месяцам</h1>
            <p className="fs-head__sub">Выплата ЗП: 10–15 числа следующего месяца</p>
          </div>
        </div>

        {/* Сводная карточка — РАЗДЕЛЬНО ЗП и суточные */}
        {months.length > 0 && (
          <Card variant="raised" tone="status" className="p-4 mb-3">
            <div style={{ fontSize: 12, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
              За всё время
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: C.gold, fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
                <Briefcase size={12} strokeWidth={2.5} aria-hidden />
                ЗАРПЛАТА
              </div>
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
                <div style={{ fontSize: 11, color: C.amber, fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Moon size={12} strokeWidth={2.5} aria-hidden />
                  СУТОЧНЫЕ
                </div>
                {perDiemStagesOnly && (
                  <p style={{ fontSize: 11, color: C.muted, margin: '0 0 8px' }}>
                    На текущем объекте — за дорогу и этапы, не за смены
                  </p>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <Tile label="Начислено" value={fmtMoney(totals.per_diem_accrued)} color={C.amber} />
                  <Tile label="Получено"  value={fmtMoney(totals.per_diem_paid)}    color={C.green} />
                  {totals.per_diem_pending > 0 && (
                    <Tile label="Ожидает" value={fmtMoney(totals.per_diem_pending)} color={C.amber} span={2} />
                  )}
                </div>
              </div>
            )}
          </Card>
        )}

        {/* Бейдж по открытым спорам */}
        {openDisputesCount > 0 && (
          <Card variant="raised" tone="danger" className="p-3 mb-3 flex items-center gap-2.5">
            <Hourglass size={18} strokeWidth={2.4} style={{ color: 'var(--value-ink)', flexShrink: 0 }} aria-hidden />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.amber }}>
                У вас {openDisputesCount} активных обращений к РП
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                РП получит уведомление и ответит вам здесь же
              </div>
            </div>
          </Card>
        )}

        {/* Список месяцев */}
        {loading ? (
          <SkeletonList count={3} />
        ) : error ? (
          <Card variant="flat" tone="danger" className="p-3 text-sm" style={{ color: C.red }}>{error}</Card>
        ) : months.length === 0 ? (
          <EmptyState icon={ListChecks} title="Нет данных о сменах" description="История появится после первых смен" />
        ) : (
          months.map((m) => (
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
      <BottomSheet
        open={!!disputeMonth && !activeWorkId}
        onClose={() => setDisputeMonth(null)}
        title="Не определена ваша текущая работа"
      >
        <div className="text-center space-y-3 pb-2">
          <IconTile icon={ListChecks} tone="neutral" size={56} iconSize={28} style={{ margin: '0 auto' }} />
          <p style={{ color: C.muted, fontSize: 13 }}>
            Чтобы оставить разногласие — сначала зайдите в раздел «Сейчас» (выбрать активный проект).
          </p>
          <KeyButton tone="value" block onClick={() => setDisputeMonth(null)}>Понятно</KeyButton>
        </div>
      </BottomSheet>
    </div>
  );
}

function Tile({ label, value, color, span }) {
  return (
    <div style={{
      background: 'var(--bg-surface-alt)', borderRadius: 10, padding: '10px 12px',
      gridColumn: span ? `span ${span}` : 'auto',
    }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: color || C.text }}>{value}</div>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{label}</div>
    </div>
  );
}
