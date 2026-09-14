#!/usr/bin/env python3
"""20.27.80: после SMS нельзя в приложение без PIN; API режет NEED_PIN_SETUP."""
import io
import sys
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
ROOT = Path(__file__).resolve().parents[1]
PROJECT = "/var/www/asgard-crm"

FILES = [
    "src/index.js",
    "public/sw.js",
    "public/index.html",
    "public/m/index.html",
]
for p in sorted((ROOT / "public/m/assets").glob("index-*")):
    FILES.append(p.relative_to(ROOT).as_posix())
# chunk с динамическим import fieldAuthStore
for p in sorted((ROOT / "public/m/assets").glob("fieldAuthStore-*")):
    FILES.append(p.relative_to(ROOT).as_posix())

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(
    "92.242.61.184",
    username="root",
    pkey=paramiko.Ed25519Key.from_private_key_file(str(KEY)),
    timeout=30,
)
sftp = c.open_sftp()


def run(cmd, timeout=90):
    print("====", cmd[:200])
    _, o, e = c.exec_command(cmd, timeout=timeout)
    print(o.read().decode("utf-8", "replace")[-5000:])
    err = e.read().decode("utf-8", "replace").strip()
    if err:
        print("STDERR:", err[:1500])


for rel in FILES:
    local = ROOT / rel
    if not local.is_file():
        print("SKIP missing", rel)
        continue
    remote = f"{PROJECT}/{rel}"
    # ensure assets dir
    if "/" in rel:
        parent = "/".join(remote.split("/")[:-1])
        run(f"mkdir -p {parent}")
    sftp.put(str(local), remote)
    print("OK", rel)

sql = """INSERT INTO app_updates (version, title, changes, target) VALUES (
  '20.27.80',
  'PIN обязателен после SMS',
  '[{"icon":"🔒","text":"После SMS всегда создание или ввод PIN — в приложение без PIN нельзя"},{"icon":"🛡️","text":"API блокирует Field без созданного PIN"}]'::jsonb,
  'field'
) ON CONFLICT (version) DO UPDATE SET title = EXCLUDED.title, changes = EXCLUDED.changes, published_at = NOW();"""
tmp = ROOT / "tools" / "_tmp_u80.sql"
tmp.write_text(sql, encoding="utf-8")
sftp.put(str(tmp), "/tmp/u80.sql")
run("PGPASSWORD=123456789 psql -U asgard -d asgard_crm -f /tmp/u80.sql")

# Сбросить сессии Трухина (320), чтобы прошёл новый поток
run(
    "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "
    "\"DELETE FROM field_sessions WHERE employee_id = 320; "
    "UPDATE users SET pin_hash = NULL WHERE id = (SELECT user_id FROM employees WHERE id = 320);\""
)

run(
    "systemctl restart asgard-crm && sleep 2 && "
    "systemctl is-active asgard-crm && curl -sS http://127.0.0.1:3000/api/version"
)
run("grep -o 'index-[^\"]*\\.js' /var/www/asgard-crm/public/m/index.html | head -1")
run("grep -n NEED_PIN_SETUP /var/www/asgard-crm/src/index.js | head -3")

sftp.close()
c.close()
tmp.unlink(missing_ok=True)
print("DONE")
