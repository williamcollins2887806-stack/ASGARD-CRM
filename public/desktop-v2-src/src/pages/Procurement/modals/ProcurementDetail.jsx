/**
 * Деталь заявки — позиции, согласование, действия по ролям.
 *
 * Возможности (1:1 с openDetail в vanilla):
 *   • Шапка: статус, locked, заказчик, РП, закупщик, сроки, сумма
 *   • Таблица позиций с inline-edit (наименование/кол-во/поставщик/цена) для PROC/PM
 *   • Сплит позиций (✂️) + откат сплита (⇲)
 *   • Подсказки цен в строке (последняя + ср. рынок) с кнопкой «подставить» для PROC
 *   • Загрузка счёта поставщика — Excel/PDF/фото с авто-матчингом
 *   • Кнопки: + Позиция, 📝 Текстом, 🤖 AI по ТЗ, 🛒 Из каталога, 📥 Excel-импорт
 *   • Группировка позиций (нет → категории → поставщики)
 *   • Список загруженных счетов поставщиков
 *   • Платёжки (для бухгалтера)
 *   • История изменений (timeline)
 *   • Действия по статусу: отправить закупщику, ответить, согласовать, директор approve/rework/question/reject,
 *     оплатить, принять (приёмка), закрыть, повторить заявку, сохранить шаблон
 *   • Комментарий к действию (textarea)
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import { useModal, ConfirmModal, PromptModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { useAuth } from '@/api/useAuth';
import {
  STATUSES, money, fmtDate, fmtDateTime, isOverdue,
  loadProcurementDetail, updateItem, deleteItem, unsplitItem,
  transition, addItem, importText, aiParseSpec,
  loadPriceHints, loadPriceHint,
  cloneProcurement, saveAsTemplate,
  isPROC, isPM as _isPM, getActions
} from '../api';
import { SplitItemModal as _SplitItemModal, openSplitModal } from './SplitItemModal';
import { InvoiceImportModal as _InvoiceImportModal, openInvoiceModal } from './InvoiceImportModal';
import { DeliverModal as _DeliverModal, openDeliverModal } from './DeliverModal';
import { ShowcaseModal as _ShowcaseModal, openShowcaseModal } from './ShowcaseModal';
import { ImportExcelModal as _ImportExcelModal, openImportExcelModal } from './ImportExcelModal';
import { openProtected } from '@/api/download';
import { validateFile, MAX_ATTACHMENT_SIZE } from '@/api/upload';

/** Открыть деталь заявки (1:1 с vanilla openDetail). */
export function openDetailModal(modal, procId, onChanged) {
  modal.open(<ProcurementDetailModal procId={procId} onChanged={onChanged} />);
}

function StatusPill({ status }) {
  const st = STATUSES[status] || { label: status, tone: 'draft' };
  return <span className={'proc-pill proc-pill--' + st.tone}>{st.label}</span>;
}

function authHeaders() {
  const t = (typeof localStorage !== 'undefined' && localStorage.getItem('asgard_token')) || '';
  return { Authorization: `Bearer ${t}` };
}

export function ProcurementDetailModal({ procId, onChanged }) {
  const { close, open } = useModal();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState('');
  const [edits, setEdits] = useState({});         // {itemId: {field: newValue}}
  const [hints, setHints] = useState({});         // {itemId: {last, stats}}
  const [groupMode, setGroupMode] = useState('none'); // 'none' | 'category' | 'supplier'

  const load = () => {
    setBusy(true);
    loadProcurementDetail(procId)
      .then((d) => {
        setData(d);
        setEdits({});
      })
      .catch((e) => toast.error('Не удалось загрузить заявку: ' + (e?.message || e)))
      .finally(() => setBusy(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [procId]);

  // Подсказки цен: батч-запрос на видимые родительские позиции
  useEffect(() => {
    if (!data?.items) return;
    const need = data.items.filter((it) => !it.parent_item_id && (it.product_id || it.name));
    if (!need.length) { setHints({}); return; }
    loadPriceHints(procId, need.map((it) => ({ key: 'i' + it.id, product_id: it.product_id || null, name: it.name })))
      .then((res) => {
        const map = {};
        need.forEach((it) => {
          const h = res?.hints?.['i' + it.id];
          if (h && (h.last || h.stats)) map[it.id] = h;
        });
        setHints(map);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.items?.length, procId]);

  const p = data?.item || null;
  const items = data?.items || [];
  const payments = data?.payments || [];
  const history = data?.history || [];
  const invoiceImports = data?.invoice_imports || [];
  const actions = p ? getActions(p, user?.role) : [];
  const isLocked = !!p?.locked;
  const canEditItems = !isLocked && ['PM', 'HEAD_PM', 'PROC', 'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(user?.role);
  const procRole = isPROC(user?.role);

  // ── Родители + дети сплита, опц. группировка ──
  const parents = items.filter((it) => !it.parent_item_id);
  const childrenOf = (pid) => items.filter((it) => it.parent_item_id === pid);

  const itemRows = useMemo(() => {
    if (groupMode === 'none' || !parents.length) {
      const rows = [];
      parents.forEach((it, idx) => {
        rows.push({ ...it, _idx: idx + 1, _isChild: false });
        childrenOf(it.id).forEach((c) => rows.push({ ...c, _idx: 0, _isChild: true, _parent: it }));
      });
      return rows;
    }
    const keyOf = (it) => groupMode === 'supplier' ? (it.supplier || 'Без поставщика') : (it.category_name || 'Без категории');
    const groups = {};
    parents.forEach((it) => { const k = keyOf(it); (groups[k] = groups[k] || []).push(it); });
    const rows = [];
    Object.keys(groups).sort().forEach((g) => {
      const sum = groups[g].reduce((s, x) => s + (parseFloat(x.total_price) || 0) + childrenOf(x.id).reduce((s2, c) => s2 + (parseFloat(c.total_price) || 0), 0), 0);
      rows.push({ _group: g, _sum: sum, _count: groups[g].length });
      groups[g].forEach((it, idx) => {
        rows.push({ ...it, _idx: idx + 1, _isChild: false });
        childrenOf(it.id).forEach((c) => rows.push({ ...c, _idx: 0, _isChild: true, _parent: it }));
      });
    });
    return rows;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, groupMode]);

  // ── inline-edit ──
  const setEdit = (itemId, field, value) => {
    setEdits((s) => ({ ...s, [itemId]: { ...(s[itemId] || {}), [field]: value } }));
  };
  const getEditedValue = (it, field) => {
    if (edits[it.id] && Object.prototype.hasOwnProperty.call(edits[it.id], field)) return edits[it.id][field];
    return it[field] ?? '';
  };
  const saveEdits = async () => {
    const ids = Object.keys(edits);
    if (!ids.length) { toast.info('Нет изменений'); return; }
    setBusy(true);
    try {
      for (const id of ids) {
        await updateItem(procId, id, edits[id]);
      }
      toast.success('Сохранено');
      onChanged?.();
      load();
    } catch (e) { toast.error('Не удалось сохранить: ' + (e?.message || e)); setBusy(false); }
  };

  // ── Действия по статусу ──
  const doAction = (act) => {
    if (act === 'deliver-items') {
      openDeliverModal(open, p.id, () => { onChanged?.(); load(); });
      return;
    }
    const askComment = ['dir-rework', 'dir-question', 'dir-reject', 'return-to-proc'].includes(act);
    const run = async (c) => {
      try {
        await transition(p.id, act, c || comment || null);
        toast.success('Готово');
        onChanged?.();
        close();
      } catch (e) { toast.error('Не удалось: ' + (e?.message || e)); }
    };
    if (askComment && !comment.trim()) {
      open(<PromptModal
        title="Комментарий"
        label="Опишите причину"
        multiline
        required
        onSubmit={run}
      />);
    } else {
      run();
    }
  };

  // ── Удаление позиции ──
  const handleDelete = (it) => {
    open(<ConfirmModal
      title="Удалить позицию?"
      message={`«${it.name}» (${it.quantity} ${it.unit}) — позиция будет удалена безвозвратно.`}
      tone="danger"
      okText="Удалить"
      onConfirm={async () => {
        try {
          await deleteItem(p.id, it.id);
          toast.success('Удалено');
          load();
        } catch (e) { toast.error(e?.message || 'Ошибка'); }
      }}
    />);
  };

  // ── Сплит / откат сплита ──
  const handleSplit = (it) => {
    openSplitModal(open, p.id, it, load);
  };
  const handleUnsplit = (it) => {
    open(<ConfirmModal
      title="Схлопнуть разбивку?"
      message="Все дочерние позиции будут удалены, а родитель станет обычной позицией."
      tone="warn"
      okText="Схлопнуть"
      onConfirm={async () => {
        try {
          await unsplitItem(p.id, it.id);
          toast.success('Сплит отменён');
          load();
        } catch (e) { toast.error(e?.message || 'Ошибка'); }
      }}
    />);
  };

  // ── + Позиция (с подсказкой цены) ──
  const handleAddItem = () => {
    open(<AddItemModal procId={p.id} onDone={load} />);
  };

  // ── Текстовый ввод позиций ──
  const handleAddText = () => {
    open(<PromptModal
      title="📝 Добавить позиции списком"
      label="Каждая позиция с новой строки"
      placeholder={'Например:\n10 мешков цемента\nарматура 12мм - 5 шт\nкран манипулятор - 2 смены\nКабель ВВГнг 3x2.5'}
      multiline
      required
      okText="Добавить"
      onSubmit={async (text) => {
        try {
          const r = await importText(p.id, text);
          toast.success(`Добавлено: ${r.count} позиций`);
          load();
        } catch (e) { toast.error(e?.message || 'Ошибка'); }
      }}
    />);
  };

  // ── AI-разбор ТЗ ──
  const handleAiParse = () => {
    open(<PromptModal
      title="🤖 AI-разбор техзадания"
      label="Вставьте ТЗ — AI выделит позиции для закупки"
      placeholder="Вставьте техзадание..."
      multiline
      required
      okText="🤖 Разобрать ТЗ"
      onSubmit={async (text) => {
        try {
          const r = await aiParseSpec(p.id, text);
          if (r.error) { toast.error(r.error); return; }
          if (r.count > 0) {
            toast.success(`AI добавил ${r.count} позиций`);
            load();
          } else {
            toast.warn(r.message || 'AI не нашёл позиций');
          }
        } catch (e) { toast.error('AI недоступен: ' + (e?.message || e)); }
      }}
    />);
  };

  // ── 🛒 Из каталога ──
  const handleShowcase = () => {
    openShowcaseModal(open, p.id, load);
  };

  // ── 🧾 Загрузка счёта ──
  const handleInvoice = () => {
    openInvoiceModal(open, p.id, load);
  };

  // ── 📥 Импорт Excel позиций ──
  const handleImportExcel = () => {
    openImportExcelModal(open, p.id, load);
  };

  // ── 📎 Прикрепить файл-счёт к позиции ──
  const handleAttachInvoice = (it) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx';
    inp.onchange = async () => {
      const file = inp.files[0]; if (!file) return;
      // G-5: размер/тип счёта-вложения.
      try {
        validateFile(file, { maxSize: MAX_ATTACHMENT_SIZE, accept: '.pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx' });
      } catch (vErr) {
        toast.error(vErr?.message || 'Файл не подходит'); return;
      }
      const fd = new FormData();
      fd.append('file', file);
      fd.append('entity_type', 'procurement_items');
      fd.append('entity_id', it.id);
      try {
        const r = await fetch(`/api/files/upload`, { method: 'POST', headers: authHeaders(), body: fd });
        const fd2 = await r.json();
        if (fd2.id) {
          await updateItem(p.id, it.id, { invoice_doc_id: fd2.id });
          toast.success('Счёт прикреплён');
          load();
        }
      } catch (e) { toast.error(e?.message || 'Ошибка'); }
    };
    inp.click();
  };

  // ── Подсказка цены при подстановке ──
  const applyHintPrice = (it, price) => {
    setEdit(it.id, 'unit_price', price);
  };

  // ── 🔁 Повторить заявку ──
  const handleClone = () => {
    open(<ConfirmModal
      title="Повторить заявку?"
      message="Будет создана новая копия со всеми позициями."
      tone="info"
      okText="Создать копию"
      onConfirm={async () => {
        try {
          const r = await cloneProcurement(p.id);
          toast.success(`Создана копия #${r.item.id}`);
          onChanged?.();
          close();
          openDetailModal({ open }, r.item.id, onChanged);
        } catch (e) { toast.error(e?.message || 'Ошибка'); }
      }}
    />);
  };

  // ── 📋 Сохранить как шаблон ──
  const handleSaveTemplate = () => {
    open(<PromptModal
      title="Сохранить как шаблон"
      label="Название шаблона"
      initial={p.title || 'Шаблон закупки'}
      required
      okText="Сохранить"
      onSubmit={async (name) => {
        try {
          await saveAsTemplate(p.id, name);
          toast.success('Сохранено как шаблон: ' + name);
        } catch (e) { toast.error(e?.message || 'Ошибка'); }
      }}
    />);
  };

  // ── 🗂️ Цикл группировки ──
  const cycleGroup = () => {
    setGroupMode((m) => m === 'none' ? 'category' : m === 'category' ? 'supplier' : 'none');
  };

  // ── Рендер позиций ──
  const renderItemRow = (row) => {
    if (row._group) {
      return (
        <tr key={'g_' + row._group} className="proc-grp-row">
          <td colSpan={7}>
            <b>▸ {row._group}</b> <span className="proc-detail-grp-count">({row._count})</span>
          </td>
          <td><b>{money(row._sum)}</b></td>
          <td colSpan={canEditItems ? 3 : 2}></td>
        </tr>
      );
    }
    const it = row;
    const isChild = row._isChild;
    const isSplit = !isChild && childrenOf(it.id).length > 0;
    const hint = hints[it.id];
    const hintParts = [];
    if (hint?.last) hintParts.push(`посл. ${money(hint.last.unit_price)}${hint.last.supplier_name ? ' (' + hint.last.supplier_name + ')' : ''}`);
    if (hint?.stats?.avg_price) hintParts.push(`ср.рынок ${money(hint.stats.avg_price)}`);

    return (
      <tr key={it.id} className={isChild ? 'proc-row-child' : ''}>
        <td>{isChild ? '↳' : row._idx}</td>
        <td>
          {canEditItems && !isSplit ? (
            <input className="proc-items-table__input"
              value={getEditedValue(it, 'name')}
              onChange={(e) => setEdit(it.id, 'name', e.target.value)}
            />
          ) : it.name}
          {isSplit && <span className="proc-kbadge proc-detail-mlbadge">разбито</span>}
        </td>
        <td>{it.article || ''}</td>
        <td>{it.unit}</td>
        <td>
          {canEditItems && !isSplit ? (
            <input className="proc-items-table__input proc-detail-w-70" type="number" min="0" step="any"
              value={getEditedValue(it, 'quantity')}
              onChange={(e) => setEdit(it.id, 'quantity', e.target.value)}
            />
          ) : it.quantity}
        </td>
        <td>
          {procRole && canEditItems && !isSplit ? (
            <input className="proc-items-table__input"
              value={getEditedValue(it, 'supplier')}
              onChange={(e) => setEdit(it.id, 'supplier', e.target.value)}
            />
          ) : (it.supplier || '—')}
          {it.supplier_delivery_days != null && (
            <span className="proc-kbadge proc-detail-mlchip">{it.supplier_delivery_days}д</span>
          )}
        </td>
        <td>
          {isSplit ? '—' : (procRole && canEditItems ? (
            <input className="proc-items-table__input proc-detail-w-90" type="number" min="0" step="any"
              value={getEditedValue(it, 'unit_price')}
              onChange={(e) => setEdit(it.id, 'unit_price', e.target.value)}
            />
          ) : money(it.unit_price))}
          {hintParts.length > 0 && !isSplit && (
            <div className="proc-hint">
              {hintParts.join(' · ')}
              {procRole && hint?.last && (
                <a className="proc-hint__use" href="#" onClick={(e) => { e.preventDefault(); applyHintPrice(it, hint.last.unit_price); }}>подставить</a>
              )}
            </div>
          )}
        </td>
        <td>{money(it.total_price)}</td>
        <td>
          {it.item_status === 'delivered' ? (
            it.equipment_id ? (
              <a className="proc-kbadge" href={'#/equipment?id=' + it.equipment_id}>📦 #{it.equipment_id}</a>
            ) : (
              <span className="proc-kbadge proc-detail-itembadge--ok">✅ Принято</span>
            )
          ) : it.item_status === 'cancelled' ? (
            <span className="proc-kbadge">✕ Отменена</span>
          ) : (
            <span className="proc-kbadge">⏳ Ожидает</span>
          )}
        </td>
        <td>
          {it.invoice_file_name ? (
            // G-5: blob-download через Authorization header.
            <button
              type="button"
              onClick={() =>
                openProtected(it.invoice_file_path, it.invoice_file_name)
                  .catch((err) => toast.error('Файл: ' + (err?.message || err)))
              }
              className="proc-kbadge"
              style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
            >
              📎 {it.invoice_file_name}
            </button>
          ) : (procRole && canEditItems && !isSplit ? (
            <button className="m-btn ghost proc-detail-tinybtn--attach" onClick={() => handleAttachInvoice(it)}>📎</button>
          ) : '—')}
        </td>
        {canEditItems && (
          <td className="proc-detail-actions">
            {!isChild && !isSplit && parseFloat(it.quantity) >= 2 && (
              <button className="m-btn ghost proc-detail-tinybtn" onClick={() => handleSplit(it)} title="Разбить по поставщикам">✂️</button>
            )}
            {isSplit && (
              <button className="m-btn ghost proc-detail-tinybtn" onClick={() => handleUnsplit(it)} title="Схлопнуть">⇲</button>
            )}
            {!isChild && (
              <button className="m-btn ghost proc-detail-tinybtn proc-detail-tinybtn--del" onClick={() => handleDelete(it)}>✕</button>
            )}
          </td>
        )}
      </tr>
    );
  };

  // Гейт «нет данных» — ПОСЛЕ всех хуков (Rules of Hooks).
  if (!p) {
    return (
      <MCard className="modal-lg">
        <MHead icon="🛒" title="Заявка" onClose={close} />
        <MBody>
          <div className="proc-detail-empty">
            {busy ? '⏳ Загрузка…' : 'Заявка не найдена'}
          </div>
        </MBody>
      </MCard>
    );
  }

  return (
    <MCard className="modal-lg">
      <MHead
        icon="🛒"
        title={'Заявка #' + p.id}
        subtitle={p.title || ''}
        accent="gold"
        onClose={close}
      />
      <MBody>
        {/* Шапка */}
        <div className="proc-detail-head">
          <StatusPill status={p.status} />
          {isLocked && (
            <span className="proc-kbadge proc-detail-kbadge--lock">
              🔒 Заблокирована
            </span>
          )}
          <span className="proc-detail-head-spacer"></span>
          <Btn size="sm" variant="ghost" onClick={handleClone} title="Создать копию">🔁 Повторить</Btn>
          {items.length > 0 && (
            <Btn size="sm" variant="ghost" onClick={handleSaveTemplate} title="Сохранить шаблон для постоянных работ">📋 В шаблон</Btn>
          )}
        </div>

        {/* Мета */}
        <dl className="proc-meta">
          <dt>Работа</dt><dd>{p.work_title || '—'}</dd>
          <dt>Заказчик</dt><dd>{p.customer_name || '—'}</dd>
          <dt>РП</dt><dd>{p.pm_name || '—'}</dd>
          <dt>Закупщик</dt><dd>{p.proc_name || 'не назначен'}</dd>
          <dt>Создана</dt><dd>{fmtDateTime(p.created_at)}</dd>
          {p.delivery_deadline && (
            <>
              <dt>Дедлайн</dt>
              <dd>
                {fmtDate(p.delivery_deadline)}
                {!p.delivered_at && isOverdue(p) && <span className="proc-overdue"> просрочено</span>}
              </dd>
            </>
          )}
          {p.paid_at && (<><dt>Оплачено</dt><dd>{fmtDateTime(p.paid_at)}</dd></>)}
          {p.delivered_at && (<><dt>Доставлено</dt><dd>{fmtDateTime(p.delivered_at)}</dd></>)}
          <dt>Сумма</dt><dd><strong className="proc-detail-sum">{money(p.total_sum)}</strong></dd>
        </dl>

        {/* Позиции */}
        <div className="proc-section">
          <div className="proc-section__title">
            Позиции ({parents.length})
            {groupMode !== 'none' && <span className="proc-detail-group-tag">· {groupMode === 'category' ? 'по категориям' : 'по поставщикам'}</span>}
          </div>
          {parents.length === 0 ? (
            <div className="proc-detail-items-empty">Позиций нет</div>
          ) : (
            <div className="proc-detail-items-scroll">
              <table className="proc-items-table">
                <thead>
                  <tr>
                    <th>№</th>
                    <th>Наименование</th>
                    <th>Артикул</th>
                    <th>Ед.</th>
                    <th>Кол-во</th>
                    <th>Поставщик</th>
                    <th>Цена</th>
                    <th>Сумма</th>
                    <th>Статус</th>
                    <th>Счёт</th>
                    {canEditItems && <th></th>}
                  </tr>
                </thead>
                <tbody>{itemRows.map(renderItemRow)}</tbody>
              </table>
            </div>
          )}

          {canEditItems && (
            <div className="proc-actions-bar">
              {procRole && parents.length > 0 && <Btn variant="primary" onClick={handleInvoice}>🧾 Загрузить счёт</Btn>}
              {parents.length > 0 && <Btn variant="ghost" onClick={cycleGroup} title="Группировка">🗂️ Группировать</Btn>}
              <Btn variant={parents.length === 0 ? 'primary' : 'ghost'} onClick={handleShowcase}>🛒 Из каталога</Btn>
              {Object.keys(edits).length > 0 && parents.length > 0 && (
                <Btn variant="primary" onClick={saveEdits} disabled={busy}>💾 Сохранить</Btn>
              )}
              <Btn variant="ghost" onClick={handleAddItem}>+ Позиция</Btn>
              <Btn variant="ghost" onClick={handleAddText}>📝 Текстом</Btn>
              <Btn variant="ghost" onClick={handleAiParse}>🤖 AI по ТЗ</Btn>
              {parents.length === 0 && <Btn variant="ghost" onClick={handleImportExcel}>📥 Импорт Excel</Btn>}
              {parents.length > 0 && (
                <Btn variant="ghost" onClick={async () => {
                  const { openProtected } = await import('@/api/download');
                  openProtected(`/api/procurement/${p.id}/export/excel?group=supplier`).catch((e) => toast.error('Не удалось скачать: ' + (e?.message || e)));
                }}>
                  📥 Excel
                </Btn>
              )}
            </div>
          )}
        </div>

        {/* Счета поставщиков */}
        {invoiceImports.length > 0 && (
          <div className="proc-section">
            <div className="proc-section__title">🧾 Счета поставщиков ({invoiceImports.length})</div>
            {invoiceImports.map((iv) => (
              <div key={iv.id} className="proc-detail-invoice-row">
                <b>{iv.supplier_name || 'Поставщик'}</b>
                {iv.total_sum != null && <span>{money(iv.total_sum)}</span>}
                {iv.delivery_days != null && <span className="proc-kbadge">{iv.delivery_days}д</span>}
                <span className="proc-detail-invoice-cnt">{iv.matched_count || 0} поз.</span>
                {iv.file_path && (
                  // G-5: blob-download через Authorization header.
                  <button
                    type="button"
                    onClick={() =>
                      openProtected(iv.file_path, iv.file_name || 'invoice')
                        .catch((err) => toast.error('Файл: ' + (err?.message || err)))
                    }
                    className="proc-kbadge"
                    style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
                  >
                    📎 {iv.file_name || 'файл'}
                  </button>
                )}
                <span className="proc-detail-invoice-meta">
                  {iv.uploaded_by_name || ''} {fmtDateTime(iv.created_at)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Платёжки */}
        {payments.length > 0 && (
          <div className="proc-section">
            <div className="proc-section__title">Платёжки ({payments.length})</div>
            {payments.map((pay) => (
              <div key={pay.id} className="proc-detail-payment-row">
                {money(pay.amount)} — {fmtDate(pay.payment_date)}
                {pay.payment_number && ' №' + pay.payment_number}
                {pay.original_name && (
                  // G-5: blob-download через Authorization header.
                  <button
                    type="button"
                    onClick={() =>
                      openProtected(pay.download_url, pay.original_name)
                        .catch((err) => toast.error('Файл: ' + (err?.message || err)))
                    }
                    className="proc-detail-payment-link"
                    style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
                  >
                    📎 {pay.original_name}
                  </button>
                )}
                <span className="proc-detail-payment-meta">
                  {pay.uploader_name || ''} {fmtDateTime(pay.created_at)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* История */}
        {history.length > 0 && (
          <div className="proc-section">
            <div className="proc-section__title">История</div>
            <div className="proc-timeline">
              {history.map((h) => (
                <div key={h.id} className="proc-timeline__entry">
                  <div className="proc-timeline__date">{fmtDateTime(h.created_at)}</div>
                  <div>
                    <span className="proc-timeline__actor">{h.actor_name || ''}</span> — {h.action}
                    {h.comment && (
                      <div className="proc-detail-history-comment">{h.comment}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Комментарий к действию */}
        {actions.length > 0 && (
          <div className="proc-section">
            <textarea
              className="m-textarea proc-detail-comment-input"
              rows={2}
              placeholder="Комментарий к действию (необязательно для согласования; обязателен для доработки/вопроса/отклонения)..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>
        )}
      </MBody>
      <MFoot align="spread">
        <Btn variant="ghost" onClick={close}>Закрыть</Btn>
        <div className="proc-detail-actions-foot">
          {actions.map((a) => (
            <Btn
              key={a.action}
              variant={a.variant}
              disabled={busy}
              onClick={() => doAction(a.action)}
            >
              {a.label}
            </Btn>
          ))}
        </div>
      </MFoot>
    </MCard>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * + Позиция (вспомогательная мини-модалка с подсказкой цены)
 * ═══════════════════════════════════════════════════════════════════════ */
function AddItemModal({ procId, onDone }) {
  const { close } = useModal();
  const [form, setForm] = useState({ name: '', quantity: 1, unit: 'шт' });
  const [hint, setHint] = useState(null);
  const [busy, setBusy] = useState(false);
  const tmrRef = useRef(null);

  const onNameChange = (v) => {
    setForm((s) => ({ ...s, name: v }));
    clearTimeout(tmrRef.current);
    if (v.trim().length < 3) { setHint(null); return; }
    tmrRef.current = setTimeout(async () => {
      try {
        const h = await loadPriceHint(v.trim());
        if (h?.last) setHint(h);
        else setHint(null);
      } catch (_) { setHint(null); }
    }, 400);
  };

  const submit = async () => {
    if (!form.name.trim()) { toast.warn('Введите наименование'); return; }
    setBusy(true);
    try {
      await addItem(procId, {
        name: form.name.trim(),
        quantity: parseFloat(form.quantity) || 1,
        unit: form.unit || 'шт'
      });
      toast.success('Добавлено');
      onDone?.();
      close();
    } catch (e) { toast.error(e?.message || 'Ошибка'); setBusy(false); }
  };

  return (
    <MCard>
      <MHead icon="+" title="Новая позиция" onClose={close} />
      <MBody>
        <div className="proc-add-stack">
          <label>
            <span className="proc-add-label-sub">Наименование</span>
            <input
              className="m-input proc-add-input"
              placeholder="напр. Цемент М400"
              value={form.name}
              autoFocus
              onChange={(e) => onNameChange(e.target.value)}
            />
          </label>
          <div className="proc-add-row">
            <label>
              <span className="proc-add-label-sub">Кол-во</span>
              <input
                className="m-input" type="number" min="0" step="0.001"
                value={form.quantity}
                onChange={(e) => setForm((s) => ({ ...s, quantity: e.target.value }))}
              />
            </label>
            <label>
              <span className="proc-add-label-sub">Ед.</span>
              <input
                className="m-input"
                value={form.unit}
                onChange={(e) => setForm((s) => ({ ...s, unit: e.target.value }))}
              />
            </label>
          </div>
          <div className="proc-add-hint">
            {hint?.last ? (
              <span>
                💡 В прошлый раз: <strong>{money(hint.last.unit_price)}</strong>
                {hint.last.supplier_name && ' у ' + hint.last.supplier_name}
                {hint.last.recorded_at && (
                  <span className="proc-add-hint-date"> ({fmtDate(hint.last.recorded_at)})</span>
                )}
              </span>
            ) : form.name.trim().length >= 3 ? (
              <span className="proc-add-hint-empty">Нет истории цен по этой позиции</span>
            ) : null}
            {hint?.stats?.sample_count >= 3 && (
              <div className="proc-add-hint-stats">
                Рынок: ср. {money(hint.stats.avg_price)}, мин {money(hint.stats.min_price)}
              </div>
            )}
          </div>
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={submit}>Добавить</Btn>
      </MFoot>
    </MCard>
  );
}

/** Алиас короткого имени (для соответствия vanilla `openDetail`). */
export function DetailModal(props) { return <ProcurementDetailModal {...props} />; }

