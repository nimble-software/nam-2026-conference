import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { startApi } from './harness.js';

/** A real, tiny JPEG as a data URL — the fake image every photo test posts. */
const IMAGE = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

let api;
let close;
before(async () => { ({ api, close } = await startApi()); });
after(() => close());

const post = (body) => api.post('/photos', body);

describe('Photo booth gallery', () => {
  test('a fresh seed has an empty gallery', async () => {
    assert.deepEqual(await api.json('/photos'), []);
  });

  test('a posted photo is listed newest first with the poster and the posted moment', async () => {
    const older = await post({ userId: 1, image: IMAGE, day: '2026-01-01', time: '10:00' });
    const newer = await post({ userId: 2, image: IMAGE, day: '2026-01-01', time: '10:30' });
    assert.equal(older.status, 201);
    assert.equal(newer.status, 201);

    const list = await api.json('/photos');
    assert.deepEqual(list.map((p) => p.id), [newer.body.id, older.body.id]);
    assert.equal(list[0].postedAt, '2026-01-01T10:30');
    assert.equal(list[0].userId, 2);
    assert.equal(typeof list[0].userName, 'string');
    assert.ok(list[0].userName.length > 0);
    assert.equal(list[0].image, IMAGE);
    assert.ok(!Object.keys(list[0]).some((k) => k.includes('_')), 'camelCase only');
  });

  test('rejects an unknown attendee, a non-JPEG, an oversized image and a missing clock', async () => {
    assert.equal((await post({ userId: 9999, image: IMAGE, day: '2026-01-01', time: '10:00' })).status, 404);
    assert.equal((await post({ userId: 1, image: 'data:text/html;base64,AAAA', day: '2026-01-01', time: '10:00' })).status, 400);
    assert.equal((await post({ userId: 1, image: 'https://example.com/a.jpg', day: '2026-01-01', time: '10:00' })).status, 400);
    const huge = `data:image/jpeg;base64,${'A'.repeat(500_000)}`;
    assert.equal((await post({ userId: 1, image: huge, day: '2026-01-01', time: '10:00' })).status, 400);
    assert.equal((await post({ userId: 1, image: IMAGE })).status, 400);
    assert.equal((await post({ userId: 1, image: IMAGE, day: '2026-01-01' })).status, 400);
  });

  test('only the poster can delete a photo; anyone else gets 403 and the photo stays', async () => {
    const { body: photo } = await post({ userId: 3, image: IMAGE, day: '2026-01-02', time: '09:00' });

    const other = await api.del(`/photos/${photo.id}?userId=4`);
    assert.equal(other.status, 403);
    assert.ok((await api.json('/photos')).some((p) => p.id === photo.id));

    const own = await api.del(`/photos/${photo.id}?userId=3`);
    assert.ok([200, 204].includes(own.status));
    assert.ok(!(await api.json('/photos')).some((p) => p.id === photo.id));

    assert.equal((await api.del(`/photos/${photo.id}?userId=3`)).status, 404);
  });
});
