/**
 * MiniGantt — компактная SVG-полоска (~240×28) с двумя датами + меткой «сегодня».
 * Источник vanilla: AsgardGantt.renderMini (public/assets/js/gantt.js:37-82).
 *
 * Vanilla рендерит 24-недельную сетку с большой полосой. Здесь — упрощённая
 * однорядная версия для inline-показа в hero/finance секции WorkDetail:
 *   ─ горизонтальная шкала старт-план … финиш-план (или финиш-факт)
 *   ─ цветная полоса работы (ok / warning / danger)
 *   ─ вертикальная метка «сегодня» (золотая)
 *
 * Логика статуса (parity с vanilla):
 *   ok      — end_fact <= end_plan ИЛИ end_fact ещё пуст и сегодня <= end_plan
 *   warning — end_fact пуст и сегодня ≤ end_plan + 7 дней (приближается дедлайн)
 *   danger  — end_fact > end_plan ИЛИ сегодня > end_plan + 7 дней (просрочка)
 */

const COLORS = {
  ok:      'var(--ok,  #2dbb7f)',
  warning: 'var(--amber, #f0a83b)',
  danger:  'var(--err, #e23a3a)',
  today:   'var(--gold, #d4a843)',
  grid:    'var(--brd, rgba(255,255,255,.08))'
};

function parseDate(s) {
  if (!s) return null;
  // YYYY-MM-DD как ЛОКАЛЬНАЯ дата (vanilla gantt.js:10-11 — иначе UTC midnight
  // даёт -1 день в браузере вне Moscow TZ).
  if (typeof s === 'string') {
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function fmt(d) {
  if (!d) return '—';
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function diffDays(a, b) {
  return Math.round((b - a) / (24 * 3600 * 1000));
}

export function MiniGantt({ startDate, endPlan, endFact, label = '', width = 240, height = 28 }) {
  const start = parseDate(startDate);
  const plan  = parseDate(endPlan);
  const fact  = parseDate(endFact);
  const today = new Date(); today.setHours(0, 0, 0, 0);

  // Нет ни старта, ни финиша → не показываем (вызывающая сторона может скрыть).
  if (!start && !plan && !fact) return null;

  // Окно: от max(start, today-7d) до max(plan, fact, today)+padding.
  const minD = start || today;
  const maxD = (() => {
    const cands = [plan, fact, today].filter(Boolean);
    return cands.reduce((m, d) => (d > m ? d : m), cands[0] || today);
  })();
  const padDays = Math.max(2, Math.round(diffDays(minD, maxD) * 0.08));
  const winStart = new Date(minD); winStart.setDate(winStart.getDate() - padDays);
  const winEnd   = new Date(maxD); winEnd.setDate(winEnd.getDate() + padDays);
  const totalDays = Math.max(1, diffDays(winStart, winEnd));

  const x = (d) => ((diffDays(winStart, d) / totalDays) * width);

  // Цвет статуса (parity с воркфлоу: ok / warning / danger).
  let tone = 'ok';
  if (plan && fact && fact > plan) tone = 'danger';
  else if (plan && !fact) {
    if (today > plan) tone = 'danger';
    else if (today > new Date(plan.getTime() - 7 * 24 * 3600 * 1000)) tone = 'warning';
  }
  const barColor = COLORS[tone];

  const barStart = start || winStart;
  const barEnd   = fact || plan || today;
  const barX = Math.max(0, x(barStart));
  const barW = Math.max(2, x(barEnd) - barX);
  const todayX = (today >= winStart && today <= winEnd) ? x(today) : null;

  const barY = Math.round(height / 2 - 5);

  const tooltip = `${label ? label + ' · ' : ''}старт ${fmt(start)} → план ${fmt(plan)}${fact ? ' · факт ' + fmt(fact) : ''}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={tooltip}
      style={{ display: 'block' }}
    >
      <title>{tooltip}</title>
      {/* Базовая дорожка */}
      <rect x="0" y={barY} width={width} height="10" rx="5" ry="5" fill={COLORS.grid} />
      {/* Полоса работы */}
      <rect x={barX} y={barY} width={barW} height="10" rx="5" ry="5" fill={barColor} opacity="0.95" />
      {/* Засечка финиш-план (если он есть и виден) */}
      {plan && (() => {
        const px = x(plan);
        if (px < 0 || px > width) return null;
        return <line x1={px} y1={barY - 3} x2={px} y2={barY + 13} stroke="rgba(255,255,255,.55)" strokeWidth="1.5" strokeDasharray="2,2" />;
      })()}
      {/* Засечка финиш-факт */}
      {fact && (() => {
        const px = x(fact);
        if (px < 0 || px > width) return null;
        return <circle cx={px} cy={barY + 5} r="3.5" fill="#fff" stroke={barColor} strokeWidth="1.5" />;
      })()}
      {/* Сегодня */}
      {todayX != null && (
        <line x1={todayX} y1="0" x2={todayX} y2={height} stroke={COLORS.today} strokeWidth="2" />
      )}
    </svg>
  );
}

/**
 * MiniGanttBar — обёртка с подписями дат под SVG (используется внутри сводки).
 */
export function MiniGanttBar({ startDate, endPlan, endFact, label }) {
  const start = parseDate(startDate);
  const plan  = parseDate(endPlan);
  const fact  = parseDate(endFact);
  if (!start && !plan && !fact) {
    return <div className="help" style={{ fontSize: 11, opacity: 0.7 }}>Сроки не заданы</div>;
  }
  return (
    <div className="col gap-4" style={{ width: '100%' }}>
      <MiniGantt startDate={startDate} endPlan={endPlan} endFact={endFact} label={label} width={260} height={26} />
      <div className="row" style={{ fontSize: 10.5, opacity: 0.75, gap: 6, justifyContent: 'space-between' }}>
        <span>старт {fmt(start)}</span>
        <span>план {fmt(plan)}</span>
        {fact && <span style={{ color: 'var(--gold,#d4a843)' }}>факт {fmt(fact)}</span>}
      </div>
    </div>
  );
}
