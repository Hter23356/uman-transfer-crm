const TRIP_STATUSES = [
  'new',
  'assigned',
  'accepted',
  'on_the_way',
  'arrived_airport',
  'client_in_car',
  'arrived_uman',
  'completed',
  'cancelled',
];

const PAYMENT_STATUSES = ['unpaid', 'deposit_paid', 'paid', 'refunded'];
const DEFAULT_TRIP_DURATION = 300;
const LOGIN_WINDOW_MINUTES = 15;
const LOGIN_MAX_ATTEMPTS = 5;

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, '') || '/';

  try {
    await cleanupSessions(env.DB);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204 });
    }

    verifyOrigin(request, url);

    if (path === '/auth/login' && request.method === 'POST') return await login(request, env, url);
    if (path === '/auth/logout' && request.method === 'POST') return await logout(request, env, url);
    if (path === '/auth/me' && request.method === 'GET') return await me(request, env);

    const session = await requireUser(request, env);
    if (path === '/auth/password' && request.method === 'POST') return await changePassword(request, env, session.user, url);
    if (path === '/auth/logout-all' && request.method === 'POST') return await logoutAll(env, session.user, url);

    if (path.startsWith('/admin/')) {
      requireRole(session.user, 'admin');
      return await adminRoutes(path, request, env, session.user);
    }

    if (path.startsWith('/driver/')) {
      requireRole(session.user, 'driver');
      return await driverRoutes(path, request, env, session.user);
    }

    return json({ error: 'Not found' }, 404);
  } catch (error) {
    const status = error.status || 500;
    return json({
      error: status === 500 ? 'Server error' : error.message,
      ...(error.details ? { details: error.details } : {}),
    }, status);
  }
}

async function adminRoutes(path, request, env, user) {
  const url = new URL(request.url);

  if (path === '/admin/dashboard' && request.method === 'GET') {
    const businessToday = businessDate();
    const monthKey = businessToday.slice(0, 7);
    const today = await env.DB.prepare('SELECT COUNT(*) AS count FROM orders WHERE deleted_at IS NULL AND arrival_date = ?')
      .bind(businessToday).first();
    const activeOrders = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM orders WHERE deleted_at IS NULL AND trip_status NOT IN ('completed', 'cancelled')"
    ).first();
    const activeDrivers = await env.DB.prepare('SELECT COUNT(*) AS count FROM drivers WHERE is_active = 1').first();
    const monthIncome = await env.DB.prepare(
      "SELECT COALESCE(SUM(price), 0) AS total FROM orders WHERE deleted_at IS NULL AND payment_status = 'paid' AND substr(arrival_date, 1, 7) = ?"
    ).bind(monthKey).first();
    const upcoming = await listOrders(env.DB, { dateFrom: businessToday, limit: 6 });
    return json({ today, activeOrders, activeDrivers, monthIncome, upcoming });
  }

  if (path === '/admin/orders' && request.method === 'GET') {
    return json({ orders: await listOrders(env.DB, Object.fromEntries(url.searchParams)) });
  }

  if (path === '/admin/orders' && request.method === 'POST') {
    const payload = await request.json();
    const id = await createOrder(env.DB, payload);
    await logAudit(env.DB, user.id, 'create', 'order', id, `Создан заказ #${id}`, payload);
    return json({ order: await getOrderById(env.DB, id) }, 201);
  }

  if (path === '/admin/availability' && request.method === 'GET') {
    const payload = Object.fromEntries(url.searchParams);
    const conflicts = await findTimeConflicts(env.DB, payload, payload.exclude_order_id);
    return json({ conflicts });
  }

  if (path === '/admin/audit' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT audit_logs.*, users.name AS user_name
       FROM audit_logs
       LEFT JOIN users ON users.id = audit_logs.user_id
       ORDER BY audit_logs.created_at DESC, audit_logs.id DESC
       LIMIT 200`
    ).all();
    return json({ logs: results });
  }

  if (path === '/admin/safety' && request.method === 'GET') {
    const deletedOrders = await listOrders(env.DB, { includeDeleted: true, deletedOnly: true, limit: 50 });
    return json({
      deletedOrders,
      exports: [
        { label: 'Все заказы CSV', href: '/api/admin/export/orders.csv' },
        { label: 'Водители CSV', href: '/api/admin/export/drivers.csv' },
        { label: 'Машины CSV', href: '/api/admin/export/cars.csv' },
        { label: 'Журнал действий CSV', href: '/api/admin/export/audit.csv' },
      ],
    });
  }

  if (path === '/admin/export/orders.csv' && request.method === 'GET') {
    return csvResponse('orders.csv', await exportOrdersCsv(env.DB));
  }

  if (path === '/admin/export/drivers.csv' && request.method === 'GET') {
    return csvResponse('drivers.csv', await exportDriversCsv(env.DB));
  }

  if (path === '/admin/export/cars.csv' && request.method === 'GET') {
    return csvResponse('cars.csv', await exportTableCsv(env.DB, 'cars'));
  }

  if (path === '/admin/export/audit.csv' && request.method === 'GET') {
    return csvResponse('audit.csv', await exportAuditCsv(env.DB));
  }

  const orderMatch = path.match(/^\/admin\/orders\/(\d+)$/);
  if (orderMatch && request.method === 'GET') {
    return json({ order: await requireOrder(env.DB, orderMatch[1]) });
  }

  if (orderMatch && request.method === 'PUT') {
    const payload = await request.json();
    const before = await requireOrder(env.DB, orderMatch[1]);
    await updateOrder(env.DB, orderMatch[1], payload);
    const order = await requireOrder(env.DB, orderMatch[1]);
    await logAudit(env.DB, user.id, 'update', 'order', order.id, `Изменён заказ #${order.id}`, changedFields(before, order));
    return json({ order });
  }

  if (orderMatch && request.method === 'DELETE') {
    const order = await requireOrder(env.DB, orderMatch[1]);
    await env.DB.prepare(
      "UPDATE orders SET deleted_at = datetime('now'), deleted_by_user_id = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(user.id, orderMatch[1]).run();
    await logAudit(env.DB, user.id, 'delete', 'order', order.id, `Заказ #${order.id} перенесён в удалённые (${order.client_name})`, order);
    return json({ ok: true });
  }

  const restoreMatch = path.match(/^\/admin\/orders\/(\d+)\/restore$/);
  if (restoreMatch && request.method === 'POST') {
    const order = await getOrderById(env.DB, restoreMatch[1], true);
    if (!order) throw httpError(404, 'Order not found');
    await env.DB.prepare(
      "UPDATE orders SET deleted_at = NULL, deleted_by_user_id = NULL, updated_at = datetime('now') WHERE id = ?"
    ).bind(restoreMatch[1]).run();
    await logAudit(env.DB, user.id, 'restore', 'order', order.id, `Восстановлен заказ #${order.id} (${order.client_name})`, order);
    return json({ order: await requireOrder(env.DB, restoreMatch[1]) });
  }

  if (path === '/admin/drivers' && request.method === 'GET') {
    return json({ drivers: await listDrivers(env.DB, true) });
  }

  if (path === '/admin/drivers' && request.method === 'POST') {
    const payload = await request.json();
    const driver = await createDriver(env.DB, payload);
    await logAudit(env.DB, user.id, 'create', 'driver', driver.id, `Добавлен водитель ${driver.name}`, { name: driver.name });
    return json({ driver }, 201);
  }

  const driverMatch = path.match(/^\/admin\/drivers\/(\d+)$/);
  if (driverMatch && request.method === 'PUT') {
    const payload = await request.json();
    const before = await getDriverById(env.DB, driverMatch[1]);
    await updateDriver(env.DB, driverMatch[1], payload);
    const driver = await getDriverById(env.DB, driverMatch[1]);
    await logAudit(env.DB, user.id, 'update', 'driver', driver.id, `Изменён водитель ${driver.name}`, changedFields(before, driver));
    return json({ driver });
  }

  if (path === '/admin/cars' && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM cars ORDER BY is_active DESC, name').all();
    return json({ cars: results });
  }

  if (path === '/admin/cars' && request.method === 'POST') {
    const payload = await request.json();
    const result = await env.DB.prepare(
      'INSERT INTO cars (name, plate_number, model, seats, is_active) VALUES (?, ?, ?, ?, ?)'
    ).bind(text(payload.name), text(payload.plate_number), text(payload.model), number(payload.seats, 4), boolInt(payload.is_active, 1)).run();
    const car = await env.DB.prepare('SELECT * FROM cars WHERE id = ?').bind(result.meta.last_row_id).first();
    await logAudit(env.DB, user.id, 'create', 'car', car.id, `Добавлена машина ${car.name} ${car.plate_number}`, car);
    return json({ car }, 201);
  }

  const carMatch = path.match(/^\/admin\/cars\/(\d+)$/);
  if (carMatch && request.method === 'PUT') {
    const payload = await request.json();
    const before = await env.DB.prepare('SELECT * FROM cars WHERE id = ?').bind(carMatch[1]).first();
    await env.DB.prepare(
      "UPDATE cars SET name = ?, plate_number = ?, model = ?, seats = ?, is_active = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(text(payload.name), text(payload.plate_number), text(payload.model), number(payload.seats, 4), boolInt(payload.is_active, 1), carMatch[1]).run();
    const car = await env.DB.prepare('SELECT * FROM cars WHERE id = ?').bind(carMatch[1]).first();
    await logAudit(env.DB, user.id, 'update', 'car', car.id, `Изменена машина ${car.name} ${car.plate_number}`, changedFields(before, car));
    return json({ car });
  }

  if (path === '/admin/payments' && request.method === 'GET') {
    const totals = await paymentTotals(env.DB);
    const paidOrders = await listOrders(env.DB, { payment_status: 'paid', limit: 50 });
    return json({ totals, orders: paidOrders });
  }

  if (path === '/admin/reports' && request.method === 'GET') {
    const totals = await paymentTotals(env.DB);
    const history = await listOrders(env.DB, { status: 'completed', limit: 100 });
    return json({ totals, history });
  }

  return json({ error: 'Not found' }, 404);
}

async function driverRoutes(path, request, env, user) {
  const driver = await env.DB.prepare('SELECT * FROM drivers WHERE user_id = ? AND is_active = 1').bind(user.id).first();
  if (!driver) throw httpError(403, 'Driver is disabled');

  if (path === '/driver/dashboard' && request.method === 'GET') {
    const today = await listDriverOrders(env.DB, driver.id, 'today');
    const tomorrow = await listDriverOrders(env.DB, driver.id, 'tomorrow');
    const future = await listDriverOrders(env.DB, driver.id, 'future');
    return json({ driver, today, tomorrow, future });
  }

  if (path === '/driver/orders' && request.method === 'GET') {
    const url = new URL(request.url);
    const period = url.searchParams.get('period') || 'active';
    return json({ orders: await listDriverOrders(env.DB, driver.id, period) });
  }

  if (path === '/driver/history' && request.method === 'GET') {
    return json({ orders: await listDriverOrders(env.DB, driver.id, 'history') });
  }

  const orderMatch = path.match(/^\/driver\/orders\/(\d+)$/);
  if (orderMatch && request.method === 'GET') {
    const order = await getDriverOrder(env.DB, driver.id, orderMatch[1]);
    if (!order) throw httpError(404, 'Order not found');
    return json({ order });
  }

  if (orderMatch && request.method === 'PATCH') {
    const payload = await request.json();
    const status = text(payload.trip_status);
    if (!TRIP_STATUSES.includes(status)) throw httpError(400, 'Invalid trip status');
    const existing = await getDriverOrder(env.DB, driver.id, orderMatch[1]);
    if (!existing) throw httpError(404, 'Order not found');
    await env.DB.prepare(
      "UPDATE orders SET trip_status = ?, driver_comment = ?, updated_at = datetime('now') WHERE id = ? AND assigned_driver_id = ?"
    ).bind(status, text(payload.driver_comment), orderMatch[1], driver.id).run();
    await logAudit(
      env.DB,
      user.id,
      'status',
      'order',
      Number(orderMatch[1]),
      `Водитель ${user.name}: ${existing.trip_status} → ${status}`,
      { trip_status: { from: existing.trip_status, to: status }, driver_comment: text(payload.driver_comment) }
    );
    return json({ order: await getDriverOrder(env.DB, driver.id, orderMatch[1]) });
  }

  return json({ error: 'Not found' }, 404);
}

async function login(request, env, url) {
  const payload = await request.json();
  const attemptKey = await loginAttemptKey(request, payload.login);
  const attempt = await env.DB.prepare(
    `SELECT *,
       blocked_until > datetime('now') AS is_blocked,
       window_started_at > datetime('now', '-${LOGIN_WINDOW_MINUTES} minutes') AS in_window
     FROM login_attempts WHERE attempt_key = ?`
  ).bind(attemptKey).first();
  if (attempt?.is_blocked) {
    throw httpError(429, 'Слишком много попыток. Попробуйте снова через 15 минут.');
  }

  const user = await env.DB.prepare('SELECT * FROM users WHERE login = ? AND is_active = 1').bind(text(payload.login)).first();
  if (!user) {
    await registerLoginFailure(env.DB, attemptKey, attempt);
    throw httpError(401, 'Неверный логин или пароль');
  }

  const expected = await hash(`${payload.password || ''}:${user.password_salt}`);
  if (expected !== user.password_hash) {
    await registerLoginFailure(env.DB, attemptKey, attempt);
    throw httpError(401, 'Неверный логин или пароль');
  }

  const token = randomToken();
  const tokenHash = await hash(token);
  const expiresAt = sqliteDateTime(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(tokenHash, user.id, expiresAt).run();
  await env.DB.prepare('DELETE FROM login_attempts WHERE attempt_key = ?').bind(attemptKey).run();
  await logAudit(env.DB, user.id, 'login', 'session', null, `Вход в систему: ${user.name}`);

  return json(
    { user: publicUser(user) },
    200,
    { 'Set-Cookie': sessionCookie(token, url) }
  );
}

async function logout(request, env, url) {
  const token = getCookie(request.headers.get('Cookie'), 'crm_session');
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await hash(token)).run();
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookie(url) });
}

async function me(request, env) {
  const session = await requireUser(request, env);
  return json({ user: publicUser(session.user) });
}

async function changePassword(request, env, user, url) {
  const payload = await request.json();
  const currentHash = await hash(`${payload.current_password || ''}:${user.password_salt}`);
  if (currentHash !== user.password_hash) throw httpError(400, 'Текущий пароль указан неверно');
  validatePassword(payload.new_password);
  if (payload.new_password !== payload.confirm_password) throw httpError(400, 'Новые пароли не совпадают');

  const salt = randomToken(12);
  await env.DB.prepare(
    "UPDATE users SET password_salt = ?, password_hash = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(salt, await hash(`${payload.new_password}:${salt}`), user.id).run();
  await logAudit(env.DB, user.id, 'password', 'user', user.id, `Изменён пароль: ${user.name}`);
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id).run();
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookie(url) });
}

async function logoutAll(env, user, url) {
  await logAudit(env.DB, user.id, 'logout_all', 'session', null, `Завершены все сеансы: ${user.name}`);
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id).run();
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookie(url) });
}

async function requireUser(request, env) {
  const token = getCookie(request.headers.get('Cookie'), 'crm_session');
  if (!token) throw httpError(401, 'Unauthorized');

  const row = await env.DB.prepare(
    `SELECT users.*
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ? AND sessions.expires_at > datetime('now') AND users.is_active = 1`
  ).bind(await hash(token)).first();

  if (!row) throw httpError(401, 'Unauthorized');
  return { user: row };
}

async function cleanupSessions(db) {
  await db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
  await db.prepare("DELETE FROM login_attempts WHERE updated_at < datetime('now', '-1 day')").run();
}

function requireRole(user, role) {
  if (user.role !== role) throw httpError(403, 'Forbidden');
}

async function listOrders(db, filters = {}) {
  const where = [];
  const values = [];
  const limit = Math.min(number(filters.limit, 200), 500);

  if (filters.deletedOnly) {
    where.push('orders.deleted_at IS NOT NULL');
  } else if (!filters.includeDeleted) {
    where.push('orders.deleted_at IS NULL');
  }

  if (filters.q) {
    where.push('(orders.client_name LIKE ? OR orders.client_phone LIKE ? OR orders.flight_number LIKE ? OR orders.destination_address LIKE ?)');
    const q = `%${filters.q}%`;
    values.push(q, q, q, q);
  }
  if (filters.date) {
    where.push('orders.arrival_date = ?');
    values.push(filters.date);
  }
  if (filters.dateFrom) {
    where.push('orders.arrival_date >= ?');
    values.push(filters.dateFrom);
  }
  if (filters.airport) {
    where.push('orders.airport = ?');
    values.push(filters.airport);
  }
  if (filters.driver_id) {
    where.push('orders.assigned_driver_id = ?');
    values.push(filters.driver_id);
  }
  if (filters.status) {
    where.push('orders.trip_status = ?');
    values.push(filters.status);
  }
  if (filters.payment_status) {
    where.push('orders.payment_status = ?');
    values.push(filters.payment_status);
  }

  const sql = `
    SELECT orders.*, users.name AS driver_name, cars.name AS car_name, cars.plate_number
    FROM orders
    LEFT JOIN drivers ON drivers.id = orders.assigned_driver_id
    LEFT JOIN users ON users.id = drivers.user_id
    LEFT JOIN cars ON cars.id = orders.car_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY orders.arrival_date DESC, orders.arrival_time DESC
    LIMIT ${limit}
  `;
  const { results } = await db.prepare(sql).bind(...values).all();
  return results;
}

async function createOrder(db, payload) {
  await assertResourcesAvailable(db, payload);
  const paymentRest = number(payload.payment_rest, Math.max(0, number(payload.price) - number(payload.deposit)));
  const tripStatus = validValue(payload.trip_status || (payload.assigned_driver_id ? 'assigned' : 'new'), TRIP_STATUSES, 'new');
  const paymentStatus = validValue(payload.payment_status, PAYMENT_STATUSES, 'unpaid');
  const result = await db.prepare(
    `INSERT INTO orders (
      client_name, client_phone, client_messenger, airport, terminal, flight_number, arrival_date, arrival_time,
      passengers_count, luggage_count, destination_address, client_comment, admin_comment, assigned_driver_id,
      car_id, price, deposit, payment_rest, payment_method, payment_status, trip_status, estimated_duration_minutes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    text(payload.client_name), text(payload.client_phone), text(payload.client_messenger), text(payload.airport),
    text(payload.terminal), text(payload.flight_number), text(payload.arrival_date), text(payload.arrival_time),
    number(payload.passengers_count, 1), number(payload.luggage_count, 0), text(payload.destination_address),
    text(payload.client_comment), text(payload.admin_comment), nullableId(payload.assigned_driver_id),
    nullableId(payload.car_id), number(payload.price), number(payload.deposit), paymentRest,
    text(payload.payment_method || 'cash'), paymentStatus, tripStatus, tripDuration(payload.estimated_duration_minutes)
  ).run();
  return result.meta.last_row_id;
}

async function updateOrder(db, id, payload) {
  await assertResourcesAvailable(db, payload, id);
  const paymentRest = number(payload.payment_rest, Math.max(0, number(payload.price) - number(payload.deposit)));
  const tripStatus = validValue(payload.trip_status || (payload.assigned_driver_id ? 'assigned' : 'new'), TRIP_STATUSES, 'new');
  const paymentStatus = validValue(payload.payment_status, PAYMENT_STATUSES, 'unpaid');
  await db.prepare(
    `UPDATE orders SET
      client_name = ?, client_phone = ?, client_messenger = ?, airport = ?, terminal = ?, flight_number = ?,
      arrival_date = ?, arrival_time = ?, passengers_count = ?, luggage_count = ?, destination_address = ?,
      client_comment = ?, admin_comment = ?, assigned_driver_id = ?, car_id = ?, price = ?, deposit = ?,
      payment_rest = ?, payment_method = ?, payment_status = ?, trip_status = ?, estimated_duration_minutes = ?,
      updated_at = datetime('now')
    WHERE id = ?`
  ).bind(
    text(payload.client_name), text(payload.client_phone), text(payload.client_messenger), text(payload.airport),
    text(payload.terminal), text(payload.flight_number), text(payload.arrival_date), text(payload.arrival_time),
    number(payload.passengers_count, 1), number(payload.luggage_count, 0), text(payload.destination_address),
    text(payload.client_comment), text(payload.admin_comment), nullableId(payload.assigned_driver_id),
    nullableId(payload.car_id), number(payload.price), number(payload.deposit), paymentRest,
    text(payload.payment_method || 'cash'), paymentStatus, tripStatus,
    tripDuration(payload.estimated_duration_minutes), id
  ).run();
}

async function assertResourcesAvailable(db, payload, excludeOrderId = null) {
  if (!payload.arrival_date || !payload.arrival_time) return;
  if (['completed', 'cancelled'].includes(payload.trip_status)) return;
  const driverId = nullableId(payload.assigned_driver_id);
  const carId = nullableId(payload.car_id);
  if (!driverId && !carId) return;

  const conflicts = await findTimeConflicts(db, payload, excludeOrderId);
  const messages = [];
  const driverConflict = driverId && conflicts.find((item) => Number(item.assigned_driver_id) === driverId);
  const carConflict = carId && conflicts.find((item) => Number(item.car_id) === carId);
  if (driverConflict) messages.push(`Водитель занят заказом #${driverConflict.id}`);
  if (carConflict) messages.push(`Машина занята заказом #${carConflict.id}`);
  if (messages.length) throw httpError(409, messages.join('. '), { conflicts });
}

async function findTimeConflicts(db, payload, excludeOrderId = null) {
  const arrivalDate = text(payload.arrival_date);
  const arrivalTime = text(payload.arrival_time);
  if (!arrivalDate || !arrivalTime) return [];
  const start = `${arrivalDate} ${arrivalTime}`;
  const duration = tripDuration(payload.estimated_duration_minutes);
  const excluded = nullableId(excludeOrderId);
  const { results } = await db.prepare(
    `SELECT orders.id, orders.client_name, orders.arrival_date, orders.arrival_time,
            orders.estimated_duration_minutes, orders.assigned_driver_id, orders.car_id,
            users.name AS driver_name, cars.name AS car_name, cars.plate_number
     FROM orders
     LEFT JOIN drivers ON drivers.id = orders.assigned_driver_id
     LEFT JOIN users ON users.id = drivers.user_id
     LEFT JOIN cars ON cars.id = orders.car_id
     WHERE orders.trip_status NOT IN ('completed', 'cancelled')
       AND orders.deleted_at IS NULL
       AND (orders.assigned_driver_id IS NOT NULL OR orders.car_id IS NOT NULL)
       AND (? IS NULL OR orders.id != ?)
       AND datetime(orders.arrival_date || ' ' || orders.arrival_time) < datetime(?, '+' || ? || ' minutes')
       AND datetime(
         orders.arrival_date || ' ' || orders.arrival_time,
         '+' || orders.estimated_duration_minutes || ' minutes'
       ) > datetime(?)
     ORDER BY orders.arrival_date, orders.arrival_time`
  ).bind(excluded, excluded, start, duration, start).all();
  return results;
}

async function requireOrder(db, id) {
  const order = await getOrderById(db, id);
  if (!order) throw httpError(404, 'Order not found');
  return order;
}

async function getOrderById(db, id, includeDeleted = false) {
  return db.prepare(
    `SELECT orders.*, users.name AS driver_name, cars.name AS car_name, cars.plate_number
     FROM orders
     LEFT JOIN drivers ON drivers.id = orders.assigned_driver_id
     LEFT JOIN users ON users.id = drivers.user_id
     LEFT JOIN cars ON cars.id = orders.car_id
     WHERE orders.id = ? ${includeDeleted ? '' : 'AND orders.deleted_at IS NULL'}`
  ).bind(id).first();
}

async function listDrivers(db, includeInactive = false) {
  const sql = `
    SELECT drivers.*, users.name, users.login, users.is_active AS user_active
    FROM drivers
    JOIN users ON users.id = drivers.user_id
    ${includeInactive ? '' : 'WHERE drivers.is_active = 1 AND users.is_active = 1'}
    ORDER BY drivers.is_active DESC, users.name
  `;
  const { results } = await db.prepare(sql).all();
  return results;
}

async function getDriverById(db, id) {
  return db.prepare(
    `SELECT drivers.*, users.name, users.login, users.is_active AS user_active
     FROM drivers JOIN users ON users.id = drivers.user_id WHERE drivers.id = ?`
  ).bind(id).first();
}

async function createDriver(db, payload) {
  const salt = randomToken(12);
  const password = payload.password || 'driver123';
  validatePassword(password);
  const result = await db.prepare(
    'INSERT INTO users (role, name, login, password_salt, password_hash, is_active) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind('driver', text(payload.name), text(payload.login), salt, await hash(`${password}:${salt}`), boolInt(payload.is_active, 1)).run();

  const userId = result.meta.last_row_id;
  const driverResult = await db.prepare(
    'INSERT INTO drivers (user_id, phone, notes, is_active) VALUES (?, ?, ?, ?)'
  ).bind(userId, text(payload.phone), text(payload.notes), boolInt(payload.is_active, 1)).run();

  return getDriverById(db, driverResult.meta.last_row_id);
}

async function updateDriver(db, id, payload) {
  const driver = await getDriverById(db, id);
  if (!driver) throw httpError(404, 'Driver not found');
  const active = boolInt(payload.is_active, 1);
  await db.prepare("UPDATE users SET name = ?, login = ?, is_active = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(text(payload.name), text(payload.login), active, driver.user_id).run();
  await db.prepare("UPDATE drivers SET phone = ?, notes = ?, is_active = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(text(payload.phone), text(payload.notes), active, id).run();
  if (payload.password) {
    validatePassword(payload.password);
    const salt = randomToken(12);
    await db.prepare("UPDATE users SET password_salt = ?, password_hash = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(salt, await hash(`${payload.password}:${salt}`), driver.user_id).run();
  }
}

async function paymentTotals(db) {
  const todayKey = businessDate();
  const weekStart = businessDate(-6);
  const monthKey = todayKey.slice(0, 7);
  const [day, week, month] = await Promise.all([
    db.prepare("SELECT COALESCE(SUM(price), 0) AS total FROM orders WHERE deleted_at IS NULL AND payment_status = 'paid' AND arrival_date = ?")
      .bind(todayKey).first(),
    db.prepare("SELECT COALESCE(SUM(price), 0) AS total FROM orders WHERE deleted_at IS NULL AND payment_status = 'paid' AND arrival_date >= ? AND arrival_date <= ?")
      .bind(weekStart, todayKey).first(),
    db.prepare("SELECT COALESCE(SUM(price), 0) AS total FROM orders WHERE deleted_at IS NULL AND payment_status = 'paid' AND substr(arrival_date, 1, 7) = ?")
      .bind(monthKey).first(),
  ]);
  return { day: day.total, week: week.total, month: month.total };
}

async function listDriverOrders(db, driverId, period) {
  let where = 'orders.deleted_at IS NULL AND orders.assigned_driver_id = ?';
  const values = [driverId];
  if (period === 'today') {
    where += ' AND orders.arrival_date = ?';
    values.push(businessDate());
  } else if (period === 'tomorrow') {
    where += ' AND orders.arrival_date = ?';
    values.push(businessDate(1));
  } else if (period === 'future') {
    where += ' AND orders.arrival_date > ?';
    values.push(businessDate(1));
  }
  else if (period === 'history') where += " AND orders.trip_status IN ('completed', 'cancelled')";
  else where += " AND orders.trip_status NOT IN ('completed', 'cancelled')";

  const { results } = await db.prepare(
    `SELECT orders.*, cars.name AS car_name, cars.plate_number
     FROM orders
     LEFT JOIN cars ON cars.id = orders.car_id
     WHERE ${where}
     ORDER BY orders.arrival_date ASC, orders.arrival_time ASC`
  ).bind(...values).all();
  return results;
}

async function getDriverOrder(db, driverId, orderId) {
  return db.prepare(
    `SELECT orders.*, cars.name AS car_name, cars.plate_number
     FROM orders LEFT JOIN cars ON cars.id = orders.car_id
     WHERE orders.deleted_at IS NULL AND orders.id = ? AND orders.assigned_driver_id = ?`
  ).bind(orderId, driverId).first();
}

async function exportOrdersCsv(db) {
  const { results } = await db.prepare(
    `SELECT orders.*, users.name AS driver_name, cars.name AS car_name, cars.plate_number,
            deleted_by.name AS deleted_by_name
     FROM orders
     LEFT JOIN drivers ON drivers.id = orders.assigned_driver_id
     LEFT JOIN users ON users.id = drivers.user_id
     LEFT JOIN cars ON cars.id = orders.car_id
     LEFT JOIN users AS deleted_by ON deleted_by.id = orders.deleted_by_user_id
     ORDER BY orders.id DESC`
  ).all();
  return toCsv(results);
}

async function exportDriversCsv(db) {
  const { results } = await db.prepare(
    `SELECT drivers.id, users.name, users.login, drivers.phone, drivers.notes,
            drivers.is_active, users.is_active AS user_active, drivers.created_at, drivers.updated_at
     FROM drivers
     JOIN users ON users.id = drivers.user_id
     ORDER BY drivers.id DESC`
  ).all();
  return toCsv(results);
}

async function exportTableCsv(db, tableName) {
  const allowed = new Set(['cars']);
  if (!allowed.has(tableName)) throw httpError(400, 'Export is not allowed');
  const { results } = await db.prepare(`SELECT * FROM ${tableName} ORDER BY id DESC`).all();
  return toCsv(results);
}

async function exportAuditCsv(db) {
  const { results } = await db.prepare(
    `SELECT audit_logs.*, users.name AS user_name
     FROM audit_logs
     LEFT JOIN users ON users.id = audit_logs.user_id
     ORDER BY audit_logs.id DESC`
  ).all();
  return toCsv(results);
}

function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  return [
    headers.map(csvCell).join(','),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(',')),
  ].join('\n');
}

function csvCell(value) {
  const textValue = String(value ?? '');
  return `"${textValue.replace(/"/g, '""')}"`;
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  });
}

function csvResponse(filename, content) {
  return new Response(`\ufeff${content}`, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function httpError(status, message, details) {
  const error = new Error(message);
  error.status = status;
  error.details = details;
  return error;
}

function text(value) {
  return value == null ? '' : String(value).trim();
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableId(value) {
  if (value === '' || value == null || value === 'null') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function boolInt(value, fallback = 1) {
  if (value === undefined || value === null || value === '') return fallback;
  return value === true || value === '1' || value === 1 ? 1 : 0;
}

function validValue(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function tripDuration(value) {
  return Math.min(Math.max(Math.round(number(value, DEFAULT_TRIP_DURATION)), 30), 1440);
}

function businessDate(offsetDays = 0) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  const anchor = new Date(Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day) + offsetDays,
    12
  ));
  return anchor.toISOString().slice(0, 10);
}

function publicUser(user) {
  return { id: user.id, role: user.role, name: user.name, login: user.login };
}

function sqliteDateTime(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 19).replace('T', ' ');
}

function getCookie(header, name) {
  if (!header) return null;
  const cookies = header.split(';').map((part) => part.trim());
  const target = cookies.find((part) => part.startsWith(`${name}=`));
  return target ? decodeURIComponent(target.slice(name.length + 1)) : null;
}

function sessionCookie(token, url) {
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return `crm_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure}`;
}

function clearCookie(url) {
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return `crm_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function verifyOrigin(request, url) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) throw httpError(403, 'Недопустимый источник запроса');
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw httpError(400, 'Пароль должен содержать минимум 8 символов');
  }
}

async function loginAttemptKey(request, login) {
  const ip = request.headers.get('CF-Connecting-IP')
    || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    || 'local';
  return hash(`${ip}:${text(login).toLowerCase()}`);
}

async function registerLoginFailure(db, attemptKey, existing) {
  const attempts = existing?.in_window ? Number(existing.attempts) + 1 : 1;
  const shouldBlock = attempts >= LOGIN_MAX_ATTEMPTS;
  await db.prepare(
    `INSERT INTO login_attempts (
       attempt_key, attempts, window_started_at, blocked_until, updated_at
     ) VALUES (?, ?, datetime('now'), CASE WHEN ? THEN datetime('now', '+${LOGIN_WINDOW_MINUTES} minutes') END, datetime('now'))
     ON CONFLICT(attempt_key) DO UPDATE SET
       attempts = excluded.attempts,
       window_started_at = CASE WHEN ? THEN login_attempts.window_started_at ELSE datetime('now') END,
       blocked_until = excluded.blocked_until,
       updated_at = datetime('now')`
  ).bind(attemptKey, attempts, shouldBlock ? 1 : 0, existing?.in_window ? 1 : 0).run();
}

async function logAudit(db, userId, action, entityType, entityId, summary, details = null) {
  await db.prepare(
    'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, summary, details_json) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(userId || null, action, entityType, entityId || null, summary, details ? JSON.stringify(details) : null).run();
}

function changedFields(before, after) {
  const ignored = new Set(['created_at', 'updated_at']);
  const changes = {};
  for (const [key, value] of Object.entries(after || {})) {
    if (ignored.has(key) || !(key in (before || {}))) continue;
    if (String(before[key] ?? '') !== String(value ?? '')) {
      changes[key] = { from: before[key], to: value };
    }
  }
  return changes;
}

function randomToken(size = 32) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hash(value) {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
