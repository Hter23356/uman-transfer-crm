const app = document.querySelector('#app');

const state = {
  user: null,
  drivers: [],
  cars: [],
  notice: '',
};

const tripLabels = {
  new: 'Новый',
  assigned: 'Назначен',
  accepted: 'Принят',
  on_the_way: 'Выехал',
  arrived_airport: 'В аэропорту',
  client_in_car: 'Клиент в машине',
  arrived_uman: 'В Умани',
  completed: 'Завершён',
  cancelled: 'Отмена',
};

const paymentLabels = {
  unpaid: 'Не оплачено',
  deposit_paid: 'Предоплата',
  paid: 'Оплачено',
  refunded: 'Возврат',
};

const tripOptions = Object.keys(tripLabels);
const paymentOptions = Object.keys(paymentLabels);

window.addEventListener('popstate', boot);
document.addEventListener('click', routeClicks);
document.addEventListener('submit', submitForms);
document.addEventListener('change', handleChanges);

boot();

async function boot() {
  try {
    const data = await api('/auth/me');
    state.user = data.user;
    if (location.pathname === '/' || location.pathname === '/login') {
      go(state.user.role === 'admin' ? '/admin/dashboard' : '/driver/dashboard', true);
      return;
    }
  } catch {
    state.user = null;
    if (location.pathname !== '/login') {
      go('/login', true);
      return;
    }
  }
  render();
}

async function render() {
  const path = location.pathname;
  if (path === '/login') return renderLogin();
  if (!state.user) return renderLogin();
  if (state.user.role === 'admin') return renderAdmin(path);
  return renderDriver(path);
}

function renderLogin(error = '') {
  app.innerHTML = `
    <main class="login-shell">
      <form class="login-box" data-form="login">
        <h1>Uman Transfer CRM</h1>
        <div class="grid">
          <label>Логин <input name="login" autocomplete="username" required></label>
          <label>Пароль <input name="password" type="password" autocomplete="current-password" required></label>
          <button type="submit">Войти</button>
          ${state.notice ? `<div class="success">${escapeHtml(state.notice)}</div>` : ''}
          ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
        </div>
      </form>
    </main>
  `;
}

async function renderAdmin(path) {
  await loadDictionaries();
  if (path === '/admin/dashboard') return page('Панель', await adminDashboard());
  if (path === '/admin/orders') return page('Заказы', await adminOrders());
  if (path === '/admin/orders/new') return page('Новый заказ', adminOrderForm());
  if (/^\/admin\/orders\/\d+$/.test(path)) return page('Заказ', await adminOrderDetail(path.split('/').pop()));
  if (path === '/admin/drivers') return page('Водители', adminDrivers());
  if (path === '/admin/cars') return page('Машины', adminCars());
  if (path === '/admin/payments') return page('Оплаты', await adminPayments());
  if (path === '/admin/reports') return page('Отчёты', await adminReports());
  if (path === '/admin/audit') return page('Журнал действий', await adminAudit());
  if (path === '/admin/safety') return page('Защита данных', await adminSafety());
  if (path === '/admin/security') return page('Безопасность', securityPage());
  go('/admin/dashboard', true);
}

async function renderDriver(path) {
  if (path === '/driver/dashboard') return page('Кабинет водителя', await driverDashboard());
  if (path === '/driver/orders') return page('Мои заказы', await driverOrders());
  if (/^\/driver\/orders\/\d+$/.test(path)) return page('Заказ', await driverOrderDetail(path.split('/').pop()));
  if (path === '/driver/history') return page('История', await driverHistory());
  if (path === '/driver/security') return page('Безопасность', securityPage());
  go('/driver/dashboard', true);
}

function page(title, content) {
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">Uman CRM</div>
        <div class="user-chip">${escapeHtml(state.user.name)}<br><span>${state.user.role}</span></div>
        <nav class="nav">${navLinks()}<button data-action="logout">Выйти</button></nav>
      </aside>
      <main class="main">
        <div class="topbar"><h1>${title}</h1>${topAction()}</div>
        ${content}
      </main>
    </div>
  `;
  if (document.querySelector('[data-form="order"]')) refreshAvailability();
}

function navLinks() {
  const admin = [
    ['/admin/dashboard', 'Панель'],
    ['/admin/orders', 'Заказы'],
    ['/admin/orders/new', 'Новый заказ'],
    ['/admin/drivers', 'Водители'],
    ['/admin/cars', 'Машины'],
    ['/admin/payments', 'Оплаты'],
    ['/admin/reports', 'Отчёты'],
    ['/admin/audit', 'Журнал действий'],
    ['/admin/safety', 'Защита данных'],
    ['/admin/security', 'Безопасность'],
  ];
  const driver = [
    ['/driver/dashboard', 'Панель'],
    ['/driver/orders', 'Заказы'],
    ['/driver/history', 'История'],
    ['/driver/security', 'Безопасность'],
  ];
  return (state.user.role === 'admin' ? admin : driver)
    .map(([href, label]) => `<a href="${href}" class="${location.pathname === href ? 'active' : ''}">${label}</a>`)
    .join('');
}

function topAction() {
  if (state.user.role === 'admin' && location.pathname === '/admin/orders') {
    return '<a class="button" href="/admin/orders/new">Новый заказ</a>';
  }
  return '';
}

async function adminDashboard() {
  const data = await api('/admin/dashboard');
  return `
    <section class="grid metrics">
      ${metric('Сегодня', data.today.count)}
      ${metric('Активные заказы', data.activeOrders.count)}
      ${metric('Водители', data.activeDrivers.count)}
      ${metric('Доход за месяц', money(data.monthIncome.total))}
    </section>
    <section class="panel" style="margin-top:16px">
      <h2>Ближайшие заказы</h2>
      ${cards(data.upcoming)}
    </section>
  `;
}

async function adminOrders() {
  const params = new URLSearchParams(location.search);
  const data = await api(`/admin/orders?${params.toString()}`);
  return `
    <form class="toolbar" data-form="filters">
      <input name="q" placeholder="Поиск" value="${escapeAttr(params.get('q') || '')}">
      <input name="date" type="date" value="${escapeAttr(params.get('date') || '')}">
      <select name="airport">${selectOptions(['', 'Борисполь', 'Кишинёв', 'Яссы'], params.get('airport') || '', 'Аэропорт')}</select>
      <select name="driver_id">${driverOptions(params.get('driver_id') || '', 'Водитель')}</select>
      <select name="status">${statusOptions(tripLabels, params.get('status') || '', 'Статус')}</select>
      <button type="submit">Фильтр</button>
    </form>
    ${cards(data.orders)}
  `;
}

async function adminOrderDetail(id) {
  const data = await api(`/admin/orders/${id}`);
  return `${contactPanel(data.order)}${adminOrderForm(data.order)}`;
}

function adminOrderForm(order = {}) {
  const isEdit = Boolean(order.id);
  return `
    <form class="panel" data-form="order" data-id="${order.id || ''}">
      <div class="form-grid">
        ${input('client_name', 'Имя клиента', order.client_name, true)}
        ${input('client_phone', 'Телефон', order.client_phone, true)}
        ${input('client_messenger', 'WhatsApp', whatsappValue(order.client_messenger))}
        ${select('airport', 'Аэропорт', ['Борисполь', 'Кишинёв', 'Яссы'], order.airport, true)}
        ${input('terminal', 'Терминал', order.terminal)}
        ${input('flight_number', 'Номер рейса', order.flight_number)}
        ${input('arrival_date', 'Дата прилёта', order.arrival_date, true, 'date')}
        ${input('arrival_time', 'Время прилёта', order.arrival_time, true, 'time')}
        ${input('estimated_duration_minutes', 'Длительность поездки, минут', order.estimated_duration_minutes || 300, true, 'number')}
        ${input('passengers_count', 'Пассажиры', order.passengers_count || 1, true, 'number')}
        ${input('luggage_count', 'Багаж', order.luggage_count || 0, true, 'number')}
        ${select('assigned_driver_id', 'Водитель', state.drivers.map((d) => [d.id, d.name]), order.assigned_driver_id)}
        ${select('car_id', 'Машина', state.cars.map((c) => [c.id, `${c.name} ${c.plate_number}`]), order.car_id)}
        ${input('price', 'Цена', order.price || 0, true, 'number')}
        ${input('deposit', 'Предоплата', order.deposit || 0, false, 'number')}
        ${input('payment_rest', 'Остаток', order.payment_rest || 0, false, 'number')}
        ${select('payment_method', 'Способ оплаты', ['cash', 'card', 'bank_transfer'], order.payment_method || 'cash')}
        ${select('payment_status', 'Статус оплаты', Object.entries(paymentLabels), order.payment_status || 'unpaid')}
        ${select('trip_status', 'Статус поездки', Object.entries(tripLabels), order.trip_status || 'new')}
        ${textarea('destination_address', 'Адрес в Умани', order.destination_address, true)}
        ${textarea('client_comment', 'Комментарий клиента', order.client_comment)}
        ${textarea('admin_comment', 'Комментарий админа', order.admin_comment)}
      </div>
      <div id="availability-status" class="availability neutral">Укажите дату и время, чтобы проверить занятость.</div>
      <div class="actions" style="margin-top:14px">
        <button type="submit">${isEdit ? 'Сохранить' : 'Создать'}</button>
        <a class="button secondary" href="/admin/orders">Назад</a>
        ${isEdit ? '<button class="danger" type="button" data-action="delete-order">Удалить</button>' : ''}
      </div>
    </form>
  `;
}

function adminDrivers() {
  return `
    <section class="panel">
      <h2>Водитель</h2>
      <form class="form-grid" data-form="driver">
        <input type="hidden" name="id">
        ${input('name', 'Имя', '', true)}
        ${input('login', 'Логин', '', true)}
        ${input('password', 'Пароль')}
        ${input('phone', 'Телефон', '', true)}
        ${select('is_active', 'Статус', [[1, 'Активен'], [0, 'Отключён']], 1)}
        ${textarea('notes', 'Заметки')}
        <div class="actions full"><button type="submit">Сохранить</button><button class="secondary" type="reset">Очистить</button></div>
      </form>
    </section>
    <section class="panel" style="margin-top:16px">
      <h2>Список водителей</h2>
      <div class="table-list">${state.drivers.map(driverRow).join('')}</div>
    </section>
  `;
}

function adminCars() {
  return `
    <section class="panel">
      <h2>Машина</h2>
      <form class="form-grid" data-form="car">
        <input type="hidden" name="id">
        ${input('name', 'Название', '', true)}
        ${input('plate_number', 'Номер', '', true)}
        ${input('model', 'Модель')}
        ${input('seats', 'Мест', 4, true, 'number')}
        ${select('is_active', 'Статус', [[1, 'Активна'], [0, 'Отключена']], 1)}
        <div class="actions full"><button type="submit">Сохранить</button><button class="secondary" type="reset">Очистить</button></div>
      </form>
    </section>
    <section class="panel" style="margin-top:16px">
      <h2>Список машин</h2>
      <div class="table-list">${state.cars.map(carRow).join('')}</div>
    </section>
  `;
}

async function adminPayments() {
  const data = await api('/admin/payments');
  return totalsAndOrders(data.totals, data.orders);
}

async function adminReports() {
  const data = await api('/admin/reports');
  return totalsAndOrders(data.totals, data.history);
}

async function adminAudit() {
  const data = await api('/admin/audit');
  if (!data.logs.length) return '<div class="empty">Журнал пока пуст</div>';
  return `<section class="panel audit-list">${data.logs.map(auditRow).join('')}</section>`;
}

async function adminSafety() {
  const data = await api('/admin/safety');
  return `
    <section class="grid safety-grid">
      <div class="panel">
        <h2>Экспорт данных</h2>
        <p class="subtle">Скачайте копии таблиц перед важными изменениями или раз в неделю для своего спокойствия.</p>
        <div class="export-list">
          ${data.exports.map((item) => (
            `<a class="button secondary" data-native-link="true" href="${escapeAttr(item.href)}" download>${escapeHtml(item.label)}</a>`
          )).join('')}
        </div>
      </div>
      <div class="panel">
        <h2>Cloudflare D1</h2>
        <p class="subtle">Рабочая база должна быть в Cloudflare D1. Перезапуск сайта или выключенный компьютер не удаляют данные.</p>
        <div class="backup-command">npx wrangler d1 export uman-transfer-crm --remote --output=./backups/backup.sql</div>
      </div>
    </section>
    <section class="panel" style="margin-top:16px">
      <h2>Удалённые заказы</h2>
      ${data.deletedOrders.length ? `<div class="table-list deleted-list">${data.deletedOrders.map(deletedOrderRow).join('')}</div>` : '<div class="empty">Удалённых заказов нет</div>'}
    </section>
  `;
}

function securityPage() {
  return `
    <section class="panel security-panel">
      <h2>Изменить пароль</h2>
      <form class="grid" data-form="password">
        ${input('current_password', 'Текущий пароль', '', true, 'password')}
        ${input('new_password', 'Новый пароль', '', true, 'password')}
        ${input('confirm_password', 'Повторите новый пароль', '', true, 'password')}
        <div class="actions"><button type="submit">Изменить пароль</button></div>
      </form>
    </section>
    <section class="panel security-panel">
      <h2>Активные входы</h2>
      <p class="subtle">Завершить все сеансы на телефонах и компьютерах, включая текущий.</p>
      <button class="danger" data-action="logout-all">Завершить все сеансы</button>
    </section>
  `;
}

async function driverDashboard() {
  const data = await api('/driver/dashboard');
  return `
    <section class="panel"><h2>Сегодня</h2>${cards(data.today, true)}</section>
    <section class="panel" style="margin-top:16px"><h2>Завтра</h2>${cards(data.tomorrow, true)}</section>
    <section class="panel" style="margin-top:16px"><h2>Будущие даты</h2>${cards(data.future, true)}</section>
  `;
}

async function driverOrders() {
  const period = new URLSearchParams(location.search).get('period') || 'active';
  const data = await api(`/driver/orders?period=${period}`);
  return `
    <div class="tabs">
      ${tab('active', 'Активные', period)}
      ${tab('today', 'Сегодня', period)}
      ${tab('tomorrow', 'Завтра', period)}
      ${tab('future', 'Будущие', period)}
    </div>
    ${cards(data.orders, true)}
  `;
}

async function driverHistory() {
  const data = await api('/driver/history');
  return cards(data.orders, true);
}

async function driverOrderDetail(id) {
  const { order } = await api(`/driver/orders/${id}`);
  return `
    <section class="panel">
      ${orderFull(order)}
      <form class="grid" data-form="driver-status" data-id="${order.id}" style="margin-top:16px">
        ${select('trip_status', 'Статус поездки', Object.entries(tripLabels), order.trip_status)}
        ${textarea('driver_comment', 'Комментарий админу', order.driver_comment)}
        <div class="actions"><button type="submit">Сохранить</button><a class="button secondary" href="/driver/orders">Назад</a></div>
      </form>
    </section>
  `;
}

function cards(orders, driverMode = false) {
  if (!orders || !orders.length) return '<div class="empty">Нет заказов</div>';
  return `<div class="cards">${orders.map((order) => orderCard(order, driverMode)).join('')}</div>`;
}

function orderCard(order, driverMode) {
  const base = driverMode ? '/driver/orders' : '/admin/orders';
  return `
    <article class="order-card">
      <div class="order-head">
        <div><h3>#${order.id} ${escapeHtml(order.client_name)}</h3><div class="subtle">${escapeHtml(order.client_phone)}</div></div>
        <span class="pill status-${order.trip_status}">${tripLabels[order.trip_status]}</span>
      </div>
      <div class="meta">
        <span>${escapeHtml(order.arrival_date)} ${escapeHtml(order.arrival_time)}</span>
        <span>${escapeHtml(order.airport)} ${escapeHtml(order.terminal || '')}</span>
        <span>${escapeHtml(order.flight_number || '')}</span>
      </div>
      <div>${escapeHtml(order.destination_address)}</div>
      <div class="meta">
        <span>${order.passengers_count} пасс.</span>
        <span>${order.luggage_count} багаж</span>
        ${order.driver_name ? `<span>${escapeHtml(order.driver_name)}</span>` : ''}
        ${order.car_name ? `<span>${escapeHtml(order.car_name)}</span>` : ''}
      </div>
      <div class="quick-actions">${contactActions(order)}${routeAction(order)}</div>
      <div class="actions">
        <span class="pill pay-${order.payment_status}">${paymentLabels[order.payment_status]}</span>
        <strong>${money(order.price)}</strong>
        <a class="button secondary" href="${base}/${order.id}">Открыть</a>
      </div>
    </article>
  `;
}

function orderFull(order) {
  return `
    <div class="order-head">
      <div><h2>#${order.id} ${escapeHtml(order.client_name)}</h2><div class="subtle">${escapeHtml(order.client_phone)}${whatsappValue(order.client_messenger) ? ` · ${escapeHtml(whatsappValue(order.client_messenger))}` : ''}</div></div>
      <span class="pill status-${order.trip_status}">${tripLabels[order.trip_status]}</span>
    </div>
    <div class="grid row" style="margin-top:12px">
      <div><strong>Прилёт</strong><br>${escapeHtml(order.arrival_date)} ${escapeHtml(order.arrival_time)}, ${escapeHtml(order.airport)} ${escapeHtml(order.terminal || '')}</div>
      <div><strong>Рейс</strong><br>${escapeHtml(order.flight_number || '')}</div>
      <div><strong>Пассажиры и багаж</strong><br>${order.passengers_count} / ${order.luggage_count}</div>
      <div><strong>Адрес</strong><br>${escapeHtml(order.destination_address)}</div>
      <div><strong>Машина</strong><br>${escapeHtml(order.car_name || '')} ${escapeHtml(order.plate_number || '')}</div>
      <div><strong>Оплата</strong><br>${money(order.price)} · ${paymentLabels[order.payment_status]}</div>
      <div><strong>Комментарий клиента</strong><br>${escapeHtml(order.client_comment || '')}</div>
      <div><strong>Комментарий админа</strong><br>${escapeHtml(order.admin_comment || '')}</div>
    </div>
    <div class="quick-actions detail-actions">${contactActions(order)}${routeAction(order)}</div>
  `;
}

function contactPanel(order) {
  return `
    <section class="panel contact-panel">
      <div>
        <strong>${escapeHtml(order.client_name)}</strong>
        <div class="subtle">${escapeHtml(order.client_phone)}${whatsappValue(order.client_messenger) ? ` · ${escapeHtml(whatsappValue(order.client_messenger))}` : ''}</div>
      </div>
      <div class="quick-actions">${contactActions(order)}${routeAction(order)}</div>
    </section>
  `;
}

function contactActions(order) {
  const phone = String(order.client_phone || '').trim();
  const digits = phone.replace(/\D/g, '');
  return [
    phone ? `<a class="button secondary compact" href="tel:${escapeAttr(phone)}">Позвонить</a>` : '',
    digits ? `<a class="button secondary compact" href="https://wa.me/${digits}" target="_blank" rel="noopener">WhatsApp</a>` : '',
  ].join('');
}

function whatsappValue(value) {
  const contact = String(value || '').trim();
  return /telegram|t\.me|^@/i.test(contact) ? '' : contact;
}

function routeAction(order) {
  const airports = {
    'Борисполь': 'Boryspil International Airport',
    'Кишинёв': 'Chisinau International Airport',
    'Яссы': 'Iasi International Airport',
  };
  const origin = airports[order.airport] || order.airport;
  if (!origin || !order.destination_address) return '';
  const url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(order.destination_address)}&travelmode=driving`;
  return `<a class="button secondary compact" href="${escapeAttr(url)}" target="_blank" rel="noopener">Маршрут</a>`;
}

function metric(label, value) {
  return `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`;
}

function totalsAndOrders(totals, orders) {
  return `
    <section class="grid metrics">
      ${metric('День', money(totals.day))}
      ${metric('Неделя', money(totals.week))}
      ${metric('Месяц', money(totals.month))}
      ${metric('Заказов', orders.length)}
    </section>
    <section class="panel" style="margin-top:16px">${cards(orders)}</section>
  `;
}

function driverRow(driver) {
  return `
    <div class="list-row">
      <strong>${escapeHtml(driver.name)}</strong>
      <span>${escapeHtml(driver.phone)}</span>
      <span>${escapeHtml(driver.login)}</span>
      <button class="secondary" data-action="edit-driver" data-item='${escapeAttr(JSON.stringify(driver))}'>Редактировать</button>
    </div>
  `;
}

function auditRow(log) {
  const details = log.details_json ? safeJson(log.details_json) : '';
  return `
    <article class="audit-row">
      <div class="audit-mark action-${escapeAttr(log.action)}"></div>
      <div>
        <strong>${escapeHtml(log.summary)}</strong>
        <div class="subtle">${escapeHtml(log.user_name || 'Система')} · ${formatDateTime(log.created_at)}</div>
        ${details ? `<details><summary>Подробности</summary><pre>${escapeHtml(details)}</pre></details>` : ''}
      </div>
    </article>
  `;
}

function deletedOrderRow(order) {
  return `
    <div class="list-row deleted-order-row">
      <strong>#${order.id} ${escapeHtml(order.client_name)}</strong>
      <span>${escapeHtml(order.arrival_date)} ${escapeHtml(order.arrival_time)}</span>
      <span>${escapeHtml(order.deleted_at || '')}</span>
      <button class="secondary" data-action="restore-order" data-id="${order.id}">Восстановить</button>
    </div>
  `;
}

function carRow(car) {
  return `
    <div class="list-row">
      <strong>${escapeHtml(car.name)}</strong>
      <span>${escapeHtml(car.plate_number)}</span>
      <span>${escapeHtml(car.model || '')}</span>
      <button class="secondary" data-action="edit-car" data-item='${escapeAttr(JSON.stringify(car))}'>Редактировать</button>
    </div>
  `;
}

function tab(period, label, active) {
  return `<button class="${period === active ? 'active' : ''}" data-action="period" data-period="${period}">${label}</button>`;
}

function input(name, labelText, value = '', required = false, type = 'text') {
  return `<label>${labelText}<input name="${name}" type="${type}" value="${escapeAttr(value ?? '')}" ${required ? 'required' : ''}></label>`;
}

function textarea(name, labelText, value = '', required = false) {
  return `<label class="full">${labelText}<textarea name="${name}" ${required ? 'required' : ''}>${escapeHtml(value || '')}</textarea></label>`;
}

function select(name, labelText, options, value = '', required = false) {
  return `<label>${labelText}<select name="${name}" ${required ? 'required' : ''}>${selectOptions(options, value)}</select></label>`;
}

function selectOptions(options, value, empty = 'Не выбрано') {
  const normalized = options.map((item) => Array.isArray(item) ? item : [item, item]);
  return `<option value="">${empty}</option>` + normalized.map(([val, label]) => (
    `<option value="${escapeAttr(val)}" ${String(val) === String(value || '') ? 'selected' : ''}>${escapeHtml(label)}</option>`
  )).join('');
}

function statusOptions(labels, value, empty) {
  return `<option value="">${empty}</option>` + Object.entries(labels).map(([key, label]) => (
    `<option value="${key}" ${key === value ? 'selected' : ''}>${label}</option>`
  )).join('');
}

function driverOptions(value, empty) {
  return `<option value="">${empty}</option>` + state.drivers
    .filter((driver) => driver.is_active && driver.user_active)
    .map((driver) => `<option value="${driver.id}" ${String(driver.id) === String(value) ? 'selected' : ''}>${escapeHtml(driver.name)}</option>`)
    .join('');
}

async function loadDictionaries() {
  const [drivers, cars] = await Promise.all([
    api('/admin/drivers'),
    api('/admin/cars'),
  ]);
  state.drivers = drivers.drivers;
  state.cars = cars.cars;
}

async function refreshAvailability() {
  const form = document.querySelector('[data-form="order"]');
  const status = document.querySelector('#availability-status');
  if (!form || !status) return;
  const date = form.elements.arrival_date?.value;
  const time = form.elements.arrival_time?.value;
  const duration = form.elements.estimated_duration_minutes?.value || 300;
  resetResourceOptions(form);
  if (!date || !time) {
    status.className = 'availability neutral';
    status.textContent = 'Укажите дату и время, чтобы проверить занятость.';
    return;
  }

  status.className = 'availability neutral';
  status.textContent = 'Проверяем водителей и машины...';
  try {
    const params = new URLSearchParams({
      arrival_date: date,
      arrival_time: time,
      estimated_duration_minutes: duration,
    });
    if (form.dataset.id) params.set('exclude_order_id', form.dataset.id);
    const data = await api(`/admin/availability?${params}`);
    applyResourceConflicts(form, data.conflicts);
    const selectedDriver = Number(form.elements.assigned_driver_id?.value);
    const selectedCar = Number(form.elements.car_id?.value);
    const selectedConflicts = data.conflicts.filter((item) => (
      (selectedDriver && Number(item.assigned_driver_id) === selectedDriver)
      || (selectedCar && Number(item.car_id) === selectedCar)
    ));
    if (selectedConflicts.length) {
      status.className = 'availability conflict';
      status.textContent = `Конфликт с заказом ${selectedConflicts.map((item) => `#${item.id}`).join(', ')}. Выберите свободного водителя или машину.`;
    } else if (data.conflicts.length) {
      status.className = 'availability warning';
      status.textContent = 'Некоторые водители или машины заняты. Они отмечены в списках.';
    } else {
      status.className = 'availability available';
      status.textContent = 'На выбранное время все активные водители и машины свободны.';
    }
  } catch (error) {
    status.className = 'availability conflict';
    status.textContent = error.message;
  }
}

function resetResourceOptions(form) {
  updateResourceOptions(form.elements.assigned_driver_id, state.drivers, 'name');
  updateResourceOptions(form.elements.car_id, state.cars, 'car');
}

function updateResourceOptions(selectElement, items, kind) {
  if (!selectElement) return;
  [...selectElement.options].forEach((option) => {
    if (!option.value) return;
    const item = items.find((entry) => String(entry.id) === option.value);
    if (!item) return;
    const label = kind === 'car' ? `${item.name} ${item.plate_number}` : item.name;
    const active = item.is_active && (kind === 'car' || item.user_active);
    option.textContent = `${label}${active ? '' : ' (отключён)'}`;
    option.disabled = !active && !option.selected;
  });
}

function applyResourceConflicts(form, conflicts) {
  [...form.elements.assigned_driver_id.options].forEach((option) => {
    if (!option.value) return;
    const conflict = conflicts.find((item) => String(item.assigned_driver_id) === option.value);
    if (conflict) {
      option.textContent += ` (занят: #${conflict.id})`;
      option.disabled = !option.selected;
    }
  });
  [...form.elements.car_id.options].forEach((option) => {
    if (!option.value) return;
    const conflict = conflicts.find((item) => String(item.car_id) === option.value);
    if (conflict) {
      option.textContent += ` (занята: #${conflict.id})`;
      option.disabled = !option.selected;
    }
  });
}

function handleChanges(event) {
  const watched = ['arrival_date', 'arrival_time', 'estimated_duration_minutes', 'assigned_driver_id', 'car_id'];
  if (event.target.closest('[data-form="order"]') && watched.includes(event.target.name)) {
    refreshAvailability();
  }
}

async function submitForms(event) {
  const form = event.target.closest('form');
  if (!form) return;
  event.preventDefault();
  const type = form.dataset.form;
  const payload = Object.fromEntries(new FormData(form));

  try {
    if (type === 'login') {
      const data = await api('/auth/login', { method: 'POST', body: payload });
      state.user = data.user;
      state.notice = '';
      go(data.user.role === 'admin' ? '/admin/dashboard' : '/driver/dashboard');
    }
    if (type === 'filters') {
      const params = new URLSearchParams();
      Object.entries(payload).forEach(([key, value]) => { if (value) params.set(key, value); });
      go(`/admin/orders?${params.toString()}`);
    }
    if (type === 'order') {
      const id = form.dataset.id;
      await api(id ? `/admin/orders/${id}` : '/admin/orders', { method: id ? 'PUT' : 'POST', body: payload });
      go('/admin/orders');
    }
    if (type === 'driver') {
      const id = payload.id;
      delete payload.id;
      await api(id ? `/admin/drivers/${id}` : '/admin/drivers', { method: id ? 'PUT' : 'POST', body: payload });
      await loadDictionaries();
      render();
    }
    if (type === 'car') {
      const id = payload.id;
      delete payload.id;
      await api(id ? `/admin/cars/${id}` : '/admin/cars', { method: id ? 'PUT' : 'POST', body: payload });
      await loadDictionaries();
      render();
    }
    if (type === 'driver-status') {
      await api(`/driver/orders/${form.dataset.id}`, { method: 'PATCH', body: payload });
      render();
    }
    if (type === 'password') {
      await api('/auth/password', { method: 'POST', body: payload });
      state.user = null;
      state.notice = 'Пароль изменён. Войдите снова.';
      go('/login');
    }
  } catch (error) {
    form.insertAdjacentHTML('beforeend', `<div class="error">${escapeHtml(error.message)}</div>`);
  }
}

async function routeClicks(event) {
  const link = event.target.closest('a[href^="/"]');
  if (link && !link.dataset.nativeLink) {
    event.preventDefault();
    go(link.getAttribute('href'));
    return;
  }

  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action) return;

  if (action === 'logout') {
    await api('/auth/logout', { method: 'POST' });
    state.user = null;
    go('/login');
  }

  if (action === 'logout-all' && confirm('Завершить все активные сеансы?')) {
    await api('/auth/logout-all', { method: 'POST' });
    state.user = null;
    state.notice = 'Все сеансы завершены.';
    go('/login');
  }

  if (action === 'delete-order') {
    const id = document.querySelector('[data-form="order"]').dataset.id;
    if (confirm('Перенести заказ в удалённые? Его можно будет восстановить на странице защиты данных.')) {
      await api(`/admin/orders/${id}`, { method: 'DELETE' });
      go('/admin/orders');
    }
  }

  if (action === 'restore-order') {
    await api(`/admin/orders/${event.target.dataset.id}/restore`, { method: 'POST' });
    render();
  }

  if (action === 'edit-driver' || action === 'edit-car') {
    const item = JSON.parse(event.target.dataset.item);
    const form = document.querySelector(`[data-form="${action === 'edit-driver' ? 'driver' : 'car'}"]`);
    Object.entries(item).forEach(([key, value]) => {
      if (form.elements[key]) form.elements[key].value = value ?? '';
    });
    if (form.elements.is_active) form.elements.is_active.value = item.is_active ? 1 : 0;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (action === 'period') {
    go(`/driver/orders?period=${event.target.dataset.period}`);
  }
}

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    method: options.method || 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
}

function go(path, replace = false) {
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  render();
}

function money(value) {
  return `$${Number(value || 0).toFixed(0)}`;
}

function formatDateTime(value) {
  if (!value) return '';
  const parsed = new Date(`${String(value).replace(' ', 'T')}Z`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('ru-RU');
}

function safeJson(value) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#096;');
}
