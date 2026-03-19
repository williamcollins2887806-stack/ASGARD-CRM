import paramiko
import time
import socket

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('92.242.61.184', username='root', pkey=key, timeout=15)

def run(cmd, timeout=15):
    try:
        stdin, stdout, stderr = c.exec_command(cmd, timeout=timeout)
        out = stdout.read().decode().strip()
        err = stderr.read().decode().strip()
        return out, err
    except (socket.timeout, TimeoutError) as e:
        return f"TIMEOUT ({timeout}s)", str(e)

# Step 1: Generate JWT token
token, err = run("cd /var/www/asgard-crm && node -e 'const jwt=require(\"jsonwebtoken\"); console.log(jwt.sign({id:1,role:\"ADMIN\"},\"asgard-jwt-secret-2026\",{expiresIn:\"1h\"}))'")
print(f"Token: {token[:30]}... (len={len(token)})")
if not token or token.startswith("TIMEOUT"):
    print(f"Token error: {err}")
    c.close()
    exit(1)

tests = [
    ("TEST 1: HTTP/1.1 no gzip (baseline)",
     f'curl -s -o /dev/null -w "status=%{{http_code}} size=%{{size_download}} time=%{{time_total}}s" -H "Authorization: Bearer {token}" -H "Accept-Encoding: identity" https://localhost/api/telephony/calls?limit=5 -k'),

    ("TEST 2: HTTP/1.1 WITH gzip",
     f'curl -s -o /dev/null -w "status=%{{http_code}} size=%{{size_download}} time=%{{time_total}}s" --compressed -H "Authorization: Bearer {token}" https://localhost/api/telephony/calls?limit=5 -k'),

    ("TEST 3: HTTP/2 no gzip",
     f'curl -s -o /dev/null -w "status=%{{http_code}} size=%{{size_download}} time=%{{time_total}}s" --http2 -H "Authorization: Bearer {token}" -H "Accept-Encoding: identity" https://localhost/api/telephony/calls?limit=5 -k'),

    ("TEST 4: HTTP/2 WITH gzip (10s timeout)",
     f'timeout 10 curl -s -o /dev/null -w "status=%{{http_code}} size=%{{size_download}} time=%{{time_total}}s" --http2 --compressed -H "Authorization: Bearer {token}" https://localhost/api/telephony/calls?limit=5 -k || echo "CURL_TIMED_OUT_OR_FAILED"'),

    ("TEST 5: HTTP/2 gzip body check",
     f'timeout 10 curl -s --http2 --compressed -H "Authorization: Bearer {token}" https://localhost/api/telephony/calls?limit=5 -k | head -c 300 || echo "FAILED"'),

    ("TEST 6: HTTP/1.1 gzip body check",
     f'timeout 10 curl -s --compressed -H "Authorization: Bearer {token}" https://localhost/api/telephony/calls?limit=5 -k | head -c 300 || echo "FAILED"'),

    ("TEST 7: HTTP/1.1 no gzip body check",
     f'curl -s -H "Authorization: Bearer {token}" -H "Accept-Encoding: identity" https://localhost/api/telephony/calls?limit=5 -k | head -c 300'),

    ("TEST 8: Nginx gzip config",
     "grep -rn 'gzip' /etc/nginx/nginx.conf /etc/nginx/sites-enabled/ 2>/dev/null | head -30"),

    ("TEST 9: Nginx version",
     "nginx -v 2>&1"),

    ("TEST 10: Response headers HTTP/1.1 no gzip",
     f'curl -sI -H "Authorization: Bearer {token}" -H "Accept-Encoding: identity" https://localhost/api/telephony/calls?limit=5 -k'),

    ("TEST 11: Response headers HTTP/1.1 gzip",
     f'curl -sI --compressed -H "Authorization: Bearer {token}" https://localhost/api/telephony/calls?limit=5 -k'),

    ("TEST 12: Response headers HTTP/2 no gzip",
     f'curl -sI --http2 -H "Authorization: Bearer {token}" -H "Accept-Encoding: identity" https://localhost/api/telephony/calls?limit=5 -k'),

    ("TEST 13: Check Fastify compression plugin",
     "grep -rn 'compress' /var/www/asgard-crm/src/server.js /var/www/asgard-crm/src/app.js 2>/dev/null | head -10"),

    ("TEST 14: Check nginx proxy_pass / upstream config",
     "grep -A5 'proxy_pass\|upstream' /etc/nginx/sites-enabled/asgard-crm 2>/dev/null | head -30"),

    ("TEST 15: Curl version (HTTP/2 support check)",
     "curl --version | head -3"),

    ("TEST 16: Check Content-Encoding header from upstream (Fastify) directly",
     f'curl -sI -H "Authorization: Bearer {token}" http://localhost:3000/api/telephony/calls?limit=5 2>/dev/null || echo "Cannot reach Fastify directly"'),

    ("TEST 17: Fastify direct body (no nginx, no gzip)",
     f'curl -s -H "Authorization: Bearer {token}" http://localhost:3000/api/telephony/calls?limit=5 2>/dev/null | head -c 300 || echo "Cannot reach Fastify directly"'),

    ("TEST 18: Recent Fastify errors",
     "journalctl -u asgard-crm --since '2 minutes ago' --no-pager 2>/dev/null | grep -iE 'error|ERR|premature|stream' | tail -10"),
]

for name, cmd in tests:
    print(f"\n=== {name} ===")
    out, err = run(cmd, timeout=20)
    result = out if out else f"(empty stdout, stderr: {err[:200]})"
    print(result)

c.close()
print("\n=== ALL TESTS COMPLETE ===")
