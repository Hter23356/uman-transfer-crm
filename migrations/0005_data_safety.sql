ALTER TABLE orders ADD COLUMN deleted_at TEXT;
ALTER TABLE orders ADD COLUMN deleted_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_deleted_at ON orders(deleted_at);
