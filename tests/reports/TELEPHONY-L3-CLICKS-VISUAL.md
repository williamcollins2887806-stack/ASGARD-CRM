# TELEPHONY L3 — clicks + visual (независимый верификатор)

**Дата recheck:** 2026-10-02  
**Стенд:** `asgard_crm_test`, `http://127.0.0.1:3100`  
**Роль:** найти FAIL; код фичи не правился.  
**Предыдущий вердикт:** `FAIL-visual-phone-dot-offline-on-ring-incall`  
**Текущий статус:** **VERIFIED**

---

## Recheck закрытия FAIL (точка «Телефон»)

Исполнитель: `tests/telephony/integration/playwright-visual.js` — `assertPhoneDot`, повторный set `ph-dot--ring` / `ph-dot--incall`, пересъёмка GALLERY.

| Shot | Ожидание | Глазами | Пиксель (pngjs, x≈901 y≈25) | Вердикт |
|------|----------|---------|-----------------------------|---------|
| `GALLERY/02-incoming.png` | ring ≈ green/ok | зелёная точка + border ring | RGB(58,138,101) `green/ok-ring` | **PASS** |
| `GALLERY/03-incall.png` | incall ≈ blue | синяя точка + blue border | RGB(43,95,158) `blue/incall` | **PASS** |
| `GALLERY/06-incall-hold.png` | incall ≈ blue (hold) | синяя точка; Hold active | RGB(43,95,158) `blue/incall` | **PASS** |
| `GALLERY/dark/02-incoming.png` | ring ≈ green/ok | зелёная точка + green border | RGB(56,159,97) `green/ok-ring` | **PASS** |
| `GALLERY/dark/03-incall.png` | incall ≈ blue | синяя точка + blue border | RGB(74,144,217) `blue/incall` | **PASS** |

Кропы доказательства: `GALLERY/_l3_re_{02,03,06,d02,d03}.png` (не серая offline).

---

## 1. Лица verify-gate (1–7)

| # | Лицо | Вердикт | Доказательство |
|---|------|---------|----------------|
| 1 | Заказчик | **PASS** | Предыдущий FAIL закрыт: ring/incall токены на кнопке «Телефон» соответствуют INDEX («ringing» / «синяя точка incall»). |
| 2 | Читатель | **PASS** | Incoming/incall/hold overlays + journal читаемы; CTA на месте. |
| 3 | Ревьюер | **PASS** | E09 клики не регрессили (GATE GREEN); gallery synth добавил `assertPhoneDot` + class set в `playwright-visual.js` (L211, L300/309, L350/359, L638/649/683). Diff узкий под FAIL. |
| 4 | Тестировщик | **PASS** | 5/5 targeted shots PASS пикселем; нет серой offline-точки на ring/incall. Краевой dark/light оба ок. |
| 5 | Скептик данных | **PASS** | Manifest `ts=2026-10-02T16:02:42.106Z` (>15:54Z), 30 shots; GATE.md **GATE: GREEN**, E09 chains полный. Пиксели согласованы с `--ok-t` / `--blue` семантикой CSS. |
| 6 | Регламент | **PASS** | Cutover не трогался; LIVE-CHECKLIST на месте; верификатор код не чинил. |
| 7 | Адвокат дьявола | **PASS** | Допущение «overlay ⇒ class на topbar» теперь проверяется assert’ом перед snap; пересъёмка подтверждает класс на кадре (не только в DOM evaluate без paint). |

---

## 2. Visual PNG (обновлено после fix)

| Файл | Вердикт | Наблюдение |
|------|---------|------------|
| `02-incoming.png` | **PASS** | Incoming CTA + **зелёная** точка ring |
| `03-incall.png` | **PASS** | Incall bar + **синяя** точка incall |
| `06-incall-hold.png` | **PASS** | Hold active + **синяя** точка incall |
| `07-journal.png` | **PASS** | (ранее; idle допустим) |
| `09-missed.png` | **PASS** | (ранее) |
| `13-pbx.png` | **PASS** | (ранее) |
| `dark/02-incoming.png` | **PASS** | Dark ring: **зелёная** точка |
| `dark/03-incall.png` | **PASS** | Dark incall: **синяя** точка |

---

## 3. Чеклист критериев

| # | Критерий | Результат |
|---|----------|-----------|
| 1 | EMU-GATE E01–E09 GREEN + chains | **PASS** — `TELEPHONY-EMU-GATE.md` |
| 2 | E09 clicks + asserts LOCAL | **PASS** — GATE (re-run в этой сессии recheck не требовался) |
| 3 | Manifest свежее 15:54Z, ≥26 shots, INDEX | **PASS** — `manifest.json` `2026-10-02T16:02:42.106Z`, 30 shots |
| 4 | Visual ring/incall токены | **PASS** — recheck выше |
| 5 | CSS ring/ok, incall/blue | **PASS** — `phone.css` (без изменений, ранее сверено) |
| 6 | Нет cutover | **PASS** |
| 7 | E09 live re-run | n/a (не трогали e09); GATE остаётся GREEN |

---

## 4. Итог одной строкой

**VERIFIED**
