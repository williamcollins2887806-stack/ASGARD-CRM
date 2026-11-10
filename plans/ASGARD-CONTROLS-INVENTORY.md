# ASGARD-CONTROLS-INVENTORY

Дата: 2026-11-10  
Scope: desktop vanilla + mobile office/field `/m/`  
Вне: React v2 (`desktop-v2-src` / `public/v2`), Huginn (`huginn_*`, `/h/`, `HuginnEstimateChat`), destructive ✕ (Отклонить / удалить строку).

Гейт wire: `wired_count == inventory_total`.

## Switches

| id | Семья / селектор | Где | Канон | Status |
|----|------------------|-----|-------|--------|
| SW-01 | `.toggle-switch` | `components.css`, mango/light | elastic gold/steel via `asgard-controls.css` | wired |
| SW-02 | `.toggle` | `app.css` | gradient/glow убран → gold elastic | wired |
| SW-03 | `.call-toggle-slider` | `mango.js` | green gradient → gold elastic | wired |
| SW-04 | `.cm-toggle-track` / thumb | `contracts.js` | blue `#3b82f6` → gold elastic | wired |
| SW-05 | `.toggle-input` + `.toggle-track` | forms / light-theme | alias в каноне | wired |
| SW-06 | `.switch-track` / `.switch-thumb` | light-theme aliases | alias в каноне | wired |
| SW-07 | Profile `ToggleSwitch` | `mobile-app/.../Profile.jsx` | gold, ease-out 220ms, no spring | wired |

**switches total:** 7 · **wired:** 7

## Checkboxes

| id | Семья | Где | Канон | Status |
|----|-------|-----|-------|--------|
| CB-01 | `input[type=checkbox]` (+ opt-outs) | `cr-checkbox.css` | solid gold, mark draw, **no glow ring** | wired |
| CB-02 | `.cr-checkbox-box` / custom | light-theme | solid gold, no glow | wired |

**checkboxes total:** 2 · **wired:** 2

## Chrome close / expand / collapse

| id | Селектор | Где | Было | Стало | Status |
|----|----------|-----|------|-------|--------|
| CH-01 | `.cr-m__close` / fullscreen | `ui.js` | SVG ok | + `asg-icon-btn` | wired |
| CH-02 | `.toast-close` | `ui.js` | `×` glyph | SVG + `asg-icon-btn` | wired |
| CH-03 | `.xbtn` bell | `app.js` | SVG | + `asg-icon-btn` | wired |
| CH-04 | `.modal-close` tasks | `tasks_admin.js` | `&times;` | SVG + `asg-icon-btn` | wired |
| CH-05 | `.modal-close` mail | `mail_settings.js` | `&times;` / class misuse | SVG; text dismiss → `.ms-modal-dismiss` | wired |
| CH-06 | `.modal-close` / `.jp-sheet-close` | `director_analytics.js` | SVG / `✕` | SVG + `asg-icon-btn` | wired |
| CH-07 | `.dh-drawer__close` | `doc-hub.js` | `✕` | SVG + `asg-icon-btn` | wired |
| CH-08 | `.bc-drawer__close` | `brigade-cart.js` | `✕` | SVG + `asg-icon-btn` | wired |
| CH-09 | pk3 chrome closes | `personal_kanban.js` | `✕` glyphs | `${_PK3_ICO.close}` + `asg-icon-btn` | wired |
| CH-10 | `.hub-funnel-sheet-x` | `hub_funnel_tab.js` | `×` | SVG + `asg-icon-btn` | wired |
| CH-11 | `.sheet-close` BottomSheet | `mobile-app/.../BottomSheet.jsx` | lucide X pill | square asg + press 0.97 | wired |
| CH-12 | `.jp-modal-close` | DirectorAnalytics mobile | `✕` / lucide | SVG + asg | wired |
| CH-13 | `.finv-modal-close` | FieldInventory | SVG pill | square asg | wired |

**chrome total:** 13 · **wired:** 13

## Skipped (намеренно)

| id | Что | Почему |
|----|-----|--------|
| SK-01 | React v2 inputs/modals | вне scope |
| SK-02 | Huginn dock/calls/estimate chat | вне scope |
| SK-03 | `✕ Отклонить` / delete-row | destructive, не chrome |
| SK-04 | Toast status glyphs `✓/✕/!/i` | не chrome-кнопка; тип тоста |
| SK-05 | Math `×` в комментариях/формулах | не UI |

## Итог гейта

| Метрика | Значение |
|---------|----------|
| inventory_total (SW+CB+CH) | **22** |
| wired_count | **22** |
| wired_count == inventory_total | **PASS** |
| shell link | `public/index.html` → `assets/css/asgard-controls.css?v=20.28.499` |
