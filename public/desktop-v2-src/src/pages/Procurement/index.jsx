/**
 * Страница /procurement — реестр заявок на закупку (CRM 2.0).
 * Источник: vanilla `public/assets/js/procurement-page.js` (1031 строк, IIFE AsgardProcurementPage).
 *
 * Vanilla coverage checklist (отметки 1:1 для перепроверки):
 *
 *  Реестр:
 *   ✅ Список заявок (GET /api/procurement?...)
 *   ✅ Фильтры: status, search (server-side)
 *   ✅ Дашборд KPI: pending / overdue / upcoming / paid (PROC/ADMIN/DIR)
 *   ✅ Переключатель Канбан/Таблица (LS proc_view)
 *   ✅ Канбан: 6 объединённых колонок (new/work/approve/paid/delivery/done)
 *   ✅ Drag&Drop карточек со сменой статуса через разрешённые роли/переходы
 *   ✅ Таблица с сортировкой и пагинацией
 *   ✅ Экспорт реестра в Excel / Шаблон Excel
 *   ✅ /my-procurement — тот же компонент с pmFilter=user.id
 *
 *  Деталь:
 *   ✅ openDetail модалка с шапкой, метой, позициями, табами счетов/платёжек/истории
 *   ✅ Inline-редактирование позиций (наименование/кол-во/поставщик/цена)
 *   ✅ Сплит позиции по поставщикам (POST /:id/items/:itemId/split)
 *   ✅ Откат сплита (DELETE)
 *   ✅ Подсказки цен в строке (last + market stats, batch endpoint)
 *   ✅ Подстановка цены из подсказки
 *   ✅ Загрузка счёта поставщика — Excel multipart / PDF / фото с авто-матчингом
 *   ✅ Применение цен по сматченным/привязанным строкам
 *   ✅ Витрина каталога (showcase) — выбор из products+equipment с остатком и докупкой
 *   ✅ + Позиция вручную с подсказкой цены при вводе названия
 *   ✅ Добавление позиций списком (parseTextLine)
 *   ✅ AI-разбор ТЗ (POST /:id/items/ai-parse)
 *   ✅ Импорт Excel позиций (multipart)
 *   ✅ Прикрепление файла-счёта к позиции (через /api/files)
 *   ✅ Удаление позиции
 *   ✅ Группировка по категории / поставщику (UI-only)
 *   ✅ Экспорт заявки в Excel (с группировкой по поставщикам)
 *
 *  Согласование:
 *   ✅ send-to-proc / proc-respond / return-to-proc / pm-approve
 *   ✅ dir-approve (locked) / dir-rework / dir-question / dir-reject
 *   ✅ mark-paid / deliver-items (модалка приёмки) / close
 *   ✅ Комментарий обязателен для rework/question/reject/return
 *   ✅ Кнопки видны по статусу+роли (getActions)
 *
 *  Создание:
 *   ✅ openCreateModal (title, work_id, priority, price_segment, budget_limit, notes)
 *   ✅ Фиксация workId при открытии из карточки работы
 *   ✅ Шаблоны (GET /api/procurement/templates) + создание из шаблона
 *   ✅ Сохранение текущей заявки как шаблон
 *   ✅ Клонирование заявки (POST /clone) → новая копия
 *   ✅ autoShowcase: после создания сразу витрина каталога
 *
 *  Приёмка:
 *   ✅ openDeliverModal (выбор позиций + ячейки) — POST /:itemId/deliver
 *   ✅ Создание equipment / списание в stock на сервере (read-only)
 *
 *  RBAC:
 *   ✅ PROC/BUH/ADMIN/DIR/HEAD/WAREHOUSE — видят всё
 *   ✅ PM/HEAD_PM — только свои (фильтр pm_id на /my-procurement)
 *   ✅ Кнопка «🛒 Корзина» / «+ Новая заявка» НЕ показывается (заявки создаются из карточки работы или склада-корзины)
 *
 *  ⏳ Известные пробелы (намеренно отложено / не блокирует):
 *   • _attachInvoice через /api/files — реализовано прямым fetch (нет /api/files в api.js, потому что это общий endpoint загрузки)
 *   • Глобальный поиск по полям расширенный — пока 5 атрибутов (id/title/work/pm/proc) на клиенте
 */
import { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar } from '@/blocks/Blocks';
import AccessDenied from '@/blocks/AccessDenied';
import { SearchInput, SelectInput } from '@/inputs/Inputs';
import { useDebounce } from '@/api/useListHelpers';

import Kanban from './Kanban';
import Table from './Table';
import {  openDetailModal } from './modals/ProcurementDetail';
import { CreateProcurementModal as _CreateProcurementModal, openCreateModal } from './modals/CreateProcurementModal';
import {
  STATUS_OPTIONS, KANBAN_COLS as _KANBAN_COLS,
  loadProcurements, loadDashboard,
  transition, kanbanActionFor,
  canSeeAll as _canSeeAll, isPM as _isPM, isPROC, isDIR
} from './api';
import './procurement.css';

// RBAC синхронно с backend `src/routes/procurement.js`. GET /api/procurement — auth-only,
// фильтрация по pm_id для PM. Page-level view-роли: участники закупочного цикла.
// Inline-литералы для rbac-audit (бэк не задаёт жёсткий список на GET).
const ALLOWED_ROLES = ['ADMIN', 'PM', 'HEAD_PM', 'PROC', 'BUH', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'WAREHOUSE'];

const VIEW_KEY = 'proc_view_v2';

export default function ProcurementPage({ mode }) {
  const { user } = useAuth();
  const modal = useModal();
  const location = useLocation();

  // mode: 'all' (для PROC/BUH/ADMIN/DIR — /procurement) или 'my' (для PM/HEAD_PM — /my-procurement)
  const myMode = mode === 'my';

  const [view, setView] = useState(() => localStorage.getItem(VIEW_KEY) || 'kanban');
  const [filters, setFilters] = useState({ search: '', status: '' });
  // G-11: debounce 300мс — без него каждый символ /api/procurement?search=… запрос на сервер.
  const dSearch = useDebounce(filters.search, 300);
  const [sort, setSort] = useState({ key: 'id', dir: -1 });
  const [items, setItems] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);

  // Параметр ?id= в hash-URL — открыть детальную сразу
  const urlId = useMemo(() => {
    const q = new URLSearchParams((location.search || '') + (location.hash?.includes('?') ? location.hash.split('?')[1] : ''));
    return q.get('id');
  }, [location]);

  // Параметр ?work= для my-procurement — фильтр по работе
  const workFilter = useMemo(() => {
    const q = new URLSearchParams((location.search || '') + (location.hash?.includes('?') ? location.hash.split('?')[1] : ''));
    return q.get('work');
  }, [location]);

  const refresh = () => {
    setLoading(true);
    const params = {
      limit: 2000,
      search: dSearch || undefined,
      // в канбане server-side фильтр по статусу не применяем (все колонки видны)
      status: view === 'table' ? (filters.status || undefined) : undefined,
      // PM/HEAD_PM — только свои заявки
      pm_id: myMode && user?.id ? user.id : undefined,
      work_id: workFilter || undefined
    };
    loadProcurements(params)
      .then(setItems)
      .catch((e) => toast.error('Не удалось загрузить заявки: ' + (e?.message || e)))
      .finally(() => setLoading(false));

    if (!myMode && (isPROC(user?.role) || isDIR(user?.role))) {
      loadDashboard().then(setDashboard).catch(() => setDashboard(null));
    } else {
      setDashboard(null);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [user?.id, view, dSearch, filters.status, myMode, workFilter]);

  useEffect(() => {
    const onChanged = () => refresh();
    window.addEventListener('asgard:procurement:changed', onChanged);
    return () => window.removeEventListener('asgard:procurement:changed', onChanged);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, view, dSearch, filters.status, myMode]);

  // Открыть деталь по ?id= (вызов openDetailModal — единая точка входа)
  useEffect(() => {
    if (urlId && /^\d+$/.test(urlId)) {
      openDetailModal(modal, +urlId, () => window.dispatchEvent(new CustomEvent('asgard:procurement:changed')));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlId]);

  // v2 BONUS: keyboard hotkeys — "/" фокус поиска, Esc сброс фильтров, "k"/"t" переключение вида (vanilla не имеет)
  useEffect(() => {
    const onKey = (e) => {
      const inField = /input|textarea|select/i.test((e.target?.tagName || ''));
      if (e.key === '/' && !inField) {
        e.preventDefault();
        document.querySelector('[data-searchbox="procurement"] input')?.focus();
        return;
      }
      if (e.key === 'Escape' && (filters.search || filters.status)) {
        setFilters({ search: '', status: '' });
        return;
      }
      if (!inField && (e.key === 'k' || e.key === 'K')) { onSetView('kanban'); return; }
      if (!inField && (e.key === 't' || e.key === 'T')) { onSetView('table'); return; }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.search, filters.status]);

  const onSetView = (v) => {
    setView(v);
    localStorage.setItem(VIEW_KEY, v);
  };
  const setSearch = (q) => setFilters((s) => ({ ...s, search: q }));
  const setStatus = (st) => setFilters((s) => ({ ...s, status: st }));

  const onOpen = (row) => {
    openDetailModal(modal, row.id, () => window.dispatchEvent(new CustomEvent('asgard:procurement:changed')));
  };

  // Канбан drag → action transition
  const onMove = async (procId, fromStatus, colKey) => {
    const action = kanbanActionFor(colKey, fromStatus, user?.role);
    if (!action) {
      toast.warn('Этот переход недоступен (роль/статус) — откройте заявку для действий');
      return;
    }
    try {
      await transition(procId, action, null);
      toast.success('Статус изменён');
      refresh();
    } catch (e) { toast.error(e?.message || 'Ошибка'); refresh(); }
  };

  const onCreate = () => {
    openCreateModal(modal, null, () => {
      refresh();
      window.dispatchEvent(new CustomEvent('asgard:procurement:changed'));
    });
  };

  const showDashboard = !myMode && dashboard && (isPROC(user?.role) || isDIR(user?.role));
  const pendCnt = dashboard?.pending_proc?.length || 0;
  const overCnt = dashboard?.overdue?.length || 0;
  const upCnt = dashboard?.upcoming?.length || 0;
  const paidCnt = (dashboard?.counts || []).find((c) => c.status === 'paid')?.cnt || 0;

  // На /procurement (для PROC/BUH) — кнопка «+ Новая» НЕ показывается (по vanilla-комментарию),
  // на /my-procurement (для PM) — тоже, заявки создают из карточки работы.
  // Кнопка остаётся только для ADMIN.
  const canCreate = user?.role === 'ADMIN';

  // Inline-RBAC-гейт после всех хуков (Rules of Hooks).
  if (user && !ALLOWED_ROLES.includes(user.role)) {
    return (
      <AccessDenied
        allowed={ALLOWED_ROLES}
        userRole={user.role}
        title="Закупки недоступны"
        message="Раздел открыт PM/HEAD_PM (создатели), PROC/WAREHOUSE (исполнители), BUH/директорам и ADMIN."
      />
    );
  }

  return (
    <div className="col gap-12">
      <TopActionsBar
        title={myMode ? 'Мои заявки на закупку' : 'Закупки'}
        subtitle={
          myMode
            ? `${items.length} ${plural(items.length, ['заявка', 'заявки', 'заявок'])} · ваши`
            : `${items.length} ${plural(items.length, ['заявка', 'заявки', 'заявок'])} в выборке`
        }
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            <Btn variant="ghost" onClick={async () => {
              const { openProtected } = await import('@/api/download');
              openProtected('/api/procurement/export/excel').catch((e) => toast.error('Не удалось скачать: ' + (e?.message || e)));
            }}>
              📥 Excel
            </Btn>
            <Btn variant="ghost" onClick={async () => {
              const { openProtected } = await import('@/api/download');
              openProtected('/api/procurement/template/excel').catch((e) => toast.error('Не удалось скачать: ' + (e?.message || e)));
            }}>
              📄 Шаблон
            </Btn>
            {canCreate && <Btn variant="primary" onClick={onCreate}>+ Новая заявка</Btn>}
          </>
        }
      />

      {/* Dashboard KPI */}
      {showDashboard && (
        <div className="proc-dash" role="group" aria-label="Сводка по статусам закупок">
          <button type="button" className="proc-dash-card proc-dash-card--pending" onClick={() => setStatus('sent_to_proc')} aria-label={`На обработке: ${pendCnt}`}>
            <div className="proc-dash-card__count">{pendCnt}</div>
            <div className="proc-dash-card__label">На обработке</div>
          </button>
          <button type="button" className="proc-dash-card proc-dash-card--overdue" onClick={() => setStatus('paid')} aria-label={`Просрочено: ${overCnt}`}>
            <div className="proc-dash-card__count">{overCnt}</div>
            <div className="proc-dash-card__label">Просрочено</div>
          </button>
          <button type="button" className="proc-dash-card proc-dash-card--upcoming" onClick={() => setStatus('paid')} aria-label={`Дедлайн менее 7 дней: ${upCnt}`}>
            <div className="proc-dash-card__count">{upCnt}</div>
            <div className="proc-dash-card__label">Дедлайн &lt;7д</div>
          </button>
          <button type="button" className="proc-dash-card" onClick={() => setStatus('paid')} aria-label={`Ждут доставку: ${paidCnt}`}>
            <div className="proc-dash-card__count">{paidCnt}</div>
            <div className="proc-dash-card__label">Ждут доставку</div>
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div className="proc-toolbar">
        {/* G-1: toggle-кнопки переключения вида — group + aria-pressed */}
        <div className="proc-viewtoggle" role="group" aria-label="Вид списка">
          <button
            className={'proc-vt ' + (view === 'kanban' ? 'proc-vt--on' : '')}
            onClick={() => onSetView('kanban')}
            aria-pressed={view === 'kanban'}
          ><span aria-hidden="true">🗂️ </span>Канбан</button>
          <button
            className={'proc-vt ' + (view === 'table' ? 'proc-vt--on' : '')}
            onClick={() => onSetView('table')}
            aria-pressed={view === 'table'}
          ><span aria-hidden="true">📋 </span>Таблица</button>
        </div>

        {view === 'table' && (
          <div className="proc-toolbar-select">
            <SelectInput
              value={filters.status}
              onChange={setStatus}
              options={STATUS_OPTIONS}
            />
          </div>
        )}

        <div className="proc-toolbar-search" data-searchbox="procurement">
          {/* v2 BONUS: подсказка "/" в плейсхолдере + аккумулирует focus через hotkey (vanilla не имеет) */}
          <SearchInput
            value={filters.search}
            onChange={setSearch}
            placeholder="Поиск по №, заявке, работе, РП... (/ для фокуса)"
          />
        </div>

        <span className="flex-1" />

        {workFilter && (
          <span className="proc-kbadge">фильтр работа #{workFilter}</span>
        )}
      </div>

      {/* Контент */}
      {loading ? (
        <div className="proc-skel" role="status" aria-live="polite" aria-busy="true" aria-label="Загружаем заявки на закупку">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="proc-skel-row" aria-hidden="true"></div>)}
          <span className="sr-only">Загружаем заявки на закупку…</span>
        </div>
      ) : view === 'kanban' ? (
        <Kanban items={items} onOpen={onOpen} onMove={onMove} />
      ) : (
        <Table
          items={items}
          onOpen={onOpen}
          sort={sort}
          onSortChange={(key) => setSort((s) => ({ key, dir: s.key === key ? -s.dir : -1 }))}
        />
      )}
    </div>
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
