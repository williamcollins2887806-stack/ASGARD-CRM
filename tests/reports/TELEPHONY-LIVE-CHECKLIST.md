# TELEPHONY-LIVE-CHECKLIST — путь к живым звонкам Mango

Статус эмуляции без SIP: см. [`TELEPHONY-EMU-GATE.md`](TELEPHONY-EMU-GATE.md) (ожидается **E01–E09 GREEN**).
Сценарии волны 1 (PIN/heartbeat/hours): [`TELEPHONY-SCENARIO-W1.md`](TELEPHONY-SCENARIO-W1.md) — `node tests/pbx/scenario-matrix-w1.js`.

**Прод / cutover apply — только по явной команде.** Этот документ — чеклист, не скрипт выкатки.

---

## B0. Wave 1 smoke (после выката shell/бэкенда; тестовая линия)

Только по команде «гоняй LIVE» / «смотри smoke». Не на основной Bitrix.

1. Встал на линию (браузер) → жду > idle PIN (30 мин или укороченный idle в тесте) — PIN **не** появляется.
2. `Ctrl+Shift+L` → снят с линии + PIN.
3. Unlock во время «на линии» / in_call — без reload (SIP жив).
4. Закрыл вкладку при on_line → через ≤2 мин оператор не в ring plan (stale heartbeat).
5. После `work_hours.end` только дежурный on_line до `duty_until`; после `duty_until` — все offline.
6. «Призрак» без heartbeat, но с mobile у дежурного → входящий на GSM, не на мёртвый browser.

Источники: `ops/asterisk/README.md`, `tools/deploy_pbx_cutover.py`, journal cutover / runbook.

---

## B1. CRM (клон уже ок; на прод — по команде)

1. Миграции PBX (`V359` и следующие) применены на целевой БД.
2. Секреты: `PBX_CMD_SECRET` / `pbx.env`; воркеры `TELEPHONY_WORKERS` — осознанно (не «включено наугад»).
3. В CRM: роли с телефонией; операторы в PBX (вкладка PBX → Операторы / на линии).
4. Softphone smoke: логин → «На линии (браузер)» → credentials без 503.
5. Health: `GET /api/telephony/pbx/health` = ok.

---

## B2. Asterisk / asgard-pbx (инфра)

1. `python tools/deploy_pbx_cutover.py --dry-run` — смотреть план (без apply).
2. По команде: deploy snippets `ops/asterisk/*`, nginx `/pbx/ws`, unit `asgard-pbx.service`.
3. Smoke: `curl 127.0.0.1:4575/health`, AMI/AGI порты живы.
4. Snapshot перед любым apply (`/root/snapshots/...`).

---

## B3. Mango (ЛК)

1. **Тестовая** линия (не основная): SIP-направление на CRM/Asterisk, не Bitrix.
2. Входящая: trunk → dialplan `from-mango-inbound` → AGI.
3. Исходящая: номер компании / CLI как в runbook (часто `74993223062`).
4. Запись разговоров включена (нужна для STT pipeline).
5. Webhooks CRM: URL `https://<host>/api/telephony/webhook/events/...`, ключ/соль = `MANGO_API_KEY` / `SALT` на сервере.
6. Резерв 20–30 с → мобильный дежурного (на время тестов).

---

## B4. Живой smoke (короткий)

1. Входящий на тестовую линию → softphone ring → Answer → слышно обе стороны.
2. Hold / Unhold / Hangup.
3. Blind transfer коллеге; consult — отдельно.
4. Исходящий из CRM.
5. После сброса: запись → транскрипт → AI-резюме в журнале (нужны ключи STT/LLM).
6. Две вкладки: takeover.
7. Только после стабильности — перевод **основной** линии; неделю Bitrix как откат.

---

## B5. Чего не делать

- `git reset --hard` на проде.
- Резать основную линию Bitrix в первый день.
- Считать E01–E08 достаточными для «кнопки UI точно работают» — без E09 это не так.
- Править `index.html` / `sw.js` на проде руками; shell везти из рабочего дерева после гейтов.

---

## Порядок после E09 GREEN

```text
E01–E09 GREEN (клон :3100)
  → B1 CRM готовность
  → B2 Asterisk dry-run → (по команде) apply + smoke
  → B3 Mango тест-линия
  → B4 живой smoke
  → основная линия (отдельно, с откатом)
```
