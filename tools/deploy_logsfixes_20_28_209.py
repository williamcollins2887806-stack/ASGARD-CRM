#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy: батч фиксов по логам (shell 20.28.209).

Состав (только затронутое этой задачей — чужой WIP в дереве НЕ везём):
  • src/services/db.js                 (пул pg)
  • src/routes/work-norms.js           (имя листа Excel)
  • src/routes/mimir.js                (разбор ответа AI)
  • src/routes/telephony-pbx.js        (логирование PBX)
  • public/assets/js/personal_kanban.js
  • public/assets/js/client-error-log.js
  • public/m + public/mobile-app/src   (React#185 + пересборка /m)
  • public/index.html, public/sw.js    (бамп 20.28.209)

Порядок: shell_guard(deploy-gate) → snapshot → tar+scp → restart → post-checks.
Запуск: python tools/deploy_logsfixes_20_28_209.py
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

VER = "20.28.209"
SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

TAR_PATHS = [
    "src/services/db.js",
    "src/routes/work-norms.js",
    "src/routes/mimir.js",
    "src/routes/telephony-pbx.js",
    "public/assets/js/personal_kanban.js",
    "public/assets/js/client-error-log.js",
    "public/m",
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
    print("=== 0. PRE-FLIGHT shell_guard (deploy-gate) ===")
    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=True)
    print("shell_guard: OK")

    for rel in TAR_PATHS:
        if not (ROOT / rel).exists():
            raise SystemExit(f"missing: {rel}")

    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45)

    def run(cmd, check=True, timeout=600):
        print(f"$ {cmd[:170]}")
        _i, o, e = ssh.exec_command(cmd, timeout=timeout)
        out = o.read().decode("utf-8", "replace")
        err = e.read().decode("utf-8", "replace")
        code = o.channel.recv_exit_status()
        if out.strip():
            print(out.rstrip()[:3500])
        if err.strip():
            print(err.rstrip()[:1500], file=sys.stderr)
        if check and code != 0:
            raise SystemExit(f"remote exit {code}: {cmd[:120]}")
        return out

    print("=== 1. SNAPSHOT ===")
    snap = f"/root/snapshots/asgard-logsfixes-{STAMP}.tgz"
    run(f"mkdir -p /root/snapshots && tar -czf {snap} -C {REMOTE} "
        f"src/services/db.js src/routes/work-norms.js src/routes/mimir.js src/routes/telephony-pbx.js "
        f"public/assets/js/personal_kanban.js public/assets/js/client-error-log.js public/m public/index.html public/sw.js 2>/dev/null || true")
    print(f"snapshot: {snap}")

    print("=== 2. CODE tar+scp ===")
    tar_path = Path(tempfile.gettempdir()) / f"asgard-logsfixes-{STAMP}.tar.gz"
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in TAR_PATHS:
            tar.add(str(ROOT / rel), arcname=rel)
    print(f"tar: {tar_path} ({tar_path.stat().st_size} B)")

    sftp = ssh.open_sftp()
    remote_tar = f"/tmp/asgard-logsfixes-{STAMP}.tar.gz"
    sftp.put(str(tar_path), remote_tar)
    sftp.close()

    run(f"tar -xzf {remote_tar} -C {REMOTE}")
    run(f"rm -f {remote_tar}")
    run(f"find {REMOTE}/public/m -type f -exec chmod 644 {{}} \\; ; find {REMOTE}/public/m -type d -exec chmod 755 {{}} \\;")

    print("=== 3. RESTART ===")
    run("systemctl restart asgard-crm")
    run("sleep 4; systemctl is-active asgard-crm")

    print("=== 4. POST-CHECKS ===")
    run("for i in 1 2 3 4 5 6 7 8; do code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health || true); "
        "echo \"health try $i: $code\"; [ \"$code\" = \"200\" ] && break; sleep 3; done")
    # shell-версия на проде совпала
    run(f"grep -o \"ASGARD_SHELL_VERSION = '[^']*'\" {REMOTE}/public/index.html | head -1")
    run(f"grep -o \"SHELL_VERSION = '[^']*'\" {REMOTE}/public/sw.js | head -1")
    # фикс city на проде (D-265) + мои правки на месте
    run(f"grep -c 'extractCityName' {REMOTE}/src/routes/staff.js || true")
    run(f"grep -c 'statement_timeout' {REMOTE}/src/services/db.js || true")
    run(f"grep -c \"replace(/\\[\\\\\\\\/*?:\\[\\\\]\\]/g, '-')\" {REMOTE}/src/routes/work-norms.js || echo 'wn-regex-check-skip'")
    run(f"grep -c '_rawMessage' {REMOTE}/src/routes/mimir.js || true")
    # /m отдаётся и содержит asText
    run("curl -s -o /dev/null -w 'root:%{http_code} ' http://127.0.0.1:3000/ ; "
        "curl -s -o /dev/null -w 'm:%{http_code}\\n' http://127.0.0.1:3000/m/index.html")
    run(f"grep -o 'index-[A-Za-z0-9_-]*\\.js' {REMOTE}/public/m/index.html | head -1")
    run(f"grep -l 'asText' {REMOTE}/public/m/assets/index-*.js | head -2 || echo 'ASTEXT MISSING'")

    print(f"\n=== DONE. Rollback: tar -xzf {snap} -C {REMOTE} && systemctl restart asgard-crm ===")
    ssh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
