# Huginn Rail Comms Contract

**Scope:** Telephony (PBX) + Ting (LiveKit) in the right Huginn rail (`#huginnDock` / `#hgPanel`). Softphone/Mango is out of scope.

## Public APIs

### `HuginnDock`

| Method | Behavior |
|--------|----------|
| `open(tab?)` | Expand panel; `tab` = `mimir` \| `huginn` \| `ting` \| `phone` \| `settings`. Default `huginn`. |
| `openTab(tab)` | Same as open with required tab. |
| `collapse()` | Collapse panel; sessions stay alive. |
| `setCollapsed` / `isCollapsed` / `isPanelOpen(tab)` / `isUsable()` | Layout probes. |
| `setPhoneRail({ visible, status, badge })` | Phone rail button visibility / pulse / missed badge. |

### `AsgardPhoneUI` (existing)

| Method | Behavior |
|--------|----------|
| `renderPanel(panelEl)` | Idle / incoming / in-call PBX UI in `#hgPanel`. Patch-style updates preferred. |
| Events | `document` `asgard-phone` from `AsgardPhone` (`phone_core.js`). |

### `HuginnTing`

| Method | Behavior |
|--------|----------|
| `mountPanel(panelEl)` | Idle IA (Live / Soon / CTA / History) or compact in-call. Idempotent. |
| `unmountPanel()` | Stop list poll; **does not** disconnect LiveKit. |
| `setRailBadge({ live, soon })` | Badge on ting rail icon. |
| `openHub(slug?)` | Navigate `#/ting` or `#/ting/:slug`. |
| `ensurePip` / `closePip` | Floating PiP card (one session). |

### `TingSession` (singleton)

| Method | Behavior |
|--------|----------|
| `connect({ slug, url, token, identity, … })` | One LiveKit room; lazy SDK load. |
| `adoptRoom(room, meta)` | Hub handoff without reconnect. |
| `leave()` | Disconnect + clear chrome classes. |
| `isActive()` / `getRoom()` / `getMeta()` / `getState()` | Probes. |
| `setMicEnabled` / `setCamEnabled` / `pauseRemoteVideo` | Media. |
| Events | `document` `ting-session` (`connecting`, `connected`, `left`, `tick`, `media`, `phone-busy`, `phone-free`, `error`). |

## `prevTab`

Depth-1 stack on phone incoming: remember previous rail tab, restore after answer/hangup **unless** prev was already `phone`.

## Audio policy (PBX ↔ Ting)

1. **PBX start while Ting live:** auto-mute Ting mic; keep LiveKit connected; banner «Трубка занята телефоном». Optional cam pause publish.
2. **Answer PBX:** dock → `phone`; Ting stays background (do not raise remote volume over handset).
3. **PBX end:** restore Ting mic only if `tingMicWasOn` (user had mic on before phone).
4. **Start Ting while PBX in-call:** block join with mic/cam (`PBX_BUSY`); listen-only only if caller passes `listenOnly: true`.
5. **Attention:** PBX ring prioritizes phone tab over Ting PiP (PiP must not cover Answer).

## Chrome modes

| Class | When |
|-------|------|
| `body.ting-incall` | Fullscreen hub `#/ting` only. |
| `body.ting-live` | Compact/PiP active while CRM hash ≠ `#/ting`. |

`TingPage.unmount` **must not** disconnect if `TingSession.isActive()`.

## State diagrams (summary)

```
Phone UI:  idle → ringing → incall → idle  (+ dialing)
Ting UI:   idle → connecting → live(compact|hub|pip) → ending → idle
```

Tab switch = show/hide + detach video elements; **no** Room.connect / JsSIP unregister.

## Performance rules

- Mount once → patch; no full `innerHTML` on timer ticks.
- One 1s timer per session (phone / ting).
- Ting list poll ≥ 30s only while `tab===ting` and panel open.
- Compact ≤ 2 video attaches; PiP = 1 (active speaker / local).
- `visibility hidden` → pause remote video decode; audio continues.

## Ownership

- **Huginn:** dock chrome, tokens `--hg-*`, chats.
- **Telephony:** phone tab + hybrid PBX shell (`phone_ui.js` / `phone.css`).
- **Ting:** ting tab, `TingSession`, PiP, hub radius (`ting.css`).

Joint surface: public APIs above + thin `renderPanel` hook.
