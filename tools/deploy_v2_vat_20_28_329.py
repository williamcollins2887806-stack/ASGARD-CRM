#!/usr/bin/env python3
"""Выравнивание прод = git: билд desktop-v2 (9 коммитов) + expenses.js + V443.

Что везём:
  • public/v2/** — билд desktop-v2-src за 30.10 (НДС расходов в отчётах,
    PersonalKanban v3, размеры СИЗ, утренний брифинг, телефония, D-286).
    Прод-билд от 16.10 отстал на 13 дней — обновляем целиком.
  • src/routes/expenses.js — vat_basis в whitelist (колонка на проде уже есть).
  • migrations/V443__expense_vat_basis.sql — нормализация vat_rate (доли → %)
    + backfill vat_basis. Деньги не трогает, только метаданные. Идемпотентна.
    V441 (ppe_sizes) НЕ применяем: employees.height уже VARCHAR, повторный
    ALTER с числовым USING упал бы.

Порядок: shell_guard -> tar v2 -> снапшот -> заливка -> миграция -> замена v2
         -> рестарт -> верификация маркеров.
"""
import hashlib
import io
import subprocess
import sys
import tarfile
import tempfile
from datetime import datetime
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
PROJECT = "/var/www/asgard-crm"
ROOT = Path(__file__).resolve().parents[1]
TAG = datetime.now().strftime("%Y%m%d-%H%M%S")
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-v2-vat-{TAG}"
EXPECT_VERSION = "20.28.329"

BACKEND = ["src/routes/expenses.js"]
MIGRATIONS = ["migrations/V443__expense_vat_basis.sql"]

# Маркеры в исходнике (проверяем до заливки).
BACKEND_MARKERS = [
    ("src/routes/expenses.js", "vat_basis", "expenses: vat_basis в whitelist"),
]
# Маркеры в собранном v2 (проверяем на проде после заливки).
V2_MARKERS = [
    ("vat_basis", "v2: база суммы налога"),
    ("data_quality", "v2: качество данных отчёта"),
    ("Введённая сумма", "v2: селект С НДС / Без НДС"),
    ("СВЕРИТЬ", "v2: метка «на сверку»"),
]


def md5_bytes(b: bytes) -> str:
    return hashlib.md5(b).hexdigest()


def run(c, cmd, timeout=300, allow_fail=False):
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
    print("=== SHELL GUARD ===")
    r = subprocess.run(
        [sys.executable, str(ROOT / "tools" / "shell_guard.py"),
         "--expect-version", EXPECT_VERSION, "--deploy-gate"],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    print("\n".join((r.stdout or "").strip().splitlines()[-4:]))
    if r.returncode != 0:
        raise SystemExit("shell_guard FAILED — деплой отменён")


def build_v2_tar() -> Path:
    """Упаковываем public/v2 целиком (билд уже собран npm run build)."""
    v2 = ROOT / "public" / "v2"
    if not (v2 / "index.html").is_file():
        raise SystemExit("нет public/v2/index.html — сначала npm run build")
    out = Path(tempfile.gettempdir()) / f"asgard-v2-{TAG}.tgz"
    with tarfile.open(out, "w:gz") as tf:
        tf.add(str(v2), arcname="v2")
    print(f"  tar v2: {out}  ({out.stat().st_size / 1024:.0f} KB, "
          f"{sum(1 for _ in v2.rglob('*') if _.is_file())} файлов)")
    return out


def main():
    guard()

    print("\n=== LOCAL MARKERS (backend) ===")
    for rel, needle, label in BACKEND_MARKERS:
        text = (ROOT / rel).read_text(encoding="utf-8", errors="replace")
        if needle not in text:
            raise SystemExit(f"локально нет маркера {label}")
        print(f"  OK {label}")

    print("\n=== COLLECT v2 ===")
    tarpath = build_v2_tar()

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    print("\n=== SNAPSHOT (v2 + backend) ===")
    run(c, "mkdir -p /root/snapshots")
    if run(c, f"test -d {PROJECT}/public/v2 && echo yes || echo no", allow_fail=True).strip().endswith("yes"):
        run(c, f"tar -C {PROJECT}/public -czf {SNAP}-v2.tgz v2 && ls -lh {SNAP}-v2.tgz")
    existing = []
    for rel in BACKEND:
        try:
            sftp.stat(f"{PROJECT}/{rel}")
            existing.append(rel)
        except OSError:
            pass
    if existing:
        run(c, "tar -C {p} -czf {s}-backend.tgz {f} && ls -lh {s}-backend.tgz".format(
            p=PROJECT, s=SNAP, f=" ".join(existing)))

    print("\n=== UPLOAD BACKEND + MIGRATION ===")
    for rel in BACKEND + MIGRATIONS:
        local = ROOT / rel
        remote = f"{PROJECT}/{rel}"
        run(c, f"mkdir -p {str(Path(remote).parent).replace(chr(92), '/')}")
        digest = md5_bytes(local.read_bytes())
        sftp.put(str(local), remote)
        with sftp.file(remote, "rb") as rf:
            rmd5 = md5_bytes(rf.read())
        ok = rmd5 == digest
        print(f"  {'OK  ' if ok else 'FAIL'} {rel}  {digest[:10]}")
        if not ok:
            raise SystemExit("md5 mismatch: " + rel)

    print("\n=== MIGRATE V443 ===")
    mig = "migrations/V443__expense_vat_basis.sql"
    run(c, f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 -f {PROJECT}/{mig}")
    run(c, "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -tAc "
           "\"SELECT 'doli<1: '||COUNT(*) FROM work_expenses WHERE vat_rate > 0 AND vat_rate < 1\"")
    run(c, "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -tAc "
           "\"SELECT 'vat_basis: '||COALESCE(vat_basis,'NULL')||' -> '||COUNT(*) "
           "FROM work_expenses GROUP BY vat_basis\"")
    run(c, "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -tAc "
           "\"INSERT INTO migrations (name, executed_at) "
           "SELECT 'V443__expense_vat_basis', now() "
           "WHERE NOT EXISTS (SELECT 1 FROM migrations WHERE name='V443__expense_vat_basis')\"",
        allow_fail=True)

    print("\n=== UPLOAD + SWAP v2 ===")
    remote_tar = f"/tmp/asgard-v2-{TAG}.tgz"
    sftp.put(str(tarpath), remote_tar)
    run(c, f"ls -lh {remote_tar}")
    run(c, "cd {p}/public && rm -rf v2.pre-{t} && mv v2 v2.pre-{t} && "
           "tar xzf {rt} && rm -f {rt} && ls v2/index.html && "
           "find v2/assets -name '*.js' | wc -l".format(p=PROJECT, t=TAG, rt=remote_tar))

    print("\n=== RESTART ===")
    run(c, "systemctl restart asgard-crm && sleep 4 && systemctl is-active asgard-crm "
           "&& curl -sS -o /dev/null -w 'http=%{http_code}\\n' http://127.0.0.1:3000/api/version")

    print("\n=== VERIFY v2 MARKERS ON PROD ===")
    for needle, label in V2_MARKERS:
        out = run(c, f"grep -rl '{needle}' {PROJECT}/public/v2/assets/*.js 2>/dev/null | wc -l",
                  allow_fail=True).strip()
        n = out.splitlines()[-1] if out else "0"
        good = n not in ("", "0")
        print(f"  {'OK  ' if good else 'FAIL'} {label}  ({n} файлов)")
        if not good:
            raise SystemExit(f"маркер v2 не приехал: {label}")

    print("\n=== VERIFY BACKEND MARKER ===")
    run(c, f"grep -c 'vat_basis' {PROJECT}/src/routes/expenses.js")

    print("\n=== PROD VERSION ===")
    run(c, f"grep -o \"ASGARD_SHELL_VERSION = '[0-9.]*'\" {PROJECT}/public/index.html | head -1")
    run(c, f"grep -o 'assets/index-[A-Za-z0-9_-]*\\.js' {PROJECT}/public/v2/index.html | head -1")

    sftp.close()
    c.close()
    print("\nDONE snapshot=", SNAP + "*.tgz")


if __name__ == "__main__":
    main()
