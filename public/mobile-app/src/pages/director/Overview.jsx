import { useMemo, useState } from 'react';
import { ChevronRight, AlertCircle } from 'lucide-react';
import { useHaptic } from '@/hooks/useHaptic';
import { formatMoneyShort, formatMoney } from '@/lib/utils';

/**
 * Overview — первый экран «Пульса директора».
 *
 * Принцип (заказчик 10.11.2026): «информация должна появляться постепенно».
 * Один экран = один вопрос: «что от меня ждут?».
 *
 *  1. Одна главная цифра — сколько всего требует решения.
 *  2. Три строки-входа по контурам: одна цифра, без сеток KPI.
 *  3. График офиса — три строки превью, остальное по тапу.
 *
 * Никаких четырёх ячеек одинакового веса, никаких радужных бейджей.
 */

function pluralRu(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

/** Причина внимания → человеческая подпись. */
const KIND_LABEL = {
  director: 'Ждёт вашего решения',
  analysis_overdue: 'Просрочен анализ',
  deadline_soon: 'Срок близко',
};

export default function Overview({
  overview, teamHours, periodLabel, loading, onOpenList, onOpenDetail, onOpenOffice,
}) {
  const haptic = useHaptic();
  const [showAllAttention, setShowAllAttention] = useState(false);
  const [showOfficeAll, setShowOfficeAll] = useState(false);

  const tenders = overview?.tenders || {};
  const apps = overview?.applications || {};
  const works = overview?.works || {};

  // «Требует решения» — единая цифра по трём контурам. Считается из
  // attention_count (реальное число), а не из длины среза.
  const tAttnCount = Number(tenders.attention_count || 0);
  const aAttnCount = Number(apps.attention_count || (apps.attention || []).length || 0);
  const wAttnCount = Number(works.risk_count || (works.attention || []).length || 0);
  const totalAttention = tAttnCount + aAttnCount + wAttnCount;

  const attention = useMemo(() => {
    const rows = [];
    (tenders.attention || []).forEach((x) => rows.push({ ...x, section: 'tenders', kind: x.attention_kind }));
    (apps.attention || []).forEach((x) => rows.push({ ...x, section: 'applications', kind: 'app' }));
    return rows;
  }, [tenders.attention, apps.attention]);

  const visibleAttention = showAllAttention ? attention : attention.slice(0, 3);

  const officeRows = useMemo(() => {
    const people = (teamHours?.people || []).filter((p) => p.norm_minutes > 0);
    const sorted = people.slice().sort((a, b) => (b.ratio_pct || 0) - (a.ratio_pct || 0));
    const top = sorted.filter((p) => p.state === 'green').slice(0, 2);
    const bottom = sorted.filter((p) => p.state !== 'green').slice(-2).reverse();
    return { top, bottom, all: sorted, total: people.length };
  }, [teamHours?.people]);

  const norm = teamHours?.norm || {};

  const open = (section, id) => {
    haptic.light();
    if (id) onOpenDetail(section, id);
    else onOpenList(section, 'all');
  };

  if (loading) {
    return (
      <div className="jp2-loading">
        <div className="jp2-skel jp2-skel--hero" />
        <div className="jp2-skel jp2-skel--row" />
        <div className="jp2-skel jp2-skel--row" />
        <div className="jp2-skel jp2-skel--row" />
      </div>
    );
  }

  return (
    <div className="jp2-overview">
      {/* ── 1. Главное число ─────────────────────────────────────────── */}
      <section className="jp2-hero">
        <div className="jp2-hero-cap">Требует решения</div>
        <div className={`jp2-hero-num${totalAttention > 0 ? ' is-hot' : ''}`}>
          {totalAttention}
        </div>
        <div className="jp2-hero-sub">
          {totalAttention > 0
            ? `${pluralRu(totalAttention, 'задача', 'задачи', 'задач')} по трём контурам`
            : 'Всё под контролем'}
          {periodLabel ? ` · ${periodLabel}` : ''}
        </div>
      </section>

      {/* ── 2. Что именно ждёт: список причин ────────────────────────── */}
      {attention.length > 0 && (
        <section className="jp2-attention">
          {visibleAttention.map((x) => (
            <button
              type="button"
              key={`${x.section}-${x.id}`}
              className="jp2-att-row spring-tap"
              onClick={() => open(x.section, x.id)}
            >
              <span className={`jp2-att-dot is-${x.kind === 'director' ? 'hot' : 'warm'}`} />
              <span className="jp2-att-body">
                <span className="jp2-att-title">{x.title || x.customer_name}</span>
                <span className="jp2-att-meta">
                  {KIND_LABEL[x.kind] || 'Требует внимания'}
                  {x.customer_name && x.title ? ` · ${x.customer_name}` : ''}
                </span>
              </span>
              <ChevronRight size={16} className="jp2-att-chev" />
            </button>
          ))}
          {attention.length > 3 && (
            <button
              type="button"
              className="jp2-att-more spring-tap"
              onClick={() => { haptic.light(); setShowAllAttention((v) => !v); }}
            >
              {showAllAttention ? 'Свернуть' : `Ещё ${attention.length - 3}`}
            </button>
          )}
        </section>
      )}

      {/* ── 3. Три контура: одна строка — одна цифра ─────────────────── */}
      <section className="jp2-contours">
        <div className="jp2-sec-cap">Контуры</div>

        <button type="button" className="jp2-contour spring-tap" onClick={() => open('tenders')}>
          <span className="jp2-contour-name">Тендеры</span>
          <span className="jp2-contour-mid">
            {tenders.total != null ? `${tenders.total} в периоде` : '—'}
            {tenders.nmck_sum > 0
              ? ` · НМЦК ${formatMoneyShort(tenders.nmck_sum)}`
              : ''}
          </span>
          <span className={`jp2-contour-num${tAttnCount > 0 ? ' is-hot' : ''}`}>
            {tAttnCount > 0 ? tAttnCount : tenders.total || 0}
          </span>
          <ChevronRight size={16} className="jp2-contour-chev" />
        </button>

        <button type="button" className="jp2-contour spring-tap" onClick={() => open('applications')}>
          <span className="jp2-contour-name">Заявки</span>
          <span className="jp2-contour-mid">
            {apps.total != null
              ? `${apps.total} создано · ${formatMoneyShort(apps.in_work_sum || 0)} в работе`
              : '—'}
          </span>
          <span className={`jp2-contour-num${aAttnCount > 0 ? ' is-hot' : ''}`}>
            {aAttnCount > 0 ? aAttnCount : apps.total || 0}
          </span>
          <ChevronRight size={16} className="jp2-contour-chev" />
        </button>

        <button type="button" className="jp2-contour spring-tap" onClick={() => open('works')}>
          <span className="jp2-contour-name">Работы</span>
          <span className="jp2-contour-mid">
            {works.total != null ? `${works.total} в портфеле` : '—'}
            {works.risk_count > 0 ? ` · ${works.risk_count} в риске` : ''}
          </span>
          <span className={`jp2-contour-num${wAttnCount > 0 ? ' is-hot' : ''}`}>
            {wAttnCount > 0 ? wAttnCount : works.active || 0}
          </span>
          <ChevronRight size={16} className="jp2-contour-chev" />
        </button>
      </section>

      {/* ── 4. График офиса: превью из трёх строк ────────────────────── */}
      {(officeRows.top.length > 0 || officeRows.bottom.length > 0) && (
        <section className="jp2-office">
          <div className="jp2-sec-head">
            <span className="jp2-sec-cap">График офиса</span>
            <button
              type="button"
              className="jp2-sec-link spring-tap"
              onClick={() => { haptic.light(); onOpenOffice?.(); }}
            >
              Открыть
            </button>
          </div>

          <div className="jp2-office-sub">
            {norm.people_green != null
              ? `${norm.people_green} в норме из ${norm.people_total}`
              : 'нет данных'}
            {teamHours?.period?.label ? ` · ${teamHours.period.label}` : ''}
          </div>

          {(showOfficeAll ? officeRows.all : [...officeRows.top, ...officeRows.bottom]).map((p) => (
            <div className="jp2-office-row" key={p.staff_id}>
              <span className={`jp2-office-bar is-${p.state}`} />
              <span className="jp2-office-name">
                {p.name}
                {p.crown ? <span className="jp2-office-crown" aria-label="лучший">★</span> : null}
              </span>
              <span className={`jp2-office-pct is-${p.state}`}>
                {p.ratio_pct == null ? '—' : `${Math.round(p.ratio_pct)}%`}
              </span>
            </div>
          ))}

          {officeRows.all.length > 4 && (
            <button
              type="button"
              className="jp2-att-more spring-tap"
              onClick={() => { haptic.light(); setShowOfficeAll((v) => !v); }}
            >
              {showOfficeAll ? 'Свернуть' : `Все ${officeRows.all.length}`}
            </button>
          )}
        </section>
      )}

      {/* ── 5. Прочее — свёрнуто, чтобы не мешало ────────────────────── */}
      <section className="jp2-summary">
        <div className="jp2-sec-cap">Итоги периода</div>
        <div className="jp2-sum-row">
          <span className="jp2-sum-k">НМЦК тендеров</span>
          <span className="jp2-sum-v">{formatMoney(tenders.nmck_sum || 0)}</span>
        </div>
        <div className="jp2-sum-row">
          <span className="jp2-sum-k">
            Цена работ
            {tenders.priced_count
              ? ` · ${tenders.priced_count} из ${tenders.total} с ценой`
              : ''}
          </span>
          <span className="jp2-sum-v">{formatMoney(tenders.work_price_sum || 0)}</span>
        </div>
        <div className="jp2-sum-row">
          <span className="jp2-sum-k">Портфель работ</span>
          <span className="jp2-sum-v">{formatMoney(works.contract_sum || 0)}</span>
        </div>
        <div className="jp2-sum-row">
          <span className="jp2-sum-k">
            Средняя маржа
            {works.margin_plan_count > 0 ? ` · ${works.margin_plan_count} по плану` : ''}
          </span>
          <span className="jp2-sum-v">
            {works.avg_margin == null ? '—' : `${works.avg_margin}%`}
          </span>
        </div>
        <div className="jp2-sum-row">
          <span className="jp2-sum-k">Конверсия тендеров</span>
          <span className="jp2-sum-v">
            {tenders.conversion == null ? '—' : `${tenders.conversion}%`}
          </span>
        </div>
      </section>

      {totalAttention > 0 && (
        <div className="jp2-foot-note">
          <AlertCircle size={14} />
          <span>Показаны только задачи, ждущие решения. Архив и поданные сюда не попадают.</span>
        </div>
      )}
    </div>
  );
}
