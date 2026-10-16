#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy: Huginn — фикс триггера Ai-кнопки в композере (shell 20.28.212).

Состав (минимальный, регрессо-безопасный — только затронутые файлы):
  * public/assets/js/huginn_dock.js  (aiEligible: слова >=4 ИЛИ строки >=3;
                                      openAiEditorSheet использует ту же проверку)
  * public/index.html                (bump ASGARD_SHELL_VERSION → 20.28.212)
  * public/sw.js                     (bump SHELL_VERSION)
  * public/h/index.html              (bump ?v=)
  * public/h/sw.js                   (bump SHELL_VERSION)

Порядок: shell_guard(deploy-gate) → snapshot → tar+scp → restart → post-checks.
Откат:   tar -xzf <snap> -C /var/www/asgard-crm && systemctl restart asgard-crm
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

VER = "20.28.212"
SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

TAR_PATHS = [
    "public/assets/js/huginn_dock.js",
    "public/index.html",
    "public/sw.js",
    "public/h/index.html",
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


def connect_with_retry(key, attempts: int = 5):
    last = None
    for i in range(1, attempts + 1):
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        try:
            ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45,
                        banner_timeout=60, auth_timeout=60)
            print(f"ssh: connected (attempt {i})")
            return ssh
        except Exception as e:  # noqa: BLE001 — сеть нестабильна, нужен ретрай
            last = e
            print(f"ssh: attempt {i} failed: {e}")
            try:
                ssh.close()
            except Exception:
                pass
            import time
            time.sleep(3)
    raise SystemExit(f"ssh: cannot connect after {attempts} attempts: {last}")


def main() -> int:
    print("=== 0. PRE-FLIGHT shell_guard ===")
    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=True)
    print("shell_guard: OK")

    for rel in TAR_PATHS:
        if not (ROOT / rel).exists():
            raise SystemExit(f"missing: {rel}")

    key = load_pkey(SSH_KEY)
    ssh = connect_with_retry(key)

    def run(cmd, check=True, timeout=600, stdin_data=None):
        print(f"$ {cmd[:180]}")
        _i, o, e = ssh.exec_command(cmd, timeout=timeout)
        if stdin_data is not None:
            _i.write(stdin_data)
            _i.channel.shutdown_write()
        out = o.read().decode("utf-8", "replace")
        err = e.read().decode("utf-8", "replace")
        code = o.channel.recv_exit_status()
        if out.strip():
            print(out.rstrip()[:4000])
        if err.strip():
            print(err.rstrip()[:2000], file=sys.stderr)
        if check and code != 0:
            raise SystemExit(f"remote exit {code}: {cmd[:120]}")
        return out

    # ── 1. snapshot ──
    print("=== 1. SNAPSHOT ===")
    snap = f"/root/snapshots/asgard-huginn-ai-{STAMP}.tgz"
    run(f"mkdir -p /root/snapshots && tar -czf {snap} -C {REMOTE} "
        f"public/assets/js/huginn_dock.js public/index.html public/sw.js "
        f"public/h/index.html public/h/sw.js 2>/dev/null || true")
    print(f"snapshot: {snap}")

    # ── 2. tar + scp кода ──
    print("=== 2. CODE tar+scp ===")
    tar_path = Path(tempfile.gettempdir()) / f"asgard-huginn-ai-{STAMP}.tar.gz"
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in TAR_PATHS:
            tar.add(str(ROOT / rel), arcname=rel)
    print(f"tar: {tar_path} ({tar_path.stat().st_size} B)")

    sftp = ssh.open_sftp()
    remote_tar = f"/tmp/asgard-huginn-ai-{STAMP}.tar.gz"
    sftp.put(str(tar_path), remote_tar)
    sftp.close()

    run(f"tar -xzf {remote_tar} -C {REMOTE}")
    run(f"rm -f {remote_tar}")

    # ── 3. рестарт ──
    print("=== 3. RESTART ===")
    run("systemctl restart asgard-crm")
    run("sleep 4; systemctl is-active asgard-crm")

    print("=== 3b. JS SYNTAX ON PROD ===")
    run(f"node --check {REMOTE}/public/assets/js/huginn_dock.js && echo 'huginn_dock.js: syntax OK'")

    # ── 4. post-checks ──
    print("=== 4. POST-CHECKS ===")
    run("for i in 1 2 3 4 5 6 7 8; do code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health || true); "
        "echo \"health try $i: $code\"; [ \"$code\" = \"200\" ] && break; sleep 3; done")
    run(f"grep -o \"ASGARD_SHELL_VERSION = '[0-9.]*'\" {REMOTE}/public/index.html | head -1")
    run(f"grep -o \"const SHELL_VERSION = '[0-9.]*'\" {REMOTE}/public/sw.js | head -1")
    run(f"grep -o \"const SHELL_VERSION = '[0-9.]*'\" {REMOTE}/public/h/sw.js | head -1")
    # маркеры нового кода: aiEligible есть, старого условия lines < 4 нет
    run(f"echo -n 'aiEligible(должно >0): '; grep -c 'function aiEligible' {REMOTE}/public/assets/js/huginn_dock.js || true")
    run(f"echo -n 'старый порог lines < 4 (должно 0): '; grep -c 'lines < 4' {REMOTE}/public/assets/js/huginn_dock.js || true")
    run(f"echo -n 'AI_MIN_WORDS(должно >0): '; grep -c 'AI_MIN_WORDS' {REMOTE}/public/assets/js/huginn_dock.js || true")
    # ?v= в /h/index.html согласован с версией
    run(f"echo -n 'h/index.html ?v=20.28.212: '; grep -c 'huginn_dock.js?v=20.28.212' {REMOTE}/public/h/index.html || true")
    run("curl -s -o /dev/null -w 'root:%{http_code} ' http://127.0.0.1:3000/ ; "
        "curl -s -o /dev/null -w 'h/:%{http_code}\\n' http://127.0.0.1:3000/h/")
    # контроль UTF-8 (класс D-142b) на критичном index.html
    run(f"python3 - <<'PY'\n"
        f"p='{REMOTE}/public/index.html'\n"
        f"b=open(p,'rb').read()\n"
        f"print('BOM:', b[:3]==b'\\xef\\xbb\\xbf', 'U+FFFD:', b.count(b'\\xef\\xbf\\xbd'))\n"
        f"PY")

    print(f"\n=== DONE. Rollback: tar -xzf {snap} -C {REMOTE} && systemctl restart asgard-crm ===")
    ssh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
