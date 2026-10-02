# Журнал выполнения: телефония (ДОВОДКА)

**Стенд:** только `asgard_crm_test` + `http://127.0.0.1:3100`. Прод / SSH / Mango cutover — **не трогали**.

| Дата | Todo | Статус | Доказательство |
|------|------|--------|----------------|
| 2026-10-02 | reopen-journal | DONE | REOPENED; S00 dial-string |
| 2026-10-02 | fix-lifecycle | DONE | `call-lifecycle.js`, `ASGARD_DIAL_STRING`, history+legs |
| 2026-10-02 | fix-ami-softphone | DONE | AMI login; нет `mock_answer`; webrtc; consult |
| 2026-10-02 | fix-sse-recording | DONE | NOTIFY→SSE; finalize hangup hook + openPaths |
| 2026-10-02 | fix-config-rbac | DONE | pbx_config; canViewCall; missed scope |
| 2026-10-02 | integration-harness | DONE | `run.js --all` → **28/28** (S00–S27) |
| 2026-10-02 | playwright-visual | DONE | 14 PNG `tests/reports/telephony-ui/` |
| 2026-10-02 | visual-gate | DONE | `VISUAL-GATE.md` → **VERIFIED 10/10** |
| 2026-10-02 | l3-verify | DONE | `TELEPHONY-L3-VERIFY.md` → **VERIFIED** (локально) |
| 2026-10-02 | stt-spike | BLOCKED | `SKIP_NO_KEYS` — не DONE |
| 2026-10-02 | cutover | NOT DONE | только по явной команде |

## Proof

```
node tests/telephony/integration/run.js --all
→ Integration: 28 passed, 0 failed, 0 skipped

node tests/telephony/integration/playwright-visual.js
→ DONE 14 shots (base http://127.0.0.1:3100)
```

- Visual: ring RGB green, incall RGB blue (`#1A3F74` / `#1E4D8C`) — L1=0 к токенам.
- Finalize: dialplan `h` + `X-PBX-Secret: ${ENV(PBX_CMD_SECRET)}` + loopback openPath + AMI Hangup backup + `asterisk.service.d/asgard-env.conf`.
- STT: BLOCKED без ключей.
- **Cutover: NOT DONE.**
