# -*- coding: utf-8 -*-
"""Deploy V316 + inactivity cron + departure=last mark + field-manage/stages."""
import hashlib
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
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-inactivity-{TAG}"

FILES = [
    "migrations/V316__crew_inactivity_warn_depart.sql",
    "src/services/crew-inactivity-cron.js",
    "src/index.js",
    "src/routes/field-manage.js",
    "src/routes/field-stages.js",
]

MARKERS = {
    "src/services/crew-inactivity-cron.js": ["WARN_DAYS = 5", "DEPART_DAYS = 7", "inactivity_warned_at"],
    "src/index.js": ["crew-inactivity-cron", "CrewInactivity"],
    "src/routes/field-manage.js": ["last_mark", "inactivity_warned_at"],
    "migrations/V316__crew_inactivity_warn_depart.sql": ["inactivity_warned_at"],
}


def run(c, cmd, timeout=300):
    print("====", cmd[:220].replace("\n", " "))
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out:
        print(out[-6000:] if len(out) > 6000 else out)
    if err.strip():
        print("STDERR:", err[:1500])
    if code != 0:
        raise SystemExit(f"FAILED ({code}): {cmd[:160]}")
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

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    c.get_transport().set_keepalive(15)
    sftp = c.open_sftp()

    run(c, f"mkdir -p /root/snapshots && tar -C {PROJECT} --ignore-failed-read -czf {SNAP}.tgz {' '.join(FILES)} && ls -lh {SNAP}.tgz")

    remote_tar = f"/tmp/asgard-inactivity-{TAG}.tar.gz"
    with tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False) as tmp:
        tar_path = Path(tmp.name)
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            tar.add(ROOT / rel, arcname=rel)
    sftp.put(str(tar_path), remote_tar)
    tar_path.unlink(missing_ok=True)
    run(c, f"tar -xzf {remote_tar} -C {PROJECT}")

    run(
        c,
        f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -f {PROJECT}/migrations/V316__crew_inactivity_warn_depart.sql",
    )

    # upload + run departure fix
    fix_local = ROOT / "tools/_fix_departure_last_mark.sql"
    sftp.put(str(fix_local), "/tmp/_fix_dep.sql")
    run(c, "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -f /tmp/_fix_dep.sql")

    run(c, "systemctl restart asgard-crm && sleep 2 && systemctl is-active asgard-crm")
    run(c, "journalctl -u asgard-crm -n 40 --no-pager | grep -i 'CrewInactivity\\|crew-inactivity\\|error' | tail -20 || true")

    # dry-run: who would be warned today (no depart without warn gap)
    run(
        c,
        r"""PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "
SELECT COUNT(*) FILTER (WHERE idle>=5 AND warned IS NULL) AS would_warn_today,
       COUNT(*) FILTER (WHERE idle>=7 AND warned IS NOT NULL) AS would_depart_if_warned,
       COUNT(*) AS idle_5plus
FROM (
  SELECT ea.id,
         (CURRENT_DATE - GREATEST(
           COALESCE((SELECT MAX(fc.date)::date FROM field_checkins fc WHERE fc.employee_id=ea.employee_id AND fc.work_id=ea.work_id AND fc.status='completed'),'1900-01-01'::date),
           COALESCE((SELECT MAX(COALESCE(fts.date_to,fts.date_from))::date FROM field_trip_stages fts WHERE fts.employee_id=ea.employee_id AND fts.work_id=ea.work_id AND COALESCE(fts.status,'active') NOT IN ('rejected','cancelled')),'1900-01-01'::date),
           COALESCE(ea.date_from, ea.created_at::date)
         )) AS idle,
         ea.inactivity_warned_at AS warned
  FROM employee_assignments ea
  JOIN works w ON w.id=ea.work_id
  WHERE COALESCE(ea.is_active,true)=true AND ea.departure_date IS NULL AND w.deleted_at IS NULL
) t WHERE idle>=5;
" """,
    )

    run(
        c,
        """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c \"
INSERT INTO app_updates (version, title, changes, target)
VALUES (
  'v20.27.67',
  'Авто-убытие: 5д письмо / 7д снятие',
  '[\"Дата убытия = последняя отметка (смена или дорога)\",\"Через 5 дней без отметок — письмо РП\",\"Через 7 дней после последней отметки (и ≥2д после письма) — снятие с бригады\",\"Без массового сноса в день включения\"]'::jsonb,
  'both'
) ON CONFLICT (version) DO NOTHING;
\" """,
    )

    sftp.close()
    c.close()
    print("DEPLOY OK", SNAP)


if __name__ == "__main__":
    main()
