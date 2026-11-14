import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { startApi } from './harness.js';

/**
 * Semantic search, with the embedder stubbed: `ORBIT_EMBEDDER=stub` is a hashed
 * bag-of-words, so no key and no network are needed. It is read on every call,
 * so a test can switch it off to prove the fallback.
 */

const SENTINEL = 'sentinel-key-4f9c1e7a-never-in-a-response';
let api;
let close;
let db;
let embedSessions;
let sessions;
let target;

/** The sentence a talk is described by: its own title and abstract. */
const describe_ = (s) => `${s.title}. ${s.abstract}`;

before(async () => {
  process.env.ORBIT_EMBEDDER = 'stub';
  process.env.GEMINI_API_KEY = SENTINEL;
  const started = await startApi();
  api = started.api;
  close = started.close;
  ({ db } = await import('../../server/db.js'));
  ({ embedSessions } = await import('../../scripts/embed.mjs'));

  sessions = await api.json('/sessions');
  const counts = new Map();
  for (const s of sessions) counts.set(s.abstract, (counts.get(s.abstract) ?? 0) + 1);
  target = sessions.find((s) => counts.get(s.abstract) === 1 && !s.isKeynote);
});

after(async () => {
  delete process.env.ORBIT_EMBEDDER;
  delete process.env.GEMINI_API_KEY;
  await close();
});

const search = (q) => api.get(`/sessions/search?q=${encodeURIComponent(q)}`);

describe('before anything is embedded', () => {
  test('falls back to the keyword search, with no score', async () => {
    const word = target.title.split(' ')[0];
    const res = await search(word);
    assert.equal(res.status, 200);
    assert.equal(res.body.mode, 'keyword');
    const expected = await api.json(`/sessions?q=${encodeURIComponent(word)}`);
    assert.deepEqual(res.body.results.map((r) => r.id), expected.map((r) => r.id));
    assert.ok(res.body.results.length > 0);
    for (const r of res.body.results) assert.equal('score' in r, false);
  });

  test('a search with no text is a 400', async () => {
    const res = await api.get('/sessions/search');
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });
});

describe('once sessions are embedded', () => {
  before(async () => {
    const done = await embedSessions();
    assert.equal(done.embedded, sessions.length);
  });

  test('describing a talk returns it first, as a session with a score', async () => {
    const res = await search(describe_(target));
    assert.equal(res.body.mode, 'semantic');
    assert.equal(res.body.results[0].id, target.id);
    assert.equal(res.body.results[0].title, target.title);
    assert.ok(res.body.results[0].track.name, 'results are full sessions');
    assert.ok(res.body.results[0].score > 0.9 && res.body.results[0].score <= 1);
  });

  test('every result scores at least the threshold, best first, and gibberish matches nothing', async () => {
    const { MIN_SCORE } = await import('../../server/lib/embed.js');
    const res = await search(describe_(target));
    const scores = res.body.results.map((r) => r.score);
    assert.ok(scores.every((s) => s >= MIN_SCORE), scores.join());
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a));

    const none = await search('qzxv wjkp vvbn');
    assert.equal(none.body.mode, 'semantic');
    assert.deepEqual(none.body.results, []);
  });

  test('an exact title, or a speaker name, still wins on a literal hit', async () => {
    const byTitle = await search(target.title);
    assert.equal(byTitle.body.results[0].id, target.id);

    const full = await api.json(`/sessions/${target.id}`);
    const name = full.speakers[0].name;
    const byName = await search(name);
    assert.ok(byName.body.results.length > 0, 'a speaker name alone is a hit');
    const given = new Set((await api.json(`/sessions?speakerId=${full.speakers[0].id}`)).map((s) => s.id));
    assert.ok(given.has(byName.body.results[0].id));
  });

  test('embedding again changes nothing until a session text changes', async () => {
    const again = await embedSessions();
    assert.equal(again.embedded, 0);
    assert.equal(again.skipped, sessions.length);

    db.prepare('UPDATE sessions SET subtitle = ? WHERE id = ?').run('A subtitle written afterwards', target.id);
    const changed = await embedSessions();
    assert.equal(changed.embedded, 1);
  });

  test('vectors stored by another model are never compared: keyword results instead', async () => {
    db.prepare("UPDATE session_embeddings SET model = 'some-other-model'").run();
    try {
      const res = await search(describe_(target));
      assert.equal(res.body.mode, 'keyword');
      for (const r of res.body.results) assert.equal('score' in r, false);
    } finally {
      db.prepare('UPDATE session_embeddings SET model = ?').run('stub-bag-of-words');
    }
    assert.equal((await search(describe_(target))).body.mode, 'semantic');
  });

  test('without a key or a stub the route falls back instead of failing', async () => {
    delete process.env.ORBIT_EMBEDDER;
    delete process.env.GEMINI_API_KEY;
    try {
      const res = await search(target.title);
      assert.equal(res.status, 200);
      assert.equal(res.body.mode, 'keyword');
    } finally {
      process.env.ORBIT_EMBEDDER = 'stub';
      process.env.GEMINI_API_KEY = SENTINEL;
    }
  });
});

describe('the key never reaches the browser', () => {
  test('no response carries the key, and nothing under src/ names it', async () => {
    const paths = ['/sessions/search?q=agents', '/sessions', '/bootstrap', `/sessions/${target.id}`];
    for (const p of paths) {
      const res = await api.get(p);
      assert.equal(res.text.includes(SENTINEL), false, `${p} leaked the key`);
      assert.equal(/gemini_api_key|apikey/i.test(res.text), false, `${p} names the key`);
    }
    const walk = (dir) => readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
    for (const file of walk('src')) {
      const text = readFileSync(file, 'utf8');
      assert.equal(/GEMINI_API_KEY|server\/lib\/embed/.test(text), false, `${file} reaches for the key`);
    }
  });
});
