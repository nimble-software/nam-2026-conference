import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cosine, rank, sourceText, textHash, vecToBlob, blobToVec, embed, MIN_SCORE, EMBED_MODEL,
} from '../../server/lib/embed.js';

test('cosine is 1 for identical, 0 for orthogonal and -1 for opposite vectors, whatever their length', () => {
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([3, 4], [6, 8]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine([1, 0], [-1, 0]), -1);
  assert.equal(cosine([0, 0], [1, 0]), 0, 'a zero vector matches nothing rather than dividing by zero');
});

const rows = [
  { id: 1, vector: [1, 0] },
  { id: 2, vector: [0.8, 0.6] },
  { id: 3, vector: [0, 1] },
  { id: 4, vector: [-1, 0] },
];

test('rank orders by cosine, best first, and drops everything under the threshold', () => {
  const all = rank([1, 0], rows);
  assert.deepEqual(all.map((r) => r.id), [1, 2, 3, 4]);
  assert.deepEqual(all.map((r) => r.score), [1, 0.8, 0, -1]);

  const kept = rank([1, 0], rows, { threshold: 0.5 });
  assert.deepEqual(kept.map((r) => r.id), [1, 2]);
  assert.deepEqual(rank([0, 0], rows, { threshold: 0.5 }), []);
});

test('a boost lifts a result past the threshold it would miss on cosine alone', () => {
  const out = rank([1, 0], rows, { threshold: 0.5, boosts: new Map([[3, 0.6]]) });
  assert.deepEqual(out.map((r) => r.id), [1, 2, 3]);
  assert.equal(out.find((r) => r.id === 3).score, 0.6);
});

test('rank puts a boosted literal hit first when the boost outweighs the cosine gap', () => {
  const out = rank([1, 0], rows, { threshold: 0.5, boosts: new Map([[3, 1.2]]) });
  assert.deepEqual(out.map((r) => r.id), [3, 1, 2]);
  assert.ok(out[0].score >= 1.2);
});

test('rank breaks equal scores by id so a result list never reshuffles', () => {
  const tie = rank([1, 0], [{ id: 9, vector: [1, 0] }, { id: 5, vector: [1, 0] }]);
  assert.deepEqual(tie.map((r) => r.id), [5, 9]);
});

test('a vector survives the trip through a Float32 BLOB', () => {
  const v = [0.25, -0.5, 1, 0];
  assert.deepEqual(blobToVec(vecToBlob(v)), v);
  assert.equal(vecToBlob(v).length, 16);
});

test('sourceText gathers what an attendee would describe a talk by; textHash tracks it exactly', () => {
  const s = {
    title: 'Agents at scale', subtitle: 'Fleets', abstract: 'Running many agents.',
    track: 'AI Engineering', tags: ['evals', 'agents'], speakers: ['Ada Lovelace'],
  };
  const text = sourceText(s);
  for (const part of ['Agents at scale', 'Fleets', 'Running many agents.', 'AI Engineering', 'evals', 'agents', 'Ada Lovelace']) {
    assert.ok(text.includes(part), `missing ${part}`);
  }
  assert.equal(textHash(text), textHash(sourceText({ ...s })));
  assert.notEqual(textHash(text), textHash(sourceText({ ...s, subtitle: 'Armies' })));
  assert.match(textHash(text), /^[0-9a-f]{64}$/);
});

test('the shipped threshold and model name are the ones the spec fixes', () => {
  assert.equal(MIN_SCORE, 0.55);
  assert.equal(EMBED_MODEL, 'gemini-embedding-001');
});

test('the stub embedder is deterministic, unit length and puts shared words close together', async () => {
  process.env.ORBIT_EMBEDDER = 'stub';
  try {
    const [a, b, c] = await embed(['faster teams with agents', 'faster teams with agents', 'zebra quartz']);
    assert.deepEqual(a, b);
    assert.ok(Math.abs(Math.hypot(...a) - 1) < 1e-9);
    assert.ok(cosine(a, b) > 0.999);
    assert.ok(cosine(a, c) < 0.1);
  } finally {
    delete process.env.ORBIT_EMBEDDER;
  }
});
