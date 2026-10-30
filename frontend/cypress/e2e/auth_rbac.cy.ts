// Requires the stack running with seeded data (npm run seed). See README "End-to-end tests".
const pw = () => Cypress.env('seedPassword') as string;
const login = (email: string) => {
  cy.visit('/login');
  cy.get('input[name=email]').type(email);
  cy.get('input[name=password]').type(pw(), { log: false });
  cy.contains('button', 'Sign in').click();
};

describe('authentication and role-based navigation', () => {
  it('redirects anonymous users to the login page', () => {
    cy.visit('/products');
    cy.url().should('include', '/login');
  });
  it('rejects bad credentials with a visible error', () => {
    cy.visit('/login');
    cy.get('input[name=email]').type('admin@xyz-retail.test');
    cy.get('input[name=password]').type('definitely-wrong');
    cy.contains('button', 'Sign in').click();
    cy.get('[role=alert]').should('contain', 'Invalid email or password');
  });
  it('shows admins every area', () => {
    login('admin@xyz-retail.test');
    cy.contains('nav a', 'Users & Roles').should('be.visible');
    cy.contains('nav a', 'Integrations').should('be.visible');
  });
  it('hides restricted areas from viewers and the API still denies them', () => {
    login('viewer@xyz-retail.test');
    cy.contains('nav a', 'Product Catalog').should('be.visible');
    cy.contains('nav a', 'Users & Roles').should('not.exist');
    cy.contains('button', 'New product').should('not.exist');
    cy.visit('/users');
    cy.contains('Access denied').should('be.visible');
    cy.window().then((win) => {
      const token = win.sessionStorage.getItem('rims_token');
      cy.request({ url: `${Cypress.env('apiUrl')}/users`, headers: { Authorization: `Bearer ${token}` }, failOnStatusCode: false }).its('status').should('eq', 403);
    });
  });
});
