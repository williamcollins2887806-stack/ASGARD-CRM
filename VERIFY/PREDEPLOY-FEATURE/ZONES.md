# Feature zone notes — visual wave

## BE-STORIES
- `GET /api/chat-groups/stories/feed` → `{ stories }` (clone 200)
- `POST /api/chat-groups/stories/:id/view` from viewer
- UI: `#hgStoriesRail`, unread ring `.is-unread`, minimal viewer `.hg-story-viewer`

## UX-STORIES
1. Open list → rail visible (or add placeholder)
2. Tap story → viewer opens
3. Close → ring marks viewed when POST ok
4. Empty feed → «История» add affordance
5. No geo in rail

## UX-BDAY
1. Settings toggle `hg_bday_banners`
2. Cards for today / ≤3 days
3. Dismiss persists `hg_bday_dismissed`
4. No live-location card

## UX-PIN-FILE
1. Pin banner scrolls to message + flash
2. File bubble is full-card download link
3. Lightbox unchanged for images
4. No live-geo bubble
