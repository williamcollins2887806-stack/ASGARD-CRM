import paramiko
import time
import socket

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')

def fresh_connection():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect('92.242.61.184', username='root', pkey=key, timeout=15)
    return c

def run_safe(c, cmd, timeout=15):
    try:
        stdin, stdout, stderr = c.exec_command(cmd, timeout=timeout)
        out = stdout.read().decode().strip()
        err = stderr.read().decode().strip()
        return out, err, True
    except Exception as e:
        return "", str(e), False

# === BATCH 1: Nginx config, Fastify compression, curl version ===
print("=== BATCH 1: Server configuration ===\n")
c = fresh_connection()

token, _, _ = run_safe(c, "cd /var/www/asgard-crm && node -e 'const jwt=require(\"jsonwebtoken\"); console.log(jwt.sign({id:1,role:\"ADMIN\"},\"asgard-jwt-secret-2026\",{expiresIn:\"1h\"}))'")
print(f"Token: {token[:30]}... (len={len(token)})")

print("\n--- Nginx gzip config ---")
out, _, _ = run_safe(c, "grep -rn 'gzip' /etc/nginx/nginx.conf /etc/nginx/sites-enabled/ 2>/dev/null | head -40")
print(out or "(none)")

print("\n--- Nginx version ---")
out, err, _ = run_safe(c, "nginx -v 2>&1")
print(out or err)

print("\n--- Nginx site config (full) ---")
out, _, _ = run_safe(c, "cat /etc/nginx/sites-enabled/asgard-crm 2>/dev/null | head -80")
print(out or "(not found)")

print("\n--- Fastify compression plugin ---")
out, _, _ = run_safe(c, "grep -rn 'compress' /var/www/asgard-crm/src/server.js /var/www/asgard-crm/src/app.js 2>/dev/null")
print(out or "(no compression in Fastify)")

print("\n--- Fastify package.json compression deps ---")
out, _, _ = run_safe(c, "grep -i 'compress' /var/www/asgard-crm/package.json 2>/dev/null")
print(out or "(none)")

print("\n--- Curl version ---")
out, _, _ = run_safe(c, "curl --version | head -3")
print(out)

c.close()

# === BATCH 2: Response headers (these are safe) ===
print("\n\n=== BATCH 2: Response headers ===\n")
c = fresh_connection()

# Re-gen token
token, _, _ = run_safe(c, "cd /var/www/asgard-crm && node -e 'const jwt=require(\"jsonwebtoken\"); console.log(jwt.sign({id:1,role:\"ADMIN\"},\"asgard-jwt-secret-2026\",{expiresIn:\"1h\"}))'")

print("--- Headers: HTTP/1.1 no gzip ---")
out, _, _ = run_safe(c, f'curl -sI -H "Authorization: Bearer {token}" -H "Accept-Encoding: identity" https://localhost/api/telephony/calls?limit=5 -k')
print(out)

print("\n--- Headers: HTTP/1.1 WITH Accept-Encoding: gzip ---")
out, _, _ = run_safe(c, f'curl -sI -H "Authorization: Bearer {token}" -H "Accept-Encoding: gzip" https://localhost/api/telephony/calls?limit=5 -k')
print(out)

print("\n--- Headers: HTTP/2 no gzip ---")
out, _, _ = run_safe(c, f'curl -sI --http2 -H "Authorization: Bearer {token}" -H "Accept-Encoding: identity" https://localhost/api/telephony/calls?limit=5 -k')
print(out)

c.close()

# === BATCH 3: Fastify direct (bypass nginx) ===
print("\n\n=== BATCH 3: Direct Fastify (bypass nginx) ===\n")
c = fresh_connection()

token, _, _ = run_safe(c, "cd /var/www/asgard-crm && node -e 'const jwt=require(\"jsonwebtoken\"); console.log(jwt.sign({id:1,role:\"ADMIN\"},\"asgard-jwt-secret-2026\",{expiresIn:\"1h\"}))'")

print("--- Fastify direct: headers ---")
out, _, _ = run_safe(c, f'curl -sI -H "Authorization: Bearer {token}" http://localhost:3000/api/telephony/calls?limit=5 2>/dev/null || echo "Port 3000 unreachable"')
print(out or "(empty)")

print("\n--- Fastify direct: body (first 300 chars) ---")
out, _, _ = run_safe(c, f'curl -s -H "Authorization: Bearer {token}" http://localhost:3000/api/telephony/calls?limit=5 2>/dev/null | head -c 300 || echo "Port 3000 unreachable"')
print(out or "(empty)")

print("\n--- Fastify port check ---")
out, _, _ = run_safe(c, "ss -tlnp | grep -E '3000|node'")
print(out or "(no Fastify on 3000)")

print("\n--- Recent Fastify errors ---")
out, _, _ = run_safe(c, "journalctl -u asgard-crm --since '5 minutes ago' --no-pager 2>/dev/null | tail -20")
print(out or "(none)")

c.close()

# === BATCH 4: Test whether nginx is double-compressing ===
print("\n\n=== BATCH 4: Double compression test ===\n")
c = fresh_connection()

token, _, _ = run_safe(c, "cd /var/www/asgard-crm && node -e 'const jwt=require(\"jsonwebtoken\"); console.log(jwt.sign({id:1,role:\"ADMIN\"},\"asgard-jwt-secret-2026\",{expiresIn:\"1h\"}))'")

# Save raw gzip response without --compressed (don't decompress)
print("--- Raw gzip response (no decompression) ---")
out, _, _ = run_safe(c, f'curl -s -H "Authorization: Bearer {token}" -H "Accept-Encoding: gzip" https://localhost/api/telephony/calls?limit=5 -k -o /tmp/gzip_test.bin && file /tmp/gzip_test.bin && wc -c /tmp/gzip_test.bin && xxd /tmp/gzip_test.bin | head -5')
print(out)

# Try manual gunzip
print("\n--- Manual gunzip attempt ---")
out, _, _ = run_safe(c, "cp /tmp/gzip_test.bin /tmp/gzip_test.gz && gunzip -f /tmp/gzip_test.gz 2>&1 && echo 'SUCCESS: gunzip worked' && head -c 300 /tmp/gzip_test || echo 'FAILED: not valid gzip'")
print(out)

# Check transfer-encoding vs content-encoding
print("\n--- Full verbose curl (HTTP/1.1 gzip, 5s max) ---")
out, _, _ = run_safe(c, f'timeout 5 curl -v -H "Authorization: Bearer {token}" -H "Accept-Encoding: gzip" https://localhost/api/telephony/calls?limit=5 -k -o /dev/null 2>&1 | head -40')
print(out)

# Cleanup
run_safe(c, "rm -f /tmp/gzip_test.bin /tmp/gzip_test.gz /tmp/gzip_test")

c.close()
print("\n=== ALL DIAGNOSTIC TESTS COMPLETE ===")
