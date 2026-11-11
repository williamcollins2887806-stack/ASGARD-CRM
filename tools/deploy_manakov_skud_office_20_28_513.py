#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy: Манаков↔Айти СКУД + фикс 72ч «прочих» + day staff_id=0, shell 20.28.513."""
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
VER = "20.28.513"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

TAR_FILES = [
    "src/services/skud-xls.js",
    "src/services/skud-people.js",
    "src/routes/office-attendance.js",
    "public/assets/js/office_schedule.js",
    "public/index.html",
    "public/sw.js",
    "public/h/index.html",
    "public/h/sw.js",
]

MARKERS = [
    ("src/services/skud-xls.js", "isNextCalendarDay", "calendar next-day guard"),
    ("src/services/skud-people.js", "isNextCalendarDay", "extras calendar guard"),
    ("src/routes/office-attendance.js", "role_tag", "office role_tag in month"),
    ("public/assets/js/office_schedule.js", "привяжите ФИО в CRM", "extras contextmenu guard"),
    ("public/sw.js", f"SHELL_VERSION = '{VER}'", f"shell {VER}"),
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
    for attempt in range(1, 8):
        try:
            ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45, banner_timeout=90, auth_timeout=90)
            print(f"ssh: connected (attempt {attempt})")
            break
        except Exception as e:
            print(f"ssh: attempt {attempt} failed: {e}")
            if attempt == 7:
                raise SystemExit("ssh: cannot connect")
            time.sleep(5)

    def run(cmd, check=True, timeout=600):
        print(f"$ {cmd[:260]}")
        _i, o, e = ssh.exec_command(cmd, timeout=timeout)
        out = o.read().decode("utf-8", "replace")
        err = e.read().decode("utf-8", "replace")
        code = o.channel.recv_exit_status()
        if out.strip():
            print(out.rstrip()[:8000])
        if err.strip():
            print(err.rstrip()[:2000], file=sys.stderr)
        if check and code != 0:
            raise SystemExit(f"remote exit {code}: {cmd[:140]}")
        return out

    sftp = ssh.open_sftp()

    print("=== 1. SNAPSHOT ===")
    snap = f"/root/snapshots/asgard-manakov-skud-{STAMP}.tgz"
    run("mkdir -p /root/snapshots")
    run(f"tar -czf {snap} -C {REMOTE} {' '.join(TAR_FILES)} 2>/dev/null || true", check=False)

    print("=== 2. tar + scp code ===")
    tar_path = Path(tempfile.gettempdir()) / f"asgard-manakov-skud-{STAMP}.tar.gz"
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in TAR_FILES:
            tar.add(str(ROOT / rel), arcname=rel.replace("\\", "/"))
    remote_tar = f"/tmp/asgard-manakov-skud-{STAMP}.tar.gz"
    sftp.put(str(tar_path), remote_tar)
    run(f"tar -xzf {remote_tar} -C {REMOTE} && rm -f {remote_tar}")

    print("=== 3. MD5 ===")
    for rel in TAR_FILES:
        local_md5 = md5((ROOT / rel).read_bytes())
        with sftp.file(f"{REMOTE}/{rel}", "rb") as rf:
            remote_md5 = md5(rf.read())
        ok = local_md5 == remote_md5
        print(f"  {'OK  ' if ok else 'FAIL'} {rel}")
        if not ok:
            raise SystemExit(f"md5 mismatch: {rel}")

    print("=== 4. upload link scripts ===")
    for local_name, remote_name in (
        (ROOT / "tmp" / "_link_manakov.sh", "/tmp/_link_manakov.sh"),
        (ROOT / "tmp" / "_recount_aiti.js", "/tmp/_recount_aiti.js"),
    ):
        sftp.put(str(local_name), remote_name)
    run("chmod +x /tmp/_link_manakov.sh")

    print("=== 5. RESTART + HEALTH ===")
    run("systemctl restart asgard-crm")
    healthy = False
    for i in range(1, 14):
        time.sleep(2)
        code = run(
            "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health || true",
            check=False,
        ).strip()
        print(f"  health try {i}: {code}")
        if code == "200":
            healthy = True
            break
    if not healthy:
        raise SystemExit("health not 200")

    print("=== 6. LINK MANAKOV + RECOUNT ===")
    run("bash /tmp/_link_manakov.sh", timeout=180)

    print("=== 7. PROD MARKERS ===")
    run(f"grep -n 'isNextCalendarDay' {REMOTE}/src/services/skud-xls.js | head -3")
    run(f"grep -o \"SHELL_VERSION = '[0-9.]*'\" {REMOTE}/public/sw.js | head -1")

    sftp.close()
    ssh.close()
    print(f"═══ DONE {VER}. snapshot: {snap} ═══")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
