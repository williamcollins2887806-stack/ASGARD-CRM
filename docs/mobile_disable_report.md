# 1. Root disable strategy

Introduced a single frontend runtime flag, `window.ASGARD_FLAGS.MOBILE_V2_ENABLED = false`, in `public/index.html`.

The flag is consumed centrally by:
- `public/assets/js/app.js` to stop mobile_v2 route bootstrapping, mobile shell rendering, mobile auth entry overrides, and mobile-only route bridges.
- `public/index.html` to stop loading mobile_v2 CSS/JS assets for live users.
- `public/assets/css/app.css` as defense-in-depth to hide any residual mobile_v2 shell markup.

# 2. Exact files changed

- `public/index.html`
- `public/assets/js/app.js`
- `public/assets/css/app.css`
- `docs/mobile_disable_report.md`

# 3. Entry points disabled

- mobile_v2 stylesheet include in `public/index.html`
- mobile_v2 script bootstrapping in `public/index.html`
- mobile_v2 route handoff via `App.init()` in `public/assets/js/app.js`
- mobile auth/login/welcome entry override via `shouldUseMobileV2Entry()` in `public/assets/js/app.js`
- mobile shell/tabbar rendering in `public/assets/js/app.js`
- `/more` mobile menu route in `public/assets/js/app.js`
- `/mob-more` mobile bridge redirect in `public/assets/js/app.js`
- mobile_v2 test routes in `public/assets/js/app.js`

# 4. What mobile users will see now

Mobile users now fall back to the normal stable site instead of the current mobile_v2 shell.

They should no longer see:
- the mobile_v2 shell
- the mobile tabbar
- the mobile ?more? page
- mobile_v2 login/welcome handoff
- mobile_v2 test pages

# 5. What remains in code but inactive

The mobile_v2 codebase remains in the repository and was not deleted.

Inactive but retained:
- `public/assets/js/mobile_v2/`
- `public/assets/css/mobile_v2.css`
- mobile_v2 branches in `public/assets/js/app.js`

# 6. How to re-enable later

1. Set `window.ASGARD_FLAGS.MOBILE_V2_ENABLED` back to `true` in `public/index.html`.
2. Restore the mobile_v2 CSS/JS includes in `public/index.html`.
3. Re-test mobile auth, `/more`, and mobile_v2 route bootstrapping before exposing it again.

# 7. Manual QA checklist

- Desktop: confirm normal login, welcome, routes, and shell still work.
- iPhone Safari: confirm welcome/login stay on the stable normal site and do not hand off to mobile_v2.
- iPhone Safari: confirm no mobile tabbar or mobile ?more? menu appears after login.
- iPhone Safari: open `#/more` and `#/mob-more` directly and confirm both land on `#/home`.
- Android Chrome: repeat the same checks.
