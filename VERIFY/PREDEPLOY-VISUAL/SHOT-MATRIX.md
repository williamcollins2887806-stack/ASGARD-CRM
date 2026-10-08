# SHOT-MATRIX — полная тройная сертификация (SSOT 66)

**Дата:** 2026-10-06
**Канон:** S01–S58 + A01–A08 = **66**
**Правило:** Front `[x]` / VERIFIED только от Task-verifier после Read SBS
**ACK:** OUT S04 kbd; DEFER S15/S17/S31; Batch2 DEFER_BE tags/checklist не дают PASS

## Счётчик

| Метрика | Сейчас |
|---------|--------|
| REF | 66/66 |
| CAPTURE native | 58 |
| SBS | 58 |
| Front VERIFIED | 18 (S03 S05 S07 S11 S14 S16 S18–S23 S58 A01–A05) |
| IN-scope | 59 |
| OUT | 4 |
| DEFER | 4 (+S28 REF) |

## Матрица

| Shot | slug | REF | CAPTURE | SBS | Scope | Front | Gaps | Verifier |
|------|------|-----|---------|-----|-------|-------|------|----------|
| S01 | chat-list-dark | yes | CRM-S01-chat-list-dark.png | yes | IN | RECHECK | — | — |
| S02 | contacts-list | yes | CRM-S02-contacts-list.png | yes | IN | [ ] | — | — |
| S03 | group-profile | yes | CRM-S03-group-profile.png | yes | IN | [x] | — | Task 2d37f389 |
| S04 | group-chat-keyboard | yes | CRM-S05-group-chat-ios-dark.png | yes | OUT | OUT | — | — |
| S05 | group-chat-ios-dark | yes | CRM-S05-group-chat-ios-dark.png | yes | IN | [x] | — | Task 10ae725b |
| S06 | profile-main | yes | CRM-S06-profile-main.png | yes | IN | [ ] | — | — |
| S07 | outgoing-voice-messages | yes | CRM-S07-outgoing-voice.png | yes | IN | [x] | — | Task 0fdb1d74 PASS |
| S08 | chat-live-location | yes | CRM-S05-group-chat-ios-dark.png | yes | OUT | OUT | — | — |
| S09 | voice-record-locked | yes | CRM-S09-voice-record-locked.png | yes | IN | [ ] | — | — |
| S10 | video-message-recording | yes | CRM-S10-circle-entry.png | yes | IN | [ ] | — | — |
| S11 | ios-chat-bubbles | yes | CRM-S11-ios-chat-bubbles.png | yes | IN | [x] | — | Task 01d3d71d PASS |
| S12 | contacts-glass-nav-dark | yes | CRM-S12-contacts-glass-nav.png | yes | IN | RECHECK | — | — |
| S13 | add-contacts-dark | yes | CRM-S13-compose-create.png | yes | IN | [ ] | — | — |
| S14 | telegram-calls-ios-dark | yes | CRM-S14-calls-ios.png | yes | IN | [x] | — | Task cfcd56e3 PASS |
| S15 | chat-search-ios-dark | yes | — | NO | DEFER | DEFER | NO_CAPTURE | — |
| S16 | group-profile-mute-menu | yes | CRM-S16-mute-menu.png | yes | IN | [x] | — | Task 7bb44587 PASS |
| S17 | group-profile-photo-expanded | yes | — | NO | DEFER | DEFER | NO_CAPTURE | — |
| S18 | group-shared-media-grid | yes | CRM-S18-shared-media-grid.png | yes | IN | [x] | tab pill vs rect minor | Task cfcd56e3 PASS |
| S19 | group-profile-more-menu | yes | CRM-S19-profile-more.png | yes | IN | [x] | — | Task 9cd46eed PASS |
| S20 | shared-files-list | yes | CRM-S20-shared-files.png | yes | IN | [x] | — | Task 9cd46eed PASS |
| S21 | shared-links-list | yes | CRM-S21-shared-links.png | yes | IN | [x] | — | Task 64bd1fcd PASS |
| S22 | shared-voice-list-dark | yes | CRM-S22-shared-voice-list.png | yes | IN | [x] | — | Task 64bd1fcd PASS |
| S23 | group-profile-members-glass | yes | CRM-S23-members-glass.png | yes | IN | [x] | — | Task 7bb44587 PASS |
| S24 | group-header-pinned | yes | CRM-S24-header-pinned.png | yes | IN | [ ] | — | — |
| S25 | chat-keyboard-geo-media | yes | CRM-S05-group-chat-ios-dark.png | yes | OUT | OUT | — | — |
| S26 | group-chat-reply-reactions-unread | yes | CRM-S26-reply-reactions.png | yes | IN | [ ] | — | — |
| S27 | keyboard-ru-composer | yes | CRM-S28-composer-glass.png | yes | OUT | OUT | — | — |
| S28 | composer-glass-dark | yes | CRM-S28-composer-glass.png | yes | DEFER | DEFER | REF blurred/unusable | Task 10ae725b |
| S29 | settings-profile-phone-check | yes | CRM-S29-settings-profile.png | yes | IN | [ ] | — | — |
| S30 | chat-album-live-location | yes | CRM-S30-album.png | yes | IN | [ ] | — | — |
| S31 | profile-expanded-avatar | yes | — | NO | DEFER | DEFER | NO_CAPTURE | — |
| S32 | settings-root-scrolled | yes | CRM-S32-settings-root.png | yes | IN | [ ] | — | — |
| S33 | settings-menu-scrolled | yes | CRM-S33-settings-menu.png | yes | IN | [ ] | — | — |
| S34 | settings-compact-avatar-phone-check | yes | CRM-S34-settings-compact.png | yes | IN | [ ] | — | — |
| S35 | chats-stories-search-header | yes | CRM-S35-stories-header.png | yes | IN | [ ] | — | — |
| S36 | chats-glass-tabbar-fab | yes | CRM-S36-glass-tabbar-fab.png | yes | IN | RECHECK | — | — |
| S37 | chats-stories-liquid-glass | yes | CRM-S37-stories-liquid.png | yes | IN | [ ] | — | — |
| S38 | chats-stories-liquid-glass | yes | CRM-S38-stories-liquid.png | yes | IN | [ ] | — | — |
| S39 | user-profile-publications | yes | CRM-S39-publications.png | yes | IN | [ ] | — | — |
| S40 | stories-archive-view | yes | CRM-S40-archive.png | yes | IN | [ ] | — | — |
| S41 | profile-edit-ios-dark | yes | — | NO | IN | NO_CAPTURE | NO_CAPTURE; NO_SBS | — |
| S42 | new-message-contacts | yes | CRM-S42-compose-create.png | yes | IN | [ ] | — | — |
| S43 | add-participants-list | yes | — | NO | IN | NO_CAPTURE | NO_CAPTURE; NO_SBS | — |
| S44 | edit-profile-settings | yes | — | NO | IN | NO_CAPTURE | NO_CAPTURE; NO_SBS | — |
| S45 | group-participants | yes | CRM-S45-members.png | yes | IN | [ ] | — | — |
| S46 | chat-list-edit-mode-live-location | yes | CRM-S46-list-edit.png | yes | IN | [ ] | — | — |
| S47 | group-profile-cover-participants | yes | — | NO | IN | NO_CAPTURE | NO_CAPTURE; NO_SBS | — |
| S48 | group-profile-participants | yes | CRM-S48-members.png | yes | IN | [ ] | — | — |
| S49 | group-profile-menu | yes | CRM-S49-profile-more.png | yes | IN | [ ] | — | — |
| S50 | group-profile-sound-menu | yes | CRM-S50-sound-menu.png | yes | IN | [ ] | — | — |
| S51 | group-profile-menu | yes | CRM-S51-profile-more.png | yes | IN | [ ] | — | — |
| S52 | member-context-menu | yes | CRM-S52-member-menu.png | yes | IN | [ ] | — | — |
| S53 | group-edit | yes | — | NO | IN | NO_CAPTURE | NO_CAPTURE; NO_SBS | — |
| S54 | add-contacts-picker | yes | CRM-S54-contacts.png | yes | IN | [ ] | — | — |
| S55 | group-profile-participants | yes | CRM-S55-members.png | yes | IN | [ ] | — | — |
| S56 | tender-checklist-connecting | yes | CRM-S56-connecting.png | yes | IN | [ ] | — | — |
| S57 | group-chat-ios-dark-liquid | yes | CRM-S57-pin-chat.png | yes | IN | [ ] | — | — |
| S58 | chat-reply-keyboard | yes | CRM-S58-reply-composer.png | yes | IN | [x] | — | Task cfcd56e3 PASS |
| A01 |  | yes | CRM-A01-new-style-sheet.png | yes | IN | [x] | — | Task 330a1e5f PASS |
| A02 |  | yes | CRM-A02-ai-style-generate.png | yes | IN | [x] | — | Task 18973e6a PASS |
| A03 |  | yes | CRM-A03-ai-grammar-apply.png | yes | IN | [x] | — | Task 7ea7dc33 PASS |
| A04 |  | yes | CRM-A04-ai-translate-apply.png | yes | IN | [x] | — | Task 7ea7dc33 PASS |
| A05 |  | yes | CRM-A05-ai-style-apply.png | yes | IN | [x] | — | Task 7ea7dc33 PASS |
| A06 |  | yes | CRM-A06-composer-idle-no-ai.png | yes | IN | [ ] | — | — |
| A07 |  | yes | CRM-A07-ai-over-attach.png | yes | IN | [ ] | — | — |
| A08 |  | yes | CRM-A07-ai-over-attach.png | yes | IN | [ ] | — | — |

## Wave status (2026-10-06)

- Verifier wave V1–V9: **0 PASS** / ~54 FAIL on IN-scope with SBS
- OUT: S04 S08 S25 S27 · DEFER: S15 S17 S31 S28 · NO_SBS: S41 S43 S44 S47 S53
- Iter-1 fixes: isGroupChat mc>2, calls→phone, media-gallery, capture routes
- Reverify: TYPE match improved (S03/S16/S23/S52); chrome 1в1 still FAIL
- Front VERIFIED / IN-scope = **18 / ~53** — сдача нет (S28 DEFER; next list/settings/AI idle)
- Agents: …,cfcd56e3,7ea7dc33,330a1e5f,01d3d71d,0fdb1d74,7bb44587,64bd1fcd,9cd46eed
