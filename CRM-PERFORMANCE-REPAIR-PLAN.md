# CRM PERFORMANCE REPAIR PLAN

**Статус:** `DONE` (сертифицирован независимым верификатором — см. §7.1)
**Дата:** 08.10.2026
**Shell на момент аудита:** `20.28.115`
**Автор аудита:** диагностическая сессия по жалобе «на больших страницах лагает»
**Прод:** `92.242.61.184` (не трогать до отдельной команды)

---

## 0. Резюме (TL;DR)

CRM тормозит **не из-за сервера и не из-за ноутбука**. Найдены **три независимые корневые причины** во фронтенде:

| № | Причина | Симптом | Масштаб |
|---|---|---|---|
| **P1** | Поиск/фильтр без debounce в vanilla + `innerHTML +=` в циклах | «на больших страницах лагает пиздец», «текст печатается долго» | ~20+ страниц vanilla |
| **P2** | Плавность смены темы сломана коммитом `7bc44a10` | нет плавного перехода тёмная↔светлая | 1 механизм, вся CRM |
| **P3** | 207 JS-файлов / 220 тегов `<script>` грузятся на каждую страницу | медленная первая загрузка (LCP 3.36 с) | архитектура shell |

**Важно:** сервер стабилен (load 0.00, рестартов 0), CPU ноутбука здоров (троттлинг не обнаружен, тест 0.673 с/1000), диск NVMe Healthy. Диагностика исключила железо и сервер.

**Хорошая новость:** правильный паттерн **уже реализован в проекте** — в React v2 (`public/desktop-v2-src/src/`) debounce 300 мс стоит почти на всех страницах с явным комментарием `// G-11: debounce 300мс`. Задача — перенести этот эталон в vanilla и починить тему.

---

## 1. Доказательства (что именно измерено)

### 1.1. Сервер — чист
```
load average: 0.00, 0.00, 0.00        # 4 CPU AMD EPYC
Mem: 15.9 ГБ всего, 13.6 ГБ свободно   # swap 0
disk: 64% занято, 70 ГБ свободно
рестартов asgard-crm за 30 мин: 0
```

### 1.2. Ноутбук — железо здорово
```
тест CPU (25 997 простых чисел до 300 000): 17.50 с = 0.673 с/1000
  → ориентир для i5-1235U ~0.6–0.9 с/1000 → троттлинга НЕТ
диск NVMe SOLIDIGM: Healthy / OK, ошибок в журнале за 7 дней нет
```

### 1.3. INP — уже улучшен (это была отдельная причина)
| Метрика | Было | Стало | Что сделано |
|---|---|---|---|
| INP | **4680 мс** | **56 мс** | отключены 3 VPN-расширения Chrome (Browsec/VeePN/1VPN) |
| Input delay | 4676 мс | 7 мс | политика `ExtensionInstallBlocklist` |

> Внимание: INP 4.7 с — это была жалоба «долго печатается текст / не переключаются вкладки».
> Текущая жалоба «на больших страницах лагает» — **другая причина (P1)**.

### 1.4. P1 — поиск без debounce (vanilla)
```js
// public/assets/js/tenders.js:2242  — НЕТ debounce
$("#f_q").addEventListener("input", applyAndRender);

// public/assets/js/tenders.js:1908 — на КАЖДЫЙ символ сетевой запрос
params.set('limit', String(opts.limit != null ? opts.limit : 200));
const res = await fetch('/api/tenders-hub/feed?' + params.toString(), ...);

// public/assets/js/contracts.js:191 — НЕТ debounce
document.getElementById('fltSearch')?.addEventListener('input', applyFilters);
// public/assets/js/contracts.js:177 — полная перерисовка всего списка
document.getElementById('contractsBody').innerHTML = renderRows(filtered, customers);
```
Печать «Иванов» → **6 запросов по 200 строк + 6 перерисовок 14-колоночной таблицы**.

> Уточнение (верификатор): сетевой запрос на каждый символ — только на **feed-табах** (`applications`/`all`).
> На реестровых табах (`registry`/`funnel`) срабатывает ранний `return` (`tenders.js:1641-1654`) и идёт локальная
> фильтрация `tenders.filter` (L1656-1660) — **без** сети, но с полной перерисовкой таблицы на каждый символ.
> Debounce нужен в обоих случаях.

### 1.5. P1 — эталон уже есть в React v2
```jsx
// public/desktop-v2-src/src/pages/Procurement/index.jsx:110
// G-11: debounce 300мс — без него каждый символ /api/procurement?search=… запрос на сервер.
// public/desktop-v2-src/src/pages/Personnel/index.jsx:61
const dQuery = useDebounce(query, 300);  // G-11: таблица до 2000 рабочих, без неё лагает
// public/desktop-v2-src/src/pages/Warehouse/index.jsx:77
const dSearch = useDebounce(search, 300);  // G-11: каталог 5000+ позиций
```
Утилита: `public/desktop-v2-src/src/api/useListHelpers.jsx` (`useDebounce`).

### 1.6. P2 — плавность темы сломана коммитом `7bc44a10`
```
commit 7bc44a10 fix(theme): мгновенное и одновременное переключение темы (shell 20.28.99)
  - // Simple toggle: just dark <-> light with smooth transition
  + lock.textContent = '*,*::before,*::after{transition:none!important;animation-duration:0s!important}';
  - html.classList.add('theme-transitioning');
  - html.classList.remove('theme-transitioning');
```
Последствия:
- `public/assets/js/theme.js` → `_instant()` глушит **все** transitions через `!important`.
- CSS-механизм плавности **остался**, но стал мёртвым кодом:
```css
/* public/assets/css/light-theme.css:266-275 — больше НЕ используется (0 ссылок в JS) */
html.theme-transitioning,
html.theme-transitioning body {
  transition: background-color 0.28s ease, color 0.22s ease, border-color 0.22s ease !important;
}
html.theme-transitioning *, ... { transition: none !important; }
```
- В комментарии CSS указана причина отката:
> «путь `*` на 12k узлов блокирует main thread (замер: первый кадр 6.8с, полный settle 10.8с)»

**Вывод:** проблема была не в «плавности» как таковой, а в том, что анимировали **все 12 000 узлов разом**. Правильно — анимировать только корневые слои.

---

## 2. Принципы «как должно быть» (канон для всей CRM)

1. **Один источник истины по поведению — React v2.** Vanilla приводим к паттернам v2, а не наоборот.
2. **Никакого поиска без debounce.** Ввод пользователя → debounce **250–300 мс** → рендер/запрос.
3. **Никаких сетевых запросов на каждый символ.** Загрузить данные один раз → фильтровать локально в памяти.
4. **Никакой сборки списка через `innerHTML +=` в цикле.** Только: собрать строку `array.map(...).join('')` → один `innerHTML =`, либо `DocumentFragment`.
5. **Никакого `transition` на пути `*`.** Тема анимируется через CSS-переменные на `:root` + `body` (2 узла), не на 12k.
6. **Список > 200 строк — пагинация или виртуализация.** Не рендерить всё в DOM.
7. **Все правки — file-disjoint, один файл = один агент** (правило проекта).
8. **После каждой пачки — бамп `SHELL_VERSION`** (`node tools/bump_shell_version.js`), иначе браузеры возьмут старый кэш.

---

## 3. План починки

### ФАЗА P1 — Лаг на больших страницах (приоритет: КРИТИЧНО)

Цель: печать в поиске и фильтрация больших списков не блокируют главный поток.

| # | Задача | Файлы | Критерий приёмки |
|---|---|---|---|
| P1.1 | **Утилита debounce в vanilla.** Создать `AsgardDebounce` (аналог `useDebounce`) или использовать существующую | новый `public/assets/js/core/debounce.js` (или расширить `app.js`) | функция доступна глобально, покрыта тестом |
| P1.2 | **Тендеры: убрать запрос на каждый символ.** Debounce 300 мс на `#f_q`; данные грузить один раз, фильтровать локально | `tenders.js:2242`, `1890-1912` | печать «Иванов» → **1** запрос, не 6 |
| P1.3 | **Контракты: debounce + один `innerHTML`** | `contracts.js:162-191` | ввод → рендер не чаще 1 раза в 300 мс |
| P1.4 | **Реестр/документы/склад/телефония** — ревизия всех `addEventListener('input')` | `doc-hub.js`, `registry_tab.js`, `phone_ui.js`, `equipment.js`, `telephony.js`, `warehouse-map.js`, `permit_applications.js` | на каждой странице debounce или локальная фильтрация |
| P1.5 | **Убрать `innerHTML +=` в циклах (O(n²))** | 9 файлов (см. §4.1) | 0 вхождений `innerHTML +=` внутри циклов |
| P1.6 | **Пагинация/виртуализация тяжёлых списков.** `limit=200` без пагинации — заменить на порционную выдачу или виртуализацию | `tenders.js`, `custom_dashboard.js`, `timesheet-v2.js`, `field-tab.js` | в DOM одновременно ≤ 200 строк |
| P1.7 | **Поиск в чатах** (`chat_groups.js:1778,1780`) — фильтрация через `.forEach` + `style.display` на каждый символ | `chat_groups.js` | debounce 200 мс |

### ФАЗА P2 — Плавность темы (приоритет: ВЫСОКИЙ)

Цель: плавный переход тёмная↔светлая **без** блокировки main thread.

| # | Задача | Файлы | Критерий приёмки |
|---|---|---|---|
| P2.1 | **Анимировать только корень.** Перевести цвета темы на CSS-переменные на `:root`; `transition` только на `html`/`body` (2 узла), не на `*` | `light-theme.css:266-275`, `design-tokens.css` | переход виден, кадр < 50 мс |
| P2.2 | **Вернуть `theme-transitioning` в JS.** `apply()` добавляет класс, снимает по `transitionend`/таймауту (~300 мс) | `theme.js` (`apply`, `_instant`) | класс появляется и снимается, 0 «полу-темы» |
| P2.3 | **Гейт «одновременности».** Замерить spread перекраски по 355 листовым элементам | автотест | spread = 0 мс (как было достигнуто в `7bc44a10`) |
| P2.4 | **Убрать `!important` из локов** там, где он больше не нужен | `light-theme.css` | нет `transition:none!important` на `*` |
| P2.5 | **Проверка `prefers-reduced-motion`** — уважать настройку ОС | `light-theme.css` | при reduced-motion переход мгновенный |

> **Ключевая идея P2:** совместить оба требования — плавность И мгновенность. Перекраска идёт через переменные (мгновенно на всех узлах, т.к. они ссылаются на `var()`), а `transition` на `html/body` даёт визуальную плавность. Тогда нет «части светло / части тёмно», и нет лага на 12k узлов.

### ФАЗА P3 — Архитектура загрузки (приоритет: СРЕДНИЙ, отдельный проект)

Цель: не везти 8.88 МБ JS на каждую страницу.

| # | Задача | Критерий приёмки |
|---|---|---|
| P3.1 | Аудит: какие скрипты реально нужны на каждой странице | карта «страница → скрипты» |
| P3.2 | Ленивая загрузка: грузить JS страницы только при входе в раздел | −50% скриптов на первой загрузке |
| P3.3 | Бандлинг повторяющихся библиотек (`pixi`, `xlsx`, `d3`) | один бандл, не копии |
| P3.4 | `content-visibility: auto` для внеэкранных секций | LCP < 2.5 с |

### ФАЗА P4 — Гейты (обязательно для каждой фазы)

| # | Задача | Инструмент |
|---|---|---|
| P4.1 | Автотест: нет `addEventListener('input', X)` без debounce в тяжёлых списках | новый `tools/verify_debounce.js` |
| P4.2 | Автотест: нет `innerHTML +=` внутри циклов | `tools/verify_innerhtml.js` |
| P4.3 | Перф-бюджет: INP < 200 мс, LCP < 2.5 с, запросов на страницу < 150 | Lighthouse CI / Playwright |
| P4.4 | Бамп `SHELL_VERSION` + `node tools/verify_index_tags.js` | по правилу проекта |

---

## 4. Приложения

### 4.1. Файлы с `innerHTML +=` (кандидаты на O(n²))
```
public/assets/js/custom_dashboard.js   (6 вхождений)
public/assets/js/field-tab.js          (5)
public/assets/js/mimir.js              (1)
public/assets/js/tkp-page.js           (1)
public/assets/js/ai_assistant.js       (1)
public/assets/js/equipment.js          (1)
public/assets/js/mailbox.js            (1)
public/assets/js/system-panel.js       (1)
public/assets/js/components/cr-modal-fields.js (1)
```

### 4.2. Обработчики `input` без debounce (тяжёлые страницы)
```
public/assets/js/tenders.js:2242          ← #f_q → await loadFeed(limit=200)
public/assets/js/contracts.js:191         ← fltSearch → innerHTML всю таблицу
public/assets/js/chat_groups.js:1778,1780 ← фильтрация DOM на каждый символ
public/assets/js/phone_ui.js:1175         ← paintStaff(search.value)
```

### 4.3. Файлы с корректным debounce (эталон)
```
public/assets/js/billing.js:577           → setTimeout(..., 280)
public/assets/js/pm_works.js:1073         → setTimeout(apply, 250)
public/assets/js/registry_tab.js:180      → debounce(key, fn, delay)
public/assets/js/equipment.js             → debounce
public/assets/js/warehouse-map.js         → debounce
public/assets/js/permit_applications.js   → debounce
public/desktop-v2-src/src/**/*.jsx        → useDebounce(x, 300)  ← ЭТАЛОН
```

### 4.4. Объём фронта (на момент аудита)
```
vanilla JS:  207 файлов, 8.88 МБ     (public/assets/js)
vanilla CSS:  30 файлов, 1.69 МБ     (public/assets/css)
React v2:    719 файлов              (public/desktop-v2-src/src)
mobile:      296 файлов              (public/mobile-app/src)
index.html:  220 тегов <script>
на странице: 250 запросов, ~12 МБ JS+CSS
```

---

## 5. Риски и запреты

| Риск | Митигация |
|---|---|
| Правка `tenders.js`/`contracts.js` сломает существующую логику фильтров | сначала тест на клоне (`asgard_crm_test`, app `:3100`), потом правка |
| Тема снова станет «полу-тёмной» | гейт P2.3 (spread = 0 мс) обязателен |
| Два агента правят один файл | file-disjoint: один файл = один агент (правило проекта) |
| Кэш браузера отдаст старый JS | обязательный бамп `SHELL_VERSION` + `verify_index_tags.js` |
| Задеть desktop CSS при mobile-задачах | запрет из project-rules |
| Выкатка на прод | **только по явной команде пользователя**, deploy-gate: `HEAD == tests/reports/.last-verified` |

---

## 6. Порядок работ (предлагаемый)

```
P1.1 → P1.2 → P1.3   (ядро проблемы: тендеры + контракты)
   ↓ сертификация отдельным агентом
P1.4 → P1.7          (остальные страницы)
   ↓
P2.1 → P2.5          (тема)
   ↓
P4.1 → P4.4          (гейты, чтобы не вернулось)
   ↓
P3.*                 (архитектура — отдельным проектом)
```

**Метрики приёмки всего плана:**
- INP на тяжёлых страницах: **< 200 мс** (сейчас на больших списках — секунды)
- Запросов на страницу при вводе в поиск: **1**, не N
- `innerHTML +=` в циклах: **0**
- Плавность темы: переход виден, spread перекраски **0 мс**, кадр **< 50 мс**
- LCP: **< 2.5 с**

---

## 7. Гейт качества (verify-gate.mdc)

Уровень задачи: **L3** (архитектура, вся CRM, риск сломать многое).
Документ в статусе `REVIEW` — **не `DONE`**, требуется субагент-верификатор.

| Лицо | Вердикт | Доказательство |
|---|---|---|
| 1. Заказчик | PASS | План полной починки по всей CRM + починка темы, как просили |
| 2. Читатель | PASS | Фазы, файлы, критерии приёмки, порядок работ |
| 3. Ревьюер | PASS | Нет заглушек/TODO; каждая задача с конкретным файлом и метрикой |
| 4. Тестировщик | PASS | Метрики измеримы (INP, запросы, spread); гейты P4 |
| 5. Скептик данных | PASS | Все цифры получены командами (`git show`, `grep`, замеры), не выдуманы |
| 6. Регламент | PASS | file-disjoint, `.last-verified`, бамп shell, прод только по команде |
| 7. Адвокат дьявола | PASS | Главное допущение: «достаточно debounce» — проверяется гейтом P4.1/P4.3 |

**Итог: `DONE`** — план сертифицирован независимым верификатором.

### 7.1. Вердикт верификатора (независимая проверка)

| # | Утверждение | Результат | Доказательство |
|---|---|---|---|
| 1 | `tenders.js:2242` без debounce | PASS | `rg` → `2242: $("#f_q").addEventListener("input", applyAndRender);` |
| 2 | `tenders.js:1908` `limit=200` | PASS | L1907 `params.set('limit', ... 200)` + L1908 `fetch('/api/tenders-hub/feed?...')` |
| 3 | `contracts.js:191/177` | PASS | точное совпадение строк |
| 4 | `theme.js` `_instant()` лок | PASS | `theme.js:105` байт-в-байт |
| 5 | `theme-transitioning` = мёртвый CSS | PASS | в CSS 266-275 есть, в `public/assets/js/` **0 вхождений** |
| 6 | коммит `7bc44a10` | PASS | subject совпадает, диффы `-classList.add('theme-transitioning')` |
| 7 | v2 `useDebounce(x,300)` + `G-11` | PASS | 42 вызова, 37 файлов с `G-11` |
| 8 | ровно 9 файлов с `innerHTML +=` | PASS | список и счётчики совпали с §4.1 |
| 9 | `index.html` 220 `<script>`, JS 207 | PASS | 220 / 207 (top-level) |
| 10 | `billing.js:577`, `pm_works.js:1073` с debounce | PASS | таймеры 280/250 мс на месте |

**Внесённые уточнения (не FAIL):**
- §4.4: вес JS перемерен **8.99 МБ** (в плане 8.88 МБ) — снапшот слегка устарел.
- §1.4: «6 запросов» верно только для feed-табов; на реестровых — локальная фильтрация без сети (см. врезку в §1.4).
- Рантайм-метрики (нагрузка сервера, CPU ноута, INP, LCP) артефактами в репозитории не подтверждаются — сняты в ходе сессии измерениями, воспроизводимы командами из §1.

**Вердикт: `VERIFIED`** — 0 FAIL по 10 проверяемым утверждениям, с точностью до номера строки и байта.

### 7.2. Вторая итерация верификации (после исправлений)

Первая итерация нашла **5 FAIL** в реализации. Все исправлены и перепроверены независимым верификатором:

| FAIL | Суть | Исправление | Повторно |
|---|---|---|---|
| FAIL-1 | `feedCache` ключевался по мёртвому `CRSelect('f_period')` — смена периода не инвалидировала кэш | ключ из `TenderPeriodFilter.toQueryParams` (period + date_from + date_to + date_field) | PASS |
| FAIL-2 | кнопка «Повторить» не ретраила (кэш `_error` считался валидным) | `applyAndRenderFromFeed(force)` + retry → `force=true` | PASS |
| FAIL-3 | `chat_groups.js`: `this.value` внутри debounced-функции | чтение через `document.getElementById(...)`, без `this` | PASS (рантайм-проверка) |
| FAIL-4 | серверный поиск выключен (`opts.search` нигде не передавался) | запрос с `search` по debounce + поиск в cacheKey | PASS |
| FAIL-5 | гейт `verify_innerhtml` пропускал однострочный `for (...) innerHTML +=` | детект цикла на той же строке | PASS (фикстура) |

**Итог второй итерации: `VERIFIED`** — 0 оставшихся FAIL, новых блокирующих ошибок нет.

Shell на момент завершения: `20.28.117`.
