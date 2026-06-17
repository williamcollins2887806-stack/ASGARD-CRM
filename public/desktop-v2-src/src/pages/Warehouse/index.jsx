/**
 * /warehouse-v2 — Современный WMS (Warehouse Management System).
 *
 * Vanilla источники (4 файла, ~2300 строк):
 *   public/assets/js/warehouse-v2.js              — главный AsgardWarehouseV2 (1256 строк)
 *   public/assets/js/warehouse-v2-equipment.js    — поштучный учёт (701 строка)
 *   public/assets/js/warehouse.js                 — старая страница (1346 строк, redirect → v2)
 *   src/routes/equipment.js, stock.js, warehouse-cart.js, warehouse-locations.js — backend
 *
 * Покрытие vanilla:
 *   ✅ 5 вкладок: 🛠️ Оборудование · 🧰 Расходники · 🚚 Приёмка · 🗺️ Ячейки · 📜 Движения
 *   ✅ KPI-шапка (общая + per-tab для оборудования)
 *   ✅ Поиск с автоподсказками (Расходники + Оборудование)
 *   ✅ Степперы «+ В корзину» / [−][N][+] (Ozon-стиль) на расходниках и оборудовании
 *   ✅ FAB-корзина в углу справа-снизу (бейдж + разбивка резерв/закупка)
 *   ✅ Drawer корзины: список, степперы, привязка к работе, ↻ обновить, очистить
 *   ✅ Добавление вручную (поиск по каталогу + новая позиция с ценой/qty)
 *   ✅ Предпросмотр разбивки (резерв vs закупка) с привязкой к работе
 *   ✅ Submit с обработкой 409 (stock_changed подсветка + equipment_taken)
 *   ✅ 4 складские операции: 📥 Приход · 📤 Расход · 🔄 Перемещение · 🗑️ Списание
 *   ✅ Быстрая позиция каталога (имя/ед./EAN/категория/расходник флаг)
 *   ✅ Оборудование: создание/редактирование, выдача, возврат, передача, в ремонт
 *   ✅ Карточка единицы (4 таба: Инфо/Перемещения/ТО/QR)
 *   ✅ Запросы на передачу — экран кладовщика (подтвердить/отклонить)
 *   ✅ Заявка на выдачу — корзина РП → /requests/batch
 *   ✅ Заявки кладовщику: подтверждение/отклонение/удаление позиции
 *   ✅ Поиск по QR/инв.№
 *   ✅ Ячейки: сетка + bulk-генерация (зона/стеллажи/полки/ячейки)
 *   ✅ Движения: журнал с типами, маршрутами, авторами
 *   ✅ Приёмка: 2 секции (на склад / напрямую на объект) с overdue-подсветкой
 *   ✅ Группировка/фильтры по статусам через чипы
 *   ✅ Excel-экспорт оборудования через token query
 *
 *   ✅ Каталог-импорт УПД/счёт/PDF/фото через AI (pdf.js/Tesseract CDN, см. CatalogImportModal.jsx)
 *   ✅ Комплекты оборудования (kits) — полный CRUD + применение к работе (EquipmentKitsModal.jsx)
 *
 * RBAC: всё через бэкенд + UI скрывает кнопки по `isAdmin/isPm/canUseCart`.
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { TopActionsBar } from '@/blocks/Blocks';
import AccessDenied from '@/blocks/AccessDenied';
import { Btn } from '@/modals/parts';
import { SearchInput } from '@/inputs/Inputs';
import { useDebounce } from '@/api/useListHelpers';
import { toast } from '@/modals/Notifications';
import {
  loadCart, loadProducts, loadStock, loadLowStock, loadLocations,
  addCartItems, fmt, canUseCart
} from './api';

import { ConsumablesTab } from './ConsumablesTab';
import { EquipmentTab } from './EquipmentTab';
import { IncomingTab } from './IncomingTab';
import { LocationsTab } from './LocationsTab';
import { MovementsTab } from './MovementsTab';
import { CartDrawer } from './CartDrawer';
import './warehouse.css';

// RBAC — синхронно с backend `src/routes/stock.js:16-17` (WMS_READ).
// Все GET-ы стока требуют WMS_READ — иначе пустая страница на стороне клиента.
// Inline-литералы нужны скрипту rbac-audit (он не разворачивает константы).
const ALLOWED_ROLES = ['ADMIN', 'WAREHOUSE', 'CHIEF_ENGINEER', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'PM', 'HEAD_PM', 'PROC', 'BUH'];

const TABS = [
  { id: 'equipment',   label: '🛠️ Оборудование' },
  { id: 'consumables', label: '🧰 Расходники' },
  { id: 'incoming',    label: '🚚 Приёмка' },
  { id: 'locations',   label: '🗺️ Ячейки' },
  { id: 'movements',   label: '📜 Движения' }
];

export default function WarehousePage() {
  const { user } = useAuth();
  const [tab, setTab] = useState('equipment');
  const [search, setSearch] = useState('');
  const dSearch = useDebounce(search, 300);  // G-11: debounce 300мс — каталог 5000+ позиций
  const [cart, setCart] = useState({ id: null, warehouse_id: null, items: [] });
  const [drawerOpen, setDrawerOpen] = useState(false);

  // KPI для шапки
  const [kpis, setKpis] = useState({ catalog: 0, stock_lines: 0, low: 0, locations: 0 });

  const cartEnabled = canUseCart(user?.role);
  const hasAccess = !user || ALLOWED_ROLES.includes(user.role);

  const refreshCart = () => {
    if (!hasAccess) return;
    loadCart().then((d) => setCart({
      id: d.cart?.id || null,
      warehouse_id: d.cart?.warehouse_id || null,
      items: d.items || []
    }));
  };

  const refreshKpis = () => {
    if (!hasAccess) return;
    Promise.all([
      loadProducts(),
      loadStock(),
      loadLowStock(),
      loadLocations(2000)
    ]).then(([p, s, lo, lc]) => {
      setKpis({
        catalog: p.length,
        stock_lines: s.length,
        low: lo.length,
        locations: lc.length
      });
    });
  };

  useEffect(() => {
    if (!user) return;
    if (!hasAccess) return;
    refreshCart();
    refreshKpis();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // v2 BONUS: keyboard hotkeys — "/" фокус поиска, Esc сброс, "c" открыть корзину (vanilla не имеет)
  useEffect(() => {
    const onKey = (e) => {
      const inField = /input|textarea|select/i.test((e.target?.tagName || ''));
      if (e.key === '/' && !inField) {
        e.preventDefault();
        document.querySelector('.wh-toolbar input')?.focus();
      } else if (e.key === 'Escape' && search) {
        setSearch('');
      } else if (!inField && (e.key === 'c' || e.key === 'C') && cartEnabled) {
        setDrawerOpen(true);
      } else if (!inField && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        refreshCart(); refreshKpis();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, cartEnabled]);

  const onAdd = async (payload) => {
    try {
      const d = await addCartItems(payload);
      setCart({ id: d.cart?.id, warehouse_id: d.cart?.warehouse_id, items: d.items || [] });
    } catch (e) {
      toast.error('Корзина: ' + (e?.message || e));
    }
  };

  const splits = useMemo(() => {
    let res = 0, buy = 0;
    for (const it of cart.items) {
      const need = parseFloat(it.need_qty) || 0;
      if (it.item_type === 'equipment') { res += need; continue; }
      if (it.is_new_position) { buy += need; continue; }
      const av = Math.max(0, parseFloat(it.available_qty) || 0);
      const r = Math.min(need, av); res += r; buy += (need - r);
    }
    return { reserve: res, buy };
  }, [cart.items]);

  // Inline-RBAC-гейт после всех хуков (Rules of Hooks).
  if (user && !ALLOWED_ROLES.includes(user.role)) {
    return (
      <AccessDenied
        allowed={ALLOWED_ROLES}
        userRole={user.role}
        title="Склад недоступен"
        message="WMS-склад открыт WAREHOUSE/CHIEF_ENGINEER (кладовщики), PROC (закупки), PM/HEAD_PM/BUH/директорам и ADMIN."
      />
    );
  }

  return (
    <div className="wh-page">
      <TopActionsBar
        kicker="Склад"
        title="Склад 2.0 (WMS)"
        subtitle={`${fmt(kpis.catalog)} позиций · ${fmt(kpis.stock_lines)} строк наличия · ${fmt(kpis.locations)} ячеек${kpis.low ? ` · ⚠️ ${kpis.low} низкий` : ''}`}
        actions={
          <>
            <Btn variant="ghost" onClick={() => { refreshCart(); refreshKpis(); }}>↻ Обновить</Btn>
          </>
        }
      />

      {/* KPI */}
      <div className="wh-kpis">
        <div className="wh-kpi wh-kpi--gold">
          <div className="wh-kpi__ic">📚</div>
          <div className="wh-kpi__v">{fmt(kpis.catalog)}</div>
          <div className="wh-kpi__l">Позиций в каталоге</div>
        </div>
        <div className="wh-kpi wh-kpi--ok">
          <div className="wh-kpi__ic">📦</div>
          <div className="wh-kpi__v">{fmt(kpis.stock_lines)}</div>
          <div className="wh-kpi__l">Строк наличия</div>
        </div>
        <div className={'wh-kpi ' + (kpis.low ? 'wh-kpi--warn' : '')}>
          <div className="wh-kpi__ic">⚠️</div>
          <div className="wh-kpi__v">{fmt(kpis.low)}</div>
          <div className="wh-kpi__l">Ниже минимума</div>
        </div>
        <div className="wh-kpi">
          <div className="wh-kpi__ic">🗺️</div>
          <div className="wh-kpi__v">{fmt(kpis.locations)}</div>
          <div className="wh-kpi__l">Ячеек хранения</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex',
        gap: 4,
        borderBottom: '1px solid var(--brd-2)',
        flexWrap: 'wrap'
      }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); setSearch(''); }}
            style={{
              padding: '11px 18px',
              cursor: 'pointer',
              border: 0,
              background: 'none',
              color: tab === t.id ? 'var(--gold)' : 'var(--t-3)',
              fontSize: 14,
              fontWeight: 600,
              borderBottom: '2px solid ' + (tab === t.id ? 'var(--gold)' : 'transparent'),
              borderRadius: 'var(--r-sm) var(--r-sm) 0 0'
            }}
          >{t.label}</button>
        ))}
      </div>

      {/* Toolbar (only for consumables/equipment) */}
      {(tab === 'consumables' || tab === 'equipment') && (
        <div className="wh-toolbar">
          <div className="grow">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder={tab === 'equipment'
                ? 'Поиск по наименованию, инв.№, серийному, бренду…'
                : 'Поиск по наименованию или артикулу…'}
            />
          </div>
        </div>
      )}

      {/* Tab content */}
      {tab === 'equipment' && (
        <EquipmentTab
          search={dSearch}
          user={user}
          cart={cart}
          onAdd={onAdd}
          onRefreshCart={refreshCart}
          onChanged={() => { refreshKpis(); refreshCart(); }}
        />
      )}
      {tab === 'consumables' && (
        <ConsumablesTab
          search={dSearch}
          user={user}
          cart={cart}
          onAdd={onAdd}
          onRefreshCart={refreshCart}
          onChanged={() => { refreshKpis(); refreshCart(); }}
        />
      )}
      {tab === 'incoming' && <IncomingTab />}
      {tab === 'locations' && <LocationsTab user={user} onChanged={refreshKpis} />}
      {tab === 'movements' && <MovementsTab />}

      {/* FAB-корзина в углу */}
      {cartEnabled && (
        <div className="wh-fab">
          {cart.items.length > 0 && (
            <div className="wh-fab__split">
              <span><b>{cart.items.length}</b> поз.</span>
              <span className="res">✅ <b>{fmt(splits.reserve)}</b> резерв</span>
              <span className="buy">🛒 <b>{fmt(splits.buy)}</b> закупка</span>
            </div>
          )}
          <button
            className="wh-fab__btn"
            title="Корзина закупки"
            onClick={() => setDrawerOpen(true)}
            aria-label="Открыть корзину закупки"
          >
            🛒
            {cart.items.length > 0 && (
              <span className="wh-fab__cnt">{cart.items.length}</span>
            )}
          </button>
        </div>
      )}

      {/* Drawer корзины */}
      <CartDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onChanged={() => { refreshCart(); refreshKpis(); }}
      />
    </div>
  );
}
