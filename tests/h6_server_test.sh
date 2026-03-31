#!/bin/bash
# H6 E2E Test — runs entirely on server
set -e
BASE="http://localhost:3000"
PASS=0
TOTAL=10

echo "============================================================"
echo "H6 E2E API TEST — Estimate Chat Pipeline"
echo "============================================================"

# Login test_pm
echo -e "\n[1] Login test_pm..."
PM_PRE=$(curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"login":"test_pm","password":"Test123!"}' $BASE/api/auth/login)
PM_TOKEN=$(echo "$PM_PRE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('token',''))" 2>/dev/null)
PM_FULL=$(curl -s -X POST -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $PM_TOKEN" \
  -d '{"pin":"0000"}' $BASE/api/auth/verify-pin)
PM_TOKEN=$(echo "$PM_FULL" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('token',''))" 2>/dev/null)
echo "  PM token: ${PM_TOKEN:0:20}..."

# Login test_director_gen
echo -e "\n[2] Login test_director_gen..."
DIR_PRE=$(curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"login":"test_director_gen","password":"Test123!"}' $BASE/api/auth/login)
DIR_TOKEN=$(echo "$DIR_PRE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('token',''))" 2>/dev/null)
DIR_FULL=$(curl -s -X POST -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $DIR_TOKEN" \
  -d '{"pin":"0000"}' $BASE/api/auth/verify-pin)
DIR_TOKEN=$(echo "$DIR_FULL" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('token',''))" 2>/dev/null)
echo "  DIR token: ${DIR_TOKEN:0:20}..."

# Create estimate
echo -e "\n[3] Creating estimate..."
EST_RESP=$(curl -s -X POST -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $PM_TOKEN" \
  -d '{"title":"H6 E2E Test","work_type":"CHEM","crew_count":4,"work_days":10,"object_city":"Kemerovo","object_distance_km":2400}' \
  $BASE/api/estimates)
EST_ID=$(echo "$EST_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('estimate',{}).get('id') or d.get('id',''))" 2>/dev/null)
echo "  Estimate ID: $EST_ID"
echo "  Response: ${EST_RESP:0:100}"

if [ -z "$EST_ID" ] || [ "$EST_ID" = "None" ]; then
  echo "ABORT: no estimate created"
  exit 1
fi

# Auto-calculate
echo -e "\n[4] Auto-calculating..."
CALC=$(curl -s -X POST -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $PM_TOKEN" \
  -d '{}' $BASE/api/estimates/$EST_ID/auto-calculate)
echo "  Calc: ${CALC:0:80}"

# Send for approval
echo -e "\n[5] Sending for approval..."
SEND=$(curl -s -X POST -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $PM_TOKEN" \
  -d '{}' $BASE/api/approval/estimates/$EST_ID/send)
echo "  Send: ${SEND:0:120}"

sleep 2

# Director rework
echo -e "\n[6] Director rework..."
REWORK=$(curl -s -X POST -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $DIR_TOKEN" \
  -d '{"comment":"Increase crew to 6, add welder"}' \
  $BASE/api/approval/estimates/$EST_ID/rework)
echo "  Rework: ${REWORK:0:100}"

# Wait for Mimir
echo -e "\n[7] Waiting 6s for Mimir..."
sleep 6

# PM resubmit
echo -e "\n[8] PM resubmit..."
RESUB=$(curl -s -X POST -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $PM_TOKEN" \
  -d '{}' $BASE/api/approval/estimates/$EST_ID/resubmit)
echo "  Resubmit: ${RESUB:0:100}"

sleep 1

# Director approve
echo -e "\n[9] Director approve..."
APPROVE=$(curl -s -X POST -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $DIR_TOKEN" \
  -d '{"comment":"Approved, lets go"}' \
  $BASE/api/approval/estimates/$EST_ID/approve)
echo "  Approve: ${APPROVE:0:100}"

sleep 2

echo -e "\n============================================================"
echo "VERIFICATION TESTS"
echo "============================================================"

# Test 1: Estimate status
EST_CHK=$(curl -s -H "Authorization: Bearer $PM_TOKEN" $BASE/api/estimates/$EST_ID)
STATUS=$(echo "$EST_CHK" | python3 -c "import sys,json; d=json.load(sys.stdin); e=d.get('estimate',d); print(e.get('approval_status',e.get('status','?')))" 2>/dev/null)
if [ "$STATUS" = "approved" ]; then echo "  # 1 PASS - status=approved"; PASS=$((PASS+1)); else echo "  # 1 FAIL - status=$STATUS"; fi

# Test 2: Chat exists
CHAT_CHK=$(curl -s -H "Authorization: Bearer $PM_TOKEN" "$BASE/api/chat-groups/by-entity?type=estimate&id=$EST_ID")
CHAT_ID=$(echo "$CHAT_CHK" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('chat',{}).get('id') or d.get('chatId') or d.get('id',''))" 2>/dev/null)
if [ -n "$CHAT_ID" ] && [ "$CHAT_ID" != "None" ] && [ "$CHAT_ID" != "" ]; then
  echo "  # 2 PASS - chat_id=$CHAT_ID"; PASS=$((PASS+1))
else
  echo "  # 2 FAIL - no chat found (resp: ${CHAT_CHK:0:100})"
  echo "ABORT: no chat"
  # Cleanup
  PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "DELETE FROM estimate_calculation_data WHERE estimate_id=$EST_ID; DELETE FROM approval_comments WHERE entity_type='estimates' AND entity_id=$EST_ID; DELETE FROM estimates WHERE id=$EST_ID;"
  exit 0
fi

# Test 3: Messages count
MSGS_CHK=$(curl -s -H "Authorization: Bearer $PM_TOKEN" $BASE/api/chat-groups/$CHAT_ID/messages)
MSG_COUNT=$(echo "$MSGS_CHK" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('messages',[])))" 2>/dev/null)
if [ "$MSG_COUNT" -ge 6 ] 2>/dev/null; then echo "  # 3 PASS - msg_count=$MSG_COUNT"; PASS=$((PASS+1)); else echo "  # 3 FAIL - msg_count=$MSG_COUNT"; fi

# Tests 4-10: Python analysis
echo "$MSGS_CHK" | python3 -c "
import sys, json
data = json.load(sys.stdin)
msgs = data.get('messages', [])
passed = 0

def get_meta(m):
    meta = m.get('metadata', {})
    if isinstance(meta, str):
        try: return json.loads(meta)
        except: return {}
    return meta or {}

# 4: estimate_card
cards = [m for m in msgs if m.get('message_type') == 'estimate_card']
t4 = len(cards) > 0
meta4 = get_meta(cards[0]) if cards else {}
if t4: print(f'  # 4 PASS - estimate_card (estimate_id={meta4.get(\"estimate_id\",\"?\")})')
else: print('  # 4 FAIL - no estimate_card')
passed += int(t4)

# 5: system message
sys_msgs = [m for m in msgs if m.get('message_type') == 'system']
t5 = any('отправил' in (m.get('message','') or '').lower() for m in sys_msgs) or any('send' in (m.get('message','') or '').lower() for m in sys_msgs) or len(sys_msgs) > 0
if t5: print(f'  # 5 PASS - system msgs={len(sys_msgs)}')
else: print(f'  # 5 FAIL - system msgs={len(sys_msgs)}')
passed += int(t5)

# 6: rework comment
rework_msgs = [m for m in msgs if get_meta(m).get('approval_action') == 'rework']
t6 = len(rework_msgs) > 0
if t6: print(f'  # 6 PASS - rework msgs={len(rework_msgs)} text={rework_msgs[0].get(\"message\",\"\")[:40]}')
else: print(f'  # 6 FAIL - no rework msg')
passed += int(t6)

# 7: mimir
mimir_msgs = [m for m in msgs if m.get('message_type') == 'mimir_response']
t7 = len(mimir_msgs) > 0
if t7: print(f'  # 7 PASS - mimir msgs={len(mimir_msgs)}')
else: print(f'  # 7 FAIL - no mimir response')
passed += int(t7)

# 8: approve comment
approve_msgs = [m for m in msgs if get_meta(m).get('approval_action') == 'approve']
t8 = len(approve_msgs) > 0
if t8: print(f'  # 8 PASS - approve msgs={len(approve_msgs)}')
else: print(f'  # 8 FAIL - no approve msg')
passed += int(t8)

print(f'SUBPASS={passed}')
" 2>/dev/null

# Extract subpass
SUBPASS=$(echo "$MSGS_CHK" | python3 -c "
import sys, json
data = json.load(sys.stdin)
msgs = data.get('messages', [])
def get_meta(m):
    meta = m.get('metadata', {})
    if isinstance(meta, str):
        try: return json.loads(meta)
        except: return {}
    return meta or {}
p = 0
p += int(len([m for m in msgs if m.get('message_type') == 'estimate_card']) > 0)
sys_msgs = [m for m in msgs if m.get('message_type') == 'system']
p += int(len(sys_msgs) > 0)
p += int(len([m for m in msgs if get_meta(m).get('approval_action') == 'rework']) > 0)
p += int(len([m for m in msgs if m.get('message_type') == 'mimir_response']) > 0)
p += int(len([m for m in msgs if get_meta(m).get('approval_action') == 'approve']) > 0)
print(p)
" 2>/dev/null)
PASS=$((PASS + SUBPASS))

# Test 9: approval_comments
COMMENTS=$(curl -s -H "Authorization: Bearer $PM_TOKEN" $BASE/api/approval/estimates/$EST_ID/comments)
CCOUNT=$(echo "$COMMENTS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('comments',[])))" 2>/dev/null)
if [ "$CCOUNT" -ge 3 ] 2>/dev/null; then echo "  # 9 PASS - comments=$CCOUNT"; PASS=$((PASS+1)); else echo "  # 9 FAIL - comments=$CCOUNT"; fi

# Test 10: bidirectional links
LINKED=$(echo "$COMMENTS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len([c for c in d.get('comments',[]) if c.get('chat_message_id')]))" 2>/dev/null)
if [ "$LINKED" -ge 1 ] 2>/dev/null; then echo "  #10 PASS - linked=$LINKED"; PASS=$((PASS+1)); else echo "  #10 FAIL - linked=$LINKED"; fi

echo ""
echo "============================================================"
echo "RESULTS: $PASS/$TOTAL passed"
echo "============================================================"

# Save results
echo "{\"passed\":$PASS,\"total\":$TOTAL,\"estimate_id\":$EST_ID,\"chat_id\":$CHAT_ID,\"msg_count\":$MSG_COUNT}" > /tmp/h6_results.json
echo "Results saved to /tmp/h6_results.json"

# Cleanup
echo -e "\n[10] Cleaning up..."
PGPASSWORD=123456789 psql -U asgard -d asgard_crm <<EOSQL
DO \$\$
DECLARE v_est_id int := $EST_ID;
        v_chat_id int;
BEGIN
  SELECT id INTO v_chat_id FROM chats WHERE entity_type='estimate' AND entity_id=v_est_id;
  IF v_chat_id IS NOT NULL THEN
    DELETE FROM mimir_auto_log WHERE chat_id=v_chat_id;
    DELETE FROM chat_messages WHERE chat_id=v_chat_id;
    DELETE FROM chat_group_members WHERE chat_id=v_chat_id;
    DELETE FROM pinned_messages WHERE chat_id=v_chat_id;
    DELETE FROM chats WHERE id=v_chat_id;
  END IF;
  DELETE FROM mimir_auto_log WHERE estimate_id=v_est_id;
  DELETE FROM estimate_calculation_data WHERE estimate_id=v_est_id;
  DELETE FROM approval_comments WHERE entity_type='estimates' AND entity_id=v_est_id;
  DELETE FROM estimates WHERE id=v_est_id;
END \$\$;
EOSQL
echo "Cleanup done!"
