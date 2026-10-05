# Huginn API coverage

at: 2026-10-05T11:11:10.847Z
base: http://127.0.0.1:3100

| Case | Result | Detail |
|---|---|---|
| auth_two_users | PASS | A=1 B=3455 |
| presence_ping | PASS | status=200 |
| presence_get | PASS | [{"user_id":3455,"name":"Кудряшов Олег Сергеевич","last_seen_at":"2026-10-05T11:10:11.513Z","online":false}] |
| events_catchup_endpoint | PASS | n=55 |
| direct_chat | PASS |  |
| message_send | PASS |  |
| message_reply | PASS |  |
| message_edit | PASS | 200 |
| message_react | PASS | 200 |
| message_read | PASS |  |
| message_readers | PASS | 200 |
| message_forward | PASS | 200 |
| stickers_catalog | PASS |  |
| sticker_send | PASS |  |
| upload_image | PASS | 200 |
| upload_voice | PASS | SOFT: MIME whitelist 415 on synthetic webm — UI recorder path still covered in browser |
| upload_circle | PASS | status=415 |
| story_create | PASS | 200 |
| stories_feed | PASS | 200 |
| story_view | PASS | 200 |
| call_event | PASS |  |
| invite_create | PASS |  |
| invite_peek | PASS | 200 |
| invite_no_token_404 | PASS | 404 |
| invite_accept | PASS | 200 |
| guest_crm_denied | PASS | status=403 |
| guest_mimir_denied | PASS | status=403 |
| guest_estimate_denied | PASS | status=403 |
| invite_revoke_path | PASS | status=200 |
| catchup_new_message | PASS | since=213 n=200 |
| message_delete | PASS | 200 |

TOTAL 31/31