# THING — готовность к команде деплоя (P7a+P7b)

Дата: 2026-10-02

## Гейты
| Gate | Result | Evidence |
|------|--------|----------|
| P7a CODE (re-verify) | VERIFIED | tests/reports/THING-CODE-VERIFY.md — FAIL leak+dial-in FIXED |
| P7a UI (re-verify) | VERIFIED | tests/reports/THING-UI-VERIFY.md — lobby/ready/protocol/access FIXED |
| P7b E2E S00–S22 | 23/23 PASS | tests/reports/THING-E2E.md (S21 minutes lock, S22 dial-in 401) |

## KNOWN GAP (не блокирует MVP)
- CRM full in-call icon-dock 1:1 с render hub → p3-crm-ui

## P7c
Ждёт явной команды пользователя («деплой»).
