import { Router } from 'express';
import { db } from '../db.js';
import { toPhoto } from '../lib/query.js';

export const photosRouter = Router();

// ~400 KB of base64 — a 640 px JPEG is a fraction of that
const MAX_IMAGE_CHARS = 400_000;
const JPEG_PREFIX = 'data:image/jpeg;base64,';

const SELECT = 'SELECT p.*, u.name AS user_name FROM photos p JOIN users u ON u.id = p.user_id';
const allPhotos = db.prepare(`${SELECT} ORDER BY p.posted_at DESC, p.id DESC`);
const getPhoto = db.prepare(`${SELECT} WHERE p.id = ?`);
const userExists = db.prepare('SELECT 1 FROM users WHERE id = ?');
const insert = db.prepare('INSERT INTO photos (user_id, image, posted_at) VALUES (?, ?, ?)');
const remove = db.prepare('DELETE FROM photos WHERE id = ?');

photosRouter.get('/', (req, res) => {
  res.json(allPhotos.all().map(toPhoto));
});

// The clock comes from the client, as in seats.js: conference time is simulated.
photosRouter.post('/', (req, res) => {
  const { userId, image, day, time } = req.body ?? {};
  if (!userExists.get(userId)) return res.status(404).json({ error: 'Attendee not found' });
  if (typeof image !== 'string' || !image.startsWith(JPEG_PREFIX) || image.length > MAX_IMAGE_CHARS) {
    return res.status(400).json({ error: 'image must be a JPEG data URL under 400 KB' });
  }
  if (!day || !time) return res.status(400).json({ error: 'day and time are required' });

  const { lastInsertRowid } = insert.run(userId, image, `${day}T${time}`);
  res.status(201).json(toPhoto(getPhoto.get(lastInsertRowid)));
});

// No authentication in this app, so "the poster" is the userId the caller claims.
photosRouter.delete('/:id', (req, res) => {
  const photo = getPhoto.get(req.params.id);
  if (!photo) return res.status(404).json({ error: 'Photo not found' });
  if (String(photo.user_id) !== String(req.query.userId)) {
    return res.status(403).json({ error: 'Only the person who posted a photo can delete it' });
  }
  remove.run(photo.id);
  res.json({ ok: true });
});
