#!/usr/bin/env python3
"""Деплой слияния hotfix (Хугинн) + выравнивание git/локаль/прод.

Заливает: backend Хугинна (notify-каскад с delivery-статусами, wa-webhook,
telephony), фронт /h/ (запись голосовых/кружков, свайпы, истории) и миграцию
V411__huginn_login_delivery_status (колонки delivery_* для кодов входа).

Порядок: shell_guard -> снапшот -> заливка -> миграция -> рестарт -> верификация.
"""
import hashlib
import io
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
PROJECT = "/var/www/asgard-crm"
ROOT = Path(__file__).resolve().parents[1]
TAG = datetime.now().strftime("%Y%m%d-%H%M%S")
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-huginn-hotfix-{TAG}"
EXPECT_VERSION = "20.28.329"

FILES = [
    # backend: каскад доставки + статусы провайдера
    "src/services/huginn-notify.js",
    "src/services/green-api.js",
    "src/services/mango.js",
    "src/routes/huginn_ext.js",
    "src/routes/telephony.js",
    "src/routes/wa-webhook.js",
    # фронт /h/ + оболочка
    "public/assets/js/huginn_dock.js",
    "public/assets/css/huginn_dock.css",
    "public/h/app.js",
    "public/h/index.html",
    "public/h/sw.js",
    "public/sw.js",
    "public/index.html",
    # миграция
    "migrations/V411__huginn_login_delivery_status.sql",
]

# Маркеры, доказывающие, что на прод приехала именно объединённая версия.
MARKERS = [
    ("src/services/huginn-notify.js", "deliveryConfirmed", "notify: accepted != delivered"),
    ("src/services/huginn-notify.js", "normalizePhone", "notify: нормализация телефона"),
    ("src/routes/huginn_ext.js", "deliveryStatus", "ext: статус доставки кода"),
    ("src/routes/huginn_ext.js", "channelUsed", "ext: каскад MAX->SMS"),
    ("src/routes/huginn_ext.js", "providerMessageId", "ext: id сообщения провайдера"),
    ("public/assets/js/huginn_dock.js", "hgRecStop", "dock: запись голосового/кружка"),
    ("public/assets/js/huginn_dock.js", "keepFocus", "dock: поиск не теряет фокус"),
]


def md5_bytes(b: bytes) -> str:
    return hashlib.md5(b).hexdigest()


def md5_file(path: Path) -> str:
    return md5_bytes(path.read_bytes())


def run(c, cmd, timeout=180, allow_fail=False):
    print("====", cmd[:200].replace("\n", " "))
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out:
        print(out[-6000:] if len(out) > 6000 else out)
    if err.strip() and not allow_fail:
        print("STDERR:", err[:1500])
    if code != 0 and not allow_fail:
        raise SystemExit(f"FAILED ({code}): {cmd[:160]}")
    return out


def guard():
    """shell_guard обязателен перед заливкой (правило protect-prod-shell)."""
    print("=== SHELL GUARD ===")
    r = subprocess.run(
        [sys.executable, str(ROOT / "tools" / "shell_guard.py"),
         "--expect-version", EXPECT_VERSION, "--deploy-gate"],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    tail = "\n".join((r.stdout or "").strip().splitlines()[-4:])
    print(tail)
    if r.returncode != 0:
        raise SystemExit("shell_guard FAILED — деплой отменён")


def main():
    guard()

    # Локальная проверка маркеров ДО заливки: не везём пустышку.
    print("\n=== LOCAL MARKERS ===")
    for rel, needle, label in MARKERS:
        text = (ROOT / rel).read_text(encoding="utf-8", errors="replace")
        if needle not in text:
            raise SystemExit(f"локально нет маркера {label} ({needle} в {rel})")
        print(f"  OK {label}")

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    print("\n=== SNAPSHOT ===")
    existing = []
    for rel in FILES:
        try:
            sftp.stat(f"{PROJECT}/{rel}")
            existing.append(rel)
        except OSError:
            print("  (new)", rel)
    if existing:
        run(c, "mkdir -p /root/snapshots && tar -C {p} -czf {s}.tgz {f} && ls -lh {s}.tgz".format(
            p=PROJECT, s=SNAP, f=" ".join(existing)))
    else:
        print("  нечего снапшотить")

    print("\n=== UPLOAD ===")
    for rel in FILES:
        local = ROOT / rel
        remote = f"{PROJECT}/{rel}"
        parent = str(Path(remote).parent).replace("\\", "/")
        run(c, f"mkdir -p {parent}")
        digest = md5_file(local)
        sftp.put(str(local), remote)
        with sftp.file(remote, "rb") as rf:
            rmd5 = md5_bytes(rf.read())
        ok = rmd5 == digest
        print(f"  {'OK  ' if ok else 'FAIL'} {rel}  {digest[:10]}")
        if not ok:
            raise SystemExit("md5 mismatch: " + rel)

    print("\n=== MIGRATE V411 ===")
    mig = "migrations/V411__huginn_login_delivery_status.sql"
    run(c, f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 -f {PROJECT}/{mig}")
    run(c, "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -tAc "
           "\"SELECT string_agg(column_name, ',') FROM information_schema.columns "
           "WHERE table_name='huginn_login_codes' AND column_name LIKE 'delivery%'\"")
    # bookkeeping: чтобы раннер не считал миграцию новой (применение идемпотентно).
    run(c, "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -tAc "
           "\"INSERT INTO migrations (name, executed_at) "
           "SELECT 'V411__huginn_login_delivery_status', now() "
           "WHERE NOT EXISTS (SELECT 1 FROM migrations WHERE name='V411__huginn_login_delivery_status')\"",
        allow_fail=True)

    print("\n=== RESTART ===")
    run(c, "systemctl restart asgard-crm && sleep 4 && systemctl is-active asgard-crm "
           "&& curl -sS -o /dev/null -w 'http=%{http_code}\\n' http://127.0.0.1:3000/api/version")

    print("\n=== VERIFY MARKERS ON PROD ===")
    for rel, needle, label in MARKERS:
        out = run(c, f"grep -c '{needle}' {PROJECT}/{rel} || true", allow_fail=True).strip()
        n = out.splitlines()[-1] if out else "0"
        good = n not in ("", "0")
        print(f"  {'OK  ' if good else 'FAIL'} {label}  ({n})")
        if not good:
            raise SystemExit(f"маркер не приехал: {label}")

    print("\n=== PROD VERSION ===")
    run(c, f"grep -o \"ASGARD_SHELL_VERSION = '[0-9.]*'\" {PROJECT}/public/index.html | head -1")

    sftp.close()
    c.close()
    print("\nDONE snapshot=", SNAP + ".tgz")


if __name__ == "__main__":
    main()
