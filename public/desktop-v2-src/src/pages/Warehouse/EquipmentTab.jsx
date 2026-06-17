import { useState, useEffect, useMemo } from 'react';
import { useModal, PromptModal, ConfirmModal } from '@/modals';
import { Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import {
  loadEquipment, loadEquipmentCategories, loadWarehouses,
  loadEquipmentStats, loadEquipmentRequests,
  transferExecute, rejectEquipmentRequest, returnEquipment, equipmentSendToRepair,
  removeCartItem, findByQr,
  isAdmin, isPm, canUseCart,
  STATUS_META, CONDITION_META, fmt, money, eqIcon
} from './api';
import { EquipmentFormModal } from './EquipmentFormModal';
import { EquipmentIssueModal } from './EquipmentIssueModal';
import { EquipmentTransferModal } from './EquipmentTransferModal';
import { EquipmentCardModal } from './EquipmentCardModal';
import { EquipmentRequestCartModal } from './EquipmentRequestCartModal';
import { EquipmentBatchesModal } from './EquipmentBatchesModal';
import { EquipmentKitsModal } from './EquipmentKitsModal';
import { EquipmentQrPrintModal } from './EquipmentQrPrintModal';
import { EquipmentBulkCreateModal } from './EquipmentBulkCreateModal';
import { openProtected } from '@/api/download';

const STATUS_CHIPS = [
  { v: '',             l: 'Все' },
  { v: 'on_warehouse', l: '📦 На складе' },
  { v: 'issued',       l: '👤 Выдано' },
  { v: 'in_transit',   l: '🚚 В пути' },
  { v: 'repair',       l: '🔧 Ремонт' },
  { v: 'broken',       l: '❌ Сломано' }
];

/**
 * Вкладка «Оборудование» — vanilla warehouse-v2-equipment.js (WH2Equipment).
 *
 * Покрыто:
 *   ✅ KPI (loadStats) + клик по KPI = фильтр по статусу
 *   ✅ Фильтры (статусные чипы + категории + склад)
 *   ✅ Список с поиском + карточки/таблица
 *   ✅ Действия: 📤 Выдать, 📥 Вернуть, 🔄 Передача, 🔧 В ремонт
 *   ✅ Запросы на передачу (ADMIN/WAREHOUSE): подтвердить/отклонить
 *   ✅ Карточка единицы с табами (info/movements/maintenance/qr)
 *   ✅ Создание / редактирование оборудования
 *   ✅ Заявки РП на выдачу (корзина) + экран кладовщика
 *   ✅ Поиск по QR/инв.№
 *   ✅ Экспорт Excel
 */
export function EquipmentTab({ search, user, cart, onAdd, onRefreshCart, onChanged }) {
  const modal = useModal();
  const [equipment, setEquipment] = useState([]);
  const [cats, setCats]           = useState([]);
  const [whs, setWhs]             = useState([]);
  const [stats, setStats]         = useState({});
  const [requests, setRequests]   = useState([]);
  const [filters, setFilters]     = useState({ status: '', category_id: '', warehouse_id: '' });
  const [view, setView]           = useState(() => localStorage.getItem('wh_eq_view') || 'cards');
  const [loading, setLoading]     = useState(true);

  const admin = isAdmin(user?.role);
  const pm    = isPm(user?.role) || admin;
  const cartEnabled = canUseCart(user?.role);

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await loadEquipment({
        ...filters,
        limit: 2000
      });
      setEquipment(r.equipment || []);
    } finally {
      setLoading(false);
    }
  };

  const refreshAll = () => { refresh(); loadEquipmentStats().then(setStats); loadEquipmentRequests().then(setRequests); onChanged?.(); };

  useEffect(() => {
    Promise.all([
      loadEquipmentCategories(),
      loadWarehouses(),
      loadEquipmentStats(),
      admin ? loadEquipmentRequests() : Promise.resolve([])
    ]).then(([c, w, s, r]) => { setCats(c); setWhs(w); setStats(s); setRequests(r); });
  }, [admin]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [filters.status, filters.category_id, filters.warehouse_id]);

  const visible = useMemo(() => {
    const f = (search || '').trim().toLowerCase();
    if (!f) return equipment;
    return equipment.filter((e) =>
      [e.name, e.inventory_number, e.serial_number, e.holder_name, e.brand, e.model]
        .some((v) => v && String(v).toLowerCase().includes(f))
    );
  }, [equipment, search]);

  const setView2 = (v) => { setView(v); localStorage.setItem('wh_eq_view', v); };

  const onSetFilter = (k, v) => setFilters((p) => ({ ...p, [k]: v === p[k] ? '' : v }));

  const onCardOpen = (e) => modal.open(<EquipmentCardModal equipmentId={e.id} currentUser={user} onChanged={refreshAll} />);

  const onIssue    = (e) => modal.open(<EquipmentIssueModal eq={e} onSaved={refreshAll} />);
  const onReturn   = (e) => modal.open(
    <ConfirmModal
      title="Вернуть на склад?"
      message={`«${e.name}» вернётся на склад.`}
      tone="success"
      onConfirm={async () => {
        try { await returnEquipment({ equipment_id: e.id }); toast.success('Возвращено'); refreshAll(); }
        catch (err) { toast.error('Ошибка: ' + (err?.message || err)); }
      }}
    />
  );
  const onTransfer = (e) => modal.open(<EquipmentTransferModal eq={e} onSaved={refreshAll} />);
  const onRepair   = (e) => modal.open(
    <PromptModal
      title={'В ремонт: ' + e.name}
      icon="🔧"
      accent="warn"
      label="Причина / описание неисправности"
      multiline
      required
      onSubmit={async (description) => {
        try { await equipmentSendToRepair({ equipment_id: e.id, description }); toast.success('Отправлено в ремонт'); refreshAll(); }
        catch (err) { toast.error('Ошибка: ' + (err?.message || err)); }
      }}
    />
  );

  const onAcceptRequest = async (id) => {
    try { await transferExecute({ request_id: id }); toast.success('Передача выполнена'); refreshAll(); }
    catch (e) { toast.error('Ошибка: ' + (e?.message || e)); }
  };
  const onRejectRequest = (id) => modal.open(
    <PromptModal
      title="Отклонить запрос на передачу"
      icon="✕"
      accent="warn"
      label="Причина"
      multiline
      required
      onSubmit={async (reason) => {
        try { await rejectEquipmentRequest(id, { reason }); toast.success('Отклонено'); refreshAll(); }
        catch (e) { toast.error('Ошибка: ' + (e?.message || e)); }
      }}
    />
  );

  const onQrSearch = () => modal.open(
    <PromptModal
      title="Поиск по QR / инв. №"
      icon="🔍"
      label="Код с этикетки"
      placeholder="EQ-… или инв. номер"
      required
      onSubmit={async (code) => {
        try {
          const d = await findByQr(code);
          const e = d.equipment || d.item;
          if (e) onCardOpen(e);
          else toast.warn('Не найдено: проверьте код');
        } catch { toast.warn('Не найдено: проверьте код'); }
      }}
    />
  );

  // G-5 SECURITY: blob-download без `?token=` в URL (продолжение D-4).
  const onExport = async () => {
    const qs = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => { if (v) qs.set(k, v); });
    try {
      await openProtected(
        '/api/equipment/export/excel' + (qs.toString() ? '?' + qs.toString() : ''),
        'equipment.xlsx'
      );
    } catch (e) {
      toast.error('Экспорт: ' + (e?.message || e));
    }
  };

  const cartItemFor = useMemo(() => {
    const m = new Map();
    for (const it of cart?.items || []) {
      if (it.equipment_id) m.set(it.equipment_id, it);
    }
    return m;
  }, [cart]);

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {admin && <Btn size="sm" variant="primary" onClick={() => modal.open(<EquipmentFormModal onSaved={refreshAll} />)}>➕ Оборудование</Btn>}
        {pm && !admin && <Btn size="sm" variant="primary" onClick={() => modal.open(<EquipmentRequestCartModal onSaved={refreshAll} />)}>📋 Заявка на выдачу</Btn>}
        {admin && <Btn size="sm" variant="ghost" onClick={() => modal.open(<EquipmentBatchesModal onSaved={refreshAll} />)}>📋 Заявки кладовщику</Btn>}
        <Btn size="sm" variant="ghost" onClick={onQrSearch}>🔍 По QR</Btn>
        <Btn size="sm" variant="ghost" onClick={onExport}>📥 Excel</Btn>
        <span className="flex-1" />
        <Btn size="sm" variant="ghost" onClick={() => setView2(view === 'cards' ? 'table' : 'cards')}>
          {view === 'cards' ? '☰ Таблица' : '▦ Карточки'}
        </Btn>
      </div>

      {/* KPI */}
      <EqKpis stats={stats} setFilters={onSetFilter} />

      {/* Запросы (ADMIN/WAREHOUSE) */}
      {admin && requests.length > 0 && (
        <div style={{
          background: 'var(--card-bg)',
          border: '1px solid var(--brd-1)',
          borderLeft: '4px solid var(--amber)',
          borderRadius: 'var(--r-md)',
          padding: 14,
          marginBottom: 16
        }}>
          <div className="fw-700 mb-8">📋 Запросы на оборудование ({requests.length})</div>
          {requests.map((r) => (
            <div key={r.id} className="wh-mv tbl-row-brd-2">
              <div className="flex-1">
                <strong>{r.equipment_name || '—'}</strong>
                {r.inventory_number && <span className="ml-6 op-half">№{r.inventory_number}</span>}
                <div className="fs-12 c-t3">
                  {r.requester_name} → {r.target_holder_name || 'Склад'}
                </div>
              </div>
              <button className="wh-eq-act wh-eq-act--return" onClick={() => onAcceptRequest(r.id)}>✅</button>
              <button className="wh-eq-act ml-4" onClick={() => onRejectRequest(r.id)}>❌</button>
            </div>
          ))}
        </div>
      )}

      {/* Фильтры: статус-чипы + категория + склад */}
      <div className="wh-eq-filters mb-12" >
        {STATUS_CHIPS.map((c) => (
          <button
            key={c.v}
            className={'wh-fchip ' + (filters.status === c.v ? 'wh-fchip--active' : '')}
            onClick={() => setFilters((p) => ({ ...p, status: c.v }))}
          >{c.l}</button>
        ))}
      </div>
      <div className="row gap-8 mb-14 u-wrap">
        <select
          className="m-select"
          value={filters.category_id}
          onChange={(e) => setFilters((p) => ({ ...p, category_id: e.target.value }))}
          style={{ maxWidth: 240 }}
        >
          <option value="">Все категории</option>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select
          className="m-select"
          value={filters.warehouse_id}
          onChange={(e) => setFilters((p) => ({ ...p, warehouse_id: e.target.value }))}
          style={{ maxWidth: 200 }}
        >
          <option value="">Все склады</option>
          {whs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="wh-loading">⏳ Загружаем оборудование…</div>
      ) : visible.length === 0 ? (
        <div className="wh-empty">
          <div className="wh-empty__ic">🛠️</div>
          <div className="wh-empty__ttl">Оборудование не найдено</div>
          <div>{search || filters.status || filters.category_id ? 'Измените фильтры' : 'Добавьте первую единицу через «➕ Оборудование».'}</div>
        </div>
      ) : view === 'cards' ? (
        <div className="wh-eq-grid">
          {visible.map((e) => (
            <EqCard
              key={e.id}
              e={e}
              user={user}
              cartEnabled={cartEnabled}
              cartItem={cartItemFor.get(e.id)}
              cart={cart}
              onAdd={onAdd}
              onRefreshCart={onRefreshCart}
              onOpen={() => onCardOpen(e)}
              onIssue={() => onIssue(e)}
              onReturn={() => onReturn(e)}
              onTransfer={() => onTransfer(e)}
              onRepair={() => onRepair(e)}
            />
          ))}
        </div>
      ) : (
        <EqTable
          items={visible}
          user={user}
          cartEnabled={cartEnabled}
          cartItemFor={cartItemFor}
          cart={cart}
          onAdd={onAdd}
          onRefreshCart={onRefreshCart}
          onOpen={onCardOpen}
        />
      )}
    </div>
  );
}

function EqKpis({ stats, setFilters }) {
  const total = stats.total_items != null ? stats.total_items : stats.total;
  const repair = stats.in_repair != null ? stats.in_repair : stats.repair;
  const bv     = stats.book_value != null ? stats.book_value : stats.total_book_value;
  return (
    <div className="wh-kpis mb-14" >
      <div className="wh-kpi wh-kpi--gold">
        <div className="wh-kpi__ic">🛠️</div>
        <div className="wh-kpi__v">{fmt(total || 0)}</div>
        <div className="wh-kpi__l">Всего единиц</div>
      </div>
      <button type="button" className="wh-kpi wh-kpi--ok cur-p" onClick={() => setFilters('status', 'on_warehouse')} aria-label={`На складе: ${fmt(stats.on_warehouse || 0)}`}>
        <div className="wh-kpi__ic" aria-hidden="true">📦</div>
        <div className="wh-kpi__v">{fmt(stats.on_warehouse || 0)}</div>
        <div className="wh-kpi__l">На складе</div>
      </button>
      <button type="button" className="wh-kpi wh-kpi--info cur-p" onClick={() => setFilters('status', 'issued')} aria-label={`Выдано: ${fmt(stats.issued || 0)}`}>
        <div className="wh-kpi__ic" aria-hidden="true">👤</div>
        <div className="wh-kpi__v">{fmt(stats.issued || 0)}</div>
        <div className="wh-kpi__l">Выдано</div>
      </button>
      {!!repair && (
        <button type="button" className="wh-kpi cur-p" onClick={() => setFilters('status', 'repair')} aria-label={`В ремонте: ${fmt(repair)}`}>
          <div className="wh-kpi__ic" aria-hidden="true">🔧</div>
          <div className="wh-kpi__v">{fmt(repair)}</div>
          <div className="wh-kpi__l">В ремонте</div>
        </button>
      )}
      {bv != null && (
        <div className="wh-kpi">
          <div className="wh-kpi__ic">💰</div>
          <div className="wh-kpi__v fs-18" >{money(bv)}</div>
          <div className="wh-kpi__l">Балансовая ст.</div>
        </div>
      )}
    </div>
  );
}

function EqCard({ e, user, cartEnabled, cartItem, cart, onAdd, onRefreshCart, onOpen, onIssue, onReturn, onTransfer, onRepair }) {
  const st = STATUS_META[e.status] || { label: e.status, tone: 'mute', icon: '•' };
  const cond = CONDITION_META[e.condition];
  const admin = isAdmin(user?.role);
  const acts = [];
  if (e.status === 'on_warehouse' && admin) acts.push({ k: 'issue', label: '📤 Выдать', cls: 'wh-eq-act--issue', onClick: onIssue });
  if (e.status === 'issued' && (admin || e.current_holder_id === user?.id)) acts.push({ k: 'return', label: '📥 Вернуть', cls: 'wh-eq-act--return', onClick: onReturn });
  if (e.status === 'issued' && (isPm(user?.role) || admin)) acts.push({ k: 'transfer', label: '🔄', cls: '', onClick: onTransfer });
  if (admin && !['repair', 'written_off'].includes(e.status)) acts.push({ k: 'repair', label: '🔧', cls: '', onClick: onRepair });

  return (
    <div
      className="wh-eq-card"
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen?.(); } }}
      role="button"
      tabIndex={0}
      aria-label={`Оборудование: ${e.name}`}
    >
      <div className="wh-eq-card__row">
        {e.photo_url
          ? <img className="wh-eq-card__ph" src={e.photo_url} alt="" loading="lazy" />
          : <div className="wh-eq-card__ph">{eqIcon(e)}</div>}
        <div className="flex-1">
          <div className="wh-eq-card__nm">{e.name}</div>
          <div className="wh-eq-card__inv">
            {e.inventory_number ? '№ ' + e.inventory_number : ''}
            {e.category_name ? ' · ' + e.category_name : ''}
          </div>
        </div>
        <span className={'wh-chip wh-chip--' + (st.tone || 'mute')} style={{ alignSelf: 'flex-start' }}>
          {st.icon} {st.label}
        </span>
      </div>
      <div className="wh-eq-card__meta">
        {e.holder_name && <span>👤 {e.holder_name}</span>}
        {e.object_name
          ? <span>📍 {e.object_name}</span>
          : (e.warehouse_name && <span>🏬 {e.warehouse_name}</span>)}
        {e.location_label && <span>🗺️ {e.location_label}</span>}
        {cond && <span style={{ color: 'var(--' + cond.tone + ')' }}>● {cond.label}</span>}
      </div>
      <div className="wh-eq-card__foot">
        <span className="u-flex gap-6">
          {acts.map((a) => (
            <button key={a.k} className={'wh-eq-act ' + a.cls} onClick={(ev) => { ev.stopPropagation(); a.onClick(); }}>
              {a.label}
            </button>
          ))}
        </span>
        {cartEnabled && (
          <EqStepper eqid={e.id} cartItem={cartItem} cart={cart} onAdd={onAdd} onRefreshCart={onRefreshCart} />
        )}
      </div>
    </div>
  );
}

function EqTable({ items, _user, cartEnabled, cartItemFor, cart, onAdd, onRefreshCart, onOpen }) {
  return (
    <div className="wh-table-wrap">
      <div className="ov-x-auto">
        <table className="wh-table">
          <thead>
            <tr>
              <th></th>
              <th>Наименование</th>
              <th>Инв. №</th>
              <th>Категория</th>
              <th>Статус</th>
              <th>Ответственный</th>
              <th>Объект</th>
              {cartEnabled && <th>🛒</th>}
            </tr>
          </thead>
          <tbody>
            {items.map((e) => {
              const st = STATUS_META[e.status] || { label: e.status, tone: 'mute' };
              return (
                <tr key={e.id} onClick={() => onOpen(e)} className="cur-p">
                  <td className="fs-18">
                    {e.photo_url
                      ? <img src={e.photo_url} alt="" loading="lazy" style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'cover' }} />
                      : eqIcon(e)}
                  </td>
                  <td><strong>{e.name}</strong></td>
                  <td>{e.inventory_number || '—'}</td>
                  <td>{e.category_name || '—'}</td>
                  <td><span className={'wh-chip wh-chip--' + (st.tone || 'mute')}>{st.label}</span></td>
                  <td>{e.holder_name || '—'}</td>
                  <td>{e.object_name || e.warehouse_name || '—'}</td>
                  {cartEnabled && (
                    <td onClick={(ev) => ev.stopPropagation()}>
                      <EqStepper eqid={e.id} cartItem={cartItemFor.get(e.id)} cart={cart} onAdd={onAdd} onRefreshCart={onRefreshCart} />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EqStepper({ eqid, cartItem, cart, onAdd, onRefreshCart }) {
  if (!cartItem) {
    return (
      <button
        className="wh-stp wh-stp--add"
        onClick={(e) => {
          e.stopPropagation();
          onAdd({
            warehouse_id: cart?.warehouse_id,
            items: [{ item_type: 'equipment', equipment_id: eqid, need_qty: 1, source: 'catalog' }]
          });
        }}
      >+ В корзину</button>
    );
  }
  return (
    <span className="wh-stp wh-stp--qty wh-stp--equip">
      <span style={{ color: 'var(--ok)', padding: '0 8px', fontSize: 12, fontWeight: 800 }}>✓ в корзине</span>
      <button
        className="wh-stp__b c-err"
        
        onClick={async (e) => {
          e.stopPropagation();
          try { await removeCartItem(cartItem.id); onRefreshCart?.(); } catch (err) { toast.error('Корзина: ' + (err?.message || err)); }
        }}
      >✕</button>
    </span>
  );
}
