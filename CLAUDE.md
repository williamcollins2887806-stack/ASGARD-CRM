# CLAUDE.md — Asgard CRM (фикс-конвейер ФАЗЫ 2)

## Что это
Asgard CRM. Идёт миграция ДЕСКТОП-фронта vanilla → React v2.
- vanilla v1 — в корне `/` (**источник истины по поведению**).
- React v2 — под `/v2/`, исходник в `public/desktop-v2-src/`, билд в `public/v2/`.
- Бэкенд — **Fastify (НЕ Express)**, PostgreSQL `asgard_crm`.

ФАЗА 2 (разведка паритета) ЗАКРЫТА и проверена машинно: **387/387**.
Источник истины этой сессии (читать в первую очередь):
- `tests/reports/PHASE2-PARITY-MATRIX.md` — матрица паритета, 387/387.
- `tests/reports/_DIFF-LEDGER.md` — реестр находок D-001..D-138 (что чинить).

Текущая фаза — **ПОЧИНКА по ledger, конвейером** (см. промпт-кикофф).

## Модель git / build / deploy (НЕ перепутать)
- В git отслеживается **только бэкенд + shell**. Исходник v2 (`public/desktop-v2-src/`) исторически в `.gitignore` — **это исправляется как ШАГ 0** (разигнорить `src`, оставить в ignore `node_modules` и билд `public/v2/`). После шага 0 исходник v2 в git → откат и `.last-verified` работают и для v2.
- Прод: `92.242.61.184`, `/var/www/asgard-crm/`, рестарт `systemctl restart asgard-crm` (**НЕ pm2**). SSH-ключ `~/.ssh/asgard_crm_deploy`.
- Деплой бэкенда: `git push` → на проде `git reset --hard <commit>` + `systemctl restart`.
- Деплой v2: `cd public/desktop-v2-src && npm run build` → выхлоп в `public/v2/` → **tar + scp** на прод (scp одиночными файлами рвётся — слать tar).
- БД на проде: `PGPASSWORD=123456789 psql -U asgard -d asgard_crm`.
- Бамп shell-версии при выкатке: `public/sw.js` + `public/index.html` (`SHELL_VERSION` / `ASGARD_SHELL_VERSION`).

## Каноны, которые нельзя «поправить обратно» (16.09.2026)

- **`tender_rp_reviews.work_price` — цена работ БЕЗ НДС** (как `asgard_smeta.totals.price_no_vat`).
  Порог согласования директора (`settings.director_tender_threshold_rub`, 10 млн) сравнивается именно с ней,
  **делить на 1.22 больше нельзя**. Легаси-пары 2025 г. (`work_price` с НДС + `work_price_ex_vat = /1.22`)
  распознаёт `src/services/work-price.js`; зеркало для фронта — `AsgardMoney.resolveWorkPrice`
  (`public/assets/js/money_fmt.js`). Любой скрипт закрытия/создания просчёта обязан слать без НДС. См. D-173.
- **Просчёт делает дежурный РП, ручного назначения нет.** Если анализ закрыт, а `calculator_user_id` пуст
  (карточки, закрытые до выкатки 13.09), карточку лечит `ensureCalcOwner` в `src/routes/pm-duty.js`:
  дежурный видит её во вкладке «Просчёты» (`queue_mode = duty_orphan`) и при сохранении закрепляет за собой. См. D-172.
- **Смета живёт в ДВУХ копиях** — `src/services/asgard-smeta.js` (источник истины) и `public/assets/js/asgard_smeta.js`.
  Браузерную пересобирать: `node tools/build_smeta_mirror.js` (гейт — `--check`, дублируется тестом
  `tests/asgard-smeta-share.test.js`). Блоки F (перечень, справочно), G (закупка долей `sharePct`),
  H (аренда) и даты работ — там же. На оборудование (G+H) **наценка не начисляется** (1:1). См. D-174.
- Бамп `SHELL_VERSION` — `node tools/bump_shell_version.js` (кросс-платформенно, `--check` для проверки).

## Дисциплина (ЗАКОН, не обсуждается)
1. **Слово агента != сделано.** LOC, число роутов, «проверил» — не доказательство. DONE только при ЗЕЛЁНОМ детерминированном гейте.
2. **FIXED != VERIFIED.** VERIFIED только после рантайм/sentinel-проверки на КЛОНЕ.
3. **Проверка на КЛОНЕ, не на проде.** Клон: `pg_dump asgard_crm | psql -d asgard_crm_test` (pg_dump прода захватывает реальную схему, в т.ч. ручные ALTER'ы, которых нет в миграциях — это убирает ложные 500 от schema-drift). Приложение-двойник на `:3100`. После прогонов `:3100` убить.
4. **Параллельная починка — file-disjoint.** Один файл/компонент — один агент. Общий файл — один владелец. Матрицу/ledger/очередь пишет ТОЛЬКО оркестратор, одним проходом.
5. **Чинит один агент — сертифицирует ДРУГОЙ.** Агент, правивший код, НЕ ставит себе VERIFIED. Отдельный аудит-агент перепроверяет (sentinel/runtime + пересчёт покрытия numerator==denominator).
6. **Паритет к ТЕКУЩЕЙ vanilla** по поведению; визуал — новый. Решённые UX-улучшения v2 — ОСТАВЛЯТЬ (не резать под 1:1). Источник правды по поведению — vanilla.
7. **Покрытие меряется счётом**, не словом. «Проверил основные / выборочно» = провал, переоткрыть.

## Гейты (делают DONE механическим, без человека)
- `npm run build` ОБЯЗАН проходить.
- Пер-пункт verify на клоне (sentinel POST→GET→assert / рантайм-проверка / grep) — зелёный.
- **Deploy-gate:** деплоить на прод ТОЛЬКО если `git rev-parse HEAD` == `tests/reports/.last-verified`. Verify пишет `.last-verified` = ИМЕННО проверенный коммит. **Не переиспользовать старый хэш.** Проверяется машинно: `python tools/shell_guard.py --deploy-gate` (допускает дельту после подписи, только если она не трогает `public/`, `src/`, `migrations/`).
- Нет хардкод-цветов в `desktop-v2-src/*.{jsx,css}` — только токены темы.
- Pre-deploy гейты (обязательны, порядок из `.cursor/rules/protect-prod-shell.mdc`): `tools/shell_guard.py --expect-version <X> --deploy-gate`, `tools/verify_index_tags.js`, `tools/audit_silent_reverts.js`, `python tools/restore_asset_sync.py plan`, `node tools/verify_rp_modal_render.js`. Post-deploy: сначала `restore_asset_sync.py plan`, потом `audit_silent_reverts.js --post-deploy` (см. D-166).

## Человек нужен ТОЛЬКО здесь (остальное — автономно)
- **Перед ПРОД-пушем батча** — аудит зелёный (отдельный агент сертифицировал, покрытие сошлось).
- **Крупные пересборки** (калькулятор D-15, 3D-карта D-21, CallDetail, DocsPack, QuickMimir, Compose, field-tariffs) — короткий спек ПЕРЕД сборкой, ждать ОК. Не строить вслепую.
- Никогда не деплоить на протухшем `.last-verified`.

## Гигиена
- **Токены НЕ хранить в URL git-remote.** Credential helper / `gh auth`.
- Не чинить то, чего нет в ledger. Новые находки — в ledger новым D-NN, не молча.