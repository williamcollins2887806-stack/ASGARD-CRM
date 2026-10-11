#!/usr/bin/env python3
"""Деплой D-262: очереди дежурного + рейтинг + счётчики (shell 20.28.180 → 20.28.181).

Явный список файлов (как в D-181): посторонняя дельта на проде не трогается.

  * frontend: pm_duty.js, registry_api.js + оболочка (index.html, sw.js, h/*)
  * backend:  pm-duty.js, pm-analysis-rating.js → systemctl restart asgard-crm
  * snapshot на сервере ДО заливки
  * post-deploy: md5 local vs prod по каждому файлу
"""
import hashlib
import io
import sys
from datetime import datetime
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
PROJECT = "/var/www/asgard-crm"
ROOT = Path(__file__).resolve().parents[1]
SHELL_V = "20.28.181"

STATIC = [
    "public/assets/js/pm_duty.js",
    "public/assets/js/registry_api.js",
    "public/index.html",
    "public/sw.js",
    "public/h/index.html",
    "public/h/sw.js",
]
BACKEND = [
    "src/routes/pm-duty.js",
    "src/services/pm-analysis-rating.js",
]
FILES = STATIC + BACKEND


def md5b(b: bytes) -> str:
    return hashlib.md5(b).hexdigest()


def run(c, cmd, timeout=180):
    print("====", cmd[:150].replace("\n", " "), "====")
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", "replace")
    err = e.read().decode("utf-8", "replace")
    if out:
        print(out if len(out) <= 15000 else out[-15000:])
    if err.strip():
        print("STDERR:", err[:3000])
    return out


def main():
    for rel in FILES:
        if not (ROOT / rel).is_file():
            raise SystemExit(f"MISSING LOCAL: {rel}")
    sw = (ROOT / "public/sw.js").read_text(encoding="utf-8")
    idx = (ROOT / "public/index.html").read_text(encoding="utf-8")
    duty = (ROOT / "src/routes/pm-duty.js").read_text(encoding="utf-8")
    if f"SHELL_VERSION = '{SHELL_V}'" not in sw:
        raise SystemExit("LOCAL sw.js не на " + SHELL_V)
    if f"ASGARD_SHELL_VERSION = '{SHELL_V}'" not in idx or f"?v={SHELL_V}" not in idx:
        raise SystemExit("LOCAL index.html не на " + SHELL_V)
    if "notTerminalStatusesSql" not in duty or "queue/counts" not in duty:
        raise SystemExit("LOCAL pm-duty.js без правок D-262")
    for rel in FILES:
        if rel.endswith((".js", ".html")):
            if "\ufffd" in (ROOT / rel).read_text(encoding="utf-8"):
                raise SystemExit("U+FFFD в " + rel)
    print("preflight local: OK")

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    snap = f"/root/snapshots/asgard-crm-pre-deploy-d262-duty-queue-{stamp}"
    print(f"\n### SNAPSHOT → {snap}")
    run(c, f"mkdir -p {snap} && " + " && ".join(
        f"(cp -a {PROJECT}/{rel} {snap}/{rel.replace('/', '__')}.bak 2>/dev/null || echo 'NO {rel}')"
        for rel in FILES
    ) + f" && ls -1 {snap} | wc -l")

    print("\n### PROD BEFORE")
    run(c,
        f"grep -oP \"SHELL_VERSION = '\\K[^']+\" {PROJECT}/public/sw.js | head -1; "
        f"grep -c 'notTerminalStatusesSql' {PROJECT}/src/routes/pm-duty.js || true; "
        f"systemctl is-active asgard-crm")

    print("\n### UPLOAD")
    for rel in FILES:
        data = (ROOT / rel).read_bytes()
        sftp.put(str(ROOT / rel), f"{PROJECT}/{rel}")
        print(f"  ↑ {rel} md5={md5b(data)} size={len(data)}")

    print("\n### BACKEND RESTART")
    run(c, "systemctl restart asgard-crm && sleep 4 && systemctl is-active asgard-crm")

    print("\n### POST-DEPLOY md5 (local vs prod)")
    bad = []
    for rel in FILES:
        local = md5b((ROOT / rel).read_bytes())
        try:
            remote = md5b(sftp.file(f"{PROJECT}/{rel}", "r").read())
        except IOError:
            bad.append(rel)
            print(f"  NOFILE {rel}")
            continue
        ok = local == remote
        if not ok:
            bad.append(rel)
        print(f"  {'OK    ' if ok else 'MISMATCH'} {rel}")

    print("\n### PROD AFTER")
    run(c,
        f"grep -oP \"SHELL_VERSION = '\\K[^']+\" {PROJECT}/public/sw.js | head -1; "
        f"grep -c 'notTerminalStatusesSql' {PROJECT}/src/routes/pm-duty.js || true; "
        f"grep -c 'queue/counts' {PROJECT}/src/routes/pm-duty.js || true; "
        f"systemctl is-active asgard-crm; "
        f"curl -s -o /dev/null -w 'HTTP %{{http_code}}\\n' http://127.0.0.1:3000/api/version; "
        f"curl -s http://127.0.0.1:3000/api/version | head -c 200")

    run(c, "journalctl -u asgard-crm -n 8 --no-pager | tail -8")

    sftp.close()
    c.close()
    print(f"\nSNAPSHOT: {snap}")
    print("BAD FILES:", bad if bad else "нет — все md5 совпали")
    if bad:
        raise SystemExit("ДЕПЛОЙ НЕПОЛНЫЙ: " + ", ".join(bad))


if __name__ == "__main__":
    main()
