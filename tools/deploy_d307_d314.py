"""Деплой D-307..D-314 на прод: снапшот -> заливка -> md5-сверка -> рестарт.

Заливаются ТОЛЬКО файлы, где локальный md5 != прод. Порядок:
  1) снапшот прод-файлов (tar) + карта md5;
  2) scp по одному в /tmp, затем атомарный mv в проект;
  3) md5-сверка локального и прод-файла;
  4) рестарт + health + смоук-маркеры;
  5) при провале — откат из снапшота.

Требует, чтобы shell_guard.assert_ok уже был пройден (запускается выше).
"""
import hashlib
import subprocess
import sys
import tarfile
import tempfile
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
HOST = "root@92.242.61.184"
PROJECT = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")
SNAP = f"/root/snapshots/asgard-d307-{STAMP}.tgz"

FILES = [
    "src/lib/human-error.js",           # D-313 русский текст вместо unauthorized
    "src/routes/telephony.js",          # D-307 return send + payload
    "src/routes/tenders.js",            # D-308 касты 42P08
    "src/services/job-queue.js",        # D-308 касты 42P08
    "src/services/thing-pipeline.js",   # D-308 касты 42P08
    "public/assets/js/app.js",          # D-309 SSE 401 + reset
    "public/assets/js/huginn_sse.js",   # D-309 идемпотентный start
    "public/assets/js/field-tab.js",    # D-314 сохранение категории
    "tools/migrate_targeted.js",        # D-308 TARGETS до V429
]

# Маркеры: файл должен содержать строку после заливки.
MARKERS = [
    ("src/lib/human-error.js", "HUMAN_BY_CODE"),
    ("src/routes/telephony.js", "agiBody"),
    ("src/routes/tenders.js", "$1::varchar"),
    ("src/services/job-queue.js", "$1::varchar"),
    ("src/services/thing-pipeline.js", "$2::varchar"),
    ("public/assets/js/app.js", "_sseSourceReset"),
    ("public/assets/js/huginn_sse.js", "_listenersBound"),
    ("public/assets/js/field-tab.js", "persistCategory"),
    ("tools/migrate_targeted.js", "V429__doc_owner_note"),
]

failures = []


def run(cmd, check=True):
    p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if check and p.returncode != 0:
        raise RuntimeError(f"FAIL {' '.join(cmd[:5])}: {(p.stderr or p.stdout)[:400]}")
    return p


def ssh(remote, check=True):
    return run(["ssh", "-i", KEY, "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=25",
                HOST, remote], check=check)


def md5_local(rel):
    h = hashlib.md5()
    with (ROOT / rel).open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    print("=" * 70)
    print(f"DEPLOY D-307..D-314  ({STAMP})")
    print("=" * 70)

    # 0. что реально расходится
    to_upload = []
    for rel in FILES:
        local = md5_local(rel)
        out = ssh(f"md5sum {PROJECT}/{rel} 2>/dev/null | awk '{{print $1}}'").stdout.strip()
        if out != local:
            to_upload.append(rel)
            print(f"  DIFF  {rel}  local={local[:12]} prod={out[:12] or 'MISSING'}")
        else:
            print(f"  SAME  {rel}")
    if not to_upload:
        print("\nвсё уже на проде — рестарт не нужен")
        return 0

    # 1. снапшот
    print(f"\n=== 1. СНАПШОТ ({len(to_upload)} файлов) ===")
    ssh(f"mkdir -p /root/snapshots && tar -C {PROJECT} -czf {SNAP} " + " ".join(to_upload))
    listing = ssh(f"tar -tzf {SNAP}").stdout
    missing = [r for r in to_upload if r not in listing]
    if missing:
        print(f"  FAIL: в снапшоте нет {missing}")
        return 1
    print(f"  OK: {SNAP}")
    for rel in to_upload:
        out = ssh(f"md5sum {PROJECT}/{rel} | awk '{{print $1}}'").stdout.strip()
        print(f"    {rel}  prod_md5={out[:12]}")

    # 2. заливка
    print(f"\n=== 2. ЗАЛИВКА ===")
    for rel in to_upload:
        remote_tmp = f"/tmp/d307-{STAMP}-{rel.replace('/', '_')}"
        run(["scp", "-i", KEY, "-o", "StrictHostKeyChecking=no",
             str(ROOT / rel), f"{HOST}:{remote_tmp}"])
        # атомарно: mv в проект (файл не бывает обрезанным)
        ssh(f"mkdir -p {PROJECT}/{Path(rel).parent} && mv -f {remote_tmp} {PROJECT}/{rel}")
        local = md5_local(rel)
        remote = ssh(f"md5sum {PROJECT}/{rel} | awk '{{print $1}}'").stdout.strip()
        if local != remote:
            failures.append(f"md5 не совпал: {rel} local={local} prod={remote}")
            print(f"  FAIL {rel}")
        else:
            print(f"  OK   {rel}  {local[:12]}")
        # синтаксис для JS
        if rel.endswith(".js"):
            chk = ssh(f"cd {PROJECT} && node --check {rel}", check=False)
            if chk.returncode != 0:
                failures.append(f"node --check: {rel}: {(chk.stderr or '')[:200]}")
                print(f"  FAIL node --check {rel}")

    if failures:
        print("\nОШИБКИ ЗАЛИВКИ:")
        for f in failures:
            print("  -", f)
        print(f"\nОткат: tar -C {PROJECT} -xzf {SNAP}")
        return 1

    # 3. маркеры
    print("\n=== 3. МАРКЕРЫ ===")
    for rel, needle in MARKERS:
        cnt = ssh(f"grep -c {needle!r} {PROJECT}/{rel} 2>/dev/null || echo 0").stdout.strip().splitlines()[-1]
        ok = cnt not in ("", "0")
        print(f"  {'OK  ' if ok else 'FAIL'} {rel} :: {needle} = {cnt}")
        if not ok:
            failures.append(f"маркер не найден: {rel} :: {needle}")

    if failures:
        print("\nОШИБКИ МАРКЕРОВ:")
        for f in failures:
            print("  -", f)
        return 1

    # 4. рестарт + health
    print("\n=== 4. РЕСТАРТ ===")
    ssh("systemctl restart asgard-crm")
    ok = False
    for i in range(1, 16):
        time.sleep(2)
        out = ssh("systemctl is-active asgard-crm; "
                  "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health", check=False).stdout
        if "active" in out and "200" in out:
            print(f"  HEALTH OK (попытка {i})")
            ok = True
            break
    if not ok:
        ssh("journalctl -u asgard-crm -n 60 --no-pager | tail -40", check=False)
        print("  FAIL: health не подтверждён")
        print(f"  Откат: tar -C {PROJECT} -xzf {SNAP} && systemctl restart asgard-crm")
        return 1

    # 5. смоук логов: нет новых level:50 за минуту
    print("\n=== 5. СМОУК ЛОГОВ (60 c после рестарта) ===")
    time.sleep(30)
    errs = ssh("journalctl -u asgard-crm --since '1 minute ago' --no-pager "
               "| grep -c '\"level\":50' || echo 0", check=False).stdout.strip().splitlines()[-1]
    print(f"  level:50 за минуту после рестарта: {errs}")

    print("\n=== DEPLOY DONE ===")
    print(f"снапшот: {SNAP}")
    print("Дальше (порядок важен): python tools/restore_asset_sync.py plan")
    print("                        node tools/audit_silent_reverts.js --post-deploy")
    return 0


if __name__ == "__main__":
    sys.exit(main())
