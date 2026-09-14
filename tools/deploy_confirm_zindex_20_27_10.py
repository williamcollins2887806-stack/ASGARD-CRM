#!/usr/bin/env python3
"""Hotfix: confirm dialog above modal + shell 20.27.10."""
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
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-confirm-zindex-{TAG}"

FILES = [
    "public/assets/js/confirm.js",
    "public/assets/css/cr-modal.css",
    "public/sw.js",
    "public/index.html",
]


def md5_file(path: Path) -> str:
    h = hashlib.md5()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def run(c, cmd, timeout=120):
    print("====", cmd[:180].replace("\n", " "))
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    if out:
        print(out[-12000:] if len(out) > 12000 else out)
    if err.strip():
        print("STDERR:", err[:2000])
    return out


def main():
    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    run(
        c,
        "mkdir -p /root/snapshots && tar -C {p} -czf {s}.tgz {files} && ls -lh {s}.tgz".format(
            p=PROJECT,
            s=SNAP,
            files=" ".join(FILES),
        ),
    )

    for rel in FILES:
        local = ROOT / rel
        remote = f"{PROJECT}/{rel}"
        digest = md5_file(local)
        sftp.put(str(local), remote)
        with sftp.file(remote, "rb") as rf:
            remote_md5 = hashlib.md5(rf.read()).hexdigest()
        print(f"  {'OK' if remote_md5 == digest else 'FAIL'} {rel} {digest}")
        if remote_md5 != digest:
            raise SystemExit("md5 fail")

    run(c, f"grep -n '_liftAboveModals\\|11050' {PROJECT}/public/assets/js/confirm.js {PROJECT}/public/assets/css/cr-modal.css")
    run(c, f"grep -o \"SHELL_VERSION = '[^']*'\" {PROJECT}/public/sw.js")
    run(c, f"grep -o \"ASGARD_SHELL_VERSION = '[^']*'\" {PROJECT}/public/index.html")
    # frontend-only: no restart required, but refresh version endpoint via sw.js read
    run(c, "curl -sS http://127.0.0.1:3000/api/version")
    # still restart lightly so /api/version cache (30s) picks up if any; sw is read from disk each miss
    run(c, "systemctl restart asgard-crm && sleep 3 && systemctl is-active asgard-crm && curl -sS http://127.0.0.1:3000/api/version")

    sftp.close()
    c.close()
    print(f"DONE snapshot={SNAP}.tgz")


if __name__ == "__main__":
    main()
