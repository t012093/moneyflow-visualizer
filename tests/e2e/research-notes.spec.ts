import { expect, test, type Page } from '@playwright/test';

test.describe('2D research note links', () => {
  const clickSankeyNode = async (page: Page, label: string) => {
    const nodePosition = await page.evaluate((targetLabel) => {
      const match = Array.from(document.querySelectorAll('svg text')).find((element) =>
        (element.textContent || '').includes(targetLabel)
      );
      if (!match) {
        return null;
      }
      match.scrollIntoView({ block: 'center' });
      const rect = match.getBoundingClientRect();
      return {
        x: rect.x - 12,
        y: rect.y + rect.height / 2,
      };
    }, label);

    expect(nodePosition).not.toBeNull();
    await page.mouse.click(nodePosition!.x, nodePosition!.y);
  };

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

  test('ibasho note can open the dedicated 2D focused flow', async ({ page }) => {
    await page.goto('/?view=budget&entity=MIN_CFA&year=2025&tab=research_note');

    const ibashoCard = page.locator('article').filter({ hasText: 'NPO等と連携したこどもの居場所づくり支援の流れ先メモ' });
    await expect(ibashoCard).toBeVisible();

    const flowLink = ibashoCard.getByRole('link', { name: '2Dフローで見る' });
    await expect(flowLink).toHaveAttribute('href', /view=2d/);
    await expect(flowLink).toHaveAttribute('href', /focus=REC_IBASHO_SUPPORT/);

    await flowLink.click();

    await expect(page).toHaveURL(/view=2d/);
    await expect(page).toHaveURL(/focus=REC_IBASHO_SUPPORT/);
    await expect(page.getByText('こども家庭庁 (CFA) > こどもの居場所づくり支援体制強化事業', { exact: true })).toBeVisible();
    await expect(page.getByText('現在のフィルタ条件では、該当する資金フローデータの記録がありません。', { exact: true })).toBeVisible();
  });

  test('focused 2D flow shows only one layer and reviewed-only hides model-based children', async ({ page }) => {
    await page.goto('/?view=2d&entity=MIN_CFA&year=2025');
    const modeledNodeLabel = page.locator('svg text').filter({ hasText: '放課後児童クラブ 公立民営' });

    await expect(page.getByLabel('実データのみ表示')).toBeVisible();
    await expect(page).not.toHaveURL(/focus=/);
    const reviewedCountBefore = await page.getByTestId('evidence-summary-reviewed').textContent();
    expect(reviewedCountBefore).toMatch(/\d+本/);
    await expect(page.getByTestId('evidence-summary-model-based')).toContainText('0本');
    await expect(modeledNodeLabel).toHaveCount(0);

    await clickSankeyNode(page, '放課後児童クラブ (運営費・処遇改善)');

    await expect(page).toHaveURL(/focus=REC_AFTER_SCHOOL_OP/);
    await expect(page.getByText('こども家庭庁 (CFA) > 放課後児童クラブ (運営費・処遇改善)', { exact: true })).toBeVisible();
    await expect(page.getByTestId('evidence-summary-reviewed')).toContainText('0本');
    const modeledCountBefore = await page.getByTestId('evidence-summary-model-based').textContent();
    expect(modeledCountBefore).toMatch(/[1-9]\d*本/);
    const modeledCountToken = modeledCountBefore?.match(/\d+本/)?.[0];
    expect(modeledCountToken).toBeTruthy();
    await expect(modeledNodeLabel).toBeVisible();

    await page.getByLabel('実データのみ表示').check();

    await expect(page.getByTestId('evidence-summary-reviewed')).toContainText('0本');
    await expect(page.getByTestId('evidence-summary-model-based')).toContainText('0本');
    await expect(page.getByTestId('evidence-hidden-modeled')).toContainText(modeledCountToken!);
    await expect(modeledNodeLabel).toHaveCount(0);
    await expect(page.getByText('現在のフィルタ条件では、該当する資金フローデータの記録がありません。', { exact: true })).toBeVisible();
  });
});
