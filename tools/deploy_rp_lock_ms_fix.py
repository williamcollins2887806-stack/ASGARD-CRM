#!/usr/bin/env python3
"""Deploy optimistic-lock ms truncation fix for PUT /rp-review (tender 1968)."""
import io
import sys
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
PROJECT = "/var/www/asgard-crm"
ROOT = Path(__file__).resolve().parents[1]
LOCAL = ROOT / "src" / "routes" / "pm-duty.js"
REMOTE = f"{PROJECT}/src/routes/pm-duty.js"


def run(c, cmd, timeout=120):
    print("====", cmd[:200].replace("\n", " "), "====")
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out:
        print(out[-10000:] if len(out) > 10000 else out)
    if err.strip():
        print("STDERR:", err[:3000])
    if code != 0:
        raise SystemExit(f"FAILED ({code})")
    return out


def main():
    if not LOCAL.exists():
        raise SystemExit(f"missing {LOCAL}")

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)

    print("=== SNAPSHOT ===")
    run(
        c,
        "mkdir -p /root/snapshots && "
        "tar -czf /root/snapshots/asgard-crm-pre-deploy-rp-lock-ms-$(date +%Y%m%d-%H%M%S).tgz "
        "-C /var/www asgard-crm/src/routes/pm-duty.js && "
        "ls -lt /root/snapshots/asgard-crm-pre-deploy-rp-lock-ms-* | head -3",
    )

    print("=== UPLOAD ===")
    sftp = c.open_sftp()
    sftp.put(str(LOCAL), REMOTE)
    sftp.close()
    print(f"  ok src/routes/pm-duty.js ({LOCAL.stat().st_size} bytes)")

    print("=== MARKER ===")
    run(c, "grep -n \"date_trunc('milliseconds'\" /var/www/asgard-crm/src/routes/pm-duty.js | head -5")

    print("=== RESTART ===")
    run(c, "systemctl restart asgard-crm && sleep 4 && systemctl is-active asgard-crm")

    print("=== SMOKE SQL LOCK ===")
    # Prove trunc match works for tender 1968 token round-trip
    smoke = r"""
cd /var/www/asgard-crm && node <<'NODE'
const { Pool } = require('pg');
const p = new Pool({ user: 'asgard', password: '123456789', database: 'asgard_crm' });
(async () => {
  const r = await p.query('SELECT updated_at FROM tender_rp_reviews WHERE tender_id=1968');
  const ua = r.rows[0].updated_at;
  const clientSent = JSON.parse(JSON.stringify({ updated_at: ua })).updated_at;
  const expectedAt = new Date(clientSent);
  const exact = await p.query(
    'SELECT updated_at = $1::timestamptz AS eq FROM tender_rp_reviews WHERE tender_id=1968',
    [expectedAt]
  );
  const trunc = await p.query(
    "SELECT date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $1::timestamptz) AS eq FROM tender_rp_reviews WHERE tender_id=1968",
    [expectedAt]
  );
  console.log(JSON.stringify({ exact: exact.rows[0].eq, trunc_ms: trunc.rows[0].eq }));
  if (!trunc.rows[0].eq) process.exit(2);
  await p.end();
})().catch((e) => { console.error(e); process.exit(1); });
NODE
"""
    run(c, smoke)

    print("=== HTTP ===")
    run(
        c,
        "curl -s -o /dev/null -w 'HOME=%{http_code}\\n' http://127.0.0.1:3000/ ; "
        "systemctl is-active asgard-crm",
    )

    c.close()
    print("DONE")


if __name__ == "__main__":
    main()
