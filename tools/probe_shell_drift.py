#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Compare prod vs local for shell + ting name files; list asset ?v= refs."""
from __future__ import annotations

import difflib
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import paramiko

SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"

FILES = [
    "src/routes/thing.js",
    "public/assets/js/huginn_ting.js",
    "public/assets/js/ting_page.js",
    "public/assets/js/ting_session.js",
    "public/assets/js/phone_ui.js",
    "public/assets/css/huginn_dock.css",
    "public/assets/css/ting.css",
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
    raise SystemExit("cannot load SSH key")


def main() -> int:
    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45)
    sftp = ssh.open_sftp()

    def remote_text(rel: str) -> str:
        with sftp.open(f"{REMOTE}/{rel}", "r") as f:
            return f.read().decode("utf-8", "replace")

    print("=== file mtimes / sizes (prod) ===")
    for rel in FILES + ["public/index.html", "public/sw.js"]:
        try:
            st = sftp.stat(f"{REMOTE}/{rel}")
            import datetime as dt
            print(
                f"{rel}: {st.st_size:>8}  {dt.datetime.fromtimestamp(st.st_mtime):%Y-%m-%d %H:%M:%S}"
            )
        except Exception as exc:
            print(f"{rel}: ERR {exc}")

    print("\n=== diffs (local → prod) ===")
    for rel in FILES:
        local = (ROOT / rel)
        if not local.is_file():
            print(f"\n--- {rel}: local missing ---")
            continue
        l = local.read_text(encoding="utf-8").splitlines()
        try:
            r = remote_text(rel).splitlines()
        except Exception as exc:
            print(f"\n--- {rel}: remote ERR {exc} ---")
            continue
        if l == r:
            print(f"\n--- {rel}: IDENTICAL ---")
            continue
        diff = list(difflib.unified_diff(r, l, fromfile="prod", tofile="local", lineterm="", n=1))
        print(f"\n--- {rel}: {len([d for d in diff if d[:1] in '+-' and d[:3] not in ('+++','---')])} changed lines ---")
        for line in diff[:120]:
            print(line)

    print("\n=== index ?v= refs ===")
    _i, o, _e = ssh.exec_command(
        f"grep -oE 'assets/(js|css)/[a-zA-Z0-9_.-]+\\?v=[0-9.]+' {REMOTE}/public/index.html | sort -u | head -40",
        timeout=60,
    )
    print(o.read().decode("utf-8", "replace").rstrip() or "(none)")
    _i, o, _e = ssh.exec_command(
        f"grep -oE '\\?v=[0-9.]+' {REMOTE}/public/index.html | sort -u",
        timeout=60,
    )
    print("[prod ?v= values]", o.read().decode("utf-8", "replace").split())
    _i, o, _e = ssh.exec_command(
        "grep -oE '\\?v=[0-9.]+' public/index.html | sort -u",
        timeout=60,
    )
    print("[local ?v= values]", o.read().decode("utf-8", "replace").split())
    sftp.close()
    ssh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
