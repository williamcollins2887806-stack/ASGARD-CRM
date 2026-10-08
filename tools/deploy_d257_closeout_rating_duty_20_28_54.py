#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""D-257: closeout roster/legacy + анализ-рейтинг loyalty + duty gantt.

FILES: backend rating/duty/works + vanilla shell + v2 CloseoutWizard/WorkDetail source.
Shell: 20.28.54
Запуск: python tools/deploy_d257_closeout_rating_duty_20_28_54.py
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

VER = "20.28.54"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
SSH_HOST = "root@92.242.61.184"
PROJECT = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-d257-{STAMP}.tgz"

CODE_FILES = [
    "src/services/pm-analysis-rating.js",
    "src/services/tender-registry-helpers.js",
    "src/routes/pm-duty.js",
    "src/routes/works.js",
    "public/assets/js/pm_works.js",
    "public/assets/js/pm_duty.js",
    "public/assets/js/custom_dashboard.js",
    "public/assets/js/registry_api.js",
    "public/assets/css/app.css",
    "public/index.html",
    "public/sw.js",
    "public/desktop-v2-src/src/pages/PmWorks/api.js",
    "public/desktop-v2-src/src/pages/PmWorks/modals/CloseoutWizard.jsx",
    "public/desktop-v2-src/src/pages/PmWorks/modals/WorkDetail.jsx",
    "tests/sentinel_closeout_rating_duty.js",
]

SNAP_MD5: dict[str, str] = {}

MARKERS_PRESENT = [
    ("src/services/pm-analysis-rating.js", "BONUS.volume"),
    ("src/services/pm-analysis-rating.js", "только МОИ карточки"),
    ("src/routes/pm-duty.js", "is_duty: isDuty"),
    ("src/routes/works.js", "LEGACY_DONE"),
    ("public/assets/js/pm_duty.js", "intersectsViewport"),
    ("public/assets/js/pm_duty.js", "Europe/Moscow"),
    ("public/assets/js/pm_works.js", "btnRateCrew"),
    ("public/assets/js/pm_works.js", "crew-all"),
    ("public/sw.js", f"SHELL_VERSION = '{VER}'"),
    ("public/index.html", f"ASGARD_SHELL_VERSION = '{VER}'"),
]

MARKERS_ABSENT = [
    ("public/assets/js/pm_duty.js", "Math.max(3.5, pe - ps)"),
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
    # snapshot only files that already exist on prod (new test file may be absent)
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
    remote_tar = f"/tmp/asgard-d257-code-{STAMP}.tgz"
    stage = f"/tmp/asgard-d257-stage-{STAMP}"
    with tempfile.TemporaryDirectory() as tmp:
        tar_path = Path(tmp) / "d257-code.tgz"
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
    print(f"D-257 deploy shell={VER} stamp={STAMP}")
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
    restart()
    smoke()
    post_deploy_gates()
    print("\nDONE D-257")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except DeployError as e:
        print(f"\nDEPLOY FAIL: {e}", file=sys.stderr)
        raise SystemExit(1)
