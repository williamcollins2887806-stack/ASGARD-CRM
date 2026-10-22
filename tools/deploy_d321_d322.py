"""Деплой D-321/D-322: две реальные ошибки + IMAP-шум в пушах."""
import hashlib
import subprocess
import sys
import time
from pathlib import Path

KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
HOST = "root@92.242.61.184"
PROJECT = "/var/www/asgard-crm"
STAMP = time.strftime("%Y%m%d-%H%M%S")

FILES = [
    "src/routes/equipment.js",
    "src/services/log-monitor-cron.js",
    "tools/migrate_targeted.js",
]

MARKERS = [
    ("src/routes/equipment.js", "rejection_reason = $1"),
    ("src/routes/equipment.js", "e.status = $${idx++}"),
    ("src/services/log-monitor-cron.js", "D-322"),
    ("src/services/log-monitor-cron.js", "lastFingerprint"),
    ("tools/migrate_targeted.js", "V433__recalc_no_work_for_expense"),
]

ROOT = Path.cwd()


def run(cmd, check=True):
    p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if check and p.returncode != 0:
        raise RuntimeError(f"FAIL {' '.join(cmd[:4])}: {(p.stderr or p.stdout)[:300]}")
    return p


def ssh(cmd, check=True):
    return run(["ssh", "-i", KEY, "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=25", HOST, cmd], check=check)


def md5_local(rel):
    h = hashlib.md5()
    with (ROOT / rel).open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    print("=" * 66)
    print("DEPLOY D-321/D-322")
    print("=" * 66)

    to_up = []
    for rel in FILES:
        local = md5_local(rel)
        remote = ssh(f"md5sum {PROJECT}/{rel} 2>/dev/null | awk '{{print $1}}'").stdout.strip()
        if local != remote:
            to_up.append(rel)
            print(f"  DIFF {rel}")
        else:
            print(f"  SAME {rel}")

    if not to_up:
        print("\nвсё уже на проде")
        return 0

    snap = f"/root/snapshots/asgard-d321-{STAMP}.tgz"
    print(f"\n=== снапшот -> {snap} ===")
    ssh(f"mkdir -p /root/snapshots && tar -C {PROJECT} -czf {snap} " + " ".join(to_up))
    if not ssh(f"test -f {snap} && echo OK").stdout.strip().endswith("OK"):
        print("FAIL: снапшот не создан")
        return 1
    print("  OK")

    print("\n=== заливка ===")
    for rel in to_up:
        tmp = f"/tmp/d321-{rel.replace('/', '_')}"
        run(["scp", "-i", KEY, "-o", "StrictHostKeyChecking=no", str(ROOT / rel), f"{HOST}:{tmp}"])
        ssh(f"mkdir -p {PROJECT}/{Path(rel).parent} && mv -f {tmp} {PROJECT}/{rel}")
        chk = ssh(f"cd {PROJECT} && node --check {rel} && echo OK", check=False)
        if "OK" not in (chk.stdout or ""):
            print(f"  FAIL node --check {rel}")
            print(f"  ОТКАТ: tar -C {PROJECT} -xzf {snap}")
            return 1
        local = md5_local(rel)
        remote = ssh(f"md5sum {PROJECT}/{rel} | awk '{{print $1}}'").stdout.strip()
        ok = local == remote
        print(f"  {'OK  ' if ok else 'FAIL'} {rel} {local[:10]}")
        if not ok:
            print(f"  ОТКАТ: tar -C {PROJECT} -xzf {snap}")
            return 1

    print("\n=== маркеры ===")
    bad = 0
    for rel, needle in MARKERS:
        out = ssh(f"grep -c -F {needle!r} {PROJECT}/{rel} 2>/dev/null || echo 0").stdout.strip().splitlines()[-1]
        ok = out not in ("", "0")
        if not ok:
            bad += 1
        print(f"  {'OK  ' if ok else 'FAIL'} {rel} :: {needle} = {out}")
    if bad:
        print(f"\nОТКАТ: tar -C {PROJECT} -xzf {snap}")
        return 1

    print("\n=== рестарт ===")
    ssh("systemctl restart asgard-crm")
    ok = False
    for i in range(1, 13):
        time.sleep(2)
        out = ssh("systemctl is-active asgard-crm; curl -s -o /dev/null -w '%{http_code}' "
                  "http://127.0.0.1:3000/api/health", check=False).stdout
        if "active" in out and "200" in out:
            print(f"  HEALTH OK (попытка {i})")
            ok = True
            break
    if not ok:
        print(f"  FAIL health. ОТКАТ: tar -C {PROJECT} -xzf {snap} && systemctl restart asgard-crm")
        return 1

    print("\n=== смоук: SQL-дефекты больше не всплывают ===")
    time.sleep(20)
    for pat in ["reject_reason", "character varying = integer"]:
        n = ssh(f"journalctl -u asgard-crm --since '2 minutes ago' --no-pager | grep -c -F {pat!r} || echo 0",
                check=False).stdout.strip().splitlines()[-1]
        print(f"  {pat}: {n}")

    print("\n=== DEPLOY DONE ===")
    print(f"снапшот: {snap}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
