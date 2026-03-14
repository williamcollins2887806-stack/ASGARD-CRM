# 1. Summary
- Extra Mimir behavior came from `public/assets/js/app.js` shared mobile shell and shared `/mimir` route handling.
- `mobile_v2` already had Mimir structurally inside the tabbar, but `app.js` still rendered a separate Mimir header button, injected a separate tab button, and opened shared `AsgardMimir.open()` from the `/mimir` route.
- `mobile_v2/core.js` also still contained a PM-specific alternative tab set.

# 2. Cleanup applied
- Removed shared-shell header Mimir button from `public/assets/js/app.js`.
- Removed shared-shell injected Mimir tab button from `public/assets/js/app.js`.
- Removed shared `/mimir` overlay-opening behavior from `public/assets/js/app.js`.
- Switched mobile_v2 tabbar Mimir action in `public/assets/js/mobile_v2/core.js` to route via `#/mimir`.
- Enforced the canonical primary mobile tabbar in `public/assets/js/mobile_v2/core.js` by making PM tabs fall back to the default canonical set.

# 3. Canonical primary tabbar
- Home
- Tasks
- Mimir
- Mail
- More

# 4. Alternative tabbars
- PM-specific / role-specific alternatives existed before this pass.
- After this pass, the primary mobile_v2 shell uses the canonical tabbar.
- Legacy/shared shell role mapping still exists in `app.js` for non-mobile_v2/shared paths, but separate Mimir behavior is removed.

# 5. Verification
- No shared `AsgardMimir.open()` route trigger remains in `app.js`.
- Primary mobile_v2 tabbar keeps Mimir only as the center action.
- Theme behavior was not changed.

# 6. Files changed
- `public/assets/js/mobile_v2/core.js`
- `public/assets/js/app.js`
- `public/index.html`
