import { expect, test } from '@playwright/test';

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
});
