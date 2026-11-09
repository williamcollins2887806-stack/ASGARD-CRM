# -*- coding: utf-8 -*-
"""Deploy crew travel-depart + inactivity warn-only + mlsp orphan backfill."""
import io
import sys
import tarfile
import tempfile
from datetime import datetime
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
PROJECT = "/var/www/asgard-crm"
ROOT = Path(__file__).resolve().parents[1]
TAG = datetime.now().strftime("%Y%m%d-%H%M%S")
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-crew-travel-{TAG}"

FILES = [
    "src/services/crew-inactivity-cron.js",
    "src/services/crew-travel-depart-cron.js",
    "src/index.js",
    "src/lib/mlsp-stay.js",
    "src/services/mlsp-stay-cron.js",
    "tools/crew_travel_depart_once.js",
    "tools/mlsp_orphan_assign_backfill.sh",
]

MARKERS = {
    "src/services/crew-inactivity-cron.js": ["warn-only", "DEPART_DAYS = null", "CREW_INACTIVITY_NO_EMAIL"],
    "src/services/crew-travel-depart-cron.js": ["TRAVEL_DEPART_COOLING_DAYS = 2", "to_site", "from_site"],
    "src/index.js": ["CrewTravelDepart", "warn-only 25d", "no auto-depart"],
    "src/lib/mlsp-stay.js": ["closeOrphanMlspAssignments", "Авто: выезд с МЛСП"],
    "src/services/mlsp-stay-cron.js": ["orphansClosed"],
}


def run(c, cmd, timeout=300):
    print("====", cmd[:240].replace("\n", " "))
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out:
        print(out[-8000:] if len(out) > 8000 else out)
    if err.strip():
        print("STDERR:", err[:1500])
    if code != 0:
        raise SystemExit(f"FAILED ({code}): {cmd[:180]}")
    return out


def main():
    for rel in FILES:
        p = ROOT / rel
        if not p.exists():
            raise SystemExit(f"missing {rel}")
        text = p.read_text(encoding="utf-8")
        for m in MARKERS.get(rel, []):
            if m not in text:
                raise SystemExit(f"marker missing in {rel}: {m}")

    print("=== 0. local unit smoke ===")
    import subprocess
    r = subprocess.run(
        ["node", str(ROOT / "tests/unit/crew-travel-depart.test.js")],
        cwd=str(ROOT), capture_output=True, text=True
    )
    print((r.stdout or "") + (r.stderr or ""))
    if r.returncode != 0:
        raise SystemExit("unit test failed")

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    c.get_transport().set_keepalive(15)
    sftp = c.open_sftp()

    print("=== 1. snapshot ===")
    run(
        c,
        f"mkdir -p /root/snapshots && tar -C {PROJECT} --ignore-failed-read -czf {SNAP}.tgz "
        + " ".join(FILES)
        + f" && ls -lh {SNAP}.tgz",
    )

    print("=== 2. tar+scp ===")
    remote_tar = f"/tmp/asgard-crew-travel-{TAG}.tar.gz"
    with tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False) as tmp:
        tar_path = Path(tmp.name)
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            tar.add(ROOT / rel, arcname=rel)
    sftp.put(str(tar_path), remote_tar)
    tar_path.unlink(missing_ok=True)
    run(c, f"tar -xzf {remote_tar} -C {PROJECT} && rm -f {remote_tar}")

    print("=== 3. markers on prod ===")
    run(
        c,
        f"grep -n 'warn-only\\|CrewTravelDepart\\|closeOrphanMlspAssignments\\|orphansClosed\\|TRAVEL_DEPART_COOLING' "
        f"{PROJECT}/src/index.js {PROJECT}/src/services/crew-inactivity-cron.js "
        f"{PROJECT}/src/services/crew-travel-depart-cron.js {PROJECT}/src/lib/mlsp-stay.js "
        f"{PROJECT}/src/services/mlsp-stay-cron.js | head -40",
    )

    print("=== 4. restart ===")
    run(c, "systemctl restart asgard-crm && sleep 3 && systemctl is-active asgard-crm")

    print("=== 5. journal ===")
    run(
        c,
        "journalctl -u asgard-crm -n 80 --no-pager | "
        "grep -iE 'CrewInactivity|crew-inactivity|CrewTravelDepart|crew-travel|MlspStay|error' | tail -40 || true",
    )

    print("=== 6. dry-run travel candidates ===")
    run(
        c,
        f"cd {PROJECT} && DB_NAME=asgard_crm PGDATABASE=asgard_crm DB_PASSWORD=123456789 "
        f"node tools/crew_travel_depart_once.js --dry-run",
    )

    print("=== 7. orphan count ===")
    run(
        c,
        r"""PGPASSWORD=123456789 psql -U asgard -d asgard_crm -At -c "
WITH last_closed AS (
  SELECT DISTINCT ON (s.employee_id) s.employee_id, s.actual_departed_at, s.departed_source
  FROM mlsp_stays s WHERE s.actual_departed_at IS NOT NULL
  ORDER BY s.employee_id, s.actual_departed_at DESC, s.id DESC
)
SELECT COUNT(*) FROM employee_assignments ea
JOIN field_project_settings fps ON fps.work_id=ea.work_id AND fps.site_category='mlsp'
JOIN last_closed lc ON lc.employee_id=ea.employee_id
WHERE COALESCE(ea.is_active,true)=true AND ea.departure_date IS NULL
  AND lc.departed_source='auto_travel'
  AND NOT EXISTS (SELECT 1 FROM mlsp_stays s2 WHERE s2.employee_id=ea.employee_id AND s2.actual_departed_at IS NULL)
  AND NOT EXISTS (
    SELECT 1 FROM field_checkins fc
    WHERE fc.employee_id=ea.employee_id AND fc.work_id=ea.work_id
      AND fc.status='completed' AND fc.shift IN ('day','night') AND fc.date > lc.actual_departed_at
  )
  AND NOT EXISTS (
    SELECT 1 FROM field_trip_stages fts
    WHERE fts.employee_id=ea.employee_id AND fts.work_id=ea.work_id
      AND fts.direction='to_site' AND fts.stage_type IN ('travel','ship','helicopter')
      AND COALESCE(fts.status,'active') NOT IN ('rejected','cancelled')
      AND fts.date_from::date > lc.actual_departed_at
  );
" """,
    )

    sftp.close()
    c.close()
    print("DONE", TAG)


if __name__ == "__main__":
    main()
