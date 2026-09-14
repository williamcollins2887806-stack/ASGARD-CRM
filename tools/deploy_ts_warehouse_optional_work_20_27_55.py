#!/usr/bin/env python3
"""Deploy: warehouse timesheet without required work_id (shell 20.27.55)."""
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
VER = "20.27.55"
TAG = datetime.now().strftime("%Y%m%d-%H%M%S")
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-ts-warehouse-{TAG}"

FILES = [
    "src/routes/timesheet-v2.js",
    "public/assets/js/timesheet-v2.js",
    "public/index.html",
    "public/sw.js",
]


def bump_shell():
    sw = ROOT / "public/sw.js"
    t = sw.read_text(encoding="utf-8")
    for cand in ("20.27.54", "20.27.53", "20.27.52"):
        needle = f"const SHELL_VERSION = '{cand}'"
        if needle in t:
            sw.write_text(t.replace(needle, f"const SHELL_VERSION = '{VER}'"), encoding="utf-8")
            print(f"sw.js {cand} -> {VER}")
            break
    else:
        raise SystemExit("sw.js version not found")

    idx = ROOT / "public/index.html"
    t = idx.read_text(encoding="utf-8")
    for cand in ("20.27.54", "20.27.53", "20.27.52"):
        needle = f"window.ASGARD_SHELL_VERSION = '{cand}'"
        if needle in t:
            t = t.replace(needle, f"window.ASGARD_SHELL_VERSION = '{VER}'")
            break
    else:
        raise SystemExit("ASGARD_SHELL_VERSION not found")

    for cand in ("20.27.54", "20.27.53", "20.27.52", "20.27.49"):
        t = t.replace(f"assets/js/timesheet-v2.js?v={cand}", f"assets/js/timesheet-v2.js?v={VER}")
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


def pack_v2() -> Path:
    v2 = ROOT / "public" / "v2"
    if not v2.is_dir():
        raise SystemExit("public/v2 missing")
    tmp = Path(tempfile.gettempdir()) / f"asgard-v2-ts-wh-{TAG}.tar.gz"
    with tarfile.open(tmp, "w:gz") as tar:
        tar.add(v2, arcname="v2")
    print(f"packed v2 -> {tmp} ({tmp.stat().st_size} bytes)")
    return tmp


def main():
    bump_shell()

    be = (ROOT / "src/routes/timesheet-v2.js").read_text(encoding="utf-8")
    if "|| type === 'warehouse'" in be.split("function typeRequiresWorkId", 1)[1].split("\n\n", 1)[0]:
        raise SystemExit("backend still requires warehouse work_id")
    fe = (ROOT / "public/assets/js/timesheet-v2.js").read_text(encoding="utf-8")
    if "|| t === 'warehouse'" in fe:
        # may appear elsewhere; check the local function
        chunk = fe.split("function typeRequiresWorkIdLocal", 1)[1].split("\n    }", 1)[0]
        if "warehouse" in chunk and "waiting' || t === 'warehouse'" in chunk:
            raise SystemExit("vanilla still requires warehouse work_id")

    v2_tar = pack_v2()
    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    print("=== SNAPSHOT ===")
    run(
        c,
        "mkdir -p /root/snapshots && tar -C {p} -czf {s}.tgz {files} && ls -lh {s}.tgz".format(
            p=PROJECT,
            s=SNAP,
            files=" ".join(FILES + ["public/v2"]),
        ),
    )

    print("=== UPLOAD ===")
    for rel in FILES:
        local = ROOT / rel
        remote = f"{PROJECT}/{rel}"
        digest = md5_file(local)
        # ensure remote dir
        remote_dir = "/".join(remote.split("/")[:-1])
        run(c, f"mkdir -p {remote_dir}")
        sftp.put(str(local), remote)
        with sftp.file(remote, "rb") as rf:
            remote_md5 = hashlib.md5(rf.read()).hexdigest()
        print(f"  {'OK' if remote_md5 == digest else 'FAIL'} {rel}")
        if remote_md5 != digest:
            raise SystemExit("md5 fail")

    remote_tar = f"/tmp/asgard-v2-ts-wh-{TAG}.tar.gz"
    sftp.put(str(v2_tar), remote_tar)
    run(
        c,
        f"tar -xzf {remote_tar} -C {PROJECT}/public && rm -f {remote_tar}",
    )
    sftp.close()

    print("=== VERIFY + RESTART ===")
    run(
        c,
        f"grep -n \"typeRequiresWorkId\\|return type === 'day'\" {PROJECT}/src/routes/timesheet-v2.js | head -8",
    )
    run(c, f"grep -o \"SHELL_VERSION = '[^']*'\" {PROJECT}/public/sw.js")
    run(c, "systemctl restart asgard-crm && sleep 2 && systemctl is-active asgard-crm")
    run(c, "curl -sS http://127.0.0.1:3000/api/version")
    c.close()
    try:
        v2_tar.unlink()
    except OSError:
        pass
    print(f"DONE {VER}")


if __name__ == "__main__":
    main()
