#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Targeted deploy: SMS-фиксы Хугинна (reason + журнал + getSmsStatus).

Только 3 файла — без оболочки и без «багажа» параллельной сессии:
  * src/routes/telephony.js       (webhook парсит reason)
  * src/services/mango.js         (getSmsStatus читает field_sms_log)
  * src/routes/huginn_ext.js      (журналирование /auth/request-code)

ВАЖНО: версию оболочки НЕ трогаем — прод уже на 20.28.215 (выкатила
параллельная сессия), это чисто backend-фикс, перезагрузка SW не нужна.

Порядок: snapshot → tar+scp → restart → проверки.
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
import paramiko  # noqa: E402

SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

TAR_PATHS = [
    "src/routes/telephony.js",
    "src/services/mango.js",
    "src/routes/huginn_ext.js",
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
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45,
                banner_timeout=60, auth_timeout=60)
    print("ssh: connected")

    def run(cmd, check=True):
        print(f"$ {cmd[:170]}")
        _i, o, e = ssh.exec_command(cmd, timeout=600)
        out = o.read().decode("utf-8", "replace")
        err = e.read().decode("utf-8", "replace")
        code = o.channel.recv_exit_status()
        if out.strip():
            print(out.rstrip()[:3500])
        if err.strip():
            print(err.rstrip()[:1500], file=sys.stderr)
        if check and code != 0:
            raise SystemExit(f"remote exit {code}: {cmd[:110]}")
        return out

    print("=== 1. SNAPSHOT ===")
    snap = f"/root/snapshots/asgard-sms-fix-{STAMP}.tgz"
    run(f"mkdir -p /root/snapshots && tar -czf {snap} -C {REMOTE} " + " ".join(TAR_PATHS) + " 2>/dev/null || true")
    print(f"snapshot: {snap}")

    print("=== 2. tar+scp ===")
    tar_path = Path(tempfile.gettempdir()) / f"asgard-sms-{STAMP}.tar.gz"
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in TAR_PATHS:
            tar.add(str(ROOT / rel), arcname=rel)
    print(f"tar: {tar_path} ({tar_path.stat().st_size} B)")
    sftp = ssh.open_sftp()
    remote_tar = f"/tmp/asgard-sms-{STAMP}.tar.gz"
    sftp.put(str(tar_path), remote_tar)
    sftp.close()
    run(f"tar -xzf {remote_tar} -C {REMOTE}")
    run(f"rm -f {remote_tar}")

    print("=== 3. SYNTAX ===")
    run(f"for f in {' '.join(TAR_PATHS)}; do node --check {REMOTE}/$f || echo \"SYNTAX FAIL: $f\"; done; echo 'checked'")

    print("=== 4. RESTART ===")
    run("systemctl restart asgard-crm")
    run("sleep 5; systemctl is-active asgard-crm")

    print("=== 5. POST-CHECKS ===")
    for i in range(1, 7):
        code = run(
            f"curl -s -o /dev/null -w '%{{http_code}}' http://127.0.0.1:3000/api/health || true",
            check=False,
        ).strip()
        print(f"  health try {i}: {code}")
        if code == "200":
            break
        run("sleep 3", check=False)
    run(f"echo -n 'reason parsing: '; grep -c 'event.reason' {REMOTE}/src/routes/telephony.js")
    run(f"echo -n 'mango reads field_sms_log: '; grep -c 'FROM field_sms_log' {REMOTE}/src/services/mango.js")
    run(f"echo -n 'huginn logs auth_code: '; grep -c 'message_type, message_text, status, mango_response, command_id' {REMOTE}/src/routes/huginn_ext.js")
    run(f"echo -n 'dead queries/sms call (want 0): '; grep -c \"request('queries/sms'\" {REMOTE}/src/services/mango.js || true")
    run(f"echo -n 'shell version (не трогали): '; grep -o \"ASGARD_SHELL_VERSION = '[0-9.]*'\" {REMOTE}/public/index.html | head -1")

    print(f"\n=== DONE. Rollback: tar -xzf {snap} -C {REMOTE} && systemctl restart asgard-crm ===")
    ssh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
