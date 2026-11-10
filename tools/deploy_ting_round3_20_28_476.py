#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy Ting round-3: soft mid-call chrome, Session camera parity, roster 15, shell 20.28.476."""
from __future__ import annotations

import hashlib
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
import ting_live_guard  # noqa: E402
import paramiko

VER = "20.28.476"
SSH_HOST, SSH_USER = "92.242.61.184", "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

FILES = [
    "public/index.html",
    "public/sw.js",
    "public/h/index.html",
    "public/h/sw.js",
    "public/assets/js/ting_page.js",
    "public/assets/js/ting_session.js",
    "public/assets/js/huginn_ting.js",
    "public/assets/css/ting.css",
    "public/assets/css/ting-tv.css",
    "public/ting-tv/index.html",
    "public/ting/index.html",
    "tests/ting_wipe_guard.test.js",
]

NEEDLES = [
    ("public/assets/js/ting_page.js", "function softRoomChrome", "softRoomChrome"),
    ("public/assets/js/ting_page.js", "Math.min(15,", "demoRoster 15"),
    ("public/assets/js/ting_page.js", "enableLocalCamera: enableLocalCamera", "AsgardTing cam export"),
    ("public/assets/js/ting_session.js", "T-SESS-01", "session camera parity"),
    ("public/assets/js/ting_page.js", "harnessDemo()", "harness adopt skip"),
]


def md5(p: Path) -> str:
    h = hashlib.md5()
    h.update(p.read_bytes())
    return h.hexdigest()


def main() -> int:
    print("=== 0. guards ===")
    for cmd in (
        ["node", str(ROOT / "tests" / "ting_wipe_guard.test.js")],
        ["node", str(ROOT / "tests" / "ting_premium_layout.test.js")],
        ["node", str(ROOT / "tools" / "bump_shell_version.js"), "--check", VER],
    ):
        r = subprocess.run(cmd, cwd=str(ROOT))
        if r.returncode != 0:
            return r.returncode

    print("=== 0a. shell_guard ===")
    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=False)

    print("=== 0b. ting_live_guard --ssh ===")
    if ting_live_guard.check(ssh=True) != 0:
        raise SystemExit("ting_live_guard BLOCK")

    for rel, needle, label in NEEDLES:
        text = (ROOT / rel).read_text(encoding="utf-8", errors="replace")
        if needle not in text:
            raise SystemExit(f"NEEDLE FAIL {rel}: {label}")
        print(f"OK  {label}")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, key_filename=SSH_KEY, timeout=30)

    def run(cmd: str, check: bool = True, timeout: int = 120):
        print(f"$ {cmd[:220]}")
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
        return code, out, err

    run(
        f"mkdir -p /root/snapshots && tar -czf /root/snapshots/ting-round3-{STAMP}.tgz -C {REMOTE} "
        f"public/assets/js/ting_page.js public/assets/js/ting_session.js "
        f"public/assets/js/huginn_ting.js public/ting-tv/index.html public/index.html public/sw.js 2>/dev/null || true"
    )

    with tempfile.NamedTemporaryFile(suffix=".tgz", delete=False) as tmp:
        tar_path = Path(tmp.name)
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            p = ROOT / rel
            if p.exists():
                tar.add(p, arcname=rel)

    sftp = ssh.open_sftp()
    remote_tar = f"/tmp/ting-round3-{STAMP}.tgz"
    sftp.put(str(tar_path), remote_tar)
    sftp.close()
    tar_path.unlink(missing_ok=True)

    run(f"tar -xzf {remote_tar} -C {REMOTE}")
    run(f"rm -f {remote_tar}")
    run("systemctl restart asgard-crm")
    run("sleep 2; systemctl is-active asgard-crm")

    for rel, needle, label in NEEDLES:
        remote = f"{REMOTE}/{rel}"
        py = (
            "python3 - <<'PY'\n"
            f"p={remote!r}\n"
            f"n={needle!r}\n"
            "t=open(p,encoding='utf-8',errors='replace').read()\n"
            "print('OK' if n in t else 'FAIL', n[:48])\n"
            "raise SystemExit(0 if n in t else 1)\n"
            "PY"
        )
        run(py)
        print(f"PROOF {label}")

    for rel in FILES:
        p = ROOT / rel
        if not p.exists():
            continue
        h = md5(p)
        _c, out, _ = run(f"md5sum {REMOTE}/{rel} | awk '{{print $1}}'")
        if (out or "").strip() != h:
            raise SystemExit(f"MD5 mismatch {rel}")
        print(f"MD5 OK {rel}")

    print(f"=== DONE ting-round3-{STAMP} shell={VER} ===")
    ssh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
