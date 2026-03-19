import paramiko
import time

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('92.242.61.184', username='root', pkey=key, timeout=15)

def run(cmd, timeout=30):
    stdin, stdout, stderr = c.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    return out, err

# Step 1: Generate JWT token - run from project dir so node_modules is available
token, err = run("cd /var/www/asgard-crm && node -e 'const jwt=require(\"jsonwebtoken\"); console.log(jwt.sign({id:1,role:\"ADMIN\"},\"asgard-jwt-secret-2026\",{expiresIn:\"1h\"}))'")
print(f"Token: {token[:30]}... (len={len(token)})")
if not token:
    print(f"Token error: {err}")
    c.close()
    exit(1)

# Step 2: Run all gzip/HTTP2 tests
print("\n=== TEST 1: HTTP/1.1 without gzip (baseline) ===")
out, err = run(f'curl -s -o /dev/null -w "status=%{{http_code}} size=%{{size_download}} time=%{{time_total}}s" -H "Authorization: Bearer {token}" -H "Accept-Encoding: identity" https://localhost/api/telephony/calls?limit=5 -k')
print(out)

print("\n=== TEST 2: HTTP/1.1 WITH gzip ===")
out, err = run(f'curl -s -o /dev/null -w "status=%{{http_code}} size=%{{size_download}} time=%{{time_total}}s" --compressed -H "Authorization: Bearer {token}" https://localhost/api/telephony/calls?limit=5 -k')
print(out)

print("\n=== TEST 3: HTTP/2 without gzip ===")
out, err = run(f'curl -s -o /dev/null -w "status=%{{http_code}} size=%{{size_download}} time=%{{time_total}}s" --http2 -H "Authorization: Bearer {token}" -H "Accept-Encoding: identity" https://localhost/api/telephony/calls?limit=5 -k')
print(out)

print("\n=== TEST 4: HTTP/2 WITH gzip ===")
out, err = run(f'curl -s -o /dev/null -w "status=%{{http_code}} size=%{{size_download}} time=%{{time_total}}s" --http2 --compressed -H "Authorization: Bearer {token}" https://localhost/api/telephony/calls?limit=5 -k')
print(out)

print("\n=== TEST 5: HTTP/2 gzip body (first 500 chars) ===")
out, err = run(f'curl -s --http2 --compressed -H "Authorization: Bearer {token}" https://localhost/api/telephony/calls?limit=5 -k | head -c 500')
print(out if out else f"EMPTY BODY (err: {err[:200]})")

print("\n=== TEST 6: HTTP/1.1 gzip body (first 500 chars) ===")
out, err = run(f'curl -s --compressed -H "Authorization: Bearer {token}" https://localhost/api/telephony/calls?limit=5 -k | head -c 500')
print(out if out else f"EMPTY BODY (err: {err[:200]})")

print("\n=== TEST 7: Nginx gzip config ===")
out, err = run("grep -rn 'gzip' /etc/nginx/nginx.conf /etc/nginx/sites-enabled/ 2>/dev/null | head -30")
print(out if out else "(no gzip config found)")

print("\n=== TEST 8: Nginx version ===")
out, err = run("nginx -v 2>&1")
print(out or err)

print("\n=== TEST 9: Response headers HTTP/2 gzip ===")
out, err = run(f'curl -sI --http2 --compressed -H "Authorization: Bearer {token}" https://localhost/api/telephony/calls?limit=5 -k')
print(out)

print("\n=== TEST 10: Response headers HTTP/1.1 gzip ===")
out, err = run(f'curl -sI --compressed -H "Authorization: Bearer {token}" https://localhost/api/telephony/calls?limit=5 -k')
print(out)

print("\n=== TEST 11: Concurrent HTTP/2+gzip (5 requests) ===")
run(f"cat > /tmp/concurrent_test.sh << 'CEOF'\n#!/bin/bash\nTOKEN=\"$1\"\nfor i in 1 2 3 4 5; do\n  curl -s -o /dev/null -w \"req$i: status=%{{http_code}} size=%{{size_download}}bytes time=%{{time_total}}s\n\" --http2 --compressed -H \"Authorization: Bearer $TOKEN\" \"https://localhost/api/telephony/calls?limit=5\" -k &\ndone\nwait\nCEOF\nchmod +x /tmp/concurrent_test.sh")
out, err = run(f"bash /tmp/concurrent_test.sh '{token}'", timeout=30)
print(out)

print("\n=== TEST 12: Sequential body size check (5 requests) ===")
run(f"cat > /tmp/seq_body.sh << 'SEOF'\n#!/bin/bash\nTOKEN=\"$1\"\nfor i in 1 2 3 4 5; do\n  SIZE=$(curl -s --http2 --compressed -H \"Authorization: Bearer $TOKEN\" \"https://localhost/api/telephony/calls?limit=5\" -k | wc -c)\n  echo \"req$i: body_size=${{SIZE}}bytes\"\ndone\nSEOF\nchmod +x /tmp/seq_body.sh")
out, err = run(f"bash /tmp/seq_body.sh '{token}'", timeout=45)
print(out)

time.sleep(2)

print("\n=== TEST 13: Fastify premature close errors ===")
out, err = run("journalctl -u asgard-crm --since '60 seconds ago' --no-pager 2>/dev/null | grep -iE 'premature|stream closed|ERR_HTTP2|error' | tail -10")
print(out if out else "(none)")

print("\n=== TEST 14: Check if Fastify has compression plugin ===")
out, err = run("grep -rn 'compress' /var/www/asgard-crm/src/server.js /var/www/asgard-crm/src/app.js 2>/dev/null | head -10")
print(out if out else "(no compression in Fastify)")

print("\n=== TEST 15: Response dump HTTP/2 gzip ===")
out, err = run(f'curl -s -D- --http2 --compressed -H "Authorization: Bearer {token}" https://localhost/api/telephony/calls?limit=5 -k | head -c 800')
print(out)

# Cleanup
run("rm -f /tmp/concurrent_test.sh /tmp/seq_body.sh")

c.close()
print("\nDone.")
