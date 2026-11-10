# Toast RU audit (R8)

Дата: 2026-11-10

## Цель
0 английских UI-штампов в пользовательских строках toast; смысловые заголовки; sanitize в `AsgardUI.toast`.

## Было → стало

| Файл | Было | Стало |
|------|------|-------|
| `public/assets/js/app.js` | `Уведомления` / `Отмечено как прочитано` | `Прочитано` / `Лента очищена` |
| `public/assets/js/warehouse-v2.js` | `OK` ×3 | `Подтверждено` / `Готово` |
| `public/assets/js/warehouse-v2-asm.js` | `Dry-run почта` + `preview` | `Пробный прогон` + `предпросмотр` |
| `public/assets/js/mimir-conductor-ui.js` | `Conductor` в toast/UI | `Кондуктор` |
| `public/assets/js/ui.js` | сырой EN / Error | словарь + fallback «Сбой» / «Не удалось выполнить» |

## Гейт
После правок grep по call sites на `toast('OK'`, `Dry-run`, `toast('Error'` в `public/assets/js` — 0.

## Sanitize
Ядро: `TOAST_EN_MAP` + детект латиницы без кириллицы; SKU/UUID в смешанных RU-строках не трогаем.
