/**
 * /readiness — РП-вид готовности проектов.
 * PM видит только свои работы в подготовке; HEAD_PM/директора/ADMIN — все в подготовке.
 *
 * Hero: средняя готовность по проектам + бейдж «горящих» (готовность <60% и старт ≤14 дн).
 * Сетка карточек: кольцо + название + статус + блокер + дни до старта.
 * Клик по карточке → StageDrawer с детализацией 7 этапов и кнопками override.
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import Ring from './Ring';
import StageDrawer from './StageDrawer';
import {
  loadWorks, loadSummary,
  isPrep, isClosed, daysLeft, readyColor,
  PM_PAGE_ROLES, isDirectorRole
} from './api';
import './readiness.css';

export default function ReadinessPmPage() {
  const { user } = useAuth();
  const modal = useModal();

  const [works, setWorks]     = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const [denied, setDenied]   = useState(false);

  const refresh = () => {
    if (!user) return;
    if (!PM_PAGE_ROLES.includes(user.role)) {
      setDenied(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    // PM фильтрует на бэке через my=true; руководители видят всё
    const isPMonly = user.role === 'PM';
    loadWorks({ my: isPMonly })
      .then(async (list) => {
        // Если backend не уважает my=true (на проде ?my игнорится местами), фильтруем клиентом
        let prepWorks = (list || []).filter((w) => !isClosed(w.work_status) && isPrep(w.work_status));
        if (isPMonly) {
          prepWorks = prepWorks.filter((w) => w.pm_id === user.id);
        }
        setWorks(prepWorks);
        if (!prepWorks.length) return setSummary({});
        const sum = await loadSummary(prepWorks.map((w) => w.id));
        setSummary(sum || {});
      })
      .catch((e) => {
        toast.error('Не удалось загрузить готовность: ' + (e?.message || e));
        setWorks([]); setSummary({});
      })
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, [user?.id, user?.role]);

  // Сортируем: сначала самые «горящие» (низкая готовность + близкий старт)
  const items = useMemo(() => {
    return works
      .map((w) => ({ w, s: summary[w.id] || null }))
      .filter((x) => x.s)
      .sort((a, b) => (a.s.overall_percent || 0) - (b.s.overall_percent || 0));
  }, [works, summary]);

  const stats = useMemo(() => {
    if (!items.length) return { avg: 0, hot: 0, count: 0 };
    let sumPct = 0, hot = 0;
    for (const { w, s } of items) {
      sumPct += s.overall_percent || 0;
      const dl = daysLeft(s.start_plan || w.start_plan);
      if ((s.overall_percent || 0) < 60 && dl != null && dl <= 14) hot++;
    }
    return { avg: Math.round(sumPct / items.length), hot, count: items.length };
  }, [items]);

  const onOpen = (workId) => modal.open(<StageDrawer workId={workId} currentUser={user} />);

  if (denied) {
    return (
      <EmptyState
        icon="🛡️"
        title="Раздел доступен только РП и руководителям"
        hint="Если у вас должен быть доступ — обратитесь к администратору."
        action={null}
      />
    );
  }

  const isPMonly = user?.role === 'PM';
  const subtitle = isPMonly
    ? `Готовность ваших проектов к старту — по 7 этапам подготовки (персонал, допуска, закупки, сборы, билеты, жильё, логистика).`
    : `Готовность всех проектов в подготовке — по 7 этапам. Нажмите карточку, чтобы увидеть детали и закрыть этап вручную.`;

  return (
    <div className="col gap-14">
      <TopActionsBar
        kicker="Готовность"
        title="Готовность проектов"
        subtitle={subtitle}
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            {isDirectorRole(user?.role) && (
              <Btn variant="primary" onClick={() => { window.location.hash = '#/readiness-board'; }}>
                👁 Сводка по РП
              </Btn>
            )}
          </>
        }
      />

      {loading ? (
        <div className="card card-empty" >
          ⏳ Загружаем готовность…
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon="🎉"
          title="Нет проектов в подготовке"
          hint={isPMonly
            ? 'Все ваши работы либо уже идут, либо закрыты. Когда РП поставит работу в подготовку — она появится здесь.'
            : 'В компании нет работ в подготовке. Когда РП начнут готовить новые проекты — они появятся здесь.'}
          action={null}
        />
      ) : (
        <>
          <div className="rdy-hero">
            <Ring value={stats.avg} size={96} />
            <div className="flex-1">
              <div className="rdy-hero-val" style={{ color: readyColor(stats.avg) }}>
                {stats.avg}%
              </div>
              <div className="rdy-hero-sub">
                Средняя готовность · {stats.count} {plural(stats.count, ['работа', 'работы', 'работ'])} в подготовке
                {stats.hot > 0 && (
                  <> · <span className="rdy-hero-hot">🔥 {stats.hot} {plural(stats.hot, ['горящий', 'горящих', 'горящих'])}</span></>
                )}
              </div>
            </div>
          </div>

          <div className="rdy-grid">
            {items.map(({ w, s }) => (
              <WorkCard key={w.id} work={w} summary={s} onOpen={() => onOpen(w.id)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function WorkCard({ work, summary, onOpen }) {
  const dl = daysLeft(summary.start_plan || work.start_plan);
  const hot = (summary.overall_percent || 0) < 60 && dl != null && dl <= 14;
  return (
    <button
      type="button"
      className={'rdy-card ' + (hot ? 'is-hot' : '')}
      onClick={onOpen}
    >
      <Ring value={summary.overall_percent || 0} size={56} />
      <div className="rdy-card-body">
        <div className="rdy-card-ttl">{work.work_title || `Работа #${work.id}`}</div>
        <div className="rdy-card-sub">
          {work.customer_name || 'Без заказчика'} · {work.work_status || '—'}
        </div>
        <div className="rdy-card-meta">
          <span>
            {summary.stages_done || 0}/{summary.stages_total || 0} этапов
          </span>
          {summary.blocker_label && (
            <span className="rdy-card-blk">⚠ {summary.blocker_label}</span>
          )}
          {dl != null && (
            dl < 0
              ? <span className="rdy-card-blk">старт −{Math.abs(dl)} дн.</span>
              : <span className="rdy-card-dl">до старта {dl} дн.</span>
          )}
        </div>
      </div>
    </button>
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
