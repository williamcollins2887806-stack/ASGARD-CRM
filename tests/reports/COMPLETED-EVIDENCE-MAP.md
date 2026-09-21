# R0. Карта доказательств по 30 пунктам, помеченным `completed`

Составлено 21.09.2026. Метод: машинная классификация каждого гейта, на который ссылается
пункт плана (не чтение статуса, а разбор кода гейта). Основание — правило проекта
«слово агента != сделано»: доказательством DONE может быть только живой прогон.

## Классификатор (по коду гейта)

| Класс | Признак в файле | Чем является |
| --- | --- | --- |
| **LIVE-UI** | `require('playwright')` + `127.0.0.1:3xxx` + `page.goto(BASE)` | живой браузер против реального сервера и БД |
| **LIVE-API** | `127.0.0.1:3xxx` + `fetch`/`pg`, без playwright | живые запросы к серверу, но без UI |
| **FILE://** | `page.goto('file:///...')` | статический стенд, собранный из файлов |
| **FILE://+ПОДМЕНА** | `file://` + `window.AsgardX = Object.assign({}, real, {...})` | стенд, где API подменён заглушками |
| **STATIC/UNIT** | без браузера и без базы | проверка текста файлов или модульный тест |

## Результат классификации всех 25 гейтов, цитируемых планом

### LIVE-UI — живой браузер, принимается как доказательство

- `tests/ofs-full-chain-browser-e2e.js` (58 шагов) — но см. пункт 3 ниже про шим
- `tests/doc-hub-gate-e2e.js`, `tests/doc-hub-roles-e2e.js`, `tests/doc-hub-full-roles-e2e.js`
- `tests/browser/e2e/99-console-audit.spec.js` — живой, BASE по умолчанию `:3100`
- `tools/verify_c1c3_browser.js`, `tools/verify_c6_degrade.js`, `tools/verify_d3_desktop.js`
- `tools/verify_d1_dir_modal.js`, `tools/verify_d2_live.js`
- `tools/verify_brigade_cart.js`, `tools/verify_tasks_render.js`

### LIVE-API — живые запросы к серверу, UI не проверяется

`tools/verify_assembly_flow.js`, `tools/verify_c5_parser.js`, `tools/verify_c5_stability.js`,
`tools/verify_d1_dir_queue.js`, `tools/verify_tkp_full_template.js`.

Для C5 (AI-парсер) это приемлемо: критерий плана — совпадение `product_id` и latency,
он измеряется по API естественно.

### FILE:// + ПОДМЕНА API — НЕ является доказательством работы сервера

| Файл | Что подменяет |
| --- | --- |
| `tools/verify_registry_row_form.js` | `window.AsgardRegistryApi = Object.assign({}, real, {...})` — `loadRegistry`, `createRegistryRow`, `assignRegistryAnalysis`, `patchRegistryField` и др. отдают заготовки |

Этот гейт проверяет **только UI-логику** `registry_tab.js` при заранее заданных ответах.
Реальный бэкенд в нём не участвует вовсе.

### FILE:// стенды — статические, сервера нет

`tools/verify_rp_modal_render.js` (рукописный `harness()` + `<link file:///…>` для проверки
каскада CSS и скролла), `tools/verify_rp_calc_improvements.js`, `tools/verify_vat22_ui.js`,
`tools/verify_tkp_full_form.js`, `tools/verify_analysis_checklist.js` (двойник на `:3200`).

### STATIC/UNIT

`tools/verify_content_type_guard.js` (AST-анализ исходников), `tools/verify_mail_killswitch.js`
(модульный), `tools/verify_index_tags.js` (разбор `index.html`).

## Таблица 30 пунктов

| Пункт | Основание доказательства | Класс | Вердикт R5 |
| --- | --- | --- | --- |
| `p0-snapshot-full` | архив на диске, `src/` внутри | артефакт | проверить распаковкой |
| `p0-junk-root` | файлы перенесены, `.gitignore` | артефакт | подтверждается чтением |
| `p0-truth-table` | `tests/reports/BCD-TRUTH-TABLE.md` + сверка схемы | артефакт+SQL | подтверждается |
| `p0-dom-asserts` | `99-console-audit.spec.js` | LIVE-UI | подтверждается (нужен прогон) |
| `b-verify-existing` | gate/roles/full-roles | LIVE-UI | подтверждается (нужен прогон) |
| `b-date-mask` (D-200) | full-roles 233/233 | LIVE-UI | подтверждается (нужен прогон) |
| `b-wh-button` (D-201) | проверка на 5 ролях | LIVE-UI | подтверждается |
| `b-deploygate-tail` (D-198) | счёт коммитов, git | артефакт | подтверждается |
| `b-e2e-roles` (D-202) | `doc-hub-*-e2e` + негативный контроль 5xx | LIVE-UI | подтверждается |
| `b-visual-reshoot` | `doc-hub-visual-capture.js` + SHA-гард | LIVE-UI + артефакты | кадры на диске, нужен просмотр |
| `x-parallel-sessions` (D-218) | `restore_asset_sync plan`, `audit_silent_reverts` | read-only аудит | подтверждается |
| `c-kill-packing` | `verify_assembly_flow` (LIVE-API) | LIVE-API | подтверждается |
| `c-dead-pages` | удаление файлов + `verify_index_tags` | STATIC + рантайм | подтверждается |
| `c-field-assembly` | `verify_assembly_flow` 20/20, `verify_c1c3_browser` 7/7 | LIVE-API + LIVE-UI | подтверждается |
| `c-harden-suite` | OFS 58/0 FAIL | LIVE-UI | подтверждается, кроме шима (п. 3) |
| `c-ai-parser` | `verify_c5_parser` 23/23, `verify_c5_stability` 3/3 | LIVE-API | подтверждается; OCR не проверен (честное ограничение в плане) |
| `c-degrade-ux` | `verify_c6_degrade` 9/9 | LIVE-UI | подтверждается |
| `d-lane-a` | `verify_d1_dir_modal` 26/1, `verify_d1_dir_queue` 16/16 | LIVE-UI + LIVE-API | подтверждается |
| `d-wms-live` | `verify_d2_live` 14/14 | LIVE-UI | подтверждается |
| `d-marketplace-tail` | `verify_d3_desktop` 15/0 | LIVE-UI | подтверждается |
| `d-storyboard` | 43 кадра в `tests/reports/wms-premium-story/` | артефакты + LIVE-UI | кадры на диске |
| `d-not-redo` | сверка кода (grep) | STATIC | подтверждается |
| `d-money-kopecks` (D-229) | `verify_d1_dir_modal` 27/27 | LIVE-UI | подтверждается |
| `e-ledger` (E0) | записи D-234/235/236 в ledger | документ | подтверждается |
| `v-stageD` | вердикт агента 6005cd80 + гейты | LIVE-UI | подтверждается |
| `mail-killswitch` (D-215) | `verify_mail_killswitch` 8/8 | UNIT | подтверждается модульно |
| `local-only-tests` (D-216) | killswitch + fail-fast | UNIT + код | подтверждается |
| `x-foreign-audit` (D-207) | `node --check` 18 файлов, побайтовая сверка | STATIC | подтверждается |
| `x-migration-collision` (D-208) | `setval`, маркеры V355/V356 | SQL | подтверждается |
| `per-block-protocol` | сводка по блоку C | процесс | подтверждается частично |

## Три находки, требующие перепроверки живой цепочкой

### 1. ТО-блок (D-203) не имеет НИ ОДНОЙ живой цепочки

`assign-analysis`, `reg-analysis-self`, `assignRegistryAnalysis` встречаются только в:
- `tools/verify_registry_row_form.js` — FILE:// + ПОДМЕНА API (B5/B6);
- `tools/verify_analysis_checklist.js` — FILE:// стенд на `:3200`.

Ни один LIVE-UI гейт их не гоняет. **Дополнительно:** D-203 вообще не является пунктом
плана на 72 пункта — он упоминается лишь в `x-foreign-audit` (как чужой вклад в дерево)
и в `x-migration-collision` (V356). То есть ТО-блок выкачен 21.09 и сертифицирован
исключительно стендами → это ровно та дыра, ради которой заведён Этап V-T.
Файлы: `src/routes/tenders-registry.js`, `public/assets/js/registry_tab.js`,
`src/routes/pm-duty.js`, `src/routes/customers.js`.

### 2. Пять «completed» опираются на FILE:// стенды по предмету UI

`verify_rp_modal_render`, `verify_rp_calc_improvements`, `verify_vat22_ui`,
`verify_tkp_full_form`, `verify_registry_row_form` — предметы (модалка просчёта, НДС-модалки,
полное КП, форма строки реестра) в живом браузере не перепроверялись.
Статусы, которые на них опирались: `b-visual-reshoot`, `d-lane-a` (частично), `v-stageD`.

### 3. Шим внутри живой цепочки OFS

`tests/ofs-full-chain-browser-e2e.js`, шаг 2e: перед бизнес-шагом suite сам выполняет
`UPDATE procurement_requests SET work_id = ...`. Живой шаг получает подготовленное SQL-ом
состояние. Требуется либо выбор работы через UI, либо явная пометка «предусловие» с ассертом,
что UI эту работу видит. Задача — V-T5.

## Итог R0

- Из 30 пунктов **27 опираются на живой рантайм или на артефакт** — им можно доверять
  после повторного прогона их гейтов.
- **3 зоны требуют живой перепроверки:** ТО-блок D-203 (нет ни одной живой цепочки),
  предметы пяти FILE:// стендов, шим `work_id` в OFS.
- Ни один пункт не закрыт «по слову» — у всех есть машинное основание. Проблема не в
  выдуманных доказательствах, а в **классе** доказательства: статический стенд вместо живого.
