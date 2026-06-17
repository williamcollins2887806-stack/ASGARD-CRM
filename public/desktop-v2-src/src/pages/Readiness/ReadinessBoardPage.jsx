/**
 * /readiness-board — Сводка готовности по руководителям проектов (для директоров и ADMIN/HEAD_PM).
 *
 * 🔴 — есть «горящие» (готовность <60% И старт ≤14 дн)
 * 🟡 — средняя <70%
 * 🟢 — всё по плану
 *
 * Клик по строке РП → drawer со списком его проектов с кольцами + далее в детали этапов.
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal, DrawerModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import { SearchInput } from '@/inputs/Inputs';
import Ring from './Ring';
import StageDrawer from './StageDrawer';
import {
  loadWorks, loadSummary, loadPMs,
  isPrep, isClosed, daysLeft, readyColor, trafficLight,
  DIRECTOR_PAGE_ROLES
} from './api';
import './readiness.css';

export default function ReadinessBoardPage() {
  const { user } = useAuth();
  const modal = useModal();

  const [works, setWorks]     = useState([]);
  const [summary, setSummary] = useState({});
  const [pms, setPms]         = useState([]);
  const [q, setQ]             = useState('');
  const [loading, setLoading] = useState(true);
  const [denied, setDenied]   = useState(false);

  const refresh = () => {
    if (!user) return;
    if (!DIRECTOR_PAGE_ROLES.includes(user.role)) {
      setDenied(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all([loadWorks({ my: false }), loadPMs()])
      .then(async ([list, pmList]) => {
        const prep = (list || []).filter((w) => !isClosed(w.work_status) && isPrep(w.work_status));
        setWorks(prep);
        setPms(pmList || []);
        if (!prep.length) return setSummary({});
        const sum = await loadSummary(prep.map((w) => w.id));
        setSummary(sum || {});
      })
      .catch((e) => {
        toast.error('Не удалось загрузить сводку: ' + (e?.message || e));
        setWorks([]); setSummary({}); setPms([]);
      })
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, [user?.id, user?.role]);

  // Группировка работ по pm_id
  const rows = useMemo(() => {
    const pmsById = new Map((pms || []).map((u) => [u.id, u]));
    const byPm = new Map();
    for (const w of works) {
      if (!w.pm_id) continue;
      if (!byPm.has(w.pm_id)) byPm.set(w.pm_id, []);
      byPm.get(w.pm_id).push(w);
    }
    const out = [];
    for (const [pmId, list] of byPm) {
      let sumPct = 0, count = 0, hot = 0;
      for (const w of list) {
        const s = summary[w.id];
        if (!s) continue;
        sumPct += s.overall_percent || 0;
        count++;
        const dl = daysLeft(s.start_plan || w.start_plan);
        if ((s.overall_percent || 0) < 60 && dl != null && dl <= 14) hot++;
      }
      const pm = pmsById.get(pmId);
      out.push({
        pmId,
        name: pm?.name || pm?.login || `РП #${pmId}`,
        worksCount: list.length,
        avg: count ? Math.round(sumPct / count) : 0,
        hot,
        list
      });
    }
    out.sort((a, b) => a.avg - b.avg);
    return out;
  }, [works, summary, pms]);

  const visibleRows = useMemo(() => {
    const norm = q.trim().toLowerCase();
    if (!norm) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(norm));
  }, [rows, q]);

  const stats = useMemo(() => {
    if (!rows.length) return { avg: 0, hot: 0, totalWorks: 0, totalPms: 0 };
    const totalWorks = rows.reduce((a, r) => a + r.worksCount, 0);
    const hot = rows.reduce((a, r) => a + r.hot, 0);
    const avg = Math.round(rows.reduce((a, r) => a + r.avg, 0) / rows.length);
    return { avg, hot, totalWorks, totalPms: rows.length };
  }, [rows]);

  const openPm = (row) => {
    modal.open(<PmDrillDrawer row={row} summary={summary} user={user} />);
  };

  if (denied) {
    return (
      <EmptyState
        icon="🛡️"
        title="Раздел доступен только руководителям"
        hint="Если у вас должен быть доступ к сводке по РП — обратитесь к администратору."
        action={null}
      />
    );
  }

  return (
    <div className="col gap-14">
      <TopActionsBar
        kicker="Готовность"
        title="Сводка готовности по РП"
        subtitle="🔴 — есть горящие (<60% и старт ≤14 дн); 🟡 — средняя <70%; 🟢 — всё по плану. Нажмите на РП — увидите его проекты."
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            <Btn onClick={() => { window.location.hash = '#/readiness'; }}>📋 Все проекты в подготовке</Btn>
          </>
        }
      />

      {loading ? (
        <div className="card card-empty" >
          ⏳ Считаем готовность…
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon="🎉"
          title="Нет проектов в подготовке"
          hint="Как только РП начнут готовить проекты — они появятся в сводке."
          action={null}
        />
      ) : (
        <>
          <div className="rdy-hero">
            <Ring value={stats.avg} size={96} />
            <div className="flex-1">
              <div className="rdy-hero-val" style={{ color: readyColor(stats.avg) }}>{stats.avg}%</div>
              <div className="rdy-hero-sub">
                Средняя по компании · {stats.totalWorks} проектов · {stats.totalPms} РП
                {stats.hot > 0 && (
                  <> · <span className="rdy-hero-hot">🔥 {stats.hot} горящих</span></>
                )}
              </div>
            </div>
          </div>

          <div className="rdy-toolbar">
            <SearchInput value={q} onChange={setQ} placeholder="Поиск по ФИО РП…" />
          </div>

          {visibleRows.length === 0 ? (
            <EmptyState icon="🔍" title="Никого не нашли" hint="Попробуйте другой запрос." action={null} />
          ) : (
            <div className="rdy-pm-list">
              {visibleRows.map((r) => (
                <PmRow key={r.pmId} row={r} onOpen={() => openPm(r)} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PmRow({ row, onOpen }) {
  const light = trafficLight(row.avg, row.hot);
  return (
    <button
      type="button"
      className="rdy-pm-row"
      style={{ borderLeftColor: row.hot > 0 ? 'var(--err)' : row.avg < 70 ? 'var(--amber)' : 'var(--ok)' }}
      onClick={onOpen}
    >
      <Ring value={row.avg} size={48} />
      <div className="rdy-pm-body">
        <div className="rdy-pm-name">
          <span className="rdy-pm-light">{light}</span> {row.name}
        </div>
        <div className="rdy-pm-meta">
          <span>{row.worksCount} {plural(row.worksCount, ['работа', 'работы', 'работ'])} в подготовке</span>
          {row.hot > 0 && (
            <span className="rdy-pm-hot">🔥 {row.hot} {plural(row.hot, ['горящая', 'горящих', 'горящих'])}</span>
          )}
        </div>
      </div>
      <span className="c-t3 fs-12">→ проекты</span>
    </button>
  );
}

function PmDrillDrawer({ row, summary, user }) {
  const { close, open } = useModal();
  return (
    <DrawerModal
      title={`Проекты: ${row.name}`}
      subtitle={`${row.worksCount} в подготовке · средняя готовность ${row.avg}%`}
      icon="👁"
      accent={row.hot > 0 ? 'danger' : row.avg < 70 ? 'warn' : 'success'}
      onClose={close}
    >
      <div className="rdy-grid mt-0" >
        {row.list.map((w) => {
          const s = summary[w.id] || {};
          const dl = daysLeft(s.start_plan || w.start_plan);
          const isHot = (s.overall_percent || 0) < 60 && dl != null && dl <= 14;
          return (
            <button
              key={w.id}
              type="button"
              className={'rdy-card ' + (isHot ? 'is-hot' : '')}
              onClick={() => { close(); open(<StageDrawer workId={w.id} currentUser={user} />); }}
            >
              <Ring value={s.overall_percent || 0} size={56} />
              <div className="rdy-card-body">
                <div className="rdy-card-ttl">{w.work_title || `Работа #${w.id}`}</div>
                <div className="rdy-card-sub">
                  {w.customer_name || 'Без заказчика'} · {w.work_status || '—'}
                </div>
                <div className="rdy-card-meta">
                  <span>{s.stages_done || 0}/{s.stages_total || 0} этапов</span>
                  {s.blocker_label && <span className="rdy-card-blk">⚠ {s.blocker_label}</span>}
                  {dl != null && (
                    dl < 0
                      ? <span className="rdy-card-blk">старт −{Math.abs(dl)} дн.</span>
                      : <span className="rdy-card-dl">до старта {dl} дн.</span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </DrawerModal>
  );
}

function plural(n, forms) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}
