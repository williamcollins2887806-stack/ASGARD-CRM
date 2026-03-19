import paramiko
import sys
import time

KEY_PATH = 'C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy'

def fresh_client():
    key = paramiko.Ed25519Key.from_private_key_file(KEY_PATH)
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect('92.242.61.184', username='root', pkey=key, timeout=15,
              banner_timeout=15, auth_timeout=15)
    return c

def run_cmd(cmd, timeout=20, retries=2):
    for attempt in range(retries):
        client = None
        try:
            client = fresh_client()
            stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
            out = stdout.read().decode().strip()
            err = stderr.read().decode().strip()
            client.close()
            return out, err
        except Exception as e:
            if client:
                try: client.close()
                except: pass
            if attempt < retries - 1:
                time.sleep(1)
            else:
                return "", str(e)

# ---- Get JWT token ----
token_cmd = 'cd /var/www/asgard-crm && node -e "const jwt = require(\'jsonwebtoken\'); console.log(jwt.sign({id:1,role:\'ADMIN\',login:\'admin\'}, \'asgard-jwt-secret-2026\', {expiresIn:\'1h\'}))"'
token, terr = run_cmd(token_cmd, 10)
if not token:
    print(f"TOKEN ERROR: {terr}")
    sys.exit(1)

print("=" * 70)
print("ASGARD CRM - MOBILE AUDIT REPORT")
print("=" * 70)

# ---- DB counts (fresh connection) ----
print("\n--- DATABASE ENTITY COUNTS ---\n")

sql = """SELECT 'works' as e, COUNT(*)::text FROM works
UNION ALL SELECT 'tenders', COUNT(*)::text FROM tenders
UNION ALL SELECT 'employees', COUNT(*)::text FROM employees
UNION ALL SELECT 'cash_requests', COUNT(*)::text FROM cash_requests
UNION ALL SELECT 'tasks', COUNT(*)::text FROM tasks
UNION ALL SELECT 'invoices', COUNT(*)::text FROM invoices
UNION ALL SELECT 'customers', COUNT(*)::text FROM customers
UNION ALL SELECT 'contracts', COUNT(*)::text FROM contracts
UNION ALL SELECT 'acts', COUNT(*)::text FROM acts
UNION ALL SELECT 'tkp', COUNT(*)::text FROM tkp
UNION ALL SELECT 'users', COUNT(*)::text FROM users
UNION ALL SELECT 'worker_profiles', COUNT(*)::text FROM worker_profiles
UNION ALL SELECT 'pass_requests', COUNT(*)::text FROM pass_requests
ORDER BY e;"""

out, err = run_cmd(f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -A -F '|' -c \"{sql}\"", 15)
for line in out.split('\n'):
    if '|' in line:
        parts = line.strip().split('|')
        print(f"  {parts[0]:20s} {parts[1]:>8s}")

# ---- API tests: each on a FRESH SSH connection ----
print(f"\nJWT: {token[:40]}...\n")
print(f"  {'ENDPOINT':40s} {'STATUS':>6s} {'SIZE':>10s} {'TIME':>8s}")
print(f"  {'-'*40} {'-'*6} {'-'*10} {'-'*8}")

endpoints = [
    "/api/works",
    "/api/tenders",
    "/api/employees",
    "/api/cash",
    "/api/tasks",
    "/api/invoices",
    "/api/customers",
    "/api/contracts",
    "/api/acts",
    "/api/tkp",
    "/api/users",
    "/api/pass-requests",
    "/api/dashboard/stats",
    "/api/hints?page=dashboard",
    "/api/warehouse",
    "/api/calendar/events",
]

for ep in endpoints:
    curl_cmd = (
        f'curl -s -o /dev/null -w "%{{http_code}}|%{{size_download}}|%{{time_total}}" '
        f'-H "Authorization: Bearer {token}" '
        f'--max-time 8 '
        f'"http://127.0.0.1:3000{ep}"'
    )
    out, err = run_cmd(curl_cmd, 15)
    
    if out and '|' in out:
        parts = out.split('|')
        status, size, time_s = parts[0], parts[1], parts[2]
        mark = "OK" if status.startswith("2") else "WARN" if status.startswith("3") else "FAIL"
        print(f"  {ep:40s} {status:>6s} {size:>8s} B {time_s:>7s}s  {mark}")
    else:
        print(f"  {ep:40s}  ERROR: {err[:60] if err else 'no response'}")
    
    time.sleep(0.3)  # small delay between connections

# ---- Roles ----
print("\n--- ACTIVE USERS BY ROLE ---\n")
out, _ = run_cmd("PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -A -F '|' -c \"SELECT role, COUNT(*) FROM users WHERE is_active=true GROUP BY role ORDER BY count DESC;\"", 10)
for line in out.split('\n'):
    if '|' in line:
        p = line.strip().split('|')
        print(f"  {p[0]:25s} {p[1]:>4s}")

# ---- Service ----
print("\n--- SERVICE STATUS ---\n")
out, _ = run_cmd("systemctl is-active asgard-crm && systemctl show asgard-crm --property=ActiveEnterTimestamp", 10)
for line in out.split('\n'):
    print(f"  {line}")

# ---- Git ----
print("\n--- SERVER GIT ---\n")
out, _ = run_cmd("cd /var/www/asgard-crm && git log --oneline -3 && echo '---branch---' && git branch --show-current", 10)
for line in out.split('\n'):
    print(f"  {line}")

print("\n" + "=" * 70)
print("AUDIT COMPLETE")
print("=" * 70)
