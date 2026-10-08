# V-PAIR-list — Front 1в1

**CRM:** `VERIFY/PREDEPLOY-VISUAL/CAPTURE/CRM-list.png` / `CRM-S01-chat-list-dark.png`  
**Mock:** `VERIFY/PREDEPLOY-VISUAL/MOCKS/pair-list-diff.png`  
**Viewport:** 414×896 @2x dark  
**Дата:** 2026-10-05

## Сравнение к канону TG list (zones)

| Zone | CRM live | Verdict |
|------|----------|---------|
| LIST-HEADER Изм.\|Чаты\|compose | есть | match |
| Folders + CRM tabs | Все / Работа+ / Все·Личные·Новые·Клиенты | match |
| Stories rail | «Вы» + peers | match |
| Birthday banner | есть, dismiss | match (IN, not geo) |
| Pinned block | ЗАКРЕПЛЁННЫЕ отдельной секцией | match |
| Glass nav 64 + FAB | island + search FAB | match |

## Diffs (допустимые / продуктовые)

1. CRM tabs (Все/Личные/…) — намеренный hybrid, не TG folders-only.
2. Birthday banner — продуктовая фича IN-scope.
3. Unread pill `99+` — live data.

## Verdict

**1в1** для list chrome (header / stories / pinned / glass nav).

Доказательство: live CRM capture path + zone overlay.
