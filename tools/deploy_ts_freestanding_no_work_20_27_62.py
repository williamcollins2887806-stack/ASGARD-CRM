#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy: freestanding timesheet stages must not keep work_id (shell 20.27.62)."""
import hashlib
import io
import sys
import tarfile
import tempfile
from datetime import datetime
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
PROJECT = "/var/www/asgard-crm"
ROOT = Path(__file__).resolve().parents[1]
VER = "20.27.63"
TAG = datetime.now().strftime("%Y%m%d-%H%M%S")
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-ts-free-stages-{TAG}"

FILES = [
    "src/routes/timesheet-v2.js",
    "src/routes/field-stages.js",
    "src/routes/field-logistics.js",
    "src/routes/global-timesheet.js",
    "public/assets/js/timesheet-v2.js",
    "public/desktop-v2-src/src/pages/Timesheet/TimesheetGrid.jsx",
    "public/desktop-v2-src/src/pages/Timesheet/api.js",
    "public/desktop-v2-src/src/pages/Timesheet/AddWorkerModal.jsx",
    "public/mobile-app/src/pages/timesheet/TimesheetMobile.jsx",
    "public/index.html",
    "public/sw.js",
]


def bump_shell():
    sw = ROOT / "public/sw.js"
    t = sw.read_text(encoding="utf-8")
    old = None
    for cand in ("20.27.62", "20.27.61", "20.27.60", "20.27.59", "20.27.55"):
        needle = f"const SHELL_VERSION = '{cand}'"
        if needle in t:
            sw.write_text(t.replace(needle, f"const SHELL_VERSION = '{VER}'"), encoding="utf-8")
            old = cand
            print(f"sw.js {cand} -> {VER}")
            break
    if not old:
        raise SystemExit("sw.js version not found")

    idx = ROOT / "public/index.html"
    t = idx.read_text(encoding="utf-8")
    t = t.replace(f"window.ASGARD_SHELL_VERSION = '{old}'", f"window.ASGARD_SHELL_VERSION = '{VER}'")
    t = t.replace(f"assets/js/timesheet-v2.js?v={old}", f"assets/js/timesheet-v2.js?v={VER}")
    # also replace any leftover 20.27.61 if bump ran mid-way
    t = t.replace("window.ASGARD_SHELL_VERSION = '20.27.61'", f"window.ASGARD_SHELL_VERSION = '{VER}'")
    t = t.replace("assets/js/timesheet-v2.js?v=20.27.61", f"assets/js/timesheet-v2.js?v={VER}")
    t = t.replace("window.ASGARD_SHELL_VERSION = '20.27.62'", f"window.ASGARD_SHELL_VERSION = '{VER}'")
    t = t.replace("assets/js/timesheet-v2.js?v=20.27.62", f"assets/js/timesheet-v2.js?v={VER}")
    if f"ASGARD_SHELL_VERSION = '{VER}'" not in t:
        raise SystemExit("ASGARD_SHELL_VERSION not bumped")
    if f"timesheet-v2.js?v={VER}" not in t:
        raise SystemExit("timesheet-v2.js version not bumped")
    idx.write_text(t, encoding="utf-8")
    print(f"index.html ASGARD + timesheet-v2.js -> {VER}")


def md5_file(path: Path) -> str:
    h = hashlib.md5()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def run(c, cmd, timeout=180):
    print("====", cmd[:220].replace("\n", " "))
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out:
        print(out[-8000:] if len(out) > 8000 else out)
    if err.strip():
        print("STDERR:", err[:2000])
    if code != 0:
        raise SystemExit(f"FAILED ({code}): {cmd[:140]}")
    return out


def main():
    bump_shell()
    missing = [f for f in FILES if not (ROOT / f).exists()]
    if missing:
        raise SystemExit(f"missing files: {missing}")

    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c.connect(HOST, username="root", pkey=key, timeout=30)
    c.get_transport().set_keepalive(15)

    run(c, f"mkdir -p /root/snapshots && cp -a {PROJECT} {SNAP}")
    print("snapshot:", SNAP)

    with tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False) as tmp:
        tar_path = Path(tmp.name)
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            tar.add(ROOT / rel, arcname=rel)

    sftp = c.open_sftp()
    remote_tar = f"/tmp/asgard-ts-free-stages-{TAG}.tar.gz"
    sftp.put(str(tar_path), remote_tar)
    sftp.close()
    tar_path.unlink(missing_ok=True)

    run(c, f"tar -xzf {remote_tar} -C {PROJECT}")
    run(c, f"systemctl restart asgard-crm && sleep 2 && systemctl is-active asgard-crm")

    for rel in FILES:
        local_md5 = md5_file(ROOT / rel)
        remote = run(c, f"md5sum {PROJECT}/{rel}").split()[0]
        print(f"md5 {rel}: local={local_md5} remote={remote} {'OK' if local_md5 == remote else 'MISMATCH'}")
        if local_md5 != remote:
            raise SystemExit(f"md5 mismatch: {rel}")

    run(c, f"rm -f {remote_tar}")
    print("DONE", VER)
    c.close()


if __name__ == "__main__":
    main()
