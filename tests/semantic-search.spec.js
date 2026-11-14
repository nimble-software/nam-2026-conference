import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { API, visit, waitForResults, laneFor, shotForPR } from './helpers.js';

// The server runs with ORBIT_EMBEDDER=stub (playwright.config.js), a hashed
// bag-of-words, so a description made of a talk's own words finds that talk.
test.beforeAll(() => {
  execFileSync(process.execPath, ['scripts/embed.mjs'], {
    env: { ...process.env, ORBIT_EMBEDDER: 'stub' },
    stdio: 'ignore',
  });
});

test('describing a talk lists the sessions closest in meaning, where the keyword box finds none', async ({ page, request }, testInfo) => {
  const lane = await laneFor('schedule.semantic-search', testInfo);
  const all = await (await request.get(`${API}/sessions`)).json();
  const counts = new Map();
  for (const s of all) counts.set(s.abstract, (counts.get(s.abstract) ?? 0) + 1);
  const talk = all.find((s) => s.day === lane.day && !s.isKeynote && counts.get(s.abstract) === 1);
  const description = `${talk.title}. ${talk.abstract}`;

  await visit(page, `/schedule?day=${lane.day}&view=list`, { as: lane.user });
  await waitForResults(page);
  const rail = page.getByRole('button', { name: /^Filters/ });
  if (await rail.isVisible()) await rail.click();

  // the literal box finds nothing for a whole description…
  await page.getByTestId('search-input').fill(description);
  await waitForResults(page);
  await expect(page.getByTestId('result-count')).toHaveText(/^0 sessions/);
  await page.getByTestId('search-input').fill('');

  // …the describing box ranks the talk first, with a score
  await page.getByTestId('semantic-input').fill(description);
  await expect(page.getByTestId('semantic-mode')).toContainText(/closest in meaning/i);
  const first = page.getByTestId('semantic-result').first();
  await expect(first).toContainText(talk.title);
  await expect(first.getByTestId('semantic-score')).toHaveText(/\d+%/);
  await expect(page).toHaveURL(/ask=/);
  await shotForPR(page, 'Describe what you want results');

  // gibberish matches nothing
  await page.getByTestId('semantic-input').fill('qzxv wjkp vvbn');
  await expect(page.getByTestId('result-count')).toHaveText(/^0 sessions/);
});
