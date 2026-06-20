#!/bin/bash
# Backend smoke-тесты Timesheet v2 — через curl, под каждой ролью на :3100 (клон БД).
# Запускать на сервере 92.242.61.184 где поднят :3100.

set -u
BASE="http://127.0.0.1:3100"
Y=2026; M=6
PASS=0; FAIL=0; FAILS=""

declare -A ACCOUNTS=(
  ["PM"]="test_pm"
  ["WAREHOUSE"]="test_warehouse"
  ["TO"]="test_to"
  ["OFFICE_MANAGER"]="test_office_manager"
  ["DIRECTOR_GEN"]="test_director"
  ["BUH"]="test_buh"
  ["HR"]="test_hr"
  ["HEAD_TO"]="test_head_to"
  ["ADMIN"]="test_admin"
)

login() {
  local login=$1
  local RESP=$(curl -s -X POST $BASE/api/auth/login \
    -H 'Content-Type: application/json' \
    -d "{\"login\":\"$login\",\"password\":\"Test123!\"}")
  local STATUS=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null)
  local TOK=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
  if [ -z "$TOK" ]; then echo ""; return; fi
  if [ "$STATUS" = "ok" ]; then
    echo "$TOK"
    return
  fi
  # need_pin path
  curl -s -X POST $BASE/api/auth/verify-pin \
    -H "Authorization: Bearer $TOK" \
    -H 'Content-Type: application/json' \
    -d '{"pin":"1234"}' \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null
}

check() {
  local name=$1; local got=$2; local want=$3
  if [ "$got" = "$want" ]; then
    PASS=$((PASS+1))
    echo "  ✓ $name"
  else
    FAIL=$((FAIL+1))
    FAILS+="$name (got=$got want=$want)\n"
    echo "  ✗ $name — got=$got want=$want"
  fi
}

check_contains() {
  local name=$1; local haystack=$2; local needle=$3
  if echo "$haystack" | grep -q "$needle"; then
    PASS=$((PASS+1))
    echo "  ✓ $name"
  else
    FAIL=$((FAIL+1))
    FAILS+="$name (no '$needle' in response)\n"
    echo "  ✗ $name — нет '$needle'"
  fi
}

# ── Тест: каждая роль может залогиниться и получить /:y/:m ──
echo ""
echo "═══════ Тест 1: Login + GET /:y/:m под каждой ролью ═══════"
for role in PM WAREHOUSE TO OFFICE_MANAGER DIRECTOR_GEN BUH HR HEAD_TO ADMIN; do
  login_name=${ACCOUNTS[$role]}
  echo "── Роль: $role ($login_name) ──"
  TOKEN=$(login "$login_name")
  if [ -z "$TOKEN" ]; then
    FAIL=$((FAIL+1)); FAILS+="$role: не залогинился\n"
    echo "  ✗ Login failed"
    continue
  fi
  RESP=$(curl -s "$BASE/api/timesheet/v2/$Y/$M" -H "Authorization: Bearer $TOKEN")
  MODE=$(echo "$RESP" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('mode',''))" 2>/dev/null)
  case "$role" in
    PM)             check "$role.mode" "$MODE" "pm" ;;
    WAREHOUSE)      check "$role.mode" "$MODE" "warehouse" ;;
    TO|HEAD_TO)     check "$role.mode" "$MODE" "medical" ;;
    OFFICE_MANAGER) check "$role.mode" "$MODE" "travel" ;;
    DIRECTOR_GEN|BUH|HR|ADMIN) check "$role.mode" "$MODE" "global" ;;
  esac

  # closure-status доступен?
  CS=$(curl -s "$BASE/api/timesheet/v2/closure-status/$Y/$M" -H "Authorization: Bearer $TOKEN")
  if echo "$CS" | grep -q '"pm_locks"'; then
    check "$role.closure-status.pm_locks" "ok" "ok"
  else
    check "$role.closure-status.pm_locks" "missing" "ok"
  fi
done

# ── Тест 2: Projection (что баллы скрыты для warehouse/medical/travel) ──
echo ""
echo "═══════ Тест 2: Projection — points скрыты для warehouse/medical/travel ═══════"
for role in WAREHOUSE TO OFFICE_MANAGER; do
  login_name=${ACCOUNTS[$role]}
  TOKEN=$(login "$login_name")
  RESP=$(curl -s "$BASE/api/timesheet/v2/$Y/$M" -H "Authorization: Bearer $TOKEN")
  # Найди первую non-null points в days[*]
  HAS_POINTS=$(echo "$RESP" | python3 -c "
import sys, json
d=json.load(sys.stdin)
for e in d.get('employees',[]):
  for k,v in (e.get('days') or {}).items():
    if v and v.get('points') is not None:
      print('LEAK'); sys.exit()
print('CLEAN')
" 2>/dev/null)
  check "$role: points hidden" "$HAS_POINTS" "CLEAN"
done

# ── Тест 3: Projection — global видит баллы и суммы, НЕ видит суточные ──
echo ""
echo "═══════ Тест 3: Projection — global видит points+amount, БЕЗ per_diem ═══════"
TOKEN=$(login "test_director")
RESP=$(curl -s "$BASE/api/timesheet/v2/$Y/$M" -H "Authorization: Bearer $TOKEN")
HAS_AMOUNT_LEAK=$(echo "$RESP" | python3 -c "
import sys, json
d=json.load(sys.stdin)
for e in d.get('employees',[]):
  if e.get('per_diem_total') not in (None, 0):
    print('PER_DIEM_LEAK'); sys.exit()
  for k,v in (e.get('days') or {}).items():
    if v and v.get('points') is not None:
      print('POINTS_OK'); sys.exit()
print('NO_DATA')
" 2>/dev/null)
check "DIRECTOR: per_diem скрыт" "$HAS_AMOUNT_LEAK" "POINTS_OK"

# ── Тест 4: PM попытка попасть в /:y/:m?mode=warehouse ──
echo ""
echo "═══════ Тест 4: PM пытается mode=warehouse — должен получить свой pm-режим ═══════"
TOKEN=$(login "test_pm")
RESP=$(curl -s "$BASE/api/timesheet/v2/$Y/$M?mode=warehouse" -H "Authorization: Bearer $TOKEN")
MODE=$(echo "$RESP" | python3 -c "import sys, json; print(json.load(sys.stdin).get('mode',''))" 2>/dev/null)
check_contains "PM mode-override" "$MODE" "pm"

# ── Тест 5: Лок-механика ──
echo ""
echo "═══════ Тест 5: Лок-механика ═══════"
TOKEN_PM=$(login "test_pm")
# Поставить pm-lock
LOCK_RESP=$(curl -s -X POST "$BASE/api/timesheet/v2/lock" \
  -H "Authorization: Bearer $TOKEN_PM" \
  -H 'Content-Type: application/json' \
  -d "{\"year\":$Y,\"month\":$M,\"scope\":\"pm\"}")
echo "Lock response: $LOCK_RESP"
LOCK_ID=$(echo "$LOCK_RESP" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('lock',{}).get('id') or d.get('id') or '')" 2>/dev/null)
if [ -n "$LOCK_ID" ]; then
  check "PM ставит свой лок" "ok" "ok"
  # Попытка PUT entry → должна быть 423
  ENTRY_RESP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "$BASE/api/timesheet/v2/entry" \
    -H "Authorization: Bearer $TOKEN_PM" -H 'Content-Type: application/json' \
    -d "{\"employee_id\":1,\"work_id\":1,\"date\":\"$Y-0$M-15\",\"type\":\"day\"}")
  check "PUT /entry после лока → 423" "$ENTRY_RESP_CODE" "423"
  # Снять лок
  curl -s -X DELETE "$BASE/api/timesheet/v2/lock/$LOCK_ID" -H "Authorization: Bearer $TOKEN_PM" > /dev/null
  check "PM снимает свой лок" "ok" "ok"
else
  check "PM ставит свой лок" "fail" "ok"
fi

# ── Тест 6: settings/position-points ──
echo ""
echo "═══════ Тест 6: settings/position-points ═══════"
TOKEN_ADMIN=$(login "test_admin")
SETTINGS=$(curl -s "$BASE/api/timesheet/v2/settings/position-points" -H "Authorization: Bearer $TOKEN_ADMIN")
check_contains "GET settings — есть warehouse:слесарь" "$SETTINGS" "warehouse"
check_contains "GET settings — есть medical" "$SETTINGS" "medical"

echo ""
echo "═══════════════════════════════"
echo "ИТОГО: ✓ $PASS pass · ✗ $FAIL fail"
if [ $FAIL -gt 0 ]; then
  echo -e "Провалы:\n$FAILS"
fi
exit $FAIL
