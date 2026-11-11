import { expect, test } from '@playwright/test';
import { E2E_BASE_URL as BASE } from './helpers/urls';
import { createTrackedProduct, deleteProduct, login, ownerAuth } from './ops-admin/helpers';

type BusinessSettings = Record<string, unknown>;

type CreatedTable = {
  id: string;
  number: string;
};

test.describe('POS shared table state refresh', () => {
  test('refreshes occupied table state in POS on focus', async ({ page, request }) => {
    const headers = ownerAuth();
    let originalBusiness: BusinessSettings | undefined;
    let tableId: string | undefined;
    let orderId: string | number | undefined;
    let productId: string | undefined;

    try {
      const businessResponse = await request.get(`${BASE}/api/settings/business`, { headers });
      expect(businessResponse.ok()).toBeTruthy();
      originalBusiness = (await businessResponse.json()) as BusinessSettings;

      const configured = await request.put(`${BASE}/api/settings/business`, {
        headers,
        data: { ...originalBusiness, billing_type: 'postpaid', tables_required: true },
      });
      expect(configured.ok()).toBeTruthy();

      await login(page, 'owner');
      const initialTables = page.waitForResponse(
        (response) =>
          response.request().method() === 'GET' &&
          response.url().includes('/api/tables') &&
          response.url().includes('include_items=1'),
      );
      await page.goto(`${BASE}/pos`);
      await initialTables;
      await expect(page.getByTestId('cart-table-button')).toBeVisible();

      const tableNumber = `Focus${Date.now().toString().slice(-7)}`;
      const createdTableResponse = await request.post(`${BASE}/api/tables`, {
        headers,
        data: { number: tableNumber, capacity: 2, floor: 'Ground', section: 'Main' },
      });
      expect(createdTableResponse.status()).toBe(201);
      const createdTable = (await createdTableResponse.json()).table as CreatedTable;
      tableId = createdTable.id;

      const product = await createTrackedProduct(
        { request },
        `POS focus order ${Date.now()}`,
        85,
        10,
      );
      productId = product.id;

      const createdOrderResponse = await request.post(`${BASE}/api/orders`, {
        headers,
        data: {
          type: 'dine_in',
          table_id: tableId,
          guest_count: 2,
          items: [{ product_id: product.id, quantity: 1 }],
        },
      });
      expect(createdOrderResponse.status()).toBe(201);
      const { order } = (await createdOrderResponse.json()) as {
        order: { id: string | number; order_number: string };
      };
      orderId = order.id;

      const refreshedTables = page.waitForResponse(
        (response) =>
          response.request().method() === 'GET' &&
          response.url().includes('/api/tables') &&
          response.url().includes('include_items=1'),
      );
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await refreshedTables;

      await page.getByTestId('cart-table-button').click();
      const picker = page.getByRole('heading', { name: /select table/i });
      await expect(picker).toBeVisible();

      const tableCard = page
        .locator('.fixed.inset-0.z-50 button')
        .filter({ hasText: tableNumber })
        .first();
      await expect(tableCard).toContainText(/occupied/i);
      await expect(tableCard).toContainText(`#${order.order_number}`);

      // A second terminal must be able to continue the existing postpaid order.
      await tableCard.click();
      await expect(page.getByRole('heading', { name: tableNumber, exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Add Items', exact: true }).click();

      const productCard = page
        .getByTestId('pos-product-card')
        .filter({ hasText: product.name })
        .first();
      await expect(productCard).toBeVisible();
      await productCard.click();

      const appendButton = page.getByTestId('pos-append-existing-order-btn');
      await expect(appendButton).toBeEnabled();
      const appendResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === `/api/orders/${orderId}/items`,
      );
      await appendButton.click();
      const appended = await appendResponse;
      expect(appended.status(), 'items are appended to the existing table order').toBe(200);

      const latestOrderResponse = await request.get(`${BASE}/api/orders/${orderId}`, { headers });
      expect(latestOrderResponse.ok()).toBeTruthy();
      const { order: latestOrder } = (await latestOrderResponse.json()) as {
        order: { items: Array<Record<string, unknown>> };
      };
      expect(latestOrder.items).toHaveLength(2);
      await expect(page.getByTestId('cart-item')).toHaveCount(0);

      const latestTableResponse = await request.get(`${BASE}/api/tables/${tableId}`, { headers });
      expect(latestTableResponse.ok()).toBeTruthy();
      const { table: latestTable } = (await latestTableResponse.json()) as {
        table: { status: string; current_order?: { id: string | number } | null };
      };
      expect(latestTable.status).toBe('occupied');
      expect(String(latestTable.current_order?.id)).toBe(String(orderId));
    } finally {
      if (orderId !== undefined) {
        await request
          .patch(`${BASE}/api/orders/${orderId}/status`, {
            headers,
            data: { status: 'cancelled', reason: 'E2E cleanup' },
          })
          .catch(() => {});
      }
      if (productId) {
        await deleteProduct({ request }, productId).catch(() => {});
      }
      if (tableId) {
        await request
          .patch(`${BASE}/api/tables/${tableId}/status`, {
            headers,
            data: { status: 'available' },
          })
          .catch(() => {});
        await request
          .post(`${BASE}/api/tables/${tableId}/deactivate`, { headers })
          .catch(() => {});
      }
      if (originalBusiness) {
        await request
          .put(`${BASE}/api/settings/business`, {
            headers,
            data: originalBusiness,
          })
          .catch(() => {});
      }
    }
  });

  test('restores a held cart after POS focus refresh', async ({ page, request }) => {
    const headers = ownerAuth();
    let originalBusiness: BusinessSettings | undefined;
    let tableId: string | undefined;
    let heldOrderId: string | undefined;
    let productId: string | undefined;

    try {
      const businessResponse = await request.get(`${BASE}/api/settings/business`, { headers });
      expect(businessResponse.ok()).toBeTruthy();
      originalBusiness = (await businessResponse.json()) as BusinessSettings;

      const configured = await request.put(`${BASE}/api/settings/business`, {
        headers,
        data: { ...originalBusiness, billing_type: 'postpaid', tables_required: true },
      });
      expect(configured.ok()).toBeTruthy();

      const createdProduct = await createTrackedProduct(
        { request },
        `POS focus held cart ${Date.now()}`,
        85,
        10,
      );
      productId = createdProduct.id;
      const productResponse = await request.get(
        `${BASE}/api/products/${createdProduct.id}`,
        { headers },
      );
      expect(productResponse.status()).toBe(200);
      const { product } = (await productResponse.json()) as {
        product: Record<string, unknown> & { id: string; name: string };
      };

      await login(page, 'owner');
      const initialResponses = Promise.all([
        page.waitForResponse(
          (response) =>
            response.request().method() === 'GET' &&
            response.url().includes('/api/tables') &&
            response.url().includes('include_items=1'),
        ),
        page.waitForResponse(
          (response) =>
            response.request().method() === 'GET' &&
            new URL(response.url()).pathname === '/api/held-orders',
        ),
      ]);
      await page.goto(`${BASE}/pos`);
      await initialResponses;
      await expect(page.getByTestId('cart-table-button')).toBeVisible();

      const tableNumber = `Held${Date.now().toString().slice(-7)}`;
      const createdTableResponse = await request.post(`${BASE}/api/tables`, {
        headers,
        data: { number: tableNumber, capacity: 2, floor: 'Ground', section: 'Main' },
      });
      expect(createdTableResponse.status()).toBe(201);
      const createdTable = (await createdTableResponse.json()).table as CreatedTable;
      tableId = createdTable.id;

      const heldResponse = await request.post(`${BASE}/api/held-orders`, {
        headers,
        data: {
          tableId,
          items: [
            {
              id: 'pos-focus-held-line',
              product,
              quantity: 1,
              addons: [],
              special_instructions: '',
            },
          ],
          customerId: null,
          guestCount: 2,
          orderNotes: 'Created from another terminal',
          waivedChargeIds: [],
          optedInChargeIds: [],
        },
      });
      expect(heldResponse.status()).toBe(200);
      heldOrderId = (await heldResponse.json()).id as string;

      const refreshedResponses = Promise.all([
        page.waitForResponse(
          (response) =>
            response.request().method() === 'GET' &&
            response.url().includes('/api/tables') &&
            response.url().includes('include_items=1'),
        ),
        page.waitForResponse(
          (response) =>
            response.request().method() === 'GET' &&
            new URL(response.url()).pathname === '/api/held-orders',
        ),
      ]);
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await refreshedResponses;

      await page.getByTestId('cart-table-button').click();
      const picker = page.getByRole('heading', { name: /select table/i });
      await expect(picker).toBeVisible();

      const tableCard = page
        .locator('.fixed.inset-0.z-50 button')
        .filter({ hasText: tableNumber })
        .first();
      await expect(tableCard).toContainText(/held/i);
      await tableCard.click();

      await expect(picker).toHaveCount(0);
      const cartItem = page.getByTestId('cart-item').filter({ hasText: product.name });
      await expect(cartItem).toBeVisible();

      const heldOrdersResponse = await request.get(`${BASE}/api/held-orders`, { headers });
      expect(heldOrdersResponse.ok()).toBeTruthy();
      const { orders } = (await heldOrdersResponse.json()) as {
        orders: Array<{ tableId: string }>;
      };
      expect(orders.some((heldOrder) => heldOrder.tableId === tableId)).toBe(false);
    } finally {
      if (tableId && heldOrderId) {
        await request
          .delete(`${BASE}/api/held-orders/${tableId}?heldOrderId=${heldOrderId}`, { headers })
          .catch(() => {});
      }
      if (productId) {
        await deleteProduct({ request }, productId).catch(() => {});
      }
      if (tableId) {
        await request
          .patch(`${BASE}/api/tables/${tableId}/status`, {
            headers,
            data: { status: 'available' },
          })
          .catch(() => {});
        await request
          .post(`${BASE}/api/tables/${tableId}/deactivate`, { headers })
          .catch(() => {});
      }
      if (originalBusiness) {
        await request
          .put(`${BASE}/api/settings/business`, {
            headers,
            data: originalBusiness,
          })
          .catch(() => {});
      }
    }
  });
});
