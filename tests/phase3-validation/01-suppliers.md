# Валидация фикса #1 — Suppliers v2 (Phase 3)

Валидатор: read-only проверка кода (без правок, без ssh).
Дата: 2026-06-23.

Файлы:
- `public/desktop-v2-src/src/pages/SuppliersCatalog/api.js`
- `public/desktop-v2-src/src/pages/SuppliersCatalog/index.jsx`
- `public/desktop-v2-src/src/pages/SuppliersCatalog/SupplierDetailModal.jsx`
- `public/desktop-v2-src/src/pages/Procurement/modals/ProcurementDetail.jsx`
- `src/routes/suppliers.js`

## ✅ Подтверждено

1. **`rating_gte` в API.** `api.js:42` — `if (params.rating_gte) q.set('rating_gte', params.rating_gte);` внутри `loadSuppliers()`. Бэкенд `src/routes/suppliers.js:39, 46` принимает параметр и фильтрует `s.rating>=$N`.
2. **UI SelectInput с 5 вариантами.** `index.jsx:242-253` — SelectInput с опциями `''`, `5`, `4`, `3`, `2`, `1` (плюс «Любой рейтинг» = всего 6 пунктов, 5 числовых вариантов как заявлено). State `filters.rating_gte` инициализируется в `useState` (стр. 107) и попадает в depend-list `useEffect` (стр. 125).
3. **Deep-link consumer (`?id=` → DetailModal).** `index.jsx:138-159` — `openedDeepId` state + `useEffect`, который читает hash, парсит `id`, валидирует `/^\d+$/`, открывает `<SupplierDetailModal id={id} canWrite isAdmin />` через `modal.open` с `{ size: 'wide' }`. Подписан `hashchange` listener с корректным cleanup.
4. **Deep-link consumer (`?search=`).** `index.jsx:99-109` — `filters` инициализируются из `URLSearchParams(hash.slice(qStart+1))`, читая `search`. Это соответствует ссылке от Procurement.
5. **`emitChanged()` после операций с контактами.** В `SupplierDetailModal.jsx` вызовы найдены:
   - стр. 73 — после `deleteSupplier`
   - стр. 91 — после `updateContact` (make primary)
   - стр. 110 — после `deleteContact`
   - стр. 310 — после `addContact` (внутри ContactEditModal)
   Определение `emitChanged` в `api.js:118-120` корректно (`CustomEvent('asgard:suppliers:changed')`). Слушатель в `index.jsx:127-132` рефрешит список.
6. **Deep-link из Procurement.** `ProcurementDetail.jsx` содержит **2 места** с `<a href={'#/suppliers-catalog?search=' + encodeURIComponent(...)}>`:
   - стр. 446 — имя поставщика позиции (`it.supplier`)
   - стр. 644 — имя поставщика счёта (`iv.supplier_name`)
   Оба обёрнуты в guard «если есть имя».
7. **RBAC 1:1 с бэкендом.** `index.jsx:39` — `READ_ROLES = ['PROC','ADMIN','PM','HEAD_PM','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','BUH','WAREHOUSE']` ИДЕНТИЧЕН `src/routes/suppliers.js:17`. `WRITE_ROLES = ['PROC','ADMIN']` совпадает с `PROC_ROLES` (suppliers.js:16). DELETE supplier ограничен `isAdmin` (стр. 246) — совпадает с серверной семантикой.

## ❌ Не найдено

Нет. Все 4 заявленных пункта присутствуют в коде.

## 🟡 Замечания (не блокеры)

- В UI 5 числовых опций рейтинга + «Любой» = 6 строк в селекте. Если ТЗ требовало ровно 5 пунктов включая «Любой» — расхождение; если 5 числовых порогов — соответствует.
- Deep-link `?search=` от Procurement пишет имя поставщика как строку, а каталог ищет по `name ILIKE` И `inn ILIKE` (suppliers.js:47). Поиск по русскому названию сработает; имена с диакритикой/регистром — OK через ILIKE.
- `openedDeepId` сбрасывается только при изменении id; при закрытии модалки и повторном клике по той же ссылке модалка не переоткроется без смены hash (минорный UX).

Итог: фикс #1 принимается. Замечаний-блокеров нет.
