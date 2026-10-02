#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PROC global lock hard + UI закрытия месяца — shell 20.28.52 → 20.28.53.

FILES:
  * src/lib/timesheet-locks.js — global лочит всех ролей
  * src/routes/timesheet-v2.js — PROC POST/DELETE lock global; fallback assert
  * public/assets/js/timesheet-v2.js — панель закрытия как у директора
  * public/index.html / public/sw.js — бамп 20.28.53

Запуск: python tools/deploy_proc_global_lock_20_28_53.py
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

VER = "20.28.53"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
SSH_HOST = "root@92.242.61.184"
PROJECT = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-proc-lock-{STAMP}.tgz"

CODE_FILES = [
    "src/lib/timesheet-locks.js",
    "src/routes/timesheet-v2.js",
    "public/assets/js/timesheet-v2.js",
    "public/index.html",
    "public/sw.js",
]

SNAP_MD5: dict[str, str] = {}

MARKERS = [
    ("src/lib/timesheet-locks.js", "Запирает ВСЕХ ролей"),
    ("src/routes/timesheet-v2.js", "isGlobalLeanRole(role)"),
    ("src/routes/timesheet-v2.js", "isProcGlobal"),
    ("public/assets/js/timesheet-v2.js", "role === 'PROC' && slLike.scope === 'global'"),
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
    print(f"$ {' '.join(cmd[:8])}{' ...' if len(cmd) > 8 else ''}")
    p = subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=child_env(),
    )
    if p.stdout.strip():
        print(p.stdout[-8000:])
    if p.stderr.strip():
        print("STDERR:", p.stderr[-2000:])
    if check and p.returncode != 0:
        raise DeployError(f"FAIL ({p.returncode}): {' '.join(cmd[:4])}")
    return p


def ssh(remote: str) -> subprocess.CompletedProcess:
    for attempt in range(1, 5):
        p = run(
            [
                "ssh",
                "-i",
                SSH_KEY,
                "-o",
                "StrictHostKeyChecking=no",
                "-o",
                "ConnectTimeout=25",
                "-o",
                "ServerAliveInterval=15",
                "-o",
                "ServerAliveCountMax=4",
                SSH_HOST,
                remote,
            ],
            check=False,
        )
        if p.returncode == 0:
            return p
        print(f"  [ssh] попытка {attempt}/4 не удалась (rc={p.returncode}), повтор...")
        time.sleep(5)
    raise DeployError(f"SSH не прошёл за 4 попытки: {remote[:80]}")


def ssh_soft(remote: str) -> subprocess.CompletedProcess:
    return run(
        [
            "ssh",
            "-i",
            SSH_KEY,
            "-o",
            "StrictHostKeyChecking=no",
            "-o",
            "ConnectTimeout=25",
            "-o",
            "ServerAliveInterval=15",
            SSH_HOST,
            remote,
        ],
        check=False,
    )


def scp_retry(local: str, remote: str) -> None:
    for attempt in range(1, 5):
        p = run(
            [
                "scp",
                "-i",
                SSH_KEY,
                "-o",
                "StrictHostKeyChecking=no",
                "-o",
                "ConnectTimeout=25",
                "-o",
                "ServerAliveInterval=15",
                local,
                f"{SSH_HOST}:{remote}",
            ],
            check=False,
        )
        if p.returncode == 0:
            return
        print(f"  [scp] попытка {attempt}/4 не удалась (rc={p.returncode}), повтор...")
        time.sleep(5)
    raise DeployError(f"scp не прошёл за 4 попытки: {remote}")


def make_snapshot() -> None:
    print("\n=== 1. SNAPSHOT ===")
    snap_paths = " ".join(CODE_FILES)
    ssh(f"mkdir -p /root/snapshots && tar -C {PROJECT} -czf {SNAP} {snap_paths}")
    listing = ssh(f"tar -tzf {SNAP}").stdout or ""
    for rel in CODE_FILES:
        if rel not in listing:
            raise DeployError(f"в снапшоте нет {rel}")
    for rel in CODE_FILES:
        out = ssh(f"md5sum {PROJECT}/{rel}").stdout or ""
        SNAP_MD5[rel] = (out.split() or ["?"])[0]
    print(f"снапшот: {SNAP} — {len(CODE_FILES)} файлов")


def upload_code() -> None:
    print(f"\n=== 2. ЗАЛИВКА CODE: {len(CODE_FILES)} ===")
    remote_tar = f"/tmp/asgard-proc-lock-code-{STAMP}.tgz"
    stage = f"/tmp/asgard-proc-lock-stage-{STAMP}"
    with tempfile.TemporaryDirectory() as tmp:
        tar_path = Path(tmp) / "proc-lock-code.tgz"
        with tarfile.open(tar_path, "w:gz") as tar:
            for rel in CODE_FILES:
                tar.add(ROOT / rel, arcname=rel)
        scp_retry(str(tar_path), remote_tar)
    ssh(
        f"rm -rf {stage} && mkdir -p {stage} && tar xzf {remote_tar} -C {stage} "
        f"&& rm -f {remote_tar} && echo EXTRACT_OK"
    )
    for rel in CODE_FILES:
        local = md5_file(ROOT / rel)
        remote = ((ssh(f"md5sum {stage}/{rel}").stdout or "").split() or ["?"])[0]
        if local != remote:
            raise DeployError(f"md5 stage mismatch {rel}: local={local} stage={remote}")
    ssh(" && ".join([f"mkdir -p $(dirname {PROJECT}/{rel})" for rel in CODE_FILES]))
    ssh(" && ".join([f"mv -f {stage}/{rel} {PROJECT}/{rel}" for rel in CODE_FILES]) + f" && rm -rf {stage}")
    for rel in CODE_FILES:
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
    out = (
        ssh(
            "curl -s http://127.0.0.1:3000/api/version; echo; "
            "curl -s -o /dev/null -w 'home:%{http_code}\\n' https://asgard-crm.ru/"
        ).stdout
        or ""
    )
    print(out.strip())
    if VER not in out:
        raise DeployError(f"/api/version не содержит {VER}")
    if "home:200" not in out:
        raise DeployError("главная не 200")

    checks = [
        ("public/index.html", f"ASGARD_SHELL_VERSION = '{VER}'"),
        ("public/sw.js", f"SHELL_VERSION = '{VER}'"),
        ("src/lib/timesheet-locks.js", "Запирает ВСЕХ ролей"),
        ("src/routes/timesheet-v2.js", "isProcGlobal"),
        ("public/assets/js/timesheet-v2.js", "role === 'PROC' && slLike.scope === 'global'"),
    ]
    for rel, needle in checks:
        n = needle.replace("'", "'\\''")
        res = ssh(f"grep -cF '{n}' {PROJECT}/{rel}")
        c = (res.stdout or "0").strip().splitlines()[-1] if (res.stdout or "").strip() else "0"
        print(f"  {'OK  ' if c not in ('', '0') else 'FAIL'} {rel} :: {needle[:60]} = {c}")
        if c in ("", "0"):
            raise DeployError(f"маркер не на проде: {rel} :: {needle}")

    served = None
    n = "0"
    for attempt in range(1, 5):
        served = ssh_soft(
            f"curl -s 'http://127.0.0.1:3000/assets/js/timesheet-v2.js?v={VER}' | "
            f"grep -cF \"role === 'PROC' && slLike.scope === 'global'\""
        )
        n = (served.stdout or "0").strip().splitlines()[-1] if (served.stdout or "").strip() else "0"
        if n not in ("", "0"):
            break
        print(f"  [smoke] served timesheet-v2 try {attempt}/4 → {n!r}, повтор...")
        time.sleep(3)
    print(f"  {'OK  ' if n not in ('', '0') else 'FAIL'} отдаваемый timesheet-v2.js :: PROC unlock = {n}")
    if n in ("", "0"):
        raise DeployError("в отдаваемом timesheet-v2.js нет PROC global unlock")


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
    print(f"DEPLOY PROC global lock hard — shell {VER}")
    print("=" * 78)

    print("\n=== 0. PRE-FLIGHT ===")
    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=True)
    print("shell_guard: OK")

    missing = [f for f in CODE_FILES if not (ROOT / f).is_file()]
    if missing:
        raise SystemExit(f"нет файлов: {missing}")
    for rel, needle in MARKERS:
        text = (ROOT / rel).read_text(encoding="utf-8")
        if needle not in text:
            raise SystemExit(f"маркер отсутствует: {rel} :: {needle}")
    print(f"маркеры OK; code={len(CODE_FILES)}")

    snapshot_done = False
    try:
        make_snapshot()
        snapshot_done = True
        upload_code()
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

    print("\n" + "=" * 78)
    print(f"DEPLOY OK — shell {VER}, snapshot {SNAP}")
    print("=" * 78)


if __name__ == "__main__":
    try:
        main()
    except DeployError as e:
        print(f"\nDEPLOY FAIL: {e}", file=sys.stderr)
        raise SystemExit(1)
