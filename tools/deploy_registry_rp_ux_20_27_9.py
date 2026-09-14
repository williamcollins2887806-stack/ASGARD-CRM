#!/usr/bin/env python3
"""Deploy registry TO / RP UX package (shell 20.27.9). Snapshot + scp, no git reset."""
import hashlib
import io
import os
import sys
from datetime import datetime
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
PROJECT = "/var/www/asgard-crm"
ROOT = Path(__file__).resolve().parents[1]
TAG = datetime.now().strftime("%Y%m%d-%H%M%S")
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-registry-rp-ux-{TAG}"

FILES = [
    "src/routes/pm-duty.js",
    "src/routes/tenders-registry.js",
    "public/assets/js/registry_api.js",
    "public/assets/js/registry_tab.js",
    "public/assets/js/rp_review_modal.js",
    "public/assets/css/app.css",
    "public/sw.js",
    "public/index.html",
]

MARKERS = [
    ("src/routes/pm-duty.js", "notArchivedStatuses"),
    ("src/routes/tenders-registry.js", "find-duplicates"),
    ("src/routes/tenders-registry.js", "thread_last_question_preview"),
    ("public/assets/js/registry_tab.js", "colFilters"),
    ("public/assets/js/registry_tab.js", "reg-rp-decision"),
    ("public/assets/js/registry_tab.js", "reg-thread-q-btn"),
    ("public/assets/js/registry_api.js", "findRegistryDuplicates"),
    ("public/assets/js/rp_review_modal.js", "Файлы к анализу"),
    ("public/assets/js/rp_review_modal.js", "Внёс"),
    ("public/assets/css/app.css", "reg-comment-full"),
    ("public/sw.js", "20.27.9"),
    ("public/index.html", "20.27.9"),
]


def md5_file(path: Path) -> str:
    h = hashlib.md5()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def run(c, cmd, timeout=180):
    print("====", cmd[:180].replace("\n", " "))
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    if out:
        print(out[-20000:] if len(out) > 20000 else out)
    if err.strip():
        print("STDERR:", err[:3000])
    return out, err


def ensure_dir(sftp, remote_dir):
    parts = remote_dir.strip("/").split("/")
    cur = ""
    for p in parts:
        cur += "/" + p
        try:
            sftp.stat(cur)
        except OSError:
            sftp.mkdir(cur)


def main():
    for rel in FILES:
        local = ROOT / rel
        if not local.exists():
            raise SystemExit(f"missing local file: {rel}")

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    print("=== Snapshot ===")
    run(
        c,
        f"mkdir -p /root/snapshots && "
        f"tar -C {PROJECT} -czf {SNAP}.tgz "
        + " ".join(f.replace(os.sep, "/") for f in FILES)
        + f" && ls -lh {SNAP}.tgz",
        timeout=120,
    )

    print("\n=== Upload ===")
    local_md5 = {}
    for rel in FILES:
        local = ROOT / rel
        remote = f"{PROJECT}/{rel.replace(os.sep, '/')}"
        ensure_dir(sftp, os.path.dirname(remote))
        digest = md5_file(local)
        local_md5[rel] = digest
        sftp.put(str(local), remote)
        print(f"  ok {rel}  md5={digest}")

    print("\n=== MD5 verify ===")
    ok = True
    for rel, expected in local_md5.items():
        remote = f"{PROJECT}/{rel.replace(os.sep, '/')}"
        with sftp.file(remote, "rb") as rf:
            remote_md5 = hashlib.md5(rf.read()).hexdigest()
        match = remote_md5 == expected
        print(f"  {'OK' if match else 'FAIL'} {rel} local={expected} remote={remote_md5}")
        if not match:
            ok = False
    if not ok:
        raise SystemExit("MD5 mismatch — abort restart")

    print("\n=== Markers ===")
    for rel, needle in MARKERS:
        remote = f"{PROJECT}/{rel.replace(os.sep, '/')}"
        out, _ = run(c, f"grep -F -c {repr(needle)} {remote} || true", timeout=20)
        count = (out or "").strip().splitlines()[-1] if out else "0"
        print(f"  {rel}: '{needle}' -> {count}")

    print("\n=== Restart ===")
    run(c, "systemctl restart asgard-crm && sleep 4 && systemctl is-active asgard-crm", timeout=90)

    print("\n=== app_updates banner ===")
    sql = (
        "INSERT INTO app_updates (version, changes, created_at) VALUES ("
        "'v20.27.9', "
        "'Реестр ТО / анализ РП: отмена уходит из очередей РП; обязательный срок + правка в таблице; "
        "комментарии целиком; контраст статусов light; колоночные фильтры; черновик+Подаём/Не подаём; "
        "кто внёс в анализе; смета/отчёт на анализе; антидубль; значок вопроса РП', "
        "NOW());"
    )
    run(
        c,
        "sudo -u postgres psql -d asgard_crm -v ON_ERROR_STOP=1 -c "
        + repr(sql),
        timeout=30,
    )

    print("\n=== Live checks ===")
    run(c, "curl -sS http://127.0.0.1:3000/api/version || curl -sS http://127.0.0.1:3100/api/version || true", timeout=20)
    run(c, "journalctl -u asgard-crm -n 30 --no-pager", timeout=20)
    run(c, f"grep -o \"SHELL_VERSION = '[^']*'\" {PROJECT}/public/sw.js")
    run(c, f"grep -o \"ASGARD_SHELL_VERSION = '[^']*'\" {PROJECT}/public/index.html")

    sftp.close()
    c.close()
    print(f"\nDONE. Snapshot: {SNAP}.tgz")


if __name__ == "__main__":
    main()
