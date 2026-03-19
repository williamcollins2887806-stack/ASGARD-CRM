import paramiko
import sys

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('92.242.61.184', username='root', pkey=key, timeout=15)

print("=" * 60)
print("ASGARD CRM — MOBILE AUDIT DATA COUNTS")
print("=" * 60)

# 1. SQL entity counts
print("\n--- DATABASE ENTITY COUNTS ---\n")

sql_queries = [
    ("works", "SELECT COUNT(*) FROM works"),
    ("tenders", "SELECT COUNT(*) FROM tenders"),
    ("employees", "SELECT COUNT(*) FROM employees"),
    ("cash_requests", "SELECT COUNT(*) FROM cash_requests"),
    ("tasks", "SELECT COUNT(*) FROM tasks"),
    ("invoices", "SELECT COUNT(*) FROM invoices"),
    ("customers", "SELECT COUNT(*) FROM customers"),
    ("contracts", "SELECT COUNT(*) FROM contracts"),
    ("users", "SELECT COUNT(*) FROM users"),
    ("acts", "SELECT COUNT(*) FROM acts"),
    ("tkp", "SELECT COUNT(*) FROM tkp"),
    ("worker_profiles", "SELECT COUNT(*) FROM worker_profiles"),
    ("pass_requests", "SELECT COUNT(*) FROM pass_requests"),
]

combined_sql = " UNION ALL ".join(
    [f"SELECT '{name}' as entity, COUNT(*)::text as cnt FROM {name}" for name, _ in sql_queries]
)

cmd_sql = f'''PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -A -F '|' -c "{combined_sql} ORDER BY entity;"'''
stdin, stdout, stderr = client.exec_command(cmd_sql, timeout=15)
out = stdout.read().decode().strip()
err = stderr.read().decode().strip()
if err:
    print(f"SQL STDERR: {err}")

entity_counts = {}
for line in out.split('\n'):
    if '|' in line:
        parts = line.strip().split('|')
        entity_counts[parts[0]] = parts[1]
        print(f"  {parts[0]:20s} {parts[1]:>8s}")

# 2. API endpoint tests
print("\n--- API ENDPOINT TESTS (localhost:3000) ---\n")

token_cmd = '''cd /var/www/asgard-crm && node -e "const jwt = require('jsonwebtoken'); console.log(jwt.sign({id:1,role:'ADMIN',login:'admin'}, 'asgard-jwt-secret-2026', {expiresIn:'1h'}))"'''
stdin, stdout, stderr = client.exec_command(token_cmd, timeout=10)
token = stdout.read().decode().strip()
terr = stderr.read().decode().strip()
if not token:
    print(f"TOKEN ERROR: {terr}")
    client.close()
    sys.exit(1)
print(f"  JWT Token: {token[:40]}...")

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
    "/api/mimir/health",
    "/api/warehouse",
    "/api/calendar/events",
]

# Build a single script to test all endpoints at once
curl_lines = []
for ep in endpoints:
    curl_lines.append(
        f'echo -n "{ep}|"; curl -s -o /dev/null -w "%{{http_code}}|%{{size_download}}|%{{time_total}}" '
        f'-H "Authorization: Bearer {token}" "http://127.0.0.1:3000{ep}"; echo'
    )

full_cmd = " && ".join(curl_lines)
stdin, stdout, stderr = client.exec_command(full_cmd, timeout=30)
api_out = stdout.read().decode().strip()
api_err = stderr.read().decode().strip()

print(f"\n  {'ENDPOINT':40s} {'STATUS':>6s} {'SIZE':>10s} {'TIME':>8s}")
print(f"  {'-'*40} {'-'*6} {'-'*10} {'-'*8}")

for line in api_out.split('\n'):
    if '|' in line:
        parts = line.strip().split('|')
        if len(parts) >= 4:
            ep, status, size, time_s = parts[0], parts[1], parts[2], parts[3]
            status_mark = "OK" if status.startswith("2") else "!!"
            print(f"  {ep:40s} {status:>6s} {size:>8s} B {time_s:>7s}s  {status_mark}")

# 3. Additional info: active users by role
print("\n--- ACTIVE USERS BY ROLE ---\n")
role_cmd = '''PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -A -F '|' -c "SELECT role, COUNT(*) FROM users WHERE is_active=true GROUP BY role ORDER BY count DESC;"'''
stdin, stdout, stderr = client.exec_command(role_cmd, timeout=10)
role_out = stdout.read().decode().strip()
for line in role_out.split('\n'):
    if '|' in line:
        parts = line.strip().split('|')
        print(f"  {parts[0]:25s} {parts[1]:>4s}")

# 4. App service status
print("\n--- SERVICE STATUS ---\n")
stdin, stdout, stderr = client.exec_command("systemctl is-active asgard-crm && systemctl show asgard-crm --property=ActiveEnterTimestamp", timeout=10)
svc_out = stdout.read().decode().strip()
print(f"  {svc_out}")

# 5. Git status on server
print("\n--- SERVER GIT STATUS ---\n")
stdin, stdout, stderr = client.exec_command("cd /var/www/asgard-crm && git log --oneline -3 && echo '---' && git branch --show-current", timeout=10)
git_out = stdout.read().decode().strip()
print(f"  {git_out}")

client.close()
print("\n" + "=" * 60)
print("AUDIT COMPLETE")
print("=" * 60)
