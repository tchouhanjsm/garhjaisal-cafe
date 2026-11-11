import { test, expect } from '@playwright/test';
import { E2E_BASE_URL } from './helpers/urls';
import { createTrackedProduct, deleteProduct, login, ownerAuth } from './ops-admin/helpers';

type CatalogProduct = {
  id: string;
  name: string;
  category_id: string | null;
  price: number;
  is_active: boolean;
  updated_at: string;
};

test.describe('Menu Studio to live POS catalog', () => {
  let productId: string | undefined;

  test.afterEach(async ({ request }) => {
    if (!productId) return;
    await deleteProduct({ request }, productId);
    productId = undefined;
  });

  test('refreshes menu availability in POS on focus', async ({ page }) => {
    await login(page, 'owner');

    const originalName = `Menu Refresh Probe ${Date.now()}`;
    const updatedName = `${originalName} Updated`;
    const created = await createTrackedProduct({ request: page.request }, originalName, 85, 10);
    productId = created.id;

    await page.goto(`${E2E_BASE_URL}/pos`);
    const originalCard = page
      .getByTestId('pos-product-card')
      .filter({ hasText: originalName })
      .first();
    await expect(originalCard, 'the newly created catalog item appears in POS').toBeVisible();

    const headers = ownerAuth();
    const readProduct = async (): Promise<CatalogProduct> => {
      const response = await page.request.get(`${E2E_BASE_URL}/api/products`, { headers });
      expect(response.status(), 'the current catalog can be read').toBe(200);
      const { products } = (await response.json()) as { products: CatalogProduct[] };
      const product = products.find((entry) => entry.id === productId);
      expect(product, 'the probe product remains in the canonical catalog').toBeTruthy();
      return product as CatalogProduct;
    };

    const saveThroughMenuStudio = async (
      current: CatalogProduct,
      patch: Partial<Pick<CatalogProduct, 'name' | 'category_id' | 'price' | 'is_active'>>,
    ) => {
      const response = await page.request.post(`${E2E_BASE_URL}/api/menu-studio/updates`, {
        headers,
        data: {
          changes: [
            {
              id: current.id,
              expected_updated_at: current.updated_at,
              expected: {
                name: current.name,
                category_id: current.category_id,
                price: Number(current.price),
                is_active: Boolean(current.is_active),
              },
              patch,
            },
          ],
        },
      });
      expect(
        response.status(),
        `Menu Studio update must save (got ${response.status()} ${await response.text()})`,
      ).toBe(200);
    };

    await saveThroughMenuStudio(await readProduct(), {
      name: updatedName,
      is_active: false,
    });

    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(
      page.getByTestId('pos-product-card').filter({ hasText: originalName }),
      'an unavailable product is removed from the active POS catalog after focus refresh',
    ).toHaveCount(0);

    const unavailable = await readProduct();
    expect(unavailable.name).toBe(updatedName);
    expect(unavailable.is_active).toBe(false);

    await saveThroughMenuStudio(unavailable, { is_active: true });
    await page.evaluate(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });

    await expect(
      page.getByTestId('pos-product-card').filter({ hasText: updatedName }).first(),
      'the renamed available product returns to POS without a page reload',
    ).toBeVisible();
  });
});
