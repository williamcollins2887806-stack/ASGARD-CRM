# Хугинн present v2 — soft chrome CRM

Презентационные доски правого chrome ASGARD: лёгкий rail Мимир · Хугинн · Тинг + панели.  
Прод-shell не трогается — только после GO.

## Открыть

```bash
npx --yes serve -l 4178 .
# → http://127.0.0.1:4178/
```

← → листают доски.

## Контракт chrome

1. Правый **лёгкий rail** (~52px) с подписями: Мимир / Хугинн / Тинг.
2. Панель слева от rail (~390px); X сворачивает, rail остаётся.
3. **FAB нет** — compose в шапке / composer.
4. CRM слева ближе к vanilla (AS brand, blue active, topbar 56, soft Soldag).
5. 0 `style=` на UI; craft bar — каждая кнопка проработана.

## Pitch досок (17)

| id | Содержание |
|---|---|
| `b-rail` | Mac · rail only + подписи |
| `b-huginn` | Список + статусы команды |
| `b-mimir` | AI-панель |
| `b-group` | Групповой чат |
| `b-thread` | Карточки CRM / Тинг |
| `b-voice-play` | Голос + SpeechKit |
| `b-voice-rec` | Запись голоса (waveform / cancel / send) |
| `b-photo` | Фото-сообщение |
| `b-video` | Видео-сообщение |
| `b-circle` | Кружок |
| `b-stickers` | Стикер + tray |
| `b-ting` | Ting hub / join |
| `b-story-post` | Выкладка статуса |
| `b-phones-l` | iPhone ×4 light |
| `b-phones-media` | iPhone медиа |
| `b-phones-d` | iPhone dark |
| `b-hero` | Hero Mac-first |

## Съёмка / гейт

```bash
node build_present.js
node _shot.js
node _check_a.js
```

| Верификатор | Вердикт |
|---|---|
| A (код) | VERIFIED |
| B (скрины craft) | см. VERIFY.md |

## После GO

ЭТАП 2: `huginn_dock.js` в shell.
