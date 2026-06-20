import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Briefcase, MapPin, ChevronRight, Clock, Check, AlertCircle, Inbox } from 'lucide-react';
import { fieldApi } from '@/api/fieldClient';
import { api } from '@/api/client';
import { useHaptic } from '@/hooks/useHaptic';
import { BottomSheet } from '@/components/shared/BottomSheet';

function fmt(n) { return (n || 0).toLocaleString('ru-RU'); }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('ru-RU') : '—'; }

const STAGE_LABELS = { medical: 'Медосмотр', travel: 'Дорога', waiting: 'Ожидание', warehouse: 'Склад', day_off: 'Выходной' };
const STATUS_ICONS = { completed: '✅', approved: '✅', adjusted: '✅', active: '🔵', planned: '⚬', rejected: '❌' };

function Skeleton() {
  return (
    <div className="p-4 space-y-4 animate-pulse">
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="h-24 rounded-xl" style={{ backgroundColor: 'var(--bg-elevated)' }} />
      ))}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
   Row helper
   ────────────────────────────────────────────────────────────────── */
function Row({ label, value, color, bold, sep }) {
  return (
    <div className="flex justify-between" style={{
      padding: '5px 0',
      ...(sep ? { borderTop: '1px solid var(--border-norse)', marginTop: '4px', paddingTop: '8px' } : {}),
    }}>
      <span className="text-sm" style={{ color: color || 'var(--text-secondary)', fontWeight: bold ? 700 : 400 }}>{label}</span>
      <span className="text-sm" style={{ color: color || 'var(--text-primary)', fontWeight: bold ? 700 : 600 }}>{value}</span>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   MoneyDetail — /field/money?detail=WORK_ID
   ══════════════════════════════════════════════════════════════════ */
function MoneyDetail({ workId, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fieldApi.get(`/worker/finances/${workId}`)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [workId]);

  if (loading) return <Skeleton />;
  if (!data || data.error) {
    return (
      <div className="p-4 pb-24" style={{ backgroundColor: 'var(--bg-primary)' }}>
        <div className="flex items-center gap-3 mb-4">
          <button onClick={onBack} className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-elevated)' }}>
            <ArrowLeft size={20} style={{ color: 'var(--text-primary)' }} />
          </button>
          <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Финансы проекта</h1>
        </div>
        <div className="p-8 text-center" style={{ color: 'var(--text-tertiary)' }}>{data?.error || 'Нет данных'}</div>
      </div>
    );
  }

  const rows = [];
  rows.push({ label: `Базовая ставка (${data.days_worked || 0} см.)`, value: `${fmt(data.base_amount)} ₽` });
  if (data.per_diem_total) rows.push({ label: `Пайковые (${data.per_diem_days || 0} дн. × ${fmt(data.per_diem_rate)}₽)`, value: `${fmt(data.per_diem_total)} ₽` });
  if (data.bonuses) rows.push({ label: 'Бонусы', value: `+${fmt(data.bonuses)} ₽`, color: '#22c55e' });
  if (data.stages_earned) rows.push({ label: 'Маршрут до объекта', value: `+${fmt(data.stages_earned)} ₽`, color: 'var(--gold)' });
  if (data.penalties) rows.push({ label: 'Штрафы', value: `−${fmt(data.penalties)} ₽`, color: '#ef4444' });
  rows.push({ label: 'Итого начислено', value: `${fmt(data.total_earned)} ₽`, bold: true, sep: true });
  if (data.total_paid) rows.push({ label: 'Выплачено (авансы)', value: `−${fmt(data.total_paid)} ₽`, color: '#ef4444' });
  rows.push({ label: 'К выплате', value: `${fmt(data.remaining)} ₽`, bold: true, sep: true, color: 'var(--gold)' });

  return (
    <div className="p-4 pb-24 space-y-4" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <ArrowLeft size={20} style={{ color: 'var(--text-primary)' }} />
        </button>
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Финансы проекта</h1>
      </div>

      {/* Hero */}
      <div className="rounded-xl p-5 text-center" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
        <p className="text-xs uppercase tracking-wide mb-1" style={{ color: 'var(--text-tertiary)' }}>Начислено</p>
        <p className="text-3xl font-bold" style={{ color: 'var(--gold)' }}>{fmt(data.total_earned)} ₽</p>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>{data.days_worked} смен × {fmt(data.day_rate)}₽</p>
      </div>

      {/* Tariff */}
      {data.tariff && (
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid rgba(196,154,42,0.12)' }}>
          <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--text-tertiary)' }}>Тарифная сетка</p>
          <div className="flex justify-between text-sm py-1">
            <span style={{ color: 'var(--text-secondary)' }}>{data.tariff.position_name}</span>
            <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
              {data.tariff.points} бал. × {fmt(data.tariff.point_value || 500)}₽ = {fmt(data.tariff.rate_per_shift)}₽/см
            </span>
          </div>
          {data.combination && (
            <div className="flex justify-between text-sm py-1">
              <span style={{ color: 'var(--gold)' }}>+ Совмещение: {data.combination.position_name}</span>
              <span className="font-medium" style={{ color: 'var(--gold)' }}>+{fmt(data.combination.rate_per_shift)}₽</span>
            </div>
          )}
        </div>
      )}

      {/* Breakdown */}
      <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
        <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-tertiary)' }}>Подробно</p>
        {rows.map((r, i) => <Row key={i} {...r} />)}
      </div>

      {/* Stages breakdown */}
      {data.stages_breakdown?.length > 0 && (
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
          <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-tertiary)' }}>Маршрут до объекта</p>
          {data.stages_breakdown.map((s, i) => (
            <Row key={i}
              label={`${STAGE_LABELS[s.type] || s.type}: ${s.days} дн. × ${fmt(s.rate)}₽`}
              value={`${fmt(s.amount)} ₽`}
            />
          ))}
          <Row label="Итого маршрут" value={`${fmt(data.stages_earned)} ₽`} bold sep color="var(--gold)" />
        </div>
      )}

      {/* Payroll items / advances */}
      {data.payroll_items?.length > 0 && (
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
          <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-tertiary)' }}>Авансы</p>
          {data.payroll_items.map((a, i) => (
            <Row key={i}
              label={a.comment || `Начисление #${i + 1}`}
              value={a.advance_paid ? `−${fmt(a.advance_paid)} ₽` : `${fmt(a.payout)} ₽`}
              color={a.advance_paid ? '#ef4444' : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   PerDiemBalanceCard
   Показывает баланс суточных рабочему с цветовым индикатором:
   🟢 ЗАПАС     — баланс ≥ 5 дней суточных
   🟡 МАЛО      — баланс < 5 дней, + плановая дата выплаты
   ✅ ВЫПЛАЧЕНО — баланс = 0, или уехал с объекта и долгов нет
   🔴 ДОЛГ      — начислено больше выплачено (реальный долг)
   ══════════════════════════════════════════════════════════════════ */
function PerDiemBalanceCard({ cur, finances, proj, hasDeparted }) {
  // Читаем из cur (by_work[0]), fallback на корневые поля finances
  const perDiemAccrued = parseFloat(cur?.per_diem_accrued ?? cur?.per_diem_total ?? finances?.per_diem_accrued ?? 0);
  const perDiemRate    = parseFloat(cur?.per_diem_rate ?? finances?.per_diem_rate ?? proj?.per_diem ?? 0);
  const perDiemPaid    = parseFloat(cur?.per_diem_paid ?? finances?.per_diem_paid ?? 0);

  // Если ставка не задана — не показываем виджет
  if (perDiemRate <= 0) return null;

  // balance > 0 → выплачено больше начислено → у рабочего остаток (хорошо)
  // balance = 0 → всё ровно, суточные выплачены полностью
  // balance < 0 → начислено больше выплачено → компания должна рабочему
  const balance  = perDiemPaid - perDiemAccrued;
  const daysLeft = perDiemRate > 0 ? balance / perDiemRate : 0;

  // Считаем balance «нулевым» если разница меньше 1₽ (погрешность округлений)
  const isBalanceZero = Math.abs(balance) < 1;

  // Рабочий не на объекте: уехал (departure_date) или assignment не активен
  const isInactive = hasDeparted || !cur?.is_active;

  function plural(n) {
    const a = Math.abs(Math.floor(n));
    if (a % 10 === 1 && a % 100 !== 11) return 'день';
    if ([2,3,4].includes(a % 10) && ![12,13,14].includes(a % 100)) return 'дня';
    return 'дней';
  }

  // Плановая дата выплаты: день когда суточные закончатся
  function plannedDate() {
    const d = new Date();
    d.setDate(d.getDate() + Math.max(1, Math.ceil(daysLeft)));
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  }

  // ── Конфиг по статусу ────────────────────────────────────────────
  let cfg;

  // 1. Баланс = 0 (или уехал и всё выплачено) → ВЫПЛАЧЕНО
  if (isBalanceZero || (isInactive && balance >= 0)) {
    cfg = {
      accentColor:  '#30D158',
      accentAlpha:  'rgba(48,209,88,0.12)',
      borderColor:  'rgba(48,209,88,0.20)',
      badge:        'ВЫПЛАЧЕНО',
      badgeBg:      '#30D158',
      badgeColor:   '#002a0e',
      dot:          '✅',
      headline:     isInactive ? 'Все положенные суточные выплачены' : 'Суточные выплачены полностью',
      amountText:   `${fmt(perDiemPaid)}\u00a0₽`,
      subline:      isInactive
        ? 'Задолженностей по суточным нет'
        : `Начислено и выплачено за ${cur?.days_worked || 0} смен`,
      plannedBlock: null,
    };
  // 2. Запас >= 5 дней → ЗАПАС
  } else if (balance > 0 && daysLeft >= 5) {
    cfg = {
      accentColor:  '#30D158',
      accentAlpha:  'rgba(48,209,88,0.15)',
      borderColor:  'rgba(48,209,88,0.22)',
      badge:        'ЗАПАС',
      badgeBg:      '#30D158',
      badgeColor:   '#002a0e',
      dot:          '🟢',
      headline:     'Баланс суточных положительный',
      amountText:   `${fmt(balance)}\u00a0₽`,
      subline:      `Хватит ещё на\u00a0${Math.floor(daysLeft)}\u00a0${plural(daysLeft)}`,
      plannedBlock: null,
    };
  // 3. Запас < 5 дней → МАЛО
  } else if (balance > 0) {
    const days = daysLeft >= 1 ? Math.ceil(daysLeft) : 0;
    cfg = {
      accentColor:  '#FFD60A',
      accentAlpha:  'rgba(255,214,10,0.12)',
      borderColor:  'rgba(255,214,10,0.25)',
      badge:        'МАЛО',
      badgeBg:      '#FFD60A',
      badgeColor:   '#2a1f00',
      dot:          '🟡',
      headline:     days >= 1 ? 'Суточные заканчиваются' : 'Суточные заканчиваются сегодня',
      amountText:   `${fmt(balance)}\u00a0₽`,
      subline:      days >= 1
        ? `Хватит ещё на\u00a0${days}\u00a0${plural(days)}`
        : 'Уточните у руководителя когда будет выплата',
      plannedBlock: {
        date:  plannedDate(),
        label: 'Плановая дата следующей выплаты',
        note:  'Фактическая дата выплаты может отличаться',
      },
    };
  // 4. Реальный долг (accrued > paid) → ДОЛГ
  } else {
    cfg = {
      accentColor:  '#FF453A',
      accentAlpha:  'rgba(255,69,58,0.15)',
      borderColor:  'rgba(255,69,58,0.25)',
      badge:        'ДОЛГ',
      badgeBg:      '#FF453A',
      badgeColor:   '#2a0000',
      dot:          '🔴',
      headline:     'Вам должны суточных',
      amountText:   `${fmt(Math.abs(balance))}\u00a0₽`,
      subline:      isInactive
        ? 'Обратитесь к руководству для получения выплаты'
        : 'Рекомендуем напомнить руководству',
      plannedBlock: null,
    };
  }

  return (
    <div style={{
      borderRadius: '20px',
      overflow: 'hidden',
      border: `1px solid ${cfg.borderColor}`,
      background: `linear-gradient(145deg, ${cfg.accentAlpha} 0%, rgba(255,255,255,0.01) 100%)`,
      boxShadow: `0 0 0 1px ${cfg.borderColor}, 0 8px 28px ${cfg.accentAlpha}`,
    }}>
      {/* Accent top stripe */}
      <div style={{ height: '3px', background: `linear-gradient(90deg, ${cfg.accentColor}, ${cfg.accentColor}44)` }} />

      <div style={{ padding: '16px 18px 18px' }}>
        {/* Row 1: label + badge */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <span style={{ fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
            БАЛАНС СУТОЧНЫХ
          </span>
          <span style={{
            fontSize: '0.5625rem', fontWeight: 800, letterSpacing: '0.07em',
            padding: '3px 9px', borderRadius: '20px',
            background: cfg.badgeBg, color: cfg.badgeColor,
          }}>
            {cfg.badge}
          </span>
        </div>

        {/* Row 2: dot + big amount */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '5px' }}>
          <span style={{ fontSize: '1.5rem', lineHeight: 1 }}>{cfg.dot}</span>
          <span style={{ fontSize: '2.125rem', fontWeight: 800, color: cfg.accentColor, lineHeight: 1, letterSpacing: '-0.02em' }}>
            {cfg.amountText}
          </span>
        </div>

        {/* Row 3: headline */}
        <p style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '3px' }}>
          {cfg.headline}
        </p>

        {/* Row 4: subline */}
        <p style={{ fontSize: '0.8125rem', color: cfg.accentColor, fontWeight: 500, opacity: 0.9 }}>
          {cfg.subline}
        </p>

        {/* Planned payment date block (yellow only when days remain) */}
        {cfg.plannedBlock && (
          <div style={{
            marginTop: '12px',
            padding: '10px 14px',
            borderRadius: '12px',
            background: 'rgba(255,214,10,0.08)',
            border: '1px solid rgba(255,214,10,0.20)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px',
          }}>
            <span style={{ fontSize: '1.1rem', flexShrink: 0, marginTop: '1px' }}>📅</span>
            <div>
              <p style={{ fontSize: '0.6875rem', color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '2px' }}>
                {cfg.plannedBlock.label}
              </p>
              <p style={{ fontSize: '1rem', fontWeight: 700, color: '#FFD60A', marginBottom: '2px' }}>
                {cfg.plannedBlock.date}
              </p>
              <p style={{ fontSize: '0.6875rem', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                {cfg.plannedBlock.note}
              </p>
            </div>
          </div>
        )}

        {/* Divider */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', margin: '14px 0 11px' }} />

        {/* Breakdown rows */}
        {[
          { label: `Начислено (за ${cur?.days_worked || 0} смен)`, value: `${fmt(perDiemAccrued)} ₽`, color: 'rgba(255,255,255,0.7)' },
          { label: 'Выплачено вам', value: `${fmt(perDiemPaid)} ₽`, color: '#30D158' },
          { label: 'Ставка суточных', value: `${fmt(perDiemRate)} ₽ / сутки`, color: cfg.accentColor },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
            <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)' }}>{label}</span>
            <span style={{ fontSize: '0.8125rem', fontWeight: 600, color }}>{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   FieldMoney — Main /field/money
   ══════════════════════════════════════════════════════════════════ */
export default function FieldMoney() {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const [searchParams, setSearchParams] = useSearchParams();
  const detailWorkId = searchParams.get('detail');

  const [finances, setFinances] = useState(null);
  const [project, setProject] = useState(null);
  const [stages, setStages] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [fin, proj] = await Promise.all([
          fieldApi.get('/worker/finances'),
          fieldApi.get('/worker/active-project'),
        ]);
        setFinances(fin);
        const p = proj?.project || proj;
        setProject(p);

        // Load stages for active project
        const workId = p?.work_id;
        if (workId) {
          fieldApi.get(`/stages/my/${workId}`).then(setStages).catch(() => {});
        }
      } catch (e) { setError(e.message); }
      finally { setLoading(false); }
    })();
  }, []);

  // Detail sub-page
  if (detailWorkId) {
    return <MoneyDetail workId={detailWorkId} onBack={() => setSearchParams({})} />;
  }

  if (loading) return <Skeleton />;

  if (finances?.error === 'per_diem_not_set') {
    return (
      <div className="p-4 pb-24" style={{ backgroundColor: 'var(--bg-primary)' }}>
        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => navigate('/field/home')} className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-elevated)' }}>
            <ArrowLeft size={20} style={{ color: 'var(--text-primary)' }} />
          </button>
          <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Мои деньги</h1>
        </div>
        <div className="rounded-xl p-6 text-center" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <div className="text-3xl mb-2">⚠️</div>
          <p style={{ color: 'var(--text-secondary)' }}>{finances.message || 'Суточные не установлены'}</p>
        </div>
      </div>
    );
  }

  // SSoT: activeWork from by_work[] sorted by activity
  const sortedWorks = (finances?.by_work || []).slice().sort((a, b) => {
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
    return (b.days_worked || 0) - (a.days_worked || 0);
  });
  const cur = sortedWorks[0] || {};
  const proj = project || {};
  const tariff = proj.tariff || {};
  const pointValue = tariff.point_value || 500;

  const daysWorked = cur.days_worked || 0;
  const totalShifts = cur.total_shifts || 20;
  const pct = Math.min(100, totalShifts > 0 ? (daysWorked / totalShifts) * 100 : 0);

  // Pre-object stages
  const stagesList = (stages?.stages || []).filter(s => s.stage_type !== 'object' && s.status !== 'rejected');
  const stagesTotal = stagesList.reduce((s, st) => s + parseFloat(st.amount_earned || 0), 0);

  return (
    <div className="p-4 pb-24 space-y-4" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => { haptic.light(); navigate('/field/home'); }} className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <ArrowLeft size={20} style={{ color: 'var(--text-primary)' }} />
        </button>
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Мои деньги</h1>
        <button
          onClick={() => { haptic.light(); navigate('/field/earnings/monthly'); }}
          className="ml-auto text-xs font-semibold px-3 py-1.5 rounded-lg"
          style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--gold)', border: '1px solid rgba(200,168,75,0.3)' }}
        >
          💰 По месяцам
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-lg text-sm" style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>{error}</div>
      )}

      {/* ─── Hero card ──────────────────────────────────────── */}
      <div className="rounded-xl p-5 relative overflow-hidden" style={{
        background: 'linear-gradient(135deg, var(--bg-elevated) 0%, rgba(196,154,42,0.08) 100%)',
        border: '1px solid var(--border-norse)',
      }}>
        <div style={{ position: 'absolute', right: '-10px', top: '50%', transform: 'translateY(-50%)', fontSize: '4rem', fontWeight: 900, color: 'rgba(255,255,255,0.03)', letterSpacing: '4px', pointerEvents: 'none' }}>ASGARD</div>
        <div style={{ position: 'relative', zIndex: 1 }}>
          {cur.work_title && (
            <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-tertiary)' }}>
              Текущий проект: {cur.work_title}
            </p>
          )}
          <p className="text-3xl font-bold" style={{ color: 'var(--gold)' }}>{fmt(cur.total_earned)} ₽</p>

          {daysWorked > 0 && (
            <>
              <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>Отработано {daysWorked} смен</p>
              {/* Progress bar */}
              <div className="mt-2 rounded" style={{ background: 'rgba(255,255,255,0.08)', height: '6px', overflow: 'hidden' }}>
                <div className="rounded" style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg, var(--gold), #f5c542)', transition: 'width 0.8s ease' }} />
              </div>
              <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>{daysWorked} из {totalShifts} смен</p>
            </>
          )}
        </div>
      </div>

      {/* ─── Tariff card ─────────────────────────────────────── */}
      {(tariff.position_name || proj.day_rate) && (
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid rgba(196,154,42,0.12)' }}>
          <div className="flex items-center gap-2 mb-3">
            <Briefcase size={16} style={{ color: 'var(--gold)' }} />
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>Тарифная сетка</span>
          </div>
          {tariff.position_name && (
            <div className="flex justify-between text-sm py-1">
              <span style={{ color: 'var(--text-secondary)' }}>{tariff.position_name}</span>
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                {tariff.points} бал. × {fmt(pointValue)}₽ = {fmt(tariff.rate_per_shift)}₽/см
              </span>
            </div>
          )}
          {tariff.combination && (
            <div className="flex justify-between text-sm py-1">
              <span style={{ color: 'var(--gold)' }}>+ Совмещение: {tariff.combination.position_name}</span>
              <span className="font-medium" style={{ color: 'var(--gold)' }}>+1 балл (+{fmt(pointValue)}₽)</span>
            </div>
          )}
          {proj.per_diem > 0 && (
            <div className="flex justify-between text-sm py-1">
              <span style={{ color: 'var(--text-secondary)' }}>Пайковые</span>
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{fmt(proj.per_diem)}₽/сут</span>
            </div>
          )}
          <p className="text-xs mt-2 italic" style={{ color: 'var(--text-tertiary)', borderTop: '1px solid var(--border-norse)', paddingTop: '8px' }}>
            Тарифная сетка утверждена. 1 балл = {fmt(pointValue)}₽
          </p>
        </div>
      )}

      {/* PerDiemBalanceCard — УДАЛЕНА 25.05.2026.
         Суточные теперь показываются на странице «Зарплата по месяцам»
         в отдельной секции «🌙 Суточные», без смешивания с ЗП. */}

      {/* ─── Stages: Маршрут до объекта ──────────────────────── */}
      {stagesList.length > 0 && (
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
          <div className="flex items-center gap-2 mb-3">
            <MapPin size={16} style={{ color: 'var(--gold)' }} />
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>Маршрут до объекта</span>
          </div>
          {stagesList.map((st) => {
            const earned = parseFloat(st.amount_earned || 0);
            const label = `${STAGE_LABELS[st.stage_type] || st.stage_type}: ${st.days_count || 1} дн. × ${fmt(parseFloat(st.rate_per_day || 0))}₽`;
            const icon = STATUS_ICONS[st.status] || '';
            return (
              <div key={st.id} className="flex justify-between py-1 text-sm">
                <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
                <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{fmt(earned)}₽ {icon}</span>
              </div>
            );
          })}
          <Row label="Итого до объекта" value={`${fmt(stagesTotal)} ₽`} bold sep color="var(--gold)" />
        </div>
      )}

      {/* ─── На объекте — только что заработано «сейчас» ────── */}
      {/* 25.05.2026: убрали «К выплате», «Авансы», «Бонусы» — это всё в /earnings/monthly.
         Здесь — простая картинка «сколько я уже заработал на этом проекте». */}
      <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
        <div className="flex items-center gap-2 mb-3">
          <Clock size={16} style={{ color: 'var(--gold)' }} />
          <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>Заработок на объекте</span>
        </div>
        <Row label={`Зарплата (${daysWorked} см.)`} value={`${fmt(cur.fot)} ₽`} bold color="var(--gold)" />
        {cur.per_diem_accrued > 0 && (
          <Row label={`Суточные (${daysWorked} дн. × ${fmt(cur.per_diem_rate)}₽)`} value={`${fmt(cur.per_diem_accrued)} ₽`} bold color="#f59e0b" />
        )}
        <p className="text-xs mt-3 italic" style={{ color: 'var(--text-tertiary)', borderTop: '1px solid var(--border-norse)', paddingTop: '8px' }}>
          Полная разбивка по месяцам с авансами и фактом выплаты — в разделе «Зарплата по месяцам»
        </p>
      </div>

      {/* Главная CTA: → По месяцам */}
      <button
        onClick={() => { haptic.light(); navigate('/field/earnings/monthly'); }}
        className="w-full rounded-xl p-4 text-left flex items-center gap-3"
        style={{
          background: 'linear-gradient(135deg, rgba(196,154,42,0.12), rgba(196,154,42,0.04))',
          border: '1px solid rgba(196,154,42,0.35)',
        }}
      >
        <span style={{ fontSize: '1.5rem' }}>💰</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold" style={{ color: 'var(--gold)' }}>Зарплата по месяцам</div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            Когда что выплатили, что ожидает, разногласия по табелю
          </div>
        </div>
        <ChevronRight size={18} style={{ color: 'var(--gold)' }} />
      </button>

      {/* History link */}
      <button
        onClick={() => { haptic.light(); navigate('/field/earnings'); }}
        className="w-full py-2 text-center text-xs"
        style={{ color: 'var(--text-tertiary)' }}
      >
        История выплат →
      </button>

      {/* ─── Передачи от рабочих (PM-режим, Stage W) ─────── */}
      <WorkerHandoversSection />

      {/* ─── Projects history ────────────────────────────────── */}
      {sortedWorks.length > 1 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-widest px-1" style={{ color: 'var(--text-tertiary)' }}>Проекты</p>
          {sortedWorks.slice(1).map(p => {
            const isPaid = p.total_pending <= 0;
            return (
              <button
                key={p.work_id}
                onClick={() => { haptic.light(); setSearchParams({ detail: p.work_id }); }}
                className="w-full rounded-xl p-4 text-left flex items-center gap-3"
                style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{p.work_title}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                    {p.days_worked} смен · {isPaid ? '✅ Выплачено' : 'В процессе'}
                  </p>
                </div>
                <span className="text-sm font-semibold whitespace-nowrap" style={{ color: 'var(--gold)' }}>{fmt(p.total_earned)} ₽</span>
                <ChevronRight size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   WorkerHandoversSection — «Передачи от рабочих» (Stage W)

   Бизнес-логика:
   1. Бухгалтер выплатил рабочему через СЗ-перевод (worker_payments.payment_method='se_transfer').
   2. Рабочий получил на карту → передал РП налом.
   3. РП открывает /field/money или /m/cash, видит секцию «Передачи от рабочих»,
      по каждому рабочему: «Ожидается X ₽ за месяц Y».
   4. РП тапает «Получил полностью» / «Частично» / «Не получено» →
      POST /api/handovers/ создаёт worker_to_pm_handovers запись,
      статус идёт в pm-balance и timesheet.

   ВАЖНО — секция работает ТОЛЬКО для пользователя с CRM-токеном (PM).
   У чистого field-рабочего нет CRM-токена → секция тихо скрыта.
   ══════════════════════════════════════════════════════════════ */
function WorkerHandoversSection() {
  const haptic = useHaptic();
  const [items,    setItems]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [opened,   setOpened]   = useState(null);
  const [busy,     setBusy]     = useState(false);

  // Текущий месяц/год для запроса
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1;

  // Hide-if-not-PM: проверяем CRM-токен (asgard_token)
  const hasCrmToken = typeof localStorage !== 'undefined' && !!localStorage.getItem('asgard_token');

  const load = useCallback(async () => {
    if (!hasCrmToken) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await api.get(`/timesheet/v2/handovers/${year}/${month}`);
      // Формат: [{worker_id, fio, work_id, expected_amount, source_se_transfer_id, existing_handover?}]
      const rows = api.extractRows(res) || [];
      setItems(rows);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [year, month, hasCrmToken]);

  useEffect(() => { load(); }, [load]);

  if (!hasCrmToken) return null;       // workers don't see this
  if (loading) return null;             // skeleton не делаем — секция опциональная
  if (items.length === 0) return null;  // нечего показывать — скрываем секцию

  const handleConfirm = async (action, partialAmount = null) => {
    if (!opened || busy) return;
    setBusy(true);
    try {
      const expected = Number(opened.expected_amount || 0);
      let payload = {
        worker_id: opened.worker_id,
        work_id:   opened.work_id,
        year, month,
        source_se_transfer_id: opened.source_se_transfer_id || null,
        expected_amount: expected,
      };
      if (action === 'full') {
        payload.received_amount = expected;
        payload.status = 'received';
        haptic.success();
      } else if (action === 'partial') {
        const v = Number(partialAmount);
        if (!Number.isFinite(v) || v < 0) { setBusy(false); return; }
        payload.received_amount = v;
        payload.status = v >= expected ? 'received' : 'partial';
        haptic.medium();
      } else if (action === 'none') {
        payload.received_amount = 0;
        payload.status = 'not_received';
        const note = window.prompt('Причина (необязательно)?', '');
        if (note) payload.note = note;
        haptic.light();
      }
      await api.post('/handovers/', payload);
      setItems((prev) => prev.filter((r) => r.worker_id !== opened.worker_id || r.work_id !== opened.work_id));
      setOpened(null);
    } catch (e) {
      haptic.error();
      window.alert('Ошибка: ' + (e.message || 'не удалось'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl p-4" style={{
      backgroundColor: 'var(--bg-elevated)',
      // золотисто-оранжевый акцент (Stage W)
      border: '1px solid rgba(255,152,0,0.25)',
      background: 'linear-gradient(135deg, rgba(255,152,0,0.07) 0%, var(--bg-elevated) 100%)',
    }}>
      <div className="flex items-center gap-2 mb-3">
        <Inbox size={16} style={{ color: '#FF9800' }} />
        <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>
          Передачи от рабочих
        </span>
        <span
          className="ml-auto px-2 py-0.5 rounded-full"
          style={{
            background: 'rgba(255,152,0,0.18)',
            color: '#FF9800',
            fontSize: 11, fontWeight: 700,
          }}
        >
          {items.length}
        </span>
      </div>

      <div className="space-y-2">
        {items.map((h) => (
          <button
            key={`${h.worker_id}-${h.work_id}-${h.source_se_transfer_id || 'x'}`}
            onClick={() => { haptic.light(); setOpened(h); }}
            className="w-full rounded-xl text-left flex items-center gap-3"
            style={{
              padding: '12px 14px',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,152,0,0.18)',
            }}
          >
            <div
              style={{
                width: 36, height: 36, borderRadius: 10,
                background: 'rgba(255,152,0,0.18)',
                color: '#FF9800',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, fontWeight: 800, flexShrink: 0,
              }}
            >
              {(h.fio || 'Р').slice(0, 1).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                {h.fio || `Рабочий #${h.worker_id}`}
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                Ожидается {fmt(h.expected_amount)} ₽
                {h.work_title && ` · ${h.work_title}`}
              </p>
            </div>
            <ChevronRight size={16} style={{ color: '#FF9800', flexShrink: 0 }} />
          </button>
        ))}
      </div>

      {opened && (
        <HandoverConfirmSheet
          handover={opened}
          busy={busy}
          onConfirm={handleConfirm}
          onClose={() => setOpened(null)}
        />
      )}
    </div>
  );
}

function HandoverConfirmSheet({ handover, busy, onConfirm, onClose }) {
  const expected = Number(handover.expected_amount || 0);
  const [partial, setPartial] = useState('');
  const [showPartial, setShowPartial] = useState(false);

  return (
    <BottomSheet open onClose={onClose} title={`Получил от ${handover.fio || '—'}`}>
      <div className="flex flex-col gap-3 pb-4">
        <div
          className="rounded-xl px-4 py-3 flex items-center justify-between"
          style={{
            background: 'rgba(255,152,0,0.08)',
            border: '1px solid rgba(255,152,0,0.25)',
          }}
        >
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>
              Ожидаемая сумма
            </p>
            <p style={{ fontSize: 22, fontWeight: 800, color: '#FF9800', marginTop: 2 }}>
              {fmt(expected)} ₽
            </p>
          </div>
          {handover.work_title && (
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600 }}>Проект</p>
              <p style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600 }}>{handover.work_title}</p>
            </div>
          )}
        </div>

        {!showPartial ? (
          <>
            <button
              onClick={() => onConfirm('full')}
              disabled={busy}
              className="spring-tap"
              style={{
                minHeight: 56, borderRadius: 14, fontSize: 16, fontWeight: 700,
                background: 'color-mix(in srgb, var(--green) 18%, transparent)',
                color: 'var(--green)',
                border: '0.5px solid color-mix(in srgb, var(--green) 30%, var(--border-norse))',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                opacity: busy ? 0.6 : 1,
              }}
            >
              <Check size={20} /> Получил полностью ({fmt(expected)} ₽)
            </button>

            <button
              onClick={() => setShowPartial(true)}
              disabled={busy}
              className="spring-tap"
              style={{
                minHeight: 56, borderRadius: 14, fontSize: 16, fontWeight: 700,
                background: 'color-mix(in srgb, var(--gold) 14%, transparent)',
                color: 'var(--gold)',
                border: '0.5px solid color-mix(in srgb, var(--gold) 28%, var(--border-norse))',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                opacity: busy ? 0.6 : 1,
              }}
            >
              <AlertCircle size={20} /> Получил частично
            </button>

            <button
              onClick={() => onConfirm('none')}
              disabled={busy}
              className="spring-tap"
              style={{
                minHeight: 56, borderRadius: 14, fontSize: 16, fontWeight: 700,
                background: 'color-mix(in srgb, var(--red-soft) 12%, transparent)',
                color: 'var(--red)',
                border: '0.5px solid color-mix(in srgb, var(--red-soft) 25%, var(--border-norse))',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                opacity: busy ? 0.6 : 1,
              }}
            >
              ✗ Не получено
            </button>
          </>
        ) : (
          <>
            <label className="input-label">Сколько получили (₽)</label>
            <input
              type="number"
              value={partial}
              onChange={(e) => setPartial(e.target.value)}
              placeholder={String(expected)}
              className="input-field"
              autoFocus
            />

            <div className="flex gap-2">
              <button
                onClick={() => { setShowPartial(false); setPartial(''); }}
                className="spring-tap"
                style={{
                  flex: 1, minHeight: 50, borderRadius: 12, fontSize: 14, fontWeight: 600,
                  background: 'var(--bg-surface)',
                  color: 'var(--text-secondary)',
                  border: '0.5px solid var(--border-norse)',
                }}
              >
                Назад
              </button>
              <button
                onClick={() => onConfirm('partial', partial)}
                disabled={busy || !partial}
                className="spring-tap"
                style={{
                  flex: 2, minHeight: 50, borderRadius: 12, fontSize: 14, fontWeight: 700,
                  background: 'color-mix(in srgb, var(--gold) 18%, transparent)',
                  color: 'var(--gold)',
                  border: '0.5px solid color-mix(in srgb, var(--gold) 30%, var(--border-norse))',
                  opacity: (busy || !partial) ? 0.5 : 1,
                }}
              >
                Подтвердить
              </button>
            </div>
          </>
        )}
      </div>
    </BottomSheet>
  );
}

