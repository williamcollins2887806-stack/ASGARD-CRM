# 🏗 АСГАРД CRM 2.0 — Архитектура внедрения

> **Решение:** v2 становится основным приложением, vanilla остаётся в `/legacy/` как fallback.
> **URL'ы:** старые `#/route` ведут в v2 если страница готова, иначе → `/legacy/#/route`.

---

## 📋 Текущее состояние (DO)

```
asgard-crm.ru/
├── /              → public/index.html (vanilla — 110+ страниц)
├── /m/            → React mobile-app (НЕ трогаем)
├── /field/        → vanilla Field PWA (НЕ трогаем сейчас)
└── /v2/           → Vite/React приложение (КАТАЛОГ + home + dashboard + 2 другие)
```

## 🎯 Целевое состояние (TO BE)

```
asgard-crm.ru/
├── /              → /v2/ (редирект)
├── /v2/           → Vite/React приложение (ВСЕ 121 страница)
├── /legacy/       → public/index.html (vanilla — fallback на переходный период)
├── /m/            → React mobile (как было)
└── /field/        → vanilla Field PWA (миграция позже)
```

---

## 🚦 Маршрутизация (как hash-роуты перенаправляются)

### Принцип

Старые URL'ы типа `https://asgard-crm.ru/#/tenders` должны:
- Открыть **v2 версию** если страница уже переписана
- Открыть **legacy версию** если ещё нет (на переходный период)

### Реализация

В `/v2/src/App.jsx` — Routes для готовых страниц, для остальных автоматический redirect на legacy:

```jsx
// Готовые v2 страницы
<Route path="/home" element={...} />
<Route path="/dashboard" element={...} />
<Route path="/modals" element={...} />
<Route path="/to-calcs" element={...} />
<Route path="/head-to-approvals" element={...} />
<Route path="/tenders" element={...} />      ← добавится после переписи
<Route path="/pm-works" element={...} />     ← добавится после переписи
// ...

// Catch-all — редирект в legacy
<Route path="*" element={<RedirectToLegacy />} />
```

```jsx
function RedirectToLegacy() {
  const loc = useLocation();
  useEffect(() => {
    window.location.href = '/legacy/' + window.location.search + '#' + loc.pathname;
  }, []);
  return <div>Перенаправление в legacy-версию…</div>;
}
```

### Сервер (Fastify) — изменения

В `src/index.js` (минимальные):

1. **`/` → редирект на `/v2/`** (один lineimal `fastify.get('/', (_, reply) => reply.redirect('/v2/'))`)
2. **`/legacy/` → отдаёт оригинальный `public/index.html`** (статикой, как сейчас работает `/`)
3. **`/legacy/assets/*` → отдаёт `public/assets/*`** (уже работает через fastify-static)
4. **`/v2/`, `/v2/assets/*` → отдаёт `public/v2/...`** (уже работает)

Реализация:

```js
// Главная — редирект на v2
fastify.get('/', async (_, reply) => reply.redirect(302, '/v2/'));

// Legacy — alias для старой версии
fastify.get('/legacy', async (_, reply) => reply.redirect(302, '/legacy/'));
fastify.get('/legacy/', async (req, reply) => {
  // Отдаём оригинальный index.html
  return reply.sendFile('index.html');
});

// Legacy assets — те же что для основной (которые сейчас на /)
// Они уже работают через @fastify/static с root=public
```

---

## 🔁 Compat-layer (опционально для переходного периода)

Если хотим чтобы legacy-страницы тоже получили красивые модалки:

В `public/index.html` (legacy) дополнительно подключить:

```html
<!-- Загрузим React + compat-layer перед основным app -->
<script type="module" src="/v2/assets/index-XXX.js"></script>
<script>
  // Ждём загрузки и активируем замену AsgardUI
  window.addEventListener('AsgardV2Ready', () => {
    window.AsgardUI2_installCompat({ replace: true });
  });
</script>
```

**Эффект:**
- ВСЕ `AsgardUI.confirm/prompt/showModal/toast` в vanilla автоматом → React-модалки
- Кастомные модалки с raw-HTML — внутри HTML старый, но рамка/кнопки новые

**Минусы:**
- Дополнительный bundle на legacy (108 KB gzip JS)
- Custom-formes выглядят как «новая рамка + старая форма внутри»

**Плюс:** мгновенный визуальный апгрейд на ВСЕХ страницах сразу.

---

## 📦 Структура проекта после миграции

```
public/
├── index.html                          ← legacy entry (vanilla)
├── /assets/                            ← vanilla JS/CSS (как было)
├── m/                                  ← mobile React (как было)
├── field/                              ← field PWA (как было)
├── v2/                                 ← собранное React app (build artifact)
└── desktop-v2-src/                     ← исходники React app
    ├── package.json
    ├── vite.config.js
    ├── DESIGN_SYSTEM.md                ← документ для разработчиков
    ├── MIGRATION_MAP.md                ← карта 121 страницы
    ├── ARCHITECTURE.md                 ← этот документ
    └── src/
        ├── main.jsx
        ├── App.jsx                     ← роутер
        ├── api/                        ← client.js, useAuth.jsx
        ├── theme/                      ← ThemeProvider
        ├── layout/                     ← AppShell
        ├── modals/                     ← 30+ модалок
        ├── inputs/                     ← 22 инпута
        ├── blocks/                     ← 9 блоков
        ├── widgets/                    ← виджеты Home
        ├── components/                 ← переиспользуемые (StackedBar)
        ├── styles/                     ← 11 CSS файлов
        └── pages/                      ← 121 страница
            ├── Home/
            ├── Dashboard/
            ├── Tenders/                ← (после переписи)
            ├── PmWorks/                ← (после переписи)
            └── ...
```

---

## 🚀 Этапы развёртывания

### Этап 0 (готово)
- ✅ Каталог компонентов
- ✅ ModalProvider
- ✅ Compat-layer (готов в коде, не активирован)
- ✅ Home + Dashboard + 2 страницы

### Этап 1 (эта сессия)
- ✅ MIGRATION_MAP.md
- ✅ DESIGN_SYSTEM.md
- ✅ ARCHITECTURE.md
- ⏳ Эталон `/home` (полная перепись)

### Этап 2 (следующие сессии — без агентов)
- ⏳ Сервер: редирект `/` → `/v2/`, маршрут `/legacy/`
- ⏳ В v2 App.jsx: catch-all redirect на legacy
- ⏳ Эталоны: `/tenders`, `/pm-works`, `/pm-calcs`
- ⏳ Опционально: compat-layer на legacy

### Этап 3 (волны агентов)
- ⏳ Волна 1: 10 страниц параллельно
- ⏳ Волна 2-4: 90+ страниц
- ⏳ Field PWA: отдельная подкоманда

### Этап 4 (финал)
- ⏳ Удаление legacy (через 3-6 месяцев после раскатки)
- ⏳ Cleanup vanilla JS/CSS

---

## 🛡 Откат (если что-то критично сломается)

1. Удалить редирект `/` → `/v2/` в `src/index.js`
2. `/` снова отдаёт `public/index.html` (vanilla)
3. **Готово** — всё вернулось как было

Срок отката: **2 минуты** (один git revert + systemctl restart).

---

## 🧪 Тестирование

### Перед каждой раскаткой страницы

1. Локально: открыть `https://asgard-crm.ru/v2/#/route` — проверить визуал
2. В обеих темах (☀️ + 🌙)
3. На 3 разрешениях: 1920px / 1280px / 768px (планшет)
4. Все формы / модалки работают
5. API-запросы идут на правильные endpoints
6. RBAC проверки (роли видят что должны)

### После каждой раскатки страницы

7. Production smoke-test: открыть `https://asgard-crm.ru/#/route` — должен открыться v2
8. Проверить что hash-маршрут сохранился (никаких `#/v2-route` или `#/new-route`)

---

## 🔐 RBAC

Роли проверяются как раньше — в компоненте через `useAuth().user.role`:

```jsx
import { useAuth } from '@/api/useAuth';

function MyPage() {
  const { user } = useAuth();
  if (!['ADMIN', 'TO', 'HEAD_TO'].includes(user.role)) {
    return <AlertModal tone="error" title="Нет доступа" message="..." />;
  }
  // ...
}
```

В роутере (опционально, для централизованных проверок):

```jsx
<Route path="/tenders" element={
  <Protected title="Тендеры" roles={['ADMIN', 'TO', 'HEAD_TO']}>
    <Tenders />
  </Protected>
} />
```

---

## 📊 Метрики успеха раскатки

- **Bundle size**: <150 KB gzip JS (сейчас 108 KB)
- **Lighthouse Performance**: >90 на /home, /dashboard, /tenders
- **First Load**: <1.5 сек на 4G
- **Темы переключаются**: <50ms без перерисовки flash
- **0 console.error** на любой странице
- **0 фантомных модалок** в стеке после закрытия
