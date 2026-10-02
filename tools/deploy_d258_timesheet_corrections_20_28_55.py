#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""D-258: timesheet corrections + ship click + tariff_points + hide test PM + lock UX.

FILES: field-tab / timesheet-v2 (js+route) / field-manage / roster / logistics-types + shell.
Shell: 20.28.55. Telephony НЕ трогаем.
Запуск: python tools/deploy_d258_timesheet_corrections_20_28_55.py
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

VER = "20.28.55"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
SSH_HOST = "root@92.242.61.184"
PROJECT = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-d258-{STAMP}.tgz"

CODE_FILES = [
    "src/lib/timesheet-logistics-types.js",
    "src/lib/field-timesheet-roster.js",
    "src/routes/field-manage.js",
    "src/routes/timesheet-v2.js",
    "public/assets/js/field-tab.js",
    "public/assets/js/timesheet-v2.js",
    "public/index.html",
    "public/sw.js",
    "migrations/V360__timesheet_corrections.sql",
    "migrations/V360__timesheet_corrections_down.sql",
    "tests/sentinel_d258_timesheet_fixes.js",
]

SNAP_MD5: dict[str, str] = {}

MARKERS_PRESENT = [
    ("src/lib/timesheet-logistics-types.js", "PM_OVERWRITE_STAGE_TYPES"),
    ("src/lib/timesheet-logistics-types.js", "isPmOverwriteType"),
    ("src/routes/timesheet-v2.js", "SCOPE_LOCK_ADMIN_ROLES"),
    ("src/routes/timesheet-v2.js", "timesheet_corrections"),
    ("src/routes/timesheet-v2.js", "@test.asgard.local"),
    ("src/routes/field-manage.js", "use_assignment_rate"),
    ("public/assets/js/timesheet-v2.js", "function cellIsEditable"),
    ("public/assets/js/timesheet-v2.js", "D-258: PM может кликнуть офисную логистику"),
    ("public/assets/js/field-tab.js", "use_assignment_rate = true"),
    ("public/assets/js/field-tab.js", "/api/timesheet/v2/corrections"),
    ("public/sw.js", f"SHELL_VERSION = '{VER}'"),
    ("public/index.html", f"ASGARD_SHELL_VERSION = '{VER}'"),
]

MARKERS_ABSENT = [
    ("public/index.html", "phone.css"),
    ("public/index.html", "jssip.min.js"),
    ("public/index.html", "phone_core.js"),
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
    existing = []
    for rel in CODE_FILES:
        p = ssh_soft(f"test -e {PROJECT}/{rel} && echo YES || echo NO")
        if "YES" in (p.stdout or ""):
            existing.append(rel)
    if not existing:
        existing = ["public/index.html", "public/sw.js"]
    ssh(f"mkdir -p /root/snapshots && tar -C {PROJECT} -czf {SNAP} {' '.join(existing)}")
    listing = ssh(f"tar -tzf {SNAP}").stdout or ""
    for rel in existing:
        if rel not in listing:
            raise DeployError(f"в снапшоте нет {rel}")
        out = ssh(f"md5sum {PROJECT}/{rel}").stdout or ""
        SNAP_MD5[rel] = (out.split() or ["?"])[0]
    print(f"снапшот: {SNAP} — {len(existing)} файлов")


def upload_code() -> None:
    print(f"\n=== 2. ЗАЛИВКА CODE: {len(CODE_FILES)} ===")
    remote_tar = f"/tmp/asgard-d258-code-{STAMP}.tgz"
    stage = f"/tmp/asgard-d258-stage-{STAMP}"
    with tempfile.TemporaryDirectory() as tmp:
        tar_path = Path(tmp) / "d258-code.tgz"
        with tarfile.open(tar_path, "w:gz") as tar:
            for rel in CODE_FILES:
                local = ROOT / rel
                if not local.exists():
                    raise DeployError(f"нет локального файла: {rel}")
                tar.add(local, arcname=rel)
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


def ensure_v360() -> None:
    print("\n=== 2b. V360 timesheet_corrections ===")
    exists = (ssh(
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -tAc "
        "\"SELECT to_regclass('public.timesheet_corrections');\""
    ).stdout or "").strip()
    print(f"  to_regclass={exists!r}")
    if exists == "timesheet_corrections":
        print("  таблица уже есть — skip apply")
        return
    sql = PROJECT + "/migrations/V360__timesheet_corrections.sql"
    ssh(f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 -f {sql}")
    again = (ssh(
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -tAc "
        "\"SELECT to_regclass('public.timesheet_corrections');\""
    ).stdout or "").strip()
    if again != "timesheet_corrections":
        raise DeployError(f"V360 не применилась: {again!r}")
    print("  V360 applied OK")


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
            "curl -s -o /dev/null -w 'home:%{http_code}\\n' http://127.0.0.1:3000/"
        ).stdout
        or ""
    )
    print(out.strip())
    if VER not in out:
        raise DeployError(f"/api/version не содержит {VER}")
    if "home:200" not in out:
        raise DeployError("главная не 200")

    for rel, needle in MARKERS_PRESENT:
        n = needle.replace("'", "'\\''")
        res = ssh(f"grep -cF '{n}' {PROJECT}/{rel}")
        c = (res.stdout or "0").strip().splitlines()[-1] if (res.stdout or "").strip() else "0"
        print(f"  {'OK  ' if c not in ('', '0') else 'FAIL'} present {rel} :: {needle[:50]} = {c}")
        if c in ("", "0"):
            raise DeployError(f"маркер не на проде: {rel} :: {needle}")

    for rel, needle in MARKERS_ABSENT:
        n = needle.replace("'", "'\\''")
        res = ssh_soft(f"grep -cF '{n}' {PROJECT}/{rel} || true")
        c = (res.stdout or "0").strip().splitlines()[-1] if (res.stdout or "").strip() else "0"
        try:
            count = int(c)
        except ValueError:
            count = 0
        print(f"  {'OK  ' if count == 0 else 'FAIL'} absent {rel} :: {needle} = {count}")
        if count != 0:
            raise DeployError(f"запрещённый маркер ещё на проде: {rel} :: {needle}")


def post_deploy_gates() -> None:
    print("\n=== 5. POST-DEPLOY GATES ===")
    run([sys.executable, str(TOOLS / "restore_asset_sync.py"), "plan"], cwd=ROOT)
    run(["node", str(TOOLS / "audit_silent_reverts.js"), "--post-deploy"], cwd=ROOT)


def main() -> int:
    print(f"D-258 deploy shell={VER} stamp={STAMP}")
    for rel in CODE_FILES:
        if not (ROOT / rel).exists():
            raise DeployError(f"missing {rel}")

    print("\n=== 0. PRE-DEPLOY GATES ===")
    shell_guard.assert_ok(expect_version=VER, deploy_gate=True)
    run(["node", str(TOOLS / "verify_index_tags.js")], cwd=ROOT)
    run(["node", str(TOOLS / "audit_silent_reverts.js")], cwd=ROOT)
    run([sys.executable, str(TOOLS / "restore_asset_sync.py"), "plan"], cwd=ROOT)

    make_snapshot()
    upload_code()
    ensure_v360()
    restart()
    smoke()
    post_deploy_gates()
    print("\nDONE D-258")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except DeployError as e:
        print(f"\nDEPLOY FAIL: {e}", file=sys.stderr)
        raise SystemExit(1)
