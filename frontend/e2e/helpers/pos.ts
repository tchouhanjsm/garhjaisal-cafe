import { expect, type Page } from '@playwright/test';
import { E2E_BASE_URL } from './urls';

/**
 * Enters the POS ordering workspace using the active restaurant configuration.
 * The table API is read before inspecting the screen: the product grid can be
 * rendered briefly while the POS table query is still in flight.
 */
export async function enterPosWorkspace(page: Page, tableName?: string): Promise<void> {
  const token = await page.evaluate(() => localStorage.getItem('token'));
  expect(token, 'POS workspace entry requires an authenticated session').toBeTruthy();
  const headers = { Authorization: `Bearer ${token}` };

  const [settingsResponse, tablesResponse] = await Promise.all([
    page.request.get(`${E2E_BASE_URL}/api/settings/business`, { headers }),
    page.request.get(`${E2E_BASE_URL}/api/tables?active=true`, { headers }),
  ]);
  expect(settingsResponse.ok(), 'POS business settings must be readable').toBeTruthy();
  expect(tablesResponse.ok(), 'active POS tables must be readable').toBeTruthy();

  const business = (await settingsResponse.json()) as {
    tables_required?: boolean | string | number;
  };
  const tables = ((await tablesResponse.json()).tables ?? []) as Array<{
    id: string;
    name?: string;
    number?: string;
    status?: string;
  }>;
  const tablesRequired =
    business.tables_required === true ||
    business.tables_required === 1 ||
    business.tables_required === 'true' ||
    business.tables_required === '1';

  const productGrid = page.getByTestId('pos-product-grid');
  const board = page.getByTestId('pos-table-first-picker');
  const allTablesButton = page.getByTestId('pos-all-tables-btn');
  const addItemsButton = page.getByRole('button', { name: /^Add Items$/i });

  if (!tablesRequired || tables.length === 0) {
    expect(
      tableName,
      'a named table fixture must exist when entering table-first POS',
    ).toBeUndefined();
    await expect(productGrid).toBeVisible({ timeout: 15_000 });
    return;
  }

  const requestedTable = tableName
    ? tables.find((table) => (table.name ?? table.number) === tableName)
    : undefined;
  if (tableName) {
    expect(
      requestedTable,
      `table fixture "${tableName}" must be active before opening POS`,
    ).toBeDefined();
  }

  // The table-first screen and the selected-table header are mutually exclusive.
  // Do not accept the transient catalogue render as proof that table data loaded.
  await expect
    .poll(
      async () =>
        (await board.isVisible().catch(() => false)) ||
        (await allTablesButton.isVisible().catch(() => false)) ||
        (await addItemsButton.isVisible().catch(() => false)),
      { timeout: 20_000 },
    )
    .toBe(true);

  if (await board.isVisible()) {
    const cards = board.getByTestId('pos-table-card');
    let target = tableName
      ? cards.filter({ hasText: tableName }).first()
      : cards.filter({ hasText: /available|reserved/i }).first();

    if (!(await target.isVisible().catch(() => false))) {
      target = cards.first();
    }
    const targetDescription = tableName
      ? `table ${tableName} must be on the All Tables board`
      : 'an active table must be on the All Tables board';
    await expect(target, targetDescription).toBeVisible({ timeout: 15_000 });
    await target.click();
    await expect(board).toBeHidden({ timeout: 15_000 });

    if (tableName && requestedTable?.status?.toLowerCase() === 'occupied') {
      // Selecting an occupied table stops at the existing-order decision.
      // Wait for that decision rather than mistaking the catalogue behind the
      // modal for a completed table-selection flow.
      await expect(addItemsButton).toBeVisible({ timeout: 15_000 });
      return;
    }

    if (await addItemsButton.isVisible().catch(() => false)) {
      if (!tableName) await addItemsButton.click();
      else return;
    }
  }

  // A previously selected table can open directly into the existing-order
  // decision without rendering the table board first.
  if (await addItemsButton.isVisible().catch(() => false)) {
    if (!tableName) await addItemsButton.click();
    else return;
  }

  await expect(productGrid).toBeVisible({ timeout: 15_000 });
}
