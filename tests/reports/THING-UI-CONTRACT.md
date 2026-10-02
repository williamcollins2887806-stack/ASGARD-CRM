# THING-UI-CONTRACT — DoD паритет рендеру (19 экранов)

**SoT:** `prototypes/ting/index.html` (+ `rev-*.png`)  
**CRM target:** `#/ting` + guest `/ting/{slug}`  
**Правило:** экран DONE только после PASS UI-верификатора. Stub/toast «скоро» = FAIL.

| # | Screen ID | Элементы (минимум) | CRM маршрут | Guest | Status |
|---|-----------|-------------------|-------------|-------|--------|
| 1 | hub | вкладки Из Тинга/Из Совещаний; CTA Создать/Совещание/Расписание; список+Войти | `#/ting` | — | IMPLEMENTED |
| 2 | new | Сейчас / По расписанию | `#/ting/new` | — | IMPLEMENTED |
| 3 | schedule | форма даты/темы + создать | `#/ting/schedule` | — | IMPLEMENTED |
| 4 | meeting-create | совещание+тинг+protocol | `#/ting/meeting-create` или meetings | — | IMPLEMENTED |
| 5 | ready | ссылка, copy primary, dial 6 цифр, телефон, PIN, dialin link | `#/ting/ready/:slug` | — | IMPLEMENTED |
| 6 | meeting | карточка доступа link/код/тел/PIN | `#/ting/meeting/:id` | — | IMPLEMENTED |
| 7 | lobby | превью mic/cam, имя, Войти | `#/ting/lobby/:slug` | `/ting/{slug}` | IMPLEMENTED |
| 8 | waiting | «Почти внутри», ждать хоста | то же | то же | IMPLEMENTED |
| 9 | error | комната завершена + CTA | то же | то же | IMPLEMENTED |
| 10 | error-code | неверный код/PIN | то же | то же | IMPLEMENTED |
| 11 | room | сетка, timer, icon-dock Мик/Кам/Экран/Ещё/Выйти | `#/ting/room/:slug` | `/ting/{slug}` room | IMPLEMENTED |
| 12 | share | демо экрана + filmstrip | overlay room | overlay | IMPLEMENTED |
| 13 | people | панель участников, kick/mute host | overlay room | overlay | IMPLEMENTED |
| 14 | chat | чат комнаты | overlay room | overlay | IMPLEMENTED |
| 15 | recording | consent bar + REC + stop host | overlay room | overlay | IMPLEMENTED |
| 16 | host-end | подтверждение завершить для всех | modal room | modal | IMPLEMENTED |
| 17 | ended | протокол / запись / на хаб | `#/ting/ended/:slug` | `/ting` ended | IMPLEMENTED |
| 18 | protocol | А4, статусы ИИ, edit initiator, PDF | `#/ting/protocol/:slug` | — | IMPLEMENTED |
| 19 | dialin | 6 цифр, шаги звонка, телефон | `#/ting/dialin` | — | IMPLEMENTED |

## Host API needed
- POST admit/reject lobby participant
- GET participants list
- POST mute / remove participant  
- POST recording start/stop (exists) wired in UI
- POST end from UI (exists)

## Sign-off
| Gate | Result |
|------|--------|
| UI verifier 19/19 | VERIFIED (`THING-UI-VERIFY-F4.md`) |
| Code verifier | VERIFIED (`THING-CODE-VERIFY-F4.md`) |
| Action matrix 100% | 33/33 GREEN (`THING-ACTION-MATRIX-RUN.json`) |
