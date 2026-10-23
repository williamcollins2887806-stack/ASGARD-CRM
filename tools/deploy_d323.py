"""Деплой D-323: 404 полевых API в debug + отпечаток монитора в БД."""
import hashlib
import subprocess
import sys
import time
from pathlib import Path

KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
HOST = "root@92.242.61.184"
PROJECT = "/var/www/asgard-crm"
STAMP = time.strftime("%Y%m%d-%H%M%S")

FILES = ["src/index.js", "src/services/log-monitor-cron.js", "tools/migrate_targeted.js"]
MARKERS = [
    ("src/index.js", "status === 401 || status === 404"),
    ("src/services/log-monitor-cron.js", "log_monitor_fingerprint"),
    ("tools/migrate_targeted.js", "V434__ai_error_classes"),
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
    print("=" * 60)
    print("DEPLOY D-323")
    print("=" * 60)

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

    snap = f"/root/snapshots/asgard-d323-{STAMP}.tgz"
    ssh(f"mkdir -p /root/snapshots && tar -C {PROJECT} -czf {snap} " + " ".join(to_up))
    print(f"\nснапшот: {snap}")

    for rel in to_up:
        tmp = f"/tmp/d323-{rel.replace('/', '_')}"
        run(["scp", "-i", KEY, "-o", "StrictHostKeyChecking=no", str(ROOT / rel), f"{HOST}:{tmp}"])
        ssh(f"mkdir -p {PROJECT}/{Path(rel).parent} && mv -f {tmp} {PROJECT}/{rel}")
        chk = ssh(f"cd {PROJECT} && node --check {rel} && echo OK", check=False)
        if "OK" not in (chk.stdout or ""):
            print(f"  FAIL node --check {rel}")
            print(f"  ОТКАТ: tar -C {PROJECT} -xzf {snap}")
            return 1
        local = md5_local(rel)
        remote = ssh(f"md5sum {PROJECT}/{rel} | awk '{{print $1}}'").stdout.strip()
        print(f"  {'OK  ' if local == remote else 'FAIL'} {rel}")
        if local != remote:
            return 1

    print("\nмаркеры:")
    for rel, needle in MARKERS:
        n = ssh(f"grep -c -F {needle!r} {PROJECT}/{rel} 2>/dev/null || echo 0").stdout.strip().splitlines()[-1]
        ok = n not in ("", "0")
        print(f"  {'OK  ' if ok else 'FAIL'} {rel} :: {needle} = {n}")
        if not ok:
            return 1

    print("\nрестарт:")
    ssh("systemctl restart asgard-crm")
    for i in range(1, 13):
        time.sleep(2)
        out = ssh("systemctl is-active asgard-crm; curl -s -o /dev/null -w '%{http_code}' "
                  "http://127.0.0.1:3000/api/health", check=False).stdout
        if "active" in out and "200" in out:
            print(f"  HEALTH OK (попытка {i})")
            break
    else:
        print(f"  FAIL health. ОТКАТ: tar -C {PROJECT} -xzf {snap}")
        return 1

    print(f"\n=== DEPLOY DONE, снапшот {snap} ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
