#!/usr/bin/env python3
"""Hotfix: deploy staff.js with POST /reviews/bulk (was 404 on prod)."""
import hashlib
import io
import sys
from datetime import datetime
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
PROJECT = "/var/www/asgard-crm"
ROOT = Path(__file__).resolve().parents[1]
TAG = datetime.now().strftime("%Y%m%d-%H%M%S")
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-reviews-bulk-{TAG}"
REL = "src/routes/staff.js"


def md5_file(path: Path) -> str:
    h = hashlib.md5()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def run(c, cmd, timeout=180):
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


def main():
    local = ROOT / REL
    text = local.read_text(encoding="utf-8")
    if "fastify.post('/reviews/bulk'" not in text:
        raise SystemExit("marker missing: reviews/bulk")

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    run(
        c,
        f"mkdir -p /root/snapshots && tar -C {PROJECT} -czf {SNAP}.tgz {REL} && ls -lh {SNAP}.tgz",
    )

    remote = f"{PROJECT}/{REL}"
    digest = md5_file(local)
    sftp.put(str(local), remote)
    with sftp.file(remote, "rb") as rf:
        remote_md5 = hashlib.md5(rf.read()).hexdigest()
    print(f"  {'OK' if remote_md5 == digest else 'FAIL'} {REL} {digest}")
    if remote_md5 != digest:
        raise SystemExit("md5 fail")

    run(c, f"grep -c reviews/bulk {remote}")
    run(
        c,
        "systemctl restart asgard-crm && sleep 3 && systemctl is-active asgard-crm "
        "&& curl -sS http://127.0.0.1:3000/api/version",
    )

    sftp.close()
    c.close()
    print("DONE snapshot=", SNAP + ".tgz")


if __name__ == "__main__":
    main()
