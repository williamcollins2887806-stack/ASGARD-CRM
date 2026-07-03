# 04 · Mobile Marketplace заявок для РП — план

## Что уже есть (готово на бэке + desktop)

### Backend `src/routes/pre_tenders.js` (префикс `/api/pre-tenders`)
- `MARKETPLACE_LIMIT = 5`, `PM_ROLES_MARKETPLACE = ['PM','HEAD_PM']` — pre_tenders.js:38-41.
- `MARKETPLACE_ACTIVE_STATUSES = ['new','in_review','need_docs','pending_approval','approved']`.
- `MARKETPLACE_CLAIMABLE_STATUSES = ['new','in_review','need_docs']` — pre_tenders.js:39-40.
- `GET /my-stats` (RBAC PM/HEAD_PM) → `{ active_count, limit:5, breakdown, can_claim }` — pre_tenders.js:232-243.
- `POST /:id/claim` (PM/HEAD_PM, транзакция `FOR UPDATE`) — pre_tenders.js:251-381. 409: `already_claimed` {claimed_by_name}, `not_claimable` {current_status}, `limit_reached` {current_count, limit}. Возвращает `{ success, item, card_id, redirect_to: '#/personal-kanban?card=X' }`. Broadcast `pre_tender:claimed {id, claimed_by_id, claimed_by_name}` + уведомления HEAD_PM/директорам.
- `POST /:id/transfer` (PM/HEAD_PM/ADMIN/DIR_*) body `{to_user_id, reason}` — pre_tenders.js:389-525. 409: `recipient_limit_reached`, `already_owns`. PM передаёт только свои.
- FIFO лента: `GET /api/pre-tenders?unassigned=1&sort=created_at&order=ASC` — pre_tenders.js:115-129.

### Vanilla эталон `public/assets/js/director_inbox.js`
- `_mode='marketplace'` для PM/HEAD_PM — :829. Заголовок «Маркетплейс заявок», motto «FIFO. Кто первый встал...» — :834-836.
- `loadMyStats()` :154-160, `claimPreTender(ptId, btn)` :404-446 (confirm → POST claim → toast 409-варианты).
- Подписка `window._asgardSSE` на `pre_tender:claimed` (удаление карточки + toast «опередил») — :455-470.
- Бейдж `di-stat-badge` X/N — :293-302, :331-335.

### Desktop v2 эталон `public/desktop-v2-src/src/pages/DirectorsInbox/`
- `MarketplaceList.jsx` — карточка с AI-цветом, FIFO лента, кнопка «🎯 Забрать себе», обработка 409, singleton EventSource `window.__asgardMarketplaceSSE`, события `pre_tender:claimed/transferred/new`.
- `MyStatsBadge.jsx` — «У вас X / 5», золото/красный при лимите.
- `api.js`:105-118 — `MARKETPLACE_LIMIT=5`, `PM_MARKETPLACE_ROLES=['PM','HEAD_PM']`, `inferModeFromRole()`.

### Mobile текущее
- `public/mobile-app/src/pages/DirectorsInbox.jsx` — **только директорский режим**. `canAssign` для `['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','HEAD_PM']` (DirectorsInbox.jsx:73). PM режим отсутствует. Дёргает `/api/inbox-applications`, не `/api/pre-tenders`.
- `App.jsx:352-363` — Route `/director-inbox` под `<ProtectedRoute section="inbox">`.
- RBAC `config/rbac.js`:4-5 — `inbox` есть у HEAD_PM, **нет у PM**.
- SSE-хук `hooks/useSSE.js` — фиксированный список chat-каналов; pre_tender:* не подписан. Реконнект 3с.
- `More.jsx`:113 — пункт «Корзина заявок» (section `inbox`), PM не видит.

## Что надо сделать в mobile

1. **Новая страница** `public/mobile-app/src/pages/MarketplaceMobile.jsx` (рекомендуется отдельно, не смешивать с DirectorsInbox — режимы концептуально разные, vanilla тоже разделяет по `_mode`).
2. **Route** `/marketplace` в `App.jsx` под `<ProtectedRoute section="marketplace">`.
3. **RBAC** `config/rbac.js`: добавить новую секцию `'marketplace'` в `PM` и `HEAD_PM`; ROUTE_SECTIONS: `'/marketplace':'marketplace'`.
4. **Нав-меню** `More.jsx` группа `docs`: пункт `{ path:'/marketplace', icon:Target, label:'Маркетплейс заявок', section:'marketplace' }`.
5. **UI** карточки: AI-цвет border-left, customer_name/ai_summary/sum/deadline, кнопка «🎯 Забрать» (spring-tap, gold-gradient). PullToRefresh. Бейдж `MyStatsBadge` X/5 в шапке (`PageShell` actions slot или фикс-блок).
6. **SSE**: `useSSE` НЕ подходит (жёсткий chat-список). Открыть свой EventSource внутри страницы (как в `PersonalKanban.jsx`:192) с событиями `pre_tender:claimed` (filter, удалить карточку, toast «опередил Х»), `pre_tender:new` (silent refresh), `pre_tender:transferred` (noop).
7. **Transfer modal** (опционально для PM/HEAD_PM): BottomSheet выбор получателя из `/users?role=PM` + `role=HEAD_PM`, поле reason, POST `/:id/transfer`. На маркетплейс-странице может не нужен — transfer актуален на `PersonalKanban` (там карта уже забранной заявки).

## API контракт
Работает «как есть»: `GET /api/pre-tenders?unassigned=1&sort=created_at&order=ASC`, `GET /api/pre-tenders/my-stats`, `POST /api/pre-tenders/:id/claim`, `POST /api/pre-tenders/:id/transfer`, SSE `/api/sse/stream` события `pre_tender:claimed|transferred|new`. **Бэк менять не надо**.

## UI эталон (скопировать)
- Логика claim + обработка 409: `MarketplaceList.jsx`:109-159 (`onClaim`).
- SSE singleton + handlers: `MarketplaceList.jsx`:57-107.
- FIFO sort + EmptyState + лимит-баннер: `MarketplaceList.jsx`:189-225.
- Mobile-стили: переиспользовать `BottomSheet`, `SkeletonList`, `PullToRefresh`, `spring-tap`, `var(--gold-gradient)`, `var(--border-norse)` из текущего DirectorsInbox.jsx.

## Риски
- **Дублирование EventSource** — Chat/ChatView/PersonalKanban уже открывают свои. Использовать singleton по `window.__asgardMobileMarketplaceSSE` чтобы не плодить коннекты при ре-маунте.
- **HEAD_PM в двух ролях** — на desktop инфер mode по приоритету `director` (api.js:115). На mobile: HEAD_PM нужен И `/director-inbox` И `/marketplace`. Оставить обе секции (`inbox` + `marketplace`).
- **Лимит race** — backend защищён транзакцией; фронт оптимистично уменьшает список, на 409 `limit_reached` показывает toast и `refresh(silent)`.
- **`redirect_to: '#/personal-kanban?card=X'`** — vanilla hash-роут. На react-router заменить на `navigate('/personal-kanban?card=X')`.
- **PinGuard** — Route обернуть как остальные (App.jsx:355-360).
- **iOS Safari EventSource** — при background tab пауза; реконнект из `useSSE.js`:42-53 как образец.
- **CLAUDE.md ФАЗА 2 правило file-disjoint** — `rbac.js` и `App.jsx` правит ровно один агент; новая страница `MarketplaceMobile.jsx` — отдельный файл, изолированно.
