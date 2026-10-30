# Agile roadmap: 15 two-week sprints, one integrated product

Velocity assumption: ~40 points per sprint for a team of 5. Points use a Fibonacci scale. **Every sprint ends with a working, integrated, deployed increment**; every story includes automated tests (unit + integration; E2E where a workflow is completed).
Definition of Done: acceptance criteria met · RBAC enforced on the backend · input validated · audit entries for mutations · tests green in Jenkins · docs updated · deployed to staging.

| Sprint | Goal | Epics | Points |
|---|---|---|---|
| 1 | Foundations: monorepo, DB schema, CI skeleton, auth | 7 | 40 |
| 2 | Product catalog CRUD + RBAC | 1, 7 | 40 |
| 3 | Locations + inventory balances + ledger | 2 | 40 |
| 4 | Adjustments, transfers, low stock, valuation | 2 | 40 |
| 5 | Orders: create + reserve (no oversell) | 3 | 42 |
| 6 | Order fulfillment, cancel, shipping/delivery | 3 | 40 |
| 7 | Suppliers + purchase orders | 4 | 40 |
| 8 | Goods receiving + supplier metrics | 4, 2 | 40 |
| 9 | Barcode/RFID: identifiers, resolve, receive/count | 5 | 40 |
| 10 | Scan transfer/fulfill + RFID adapter interface | 5 | 38 |
| 11 | Dashboard + core reports + filters | 6 | 42 |
| 12 | Reconciliation, fulfillment & supplier analytics | 6 | 38 |
| 13 | Integrations: configs, inbound events, idempotency | 8 | 42 |
| 14 | Outbound outbox, retries, status, reconciliation | 8 | 40 |
| 15 | Hardening: perf, security review, DR drill, UAT, release | all | 38 |

## Sprint detail

### Sprint 1: Foundations (Epic 7)
Dependencies: none. Testing: unit (config, access), integration (login).
* **S1-1 Monorepo + Docker Compose + Jenkins skeleton** (8): *AC*: `docker compose up` runs MySQL/API/UI; pipeline runs lint+unit.
* **S1-2 Schema migrations: users/roles/permissions, locations, audit** (8): *AC*: forward-only runner; roles/permissions seeded; audit tables append-only.
* **S1-3 Login + JWT + `/auth/me`** (8): *AC*: bcrypt hashing; token expiry; generic invalid-credential message; rate limit.
* **S1-4 RBAC middleware + centralized errors/logging** (8): *AC*: 401/403 shapes; no stack traces; request ids.
* **S1-5 Login page + protected routes + nav by permission** (8): *AC*: unauthorized routes show "Access denied"; backend still enforces.

### Sprint 2: Product catalog (Epics 1, 7)
Deps: S1. Testing: Supertest CRUD, validation, RBAC; Cypress login/RBAC.
* **S2-1 Product/category/image schema + CRUD API** (8): *AC*: unique SKU (409), price ≥ 0, image URLs validated.
* **S2-2 Search, filter, sort, pagination** (5): *AC*: sort columns whitelisted; filters by category/status/text.
* **S2-3 Deactivate/activate** (3): *AC*: blocked while stock reserved.
* **S2-4 Product UI (table, form, filters, toasts)** (8): *AC*: all actions call real API.
* **S2-5 User management API + UI, admin safeguards, audit log** (13): *AC*: last Admin protected; Admin grants audited; password policy.
* **S2-6 Role/permission catalog view** (3).

### Sprint 3: Inventory foundations (Epic 2)
Deps: S2. Testing: ledger invariants, concurrency basics.
* **S3-1 `inventory_balances` + `inventory_movements` + CHECK constraints** (8): *AC*: DB rejects negative/over-reserved.
* **S3-2 `applyStockChange` core + ledger** (13): *AC*: one ledger row per change; row lock; stable lock order.
* **S3-3 Locations CRUD (stores/warehouses) + location-scoped access** (8): *AC*: Store Manager sees only assigned locations.
* **S3-4 Receive stock API/UI + balance view** (8): *AC*: Workflow A steps 1-4.

### Sprint 4: Adjust, transfer, alerts, valuation (Epic 2)
* **S4-1 Authorized adjustments with reason** (5) *AC*: cannot go below reserved/zero (409).
* **S4-2 Atomic transfers** (8) *AC*: two ledger rows; opposing transfers can't deadlock.
* **S4-3 Movement history UI + filters** (5). **S4-4 Low-stock/stockout endpoint + UI badges** (5). **S4-5 Valuation** (5). **S4-6 Workflow A E2E** (5; Cypress). **S4-7 Ledger-vs-balance reconciliation query** (5).

### Sprint 5: Orders & reservations (Epic 3)
Deps: S3-S4. Testing: concurrent order test (N parallel requests, exactly stock-many succeed).
* **S5-1 Orders/items/reservations/history schema** (5). **S5-2 Create order + atomic reserve** (13) *AC*: all-or-nothing; 409 with shortage details.
* **S5-3 Order list/detail/filters** (5). **S5-4 Order UI with line editor** (8). **S5-5 Concurrency + oversell tests** (8). **S5-6 Pricing snapshot on order lines** (3).

### Sprint 6: Fulfillment & delivery (Epic 3)
* **S6-1 Fulfill: decrement on-hand, consume reservation** (8). **S6-2 Cancel releases reservation** (5). **S6-3 Status machine** (3) *AC*: invalid transitions 409. **S6-4 Ship/deliver with tracking** (5). **S6-5 Double-fulfill protection** (5). **S6-6 Workflow B E2E** (8). **S6-7 Outbox hook (`order.fulfilled`)** (5).

### Sprint 7: Suppliers & POs (Epic 4)
* **S7-1 Supplier CRUD + UI** (8). **S7-2 PO + items schema, create draft with cost defaults** (8). **S7-3 Approval with `po.approve`** (5). **S7-4 Cancel rules** (3). **S7-5 PO UI** (8). **S7-6 RBAC tests (supplier vs inventory manager)** (5). **S7-7 Audit for PO lifecycle** (3).

### Sprint 8: Receiving & metrics (Epics 4, 2)
* **S8-1 Goods receipts + partial receiving** (13) *AC*: stock + ledger + PO status in one transaction; over-receipt 409.
* **S8-2 Receiving UI** (8). **S8-3 Supplier metrics (fill rate, on-time, lead time)** (8). **S8-4 Outbox `goods.received`** (3). **S8-5 Workflow C E2E** (8).

### Sprint 9: Barcode/RFID I (Epic 5)
* **S9-1 Identifier schema + management API/UI** (8) *AC*: unique per type; RFID normalized.
* **S9-2 Resolve (barcode, RFID, SKU fallback) + scan log** (8). **S9-3 Scan receive (with/without PO)** (8). **S9-4 Scan stock count + variance** (8). **S9-5 Scan UI (keyboard-wedge friendly)** (8).

### Sprint 10: Barcode/RFID II (Epic 5)
* **S10-1 Scan transfer** (5). **S10-2 Scan picking → auto-fulfil** (13). **S10-3 `RfidAdapter` registry + docs** (5). **S10-4 Per-action permission mapping + tests** (5). **S10-5 Workflow D E2E** (8). **S10-6 Scan failure logging** (2).

### Sprint 11: Reporting I (Epic 6)
* **S11-1 Dashboard KPIs** (13). **S11-2 Filters (product/location/category/date) shared across reports** (8). **S11-3 Sales trend** (8). **S11-4 Inventory levels report** (5). **S11-5 Dashboard UI** (8).

### Sprint 12: Reporting II (Epic 6)
* **S12-1 Fulfillment analytics** (8). **S12-2 Supplier performance report** (5). **S12-3 Reconciliation report (ledger/balances/reservations/order totals)** (13). **S12-4 KPI correctness tests against raw SQL** (8). **S12-5 Reports UI** (4).

### Sprint 13: Integrations I (Epic 8)
* **S13-1 Config model, `INTEGRATION_*` secret references, status** (8). **S13-2 Signed inbound endpoint (HMAC) + idempotency keys** (13). **S13-3 Inbound handlers `product.upsert`, `inventory.adjust`** (8). **S13-4 Integration logs + events UI** (8). **S13-5 Honest not-configured behavior tests** (5).

### Sprint 14: Integrations II (Epic 8)
* **S14-1 Outbox delivery worker with claiming + backoff** (13). **S14-2 Retry classification (retryable vs dead)** (5). **S14-3 Manual retry / process-now** (3). **S14-4 Test-connection (real request)** (5). **S14-5 Reconciliation endpoint/UI** (8). **S14-6 Workflow F E2E** (6).

### Sprint 15: Hardening & release
* **S15-1 Security review** (8): dependency audit, headers, rate limits, secrets, SSRF review for integration URLs. **S15-2 Performance** (8): indexes, load test (reservation hot rows). **S15-3 Backup/restore + DR drill** (5). **S15-4 UAT + defect fixes** (10). **S15-5 Runbooks, on-call, dashboards/alarms** (5). **S15-6 Production go-live** (2).

## Dependency summary
Auth/RBAC → Catalog → Inventory/Locations → (Orders, Suppliers/PO) → Barcode/RFID (needs all stock flows) → Reporting (needs all data) → Integrations (needs stable entities and the outbox hooks added in Sprints 6 and 8).
