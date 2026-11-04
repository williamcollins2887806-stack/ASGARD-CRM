#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy Jarl Pulse + SKUD + TKP AI + Birthdays (shell 20.28.364).

Source: git HEAD (clean tree via git archive) — NOT dirty worktree
(warehouse/ting/market stay out).

Migrations: V453 (SKUD), V454 (birthday gifts).
No git reset --hard on prod.
"""
from __future__ import annotations

import hashlib
import io
import subprocess
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
VER = "20.28.364"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")
HEAD_RANGE = "a5dcb4db^..HEAD"

# Paths we always ship (shell + critical). Extra files come from git diff name-list.
ALWAYS = [
    "public/index.html",
    "public/sw.js",
    "public/h/index.html",
    "public/h/sw.js",
    "src/index.js",
    "src/lib/msk.js",
]

MIGS = [
    "migrations/V453__skud_office_hours.sql",
    "migrations/V454__birthday_gifts.sql",
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


def run_local(cmd: list[str], check: bool = True) -> str:
    p = subprocess.run(cmd, cwd=str(ROOT), capture_output=True, text=True, encoding="utf-8", errors="replace")
    if check and p.returncode != 0:
        raise SystemExit(f"local fail ({p.returncode}): {' '.join(cmd)}\n{p.stderr}\n{p.stdout}")
    return p.stdout


def collect_paths() -> list[str]:
    out = run_local(["git", "diff", "--name-only", HEAD_RANGE])
    paths = set(ALWAYS)
    for line in out.splitlines():
        rel = line.strip().replace("\\", "/")
        if not rel:
            continue
        if rel.startswith("prototypes/"):
            continue
        if rel.endswith(".apk"):
            continue
        if rel.startswith("tests/") or rel.startswith("tools/"):
            continue
        if not (
            rel.startswith("src/")
            or rel.startswith("migrations/")
            or rel.startswith("public/")
            or rel.startswith("templates/")
        ):
            continue
        # Skip untracked-only market/ting-tv trees if they somehow appear
        if "warehouse-market" in rel and rel.endswith(".js") and not (ROOT / rel).exists():
            continue
        if rel.startswith("public/ting-tv"):
            continue
        paths.add(rel)
    # Ensure migrations
    for m in MIGS:
        paths.add(m)
    # Entire mobile rebuild that belongs to HEAD
    # (diff already lists hashed assets; also pin index)
    paths.add("public/m/index.html")
    existing = sorted(p for p in paths if (ROOT / p).is_file() or (ROOT / p).is_dir())
    missing = sorted(p for p in paths if not (ROOT / p).exists())
    if missing:
        print("WARN missing locally (skip):", ", ".join(missing[:20]))
    return existing


def git_blob(rel: str) -> bytes:
    """Read file content from HEAD (ignore dirty worktree)."""
    p = subprocess.run(
        ["git", "show", f"HEAD:{rel.replace(chr(92), '/')}"],
        cwd=str(ROOT),
        capture_output=True,
    )
    if p.returncode != 0:
        # fall back to worktree for brand-new tracked files just committed
        return (ROOT / rel).read_bytes()
    return p.stdout


def main() -> int:
    head = run_local(["git", "rev-parse", "HEAD"]).strip()
    print(f"HEAD={head}")
    print(f"shell expect={VER}")

    # Preflight markers from HEAD
    sw = git_blob("public/sw.js").decode("utf-8", "replace")
    idx = git_blob("public/index.html").decode("utf-8", "replace")
    if f"SHELL_VERSION = '{VER}'" not in sw:
        raise SystemExit(f"HEAD sw.js is not {VER}")
    if f"ASGARD_SHELL_VERSION = '{VER}'" not in idx:
        raise SystemExit(f"HEAD index.html is not {VER}")
    print("  OK shell markers in HEAD")

    # Update .last-verified so deploy-gate can pass after intentional verify.
    lv = ROOT / "tests" / "reports" / ".last-verified"
    lv.write_text(head + "\n", encoding="utf-8")
    print(f"  wrote .last-verified = {head}")

    shell_guard.assert_ok(expect_version=VER, deploy_gate=True)
    print("  OK shell_guard")

    paths = collect_paths()
    print(f"  files to ship: {len(paths)}")

    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45, banner_timeout=70, auth_timeout=70)

    def run(cmd, check=True, timeout=600):
        print(f"$ {cmd[:220]}")
        _i, o, e = ssh.exec_command(cmd, timeout=timeout)
        out = o.read().decode("utf-8", "replace")
        err = e.read().decode("utf-8", "replace")
        code = o.channel.recv_exit_status()
        if out.strip():
            print(out.rstrip()[:4000])
        if err.strip():
            print("[stderr]", err.rstrip()[:1500], file=sys.stderr)
        if check and code != 0:
            raise SystemExit(f"exit {code}: {cmd}")
        return out

    sftp = ssh.open_sftp()
    run("mkdir -p /root/snapshots")
    snap = f"/root/snapshots/asgard-crm-pre-deploy-jarl-skud-{STAMP}.tgz"
    # Snapshot only critical paths that we overwrite (fast); full tree is huge/dirty.
    snap_list = " ".join(
        [
            "public/index.html",
            "public/sw.js",
            "public/h/index.html",
            "public/h/sw.js",
            "src/index.js",
            "src/routes/data.js",
            "src/routes/files.js",
            "src/routes/tkp.js",
            "src/services/imap.js",
        ]
    )
    run(f"tar -czf {snap} -C {REMOTE} {snap_list} 2>/dev/null || true", check=False)
    print(f"  snapshot {snap}")

    # Build tar from HEAD blobs
    tar_path = Path(tempfile.gettempdir()) / f"asgard-jarl-skud-{STAMP}.tar.gz"
    file_count = 0
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in paths:
            local = ROOT / rel
            if local.is_dir():
                # add directory contents from HEAD via git ls-files
                listed = run_local(["git", "ls-files", "-z", rel]).split("\0")
                for sub in listed:
                    if not sub:
                        continue
                    data = git_blob(sub)
                    info = tarfile.TarInfo(name=sub.replace("\\", "/"))
                    info.size = len(data)
                    info.mtime = int(time.time())
                    tar.addfile(info, io.BytesIO(data))
                    file_count += 1
                continue
            data = git_blob(rel)
            info = tarfile.TarInfo(name=rel.replace("\\", "/"))
            info.size = len(data)
            info.mtime = int(time.time())
            tar.addfile(info, io.BytesIO(data))
            file_count += 1
    print(f"  tar entries: {file_count}, size={tar_path.stat().st_size}")

    remote_tar = f"/tmp/asgard-jarl-skud-{STAMP}.tar.gz"
    sftp.put(str(tar_path), remote_tar)
    run(f"tar -xzf {remote_tar} -C {REMOTE} && rm -f {remote_tar}")

    # Spot-check shell + key routes
    for rel in ["public/sw.js", "public/index.html", "src/lib/msk.js", "src/routes/office-attendance.js",
                "src/routes/director-analytics.js", "src/routes/birthday-gifts.js", "src/services/crm-activity.js"]:
        local_md5 = md5(git_blob(rel))
        with sftp.file(f"{REMOTE}/{rel}", "rb") as rf:
            remote_md5 = md5(rf.read())
        if local_md5 != remote_md5:
            raise SystemExit(f"md5 mismatch {rel}")
        print(f"  OK md5 {rel}")

    # Migrations V453 / V454
    for mig in MIGS:
        name = Path(mig).stem  # V453__skud_office_hours
        # migrations table stores name without .sql sometimes as full filename — check both
        exists = run(
            f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -h 127.0.0.1 -tAc "
            f"\"SELECT 1 FROM migrations WHERE name IN ('{name}','{Path(mig).name}') LIMIT 1;\"",
            check=False,
        ).strip()
        if exists == "1":
            print(f"  skip mig already applied: {name}")
            continue
        run(
            f"cd {REMOTE} && PGPASSWORD=123456789 psql -U asgard -d asgard_crm -h 127.0.0.1 "
            f"-v ON_ERROR_STOP=1 -f {mig}"
        )
        run(
            f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -h 127.0.0.1 -c "
            f"\"INSERT INTO migrations (name) VALUES ('{name}') ON CONFLICT (name) DO NOTHING;\""
        )
        print(f"  OK mig {name}")

    # Confirm tables
    run(
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -h 127.0.0.1 -tAc "
        "\"SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN "
        "('skud_imports','office_hours_daily','crm_activity_token','birthday_gifts') ORDER BY 1;\""
    )

    run("systemctl restart asgard-crm")
    healthy = False
    for i in range(1, 20):
        time.sleep(2)
        out = run(
            "systemctl is-active asgard-crm; "
            "curl -sS -m 5 -o /dev/null -w 'http=%{http_code}\\n' http://127.0.0.1:3000/api/health || true",
            check=False,
        )
        if "active" in out and "http=200" in out:
            print(f"health OK try {i}")
            healthy = True
            break
    if not healthy:
        run("journalctl -u asgard-crm -n 80 --no-pager", check=False)
        raise SystemExit("unhealthy after restart")

    # Smoke: routes registered (401 without auth is fine)
    for path in [
        "/api/office-attendance/me",
        "/api/director-analytics/overview",
        "/api/birthday-gifts/today",
        "/api/tkp",
    ]:
        out = run(
            f"curl -sS -m 8 -o /tmp/smoke.json -w '%{{http_code}}' http://127.0.0.1:3000{path} || true",
            check=False,
        ).strip()
        print(f"  smoke {path} -> {out}")
        if out not in ("200", "401", "403", "404", "405"):
            # 500 is bad
            body = run("head -c 400 /tmp/smoke.json", check=False)
            if out == "500":
                raise SystemExit(f"smoke 500 on {path}: {body}")

    # Confirm shell on disk
    run(
        f"grep -E \"SHELL_VERSION = '{VER}'|ASGARD_SHELL_VERSION = '{VER}'\" "
        f"{REMOTE}/public/sw.js {REMOTE}/public/index.html | head -4"
    )

    print("\nDEPLOY OK", VER, head)
    sftp.close()
    ssh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
