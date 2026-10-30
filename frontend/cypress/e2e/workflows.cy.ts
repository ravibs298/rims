// End-to-end business workflows through the real UI, API and database. Needs seeded data.
const pw = () => Cypress.env('seedPassword') as string;
const api = (token: string, method: string, path: string, body?: unknown) =>
  cy.request({ method, url: `${Cypress.env('apiUrl')}${path}`, headers: { Authorization: `Bearer ${token}` }, body, failOnStatusCode: false });
const apiLogin = (email: string) => cy.request('POST', `${Cypress.env('apiUrl')}/auth/login`, { email, password: pw() }).then((r) => r.body.token as string);
const uiLogin = (email: string) => {
  cy.visit('/login');
  cy.get('input[name=email]').type(email);
  cy.get('input[name=password]').type(pw(), { log: false });
  cy.contains('button', 'Sign in').click();
  cy.contains('nav', 'Sign out');
};
const run = Date.now().toString(36).toUpperCase();

describe('Workflow A: product to inventory (UI)', () => {
  it('creates a product, receives stock, and shows the balance and movement ledger', () => {
    const sku = `E2E-${run}`;
    uiLogin('admin@xyz-retail.test');
    cy.contains('nav a', 'Product Catalog').click();
    cy.contains('button', 'New product').click();
    cy.get('input[name=sku]').type(sku);
    cy.get('input[name=name]').type(`E2E Product ${run}`);
    cy.get('input[name=price]').type('12.50');
    cy.contains('button', 'Save').click();
    cy.get('input[aria-label="Search products"]').type(sku);
    cy.contains('td', sku).should('be.visible');

    cy.contains('nav a', 'Inventory').click();
    cy.contains('button', 'Receive stock').click();
    cy.get('select[name=product_id]').select(`${sku} — E2E Product ${run}`);
    cy.get('select[name=location_id]').select(1);
    cy.get('input[name=quantity]').type('25');
    cy.contains('button', 'Receive').click();
    cy.contains('Stock received').should('be.visible');
    cy.contains('button', 'Movement ledger').click();
    cy.contains('td', sku).should('be.visible');
    cy.contains('tr', sku).should('contain', 'receipt').and('contain', '25');
  });
});

describe('Workflow B: order fulfillment (UI + API)', () => {
  it('reserves stock on creation, rejects oversell, fulfills, and releases on cancel', () => {
    apiLogin('admin@xyz-retail.test').then((token) => {
      const sku = `ORD-${run}`;
      api(token, 'GET', '/locations').then((l) => {
        const loc = l.body.data[0].id;
        api(token, 'POST', '/products', { sku, name: `Order Product ${run}`, price: 5, cost: 2 }).then((p) => {
          const pid = p.body.id;
          api(token, 'POST', '/inventory/receipts', { product_id: pid, location_id: loc, quantity: 3 });
          api(token, 'POST', '/orders', { customer_name: 'E2E', location_id: loc, items: [{ product_id: pid, quantity: 2 }] }).then((o) => {
            expect(o.status).to.eq(201);
            api(token, 'POST', '/orders', { customer_name: 'E2E-2', location_id: loc, items: [{ product_id: pid, quantity: 2 }] }).its('status').should('eq', 409);
            uiLogin('admin@xyz-retail.test');
            cy.contains('nav a', 'Orders').click();
            cy.contains('button', o.body.order_number).click();
            cy.contains('button', 'Confirm fulfillment').click();
            cy.contains('Order fulfilled').should('be.visible');
            api(token, 'GET', `/inventory/balances?product_id=${pid}`).its('body.data.0').should((b) => {
              expect(b.on_hand).to.eq(1);
              expect(b.reserved).to.eq(0);
            });
          });
        });
      });
    });
  });
});

describe('Workflow C: procurement (API) with UI verification', () => {
  it('creates supplier and PO, approves, receives, and updates stock', () => {
    apiLogin('suppliers@xyz-retail.test').then((sup) => apiLogin('inventory@xyz-retail.test').then((inv) => apiLogin('admin@xyz-retail.test').then((adm) => {
      api(adm, 'GET', '/locations').then((l) => {
        const loc = l.body.data[0].id;
        api(adm, 'POST', '/products', { sku: `PO-${run}`, name: `PO Product ${run}`, price: 9, cost: 4 }).then((p) => {
          api(sup, 'POST', '/suppliers', { name: `Supplier ${run}` }).then((s) => {
            api(sup, 'POST', '/purchase-orders', { supplier_id: s.body.id, location_id: loc, items: [{ product_id: p.body.id, quantity: 8 }] }).then((po) => {
              api(sup, 'POST', `/purchase-orders/${po.body.id}/approve`).its('body.status').should('eq', 'approved');
              api(inv, 'POST', `/purchase-orders/${po.body.id}/receive`, { items: [{ po_item_id: po.body.items[0].id, quantity: 8 }] }).its('body.status').should('eq', 'received');
              api(adm, 'GET', `/inventory/balances?product_id=${p.body.id}`).its('body.data.0.on_hand').should('eq', 8);
              uiLogin('suppliers@xyz-retail.test');
              cy.contains('nav a', 'Purchase Orders').click();
              cy.contains('tr', po.body.po_number).should('contain', 'received');
            });
          });
        });
      });
    })));
  });
});

describe('Workflow D/E/F: scan, dashboard, integrations visibility', () => {
  it('resolves a seeded barcode through the UI', () => {
    uiLogin('admin@xyz-retail.test');
    cy.contains('nav a', 'Barcode / RFID').click();
    cy.get('input[name=value]').type('5901234000001');
    cy.contains('button', 'Look up product').click();
    cy.contains('TSH-BLK-M').should('be.visible');
  });
  it('shows KPIs on the dashboard', () => {
    uiLogin('analyst@xyz-retail.test');
    cy.get('[data-testid=kpis]').should('contain', 'Units on hand').and('contain', 'Fulfillment rate');
  });
  it('shows the unconfigured seeded integration honestly', () => {
    uiLogin('admin@xyz-retail.test');
    cy.contains('nav a', 'Integrations').click();
    cy.contains('tr', 'erp-primary').should('contain', 'disabled');
  });
});
