#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Выкатка дашборда разработки (директор развития): shell 20.28.188.

Состав:
  - src/index.js                         (регистрация роута + no-cache/X-Robots-Tag для /dev-roadmap/)
  - src/routes/dev-roadmap.js            (API: state/close/reopen/events)
  - migrations/V380__dev_roadmap.sql     (+ _down)
  - tools/dev-roadmap-seed.js            (структура из JSON в БД)
  - public/dev-roadmap/**                (index.html + assets)
  - public/robots.txt                    (Disallow /dev-roadmap)
  - ENV: ROADMAP_SECRET + ROADMAP_PIN_*  → /etc/asgard-crm/thing.env (вне git)

Оболочка (public/index.html, public/sw.js) НЕ трогается: версия 20.28.188 = локальной = прод.
Снапшот перед выкаткой; проверка после. Роллбэк — в конце вывода.
"""
from __future__ import annotations

import secrets
import sys
import tarfile
import tempfile
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import shell_guard  # noqa: E402
import paramiko  # noqa: E402

VER = "20.28.188"
SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
ENV_FILE = "/etc/asgard-crm/thing.env"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

# PIN'ы подписантов (короткие, меняются владельцем при желании).
PIN_NIKITA = "2718"
PIN_KOSTYA = "3141"
PIN_ANDREY = "1618"

FILES = [
    "src/index.js",
    "src/routes/dev-roadmap.js",
    "migrations/V380__dev_roadmap.sql",
    "migrations/V380__dev_roadmap_down.sql",
    "tools/dev-roadmap-seed.js",
    "public/robots.txt",
]
TAR_DIRS = ["public/dev-roadmap", "docs/dev-roadmap"]


def load_pkey(path: str):
    for loader in (
        getattr(paramiko, "Ed25519Key", None),
        getattr(paramiko, "ECDSAKey", None),
        paramiko.RSAKey,
    ):
        if loader is None:
            continue
        try:
            return loader.from_private_key_file(path)
        except Exception:
            continue
    raise SystemExit(f"cannot load SSH key: {path}")


def main() -> int:
    print("=== 0. PRE-FLIGHT shell_guard ===")
    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=None, deploy_gate=False)
    print("shell_guard: OK (целостность оболочки)")

    for rel in FILES:
        if not (ROOT / rel).is_file():
            raise SystemExit(f"missing: {rel}")
    for rel in TAR_DIRS:
        if not (ROOT / rel).is_dir():
            raise SystemExit(f"missing dir: {rel}")

    # Секретный ключ доступа: если ROADMAP_SECRET уже задан на проде — переиспользуем его.
    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45)

    def run(cmd: str, check: bool = True, timeout: int = 900) -> str:
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
        return out

    existing_secret = run(
        f"sed -n 's/^ROADMAP_SECRET=//p' {ENV_FILE} 2>/dev/null || true", check=False
    ).strip()
    SECRET = existing_secret or secrets.token_urlsafe(24)
    print(f"ROADMAP_SECRET: {'переиспользован с прода' if existing_secret else 'сгенерирован новый'}")

    # ── 1. SNAPSHOT ─────────────────────────────────────────────────
    snap = f"/root/snapshots/asgard-roadmap-{STAMP}.tgz"
    run(
        "mkdir -p /root/snapshots && tar -czf {snap} -C {remote} "
        "src/index.js src/routes public/dev-roadmap public/robots.txt "
        "/etc/asgard-crm/thing.env 2>/dev/null; echo snapshot_ok".format(snap=snap, remote=REMOTE),
        check=False,
    )
    print(f"snapshot: {snap}")

    # ── 2. ENV (секрет + PIN), идемпотентно ─────────────────────────
    env_add = (
        f"[ -f {ENV_FILE} ] || touch {ENV_FILE}; "
        f"grep -q '^ROADMAP_SECRET=' {ENV_FILE} || echo 'ROADMAP_SECRET={SECRET}' >> {ENV_FILE}; "
        f"grep -q '^ROADMAP_PIN_NIKITA=' {ENV_FILE} || echo 'ROADMAP_PIN_NIKITA={PIN_NIKITA}' >> {ENV_FILE}; "
        f"grep -q '^ROADMAP_PIN_KOSTYA=' {ENV_FILE} || echo 'ROADMAP_PIN_KOSTYA={PIN_KOSTYA}' >> {ENV_FILE}; "
        f"grep -q '^ROADMAP_PIN_ANDREY=' {ENV_FILE} || echo 'ROADMAP_PIN_ANDREY={PIN_ANDREY}' >> {ENV_FILE}; "
        f"chmod 600 {ENV_FILE}; grep -c ROADMAP {ENV_FILE}"
    )
    run(env_add)

    # ── 3. TAR + UPLOAD ─────────────────────────────────────────────
    tar_path = Path(tempfile.gettempdir()) / f"asgard-roadmap-{STAMP}.tar.gz"
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            tar.add(str(ROOT / rel), arcname=rel)
        for rel in TAR_DIRS:
            tar.add(str(ROOT / rel), arcname=rel)
    print(f"tar: {tar_path} ({tar_path.stat().st_size} B)")

    sftp = ssh.open_sftp()
    remote_tar = f"/tmp/asgard-roadmap-{STAMP}.tar.gz"
    sftp.put(str(tar_path), remote_tar)
    sftp.close()

    run(f"tar -xzf {remote_tar} -C {REMOTE}")
    run(f"rm -f {remote_tar}")
    run(
        f"chmod 644 {REMOTE}/public/robots.txt {REMOTE}/migrations/V380__dev_roadmap*.sql "
        f"{REMOTE}/src/routes/dev-roadmap.js {REMOTE}/src/index.js {REMOTE}/tools/dev-roadmap-seed.js"
    )
    run(f"find {REMOTE}/public/dev-roadmap -type f -exec chmod 644 {{}} \\;")
    run(f"find {REMOTE}/public/dev-roadmap -type d -exec chmod 755 {{}} \\;")

    # ── 4. SYNTAX CHECK ─────────────────────────────────────────────
    run(f"cd {REMOTE} && node --check src/routes/dev-roadmap.js && node --check src/index.js && echo SYNTAX_OK")

    # ── 5. MIGRATION V380 (идемпотентно: IF NOT EXISTS) ─────────────
    run(
        "cd {remote} && PGPASSWORD=123456789 psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 "
        "-f migrations/V380__dev_roadmap.sql >/dev/null && echo MIGRATION_OK".format(remote=REMOTE)
    )

    # ── 6. SEED СТРУКТУРЫ (не трогает done/done_by) ─────────────────
    run(f"cd {REMOTE} && DB_NAME=asgard_crm node tools/dev-roadmap-seed.js")

    # ── 7. RESTART ──────────────────────────────────────────────────
    run("systemctl restart asgard-crm")
    run("sleep 4; systemctl is-active asgard-crm")

    # ── 8. POST CHECKS ──────────────────────────────────────────────
    print("=== POST CHECKS ===")
    run(
        "echo -n 'roadmap-page: '; curl -s -o /dev/null -w '%{{http_code}}\\n' "
        "'http://127.0.0.1:3000/dev-roadmap/?k={sec}'".format(sec=SECRET),
        check=False,
    )
    run(
        "echo -n 'page-cache-header: '; curl -s -D - -o /dev/null "
        "'http://127.0.0.1:3000/dev-roadmap/assets/app.js' | grep -iE 'cache-control|x-robots-tag' | tr '\\n' ' '; echo",
        check=False,
    )
    run(
        "echo -n 'api-no-key: '; curl -s -o /dev/null -w '%{{http_code}}\\n' "
        "http://127.0.0.1:3000/api/dev-roadmap/state"
    )
    run(
        "echo -n 'api-with-key: '; curl -s -H 'X-Roadmap-Key: {sec}' "
        "http://127.0.0.1:3000/api/dev-roadmap/state | head -c 160; echo".format(sec=SECRET)
    )
    run(
        "cd {remote} && PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -c "
        "\"SELECT (SELECT COUNT(*) FROM dev_roadmap_stages) AS stages, "
        "(SELECT COUNT(*) FROM dev_roadmap_items) AS items, "
        "(SELECT COUNT(*) FROM dev_roadmap_checkpoints) AS cps;\"".format(remote=REMOTE)
    )

    print("\n" + "=" * 70)
    print("ССЫЛКА ДЛЯ ДИРЕКТОРА РАЗВИТИЯ:")
    print(f"  https://<домен-CRM>/dev-roadmap/?k={SECRET}")
    print(f"  (запасной вариант по IP: http://92.242.61.184/dev-roadmap/?k={SECRET})")
    print("PIN: Никита={} Костя={} Андрей={}".format(PIN_NIKITA, PIN_KOSTYA, PIN_ANDREY))
    print("=" * 70)
    print(f"\nРоллбэк: tar -xzf {snap} -C {REMOTE} && systemctl restart asgard-crm")
    print(f"Роллбэк миграции: PGPASSWORD=... psql -U asgard -d asgard_crm -f {REMOTE}/migrations/V380__dev_roadmap_down.sql")
    ssh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
