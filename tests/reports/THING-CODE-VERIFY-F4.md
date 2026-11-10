# THING-CODE-VERIFY-F4

at: 2026-11-10T09:40:51.990Z
result: VERIFIED (62/62)

| ID | PASS | Evidence |
|----|------|----------|
| C01_no_skoro_toast | PASS | no stub toasts |
| C02_livekit_cdn | PASS | LiveKit connect (self-hosted, без CDN) |
| C03_guest_livekit | PASS | guest LiveKit |
| C04_lobby_default_off | PASS | lobby checkbox unchecked by default |
| C05_no_kick_word | PASS | no Kick/Mute all UI anglicisms |
| C06_no_modul_crm | PASS | no «модуль CRM» |
| C07_incall_chrome | PASS | CRM chrome hide class |
| C08_chat_sidebar | PASS | chat overlay drawer |
| C09_screenshare | PASS | screen share API |
| C10_live_loop | PASS | live refresh loop |
| C11_hub_telemost | PASS | hub Telemost IA |
| C12_logo_mark | PASS | logo mark |
| C13_grid_speaker | PASS | grid/speaker modes |
| C14_floating_dock | PASS | floating dock |
| C15_tile_mic_label | PASS | tile name+mic |
| C16_public_chat | PASS | guest public chat |
| C17_remove_ru | PASS | kick → Russian |
| C18_mute_all_ru | PASS | mute-all Russian |
| C19_qr_ready | PASS | QR on ready |
| C20_share_link | PASS | share CTA |
| C21_nav | PASS | NAV item |
| C22_script_tag | PASS | index wiring |
| C23_guest_css_shared | PASS | guest uses shared CSS |
| C24_protocol_owner | PASS | protocol RBAC |
| C25_recording | PASS | rec UI |
| C26_host_end | PASS | host end |
| C27_dial | PASS | dial-in |
| C28_mobile | PASS | mobile breakpoints + sheets |
| C29_lobby_admit_api | PASS | admit API still exists |
| C30_no_iframe | PASS | not iframe |
| C31_no_legacy_fixed_height | PASS | легаси min-height:420px!important убран |
| C32_aspect_ratio_16x9 | PASS | aspect-ratio 16/9 на тайлах + g4/g10 |
| C33_pip_4x3 | PASS | PiP-сам-вид 4:3 |
| C34_swap_click | PASS | swap по клику |
| C35_contain_screenshare | PASS | screen-share object-fit: contain + подпись track по source=screen |
| C36_placeholder_name_fallback | PASS | заглушка «Участник» → ФИО из users |
| C37_landscape_low_height | PASS | ландшафт телефона: ограничение по высоте |
| C38_start_live | PASS | /start пишет live, не active |
| C39_pickvideo_skip_muted | PASS | pickVideo: live MediaStreamTrack wins over brief isMuted |
| C40_people_chat_parallel | PASS | people не убивает chatHtml |
| C41_more_sheet | PASS | Ещё = settings + рука + реакции |
| C42_room_core | PASS | ting_room_core.js shared module |
| C43_reconnect_ux | PASS | reconnect UX CRM+guest |
| C44_calendar_create_thing | PASS | календарь шлёт create_thing |
| C45_turn_ops | PASS | coturn + turn_servers в ops |
| C46_device_picker | PASS | device picker в Ещё CRM+guest |
| C47_bg_presets | PASS | 3 вирт.фона + blur wiring CRM+guest |
| C48_2peer_smoke_artifact | PASS | TING-2PEER-MEDIA-SMOKE.json green |
| C49_lobby_crm_name | PASS | lobby берёт ФИО из CRM-профиля |
| C50_cinema_chat_overlay | PASS | desktop chat = overlay, не G-колонка |
| C51_intentional_leave | PASS | leave/end без авто-reconnect reopen |
| C52_icon_btn_svg_size | PASS | top icons fixed size, no overlap |
| C53_guest_title_and_cam_race | PASS | guest: ВКС→Тинг + cam handoff (preview→publish) |
| C54_no_video_controls | PASS | native video controls off (CRM+guest+CSS) |
| C55_grid_classes_g4_g10 | PASS | premium g1..g10 matrices wired |
| C56_friendly_http_toast | PASS | no raw HTTP status in user toasts |
| C57_guest_relayout_grids | PASS | guest: g1..g10 + speaker filmstrip relayout |
| C58_guest_attach_searches_strip | PASS | attachTrack finds tiles in stage AND filmstrip |
| C59_cam_preview_handoff | PASS | CRM: enableLocalCamera + timeout cam publish |
| C60_park_pip_on_nav | PASS | уход из #/ting → PiP, не leave |
| C61_join_end_timeouts | PASS | join UI early + end/disconnect timeouts |
| C62_incall_credit_hidden | PASS | ting-incall hides .credit + fixed room shell |

## All PASS