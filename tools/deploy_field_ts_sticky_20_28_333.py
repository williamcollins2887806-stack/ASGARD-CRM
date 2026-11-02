#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy: sticky шапка/ФИО в полевом табеле (shell 20.28.333).

Vanilla field-tab.js + shell bump + v2 FieldTab билд.

Порядок: shell_guard(deploy-gate) → snapshot → tar+scp → restart → health → markers.
Откат: tar -xzf <snap> -C /var/www/asgard-crm && systemctl restart asgard-crm
"""
from __future__ import annotations

import hashlib
import sys
import tarfile
import tempfile
import time
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import paramiko  # noqa: E402
import shell_guard  # noqa: E402

SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
VER = "20.28.333"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

TAR_PATHS = [
    "public/assets/js/field-tab.js",
    "public/index.html",
    "public/sw.js",
    "public/h/index.html",
    "public/h/sw.js",
]

TAR_DIRS = [
    "public/v2",
]

MARKERS = [
    ("public/assets/js/field-tab.js", "ft-ts-scroll", "vanilla sticky scroll wrap"),
    ("public/assets/js/field-tab.js", "ft-ts-col-fio", "vanilla sticky FIO col"),
    ("public/assets/js/field-tab.js", "border-collapse: separate", "vanilla separate borders"),
    ("public/sw.js", f"SHELL_VERSION = '{VER}'", f"shell {VER}"),
    ("public/index.html", f"ASGARD_SHELL_VERSION = '{VER}'", f"index shell {VER}"),
]


def load_pkey(path: str):
    for loader in (getattr(paramiko, "Ed25519Key", None), getattr(paramiko, "ECDSAKey", None), paramiko.RSAKey):
        if loader is None:
            continue
        try:
            return loader.from_private_key_file(path)
        except Exception:
            continue
    raise SystemExit(f"cannot load SSH key: {path}")


def md5(b: bytes) -> str:
    return hashlib.md5(b).hexdigest()


def add_path(tar: tarfile.TarFile, rel: str) -> None:
    p = ROOT / rel
    if p.is_dir():
        for f in p.rglob("*"):
            if f.is_file():
                tar.add(str(f), arcname=str(f.relative_to(ROOT)).replace("\\", "/"))
    elif p.is_file():
        tar.add(str(p), arcname=rel.replace("\\", "/"))
    else:
        raise SystemExit(f"missing: {rel}")


def main() -> int:
    for rel in TAR_PATHS:
        if not (ROOT / rel).is_file():
            raise SystemExit(f"missing: {rel}")
    for rel in TAR_DIRS:
        if not (ROOT / rel).is_dir():
            raise SystemExit(f"missing dir: {rel}")

    print("=== LOCAL MARKERS ===")
    for rel, needle, label in MARKERS:
        text = (ROOT / rel).read_text(encoding="utf-8", errors="replace")
        if needle not in text:
            raise SystemExit(f"локально нет маркера: {label}")
        print(f"  OK {label}")

    # v2 CSS marker (hashed filename)
    v2_css = list((ROOT / "public" / "v2" / "assets").glob("*.css"))
    if not any("ft-ts-scroll" in p.read_text(encoding="utf-8", errors="replace") for p in v2_css):
        raise SystemExit("локально нет маркера ft-ts-scroll в public/v2/assets/*.css")
    print("  OK v2 CSS ft-ts-scroll")

    print("=== SHELL GUARD ===")
    shell_guard.assert_ok(expect_version=VER, deploy_gate=True)

    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    for attempt in range(1, 6):
        try:
            ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45,
                        banner_timeout=70, auth_timeout=70)
            print(f"ssh: connected (attempt {attempt})")
            break
        except Exception as e:
            print(f"ssh: attempt {attempt} failed: {e}")
            if attempt == 5:
                raise SystemExit("ssh: cannot connect")
            time.sleep(4)

    def run(cmd, check=True, timeout=600):
        print(f"$ {cmd[:200]}")
        _i, o, e = ssh.exec_command(cmd, timeout=timeout)
        out = o.read().decode("utf-8", "replace")
        err = e.read().decode("utf-8", "replace")
        code = o.channel.recv_exit_status()
        if out.strip():
            print(out.rstrip()[:4000])
        if err.strip():
            print(err.rstrip()[:1500], file=sys.stderr)
        if check and code != 0:
            raise SystemExit(f"remote exit {code}: {cmd[:120]}")
        return out

    sftp = ssh.open_sftp()

    print("=== 1. SNAPSHOT ===")
    snap = f"/root/snapshots/asgard-field-ts-sticky-{STAMP}.tgz"
    run("mkdir -p /root/snapshots")
    snap_list = " ".join(TAR_PATHS + TAR_DIRS)
    run(f"tar -czf {snap} -C {REMOTE} {snap_list} 2>/dev/null || true", check=False)
    run(f"ls -lh {snap}", check=False)
    print(f"snapshot: {snap}")

    print("=== 2. tar + scp ===")
    tar_path = Path(tempfile.gettempdir()) / f"asgard-field-ts-sticky-{STAMP}.tar.gz"
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in TAR_PATHS:
            add_path(tar, rel)
        for rel in TAR_DIRS:
            add_path(tar, rel)
    remote_tar = f"/tmp/asgard-field-ts-sticky-{STAMP}.tar.gz"
    print(f"local tar: {tar_path} ({tar_path.stat().st_size // 1024} KB)")
    sftp.put(str(tar_path), remote_tar)
    run(f"ls -lh {remote_tar}")
    # v2 hashed assets: чистим старые, затем распаковываем
    run(f"rm -rf {REMOTE}/public/v2/assets && mkdir -p {REMOTE}/public/v2/assets")
    run(f"tar -xzf {remote_tar} -C {REMOTE} && rm -f {remote_tar}")

    print("=== 3. MD5 verify (key files) ===")
    for rel in TAR_PATHS:
        local_md5 = md5((ROOT / rel).read_bytes())
        with sftp.file(f"{REMOTE}/{rel}", "rb") as rf:
            remote_md5 = md5(rf.read())
        ok = local_md5 == remote_md5
        print(f"  {'OK  ' if ok else 'FAIL'} {rel}  {local_md5[:10]}")
        if not ok:
            raise SystemExit(f"md5 mismatch: {rel}")

    print("=== 4. RESTART + HEALTH ===")
    run("systemctl restart asgard-crm")
    healthy = False
    for i in range(1, 9):
        time.sleep(2)
        out = run(
            "systemctl is-active asgard-crm; "
            "curl -sS -o /dev/null -w 'http=%{http_code}\\n' http://127.0.0.1:3000/api/health || true",
            check=False,
        )
        if "active" in out and "http=200" in out:
            healthy = True
            print(f"health OK on try {i}")
            break
        print(f"health wait {i}: {out.strip()!r}")
    if not healthy:
        raise SystemExit("health failed after restart")

    print("=== 5. PROD MARKERS ===")
    run(f"grep -n \"ft-ts-scroll\\|ft-ts-col-fio\" {REMOTE}/public/assets/js/field-tab.js | head -8")
    run(
        f"grep -n \"SHELL_VERSION = '{VER}'\\|ASGARD_SHELL_VERSION = '{VER}'\" "
        f"{REMOTE}/public/sw.js {REMOTE}/public/index.html | head -5"
    )
    run(
        f"grep -l 'ft-ts-scroll' {REMOTE}/public/v2/assets/*.css | head -3",
        check=False,
    )

    print(f"\nDONE deploy field-ts-sticky {VER}  snap={snap}")
    sftp.close()
    ssh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
