#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Выкатка P1 (дедуп) + P2 (трудосутки по заездам, окно визита).

Shell 20.28.532.

Что едет:
  • excel-structure.js — объём из геометрии («мм» в «суммарная», двойной счёт
    трубок), единица из заголовка колонки, третий отпечаток дедупа по названиям;
  • mimir-tender-stages.js — разрез трудосуток по заездам, проверка окна
    каждого заезда, согласование trip_count с числом заездов;
  • mimir-tender-stages-ai.js — estimateExpectedForSelection схлопывает один
    перечень, пришедший в двух вёрстках (675 вместо 1348 на #2138);
  • visit-plan-reconcile.js — новое правило mode/trip_count/visits;
  • rp_review_modal / rp_calc_modal / mimir_stages_ui — «трудосутки» вместо
    «дней», разрез и окно видим РП/ТО.

Смета (work_days) НЕ меняется: это трудосутки всего объёма и знаменатель ФОТ.
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

VER = "20.28.532"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
SSH_HOST = "root@92.242.61.184"
PROJECT = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-dedup-days-{STAMP}.tgz"

FILES = [
    "src/services/excel-structure.js",
    "src/services/mimir-tender-stages.js",
    "src/services/mimir-tender-stages-ai.js",
    "src/services/visit-plan-reconcile.js",
    "src/routes/tkp_quick.js",
    "src/routes/pm-duty.js",
    "public/assets/js/rp_review_modal.js",
    "public/assets/js/rp_calc_modal.js",
    "public/assets/js/mimir_stages_ui.js",
    "public/index.html",
    "public/sw.js",
    "public/h/index.html",
    "public/h/sw.js",
    "public/ting/index.html",
    "public/ting-tv/index.html",
]

MARKERS = [
    # P1: причина 1348 устранена на уровне объёма и отпечатка
    ("src/services/excel-structure.js", "взаимно маскировались"),
    ("src/services/excel-structure.js", "unitFromColumnHeader"),
    ("src/services/excel-structure.js", "ratio_name"),
    ("src/services/mimir-tender-stages-ai.js", "structureOf(d)"),
    # P2: разрез и окно
    ("src/services/mimir-tender-stages.js", "distributeWorkDaysByVisits"),
    ("src/services/mimir-tender-stages.js", "visits_work"),
    ("src/services/mimir-tender-stages.js", "visit_window_check"),
    ("src/services/mimir-tender-stages.js", "rawVisitsCount > 0"),
    ("src/services/visit-plan-reconcile.js", "reconcileVisitPlan"),
    ("src/routes/tkp_quick.js", "visit-plan-reconcile"),
    ("src/routes/pm-duty.js", "planVisitsCount"),
    # UI
    ("public/assets/js/rp_review_modal.js", "трудосуток"),
    ("public/assets/js/rp_calc_modal.js", "Трудосуток"),
    ("public/assets/js/mimir_stages_ui.js", "трудосут."),
    ("public/index.html", VER),
    ("public/sw.js", VER),
]

# Локальные тесты, которые обязаны быть зелёными перед выкаткой.
TESTS = [
    "tests/excel-structure.test.js",
    "tests/dv-structure-only.test.js",
    "tests/mimir-stages.test.js",
    "tests/mimir-stages-flow.test.js",
    "tests/mimir-stages-api.test.js",
    "tests/p2-visit-work-days.test.js",
    "tests/visit-plan-reconcile.test.js",
    "tests/calc-invariants.test.js",
    "tests/schedule-model.test.js",
    "tests/asgard-smeta-share.test.js",
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
    print(f"DEPLOY dedup + visit work_days — shell {VER}", flush=True)

    # 1. Тесты ДО сети: лучше упасть локально, чем на проде.
    print("TESTS:", flush=True)
    for rel in TESTS:
        p = run(["node", rel], check=False)
        tail = (p.stdout or "").strip().splitlines()[-1:] or ["(нет вывода)"]
        print(f"  {rel}: {tail[0]}", flush=True)
        if p.returncode != 0:
            raise SystemExit(f"тест красный: {rel}")
    run(["node", "tools/build_smeta_mirror.js", "--check"])

    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER)

    for rel in FILES:
        if not (ROOT / rel).is_file():
            raise SystemExit(f"нет файла: {rel}")
    for rel, needle in MARKERS:
        text = (ROOT / rel).read_text(encoding="utf-8")
        if needle not in text:
            raise SystemExit(f"маркер отсутствует: {rel} :: {needle}")
    print("preflight OK", flush=True)
    for rel in FILES:
        print(f"  {rel}  md5={md5_file(ROOT / rel)}", flush=True)

    listed = " ".join(FILES)
    ssh(
        f"mkdir -p /root/snapshots && "
        f"tar -C {PROJECT} -czf {SNAP} {listed} 2>/dev/null; ls -lh {SNAP}"
    )

    with tempfile.TemporaryDirectory() as tmp:
        tar_path = Path(tmp) / "pack.tgz"
        with tarfile.open(tar_path, "w:gz") as tf:
            for rel in FILES:
                tf.add(ROOT / rel, arcname=rel)
        remote_tar = f"/tmp/asgard-dedup-days-{STAMP}.tgz"
        scp_retry(str(tar_path), remote_tar)
        ssh(
            f"tar -C {PROJECT} -xzf {remote_tar} && cd {PROJECT} && "
            f"node --check src/services/excel-structure.js && "
            f"node --check src/services/mimir-tender-stages.js && "
            f"node --check src/services/mimir-tender-stages-ai.js && "
            f"node --check src/services/visit-plan-reconcile.js && "
            f"node --check src/routes/tkp_quick.js && "
            f"node --check src/routes/pm-duty.js && "
            f"grep -c 'reconcileVisitPlan' src/services/visit-plan-reconcile.js && "
            f"grep -c '{VER}' public/sw.js && "
            f"systemctl restart asgard-crm"
        )

    print("HEALTH-WAIT:", flush=True)
    ssh(
        "systemctl is-active asgard-crm; "
        "for i in 1 2 3 4 5 6 7 8; do "
        "code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3000/api/health || true); "
        "echo try_$i=$code; "
        "[ \"$code\" = \"200\" ] && break; sleep 2; done"
    )
    print("POST-CHECK:", flush=True)
    ssh("cd /var/www/asgard-crm && md5sum " + " ".join(FILES))
    ssh(
        "cd /var/www/asgard-crm && "
        "grep -n \"SHELL_VERSION = \" public/sw.js | head -1 && "
        "grep -c 'distributeWorkDaysByVisits' src/services/mimir-tender-stages.js && "
        "grep -c 'ratio_name' src/services/excel-structure.js && "
        "journalctl -u asgard-crm -n 30 --no-pager | tail -12"
    )
    print("DONE deploy " + VER, flush=True)


if __name__ == "__main__":
    main()
