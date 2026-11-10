# TOAST-DEPLOY-PROOF (S0)

Дата: 2026-11-10  
Деплой в S0: **запрещён** (выкатка только S6 по команде).

## Вердикт

**PARTIAL_DEPLOY**

Оболочка на проде уже на `20.28.499` (`sw.js` / `index.html` совпадают с локальным HEAD),  
но канон тостов в `ui.js` + `components.css` на проде **старее** и не совпадает с HEAD/local.  
Пользователь видит старые уведомления, потому что toast-носители не выкатывались вместе с shell-бампом ting/tkp.

Живой SSH/HTTPS к `92.242.61.184` / `asgard-crm.ru` из этой сессии **таймаут** (banner exchange / handshake).  
Хеши prod взяты из последнего снимка `tests/reports/ASSET-MANIFESTS.json` → `remote` (mtime манифеста ниже).  
При S6 — пересъёмка `restore_asset_sync.py plan` и допись post-deploy.

## Сверка хешей (sha256[:16])

| Файл | local (workdir) | HEAD | prod (`ASSET-MANIFESTS.remote`) | Вердикт |
|------|-----------------|------|----------------------------------|---------|
| `public/assets/js/ui.js` | `27f2dacdcbdcfa07` (43362) | `61d860b289d71adc` (42374) | `955446a222633541` (37085) | prod ≠ HEAD ≠ local → toast JS **не на проде** |
| `public/assets/css/components.css` | `853141cb9a49a7b8` (180626) | `b5c03a174cc4e6a3` (174081) | `68fd5923fa65cdc0` (157044) | prod ≠ HEAD ≠ local → toast CSS **не на проде** |
| `public/assets/js/app.js` | `ed5aa813cbd8fd62` (228325) | `71349841d2a247ec` (225097) | `ec63a7fece5a1ffd` (225112) | prod ≠ HEAD (RU toast call sites могут отставать) |
| `public/sw.js` | `8fbf13f389d6bb2f` (23800) | `8fbf13f389d6bb2f` | `8fbf13f389d6bb2f` | **совпадает** |
| `public/index.html` | `ea9e8f7c896f296e` (44984) | `ea9e8f7c896f296e` | `ea9e8f7c896f296e` | **совпадает** |

Полные sha256 prod (из манифеста):

- ui.js: `955446a222633541ea04763239dbd2918eb80cb44c73765eaecdcefe10b9a656`
- components.css: `68fd5923fa65cdc09d03a4ff807a6c488630ec720d570bccb3cfeda233dd3d91`
- app.js: `ec63a7fece5a1ffda0c48fcd33ef0c1e0b1bd8ffe616aad6be5c0a75669f4887`
- sw.js: `8fbf13f389d6bb2fdc9ef243bd61757501abd332d0641fc0981fb21f5bf71873`
- index.html: `ea9e8f7c896f296ec726be91c1c06d4b891d3c44381a58c2ee2aaacc99246060`

## Маркеры канона

| Маркер | local | HEAD | prod (по размеру/хешу носителя) |
|--------|-------|------|----------------------------------|
| `TOAST_LEAVE_MS` (`ui.js`) | да | да | нет (старый ui.js 37k vs 42k+) |
| `_toastSanitizeText` (`ui.js`) | да | да | нет |
| `toast-in` + `border-top: 2px` (`components.css`) | да | да | нет (старый css 157k vs 174k+) |

## Shell / гейт

| Проверка | Значение |
|----------|----------|
| `SHELL_VERSION` local/HEAD | `20.28.499` |
| `ASGARD_SHELL_VERSION` | `20.28.499` |
| `git rev-parse HEAD` | `94dc36d1f05492ae8d52804dbb1048bd62003f98` |
| `tests/reports/.last-verified` | `4166d8b46b3bdc9f8553a9610ee58ecac98c5379` |
| HEAD == .last-verified | **False** → deploy-gate красный до новой подписи |
| Причина «не видно» | **PARTIAL_DEPLOY** (shell выкатили, toast assets — нет). `SW_CACHE` возможен как вторичный эффект после полной выкатки, но сейчас первично отсутствие файлов на проде. |
| `OVERWRITTEN` | нет признаков: prod-хеши просто старые, не «чужие» правки поверх канона |
| `NOT_DEPLOYED` (полный) | отвергнут: `sw.js`/`index.html` уже = HEAD |

## Источники

- Live SSH `root@92.242.61.184`: timeout banner exchange (сессия).
- Live HTTPS `https://asgard-crm.ru`: SSL handshake timeout.
- Prod hashes: `tests/reports/ASSET-MANIFESTS.json` → `remote` (снимок `restore_asset_sync`).

## Post-deploy (S6, заполнить после команды)

| Файл | local hash после bump | prod hash после выкатки | OK? |
|------|------------------------|-------------------------|-----|
| ui.js | _TBD_ | _TBD_ | |
| components.css | _TBD_ | _TBD_ | |
| app.js | _TBD_ | _TBD_ | |
| sw.js | _TBD_ | _TBD_ | |
| index.html | _TBD_ | _TBD_ | |

Hard-refresh / unregister SW: _TBD_  
Без зелёной этой таблицы — **не** писать «тосты на проде».
