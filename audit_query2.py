import paramiko
import sys

def get_client():
    key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect('92.242.61.184', username='root', pkey=key, timeout=15)
    return c

def run_cmd(client, cmd, timeout=20):
    try:
        stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
        out = stdout.read().decode().strip()
        err = stderr.read().decode().strip()
        return out, err
    except Exception as e:
        return "", str(e)

# ---- Get JWT token ----
client = get_client()

token_cmd = 'cd /var/www/asgard-crm && node -e "const jwt = require(\'jsonwebtoken\'); console.log(jwt.sign({id:1,role:\'ADMIN\',login:\'admin\'}, \'asgard-jwt-secret-2026\', {expiresIn:\'1h\'}))"'
token, terr = run_cmd(client, token_cmd, 10)
if not token:
    print(f"TOKEN ERROR: {terr}")
    sys.exit(1)

print("=" * 70)
print("ASGARD CRM - API ENDPOINT TESTS (localhost:3000)")
print("=" * 70)
print(f"\nJWT Token: {token[:50]}...\n")

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

print(f"  {'ENDPOINT':40s} {'STATUS':>6s} {'SIZE':>10s} {'TIME':>8s}")
print(f"  {'-'*40} {'-'*6} {'-'*10} {'-'*8}")

# Test endpoints one by one, reconnecting if needed
for ep in endpoints:
    curl_cmd = (
        f'curl -s -o /dev/null -w "%{{http_code}}|%{{size_download}}|%{{time_total}}" '
        f'-H "Authorization: Bearer {token}" '
        f'--max-time 8 '
        f'"http://127.0.0.1:3000{ep}"'
    )
    try:
        out, err = run_cmd(client, curl_cmd, 15)
    except:
        # Reconnect on failure
        try:
            client.close()
        except:
            pass
        client = get_client()
        out, err = run_cmd(client, curl_cmd, 15)

    if '|' in out:
        parts = out.split('|')
        status, size, time_s = parts[0], parts[1], parts[2]
        mark = "OK" if status.startswith("2") else "WARN" if status.startswith("3") else "FAIL"
        print(f"  {ep:40s} {status:>6s} {size:>8s} B {time_s:>7s}s  {mark}")
    else:
        print(f"  {ep:40s}  ERROR: {out} {err}")

# ---- Additional: roles and service status ----
print("\n--- ACTIVE USERS BY ROLE ---\n")
role_cmd = '''PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -A -F '|' -c "SELECT role, COUNT(*) FROM users WHERE is_active=true GROUP BY role ORDER BY count DESC;"'''
out, _ = run_cmd(client, role_cmd, 10)
for line in out.split('\n'):
    if '|' in line:
        parts = line.strip().split('|')
        print(f"  {parts[0]:25s} {parts[1]:>4s}")

print("\n--- SERVICE STATUS ---\n")
out, _ = run_cmd(client, "systemctl is-active asgard-crm && systemctl show asgard-crm --property=ActiveEnterTimestamp", 10)
for line in out.split('\n'):
    print(f"  {line}")

print("\n--- SERVER GIT STATUS ---\n")
out, _ = run_cmd(client, "cd /var/www/asgard-crm && git log --oneline -3 && echo '---' && git branch --show-current", 10)
for line in out.split('\n'):
    print(f"  {line}")

client.close()
print("\n" + "=" * 70)
print("AUDIT COMPLETE")
print("=" * 70)
