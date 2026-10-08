# Huginn GLOBAL RCA — finish pass

**Дата:** 2026-10-06  
**Правило:** глобальный корень → verifier OK → правка shared path. Точечный `if (shot)` запрещён без отдельного добро.

## Кластеры

### G1 Record UX
- **Корень:** `recordMedia` ставит только `hg-rec-bar` + stop; нет lock / timer / Отмена / send-up как TG.
- **Почему глобально:** один path для voice и circle.
- **Трогаем:** `huginn_dock.js` recordMedia/setRecordingChrome + CSS rec chrome.
- **Verifier:** OK — точка по S09 не чинит S10.

### G2 Circle fullscreen
- **Корень:** circle идёт в тот же inline rec-bar; REF = fullscreen camera.
- **Почему глобально:** ветка `kind==='circle'` в том же recordMedia.
- **Трогаем:** overlay fullscreen + preview stream в recordMedia.
- **Verifier:** OK — не отдельный shot-hack.

### G3 Settings IA
- **Корень:** mobileNav settings рендерит profile+FX+logout, не list rows REF.
- **Почему глобально:** один `renderSettings` / mobileNav settings.
- **Трогаем:** settings list shell + profile как подэкран (S29).
- **Verifier:** OK.

### G4 Sheet chrome
- **Корень:** compose sheet без X/✓; z-index/bleed tabbar.
- **Почему глобально:** `openComposeSheet` + sheet CSS.
- **Трогаем:** header actions + stacking.
- **Verifier:** OK.

### G5 Glass island
- **Корень:** `.hg-bottom-nav` / FAB blur слабее REF.
- **Почему глобально:** общие CSS tokens nav.
- **Трогаем:** `huginn_dock.css` backdrop-filter/opacity.
- **Verifier:** OK.

### G6 Content seed
- **Корень:** capture/seed даёт stub bubbles и placeholder media.
- **Почему глобально:** pipeline capture + test data.
- **Трогаем:** seed script + capture (реальные image/voice).
- **Verifier:** OK.

### G7 AI live
- **Корень:** клон без валидного RouterAI key / не та модель.
- **Почему глобально:** `ai-provider` + settings `ai_config`.
- **Трогаем:** env/settings на клоне → DeepSeek 4.1 Flash; anti-stub + apply.
- **Verifier:** OK — stub запрещён.

### G8 STT live
- **Корень:** SpeechKit credentials/path не доводят `transcript_status=done`.
- **Почему глобально:** `chat-voice-stt.js` + `speechkit.js`.
- **Трогаем:** credentials клона + media E2E assert done.
- **Verifier:** OK — DEFER запрещён в этой приёмке.

## Verifier gate (подход)

| Кластер | Approach OK | Notes |
|---------|-------------|-------|
| G1–G8 | **YES** | Shared-path fixes; no shot-if |
