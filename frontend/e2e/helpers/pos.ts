import { expect, type Page } from '@playwright/test';
import { E2E_BASE_URL } from './urls';

/**
 * Enters the POS ordering workspace using the active restaurant configuration.
 * When table service is required, it selects a known table from the dedicated
 * All Tables board before exposing product/catalogue assertions to the test.
 */
export async function enterPosWorkspace(page: Page, tableName?: string): Promise<void> {
  const token = await page.evaluate(() => localStorage.getItem('token'));
  expect(token, 'POS workspace entry requires an authenticated session').toBeTruthy();

  const settingsResponse = await page.request.get(`${E2E_BASE_URL}/api/settings/business`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(settingsResponse.ok(), 'POS business settings must be readable').toBeTruthy();

  const business = (await settingsResponse.json()) as {
    tables_required?: boolean | string | number;
  };
  const tablesRequired =
    business.tables_required === true ||
    business.tables_required === 1 ||
    business.tables_required === 'true' ||
    business.tables_required === '1';

  const productGrid = page.getByTestId('pos-product-grid');
  if (!tablesRequired) {
    await expect(productGrid).toBeVisible({ timeout: 15_000 });
    return;
  }

  const board = page.getByTestId('pos-table-first-picker');
  const allTablesButton = page.getByTestId('pos-all-tables-btn');
  await expect
    .poll(
      async () =>
        (await board.isVisible().catch(() => false)) ||
        (await allTablesButton.isVisible().catch(() => false)),
      { timeout: 15_000 },
    )
    .toBe(true);

  if (!(await board.isVisible())) {
    if (!tableName) {
      await expect(productGrid).toBeVisible({ timeout: 15_000 });
      return;
    }
    await allTablesButton.click();
    await expect(board).toBeVisible();
  }

  const cards = board.getByTestId('pos-table-card');
  const target = tableName
    ? cards.filter({ hasText: tableName }).first()
    : cards.filter({ hasText: /available/i }).first();
  await expect(
    target,
    tableName ? `table ${tableName} must be on the board` : 'an available table must be on the board',
  ).toBeVisible();
  await target.click();
  await expect(productGrid).toBeVisible({ timeout: 15_000 });
}
