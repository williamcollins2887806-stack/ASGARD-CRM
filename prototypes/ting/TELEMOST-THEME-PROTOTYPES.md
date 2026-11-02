# Тинг · макеты комнаты Telemost (light / dark)

Статичные HTML-макеты cinema-комнаты Тинга в стиле Телемоста.
Нужны для сверки токенов `html[data-theme]` и раскладки док / filmstrip / чат / «Ещё».

## Файлы

| Файл | Тема |
|------|------|
| `telemost-room-dark.html` | `data-theme="dark"` |
| `telemost-room-light.html` | `data-theme="light"` |
| `telemost-room-dark.png` | скрин dark (если есть) |
| `telemost-room-light.png` | скрин light (если есть) |

Прод (`public/`, `src/`) этими файлами **не трогаем** — только `prototypes/ting/`.

## Как открыть

Из корня репозитория или прямо из папки:

```text
prototypes/ting/telemost-room-dark.html
prototypes/ting/telemost-room-light.html
```

Двойной клик в проводнике или «Open with Live Server» / любой локальный static-server.
Внешних CDN кроме Google Fonts (Manrope) нет; CSS inline.

Ссылка «Открыть Light/Dark» в шапке переключает соседний макет.

## Что внутри

- **Stage** — 3 плитки участников (крупная + 2), cinema-фон.
- **Filmstrip** — лента мини-плиток снизу сцены.
- **Dock** — мик / камера / экран / люди / ещё / выйти.
- **Quality chip** — «Хорошо» в шапке комнаты.
- **Чат** — боковая панель.
- **Ещё** — пресеты фона (Без фона / Размытие / Офис / Небо / Студия) + select устройств.

## Токены

Общие: `--ting-surface`, `--ting-dock-bg`, `--ting-chat-bg`, `--ting-drawer-bg`, `--ting-room-bg`, `--ting-on-media`.

- Видео-сцена всегда cinema (`--ting-room-bg`), подписи на медиа — `--ting-on-media`.
- **Dark:** тёмные панели чата и «Ещё».
- **Light:** светлая оболочка панелей (чат / «Ещё»), dock остаётся glass на видео; верхняя proto-bar светлая.

Связанный dual-theme прототип хаба/лобби: `index.html` в этой же папке.
