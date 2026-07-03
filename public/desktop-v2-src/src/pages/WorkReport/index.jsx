/**
 * Страница /work-report?id=<work_id> — финансовый отчёт по работе.
 * Источник: vanilla `public/assets/js/work_report.js` (1177 LOC).
 *
 * Содержит: Hero, KPI Strip, Donut, Expense Accordion, VAT/Tax/Profit-блоки,
 * Waterfall, Timeline, Plan vs Fact, Crew, Payments, Print/Excel-экспорт.
 *
 * Endpoint: GET /api/works/:id/financial-summary (src/routes/works.js:699).
 * RBAC backend: ADMIN, DIRECTOR_GEN, DIRECTOR_COMM, DIRECTOR_DEV, HEAD_PM, PM, BUH.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/api/useAuth';
import { TopActionsBar, EmptyState, LoadingCard } from '@/blocks/Blocks';
import AccessDenied from '@/blocks/AccessDenied';
import { Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import {
  CAT_LABELS, CHART_COLORS,
  loadFinancialSummary, listWorks,
  fmtMoney, fmtMoneyR, fmtDate, pct, daysBetween, mShort,
  exportWorkReportExcel, printPdf
} from './api';
import './work-report.css';

// RBAC inline-литералы для скрипта rbac-audit (он не разворачивает константы).
const ALLOWED_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_PM', 'PM', 'BUH'];

function getQueryParam(name) {
  const hash = window.location.hash || '';
  const m = hash.match(new RegExp('[?&]' + name + '=([^&]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

const STATUS_COLOR_MAP = {
  'Новая': '#64748b', 'Подготовка': '#3b82f6', 'Мобилизация': '#8b5cf6',
  'В работе': '#f59e0b', 'Подписание акта': '#f97316', 'Работы сдали': '#10b981',
  'Закрыт': '#6b7280', 'На паузе': '#94a3b8'
};

const PAYMENT_TYPES = { advance: 'Аванс', postpay: 'Постоплата', intermediate: 'Промежуточный', other: 'Прочее' };

export default function WorkReportPage() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [openCats, setOpenCats] = useState({});
  const [worksList, setWorksList] = useState([]);
  const [worksLoading, setWorksLoading] = useState(false);

  const workId = getQueryParam('id');

  useEffect(() => {
    if (!workId) {
      // Грузим список работ для выбора
      setLoading(false);
      setWorksLoading(true);
      listWorks().then(setWorksList).finally(() => setWorksLoading(false));
      return;
    }
    if (user && !ALLOWED_ROLES.includes(user.role)) return;
    setLoading(true);
    setError(null);
    loadFinancialSummary(workId)
      .then((d) => setData(d))
      .catch((e) => setError(e?.serverMsg || e?.message || 'Не удалось загрузить отчёт'))
      .finally(() => setLoading(false));
  }, [workId, user?.role]);

  if (user && !ALLOWED_ROLES.includes(user.role)) {
    return (
      <AccessDenied
        allowed={ALLOWED_ROLES}
        userRole={user.role}
        title="Финансовый отчёт по работе недоступен"
        message="Раздел открыт PM/HEAD_PM (видят свои работы), BUH/директорам и ADMIN."
      />
    );
  }

  // Экран выбора работы
  if (!workId) {
    return (
      <div className="col gap-14">
        <TopActionsBar
          kicker="Отчёты"
          title="Финансовый отчёт по работе"
          subtitle="Выберите работу — НДС, налоги, прибыль, реестр платежей"
        />
        {worksLoading ? (
          <LoadingCard text="Загружаем список работ…" />
        ) : worksList.length === 0 ? (
          <EmptyState icon="📈" title="Нет работ" hint="Работы появятся после создания тендера" />
        ) : (
          <div className="card p-16">
            <div className="wr-pick-list">
              {worksList.map((w) => (
                <div
                  key={w.id}
                  className="wr-pick-item"
                  role="button"
                  tabIndex={0}
                  onClick={() => { window.location.hash = `#/work-report?id=${w.id}`; }}
                  onKeyDown={(e) => { if (e.key === 'Enter') window.location.hash = `#/work-report?id=${w.id}`; }}
                >
                  <div>
                    <div className="wr-pick-title">
                      {w.work_number ? `#${w.work_number} · ` : ''}{w.work_title || w.title || 'Без названия'}
                    </div>
                    <div className="wr-pick-meta">
                      {w.customer_name || '—'} {w.city ? '· ' + w.city : ''} {w.work_status ? '· ' + w.work_status : ''}
                    </div>
                  </div>
                  <div className="fs-12 c-t2">{fmtMoneyR(w.contract_value)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="col gap-14">
        <TopActionsBar kicker="Отчёты" title="Финансовый отчёт" />
        <LoadingCard text="Загружаем финансовые данные…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="col gap-14">
        <TopActionsBar kicker="Отчёты" title="Финансовый отчёт" />
        <div className="wr-error">{error}</div>
      </div>
    );
  }

  if (!data) return null;

  return <Report data={data} openCats={openCats} setOpenCats={setOpenCats} />;
}

/* ─── основной отчёт ─────────────────────────────────────────────────── */

function Report({ data, openCats, setOpenCats }) {
  const wm = data.work_meta || {};
  const marginColor = data.profit.margin >= 25 ? 'var(--ok)' : data.profit.margin >= 15 ? 'var(--gold)' : 'var(--err)';
  const statusColor = STATUS_COLOR_MAP[wm.work_status] || '#64748b';

  const doExport = async () => {
    try {
      const fileName = await exportWorkReportExcel(data);
      toast.success('Excel сохранён: ' + fileName);
    } catch (e) {
      toast.error('Не удалось сохранить Excel: ' + (e?.message || e));
    }
  };

  const doPrint = async () => {
    try {
      await printPdf(data.work_id);
    } catch (e) {
      if (e?.status === 404) {
        // PDF-роута на бэке нет — печатаем стандартно
        window.print();
      } else {
        toast.error('Не удалось открыть PDF: ' + (e?.message || e));
      }
    }
  };

  return (
    <div className="col gap-14">
      <TopActionsBar
        kicker="Отчёты"
        title="Финансовый отчёт"
        subtitle={`Работа #${wm.work_number || data.work_id}`}
        actions={
          <>
            <Btn variant="ghost" onClick={() => { window.location.hash = '#/work-report'; }}>← К списку</Btn>
            <Btn variant="ghost" onClick={doPrint}>🖨 Печать</Btn>
            <Btn variant="primary" onClick={doExport}>📥 Excel</Btn>
          </>
        }
      />

      <Hero data={data} wm={wm} statusColor={statusColor} marginColor={marginColor} />
      <KpiStrip data={data} marginColor={marginColor} />

      <div className="wr-grid">
        <div className="wr-grid-main">
          <Donut data={data} />
          <ExpenseAccordion data={data} openCats={openCats} setOpenCats={setOpenCats} />
          <VatBlock data={data} />
          <TaxBlock data={data} />
          <ProfitBlock data={data} marginColor={marginColor} />
        </div>
        <div className="wr-grid-side">
          <Waterfall data={data} />
          <Timeline data={data} />
          <PlanVsFact data={data} />
          <Crew data={data} />
        </div>
      </div>

      <Payments data={data} />
    </div>
  );
}

/* ─── 1. HERO ────────────────────────────────────────────────────────── */
function Hero({ data, wm, statusColor, marginColor }) {
  return (
    <div className="wr-hero">
      <div className="wr-hero-bg" />
      <div className="wr-hero-content">
        <div className="wr-hero-top">
          <div>
            <div className="wr-hero-number">
              {wm.work_number ? `Работа #${wm.work_number}` : `Работа #${data.work_id}`}
            </div>
            <h1 className="wr-hero-title">{data.work_title || 'Без названия'}</h1>
            <div className="wr-hero-meta">
              {wm.customer_name && <span>{wm.customer_name}</span>}
              {wm.customer_inn && <span className="wr-hero-inn">ИНН {wm.customer_inn}</span>}
              {wm.city && <span>{wm.city}</span>}
              {wm.object_name && <span>{wm.object_name}</span>}
            </div>
            {wm.pm_name && (
              <div className="wr-hero-pm">РП: <strong>{wm.pm_name}</strong></div>
            )}
          </div>
          <div className="wr-hero-right">
            <div className="wr-hero-status" style={{ background: statusColor }}>
              {wm.work_status || '—'}
            </div>
            <div className="wr-hero-margin-label">Маржа</div>
            <div className="wr-hero-margin" style={{ color: marginColor }}>{data.profit.margin}%</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── 2. KPI STRIP ───────────────────────────────────────────────────── */
// Анимация count-up KPI — паритет с vanilla work_report.js:749-788.
// IntersectionObserver запускает анимацию когда карточка попадает в viewport (threshold 0.3),
// 1200ms easeOutCubic, для |target| < 100 (маржа) → toFixed(1), иначе fmtMoney.
function CountUp({ target, suffix = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const num = Number(target) || 0;
    const isPercent = Math.abs(num) < 100;
    let stopped = false;

    function animate() {
      const duration = 1200;
      const start = 0;
      const startTime = performance.now();
      function step(now) {
        if (stopped) return;
        const progress = Math.min((now - startTime) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = start + (num - start) * eased;
        el.textContent = isPercent ? current.toFixed(1) : fmtMoney(current);
        if (progress < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          animate();
          observer.unobserve(el);
        }
      });
    }, { threshold: 0.3 });
    observer.observe(el);

    return () => { stopped = true; observer.disconnect(); };
  }, [target]);

  return <><span ref={ref}>0</span>{suffix}</>;
}

function KpiStrip({ data, marginColor }) {
  const profitColor = data.profit.net >= 0 ? 'var(--ok)' : 'var(--err)';
  const cards = [
    { label: 'Выручка',          target: data.revenue.with_vat,        suffix: ' ₽', sub: 'Без НДС: ' + fmtMoneyR(data.revenue.ex_vat),     color: 'var(--info)', icon: '↗' },
    { label: 'Расходы + налоги', target: data.expenses.total_with_tax, suffix: ' ₽', sub: 'Расходы: ' + fmtMoneyR(data.expenses.total),     color: 'var(--err)',  icon: '↘' },
    { label: 'Чистая прибыль',   target: data.profit.net,              suffix: ' ₽', sub: 'До налога: ' + fmtMoneyR(data.profit.before_tax), color: profitColor,   icon: '₽' },
    { label: 'Маржа',            target: data.profit.margin,           suffix: '%',  sub: 'НДС: ' + data.vat_pct + '%',                      color: marginColor,   icon: '◐' }
  ];
  return (
    <div className="wr-kpi-strip">
      {cards.map((c, i) => (
        <div key={i} className="wr-kpi-card">
          <div className="wr-kpi-icon" style={{ fontSize: 28, color: c.color }}>{c.icon}</div>
          <div className="wr-kpi-body">
            <div className="wr-kpi-label">{c.label}</div>
            <div className="wr-kpi-value" style={{ color: c.color }}>
              <CountUp target={c.target} suffix={c.suffix} />
            </div>
            <div className="wr-kpi-sub">{c.sub}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── 3. DONUT ───────────────────────────────────────────────────────── */
function Donut({ data }) {
  const cats = data.expenses?.categories || [];
  if (cats.length === 0) {
    return (
      <div className="wr-card">
        <div className="wr-card-title">Структура расходов</div>
        <div className="wr-empty">Нет расходов</div>
      </div>
    );
  }

  const total = data.expenses.total || 1;
  const R = 75, CX = 100, CY = 100, SW = 35;
  const CIRC = 2 * Math.PI * R;
  const GAP_PX = 4;
  const totalGapLen = GAP_PX * cats.length;
  const usableLen = CIRC - totalGapLen;
  const startOffset = CIRC / 4;
  let accumulated = 0;

  const segments = cats.map((c, i) => {
    const frac = c.sum / total;
    const segLen = frac * usableLen;
    const dashOffset = startOffset - accumulated;
    accumulated += segLen + GAP_PX;
    const ci = CHART_COLORS[i % CHART_COLORS.length];
    return (
      <circle
        key={c.category + '-' + i}
        cx={CX} cy={CY} r={R}
        fill="none"
        stroke={ci}
        strokeWidth={SW}
        strokeDasharray={`${segLen} ${CIRC - segLen}`}
        strokeDashoffset={dashOffset}
      />
    );
  });

  return (
    <div className="wr-card">
      <div className="wr-card-title">Структура расходов</div>
      <div className="wr-donut-wrap">
        <svg viewBox="0 0 200 200" className="wr-donut-svg">
          {segments}
          <text x={CX} y={CY - 8} textAnchor="middle" className="wr-donut-total-label">Итого</text>
          <text x={CX} y={CY + 14} textAnchor="middle" className="wr-donut-total-val">{fmtMoneyR(total)}</text>
        </svg>
        <div className="wr-donut-legend">
          {cats.map((c, i) => {
            const info = CAT_LABELS[c.category] || { label: c.category };
            const ci = CHART_COLORS[i % CHART_COLORS.length];
            return (
              <div className="wr-donut-legend-item" key={c.category + '-' + i}>
                <span className="wr-donut-dot" style={{ background: ci }} />
                <span className="wr-donut-legend-label">{info.label}</span>
                <span className="wr-donut-legend-val">{fmtMoneyR(c.sum)}</span>
                <span style={{ color: 'var(--t-2)', fontSize: 11, minWidth: 36, textAlign: 'right' }}>
                  {pct(c.sum, total)}%
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ─── 4. EXPENSE ACCORDION ───────────────────────────────────────────── */
function ExpenseAccordion({ data, openCats, setOpenCats }) {
  const cats = data.expenses?.categories || [];
  if (cats.length === 0) return null;

  return (
    <div className="wr-card">
      <div className="wr-card-title">Расходы по категориям</div>
      {cats.map((c, i) => {
        const info = CAT_LABELS[c.category] || { label: c.category, icon: '📋' };
        const ci = CHART_COLORS[i % CHART_COLORS.length];
        const barW = pct(c.sum, data.expenses.total);
        const isOpen = !!openCats[c.category];
        return (
          <div key={c.category + '-' + i} className="wr-acc" data-open={isOpen ? '1' : '0'}>
            <div
              className="wr-acc-head"
              onClick={() => setOpenCats({ ...openCats, [c.category]: !isOpen })}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setOpenCats({ ...openCats, [c.category]: !isOpen }); }}
            >
              <div className="wr-acc-bar-bg"><div className="wr-acc-bar" style={{ width: `${barW}%`, background: ci }} /></div>
              <div className="wr-acc-info">
                <span className="wr-acc-icon">{info.icon}</span>
                <span className="wr-acc-name">{info.label}</span>
                <span className="wr-acc-count">{c.count} шт</span>
                {c.taxBurden > 0 && <span className="wr-acc-tax">+{fmtMoney(c.taxBurden)} ({data.taxes.rate}%)</span>}
                {c.vatDeductible > 0 && <span className="wr-acc-vat">{fmtMoney(c.vatDeductible)} НДС к вычету</span>}
              </div>
              <div className="wr-acc-sum">{fmtMoneyR(c.sum)}</div>
              <div className="wr-acc-chevron">▶</div>
            </div>
            {isOpen && (c.items || []).length > 0 && (
              <div className="wr-acc-body" style={{ maxHeight: 1200 }}>
                <table className="wr-acc-table">
                  <thead>
                    <tr>
                      <th>Поставщик</th>
                      <th className="wr-r">Сумма</th>
                      <th>Комментарий</th>
                      <th>Документ</th>
                      <th>С/Ф</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.items.map((it, j) => (
                      <tr key={it.id || j}>
                        <td>{it.supplier || '—'}</td>
                        <td className="wr-r">{fmtMoneyR(it.amount)}</td>
                        <td>{it.comment || ''}</td>
                        <td>{it.doc_number || '—'}</td>
                        <td>{it.invoice_received ? '✅' : it.invoice_needed ? '⏳' : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
      <div className="wr-acc-total">
        <span>Итого расходов</span>
        <span>{fmtMoneyR(data.expenses.total)}</span>
      </div>
      <div className="wr-acc-total-sub">
        <span>С учётом налогов ({data.taxes.rate}%)</span>
        <span>{fmtMoneyR(data.expenses.total_with_tax)}</span>
      </div>
    </div>
  );
}

/* ─── 5. VAT ─────────────────────────────────────────────────────────── */
function VatBlock({ data }) {
  return (
    <div className="wr-card">
      <div className="wr-card-title">НДС</div>
      <div className="wr-row"><span>НДС начисленный</span><span>{fmtMoneyR(data.vat.charged)}</span></div>
      <div className="wr-row-desc">Выручка {fmtMoneyR(data.revenue.with_vat)} × {data.vat_pct}/{100 + Math.round(data.vat_pct)}</div>
      <div className="wr-row"><span>НДС к вычету</span><span className="wr-blue">{fmtMoneyR(data.vat.deductible)}</span></div>
      <div className="wr-row-desc">Из безналичных расходов с НДС</div>
      <div className="wr-row wr-row-bold"><span>НДС к уплате</span><span className="wr-red">{fmtMoneyR(data.vat.payable)}</span></div>
    </div>
  );
}

/* ─── 6. TAX BLOCK ───────────────────────────────────────────────────── */
function TaxBlock({ data }) {
  return (
    <div className="wr-card">
      <div className="wr-card-title">Налоговая нагрузка</div>
      <div className="wr-row wr-row-bold">
        <span>НДФЛ + взносы / обналичка ({data.taxes.rate}%)</span>
        <span className="wr-red">{fmtMoneyR(data.taxes.burden)}</span>
      </div>
      <div className="wr-row-desc">На ФОТ, наличные, суточные, субподряд</div>
    </div>
  );
}

/* ─── 7. PROFIT BLOCK with gauge ─────────────────────────────────────── */
function ProfitBlock({ data, marginColor }) {
  const profitColor = data.profit.net >= 0 ? 'var(--ok)' : 'var(--err)';
  const R = 60, CX = 100, CY = 75, SW = 10;
  const halfCirc = Math.PI * R;
  const zoneRed = 0.3 * halfCirc;
  const zoneYel = 0.2 * halfCirc;
  const zoneGrn = 0.5 * halfCirc;
  const arcPath = `M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`;
  const clamp = Math.min(Math.max(data.profit.margin, 0), 50);
  const angle = Math.PI - (clamp / 50) * Math.PI;
  const nx = CX + (R + 8) * Math.cos(angle);
  const ny = CY - (R + 8) * Math.sin(angle);
  const nbx = CX + 12 * Math.cos(angle);
  const nby = CY - 12 * Math.sin(angle);

  return (
    <div className="wr-card wr-profit-card">
      <div className="wr-card-title">Итого: Прибыль</div>
      <div className="wr-profit-grid">
        <div className="wr-profit-formula">
          <div className="wr-row"><span>Выручка без НДС</span><span>{fmtMoneyR(data.revenue.ex_vat)}</span></div>
          <div className="wr-row"><span className="wr-red">− Расходы + налоги</span><span className="wr-red">{fmtMoneyR(data.expenses.total_with_tax)}</span></div>
          <div className="wr-row"><span className="wr-blue">+ НДС к вычету</span><span className="wr-blue">{fmtMoneyR(data.vat.deductible)}</span></div>
          <div className="wr-divider" />
          <div className="wr-row wr-row-bold"><span>Прибыль до налога</span><span>{fmtMoneyR(data.profit.before_tax)}</span></div>
          <div className="wr-row"><span className="wr-red">− Налог на прибыль ({data.profit.income_tax_rate}%)</span><span className="wr-red">{fmtMoneyR(data.profit.income_tax)}</span></div>
          <div className="wr-divider" />
          <div className="wr-row wr-row-big" style={{ color: profitColor }}>
            <span>Чистая прибыль</span>
            <span>{fmtMoneyR(data.profit.net)}</span>
          </div>
        </div>
        <div className="wr-profit-gauge-wrap">
          <svg viewBox="0 0 200 100" style={{ width: '100%', maxWidth: 200, height: 'auto' }}>
            <path d={arcPath} fill="none" stroke="var(--brd)" strokeWidth={SW} strokeLinecap="round" />
            <path d={arcPath} fill="none" stroke="#ef4444" strokeWidth={SW}
                  strokeDasharray={`${zoneRed} ${halfCirc - zoneRed}`} strokeDashoffset={0} opacity={0.4} />
            <path d={arcPath} fill="none" stroke="#f59e0b" strokeWidth={SW}
                  strokeDasharray={`${zoneYel} ${halfCirc - zoneYel}`} strokeDashoffset={-zoneRed} opacity={0.4} />
            <path d={arcPath} fill="none" stroke="#10b981" strokeWidth={SW}
                  strokeDasharray={`${zoneGrn} ${halfCirc - zoneGrn}`} strokeDashoffset={-(zoneRed + zoneYel)} opacity={0.4} />
            <line x1={nbx.toFixed(1)} y1={nby.toFixed(1)} x2={nx.toFixed(1)} y2={ny.toFixed(1)}
                  stroke={marginColor} strokeWidth={3} strokeLinecap="round" />
            <circle cx={CX} cy={CY} r={5} fill={marginColor} />
            <text x={CX} y={CY - 18} textAnchor="middle" fill={marginColor} fontSize={22} fontWeight={700}>{data.profit.margin}%</text>
            <text x={CX} y={CY - 4} textAnchor="middle" fill="rgba(184,196,231,.7)" fontSize={10}>маржа</text>
          </svg>
        </div>
      </div>
    </div>
  );
}

/* ─── 8. WATERFALL ───────────────────────────────────────────────────── */
function Waterfall({ data }) {
  const items = useMemo(() => [
    { label: 'Выручка',     value: data.revenue.ex_vat,         type: 'pos' },
    { label: 'Расходы',     value: data.expenses.total,         type: 'neg' },
    { label: 'Нал.нагрузка',value: data.taxes.burden,           type: 'neg' },
    { label: 'НДС к выч.',  value: data.vat.deductible,         type: 'pos' },
    { label: 'Налог приб.', value: data.profit.income_tax,      type: 'neg' },
    { label: 'Прибыль',     value: data.profit.net,             type: 'total' }
  ], [data]);

  const W = 400, H = 240, padTop = 30, padBot = 28, padLeft = 10, padRight = 10;
  const chartH = H - padTop - padBot;
  const chartW = W - padLeft - padRight;
  const barCount = items.length;
  const barGap = 12;
  const barW = Math.floor((chartW - barGap * (barCount - 1)) / barCount);

  let running = 0;
  const runningVals = [0];
  items.forEach((item) => {
    if (item.type === 'total') {
      runningVals.push(item.value); runningVals.push(0);
    } else if (item.type === 'pos') {
      runningVals.push(running); running += item.value; runningVals.push(running);
    } else {
      runningVals.push(running); running -= item.value; runningVals.push(running);
    }
  });
  const minVal = Math.min(...runningVals, 0);
  const maxVal = Math.max(...runningVals, 1);
  const range = maxVal - minVal || 1;
  const scale = chartH / range;
  const yOf = (v) => padTop + (maxVal - v) * scale;
  const zeroY = yOf(0);

  running = 0;
  const elements = [];
  elements.push(
    <line key="base" x1={padLeft} y1={zeroY} x2={W - padRight} y2={zeroY}
          stroke="var(--brd)" strokeDasharray="4 3" strokeWidth={1} />
  );

  items.forEach((item, i) => {
    const x = padLeft + i * (barW + barGap);
    const colors = { pos: '#10b981', neg: '#ef4444', total: item.value >= 0 ? '#3b82f6' : '#ef4444' };
    const color = colors[item.type];
    let barTop, barBottom;
    const prevRunning = running;

    if (item.type === 'total') {
      if (item.value >= 0) { barTop = yOf(item.value); barBottom = zeroY; }
      else { barTop = zeroY; barBottom = yOf(item.value); }
    } else if (item.type === 'pos') {
      barTop = yOf(running + item.value); barBottom = yOf(running); running += item.value;
    } else {
      barTop = yOf(running); barBottom = yOf(running - item.value); running -= item.value;
    }
    const barH = Math.max(barBottom - barTop, 2);

    if (i > 0 && item.type !== 'total') {
      const connY = yOf(prevRunning);
      const prevX = padLeft + (i - 1) * (barW + barGap) + barW;
      elements.push(
        <line key={`conn-${i}`} x1={prevX} y1={connY} x2={x} y2={connY}
              stroke="var(--brd)" strokeDasharray="3 2" strokeWidth={1} />
      );
    }
    elements.push(
      <rect key={`bar-${i}`} x={x} y={barTop} width={barW} height={barH}
            rx={3} fill={color} className="wr-wf-bar" />
    );
    const valLabel = (item.type === 'neg' ? '−' : '') + mShort(item.value);
    const labelAbove = item.type !== 'neg';
    const valY = labelAbove ? Math.max(barTop - 6, 10) : Math.min(barBottom + 14, H - padBot - 2);
    elements.push(
      <text key={`val-${i}`} x={x + barW / 2} y={valY} textAnchor="middle" className="wr-wf-val">
        {valLabel}
      </text>
    );
    elements.push(
      <text key={`lbl-${i}`} x={x + barW / 2} y={H - 6} textAnchor="middle" className="wr-wf-label" style={{ fontSize: 10 }}>
        {item.label}
      </text>
    );
  });

  return (
    <div className="wr-card">
      <div className="wr-card-title">Путь к прибыли</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="wr-wf-svg">{elements}</svg>
    </div>
  );
}

/* ─── 9. TIMELINE ────────────────────────────────────────────────────── */
function Timeline({ data }) {
  const tl = data.timeline || {};
  const wm = data.work_meta || {};
  const steps = [];
  if (data.tender) steps.push({ label: 'Тендер создан', date: data.tender.created_at, icon: '📥' });
  if (data.estimate) {
    steps.push({ label: 'Просчёт', date: data.estimate.created_at, icon: '📊' });
    if (data.estimate.sent_at) steps.push({ label: 'Просчёт отправлен', date: data.estimate.sent_at, icon: '📨' });
  }
  if (tl.start_fact) steps.push({ label: 'Начало работ', date: tl.start_fact, icon: '🚀' });
  if (tl.end_fact) steps.push({ label: 'Работы завершены', date: tl.end_fact, icon: '✅' });
  if (wm.completed_at) steps.push({ label: 'Контракт закрыт', date: wm.completed_at, icon: '🔒' });
  if (!steps.length) return null;

  return (
    <div className="wr-card">
      <div className="wr-card-title">Хронология</div>
      <div className="wr-tl">
        {steps.map((s, i) => (
          <div key={i} className={'wr-tl-step ' + (i === steps.length - 1 ? 'wr-tl-last' : '')}>
            <div className="wr-tl-dot">{s.icon}</div>
            <div className="wr-tl-info">
              <div className="wr-tl-label">{s.label}</div>
              <div className="wr-tl-date">{fmtDate(s.date)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── 10. PLAN vs FACT ───────────────────────────────────────────────── */
function PlanVsFact({ data }) {
  const tl = data.timeline || {};
  const wm = data.work_meta || {};
  if (!tl.start_plan && !tl.start_fact && !wm.cost_plan) return null;

  const planDays = daysBetween(tl.start_plan, tl.end_plan);
  const factDays = daysBetween(tl.start_fact, tl.end_fact);
  const devDays = (planDays !== null && factDays !== null) ? factDays - planDays : null;
  const devColor = devDays === null ? 'var(--t-2)' : devDays <= 0 ? 'var(--ok)' : 'var(--err)';
  const devText = devDays === null ? '—' : devDays === 0 ? 'В срок ✓' : (devDays > 0 ? `Задержка +${devDays} дн.` : `Раньше на ${Math.abs(devDays)} дн.`);

  const costDev = wm.cost_plan > 0 ? Math.round((wm.cost_fact - wm.cost_plan) / wm.cost_plan * 100) : null;
  const costColor = costDev === null ? 'var(--t-2)' : costDev <= 0 ? 'var(--ok)' : 'var(--err)';
  const costText = costDev === null ? '—' : (costDev > 0 ? `Перерасход +${costDev}%` : `Экономия ${Math.abs(costDev)}%`);

  return (
    <div className="wr-card">
      <div className="wr-card-title">План vs Факт</div>
      <div className="wr-pvf-grid">
        <div className="wr-pvf-item">
          <div className="wr-pvf-label">Сроки (план)</div>
          <div className="wr-pvf-val">{planDays !== null ? `${planDays} дн.` : '—'}</div>
        </div>
        <div className="wr-pvf-item">
          <div className="wr-pvf-label">Сроки (факт)</div>
          <div className="wr-pvf-val">{factDays !== null ? `${factDays} дн.` : '—'}</div>
        </div>
        <div className="wr-pvf-item">
          <div className="wr-pvf-label">Отклонение</div>
          <div className="wr-pvf-val" style={{ color: devColor }}>{devText}</div>
        </div>
        <div className="wr-pvf-item">
          <div className="wr-pvf-label">Себест. план</div>
          <div className="wr-pvf-val">{wm.cost_plan ? fmtMoneyR(wm.cost_plan) : '—'}</div>
        </div>
        <div className="wr-pvf-item">
          <div className="wr-pvf-label">Себест. факт</div>
          <div className="wr-pvf-val">{wm.cost_fact ? fmtMoneyR(wm.cost_fact) : '—'}</div>
        </div>
        <div className="wr-pvf-item">
          <div className="wr-pvf-label">Отклонение</div>
          <div className="wr-pvf-val" style={{ color: costColor }}>{costText}</div>
        </div>
      </div>
    </div>
  );
}

/* ─── 11. CREW ───────────────────────────────────────────────────────── */
function Crew({ data }) {
  const crew = data.crew || [];
  if (crew.length === 0) return null;
  const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#2980b9'];
  return (
    <div className="wr-card">
      <div className="wr-card-title">Бригада ({crew.length})</div>
      {crew.map((c, idx) => {
        const initials = (c.full_name || '?').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
        const bg = colors[Math.abs(hashCode(c.full_name || '')) % colors.length];
        const points = Math.round(parseFloat(c.earned || 0) / parseFloat(c.point_value || 500));
        return (
          <div key={c.id || idx} className="wr-crew-row">
            <div className="wr-crew-avatar" style={{ background: bg }}>{initials}</div>
            <div className="wr-crew-info">
              <div className="wr-crew-name">{c.full_name || '—'}</div>
              <div className="wr-crew-pos">{c.position || ''}</div>
            </div>
            <div className="wr-crew-stats">
              <span>{c.shifts || 0} см</span>
              <span>{points} бал</span>
              <span className="wr-crew-earned">{fmtMoneyR(c.earned)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─── 12. PAYMENTS ───────────────────────────────────────────────────── */
function Payments({ data }) {
  const p = data.payments;
  if (!p || !p.items || p.items.length === 0) return null;

  const today = new Date().toISOString().slice(0, 10);
  const pctFilled = Math.min(p.payment_pct, 100);
  const barColor = pctFilled >= 100 ? 'var(--ok)' : pctFilled >= 50 ? 'var(--info)' : 'var(--gold)';
  const receivablesColor = p.receivables > 0 ? 'var(--gold)' : 'var(--ok)';

  return (
    <div className="wr-card wr-pay-section">
      <div className="wr-card-title">Оплата заказчиком</div>
      <div className="wr-pay-progress">
        <div className="wr-pay-progress-head">
          <span>Получено</span>
          <span style={{ color: barColor, fontWeight: 700 }}>{p.payment_pct}%</span>
        </div>
        <div className="wr-pay-bar-bg"><div className="wr-pay-bar" style={{ width: `${pctFilled}%`, background: barColor }} /></div>
        <div className="wr-pay-progress-foot">
          <span>{fmtMoneyR(p.confirmed)}</span>
          <span>из {fmtMoneyR(data.contract_value)}</span>
        </div>
      </div>

      <table className="wr-pay-table">
        <thead>
          <tr>
            <th>Тип</th><th>Описание</th><th className="wr-r">Сумма</th><th>Дата</th><th>Статус</th>
          </tr>
        </thead>
        <tbody>
          {p.items.map((inc, i) => {
            const isOverdue = !inc.confirmed && inc.date && String(inc.date).slice(0, 10) < today;
            const statusEl = inc.confirmed
              ? <span className="wr-pay-ok">✅ Оплачен</span>
              : isOverdue
                ? <span className="wr-pay-overdue">⚠ Просрочен</span>
                : <span className="wr-pay-wait">⏳ Ожидает</span>;
            return (
              <tr key={inc.id || i} className={isOverdue ? 'wr-pay-row-overdue' : ''}>
                <td>{PAYMENT_TYPES[inc.type] || inc.type || '—'}</td>
                <td>{inc.comment || ''}</td>
                <td className="wr-r">{fmtMoneyR(inc.amount)}</td>
                <td>{fmtDate(inc.date)}</td>
                <td>{statusEl}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="wr-pay-summary">
        <div className="wr-pay-stat">
          <div className="wr-pay-stat-label">Оплачено</div>
          <div className="wr-pay-stat-val" style={{ color: 'var(--ok)' }}>{fmtMoneyR(p.confirmed)}</div>
        </div>
        <div className="wr-pay-stat">
          <div className="wr-pay-stat-label">Ожидается</div>
          <div className="wr-pay-stat-val" style={{ color: 'var(--gold)' }}>{fmtMoneyR(p.pending)}</div>
        </div>
        <div className="wr-pay-stat">
          <div className="wr-pay-stat-label">Дебиторка</div>
          <div className="wr-pay-stat-val" style={{ color: receivablesColor }}>{fmtMoneyR(p.receivables)}</div>
        </div>
      </div>

      {p.overdue > 0 && (
        <div className="wr-pay-alert">⚠ Просроченных платежей: {p.overdue}</div>
      )}
    </div>
  );
}
