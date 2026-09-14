# -*- coding: utf-8 -*-
"""Deploy: log fixes — permits dates, IMAP backoff, PDF fonts, log noise (shell 20.27.67)."""
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
VER = "20.27.67"
TAG = datetime.now().strftime("%Y%m%d-%H%M%S")
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-logfixes-{TAG}"

FILES = [
    "src/lib/date-only.js",
    "src/lib/pdf-fonts.js",
    "src/routes/permits.js",
    "src/routes/pass_requests.js",
    "src/services/imap.js",
    "src/services/log-monitor-cron.js",
    "src/services/mimir-conductor/letter-generator.js",
    "src/services/mimir-conductor/director-report.js",
    "public/desktop-v2-src/src/pages/Permits/PermitsChecklistModal.jsx",
    "public/desktop-v2-src/src/pages/Permits/api.js",
    "public/index.html",
    "public/sw.js",
]

MARKERS = {
    "src/lib/date-only.js": ["toDateOnly", "+082026-02"],
    "src/lib/pdf-fonts.js": ["registerDejaVuFonts", "TT: undefined function"],
    "src/routes/permits.js": ["normalizePermitRow", "require('../lib/date-only')"],
    "src/services/imap.js": ["syncBackoff", "failed_ai=", "noteSyncFailure"],
    "src/services/log-monitor-cron.js": ["failed_ai="],
    "public/desktop-v2-src/src/pages/Permits/api.js": ["dateInputValue"],
    "public/desktop-v2-src/src/pages/Permits/PermitsChecklistModal.jsx": ["dateInputValue(ex.issue_date)"],
    "public/sw.js": [f"SHELL_VERSION = '{VER}'"],
    "public/index.html": [f"ASGARD_SHELL_VERSION = '{VER}'"],
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
        print("STDERR:", err[:2000])
    if code != 0:
        raise SystemExit(f"FAILED ({code}): {cmd[:160]}")
    return out


def pack_v2() -> Path:
    v2 = ROOT / "public" / "v2"
    if not (v2 / "index.html").exists():
        raise SystemExit("public/v2 missing — build first")
    found = False
    for p in (v2 / "assets").glob("PermitsChecklistModal-*.js"):
        txt = p.read_text(encoding="utf-8", errors="ignore")
        if "/^[+-]\\d/" in txt and "issue_date:O(" in txt:
            found = True
            print(f"v2 permits date guard in {p.name}")
            break
    if not found:
        raise SystemExit("v2 build missing PermitsChecklistModal date guard")
    tmp = Path(tempfile.gettempdir()) / f"asgard-v2-logfixes-{TAG}.tar.gz"
    with tarfile.open(tmp, "w:gz") as tar:
        tar.add(v2, arcname="v2")
    print(f"packed v2 -> {tmp} ({tmp.stat().st_size} bytes)")
    return tmp


def main():
    for rel in FILES:
        local = ROOT / rel
        if not local.exists():
            raise SystemExit(f"missing {rel}")
        text = local.read_text(encoding="utf-8")
        for m in MARKERS.get(rel, []):
            if m not in text:
                raise SystemExit(f"marker missing in {rel}: {m}")

    v2_tar = pack_v2()

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    c.get_transport().set_keepalive(15)
    sftp = c.open_sftp()

    print("=== SNAPSHOT ===")
    run(
        c,
        "mkdir -p /root/snapshots && tar -C {p} -czf {s}.tgz --ignore-failed-read {files} public/v2 && ls -lh {s}.tgz".format(
            p=PROJECT,
            s=SNAP,
            files=" ".join(FILES),
        ),
    )

    print("=== UPLOAD FILES ===")
    remote_tar = f"/tmp/asgard-logfixes-{TAG}.tar.gz"
    with tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False) as tmp:
        tar_path = Path(tmp.name)
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            tar.add(ROOT / rel, arcname=rel)
    sftp.put(str(tar_path), remote_tar)
    tar_path.unlink(missing_ok=True)
    run(c, f"tar -xzf {remote_tar} -C {PROJECT}")

    print("=== UPLOAD V2 ===")
    remote_v2 = f"/tmp/asgard-v2-logfixes-{TAG}.tar.gz"
    sftp.put(str(v2_tar), remote_v2)
    v2_tar.unlink(missing_ok=True)
    run(c, f"tar -xzf {remote_v2} -C {PROJECT}/public")

    print("=== VERIFY ON PROD ===")
    run(
        c,
        f"grep -n 'syncBackoff\\|failed_ai=\\|normalizePermitRow\\|date-only' "
        f"{PROJECT}/src/services/imap.js {PROJECT}/src/routes/permits.js {PROJECT}/src/lib/date-only.js | head -20",
    )
    run(c, f"grep -n \"SHELL_VERSION = '{VER}'\" {PROJECT}/public/sw.js")

    print("=== RESTART ===")
    run(c, "systemctl restart asgard-crm && sleep 2 && systemctl is-active asgard-crm")

    run(
        c,
        """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c \"
INSERT INTO app_updates (version, changes, created_at)
VALUES ('v20.27.67',
  'Починка логов: допуски (даты bulk save), IMAP backoff, PDF шрифты, шум Diagnostic в мониторинге.',
  NOW());
\" """,
    )

    print("=== HEALTH ===")
    run(c, "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health")

    sftp.close()
    c.close()
    print("DEPLOY OK", VER, "snap", SNAP)


if __name__ == "__main__":
    main()
