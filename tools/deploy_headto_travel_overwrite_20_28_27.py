# -*- coding: utf-8 -*-
"""Deploy HEAD_TO travel overwrite + ship-over-plane (shell 20.28.27)."""
import hashlib
import io
import os
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
VER = "20.28.27"
TAG = datetime.now().strftime("%Y%m%d-%H%M%S")
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-headto-travel-{TAG}"

FILES = [
    "src/routes/timesheet-v2.js",
    "src/routes/global-timesheet.js",
    "src/lib/timesheet-locks.js",
    "public/assets/js/timesheet-v2.js",
    "public/index.html",
    "public/sw.js",
]

V2_SRC_FILES = [
    "public/desktop-v2-src/src/pages/Timesheet/CellEditor.jsx",
    "public/desktop-v2-src/src/pages/Timesheet/TimesheetGrid.jsx",
    "public/desktop-v2-src/src/pages/Timesheet/api.js",
    "public/desktop-v2-src/src/pages/Timesheet/index.jsx",
]

MARKERS = {
    "src/routes/timesheet-v2.js": [
        "modesOfRole",
        "typeAllowedForRole",
        "resolveWriteMode",
        "Замена типа на ту же дату",
    ],
    "public/assets/js/timesheet-v2.js": [
        "TRANSPORT_OVERWRITE_TYPES",
        "cellIsEditable",
        "SHELL" if False else "TRANSPORT_OVERWRITE_TYPES",
    ],
    "public/sw.js": [f"SHELL_VERSION = '{VER}'"],
    "public/index.html": [f"ASGARD_SHELL_VERSION = '{VER}'"],
}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()[:12]


def ensure_dir(sftp, remote_dir: str):
    parts = remote_dir.strip("/").split("/")
    cur = ""
    for p in parts:
        cur += "/" + p
        try:
            sftp.stat(cur)
        except OSError:
            sftp.mkdir(cur)


def upload_file(sftp, local: Path, remote: str):
    ensure_dir(sftp, str(Path(remote).parent).replace("\\", "/"))
    sftp.put(str(local), remote)
    print(f"  OK {remote} sha={sha256(local)}")


def ssh_out(client, cmd: str, timeout=180) -> str:
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    code = stdout.channel.recv_exit_status()
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    if code != 0:
        raise RuntimeError(f"cmd failed ({code}): {cmd}\n{err or out}")
    return out


def main():
    if not KEY.exists():
        print(f"ERROR: missing key {KEY}")
        sys.exit(1)

    for rel in FILES:
        local = ROOT / rel
        if not local.exists():
            print(f"ERROR: missing {rel}")
            sys.exit(1)
        markers = MARKERS.get(rel, [])
        text = local.read_text(encoding="utf-8", errors="replace")
        for m in markers:
            if m not in text:
                print(f"ERROR: marker missing in {rel}: {m}")
                sys.exit(1)

    v2_dir = ROOT / "public" / "v2"
    if not (v2_dir / "index.html").exists():
        print("ERROR: public/v2 missing — build v2 first")
        sys.exit(1)

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", key_filename=str(KEY), timeout=30)
    sftp = client.open_sftp()

    print("== snapshot ==")
    snap_cmd = (
        f"mkdir -p /root/snapshots && tar czf {SNAP}.tgz "
        f"-C {PROJECT} "
        f"src/routes/timesheet-v2.js src/routes/global-timesheet.js src/lib/timesheet-locks.js "
        f"public/assets/js/timesheet-v2.js public/sw.js public/index.html public/v2 "
        f"2>/dev/null || true; ls -lh {SNAP}.tgz"
    )
    print(ssh_out(client, snap_cmd, timeout=300))

    print("== backend + shell ==")
    for rel in FILES:
        upload_file(sftp, ROOT / rel, f"{PROJECT}/{rel}")

    # Source mirror for audit (optional)
    for rel in V2_SRC_FILES:
        local = ROOT / rel
        if local.exists():
            upload_file(sftp, local, f"{PROJECT}/{rel}")

    print("== v2 via tar ==")
    with tempfile.NamedTemporaryFile(suffix=".tgz", delete=False) as tmp:
        tar_path = tmp.name
    try:
        with tarfile.open(tar_path, "w:gz") as tar:
            for item in v2_dir.rglob("*"):
                if item.is_file():
                    tar.add(str(item), arcname=item.relative_to(v2_dir).as_posix())
        remote_tar = f"/tmp/asgard-v2-headto-{os.getpid()}.tgz"
        sftp.put(tar_path, remote_tar)
        out = ssh_out(
            client,
            f"mkdir -p {PROJECT}/public/v2 && tar xzf {remote_tar} -C {PROJECT}/public/v2 "
            f"&& rm -f {remote_tar} && ls {PROJECT}/public/v2/assets/*.js | head -5",
            timeout=180,
        )
        print(out)
    finally:
        try:
            os.unlink(tar_path)
        except OSError:
            pass

    print("== markers on prod ==")
    for rel, markers in MARKERS.items():
        for m in markers:
            check = (
                f"grep -F -q {repr(m)} {PROJECT}/{rel} && echo OK:{rel}:{m} || echo FAIL:{rel}:{m}"
            )
            print(ssh_out(client, check).strip())

    print("== restart ==")
    print(ssh_out(client, "systemctl restart asgard-crm && sleep 2 && systemctl is-active asgard-crm"))
    health = ssh_out(client, "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health || curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/")
    print(f"health_http={health.strip()}")

    sftp.close()
    client.close()
    print(f"DONE deploy shell={VER} snap={SNAP}.tgz")


if __name__ == "__main__":
    main()
