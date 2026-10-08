#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy Ting rail + P0 token/light/SSE (shell 20.28.75). Explicit file list only.

  python tools/deploy_ting_rail_comms_20_28_75.py
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

VER = "20.28.75"
SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

FILES = [
    "public/index.html",
    "public/sw.js",
    "public/assets/css/huginn_dock.css",
    "public/assets/css/ting.css",
    "public/assets/js/app.js",
    "public/assets/js/huginn_dock.js",
    "public/assets/js/huginn_sse.js",
    "public/assets/js/huginn_ting.js",
    "public/assets/js/ting_page.js",
    "public/assets/js/ting_session.js",
    "src/routes/thing.js",
    "src/services/thing-livekit.js",
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
    print("=== 0. PRE-FLIGHT shell_guard (shell only) ===")
    # Working tree may have unrelated ahead commits (file-disjoint parallel work).
    # Gate this package against .last-verified feature hash + shell integrity.
    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=False)
    lv = (ROOT / "tests" / "reports" / ".last-verified").read_text(encoding="utf-8").strip()
    feat = "2b20524d031b91dc8ccef0e5fc47c52432c2567c"
    if lv != feat:
        raise SystemExit(f".last-verified mismatch: {lv} != {feat}")
    print(f"shell_guard: OK; package verified at {feat[:12]}")

    for rel in FILES:
        if not (ROOT / rel).is_file():
            raise SystemExit(f"missing: {rel}")

    idx = (ROOT / "public/index.html").read_text(encoding="utf-8")
    for marker in (
        "ting_session.js",
        "huginn_ting.js",
        f"ASGARD_SHELL_VERSION = '{VER}'",
        "billing.js",
        "nd-permits.js",
    ):
        if marker not in idx:
            raise SystemExit(f"index.html missing marker: {marker}")

    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45)

    def run(cmd: str, check: bool = True) -> str:
        print(f"$ {cmd}")
        _i, o, e = ssh.exec_command(cmd, timeout=300)
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

    snap = f"/root/snapshots/asgard-crm-pre-deploy-ting-rail-{STAMP}.tgz"
    run(
        "mkdir -p /root/snapshots && tar -czf {snap} -C {remote} "
        "public/index.html public/sw.js "
        "public/assets/css/huginn_dock.css public/assets/css/ting.css "
        "public/assets/js/app.js public/assets/js/huginn_dock.js "
        "public/assets/js/huginn_sse.js public/assets/js/huginn_ting.js "
        "public/assets/js/ting_page.js "
        "src/routes/thing.js src/services/thing-livekit.js "
        "2>/dev/null || tar -czf {snap} -C {remote} "
        "public/index.html public/sw.js "
        "public/assets/css/huginn_dock.css public/assets/css/ting.css "
        "public/assets/js/huginn_dock.js public/assets/js/huginn_ting.js "
        "public/assets/js/ting_page.js "
        "src/routes/thing.js src/services/thing-livekit.js".format(
            snap=snap, remote=REMOTE
        )
    )
    print(f"snapshot: {snap}")

    with tempfile.NamedTemporaryFile(suffix=".tgz", delete=False) as tmp:
        tar_path = Path(tmp.name)
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            tar.add(ROOT / rel, arcname=rel)
    sftp = ssh.open_sftp()
    remote_tar = f"/tmp/asgard-ting-rail-{STAMP}.tgz"
    sftp.put(str(tar_path), remote_tar)
    sftp.close()
    tar_path.unlink(missing_ok=True)

    run(f"tar -xzf {remote_tar} -C {REMOTE} && rm -f {remote_tar}")
    run("systemctl restart asgard-crm")
    run(
        "for i in 1 2 3 4 5 6 7 8; do "
        "code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health || true); "
        "echo try_$i:$code; [ \"$code\" = 200 ] && break; sleep 2; done"
    )
    run(
        f"grep -o \"ASGARD_SHELL_VERSION = '[^']*'\" {REMOTE}/public/index.html | head -1; "
        f"grep -o \"SHELL_VERSION = '[^']*'\" {REMOTE}/public/sw.js | head -1; "
        f"test -f {REMOTE}/public/assets/js/ting_session.js && echo ting_session:OK; "
        f"grep -c 'mountPanel' {REMOTE}/public/assets/js/huginn_ting.js; "
        f"grep -c 'ensureRoomMediaName' {REMOTE}/src/routes/thing.js; "
        f"grep -c 'data-theme=\"light\"' {REMOTE}/public/assets/css/ting.css; "
        f"grep -c 'shouldSkipNetwork' {REMOTE}/public/assets/js/huginn_sse.js"
    )
    ssh.close()
    print(f"=== DONE ting rail comms {VER} ===")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
