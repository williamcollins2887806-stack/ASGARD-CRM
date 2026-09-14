#!/usr/bin/env python3
"""20.27.81: SMS XOR PIN — после SMS не просим PIN; устройство с PIN → только PIN."""
import io
import sys
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
ROOT = Path(__file__).resolve().parents[1]
PROJECT = "/var/www/asgard-crm"

FILES = [
    "src/routes/field-auth.js",
    "public/sw.js",
    "public/index.html",
    "public/m/index.html",
]
for p in sorted((ROOT / "public/m/assets").glob("index-*")):
    FILES.append(p.relative_to(ROOT).as_posix())
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
    print("====", cmd[:220])
    _, o, e = c.exec_command(cmd, timeout=timeout)
    print(o.read().decode("utf-8", "replace")[-5000:])
    err = e.read().decode("utf-8", "replace").strip()
    if err:
        print("STDERR:", err[:1500])


run(f"mkdir -p {PROJECT}/public/m/assets")

for rel in FILES:
    local = ROOT / rel
    if not local.is_file():
        print("SKIP missing", rel)
        continue
    sftp.put(str(local), f"{PROJECT}/{rel}")
    print("OK", rel)

sql = """INSERT INTO app_updates (version, title, changes, target) VALUES (
  '20.27.81',
  'Вход: SMS или PIN, не оба',
  '[{"icon":"🔑","text":"На этом устройстве после создания PIN — только PIN, без SMS"},{"icon":"📱","text":"SMS только первый раз или если забыли PIN"},{"icon":"✅","text":"После SMS с уже созданным PIN сразу в приложение"}]'::jsonb,
  'field'
) ON CONFLICT (version) DO UPDATE SET title = EXCLUDED.title, changes = EXCLUDED.changes, published_at = NOW();"""
tmp = ROOT / "tools" / "_tmp_u81.sql"
tmp.write_text(sql, encoding="utf-8")
sftp.put(str(tmp), "/tmp/u81.sql")
run("PGPASSWORD=123456789 psql -U asgard -d asgard_crm -f /tmp/u81.sql")

# НЕ трогаем сессии/PIN — иначе снова заставят SMS
run(
    "systemctl restart asgard-crm && sleep 4 && "
    "systemctl is-active asgard-crm && curl -sS http://127.0.0.1:3000/api/version"
)
run("grep -o 'index-[^\"]*\\.js' /var/www/asgard-crm/public/m/index.html | head -1")
run("grep -n \"authenticated\\|need_pin_setup\\|need_pin\" /var/www/asgard-crm/src/routes/field-auth.js | head -20")

sftp.close()
c.close()
tmp.unlink(missing_ok=True)
print("DONE")
