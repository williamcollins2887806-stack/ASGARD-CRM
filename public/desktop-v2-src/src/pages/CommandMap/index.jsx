/**
 * Страница /command-map — Живая карта директора.
 * Источник: vanilla `public/assets/js/command-map.js` (~374 строки).
 *
 *   ✅ index.jsx           — корень + 5 секций (карта · live · рейсы · сводка · объекты)
 *   ✅ api.js              — endpoints + fmt
 *   ✅ MapStage.jsx        — SVG-карта (без PIXI) с хабом, объектами, рейсами в движении
 *   ✅ command-map.css     — стили
 *
 * RBAC: ADMIN + DIRECTOR_* + HEAD_PM/TO.
 */
import { useState, useEffect } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';

import {
  ALLOWED_ROLES,
  cmapMap, cmapFlights, cmapLive, cmapSummary,
  cmapMedical, cmapPresenceBoard, openLiveStream,
  fmtMln, fmtDT
} from './api';
import { MapStage } from './MapStage';
import './command-map.css';

export default function CommandMapPage() {
  const { user, ready } = useAuth();
  const modal = useModal();

  const [mapData, setMapData] = useState(null);
  const [flights, setFlights] = useState([]);
  const [live, setLive] = useState(null);
  const [summary, setSummary] = useState(null);
  const [medical, setMedical] = useState(null);
  const [presenceBoard, setPresenceBoard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sumTab, setSumTab] = useState('fin');

  const refresh = () => {
    setLoading(true);
    Promise.all([
      cmapMap().catch(() => null),
      cmapFlights().catch(() => null),
      cmapLive().catch(() => null),
      cmapSummary().catch(() => null),
      cmapMedical().catch(() => null),
      cmapPresenceBoard().catch(() => null)
    ])
      .then(([m, f, l, s, med, pb]) => {
        setMapData(m);
        setFlights((f && f.flights) || []);
        setLive(l);
        setSummary(s);
        setMedical(med);
        setPresenceBoard(pb);
      })
      .finally(() => setLoading(false));
  };

  const refreshLive = () => { cmapLive().then(setLive).catch(() => {}); };

  useEffect(() => {
    if (!ready) return;
    if (!user) return;
    if (!ALLOWED_ROLES.includes(user.role)) {
      toast.error('Раздел для директоров');
      window.location.hash = '#/home';
      return;
    }
    refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user?.id]);

  // Авто-обновление live-секции каждые 45 секунд + SSE-поток
  useEffect(() => {
    if (!ready || !user || !ALLOWED_ROLES.includes(user.role)) return;
    const t = setInterval(refreshLive, 45000);
    // E-6b: SSE presence-стрим (vanilla command-map.js:306).
    // 2-й аргумент — snapshot-refresh после реконнекта (восстанавливает
    // карту/рейсы/сводку, могли пропустить события во время разрыва).
    const es = openLiveStream(refreshLive, refresh);
    return () => {
      clearInterval(t);
      if (es) { try { es.close(); } catch (_) { /* noop */ } }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user?.id]);

  const openSite = (s) => {
    modal.open(<SiteModal site={s} />, { size: 'wide' });
  };
  const openFlight = (f) => {
    modal.open(<FlightModal flight={f} />, { size: 'wide' });
  };

  if (!ready || !user) {
    return <div className="p-24 c-t3">⏳ Загружаем…</div>;
  }

  const sites = (mapData && mapData.sites) || [];
  const liveSum = live?.summary || {};
  const peopleSorted = (live?.people || [])
    .slice()
    .sort((a, b) => (b.online - a.online) || (!!b.status_code - !!a.status_code) || a.name.localeCompare(b.name));

  return (
    <div className="cmap-wrap">
      <TopActionsBar
        kicker="Карта"
        title="Карта команд"
        subtitle="Объекты · рейсы вахты · офис · сводка года"
        actions={<Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>}
      />

      <div className="cmap-panel card-pad-overflow">
        {loading ? (
          <div className="cmap-stage"><div className="cmap-hint">⏳ Загружаем карту…</div></div>
        ) : (
          <MapStage sites={sites} flights={flights} onSite={openSite} onFlight={openFlight} />
        )}
      </div>

      <div className="cmap-panel">
        <div className="cmap-sec">
          🟢 Офис сейчас · онлайн {liveSum.online || 0} из {liveSum.total || 0}
          {liveSum.on_call ? ` · на звонке ${liveSum.on_call}` : ''}
        </div>
        {peopleSorted.length === 0 ? (
          <EmptyState
            icon="🟢"
            title="В офисе никого нет онлайн"
            hint="Данные появятся, как только сотрудники начнут активность в системе."
          />
        ) : (
          <div className="cmap-live">
            {peopleSorted.map((p) => {
              const dot = p.on_call ? 'var(--amber)' : p.online ? 'var(--ok)' : 'var(--t-4)';
              const doing = p.on_call ? '📞 на звонке' : (p.status_label || (p.online ? 'онлайн' : '—'));
              const work = p.work ? ` · ${p.work.title}` : '';
              return (
                <div key={p.id || p.name} className="cmap-live-row">
                  <span className="cmap-live-dot" style={{ background: dot }} />
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <b>{p.name}</b> <span style={{ opacity: 0.5, fontSize: 11 }}>{p.role || ''}</span>
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--t-3)', whiteSpace: 'nowrap' }}>{doing}{work}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* E-6b: Медкарты — рабочие на медосмотре перед вылетом (vanilla cmap-medical) */}
      {medical && Array.isArray(medical.workers) && medical.workers.length > 0 && (
        <div className="cmap-panel">
          <div className="cmap-sec">🏥 Медосмотр (перед вылетом)</div>
          <div className="cmap-live">
            {medical.workers.slice(0, 30).map((w) => {
              const isOk = w.medical_status === 'ok' || w.medical_pass_to;
              const dot = isOk ? 'var(--ok)' : 'var(--amber)';
              return (
                <div key={w.id || w.fio} className="cmap-live-row">
                  <span className="cmap-live-dot" style={{ background: dot }} />
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <b>{w.fio || w.name}</b>
                    {w.position && <span style={{ opacity: 0.5, fontSize: 11 }}> · {w.position}</span>}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--t-3)', whiteSpace: 'nowrap' }}>
                    {w.medical_pass_to ? `до ${fmtDT(w.medical_pass_to)}` : (w.medical_status_label || w.medical_status || '—')}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* E-6b: Табель присутствия офиса /api/daily-presence/board (vanilla cmap-presence-board) */}
      {presenceBoard && Array.isArray(presenceBoard.people || presenceBoard.items || presenceBoard.rows) && (
        (() => {
          const rows = presenceBoard.people || presenceBoard.items || presenceBoard.rows;
          if (!rows.length) return null;
          return (
            <div className="cmap-panel">
              <div className="cmap-sec">📋 Табель присутствия</div>
              <div className="cmap-live">
                {rows.slice(0, 40).map((p) => {
                  const status = p.status || p.presence_status || (p.is_present ? 'present' : 'absent');
                  const dot = status === 'present' || status === 'office' ? 'var(--ok)'
                            : status === 'remote' ? 'var(--info, #4682e0)'
                            : status === 'vacation' || status === 'sick' ? 'var(--amber)'
                            : 'var(--t-4)';
                  const label = p.status_label || p.label || status || '—';
                  return (
                    <div key={p.user_id || p.id || p.fio} className="cmap-live-row">
                      <span className="cmap-live-dot" style={{ background: dot }} />
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <b>{p.fio || p.name || p.full_name}</b>
                        {p.role && <span style={{ opacity: 0.5, fontSize: 11 }}> · {p.role}</span>}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--t-3)', whiteSpace: 'nowrap' }}>{label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()
      )}

      <div className="cmap-panel">
        <div className="cmap-sec">🛫 Рейсы вахты (ближайшие)</div>
        {flights.length === 0 ? (
          <EmptyState
            icon="🛫"
            title="Нет ближайших рейсов"
            hint="Добавьте билеты сотрудникам в «Логистике» с датой и временем вылета/прилёта."
          />
        ) : (
          <div className="cmap-flights">
            {flights.slice(0, 40).map((f) => (
              <div
                key={f.id}
                className="cmap-frow"
                onClick={() => openFlight(f)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFlight(f); } }}
                role="button"
                tabIndex={0}
                aria-label={`Рейс ${f.transport_no || '(без номера)'}`}
              >
                <span>{f.item_type === 'train' ? '🚂' : f.item_type === 'transfer' ? '🚌' : '✈'}</span>
                {f.transport_no && <b>{f.transport_no}</b>}
                <span>{f.dir === 'home' ? '← домой' : `→ ${f.site ? f.site.name : 'объект'}`}</span>
                <span style={{ marginLeft: 'auto', color: 'var(--t-3)', fontSize: 12 }}>
                  вылет {fmtDT(f.departAt)} · прилёт {fmtDT(f.arriveAt)}
                  {f.employee ? ' · ' + f.employee.fio : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="cmap-panel">
        <div className="cmap-sec">📊 Сводка года</div>
        {!summary ? (
          <EmptyState
            icon="📊"
            title="Сводка недоступна"
            hint="Возможно, нет данных за выбранный период или endpoint недоступен."
          />
        ) : (
          <SummarySection summary={summary} sumTab={sumTab} setSumTab={setSumTab} />
        )}
      </div>

      <div className="cmap-panel">
        <div className="cmap-sec">🏗 Объекты</div>
        {sites.length === 0 ? (
          <EmptyState
            icon="🏗"
            title="Объектов пока нет"
            hint="Создайте объект в справочнике и привяжите работы — он появится на карте."
          />
        ) : (
          <div className="cmap-grid">
            {sites.map((s) => {
              const wk = s.crew ? s.crew.workers + s.crew.masters : 0;
              return (
                <div
                  key={s.id}
                  className="cmap-card"
                  onClick={() => openSite(s)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSite(s); } }}
                  role="button"
                  tabIndex={0}
                  aria-label={`Объект ${s.name || '#' + s.id}`}
                >
                  <div className="nm">
                    {s.site_type === 'platform' ? '🛢 ' : s.site_type === 'plant' ? '🏭 ' : '🏗 '}
                    {s.name || ('Объект #' + s.id)}
                  </div>
                  <div className="meta">
                    <span>работ: {s.works ? s.works.length : 0}</span>
                    <span>👷 {wk}</span>
                    <span>🟢 на смене {s.crew ? s.crew.onShift : 0}</span>
                    {s.lat == null && <span className="c-amber">⚠ нет координат</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const SUM_TABS = [
  ['fin',  '💰 Финансы'],
  ['cash', '🏦 Деньги'],
  ['se',   '📄 Самозанятые'],
  ['tn',   '📜 Тендеры'],
  ['ppl',  '👥 Люди']
];

function SummarySection({ summary, sumTab, setSumTab }) {
  return (
    <>
      <div className="cmap-tabs">
        {SUM_TABS.map(([k, l]) => (
          <button key={k} className={'cmap-tab ' + (sumTab === k ? 'on' : '')} onClick={() => setSumTab(k)}>{l}</button>
        ))}
      </div>
      <SummaryBody D={summary} sumTab={sumTab} />
    </>
  );
}

function Hcard({ cap, big, sm }) {
  return (
    <div className="cmap-hcard">
      <div className="cap">{cap}</div>
      <div className="big">{big}</div>
      {sm && <div className="sm">{sm}</div>}
    </div>
  );
}

function SummaryBody({ D, sumTab }) {
  if (!D) return null;
  if (sumTab === 'fin') {
    const p = D.pnl || {};
    return (
      <div className="cmap-hero">
        <Hcard cap="Выручка"      big={fmtMln(p.revenue)} sm={`проектов ${p.projects ?? '—'}`} />
        <Hcard cap="Валовая"      big={fmtMln(p.gross)}   sm={`рент. ${p.grossPct ?? '—'}%`} />
        <Hcard cap="Себест. план" big={fmtMln(p.costPlan)} />
        <Hcard cap="Себест. факт" big={fmtMln(p.costFact)} />
      </div>
    );
  }
  if (sumTab === 'cash') {
    const c = D.cash || {};
    return (
      <div className="cmap-hero">
        <Hcard cap="Получено"  big={fmtMln(c.received)} />
        <Hcard cap="Дебиторка" big={fmtMln(c.receivable)} sm={`просрочка ${fmtMln(c.overdue)}`} />
        <Hcard cap="Авансы"    big={fmtMln(c.advances)} />
      </div>
    );
  }
  if (sumTab === 'se') {
    const s = D.selfEmployed || {};
    return (
      <>
        <div className="cmap-hero">
          <Hcard cap="Самозанятых"   big={s.count ?? '—'} />
          <Hcard cap="Лимит года"    big={fmtMln(s.yearLimit)} sm={`${s.count ?? '—'} × ${fmtMln(s.perLimit)}`} />
          <Hcard cap="Израсходовано" big={fmtMln(s.used)}    sm={`${s.utilPct ?? '—'}%`} />
          <Hcard cap="Остаток"       big={fmtMln(s.left)} />
        </div>
        {Array.isArray(s.top) && s.top.length > 0 && (
          <>
            <div className="cmap-sec mt-16" >Топ по расходу</div>
            {s.top.map((t, i) => (
              <div key={i} className="cmap-frow read">
                <span>{t.fio} — <b>{fmtMln(t.used)}</b></span>
              </div>
            ))}
          </>
        )}
      </>
    );
  }
  if (sumTab === 'tn') {
    const t = D.tenders || {};
    return (
      <div className="cmap-hero">
        <Hcard cap="Подано"       big={t.submitted ?? '—'} sm={`выигр ${t.won ?? 0} · проигр ${t.lost ?? 0}`} />
        <Hcard cap="Конверсия"    big={(t.conv ?? '—') + '%'} />
        <Hcard cap="Активных"     big={t.active ?? '—'} />
        <Hcard cap="Сумма выигр." big={fmtMln(t.wonSum)} />
      </div>
    );
  }
  const pp = D.people || {};
  return (
    <div className="cmap-hero">
      <Hcard cap="Численность" big={pp.headcount ?? '—'} />
      <Hcard cap="Самозанятых" big={pp.selfEmp ?? '—'} />
      <Hcard cap="На смене"    big={pp.onShift ?? '—'} />
    </div>
  );
}

function SiteModal({ site }) {
  const { close } = useModal();
  return (
    <MCard>
      <MHead icon="🏗" title={site.name || ('Объект #' + site.id)} subtitle={site.region || site.customer_name || ''} onClose={() => close()} />
      <MBody>
        <div className="cmap-hero mb-12" >
          <Hcard cap="Рабочих"   big={(site.crew ? site.crew.workers : 0)} />
          <Hcard cap="Мастеров"  big={(site.crew ? site.crew.masters : 0)} />
          <Hcard cap="На смене"  big={(site.crew ? site.crew.onShift : 0)} />
        </div>
        <div className="cmap-sec">Работы на объекте</div>
        {site.works && site.works.length > 0 ? (
          site.works.map((w) => (
            <div key={w.id} className="cmap-frow read">
              <div>
                <b>{w.work_title}</b>
                <div className="meta">
                  <span>{w.work_status}</span>
                  {w.pm_name && <span> · РП {w.pm_name}</span>}
                  <span> · 👷 {w.workers + w.masters} · 🟢 {w.on_shift}</span>
                </div>
              </div>
            </div>
          ))
        ) : (
          <EmptyState
            icon="📋"
            title="Нет активных работ"
            hint="Объект создаётся из работ — привяжите работу к этому объекту (site_id)."
          />
        )}
      </MBody>
      <MFoot align="end">
        <Btn variant="primary" onClick={() => close()}>Закрыть</Btn>
      </MFoot>
    </MCard>
  );
}

function FlightModal({ flight: f }) {
  const { close } = useModal();
  return (
    <MCard>
      <MHead icon={f.item_type === 'train' ? '🚂' : '✈'}
        title={f.item_type === 'train' ? 'Поезд' : 'Рейс'}
        subtitle={f.transport_no || ''}
        onClose={() => close()} />
      <MBody>
        <div className="cmap-hero mb-12" >
          <Hcard cap="Вылет"        big={fmtDT(f.departAt)} />
          <Hcard cap="Прилёт"       big={fmtDT(f.arriveAt)} />
          <Hcard cap="Направление"  big={f.dir === 'home' ? '← домой' : '→ объект'} />
        </div>
        <div className="cmap-sec">Рейс</div>
        <div className="cmap-frow read">
          <div>
            {f.transport_no ? <b>{f.transport_no}</b> : ''}{f.transport_no ? ' · ' : ''}{f.title || ''}
            {f.site && <div className="meta">Объект: {f.site.name}</div>}
            {f.employee && <div className="meta">Сотрудник: {f.employee.fio}</div>}
          </div>
        </div>
      </MBody>
      <MFoot align="end">
        <Btn variant="primary" onClick={() => close()}>Закрыть</Btn>
      </MFoot>
    </MCard>
  );
}
