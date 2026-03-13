import { expect, test } from '@playwright/test';

test.describe('2D research note links', () => {
  test('CFA exposes a research-note deep link and lands on the official-flow note', async ({ page }) => {
    await page.goto('/?view=2d&entity=MIN_CFA&year=2025');

    const researchLink = page.getByRole('link', { name: '調査ノートを開く' });
    await expect(researchLink).toBeVisible();
    await expect(researchLink).toHaveAttribute('href', /view=budget/);
    await expect(researchLink).toHaveAttribute('href', /entity=MIN_CFA/);
    await expect(page.getByText('2025', { exact: true })).toBeVisible();
    await expect(page.getByText('2024', { exact: true })).toHaveCount(0);

    await researchLink.click();

    await expect(page).toHaveURL(/view=budget/);
    await expect(page).toHaveURL(/entity=MIN_CFA/);
    await expect(page).toHaveURL(/tab=research_note/);
    await expect(page.getByText('乳児等通園支援事業の公式フロー', { exact: true })).toBeVisible();
  });

  test('MHLW exposes a research-note deep link and lands on the reviewed note', async ({ page }) => {
    await page.goto('/?view=2d&entity=MIN_MHLW&year=2025');

    const researchLink = page.getByRole('link', { name: '調査ノートを開く' });
    await expect(researchLink).toBeVisible();
    await expect(researchLink).toHaveAttribute('href', /entity=MIN_MHLW/);

    await researchLink.click();

    await expect(page).toHaveURL(/view=budget/);
    await expect(page).toHaveURL(/entity=MIN_MHLW/);
    await expect(page).toHaveURL(/tab=research_note/);
    await expect(page.getByText('令和7年度厚生労働省予算の reviewed 要約', { exact: true })).toBeVisible();
    await expect(page.getByText('34兆3,064億円', { exact: true })).toBeVisible();
  });

  test('entities without knowledge notes do not expose the research-note entry point', async ({ page }) => {
    await page.goto('/?view=2d&entity=USA&year=2024');

    await expect(page.getByRole('link', { name: '調査ノートを開く' })).toHaveCount(0);
    await expect(page.getByRole('combobox')).toHaveValue('USA');
  });

  test('reviewed-only filter hides model-based downstream flows in 2D', async ({ page }) => {
    await page.goto('/?view=2d&entity=MIN_CFA&year=2025');
    const modeledNodeLabel = page.locator('svg text').filter({ hasText: '放課後児童クラブ 公立民営' });
    const reviewedNodeLabel = page.locator('svg text').filter({ hasText: 'こども誰でも通園制度' });

    await expect(page.getByLabel('実データのみ表示')).toBeVisible();
    const reviewedCountBefore = await page.getByTestId('evidence-summary-reviewed').textContent();
    expect(reviewedCountBefore).toMatch(/\d+本/);
    await expect(page.getByTestId('evidence-summary-model-based')).toContainText('10本');
    await expect(modeledNodeLabel).toBeVisible();

    await page.getByLabel('実データのみ表示').check();

    await expect(page.getByTestId('evidence-summary-reviewed')).toContainText(reviewedCountBefore ?? '');
    await expect(page.getByTestId('evidence-summary-model-based')).toContainText('0本');
    await expect(page.getByTestId('evidence-hidden-modeled')).toContainText('10本');
    await expect(modeledNodeLabel).toHaveCount(0);
    await expect(reviewedNodeLabel).toBeVisible();
  });
});
