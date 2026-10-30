-- RIMS shared schema. Requires MySQL 8.0.16+ (CHECK constraints are enforced).

CREATE TABLE permissions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(64) NOT NULL,
  description VARCHAR(255) NOT NULL,
  UNIQUE KEY uq_permissions_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE roles (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  description VARCHAR(255) NOT NULL,
  UNIQUE KEY uq_roles_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE role_permissions (
  role_id BIGINT NOT NULL,
  permission_id BIGINT NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_rp_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  CONSTRAINT fk_rp_perm FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE users (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  last_login_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One role per user (the assignment record keeps who assigned it).
CREATE TABLE user_roles (
  user_id BIGINT NOT NULL PRIMARY KEY,
  role_id BIGINT NOT NULL,
  assigned_by BIGINT NULL,
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user_roles_role (role_id),
  CONSTRAINT fk_ur_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_ur_role FOREIGN KEY (role_id) REFERENCES roles(id),
  CONSTRAINT fk_ur_assigner FOREIGN KEY (assigned_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE locations (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(255) NOT NULL,
  type ENUM('store','warehouse') NOT NULL,
  address VARCHAR(500) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_locations_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Location restriction: users with rows here may only act on these locations.
CREATE TABLE user_locations (
  user_id BIGINT NOT NULL,
  location_id BIGINT NOT NULL,
  PRIMARY KEY (user_id, location_id),
  CONSTRAINT fk_ul_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_ul_loc FOREIGN KEY (location_id) REFERENCES locations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE categories (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  parent_id BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_categories_name (name),
  CONSTRAINT fk_cat_parent FOREIGN KEY (parent_id) REFERENCES categories(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE products (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  sku VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  price DECIMAL(12,2) NOT NULL,
  cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  category_id BIGINT NULL,
  reorder_point INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_products_sku (sku),
  KEY idx_products_category (category_id),
  KEY idx_products_name (name),
  CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES categories(id),
  CONSTRAINT ck_products_price CHECK (price >= 0),
  CONSTRAINT ck_products_cost CHECK (cost >= 0),
  CONSTRAINT ck_products_reorder CHECK (reorder_point >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE product_images (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  product_id BIGINT NOT NULL,
  url VARCHAR(1000) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_pi_product (product_id),
  CONSTRAINT fk_pi_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Barcode (UPC/EAN/Code128...) and RFID (EPC) identifiers resolve to catalog products.
CREATE TABLE product_identifiers (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  product_id BIGINT NOT NULL,
  id_type ENUM('barcode','rfid') NOT NULL,
  value VARCHAR(128) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_identifier (id_type, value),
  KEY idx_identifier_product (product_id),
  CONSTRAINT fk_ident_product FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE inventory_balances (
  product_id BIGINT NOT NULL,
  location_id BIGINT NOT NULL,
  on_hand INT NOT NULL DEFAULT 0,
  reserved INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (product_id, location_id),
  KEY idx_balance_location (location_id),
  CONSTRAINT fk_bal_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT fk_bal_location FOREIGN KEY (location_id) REFERENCES locations(id),
  -- Database-level oversell protection, independent of application logic.
  CONSTRAINT ck_bal_on_hand CHECK (on_hand >= 0),
  CONSTRAINT ck_bal_reserved CHECK (reserved >= 0),
  CONSTRAINT ck_bal_reserved_le_on_hand CHECK (reserved <= on_hand)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Append-only ledger: every change to on_hand or reserved writes exactly one row.
CREATE TABLE inventory_movements (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  product_id BIGINT NOT NULL,
  location_id BIGINT NOT NULL,
  movement_type ENUM('receipt','adjustment','transfer_in','transfer_out','sale','count','reserve','release') NOT NULL,
  on_hand_delta INT NOT NULL DEFAULT 0,
  reserved_delta INT NOT NULL DEFAULT 0,
  on_hand_after INT NOT NULL,
  reserved_after INT NOT NULL,
  reference_type VARCHAR(32) NULL,
  reference_id VARCHAR(64) NULL,
  reason VARCHAR(255) NULL,
  user_id BIGINT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_mov_pl (product_id, location_id, created_at),
  KEY idx_mov_ref (reference_type, reference_id),
  KEY idx_mov_created (created_at),
  CONSTRAINT fk_mov_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT fk_mov_location FOREIGN KEY (location_id) REFERENCES locations(id),
  CONSTRAINT fk_mov_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE stock_transfers (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  product_id BIGINT NOT NULL,
  from_location_id BIGINT NOT NULL,
  to_location_id BIGINT NOT NULL,
  quantity INT NOT NULL,
  note VARCHAR(255) NULL,
  status ENUM('completed') NOT NULL DEFAULT 'completed',
  created_by BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_tr_product (product_id),
  KEY idx_tr_from (from_location_id),
  KEY idx_tr_to (to_location_id),
  CONSTRAINT fk_tr_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT fk_tr_from FOREIGN KEY (from_location_id) REFERENCES locations(id),
  CONSTRAINT fk_tr_to FOREIGN KEY (to_location_id) REFERENCES locations(id),
  CONSTRAINT fk_tr_user FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT ck_tr_qty CHECK (quantity > 0),
  CONSTRAINT ck_tr_locations CHECK (from_location_id <> to_location_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE orders (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  order_number VARCHAR(40) NOT NULL,
  customer_name VARCHAR(255) NOT NULL,
  customer_email VARCHAR(255) NULL,
  location_id BIGINT NOT NULL,
  status ENUM('reserved','fulfilled','shipped','delivered','cancelled') NOT NULL,
  shipping_address VARCHAR(500) NULL,
  carrier VARCHAR(64) NULL,
  tracking_number VARCHAR(128) NULL,
  total_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  cancel_reason VARCHAR(255) NULL,
  created_by BIGINT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  fulfilled_at TIMESTAMP(3) NULL DEFAULT NULL,
  shipped_at TIMESTAMP(3) NULL DEFAULT NULL,
  delivered_at TIMESTAMP(3) NULL DEFAULT NULL,
  UNIQUE KEY uq_orders_number (order_number),
  KEY idx_orders_status (status),
  KEY idx_orders_location (location_id, created_at),
  KEY idx_orders_created (created_at),
  CONSTRAINT fk_orders_location FOREIGN KEY (location_id) REFERENCES locations(id),
  CONSTRAINT fk_orders_user FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE order_items (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT NOT NULL,
  product_id BIGINT NOT NULL,
  quantity INT NOT NULL,
  picked_quantity INT NOT NULL DEFAULT 0,
  unit_price DECIMAL(12,2) NOT NULL,
  UNIQUE KEY uq_order_product (order_id, product_id),
  KEY idx_oi_product (product_id),
  CONSTRAINT fk_oi_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_oi_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT ck_oi_qty CHECK (quantity > 0),
  CONSTRAINT ck_oi_picked CHECK (picked_quantity >= 0 AND picked_quantity <= quantity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE order_status_history (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT NOT NULL,
  from_status VARCHAR(16) NULL,
  to_status VARCHAR(16) NOT NULL,
  note VARCHAR(255) NULL,
  user_id BIGINT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_osh_order (order_id),
  CONSTRAINT fk_osh_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_osh_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE stock_reservations (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT NOT NULL,
  product_id BIGINT NOT NULL,
  location_id BIGINT NOT NULL,
  quantity INT NOT NULL,
  status ENUM('active','fulfilled','released') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_res_order (order_id),
  KEY idx_res_pl_status (product_id, location_id, status),
  CONSTRAINT fk_res_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_res_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT fk_res_location FOREIGN KEY (location_id) REFERENCES locations(id),
  CONSTRAINT ck_res_qty CHECK (quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE suppliers (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  contact_name VARCHAR(255) NULL,
  email VARCHAR(255) NULL,
  phone VARCHAR(64) NULL,
  address VARCHAR(500) NULL,
  lead_time_days INT NOT NULL DEFAULT 7,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_suppliers_name (name),
  CONSTRAINT ck_suppliers_lead CHECK (lead_time_days >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE purchase_orders (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  po_number VARCHAR(40) NOT NULL,
  supplier_id BIGINT NOT NULL,
  location_id BIGINT NOT NULL,
  status ENUM('draft','approved','partially_received','received','cancelled') NOT NULL DEFAULT 'draft',
  expected_date DATE NULL,
  total_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  notes VARCHAR(500) NULL,
  created_by BIGINT NULL,
  approved_by BIGINT NULL,
  approved_at TIMESTAMP(3) NULL DEFAULT NULL,
  completed_at TIMESTAMP(3) NULL DEFAULT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_po_number (po_number),
  KEY idx_po_supplier (supplier_id, status),
  KEY idx_po_location (location_id),
  CONSTRAINT fk_po_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CONSTRAINT fk_po_location FOREIGN KEY (location_id) REFERENCES locations(id),
  CONSTRAINT fk_po_created FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_po_approved FOREIGN KEY (approved_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE purchase_order_items (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  po_id BIGINT NOT NULL,
  product_id BIGINT NOT NULL,
  quantity_ordered INT NOT NULL,
  quantity_received INT NOT NULL DEFAULT 0,
  unit_cost DECIMAL(12,2) NOT NULL,
  UNIQUE KEY uq_po_product (po_id, product_id),
  KEY idx_poi_product (product_id),
  CONSTRAINT fk_poi_po FOREIGN KEY (po_id) REFERENCES purchase_orders(id),
  CONSTRAINT fk_poi_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT ck_poi_ordered CHECK (quantity_ordered > 0),
  CONSTRAINT ck_poi_received CHECK (quantity_received >= 0 AND quantity_received <= quantity_ordered),
  CONSTRAINT ck_poi_cost CHECK (unit_cost >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE goods_receipts (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  po_id BIGINT NOT NULL,
  location_id BIGINT NOT NULL,
  received_by BIGINT NULL,
  note VARCHAR(255) NULL,
  received_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_gr_po (po_id),
  CONSTRAINT fk_gr_po FOREIGN KEY (po_id) REFERENCES purchase_orders(id),
  CONSTRAINT fk_gr_location FOREIGN KEY (location_id) REFERENCES locations(id),
  CONSTRAINT fk_gr_user FOREIGN KEY (received_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE goods_receipt_items (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  receipt_id BIGINT NOT NULL,
  po_item_id BIGINT NOT NULL,
  product_id BIGINT NOT NULL,
  quantity INT NOT NULL,
  KEY idx_gri_receipt (receipt_id),
  CONSTRAINT fk_gri_receipt FOREIGN KEY (receipt_id) REFERENCES goods_receipts(id),
  CONSTRAINT fk_gri_poi FOREIGN KEY (po_item_id) REFERENCES purchase_order_items(id),
  CONSTRAINT fk_gri_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT ck_gri_qty CHECK (quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE scan_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  id_type ENUM('barcode','rfid') NOT NULL,
  value VARCHAR(128) NOT NULL,
  product_id BIGINT NULL,
  action VARCHAR(16) NOT NULL,
  location_id BIGINT NULL,
  quantity INT NULL,
  result ENUM('ok','not_found','error') NOT NULL,
  message VARCHAR(255) NULL,
  user_id BIGINT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_scan_created (created_at),
  KEY idx_scan_product (product_id),
  CONSTRAINT fk_scan_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT fk_scan_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Integrations: only the NAME of the env var holding a credential is stored, never the secret.
CREATE TABLE integration_configs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  adapter_type ENUM('erp','accounting','webhook') NOT NULL,
  direction ENUM('inbound','outbound','both') NOT NULL,
  base_url VARCHAR(500) NULL,
  secret_ref VARCHAR(64) NULL,
  config_json JSON NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  created_by BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_integration_name (name),
  CONSTRAINT fk_ic_user FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT ck_ic_attempts CHECK (max_attempts BETWEEN 1 AND 20)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE integration_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  config_id BIGINT NOT NULL,
  direction ENUM('inbound','outbound') NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  payload JSON NOT NULL,
  status ENUM('pending','processing','succeeded','failed','dead') NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMP(3) NULL DEFAULT NULL,
  last_error VARCHAR(1000) NULL,
  response_status INT NULL,
  processed_at TIMESTAMP(3) NULL DEFAULT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_event_idem (config_id, direction, idempotency_key),
  KEY idx_event_due (status, next_attempt_at),
  CONSTRAINT fk_ie_config FOREIGN KEY (config_id) REFERENCES integration_configs(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE integration_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  config_id BIGINT NULL,
  event_id BIGINT NULL,
  level ENUM('info','warn','error') NOT NULL,
  message VARCHAR(1000) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_il_event (event_id),
  KEY idx_il_config (config_id, created_at),
  CONSTRAINT fk_il_config FOREIGN KEY (config_id) REFERENCES integration_configs(id),
  CONSTRAINT fk_il_event FOREIGN KEY (event_id) REFERENCES integration_events(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE audit_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NULL,
  action VARCHAR(64) NOT NULL,
  entity_type VARCHAR(48) NOT NULL,
  entity_id VARCHAR(64) NULL,
  details JSON NULL,
  ip VARCHAR(64) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_audit_user (user_id, created_at),
  KEY idx_audit_action (action, created_at),
  KEY idx_audit_entity (entity_type, entity_id),
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Audit trail and stock ledger are append-only at the database level.
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_logs FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only';
CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_logs FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only';
CREATE TRIGGER trg_mov_no_update BEFORE UPDATE ON inventory_movements FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'inventory_movements is append-only';
CREATE TRIGGER trg_mov_no_delete BEFORE DELETE ON inventory_movements FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'inventory_movements is append-only';
