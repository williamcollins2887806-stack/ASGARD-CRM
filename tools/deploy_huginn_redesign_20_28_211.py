#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy: редизайн мессенджера «Хугинн» (shell 20.28.211).

Состав:
  * src/routes/huginn_ext.js            (SMS-код 6 цифр, accept-invite: direct = пара)
  * src/routes/chat_groups.js           (передача владения группой: role='owner')
  * public/assets/css/huginn_dock.css   (Depth&Juice, фиксы ревью: заголовок 17/600,
                                         пузыри без теней, тап-бар-капсула, бегунок)
  * public/assets/js/huginn_dock.js     (вкладки/группы убраны, sheetHost-слой,
                                         жесты Историй, ripple, fade список↔тред)
  * public/assets/js/huginn_icons.js    (иконка upload для Drop Zone)
  * public/assets/js/huginn_sse.js      (emit('error') для «соединение…»)
  * public/h/app.js                     (верхняя полоска убрана, SMS 6 ячеек, email→ссылка)
  * public/h/index.html                 (.h-top скрыт, шиты на всю ширину, версия)
  * public/h/sw.js                      (версия shell)
  * public/index.html, public/sw.js     (bump версии оболочки)

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

VER = "20.28.211"
SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

TAR_PATHS = [
    "src/routes/huginn_ext.js",
    "src/routes/chat_groups.js",
    "public/assets/css/huginn_dock.css",
    "public/assets/js/huginn_dock.js",
    "public/assets/js/huginn_icons.js",
    "public/assets/js/huginn_sse.js",
    "public/h/app.js",
    "public/h/index.html",
    "public/h/sw.js",
    "public/index.html",
    "public/sw.js",
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
    print("=== 0. PRE-FLIGHT shell_guard ===")
    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=True)
    print("shell_guard: OK")

    for rel in TAR_PATHS:
        if not (ROOT / rel).exists():
            raise SystemExit(f"missing: {rel}")

    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45)

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
    snap = f"/root/snapshots/asgard-huginn-{STAMP}.tgz"
    run(f"mkdir -p /root/snapshots && tar -czf {snap} -C {REMOTE} "
        f"src/routes/huginn_ext.js src/routes/chat_groups.js "
        f"public/assets/css/huginn_dock.css public/assets/js/huginn_dock.js "
        f"public/assets/js/huginn_icons.js public/assets/js/huginn_sse.js "
        f"public/h/app.js public/h/index.html public/h/sw.js "
        f"public/index.html public/sw.js 2>/dev/null || true")
    print(f"snapshot: {snap}")

    # ── 2. tar + scp кода ──
    print("=== 2. CODE tar+scp ===")
    tar_path = Path(tempfile.gettempdir()) / f"asgard-huginn-{STAMP}.tar.gz"
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in TAR_PATHS:
            tar.add(str(ROOT / rel), arcname=rel)
    print(f"tar: {tar_path} ({tar_path.stat().st_size} B)")

    sftp = ssh.open_sftp()
    remote_tar = f"/tmp/asgard-huginn-{STAMP}.tar.gz"
    sftp.put(str(tar_path), remote_tar)
    sftp.close()

    run(f"tar -xzf {remote_tar} -C {REMOTE}")
    run(f"rm -f {remote_tar}")

    # ── 3. рестарт ──
    print("=== 3. RESTART ===")
    run("systemctl restart asgard-crm")
    run("sleep 4; systemctl is-active asgard-crm")

    # ── 4. post-checks ──
    print("=== 4. POST-CHECKS ===")
    run("for i in 1 2 3 4 5 6 7 8; do code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health || true); "
        "echo \"health try $i: $code\"; [ \"$code\" = \"200\" ] && break; sleep 3; done")
    run(f"grep -o \"ASGARD_SHELL_VERSION = '[0-9.]*'\" {REMOTE}/public/index.html | head -1")
    run(f"grep -o \"const SHELL_VERSION = '[0-9.]*'\" {REMOTE}/public/sw.js | head -1")
    run(f"grep -o \"const SHELL_VERSION = '[0-9.]*'\" {REMOTE}/public/h/sw.js | head -1")
    # ключевые маркеры новой версии
    run(f"echo -n 'sheets-host: '; grep -c \"hg-sheets-host\" {REMOTE}/public/assets/js/huginn_dock.js || true")
    run(f"echo -n 'SMS_CODE_LEN: '; grep -c \"SMS_CODE_LEN\" {REMOTE}/public/h/app.js || true")
    run(f"echo -n 'h-top(должно 0): '; grep -c \"h-top\" {REMOTE}/public/h/app.js || true")
    run(f"echo -n 'mimir tab(должно 0): '; grep -c 'data-mnav=\"mimir\"' {REMOTE}/public/assets/js/huginn_dock.js || true")
    run(f"echo -n 'data-ltab(должно 0): '; grep -c \"data-ltab\" {REMOTE}/public/assets/js/huginn_dock.js || true")
    run(f"echo -n 'SMS randomInt 6-digit: '; grep -c \"randomInt(100000\" {REMOTE}/src/routes/huginn_ext.js || true")
    run("curl -s -o /dev/null -w 'root:%{http_code} ' http://127.0.0.1:3000/ ; "
        "curl -s -o /dev/null -w 'h/:%{http_code}\\n' http://127.0.0.1:3000/h/")

    print(f"\n=== DONE. Rollback: tar -xzf {snap} -C {REMOTE} && systemctl restart asgard-crm ===")
    ssh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
