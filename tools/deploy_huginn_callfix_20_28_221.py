#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Targeted deploy: модалка звонка в .hg-sheets-host + рингтон (shell 20.28.221).

Файлы:
  * public/assets/js/huginn_calls.js   (callHost + ringtone incoming/outgoing)
  * public/assets/js/ting_common.js    (startRing/stopRing + вибрация)
  * public/assets/css/huginn_dock.css  (фолбэк .hg-calls-host)
  * public/h/index.html                (ting_common.js + сторож VER)
  * public/index.html, public/sw.js, public/h/sw.js (bump 20.28.221)

Откат: tar -xzf <snap> -C /var/www/asgard-crm && systemctl restart asgard-crm
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
import paramiko  # noqa: E402

SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
VER = "20.28.221"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

TAR_PATHS = [
    "public/assets/js/huginn_calls.js",
    "public/assets/js/ting_common.js",
    "public/assets/css/huginn_dock.css",
    "public/h/index.html",
    "public/index.html",
    "public/sw.js",
    "public/h/sw.js",
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


def main() -> int:
    for rel in TAR_PATHS:
        if not (ROOT / rel).exists():
            raise SystemExit(f"missing: {rel}")

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
            import time
            time.sleep(4)

    def run(cmd, check=True):
        print(f"$ {cmd[:165]}")
        _i, o, e = ssh.exec_command(cmd, timeout=600)
        out = o.read().decode("utf-8", "replace")
        err = e.read().decode("utf-8", "replace")
        code = o.channel.recv_exit_status()
        if out.strip():
            print(out.rstrip()[:3000])
        if err.strip():
            print(err.rstrip()[:1200], file=sys.stderr)
        if check and code != 0:
            raise SystemExit(f"remote exit {code}: {cmd[:110]}")
        return out

    print("=== 1. SNAPSHOT ===")
    snap = f"/root/snapshots/asgard-callfix2-{STAMP}.tgz"
    run(f"mkdir -p /root/snapshots && tar -czf {snap} -C {REMOTE} " + " ".join(TAR_PATHS) + " 2>/dev/null || true")
    print(f"snapshot: {snap}")

    print("=== 2. tar+scp ===")
    tar_path = Path(tempfile.gettempdir()) / f"asgard-callfix2-{STAMP}.tar.gz"
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in TAR_PATHS:
            tar.add(str(ROOT / rel), arcname=rel)
    print(f"tar: {tar_path} ({tar_path.stat().st_size} B)")
    sftp = ssh.open_sftp()
    remote_tar = f"/tmp/asgard-callfix2-{STAMP}.tar.gz"
    sftp.put(str(tar_path), remote_tar)
    sftp.close()
    run(f"tar -xzf {remote_tar} -C {REMOTE}")
    run(f"rm -f {remote_tar}")

    print("=== 3. SYNTAX ===")
    run(f"for f in public/assets/js/huginn_calls.js public/assets/js/ting_common.js; do "
        f"node --check {REMOTE}/$f || echo \"SYNTAX FAIL: $f\"; done; echo 'checked'")

    print("=== 4. POST-CHECKS ===")
    run(f"echo -n 'callHost (слой): '; grep -c 'function callHost' {REMOTE}/public/assets/js/huginn_calls.js")
    run(f"echo -n 'hg-sheets-host: '; grep -c 'hg-sheets-host' {REMOTE}/public/assets/js/huginn_calls.js")
    run(f"echo -n 'old panelHost (want 0): '; grep -c 'function panelHost' {REMOTE}/public/assets/js/huginn_calls.js || true")
    run(f"echo -n 'startRing: '; grep -c 'startRing' {REMOTE}/public/assets/js/ting_common.js")
    run(f"echo -n 'stopRing: '; grep -c 'stopRing' {REMOTE}/public/assets/js/ting_common.js")
    run(f"echo -n 'ringtone incoming: '; grep -c 'ringtone(true, true)' {REMOTE}/public/assets/js/huginn_calls.js")
    run(f"echo -n 'ringtone outgoing: '; grep -c 'ringtone(true, false)' {REMOTE}/public/assets/js/huginn_calls.js")
    run(f"echo -n '/h/ ting_common: '; grep -c 'ting_common.js' {REMOTE}/public/h/index.html")
    run(f"echo -n 'hg-calls-host css: '; grep -c '.hg-calls-host' {REMOTE}/public/assets/css/huginn_dock.css")
    run(f"echo -n 'index ver: '; grep -o \"ASGARD_SHELL_VERSION = '[0-9.]*'\" {REMOTE}/public/index.html | head -1")
    run(f"echo -n 'h/sw ver: '; grep -o \"const SHELL_VERSION = '[0-9.]*'\" {REMOTE}/public/h/sw.js | head -1")
    run(f"echo -n 'h guard VER: '; grep -o \"var VER = '[0-9.]*'\" {REMOTE}/public/h/index.html | head -1")

    print("=== 5. HTTP ===")
    run("curl -s -o /dev/null -w 'root:%{http_code} ' http://127.0.0.1:3000/ ; "
        "curl -s -o /dev/null -w 'h/:%{http_code} ' http://127.0.0.1:3000/h/ ; "
        "curl -s -o /dev/null -w 'css:%{http_code} ' 'http://127.0.0.1:3000/assets/css/huginn_dock.css?v=20.28.221' ; "
        "curl -s -o /dev/null -w 'health:%{http_code}\\n' http://127.0.0.1:3000/api/health")
    run("curl -s http://127.0.0.1:3000/api/version")

    print(f"\n=== DONE. Rollback: tar -xzf {snap} -C {REMOTE} && systemctl restart asgard-crm ===")
    ssh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
