/**
 * Страница /correspondence — реестр входящих и исходящих документов (переписка с заказчиками).
 *
 * Источник: vanilla `public/assets/js/correspondence.js` (1301 LOC после S-11A) +
 * backend `src/routes/correspondence.js` (allocate номер / by-parent / finalize / delete) +
 * `src/routes/letter.js` (PDF/DOCX/new-revision) +
 * generic `/api/data/correspondence`.
 *
 * RBAC: 9 ролей (см. _LETTER_CONTRACT.md §5):
 *   - ADMIN, DIRECTOR_GEN, DIRECTOR_COMM, DIRECTOR_DEV    — full + delete (только GEN+ADMIN)
 *   - OFFICE_MANAGER                                      — full доступ кроме edit-text и delete
 *   - PM, HEAD_PM, TO, HEAD_TO                            — view + create + edit/finalize/new-revision «своих»
 *
 * URL params:
 *   ?parent_entity_type=tender|work|calc|pre_tender|request
 *   ?parent_entity_id=<int>
 *   ?id=<int> — deep link для открытия CorrViewModal
 *
 * При наличии parent_entity_* — используем `/api/correspondence/by-parent` + бейдж
 * «Фильтр по тендеру #N» c кнопкой сброса.
 *
 * ┌────────── Vanilla coverage checklist ──────────┐
 * │ ✅ render()                — главный layout                                       │
 * │ ✅ renderPage()            — таблица с группировкой / пагинацией                  │
 * │ ✅ filterItems()           — фильтры год/месяц/направление/тип/поиск/sstatus      │
 * │ ✅ calcStats()             — KPI расчёт (incoming/outgoing/total + drafts)        │
 * │ ✅ bindEvents()            — фильтры + Add/Edit/View                              │
 * │ ✅ openAddModal()          — CorrFormModal                                        │
 * │ ✅ openEditModal()         — CorrFormModal (по item)                              │
 * │ ✅ openViewModal()         — CorrViewModal                                        │
 * │ ✅ generateOutgoingNumber  — getNextOutgoingNumber в api.js                       │
 * │ ✅ uploadFile / linkDoc    — uploadFile/linkDoc в api.js                          │
 * │ ✅ RBAC 9 ролей            — hasAccess + canEditItem + canFinalizeItem + ...      │
 * │ ✅ Pill signing_status     — V252 (3 цвета через --info-bg/--ok-bg/--muted-bg)    │
 * │ ✅ Chip letter_kind        — V252 (--gold-bg)                                     │
 * │ ✅ Chip version_no/parent  — V252 (--info-bg)                                     │
 * │ ✅ Number col placeholder  — «🔒 при finalize» для draft outgoing                 │
 * │ ✅ Финализация             — POST /api/correspondence/:id/finalize                │
 * │ ✅ Новая редакция          — POST /api/letter/:id/new-revision + prompt note      │
 * │ ✅ PDF / Word скачивание   — /api/letter/:id/render/pdf|docx (openProtected)      │
 * │ ✅ Soft delete             — DELETE /api/correspondence/:id (ADMIN/DIRECTOR_GEN)  │
 * │ ✅ Composer entry point    — кнопка → /composer/new?parent_entity_type=...        │
 * │ ✅ URL parent_entity_*     — авто-фильтр + badge сущности                         │
 * └─────────────────────────────────────────────────┘
 */
import { useEffect, useState, useMemo, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/api/useAuth';
import { useModal, ConfirmModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import { SearchInput, SelectInput } from '@/inputs/Inputs';
import { useDebounce } from '@/api/useListHelpers';
import { openProtected } from '@/api/download';

import {
  hasAccess, hasFullAccess, isViewOnlyRole, canEditItem, canFinalizeItem,
  canNewRevision, canDownloadLetter, canDelete,
  DIRECTION_OPTIONS, DOC_TYPE_OPTIONS, MONTH_OPTIONS, SIGNING_STATUS_OPTIONS,
  loadCorrespondence, loadCorrespondenceByParent, loadOne,
  finalizeCorrespondence, createNewRevision, deleteCorrespondence,
  letterRenderUrl, letterFileBase, getParentEntityLabel
} from './api';
import { CorrFormModal } from './CorrFormModal';
import { CorrViewModal } from './CorrViewModal';
import CorrespondenceRow from './CorrespondenceRow';
import './correspondence.css';

const PAGE_SIZE = 25;

/** Прочитать ?parent_entity_type / ?parent_entity_id из location.search (HashRouter). */
function readParentFromLocation(search) {
  const params = new URLSearchParams(search || '');
  const type = params.get('parent_entity_type') || '';
  const idStr = params.get('parent_entity_id') || '';
  const id = idStr ? Number(idStr) : null;
  if (!type || !id || !Number.isFinite(id)) return null;
  return { type, id };
}

export default function CorrespondencePage() {
  const { user } = useAuth();
  const modal = useModal();
  const navigate = useNavigate();
  const location = useLocation();
  const access = hasAccess(user);
  const fullAccess = hasFullAccess(user);
  const viewOnly = isViewOnlyRole(user);

  const parentFilter = useMemo(() => readParentFromLocation(location.search), [location.search]);

  const currentYear = new Date().getFullYear();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  // Фильтры
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState('');
  const [direction, setDirection] = useState('');
  const [docType, setDocType] = useState('');
  const [signingStatus, setSigningStatus] = useState('');
  const [search, setSearch] = useState('');
  const dSearch = useDebounce(search, 300);
  const [page, setPage] = useState(0);

  /* — Загрузка — */
  const refresh = useCallback(async () => {
    if (!access) return;
    setLoading(true);
    try {
      if (parentFilter) {
        // by-parent — backend сам учитывает RBAC и роли (PM видит только своё под этой сущностью).
        const { items: arr } = await loadCorrespondenceByParent({
          parent_entity_type: parentFilter.type,
          parent_entity_id:   parentFilter.id,
          only_current:       false,
          limit:              5000
        });
        setItems(arr);
      } else {
        // Generic список (RBAC в бэке + soft-delete фильтр).
        const arr = await loadCorrespondence(5000);
        setItems(arr);
      }
    } catch (e) {
      toast.error('Не удалось загрузить: ' + (e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [access, parentFilter]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const onChange = () => refresh();
    window.addEventListener('asgard:correspondence:changed', onChange);
    return () => window.removeEventListener('asgard:correspondence:changed', onChange);
  }, [refresh]);

  // Deep link ?id=
  useEffect(() => {
    const params = new URLSearchParams(location.search || '');
    const idStr = params.get('id');
    if (!idStr) return;
    const id = Number(idStr);
    if (!Number.isFinite(id)) return;
    const cached = items.find((x) => x.id === id);
    if (cached) {
      modal.open(<CorrViewModal item={cached} onChanged={refresh} />);
    } else if (items.length > 0) {
      loadOne(id).then((it) => {
        if (it) modal.open(<CorrViewModal item={it} onChanged={refresh} />);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, location.search]);

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
        if (signingStatus) {
          const sk = it.signing_status || (it.direction === 'outgoing' && !it.number ? 'draft' : 'finalized');
          if (sk !== signingStatus) return false;
        }
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
  }, [items, year, month, direction, docType, signingStatus, dSearch]);

  useEffect(() => { setPage(0); }, [year, month, direction, docType, signingStatus, dSearch]);

  const stats = useMemo(() => {
    const incoming = filtered.filter((x) => x.direction === 'incoming').length;
    const outgoing = filtered.filter((x) => x.direction === 'outgoing').length;
    const drafts = filtered.filter((x) =>
      (x.signing_status || (x.direction === 'outgoing' && !x.number ? 'draft' : 'finalized')) === 'draft'
    ).length;
    return { incoming, outgoing, total: filtered.length, drafts };
  }, [filtered]);

  const pageItems = useMemo(
    () => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [filtered, page]
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  useEffect(() => {
    if (page > 0 && page >= totalPages) setPage(0);
  }, [totalPages, page]);

  /* — Действия — */
  const openAdd = (dirVal) => {
    modal.open(<CorrFormModal direction={dirVal} parentFilter={parentFilter} onSaved={refresh} />);
  };

  const openView = (it) => {
    modal.open(<CorrViewModal item={it} onChanged={refresh} />);
  };

  const openEdit = (it) => {
    if (!canEditItem(user, it)) {
      toast.warn('Финализированное письмо нельзя редактировать — создайте новую редакцию');
      return;
    }
    modal.open(<CorrFormModal item={it} onSaved={refresh} />);
  };

  const downloadPdf = (it) => {
    const url = letterRenderUrl(it.id, 'pdf', { with_signature: true, with_stamp: true });
    openProtected(url, letterFileBase(it) + '.pdf')
      .catch((err) => toast.error('PDF: ' + (err?.message || err)));
  };

  const downloadDocx = (it) => {
    const url = letterRenderUrl(it.id, 'docx');
    openProtected(url, letterFileBase(it) + '.docx')
      .catch((err) => toast.error('Word: ' + (err?.message || err)));
  };

  const doFinalize = (it) => {
    modal.open(
      <ConfirmModal
        title="Финализировать письмо?"
        message="После финализации будет присвоен Исх.№ и редактирование закроется. Создать новую редакцию можно будет позже."
        okText="🔒 Финализировать"
        tone="warning"
        onConfirm={async () => {
          try {
            const resp = await finalizeCorrespondence(it.id);
            toast.success('Письмо финализировано · № ' + (resp?.number || ''));
            window.dispatchEvent(new CustomEvent('asgard:correspondence:changed'));
            await refresh();
          } catch (e) {
            toast.error('Не удалось финализировать: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  const doNewRevision = (it) => {
    // window.prompt используется вместо отдельной модалки — лаконичный UX (как vanilla S-11A).
    const note = (window.prompt('Краткое примечание к новой редакции (опц.):', '') || '').trim();
    (async () => {
      try {
        const resp = await createNewRevision(it.id, note || undefined);
        toast.success('Создана редакция v' + (resp?.version_no || '?'));
        window.dispatchEvent(new CustomEvent('asgard:correspondence:changed'));
        await refresh();
        // Открыть новую редакцию для редактирования, если у пользователя есть права.
        const newId = resp?.new_id;
        if (newId) {
          const fresh = await loadOne(newId);
          if (fresh) {
            if (canEditItem(user, fresh)) modal.open(<CorrFormModal item={fresh} onSaved={refresh} />);
            else modal.open(<CorrViewModal item={fresh} onChanged={refresh} />);
          }
        }
      } catch (e) {
        toast.error('Не удалось создать редакцию: ' + (e?.message || e));
      }
    })();
  };

  const doDelete = (it) => {
    modal.open(
      <ConfirmModal
        title="Удалить документ?"
        message={`Документ «${it.subject || 'без темы'}» №${it.number || it.id} будет удалён безвозвратно (soft delete).`}
        tone="danger"
        okText="🗑 Удалить"
        onConfirm={async () => {
          try {
            await deleteCorrespondence(it.id);
            toast.success('Документ удалён');
            window.dispatchEvent(new CustomEvent('asgard:correspondence:changed'));
            await refresh();
          } catch (e) {
            toast.error('Не удалось удалить: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  const goComposer = () => {
    const p = new URLSearchParams();
    if (parentFilter) {
      p.set('parent_entity_type', parentFilter.type);
      p.set('parent_entity_id', String(parentFilter.id));
    }
    const qs = p.toString();
    // Composer уже зарегистрирован в App.jsx как /correspondence/composer (новое письмо)
    // и /correspondence/composer/:id (редактирование существующего). Параметры по родителю
    // — через query, чтобы composer пред-заполнил привязку.
    navigate('/correspondence/composer' + (qs ? '?' + qs : ''));
  };

  const clearParentFilter = () => {
    const p = new URLSearchParams(location.search || '');
    p.delete('parent_entity_type');
    p.delete('parent_entity_id');
    const qs = p.toString();
    navigate('/correspondence' + (qs ? '?' + qs : ''), { replace: true });
  };

  if (!user) return null;

  if (!access) {
    return (
      <div className="col gap-12">
        <TopActionsBar kicker="Документы" title="Официальная переписка" />
        <EmptyState
          icon="🔒"
          title="Нет доступа"
          hint="Раздел доступен директорам, офис-менеджеру, РП и тендерному отделу."
        />
      </div>
    );
  }

  const yearOptions = [
    { value: '', label: 'Все' },
    ...[currentYear, currentYear - 1, currentYear - 2, currentYear - 3, currentYear - 4]
      .map((y) => ({ value: String(y), label: String(y) }))
  ];

  const parentLabel = parentFilter ? getParentEntityLabel(parentFilter.type) : null;

  return (
    <div className="col gap-14">
      <TopActionsBar
        kicker="Документы"
        title="Официальная переписка"
        subtitle={
          parentFilter
            ? `Письма по ${parentLabel.label} #${parentFilter.id}`
            : 'Реестр входящих и исходящих документов'
        }
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            <Btn variant="ghost" onClick={() => openAdd('incoming')}>📥 Входящее</Btn>
            <Btn variant="ghost" onClick={() => openAdd('outgoing')}>📤 Исходящее</Btn>
            <Btn variant="primary" onClick={goComposer} title="Открыть редактор официального письма">
              ✉ Создать письмо
            </Btn>
          </>
        }
      />

      {/* Badge фильтра по сущности */}
      {parentFilter && (
        <div className="corr-parent-badge">
          <span className="corr-parent-badge__icon">{parentLabel.icon}</span>
          <span>Фильтр: письма по {parentLabel.label} <b>#{parentFilter.id}</b></span>
          <button type="button" className="corr-parent-badge__close" onClick={clearParentFilter} title="Сбросить фильтр">
            ✕
          </button>
        </div>
      )}

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
        <div className="corr-kpi-card">
          <div className="corr-kpi-label">Черновики</div>
          <div className="corr-kpi-value tone-muted">{stats.drafts}</div>
          <div className="corr-kpi-icon">✎</div>
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
        <div>
          <span className="filter-label">Статус</span>
          <SelectInput value={signingStatus} onChange={(v) => { setSigningStatus(v); setPage(0); }} options={SIGNING_STATUS_OPTIONS} />
        </div>
        <div style={{ gridColumn: 'span 2' }}>
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
          hint={search || direction || docType || signingStatus
            ? 'По текущим фильтрам ничего не найдено. Попробуйте сбросить.'
            : 'Создайте первое письмо — кнопка ✉ «Создать письмо» в шапке.'
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
                  <th className="w-160">Номер</th>
                  <th>Тема / Контрагент</th>
                  <th className="w-130">Тип</th>
                  <th className="w-150">Статус</th>
                  <th className="right w-200"></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((it) => {
                  // RBAC проверки на уровне item — определяем какие кнопки доступны.
                  const actions = {
                    view:        true, // всем кто прошёл hasAccess (см. early return выше)
                    edit:        canEditItem(user, it),
                    pdf:         canDownloadLetter(user, it),
                    docx:        canDownloadLetter(user, it),
                    finalize:    canFinalizeItem(user, it),
                    newRevision: canNewRevision(user, it),
                    delete:      canDelete(user)
                  };
                  return (
                    <CorrespondenceRow
                      key={it.id}
                      item={it}
                      actions={actions}
                      onView={() => openView(it)}
                      onEdit={() => openEdit(it)}
                      onPdf={() => downloadPdf(it)}
                      onDocx={() => downloadDocx(it)}
                      onFinalize={() => doFinalize(it)}
                      onNewRevision={() => doNewRevision(it)}
                      onDelete={() => doDelete(it)}
                    />
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

      {/* Footer hint для view-only ролей (PM/HEAD_PM/TO/HEAD_TO) */}
      {viewOnly && (
        <div className="fs-12 c-t3 t-center">
          Вы видите только свои письма (и письма по сущностям, в которых вы участвуете).
          {' '}Для полного доступа обратитесь к OFFICE_MANAGER или DIRECTOR_*.
        </div>
      )}
      {fullAccess && !canDelete(user) && (
        <div className="fs-12 c-t3 t-center">
          Удаление документов доступно только ADMIN и DIRECTOR_GEN.
        </div>
      )}
    </div>
  );
}
