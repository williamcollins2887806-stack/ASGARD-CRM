#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy D-264: маска телефона больше не съедает буквы в текстовых полях.

Заливает из рабочего дерева (source of truth):
  - public/assets/js/phone_mask.js           (сама правка; shell-ассет)
  - public/m/phone_mask.js                   (копия для /m)
  - public/index.html, public/sw.js          (бамп SHELL_VERSION 20.28.191)
  - public/h/index.html, public/h/sw.js      (тот же бамп в /h)
  - public/m/index.html, public/m/phone_mask.js
  - public/mobile-app/public/phone_mask.js   (исходник копии, /m пересобирается из него)
  - public/v2/**                             (v2: канонизация телефонных полей)

Shell version в пакете УЖЕ поднят (tools/bump_shell_version.js), файлы менять не нужно.

Pre-flight: shell_guard (оболочка цела + deploy-gate).
Сначала snapshot на сервере, затем tar+scp, распаковка, рестарт, health-wait.
Печатает инструкцию откатa.
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

VER = "20.28.191"
SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

# Одиночные файлы из рабочего дерева
FILES = [
    "public/assets/js/phone_mask.js",
    "public/m/phone_mask.js",
    "public/mobile-app/public/phone_mask.js",
    "public/index.html",
    "public/sw.js",
    "public/h/index.html",
    "public/h/sw.js",
    "public/m/index.html",
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
    print("=== 0. PRE-FLIGHT shell_guard (оболочка + deploy-gate) ===")
    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=True)
    print("shell_guard: OK")

    v2_dir = ROOT / "public" / "v2"
    for rel in FILES:
        if not (ROOT / rel).is_file():
            raise SystemExit(f"missing: {rel}")
    if not (v2_dir / "index.html").is_file():
        raise SystemExit("missing public/v2 (собери: cd public/desktop-v2-src && npm run build)")

    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45)

    def run(cmd, check=True, timeout=600):
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

    # ── snapshot ──
    snap = f"/root/snapshots/asgard-d264-phone-mask-{STAMP}.tgz"
    run("mkdir -p /root/snapshots && tar -czf {snap} -C {remote} {files} public/m public/h public/v2 2>/dev/null || true".format(
        snap=snap, remote=REMOTE, files=" ".join(FILES)))
    print(f"snapshot: {snap}")

    # ── tar payload ──
    tar_path = Path(tempfile.gettempdir()) / f"asgard-d264-{STAMP}.tar.gz"
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            tar.add(str(ROOT / rel), arcname=rel)
        tar.add(str(v2_dir), arcname="public/v2")
    print(f"tar: {tar_path} ({tar_path.stat().st_size} B)")

    sftp = ssh.open_sftp()
    remote_tar = f"/tmp/asgard-d264-{STAMP}.tar.gz"
    sftp.put(str(tar_path), remote_tar)
    sftp.close()

    run(f"tar -xzf {remote_tar} -C {REMOTE}")
    run(f"rm -f {remote_tar}")
    run(f"find {REMOTE}/public/m -type f -exec chmod 644 {{}} \\; ; find {REMOTE}/public/m -type d -exec chmod 755 {{}} \\;")
    run("chmod 644 {r}/public/assets/js/phone_mask.js {r}/public/index.html {r}/public/sw.js {r}/public/h/index.html {r}/public/h/sw.js".format(r=REMOTE))

    run("systemctl restart asgard-crm")
    run("sleep 3; systemctl is-active asgard-crm")

    print("=== POST CHECKS ===")
    # 1) правка дошла: placeholder больше не участвует в опознании
    run("grep -c 'placeholder' {r}/public/assets/js/phone_mask.js || true".format(r=REMOTE))
    run("grep -c 'phoneStrength' {r}/public/assets/js/phone_mask.js".format(r=REMOTE))
    # 2) версия оболочки на проде
    run("grep -o \"ASGARD_SHELL_VERSION = '[0-9.]*'\" {r}/public/index.html".format(r=REMOTE))
    # 3) /m отдаёт новую маску
    run("grep -o 'phoneStrength' {r}/public/m/phone_mask.js | head -1".format(r=REMOTE))
    # 4) health
    run("for i in 1 2 3 4 5 6; do code=$(curl -s -o /dev/null -w '%{{http_code}}' http://127.0.0.1:3000/api/health || true); "
        "echo \"try $i: $code\"; [ \"$code\" = \"200\" ] && break; sleep 2; done")
    run("curl -s -o /dev/null -w 'root:%{http_code} ' http://127.0.0.1:3000/ ; "
        "curl -s -o /dev/null -w 'h:%{http_code} ' http://127.0.0.1:3000/h/ ; "
        "curl -s -o /dev/null -w 'm:%{http_code} ' http://127.0.0.1:3000/m/index.html ; "
        "curl -s -o /dev/null -w 'v2:%{http_code}\\n' http://127.0.0.1:3000/v2/index.html")
    # 5) инвариант правки на живом файле: строка с placeholder в опознании отсутствует
    run("grep -n 'getAttribute(.placeholder.)' {r}/public/assets/js/phone_mask.js || echo 'OK: placeholder вне опознания'".format(r=REMOTE))

    print(f"\n=== DONE. Rollback: tar -xzf {snap} -C {REMOTE} && systemctl restart asgard-crm ===")
    ssh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
