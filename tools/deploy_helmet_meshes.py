#!/usr/bin/env python3
"""Deploy helmet mesh props (A/B/C) + rebuilt /m to prod."""
import io
import os
import sys
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
PROJECT = "/var/www/asgard-crm"
ROOT = Path(__file__).resolve().parents[1]


def ensure_remote_dir(sftp, remote_dir: str):
    parts = remote_dir.strip("/").split("/")
    cur = ""
    for p in parts:
        cur += "/" + p
        try:
            sftp.stat(cur)
        except FileNotFoundError:
            sftp.mkdir(cur)


def upload_file(sftp, local: Path, remote: str):
    ensure_remote_dir(sftp, str(Path(remote).parent).replace("\\", "/"))
    sftp.put(str(local), remote)
    print(f"  OK {remote}")


def upload_dir(sftp, local_dir: Path, remote_dir: str):
    ensure_remote_dir(sftp, remote_dir)
    for entry in os.listdir(local_dir):
        lp = local_dir / entry
        rp = f"{remote_dir}/{entry}"
        if lp.is_dir():
            upload_dir(sftp, lp, rp)
        else:
            sftp.put(str(lp), rp)
            print(f"  OK {rp}")


def main():
    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    print("=== Helmets ===")
    upload_dir(
        sftp,
        ROOT / "public" / "m" / "assets" / "avatars" / "helmets",
        f"{PROJECT}/public/m/assets/avatars/helmets",
    )
    upload_file(
        sftp,
        ROOT / "public" / "m" / "assets" / "avatars" / "LICENSE.txt",
        f"{PROJECT}/public/m/assets/avatars/LICENSE.txt",
    )

    print("=== Mobile /m shell (index + new hashed assets) ===")
    upload_file(sftp, ROOT / "public" / "m" / "index.html", f"{PROJECT}/public/m/index.html")
    # Upload only newly built hashed files + css referenced by index
    index = (ROOT / "public" / "m" / "index.html").read_text(encoding="utf-8")
    import re

    refs = re.findall(r"/m/assets/([A-Za-z0-9_.-]+)", index)
    for name in sorted(set(refs)):
        local = ROOT / "public" / "m" / "assets" / name
        if local.is_file():
            upload_file(sftp, local, f"{PROJECT}/public/m/assets/{name}")

    # Also upload three/gltf chunks if present with new hashes from this build
    for name in [
        "GLTFLoader-DjyGmsym.js",
        "three.module-PNA_33cr.js",
        "jsx-runtime-BnxRlLMJ.js",
        "dist-SQlye9nc.js",
    ]:
        local = ROOT / "public" / "m" / "assets" / name
        if local.is_file():
            upload_file(sftp, local, f"{PROJECT}/public/m/assets/{name}")

    sftp.close()
    c.close()
    print("DONE — no backend restart needed (static /m only)")


if __name__ == "__main__":
    main()
