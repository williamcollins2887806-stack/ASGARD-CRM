#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy the 5 PENDING_DEPLOY assets + refreshed mobile bundle (shell stays 20.28.115)."""
from __future__ import annotations

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

VER = "20.28.115"
SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

FILES = [
    "public/assets/css/design-tokens.css",
    "public/assets/js/custom_dashboard.js",
    "public/assets/js/mimir.js",
    "public/assets/js/pm_works.js",
    "public/assets/js/tenders.js",
]


def load_pkey(path: str):
    for loader in (
        getattr(paramiko, "Ed25519Key", None),
        getattr(paramiko, "ECDSAKey", None),
        paramiko.RSAKey,
    ):
        if loader is None:
            continue
        try:
            return loader.from_private_key_file(path)
        except Exception:
            continue
    raise SystemExit(f"cannot load SSH key: {path}")


def main() -> int:
    print("=== 0. PRE-FLIGHT shell_guard ===")
    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=False)
    print("shell_guard: OK")

    for rel in FILES:
        if not (ROOT / rel).is_file():
            raise SystemExit(f"missing: {rel}")

    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45)

    def run(cmd: str, check: bool = True, timeout: int = 600) -> str:
        print(f"$ {cmd[:200]}")
        _i, o, e = ssh.exec_command(cmd, timeout=timeout)
        out = o.read().decode("utf-8", "replace")
        err = e.read().decode("utf-8", "replace")
        code = o.channel.recv_exit_status()
        if out.strip():
            print(out.rstrip())
        if err.strip():
            print(err.rstrip(), file=sys.stderr)
        if check and code != 0:
            raise SystemExit(f"remote exit {code}: {cmd}")
        return out

    snap = f"/root/snapshots/asgard-crm-pre-assetsync-{STAMP}.tgz"
    run(
        "mkdir -p /root/snapshots && tar -czf {snap} -C {remote} "
        "public/assets/css/design-tokens.css public/assets/js/custom_dashboard.js "
        "public/assets/js/mimir.js public/assets/js/pm_works.js public/assets/js/tenders.js "
        "2>/dev/null || true".format(snap=snap, remote=REMOTE)
    )
    print(f"snapshot: {snap}")

    # tar the 5 assets + the whole mobile bundle dir (new hashed chunks)
    stage = Path(tempfile.mkdtemp(prefix="assetsync-"))
    for rel in FILES:
        dest = stage / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes((ROOT / rel).read_bytes())

    tar_path = Path(tempfile.gettempdir()) / f"assetsync-{VER}-{STAMP}.tar.gz"
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            tar.add(stage / rel, arcname=rel)
        tar.add(str(ROOT / "public/m/assets"), arcname="public/m/assets")
        tar.add(str(ROOT / "public/m/index.html"), arcname="public/m/index.html")

    sftp = ssh.open_sftp()
    remote_tar = f"/tmp/assetsync-{VER}-{STAMP}.tar.gz"
    sftp.put(str(tar_path), remote_tar)
    sftp.close()

    run(f"tar -xzf {remote_tar} -C {REMOTE}")
    run(f"rm -f {remote_tar}")
    run(f"find {REMOTE}/public/m/assets -type f -exec chmod 644 {{}} \\;")
    run(f"chmod 755 {REMOTE}/public/m/assets")
    run("systemctl restart asgard-crm")
    run("systemctl is-active asgard-crm")
    run(
        "cd {remote} && for f in public/assets/css/design-tokens.css "
        "public/assets/js/custom_dashboard.js public/assets/js/mimir.js "
        "public/assets/js/pm_works.js public/assets/js/tenders.js; do "
        "printf '%s  %s\\n' \"$(md5sum $f | cut -c1-12)\" \"$f\"; done".format(remote=REMOTE)
    )
    run(f"ls {REMOTE}/public/m/assets | wc -l")
    run(f"curl -s -o /dev/null -w 'm-index:%{{http_code}}\\n' http://127.0.0.1:3000/m/index.html")

    ssh.close()
    print("=== DEPLOY OK ===", VER)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
