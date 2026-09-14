# -*- coding: utf-8 -*-
"""Hotfix: registry column alignment + analysis_deadline backfill (20.27.121 / V341)."""
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
VER = "20.27.121"
TAG = datetime.now().strftime("%Y%m%d-%H%M%S")
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-reg-align-{TAG}"

FILES = [
    "migrations/V341__backfill_analysis_deadline.sql",
    "migrations/V341__backfill_analysis_deadline_down.sql",
    "public/assets/js/registry_tab.js",
    "public/assets/css/app.css",
    "public/index.html",
    "public/sw.js",
]

MARKERS = {
    "public/assets/js/registry_tab.js": [
        "reg-col-filter-spacer",
        "label: 'Анализ'",
        "label: 'Сбор'",
    ],
    "public/assets/css/app.css": [
        "table-layout: fixed",
        "reg-col-filter-spacer",
        "reg-th-analysis",
        "line-clamp: 2",
    ],
    "public/sw.js": [f"SHELL_VERSION = '{VER}'"],
    "public/index.html": [f"ASGARD_SHELL_VERSION = '{VER}'", f"registry_tab.js?v={VER}", f"app.css?v={VER}"],
    "migrations/V341__backfill_analysis_deadline.sql": ["analysis_deadline", "ROW_NUMBER"],
}


def run(c, cmd, timeout=300):
    print("====", cmd[:220].replace("\n", " "))
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out:
        print(out[-7000:] if len(out) > 7000 else out)
    if err.strip():
        print("STDERR:", err[:2000])
    if code != 0:
        raise SystemExit(f"FAILED ({code}): {cmd[:160]}")
    return out


def pack_v2() -> Path:
    v2 = ROOT / "public" / "v2"
    # rebuild markers optional — vanilla is primary; still ship latest v2 if present
    tmp = Path(tempfile.gettempdir()) / f"asgard-v2-reg-align-{TAG}.tar.gz"
    with tarfile.open(tmp, "w:gz") as tar:
        tar.add(v2, arcname="v2")
    print(f"packed v2 {tmp.stat().st_size}")
    return tmp


def main():
    for rel in FILES:
        text = (ROOT / rel).read_text(encoding="utf-8")
        for m in MARKERS.get(rel, []):
            if m not in text:
                raise SystemExit(f"marker missing in {rel}: {m}")

    # v2 must be built before deploy (npm run build in desktop-v2-src)
    v2_tar = pack_v2()
    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    run(
        c,
        f"mkdir -p /root/snapshots && tar -C {PROJECT} -czf {SNAP}.tgz --ignore-failed-read "
        f"public/assets/js/registry_tab.js public/assets/css/app.css public/index.html public/sw.js public/v2 migrations; "
        f"ls -lh {SNAP}.tgz",
    )

    remote_tar = f"/tmp/asgard-reg-align-{TAG}.tar.gz"
    with tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False) as tmp:
        tar_path = Path(tmp.name)
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            tar.add(ROOT / rel, arcname=rel)
    sftp.put(str(tar_path), remote_tar)
    tar_path.unlink(missing_ok=True)
    run(c, f"tar -xzf {remote_tar} -C {PROJECT}")

    remote_v2 = f"/tmp/asgard-v2-reg-align-{TAG}.tar.gz"
    sftp.put(str(v2_tar), remote_v2)
    v2_tar.unlink(missing_ok=True)
    run(c, f"tar -xzf {remote_v2} -C {PROJECT}/public")

    print("=== BEFORE BACKFILL ===")
    run(
        c,
        """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "SELECT COUNT(*) FILTER (WHERE analysis_deadline IS NULL AND docs_deadline IS NOT NULL) AS null_adl, COUNT(*) FILTER (WHERE analysis_deadline IS NOT NULL) AS filled FROM tenders WHERE deleted_at IS NULL AND COALESCE(registry_status,'рассмотрение')='рассмотрение';" """,
    )

    print("=== APPLY V341 ===")
    run(
        c,
        f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 "
        f"-f {PROJECT}/migrations/V341__backfill_analysis_deadline.sql",
    )

    print("=== AFTER BACKFILL ===")
    run(
        c,
        """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "SELECT COUNT(*) FILTER (WHERE analysis_deadline IS NULL AND docs_deadline IS NOT NULL) AS null_adl, COUNT(*) FILTER (WHERE analysis_deadline IS NOT NULL) AS filled FROM tenders WHERE deleted_at IS NULL AND COALESCE(registry_status,'рассмотрение')='рассмотрение'; SELECT id, docs_deadline::date, analysis_deadline, participation_paid FROM tenders WHERE registry_no=123 OR id=123 LIMIT 3;" """,
    )

    # Spot-check: free docs 2026-09-15 → 2026-09-10 if such row exists
    run(
        c,
        f"grep -n \"reg-col-filter-spacer\\|table-layout: fixed\\|label: 'Анализ'\" "
        f"{PROJECT}/public/assets/js/registry_tab.js {PROJECT}/public/assets/css/app.css | head -20",
    )
    run(c, f"grep -n \"SHELL_VERSION = '{VER}'\" {PROJECT}/public/sw.js")

    run(c, "systemctl restart asgard-crm")
    run(
        c,
        """bash -lc 'for i in 1 2 3 4 5 6 7 8; do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api/health || true)
  echo try=$i code=$code
  [ "$code" = "200" ] && break
  sleep 2
done
curl -s http://127.0.0.1:3000/api/version; echo'""",
    )

    run(
        c,
        """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "INSERT INTO app_updates (version, changes, created_at) VALUES ('v20.27.121', 'Реестр: ровные колонки Сбор/Анализ, бэкфилл внутренних сроков анализа (V341), меньше сжатия.', NOW());" 2>/dev/null || true""",
    )

    sftp.close()
    c.close()
    print("DEPLOY OK", VER, SNAP)


if __name__ == "__main__":
    main()
