#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy Huginn ROUND-7 (shell 20.28.76). Explicit file list from git commit only.

  python tools/deploy_huginn_round7_20_28_76.py

Packages blobs from FEATURE_COMMIT (not dirty working tree) so parallel
telephony/mobile edits in WT are never uploaded.
"""
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

VER = "20.28.76"
FEATURE_COMMIT = "ee5bbfb442e4647ec15ecefff774954356696746"
SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

# Shell + Huginn ROUND-7 frontend + /h + guest ACL wiring.
# Backend huginn_ext/events/acl/stt/V364 already on prod (sha match 040cd177).
FILES = [
    "public/index.html",
    "public/sw.js",
    "public/assets/css/huginn_dock.css",
    "public/assets/js/huginn_dock.js",
    "public/assets/js/huginn_sse.js",
    "src/index.js",
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


def git_show(commit: str, rel: str) -> bytes:
    return subprocess.run(
        ["git", "-C", str(ROOT), "show", f"{commit}:{rel}"],
        check=True,
        capture_output=True,
    ).stdout


def main() -> int:
    print("=== 0. PRE-FLIGHT shell_guard ===")
    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=True)
    lv = (ROOT / "tests" / "reports" / ".last-verified").read_text(encoding="utf-8").strip()
    if lv != FEATURE_COMMIT:
        raise SystemExit(f".last-verified mismatch: {lv} != {FEATURE_COMMIT}")
    print(f"shell_guard: OK; feature={FEATURE_COMMIT[:12]} shell={VER}")

    stage = Path(tempfile.mkdtemp(prefix="huginn-r7-"))
    for rel in FILES:
        dest = stage / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(git_show(FEATURE_COMMIT, rel))
        print(f"  staged {rel} ({dest.stat().st_size} B)")

    idx = (stage / "public/index.html").read_text(encoding="utf-8")
    for marker in (
        f"ASGARD_SHELL_VERSION = '{VER}'",
        "billing.js",
        "nd-permits.js",
        "huginn_dock.js",
        "huginn_sse.js",
    ):
        if marker not in idx:
            raise SystemExit(f"index.html missing marker: {marker}")
    sw = (stage / "public/sw.js").read_text(encoding="utf-8")
    if f"SHELL_VERSION = '{VER}'" not in sw:
        raise SystemExit("sw.js version mismatch")
    dock = (stage / "public/assets/js/huginn_dock.js").read_text(encoding="utf-8")
    if "applyFxMode" not in dock or "data-hg-tab" not in dock:
        raise SystemExit("huginn_dock.js missing ROUND-7 markers")
    sse = (stage / "public/assets/js/huginn_sse.js").read_text(encoding="utf-8")
    if "refreshOpenChat" in sse:
        raise SystemExit("huginn_sse.js still calls refreshOpenChat")
    idx_js = (stage / "src/index.js").read_text(encoding="utf-8")
    if "huginnIndexPath" not in idx_js or "huginn-acl" not in idx_js:
        raise SystemExit("src/index.js missing Huginn wiring")
    if "sendIncomingCallPush" in idx_js:
        raise SystemExit("src/index.js includes telephony PBX hunk — abort")

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

    snap = f"/root/snapshots/asgard-crm-pre-deploy-huginn-r7-{STAMP}.tgz"
    run(
        "mkdir -p /root/snapshots && tar -czf {snap} -C {remote} "
        "public/index.html public/sw.js "
        "public/assets/css/huginn_dock.css "
        "public/assets/js/huginn_dock.js public/assets/js/huginn_sse.js "
        "src/index.js".format(snap=snap, remote=REMOTE)
    )
    print(f"snapshot: {snap}")

    with tempfile.NamedTemporaryFile(suffix=".tgz", delete=False) as tmp:
        tar_path = Path(tmp.name)
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            tar.add(stage / rel, arcname=rel)
    sftp = ssh.open_sftp()
    remote_tar = f"/tmp/asgard-huginn-r7-{STAMP}.tgz"
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
        f"grep -c 'applyFxMode' {REMOTE}/public/assets/js/huginn_dock.js; "
        f"grep -c 'data-hg-tab' {REMOTE}/public/assets/js/huginn_dock.js; "
        f"grep -c 'refreshOpenChat' {REMOTE}/public/assets/js/huginn_sse.js || true; "
        f"grep -c 'huginnIndexPath' {REMOTE}/src/index.js; "
        f"grep -c 'huginn-acl' {REMOTE}/src/index.js; "
        f"grep -c 'sendIncomingCallPush' {REMOTE}/src/index.js || true; "
        f"sha256sum {REMOTE}/public/assets/css/huginn_dock.css "
        f"{REMOTE}/public/assets/js/huginn_dock.js "
        f"{REMOTE}/public/assets/js/huginn_sse.js "
        f"{REMOTE}/public/index.html {REMOTE}/public/sw.js {REMOTE}/src/index.js"
    )
    ssh.close()
    print(f"=== DONE huginn ROUND-7 {VER} ===")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
