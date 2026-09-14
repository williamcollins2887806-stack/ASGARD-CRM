#!/usr/bin/env python3
"""Extract which users hit 500/client-errors in last 48h from prod journal."""
import io
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
KEY = Path.home() / ".ssh" / "asgard_crm_deploy"


def main():
    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect("92.242.61.184", username="root", pkey=key, timeout=30)

    # Refresh 48h log if missing/stale
    cmd = r'''
set -e
if [ ! -f /tmp/asgard_48h.log ] || [ $(( $(date +%s) - $(stat -c %Y /tmp/asgard_48h.log) )) -gt 600 ]; then
  since=$(date -u -d '48 hours ago' '+%Y-%m-%d %H:%M:%S')
  journalctl -u asgard-crm --since "$since" --no-pager > /tmp/asgard_48h.log
fi
wc -l /tmp/asgard_48h.log

python3 <<'PY'
import re, json, collections
from pathlib import Path

lines = Path('/tmp/asgard_48h.log').read_text(encoding='utf-8', errors='replace').splitlines()

# Fastify often logs auth user in separate lines; also JWT decode isn't in access log.
# Strategy:
# 1) Join reqId -> url/method/status
# 2) Capture user_id / field_employee_id from any line with same reqId
# 3) For 500 DatabaseError lines near reqId
# 4) Parse [client-error] JSON-ish logs

req = {}  # rid -> dict
for i, line in enumerate(lines):
    m = re.search(r'"reqId":"([^"]+)"', line)
    if not m:
        continue
    rid = m.group(1)
    slot = req.setdefault(rid, {'i': i})
    if '"req"' in line:
        um = re.search(r'"url":"([^"]+)"', line)
        mm = re.search(r'"method":"([^"]+)"', line)
        if um: slot['url'] = um.group(1)
        if mm: slot['method'] = mm.group(1)
        tm = re.search(r'"time":(\d+)', line)
        if tm: slot['time'] = int(tm.group(1))
    if '"res"' in line:
        sm = re.search(r'"statusCode":(\d+)', line)
        if sm: slot['status'] = int(sm.group(1))
    for key in ('user_id', 'field_employee_id', 'employee_id'):
        km = re.search(rf'"{key}":(\d+|null)', line)
        if km and km.group(1) != 'null':
            slot[key] = int(km.group(1))
    # sometimes nested user object
    um = re.search(r'"user":\{[^}]*"id":(\d+)', line)
    if um:
        slot['user_id'] = int(um.group(1))

# Attach level:50 errors by proximity (same second / nearby lines with same pid)
err_by_near = []
for i, line in enumerate(lines):
    if '"level":50' not in line and 'DatabaseError' not in line:
        continue
    msg = ''
    em = re.search(r'"message":"([^"]+)"', line)
    if em: msg = em.group(1)
    ridm = re.search(r'"reqId":"([^"]+)"', line)
    rid = ridm.group(1) if ridm else None
    if not rid:
        # look back/forward 5 lines for reqId
        for j in range(max(0,i-5), min(len(lines), i+6)):
            rm = re.search(r'"reqId":"([^"]+)"', lines[j])
            if rm:
                rid = rm.group(1)
                break
    err_by_near.append((rid, msg, line[:240]))

print('=== API 4xx/5xx with identity (joined) ===')
by_user = collections.Counter()
by_field = collections.Counter()
samples = collections.defaultdict(list)
for rid, slot in req.items():
    st = slot.get('status')
    if not st or st < 400:
        continue
    url = slot.get('url','')
    # skip scanners
    if re.search(r'(@fs|/etc/passwd|secrets\.json|firebase|graphql|/proxy|/fetch|/config\.json)', url):
        continue
    uid = slot.get('user_id')
    fe = slot.get('field_employee_id')
    base = re.sub(r'/\d+', '/:id', url.split('?',1)[0])
    key = (st, slot.get('method','?'), base)
    if uid:
        by_user[(uid, st, base)] += 1
    if fe:
        by_field[(fe, st, base)] += 1
    if st >= 500 or base in (
        '/api/tenders','/api/office-academy/lessons','/api/staff/reviews/bulk',
        '/api/staff/planned-engagements/bulk','/api/field/worker/active-project'
    ) or 'brigade' in base or 'mlsp' in base:
        samples[key].append({'rid': rid, 'uid': uid, 'fe': fe, 'url': url})

print('\nTop desktop user_id x status x path:')
for (uid, st, base), n in by_user.most_common(40):
    print(f'  n={n:4d}  user_id={uid}  {st}  {base}')

print('\nTop field_employee_id x status x path:')
for (fe, st, base), n in by_field.most_common(40):
    print(f'  n={n:4d}  field_emp={fe}  {st}  {base}')

print('\nInteresting samples (500 / academy / tenders / brigade):')
for key, lst in list(samples.items())[:30]:
    st, method, base = key
    if st < 500 and 'academy' not in base and 'tenders' not in base and 'reviews' not in base and 'planned' not in base and 'brigade' not in base:
        continue
    uids = sorted({x['uid'] for x in lst if x['uid']})
    fes = sorted({x['fe'] for x in lst if x['fe']})
    print(f'  {len(lst):4d}x  {st} {method} {base}  users={uids or "-"}  field={fes or "-"}')

print('\n=== level50 / DatabaseError messages ===')
msgc = collections.Counter()
for rid, msg, _ in err_by_near:
    msgc[msg or '(no message)'] += 1
for msg, n in msgc.most_common(20):
    print(f'  n={n:3d}  {msg}')

print('\n=== [client-error] by user / field emp ===')
ce_user = collections.Counter()
ce_field = collections.Counter()
ce_msg = collections.Counter()
ce_samples = []
for line in lines:
    if '[client-error]' not in line:
        continue
    # try parse JSON after node prefix
    jstart = line.find('{')
    payload = {}
    if jstart >= 0:
        try:
            payload = json.loads(line[jstart:])
        except Exception:
            payload = {}
    uid = payload.get('user_id')
    fe = payload.get('field_employee_id')
    msg = payload.get('message') or payload.get('msg') or ''
    # fallback regex
    if uid is None:
        m = re.search(r'"user_id":(\d+)', line)
        if m: uid = int(m.group(1))
    if fe is None:
        m = re.search(r'"field_employee_id":(\d+)', line)
        if m: fe = int(m.group(1))
    if not msg:
        m = re.search(r'"message":"([^"]+)"', line)
        if m: msg = m.group(1)
    if 'deploy-smoke' in str(msg):
        continue
    if '127.0.0.1:5177' in line or 'localhost:5177' in line:
        origin = 'local-vite'
    else:
        origin = 'prod-or-other'
    if uid: ce_user[(uid, msg[:80], origin)] += 1
    if fe: ce_field[(fe, msg[:80], origin)] += 1
    ce_msg[(msg[:100], origin)] += 1
    if len(ce_samples) < 15:
        ce_samples.append({'uid': uid, 'fe': fe, 'msg': msg[:120], 'origin': origin})

print('by user_id:')
for k,n in ce_user.most_common(25):
    print(f'  n={n:3d}  user={k[0]}  [{k[2]}]  {k[1]}')
print('by field_employee_id:')
for k,n in ce_field.most_common(25):
    print(f'  n={n:3d}  emp={k[0]}  [{k[2]}]  {k[1]}')
print('messages:')
for k,n in ce_msg.most_common(20):
    print(f'  n={n:3d}  [{k[1]}]  {k[0]}')

# Resolve user names from DB
print('\n=== Resolve names from DB ===')
ids = sorted({uid for uid,_,_ in by_user.keys()} | {uid for uid,_,_ in ce_user.keys() if uid})
fids = sorted({fe for fe,_,_ in by_field.keys()} | {fe for fe,_,_ in ce_field.keys() if fe})
print('user_ids', ids[:50])
print('field_emp_ids', fids[:50])
PY

# resolve names
python3 <<'PY'
import subprocess, re
from pathlib import Path
text = Path('/tmp/asgard_48h.log').read_text(encoding='utf-8', errors='replace')
uids=set(int(x) for x in re.findall(r'"user_id":(\d+)', text))
fids=set(int(x) for x in re.findall(r'"field_employee_id":(\d+)', text))
# also from client-error only denser - keep all found but query top
print('unique user_id in log', len(uids), 'field', len(fids))
uids_s = ','.join(str(i) for i in sorted(uids)[:200]) or '0'
fids_s = ','.join(str(i) for i in sorted(fids)[:200]) or '0'
sql = f"""
SELECT 'user' AS kind, id, name, role, email FROM users WHERE id IN ({uids_s})
UNION ALL
SELECT 'employee', id, fio, COALESCE(role_tag, position), phone FROM employees WHERE id IN ({fids_s})
ORDER BY 1,2;
"""
import os
r = subprocess.run(['bash','-lc', f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -F $'\\t' -A -c {repr(sql)}"], capture_output=True, text=True)
print(r.stdout[-8000:])
print(r.stderr[-1000:])
PY
'''
    _, o, e = c.exec_command(cmd, timeout=360)
    print(o.read().decode("utf-8", "replace"))
    err = e.read().decode("utf-8", "replace")
    if err.strip():
        print("STDERR:", err[:3000])
    c.close()


if __name__ == "__main__":
    main()
