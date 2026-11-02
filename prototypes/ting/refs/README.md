# Ting UI refs — design contract

SoT прототипа: `prototypes/ting/index.html`  
Прод-зеркало токенов: `public/assets/css/ting.css`

## Dual-theme

| Правило | Контракт |
|---|---|
| Переключатель | `html[data-theme="dark"\|"light"]` (как CRM / guest `asgard_theme`) |
| Dark default | cinema glass: `--ting-card-bg` = glass gradient |
| Light hub/lobby/ready | читаемые карточки: `--ting-card-bg: #FFF`, `--ting-surface` светлый |
| Room / in-call | **всегда cinema**: `--ting-room-bg`, `--ting-dock-bg`, `--ting-chat-bg`, `--ting-drawer-bg` |
| Ink в комнате | только `--ting-on-media` (не CRM `--t1`) |

Обязательные токены (минимум):

```
--ting-card-bg, --ting-card-border, --ting-card-shadow
--ting-dock-bg, --ting-chat-bg, --ting-drawer-bg
--ting-preview-bg, --ting-room-bg, --ting-on-media
--ting-surface, --ting-gold, --ting-gold-l, --ting-t1..t3
```

## Экраны прототипа

1. **hub** — Новый / Подключиться / Запланировать  
2. **ready** — ссылка + код телефона  
3. **lobby** — имя + превью мик/камера  
4. **room** — док + more-sheet открыт  
5. **people-chat** — people + chat **параллельно** (не взаимоисключая)

## More-sheet (док → «Ещё»)

| Блок | RU-лейблы | Поведение |
|---|---|---|
| Устройства | Микрофон / Камера / Динамики | select устройств (в прототипе статично) |
| Рука | Поднять руку / Опустить руку | toggle |
| Реакции | 👍 👏 ❤️ 🔥 | burst на stage |
| Blur | Размытие / Без эффекта | BackgroundBlur API в prod |
| 3 фона | **Нет · Офис · Зал** | пресеты вирт.фона (design target) |

Док (короткие лейблы как у Телемоста): **Мик · Камера · Экран · Люди · Ещё · Выйти**.

## Refs assets

Положить сюда референсы Telemost (mobile), когда есть:
- `telemost-mobile-172.webp` (image-172)
- любые скрины more-sheet / dual-theme для сверки

Визуальный контракт также в плане `ting_visual_100` / Wave dual-theme.
