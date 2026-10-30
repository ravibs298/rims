process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-test-secret-test-secret-1234';
process.env.DB_HOST = process.env.TEST_DB_HOST ?? process.env.DB_HOST ?? 'localhost';
process.env.DB_PORT = process.env.TEST_DB_PORT ?? process.env.DB_PORT ?? '3306';
process.env.DB_USER = process.env.TEST_DB_USER ?? process.env.DB_USER ?? 'rims';
process.env.DB_PASSWORD = process.env.TEST_DB_PASSWORD ?? process.env.DB_PASSWORD ?? 'rims_dev_password';
// A dedicated database: integration tests TRUNCATE data tables. Never point this at a real database.
process.env.DB_NAME = process.env.TEST_DB_NAME ?? 'rims_test';
