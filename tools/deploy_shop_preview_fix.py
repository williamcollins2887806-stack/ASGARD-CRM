#!/usr/bin/env python3
import io, os, sys
from pathlib import Path
import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
PROJECT = "/var/www/asgard-crm"
ROOT = Path(__file__).resolve().parents[1]

def main():
    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect("92.242.61.184", username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    for mig in ["V307__fix_face_paint_badge_slot.sql"]:
        local = ROOT / "migrations" / mig
        sftp.put(str(local), f"/tmp/{mig}")
        _, o, e = c.exec_command(
            f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 -f /tmp/{mig}",
            timeout=30,
        )
        print(mig, o.read().decode("utf-8", errors="replace"), e.read().decode("utf-8", errors="replace"))

    sftp.put(str(ROOT / "src/routes/field-gamification.js"), f"{PROJECT}/src/routes/field-gamification.js")
    print("OK API")

    m_local = ROOT / "public" / "m"
    sftp.put(str(m_local / "index.html"), f"{PROJECT}/public/m/index.html")
    for name in os.listdir(m_local / "assets"):
        lp = m_local / "assets" / name
        if lp.is_file():
            sftp.put(str(lp), f"{PROJECT}/public/m/assets/{name}")
    print("OK /m")

    _, o, e = c.exec_command(
        "systemctl restart asgard-crm && sleep 1 && systemctl is-active asgard-crm; "
        f"grep -oE 'index-[^\"]+\\.js' {PROJECT}/public/m/index.html | head -1; "
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -c \"SELECT active_badge FROM employees WHERE id=14;\"",
        timeout=40,
    )
    print(o.read().decode("utf-8", errors="replace"))
    sftp.close(); c.close()
    print("DONE")

if __name__ == "__main__":
    main()
