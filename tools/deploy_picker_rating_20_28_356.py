#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Hotfix: CREmployeePicker emp.rating.toFixed crash, shell 20.28.356."""
from __future__ import annotations

import hashlib
import sys
import tarfile
import tempfile
import time
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import paramiko  # noqa: E402
import shell_guard  # noqa: E402

SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
VER = "20.28.356"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

TAR_FILES = [
    "public/assets/js/components/cr-employee-picker.js",
    "public/index.html",
    "public/sw.js",
    "public/h/index.html",
    "public/h/sw.js",
]

MARKERS = [
    ("public/assets/js/components/cr-employee-picker.js", "Number(emp.rating)", "rating Number coerce"),
    ("public/sw.js", f"SHELL_VERSION = '{VER}'", f"shell {VER}"),
    ("public/index.html", f"ASGARD_SHELL_VERSION = '{VER}'", f"index {VER}"),
]


def load_pkey(path: str):
    for loader in (getattr(paramiko, "Ed25519Key", None), getattr(paramiko, "ECDSAKey", None), paramiko.RSAKey):
        if loader is None:
            continue
        try:
            return loader.from_private_key_file(path)
        except Exception:
            continue
    raise SystemExit(f"cannot load SSH key: {path}")


def md5(b: bytes) -> str:
    return hashlib.md5(b).hexdigest()


def main() -> int:
    for rel in TAR_FILES:
        if not (ROOT / rel).is_file():
            raise SystemExit(f"missing: {rel}")
    for rel, needle, label in MARKERS:
        if needle not in (ROOT / rel).read_text(encoding="utf-8", errors="replace"):
            raise SystemExit(f"no marker: {label}")
        print(f"  OK {label}")

    shell_guard.assert_ok(expect_version=VER, deploy_gate=True)

    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45, banner_timeout=70, auth_timeout=70)

    def run(cmd, check=True, timeout=300):
        print(f"$ {cmd[:200]}")
        _i, o, e = ssh.exec_command(cmd, timeout=timeout)
        out = o.read().decode("utf-8", "replace")
        err = e.read().decode("utf-8", "replace")
        code = o.channel.recv_exit_status()
        if out.strip():
            print(out.rstrip()[:3000])
        if err.strip():
            print(err.rstrip()[:1000], file=sys.stderr)
        if check and code != 0:
            raise SystemExit(f"exit {code}")
        return out

    sftp = ssh.open_sftp()
    snap = f"/root/snapshots/asgard-picker-rating-{STAMP}.tgz"
    run("mkdir -p /root/snapshots")
    run(f"tar -czf {snap} -C {REMOTE} {' '.join(TAR_FILES)} 2>/dev/null || true", check=False)

    tar_path = Path(tempfile.gettempdir()) / f"asgard-picker-rating-{STAMP}.tar.gz"
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in TAR_FILES:
            tar.add(str(ROOT / rel), arcname=rel.replace("\\", "/"))
    remote_tar = f"/tmp/asgard-picker-rating-{STAMP}.tar.gz"
    sftp.put(str(tar_path), remote_tar)
    run(f"tar -xzf {remote_tar} -C {REMOTE} && rm -f {remote_tar}")

    for rel in TAR_FILES:
        local_md5 = md5((ROOT / rel).read_bytes())
        with sftp.file(f"{REMOTE}/{rel}", "rb") as rf:
            if md5(rf.read()) != local_md5:
                raise SystemExit(f"md5 mismatch {rel}")
        print(f"  OK {rel}")

    run("systemctl restart asgard-crm")
    for i in range(1, 12):
        time.sleep(2)
        out = run(
            "systemctl is-active asgard-crm; "
            "curl -sS -o /dev/null -w 'http=%{http_code}\\n' http://127.0.0.1:3000/api/health || true",
            check=False,
        )
        if "active" in out and "http=200" in out:
            print(f"health OK try {i}")
            break
    else:
        raise SystemExit("unhealthy")

    for rel, needle, label in MARKERS:
        esc = needle.replace("'", "'\\''")
        out = run(f"grep -F -c -- '{esc}' {REMOTE}/{rel} || true", check=False)
        cnt = (out or "").strip().splitlines()[-1] if out else "0"
        if cnt == "0":
            raise SystemExit(f"missing remote: {label}")
        print(f"  marker {label}: {cnt}")

    print(run("curl -sS http://127.0.0.1:3000/api/version", check=False).strip())
    sftp.close()
    ssh.close()
    print(f"DONE {VER} snap={snap}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
