# RIMS: Retail Inventory Management System (PRG_RIMS_001)

One integrated application for XYZ Retail Corporation: a modular-monolith **Express + TypeScript** API, one **MySQL 8** database,
one JWT/RBAC system and one **React + TypeScript (Vite)** SPA covering all eight epics.

| Epic | Where |
|---|---|
| 1 Product catalog | `backend/src/modules/catalog`, `frontend/src/pages/Products.tsx` |
| 2 Inventory | `modules/inventory` (ledger core: `stock.ts`), `Inventory.tsx` |
| 3 Orders | `modules/orders`, `Orders.tsx` |
| 4 Suppliers & POs | `modules/suppliers`, `Suppliers.tsx`, `PurchaseOrders.tsx` |
| 5 Barcode / RFID | `modules/scan` (+ `rfid.ts` adapter interface), `Scan.tsx` |
| 6 Reporting | `modules/reports`, `Dashboard.tsx`, `Reports.tsx` |
| 7 Users & access | `modules/users`, `middleware/auth.ts`, `Users.tsx` |
| 8 Integrations | `modules/integrations`, `Integrations.tsx` |

Docs: [API](docs/API.md) · [Architecture](docs/ARCHITECTURE.md) · [ER diagram](docs/ER.md) · [Deployment / AWS EKS](docs/DEPLOYMENT.md) · [15-sprint plan](docs/AGILE.md)

## ⚠ Verification status (read this first)
This project was generated in a sandbox **without network access, MySQL or Docker**, so dependencies could not be installed and nothing that needs them was executed.

| Check | Status |
|---|---|
| Every `.ts`/`.tsx` file parses (TypeScript syntax check) | ✅ done, 0 errors |
| Pure-logic assertions (location scope, order state machine, backoff, HMAC signing, RFID normalization, SQL `Where` builder) | ✅ ran with `tsx`, passed |
| `npm install`, `tsc` type-check, ESLint | ❌ **not run**: expect to fix some type/lint errors on first run |
| SQL migrations on MySQL | ❌ not run |
| Jest unit tests (`backend/tests/unit`) | ❌ written, not run (the pure-logic subset above was run separately) |
| Jest/Supertest integration tests (`backend/tests/integration`: all workflows A–F, RBAC, concurrency, retries, duplicates) | ❌ written, **not run**: they need MySQL |
| Vitest component tests, Cypress E2E | ❌ written, not run |
| Docker builds, Compose, Kubernetes manifests, Jenkinsfile, AWS steps | ❌ not run / not validated |

So treat this as a complete, carefully reviewed first draft, **not as verified software**. Run the commands below in order and fix what they report; the suites are designed to catch exactly the issues likely to remain.

## Quick start with Docker
```bash
docker compose up --build                  # MySQL 8, API (migrates on start), UI
npm install                                # once; commit package-lock.json
SEED_PASSWORD='ChangeMe-2026-dev' DB_HOST=127.0.0.1 DB_USER=rims DB_PASSWORD=rims_dev_password \
  JWT_SECRET=local-dev-only-secret-change-me-0123456789abcdef npm run seed
```
Open http://localhost:8080 (API: http://localhost:4000/api/v1). Seeded users (all use `SEED_PASSWORD`):
`admin@`, `catalog@`, `inventory@`, `store1@` (restricted to ST-001), `orders@`, `suppliers@`, `analyst@`, `viewer@` + `xyz-retail.test`.

## Local development (no Docker for the app)
```bash
# 1. MySQL 8.0.16+ running locally
mysql -uroot -p -e "CREATE DATABASE rims CHARACTER SET utf8mb4; CREATE DATABASE rims_test CHARACTER SET utf8mb4;
  CREATE USER 'rims'@'%' IDENTIFIED BY 'rims_dev_password'; GRANT ALL ON rims.* TO 'rims'@'%'; GRANT ALL ON rims_test.* TO 'rims'@'%';"
# 2. Install and configure
npm install
cp .env.example backend/.env             # edit if needed (JWT_SECRET must be >= 32 chars)
# 3. Migrate and seed (dev only)
npm run migrate && npm run seed
# 4. Run
npm run dev:backend                      # http://localhost:4000
npm run dev:frontend                     # http://localhost:5173 (proxies /api)
```

## Tests
```bash
npm run lint && npm run typecheck
npm run test:unit                        # backend unit (Jest) + frontend component (Vitest); no DB needed
npm run test:integration                 # Jest + Supertest against MySQL database `rims_test` (migrates + TRUNCATES it; never point at real data)
#   override connection with TEST_DB_HOST / TEST_DB_PORT / TEST_DB_USER / TEST_DB_PASSWORD / TEST_DB_NAME
# End-to-end: stack running (Compose) + seeded data
CYPRESS_BASE_URL=http://localhost:8080 CYPRESS_API_URL=http://localhost:4000/api/v1 SEED_PASSWORD='ChangeMe-2026-dev' npm run test:e2e
```
Integration tests cover: login/RBAC/deactivation/last-admin/audit immutability, product CRUD & validation, receipts/adjustments/transfers & ledger,
location restriction, order reserve/fulfill/cancel/ship/deliver, **concurrent orders never oversell**, double-fulfill protection, DB CHECK constraints,
PO create/approve/partial+full receive/over-receipt, barcode & RFID resolve/receive/count/transfer/pick, report/KPI reconciliation, low stock, inbound
integration (bad signature, duplicate events, invalid payload, dead-letter, manual retry), outbound retries (5xx, 4xx, network, exhaustion) and "not configured" honesty.

## Configuration
See `.env.example`. Required: `JWT_SECRET` (≥ 32 chars), `DB_*`. Integration credentials are environment variables named `INTEGRATION_*`, referenced by name from
an integration's `secret_ref`; secrets are never stored in the database or returned by the API.

## Security summary
bcrypt password hashing (cost 12) · JWT HS256 with expiry, user re-loaded per request · RBAC on every route + location scope · Zod validation on every input ·
parameterized SQL (`?` placeholders; sort columns whitelisted) · helmet, CORS allow-list, rate limiting (global + stricter on login) · centralized errors with no stack/SQL leakage ·
audit log (append-only via DB triggers) incl. admin grants/revocations · HMAC-signed inbound webhooks with idempotency keys · DB CHECK constraints as a second line of defence against oversell.

## Documented defaults and known limitations
* Roles and their permissions are fixed in migration `002`; there is no UI to edit role→permission mappings (user→role assignment is managed and audited).
* Only the catalog module is split into controller/service/repository files; other modules keep SQL inside `service.ts` (still parameterized).
* Valuation uses current unit cost (not FIFO/weighted-average). Transfers are immediate (no in-transit state). Orders ship from one location, with no partial fulfillment/backorders.
* Product pickers in forms load the first 100 active products; very large catalogs need a typeahead.
* RFID: tag EPC → product mapping with a pluggable normalization adapter. No batch-read endpoint and no vendor adapters are included.
* Integrations: generic authenticated HTTP adapters for `erp`, `accounting`, `webhook`; vendor-specific field mappings (SAP, NetSuite, QuickBooks…) are **not** implemented and no external system was ever contacted. Inbound event types: `product.upsert`, `inventory.adjust`.
  An integration without `base_url`/credential reports `not_configured` and never reports success.
* The integration worker is an in-process timer (safe across replicas via claim-by-UPDATE). Move to a dedicated worker/queue if volume grows.
* No password reset, MFA, or account lockout (only rate limiting). The JWT is kept in `sessionStorage`; consider httpOnly cookies + CSRF protection if your threat model requires it.
* Prices are displayed in USD; there is no multi-currency or tax handling.
* The first production Admin must be inserted manually (see `docs/DEPLOYMENT.md`); the seed refuses to run in production.
