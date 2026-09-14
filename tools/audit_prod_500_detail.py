#!/usr/bin/env python3
"""Dig into real 500s from /tmp/asgard_48h.log on prod."""
import io
import sys
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
KEY = Path.home() / ".ssh" / "asgard_crm_deploy"


def run(c, cmd, timeout=180):
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    return o.channel.recv_exit_status(), out, err


def main():
    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect("92.242.61.184", username="root", pkey=key, timeout=30)

    cmd = r"""
python3 - <<'PY'
import re, collections
req={}
# map reqId -> (method,url,time)
# map reqId -> status
# capture nearby error lines after 500
lines=open('/tmp/asgard_48h.log',encoding='utf-8',errors='replace').read().splitlines()
info={}
status={}
for i,line in enumerate(lines):
    m=re.search(r'"reqId":"([^"]+)"', line)
    if not m: continue
    rid=m.group(1)
    if '"req"' in line:
        um=re.search(r'"url":"([^"]+)"', line)
        mm=re.search(r'"method":"([^"]+)"', line)
        if um: info[rid]=(mm.group(1) if mm else '?', um.group(1), i)
    if '"res"' in line:
        sm=re.search(r'"statusCode":(\d+)', line)
        if sm: status[rid]=int(sm.group(1))

interesting=['/api/tenders','/api/office-academy','/api/field/worker/active-project','/api/field/worker/timesheet','/api/staff/reviews','planned-engagements','brigade-cart']
print('=== 500 detail samples ===')
shown=collections.Counter()
for rid,code in status.items():
    if code!=500: continue
    method,url,idx=info.get(rid,('?','?',-1))
    base=url.split('?',1)[0]
    key=re.sub(r'/\d+','/:id', base)
    if shown[key]>=3: continue
    # print response line + next 8 non-json noise lines around
    ctx=[]
    for j in range(max(0,idx), min(len(lines), (info.get(rid,(None,None,0))[2])+25)):
        L=lines[j]
        if rid in L or ('error' in L.lower() and j<= (info.get(rid,(None,None,0))[2])+15):
            if '"req"' in L and rid in L: continue
            ctx.append(L[:300])
        if len(ctx)>=4: break
    # also search for error messages near same second without reqId
    print(f'\n[{shown[key]+1}] 500 {method} {url}')
    for c in ctx:
        print('  ', c[:260])
    shown[key]+=1

print('\n=== client-error payloads (field) sample ===')
n=0
for line in lines:
    if '[client-error]' not in line: continue
    # try extract message fields
    for key in ('message','msg','error','stack','endpoint','status','source'):
        pass
    m=re.search(r'"message":"([^"]{0,200})"', line)
    e=re.search(r'"error":"([^"]{0,200})"', line)
    s=re.search(r'"stack":"([^"]{0,200})"', line)
    ep=re.search(r'"endpoint":("[^"]*"|null)', line)
    fe=re.search(r'"field_employee_id":(\d+|null)', line)
    uid=re.search(r'"user_id":(\d+|null)', line)
    print(f"  field_emp={fe.group(1) if fe else '-'} user={uid.group(1) if uid else '-'} endpoint={ep.group(1) if ep else '-'} err={e.group(1) if e else '-'} message={m.group(1) if m else '-'} stack={s.group(1) if s else '-'}")
    n+=1
    if n>=25: break

print('\n=== 500 counts by path (full) ===')
c=collections.Counter()
for rid,code in status.items():
    if code!=500: continue
    method,url,_=info.get(rid,('?','?',0))
    base=re.sub(r'/\d+','/:id', url.split('?',1)[0])
    c[(method,base)]+=1
for k,v in c.most_common(25):
    print(f'  {v:4d}  {k[0]} {k[1]}')
PY
"""
    _, out, err = run(c, cmd, timeout=180)
    print(out)
    if err.strip():
        print("STDERR", err[:1500])
    c.close()


if __name__ == "__main__":
    main()
