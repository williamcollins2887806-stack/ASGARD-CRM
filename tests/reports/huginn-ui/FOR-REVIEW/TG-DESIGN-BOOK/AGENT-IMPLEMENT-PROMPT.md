# AGENT IMPLEMENT PROMPT — Huginn Liquid Glass

Скопируй блок **PROMPT** целиком агенту-кодеру. Подставь `WAVE_ID` (например `F0`).  
Кодер **не** начинает следующий wave, пока оркестратор не даст зелёный V-SYN.

---

## PROMPT

```
Ты — агент-реализатор Huginn Liquid Glass в ASGARD CRM.

## WAVE
Реализуй ТОЛЬКО wave: {{WAVE_ID}}
После завершения — СТОП. Не начинай следующий wave. Не деплой. Не бампь shell. Не коммить без команды.

## Обязательное чтение (в этом порядке)
1. tests/reports/huginn-ui/FOR-REVIEW/TG-DESIGN-BOOK/HUGINN-LIQUID-GLASS-DS.md
2. tests/reports/huginn-ui/FOR-REVIEW/TG-DESIGN-BOOK/HUGINN-LIQUID-GLASS-TOKENS.json
3. tests/reports/huginn-ui/FOR-REVIEW/TG-DESIGN-BOOK/BRIEF-SHOTS-MATRIX.md
4. Эталонные shots для этого wave (см. таблицу ниже) — файлы shots/Sxx-*.md + глазами REFS/Sxx.jpg
5. public/assets/css/huginn_dock.css
6. public/assets/js/huginn_dock.js
7. При BE-wave: tests/reports/HUGINN-API-CONTRACT.md и существующие src/routes chat-groups / huginn*

## Жёсткие правила
1. Единый стиль: все плавающие панели/кнопки/меню через .hg-glass + data-role (или эквивалент на --hg-glass-*). Запрещены разовые background/backdrop-filter вне ролей.
2. Цвета ТОЛЬКО из CRM: --bg2 --bg3 --t1 --t2 --t3 --blue-l --brd-m; --gold ТОЛЬКО rail. Светлее/темнее/прозрачнее — color-mix. ЗАПРЕТ: purple с рефов (#7358FF…), OLED #000 как screen, хардкод TG hex.
3. Screen/thread = var(--bg2), не pure black.
4. Геометрия: TARGET из HUGINN-LIQUID-GLASS-TOKENS.json geometry.*.current→target для этого wave.
5. Bubble me = color-mix(--blue-l, --bg3); НЕ #2B5278 и НЕ purple.
6. Active tab = charcoal disc (bg3 mix), НЕ blue bloom.
7. Composer/header = floating objects, НЕ continuous bar на всю ширину.
8. List preview = 1 строка.
9. Bubbles: radius 17px, tail-radius 7px (asymmetric family).
10. Если для wave нужен API которого нет (folders, AI Editor) — НЕ рисуй stub. Создай короткий BE-task note в tests/reports/huginn-ui/FOR-REVIEW/TG-DESIGN-BOOK/VERIFY/WAVE-{{WAVE_ID}}/BE-BLOCKER.md и СТОП.
11. Не трогай public/index.html, public/sw.js, git checkout критичных shell-файлов. Не Set-Content по UTF-8 shell.
12. Минимальный diff. Не рефакторь соседние модули.
13. После кода: кратко опиши что менялось + как проверить вручную. Не ставь себе VERIFIED — это делают V-TZ/V-REF/V-SYN.

## Файлы правки (по умолчанию)
- public/assets/css/huginn_dock.css
- public/assets/js/huginn_dock.js
- /h/ только если wave явно требует паритет standalone (обычно нет)

## Wave checklist

### F0 — Glass foundation
- [ ] Ввести --hg-glass-fill-pct, --hg-glass-blur, --hg-glass-rim-pct, --hg-glass-radius, --hg-glass-sat
- [ ] Класс .hg-glass + роли: composer, nav, fab, header, pin, menu, card, segment, media-chrome
- [ ] Классы #huginnDock.hg-power-full|reduced|off + localStorage.hg_power_saving
- [ ] Убрать/свести разрозненные fills chrome к ролям (не ломая layout)
- [ ] --hg-side-inset: 16px
Acceptance: нет новых one-off blur; power-off делает solid --bg3 без backdrop-filter.

### F1 — Nav + FAB
Refs: REFS/S36.jpg, S01, S12 + shots
- [ ] --hg-tg-nav-h: 64px; --hg-tg-nav-radius: 32px; --hg-tg-fab-size: 64px
- [ ] Island + FAB через glass roles nav/fab
- [ ] Active = selection disc + --blue-l glyph/label
- [ ] Badge сохранён; blur контента под island при скролле
Acceptance: ±2px к 64; нет blue bloom.

### F2 — Composer
Refs: S28, S27, S04
- [ ] tool/input 40; radius 20; gap 6–8
- [ ] Три независимых glass объекта (attach / input / mic|send)
- [ ] Rim ~11% t1; fill ~65% bg3
- [ ] States empty→mic, text→send (--blue-l)
Acceptance: визуально как S28 по геометрии; цвета CRM.

### F3 — Header + pin
Refs: S04, S05, S24
- [ ] Floating capsules h44 r22 (back/title/avatar)
- [ ] Back badge white/t1 + dark digits
- [ ] Pin/live bar glass pin role ~40h r20
Acceptance: нет continuous header bar.

### F4 — Chat list
Refs: S01, S37
- [ ] Row ~68–76 (target 72); 1-line preview ellipsis
- [ ] Separators --brd-m; unread badge; avatar list size
- [ ] Contact row target 53 если этот экран в скоупе
Acceptance: row не прыгает; preview одна строка.

### F5 — Bubbles + voice
Refs: S05, S07, S11
- [ ] radius 17; tail 7
- [ ] me/them CRM mixes
- [ ] voice play disc + waveform opacities
Acceptance: нет purple; tail видимо острее body.

### F6 — Context menus
Refs: S16, S19
- [ ] menu glass role; destructive row danger color
- [ ] (scale animation может доехать в F9 — тогда хотя бы структура)
Acceptance: меню читается на --bg2; blur/rim по роли.

### F7 — Profile
Refs: S03, S17
- [ ] 3–4 round glass actions
- [ ] cards solid bg3 r26; rows ~52
Acceptance: меньше «жёстких» границ, air + glass.

### F8 — Media viewer
Refs: S18, S30
- [ ] dim+blur backdrop
- [ ] glass chrome controls
Acceptance: фокус на медиа; контролы glass.

### F9 — Motion + power wiring
- [ ] send morph / menu scale / media scale — мягкие
- [ ] power levels реально режут blur/motion
- [ ] prefers-reduced-motion → минимум reduced
Acceptance: power-off = без blur и без длинных motion.

### F10 — Folders (BE FIRST)
- [ ] Если нет API папок → BE-BLOCKER.md и стоп
- [ ] Иначе capsule active folder token

### F11 — AI Editor (BE FIRST)
- [ ] Если нет API → BE-BLOCKER.md и стоп
- [ ] Иначе icon после >3 lines + sheet; Premium на бэке

### F12 — iPad
- [ ] Cmd+Enter send
- [ ] wide layout не ломает glass roles

## Выход кодера
1. Список изменённых файлов
2. Какие TARGET-токены выставлены
3. Как открыть UI для верификации (порт/роль)
4. Известные риски / не сделано намеренно
```

---

## Подстановка WAVE_ID

| Команда пользователя | WAVE_ID |
|----------------------|---------|
| кодить Wave F0 | F0 |
| кодить Wave F1 | F1 |
| … | … |

Оркестратор после кодера запускает [`VERIFY-PROTOCOL.md`](VERIFY-PROTOCOL.md).
