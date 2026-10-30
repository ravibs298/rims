# REST API (`/api/v1`)

Auth: `Authorization: Bearer <JWT>` (obtained from `POST /auth/login`, expires per `JWT_EXPIRES_IN`, default 8h).
Errors: `{ "error": { "code", "message", "details?", "requestId" } }`.
Common statuses: **400** validation/malformed JSON · **401** missing/invalid/expired token or bad credentials · **403** permission or location denied ·
**404** not found · **409** conflict (duplicate, insufficient stock, invalid state transition) · **413** body too large · **422** semantically invalid reference ·
**429** rate limited · **500** unexpected (generic message) · **503** integration not configured / DB not ready.
List endpoints accept `page` (default 1) and `pageSize`, and return `{ data, page, pageSize, total }`.
Probes (no auth, outside `/api/v1`): `GET /health` (liveness), `GET /ready` (DB check).

## Permissions by role
| Permission | Admin | Catalog | Inventory | Store | Order | Supplier | Analyst | Viewer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| products.read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| products.write | ✓ | ✓ | | | | | | |
| inventory.read | ✓ | ✓ | ✓ | ✓ | ✓ | | ✓ | ✓ |
| inventory.adjust / .transfer | ✓ | | ✓ | ✓ | | | | |
| locations.write | ✓ | | ✓ | | | | | |
| orders.read | ✓ | | | ✓ | ✓ | | ✓ | |
| orders.write / .fulfill | ✓ | | | ✓ | ✓ | | | |
| suppliers.read | ✓ | | ✓ | | | ✓ | ✓ | |
| suppliers.write, po.write, po.approve | ✓ | | | | | ✓ | | |
| po.read | ✓ | | ✓ | | | ✓ | ✓ | |
| po.receive | ✓ | | ✓ | | | | | |
| scan.use | ✓ | ✓ | ✓ | ✓ | ✓ | | | |
| reports.read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| integrations.read | ✓ | | | | | | ✓ | |
| users.*, audit.read, integrations.manage | ✓ | | | | | | | |

Store Manager is additionally restricted to assigned locations (403 `LOCATION_FORBIDDEN`). Source of truth: `backend/migrations/002_reference_data.sql`.

## Auth & users (Epic 7)
| Method & path | Permission | Body / notes | Success |
|---|---|---|---|
| `POST /auth/login` | public (20/15 min per IP) | `{email, password}` | 200 `{token, expires_in, user}` |
| `GET /auth/me` | any user | | 200 `{user:{…, permissions[], location_ids}}` |
| `GET /users` | users.read | | 200 |
| `POST /users` | users.write | `{email, full_name, password(≥12, letter+digit), role, location_ids[]}` | 201 |
| `PATCH /users/:id` | users.write | any of `full_name, role, is_active, password, location_ids` · last active Admin cannot be demoted/disabled (409 `LAST_ADMIN`); no self-demotion | 200 |
| `GET /roles` | users.read | roles with permissions | 200 |
| `GET /audit-logs` | audit.read | `user_id, action(prefix), from, to` | 200 |

## Catalog (Epic 1)
| Method & path | Permission | Notes |
|---|---|---|
| `GET /products` | products.read | `q, category_id, active=true\|false, sort=name\|sku\|price\|created_at, dir` · includes `on_hand` |
| `POST /products` | products.write | `{sku, name, description?, price, cost?, category_id?, reorder_point?, image_urls[]}` → 201; duplicate SKU 409 |
| `GET /products/:id` | products.read | includes `images`, `identifiers` |
| `PUT /products/:id` | products.write | partial update; `image_urls` replaces the set |
| `POST /products/:id/deactivate` · `/activate` | products.write | deactivation blocked (409) while stock is reserved |
| `GET/POST /categories` | products.read / write | `{name, parent_id?}` |

## Inventory (Epic 2)
| Method & path | Permission | Notes |
|---|---|---|
| `GET /locations` · `POST /locations` · `PATCH /locations/:id` | read-ish / locations.write | `{code, name, type: store\|warehouse, address?}`; deactivation requires zero stock |
| `GET /inventory/balances` | inventory.read | `product_id, location_id, category_id, low_stock=true` (scoped to user locations) |
| `GET /inventory/movements` | inventory.read | the ledger: `product_id, location_id, type, from, to` |
| `POST /inventory/receipts` | inventory.adjust | `{product_id, location_id, quantity>0, reason?}` |
| `POST /inventory/adjustments` | inventory.adjust | `{product_id, location_id, delta≠0, reason(≥3)}`; 409 if it would go below 0 or below reserved |
| `GET/POST /inventory/transfers` | read / inventory.transfer | `{product_id, from_location_id, to_location_id, quantity, note?}` (atomic, two ledger rows) |
| `GET /inventory/low-stock` | inventory.read | `available ≤ reorder_point`; `level: low\|stockout` |
| `GET /inventory/valuation` | inventory.read | on-hand × current unit cost, by location |

## Orders (Epic 3)
| Method & path | Permission | Notes |
|---|---|---|
| `GET /orders` / `GET /orders/:id` | orders.read | filters `status, location_id, q, from, to`; detail has items, history, reservations |
| `POST /orders` | orders.write | `{customer_name, customer_email?, location_id, shipping_address?, items:[{product_id, quantity}]}` → 201 `reserved`; **409 `INSUFFICIENT_STOCK`** (nothing reserved) |
| `POST /orders/:id/fulfill` | orders.fulfill | decrements on-hand, consumes reservations, queues `order.fulfilled` outbound event |
| `POST /orders/:id/cancel` | orders.write | `{reason}`; only `reserved` orders; releases reservations |
| `POST /orders/:id/ship` | orders.fulfill | `{carrier, tracking_number}` |
| `POST /orders/:id/deliver` | orders.fulfill | |

Status machine: `reserved → fulfilled → shipped → delivered`, `reserved → cancelled`. Anything else is 409 `INVALID_STATUS_TRANSITION`.

## Suppliers & purchasing (Epic 4)
| Method & path | Permission | Notes |
|---|---|---|
| `GET/POST /suppliers`, `GET/PATCH /suppliers/:id` | suppliers.read / write | list includes `performance` (fill rate, on-time rate, avg lead days) |
| `GET /purchase-orders`, `GET /purchase-orders/:id` | po.read | filters `status, supplier_id` |
| `POST /purchase-orders` | po.write | `{supplier_id, location_id, expected_date?, notes?, items:[{product_id, quantity, unit_cost?}]}` → draft |
| `POST /purchase-orders/:id/approve` | po.approve | draft → approved |
| `POST /purchase-orders/:id/cancel` | po.write | draft/approved only |
| `POST /purchase-orders/:id/receive` | po.receive | `{note?, items:[{po_item_id, quantity}]}` → goods receipt, stock + ledger, PO `partially_received`/`received`; over-receipt 409 `OVER_RECEIPT` |

## Barcode / RFID (Epic 5)
| Method & path | Permission | Notes |
|---|---|---|
| `POST /scan/resolve` | scan.use | `{id_type: barcode\|rfid, value, reader?}` → product (`matched_by`: barcode/rfid/sku); 404 if unknown |
| `POST /scan/actions` | scan.use + action permission | `{id_type, value, action: receive\|count\|transfer\|fulfill, location_id?, to_location_id?, quantity, order_id?, po_id?}` |
| `GET /scan/events`, `GET /scan/rfid/readers` | scan.use | audit of scans; registered RFID adapters |
| `GET/POST /products/:id/identifiers`, `DELETE /products/:id/identifiers/:identifierId` | products.read / write | register barcodes and RFID EPCs |

Action permissions: receive → `po.receive` (with `po_id`) else `inventory.adjust`; count → `inventory.adjust`; transfer → `inventory.transfer`; fulfill → `orders.fulfill`.
`count` sets on-hand to the counted quantity and records the variance. `fulfill` increments picked quantity and auto-fulfils the order when every line is picked.
RFID extension: implement `RfidAdapter` (`modules/scan/rfid.ts`) and call `registerRfidAdapter()`.

## Reports (Epic 6) — `reports.read`, filters: `from, to, location_id, category_id, product_id`
`GET /reports/dashboard` · `/inventory-levels` · `/sales-trend` · `/fulfillment` · `/suppliers` · `/reconciliation`.
Definitions: *available* = on-hand − reserved; *low* = 0 < available ≤ reorder point; *stockout* = available ≤ 0 (active products with a balance row);
*valuation* = on-hand × current unit cost; *revenue* excludes cancelled orders; *fulfillment rate* = fulfilled-or-later ÷ non-cancelled orders.
`/reconciliation` verifies balances = ledger sums = active reservations, and order totals = line sums.

## Integrations (Epic 8)
| Method & path | Permission | Notes |
|---|---|---|
| `POST /integrations/inbound/:name` | **HMAC**, not JWT | headers `X-Signature: hex(HMAC-SHA256(secret, raw body))`, `Idempotency-Key`; body `{event_type, payload}`; 201 applied · 200 duplicate (not re-applied) · 202 accepted but failed/dead · 401 bad signature · 422 invalid payload · 503 credential not configured |
| `GET/POST /integrations/configs`, `PATCH /integrations/configs/:id` | read / manage | `{name, adapter_type: erp\|accounting\|webhook, direction, base_url?, secret_ref?, config_json?, enabled, max_attempts}`; `secret_ref` must be an env var name starting `INTEGRATION_` |
| `POST /integrations/configs/:id/test` | manage | real request to the remote system; 503 if not configured |
| `GET /integrations/status` | read | per integration: `disabled \| not_configured \| ready`, counts, last success/error |
| `GET /integrations/events`, `POST /integrations/events/:id/retry`, `POST /integrations/events/process` | read / manage | |
| `GET /integrations/logs`, `GET /integrations/reconciliation` | read | |

Inbound event types: `product.upsert` `{sku, name, price, cost?, description?, category?, reorder_point?}` and
`inventory.adjust` `{sku, location_code, delta, reason?}`. Outbound events: `order.fulfilled`, `goods.received`.
