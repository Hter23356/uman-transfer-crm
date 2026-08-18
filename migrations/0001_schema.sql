PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK (role IN ('admin', 'driver')),
  name TEXT NOT NULL,
  login TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS drivers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  telegram TEXT,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cars (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  plate_number TEXT NOT NULL UNIQUE,
  model TEXT,
  seats INTEGER NOT NULL DEFAULT 4,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_name TEXT NOT NULL,
  client_phone TEXT NOT NULL,
  client_messenger TEXT,
  airport TEXT NOT NULL,
  terminal TEXT,
  flight_number TEXT,
  arrival_date TEXT NOT NULL,
  arrival_time TEXT NOT NULL,
  passengers_count INTEGER NOT NULL DEFAULT 1,
  luggage_count INTEGER NOT NULL DEFAULT 0,
  destination_address TEXT NOT NULL,
  client_comment TEXT,
  admin_comment TEXT,
  driver_comment TEXT,
  assigned_driver_id INTEGER REFERENCES drivers(id) ON DELETE SET NULL,
  car_id INTEGER REFERENCES cars(id) ON DELETE SET NULL,
  price REAL NOT NULL DEFAULT 0,
  deposit REAL NOT NULL DEFAULT 0,
  payment_rest REAL NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'deposit_paid', 'paid', 'refunded')),
  trip_status TEXT NOT NULL DEFAULT 'new' CHECK (trip_status IN ('new', 'assigned', 'accepted', 'on_the_way', 'arrived_airport', 'client_in_car', 'arrived_uman', 'completed', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_login ON users(login);
CREATE INDEX IF NOT EXISTS idx_orders_arrival_date ON orders(arrival_date);
CREATE INDEX IF NOT EXISTS idx_orders_driver ON orders(assigned_driver_id);
CREATE INDEX IF NOT EXISTS idx_orders_trip_status ON orders(trip_status);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
