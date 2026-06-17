/**
 * Страница /correspondence — реестр входящих и исходящих документов (переписка с заказчиками).
 *
 * Источник: vanilla `public/assets/js/correspondence.js` (~857 строк) +
 * backend `src/routes/correspondence.js` (allocate номер) + generic `/api/data/correspondence`.
 *
 * RBAC: ADMIN, DIRECTOR_GEN, DIRECTOR_COMM, DIRECTOR_DEV, OFFICE_MANAGER, PM, HEAD_PM, TO, HEAD_TO.
 *
 * ┌────────── Vanilla coverage checklist ──────────┐
 * │ ✅ render()             — главный layout (TopActionsBar + KPI + фильтры + таблица) │
 * │ ✅ renderPage()         — таблица с группировкой/пагинацией                         │
 * │ ✅ filterItems()        — фильтры по году/месяцу/направлению/типу/поиску            │
 * │ ✅ calcStats()          — KPI расчёт (incoming/outgoing/total/byType)               │
 * │ ✅ bindEvents()         — фильтры + Add/Edit/View                                   │
 * │ ✅ openAddModal()       — CorrFormModal с direction                                 │
 * │ ✅ openEditModal()      — CorrFormModal с item                                      │
 * │ ✅ openViewModal()      — CorrViewModal с item                                      │
 * │ ✅ generateOutgoingNumber() — getNextOutgoingNumber в api.js                        │
 * │ ✅ uploadFile / linkDoc — uploadFile/linkDoc в api.js                               │
 * │ ✅ RBAC hasAccess()     — hasAccess(user) в api.js                                  │
 * │ ✅ audit()              — write to audit_log (опционально через бэк, generic)       │
 * │ ⚠ MimirForms autofill  — НЕ переносим (это плагин-AI, требует отдельной интеграции)│
 * │ ✅ DOC_TYPES / DIRECTIONS — справочники в api.js                                    │
 * │ ✅ formatDate / month / esc — функции в api.js                                      │
 * └─────────────────────────────────────────────────┘
 *
 * Привязка к тендеру/работе/заказчику — НОВОЕ (добавлено в v2, на бэке поля уже есть).
 */
import { useEffect, useState, useMemo, useCallback } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import { SearchInput, SelectInput } from '@/inputs/Inputs';
import { useDebounce } from '@/api/useListHelpers';

import {
  hasAccess, DIRECTION_OPTIONS, DOC_TYPE_OPTIONS, MONTH_OPTIONS,
  loadCorrespondence, loadOne,
  getDirInfo, getDocTypeInfo, fmtDate
} from './api';
import { CorrFormModal } from './CorrFormModal';
import { CorrViewModal } from './CorrViewModal';
import './correspondence.css';

const PAGE_SIZE = 25;

export default function CorrespondencePage() {
  const { user } = useAuth();
  const modal = useModal();
  const access = hasAccess(user);

  const currentYear = new Date().getFullYear();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState('');
  const [direction, setDirection] = useState('');
  const [docType, setDocType] = useState('');
  const [search, setSearch] = useState('');
  // G-11: debounce поиска (5к строк, фильтрация в useMemo — без debounce страница лагает).
  const dSearch = useDebounce(search, 300);
  const [page, setPage] = useState(0);

  const refresh = useCallback(async () => {
    if (!access) return;
    setLoading(true);
    try {
      const arr = await loadCorrespondence(5000);
      setItems(arr);
    } catch (e) {
      toast.error('Не удалось загрузить: ' + (e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [access]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const onChange = () => refresh();
    window.addEventListener('asgard:correspondence:changed', onChange);
    return () => window.removeEventListener('asgard:correspondence:changed', onChange);
  }, [refresh]);

  // Deep link ?id=
  useEffect(() => {
    const m = (window.location.hash.split('?')[1] || '').match(/(?:^|&)id=(\d+)/);
    if (!m) return;
    const id = Number(m[1]);
    const cached = items.find((x) => x.id === id);
    if (cached) {
      modal.open(<CorrViewModal item={cached} onChanged={refresh} />);
    } else if (items.length > 0) {
      loadOne(id).then((it) => {
        if (it) modal.open(<CorrViewModal item={it} onChanged={refresh} />);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  /* — Фильтр + пагинация — */
  const filtered = useMemo(() => {
    return items
      .filter((it) => {
        if (it.deleted_at) return false;
        const d = it.date ? new Date(it.date) : null;
        if (!d) return false;
        if (year && d.getFullYear() !== Number(year)) return false;
        if (month !== '' && d.getMonth() !== Number(month)) return false;
        if (direction && it.direction !== direction) return false;
        if (docType && it.doc_type !== docType) return false;
        if (dSearch) {
          const s = dSearch.toLowerCase();
          const hay = (
            (it.subject || '') + ' ' +
            (it.counterparty || '') + ' ' +
            (it.number || '') + ' ' +
            (it.contact_person || '')
          ).toLowerCase();
          if (!hay.includes(s)) return false;
        }
        return true;
      })
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  }, [items, year, month, direction, docType, dSearch]);

  // G-11: сброс page=0 при смене любого фильтра — иначе на странице 5 фильтр на 4 элемента = пустота.
  useEffect(() => { setPage(0); }, [year, month, direction, docType, dSearch]);

  const stats = useMemo(() => {
    const incoming = filtered.filter((x) => x.direction === 'incoming').length;
    const outgoing = filtered.filter((x) => x.direction === 'outgoing').length;
    return { incoming, outgoing, total: filtered.length };
  }, [filtered]);

  const pageItems = useMemo(() => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filtered, page]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  useEffect(() => {
    if (page > 0 && page >= totalPages) setPage(0);
  }, [totalPages, page]);

  const openAdd = (dirVal) => {
    modal.open(<CorrFormModal direction={dirVal} onSaved={refresh} />);
  };

  const openView = (it) => {
    modal.open(<CorrViewModal item={it} onChanged={refresh} />);
  };

  const openEdit = (it) => {
    modal.open(<CorrFormModal item={it} onSaved={refresh} />);
  };

  if (!user) return null;

  if (!access) {
    return (
      <div className="col gap-12">
        <TopActionsBar kicker="Документы" title="Корреспонденция" />
        <EmptyState
          icon="🔒"
          title="Нет доступа"
          hint="Раздел доступен офис-менеджерам, директорам и тендерному отделу."
        />
      </div>
    );
  }

  /* Опции года — этот + 4 предыдущих */
  const yearOptions = [
    { value: '', label: 'Все' },
    ...[currentYear, currentYear - 1, currentYear - 2, currentYear - 3, currentYear - 4]
      .map((y) => ({ value: String(y), label: String(y) }))
  ];

  return (
    <div className="col gap-14">
      <TopActionsBar
        kicker="Документы"
        title="Корреспонденция"
        subtitle="Реестр входящих и исходящих документов"
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            <Btn variant="ghost" onClick={() => openAdd('incoming')}>📥 Входящее</Btn>
            <Btn variant="primary" onClick={() => openAdd('outgoing')}>📤 Исходящее</Btn>
          </>
        }
      />

      {/* KPI */}
      <div className="corr-kpi-grid">
        <div className="corr-kpi-card">
          <div className="corr-kpi-label">Всего документов</div>
          <div className="corr-kpi-value">{stats.total}</div>
          <div className="corr-kpi-icon">📋</div>
        </div>
        <div className="corr-kpi-card">
          <div className="corr-kpi-label">Входящие</div>
          <div className="corr-kpi-value tone-info">{stats.incoming}</div>
          <div className="corr-kpi-icon">📥</div>
        </div>
        <div className="corr-kpi-card">
          <div className="corr-kpi-label">Исходящие</div>
          <div className="corr-kpi-value tone-ok">{stats.outgoing}</div>
          <div className="corr-kpi-icon">📤</div>
        </div>
      </div>

      {/* Фильтры */}
      <div className="corr-filters">
        <div>
          <span className="filter-label">Год</span>
          <SelectInput value={String(year)} onChange={(v) => { setYear(v ? Number(v) : ''); setPage(0); }} options={yearOptions} />
        </div>
        <div>
          <span className="filter-label">Месяц</span>
          <SelectInput value={month} onChange={(v) => { setMonth(v); setPage(0); }} options={MONTH_OPTIONS} />
        </div>
        <div>
          <span className="filter-label">Направление</span>
          <SelectInput value={direction} onChange={(v) => { setDirection(v); setPage(0); }} options={DIRECTION_OPTIONS} />
        </div>
        <div>
          <span className="filter-label">Тип</span>
          <SelectInput value={docType} onChange={(v) => { setDocType(v); setPage(0); }} options={DOC_TYPE_OPTIONS} />
        </div>
        <div style={{ gridColumn: '1 / span 2' }}>
          <span className="filter-label">Поиск</span>
          <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(0); }} placeholder="Тема, контрагент, номер…" />
        </div>
      </div>

      {/* Список */}
      {loading ? (
        <div className="card p-32 t-center c-t3">⏳ Загружаем…</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="📬"
          title="Документов нет"
          hint={search || direction || docType
            ? 'По текущим фильтрам ничего не найдено. Попробуйте сбросить.'
            : 'Создайте первый документ — кнопки 📥 Входящее / 📤 Исходящее в шапке.'
          }
        />
      ) : (
        <>
          <div className="fs-13 c-t3">
            Найдено: {filtered.length} документов{filtered.length > PAGE_SIZE ? ` · стр. ${page + 1}/${totalPages}` : ''}
          </div>

          <div className="card" style={{ padding: 14, overflowX: 'auto' }}>
            <table className="corr-table">
              <thead>
                <tr>
                  <th className="w-110">Направление</th>
                  <th className="w-100">Дата</th>
                  <th className="w-140">Номер</th>
                  <th>Тема / Контрагент</th>
                  <th className="w-130">Тип</th>
                  <th className="right w-110"></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((it) => {
                  const dir = getDirInfo(it.direction);
                  const dtype = getDocTypeInfo(it.doc_type);
                  const toneClass = it.direction === 'outgoing' ? 'has-tone-out' : 'has-tone-in';
                  return (
                    <tr key={it.id} className={toneClass}>
                      <td onClick={() => openView(it)} className="cur-p">
                        <span className={'corr-dir-pill tone-' + dir.tone}>
                          {dir.icon} {dir.label}
                        </span>
                      </td>
                      <td onClick={() => openView(it)} className="corr-date-cell cur-p" >
                        {fmtDate(it.date)}
                      </td>
                      <td onClick={() => openView(it)} className="cur-p">
                        <span className="corr-number">{it.number || '—'}</span>
                      </td>
                      <td onClick={() => openView(it)} className="cur-p">
                        <div className="corr-subject">{it.subject || 'Без темы'}</div>
                        <div className="corr-counterparty">{it.counterparty || '—'}</div>
                        {(it.tender_id || it.work_id || it.customer_id) && (
                          <div className="corr-link-block">
                            {it.tender_id   && <a href={`#/tenders?open=${it.tender_id}`}>🎯 Тендер #{it.tender_id}</a>}
                            {it.work_id     && <a href={`#/pm-works?id=${it.work_id}`}>📌 Работа #{it.work_id}</a>}
                            {it.customer_id && <a href={`#/customers?id=${it.customer_id}`}>🏢 Заказчик</a>}
                          </div>
                        )}
                      </td>
                      <td onClick={() => openView(it)} className="cur-p">{dtype.label}</td>
                      <td className="right">
                        <div className="corr-actions-row">
                          <Btn size="sm" variant="ghost" onClick={() => openView(it)} title="Просмотр">👁</Btn>
                          <Btn size="sm" variant="ghost" onClick={() => openEdit(it)} title="Править">✎</Btn>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, alignItems: 'center', padding: 10 }}>
              <Btn size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>« Назад</Btn>
              <span className="fs-13 c-t3">стр. {page + 1} / {totalPages}</span>
              <Btn size="sm" variant="ghost" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>Вперёд »</Btn>
            </div>
          )}
        </>
      )}
    </div>
  );
}
