#!/usr/bin/env python3
"""Hotfix: full public/m deploy — missing chunk 404s caused black screen."""
import io
import sys
import tarfile
import tempfile
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
ROOT = Path(__file__).resolve().parents[1]
PROJECT = "/var/www/asgard-crm"
M_DIR = ROOT / "public" / "m"

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(
    "92.242.61.184",
    username="root",
    pkey=paramiko.Ed25519Key.from_private_key_file(str(KEY)),
    timeout=30,
)
sftp = c.open_sftp()


def run(cmd, timeout=120):
    print("====", cmd[:200])
    _, o, e = c.exec_command(cmd, timeout=timeout)
    print(o.read().decode("utf-8", "replace")[-4000:])
    err = e.read().decode("utf-8", "replace").strip()
    if err:
        print("STDERR:", err[:1200])


# tar entire public/m
tmp_tar = Path(tempfile.gettempdir()) / "asgard_m_full_81.tar"
with tarfile.open(tmp_tar, "w") as tar:
    tar.add(M_DIR, arcname="m")
print("TAR", tmp_tar, tmp_tar.stat().st_size)

sftp.put(str(tmp_tar), "/tmp/asgard_m_full_81.tar")
print("UPLOADED tar")

# also bump shell already 20.27.81 — bump to 20.27.82 so SW refreshes
for rel in ["public/sw.js", "public/index.html"]:
    # bump version in local files first
    pass

run(
    f"cd {PROJECT}/public && "
    "cp -a m m.bak-blackscreen-$(date +%H%M%S) && "
    "rm -rf m && tar -xf /tmp/asgard_m_full_81.tar && "
    "test -f m/assets/react-DKh5dO4J.js && test -f m/assets/index-CZLG-TCl.js && "
    "ls m/assets | wc -l"
)

# verify chunks
run(
    "cd /var/www/asgard-crm/public/m/assets && "
    "for f in react-DKh5dO4J.js jsx-runtime-CSTR0bc3.js dist-DNghQTdv.js react-B3TyAT-L.js index-CZLG-TCl.js; "
    "do if [ -f \"$f\" ]; then echo OK $f; else echo MISSING $f; fi; done"
)

# soft bump cache via app_updates already 81 — touch sw is enough if we bump
# bump to 82 so clients reload
sw = ROOT / "public" / "sw.js"
html = ROOT / "public" / "index.html"
sw.write_text(sw.read_text(encoding="utf-8").replace("20.27.81", "20.27.82"), encoding="utf-8")
html.write_text(html.read_text(encoding="utf-8").replace("20.27.81", "20.27.82"), encoding="utf-8")
sftp.put(str(sw), f"{PROJECT}/public/sw.js")
sftp.put(str(html), f"{PROJECT}/public/index.html")
print("OK sw+index 20.27.82")

sql = """INSERT INTO app_updates (version, title, changes, target) VALUES (
  '20.27.82',
  'Фикс чёрного экрана',
  '[{"icon":"🩹","text":"Восстановлены JS-файлы приложения — чёрный экран после обновления"}]'::jsonb,
  'field'
) ON CONFLICT (version) DO UPDATE SET title = EXCLUDED.title, changes = EXCLUDED.changes, published_at = NOW();"""
tmp = ROOT / "tools" / "_tmp_u82.sql"
tmp.write_text(sql, encoding="utf-8")
sftp.put(str(tmp), "/tmp/u82.sql")
run("PGPASSWORD=123456789 psql -U asgard -d asgard_crm -f /tmp/u82.sql")
run("systemctl restart asgard-crm && sleep 3 && curl -sS http://127.0.0.1:3000/api/version")
run(
    "curl -sS -o /dev/null -w '%{http_code}\\n' http://127.0.0.1:3000/m/assets/react-DKh5dO4J.js; "
    "curl -sS -o /dev/null -w '%{http_code}\\n' http://127.0.0.1:3000/m/assets/dist-DNghQTdv.js"
)

sftp.close()
c.close()
tmp_tar.unlink(missing_ok=True)
tmp.unlink(missing_ok=True)
print("DONE")
