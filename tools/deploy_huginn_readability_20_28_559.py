#!/usr/bin/env python3
"""Деплой: читаемость чата Хугинна (клиренс композера + шрифт 14px), 20.28.559.

Набор строго из коммитов:
  5189f4ea — huginn_dock.css (клиренс на всех ширинах, --hg-font-body 14px)
  cba8d6b3 — index/sw/h-index/h-sw (бамп 20.28.558; ?v= у всех ассетов)
  c5a9ea92 — rp_review_modal.js (даты заездов Гантта из текстовых ярлыков)
  <bump>   — index/sw/h-index/h-sw (20.28.559)

Не везём (нет смысла / чужая незавершённая работа):
  warehouse-v2-equipment.js — md5 уже совпадает с продом;
  ting-*, src/index.js, EquipmentIssueModal.jsx — незакоммиченная работа
  параллельной сессии, отдельная задача.
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
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-huginn-readability-{TAG}"
EXPECT_VERSION = "20.28.559"

FILES = [
    "public/assets/css/huginn_dock.css",
    "public/assets/js/rp_review_modal.js",
    "public/index.html",
    "public/sw.js",
    "public/h/index.html",
    "public/h/sw.js",
]

MARKERS = [
    ("public/assets/css/huginn_dock.css", "--hg-font-body: 14px", "шкала: тело 14px"),
    ("public/assets/css/huginn_dock.css", "Клиренс композера", "клиренс на всех ширинах"),
    ("public/assets/js/rp_review_modal.js", "10.2027", "даты заездов Гантта"),
]


def md5_bytes(b: bytes) -> str:
    return hashlib.md5(b).hexdigest()


def run(c, cmd, timeout=180, allow_fail=False):
    print("====", cmd[:200].replace("\n", " "))
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out:
        print(out[-4000:] if len(out) > 4000 else out)
    if err.strip() and not allow_fail:
        print("STDERR:", err[:1200])
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


def main():
    guard()

    print("\n=== LOCAL MARKERS ===")
    for rel, needle, label in MARKERS:
        text = (ROOT / rel).read_text(encoding="utf-8", errors="replace")
        if needle not in text:
            raise SystemExit(f"локально нет маркера {label}")
        print(f"  OK {label}")

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    print("\n=== SNAPSHOT ===")
    run(c, "mkdir -p /root/snapshots && tar -C {p} -czf {s}.tgz {f} && ls -lh {s}.tgz".format(
        p=PROJECT, s=SNAP, f=" ".join(FILES)))

    print("\n=== UPLOAD ===")
    for rel in FILES:
        local = ROOT / rel
        remote = f"{PROJECT}/{rel}"
        digest = md5_bytes(local.read_bytes())
        sftp.put(str(local), remote)
        with sftp.file(remote, "rb") as rf:
            rmd5 = md5_bytes(rf.read())
        ok = rmd5 == digest
        print(f"  {'OK  ' if ok else 'FAIL'} {rel}  {digest[:10]}")
        if not ok:
            raise SystemExit("md5 mismatch: " + rel)

    print("\n=== RESTART ===")
    run(c, "systemctl restart asgard-crm && sleep 4 && systemctl is-active asgard-crm "
           "&& curl -sS -o /dev/null -w 'http=%{http_code}\\n' http://127.0.0.1:3000/api/version")

    print("\n=== VERIFY ON PROD ===")
    run(c, f"grep -c '14px/1.45' {PROJECT}/public/assets/css/huginn_dock.css")
    run(c, f"grep -c 'Клиренс композера' {PROJECT}/public/assets/css/huginn_dock.css")
    run(c, f"grep -c '10.2027' {PROJECT}/public/assets/js/rp_review_modal.js")
    run(c, f"grep -o \"ASGARD_SHELL_VERSION = '[0-9.]*'\" {PROJECT}/public/index.html | head -1")
    run(c, f"grep -o \"SHELL_VERSION = '[0-9.]*'\" {PROJECT}/public/h/sw.js | head -1")
    run(c, f"grep -o 'huginn_dock.css?v=[0-9.]*' {PROJECT}/public/index.html | head -1")

    print("\n=== SMOKE ===")
    for u in ["/", "/v2/", "/h/", "/m/"]:
        run(c, f"curl -sS -o /dev/null -w '  {u} -> %{{http_code}}\\n' http://127.0.0.1:3000{u}")

    sftp.close()
    c.close()
    print("\nDONE snapshot=", SNAP + ".tgz")


if __name__ == "__main__":
    main()
