#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy: батч фиксов по прод-логам (shell 20.28.332).

Desktop: correspondence resolveItem, AsgardUI guards, vendor sourceMappingURL,
doc-registry Word log, FolderSorter completeFast, PreTender cell.value,
DaData query cap, Mango RecordingFetcher backoff, IMAP peer-drop, crm-mailer retry.

Field/mobile: Max channels UX, thing egress/pipeline logs, field-manage mail log.
Плюс public/m пересборка FieldLogin.

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
VER = "20.28.332"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

TAR_PATHS = [
    "src/routes/customers.js",
    "src/routes/doc-registry.js",
    "src/routes/field-auth.js",
    "src/routes/field-manage.js",
    "src/routes/thing.js",
    "src/services/crm-mailer.js",
    "src/services/dadata.js",
    "src/services/email-folder-sorter.js",
    "src/services/imap.js",
    "src/services/pre-tender-service.js",
    "src/services/recording-fetcher.js",
    "src/services/thing-pipeline.js",
    "public/assets/js/alerts.js",
    "public/assets/js/confirm.js",
    "public/assets/js/correspondence.js",
    "public/assets/js/loss_reason_modal.js",
    "public/assets/js/rp_review_modal.js",
    "public/assets/js/templates.js",
    "public/assets/vendor/leaflet.js",
    "public/assets/vendor/leaflet.markercluster.js",
    "public/assets/vendor/pixi.min.js",
    "public/assets/vendor/xlsx.bundle.js",
    "public/index.html",
    "public/sw.js",
    "public/h/index.html",
    "public/h/sw.js",
]

TAR_DIRS = [
    "public/m",
]

MARKERS = [
    ("src/services/email-folder-sorter.js", "completeFast", "FolderSorter completeFast"),
    ("src/services/recording-fetcher.js", "_isRateLimited", "Mango rate-limit backoff"),
    ("src/services/thing-pipeline.js", "[thing-pipeline] job failed", "thing-pipeline pino obj"),
    ("src/routes/field-auth.js", "unavailable", "field Max channels"),
    ("public/assets/js/correspondence.js", "Нельзя читать `items` из render()", "correspondence resolveItem"),
    ("public/assets/js/confirm.js", "AsgardUI missing — stub", "AsgardUI guard"),
    ("public/sw.js", f"SHELL_VERSION = '{VER}'", f"shell {VER}"),
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
    snap = f"/root/snapshots/asgard-prod-log-batch-{STAMP}.tgz"
    run("mkdir -p /root/snapshots")
    # Файлы + каталог public/m (без node_modules — его нет)
    snap_list = " ".join(TAR_PATHS + TAR_DIRS)
    run(f"tar -czf {snap} -C {REMOTE} {snap_list} 2>/dev/null || true", check=False)
    run(f"ls -lh {snap}", check=False)
    print(f"snapshot: {snap}")

    print("=== 2. tar + scp ===")
    tar_path = Path(tempfile.gettempdir()) / f"asgard-prod-log-batch-{STAMP}.tar.gz"
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in TAR_PATHS:
            add_path(tar, rel)
        for rel in TAR_DIRS:
            add_path(tar, rel)
    remote_tar = f"/tmp/asgard-prod-log-batch-{STAMP}.tar.gz"
    print(f"local tar: {tar_path} ({tar_path.stat().st_size // 1024} KB)")
    sftp.put(str(tar_path), remote_tar)
    run(f"ls -lh {remote_tar}")
    # public/m целиком заменяем: сначала снять старые hashed assets, потом распаковать
    run(f"rm -rf {REMOTE}/public/m/assets && mkdir -p {REMOTE}/public/m/assets")
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

    # FieldLogin marker in mobile bundle
    run(
        f"grep -l 'не привязан к MAX\\|codeChannels' {REMOTE}/public/m/assets/FieldLogin-*.js "
        f"| head -3",
        check=False,
    )
    run(f"test -f {REMOTE}/public/m/index.html && grep -o 'index-[^\"]*\\.js' {REMOTE}/public/m/index.html | head -3")

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
    run(f"grep -n \"completeFast\" {REMOTE}/src/services/email-folder-sorter.js | head -3")
    run(f"grep -n \"_isRateLimited\" {REMOTE}/src/services/recording-fetcher.js | head -3")
    run(f"grep -n \"unavailable\" {REMOTE}/src/routes/field-auth.js | head -5")
    run(
        f"grep -n \"SHELL_VERSION = '{VER}'\\|ASGARD_SHELL_VERSION = '{VER}'\" "
        f"{REMOTE}/public/sw.js {REMOTE}/public/index.html | head -5"
    )

    print(f"\nDONE deploy prod-log-batch {VER}  snap={snap}")
    sftp.close()
    ssh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
