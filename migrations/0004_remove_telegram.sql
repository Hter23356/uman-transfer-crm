UPDATE drivers SET telegram = '';

UPDATE orders
SET client_messenger = ''
WHERE lower(client_messenger) LIKE '%telegram%'
   OR lower(client_messenger) LIKE '%t.me%'
   OR client_messenger LIKE '@%';

ALTER TABLE drivers DROP COLUMN telegram;
