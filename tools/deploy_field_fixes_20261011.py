#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy: Field mobile fixes (B1..B12) — backend field-auth.js + public/m bundle.

Shell version stays 20.28.185 (public/index.html, public/sw.js untouched).
Snapshot first; verify after. Rollback instructions printed.
"""
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

VER = "20.28.185"
SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")


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

    backend_local = ROOT / "src" / "routes" / "field-auth.js"
    m_dir = ROOT / "public" / "m"
    if not backend_local.is_file():
        raise SystemExit(f"missing: {backend_local}")
    if not (m_dir / "index.html").is_file():
        raise SystemExit("missing: public/m/index.html")

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

    # ── 1. SNAPSHOT ────────────────────────────────────────────────
    snap = f"/root/snapshots/asgard-field-fixes-{STAMP}.tgz"
    run(
        "mkdir -p /root/snapshots && tar -czf {snap} -C {remote} "
        "src/routes/field-auth.js public/m".format(snap=snap, remote=REMOTE)
    )
    print(f"snapshot: {snap}")

    # ── 2. BACKEND: field-auth.js ──────────────────────────────────
    sftp = ssh.open_sftp()
    sftp.put(str(backend_local), f"{REMOTE}/src/routes/field-auth.js")
    run(f"chmod 664 {REMOTE}/src/routes/field-auth.js")
    run(f"cd {REMOTE} && node --check src/routes/field-auth.js && echo BACKEND_SYNTAX_OK")
    sftp.close()

    # ── 3. MOBILE: public/m (full bundle) ──────────────────────────
    tar_path = Path(tempfile.gettempdir()) / f"asgard-m-field-{STAMP}.tar.gz"
    with tarfile.open(tar_path, "w:gz") as tar:
        tar.add(str(m_dir), arcname="public/m")
    print(f"tar: {tar_path} ({tar_path.stat().st_size} B)")

    sftp = ssh.open_sftp()
    remote_tar = f"/tmp/asgard-m-field-{STAMP}.tar.gz"
    sftp.put(str(tar_path), remote_tar)
    sftp.close()

    run(f"tar -xzf {remote_tar} -C {REMOTE}")
    run(f"rm -f {remote_tar}")
    run(f"find {REMOTE}/public/m -type f -exec chmod 644 {{}} \\;")
    run(f"find {REMOTE}/public/m -type d -exec chmod 755 {{}} \\;")

    # ── 4. RESTART ─────────────────────────────────────────────────
    run("systemctl restart asgard-crm")
    run("sleep 3; systemctl is-active asgard-crm")

    # ── 5. POST CHECKS ─────────────────────────────────────────────
    print("=== POST CHECKS ===")
    run(
        "cd {remote} && grep -q 'isValidPhone' src/routes/field-auth.js && "
        "grep -q 'findActiveEmployeesByPhone' src/routes/field-auth.js && "
        "grep -q 'need_employee_choice' src/routes/field-auth.js && echo BACKEND_MARKERS_OK".format(remote=REMOTE)
    )
    run(
        "cd {remote} && grep -q 'rel=\"manifest\"' public/m/index.html && "
        "grep -q 'apple-touch-icon' public/m/index.html && echo MOBILE_HEAD_OK".format(remote=REMOTE)
    )
    run(f"ls -la {REMOTE}/public/m/manifest.json {REMOTE}/public/m/apple-touch-icon.png")
    run(f"ls {REMOTE}/public/m/assets | grep -E '^index-.*\\.(js|css)$'")
    run("curl -s -o /dev/null -w 'm-index:%{http_code}\\n' http://127.0.0.1:3000/m/index.html")
    run("curl -s -o /dev/null -w 'm-manifest:%{http_code} type:%{content_type}\\n' http://127.0.0.1:3000/m/manifest.json")
    run("curl -s -o /dev/null -w 'm-apple-icon:%{http_code} type:%{content_type}\\n' http://127.0.0.1:3000/m/apple-touch-icon.png")
    run("curl -s http://127.0.0.1:3000/m/index.html | grep -oE '(manifest.json|apple-touch-icon[^\"]*|index-[A-Za-z0-9_-]+\\.js)' | sort -u")

    print(f"\n=== DONE. Rollback: tar -xzf {snap} -C {REMOTE} && systemctl restart asgard-crm ===")
    ssh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
