import { createHash } from 'node:crypto';

/**
 * Semantic search, the part that never touches the database.
 *
 * This is the only file that reads `GEMINI_API_KEY`, and `src/` never imports
 * it, so the key stays on the server. `embed()` turns text into unit vectors;
 * `cosine()` and `rank()` are pure, so the ordering rules are tested with fixed
 * vectors. Vectors are stored as Float32 BLOBs (`vecToBlob` / `blobToVec`).
 */

export const EMBED_MODEL = 'gemini-embedding-001';
export const STUB_MODEL = 'stub-bag-of-words';
export const DIMENSIONS = 768;
/** Cosine at or above this is "close in meaning"; tuned on the stub, adjust once real vectors exist. */
export const MIN_SCORE = 0.55;
/** Added to a session whose title or speaker is literally in the query: enough to clear any threshold and outrank any cosine. */
export const LITERAL_BOOST = 1;

const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents`;
const BATCH = 100;

let injected = null;

/** Swap the embedder for tests: `fn(texts, { task })` → array of vectors. `null` restores the default. */
export function setEmbedder(fn) {
  injected = fn;
}

const stubbed = () => process.env.ORBIT_EMBEDDER === 'stub';

/** The model name stored beside every vector; vectors from different models are never compared. */
export function currentModel() {
  return stubbed() || injected ? STUB_MODEL : EMBED_MODEL;
}

/** True when `embed()` can run: a stub, an injected embedder, or a key. */
export function isConfigured() {
  return Boolean(injected || stubbed() || process.env.GEMINI_API_KEY);
}

export function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/**
 * Score `rows` (`{ id, vector }`) against the query, add any boost for that id,
 * drop what falls under `threshold`, best first (ties by id so the list is stable).
 */
export function rank(queryVec, rows, { threshold = -Infinity, boosts = new Map() } = {}) {
  return rows
    .map((r) => ({ id: r.id, score: cosine(queryVec, r.vector) + (boosts.get(r.id) ?? 0) }))
    .filter((r) => r.score >= threshold)
    .sort((a, b) => b.score - a.score || a.id - b.id);
}

export const vecToBlob = (vec) => Buffer.from(Float32Array.from(vec).buffer);
export const blobToVec = (blob) => Array.from(new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4));

/** What an attendee would describe a talk by. */
export function sourceText(s) {
  return [
    s.title,
    s.subtitle,
    s.abstract,
    s.track && `Track: ${s.track}`,
    s.tags?.length && `Topics: ${s.tags.join(', ')}`,
    s.speakers?.length && `Speakers: ${s.speakers.join(', ')}`,
  ].filter(Boolean).join('\n');
}

export const textHash = (text) => createHash('sha256').update(text).digest('hex');

const normalise = (v) => {
  const n = Math.hypot(...v);
  return n ? v.map((x) => x / n) : v;
};

const STOP = new Set('a an and are as at be by for from how in is it of on or that the this to with what'.split(' '));

/** Hashed bag-of-words: deterministic, offline, and close for texts that share words. */
function stubEmbed(text) {
  const v = new Array(1024).fill(0);
  for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (STOP.has(word)) continue;
    let h = 2166136261;
    for (let i = 0; i < word.length; i++) h = Math.imul(h ^ word.charCodeAt(i), 16777619);
    v[(h >>> 0) % v.length] += 1;
  }
  return normalise(v);
}

async function gemini(texts, task) {
  const out = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        requests: texts.slice(i, i + BATCH).map((text) => ({
          model: `models/${EMBED_MODEL}`,
          content: { parts: [{ text }] },
          taskType: task,
          outputDimensionality: DIMENSIONS,
        })),
      }),
    });
    if (!res.ok) throw new Error(`Gemini embeddings failed: ${res.status}`);
    const { embeddings } = await res.json();
    out.push(...embeddings.map((e) => normalise(e.values)));
  }
  return out;
}

/** Embed `texts`; `task` is `RETRIEVAL_DOCUMENT` (default) or `RETRIEVAL_QUERY`. Throws when not configured. */
export async function embed(texts, { task = 'RETRIEVAL_DOCUMENT' } = {}) {
  if (injected) return injected(texts, { task });
  if (stubbed()) return texts.map(stubEmbed);
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set');
  return gemini(texts, task);
}
