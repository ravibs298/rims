-- Reference data required by every environment (roles, permissions, role->permission mapping).
INSERT INTO permissions (code, description) VALUES
 ('products.read','View products'),('products.write','Create/update/deactivate products'),
 ('inventory.read','View inventory'),('inventory.adjust','Adjust/receive/count stock'),
 ('inventory.transfer','Transfer stock between locations'),('locations.write','Manage locations'),
 ('orders.read','View orders'),('orders.write','Create/cancel orders'),('orders.fulfill','Fulfill/ship/deliver orders'),
 ('suppliers.read','View suppliers'),('suppliers.write','Manage suppliers'),
 ('po.read','View purchase orders'),('po.write','Create purchase orders'),
 ('po.approve','Approve purchase orders'),('po.receive','Receive goods'),
 ('scan.use','Use barcode/RFID workflows'),('reports.read','View reports and dashboard'),
 ('users.read','View users'),('users.write','Manage users and roles'),
 ('integrations.read','View integration status'),('integrations.manage','Configure integrations'),
 ('audit.read','View audit logs');

INSERT INTO roles (name, description) VALUES
 ('Admin','Full access; changes are audited'),
 ('Catalog Manager','Owns the product catalog'),
 ('Inventory Manager','Owns stock, transfers and receiving'),
 ('Store Manager','Runs a store (restricted to assigned locations)'),
 ('Order Manager','Owns customer orders and fulfillment'),
 ('Supplier Manager','Owns suppliers and purchase orders'),
 ('Analyst','Read-only access to data and reports'),
 ('Viewer','Basic read-only access');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p WHERE r.name = 'Admin';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN
 ('products.read','products.write','inventory.read','scan.use','reports.read') WHERE r.name = 'Catalog Manager';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN
 ('products.read','inventory.read','inventory.adjust','inventory.transfer','locations.write','suppliers.read',
  'po.read','po.receive','scan.use','reports.read') WHERE r.name = 'Inventory Manager';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN
 ('products.read','inventory.read','inventory.adjust','inventory.transfer','orders.read','orders.write',
  'orders.fulfill','scan.use','reports.read') WHERE r.name = 'Store Manager';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN
 ('products.read','inventory.read','orders.read','orders.write','orders.fulfill','scan.use','reports.read')
 WHERE r.name = 'Order Manager';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN
 ('products.read','suppliers.read','suppliers.write','po.read','po.write','po.approve','reports.read')
 WHERE r.name = 'Supplier Manager';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN
 ('products.read','inventory.read','orders.read','suppliers.read','po.read','reports.read','integrations.read')
 WHERE r.name = 'Analyst';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN
 ('products.read','inventory.read','reports.read') WHERE r.name = 'Viewer';
