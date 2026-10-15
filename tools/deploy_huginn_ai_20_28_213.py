#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy: AI — v4.1-flash, фикс JSON-утечки в чат Мимира, markdown в пушах (shell 20.28.213).

Состав:
  * src/lib/plain-text.js                  (новый: срез markdown для push/Telegram)
  * src/services/ai-models.js              (MODEL_DEFAULT = v4.1-flash, цены, MODEL_DISABLED_PRO)
  * src/services/ai-provider.js            (проброс reasoning)
  * src/services/mimir-cron.js             (фикс result.text || result + reasoning off)
  * src/services/NotificationService.js     (очистка push-тела)
  * src/services/pushService.js            (очистка push-тела)
  * src/services/notify.js                 (очистка push-тела + Telegram)
  * src/services/report-scheduler.js       (без изменений логики — проверка)
  * src/services/mimir-conductor/models-config.js (роли моделей)
  * src/routes/chat_groups.js              (notify(): очистка push-тела)
  * src/routes/admin-system.js             (текст «Модель:»)
  * public/index.html, public/sw.js, public/h/index.html, public/h/sw.js (bump версии)

Данные (уже применено отдельным скриптом, см. commit): soft-delete 5131 JSON-сообщения
в chat_messages + пересчёт chats.message_count.

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

VER = "20.28.213"
SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

TAR_PATHS = [
    "src/lib/plain-text.js",
    "src/services/ai-models.js",
    "src/services/ai-provider.js",
    "src/services/mimir-cron.js",
    "src/services/NotificationService.js",
    "src/services/pushService.js",
    "src/services/notify.js",
    "src/services/report-scheduler.js",
    "src/services/mimir-conductor/models-config.js",
    "src/routes/chat_groups.js",
    "src/routes/admin-system.js",
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

    def run(cmd, check=True, timeout=600):
        print(f"$ {cmd[:180]}")
        _i, o, e = ssh.exec_command(cmd, timeout=timeout)
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
    snap = f"/root/snapshots/asgard-ai-{STAMP}.tgz"
    run(f"mkdir -p /root/snapshots && tar -czf {snap} -C {REMOTE} "
        f"src/lib/plain-text.js src/services/ai-models.js src/services/ai-provider.js "
        f"src/services/mimir-cron.js src/services/NotificationService.js src/services/pushService.js "
        f"src/services/notify.js src/services/report-scheduler.js "
        f"src/services/mimir-conductor/models-config.js src/routes/chat_groups.js src/routes/admin-system.js "
        f"public/index.html public/sw.js public/h/index.html public/h/sw.js 2>/dev/null || true")
    print(f"snapshot: {snap}")

    # ── 2. tar + scp ──
    print("=== 2. CODE tar+scp ===")
    tar_path = Path(tempfile.gettempdir()) / f"asgard-ai-{STAMP}.tar.gz"
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in TAR_PATHS:
            tar.add(str(ROOT / rel), arcname=rel)
    print(f"tar: {tar_path} ({tar_path.stat().st_size} B)")

    sftp = ssh.open_sftp()
    remote_tar = f"/tmp/asgard-ai-{STAMP}.tar.gz"
    sftp.put(str(tar_path), remote_tar)
    sftp.close()

    run(f"tar -xzf {remote_tar} -C {REMOTE}")
    run(f"rm -f {remote_tar}")

    # ── 3. рестарт ──
    print("=== 3. RESTART ===")
    run("systemctl restart asgard-crm")
    run("sleep 5; systemctl is-active asgard-crm")

    print("=== 3b. SYNTAX ON PROD ===")
    run(f"for f in src/lib/plain-text.js src/services/ai-models.js src/services/ai-provider.js "
        f"src/services/mimir-cron.js src/services/NotificationService.js src/services/pushService.js "
        f"src/services/notify.js src/routes/chat_groups.js; do "
        f"node --check {REMOTE}/$f || echo \"SYNTAX FAIL: $f\"; done; echo 'syntax checked'")

    # ── 4. post-checks ──
    print("=== 4. POST-CHECKS ===")
    run("for i in 1 2 3 4 5 6 7 8; do code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health || true); "
        "echo \"health try $i: $code\"; [ \"$code\" = \"200\" ] && break; sleep 3; done")
    run(f"grep -o \"ASGARD_SHELL_VERSION = '[0-9.]*'\" {REMOTE}/public/index.html | head -1")
    run(f"grep -o \"const SHELL_VERSION = '[0-9.]*'\" {REMOTE}/public/sw.js | head -1")
    run(f"grep -o \"const SHELL_VERSION = '[0-9.]*'\" {REMOTE}/public/h/sw.js | head -1")
    # markers
    run(f"echo -n 'plain-text.js: '; grep -c 'toPlainText' {REMOTE}/src/lib/plain-text.js || true")
    run(f"echo -n 'MODEL_DEFAULT v4.1: '; grep -o \"MODEL_DEFAULT = '[^']*'\" {REMOTE}/src/services/ai-models.js || true")
    run(f"echo -n 'reasoning passed: '; grep -c 'reasoning: { enabled: false }' {REMOTE}/src/services/mimir-cron.js || true")
    run(f"echo -n 'old leak pattern (want 0): '; grep -c 'return result.text || result;' {REMOTE}/src/services/mimir-cron.js || true")
    run(f"echo -n 'push strip (NotificationService): '; grep -c 'toPlainText' {REMOTE}/src/services/NotificationService.js || true")
    run(f"echo -n 'push strip (pushService): '; grep -c 'toPlainText' {REMOTE}/src/services/pushService.js || true")
    run(f"echo -n 'push strip (notify.js): '; grep -c 'toPlainText' {REMOTE}/src/services/notify.js || true")
    run(f"echo -n 'chat_groups strip: '; grep -c 'toPlainText' {REMOTE}/src/routes/chat_groups.js || true")
    run(f"echo -n 'leaked JSON left in DB: '; PGPASSWORD=123456789 psql -U asgard -d asgard_crm -tAc \"SELECT count(*) FROM chat_messages WHERE deleted_at IS NULL AND user_id = 0 AND message ~ '\\\"stopReason\\\"'\" || true")
    # UTF-8 safety on shell files (класс D-142b)
    run(f"python3 - <<'PY'\n"
        f"for p in ['{REMOTE}/public/index.html','{REMOTE}/src/services/ai-models.js']:\n"
        f"    b=open(p,'rb').read()\n"
        f"    print(p.split('/')[-1], 'BOM:', b[:3]==b'\\xef\\xbb\\xbf' if p.endswith('.html') else 'n/a', 'U+FFFD:', b.count(b'\\xef\\xbf\\xbd'))\n"
        f"PY")
    run("curl -s -o /dev/null -w 'root:%{http_code} ' http://127.0.0.1:3000/ ; "
        "curl -s -o /dev/null -w 'h/:%{http_code}\\n' http://127.0.0.1:3000/h/")

    print(f"\n=== DONE. Rollback: tar -xzf {snap} -C {REMOTE} && systemctl restart asgard-crm ===")
    ssh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
