# Аудит миграции: Поставщики (v2)

Цель: дать фиксеру точный план. Страница в v2 **в основном готова** — но без проверки рантайма. Главная цель фиксера — **верификация на клоне**, не пересборка с нуля.

## 📋 Что уже есть

### Backend (`src/routes/suppliers.js`, 446 строк, монтируется как `/api/suppliers`, `/api/product-categories`, `/api/products`, `/api/price-records`)
- `GET    /api/suppliers` :38 — list (фильтры: `search`,`category`,`is_active`,`rating_gte`,`limit`,`offset`)
- `GET    /api/suppliers/:id` :54 — карточка + контакты
- `POST   /api/suppliers` :62 — create (PROC/ADMIN)
- `PUT    /api/suppliers/:id` :75 — update (PROC/ADMIN)
- `DELETE /api/suppliers/:id` :88 — soft-delete (**ADMIN only**)
- `GET    /api/suppliers/:id/contacts` :95, `POST` :100, `PUT /:cid` :117, `DELETE /:cid` :135
- `GET    /api/suppliers/:id/price-history` :142, `GET /stats` :155 (deals_count, price_points, top_items)
- `GET    /api/price-records` :347, `POST` :366, `GET /hint` :395, `GET /supplier-compare` :426
- RBAC: `READ_ROLES=[PROC,ADMIN,PM,HEAD_PM,DIRECTOR_GEN/COMM/DEV,BUH,WAREHOUSE]`, `PROC_ROLES=[PROC,ADMIN]`
- Таблица `suppliers` (V149): `id,name,inn,kpp,ogrn,phone,email,website,address,category(materials/equipment_rental/services/other),rating(1-5),notes,is_active,created_by,created_at,updated_at,deleted_at` + `idx_suppliers_name_trgm`

### Vanilla (`public/assets/js/suppliers-page.js`, 673 строк)
- `renderSuppliersTab` :83, `loadSuppliers` :130, `renderSuppliersTable` :144
- `openSupplierDetail` :164 — модалка реквизиты+контакты+статистика+история цен
- `openAddContactModal` :386, `openSupplierCreateModal` :425
- `renderPricesTab` :494 (база цен с фильтрами поиск/источник/период)

### React v2 (`public/desktop-v2-src/src/pages/SuppliersCatalog/`)
- `index.jsx` :1 — обёртка + табы + RBAC-гейт + `SuppliersTab` + `PricesTab` (415 строк)
- `api.js` — все 11 endpoint-обёрток + `CATEGORIES`/`SOURCES`/форматтеры
- `SupplierEditModal.jsx`, `SupplierDetailModal.jsx`, `PriceRecordModal.jsx`
- `suppliers-catalog.css`
- Регистрация: `App.jsx:104` (lazy) + `App.jsx:312` (Route `/suppliers-catalog`)
- Меню: `layout/nav.config.js:85` (group `resources`, иконка 🏪)

## 🆕 Что надо создать

**НИЧЕГО НОВОГО.** Страница и все 3 модалки уже есть, маршрут и nav зарегистрированы. Задача фиксера — **верификация** и закрытие дельт ниже.

## 🔗 API контракт (бэкенд уже есть — выписан 1:1)

| Endpoint | Метод | Payload | Response |
|---|---|---|---|
| `/api/suppliers` | GET | query: `search,category,is_active,rating_gte,limit,offset` | `{items:[{id,name,inn,...,contacts_count,created_by_name}]}` |
| `/api/suppliers/:id` | GET | — | `{item:{...},contacts:[...]}` |
| `/api/suppliers` | POST | `{name*,inn,kpp,ogrn,phone,email,website,address,category,rating,notes}` | `{item}` |
| `/api/suppliers/:id` | PUT | поля из allowed | `{item}` |
| `/api/suppliers/:id` | DELETE (ADMIN) | — | `{success:true}` |
| `/api/suppliers/:id/contacts` | POST | `{full_name*,role,phone,email,telegram,is_primary,notes}` | `{item}` |
| `/api/suppliers/:id/contacts/:cid` | PUT/DELETE | поля контакта | `{item}` / `{success}` |
| `/api/suppliers/:id/stats` | GET | — | `{summary:{deals_count,price_points,last_price_at},top_items:[]}` |
| `/api/suppliers/:id/price-history` | GET | `product_id,category_id,date_from,limit` | `{items:[...]}` |
| `/api/price-records` | GET/POST | фильтры/`{item_name*,unit_price*,...}` | `{items}/{item}` |

## 🎨 UI эталон

Все секции уже скопированы. Если будут расхождения, сверять с vanilla:
- Реквизиты+рейтинг+is_active checkbox: `suppliers-page.js:189-216`
- Контакты (primary star, tel/mailto/t.me ссылки): :219-241
- Статистика (deals/price_points/last_price) + Топ товаров: :245-265
- История цен (50 строк): :362-379
- Форма создания: :425-484, форма контакта: :386-423

## ⚠ Риски (что проверить, не дублировать)

1. **Покрытие vs. vanilla**: vanilla имеет `rating_gte` фильтр + `_priceFilters.date_from/to` — проверить наличие в SupplierEditModal и PriceRecordModal (v2 fix может пропустить).
2. **CSV-экспорт = v2 BONUS** (`index.jsx:144,269`) — нет в vanilla. НЕ удалять (улучшение).
3. **Sortable columns** (`index.jsx:97,218`) — v2 BONUS, оставить.
4. **Event sync**: v2 слушает `window.addEventListener('asgard:suppliers:changed')` (:116). Procurement v2 (`Procurement/api.js:288`) дёргает `/api/suppliers?limit=300` — проверить, что после CRUD из SuppliersCatalog событие диспатчится и Procurement обновляется.
5. **Линки из Procurement → карточка поставщика**: vanilla procurement-page.js использует `/api/suppliers`. В v2 Procurement пока **нет** перехода `supplier_id → /suppliers-catalog?id=`. Спецификация фичи: deep-link через query, открывающий `SupplierDetailModal`.
6. **RBAC дубликат**: список ролей зашит в `index.jsx:39` И в backend `suppliers.js:17`. При смене ролей бэкенда — синхронизировать.
7. **404 от `/stats`/`/price-history`**: vanilla глотает ошибку (`.catch(() => null)`); проверить, что api.js v2 делает то же.
8. **БД клон**: для verify pg_dump прода → `asgard_crm_test` :3100 (см. CLAUDE.md). На прод НЕ ходить.
