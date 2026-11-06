#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy: LogMonitor / CRM-Mailer / SSE-vapid rate-limit (shell 20.28.425 без бампа).

Файлы:
  - src/services/crm-mailer.js      — file_path/mime_type
  - src/services/log-monitor-cron.js — шум FolderSorter/IMAP
  - src/routes/sse.js               — rateLimit:false на /stream
  - src/routes/push.js              — rateLimit:false на /vapid-key

Порядок: shell_guard(deploy-gate) → snapshot → tar+scp → restart → health → markers.
Откат: tar -xzf <snap> -C /var/www/asgard-crm && systemctl restart asgard-crm
"""
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
VER = "20.28.425"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

TAR_PATHS = [
    "src/services/crm-mailer.js",
    "src/services/log-monitor-cron.js",
    "src/routes/sse.js",
    "src/routes/push.js",
]

MARKERS = [
    ("src/services/crm-mailer.js", "file_path", "crm-mailer file_path"),
    ("src/services/crm-mailer.js", "mime_type", "crm-mailer mime_type"),
    ("src/services/log-monitor-cron.js", "Connection not available", "FolderSorter noise"),
    ("src/routes/sse.js", "rateLimit: false", "sse rateLimit false"),
    ("src/routes/push.js", "rateLimit: false", "vapid rateLimit false"),
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
    for rel in TAR_PATHS:
        if not (ROOT / rel).is_file():
            raise SystemExit(f"missing: {rel}")

    print("=== LOCAL MARKERS ===")
    for rel, needle, label in MARKERS:
        text = (ROOT / rel).read_text(encoding="utf-8", errors="replace")
        if needle not in text:
            raise SystemExit(f"локально нет маркера: {label}")
        print(f"  OK {label}")

    print("=== SHELL GUARD ===")
    shell_guard.assert_ok(expect_version=VER, deploy_gate=True)

    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    for attempt in range(1, 6):
        try:
            ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45,
                        banner_timeout=70, auth_timeout=70)
            print(f"ssh: connected (attempt {attempt})")
            break
        except Exception as e:
            print(f"ssh: attempt {attempt} failed: {e}")
            if attempt == 5:
                raise SystemExit("ssh: cannot connect")
            time.sleep(4)

    def run(cmd, check=True, timeout=600):
        print(f"$ {cmd[:220]}")
        _i, o, e = ssh.exec_command(cmd, timeout=timeout)
        out = o.read().decode("utf-8", "replace")
        err = e.read().decode("utf-8", "replace")
        code = o.channel.recv_exit_status()
        if out.strip():
            print(out.rstrip()[:4000])
        if err.strip():
            print(err.rstrip()[:1500], file=sys.stderr)
        if check and code != 0:
            raise SystemExit(f"remote exit {code}: {cmd[:120]}")
        return out

    sftp = ssh.open_sftp()

    print("=== 1. SNAPSHOT ===")
    snap = f"/root/snapshots/asgard-logfixes-{STAMP}.tgz"
    run("mkdir -p /root/snapshots")
    snap_list = " ".join(TAR_PATHS)
    run(f"tar -czf {snap} -C {REMOTE} {snap_list}", check=False)
    run(f"ls -lh {snap}", check=False)
    print(f"snapshot: {snap}")

    print("=== 2. tar + scp ===")
    tar_path = Path(tempfile.gettempdir()) / f"asgard-logfixes-{STAMP}.tar.gz"
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in TAR_PATHS:
            tar.add(str(ROOT / rel), arcname=rel.replace("\\", "/"))
    remote_tar = f"/tmp/asgard-logfixes-{STAMP}.tar.gz"
    print(f"local tar: {tar_path} ({tar_path.stat().st_size // 1024} KB)")
    sftp.put(str(tar_path), remote_tar)
    run(f"ls -lh {remote_tar}")
    run(f"tar -xzf {remote_tar} -C {REMOTE} && rm -f {remote_tar}")

    print("=== 3. MD5 verify ===")
    for rel in TAR_PATHS:
        local_md5 = md5((ROOT / rel).read_bytes())
        with sftp.file(f"{REMOTE}/{rel}", "rb") as rf:
            remote_md5 = md5(rf.read())
        ok = local_md5 == remote_md5
        print(f"  {'OK  ' if ok else 'FAIL'} {rel}  {local_md5[:10]}")
        if not ok:
            raise SystemExit(f"md5 mismatch: {rel}")

    print("=== 4. RESTART + HEALTH ===")
    run("systemctl restart asgard-crm")
    healthy = False
    for i in range(1, 10):
        time.sleep(2)
        out = run(
            "systemctl is-active asgard-crm; "
            "curl -sS -o /dev/null -w 'http=%{http_code}\\n' http://127.0.0.1:3000/api/health || true",
            check=False,
        )
        if "active" in out and "http=200" in out:
            healthy = True
            print(f"health OK on try {i}")
            break
        print(f"health wait {i}: {out.strip()!r}")
    if not healthy:
        raise SystemExit("health failed after restart")

    print("=== 5. PROD MARKERS ===")
    run(f"grep -n 'file_path\\|mime_type' {REMOTE}/src/services/crm-mailer.js | head -8")
    run(f"grep -n 'Connection not available' {REMOTE}/src/services/log-monitor-cron.js | head -5")
    run(f"grep -n 'rateLimit: false' {REMOTE}/src/routes/sse.js {REMOTE}/src/routes/push.js | head -8")

    print(f"\nDONE deploy logfixes {VER}  snap={snap}")
    sftp.close()
    ssh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
