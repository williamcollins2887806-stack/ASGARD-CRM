import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Briefcase, MapPin, ChevronRight, Clock } from 'lucide-react';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';

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

      {/* ─── On-object breakdown ─────────────────────────────── */}
      <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
        <div className="flex items-center gap-2 mb-3">
          <Clock size={16} style={{ color: 'var(--gold)' }} />
          <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>На объекте</span>
        </div>
        <Row label={`ФОТ: ${daysWorked} смен`} value={`${fmt(cur.fot)} ₽`} />
        {cur.per_diem_accrued > 0 && (
          <Row label={`Суточные: ${daysWorked} дн. × ${fmt(cur.per_diem_rate)}₽`} value={`${fmt(cur.per_diem_accrued)} ₽`} />
        )}
        {cur.bonus_paid > 0 && <Row label="Бонусы" value={`+${fmt(cur.bonus_paid)} ₽`} color="#22c55e" />}
        {cur.penalty > 0 && <Row label="Удержания" value={`−${fmt(cur.penalty)} ₽`} color="#ef4444" />}
        {cur.advance_paid > 0 && <Row label="Авансы" value={`−${fmt(cur.advance_paid)} ₽`} color="#ef4444" />}
        <Row label="ИТОГО начислено (этот проект)" value={`${fmt(cur.total_earned)} ₽`} bold sep />
        {cur.total_pending < 0 ? (
          <Row label="ПЕРЕПЛАТА по проекту" value={`${fmt(Math.abs(cur.total_pending))} ₽`} bold color="#22c55e" />
        ) : (
          <Row label="К выплате по проекту" value={`${fmt(cur.total_pending)} ₽`} bold color="var(--gold)" />
        )}
        {/* Show "К выплате всего" if differs from this project */}
        {finances?.total_pending != null && Math.abs((finances.total_pending || 0) - (cur.total_pending || 0)) > 1 && (
          <Row label="К выплате всего (все проекты)" value={`${fmt(finances.total_pending)} ₽`} bold color="var(--gold)" />
        )}
      </div>

      {/* ─── All time summary ────────────────────────────────── */}
      {finances?.total_earned > 0 && sortedWorks.length > 0 && (
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
          <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-tertiary)' }}>За всё время</p>
          <Row label="Всего начислено" value={`${fmt(finances.total_earned)} ₽`} />
          <Row label="Выплачено" value={`${fmt(finances.total_paid)} ₽`} color="#22c55e" />
          <Row label="Ожидает выплаты" value={`${fmt(finances.total_pending)} ₽`} color="#f59e0b" />
        </div>
      )}

      {/* History link */}
      <button
        onClick={() => { haptic.light(); navigate('/field/earnings'); }}
        className="w-full py-3 text-center text-sm font-semibold"
        style={{ color: 'var(--gold)' }}
      >
        Вся история доходов →
      </button>

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
