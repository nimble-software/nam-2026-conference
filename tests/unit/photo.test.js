import './sandbox-db.js';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { toPhoto } from '../../server/lib/query.js';
import { cameraMessage, fitSize } from '../../src/lib/photo.js';

describe('cameraMessage', () => {
  test('says what to do when the camera is blocked', () => {
    assert.match(cameraMessage({ name: 'NotAllowedError' }), /blocked|allow|permission/i);
  });
  test('says when there is no camera', () => {
    assert.match(cameraMessage({ name: 'NotFoundError' }), /no camera/i);
  });
  test('says when the browser cannot do it at all', () => {
    assert.match(cameraMessage(null), /support/i);
  });
  test('gives every case a different sentence', () => {
    const all = [{ name: 'NotAllowedError' }, { name: 'NotFoundError' }, null, { name: 'Other' }].map(cameraMessage);
    assert.equal(new Set(all).size, 4);
  });
});

describe('fitSize', () => {
  test('shrinks the long side to the limit and keeps the aspect ratio', () => {
    assert.deepEqual(fitSize(1280, 720), { width: 640, height: 360 });
    assert.deepEqual(fitSize(720, 1280), { width: 360, height: 640 });
  });
  test('never enlarges a small picture', () => {
    assert.deepEqual(fitSize(320, 240), { width: 320, height: 240 });
  });
  test('honours another limit', () => {
    assert.deepEqual(fitSize(1000, 500, 200), { width: 200, height: 100 });
  });
});

describe('toPhoto', () => {
  test('is camelCase and carries the poster name', () => {
    const photo = toPhoto({ id: 3, user_id: 1, user_name: 'Jonas', image: 'data:image/jpeg;base64,AAAA', posted_at: '2026-01-01T10:30' });
    assert.deepEqual(photo, { id: 3, userId: 1, userName: 'Jonas', image: 'data:image/jpeg;base64,AAAA', postedAt: '2026-01-01T10:30' });
  });
});
