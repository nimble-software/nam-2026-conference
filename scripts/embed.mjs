// Embed every session so /schedule can search by meaning: `npm run embed`.
// Needs GEMINI_API_KEY (or ORBIT_EMBEDDER=stub). Rows whose text and model are
// unchanged are skipped, so re-running costs nothing.
import { fileURLToPath } from 'node:url';
import { db, migrate } from '../server/db.js';
import { embed, currentModel, sourceText, textHash, vecToBlob } from '../server/lib/embed.js';

const sessionRows = () => db.prepare(`
  SELECT s.id, s.title, s.subtitle, s.abstract, t.name AS track,
    (SELECT GROUP_CONCAT(tg.name, '|') FROM session_tags st JOIN tags tg ON tg.id = st.tag_id WHERE st.session_id = s.id) AS tags,
    (SELECT GROUP_CONCAT(sp.name, '|') FROM session_speakers ss JOIN speakers sp ON sp.id = ss.speaker_id WHERE ss.session_id = s.id) AS speakers
  FROM sessions s JOIN tracks t ON t.id = s.track_id ORDER BY s.id`).all();

export async function embedSessions() {
  migrate();
  const model = currentModel();
  const stored = new Map(db.prepare('SELECT session_id, model, text_hash FROM session_embeddings')
    .all().map((r) => [r.session_id, r]));
  const todo = sessionRows()
    .map((r) => {
      const text = sourceText({ ...r, tags: r.tags?.split('|'), speakers: r.speakers?.split('|') });
      return { id: r.id, text, hash: textHash(text) };
    })
    .filter((r) => stored.get(r.id)?.text_hash !== r.hash || stored.get(r.id)?.model !== model);
  const total = db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
  if (todo.length) {
    const vectors = await embed(todo.map((r) => r.text), { task: 'RETRIEVAL_DOCUMENT' });
    const put = db.prepare('INSERT OR REPLACE INTO session_embeddings (session_id, model, vector, text_hash) VALUES (?, ?, ?, ?)');
    db.transaction(() => todo.forEach((r, i) => put.run(r.id, model, vecToBlob(vectors[i]), r.hash)))();
  }
  return { embedded: todo.length, skipped: total - todo.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  embedSessions()
    .then(({ embedded, skipped }) => console.log(`Embedded ${embedded} sessions, skipped ${skipped} unchanged.`))
    .catch((err) => { console.error(err.message); process.exit(1); });
}
