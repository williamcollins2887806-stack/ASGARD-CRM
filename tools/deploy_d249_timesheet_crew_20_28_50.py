#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""D-249 — выкатка дня табеля (vanilla field-tab + backend).

shell 20.28.49 → 20.28.50. FILES:
  * public/assets/js/field-tab.js  — office-stage overwrite + searchable crew
  * src/routes/field-manage.js     — POST /crew чистит departure_*
  * src/routes/field-pm.js         — wa.tier AS rarity
  * src/routes/staff.js            — busy AND departure_date IS NULL
  * public/index.html / public/sw.js — бамп оболочки

v2 src коммитится в git, на прод не везём (отдаётся /v2/ билд; РП сидит в vanilla).

Запуск: python tools/deploy_d249_timesheet_crew_20_28_50.py
"""

from __future__ import annotations

import hashlib
import os
import subprocess
import sys
import tarfile
import tempfile
import time
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]


class DeployError(Exception):
    pass


ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "tools"
sys.path.insert(0, str(TOOLS))

import shell_guard  # noqa: E402

VER = "20.28.50"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
SSH_HOST = "root@92.242.61.184"
PROJECT = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-d249-{STAMP}.tgz"

FILES = [
    "public/assets/js/field-tab.js",
    "src/routes/field-manage.js",
    "src/routes/field-pm.js",
    "src/routes/staff.js",
    "public/index.html",
    "public/sw.js",
]
SNAP_MD5: dict[str, str] = {}

MARKERS = [
    ("public/assets/js/field-tab.js", "_isOfficeStageShift"),
    ("public/assets/js/field-tab.js", "уехал с этого объекта"),
    ("public/assets/js/field-tab.js", "searchable: true"),
    ("src/routes/field-manage.js", "inactivity_auto_departed_at = CASE WHEN $9::boolean"),
    ("src/routes/field-pm.js", "wa.tier AS rarity"),
    ("src/routes/staff.js", "AND ea.departure_date IS NULL"),
    ("public/index.html", VER),
    ("public/sw.js", VER),
]


def md5_file(path: Path) -> str:
    h = hashlib.md5()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def child_env() -> dict:
    env = dict(os.environ)
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    return env


def run(cmd: list[str], cwd: Path | None = None, check: bool = True) -> subprocess.CompletedProcess:
    print(f"$ {' '.join(cmd[:6])}{' ...' if len(cmd) > 6 else ''}")
    p = subprocess.run(cmd, cwd=str(cwd) if cwd else None, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", env=child_env())
    if p.stdout.strip():
        print(p.stdout[-8000:])
    if p.stderr.strip():
        print("STDERR:", p.stderr[-2000:])
    if check and p.returncode != 0:
        raise DeployError(f"FAIL ({p.returncode}): {' '.join(cmd[:4])}")
    return p


def ssh(remote: str) -> subprocess.CompletedProcess:
    for attempt in range(1, 5):
        p = run(["ssh", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=25",
                 "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=4", SSH_HOST, remote],
                check=False)
        if p.returncode == 0:
            return p
        print(f"  [ssh] попытка {attempt}/4 не удалась (rc={p.returncode}), повтор...")
        time.sleep(5)
    raise DeployError(f"SSH не прошёл за 4 попытки: {remote[:80]}")


def ssh_soft(remote: str) -> subprocess.CompletedProcess:
    return run(["ssh", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=25",
                "-o", "ServerAliveInterval=15", SSH_HOST, remote], check=False)


def scp_retry(local: str, remote: str) -> None:
    for attempt in range(1, 5):
        p = run(["scp", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=25",
                 "-o", "ServerAliveInterval=15", local, f"{SSH_HOST}:{remote}"], check=False)
        if p.returncode == 0:
            return
        print(f"  [scp] попытка {attempt}/4 не удалась (rc={p.returncode}), повтор...")
        time.sleep(5)
    raise DeployError(f"scp не прошёл за 4 попытки: {remote}")


def make_snapshot() -> None:
    print("\n=== 1. SNAPSHOT ===")
    for rel in FILES:
        if "PRESENT" not in (ssh(f"test -f {PROJECT}/{rel} && echo PRESENT || echo MISSING").stdout or ""):
            raise DeployError(f"на проде нет файла {rel}")
    ssh(f"mkdir -p /root/snapshots && tar -C {PROJECT} -czf {SNAP} " + " ".join(FILES))
    listing = ssh(f"tar -tzf {SNAP}").stdout or ""
    missing = [rel for rel in FILES if rel not in listing]
    if missing:
        raise DeployError(f"в снапшоте нет {missing}")
    for rel in FILES:
        val = ((ssh(f"md5sum {PROJECT}/{rel}").stdout or "").split() or [""])[0]
        if len(val) != 32:
            raise DeployError(f"не снял md5 прод-файла {rel}")
        SNAP_MD5[rel] = val
    print(f"снапшот: {SNAP} — {len(FILES)} файлов")
    print((ssh(f"ls -lh {SNAP}").stdout or "").strip())


def upload() -> None:
    print(f"\n=== 2. ЗАЛИВКА: {len(FILES)} файл(ов) ===")
    remote_tar = f"/tmp/asgard-d249-code-{STAMP}.tgz"
    stage = f"{PROJECT}/.deploy-stage-d249-{STAMP}"
    with tempfile.TemporaryDirectory() as tmp:
        tar_path = Path(tmp) / "d249-code.tgz"
        with tarfile.open(tar_path, "w:gz") as tar:
            for rel in FILES:
                tar.add(ROOT / rel, arcname=rel)
        scp_retry(str(tar_path), remote_tar)
    ssh(f"rm -rf {stage} && mkdir -p {stage} && tar xzf {remote_tar} -C {stage} "
        f"&& rm -f {remote_tar} && echo EXTRACT_OK")
    for rel in FILES:
        local = md5_file(ROOT / rel)
        staged = ((ssh(f"md5sum {stage}/{rel}").stdout or "").split() or ["?"])[0]
        if staged != local:
            ssh_soft(f"rm -rf {stage}")
            raise DeployError(f"стейдж не совпал: {rel} local={local} stage={staged}")
    ssh(" && ".join([f"mv -f {stage}/{rel} {PROJECT}/{rel}" for rel in FILES])
        + f" && rm -rf {stage} && echo SWITCH_OK")
    for rel in FILES:
        local = md5_file(ROOT / rel)
        remote = ((ssh(f"md5sum {PROJECT}/{rel}").stdout or "").split() or ["?"])[0]
        ok = remote == local
        print(f"  {'OK  ' if ok else 'FAIL'} {rel}  local={local} prod={remote}")
        if not ok:
            raise DeployError(f"md5 после заливки: {rel}")


def restart() -> None:
    print("\n=== 3. RESTART ===")
    ssh("systemctl restart asgard-crm")
    for i in range(1, 21):
        time.sleep(2)
        p = ssh_soft("curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health")
        code = (p.stdout or "").strip()
        print(f"  health try {i}: {code}")
        if code == "200":
            return
    raise DeployError("health не стал 200 после рестарта")


def smoke() -> None:
    print("\n=== 4. SMOKE ===")
    out = (ssh("curl -s http://127.0.0.1:3000/api/version; echo; "
               "curl -s -o /dev/null -w 'home:%{http_code}\\n' https://asgard-crm.ru/").stdout or "")
    print(out.strip())
    if VER not in out:
        raise DeployError(f"/api/version не содержит {VER}")
    if "home:200" not in out:
        raise DeployError("главная не 200")

    for rel, needle in [
        ("public/assets/js/field-tab.js", "_isOfficeStageShift"),
        ("src/routes/field-pm.js", "wa.tier AS rarity"),
        ("src/routes/field-manage.js", "inactivity_auto_departed_at"),
        ("src/routes/staff.js", "AND ea.departure_date IS NULL"),
        ("public/index.html", f"ASGARD_SHELL_VERSION = '{VER}'"),
        ("public/sw.js", f"SHELL_VERSION = '{VER}'"),
    ]:
        # escape single quotes for remote grep
        n = needle.replace("'", "'\\''")
        res = ssh(f"grep -c '{n}' {PROJECT}/{rel}")
        c = (res.stdout or "0").strip().splitlines()[-1] if (res.stdout or "").strip() else "0"
        print(f"  {'OK  ' if c not in ('', '0') else 'FAIL'} {rel} :: {needle[:40]} = {c}")
        if c in ("", "0"):
            raise DeployError(f"маркер не на проде: {rel} :: {needle}")

    served = ssh_soft(
        f"curl -s 'https://asgard-crm.ru/assets/js/field-tab.js?v={VER}' | grep -c '_isOfficeStageShift'"
    )
    n = (served.stdout or "0").strip().splitlines()[-1] if (served.stdout or "").strip() else "0"
    print(f"  {'OK  ' if n not in ('', '0') else 'FAIL'} отдаваемый field-tab.js :: _isOfficeStageShift = {n}")
    if n in ("", "0"):
        raise DeployError("в отдаваемом field-tab.js нет _isOfficeStageShift")


def rollback(reason: str) -> None:
    print("\n" + "!" * 78)
    print(f"! ОТКАТ: {reason}")
    print("!" * 78)
    try_ssh(f"tar -C {PROJECT} -xzf {SNAP}")
    try_ssh("systemctl restart asgard-crm")
    mismatch = []
    for rel, want in SNAP_MD5.items():
        got = ((try_ssh(f"md5sum {PROJECT}/{rel}").split() or ["?"])[0])
        if got != want:
            mismatch.append(f"{rel}: want {want}, got {got}")
    if mismatch:
        print("!!! ОТКАТ НЕ ПОДТВЕРЖДЁН — " + SNAP)
        for m in mismatch[:20]:
            print("    · " + m)
        raise SystemExit(f"ДЕПЛОЙ ПРЕРВАН, ОТКАТ НЕ ПОДТВЕРЖДЁН: {reason}")
    print(f"ОТКАТ ПОДТВЕРЖДЁН: {len(SNAP_MD5)}/{len(SNAP_MD5)}")
    raise SystemExit(f"ДЕПЛОЙ ПРЕРВАН И ОТКАЧЕН: {reason}")


def try_ssh(cmd: str) -> str:
    try:
        return ssh(cmd).stdout or ""
    except DeployError as exc:
        print(f"  [откат] ssh: {exc}")
        return ""


def main() -> None:
    print("=" * 78)
    print(f"DEPLOY D-249 timesheet/crew — shell {VER}")
    print("=" * 78)

    print("\n=== 0. PRE-FLIGHT ===")
    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=True)
    print("shell_guard: OK")

    missing = [f for f in FILES if not (ROOT / f).is_file()]
    if missing:
        raise SystemExit(f"нет файлов: {missing}")
    for rel, needle in MARKERS:
        if needle not in (ROOT / rel).read_text(encoding="utf-8"):
            raise SystemExit(f"маркер отсутствует: {rel} :: {needle}")
    print(f"маркеры OK; к заливке {len(FILES)}:")
    for f in FILES:
        print(f"   ~ {f}")

    snapshot_done = False
    try:
        make_snapshot()
        snapshot_done = True
        upload()
        restart()
        smoke()
    except DeployError as exc:
        if snapshot_done:
            rollback(f"аварийное завершение: {exc}")
        raise
    except Exception as exc:
        if snapshot_done:
            rollback(f"непредвиденный сбой: {exc!r}")
        raise

    print("\n=== DEPLOY DONE ===")
    print(f"shell {VER}; снапшот: {SNAP}")
    print("Post-deploy:")
    print("  python tools/restore_asset_sync.py plan")
    print("  node tools/audit_silent_reverts.js --post-deploy")


if __name__ == "__main__":
    main()
