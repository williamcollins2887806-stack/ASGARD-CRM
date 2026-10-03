# TELEPHONY-EMU-GATE

Timestamp: 2026-10-03T19:16:08.526Z
DB: `asgard_crm_test` (loopback). Prod / live Mango / cutover: **out of scope**.

| ID | Title | Result | Detail |
|----|-------|--------|--------|
| E01 | Layer1 scenarios+integration | **PASS** | Scenarios: 24 passed, 0 failed; Integration: 28 passed, 0 failed, 0 skipped |
| E02 | Webhook inbound+missed → DB | **PASS** | {"entryId":"emu_in_1791054947090","rows":1,"missed":1} |
| E03 | Softphone answer/hold/hangup/outbound via Mock CMD | **PASS** | {"cmdCalls":5} |
| E04 | Blind transfer via PBX API | **PASS** | {"actions":2} |
| E05 | Consult transfer via PBX API | **PASS** | {"actions":2} |
| E06 | Multi-tab Web Lock + takeover | **PASS** | {"stateA":{"hasPhone":true,"isLeader":true,"state":"offline"},"takeoverVisible":true,"bcOk":true} |
| E07 | Pipeline TELEPHONY_EMU_MOCK STT→AI | **PASS** | {"callId":3530,"summary":"EMU: клиент уточнил сроки, договорились перезвонить"} |
| E08 | Negatives: bad sign, empty transfer, double hangup | **PASS** | {"badSign":403} |
| E09 | UI click chains softphone+journal+missed+PBX | **PASS** | {"chains":["online","answer","decline","hold_hangup","dialpad","transfer","journal","missed","pbx_save"]} |

## Summary

- Passed: 9
- Failed: 0

**GATE: GREEN** — mechanics + UI click chains (E01–E09) ready for live-call planning.

## Residual (live only)

- Real JsSIP/WebRTC media, mic, DTMF audio
- Live trunk Mango→Asterisk cutover
- Prod deploy
- See `tests/reports/TELEPHONY-LIVE-CHECKLIST.md` for B1–B4 cutover steps
