#!/bin/bash
# ASGARD CRM — post-restart smoke test.
# Запускается systemd через ExecStartPost после каждого `systemctl restart asgard-crm`.
# Ждёт пока поднимется HTTP, проверяет ключевые endpoints, alert в journal при 5xx.
#
# Установка:
#   cp ops/asgard-post-restart-smoke.sh /usr/local/bin/
#   chmod +x /usr/local/bin/asgard-post-restart-smoke.sh
#   В /etc/systemd/system/asgard-crm.service.d/smoke.conf:
#     [Service]
#     ExecStartPost=/usr/local/bin/asgard-post-restart-smoke.sh
#
# Сам fail НЕ останавливает сервис (TimeoutStartSec ограничивает зависание) —
# логирует в журнал. Watchdog (server-monitor) при следующей проверке всё заметит.

set -u
PORT="${ASGARD_PORT:-3000}"
BASE="http://127.0.0.1:${PORT}"
TIMEOUT_MS=2000
RETRY=15        # ждать до 30 сек пока поднимется HTTP
SLEEP_BETWEEN=2

# Endpoints в формате: METHOD PATH [expected_codes]
# 401 ожидаемый для защищённых endpoints — это норма, не ошибка.
ENDPOINTS=(
  "GET /api/health 200"
  "GET /api/version 200"
  "GET /api/field/worker/me 401"
  "GET /api/field/worker/active-project 401"
  "GET /api/field/academy/updates 401"
  "GET /api/field/gamification/leaderboard 401"
  "GET /api/products 401"
  "GET /api/equipment 401"
  "GET /api/icons/manifest 401"
  "GET /api/works 401"
)

log() {
  echo "[asgard-smoke] $1" | systemd-cat -t asgard-smoke -p info
  echo "[asgard-smoke] $1"
}
err() {
  echo "[asgard-smoke] FAIL: $1" | systemd-cat -t asgard-smoke -p err
  echo "[asgard-smoke] FAIL: $1" >&2
}

# 1) Ждём пока HTTP-сервис поднимется (max 30 сек)
log "Waiting for ${BASE}/api/health (max $((RETRY*SLEEP_BETWEEN)) сек)..."
ready=0
for i in $(seq 1 $RETRY); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "${BASE}/api/health" 2>/dev/null || echo "000")
  if [ "$code" = "200" ] || [ "$code" = "503" ]; then
    log "Service reachable after ${i}× sleep (HTTP $code)"
    ready=1
    break
  fi
  sleep $SLEEP_BETWEEN
done
if [ $ready -eq 0 ]; then
  err "Service не отвечает на /api/health за $((RETRY*SLEEP_BETWEEN))с — возможно не стартанул"
  exit 0   # не валим systemd start
fi

# 2) Прогоняем эндпоинты
fails=0
total=0
for line in "${ENDPOINTS[@]}"; do
  read -r method path expected <<< "$line"
  total=$((total+1))
  code=$(curl -s -o /dev/null -w "%{http_code}" -X $method --max-time 5 "${BASE}${path}" 2>/dev/null || echo "000")
  if [[ ",${expected}," == *",${code},"* ]]; then
    :
  elif [[ "${code}" =~ ^5 ]]; then
    err "${method} ${path} → HTTP ${code} (ожидали ${expected})"
    fails=$((fails+1))
  else
    log "WARN ${method} ${path} → HTTP ${code} (ожидали ${expected})"
  fi
done

if [ $fails -gt 0 ]; then
  err "Smoke FAIL: ${fails}/${total} endpoints вернули 5xx после restart"
else
  log "Smoke OK: ${total}/${total} endpoints здоровы"
fi

exit 0
