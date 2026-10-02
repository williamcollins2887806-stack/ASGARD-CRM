# THING CRM UI 100% — F5 deploy readiness

**Дата:** 2026-10-02  
**Статус:** READY FOR DEPLOY — ждать команду «деплой» (не выкатывалось)

## Verifiers (F4)
| Gate | Result | Evidence |
|------|--------|----------|
| UI verifier 19/19 | VERIFIED | `tests/reports/THING-UI-VERIFY-F4.md` |
| Code verifier 18/18 | VERIFIED | `tests/reports/THING-CODE-VERIFY-F4.md` |
| Action matrix | 33/33 GREEN | `tests/reports/THING-ACTION-MATRIX-RUN.json` (LiveKit/egress/dialin secret — ACK skip на локальном клоне) |
| Independent code agent | VERIFIED | agent `0aba5af7` |
| Independent UI agent | VERIFIED | agent `01b0ae39` (guest #10/#12/#17 closed) |

## Shell
`20.28.62` — `public/sw.js` + `public/index.html`

## Deploy (только по команде «деплой»)
snapshot → shell_guard → scp ting module/guest/thing.js → restart → post-deploy audit + prod LiveKit smoke
