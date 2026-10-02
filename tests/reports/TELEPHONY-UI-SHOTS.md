# TELEPHONY UI — чеклист визуального верификатора (10/10)

Снимки и интерактивная проверка vanilla PBX softphone + admin. Роли: TO (softphone), ADMIN (PBX tab).

| # | Комponent / экран | Состояние | Критерий 10/10 |
|---|-------------------|-----------|----------------|
| 1 | `#asgardPhoneBtn` в topbar | offline | Серая точка, подпись «Телефон», hover без сдвига layout |
| 2 | `#asgardPhoneBtn` | on_line_browser | Зелёная точка, меню «На линии» |
| 3 | `#asgardPhoneMenu` | offline menu | Два режима online + «Проверить микрофон», z-index выше контента |
| 4 | `#asgardPhoneTakeover` | second tab | Оверлей + «Перехватить», не перекрывает PIN навсегда |
| 5 | `#asgardPhoneIncoming` | ringing | Карточка bottom-right, z-index > session-guard PIN (100000) — **FAIL если под PIN**; кнопки Ответить/Сбросить |
| 6 | `#asgardPhoneIncall` | in_call | Таймер, mute/hold/keypad/transfer/hangup, заметка autosave |
| 7 | Transfer modal | staff list | Поиск, online/offline badge, blind/consult radio |
| 8 | Dial pad modal | outbound | Сетка DTMF + поле номера |
| 9 | `#asgardPhoneAudioBanner` | autoplay block | Баннер + «Включить» после reload |
| 10 | `#/telephony?tab=pbx` | settings | Поля стратегии, часы, тексты, toggles записи/AI |
| 11 | PBX subtab journal | data | Таблица + кнопка «Таймлайн» → modal |
| 12 | PBX subtab staff | data | Таблица операторов on_line / webrtc |
| 13 | PBX subtab missed | data | Пропущенные PBX |
| 14 | PBX subtab health | ok/fail | Статус command channel |
| 15 | `tel:` link click | on_line | Intercept → outbound без ухода со страницы |
| 16 | Session guard unlock | in_call | **Нет** full `location.reload` во время звонка |
| 17 | Shell update banner | in_call | Deferred reload, banner visible |
| 18 | Light + dark theme | all above | Только CSS vars, без hardcoded neon |
| 19 | Mobile width ≤640 | header + bar | Скрыта подпись кнопки, bar stack |
| 20 | Legacy popup | offline SSE | `AsgardTelephonyPopup` fallback без диспетчера |

## Автоматические гейты (не замена скринов)

- `node --check public/assets/js/phone_core.js phone_ui.js telephony_admin.js`
- Ручной smoke: goOnline → checkMic → hangup → goOffline
