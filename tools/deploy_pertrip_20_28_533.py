#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Финальная выкатка P2: трудосутки по заездам + подписи без вранья.

История правок, вошедших в этот батч:
  1. `work_days_per_trip` в карточке читался из `visit_plan`, где «дни» —
     сумма суток позиций (150 на #2138), а не трудосутки плана (407).
  2. Подпись «на заезд» зависела от длины массива visits, а не от trip_count,
     и пропадала, когда ответ модели сжал список.
  3. В `normalizeCalcPlan` две ветки `crew_days` были идентичны — убраны.

Shell 20.28.535.
"""
from __future__ import annotations

import hashlib
import subprocess
import sys
import tarfile
import tempfile
import time
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import shell_guard  # noqa: E402

VER = "20.28.535"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
SSH_HOST = "root@92.242.61.184"
PROJECT = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-final-{STAMP}.tgz"

FILES = [
    "src/services/mimir-tender-stages.js",
    "public/assets/js/rp_review_modal.js",
    "public/index.html",
    "public/sw.js",
    "public/h/index.html",
    "public/h/sw.js",
    "public/ting/index.html",
    "public/ting-tv/index.html",
]

MARKERS = [
    ("src/services/mimir-tender-stages.js", "Ни нормы (MH), ни суток от модели нет"),
    ("src/services/mimir-tender-stages.js", "visits_work"),
    ("public/assets/js/rp_review_modal.js", "tripsForLabel"),
    ("public/index.html", VER),
    ("public/sw.js", VER),
]


def md5_file(path: Path) -> str:
    h = hashlib.md5()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def run(cmd: list[str], check: bool = True) -> subprocess.CompletedProcess:
    print(f"$ {' '.join(cmd[:8])}{' ...' if len(cmd) > 8 else ''}", flush=True)
    p = subprocess.run(cmd, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    if p.stdout.strip():
        print(p.stdout[-6000:], flush=True)
    if p.stderr.strip():
        print("STDERR:", p.stderr[-1500:], flush=True)
    if check and p.returncode != 0:
        raise SystemExit(f"FAIL ({p.returncode}): {' '.join(cmd[:4])}")
    return p


def ssh(remote: str) -> subprocess.CompletedProcess:
    for attempt in range(1, 6):
        p = run([
            "ssh", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no",
            "-o", "ConnectTimeout=30", "-o", "ServerAliveInterval=15",
            "-o", "ServerAliveCountMax=4", SSH_HOST, remote,
        ], check=False)
        if p.returncode == 0:
            return p
        print(f"  [ssh] попытка {attempt}/5 rc={p.returncode}", flush=True)
        time.sleep(4)
    raise SystemExit(f"SSH fail: {remote[:120]}")


def scp_retry(local: str, remote: str) -> None:
    for attempt in range(1, 6):
        p = run([
            "scp", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no",
            "-o", "ConnectTimeout=30", local, f"{SSH_HOST}:{remote}",
        ], check=False)
        if p.returncode == 0:
            return
        print(f"  [scp] попытка {attempt}/5 rc={p.returncode}", flush=True)
        time.sleep(4)
    raise SystemExit(f"scp fail: {remote}")


def main() -> None:
    print(f"DEPLOY per-trip label fix — shell {VER}", flush=True)

    print("TESTS:", flush=True)
    for rel in ["tests/ui-rp-visit-labels.test.js", "tests/p2-visit-work-days.test.js",
                "tests/visit-plan-reconcile.test.js", "tests/mimir-stages.test.js"]:
        p = run(["node", rel], check=False)
        tail = (p.stdout or "").strip().splitlines()[-1:] or ["(нет вывода)"]
        print(f"  {rel}: {tail[0]}", flush=True)
        if p.returncode != 0:
            raise SystemExit(f"тест красный: {rel}")

    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER)
    for rel, needle in MARKERS:
        if needle not in (ROOT / rel).read_text(encoding="utf-8"):
            raise SystemExit(f"маркер отсутствует: {rel} :: {needle}")
    print("preflight OK", flush=True)
    for rel in FILES:
        print(f"  {rel}  md5={md5_file(ROOT / rel)}", flush=True)

    listed = " ".join(FILES)
    ssh(f"mkdir -p /root/snapshots && "
        f"tar -C {PROJECT} -czf {SNAP} {listed} 2>/dev/null; ls -lh {SNAP}")

    with tempfile.TemporaryDirectory() as tmp:
        tar_path = Path(tmp) / "pack.tgz"
        with tarfile.open(tar_path, "w:gz") as tf:
            for rel in FILES:
                tf.add(ROOT / rel, arcname=rel)
        remote_tar = f"/tmp/asgard-pertrip-{STAMP}.tgz"
        scp_retry(str(tar_path), remote_tar)
        ssh(
            f"tar -C {PROJECT} -xzf {remote_tar} && cd {PROJECT} && "
            f"node --check public/assets/js/rp_review_modal.js && "
            f"grep -c '{VER}' public/sw.js && "
            f"systemctl restart asgard-crm"
        )

    print("HEALTH-WAIT:", flush=True)
    ssh(
        "systemctl is-active asgard-crm; "
        "for i in 1 2 3 4 5 6; do "
        "code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3000/api/health || true); "
        "echo try_$i=$code; "
        "[ \"$code\" = \"200\" ] && break; sleep 2; done"
    )
    print("POST-CHECK:", flush=True)
    ssh("cd /var/www/asgard-crm && md5sum " + " ".join(FILES))
    ssh(
        "cd /var/www/asgard-crm && "
        "grep -n \"SHELL_VERSION = \" public/sw.js | head -1 && "
        "grep -c '__renderVisitScheduleForTest' public/assets/js/rp_review_modal.js && "
        "curl -s 'http://127.0.0.1:3000/assets/js/rp_review_modal.js?v=" + VER + "' | grep -c 'Долю на заезд' && "
        "journalctl -u asgard-crm -n 20 --no-pager | tail -6"
    )
    print("DONE deploy " + VER, flush=True)


if __name__ == "__main__":
    main()
