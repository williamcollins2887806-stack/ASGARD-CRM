# 🚀 Полная инструкция по развёртыванию АСГАРД CRM

---

## Оглавление

1. [Требования](#1-требования)
2. [Быстрый старт (5 минут)](#2-быстрый-старт-5-минут)
3. [Вариант A: VPS с Nginx (рекомендуется)](#3-вариант-a-vps-с-nginx)
4. [Вариант B: Docker](#4-вариант-b-docker)
5. [Вариант C: Обычный хостинг](#5-вариант-c-обычный-хостинг)
6. [Настройка SSL (HTTPS)](#6-настройка-ssl-https)
7. [Настройка PostgreSQL](#7-настройка-postgresql)
8. [Настройка бэкенда API](#8-настройка-бэкенда-api)
9. [Первоначальная настройка CRM](#9-первоначальная-настройка-crm)
10. [Резервное копирование](#10-резервное-копирование)
11. [Решение проблем](#11-решение-проблем)

---

## 1. Требования

### Минимальные (только фронтенд):
- Любой веб-сервер (Nginx, Apache, даже GitHub Pages)
- 100 MB места на диске
- HTTPS (для PWA)

### Рекомендуемые (с бэкендом):
| Компонент | Минимум | Рекомендуется |
|-----------|---------|---------------|
| ОС | Ubuntu 20.04 | Ubuntu 22.04 LTS |
| CPU | 1 ядро | 2 ядра |
| RAM | 1 GB | 2 GB |
| Диск | 10 GB SSD | 20 GB SSD |
| PostgreSQL | 13+ | 15 |
| Python | 3.9+ | 3.11 |

---

## 2. Быстрый старт (5 минут)

Если у вас уже есть сервер с Nginx:

```bash
# 1. Загрузите архив на сервер
scp asgard-crm-v43-complete.zip user@server:/tmp/

# 2. Подключитесь к серверу
ssh user@server

# 3. Распакуйте в нужную папку
sudo mkdir -p /var/www/asgard-crm
sudo unzip /tmp/asgard-crm-v43-complete.zip -d /var/www/asgard-crm
sudo chown -R www-data:www-data /var/www/asgard-crm

# 4. Создайте конфиг Nginx
sudo nano /etc/nginx/sites-available/asgard-crm
```

Вставьте:
```nginx
server {
    listen 80;
    server_name ваш-домен.ru;
    root /var/www/asgard-crm;
    index index.html;
    
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

```bash
# 5. Активируйте и перезапустите
sudo ln -s /etc/nginx/sites-available/asgard-crm /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

✅ Готово! Откройте `http://ваш-домен.ru`

---

## 3. Вариант A: VPS с Nginx

### Шаг 1: Аренда VPS

Рекомендуемые провайдеры:
- [Timeweb Cloud](https://timeweb.cloud) — от 199₽/мес
- [REG.RU](https://reg.ru) — от 250₽/мес
- [Selectel](https://selectel.ru) — от 300₽/мес
- [DigitalOcean](https://digitalocean.com) — от $4/мес

При заказе выберите:
- ОС: **Ubuntu 22.04 LTS**
- Тариф: минимум 1 CPU, 1 GB RAM

### Шаг 2: Подключение к серверу

```bash
# С Windows используйте PuTTY или Windows Terminal
# С Mac/Linux используйте терминал

ssh root@IP_АДРЕС_СЕРВЕРА
```

### Шаг 3: Первоначальная настройка сервера

```bash
# Обновление системы
apt update && apt upgrade -y

# Установка необходимого ПО
apt install -y nginx unzip curl ufw

# Настройка файрвола
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
```

### Шаг 4: Загрузка CRM на сервер

**Способ 1: Через SCP (с вашего компьютера)**
```bash
# На ВАШЕМ компьютере выполните:
scp asgard-crm-v43-complete.zip root@IP_СЕРВЕРА:/tmp/
```

**Способ 2: Через SFTP клиент**
1. Установите [FileZilla](https://filezilla-project.org)
2. Подключитесь: Хост: IP_СЕРВЕРА, Пользователь: root, Порт: 22
3. Загрузите архив в папку `/tmp/`

**Способ 3: Через wget (если есть прямая ссылка)**
```bash
# На сервере:
cd /tmp
wget https://ваша-ссылка/asgard-crm-v43-complete.zip
```

### Шаг 5: Распаковка и настройка прав

```bash
# Создаём директорию
mkdir -p /var/www/asgard-crm

# Распаковываем
unzip /tmp/asgard-crm-v43-complete.zip -d /var/www/asgard-crm

# Проверяем структуру
ls -la /var/www/asgard-crm

# Должны увидеть:
# index.html, manifest.json, sw.js, assets/, docs/, tools/

# Устанавливаем права
chown -R www-data:www-data /var/www/asgard-crm
chmod -R 755 /var/www/asgard-crm
```

### Шаг 6: Настройка Nginx

```bash
# Создаём конфиг
nano /etc/nginx/sites-available/asgard-crm
```

Вставьте полный конфиг:

```nginx
server {
    listen 80;
    listen [::]:80;
    
    server_name ваш-домен.ru www.ваш-домен.ru;
    
    root /var/www/asgard-crm;
    index index.html;
    
    # Основной location - SPA роутинг
    location / {
        try_files $uri $uri/ /index.html;
    }
    
    # Кэширование статики на 1 год
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        access_log off;
    }
    
    # Service Worker - без кэша
    location = /sw.js {
        expires off;
        add_header Cache-Control "no-store, no-cache, must-revalidate";
    }
    
    # Manifest - без кэша
    location = /manifest.json {
        expires off;
        add_header Cache-Control "no-store, no-cache";
        default_type application/manifest+json;
    }
    
    # Gzip сжатие
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml image/svg+xml;
    gzip_comp_level 6;
    
    # Безопасность
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    
    # Запрет доступа к скрытым файлам
    location ~ /\. {
        deny all;
        access_log off;
        log_not_found off;
    }
    
    # Логи
    access_log /var/log/nginx/asgard-access.log;
    error_log /var/log/nginx/asgard-error.log;
}
```

**Замените `ваш-домен.ru` на ваш реальный домен!**

### Шаг 7: Активация конфига

```bash
# Создаём ссылку
ln -s /etc/nginx/sites-available/asgard-crm /etc/nginx/sites-enabled/

# Удаляем дефолтный сайт (опционально)
rm -f /etc/nginx/sites-enabled/default

# Проверяем конфигурацию
nginx -t

# Если видите "syntax is ok" - всё хорошо!

# Перезапускаем Nginx
systemctl reload nginx
```

### Шаг 8: Проверка

```bash
# Проверяем что Nginx работает
systemctl status nginx

# Проверяем доступность локально
curl -I http://localhost

# Должны увидеть: HTTP/1.1 200 OK
```

Откройте в браузере: `http://ваш-домен.ru`

---

## 4. Вариант B: Docker

### Шаг 1: Установка Docker

```bash
# Ubuntu/Debian
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Добавляем пользователя в группу docker
usermod -aG docker $USER
```

### Шаг 2: Подготовка файлов

```bash
# Создаём рабочую директорию
mkdir -p /opt/asgard-crm
cd /opt/asgard-crm

# Распаковываем архив
unzip /path/to/asgard-crm-v43-complete.zip
```

### Шаг 3: Создание Dockerfile

```bash
nano Dockerfile
```

```dockerfile
FROM nginx:1.25-alpine

# Копируем файлы CRM
COPY . /usr/share/nginx/html/

# Удаляем лишнее
RUN rm -f /usr/share/nginx/html/Dockerfile \
    /usr/share/nginx/html/docker-compose.yml \
    /usr/share/nginx/html/nginx-docker.conf

# Копируем конфиг nginx
COPY nginx-docker.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
```

### Шаг 4: Создание nginx-docker.conf

```bash
nano nginx-docker.conf
```

```nginx
server {
    listen 80;
    server_name localhost;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|svg|ico|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location = /sw.js {
        expires off;
        add_header Cache-Control "no-store";
    }

    gzip on;
    gzip_types text/plain text/css application/json application/javascript;
}
```

### Шаг 5: Сборка и запуск

```bash
# Сборка образа
docker build -t asgard-crm:v43 .

# Запуск контейнера
docker run -d \
  --name asgard-crm \
  -p 80:80 \
  --restart unless-stopped \
  asgard-crm:v43

# Проверка
docker ps
docker logs asgard-crm
```

---

## 5. Вариант C: Обычный хостинг

Подходит для shared-хостингов (Timeweb, REG.RU, Beget и т.д.)

### Шаг 1: Распакуйте архив на компьютере

### Шаг 2: Загрузите файлы через FTP/SFTP

Используйте FileZilla или встроенный файловый менеджер хостинга.

Загрузите содержимое архива в папку:
- `public_html/` (Timeweb, REG.RU)
- `www/` (некоторые хостинги)
- `htdocs/` (Apache)

### Шаг 3: Создайте .htaccess (для Apache)

Создайте файл `.htaccess` в корне:

```apache
<IfModule mod_rewrite.c>
    RewriteEngine On
    RewriteBase /
    
    # Если файл или папка существует - отдаём
    RewriteCond %{REQUEST_FILENAME} !-f
    RewriteCond %{REQUEST_FILENAME} !-d
    
    # Иначе отдаём index.html (для SPA)
    RewriteRule . /index.html [L]
</IfModule>

# Кэширование
<IfModule mod_expires.c>
    ExpiresActive On
    ExpiresByType text/css "access plus 1 year"
    ExpiresByType application/javascript "access plus 1 year"
    ExpiresByType image/png "access plus 1 year"
    ExpiresByType image/svg+xml "access plus 1 year"
</IfModule>

# Сжатие
<IfModule mod_deflate.c>
    AddOutputFilterByType DEFLATE text/html text/css application/javascript application/json
</IfModule>
```

---

## 6. Настройка SSL (HTTPS)

**HTTPS обязателен для:**
- Установки PWA на телефон
- Service Worker
- Webhook от Манго Телеком
- Безопасности

### Let's Encrypt (бесплатно, автоматически)

```bash
# Установка Certbot
apt install -y certbot python3-certbot-nginx

# Получение сертификата
certbot --nginx -d ваш-домен.ru -d www.ваш-домен.ru

# Следуйте инструкциям:
# - Введите email
# - Согласитесь с условиями
# - Выберите редирект с HTTP на HTTPS

# Проверка автообновления
certbot renew --dry-run
```

После этого сайт будет доступен по `https://ваш-домен.ru`

---

## 7. Настройка PostgreSQL

*Нужен только для серверной синхронизации данных между устройствами.*

### Шаг 1: Установка

```bash
apt install -y postgresql postgresql-contrib
```

### Шаг 2: Создание базы

```bash
# Входим под postgres
sudo -u postgres psql

# Выполняем команды:
CREATE USER asgard WITH PASSWORD 'ваш_надёжный_пароль';
CREATE DATABASE asgard_crm OWNER asgard;
GRANT ALL PRIVILEGES ON DATABASE asgard_crm TO asgard;
\q
```

### Шаг 3: Загрузка схемы

```bash
sudo -u postgres psql -d asgard_crm -f /var/www/asgard-crm/tools/schema.sql
```

---

## 8. Настройка бэкенда API

*Нужен для синхронизации и телефонии.*

### Шаг 1: Установка Python

```bash
apt install -y python3 python3-pip python3-venv
```

### Шаг 2: Создание окружения

```bash
cd /var/www/asgard-crm
python3 -m venv venv
source venv/bin/activate
pip install fastapi uvicorn psycopg2-binary sqlalchemy python-multipart
```

### Шаг 3: Создание сервиса

```bash
nano /etc/systemd/system/asgard-api.service
```

```ini
[Unit]
Description=ASGARD CRM API
After=network.target

[Service]
User=www-data
WorkingDirectory=/var/www/asgard-crm
Environment="PATH=/var/www/asgard-crm/venv/bin"
ExecStart=/var/www/asgard-crm/venv/bin/uvicorn tools.server_api:app --host 127.0.0.1 --port 8000
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable asgard-api
systemctl start asgard-api
```

### Шаг 4: Проксирование через Nginx

Добавьте в конфиг Nginx:

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:8000/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

```bash
nginx -t && systemctl reload nginx
```

---

## 9. Первоначальная настройка CRM

### Шаг 1: Откройте CRM

```
https://ваш-домен.ru
```

### Шаг 2: Первый вход

| Поле | Значение |
|------|----------|
| Логин | `admin` |
| Пароль | `admin` |

### Шаг 3: Смените пароль!

1. **Настройки** → **Пользователи**
2. Редактировать `admin`
3. Установить надёжный пароль

### Шаг 4: Создайте пользователей

Роли в системе:
- `ADMIN` — Полный доступ
- `DIRECTOR_GEN` — Генеральный директор
- `DIRECTOR_COMM` — Коммерческий директор
- `DIRECTOR_DEV` — Технический директор
- `PM` — Руководитель проекта
- `TO` — Тендерный отдел
- `HR` — Кадры
- `BUH` — Бухгалтерия

---

## 10. Резервное копирование

### Автоматический бэкап (cron)

```bash
nano /etc/cron.daily/asgard-backup
```

```bash
#!/bin/bash
DATE=$(date +%Y%m%d)
BACKUP_DIR="/var/backups/asgard"

mkdir -p $BACKUP_DIR

# Бэкап файлов
tar -czf $BACKUP_DIR/files_$DATE.tar.gz /var/www/asgard-crm

# Бэкап БД (если есть)
pg_dump -U asgard asgard_crm | gzip > $BACKUP_DIR/db_$DATE.sql.gz

# Удаление старых бэкапов (30 дней)
find $BACKUP_DIR -type f -mtime +30 -delete
```

```bash
chmod +x /etc/cron.daily/asgard-backup
```

---

## 11. Решение проблем

### Белый экран

```bash
# Проверьте права
ls -la /var/www/asgard-crm/
chown -R www-data:www-data /var/www/asgard-crm

# Проверьте логи
tail -f /var/log/nginx/asgard-error.log
```

### PWA не устанавливается

- Нужен HTTPS
- Проверьте manifest.json
- Проверьте sw.js

### API не работает

```bash
systemctl status asgard-api
journalctl -u asgard-api -f
```

---

## 📋 Чеклист после установки

- [ ] CRM открывается по домену
- [ ] HTTPS работает (зелёный замок)
- [ ] Вход admin/admin работает
- [ ] Пароль admin изменён
- [ ] Пользователи созданы
- [ ] PWA устанавливается на телефон
- [ ] Бэкап настроен

---

**Вопросы?** Проверьте логи: `tail -f /var/log/nginx/asgard-error.log`

*АСГАРД CRM v43 | Документация по развёртыванию*
