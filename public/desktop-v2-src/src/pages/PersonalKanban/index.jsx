/**
 * Страница /personal-kanban — Личный канбан РП с подэтапами.
 *
 * Источник поведения: PERSONAL_KANBAN_AND_INBOX_PIPELINE.md §4.2, mobile-app
 * `public/mobile-app/src/pages/PersonalKanban.jsx`.
 *
 * Backend: src/routes/personal-kanban.js (Wave-2), регистрация
 * `/api/personal-kanban` в `src/index.js`.
 *
 * Структура:
 *   ✅ TabsBar (flow_type)        — application/pre_tender/tender/work
 *   ✅ TabsBar (main_status)      — каноник из MAIN_STATUSES[flow_type]
 *   ✅ Сетка колонок-подэтапов    — Native HTML5 DnD между ними
 *   ✅ «Не размещено»             — карты с current_substage_id IS NULL
 *   ✅ Карточка → DetailModal     — история + заметки + напоминания + действия
 *   ✅ ConfiguratorModal             — CRUD подэтапов (DnD reorder, цвет, шаблон)
 *   ✅ DirectApplicationModal     — прямая заявка (только flow_type='application')
 *   ✅ Optimistic UI + откат на 4xx/5xx
 *   ✅ Deep-link `?card=NN` — открывает деталь по hash
 *   ✅ SSE-канал `personal_kanban:card_*` — refresh
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState, LoadingCard, TabsBar } from '@/blocks/Blocks';
import AccessDenied from '@/blocks/AccessDenied';
import {
  FLOW_TYPES, MAIN_STATUSES,
  loadSubstages, loadCards, moveCard
} from './api';
import PersonalKanbanColumn from './Column';
import ConfiguratorModal from './ConfiguratorModal';
import CardDetailModal from './DetailModal';
import DirectApplicationModal from './DirectApplicationModal';
import './personal-kanban.css';
import BoardV3 from './BoardV3';

const STORAGE_FLOW = 'asgard_v2_pk_flow_type';
const STORAGE_STATUS = 'asgard_v2_pk_main_status_';
const STORAGE_VIEW = 'asgard_v2_pk_view_mode'; // 'substages' | 'v3'

export default function PersonalKanbanPage() {
  const { user } = useAuth();
  const modal = useModal();

  // S-21: TO/HEAD_TO добавлены — у них собственный режим scope (to_personal / to_team), а не PM-канбан.
  const ALLOWED_ROLES = ['PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
  const allowed = !!user && ALLOWED_ROLES.includes(user.role);

  const [viewMode, setViewMode] = useState(() => {
    try { return localStorage.getItem(STORAGE_VIEW) || 'v3'; } catch { return 'v3'; }
  });
  useEffect(() => {
    try { localStorage.setItem(STORAGE_VIEW, viewMode); } catch { /* noop */ }
  }, [viewMode]);

  const [flowType, setFlowType] = useState(() => {
    try { return localStorage.getItem(STORAGE_FLOW) || 'application'; } catch { return 'application'; }
  });
  const [mainStatus, setMainStatus] = useState(() => {
    try { return localStorage.getItem(STORAGE_STATUS + (flowType || 'application')) || ''; } catch { return ''; }
  });

  const [substages, setSubstages] = useState([]);
  const [cards, setCards] = useState({ items: [], groups: {} });
  const [loading, setLoading] = useState(true);
  const [draggingCardId, setDraggingCardId] = useState(null);

  // Дефолтный main_status: первый из списка для flow_type, если не выбран.
  useEffect(() => {
    try { localStorage.setItem(STORAGE_FLOW, flowType); } catch { /* noop */ }
    const list = MAIN_STATUSES[flowType] || [];
    let saved = '';
    try { saved = localStorage.getItem(STORAGE_STATUS + flowType) || ''; } catch { /* noop */ }
    if (!saved || !list.find((x) => x.value === saved)) {
      const first = list[0]?.value || '';
      setMainStatus(first);
    } else {
      setMainStatus(saved);
    }
  }, [flowType]);

  useEffect(() => {
    if (mainStatus) {
      try { localStorage.setItem(STORAGE_STATUS + flowType, mainStatus); } catch { /* noop */ }
    }
  }, [flowType, mainStatus]);

  const refresh = () => {
    if (!allowed) return;
    setLoading(true);
    Promise.all([
      loadSubstages({ flow_type: flowType, main_status: mainStatus }),
      loadCards({ flow_type: flowType })
    ])
      .then(([subs, cs]) => {
        setSubstages(subs);
        setCards(cs);
      })
      .catch((e) => toast.error('Не удалось загрузить канбан: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  useEffect(refresh, [flowType, mainStatus, allowed]);

  // SSE-канал
  useEffect(() => {
    const onCard = () => refresh();
    window.addEventListener('asgard:personal-kanban:changed', onCard);
    // Глобальный SSE bus в desktop-v2 публикует сообщения в `asgard:sse:<event>`.
    const onSSE = (ev) => {
      const t = ev?.detail?.type || '';
      if (t.startsWith('personal_kanban:') || t.startsWith('inbox_applications:')) refresh();
    };
    window.addEventListener('asgard:sse', onSSE);
    return () => {
      window.removeEventListener('asgard:personal-kanban:changed', onCard);
      window.removeEventListener('asgard:sse', onSSE);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowType, mainStatus]);

  // Deep-link `?card=NN`
  useEffect(() => {
    const check = () => {
      const m = (window.location.hash || '').match(/[?&]card=(\d+)/);
      if (m && m[1]) {
        const id = Number(m[1]);
        const card = (cards.items || []).find((c) => c.id === id);
        if (card) {
          modal.open(<CardDetailModal card={card} onChanged={refresh} />, { size: 'lg' });
          window.location.hash = '#/personal-kanban';
        }
      }
    };
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards]);

  /* ── DnD ────────────────────────────────────────────────── */
  const draggedRef = useRef(null);

  const onCardDragStart = (card, el) => {
    draggedRef.current = card;
    setDraggingCardId(card.id);
    el?.classList?.add('is-dragging');
  };
  const onCardDragEnd = (_, el) => {
    el?.classList?.remove('is-dragging');
    draggedRef.current = null;
    setDraggingCardId(null);
  };
  const onDropToSubstage = async (targetSubstage) => {
    const dragged = draggedRef.current;
    draggedRef.current = null;
    setDraggingCardId(null);
    if (!dragged || !targetSubstage) return;
    if (dragged.current_substage_id === targetSubstage.id) return;

    // Оптимистично обновляем
    const prevSubId = dragged.current_substage_id;
    const prevMain = dragged.current_main_status;
    setCards((prev) => optimisticMove(prev, dragged.id, targetSubstage.id, targetSubstage.title, targetSubstage.color, targetSubstage.main_status));

    const isCrossMain = targetSubstage.main_status && targetSubstage.main_status !== prevMain;
    const doMove = async (confirm) => {
      try {
        await moveCard(dragged.id, {
          to_substage_id: targetSubstage.id,
          note: null,
          version: dragged.version,
          confirm: !!confirm
        });
        toast.success('Перенесено');
        refresh();
      } catch (e) {
        const code = e?.body?.error;
        if (code === 'confirm_required' || e?.body?.code === 'cross_main_status') {
          // спрашиваем подтверждение
          if (window.confirm('Перевести карту в другой основной статус?')) {
            // повторная попытка с confirm:true
            await doMove(true);
            return;
          }
          // отказ — откат
          toast.info('Перемещение отменено');
          setCards((prev) => optimisticMove(prev, dragged.id, prevSubId, null, null, prevMain, /*revert*/ true));
        } else if (code === 'version_conflict') {
          toast.warn('Карта изменилась — обновляем');
          refresh();
        } else {
          toast.error('Не удалось перенести: ' + (e?.message || e));
          refresh();
        }
      }
    };

    if (isCrossMain) {
      if (!window.confirm('Перевести карту в другой основной статус?')) {
        // откат
        setCards((prev) => optimisticMove(prev, dragged.id, prevSubId, null, null, prevMain, true));
        return;
      }
      await doMove(true);
    } else {
      await doMove(false);
    }
  };

  /* ── Производные ────────────────────────────────────────── */
  const cardsInThisStatus = useMemo(() => {
    const all = cards.items || [];
    return all.filter((c) => c.current_main_status === mainStatus);
  }, [cards, mainStatus]);

  const cardsBySubstage = useMemo(() => {
    const m = new Map();
    for (const s of substages) m.set(s.id, []);
    const unplaced = [];
    for (const c of cardsInThisStatus) {
      if (c.current_substage_id == null) unplaced.push(c);
      else if (m.has(c.current_substage_id)) m.get(c.current_substage_id).push(c);
      else unplaced.push(c); // подэтап удалён/чужой
    }
    return { map: m, unplaced };
  }, [substages, cardsInThisStatus]);

  // Счётчики на табах flow_type. GET /cards уже фильтрует по активному flowType,
  // поэтому кросс-flow счёт неизвестен — показываем только активный.
  const flowCounts = useMemo(() => {
    const out = {};
    for (const ft of FLOW_TYPES) out[ft.value] = 0;
    out[flowType] = (cards.items || []).length;
    return out;
  }, [cards, flowType]);

  // Счётчики по main_status (только для активного flow)
  const statusCounts = useMemo(() => {
    const out = {};
    for (const c of (cards.items || [])) {
      out[c.current_main_status] = (out[c.current_main_status] || 0) + 1;
    }
    return out;
  }, [cards]);

  const flowTabs = FLOW_TYPES.map((ft) => ({
    id: ft.value,
    label: ft.icon + ' ' + ft.label,
    count: flowCounts[ft.value]
  }));

  const statusTabs = (MAIN_STATUSES[flowType] || []).map((ms) => ({
    id: ms.value,
    label: ms.label,
    count: statusCounts[ms.value] || 0
  }));

  const openConfigure = () => modal.open(
    <ConfiguratorModal flow_type={flowType} main_status={mainStatus} onChanged={refresh} />,
    { size: 'lg' }
  );

  const openDirect = () => modal.open(
    <DirectApplicationModal onCreated={refresh} />,
    { size: 'lg' }
  );

  const openDetail = (card) => modal.open(
    <CardDetailModal card={card} onChanged={refresh} />,
    { size: 'lg' }
  );

  // Если viewMode='v3' — рендерим BoardV3 (9 колонок воронки, S-21).
  // S-21: TO/HEAD_TO ВСЕГДА видят v3 (substages для них не настроены) — игнорируем сохранённый viewMode.
  const forceV3 = !!user && (user.role === 'TO' || user.role === 'HEAD_TO');
  if (allowed && (viewMode === 'v3' || forceV3)) {
    return <BoardV3 onSwitchToSubstages={forceV3 ? undefined : () => setViewMode('substages')} />;
  }

  // Гейт прав — S-31.1 F-5: используем общий <AccessDenied/> (как в Tenders/index.jsx).
  if (user && !allowed) {
    return (
      <AccessDenied
        allowed={ALLOWED_ROLES}
        userRole={user.role}
        title="Личный канбан недоступен"
        message="Раздел канбана видят РП, главы РП, тендерный отдел и директора."
      />
    );
  }

  const isApplicationFlow = flowType === 'application';

  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="Мой канбан"
        title="Личный канбан РП"
        subtitle="Подэтапы внутри основного статуса. Перетащите карту между подэтапами."
        actions={
          <>
            <Btn variant="ghost" onClick={() => setViewMode('v3')}>📊 По воронке (v3)</Btn>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            <Btn variant="ghost" onClick={openConfigure} title="Настроить подэтапы">⚙ Подэтапы</Btn>
            {isApplicationFlow && (
              <Btn variant="primary" onClick={openDirect}>＋ Прямая заявка</Btn>
            )}
          </>
        }
      />

      <div className="pk-toolbar">
        <TabsBar tabs={flowTabs} active={flowType} onChange={setFlowType} />
      </div>

      <div className="pk-toolbar">
        <TabsBar tabs={statusTabs} active={mainStatus} onChange={setMainStatus} />
      </div>

      {loading ? (
        <LoadingCard text="Загружаем доску…" />
      ) : substages.length === 0 && cardsBySubstage.unplaced.length === 0 ? (
        <EmptyState
          icon="◫"
          title="Здесь пока пусто"
          hint="Создайте подэтапы для текущего основного статуса и перенесите в них карты."
          action={<Btn variant="primary" onClick={openConfigure}>⚙ Настроить подэтапы</Btn>}
        />
      ) : (
        <div className="pk-board">
          {substages
            .slice()
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((s) => (
              <PersonalKanbanColumn
                key={s.id}
                substage={{ ...s, main_status: mainStatus }}
                cards={cardsBySubstage.map.get(s.id) || []}
                draggingCardId={draggingCardId}
                onCardOpen={openDetail}
                onCardDragStart={onCardDragStart}
                onCardDragEnd={onCardDragEnd}
                onDropTo={(sub) => onDropToSubstage({ ...sub, main_status: mainStatus })}
              />
            ))}
          {cardsBySubstage.unplaced.length > 0 && (
            <PersonalKanbanColumn
              key="unplaced"
              substage={null}
              cards={cardsBySubstage.unplaced}
              draggingCardId={draggingCardId}
              onCardOpen={openDetail}
              onCardDragStart={onCardDragStart}
              onCardDragEnd={onCardDragEnd}
              onDropTo={() => {}}
              isUnplaced
            />
          )}
        </div>
      )}
    </div>
  );
}

/* ── Оптимистичный апдейт state.cards ────────────────────────────────── */
function optimisticMove(prev, cardId, toSubId, toSubTitle, toSubColor, toMainStatus, revert = false) {
  const items = (prev.items || []).map((c) => {
    if (c.id !== cardId) return c;
    return {
      ...c,
      current_substage_id: toSubId,
      current_main_status: toMainStatus || c.current_main_status,
      substage_title: toSubTitle || c.substage_title,
      substage_color: toSubColor || c.substage_color,
      last_moved_at: revert ? c.last_moved_at : new Date().toISOString()
    };
  });
  return { ...prev, items };
}
