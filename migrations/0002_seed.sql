INSERT INTO users (id, role, name, login, password_salt, password_hash, is_active) VALUES
  (1, 'admin', 'Администратор', 'admin', 'admin-demo-salt', 'f7f8967f5531839dde86b6f2a7b12c921ddfe41c0f71ad6818ee525d25eb9dbd', 1),
  (2, 'driver', 'Иван Коваленко', 'ivan', 'driver-ivan-salt', '26ec8f6f1db5e0efcf57ee8d74c483f9365c1c5e54045035bb2207ca2440e8ee', 1),
  (3, 'driver', 'Олег Шевченко', 'oleh', 'driver-oleh-salt', '97435ce6bea3d8a1c35cfdb6f39db2d79eb8ca1e92e36f8d7162f510df6ff154', 1);

INSERT INTO drivers (id, user_id, phone, notes, is_active) VALUES
  (1, 2, '+380671112233', 'Говорит RU/UA/EN, часто ездит из Борисполя.', 1),
  (2, 3, '+380932223344', 'Большой багаж, аккуратная езда.', 1);

INSERT INTO cars (id, name, plate_number, model, seats, is_active) VALUES
  (1, 'Toyota Camry', 'ВН 1234 КА', 'Camry 70', 4, 1),
  (2, 'Mercedes Vito', 'СА 7788 АІ', 'Vito 116', 7, 1),
  (3, 'Skoda Octavia', 'АА 9021 ММ', 'Octavia A8', 4, 1);

INSERT INTO orders (
  id, client_name, client_phone, client_messenger, airport, terminal, flight_number,
  arrival_date, arrival_time, passengers_count, luggage_count, destination_address,
  client_comment, admin_comment, assigned_driver_id, car_id, price, deposit, payment_rest,
  payment_method, payment_status, trip_status
) VALUES
  (1, 'Михаил Розен', '+972501112233', 'WhatsApp +972501112233', 'Кишинёв', 'Main', 'H7 421', date('now'), '14:35', 2, 3, 'Умань, ул. Пушкина 12', 'Нужна встреча с табличкой.', 'Попросить водителя написать за час.', 1, 1, 180, 50, 130, 'cash', 'deposit_paid', 'assigned'),
  (2, 'Sarah Cohen', '+972542223344', 'WhatsApp +972542223344', 'Борисполь', 'D', 'LY 2651', date('now', '+1 day'), '09:10', 1, 1, 'Умань, отель Shaarei Zion', '', 'VIP клиент, без задержек.', 2, 2, 240, 240, 0, 'card', 'paid', 'accepted'),
  (3, 'Давид Леви', '+380501234567', 'WhatsApp +380501234567', 'Яссы', 'T3', 'W4 3320', date('now', '+3 day'), '22:05', 4, 5, 'Умань, Софиевская 7', 'Детское кресло.', '', NULL, 2, 300, 0, 300, 'cash', 'unpaid', 'new'),
  (4, 'Анна Бродская', '+972533334455', 'WhatsApp +972533334455', 'Кишинёв', 'Main', 'RO 188', date('now', '-2 day'), '16:20', 2, 2, 'Умань, ул. Небесной Сотни 18', '', 'Оплачено полностью.', 1, 3, 190, 190, 0, 'cash', 'paid', 'completed');
