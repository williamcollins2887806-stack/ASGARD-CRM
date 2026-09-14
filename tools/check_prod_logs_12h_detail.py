#!/usr/bin/env python3
import re, sys
from collections import Counter
from pathlib import Path
import paramiko

sys.stdout.reconfigure(encoding='utf-8')
KEY = Path.home() / '.ssh' / 'asgard_crm_deploy'
key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c = paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('92.242.61.184', username='root', pkey=key, timeout=30)
_, o, _ = c.exec_command('journalctl -u asgard-crm --since "12 hours ago" --no-pager', timeout=300)
lines = o.read().decode('utf-8','replace').splitlines()

# pair request/response by reqId
pending = {}
fourxx = Counter()
director = []

for line in lines:
    rid_m = re.search(r'"reqId":"([^"]+)"', line)
    if not rid_m:
        continue
    rid = rid_m.group(1)
    if 'incoming request' in line:
        url_m = re.search(r'"url":"([^"]+)"', line)
        meth_m = re.search(r'"method":"([^"]+)"', line)
        pending[rid] = (meth_m.group(1) if meth_m else '?', url_m.group(1) if url_m else '?')
    if '"res":' in line and '"statusCode":' in line:
        code_m = re.search(r'"statusCode":(\d+)', line)
        if not code_m:
            continue
        code = int(code_m.group(1))
        meth, url = pending.get(rid, ('?', '?'))
        if code >= 400:
            fourxx[(code, meth, url)] += 1
        if 'director-review' in url or 'rp-review' in url:
            director.append((code, meth, url, line[-80:]))

print('=== 4xx по URL (топ-20) ===')
for (code, meth, url), cnt in fourxx.most_common(20):
    print(f'{code} {meth} x{cnt}: {url}')

from collections import Counter as C2
dir_stats = C2()
for code, meth, url, _ in director:
    if 'director-review' in url:
        dir_stats[code] += 1
print('\n=== director-review статусы ===')
print(dict(dir_stats) if dir_stats else '(нет запросов)')

print('\n=== director-review / rp-review (все) ===')
if director:
    for item in director[:25]:
        print(item)
else:
    print('(нет)')

# check restart at 04:49
_, o2, _ = c.exec_command('journalctl -u asgard-crm --since "12 hours ago" --no-pager | grep -iE "Started ASGARD|Stopped ASGARD|Main process|systemd\\[1\\]" | head -20')
print('\n=== События systemd (старт/стоп) ===')
print(o2.read().decode('utf-8','replace').strip() or '(нет явных stop/start)')
c.close()
