#!/usr/bin/env python3
"""Audit prod: missing routes + 48h error logs (desktop + field)."""
import io
import re
import sys
from collections import Counter
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"


def run(c, cmd, timeout=300):
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    return code, out, err


def main():
    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)

    print("=== 1) ROUTE FILE MARKERS ===")
    markers = [
        ("reviews/bulk", "src/routes/staff.js"),
        ("planned-engagements/bulk", "src/routes"),
        ("brigade-cart", "src/routes/brigade-cart.js"),
        ("buildBrigadeWorkbook", "src/lib/brigade-cart-export.js"),
        ("buildMlspPeriodExcel", "src/lib/mlsp-stay-export.js"),
        ("fastify.post('/export'", "src/routes/mlsp-stays.js"),
        ("/crew", "src/routes"),
    ]
    for pat, where in markers:
        code, out, _ = run(
            c,
            f"grep -Rsn --include='*.js' -m 3 {repr(pat)} /var/www/asgard-crm/{where} 2>/dev/null | head -5",
        )
        print(f"\n[{pat}]")
        print(out.strip() or "(not found)")

    print("\n=== 2) HTTP SMOKE (401/400 ok, 404 bad) ===")
    checks = [
        ("POST", "/api/staff/reviews/bulk", "{}"),
        ("POST", "/api/staff/brigade-cart/export", "{}"),
        ("POST", "/api/staff/brigade-cart/permits-export", "{}"),
        ("POST", "/api/staff/brigade-cart/conflicts", "{}"),
        ("GET", "/api/staff/brigade-cart/matrix?employee_ids=1", None),
        ("POST", "/api/staff/mlsp-stays/export", "{}"),
        ("POST", "/api/staff/planned-engagements/bulk", "{}"),
        ("POST", "/api/field/manage/projects/1/crew", "{}"),
    ]
    for method, url, body in checks:
        if method == "GET":
            cmd = f"curl -sS -o /tmp/_chk.json -w '%{{http_code}}' 'http://127.0.0.1:3000{url}'"
        else:
            cmd = (
                f"curl -sS -o /tmp/_chk.json -w '%{{http_code}}' -X {method} "
                f"'http://127.0.0.1:3000{url}' -H 'Content-Type: application/json' -d {repr(body)}"
            )
        _, status, _ = run(c, cmd)
        _, body_out, _ = run(c, "head -c 160 /tmp/_chk.json; echo")
        flag = "OK" if status.strip() not in ("404", "502", "000") else "BAD"
        print(f"{flag} {status.strip()} {method} {url} :: {body_out.strip()}")

    print("\n=== 3) LOGS 48h: statusCode 5xx / error patterns ===")
    # Pull journal for 48h, filter interesting lines to a file on server, then summarize
    cmd = r"""
since=$(date -u -d '48 hours ago' '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date -u -v-48H '+%Y-%m-%d %H:%M:%S')
journalctl -u asgard-crm --since "$since" --no-pager > /tmp/asgard_48h.log 2>/dev/null
wc -l /tmp/asgard_48h.log
echo '--- 5xx counts ---'
grep -oE '"statusCode":[45][0-9]{2}' /tmp/asgard_48h.log | sort | uniq -c | sort -rn | head -20
echo '--- top 5xx URLs ---'
python3 - <<'PY'
import re, collections
path=collections.Counter(); st=collections.Counter(); pairs=collections.Counter()
rx=re.compile(r'"url":"([^"]+)".*?"statusCode":([45]\d{2})|"statusCode":([45]\d{2}).*?"url":"([^"]+)"')
# fastify logs often have req then res separately - join by reqId
req_url={}
req_st={}
with open('/tmp/asgard_48h.log','r',encoding='utf-8',errors='replace') as f:
    for line in f:
        m=re.search(r'"reqId":"([^"]+)"', line)
        if not m: continue
        rid=m.group(1)
        um=re.search(r'"url":"([^"]+)"', line)
        if um and '"req"' in line:
            req_url[rid]=um.group(1)
        sm=re.search(r'"statusCode":(\d+)', line)
        if sm and '"res"' in line:
            code=int(sm.group(1))
            if code>=400:
                url=req_url.get(rid,'?')
                # strip query
                base=url.split('?',1)[0]
                # normalize ids
                base=re.sub(r'/\d+','/:id', base)
                st[code]+=1
                path[base]+=1
                pairs[(code,base)]+=1
print('status totals:')
for k,v in st.most_common(15):
    print(f'  {k}: {v}')
print('top paths:')
for (code,base),v in pairs.most_common(40):
    print(f'  {v:5d}  {code}  {base}')
PY
"""
    _, out, err = run(c, cmd, timeout=360)
    print(out)
    if err.strip():
        print("STDERR:", err[:2000])

    print("\n=== 4) FIELD / DESKTOP ERROR KEYWORDS (48h) ===")
    cmd2 = r"""
python3 - <<'PY'
import re, collections
from pathlib import Path
text=Path('/tmp/asgard_48h.log').read_text(encoding='utf-8',errors='replace')
patterns=[
 ('field_api', r'/api/field[^\s"]*'),
 ('mobile_m', r'/m/|"/api/mobile|/api/worker|/api/field-worker|/api/field/worker'),
 ('brigade', r'brigade-cart|reviews/bulk|planned-engagements'),
 ('mlsp', r'mlsp-stays'),
 ('exception', r'(TypeError|ReferenceError|Unhandled|ECONNREFUSED|error:|Error:|FATAL|exception)'),
]
# count lines with status 5xx and field-ish url via reqId join
req_url={}
field_err=collections.Counter(); desk_err=collections.Counter(); msg_err=collections.Counter()
for line in text.splitlines():
    m=re.search(r'"reqId":"([^"]+)"', line)
    rid=m.group(1) if m else None
    if rid and '"req"' in line:
        um=re.search(r'"url":"([^"]+)"', line)
        if um: req_url[rid]=um.group(1)
    if rid and '"res"' in line:
        sm=re.search(r'"statusCode":(\d+)', line)
        if not sm: continue
        code=int(sm.group(1))
        if code<400: continue
        url=req_url.get(rid,'')
        base=re.sub(r'/\d+','/:id', url.split('?',1)[0])
        is_field = bool(re.search(r'/api/field|/api/worker|/api/field-worker|/m/|/api/mobile|/api/checkin|/api/timesheet', url, re.I))
        bucket = field_err if is_field else desk_err
        bucket[(code, base)] += 1
    # free-text errors
    if re.search(r'(TypeError|ReferenceError|UnhandledPromise|ECONNREFUSED|\berror\b.*failed)', line, re.I):
        # skip noisy IMAP/OCR unless severe
        low=line.lower()
        if 'imap-ai' in low or 'tenderocr' in low or 'mailer-daemon' in low:
            continue
        snippet=re.sub(r'\s+',' ', line)[-180:]
        msg_err[snippet]+=1

print('FIELD-ish 4xx/5xx top:')
for (code,base),v in field_err.most_common(30):
    print(f'  {v:5d}  {code}  {base}')
print('\nDESKTOP-ish 4xx/5xx top:')
for (code,base),v in desk_err.most_common(35):
    print(f'  {v:5d}  {code}  {base}')
print('\nNotable exception lines (deduped, non-IMAP/OCR):')
for snip,v in msg_err.most_common(25):
    print(f'  x{v}  {snip}')
PY
"""
    _, out2, err2 = run(c, cmd2, timeout=360)
    print(out2)
    if err2.strip():
        print("STDERR:", err2[:2000])

    # specifically look for reviews/bulk and planned-engagements 404s
    print("\n=== 5) BRIGADE-RELATED FAILURES ===")
    _, out3, _ = run(
        c,
        r"""grep -E 'brigade-cart|reviews/bulk|planned-engagements/bulk|mlsp-stays/export' /tmp/asgard_48h.log | grep -E 'statusCode.:(4|5)' | tail -40""",
    )
    print(out3.strip() or "(none matching in same line)")
    # better: python join
    _, out4, _ = run(
        c,
        r"""
python3 - <<'PY'
import re
req_url={}
hits=[]
with open('/tmp/asgard_48h.log',encoding='utf-8',errors='replace') as f:
  for line in f:
    m=re.search(r'"reqId":"([^"]+)"', line)
    if not m: continue
    rid=m.group(1)
    if '"req"' in line:
      um=re.search(r'"url":"([^"]+)"', line)
      mm=re.search(r'"method":"([^"]+)"', line)
      if um: req_url[rid]=(mm.group(1) if mm else '?', um.group(1))
    if '"res"' in line:
      sm=re.search(r'"statusCode":(\d+)', line)
      tm=re.search(r'"time":(\d+)', line)
      if not sm: continue
      code=int(sm.group(1))
      if code<400: continue
      method,url=req_url.get(rid,('?','?'))
      if re.search(r'brigade-cart|reviews/bulk|planned-engagements|mlsp-stays', url):
        hits.append((code, method, url, tm.group(1) if tm else ''))
print(f'hits={len(hits)}')
from collections import Counter
c=Counter((h[0],h[1],re.sub(r'/\\d+','/:id',h[2].split('?',1)[0])) for h in hits)
for k,v in c.most_common(30):
  print(v, k)
PY
""",
    )
    print(out4)

    c.close()


if __name__ == "__main__":
    main()
