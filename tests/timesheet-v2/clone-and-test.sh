#!/bin/bash
# Клонирование БД + запуск тест-сервера на :3100 + прогон Playwright.
# Запускать с локального Windows через ssh (когда SSH к проду вернётся).
# НИКОГДА не запускать на проде с :3000 — defensive check.

set -e

SERVER=root@92.242.61.184
PROD_DB=asgard_crm
TEST_DB=asgard_crm_test
TEST_PORT=3100

if [ "$TEST_PORT" = "3000" ]; then
  echo "FATAL: TEST_PORT == 3000 (прод). Останавливаюсь."
  exit 2
fi

echo "[1/6] Бэкап и клон БД..."
ssh -i ~/.ssh/asgard_crm_deploy $SERVER "
  PGPASSWORD=123456789 psql -U asgard -d postgres -c 'DROP DATABASE IF EXISTS ${TEST_DB}';
  PGPASSWORD=123456789 psql -U asgard -d postgres -c 'CREATE DATABASE ${TEST_DB} TEMPLATE template0';
  PGPASSWORD=123456789 pg_dump -U asgard ${PROD_DB} | PGPASSWORD=123456789 psql -U asgard -d ${TEST_DB}
"

echo "[2/6] Применение миграций V231-V233 на клоне..."
for migration in V231__position_points V232__payroll_period_locks V233__field_checkins_entered_by; do
  echo "  → $migration"
  scp -i ~/.ssh/asgard_crm_deploy "migrations/${migration}.sql" $SERVER:/tmp/
  ssh -i ~/.ssh/asgard_crm_deploy $SERVER "PGPASSWORD=123456789 psql -U asgard -d ${TEST_DB} -f /tmp/${migration}.sql"
done

echo "[3/6] Заливка нового кода в /tmp/asgard-test/..."
ssh -i ~/.ssh/asgard_crm_deploy $SERVER 'mkdir -p /tmp/asgard-test && rsync -a /var/www/asgard-crm/ /tmp/asgard-test/'
# Заливаем правленные файлы
for f in \
  src/routes/timesheet-v2.js src/lib/timesheet-locks.js \
  src/routes/field-pm.js src/routes/field-manage.js \
  src/routes/global-timesheet.js src/routes/worker-payments.js \
  src/routes/field-stages.js src/routes/field-logistics.js \
  src/routes/field-checkin.js src/index.js \
  public/assets/js/timesheet-v2.js public/assets/js/app.js \
  public/assets/js/payroll.js public/index.html
do
  scp -i ~/.ssh/asgard_crm_deploy "$f" "$SERVER:/tmp/asgard-test/$f"
done

# v2 билд (полностью dist)
tar czf /tmp/v2-build.tgz -C public/v2 .
scp -i ~/.ssh/asgard_crm_deploy /tmp/v2-build.tgz $SERVER:/tmp/
ssh -i ~/.ssh/asgard_crm_deploy $SERVER 'cd /tmp/asgard-test/public/v2 && rm -rf * && tar xzf /tmp/v2-build.tgz'

# mobile-app билд
tar czf /tmp/m-build.tgz -C public/m .
scp -i ~/.ssh/asgard_crm_deploy /tmp/m-build.tgz $SERVER:/tmp/
ssh -i ~/.ssh/asgard_crm_deploy $SERVER 'cd /tmp/asgard-test/public/m && rm -rf * && tar xzf /tmp/m-build.tgz'

echo "[4/6] Старт тестового сервера на :${TEST_PORT}..."
ssh -i ~/.ssh/asgard_crm_deploy $SERVER "
  pkill -f 'PORT=${TEST_PORT}' || true;
  sleep 2;
  cd /tmp/asgard-test && \
    PORT=${TEST_PORT} \
    PGHOST=127.0.0.1 PGDATABASE=${TEST_DB} PGUSER=asgard PGPASSWORD=123456789 \
    NODE_ENV=test \
    nohup node src/index.js > /tmp/asgard-test.log 2>&1 &
  sleep 5;
  ss -ltnp | grep ${TEST_PORT}
"

echo "[5/6] Открытие SSH-туннеля :${TEST_PORT}..."
# Этот туннель надо открыть в отдельном терминале — здесь не блокируется
echo "    Запусти в другом терминале:"
echo "    ssh -i ~/.ssh/asgard_crm_deploy -L ${TEST_PORT}:127.0.0.1:${TEST_PORT} $SERVER -N"
echo "    Затем нажми Enter здесь..."
read

echo "[6/6] Прогон Playwright..."
BASE_URL=http://127.0.0.1:${TEST_PORT} npx playwright test tests/timesheet-v2/playwright-suite.spec.js

echo "[OK] Тесты прошли. Сервер на :${TEST_PORT} остался. Останов:"
echo "  ssh -i ~/.ssh/asgard_crm_deploy $SERVER 'pkill -f \"PORT=${TEST_PORT}\"'"
