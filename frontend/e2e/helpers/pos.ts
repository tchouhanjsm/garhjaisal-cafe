import { expect, type Page } from '@playwright/test';
import { E2E_BASE_URL } from './urls';

/**
 * Enters the POS ordering workspace using the active restaurant configuration.
 * For table service, product interaction is allowed only after choosing a table
 * from the inline All Tables board. Takeaway/delivery fixtures stay board-free.
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
        (await productGrid.isVisible().catch(() => false)),
      { timeout: 15_000 },
    )
    .toBe(true);

  if (await board.isVisible()) {
    const cards = board.getByTestId('pos-table-card');
    let target = tableName ? cards.filter({ hasText: tableName }).first() : cards.first();
    if (!tableName) {
      const available = cards.filter({ hasText: /available/i }).first();
      if (await available.isVisible().catch(() => false)) target = available;
    }
    const targetDescription = tableName
      ? `table ${tableName} must be on the All Tables board`
      : 'a table must be on the All Tables board';
    await expect(target, targetDescription).toBeVisible({ timeout: 15_000 });
    await target.click();
    await expect(board).toBeHidden({ timeout: 15_000 });
    await expect(productGrid).toBeVisible({ timeout: 15_000 });
    return;
  }

  await expect(productGrid).toBeVisible({ timeout: 15_000 });
  if (tableName) {
    await expect(allTablesButton).toBeVisible({ timeout: 15_000 });
    await expect(allTablesButton).toContainText('All Tables');
  }
}
