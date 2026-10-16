import { expect, seedScenes, test, type Page } from './fixtures';

const param = (name: string) => `const float ${name} = 1.;   // @param min=0 max=2`;
const FLAT = { name: 'Flat Field', body: `${param('A')}\n${param('B')}\nvoid main() { fragColor = vec4(A * .5, B * .5, .5, 1.); }` };
const GROUPED = {
  name: 'Grouped Grid',
  body: [
    '// @group Motion', param('M1'), param('M2'),
    '// @group Glow', param('G1'),
    '// @group Travelling dots', param('D1'), param('D2'), param('D3'),
    'void main() { fragColor = vec4(M1 + M2, G1, D1 + D2 + D3, 1.) * .2; }',
  ].join('\n'),
};

// The widgets fade out and ignore the pointer 3 s after the mouse last moved, and headless software
// WebGL can make a click's stability wait outlast that. So fold with the keyboard, like a user tabbing in.
async function toggle(page: Page, group: string) {
  await page.locator(`#params-list .param-group[data-group="${group}"] .param-group-head`).focus();
  await page.keyboard.press('Enter');
}

async function playScene(page: Page, search: string, name: string) {
  await page.keyboard.press('l');
  await page.keyboard.press('/');
  await page.keyboard.type(search);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('#scene-name')).toContainText(name);
}

test('parameters: @group sections start folded, open and fold, stay that way across a reload; ungrouped scenes stay flat', async ({ page }) => {
  await seedScenes(page, [FLAT, GROUPED]);
  await page.goto('/');
  await page.getByRole('button', { name: 'Play demo beat' }).click();
  await playScene(page, 'flat', 'Flat Field');
  await expect(page.locator('#params')).toBeVisible();
  await expect(page.locator('#params-list .param').first()).toBeVisible();
  await expect(page.locator('#params-list .param-group')).toHaveCount(0);   // this scene has no groups
  await expect(page.locator('#params .params-fold-all')).toHaveCount(0);   // …so no open / fold all

  await playScene(page, 'grouped', 'Grouped Grid');
  const groups = page.locator('#params-list .param-group');
  await expect.poll(() => groups.evaluateAll((els) => els.map((e) => `${e.getAttribute('data-group')}:${e.querySelector('.param-group-head em')?.textContent}`)))
    .toEqual(['Motion:2', 'Glow:1', 'Travelling dots:3']);
  await expect(groups.locator('.param-group-head[aria-expanded="true"]')).toHaveCount(0);   // folded by default
  await expect(page.locator('#params-list .param')).toHaveCount(0);

  const dots = page.locator('#params-list .param-group[data-group="Travelling dots"]');
  await toggle(page, 'Travelling dots');
  await expect(dots.locator('.param-group-head')).toHaveAttribute('aria-expanded', 'true');
  await expect(dots.locator('.param')).toHaveCount(3);

  await page.reload();
  await page.getByRole('button', { name: 'Play demo beat' }).click();
  await expect(page.locator('#scene-name')).toContainText('Grouped Grid');   // the scene on screen is remembered too
  await expect(dots.locator('.param')).toHaveCount(3);
  await expect(page.locator('#params-list .param')).toHaveCount(3);       // only the group that was opened
  await toggle(page, 'Travelling dots');
  await expect(dots.locator('.param')).toHaveCount(0);

  // Everything folded: the button opens all; pressed again it folds all.
  const foldAll = page.locator('#params .params-fold-all');
  await expect(foldAll).toHaveAttribute('aria-label', 'Expand all groups');
  await foldAll.focus();
  await page.keyboard.press('Enter');
  await expect(groups.locator('.param-group-head[aria-expanded="false"]')).toHaveCount(0);
  await expect(page.locator('#params-list .param')).toHaveCount(6);
  await expect(foldAll).toHaveAttribute('aria-label', 'Collapse all groups');
  await page.keyboard.press('Enter');
  await expect(groups.locator('.param-group-head[aria-expanded="true"]')).toHaveCount(0);
  await expect(page.locator('#params-list .param')).toHaveCount(0);
});
