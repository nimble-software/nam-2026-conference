# Photo Booth: take a photo with your laptop camera and post it to a shared gallery

## What this changes
A new **Photo Booth** item in the main nav opens `/photo-booth`: a camera panel above a gallery. The page asks for camera permission, shows a live preview, and offers **Take photo**, then **Retake** or **Post**. A posted photo shows at once at the top of the gallery with the poster's name and a "posted" time read from the conference clock. Only the poster sees **Delete**; the API answers anyone else with 403. A blocked or missing camera shows a message and no capture button. A fresh seed has an empty gallery with an inviting empty state; nothing is seeded.

## Where
- `server/db.js` — add `photos (id, user_id REFERENCES users, image TEXT, posted_at TEXT 'YYYY-MM-DDTHH:MM')` to `SCHEMA`, and `DROP TABLE IF EXISTS photos` in `dropAll()` (before `users`). `seed.js` is untouched, so the gallery starts empty.
- `server/lib/query.js` — `toPhoto(row)` → `{ id, userId, userName, image, postedAt }`; the only snake_case → camelCase point.
- `server/routes/photos.js` (new) — `GET /` newest first (`posted_at DESC, id DESC`); `POST /` body `{ userId, image, day, time }`: 404 unknown user, 400 unless `image` is a `data:image/jpeg;base64,` URL under ~400 KB, and `day`/`time` required (clock comes from the client, as in `seats.js`); `DELETE /:id?userId=` 404 unknown photo, 403 unless `userId` is the poster, else 204/`{ ok: true }`.
- `server/index.js` — `app.use('/api/photos', photosRouter)`; raise `express.json({ limit: '1mb' })` (default 100 kb is below a photo).
- `src/lib/api.js` — `getPhotos()`, `postPhoto({ userId, image, day, time })`, `deletePhoto(id, userId)`; the only callers of `fetch`.
- `src/lib/photo.js` (new) — pure helpers: `cameraMessage(err)` mapping `NotAllowedError` / `NotFoundError` / unsupported to a sentence; `fitSize(w, h, max = 640)`.
- `src/pages/PhotoBoothPage.jsx` (new) — `SectionHeader` "Photo Booth"; `getUserMedia` in an effect with track cleanup on unmount; states `asking | live | taken | blocked`; capture draws the video onto a canvas via `fitSize`, `toDataURL('image/jpeg', 0.8)`; no capture button when blocked. Gallery via `useFetch(api.getPhotos)`, grid `grid-cols-2 md:grid-cols-3`, each card with poster name, `relativeDate(postedAt, clock)` (clock from `useConference()`, never `new Date()`), and Delete only when `photo.userId === currentUserId`. Empty state copy invites the first photo. Test ids: `photo-capture`, `photo-retake`, `photo-post`, `camera-blocked`, `photo-card`, `photo-delete`, `photo-empty`.
- `src/App.jsx` — `<Route path="photo-booth" …>` inside `<Layout>`.
- `src/components/Layout.jsx` — `NAV` entry `{ to: '/photo-booth', label: 'Photo Booth', icon: 'camera' }`; `src/components/Icon.jsx` — add a `camera` path.
- Docs: `context/engineering-context/architecture.md` (route table, `/api/photos`, `photos` table in the table list), `data-model.md` (table), `ui.md` (nav item, page), `testing.md` (new lane, fake camera), `seed.md` (gallery starts empty).
- Tests:
  - `tests/unit/photo.test.js` — `cameraMessage`, `fitSize`, `toPhoto`.
  - `tests/api/photos.test.js` — `startApi()`, a fixed tiny JPEG data URL as the fake image; users from the seed.
  - `tests/photo-booth.spec.js` — lane `'photobooth.post'` added to `LANES` in `tests/helpers.js`: desktop `{ user: jonas, day: 1, agenda: false }`, mobile `{ user: andy, day: 1, agenda: false }` (neither pair is used by another row; both book nothing). Uses `visit(page, '/photo-booth', { as: lane.user, at: momentOn(1, '10:30') })`, `test.use({ permissions: ['camera'], launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } }`; deletes its own post in `finally`. Blocked case stubs `navigator.mediaDevices.getUserMedia` to reject with `NotAllowedError` via `addInitScript`.
  - `tests/smoke.spec.js` — add `/photo-booth` to `ROUTES` (overflow check at phone width).

## How it will be proved
| Done when | Check | Layer |
| --- | --- | --- |
| `/photo-booth` in nav, camera above gallery | spec: nav link visible and navigates; `photo-capture` is above the gallery in bounding-box order; smoke route renders with no errors or overflow on both projects | Playwright |
| Permission, live preview, Take / Retake / Post | spec with fake camera: video has non-zero `videoWidth`; Take shows Retake and Post; Retake returns to live; Post submits | Playwright |
| Posted photo appears at once, newest first, name and clock time | spec: after Post, first `photo-card` shows the attendee's name and "posted" text derived from the pinned clock; API test: `GET /photos` returns newest first with `userName` and `postedAt` equal to the posted day/time | Playwright + API |
| Only poster can delete; others 403 | API: `DELETE` by another user is 403 and the photo remains, by the poster succeeds; spec: a second attendee's view has no `photo-delete` | API + Playwright |
| Blocked or missing camera | unit: `cameraMessage` for `NotAllowedError` / `NotFoundError`; spec: rejected `getUserMedia` shows `camera-blocked` and no `photo-capture` | Unit + Playwright |
| Fresh seed has empty gallery with empty state | API: `GET /photos` is `[]` on a fresh seed; spec asserts `photo-empty` only when the gallery has no cards (the posted card is removed in `finally`) | API |
| Correct at phone width | mobile project runs the same spec; smoke overflow check; gallery card boxes sit inside the viewport | Playwright (mobile) |
| Tests use fake image / fake camera / own lane, release | unit and API use a constant data URL; spec uses the `photobooth.post` lane and deletes what it posts | all |
| Docs updated | `npm test` context checks (`node scripts/context.mjs for` the touched files) | Unit |

## Decisions
- No Done-when criterion already holds on main; the route, API and table do not exist.
- Store the image as a JPEG data URL in a `photos` SQLite column, downscaled in the browser to at most 640 px, rather than files on disk — OK?
- Identify the poster by `userId` (body on POST, query on DELETE), since the app has no authentication, so 403 means "not the poster you claim to be" — OK?
- The posted time is the conference clock the client sends (`day` + `time`), stored as `YYYY-MM-DDTHH:MM` and shown relative to the current clock — OK?
- A reseed drops the gallery (`photos` is in `dropAll`), unlike `session_embeddings` — OK?

## Out of scope
Moderation or reporting, likes or comments, filters, video, and showing a person's photos on Home or My Agenda.
