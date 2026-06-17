/**
 * Страница /assembly — ведомости сборки/мобилизации/демобилизации.
 *
 * Источник: vanilla `public/assets/js/assembly-page.js` (211) + `assembly-dnd.js` (605).
 *
 * Coverage:
 *   ✅ Список ведомостей в виде карточек (тип + статус + работа + прогресс)
 *   ✅ Фильтры: тип (mob/demob), статус (8 статусов)
 *   ✅ Открыть карточку → AssemblyDetailModal
 *   ✅ Создать ведомость → AssemblyCreateModal (мобилизация / перемещение)
 *   ✅ Карточка: метаданные, позиции, паллеты, прогресс, действия по роли+статусу
 *   ✅ Действия: confirm (draft→confirmed), send (→in_transit), receive-all (демоб→returned), create-demob
 *   ✅ Позиции: добавить вручную (+автокомплит по каталогу), удалить, отметить «собрано»
 *   ✅ Паллеты: создать (с capacity), удалить, отметить «упакован»
 *   ✅ Назначение позиции на паллет через Select (без DnD-эффектов из vanilla)
 *   ✅ Demob: для каждой позиции — return_status (returning/damaged/lost/consumed) + причина
 *   ✅ Скачать чек-лист PDF + Excel
 *
 * Hash: `#/assembly?id=42` открывает карточку.
 *
 * RBAC (см. src/routes/assembly.js):
 *   READ:    любой залогиненный
 *   MANAGE:  PM, HEAD_PM, WAREHOUSE, ADMIN, DIRECTOR_*
 *   CONFIRM: PM, HEAD_PM, ADMIN, DIRECTOR_*
 *   SEND:    PM, HEAD_PM, WAREHOUSE
 *   RECEIVE-ALL: WAREHOUSE, ADMIN
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import { SearchInput, SelectInput } from '@/inputs/Inputs';
import { StatusBadge } from '@/modals/Notifications';
import { loadList, STATUSES, TYPES, statusInfo, typeInfo, fmtDate } from './api';
import { AssemblyCreateModal } from './AssemblyCreateModal';
import { AssemblyDetailModal } from './AssemblyDetailModal';
import './assembly.css';

const ALL_ROLES = ['PM', 'HEAD_PM', 'WAREHOUSE', 'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

export default function AssemblyPage() {
  const { user } = useAuth();
  const modal = useModal();

  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ type: '', status: '', search: '' });

  const canCreate = ALL_ROLES.includes(user?.role);

  const refresh = () => {
    setLoading(true);
    loadList({ type: filters.type, status: filters.status })
      .then(setList)
      .catch((e) => toast.error('Не удалось загрузить: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [filters.type, filters.status]);

  useEffect(() => {
    const on = () => refresh();
    window.addEventListener('asgard:assembly:changed', on);
    return () => window.removeEventListener('asgard:assembly:changed', on);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep link `?id=42`
  useEffect(() => {
    const check = () => {
      const m = (window.location.hash || '').match(/[?&]id=(\d+)/);
      if (m && m[1]) {
        modal.open(<AssemblyDetailModal id={Number(m[1])} />, { size: 'xl' });
        window.location.hash = '#/assembly';
      }
    };
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((a) =>
      (a.title || '').toLowerCase().includes(q) ||
      (a.work_title || '').toLowerCase().includes(q) ||
      (a.destination || '').toLowerCase().includes(q) ||
      String(a.id).includes(q)
    );
  }, [list, filters.search]);

  const onOpen = (a) => modal.open(<AssemblyDetailModal id={a.id} />, { size: 'xl' });
  const onCreate = () => modal.open(<AssemblyCreateModal onCreated={(a) => { refresh(); if (a) onOpen(a); }} />);

  // v2 BONUS: keyboard hotkeys — "/" фокус поиска, Esc сброс фильтров, "n" новая (vanilla не имеет)
  useEffect(() => {
    const onKey = (e) => {
      const inField = /input|textarea|select/i.test((e.target?.tagName || ''));
      if (e.key === '/' && !inField) {
        e.preventDefault();
        document.querySelector('[data-searchbox="assembly"] input')?.focus();
      } else if (e.key === 'Escape' && (filters.search || filters.type || filters.status)) {
        setFilters({ type: '', status: '', search: '' });
      } else if (!inField && (e.key === 'n' || e.key === 'N') && canCreate) {
        e.preventDefault();
        onCreate();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, canCreate]);

  // v2 BONUS: KPI шапка по статусам (vanilla — только список) — клик по плашке = фильтр
  const kpis = useMemo(() => {
    return {
      total: list.length,
      draft: list.filter((a) => a.status === 'draft').length,
      in_transit: list.filter((a) => a.status === 'in_transit').length,
      received: list.filter((a) => a.status === 'received').length,
      closed: list.filter((a) => a.status === 'closed' || a.status === 'returned').length
    };
  }, [list]);

  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="Склад"
        title="Ведомости сборки"
        subtitle={`${visible.length} ${pluralize(visible.length, ['ведомость', 'ведомости', 'ведомостей'])} · моб/демоб/перемещения`}
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            {canCreate && <Btn onClick={onCreate}>+ Ведомость</Btn>}
          </>
        }
      />

      {/* v2 BONUS: KPI-полоса со светофором по статусам, клик = фильтр (vanilla не имеет) */}
      {kpis.total > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
          <button type="button" className="card p-10" style={{ border: '1px solid var(--brd-1)', cursor: 'pointer', textAlign: 'left' }}
            onClick={() => setFilters((f) => ({ ...f, status: '' }))}>
            <div className="fs-11 c-t3">Всего</div>
            <div className="fs-20 fw-700">{kpis.total}</div>
          </button>
          <button type="button" className="card p-10" style={{ border: '1px solid var(--brd-1)', cursor: 'pointer', textAlign: 'left' }}
            onClick={() => setFilters((f) => ({ ...f, status: 'draft' }))} title="Только черновики">
            <div className="fs-11 c-t3">📝 Черновики</div>
            <div className="fs-20 fw-700 c-amber">{kpis.draft}</div>
          </button>
          <button type="button" className="card p-10" style={{ border: '1px solid var(--brd-1)', cursor: 'pointer', textAlign: 'left' }}
            onClick={() => setFilters((f) => ({ ...f, status: 'in_transit' }))} title="В пути">
            <div className="fs-11 c-t3">🚚 В пути</div>
            <div className="fs-20 fw-700" style={{ color: 'var(--info)' }}>{kpis.in_transit}</div>
          </button>
          <button type="button" className="card p-10" style={{ border: '1px solid var(--brd-1)', cursor: 'pointer', textAlign: 'left' }}
            onClick={() => setFilters((f) => ({ ...f, status: 'received' }))} title="Принято">
            <div className="fs-11 c-t3">📦 Принято</div>
            <div className="fs-20 fw-700 c-ok">{kpis.received}</div>
          </button>
          <button type="button" className="card p-10" style={{ border: '1px solid var(--brd-1)', cursor: 'pointer', textAlign: 'left' }}
            onClick={() => setFilters((f) => ({ ...f, status: 'closed' }))} title="Закрыто/возвращено">
            <div className="fs-11 c-t3">✅ Закрыто</div>
            <div className="fs-20 fw-700 c-t3">{kpis.closed}</div>
          </button>
        </div>
      )}

      <div data-searchbox="assembly" style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 2fr) minmax(140px, 1fr) minmax(140px, 1fr)', gap: 8 }}>
        <SearchInput
          value={filters.search}
          onChange={(v) => setFilters({ ...filters, search: v })}
          placeholder="Поиск по названию, объекту, работе… (/ для фокуса)"
        />
        <SelectInput
          value={filters.type}
          onChange={(v) => setFilters({ ...filters, type: v })}
          options={[{ value: '', label: 'Все типы' }, ...TYPES.map((t) => ({ value: t.value, label: t.iconLabel }))]}
        />
        <SelectInput
          value={filters.status}
          onChange={(v) => setFilters({ ...filters, status: v })}
          options={[{ value: '', label: 'Все статусы' }, ...STATUSES.map((s) => ({ value: s.value, label: s.label }))]}
        />
      </div>

      {loading ? (
        <div className="card card-empty" >⏳ Загружаем…</div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon="🏗️"
          title={filters.search || filters.type || filters.status ? 'Ничего не нашли' : 'Ведомостей пока нет'}
          hint={filters.search ? 'Сбросьте фильтры' : canCreate ? 'Создайте первую через «+ Ведомость»' : 'Они появятся, когда РП или кладовщик сформируют сборку'}
        />
      ) : (
        <div className="asm-cards">
          {visible.map((a) => {
            const t = typeInfo(a.type);
            const s = statusInfo(a.status);
            const pct = a.items_count ? Math.round((a.packed_count / a.items_count) * 100) : 0;
            return (
              <div
                key={a.id}
                className="asm-card"
                onClick={() => onOpen(a)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(a); } }}
                role="button"
                tabIndex={0}
                aria-label={`Заказ сборки ${a.title || '#' + a.id}`}
              >
                <div className="asm-card__header">
                  <div className="asm-card__title">{a.title || t.iconLabel + ' #' + a.id}</div>
                  <StatusBadge tone={s.tone} label={s.label} />
                </div>
                <div className="asm-card__meta">
                  {t.label} · {a.work_title || '—'}
                </div>
                <div className="asm-card__meta">
                  {a.items_count || 0} поз. · {a.pallets_count || 0} мест
                  {a.destination ? ' · → ' + a.destination : ''}
                  {a.planned_date ? ' · План: ' + fmtDate(a.planned_date) : ''}
                </div>
                <div className="asm-card__progress">
                  <div className="asm-bar"><div className="asm-bar__fill" style={{ width: pct + '%' }} /></div>
                  <span className="fs-11 c-t3">{pct}%</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function pluralize(n, forms) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}
