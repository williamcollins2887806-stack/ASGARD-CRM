#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy Ting incremental join / soft wipe round-2 (20.28.475).

ALWAYS: ting_live_guard --ssh before restart.
"""
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

VER = "20.28.475"
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
    "public/assets/js/huginn_ting.js",
    "public/assets/css/ting.css",
    "public/assets/css/ting-tv.css",
    "public/ting-tv/index.html",
    "public/ting/index.html",
    "tests/ting_wipe_guard.test.js",
]

NEEDLES = [
    ("public/assets/js/ting_page.js", "function ensureCrmParticipantTile", "incremental join"),
    ("public/assets/js/ting_page.js", "function reattachVideosToTiles", "soft reattach"),
    ("public/assets/js/ting_page.js", "missing.forEach((id) => ensureCrmParticipantTile(id))", "no join paintTiles"),
    ("public/assets/js/huginn_ting.js", "havePrimary && haveInset)", "huginn soft >2"),
    ("public/ting-tv/index.html", "T-TV-01", "TV reconnect"),
    ("public/ting-tv/index.html", "T-MUTE-02", "TV screen mute"),
]


def md5(p: Path) -> str:
    h = hashlib.md5()
    h.update(p.read_bytes())
    return h.hexdigest()


def main() -> int:
    print("=== 0. wipe guard ===")
    r = subprocess.run(["node", str(ROOT / "tests" / "ting_wipe_guard.test.js")], cwd=str(ROOT))
    if r.returncode != 0:
        return r.returncode
    r2 = subprocess.run(["node", str(ROOT / "tests" / "ting_premium_layout.test.js")], cwd=str(ROOT))
    if r2.returncode != 0:
        return r2.returncode

    print("=== 0a. shell_guard ===")
    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=False)

    print("=== 0b. ting_live_guard --ssh ===")
    if ting_live_guard.check(ssh=True) != 0:
        raise SystemExit("ting_live_guard BLOCK: live rooms — abort (no mid-call restart)")

    for rel, needle, label in NEEDLES:
        text = (ROOT / rel).read_text(encoding="utf-8", errors="replace")
        if needle not in text:
            raise SystemExit(f"NEEDLE FAIL {rel}: {label} ({needle!r})")
        print(f"OK  {label}")

    print("=== snapshot + upload ===")
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
        f"mkdir -p /root/snapshots && tar -czf /root/snapshots/ting-incjoin-{STAMP}.tgz -C {REMOTE} "
        f"public/assets/js/ting_page.js public/assets/js/huginn_ting.js "
        f"public/ting-tv/index.html public/index.html public/sw.js 2>/dev/null || true"
    )

    with tempfile.NamedTemporaryFile(suffix=".tgz", delete=False) as tmp:
        tar_path = Path(tmp.name)
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            p = ROOT / rel
            if p.exists():
                tar.add(p, arcname=rel)

    sftp = ssh.open_sftp()
    remote_tar = f"/tmp/ting-incjoin-{STAMP}.tgz"
    sftp.put(str(tar_path), remote_tar)
    sftp.close()
    tar_path.unlink(missing_ok=True)

    run(f"tar -xzf {remote_tar} -C {REMOTE}")
    run(f"rm -f {remote_tar}")

    # CDN / static only — restart Node not required for JS/CSS/shell bump,
    # but SW clients pick new version via ASGARD_SHELL_VERSION. Soft restart OK (live=0).
    print("=== restart (live=0) ===")
    run("systemctl restart asgard-crm")
    run("sleep 2; systemctl is-active asgard-crm")

    print("=== remote needle proof ===")
    for rel, needle, label in NEEDLES:
        remote = f"{REMOTE}/{rel}"
        code, out, _ = run(f"grep -F -c {needle!r} {remote} || true", check=False)
        # grep -c prints count; use python remote for unicode needles
        py = (
            "python3 - <<'PY'\n"
            f"p={remote!r}\n"
            f"n={needle!r}\n"
            "t=open(p,encoding='utf-8',errors='replace').read()\n"
            "print('OK' if n in t else 'FAIL', n[:40])\n"
            "raise SystemExit(0 if n in t else 1)\n"
            "PY"
        )
        run(py)
        print(f"PROOF {label}")

    local_md5 = {rel: md5(ROOT / rel) for rel in FILES if (ROOT / rel).exists()}
    for rel, h in local_md5.items():
        code, out, _ = run(f"md5sum {REMOTE}/{rel} | awk '{{print $1}}'")
        remote_h = (out or "").strip()
        if remote_h != h:
            raise SystemExit(f"MD5 mismatch {rel}: local={h} remote={remote_h}")
        print(f"MD5 OK {rel}")

    print(f"=== DONE ting-incjoin-{STAMP} shell={VER} ===")
    ssh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
