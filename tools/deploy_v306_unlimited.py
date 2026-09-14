#!/usr/bin/env python3
"""Apply V306 + deploy field-gamification + mobile /m."""
import io
import os
import sys
from pathlib import Path
import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
PROJECT = "/var/www/asgard-crm"
ROOT = Path(__file__).resolve().parents[1]


def main():
    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    mig = ROOT / "migrations" / "V306__virtual_cosmetics_unlimited.sql"
    sftp.put(str(mig), "/tmp/V306__virtual_cosmetics_unlimited.sql")
    print("=== Apply V306 ===")
    _, o, e = c.exec_command(
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 "
        "-f /tmp/V306__virtual_cosmetics_unlimited.sql",
        timeout=60,
    )
    print(o.read().decode("utf-8", errors="replace"))
    err = e.read().decode("utf-8", errors="replace")
    if err.strip():
        print("ERR:", err)

    print("=== Verify stock ===")
    _, o, e = c.exec_command(
        """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "
SELECT COUNT(*) FILTER (WHERE current_stock IS NULL) AS unlimited,
       COUNT(*) FILTER (WHERE current_stock IS NOT NULL AND current_stock<=0) AS sold_out,
       COUNT(*) FILTER (WHERE set_tag IS NOT NULL) AS tagged
FROM gamification_shop_items
WHERE is_active AND category IN ('digital','cosmetic');
" """,
        timeout=30,
    )
    print(o.read().decode("utf-8", errors="replace"))

    print("=== Upload API ===")
    sftp.put(
        str(ROOT / "src" / "routes" / "field-gamification.js"),
        f"{PROJECT}/src/routes/field-gamification.js",
    )
    print("OK field-gamification.js")

    print("=== Upload /m ===")
    m_local = ROOT / "public" / "m"
    sftp.put(str(m_local / "index.html"), f"{PROJECT}/public/m/index.html")
    assets = m_local / "assets"
    for name in os.listdir(assets):
        lp = assets / name
        if lp.is_file():
            sftp.put(str(lp), f"{PROJECT}/public/m/assets/{name}")
    print("OK /m")

    _, o, e = c.exec_command(
        "systemctl restart asgard-crm && sleep 1 && systemctl is-active asgard-crm; "
        f"grep -oE 'index-[^\"]+\\.js' {PROJECT}/public/m/index.html | head -1",
        timeout=40,
    )
    print(o.read().decode("utf-8", errors="replace"))
    sftp.close()
    c.close()
    print("DONE")


if __name__ == "__main__":
    main()
