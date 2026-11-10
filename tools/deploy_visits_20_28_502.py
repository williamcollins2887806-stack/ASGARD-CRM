#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Выкатка графика заездов: ДВ+анализ+просчёт, shell 20.28.502."""
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

VER = "20.28.502"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
SSH_HOST = "root@92.242.61.184"
PROJECT = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-visits-{STAMP}.tgz"

FILES = [
    "src/routes/tkp_quick.js",
    "src/routes/pm-duty.js",
    "src/services/mimir-tender-stages.js",
    "src/services/mimir-tender-stages-ai.js",
    "src/services/schedule-extract.js",
    "src/services/visit-plan.js",
    "src/services/asgard-smeta.js",
    "templates/prompts/PROMPT-dv-v1.md",
    "templates/prompts/PROMPT-calc-plan-v1.md",
    "public/assets/js/rp_review_modal.js",
    "public/assets/js/rp_calc_modal.js",
    "public/assets/js/mimir_stages_ui.js",
    "public/assets/css/rp-review-modal.css",
    "public/assets/css/rp-calc-modal.css",
    "public/assets/css/mimir-stages.css",
    "public/index.html",
    "public/sw.js",
    "public/h/index.html",
    "public/h/sw.js",
]

MARKERS = [
    ("src/services/visit-plan.js", "buildVisitPlan"),
    ("src/services/schedule-extract.js", "extractVisitPeriods"),
    ("src/services/mimir-tender-stages.js", "period_start"),
    ("src/routes/tkp_quick.js", "visit_plan"),
    ("src/routes/tkp_quick.js", "schedule_mode"),
    ("src/routes/pm-duty.js", "visit_mode_unconfirmed"),
    ("public/assets/js/rp_review_modal.js", "data-rp-visit-root"),
    ("public/assets/js/rp_calc_modal.js", "rp-calc-visits"),
    ("public/assets/js/mimir_stages_ui.js", "data-meter"),
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
    p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if p.stdout.strip():
        print(p.stdout[-8000:], flush=True)
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
    print(f"DEPLOY график заездов — shell {VER}", flush=True)
    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=False)
    for rel in FILES:
        if not (ROOT / rel).is_file():
            raise SystemExit(f"нет файла: {rel}")
    for rel, needle in MARKERS:
        if needle not in (ROOT / rel).read_text(encoding="utf-8"):
            raise SystemExit(f"маркер отсутствует: {rel} :: {needle}")
    print("preflight OK", flush=True)
    for rel in FILES:
        print(f"  {rel}  md5={md5_file(ROOT / rel)}", flush=True)

    listed = " ".join(FILES)
    ssh(f"mkdir -p /root/snapshots && tar -C {PROJECT} -czf {SNAP} {listed} 2>/dev/null; ls -lh {SNAP}")

    with tempfile.TemporaryDirectory() as tmp:
        tar_path = Path(tmp) / "pack.tgz"
        with tarfile.open(tar_path, "w:gz") as tf:
            for rel in FILES:
                tf.add(ROOT / rel, arcname=rel)
        remote_tar = f"/tmp/asgard-visits-{STAMP}.tgz"
        scp_retry(str(tar_path), remote_tar)
        ssh(
            f"tar -C {PROJECT} -xzf {remote_tar} && cd {PROJECT} && "
            f"node --check src/services/visit-plan.js && "
            f"node --check src/routes/tkp_quick.js && "
            f"node --check src/routes/pm-duty.js && "
            f"grep -c 'data-rp-visit-root' public/assets/js/rp_review_modal.js && "
            f"systemctl restart asgard-crm && sleep 3 && systemctl is-active asgard-crm"
        )

    print("POST-CHECK:", flush=True)
    ssh("cd /var/www/asgard-crm && md5sum " + " ".join(FILES))
    ssh("curl -s -o /dev/null -w 'root=%{http_code}\\n' --max-time 8 http://127.0.0.1:3000/")
    print("DONE deploy " + VER, flush=True)


if __name__ == "__main__":
    main()
