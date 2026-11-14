# Select several tracks at once in the schedule filter

## What this changes
On `/schedule` the track pills become toggles. Clicking a pill adds that track to the selection, clicking an active pill removes it, and the list shows sessions on any selected track (a union). "All" clears the selection; nothing selected means every track, as today. The URL keeps one key, `?track=a,b`. Pills expose `aria-pressed`. Any active track filter still forces the list view.

## Where
- `server/routes/sessions.js` line ~38 — split `trackSlug` on commas (trim, drop empties) and build `t.slug IN (?, ?)`; one value is the same query as today. Test in `tests/api/endpoints.test.js` (API layer, its existing `ids`/`bootstrap` fixtures): `trackSlug=a,b` returns the union of the two single-track counts.
- `src/pages/SchedulePage.jsx` — `filters.track` stays the raw comma string (so `useFetch` deps and `api.getSessions` / `qs()` need no change); derive `selectedTracks = filters.track === ALL ? [] : filters.track.split(',')`. The track pill `onClick` toggles a slug in that array and calls `set('track', array.join(','))` (empty array deletes the key); `active = selectedTracks.includes(t.slug)`; add `aria-pressed={active}` to each pill and to "All" (pressed when nothing is selected). `BLOCKERS` already treats any non-ALL `track` as a blocker, so list view is forced unchanged.
- `tests/schedule.spec.js` — new spec in the Schedule list describe using `visit`, `waitForResults`, `conferenceDays()` and `API` from `tests/helpers.js` (read-only, no bookings, so no data lane needed). Pin day via `?day=`. Picks two tracks, compares `result-count` to the API count after add A, add B, remove A, and "All"; also opens `/schedule?track=a,b` directly and checks both pills `aria-pressed=true`; runs on both projects (desktop and mobile; mobile clicks `Filters` first).
- `context/engineering-context/schedule.md` — update the track filter description (SchedulePage / filter rail / `GET /api/sessions` params) to say several tracks, comma-separated.

## How it will be proved
| Done when | Check | Layer |
| --- | --- | --- |
| Clicking a pill adds; clicking an active pill removes | spec: pill `aria-pressed` flips true then false after clicks | spec |
| Two tracks selected: only those, `result-count` matches API for `trackSlug=a,b` | API test: `trackSlug=a,b` equals union of singles; spec compares `result-count` to that API count | API + spec |
| `result-count` checked after each add and each removal | spec asserts count after add, add, remove | spec |
| Nothing selected or "All" shows every track | spec: after clearing, count equals unfiltered count and URL has no `track=` | spec |
| `/schedule?track=a,b` shows both active | spec: both pills `aria-pressed=true`, count matches API | spec |
| Single `?track=a` behaves as before | existing `trackSlug=${ids.track}` endpoint test plus spec: one pill pressed, count equals single-track API count | API + spec |
| Works at desktop and mobile widths | the spec runs in both Playwright projects | spec |

## Decisions
- A track slug never contains a comma, so splitting on commas is safe — OK?
- "All" gets `aria-pressed` too (true when no track is selected) — OK?
- Unknown slugs in `?track=` are passed through and simply match nothing, as an unknown single slug does today — OK?

## Out of scope
The speakers page `trackSlug` filter (`speakers.js` reads its own params) and the other single-value filters.
