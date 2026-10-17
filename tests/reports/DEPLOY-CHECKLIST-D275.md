# Pre/Post-deploy чек-лист Doc Hub (D-275)

Дата подготовки: 17.10.2026. Источник правил: `.cursor/rules/protect-prod-shell.mdc`,
`CLAUDE.md`. **Деплой выполняется ТОЛЬКО по явной команде пользователя.**

## 0. Готовность кода

| Проверка | Команда | Результат (17.10) |
|---|---|---|
| Сводные тесты блока | `node tests/doc-hub-all.js` | **196 / 0 PASS** |
| Роли (браузер) | `node tests/doc-hub-full-roles-e2e.js` | **243 / 0 PASS** |
| Реальные счета (OCR-конвейер) | `node tests/real-invoices-ocr-intake.test.js` | **4 / 0 PASS** |
| Производительность | `node tests/doc-perf.test.js` | `/kpi` 9 мс (< 200) |
| ESLint backend (новые файлы) | `npx eslint -c .eslintrc.backend.json …` | 0 ошибок |
| 0 TODO/FIXME/HACK | grep по новым файлам | чисто |

## 1. Pre-deploy гейты (ПОРЯДОК обязателен)

```bash
# 1.1 Оболочка: 22/22 (UTF-8, BOM, 0 U+FFFD, единый ?v=, критические теги, HEAD vs .last-verified)
python tools/shell_guard.py --expect-version <НОВАЯ> --deploy-gate

# 1.2 Теги index.html: 0 MISSING/DUPLICATE/BROKEN
node tools/verify_index_tags.js

# 1.3 Vendor-бандлы парсятся + экспорт глобалов
node tools/verify_vendor_bundles.js

# 1.4 Ничего прод-уникального не потеряем (PROD_HANDEDIT=0)
node tools/audit_silent_reverts.js

# 1.5 Синхронизация ассетов (differ_prod_newer=0, index_reference_problems=0)
python tools/restore_asset_sync.py plan

# 1.6 Модалка РП рендерится в chromium (19/19)
node tools/verify_rp_modal_render.js
```

**Текущее состояние (17.10):**
- `verify_index_tags` → **OK**: 0 MISSING/DUPLICATE/BROKEN, 0 необъяснённых WARN.
- `verify_vendor_bundles` → **OK**: 3/3 бандла.
- `bump_shell_version --check` → **OK: 20.28.223** (оболочка согласована).
- `shell_guard --deploy-gate` — **НЕ запускался** (требует сети/прод-доступа; при деплое — первым).

## 2. ⛔ Deploy-gate: причина НЕ деплоить сейчас

```
git rev-parse HEAD                       = f93de5fb…   (коммиты блока до 2d9198c1+)
tests/reports/.last-verified             = 56b23eaa…
```

**HEAD ≠ .last-verified** → по правилу `CLAUDE.md` деплой **запрещён**, пока
независимая верификация не запишет `.last-verified` фактически проверенным
коммитом. Это ожидаемо: блок ещё проходит сертификацию (верификатор работает).

## 3. Бамп shell-версии (перед выкаткой)

```bash
node tools/bump_shell_version.js          # поднять версию (напр. 20.28.224)
python tools/shell_guard.py --expect-version 20.28.224 --deploy-gate
```
Версия пишется в `public/sw.js` (`SHELL_VERSION`) и `public/index.html`
(`ASGARD_SHELL_VERSION`) — кросс-платформенно, вручную не править (D-142b).

## 4. Выкатка (по команде, порядок из CLAUDE.md)

1. Snapshot прода: `/root/snapshots/asgard-crm-pre-deploy-*`.
2. Бэкенд: архив `git archive HEAD src` → распаковать на проде → `systemctl restart asgard-crm`.
3. Фронт: `restore_asset_sync.py apply` (сам зовёт shell_guard перед scp, D-167).
4. v2 (если затронут): `cd public/desktop-v2-src && npm run build` → tar+scp в `public/v2/`.
5. Mobile: `public/m/` (билд из `public/mobile-app/dist`, vite пишет в dist — копировать).

## 5. Миграции (V394–V402)

Применяются **до** рестарта приложения, идемпотентны:
```sql
-- порядок: V394 (таблицы/поля), V395 (функция рабочих дней), V396 (пересчёт
-- is_incomplete), V397 (ИНН/fx), V398 (email-цепочка), V399 (факт-сумма кассы),
-- V400 (страховка дублей заявок), V401 (реквизиты банка), V402 (индексы списка).
```
Down-миграции — только при полном откате схемы (V394/V398/V399/V400/V401/V402;
V396 down — no-op, данные).

## 6. Post-deploy (порядок важен, D-166)

```bash
python tools/restore_asset_sync.py plan          # 1) пересъёмка манифеста
node tools/audit_silent_reverts.js --post-deploy  # 2) только ПОСЛЕ plan (иначе ложный FAIL)
```

Проверить на проде: `/api/doc-registry?limit=1` (200, есть `traffic_light`),
`/api/approval/pending-dir` (200 для директора), фичефлаг
`settings.feature_doc_traffic_light` (включить после проверки).

## 7. Откат

- **Флаг**: выключить `feature_doc_traffic_light` → старое поведение (светофор/
  корректировки скрыты) без потери данных.
- **Схема**: down-миграции (только при полном откате).

## Итог

| Этап | Статус |
|---|---|
| Код/тесты | ✅ 196/0 + 243/0 |
| Shell-гейты (локальные) | ✅ index_tags, vendor, version 20.28.223 |
| `.last-verified` | ⛔ **устарел** — деплой заблокирован до сертификации |
| Миграции | подготовлены, идемпотентны |
| Post-deploy порядок | зафиксирован |

**Деплой — по явной команде пользователя, после записи `.last-verified`.**
