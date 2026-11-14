# Semantic session search: find talks by describing what you want

## What this changes
On `/schedule` an attendee gets a second box, "Describe what you want", beside the existing `q` filter. Typing "practical talks on making teams faster with AI" lists the sessions closest in meaning, as `SessionCard`s, each with a score. Exact titles, speaker names and acronyms still win through a literal-hit boost. With no `GEMINI_API_KEY`, no stored embeddings, or embeddings from a different model, the route falls back to the existing `LIKE` search and the page says "Keyword results: semantic search is not set up". `npm test` and CI need no secret; the key is read only in `server/lib/embed.js`.

## Where
- `server/lib/embed.js` (new) — `embed(texts, { task })` calling Gemini `gemini-embedding-001`, 768 dims, L2-normalised, key from `GEMINI_API_KEY`; `setEmbedder(fn)` / `ORBIT_EMBEDDER=stub` swap in a deterministic hashed bag-of-words embedder; `EMBED_MODEL` constant; `sourceText(session)` and `textHash()`. Pure helpers `cosine(a, b)` and `rank(queryVec, rows, { threshold, boosts })` live here too; vectors stored as Float32 BLOBs.
- `server/db.js` — add `session_embeddings(session_id PK -> sessions ON DELETE CASCADE, model, vector BLOB, text_hash)` to `SCHEMA`; deliberately not in `dropAll` and not touched by `seed.js`.
- `scripts/embed.mjs` (new) + `package.json` `"embed"` script — embeds every session from title, subtitle, abstract, track, tags and speaker names, skipping rows whose `text_hash` and `model` are unchanged.
- `server/routes/sessions.js` — `GET /search?q=` registered before `/:id`; embeds the query (`RETRIEVAL_QUERY`), ranks, applies `MIN_SCORE`, boosts a literal title or speaker-name hit, returns `{ mode: 'semantic' | 'keyword', results: [session + score] }` via `hydrateSessions`/`toSession`; keyword fallback reuses the `q` LIKE clause (extract it into a helper). Stored `model` != `EMBED_MODEL`, an empty table, or no key means `mode: 'keyword'`.
- `src/lib/api.js` — `searchSessions(q)`, the only caller of `fetch`.
- `src/pages/SchedulePage.jsx` — new `ask` URL param and `data-testid="semantic-input"`; when set, fetches `api.searchSessions` and renders results with `SessionCard` in list form, with a `semantic-mode` note; the `q` filter is untouched. Mobile: inside the rail behind the `Filters` button.
- `tests/unit/embed.test.js` (new) — fixed vectors.
- `tests/api/search.test.js` (new) — `startApi()` from `tests/api/harness.js`, stubbed embedder through `ORBIT_EMBEDDER=stub` set before boot, embeddings inserted by running the embed script's function against the throwaway DB.
- `tests/semantic-search.spec.js` (new) — lane `schedule.semantic-search` added to `LANES` in `tests/helpers.js` (`readOnly: true`, sofia day 1 desktop, marcus day 1 mobile, the pairs `schedule.grid` already shares read-only-compatibly); `playwright.config.js` `webServer.env` sets `ORBIT_EMBEDDER=stub`, and the spec's `beforeAll` runs the embed function against the running DB.
- Docs — `schedule.md` (search box, `/sessions/search`), `data-model.md` (`session_embeddings`), `architecture.md` (`embed.js`, the server-only key, `npm run embed`).

## How it will be proved
| Done when | Check | Layer |
| --- | --- | --- |
| Cosine and ranking with fixed vectors | `cosine` of identical/orthogonal/opposite vectors; `rank` orders, drops below threshold, boosts a literal hit over a higher cosine | unit, `tests/unit/embed.test.js` |
| Threshold | search returns only sessions scoring at least `MIN_SCORE`; a gibberish query returns none | API, `tests/api/search.test.js` |
| Fallback | no stored embeddings, and no key, return `mode: 'keyword'` with the `LIKE` matches and no `score` | API, same file |
| Model mismatch | rows stored with another `model` give `mode: 'keyword'`, not a comparison | API, same file |
| Search returns relevant sessions | typing a description whose words match a known session puts it first; the same phrase through `?q=` finds nothing | Playwright, `tests/semantic-search.spec.js` |
| Key never reaches the browser | `GET /api/*` and the page bundle contain no `GEMINI_API_KEY` value; `/api/sessions/search` payload has no key field | API, `tests/api/search.test.js` (sets a sentinel key, greps the response bodies and `src/` imports) |
| Docs updated | `node scripts/context.mjs for` the changed files lists no stale doc; the three docs name `session_embeddings` and `/sessions/search` | context unit test, `tests/unit/context.test.js` |

## Decisions
- Keep `session_embeddings` across `npm run db:seed` (not added to `dropAll`), so `npm run dev` does not discard paid-for embeddings; stale rows are caught by the hash on the next `npm run embed` — OK?
- The e2e stub is `ORBIT_EMBEDDER=stub`, a hashed bag-of-words embedder shipped in `embed.js`, rather than a test-only server hook — OK?
- The response is `{ mode, results }` rather than a bare array, so the UI can say it fell back — OK?
- Minimum score is a single constant `MIN_SCORE` (0.55 for cosine, tuned on the stub in tests, adjustable once real vectors exist) — OK?

## Out of scope
A vector database, LLM re-ranking, personalised results, My Agenda and Home.
