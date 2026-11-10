#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy Ting Premium No Shortcuts (layout non-wipe, TV 1-15, dial-in guard, visual).

ALWAYS: ting_live_guard --ssh before restart. Mid-call restart = 502 (Confidence).
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

VER = "20.28.474"
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
    "public/assets/js/ting_room_core.js",
    "public/assets/css/ting.css",
    "public/assets/css/ting-tv.css",
    "public/ting-tv/index.html",
    "public/ting/index.html",
    "src/routes/thing.js",
    "tools/ting_live_guard.py",
    "tools/audit_ting_deploy_guards.py",
    "tools/ting_dialin_apply.py",
    "tests/ting_premium_layout.test.js",
]

NEEDLES = [
    ("public/assets/js/ting_page.js", "function relayoutTiles", "CRM relayoutTiles"),
    ("public/assets/js/ting_page.js", "hasTiles", "AS no wipe if tiles"),
    ("public/ting-tv/index.html", "function hallModeFor", "TV hall modes"),
    ("public/ting-tv/index.html", "syncRosterTiles", "TV soft roster"),
    ("public/assets/css/ting-tv.css", "overflow: hidden", "TV no scroll"),
    ("src/routes/thing.js", "CRM_MAIN_DID", "reject main DID"),
]


def md5(p: Path) -> str:
    h = hashlib.md5()
    h.update(p.read_bytes())
    return h.hexdigest()


def main() -> int:
    print("=== 0. local layout test ===")
    r = subprocess.run(["node", str(ROOT / "tests" / "ting_premium_layout.test.js")], cwd=str(ROOT))
    if r.returncode != 0:
        return r.returncode

    print("=== 0a. shell_guard (UTF-8/version; deploy-gate отдельно после .last-verified) ===")
    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=False)

    print("=== 0b. ting_live_guard --ssh ===")
    if ting_live_guard.check(ssh=True) != 0:
        raise SystemExit(
            "ting_live_guard BLOCK: live rooms — можно scp файлы без restart; "
            "этот скрипт останавливается (не роняем mid-call)."
        )

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
        f"mkdir -p /root/snapshots && tar -czf /root/snapshots/ting-premium-{STAMP}.tgz -C {REMOTE} "
        f"public/assets/js/ting_page.js public/assets/css/ting.css public/assets/css/ting-tv.css "
        f"public/ting-tv/index.html src/routes/thing.js 2>/dev/null || true"
    )

    with tempfile.NamedTemporaryFile(suffix=".tgz", delete=False) as tmp:
        tar_path = Path(tmp.name)
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            p = ROOT / rel
            if p.exists():
                tar.add(p, arcname=rel)

    sftp = ssh.open_sftp()
    remote_tar = f"/tmp/ting-premium-{STAMP}.tgz"
    sftp.put(str(tar_path), remote_tar)
    tar_path.unlink(missing_ok=True)
    run(f"tar -xzf {remote_tar} -C {REMOTE} && rm -f {remote_tar}")

    print("=== restart (live=0 already checked) ===")
    run("systemctl restart asgard-crm")
    run("systemctl is-active asgard-crm")
    print(f"DONE deploy Ting Premium {VER} stamp={STAMP}")
    ssh.close()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
