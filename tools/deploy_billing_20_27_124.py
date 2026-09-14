# -*- coding: utf-8 -*-
"""Deploy billing hall + KPI caption-frame fix (20.27.124 / V342)."""
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
VER = "20.27.124"
TAG = datetime.now().strftime("%Y%m%d-%H%M%S")
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-billing-{TAG}"

FILES = [
    "migrations/V342__billing_docs_constructor.sql",
    "src/services/billing-docs.js",
    "src/lib/pdf-fonts.js",
    "src/routes/invoices.js",
    "src/routes/acts.js",
    "public/assets/js/billing.js",
    "public/assets/css/billing.css",
    "public/assets/js/invoices.js",
    "public/assets/js/acts.js",
    "public/assets/js/app.js",
    "public/assets/css/app.css",
    "public/assets/css/light-theme.css",
    "public/index.html",
    "public/sw.js",
]

MARKERS = {
    "public/assets/js/billing.js": ["AsgardBillingPage", "function invoiceOpen"],
    "public/assets/css/billing.css": [".bill-kpi .k", "border: 1px solid transparent"],
    "public/assets/css/app.css": [".kpi > .k:has(.v)", ".payroll-kpi > .k"],
    "public/assets/css/light-theme.css": ["[class*=\"kpi\"] > .k:not(:has(.v))", ".bill-kpi .k"],
    "public/assets/js/app.js": ['AsgardRouter.add("/billing"', "AsgardBillingPage"],
    "public/sw.js": [f"SHELL_VERSION = '{VER}'"],
    "public/index.html": [
        f"ASGARD_SHELL_VERSION = '{VER}'",
        f"billing.js?v={VER}",
        f"billing.css?v={VER}",
        f"app.js?v={VER}",
    ],
    "src/services/billing-docs.js": ["toJsonParam", "normalizeBillingBody"],
    "src/routes/invoices.js": ["preview-pdf", "next-number"],
    "src/routes/acts.js": ["preview-pdf", "next-number"],
    "migrations/V342__billing_docs_constructor.sql": ["customer_kpp", "items_json"],
}


def run(c, cmd, timeout=300):
    print("====", cmd[:220].replace("\n", " "))
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out:
        print(out[-8000:] if len(out) > 8000 else out)
    if err.strip():
        print("STDERR:", err[:2000])
    if code != 0:
        raise SystemExit(f"FAILED ({code}): {cmd[:160]}")
    return out


def pack_v2() -> Path:
    v2 = ROOT / "public" / "v2"
    if not (v2 / "assets").exists():
        raise SystemExit("public/v2/assets missing — npm run build first")
    tmp = Path(tempfile.gettempdir()) / f"asgard-v2-billing-{TAG}.tar.gz"
    with tarfile.open(tmp, "w:gz") as tar:
        tar.add(v2, arcname="v2")
    print(f"packed v2 {tmp.stat().st_size}")
    return tmp


def main():
    for rel in FILES:
        p = ROOT / rel
        if not p.exists():
            raise SystemExit(f"missing file {rel}")
        text = p.read_text(encoding="utf-8")
        for m in MARKERS.get(rel, []):
            if m not in text:
                raise SystemExit(f"marker missing in {rel}: {m}")

    v2_tar = pack_v2()
    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    snap_paths = " ".join(FILES + ["public/v2"])
    run(
        c,
        f"mkdir -p /root/snapshots && tar -C {PROJECT} -czf {SNAP}.tgz --ignore-failed-read {snap_paths}; "
        f"ls -lh {SNAP}.tgz",
    )

    remote_tar = f"/tmp/asgard-billing-{TAG}.tar.gz"
    with tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False) as tmp:
        tar_path = Path(tmp.name)
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            tar.add(ROOT / rel, arcname=rel)
    sftp.put(str(tar_path), remote_tar)
    tar_path.unlink(missing_ok=True)
    run(c, f"tar -xzf {remote_tar} -C {PROJECT}")

    remote_v2 = f"/tmp/asgard-v2-billing-{TAG}.tar.gz"
    sftp.put(str(v2_tar), remote_v2)
    v2_tar.unlink(missing_ok=True)
    run(c, f"tar -xzf {remote_v2} -C {PROJECT}/public")

    print("=== FONTS ===")
    run(c, "ls /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf /usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf 2>/dev/null || echo 'NO_DEJAVU'")

    print("=== APPLY V342 ===")
    run(
        c,
        f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 "
        f"-f {PROJECT}/migrations/V342__billing_docs_constructor.sql",
    )
    run(
        c,
        """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "SELECT column_name FROM information_schema.columns WHERE table_name IN ('invoices','acts') AND column_name IN ('customer_kpp','customer_address','contact_email','items_json') ORDER BY table_name, column_name;" """,
    )

    run(
        c,
        f"grep -n \"AsgardBillingPage\\|billing.js?v={VER}\\|SHELL_VERSION = '{VER}'\" "
        f"{PROJECT}/public/assets/js/app.js {PROJECT}/public/index.html {PROJECT}/public/sw.js | head -20",
    )

    run(c, "systemctl restart asgard-crm")
    run(
        c,
        """bash -lc 'systemctl is-active asgard-crm; for i in 1 2 3 4 5 6 7 8; do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api/health || true)
  echo try=$i code=$code
  [ "$code" = "200" ] && break
  sleep 2
done
curl -s http://127.0.0.1:3000/api/version; echo
curl -s -o /dev/null -w "billing.js=%{http_code}\\n" http://127.0.0.1:3000/assets/js/billing.js
curl -s -o /dev/null -w "billing.css=%{http_code}\\n" http://127.0.0.1:3000/assets/css/billing.css
'""",
    )
    run(
        c,
        "journalctl -u asgard-crm -n 40 --no-pager | tail -40",
    )
    print("SNAP", SNAP + ".tgz")
    sftp.close()
    c.close()


if __name__ == "__main__":
    main()
