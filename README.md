# Uman Transfer CRM

Внутренняя CRM для компании трансферов в Умань. Клиенты не регистрируются и не создают заказы: все заказы вручную ведёт админ, а водитель видит только назначенные ему поездки.

## Стек

- Frontend: обычные HTML, CSS, JavaScript
- Backend: Cloudflare Pages Functions / Workers runtime
- База данных: Cloudflare D1
- Хостинг: Cloudflare Pages
- Авторизация: логин, пароль, HttpOnly cookie
- npm-зависимости в проекте: нет

## Структура

```text
public/
  index.html
  styles.css
  app.js
functions/
  api/[[path]].js
migrations/
  0001_schema.sql
  0002_seed.sql
  0003_operations_security.sql
  0004_remove_telegram.sql
  0005_data_safety.sql
start-local.command
backup-cloudflare.command
DATA_SAFETY.md
PRODUCTION_CHECKLIST.md
wrangler.toml
```

## Тестовые пользователи

| Роль | Логин | Пароль |
| --- | --- | --- |
| admin | admin | admin123 |
| driver | ivan | driver123 |
| driver | oleh | driver456 |

## Локальный запуск

Нужен Cloudflare Wrangler. Его можно запускать через `npx`, не добавляя зависимости в проект.

### Вариант 1: локальная база на вашем компьютере

Для обычной работы локально используйте этот вариант. База будет храниться в папке проекта:

```text
/Users/23force/Documents/Codex/2026-06-04/new-chat/work/uman-transfer-crm/local-database
```

Все изменения, которые вы внесёте в CRM локально, будут сохраняться в этой папке.

Запуск:

```bash
cd /Users/23force/Documents/Codex/2026-06-04/new-chat/work/uman-transfer-crm
zsh start-local.command
```

После запуска откройте:

```text
http://localhost:8788/login
```

Тестовый вход:

```text
admin / admin123
```

Важно: не удаляйте папку `local-database`, если хотите сохранить свои локальные заказы, водителей, машины и оплаты.

### Вариант 2: обычный Wrangler запуск без отдельного скрипта

```bash
cd /Users/23force/Documents/Codex/2026-06-04/new-chat/work/uman-transfer-crm
npx wrangler d1 migrations apply DB --local --persist-to ./local-database
npx wrangler pages dev public --persist-to ./local-database
```
После запуска откройте адрес, который покажет Wrangler, обычно `http://localhost:8788/login`.

## Деплой на Cloudflare

1. Создайте D1 базу:

```bash
npx wrangler d1 create uman-transfer-crm
```

2. Вставьте полученный `database_id` в `wrangler.toml`.

3. Примените миграции в Cloudflare:

```bash
npx wrangler d1 migrations apply uman-transfer-crm --remote
```

4. Создайте Cloudflare Pages проект и задеплойте:

```bash
npx wrangler pages project create uman-transfer-crm --production-branch main
npx wrangler pages deploy public --project-name uman-transfer-crm
```

5. В настройках Pages привяжите D1 binding:

- Binding name: `DB`
- D1 database: `uman-transfer-crm`

## Рабочий режим для реального использования

Если папа будет вносить изменения с телефона, используйте только Cloudflare Pages + Cloudflare D1.
Локальный режим нужен для тестов, но не для ежедневной работы.

Перед запуском в работу пройдите чеклист:

```text
PRODUCTION_CHECKLIST.md
```

Про защиту данных и бэкапы:

```text
DATA_SAFETY.md
```

Полный бэкап рабочей Cloudflare D1 базы:

```bash
cd /Users/23force/Documents/Codex/2026-06-04/new-chat/work/uman-transfer-crm
zsh backup-cloudflare.command
```

В админке есть страница:

```text
/admin/safety
```

Там можно скачать CSV и восстановить случайно удалённые заказы.

## Роли

### Admin

- создаёт, редактирует и удаляет заказы
- назначает и меняет водителя
- видит все заказы
- ищет и фильтрует заказы по дате, аэропорту, водителю и статусу
- добавляет, редактирует и отключает водителей
- добавляет и редактирует машины
- видит оплаты, доход за день, неделю и месяц
- видит историю завершённых поездок

### Driver

- видит только свои назначенные заказы
- видит заказы на сегодня, завтра и будущие даты
- открывает заказ и смотрит детали
- меняет статус поездки
- пишет комментарий админу
- видит историю своих поездок

## Основные страницы

- `/login`
- `/admin/dashboard`
- `/admin/orders`
- `/admin/orders/new`
- `/admin/orders/:id`
- `/admin/drivers`
- `/admin/cars`
- `/admin/payments`
- `/admin/reports`
- `/driver/dashboard`
- `/driver/orders`
- `/driver/orders/:id`
- `/driver/history`

## Важно для продакшена

- После первого входа смените тестовые пароли.
- Не оставляйте `0002_seed.sql` с демо-данными в чистой продакшен-базе, если они не нужны.
- В Cloudflare Pages должен быть привязан D1 binding с именем `DB`.
