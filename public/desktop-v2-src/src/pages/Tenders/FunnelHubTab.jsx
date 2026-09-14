/**
 * Вкладка «Воронка» — обзор для руководства (HEAD_TO / DIR / ADMIN).
 * Режим «Заявки»: Маркетплейс + 9 колонок PK3, sheet с документами.
 */
import { useMemo, useState, useEffect } from 'react';
import { useModal } from '@/modals';
import { formatMoney } from '@/lib/money';
import { loadFunnelApps } from './api';
import RegistryDetailModal from './modals/RegistryDetailModal';
import { STATUS_LEGEND, fmtRegistryDate } from './registryTabHelpers';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';

const TENDER_COLS = [
  'рассмотрение', 'готовим', 'подались', 'выиграли', 'проиграли', 'отмена'
];

const COL_TONE = {
  рассмотрение: 'review',
  готовим: 'prep',
  подались: 'submitted',
  выиграли: 'won',
  проиграли: 'lost',
  отмена: 'cancel',
  marketplace: 'marketplace',
  new: 'review',
  calc: 'prep',
  approval: 'submitted',
  kp_prep: 'prep',
  sent: 'submitted',
  addendum: 'prep',
  win: 'won',
  lose: 'lost',
  work: 'won'
};

const APP_COLS = [
  { id: 'marketplace', label: 'Маркетплейс' },
  { id: 'new', label: 'Новые' },
  { id: 'calc', label: 'Просчёт' },
  { id: 'approval', label: 'Согласование' },
  { id: 'kp_prep', label: 'Подготовка КП' },
  { id: 'sent', label: 'КП ушло' },
  { id: 'addendum', label: 'Дозапрос' },
  { id: 'win', label: 'Выиграно' },
  { id: 'lose', label: 'Проиграно' },
  { id: 'work', label: 'В работу' }
];

function periodBounds(period) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  if (period === 'month') {
    return { start: new Date(y, m, 1), end: new Date(y, m + 1, 0, 23, 59, 59, 999), label: 'Текущий месяц' };
  }
  if (period === 'ytd') {
    return { start: new Date(y, 0, 1), end: now, label: 'С начала года' };
  }
  return { start: new Date(y, 0, 1), end: new Date(y, 11, 31, 23, 59, 59, 999), label: `${y} год` };
}

function inPeriod(iso, bounds) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t >= bounds.start.getTime() && t <= bounds.end.getTime();
}

function itemDate(item) {
  return item?.event_at || item?.last_moved_at || item?.created_at || item?.won_at || item?.submitted_at || null;
}

function daysLeft(deadline) {
  if (!deadline) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dl = new Date(deadline); dl.setHours(0, 0, 0, 0);
  return Math.round((dl - today) / 86400000);
}

function authTokenQs() {
  try {
    const t = localStorage.getItem('token') || '';
    return t ? `?token=${encodeURIComponent(t)}` : '';
  } catch {
    return '';
  }
}

function FunnelCardPreview({ item, onOpen, index, mode }) {
  const isApp = mode === 'apps';
  const title = isApp
    ? (item.title || item.customer_name || `Заявка #${item.id}`)
    : (item.customer_name || item.title || 'Без названия');
  const sub = isApp
    ? [item.source_label, item.owner_name || 'не взята', item.docs_count ? `${item.docs_count} док.` : null]
        .filter(Boolean).join(' · ')
    : ((item.tender_title || item.subject || '').slice(0, 72) || '—');
  const price = isApp
    ? item.estimated_sum
    : (item.submission_price_with_vat || item.tender_price);
  const dl = isApp ? (item.deadline || item.docs_deadline) : (item.docs_deadline || item.deadline_at || item.deadline);
  const left = daysLeft(dl);
  const hot = left != null && left >= 0 && left <= 3;

  return (
    <button
      type="button"
      className={'hub-funnel-card' + (hot ? ' is-hot' : '')}
      style={{ animationDelay: `${Math.min(index, 12) * 28}ms` }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onOpen(item);
      }}
    >
      <div className="hub-funnel-card-top">
        <span className="hub-funnel-card-id">#{item.registry_no || item.id}</span>
        {hot && <span className="hub-funnel-hot">🔥 {left}д</span>}
      </div>
      <div className="hub-funnel-card-title">{title}</div>
      <div className="hub-funnel-card-sub">{sub}</div>
      <div className="hub-funnel-card-meta">
        <span>{fmtRegistryDate(dl || itemDate(item))}</span>
        <span className="hub-funnel-card-price">{price ? formatMoney(price) : '—'}</span>
      </div>
    </button>
  );
}

function AppDetailSheet({ item, onClose }) {
  const docs = Array.isArray(item.documents) ? item.documents : [];
  const qs = authTokenQs();
  const openLabel = item.source_bucket === 'marketplace' ? 'Открыть в маркетплейсе' : 'Открыть в канбане';

  return (
    <MCard className="modal-md">
      <MHead title={item.title || item.customer_name || 'Заявка'} subtitle={`#${item.id}`} onClose={onClose} />
      <MBody>
        <p className="hub-funnel-sheet-text">{item.work_description || item.work_title || '—'}</p>
        <div className="hub-funnel-kv">
          <span>Заказчик</span><b>{item.customer_name || '—'}</b>
          <span>ИНН</span><b>{item.customer_inn || '—'}</b>
          <span>Контакт</span>
          <b>{[item.contact_person, item.contact_phone].filter(Boolean).join(' · ') || '—'}</b>
          <span>Статус</span><b>{item.status || item.funnel_column || '—'}</b>
          <span>Источник</span><b>{item.source_label || item.kind || '—'}</b>
          <span>РП</span><b>{item.owner_name || 'не взята'}</b>
          <span>Дедлайн</span><b>{fmtRegistryDate(item.deadline)}</b>
          <span>Создана</span><b>{fmtRegistryDate(item.created_at || item.event_at)}</b>
        </div>
        <div className="hub-funnel-sheet-docs-h" style={{ marginTop: 14, marginBottom: 8, fontWeight: 700, fontSize: 13 }}>
          Документы ({docs.length})
        </div>
        {docs.length ? (
          <ul className="hub-funnel-docs">
            {docs.map((d, i) => (
              <li key={`${d.kind || 'd'}-${d.id ?? i}`}>
                <a
                  href={(d.download_url || '#') + (d.download_url ? qs : '')}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  {d.filename || `Документ ${i + 1}`}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <div className="muted" style={{ fontSize: 12 }}>Документов нет</div>
        )}
      </MBody>
      <MFoot>
        {item.open_hash && (
          <Btn
            variant="ghost"
            onClick={() => {
              window.location.hash = item.open_hash;
              onClose();
            }}
          >
            {openLabel}
          </Btn>
        )}
        <Btn onClick={onClose}>Закрыть</Btn>
      </MFoot>
    </MCard>
  );
}

function AnalyticChip({ label, value, tone }) {
  return (
    <div className={'hub-funnel-chip' + (tone ? ` tone-${tone}` : '')}>
      <span className="hub-funnel-chip-l">{label}</span>
      <span className="hub-funnel-chip-v">{value}</span>
    </div>
  );
}

export default function FunnelHubTab({ tenders = [], onRefresh }) {
  const modal = useModal();
  const [mode, setMode] = useState('tenders');
  const [period, setPeriod] = useState('month');
  const [marketplace, setMarketplace] = useState([]);
  const [kanban, setKanban] = useState([]);
  const [loadingApps, setLoadingApps] = useState(true);
  const [bump, setBump] = useState(0);
  const bounds = useMemo(() => periodBounds(period), [period]);

  useEffect(() => {
    setLoadingApps(true);
    loadFunnelApps()
      .then((d) => {
        setMarketplace(d.marketplace || []);
        setKanban(d.kanban || []);
      })
      .catch(() => {
        setMarketplace([]);
        setKanban([]);
      })
      .finally(() => setLoadingApps(false));
  }, [bump]);

  const refreshAll = () => {
    setBump((n) => n + 1);
    onRefresh?.();
  };

  const filteredTenders = useMemo(
    () => tenders.filter((t) => inPeriod(itemDate(t), bounds) || inPeriod(t.won_at, bounds) || inPeriod(t.submitted_at, bounds)),
    [tenders, bounds]
  );

  const filteredApps = useMemo(() => {
    const mp = marketplace || [];
    const kb = (kanban || []).filter((a) => inPeriod(itemDate(a), bounds));
    return mp.concat(kb);
  }, [marketplace, kanban, bounds]);

  const columns = useMemo(() => {
    if (mode === 'tenders') {
      const map = Object.fromEntries(TENDER_COLS.map((c) => [c, []]));
      for (const t of filteredTenders) {
        const st = t.registry_status || 'рассмотрение';
        (map[st] || map.рассмотрение).push(t);
      }
      return TENDER_COLS.map((id) => ({
        id,
        label: STATUS_LEGEND.find((s) => s.value === id)?.label || id,
        tone: COL_TONE[id],
        items: map[id] || []
      }));
    }
    const map = Object.fromEntries(APP_COLS.map((c) => [c.id, []]));
    for (const a of filteredApps) {
      const col = map[a.funnel_column] ? a.funnel_column : 'new';
      map[col].push(a);
    }
    return APP_COLS.map((c) => ({ ...c, tone: COL_TONE[c.id], items: map[c.id] || [] }));
  }, [mode, filteredTenders, filteredApps]);

  const analytics = useMemo(() => {
    if (mode === 'apps') {
      const apps = filteredApps;
      const mp = apps.filter((a) => a.funnel_column === 'marketplace').length;
      const inWork = apps.filter((a) => a.funnel_column !== 'marketplace').length;
      const calc = apps.filter((a) => a.funnel_column === 'calc').length;
      const sent = apps.filter((a) => a.funnel_column === 'sent').length;
      const win = apps.filter((a) => a.funnel_column === 'win').length;
      const lose = apps.filter((a) => a.funnel_column === 'lose').length;
      const burn = apps.filter((a) => {
        const left = daysLeft(a.deadline);
        return left != null && left >= 0 && left <= 3;
      }).length;
      const byPm = {};
      for (const a of apps) {
        if (!a.owner_name) continue;
        byPm[a.owner_name] = (byPm[a.owner_name] || 0) + 1;
      }
      const topPm = Object.entries(byPm).sort((a, b) => b[1] - a[1]).slice(0, 3);
      return { mode: 'apps', mp, inWork, calc, sent, win, lose, burn, topPm };
    }

    const list = filteredTenders;
    const pipeline = list.filter((t) => ['рассмотрение', 'готовим', 'подались'].includes(t.registry_status)).length;
    const submitted = list.filter((t) => t.registry_status === 'подались');
    const won = list.filter((t) => t.registry_status === 'выиграли' || t.tender_status === 'Выиграли');
    const lost = list.filter((t) => t.registry_status === 'проиграли' || t.tender_status === 'Проиграли');
    const burn = list.filter((t) => {
      if (['отмена', 'выиграли', 'проиграли'].includes(t.registry_status)) return false;
      const left = daysLeft(t.docs_deadline);
      return left != null && left >= 0 && left <= 3;
    }).length;
    const subSum = submitted.reduce((s, t) => s + (Number(t.submission_price_with_vat) || 0), 0);
    const convN = won.length + lost.length;
    const winPct = convN ? Math.round((won.length / convN) * 100) : null;
    const byTo = {};
    for (const t of submitted) {
      const name = t.created_by_name || '—';
      byTo[name] = (byTo[name] || 0) + 1;
    }
    const topTo = Object.entries(byTo).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const avgSub = submitted.length ? Math.round(subSum / submitted.length) : 0;
    return {
      mode: 'tenders',
      pipeline, submitted: submitted.length, won: won.length, lost: lost.length,
      burn, subSum, winPct, topTo, avgSub
    };
  }, [mode, filteredTenders, filteredApps]);

  const openItem = (item) => {
    if (mode === 'apps' || item.source_bucket === 'marketplace' || item.source_bucket === 'kanban') {
      modal.open(({ close }) => <AppDetailSheet item={item} onClose={close} />);
      return;
    }
    if (item.id) {
      modal.open(({ close }) => (
        <RegistryDetailModal row={item} onClose={close} onRefresh={refreshAll} />
      ));
    }
  };

  const totalVisible = mode === 'tenders' ? filteredTenders.length : filteredApps.length;

  return (
    <div className="hub-funnel">
      <div className="hub-funnel-toolbar">
        <div className="hub-funnel-seg" role="tablist" aria-label="Тип воронки">
          <button type="button" role="tab" aria-selected={mode === 'tenders'} className={mode === 'tenders' ? 'on' : ''} onClick={() => setMode('tenders')}>
            Тендеры
            <span className="hub-funnel-seg-n">{filteredTenders.length}</span>
          </button>
          <button type="button" role="tab" aria-selected={mode === 'apps'} className={mode === 'apps' ? 'on' : ''} onClick={() => setMode('apps')}>
            Заявки
            <span className="hub-funnel-seg-n">{filteredApps.length}</span>
          </button>
        </div>

        <div className="hub-funnel-period" role="group" aria-label="Период">
          {[
            { id: 'month', label: 'Месяц' },
            { id: 'ytd', label: 'С начала года' },
            { id: 'year', label: 'Год' }
          ].map((p) => (
            <button
              key={p.id}
              type="button"
              className={period === p.id ? 'on' : ''}
              onClick={() => setPeriod(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="hub-funnel-analytics" aria-label="Сводка">
        {analytics.mode === 'apps' ? (
          <>
            <AnalyticChip label="Маркетплейс" value={analytics.mp} />
            <AnalyticChip label="В работе у РП" value={analytics.inWork} tone="info" />
            <AnalyticChip label="На просчёте" value={analytics.calc} />
            <AnalyticChip label="КП ушло" value={analytics.sent} tone="info" />
            <AnalyticChip label="Выиграно" value={analytics.win} tone="ok" />
            <AnalyticChip label="Проиграно" value={analytics.lose} tone="err" />
            <AnalyticChip label="Горящие ≤3д" value={analytics.burn} tone="err" />
            {analytics.topPm[0] && (
              <AnalyticChip
                label="Топ РП"
                value={analytics.topPm.map(([n, c]) => `${n.split(' ')[0]} (${c})`).join(' · ')}
                tone="gold"
              />
            )}
          </>
        ) : (
          <>
            <AnalyticChip label="Пайплайн" value={analytics.pipeline} />
            <AnalyticChip label="Подались" value={analytics.submitted} tone="info" />
            <AnalyticChip label="Выиграно" value={analytics.won} tone="ok" />
            <AnalyticChip label="Проиграно" value={analytics.lost} tone="err" />
            <AnalyticChip label="Конверсия" value={analytics.winPct != null ? `${analytics.winPct}%` : '—'} tone="gold" />
            <AnalyticChip label="Горящие ≤3д" value={analytics.burn} tone="err" />
            <AnalyticChip label="Сумма подач" value={formatMoney(analytics.subSum)} tone="gold" />
            <AnalyticChip label="Средняя подача" value={formatMoney(analytics.avgSub)} />
            {analytics.topTo[0] && (
              <AnalyticChip
                label="Топ ТО"
                value={analytics.topTo.map(([n, c]) => `${n.split(' ')[0]} (${c})`).join(' · ')}
              />
            )}
          </>
        )}
      </div>

      <div className={'hub-funnel-board mode-' + mode + (mode === 'apps' && loadingApps ? ' is-loading' : '')}>
        {columns.map((col) => (
          <div key={col.id} className={'hub-funnel-col tone-' + (col.tone || 'cancel')}>
            <div className="hub-funnel-col-h">
              <span className="hub-funnel-col-title">{col.label}</span>
              <span className="hub-funnel-col-n">{loadingApps && mode === 'apps' ? '…' : col.items.length}</span>
            </div>
            <div className="hub-funnel-col-body">
              {mode === 'apps' && loadingApps ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="hub-funnel-skel" />
                ))
              ) : (
                <>
                  {col.items.slice(0, 40).map((item, i) => (
                    <FunnelCardPreview
                      key={`${item.source_bucket || item.kind || 't'}-${item.card_id || item.id}`}
                      item={item}
                      index={i}
                      mode={mode}
                      onOpen={openItem}
                    />
                  ))}
                  {!col.items.length && (
                    <div className="hub-funnel-empty">Пусто за период</div>
                  )}
                  {col.items.length > 40 && (
                    <div className="hub-funnel-more">ещё {col.items.length - 40}</div>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {!totalVisible && !loadingApps && (
        <div className="hub-funnel-zero">
          <div className="hub-funnel-zero-ic" aria-hidden>⌁</div>
          <div>За {bounds.label.toLowerCase()} записей нет</div>
          <div className="muted" style={{ fontSize: 12 }}>Смените период или переключатель выше</div>
        </div>
      )}
    </div>
  );
}
