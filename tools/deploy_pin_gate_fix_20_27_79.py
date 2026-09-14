#!/usr/bin/env python3
import hashlib, io, sys
from pathlib import Path
import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
ROOT = Path(__file__).resolve().parents[1]
PROJECT = "/var/www/asgard-crm"

FILES = [
    "public/sw.js",
    "public/index.html",
    "public/m/index.html",
]
for p in (ROOT / "public/m/assets").glob("index-*"):
    FILES.append(p.relative_to(ROOT).as_posix())
for name in ["PersonalKanbanConfig-CChkicNX.js", "DirectorsInbox-pJMWDxfX.js",
             "PersonalKanban-BFQzU0XA.js", "PersonalKanbanV3-yRwb-zbZ.js"]:
    rel = f"public/m/assets/{name}"
    if (ROOT / rel).exists():
        FILES.append(rel)

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("92.242.61.184", username="root",
          pkey=paramiko.Ed25519Key.from_private_key_file(str(KEY)), timeout=30)
sftp = c.open_sftp()

def run(cmd):
    print("====", cmd[:160])
    _, o, e = c.exec_command(cmd, timeout=60)
    print(o.read().decode("utf-8", "replace")[-4000:])
    err = e.read().decode("utf-8", "replace").strip()
    if err: print("STDERR:", err[:1000])

for rel in FILES:
    local = ROOT / rel
    if not local.is_file():
        continue
    remote = f"{PROJECT}/{rel}"
    sftp.put(str(local), remote)
    print("OK", rel)

sql = """INSERT INTO app_updates (version, title, changes, target) VALUES (
  '20.27.79',
  'Фикс: PIN только после создания',
  '[{"icon":"🔧","text":"Если PIN ещё не создан — сначала SMS, потом создание PIN"}]'::jsonb,
  'field'
) ON CONFLICT (version) DO UPDATE SET title = EXCLUDED.title, changes = EXCLUDED.changes, published_at = NOW();"""
Path("/tmp").joinpath("u.sql")  # noop for windows
tmp = ROOT / "tools" / "_tmp_u79.sql"
tmp.write_text(sql, encoding="utf-8")
sftp.put(str(tmp), "/tmp/u79.sql")
run("PGPASSWORD=123456789 psql -U asgard -d asgard_crm -f /tmp/u79.sql")
run("systemctl restart asgard-crm && sleep 2 && systemctl is-active asgard-crm && curl -sS http://127.0.0.1:3000/api/version")
run("grep -o 'index-[^\"]*\\.js' /var/www/asgard-crm/public/m/index.html | head -1")
sftp.close(); c.close()
tmp.unlink(missing_ok=True)
print("DONE")
