#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Hotfix: график отпусков ReferenceError D is not defined (shell 20.28.456).

Состав (ТОЛЬКО эти файлы — чужое dirty tree не трогаем):
  * public/assets/js/vacation_schedule.js — myDrafts/myPending → S.myEmployeeId
  * public/index.html, public/sw.js, public/h/* — bump 20.28.456 (cache bust)

Оболочка local==prod после version-normalize (проверено до выкатки).
Порядок: marker-check → .last-verified ← HEAD → shell_guard --deploy-gate
         → snapshot → tar+scp → md5 → health.
Откат: tar -xzf <snap> -C /var/www/asgard-crm
"""
from __future__ import annotations

import hashlib
import subprocess
import sys
import tarfile
import tempfile
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import paramiko  # noqa: E402
import shell_guard  # noqa: E402

VER = "20.28.456"
SSH_HOST, SSH_USER = "92.242.61.184", "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

FILES = [
    "public/assets/js/vacation_schedule.js",
    "public/index.html",
    "public/sw.js",
    "public/h/index.html",
    "public/h/sw.js",
]


def load_pkey(path: str):
    for loader in (
        getattr(paramiko, "Ed25519Key", None),
        getattr(paramiko, "ECDSAKey", None),
        paramiko.RSAKey,
    ):
        if loader is None:
            continue
        try:
            return loader.from_private_key_file(path)
        except Exception:
            continue
    raise SystemExit(f"cannot load SSH key: {path}")


def norm(b: bytes) -> str:
    return hashlib.md5(b.replace(b"\r\n", b"\n")).hexdigest()


def main() -> int:
    vs = (ROOT / "public/assets/js/vacation_schedule.js").read_text(encoding="utf-8")
    checks = [
        ("D && D.meId" not in vs, "no prototype D leftover"),
        ("S.meEmployeeId" not in vs, "no meEmployeeId typo"),
        ("periodsOf(S.myEmployeeId)" in vs, "myDrafts/myPending use myEmployeeId"),
        (f"SHELL_VERSION = '{VER}'" in (ROOT / "public/sw.js").read_text(encoding="utf-8"), f"sw {VER}"),
        (f"ASGARD_SHELL_VERSION = '{VER}'" in (ROOT / "public/index.html").read_text(encoding="utf-8"), f"index {VER}"),
    ]
    for ok, label in checks:
        if not ok:
            raise SystemExit(f"MISSING/FAIL: {label}")
        print(f"OK  {label}")

    head = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True
    ).stdout.strip()
    dirty = subprocess.run(
        ["git", "status", "--porcelain", "--"] + FILES,
        cwd=ROOT, capture_output=True, text=True, check=True
    ).stdout.strip()
    if dirty:
        raise SystemExit(
            "deploy files dirty in working tree — commit first:\n" + dirty
        )

    (ROOT / "tests" / "reports" / ".last-verified").write_text(head + "\n", encoding="utf-8")
    print(f"[verify] .last-verified <- {head[:12]}")

    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=True)

    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45)

    def run(cmd: str, check: bool = True, timeout: int = 600) -> str:
        print(f"$ {cmd[:180]}")
        _i, o, e = ssh.exec_command(cmd, timeout=timeout)
        out = o.read().decode("utf-8", "replace")
        err = e.read().decode("utf-8", "replace")
        code = o.channel.recv_exit_status()
        if out.strip():
            print(out.rstrip())
        if err.strip():
            print(err.rstrip(), file=sys.stderr)
        if check and code != 0:
            raise SystemExit(f"remote exit {code}: {cmd}")
        return out

    snap = f"/root/snapshots/asgard-crm-pre-vacation-d-{STAMP}.tgz"
    run(f"mkdir -p /root/snapshots && tar -czf {snap} -C {REMOTE} {' '.join(FILES)}")
    print(f"[snap] {snap}")

    with tempfile.NamedTemporaryFile(suffix=".tgz", delete=False) as tmp:
        tar_path = Path(tmp.name)
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            tar.add(ROOT / rel, arcname=rel)

    sftp = ssh.open_sftp()
    remote_tar = f"/tmp/asgard-vacation-d-{STAMP}.tgz"
    sftp.put(str(tar_path), remote_tar)
    tar_path.unlink(missing_ok=True)
    run(f"tar -xzf {remote_tar} -C {REMOTE} && rm -f {remote_tar}")
    # Только статика — restart не обязателен, но сбрасывает in-memory если что.
    run("systemctl restart asgard-crm && sleep 5 && systemctl is-active asgard-crm")

    ok = True
    for rel in FILES:
        with sftp.open(f"{REMOTE}/{rel}", "rb") as f:
            same = norm(f.read()) == norm((ROOT / rel).read_bytes())
        ok = ok and same
        print(("SAME  " if same else "DIFF  ") + rel)
    sftp.close()

    run(f"grep -c 'periodsOf(S.myEmployeeId)' {REMOTE}/public/assets/js/vacation_schedule.js")
    run(f"grep -c 'D && D.meId' {REMOTE}/public/assets/js/vacation_schedule.js || true")
    run(f"grep -o \"SHELL_VERSION = '[^']*'\" {REMOTE}/public/sw.js | head -1")
    run("curl -s -o /dev/null -w 'health=%{http_code}\\n' http://127.0.0.1:3000/api/health")
    ssh.close()
    if not ok:
        raise SystemExit("MD5 mismatch after deploy")
    print(f"OK deploy vacation D-fix {VER}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
