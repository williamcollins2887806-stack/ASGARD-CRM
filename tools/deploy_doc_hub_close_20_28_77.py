#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy Doc Hub close scope (shell 20.28.77). Uses committed tree at FEATURE_COMMIT."""
from __future__ import annotations

import subprocess
import sys
import tarfile
import tempfile
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import shell_guard  # noqa: E402
import paramiko

VER = "20.28.77"
SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

FILES = [
    "public/index.html",
    "public/sw.js",
    "public/assets/css/doc-hub.css",
    "public/assets/js/doc-hub.js",
    "public/assets/js/billing.js",
    "src/routes/doc-registry.js",
    "src/routes/invoices.js",
    "src/routes/acts.js",
    "src/services/doc-registry-upsert.js",
    "src/routes/payment-invoices.js",
    "tests/doc-hub-visual-capture.js",
    "tools/verify_doc_hub_e2_e5_f.js",
    "tools/doc_hub_fio_audit.js",
]


def git_show(commit: str, rel: str) -> bytes:
    return subprocess.run(
        ["git", "-C", str(ROOT), "show", f"{commit}:{rel}"],
        check=True,
        capture_output=True,
    ).stdout


def main() -> int:
    feature = subprocess.check_output(
        ["git", "-C", str(ROOT), "rev-parse", "HEAD"], text=True
    ).strip()
    print("=== 0. PRE-FLIGHT shell_guard ===")
    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=True)
    print(f"shell_guard OK; feature={feature[:12]} shell={VER}")

    stage = Path(tempfile.mkdtemp(prefix="doc-hub-close-"))
    for rel in FILES:
        try:
            dest = stage / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(git_show(feature, rel))
            print(f"  staged {rel}")
        except subprocess.CalledProcessError:
            print(f"  SKIP missing in commit: {rel}")

    key_loaders = (
        getattr(paramiko, "Ed25519Key", None),
        getattr(paramiko, "ECDSAKey", None),
        paramiko.RSAKey,
    )
    pkey = None
    for loader in key_loaders:
        if not loader:
            continue
        try:
            pkey = loader.from_private_key_file(SSH_KEY)
            break
        except Exception:
            continue
    if not pkey:
        raise SystemExit(f"cannot load SSH key {SSH_KEY}")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=pkey, timeout=45)

    def run(cmd: str) -> str:
        print(f"$ {cmd}")
        _i, o, e = ssh.exec_command(cmd, timeout=300)
        out = o.read().decode("utf-8", "replace")
        err = e.read().decode("utf-8", "replace")
        code = o.channel.recv_exit_status()
        if out:
            print(out[-4000:])
        if err.strip():
            print("STDERR:", err[:1500])
        if code != 0:
            raise SystemExit(f"remote failed ({code}): {cmd[:120]}")
        return out

    snap = f"/root/snapshots/asgard-crm-pre-doc-hub-close-{STAMP}.tar.gz"
    run(f"tar -czf {snap} -C {REMOTE} public/index.html public/sw.js public/assets/js/doc-hub.js public/assets/css/doc-hub.css src/routes/doc-registry.js 2>/dev/null || true")
    print("snapshot:", snap)

    tgz = Path(tempfile.gettempdir()) / f"doc-hub-close-{STAMP}.tar.gz"
    with tarfile.open(tgz, "w:gz") as tar:
        tar.add(stage, arcname=".")
    sftp = ssh.open_sftp()
    remote_tgz = f"/tmp/doc-hub-close-{STAMP}.tar.gz"
    sftp.put(str(tgz), remote_tgz)
    sftp.close()
    run(f"tar -xzf {remote_tgz} -C {REMOTE}")
    run("systemctl restart asgard-crm || pm2 restart asgard-crm || pm2 restart all")
    run(f"curl -sf http://127.0.0.1:3000/api/health | head -c 200")
    ssh.close()
    print("DEPLOY OK", VER, feature[:12])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
