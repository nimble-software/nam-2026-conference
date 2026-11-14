import { test, expect } from '@playwright/test';
import { API, visit, momentOn, laneFor, shotForPR } from './helpers.js';

// Chromium's fake camera: a test pattern, with the permission prompt answered.
test.use({
  permissions: ['camera'],
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
});

test('take a photo, post it, only its poster can delete it, and a blocked camera has no capture', async ({ page, browser, request }, testInfo) => {
  const lane = await laneFor('photobooth.post', testInfo);
  const at = await momentOn(1, '10:30');
  let posted = null;

  try {
    await visit(page, '/photo-booth', { as: lane.user, at });
    await expect(page.getByRole('heading', { name: 'Photo Booth' })).toBeVisible();

    // live preview from the fake camera, above the gallery
    const video = page.locator('video');
    await expect(video).toBeVisible();
    await expect.poll(() => video.evaluate((v) => v.videoWidth)).toBeGreaterThan(0);
    const capture = page.getByTestId('photo-capture');
    await expect(capture).toBeVisible();
    const gallery = page.getByTestId('photo-gallery');
    expect((await capture.boundingBox()).y).toBeLessThan((await gallery.boundingBox()).y);

    // Take, then Retake returns to live, then Take and Post
    await capture.click();
    await expect(page.getByTestId('photo-retake')).toBeVisible();
    await expect(page.getByTestId('photo-post')).toBeVisible();
    await page.getByTestId('photo-retake').click();
    await expect(capture).toBeVisible();
    await capture.click();

    // a clean gallery shows the invitation (only when no one else has posted)
    const before = await (await request.get(`${API}/photos`)).json();
    if (before.length === 0) await expect(page.getByTestId('photo-empty')).toBeVisible();

    const reply = page.waitForResponse((r) => r.url().endsWith('/api/photos') && r.request().method() === 'POST');
    await page.getByTestId('photo-post').click();
    posted = await (await reply).json();

    // appears at once, first, with the poster's name and a time from the pinned clock
    const first = page.getByTestId('photo-card').first();
    await expect(first).toBeVisible();
    const me = await (await request.get(`${API}/users/${lane.user}`)).json();
    await expect(first).toContainText(me.name);
    await expect(first).toContainText(/posted 1m ago/i);
    await expect(first.getByTestId('photo-delete')).toBeVisible();
    await expect(page.getByTestId('photo-empty')).toHaveCount(0);
    const box = await first.boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width);
    await shotForPR(page, 'Photo Booth gallery');

    // another attendee sees the photo but no delete control
    const other = await browser.newContext({ permissions: ['camera'] });
    const otherPage = await other.newPage();
    await visit(otherPage, '/photo-booth', { as: lane.user === 1 ? 3 : 1, at });
    await expect(otherPage.getByTestId('photo-card').first()).toBeVisible();
    await expect(otherPage.getByTestId('photo-delete')).toHaveCount(0);
    await other.close();

    // a blocked camera: a message, and no capture button
    const blocked = await browser.newContext();
    const blockedPage = await blocked.newPage();
    await blockedPage.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    });
    await visit(blockedPage, '/photo-booth', { as: lane.user, at });
    await expect(blockedPage.getByTestId('camera-blocked')).toBeVisible();
    await expect(blockedPage.getByTestId('photo-capture')).toHaveCount(0);
    await blocked.close();
  } finally {
    if (posted) await request.delete(`${API}/photos/${posted.id}?userId=${lane.user}`);
  }
});
