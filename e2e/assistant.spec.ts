import { expect, test } from './fixtures';

// Talks to the real backend (your Claude subscription or API key), so it only runs when asked:
//   ASSISTANT_E2E=1 npx playwright test e2e/assistant.spec.ts
test.skip(!process.env.ASSISTANT_E2E, 'set ASSISTANT_E2E=1 to run against the real assistant backend');

test('assistant: a tool call changes the scene and shows as a chip', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Play demo beat' }).click();
  await page.keyboard.press('i');
  await expect(page.locator('#ai')).toBeVisible();
  await expect(page.locator('#ai-status')).not.toHaveText('', { timeout: 15_000 });   // backend detected

  await page.locator('#ai-input').fill('Switch to the scene called "Hyper Tunnel". Do nothing else and reply with one word.');
  await page.keyboard.press('Enter');
  await expect(page.locator('#ai-log .ai-tool.ok', { hasText: 'Switched to Hyper Tunnel' })).toBeVisible({ timeout: 180_000 });
  await expect(page.locator('#scene-name')).toContainText('Hyper Tunnel');
  await expect(page.locator('#ai-send')).toHaveText('Send', { timeout: 120_000 });   // the run finished
  await expect(page.locator('#ai-log .ai-note.error')).toHaveCount(0);
  // The reply ends with suggested next requests, shown as chips (and not as text).
  await expect(page.locator('#ai-log .ai-followups button').first()).toBeVisible();
  await expect(page.locator('#ai-log .ai-text')).not.toContainText('FOLLOW-UPS');
});

test('assistant builds a show and plans it; the director runs a cycle', async ({ page }) => {
  test.setTimeout(420_000);
  await page.addInitScript(() => localStorage.removeItem('hallucinate.show'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Play demo beat' }).click();
  await page.keyboard.press('i');
  await expect(page.locator('#ai-status')).not.toHaveText('', { timeout: 15_000 });

  await page.locator('#ai-input').fill('Add "Hyper Tunnel" and "Star Nest" to the studio show and plan them at 16 beats each. Do nothing else and reply with one word.');
  await page.keyboard.press('Enter');
  await expect(page.locator('#ai-log .ai-tool.ok', { hasText: 'Planned 2 steps' })).toBeVisible({ timeout: 240_000 });
  await expect(page.locator('#ai-send')).toHaveText('Send', { timeout: 120_000 });
  await page.keyboard.press('Escape');
  await page.keyboard.press('o');
  await expect(page.locator('#st-cues .cue')).toHaveCount(2);
  await expect(page.locator('#st-plan li')).toHaveCount(3);     // two steps and the tools chip
  await expect(page.locator('#st-auto')).toBeChecked();         // the plan turned the autopilot on

  // One director cycle on a fresh thread: it ends with a plan and a note, and counts its tokens.
  await page.locator('#st-director').check();
  await expect(page.locator('#st-director-status')).toContainText('Planning', { timeout: 15_000 });
  await expect(page.locator('#st-director-status')).not.toContainText('Planning', { timeout: 240_000 });
  await expect(page.locator('#st-director-status')).not.toHaveClass(/error/);
  await expect(page.locator('#st-director-status')).toContainText('next in');
  await expect(page.locator('#st-plan li')).not.toHaveCount(0);
  await page.locator('#st-director').uncheck();
});
