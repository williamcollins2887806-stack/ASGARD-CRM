/**
 * Модалка согласования просчёта (estimate).
 * Источник vanilla: openEstimate() в public/assets/js/approvals.js.
 *
 * Показывает: контекст тендера, версию, цену/себестоимость/маржу, сводку РП.
 * Действия: ✓ Согласовать (без комментария), 🔄 Доработка (comment+), ❓ Вопрос (comment+), ✗ Отклонить (comment+).
 * Использует базовую ApprovalModal из @/modals: PromptModal вложен для комментария.
 *
 * Лента комментариев согласования — внизу: подгружается отдельно из /comments.
 */
import { useState, useEffect, useRef } from 'react';
import { useModal } from '@/modals';
import { useAuth } from '@/api/useAuth';
import { MCard, MHead, MBody, MFoot, Btn, Pill } from '@/modals/parts';
import { PromptModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { TextareaInput } from '@/inputs/Inputs';
import {
  loadEstimateDetails, loadComments, postComment, loadTender, loadAppSettings,
  approveEstimate, reworkEstimate, questionEstimate, rejectEstimate,
  fmtMoney, fmtDateTime, calcMargin, statusMeta, safeParseJSON, profitZone
} from './api';
import './approvals.css';

export function EstimateApprovalModal({ estimate, onChanged }) {
  const { close, open } = useModal();
  const { user } = useAuth();
  // RBAC — синхронно с vanilla approvals.js строки 3,221:
  // Принимать решения по очереди согласования могут только ADMIN и 3 директорские роли.
  // Inline-литералы нужны для скрипта rbac-audit.
  const canDecide = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(user?.role);
  const [full, setFull] = useState(estimate);
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingDeep, setLoadingDeep] = useState(true);
  const [tender, setTender] = useState(null);
  const [settings, setSettings] = useState({});
  const [docsMenuOpen, setDocsMenuOpen] = useState(false);
  const docsBtnRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingDeep(true);
    Promise.all([
      loadEstimateDetails(estimate.id),
      loadComments(estimate.id),
      loadAppSettings()
    ])
      .then(([est, cmts, appSettings]) => {
        if (cancelled) return;
        const full = est || estimate;
        setFull(full);
        setComments(cmts);
        setSettings(appSettings || {});
        // Тендер подгружаем после, чтобы получить purchase_url для «Открыть площадку».
        if (full?.tender_id) {
          return loadTender(full.tender_id).then((t) => { if (!cancelled) setTender(t); });
        }
      })
      .catch((e) => toast('Не удалось загрузить детали', String(e?.message || e), 'err'))
      .finally(() => !cancelled && setLoadingDeep(false));
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimate.id]);

  // Закрытие меню «Документы» по клику вне.
  useEffect(() => {
    if (!docsMenuOpen) return undefined;
    const onDocClick = (ev) => {
      if (!docsBtnRef.current) return;
      if (!docsBtnRef.current.contains(ev.target)) setDocsMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [docsMenuOpen]);

  const margin = calcMargin(full.price_tkp, full.cost_plan);
  const meta = statusMeta(full.approval_status);

  /* ─── Источники просчёта (vanilla approvals.js:405-516) ───
   * quick_calc_json — быстрый просчёт Мимира (поля people_count/work_days/city/work_type/assumptions[]/risks[]).
   * calc_v2_json    — рунический детерминированный калькулятор (поля people_count/work_days/cost_total/price_with_vat/
   *                                                          profit_per_day/margin_pct/net_profit/status/assumptions). */
  const quickCalc = safeParseJSON(full.quick_calc_json, null);
  const calcV2    = safeParseJSON(full.calc_v2_json, null);

  /* «Срез Ярла» — расширенные метрики (ФОТ+налоги, Прибыль/чел-день).
   * Источник №1: calc_v2_json (детерминированный — приоритет).
   * Источник №2: quick_calc_json (быстрый просчёт Мимира).
   * Источник №3: calc_summary_json.director (legacy для старых смет, vanilla:540-549). */
  const calcSummary = safeParseJSON(full.calc_summary_json, null);
  const vatPct = Number(settings?.vat_pct ?? settings?.calc?.vat_pct ?? 22);

  const yarl = (() => {
    // 1) calc_v2_json — приоритет
    if (calcV2 && Number.isFinite(Number(calcV2.profit_per_day))) {
      return {
        fot: calcV2.fot_with_taxes ?? calcV2.fot_total ?? null,
        profitPerDay: calcV2.profit_per_day
      };
    }
    // 2) quick_calc_json — считаем сами из price_tkp / cost_plan + people_count*work_days
    if (quickCalc && (quickCalc.people_count || quickCalc.work_days)) {
      const people = Number(quickCalc.people_count) || 1;
      const days = Number(quickCalc.work_days) || 1;
      const pd = people * days;
      const priceNoVat = Number(full.price_tkp || 0) / (1 + vatPct / 100);
      const profit = priceNoVat - Number(full.cost_plan || 0);
      const profitPerDay = pd > 0 ? Math.round(profit / pd) : null;
      return {
        fot: quickCalc.fot_with_taxes ?? null,
        profitPerDay
      };
    }
    // 3) legacy calc_summary_json.director
    if (calcSummary?.director) {
      return {
        fot: calcSummary.director.fot_with_taxes ?? null,
        profitPerDay: calcSummary.director.profit_per_person_day ?? null
      };
    }
    return { fot: null, profitPerDay: null };
  })();

  /* ─── Docs pack ─── */
  const copyAllLinks = async () => {
    setDocsMenuOpen(false);
    const docs = Array.isArray(full.documents) ? full.documents : [];
    if (docs.length === 0) {
      toast('Документы', 'Прикреплённых файлов нет', 'info');
      return;
    }
    // Vanilla openDocsPack собирает file_url; в v2 это /api/files/download/<filename>.
    const origin = (typeof window !== 'undefined' && window.location?.origin) || '';
    const lines = docs.map((d) => {
      const name = d.original_name || d.filename || `Документ ${d.id}`;
      const url = d.file_url || `${origin}/api/files/download/${encodeURIComponent(d.filename || '')}`;
      return `${name}\n${url}`;
    }).join('\n\n');
    try {
      await navigator.clipboard.writeText(lines);
      toast('Скопировано', `Ссылок: ${docs.length}`, 'ok');
    } catch (e) {
      toast('Не удалось скопировать', String(e?.message || e), 'err');
    }
  };

  const openPurchasePage = () => {
    setDocsMenuOpen(false);
    const url = tender?.purchase_url || full.purchase_url;
    if (!url) {
      toast('Площадка', 'Ссылка на закупочную площадку не указана', 'info');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const hasDocs = Array.isArray(full.documents) && full.documents.length > 0;
  const hasPurchaseUrl = !!(tender?.purchase_url || full.purchase_url);
  const showDocsBtn = hasDocs || hasPurchaseUrl;

  const ask = (action, label, tone, runner, requireComment = true) => {
    if (!requireComment) {
      // Без комментария (только approve)
      runAction(runner, '');
      return;
    }
    open(
      <PromptModal
        title={action}
        subtitle={label}
        label="Комментарий"
        placeholder="Опишите, что именно нужно исправить / в чём вопрос…"
        multiline
        required
        accent={tone}
        icon="✎"
        okText="Отправить"
        onSubmit={(comm) => runAction(runner, comm)}
      />,
      { size: 'center' }
    );
  };

  const runAction = async (fn, comm) => {
    setBusy(true);
    try {
      await fn(estimate.id, comm);
      toast('Решение зафиксировано', 'РП получит уведомление', 'ok');
      window.dispatchEvent(new CustomEvent('asgard:approvals:changed'));
      onChanged?.();
      close();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
      setBusy(false);
    }
  };

  const sendComment = async () => {
    if (!newComment.trim()) return;
    try {
      await postComment(estimate.id, newComment.trim());
      const cmts = await loadComments(estimate.id);
      setComments(cmts);
      setNewComment('');
      toast('Комментарий отправлен', '', 'ok');
    } catch (e) {
      toast('Не удалось', String(e?.message || e), 'err');
    }
  };

  return (
    <MCard className="modal-lg">
      <MHead
        icon="✓"
        title={`Согласование просчёта #${full.id}`}
        subtitle={`v${full.version_no ?? full.current_version_no ?? 1} · ${full.customer || full.customer_name || ''}`}
        accent="gold"
        onClose={close}
      />
      <MBody>
        {/* Контекст */}
        <div className="appr-ctx-card">
          <div className="appr-ctx-head">
            <div>
              <div className="appr-section-eyebrow">
                Просчёт
              </div>
              <div className="appr-ctx-title">
                {full.title || full.tender_title || `Просчёт #${full.id}`}
              </div>
              <div className="fs-12 c-t3 mt-4">
                РП: <b>{full.pm_name || '—'}</b> · отправлено: {fmtDateTime(full.sent_for_approval_at)}
              </div>
            </div>
            <Pill tone={meta.tone}>{meta.label}</Pill>
          </div>
        </div>

        {/* KPI — Срез Ярла (vanilla approvals.js:540-549 + расширение из quick_calc/calc_v2) */}
        <div className="appr-kpi-grid">
          <KPI label="Цена ТКП" value={fmtMoney(full.price_tkp)} tone="gold" />
          <KPI label="Себестоимость" value={fmtMoney(full.cost_plan)} />
          <KPI
            label="Маржа"
            value={margin !== null ? `${margin}%` : '—'}
            tone={margin === null ? 'default' : margin < 10 ? 'rejected' : margin < 20 ? 'question' : 'approved'}
          />
          <KPI label="Вероятность" value={full.probability_pct != null ? `${full.probability_pct}%` : '—'} />
          {yarl.fot != null && (
            <KPI label="ФОТ + налоги" value={fmtMoney(yarl.fot)} tone="default" />
          )}
          {yarl.profitPerDay != null && (
            <KPI
              label="Прибыль / чел‑день"
              value={fmtMoney(yarl.profitPerDay)}
              tone={yarl.profitPerDay >= 25000 ? 'approved' : yarl.profitPerDay >= 20000 ? 'question' : 'rejected'}
            />
          )}
        </div>

        {/* Карточка ⚒ V2 — детерминированный «рунический калькулятор» (vanilla:480-516) */}
        {calcV2 && (
          <CalcCard
            kind="v2"
            title="⚒ Расчёт V2 (детерминированный)"
            calc={calcV2}
            estimate={full}
            settings={settings}
          />
        )}

        {/* Карточка 🧙 Quick — быстрый просчёт Мимира (vanilla:422-477) */}
        {quickCalc && (
          <CalcCard
            kind="quick"
            title="🧙 Просчёт Мимира (Quick)"
            calc={quickCalc}
            estimate={full}
            settings={settings}
          />
        )}

        {/* Доп.информация */}
        {(full.payment_terms || full.comment || full.cover_letter) && (
          <div className="appr-doc-info">
            {full.payment_terms && (
              <KV k="Условия оплаты" v={full.payment_terms} />
            )}
            {full.comment && (
              <KV k="Комментарий РП" v={full.comment} />
            )}
            {full.cover_letter && (
              <details className="mt-4">
                <summary className="appr-cover-summary">
                  Сопроводительное письмо РП
                </summary>
                <div className="appr-cover-body">
                  {full.cover_letter}
                </div>
              </details>
            )}
            {full.approval_comment && (
              <KV k="Предыдущий комментарий Ярла" v={full.approval_comment} />
            )}
          </div>
        )}

        {/* Документы + DocsPack меню (vanilla openDocsPack) */}
        {(hasDocs || showDocsBtn) && (
          <div className="mb-14">
            <div className="appr-section-eyebrow is-mb appr-docs-head">
              <span>Документы{hasDocs ? ` (${full.documents.length})` : ''}</span>
              {showDocsBtn && (
                <div className="appr-docs-pack" ref={docsBtnRef}>
                  <Btn
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setDocsMenuOpen((v) => !v)}
                    aria-haspopup="menu"
                    aria-expanded={docsMenuOpen}
                  >
                    📁 Документы ▾
                  </Btn>
                  {docsMenuOpen && (
                    <div className="appr-docs-menu" role="menu">
                      <button
                        type="button"
                        className="appr-docs-menu-item"
                        onClick={copyAllLinks}
                        disabled={!hasDocs}
                        role="menuitem"
                      >
                        📋 Скопировать все ссылки
                      </button>
                      <button
                        type="button"
                        className="appr-docs-menu-item"
                        onClick={openPurchasePage}
                        disabled={!hasPurchaseUrl}
                        role="menuitem"
                      >
                        🛒 Открыть площадку
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
            {hasDocs && (
              <div className="appr-docs-list">
                {full.documents.map((d) => (
                  <a
                    key={d.id}
                    href={`/api/files/download/${encodeURIComponent(d.filename)}`}
                    className="m-pill appr-doc-link"
                    download
                  >
                    📄 {d.original_name || d.filename || `Документ ${d.id}`}
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Лента комментариев согласования */}
        <div>
          <div className="appr-section-eyebrow is-mb">
            Лента согласования {loadingDeep ? '…' : `(${comments.length})`}
          </div>
          {comments.length === 0 ? (
            <div className="appr-thread-empty">
              {loadingDeep ? 'Загружаем…' : 'Комментариев пока нет'}
            </div>
          ) : (
            <div className="appr-thread-list">
              {comments.map((c) => (
                <div key={c.id} className="appr-thread-msg">
                  <div className="appr-thread-msg-head">
                    <strong>{c.user_name || '—'} <span className="appr-thread-action">· {c.action}</span></strong>
                    <span className="fs-11 c-t3">{fmtDateTime(c.created_at)}</span>
                  </div>
                  <div className="appr-thread-text">{c.comment}</div>
                </div>
              ))}
            </div>
          )}

          <div className="appr-thread-form">
            <div className="flex-1">
              <TextareaInput
                value={newComment}
                onChange={setNewComment}
                placeholder="Добавить комментарий (виден участникам потока)"
                minRows={2}
                maxRows={5}
              />
            </div>
            <Btn variant="ghost" disabled={!newComment.trim()} onClick={sendComment}>
              💬 Отправить
            </Btn>
          </div>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        {canDecide ? (
          <div className="appr-foot-actions">
            <Btn
              variant="success"
              disabled={busy}
              onClick={() => ask('Согласовать', 'Просчёт переходит в статус approved', 'success', approveEstimate, false)}
            >
              ✓ Согласовать
            </Btn>
            <Btn
              variant="warn"
              disabled={busy}
              onClick={() => ask('На доработку', 'РП доработает по комментарию', 'warn', reworkEstimate, true)}
            >
              🔄 Доработка
            </Btn>
            <Btn
              variant="info"
              disabled={busy}
              onClick={() => ask('Вопрос', 'Уточнение к РП без смены тендера', 'info', questionEstimate, true)}
            >
              ❓ Вопрос
            </Btn>
            <Btn
              variant="danger"
              disabled={busy}
              onClick={() => ask('Отклонить', 'Просчёт пометится как rejected', 'danger', rejectEstimate, true)}
            >
              ✗ Отклонить
            </Btn>
          </div>
        ) : (
          <span className="fs-12 c-t3">
            Решения принимают директора (DIRECTOR_GEN/DIRECTOR_COMM/DIRECTOR_DEV) или ADMIN.
          </span>
        )}
      </MFoot>
    </MCard>
  );
}

function KPI({ label, value, tone }) {
  const toneCls = {
    gold: 'appr-kpi-value--gold',
    approved: 'appr-kpi-value--ok',
    question: 'appr-kpi-value--amber',
    rejected: 'appr-kpi-value--err',
    default: 'appr-kpi-value--default'
  }[tone || 'default'];
  return (
    <div className="appr-kpi-card">
      <div className="appr-kpi-label">
        {label}
      </div>
      <div className={'appr-kpi-value ' + toneCls}>{value}</div>
    </div>
  );
}

function KV({ k, v }) {
  return (
    <div className="appr-kv">
      <span className="c-t3">{k}</span>
      <span className="appr-kv-val">{v}</span>
    </div>
  );
}

/**
 * Карточка просчёта (Quick / V2). Светофор «прибыль/чел-день».
 * Источник: vanilla approvals.js:422-477 (quickCard) и :480-516 (v2Card).
 *
 * kind: 'quick' (использует priceTKP/costPlan + people*days) | 'v2' (готовый calc)
 * calc: квинтэссенция quick_calc_json / calc_v2_json
 * estimate: full (нужны price_tkp, cost_plan, assumptions)
 * settings: app settings (vat_pct, calc.min/norm_profit_per_person_day)
 */
function CalcCard({ kind, title, calc, estimate, settings }) {
  const vatPct = Number(settings?.vat_pct ?? settings?.calc?.vat_pct ?? 22);

  // Для v2 значения уже посчитаны; для quick — считаем сами как в vanilla.
  let people, days, costTotal, priceVat, profit, profitPerDay, marginPct, fot;
  if (kind === 'v2') {
    people = Number(calc.people_count) || 0;
    days = Number(calc.work_days) || 0;
    costTotal = Number(calc.cost_total ?? estimate.cost_plan) || 0;
    priceVat = Number(calc.price_with_vat ?? estimate.price_tkp) || 0;
    profit = Number(calc.net_profit ?? (priceVat / (1 + vatPct / 100) - costTotal));
    profitPerDay = Number(calc.profit_per_day ?? (people * days > 0 ? profit / (people * days) : 0));
    marginPct = Number(calc.margin_pct ?? (priceVat > 0 ? ((priceVat / (1 + vatPct / 100) - costTotal) / (priceVat / (1 + vatPct / 100))) * 100 : 0));
    fot = Number(calc.fot_with_taxes ?? calc.fot_total ?? 0);
  } else {
    people = Number(calc.people_count) || 0;
    days = Number(calc.work_days) || 0;
    costTotal = Number(estimate.cost_plan) || 0;
    priceVat = Number(estimate.price_tkp) || 0;
    const priceNoVat = priceVat / (1 + vatPct / 100);
    profit = priceNoVat - costTotal;
    profitPerDay = people * days > 0 ? profit / (people * days) : 0;
    marginPct = priceNoVat > 0 ? (profit / priceNoVat) * 100 : 0;
    fot = Number(calc.fot_with_taxes) || 0;
  }

  const zone = profitZone(profitPerDay, settings);

  // assumptions/risks: в quick — массив или строка; в legacy — строка в estimate.assumptions
  const assumptionsList = toArr(calc.assumptions ?? estimate.assumptions);
  const risksList = toArr(calc.risks ?? estimate.risks);

  const city = calc.city || calc.location || null;
  const distance = calc.distance_km != null ? Number(calc.distance_km) : null;
  const workType = calc.work_type || null;

  return (
    <div className={'appr-calc-card appr-calc-card--' + zone.code}>
      <div className="appr-calc-head">
        <div className="appr-section-eyebrow">{title}</div>
        <span className={'appr-calc-zone appr-calc-zone--' + zone.code}>{zone.label}</span>
      </div>

      <div className="appr-calc-metrics">
        {people > 0 && (
          <CalcMetric label="Бригада" value={`${people} чел`} accent="gold" />
        )}
        {days > 0 && (
          <CalcMetric label="Дней работы" value={String(days)} accent="gold" />
        )}
        <CalcMetric label="Себестоимость" value={fmtMoney(costTotal)} />
        <CalcMetric label="Цена с НДС" value={fmtMoney(priceVat)} accent="gold" />
      </div>

      <div className={'appr-calc-zone-banner appr-calc-zone-banner--' + zone.code}>
        <div className="appr-calc-zone-label">{zone.label}</div>
        <div className="appr-calc-zone-pd">{fmtMoney(Math.round(profitPerDay))}</div>
        <div className="appr-calc-zone-cap">прибыль / чел‑день</div>
      </div>

      <div className="appr-calc-tags">
        <span className="appr-calc-tag">Маржа: <b>{marginPct.toFixed(1)}%</b></span>
        <span className="appr-calc-tag">Прибыль: <b>{fmtMoney(Math.round(profit))}</b></span>
        {fot > 0 && (
          <span className="appr-calc-tag">ФОТ+налоги: <b>{fmtMoney(Math.round(fot))}</b></span>
        )}
        {city && (
          <span className="appr-calc-tag">Город: <b>{city}</b>{distance != null ? ` (${distance} км)` : ''}</span>
        )}
        {workType && (
          <span className="appr-calc-tag">{workType}</span>
        )}
      </div>

      {assumptionsList.length > 0 && (
        <div className="appr-calc-block appr-calc-block--amber">
          <div className="appr-calc-block-head">⚠️ ДОПУЩЕНИЯ</div>
          <ul className="appr-calc-list">
            {assumptionsList.map((it, i) => (<li key={'a' + i}>{it}</li>))}
          </ul>
        </div>
      )}

      {risksList.length > 0 && (
        <div className="appr-calc-block appr-calc-block--err">
          <div className="appr-calc-block-head">🚨 РИСКИ</div>
          <ul className="appr-calc-list">
            {risksList.map((it, i) => (<li key={'r' + i}>{it}</li>))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CalcMetric({ label, value, accent }) {
  return (
    <div className="appr-calc-metric">
      <div className="appr-calc-metric-lab">{label}</div>
      <div className={'appr-calc-metric-val' + (accent === 'gold' ? ' appr-calc-metric-val--gold' : '')}>{value}</div>
    </div>
  );
}

/* assumptions/risks в БД могут быть: массивом строк, массивом объектов {text}/{name},
 * строкой (legacy: estimate.assumptions), либо null. Нормализуем в массив строк. */
function toArr(v) {
  if (v == null) return [];
  if (Array.isArray(v)) {
    return v
      .map((x) => (typeof x === 'string' ? x : (x?.text || x?.name || x?.title || '')))
      .filter(Boolean);
  }
  if (typeof v === 'string') {
    return v.split(/\n|;|•/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}
