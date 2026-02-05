# ASGARD CRM - Backend Server

API сервер для CRM системы ASGARD.

## Технологии

- **Node.js 20** + Fastify
- **PostgreSQL 15**
- **JWT** аутентификация
- **Telegram Bot** уведомления

## Быстрый старт

### 1. Установка на сервере

```bash
# Запустить скрипт установки (Ubuntu/Debian)
sudo bash scripts/install.sh
```

Скрипт установит:
- Node.js 20
- PostgreSQL 15
- Nginx
- Создаст базу данных
- Настроит systemd сервис

### 2. Развёртывание кода

```bash
# Скопировать серверный код
scp -r asgard-server/* root@your-server:/var/www/asgard-crm/

# Скопировать фронтенд
scp -r asgard-crm/* root@your-server:/var/www/asgard-crm/public/

# На сервере
cd /var/www/asgard-crm
npm install --production
node migrations/run.js
node scripts/reset-admin.js your-password
```

### 3. Запуск

```bash
systemctl start asgard-crm
systemctl enable asgard-crm
```

### 4. SSL сертификат

```bash
certbot --nginx -d your-domain.com
```

## Docker (альтернативный способ)

```bash
# Скопировать .env.example в .env и заполнить
cp .env.example .env

# Запустить
docker-compose up -d
```

## API Endpoints

### Авторизация
- `POST /api/auth/login` — вход
- `POST /api/auth/register` — регистрация
- `GET /api/auth/me` — текущий пользователь
- `POST /api/auth/change-password` — смена пароля

### Тендеры
- `GET /api/tenders` — список
- `GET /api/tenders/:id` — детали
- `POST /api/tenders` — создать
- `PUT /api/tenders/:id` — обновить
- `DELETE /api/tenders/:id` — удалить

### Работы
- `GET /api/works` — список
- `GET /api/works/:id` — детали
- `POST /api/works` — создать
- `PUT /api/works/:id` — обновить

### Расходы
- `GET /api/expenses/work` — расходы по работам
- `GET /api/expenses/office` — офисные расходы
- `POST /api/expenses/work` — добавить расход по работе
- `POST /api/expenses/office` — добавить офисный расход

### Календарь
- `GET /api/calendar` — события
- `POST /api/calendar` — создать событие
- `PUT /api/calendar/:id` — обновить
- `DELETE /api/calendar/:id` — удалить

### Отчёты
- `GET /api/reports/dashboard` — сводка
- `GET /api/reports/monthly` — помесячно
- `GET /api/reports/funnel` — воронка
- `GET /api/reports/export/tenders` — экспорт

## Переменные окружения

| Переменная | Описание | По умолчанию |
|------------|----------|--------------|
| `PORT` | Порт сервера | 3000 |
| `DB_HOST` | Хост PostgreSQL | localhost |
| `DB_PORT` | Порт PostgreSQL | 5432 |
| `DB_NAME` | Имя базы данных | asgard_crm |
| `DB_USER` | Пользователь БД | asgard |
| `DB_PASSWORD` | Пароль БД | — |
| `JWT_SECRET` | Секрет JWT | — |
| `TELEGRAM_BOT_TOKEN` | Токен Telegram бота | — |

## Telegram бот

Команды:
- `/start` — начало работы
- `/link email@example.com` — привязка аккаунта
- `/status` — статус системы
- `/my` — мои задачи
- `/help` — справка

## Миграции

```bash
# Запустить миграции
node migrations/run.js

# Откатить последнюю
node migrations/run.js down
```

## Логи

```bash
# Логи сервиса
journalctl -u asgard-crm -f

# Логи Nginx
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log
```

## Диагностика 401 Unauthorized в браузере

Если в консоли появляются ошибки вида `401 (Unauthorized)` для `/api/...`, это означает,
что фронтенд не авторизован и сервер отклоняет запросы.

Проверьте:

1. **Вы действительно вошли в систему.**  
   Откройте страницу входа и выполните логин, затем проверьте запросы снова.
2. **JWT секрет и настройки окружения.**  
   Убедитесь, что в `.env` задан `JWT_SECRET`, а также корректные `DB_*`.
3. **Куки/LocalStorage не очищены.**  
   Если вы чистили кеш или cookies — нужно перелогиниться.
4. **API доступен и отвечает.**  
   ```bash
   curl -v http://localhost:3000/api/health
   ```
   Ответ `200 OK` означает, что backend жив, а 401 — это именно авторизация.

## Бэкап базы

```bash
# Создать бэкап
pg_dump -U asgard asgard_crm > backup_$(date +%Y%m%d).sql

# Восстановить
psql -U asgard asgard_crm < backup_20240101.sql
```

## Решение частых ошибок при бэкапе и миграциях

### Ошибка: `Peer authentication failed for user "asgard"`
Это означает, что PostgreSQL требует локальную аутентификацию через peer для пользователя `asgard`.
Запускайте команды под пользователем `postgres`:

```bash
sudo -u postgres pg_dump -Fc asgard_crm > backup_$(date +%Y%m%d_%H%M%S).dump
```

### Ошибка миграции: `must be owner of table ...`
Миграции нужно выполнять пользователем‑владельцем таблиц. Обычно это `postgres`.

```bash
sudo -u postgres node migrations/run.js
```

Если ошибка повторяется для конкретной таблицы (например, `chat_messages`),
нужно сменить владельца таблицы и повторить миграцию:

```bash
sudo -u postgres psql -d asgard_crm -c "ALTER TABLE chat_messages OWNER TO postgres;"
sudo -u postgres node migrations/run.js
```

---

© ASGARD CRM Team
