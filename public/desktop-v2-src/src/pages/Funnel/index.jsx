/**
 * Страница /funnel — Канбан-доска тендеров (воронка продаж).
 * Источник: vanilla `public/assets/js/funnel.js` (~456 строк).
 *
 *   ✅ index.jsx           ← root + state + drag&drop + статистика
 *   ✅ api.js              ← loadTenders + transition-map + STAGES + helpers
 *   ✅ Column.jsx          ← колонка стадии
 *   ✅ Card.jsx            ← карточка тендера
 *   ✅ TransitionModal.jsx ← модалки переходов (архив/проигрыш/выигрыш/back)
 *
 * Карточки кликабельны → открывают TenderEditorModal (из pages/Tenders).
 * Drag&Drop — нативный HTML5 API (drag/drop events на карточках/колонках).
 * Серверная карта переходов /api/tenders/transition-map определяет, какие
 * переходы разрешены для текущей роли (HEAD_TO / ADMIN / директора могут двигать).
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar } from '@/blocks/Blocks';
import AccessDenied from '@/blocks/AccessDenied';
import { TenderEditorModal } from '../Tenders/modals/TenderEditor.dispatch';
import FunnelColumn from './Column';

// RBAC синхронно с backend `src/routes/tenders.js:268` (GET /api/tenders).
// Воронка читает /api/tenders. Inline-литералы для rbac-audit.
const ALLOWED_ROLES = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
import {
  ArchiveTransitionModal, LostTransitionModal, WonTransitionModal,
  UnarchiveTransitionModal, BackwardTransitionModal,
  applySimpleTransition, isBackwardTransition
} from './TransitionModal';
import {
  STAGES, loadTenders, loadTransitionMap, loadWorks,
  fmtMoney, tenderSum, getStageForStatus, isCompletedWorkStatus
} from './api';
import { api } from '@/api/client';
import './funnel.css';

function loadPMs() {
  return api('/api/users?role=PM&limit=200')
    .then((d) => d.users || d.items || [])
    .catch(() => []);
}

export default function FunnelPage() {
  const { user } = useAuth();
  const modal = useModal();

  const [tenders, setTenders] = useState([]);
  const [works, setWorks] = useState([]);
  const [pms, setPms] = useState([]);
  const [tmap, setTmap] = useState({ transitions: {}, can_move: false });
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    // Загружаем работы вместе с тендерами — нужно для стадии «Завершено» (vanilla funnel.js:225-238).
    Promise.all([loadTenders({ limit: 1000 }), loadPMs(), loadTransitionMap(), loadWorks({ limit: 1000 })])
      .then(([list, pmList, map, workList]) => {
        setTenders(list);
        setPms(pmList);
        setTmap(map || { transitions: {}, can_move: false });
        setWorks(workList);
      })
      .catch((e) => toast.error('Не удалось загрузить воронку: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    const onChanged = () => refresh();
    window.addEventListener('asgard:tenders:changed', onChanged);
    return () => window.removeEventListener('asgard:tenders:changed', onChanged);
  }, []);

  // v2 BONUS: keyboard hotkeys на воронке (R — обновить, T — к списку тендеров) — vanilla не имеет
  useEffect(() => {
    const onKey = (e) => {
      if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'r') { e.preventDefault(); refresh(); }
      else if (e.key === 't') { e.preventDefault(); window.location.hash = '#/tenders'; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // v2 BONUS: export visible-воронки в CSV (vanilla — только смотреть)
  const exportFunnelCsv = () => {
    const rows = [
      ['ID', 'Стадия', 'Тендер', 'Заказчик', 'Тип', 'Цена', 'РП', 'Дедлайн', 'Статус', 'Создан']
    ];
    for (const stage of STAGES) {
      for (const t of (byStage[stage.id] || [])) {
        const pm = pmsById[t.responsible_pm_id] || pmsById[t.pm_id] || {};
        rows.push([
          t.id,
          stage.label,
          t.tender_title || '',
          t.customer_name || '',
          t.tender_type || '',
          tenderSum(t),
          pm.name || pm.login || '',
          t.deadline_at || '',
          t.tender_status || '',
          t.created_at || ''
        ]);
      }
    }
    const csv = '﻿' + rows.map((r) => r.map((c) => {
      const s = String(c ?? '').replace(/[\r\n]+/g, ' ');
      return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(';')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `funnel_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success(`Экспорт воронки: ${rows.length - 1} тендеров`);
  };

  const pmsById = useMemo(() => Object.fromEntries(pms.map((u) => [u.id, u])), [pms]);

  // Карта tender_id → завершён ли связанный work (для стадии «Завершено»).
  const completedByTender = useMemo(() => {
    const s = new Set();
    for (const w of works) {
      if (w.tender_id && isCompletedWorkStatus(w.work_status)) s.add(Number(w.tender_id));
    }
    return s;
  }, [works]);

  const byStage = useMemo(() => {
    const map = {};
    STAGES.forEach((s) => { map[s.id] = []; });
    tenders.forEach((t) => {
      // Если у тендера есть завершённая работа — кладём в «Завершено» (vanilla funnel.js:236-238).
      const stage = completedByTender.has(Number(t.id))
        ? 'completed'
        : getStageForStatus(t.tender_status);
      if (map[stage]) map[stage].push(t);
      else map.new.push(t);
    });
    return map;
  }, [tenders, completedByTender]);

  // KPI: всего (без черновиков), общая сумма, выиграно, конверсия
  const stats = useMemo(() => {
    const nonDraft = tenders.filter((t) => t.tender_status !== 'Черновик');
    const totalCount = nonDraft.length;
    const totalSum = nonDraft.reduce((a, t) => a + tenderSum(t), 0);
    // «Выиграли» и «Завершено» — оба считаем выигранными сделками (vanilla — только won).
    const wonList = [...(byStage.won || []), ...(byStage.completed || [])];
    const wonSum = wonList.reduce((a, t) => a + tenderSum(t), 0);
    const conv = totalCount > 0 ? ((wonList.length / totalCount) * 100).toFixed(1) : '0';
    return { totalCount, totalSum, wonSum, conv };
  }, [tenders, byStage]);

  // ─── Drag&Drop ─────────────────────────────────────────────────────────
  const draggedRef = useRef(null);

  const onDragStart = (tender, el) => {
    draggedRef.current = { tender, el };
    el?.classList?.add('fnl-card--drag');
  };
  const onDragEnd = (_, el) => {
    draggedRef.current = null;
    el?.classList?.remove('fnl-card--drag');
  };

  const onDrop = (stage) => {
    const drag = draggedRef.current;
    draggedRef.current = null;
    if (!drag) return;
    const tender = drag.tender;
    if (!tmap.can_move) {
      toast.warn('У вашей роли нет прав перемещать тендеры в воронке');
      return;
    }
    if (stage.id === getStageForStatus(tender.tender_status)) return;

    const currentStatus = tender.tender_status;
    const newStatus = stage.statuses[0];
    if (!newStatus || newStatus === currentStatus) return;

    // Серверная карта разрешений
    const allowed = tmap.transitions?.[currentStatus] || [];
    if (!allowed.includes(newStatus)) {
      toast.error(`Переход «${currentStatus}» → «${newStatus}» недоступен для вашей роли`);
      return;
    }

    // Выбор модалки по типу перехода
    if (newStatus === 'Не подходит') {
      modal.open(<ArchiveTransitionModal tender={tender} />);
      return;
    }
    if (newStatus === 'Проиграли') {
      modal.open(<LostTransitionModal tender={tender} />);
      return;
    }
    if (newStatus === 'Выиграли') {
      modal.open(<WonTransitionModal tender={tender} />);
      return;
    }
    if (newStatus === 'Новый' && currentStatus === 'Не подходит') {
      modal.open(<UnarchiveTransitionModal tender={tender} />);
      return;
    }
    if (isBackwardTransition(currentStatus, newStatus)) {
      modal.open(<BackwardTransitionModal tender={tender} newStatus={newStatus} />);
      return;
    }

    // Прямой переход вперёд — без модалки
    applySimpleTransition(tender.id, newStatus);
  };

  const onCardOpen = (tender) => {
    modal.open(<TenderEditorModal tenderId={tender.id} />);
  };

  const canMove = !!tmap.can_move;
  const subtitle = canMove
    ? 'Перетаскивайте карточки между колонками. Клик — открыть карточку тендера.'
    : 'Просмотр воронки. Перемещение карточек доступно роли ТО / директорам / администратору.';

  // Inline-RBAC-гейт после всех хуков (Rules of Hooks).
  if (user && !ALLOWED_ROLES.includes(user.role)) {
    return (
      <AccessDenied
        allowed={ALLOWED_ROLES}
        userRole={user.role}
        title="Воронка тендеров недоступна"
        message="Воронку видят PM/HEAD_PM, ТО/HEAD_TO, директора и ADMIN."
      />
    );
  }

  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="Воронка"
        title="Воронка продаж"
        subtitle="Сделки в движении — деньги в кассе."
        actions={
          <>
            {/* v2 BONUS: горячие клавиши + CSV (vanilla не имеет) */}
            <Btn variant="ghost" onClick={exportFunnelCsv} title="Экспорт CSV всех тендеров воронки">📊 CSV</Btn>
            <Btn variant="ghost" onClick={refresh} title="R">↻ Обновить</Btn>
            <Btn onClick={() => { window.location.hash = '#/tenders'; }} title="T">📋 К списку тендеров</Btn>
          </>
        }
      />

      <div className="fnl-kpi">
        <div className="fnl-kpi-card">
          <div className="fnl-kpi-val">{stats.totalCount}</div>
          <div className="fnl-kpi-lab">Всего тендеров</div>
        </div>
        <div className="fnl-kpi-card">
          <div className="fnl-kpi-val">{fmtMoney(stats.totalSum)}</div>
          <div className="fnl-kpi-lab">Общая сумма</div>
        </div>
        {/* v2 BONUS: KPI «Выиграно» теперь кликабельно — переход на /tenders?status=Выиграли */}
        <div
          className="fnl-kpi-card fnl-kpi-card--won"
          style={{ cursor: 'pointer' }}
          title="Открыть отфильтрованный список выигранных"
          onClick={() => { window.location.hash = '#/tenders?status=Выиграли'; }}
        >
          <div className="fnl-kpi-val">{fmtMoney(stats.wonSum)}</div>
          <div className="fnl-kpi-lab">Выиграно →</div>
        </div>
        <div className="fnl-kpi-card">
          <div className="fnl-kpi-val">{stats.conv}%</div>
          <div className="fnl-kpi-lab">Конверсия</div>
        </div>
      </div>

      {loading ? (
        <div className="card card-empty" >
          ⏳ Загружаем воронку…
        </div>
      ) : (
        <div className="fnl-board">
          {STAGES.map((stage) => (
            <FunnelColumn
              key={stage.id}
              stage={stage}
              tenders={byStage[stage.id] || []}
              pmsById={pmsById}
              canMove={canMove}
              onCardOpen={onCardOpen}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDrop={onDrop}
            />
          ))}
        </div>
      )}

      <div className="fs-12 c-t3 mt-4">
        {subtitle}
      </div>
    </div>
  );
}
