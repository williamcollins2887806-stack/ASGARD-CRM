#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy shop 3D crash fix: public/m + shell bump 20.27.97."""
import io
import sys
import tarfile
import tempfile
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
ROOT = Path(__file__).resolve().parents[1]
PROJECT = "/var/www/asgard-crm"
VERSION = "20.27.97"

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username="root", pkey=paramiko.Ed25519Key.from_private_key_file(str(KEY)), timeout=30)
sftp = c.open_sftp()


def run(cmd, timeout=180):
    print("====", cmd[:220])
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", "replace")
    err = e.read().decode("utf-8", "replace")
    if out.strip():
        print(out[-6000:] if len(out) > 6000 else out)
    if err.strip():
        print("STDERR:", err[:2000])
    return out


# 1) snapshot
run(
    f"mkdir -p /root/snapshots && "
    f"tar czf /root/snapshots/asgard-crm-pre-deploy-shop3d-$(date +%Y%m%d-%H%M%S).tar.gz "
    f"-C {PROJECT} public/m/index.html public/sw.js public/index.html "
    f"$(ls {PROJECT}/public/m/assets/index-*.js 2>/dev/null | head -3 | sed 's|{PROJECT}/||') "
    f"2>/dev/null; ls -lt /root/snapshots | head -3"
)

# 2) tar local public/m
tmp_tar = Path(tempfile.gettempdir()) / "asgard_m_shop3d_97.tar"
with tarfile.open(tmp_tar, "w") as tar:
    tar.add(ROOT / "public" / "m", arcname="m")
print("TAR", tmp_tar, tmp_tar.stat().st_size)
sftp.put(str(tmp_tar), "/tmp/asgard_m_shop3d_97.tar")
print("UPLOADED m tar")

# 3) also upload sw + index
sftp.put(str(ROOT / "public" / "sw.js"), f"{PROJECT}/public/sw.js")
sftp.put(str(ROOT / "public" / "index.html"), f"{PROJECT}/public/index.html")
print("UPLOADED sw+index")

# 4) extract m with backup
run(
    f"cd {PROJECT}/public && "
    "cp -a m m.bak-shop3d-$(date +%H%M%S) && "
    "rm -rf m && tar -xf /tmp/asgard_m_shop3d_97.tar && "
    "test -f m/index.html && test -f m/assets/index-DSot7Pm7.js && "
    "test -f m/assets/avatars/ranks/rank_druzhina.glb && "
    "grep -o 'index-[^\"]*\\.js' m/index.html | head -1 && "
    "ls m/assets | wc -l && "
    "grep -c '\\[VikingAvatar3D\\] render' m/assets/index-DSot7Pm7.js"
)

# 5) app_updates for field clients
sql = f"""
INSERT INTO app_updates (version, title, changes, target) VALUES (
  '{VERSION}',
  'Фикс магазина 3D',
  '[{{"icon":"🩹","text":"Магазин больше не падает на слабых телефонах при 3D-аватарах — откат на иконки"}}]'::jsonb,
  'field'
) ON CONFLICT (version) DO UPDATE SET title = EXCLUDED.title, changes = EXCLUDED.changes, published_at = NOW();
"""
tmp_sql = Path(tempfile.gettempdir()) / "u97.sql"
tmp_sql.write_text(sql, encoding="utf-8")
sftp.put(str(tmp_sql), "/tmp/u97.sql")
run("PGPASSWORD=123456789 psql -U asgard -d asgard_crm -f /tmp/u97.sql")

# 6) restart so in-memory /m/index.html reloads
run("systemctl restart asgard-crm && sleep 4 && curl -sS http://127.0.0.1:3000/api/version")

# 7) verify
run(
    "echo SHELL=$(grep -o \"SHELL_VERSION = '[^']*'\" /var/www/asgard-crm/public/sw.js); "
    "echo INDEX=$(grep -o 'index-[^\"]*\\.js' /var/www/asgard-crm/public/m/index.html | head -1); "
    "curl -sS -o /dev/null -w 'm_index=%{http_code}\\n' http://127.0.0.1:3000/m/; "
    "curl -sS -o /dev/null -w 'chunk=%{http_code}\\n' http://127.0.0.1:3000/m/assets/index-DSot7Pm7.js; "
    "curl -sS -o /dev/null -w 'three=%{http_code}\\n' http://127.0.0.1:3000/m/assets/three.module-NMLgVOSA.js; "
    "curl -sS http://127.0.0.1:3000/m/index.html | grep -o 'index-[^\"]*\\.js' | head -1; "
    "grep -c '\\[VikingAvatar3D\\] render' /var/www/asgard-crm/public/m/assets/index-DSot7Pm7.js"
)

sftp.close()
c.close()
tmp_tar.unlink(missing_ok=True)
tmp_sql.unlink(missing_ok=True)
print("DONE deploy", VERSION)
