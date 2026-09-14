#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy refresh coverage + UI runes + V329 + rebuild /m."""
import io
import subprocess
import sys
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
ROOT = Path(__file__).resolve().parents[1]
PROJECT = "/var/www/asgard-crm"
VERSION = "20.27.100"

BACKEND = [
    "src/services/seasonalChecker.js",
    "src/routes/field-seasonal.js",
    "migrations/V329__autumn_quest_progress_backfill.sql",
]


def main():
    # bump version
    for rel in ("public/sw.js", "public/index.html"):
        p = ROOT / rel
        txt = p.read_text(encoding="utf-8")
        for old in ("20.27.99", "20.27.98"):
            txt = txt.replace(old, VERSION)
        p.write_text(txt, encoding="utf-8")

    print("=== BUILD mobile ===")
    r = subprocess.run(
        ["npm", "run", "build"],
        cwd=str(ROOT / "public" / "mobile-app"),
        capture_output=True,
        text=True,
        shell=True,
    )
    print((r.stdout or "")[-1500:])
    if r.returncode != 0:
        print((r.stderr or "")[-3000:])
        raise SystemExit("build failed")

    subprocess.run(
        [
            "robocopy",
            str(ROOT / "public" / "mobile-app" / "dist"),
            str(ROOT / "public" / "m"),
            "/MIR",
            "/NFL",
            "/NDL",
            "/NJH",
            "/NJS",
            "/nc",
            "/ns",
            "/np",
        ],
        shell=True,
    )

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    def run(cmd, timeout=300):
        print("====", cmd[:200])
        _, o, e = c.exec_command(cmd, timeout=timeout)
        out = o.read().decode("utf-8", "replace")
        err = e.read().decode("utf-8", "replace")
        if out.strip():
            print(out[-5000:] if len(out) > 5000 else out)
        if err.strip():
            print("STDERR:", err[:2000])
        return out

    run(
        f"mkdir -p /root/snapshots && tar czf /root/snapshots/asgard-crm-pre-{VERSION}-$(date +%Y%m%d-%H%M%S).tar.gz "
        f"-C {PROJECT} src/services/seasonalChecker.js src/routes/field-seasonal.js public/m public/sw.js public/index.html || true"
    )

    for rel in BACKEND + ["public/sw.js", "public/index.html"]:
        print("PUT", rel)
        sftp.put(str(ROOT / rel), f"{PROJECT}/{rel}")

    # tar mobile
    import tarfile
    import tempfile

    tar_path = Path(tempfile.gettempdir()) / f"m_{VERSION}.tar"
    with tarfile.open(tar_path, "w") as tar:
        mdir = ROOT / "public" / "m"
        for f in mdir.rglob("*"):
            if f.is_file():
                tar.add(f, arcname=str(f.relative_to(mdir.parent)))
    remote_tar = f"/tmp/m_{VERSION}.tar"
    print("PUT mobile tar")
    sftp.put(str(tar_path), remote_tar)
    run(f"tar xf {remote_tar} -C {PROJECT}/public && ls -lt {PROJECT}/public/m/assets/*.js | head -5")

    run(f"sudo -u postgres psql -d asgard_crm -v ON_ERROR_STOP=1 -f {PROJECT}/migrations/V329__autumn_quest_progress_backfill.sql")
    run("systemctl restart asgard-crm")
    run("sleep 2; systemctl is-active asgard-crm")

    sftp.close()
    c.close()
    print("DEPLOYED", VERSION)


if __name__ == "__main__":
    main()
